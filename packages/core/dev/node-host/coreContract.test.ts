import { assert } from "chai";
import { DOMParser } from "linkedom";
import { createStyle } from "../../src/sandbox/createStyle";
import type { StyleMessage } from "../../src/messages";
import type { HtmlRootLike, StyleHostCapabilities } from "../../src/host";
import { assertHostCapabilities } from "../../src/host";
import type { RuntimeCode } from "../../src/sandbox/runtimeErrors";
import { renderRichTextToHtml } from "../../src/richText/render";
import type { CitationContext, ScriptItem } from "../../src/types/style";
import type { RichText } from "../../src/types/unit";
import {
  resolveCitationParamValues,
  resolveStyleOptionState,
} from "../../src/validation/paramValues";
import { createNodeHost, createNodeSandboxRuntime } from "./runtime";

/**
 * Core contract tests: no Zotero, no DOM, no host framework — only the core
 * plus the Node host binding. They cover the full chain, the documented
 * degradation paths, and the two mechanisms (readiness gate, helper ledger).
 */

const INFO = `
  const INFO = {
    id: "probe",
    title: "Probe",
    description: "",
    citationType: "intext-citation",
    creator: [],
    tags: [],
    documentation: [],
    license: "MIT",
    updated: "2026-01-01",
  };
`;

const contexts: CitationContext[] = [
  {
    id: "ctx-1",
    page: 1,
    cites: [
      {
        item: {
          id: "1",
          itemType: "book",
          title: "A title",
          creators: [
            { creatorType: "author", firstName: "", lastName: "Smith" },
          ],
          extra: { type: "classic" },
        },
        params: {},
      },
    ],
    params: {},
  },
];

function hostWith(capabilities: Partial<StyleHostCapabilities> = {}) {
  return createNodeHost(capabilities);
}

const HTML_ROOT_ID = "__banyan_contract_root__";

/** Host-side markup parser backed by `linkedom`, so contract tests need no Zotero. */
function parseHtml(html: string): HtmlRootLike | null {
  const document = new DOMParser().parseFromString(
    `<div id="${HTML_ROOT_ID}">${html}</div>`,
    "text/html",
  );
  return document.getElementById(
    HTML_ROOT_ID,
  ) as unknown as HtmlRootLike | null;
}

/**
 * chai 5's assert has no `rejects`, so async failures are checked by hand. The
 * `code` is asserted as well as the message: it is the mechanical contract a
 * host branches on, and a message alone would let it disappear unnoticed.
 */
async function assertThrowsAsync(
  promise: Promise<unknown>,
  expected: { code: RuntimeCode; pattern?: RegExp },
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const record = error as { code?: unknown; message?: unknown } | null;
    assert.equal(record?.code, expected.code);
    if (expected.pattern) {
      const message =
        record && typeof record.message === "string"
          ? record.message
          : String(error);
      assert.match(message, expected.pattern);
    }
    return;
  }
  assert.fail("expected the promise to reject");
}

