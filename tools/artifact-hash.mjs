/**
 * Canonical content hash for a packed artifact.
 *
 * pnpm rewrites workspace dependencies into ordinary semver ranges when
 * packing, and the order of those entries can vary between runs. Hashing the
 * gzip bytes would therefore make an unchanged source tree look different.
 * Extract the tarball, canonicalize JSON object key order, and hash the sorted
 * entry list plus each entry's content. Paths are ordered by code unit, never
 * locale collation, so the digest is independent of the host's ICU locale.
 * Directory and symlink entries are part of the digest; symlink targets are
 * hashed rather than followed, and unsupported entry types fail instead of
 * being silently omitted. Tarball metadata and compression are not part of the
 * identity.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(base, absolute).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      items.push({ absolute, kind: "directory", path: relative });
      items.push(...(await walk(absolute, base)));
    } else if (entry.isFile()) {
      items.push({ absolute, kind: "file", path: relative });
    } else if (entry.isSymbolicLink()) {
      items.push({
        absolute,
        kind: "symlink",
        path: relative,
        target: (await readlink(absolute)).replaceAll("\\", "/"),
      });
    } else {
      throw new Error(`unsupported archive entry type at ${relative}`);
    }
  }
  return items;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

export async function hashArtifact(file) {
  const scratch = await mkdtemp(path.join(tmpdir(), "banyan-artifact-"));
  try {
    // Feed the archive through stdin and extract from the scratch directory.
    // GNU tar on Windows treats the `C:` in an absolute archive path as a
    // remote host, and also rewrites backslashes in `-C`; passing no path at
    // all keeps this portable across bsdtar and GNU tar.
    execFileSync("tar", ["-xzf", "-"], {
      cwd: scratch,
      input: await readFile(file),
      stdio: ["pipe", "ignore", "inherit"],
    });
    const packageDir = path.join(scratch, "package");
    const hash = createHash("sha256");
    const entries = (await walk(packageDir)).sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
    for (const entry of entries) {
      if (entry.kind === "directory") {
        hash.update(`directory\0${entry.path}\n`);
        continue;
      }
      if (entry.kind === "symlink") {
        const target = Buffer.from(entry.target).toString("hex");
        hash.update(`symlink\0${entry.path}\0${target}\n`);
        continue;
      }
      let content = await readFile(entry.absolute);
      if (entry.path === "package.json") {
        const canonical = sortKeys(JSON.parse(content.toString("utf8")));
        content = Buffer.from(`${JSON.stringify(canonical, null, 2)}\n`);
      }
      const fileHash = createHash("sha256").update(content).digest("hex");
      hash.update(`file\0${entry.path}\0${fileHash}\n`);
    }
    return hash.digest("hex");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function hashFile(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
