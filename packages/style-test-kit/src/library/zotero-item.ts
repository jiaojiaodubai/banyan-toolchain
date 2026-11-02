/**
 * Fake `Zotero.Item`: the slice of the Zotero item API the citation pipeline
 * reads — `toJSON`, `getField`, `firstCreator`, `id`, `uri`,
 * `deleted`, `getRelations`, `isRegularItem` — built from parsed RDF records
 * or hand-written JSON.
 *
 * Field access mirrors Zotero's: base fields resolve to the type's own field
 * (`date` on a patent is `issueDate`, `publicationTitle` on a bookSection is
 * `bookTitle`), and `year` is extracted from that date field.
 */
import type { RdfCreator } from "../rdf/parse";
import { specificFieldsForBase } from "../banyan";
import { dateFieldOf } from "./zotero-fields";
import { computeFirstCreator } from "./first-creator";
import type { LibraryItem } from "./library-item";

export type ZoteroItemRecord = {
  itemType: string;
  key?: string;
  fields: Record<string, string>;
  creators: RdfCreator[];
  tags?: string[];
  relations?: Record<string, string[]>;
};

export type FakeZoteroItemOptions = {
  /** Host-local id (1-based, document order by default). */
  id: number;
  /** Durable reference contexts cite (`#item_*` here). */
  uri: string;
  firstCreator?: { andJoiner?: string; etAl?: string };
};

export class FakeZoteroItem implements LibraryItem {
  readonly id: number;
  readonly key: string;
  /** The `z:uri`-style durable reference contexts cite (`#item_*` here). */
  readonly uri: string;
  private readonly record: ZoteroItemRecord;
  private readonly firstCreatorOptions: FakeZoteroItemOptions["firstCreator"];

  constructor(record: ZoteroItemRecord, options: FakeZoteroItemOptions) {
    this.record = record;
    this.id = options.id;
    this.uri = options.uri;
    this.key = record.key ?? `TESTKEY${String(options.id).padStart(8, "0")}`;
    this.firstCreatorOptions = options.firstCreator;
  }

  get itemType(): string {
    return this.record.itemType;
  }

  get deleted(): boolean {
    return false;
  }

  get relations(): Record<string, string[]> {
    return this.record.relations ?? {};
  }

  get firstCreator(): string {
    // A simple JSON database may state the value directly; RDF cannot.
    const explicit = this.record.fields.firstCreator;
    if (explicit) return explicit;
    return computeFirstCreator(
      this.itemType,
      this.record.creators,
      this.firstCreatorOptions,
    );
  }

  /** The item's date as Zotero stores it (`issueDate` on a patent). */
  get date(): string {
    // Accept the canonical `date` too: a JSON record writes Banyan fields
    // (where `date` is base-normalized), while RDF writes the Zotero field.
    return (
      this.record.fields[dateFieldOf(this.itemType)] ??
      this.record.fields.date ??
      ""
    );
  }

  isRegularItem(): boolean {
    return true;
  }

  getRelations(): Record<string, string[]> {
    return { ...this.relations };
  }

  /**
   * Field access as Zotero's `Zotero.Item.getField` behaves: base fields
   * resolve to the type's field, `year` and `firstCreator` are computed, and
   * missing fields read as `""`.
   */
  getField(name: string): string {
    switch (name) {
      case "year": {
        // An explicit year wins; otherwise derive it from the date.
        const explicit = this.record.fields.year;
        if (explicit) return explicit;
        const match = /\d{4}/.exec(this.date);
        return match ? match[0] : "";
      }
      case "date":
        return this.date;
      case "firstCreator":
        return this.firstCreator;
      case "itemType":
        return this.itemType;
      default:
        break;
    }

    const direct = this.record.fields[name];
    if (direct !== undefined) return direct;

    // Base field without an own value: use the type-specific field, the way
    // Zotero's base-mapped lookup does.
    for (const specific of specificFieldsForBase(this.itemType, name)) {
      const value = this.record.fields[specific];
      if (value !== undefined) return value;
    }
    return "";
  }

  /** `Zotero.Item.toJSON()` shape, as the citation pipeline consumes it. */
  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      itemType: this.itemType,
      key: this.key,
      ...this.record.fields,
    };
    json.creators = this.record.creators.map((creator) => {
      if (creator.name !== undefined) {
        return { creatorType: creator.creatorType, name: creator.name };
      }
      return {
        creatorType: creator.creatorType,
        firstName: creator.firstName ?? "",
        lastName: creator.lastName ?? "",
      };
    });
    json.tags = (this.record.tags ?? []).map((tag) => ({ tag }));
    json.relations = { ...this.relations };
    json.uri = this.uri;
    return json;
  }
}
