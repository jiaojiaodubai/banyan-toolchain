/**
 * The testkit reads the Zotero data model from the core rather than keeping a
 * copy. This suite is the fact check that makes that claim
 * testable, written the way a host uses the core:
 *
 * - the core index exposes both the runtime model (`ZOTERO_SCHEMA`,
 *   `CSL_SCHEMA`) and the precomputed tables; they must describe one model;
 * - the facts the RDF mapping and `firstCreator` derive from are the ones the
 *   model declares;
 * - the query predicates answer the questions a conversion layer asks
 *   (`isZoteroField`, `resolveZoteroField`, `isCslVariable`,
 *   `isCslMOnlyVariable`).
 */
import { expect } from "chai";
import {
  CSL_M_SCHEMA,
  CSL_SCHEMA,
  ZOTERO_BASE_FIELD_ALIASES,
  ZOTERO_FIELDS,
  ZOTERO_ITEM_TYPE_FIELDS,
  ZOTERO_ITEM_TYPES,
  ZOTERO_PRIMARY_CREATOR_TYPES,
  ZOTERO_SCHEMA,
  ZOTERO_SCHEMA_VERSION,
  fieldForBase,
  isCslItemType,
  isCslMItemType,
  isCslMOnlyItemType,
  isCslMOnlyVariable,
  isCslMVariable,
  isCslVariable,
  isZoteroField,
  isZoteroItemField,
  isZoteroItemType,
  itemTypeFieldsOf,
  resolveZoteroField,
  specificFieldsForBase,
} from "../src/banyan";
import {
  containerTitleField,
  numberFieldOf,
} from "../src/library/zotero-fields";

describe("the core's runtime schema model", () => {
  it("covers every item type the core exposes", () => {
    expect(Object.keys(ZOTERO_SCHEMA.itemTypes).sort()).to.deep.equal(
      [...ZOTERO_ITEM_TYPES].sort(),
    );
    expect(ZOTERO_SCHEMA.version).to.equal(ZOTERO_SCHEMA_VERSION);
    for (const itemType of ZOTERO_ITEM_TYPES) {
      expect(
        ZOTERO_SCHEMA.itemTypes[itemType]?.fields.length,
      ).to.be.greaterThan(0);
      expect(
        ZOTERO_SCHEMA.itemTypes[itemType]?.creatorTypes.length,
      ).to.be.greaterThan(0);
    }
  });

  it("agrees with the tables the testkit uses", () => {
    for (const itemType of ZOTERO_ITEM_TYPES) {
      const entry = ZOTERO_SCHEMA.itemTypes[itemType];
      expect([...(ZOTERO_ITEM_TYPE_FIELDS[itemType] ?? [])]).to.deep.equal([
        ...(entry?.fields ?? []),
      ]);
      expect(entry?.baseFields ?? {}).to.deep.equal(
        ZOTERO_BASE_FIELD_ALIASES[itemType] ?? {},
      );
      expect(ZOTERO_PRIMARY_CREATOR_TYPES[itemType]).to.equal(
        entry?.primaryCreatorType,
      );
    }
  });

  it("publishes the union of every type's fields", () => {
    const union = new Set(
      Object.values(ZOTERO_ITEM_TYPE_FIELDS).flatMap((fields) => [...fields]),
    );
    expect(new Set([...ZOTERO_FIELDS].sort())).to.deep.equal(union);
  });
});

