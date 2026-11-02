/**
 * Normalize the parameter declarations a style exports.
 *
 * A parameter is data: `state` is a closed state, `value` is an open string
 * (plain or restricted rich markup), and `list` is a repeated set of value
 * fields. The host derives widgets from these declarations. The core bridges
 * the three runtime callbacks (`applicable`, `forcedValue`, `validate`) and
 * runs all of them during resolution, so a host never calls style code for a
 * parameter.
 */
import type {
  CitationParam,
  CiteParam,
  ListRow,
  ParamCheckResult,
  ParamPreset,
  StateValue,
  StyleOptionParam,
} from "../types/style";
import type { SandboxContext } from "../host";
import {
  withDetail,
  type StyleDeclarationExport,
  type StyleMessageReporter,
} from "../messages";
import {
  isReservedDeclarationKey,
  LIST_FIELD_KEYS,
  MAX_PRESETS,
  MAX_STATE_SCAN,
  MAX_STATES,
  MAX_STYLE_OPTIONS,
  PARAM_KEYS,
  STYLE_OPTION_WARN_THRESHOLD,
} from "@banyan/style-contract";
import type { ContractFinding } from "@banyan/style-contract";
import {
  createSandboxApplicability,
  createSandboxResolver,
  createSandboxValidator,
} from "./sandboxPredicate";

type ParamScope = "style" | "citation" | "cite";
type AnyParam = StyleOptionParam | CitationParam | CiteParam;

type Base = {
  id: string;
  label: string;
  description?: string;
};

type NormalizedState = Base & {
  kind: "state";
  states?: Record<string, string>;
  defaultValue: StateValue;
  forcedValue?: StateValue | ((...scope: unknown[]) => StateValue | null);
};

type NormalizedValue = Base & {
  kind: "value";
  defaultValue: string;
  presets?: readonly ParamPreset[];
  format?: "plain" | "rich";
  forcedValue?: string | ((...scope: unknown[]) => string | null);
  validate?: (value: string, ...scope: unknown[]) => ParamCheckResult;
};

type NormalizedListField = Base & {
  kind: "value";
  defaultValue: string;
  presets?: readonly ParamPreset[];
  format?: "plain" | "rich";
  validate?: (value: string, ...scope: unknown[]) => ParamCheckResult;
};

type NormalizedList = Base & {
  kind: "list";
  fields: NormalizedListField[];
  min?: number;
  max?: number;
  defaultValue: readonly ListRow[];
  forcedValue?:
    readonly ListRow[] | ((...scope: unknown[]) => readonly ListRow[] | null);
};

export function normalizeStyleParams(
  raw: unknown,
  context: SandboxContext,
  messages: StyleMessageReporter,
): StyleOptionParam[] | undefined {
  return normalizeParams(raw, context, "style", messages) as
    StyleOptionParam[] | undefined;
}

export function normalizeCitationParams(
  raw: unknown,
  context: SandboxContext,
  messages: StyleMessageReporter,
): CitationParam[] | undefined {
  return normalizeParams(raw, context, "citation", messages) as
    CitationParam[] | undefined;
}

export function normalizeCiteParams(
  raw: unknown,
  context: SandboxContext,
  messages: StyleMessageReporter,
): CiteParam[] | undefined {
  return normalizeParams(raw, context, "cite", messages) as
    CiteParam[] | undefined;
}

