/**
 * Zotero RDF parser: RDF/XML -> Zotero item records.
 *
 * Implemented over a DOM walk (linkedom XML mode) flattened into triples, so
 * nested resources (`rdf:parseType="Resource"`, containers, series,
 * publishers) and `rdf:Seq` creator lists survive intact. `z:itemType` is
 * authoritative — the outer element name is never consulted. Only Zotero RDF
 * is supported (no Bibliontology); notes, attachments and collections are
 * ignored on parse and never emitted on export.
 *
 * Every name inside the index is *canonical* (`"dc:title"`, `"bib:Series"`),
 * normalized through the document's own `xmlns:*` declarations.
 */
import { DOMParser } from "linkedom";
import { canonicalize, expand } from "./namespaces";
import {
  creatorTypeOfContainerPredicate,
  IDENTIFIER_PREFIXES,
  routesForPlace,
  SELF_FALLBACK_ROUTES,
  Z_NON_FIELD_LOCALS,
  type FieldRoute,
  type IdentifierField,
} from "./mappings";
import {
  containerTitleField,
  mediumFieldOf,
  numberFieldOf,
  publisherFieldOf,
  typeFieldOf,
} from "../library/zotero-fields";

/** Structural view of an XML element (linkedom does not export a type). */
interface XmlElement {
  tagName: string;
  children: ArrayLike<XmlElement>;
  textContent?: string | null;
  getAttribute(name: string): string | null;
}

interface DomElementLike extends XmlElement {
  attributes?: {
    length: number;
    [index: number]: { name: string; value: string } | undefined;
  };
  querySelectorAll(selectors: string): Iterable<DomElementLike>;
}

const RDF_ABOUT = "rdf:about";
const RDF_NODE_ID = "rdf:nodeID";
const RDF_RESOURCE = "rdf:resource";
const RDF_PARSE_TYPE = "rdf:parseType";
const RDF_LI = "rdf:li";
const RDF_VALUE = "rdf:value";
const RDF_TYPE = "rdf:type";
const RDF_DESCRIPTION = "rdf:Description";

export type RdfCreator = {
  creatorType: string;
  name?: string;
  firstName?: string;
  lastName?: string;
};

/**
 * One parsed Zotero RDF item record: Zotero `Item.toJSON()` shape plus the
 * `z:key` extension and the relations record. `extra` stays a
 * field like in Zotero; conversion to a Banyan item is the library layer's job.
 */
export interface ParsedRdfItem {
  /** The RDF node id the item was written under, e.g. `#item_1`. */
  node: string;
  /** `z:key` extension; Zotero exports do not carry it. */
  key?: string;
  itemType: string;
  fields: Record<string, string>;
  creators: RdfCreator[];
  tags: string[];
  /** `dc:relation` plus the `z:relation`/`z:predicate` Banyan extension. */
  relations: Record<string, string[]>;
}

export type Triple = {
  subject: string;
  predicate: string;
  object: string;
  isResource: boolean;
};

export interface RdfGraph {
  triples: Triple[];
  /** Canonical element tag of each subject, from typed node elements. */
  nodeTypes: Map<string, string>;
}

