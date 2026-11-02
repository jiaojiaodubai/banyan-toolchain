# Performance baseline

This is a **repeatable smoke baseline**, not a CI gate. Wall-clock time depends
on the machine, the Node version and the load of the day; a release candidate
should compare medians on the same machine instead of turning one absolute value
into a contract.

## Running

```bash
pnpm bench
```

Script: [scripts/bench.mjs](../scripts/bench.mjs). It calls the real `src/`
implementations directly:

- `createStyle` + `generate()`: typical output for 100 citations;
- `createGenerateOutputNormalizer`: normalization of an 80-deep nested `style`
  Unit;
- `isZoteroField` / `resolveZoteroField`: amortized cost of the schema constant
  lookups.

The script only prints a table and asserts nothing; a failure surfaces as a
non-zero exit code.

## Reference sample

2026-10-21, Windows, Node 22.19.0, one run on the development machine (magnitude
only):

| Scenario                        | Iterations | Median        | Mean          | Min / Max       |
| ------------------------------- | ---------- | ------------- | ------------- | --------------- |
| `generate()`, 100 citations     | 20         | 1.81 ms       | 2.12 ms       | 1.32 / 6.40 ms  |
| normalize, 80-deep nested style | 50         | 0.104 ms      | 0.115 ms      | 0.056 / 0.30 ms |
| schema query, 2 per iteration   | 200,000    | 48.7 ns/query | 48.7 ns/query | —               |

A second independent run the same day produced `2.74 ms / 0.148 ms / 96.3 ns`
(same Windows machine, different load). The magnitude agrees while the absolute
numbers differ, which is exactly why the table is only useful for same-machine
before/after comparison.

## How to use it

- When a change may affect a hot path, run the benchmark before and after on the
  same machine and compare medians;
- if a scenario's median rises more than 20% across two consecutive releases,
  find out why before accepting it;
- keep the benchmark out of CI: shared-runner noise turns it into a false
  failure; CI only covers `lint:check`, `test` and `check:dist`.
- Real Zotero/Gecko performance still has to be measured in the target host;
  this measures the core implementation on a Node host.