function normalizeParams(
  raw: unknown,
  context: SandboxContext,
  scope: ParamScope,
  messages: StyleMessageReporter,
): AnyParam[] | undefined {
  if (!raw) return undefined;
  let exported: unknown;
  try {
    exported = context.exportValue(raw);
  } catch {
    exported = raw;
  }

  const entries = Array.isArray(exported) ? exported : undefined;
  const exportName = scopeName(scope);
  const listMessages = withDetail(messages, {
    declaration: { export: exportName },
  });
  if (!entries?.length) {
    if (exported != null) {
      const diagnosticId: ContractFinding["diagnosticId"] = Array.isArray(
        exported,
      )
        ? scope === "style"
          ? "param.style-options.empty"
          : "declaration.export.empty"
        : "declaration.export.not-array";
      warn(listMessages, `${exportName} must be a non-empty array; ignored`, {
        diagnosticId,
        path: [exportName],
      });
    }
    return undefined;
  }

  const out: AnyParam[] = [];
  const seenIds = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const entryMessages = withDetail(messages, {
      declaration: { export: exportName, index },
    });
    const record =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    if (!record) {
      warn(entryMessages, `skipped entry ${index}: not an object`, {
        diagnosticId: "declaration.entry.not-object",
        path: [exportName, index],
      });
      continue;
    }

    const id = typeof record.id === "string" ? record.id.trim() : "";
    const kind = typeof record.kind === "string" ? record.kind.trim() : "";
    const paramMessages = id
      ? withDetail(entryMessages, { declaration: { id } })
      : entryMessages;
    if (!id || !kind) {
      warn(
        paramMessages,
        `skipped entry ${index}: missing ${!id ? "a non-empty string id" : "a non-empty string kind"}`,
        {
          diagnosticId: !id
            ? "declaration.id.invalid"
            : "declaration.kind.invalid",
          path: [exportName, index],
        },
      );
      continue;
    }
    if (isReservedDeclarationKey(id)) {
      warn(
        paramMessages,
        `'${id}': this key cannot be used as a parameter id; parameter skipped`,
        {
          diagnosticId: "declaration.id.reserved",
          path: [exportName, id],
        },
      );
      continue;
    }
    if (seenIds.has(id)) {
      warn(
        paramMessages,
        `'${id}': duplicate parameter id; parameter skipped`,
        {
          diagnosticId: "declaration.id.duplicate",
          path: [exportName, id],
        },
      );
      continue;
    }
    if (scope === "style" && out.length >= MAX_STYLE_OPTIONS) {
      warn(
        paramMessages,
        `STYLE_OPTIONS exceeds ${MAX_STYLE_OPTIONS} entries; '${id}' and the rest were ignored`,
        {
          diagnosticId: "param.style-options.limit",
          path: [exportName, id],
        },
      );
      break;
    }
    if (kind === "list" && scope !== "cite") {
      warn(paramMessages, `'${id}': list is only allowed in CITE_PARAMS`, {
        diagnosticId: "param.list.scope",
        path: [exportName, id],
      });
      continue;
    }
    if (kind !== "state" && kind !== "value" && kind !== "list") {
      warn(
        paramMessages,
        `'${id}': unsupported parameter kind '${kind}'; skipped`,
        {
          diagnosticId: "declaration.kind.invalid",
          path: [exportName, id, "kind"],
        },
      );
      continue;
    }
    warnUnknownKeys(record, PARAM_KEYS[kind], `'${id}'`, paramMessages);

    const base: Base = {
      id,
      label:
        typeof record.label === "string" && record.label.trim()
          ? record.label.trim()
          : id,
      ...(typeof record.description === "string" && record.description.trim()
        ? { description: record.description.trim() }
        : {}),
    };

    let param: NormalizedState | NormalizedValue | NormalizedList | undefined;
    if (kind === "state") {
      param = normalizeState(base, record, context, paramMessages, exportName);
    } else if (kind === "value") {
      param = normalizeValue(base, record, context, paramMessages);
    } else {
      param = normalizeList(base, record, context, paramMessages);
    }
    if (!param) continue;

    if (scope !== "style") {
      const applicable = normalizeApplicable(
        record.applicable,
        context,
        paramMessages,
        id,
      );
      if (applicable) {
        Object.assign(param, { applicable });
      }
    } else if (record.applicable !== undefined) {
      warn(
        paramMessages,
        `'${id}': applicable is not supported for STYLE_OPTIONS; ignored`,
        {
          diagnosticId: "param.applicable.unsupported",
          path: [exportName, id, "applicable"],
        },
      );
    }

    out.push(param as AnyParam);
    seenIds.add(id);
  }

  if (!out.length) return undefined;
  if (scope === "style" && out.length >= STYLE_OPTION_WARN_THRESHOLD) {
    warn(
      listMessages,
      `STYLE_OPTIONS declares ${out.length} options; consider splitting the style or moving per-citation differences into params`,
      {
        diagnosticId: "param.style-options.threshold",
        path: ["STYLE_OPTIONS"],
        data: { count: out.length },
      },
    );
  }
  return out;
}

