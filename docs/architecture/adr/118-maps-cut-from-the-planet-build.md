# ADR-118 — Maps cut from the planet build: any territory, a continent or the world, at three details

**Status:** accepted (2026-10-23) · **Owner:** the 2.5 run · **Amends**
[ADR-099](099-offline-map.md) (the map's data is a downloaded region, no longer
a pack) and [ADR-092](092-downloads-network-mode.md) (`DOWNLOAD_HOSTS` gains
the two Protomaps hosts) · **Builds on** ADR-090 (the module kit), ADR-098 (an
unsigned third-party download, said to be one)

## 1. The finding

ADR-099 built the map on one pack, `map-serbia`, and said a second region would
be a second pack. That pack was never published, and the pack route does not
reach the request on record for 2.5: any territory of the world, its continent,
or the whole world, at a detail the person chooses.

- The planet build the pack was cut from, Protomaps' `20261022.pmtiles`, is
  139,077,432,987 bytes (basemap schema `4.15.2`). A GitHub release asset must
  be under 2 GiB, so the world cannot be a pack, and every territory and
  continent at three details would be several hundred packs to build, sign and
  upload again for each refresh.
- `pmtiles extract`, which the builder already used, cuts a region from that
  build with HTTP range requests and reads only the directories it needs. The
  app can do the same at the moment a person asks for a region.

## 2. The decision: the app cuts the region itself

A region's outline, from the bundled Natural Earth admin-0 outline, becomes a
tile cover. The cover becomes runs of tile ids, the runs pick the planet
directory entries the region keeps, and those entries become byte ranges of the
build. The result is a local PMTiles v3 file that `maplibre-gl` reads through
the `pmtiles` library like any other. All of it is in
`apps/desktop/src/modules/maps/`:

| Folder | What it does |
|---|---|
| `shared/world/cover.ts` | outline → tile cover → id runs per zoom |
| `main/extract/archive.ts` | the PMTiles v3 header and directories, read and written |
| `main/extract/plan.ts` | directories → the new file's prefix and the reads that fill it |
| `main/regions/builds.ts`, `main/regions/http.ts` | the build list, and range reads pinned to one build |
| `main/regions/targets.ts` | what a region id names, and its id runs at a detail |
| `main/regions/registry.ts` | what is installed, and the record of a download in flight |
| `main/regions/downloads.ts` | measure, download, pause, resume, cancel, update, remove |
| `main/regions/protocol.ts` | the `nx-map:` read scheme |

A region is therefore what ADR-098 calls an unsigned third-party download, like
a Kiwix file or a Hugging Face model: the app checks that the bytes are the
build's bytes (§6), and nobody signs them.

## 3. The two hosts, and what Protomaps asks of them

`DOWNLOAD_HOSTS` gains two names, each checked with a real request on
2026-10-22:

- `build-metadata.protomaps.dev` serves `builds.json`: a JSON array of
  `{ key, size, md5sum, b3sum, uploaded, version }`, 62 builds in 11,808 bytes
  that day. The app reads at most 1 MiB of it (`BUILDS_MAX_BYTES`) and keeps
  only builds whose basemap major version is 4.
- `build.protomaps.com` serves `<yyyymmdd>.pmtiles`. A range request is answered
  206 with an `ETag` and an exact `Content-Range` that carries the total size,
  with no redirect.

Protomaps' downloads page (read 2026-10-23) says three things that bear on
this:

- the version 4 builds are compatible with `@protomaps/basemaps` style v4.0.0 and
  newer;
- a region is cut with `pmtiles extract`;
- "URLs may change and hotlinking to these downloads are discouraged", and they
  suggest copying the tileset to your own cloud storage.

The app does what that page documents for a region, once per region, when a
person presses the button. The map then draws only from the file on this
machine. It never reads the build to render, polls nothing, and fetches the list
only when the region screen asks. That is the line this ADR draws between a
download and hotlinking.

It is still load on a bucket Protomaps pays for, and the URL may change. If they
ask, or the address moves, the remedy is a mirror under this project's own
storage. That mirror is one host in `DOWNLOAD_HOSTS` and two constants in
`builds.ts`, and needs an account the project does not have today.

## 4. What a region is

