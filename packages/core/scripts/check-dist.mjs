/**
 * Fail when the committed build output does not match a fresh build.
 *
 * `dist/` is committed because `link:` and pinned-Git consumers run no build
 * step, so a stale artifact silently ships. `git diff` alone would miss a new
 * file, hence `git status --porcelain` — it reports modified, added and deleted
 * paths alike. Meaningful on a clean CI checkout; locally, commit `dist/` first.
 */
import { execFileSync } from "node:child_process";

const status = execFileSync("git", ["status", "--porcelain", "--", "dist"], {
  encoding: "utf8",
}).trim();

if (status) {
  throw new Error(
    `dist/ is stale; rebuild and commit the result:\n${status}\n\n` +
      "If you only changed sources, run `pnpm build`.",
  );
}
