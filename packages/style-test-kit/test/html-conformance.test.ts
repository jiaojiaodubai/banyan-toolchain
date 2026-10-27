/**
 * HTML conformance.
 *
 * A Zotero host parses style markup with Gecko, this toolkit with linkedom;
 * both hand the resulting tree to the core, which turns it into `RichText`. This
 * suite pins what that conversion must produce for one shared fixture, and
 * checks the default renderer stays inside the allowed tag/attribute set, so
 * "the default HTML looks portable" is a tested claim instead of an impression.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderRichTextToHtml, type RichText } from "../src/banyan";
import { TestLibrary } from "../src/library/library";
import { buildContexts } from "../src/run/contexts";
import { runStyle } from "../src/run/runner";
import { parseHtml } from "../src/runtime/dom";

const here = path.dirname(fileURLToPath(import.meta.url));

interface ConformanceCase {
  name: string;
  html: string;
  text: string;
  marks: RichText["marks"];
  caveat?: string;
}

interface ConformanceFixture {
  allowed: {
    tags: Record<string, string>;
    attributes: Record<string, string[]>;
  };
  cases: ConformanceCase[];
}

const fixture = JSON.parse(
  readFileSync(path.join(here, "../fixtures/html/conformance.json"), "utf8"),
) as ConformanceFixture;

const emptyLibrary = TestLibrary.empty();
const contexts = buildContexts(emptyLibrary, [{ cites: [] }]);

async function richTextOf(html: string): Promise<RichText> {
  const run = await runStyle(
    {
      code: `const INFO = { id: "html", title: "HTML", description: "", citationType: "intext-citation", creator: [], tags: [], documentation: [], license: "MIT", updated: "" };
function generate() {
  return { citations: [{ id: contexts[0].id, content: ${JSON.stringify(html)} }], bibliography: [] };
}`,
      library: emptyLibrary,
      styleDir: process.cwd(),
    },
    contexts,
  );
  return run.result.citations[0].content;
}

describe("HTML conformance fixture", () => {
  for (const testCase of fixture.cases) {
    it(`${testCase.name}${testCase.caveat ? " (documented caveat)" : ""}`, async () => {
      const content = await richTextOf(testCase.html);
      expect({ text: content.text, marks: content.marks }).to.deep.equal({
        text: testCase.text,
        marks: testCase.marks,
      });
    });
  }
});

describe("default renderer stays inside the allowed set", () => {
  const allowedTags = new Set(Object.keys(fixture.allowed.tags));
  const allowedAttributes = fixture.allowed.attributes;

  interface ElementLike {
    nodeType: number;
    tagName: string;
    childNodes: ArrayLike<ElementLike>;
    attributes?: ArrayLike<{ name: string }>;
  }

  /** Elements of the rendered fragment, with their attribute names. */
  function elementsOf(
    html: string,
  ): Array<{ tag: string; attributes: string[] }> {
    const root = parseHtml(html) as unknown as ElementLike;
    const found: Array<{ tag: string; attributes: string[] }> = [];
    const walk = (node: ElementLike): void => {
      if (node.nodeType !== 1) return;
      const attributes = node.attributes
        ? Array.from(node.attributes).map((attribute) =>
            attribute.name.toLowerCase(),
          )
        : [];
      found.push({ tag: node.tagName.toLowerCase(), attributes });
      for (const child of Array.from(node.childNodes)) walk(child);
    };
    for (const child of Array.from(root.childNodes)) walk(child);
    return found;
  }

  for (const testCase of fixture.cases) {
    it(`renders ${testCase.name} with allowed tags and attributes`, async () => {
      const content = await richTextOf(testCase.html);
      const html = renderRichTextToHtml(content);

      for (const element of elementsOf(html)) {
        expect(
          allowedTags.has(element.tag),
          `tag <${element.tag}> in ${html}`,
        ).to.equal(true);
        const allowed = allowedAttributes[element.tag] ?? [];
        for (const attribute of element.attributes) {
          expect(
            allowed,
            `<${element.tag} ${attribute}> in ${html}`,
          ).to.include(attribute);
        }
      }

      // The renderer output must re-parse to the same text: it is the same
      // parser the fixture pins, so a round trip is a cheap consistency check.
      const reparsed = await richTextOf(html);
      expect(reparsed.text).to.equal(content.text);
    });
  }
});

describe("parseHtml capability shape", () => {
  it("returns an element-like root whose children are the fragment", () => {
    const root = parseHtml("a<br>b &amp; c");
    expect(root).to.exist;
    expect(root!.nodeType).to.equal(1);
    expect(root!.childNodes.length).to.be.greaterThan(0);
    expect(root!.textContent).to.equal("ab & c");
  });

  it("keeps entity and tag handling identical across repeated parses", () => {
    const first = parseHtml("H<sub>2</sub>O &amp; CO<sup>2</sup>");
    const second = parseHtml("H<sub>2</sub>O &amp; CO<sup>2</sup>");
    expect(first!.textContent).to.equal(second!.textContent);
    expect(first!.childNodes.length).to.equal(second!.childNodes.length);
  });
});
