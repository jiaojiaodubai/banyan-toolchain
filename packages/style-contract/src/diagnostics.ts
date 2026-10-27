/**
 * Stable diagnostic identifiers shared by every executor.
 *
 * An identifier names a *semantic* finding, not an English sentence and not a
 * severity. The runtime keeps its own message text and the linter keeps its own
 * `messageId`; both attach the identifier below so a conformance fixture can
 * compare what they found without comparing prose.
 *
 * Adding an identifier is a public-contract change. Renaming one is a breaking
 * change even while the packages are private, because fixtures and consumer
 * reports persist the string.
 */

export const CONTRACT_DIAGNOSTIC_IDS = [
  // Style-level contract.
  "style.export.missing",
  "style.entry.not-function",
  "style.info.not-object",
  "style.info.field.missing",
  "style.info.field.invalid-type",
  "style.info.citation-type.invalid",
  "style.info.creator.invalid",

  // Generic declaration shape and identity.
  "declaration.export.not-array",
  "declaration.export.empty",
  "declaration.entry.not-object",
  "declaration.id.invalid",
  "declaration.id.duplicate",
  "declaration.id.reserved",
  "declaration.kind.invalid",
  "declaration.key.unknown",
  "declaration.label.invalid",
  "declaration.description.invalid",

  // Parameters.
  "param.style-options.empty",
  "param.style-options.limit",
  "param.style-options.threshold",
  "param.list.scope",
  "param.applicable.unsupported",
  "param.applicable.invalid",
  "param.forced-value.invalid",
  "param.state.validate-unsupported",
  "param.state.presets-unsupported",
  "param.state.format-unsupported",
  "param.states.invalid",
  "param.states.empty",
  "param.states.key.invalid",
  "param.states.key.whitespace",
  "param.states.key.dynamic",
  "param.states.key.duplicate",
  "param.states.label.invalid",
  "param.states.label.coerced",
  "param.states.limit",
  "param.state.default.missing",
  "param.state.default.invalid",
  "param.state.default.fallback",
  "param.state.default.boolean-invalid",
  "param.value.default.invalid",
  "param.value.default.coerced",
  "param.format.invalid",
  "param.validate.invalid",
  "param.presets.invalid",
  "param.preset.invalid",
  "param.preset.value-missing",
  "param.preset.label-invalid",
  "param.preset.duplicate",
  "param.presets.limit",
  "param.list.fields-invalid",
  "param.list.field.not-object",
  "param.list.field.id.invalid",
  "param.list.field.id.duplicate",
  "param.list.field.id.reserved",
  "param.list.field.kind.invalid",
  "param.list.field.condition-unsupported",
  "param.list.field.key.unknown",
  "param.list.minmax.invalid",
  "param.list.minmax.order",
  "param.list.row.invalid",
  "param.list.row.key.unknown",
  "param.list.row.value.invalid",
  "param.list.rows.bounds",

  // Field presets.
  "preset.export.not-array",
  "preset.entry.not-object",
  "preset.id.invalid",
  "preset.id.duplicate",
  "preset.label.invalid",
  "preset.visible.invalid",
  "preset.fields.missing",
  "preset.fields.invalid",
  "preset.field.key.dynamic",
  "preset.field.key.denied",
  "preset.field.key.invalid",
  "preset.field.value.invalid",
  "preset.field.value.empty",
  "preset.field.name-variable",
  "preset.field.creator-type",
  "preset.field.type.csl",
  "preset.field.type.cslm",
  "preset.field.type.zotero",
  "preset.field.type.invalid",
  "preset.field.unknown",

  // Item-field validators.
  "validator.export.not-object",
  "validator.group.key.dynamic",
  "validator.group.key.invalid",
  "validator.group.unknown-item-type",
  "validator.group.not-array",
  "validator.group.empty",
  "validator.entry.not-object",
  "validator.description.invalid",
  "validator.description.duplicate",
  "validator.check.invalid",

  // Static-only advisories. These never become runtime findings.
  "lint.recursion.direct",
  "lint.loop.unbounded-while",
  "lint.loop.unbounded-for",
  "lint.loop.large-bound",
  "lint.item-field.label",
  "lint.item-field.not-carried",
  "lint.item-field.host-private",
  "lint.param-count",
] as const;

export type ContractDiagnosticId = (typeof CONTRACT_DIAGNOSTIC_IDS)[number];

/** Path into a declaration, e.g. `["STYLE_OPTIONS", 0, "states", "key"]`. */
export type ContractPath = readonly (string | number)[];

