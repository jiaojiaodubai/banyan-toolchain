# Coverage snapshot

`pnpm coverage` runs the unit and contract suites under `c8` (config:
[.c8rc.json](../.c8rc.json)) and writes `coverage/lcov.info` plus the text
report.

This is a **diagnostic**, not a target. A line is not worth a test just because
it is red; the questions are whether the uncovered branch represents a real
user-visible behavior and whether a regression there would be caught.

## Baseline

2026-10-21, on the 0.1.0 source tree:

| Scope             | Stmts  | Branch | Funcs  | Lines  |
| ----------------- | ------ | ------ | ------ | ------ |
| All `src/**/*.ts` | 90.98% | 82.70% | 86.96% | 90.98% |
| `src/validation`  | 91.17% | 81.59% | 96.87% | 91.17% |
| `src/units`       | 94.02% | 81.65% | 95.23% | 94.02% |
| `src/output`      | 91.41% | 82.47% | 100%   | 91.41% |
| `src/sandbox`     | 86.65% | 79.46% | 87.23% | 86.65% |
| `src/items`       | 69.60% | 90.90% | 67.30% | 69.60% |

## Known blind spots and interpretation

| File                         | Report                       | Interpretation                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/items/language.ts`      | 38.23%                       | Host-facing convenience, not on the generate path. The low number is real: display-name and BCP 47 branches need dedicated fixtures when language behavior changes.                                                                    |
| `src/sandbox/contextView.ts` | 58.08%                       | Misleading: the view is serialized with `Function.prototype.toString` and executed inside the sandbox, so V8 does not attribute the inner code. The actual behavior is covered by the contract test for readonly/undefined-free views. |
| `src/items/fields.ts`        | 55%                          | Convenience converters; many branches only run for uncommon item types. Add cases per type when the schema changes.                                                                                                                    |
| `src/validation/params.ts`   | 81.92% stmts / 70.46% branch | The remaining gaps are mostly warning/truncation paths for hostile declarations. These are good candidates for targeted tests, not blanket coverage.                                                                                   |
| `src/units/normalize.ts`     | 83.45%                       | Some invalid-unit branches are only reachable through intentionally malformed trees; the fuzzer exercises them, but fuzz is not counted by c8.                                                                                         |

## How to use it

- Prefer **diff coverage** for a change: did the new branch get a test, and is
  the test asserting behavior rather than just touching the line?
- Do not add a global threshold yet. The serialized `contextView` and generated
  schema make a single number misleading.
- When a file stays below ~60% for two consecutive changes, add a focused test
  instead of a coverage-only test.
- Exclude only code that is genuinely unreachable in the host (serialized
  fragments), and document the exclusion next to the reason.

Coverage is not run in CI; it is cheap enough to run locally before a release
candidate. `coverage/` is gitignored.
