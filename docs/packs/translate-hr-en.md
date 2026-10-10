# `translate-hr-en` — Croatian to English

A `model` pack (ADR-091) for the translator module's sentence translation. It
carries **no code**: the Bergamot WASM engine ships with the app, and this pack
holds Mozilla's `tiny` Croatian→English model.

## What it contains

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `model.bin` | 17 141 051 | `fa6c8220d3f1c41eb75b720859971dbe3acb6bf63691656c58faa4cdc28d918d` |
| `shortlist.bin` | 3 860 080 | `c9ef83603e41f78d41fa601ba9c7196be58518bd964bfe364f325665bc8bc7d0` |
| `vocab.spm` | 796 159 | `4e9cc10e8ff4a4ed64fc90b45835385690e55f49b40e8efe471597d2e3a9cd24` |
| `LICENSE.txt` | 16 725 | Mozilla's MPL-2.0 text, shipped unchanged |
| `NOTICE.txt` | — | names every file with the name Mozilla publishes it under, its version and its hash |

**Measured size: 21 797 290 bytes** of content. Rebuilt 2026-10-10 from
`%TEMP%\nexus-pack-cache\translate-hr-en`.

The three files are Mozilla's objects at
`models/hr-en/spring-2024_eIcYjCedS26HE07kVyt5Qw/exported/`, downloaded gzipped
(15 333 032 bytes in total) and stored decompressed and otherwise unmodified.

## Sources and licences

Every source is in [`sources.json`](../../scripts/packs/translate-hr-en/sources.json).
The registry's entry for this pair: architecture `tiny`, `releaseStatus` null —
it is the only build Mozilla lists for the pair — flores200-plus BLEU 33.8937 /
chrF2 61.3825 / COMET22 0.8559.

- **Licence: MPL-2.0** — "The model files are distributed under the MPL 2.0
  license." (`mozilla/translations` README).
- The engine's own MPL-2.0 notice belongs to the app, which ships the engine.

## How to rebuild it

```bash
node scripts/packs/translate-hr-en/build.mjs
```

Then sign the folder with `scripts/pack-sign.mjs` and
`%TEMP%\nexus-packs\translate-hr-en.meta.json`, as in
[`translate-sr-en.md`](translate-sr-en.md).
