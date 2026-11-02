/**
 * Resolve declared parameters into stored and effective views.
 *
 * Callbacks run in declaration order. Each callback sees the effective values
 * already resolved for earlier parameters; later parameters still read their
 * stored/default value. That keeps the common "declare the dependency first"
 * style natural without an explicit dependency graph.
 *
 * A free value is also validated in this pass, so a host never runs style code
 * for a parameter itself; `generate()` turns validation off because it is
 * editor feedback, not part of rendering.
 */
import type {
  CitationContext,
  CitationParam,
  Cite,
  CiteParam,
  ListFieldParam,
  ListRow,
  ParamValue,
  StyleOptionParam,
  StyleOptionValues,
} from "../types/style";
import { isThenable } from "./thenable";

export type ParamMode = "free" | "hidden" | "forced";

/** Where one list cell's value came from. */
export type ListCellSource = "provided" | "default";

/** Outcome of a style-declared `validate` callback. */
export type ParamValidation = {
  valid: boolean;
  /** The validator's message, or the error it threw; omitted when it gave none. */
  message?: string;
  /**
   * Set for a validated list cell. `default` means the row supplied no usable
   * value for this field and the core filled the field's own default; the
   * result is a fact about the declaration, not an input the user can clear.
   * A host should not block the run on an invalid `default` cell.
   */
  source?: ListCellSource;
};

export type ParamState = {
  mode: ParamMode;
  value: ParamValue;
  /**
   * Set on a free `value` parameter that declares `validate`. Hidden and forced
   * parameters are never validated.
   */
  validation?: ParamValidation;
  /**
   * Set on a free `list` parameter: field id -> one result per row. Only fields
   * that declare `validate` appear.
   */
  fieldValidation?: Record<string, readonly ParamValidation[]>;
};

/** Options for resolving parameters; `validate` defaults to true. */
export type ParamResolveOptions = {
  /**
   * Run `validate` callbacks. Generate turns this off: validation is editor
   * feedback, not part of rendering.
   */
  validate?: boolean;
};

/**
 * Where a declared stored value came from. `repaired` means the caller supplied
 * a list the core could use only after dropping or patching rows; a host that
 * persists values should not present the patched result as the user's exact
 * choice without saying so.
 */
export type ParamValueSource = "provided" | "default" | "invalid" | "repaired";

export type ParamResolution = {
  /** Persisted choices, with declared defaults filled in. */
  storedValues: Record<string, ParamValue>;
  /**
   * Where each declared stored value came from. `invalid` means the caller
   * supplied something unusable and the core fell back to the default; a host
   * that persists values can warn or reset instead of treating the fallback as
   * the stored choice.
   */
  valueSources: Record<string, ParamValueSource>;
  /** What the style sees after applicable/forcedValue resolution. */
  effectiveValues: Record<string, ParamValue>;
  states: Record<string, ParamState>;
};

export type StyleOptionState = {
  storedValues: StyleOptionValues;
  valueSources: Record<string, ParamValueSource>;
  effectiveValues: StyleOptionValues;
  states: Record<string, ParamState>;
};

export type ResolvedCitation = ParamResolution & {
  citation: CitationContext;
};

export type ResolvedCite = ParamResolution & {
  cite: Cite;
  citation: CitationContext;
};

/**
 * A bridged validator's raw result. It stays `unknown` because the bridge must
 * hand a thenable through to `runValidation`, which turns it into "must return
 * synchronously" and consumes the rejection.
 */
type RuntimeValidator = (value: string, ...scope: unknown[]) => unknown;

type RuntimeParam = {
  id: string;
  kind: "state" | "value" | "list";
  states?: Record<string, string>;
  fields?: readonly ListFieldParam[];
  defaultValue?: ParamValue;
  applicable?: (...scope: unknown[]) => boolean;
  forcedValue?: ParamValue | ((...scope: unknown[]) => unknown);
  validate?: RuntimeValidator;
};

type ScopeArgs = (effective: Record<string, ParamValue>) => unknown[];

type ListCellSources = Record<string, readonly ListCellSource[]>;

type StoredValue = {
  value: ParamValue;
  source: ParamValueSource;
  /** Present for lists: field id -> one source per kept row. */
  cellSources?: ListCellSources;
};

/**
 * Resolve document-wide style options.
 *
 * Unknown keys are dropped: these values belong to the style, not to the
 * document, so a key no current version declares has no meaning.
 */
