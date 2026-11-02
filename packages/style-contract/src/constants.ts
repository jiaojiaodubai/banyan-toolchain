/**
 * Executor-neutral facts about Banyan style declarations.
 *
 * This module is deliberately free of Node, ESLint, Zotero and sandbox APIs:
 * the linter bundle can inline it, and the runtime can import it without
 * pulling a static-analysis dependency into the host.
 */

/** Product boundary for `STYLE_OPTIONS`. */
export const MAX_STYLE_OPTIONS = 16;
/** Soft threshold where a style is encouraged to split its options. */
export const STYLE_OPTION_WARN_THRESHOLD = 12;
export const MAX_STATES = 20;
/** Hostile declarations cannot make the runtime walk an unbounded object. */
export const MAX_STATE_SCAN = 1_000;
export const MAX_PRESETS = 50;

/** Product boundary for `STYLE_DEPENDENCIES`. */
export const MAX_STYLE_DEPENDENCIES = 4;
/** Longest delegation chain, the top-level style included. */
export const MAX_DELEGATION_DEPTH = 3;
/** `callStyle()` calls one top-level run may make, shared by the whole chain. */
export const MAX_DELEGATION_CALLS = 16;
/** Async budget of one `callStyle()`, further bounded by the parent's run. */
export const DELEGATION_TIMEOUT_MS = 30_000;
/** Product boundary for `STYLE_RESOURCES`. */
export const MAX_STYLE_RESOURCES = 8;
/**
 * Per-resource byte cap. The runtime enforces it on every read; hosts that
 * refuse an oversized asset early should use this same constant so a file the
 * host can read is exactly a file the core accepts.
 *
 * It is sized from citation-tooling practice: CSL styles/locales, BibLaTeX
 * `.bst`/`.bbx` files and journal-abbreviation tables are well under 1 MiB, and
 * even a large dictionary table is around 1–2 MiB. 4 MiB leaves room for such a
 * table while eight resources still keep one run's raw reads bounded.
 */
export const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
/** Async budget of one resource read. */
export const RESOURCE_TIMEOUT_MS = 10_000;
/** Directory a style's resources live in, relative to the style directory. */
export const RESOURCE_DIRECTORY = "assets";
/** Longest accepted `STYLE_RESOURCES[].id` (the asset's file name). */
export const MAX_RESOURCE_ID_LENGTH = 64;

/**
 * Citation-context note facts shared by the executors.
 *
 * A `note-citation` host (Word, WPS) renders citations in host notes. Word can
 * place them in footnotes or endnotes, and the two need different numbering
 * scopes, so the host reports the kind on the context instead of the style
 * guessing it. `NoteType` is the author-facing union in
 * `@banyan/core/types/style`; `isNoteType()` is the executable projection the
 * runtime validates with and the linter inspects statically.
 */
export const NOTE_TYPES = ["footnote", "endnote"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const NOTE_TYPE_FOOTNOTE: NoteType = "footnote";
export const NOTE_TYPE_ENDNOTE: NoteType = "endnote";

/**
 * The `page` a host sends for a note with no page semantics.
 *
 * Endnotes are numbered continuously across the document, not per page, so a
 * host that cannot support page-based numbering sends this sentinel instead of
 * the reference mark's page. Word/WPS pages start at 1, so `0` is unambiguous.
 * Styles must not group endnote contexts by `page` and must not display it.
 */
export const NOTE_PAGE_SENTINEL = 0;

export function isNoteType(value: unknown): value is NoteType {
  return value === NOTE_TYPE_FOOTNOTE || value === NOTE_TYPE_ENDNOTE;
}

export const DEPENDENCY_EXPORTS = ["STYLE_DEPENDENCIES"] as const;
export type DependencyExport = (typeof DEPENDENCY_EXPORTS)[number];

export const RESOURCE_EXPORTS = ["STYLE_RESOURCES"] as const;
export type ResourceExport = (typeof RESOURCE_EXPORTS)[number];

export const RESOURCE_FORMATS = ["json", "text"] as const;
export type ResourceFormat = (typeof RESOURCE_FORMATS)[number];

/** Keys a `STYLE_RESOURCES` entry may carry. */
export const RESOURCE_KEYS: ReadonlySet<string> = new Set(["id", "format"]);

export const PARAM_EXPORTS = [
  "STYLE_OPTIONS",
  "CITATION_PARAMS",
  "CITE_PARAMS",
] as const;

export type ParamExport = (typeof PARAM_EXPORTS)[number];
export type ParamScope = "style" | "citation" | "cite";

export const PARAM_SCOPES: Readonly<Record<ParamExport, ParamScope>> = {
  STYLE_OPTIONS: "style",
  CITATION_PARAMS: "citation",
  CITE_PARAMS: "cite",
};

export const PARAM_KINDS = ["state", "value", "list"] as const;
export type ParamKind = (typeof PARAM_KINDS)[number];

export const PARAM_FORMATS = ["plain", "rich"] as const;
export type ParamFormat = (typeof PARAM_FORMATS)[number];

export const PARAM_KEYS: Readonly<Record<ParamKind, ReadonlySet<string>>> = {
  state: new Set([
    "id",
    "kind",
    "label",
    "description",
    "states",
    "defaultValue",
    "forcedValue",
    "validate",
    "applicable",
  ]),
  value: new Set([
    "id",
    "kind",
    "label",
    "description",
    "defaultValue",
    "presets",
    "format",
    "forcedValue",
    "validate",
    "applicable",
  ]),
  list: new Set([
    "id",
    "kind",
    "label",
    "description",
    "fields",
    "min",
    "max",
    "defaultValue",
    "forcedValue",
    "validate",
    "applicable",
  ]),
};

export const LIST_FIELD_KEYS: ReadonlySet<string> = new Set([
  "id",
  "kind",
  "label",
  "description",
  "defaultValue",
  "presets",
  "format",
  "validate",
  "applicable",
  "forcedValue",
]);

/** Keys that must never become declaration keys. */
const RESERVED_DECLARATION_KEYS: ReadonlySet<string> = new Set(["__proto__"]);

export function isReservedDeclarationKey(value: string): boolean {
  return RESERVED_DECLARATION_KEYS.has(value);
}

/** State keys are trimmed before lookup, in both executors. */
export function normalizeStateKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Primary (non-itemData) keys a preset must never target: writing them either
 * throws in `Zotero.Item.setField()` or changes item identity.
 */
export const DENIED_PRESET_KEYS: ReadonlySet<string> = new Set([
  "extra",
  "id",
  "key",
  "itemType",
  "itemTypeID",
  "libraryID",
  "version",
  "dateAdded",
  "dateModified",
  "synced",
  "createdByUserID",
  "lastModifiedByUserID",
  "collections",
  "relations",
  "tags",
  "notes",
  "creators",
  "parentItem",
  "deleted",
]);

/**
 * Normalize an `extra`-field / preset key to canonical kebab-case.
 *
 * Digits stay attached to letters (`date2` stays `date2`) so numeric-suffixed
 * keys remain stable.
 */
export function normalizeExtraKey(value: unknown): string {
  let text: string;
  switch (typeof value) {
    case "string":
      text = value;
      break;
    case "number":
    case "boolean":
      text = String(value);
      break;
    default:
      text = "";
  }
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)(?=[A-Z][a-z])/g, "$1 ")
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The denied set in lookup form, so `Extra` / `extra` / `extra ` all match. */
export const DENIED_NORMALIZED_PRESET_KEYS: ReadonlySet<string> = new Set(
  Array.from(DENIED_PRESET_KEYS, (key) => normalizeExtraKey(key)),
);

