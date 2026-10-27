/**
 * The test library: source items -> Banyan items, plus the data-API stubs the
 * citation pipeline needs.
 *
 * Two sources feed it and both end at the same `Item` shape:
 *
 * - Zotero RDF is parsed into `FakeZoteroItem`s, then converted on demand (the
 *   mapping mirrors a Zotero host's item conversion, rebuilt on the core's
 *   normalization tools; `relations` never reach the style-facing item);
 * - the simple JSON database builds `Item`s directly (`DatabaseItem`), with
 *   multilingual groups kept on the library because relations are not part of
 *   the Banyan item shape.
 *
 * Warnings the core's helpers emit while binding an item (a malformed
 * `creators-ext` record, say) are collected on `diagnostics` instead of being
 * printed: the library is a data source, and presentation belongs to the CLI.
 */
import {
  assignBaseFieldAliases,
  bindCreatorsExt,
  createBanyanRuntimeError,
  parseExtraMap,
  stripExcludedFields,
  type Item,
  type ScriptItem,
  type StyleDiagnostic,
} from "../banyan";
import { parseZoteroRdf } from "../rdf/parse";
import {
  requireValidItemDatabase,
  type ItemDatabaseIssue,
} from "./item-database";
import { DatabaseItem } from "./database-item";
import { FakeZoteroItem } from "./zotero-item";
import type { LibraryItem } from "./library-item";
import type { FirstCreatorOptions } from "./first-creator";

/** The host extension the Zotero-compatible path uses for `z:uri` identity. */
export const ZOTERO_ITEM_URI_KEY = "z:uri" as const;

/** Predicate Zotero/Banyan use to link a multilingual item group. */
export const MULTILINGUAL_PREDICATE = "banyan:multilingual";

/**
 * A Banyan item from the RDF path carries the durable `z:uri`; direct database
 * items deliberately do not (their id is the identity), so it is optional.
 */
export type ZoteroBanyanItem = Item & {
  [ZOTERO_ITEM_URI_KEY]?: string;
};

/**
 * Items a style never sees: Zotero's RDF export writes standalone notes and
 * both child and standalone attachments as items too (with `z:itemType`), and
 * `annotation` is item-like in newer versions. The core's item contract is
 * regular items only, so the RDF path drops them before building entries.
 */
const NON_REGULAR_ITEM_TYPES: ReadonlySet<string> = new Set([
  "attachment",
  "note",
  "annotation",
]);

export interface TestLibraryOptions {
  firstCreator?: FirstCreatorOptions;
  /**
   * Validation findings from the data source. Warnings become library
   * diagnostics; errors never reach here, because loaders refuse to build a
   * library from them.
   */
  issues?: readonly ItemDatabaseIssue[];
  /**
   * Multilingual groups from the JSON database (ids). The RDF path encodes the
   * same information as `banyan:multilingual` relations on its records.
   */
  multilingualGroups?: readonly (readonly string[])[];
}

export class TestLibrary {
  private readonly items: LibraryItem[] = [];
  private readonly byReference = new Map<string, LibraryItem>();
  private readonly databaseItems = new Map<string, DatabaseItem>();
  private readonly multilingualGroups = new Map<string, string[]>();
  private readonly banyanCache = new Map<number, ZoteroBanyanItem>();
  private readonly findings: StyleDiagnostic[] = [];

  constructor(
    entries: readonly LibraryItem[],
    options: TestLibraryOptions = {},
  ) {
    for (const issue of options.issues ?? []) {
      if (issue.severity !== "warning") continue;
      this.findings.push({
        severity: "warning",
        source: "items",
        code: "generate-input",
        message: `${issue.path ? `${issue.path}: ` : ""}${issue.message}`,
      });
    }

    for (const entry of entries) {
      this.items.push(entry);
      this.byReference.set(entry.key, entry);
      this.byReference.set(entry.uri, entry);
      if (entry instanceof DatabaseItem) {
        this.databaseItems.set(entry.banyan.id, entry);
        this.byReference.set(entry.banyan.id, entry);
      }
    }

    for (const group of options.multilingualGroups ?? []) {
      const members = group.filter((id) => this.databaseItems.has(id));
      if (members.length < 2) continue;
      for (const id of members) {
        this.multilingualGroups.set(
          id,
          members.filter((other) => other !== id),
        );
      }
    }
  }

  /** Parse a Zotero RDF document into a library. */
  static fromRdf(xml: string, options?: TestLibraryOptions): TestLibrary {
    const entries: LibraryItem[] = [];
    for (const record of parseZoteroRdf(xml)) {
      if (NON_REGULAR_ITEM_TYPES.has(record.itemType)) continue;
      entries.push(
        new FakeZoteroItem(record, {
          // Ids stay contiguous over the items a style can cite: skipping a
          // real export's attachments must not leave gaps in `--items 1,2`.
          id: entries.length + 1,
          uri: record.node,
          firstCreator: options?.firstCreator,
        }),
      );
    }
    return new TestLibrary(entries, options);
  }

