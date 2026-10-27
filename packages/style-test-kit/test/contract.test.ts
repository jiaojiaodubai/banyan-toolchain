/**
 * Host contract tests: the capability degradation paths, realm semantics, late
 * binding, serialization of concurrent generations, the console's two channels,
 * and the transpile-helper ledger. Everything runs through the testkit's own
 * host, so a drift in either side shows up here.
 */
import { expect } from "chai";
import {
  createStyle,
  transpileHelperBodies,
  transpileHelperNames,
  type RichText,
  type SandboxContext,
  type SandboxRuntime,
  type StyleHostCapabilities,
  type StyleMessage,
} from "../src/banyan";
import { TestLibrary } from "../src/library/library";
import { createTestKitHost } from "../src/run/runner";
import { createNodeHost } from "../src/runtime/node-host";
import { createNodeSandboxRuntime } from "../src/runtime/node-runtime";

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

const contexts = [
  {
    id: "ctx-1",
    page: 1,
    cites: [
      {
        item: {
          id: "1",
          itemType: "book",
          title: "A title",
          creators: [{ creatorType: "author", lastName: "Smith" }],
          extra: {},
        },
        params: {},
      },
    ],
    params: {},
  },
] as never;

const emptyLibrary = TestLibrary.empty();

/** Assemble a complete testkit host (test data not needed for these probes). */
function testkitHost(): ReturnType<typeof createTestKitHost> {
  return createTestKitHost({ library: emptyLibrary, styleDir: process.cwd() });
}

function probe(content: string): string {
  return `${INFO}
function generate() {
  return { citations: [{ id: contexts[0].id, content: ${JSON.stringify(content)} }], bibliography: [] };
}`;
}

async function textOf(
  code: string,
  host = testkitHost(),
  input: unknown = contexts,
): Promise<string> {
  const style = await createStyle(host, code);
  const result = await style.generate(input as never);
  return (result.citations as { content: RichText }[])[0].content.text;
}

async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("core host contract: execution", () => {
  it("loads a style and generates through the host bridge", async () => {
    const style = await createStyle(
      testkitHost(),
      `${INFO}
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
}`,
    );
    const result = await style.generate(contexts);
    expect(
      (result.citations as { content: RichText }[])[0].content.text,
    ).to.equal("Smith (A title)");
    expect(
      (result.bibliography[0] as { content: RichText }).content.text,
    ).to.equal("A title");
    expect(style.INFO.title).to.equal("Probe");
  });

  it("keeps the sandbox free of host globals and of the bridge object", async () => {
    const text = await textOf(
      `${INFO}
function generate() {
  const probe = [typeof Zotero, typeof document, typeof window, typeof fetch, typeof __banyanHostUtils__, typeof readText].join(",");
  return { citations: [{ id: "ctx-1", content: probe }], bibliography: [] };
}`,
    );
    expect(text).to.equal(
      "undefined,undefined,undefined,undefined,undefined,function",
    );
  });

  it("exposes contexts as a readonly, undefined-free view", async () => {
    const text = await textOf(
      `${INFO}
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
      { id: "ctx-1", content: [missing === "" ? "empty" : "value", String(refused), String(contexts[0].id)].join("|") },
    ],
    bibliography: [],
  };
}`,
    );
    expect(text).to.equal("empty|true|ctx-1");
  });

  it("decodes entity text without needing a parseHtml capability", async () => {
    const host = createNodeHost({}, { assertCapabilities: false });
    const text = await textOf(probe("H2O &amp; CO2"), host);
    expect(text).to.equal("H2O & CO2");
  });

  it("fails loudly without parseHtml when content contains markup", async () => {
    const host = createNodeHost({}, { assertCapabilities: false });
    const message = await failureOf(async () => {
      const style = await createStyle(host, probe("H<sub>2</sub>O"));
      await style.generate(contexts);
    });
    expect(message).to.match(/does not provide the "parseHtml" capability/);
  });

  it("fails loudly when parseHtml cannot return a root", async () => {
    for (const unusable of [null, { nope: true }]) {
      const host = createNodeHost(
        { parseHtml: (() => unusable) as never },
        { assertCapabilities: false },
      );
      const message = await failureOf(async () => {
        const style = await createStyle(host, probe("<i>x</i>"));
        await style.generate(contexts);
      });
      expect(message).to.match(/did not return an element-like root/);
    }
  });
});