export function isDeniedPresetKey(value: string): boolean {
  return DENIED_NORMALIZED_PRESET_KEYS.has(normalizeExtraKey(value));
}

/** Key charset of an `extra` variable line, without the `: value` part. */
const EXTRA_KEY_PATTERN = /^[\p{L}][\p{L}\p{N} _-]*$/u;

/** Whether a key can be written as, and read back from, a variable line. */
export function isValidExtraKey(value: unknown): boolean {
  const key = typeof value === "string" ? value.trim() : "";
  return EXTRA_KEY_PATTERN.test(key);
}

/**
 * Charset of a resource id, which is also the asset's file name in `assets/`.
 *
 * Lowercase letters, digits and single hyphens between them: a public,
 * filesystem-safe name that cannot traverse (`..`, `/`, `\`, `.`) or name a
 * URL scheme. Pure and dependency-free, so the linter and the runtime apply the
 * same rule.
 */
const RESOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Whether a `STYLE_RESOURCES[].id` is a valid asset file name.
 *
 * The runtime checks this again before a host's `readFile` sees the derived
 * `assets/<id>` path, because a host's own policy is not part of the contract.
 */
export function isValidResourceId(value: unknown): boolean {
  if (typeof value !== "string" || value !== value.trim()) {
    return false;
  }
  return (
    value.length > 0 &&
    value.length <= MAX_RESOURCE_ID_LENGTH &&
    RESOURCE_ID_PATTERN.test(value)
  );
}

/**
 * Stable artifact facts for the generated item-type / CSL vocabulary.
 *
 * The tables are generated by `packages/core/scripts/genStyleContractFacts.mjs`
 * from the same source the core's schema modules use. They are data, not a
 * second hand-maintained copy.
 */
export interface SchemaFacts {
  schemaRevision: string;
  zoteroSchemaRevision: string;
  cslSchemaRevision: string;
  zoteroSchemaVersion: number;
  zoteroItemTypes: readonly string[];
  zoteroCreatorTypes: readonly string[];
  zoteroCreatorTypeCslNames: Readonly<Record<string, string>>;
  cslItemTypes: readonly string[];
  cslVariables: readonly string[];
  cslNameVariables: readonly string[];
  cslmItemTypes: readonly string[];
  cslmOnlyItemTypes: readonly string[];
  cslmVariables: readonly string[];
  cslmNameVariables: readonly string[];
}

/**
 * Escape hatch for an executor that has not been rebuilt against the current
 * generated facts. A missing entry is `unknown`, never a definite rejection.
 */
export function isKnownZoteroItemType(
  facts: Pick<SchemaFacts, "zoteroItemTypes">,
  value: string,
): boolean {
  return facts.zoteroItemTypes.includes(value);
}

export function isKnownCslNameVariable(
  facts: Pick<SchemaFacts, "cslNameVariables">,
  value: string,
): boolean {
  return facts.cslNameVariables.includes(value);
}