- **A territory:** an id of the bundled outline (`SRB`).
- **A continent:** `continent:<name>`, from the outline's `CONTINENT` field. It
  is the union of its territories, each covered on its own. One cover over a
  continent's box would be taken at a zoom so coarse that its one-tile margin
  would be a band hundreds of kilometres wide.
- **The world:** `world`.

Each comes at one of three details (`MAP_REGION_DETAILS`): `overview` keeps
zooms 0 to 8, `towns` zooms 0 to 12, and `full` every zoom the build has, 0 to
15.

**The world at full detail is the build itself.** It is copied whole, in 16 MiB
reads, and checked against the build's MD5 from the list. Every other region is
a cut.

## 5. The cut

**One coarse cover, then arithmetic.** PMTiles numbers a zoom's tiles along a
Hilbert curve, so a tile's descendants at every deeper zoom are one contiguous
run of ids. A region is rasterised once, at the deepest zoom whose bounding box
spans at most 16,384 tiles (Serbia: zoom 13). Every deeper zoom is then one run
per covered tile, and every shallower zoom is the covered tiles' ancestors. The
cover grows by one tile all round, because the outline is simplified, and a
coast just outside it must still be in the download. The cost is a band of the
neighbour's tiles along each border.

**Only directories are read to plan.** The header and root directory come in
the first 16 KiB. After that, a leaf directory is read only when its span meets
the region's runs, at most three levels deep (as deep as the `pmtiles` library
follows), and no directory inflates past 64 MiB. That is enough to know the new
file to the byte before any tile is read, so the size a person sees before
pressing the button is the size that downloads.

**Tiles are read in the build's order and written in it.** The build is
clustered, so a region's tiles lie in a few long stretches of it. The plan reads
each stretch whole, reading through gaps of up to 64 KiB, with no single read
over 16 MiB. Each kept tile is stored once, however many entries share its
bytes. The download is therefore one append after another, which is what makes
it resumable from the file's length (§7).

Measured against `20261022.pmtiles`:

| Region | File the plan measured |
|---|---|
| Serbia, full detail | 399,280,064 bytes |
| Montenegro, zooms 0–10 | 9,745,574 bytes; the library reads Podgorica's tile (10, 566, 378), and the Atlantic's (10, 399, 378) is absent |
| Europe, towns (zooms 0–12) | 1,453,618 directory entries, 7.88 GB of tiles, 6.4 MB of directories read, planned in 10 s and in 26 s on two runs |

## 6. What is checked, and what is not

- **One build, pinned.** The plan records the `ETag` of the build it read.
  Every later answer must carry the same `ETag`, be a 206, and carry
  `Content-Range` with exactly the asked range and the build's listed size. A
  different `ETag` is `build-changed`, and the download starts over rather than
  mixing two builds' bytes.
- **Every answer is the length asked for**, and the finished file is the
  planned size.
- **The whole world is checked against the list's MD5.** A mismatch deletes the
  partial file (`hash`).
- **A cut has no published checksum to compare with**, and this ADR says so
  rather than implying one. What says a cut is right is the pinned build, the
  exact ranges and the exact size. The `pmtiles` library reading it back is the
  test suite's check, not the app's.
- **Only listed hosts.** Both URLs are compiled in. Each request is checked
  against the launch's allowlist before it is made, and it goes through the
  download session's port, which follows no redirect (ADR-092).

## 7. Pause, resume, update, remove

- **One download at a time.** Its record, `<stem>.job.json`, names the region,
  the detail, the build, the `ETag` and the planned size. Its bytes go to
  `<stem>.part`.
- **Pause** aborts the reads and keeps both files. **Start again** re-plans
  against the recorded build, which gives the same plan, and continues from the
  last whole read the part file holds, so a read is always written whole from
  its start. A download a previous run left unfinished shows as paused.
- **Cancel** deletes both files.
- **Update** cuts the same region from the newest build into a file with its own
  name (`<stem>.<build>.<detail>.pmtiles`). The registry switches to it once it
  is complete, and the old file is deleted then. If the map still has the old
  file open, as Windows may, the next start's sweep deletes it: a file the
  registry does not name is not kept.
- **Remove** deletes the registry row and the file, and is refused while that
  region is downloading.
- **The disk is checked first:** the planned size plus 256 MiB of headroom must
  be free (`no-space`).

## 8. Where it lives, and the `nx-map:` scheme

Everything is under `<userData>/maps/`. `regions.json` is written atomically
with mode `0600`, and a row is kept only when its file name is the one its id,
build and detail make.

