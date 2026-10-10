# `translate-sr-en` — Serbian to English

A `model` pack (ADR-091) for the translator module's sentence translation. It
carries **no code**: the Bergamot WASM engine ships with the app, and this pack
holds Mozilla's `tiny` Serbian→English model.

## What it contains

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `model.bin` | 17 141 051 | `99c44e9690a7ed2c1f13468765c3b1db2b8a8ae739980e4056d45dca613a1966` |
| `shortlist.bin` | 4 628 048 | `476d9731a1fd44811466abf2292523f11eaad57f0fb7a5cd30391e7720c7071a` |
| `vocab.spm` | 822 509 | `5cdbad076c8f5b11e3342f5011e9f56f22558523ca82aec9bab621ddc7614bdc` |
| `LICENSE.txt` | 16 725 | Mozilla's MPL-2.0 text, shipped unchanged |
| `NOTICE.txt` | — | names every file with the name Mozilla publishes it under, its version and its hash |

**Measured size: 22 591 608 bytes** of content (the three model files; the pack
also carries the licence and the notice). Rebuilt 2026-10-10 from
`%TEMP%\nexus-pack-cache\translate-sr-en`.

The three files are Mozilla's objects at
`models/sr-en/spring-2024_H5GCfsx4SnqOP4YFIQdkdA/exported/`, downloaded gzipped
(15 251 032 bytes in total) and stored decompressed and otherwise unmodified.

## Sources and licences

Every source is listed in [`sources.json`](../../scripts/packs/translate-sr-en/sources.json)
with its URL, the date it was first fetched, its SHA-256, its licence and the
quoted sentence that states that licence. The registry's entry for this pair:
architecture `tiny`, `releaseStatus` null, evaluated on flores200-plus at BLEU
36.6054 / chrF2 64.7233 / COMET22 0.8501. There is one build for the pair, so
pinning the pair and pinning the object directory are the same act.

- **Licence: MPL-2.0.** Mozilla states, in `mozilla/translations`'s README, "The
  model files are distributed under the MPL 2.0 license."
- The engine is MPL-2.0 too (`@browsermt/bergamot-translator` 0.4.9), but its
  notice is the app's: the engine ships in the installer, not in a pack.
- Nothing from `data.statmt.org` (the legacy models are CC-BY-SA-4.0) and nothing
  from Argos (no Serbian pair, no licence in its packages) is used.

## How to rebuild it

```bash
node scripts/packs/translate-sr-en/build.mjs
```

The builder downloads Mozilla's registry, its delivery records, the model
repository's README and licence, and the three model objects into
`%TEMP%\nexus-pack-cache\translate-sr-en\`; verifies every file's size and
SHA-256 against Mozilla's own record; cross-checks the registry against the
record so a pinned directory and a pinned version cannot describe two different
builds; writes the pack folder and `translate-sr-en.meta.json` to
`%TEMP%\nexus-packs\`; and rewrites `sources.json`. Re-running reuses the cache
and re-verifies every hash.

The maintainer then signs the folder:

```bash
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\translate-sr-en \
  --meta %TEMP%\nexus-packs\translate-sr-en.meta.json --key <release-key.pem>
```
