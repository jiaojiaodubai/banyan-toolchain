/**
 * Exercise the shipped lint bundle with ESLint 10.
 *
 * The unit suite runs against the workspace's ESLint 9. `supportedEslint` in
 * the manifest names both majors, so this script replays the complete
 * conformance corpus through the ESLint 10 API to keep that claim backed.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint10";
import {
  createBanyanStyleConfig,
  diagnosticIdFor,
} from "../packages/eslint-plugin/dist/eslint-plugin-banyan-style.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixtureDir = path.join(rootDir, "packages", "conformance", "fixtures");
const typingsDir = path.join(rootDir, "packages", "core", "dist", "types");
const require = createRequire(import.meta.url);
const eslintVersion = require("eslint10/package.json").version;

assert.match(
  eslintVersion,
  /^10\./,
  `expected ESLint 10, got ${eslintVersion}`,
);

const fixtures = await Promise.all(
  (await readdir(fixtureDir))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map(async (file) =>
      JSON.parse(await readFile(path.join(fixtureDir, file), "utf8")),
    ),
);

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [createBanyanStyleConfig({ typingsDir })],
});

for (const fixture of fixtures) {
  const [result] = await eslint.lintText(fixture.source.join("\n"), {
    filePath: "style.js",
  });
  const ids = [];
  for (const message of result.messages) {
    if (!message.ruleId?.startsWith("banyanStyle/")) continue;
    const id = diagnosticIdFor(message.ruleId, message.messageId);
    assert.ok(
      id,
      `${fixture.id}: unmapped ${message.ruleId}/${message.messageId}`,
    );
    ids.push(id);
  }
  assert.deepEqual(
    [...new Set(ids)].sort(),
    [...new Set(fixture.expect.lint)].sort(),
    `${fixture.id} under ESLint ${eslintVersion}`,
  );
}

console.log(
  `ESLint ${eslintVersion}: ${fixtures.length} conformance fixtures passed`,
);
