# Changelog

## [0.1.0] - 2026-11-02

The first release. The contract is the executor-neutral half of the toolchain,
so every entry below is a fact that `@banyan/core` and
`eslint-plugin-banyan-style` read instead of restating.

### Added

- Executor-neutral declaration facts: style-option/state/preset caps, reserved
  declaration keys, parameter field sets, denied preset keys, extra-key
  normalization and validation.
- Stable `ContractDiagnosticId` catalogue and `ContractFinding` shape.
- `EXECUTOR_POLICY`, documenting where lint is deliberately stricter than the
  runtime and what the runtime guarantees instead.
- Generated Zotero/CSL schema projection with a `schemaRevision`, produced by
  the core's schema generator and guarded by conformance parity.
- Dependency and resource facts: `MAX_STYLE_DEPENDENCIES`,
  `MAX_DELEGATION_DEPTH`, `MAX_DELEGATION_CALLS`, `DELEGATION_TIMEOUT_MS`,
  `MAX_STYLE_RESOURCES`, `MAX_RESOURCE_BYTES`, `RESOURCE_TIMEOUT_MS`,
  `MAX_RESOURCE_ID_LENGTH`, `RESOURCE_DIRECTORY` (the fixed `assets/`), the
  `STYLE_DEPENDENCIES` / `STYLE_RESOURCES` export names, `RESOURCE_KEYS` and
  `RESOURCE_FORMATS`.
- `isValidResourceId()`: the pure asset-name rule both executors apply (lowercase
  letters, digits and single hyphens, no extension, length cap); the id is also
  the file name under `assets/`.
- Citation-context note facts: `NOTE_TYPES` / `NoteType`, `NOTE_TYPE_FOOTNOTE`,
  `NOTE_TYPE_ENDNOTE`, `isNoteType()` and `NOTE_PAGE_SENTINEL` (`0`). A
  note-citation host reports footnotes and endnotes per context; endnote
  contexts carry the sentinel instead of a page because they are numbered
  continuously. The runtime validates with these facts and the linter uses them
  for the note-numbering advisories, so the kinds and the sentinel have one
  definition.
- `lint.note.page-grouping` and `lint.note.page-string`: lint-only advisories for
  note-citation styles that group notes by `context.page`, or stringify it and
  test it for truthiness, without an endnote branch. They are owner-visible
  author feedback only and never appear as runtime findings.
- Diagnostic identifiers for declarations (`dependency.*`, `resource.*`) and
  runtime failures (`delegation.*`, `resource.*`). `lint.resource.undeclared-read`
  is kept as a retired id (stored reports may name it) but no executor produces
  it now that the raw `read*` utilities are gone.
- `RUNTIME_ONLY_DIAGNOSTICS`, symmetric with `LINT_ONLY_DIAGNOSTICS`. The two
  sets are disjoint, and the contract tests require every dependency/resource
  identifier to be classified as declaration-class, lint-only or runtime-only.
- `EXECUTOR_POLICY` entries for `dependency.limit` and `resource.limit`
  (runtime warns and truncates, lint errors), like the existing cap overflows.
