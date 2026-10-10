# The `planet-textures` pack

**A `dataset` pack: one equirectangular map per body of the solar-system
contract, plus Earth's night lights and Saturn's ring strip, for the astronomy
module's 3D view.**

The module reads it through `textures.json` (layout 1, below), the view draws
each body with the map its id names, and a body the pack does not name is drawn
as a sphere in a neutral tone with its name — which is what the view does when
there is no pack at all. Nothing in the pack is executed: it is images and a
JSON file, and the renderer never reads a byte the manifest does not list.

## What it contains

Twelve images, 2048 × 1024 WebP each except the ring strip at 2048 × 125, and
`textures.json`. Sizes are the bytes the builder measured on 2026-10-10.

| Body | Slot | Image | Size | Source | Licence |
| --- | --- | --- | --- | --- | --- |
| Sun | `day` | `images/sun-day.webp` | 313.3 KiB | Solar System Scope `2k_sun.jpg` | CC BY 4.0 |
| Mercury | `day` | `images/mercury-day.webp` | 579.6 KiB | Solar System Scope `2k_mercury.jpg` | CC BY 4.0 |
| Venus | `day` | `images/venus-day.webp` | 55.4 KiB | Solar System Scope `2k_venus_atmosphere.jpg` | CC BY 4.0 |
| Earth | `day` | `images/earth-day.webp` | 236.4 KiB | NASA Earth Observatory, Blue Marble `land_ocean_ice_2048.png` | Public domain (NASA) |
| Earth | `night` | `images/earth-night.webp` | 141.7 KiB | NASA Earth Observatory, Black Marble `dnb_land_ocean_ice.2012.3600x1800.jpg` | Public domain (NASA) |
| Moon | `day` | `images/moon-day.webp` | 681.2 KiB | Solar System Scope `2k_moon.jpg` | CC BY 4.0 |
| Mars | `day` | `images/mars-day.webp` | 320.3 KiB | Solar System Scope `2k_mars.jpg` | CC BY 4.0 |
| Jupiter | `day` | `images/jupiter-day.webp` | 188.2 KiB | Solar System Scope `2k_jupiter.jpg` | CC BY 4.0 |
| Saturn | `day` | `images/saturn-day.webp` | 48.8 KiB | Solar System Scope `2k_saturn.jpg` | CC BY 4.0 |
| Saturn | `rings` | `images/saturn-rings.webp` | 5.7 KiB | Solar System Scope `2k_saturn_ring_alpha.png` | CC BY 4.0 |
| Uranus | `day` | `images/uranus-day.webp` | 9.3 KiB | Solar System Scope `2k_uranus.jpg` | CC BY 4.0 |
| Neptune | `day` | `images/neptune-day.webp` | 21.3 KiB | Solar System Scope `2k_neptune.jpg` | CC BY 4.0 |

**Measured size: 2 665 085 bytes (2 602.6 KiB) in 13 files**, against 7 466 384
bytes (7 291.4 KiB) of sources — the WebP encode is 36% of what was downloaded.
`textures.json` is 1 456 bytes of that; the twelve images are the rest.

### `textures.json`

```json
{
  "layout": 1,
  "bodies": {
    "earth": {
      "day": "images/earth-day.webp",
      "night": "images/earth-night.webp",
      "credit": "Earth: NASA Earth Observatory, Blue Marble (day) and Black Marble (night) — not subject to copyright in the United States"
    }
  }
}
```

One entry per body that has an image, in the contract's body order (the Sun,
then outwards, with the Moon after the Earth); `day`, `night` and `rings` are
the slots, and `credit` is that body's attribution line, which the module shows.

## What it does not contain, and why

**Pluto.** No NASA, USGS or Solar System Scope source for it was found with both
a stable URL and a licence that could be quoted, inside the budget of this run.
The body is left out rather than filled with something whose provenance is a
guess: the view draws Pluto as a neutral sphere with its name, and the pack can
gain the map the day a source with evidence is found.

