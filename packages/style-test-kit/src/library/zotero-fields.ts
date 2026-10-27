/**
 * Per-item-type field resolution for the RDF layer.
 *
 * Two sources, one question each:
 *
 * - **which field a base name means** comes from the core's alias map
 *   (`fieldForBase`), e.g. `publicationTitle` -> `bookTitle` on a bookSection;
 * - **whether a type even has a field** comes from the core's per-type field
 *   table (`isZoteroItemField`), e.g. only `case` stores `reporter`, so only its
 *   container title can restore it.
 *
 * Nothing here is a hand-kept table: both facts are generated from the Zotero
 * data model by the core.
 */
import {
  fieldForBase,
  isZoteroItemField,
  specificFieldsForBase,
} from "../banyan";

/** `date` as the type stores it (`issueDate` for a patent, `date` by default). */
export function dateFieldOf(itemType: string): string {
  return fieldForBase(itemType, "date");
}

/** `publisher` as the type stores it (`institution` for a report, ...). */
export function publisherFieldOf(itemType: string): string {
  return fieldForBase(itemType, "publisher");
}

/** `medium` as the type stores it (`artworkMedium`), or `null` when it has none. */
export function mediumFieldOf(itemType: string): string | null {
  return specificFieldsForBase(itemType, "medium")[0] ?? null;
}

/**
 * The type field `dc:type` restores (`reportType`, `thesisType`, `genre`, ...).
 *
 * `null` when the item type declares no type field: Zotero writes `dc:type`
 * only for the types its translator lists, so an unlisted type's `dc:type` is
 * not a field and is dropped rather than guessed onto `type`.
 */
export function typeFieldOf(itemType: string): string | null {
  return specificFieldsForBase(itemType, "type")[0] ?? null;
}

/**
 * The field a container's `dc:title` restores: the type's own title-of-parent
 * field (`bookTitle`, `proceedingsTitle`, ...), `reporter` when the type is a
 * court reporter, `publicationTitle` otherwise.
 *
 * `reporter` has no base field in the Zotero model, so the alias map cannot
 * answer that one; the type's field list can.
 */
export function containerTitleField(itemType: string): string {
  if (isZoteroItemField(itemType, "reporter")) {
    return "reporter";
  }
  return fieldForBase(itemType, "publicationTitle");
}

/**
 * The field a shared `prism:number` literal restores on this item type, or
 * `null` when the type stores no number at all.
 *
 * Zotero's translator writes `prism:number` for `issue`, `number` and
 * `patentNumber` alike, so the field has to be picked per type: the issue of an
 * article, the number of a report or standard, the patent number, or whatever
 * field the type aliases onto `number` (a case's `docketNumber`, a bill's
 * `billNumber`, …).
 */
export function numberFieldOf(itemType: string): string | null {
  if (isZoteroItemField(itemType, "issue")) {
    return "issue";
  }
  if (isZoteroItemField(itemType, "patentNumber")) {
    return "patentNumber";
  }
  if (isZoteroItemField(itemType, "number")) {
    return "number";
  }
  return specificFieldsForBase(itemType, "number")[0] ?? null;
}
