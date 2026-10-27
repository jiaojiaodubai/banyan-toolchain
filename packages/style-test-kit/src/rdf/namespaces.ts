/**
 * Zotero RDF namespaces and prefix normalization.
 *
 * The parser expands every qualified name through the *document's own*
 * `xmlns:*` declarations onto canonical namespace URIs, so documents that use
 * alias prefixes round-trip the same as canonical ones. Expanded names are the
 * strings `{namespaceUri}{local}`; the URIs all end in `#` or `/`, so the
 * concatenation is unambiguous.
 */

export const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

/** Canonical prefixes, as the Zotero RDF translator declares them. */
export const CANONICAL_NAMESPACES = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  bib: "http://purl.org/net/biblio#",
  dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/",
  prism: "http://prismstandard.org/namespaces/1.2/basic/",
  foaf: "http://xmlns.com/foaf/0.1/",
  vcard: "http://nwalsh.com/rdf/vCard#",
  vcard2: "http://www.w3.org/2006/vcard/ns#",
  link: "http://purl.org/rss/1.0/modules/link/",
  z: "http://www.zotero.org/namespaces/export#",
} as const;

export type CanonicalPrefix = keyof typeof CANONICAL_NAMESPACES;

const URI_TO_PREFIX = new Map<string, CanonicalPrefix>(
  Object.entries(CANONICAL_NAMESPACES).map(([prefix, uri]) => [
    uri,
    prefix as CanonicalPrefix,
  ]),
);

/** `{uri}{local}` -> `prefix:local` when the URI is a known namespace. */
export function canonicalize(expanded: string): string {
  for (const [uri, prefix] of URI_TO_PREFIX) {
    if (expanded.startsWith(uri)) {
      return `${prefix}:${expanded.slice(uri.length)}`;
    }
  }
  return expanded;
}

/** `prefix:local` -> `{uri}{local}` against a document's prefix map. */
export function expand(
  qualified: string,
  prefixes: ReadonlyMap<string, string>,
): string | null {
  const index = qualified.indexOf(":");
  if (index < 0) return null;
  const prefix = qualified.slice(0, index);
  const uri = prefixes.get(prefix);
  if (uri === undefined) return null;
  return `${uri}${qualified.slice(index + 1)}`;
}

export const localOf = (expanded: string, uri: string): string =>
  expanded.startsWith(uri) ? expanded.slice(uri.length) : expanded;
