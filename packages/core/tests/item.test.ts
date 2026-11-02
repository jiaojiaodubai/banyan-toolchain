import { assert } from "chai";
import type { Item } from "../src/types/item";
import {
  assignBaseFieldAliases,
  getItemDisplayLabel,
  stripExcludedFields,
} from "../src/items/fields";
import { normalizeExtraKey, toTitleCaseExtraKey } from "../src/items/extra";

describe("item utils", function () {
  it("accepts a plain item literal, so the published Item type is satisfiable", function () {
    // Compile-time fixture: no cast, no `as unknown as Item`. The index
    // signature is `any`, so `id`/`creators` coexist with text fields.
    const item: Item = {
      itemType: "book",
      id: "1",
      creators: [
        { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
      ],
      title: "Notes",
      "z:uri": "http://zotero.org/users/1/items/ABCD1234",
    };

    assert.equal(item.title, "Notes");
    assert.equal(item.id, "1");
  });

  describe("stripExcludedFields", function () {
    it("drops record metadata but keeps a field that only looks like it", function () {
      // Exactly what `Zotero.Item.toJSON()` returns for a Software item: the
      // record version lives under `version`, while the item type's "Version"
      // field is `versionNumber` (see `xpcom/data/item.js`).
      const json: Record<string, unknown> = {
        key: "ABCD1234",
        version: 173,
        itemType: "computerProgram",
        versionNumber: "1.2.3",
        company: "ACME",
        abstractNote: "An abstract",
        dateAdded: "2024-01-01 00:00:00",
        system: "Web",
      };

      stripExcludedFields(json);
      assignBaseFieldAliases("computerProgram", json);

      assert.deepEqual(json, {
        key: "ABCD1234",
        itemType: "computerProgram",
        versionNumber: "1.2.3",
        company: "ACME",
        system: "Web",
        publisher: "ACME",
      });
    });
  });

  describe("normalizeExtraKey", function () {
    it("keeps simple lowercase keys unchanged", function () {
      assert.equal(normalizeExtraKey("size"), "size");
      assert.equal(normalizeExtraKey("date2"), "date2");
      assert.equal(normalizeExtraKey("non-ad-year"), "non-ad-year");
      assert.equal(normalizeExtraKey("article-number"), "article-number");
    });

    it("normalizes spaces, underscores and edge separators", function () {
      assert.equal(normalizeExtraKey("My Key"), "my-key");
      assert.equal(normalizeExtraKey("my_key"), "my-key");
      assert.equal(
        normalizeExtraKey("  Leading  Trailing  "),
        "leading-trailing",
      );
      assert.equal(normalizeExtraKey("__pad__"), "pad");
    });

    it("normalizes camelCase / PascalCase", function () {
      assert.equal(normalizeExtraKey("authorID"), "author-id");
      assert.equal(normalizeExtraKey("AuthorID"), "author-id");
      assert.equal(normalizeExtraKey("getHTTPResponse"), "get-http-response");
    });

    it("handles acronyms without mangling the following word", function () {
      assert.equal(normalizeExtraKey("CNKICite"), "cnki-cite");
      assert.equal(normalizeExtraKey("XMLParser"), "xml-parser");
      assert.equal(normalizeExtraKey("HTTPRequest"), "http-request");
    });

    it("handles all-uppercase and space-separated forms", function () {
      assert.equal(normalizeExtraKey("CNKI CITE"), "cnki-cite");
      assert.equal(normalizeExtraKey("CNKI cite"), "cnki-cite");
      assert.equal(normalizeExtraKey("CNKI-Cite"), "cnki-cite");
      assert.equal(normalizeExtraKey("CNKI_CITE"), "cnki-cite");
    });

    it("keeps digits attached to letters", function () {
      assert.equal(normalizeExtraKey("Date2"), "date2");
      assert.equal(normalizeExtraKey("issue2"), "issue2");
      assert.equal(normalizeExtraKey("AuthorID_2"), "author-id-2");
    });

    it("is idempotent", function () {
      const sample = "AuthorID_2";
      assert.equal(
        normalizeExtraKey(normalizeExtraKey(sample)),
        normalizeExtraKey(sample),
      );
    });

    it("coerces non-string values", function () {
      assert.equal(normalizeExtraKey(42), "42");
      assert.equal(normalizeExtraKey(true), "true");
      assert.equal(normalizeExtraKey(null), "");
      assert.equal(normalizeExtraKey(undefined), "");
      assert.equal(normalizeExtraKey({}), "");
    });
  });

  describe("toTitleCaseExtraKey", function () {
    it("capitalizes simple keys", function () {
      assert.equal(toTitleCaseExtraKey("type"), "Type");
      assert.equal(toTitleCaseExtraKey("genre"), "Genre");
      assert.equal(toTitleCaseExtraKey("status"), "Status");
      assert.equal(toTitleCaseExtraKey("date2"), "Date2");
    });

    it("converts kebab / snake / space forms to title case", function () {
      assert.equal(toTitleCaseExtraKey("citation-key"), "Citation Key");
      assert.equal(toTitleCaseExtraKey("my_key"), "My Key");
      assert.equal(
        toTitleCaseExtraKey("  leading  trailing  "),
        "Leading Trailing",
      );
    });

    it("splits camelCase / PascalCase", function () {
      assert.equal(toTitleCaseExtraKey("authorID"), "Author ID");
      assert.equal(toTitleCaseExtraKey("AuthorID"), "Author ID");
      assert.equal(toTitleCaseExtraKey("getHTTPResponse"), "Get HTTP Response");
    });

    it("preserves existing acronyms", function () {
      assert.equal(toTitleCaseExtraKey("DOI"), "DOI");
      // "arXiv": the internal "rX" boundary must not be split into "Ar Xiv"
      assert.equal(toTitleCaseExtraKey("arXiv"), "ArXiv");
      assert.equal(toTitleCaseExtraKey("CNKICite"), "CNKI Cite");
    });

    it("is idempotent", function () {
      const sample = "authorID_2";
      assert.equal(
        toTitleCaseExtraKey(toTitleCaseExtraKey(sample)),
        toTitleCaseExtraKey(sample),
      );
    });
  });

  describe("getItemDisplayLabel", function () {
    it("prefers first creator last name with date", function () {
      const item = {
        creators: [
          { creatorType: "author", firstName: "Jane", lastName: "Doe" },
        ],
        date: "2024",
        title: "Example Title",
      } as unknown as Item;

      assert.equal(getItemDisplayLabel(item), "Doe, 2024");
    });

    it("uses single-name creator with date", function () {
      const item = {
        creators: [{ creatorType: "author", name: "ACME Corp" }],
        date: "2023",
      } as unknown as Item;

      assert.equal(getItemDisplayLabel(item), "ACME Corp, 2023");
    });

    it("falls back to title when no creator or date", function () {
      const item = { title: "Example Title" } as unknown as Item;

      assert.equal(getItemDisplayLabel(item), "Example Title");
    });

    it("shows creator when date is missing", function () {
      const item = {
        creators: [
          { creatorType: "author", firstName: "Jane", lastName: "Doe" },
        ],
        title: "Example Title",
      } as unknown as Item;

      assert.equal(getItemDisplayLabel(item), "Doe");
    });

    it("falls back to Untitled for empty item", function () {
      assert.equal(getItemDisplayLabel({} as unknown as Item), "Untitled");
    });
  });

  describe("assignBaseFieldAliases", function () {
    it("fills statute title/date/number aliases from the schema tables", function () {
      const item: Record<string, unknown> = {
        itemType: "statute",
        nameOfAct: "Example Act",
        dateEnacted: "2024-05-01",
        publicLawNumber: "PL-42",
      };

      assignBaseFieldAliases("statute", item);

      assert.equal(item.title, "Example Act");
      assert.equal(item.date, "2024-05-01");
      assert.equal(item.number, "PL-42");
      assert.equal(item.nameOfAct, "Example Act");
      assert.equal(item.dateEnacted, "2024-05-01");
      assert.equal(item.publicLawNumber, "PL-42");
    });

    it("does not overwrite an existing base-field value", function () {
      const item: Record<string, unknown> = {
        itemType: "statute",
        title: "Normalized Title",
        nameOfAct: "Specific Title",
      };

      assignBaseFieldAliases("statute", item);

      assert.equal(item.title, "Normalized Title");
    });

    it("aliases what the schema maps for that item type, and nothing else", function () {
      const bookSection: Record<string, unknown> = {
        itemType: "bookSection",
        bookTitle: "Container Title",
      };
      const book: Record<string, unknown> = {
        itemType: "book",
        bookTitle: "Not a book field",
      };

      assignBaseFieldAliases("bookSection", bookSection);
      assignBaseFieldAliases("book", book);

      // The schema maps `bookTitle` to the container title for book sections...
      assert.equal(bookSection.publicationTitle, "Container Title");
      // ...and does not define it for books, so nothing is invented there.
      assert.equal(book.publicationTitle, undefined);
    });

    it("leaves non-field metadata keys such as key untouched", function () {
      const item: Record<string, unknown> = {
        itemType: "statute",
        key: "ABCD1234",
        nameOfAct: "Example Act",
      };

      assignBaseFieldAliases("statute", item);

      assert.equal(item.title, "Example Act");
      assert.equal(item.key, "ABCD1234");
    });
  });
});
