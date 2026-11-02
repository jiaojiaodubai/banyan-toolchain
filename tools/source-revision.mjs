/**
 * The Git revision a toolchain artifact set was built from.
 *
 * `HEAD` cannot be used: the manifest is committed after the artifacts it
 * describes, so regenerating at the manifest commit would name a revision that
 * did not exist when the artifacts were built and would never round-trip
 * cleanly. Instead, use the newest commit that changed a build input. The
 * manifest, root documentation and CI configuration are deliberately excluded,
 * so a manifest-only, root-docs-only or CI-only commit does not move the
 * revision. Package documentation is packed into the artifacts, so it stays a
 * build input.
 */
import { execFileSync } from "node:child_process";

const EXCLUDED_PATHS = [
  ":(exclude,top)toolchain.manifest.json",
  ":(exclude,top)docs/**",
  ":(exclude,top)internal/**",
  ":(exclude,top,glob)*.md",
  ":(exclude,top).github/**",
];

function git(rootDir, args) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function sourceRevision(rootDir, { requireClean = true } = {}) {
  if (requireClean) {
    const dirty = git(rootDir, [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
      ...EXCLUDED_PATHS,
    ]).trim();
    if (dirty) {
      throw new Error(
        `build inputs are dirty; commit them before generating the manifest:\n${dirty}`,
      );
    }
  }

  const revision = git(rootDir, [
    "log",
    "-1",
    "--format=%H",
    "--",
    ".",
    ...EXCLUDED_PATHS,
  ]).trim();
  if (!revision) {
    throw new Error(
      "no build-input commit found; fetch full history (git fetch --unshallow or fetch-depth: 0) before generating or checking the manifest",
    );
  }
  return revision;
}
