import { assert } from "chai";
import { DOMParser } from "linkedom";
import { createGenerateOutputNormalizer } from "../src/output/normalizeGenerateResult";
import { normalizeUnitInput } from "../src/units/normalize";
import type { HtmlRootLike } from "../src/host";
import type { CitationContext } from "../src/types/style";
import type { InlineMark, RichText } from "../src/types/unit";

const contexts = [
  {
    id: "ctx-1",
    page: 1,
    cites: [{ item: { id: "101" }, params: { locator: "12" } }],
    params: { prefix: "see", sortBy: "cite" },
  },
] as unknown as CitationContext[];

const HTML_ROOT_ID = "__banyan_html_root__";

/**
 * The host half of the contract: the core asks for `parseHtml` when the content
 * carries markup and takes whatever the host returns. These tests supply
 * `linkedom`, so markup paths run everywhere instead of depending on a runner's
 * DOM.
 */
function parseHtml(html: string): HtmlRootLike | null {
  const document = new DOMParser().parseFromString(
    `<div id="${HTML_ROOT_ID}">${html}</div>`,
    "text/html",
  );
  return document.getElementById(
    HTML_ROOT_ID,
  ) as unknown as HtmlRootLike | null;
}

const normalizeGenerateResult = createGenerateOutputNormalizer(() => parseHtml);

function rich(text: string, marks: InlineMark[] = []): RichText {
  return { text, marks };
}

/** Normalize one citation content unit and return the single content line. */
function contentOf(unit: unknown): unknown {
  const result = normalizeGenerateResult(
    { citations: [{ id: "ctx-1", content: unit }], bibliography: [] },
    contexts,
    "Test Style",
    "intext-citation",
  );
  return (result.citations as { content: unknown }[])[0].content;
}