function normalizeState(
  base: Base,
  record: Record<string, unknown>,
  context: SandboxContext,
  messages: StyleMessageReporter,
  exportName: StyleDeclarationExport,
): NormalizedState | undefined {
  const rawStates = record.states;
  let states: Record<string, string> | undefined;
  if (rawStates !== undefined) {
    const preferred = new Set<string>();
    // State keys are trimmed by `normalizeStates`, so the values that must
    // survive the cap are compared in the same form; otherwise `" foo "` would
    // fail to protect `foo` and the default could silently re-point.
    if (typeof record.defaultValue === "string") {
      preferred.add(record.defaultValue.trim());
    }
    if (typeof record.forcedValue === "string") {
      preferred.add(record.forcedValue.trim());
    }
    states = normalizeStates(
      base.id,
      rawStates,
      messages,
      preferred,
      exportName,
    );
    if (!states) {
      const isEmptyObject =
        typeof rawStates === "object" &&
        rawStates !== null &&
        !Array.isArray(rawStates) &&
        Object.keys(rawStates).length === 0;
      warn(
        messages,
        `'${base.id}': states must be a non-empty object; treating as boolean state`,
        {
          diagnosticId: isEmptyObject
            ? "param.states.empty"
            : "param.states.invalid",
          path: [exportName, base.id, "states"],
        },
      );
    }
  }

  if (record.validate !== undefined) {
    warn(
      messages,
      `'${base.id}': validate is not available on state parameters; ignored`,
      {
        diagnosticId: "param.state.validate-unsupported",
        path: [exportName, base.id, "validate"],
      },
    );
  }

  let defaultValue: StateValue;
  if (states) {
    const rawDefault =
      typeof record.defaultValue === "string"
        ? record.defaultValue.trim()
        : record.defaultValue;
    if (typeof rawDefault !== "string" || !Object.hasOwn(states, rawDefault)) {
      if (rawDefault === undefined) {
        warn(
          messages,
          `'${base.id}': defaultValue is missing; using the first state`,
          {
            diagnosticId: "param.state.default.missing",
            path: [exportName, base.id, "defaultValue"],
          },
        );
      } else {
        warn(
          messages,
          `'${base.id}': defaultValue must be one of states; using the first state`,
          {
            diagnosticId: "param.state.default.invalid",
            path: [exportName, base.id, "defaultValue"],
            data: {
              reason:
                typeof rawDefault === "number"
                  ? "numeric"
                  : typeof rawDefault === "boolean"
                    ? "boolean"
                    : rawDefault === ""
                      ? "empty"
                      : "unknown-key",
              value: String(rawDefault),
            },
          },
        );
      }
      defaultValue = Object.keys(states)[0]!;
    } else {
      defaultValue = rawDefault;
    }
  } else {
    const rawDefault = record.defaultValue;
    if (rawDefault === undefined) {
      defaultValue = false;
    } else if (typeof rawDefault === "boolean") {
      defaultValue = rawDefault;
    } else {
      warn(
        messages,
        `'${base.id}': boolean state defaultValue must be boolean; using false`,
        {
          diagnosticId: "param.state.default.boolean-invalid",
          path: [exportName, base.id, "defaultValue"],
        },
      );
      defaultValue = false;
    }
  }

  const forcedValue = normalizeForced(
    base.id,
    record.forcedValue,
    "state",
    context,
    messages,
    states,
  ) as StateValue | ((...scope: unknown[]) => StateValue | null) | undefined;
  return {
    ...base,
    kind: "state",
    ...(states ? { states } : {}),
    defaultValue,
    ...(forcedValue === undefined ? {} : { forcedValue }),
  };
}

function normalizeValue(
  base: Base,
  record: Record<string, unknown>,
  context: SandboxContext,
  messages: StyleMessageReporter,
): NormalizedValue | undefined {
  const defaultValue = normalizeStringDefault(
    base.id,
    record.defaultValue,
    messages,
  );
  const presets = normalizePresets(base.id, record.presets, messages);
  const format = normalizeFormat(base.id, record.format, messages);
  const forcedValue = normalizeForced(
    base.id,
    record.forcedValue,
    "value",
    context,
    messages,
  ) as string | ((...scope: unknown[]) => string | null) | undefined;
  const validate = normalizeValidate(
    base.id,
    record.validate,
    context,
    messages,
  );
  return {
    ...base,
    kind: "value",
    defaultValue,
    ...(presets ? { presets } : {}),
    ...(format ? { format } : {}),
    ...(forcedValue === undefined ? {} : { forcedValue }),
    ...(validate ? { validate } : {}),
  };
}

