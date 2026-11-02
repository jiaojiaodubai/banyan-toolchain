/**
 * Field <-> predicate routing for Zotero RDF, ported from Zotero's "Zotero RDF"
 * translator (`zotero/translators/Zotero RDF.js`). AGPL-3.0-or-later
 * (transcribed/organized from Zotero, AGPL-3.0-or-later).
 *
 * One table drives both directions, so the parser and the serializer cannot
 * drift apart:
 *
 * - `place` says which resource holds the value: the item subject (`self`), its
 *   `dcterms:isPartOf` container, or the `bib:Series` resource;
 * - the serializer falls container fields back onto the subject when the item
 *   type has no container, exactly like the translator's container fallback;
 * - the parser reads container fields from *both* positions for the same
 *   reason, except `dc:title` — that one is only a container title on the
 *   container resource, because the subject's `dc:title` is always `title`;
 * - any field no route covers is written as `z:<field>` and read back from it,
 *   so unmapped fields stay lossless through the `z:` fallback.
 *
 * Publisher and conference resources are structural rather than one-to-one
 * routes (`foaf:Organization` + `vcard:Address`, `bib:Conference`), so the
 * parser and serializer handle them explicitly; the per-item-type names they
 * restore come from `library/zotero-fields.ts`.
 *
 * Per-item-type names (`bookTitle`, `reportType`, the publisher field, …) are
 * resolved from the core's schema in `library/zotero-fields.ts`; this module
 * holds only knowledge that belongs to the RDF translator itself.
 */
import type { CanonicalPrefix } from "./namespaces";

/** `dc:identifier` value prefixes used to disambiguate repeated predicates. */
export const IDENTIFIER_PREFIXES = ["ISSN", "ISBN", "DOI"] as const;

export type IdentifierField = (typeof IDENTIFIER_PREFIXES)[number];

/** Place a value lives in, as the translator writes it. */
export type FieldPlace = "self" | "container" | "series";

/** One field <-> predicate route. */
export interface FieldRoute {
  /** Zotero field name, as the translator iterates `uniqueFields`. */
  readonly field: string;
  /** Canonical predicate (`dc:title`, `prism:number`, ...). */
  readonly predicate: string;
  /** Resource that carries the value. */
  readonly place: FieldPlace;
}

/**
 * The translator's field routing, in the order it writes them. Order also
 * decides document layout, which keeps fixtures and real exports comparable.
 */
export const FIELD_ROUTES: readonly FieldRoute[] = [
  { field: "title", predicate: "dc:title", place: "self" },
  { field: "date", predicate: "dc:date", place: "self" },
  { field: "extra", predicate: "dc:description", place: "self" },
  { field: "rights", predicate: "dc:rights", place: "self" },
  { field: "source", predicate: "dc:source", place: "self" },
  { field: "archiveLocation", predicate: "dc:coverage", place: "self" },
  { field: "abstractNote", predicate: "dcterms:abstract", place: "self" },
  { field: "accessDate", predicate: "dcterms:dateSubmitted", place: "self" },
  { field: "issueDate", predicate: "dcterms:issued", place: "self" },
  { field: "pages", predicate: "bib:pages", place: "self" },
  { field: "edition", predicate: "prism:edition", place: "self" },

  // Container fields; they fall back onto the subject when the item type has
  // no container resource.
  { field: "publicationTitle", predicate: "dc:title", place: "container" },
  { field: "reporter", predicate: "dc:title", place: "container" },
  {
    field: "journalAbbreviation",
    predicate: "dcterms:alternative",
    place: "container",
  },
  { field: "volume", predicate: "prism:volume", place: "container" },
  { field: "issue", predicate: "prism:number", place: "container" },
  { field: "number", predicate: "prism:number", place: "container" },
  { field: "patentNumber", predicate: "prism:number", place: "container" },

  { field: "series", predicate: "dc:title", place: "series" },
  { field: "seriesTitle", predicate: "dcterms:alternative", place: "series" },
  { field: "seriesText", predicate: "dc:description", place: "series" },
  { field: "seriesNumber", predicate: "dc:identifier", place: "series" },
];