/**
 * One executor-neutral finding. Executors add their own location and prose;
 * this object is what parity fixtures compare.
 */
export interface ContractFinding {
  diagnosticId: ContractDiagnosticId;
  path: ContractPath;
  data?: Readonly<Record<string, unknown>>;
}

export type Executor = "lint" | "runtime";

/** How an executor treats a finding. `ignore` means "do not emit". */
export type FindingSeverity = "error" | "warning" | "info" | "ignore";

export interface FindingPolicy {
  /** The behaviour both executors must agree on. */
  canonical: string;
  runtime: FindingSeverity;
  lint: FindingSeverity;
}

/**
 * Documented executor differences. Everything absent here is expected to have
 * the same severity in both executors (or to be static-only, listed below).
 *
 * This table is the reviewed answer to "is stricter lint allowed?" — stricter
 * author feedback is allowed, but the canonical meaning and the runtime's
 * final defence must not be weakened.
 */
export const EXECUTOR_POLICY = {
  "param.states.key.whitespace": {
    canonical:
      "State keys are trimmed before lookup. Two keys that collide after trimming are a declaration error.",
    runtime: "warning",
    lint: "error",
  },
  "param.states.key.duplicate": {
    canonical:
      "A collision created by trimming is reported; the first spelling wins and later duplicates are dropped.",
    runtime: "warning",
    lint: "error",
  },
  "param.state.default.missing": {
    canonical:
      "A state that declares `states` must name one of them. The runtime falls back to the first state; lint rejects the omission.",
    runtime: "warning",
    lint: "error",
  },
  "param.state.default.invalid": {
    canonical:
      "A state default must be a string key present after trimming. Numeric, boolean, empty and unknown values all fall back to the first state.",
    runtime: "warning",
    lint: "error",
  },
  "param.state.default.boolean-invalid": {
    canonical:
      "A boolean state default must be a boolean; the runtime falls back to false.",
    runtime: "warning",
    lint: "error",
  },
  "param.states.empty": {
    canonical:
      "`states: {}` is not a usable enum declaration. The runtime degrades to a boolean state; lint rejects it.",
    runtime: "warning",
    lint: "error",
  },
  "param.style-options.empty": {
    canonical:
      "An empty `STYLE_OPTIONS` array declares nothing. Both executors report it and ignore the export.",
    runtime: "warning",
    lint: "warning",
  },
  "validator.group.empty": {
    canonical:
      "An item type mapped to no checkers produces no executable checker. Both executors report it and ignore the group.",
    runtime: "warning",
    lint: "error",
  },
  "validator.group.unknown-item-type": {
    canonical:
      "The item type must exist in the schema revision the executor was built against. Runtime ignores the group; lint reports a definite unknown type.",
    runtime: "warning",
    lint: "error",
  },
  "param.style-options.limit": {
    canonical:
      "At most 16 style options are kept. Runtime truncates with a warning; lint reports a statically certain overflow.",
    runtime: "warning",
    lint: "error",
  },
  "param.states.limit": {
    canonical:
      "At most 20 states are kept; a declared default or static forced value stays selectable. Runtime truncates with a warning; lint reports a statically certain overflow.",
    runtime: "warning",
    lint: "error",
  },
  "param.presets.limit": {
    canonical:
      "At most 50 presets are kept. Runtime truncates with a warning; lint reports a statically certain overflow.",
    runtime: "warning",
    lint: "error",
  },
  "preset.field.key.denied": {
    canonical:
      "Primary, identity and `extra` keys cannot be written by a preset. Runtime ignores the entry; lint rejects it.",
    runtime: "warning",
    lint: "error",
  },
} satisfies Partial<Record<ContractDiagnosticId, FindingPolicy>>;

/** Findings only a static executor can produce. */
export const LINT_ONLY_DIAGNOSTICS = [
  "lint.recursion.direct",
  "lint.loop.unbounded-while",
  "lint.loop.unbounded-for",
  "lint.loop.large-bound",
  "lint.item-field.label",
  "lint.item-field.not-carried",
  "lint.item-field.host-private",
  "lint.param-count",
  "param.states.key.dynamic",
  "preset.field.key.dynamic",
  "validator.group.key.dynamic",
] as const satisfies readonly ContractDiagnosticId[];

export function policyOf(
  diagnosticId: ContractDiagnosticId,
): FindingPolicy | undefined {
  return (
    EXECUTOR_POLICY as Partial<Record<ContractDiagnosticId, FindingPolicy>>
  )[diagnosticId];
}
