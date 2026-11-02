# Contributing

## Setup

- Node.js ≥ 22.18
- pnpm 10

```sh
pnpm install
pnpm typecheck
pnpm test
```

`pnpm install` fetches `@banyan/core` from the GitHub commit pinned in
`package.json`. No sibling checkout is required.

## Before opening a pull request

Run the same checks CI runs:

```sh
pnpm typecheck
pnpm lint:check
pnpm test
pnpm e2e
pnpm e2e:minimal
```

If you changed a fixture model, regenerate the fixture set and commit the
result:

```sh
pnpm fixtures
```

Snapshots are generated data: update them with `pnpm e2e:update` /
`pnpm e2e:minimal:update`, review the diff, and never edit them by hand.

## Updating the core

`@banyan/core` is consumed as a pinned GitHub commit, not an npm release and
not a local link. To adopt a new core commit:

1. Update the `@banyan/core` specifier in `package.json` to the new commit.
2. Run `pnpm install` and commit the updated `pnpm-lock.yaml`.
3. Run the full check set above. Adapt host code where the core contract
   changed; do not keep compatibility shims for pre-1.0 core contracts.

For local core development, a temporary `pnpm link` is fine, but do not commit
the link or a `file:`/`link:` dependency.

## Comments and documentation

Comments should explain the code as it is now: invariants, trade-offs, and
non-obvious behaviour. Do not refer to unlanded plans, task names, review
rounds, chat instructions, or local checkout layout. Prefer a link to the
public contract or a short self-contained explanation.

## Licensing

By contributing, you agree that your contribution is licensed under
AGPL-3.0-or-later. New third-party code or fixtures need a compatible license
and an entry in [NOTICE](NOTICE).
