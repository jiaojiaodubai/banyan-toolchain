/**
 * `firstCreator` computation matching Zotero's SQL implementation.
 *
 * Creators are grouped by [primary creatorType of the item type, editor,
 * director, contributor]; the first non-empty group wins. One creator renders
 * as the surname (or single name), two are joined with `andJoiner` and wrapped
 * in bidirectional isolation (U+2068/U+2069), three or more use `et al.`.
 *
 * The primary creator type comes from the core's
 * `ZOTERO_PRIMARY_CREATOR_TYPES` table (generated from Zotero's schema); items
 * whose creators are none of those four types get an empty `firstCreator`, as
 * in Zotero — a style then falls back to the title.
 */
import type { RdfCreator } from "../rdf/parse";
import { ZOTERO_PRIMARY_CREATOR_TYPES } from "../banyan";

export const BIDI_ISOLATE_START = "\u2068";
export const BIDI_ISOLATE_END = "\u2069";

export interface FirstCreatorOptions {
  andJoiner?: string;
  etAl?: string;
}

/** Creator types consulted after the primary one, in Zotero's order. */
const FALLBACK_CREATOR_TYPES = ["editor", "director", "contributor"] as const;

function surnameOf(creator: RdfCreator): string {
  return creator.lastName ?? creator.name ?? "";
}

export function computeFirstCreator(
  itemType: string,
  creators: readonly RdfCreator[],
  options: FirstCreatorOptions = {},
): string {
  if (!creators.length) return "";
  const andJoiner = options.andJoiner ?? "and";
  const etAl = options.etAl ?? "et al.";

  const groups = [
    ZOTERO_PRIMARY_CREATOR_TYPES[itemType] ?? "author",
    ...FALLBACK_CREATOR_TYPES,
  ].map((type) =>
    creators
      .filter((creator) => creator.creatorType === type)
      .map(surnameOf)
      .filter(Boolean),
  );

  const names = groups.find((group) => group.length);
  if (!names) {
    return "";
  }

  if (names.length === 1) {
    return names[0];
  }
  if (names.length === 2) {
    return `${BIDI_ISOLATE_START}${names[0]} ${andJoiner} ${names[1]}${BIDI_ISOLATE_END}`;
  }
  return `${names[0]} ${etAl}`;
}
