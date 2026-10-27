/**
 * Regenerate the schema-backed artifacts from the Zotero data model:
 *
 * - `src/types/item.d.ts`   — the author-facing `Item` shape
 * - `src/schema/zoteroSchema.ts` — the small constants a host should not have
 *   to derive: valid names, base-field aliases, creator-type -> CSL names
 * - `src/schema/zotero-schema.json` — the trimmed runtime model: per-type
 *   fields and creator types, which the tables deliberately do not repeat
 *
 * Source: `node_modules/zotero-schema/schema.json`, i.e. the repository Zotero
 * generates its own schema from (a development-time dependency, see
 * `package.json`). All artifacts are committed; nothing reads the source schema
 * at runtime.
 *
 * Run with `pnpm gen:schema`.
 */
import { isEntryPoint, readRepoFile, writeGenerated } from "./schemaSource";
import { EXCLUDED_FIELDS } from "../src/items/fields";
import { CREATOR_EXT_FIELDS } from "../src/items/creatorsExt";

/** The Zotero data model repo Zotero itself generates its schema from. */
export const SCHEMA_PATH = "node_modules/zotero-schema/schema.json";

export type ZoteroSchemaField = {
  field?: string;
  baseField?: string;
};

export type ZoteroSchemaItemType = {
  itemType?: string;
  fields?: ZoteroSchemaField[];
  creatorTypes?: { creatorType?: string; primary?: boolean }[];
};

export type ZoteroSchema = {
  version: number;
  itemTypes?: ZoteroSchemaItemType[];
  csl?: {
    /** Zotero creator type -> CSL name variable, as Zotero maps them. */
    names?: Record<string, string>;
  };
};

export async function readZoteroSchema(): Promise<ZoteroSchema> {
  return JSON.parse(await readRepoFile(SCHEMA_PATH)) as ZoteroSchema;
}

// A style only ever sees Zotero's regular items: `isRegularItem()` is false for
// notes, attachments and annotations.
const EXCLUDED_ITEM_TYPES = new Set(["note", "attachment", "annotation"]);

// Canonical aliases normalized onto every regular item; other base fields stay
// type-specific and off `ItemBase`.
const COMMON_ITEM_BASE_FIELDS = ["title", "date"];

export const ITEM_TYPES_OUTPUT = "src/types/item.d.ts";
export const SCHEMA_TABLES_OUTPUT = "src/schema/zoteroSchema.ts";
export const SCHEMA_JSON_OUTPUT = "src/schema/zotero-schema.json";
export const SCHEMA_MODEL_OUTPUT = "src/schema/zoteroModel.ts";

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function pascalCase(input: string): string {
  return String(input || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join("");
}

function interfaceNameForItemType(itemType: string): string {
  return `${pascalCase(itemType)}Item`;
}

function quoteUnion(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join("\n  | ");
}

function formatStringProps(fieldNames: readonly string[]): string {
  return fieldNames
    .filter((field) => field !== "itemType")
    .map((field) => `  ${field}?: string;`)
    .join("\n");
}

function extractFieldNames(typeDef: ZoteroSchemaItemType): string[] {
  const names: string[] = [];
  for (const entry of typeDef.fields ?? []) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.field === "string") names.push(entry.field);
    if (typeof entry.baseField === "string") names.push(entry.baseField);
  }
  return uniq(names).sort();
}

function extractCreatorTypes(typeDef: ZoteroSchemaItemType): string[] {
  const types: string[] = [];
  for (const entry of typeDef.creatorTypes ?? []) {
    if (typeof entry?.creatorType === "string" && entry.creatorType) {
      types.push(entry.creatorType);
    }
  }
  return uniq(types).sort();
}

export function regularItemTypeDefs(
  schema: ZoteroSchema,
): ZoteroSchemaItemType[] {
  return (schema.itemTypes ?? []).filter((typeDef) => {
    const itemType = typeDef?.itemType;
    return Boolean(itemType) && !EXCLUDED_ITEM_TYPES.has(itemType as string);
  });
}

export function itemTypeNames(schema: ZoteroSchema): string[] {
  return uniq(
    regularItemTypeDefs(schema).map((typeDef) => typeDef.itemType as string),
  ).sort();
}