## Sources and licences

Both licences are quoted verbatim in
[`scripts/packs/planet-textures/sources.json`](../../scripts/packs/planet-textures/sources.json),
which is also what the builder verifies every download against.

**Solar System Scope — CC BY 4.0.** Ten of the twelve images. Their texture page
(`https://www.solarsystemscope.com/textures/`) states:

> Distributed under Attribution 4.0 International license: You may use, adapt, and share these textures for any purpose, even commercially.

The attribution the licence requires travels in three places: this document, the
`credit` line each body carries inside `textures.json`, and the pack manifest's
`licence.attribution`, which `pack-sign.mjs` writes into the signed `pack.json`.

**NASA — not subject to copyright in the United States.** The two Earth maps.
NASA's media guidelines (`https://www.nasa.gov/nasa-brand-center/images-and-media/`)
state:

> NASA content – images, audio, video, and media files used in the rendition of 3-dimensional models, such as texture maps and polygon data in any format – generally are not subject to copyright in the United States.

### Why Solar System Scope carries most of the bodies

The brief's rule is "Solar System Scope's textures only where NASA has none".
NASA and USGS have maps of every body here — as global mosaics in
simple-cylindrical projection, published as TIFF and JP2 files of hundreds of
megabytes to several gigabytes (the USGS Astrogeology mosaics of Mercury and
Mars are the obvious examples). Those are public domain and they are the right
source for a one-off conversion; they are the wrong source for a builder that
has to be re-runnable in minutes and verified against a digest, which is what
this pack is. Where NASA does publish a small file of exactly the right shape,
it is used directly — both Earth maps are NASA's own.

**The pack's declared licence is the stricter of the two**: `CC-BY-4.0`, with
the attribution naming both sources and pointing at the per-body credits. A
`licence` field can hold one identifier, and declaring the public-domain half
alone would have understated what the reader owes the other half.

## How to rebuild it

```sh
node scripts/packs/planet-textures/build.mjs
```

It downloads every source into `%TEMP%\nexus-pack-cache\planet-textures\`,
checks each one against the SHA-256 and size `sources.json` records — a cached
file whose digest no longer matches is discarded and fetched again, and a
download that does not match is refused rather than shipped — re-encodes each
as WebP, and writes the pack to `%TEMP%\nexus-packs\planet-textures\` with the
metadata beside that folder at `%TEMP%\nexus-packs\planet-textures.meta.json`.
Nothing is written into the repository except the fixtures below.

The caps are the builder's own: 2048 × 1024 for a map (half the 4096 × 2048 the
pack format allows, which is what keeps the pack at 2.5 MiB rather than 5),
2048 × 128 for the ring strip, and WebP quality 88 with lossless alpha. Nothing
is ever enlarged, so a smaller source stays at its own size.

Measured on this machine on 2026-10-10: **2.7 s** with every source already in
the cache, and about 6 s for the first run, which also downloads 7.3 MiB (the
twelve downloads alone took 5.6 s).

Then the maintainer signs it — this run never has the key:

```sh
node scripts/pack-sign.mjs \
  --dir %TEMP%/nexus-packs/planet-textures \
  --meta %TEMP%/nexus-packs/planet-textures.meta.json \
  --key <release-key.pem>
```

The metadata's `minAppVersion` is read out of `apps/desktop/package.json` at
build time rather than typed here, and its `kind` is `dataset`.

## The tests, and the fixtures

`scripts/packs/planet-textures/build.test.mjs` covers the converter, the source
evidence, the layout, the metadata (through `pack-sign.mjs`'s own `checkMeta`,
so the two cannot drift) and a whole build against a stubbed network — 20 tests,
1.2 s. It reads three small crops of the real sources from `fixtures/`, whose
own provenance, licence and SHA-256 are in
[`fixtures/README.md`](../../scripts/packs/planet-textures/fixtures/README.md).

`node scripts/packs/planet-textures/build.mjs --fixtures` re-cuts those crops
from the cached sources.
