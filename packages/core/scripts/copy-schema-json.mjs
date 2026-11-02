/**
 * Copy the generated schema JSON into `dist`, so the package can expose it
 * through subpath exports (`@banyan/core/schema/zotero-schema.json`,
 * `@banyan/core/schema/csl-schema.json`).
 *
 * The JSON is generated and committed under `src/schema`; `tsc` does not emit
 * non-TypeScript assets, hence this step.
 */
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "src", "schema");
const targetDir = path.join(root, "dist", "schema");

await mkdir(targetDir, { recursive: true });

for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || path.extname(entry.name) !== ".json") continue;
  await copyFile(
    path.join(sourceDir, entry.name),
    path.join(targetDir, entry.name),
  );
}
