/**
 * CLI behavior tests: argument handling, exit codes 0/1/2, `--items`, snapshots
 * and the `rdf` subcommands.
 *
 * `runCli()` is invoked in-process with captured sinks, so the tests exercise
 * the real CLI code without spawning a child process.
 */
import { expect } from "chai";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  EXIT_ERROR,
  EXIT_OK,
  EXIT_SNAPSHOT_MISMATCH,
  runCli,
} from "../src/cli";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "../fixtures");
const rdf = path.join(fixtures, "library-basic.rdf");
const contexts = path.join(fixtures, "contexts-basic.json");
const style = path.join(fixtures, "styles/numeric-minimal.js");

interface Capture {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function cli(...args: string[]): Promise<Capture> {
  const out: string[] = [];
  const err: string[] = [];
  const exitCode = await runCli(args, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { stdout: out.join("\n"), stderr: err.join("\n"), exitCode };
}

describe("cli: dispatch", () => {
  it("prints usage for --help", async () => {
    const result = await cli("--help");
    expect(result.exitCode).to.equal(EXIT_OK);
    expect(result.stdout).to.contain("banyan-style-test-kit");
    expect(result.stdout).to.contain("Exit codes");
  });

  it("fails with usage when no command is given", async () => {
    const result = await cli();
    expect(result.exitCode).to.equal(EXIT_ERROR);
    expect(result.stdout).to.contain("Usage:");
  });

  it("rejects an unknown command", async () => {
    const result = await cli("nope");
    expect(result.exitCode).to.equal(EXIT_ERROR);
    expect(result.stderr).to.contain("Unknown command: nope");
  });

  it("rejects an unknown option", async () => {
    const result = await cli("run", "--nope");
    expect(result.exitCode).to.equal(EXIT_ERROR);
    expect(result.stderr).to.contain("Argument error");
  });
});

describe("cli: run", () => {
  it("renders an HTML fragment for --items", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--items",
      "ITEM0001,ITEM0003",
      "--items",
      "ITEM0002",
      "--style-dir",
      fixtures,
    );
    expect(result.exitCode).to.equal(EXIT_OK);
    expect(result.stdout).to.contain('<p class="banyan-marker">');
    expect(result.stdout).to.contain('<div class="banyan-bibliography">');
  });

  it("prints the structured result for --json", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--contexts",
      contexts,
      "--style-dir",
      fixtures,
      "--json",
    );
    expect(result.exitCode).to.equal(EXIT_OK);
    const payload = JSON.parse(result.stdout);
    expect(payload.style.id).to.equal("testkit-numeric-minimal");
    expect(payload.result.citations).to.have.lengthOf(4);
    expect(payload.rendered.bibliography).to.have.lengthOf(6);
    expect(payload.diagnostics).to.deep.equal([]);
  });

  it("prints a complete document for --document", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--items",
      "ITEM0001",
      "--document",
    );
    expect(result.exitCode).to.equal(EXIT_OK);
    expect(result.stdout).to.contain("<!DOCTYPE html>");
  });

  it("runs a style in the isolated child process", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--items",
      "ITEM0001,ITEM0003",
      "--style-dir",
      fixtures,
      "--isolated",
      "--timeout",
      "20000",
      "--memory",
      "128",
      "--max-output",
      "1048576",
      "--json",
    );
    expect(result.exitCode).to.equal(EXIT_OK);
    const payload = JSON.parse(result.stdout);
    expect(payload.style.id).to.equal("testkit-numeric-minimal");
    expect(payload.isolation.limits).to.deep.equal({
      timeoutMs: 20000,
      memoryMb: 128,
      maxOutputBytes: 1048576,
    });
  });

  it("rejects a non-numeric limit", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--items",
      "ITEM0001",
      "--timeout",
      "soon",
    );
    expect(result.exitCode).to.equal(EXIT_ERROR);
    expect(result.stderr).to.contain("--timeout");
  });

  it("reports missing required options", async () => {
    expect((await cli("run", "--rdf", rdf)).exitCode).to.equal(EXIT_ERROR);
    expect((await cli("run", "--style", style)).exitCode).to.equal(EXIT_ERROR);
    const neither = await cli("run", "--style", style, "--rdf", rdf);
    expect(neither.exitCode).to.equal(EXIT_ERROR);
    expect(neither.stderr).to.contain("--contexts");
  });

  it("reports an unknown item instead of crashing", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--items",
      "NOPE",
    );
    expect(result.exitCode).to.equal(EXIT_ERROR);
    expect(result.stderr).to.contain("NOPE");
  });

  it("writes diagnostics to stderr, not stdout", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      path.join(fixtures, "creators-ext.rdf"),
      "--items",
      "EXT0003",
    );
    expect(result.exitCode).to.equal(EXIT_OK);
    expect(result.stderr).to.contain("[warning] (items/generate-input)");
    expect(result.stdout).to.contain("banyan-marker");
  });
});

