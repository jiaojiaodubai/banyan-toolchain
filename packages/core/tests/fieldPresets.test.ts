import { assert } from "chai";
import {
  getFieldPresetMenuLabel,
  hasDeferredFieldValues,
  normalizeFieldPresets,
} from "../src/validation/fieldPresets";
import type { StyleMessageReporter } from "../src/messages";
import { createStyleMessageReporter } from "../src/messages";
import { createIdentitySandboxContext } from "./helpers/sandboxContext";

// The core hands what it notices back as diagnostics instead of printing.
const context = createIdentitySandboxContext();

describe("field preset normalization", function () {
  const normalize = (
    raw: unknown,
    messages: StyleMessageReporter = createStyleMessageReporter(),
  ) => normalizeFieldPresets(raw, context, messages);

  it("normalizes documented entries and their labels", function () {
    const result = normalize([
      {
        id: "classic",
        label: "古籍",
        fields: { type: "classic" },
      },
      {
        id: "plain",
        label: "  Plain label  ",
        visible: () => true,
        fields: { status: "advance online publication" },
      },
    ]);

    assert.deepEqual(
      result?.map((preset) => ({
        id: preset.id,
        label: preset.label,
        fields: preset.fields,
      })),
      [
        {
          id: "classic",
          label: "古籍",
          fields: { type: "classic" },
        },
        {
          id: "plain",
          label: "Plain label",
          fields: { status: "advance online publication" },
        },
      ],
    );
    assert.isFunction(result?.[1].visible);
    assert.isTrue(result![1].visible!({ id: "1" } as never));
  });

  it("rejects the old object-map shape instead of reading its values", function () {
    const reporter = createStyleMessageReporter();
    const result = normalize(
      { entry: { id: "classic", fields: { type: "classic" } } },
      reporter,
    );

    assert.isUndefined(result);
    assert.match(
      reporter.diagnostics[0]?.message ?? "",
      /ITEM_FIELD_PRESETS must be an array/,
    );
  });

  it("falls back to the id for a non-string label", function () {
    const result = normalize([
      { id: "locale-map", label: { "zh-CN": "古籍" }, fields: { type: "x" } },
      { id: "number", label: 42, fields: { type: "x" } },
    ]);

    assert.deepEqual(
      result?.map((preset) => preset.label),
      ["locale-map", "number"],
    );
  });

  it("keeps null values as 'ask the user at apply time'", function () {
    const result = normalize([
      {
        id: "foreign-law",
        label: "外国法",
        fields: { jurisdiction: null, type: "regulation" },
      },
    ]);

    assert.deepEqual(result?.[0].fields, {
      jurisdiction: null,
      type: "regulation",
    });
    assert.isTrue(hasDeferredFieldValues(result![0]));
    assert.equal(getFieldPresetMenuLabel(result![0]), "外国法…");
  });

  it("leaves the menu label alone when every value is fixed", function () {
    const result = normalize([
      { id: "classic", label: "古籍", fields: { type: "classic" } },
    ]);

    assert.isFalse(hasDeferredFieldValues(result![0]));
    assert.equal(getFieldPresetMenuLabel(result![0]), "古籍");
  });

  it("drops unusable entries instead of failing the style", function () {
    const result = normalize([
      { id: "", fields: { type: "classic" } },
      { id: "dup", fields: { type: "classic" } },
      { id: "dup", fields: { type: "other" } },
      { id: "empty-fields", fields: {} },
      { id: "not-an-object-field", fields: "type: classic" },
    ]);

    assert.deepEqual(
      result?.map((preset) => preset.id),
      ["dup"],
    );
  });

  it("rejects values and keys that must not be written", function () {
    const result = normalize([
      {
        id: "mixed",
        fields: {
          type: "classic",
          status: "",
          note: 42,
          extra: "x",
          key: "x",
          dateAdded: "2020-01-01",
        },
      },
    ]);

    assert.deepEqual(result?.[0].fields, { type: "classic" });
  });

  it("advises on creator-type keys and rejects a Zotero type in extra", function () {
    const reporter = createStyleMessageReporter();

    normalize(
      [
        {
          id: "advisory",
          fields: {
            author: "x",
            bookAuthor: "x",
            type: "bookSection",
            status: "draft",
          },
        },
      ],
      reporter,
    );

    const messages = reporter.diagnostics.map((entry) => entry.message);
    assert.lengthOf(messages, 3, messages.join(" | "));
    assert.match(messages[0], /'author' is a CSL name variable/);
    assert.match(
      messages[1],
      /'bookAuthor' is a Zotero creator type \(CSL name variable 'container-author'\)/,
    );
    assert.match(
      messages[2],
      /'type: bookSection' is a Zotero item type name, not a CSL or CSL-M item type/,
    );
    assert.equal(reporter.diagnostics[2]?.severity, "error");
  });

  it("normalizes creator-type spellings in advisories", function () {
    const reporter = createStyleMessageReporter();
    normalize([{ id: "spelling", fields: { "Book Author": "x" } }], reporter);

    assert.lengthOf(reporter.diagnostics, 1);
    assert.match(
      reporter.diagnostics[0].message,
      /'Book Author' is a Zotero creator type \(CSL name variable 'container-author'\)/,
    );
  });

  it("advises on a CSL-M name variable", function () {
    const reporter = createStyleMessageReporter();
    normalize(
      [{ id: "cslm-name", fields: { "alt-translator": "x" } }],
      reporter,
    );

    assert.lengthOf(reporter.diagnostics, 1);
    assert.match(
      reporter.diagnostics[0].message,
      /'alt-translator' is a CSL-M name variable; a preset writes a single value/,
    );
  });

  it("warns rather than errors for a CSL or CSL-M type in extra", function () {
    const cslReporter = createStyleMessageReporter();
    const cslmReporter = createStyleMessageReporter();
    const overlapReporter = createStyleMessageReporter();

    normalize([{ id: "csl", fields: { type: "classic" } }], cslReporter);
    normalize(
      [{ id: "cslm", fields: { type: "legal_commentary" } }],
      cslmReporter,
    );
    // `book` is both a CSL and a Zotero item type: the CSL classification wins,
    // because that is the value citeproc actually reads.
    normalize([{ id: "overlap", fields: { type: "book" } }], overlapReporter);

    const cslTyped = cslReporter.diagnostics;
    const cslmTyped = cslmReporter.diagnostics;
    const overlapTyped = overlapReporter.diagnostics;

    assert.lengthOf(cslTyped, 1);
    assert.equal(cslTyped[0]?.severity, "warning");
    assert.match(
      cslTyped[0]?.message ?? "",
      /'type: classic' is a CSL item type; written to extra, it changes the CSL type citeproc uses for this item/,
    );

    assert.lengthOf(cslmTyped, 1);
    assert.equal(cslmTyped[0]?.severity, "warning");
    assert.match(
      cslmTyped[0]?.message ?? "",
      /'type: legal_commentary' is a CSL-M item type; citeproc-js reads it as a CSL extension/,
    );

    assert.lengthOf(overlapTyped, 1);
    assert.equal(overlapTyped[0]?.severity, "warning");
    assert.match(
      overlapTyped[0]?.message ?? "",
      /'type: book' is a CSL item type; written to extra, it changes the CSL type citeproc uses for this item/,
    );
  });

  it("treats a Zotero type name and an unknown name as errors", function () {
    const zoteroReporter = createStyleMessageReporter();
    const invalidReporter = createStyleMessageReporter();

    normalize(
      [{ id: "zotero", fields: { type: "bookSection" } }],
      zoteroReporter,
    );
    normalize(
      [{ id: "invalid", fields: { type: "not-a-csl-type" } }],
      invalidReporter,
    );

    const zoteroTyped = zoteroReporter.diagnostics;
    const invalidTyped = invalidReporter.diagnostics;

    assert.lengthOf(zoteroTyped, 1);
    assert.equal(zoteroTyped[0]?.severity, "error");
    assert.match(
      zoteroTyped[0]?.message ?? "",
      /'type: bookSection' is a Zotero item type name, not a CSL or CSL-M item type/,
    );

    assert.lengthOf(invalidTyped, 1);
    assert.equal(invalidTyped[0]?.severity, "error");
    assert.match(
      invalidTyped[0]?.message ?? "",
      /'type: not-a-csl-type' is not a CSL or CSL-M item type/,
    );
  });

  it("does not warn for extra keys citeproc or the sandbox reads", function () {
    const reporter = createStyleMessageReporter();

    normalize(
      [
        {
          id: "keys",
          fields: {
            "my-key": "x",
            "document-name": "x",
            "creators-ext": '{"role":"x"}',
            "archive-location": "box 1",
            bookTitle: "x",
            status: "draft",
          },
        },
      ],
      reporter,
    );

    const messages = reporter.diagnostics;
    assert.lengthOf(
      messages,
      1,
      messages.map((entry) => entry.message).join(" | "),
    );
    assert.equal(messages[0]?.severity, "warning");
    assert.match(
      messages[0]?.message ?? "",
      /'my-key' is neither a CSL\/CSL-M variable nor a sandbox extra key; citeproc ignores it when written to extra/,
    );
  });

  it("drops invalid keys so an unusable preset is not indexed", function () {
    const result = normalize([
      {
        id: "invalid-key",
        fields: { "citation.key": "x" },
      },
      {
        id: "mixed-keys",
        fields: { "citation.key": "x", status: "advance" },
      },
    ]);

    assert.deepEqual(
      result?.map((preset) => preset.id),
      ["mixed-keys"],
    );
    assert.deepEqual(result?.[0].fields, { status: "advance" });
  });

  it("treats a throwing visibility predicate as not visible", function () {
    const result = normalize([
      {
        id: "boom",
        fields: { type: "classic" },
        visible: () => {
          throw new Error("boom");
        },
      },
    ]);

    assert.isFalse(result![0].visible!({ id: "2" } as never));
  });

  it("returns undefined when nothing is declared", function () {
    assert.isUndefined(normalize([]));
    assert.isUndefined(normalize(undefined));
  });
});