export function creatorTypeNames(schema: ZoteroSchema): string[] {
  const names = new Set<string>();
  for (const typeDef of regularItemTypeDefs(schema)) {
    for (const creatorType of extractCreatorTypes(typeDef)) {
      names.add(creatorType);
    }
  }
  return Array.from(names).sort();
}

/** `itemType -> field -> base field`, for fields Zotero stores type-specifically. */
export function baseFieldAliases(
  schema: ZoteroSchema,
): Record<string, Record<string, string>> {
  const aliases: Record<string, Record<string, string>> = {};
  for (const typeDef of regularItemTypeDefs(schema)) {
    const itemType = typeDef.itemType as string;
    const perType: Record<string, string> = {};
    for (const entry of typeDef.fields ?? []) {
      const field = entry?.field;
      const baseField = entry?.baseField;
      if (typeof field !== "string" || typeof baseField !== "string") continue;
      if (field === baseField) continue;
      perType[field] = baseField;
    }
    const fields = Object.entries(perType).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (fields.length) {
      aliases[itemType] = Object.fromEntries(fields);
    }
  }
  return Object.fromEntries(
    Object.entries(aliases).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function cslCreatorTypeNames(
  schema: ZoteroSchema,
): Record<string, string> {
  const names = schema.csl?.names ?? {};
  return Object.fromEntries(
    Object.entries(names).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * The fields Zotero stores on an item type, in the order the schema declares
 * them (deduplicated).
 *
 * Base fields are not added: they are read through `ZOTERO_BASE_FIELD_ALIASES`
 * (`bookSection` stores `bookTitle`, and `publicationTitle` is its base name).
 */
export function itemTypeFieldNames(typeDef: ZoteroSchemaItemType): string[] {
  const names: string[] = [];
  for (const entry of typeDef.fields ?? []) {
    if (typeof entry?.field === "string" && entry.field) {
      names.push(entry.field);
    }
  }
  return uniq(names);
}

/** `itemType -> fields Zotero stores on it`, in schema order. */
export function itemTypeFields(schema: ZoteroSchema): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const typeDef of regularItemTypeDefs(schema)) {
    const itemType = typeDef.itemType as string;
    fields[itemType] = itemTypeFieldNames(typeDef);
  }
  return fields;
}

/**
 * `itemType -> creator type` Zotero promotes into `firstCreator`.
 *
 * Zotero computes the value from the type's primary creator (`creatorType` with
 * `primary: true`); a type without one is left out and the caller decides.
 */
export function primaryCreatorTypes(
  schema: ZoteroSchema,
): Record<string, string> {
  const primary: Record<string, string> = {};
  for (const typeDef of regularItemTypeDefs(schema)) {
    const itemType = typeDef.itemType as string;
    const found = (typeDef.creatorTypes ?? []).find(
      (entry) =>
        entry?.primary === true && typeof entry.creatorType === "string",
    );
    if (found?.creatorType) {
      primary[itemType] = found.creatorType;
    }
  }
  return primary;
}

export function renderItemTypes(schema: ZoteroSchema): string {
  const itemTypes = itemTypeNames(schema);
  const creatorTypes = creatorTypeNames(schema);
  const typeDefs = regularItemTypeDefs(schema);

  const header = `// This file is generated by scripts/genZoteroSchema.ts
//
// Source: ${SCHEMA_PATH} (schema version ${schema.version})
//
// Do not edit this file by hand. Re-run \`pnpm gen:schema\` instead.

`;

  const prelude = `export type ExtraValue = string | string[];
export type ExtraMap = Record<string, ExtraValue>;

export type CreatorType =
  | ${quoteUnion(creatorTypes)};

export type CreatorExtField =
  | ${quoteUnion(CREATOR_EXT_FIELDS)};

export type CreatorExtFields = {
${CREATOR_EXT_FIELDS.map((field) => `  ${field}?: string;`).join("\n")}
};

export type CreatorExtRecord = {
  creatorType?: string;
  fieldMode?: 0 | 1;
  firstName?: string;
  lastName?: string;
  name?: string;
  index?: number;
} & CreatorExtFields;

type CreatorPersonalName<T extends CreatorType = CreatorType> = {
  creatorType: T;
  firstName: string;
  lastName: string;
  name?: never;
};

type CreatorSingleName<T extends CreatorType = CreatorType> = {
  creatorType: T;
  firstName?: never;
  lastName?: never;
  name: string;
};

export type Creator<T extends CreatorType = CreatorType> =
  | (CreatorPersonalName<T> & CreatorExtFields)
  | (CreatorSingleName<T> & CreatorExtFields);

export type ItemType =
  | ${quoteUnion(itemTypes)};

export type ItemBase<T extends ItemType = ItemType> = {
  itemType: T;

  /**
   * Host-local identifier for this item. Always a string: a host whose storage
   * uses numbers (Zotero) encodes them once, and a host whose handles are not
   * numeric (URIs, UUIDs, API slugs) needs no lossy conversion.
   */
  id: string;
  year?: string;
  firstCreator?: string;

${formatStringProps(COMMON_ITEM_BASE_FIELDS)}

  /** Tags (list of tag names). */
  tags?: string[];

  /** Raw creators from toJSON(). */
  creators: Creator[];

  /** Parsed from Zotero's string \`extra\` field ("key: value" per line). */
  extra?: ExtraMap;
} & {
  /**
   * Other fields from Zotero.Item.toJSON() are mostly textual. The index
   * signature stays \`any\` because the item itself carries non-string values
   * (\`id\`, \`tags\`, \`creators\`), which a \`string\` signature cannot describe.
   * It also lets a host add namespaced, host-private fields; those are not part
   * of the author contract and the core never reads them.
   */
  [field: string]: any;
};

`;

  const interfaceNames = itemTypes.map(interfaceNameForItemType);
  const perTypeInterfaces = itemTypes.map((itemType, index) => {
    const typeDef =
      typeDefs.find((candidate) => candidate.itemType === itemType) ?? {};
    const fields = extractFieldNames(typeDef)
      .filter(
        (field) =>
          ![
            "id",
            "key",
            "uri",
            "extra",
            "tags",
            "relations",
            "creators",
            ...COMMON_ITEM_BASE_FIELDS,
          ].includes(field),
      )
      .filter((field) => !EXCLUDED_FIELDS.has(field));

    const creatorTypesForType = extractCreatorTypes(typeDef);
    const creatorsLine = creatorTypesForType.length
      ? `\n  creators?: Creator<${quoteUnion(creatorTypesForType).replaceAll("\n  | ", " | ")}>[];`
      : "";
    const body = fields.length ? `\n${formatStringProps(fields)}` : "";

    return `export type ${interfaceNames[index]} = ItemBase<${JSON.stringify(
      itemType,
    )}> & {${body}${creatorsLine}\n};\n`;
  });

  const union = `export type Item =\n  | ${interfaceNames.join("\n  | ")};\n`;

  return header + prelude + perTypeInterfaces.join("\n") + union;
}

export function renderSchemaTables(schema: ZoteroSchema): string {
  const itemTypes = itemTypeNames(schema);
  const creatorTypes = creatorTypeNames(schema);
  const aliases = baseFieldAliases(schema);
  const cslNames = cslCreatorTypeNames(schema);

  const quoteSet = (values: readonly string[]): string =>
    `new Set([\n${values.map((value) => `  ${JSON.stringify(value)},`).join("\n")}\n])`;

  const quoteMap = (entries: Record<string, string>, indent = "  "): string =>
    Object.entries(entries)
      .map(
        ([key, value]) =>
          `${indent}${JSON.stringify(key)}: ${JSON.stringify(value)},`,
      )
      .join("\n");

  const aliasMap = Object.entries(aliases)
    .map(
      ([itemType, fields]) =>
        `  ${JSON.stringify(itemType)}: {\n${quoteMap(fields, "    ")}\n  },`,
    )
    .join("\n");

  const fieldsByType = itemTypeFields(schema);
  const primaryByType = primaryCreatorTypes(schema);
  const allFields = Array.from(
    new Set(Object.values(fieldsByType).flat()),
  ).sort();

  const quoteStringArray = (values: readonly string[]): string =>
    `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;

  const fieldMap = Object.entries(fieldsByType)
    .map(
      ([itemType, fields]) =>
        `  ${JSON.stringify(itemType)}: ${quoteStringArray(fields)},`,
    )
    .join("\n");

  return `/**
 * The Zotero schema facts the core owns, as precomputed constants.
 *
 * Generated by \`scripts/genZoteroSchema.ts\` from \`zotero-schema\` (schema
 * version ${schema.version}); do not edit this file by hand, re-run
 * \`pnpm gen:schema\` instead.
 *
 * These tables live in the core rather than in a host capability: what a style
 * can read and what its output means has to be the same on every host, so the
 * authoritative data stays in one place.
 *
 * Two runtime shapes, by use:
 *
 * - these constants are the fast path for ownership questions a host asks on
 *   every item — is this a field of that type, which field does this base name
 *   mean, which creator type does Zotero promote — without scanning the model;
 * - the full per-type structure (creator types, base-field pairs, version) is
 *   exported from \`./zoteroModel\` as \`ZOTERO_SCHEMA\`, re-exported by the
 *   package index. See \`./queries\` for the predicates built on both.
 *
 * The JSON asset (\`zotero-schema.json\`) carries the same model for tooling;
 * the generated module and the asset are produced from one source and kept
 * identical by the tests.
 */

/** Version of the Zotero data model these tables were generated from. */
export const ZOTERO_SCHEMA_VERSION = ${Number(schema.version)};

/** Item types a style can see; notes, attachments and annotations are not regular items. */
export const ZOTERO_ITEM_TYPES: ReadonlySet<string> = ${quoteSet(itemTypes)};

/** Creator types Zotero attaches to those item types. */
export const ZOTERO_CREATOR_TYPES: ReadonlySet<string> = ${quoteSet(creatorTypes)};

/** Zotero creator type -> CSL name variable, as Zotero's schema maps them. */
export const ZOTERO_CREATOR_TYPE_CSL_NAMES: Readonly<
  Record<string, string>
> = {
${quoteMap(cslNames)}
};

/** Item type -> the fields Zotero stores on it, in schema order. */
export const ZOTERO_ITEM_TYPE_FIELDS: Readonly<
  Record<string, readonly string[]>
> = {
${fieldMap}
};

/** Every Zotero field, dedicated to one or more item types. */
export const ZOTERO_FIELDS: ReadonlySet<string> = ${quoteSet(allFields)};

/** Item type -> the creator type Zotero promotes into \`firstCreator\`. */
export const ZOTERO_PRIMARY_CREATOR_TYPES: Readonly<Record<string, string>> = {
${quoteMap(primaryByType)}
};

/** Item type -> type-specific field -> the base field it maps to. */
export const ZOTERO_BASE_FIELD_ALIASES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
${aliasMap}
};
`;
}

/**
 * The trimmed runtime model.
 *
 * Scope is the per-item-type structure plus the schema version: what a host
 * needs to convert or generate items. It matches the scope of the generated
 * `types/item` declarations (regular item types only) and drops the source's
 * bulk the core never consults — 48 locales, the field metadata object — and
 * the constants that are already exported as tables. A host reads this instead
 * of reconstructing the model or keeping its own copy of the schema.
 *
 * Shape: `itemTypes` is keyed by item type (a host looks one up, it does not
 * scan), `baseFields` and `primaryCreatorType` appear only when declared.
 *
 * The same object is emitted twice, from this one definition: as the JSON asset
 * (`renderZoteroSchemaJson`) and as a typed module (`renderZoteroModel`), so a
 * host can import it through the package index without JSON loading.
 */
export interface ZoteroSchemaJsonItemType {
  fields: string[];
  /** `field -> baseField`, for fields Zotero stores type-specifically. */
  baseFields?: Record<string, string>;
  creatorTypes: string[];
  /** The creator type Zotero promotes into `firstCreator`. */
  primaryCreatorType?: string;
}

export interface ZoteroSchemaJson {
  version: number;
  itemTypes: Record<string, ZoteroSchemaJsonItemType>;
}

export function renderZoteroSchemaJson(schema: ZoteroSchema): string {
  const itemTypes: Record<string, ZoteroSchemaJsonItemType> = {};

  for (const itemType of itemTypeNames(schema)) {
    const typeDef = (regularItemTypeDefs(schema).find(
      (candidate) => candidate.itemType === itemType,
    ) ?? {}) as ZoteroSchemaItemType;

    const fields: string[] = [];
    const baseFields: Record<string, string> = {};
    for (const entry of typeDef.fields ?? []) {
      if (typeof entry?.field !== "string" || !entry.field) continue;
      if (!fields.includes(entry.field)) fields.push(entry.field);
      if (
        typeof entry.baseField === "string" &&
        entry.baseField !== entry.field
      ) {
        baseFields[entry.field] = entry.baseField;
      }
    }

    const creatorTypes: string[] = [];
    let primaryCreatorType: string | undefined;
    for (const entry of typeDef.creatorTypes ?? []) {
      if (typeof entry?.creatorType !== "string") continue;
      if (!creatorTypes.includes(entry.creatorType)) {
        creatorTypes.push(entry.creatorType);
      }
      if (entry.primary === true && primaryCreatorType === undefined) {
        primaryCreatorType = entry.creatorType;
      }
    }

    itemTypes[itemType] = {
      fields,
      ...(Object.keys(baseFields).length ? { baseFields } : {}),
      creatorTypes,
      ...(primaryCreatorType ? { primaryCreatorType } : {}),
    };
  }

  return JSON.stringify(
    { version: Number(schema.version), itemTypes },
    null,
    2,
  );
}

/**
 * The same model as a typed module, for the package index.
 *
 * Generated from the object `renderZoteroSchemaJson` serializes, so the JSON
 * asset and the module cannot describe different data. Keeping it a module
 * rather than a JSON import is deliberate: importing JSON would require the
 * consumer's tsconfig to enable `resolveJsonModule` and Node/tsx to support
 * import attributes, for a payload the core itself never reads at runtime.
 */
export function renderZoteroModel(schema: ZoteroSchema): string {
  const model = JSON.parse(renderZoteroSchemaJson(schema)) as ZoteroSchemaJson;

  return `/**
 * The trimmed Zotero data model, for runtime use.
 *
 * Generated by \`scripts/genZoteroSchema.ts\` from \`zotero-schema\` (schema
 * version ${schema.version}); do not edit this file by hand, re-run
 * \`pnpm gen:schema\` instead.
 *
 * This is the same data as \`@banyan/core/schema/zotero-schema.json\`, compiled
 * into the module graph so a host that imports the package index gets the model
 * without a file read, a JSON loader or a \`resolveJsonModule\` setting. The
 * tests keep the two identical.
 *
 * Use it to convert or generate items: which fields an item type stores, which
 * of them are aliases of a base field, which creator types it accepts and which
 * one Zotero promotes into \`firstCreator\`. \`./queries\` exposes the hot
 * membership questions as predicates over the constants in \`./zoteroSchema\`.
 */

/** One item type in the trimmed Zotero model. */
export interface ZoteroItemTypeSchema {
  /** Fields Zotero stores on the type, in schema order. */
  readonly fields: readonly string[];
  /** \`field -> baseField\`, for fields Zotero stores type-specifically. */
  readonly baseFields?: Readonly<Record<string, string>>;
  /** Creator types the item type accepts. */
  readonly creatorTypes: readonly string[];
  /** The creator type Zotero promotes into \`firstCreator\`. */
  readonly primaryCreatorType?: string;
}

/** The trimmed Zotero data model: regular item types, keyed by item type. */
export interface ZoteroSchemaModel {
  readonly version: number;
  readonly itemTypes: Readonly<Record<string, ZoteroItemTypeSchema>>;
}

/** The Zotero data model these artifacts were generated from. */
export const ZOTERO_SCHEMA: ZoteroSchemaModel = ${JSON.stringify(model, null, 2)};
`;
}

async function main(): Promise<void> {
  const schema = await readZoteroSchema();
  await writeGenerated(ITEM_TYPES_OUTPUT, renderItemTypes(schema));
  await writeGenerated(SCHEMA_TABLES_OUTPUT, renderSchemaTables(schema));
  await writeGenerated(SCHEMA_JSON_OUTPUT, renderZoteroSchemaJson(schema));
  await writeGenerated(SCHEMA_MODEL_OUTPUT, renderZoteroModel(schema));

  console.log(
    `[gen:schema] schema version ${schema.version} -> ${ITEM_TYPES_OUTPUT}, ${SCHEMA_TABLES_OUTPUT}, ` +
      `${SCHEMA_JSON_OUTPUT}, ${SCHEMA_MODEL_OUTPUT} | ` +
      `itemTypes: ${itemTypeNames(schema).length} | creatorTypes: ${creatorTypeNames(schema).length} | ` +
      `fields: ${Object.values(itemTypeFields(schema)).flat().length} | ` +
      `baseFieldAliases: ${Object.keys(baseFieldAliases(schema)).length} | ` +
      `primaryCreatorTypes: ${Object.keys(primaryCreatorTypes(schema)).length}`,
  );
}

if (isEntryPoint(import.meta.url)) {
  await main();
}
