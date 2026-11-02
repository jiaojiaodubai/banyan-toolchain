/**
 * Generated vocabulary, projected for static and runtime consumers.
 *
 * The arrays are the artifact; the sets below are the lookup form used by
 * adapters. A missing revision fact is a build error, not an excuse to guess.
 */
import { SCHEMA_FACTS } from "./generated/schema-facts.js";
import type { SchemaFacts } from "./constants.js";

export { SCHEMA_FACTS };
export type { SchemaFacts };

export const ZOTERO_ITEM_TYPE_SET: ReadonlySet<string> = new Set(
  SCHEMA_FACTS.zoteroItemTypes,
);
export const ZOTERO_CREATOR_TYPE_SET: ReadonlySet<string> = new Set(
  SCHEMA_FACTS.zoteroCreatorTypes,
);
export const ZOTERO_CREATOR_TYPE_CSL_NAMES: Readonly<Record<string, string>> =
  SCHEMA_FACTS.zoteroCreatorTypeCslNames;
export const CSL_ITEM_TYPE_SET: ReadonlySet<string> = new Set(
  SCHEMA_FACTS.cslItemTypes,
);
export const CSL_VARIABLE_SET: ReadonlySet<string> = new Set(
  SCHEMA_FACTS.cslVariables,
);
export const CSL_NAME_VARIABLE_SET: ReadonlySet<string> = new Set(
  SCHEMA_FACTS.cslNameVariables,
);
export const CSL_M_ITEM_TYPE_SET: ReadonlySet<string> = new Set(
  SCHEMA_FACTS.cslmItemTypes,
);
export const CSL_M_ONLY_ITEM_TYPE_SET: ReadonlySet<string> = new Set(
  SCHEMA_FACTS.cslmOnlyItemTypes,
);
export const CSL_M_VARIABLE_SET: ReadonlySet<string> = new Set(
  SCHEMA_FACTS.cslmVariables,
);
export const CSL_M_NAME_VARIABLE_SET: ReadonlySet<string> = new Set(
  SCHEMA_FACTS.cslmNameVariables,
);