/** Routes that live in one place, grouped by predicate. */
export function routesForPlace(place: FieldPlace): FieldRoute[] {
  return FIELD_ROUTES.filter((route) => route.place === place);
}

/**
 * Container routes the parser also accepts on the item subject: the fallback
 * the serializer performs. Two predicates are excluded because the subject
 * position cannot decide them:
 *
 * - `dc:title` — on the subject it means `title`;
 * - `prism:number` — resolved per item type (`issue` / `number` /
 *   `patentNumber`), see `numberFieldOf`.
 */
export const SELF_FALLBACK_ROUTES: readonly FieldRoute[] = routesForPlace(
  "container",
).filter(
  (route) =>
    route.predicate !== "dc:title" && route.predicate !== "prism:number",
);

/** RDF class per Zotero item type, from the translator. */
export const BIB_TYPES: Partial<
  Record<string, `${CanonicalPrefix}:${string}`>
> = {
  book: "bib:Book",
  bookSection: "bib:BookSection",
  journalArticle: "bib:Article",
  magazineArticle: "bib:Article",
  newspaperArticle: "bib:Article",
  thesis: "bib:Thesis",
  letter: "bib:Letter",
  manuscript: "bib:Manuscript",
  interview: "bib:Interview",
  film: "bib:MotionPicture",
  artwork: "bib:Illustration",
  webpage: "bib:Document",
  report: "bib:Report",
  bill: "bib:Legislation",
  case: "bib:Document",
  hearing: "bib:Report",
  patent: "bib:Patent",
  statute: "bib:Legislation",
  email: "bib:Letter",
  map: "bib:Image",
  blogPost: "bib:Document",
  instantMessage: "bib:Letter",
  forumPost: "bib:Document",
  audioRecording: "bib:Recording",
  presentation: "bib:ConferenceProceedings",
  videoRecording: "bib:Recording",
  tvBroadcast: "bib:Recording",
  radioBroadcast: "bib:Recording",
  podcast: "bib:Recording",
  computerProgram: "bib:Data",
};

/** Container class per item type, from the translator (may be absent). */
export const CONTAINER_TYPES: Partial<
  Record<string, `${CanonicalPrefix}:${string}`>
> = {
  bookSection: "bib:Book",
  journalArticle: "bib:Journal",
  magazineArticle: "bib:Periodical",
  newspaperArticle: "bib:Newspaper",
  case: "bib:CourtReporter",
  webpage: "z:Website",
  blogPost: "z:Blog",
  forumPost: "z:Forum",
  encyclopediaArticle: "bib:Book",
  dictionaryEntry: "bib:Book",
  conferencePaper: "bib:Journal",
};

/** Creator types the translator puts in the biblio namespace. */
export const BIBLIO_CREATOR_TYPES: ReadonlySet<string> = new Set([
  "author",
  "editor",
  "contributor",
]);

/** `bib:authors` / `z:translators` for a creator type. */
export function creatorContainerPredicate(creatorType: string): string {
  const prefix: CanonicalPrefix = BIBLIO_CREATOR_TYPES.has(creatorType)
    ? "bib"
    : "z";
  return `${prefix}:${creatorType}s`;
}

/** `bib:authors` / `z:translators` -> `author` / `translator`, or `null`. */
export function creatorTypeOfContainerPredicate(
  canonical: string,
): string | null {
  const match = /^(?:bib|z):([a-zA-Z]+)s$/.exec(canonical);
  return match ? match[1] : null;
}

/** `z:` locals that are record metadata or extensions, never item fields. */
export const Z_NON_FIELD_LOCALS: ReadonlySet<string> = new Set([
  "itemType",
  "key",
  "displayTitle",
  "path",
  "linkMode",
  "Attachment",
  "Website",
  "Blog",
  "Forum",
  "Collection",
  "AutomaticTag",
  "relation",
  "predicate",
  "object",
]);
