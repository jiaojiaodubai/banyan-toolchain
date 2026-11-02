/**
 * Zotero RDF serializer: Zotero item records -> RDF/XML.
 *
 * Mirrors Zotero's "Zotero RDF" translator export layout, so `rdf dump`
 * output re-imports into Zotero unchanged, and adds the Banyan extensions
 * Zotero does not produce: `z:key` (stable item keys) and
 * `z:relation`/`z:predicate` for non-`dc:relation` relations such as
 * `banyan:multilingual`.
 *
 * The field routing table is shared with the parser (`./mappings`). Container
 * fields fall back onto the subject when the item type has no container, and
 * fields no route covers are written as `z:<field>` — the translator's own
 * catch-all, so the round trip is lossless.
 *
 * Notes and collections are not records (Zotero's export does not give them a
 * `z:itemType`), so they are not emitted. An attachment record is emitted as
 * the item it is, exactly like Zotero's own export does.
 */
import { CANONICAL_NAMESPACES, type CanonicalPrefix } from "./namespaces";
import {
  BIB_TYPES,
  CONTAINER_TYPES,
  creatorContainerPredicate,
  FIELD_ROUTES,
} from "./mappings";
import type { ParsedRdfItem } from "./parse";
import {
  mediumFieldOf,
  publisherFieldOf,
  typeFieldOf,
} from "../library/zotero-fields";

/** Escape XML text content (quotes are legal there). */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape an XML attribute value, quotes included. */
function escapeAttribute(value: string): string {
  return escapeXml(value).replace(/"/g, "&quot;");
}

const IDENTIFIER_FIELDS = ["ISSN", "ISBN", "DOI"] as const;

/**
 * Fields the translator writes to `foaf:name`, plus the type's own publisher
 * field so a record built from a real export round-trips unchanged.
 */
const PUBLISHER_FIELDS = [
  "publisher",
  "distributor",
  "label",
  "company",
  "institution",
] as const;

type InputRecord = {
  /**
   * Subject the record was read under (`#item_*`, a `urn:isbn:`/`urn:issn:`
   * URI, or an item URL). Preserved when present so a real Zotero export keeps
   * its node ids — and therefore its `dc:relation` targets and container
   * references — across `rdf build`.
   */
  node?: string;
  itemType: string;
  fields: Record<string, string>;
  creators: Array<{
    creatorType: string;
    name?: string;
    firstName?: string;
    lastName?: string;
  }>;
  tags?: string[];
  relations?: Record<string, string[]>;
  key?: string;
};

export interface SerializeOptions {
  /**
   * Node id per record, in input order. Defaults to the record's own `node`
   * (what a parsed document used) and otherwise `#item_<n>`, which is what
   * Zotero writes for items without a stable URI; relations that already point
   * at `#item_*` nodes keep working, and key-based targets are resolved through
   * the records' `z:key`s.
   */
  nodeId?: (record: InputRecord, index: number) => string;
}

/** Serialize item records as a Zotero RDF document. */
export function serializeZoteroRdf(
  records: readonly InputRecord[],
  options: SerializeOptions = {},
): string {
  const nodeIdOf =
    options.nodeId ??
    ((record: InputRecord, index: number): string =>
      record.node ?? `#item_${index + 1}`);

  const nodeIds = records.map((record, index) => nodeIdOf(record, index));
  const nodeOfRelation = new Map<string, string>();
  records.forEach((record, index) => {
    if (record.key) nodeOfRelation.set(record.key, nodeIds[index]);
  });

  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<rdf:RDF",
    ...Object.entries(CANONICAL_NAMESPACES).map(
      ([prefix, uri]) => `  xmlns:${prefix}="${uri}"`,
    ),
    ">",
  ];

  records.forEach((record, index) => {
    const lines = serializeRecord(record, nodeIds[index], nodeOfRelation);
    out.push(...lines);
  });

  out.push("</rdf:RDF>", "");
  return out.join("\n");
}

