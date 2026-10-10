# ADR-099 — The offline map: a pack, a region, and no network

**Status:** accepted **Date:** 2026-10-10 **Depends on:** ADR-090 (the module
kit), ADR-091 (content packs), ADR-093 (the map is a *knowledge* module).
**Does not cover:** routing, which is its own project (§7).

## 1. The finding

Nexus is an offline-first app whose whole network story is "nothing unless the
user asks" (ADR-089, ADR-092). A map is the one feature where that promise is
easiest to break by accident and hardest to notice: every map library is written
to fetch a style, glyphs, sprites and tiles over HTTP, and a style is *data* —
one URL in a JSON file that an editor left behind is a map that works perfectly
on the machine that built it and shows nothing on a machine with the network
off.

The research run (`R5`, 2026-10-09) settled the stack: PMTiles for the tiles
(one file per region, BSD-3-Clause library, CC0 specification), MapLibre GL JS
to render it (BSD-3-Clause), the Protomaps vector basemap as the data (ODbL,
attribution required), and a small index we build ourselves for search. All of
that is legal to ship and all of it works offline. This ADR records what was
BUILT on that finding, and the four decisions the research left open.

## 2. The map is a module; the data is a pack

`apps/desktop/src/modules/maps/` is a folder built on ADR-090's kit: a manifest,
a contract, main-process handlers, a page, its own copy in both languages, and
tests. It declares `group: "knowledge"` (ADR-093 sent the reference libraries
there and named maps as one), `prefix: "MAP"` — PRD 00 has no row for a map, so
it takes its own rather than borrowing a tool's — and `order: 210`, after
Timers.