describe("core host contract: capabilities", () => {
  it("names the missing readFile capability from the read utility", async () => {
    const host = createNodeHost({}, { assertCapabilities: false });
    const text = await textOf(
      `${INFO}
async function generate() {
  let message = "";
  try {
    await readText("anything.json");
  } catch (error) {
    message = error && error.message ? error.message : String(error);
  }
  return { citations: [{ id: "ctx-1", content: message }], bibliography: [] };
}`,
      host,
    );
    expect(text).to.match(
      /does not provide the "readFile" capability; readText is unavailable/,
    );
  });

  it("names the missing multilingual capability", async () => {
    const host = createNodeHost({}, { assertCapabilities: false });
    const message = await failureOf(async () => {
      const style = await createStyle(
        host,
        `${INFO}
async function generate() {
  const item = contexts[0].cites[0].item;
  await getMultilingualItems(item);
  return { citations: [], bibliography: [] };
}`,
      );
      await style.generate(contexts);
    });
    expect(message).to.match(/does not provide the "resolveMultilingualItems"/);
  });

  it("applies the core's own text-case regardless of the host", async () => {
    const code = `${INFO}
function generate() {
  return { citations: [{ id: "ctx-1", content: textCase("a title", "title") }], bibliography: [] };
}`;
    const [plain, withoutParse] = await Promise.all([
      textOf(code),
      textOf(
        code,
        createNodeHost(
          { parseHtml: () => null },
          { assertCapabilities: false },
        ),
      ),
    ]);
    expect(plain).to.equal("A Title");
    expect(withoutParse).to.equal("A Title");
  });

  it("accepts capabilities attached after the style was created", async () => {
    const host = createNodeHost({}, { assertCapabilities: false });
    const style = await createStyle(
      host,
      `${INFO}
async function generate() {
  return { citations: [{ id: "ctx-1", content: await readText("late.txt") }], bibliography: [] };
}`,
    );
    host.capabilities = {
      readFile: async () => new TextEncoder().encode("late"),
    } as unknown as StyleHostCapabilities;
    const result = await style.generate(contexts);
    expect(
      (result.citations as { content: RichText }[])[0].content.text,
    ).to.equal("late");
  });

  it("passes binary values through as realm-native typed arrays", async () => {
    const host = createNodeHost(
      { readFile: async () => new Uint8Array([65, 66, 67]) },
      { assertCapabilities: false },
    );
    const text = await textOf(
      `${INFO}
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
}`,
      host,
    );
    expect(text).to.equal("Uint8Array|65,66,67|3|DataView");
  });

  it("reads files and parses markup through the testkit host", async () => {
    const style = await createStyle(
      testkitHost(),
      `${INFO}
function generate() {
  return {
    citations: [{ id: "ctx-1", content: "H<sub>2</sub>O" }],
    bibliography: [],
  };
}`,
    );
    const result = await style.generate(contexts);
    const content = (result.citations as { content: RichText }[])[0].content;
    expect(content.text).to.equal("H2O");
    expect(content.marks).to.deep.equal([
      { type: "script", start: 1, end: 2, value: "subscript" },
    ]);
  });
});