function serializeRecord(
  record: InputRecord,
  subject: string,
  nodeOfRelation: Map<string, string>,
): string[] {
  const itemType = record.itemType;
  const field = (name: string): string | undefined => {
    const value = record.fields[name];
    return value === undefined || value === "" ? undefined : value;
  };

  const out: string[] = [];
  const self: string[] = [];
  const container: string[] = [];
  const written = new Set<string>();
  const hasContainer = CONTAINER_TYPES[itemType] !== undefined;

  const write = (
    target: string[],
    name: string,
    predicate: string,
    value: string,
  ): void => {
    written.add(name);
    target.push(`    <${predicate}>${escapeXml(value)}</${predicate}>`);
  };

  // --- routed fields ---
  for (const route of FIELD_ROUTES) {
    if (route.place === "series") continue; // its own block
    if (route.predicate === "prism:number") {
      // One predicate for issue/number/patentNumber: write the one the type
      // stores, whichever route carries it.
      continue;
    }
    if (route.predicate === "dc:identifier") continue; // identifiers below
    const value = field(route.field);
    if (value === undefined) continue;
    write(
      route.place === "container" && hasContainer ? container : self,
      route.field,
      route.predicate,
      value,
    );
  }

  // --- prism:number (issue / number / patentNumber) ---
  for (const name of ["issue", "number", "patentNumber"] as const) {
    const value = field(name);
    if (value === undefined) continue;
    write(hasContainer ? container : self, name, "prism:number", value);
  }

  // --- identifiers: prefixed ISSN/ISBN/DOI, bare accessionNumber ---
  for (const name of IDENTIFIER_FIELDS) {
    const value = field(name);
    if (value === undefined) continue;
    write(
      hasContainer ? container : self,
      name,
      "dc:identifier",
      `${name} ${value}`,
    );
  }
  const accessionNumber = field("accessionNumber");
  if (accessionNumber !== undefined) {
    write(self, "accessionNumber", "dc:identifier", accessionNumber);
  }

  // --- url and callNumber are term resources with rdf:value ---
  const url = field("url");
  if (url !== undefined) {
    written.add("url");
    self.push(
      `    <dc:identifier><dcterms:URI><rdf:value>${escapeXml(url)}</rdf:value></dcterms:URI></dc:identifier>`,
    );
  }
  const callNumber = field("callNumber");
  if (callNumber !== undefined) {
    written.add("callNumber");
    self.push(
      `    <dc:subject><dcterms:LCC><rdf:value>${escapeXml(callNumber)}</rdf:value></dcterms:LCC></dc:subject>`,
    );
  }

  // --- dc:type carries whichever type field the item type declares ---
  const typeField = typeFieldOf(itemType);
  if (typeField) {
    const value = field(typeField);
    if (value !== undefined) {
      write(self, typeField, "dc:type", value);
    }
  }

  // --- dcterms:medium carries artworkMedium / interviewMedium / medium ---
  const mediumField = mediumFieldOf(itemType) ?? "medium";
  const medium = field(mediumField);
  if (medium !== undefined) {
    write(self, mediumField, "dcterms:medium", medium);
  }

  // --- section (bib:Part) ---
  const section = field("section");
  if (section !== undefined) {
    written.add("section");
    out.push(`    <dcterms:isPartOf>`);
    out.push(`      <bib:Part>`);
    out.push(`        <dc:title>${escapeXml(section)}</dc:title>`);
    out.push(`      </bib:Part>`);
    out.push(`    </dcterms:isPartOf>`);
  }

  // --- container (dcterms:isPartOf) ---
  // The translator emits the container resource for every type that has one,
  // even when it carries no field, so the item type keeps its shape.
  const containerType = CONTAINER_TYPES[itemType];
  if (containerType) {
    out.push(`    <dcterms:isPartOf>`);
    out.push(`      <${containerType}>`);
    out.push(
      `        <rdf:type rdf:resource="${expandQualifiedName(containerType)}"/>`,
    );
    // Container fields are collected at record indentation; nest them one level.
    out.push(...container.map((line) => `    ${line}`));
    out.push(`      </${containerType}>`);
    out.push(`    </dcterms:isPartOf>`);
  }

  // --- series ---
  const seriesLines = serializeSeries(record, field, written);
  if (seriesLines.length) {
    out.push(`    <dcterms:isPartOf>`);
    out.push(`      <bib:Series>`);
    out.push(
      `        <rdf:type rdf:resource="${expandQualifiedName("bib:Series")}"/>`,
    );
    out.push(...seriesLines);
    out.push(`      </bib:Series>`);
    out.push(`    </dcterms:isPartOf>`);
  }

  // --- publisher (foaf:Organization) + place (vcard:Address) ---
  const publisherField = [...PUBLISHER_FIELDS, publisherFieldOf(itemType)].find(
    (name) => field(name) !== undefined,
  );
  const place = field("place");
  if (publisherField !== undefined || place !== undefined) {
    out.push(`    <dc:publisher>`);
    out.push(`      <foaf:Organization>`);
    if (publisherField !== undefined) {
      written.add(publisherField);
      out.push(
        `        <foaf:name>${escapeXml(field(publisherField) ?? "")}</foaf:name>`,
      );
    }
    if (place !== undefined) {
      written.add("place");
      out.push(`        <vcard:adr>`);
      out.push(`          <vcard:Address>`);
      out.push(
        `            <vcard:locality>${escapeXml(place)}</vcard:locality>`,
      );
      out.push(`          </vcard:Address>`);
      out.push(`        </vcard:adr>`);
    }
    out.push(`      </foaf:Organization>`);
    out.push(`    </dc:publisher>`);
  }

  // --- conference ---
  const conferenceName = field("conferenceName");
  if (conferenceName !== undefined) {
    written.add("conferenceName");
    out.push(`    <bib:presentedAt>`);
    out.push(`      <bib:Conference>`);
    out.push(
      `        <rdf:type rdf:resource="${expandQualifiedName("bib:Conference")}"/>`,
    );
    out.push(`        <dc:title>${escapeXml(conferenceName)}</dc:title>`);
    out.push(`      </bib:Conference>`);
    out.push(`    </bib:presentedAt>`);
  }

  // --- z:<field> fallback: everything no route covers round-trips losslessly
  // (language, assignee, applicationNumber, bookTitle, …). ---
  const fallback: string[] = [];
  for (const [name, value] of Object.entries(record.fields)) {
    if (written.has(name) || value === undefined || value === "") continue;
    fallback.push(`    <z:${name}>${escapeXml(value)}</z:${name}>`);
  }

  // --- creators: rdf:Seq containers grouped by creator type ---
  const creators = serializeCreators(record);

  // --- tags (dc:subject literals) ---
  const tags: string[] = [];
  for (const tag of record.tags ?? []) {
    if (tag) tags.push(`    <dc:subject>${escapeXml(tag)}</dc:subject>`);
  }

  // --- relations: dc:relation + z:relation/z:predicate extension ---
  const relations = serializeRelations(record, nodeOfRelation);

  // --- assemble ---
  const head: string[] = [
    `  <rdf:Description rdf:about="${escapeAttribute(subject)}">`,
  ];
  const bibType = BIB_TYPES[itemType];
  if (bibType) {
    head.push(`    <rdf:type rdf:resource="${expandQualifiedName(bibType)}"/>`);
  }
  head.push(`    <z:itemType>${escapeXml(itemType)}</z:itemType>`);
  if (record.key) {
    head.push(`    <z:key>${escapeXml(record.key)}</z:key>`);
  }

  return [
    ...head,
    ...self,
    ...fallback,
    ...out,
    ...creators,
    ...tags,
    ...relations,
    `  </rdf:Description>`,
  ];
}

