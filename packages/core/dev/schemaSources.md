# Schema sources and generated artifacts

The core owns the schema facts its behaviour depends on. Hosts do not supply
them: the same style fed the same items has to behave the same everywhere, so
the authoritative data lives in one place — and it is exposed, so hosts and
tools can read the same contracts `@banyan/core` uses instead of keeping copies.

## Sources

Both are development dependencies without a `package.json`, installed as git
dependencies and recorded in the lockfile. Nothing reads them at runtime.

| Dependency      | Repository                                                                                | Used for                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zotero-schema` | [zotero/zotero-schema](https://github.com/zotero/zotero-schema)                           | The Zotero data model Zotero itself generates its schema from: item types, creator types, type-specific fields and their base fields, and Zotero's mapping onto CSL name variables |
| `csl-schema`    | [citation-style-language/schema](https://github.com/citation-style-language/schema) (MIT) | The CSL vocabulary: item types and variables (`variables.names` / `.dates` / `.numbers` / `.titles` / `.strings`)                                                                  |

## Generated artifacts (all committed)

Three shapes, split by what they are good at:

- **TypeScript constants** — the fast path for the questions a host asks per
  item (is this a field of that type, which field does this base name mean,
  which creator type does Zotero promote). Imported as modules; they avoid
  scanning the model.
- **Models** — the full per-item-type / vocabulary structure as typed modules,
  re-exported by the package index (`ZOTERO_SCHEMA`, `CSL_SCHEMA`). A host that
  converts its own item model, or generates items from scratch, reads these.
  They are compiled in, so no file access, JSON loader or `resolveJsonModule`
  setting is required.
- **JSON assets** — the same data as files, for tools in other languages (or for
  fact checks against the modules). Not imported by the barrel, so bundling the
  core does not pull them in.

The generated artifacts come from the same two installed schemas;
`cslmSchema.ts` (curated from citeproc-js) and `queries.ts` (hand-written
predicates) are the exceptions. The tests keep the generated artifacts
identical, and keep the curated `CSL_M_ONLY_*` delta disjoint from the generated
official-CSL tables.

| Artifact                        | Content                                                                                                                                                                                                        | Exposed as                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `src/types/item.d.ts`           | The author-facing `Item` shape: `ItemType`, `CreatorType`, one interface per regular item type, `ItemBase`                                                                                                     | `@banyan/core/types/item`                |
| `src/schema/zoteroSchema.ts`    | `ZOTERO_SCHEMA_VERSION`, `ZOTERO_ITEM_TYPES`, `ZOTERO_CREATOR_TYPES`, `ZOTERO_CREATOR_TYPE_CSL_NAMES`, `ZOTERO_ITEM_TYPE_FIELDS`, `ZOTERO_FIELDS`, `ZOTERO_PRIMARY_CREATOR_TYPES`, `ZOTERO_BASE_FIELD_ALIASES` | `@banyan/core/schema/zoteroSchema`       |
| `src/schema/cslSchema.ts`       | `CSL_ITEM_TYPES`, `CSL_NAME_VARIABLES` / `CSL_DATE_VARIABLES` / `CSL_NUMBER_VARIABLES` / `CSL_TITLE_VARIABLES` / `CSL_STRING_VARIABLES`, `CSL_VARIABLES`                                                       | `@banyan/core/schema/cslSchema`          |
| `src/schema/cslmSchema.ts`      | Complete CSL-M schema (`CSL_M_*`), its CSL-M-only delta (`CSL_M_ONLY_*`), `CSL_M_SCHEMA` (curated from citeproc-js, not generated)                                                                             | `@banyan/core/schema/cslmSchema`         |
| `src/schema/zoteroModel.ts`     | `ZOTERO_SCHEMA`: `version`, and per regular item type its `fields`, `baseFields`, `creatorTypes`, `primaryCreatorType`                                                                                         | `@banyan/core` and `/schema` (index)     |
| `src/schema/cslModel.ts`        | `CSL_SCHEMA`: `itemTypes`, `variables` by group, `variablesAll`                                                                                                                                                | `@banyan/core` and `/schema` (index)     |
| `src/schema/zotero-schema.json` | Same data as `zoteroModel.ts`, as a file                                                                                                                                                                       | `@banyan/core/schema/zotero-schema.json` |
| `src/schema/csl-schema.json`    | Same data as `cslModel.ts`, as a file                                                                                                                                                                          | `@banyan/core/schema/csl-schema.json`    |
| `src/schema/queries.ts`         | Hand-written predicates over the constants (see "Schema queries")                                                                                                                                              | `@banyan/core` and `/schema` (index)     |

Regenerate with:

```powershell
pnpm gen:schema
```

`tests/generatedSchema.test.ts` re-renders every artifact from the installed
schemas and compares, so a schema bump (`pnpm update zotero-schema` /
`csl-schema`) fails until the generator runs again. It also cross-checks the
models against the constants they complement (same item types, same per-type
fields, same base fields, same primary creators, same CSL sets) and the modules
against the JSON assets, because artifacts that describe one model must not
drift.

Why a module _and_ a JSON file: the index must be importable without `fs` or a
JSON loader, so the model is compiled in; importing the `.json` module instead
would require every consumer's tsconfig to enable `resolveJsonModule` and the
runtime to support import attributes. The JSON asset stays for tools that want
a file, and the test keeps the two byte-for-byte equivalent in content.

## Zotero side: the model and the constants

- **Regular items only**: `note` / `attachment` / `annotation` are excluded from
  all artifacts, matching `isRegularItem()`.
- `ItemType` / `ZOTERO_ITEM_TYPES`: `itemTypes[].itemType`.
- `CreatorType` / `ZOTERO_CREATOR_TYPES`: `itemTypes[].creatorTypes[].creatorType`,
  deduplicated across types.
- Each item type gets `${PascalCase(itemType)}Item = ItemBase<"itemType"> & {...}`:
  `fields[].field` (and `baseField`) become `?: string` properties, the type's
  `creatorTypes` narrow `creators?: Creator<...>[]`.
- `ItemBase` keeps `id`/`itemType`/`year`/`firstCreator`, `title` and `date`
  (canonical aliases normalized onto every item), `tags`, `creators`, `extra`,
  plus an `any` index signature for unknown fields. `id` is a **string**: a host
  with numeric storage encodes its handle once, and a host with URI/UUID
  handles needs no lossy conversion. `key`, `uri` and `relations`
  are intentionally not part of the style-facing item; a host may add its own
  namespaced fields (e.g. Zotero's `z:uri`) through the index signature.
- `ZOTERO_BASE_FIELD_ALIASES` is `itemType -> field -> baseField` (e.g.
  `bookSection.bookTitle -> publicationTitle`), consumed by
  `assignBaseFieldAliases()` in `src/items/fields.ts`. The inverse direction a
  host needs when it holds a value by base name is `fieldForBase()` /
  `specificFieldsForBase()` in the same module. Aliasing is part of the output
  contract — a style reading `publicationTitle` must see it on every host — so
  the core resolves it itself.
- `ZOTERO_ITEM_TYPE_FIELDS` is `itemType -> field[]` (storage names, schema
  order); `ZOTERO_FIELDS` is their union, i.e. "every Zotero field". These are
  the tables `isZoteroField()` / `isZoteroItemField()` answer from, so a host
  does not rebuild them per item.
- `ZOTERO_PRIMARY_CREATOR_TYPES` is `itemType -> creatorType`, the primary
  creator Zotero promotes into `firstCreator` (also in the model as
  `primaryCreatorType`).
- `ZOTERO_CREATOR_TYPE_CSL_NAMES` is `csl.names`: how Zotero maps its creator
  types onto CSL name variables. It is a Zotero-side mapping, used for advisory
  wording; the CSL vocabulary itself comes from the CSL schema.
- Fields in `EXCLUDED_FIELDS` (`src/items/fields.ts`) and creator-extension
  fields (`src/items/creatorsExt.ts`) are imported by the generator, so the
  runtime and the generated types cannot drift apart.

### The runtime model: why it is trimmed and what it carries

The source `schema.json` is 394 KB, of which ~254 KB are 48 locales of display
labels and a few kilobytes are field metadata the core never consults. Shipping
it whole would put UI text into every consumer, so the generator writes a
trimmed projection instead:

```json
{
  "version": 45,
  "itemTypes": {
    "bookSection": {
      "fields": ["title", "abstractNote", "bookTitle", "..."],
      "baseFields": { "bookTitle": "publicationTitle" },
      "creatorTypes": ["author", "bookAuthor", "editor", "..."],
      "primaryCreatorType": "author"
    }
  }
}
```

- `itemTypes` is keyed by item type: a host looks one up, it does not scan.
- `fields` carries the storage names Zotero uses; `baseFields` records the
  aliases, so the per-type structure is complete.
- `primaryCreatorType` is the fact Zotero computes `firstCreator` from.
- `version` is the Zotero data-model version, mirrored by `ZOTERO_SCHEMA_VERSION`.

The projection is emitted as `ZOTERO_SCHEMA` (a typed module in the package
index) and as `zotero-schema.json` (the asset); the test keeps them identical.
Neither is authoritative over the source: `pnpm gen:schema` re-renders both, and
the test rejects a stale artifact the same way it rejects stale constants.

### Schema queries

`src/schema/queries.ts` answers the questions a conversion or generation layer
asks, so a host does not have to index the tables itself:

| Question                                                     | Helper                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| Is this name a Zotero field on any type? (otherwise: extra)  | `isZoteroField(name)`                                   |
| Does this type store this exact field?                       | `isZoteroItemField(itemType, name)`                     |
| Which field does this base name mean here? (else `null`)     | `resolveZoteroField(itemType, name)`                    |
| The type's field list                                        | `itemTypeFieldsOf(itemType)`                            |
| Typed name checks                                            | `isZoteroItemType`, `isZoteroCreatorType`               |
| Would this `extra` key collide with official CSL vocabulary? | `isCslVariable(name)` / `isCslItemType(name)`           |
| Is this name in the complete CSL-M schema?                   | `isCslMVariable(name)` / `isCslMItemType(name)`         |
| Is this name CSL-M-specific (absent from official CSL)?      | `isCslMOnlyVariable(name)` / `isCslMOnlyItemType(name)` |

Matching is **exact and case-sensitive**, mirroring Zotero's
`Zotero.ItemFields.getID` (`DOI` is a field, `doi` is not); normalize before
calling if that is what a feature wants. Unknown names and item types answer
`false` / `null` / `[]` instead of throwing. `extra` and `abstractNote` are real
fields, so a host deciding "write to `extra` when this is not a field" must
special-case `extra` itself.

### Field names that look like record metadata

`EXCLUDED_FIELDS` drops `version`, `collections`, `dateAdded`, `dateModified` and
`notes`. None of them is a Zotero field — the schema declares no such field on
any item type — so nothing author-writable is lost:

- `version` is the **record** version `Zotero.Item.toJSON()` puts next to the
  fields (`obj.version = this.version`, `xpcom/data/item.js`). The Software item
  type's "Version" field is named **`versionNumber`** internally (Zotero's own
  CSL mapping sends CSL `version` <- `versionNumber`), so it stays readable:
  `item.versionNumber` is in `ComputerProgramItem` and survives
  `stripExcludedFields()`. Only the record version is dropped, and only that key
  is denied to field presets.
- `abstractNote` is a real field on nearly every type and _is_ dropped from the
  Banyan item (citation payload). Styles therefore cannot read it, while a field
  preset may still write it through Zotero's own API — revisit if an
  annotated-bibliography style ever needs the abstract.

## CSL side: vocabulary as data, not RELAX NG

The core is aware of CSL variables because a style writing something citeproc
understands must not be treated like a style writing a plain Zotero field.
`type` is the sensitive one: it decides how an item is cited.

- The source is RELAX NG (`csl-variables.rnc`, `csl-types.rnc`). It is compact
  but not something every JavaScript environment can parse, so the core exports
  the parsed model both as a constant form (`cslSchema.ts`) and as
  `CSL_SCHEMA` (`cslModel.ts`, re-exported by the package index), plus the
  `csl-schema.json` asset with `itemTypes`, `variables` by group and
  `variablesAll`. Only what the core models is converted: not terms, categories
  or the style schema itself.
- `CSL_NAME_VARIABLES` (the schema's `variables.names`) is generated, so the set
  cannot drift from the schema: it includes `editor-translator` (CSL 1.0.2) and
  excludes `presenter`, which the CSL schema does not declare.
  `src/validation/fieldPresets.ts` uses the generated set, so preset
  diagnostics cannot drift from the vocabulary.
- `CSL_ITEM_TYPES` tells an official CSL item type from a Zotero one. A preset
  writing `type: <name>` asks the CSL schema first, then the separate CSL-M
  delta, so the two vocabularies are never merged.

## CSL-M side: a separate schema, not a patch

Zotero renders citations with citeproc-js, whose CSL-M mode recognizes item
types and variables official CSL does not declare. That is the escape hatch
Zotero documents for item types it has no native item type for: a
`Type: <CSL type>` line in `extra` is read by citeproc-js, not by Zotero's own
item model.

CSL and CSL-M are two different schemas. `cslSchema.ts` is official CSL,
generated from the official schema repository; `cslmSchema.ts` is the complete
CSL-M schema, curated from the citeproc-js CSL-M documentation
(<https://citeproc-js.readthedocs.io/en/latest/csl-m/>). A platform that supports
only CSL imports `CSL_SCHEMA`; one that supports CSL-M imports `CSL_M_SCHEMA`;
an application that supports both (Zotero, Banyan) chooses which schema a given
feature needs. There is deliberately no merged schema.

- `CSL_M_ITEM_TYPES` / `CSL_M_DATE_VARIABLES` / `CSL_M_NAME_VARIABLES` /
  `CSL_M_NUMBER_VARIABLES` / `CSL_M_TITLE_VARIABLES` /
  `CSL_M_STRING_VARIABLES` / `CSL_M_VARIABLES` are the **complete** CSL-M
  vocabulary: every shared CSL name plus the CSL-M additions. `CSL_M_SCHEMA`
  exposes the same data in the `CSL_SCHEMA` shape.
- `CSL_M_ONLY_ITEM_TYPES` / `CSL_M_ONLY_VARIABLES` are the **delta**: the types
  and variables absent from official CSL. They are what a caller checks when it
  needs to know whether a name is CSL-M-specific, without subtracting the CSL
  tables. `authority` is a shared name, not a CSL-M-only one: CSL declares it as
  a string, CSL-M reclassifies it as a name, so it appears in
  `CSL_M_NAME_VARIABLES` and not in `CSL_M_STRING_VARIABLES`.
- `queries.ts` answers each question against the schema it belongs to:
  `isCslItemType` / `isCslVariable` for official CSL, `isCslMItemType` /
  `isCslMVariable` for the complete CSL-M schema, and
  `isCslMOnlyItemType` / `isCslMOnlyVariable` for the delta. Membership stays
  exact and case-sensitive.

`src/validation/fieldPresets.ts` checks `CSL_ITEM_TYPES` first for the CSL
warning, then `CSL_M_ONLY_ITEM_TYPES` for the CSL-M warning; any other value
would leave citeproc with an untyped item when it reaches `extra` (error). Extra
keys are checked against the complete `CSL_M_VARIABLES`, so a key shared by both
schemas is accepted once, without merging the tables.

## Extending the generated output

Ideas the generators deliberately do not do yet:

1. **Field types**: every Zotero field is `?: string` today. `schema.meta.fields`
   marks a few as `date`, so those could narrow; the trimmed JSON would need a
   matching marker (`type: "date"`).
2. **`extra`**: it is parsed into `ExtraMap` at runtime; an `extraText?: string`
   could keep the raw string visible.
3. **Interface naming**: `tvBroadcast` becomes `TvBroadcastItem`; an acronym
   table in `interfaceNameForItemType()` would produce `TVBroadcastItem`.
4. **More CSL tables**: `csl-fields`/`csl-terms` (and the Zotero schema's
   `csl.fields`/`csl.types` cross-mappings) can be added the same way when a
   consumer needs CSL <-> Zotero field or type mapping. They would join the JSON
   model, not the constant table.

After changing a generator, run `pnpm gen:schema`, then `pnpm lint:check`,
`pnpm test:node` and `pnpm build`.
