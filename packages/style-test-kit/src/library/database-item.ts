/**
 * A library entry backed by a Banyan item that was built directly from a JSON
 * database record — no Zotero item in between.
 *
 * `key`/`uri` exist only to satisfy the common library surface; both are the
 * Banyan item id. Relations are not part of the Banyan item shape, so they are
 * empty here: multilingual groups live in the library and are resolved by id.
 */
import type { Item } from "../banyan";
import type { LibraryItem } from "./library-item";

export class DatabaseItem implements LibraryItem {
  /** Host-local numeric id (1-based order). */
  readonly id: number;
  /** The item a style sees, exactly as the database declared it. */
  readonly banyan: Item;

  constructor(item: Item, index: number) {
    this.banyan = item;
    this.id = index + 1;
  }

  get key(): string {
    return this.banyan.id;
  }

  get uri(): string {
    return this.banyan.id;
  }

  get itemType(): string {
    return this.banyan.itemType;
  }

  get deleted(): boolean {
    return false;
  }

  get relations(): Record<string, string[]> {
    return {};
  }

  get firstCreator(): string {
    return this.banyan.firstCreator ?? "";
  }

  get date(): string {
    return this.banyan.date ?? "";
  }

  isRegularItem(): boolean {
    return true;
  }

  getRelations(): Record<string, string[]> {
    return {};
  }

  getField(name: string): string {
    switch (name) {
      case "itemType":
        return this.banyan.itemType;
      case "year":
        return this.banyan.year ?? "";
      case "firstCreator":
        return this.banyan.firstCreator ?? "";
      default:
        break;
    }
    const value = this.banyan[name];
    return typeof value === "string" ? value : "";
  }

  toJSON(): Record<string, unknown> {
    return this.banyan as unknown as Record<string, unknown>;
  }
}
