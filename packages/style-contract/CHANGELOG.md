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
  `MAX_RESOURCE_PATH_LENGTH`, the `STYLE_DEPENDENCIES` / `STYLE_RESOURCES`
  export names, `DEPENDENCY_KEYS`, `RESOURCE_KEYS` and `RESOURCE_FORMATS`.
- `isValidResourcePath()`: the pure path rule both executors apply (relative,
  `/`-separated, no empty/`.`/`..` segment, no backslash, no NUL, no scheme, no
  leading slash, length cap).
- Diagnostic identifiers for declarations (`dependency.*`, `resource.*`), runtime
  failures (`delegation.*`, `resource.*`) and the static advisory
  `lint.resource.undeclared-read`.
- `RUNTIME_ONLY_DIAGNOSTICS`, symmetric with `LINT_ONLY_DIAGNOSTICS`. The two
  sets are disjoint, and the contract tests require every dependency/resource
  identifier to be classified as declaration-class, lint-only or runtime-only.
- `EXECUTOR_POLICY` entries for `dependency.limit` and `resource.limit`
  (runtime warns and truncates, lint errors), like the existing cap overflows.
