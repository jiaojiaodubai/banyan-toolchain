import { assert } from "chai";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  ITEM_TYPES_OUTPUT,
  readZoteroSchema,
  renderItemTypes,
  renderSchemaTables,
  renderZoteroModel,
  renderZoteroSchemaJson,
  SCHEMA_JSON_OUTPUT,
  SCHEMA_MODEL_OUTPUT,
  SCHEMA_TABLES_OUTPUT,
  type ZoteroSchemaJson,
} from "../scripts/genZoteroSchema";
import {
  CSL_JSON_OUTPUT,
  CSL_MODEL_OUTPUT,
  CSL_SCHEMA_OUTPUT,
  cslVariables,
  renderCslModel,
  renderCslSchema,
  renderCslSchemaJson,
  TYPES_PATH,
  VARIABLES_PATH,
  type CslSchemaJson,
} from "../scripts/genCslSchema";
import {
  formatGenerated,
  readRepoFile,
  repoRoot,
} from "../scripts/schemaSource";
import {
  ZOTERO_BASE_FIELD_ALIASES,
  ZOTERO_CREATOR_TYPE_CSL_NAMES,
  ZOTERO_CREATOR_TYPES,
  ZOTERO_FIELDS,
  ZOTERO_ITEM_TYPE_FIELDS,
  ZOTERO_ITEM_TYPES,
  ZOTERO_PRIMARY_CREATOR_TYPES,
  ZOTERO_SCHEMA_VERSION,
} from "../src/schema/zoteroSchema";
import { CSL_SCHEMA, ZOTERO_SCHEMA } from "../src/schema";
import {
  isCslItemType,
  isCslVariable,
  isZoteroCreatorType,
  isZoteroField,
  isZoteroItemField,
  isZoteroItemType,
  itemTypeFieldsOf,
  resolveZoteroField,
} from "../src/schema/queries";
import { fieldForBase, specificFieldsForBase } from "../src/items/fields";
import {
  CSL_ITEM_TYPES,
  CSL_NAME_VARIABLES,
  CSL_VARIABLES,
} from "../src/schema/cslSchema";

/**
 * The schema-backed artifacts are committed, so they stay true only while the
 * generator is their only writer: these tests re-render them from the installed
 * `zotero-schema` and compare. A schema bump (`pnpm update zotero-schema`) that
 * changes the model therefore fails here until `pnpm gen:schema` runs.
 */
