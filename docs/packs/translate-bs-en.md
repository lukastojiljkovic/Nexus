# `translate-bs-en` — Bosnian to English

A `model` pack (ADR-091) for the translator module's sentence translation. It
carries **no code**: the Bergamot WASM engine ships with the app, and this pack
holds Mozilla's released `base-memory` Bosnian→English model.

## What it contains

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `model.bin` | 31 561 787 | `744c61ec0b987c44717f192fcebda7c2a1ac34f5cbfb56672771d28ff79c82c7` |
| `shortlist.bin` | 5 155 408 | `dccff06320cb87aaa6f93c246038b453d0d0c6f47fa3acd1162f104ac6a2c43f` |
| `vocab.spm` | 817 335 | `320561e2cef014a6d626a64822add3a387c91f609f23ea3b7f421d194075c14c` |
| `LICENSE.txt` | 16 725 | Mozilla's MPL-2.0 text, shipped unchanged |
| `NOTICE.txt` | — | names every file with the name Mozilla publishes it under, its version and its hash |

**Measured size: 37 534 530 bytes** of content. Rebuilt 2026-10-10 from
`%TEMP%\nexus-pack-cache\translate-bs-en`.

The three files are Mozilla's objects at
`models/hbs-en/hbs_d85wHYN_SUmGIqekvLSNjA/exported/`, downloaded gzipped
(25 938 230 bytes in total) and stored decompressed and otherwise unmodified.

## Two naming facts, because they are the trap here

1. **The registry calls the pair `hbs-en`**, the macrolanguage code, and its
   objects are `model.hbsen.*`, `lex.50.50.hbsen.*` and `vocab.hbsen.spm`; the
   delivery collection records the same three files under `bs`, as
   `model.bsen.*`. The builder takes the object name from the registry's path and
   the size and hash from the collection, and the hash is what proves they are
   one file. `NOTICE.txt` carries both names.
2. **The `bs-en` registry key is a different, Nightly build.** Mozilla lists a
   `tiny` `bs-en` model with `releaseStatus` Nightly alongside the released
   `hbs-en` one. This pack ships the released build; the Nightly one is not
   pinned, and its directory is not named in any builder here.

## Sources and licences

Every source is in [`sources.json`](../../scripts/packs/translate-bs-en/sources.json).
Registry metrics for the pinned build: flores200-plus BLEU 31.7529 / chrF2
59.8497 / COMET22 0.8157.

- **Licence: MPL-2.0** — "The model files are distributed under the MPL 2.0
  license." (`mozilla/translations` README).
- The engine's own MPL-2.0 notice belongs to the app, which ships the engine.

## How to rebuild it

```bash
node scripts/packs/translate-bs-en/build.mjs
```

Then sign the folder with `scripts/pack-sign.mjs` and
`%TEMP%\nexus-packs\translate-bs-en.meta.json`.
