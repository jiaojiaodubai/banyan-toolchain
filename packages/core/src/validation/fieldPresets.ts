import type { FieldPreset } from "../types/style";
import { withDetail, type StyleMessageReporter } from "../messages";
import type { SandboxContext } from "../host";
import { CREATORS_EXT_KEY } from "../items/creatorsExt";
import { createSandboxPredicate } from "./sandboxPredicate";
import { isZoteroField } from "../schema/queries";
import {
  CSL_ITEM_TYPE_SET as CSL_ITEM_TYPES,
  CSL_M_NAME_VARIABLE_SET as CSL_M_NAME_VARIABLES,
  CSL_M_ONLY_ITEM_TYPE_SET as CSL_M_ONLY_ITEM_TYPES,
  CSL_M_VARIABLE_SET as CSL_M_VARIABLES,
  CSL_NAME_VARIABLE_SET as CSL_NAME_VARIABLES,
  DENIED_PRESET_KEYS,
  isDeniedPresetKey,
  isValidExtraKey,
  normalizeExtraKey,
  ZOTERO_CREATOR_TYPE_CSL_NAMES,
  ZOTERO_CREATOR_TYPE_SET as ZOTERO_CREATOR_TYPES,
  ZOTERO_ITEM_TYPE_SET as ZOTERO_ITEM_TYPES,
} from "@banyan/style-contract";

/**
 * Primary (non-itemData) keys a preset must never target: writing them either
 * throws in `Zotero.Item.setField()` or changes item identity. Callers that
 * expose field selection in a UI should reuse this set instead of keeping a
 * second copy.
 */
export const DENIED_KEYS: ReadonlySet<string> = DENIED_PRESET_KEYS;

/** Lookup for realistic spellings like `Book Author` or `book-author`. */
const CREATOR_TYPE_BY_NORMALIZED_KEY: ReadonlyMap<string, string> = new Map(
  Array.from(
    ZOTERO_CREATOR_TYPES,
    (key) => [normalizeExtraKey(key), key] as const,
  ),
);

/**
 * `extra` keys the Banyan sandbox reads itself. They are not CSL variables, but
 * a preset that writes one is intentional rather than an unknown key.
 */
const SANDBOX_EXTRA_KEYS: ReadonlySet<string> = new Set([CREATORS_EXT_KEY]);

/**
 * CSL variables whose canonical name uses an underscore. `extra` keys are
 * normalized to kebab-case, so the hyphen form is the same variable here.
 */
const CSL_UNDERSCORE_KEY_ALIASES: ReadonlySet<string> = new Set([
  "archive-collection",
  "archive-location",
]);

/**
 * Normalize the `ITEM_FIELD_PRESETS` export to host-side presets, as
 * `normalizeParams()` does: waive the value out of the sandbox, validate entry
 * by entry, and drop what is unusable with a diagnostic.
 */
export function normalizeFieldPresets(
  raw: unknown,
  context: SandboxContext,
  messages: StyleMessageReporter,
): FieldPreset[] | undefined {
  let cmp: unknown;
  try {
    cmp = context.exportValue(raw);
  } catch {
    cmp = raw;
  }

  // The only declaration shape is an array: an object map would hide a broken
  // style behind a plausible-looking form, so it is rejected rather than
  // unwrapped.
  const listMessages = withDetail(messages, {
    declaration: { export: "ITEM_FIELD_PRESETS" },
  });
  if (!Array.isArray(cmp)) {
    if (cmp !== undefined && cmp !== null) {
      listMessages.report({
        severity: "warning",
        source: "field-presets",
        message: "ITEM_FIELD_PRESETS must be an array; ignored",
      });
    }
    return undefined;
  }
  const arr = cmp;
  if (!arr.length) return undefined;

  const seen = new Set<string>();
  const out: FieldPreset[] = [];

  for (const [index, item] of arr.entries()) {
    const entryMessages = withDetail(messages, {
      declaration: { export: "ITEM_FIELD_PRESETS", index },
    });
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      entryMessages.report({
        severity: "warning",
        source: "field-presets",
        message: "skipped entry without a non-empty string id",
      });
      continue;
    }
    const presetMessages = withDetail(entryMessages, {
      declaration: { id },
    });
    if (seen.has(id)) {
      presetMessages.report({
        severity: "warning",
        source: "field-presets",
        message: `skipped duplicate preset id '${id}'`,
      });
      continue;
    }

    const fields = normalizeFields(record.fields, id, presetMessages);
    if (!fields) {
      presetMessages.report({
        severity: "warning",
        source: "field-presets",
        message: `skipped preset '${id}': no usable fields`,
      });
      continue;
    }

    // Every value here was already normalized to a host primitive, so no
    // `cloneToHost` is needed (and a clone would be the wrong direction).
    const hostPreset: FieldPreset = {
      id,
      label: normalizeLabel(record.label, id, presetMessages),
      fields,
    };
    const visible = createSandboxPredicate(record.visible, context);
    if (visible) {
      hostPreset.visible = (item) => visible(item) === true;
    } else if (record.visible !== undefined) {
      presetMessages.report({
        severity: "warning",
        source: "field-presets",
        message: `preset '${id}': visible must be a function; ignored`,
      });
    }

    seen.add(id);
    out.push(hostPreset);
  }

  return out.length ? out : undefined;
}