The map reads a region at `nx-map://region/<file>`, a privileged scheme like
`nx-pack:` (`standard`, `secure`, `supportFetchAPI`, `stream`).
`regions/protocol.ts` serves only a file `regions.json` names, with byte ranges.
A partial file, the registry itself or any other path is a 404, because it is
not in that list, so no path comparison has to be kept right. The scheme is on
the renderer's offline list (`main/net/offline.ts`) and in the CSP's
`connect-src`, because the map reads it through `fetch`.

The region ops (`regions`, `estimateRegion`, `downloadRegion`, `pauseRegion`,
`cancelRegion`, `removeRegion`) belong to the machine, not to a profile: a region
is a file every profile's map reads. They take a region id and a detail, both
checked against what the outline and the wire name, and never a path or a URL.

## 9. The plan's size cap

The planner holds every entry it keeps in memory, so a plan has a cap,
`PLAN_MAX_ENTRIES`, and a region past it answers `too-large` before anything
downloads. The page then offers less detail or a smaller region.

The cap is 2,000,000 entries, a policy value set from these measurements
against the 2026-10-22 build:

| Region | Directory entries it keeps | Tiles | Under the cap |
|---|---|---|---|
| The world, overview (zooms 0–8) | 33,310 | 559 MB | yes |
| Serbia, full detail | 154,144 | 399 MB | yes |
| Germany, full detail | 890,435 | 5.67 GB | yes |
| Europe, towns (zooms 0–12) | 1,453,618 | 7.88 GB | yes |
| France, full detail | 2,123,478 | 11.00 GB | no |
| Australia, full detail | 4,252,515 | 2.13 GB | no |
| Brazil, full detail | 6,032,203 | 4.46 GB | no |
| The world, towns (zooms 0–12) | 6,316,341 | 17.75 GB | no |
| China, full detail | 9,684,619 | 6.35 GB | no |
| The United States, full detail | 16,910,065 | 19.83 GB | no |
| Canada, full detail | 34,551,791 | 17.96 GB | no |
| Russia, full detail | 36,010,885 | 20.61 GB | no |
| Europe, full detail | more than 16,777,216 (the measurement's `Set` overflowed) | — | no |

The count follows how much of a territory is mapped to zoom 15 and how much of
it is empty, not its size on disk: Australia keeps twice France's entries for a
fifth of its bytes.

Europe to zoom 12 plans within a 384 MiB heap and fails within 256 MiB
(`--max-old-space-size`, the planner as committed). The cap leaves room above
it, and refuses the world's towns and the largest countries at full detail,
France among them. A person can still take any of them at less detail.

Before the cap was set, the planner held every entry twice, plus two maps keyed
by offset, and Europe to zoom 12 did not fit in 512 MiB. It now rewrites the
kept entries' offsets in place, and writes directories into bytes rather than
an array of numbers.

The world at full detail is never planned (§4), so the cap never applies to it.
Lifting the cap is a streaming planner that writes the new directories as it
walks the build's. That is future work, and nothing in the file format stands in
its way.

## 10. What this ADR does not do

- **The drawing and the search are §13**, recorded when they were built. They
  replace ADR-099 §4 to §6.
- **Disputed areas are not in §10's original scope.** Luka's answer and its
  implementation are recorded below in §14.
- **It signs nothing** (§2) and adds no pack.

## 11. Consequences

- `map-serbia` goes away as a pack. It was never published, so no install has
  it.
- `check:egress` gains one opt-in exemption,
  `extract/plan.slow.test.ts`, which plans against the real build only when
  `NEXUS_PLANET_URL` names one.
- The ODbL duties of ADR-099 §8 are unchanged. Every region is an admin-0
  territory or a union of them, never a radius, and the map's credit stays on
  screen.
- A refresh of the data is a person pressing Update. No release of this app or
  of `nexus-packs` is needed for one.

## 12. Alternatives rejected

- **A pack per region in `nexus-packs`.** Several hundred signed assets to
  rebuild for each refresh, and the world does not fit under the 2 GiB asset
  limit (§1).
- **The map reading the remote build directly.** That is the hotlinking
  Protomaps discourages, and a map that is blank offline.
- **A mirror on this project's own storage, now.** It needs an account and a
  bill the project does not have. It stays the remedy if §3's arrangement has to
  change.

## 13. How the regions are drawn and searched

Recorded on 2026-10-23, when they were built.

**One style, built in the renderer** (`renderer/style.ts`, pure and tested). From
the bottom: the background, the world outline (the same Natural Earth outline
the picker uses), each installed detail's geometry from the coarsest to the
finest, the picker's tint and selection, each detail's labels, and the country
names from the outline up to zoom 7. The geometry and label layers are
`@protomaps/basemaps` 5.7.2's, coloured from the app's tokens, so a theme change
restyles the map. Icons are dropped, because no sprite ships.

**One source per installed detail.** `nx-regions://<detail>/{z}/{x}/{y}` is
answered in the renderer by `renderer/regionTiles.ts`, from the PMTiles files of
every region at that detail, newest build first, with the detail's own
`maxzoom`. Where a finer detail has a tile it draws over the coarser one; where no
region has one, the outline shows through. The address carries the files'
names, so installing, updating or removing a region reloads the source.

**Labels in the system's fonts, not a glyph bundle.** ADR-099 shipped glyph
files in the pack, and the plan said the glyphs would be bundled. The style
names no `glyphs`, so MapLibre draws text with the fonts the system has, and the
style asks for the app's own UI font stack (`--nx-font-family-ui`). Every script
the system can render is drawn, nothing is downloaded, and no glyph range can be
missing. The cost is that a label is rasterised by each machine's fonts rather
than by the same file everywhere.

**The Serbian label chain.** `@protomaps/basemaps` 5.7.2 lists 39 label
languages, Croatian among them and neither Serbian nor Bosnian. A Serbian page
reads `name:sr-Latn` (kept first in case a later build carries it), then
`name:hr`, then the local `name` where the place is written in Latin, then
`name:en`, then the local `name`. The plan had `name:bs` before the local name;
the build has no such key. A place in another script and with no Croatian form
therefore reads in English rather than in a script the reader may not know.
English pages read `name:en`, then `name`.

**Search reads the regions' own tiles** (`renderer/placeIndex.ts`, in the search
worker). A place is in every tile from its `min_zoom` down, so one zoom holds
them all: the deepest zoom up to 10 at which the region's territories cover at
most 2,000 tiles. Both numbers are policy: villages are in the tiles by zoom 10,
and the tile bound caps what one download asks of the search. Measured with the
built cover: Serbia at full detail reads zoom 10 (134 tiles), Germany zoom 10
(680), Europe at towns detail zoom 7 (1,440), the world zoom 5 (665). The
regions are merged most detailed first, and a place two regions both carry is
kept once: the same kind and name within 0.01°, because each region reads it on
its own zoom's grid. A name follows the label chain above, with a
transliteration for a non-Latin name that has no other form.

