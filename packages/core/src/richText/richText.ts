import type { InlineMark, RichText, TextUnit } from "../types/unit";
import { sanitizeCssColor, sanitizeLink } from "./html";
import { createBanyanRuntimeError } from "../sandbox/runtimeErrors";

/** Guards one `RichText` value against a synchronous, unbounded mark walk. */
export const MAX_RICH_TEXT_MARKS = 10_000;
/** Guards mark values (links, colors) against absurd payloads. */
export const MAX_MARK_VALUE_LENGTH = 2_000;

export type RichTextLike = {
  text: string;
  marks: readonly unknown[];
};

/**
 * Structural test for a value that claims to be `RichText`. Marks are not
 * validated here; `normalizeRichText` is the authority for that.
 */
export function isRichTextLike(value: unknown): value is RichTextLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.text === "string" && Array.isArray(record.marks);
}

type MarkValue = InlineMark["value"];
type MarkType = InlineMark["type"];
type MarkRangeInput = {
  type: MarkType;
  start: number;
  end: number;
  value: MarkValue;
};

const MARK_ORDER: Record<MarkType, number> = {
  bold: 0,
  italic: 1,
  script: 2,
  color: 3,
  backgroundColor: 4,
  link: 5,
};

export type RichTextRun = TextUnit & {
  link?: string;
};

export type RichTextSegment = TextUnit & {
  start: number;
  end: number;
  link?: string;
};

export function emptyRichText(): RichText {
  return { text: "", marks: [] };
}

export function textToRichText(text: string): RichText {
  return { text, marks: [] };
}

export function richTextFromRuns(units: readonly RichTextRun[]): RichText {
  const markRuns = new Map<string, MarkRangeInput[]>();
  let text = "";
  let offset = 0;

  const pushMark = (mark: MarkRangeInput): void => {
    if (mark.start >= mark.end) return;
    const key = `${mark.type}\u0000${String(mark.value)}`;
    const runs = markRuns.get(key);
    if (!runs) {
      markRuns.set(key, [mark]);
      return;
    }

    const last = runs[runs.length - 1];
    if (last && last.end === mark.start) {
      last.end = mark.end;
      return;
    }
    runs.push(mark);
  };

  for (const unit of units) {
    const value = unit.value ?? "";
    if (!value) continue;

    const start = offset;
    const end = start + value.length;
    text += value;
    offset = end;

    if (typeof unit.bold === "boolean") {
      pushMark({ type: "bold", start, end, value: unit.bold });
    }
    if (typeof unit.italic === "boolean") {
      pushMark({ type: "italic", start, end, value: unit.italic });
    }
    if (unit.script) {
      pushMark({ type: "script", start, end, value: unit.script });
    }
    if (unit.color) {
      pushMark({ type: "color", start, end, value: unit.color });
    }
    if (unit.backgroundColor) {
      pushMark({
        type: "backgroundColor",
        start,
        end,
        value: unit.backgroundColor,
      });
    }
    if (unit.link) {
      pushMark({ type: "link", start, end, value: unit.link });
    }
  }

  return {
    text,
    marks: Array.from(markRuns.values())
      .flat()
      .map(toInlineMark)
      .sort(compareInlineMarks),
  };
}

export function getRichTextSegments(input: RichTextLike): RichTextSegment[] {
  const text = typeof input.text === "string" ? input.text : "";
  if (!text) {
    return [];
  }

  // Bound the walk even for a host-supplied value that never went through
  // `normalizeRichText`: a four-billion-entry sparse array is still an array.
  const rawMarks =
    input.marks.length > MAX_RICH_TEXT_MARKS
      ? input.marks.slice(0, MAX_RICH_TEXT_MARKS)
      : input.marks;
  const boundaries = new Set<number>([0, text.length]);
  const marks = normalizeMarks(rawMarks, text.length);
  for (const mark of marks) {
    boundaries.add(mark.start);
    boundaries.add(mark.end);
  }

  const offsets = Array.from(boundaries).sort((a, b) => a - b);
  const heaps = new Map<MarkType, MarkHeap>();
  let markIndex = 0;
  const segments: RichTextSegment[] = [];
  for (let index = 0; index < offsets.length - 1; index++) {
    const start = offsets[index];
    const end = offsets[index + 1];
    if (start === undefined || end === undefined || start >= end) continue;

    // Every segment boundary is also a mark boundary, so a mark that covers
    // the segment's start covers the whole segment. Add starts as they arrive;
    // the per-type heap leaves only the mark that would be applied last, which
    // is exactly what a full scan would leave on the segment.
    while (markIndex < marks.length && marks[markIndex]!.start <= start) {
      const mark = marks[markIndex]!;
      markIndex += 1;
      let heap = heaps.get(mark.type);
      if (!heap) {
        heap = new MarkHeap();
        heaps.set(mark.type, heap);
      }
      heap.push(mark);
    }

    const segment: RichTextSegment = {
      start,
      end,
      value: text.slice(start, end),
    };
    for (const heap of heaps.values()) {
      while (heap.peek() && heap.peek()!.end <= start) {
        heap.pop();
      }
      const mark = heap.peek();
      if (mark) {
        applyMarkToSegment(segment, mark);
      }
    }

    if (segment.value) {
      pushMergedSegment(segments, segment);
    }
  }
  return segments;
}

/**
 * Max-heap of marks in `compareInlineMarks` order. The top is the mark that a
 * sorted full scan would apply last; expired marks are popped lazily.
 */
class MarkHeap {
  private readonly items: InlineMark[] = [];