describe("core host contract: scheduling", () => {
  it("serializes concurrent generations on one style instance", async () => {
    const host = createNodeHost(
      {
        readFile: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return new TextEncoder().encode("x");
        },
      },
      { assertCapabilities: false },
    );
    const style = await createStyle(
      host,
      `${INFO}
async function generate() {
  const id = contexts[0].id;
  await readText("slow.txt");
  return { citations: [{ id: id, content: contexts[0].id }], bibliography: [] };
}`,
    );
    const contextsFor = (id: string) =>
      [
        {
          id,
          page: 1,
          cites: [
            {
              item: {
                id: "1",
                itemType: "book",
                title: `Title ${id}`,
                creators: [],
                extra: {},
              },
              params: {},
            },
          ],
          params: {},
        },
      ] as never;

    const results = await Promise.all([
      style.generate(contextsFor("a")),
      style.generate(contextsFor("b")),
    ]);
    expect(
      results.map(
        (result) =>
          (result.citations as { content: RichText }[])[0].content.text,
      ),
    ).to.deep.equal(["a", "b"]);
  });

  it("keeps generating after a rejected generation", async () => {
    const style = await createStyle(
      testkitHost(),
      `${INFO}
async function generate() {
  const id = contexts[0].id;
  if (id === "boom") throw new Error("style failed");
  return { citations: [{ id: id, content: id }], bibliography: [] };
}`,
    );
    const failing = style.generate([
      {
        id: "boom",
        page: 1,
        cites: [
          {
            item: {
              id: "1",
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
    ] as never);
    expect(await failureOf(() => Promise.resolve(failing))).to.match(
      /style failed/,
    );
    const result = await style.generate(contexts);
    expect(
      (result.citations as { content: RichText }[])[0].content.text,
    ).to.equal("ctx-1");
  });

  it("applies the optional evaluate budget to style load", async () => {
    try {
      await createStyle(
        testkitHost(),
        `${INFO}
while (true) {}`,
        { evaluateTimeoutMs: 20 },
      );
      expect.fail("expected the style load to time out");
    } catch (error) {
      expect((error as { code?: unknown }).code).to.equal("style-load");
      expect((error as Error).message).to.match(/timed out/i);
    }
  });

  it("applies the optional evaluate budget to a synchronous generate", async () => {
    const style = await createStyle(
      testkitHost(),
      `${INFO}
function generate() { while (true) {} }`,
      { evaluateTimeoutMs: 20 },
    );
    try {
      await style.generate(contexts);
      expect.fail("expected the generation to time out");
    } catch (error) {
      expect((error as { code?: unknown }).code).to.equal("generate");
      expect((error as Error).message).to.match(/timed out/i);
    }
  });
});

describe("core host contract: diagnostics", () => {
  const code = `${INFO}
function generate() {
  console.log("from-sink", { n: 1 });
  console.warn("worth keeping");
  return { citations: [{ id: "ctx-1", content: "ok" }], bibliography: [] };
}`;

  it("offers a style's console output to a sink, and keeps findings without one", async () => {
    const seen: StyleMessage[] = [];
    const style = await createStyle(testkitHost(), code, {
      messageSink: (message) => seen.push(message),
    });
    await style.generate(contexts);
    expect(
      seen.map((message) => [message.severity, message.message]),
    ).to.deep.equal([
      ["trace", 'from-sink {"n":1}'],
      ["warning", "worth keeping"],
    ]);

    const quiet = await createStyle(testkitHost(), code);
    await quiet.generate(contexts);
    expect(
      quiet.diagnostics.map((message) => [message.severity, message.message]),
    ).to.deep.equal([["warning", "worth keeping"]]);

    // A failing sink must not break the run it reports on.
    const throwing = await createStyle(testkitHost(), code, {
      messageSink: () => {
        throw new Error("sink failed");
      },
    });
    const result = await throwing.generate(contexts);
    expect(
      (result.citations as { content: RichText }[])[0].content.text,
    ).to.equal("ok");
  });

  it("settles findings per run: the load's stay, a run's are replaced", async () => {
    const presetCode = `${INFO}
const ITEM_FIELD_PRESETS = [{ id: "", label: "x", fields: {} }];
function generate() {
  console.warn("run warning");
  return { citations: [{ id: "ctx-1", content: "ok" }], bibliography: [] };
}`;
    const style = await createStyle(testkitHost(), presetCode);
    expect(
      style.diagnostics.map((message) => `${message.code}: ${message.message}`),
    ).to.deep.equal([
      "style-load: skipped entry without a non-empty string id",
    ]);

    await style.generate(contexts);
    expect(
      style.diagnostics.map((message) => `${message.code}: ${message.message}`),
    ).to.deep.equal([
      "style-load: skipped entry without a non-empty string id",
      "generate: run warning",
    ]);

    await style.generate(contexts);
    expect(
      style.diagnostics.map((message) => `${message.code}: ${message.message}`),
    ).to.have.lengthOf(2);
  });

  it("refuses to let a style replace a sandbox utility", async () => {
    const message = await failureOf(() =>
      createStyle(
        testkitHost(),
        `${INFO}
globalThis.uuid = "overwritten";
function generate() { return { citations: [], bibliography: [] }; }`,
      ),
    );
    expect(message).to.match(/Failed to evaluate style script/);
  });
});

describe("core host contract: failures", () => {
  it("attributes a style's own failure to the generate code", async () => {
    const style = await createStyle(
      testkitHost(),
      `${INFO}
function generate() { throw new Error("style blew up"); }`,
    );
    try {
      await style.generate(contexts);
      expect.fail("expected the run to fail");
    } catch (error) {
      expect((error as { code?: unknown }).code).to.equal("generate");
      expect((error as Error).message).to.match(/style blew up/);
    }
  });

  it("attributes a contract failure to the load code", async () => {
    try {
      await createStyle(testkitHost(), "const INFO = {};");
      expect.fail("expected the style to be rejected");
    } catch (error) {
      expect((error as { code?: unknown }).code).to.equal("style-contract");
    }
  });

  it("reports a generate() without a return value as generate-output", async () => {
    const style = await createStyle(
      testkitHost(),
      `${INFO}
function generate() {}`,
    );
    try {
      await style.generate(contexts);
      expect.fail("expected the run to fail");
    } catch (error) {
      expect((error as { code?: unknown }).code).to.equal("generate-output");
      expect((error as Error).message).to.match(/has no return value/);
    }
  });

  it("rejects a malformed context array before the style runs", async () => {
    const style = await createStyle(
      testkitHost(),
      `${INFO}
function generate() { return { citations: [], bibliography: [] }; }`,
    );
    for (const [label, value, pattern] of [
      ["not an array", {}, /expects an array of contexts/],
      ["entry without id", [{ cites: [] }], /without a non-empty string id/],
      [
        "entry without page",
        [{ id: "ctx-1", cites: [] }],
        /without a finite number page/,
      ],
      [
        "entry without cites",
        [{ id: "ctx-1", page: 1 }],
        /\.cites that is not an array/,
      ],
      [
        "duplicate id",
        [
          { id: "ctx-1", page: 1, cites: [] },
          { id: "ctx-1", page: 2, cites: [] },
        ],
        /duplicate context id "ctx-1"/,
      ],
    ] as const) {
      const message = await failureOf(() =>
        Promise.resolve(style.generate(value as never)),
      );
      expect(message, `case: ${label}`).to.match(pattern);
    }
  });

  it("passes declared style options to generate, defaulting the rest", async () => {
    const style = await createStyle(
      testkitHost(),
      `${INFO}
const STYLE_OPTIONS = [
  {
    id: "variant",
    label: "Variant",
    kind: "state",
    states: { short: "Short", long: "Long" },
    defaultValue: "short",
  },
];
function generate() {
  return {
    citations: [{ id: contexts[0].id, content: options.variant }],
    bibliography: [],
  };
}`,
    );

    const defaults = await style.generate(contexts);
    expect(
      (defaults.citations as { content: RichText }[])[0].content.text,
    ).to.equal("short");
    expect(style.STYLE_OPTIONS?.[0]?.defaultValue).to.equal("short");

    const overridden = await style.generate(contexts, { variant: "long" });
    expect(
      (overridden.citations as { content: RichText }[])[0].content.text,
    ).to.equal("long");
  });

  it("resolves declared citation and cite params into the contexts", async () => {
    const style = await createStyle(
      testkitHost(),
      `${INFO}
const CITATION_PARAMS = [
  {
    id: "mode",
    label: "Mode",
    kind: "state",
    states: { full: "Full", short: "Short" },
    defaultValue: "full",
  },
];
const CITE_PARAMS = [{ id: "suffix", label: "Suffix", kind: "value" }];
function generate() {
  const citation = contexts[0];
  return {
    citations: [
      {
        id: citation.id,
        content: citation.params.mode + citation.cites[0].params.suffix,
      },
    ],
    bibliography: [],
  };
}`,
    );

    const build = (citationParams: object, citeParams: object) =>
      [
        {
          id: "ctx-1",
          page: 1,
          params: citationParams,
          cites: [
            {
              item: {
                id: "1",
                itemType: "book",
                title: "T",
                creators: [],
                extra: {},
              },
              params: citeParams,
            },
          ],
        },
      ] as never;

    const defaults = await style.generate(build({}, {}));
    expect(
      (defaults.citations as { content: RichText }[])[0].content.text,
    ).to.equal("full");

    const stored = await style.generate(
      build({ mode: "short" }, { suffix: "!" }),
    );
    expect(
      (stored.citations as { content: RichText }[])[0].content.text,
    ).to.equal("short!");
  });
});

describe("core host contract: transpile helper ledger", () => {
  function createSourceCapture(): {
    runtime: SandboxRuntime;
    sources: string[];
  } {
    const sources: string[] = [];
    const base = createNodeSandboxRuntime();
    return {
      sources,
      runtime: {
        createContext(options): SandboxContext {
          const context = base.createContext(options);
          return {
            evaluate: (source, evaluateOptions) => {
              sources.push(source);
              return context.evaluate(source, evaluateOptions);
            },
            defineGlobal: (name, value) => context.defineGlobal(name, value),
            readGlobal: (name) => context.readGlobal(name),
            deleteGlobal: (name) => context.deleteGlobal(name),
            createObject: () => context.createObject(),
            defineFunction: (target, name, fn) =>
              context.defineFunction(target, name, fn),
            deferHostTask: (callback) => context.deferHostTask(callback),
            importValue: (value) => context.importValue(value),
            exportValue: (value) => context.exportValue(value),
            cloneToHost: (value) => context.cloneToHost(value),
          };
        },
      },
    };
  }

  function helperReferences(source: string): string[] {
    const found: string[] = [];
    for (const match of source.matchAll(/(^|[^\w$.'"])(__[A-Za-z_$][\w$]*)/g)) {
      found.push(match[2]);
    }
    return found;
  }

  it("serializes helper-bearing fragments the ledger covers", async () => {
    const capture = createSourceCapture();
    // Building a style serializes every fragment and scans it against the
    // ledger, so an unregistered helper fails right here.
    await createStyle(
      { runtime: capture.runtime, capabilities: {} as StyleHostCapabilities },
      `${INFO}
function generate() { return { citations: [], bibliography: [] }; }`,
    );

    const ledger = new Set(transpileHelperNames());
    const bodies = transpileHelperBodies();
    expect(ledger.size).to.be.greaterThan(0);

    // A helper body that referenced an unregistered helper would fail at
    // execution time with a bare ReferenceError; the ledger has to be closed.
    const unresolved: string[] = [];
    for (const name of ledger) {
      for (const reference of helperReferences(bodies[name] ?? "")) {
        if (reference.startsWith("__") && !ledger.has(reference)) {
          unresolved.push(`${name} -> ${reference}`);
        }
      }
    }
    expect(unresolved).to.deep.equal([]);

    // The capture saw the source fragments the core serialized (sanity check
    // that the wrapper actually observes the build).
    expect(
      capture.sources.some((source) => source.includes("__banyanHostUtils__")),
    ).to.equal(true);
  });
});
