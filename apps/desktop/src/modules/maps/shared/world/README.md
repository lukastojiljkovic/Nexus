# World outline and disputed areas

`outline.json` is the outline the map picker draws: Natural Earth's 1:50m admin-0 countries with the fields the picker reads and nothing else. `outline.ts` loads it. Kosovo is drawn as part of Serbia and marked disputed.

`disputed.json` is the neutral disputed-area layer drawn over that outline. `disputed.ts` types it and answers which areas belong to each territory, and `scripts/maps/world-outline.mjs` builds both files in one run.

## Sources

- **Countries** — `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson`. The GeoJSON carries no version. It names itself `ne_50m_admin_0_countries` and declares the CRS `urn:ogc:def:crs:OGC:1.3:CRS84`. The URL points at the `master` branch, so the build identifies the file by its SHA-256 and size. The file used for the committed outline is SHA-256 `3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb`, 3 083 490 bytes, 242 records.
- **Disputed areas** — `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_disputed_areas.geojson`, 99 records. Natural Earth's `TYPE`, `BRK_NAME` and `NOTE_BRK` decide inclusion; the explicit exceptions live in `DISPUTE_OVERRIDE_REASONS` in the build script. The file used for the current build is SHA-256 `9cafef8b7dfb6b164dc58f218f981f4ace9f716f6c03795d4c62d1ac9f3d50f5`, 701 323 bytes.
- **Oblasts** — `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson`. The build selects `UA-14`, `UA-09`, `UA-23` and `UA-65` by `iso_3166_2`. This URL also points at `master`; the build prints its byte count and SHA-256 on every run, so the exact source is recorded in the output of that run.

## Licence

Natural Earth's terms of use ([naturalearthdata.com/about/terms-of-use](https://www.naturalearthdata.com/about/terms-of-use/)) state: "All versions of Natural Earth raster + vector map data found on this website are in the public domain." The disputed and admin-1 files come from the same repository.

## Rebuild

From the repository root:

```
node scripts/maps/world-outline.mjs
```

The three sources are downloaded once into `%TEMP%\nexus-pack-cache\world-outline\` and reused while they are there. The command prints the source byte counts and SHA-256 hashes, rewrites `outline.json` and `disputed.json`, and refuses a file over its ceiling.

## What the outline keeps

- **Properties** — `iso2` (`ISO_A2_EH`), `iso3` (`ISO_A3_EH`), `name` (`NAME_EN`), `continent` (`CONTINENT`), `label` (`LABEL_X`, `LABEL_Y`). The id is `ADM0_A3`. Natural Earth's `-99` placeholder becomes `null`. The picker shows names through `Intl.DisplayNames` by `iso2`; `name` is the fallback for the records without one.
- **Geometry** — Douglas–Peucker per ring, tolerance `SIMPLIFY_TOLERANCE` (0.01°, about 1.1 km), coordinates rounded to `COORDINATE_DECIMALS` (3). A ring that collapses below four positions is dropped with its polygon's holes if it is an exterior. A feature that would lose all its rings keeps its largest exterior unsimplified. Kosovo's source geometry is dissolved into Serbia's outline and its separate outline record is dropped.

## What the disputed layer keeps

- **Inclusion** — a record is included when `TYPE` is `Disputed`, `Indeterminate` or `Breakaway`, or when `NOTE_BRK` contains `Claimed by`. The explicit override table adds Ceuta and Melilla, merges the two Western Sahara perspectives, replaces the two breakaway Ukrainian polygons with four whole oblasts, excludes Hans Island (divided by Canada and Denmark in 2022), and records the small-island points. The name shown is Natural Earth's own short name (`BRK_NAME`), the neutral one, with its abbreviations written out; the outline names Northern Cyprus so too, not by the self-proclaimed state's full name.
- **Neutral parties** — administering states and claimants are parsed from `Admin. by`, `Admin by`, `Leased to … by`, `Ceded to … by`, `Claimed by`, and `Self admin.`. Names map through one spelling table to `ADM0_A3`; an unknown name fails the build with both the name and the feature. The area itself is recorded as `self`.
- **Output** — every feature has a stable kebab-case `id` and exactly `properties: { name, parties, note, within }`. `parties` is sorted, `note` is `"unclaimed"` only for Bir Tawil (otherwise `null`), and `within` lists the outline ids whose own label lies in the area, then those that hold the area's label point or at least a tenth of an even grid of points sampled inside it. Border vertices are not used: the area (1:10m) and the outline (1:50m) trace a shared border at different scales, and every neighbour would list the area.
- **Overrides** — `DISPUTE_OVERRIDE_REASONS` in `scripts/maps/world-outline.mjs` is the reviewable table of decisions. Every source exception and added area has one line stating why it exists.
- **Geometry** — polygons and multipolygons use the outline's Douglas–Peucker tolerance and decimal precision; the four island points and Machias Seal Island remain points. `MAX_DISPUTED_BYTES` is 250 000 bytes.

## Measured outline

Measured on the countries source above with the build's code, from a sweep over the tolerance at 3 and 4 decimals. Sizes are bytes of the written file; positions count every ring's closing point, in the source and in the output alike. The shipped row is the current 2.5 build; the other rows are the original sweep before Kosovo's geometry was merged into Serbia.

| tolerance (°) | decimals | bytes | positions |
| --- | --- | --- | --- |
| source | — | — | 99 613 |
| 0 | 3 | 1 681 266 | 98 867 |
| 0.005 | 3 | 1 523 106 | 89 092 |
| **0.01** | **3** | **1 244 845** | **72 256** |
| 0.02 | 3 | 911 005 | 52 016 |
| 0.03 | 3 | 739 830 | 41 659 |
| 0.05 | 3 | 556 973 | 30 611 |

The shipped setting is 0.01 at 3 decimals: the finest tolerance swept that stays under the 1 500 000-byte ceiling. At 4 decimals, the pre-merge 0.01 run gave 1 391 558 bytes, so the precision costs more than it adds. The build refuses to write a file over the ceiling.

Dropped by the build at the shipped setting: 4 rings in 3 records. New Zealand loses 2 of its 13 polygons, Fiji 1 of 21, and Italy one interior ring (a hole) of its first polygon. No feature was left without rings, so the fallback did not run.

## Records with no ISO code

`ISO_A2_EH` is `-99` for three records: `SOL` (Somaliland), `CYN` (Turkish Republic of Northern Cyprus) and `KAS` (Siachen Glacier). `ISO_A3_EH` is `-99` for those three; Kosovo's source record also has it, but that record is merged into Serbia.

## Continents

Natural Earth's `CONTINENT` values, with the number of records in each:

| value | records |
| --- | --- |
| Africa | 54 |
| Asia | 53 |
| Europe | 49 |
| North America | 38 |
| Oceania | 25 |
| South America | 13 |
| Seven seas (open ocean) | 8 |
| Antarctica | 1 |

`Seven seas (open ocean)` is Natural Earth's grouping for the oceanic territories, not a continent; the picker shows it as the source names it.

## Antimeridian

Fiji and Russia have parts on both sides of the 180° meridian. Their `regionBounds` is the whole width, -180 to 180, because the bounds are taken on the stored longitudes.