export function resolveStyleOptionState(
  params: readonly StyleOptionParam[] | undefined,
  rawValues: unknown,
  resolveOptions: ParamResolveOptions = {},
): StyleOptionState {
  const declarations = (params ?? []) as unknown as RuntimeParam[];
  const raw =
    rawValues && typeof rawValues === "object" && !Array.isArray(rawValues)
      ? (rawValues as Record<string, unknown>)
      : {};
  const storedValues: Record<string, ParamValue> = {};
  const valueSources: Record<string, ParamValueSource> = {};
  const cellSources: Record<string, ListCellSources> = {};
  for (const declaration of declarations) {
    const stored = normalizeStoredValue(declaration, raw[declaration.id]);
    storedValues[declaration.id] = stored.value;
    valueSources[declaration.id] = stored.source;
    if (stored.cellSources) cellSources[declaration.id] = stored.cellSources;
  }

  const { effectiveValues, states } = resolveDeclarations(
    declarations,
    storedValues,
    cellSources,
    (effective) => [effective],
    resolveOptions.validate !== false,
  );

  return {
    storedValues: storedValues as StyleOptionValues,
    valueSources,
    effectiveValues: effectiveValues as StyleOptionValues,
    states,
  };
}

/** Resolve one citation's parameters. The returned citation carries effective params. */
export function resolveCitationParamValues(
  params: readonly CitationParam[] | undefined,
  citation: Readonly<CitationContext>,
  options: Readonly<StyleOptionValues>,
  resolveOptions: ParamResolveOptions = {},
): ResolvedCitation {
  const declarations = (params ?? []) as unknown as RuntimeParam[];
  const rawParams = citation.params ?? {};
  const storedValues: Record<string, ParamValue> = { ...rawParams };
  const valueSources: Record<string, ParamValueSource> = {};
  const cellSources: Record<string, ListCellSources> = {};
  for (const declaration of declarations) {
    const stored = normalizeStoredValue(declaration, rawParams[declaration.id]);
    storedValues[declaration.id] = stored.value;
    valueSources[declaration.id] = stored.source;
    if (stored.cellSources) cellSources[declaration.id] = stored.cellSources;
  }

  const buildArgs: ScopeArgs = (effective) => [
    { ...citation, params: effective },
    options,
  ];
  const { effectiveValues, states } = resolveDeclarations(
    declarations,
    storedValues,
    cellSources,
    buildArgs,
    resolveOptions.validate !== false,
  );

  return {
    citation: { ...citation, params: effectiveValues },
    storedValues,
    valueSources,
    effectiveValues,
    states,
  };
}

/** Resolve one cite's parameters. Parent citation/options are already effective. */
export function resolveCiteParamValues(
  params: readonly CiteParam[] | undefined,
  cite: Readonly<Cite>,
  citation: Readonly<CitationContext>,
  options: Readonly<StyleOptionValues>,
  resolveOptions: ParamResolveOptions = {},
): ResolvedCite {
  const declarations = (params ?? []) as unknown as RuntimeParam[];
  const rawParams = cite.params ?? {};
  const storedValues: Record<string, ParamValue> = { ...rawParams };
  const valueSources: Record<string, ParamValueSource> = {};
  const cellSources: Record<string, ListCellSources> = {};
  for (const declaration of declarations) {
    const stored = normalizeStoredValue(declaration, rawParams[declaration.id]);
    storedValues[declaration.id] = stored.value;
    valueSources[declaration.id] = stored.source;
    if (stored.cellSources) cellSources[declaration.id] = stored.cellSources;
  }

  const buildArgs: ScopeArgs = (effective) => [
    { ...cite, params: effective },
    citation,
    options,
  ];
  const { effectiveValues, states } = resolveDeclarations(
    declarations,
    storedValues,
    cellSources,
    buildArgs,
    resolveOptions.validate !== false,
  );

  return {
    cite: { ...cite, params: effectiveValues },
    citation,
    storedValues,
    valueSources,
    effectiveValues,
    states,
  };
}

