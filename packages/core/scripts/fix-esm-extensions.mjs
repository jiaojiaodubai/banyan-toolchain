import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(scriptDir, "..", "dist");

/** Relative specifiers a compiled file imports (static, side-effect, dynamic). */
const SPECIFIER_PATTERNS = [
  /(from\s+["'])(\.[^"']+)(["'])/g,
  /(import\(\s*["'])(\.[^"']+)(["']\s*\))/g,
  /(import\s+["'])(\.[^"']+)(["'])/g,
];

/**
 * Give an extensionless relative specifier its ESM form: `./x` -> `./x.js`, and
 * a directory import -> `./dir/index.js` (ESM has no directory resolution, and
 * `export * from "./schema"` is exactly that case). A specifier that already
 * carries an extension is left alone, including non-JavaScript assets.
 */
async function fixSpecifier(specifier, fromFile) {
  if (path.extname(specifier)) {
    return specifier;
  }
  const target = path.resolve(path.dirname(fromFile), specifier);
  try {
    if ((await stat(target)).isDirectory()) {
      return `${specifier}/index.js`;
    }
  } catch {
    // Not a directory: treat it as a file the compiler emitted.
  }
  return `${specifier}.js`;
}

function relativeSpecifiers(source) {
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      found.add(match[2]);
    }
  }
  return found;
}

/** A leftover extensionless specifier means the pattern list above is stale. */
function assertNoBareSpecifiers(source, filePath) {
  for (const specifier of relativeSpecifiers(source)) {
    if (!path.extname(specifier)) {
      throw new Error(
        `fix-esm-extensions: ${path.relative(distDir, filePath)} still imports "${specifier}" without an extension; add the import form to SPECIFIER_PATTERNS.`,
      );
    }
  }
}

/**
 * Files whose relative specifiers need an explicit `.js` extension: emitted
 * modules and declaration files. A declaration import such as `./item` must
 * become `./item.js` so `node16`/`nodenext` consumers resolve `item.d.ts`.
 */
function needsRewrite(name) {
  return name.endsWith(".js") || name.endsWith(".d.ts");
}

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(entryPath);
      continue;
    }
    if (!needsRewrite(entry.name)) {
      continue;
    }

    const source = await readFile(entryPath, "utf8");

    // Resolve every import once, then rewrite in one pass per pattern.
    const resolved = new Map();
    for (const specifier of relativeSpecifiers(source)) {
      resolved.set(specifier, await fixSpecifier(specifier, entryPath));
    }

    let fixed = source;
    for (const pattern of SPECIFIER_PATTERNS) {
      fixed = fixed.replace(
        pattern,
        (whole, prefix, specifier, suffix) =>
          `${prefix}${resolved.get(specifier) ?? specifier}${suffix}`,
      );
    }

    if (fixed !== source) {
      await writeFile(entryPath, fixed, "utf8");
    }
    assertNoBareSpecifiers(fixed, entryPath);
  }
}

await visit(distDir);