The map itself is **not in the app and not in the database**. It is an installed
pack (ADR-091): `<userData>/packs/map-serbia/<version>/`, with one PMTiles
archive, two styles, a place index, a label file, the glyph ranges the labels
need, and the licence and attribution files. The app reads that folder through
the `nx-pack://<packId>/<path>` scheme — a range request answered in this process
by `protocol.handle` — so **no pack path ever crosses the IPC bridge**, in
either direction (ADR-091 §6's rule, kept).

What the app does NOT read from the pack is anything about a profile: the pins a
person drops are rows in `maps_pins` (migration 87), and where the machine is
comes from main's memory. That split is two lifetimes: a pack is replaced by
installing a new one, and a pin survives all of them.

## 3. What the pack holds, and why each part is there

```text
maps.pmtiles            one PMTiles archive, the basemap, z0–15 by default
style.dan.json          the style for the light theme
style.noc.json          the style for the dark theme
places.json             the search index: name, nameCyr, nameEn, kind, lat, lon, population
labels.geojson          what the map DRAWs: name, kind, minZoom
fonts/<stack>/<lo>-<hi>.pbf   the glyph ranges the style can ask for
region.geojson          the polygon the tiles were cut from
ATTRIBUTION.txt         the ODbL notice, and the other components' licences
LICENSE-ODbL.txt        the ODbL 1.0 text (ODbL 4.2: it travels with the data)
CHANGES.txt             the exact commands, which is the 4.6 source offer
sources.json            every source's URL, date, size and SHA-256
pack.json, pack.json.sig  the signed manifest (ADR-091)
```

**Two themes, not one style.** The colours are baked from the design tokens at
build time (below), so a theme is a different file rather than a runtime
recolour; the page swaps `style.dan.json` for `style.noc.json` when
`<html data-theme>` changes, which is also what re-reads the palette for the
pin colours.

**No sprites.** A stylesheet's sprites are read only by layers that use
`icon-image`, and in this pack those layers are exactly the vendor label and POI
layers that decision §5 drops. A hundred kilobytes that no layer reads is not
"small", it is a file nobody can explain later; adding the vendor's POI layers
one day is one builder flag and the sprite set with it.

## 4. The style wears the tokens, and every address in it points inside the pack

The geometry layers come from `@protomaps/basemaps` (BSD-3-Clause code, CC0
visual design), whose `layers(source, flavour)` turns a *flavour* — one named
colour per surface — into fifty-seven layers for the OpenMapTiles-style schema.
The flavour is the seam this app uses: `scripts/packs/map-serbia/style.mjs`
maps every key those layers read (fifty-one of them, measured by running the
vendor's own generator with a `Proxy` that logs each property) onto a semantic
token from `packages/tokens`, so the map is painted with the app's palette in
both themes — and a contrast fix in the tokens reaches the map at the next
build rather than never. Where the palette has no blue (the design rules ban
it), water is a neutral: `surface-sunken` beside `surface` land.

Every address the generated style carries is then rewritten:
`sources.protomaps.url` to `pmtiles://nx-pack://map-serbia/maps.pmtiles`, the
labels source to `nx-pack://map-serbia/labels.geojson`, `glyphs` to
`nx-pack://map-serbia/fonts/{fontstack}/{range}.pbf`. `assertLocalStyle` refuses
a style that would fetch anything else, and **the app checks the same property
again when it loads the pack** (`remoteStyleUrls`) and refuses to draw rather
than accept a map that needs the network. Two checks, one on each side of the
pack's life, because the failure they prevent — a map that is blank offline and
perfect on a developer's machine — is invisible until it is not.

## 5. Labels are ours, because the tiles carry no Serbian name

Measured, by decoding a real tile from the Protomaps build for Beograd
(`20261009.pmtiles`, z10): the attributes are `name` = `Београд` (Cyrillic),
`script` = `Cyrillic`, `name:en`, `name:hr`, `name:ru` and thirty-odd more — and
**no `name:sr` and no `name:sr-Latn`**. The vendor's label layers are built
around `name:<lang>`, with `name:en` as the fallback, so a style generated with
`lang: "sr-Latn"` renders English names on a Serbian map. That is not a bug to
work around; it is the data's own shape.

So the geometry layers are taken WITHOUT labels (`layers(source, flavour)` and
no `lang`), and the labels come from `labels.geojson`, which the builder writes
from the same OpenStreetMap extract: the Serbian Latin name, at a zoom its own
kind and population earn (`places.mjs`'s ladder — an editorial rule, stated as
one, because no data says when a village's name should appear). One symbol layer
per rung the data contains, each with that rung as its `minzoom` and a filter on
the feature's own `minZoom` — a filter cannot see the camera, so the timing
belongs to the layer, and the data says which layer.

Those layers need a font stack, and the pack ships exactly the stack they name:
`Noto Sans Regular`, nineteen ranges, 1.65 MB — the size the research measured
for the Latin + Latin-1 + punctuation + Greek + Cyrillic subset.

## 6. Search is a worker over the pack's own index

`places.json` is built from the same `.osm.pbf` the tiles come from: every node
with a `place` tag whose value the app knows, with its Serbian Latin name, its
Serbian Cyrillic name, the `name:en` an English reader may type, its kind, its
coordinates and its population. `places.json` is read, validated whole
(`parsePlacesFile`), folded once (`foldSearchText` — so `cacak`, `ČAČAK` and
`чачак` land on one row) and searched in a **Web Worker**, because a ranking
walks the whole index per keystroke and a stall while typing is exactly what the
project's rule about heavy work forbids.

The ranking is stated in `rankPlaces`: five tiers (exact, prefix, word prefix,
containment, every-word-prefix), then the kind's own weight, then population,
then the Serbian collator, then the node id — a total order, so the list cannot
change because an extract streamed differently.

## 7. No routing, and other regions are one line each

Routing needs a graph built per profile from a `.osm.pbf` on a machine with
gigabytes of RAM, a bundled service, and a data pack several times the size of
the map itself; the research's conclusion was to treat it as its own project,
and this ADR confirms it. Nothing in this module routes, measures along roads or
knows what a turn is: the distance tool is a great-circle sum between the points
a person clicks, and it says so.

A second region is a second pack and one row in
`apps/desktop/src/modules/maps/shared/packs.ts`; nothing in the page states a
coordinate of Serbia — the region's centre, zoom and bounds come from the style,
which the builder writes from Geofabrik's own polygon for the country.

## 8. The ODbL duties, and how each is met

ODbL 1.0 obliges a *user* of the data to give credit and to make the licence
clear. Two read: the rendered map, and the pack as data.

* **On the map, at all times.** The page draws the credit in the corner of the
  map — `© OpenStreetMap contributors · Data under the ODbL —
  https://www.openstreetmap.org/copyright` — from the app's own copy in both
  languages, and never fades it. The Attribution Guidelines allow a credit to
  collapse after five seconds provided it stays findable; always-visible is the
  stricter reading, it costs a line of type, and it is what a screenshot of this
  map gets right. The address is **printed, not linked**: this app refuses to
  open a URL from the renderer (ADR-089), and a link that does nothing would be
  worse than a URL somebody can copy. Search results carry the same credit,
  because an app that embeds a geocoder must credit the data it geocodes.
* **In the pack.** `ATTRIBUTION.txt` (the notice and the other components'
  licences), `LICENSE-ODbL.txt` (the licence text itself — 4.2 wants the text or
  its URI to travel with the data), and `CHANGES.txt` (the exact `pmtiles
  extract` command line and the extraction rules, which is the 4.6 offer).
  `sources.json` records every source's URL, date, size and SHA-256.
* **The cut is a country.** The research's Regional Cuts guideline: a
  share-alike obligation is confined by a cut that is at least a country, so the
  pack is Serbia's own polygon and not a radius around a city.
* **No non-OSM data enters these tiles.** Everything drawn over the basemap is
  the user's own pins; the Horizontal Layers rule is why nothing else is added
  to a feature type OSM already supplies.

## 9. What this ADR does not do

* **It adds no content host.** `DOWNLOAD_HOSTS` is untouched: no surface
  downloads a pack, and installing one is still the "Paketi sadržaja" card's
  folder dialog (ADR-091 §6). When the downloads run appends a content host,
  this pack needs no change.
* **It writes nothing into `apps/desktop/src/main/index.ts`.** The scheme, the
  handlers and the page are the module's and the shell's own; the one line the
  kit needs is in the module's folder.
* **It is not synced, journalled or wiped.** `maps_pins` is deliberately absent
  from `RESTORE_WIPE_TABLES` and from `@nexus/sync`'s collection map: ADR-090 §6
  says a kit module may not edit either (they are held equal by a guard test),
  and the kit's rule is the other one — the module replaces its own rows in its
  own `replaceFromArchive`, inside the restore's transaction. `timers_presets`
  and `elec_settings` are the documented precedents.

## 10. Consequences

* The app stays small: MapLibre and the PMTiles reader are a few megabytes, and
  the pack carries the weight (~350 MB for Serbia at z15, by the research's
  measurement-based estimate).
* `check:egress` gained exactly one exemption, for the single file that reads
  the pack's local scheme, naming one file and one rule id — with the reason
  written beside it in `scripts/check-egress.mjs`.
* A pack whose style names a network address is refused by name, on the page, in
  a sentence that says the pack has been changed.
* The map's own arithmetic (great-circle distance, decimal and DMS coordinates,
  the scale bar's metres per pixel) lives in `@nexus/core` with exact tests,
  because the same four functions will be wanted by an export or an archive
  long before they are wanted twice by a screen.