function resolveDeclarations(
  declarations: readonly RuntimeParam[],
  storedValues: Record<string, ParamValue>,
  cellSources: Record<string, ListCellSources>,
  buildArgs: ScopeArgs,
  validate: boolean,
): Omit<ParamResolution, "storedValues" | "valueSources"> {
  // Every scope starts from the normalized stored/default snapshot. Earlier
  // declarations replace their entry as they resolve; later ones still show
  // their stored/default value to a callback.
  const effectiveValues: Record<string, ParamValue> = { ...storedValues };
  const states: Record<string, ParamState> = {};

  for (const declaration of declarations) {
    const stored = storedValues[declaration.id] ?? neutralValue(declaration);
    const args = buildArgs(effectiveValues);

    if (declaration.applicable) {
      let applicable: boolean;
      try {
        applicable = declaration.applicable(...args) !== false;
      } catch {
        applicable = true;
      }
      if (!applicable) {
        const value = neutralValue(declaration);
        effectiveValues[declaration.id] = value;
        states[declaration.id] = { mode: "hidden", value };
        continue;
      }
    }

    if (declaration.forcedValue !== undefined) {
      let resolved: unknown;
      try {
        resolved =
          typeof declaration.forcedValue === "function"
            ? declaration.forcedValue(...args)
            : declaration.forcedValue;
      } catch {
        resolved = undefined;
      }

      if (resolved === null) {
        effectiveValues[declaration.id] = stored;
        states[declaration.id] = freeState(
          declaration,
          stored,
          args,
          validate,
          cellSources[declaration.id],
        );
        continue;
      }

      const forced = normalizeForcedValue(declaration, resolved);
      if (forced !== undefined) {
        effectiveValues[declaration.id] = forced;
        states[declaration.id] = { mode: "forced", value: forced };
        continue;
      }
    }

    effectiveValues[declaration.id] = stored;
    states[declaration.id] = freeState(
      declaration,
      stored,
      args,
      validate,
      cellSources[declaration.id],
    );
  }

  return { effectiveValues, states };
}

/**
 * A free value is the only place validation applies: hidden and forced values
 * are not the user's input. List fields are validated row by row, so a host can
 * mark the exact input that needs attention.
 */
function freeState(
  declaration: RuntimeParam,
  value: ParamValue,
  args: unknown[],
  validate: boolean,
  cellSources?: ListCellSources,
): ParamState {
  const state: ParamState = { mode: "free", value };
  if (!validate) return state;

  if (
    declaration.kind === "value" &&
    typeof value === "string" &&
    typeof declaration.validate === "function"
  ) {
    state.validation = runValidation(declaration.validate, value, args);
    return state;
  }

  if (declaration.kind === "list" && Array.isArray(value)) {
    const fieldValidation = runListValidation(
      declaration.fields,
      value as readonly ListRow[],
      args,
      cellSources,
    );
    if (fieldValidation) {
      state.fieldValidation = fieldValidation;
    }
  }
  return state;
}

/**
 * Validate every list cell for this resolution.
 *
 * DEBT(second host): no cross-resolution cache is kept — the validator is
 * author code and the surrounding citation/options can change between calls. A
 * bounded per-cite cache is the planned direction once a second host needs it;
 * until then a cached result would silently assume validator purity.
 */
function runListValidation(
  fields: readonly ListFieldParam[] | undefined,
  rows: readonly ListRow[],
  args: unknown[],
  cellSources?: ListCellSources,
): Record<string, readonly ParamValidation[]> | undefined {
  if (!fields?.length) return undefined;

  const results: Record<string, readonly ParamValidation[]> = {};
  let hasValidator = false;
  for (const field of fields) {
    if (typeof field.validate !== "function") continue;
    hasValidator = true;
    const validate = field.validate as RuntimeValidator;
    results[field.id] = rows.map((row, index) => ({
      ...runValidation(validate, row[field.id] ?? field.defaultValue ?? "", [
        row,
        ...args,
      ]),
      source: cellSources?.[field.id]?.[index] ?? "provided",
    }));
  }
  return hasValidator ? results : undefined;
}

function runValidation(
  validate: RuntimeValidator,
  value: string,
  args: unknown[],
): ParamValidation {
  let result: unknown;
  try {
    result = validate(value, ...args);
  } catch (error) {
    return { valid: false, message: validatorErrorMessage(error) };
  }

  if (result === true) return { valid: true };
  if (result === false) return { valid: false };
  if (typeof result === "string") {
    const message = result.trim();
    return message ? { valid: false, message } : { valid: false };
  }
  if (isThenable(result)) {
    // Validation is part of synchronous resolution; consume a rejection so a
    // mistaken async validator does not leak an unhandled promise.
    void Promise.resolve(result).catch(() => {});
    return {
      valid: false,
      message:
        "A parameter validator must return synchronously; resolve async data before validating.",
    };
  }
  return {
    valid: false,
    message:
      "The parameter validator returned an unsupported result; use true, false, or a message.",
  };
}

function validatorErrorMessage(error: unknown): string {
  // `instanceof Error` does not cross realms; a validator throws a sandbox
  // error object, so read `message` structurally instead.
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "The parameter validator threw an error.";
}

