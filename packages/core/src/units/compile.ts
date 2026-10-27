/**
 * The one Unit compiler.
 *
 * `compileUnitTree` walks a normalized unit tree and produces styled text runs.
 * Group/affix/fallback/`when` semantics, text-case and link sanitizing live here
 * and nowhere else: the generate-output normalizer and the author utilities
 * (`compile`, `plainText`) all call this module, so the two views of a Unit can
 * no longer drift.
 *
 * Markup is the only host-dependent part. A caller that has the `parseHtml`
 * capability passes `splitText`, which turns one text value into styled runs;
 * without it, text is taken as written (still entity-free: no HTML semantics
 * are invented by the core).
 *
 * DEBT(next feature in this file): compilation, text-case dispatch,
 * ignore-words and the small-caps table share this module; splitting them needs
 * one shared `CompiledTextUnit` protocol first.
 */
import type {
  AffixUnit,
  FallbackUnit,
  GroupUnit,
  LinkUnit,
  RichText,
  TextCaseForm,
  TextCaseUnit,
  TextUnit,
  WhenUnit,
  WithStyleUnit,
} from "../types/unit";
import {
  getRichTextSegments,
  isRichTextLike,
  richTextFromRuns,
  type RichTextLike,
  type RichTextRun,
} from "../richText/richText";
import { sanitizeLink } from "../richText/html";
import { createBanyanRuntimeError } from "../sandbox/runtimeErrors";
import { sanitizeRenderStyle } from "./style";
import { textCase } from "./textCase";

/**
 * Hostile or accidentally exponential unit trees stop at these budgets. The
 * node budget counts every visited slot, including primitive leaves and empty
 * fallback candidates, so it is larger than the normalization budget (which
 * counts containers): a normalized tree at its 20k-container limit can still
 * produce roughly three runs per container.
 */
const MAX_COMPILE_NODES = 100_000;
const MAX_COMPILE_DEPTH = 100;

type CompileState = {
  nodes: number;
  depth: number;
};

/**
 * A run produced by the compiler. `smallCaps` and `noCase` are intermediate
 * markers from parsed markup: they affect text-case and are resolved by
 * `finalizeCompiledUnit`, never carried into a `RichText`.
 */
export type CompiledTextUnit = RichTextRun & {
  /** The text was marked small-caps (`<sc>` / `font-variant`). */
  smallCaps?: boolean;
  /** The text came from a `nocase` span: exempt from text-case. */
  noCase?: boolean;
};

/** Turn one text value into styled runs (markup splitting for output). */
export type SplitText = (base: TextUnit) => CompiledTextUnit[];

export interface CompileOptions {
  /** Markup-aware text splitter; omitted, a text value stays one run. */
  splitText?: SplitText;
}

export function normalizeTextValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  return typeof value === "string" ? value : "";
}

function hasVisualText(units: readonly CompiledTextUnit[]): boolean {
  return units.length > 0 && units.some((unit) => unit.value !== "");
}

/**
 * A structured `RichText` is a Unit: its runs carry the marks the structure
 * declares. `getRichTextSegments` normalizes mark kinds, offsets and link
 * protocols, so this is the one place a RichText becomes runs.
 */
function richTextToRuns(input: RichTextLike): CompiledTextUnit[] {
  const runs: CompiledTextUnit[] = [];
  for (const segment of getRichTextSegments(input)) {
    const run: CompiledTextUnit = { value: segment.value };
    if (segment.bold) run.bold = true;
    if (segment.italic) run.italic = true;
    if (segment.script) run.script = segment.script;
    if (segment.color) run.color = segment.color;
    if (segment.backgroundColor) run.backgroundColor = segment.backgroundColor;
    if (segment.link) run.link = segment.link;
    runs.push(run);
  }
  return runs;
}

