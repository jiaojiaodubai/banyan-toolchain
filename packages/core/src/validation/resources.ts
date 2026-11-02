/**
 * Normalize the `STYLE_RESOURCES` export.
 *
 * A resource is a file the style declares up front: an id the style calls it by,
 * a path relative to the style directory, and a format. Declaring it statically
 * is what makes the core able to validate the path, cap the read and let a host
 * or test-kit preflight the files before a document is touched.
 */
import type { ResourceCheckResult } from "../types/style";
import { withDetail, type StyleMessageReporter } from "../messages";
import { isSandboxCallable, type SandboxContext } from "../host";
import { errorMessageOf } from "../sandbox/runtimeErrors";
import { drainThenable } from "./thenable";
import {
  isReservedDeclarationKey,
  isValidResourcePath,
  MAX_STYLE_RESOURCES,
  RESOURCE_FORMATS,
  RESOURCE_KEYS,
} from "@banyan/style-contract";

export const RESOURCE_SOURCE = "resources";

const EXPORT = "STYLE_RESOURCES";
const FORMATS = new Set<string>(RESOURCE_FORMATS);

/** One usable resource declaration, with its validator already bridged. */
export interface NormalizedResource {
  id: string;
  path: string;
  format: "json" | "text";
  /** Runs in the style's sandbox; returns `true`, `false` or a message. */
  validate?: (data: unknown) => ResourceCheckResult;
}

/**
 * Normalize `STYLE_RESOURCES` to host-side declarations.
 *
 * An unusable entry is dropped with a finding; a resource whose `validate` is
 * not a function keeps its data path but loses the check, because refusing the
 * whole read would remove a feature the author did not ask to remove.
 */
export function normalizeStyleResources(
  raw: unknown,
  context: SandboxContext,
  messages: StyleMessageReporter,
): NormalizedResource[] | undefined {
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
        source: RESOURCE_SOURCE,
        message: "STYLE_RESOURCES must be an array; ignored",
        finding: { diagnosticId: "resource.export.not-array", path: [] },
      });
    }
    return undefined;
  }
  if (!cmp.length) return undefined;

  if (cmp.length > MAX_STYLE_RESOURCES) {
    listMessages.report({
      severity: "warning",
      source: RESOURCE_SOURCE,
      message: `STYLE_RESOURCES declares ${cmp.length} entries; only the first ${MAX_STYLE_RESOURCES} are kept`,
      finding: {
        diagnosticId: "resource.limit",
        path: [],
        data: { count: cmp.length, limit: MAX_STYLE_RESOURCES },
      },
    });
  }

  const seen = new Set<string>();
  const out: NormalizedResource[] = [];
  const kept = cmp.slice(0, MAX_STYLE_RESOURCES);

  for (const [index, entry] of kept.entries()) {
    const entryMessages = withDetail(messages, {
      declaration: { export: EXPORT, index },
    });
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      entryMessages.report({
        severity: "warning",
        source: RESOURCE_SOURCE,
        message: "skipped STYLE_RESOURCES entry that is not an object",
        finding: { diagnosticId: "resource.entry.not-object", path: [index] },
      });
      continue;
    }

    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (RESOURCE_KEYS.has(key)) continue;
      entryMessages.report({
        severity: "warning",
        source: RESOURCE_SOURCE,
        message: `STYLE_RESOURCES entry ${
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
        source: RESOURCE_SOURCE,
        message: "skipped STYLE_RESOURCES entry without a non-empty string id",
        finding: { diagnosticId: "resource.id.invalid", path: [index, "id"] },
      });
      continue;
    }
    const idMessages = withDetail(entryMessages, { declaration: { id } });
    if (isReservedDeclarationKey(id)) {
      idMessages.report({
        severity: "warning",
        source: RESOURCE_SOURCE,
        message: `skipped STYLE_RESOURCES id '${id}': reserved declaration key`,
        finding: {
          diagnosticId: "declaration.id.reserved",
          path: [index, "id"],
          data: { id },
        },
      });
      continue;
    }
    if (seen.has(id)) {
      idMessages.report({
        severity: "warning",
        source: RESOURCE_SOURCE,
        message: `skipped duplicate STYLE_RESOURCES id '${id}'`,
        finding: {
          diagnosticId: "resource.id.duplicate",
          path: [index, "id"],
          data: { id },
        },
      });
      continue;
    }

    const path = typeof record.path === "string" ? record.path : "";
    if (!isValidResourcePath(record.path)) {
      idMessages.report({
        severity: "warning",
        source: RESOURCE_SOURCE,
        message: `skipped STYLE_RESOURCES '${id}': '${path}' is not a plain relative path inside the style directory`,
        finding: {
          diagnosticId: "resource.path.invalid",
          path: [index, "path"],
          data: { id },
        },
      });
      continue;
    }

    const format = typeof record.format === "string" ? record.format : "";
    if (!FORMATS.has(format)) {
      idMessages.report({
        severity: "warning",
        source: RESOURCE_SOURCE,
        message: `skipped STYLE_RESOURCES '${id}': format must be one of ${RESOURCE_FORMATS.join(
          ", ",
        )}`,
        finding: {
          diagnosticId: "resource.format.invalid",
          path: [index, "format"],
          data: { id },
        },
      });
      continue;
    }

    const resource: NormalizedResource = {
      id,
      path,
      format: format as "json" | "text",
    };
    if (record.validate !== undefined) {
      const validate = createResourceValidator(record.validate, context);
      if (validate) {
        resource.validate = validate;
      } else {
        idMessages.report({
          severity: "warning",
          source: RESOURCE_SOURCE,
          message: `STYLE_RESOURCES '${id}': validate must be a function; the check is skipped`,
          finding: {
            diagnosticId: "resource.validate.invalid",
            path: [index, "validate"],
            data: { id },
          },
        });
      }
    }

    seen.add(id);
    out.push(resource);
  }

  return out.length ? out : undefined;
}

/**
 * Bridge the sandbox validator for host-side use.
 *
 * Arguments are imported into the style's context, like the parameter
 * validators, so the callback sees the same shapes the style sees. A throw, an
 * async answer or a value outside `boolean | string` is reported as an invalid
 * resource rather than silently accepted.
 */
function createResourceValidator(
  raw: unknown,
  context: SandboxContext,
): ((data: unknown) => ResourceCheckResult) | undefined {
  if (!isSandboxCallable(raw)) {
    return undefined;
  }

  return (data) => {
    let result: unknown;
    try {
      result = raw(context.importValue(data));
    } catch (error) {
      return errorMessageOf(error) || "validate() threw";
    }
    if (drainThenable(result)) {
      return "validate() must return synchronously";
    }
    if (result === true || result === false) {
      return result;
    }
    if (typeof result === "string") {
      return result;
    }
    return "validate() must return true, false or a message";
  };
}
