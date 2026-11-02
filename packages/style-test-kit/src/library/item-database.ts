/**
 * The simple Banyan item database: a JSON data source that is the Banyan item
 * shape, not a Zotero item shape.
 *
 * RDF stays the format that mirrors a real Zotero library, but it is a heavy
 * thing to write by hand. This module defines the direct alternative: a list of
 * item records whose keys are the fields a style reads (`id`, `itemType`,
 * `title`, `creators`, `tags`, `extra`, …), plus optional database-level
 * multilingual groups. No host keys, URIs or RDF relations: the loader builds
 * `Item` objects directly.
 *
 * ```json
 * {
 *   "items": [
 *     {
 *       "id": "zh",
 *       "itemType": "journalArticle",
 *       "title": "多语言文献的引用实践",
 *       "publicationTitle": "物理学报",
 *       "date": "2022-06-01",
 *       "language": "zh-CN",
 *       "creators": [{ "creatorType": "author", "lastName": "李", "firstName": "梅" }],
 *       "tags": ["multilingual"],
 *       "extra": { "language": "zh-CN" }
 *     },
 *     { "id": "en", "itemType": "journalArticle", "title": "…" }
 *   ],
 *   "multilingual": [["zh", "en"]]
 * }
 * ```
 *
 * `id` is optional (defaults to the 1-based position as a string) and is the
 * identity contexts cite and groups reference. `multilingual` is a list of
 * id groups; every id may appear in at most one group, which is checked. A
 * top-level array is accepted as shorthand for `{ "items": [...] }`.
 *
 * Field values are strings or numbers; `creators`, `tags` and `extra` use the
 * Banyan item types directly (`extra` is a map, not Zotero's line text).
 * `year` and `firstCreator` may be given; otherwise they are derived from
 * `date` and `creators`. Fields excluded from Banyan items (e.g.
 * `abstractNote`), unknown names and names not valid for the item type are
 * warnings: the record still loads. An `extra.type` that is not a CSL or CSL-M
 * item type is an error, because citeproc would treat the item as untyped.
 */
import {
  CREATORS_EXT_KEY,
  EXCLUDED_FIELDS,
  assignBaseFieldAliases,
  bindCreatorsExt,
  createBanyanRuntimeError,
  isCslItemType,
  isCslMItemType,
  isCslMVariable,
  isZoteroField,
  normalizeExtraKey,
  resolveZoteroField,
  stripExcludedFields,
  ZOTERO_ITEM_TYPES,
  type Creator,
  type ExtraMap,
  type Item,
} from "../banyan";
import { computeFirstCreator } from "./first-creator";

/** One database record, written in the Banyan item shape. */
export interface ItemDatabaseRecord {
  /** Banyan item id (defaults to the 1-based position as a string). */
  id?: string;
  itemType: string;
  creators?: Creator[];
  tags?: string[];
  /** Parsed extra map, not Zotero's `extra` line text. */
  extra?: ExtraMap;
  [field: string]: unknown;
}

export interface ItemDatabase {
  items: readonly ItemDatabaseRecord[];
  /**
   * Multilingual groups: ids of items that belong together. Every id may
   * appear in at most one group; a group needs at least two existing ids.
   */
  multilingual?: readonly (readonly string[])[];
}

/** The database object, or a bare record list (no multilingual groups). */
export type ItemDatabaseInput = ItemDatabase | readonly ItemDatabaseRecord[];

/** One validation finding; `path` is a JSON pointer-ish location. */
export interface ItemDatabaseIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ParsedItemDatabase {
  /** Banyan items in document order, ids assigned and values normalized. */
  items: Item[];
  /** Resolved multilingual groups (ids), ready for the library. */
  groups: string[][];
  issues: ItemDatabaseIssue[];
}

const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  "id",
  "itemType",
  "creators",
  "tags",
  "extra",
]);

/** Keys that belonged to the old Zotero-shaped format; name them explicitly. */
const REJECTED_KEYS: Readonly<Record<string, string>> = {
  key: "`key` is not part of the Banyan item shape; use `id`",
  uri: "`uri` is not part of the Banyan item shape; use `id`",
  relations:
    "`relations` is not part of the Banyan item shape; declare multilingual groups at the database level",
  multilingual:
    "declare multilingual groups at the database level, not on a record",
};

