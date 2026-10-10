# `translate-en-bs` — English to Bosnian

A `model` pack (ADR-091) for the translator module's sentence translation. It
carries **no code**: the Bergamot WASM engine ships with the app, and this pack
holds Mozilla's `base-memory` English→Bosnian model.

## What it contains

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `model.bin` | 31 561 787 | `27575113fffad6c45a0bad36bd1823c4f319ed30f65ec134815b67bdae0d9f8d` |
| `shortlist.bin` | 3 214 628 | `6847523f4d5df9425cda606e73f404c07e19452dac7659bdcc92743c46cba3c0` |
| `vocab.spm` | 823 444 | `dfed9c3e08e85a22feac7748a20fa981dca94f358115af2f45d704b9cc944cc8` |
| `LICENSE.txt` | 16 725 | Mozilla's MPL-2.0 text, shipped unchanged |
| `NOTICE.txt` | — | names every file with the name Mozilla publishes it under, its version and its hash |

**Measured size: 35 599 859 bytes** of content. Rebuilt 2026-10-10 from
`%TEMP%\nexus-pack-cache\translate-en-bs`.

The three files are Mozilla's objects at
`models/en-bs/hbs-topk10_HBBkp2ozSYaY9f7WVGRtpA/exported/`, downloaded gzipped
(25 027 895 bytes in total) and stored decompressed and otherwise unmodified.

## Sources and licences

Every source is in [`sources.json`](../../scripts/packs/translate-en-bs/sources.json).
Registry metrics for the pinned build: architecture `base-memory`,
`releaseStatus` Release, flores200-plus BLEU 31.9563 / chrF2 61.4905 / COMET22
0.896.

- **Licence: MPL-2.0** — "The model files are distributed under the MPL 2.0
  license." (`mozilla/translations` README).
- The engine's own MPL-2.0 notice belongs to the app, which ships the engine.

## How to rebuild it

```bash
node scripts/packs/translate-en-bs/build.mjs
```

Then sign the folder with `scripts/pack-sign.mjs` and
`%TEMP%\nexus-packs\translate-en-bs.meta.json`.
