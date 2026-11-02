/**
 * Normalize the `STYLE_RESOURCES` export.
 *
 * A resource is a file the style declares up front: an id the style calls it
 * by, which is also the file name under the style's `assets/` directory, and a
 * format. Declaring it statically is what makes the core able to cap the read
 * and let a host or test-kit preflight the files before a document is touched.
 * Assets are shared, publicly maintained data, so the declaration carries no
 * per-style `validate` callback.
 */
import type { SandboxContext } from "../host";
import type { StyleResource } from "../types/style";
import { withDetail, type StyleMessageReporter } from "../messages";
import {
  isValidResourceId,
  MAX_RESOURCE_ID_LENGTH,
  MAX_STYLE_RESOURCES,
  RESOURCE_FORMATS,
  RESOURCE_KEYS,
} from "@banyan/style-contract";

export const RESOURCE_SOURCE = "resources";

const EXPORT = "STYLE_RESOURCES";
const FORMATS = new Set<string>(RESOURCE_FORMATS);

/** One usable resource declaration. */
export type NormalizedResource = StyleResource;

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
      if (key === "path") {
        entryMessages.report({
          severity: "warning",
          source: RESOURCE_SOURCE,
          message:
            "STYLE_RESOURCES no longer takes a 'path': an asset's id is its file name under assets/; the key is ignored",
          finding: {
            diagnosticId: "resource.path.invalid",
            path: [index, "path"],
          },
        });
        continue;
      }
      if (key === "validate") {
        entryMessages.report({
          severity: "warning",
          source: RESOURCE_SOURCE,
          message:
            "STYLE_RESOURCES no longer takes a 'validate' callback: assets are publicly maintained data; the key is ignored",
          finding: {
            diagnosticId: "resource.validate.invalid",
            path: [index, "validate"],
          },
        });
        continue;
      }
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

    const rawId = record.id;
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!isValidResourceId(rawId)) {
      entryMessages.report({
        severity: "warning",
        source: RESOURCE_SOURCE,
        message: `skipped STYLE_RESOURCES entry ${
          id ? `'${id}'` : `at index ${index}`
        }: id must be the asset's file name — lowercase letters, digits and single hyphens, at most ${MAX_RESOURCE_ID_LENGTH} characters`,
        finding: {
          diagnosticId: "resource.id.invalid",
          path: [index, "id"],
          data: { id },
        },
      });
      continue;
    }
    const idMessages = withDetail(entryMessages, { declaration: { id } });
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

    seen.add(id);
    out.push({ id, format: format as "json" | "text" });
  }

  return out.length ? out : undefined;
}
