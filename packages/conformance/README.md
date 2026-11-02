# @banyan/conformance

Canonical fixtures that run through both Banyan executors — the first-party
ESLint plugin and the `@banyan/core` runtime — and compare their diagnostic
identifiers.

The corpus pins the shared contract where drift becomes observable. A fixture
never asserts English prose or source locations; those belong to the executor.
It asserts the set of stable diagnostic ids each executor produced for the same
declaration.

## Fixture format

Each `fixtures/*.json` file is one declaration:

```json
{
  "id": "state-trim-collision",
  "description": "State keys are trimmed; a whitespace spelling and a collision are reported by both executors.",
  "source": [
    "const STYLE_OPTIONS = [{ id: 'mode', kind: 'state', states: { ' auto ': 'Auto', auto: 'Auto again' }, defaultValue: 'auto' }];",
    "function generate() { return { citations: [], bibliography: [] }; }"
  ],
  "expect": {
    "runtime": ["param.states.key.whitespace", "param.states.key.duplicate"],
    "lint": ["param.states.key.whitespace", "param.states.key.duplicate"]
  }
}
```

- `source` is the style script, split into lines so the fixture stays readable.
- `expect.lint` is what the lint bundle reports after each rule message is
  mapped to its contract diagnostic id; a message without a mapping fails the
  suite.
- `expect.runtime` is what `style.diagnostics` reports from the validation
  phases (`params`, `field-presets`, `item-field-validators`).

## What the suite checks

- Every fixture produces exactly the expected identifier set in both executors.
- The lint side emits no rule message without a contract diagnostic id.
- The contract's generated facts match the core (`zoteroItemTypes`,
  `cslNameVariables`), and the denied preset keys match the lint package's.
- The lint bundle imports neither `@banyan/core` nor ESLint and inlines the
  contract facts.

## Commands

```bash
pnpm parity                              # this package's suite
pnpm --filter @banyan/conformance test   # the same suite
pnpm test:eslint10                       # replay the corpus on ESLint 10
```

Add a fixture by dropping one JSON file into `fixtures/`; there is no index to
update.
