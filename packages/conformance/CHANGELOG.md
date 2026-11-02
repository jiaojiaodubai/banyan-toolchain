# Changelog

All notable changes to `@banyan/conformance` are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The package is
private and versioned with the toolchain, so versions are for reading only.

## [0.1.0] - 2026-11-02

The first release.

### Added

- Canonical fixtures covering state-key trimming and collisions, missing and
  invalid state defaults, empty `states`, empty `STYLE_OPTIONS`, denied preset
  keys, reserved parameter ids, empty `ITEM_FIELD_VALIDATORS` groups and
  unknown item types.
- Fixtures for the dependency and resource declarations: export shape,
  duplicate and self ids, the dependency cap, escaping paths, invalid formats,
  non-function validators and the resource cap. Each is executed through both
  executors and compared by diagnostic identifier.
- Parity runner that executes each fixture through the built lint bundle and
  the real sandbox host and compares the stable diagnostic identifiers, and
  also collects findings whose source is `dependencies` or `resources`.
- Cross-package checks for the generated Zotero/CSL facts, the denied preset
  keys and the lint bundle boundary.
