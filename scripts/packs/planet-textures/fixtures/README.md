# Fixtures for the planet-textures converter

Three crops, a kilobyte each, cut from the real sources of the
`planet-textures` pack so the converter's test reads what the build reads — a
planetary JPEG, the night-lights JPEG and a piece of the ring strip that carries
alpha — instead of megabytes of it.

They are cut by `build.mjs --fixtures` (`node scripts/packs/planet-textures/build.mjs
--fixtures`), which fetches the sources into the pack cache and extracts these
boxes from them. Each is reproduced here as a quotation under its own licence,
with the source's credit line, and the SHA-256 of the cut is recorded so a
changed fixture is visible in the diff.

| File | Source | Box | Licence | Credit | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `mars-crop.jpg` | `https://www.solarsystemscope.com/textures/download/2k_mars.jpg` (2048 × 1024 JPEG) | 0,0 128 × 64 | CC BY 4.0 | Solar System Scope (INOVE) | `8dd3e548a9f2614f24ef6de1b4c45530532fa0bbba8a855de8dd0f9632d7ff36` |
| `black-marble-crop.jpg` | `https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg` (3600 × 1800 JPEG) | 0,0 128 × 64 | Public domain (NASA) | NASA Earth Observatory, Black Marble (Suomi NPP VIIRS) | `3fb7f2be824884896b22a927ab29d84180ce37704718baa72a0c887a7400a400` |
| `saturn-rings-crop.png` | `https://www.solarsystemscope.com/textures/download/2k_saturn_ring_alpha.png` (2048 × 125 PNG with alpha) | 1280,30 128 × 64 | CC BY 4.0 | Solar System Scope (INOVE) | `288a74948c7c951499068b1a1a6976a824a2c9087ebbfea464400b9a4fb1503c` |

The licence evidence for both licences — the page, and the sentence on it — is
in [`../sources.json`](../sources.json), which is also what the builder verifies
every download against.

`saturn-rings-crop.png` is the fixture with a job beyond "a file the converter
can read": its alpha runs from 25 to 249, because the box straddles a real edge
in the ring strip rather than sitting inside one flat band. That is what lets the
test say whether alpha survived the conversion, instead of only that a channel
exists.
