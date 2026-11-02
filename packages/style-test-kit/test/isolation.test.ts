/**
 * Isolated runner tests: a normal run matches
 * the in-process path, and each resource limit fails loudly instead of hanging
 * or exhausting the process.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TestLibrary } from "../src/library/library";
import { buildContexts, type CitationSpec } from "../src/run/contexts";
import { runStyle } from "../src/run/runner";
import { runStyleIsolated } from "../src/run/isolate";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "../fixtures");
const rdf = readFileSync(path.join(fixtures, "library-basic.rdf"), "utf8");
const style = readFileSync(
  path.join(fixtures, "styles/numeric-minimal.js"),
  "utf8",
);
const INFO = `const INFO = { id: "x", title: "X", description: "", citationType: "intext-citation", creator: [], tags: [], documentation: [], license: "MIT", updated: "" };`;

const specs: CitationSpec[] = [
  { id: "citation-1", cites: [{ item: "ITEM0001" }, { item: "ITEM0003" }] },
  { id: "citation-2", cites: [{ item: "ITEM0002" }] },
];

async function failureOf(run: () => Promise<unknown>): Promise<{
  code?: string;
  message: string;
}> {
  try {
    await run();
  } catch (error) {
    return {
      code: (error as { code?: string }).code,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { message: "" };
}

describe("isolated runs", () => {
  it("matches the in-process run", async () => {
    const library = TestLibrary.fromRdf(rdf);
    const contexts = buildContexts(library, specs);
    const inProcess = await runStyle(
      { code: style, library, styleDir: fixtures },
      contexts,
    );
    const isolated = await runStyleIsolated({
      code: style,
      rdf,
      contexts: specs,
      styleDir: fixtures,
      timeoutMs: 20_000,
    });

    expect(isolated.info.id).to.equal(inProcess.style.INFO.id);
    expect(
      isolated.result.citations.map((citation) => citation.content),
    ).to.deep.equal(
      inProcess.result.citations.map((citation) => citation.content),
    );
    expect(
      isolated.result.bibliography.map((line) => line.content),
    ).to.deep.equal(inProcess.result.bibliography.map((line) => line.content));
    expect(isolated.isolation.timedOut).to.equal(false);
    expect(isolated.isolation.elapsedMs).to.be.a("number");
    expect(isolated.isolation.limits.memoryMb).to.equal(256);
  });

  it("runs from a JSON item database", async () => {
    const database = JSON.parse(
      readFileSync(path.join(fixtures, "items-basic.json"), "utf8"),
    ) as unknown;
    const library = TestLibrary.fromItemDatabase(database);
    const contexts = buildContexts(library, specs);
    const inProcess = await runStyle(
      { code: style, library, styleDir: fixtures },
      contexts,
    );
    const isolated = await runStyleIsolated({
      code: style,
      itemsJson: database,
      contexts: specs,
      styleDir: fixtures,
      timeoutMs: 20_000,
    });

    expect(
      isolated.result.citations.map((citation) => citation.content),
    ).to.deep.equal(
      inProcess.result.citations.map((citation) => citation.content),
    );
    expect(isolated.isolation.timedOut).to.equal(false);
  });

  it("terminates a synchronous dead loop on the wall-clock limit", async () => {
    const started = Date.now();
    const failure = await failureOf(() =>
      runStyleIsolated({
        code: `${INFO} function generate() { while (true) {} }`,
        rdf,
        contexts: specs,
        styleDir: fixtures,
        timeoutMs: 500,
      }),
    );
    expect(failure.code).to.equal("generate-timeout");
    expect(failure.message).to.match(/wall-clock limit/);
    // Terminate must interrupt the loop rather than wait it out.
    expect(Date.now() - started).to.be.lessThan(10_000);
  });

  it("rejects a result larger than the output limit", async () => {
    const failure = await failureOf(() =>
      runStyleIsolated({
        code: `${INFO} function generate() {
          return { citations: [{ id: contexts[0].id, content: text("x".repeat(5000)) }], bibliography: [] };
        }`,
        rdf,
        contexts: specs,
        styleDir: fixtures,
        maxOutputBytes: 1024,
        timeoutMs: 20_000,
      }),
    );
    expect(failure.code).to.equal("generate-output");
    expect(failure.message).to.match(/output limit/);
  });

  it("fails a style that exhausts its heap instead of growing the process", async () => {
    const failure = await failureOf(() =>
      runStyleIsolated({
        code: `${INFO} function generate() {
          const sink = [];
          for (;;) sink.push(new Array(1_000_000).fill(1));
        }`,
        rdf,
        contexts: specs,
        styleDir: fixtures,
        memoryMb: 32,
        timeoutMs: 20_000,
      }),
    );
    expect(failure.message).to.match(/memory limit/);
  });

  it("forwards library diagnostics from the child process", async () => {
    const extRdf = readFileSync(
      path.join(fixtures, "creators-ext.rdf"),
      "utf8",
    );
    const isolated = await runStyleIsolated({
      code: style,
      rdf: extRdf,
      contexts: [{ cites: [{ item: "EXT0003" }] }],
      styleDir: fixtures,
      timeoutMs: 20_000,
    });
    expect(isolated.libraryDiagnostics).to.have.lengthOf(1);
    expect(isolated.libraryDiagnostics[0].code).to.equal("generate-input");
  });

  it("reports a style that throws as a generate failure", async () => {
    const failure = await failureOf(() =>
      runStyleIsolated({
        code: `${INFO} function generate() { throw new Error("boom"); }`,
        rdf,
        contexts: specs,
        styleDir: fixtures,
        timeoutMs: 20_000,
      }),
    );
    expect(failure.code).to.equal("generate");
    expect(failure.message).to.match(/boom/);
  });
});
