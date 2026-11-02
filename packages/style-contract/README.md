# @banyan/style-contract

Executor-neutral facts shared by the Banyan runtime and the first-party linter.

This package deliberately has no dependency on Node, ESLint, Zotero or the
sandbox. It owns:

- declaration caps, reserved keys, parameter field sets and extra-key
  normalization;
- the denied preset-key set and its normalized lookup form;
- the stable `ContractDiagnosticId` catalogue and `ContractFinding` shape;
- the reviewed `EXECUTOR_POLICY` table;
- generated Zotero/CSL schema facts and their `schemaRevision`.

The linter bundles the pure parts into its single ESM artifact; the runtime
imports them directly. See
[`docs/architecture/lint-runtime-contract.md`](../../docs/architecture/lint-runtime-contract.md)
for the design and the policy table.

Do not import this package from a host-specific module and do not add AST,
sandbox or warning-text concerns to it.