describe("generated Zotero schema artifacts", function () {
  async function committed(relativePath: string): Promise<string> {
    return readFile(path.join(repoRoot(), relativePath), "utf8");
  }

  it("keeps the author-facing item types in step with the schema", async function () {
    const schema = await readZoteroSchema();

    assert.equal(
      await committed(ITEM_TYPES_OUTPUT),
      await formatGenerated(ITEM_TYPES_OUTPUT, renderItemTypes(schema)),
    );
  });

  it("keeps the schema tables in step with the schema", async function () {
    const schema = await readZoteroSchema();

    assert.equal(
      await committed(SCHEMA_TABLES_OUTPUT),
      await formatGenerated(SCHEMA_TABLES_OUTPUT, renderSchemaTables(schema)),
    );
  });

  it("derives its tables from the schema, not from a hand-kept list", async function () {
    const schema = await readZoteroSchema();
    const schemaItemTypes = new Set(
      (schema.itemTypes ?? [])
        .map((typeDef) => typeDef.itemType)
        .filter((itemType): itemType is string => typeof itemType === "string"),
    );

    for (const itemType of ZOTERO_ITEM_TYPES) {
      assert.isTrue(
        schemaItemTypes.has(itemType),
        `${itemType} is not in the schema`,
      );
    }
    for (const creatorType of ZOTERO_CREATOR_TYPES) {
      const declared = (schema.itemTypes ?? []).some((typeDef) =>
        (typeDef.creatorTypes ?? []).some(
          (entry) => entry.creatorType === creatorType,
        ),
      );
      assert.isTrue(declared, `${creatorType} is not in the schema`);
    }
  });

  it("leaves out the item types a style cannot cite", function () {
    assert.isFalse(ZOTERO_ITEM_TYPES.has("note"));
    assert.isFalse(ZOTERO_ITEM_TYPES.has("attachment"));
    assert.isFalse(ZOTERO_ITEM_TYPES.has("annotation"));
    assert.isTrue(ZOTERO_ITEM_TYPES.has("bookSection"));
  });

  it("carries the base-field aliases and CSL name mapping the core reads", function () {
    assert.equal(ZOTERO_BASE_FIELD_ALIASES.statute?.nameOfAct, "title");
    assert.equal(
      ZOTERO_BASE_FIELD_ALIASES.bookSection?.bookTitle,
      "publicationTitle",
    );
    assert.isUndefined(ZOTERO_BASE_FIELD_ALIASES.book?.bookTitle);
    assert.isTrue(ZOTERO_CREATOR_TYPES.has("bookAuthor"));
    assert.equal(ZOTERO_CREATOR_TYPE_CSL_NAMES.bookAuthor, "container-author");
  });

  it("keeps the CSL vocabulary in step with the CSL schema", async function () {
    const source = {
      variables: await readRepoFile(VARIABLES_PATH),
      types: await readRepoFile(TYPES_PATH),
    };

    assert.equal(
      await committed(CSL_SCHEMA_OUTPUT),
      await formatGenerated(CSL_SCHEMA_OUTPUT, renderCslSchema(source)),
    );
  });

  it("knows the CSL variables and types the core checks against", function () {
    assert.isTrue(CSL_NAME_VARIABLES.has("author"));
    // Declared by CSL 1.0.2 and part of the generated table.
    assert.isTrue(CSL_NAME_VARIABLES.has("editor-translator"));
    // Not a CSL name variable (the CSL schema does not declare it), so a preset
    // writing it is not warned about as if citeproc used it for creators.
    assert.isFalse(CSL_NAME_VARIABLES.has("presenter"));
    assert.isTrue(CSL_ITEM_TYPES.has("article-journal"));
    assert.isTrue(CSL_ITEM_TYPES.has("classic"));
    assert.isTrue(CSL_VARIABLES.has("title"));
    assert.isFalse(CSL_VARIABLES.has("bookTitle"));
  });
});

/**
 * The runtime models: the per-item-type structure as a typed module (exported
 * by the package index) and as a JSON asset (for tools). Both are generated
 * from one definition, so both re-render and are checked against each other and
 * against the constant tables.
 */