/** ItemBase fields that are not Zotero fields. */
const ITEM_BASE_FIELDS: ReadonlySet<string> = new Set(["year", "firstCreator"]);

/** Zotero exports these as items, but a style never sees them. */
const NON_REGULAR_ITEM_TYPES: ReadonlySet<string> = new Set([
  "attachment",
  "note",
  "annotation",
]);

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(["items", "multilingual"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

/**
 * The JSON Schema for this format. `schema/item-database.schema.json` is
 * generated from this object (see `scripts/gen-fixtures.ts`), so agents and
 * editors get a document while the runtime validator stays dependency-free.
 */
export const ITEM_DATABASE_SCHEMA: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Banyan simple item database",
  description:
    "A list of Banyan-item-shaped records. Unknown properties are item fields; multilingual groups are declared at the database level.",
  oneOf: [{ $ref: "#/$defs/arrayForm" }, { $ref: "#/$defs/objectForm" }],
  $defs: {
    arrayForm: {
      type: "array",
      items: { $ref: "#/$defs/record" },
    },
    objectForm: {
      type: "object",
      required: ["items"],
      properties: {
        items: { type: "array", items: { $ref: "#/$defs/record" } },
        multilingual: {
          type: "array",
          items: {
            type: "array",
            minItems: 2,
            items: { type: "string", minLength: 1 },
          },
        },
      },
      additionalProperties: false,
    },
    creator: {
      type: "object",
      required: ["creatorType"],
      properties: {
        creatorType: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        firstName: { type: "string" },
        lastName: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
      anyOf: [{ required: ["name"] }, { required: ["lastName"] }],
    },
    record: {
      type: "object",
      required: ["itemType"],
      properties: {
        id: { type: "string", minLength: 1 },
        itemType: { type: "string", minLength: 1 },
        creators: { type: "array", items: { $ref: "#/$defs/creator" } },
        tags: { type: "array", items: { type: "string", minLength: 1 } },
        extra: {
          type: "object",
          additionalProperties: {
            oneOf: [
              { type: "string" },
              { type: "number" },
              {
                type: "array",
                items: { oneOf: [{ type: "string" }, { type: "number" }] },
              },
            ],
          },
        },
      },
      additionalProperties: { type: ["string", "number"] },
    },
  },
};

function readTopLevel(
  input: unknown,
  issues: ItemDatabaseIssue[],
): {
  records: unknown[];
  multilingual: unknown;
} {
  if (Array.isArray(input)) return { records: input, multilingual: undefined };
  if (!isPlainObject(input)) {
    issues.push({
      severity: "error",
      path: "",
      message:
        "an item database must be an array of records or { items: [...], multilingual?: [...] }",
    });
    return { records: [], multilingual: undefined };
  }
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      issues.push({
        severity: "error",
        path: key,
        message: `unknown database key "${key}" (expected items/multilingual)`,
      });
    }
  }
  if (!Array.isArray(input.items)) {
    issues.push({
      severity: "error",
      path: "items",
      message: "an item database object needs an `items` array",
    });
    return { records: [], multilingual: input.multilingual };
  }
  return { records: input.items, multilingual: input.multilingual };
}

