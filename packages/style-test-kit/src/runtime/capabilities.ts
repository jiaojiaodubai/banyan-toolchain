/**
 * Node implementations of the core's required host capabilities.
 *
 * - `parseHtml` — linkedom (see `dom.ts`);
 * - `readFile` — confined to the configured style directory: absolute or
 *   relative paths are both accepted, but the resolved path must stay inside
 *   it, `..` segments are rejected, symbolic links are refused and a per-file
 *   size limit guards against runaway reads. The style directory is
 *   trusted input; this is a correctness boundary, not a sandbox escape guard;
 * - `resolveMultilingualItems` — the test library's relations.
 */
import { MAX_RESOURCE_BYTES } from "@banyan/style-contract";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  createBanyanRuntimeError,
  type HtmlRootLike,
  type ScriptItem,
  type StyleHostCapabilities,
} from "../banyan";
import { parseHtml } from "./dom";
import type { TestLibrary } from "../library/library";

export interface CapabilityOptions {
  /** Directory `readFile` is confined to (the style's data directory). */
  styleDir: string;
  /** Library backing `resolveMultilingualItems`. */
  library: TestLibrary;
  /** Refuse to read a single file larger than this (default the 4 MiB contract cap). */
  maxFileBytes?: number;
}

function normalizeForContainment(candidate: string): string {
  const normalized = path.normalize(candidate).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInsideDirectory(candidate: string, directory: string): boolean {
  const target = normalizeForContainment(candidate);
  const container = normalizeForContainment(directory);
  return target === container || target.startsWith(`${container}/`);
}

/** Reject parent-directory segments; `.` segments are harmless. */
function hasTraversalSegment(relPath: string): boolean {
  return relPath.split(/[/\\]+/).some((segment) => segment === "..");
}

function resolveWithinStyleDir(styleDir: string, relPath: string): string {
  if (typeof relPath !== "string" || !relPath.trim()) {
    throw new Error("Invalid path to resolve");
  }
  const raw = relPath.trim();
  if (hasTraversalSegment(raw)) {
    throw new Error("Only files in the style directory are allowed");
  }
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(styleDir, raw);
  const normalized = path.normalize(absolute);
  if (!isInsideDirectory(normalized, styleDir)) {
    throw new Error("Only files in the style directory are allowed");
  }
  return normalized;
}

/**
 * Read a file's bytes, refusing links and anything past the size limit.
 *
 * This is the test host's own I/O policy; the core re-checks its 4 MiB
 * resource cap on the returned length.
 */
async function readBytesWithin(
  fullPath: string,
  relPath: string,
  maxFileBytes: number,
): Promise<Uint8Array> {
  const info = await lstat(fullPath);
  if (info.isSymbolicLink()) {
    throw createBanyanRuntimeError(
      `Refusing to follow a symbolic link: ${relPath}.`,
      { code: "host-capability" },
    );
  }
  if (!info.isFile()) {
    throw new Error(`Not a file: ${relPath}`);
  }
  if (info.size > maxFileBytes) {
    // The marker is what lets the core report `too-large` instead of `missing`: a
    // host refusal and a missing file are both "the read failed", and only the
    // host knows which. Added as a property so the message stays readable.
    const error = createBanyanRuntimeError(
      `Refusing to read ${relPath}: file exceeds the ${maxFileBytes}-byte limit.`,
      { code: "host-capability" },
    ) as Error & { reason?: string; limit?: number };
    error.reason = "too-large";
    error.limit = maxFileBytes;
    throw error;
  }
  return new Uint8Array(await readFile(fullPath));
}

export function createTestKitCapabilities(
  options: CapabilityOptions,
): StyleHostCapabilities {
  return {
    parseHtml(html: string): HtmlRootLike | null {
      return parseHtml(html);
    },

    readFile: createConfinedReadFile(options.styleDir, options.maxFileBytes),

    async resolveMultilingualItems(item) {
      return options.library
        .resolveMultilingualItems(item)
        .map((resolved) => resolved as unknown as ScriptItem);
    },
  };
}

/**
 * A `readFile` confined to one directory.
 *
 * Shared by the style's own host and by `resolveStyle()`, so a delegated style
 * reads its own directory and a host cannot forget the confinement in one of
 * the two places.
 */
export function createConfinedReadFile(
  styleDir: string,
  maxFileBytes = MAX_RESOURCE_BYTES,
): (relPath: string) => Promise<Uint8Array> {
  const root = path.resolve(styleDir);

  return async (relPath: string): Promise<Uint8Array> => {
    const fullPath = resolveWithinStyleDir(root, relPath);
    return readBytesWithin(fullPath, relPath, maxFileBytes);
  };
}
