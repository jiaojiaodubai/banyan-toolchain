import { assert } from "chai";
import {
  escapeAttribute,
  escapeHtml,
  parseBanyanEntryLink,
  sanitizeCssColor,
  sanitizeLink,
} from "../src/richText/html";
import type { RichText } from "../src/types/unit";
import { getRichTextSegments } from "../src/richText/richText";

import { renderRichTextToHtml as renderRichTextVisualToHtml } from "../src/richText/render";

describe("html utilities", function () {
  it("escapes text and attribute-sensitive characters", function () {
    assert.equal(
      escapeHtml(`<a title="x">Tom & Jerry's</a>`),
      "&lt;a title=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
    assert.equal(
      escapeAttribute(`https://example.test/?q="x"&v='y'`),
      "https://example.test/?q=&quot;x&quot;&amp;v=&#39;y&#39;",
    );
  });

  it("allows only supported link protocols", function () {
    assert.equal(
      sanitizeLink(" https://example.test/a "),
      "https://example.test/a",
    );
    assert.equal(
      sanitizeLink("http://example.test/a"),
      "http://example.test/a",
    );
    assert.equal(sanitizeLink("doi:10.1000/xyz123"), "doi:10.1000/xyz123");
    assert.equal(
      sanitizeLink("banyan://entry/abc-123"),
      "banyan://entry/abc-123",
    );

    assert.isUndefined(sanitizeLink("javascript:alert(1)"));
    assert.isUndefined(sanitizeLink("data:text/html,<script></script>"));
    assert.isUndefined(sanitizeLink("file:///C:/secret.txt"));
    assert.isUndefined(sanitizeLink("//example.test/path"));
    assert.isUndefined(sanitizeLink(""));
    assert.isUndefined(sanitizeLink(null));
  });

  it("accepts only entry-scoped banyan links", function () {
    assert.equal(parseBanyanEntryLink("banyan://entry/item%201"), "item 1");
    assert.isUndefined(sanitizeLink("banyan://settings"));
    assert.isUndefined(sanitizeLink("banyan://entry/abc?open=true"));
  });

  it("rejects control characters in links", function () {
    assert.isUndefined(sanitizeLink("https://example.test/a\nb"));
    assert.isUndefined(sanitizeLink("https://example.test/a\tb"));
    assert.isUndefined(sanitizeLink("https://example.test/a\u0085b"));
    assert.isUndefined(sanitizeLink("https://example.test/a\u202eb"));
  });

  it("applies the narrowest mark when ranges start together", function () {
    const segments = getRichTextSegments({
      text: "abc",
      marks: [
        { type: "color", start: 0, end: 3, value: "red" },
        { type: "color", start: 0, end: 1, value: "blue" },
        { type: "bold", start: 0, end: 3, value: true },
        { type: "bold", start: 0, end: 1, value: false },
      ],
    });

    assert.deepEqual(
      segments.map((segment) => ({
        text: segment.value,
        color: segment.color,
        bold: segment.bold,
      })),
      [
        { text: "a", color: "blue", bold: false },
        { text: "bc", color: "red", bold: true },
      ],
    );
  });

  it("keeps precedence when marks overlap with different starts", function () {
    const segments = getRichTextSegments({
      text: "abcd",
      marks: [
        { type: "color", start: 0, end: 4, value: "red" },
        { type: "color", start: 1, end: 3, value: "blue" },
        { type: "bold", start: 0, end: 4, value: true },
        { type: "bold", start: 1, end: 2, value: false },
      ],
    });

    assert.deepEqual(
      segments.map((segment) => ({
        text: segment.value,
        color: segment.color,
        bold: segment.bold,
      })),
      [
        { text: "a", color: "red", bold: true },
        { text: "b", color: "blue", bold: false },
        { text: "c", color: "blue", bold: true },
        { text: "d", color: "red", bold: true },
      ],
    );
  });

  it("accepts colors but not declaration injection", function () {
    assert.equal(sanitizeCssColor("red"), "red");
    assert.equal(sanitizeCssColor("#abc"), "#abc");
    assert.equal(sanitizeCssColor("rgb(1, 2, 3)"), "rgb(1, 2, 3)");
    assert.equal(
      sanitizeCssColor("hsl(10 20% 30% / 0.5)"),
      "hsl(10 20% 30% / 0.5)",
    );

    assert.isUndefined(sanitizeCssColor("red;background:url(x)"));
    assert.isUndefined(sanitizeCssColor("url(x)"));
    assert.isUndefined(sanitizeCssColor("expression(alert(1))"));
    assert.isUndefined(sanitizeCssColor("#12"));
    assert.isUndefined(sanitizeCssColor(42));
  });

  it("renders line breaks as br instead of raw newlines", function () {
    assert.equal(
      renderRichTextVisualToHtml({ text: "one\ntwo", marks: [] }),
      "one<br>two",
    );
  });

  it("renders non-interactive rich text previews without links while preserving superscript", function () {
    const richText: RichText = {
      text: "[3]",
      marks: [
        { type: "script", start: 0, end: 3, value: "superscript" },
        { type: "link", start: 0, end: 3, value: "https://example.test" },
      ],
    };

    assert.equal(
      renderRichTextVisualToHtml(richText, { includeLinks: false }),
      "<sup>[3]</sup>",
    );
    assert.equal(
      renderRichTextVisualToHtml(richText),
      '<a href="https://example.test"><sup>[3]</sup></a>',
    );
  });
});