function splitIntoRuns(
  unit: unknown,
  splitText: SplitText,
  state: CompileState,
): CompiledTextUnit[] {
  if (typeof unit === "string" || typeof unit === "number") {
    countCompileNode(state);
    return splitText({ value: normalizeTextValue(unit) });
  }

  // Every non-primitive slot is visited even when it renders nothing:
  // `null`/`undefined`/`false` are documented as empty candidates, and a long
  // list of them still costs traversal. Counting them keeps the budget message
  // and the bound honest.
  countCompileNode(state);
  if (!unit || typeof unit !== "object") {
    return [];
  }

  state.depth += 1;
  try {
    if (state.depth > MAX_COMPILE_DEPTH) {
      throw createBanyanRuntimeError(
        `Unit tree is nested deeper than ${MAX_COMPILE_DEPTH} levels.`,
        { code: "generate-output", sourcePath: "unit" },
      );
    }
    if (!("type" in unit)) {
      if (isRichTextLike(unit)) {
        return richTextToRuns(unit);
      }
      return splitText(unit as TextUnit);
    }
    if (typeof unit.type !== "string") {
      return [];
    }

    switch (unit.type) {
      case "group":
        return compileGroup(unit as GroupUnit, splitText, state);
      case "affix":
        return compileAffix(unit as AffixUnit, splitText, state);
      case "fall":
        return compileFallback(unit as FallbackUnit, splitText, state);
      case "when":
        return compileWhen(unit as WhenUnit, splitText, state);
      case "text-case":
        return compileTextCase(unit as TextCaseUnit, splitText, state);
      case "style":
        return compileStyle(unit as WithStyleUnit, splitText, state);
      case "link":
        return compileLink(unit as LinkUnit, splitText, state);
      default:
        return [];
    }
  } finally {
    state.depth -= 1;
  }
}

function countCompileNode(state: CompileState): void {
  state.nodes += 1;
  if (state.nodes > MAX_COMPILE_NODES) {
    throw createBanyanRuntimeError(
      `Unit tree expands beyond ${MAX_COMPILE_NODES} visited nodes; empty fallback candidates and repeated sub-units count each time they are visited.`,
      { code: "generate-output", sourcePath: "unit" },
    );
  }
}

function compileGroup(
  unit: GroupUnit,
  splitText: SplitText,
  state: CompileState,
): CompiledTextUnit[] {
  const parts = Array.isArray(unit.units) ? unit.units : [];
  const blocks = parts
    .map((inner) => splitIntoRuns(inner, splitText, state))
    .filter(hasVisualText);
  if (!blocks.length) {
    return [];
  }

  const out: CompiledTextUnit[] = [];
  blocks.forEach((block, index) => {
    if (index > 0 && unit.delimiter != null) {
      out.push(...splitIntoRuns(unit.delimiter, splitText, state));
    }
    out.push(...block);
  });
  return out;
}

function compileAffix(
  unit: AffixUnit,
  splitText: SplitText,
  state: CompileState,
): CompiledTextUnit[] {
  const blocks = splitIntoRuns(unit.unit, splitText, state);
  if (!hasVisualText(blocks)) {
    return [];
  }

  const out: CompiledTextUnit[] = [];
  if (unit.prefix != null) {
    const prefix = splitIntoRuns(unit.prefix, splitText, state);
    if (hasVisualText(prefix)) {
      out.push(...prefix);
    }
  }
  out.push(...blocks);
  if (unit.suffix != null) {
    const suffix = splitIntoRuns(unit.suffix, splitText, state);
    if (hasVisualText(suffix)) {
      out.push(...suffix);
    }
  }
  return out;
}

function compileFallback(
  unit: FallbackUnit,
  splitText: SplitText,
  state: CompileState,
): CompiledTextUnit[] {
  const candidates = Array.isArray(unit.units) ? unit.units : [];
  for (const candidate of candidates) {
    const result = splitIntoRuns(candidate, splitText, state);
    if (hasVisualText(result)) {
      return result;
    }
  }
  return [];
}

function compileWhen(
  unit: WhenUnit,
  splitText: SplitText,
  state: CompileState,
): CompiledTextUnit[] {
  if (unit.condition) {
    return splitIntoRuns(unit.trueUnit, splitText, state);
  }
  // `0` is a printable unit, so presence cannot be tested for truthiness.
  return unit.elseUnit != null
    ? splitIntoRuns(unit.elseUnit, splitText, state)
    : [];
}

function compileTextCase(
  unit: TextCaseUnit,
  splitText: SplitText,
  state: CompileState,
): CompiledTextUnit[] {
  const blocks = splitIntoRuns(unit.unit, splitText, state);
  return applyTextCaseToUnits(blocks, unit.form, unit.ignoreWords);
}

