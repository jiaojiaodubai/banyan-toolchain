/**
 * Install the packed artifacts into a throwaway consumer and import them.
 *
 * This is the gate that catches "works because the workspace symlinks the
 * packages": pnpm rewrites `workspace:*` to versions when packing, so a
 * consumer outside the workspace must map the workspace package names to the
 * tarballs. The test exercises that mapping, the core/contract runtime import
 * and the built lint bundle.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARTIFACT_PACKAGES, artifactFileName } from "./artifact-names.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const artifactsDir = path.join(rootDir, "artifacts");
const consumerDir = path.join(artifactsDir, ".smoke-consumer");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, cwd, options = {}) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: options.shell ?? process.platform === "win32",
  });
}

if (!process.env.BANYAN_SMOKE_KEEP) {
  await rm(consumerDir, { recursive: true, force: true });
}
await mkdir(consumerDir, { recursive: true });

const manifest = JSON.parse(
  await readFile(path.join(rootDir, "toolchain.manifest.json"), "utf8"),
);
const files = {};
for (const [key, packageName] of Object.entries(ARTIFACT_PACKAGES)) {
  const version = manifest.packages[packageName];
  if (!version) {
    throw new Error(`manifest.packages is missing ${packageName}`);
  }
  const expected = artifactFileName(packageName, version);
  if (manifest.artifacts[key] !== expected) {
    throw new Error(
      `manifest.artifacts.${key} ${manifest.artifacts[key]} != ${expected}`,
    );
  }
  files[key.replace(/Artifact$/, "")] = expected;
}
const testKitVersion = manifest.packages["@banyan/style-test-kit"];
const absolute = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [
    key,
    path.join(artifactsDir, file).replaceAll("\\", "/"),
  ]),
);
const overrides = {
  overrides: {
    "@banyan/style-contract": `file:${absolute.contract}`,
    "@banyan/core": `file:${absolute.core}`,
    "eslint-plugin-banyan-style": `file:${absolute.lint}`,
  },
};

await writeFile(
  path.join(consumerDir, "package.json"),
  `${JSON.stringify(
    {
      name: "banyan-artifact-smoke",
      private: true,
      type: "module",
      // pnpm 10 reads this form; pnpm 11 ignores it in favour of the workspace
      // settings file below.
      pnpm: overrides,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await writeFile(
  path.join(consumerDir, "pnpm-workspace.yaml"),
  `overrides:\n${Object.entries(overrides.overrides)
    .map(([name, spec]) => `  "${name}": "${spec}"`)
    .join("\n")}\n`,
  "utf8",
);

const tarballs = Object.values(files).map((file) =>
  path.join(artifactsDir, file),
);
run(pnpm, ["add", ...tarballs], consumerDir);

const probe = `
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import * as core from "@banyan/core";
import * as contract from "@banyan/style-contract";
import plugin from "eslint-plugin-banyan-style";

const require = createRequire(import.meta.url);
const testKit = require("@banyan/style-test-kit/package.json");
assert.equal(typeof core.normalizeStyleParams, "function");
assert.equal(typeof contract.normalizeExtraKey, "function");
assert.match(contract.SCHEMA_FACTS.schemaRevision, /^zotero-\\d+\\+csl-/);
assert.equal(Object.keys(plugin.rules).length, 8);
assert.equal(testKit.version, ${JSON.stringify(testKitVersion)});
console.log(
  "artifact consumer ok:",
  contract.SCHEMA_FACTS.schemaRevision,
  Object.keys(plugin.rules).length,
  "rules",
  testKit.version,
);
`;

run(process.execPath, ["--input-type=module", "-e", probe], consumerDir, {
  shell: false,
});

const lock = await readFile(path.join(consumerDir, "pnpm-lock.yaml"), "utf8");
if (!lock.includes("@banyan/style-contract@file:")) {
  throw new Error("pnpm did not resolve the contract artifact override");
}

if (!process.env.BANYAN_SMOKE_KEEP) {
  await rm(consumerDir, { recursive: true, force: true });
}
console.log("artifact install smoke test passed");
