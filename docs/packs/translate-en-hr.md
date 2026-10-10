# `translate-en-hr` — English to Croatian

A `model` pack (ADR-091) for the translator module's sentence translation. It
carries **no code**: the Bergamot WASM engine ships with the app, and this pack
holds Mozilla's `tiny` English→Croatian model.

## What it contains

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `model.bin` | 17 141 051 | `29ba32235778da3e38cfeb0d7f36eaf8dc37c961ff8651d86f7cae7e29e97d88` |
| `shortlist.bin` | 3 319 896 | `b811d67aca11e12e6bd956c1b4a1e74c6162d71e9ac259bfff415fbb90c3f666` |
| `vocab.spm` | 796 935 | `7b75fe5ee12743c787a393489d8810adc3ca6cefe0142e8993227dd125d224b3` |
| `LICENSE.txt` | 16 725 | Mozilla's MPL-2.0 text, shipped unchanged |
| `NOTICE.txt` | — | names every file with the name Mozilla publishes it under, its version and its hash |

**Measured size: 21 257 882 bytes** of content. Rebuilt 2026-10-10 from
`%TEMP%\nexus-pack-cache\translate-en-hr`.

The three files are Mozilla's objects at
`models/en-hr/spring-2024_NcLX56D4SuSpByVVfuAHJQ/exported/`, downloaded gzipped
(14 636 363 bytes in total) and stored decompressed and otherwise unmodified.

## The one choice worth reading: why the `tiny` build and not the Release

Mozilla's registry lists **two** en→hr builds:

| Build | `releaseStatus` | Model bytes | Shortlist and vocabulary |
| --- | --- | --- | --- |
| `base-memory`, `hbs-topk10_PLHJ-…` | Release | 31 561 787 | **no published hash** |
| `tiny`, `spring-2024_NcLX…` | null | 17 141 051 | published, and this pack's files match them |

The Release build's model hash is in the registry, but its shortlist and
vocabulary appear in neither the registry nor the delivery collection — the
collection carries only the `tiny` build's record under version `1.0`. Shipping
the Release build would therefore mean hashing two of its three files against
nothing, which this project does not do (the rule is that every file's hash is
checked against Mozilla's own record). The builder enforces it rather than
trusting the author: pairing the Release directory with the version `1.0` record
is a build failure, and the fixture test pins exactly that case.

**What this costs.** The `tiny` build is the older and smaller of the two, so
English→Croatian is the smaller model rather than the released one, and it is
asymmetric with `translate-hr-en` only in that hr→en has no other build to
choose from. If Mozilla ever publishes the Release build's shortlist and
vocabulary hashes, this pack should be repinned to it — one `dir` in
`scripts/packs/translate-en-hr/build.mjs`.

## Sources and licences

Every source is in [`sources.json`](../../scripts/packs/translate-en-hr/sources.json).
Registry metrics for the pinned build: flores200-plus BLEU 29.6755 / chrF2
59.5303 (the Release build scores 32.7249 / 61.4944, which is the cost the
paragraph above states).

- **Licence: MPL-2.0** — "The model files are distributed under the MPL 2.0
  license." (`mozilla/translations` README).
- The engine's own MPL-2.0 notice belongs to the app, which ships the engine.

## How to rebuild it

```bash
node scripts/packs/translate-en-hr/build.mjs
```

Then sign the folder with `scripts/pack-sign.mjs` and
`%TEMP%\nexus-packs\translate-en-hr.meta.json`.