function compileStyle(
  unit: WithStyleUnit,
  splitText: SplitText,
  state: CompileState,
): CompiledTextUnit[] {
  const style = sanitizeRenderStyle(unit.style);
  return splitIntoRuns(unit.unit, splitText, state).map((textUnit) => ({
    ...textUnit,
    ...style,
  }));
}

function compileLink(
  unit: LinkUnit,
  splitText: SplitText,
  state: CompileState,
): CompiledTextUnit[] {
  const blocks = splitIntoRuns(unit.unit, splitText, state);
  const link = sanitizeLink(unit.link);
  if (!link) {
    return blocks;
  }
  return blocks.map((textUnit) => ({ ...textUnit, link }));
}

function isCaseProtected(unit: CompiledTextUnit): boolean {
  return unit.noCase === true || unit.smallCaps === true;
}

function applyTextCaseToUnits(
  units: CompiledTextUnit[],
  form: TextCaseForm,
  ignoreWords: string[] = [],
): CompiledTextUnit[] {
  if (!units.length) {
    return [];
  }

  if (form === "small-caps") {
    // A small-caps mapping is one character to one character (ASCII only), so
    // applying it per run cannot shift a neighbouring run's range.
    return units.map((unit) =>
      isCaseProtected(unit)
        ? unit
        : { ...unit, value: applyTextCase(unit.value, form, ignoreWords) },
    );
  }

  // `lower`/`upper` are context-sensitive too: Greek final sigma depends on
  // the following character, which may live in the next mark. Join the runs,
  // transform once, and map each boundary back (as title/sentence already do).
  const out: CompiledTextUnit[] = [];
  let run: CompiledTextUnit[] = [];

  const flushRun = (): void => {
    if (!run.length) {
      return;
    }
    for (const unit of transformCaseRun(run, form, ignoreWords)) {
      pushMergedCompiled(out, unit);
    }
    run = [];
  };

  for (const unit of units) {
    if (isCaseProtected(unit)) {
      flushRun();
      pushMergedCompiled(out, unit);
      continue;
    }
    run.push(unit);
  }
  flushRun();

  return out;
}

function transformCaseRun(
  units: CompiledTextUnit[],
  form: TextCaseForm,
  ignoreWords: string[],
): CompiledTextUnit[] {
  const input = units.map((unit) => unit.value).join("");
  const transformed = applyTextCase(input, form, ignoreWords);
  // `lower`/`upper` map code point by code point (including expansions such as
  // `ß` -> `SS`), so their boundaries are known in one pass. The word-aware
  // forms need the prefix probe below; `name` can expand a first letter too.
  let boundaries =
    form === "lower" || form === "upper"
      ? simpleCaseBoundaries(input, form)
      : undefined;
  if (boundaries && boundaries[input.length] !== transformed.length) {
    // An ignored word was restored with a different UTF-16 length; the
    // per-code-point map is no longer authoritative, so use the prefix probe.
    boundaries = undefined;
  }

  let offset = 0;
  let sourceOffset = 0;
  return units
    .map((unit, index) => {
      sourceOffset += unit.value.length;
      // A case mapping can change length, so slicing by the original run
      // lengths would shift every later mark; measure each boundary in the
      // transformed text instead.
      const nextOffset =
        index === units.length - 1
          ? transformed.length
          : Math.max(
              offset,
              Math.min(
                transformed.length,
                boundaries
                  ? (boundaries[sourceOffset] ?? transformed.length)
                  : transformedPrefixLength(
                      input,
                      sourceOffset,
                      form,
                      ignoreWords,
                    ),
              ),
            );
      const value = transformed.slice(offset, nextOffset);
      offset = nextOffset;
      return { ...unit, value };
    })
    .filter((unit) => unit.value.length > 0);
}

/**
 * Transformed offsets at every source code-unit boundary for `lower`/`upper`.
 *
 * Default case conversion is per code point (the one contextual exception,
 * Greek final sigma, has the same length either way), so a single pass is
 * enough; calling `applyTextCase` on every prefix would be quadratic in marks.
 * A run that splits a surrogate pair maps both halves to the same offset.
 */
function simpleCaseBoundaries(
  input: string,
  form: "lower" | "upper",
): number[] {
  const offsets = new Array<number>(input.length + 1).fill(0);
  let source = 0;
  let target = 0;
  for (const char of input) {
    offsets[source] = target;
    const mapped = form === "lower" ? char.toLowerCase() : char.toUpperCase();
    for (let index = 1; index < char.length; index += 1) {
      offsets[source + index] = target;
    }
    source += char.length;
    target += mapped.length;
    offsets[source] = target;
  }
  return offsets;
}