function normalizeList(
  base: Base,
  record: Record<string, unknown>,
  context: SandboxContext,
  messages: StyleMessageReporter,
): NormalizedList | undefined {
  const rawFields = record.fields;
  if (!Array.isArray(rawFields) || !rawFields.length) {
    warn(
      messages,
      `'${base.id}': list needs a non-empty fields array; skipped`,
    );
    return undefined;
  }
  if (record.validate !== undefined) {
    warn(
      messages,
      `'${base.id}': validate is not available on list parameters; ignored`,
    );
  }

  const fields: NormalizedListField[] = [];
  const fieldIds = new Set<string>();
  for (const [index, entry] of rawFields.entries()) {
    const fieldIndexMessages = withDetail(messages, {
      declaration: { fieldIndex: index },
    });
    const field =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    if (!field) {
      warn(
        fieldIndexMessages,
        `'${base.id}'.fields[${index}]: not an object; field skipped`,
      );
      continue;
    }
    const fieldId = typeof field.id === "string" ? field.id.trim() : "";
    const fieldKind = typeof field.kind === "string" ? field.kind.trim() : "";
    const fieldMessages = fieldId
      ? withDetail(fieldIndexMessages, { declaration: { field: fieldId } })
      : fieldIndexMessages;
    if (!fieldId || fieldKind !== "value") {
      warn(
        fieldMessages,
        `'${base.id}'.fields[${index}]: list fields must be value parameters with an id; field skipped`,
      );
      continue;
    }
    if (isReservedDeclarationKey(fieldId)) {
      warn(
        fieldMessages,
        `'${base.id}'.fields[${index}]: this key cannot be used as a field id; field skipped`,
      );
      continue;
    }
    if (fieldIds.has(fieldId)) {
      warn(
        fieldMessages,
        `'${base.id}'.fields: duplicate field id '${fieldId}'; field skipped`,
      );
      continue;
    }
    if (field.applicable !== undefined || field.forcedValue !== undefined) {
      warn(
        fieldMessages,
        `'${base.id}'.${fieldId}: applicable/forcedValue are not available inside a list; ignored`,
      );
    }
    warnUnknownKeys(
      field,
      LIST_FIELD_KEYS,
      `'${base.id}.${fieldId}'`,
      fieldMessages,
    );
    const normalized = normalizeListField(
      fieldId,
      field,
      context,
      fieldMessages,
    );
    if (!normalized) continue;
    fields.push(normalized);
    fieldIds.add(fieldId);
  }
  if (!fields.length) return undefined;

  let min = normalizeBound(record.min);
  let max = normalizeBound(record.max);
  if (record.min !== undefined && min === undefined) {
    warn(messages, `'${base.id}': min must be a non-negative number; ignored`);
  }
  if (record.max !== undefined && max === undefined) {
    warn(messages, `'${base.id}': max must be a non-negative number; ignored`);
  }
  if (min !== undefined && max !== undefined && min > max) {
    warn(
      messages,
      `'${base.id}': min ${min} is greater than max ${max}; bounds ignored`,
    );
    min = undefined;
    max = undefined;
  }

  const defaultValue = normalizeRows(
    base.id,
    record.defaultValue,
    fields,
    messages,
    "defaultValue",
  );
  let forcedValue:
    | readonly ListRow[]
    | ((...scope: unknown[]) => readonly ListRow[] | null)
    | undefined;
  if (record.forcedValue !== undefined) {
    if (typeof record.forcedValue === "function") {
      forcedValue = createSandboxResolver(record.forcedValue, context) as
        ((...scope: unknown[]) => readonly ListRow[] | null) | undefined;
      if (!forcedValue) {
        warn(
          messages,
          `'${base.id}': forcedValue must be a function or value; ignored`,
        );
      }
    } else {
      const rows = normalizeRows(
        base.id,
        record.forcedValue,
        fields,
        messages,
        "forcedValue",
        false,
      );
      if (rows) {
        forcedValue = rows;
      }
    }
  }

  const defaultRows = defaultValue ?? [];
  warnRowBounds(base.id, "defaultValue", defaultRows, min, max, messages);
  if (Array.isArray(forcedValue)) {
    warnRowBounds(base.id, "forcedValue", forcedValue, min, max, messages);
  }

  return {
    ...base,
    kind: "list",
    fields,
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    defaultValue: defaultRows,
    ...(forcedValue === undefined ? {} : { forcedValue }),
  };
}

