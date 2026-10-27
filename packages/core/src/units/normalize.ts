/**
 * Normalization of the raw values a style hands back: unit trees are untrusted
 * input, so every layer is re-checked and bounded here before compilation.
 */
import type { TextCaseForm, TextUnit, Unit } from "../types/unit";
import { sanitizeCssColor, sanitizeLink } from "../richText/html";
import { isRichTextLike, normalizeRichText } from "../richText/richText";
import { sanitizeRenderStyle } from "./style";
import { createBanyanRuntimeError } from "../sandbox/runtimeErrors";
import { normalizeTextValue } from "./compile";

const MAX_UNIT_LIST_LENGTH = 10_000;
const MAX_STRING_ARRAY_LENGTH = 10_000;
/** Objects one normalization pass may visit before the tree is treated as hostile. */
const MAX_UNIT_NODES = 20_000;
/** Containers one unit may be nested in before the tree is treated as hostile. */
const MAX_UNIT_DEPTH = 100;

/**
 * Walk state for one normalization pass. `seen` holds the containers on the
 * current path, so a cyclic tree is reported instead of overflowing the stack;
 * shared (non-cyclic) sub-units stay allowed but count against a total-node
 * budget, so a small DAG cannot expand exponentially.
 */
type UnitWalk = {
  seen: WeakSet<object>;
  depth: number;
  nodes: number;
};

function createWalk(): UnitWalk {
  return { seen: new WeakSet(), depth: 0, nodes: 0 };
}

export function assertArrayLengthWithinBudget(
  value: readonly unknown[],
  fieldName: string,
  maxLength: number,
): void {
  if (value.length > maxLength) {
    throw createBanyanRuntimeError(
      `${fieldName} has ${value.length} entries, exceeding limit ${maxLength}.`,
      {
        code: "generate-output",
        sourcePath: fieldName,
      },
    );
  }
}

/**
 * Normalize a unit coming from the sandbox into a plain host-side unit, used by
 * the unit-builder utilities before the value crosses back.
 */
export function toHostUnit(input?: Unit): Unit | undefined {
  return normalizeUnitInput(input) ?? undefined;
}

export function normalizeUnitInput(
  input: unknown,
  walk: UnitWalk = createWalk(),
): Unit | null {
  if (typeof input === "string") {
    return input;
  }
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (!input || typeof input !== "object") {
    return null;
  }
  walk.nodes += 1;
  if (walk.nodes > MAX_UNIT_NODES) {
    throw createBanyanRuntimeError(
      `Unit tree expands beyond ${MAX_UNIT_NODES} nodes; shared sub-units are counted once per use.`,
      {
        code: "generate-output",
        sourcePath: "unit",
      },
    );
  }

  const raw = input as Record<string, unknown>;
  if (isRichTextLike(raw)) {
    return normalizeRichText(raw);
  }
  if (typeof raw.type !== "string") {
    return normalizeTextUnit(raw);
  }

  if (walk.seen.has(raw)) {
    throw createBanyanRuntimeError("Unit tree contains a cycle.", {
      code: "generate-output",
      sourcePath: "unit",
    });
  }
  if (walk.depth >= MAX_UNIT_DEPTH) {
    throw createBanyanRuntimeError(
      `Unit tree is nested deeper than ${MAX_UNIT_DEPTH} levels.`,
      {
        code: "generate-output",
        sourcePath: "unit",
      },
    );
  }

  walk.seen.add(raw);
  walk.depth += 1;
  try {
    return normalizeUnitContainer(raw, walk);
  } finally {
    walk.depth -= 1;
    walk.seen.delete(raw);
  }
}

