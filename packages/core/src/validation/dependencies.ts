/**
 * Normalize the `STYLE_DEPENDENCIES` export.
 *
 * A dependency is always optional: the declaration only says which ids
 * `callStyle()` may resolve, so the runtime keeps what it can use and reports
 * the rest. Keeping this list static is what lets a host preflight an install
 * and lets test-kit build a dependency graph without running the style.
 */
import { withDetail, type StyleMessageReporter } from "../messages";
import type { SandboxContext } from "../host";
import {
  isReservedDeclarationKey,
  MAX_STYLE_DEPENDENCIES,
} from "@banyan/style-contract";

export const DEPENDENCY_SOURCE = "dependencies";

const EXPORT = "STYLE_DEPENDENCIES";

/**
 * Normalize `STYLE_DEPENDENCIES` to style ids.
 *
 * The declaration is a plain `string[]`: the only information a dependency
 * carries is the id `callStyle()` resolves, so an entry object would add a key
 * with no second field to justify it. `selfId` is the style's own `INFO.id`,
 * used to reject a self-call at declaration time; an unknown id cannot be
 * compared and simply skips the check. Returns `undefined` when nothing usable
 * survives.
 */
export function normalizeStyleDependencies(
  raw: unknown,
  context: SandboxContext,
  messages: StyleMessageReporter,
  selfId?: string,
): string[] | undefined {
  let cmp: unknown;
  try {
    cmp = context.exportValue(raw);
  } catch {
    cmp = raw;
  }

  const listMessages = withDetail(messages, {
    declaration: { export: EXPORT },
  });
  if (!Array.isArray(cmp)) {
    if (cmp !== undefined && cmp !== null) {
      listMessages.report({
        severity: "warning",
        source: DEPENDENCY_SOURCE,
        message: "STYLE_DEPENDENCIES must be an array; ignored",
        finding: { diagnosticId: "dependency.export.not-array", path: [] },
      });
    }
    return undefined;
  }
  if (!cmp.length) return undefined;

  if (cmp.length > MAX_STYLE_DEPENDENCIES) {
    listMessages.report({
      severity: "warning",
      source: DEPENDENCY_SOURCE,
      message: `STYLE_DEPENDENCIES declares ${cmp.length} entries; only the first ${MAX_STYLE_DEPENDENCIES} are kept`,
      finding: {
        diagnosticId: "dependency.limit",
        path: [],
        data: { count: cmp.length, limit: MAX_STYLE_DEPENDENCIES },
      },
    });
  }

  const seen = new Set<string>();
  const out: string[] = [];
  const kept = cmp.slice(0, MAX_STYLE_DEPENDENCIES);

  for (const [index, entry] of kept.entries()) {
    const entryMessages = withDetail(messages, {
      declaration: { export: EXPORT, index },
    });
    if (typeof entry !== "string") {
      entryMessages.report({
        severity: "warning",
        source: DEPENDENCY_SOURCE,
        message: "skipped STYLE_DEPENDENCIES entry that is not a string",
        finding: {
          diagnosticId: "dependency.entry.not-string",
          path: [index],
        },
      });
      continue;
    }

    const id = entry.trim();
    if (!id) {
      entryMessages.report({
        severity: "warning",
        source: DEPENDENCY_SOURCE,
        message:
          "skipped STYLE_DEPENDENCIES entry without a non-empty string id",
        finding: { diagnosticId: "dependency.id.invalid", path: [index] },
      });
      continue;
    }
    const idMessages = withDetail(entryMessages, { declaration: { id } });
    if (isReservedDeclarationKey(id)) {
      idMessages.report({
        severity: "warning",
        source: DEPENDENCY_SOURCE,
        message: `skipped STYLE_DEPENDENCIES id '${id}': reserved declaration key`,
        finding: {
          diagnosticId: "declaration.id.reserved",
          path: [index],
          data: { id },
        },
      });
      continue;
    }
    if (selfId && id === selfId) {
      // Kept in the list on purpose: a direct self-call must fail as `cycle`
      // (the chain already contains this id), not as `undeclared`.
      idMessages.report({
        severity: "warning",
        source: DEPENDENCY_SOURCE,
        message: `STYLE_DEPENDENCIES id '${id}' is this style itself; callStyle() will refuse it as a cycle`,
        finding: {
          diagnosticId: "dependency.id.self",
          path: [index],
          data: { id },
        },
      });
    }
    if (seen.has(id)) {
      idMessages.report({
        severity: "warning",
        source: DEPENDENCY_SOURCE,
        message: `skipped duplicate STYLE_DEPENDENCIES id '${id}'`,
        finding: {
          diagnosticId: "dependency.id.duplicate",
          path: [index],
          data: { id },
        },
      });
      continue;
    }

    seen.add(id);
    out.push(id);
  }

  return out.length ? out : undefined;
}