describe("facts the RDF layer derives from the model", () => {
  it("only court reporters restore `reporter` from a container title", () => {
    expect(containerTitleField("case")).to.equal("reporter");
    expect(containerTitleField("journalArticle")).to.equal("publicationTitle");
    expect(containerTitleField("bookSection")).to.equal("bookTitle");
    expect(containerTitleField("conferencePaper")).to.equal("proceedingsTitle");
  });

  it("picks the field a shared prism:number restores per item type", () => {
    expect(numberFieldOf("journalArticle")).to.equal("issue");
    expect(numberFieldOf("conferencePaper")).to.equal("issue");
    expect(numberFieldOf("patent")).to.equal("patentNumber");
    expect(numberFieldOf("report")).to.equal("reportNumber");
    expect(numberFieldOf("case")).to.equal("docketNumber");
    expect(numberFieldOf("bill")).to.equal("billNumber");
    expect(numberFieldOf("standard")).to.equal("number");
    // A type without a number field drops the predicate instead of inventing one.
    expect(numberFieldOf("book")).to.equal(null);
    expect(numberFieldOf("no-such-type")).to.equal(null);
  });

  it("derives base-field names through the core helper", () => {
    expect(fieldForBase("bookSection", "publicationTitle")).to.equal(
      "bookTitle",
    );
    expect(specificFieldsForBase("case", "number")).to.deep.equal([
      "docketNumber",
    ]);
  });

  it("takes firstCreator's primary creator type from the table", () => {
    expect(ZOTERO_PRIMARY_CREATOR_TYPES.patent).to.equal("inventor");
    expect(ZOTERO_PRIMARY_CREATOR_TYPES.hearing).to.equal("contributor");
    expect(ZOTERO_PRIMARY_CREATOR_TYPES.videoRecording).to.equal("creator");
    expect(ZOTERO_PRIMARY_CREATOR_TYPES.journalArticle).to.equal("author");
  });
});

describe("the queries a conversion layer asks", () => {
  it("separates a Zotero field from a name that belongs in extra", () => {
    // A Zotero host's route decision: a real field is written as one, otherwise
    // the value goes to `extra`.
    expect(isZoteroField("bookTitle")).to.equal(true);
    expect(isZoteroField("DOI")).to.equal(true);
    expect(isZoteroField("isbn")).to.equal(false);
    expect(isZoteroField("my-own-key")).to.equal(false);

    // `extra` is a field itself, so a host writing to extra must exclude it.
    expect(isZoteroField("extra")).to.equal(true);
  });

  it("answers per-type ownership and resolves base names", () => {
    expect(isZoteroItemField("bookSection", "bookTitle")).to.equal(true);
    expect(isZoteroItemField("book", "bookTitle")).to.equal(false);

    expect(resolveZoteroField("bookSection", "publicationTitle")).to.equal(
      "bookTitle",
    );
    expect(resolveZoteroField("journalArticle", "publicationTitle")).to.equal(
      "publicationTitle",
    );
    expect(resolveZoteroField("case", "title")).to.equal("caseName");
    expect(resolveZoteroField("book", "publicationTitle")).to.equal(null);
    expect(resolveZoteroField("no-such-type", "title")).to.equal(null);

    expect(itemTypeFieldsOf("bookSection")).to.include("bookTitle");
    expect(itemTypeFieldsOf("no-such-type")).to.deep.equal([]);
  });

  it("spots CSL collisions for extra keys", () => {
    expect(isCslVariable("title")).to.equal(true);
    expect(isCslVariable("bookTitle")).to.equal(false);
    expect(isCslItemType("article-journal")).to.equal(true);
    expect(isCslItemType("journalArticle")).to.equal(false);
    expect(isZoteroItemType("bookSection")).to.equal(true);
  });

  it("exposes the CSL-M schema separately from CSL", () => {
    // CSL-M is a superset: shared names belong to both schemas.
    expect(isCslMItemType("book")).to.equal(true);
    expect(isCslMItemType("video")).to.equal(true);
    expect(isCslMOnlyItemType("video")).to.equal(true);
    expect(isCslMOnlyItemType("book")).to.equal(false);

    expect(isCslMVariable("title")).to.equal(true);
    expect(isCslMVariable("committee")).to.equal(true);
    expect(isCslMOnlyVariable("committee")).to.equal(true);
    expect(isCslMOnlyVariable("title")).to.equal(false);

    // ... but an official-CSL-only platform does not see the CSL-M additions.
    expect(isCslItemType("video")).to.equal(false);
    expect(isCslVariable("committee")).to.equal(false);
    expect(CSL_M_SCHEMA.itemTypes).to.include("legal_commentary");
  });

  it("exposes the CSL model the sets are generated from", () => {
    expect(CSL_SCHEMA.itemTypes).to.include("article-journal");
    expect(CSL_SCHEMA.variables.names).to.include("author");
    expect(CSL_SCHEMA.variables.dates).to.include("issued");
    expect(CSL_SCHEMA.variablesAll).to.include("title");
    expect(CSL_SCHEMA.variablesAll).to.not.include("bookTitle");
  });
});
