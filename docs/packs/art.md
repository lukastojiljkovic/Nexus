# `art-open-access` — the offline art gallery

**What it is.** A `dataset` pack for the Culture module's arts guide: a gallery of
300 public-domain works you can browse with no network. Paintings, drawings and
prints from The Met, the Rijksmuseum and Wikimedia Commons, each with its own
licence recorded, plus Serbian and Yugoslav painters whose work is out of
copyright.

**Built by.** `node scripts/packs/art/build.mjs`, which writes the pack folder to
`%TEMP%\nexus-packs\art-open-access\` and the metadata file that
`node scripts/pack-sign.mjs --dir … --meta … --key …` signs. The maintainer signs
it with the release key; the builder never sees that key.

## The layout, and the one field this pack adds

`art.json`, read by the Culture module's art reader:

```text
{ "layout": 1,
  "works": [ { "id", "title", "artist", "date", "medium"?, "museum", "credit",
               "licence", "image", "width", "height", "thumb" } ] }
```

`layout`, the field names and their order are the reader's, and this pack matches
them exactly. **`thumb` is the one addition**: `images/<id>-thumb.webp` beside
`images/<id>.webp`, on every work. A reader that does not know the key ignores
it; a reader that does gets a grid without decoding 300 full-size images.

The work's `id` is also its provenance: `met-<objectID>`, `rijks-<pid>`,
`wd-<QID>`. Layout 1 has no field for a source URL, so the id is the handle a
reader can resolve (the Met's object page, the Rijksmuseum's persistent
identifier and the Wikidata item are all derivable from it).

## The rule that picked these 300

Per-source quotas first — The Met 120, Smithsonian Open Access 60, the
Rijksmuseum 60, Wikimedia Commons 60 — and the remainder filled from whatever
the sources still hold, in that order, until the pack holds 300 works. A quota
rather than one global cut, because a pack that took its first 300 candidates
from the Met would be a Met catalogue, and the Serbian and Yugoslav painters that
make this gallery worth having for its audience live in one source only.

Then each source's own licence rule, applied per work:

| Source | Kept only | Works in the pack |
| --- | --- | --- |
| The Met Open Access | `isPublicDomain: true` **on the object record** (the search index is asked for it too, and disagrees with the record on 117 of the 360 records this build fetched) | 140 |
| Smithsonian Open Access | `metadata_usage.access === "CC0"` **and** `online_media.media[0].usage.access === "CC0"` | 0 (see below) |
| Rijksmuseum | the image's own rights statement on the `VisualItem` is the Public Domain Mark or CC0; CC BY 4.0 is dropped | 80 |
| Wikimedia Commons | the file's own licence tag is `pd` or `cc0`, **and** the painter's year of death is more than 70 years ago (the year is written into the licence string) | 80 |

Final contents: **300 works, 145 artists, 39 museums.** Licences per work:
`CC0-1.0` 144, `PDM-1.0` 80, `PD-Art (artist died YYYY)` 76 across nine death
years (1876, 1882, 1903, 1913, 1915, 1926, 1936, 1939, 1942).

**Serbian and Yugoslav artists: 15 works.** The painters are resolved by query —
citizenship of Serbia (Q403) or Yugoslavia (Q36704), occupation painter
(Q1028181), a date of death the 70-year line has passed (42 painters) — and their
paintings are then asked for by name: Ignjat Job (4 works), Franz Eisenhut (3),
Katarina Ivanović (2), Uroš Knežević, Poleksija Todorović, Mališa Glišić,
Vidosava Kovačević, Stevan Todorović and Petar Dobrović. Three of them hang in the
National Museum of Serbia, three in the Pavle Beljanski Memorial Collection and
one in the Gallery of Matica srpska.

## The Smithsonian arm, and why it contributed nothing today

The converter exists, its rules are tested from a real API response, and
`sources.json` records both of the reasons it could not run on 2026-10-10:

- **the metadata API answered HTTP 429 with `Retry-After: 66199`** (eighteen
  hours). `DEMO_KEY`, which api.data.gov issues for exactly this use, is shared
  by every client in the world that has not registered for one; a build with
  `SMITHSONIAN_API_KEY` set will get real answers.
- **`ids.si.edu`, where every Smithsonian image address points, presented an
  expired TLS certificate** (`CERT_HAS_EXPIRED`), so no image could be
  downloaded at all.

The build treats both as a source that is unavailable *this run*: it records the
reason in `sources.json` and in its own output and builds the pack from the other
three. Nothing is written as though the source had been consulted.

## Sources and their licence evidence

Every source, with the URL of the page the licence was read from and the sentence
on it. `sources.json` carries them with the date each page was fetched and the
SHA-256 of the bytes, and `sources.test.mjs` checks each quoted sentence against
a cut of the page that lives in `scripts/packs/art/fixtures/evidence/`.

| Source | Data | Licence evidence |
| --- | --- | --- |
| The Met Open Access | `collectionapi.metmuseum.org/public/collection/v1.1/search` and `/objects/<id>` | "To the extent possible under law, The Metropolitan Museum of Art has waived all copyright and related or neighboring rights to this dataset using the Creative Commons Zero license." — <https://metmuseum.github.io/> |
| Smithsonian Open Access | `api.si.edu/openaccess/api/v1.0/search` | "On February 25th, 2020, the Smithsonian released over 2.8 million CC0 interdisciplinary 2-D and 3-D images, related metadata, and additionally, research data from researches across the Smithsonian." — <https://registry.opendata.aws/smithsonian-open-access/> |
| Rijksmuseum | `data.rijksmuseum.nl/search/collection`, and Linked Art records under `id.rijksmuseum.nl` | "The Rijksmuseum provides Information and Data that are no longer, or have never been, protected by copyright with a Public Domain Mark (PDM) and/or the Creative Commons Zero 1.0 (CC0 1.0) Public Domain Dedication." — <https://data.rijksmuseum.nl/policy/information-and-data-policy> |
| Wikimedia Commons (PD-Art) | `commons.wikimedia.org/w/api.php` (`imageinfo`) | "The official position taken by the Wikimedia Foundation is that \"faithful reproductions of two-dimensional public domain works of art are public domain\"." — <https://commons.wikimedia.org/wiki/Template:PD-Art> |
| Wikidata | `query.wikidata.org/sparql` | "All data in Wikidata has a CC0 license." — <https://www.wikidata.org/wiki/Wikidata:Licensing> |

The Met's licence is read from its API documentation page rather than the
collection website's Open Access page, which answers automated requests with HTTP
429. The Smithsonian's is read from the AWS Open Data registry entry the
Smithsonian maintains for the same dataset, because `si.edu` answers automated
requests with a JavaScript challenge.

## Images

Longest side 2048 px, WebP, no metadata, and a 400 px thumbnail beside each.
sharp strips EXIF, IPTC, XMP and the ICC profile unless asked not to, and this
pipeline never asks; `images.test.mjs` asserts it on the output rather than
trusting the default. A source smaller than 2048 px is not enlarged (the
smallest shipped image has a longest side of 280 px); 240 of the 300 come out at
exactly 2048.

**The quality is 90, chosen by measurement.** The build encodes a ten-work sample
at five qualities, decodes each result and measures PSNR against a lossless PNG
of the same 2048 px image. The rule is the lowest quality whose mean PSNR clears
40 dB, which is the conventional line for "not visible at a viewing distance";
if none does, the highest candidate ships. Measured on 2026-10-10:

| Quality | Mean bytes | Mean PSNR |
| --- | --- | --- |
| 70 | 310,158 | 35.25 dB |
| 75 | 336,143 | 35.59 dB |
| 80 | 429,318 | 36.76 dB |
| 85 | 548,033 | 38.05 dB |
| 90 | 743,496 | 39.88 dB |

None of the five cleared 40 dB on this sample, so the rule took the fallback and
the pack ships at 90. The table is the honest answer to "why not 85": 85 measured
1.83 dB lower and about 26 % smaller, and a maintainer who prefers that trade
re-runs the build with `--quality 85` and says so.

## Measured size, and how long it took

| | |
| --- | --- |
| Works | 300 |
| `art.json` | 135,171 bytes |
| Images (300 WebP) | 196,782,176 bytes |
| Thumbnails (300 WebP) | 8,639,062 bytes |
| **Pack total** | **205,556,409 bytes (196.0 MiB)** |
| Files | 601 (300 images, 300 thumbnails, `art.json`) |
| Build time, warm cache | 111.4 s (the run `sources.json` records; an earlier run over the same cache took 151.5 s and produced byte-identical numbers) |
| Build time, first full run | 301.5 s (203 Met object records, 273 Rijksmuseum records, 6 Wikidata queries, and every image) |

Well inside the pack format's caps (4096 files, 64 GiB per file, 256 GiB per
pack).

## How to rebuild it

```text
node scripts/packs/art/build.mjs                 # the whole pack, cache reused
node scripts/packs/art/build.mjs --measure-only   # just the quality table
node scripts/packs/art/build.mjs --max 40 --pool 20   # a smoke run
node scripts/packs/art/build.mjs --quality 85     # skip the measurement
```

Downloads are cached under `%TEMP%\nexus-pack-cache\art-open-access\`, so a
re-run re-fetches only what it does not already have; the pack folder is
rewritten from scratch each time. Then:

```text
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\art-open-access \
  --meta %TEMP%\nexus-packs\art-open-access.meta.json --key <release-key.pem>
```

`SMITHSONIAN_API_KEY` in the environment replaces the shared `DEMO_KEY`. Nothing
in the builder is needed at runtime, and the app never fetches anything on this
pack's behalf.

## What was left out, and why

- **The Smithsonian arm's works**, for the two reasons above. Not a licence
  decision: the CSVs and the licence are CC0 and the converter is tested.
- **The Rijksmuseum's CC BY 4.0 images.** The pack's own licence is CC0/PD, and a
  mixed set would need per-file attribution records that layout 1 has no field
  for.
- **The Met's textile samples, corsets and other decorative objects.** The first
  full run of this pack filled half its Met arm with "Textile sample" and a
  corset: a department search without `medium` answers with whatever the
  department holds in object-id order. Every Met search now names its medium
  (`Paintings`, `Drawings`, `Prints`), and a medium the Met does not know matches
  nothing rather than everything.
- **Paintings whose only recorded date of creation is after their painter's
  death.** Wikidata has `A Burial at Ornans`, by Courbet (d. 1877), with a `P571`
  of 2020, and a gallery that printed that would be printing a date the source
  contradicts. The query drops the row, and a work with no date is left out by
  the converter.
- **Works whose source names no artist, and works whose source gives no date**,
  because the gallery groups by artist and places by date.
