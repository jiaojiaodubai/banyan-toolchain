/**
 * The CSL-M schema, kept separate from official CSL.
 *
 * CSL-M is a distinct schema, not a variant tag on CSL: it has its own complete
 * vocabulary (a superset of CSL with extra item types and variables, plus a few
 * modifications such as `authority` becoming a name). The two schemas are never
 * exported merged: `CSL_M_SCHEMA` stands on its own, and an application chooses
 * which schema it supports.
 *
 * - `CSL_M_*` tables describe the complete CSL-M vocabulary.
 * - `CSL_M_ONLY_*` tables describe only what CSL-M adds, so a caller can ask
 *   whether a name is CSL-M-specific without subtracting the CSL tables.
 *
 * The complete schema is assembled from the official CSL tables plus the
 * curated CSL-M-only part below; that is a maintenance choice, not a merged
 * public schema. The CSL-M-only part comes from the citeproc-js CSL-M
 * documentation (<https://citeproc-js.readthedocs.io/en/latest/csl-m/>).
 */
import {
  CSL_DATE_VARIABLES,
  CSL_ITEM_TYPES,
  CSL_NAME_VARIABLES,
  CSL_NUMBER_VARIABLES,
  CSL_STRING_VARIABLES,
  CSL_TITLE_VARIABLES,
} from "./cslSchema";

/**
 * Item types CSL-M adds to CSL. `gazette` is deprecated in CSL-M but
 * citeproc-js still recognizes it.
 */
const CSL_M_ONLY_ITEM_TYPE_NAMES = [
  "gazette",
  "legal_commentary",
  "video",
] as const;

/** Date variables CSL-M adds to CSL. */
const CSL_M_ONLY_DATE_VARIABLE_NAMES = [
  "alt-issued",
  "locator-date",
  "publication-date",
] as const;

/**
 * Name variables CSL-M adds to CSL. `dummy` is deprecated in citeproc-js but
 * kept because older styles may still declare it.
 */
const CSL_M_ONLY_NAME_VARIABLE_NAMES = [
  "alt-translator",
  "commenter",
  "dummy",
] as const;

/** Number variables CSL-M adds to CSL. */
const CSL_M_ONLY_NUMBER_VARIABLE_NAMES = [
  "first-container-reference-note-number",
  "publication-number",
  "supplement",
] as const;

/** Title variables CSL-M adds to CSL. */
const CSL_M_ONLY_TITLE_VARIABLE_NAMES = [
  "alt-container-title",
  "alt-title",
] as const;

/** Plain string variables CSL-M adds to CSL. */
const CSL_M_ONLY_STRING_VARIABLE_NAMES = [
  "committee",
  "country",
  "court-class",
  "document-name",
  "gazette-flag",
  "hereinafter",
  "language-name",
  "language-name-original",
  "locator-extra",
] as const;

/**
 * `authority` exists in official CSL as a string; CSL-M reclassifies it as an
 * institutional creator (a name variable).
 */
const AUTHORITY_VARIABLE = "authority";

/** Every item type in the complete CSL-M schema. */
const ITEM_TYPE_NAMES = [
  ...CSL_ITEM_TYPES,
  ...CSL_M_ONLY_ITEM_TYPE_NAMES,
].sort();

/** Every date variable in the complete CSL-M schema. */
const DATE_VARIABLE_NAMES = [
  ...CSL_DATE_VARIABLES,
  ...CSL_M_ONLY_DATE_VARIABLE_NAMES,
].sort();

/** Every name variable in the complete CSL-M schema. */
const NAME_VARIABLE_NAMES = [
  ...CSL_NAME_VARIABLES,
  ...CSL_M_ONLY_NAME_VARIABLE_NAMES,
  AUTHORITY_VARIABLE,
].sort();

/** Every number variable in the complete CSL-M schema. */
const NUMBER_VARIABLE_NAMES = [
  ...CSL_NUMBER_VARIABLES,
  ...CSL_M_ONLY_NUMBER_VARIABLE_NAMES,
].sort();

/** Every title variable in the complete CSL-M schema. */
const TITLE_VARIABLE_NAMES = [
  ...CSL_TITLE_VARIABLES,
  ...CSL_M_ONLY_TITLE_VARIABLE_NAMES,
].sort();

