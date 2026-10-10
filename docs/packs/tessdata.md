# Pack: `tessdata-fast`

The language models the **Scanner** module (`scanner`) reads text with. Without
this pack installed the module is on and usable as a page, and it says so where
the reading happens: recognition is the only thing that waits for it.

## What is in it

| file | what it is |
| --- | --- |
| `tessdata/eng.traineddata.gz` | English, `tessdata_fast` (8-bit integer LSTM) |
| `tessdata/srp.traineddata.gz` | Serbian, Cyrillic script |
| `tessdata/srp_latn.traineddata.gz` | Serbian, Latin script |
| `LICENSE-Apache-2.0.txt` | the upstream licence text, verbatim, as Apache-2.0 requires it to travel with the work |

Measured on 2026-10-10, on the machine that fetched them (raw sizes are
upstream's; gzip is Node's `zlib` at level 9, which is what the builder uses):

| file | raw bytes | packed bytes |
| --- | ---: | ---: |
| `eng.traineddata` | 4 113 088 | 1 962 155 |
| `srp.traineddata` | 2 149 931 | 925 594 |
| `srp_latn.traineddata` | 3 281 787 | 1 765 704 |
| `LICENSE` | 11 358 | 11 358 (copied verbatim, not gzipped) |
| **whole pack** | **9 556 164** | **4 664 811** (4.45 MiB) |

Three languages in ONE pack, rather than one pack each, because they are used
together: a Serbian receipt carries Latin script with English words on it, and a
Cyrillic label can carry a Latin number. The scanner's own default is
`srp_latn+eng`, with `srp` one checkbox away, so one pack is one install and one
`langPath` - and every language the user is not reading stays unshipped.

**`tessdata_fast`, not `tessdata_best`.** `fast` is the 8-bit integer family the
Tesseract project describes as "a speed/accuracy compromise" and the one Linux
distributions ship (upstream `tessdata_fast/README.md`); `best` is documented as
"slower" with Float models, and for these three languages it is 27.47 MiB
gzipped against 4.44 MiB. Nothing published measures `fast` against `best` for
`srp`/`srp_latn` on real Serbian documents, so the choice here is size and
speed, and the honest place to revisit it is a labelled sample of real scans.

## Where it comes from

| | |
| --- | --- |
| Source | `https://github.com/tesseract-ocr/tessdata_fast` |
| Files | `<lang>.traineddata` and `LICENSE` from the `main` branch |
| Fetched | 2026-10-10 |
| Licence | Apache-2.0 |

Every URL, its SHA-256 and the licence evidence are in
[`scripts/packs/tessdata/sources.json`](../../scripts/packs/tessdata/sources.json).
The evidence is the repository's own `LICENSE` (whose first lines are quoted in
that file) and GitHub's own licence record for the repository, which reports
`"spdx_id": "Apache-2.0"`.

**The conversion is gzip and nothing else.** tesseract.js reads
`<langPath>/<lang>.traineddata.gz` by default and decompresses in its worker, so
the models are byte-for-byte the bytes upstream publishes; no model is pruned,
re-quantised or edited, because a model this repository modified would be a
model nobody could check against upstream.

## How to rebuild it

```bash
node scripts/packs/tessdata/build.mjs
# then, with the release key:
node scripts/pack-sign.mjs \
  --dir   "$TEMP/nexus-packs/tessdata-fast" \
  --meta  "$TEMP/nexus-packs/tessdata-fast.meta.json" \
  --key   <release-key.pem>
```

The builder downloads into `%TEMP%\nexus-pack-cache\tessdata-fast\` and reuses
that cache; a cached file whose SHA-256 no longer matches `sources.json` is
re-downloaded rather than trusted. It writes the pack folder and the metadata
file **beside** it (a metadata file inside the folder would be a file the
manifest does not list, which the app refuses) under `%TEMP%\nexus-packs\`, and
prints every file's size, the total and the elapsed time. Re-running it produces
the same bytes, so the signed manifest's digests survive a rebuild.

The pack's `version` is `YYYY.MM.patch` for the month the sources were cut -
upstream publishes no releases for these models, so a date is the only version
that means anything about them - and `minAppVersion` is the app version the
scanner shipped in.

Tests: `node node_modules/vitest/vitest.mjs run --config vitest.scripts.config.mjs scripts/packs/tessdata`.
They convert a 4 KB fixture cut from the real `eng.traineddata` (Apache-2.0) in
a temp directory and assert the pack's layout, the round trip, the determinism,
the cache behaviour and that the metadata is one `pack-sign.mjs` accepts.
Nothing in them touches the network.
