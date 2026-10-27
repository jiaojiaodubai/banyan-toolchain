# Lint / runtime contract architecture

## The two executors

Both executors answer questions about the same declaration, but they receive
different inputs and have different failure obligations.

|                | Lint                                  | Runtime                               |
| -------------- | ------------------------------------- | ------------------------------------- |
| Input          | AST from the style source             | sandbox value exported by the style   |
| Time           | authoring / CI                        | every style load                      |
| Unknown values | must stay `unknown`                   | resolved by execution                 |
| Failure        | report, do not crash the linter       | warn, fall back, never crash the host |
| Trust          | source is readable but may be dynamic | value is untrusted and cross-realm    |

The runtime is the final security authority. Disabling the linter must not make
a style able to break the host. The linter is author feedback; it may be
stricter where it can prove a violation.

## `@banyan/style-contract`

The contract owns:

- declaration field sets and caps (`MAX_STYLE_OPTIONS`, `MAX_STATES`,
  `MAX_STATE_SCAN`, `MAX_PRESETS`);
- reserved declaration keys and key normalization (`normalizeExtraKey`,
  `isValidExtraKey`, `isDeniedPresetKey`);
- denied preset keys, in raw and normalized form;
- the stable diagnostic catalogue;
- the reviewed executor policy table;
- generated Zotero/CSL facts and the schema revision.

It does not own AST traversal, sandbox bridging, author callbacks, warning
prose, ESLint rule names or Zotero host capabilities.

### Schema facts

`packages/core/scripts/genStyleContractFacts.mjs` projects the core's generated
Zotero/CSL tables into
`packages/style-contract/src/generated/schema-facts.ts`. The file is committed.
`pnpm gen:schema` regenerates it; `check:schema-facts` detects a stale copy.
Conformance asserts that the projection still equals the core's own sets.

The revision has the shape `zotero-<version>+csl-<hash>+cslm-<hash>` and is
copied into the lint bundle metadata and the toolchain manifest.

## Diagnostic protocol

An `ESLint` report has a `ruleId` and a `messageId`; a core warning has a
runtime phase in `StyleMessage.code`. Neither is a stable cross-executor name.
The contract adds a separate identity:

```ts
interface ContractFinding {
  diagnosticId: ContractDiagnosticId;
  path: Array<string | number>;
  data?: Record<string, unknown>;
}
```

- The runtime attaches `finding` to the `StyleMessage` and keeps `code` for the
  run phase (`style-load`, `generate`, ...).
- The linter maps `(rule, messageId)` to the same identifier through
  `RULE_MESSAGE_DIAGNOSTICS`. A test walks every rule message and fails if a
  mapping is missing.
- Conformance compares only `diagnosticId`, never English text, source
  locations or discovery order.

The catalogue is append-only while packages are private and becomes a public
interface if npm distribution is ever enabled. Renaming an identifier is a
breaking change even today, because fixtures and consumer reports persist it.

## Executor policy

`EXECUTOR_POLICY` records the deliberate differences. The important cases:

| Case                                          | Runtime                     | Lint    |
| --------------------------------------------- | --------------------------- | ------- |
| state key needs trimming                      | warning, then trim          | error   |
| two keys collide after trim                   | warning, first wins         | error   |
| missing enum default                          | warning, first state        | error   |
| enum default is numeric/boolean/empty/unknown | warning, first state        | error   |
| `states: {}`                                  | warning, degrade to boolean | error   |
| empty `STYLE_OPTIONS`                         | warning, ignore             | warning |
| empty validator group                         | warning, ignore             | error   |
| unknown item type                             | warning, ignore             | error   |
| static cap overflow                           | warning, truncate           | error   |
| denied preset key                             | warning, ignore             | error   |

Everything else is expected to agree on the identifier, not necessarily on the
severity or the text. Lint-only advisories (unbounded loops, direct recursion,
Zotero labels, option count) use `lint.*` identifiers and never appear as
runtime findings.

## Static values remain uncertain

The linter must not turn a dynamic computation into a definite verdict. The
contract's model for a projected value is:

```ts
type StaticValue<T> =
  | { kind: "known"; value: T }
  | { kind: "unknown"; reason: "dynamic" | "unsupported" };
```

Computed keys, spreads, calls and identifiers that cannot be resolved are
`unknown`, not invalid. A missing `defaultValue` is still definite (the property
is absent), but a dynamic `states` key makes the key set unknown and suppresses
the "default not in states" check. This is why the linter's checks are written
against a static projection rather than against runtime normalization.

## Bundle boundary

`packages/eslint-plugin/build.mjs` bundles the rules and the pure contract code
into `dist/eslint-plugin-banyan-style.mjs`. The bundle:

- may contain contract constants, generated facts and key normalization;
- must not import `@banyan/core`, `eslint`, or a Zotero host module;
- keeps Node built-ins (`node:fs`, `node:path`, `node:url`) external because the
  host provides them;
- includes the style-utils globals extractor, so Banyan copies one file instead
  of two.

Conformance reads the built bundle and rejects a regression that pulls in the
core runtime or ESLint. Banyan's `genStyleLint.mjs` copies the bundle plus a
build metadata file and records the bundle hash.

## Conformance corpus

`packages/conformance/fixtures/*.json` is deliberately small and stable:

- state trimming and trim collisions;
- missing/unknown enum defaults;
- empty states and empty style options;
- unknown item types and empty validator groups;
- denied preset keys and reserved parameter ids.

Each fixture is run through `ESLint` (the built plugin) and through
`createStyle` (the real Node sandbox host). The expected arrays are diagnostic
identifiers. The corpus is not a copy of the full style library; the separate
`banyan-styles` repository runs its complete suite against one toolchain
revision.
