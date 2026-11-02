/**
 * Normalize the `STYLE_DEPENDENCIES` export.
 *
 * A dependency is always optional: the declaration only says which ids
 * `callStyle()` may resolve, so the runtime keeps what it can use and reports
 * the rest. Keeping this list static is what lets a host preflight an install
 * and lets test-kit build a dependency graph without running the style.
 */
import type { StyleDependency } from "../types/style";
import { withDetail, type StyleMessageReporter } from "../messages";
import type { SandboxContext } from "../host";
import {
  DEPENDENCY_KEYS,
  isReservedDeclarationKey,
  MAX_STYLE_DEPENDENCIES,
} from "@banyan/style-contract";

export const DEPENDENCY_SOURCE = "dependencies";

const EXPORT = "STYLE_DEPENDENCIES";

/**
 * Normalize `STYLE_DEPENDENCIES` to host-side entries.
 *
 * `selfId` is the style's own `INFO.id`, used to reject a self-call at
 * declaration time; an unknown id cannot be compared and simply skips the
 * check. Returns `undefined` when nothing usable survives.
 */
export function normalizeStyleDependencies(
  raw: unknown,
  context: SandboxContext,
  messages: StyleMessageReporter,
  selfId?: string,
): StyleDependency[] | undefined {
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
  const out: StyleDependency[] = [];
  const kept = cmp.slice(0, MAX_STYLE_DEPENDENCIES);

  for (const [index, entry] of kept.entries()) {
    const entryMessages = withDetail(messages, {
      declaration: { export: EXPORT, index },
    });
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      entryMessages.report({
        severity: "warning",
        source: DEPENDENCY_SOURCE,
        message: "skipped STYLE_DEPENDENCIES entry that is not an object",
        finding: {
          diagnosticId: "dependency.entry.not-object",
          path: [index],
        },
      });
      continue;
    }

    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (DEPENDENCY_KEYS.has(key)) continue;
      entryMessages.report({
        severity: "warning",
        source: DEPENDENCY_SOURCE,
        message: `STYLE_DEPENDENCIES entry ${
          typeof record.id === "string" && record.id.trim()
            ? `'${record.id.trim()}'`
            : `at index ${index}`
        } has an unknown key '${key}'; ignored`,
        finding: {
          diagnosticId: "declaration.key.unknown",
          path: [index, key],
        },
      });
    }

    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      entryMessages.report({
        severity: "warning",
        source: DEPENDENCY_SOURCE,
        message:
          "skipped STYLE_DEPENDENCIES entry without a non-empty string id",
        finding: { diagnosticId: "dependency.id.invalid", path: [index, "id"] },
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
          path: [index, "id"],
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
          path: [index, "id"],
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
          path: [index, "id"],
          data: { id },
        },
      });
      continue;
    }

    seen.add(id);
    out.push({ id });
  }

  return out.length ? out : undefined;
}
