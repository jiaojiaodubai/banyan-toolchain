# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
the versioning policy below.

## [0.1.0] - 2026-10-27

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
- CLI: `run`, `unit`, `items validate|dump|schema`, `rdf dump|build`.
- HTML conformance fixtures, deterministic snapshots and two end-to-end style
  checks (minimal style plus a bundled GB/T 7714-2025 preset).
- Public TypeScript API for test data, contexts, style execution, rendering and
  snapshots.
- Resolves `@banyan/core` and `eslint-plugin-banyan-style` through workspace
  links, including the shared diagnostic ids.
- Exposes `src/index.ts` as its package entry (and `./src/*`) because the style
  library imports the source entry explicitly under `tsx`.

### Security

- The default in-process runner is documented as a correctness boundary;
  untrusted styles must use `--isolated` or an external container.

## Versioning

This project is pre-1.0. Minor versions may change the public API; patch
versions are compatible fixes. Every contract change is recorded here.
