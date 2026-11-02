# Baseline snapshots

Generated, not hand-edited: `pnpm e2e:update` (preset style) and
`pnpm e2e:minimal:update` (the self-contained minimal style) rewrite them.

A snapshot holds the structured `StyleResult` (`text` + `marks`, never HTML
comparisons) plus the diagnostics of one run, serialized with sorted keys and LF
endings. They guard the core's default renderer against regressions; they are
**not** a cross-host contract (see `docs/usage.md`). `.prettierignore` keeps them
out of formatting so `prettier --check` cannot churn them.
