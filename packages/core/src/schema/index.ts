/**
 * The authoritative data the core's behaviour rests on, exposed for hosts and
 * tools.
 *
 * Three shapes from three sources: the Zotero and official CSL schemas generated
 * by `pnpm gen:schema`, and the curated CSL-M schema in `./cslmSchema`. CSL and
 * CSL-M are kept separate on purpose: they are two schemas, and an application
 * chooses which one it supports instead of receiving a merged vocabulary.
 *
 * - **Constants** (`./zoteroSchema`, `./cslSchema`, `./cslmSchema`) — the fast
 *   path for membership questions a host asks per item: valid names, per-type
 *   fields, which base field a name means, which creator type Zotero promotes.
 *   Import these when that is all a host needs.
 * - **Models** (`./zoteroModel`, `./cslModel`, `./cslmSchema`) — the full
 *   per-item-type / vocabulary structure, compiled into the module graph:
 *   `ZOTERO_SCHEMA`, `CSL_SCHEMA` and the separate, complete `CSL_M_SCHEMA`.
 *   A host that converts its own item model, or generates items
 *   from scratch, reads these to know what fields a type has, which are aliases,
 *   which creator types it accepts and which one `firstCreator` uses. No file
 *   read, no JSON loader, no `resolveJsonModule` setting.
 * - **JSON assets** — the Zotero and CSL models as files, exposed as
 *   `@banyan/core/schema/zotero-schema.json` and
 *   `@banyan/core/schema/csl-schema.json` for tools in other languages (or for
 *   fact checks against the generated modules). The assets are deliberately
 *   **not** imported by this barrel: a host that wants data imports the models,
 *   a tool that wants files reads them.
 *
 * `./queries` answers the common questions over the constants
 * (`isZoteroField`, `isZoteroItemField`, `resolveZoteroField`,
 * `isCslVariable`, `isCslMItemType`, `isCslMOnlyVariable`, …). Names are
 * matched exactly and case-sensitively, like Zotero's own
 * `Zotero.ItemFields.getID`.
 */
export * from "./cslSchema";
export * from "./cslmSchema";
export * from "./zoteroSchema";
export * from "./cslModel";
export * from "./zoteroModel";
export * from "./queries";