function normalizeUnitContainer(
  raw: Record<string, unknown>,
  walk: UnitWalk,
): Unit | null {
  switch (raw.type) {
    case "group": {
      const delimiter = normalizeOptionalUnit(raw.delimiter, walk);
      return {
        type: "group",
        units: normalizeUnitList(raw.units, walk),
        ...(delimiter === undefined ? {} : { delimiter }),
      };
    }
    case "affix": {
      const unit = normalizeUnitInput(raw.unit, walk);
      // `0` is a printable unit: only `null` means "nothing to attach to".
      if (unit == null) {
        return null;
      }
      const prefix = normalizeOptionalUnit(raw.prefix, walk);
      const suffix = normalizeOptionalUnit(raw.suffix, walk);
      return {
        type: "affix",
        unit,
        ...(prefix === undefined ? {} : { prefix }),
        ...(suffix === undefined ? {} : { suffix }),
      };
    }
    case "fall":
      return {
        type: "fall",
        units: normalizeUnitList(raw.units, walk),
      };
    case "when": {
      const trueUnit = normalizeUnitInput(raw.trueUnit, walk);
      if (trueUnit == null) {
        return null;
      }
      const elseUnit = normalizeUnitInput(raw.elseUnit, walk) ?? undefined;
      return {
        type: "when",
        condition: Boolean(raw.condition),
        trueUnit,
        ...(elseUnit === undefined ? {} : { elseUnit }),
      };
    }
    case "text-case": {
      const unit = normalizeUnitInput(raw.unit, walk);
      const form = normalizeTextCaseForm(raw.form);
      if (unit == null || !form) {
        return unit;
      }
      const ignoreWords = normalizeStringArray(raw.ignoreWords);
      return {
        type: "text-case",
        unit,
        form,
        ...(ignoreWords === undefined ? {} : { ignoreWords }),
      };
    }
    case "style": {
      const unit = normalizeUnitInput(raw.unit, walk);
      if (unit == null) {
        return unit;
      }
      return {
        type: "style",
        unit,
        style: sanitizeRenderStyle(raw.style),
      };
    }
    case "link": {
      const unit = normalizeUnitInput(raw.unit, walk);
      const link = sanitizeLink(raw.link);
      if (unit == null) {
        return unit;
      }
      return link ? { type: "link", unit, link } : unit;
    }
    default:
      return normalizeTextUnit(raw);
  }
}

export function normalizeUnitList(
  input: unknown,
  walk: UnitWalk = createWalk(),
): Unit[] {
  if (!Array.isArray(input)) {
    return [];
  }

  assertArrayLengthWithinBudget(input, "Unit[]", MAX_UNIT_LIST_LENGTH);
  return input
    .map((item) => normalizeUnitInput(item, walk))
    .filter((item): item is Unit => item != null);
}

export function normalizeOptionalUnit(
  input: unknown,
  walk: UnitWalk = createWalk(),
): Unit | undefined {
  if (input == null) {
    return undefined;
  }
  return normalizeUnitInput(input, walk) ?? undefined;
}

export function normalizeTextCaseForm(form: unknown): TextCaseForm | undefined {
  switch (form) {
    case "lower":
    case "upper":
    case "small-caps":
    case "title":
    case "sentence":
    case "name":
      return form;
    default:
      return undefined;
  }
}

export function normalizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  assertArrayLengthWithinBudget(input, "string[]", MAX_STRING_ARRAY_LENGTH);
  const values = input.map((item) => String(item ?? "")).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function normalizeTextUnit(input: Record<string, unknown>): TextUnit {
  const value = normalizeTextValue(input.value);
  const out: TextUnit = { value };
  if (typeof input.italic === "boolean") out.italic = input.italic;
  if (typeof input.bold === "boolean") out.bold = input.bold;
  if (input.script === "superscript" || input.script === "subscript") {
    out.script = input.script;
  }
  if (typeof input.color === "string") {
    const color = sanitizeCssColor(input.color);
    if (color) out.color = color;
  }
  if (typeof input.backgroundColor === "string") {
    const backgroundColor = sanitizeCssColor(input.backgroundColor);
    if (backgroundColor) out.backgroundColor = backgroundColor;
  }
  return out;
}
