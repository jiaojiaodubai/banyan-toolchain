/**
 * RDF layer tests: parsing the generated and hand-authored fixtures, the
 * namespace/`z:`/extension rules, and round-trip fidelity.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractItems, parseGraph, parseZoteroRdf } from "../src/rdf/parse";
import { serializeZoteroRdf } from "../src/rdf/serialize";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(path.join(here, "../fixtures", name), "utf8");

const basic = () => parseZoteroRdf(fixture("library-basic.rdf"));

describe("rdf parse: generated fixtures", () => {
  it("extracts every item in document order", () => {
    const items = basic();
    expect(items.map((item) => item.itemType)).to.deep.equal([
      "journalArticle",
      "book",
      "bookSection",
      "bookSection",
      "conferencePaper",
      "patent",
      "report",
    ]);
    expect(items.map((item) => item.key)).to.deep.equal([
      "ITEM0001",
      "ITEM0002",
      "ITEM0003",
      "ITEM0004",
      "ITEM0005",
      "ITEM0006",
      "ITEM0007",
    ]);
  });

  it("disambiguates repeated dc:identifier predicates by value prefix", () => {
    const [article] = basic();
    expect(article.fields.ISSN).to.equal("1000-3290");
    expect(article.fields.DOI).to.equal("10.7498/aps.72.20230101");
    expect(article.fields.publicationTitle).to.equal("物理学报");
    expect(article.fields.journalAbbreviation).to.equal("Acta Physica Sinica");
    expect(article.fields.volume).to.equal("72");
    expect(article.fields.issue).to.equal("6");
  });

  it("reads container, series, publisher and type fields", () => {
    const items = basic();
    const book = items[1];
    expect(book.fields.publisher).to.equal("高等教育出版社");
    expect(book.fields.place).to.equal("北京");
    expect(book.fields.series).to.equal("信息科学技术学术丛书");
    expect(book.fields.seriesNumber).to.equal("7-101");
    expect(book.fields.ISBN).to.equal("978-7-04-055123-4");

    const conference = items[4];
    expect(conference.fields.conferenceName).to.equal(
      "第十二届中国数字图书馆建设与发展研讨会",
    );
    expect(conference.fields.proceedingsTitle).to.equal("会议论文集");
    expect(conference.fields.issue).to.equal("C1");

    const patent = items[5];
    expect(patent.fields.patentNumber).to.equal("ZL201910123456.7");
    expect(patent.fields.issueDate).to.equal("2019-11-05");

    const report = items[6];
    expect(report.fields.institution).to.equal("中国科学院文献情报中心");
    expect(report.fields.reportType).to.equal("年度报告");
    expect(report.fields.reportNumber).to.equal("REP-2025-001");
    expect(report.fields.callNumber).to.equal("G322.5");
  });

  it("restores single-name creators as { name } and paired creators as names", () => {
    const items = basic();
    expect(items[1].creators).to.deep.equal([
      { creatorType: "author", name: "中国科学院计算技术研究所" },
    ]);
    expect(items[0].creators).to.deep.equal([
      { creatorType: "author", firstName: "伟", lastName: "张" },
      { creatorType: "author", firstName: "秀英", lastName: "李" },
    ]);
  });

  it("parses the z:relation/z:predicate extension", () => {
    const items = basic();
    expect(items[2].relations["banyan:multilingual"]).to.deep.equal([
      "#item_4",
    ]);
    expect(items[3].relations["banyan:multilingual"]).to.deep.equal([
      "#item_3",
    ]);
  });

  it("keeps the z:<field> fallback losslessly", () => {
    const items = basic();
    expect(items[0].fields.language).to.equal("zh-CN");
    expect(items[2].fields.bookTitle).to.equal("文献学进展");
    expect(items[5].fields.assignee).to.equal("某科技研究院");
    expect(items[5].fields.applicationNumber).to.equal("CN201910123456.7");
  });

  it("collects manual and automatic tags", () => {
    expect(basic()[0].tags).to.deep.equal(["石墨烯", "量子点"]);
  });
});

describe("rdf parse: hand-authored shapes", () => {
  it("normalizes alias prefixes and rdf:parseType=Resource", () => {
    const [item] = parseZoteroRdf(fixture("aliases.rdf"));
    expect(item.key).to.equal("ALIAS001");
    expect(item.itemType).to.equal("book");
    expect(item.fields.title).to.equal("Alias prefixes still parse");
    expect(item.fields.publisher).to.equal("Alias Press");
    expect(item.creators).to.deep.equal([
      { creatorType: "author", name: "Anonymous" },
    ]);
  });

  it("resolves section -> container -> series nesting", () => {
    const [, article] = parseZoteroRdf(fixture("aliases.rdf"));
    expect(article.fields.section).to.equal("Part One");
    expect(article.fields.publicationTitle).to.equal("Journal of Nesting");
    expect(article.fields.series).to.equal("Nesting Series");
  });

  it("does not mistake a property element for a class", () => {
    const graph = parseGraph(fixture("aliases.rdf"));
    const publisherType = [...graph.nodeTypes.values()].filter(
      (type) => type === "dc:publisher",
    );
    expect(publisherType).to.deep.equal([]);
  });
});

describe("rdf parse: Zotero export shape", () => {
  const exported = () => parseZoteroRdf(fixture("zotero-export.rdf"));

  it("reads typed node elements, containers and creators as exported", () => {
    const items = exported();
    // The child note has no z:itemType (Zotero only writes one for items), so
    // it and the collection are not records; the child attachment and the
    // standalone note are.
    expect(items.map((item) => item.itemType)).to.deep.equal([
      "journalArticle",
      "attachment",
      "book",
      "conferencePaper",
      "note",
      "webpage",
    ]);
    expect(items.map((item) => item.key)).to.deep.equal([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);

    const [article] = items;
    expect(article.fields).to.include({
      title: "石墨烯量子点的可控合成及其发光性质研究",
      date: "2023-06-15",
      pages: "1023-1031",
      publicationTitle: "物理学报",
      journalAbbreviation: "Acta Physica Sinica",
      volume: "72",
      issue: "6",
      ISSN: "1000-3290",
      DOI: "10.7498/aps.72.20230101",
      url: "https://example.org/articles/graphene-2023",
      callNumber: "QC176.8",
      language: "zh-CN",
      shortTitle: "石墨烯量子点",
      libraryCatalog: "CNKI",
    });
    // `z:displayTitle` is record metadata, never a style-facing field.
    expect(article.fields.displayTitle).to.equal(undefined);
    expect(article.creators).to.deep.equal([
      { creatorType: "author", firstName: "伟", lastName: "张" },
      { creatorType: "author", firstName: "秀英", lastName: "李" },
      { creatorType: "editor", firstName: "编", lastName: "王" },
    ]);
    expect(article.tags).to.deep.equal(["highlights", "石墨烯"]);
    expect(article.relations["dc:relation"]).to.deep.equal(["#item_4"]);
  });

  it("ignores attachment metadata and note/collection resources", () => {
    const [, attachment] = exported();
    expect(attachment.fields.title).to.equal("Full Text PDF");
    expect(attachment.fields.url).to.equal(
      "https://example.org/files/graphene.pdf",
    );
    // `dcterms:dateSubmitted` is the only date an attachment carries.
    expect(attachment.fields.accessDate).to.equal("2023-06-16 10:00:00");
    // `z:path` / `z:linkMode` are file metadata; `link:type` is a mime type.
    expect(attachment.fields.linkMode).to.equal(undefined);
    expect(attachment.fields.path).to.equal(undefined);
    expect(attachment.fields.mimeType).to.equal(undefined);
  });

  it("reads publisher, place and conference blank nodes", () => {
    const items = exported();
    const book = items[2];
    expect(book.fields.publisher).to.equal("科学出版社");
    expect(book.fields.place).to.equal("北京");
    expect(book.creators).to.deep.equal([
      { creatorType: "editor", firstName: "编", lastName: "陈" },
    ]);

    const conference = items[3];
    expect(conference.fields.proceedingsTitle).to.equal("会议论文集");
    expect(conference.fields.issue).to.equal("C1");
    expect(conference.fields.conferenceName).to.equal(
      "第十二届中国数字图书馆建设与发展研讨会",
    );
  });

  it("keeps the URL Zotero uses as an item's subject", () => {
    const webpage = exported().at(-1);
    expect(webpage?.node).to.equal("https://example.org/webpage");
    expect(webpage?.fields.title).to.equal("Example page");
    expect(webpage?.fields.websiteTitle).to.equal("Example site");
    expect(webpage?.fields.url).to.equal("https://example.org/webpage");
    expect(webpage?.creators).to.deep.equal([
      { creatorType: "author", firstName: "Jane", lastName: "Doe" },
    ]);
  });
});

describe("rdf round trip", () => {
  /** Compare records ignoring the node id the document chose. */
  const shape = (items: ReturnType<typeof basic>) =>
    items.map(({ node: _node, ...rest }) => ({
      ...rest,
      fields: Object.fromEntries(
        Object.entries(rest.fields).sort(([a], [b]) => a.localeCompare(b)),
      ),
    }));

  for (const name of [
    "library-basic.rdf",
    "multilingual.rdf",
    "creators-ext.rdf",
    "zotero-export.rdf",
  ]) {
    it(`parse -> serialize -> parse is field-identical (${name})`, () => {
      const first = parseZoteroRdf(fixture(name));
      const second = extractItems(parseGraph(serializeZoteroRdf(first)));
      expect(shape(second)).to.deep.equal(shape(first));
    });
  }

  it("preserves exported node ids, so relations keep their targets", () => {
    const first = parseZoteroRdf(fixture("zotero-export.rdf"));
    const xml = serializeZoteroRdf(first);
    expect(xml).to.contain('<dc:relation rdf:resource="#item_4"/>');
    const second = parseZoteroRdf(xml);
    expect(second.map((item) => item.node)).to.deep.equal([
      "#item_1",
      "#item_2",
      "#item_4",
      "#item_5",
      "#item_6",
      "https://example.org/webpage",
    ]);
  });

  it("writes the Banyan extensions (z:key, z:relation, z:predicate)", () => {
    const xml = serializeZoteroRdf(basic());
    expect(xml).to.contain("<z:key>ITEM0001</z:key>");
    expect(xml).to.contain("<z:predicate>banyan:multilingual</z:predicate>");
    expect(xml).to.contain('<z:object rdf:resource="#item_4"/>');
  });

  it("writes unmapped fields through z:<field>", () => {
    const xml = serializeZoteroRdf([
      {
        itemType: "book",
        key: "K1",
        fields: { title: "T", bookTitle: "Parent", language: "de" },
        creators: [],
      },
    ]);
    expect(xml).to.contain("<z:bookTitle>Parent</z:bookTitle>");
    expect(xml).to.contain("<z:language>de</z:language>");
  });

  it("falls container fields back onto the subject without a container", () => {
    const xml = serializeZoteroRdf([
      {
        itemType: "patent",
        key: "K1",
        fields: { title: "T", patentNumber: "ZL1", volume: "3" },
        creators: [],
      },
    ]);
    expect(xml).to.contain("<prism:number>ZL1</prism:number>");
    expect(xml).to.contain("<prism:volume>3</prism:volume>");
    expect(xml).not.to.contain("dcterms:isPartOf");
  });
});