/**
 * Where the first `sourceEnd` characters of `input` end after `applyTextCase`.
 *
 * A sentinel keeps a trailing whitespace run from being trimmed, so the prefix
 * is transformed under the same conditions as the full string; its own length
 * (always 1) is subtracted back out.
 */
function transformedPrefixLength(
  input: string,
  sourceEnd: number,
  form: TextCaseForm,
  ignoreWords: string[],
): number {
  const sentinel = prefixSentinel(input, sourceEnd, form);
  const transformed = applyTextCase(
    input.slice(0, sourceEnd) + sentinel,
    form,
    ignoreWords,
  );
  return Math.max(
    0,
    transformed.length - applyTextCase(sentinel, form, ignoreWords).length,
  );
}

/**
 * A sentinel must have the same word-context as the real next character.
 * `lower`/`upper` care about Greek final sigma, so a letter after the boundary
 * needs a letter sentinel; otherwise a word-internal sigma would be treated as
 * final. The word-aware forms keep the old non-letter sentinel.
 */
function prefixSentinel(
  input: string,
  sourceEnd: number,
  form: TextCaseForm,
): string {
  if (form !== "lower" && form !== "upper") {
    return "\u0000";
  }
  const next = Array.from(input.slice(sourceEnd))[0] ?? "";
  return /\p{L}/u.test(next) ? "α" : "\u0000";
}

/**
 * Append a run, merging it into the previous one when the style matches.
 *
 * DEBT(representation drift): near-copies of this merge live in
 * `output/normalizeGenerateResult.pushMergedRun` and
 * `richText/richText.pushMergedSegment`; they differ by representation, so a
 * shared merger would need a cross-representation style protocol. Merge them
 * only when a style field drifts between the copies.
 */
export function pushMergedCompiled(
  out: CompiledTextUnit[],
  unit: CompiledTextUnit,
): void {
  if (!unit.value) {
    return;
  }
  const last = out[out.length - 1];
  if (!last || !sameTextStyle(last, unit)) {
    out.push(unit);
    return;
  }
  last.value += unit.value;
}

/** Whether two runs carry the same visual style (markers included). */
function sameTextStyle(a: CompiledTextUnit, b: CompiledTextUnit): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.script === b.script &&
    a.link === b.link &&
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor &&
    a.smallCaps === b.smallCaps &&
    a.noCase === b.noCase
  );
}

/** Compile a unit tree into styled runs (markers still present). */
export function compileUnitTree(
  unit: unknown,
  options: CompileOptions = {},
): CompiledTextUnit[] {
  return splitIntoRuns(unit, options.splitText ?? defaultSplitText, {
    nodes: 0,
    depth: 0,
  });
}

const defaultSplitText: SplitText = (base) => [
  { ...base, value: normalizeTextValue(base.value) },
];

/** Resolve the intermediate markers and return a plain run. */
export function finalizeCompiledUnit(unit: CompiledTextUnit): RichTextRun {
  const { smallCaps, noCase: _noCase, value, ...style } = unit;
  return {
    ...style,
    value: smallCaps ? applyTextCase(value, "small-caps") : value,
  };
}

/** Compile a unit tree all the way to `RichText`. */
export function compileRichText(
  unit: unknown,
  options: CompileOptions = {},
): RichText {
  return richTextFromRuns(
    compileUnitTree(unit, options).map(finalizeCompiledUnit),
  );
}

/** Visible text of a unit tree, matches included. */
export function plainTextOfUnit(
  unit: unknown,
  options: CompileOptions = {},
): string {
  return compileUnitTree(unit, options)
    .map(finalizeCompiledUnit)
    .map((run) => run.value)
    .join("");
}

