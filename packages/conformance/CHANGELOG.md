# Changelog

All notable changes to `@banyan/conformance` are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The package is
private and versioned with the toolchain, so versions are for reading only.

## [0.1.0] - 2026-10-27

### Added

- Canonical fixtures covering state-key trimming and collisions, missing and
  invalid state defaults, empty `states`, empty `STYLE_OPTIONS`, denied preset
  keys, reserved parameter ids, empty `ITEM_FIELD_VALIDATORS` groups and
  unknown item types.
- Parity runner that executes each fixture through the built lint bundle and
  the real sandbox host and compares the stable diagnostic identifiers.
- Cross-package checks for the generated Zotero/CSL facts, the denied preset
  keys and the lint bundle boundary.