/** Parse an RDF/XML document into a flat triple store (canonical names). */
export function parseGraph(xml: string): RdfGraph {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement as unknown as DomElementLike | null;
  if (!root) {
    throw new Error("Not an RDF/XML document (missing rdf:RDF root).");
  }

  // Namespace prefixes come from the document itself, so alias-prefixed
  // documents parse identically to canonical ones.
  const prefixes = new Map<string, string>();
  const collectPrefixes = (el: DomElementLike): void => {
    const attributes = el.attributes;
    if (!attributes) return;
    for (let index = 0; index < attributes.length; index++) {
      const attr = attributes[index];
      if (
        attr &&
        attr.name.startsWith("xmlns:") &&
        !prefixes.has(attr.name.slice(6))
      ) {
        prefixes.set(attr.name.slice(6), attr.value);
      }
    }
  };
  collectPrefixes(root);
  for (const el of root.querySelectorAll("*")) {
    collectPrefixes(el);
  }

  // The root may use any prefix bound to the RDF namespace (`r:RDF`).
  const rootTag = expand(root.tagName, prefixes);
  if (!rootTag || canonicalize(rootTag) !== "rdf:RDF") {
    throw new Error("Not an RDF/XML document (missing rdf:RDF root).");
  }

  const triples: Triple[] = [];
  const nodeTypes = new Map<string, string>();
  let blankCounter = 0;
  const newBlank = (): string => `_:b${blankCounter++}`;

  /**
   * Read an attribute by its canonical name. Attribute prefixes are aliased
   * like element prefixes (`r:about` for a document binding `r:` to the RDF
   * namespace), so the raw name is expanded first.
   */
  const attributeOf = (
    element: XmlElement,
    canonicalName: string,
  ): string | null => {
    const attributes = (element as DomElementLike).attributes;
    if (!attributes) {
      return element.getAttribute(canonicalName);
    }
    for (let index = 0; index < attributes.length; index++) {
      const attribute = attributes[index];
      if (!attribute) continue;
      const expanded = expand(attribute.name, prefixes);
      const name = expanded ? canonicalize(expanded) : attribute.name;
      if (name === canonicalName) return attribute.value;
    }
    return null;
  };

  /** Walk the property elements of one subject (node element or blank node). */
  const describeProperties = (element: XmlElement, subject: string): void => {
    for (const child of Array.from(element.children)) {
      const expandedPredicate = expand(child.tagName, prefixes);
      if (!expandedPredicate) continue;
      const predicate = canonicalize(expandedPredicate);

      const resource = attributeOf(child, RDF_RESOURCE);
      if (resource !== null) {
        triples.push({
          subject,
          predicate,
          object: resource,
          isResource: true,
        });
        continue;
      }

      if (attributeOf(child, RDF_PARSE_TYPE) === "Resource") {
        // The property element's children are the blank node's properties; the
        // property element's own name is not a class.
        const blank = newBlank();
        triples.push({ subject, predicate, object: blank, isResource: true });
        describeProperties(child, blank);
        continue;
      }

      if (child.children.length) {
        // RDF/XML: a property element holds either one node element or
        // multiple property elements (an implicit anonymous resource).
        if (child.children.length === 1) {
          const nestedSubject = describe(child.children[0]);
          triples.push({
            subject,
            predicate,
            object: nestedSubject,
            isResource: true,
          });
        } else {
          const blank = newBlank();
          triples.push({ subject, predicate, object: blank, isResource: true });
          describeProperties(child, blank);
        }
        continue;
      }

      const text = child.textContent ?? "";
      triples.push({ subject, predicate, object: text, isResource: false });
    }
  };

  /** Describe one node element: its children are property elements. */
  const describe = (element: XmlElement, forcedSubject?: string): string => {
    const about = attributeOf(element, RDF_ABOUT);
    const nodeId = attributeOf(element, RDF_NODE_ID);
    const subject =
      forcedSubject ??
      (about !== null ? about : nodeId !== null ? `_:${nodeId}` : newBlank());

    const expandedTag = expand(element.tagName, prefixes);
    if (expandedTag && canonicalize(expandedTag) !== RDF_DESCRIPTION) {
      nodeTypes.set(subject, canonicalize(expandedTag));
      triples.push({
        subject,
        predicate: RDF_TYPE,
        object: canonicalize(expandedTag),
        isResource: true,
      });
    }

    describeProperties(element, subject);
    return subject;
  };

  for (const child of Array.from(root.children)) {
    describe(child as unknown as XmlElement);
  }

  // `rdf:type` may also be a property of an `rdf:Description`; record those
  // classes too, so structure detection does not depend on the node element's
  // name (typed elements and explicit `rdf:type` both work).
  for (const triple of triples) {
    if (triple.predicate !== RDF_TYPE || !triple.isResource) continue;
    if (!nodeTypes.has(triple.subject)) {
      nodeTypes.set(triple.subject, canonicalize(triple.object));
    }
  }

  return { triples, nodeTypes };
}

type Literal = { predicate: string; value: string };
type Ref = { predicate: string; object: string };

/** Per-subject triple index with document order preserved. */
class SubjectIndex {
  private readonly literals = new Map<string, Literal[]>();
  private readonly refs = new Map<string, Ref[]>();

  constructor(graph: RdfGraph) {
    for (const triple of graph.triples) {
      if (triple.isResource) {
        const list = this.refs.get(triple.subject) ?? [];
        list.push({ predicate: triple.predicate, object: triple.object });
        this.refs.set(triple.subject, list);
      } else {
        const list = this.literals.get(triple.subject) ?? [];
        list.push({ predicate: triple.predicate, value: triple.object });
        this.literals.set(triple.subject, list);
      }
    }
  }

  firstLiteral(subject: string, predicate: string): string | undefined {
    return (this.literals.get(subject) ?? []).find(
      (literal) => literal.predicate === predicate,
    )?.value;
  }

