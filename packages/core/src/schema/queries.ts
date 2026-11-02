/**
 * Runtime questions a host asks about the schema, answered from the precomputed
 * constants.
 *
 * A host that converts its own item model into the Banyan item shape (or a test
 * tool that generates items from scratch) has to decide, per value, whether it
 * belongs in a real field or has to go somewhere else:
 *
 * - `isZoteroField("bookTitle")` — is this name a Zotero field at all? If not, a
 *   host writing an item has to store it in `extra` instead;
 * - `isZoteroItemField("book", "bookTitle")` — does *this* item type store it?
 *   The same name can be a field for one type and an extra key for another,
 *   which is why the per-type table exists;
 * - `resolveZoteroField("bookSection", "publicationTitle")` — the name a base
 *   field lands on for the type (`bookTitle`), i.e. the decision a host makes
 *   before writing a value; `null` means the type cannot store it;
 * - `isCslVariable("title")` — would this `extra` key collide with a variable
 *   official CSL declares?
 * - `isCslMItemType("book")` / `isCslMVariable("title")` — is it in the
 *   separate CSL-M schema? (CSL-M is a superset, so every CSL name is also a
 *   CSL-M name.)
 * - `isCslMOnlyItemType("video")` / `isCslMOnlyVariable("committee")` — is it
 *   CSL-M-specific, i.e. absent from official CSL?
 *
 * Matching is **exact and case-sensitive**, mirroring Zotero's own
 * `Zotero.ItemFields.getID`: `DOI` is a field, `doi` is not. A caller that
 * wants to accept `doi` has to normalize first — the core does not guess.
 *
 * Unknown item types and names answer `false` / `null` / `[]`: a host asking
 * about something the schema does not describe gets a negative, not an
 * exception.
 */
import { CSL_ITEM_TYPES, CSL_VARIABLES } from "./cslSchema";
import {
  CSL_M_ITEM_TYPES,
  CSL_M_ONLY_ITEM_TYPES,
  CSL_M_ONLY_VARIABLES,
  CSL_M_VARIABLES,
} from "./cslmSchema";
import {
  ZOTERO_BASE_FIELD_ALIASES,
  ZOTERO_CREATOR_TYPES,
  ZOTERO_FIELDS,
  ZOTERO_ITEM_TYPE_FIELDS,
  ZOTERO_ITEM_TYPES,
} from "./zoteroSchema";

/** Field-name sets per item type, built once on first use. */
const fieldSets = new Map<string, ReadonlySet<string>>();

function fieldSetOf(itemType: string): ReadonlySet<string> {
  let fields = fieldSets.get(itemType);
  if (!fields) {
    fields = new Set(
      Object.hasOwn(ZOTERO_ITEM_TYPE_FIELDS, itemType)
        ? (ZOTERO_ITEM_TYPE_FIELDS[itemType] ?? [])
        : [],
    );
    fieldSets.set(itemType, fields);
  }
  return fields;
}

/** The type-specific field a base name lands on, if the type aliases one. */
function specificFieldForBase(
  itemType: string,
  base: string,
): string | undefined {
  // `ZOTERO_BASE_FIELD_ALIASES` is a plain object, so a name such as
  // "toString" would otherwise read `Object.prototype` instead of missing.
  const aliases = Object.hasOwn(ZOTERO_BASE_FIELD_ALIASES, itemType)
    ? ZOTERO_BASE_FIELD_ALIASES[itemType]
    : undefined;
  if (!aliases) return undefined;
  return Object.keys(aliases)
    .filter((field) => aliases[field] === base)
    .sort()[0];
}

/** Whether `name` is an item type a style can see. */
export function isZoteroItemType(name: string): boolean {
  return ZOTERO_ITEM_TYPES.has(name);
}

/** Whether `name` is a Zotero creator type. */
export function isZoteroCreatorType(name: string): boolean {
  return ZOTERO_CREATOR_TYPES.has(name);
}

/**
 * Whether `name` is a Zotero field on any item type.
 *
 * Note that `extra` and `abstractNote` are real fields too, so a host that
 * decides "write to `extra` when this is not a field" must special-case `extra`
 * itself.
 */
export function isZoteroField(name: string): boolean {
  return ZOTERO_FIELDS.has(name);
}

/** The fields Zotero stores on `itemType`, or `[]` for an unknown type. */
export function itemTypeFieldsOf(itemType: string): readonly string[] {
  return Object.hasOwn(ZOTERO_ITEM_TYPE_FIELDS, itemType)
    ? (ZOTERO_ITEM_TYPE_FIELDS[itemType] ?? [])
    : [];
}

/** Whether Zotero stores `name` on `itemType` (an exact field name). */
export function isZoteroItemField(itemType: string, name: string): boolean {
  return fieldSetOf(itemType).has(name);
}

/**
 * The field `name` means on `itemType`: the type-specific field when `name` is
 * a base field the type aliases (`publicationTitle` -> `bookTitle`), the name
 * itself when the type stores it directly, `null` when the type cannot store it.
 */
export function resolveZoteroField(
  itemType: string,
  name: string,
): string | null {
  const fields = fieldSetOf(itemType);
  if (!fields.size) return null;

  const candidate = specificFieldForBase(itemType, name) ?? name;
  return fields.has(candidate) ? candidate : null;
}

/** Whether `name` is a CSL item type (`type` values in CSL data). */
export function isCslItemType(name: string): boolean {
  return CSL_ITEM_TYPES.has(name);
}

/** Whether `name` is a variable official CSL declares. */
export function isCslVariable(name: string): boolean {
  return CSL_VARIABLES.has(name);
}

/** Whether `name` is in the complete CSL-M item type schema. */
export function isCslMItemType(name: string): boolean {
  return CSL_M_ITEM_TYPES.has(name);
}

/** Whether `name` is in the complete CSL-M variable schema. */
export function isCslMVariable(name: string): boolean {
  return CSL_M_VARIABLES.has(name);
}

/** Whether `name` is a CSL-M item type absent from official CSL. */
export function isCslMOnlyItemType(name: string): boolean {
  return CSL_M_ONLY_ITEM_TYPES.has(name);
}

/** Whether `name` is a CSL-M variable absent from official CSL. */
export function isCslMOnlyVariable(name: string): boolean {
  return CSL_M_ONLY_VARIABLES.has(name);
}