function readCreators(
  value: unknown,
  path: string,
  issues: ItemDatabaseIssue[],
): Creator[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push({
      severity: "error",
      path,
      message: "creators must be an array",
    });
    return [];
  }
  const creators: Creator[] = [];
  value.forEach((raw, index) => {
    const creatorPath = `${path}[${index}]`;
    if (!isPlainObject(raw)) {
      issues.push({
        severity: "error",
        path: creatorPath,
        message: "a creator must be an object",
      });
      return;
    }
    for (const key of Object.keys(raw)) {
      if (
        key !== "creatorType" &&
        key !== "name" &&
        key !== "firstName" &&
        key !== "lastName"
      ) {
        issues.push({
          severity: "warning",
          path: `${creatorPath}.${key}`,
          message: `unknown creator property "${key}"`,
        });
      }
    }
    const creatorType = raw.creatorType;
    if (typeof creatorType !== "string" || !creatorType.trim()) {
      issues.push({
        severity: "error",
        path: `${creatorPath}.creatorType`,
        message: "creatorType must be a non-empty string",
      });
      return;
    }
    if (raw.name !== undefined) {
      if (typeof raw.name !== "string" || !raw.name.trim()) {
        issues.push({
          severity: "error",
          path: `${creatorPath}.name`,
          message: "name must be a non-empty string",
        });
        return;
      }
      if (raw.firstName !== undefined || raw.lastName !== undefined) {
        issues.push({
          severity: "error",
          path: creatorPath,
          message: "use either `name` or `firstName`/`lastName`, not both",
        });
        return;
      }
      creators.push({
        creatorType: creatorType.trim() as Creator["creatorType"],
        name: raw.name,
      });
      return;
    }
    for (const key of ["firstName", "lastName"] as const) {
      const part = raw[key];
      if (part !== undefined && typeof part !== "string") {
        issues.push({
          severity: "error",
          path: `${creatorPath}.${key}`,
          message: `${key} must be a string`,
        });
        return;
      }
    }
    const lastName =
      typeof raw.lastName === "string" ? raw.lastName.trim() : "";
    if (!lastName) {
      issues.push({
        severity: "error",
        path: creatorPath,
        message: "a creator needs `name` or a non-empty `lastName`",
      });
      return;
    }
    creators.push({
      creatorType: creatorType.trim() as Creator["creatorType"],
      firstName: typeof raw.firstName === "string" ? raw.firstName : "",
      lastName,
    });
  });
  return creators;
}

function readTags(
  value: unknown,
  path: string,
  issues: ItemDatabaseIssue[],
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push({
      severity: "error",
      path,
      message: "tags must be an array of strings",
    });
    return [];
  }
  const tags: string[] = [];
  value.forEach((tag, index) => {
    if (typeof tag !== "string") {
      issues.push({
        severity: "error",
        path: `${path}[${index}]`,
        message: "a tag must be a string",
      });
      return;
    }
    if (tag.trim()) tags.push(tag);
  });
  return tags;
}

function readExtra(
  value: unknown,
  path: string,
  issues: ItemDatabaseIssue[],
): ExtraMap | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    issues.push({
      severity: "error",
      path: `${path}.extra`,
      message: "extra must be an object mapping keys to text values",
    });
    return undefined;
  }
  const extra: ExtraMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key.trim()) {
      issues.push({
        severity: "error",
        path: `${path}.extra`,
        message: "extra keys must be non-empty strings",
      });
      continue;
    }
    const values = Array.isArray(raw) ? raw : [raw];
    if (!values.length) continue;
    const converted: string[] = [];
    let valid = true;
    for (const item of values) {
      if (!isScalar(item)) {
        issues.push({
          severity: "error",
          path: `${path}.extra.${key}`,
          message: "extra values must be strings, numbers or arrays of them",
        });
        valid = false;
        break;
      }
      converted.push(String(item));
    }
    if (!valid) continue;
    extra[key] = Array.isArray(raw) ? converted : converted[0]!;
  }
  return Object.keys(extra).length ? extra : undefined;
}

/**
 * CSL variables whose canonical name uses an underscore. `extra` keys are
 * normalized to kebab-case, so the hyphen form is the same variable here.
 */
const CSL_UNDERSCORE_KEY_ALIASES: ReadonlySet<string> = new Set([
  "archive-collection",
  "archive-location",
]);

/**
 * Validate what `extra` means to citeproc. A Banyan record's `extra` is an
 * explicit map, so every entry is an extra line:
 *
 * - `type` is the one key that changes how the item is cited. A CSL or CSL-M
 *   item type is Zotero's documented escape hatch (warning); anything else
 *   leaves citeproc with an untyped item (error).
 * - Any other key citeproc does not read — and the sandbox does not consume,
 *   such as `creators-ext` — is ignored, so it gets a warning.
 */
