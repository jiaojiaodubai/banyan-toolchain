import { expect } from "chai";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EXIT_ERROR, EXIT_OK, runCli } from "../src/cli";
import { lintStyleSource } from "../src/lint";

const validInfo = `
const INFO = {
  id: "test-style",
  title: "Test Style",
  description: "For lint tests",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Tester" }],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-10-25",
};
`;

async function runCliWith(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const exitCode = await runCli(args, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { stdout: out.join("\n"), stderr: err.join("\n"), exitCode };
}

describe("style lint", () => {
  it("accepts the documented minimal style", async () => {
    const messages = await lintStyleSource(`
${validInfo}
function generate() {
  return {
    citations: contexts.map((context) => ({ id: context.id, content: "" })),
    bibliography: [],
  };
}
`);

    expect(messages).to.deep.equal([]);
  });

  it("reports a missing generate entry", async () => {
    const messages = await lintStyleSource(`${validInfo}`);

    expect(
      messages.some(
        (message) => message.ruleId === "banyanStyle/require-style-contract",
      ),
    ).to.equal(true);
  });

  it("accepts a named function referenced by ITEM_FIELD_PRESETS.visible", async () => {
    const messages = await lintStyleSource(`
${validInfo}
function statuteItem(item) { return item.itemType === "statute"; }
const ITEM_FIELD_PRESETS = [
  { id: "genre-law", label: "法律", visible: statuteItem, fields: { genre: "law" } },
];
function generate() { return { citations: [], bibliography: [] }; }
`);

    expect(messages).to.deep.equal([]);
  });

  describe("cli", () => {
    it("exits 0 for a clean style", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "banyan-lint-"));
      const style = path.join(dir, "style.js");
      try {
        await writeFile(
          style,
          `
${validInfo}
function generate() { return { citations: [], bibliography: [] }; }
`,
          "utf8",
        );
        const result = await runCliWith("lint", "--style", style);
        expect(result.exitCode).to.equal(EXIT_OK);
        expect(result.stdout).to.contain("No lint issues");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("exits 1 when a style has an error", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "banyan-lint-"));
      const style = path.join(dir, "style.js");
      try {
        await writeFile(style, `${validInfo}`, "utf8");
        const result = await runCliWith("lint", "--style", style, "--json");
        expect(result.exitCode).to.equal(EXIT_ERROR);
        const messages = JSON.parse(result.stdout) as {
          ruleId: string | null;
          severity: number;
        }[];
        expect(
          messages.some(
            (message) =>
              message.ruleId === "banyanStyle/require-style-contract" &&
              message.severity === 2,
          ),
        ).to.equal(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
