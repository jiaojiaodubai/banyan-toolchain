/**
 * The simple JSON item database (`src/library/item-database.ts`): direct Banyan
 * item records, ids, multilingual groups, validation and the sandbox
 * `getMultilingualItems()` path.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TestLibrary } from "../src/library/library";
import {
  ITEM_DATABASE_SCHEMA,
  parseItemDatabase,
  requireValidItemDatabase,
  validateItemDatabase,
  type ItemDatabaseIssue,
} from "../src/library/item-database";
import { buildContexts } from "../src/run/contexts";
import { runStyle } from "../src/run/runner";
import type { ScriptItem } from "../src/banyan";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "../fixtures");
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(fixtures, name), "utf8"));
const readText = (name: string): string =>
  readFileSync(path.join(fixtures, name), "utf8");

const basic = readFixture("items-basic.json");
const multilingual = readFixture("items-multilingual.json");
const minimalStyle = readText("styles/numeric-minimal.js");

const errorsOf = (issues: readonly ItemDatabaseIssue[]) =>
  issues.filter((issue) => issue.severity === "error");
const warningsOf = (issues: readonly ItemDatabaseIssue[]) =>
  issues.filter((issue) => issue.severity === "warning");

describe("item database: loading", () => {
  it("loads the generated fixture as direct Banyan items", () => {
    const library = TestLibrary.fromItemDatabase(basic);
    expect(library.size).to.equal(7);
    expect(library.all.map((item) => item.key)).to.deep.equal([
      "ITEM0001",
      "ITEM0002",
      "ITEM0003",
      "ITEM0004",
      "ITEM0005",
      "ITEM0006",
      "ITEM0007",
    ]);
    expect(library.all.map((item) => item.itemType)).to.deep.equal([
      "journalArticle",
      "book",
      "bookSection",
      "bookSection",
      "conferencePaper",
      "patent",
      "report",
    ]);

    const article = library.toBanyanItem(library.require("ITEM0001"));
    expect(article.id).to.equal("ITEM0001");
    expect(article.year).to.equal("2023");
    expect(article.firstCreator).to.equal("\u2068张 and 李\u2069");
    expect(article.publicationTitle).to.equal("物理学报");
    expect(article.tags).to.deep.equal(["石墨烯", "量子点"]);
    expect(article["z:uri"]).to.equal(undefined);

    // The record writes bookTitle; the Banyan item contract also exposes the
    // base alias, and `extra` is a parsed map bound to creators.
    const section = library.toBanyanItem(library.require("ITEM0003"));
    expect(section.bookTitle).to.equal("文献学进展");
    expect(section.publicationTitle).to.equal("文献学进展");
    expect(section.extra?.language).to.equal("zh-CN");
    expect((section.creators[0] as { role?: string }).role).to.equal("主编");
  });

  it("resolves records by id or by numeric position", () => {
    const library = TestLibrary.fromItemDatabase(basic);
    expect(library.require("ITEM0001")).to.equal(library.require(1));
    expect(library.get("ITEM0007")?.itemType).to.equal("report");
    expect(library.get("NOPE")).to.equal(undefined);
    expect(library.get(99)).to.equal(undefined);
  });

  it("defaults ids to the 1-based position and keeps explicit ones", () => {
    const library = TestLibrary.fromItemDatabase({
      items: [
        { itemType: "book", title: "first" },
        { id: "zh", itemType: "book", title: "second" },
      ],
    });
    expect(library.all.map((item) => item.key)).to.deep.equal(["1", "zh"]);
    expect(library.require("zh").itemType).to.equal("book");
  });

  it("honors explicit year, firstCreator and the canonical date", () => {
    const library = TestLibrary.fromItemDatabase({
      items: [
        {
          id: "P",
          itemType: "patent",
          title: "P",
          date: "2019-11-05",
          year: "2001",
          firstCreator: "定制作者",
        },
      ],
    });
    const item = library.toBanyanItem(library.require("P"));
    expect(item.date).to.equal("2019-11-05");
    expect(item.year).to.equal("2001");
    expect(item.firstCreator).to.equal("定制作者");
  });

  it("converts number-valued extra entries to text", () => {
    const library = TestLibrary.fromItemDatabase({
      items: [
        {
          itemType: "book",
          title: "E",
          extra: { "call-number": "QA1", note: ["a", "b"], ranking: 3 },
        },
      ],
    });
    expect(library.toBanyanItem(library.all[0]).extra).to.deep.equal({
      "call-number": "QA1",
      note: ["a", "b"],
      ranking: "3",
    });
  });

  it("turns validation warnings into library diagnostics", () => {
    const library = TestLibrary.fromItemDatabase({
      items: [{ itemType: "book", title: "T", tittle: "typo" }],
    });
    expect(library.diagnostics).to.have.lengthOf(1);
    expect(library.diagnostics[0]?.message).to.contain(
      '"tittle" is not a known Zotero field',
    );
    expect(library.diagnostics[0]?.source).to.equal("items");
  });
});

describe("item database: multilingual groups", () => {
  it("resolves every member of a group by item id", () => {
    const library = TestLibrary.fromItemDatabase(multilingual);
    const asScriptItem = (value: unknown): ScriptItem => value as ScriptItem;
    const titlesOf = (id: string) =>
      library
        .resolveMultilingualItems(
          asScriptItem(library.toBanyanItem(library.require(id))),
        )
        .map((item) => item.title);

    expect(titlesOf("MULTI001")).to.deep.equal([
      "多语言引用实践",
      "多言語引用の実践",
    ]);
    expect(titlesOf("MULTI002")).to.deep.equal([
      "Multilingual citation practice",
      "多言語引用の実践",
    ]);
    expect(titlesOf("MULTI003")).to.have.lengthOf(2);
  });

  it("keeps groups out of the Banyan item shape", () => {
    const library = TestLibrary.fromItemDatabase(multilingual);
    const item = library.toBanyanItem(library.require("MULTI001"));
    expect(item.relations).to.equal(undefined);
    expect(item.key).to.equal(undefined);
    expect(item["z:uri"]).to.equal(undefined);
  });

  it("validates the id contract: one group per id, members must exist", () => {
    const base = {
      items: [
        { id: "A", itemType: "book" },
        { id: "B", itemType: "book" },
      ],
    };
    expect(
      errorsOf(
        validateItemDatabase({ ...base, multilingual: [["A", "B"], ["A"]] }),
      )[0]?.message,
    ).to.match(/already belongs to another multilingual group/);
    expect(
      errorsOf(
        validateItemDatabase({ ...base, multilingual: [["A", "NOPE"]] }),
      )[0]?.message,
    ).to.match(/unknown item id "NOPE"/);
    expect(
      errorsOf(validateItemDatabase({ ...base, multilingual: [["A", "A"]] }))[0]
        ?.message,
    ).to.match(/duplicate id "A" in one multilingual group/);

    const { issues, groups } = parseItemDatabase({
      ...base,
      multilingual: [["A", "B"], ["A"]],
    });
    expect(errorsOf(issues)[0]?.message).to.match(
      /already belongs to another multilingual group/,
    );
    expect(groups).to.deep.equal([["A", "B"]]);
  });

  it("warns and drops a group with fewer than two ids", () => {
    const parsed = parseItemDatabase({
      items: [{ id: "A", itemType: "book" }],
      multilingual: [["A"]],
    });
    expect(errorsOf(parsed.issues)).to.deep.equal([]);
    expect(warningsOf(parsed.issues)[0]?.message).to.match(
      /needs at least two items/,
    );
    expect(parsed.groups).to.deep.equal([]);
  });

  it("serves getMultilingualItems()/getMultilingualItem() in the sandbox", async () => {
    const library = TestLibrary.fromItemDatabase(multilingual);
    const contexts = buildContexts(library, [
      { cites: [{ item: "MULTI001" }] },
    ]);
    const run = await runStyle(
      {
        code: `const INFO = { id: "multi", title: "Multi", description: "", citationType: "intext-citation", creator: [], tags: [], documentation: [], license: "MIT", updated: "" };
async function generate() {
  const item = contexts[0].cites[0].item;
  const siblings = await getMultilingualItems(item);
  const japanese = await getMultilingualItem(item, "ja");
  return {
    citations: [
      {
        id: contexts[0].id,
        content: siblings.map((entry) => entry.title).join(" | ") + " || " + japanese.title,
      },
    ],
    bibliography: [],
  };
}`,
        library,
        styleDir: fixtures,
      },
      contexts,
    );
    const text = run.result.citations[0]?.content.text ?? "";
    expect(text.split(" || ")[1]).to.equal("多言語引用の実践");
    expect(text.split(" || ")[0]?.split(" | ")).to.have.lengthOf(2);
  });
});

describe("item database: validation", () => {
  it("accepts the generated fixtures", () => {
    expect(errorsOf(validateItemDatabase(basic))).to.deep.equal([]);
    expect(errorsOf(validateItemDatabase(multilingual))).to.deep.equal([]);
  });

  it("classifies extra.type and warns for keys citeproc cannot read", () => {
    const issues = validateItemDatabase({
      items: [
        { itemType: "book", extra: { type: "classic" } },
        { itemType: "book", extra: { type: "legal_commentary" } },
        { itemType: "book", extra: { type: "bookSection" } },
        {
          itemType: "book",
          creators: [{ creatorType: "author", lastName: "A" }],
          extra: {
            "creators-ext":
              '{"creatorType":"author","lastName":"A","role":"著"}',
          },
        },
        { itemType: "book", extra: { "my-key": "x" } },
        { itemType: "book", extra: { bookTitle: "x" } },
        {
          itemType: "book",
          extra: { note: "n", "archive-location": "box 1" },
        },
      ],
    });
    const at = (path: string) => issues.filter((issue) => issue.path === path);

    const csl = at("items[0].extra.type");
    expect(csl).to.have.lengthOf(1);
    expect(csl[0]?.severity).to.equal("warning");
    expect(csl[0]?.message).to.match(/is a CSL item type/);

    const cslm = at("items[1].extra.type");
    expect(cslm).to.have.lengthOf(1);
    expect(cslm[0]?.severity).to.equal("warning");
    expect(cslm[0]?.message).to.match(/is a CSL-M item type/);

    const invalid = at("items[2].extra.type");
    expect(invalid).to.have.lengthOf(1);
    expect(invalid[0]?.severity).to.equal("error");
    expect(invalid[0]?.message).to.match(
      /not a CSL or CSL-M item type; citeproc will treat the item as untyped/,
    );

    // The sandbox consumes `creators-ext`, and CSL variables are read by
    // citeproc, so neither gets an "ignored extra" warning.
    expect(at("items[3].extra.creators-ext")).to.deep.equal([]);
    expect(at("items[6].extra.note")).to.deep.equal([]);
    expect(at("items[6].extra.archive-location")).to.deep.equal([]);

    const unknown = at("items[4].extra.my-key");
    expect(unknown).to.have.lengthOf(1);
    expect(unknown[0]?.severity).to.equal("warning");
    expect(unknown[0]?.message).to.match(
      /not a CSL\/CSL-M variable or a Banyan key/,
    );

    const zoteroField = at("items[5].extra.bookTitle");
    expect(zoteroField).to.have.lengthOf(1);
    expect(zoteroField[0]?.severity).to.equal("warning");
    expect(zoteroField[0]?.message).to.match(
      /is a Zotero field, not a CSL variable/,
    );
  });

  it("keeps the committed JSON Schema in step with the constant", () => {
    const schema = JSON.parse(
      readText("../schema/item-database.schema.json"),
    ) as unknown;
    expect(schema).to.deep.equal(ITEM_DATABASE_SCHEMA);
  });

  const cases: Array<[string, unknown, RegExp, string]> = [
    ["not a database", null, /must be an array of records/, ""],
    [
      "items not an array",
      { items: "nope" },
      /needs an `items` array/,
      "items",
    ],
    [
      "unknown database key",
      { items: [], extra: true },
      /unknown database key "extra"/,
      "extra",
    ],
    [
      "missing itemType",
      { items: [{}] },
      /itemType must be a non-empty string/,
      "items[0].itemType",
    ],
    [
      "non-regular item type",
      { items: [{ itemType: "note" }] },
      /not a regular item/,
      "items[0].itemType",
    ],
    [
      "duplicate item id",
      {
        items: [
          { id: "A", itemType: "book" },
          { id: "A", itemType: "book" },
        ],
      },
      /duplicate item id "A"/,
      "items[1].id",
    ],
    [
      "id is not a string",
      { items: [{ id: 3, itemType: "book" }] },
      /id must be a non-empty string/,
      "items[0].id",
    ],
    [
      "record uses key",
      { items: [{ itemType: "book", key: "K" }] },
      /use `id`/,
      "items[0].key",
    ],
    [
      "record uses uri",
      { items: [{ itemType: "book", uri: "#x" }] },
      /use `id`/,
      "items[0].uri",
    ],
    [
      "record uses relations",
      { items: [{ itemType: "book", relations: {} }] },
      /database level/,
      "items[0].relations",
    ],
    [
      "record uses multilingual",
      { items: [{ itemType: "book", multilingual: ["A"] }] },
      /database level/,
      "items[0].multilingual",
    ],
    [
      "creator without a name",
      { items: [{ itemType: "book", creators: [{ creatorType: "author" }] }] },
      /needs `name` or a non-empty `lastName`/,
      "items[0].creators[0]",
    ],
    [
      "creator with both name forms",
      {
        items: [
          {
            itemType: "book",
            creators: [{ creatorType: "author", name: "N", lastName: "L" }],
          },
        ],
      },
      /not both/,
      "items[0].creators[0]",
    ],
    [
      "field with a structured value",
      { items: [{ itemType: "book", title: {} }] },
      /field values must be strings or numbers/,
      "items[0].title",
    ],
    [
      "extra is not an object",
      { items: [{ itemType: "book", extra: "language: en" }] },
      /extra must be an object/,
      "items[0].extra",
    ],
    [
      "extra value is an object",
      { items: [{ itemType: "book", extra: { note: {} } }] },
      /extra values must be strings, numbers or arrays/,
      "items[0].extra.note",
    ],
    [
      "tag is not a string",
      { items: [{ itemType: "book", tags: [1] }] },
      /a tag must be a string/,
      "items[0].tags[0]",
    ],
    [
      "multilingual is not an array",
      { items: [{ itemType: "book" }], multilingual: "A" },
      /multilingual must be an array of id groups/,
      "multilingual",
    ],
    [
      "group member is not a string",
      { items: [{ id: "A", itemType: "book" }], multilingual: [[1]] },
      /must be a non-empty id/,
      "multilingual[0][0]",
    ],
  ];

  for (const [label, input, pattern, path] of cases) {
    it(`rejects: ${label}`, () => {
      const { items, issues } = parseItemDatabase(input);
      const errors = errorsOf(issues);
      expect(
        errors.length,
        `${label}: ${JSON.stringify(issues)}`,
      ).to.be.greaterThan(0);
      expect(errors[0]?.message).to.match(pattern);
      if (path) expect(errors[0]?.path).to.equal(path);
      expect(items.length).to.be.lessThan(2);
    });
  }

  it("warns but keeps records it can still use", () => {
    const cases: Array<[string, unknown, RegExp]> = [
      [
        "unknown field",
        { items: [{ itemType: "book", tittle: "typo" }] },
        /not a known Zotero field/,
      ],
      [
        "field of another type",
        { items: [{ itemType: "book", reporter: "Reporter" }] },
        /is not a field of book/,
      ],
      [
        "excluded field",
        { items: [{ itemType: "book", abstractNote: "Abstract" }] },
        /dropped when the item is handed to a style/,
      ],
      [
        "unknown item type",
        { items: [{ itemType: "hologram", title: "T" }] },
        /unknown Zotero item type "hologram"/,
      ],
      [
        "unreadable creators-ext",
        {
          items: [
            {
              itemType: "book",
              title: "T",
              creators: [{ creatorType: "author", lastName: "A" }],
              extra: { "creators-ext": "{not json" },
            },
          ],
        },
        /creators-ext/,
      ],
    ];
    for (const [label, input, pattern] of cases) {
      const { items, issues } = parseItemDatabase(input);
      expect(errorsOf(issues), label).to.deep.equal([]);
      expect(items, label).to.have.lengthOf(1);
      expect(warningsOf(issues)[0]?.message, label).to.match(pattern);
    }
  });

  it("refuses to build a library from a database with errors", () => {
    expect(() =>
      TestLibrary.fromItemDatabase({ items: [{ itemType: "note" }] }),
    ).to.throw(/Invalid item database:[\s\S]*not a regular item/);
    expect(() => requireValidItemDatabase({ items: [{}] })).to.throw(
      /itemType must be a non-empty string/,
    );
  });
});