describe("core contract (Node host)", function () {
  it("loads a style and generates through the host bridge", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      function generate() {
        return {
          citations: contexts.map((context) => ({
            id: context.id,
            content: group([
              text(context.cites[0].item.creators[0].lastName),
              " (",
              text(context.cites[0].item.title),
              ")",
            ]),
          })),
          bibliography: [
            { id: "ctx-1", type: "bibliography-entry", content: text(contexts[0].cites[0].item.title) },
          ],
        };
      }
      `,
    );

    const result = await style.generate(contexts);
    const citation = (result.citations as { content: { text: string } }[])[0];
    assert.equal(citation.content.text, "Smith (A title)");
    assert.equal(
      (result.bibliography[0] as { content: { text: string } }).content.text,
      "A title",
    );
    assert.equal(style.INFO.title, "Probe");
  });

  it("exposes style parameters and passes the options global to generate", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      const STYLE_OPTIONS = [
        {
          id: "mode",
          kind: "state",
          label: "Mode",
          states: { auto: "Auto", full: "Full" },
          defaultValue: "auto",
        },
      ];
      function generate() {
        return {
          citations: [
            { id: "ctx-1", content: text(String(options.mode || "none")) },
          ],
          bibliography: [],
        };
      }
      `,
    );

    assert.equal(style.STYLE_OPTIONS?.[0]?.id, "mode");
    const auto = await style.generate(contexts, { mode: "auto" });
    assert.equal(
      (auto.citations[0] as { content: { text: string } }).content.text,
      "auto",
    );
    const full = await style.generate(contexts, { mode: "full" });
    assert.equal(
      (full.citations[0] as { content: { text: string } }).content.text,
      "full",
    );
  });

  it("runs validators inside the sandbox and skips them during generate", async function () {
    const style = await createStyle(
      hostWith({ parseHtml }),
      `
      ${INFO}
      const STYLE_OPTIONS = [
        {
          id: "prefix",
          kind: "value",
          label: "Prefix",
          defaultValue: "",
          validate: (value) => {
            console.warn("validator ran for " + value);
            const canonical = unitToHtml(htmlToUnit(value));
            return canonical.includes("&lt;")
              ? "unbalanced markup becomes " + canonical
              : true;
          },
        },
      ];
      function generate() {
        return {
          citations: [
            { id: "ctx-1", content: text(options.prefix || "empty") },
          ],
          bibliography: [],
        };
      }
      `,
    );

    const valid = resolveStyleOptionState(style.STYLE_OPTIONS, {
      prefix: "<b>x</b>",
    });
    assert.deepEqual(valid.states.prefix?.validation, { valid: true });

    const invalid = resolveStyleOptionState(style.STYLE_OPTIONS, {
      prefix: "<b>x",
    });
    assert.isFalse(invalid.states.prefix?.validation?.valid);
    assert.match(
      invalid.states.prefix?.validation?.message ?? "",
      /unbalanced markup becomes/,
    );

    // Generate resolves the same parameter but must not invoke validate.
    const result = await style.generate(contexts, { prefix: "<i>y</i>" });
    assert.equal(
      (result.citations[0] as { content: { text: string } }).content.text,
      "y",
    );
    assert.isFalse(
      style.diagnostics.some((message) =>
        message.message.includes("validator ran for <i>y</i>"),
      ),
    );
  });

  it("consumes async parameter-callback rejections instead of leaking them", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      const CITATION_PARAMS = [{
        id: "p",
        kind: "value",
        label: "P",
        applicable: async () => { throw new Error("async applicable"); },
        forcedValue: async () => { throw new Error("async forcedValue"); },
        validate: async () => { throw new Error("async validate"); },
      }];
      function generate() {
        return { citations: [{ id: "ctx-1", content: "x" }], bibliography: [] };
      }
      `,
    );

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const resolved = resolveCitationParamValues(
        style.CITATION_PARAMS,
        contexts[0] as CitationContext,
        {},
        { validate: true },
      );
      // Give every drained promise a turn to settle before checking.
      await new Promise((resolve) => setTimeout(resolve, 25));

      assert.deepEqual(rejections, []);
      // Applicability and forced values fail open; validation reports the
      // contract mistake instead of silently turning it into `false`.
      assert.equal(resolved.states.p?.mode, "free");
      assert.match(
        resolved.states.p?.validation?.message ?? "",
        /must return synchronously/,
      );
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("resolves defaults and forced values before generate runs", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      const STYLE_OPTIONS = [
        {
          id: "mode",
          kind: "state",
          label: "Mode",
          states: { auto: "Auto", full: "Full" },
          defaultValue: "auto",
        },
        {
          id: "form",
          kind: "state",
          label: "Form",
          states: { short: "Short", long: "Long" },
          defaultValue: "short",
          forcedValue: (values) => values.mode === "full" ? "short" : null,
        },
        {
          id: "maxNames",
          kind: "value",
          label: "Max names",
          defaultValue: "3",
        },
      ];
      function generate() {
        return {
          citations: [
            {
              id: "ctx-1",
              content: [options.mode, options.form, options.maxNames].join("|"),
            },
          ],
          bibliography: [],
        };
      }
      `,
    );

    const textOf = async (options?: Record<string, string>) => {
      const result = await style.generate(contexts, options);
      return (result.citations as { content: { text: string } }[])[0].content
        .text;
    };

    // No stored values: the declared defaults are what the style reads.
    assert.equal(await textOf(), "auto|short|3");
    // A forced option overrides the stored value without changing it.
    assert.equal(await textOf({ mode: "full", form: "long" }), "full|short|3");
    assert.equal(await textOf({ form: "long" }), "auto|long|3");
    // Invalid stored values fall back instead of leaking through.
    assert.equal(
      await textOf({ mode: "bogus", maxNames: "9" }),
      "auto|short|9",
    );
  });

  it("resolves citation/cite params and keeps stored values in the output source", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      const CITATION_PARAMS = [
        {
          id: "header",
          kind: "value",
          label: "Header",
          defaultValue: "default-header",
        },
      ];
      const CITE_PARAMS = [
        {
          id: "page",
          kind: "value",
          label: "Page",
          defaultValue: "default-page",
        },
        {
          id: "detail",
          kind: "value",
          label: "Detail",
          defaultValue: "default-detail",
          forcedValue: (cite) => cite.item.itemType === "book" ? "book-detail" : null,
        },
      ];
      function generate() {
        const cite = contexts[0].cites[0];
        return {
          citations: [{
            id: "ctx-1",
            content: [
              contexts[0].params.header,
              cite.params.page,
              cite.params.detail,
            ].join("|"),
          }],
          bibliography: [],
        };
      }
      `,
    );

    const context: CitationContext = {
      id: "ctx-1",
      page: 1,
      cites: [
        {
          item: { id: "1", itemType: "book", title: "A title" } as never,
          params: {},
        },
      ],
      params: {},
    };
    const result = await style.generate([context], {});
    assert.equal(
      (result.citations[0] as { content: { text: string } }).content.text,
      "default-header|default-page|book-detail",
    );
    assert.deepEqual(result.citations[0]!.source.params, {});
    assert.deepEqual(result.citations[0]!.source.cites[0]!.params, {});
  });

  it("attributes findings from parameter callbacks to the generate run", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      const STYLE_OPTIONS = [
        {
          id: "mode",
          kind: "value",
          label: "Mode",
          defaultValue: "x",
          forcedValue: () => {
            console.warn("resolving option");
            return null;
          },
        },
      ];
      function generate() {
        return {
          citations: [{ id: contexts[0].id, content: "ok" }],
          bibliography: [],
        };
      }
      `,
    );

    await style.generate(contexts);

    const finding = style.diagnostics.find(
      (diagnostic) => diagnostic.message === "resolving option",
    );
    assert.isDefined(finding);
    assert.equal(finding?.code, "generate");
  });

  it("bridges rich markup and Units in both directions", async function () {
    const style = await createStyle(
      hostWith({ parseHtml: parseHtml as never }),
      `
      ${INFO}
      function generate() {
        const unit = htmlToUnit("<b>Hello</b> <i>world</i>");
        const markup = unitToHtml(group([unit, "]"]));
        return {
          citations: [{ id: "ctx-1", content: markup }],
          bibliography: [],
        };
      }
      `,
    );

    const result = await style.generate(contexts);
    const content = (
      result.citations as {
        content: { text: string; marks: readonly Record<string, unknown>[] };
      }[]
    )[0].content;
    assert.equal(content.text, "Hello world]");
    assert.deepEqual(content.marks, [
      { type: "bold", start: 0, end: 5, value: true },
      { type: "italic", start: 6, end: 11, value: true },
    ]);
  });

  it("keeps the sandbox free of host globals and of the bridge object", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      function generate() {
        const probe = [
          typeof Zotero,
          typeof document,
          typeof window,
          typeof fetch,
          typeof __banyanHostUtils__,
          typeof readText,
        ].join(",");
        return { citations: [{ id: "ctx-1", content: probe }], bibliography: [] };
      }
      `,
    );

    const result = await style.generate(contexts);
    const content = (result.citations as { content: { text: string } }[])[0]
      .content;
    assert.equal(
      content.text,
      "undefined,undefined,undefined,undefined,undefined,function",
    );
  });

  it("exposes contexts as a readonly, undefined-free view", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      function generate() {
        const item = contexts[0].cites[0].item;
        const missing = item.notAField;
        let refused = false;
        try {
          contexts[0].id = "changed";
        } catch {
          refused = true;
        }
        return {
          citations: [
            {
              id: "ctx-1",
              content: [missing === "" ? "empty" : "value", String(refused), String(contexts[0].id)].join("|"),
            },
          ],
          bibliography: [],
        };
      }
      `,
    );

    const result = await style.generate(contexts);
    const content = (result.citations as { content: { text: string } }[])[0]
      .content;
    assert.equal(content.text, "empty|true|ctx-1");
  });

  it("decodes entity text without needing a parseHtml capability", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      function generate() {
        return {
          citations: [{ id: "ctx-1", content: "H2O &amp; CO2" }],
          bibliography: [],
        };
      }
      `,
    );

    const result = await style.generate(contexts);
    const content = (result.citations as { content: RichText }[])[0].content;
    assert.equal(content.text, "H2O & CO2");
    assert.deepEqual(content.marks, []);
  });

  it("fails loudly without parseHtml when content contains markup", async function () {
    // Markup parsing is a contract capability: leaving it unparsed would render
    // differently from a host that parses it, so the core reports instead.
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      function generate() {
        return {
          citations: [
            { id: "ctx-1", content: "H<sub>2</sub>O &amp; CO<sup>2</sup>" },
          ],
          bibliography: [],
        };
      }
      `,
    );

    await assertThrowsAsync(style.generate(contexts), {
      code: "host-capability",
      pattern: /does not provide the "parseHtml" capability/,
    });
  });

  it("fails loudly when parseHtml cannot return a root", async function () {
    // `null` and a malformed value both mean "markup was not parsed", which the
    // core must not accept: it would render differently from a parsing host.
    for (const unusable of [null, { nope: true }]) {
      const style = await createStyle(
        hostWith({ parseHtml: (() => unusable) as never }),
        `
        ${INFO}
        function generate() {
          return { citations: [{ id: "ctx-1", content: "<i>x</i>" }], bibliography: [] };
        }
        `,
      );

      await assertThrowsAsync(style.generate(contexts), {
        code: "host-capability",
        pattern: /did not return an element-like root/,
      });
    }
  });

  it("degrades without readFile: the read utilities name the missing ability", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      async function generate() {
        let message = "";
        try {
          await readText("styles/anything.json");
        } catch (error) {
          message = error && error.message ? error.message : String(error);
        }
        return { citations: [{ id: "ctx-1", content: message }], bibliography: [] };
      }
      `,
    );

    const result = await style.generate(contexts);
    const content = (result.citations as { content: { text: string } }[])[0]
      .content;
    assert.match(
      content.text,
      /does not provide the "readFile" capability; readText is unavailable/,
    );
  });

  it("hands the multilingual capability a host-owned item", async function () {
    let seen: ScriptItem | undefined;
    const style = await createStyle(
      hostWith({
        resolveMultilingualItems: async (item) => {
          seen = item;
          return [{ ...item, id: "2", title: "Sibling" }];
        },
      }),
      `
      ${INFO}
      async function generate() {
        const item = contexts[0].cites[0].item;
        const group = await getMultilingualItems(item);
        return {
          citations: [
            {
              id: "ctx-1",
              content: group.map((entry) => entry.id).join(","),
            },
          ],
          bibliography: [],
        };
      }
      `,
    );

    const result = await style.generate(contexts);
    assert.equal(
      (result.citations[0] as { content: { text: string } }).content.text,
      "2",
    );
    assert.equal(seen?.id, "1");
    assert.equal(seen?.itemType, "book");
  });

  it("fails loudly without resolveMultilingualItems: the multilingual utilities are unavailable", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      async function generate() {
        const item = contexts[0].cites[0].item;
        const group = await getMultilingualItems(item);
        const picked = await getMultilingualItem(item, "zh");
        return {
          citations: [
            { id: "ctx-1", content: String(group.length) + "|" + String(picked.id) },
          ],
          bibliography: [],
        };
      }
      `,
    );

    await assertThrowsAsync(style.generate(contexts), {
      code: "host-capability",
      pattern:
        /does not provide the "resolveMultilingualItems" capability; getMultilingualItems is unavailable/,
    });
  });

  it("applies the core's own text-case regardless of the host", async function () {
    // Text-case is intentionally not a host capability: a style must render the
    // same text everywhere, so no capability can influence it.
    const code = `
      ${INFO}
      function generate() {
        return {
          citations: [{ id: "ctx-1", content: textCase("a title", "title") }],
          bibliography: [],
        };
      }
      `;

    const plainHost = await createStyle(hostWith(), code);
    const otherHost = await createStyle(
      hostWith({ parseHtml: () => null }),
      code,
    );

    const titles = await Promise.all(
      [plainHost, otherHost].map(async (style) => {
        const result = await style.generate(contexts);
        return (result.citations as { content: { text: string } }[])[0].content
          .text;
      }),
    );

    assert.deepEqual(titles, ["A Title", "A Title"]);
  });

  it("serializes concurrent generations on one style instance", async function () {
    // One context per style: without serialization the second call would
    // overwrite the first call's `contexts` global while it is suspended.
    const host = hostWith({
      readFile: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new TextEncoder().encode("x");
      },
    });
    const style = await createStyle(
      host,
      `
      ${INFO}
      async function generate() {
        const id = contexts[0].id;
        await readText("slow.txt");
        return { citations: [{ id: id, content: contexts[0].id }], bibliography: [] };
      }
      `,
    );

    const contextsFor = (id: string): CitationContext[] => [
      {
        id,
        page: 1,
        cites: [
          {
            item: {
              id: "1",
              itemType: "book",
              title: `Title ${id}`,
              creators: [
                { creatorType: "author", firstName: "", lastName: "Smith" },
              ],
              extra: {},
            },
            params: {},
          },
        ],
        params: {},
      },
    ];

    const results = await Promise.all([
      style.generate(contextsFor("a")),
      style.generate(contextsFor("b")),
    ]);

    assert.deepEqual(
      results.map(
        (result) =>
          (result.citations as { content: { text: string } }[])[0].content.text,
      ),
      ["a", "b"],
    );
  });

  it("keeps generating after a rejected generation", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      async function generate() {
        const id = contexts[0].id;
        if (id === "boom") throw new Error("style failed");
        return { citations: [{ id: id, content: id }], bibliography: [] };
      }
      `,
    );

    const failing = style.generate([
      {
        id: "boom",
        page: 1,
        cites: [
          {
            item: {
              id: "2",
              itemType: "book",
              title: "T",
              creators: [],
              extra: {},
            },
            params: {},
          },
        ],
        params: {},
      },
    ]);
    await assertThrowsAsync(failing, {
      code: "generate",
      pattern: /style failed/,
    });

    const result = await style.generate(contexts);
    assert.equal(
      (result.citations as { content: { text: string } }[])[0].content.text,
      "ctx-1",
    );
  });

  it("times out an async generate and still serves the next run", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      let runs = 0;
      function generate() {
        runs += 1;
        if (runs === 1) return new Promise(() => {});
        return {
          citations: [{ id: contexts[0].id, content: "after timeout" }],
          bibliography: [],
        };
      }
      `,
      { generateTimeoutMs: 20 },
    );

    await assertThrowsAsync(style.generate(contexts), {
      code: "generate-timeout",
      pattern: /exceeded 20 ms/,
    });

    // The queue was released and the next run is unaffected.
    const result = await style.generate(contexts);
    assert.equal(
      (result.citations as { content: { text: string } }[])[0].content.text,
      "after timeout",
    );
  });

  it("applies the optional evaluate budget to style load", async function () {
    await assertThrowsAsync(
      createStyle(
        hostWith(),
        `
        const INFO = {};
        while (true) {}
        function generate() { return { citations: [], bibliography: [] }; }
        `,
        { evaluateTimeoutMs: 20 },
      ),
      { code: "style-load", pattern: /timed out/i },
    );
  });

  it("applies the optional evaluate budget to a synchronous generate", async function () {
    const style = await createStyle(
      hostWith(),
      `
      ${INFO}
      function generate() {
        while (true) {}
      }
      `,
      { evaluateTimeoutMs: 20 },
    );

    await assertThrowsAsync(style.generate(contexts), {
      code: "generate",
      pattern: /timed out/i,
    });
  });

  it("clones sandbox data into host-owned objects", function () {
    const context = createNodeSandboxRuntime().createContext();
    const raw = context.evaluate(
      "({ nested: { value: 1 }, list: [1, 2] })",
    ) as {
      nested: object;
      list: object;
    };
    const cloned = context.cloneToHost(raw) as typeof raw;

    assert.strictEqual(Object.getPrototypeOf(cloned), Object.prototype);
    assert.notStrictEqual(
      Object.getPrototypeOf(cloned),
      Object.getPrototypeOf(raw),
      "a clone must not keep the sandbox realm's prototype",
    );
    assert.strictEqual(Object.getPrototypeOf(cloned.nested), Object.prototype);
    assert.strictEqual(Object.getPrototypeOf(cloned.list), Array.prototype);
    assert.deepEqual(cloned.list, [1, 2]);
  });

  it("passes binary values through as realm-native typed arrays", async function () {
    const bytes = [65, 66, 67];
    const host = hostWith({
      readFile: async () => new Uint8Array(bytes),
    });
    const style = await createStyle(
      host,
      `
      ${INFO}
      async function generate() {
        const data = await readBytes("x.bin");
        const view = new DataView(await readBytes("y.bin").then((b) => b.buffer));
        return {
          citations: [
            {
              id: "ctx-1",
              content: [
                data instanceof Uint8Array ? "Uint8Array" : typeof data,
                String(data),
                data.length,
                view instanceof DataView ? "DataView" : typeof view,
              ].join("|"),
            },
          ],
          bibliography: [],
        };
      }
      `,
    );

    const result = await style.generate(contexts);
    assert.equal(
      (result.citations as { content: { text: string } }[])[0].content.text,
      "Uint8Array|65,66,67|3|DataView",
    );
  });

  it("accepts capabilities attached after the style was created", async function () {
    const host = hostWith();
    const style = await createStyle(
      host,
      `
      ${INFO}
      async function generate() {
        return { citations: [{ id: "ctx-1", content: await readText("late.txt") }], bibliography: [] };
      }
      `,
    );

    // Late binding: the host may attach a capability after the style exists.
    host.capabilities = {
      readFile: async () => new TextEncoder().encode("late"),
    };

    const result = await style.generate(contexts);
    assert.equal(
      (result.citations as { content: { text: string } }[])[0].content.text,
      "late",
    );
  });

  it("offers a style's console output to a sink, and keeps findings without one", async function () {
    const code = `
      ${INFO}
      function generate() {
        console.log("from-sink", { n: 1 });
        console.warn("worth keeping");
        return { citations: [{ id: "ctx-1", content: "ok" }], bibliography: [] };
      }
      `;

    const seen: StyleMessage[] = [];
    const style = await createStyle(hostWith(), code, {
      messageSink: (message) => seen.push(message),
    });
    await style.generate(contexts);

    assert.deepEqual(
      seen.map((message) => [message.severity, message.message]),
      [
        ["trace", 'from-sink {"n":1}'],
        ["warning", "worth keeping"],
      ],
    );
    assert.equal(seen[0].source, "style");
    assert.equal(seen[0].code, "generate");

    // No sink at all: the findings are still readable, the trace is not.
    const quiet = await createStyle(hostWith(), code);
    await quiet.generate(contexts);
    assert.deepEqual(
      quiet.diagnostics.map((message) => [message.severity, message.message]),
      [["warning", "worth keeping"]],
    );

    // A failing sink must not break the style run.
    const throwing = await createStyle(hostWith(), code, {
      messageSink: () => {
        throw new Error("sink failed");
      },
    });
    const result = await throwing.generate(contexts);
    assert.equal(
      (result.citations as { content: { text: string } }[])[0].content.text,
      "ok",
    );
  });

  it("settles findings per run: the load's stay, a run's are replaced", async function () {
    const code = `
      ${INFO}
      const ITEM_FIELD_PRESETS = [{ id: "", label: "x", fields: {} }];
      function generate() {
        console.warn("run warning");
        return { citations: [{ id: "ctx-1", content: "ok" }], bibliography: [] };
      }
      `;

    const style = await createStyle(hostWith(), code);
    const loadFindings = style.diagnostics.map(
      (message) => `${message.code}: ${message.message}`,
    );
    assert.deepEqual(loadFindings, [
      "style-load: skipped entry without a non-empty string id",
    ]);

    await style.generate(contexts);
    assert.deepEqual(
      style.diagnostics.map((message) => `${message.code}: ${message.message}`),
      [
        "style-load: skipped entry without a non-empty string id",
        "generate: run warning",
      ],
    );

    // The next run replaces its own findings instead of piling up.
    await style.generate(contexts);
    assert.deepEqual(
      style.diagnostics.map((message) => `${message.code}: ${message.message}`),
      [
        "style-load: skipped entry without a non-empty string id",
        "generate: run warning",
      ],
    );
  });

  it("refuses to let a style replace a sandbox utility", async function () {
    // The utility table is installed non-writable and non-configurable, so the
    // attempt fails while the script is evaluated instead of silently swapping
    // a utility out.
    await assertThrowsAsync(
      createStyle(
        hostWith(),
        `${INFO}
         globalThis.uuid = "overwritten";
         function generate() {
           return { citations: [], bibliography: [] };
         }`,
      ),
      { code: "style-load", pattern: /Failed to evaluate style script/ },
    );
  });

  it("maps the style's console calls to severities a host can route", async function () {
    const seen: Array<[string, string]> = [];
    const code = `
      ${INFO}
      function generate() {
        console.debug("debug line");
        console.log("log line");
        console.trace("trace line");
        console.info("info line");
        console.warn("warn line", { key: "extra" });
        console.error("error line");
        console.assert(true, "not reported");
        console.assert(false, "assertion detail");
        return { citations: [{ id: "ctx-1", content: "ok" }], bibliography: [] };
      }
      `;

    const style = await createStyle(hostWith(), code, {
      messageSink: (message) => seen.push([message.severity, message.message]),
    });
    await style.generate(contexts);

    assert.deepEqual(seen, [
      ["trace", "debug line"],
      ["trace", "log line"],
      ["trace", "trace line"],
      ["info", "info line"],
      ["warning", 'warn line {"key":"extra"}'],
      ["error", "error line"],
      ["error", "Assertion failed assertion detail"],
    ]);

    // Findings come back with the style; trace lines never do.
    assert.deepEqual(
      style.diagnostics.map((message) => message.severity),
      ["info", "warning", "error", "error"],
    );
    assert.isTrue(
      style.diagnostics.every((message) => message.source === "style"),
    );
  });

  it("attributes findings to the style and the declaration that produced them", async function () {
    const code = `
      ${INFO}
      const STYLE_OPTIONS = [
        { id: "mode", kind: "state", label: "Mode", validate: () => true },
      ];
      const ITEM_FIELD_PRESETS = [{ fields: {} }];
      function generate() {
        return { citations: [], bibliography: [] };
      }
    `;

    const style = await createStyle(hostWith(), code);
    const byMessage = (pattern: RegExp) =>
      style.diagnostics.find((message) => pattern.test(message.message));

    const option = byMessage(/validate is not available on state parameters/);
    assert.deepEqual(option?.detail, {
      style: { id: "probe", title: "Probe" },
      declaration: { export: "STYLE_OPTIONS", id: "mode", index: 0 },
    });

    const preset = byMessage(/skipped entry without a non-empty string id/);
    assert.deepEqual(preset?.detail, {
      style: { id: "probe", title: "Probe" },
      declaration: { export: "ITEM_FIELD_PRESETS", index: 0 },
    });
  });

  it("lets a style complain without aborting the run", async function () {
    const code = `
      ${INFO}
      function generate() {
        console.warn("missing field");
        return { citations: [{ id: "ctx-1", content: "kept" }], bibliography: [] };
      }
      `;

    const style = await createStyle(hostWith(), code);
    const result = await style.generate(contexts);

    assert.equal(
      (result.citations as { content: { text: string } }[])[0].content.text,
      "kept",
    );
    assert.deepEqual(
      style.diagnostics.map((message) => [message.severity, message.code]),
      [["warning", "generate"]],
    );
  });

  it("keeps the silent console methods callable", async function () {
    const code = `
      ${INFO}
      function generate() {
        console.count("x");
        console.countReset("x");
        console.group("g");
        console.groupEnd();
        console.time("t");
        console.timeLog("t");
        console.timeEnd("t");
        console.clear();
        console.dir({ a: 1 });
        console.table([{ a: 1 }]);
        return { citations: [{ id: "ctx-1", content: "ok" }], bibliography: [] };
      }
      `;

    const style = await createStyle(hostWith(), code);

    await style.generate(contexts);
  });

  it("attributes a style's own failure to the generate code", async function () {
    const code = `
      ${INFO}
      function generate() {
        throw new Error("style blew up");
      }
      `;

    const style = await createStyle(hostWith(), code);

    try {
      await style.generate(contexts);
      assert.fail("expected the run to fail");
    } catch (error) {
      assert.equal((error as { code?: unknown }).code, "generate");
      assert.match((error as Error).message, /style blew up/);
    }
  });

  it("attributes a contract failure to the load code, not to a run", async function () {
    try {
      await createStyle(hostWith(), "const INFO = {};");
      assert.fail("expected the style to be rejected");
    } catch (error) {
      assert.equal((error as { code?: unknown }).code, "style-contract");
    }
  });

  it("collects field-preset advisories as diagnostics", async function () {
    const code = `
      ${INFO}
      const ITEM_FIELD_PRESETS = [
        { id: "classic", label: 42, fields: { type: "classic", "citation.key": "x" } },
      ];
      function generate() {
        return { citations: [{ id: "ctx-1", content: "ok" }], bibliography: [] };
      }
      `;

    const style = await createStyle(hostWith(), code);
    const messages = style.diagnostics.map(
      (diagnostic) => `[${diagnostic.source}] ${diagnostic.message}`,
    );

    assert.include(
      messages,
      "[field-presets] 'classic': label must be a string; using the preset id",
    );
    assert.include(
      messages,
      "[field-presets] preset 'classic': 'citation.key' is not a valid field key; ignored",
    );
    assert.isTrue(
      style.diagnostics.every(
        (diagnostic) => diagnostic.severity === "warning",
      ),
    );
  });

  it("rejects a malformed context array before the style runs", async function () {
    const style = await createStyle(
      hostWith(),
      `${INFO}
       function generate() {
         return { citations: [], bibliography: [] };
       }`,
    );

    const cases: Array<[string, unknown, RegExp]> = [
      ["not an array", {}, /expects an array of contexts/],
      [
        "entry without id",
        [{ page: 1, cites: [] }],
        /contexts\[0\] without a non-empty string id/,
      ],
      [
        "entry with empty id",
        [{ id: "  ", page: 1, cites: [] }],
        /contexts\[0\] without a non-empty string id/,
      ],
      [
        "duplicate ids",
        [
          { id: "dup", page: 1, cites: [] },
          { id: "dup", page: 2, cites: [] },
        ],
        /duplicate context id "dup"/,
      ],
      [
        "missing page",
        [{ id: "ctx-1", cites: [] }],
        /without a finite number page/,
      ],
      [
        "entry without cites",
        [{ id: "ctx-1", page: 1 }],
        /contexts\[0\]\.cites that is not an array/,
      ],
      [
        "params that is not an object",
        [{ id: "ctx-1", page: 1, cites: [], params: 3 }],
        /contexts\[0\]\.params that is not an object/,
      ],
    ];

    for (const [label, value, pattern] of cases) {
      await assertThrowsAsync(style.generate(value as never), {
        code: "generate-input",
        pattern,
      }).catch((error: unknown) => {
        assert.fail(`${label}: ${String(error)}`);
      });
    }
  });

  it("names every required capability a host did not provide", function () {
    try {
      assertHostCapabilities({ readFile: async () => new Uint8Array() });
      assert.fail("expected the incomplete host to be rejected");
    } catch (error) {
      assert.equal((error as { code?: unknown }).code, "host-capability");
      assert.match(
        (error as Error).message,
        /"parseHtml", "resolveMultilingualItems"/,
      );
    }
    assert.doesNotThrow(() =>
      assertHostCapabilities({
        parseHtml: () => null,
        readFile: async () => new Uint8Array(),
        resolveMultilingualItems: async () => [],
      }),
    );
  });

  it("reports a failing capability implementation as host-capability", async function () {
    const style = await createStyle(
      hostWith({
        readFile: async () => {
          throw new Error("disk on fire");
        },
      }),
      `${INFO}
       async function generate() {
         await readText("anything.txt");
         return { citations: [], bibliography: [] };
       }`,
    );

    await assertThrowsAsync(style.generate(contexts), {
      code: "host-capability",
      pattern: /disk on fire/,
    });
  });

  it("keeps rich value parameters as markup strings", async function () {
    const style = await createStyle(
      hostWith(),
      `${INFO}
       const CITE_PARAMS = [
         {
           id: "comment",
           kind: "value",
           label: "Comment",
           format: "rich",
           defaultValue: "<em>See</em>",
         },
       ];
       function generate() {
         return { citations: [{ id: "ctx-1", content: "ok" }], bibliography: [] };
       }`,
    );

    const param = style.CITE_PARAMS?.[0] as
      { kind: string; format?: string; defaultValue: string } | undefined;
    assert.equal(param?.kind, "value");
    assert.equal(param?.format, "rich");
    assert.equal(param?.defaultValue, "<em>See</em>");
  });

  it("runs the readiness gate before creating a context", async function () {
    const host = hostWith();
    let contextsCreated = 0;
    let gateCalled = 0;
    host.runtime = {
      createContext: (options) => {
        contextsCreated += 1;
        return createNodeHost().runtime.createContext(options);
      },
    };
    host.assertReady = () => {
      gateCalled += 1;
    };

    const style = await createStyle(
      host,
      `${INFO}
       function generate() {
         return { citations: [{ id: "ctx-1", content: "ok" }], bibliography: [] };
       }`,
    );
    await style.generate(contexts);

    assert.equal(gateCalled, 1);
    assert.equal(contextsCreated, 1);

    const refusingHost = hostWith();
    refusingHost.assertReady = () => {
      throw new Error("host is not ready");
    };
    let failed = "";
    try {
      await createStyle(refusingHost, `${INFO}\nfunction generate() {}`);
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    }
    assert.equal(failed, "host is not ready");
  });

  it("rejects a style that misses the contract", async function () {
    await assertThrowsAsync(
      createStyle(hostWith(), "const INFO = undefined;"),
      {
        code: "style-contract",
        pattern: /INFO/,
      },
    );
  });

  it("rejects a style without generate at load time", async function () {
    await assertThrowsAsync(createStyle(hostWith(), `${INFO}`), {
      code: "style-contract",
      pattern: /must define a top-level function generate/,
    });
  });

  it("does not accept a style object as a second export shape", async function () {
    await assertThrowsAsync(
      createStyle(
        hostWith(),
        `${INFO}
         const style = {
           generate() {
             return { citations: [], bibliography: [] };
           },
         };`,
      ),
      {
        code: "style-contract",
        pattern: /must define a top-level function generate/,
      },
    );
  });

  it("reports a generate() without a return value as generate-output", async function () {
    const style = await createStyle(
      hostWith(),
      `${INFO}
       function generate() {}`,
    );

    await assertThrowsAsync(style.generate(contexts), {
      code: "generate-output",
      pattern: /has no return value/,
    });
  });

  it("reports a throwing parseHtml as host-capability", async function () {
    const style = await createStyle(
      hostWith({
        parseHtml: () => {
          throw new Error("parser exploded");
        },
      }),
      `${INFO}
       function generate() {
         return {
           citations: [{ id: "ctx-1", content: "<i>x</i>" }],
           bibliography: [],
         };
       }`,
    );

    await assertThrowsAsync(style.generate(contexts), {
      code: "host-capability",
      pattern: /parser exploded/,
    });
  });

  it("renders the default HTML implementation deterministically", function () {
    const html = renderRichTextToHtml({
      text: "Smith (2024)",
      marks: [
        { type: "italic", start: 0, end: 5, value: true },
        { type: "link", start: 6, end: 12, value: "https://example.org/a?a=1" },
      ],
    });

    assert.equal(
      html,
      '<em>Smith</em> <a href="https://example.org/a?a=1">(2024)</a>',
    );
  });

  describe("with capabilities", function () {
    it("reads files through the readFile capability", async function () {
      const files = new Map([
        ["notes.txt", "hello"],
        ["data.json", JSON.stringify({ answer: 42 })],
      ]);
      const style = await createStyle(
        hostWith({
          readFile: async (relPath) => {
            const content = files.get(relPath);
            if (content === undefined) {
              throw new Error(`Missing file: ${relPath}`);
            }
            return new TextEncoder().encode(content);
          },
        }),
        `
      ${INFO}
      async function generate() {
        const textValue = await readText("notes.txt");
        const data = await readJSON("data.json");
        return {
          citations: [
            { id: "ctx-1", content: textValue + "|" + String(data.answer) },
          ],
          bibliography: [],
        };
      }
      `,
      );

      const result = await style.generate(contexts);
      const content = (result.citations as { content: { text: string } }[])[0]
        .content;
      assert.equal(content.text, "hello|42");
    });

    it("parses markup when the host provides parseHtml", async function () {
      // A DOM-free structural parser is enough: `HtmlNodeLike` is the whole
      // contract, so a host needs no DOM library to support styled markup.
      const parseHtml = (html: string) => {
        const root: {
          nodeType: number;
          tagName: string;
          textContent: string;
          childNodes: unknown[];
          getAttribute(name: string): string | null;
        } = {
          nodeType: 1,
          tagName: "div",
          textContent: "",
          childNodes: [],
          getAttribute: () => null,
        };
        const stack: { node: typeof root; tag: string }[] = [
          { node: root, tag: "div" },
        ];
        const token = /<\/?([a-z]+)([^>]*)>|([^<]+)/gi;
        let match: RegExpExecArray | null;
        while ((match = token.exec(html))) {
          const [raw, tagName, attributes, textContent] = match;
          if (textContent) {
            stack[stack.length - 1].node.childNodes.push({
              nodeType: 3,
              nodeValue: textContent,
              childNodes: [],
            });
            root.textContent += textContent;
            continue;
          }
          if (raw.startsWith("</")) {
            if (stack.length > 1) stack.pop();
            continue;
          }
          const attributes_: Record<string, string> = {};
          const attribute = /([a-z-]+)="([^"]*)"/gi;
          let attributeMatch: RegExpExecArray | null;
          while ((attributeMatch = attribute.exec(attributes ?? ""))) {
            attributes_[attributeMatch[1]] = attributeMatch[2];
          }
          const node = {
            nodeType: 1,
            tagName: tagName.toLowerCase(),
            textContent: "",
            childNodes: [] as unknown[],
            getAttribute: (name: string) => attributes_[name] ?? null,
          };
          stack[stack.length - 1].node.childNodes.push(node);
          stack.push({ node, tag: node.tagName });
        }
        return root;
      };

      const style = await createStyle(
        hostWith({ parseHtml: parseHtml as never }),
        `
      ${INFO}
      function generate() {
        return {
          citations: [
            { id: "ctx-1", content: "H<sub>2</sub>O and <b>bold</b>" },
          ],
          bibliography: [],
        };
      }
      `,
      );

      const result = await style.generate(contexts);
      const content = (
        result.citations as {
          content: { text: string; marks: readonly Record<string, unknown>[] };
        }[]
      )[0].content;
      assert.equal(content.text, "H2O and bold");
      assert.deepEqual(content.marks, [
        { type: "script", start: 1, end: 2, value: "subscript" },
        { type: "bold", start: 8, end: 12, value: true },
      ]);
    });
  });
});
