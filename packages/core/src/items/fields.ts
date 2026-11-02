/**
 * Field-level helpers on Banyan items: base-field aliases, field/creator
 * display text and the item type guard.
 *
 * The field tables come from the core's own Zotero schema data
 * (`src/schema/zoteroSchema.ts`), so every host resolves type-specific fields
 * the same way.
 */
import type { Item } from "../types/item";
import type { ScriptItem } from "../types/style";
import { ZOTERO_BASE_FIELD_ALIASES } from "../schema/zoteroSchema";

/**
 * Fields a citation never needs: dropped from items and left out of the
 * author-facing `Item` type, which `scripts/genZoteroSchema.ts` generates.
 *
 * All but `abstractNote` are `Zotero.Item.toJSON()` record metadata, not items
 * of author data — `version` above all is the *record* version (a number that
 * changes on sync), never a field: the Software item type's "Version" field is
 * `versionNumber`, so excluding `version` leaves it untouched. `abstractNote`
 * is a real field on nearly every type; it is dropped because abstract-length
 * text would weigh on what a host stores and on the data crossing to its UI,
 * and no style needs it. A tool that lints style code can warn when a style
 * reads either kind by mistake.
 */
export const EXCLUDED_FIELDS = new Set([
  "version",
  "abstractNote",
  "collections",
  "dateAdded",
  "dateModified",
  "notes",
]);

/** Drop the fields a citation never needs, in place. */
export function stripExcludedFields(json: unknown): void {
  if (!json || typeof json !== "object") return;
  const record = json as Record<string, unknown>;
  for (const field of EXCLUDED_FIELDS) {
    if (field in record) {
      delete record[field];
    }
  }
}

/**
 * Alias table of one item type, or `undefined` for a type the schema does not
 * describe. The table is a plain object, so `Object.hasOwn` keeps names such as
 * `toString` from reaching `Object.prototype`.
 */
function baseFieldAliasesOf(
  itemType: string,
): Record<string, string> | undefined {
  return Object.hasOwn(ZOTERO_BASE_FIELD_ALIASES, itemType)
    ? ZOTERO_BASE_FIELD_ALIASES[itemType]
    : undefined;
}

/**
 * Copy type-specific fields onto their base-field names (e.g. `bookTitle` ->
 * `title`), so styles may read the base field. Existing base values win, and
 * fields the schema does not alias for this item type stay untouched.
 */
export function assignBaseFieldAliases(
  itemType: string,
  record: Record<string, unknown>,
): void {
  const aliases = baseFieldAliasesOf(itemType);
  if (!aliases) return;

  for (const [field, value] of Object.entries(record)) {
    if (typeof value !== "string" || !value) continue;

    const baseFieldName = aliases[field];
    if (!baseFieldName || baseFieldName === field) continue;

    const existing = record[baseFieldName];
    if (typeof existing === "string" && existing) {
      continue;
    }

    record[baseFieldName] = value;
  }
}

/**
 * The fields that store `base` on this item type, sorted.
 *
 * The inverse of `assignBaseFieldAliases`: a host holding a value by its base
 * name (an RDF predicate, a CSL variable) needs the name Zotero actually stores
 * it under — `bookTitle` on a `bookSection`, `publicationTitle` on a
 * `journalArticle` (which is absent from the alias map because it is the base
 * name itself, so callers must fall back to `base`).
 */
export function specificFieldsForBase(
  itemType: string,
  base: string,
): string[] {
  const aliases = baseFieldAliasesOf(itemType);
  if (!aliases) return [];

  return Object.entries(aliases)
    .filter(([, target]) => target === base)
    .map(([field]) => field)
    .sort();
}

/**
 * The field a base name means on this item type: the type-specific field when
 * the schema aliases one, the base name itself otherwise.
 */
export function fieldForBase(itemType: string, base: string): string {
  return specificFieldsForBase(itemType, base)[0] ?? base;
}

export function isBanyanItem(value: unknown): value is Item | ScriptItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.trim() !== "" &&
    typeof record.itemType === "string"
  );
}

export function getItemFieldText(item: Item, field: string): string {
  const v = item[field];
  return typeof v === "string" ? v : "";
}

export function getItemFirstCreatorName(item: Item): string {
  const creator = item.creators?.[0];
  if (!creator) {
    return "";
  }
  if ("lastName" in creator && creator.lastName) {
    return creator.lastName;
  }
  if ("name" in creator && creator.name) {
    return creator.name;
  }
  return "";
}

/**
 * User-friendly display label for an item, matching the citation dialog
 * bubble: first creator's name plus date when available, falling back to
 * the item title (or "Untitled").
 */
export function getItemDisplayLabel(item: Item): string {
  const creator = getItemFirstCreatorName(item);
  const date = typeof item.date === "string" && item.date ? item.date : "";
  const label = [creator, date].filter(Boolean).join(", ");
  if (label) {
    return label;
  }
  return typeof item.title === "string" && item.title ? item.title : "Untitled";
}
