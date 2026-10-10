# Pack: `map-serbia`

**Kind:** `map` · **Region:** Serbia (Geofabrik's own polygon for the country) ·
**Licence:** ODbL-1.0 · **Built by:**
`node scripts/packs/map-serbia/build.mjs`

One PMTiles archive of vector tiles, one style per theme, the place index the
search reads, the label file the map draws, the glyph ranges those labels need,
and the licence files. The app reads it offline through the `nx-pack://` scheme
(ADR-099).

## What is in it

| Path | What it is | Licence |
| --- | --- | --- |
| `maps.pmtiles` | Vector tiles, cut from the Protomaps basemap build for the region polygon, z0–15 | ODbL-1.0 (map data) |
| `style.dan.json`, `style.noc.json` | The style, one per theme, painted with the Nexus design tokens | our code; geometry layers BSD-3-Clause / CC0 |
| `places.json` | The search index: `name`, `nameCyr`, `nameEn`, `kind`, `lat`, `lon`, `population` | ODbL-1.0 |
| `labels.geojson` | What the map draws: `name`, `kind`, `minZoom` | ODbL-1.0 |
| `fonts/Noto Sans Regular/*.pbf` | 19 glyph ranges (Latin, Latin-1, punctuation, Greek, Cyrillic) | OFL-1.1 |
| `region.geojson` | The polygon the tiles were cut from | ODbL-1.0 |
| `ATTRIBUTION.txt`, `LICENSE-ODbL.txt`, `CHANGES.txt` | The notice, the licence text, and the exact commands | — |
| `sources.json` | Every source's URL, date, size and SHA-256 | — |
| `pack.json`, `pack.json.sig` | The signed manifest, written by `scripts/pack-sign.mjs` | — |

Measured sizes are printed by the build; the research run measured the input
Protomaps planet build at 138.7 GB and estimated a Serbia cut at ~350 MB, which
is why this pack is cut rather than assembled from a self-built tileset.

## The sources, and the evidence for each licence

Every entry below is in `sources.json` beside this file, with the URL of the page
that states the licence and the sentence on it quoted verbatim. A source without
that evidence is not used.

| Source | Licence | Evidence page |
| --- | --- | --- |
| Protomaps basemap daily build (`build.protomaps.com/<date>.pmtiles`) | ODbL-1.0 | `protomaps/docs` `basemaps/downloads.md`: "distributed as an [Open Database License](…) Produced Work (OpenStreetMap attribution required)" |
| Geofabrik Serbia extract (`download.geofabrik.de/europe/serbia-latest.osm.pbf`) | ODbL-1.0 | `download.geofabrik.de`: "License: ODbL 1.0" |
| Geofabrik index (`index-v1.json`) | ODbL-1.0 | same page |
| `@protomaps/basemaps` 5.7.2 | BSD-3-Clause (visual design CC0) | `protomaps/basemaps` `LICENSE.md` |
| `go-pmtiles` 1.31.2 (the CLI that cuts the region) | BSD-3-Clause | `protomaps/go-pmtiles` `LICENSE` |
| Noto Sans Regular glyphs (`protomaps.github.io/basemaps-assets`) | OFL-1.1 | `basemaps-assets` `fonts/OFL.txt`: "This Font Software is licensed under the SIL Open Font License, Version 1.1." |
| ODbL 1.0 text (`opendatacommons.org/licenses/odbl/1-0/`) | ODbL-1.0 | the page itself |

The tile CLI is a **build tool**: it is downloaded into
`%TEMP%/nexus-pack-cache/map-serbia/`, used, and left there. It is never shipped
inside the app and never committed.

## How to rebuild it

```bash
node scripts/packs/map-serbia/build.mjs                      # newest Protomaps build
node scripts/packs/map-serbia/build.mjs --build=20261009     # a named build
node scripts/packs/map-serbia/build.mjs --maxzoom=14         # roughly half the tiles

node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\map-serbia \
     --meta %TEMP%\nexus-packs\map-serbia.meta.json --key <release-key.pem>
```

The build downloads into `%TEMP%/nexus-pack-cache/map-serbia/` and **reuses what
is there**: the 240 MB extract is fetched once, the 138 GB planet build is never
fetched at all (only the region's byte ranges are), and a re-run prints what it
reused. It writes the pack to `%TEMP%/nexus-packs/map-serbia/`, prints every
step with the size it measured and the time it took, and **rewrites
`sources.json` inside the pack** with the date, size and SHA-256 of everything it
read.

The builder's own tests live beside it and need no network:

```bash
node node_modules/vitest/vitest.mjs run --config vitest.scripts.config.mjs scripts/packs/map-serbia
```

They are run against real fixtures: three `.pbf` files written by Osmosis and
osmium-tool (with the XML they were converted from), a cut of the style
`@protomaps/basemaps` generates, a cut of Geofabrik's index, and a cut of a real
Overpass answer for eight Serbian places. `fixtures/README.md` says where each
one came from and under which licence.

## What the builder changes, and what it does not

It **selects and converts**; it does not edit data. The tiles are the region's
own tiles, unmodified, taken by `pmtiles extract`. `places.json` and
`labels.geojson` are read out of the OpenStreetMap extract's `place` nodes —
names, coordinates, population — with rows left out (not rewritten) when they
are not a kind the app draws, carry no name, or state a name past the app's
bound. The counts are printed by the build and the same account is written into
the pack's `CHANGES.txt`.

The style IS ours: the geometry comes from `@protomaps/basemaps` with every
colour mapped onto a semantic token from `packages/tokens`, our own label layers
are added, and every address is rewritten to point into the pack. That is why
the pack ships a style at all, and why `assertLocalStyle` refuses one that would
fetch anything.

## Attribution, as the ODbL asks

The map shows `© OpenStreetMap contributors` and the licence with its address at
all times, in both languages (ADR-099 §8). The pack carries the notice, the ODbL
text and the source offer. Credit is not given for anything OpenStreetMap did not
produce: the style's geometry is Protomaps' and is credited as such in
`ATTRIBUTION.txt`.
