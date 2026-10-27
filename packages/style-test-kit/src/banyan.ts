/**
 * The single import point for the `@banyan/core` package.
 *
 * Core contracts, helpers and schema data are re-exported here so host modules
 * and tests share one stable surface. The dependency is pinned to a core
 * release commit in `package.json`; updating that pin is a deliberate
 * adaptation step, not an implicit drift.
 *
 * Host-side mapping conventions for live Zotero items are implemented in
 * `library/` on top of these exports.
 *
 * The core's schema data — constants, the `ZOTERO_SCHEMA` / `CSL_SCHEMA`
 * models and the `isZoteroField` / `resolveZoteroField` / `isCslVariable`
 * queries — arrives through `@banyan/core/schema` below, so a host module can
 * import it from this one place.
 */

// messages + host + style contract
export * from "@banyan/core/messages";
export {
  assertHostCapabilities,
  isSandboxCallable,
  requireCapability,
  resolveHost,
  REQUIRED_HOST_CAPABILITIES,
  type EvaluateOptions,
  type HtmlNodeLike,
  type HtmlRootLike,
  type ResolvedHost,
  type RequiredHostCapabilities,
  type SandboxContext,
  type SandboxRuntime,
  type StyleHost,
  type StyleHostCapabilities,
} from "@banyan/core/host";
export type {
  ReadOptions,
  ReadUTF8Options,
} from "@banyan/core/types/styleUtils";
export type {
  Creator,
  CreatorType,
  ExtraMap,
  ExtraValue,
  Item,
  ItemType,
} from "@banyan/core/types/item";
export type {
  BibliographyEntry,
  BibliographyLine,
  BibliographyTitle,
  CitationType,
  Cite,
  CitationContext,
  CitationParam,
  CitationParams,
  CitationSource,
  CiteParam,
  FieldPreset,
  IntextCitation,
  ItemFieldValidators,
  NoteCitation,
  ScriptItem,
  Style,
  StyleOptionParam,
  StyleOptionValue,
  StyleOptionValues,
  StyleResult,
} from "@banyan/core/types/style";
export type {
  InlineMark,
  RichText,
  TextUnit,
  Unit,
} from "@banyan/core/types/unit";

// items: normalization + creators-ext + extra
export {
  bindCreatorsExt,
  CREATOR_EXT_FIELDS,
  CREATORS_EXT_KEY,
  parseCreatorsExt,
} from "@banyan/core/items/creatorsExt";
export { parseExtraMap, normalizeExtraKey } from "@banyan/core/items/extra";
export {
  assignBaseFieldAliases,
  EXCLUDED_FIELDS,
  fieldForBase,
  getItemFieldText,
  isBanyanItem,
  specificFieldsForBase,
  stripExcludedFields,
} from "@banyan/core/items/fields";

// schema data (authoritative, shared with the core)
export * from "@banyan/core/schema";

// declared parameters: resolution with defaults, applicable/forcedValue/validate
export {
  resolveCitationParamValues,
  resolveCiteParamValues,
  resolveStyleOptionState,
  type ParamMode,
  type ParamResolution,
  type ParamState,
  type ParamValidation,
  type ParamValueSource,
  type ResolvedCitation,
  type ResolvedCite,
  type StyleOptionState,
} from "@banyan/core/validation/paramValues";

// sandbox: style loading, runtime errors and the transpile-helper ledger
export {
  createStyle,
  type CreateStyleOptions,
} from "@banyan/core/sandbox/createStyle";
export {
  createBanyanRuntimeError,
  createGenerateTimeoutError,
  GENERATE_TIMEOUT_MS,
  isRuntimeCode,
  type RuntimeCode,
} from "@banyan/core/sandbox/runtimeErrors";
export {
  transpileHelperBodies,
  transpileHelperNames,
} from "@banyan/core/sandbox/transpileHelpers";

// rendering: the default implementation shared with hosts
export {
  renderBibliographyLineToHtml,
  renderRichTextToHtml,
  renderRichTextToText,
} from "@banyan/core/richText/render";
export {
  emptyRichText,
  getRichTextSegments,
  normalizeRichText,
  richTextFromRuns,
  textToRichText,
} from "@banyan/core/richText/richText";