describe("cli: snapshots", () => {
  let dir: string;
  const snapshot = () => path.join(dir, "snapshot.json");

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "banyan-cli-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes, checks and diffs a baseline", async () => {
    const update = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--contexts",
      contexts,
      "--style-dir",
      fixtures,
      "--snapshot",
      snapshot(),
      "--update",
    );
    expect(update.exitCode).to.equal(EXIT_OK);
    expect(update.stdout).to.contain("Snapshot written");

    const check = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--contexts",
      contexts,
      "--style-dir",
      fixtures,
      "--snapshot",
      snapshot(),
      "--check",
    );
    expect(check.exitCode).to.equal(EXIT_OK);
    expect(check.stdout).to.contain("Snapshot OK");

    const content = await readFile(snapshot(), "utf8");
    expect(content.endsWith("\n")).to.equal(true);
    await writeFile(
      snapshot(),
      content.replace(/"id": "testkit[^"]*"/, '"id": "changed"'),
    );

    const mismatch = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--contexts",
      contexts,
      "--style-dir",
      fixtures,
      "--snapshot",
      snapshot(),
    );
    expect(mismatch.exitCode).to.equal(EXIT_SNAPSHOT_MISMATCH);
    expect(mismatch.stderr).to.contain("MISMATCH");
    expect(mismatch.stderr).to.contain("- ");
  });

  it("reports a missing baseline", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--items",
      "ITEM0001",
      "--snapshot",
      snapshot(),
    );
    expect(result.exitCode).to.equal(EXIT_SNAPSHOT_MISMATCH);
    expect(result.stderr).to.contain("does not exist");
  });

  it("refuses --check together with --update", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--items",
      "ITEM0001",
      "--snapshot",
      snapshot(),
      "--check",
      "--update",
    );
    expect(result.exitCode).to.equal(EXIT_ERROR);
    expect(result.stderr).to.contain("mutually exclusive");
  });
});