function normalizeStoredValue(
  declaration: RuntimeParam,
  raw: unknown,
): StoredValue {
  const fallback = (): StoredValue => {
    const value = neutralValue(declaration);
    return {
      value,
      source: "invalid",
      ...(declaration.kind === "list"
        ? { cellSources: defaultCellSources(declaration, value) }
        : {}),
    };
  };
  if (raw === undefined || raw === null) {
    const value = neutralValue(declaration);
    return {
      value,
      source: "default",
      ...(declaration.kind === "list"
        ? { cellSources: defaultCellSources(declaration, value) }
        : {}),
    };
  }

  switch (declaration.kind) {
    case "state":
      if (declaration.states) {
        return typeof raw === "string" && Object.hasOwn(declaration.states, raw)
          ? { value: raw, source: "provided" }
          : fallback();
      }
      return typeof raw === "boolean"
        ? { value: raw, source: "provided" }
        : fallback();

    case "value":
      return typeof raw === "string"
        ? { value: raw, source: "provided" }
        : fallback();

    case "list": {
      if (!Array.isArray(raw)) {
        return fallback();
      }
      const normalized = normalizeRows(declaration.fields ?? [], raw);
      if (!normalized) {
        return fallback();
      }
      // Every supplied row was unusable: this is the same case as a wrong-kind
      // value, so fall back to the declared default rather than storing [].
      if (!normalized.rows.length && raw.length) {
        return fallback();
      }
      return {
        value: normalized.rows,
        source: normalized.repaired ? "repaired" : "provided",
        cellSources: normalized.cellSources,
      };
    }
  }
}

/** Every cell of a fallback/default list comes from the declaration. */
function defaultCellSources(
  declaration: RuntimeParam,
  value: ParamValue,
): ListCellSources {
  const rows = Array.isArray(value) ? value : [];
  const sources: ListCellSources = {};
  for (const field of declaration.fields ?? []) {
    sources[field.id] = rows.map(() => "default" as const);
  }
  return sources;
}

function normalizeForcedValue(
  declaration: RuntimeParam,
  raw: unknown,
): ParamValue | undefined {
  switch (declaration.kind) {
    case "state":
      if (declaration.states) {
        return typeof raw === "string" && Object.hasOwn(declaration.states, raw)
          ? raw
          : undefined;
      }
      return typeof raw === "boolean" ? raw : undefined;

    case "value":
      return typeof raw === "string" ? raw : undefined;

    case "list": {
      if (!Array.isArray(raw)) {
        return undefined;
      }
      const normalized = normalizeRows(declaration.fields ?? [], raw);
      if (!normalized || (!normalized.rows.length && raw.length)) {
        return undefined;
      }
      return normalized.rows;
    }
  }
}

type NormalizedRows = {
  rows: ListRow[];
  /** Field id -> one source per kept row. */
  cellSources: ListCellSources;
  /** A row was dropped or a field was replaced by its default. */
  repaired: boolean;
};

function normalizeRows(
  fields: readonly ListFieldParam[],
  raw: readonly unknown[],
): NormalizedRows {
  const rows: ListRow[] = [];
  const cellSources: Record<string, ListCellSource[]> = {};
  for (const field of fields) {
    cellSources[field.id] = [];
  }
  let repaired = false;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      repaired = true;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const row: Record<string, string> = {};
    for (const field of fields) {
      const value = record[field.id];
      const sources = cellSources[field.id]!;
      if (typeof value === "string") {
        row[field.id] = value;
        sources.push("provided");
      } else {
        row[field.id] = String(field.defaultValue ?? "");
        sources.push("default");
        repaired = true;
      }
    }
    rows.push(row);
  }
  return { rows, cellSources, repaired };
}

function neutralValue(declaration: RuntimeParam): ParamValue {
  switch (declaration.kind) {
    case "state":
      if (declaration.states) {
        return String(
          declaration.defaultValue ?? Object.keys(declaration.states)[0] ?? "",
        );
      }
      return typeof declaration.defaultValue === "boolean"
        ? declaration.defaultValue
        : false;
    case "value":
      return typeof declaration.defaultValue === "string"
        ? declaration.defaultValue
        : "";
    case "list":
      return Array.isArray(declaration.defaultValue)
        ? (declaration.defaultValue as readonly ListRow[])
        : [];
  }
}

/** Kept for callers that only need stored style options. */
export function resolveStoredStyleOptionValues(
  params: readonly StyleOptionParam[] | undefined,
  rawValues: unknown,
): StyleOptionValues {
  return resolveStyleOptionState(params, rawValues, { validate: false })
    .storedValues;
}