/** Every plain string variable in the complete CSL-M schema. */
const STRING_VARIABLE_NAMES = [
  ...[...CSL_STRING_VARIABLES].filter(
    (variable) => variable !== AUTHORITY_VARIABLE,
  ),
  ...CSL_M_ONLY_STRING_VARIABLE_NAMES,
].sort();

/** Every CSL-M-only variable, regardless of group. */
const CSL_M_ONLY_VARIABLE_NAMES = [
  ...CSL_M_ONLY_DATE_VARIABLE_NAMES,
  ...CSL_M_ONLY_NAME_VARIABLE_NAMES,
  ...CSL_M_ONLY_NUMBER_VARIABLE_NAMES,
  ...CSL_M_ONLY_TITLE_VARIABLE_NAMES,
  ...CSL_M_ONLY_STRING_VARIABLE_NAMES,
].sort();

/** Every variable in the complete CSL-M schema. */
const VARIABLE_NAMES = [
  ...DATE_VARIABLE_NAMES,
  ...NAME_VARIABLE_NAMES,
  ...NUMBER_VARIABLE_NAMES,
  ...TITLE_VARIABLE_NAMES,
  ...STRING_VARIABLE_NAMES,
].sort();

/** Item types CSL-M adds to CSL (`type` values citeproc-js accepts). */
export const CSL_M_ONLY_ITEM_TYPES: ReadonlySet<string> = new Set(
  CSL_M_ONLY_ITEM_TYPE_NAMES,
);

/** Every CSL-M-only variable, regardless of group. */
export const CSL_M_ONLY_VARIABLES: ReadonlySet<string> = new Set(
  CSL_M_ONLY_VARIABLE_NAMES,
);

/** Every item type in the complete CSL-M schema. */
export const CSL_M_ITEM_TYPES: ReadonlySet<string> = new Set(ITEM_TYPE_NAMES);

/** Date variables in the complete CSL-M schema. */
export const CSL_M_DATE_VARIABLES: ReadonlySet<string> = new Set(
  DATE_VARIABLE_NAMES,
);

/** Name variables in the complete CSL-M schema. */
export const CSL_M_NAME_VARIABLES: ReadonlySet<string> = new Set(
  NAME_VARIABLE_NAMES,
);

/** Number variables in the complete CSL-M schema. */
export const CSL_M_NUMBER_VARIABLES: ReadonlySet<string> = new Set(
  NUMBER_VARIABLE_NAMES,
);

/** Title variables in the complete CSL-M schema. */
export const CSL_M_TITLE_VARIABLES: ReadonlySet<string> = new Set(
  TITLE_VARIABLE_NAMES,
);

/** Plain string variables in the complete CSL-M schema. */
export const CSL_M_STRING_VARIABLES: ReadonlySet<string> = new Set(
  STRING_VARIABLE_NAMES,
);

/** Every variable in the complete CSL-M schema. */
export const CSL_M_VARIABLES: ReadonlySet<string> = new Set(VARIABLE_NAMES);

/** A schema model shaped like `CSL_SCHEMA`. */
export interface CslMSchemaModel {
  /** Every CSL-M item type (`type` values citeproc-js accepts). */
  readonly itemTypes: readonly string[];
  /** CSL-M variables by group: `dates`, `names`, `numbers`, `titles`, `strings`. */
  readonly variables: Readonly<Record<string, readonly string[]>>;
  /** Every CSL-M variable, regardless of group. */
  readonly variablesAll: readonly string[];
}

/**
 * The complete CSL-M schema: CSL plus the CSL-M additions and modifications.
 *
 * This is curated rather than generated: the CSL-M schema is defined by
 * citeproc-js, not by the official `csl-schema` package. The `CSL_M_ONLY_*`
 * tables above are the delta when a caller needs CSL-M-specific names.
 */
export const CSL_M_SCHEMA: CslMSchemaModel = {
  itemTypes: ITEM_TYPE_NAMES,
  variables: {
    dates: DATE_VARIABLE_NAMES,
    names: NAME_VARIABLE_NAMES,
    numbers: NUMBER_VARIABLE_NAMES,
    titles: TITLE_VARIABLE_NAMES,
    strings: STRING_VARIABLE_NAMES,
  },
  variablesAll: VARIABLE_NAMES,
};