function validateExtra(
  extra: ExtraMap,
  path: string,
  issues: ItemDatabaseIssue[],
): void {
  for (const [key, raw] of Object.entries(extra)) {
    const normalizedKey = normalizeExtraKey(key);
    const entryPath = `${path}.extra.${key}`;
    const values = Array.isArray(raw) ? raw : [raw];

    if (normalizedKey === "type") {
      for (const value of values) {
        if (isCslMItemType(value)) {
          issues.push({
            severity: "warning",
            path: entryPath,
            message: `extra.type "${value}" is a ${
              isCslItemType(value) ? "CSL" : "CSL-M"
            } item type; it overrides the CSL type citeproc uses for this item`,
          });
        } else {
          issues.push({
            severity: "error",
            path: entryPath,
            message: `extra.type "${value}" is not a CSL or CSL-M item type; citeproc will treat the item as untyped`,
          });
        }
      }
      continue;
    }

    if (
      isCslMVariable(normalizedKey) ||
      CSL_UNDERSCORE_KEY_ALIASES.has(normalizedKey) ||
      key === CREATORS_EXT_KEY
    ) {
      continue;
    }

    issues.push({
      severity: "warning",
      path: entryPath,
      message: isZoteroField(key)
        ? `extra key "${key}" is a Zotero field, not a CSL variable; citeproc ignores it here`
        : `extra key "${key}" is not a CSL/CSL-M variable or a Banyan key; citeproc ignores it`,
    });
  }
}

/** Validate and build one Banyan item. */
function readRecord(
  raw: unknown,
  index: number,
  issues: ItemDatabaseIssue[],
): Item | undefined {
  const path = `items[${index}]`;
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "error",
      path,
      message: "a record must be an object",
    });
    return undefined;
  }

  for (const [key, message] of Object.entries(REJECTED_KEYS)) {
    if (raw[key] !== undefined) {
      issues.push({ severity: "error", path: `${path}.${key}`, message });
    }
  }

  const itemType = raw.itemType;
  if (typeof itemType !== "string" || !itemType.trim()) {
    issues.push({
      severity: "error",
      path: `${path}.itemType`,
      message: "itemType must be a non-empty string",
    });
    return undefined;
  }
  if (NON_REGULAR_ITEM_TYPES.has(itemType)) {
    issues.push({
      severity: "error",
      path: `${path}.itemType`,
      message: `"${itemType}" is not a regular item; styles never see it`,
    });
    return undefined;
  }
  if (!ZOTERO_ITEM_TYPES.has(itemType)) {
    issues.push({
      severity: "warning",
      path: `${path}.itemType`,
      message: `unknown Zotero item type "${itemType}"`,
    });
  }

  let id = String(index + 1);
  if (raw.id !== undefined) {
    if (typeof raw.id !== "string" || !raw.id.trim()) {
      issues.push({
        severity: "error",
        path: `${path}.id`,
        message: "id must be a non-empty string",
      });
      return undefined;
    }
    id = raw.id.trim();
  }

  const creators = readCreators(raw.creators, `${path}.creators`, issues);
  const tags = readTags(raw.tags, `${path}.tags`, issues);
  const extra = readExtra(raw.extra, path, issues);
  if (extra) validateExtra(extra, path, issues);

  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (STRUCTURAL_KEYS.has(name)) continue;
    if (REJECTED_KEYS[name] !== undefined) continue;
    const fieldPath = `${path}.${name}`;
    if (!isScalar(value)) {
      issues.push({
        severity: "error",
        path: fieldPath,
        message: "field values must be strings or numbers",
      });
      continue;
    }
    if (typeof value === "string" && value === "") continue;
    fields[name] = String(value);
    if (ZOTERO_ITEM_TYPES.has(itemType) && !ITEM_BASE_FIELDS.has(name)) {
      const resolved = resolveZoteroField(itemType, name);
      if (resolved === null) {
        issues.push({
          severity: "warning",
          path: fieldPath,
          message: isZoteroField(name)
            ? `"${name}" is not a field of ${itemType}`
            : `"${name}" is not a known Zotero field`,
        });
      } else if (EXCLUDED_FIELDS.has(name)) {
        issues.push({
          severity: "warning",
          path: fieldPath,
          message: `"${name}" is dropped when the item is handed to a style`,
        });
      }
    }
  }

  // Base-field aliases are part of the Banyan item contract: a style reading
  // `publicationTitle` must see it even when the record wrote `bookTitle`.
  assignBaseFieldAliases(itemType, fields);
  stripExcludedFields(fields);
  const year = fields.year || /\d{4}/.exec(fields.date ?? "")?.[0];
  const firstCreator =
    fields.firstCreator || computeFirstCreator(itemType, creators);
  delete fields.year;
  delete fields.firstCreator;

  const item: Item = {
    id,
    itemType,
    creators,
    ...fields,
    ...(year ? { year } : {}),
    ...(firstCreator ? { firstCreator } : {}),
    ...(tags.length ? { tags } : {}),
    ...(extra ? { extra } : {}),
  } as Item;

  bindCreatorsExt(item, (message) => {
    issues.push({
      severity: "warning",
      path: `${path}.extra`,
      message,
    });
  });

  return item;
}

