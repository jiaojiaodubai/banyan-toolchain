# Fuzz smoke

[`scripts/fuzz.mjs`](../scripts/fuzz.mjs) is a deterministic smoke fuzzer for the
untrusted boundary. It is deliberately small enough to run locally in seconds,
but it checks the invariants that matter more than any individual fixture:

- every style input either produces a shaped result or rejects with a known
  `RuntimeCode`;
- a cyclic generate result, a throwing thenable, an async rejection with a
  non-Error value, deep markup, oversized text and malformed context shapes do
  not hang the run;
- no unhandled rejection escapes;
- `Object.prototype` and host global names are unchanged after the run.

## Run

```bash
pnpm fuzz
# more cases (still deterministic; the seed is fixed)
FUZZ_STYLE_CASES=500 FUZZ_NORMALIZE_CASES=500 pnpm fuzz
```

The seed is fixed in the script so a failure is reproducible. The corpus covers:

- malformed/contract-invalid style sources (`style-load` / `style-contract`);
- payload strings with prototype-chain entities, quoted attributes, deep
  markup, oversized text and unknown entities;
- cyclic and thenable generate outputs;
- invalid `CitationContext` arrays;
- random Unit trees fed to `normalizeGenerateResult` (depth/asset budgets,
  links, text-case forms, fallback/when branches).

## What it is not

- not a coverage-guided fuzzer; there is no mutation feedback loop;
- not a substitute for the real Zotero/Gecko acceptance run;
- not a performance test. It asserts termination within a per-case deadline,
  not latency.

The default case counts are a smoke check. A release candidate should run the
same script with a larger `FUZZ_*_CASES` value on the target host, and record
the seed and result next to the release notes.
