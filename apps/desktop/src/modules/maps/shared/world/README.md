# World outline

`outline.json` is the outline the map picker draws: every territory in Natural Earth's 1:50m admin-0 countries, one feature per record, with the fields the picker reads and nothing else. [`outline.ts`](outline.ts) loads it.

## Source

- **URL** — `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson`
- **Version** — the GeoJSON carries no version. It names itself `ne_50m_admin_0_countries` and declares the CRS `urn:ogc:def:crs:OGC:1.3:CRS84`. The URL points at the `master` branch, so the file is identified by its hash: the build prints the SHA-256 and size of the file it read.
- **Used for the build of this file** — SHA-256 `3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb`, 3 083 490 bytes, 242 records.

## Licence

Natural Earth's terms of use ([naturalearthdata.com/about/terms-of-use](https://www.naturalearthdata.com/about/terms-of-use/)) state: "All versions of Natural Earth raster + vector map data found on this website are in the public domain."

## Rebuild

From the repository root:

```
node scripts/maps/world-outline.mjs
```

The source is downloaded once into `%TEMP%\nexus-pack-cache\world-outline\` and reused while it is there. Delete that file to fetch it again.

## What the build keeps

- **Properties** — `iso2` (`ISO_A2_EH`), `iso3` (`ISO_A3_EH`), `name` (`NAME_EN`), `continent` (`CONTINENT`), `label` (`LABEL_X`, `LABEL_Y`). The id is `ADM0_A3`. Natural Earth's `-99` placeholder becomes `null`. The picker shows names through `Intl.DisplayNames` by `iso2`; `name` is the fallback for the records without one.
- **Geometry** — Douglas–Peucker per ring, tolerance `SIMPLIFY_TOLERANCE` (0.01°, about 1.1 km), coordinates rounded to `COORDINATE_DECIMALS` (3). A ring that collapses below four positions is dropped with its polygon's holes if it is an exterior. A feature that would lose all its rings keeps its largest exterior unsimplified.

## Measured

Measured on the source above with the build's code, from a sweep over the tolerance at 3 and 4 decimals. Sizes are bytes of the written file; positions count every ring's closing point, in the source and in the output alike.

| tolerance (°) | decimals | bytes | positions |
| --- | --- | --- | --- |
| source | — | — | 99 613 |
| 0 | 3 | 1 681 266 | 98 867 |
| 0.005 | 3 | 1 523 106 | 89 092 |
| **0.01** | **3** | **1 245 894** | **72 310** |
| 0.02 | 3 | 911 005 | 52 016 |
| 0.03 | 3 | 739 830 | 41 659 |
| 0.05 | 3 | 556 973 | 30 611 |

The shipped setting is 0.01 at 3 decimals: the finest tolerance swept that stays under the 1 500 000-byte ceiling. At 4 decimals, 0.01 gives 1 391 558 bytes, so the precision costs more than it adds. The build refuses to write a file over the ceiling.

Dropped by the build at the shipped setting: 4 rings in 3 records. New Zealand loses 2 of its 13 polygons, Fiji 1 of 21, and Italy one interior ring (a hole) of its first polygon. No feature was left without rings, so the fallback did not run.

## Records with no ISO code

`ISO_A2_EH` is `-99` for three records: `SOL` (Somaliland), `CYN` (Turkish Republic of Northern Cyprus) and `KAS` (Siachen Glacier). `ISO_A3_EH` is `-99` for those three and for `KOS` (Kosovo), whose `iso2` is set.

## Continents

Natural Earth's `CONTINENT` values, with the number of records in each:

| value | records |
| --- | --- |
| Africa | 54 |
| Asia | 53 |
| Europe | 50 |
| North America | 38 |
| Oceania | 25 |
| South America | 13 |
| Seven seas (open ocean) | 8 |
| Antarctica | 1 |

`Seven seas (open ocean)` is Natural Earth's grouping for the oceanic territories, not a continent; the picker shows it as the source names it.

## Antimeridian

Fiji and Russia have parts on both sides of the 180° meridian. Their `regionBounds` is the whole width, -180 to 180, because the bounds are taken on the stored longitudes.