**The credit** in the corner of the map is "© OpenStreetMap contributors ·
Protomaps · land cover © ESA WorldCover", beside the ODbL line. Protomaps
publishes the build as an ODbL Produced Work with OpenStreetMap attribution
required, and its own example credits Protomaps and OpenStreetMap. The land
cover at low zooms is Daylight's, vectorised from ESA WorldCover (CC BY 4.0).

**`map-serbia` and its builder are deleted**, with `places.json`'s reader in
`@nexus/core` and the renderer's pack-file reader. `@nexus/core`'s
`remoteStyleUrls` stays: the built style names no remote address, and
`style.test.ts` pins that with it.

## 14. Disputed areas

Natural Earth's admin-0 outline is one perspective on sovereignty, and that is
not enough for a reader whose own territory is drawn as somebody else's. The
answer is a separate disputed layer, not a relabelling of the outline. It keeps
the neutrality rule structural: the app draws a disputed area as disputed, names
the parties in alphabetical order in the reader's language, and never says who
administers it, who is right, or whose it is. Antarctica is not in this layer:
its claims are held in abeyance by treaty rather than disputed.

**Sources.** `ne_10m_admin_0_disputed_areas.geojson` supplies the 99 disputed
records and their notes. `ne_10m_admin_1_states_provinces.geojson` supplies the
four whole Ukrainian oblasts selected by `iso_3166_2`. Both are Natural Earth
1:10m files from the same public-domain repository as the outline. The build
prints each source's SHA-256, so a `master` URL still has an identifiable input.

