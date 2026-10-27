# Bundled styles

- `numeric-minimal.js` — original minimal style for offline tests; MIT.
- `gb-t-7714-2025-numeric.js` — copy of the Banyan plugin's GB/T 7714-2025
  (Numeric) preset, authored by jiaojiaodubai and declared MIT in its `INFO`
  block. Source:
  <https://github.com/jiaojiaodubai/Banyan/blob/main/addon/content/styleEditor/presets/gb-t-7714-2025-numeric.js>.
  The local copy fixes the preset's date formatting to use UTC date parts, so
  the snapshot is the same in every timezone; see [NOTICE](../../NOTICE). It is
  test data, not part of the runtime. Prettier skips it.
