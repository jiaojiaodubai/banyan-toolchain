/**
 * Stable identity for the contract's source, not its gitignored build output.
 *
 * A consumer can check out the toolchain revision named by the manifest and
 * recompute this value from tracked files. Git blob bytes are used instead of
 * worktree bytes so line-ending conversion cannot change the result.
 *
 * Included inputs: package.json, both tsconfigs, and every tracked file under
 * src/. Tests, docs and generated dist/ are not part of the contract identity.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONTRACT_PACKAGE = "packages/style-contract";

function git(rootDir, args, { buffer = false } = {}) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: buffer ? undefined : "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isBuildInput(relative) {
  return (
    relative === "package.json" ||
    relative === "tsconfig.json" ||
    relative === "tsconfig.build.json" ||
    relative.startsWith("src/")
  );
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function hashContractSource(rootDir) {
  const entries = git(rootDir, ["ls-files", "-s", "-z", "--", CONTRACT_PACKAGE])
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode, object] = entry.slice(0, tab).split(" ");
      const repositoryPath = entry.slice(tab + 1);
      return {
        mode,
        object,
        repositoryPath,
        relative: repositoryPath.slice(CONTRACT_PACKAGE.length + 1),
      };
    })
    .filter((entry) => isBuildInput(entry.relative))
    .sort((left, right) =>
      left.relative < right.relative
        ? -1
        : left.relative > right.relative
          ? 1
          : 0,
    );

  if (!entries.length) {
    throw new Error(
      `no tracked contract build inputs under ${CONTRACT_PACKAGE}`,
    );
  }

  const hash = createHash("sha256");
  for (const entry of entries) {
    const content = git(rootDir, ["cat-file", "blob", entry.object], {
      buffer: true,
    });
    hash.update(`${entry.relative}\0${entry.mode}\0${sha256(content)}\n`);
  }
  return hash.digest("hex");
}

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(hashContractSource(rootDir));
}