/** Bounds are editor policy, but a declared default/forced row set can be
 * checked now; the core still never truncates caller data at resolution time. */
function warnRowBounds(
  id: string,
  label: string,
  rows: readonly ListRow[],
  min: number | undefined,
  max: number | undefined,
  messages: StyleMessageReporter,
): void {
  if (min !== undefined && rows.length < min) {
    warn(
      messages,
      `'${id}': ${label} has ${rows.length} row${rows.length === 1 ? "" : "s"}, below min ${min}`,
    );
  }
  if (max !== undefined && rows.length > max) {
    warn(
      messages,
      `'${id}': ${label} has ${rows.length} row${rows.length === 1 ? "" : "s"}, above max ${max}`,
    );
  }
}

function normalizeListField(
  id: string,
  record: Record<string, unknown>,
  context: SandboxContext,
  messages: StyleMessageReporter,
): NormalizedListField | undefined {
  const label =
    typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : id;
  const description =
    typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : undefined;
  const defaultValue = normalizeStringDefault(
    id,
    record.defaultValue,
    messages,
  );
  const presets = normalizePresets(id, record.presets, messages);
  const format = normalizeFormat(id, record.format, messages);
  const validate = normalizeValidate(id, record.validate, context, messages);
  return {
    id,
    kind: "value",
    label,
    ...(description ? { description } : {}),
    defaultValue,
    ...(presets ? { presets } : {}),
    ...(format ? { format } : {}),
    ...(validate ? { validate } : {}),
  };
}

function normalizeApplicable(
  raw: unknown,
  context: SandboxContext,
  messages: StyleMessageReporter,
  id: string,
): ((...scope: unknown[]) => boolean) | undefined {
  if (raw === undefined) return undefined;
  const predicate = createSandboxApplicability(raw, context);
  if (!predicate) {
    warn(messages, `'${id}': applicable must be a function; ignored`);
  }
  return predicate;
}

function normalizeForced(
  id: string,
  raw: unknown,
  kind: "state" | "value",
  context: SandboxContext,
  messages: StyleMessageReporter,
  states?: Record<string, string>,
): StateValue | string | ((...scope: unknown[]) => unknown) | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "function") {
    const resolver = createSandboxResolver(raw, context);
    if (!resolver) {
      warn(
        messages,
        `'${id}': forcedValue must be a function or value; ignored`,
      );
    }
    return resolver as ((...scope: unknown[]) => unknown) | undefined;
  }
  if (kind === "state") {
    if (states) {
      const key = typeof raw === "string" ? raw.trim() : undefined;
      if (key && Object.hasOwn(states, key)) return key;
      warn(messages, `'${id}': forcedValue must be one of states; ignored`);
      return undefined;
    }
    if (typeof raw === "boolean") return raw;
    warn(
      messages,
      `'${id}': boolean state forcedValue must be boolean; ignored`,
    );
    return undefined;
  }
  if (typeof raw === "string") return raw;
  warn(messages, `'${id}': value forcedValue must be a string; ignored`);
  return undefined;
}

function normalizeValidate(
  id: string,
  raw: unknown,
  context: SandboxContext,
  messages: StyleMessageReporter,
): ((value: string, ...scope: unknown[]) => ParamCheckResult) | undefined {
  if (raw === undefined) return undefined;
  const validator = createSandboxValidator(raw, context);
  if (!validator) {
    warn(messages, `'${id}': validate must be a function; ignored`);
  }
  // The public declaration keeps the author contract (`ParamCheckResult`); the
  // bridge itself returns the raw value so `runValidation` can see a thenable.
  // Hosts read `states[id].validation` instead of calling this.
  return validator as
    ((value: string, ...scope: unknown[]) => ParamCheckResult) | undefined;
}