export function applyTextCase(
  str: string,
  form: TextCaseForm,
  ignoreWords: string[] = [],
): string {
  const input = String(str ?? "");
  // `\n` is a hard line break (from a `<br>` or an author newline). Word-aware
  // transforms collapse whitespace, so transform each line separately and keep
  // the breaks; otherwise title case would turn one line into two words.
  const perLine = (transform: (line: string) => string): string =>
    input.split("\n").map(transform).join("\n");
  switch (form) {
    case "lower":
      return applyIgnoreWords(input.toLowerCase(), ignoreWords);
    case "upper":
      return applyIgnoreWords(input.toUpperCase(), ignoreWords);
    case "small-caps":
      return smallCapsCase(input, ignoreWords);
    case "title":
      return applyIgnoreWords(
        perLine((line) => textCase.capitalizeTitle(line)),
        ignoreWords,
      );
    case "sentence":
      return applyIgnoreWords(
        perLine((line) => textCase.sentenceCase(line)),
        ignoreWords,
      );
    case "name":
      return applyIgnoreWords(textCase.capitalizeName(input), ignoreWords);
    default:
      return input;
  }
}

/**
 * Unicode small capitals are scattered across several blocks (`ᴀ` U+1D00,
 * `ʙ` U+0299, `ʀ` U+0280, …), so a character map is the only correct form; a
 * constant offset produces unrelated phonetic letters. Characters without a
 * small-cap form keep their uppercase variant.
 */
const SMALL_CAPITALS: Readonly<Record<string, string>> = {
  A: "ᴀ",
  B: "ʙ",
  C: "ᴄ",
  D: "ᴅ",
  E: "ᴇ",
  F: "ꜰ",
  G: "ɢ",
  H: "ʜ",
  I: "ɪ",
  J: "ᴊ",
  K: "ᴋ",
  L: "ʟ",
  M: "ᴍ",
  N: "ɴ",
  O: "ᴏ",
  P: "ᴘ",
  Q: "ꞯ",
  R: "ʀ",
  S: "ꜱ",
  T: "ᴛ",
  U: "ᴜ",
  V: "ᴠ",
  W: "ᴡ",
  X: "x",
  Y: "ʏ",
  Z: "ᴢ",
};

const SMALL_CAPITAL_CHARS = new Set(Object.values(SMALL_CAPITALS));

function toSmallCaps(input: string): string {
  let out = "";
  for (const character of input) {
    // Already-small-cap letters must survive a second pass unchanged; calling
    // `toUpperCase` on them yields a different code point (`ɪ` -> `Ɪ`) that is
    // not a map key. Without this guard, nested small-caps would corrupt text.
    if (SMALL_CAPITAL_CHARS.has(character)) {
      out += character;
      continue;
    }
    const upper = character.toUpperCase();
    if (upper.length === 1) {
      out += SMALL_CAPITALS[upper] ?? character;
      continue;
    }
    // Case mappings can expand (`ß` -> `SS`); map the expansion character by
    // character and leave characters without a small-cap form as they are.
    for (const mapped of upper) {
      out += SMALL_CAPITALS[mapped] ?? mapped;
    }
  }
  return out;
}

function smallCapsCase(str: string, ignoreWords: string[] = []): string {
  const input = String(str ?? "");
  if (!input) return input;

  const words = ignoreWords.map((word) => word.trim()).filter(Boolean);
  if (!words.length) {
    return toSmallCaps(input);
  }

  // Protect ignored words *before* mapping: small-cap characters have no case
  // mappings, so a post-pass could never restore them.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${words.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  let out = "";
  let last = 0;
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    out += toSmallCaps(input.slice(last, index)) + match[0];
    last = index + match[0].length;
  }
  return out + toSmallCaps(input.slice(last));
}

function applyIgnoreWords(text: string, ignoreWords: string[]): string {
  if (!ignoreWords.length) return text;

  // One alternation instead of one full-string pass per word. Longer spellings
  // are tried first so `New York` wins over `New`; the last declaration for the
  // same case-insensitive spelling decides the restored form, matching the old
  // sequential loop. Overlapping declarations that would have matched text
  // introduced by an earlier replacement are the one ordering difference; an
  // ignore list is a set of words, not a rewrite chain.
  const spellings = new Map<string, string>();
  for (const word of ignoreWords) {
    const key = word.trim();
    if (key) spellings.set(key.toLowerCase(), key);
  }
  if (!spellings.size) return text;

  const alternatives = [...spellings.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  // Unicode-aware edges: `\b` is ASCII-only, so it fails after `é` and would
  // neither protect nor restore a non-ASCII ignored word. The replacement is
  // the trimmed word, so stray spaces in the declaration cannot leak into the
  // output. Function replacement keeps `$&`/`$1` literal.
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  return text.replace(
    re,
    (match) => spellings.get(match.toLowerCase()) ?? match,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
