# `translate-en-sr` — English to Serbian

A `model` pack (ADR-091) for the translator module's sentence translation. It
carries **no code**: the Bergamot WASM engine ships with the app, and this pack
holds Mozilla's `base-memory` English→Serbian model.

## What it contains

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `model.bin` | 31 561 787 | `d26e1c5a01f917c38ccda17d1bf116024ac4d988105e1bbf70bc5e8f9191c57a` |
| `shortlist.bin` | 2 542 096 | `b2ae22b4d7bc4295d25b8a55559ebbdbd8f728bc8de5c3d6f110bd44ce7d8962` |
| `vocab.spm` | 922 599 | `7f54ba1554b7b1a89299a0ec5950535432f062b50a5f8c9bcd664a2444fa882a` |
| `LICENSE.txt` | 16 725 | Mozilla's MPL-2.0 text, shipped unchanged |
| `NOTICE.txt` | — | names every file with the name Mozilla publishes it under, its version and its hash |

**Measured size: 35 026 482 bytes** of content. Rebuilt 2026-10-10 from
`%TEMP%\nexus-pack-cache\translate-en-sr`.

The three files are Mozilla's objects at
`models/en-sr/hbs-topk10_KZK68xhrQWWeK6xcMRtd9A/exported/`, downloaded gzipped
(24 737 527 bytes in total) and stored decompressed and otherwise unmodified.

## Sources and licences

Every source is in [`sources.json`](../../scripts/packs/translate-en-sr/sources.json)
with its URL, first-fetch date, SHA-256, licence and quoted licence evidence. The
registry's entry for this pair: architecture `base-memory`, `releaseStatus`
Release, flores200-plus BLEU 36.9971 / chrF2 63.9165 / COMET22 0.885.

- **Licence: MPL-2.0** — "The model files are distributed under the MPL 2.0
  license." (`mozilla/translations` README).
- The engine's own MPL-2.0 notice belongs to the app, which ships the engine.
- Nothing from `data.statmt.org` or Argos is used; see
  [`translate-sr-en.md`](translate-sr-en.md) for why.

## How to rebuild it

```bash
node scripts/packs/translate-en-sr/build.mjs
```

Same flow as its sibling: cache, verify each file against Mozilla's record,
cross-check the two records, write the pack and the metadata to `%TEMP%`, and
rewrite `sources.json`. Then:

```bash
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\translate-en-sr \
  --meta %TEMP%\nexus-packs\translate-en-sr.meta.json --key <release-key.pem>
```
