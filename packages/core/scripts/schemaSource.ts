/**
 * Access to the schema repositories the core generates its authoritative data
 * from.
 *
 * Both are development dependencies without a `package.json` (installed as git
 * dependencies, see `package.json`). Generated artifacts are committed, so
 * nothing reads them at runtime: the dependencies exist to regenerate and to
 * verify that the committed artifacts still match.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import prettier from "prettier";

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/** Read a file from the repository, given a path relative to its root. */
export async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot(), relativePath), "utf8");
}

/** Format a generated artifact the way the repository formats code. */
export async function formatGenerated(
  relativePath: string,
  text: string,
): Promise<string> {
  const target = path.join(repoRoot(), relativePath);
  const options = (await prettier.resolveConfig(target)) ?? {};
  return prettier.format(text, { ...options, filepath: target });
}

/** Write a generated artifact. */
export async function writeGenerated(
  relativePath: string,
  text: string,
): Promise<void> {
  const target = path.join(repoRoot(), relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await formatGenerated(relativePath, text), "utf8");
}

/** True when the module runs as the process entry point, not as an import. */
export function isEntryPoint(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  return entry ? pathToFileURL(entry).href === importMetaUrl : false;
}
