/**
 * `extra` field syntax: the variable-line dialect Zotero itself reads and
 * writes (`Key: value`), plus Banyan's normalized key form.
 *
 * Part of the input-side convenience layer: it turns a Zotero-shaped string
 * field into the normalized map the author contract promises. Hosts that build
 * Banyan items from another source may skip it, but must still honour the key
 * form documented on `ExtraMap`.
 */
import type { ExtraMap } from "../types/item";
import { isValidExtraKey, normalizeExtraKey } from "@banyan/style-contract";

export { isValidExtraKey, normalizeExtraKey };

export type ParsedExtraLine = {
  raw: string;
  normalizedKey: string | null;
  value: string;
};

/**
 * Variable-line syntax of the `extra` field, mirroring Zotero's own readers
 * (`extractExtraFields` / `combineExtraFields`): a key that starts with a letter
 * and continues with letters, digits, spaces, hyphens or underscores, followed
 * by a non-empty value. Anything else is prose.
 */
const EXTRA_PAIR_PATTERN = /^([\p{L}][\p{L}\p{N} _-]*?)[ \t]*:[ \t]*(\S.*)$/u;

/** Legacy citeproc.js cheater syntax `{:author: Smith}`, still read by Zotero. */
const EXTRA_CHEATER_PAIR_PATTERN =
  /^[ \t]*\{:[ \t]*([\p{L}][\p{L}\p{N} _-]*?)[ \t]*:[ \t]*(\S.*?)[ \t]*\}[ \t]*$/u;

/** Split one `extra` line into its normalized key and value, or prose. */
export function parseExtraLine(raw: string): ParsedExtraLine {
  const match =
    raw.match(EXTRA_PAIR_PATTERN) ?? raw.match(EXTRA_CHEATER_PAIR_PATTERN);
  const key = match?.[1];
  const value = match?.[2];
  if (!key || value === undefined) {
    return { raw, normalizedKey: null, value: "" };
  }
  return {
    raw,
    normalizedKey: normalizeExtraKey(key),
    value: value.trim(),
  };
}

/**
 * Convert an extra-field key to Zotero's preferred title-case form for
 * writing into the `extra` field (e.g. `Type`, `Genre`, `Status`,
 * `Citation Key`). Matching/comparison should still go through
 * `normalizeExtraKey()` (lowercase kebab-case).
 *
 * Existing capitals (e.g. acronyms like `DOI`, `arXiv`) are preserved.
 */
export function toTitleCaseExtraKey(value: unknown): string {
  let text: string;
  switch (typeof value) {
    case "string":
      text = value;
      break;
    case "number":
    case "boolean":
      text = String(value);
      break;
    default:
      text = "";
  }
  return (
    text
      // Split camelCase / PascalCase boundaries: "authorID" -> "author ID".
      // Only split when the uppercase letter starts an acronym (not followed
      // by lowercase), so words like "arXiv" are left intact.
      .replace(/([a-z0-9])([A-Z])(?=[^a-z]|$)/g, "$1 $2")
      .replace(/([A-Z]+)(?=[A-Z][a-z])/g, "$1 ")
      // Normalize separators (spaces, hyphens, underscores) to single spaces
      .replace(/[\s_-]+/g, " ")
      .trim()
      // Capitalize the first letter of each word, preserving the rest
      .replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
  );
}

export function parseExtraLines(extraText: string): ParsedExtraLine[] {
  return extraText.split(/\r?\n/).map(parseExtraLine);
}

/**
 * Parse the whole `extra` field into the normalized map.
 *
 * Repeated keys become an array: a community convention Zotero itself never
 * writes, preserved as data instead of choosing one value.
 */
export function parseExtraMap(extraText: string): ExtraMap {
  // Null-prototype accumulator: keys come from author input, so a line named
  // "constructor" or "__proto__" has to become data instead of reaching
  // `Object.prototype`. The result is copied back into a plain object.
  const out = Object.create(null) as ExtraMap;
  const text = typeof extraText === "string" ? extraText : "";
  for (const line of parseExtraLines(text)) {
    const key = line.normalizedKey;
    if (!key) continue;

    const value = line.value;
    const prev = out[key];
    if (prev === undefined) {
      out[key] = value;
    } else if (Array.isArray(prev)) {
      prev.push(value);
      out[key] = prev;
    } else {
      out[key] = [prev, value];
    }
  }
  return { ...out };
}

export function replaceExtraFieldBlock(
  extraText: string,
  normalizedKey: string,
  values: readonly string[],
): string {
  const newline = extraText.includes("\r\n") ? "\r\n" : "\n";
  const remaining = parseExtraLines(extraText)
    .filter((line) => line.normalizedKey !== normalizedKey)
    .map((line) => line.raw);

  while (remaining.length && !remaining[remaining.length - 1]?.trim()) {
    remaining.pop();
  }

  return [...remaining, ...values].join(newline);
}
