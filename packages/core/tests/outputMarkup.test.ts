import { assert } from "chai";
import { DOMParser } from "linkedom";
import type { HtmlRootLike } from "../src/host";
import {
  decodeEntities,
  looksLikeMarkup,
  splitTextUnitByMarkup,
} from "../src/output/markup";

const ROOT_ID = "__banyan_output_markup_root__";

function parseHtml(html: string): HtmlRootLike | null {
  const document = new DOMParser().parseFromString(
    `<div id="${ROOT_ID}">${html}</div>`,
    "text/html",
  );
  return document.getElementById(ROOT_ID) as unknown as HtmlRootLike | null;
}

function textOf(html: string): string {
  return splitTextUnitByMarkup({ value: html }, parseHtml)
    .map((unit) => unit.value)
    .join("");
}

describe("generate-output markup splitting", function () {
  it("requires a complete tag before parsing", function () {
    assert.isFalse(looksLikeMarkup("1 <b and 2 > 1"));
    assert.isFalse(looksLikeMarkup("a<b"));
    assert.isTrue(looksLikeMarkup("<b>a</b>"));
    assert.isTrue(looksLikeMarkup("a<br>b"));
    assert.isTrue(looksLikeMarkup("<i/>"));
    // A lone self-closing non-void tag inside prose would swallow the rest of
    // the sentence under HTML's start-tag rules; keep it literal.
    assert.isFalse(looksLikeMarkup("Use <b/> here"));
    assert.isFalse(looksLikeMarkup("<i/>text"));
    assert.isTrue(looksLikeMarkup("<i/> <br>"));
  });

  it("recognises self-closing and void tags with attributes", function () {
    assert.isTrue(looksLikeMarkup("<i />"));
    assert.isTrue(looksLikeMarkup('<i class="x"/>'));
    assert.isTrue(looksLikeMarkup("<span class='x' />"));
    assert.isTrue(looksLikeMarkup('<br class="x">'));
    assert.isTrue(looksLikeMarkup('<br class="x" />'));
    // A quoted attribute may contain the characters a tag delimiter uses.
    assert.isTrue(looksLikeMarkup('<b title="<">word</b>'));
    assert.isTrue(looksLikeMarkup('<span title="a > b">x</span>'));
  });

  it("strips self-closing markup and keeps the text around it", function () {
    assert.equal(textOf('<i class="x"/>'), "");
    assert.equal(textOf("a<br />b"), "a\nb");
    assert.equal(textOf('<b title="<">word</b>'), "word");
  });

  it("keeps prose that merely contains a tag-like prefix", function () {
    assert.equal(textOf("1 <b and 2 > 1"), "1 <b and 2 > 1");
    assert.equal(textOf("a<b"), "a<b");
    assert.equal(textOf("Use <b/> here"), "Use <b/> here");
  });

  it("turns source newlines into spaces but keeps br as a hard break", function () {
    assert.equal(textOf("<b>a</b>\n<b>b</b>"), "a b");
    assert.equal(textOf("one<br>two"), "one\ntwo");
  });

  it("collapses whitespace that spans a text-node boundary", function () {
    assert.equal(textOf("a <b> b</b>"), "a b");
    assert.equal(textOf("<b>a </b><i> b</i>"), "a b");
    assert.equal(textOf("a <b> </b> b"), "a b");
  });

  it("decodes numeric and common named entities", function () {
    assert.equal(
      decodeEntities("A&mdash;B &#8212; C &nbsp;"),
      "A\u2014B \u2014 C \u00a0",
    );
    assert.equal(decodeEntities("&unknown;"), "&unknown;");
    assert.equal(
      decodeEntities("Caf&eacute; &Eacute; &AMP; &euro;"),
      "Caf\u00e9 \u00c9 & \u20ac",
    );
    // Named references are case-sensitive; an unknown case stays literal.
    assert.equal(decodeEntities("&EACUTE;"), "&EACUTE;");
  });

  it("does not resolve inherited Object.prototype members as entities", function () {
    for (const name of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
    ]) {
      assert.equal(
        decodeEntities(`a&${name};b`),
        `a&${name};b`,
        `&${name}; must stay literal`,
      );
    }
  });

  it("reports markup deeper than the walk budget as generate-output", function () {
    const deep = `${"<b>".repeat(150)}x${"</b>".repeat(150)}`;
    try {
      splitTextUnitByMarkup({ value: deep }, parseHtml);
      assert.fail("expected deep markup to be rejected");
    } catch (error) {
      const record = error as { code?: unknown; message?: unknown };
      assert.equal(record.code, "generate-output");
      assert.match(String(record.message), /nested deeper than 100/);
    }
  });
});