function serializeSeries(
  record: InputRecord,
  field: (name: string) => string | undefined,
  written: Set<string>,
): string[] {
  const lines: string[] = [];
  for (const route of FIELD_ROUTES) {
    if (route.place !== "series") continue;
    const value = field(route.field);
    if (value === undefined) continue;
    written.add(route.field);
    lines.push(
      `        <${route.predicate}>${escapeXml(value)}</${route.predicate}>`,
    );
  }
  return lines;
}

function serializeCreators(record: InputRecord): string[] {
  const out: string[] = [];
  const byType = new Map<string, NonNullable<InputRecord["creators"]>>();
  for (const creator of record.creators ?? []) {
    const list = byType.get(creator.creatorType) ?? [];
    list.push(creator);
    byType.set(creator.creatorType, list);
  }
  for (const [creatorType, creators] of byType) {
    const predicate = creatorContainerPredicate(creatorType);
    out.push(`    <${predicate}>`, `      <rdf:Seq>`);
    for (const creator of creators) {
      const surname = creator.lastName ?? creator.name ?? "";
      out.push(`        <rdf:li>`);
      out.push(`          <foaf:Person>`);
      out.push(
        `            <rdf:type rdf:resource="${expandQualifiedName("foaf:Person")}"/>`,
      );
      out.push(
        `            <foaf:surname>${escapeXml(surname)}</foaf:surname>`,
      );
      if (creator.firstName) {
        out.push(
          `            <foaf:givenName>${escapeXml(creator.firstName)}</foaf:givenName>`,
        );
      }
      out.push(`          </foaf:Person>`);
      out.push(`        </rdf:li>`);
    }
    out.push(`      </rdf:Seq>`, `    </${predicate}>`);
  }
  return out;
}

function serializeRelations(
  record: InputRecord,
  nodeOfRelation: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const [predicate, targets] of Object.entries(record.relations ?? {})) {
    for (const target of targets) {
      const node = resolveRelationNode(target, nodeOfRelation) ?? target;
      if (predicate === "dc:relation") {
        out.push(`    <dc:relation rdf:resource="${escapeAttribute(node)}"/>`);
        continue;
      }
      out.push(`    <z:relation>`);
      out.push(`      <z:predicate>${escapeXml(predicate)}</z:predicate>`);
      out.push(`      <z:object rdf:resource="${escapeAttribute(node)}"/>`);
      out.push(`    </z:relation>`);
    }
  }
  return out;
}

function resolveRelationNode(
  target: string,
  nodeOfRelation: Map<string, string>,
): string | undefined {
  // Targets may be item keys, `#item_*` nodes or raw URIs; keys map to the
  // nodes assigned this run, everything else passes through.
  return (
    nodeOfRelation.get(target) ?? nodeOfRelation.get(target.replace(/^#/, ""))
  );
}

function splitQualifiedName(name: string): [CanonicalPrefix, string] {
  const index = name.indexOf(":");
  return [name.slice(0, index) as CanonicalPrefix, name.slice(index + 1)];
}

function expandQualifiedName(name: string): string {
  const [prefix, local] = splitQualifiedName(name);
  return `${CANONICAL_NAMESPACES[prefix]}${local}`;
}

export type { ParsedRdfItem };