describe("generated schema models", function () {
  async function committed(relativePath: string): Promise<string> {
    return readFile(path.join(repoRoot(), relativePath), "utf8");
  }

  async function zoteroModel(): Promise<ZoteroSchemaJson> {
    return JSON.parse(await committed(SCHEMA_JSON_OUTPUT)) as ZoteroSchemaJson;
  }

  it("keeps the trimmed Zotero model in step with the schema", async function () {
    const schema = await readZoteroSchema();
    assert.equal(
      await committed(SCHEMA_JSON_OUTPUT),
      await formatGenerated(SCHEMA_JSON_OUTPUT, renderZoteroSchemaJson(schema)),
    );
  });

  it("keeps the CSL model in step with the CSL schema", async function () {
    const source = {
      variables: await readRepoFile(VARIABLES_PATH),
      types: await readRepoFile(TYPES_PATH),
    };
    assert.equal(
      await committed(CSL_JSON_OUTPUT),
      await formatGenerated(CSL_JSON_OUTPUT, renderCslSchemaJson(source)),
    );
  });

  it("keeps the Zotero model module in step with the schema", async function () {
    const schema = await readZoteroSchema();
    assert.equal(
      await committed(SCHEMA_MODEL_OUTPUT),
      await formatGenerated(SCHEMA_MODEL_OUTPUT, renderZoteroModel(schema)),
    );
  });

  it("keeps the CSL model module in step with the CSL schema", async function () {
    const source = {
      variables: await readRepoFile(VARIABLES_PATH),
      types: await readRepoFile(TYPES_PATH),
    };
    assert.equal(
      await committed(CSL_MODEL_OUTPUT),
      await formatGenerated(CSL_MODEL_OUTPUT, renderCslModel(source)),
    );
  });

  it("exports the module and the JSON asset with identical data", async function () {
    const fromJson = await zoteroModel();
    assert.deepEqual(
      JSON.parse(JSON.stringify(ZOTERO_SCHEMA)),
      fromJson,
      "ZOTERO_SCHEMA differs from zotero-schema.json",
    );

    const cslFromJson = JSON.parse(
      await committed(CSL_JSON_OUTPUT),
    ) as CslSchemaJson;
    assert.deepEqual(
      JSON.parse(JSON.stringify(CSL_SCHEMA)),
      cslFromJson,
      "CSL_SCHEMA differs from csl-schema.json",
    );
  });

  it("covers exactly the regular item types, without the source's bulk", async function () {
    const model = await zoteroModel();
    assert.deepEqual(
      Object.keys(model.itemTypes).sort(),
      [...ZOTERO_ITEM_TYPES].sort(),
    );
    assert.isUndefined((model as unknown as Record<string, unknown>).locales);
    assert.isUndefined((model as unknown as Record<string, unknown>).meta);
    assert.equal(model.version, ZOTERO_SCHEMA_VERSION);
  });

  it("agrees with the constant tables it complements", async function () {
    const model = await zoteroModel();
    const union = new Set<string>();
    for (const itemType of ZOTERO_ITEM_TYPES) {
      const entry = model.itemTypes[itemType];
      assert.isDefined(entry, `${itemType} is missing from the model`);

      // The per-type table and the model describe the same field list.
      assert.deepEqual(
        [...(ZOTERO_ITEM_TYPE_FIELDS[itemType] ?? [])],
        entry.fields,
        `fields of ${itemType} differ from the table`,
      );
      for (const field of entry.fields) union.add(field);

      // The base-field map is the same contract the table exposes.
      assert.deepEqual(
        entry.baseFields ?? {},
        ZOTERO_BASE_FIELD_ALIASES[itemType] ?? {},
        `base fields of ${itemType} differ from the alias table`,
      );

      // The primary creator table and the model agree.
      assert.equal(
        ZOTERO_PRIMARY_CREATOR_TYPES[itemType],
        entry.primaryCreatorType,
        `primary creator of ${itemType} differs from the table`,
      );

      for (const creatorType of entry.creatorTypes) {
        assert.isTrue(
          ZOTERO_CREATOR_TYPES.has(creatorType),
          `${creatorType} of ${itemType} is not a known creator type`,
        );
      }

      if (entry.primaryCreatorType !== undefined) {
        assert.include(entry.creatorTypes, entry.primaryCreatorType);
      }
    }

    assert.deepEqual(new Set([...ZOTERO_FIELDS].sort()), union);
  });

  it("carries the facts a host computes firstCreator and RDF mapping from", async function () {
    const model = await zoteroModel();
    assert.equal(model.itemTypes.patent?.primaryCreatorType, "inventor");
    assert.equal(model.itemTypes.hearing?.primaryCreatorType, "contributor");
    assert.equal(model.itemTypes.videoRecording?.primaryCreatorType, "creator");
    assert.include(model.itemTypes.case?.fields, "reporter");
    assert.include(model.itemTypes.journalArticle?.fields, "issue");
    assert.notInclude(model.itemTypes.patent?.fields, "issue");
    assert.equal(
      model.itemTypes.bookSection?.baseFields?.bookTitle,
      "publicationTitle",
    );
  });

  it("keeps the CSL model consistent with the CSL sets", async function () {
    const model = JSON.parse(await committed(CSL_JSON_OUTPUT)) as CslSchemaJson;

    assert.deepEqual(new Set(model.itemTypes), CSL_ITEM_TYPES);
    assert.deepEqual(new Set(model.variables.names), CSL_NAME_VARIABLES);
    assert.deepEqual(new Set(model.variablesAll), CSL_VARIABLES);
    for (const group of Object.values(model.variables)) {
      for (const variable of group) {
        assert.isTrue(CSL_VARIABLES.has(variable));
      }
    }

    // The exported module carries the same vocabulary.
    assert.deepEqual(new Set(CSL_SCHEMA.itemTypes), CSL_ITEM_TYPES);
    assert.deepEqual(new Set(CSL_SCHEMA.variablesAll), CSL_VARIABLES);
  });

  it("imports through the published entry points", async function () {
    // Self-reference goes through `exports` in package.json — the path a host
    // really uses — and therefore also proves the built `dist` tree, including
    // that every relative import the build emits resolves (`./schema` needs its
    // directory index).
    const root = (await import("@banyan/core")) as Record<string, unknown>;
    assert.isFunction(root.fieldForBase);
    assert.isFunction(root.specificFieldsForBase);
    assert.isTrue((root.ZOTERO_ITEM_TYPES as Set<string>).has("bookSection"));
    assert.equal(root.ZOTERO_SCHEMA_VERSION, ZOTERO_SCHEMA_VERSION);
    // The runtime model and the queries are in the root index too.
    assert.isDefined((root.ZOTERO_SCHEMA as { itemTypes: unknown }).itemTypes);
    assert.isArray((root.CSL_SCHEMA as { itemTypes: unknown }).itemTypes);
    assert.isArray((root.CSL_M_SCHEMA as { itemTypes: unknown }).itemTypes);
    assert.isFunction(root.isZoteroField);
    assert.isFunction(root.resolveZoteroField);
    assert.isFunction(root.isCslVariable);
    assert.isFunction(root.isCslMItemType);
    assert.isFunction(root.isCslMOnlyItemType);
    assert.isFunction(root.isCslMOnlyVariable);

    // The CSL-M module is reachable through the package wildcard too.
    const cslm = (await import("@banyan/core/schema/cslmSchema")) as Record<
      string,
      unknown
    >;
    assert.isTrue((cslm.CSL_M_ITEM_TYPES as Set<string>).has("video"));

    for (const [specifier, versioned] of [
      ["@banyan/core/schema/zotero-schema.json", true],
      ["@banyan/core/schema/csl-schema.json", false],
    ] as const) {
      const resolved = createRequire(import.meta.url).resolve(specifier);
      assert.match(
        resolved.replace(/\\/g, "/"),
        /\/dist\/schema\/[a-z-]+\.json$/,
      );
      const body = JSON.parse(await readFile(resolved, "utf8")) as Record<
        string,
        unknown
      >;
      if (versioned) {
        assert.equal(body.version, ZOTERO_SCHEMA_VERSION);
        assert.isDefined(body.itemTypes);
      } else {
        assert.isArray(body.itemTypes);
        assert.isDefined(body.variables);
      }
    }
  });
});