  /**
   * Build a library directly from the simple Banyan JSON item database
   * (`./item-database.ts`). Throws with every validation error; warnings land in
   * `library.diagnostics`.
   */
  static fromItemDatabase(
    input: unknown,
    options?: TestLibraryOptions,
  ): TestLibrary {
    const parsed = requireValidItemDatabase(input);
    const entries = parsed.items.map(
      (item, index) => new DatabaseItem(item, index),
    );
    return new TestLibrary(entries, {
      ...options,
      issues: [...(options?.issues ?? []), ...parsed.issues],
      multilingualGroups: parsed.groups,
    });
  }

  /** Alias for {@link fromItemDatabase}: the source is a JSON document. */
  static fromJson(input: unknown, options?: TestLibraryOptions): TestLibrary {
    return TestLibrary.fromItemDatabase(input, options);
  }

  /** An empty library: useful for loading a style without test data. */
  static empty(options?: TestLibraryOptions): TestLibrary {
    return new TestLibrary([], options);
  }

  /** Warnings collected while loading/converting items (never printed here). */
  get diagnostics(): readonly StyleDiagnostic[] {
    return this.findings;
  }

  get all(): readonly LibraryItem[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  /**
   * Resolve an item by numeric id (RDF item order), by the RDF `key`/subject,
   * or by the Banyan id of a JSON database record.
   */
  get(reference: string | number): LibraryItem | undefined {
    if (typeof reference === "number") {
      return this.items.find((item) => item.id === reference);
    }
    return this.byReference.get(reference);
  }

  require(reference: string | number): LibraryItem {
    const item = this.get(reference);
    if (!item) {
      throw createBanyanRuntimeError(
        `The test library has no item ${JSON.stringify(reference)}.`,
        { code: "generate-input", sourcePath: "contexts" },
      );
    }
    return item;
  }

  /** Source item -> Banyan item (JSON entries are already one). */
  toBanyanItem(item: LibraryItem): ZoteroBanyanItem {
    if (item instanceof DatabaseItem) {
      return item.banyan as ZoteroBanyanItem;
    }
    const cached = this.banyanCache.get(item.id);
    if (cached) return cached;

    const json = item.toJSON() as Record<string, unknown>;
    stripExcludedFields(json);
    assignBaseFieldAliases(String(json.itemType ?? ""), json);

    // The Banyan item id is a string by contract; the host-local numeric id is
    // encoded once, here.
    json.id = String(item.id);
    json[ZOTERO_ITEM_URI_KEY] = item.uri;
    json.year = item.getField("year");
    json.firstCreator = item.getField("firstCreator");

    // Host record identity is never style-facing: styles must use `item.id`,
    // not the Zotero-private `key`, so the sandbox items stay host-agnostic
    // (styles that read `item.key` get "", as in a Zotero host).
    delete json.key;
    delete json.uri;
    delete json.relations;

    const extraText = typeof json.extra === "string" ? json.extra : "";
    json.extra = parseExtraMap(extraText);
    bindCreatorsExt(
      json as unknown as Pick<Item, "extra" | "creators">,
      (message) => {
        this.findings.push({
          severity: "warning",
          source: "items",
          code: "generate-input",
          message,
        });
      },
    );

    const rawTags = Array.isArray(json.tags) ? json.tags : [];
    json.tags = rawTags
      .map((tag) =>
        tag && typeof tag === "object"
          ? String((tag as { tag?: unknown }).tag ?? "")
          : "",
      )
      .filter(Boolean);

    const banyan = json as unknown as ZoteroBanyanItem;
    this.banyanCache.set(item.id, banyan);
    return banyan;
  }

  toBanyanItems(): ZoteroBanyanItem[] {
    return this.items.map((item) => this.toBanyanItem(item));
  }

  /**
   * Host capability implementation: resolve the multilingual group of a style
   * item. JSON databases keep explicit groups keyed by Banyan id; the RDF path
   * walks `banyan:multilingual` relations through the durable `z:uri`.
   */
  resolveMultilingualItems(item: ScriptItem): ZoteroBanyanItem[] {
    if (typeof item.id === "string" && this.databaseItems.has(item.id)) {
      return (this.multilingualGroups.get(item.id) ?? [])
        .map((id) => this.databaseItems.get(id))
        .filter((entry): entry is DatabaseItem => Boolean(entry))
        .map((entry) => entry.banyan as ZoteroBanyanItem);
    }

    const source = this.resolveFromScriptItem(item);
    if (!source) return [];
    const targets = source.relations[MULTILINGUAL_PREDICATE] ?? [];
    const resolved: ZoteroBanyanItem[] = [];
    for (const uri of targets) {
      const target = this.byReference.get(uri);
      if (!target || target.id === source.id) continue;
      resolved.push(this.toBanyanItem(target));
    }
    return resolved;
  }

  private resolveFromScriptItem(item: ScriptItem): FakeZoteroItem | undefined {
    const uri = (item as Record<string, unknown>)[ZOTERO_ITEM_URI_KEY];
    if (typeof uri === "string" && uri) {
      const found = this.byReference.get(uri);
      if (found instanceof FakeZoteroItem) return found;
    }
    if (typeof item.id === "string" && item.id) {
      const id = item.id;
      const found = this.items.find(
        (candidate) =>
          candidate instanceof FakeZoteroItem && String(candidate.id) === id,
      );
      return found instanceof FakeZoteroItem ? found : undefined;
    }
    return undefined;
  }
}