/**
 * Validate and load a database. Errors make a record (or a multilingual group)
 * unusable; warnings keep it and reach the library's diagnostics.
 */
export function parseItemDatabase(input: unknown): ParsedItemDatabase {
  const issues: ItemDatabaseIssue[] = [];
  const { records, multilingual } = readTopLevel(input, issues);
  const items: Item[] = [];
  const ids = new Set<string>();

  records.forEach((raw, index) => {
    const item = readRecord(raw, index, issues);
    if (!item) return;
    if (ids.has(item.id)) {
      issues.push({
        severity: "error",
        path: `items[${index}].id`,
        message: `duplicate item id "${item.id}"`,
      });
      return;
    }
    ids.add(item.id);
    items.push(item);
  });

  const groups: string[][] = [];
  if (multilingual !== undefined) {
    if (!Array.isArray(multilingual)) {
      issues.push({
        severity: "error",
        path: "multilingual",
        message: "multilingual must be an array of id groups",
      });
    } else {
      const grouped = new Set<string>();
      multilingual.forEach((rawGroup, groupIndex) => {
        const path = `multilingual[${groupIndex}]`;
        if (!Array.isArray(rawGroup)) {
          issues.push({
            severity: "error",
            path,
            message: "a multilingual group must be an array of item ids",
          });
          return;
        }
        const members: string[] = [];
        let valid = true;
        rawGroup.forEach((rawId, index) => {
          const memberPath = `${path}[${index}]`;
          if (typeof rawId !== "string" || !rawId.trim()) {
            issues.push({
              severity: "error",
              path: memberPath,
              message: "a multilingual group entry must be a non-empty id",
            });
            valid = false;
            return;
          }
          const id = rawId.trim();
          if (members.includes(id)) {
            issues.push({
              severity: "error",
              path: memberPath,
              message: `duplicate id "${id}" in one multilingual group`,
            });
            valid = false;
            return;
          }
          if (!ids.has(id)) {
            issues.push({
              severity: "error",
              path: memberPath,
              message: `unknown item id "${id}"`,
            });
            valid = false;
            return;
          }
          if (grouped.has(id)) {
            issues.push({
              severity: "error",
              path: memberPath,
              message: `id "${id}" already belongs to another multilingual group`,
            });
            valid = false;
            return;
          }
          members.push(id);
        });
        if (!valid) return;
        if (members.length < 2) {
          issues.push({
            severity: "warning",
            path,
            message: "a multilingual group needs at least two items; ignored",
          });
          return;
        }
        for (const id of members) grouped.add(id);
        groups.push(members);
      });
    }
  }

  return { items, groups, issues };
}

/** Validation-only view: the findings, without the items. */
export function validateItemDatabase(input: unknown): ItemDatabaseIssue[] {
  return parseItemDatabase(input).issues;
}

/** Turn issues into one readable message (for thrown loader errors). */
export function formatItemDatabaseIssues(
  issues: readonly ItemDatabaseIssue[],
): string {
  return issues
    .map(
      (issue) =>
        `- ${issue.severity}${issue.path ? ` at ${issue.path}` : ""}: ${issue.message}`,
    )
    .join("\n");
}

/** Throw the aggregated errors; used by loaders that cannot continue. */
export function requireValidItemDatabase(input: unknown): ParsedItemDatabase {
  const parsed = parseItemDatabase(input);
  const errors = parsed.issues.filter((issue) => issue.severity === "error");
  if (errors.length) {
    throw createBanyanRuntimeError(
      `Invalid item database:\n${formatItemDatabaseIssues(errors)}`,
      { code: "generate-input", sourcePath: "items" },
    );
  }
  return parsed;
}