  push(mark: InlineMark): void {
    this.items.push(mark);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compareInlineMarks(this.items[parent]!, this.items[index]!) >= 0) {
        break;
      }
      [this.items[parent], this.items[index]] = [
        this.items[index]!,
        this.items[parent]!,
      ];
      index = parent;
    }
  }

  peek(): InlineMark | undefined {
    return this.items[0];
  }

  pop(): InlineMark | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (!top || !last || this.items.length === 0) {
      return top;
    }
    this.items[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let largest = index;
      if (
        left < this.items.length &&
        compareInlineMarks(this.items[left]!, this.items[largest]!) > 0
      ) {
        largest = left;
      }
      if (
        right < this.items.length &&
        compareInlineMarks(this.items[right]!, this.items[largest]!) > 0
      ) {
        largest = right;
      }
      if (largest === index) {
        return top;
      }
      [this.items[index], this.items[largest]] = [
        this.items[largest]!,
        this.items[index]!,
      ];
      index = largest;
    }
  }
}

export function normalizeRichText(input: unknown): RichText | null {
  if (!isRichTextLike(input)) {
    return null;
  }
  if (input.marks.length > MAX_RICH_TEXT_MARKS) {
    throw createBanyanRuntimeError(
      `RichText has ${input.marks.length} marks, exceeding the limit of ${MAX_RICH_TEXT_MARKS}.`,
      {
        code: "generate-output",
        sourcePath: "RichText.marks",
      },
    );
  }
  return {
    text: input.text,
    marks: normalizeMarks(input.marks, input.text.length),
  };
}

function normalizeMarks(input: unknown, textLength: number): InlineMark[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const marks: InlineMark[] = [];
  for (const raw of input) {
    const mark = normalizeMark(raw, textLength);
    if (mark) {
      marks.push(mark);
    }
  }

  return marks.sort(compareInlineMarks);
}

function normalizeMark(input: unknown, textLength: number): InlineMark | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const type = record.type;
  const start = normalizeOffset(record.start, textLength);
  const end = normalizeOffset(record.end, textLength);
  if (!start.ok || !end.ok || start.value >= end.value) {
    return null;
  }

  const valueLength =
    typeof record.value === "string" ? record.value.length : 0;
  if (valueLength > MAX_MARK_VALUE_LENGTH) {
    return null;
  }

  switch (type) {
    case "bold":
    case "italic":
      return typeof record.value === "boolean"
        ? { type, start: start.value, end: end.value, value: record.value }
        : null;
    case "script":
      return record.value === "superscript" || record.value === "subscript"
        ? { type, start: start.value, end: end.value, value: record.value }
        : null;
    case "color":
    case "backgroundColor": {
      const color = sanitizeCssColor(record.value);
      return color
        ? { type, start: start.value, end: end.value, value: color }
        : null;
    }
    case "link": {
      const link = sanitizeLink(record.value);
      return link
        ? { type, start: start.value, end: end.value, value: link }
        : null;
    }
    default:
      return null;
  }
}

function normalizeOffset(
  value: unknown,
  textLength: number,
): { ok: true; value: number } | { ok: false } {
  if (!Number.isInteger(value)) {
    return { ok: false };
  }

  const offset = value as number;
  if (offset < 0 || offset > textLength) {
    return { ok: false };
  }
  return { ok: true, value: offset };
}

function toInlineMark(mark: MarkRangeInput): InlineMark {
  switch (mark.type) {
    case "bold":
    case "italic":
      return {
        type: mark.type,
        start: mark.start,
        end: mark.end,
        value: Boolean(mark.value),
      };
    case "script":
      return {
        type: "script",
        start: mark.start,
        end: mark.end,
        value:
          mark.value === "subscript" || mark.value === "superscript"
            ? mark.value
            : "superscript",
      };
    case "color":
    case "backgroundColor":
    case "link":
      return {
        type: mark.type,
        start: mark.start,
        end: mark.end,
        value: String(mark.value),
      };
  }
}

function compareInlineMarks(a: InlineMark, b: InlineMark): number {
  return (
    a.start - b.start ||
    // A wider mark starting at the same offset is applied first, so a narrower
    // one can override it (blue over red, or bold:false over bold:true).
    b.end - a.end ||
    MARK_ORDER[a.type] - MARK_ORDER[b.type] ||
    // Code-unit order, not `localeCompare`: the same style must order marks the
    // same way on every host, and collation depends on the host's locale data.
    compareStrings(String(a.value), String(b.value))
  );
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function applyMarkToSegment(segment: RichTextSegment, mark: InlineMark): void {
  switch (mark.type) {
    case "bold":
      segment.bold = mark.value;
      break;
    case "italic":
      segment.italic = mark.value;
      break;
    case "script":
      segment.script = mark.value;
      break;
    case "color":
      segment.color = mark.value;
      break;
    case "backgroundColor":
      segment.backgroundColor = mark.value;
      break;
    case "link":
      segment.link = mark.value;
      break;
  }
}

function pushMergedSegment(
  segments: RichTextSegment[],
  segment: RichTextSegment,
): void {
  const last = segments[segments.length - 1];
  if (
    last &&
    last.end === segment.start &&
    last.bold === segment.bold &&
    last.italic === segment.italic &&
    last.script === segment.script &&
    last.color === segment.color &&
    last.backgroundColor === segment.backgroundColor &&
    last.link === segment.link
  ) {
    last.value += segment.value;
    last.end = segment.end;
    return;
  }
  segments.push(segment);
}
