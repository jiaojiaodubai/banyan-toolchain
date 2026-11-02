/**
 * Text-case algorithms used by the `text-case` unit.
 *
 * This is the core's own implementation, written against the reference
 * implementation in `zotero/utilities` (pinned for this repository at
 * `4051881`; Zotero ships the same module as the submodule
 * `chrome/content/zotero/xpcom/utilities/utilities.js`): `capitalizeTitle`,
 * `sentenceCase`, `capitalizeName` and `trimInternal` are covered case for case,
 * including the skip-word list, the HTML-tag gymnastics, `nocase` spans and
 * acronym handling. The differential test in `tests/textCaseReference.test.ts`
 * compares the core against that reference on fixed and generated input and
 * keeps watching for drift.
 *
 * It is deliberately not a dependency on that module:
 * - `utilities.js` reads a `Zotero` global (its `capitalizeTitle` touches
 *   `Zotero.Prefs` even when `force` is set, others read `Zotero.isFx`/`isNode`),
 *   so every host would have to fake a `Zotero` global; the core reads none;
 * - the module pulls the bundled XRegExp (~125 KB minified) for one `\pL`, and
 *   requires `jsdom` down a Node-only branch that a bundler cannot ignore.
 *
 * Deliberate differences from the reference:
 * - `capitalizeTitle` always converts, i.e. it behaves like the reference with
 *   `force = true`; the `capitalizeTitles` preference and `Zotero.locale` are
 *   host concerns, not core ones;
 * - `capitalizeName` uses native Unicode property escapes instead of XRegExp.
 *
 * These algorithms are **not** a host capability: every host runs exactly this
 * code, so a style renders the same text everywhere. A style that needs
 * different casing says so itself.
 */

export interface TextCaseAlgorithms {
  /** JOHN -> John, GUTIÉRREZ-ALBILLA -> Gutiérrez-Albilla */
  capitalizeName(input: string): string;
  /** "the war of the worlds" -> "The War of the Worlds" */
  capitalizeTitle(input: string): string;
  /** "THE WAR OF THE WORLDS" -> "The war of the worlds" */
  sentenceCase(input: string): string;
}

/** Collapses internal whitespace; upstream `Zotero.Utilities.trimInternal`. */
export function trimInternal(value: string): string {
  return value.replace(/[\xA0\r\n\s]+/g, " ").trim();
}

const TITLE_CASE_SKIP_WORDS = [
  "but",
  "or",
  "yet",
  "so",
  "for",
  "and",
  "nor",
  "a",
  "an",
  "the",
  "at",
  "by",
  "from",
  "in",
  "into",
  "of",
  "on",
  "to",
  "with",
  "up",
  "down",
  "as",
];

// May only match a single character.
const TITLE_CASE_DELIMITER =
  /([ /\u002D\u00AD\u2010-\u2015\u2212\u2E3A\u2E3B])/;