/** Keep writable `key: "value"` pairs plus `key: null` (value to be filled at
 * apply time); returns undefined when nothing survives. */
function normalizeFields(
  raw: unknown,
  presetId: string,
  messages: StyleMessageReporter,
): Record<string, string | null> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const out: Record<string, string | null> = {};
  for (const [rawKey, rawValue] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const key = rawKey.trim();
    if (!key) continue;

    if (isDeniedKey(key)) {
      messages.report({
        severity: "warning",
        source: "field-presets",
        message: `preset '${presetId}': '${key}' is not writable by a preset; ignored`,
        finding: {
          diagnosticId: "preset.field.key.denied",
          path: [presetId, "fields", key],
        },
      });
      continue;
    }

    if (!isValidExtraKey(key)) {
      messages.report({
        severity: "warning",
        source: "field-presets",
        message: `preset '${presetId}': '${key}' is not a valid field key; ignored`,
        finding: {
          diagnosticId: "preset.field.key.invalid",
          path: [presetId, "fields", key],
        },
      });
      continue;
    }

    if (rawValue === null) {
      out[key] = null;
      continue;
    }

    if (typeof rawValue !== "string") {
      messages.report({
        severity: "warning",
        source: "field-presets",
        message: `preset '${presetId}': '${key}' must be a string or null; ignored`,
      });
      continue;
    }
    const value = rawValue.trim();
    if (!value) {
      messages.report({
        severity: "warning",
        source: "field-presets",
        message: `preset '${presetId}': refusing to write an empty value to '${key}'`,
      });
      continue;
    }

    warnAdvisoryKey(presetId, key, value, messages);
    out[key] = value;
  }

  return Object.keys(out).length ? out : undefined;
}

function isDeniedKey(key: string): boolean {
  return isDeniedPresetKey(key);
}

/**
 * Advisory messages for one writable preset entry:
 *
 * - a creator or name variable cannot be written by a preset as a creator;
 * - a `type` value is the one extra key that changes how the item is cited, so
 *   CSL and CSL-M names warn while anything citeproc cannot read is an error;
 * - any other key citeproc neither reads nor the sandbox handles is a warning:
 *   the value would sit in `extra` without affecting output.
 *
 * The Zotero/CSL tables come from the core's own schema data, so every host
 * advises identically.
 */