  resources(subject: string, predicate: string): string[] {
    return (this.refs.get(subject) ?? [])
      .filter((ref) => ref.predicate === predicate)
      .map((ref) => ref.object);
  }

  allLiterals(subject: string): Literal[] {
    return this.literals.get(subject) ?? [];
  }

  allRefs(subject: string): Ref[] {
    return this.refs.get(subject) ?? [];
  }
}

/** Predicate -> the field it restores at one place. */
type RouteLookup = Map<string, string[]>;

function routeLookup(routes: readonly FieldRoute[]): RouteLookup {
  const lookup: RouteLookup = new Map();
  for (const route of routes) {
    const fields = lookup.get(route.predicate) ?? [];
    fields.push(route.field);
    lookup.set(route.predicate, fields);
  }
  return lookup;
}

/**
 * `dc:identifier` carries ISSN/ISBN/DOI prefixes, a bare accession number, or
 * a term resource; the prefix decides which field a literal restores.
 */
function identifierFieldOf(
  value: string,
  fallback: string,
): { field: string; value: string } {
  for (const prefix of IDENTIFIER_PREFIXES) {
    if (value.startsWith(`${prefix} `)) {
      const field: IdentifierField = prefix;
      return { field, value: value.slice(prefix.length + 1) };
    }
  }
  return { field: fallback, value };
}

/**
 * Extract every item from the graph, in document order. Only subjects with a
 * `z:itemType` literal are items; everything else (containers, series,
 * publishers, collections) is structure the field resolution reads through.
 */