function capitalizeTitle(input: string): string {
  let string = trimInternal(input);
  string = string.replace(/ : /g, ": ");
  if (!string) return "";

  // Remove HTML tags but remember their positions.
  const htmlTags: Array<{ match: string; offset: number }> = [];
  const cleanedString = string.replace(/<[^>]+>/g, (match, offset: number) => {
    htmlTags.push({ match, offset });
    return "";
  });

  const words = cleanedString.split(TITLE_CASE_DELIMITER);
  const isUpperCase = cleanedString.toUpperCase() === cleanedString;

  let newString = "";
  const lastWordIndex = words.length - 1;
  let previousWordIndex = -1;
  for (let i = 0; i <= lastWordIndex; i++) {
    const word = words[i] ?? "";
    // Only manipulate non-delimiter words.
    if (
      word.length !== 0 &&
      (word.length !== 1 || !TITLE_CASE_DELIMITER.test(word))
    ) {
      const lowerCaseVariant = word.toLowerCase();
      const previous =
        previousWordIndex >= 0 ? (words[previousWordIndex] ?? "") : "";

      // Only use it when the word has no capitalization of its own.
      if (isUpperCase || word === lowerCaseVariant) {
        if (
          TITLE_CASE_SKIP_WORDS.indexOf(
            lowerCaseVariant.replace(/[^a-zA-Z]+/, ""),
          ) !== -1 &&
          i !== 0 &&
          i !== lastWordIndex &&
          (previousWordIndex === -1 || previous.at(-1)?.search(/[:?!]/) === -1)
        ) {
          words[i] = lowerCaseVariant;
        } else {
          // Leading punctuation may repeat, as in "¿Qué pasa?".
          const punct = word.match(/^['"¡¿“‘„«\s]+/);
          const offset = punct ? (punct[0]?.length ?? 0) + 1 : 1;
          words[i] = word.length
            ? word.slice(0, offset).toUpperCase() +
              word.slice(offset).toLowerCase()
            : word;
        }
      }

      previousWordIndex = i;
    }

    newString += words[i] ?? "";
  }

  // Reinsert HTML tags at their original positions.
  htmlTags.forEach((tag) => {
    newString =
      newString.substring(0, tag.offset) +
      tag.match +
      newString.substring(tag.offset);
  });

  return newString;
}

function sentenceCase(text: string): string {
  const preserve: Array<{ start: number; end: number }> = [];
  const allcaps = text === text.toUpperCase();

  // Sub-sentence starts.
  text.replace(
    /([.?!][\s]+)(<[^>]+>)?([\p{Lu}])/gu,
    (match, end: string, markup: string, char: string, i: number) => {
      // Prevent "U.S. Taxes" from starting a new sub-sentence.
      if (!text.substring(0, i + 1).match(/(\p{Lu}[.]){2,}$/u)) {
        preserve.push({
          start: i + end.length + (markup || "").length,
          end: i + end.length + (markup || "").length + char.length,
        });
      }
      return match;
    },
  );

  // Protect the leading capital.
  text.replace(
    /^(<[^>]+>)?([\p{Lu}])/u,
    (match, markup: string, char: string) => {
      preserve.push({
        start: (markup || "").length,
        end: (markup || "").length + char.length,
      });
      return match;
    },
  );

  // Protect nocase.
  text.replace(
    /<span class="nocase">.*?<\/span>|<nc>.*?<\/nc>/gi,
    (match, i: number) => {
      preserve.push({ start: i, end: i + match.length });
      return match;
    },
  );

  // Mask HTML tags so sentence-casing treats them as simple words.
  let masked = text.replace(/<[^>]+>/g, (match, i: number) => {
    preserve.push({ start: i, end: i + match.length });
    return "\uFFFD".repeat(match.length);
  });

  masked = masked
    .replace(/[;:]\uFFFD*\s+\uFFFD*A\s/g, (match) => match.toLowerCase())
    .replace(/[–—]\uFFFD*\s*\uFFFD*A\s/g, (match) => match.toLowerCase())
    // Words, compound words and acronyms (the latter also catches U.S.A.).
    .replace(
      /([\u{FFFD}\p{L}\p{N}\p{No}]+([\u{FFFD}\p{L}\p{N}\p{No}\p{Pc}]*))|(\s(\p{Lu}+[.]){2,})?/gu,
      (word) => {
        if (allcaps) return word.toLowerCase();

        const unmasked = word.replace(/\uFFFD/g, "");

        if (unmasked.length === 1) {
          return unmasked === "A" ? word.toLowerCase() : word;
        }

        // Inner capital somewhere.
        if (unmasked.match(/.\p{Lu}/u)) {
          return word;
        }

        // Identifiers or allcaps.
        if (
          unmasked.match(/^\p{L}\p{L}*[\p{N}\p{No}][\p{L}\p{N}\p{No}]*$/u) ||
          unmasked.match(/^[\p{Lu}\p{N}\p{No}]+$/u)
        ) {
          return word;
        }

        return word.toLowerCase();
      },
    );

  for (const { start, end } of preserve) {
    masked =
      masked.substring(0, start) +
      text.substring(start, end) +
      masked.substring(end);
  }

  return masked;
}

function capitalizeName(input: string): string {
  return input
    .split(" ")
    .map((part) => {
      if (part.toUpperCase() === part || part.toLowerCase() === part) {
        return part
          .toLowerCase()
          .replace(/(^|[^\p{L}])\p{L}/gu, (match) => match.toUpperCase());
      }
      return part;
    })
    .join(" ");
}

/** The one and only text-case implementation; hosts cannot swap it out. */
export const textCase: TextCaseAlgorithms = {
  capitalizeName,
  capitalizeTitle,
  sentenceCase,
};
