/**
 * Remove `dist/` before a build.
 *
 * `tsc` never deletes the output of a source file that no longer exists, so an
 * incremental build would leave an orphan module behind — still reachable
 * through the wildcard exports and invisible to `check:dist`. A clean build
 * makes a deleted source show up as a deleted artifact, which the committed
 * `dist/` then records.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await rm(path.join(root, "dist"), { recursive: true, force: true });
