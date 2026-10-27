import { assert } from "chai";
import { createRequire } from "node:module";
import { textCase, trimInternal } from "../src/units/textCase";

/**
 * Drift guard for the core's text-case implementation against its reference:
 * `zotero/utilities`, the module Zotero loads as `xpcom/utilities` (a
 * devDependency tracking the repository's default branch; `pnpm-lock.yaml`
 * records the revision it resolved to, so the comparison stays reproducible).
 *
 * The core carries its own implementation instead of depending on that module —
 * see the header of `src/units/textCase.ts` — so this test is what keeps the two
 * from diverging. It runs anywhere Node runs; a Zotero-side suite can repeat the
 * comparison against `Zotero.Utilities`.
 *
 * The reference reads a `Zotero` global (its `capitalizeTitle` touches
 * `Zotero.Prefs` even with `force = true`), so the minimal shape it expects is
 * stubbed around each call and removed again, leaving the process as it was.
 */
const reference = createRequire(import.meta.url)("@zotero/utilities") as {
  capitalizeTitle(input: string, force?: boolean): string;
  capitalizeName(input: string): string;
  sentenceCase(input: string): string;
  trimInternal(input: string): string;
};

function withZoteroStub<T>(run: () => T): T {
  const scope = globalThis as { Zotero?: unknown };
  const hadZotero = "Zotero" in scope;
  const previous = scope.Zotero;
  scope.Zotero = { Prefs: null };
  try {
    return run();
  } finally {
    if (hadZotero) {
      scope.Zotero = previous;
    } else {
      delete scope.Zotero;
    }
  }
}

const titles = [
  "the war of the worlds",
  "THE WAR OF THE WORLDS",
  "a study of : something",
  "The A B C of things",
  "¿Qué pasa? una prueba",
  "an <i>italic</i> title of sorts",
  "U.S. Taxes and You",
  "the rise of us-vs-them thinking",
  "about the «spread» of ideas",
  "a tale of two cities: the sequel",
  "   an\u00A0indented\u00A0title   ",
  "up and down as far as the eye can see",
  'the <span class="nocase">DNA</span> story',
];

const names = [
  "JOHN",
  "GUTIÉRREZ-ALBILLA",
  "O'NEAL",
  "o'neal",
  "O'neal",
  "John MacGregor O'NEILL",
  "martha McMiddlename WASHINGTON",
  "李",
  "王 小 明",
  "DE LA CRUZ",
  "j.r.r. tolkien",
  "MÜLLER-STRACHWITZ",
];

const sentences = [
  "THE WAR OF THE WORLDS",
  "A STUDY OF THINGS. ANOTHER ONE FOLLOWS",
  "mixed case sentence",
  "The U.S. Taxes Problem. And More",
  "an <i>italic</i> START of sorts",
  "trailing acronym U.S.A. matters",
  "keep nouns like DNA and iPhone 12 intact",
  "first sentence. second one. Third! fourth? Fifth",
];

/** Deterministic pseudo-random title-like inputs (LCG, so failures repeat). */
function* generatedInputs(count: number): Generator<string> {
  const parts = [
    "a",
    "B",
    "cd",
    "EF",
    "the",
    "of",
    "and",
    "A",
    "-",
    " ",
    ":",
    "?",
    "!",
    "'",
    "«",
    "»",
    "3",
    ".",
    "()",
    "<i>",
    "</i>",
    "\u00A0",
    "\uFEFF",
    "\t",
    "\u2019",
    "\u2013",
  ];
  let seed = 42;
  for (let index = 0; index < count; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const length = 1 + Math.floor((seed / 2147483648) * 8);
    let input = "";
    for (let part = 0; part < length; part++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      input += parts[Math.floor((seed / 2147483648) * parts.length)];
    }
    yield input;
  }
}

describe("core text-case against the zotero/utilities reference", function () {
  it("matches capitalizeTitle", function () {
    for (const title of titles) {
      assert.equal(
        textCase.capitalizeTitle(title),
        withZoteroStub(() => reference.capitalizeTitle(title, true)),
        `title: ${title}`,
      );
    }
  });

  it("matches capitalizeName", function () {
    for (const name of names) {
      assert.equal(
        textCase.capitalizeName(name),
        reference.capitalizeName(name),
      );
    }
  });

  it("matches sentenceCase", function () {
    for (const sentence of sentences) {
      assert.equal(
        textCase.sentenceCase(sentence),
        reference.sentenceCase(sentence),
        `sentence: ${sentence}`,
      );
    }
  });

  it("matches trimInternal", function () {
    for (const value of ["  a  b  ", "\r\n\tmixed\n", " ", "", "x"]) {
      assert.equal(trimInternal(value), reference.trimInternal(value));
    }
  });

  it("matches on generated title-like inputs", function () {
    for (const input of generatedInputs(2000)) {
      assert.equal(
        textCase.capitalizeTitle(input),
        withZoteroStub(() => reference.capitalizeTitle(input, true)),
        `title: ${JSON.stringify(input)}`,
      );
      assert.equal(
        textCase.sentenceCase(input),
        reference.sentenceCase(input),
        `sentence: ${JSON.stringify(input)}`,
      );
      assert.equal(
        textCase.capitalizeName(input),
        reference.capitalizeName(input),
        `name: ${JSON.stringify(input)}`,
      );
    }
  });
});