describe("generate output normalization", function () {
  it("accepts a RichText value as a top-level content Unit", function () {
    const value = rich("See generally", [
      { type: "italic", start: 0, end: 13, value: true },
    ]);
    assert.deepEqual(contentOf(value), value);
  });

  it("drops unsafe marks from a RichText content unit", function () {
    const value = rich("x", [
      { type: "link", start: 0, end: 1, value: "javascript:alert(1)" },
      { type: "color", start: 0, end: 1, value: "red;background:url(x)" },
      { type: "italic", start: 0, end: 1, value: true },
    ]);

    assert.deepEqual(
      contentOf(value),
      rich("x", [{ type: "italic", start: 0, end: 1, value: true }]),
    );
  });

  it("does not pass undocumented citation keys through", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            content: "ok",
            units: [],
            reference: "not an intext field",
            extra: 1,
          },
        ],
        bibliography: [],
      },
      contexts,
      "Test Style",
      "intext-citation",
    );

    const citation = (result.citations as Record<string, unknown>[])[0];
    assert.deepEqual(Object.keys(citation).sort(), [
      "content",
      "id",
      "source",
      "type",
    ]);
  });

  it("normalizes in-text citations and bibliography from declarative units", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            type: "ignored-by-host",
            content: {
              type: "group",
              units: [
                { value: "smith", italic: true },
                { type: "affix", unit: "2024", prefix: " (", suffix: ")" },
                {
                  type: "when",
                  condition: false,
                  trueUnit: " yes",
                  elseUnit: " no",
                },
              ],
              delimiter: ", ",
            },
          },
        ],
        bibliography: [
          {
            id: "references",
            type: "bibliography-title",
            content: "References",
          },
          {
            id: "item-1",
            type: "bibliography-entry",
            content: {
              type: "fall",
              units: ["", { value: "Bibliography", bold: true }],
            },
          },
        ],
      },
      contexts,
      "Test Style",
      "intext-citation",
    );

    assert.deepEqual(result.citations, [
      {
        id: "ctx-1",
        type: "intext-citation",
        source: {
          cites: contexts[0].cites,
          params: contexts[0].params,
        },
        content: rich("smith,  (2024),  no", [
          { type: "italic", start: 0, end: 5, value: true },
        ]),
      },
    ]);
    assert.deepEqual(result.bibliography, [
      {
        id: "references",
        type: "bibliography-title",
        content: rich("References"),
      },
      {
        id: "item-1",
        type: "bibliography-entry",
        content: rich("Bibliography", [
          { type: "bold", start: 0, end: 12, value: true },
        ]),
      },
    ]);
  });

  it("requires an id for bibliography titles", function () {
    assert.throws(
      () =>
        normalizeGenerateResult(
          {
            citations: [],
            bibliography: [
              { type: "bibliography-title", content: "References" },
            ],
          },
          contexts,
          "Test Style",
          "intext-citation",
        ),
      /bibliography\[0\]\.id must be a non-empty string\./,
    );
  });

  it("drops affixes when the main unit has no visible text", function () {
    const bibliography = [
      {
        id: "empty-string",
        type: "bibliography-entry",
        content: { type: "affix", unit: "", prefix: "(", suffix: ")" },
      },
      {
        id: "empty-text-unit",
        type: "bibliography-entry",
        content: {
          type: "affix",
          unit: { value: "" },
          prefix: "(",
          suffix: ")",
        },
      },
    ] as unknown[];

    const result = normalizeGenerateResult(
      { citations: [], bibliography },
      contexts,
      "Test Style",
      "intext-citation",
    );

    assert.deepEqual(result.bibliography, [
      { id: "empty-string", type: "bibliography-entry", content: rich("") },
      { id: "empty-text-unit", type: "bibliography-entry", content: rich("") },
    ]);
  });

  it("rejects top-level Unit arrays to keep the script contract explicit", function () {
    assert.throws(
      () =>
        normalizeGenerateResult(
          {
            citations: [{ id: "ctx-1", content: ["A", "B"] }],
            bibliography: [],
          },
          contexts,
          "Test Style",
          "intext-citation",
        ),
      /must be a single Unit.*group\(\[\.\.\.\]\)/,
    );
  });

  it("normalizes note citations with reference content", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            content: "Footnote body",
            reference: { value: "1", script: "superscript" },
          },
        ],
        bibliography: [],
      },
      contexts,
      "Test Style",
      "note-citation",
    );

    assert.deepInclude(result.citations as object[], {
      id: "ctx-1",
      type: "note-citation",
      source: {
        cites: contexts[0].cites,
        params: contexts[0].params,
      },
      content: rich("Footnote body"),
      reference: rich("1", [
        { type: "script", start: 0, end: 1, value: "superscript" },
      ]),
    });
  });

  it("splits supported markup and drops unsafe markup links", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            content: {
              value:
                'A <strong>B</strong><a href="javascript:alert(1)">bad</a><a href="https://example.test/?a=1&amp;b=2">ok</a><br><sup>2</sup>',
            },
          },
        ],
        bibliography: [],
      },
      contexts,
      "Test Style",
      "intext-citation",
    );

    assert.deepEqual(
      (result.citations as { content: unknown }[])[0].content,
      rich("A Bbadok\n2", [
        { type: "bold", start: 2, end: 3, value: true },
        {
          type: "link",
          start: 6,
          end: 8,
          value: "https://example.test/?a=1&b=2",
        },
        { type: "script", start: 9, end: 10, value: "superscript" },
      ]),
    );
  });

  it("applies text case after markup splitting while honoring rich-text case markers", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            content: {
              type: "text-case",
              form: "lower",
              unit: {
                value:
                  'The <i>QUICK <span class="nocase">DNA <b>Seq</b></span></i> and <span style="font-variant: small-caps;">RNA</span>',
              },
            },
          },
        ],
        bibliography: [],
      },
      contexts,
      "Test Style",
      "intext-citation",
    );

    assert.deepEqual(
      (result.citations as { content: unknown }[])[0].content,
      rich(`the quick DNA Seq and ʀɴᴀ`, [
        { type: "italic", start: 4, end: 17, value: true },
        { type: "bold", start: 14, end: 17, value: true },
      ]),
    );
  });

  it("turns textCase small-caps into text after markup normalization", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            content: {
              type: "text-case",
              form: "small-caps",
              unit: { value: "Mixed <i>Case</i>" },
            },
          },
        ],
        bibliography: [],
      },
      contexts,
      "Test Style",
      "intext-citation",
    );

    assert.deepEqual(
      (result.citations as { content: unknown }[])[0].content,
      rich(`ᴍɪxᴇᴅ ᴄᴀꜱᴇ`, [{ type: "italic", start: 6, end: 10, value: true }]),
    );
  });

  it("reports unmatched citation ids", function () {
    assert.throws(
      () =>
        normalizeGenerateResult(
          {
            citations: [{ id: "missing", content: "x" }],
            bibliography: [],
          },
          contexts,
          "Test Style",
          "intext-citation",
        ),
      /cannot be matched to input contexts/,
    );
  });

  it("asks the host to parse only when the content carries markup", function () {
    const asked: string[] = [];
    const normalize = createGenerateOutputNormalizer(() => (html: string) => {
      asked.push(html);
      return parseHtml(html);
    });

    normalize(
      { citations: [{ id: "ctx-1", content: "plain text" }], bibliography: [] },
      contexts,
      "Test Style",
      "intext-citation",
    );
    assert.isEmpty(asked);

    normalize(
      {
        citations: [{ id: "ctx-1", content: "a <i>b</i>" }],
        bibliography: [],
      },
      contexts,
      "Test Style",
      "intext-citation",
    );
    assert.lengthOf(asked, 1);
  });

  it("decodes entities without asking the host to parse", function () {
    assert.deepEqual(
      contentOf({ value: "Tom &amp; Jerry &lt;3 &nbsp;end" }),
      rich("Tom & Jerry <3 \u00a0end"),
    );
    assert.deepEqual(
      contentOf({ value: "A&mdash;B &#8212; C" }),
      rich("A\u2014B \u2014 C"),
    );
  });

  it("does not mistake prose for markup", function () {
    assert.deepEqual(
      contentOf({ value: "1 <b and 2 > 1" }),
      rich("1 <b and 2 > 1"),
    );
    assert.deepEqual(contentOf({ value: "a<b" }), rich("a<b"));
  });

  it("sanitizes a color collected from a style declaration", function () {
    assert.deepEqual(
      contentOf({
        type: "style",
        unit: { value: "x" },
        style: {
          color: "red;background:url(x)",
          backgroundColor: "yellow",
        },
      }),
      rich("x", [
        { type: "backgroundColor", start: 0, end: 1, value: "yellow" },
      ]),
    );
  });

  it("bounds a shared sub-unit that expands exponentially", function () {
    let node: unknown = { value: "x" };
    for (let level = 0; level < 6; level++) {
      node = {
        type: "group",
        units: Array.from({ length: 20 }, () => node),
        delimiter: "",
      };
    }

    assert.throws(
      () => normalizeUnitInput(node),
      /Unit tree expands beyond 20000 nodes/,
    );
  });

  it("takes a false branch whose unit is 0", function () {
    // `0` is a printable unit; a truthiness test would drop it.
    assert.deepEqual(
      contentOf({ type: "when", condition: false, trueUnit: "x", elseUnit: 0 }),
      rich("0"),
    );
    assert.deepEqual(
      contentOf({ type: "when", condition: true, trueUnit: 0 }),
      rich("0"),
    );
    assert.deepEqual(
      contentOf({ type: "affix", unit: 0, prefix: "(", suffix: ")" }),
      rich("(0)"),
    );
  });

  it("keeps mark ranges when a word-aware case transform changes length", function () {
    const content = contentOf({
      type: "text-case",
      form: "title",
      unit: rich("A  B", [{ type: "bold", start: 3, end: 4, value: true }]),
    });

    assert.deepEqual(
      content,
      rich("A B", [{ type: "bold", start: 2, end: 3, value: true }]),
    );
  });

  it("reports a cyclic unit tree as generate-output instead of overflowing", function () {
    const cyclic: Record<string, unknown> = { type: "group", units: [] };
    (cyclic.units as unknown[]).push(cyclic);

    try {
      contentOf(cyclic);
      assert.fail("expected a cyclic unit to be rejected");
    } catch (error) {
      const record = error as { code?: unknown; message?: unknown };
      assert.equal(record.code, "generate-output");
      assert.match(String(record.message), /cycle/);
    }
  });

  it("reports a host that cannot parse markup", function () {
    const normalize = createGenerateOutputNormalizer();

    assert.throws(
      () =>
        normalize(
          {
            citations: [{ id: "ctx-1", content: "a <i>b</i>" }],
            bibliography: [],
          },
          contexts,
          "Test Style",
          "intext-citation",
        ),
      /does not provide the "parseHtml" capability/,
    );
  });

  it("attributes over-deep markup to the style, not the host parser", function () {
    const deep = `${"<b>".repeat(150)}x${"</b>".repeat(150)}`;

    try {
      contentOf({ value: deep });
      assert.fail("expected deep markup to be rejected");
    } catch (error) {
      const record = error as { code?: unknown; sourcePath?: unknown };
      assert.equal(record.code, "generate-output");
      assert.equal(record.sourcePath, "citations[0].content");
    }
  });

  it("keeps a frozen host error when the field path cannot be attached", function () {
    const frozen = Object.freeze(
      Object.assign(new Error("frozen parser failure"), {
        code: "host-capability" as const,
      }),
    );
    const normalize = createGenerateOutputNormalizer(() => () => {
      throw frozen;
    });

    try {
      normalize(
        {
          citations: [{ id: "ctx-1", content: "a <i>b</i>" }],
          bibliography: [],
        },
        contexts,
        "Test Style",
        "intext-citation",
      );
      assert.fail("expected the host error to propagate");
    } catch (error) {
      assert.strictEqual(error, frozen);
      assert.equal((error as { code?: unknown }).code, "host-capability");
      assert.match((error as Error).message, /frozen parser failure/);
      assert.isUndefined((error as { sourcePath?: unknown }).sourcePath);
    }
  });

  it("reports a host whose parser returns no element root", function () {
    const normalize = createGenerateOutputNormalizer(() => () => null);

    assert.throws(
      () =>
        normalize(
          {
            citations: [{ id: "ctx-1", content: "a <i>b</i>" }],
            bibliography: [],
          },
          contexts,
          "Test Style",
          "intext-citation",
        ),
      /did not return an element-like root/,
    );
  });
});