function normalizeStates(
  id: string,
  raw: unknown,
  messages: StyleMessageReporter,
  preferred: ReadonlySet<string>,
  exportName: StyleDeclarationExport,
): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const record = raw as Record<string, unknown>;
  const entries: Array<{ key: string; label: string }> = [];
  const seenKeys = new Set<string>();
  let scanned = 0;
  for (const key in record) {
    if (!Object.hasOwn(record, key)) continue;
    if (scanned >= MAX_STATE_SCAN) {
      warn(
        messages,
        `'${id}': states are scanned up to ${MAX_STATE_SCAN} entries; the rest were ignored`,
        {
          diagnosticId: "param.states.limit",
          path: [exportName, id, "states"],
          data: { kind: "scan", limit: MAX_STATE_SCAN },
        },
      );
      break;
    }
    scanned += 1;
    const label = record[key];
    const trimmed = key.trim();
    if (!trimmed || isReservedDeclarationKey(trimmed)) {
      warn(
        messages,
        `'${id}': state key '${trimmed || key}' cannot be used; state skipped`,
        {
          diagnosticId: "param.states.key.invalid",
          path: [exportName, id, "states", key],
        },
      );
      continue;
    }
    if (trimmed !== key) {
      warn(messages, `'${id}': state key '${key}' is trimmed to '${trimmed}'`, {
        diagnosticId: "param.states.key.whitespace",
        path: [exportName, id, "states", key],
      });
    }
    if (seenKeys.has(trimmed)) {
      warn(
        messages,
        `'${id}': state key '${trimmed}' collides with an earlier key after trimming; state skipped`,
        {
          diagnosticId: "param.states.key.duplicate",
          path: [exportName, id, "states", key],
        },
      );
      continue;
    }
    seenKeys.add(trimmed);
    if (typeof label !== "string") {
      warn(
        messages,
        `'${id}': label of state '${trimmed}' coerced from ${typeof label} to string`,
        {
          diagnosticId: "param.states.label.coerced",
          path: [exportName, id, "states", trimmed],
        },
      );
    }
    entries.push({ key: trimmed, label: String(label ?? "") });
  }
  if (!entries.length) return undefined;

  let kept = entries;
  if (entries.length > MAX_STATES) {
    // A declared default or static forced value must stay selectable even when
    // it sits beyond the cap; otherwise truncation would silently re-point the
    // parameter at a different state.
    const protectedEntries = entries.filter((entry) =>
      preferred.has(entry.key),
    );
    const ordinary = entries.filter((entry) => !preferred.has(entry.key));
    const room = Math.max(0, MAX_STATES - protectedEntries.length);
    const keptKeys = new Set([
      ...protectedEntries.slice(0, MAX_STATES).map((entry) => entry.key),
      ...ordinary.slice(0, room).map((entry) => entry.key),
    ]);
    kept = entries.filter((entry) => keptKeys.has(entry.key));
    const dropped = entries
      .filter((entry) => !keptKeys.has(entry.key))
      .map((entry) => entry.key);
    const listed = dropped.slice(0, 10).join(", ");
    const rest = dropped.length > 10 ? `, +${dropped.length - 10} more` : "";
    warn(
      messages,
      `'${id}': states are capped at ${MAX_STATES}; dropped: ${listed}${rest}`,
      {
        diagnosticId: "param.states.limit",
        path: [exportName, id, "states"],
        data: { kind: "count", limit: MAX_STATES, dropped: dropped.length },
      },
    );
  }

  return Object.fromEntries(kept.map((entry) => [entry.key, entry.label]));
}

