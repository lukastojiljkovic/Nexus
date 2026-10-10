# Fixtures for the `map-serbia` builder

Small, real files, committed so the builder's tests run with no network. Each
one is a cut of a published source, and each source's licence permits this; the
`sources.json` beside the builder carries the URLs and the digests.

| File | Where it came from | Licence |
| --- | --- | --- |
| `data_pbf_version-1.osm.pbf` (119 B) | `osmcode/libosmium`, `test/t/io/` — written by Osmosis; its XML oracle `data_pbf_version-1.osm` is in the same directory and holds `<node id="2" lat="50" lon="10.01"/>` | Boost Software License 1.0 |
| `data_pbf_version-1-densenodes.osm.pbf` (136 B) | same directory: the same node in the dense encoding | Boost Software License 1.0 |
| `deleted_nodes.osh.pbf` (189 B) | same directory; its XML oracle holds a deleted node (id 1, `visible="false"`) and a live one (id 2, `lat="1" lon="1"`) | Boost Software License 1.0 |
| `protomaps-style-5.7.2.json` | a cut of the style `@protomaps/basemaps` 5.7.2 generates: thirteen of its seventy-one layers, verbatim, including the `places_locality` layer whose per-language expression the builder deliberately does not use | BSD-3-Clause code; CC0 visual design |
| `protomaps-flavour-light.json` | `namedFlavor("light")` from the same package, verbatim | BSD-3-Clause |
| `geofabrik-index-mini.json` | Geofabrik's `index-v1.json` cut to two features, so the region reader can be tested without a 3.8 MB download | ODbL-1.0 |
| `serbia-place-nodes.json` | a cut of an Overpass API answer read on 2026-10-10 (`node[place][name]` over six bounding boxes around Beograd, Novi Sad, Niš, Čačak, Kraljevo and Grdica), keeping the tags the converter reads | ODbL (OpenStreetMap data) |

The two generated fixtures (the style and the flavour) were written by importing
the pinned package from its tarball and serialising the result:

```bash
node -e 'import("<cache>/basemaps/package/dist/esm/index.js").then((m) => …)'
```

The style cut keeps the layers
`background earth landcover water water_river buildings roads_minor_casing
roads_minor roads_highway boundaries_country roads_labels_major places_locality
places_country` — enough for every assertion the tests make about addresses,
font stacks and layer shapes.