function warnAdvisoryKey(
  presetId: string,
  key: string,
  value: string,
  messages: StyleMessageReporter,
): void {
  const normalizedKey = normalizeExtraKey(key);

  if (CSL_NAME_VARIABLES.has(normalizedKey)) {
    messages.report({
      severity: "warning",
      source: "field-presets",
      message: `preset '${presetId}': '${key}' is a CSL name variable; a preset writes a single value, so creators are not applied`,
      finding: {
        diagnosticId: "preset.field.name-variable",
        path: [presetId, "fields", key],
      },
    });
    return;
  }

  if (ZOTERO_CREATOR_TYPES.has(key)) {
    const cslName = ZOTERO_CREATOR_TYPE_CSL_NAMES[key];
    messages.report({
      severity: "warning",
      source: "field-presets",
      finding: {
        diagnosticId: "preset.field.creator-type",
        path: [presetId, "fields", key],
      },
      message: `preset '${presetId}': '${key}' is a Zotero creator type${
        cslName ? ` (CSL name variable '${cslName}')` : ""
      }; extra values for creators are not applied by citeproc`,
    });
    return;
  }

  const creatorKey = CREATOR_TYPE_BY_NORMALIZED_KEY.get(normalizedKey);
  if (creatorKey) {
    const cslName = ZOTERO_CREATOR_TYPE_CSL_NAMES[creatorKey];
    messages.report({
      severity: "warning",
      source: "field-presets",
      finding: {
        diagnosticId: "preset.field.creator-type",
        path: [presetId, "fields", key],
      },
      message: `preset '${presetId}': '${key}' is a Zotero creator type${
        cslName ? ` (CSL name variable '${cslName}')` : ""
      }; extra values for creators are not applied by citeproc`,
    });
    return;
  }

  if (CSL_M_NAME_VARIABLES.has(normalizedKey)) {
    messages.report({
      severity: "warning",
      source: "field-presets",
      message: `preset '${presetId}': '${key}' is a CSL-M name variable; a preset writes a single value, so creators are not applied`,
      finding: {
        diagnosticId: "preset.field.name-variable",
        path: [presetId, "fields", key],
      },
    });
    return;
  }

  if (normalizedKey === "type") {
    warnAdvisoryType(presetId, value, messages);
    return;
  }

  // A real Zotero field may be written as a field when the item type has it,
  // so it is not an unknown key here even though its name is not a CSL
  // variable. The apply layer decides the route per item.
  if (
    CSL_M_VARIABLES.has(normalizedKey) ||
    CSL_UNDERSCORE_KEY_ALIASES.has(normalizedKey) ||
    SANDBOX_EXTRA_KEYS.has(normalizedKey) ||
    isZoteroField(key)
  ) {
    return;
  }

  messages.report({
    severity: "warning",
    source: "field-presets",
    message: `preset '${presetId}': '${key}' is neither a CSL/CSL-M variable nor a sandbox extra key; citeproc ignores it when written to extra`,
    finding: {
      diagnosticId: "preset.field.unknown",
      path: [presetId, "fields", key],
    },
  });
}

/**
 * `type` is the sensitive key: it decides how the item is cited.
 *
 * A CSL or CSL-M item type is Zotero's documented escape hatch for types it
 * does not have, so it is only a warning. Anything else leaves citeproc with an
 * untyped item, which is an error when the value reaches `extra`; the same
 * string can still be a normal field value on item types that have a Type
 * field, which is why the message names the extra route explicitly.
 */
function warnAdvisoryType(
  presetId: string,
  value: string,
  messages: StyleMessageReporter,
): void {
  if (CSL_ITEM_TYPES.has(value)) {
    messages.report({
      severity: "warning",
      source: "field-presets",
      message: `preset '${presetId}': 'type: ${value}' is a CSL item type; written to extra, it changes the CSL type citeproc uses for this item`,
    });
    return;
  }

  if (CSL_M_ONLY_ITEM_TYPES.has(value)) {
    messages.report({
      severity: "warning",
      source: "field-presets",
      message: `preset '${presetId}': 'type: ${value}' is a CSL-M item type; citeproc-js reads it as a CSL extension, and written to extra it changes the CSL type used for this item`,
    });
    return;
  }

  if (ZOTERO_ITEM_TYPES.has(value)) {
    messages.report({
      severity: "error",
      source: "field-presets",
      finding: {
        diagnosticId: "preset.field.type.zotero",
        path: [presetId, "fields", "type"],
      },
      message: `preset '${presetId}': 'type: ${value}' is a Zotero item type name, not a CSL or CSL-M item type; written to extra, it makes citeproc treat the item as untyped`,
    });
    return;
  }

  messages.report({
    severity: "error",
    source: "field-presets",
    finding: {
      diagnosticId: "preset.field.type.invalid",
      path: [presetId, "fields", "type"],
    },
    message: `preset '${presetId}': 'type: ${value}' is not a CSL or CSL-M item type; written to extra, it makes citeproc treat the item as untyped`,
  });
}

function normalizeLabel(
  raw: unknown,
  fallback: string,
  messages: StyleMessageReporter,
): string {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text) return text;
  } else if (raw !== undefined && raw !== null) {
    messages.report({
      severity: "warning",
      source: "field-presets",
      message: `'${fallback}': label must be a string; using the preset id`,
    });
  }
  return fallback;
}

/** Whether applying the preset still needs a value from the user. */
export function hasDeferredFieldValues(preset: FieldPreset): boolean {
  return Object.values(preset.fields).some((value) => value === null);
}

/**
 * Menu text of a preset: its label, plus an ellipsis when a value is to be filled
 * at apply time.
 */
export function getFieldPresetMenuLabel(preset: FieldPreset): string {
  const label = preset.label || preset.id;
  return hasDeferredFieldValues(preset) ? `${label}…` : label;
}
