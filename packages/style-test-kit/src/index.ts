/**
 * `@banyan/style-test-kit` public surface: everything an AI agent or test file
 * needs — RDF read/write, the test library, contexts building, style running
 * (in process or isolated), rendering and snapshots — with all core imports
 * funneled through `banyan.ts`.
 */
export * from "./banyan";

export * from "./rdf/namespaces";
export * from "./rdf/mappings";
export { parseGraph, extractItems, parseZoteroRdf } from "./rdf/parse";
export type { ParsedRdfItem, RdfCreator, RdfGraph, Triple } from "./rdf/parse";
export { serializeZoteroRdf, type SerializeOptions } from "./rdf/serialize";

export {
  TestLibrary,
  MULTILINGUAL_PREDICATE,
  ZOTERO_ITEM_URI_KEY,
  type TestLibraryOptions,
  type ZoteroBanyanItem,
} from "./library/library";
export type { LibraryItem } from "./library/library-item";
export { DatabaseItem } from "./library/database-item";
export { FakeZoteroItem, type ZoteroItemRecord } from "./library/zotero-item";
export {
  ITEM_DATABASE_SCHEMA,
  formatItemDatabaseIssues,
  parseItemDatabase,
  requireValidItemDatabase,
  validateItemDatabase,
  type ItemDatabase,
  type ItemDatabaseInput,
  type ItemDatabaseIssue,
  type ItemDatabaseRecord,
  type ParsedItemDatabase,
} from "./library/item-database";
export {
  BIDI_ISOLATE_END,
  BIDI_ISOLATE_START,
  computeFirstCreator,
  type FirstCreatorOptions,
} from "./library/first-creator";
export {
  containerTitleField,
  dateFieldOf,
  mediumFieldOf,
  numberFieldOf,
  publisherFieldOf,
  typeFieldOf,
} from "./library/zotero-fields";

export { parseHtml } from "./runtime/dom";
export {
  lintStyleSource,
  type LintStyleOptions,
  type StyleLintMessage,
} from "./lint";
export {
  createTestKitCapabilities,
  type CapabilityOptions,
} from "./runtime/capabilities";
export {
  createNodeHost,
  type CreateNodeHostOptions,
} from "./runtime/node-host";
export {
  createNodeSandboxRuntime,
  type NodeSandboxRuntimeOptions,
} from "./runtime/node-runtime";

export {
  buildContexts,
  type CiteSpec,
  type CitationSpec,
  type ContextsInput,
} from "./run/contexts";
export {
  createTestKitHost,
  loadStyle,
  readStyleFile,
  runStyle,
  type LoadedStyle,
  type LoadStyleOptions,
  type RunStyleOptions,
  type StyleRun,
  type TestKitHostOptions,
} from "./run/runner";
export {
  runStyleIsolated,
  type IsolationOptions,
  type IsolationReport,
  type IsolatedRun,
} from "./run/isolate";
export {
  renderDocument,
  renderFragment,
  renderResult,
  type RenderedCitation,
  type RenderedResult,
} from "./run/render";
export {
  buildSnapshotPayload,
  checkSnapshot,
  stringifyStable,
  writeSnapshot,
  type SnapshotCheck,
  type SnapshotPayload,
} from "./run/snapshot";