export function extractItems(graph: RdfGraph): ParsedRdfItem[] {
  const index = new SubjectIndex(graph);
  const items: ParsedRdfItem[] = [];

  for (const triple of graph.triples) {
    if (triple.predicate !== "z:itemType" || triple.isResource) continue;

    const subject = triple.subject;
    const itemType = triple.object;
    const item: ParsedRdfItem = {
      node: subject,
      itemType,
      fields: {},
      creators: [],
      tags: [],
      relations: {},
    };
    const setField = (field: string, value: string | undefined): void => {
      if (value === undefined || value === "") return;
      if (item.fields[field] !== undefined) return;
      item.fields[field] = value;
    };

    // --- structure: section / container / series / conference / publisher ---
    // Zotero nests them: the container hangs off the section when the item has
    // one, and the series hangs off the container.
    let section: string | undefined;
    let container: string | undefined;
    let series: string | undefined;
    for (const node of index.resources(subject, "dcterms:isPartOf")) {
      if (graph.nodeTypes.get(node) === "bib:Part") {
        section ??= node;
      } else if (graph.nodeTypes.get(node) === "bib:Series") {
        series ??= node;
      } else {
        container ??= node;
      }
    }
    if (section) {
      for (const node of index.resources(section, "dcterms:isPartOf")) {
        if (graph.nodeTypes.get(node) === "bib:Series") {
          series ??= node;
        } else {
          container ??= node;
        }
      }
    }
    if (container) {
      for (const node of index.resources(container, "dcterms:isPartOf")) {
        if (graph.nodeTypes.get(node) === "bib:Series") {
          series ??= node;
          break;
        }
      }
    }
    const conference = index.resources(subject, "bib:presentedAt")[0];
    const publisher = index.resources(subject, "dc:publisher")[0];

    setField("section", section ? index.firstLiteral(section, "dc:title") : "");

    // --- mapped literals: self, then container (with the fallback rule) ---
    const selfLookup = routeLookup([
      ...routesForPlace("self"),
      ...SELF_FALLBACK_ROUTES,
    ]);
    const containerLookup = routeLookup([
      // `dc:title` is added back below as the type's parent-title field, and
      // `prism:number` is resolved per item type after this loop.
      ...routesForPlace("container").filter(
        (route) =>
          route.predicate !== "dc:title" && route.predicate !== "prism:number",
      ),
      {
        field: containerTitleField(itemType),
        predicate: "dc:title",
        place: "container",
      },
    ]);
    const seriesLookup = routeLookup(routesForPlace("series"));

    for (const { node, lookup, accessionFallback } of [
      { node: subject, lookup: selfLookup, accessionFallback: true },
      { node: container, lookup: containerLookup, accessionFallback: true },
      { node: series, lookup: seriesLookup, accessionFallback: false },
    ]) {
      if (!node) continue;
      for (const literal of index.allLiterals(node)) {
        if (literal.predicate === "dc:identifier") {
          const restored = identifierFieldOf(
            literal.value,
            accessionFallback ? "accessionNumber" : "seriesNumber",
          );
          setField(restored.field, restored.value);
          continue;
        }
        const fields = lookup.get(literal.predicate);
        if (!fields) continue;
        for (const field of fields) {
          if (item.fields[field] === undefined) {
            setField(field, literal.value);
            break;
          }
        }
      }
    }

    // `prism:number` is one predicate for several fields; the item type decides
    // which one (see `numberFieldOf`). A type that stores no number drops it.
    const numberField = numberFieldOf(itemType);
    if (numberField) {
      for (const node of [subject, container, series]) {
        if (!node) continue;
        if (
          index.allLiterals(node).some((l) => l.predicate === "prism:number")
        ) {
          setField(numberField, index.firstLiteral(node, "prism:number"));
          break;
        }
      }
    }

    // `dc:type` carries whichever type field the item type declares.
    const typeField = typeFieldOf(itemType);
    if (typeField) {
      setField(typeField, index.firstLiteral(subject, "dc:type"));
    }

    // `dcterms:medium` carries `artworkMedium` / `interviewMedium` / `medium`.
    const mediumField = mediumFieldOf(itemType) ?? "medium";
    setField(mediumField, index.firstLiteral(subject, "dcterms:medium"));

    // --- term resources: url (dcterms:URI), callNumber (dcterms:LCC) ---
    for (const ref of index.allRefs(subject)) {
      if (ref.predicate === "dc:identifier") {
        if (graph.nodeTypes.get(ref.object) === "dcterms:URI") {
          setField("url", index.firstLiteral(ref.object, RDF_VALUE));
        }
      } else if (ref.predicate === "dc:subject") {
        const type = graph.nodeTypes.get(ref.object);
        if (type === "dcterms:LCC") {
          setField("callNumber", index.firstLiteral(ref.object, RDF_VALUE));
        } else if (type === "z:AutomaticTag") {
          item.tags.push(index.firstLiteral(ref.object, RDF_VALUE) ?? "");
        }
      }
    }

    // --- publisher organisation: name + address ---
    if (publisher) {
      setField(
        publisherFieldOf(itemType),
        index.firstLiteral(publisher, "foaf:name"),
      );
      const address = index.resources(publisher, "vcard:adr")[0];
      if (address) {
        setField("place", index.firstLiteral(address, "vcard:locality"));
      }
    }

    // --- conference resource ---
    if (conference) {
      setField("conferenceName", index.firstLiteral(conference, "dc:title"));
    }

    // --- creators: rdf:Seq containers keyed by creator type ---
    const seenContainers = new Set<string>();
    for (const ref of index.allRefs(subject)) {
      const creatorType = creatorTypeOfContainerPredicate(ref.predicate);
      if (!creatorType || seenContainers.has(ref.object)) continue;
      seenContainers.add(ref.object);
      for (const member of index.resources(ref.object, RDF_LI)) {
        const surname = index.firstLiteral(member, "foaf:surname") ?? "";
        const givenName = index.firstLiteral(member, "foaf:givenName");
        if (givenName !== undefined) {
          item.creators.push({
            creatorType,
            firstName: givenName,
            lastName: surname,
          });
        } else {
          // Single-name creator: only `surname` was written.
          item.creators.push({ creatorType, name: surname });
        }
      }
    }

    // --- tags: dc:subject literals (manual tags) ---
    for (const literal of index.allLiterals(subject)) {
      if (literal.predicate === "dc:subject" && literal.value) {
        item.tags.push(literal.value);
      }
    }

    // --- relations: dc:relation + the z:relation/z:predicate extension ---
    for (const target of index.resources(subject, "dc:relation")) {
      (item.relations["dc:relation"] ??= []).push(target);
    }
    for (const record of index.resources(subject, "z:relation")) {
      const predicate = index.firstLiteral(record, "z:predicate");
      const object = index.resources(record, "z:object")[0];
      if (predicate && object) {
        (item.relations[canonicalize(predicate)] ??= []).push(object);
      }
    }

    // --- z:key and the z:<field> fallback ---
    const key = index.firstLiteral(subject, "z:key");
    if (key) item.key = key;

    for (const literal of index.allLiterals(subject)) {
      if (!literal.predicate.startsWith("z:")) continue;
      const local = literal.predicate.slice(2);
      if (Z_NON_FIELD_LOCALS.has(local)) continue;
      setField(local, literal.value);
    }

    items.push(item);
  }

  return items;
}

/** Parse a Zotero RDF document into item records (convenience wrapper). */
export function parseZoteroRdf(xml: string): ParsedRdfItem[] {
  return extractItems(parseGraph(xml));
}

export type { Literal, Ref };
