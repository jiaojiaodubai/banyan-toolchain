/**
 * Library layer tests: `firstCreator` semantics, base-field aware field access,
 * the Zotero -> Banyan conversion (extra map, creators-ext, tags, aliases) and
 * multilingual resolution.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TestLibrary, ZOTERO_ITEM_URI_KEY } from "../src/library/library";
import { computeFirstCreator } from "../src/library/first-creator";
import { ZOTERO_PRIMARY_CREATOR_TYPES } from "../src/banyan";
import type { ScriptItem } from "../src/banyan";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string): TestLibrary =>
  TestLibrary.fromRdf(
    readFileSync(path.join(here, "../fixtures", name), "utf8"),
  );

const library = load("library-basic.rdf");

const asScriptItem = (value: unknown): ScriptItem => value as ScriptItem;

describe("firstCreator", () => {
  it("one primary creator renders as the surname", () => {
    expect(
      computeFirstCreator("journalArticle", [
        { creatorType: "author", firstName: "伟", lastName: "张" },
      ]),
    ).to.equal("张");
  });

  it("two creators join with andJoiner inside bidi isolation", () => {
    expect(
      computeFirstCreator("journalArticle", [
        { creatorType: "author", firstName: "伟", lastName: "张" },
        { creatorType: "author", firstName: "秀英", lastName: "李" },
      ]),
    ).to.equal("\u2068张 and 李\u2069");
  });

  it("three or more creators use et al.", () => {
    expect(
      computeFirstCreator("conferencePaper", [
        { creatorType: "author", lastName: "赵", firstName: "敏" },
        { creatorType: "author", lastName: "钱", firstName: "国强" },
        { creatorType: "author", lastName: "孙", firstName: "丽" },
      ]),
    ).to.equal("赵 et al.");
  });

  it("falls back through editor/director/contributor groups", () => {
    expect(
      computeFirstCreator("book", [
        { creatorType: "editor", lastName: "王", firstName: "编" },
      ]),
    ).to.equal("王");
  });

  it("uses the item type's primary creator type", () => {
    expect(ZOTERO_PRIMARY_CREATOR_TYPES.patent).to.equal("inventor");
    expect(
      computeFirstCreator("patent", [
        { creatorType: "inventor", lastName: "陈", firstName: "志远" },
      ]),
    ).to.equal("陈");
  });

  it("leaves the value empty when no consulted creator type is present", () => {
    // Zotero's SQL only consults primary/editor/director/contributor; a
    // translator-only item has no firstCreator and a style falls back.
    expect(
      computeFirstCreator("book", [
        { creatorType: "translator", lastName: "Smith", firstName: "John" },
      ]),
    ).to.equal("");
  });

  it("accepts custom and-joiner and et-al strings", () => {
    expect(
      computeFirstCreator(
        "book",
        [
          { creatorType: "author", lastName: "A" },
          { creatorType: "author", lastName: "B" },
        ],
        { andJoiner: "与", etAl: "等" },
      ),
    ).to.equal("\u2068A 与 B\u2069");
    expect(
      computeFirstCreator(
        "book",
        [
          { creatorType: "author", lastName: "A" },
          { creatorType: "author", lastName: "B" },
          { creatorType: "author", lastName: "C" },
        ],
        { etAl: "等" },
      ),
    ).to.equal("A 等");
  });
});

describe("fake Zotero.Item", () => {
  it("computes year from the type's date field", () => {
    expect(library.require("ITEM0001").getField("year")).to.equal("2023");
    const patent = library.require("ITEM0006");
    expect(patent.getField("date")).to.equal("2019-11-05");
    expect(patent.getField("year")).to.equal("2019");
  });

  it("exposes the Zotero API surface the pipeline reads", () => {
    const item = library.require("ITEM0001");
    expect(item.firstCreator).to.equal("\u2068张 and 李\u2069");
    expect(item.isRegularItem()).to.equal(true);
    expect(item.deleted).to.equal(false);
    expect(item.id).to.equal(1);
    expect(item.uri).to.equal("#item_1");
    expect(item.getRelations()).to.deep.equal({});
  });

  it("resolves base fields onto the type's own field", () => {
    const section = library.require("ITEM0003");
    expect(section.getField("bookTitle")).to.equal("文献学进展");
    expect(section.getField("publicationTitle")).to.equal("文献学进展");
    expect(section.getField("no-such-field")).to.equal("");
  });

  it("serializes Zotero Item JSON shapes (single-name creators, tag objects)", () => {
    const json = library.require("ITEM0002").toJSON();
    expect(json.itemType).to.equal("book");
    expect(json.creators).to.deep.equal([
      { creatorType: "author", name: "中国科学院计算技术研究所" },
    ]);
    expect(json.tags).to.deep.equal([]);
    expect(json.uri).to.equal("#item_2");
  });
});

describe("toBanyanItem", () => {
  it("strips host record fields (key/uri/relations) from style-facing items", () => {
    const banyan = library.toBanyanItem(library.require("ITEM0001"));
    expect(banyan.key).to.equal(undefined);
    expect((banyan as Record<string, unknown>).uri).to.equal(undefined);
    expect((banyan as Record<string, unknown>).relations).to.equal(undefined);
    expect(banyan[ZOTERO_ITEM_URI_KEY]).to.equal("#item_1");
    expect(banyan.id).to.equal("1");
    expect(banyan.year).to.equal("2023");
    expect(banyan.firstCreator).to.equal("\u2068张 and 李\u2069");
  });

  it("parses extra into a normalized map and binds creators-ext", () => {
    const banyan = library.toBanyanItem(library.require("ITEM0003"));
    expect(banyan.extra?.["language"]).to.equal("zh-CN");
    const creator = banyan.creators[0];
    expect(creator.role).to.equal("主编");
  });

  it("applies base-field aliases (bookTitle -> publicationTitle)", () => {
    const banyan = library.toBanyanItem(library.require("ITEM0003"));
    expect(banyan.title).to.equal("多语言文献的引用实践");
    expect(banyan.publicationTitle).to.equal("文献学进展");
  });

  it("simplifies tags to plain strings", () => {
    expect(
      library.toBanyanItem(library.require("ITEM0001")).tags,
    ).to.deep.equal(["石墨烯", "量子点"]);
  });

  it("caches converted items", () => {
    const item = library.require("ITEM0001");
    expect(library.toBanyanItem(item)).to.equal(library.toBanyanItem(item));
  });
});

describe("library diagnostics", () => {
  it("reports a malformed creators-ext record without printing", () => {
    const ext = load("creators-ext.rdf");
    const item = ext.require("EXT0003");
    ext.toBanyanItem(item);
    expect(ext.diagnostics).to.have.lengthOf(1);
    expect(ext.diagnostics[0]).to.include({
      severity: "warning",
      source: "items",
      code: "generate-input",
    });
    expect(ext.diagnostics[0].message).to.contain("creators-ext");
  });

  it("stays silent for valid extension records", () => {
    const ext = load("creators-ext.rdf");
    ext.toBanyanItem(ext.require("EXT0001"));
    ext.toBanyanItem(ext.require("EXT0002"));
    expect(ext.diagnostics).to.deep.equal([]);
  });

  it("binds single-name creators-ext records", () => {
    const ext = load("creators-ext.rdf");
    const banyan = ext.toBanyanItem(ext.require("EXT0002"));
    expect(banyan.creators[0]).to.include({ name: "佚名" });
    expect(banyan.creators[0].nationality).to.equal("意大利");
  });
});

describe("multilingual resolution (host capability)", () => {
  it("resolves the whole group without the source item", () => {
    const multi = load("multilingual.rdf");
    const source = multi.toBanyanItem(multi.require("MULTI001"));
    const group = multi.resolveMultilingualItems(asScriptItem(source));
    expect(group.map((item) => item[ZOTERO_ITEM_URI_KEY])).to.deep.equal([
      "#item_2",
      "#item_3",
    ]);
    expect(group.map((item) => item.extra?.["language"])).to.deep.equal([
      "zh-CN",
      "ja",
    ]);
  });

  it("returns empty for items without the relation", () => {
    const multi = load("multilingual.rdf");
    const lone = multi.toBanyanItem(multi.require("MULTI004"));
    expect(multi.resolveMultilingualItems(asScriptItem(lone))).to.deep.equal(
      [],
    );
  });

  it("resolves by the durable z:uri when the id is stale", () => {
    const multi = load("multilingual.rdf");
    const source = multi.toBanyanItem(multi.require("MULTI002"));
    const stale = { ...source, id: 999 } as unknown as ScriptItem;
    const group = multi.resolveMultilingualItems(stale);
    expect(group.map((item) => item[ZOTERO_ITEM_URI_KEY])).to.deep.equal([
      "#item_1",
      "#item_3",
    ]);
  });
});

describe("TestLibrary.empty", () => {
  it("has no items and still answers lookups", () => {
    const empty = TestLibrary.empty();
    expect(empty.size).to.equal(0);
    expect(empty.get("X")).to.equal(undefined);
    expect(empty.diagnostics).to.deep.equal([]);
  });
});

describe("library: Zotero RDF export shape", () => {
  const exported = load("zotero-export.rdf");

  it("keeps regular items only, with contiguous ids", () => {
    // The fixture carries a child attachment, a child note, a standalone note
    // and a collection, like a real export; only regular items become input.
    expect(exported.all.map((item) => [item.id, item.itemType])).to.deep.equal([
      [1, "journalArticle"],
      [2, "book"],
      [3, "conferencePaper"],
      [4, "webpage"],
    ]);
    expect(exported.size).to.equal(4);
  });

  it("resolves items by node id when the export has no z:key", () => {
    const item = exported.require("#item_1");
    expect(item.uri).to.equal("#item_1");
    // Zotero writes no key, so the testkit derives a deterministic one.
    expect(item.key).to.equal("TESTKEY00000001");
    expect(exported.get("#item_2")).to.equal(undefined);
  });

  it("resolves an item whose subject is its URL", () => {
    const webpage = exported.require("https://example.org/webpage");
    expect(webpage.itemType).to.equal("webpage");
    expect(exported.toBanyanItem(webpage).id).to.equal("4");
  });

  it("converts an exported item to the Banyan shape", () => {
    const banyan = exported.toBanyanItem(exported.require("#item_1"));
    expect(banyan.id).to.equal("1");
    expect(banyan[ZOTERO_ITEM_URI_KEY]).to.equal("#item_1");
    expect(banyan.publicationTitle).to.equal("物理学报");
    expect(banyan.volume).to.equal("72");
    expect(banyan.issue).to.equal("6");
    expect(banyan.ISSN).to.equal("1000-3290");
    expect(banyan.DOI).to.equal("10.7498/aps.72.20230101");
    expect(banyan.year).to.equal("2023");
    expect(banyan.firstCreator).to.equal("\u2068张 and 李\u2069");
    expect(banyan.creators).to.have.lengthOf(3);
  });

  it("resolves dc:relation targets against the library", () => {
    expect(
      exported.require("#item_1").getRelations()["dc:relation"],
    ).to.deep.equal(["#item_4"]);
    expect(exported.get("#item_4")?.itemType).to.equal("book");
  });
});
