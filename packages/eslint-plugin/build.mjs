/**
 * Build the self-contained artifacts the host copies into its style editor.
 *
 * The bundle may inline `@banyan/style-contract` (pure facts and functions) and
 * the globals extractor, but must not inline the core runtime, ESLint itself, or
 * any Zotero host code. Node built-ins stay external; the host provides them.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, "dist");
const packageJSON = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8"),
);
const contract = await import("@banyan/style-contract");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [
    path.join(rootDir, "src", "eslint-plugin-banyan-style.mjs"),
    path.join(rootDir, "src", "eslint-style-utils-globals.mjs"),
  ],
  outdir: distDir,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: false,
  legalComments: "none",
  banner: {
    js: `/* eslint-disable */
// Bundled from eslint-plugin-banyan-style@${packageJSON.version} and @banyan/style-contract. Do not edit.`,
  },
});

for (const file of [
  "eslint-plugin-banyan-style.d.ts",
  "eslint-style-utils-globals.d.ts",
]) {
  await copyFile(path.join(rootDir, "src", file), path.join(distDir, file));
}

await writeFile(
  path.join(distDir, "build-metadata.json"),
  `${JSON.stringify(
    {
      package: "eslint-plugin-banyan-style",
      version: packageJSON.version,
      schemaRevision: contract.SCHEMA_FACTS.schemaRevision,
      diagnostics: contract.CONTRACT_DIAGNOSTIC_IDS.length,
      format: "esm",
      target: "node20",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`built ${path.relative(process.cwd(), distDir)}`);
