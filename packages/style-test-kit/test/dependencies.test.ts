import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  analyzeDependencies,
  createTestKitStyleResolver,
  dependencyReportHasErrors,
} from "../src/index";
import { runCli } from "../src/cli";
import { MAX_RESOURCE_BYTES } from "@banyan/style-contract";

/**
 * Style directories as a dependency graph. Every case builds a real directory
 * tree, loads it through the core, and checks what a host can actually resolve:
 * the resolver's confinement, and the cross-file issues `deps` reports.
 */

const temporaryRoots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "banyan-deps-"));
  temporaryRoots.push(root);
  return root;
}

after(async function () {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

interface StyleSpec {
  id: string;
  dependencies?: string[];
  resources?: { id: string; path: string; format: string; raw?: string }[];
}

function source(spec: StyleSpec): string {
  const lines = [
    `const INFO = {
  id: ${JSON.stringify(spec.id)},
  title: ${JSON.stringify(spec.id)},
  description: "",
  citationType: "intext-citation",
  creator: [],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-01-01",
};`,
  ];
  if (spec.dependencies?.length) {
    lines.push(
      `const STYLE_DEPENDENCIES = [${spec.dependencies
        .map((id) => `{ id: ${JSON.stringify(id)} }`)
        .join(", ")}];`,
    );
  }
  if (spec.resources?.length) {
    lines.push(
      `const STYLE_RESOURCES = [${spec.resources
        .map(
          (resource) =>
            `{ id: ${JSON.stringify(resource.id)}, path: ${JSON.stringify(
              resource.path,
            )}, format: ${JSON.stringify(resource.format)}${
              resource.raw ? `, validate: ${resource.raw}` : ""
            } }`,
        )
        .join(", ")}];`,
    );
  }
  lines.push(
    `function generate() {
  return { citations: [], bibliography: [] };
}`,
  );
  return lines.join("\n");
}

async function writeStyle(
  root: string,
  spec: StyleSpec,
  files: Record<string, string> = {},
): Promise<string> {
  const dir = path.join(root, spec.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "style.js"), source(spec), "utf8");
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return dir;
}

describe("test-kit resolveStyle", function () {
  it("finds a style by INFO.id and confines it to its own directory", async function () {
    const root = await workspace();
    const hostDir = await writeStyle(
      root,
      { id: "host" },
      {
        "assets/parent.json": '["parent"]',
      },
    );
    const guestDir = await writeStyle(
      root,
      { id: "guest" },
      {
        "assets/words.json": '["guest"]',
      },
    );
    void hostDir;

    const resolver = createTestKitStyleResolver([hostDir, guestDir]);
    const resolved = await resolver.resolveStyle("guest");
    assert.ok(resolved);
    assert.match(resolved.code, /"guest"/);

    const bytes = await resolved.readFile!("assets/words.json");
    assert.equal(new TextDecoder().decode(bytes), '["guest"]');

    // The guest's own readFile cannot leave its directory, so the parent's
    // assets are unreachable even by a relative path.
    await assert.rejects(() =>
      resolved.readFile!("../host/assets/parent.json"),
    );
    await assert.rejects(() =>
      resolved.readFile!(path.join(hostDir, "assets", "parent.json")),
    );
    assert.equal(await resolver.resolveStyle("missing"), null);
  });

  it("reports duplicate ids and unreadable directories instead of guessing", async function () {
    const root = await workspace();
    const first = await writeStyle(root, { id: "same" });
    const second = await writeStyle(path.join(root, "other"), { id: "same" });

    const report = await analyzeDependencies([first, second]);
    assert.equal(report.styles.length, 1);
    assert.ok(
      report.issues.some((issue) => issue.kind === "duplicate-id"),
      JSON.stringify(report.issues),
    );
    assert.equal(dependencyReportHasErrors(report), true);
  });
});

describe("deps analysis", function () {
  it("accepts a resolvable graph with a readable resource", async function () {
    const root = await workspace();
    const host = await writeStyle(root, {
      id: "host",
      dependencies: ["guest"],
    });
    const guest = await writeStyle(
      root,
      {
        id: "guest",
        resources: [
          {
            id: "words",
            path: "assets/words.json",
            format: "json",
            raw: "function (data) { return Array.isArray(data) || 'expected an array'; }",
          },
        ],
      },
      { "assets/words.json": '["a","b"]' },
    );

    const report = await analyzeDependencies([host, guest]);
    assert.deepEqual(report.issues, []);
    assert.equal(dependencyReportHasErrors(report), false);
    assert.deepEqual(report.styles.map((style) => style.id).sort(), [
      "guest",
      "host",
    ]);
  });

  it("reports a missing dependency", async function () {
    const root = await workspace();
    const host = await writeStyle(root, {
      id: "host",
      dependencies: ["ghost"],
    });

    const report = await analyzeDependencies([host]);
    const issue = report.issues.find(
      (entry) => entry.kind === "missing-dependency",
    );
    assert.equal(issue?.target, "ghost");
    assert.equal(issue?.severity, "error");
  });

  it("reports a cycle once", async function () {
    const root = await workspace();
    const a = await writeStyle(root, { id: "a", dependencies: ["b"] });
    const b = await writeStyle(root, { id: "b", dependencies: ["a"] });

    const report = await analyzeDependencies([a, b]);
    const cycles = report.issues.filter((issue) => issue.kind === "cycle");
    assert.equal(cycles.length, 1);
    assert.match(cycles[0]!.message, /a -> b -> a/);
  });

  it("reports a chain past the depth limit", async function () {
    const root = await workspace();
    const dirs: string[] = [];
    // a -> b -> c -> d: four styles, one past the three-style limit.
    dirs.push(await writeStyle(root, { id: "a", dependencies: ["b"] }));
    dirs.push(await writeStyle(root, { id: "b", dependencies: ["c"] }));
    dirs.push(await writeStyle(root, { id: "c", dependencies: ["d"] }));
    dirs.push(await writeStyle(root, { id: "d" }));

    const report = await analyzeDependencies(dirs);
    const depth = report.issues.filter((issue) => issue.kind === "depth");
    assert.equal(depth.length, 1);
    assert.match(depth[0]!.message, /a -> b -> c -> d/);
  });

  it("reports missing, oversized, unparsable and rejected resources", async function () {
    const root = await workspace();
    const dir = await writeStyle(
      root,
      {
        id: "host",
        resources: [
          { id: "gone", path: "assets/gone.json", format: "json" },
          { id: "bad", path: "assets/bad.json", format: "json" },
          {
            id: "rejected",
            path: "assets/rejected.json",
            format: "json",
            raw: "function () { return 'nope'; }",
          },
        ],
      },
      {
        "assets/bad.json": "{ not json",
        "assets/rejected.json": '{"a":1}',
      },
    );
    // A fourth style declares a file larger than the core cap.
    const oversized = await writeStyle(path.join(root, "oversized"), {
      id: "oversized",
      resources: [{ id: "huge", path: "huge.bin", format: "text" }],
    });
    await writeFile(
      path.join(oversized, "huge.bin"),
      Buffer.alloc(MAX_RESOURCE_BYTES + 1),
    );

    const report = await analyzeDependencies([dir, oversized]);
    const kinds = report.issues.map((issue) => issue.kind).sort();
    assert.deepEqual(kinds, [
      "resource-invalid",
      "resource-invalid",
      "resource-missing",
      "resource-too-large",
    ]);
  });

  it("classifies a host size refusal as too-large, not missing", async function () {
    const root = await workspace();
    const dir = await writeStyle(root, {
      id: "host",
      resources: [{ id: "huge", path: "huge.bin", format: "text" }],
    });
    // Above the directory's configured cap, so the host refuses the read before
    // the core can compare sizes. The refusal must not read as "missing".
    await writeFile(
      path.join(dir, "huge.bin"),
      Buffer.alloc(MAX_RESOURCE_BYTES + 1),
    );

    const report = await analyzeDependencies([dir], {
      maxFileBytes: 1024,
    });
    const kinds = report.issues.map((issue) => issue.kind);
    assert.deepEqual(kinds, ["resource-too-large"]);
  });

  it("reports a style whose top level never returns instead of hanging", async function () {
    const root = await workspace();
    const dir = path.join(root, "loop");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "style.js"),
      "while (true) {}\nconst INFO = {};\nfunction generate() {}",
      "utf8",
    );

    const report = await analyzeDependencies([dir], {
      evaluateTimeoutMs: 200,
    });
    assert.equal(report.issues.length, 1);
    assert.equal(report.issues[0]!.kind, "load");
    assert.equal(dependencyReportHasErrors(report), true);
  });

  it("exits non-zero from the CLI when the graph has an error", async function () {
    const root = await workspace();
    const host = await writeStyle(root, {
      id: "host",
      dependencies: ["ghost"],
    });

    const out: string[] = [];
    const err: string[] = [];
    const io = {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
    };

    const ok = await runCli(["deps", "--style-path", host, "--json"], io);
    assert.equal(ok, 1);
    const report = JSON.parse(out.join("\n"));
    assert.equal(report.styles.length, 1);
    assert.ok(
      report.issues.some(
        (issue: { kind: string }) => issue.kind === "missing-dependency",
      ),
    );

    const noPaths = {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
    };
    assert.equal(await runCli(["deps"], noPaths), 1);
    assert.match(err.join("\n"), /--style-path/);
  });
});