function normalizePresets(
  id: string,
  raw: unknown,
  messages: StyleMessageReporter,
): readonly ParamPreset[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    warn(messages, `'${id}': presets must be an array; ignored`);
    return undefined;
  }
  const out: ParamPreset[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const entry of raw) {
    let value: string;
    let label: string;
    if (typeof entry === "string") {
      value = entry.trim();
      label = value;
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const object = entry as Record<string, unknown>;
      value = typeof object.value === "string" ? object.value.trim() : "";
      if (typeof object.label === "string" && object.label.trim()) {
        label = object.label.trim();
      } else {
        label = value;
        if (object.label !== undefined) {
          warn(
            messages,
            `'${id}': label of preset '${value}' must be a non-empty string; using the value`,
          );
        }
      }
    } else {
      warn(
        messages,
        `'${id}': preset entry is not a string or object; skipped`,
      );
      continue;
    }
    if (!value) {
      warn(messages, `'${id}': preset without a value; skipped`);
      continue;
    }
    if (seen.has(value)) {
      warn(messages, `'${id}': duplicate preset value '${value}'; skipped`);
      continue;
    }
    if (out.length >= MAX_PRESETS) {
      truncated = true;
      break;
    }
    seen.add(value);
    out.push({ label, value });
  }
  if (truncated) {
    warn(
      messages,
      `'${id}': presets are capped at ${MAX_PRESETS}; later entries were ignored`,
      {
        diagnosticId: "param.presets.limit",
        path: [id, "presets"],
        data: { limit: MAX_PRESETS },
      },
    );
  }
  return out.length ? out : undefined;
}

function normalizeFormat(
  id: string,
  raw: unknown,
  messages: StyleMessageReporter,
): "plain" | "rich" | undefined {
  if (raw === undefined || raw === "plain") return undefined;
  if (raw === "rich") return "rich";
  warn(messages, `'${id}': format must be "plain" or "rich"; using plain`, {
    diagnosticId: "param.format.invalid",
    path: [id, "format"],
  });
  return undefined;
}

function normalizeStringDefault(
  id: string,
  raw: unknown,
  messages: StyleMessageReporter,
): string {
  if (raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") {
    warn(
      messages,
      `'${id}': defaultValue coerced from ${typeof raw} to string`,
      {
        diagnosticId: "param.value.default.coerced",
        path: [id, "defaultValue"],
        data: { from: typeof raw },
      },
    );
    return String(raw);
  }
  warn(messages, `'${id}': defaultValue must be a string; using ""`);
  return "";
}

function normalizeRows(
  id: string,
  raw: unknown,
  fields: readonly NormalizedListField[],
  messages: StyleMessageReporter,
  source: string,
  fallbackToEmpty = true,
): readonly ListRow[] | undefined {
  if (raw === undefined) return fallbackToEmpty ? [] : undefined;
  if (!Array.isArray(raw)) {
    warn(messages, `'${id}': ${source} must be an array of rows; ignored`);
    return fallbackToEmpty ? [] : undefined;
  }
  const rows: ListRow[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      warn(messages, `'${id}'.${source}[${index}]: not a row; skipped`);
      continue;
    }
    const record = entry as Record<string, unknown>;
    const fieldIds = new Set(fields.map((field) => field.id));
    for (const key of Object.keys(record)) {
      if (!fieldIds.has(key)) {
        warn(
          messages,
          `'${id}'.${source}[${index}]: unknown field '${key}' is ignored`,
        );
      }
    }
    const row: Record<string, string> = {};
    for (const field of fields) {
      const value = record[field.id];
      if (value !== undefined && typeof value !== "string") {
        warn(
          messages,
          `'${id}'.${source}[${index}].${field.id} must be a string; using the field default`,
        );
      }
      row[field.id] = typeof value === "string" ? value : field.defaultValue;
    }
    rows.push(row);
  }
  // An empty array supplied by the author is meaningful (an explicitly forced
  // empty list). A non-empty array whose every row was dropped is not: keeping
  // the resulting [] would silently turn malformed input into a lock. The
  // caller sees undefined, the same outcome as a non-array or rejected
  // resolver.
  if (!rows.length && raw.length > 0 && !fallbackToEmpty) {
    return undefined;
  }
  return rows;
}

function warnUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  messages: StyleMessageReporter,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      warn(messages, `${path}: unknown key '${key}' is ignored`);
    }
  }
}

function normalizeBound(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function scopeName(scope: ParamScope): StyleDeclarationExport {
  switch (scope) {
    case "style":
      return "STYLE_OPTIONS";
    case "citation":
      return "CITATION_PARAMS";
    case "cite":
      return "CITE_PARAMS";
  }
}

function warn(
  messages: StyleMessageReporter,
  message: string,
  finding?: ContractFinding,
): void {
  messages.report({
    severity: "warning",
    source: "params",
    message,
    ...(finding ? { finding } : {}),
  });
}