describe("cli: unit and rdf", () => {
  it("prints style metadata for unit", async () => {
    const result = await cli("unit", "--style", style);
    expect(result.exitCode).to.equal(EXIT_OK);
    expect(result.stdout).to.contain("TestKit Numeric Minimal");
    expect(result.stdout).to.contain("citationType: intext-citation");
  });

  it("prints style metadata as JSON for unit --json", async () => {
    const result = await cli("unit", "--style", style, "--json");
    expect(result.exitCode).to.equal(EXIT_OK);
    const payload = JSON.parse(result.stdout);
    expect(payload.INFO.id).to.equal("testkit-numeric-minimal");
    expect(payload.styleOptionParams).to.deep.equal([
      {
        id: "annotate",
        label: "Annotate citations",
        kind: "state",
        description: "Append a marker after every citation",
        defaultValue: false,
      },
    ]);
    expect(payload.citationParams).to.deep.equal([]);
    expect(payload.citeParams).to.deep.equal([]);
    expect(payload.diagnostics).to.deep.equal([]);
  });

  it("loads metadata without running generate", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "banyan-unit-"));
    try {
      const file = path.join(dir, "needs-context.js");
      await writeFile(
        file,
        `const INFO = {
  id: "needs-context",
  title: "Needs Context",
  description: "",
  citationType: "intext-citation",
  creator: [],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "",
};
function generate() {
  return { citations: [{ id: contexts[0].id, content: text("x") }], bibliography: [] };
}
`,
        "utf8",
      );
      const result = await cli("unit", "--style", file, "--json");
      expect(result.exitCode).to.equal(EXIT_OK);
      expect(JSON.parse(result.stdout).INFO.id).to.equal("needs-context");
      expect(result.stderr).to.equal("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes --options to the style and applies the value", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "banyan-options-"));
    try {
      const optionsFile = path.join(dir, "options.json");
      await writeFile(optionsFile, JSON.stringify({ annotate: true }), "utf8");

      const plain = await cli(
        "run",
        "--style",
        style,
        "--rdf",
        rdf,
        "--items",
        "ITEM0001",
        "--json",
      );
      expect(plain.exitCode).to.equal(EXIT_OK);
      expect(plain.stdout).to.contain("2023");
      // Undeclared input is replaced by the declared default in the report.
      expect(JSON.parse(plain.stdout).styleOptions).to.deep.equal({
        annotate: false,
      });

      const optioned = await cli(
        "run",
        "--style",
        style,
        "--rdf",
        rdf,
        "--items",
        "ITEM0001",
        "--options",
        optionsFile,
        "--json",
      );
      expect(optioned.exitCode).to.equal(EXIT_OK);
      const payload = JSON.parse(optioned.stdout);
      expect(payload.styleOptions).to.deep.equal({ annotate: true });
      expect(payload.result.citations[0].content.text).to.contain(
        "[annotated]",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an --options file that is not a flat object", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "banyan-options-"));
    try {
      const optionsFile = path.join(dir, "options.json");
      await writeFile(optionsFile, JSON.stringify(["annotate"]), "utf8");
      const result = await cli(
        "run",
        "--style",
        style,
        "--rdf",
        rdf,
        "--items",
        "ITEM0001",
        "--options",
        optionsFile,
      );
      expect(result.exitCode).to.equal(EXIT_ERROR);
      expect(result.stderr).to.contain("JSON object");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("dumps parsed items as JSON", async () => {
    const result = await cli("rdf", "dump", "--rdf", rdf, "--json");
    expect(result.exitCode).to.equal(EXIT_OK);
    const items = JSON.parse(result.stdout);
    expect(items).to.have.lengthOf(7);
    expect(items[0].key).to.equal("ITEM0001");
  });

  it("dumps parsed items as text", async () => {
    const result = await cli("rdf", "dump", "--rdf", rdf);
    expect(result.exitCode).to.equal(EXIT_OK);
    expect(result.stdout).to.contain("#item_1 [journalArticle] key=ITEM0001");
    expect(result.stdout).to.contain("  creator(author): 张, 伟");
  });

  it("builds a round-tripped document into a file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "banyan-rdf-"));
    try {
      const out = path.join(dir, "rebuilt.rdf");
      const result = await cli("rdf", "build", "--rdf", rdf, "--out", out);
      expect(result.exitCode).to.equal(EXIT_OK);
      expect(result.stdout).to.contain("Wrote");
      const rebuilt = await readFile(out, "utf8");
      expect(rebuilt).to.contain("<z:itemType>journalArticle</z:itemType>");
      expect(rebuilt).to.contain("</rdf:RDF>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires a subcommand for rdf", async () => {
    const result = await cli("rdf", "--rdf", rdf);
    expect(result.exitCode).to.equal(EXIT_ERROR);
    expect(result.stderr).to.contain("rdf <dump|build>");
  });
});

describe("cli: simple JSON item database", () => {
  const itemsJson = path.join(fixtures, "items-basic.json");

  it("validates a good database", async () => {
    const result = await cli("items", "validate", "--items-json", itemsJson);
    expect(result.exitCode).to.equal(EXIT_OK);
    expect(result.stdout).to.contain("7 item(s), 1 multilingual group(s)");
  });

  it("reports validation errors with exit code 1", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "banyan-items-"));
    try {
      const file = path.join(dir, "bad.json");
      await writeFile(file, JSON.stringify({ items: [{ title: "no type" }] }));
      const result = await cli("items", "validate", "--items-json", file);
      expect(result.exitCode).to.equal(EXIT_ERROR);
      expect(result.stderr).to.contain("items[0].itemType");
      expect(result.stderr).to.contain("error");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("dumps the normalized records", async () => {
    const result = await cli("items", "dump", "--items-json", itemsJson);
    expect(result.exitCode).to.equal(EXIT_OK);
    expect(result.stdout).to.contain("ITEM0001 [journalArticle]");
    expect(result.stdout).to.contain("publicationTitle: 物理学报");
    expect(result.stdout).to.contain("creators: author:张, 伟");
    expect(result.stdout).to.contain("multilingual: ITEM0003+ITEM0004");
  });

  it("prints the JSON Schema", async () => {
    const result = await cli("items", "schema");
    expect(result.exitCode).to.equal(EXIT_OK);
    const schema = JSON.parse(result.stdout) as {
      $defs: Record<string, unknown>;
    };
    expect(schema.$defs.record).to.be.an("object");
  });

  it("runs a style from a JSON database", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--items-json",
      itemsJson,
      "--contexts",
      contexts,
      "--json",
    );
    expect(result.exitCode).to.equal(EXIT_OK);
    const payload = JSON.parse(result.stdout);
    expect(payload.dataSource).to.equal("json");
    expect(payload.result.citations).to.have.lengthOf(4);
    expect(payload.result.citations[0].content.text).to.contain("张");
    expect(payload.result.bibliography).to.have.lengthOf(6);
  });

  it("rejects using --rdf and --items-json together", async () => {
    const result = await cli(
      "run",
      "--style",
      style,
      "--rdf",
      rdf,
      "--items-json",
      itemsJson,
      "--contexts",
      contexts,
    );
    expect(result.exitCode).to.equal(EXIT_ERROR);
    expect(result.stderr).to.contain("not both");
  });

  it("requires --items-json for the items command", async () => {
    const result = await cli("items", "validate");
    expect(result.exitCode).to.equal(EXIT_ERROR);
    expect(result.stderr).to.contain("--items-json is required");
  });
});
