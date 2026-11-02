/**
 * What the test library stores per source item.
 *
 * The Zotero RDF path keeps a `FakeZoteroItem` (so tests can inspect the
 * Zotero-facing API) and converts it to a Banyan item on demand. The simple
 * JSON database has no Zotero side: `DatabaseItem` wraps an already-built
 * Banyan item. Both expose the same small surface the library needs.
 */
export interface LibraryItem {
  /** Host-local numeric id (1-based order), used by `--items 1` and snapshots. */
  readonly id: number;
  /** Stable textual reference: the RDF `z:key`, or the Banyan item id. */
  readonly key: string;
  /** Durable reference: the RDF subject, or the Banyan item id. */
  readonly uri: string;
  readonly itemType: string;
  readonly deleted: boolean;
  readonly firstCreator: string;
  readonly date: string;
  isRegularItem(): boolean;
  getField(name: string): string;
  getRelations(): Record<string, string[]>;
  toJSON(): Record<string, unknown>;
}