describe("schema queries", function () {
  it("answers field ownership exactly, across item types", function () {
    assert.isTrue(isZoteroField("bookTitle"));
    assert.isTrue(isZoteroField("publicationTitle"));
    assert.isTrue(isZoteroField("reporter"));
    assert.isTrue(isZoteroField("ISBN"));
    assert.isFalse(isZoteroField("my-key"));
    assert.isFalse(isZoteroField("no-such-field"));

    // Matching is case-sensitive, like Zotero.ItemFields.getID.
    assert.isTrue(isZoteroField("title"));
    assert.isFalse(isZoteroField("Title"));
    assert.isFalse(isZoteroField("isbn"));
  });

  it("distinguishes a field from the same name on another type", function () {
    assert.isTrue(isZoteroItemField("bookSection", "bookTitle"));
    assert.isFalse(isZoteroItemField("book", "bookTitle"));
    assert.isTrue(isZoteroItemField("journalArticle", "publicationTitle"));
    assert.isFalse(isZoteroItemField("book", "publicationTitle"));
    assert.isTrue(isZoteroItemField("case", "reporter"));

    assert.deepEqual(itemTypeFieldsOf("bookSection").slice(0, 3), [
      "title",
      "abstractNote",
      "bookTitle",
    ]);
    assert.deepEqual(itemTypeFieldsOf("no-such-type"), []);
  });

  it("resolves a base name to the field the type stores", function () {
    assert.equal(
      resolveZoteroField("bookSection", "publicationTitle"),
      "bookTitle",
    );
    assert.equal(
      resolveZoteroField("journalArticle", "publicationTitle"),
      "publicationTitle",
    );
    assert.equal(resolveZoteroField("case", "title"), "caseName");
    assert.equal(resolveZoteroField("bookSection", "bookTitle"), "bookTitle");
    assert.equal(resolveZoteroField("report", "publisher"), "institution");

    // The type has no such field (or no such concept), so a host must not write it.
    assert.isNull(resolveZoteroField("book", "publicationTitle"));
    assert.isNull(resolveZoteroField("book", "bookTitle"));
    assert.isNull(resolveZoteroField("no-such-type", "title"));
  });

  it("recognizes CSL variables and item types", function () {
    assert.isTrue(isCslVariable("title"));
    assert.isTrue(isCslVariable("issued"));
    assert.isFalse(isCslVariable("bookTitle"));
    assert.isFalse(isCslVariable("Title"));

    assert.isTrue(isCslItemType("article-journal"));
    assert.isFalse(isCslItemType("journalArticle"));
  });

  it("recognizes Zotero item and creator types", function () {
    assert.isTrue(isZoteroItemType("book"));
    assert.isFalse(isZoteroItemType("Book"));
    // Notes, attachments and annotations are not regular items a style sees.
    assert.isFalse(isZoteroItemType("note"));
    assert.isTrue(isZoteroCreatorType("inventor"));
    assert.isFalse(isZoteroCreatorType("nope"));
  });

  it("keeps `extra` a real field, so hosts special-case it", function () {
    assert.isTrue(isZoteroField("extra"));
    assert.isTrue(isZoteroItemField("book", "extra"));
    // It is also a CSL variable-free key, so an `extra` line named "extra" is
    // not a CSL collision.
    assert.isFalse(isCslVariable("extra"));
  });

  it("degrades to false/null for names the schema does not describe", function () {
    assert.isFalse(isZoteroItemField("no-such-type", "title"));
    assert.isFalse(isZoteroItemField("book", "no-such-field"));
    assert.isNull(resolveZoteroField("no-such-type", "publicationTitle"));
  });

  it("never reads Object.prototype as schema data", function () {
    // The tables are plain objects, so a prototype name must miss like any
    // other unknown type instead of reaching `Object.prototype.toString`.
    for (const name of ["toString", "constructor", "__proto__"]) {
      assert.isFalse(isZoteroItemField(name, "title"), name);
      assert.deepEqual(itemTypeFieldsOf(name), [], name);
      assert.isNull(resolveZoteroField(name, "publicationTitle"), name);
    }
  });

  it("ignores quoted examples inside RNC comments", function () {
    const source = [
      'variables.dates = "issued" # example: "bogus-date"',
      'variables.names = "title" # example: "bogus-name"',
      'variables.numbers = "volume"',
      'variables.titles = "title-short"',
      'variables.strings = "DOI"',
    ].join("\n");

    assert.deepEqual(cslVariables(source), {
      dates: ["issued"],
      names: ["title"],
      numbers: ["volume"],
      titles: ["title-short"],
      strings: ["DOI"],
    });
  });
});

describe("base-field resolution helpers", function () {
  it("names the field a base name means on one type", function () {
    assert.equal(fieldForBase("bookSection", "publicationTitle"), "bookTitle");
    // A prototype name is not an item type: the base name stays the answer.
    assert.equal(fieldForBase("toString", "title"), "title");
    assert.equal(
      fieldForBase("journalArticle", "publicationTitle"),
      "publicationTitle",
    );
    assert.equal(fieldForBase("report", "publisher"), "institution");
    assert.equal(fieldForBase("patent", "date"), "issueDate");
  });

  it("lists every type-specific field that aliases onto a base name", function () {
    assert.deepEqual(specificFieldsForBase("bookSection", "publicationTitle"), [
      "bookTitle",
    ]);
    assert.deepEqual(
      specificFieldsForBase("journalArticle", "publicationTitle"),
      [],
    );
    assert.deepEqual(specificFieldsForBase("case", "date"), ["dateDecided"]);
  });

  it("agrees with the alias table it inverts", function () {
    for (const [itemType, aliases] of Object.entries(
      ZOTERO_BASE_FIELD_ALIASES,
    )) {
      for (const [field, base] of Object.entries(aliases)) {
        assert.include(specificFieldsForBase(itemType, base), field);
      }
    }
  });
});