**Inclusion and parties.** A source record is included when its `TYPE` is
`Disputed`, `Indeterminate` or `Breakaway`, or when `NOTE_BRK` contains
`Claimed by`. Notes are parsed for administering states, claimants, leases,
cessions and self-administration. Natural Earth's spellings go through one
explicit table into outline ids; an unknown name stops the build with the name
and the feature. Parties are deduplicated in the data and sorted by the active
locale's `Intl.Collator` when the card is drawn. `self` means the disputed area
itself. Any exception is one entry in `DISPUTE_OVERRIDE_REASONS` in the build,
with its reason beside it.

The exceptions are: Israel's whole-state polygon is excluded because its
disputed parts are separate features; Gaza and the West Bank name Israel and
Palestine; Kosovo names Kosovo and Serbia; Belize names Belize and Guatemala;
Dragonja names Croatia and Slovenia; Vukovar and Šarengrad islands name Croatia
and Serbia after the source's byte-order marks are removed from their names;
the misspelt `Ilemi Triange` duplicate is merged into Ilemi Triangle; the two
Western Sahara perspectives become one Western Sahara with Morocco and Western
Sahara; North Borneo names Malaysia and the Philippines; Ceuta and Melilla are
included with Morocco and Spain; the Cyprus U.N. Buffer Zone names Cyprus and
Northern Cyprus; Vietnam is added to the Spratlys; Bird Island names Dominica
and Venezuela; Bir Tawil is unclaimed and therefore has no parties; Artsakh is
excluded because the republic dissolved on 2024-01-01; Hans Island is excluded
because Canada and Denmark divided it by their treaty of 14 June 2022.

**Names.** An area is named by Natural Earth's short name (`BRK_NAME`), with its
abbreviations written out: it is the neutral one (`West of Essequibo River`),
where the longer `NAME_EN` is at times a claimant's (`Guayana Esequiba`). For the
same reason the outline names `CYN` Northern Cyprus, not by the self-proclaimed
state's full name. Tokelau, a party with no outline territory, is stored as its
name.

The Donetsk and Luhansk breakaway polygons are replaced by the whole
`UA-14` and `UA-09` oblasts, `UA-23` Zaporizhzhia and `UA-65` Kherson are
added, and all four are named Russia and Ukraine. Crimea remains as Natural
Earth draws it, with the same two parties. Four points cover islands too small
for a polygon at this scale: Senkaku / Diaoyu Islands (China, Japan, Taiwan),
Liancourt Rocks (Japan, South Korea), Scarborough Shoal (China, the Philippines,
Taiwan), and Machias Seal Island (Canada, the United States). These are points
rather than new map assets, so they are legible at world scale without adding a
second source of shapes.

**The files and the build.** `scripts/maps/world-outline.mjs` writes both
`outline.json` and `disputed.json`. Each disputed feature has a stable
kebab-case id and exactly `name`, `parties`, `note` and `within` in its
properties. `within` is computed during the build: the territories whose own label lies
in the area, then those that hold the area's label point or at least a tenth of
an even 24 by 24 grid of points sampled inside it. Border vertices are not used,
because the area (1:10m) and the outline (1:50m) trace a shared border at
different scales, and every neighbour would list the area. The renderer never
repeats geometry work. `disputed.json` uses the outline's Douglas–Peucker
tolerance, is capped at 250 000 bytes, and ships inside the app like the
outline.

**The card.** A territory card lists every disputed area in or overlapping it.
An area that is the territory itself comes first, then other overlapping areas.
Each entry shows the area's name, the neutral line `Disputed territory` (or
`Sporna teritorija`), and `Parties: A, B` (or `Strane u sporu: A, B`). An
unclaimed area reads `Claimed by no state` (or `Nijedna država ne polaže pravo
na nju`). The parties use `names.ts` and therefore follow the reader's language
and Latin Serbian collation; `self` uses the area's own English name.

**The map.** Disputed polygons take a diagonal hatch and a dashed outline above
the world outline and every downloaded region, below all labels. The hatch and
the small dashed circle used for disputed points are created as `ImageData`
from a canvas when the style loads, in the existing `data` token colour; no
bitmap asset is added. The layers take no clicks: a picker click still queries
only `OUTLINE_LAND_LAYER`, so the territory under the pointer opens and the
download scope is unchanged. A short `Hatched: disputed territory` /
`Šrafirano: sporna teritorija` line sits under the map credit.

