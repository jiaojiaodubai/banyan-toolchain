# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
the versioning policy below.

## [0.1.0] - 2026-11-02

The first release.

### Added

- Offline style runner for Banyan styles, backed by the workspace
  `@banyan/core` and the same toolchain revision as the linter.
- Zotero RDF parser/serializer and a simple JSON item database with a generated
  JSON Schema, validation and multilingual groups.
- Test library with a Zotero-compatible item surface and Banyan item
  conversion helpers.
- Node sandbox runtime (`node:vm` + realm isolation) implementing the core
  host contract, with `parseHtml`, `readFile` and `resolveMultilingualItems`
  capabilities.
- Process-isolated runner with wall-clock, heap and output-size limits.
- CLI: `run`, `unit`, `items validate|dump|schema`, `rdf dump|build`, and
  `deps` (below).
- HTML conformance fixtures, deterministic snapshots and two end-to-end style
  checks (minimal style plus a bundled GB/T 7714-2025 preset).
- Public TypeScript API for test data, contexts, style execution, rendering and
  snapshots.
- Resolves `@banyan/core` and `eslint-plugin-banyan-style` through workspace
  links, including the shared diagnostic ids.
- Exposes `src/index.ts` as its package entry (and `./src/*`) because the style
  library imports the source entry explicitly under `tsx`.
- The optional `resolveStyle` host capability, wired through
  `createTestKitHost({ stylePaths })` and the repeatable `--style-path` CLI
  option: a `STYLE_DEPENDENCIES` id is resolved by `INFO.id` to
  `<dir>/style.js`, and the returned `readFile` is confined to that style's own
  directory with the same containment, symlink and size rules as `--style-dir`.
- The `deps` subcommand: indexes one or more style directories, prints the
  dependency graph, and reports duplicate/missing styles, cycles, chains past
  the three-style depth limit, and resources that are missing (`assets/<id>`),
  oversized or unparsable. Non-zero exit for CI.
- Public `analyzeDependencies()`, `indexStyles()` and
  `createTestKitStyleResolver()`, plus `STYLE_FILE_NAME` and
  `createConfinedReadFile()`.
- `deps` bounds the risk that indexing creates: each style's top level runs
  under a synchronous `evaluateTimeoutMs` budget (2 s by default), so a style
  that never returns is reported as one load failure instead of hanging the
  command. Issues and index failures carry a machine-readable `kind`
  (`load` / `duplicate-id`) instead of being classified by message wording, and
  a read refused by the host's own size cap is reported as
  `resource-too-large`, not `resource-missing`.
- Note-context specs for note-citation styles: `CitationSpec.noteType` accepts
  `"footnote"` / `"endnote"` (re-exporting the core's `NoteType`) and reaches
  `CitationContext` only when supplied, so in-text/legacy specs keep no
  `noteType`. Endnote specs use `page: 0` — the host's "no page semantics"
  sentinel — default to it when the page is omitted, and reject an explicit
  non-zero page; footnote and in-text/legacy specs keep the existing 1-based
  default page.

### Security

- The default in-process runner is documented as a correctness boundary;
  untrusted styles must use `--isolated` or an external container.

## Versioning

This project is pre-1.0. Minor versions may change the public API; patch
versions are compatible fixes. Every contract change is recorded here.
