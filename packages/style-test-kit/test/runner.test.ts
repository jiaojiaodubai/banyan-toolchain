/**
 * Runner and runtime tests: contexts building, the minimal style end to end,
 * host assembly, the sandbox runtime and the renderer wrapper.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TestLibrary } from "../src/library/library";
import { buildContexts } from "../src/run/contexts";
import { createTestKitHost, runStyle } from "../src/run/runner";
import { createNodeHost } from "../src/runtime/node-host";
import { createNodeSandboxRuntime } from "../src/runtime/node-runtime";
import {
  renderDocument,
  renderFragment,
  renderResult,
} from "../src/run/render";
import { createStyle } from "../src/banyan";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "../fixtures");
const library = TestLibrary.fromRdf(
  readFileSync(path.join(fixtureDir, "library-basic.rdf"), "utf8"),
);
const minimalStyle = readFileSync(
  path.join(fixtureDir, "styles/numeric-minimal.js"),
  "utf8",
);

describe("buildContexts", () => {
  it("resolves items by key, node and numeric id", () => {
    const contexts = buildContexts(library, [
      { cites: [{ item: "ITEM0001" }] },
      { cites: [{ item: "#item_2" }] },
      { cites: [{ item: 3 }] },
    ]);
    expect(contexts.map((context) => context.id)).to.deep.equal([
      "citation-1",
      "citation-2",
      "citation-3",
    ]);
    expect(contexts.map((context) => context.page)).to.deep.equal([1, 2, 3]);
    expect(contexts.map((context) => context.cites[0].item.id)).to.deep.equal([
      "1",
      "2",
      "3",
    ]);
  });

  it("keeps spec ids, pages and params", () => {
    const contexts = buildContexts(library, {
      contexts: [
        {
          id: "custom",
          page: 7,
          params: { "locator-note": "n1" },
          cites: [{ item: "ITEM0001", params: { locator: "1025" } }],
        },
      ],
    });
    expect(contexts[0].id).to.equal("custom");
    expect(contexts[0].page).to.equal(7);
    expect(contexts[0].params).to.deep.equal({ "locator-note": "n1" });
    expect(contexts[0].cites[0].params).to.deep.equal({ locator: "1025" });
  });

  it("names the missing item in the error", () => {
    expect(() =>
      buildContexts(library, [{ cites: [{ item: "NOPE" }] }]),
    ).to.throw(/NOPE/);
  });

  it("rejects malformed specs", () => {
    expect(() => buildContexts(library, [{ cites: "nope" } as never])).to.throw(
      /cites array/,
    );
    expect(() => buildContexts(library, {} as never)).to.throw(/CitationSpec/);
  });
});

describe("runStyle (minimal style, end to end)", () => {
  it("runs against a Zotero-export-shaped document, citing by node id", async () => {
    // Real Zotero exports have no z:key, so contexts reference the item nodes.
    const exported = TestLibrary.fromRdf(
      readFileSync(path.join(fixtureDir, "zotero-export.rdf"), "utf8"),
    );
    const contexts = buildContexts(exported, [
      { cites: [{ item: "#item_1" }, { item: "#item_4" }] },
    ]);
    const run = await runStyle(
      { code: minimalStyle, library: exported, styleDir: fixtureDir },
      contexts,
    );

    expect(run.result.citations[0].content.text).to.contain("张");
    expect(run.result.citations[0].content.text).to.contain("2023");
    expect(run.result.bibliography.map((line) => line.id)).to.deep.equal([
      "bib-1",
      "bib-2",
    ]);
    expect(run.result.bibliography[0]?.content.text).to.contain("物理学报");
  });

  it("generates citations and bibliography through the sandbox", async () => {
    const contexts = buildContexts(library, [
      { cites: [{ item: "ITEM0001" }, { item: "ITEM0003" }] },
      { cites: [{ item: "ITEM0002" }] },
    ]);
    const run = await runStyle(
      { code: minimalStyle, library, styleDir: fixtureDir },
      contexts,
    );

    expect(run.style.INFO.id).to.equal("testkit-numeric-minimal");
    expect(run.result.citations).to.have.lengthOf(2);
    const first = run.result.citations[0];
    expect(first.content.text).to.contain("张");
    expect(first.content.text).to.contain("2023");
    expect(first.content.text).to.contain("王");
    expect(run.result.bibliography.map((line) => line.id)).to.deep.equal([
      "bib-1",
      "bib-3",
      "bib-2",
    ]);
  });

  it("styles see no host-private key (item.key reads as empty)", async () => {
    const contexts = buildContexts(library, [
      { cites: [{ item: "ITEM0001" }] },
    ]);
    const run = await runStyle(
      {
        code: `const INFO = { id: "x", title: "X", description: "", citationType: "intext-citation", creator: [], tags: [], documentation: [], license: "MIT", updated: "" };
function generate() {
  return {
    citations: contexts.map(c => ({ id: c.id, content: group([text("key=[" + c.cites[0].item.key + "]")]) })),
    bibliography: [],
  };
}`,
        library,
        styleDir: fixtureDir,
      },
      contexts,
    );
    expect(run.result.citations[0].content.text).to.equal("key=[]");
  });

  it("collects structured messages, not text prefixes", async () => {
    const contexts = buildContexts(library, [
      { cites: [{ item: "ITEM0001" }] },
    ]);
    const run = await runStyle(
      {
        code: `const INFO = { id: "x", title: "X", description: "", citationType: "intext-citation", creator: [], tags: [], documentation: [], license: "MIT", updated: "" };
console.info("a finding");
console.log("a trace");
function generate() { return { citations: contexts.map(c => ({ id: c.id, content: text("ok") })), bibliography: [] }; }`,
        library,
        styleDir: fixtureDir,
      },
      contexts,
    );
    const severities = run.messages.map((message) => message.severity);
    expect(severities).to.include("trace");
    expect(severities).to.include("info");
    const finding = run.messages.find((message) => message.severity === "info");
    expect(finding?.message).to.equal("a finding");
    expect(finding?.code).to.be.a("string");
    expect(
      run.style.diagnostics.map((message) => message.severity),
    ).to.deep.equal(["info"]);
  });
});

describe("host assembly", () => {
  it("installs the readiness gate that lists every missing capability", () => {
    const host = createNodeHost({});
    expect(host.assertReady).to.be.a("function");
    expect(() => host.assertReady?.()).to.throw(
      /"parseHtml", "readFile", "resolveMultilingualItems"/,
    );
  });

  it("skips the gate when asked (for point-of-use contract tests)", () => {
    const host = createNodeHost({}, { assertCapabilities: false });
    expect(host.assertReady).to.equal(undefined);
  });

  it("surfaces the missing capability when the style is created", async () => {
    const host = createNodeHost({});
    let message = "";
    try {
      await createStyle(host, "const INFO = {}; function generate() {}");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).to.include("parseHtml");
    expect(message).to.include("readFile");
  });

  it("exposes the assembled capabilities to the core", () => {
    const host = createTestKitHost({ library, styleDir: fixtureDir });
    expect(host.capabilities?.parseHtml).to.be.a("function");
    expect(host.capabilities?.readFile).to.be.a("function");
    expect(host.capabilities?.resolveMultilingualItems).to.be.a("function");
    expect(host.assertReady).to.be.a("function");
    expect(() => host.assertReady?.()).to.not.throw();
  });
});

describe("sandbox runtime", () => {
  it("rebuilds binary values with realm constructors", () => {
    const runtime = createNodeSandboxRuntime();
    const context = runtime.createContext();
    const bytes = context.importValue(new Uint8Array([1, 2, 3]));
    expect(bytes.constructor.name).to.equal("Uint8Array");
    expect([...(bytes as unknown as Uint8Array)]).to.deep.equal([1, 2, 3]);
  });

  it("disables eval / new Function by default", () => {
    const runtime = createNodeSandboxRuntime();
    const context = runtime.createContext();
    expect(() => context.evaluate('new Function("return 1")()')).to.throw();
  });

  it("can allow code generation explicitly", () => {
    const runtime = createNodeSandboxRuntime({ allowCodeGeneration: true });
    const context = runtime.createContext();
    expect(context.evaluate('new Function("return 1")()')).to.equal(1);
  });

  it("enforces the synchronous evaluate budget", () => {
    const runtime = createNodeSandboxRuntime({ timeoutMs: 100 });
    const context = runtime.createContext();
    expect(() =>
      context.evaluate("while (true) {}", { timeoutMs: 100 }),
    ).to.throw();
  });

  it("creates objects owned by the context", () => {
    const runtime = createNodeSandboxRuntime();
    const context = runtime.createContext();
    const object = context.createObject();
    context.defineGlobal("__obj__", object);
    expect(
      context.evaluate("Object.getPrototypeOf(__obj__) === Object.prototype", {
        timeoutMs: 100,
      }),
    ).to.equal(true);
    // The host realm's prototype chain is not what the context sees.
    expect(Object.getPrototypeOf(object)).to.not.equal(Object.prototype);
  });

  it("clones context data into host-owned objects, dropping functions", () => {
    const runtime = createNodeSandboxRuntime();
    const context = runtime.createContext();
    context.evaluate(
      "this.__value__ = { a: 1, nested: { b: 2 }, list: [1, 2], f() { return 3; } };",
      { timeoutMs: 100 },
    );
    const cloned = context.cloneToHost(context.readGlobal("__value__")) as {
      a: number;
      nested: { b: number };
      list: number[];
      f?: unknown;
    };
    expect(cloned.a).to.equal(1);
    expect(cloned.f).to.equal(undefined);
    // A clone belongs to the host realm; a context-owned object would keep the
    // sandbox's prototypes and could expose sandbox lookups to the host.
    expect(Object.getPrototypeOf(cloned)).to.equal(Object.prototype);
    expect(Object.getPrototypeOf(cloned.nested)).to.equal(Object.prototype);
    expect(Object.getPrototypeOf(cloned.list)).to.equal(Array.prototype);
    expect(context.cloneToHost(undefined)).to.equal(undefined);
  });
});

describe("render wrapper", () => {
  it("marks note citations and renders the bibliography", async () => {
    const noteLibrary = library;
    const contexts = buildContexts(noteLibrary, [
      { cites: [{ item: "ITEM0001" }] },
    ]);
    const run = await runStyle(
      {
        code: `const INFO = { id: "n", title: "N", description: "", citationType: "note-citation", creator: [], tags: [], documentation: [], license: "MIT", updated: "" };
function generate() {
  return {
    citations: contexts.map(c => ({ id: c.id, reference: text(""), content: text("note body") })),
    bibliography: [{ id: "b", type: "bibliography-entry", content: text("entry") }],
  };
}`,
        library: noteLibrary,
        styleDir: fixtureDir,
      },
      contexts,
    );
    const rendered = renderResult(run.result);
    expect(rendered.citations[0].marker).to.equal("[1]");
    expect(rendered.citations[0].note).to.equal("note body");
    expect(renderFragment(run.result)).to.contain('<ol class="banyan-notes">');
    expect(renderDocument(run.result)).to.contain("<!DOCTYPE html>");
  });
});
