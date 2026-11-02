import { assert } from "chai";
import { DOMParser } from "linkedom";
import type { HtmlRootLike } from "../src/host";
import { richTextFromHtml } from "../src/richText/markup";
import { unitFromHtml, unitToHtml } from "../src/units/htmlUnit";
import { compileRichText } from "../src/units/compile";
import { unitUtils } from "../src/units/unit";

const { text } = unitUtils;

const HTML_ROOT_ID = "__banyan_rich_root__";

function parseHtml(html: string): HtmlRootLike | null {
  const document = new DOMParser().parseFromString(
    `<div id="${HTML_ROOT_ID}">${html}</div>`,
    "text/html",
  );
  return document.getElementById(
    HTML_ROOT_ID,
  ) as unknown as HtmlRootLike | null;
}

describe("rich markup bridge", function () {
  it("parses restricted markup into RichText", function () {
    const rich = richTextFromHtml(
      "<b>bold</b> <i>italic</i> H<sub>2</sub>O",
      parseHtml,
    );

    assert.equal(rich.text, "bold italic H2O");
    assert.deepEqual(rich.marks, [
      { type: "bold", start: 0, end: 4, value: true },
      { type: "italic", start: 5, end: 11, value: true },
      { type: "script", start: 13, end: 14, value: "subscript" },
    ]);
  });

  it("decodes entities without calling the parser for plain text", function () {
    let calls = 0;
    const rich = richTextFromHtml("a &amp; b", () => {
      calls += 1;
      return null;
    });

    assert.equal(calls, 0);
    assert.equal(rich.text, "a & b");
    assert.deepEqual(rich.marks, []);
  });

  it("escapes text and filters links when a Unit is serialized", function () {
    const unit = unitFromHtml(
      '<a href="https://example.org/a?b=1"><b>A</b> &amp; B</a>',
      parseHtml,
    );
    assert.equal(
      unitToHtml(unit),
      '<a href="https://example.org/a?b=1"><strong>A</strong> &amp; B</a>',
    );
  });

  it("escapes a literal markup text instead of parsing it on serialization", function () {
    assert.equal(
      unitToHtml(text("<b>not markup</b>")),
      "&lt;b&gt;not markup&lt;/b&gt;",
    );
  });

  it("round-trips Unit -> markup -> RichText", function () {
    const source = text("Smith", { italic: true });
    const html = unitToHtml(source);
    assert.equal(html, "<em>Smith</em>");
    assert.deepEqual(richTextFromHtml(html, parseHtml), {
      text: "Smith",
      marks: [{ type: "italic", start: 0, end: 5, value: true }],
    });
  });

  it("keeps a background color separate from the text color", function () {
    const [onlyBackground, both] = [
      richTextFromHtml(
        '<span style="background-color: yellow">x</span>',
        parseHtml,
      ),
      richTextFromHtml(
        '<span style="color: red; background-color: yellow">y</span>',
        parseHtml,
      ),
    ];

    assert.deepEqual(onlyBackground.marks, [
      { type: "backgroundColor", start: 0, end: 1, value: "yellow" },
    ]);
    assert.deepEqual(both.marks, [
      { type: "color", start: 0, end: 1, value: "red" },
      { type: "backgroundColor", start: 0, end: 1, value: "yellow" },
    ]);
  });

  it("serializes a line break as br and compiles it back to a newline", function () {
    const unit = unitFromHtml("one<br>two", parseHtml);
    assert.equal(unitToHtml(unit), "one<br>two");
    assert.equal(compileRichText(unit).text, "one\ntwo");
  });

  it("drops a color value that would inject declarations", function () {
    const rich = richTextFromHtml(
      '<span style="color: red; background-image: url(https://track.test/x)">x</span>',
      parseHtml,
    );
    assert.deepEqual(rich.marks, [
      { type: "color", start: 0, end: 1, value: "red" },
    ]);
  });

  it("rejects a link scheme the whitelist does not allow", function () {
    const unit = unitFromHtml(
      '<a href="javascript:alert(1)">click</a>',
      parseHtml,
    );
    assert.equal(unitToHtml(unit), "click");
  });
});
