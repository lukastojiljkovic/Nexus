// The map pack's style: the vendor's geometry layers painted with this app's
// tokens, our own place labels, and every address rewritten to the pack.
//
// THREE DECISIONS, and each is the answer to a question the vendor's own style
// generator cannot answer for us.
//
// 1. THE GEOMETRY IS THE VENDOR'S, THE COLOURS ARE OURS. `@protomaps/basemaps`
//    turns a "flavour" (a named colour per surface) into fifty-seven layers for
//    the Protomaps/OpenMapTiles-style schema. Its own flavours are its visual
//    design; what a Nexus map must wear is the Nexus palette, and the flavour is
//    exactly the seam for that — every colour those fifty-seven layers read is
//    named in `VENDOR_KEYS` below, and each one is mapped to a semantic token. A
//    key the vendor adds in a later version and this file does not name falls
//    back to the vendor's own value, which is a colour in somebody else's
//    palette — noticeable in a screenshot, which is the honest failure mode.
//
// 2. THE LABELS ARE OURS. The vendor's label layers are built around a
//    per-language `name:<lang>` field, and the Protomaps tiles carry no Serbian
//    name at all: a tile decoded for Beograd has `name` (Cyrillic), `name:en`,
//    `name:hr`, `name:ru` and forty more, and no `name:sr` or `name:sr-Latn`.
//    Asking for `lang: "sr-Latn"` therefore produces a style whose first line
//    falls back to ENGLISH on a Serbian map. So the geometry layers are taken
//    without labels (`layers(source, flavour)` and no `lang`), and the labels
//    come from `labels.geojson`, which this builder writes from the same OSM
//    extract: the Serbian Latin name, drawn at the zoom its own kind and
//    population earn. That is why `LABEL_SOURCE` exists and why the vendor's
//    `pois`/`places_*` layers are absent.
//
// 3. NO SPRITE, AND NO ADDRESS THAT IS NOT THE PACK. Nothing in a
//    geometry-plus-our-labels style draws a sprite image — the vendor's four
//    `icon-image` users (oneway arrows, route shields, POIs, locality dots) are
//    all in the label set this style omits — so a sprite sheet would be a
//    hundred kilobytes of pack that nothing reads. And every address the style
//    does carry is `nx-pack://`, which is the promise that the map works with
//    the network off: `assertLocalStyle` refuses anything else, and the app
//    checks the same property again when it loads the pack.

/** The source ids the style declares. */
export const TILE_SOURCE = "protomaps";
export const LABEL_SOURCE = "labels";

/** The font stack every label layer asks for. One stack, so the pack ships one set of glyph ranges. */
export const LABEL_FONT_STACK = "Noto Sans Regular";

/**
 * Every flavour key the vendor's NON-LABEL layers read, in the groups this
 * builder maps them from — measured, not guessed: running the vendor's own
 * `layers()` with a flavour wrapped in a `Proxy` that logs every property read
 * reports exactly these fifty-one keys for the geometry pass.
 *
 * Each group names a semantic token from `tokens.mjs`, and the mapping is a
 * DESIGN DECISION with a reason per group: land is paper and water is the
 * sunken surface beside it (a neutral, because this palette has no blue and the
 * app's rule forbids adding one); vegetation is the jade tint the rest of the
 * app uses for its own green; roads are the raised surface with a border-coloured
 * casing, and motorways are the accent's soft tint with its strong colour as the
 * edge; buildings and institutions are one step darker than land; boundaries
 * are ink, faint for a region and stronger for a country.
 */
const VENDOR_KEYS = {
  background: "surface-alt",
  earth: "surface",
  water: "surface-sunken",
  glacier: "surface",
  sand: "border-subtle",
  beach: "border-subtle",
  park_a: "data-soft",
  park_b: "data-soft",
  wood_a: "data-soft",
  wood_b: "data-soft",
  scrub_a: "data-soft",
  scrub_b: "data-soft",
  zoo: "data-soft",
  hospital: "surface-alt",
  school: "surface-alt",
  aerodrome: "surface-alt",
  runway: "surface-alt",
  pier: "surface-alt",
  industrial: "border-subtle",
  military: "border-subtle",
  pedestrian: "border-subtle",
  buildings: "border",
  minor_service: "surface-raised",
  minor_a: "surface-raised",
  minor_b: "surface-raised",
  link: "surface-raised",
  other: "surface-raised",
  minor_service_casing: "border",
  minor_casing: "border",
  link_casing: "border",
  major: "surface-raised",
  major_casing_early: "border-strong",
  major_casing_late: "border-strong",
  highway: "accent-soft",
  highway_casing_early: "accent-strong",
  highway_casing_late: "accent-strong",
  railway: "border-strong",
  boundaries: "text-faint",
  boundaries_country: "text-muted",
  tunnel_other_casing: "border-strong",
  tunnel_minor_casing: "border-strong",
  tunnel_link_casing: "border-strong",
  tunnel_major_casing: "border-strong",
  tunnel_highway_casing: "accent-strong",
  tunnel_other: "surface-raised",
  tunnel_minor: "surface-raised",
  tunnel_link: "surface-raised",
  tunnel_major: "surface-raised",
  tunnel_highway: "accent-soft",
  bridges_other_casing: "border",
  bridges_minor_casing: "border",
  bridges_link_casing: "border",
  bridges_major_casing: "border-strong",
  bridges_highway_casing: "accent-strong",
  bridges_other: "surface-raised",
  bridges_minor: "surface-raised",
  bridges_link: "surface-raised",
  bridges_major: "surface-raised",
  bridges_highway: "accent-soft",
};

/** The jade tint and the landcover matrix, which the vendor keeps inside one key. */
const LANDCOVER = {
  grassland: "data-soft",
  farmland: "data-soft",
  forest: "data-soft",
  scrub: "data-soft",
  urban_area: "surface-alt",
  barren: "border-subtle",
  glacier: "surface",
};

/**
 * The vendor's flavour with our palette written over it.
 *
 * The base is the vendor's `light` flavour in BOTH themes on purpose: the keys
 * this file does not name are the vendor's label colours, which no layer of our
 * style reads, and taking the light flavour's values for them keeps one list of
 * unused keys rather than two that could disagree.
 */
export function flavourFor(semantic, base) {
  const flavour = { ...base };
  for (const [key, token] of Object.entries(VENDOR_KEYS)) {
    flavour[key] = requireToken(semantic, token, `flavour key "${key}"`);
  }
  flavour.landcover = { ...(base.landcover ?? {}) };
  for (const [key, token] of Object.entries(LANDCOVER)) {
    flavour.landcover[key] = requireToken(semantic, token, `landcover "${key}"`);
  }
  return flavour;
}

/** One semantic token, refusing by name when the palette does not have it. */
export function requireToken(semantic, token, what) {
  const value = semantic[token];
  if (typeof value !== "string" || !/^(#|rgba?\()/.test(value)) {
    throw new Error(
      `map-serbia: the semantic token "${token}" (needed by ${what}) is missing from the palette.`,
    );
  }
  return value;
}

/**
 * The three label sizings, by the rung a place's label appears at.
 *
 * The bands are drawn at the RUNGS rather than at the kinds, because a layer's
 * layout is per layer: a rung of 6 holds both a municipality and a city of
 * twenty thousand people, and the two are drawn the same size — which is what a
 * map does anyway, since at that zoom they are the same amount of information.
 */
const LABEL_STYLES = {
  // A country, a region or a province: the largest type, muted, and never
  // uppercase — the names in this data are written the way a map prints them.
  region: {
    maxRung: 4,
    size: ["interpolate", ["linear"], ["zoom"], 4, 12, 8, 15],
    color: "text-muted",
    transform: "none",
  },
  // A city, a town or a municipality: the label a person reads the map by.
  locality: {
    maxRung: 10,
    size: ["interpolate", ["linear"], ["zoom"], 6, 11, 12, 15],
    color: "text",
    transform: "none",
  },
  // A village, a neighbourhood or a hamlet: small, and only once the streets are.
  subplace: {
    maxRung: 99,
    size: ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 12],
    color: "text-subtle",
    transform: "none",
  },
};

/**
 * One symbol layer per label rung the data contains.
 *
 * **Why per rung rather than one layer with a data-driven zoom.** MapLibre
 * cannot put a camera expression (`["zoom"]`) inside a `filter` — a filter is a
 * statement about a FEATURE — so "this place's label appears at zoom 11" has to
 * be said with the one thing that is per layer: `minzoom`. Each layer therefore
 * takes the features whose own `minZoom` is that rung, and the styling follows
 * the rung's own band.
 */
export function labelLayers(semantic, rungs, source = LABEL_SOURCE) {
  const halo = requireToken(semantic, "surface-raised", "a label's halo");
  const haloWidth = 1.2;
  return rungs.map((rung) => {
    const band =
      Object.values(LABEL_STYLES).find((style) => rung <= style.maxRung) ?? LABEL_STYLES.subplace;
    return {
      id: `nexus-labels-${String(rung)}`,
      type: "symbol",
      source,
      minzoom: rung,
      filter: ["==", ["get", "minZoom"], rung],
      layout: {
        "text-field": ["get", "name"],
        "text-font": [LABEL_FONT_STACK],
        "text-size": band.size,
        "text-transform": band.transform,
        "text-anchor": "center",
        // A label that overlapped another would be two names in one place; the
        // renderer's own collision pass decides which survives, and the order it
        // resolves them in is by size, which is the order a map reads in.
        "text-allow-overlap": false,
        "text-padding": 6,
        "symbol-sort-key": ["get", "minZoom"],
      },
      paint: {
        "text-color": requireToken(semantic, band.color, `a label's ink (${band.color})`),
        "text-halo-color": halo,
        "text-halo-width": haloWidth,
        "text-halo-blur": 0.4,
      },
    };
  });
}

/**
 * The whole style, with every address pointing into the pack.
 *
 * `center`, `zoom`, `bounds` and `name` come from the region the tiles were cut
 * out of, so the app never states a coordinate of Serbia and a second region is
 * a second build rather than a second branch in the page.
 */
export function packStyle({ semantic, geometryLayers, rungs, region, packId, files }) {
  return {
    version: 8,
    name: `Nexus map pack ${packId}`,
    // The Atlas-style camera fields, which is where MapLibre looks for a style's
    // own viewpoint.
    center: [region.center.lon, region.center.lat],
    zoom: region.zoom,
    bounds: region.bounds,
    sources: {
      [TILE_SOURCE]: { type: "vector", url: tileUrl(packId, files.tiles) },
      [LABEL_SOURCE]: { type: "geojson", data: packUrl(packId, files.labels) },
    },
    glyphs: packUrl(packId, files.glyphs),
    layers: [...geometryLayers, ...labelLayers(semantic, rungs)],
  };
}

/** `nx-pack://<packId>/<path>`: the scheme ADR-099 names, spelled once. */
export function packUrl(packId, path) {
  return `nx-pack://${packId}/${path}`;
}

/** The tile archive, read through PMTiles' own protocol: the renderer fetches it by range, in-process. */
export function tileUrl(packId, tiles) {
  return `pmtiles://${packUrl(packId, tiles)}`;
}

/** Every address a style asks the renderer to fetch, with the path it sits at. */
export function styleUrls(style) {
  const found = [];
  if (typeof style !== "object" || style === null) return found;
  if (typeof style.glyphs === "string") found.push({ at: "glyphs", url: style.glyphs });
  for (const [at, url] of spriteUrls(style.sprite)) found.push({ at, url });
  const sources = style.sources;
  if (typeof sources === "object" && sources !== null && !Array.isArray(sources)) {
    for (const [id, value] of Object.entries(sources)) {
      if (typeof value !== "object" || value === null) continue;
      if (typeof value.url === "string") found.push({ at: `sources.${id}.url`, url: value.url });
      if (Array.isArray(value.tiles)) {
        value.tiles.forEach((tile, index) => {
          if (typeof tile === "string") found.push({ at: `sources.${id}.tiles[${index}]`, url: tile });
        });
      }
      if (typeof value.data === "string") found.push({ at: `sources.${id}.data`, url: value.data });
    }
  }
  return found;
}

function spriteUrls(sprite) {
  if (typeof sprite === "string") return [["sprite", sprite]];
  if (!Array.isArray(sprite)) return [];
  const found = [];
  sprite.forEach((entry, index) => {
    if (typeof entry === "string") found.push([`sprite[${index}]`, entry]);
    else if (typeof entry === "object" && entry !== null && typeof entry.url === "string") {
      found.push([`sprite[${index}].url`, entry.url]);
    }
  });
  return found;
}

/** The addresses that would reach the network. Empty is the only acceptable answer for a pack's style. */
export function remoteStyleUrls(style) {
  return styleUrls(style).filter((entry) => /^\s*(https?:)?\/\//i.test(entry.url));
}

/**
 * Refuses a style this pack may not ship.
 *
 * The check is the whole reason the map can promise to work offline: a style is
 * data, every address in it is a request, and a pack whose style fell back to a
 * vendor URL would be a map that silently needs the network on one machine and
 * looks perfect on another.
 */
export function assertLocalStyle(style, packId) {
  const remote = remoteStyleUrls(style);
  if (remote.length > 0) {
    throw new Error(
      `map-serbia: the style would fetch ${remote.map((entry) => `${entry.at} → ${entry.url}`).join(", ")}` +
        `; a pack's style may only address its own pack (${packId}).`,
    );
  }
  const addresses = styleUrls(style);
  if (addresses.length < 3) {
    throw new Error(
      `map-serbia: the style carries ${String(addresses.length)} addresses; a pack's style needs a tile source, a label source and its glyphs.`,
    );
  }
  return style;
}

/**
 * Every font stack a style's labels can ask for, in a stable order.
 *
 * `text-font` is usually a plain array of names, but a vendored style may nest
 * it inside a `case`/`literal` expression (the vendor's own label layers do), so
 * this walks the value and collects the strings — and `["literal", [...]]` is
 * the shape a font stack takes inside an expression.
 */
export function fontStacksIn(style) {
  const stacks = new Set();
  for (const layer of style?.layers ?? []) {
    const value = layer?.layout?.["text-font"];
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      // The document's own form: the value IS the stack list.
      for (const name of value) stacks.add(name);
    } else {
      // Inside an expression, only a `literal` carries font names. Walking the
      // whole value recursively would collect `get`, `min_zoom` and the
      // operators, which is exactly what a naive version of this did.
      collectLiteralFonts(value, stacks);
    }
  }
  return [...stacks].sort();
}

function collectLiteralFonts(value, into) {
  if (!Array.isArray(value)) return;
  if (value[0] === "literal" && Array.isArray(value[1])) {
    for (const name of value[1]) if (typeof name === "string") into.add(name);
    return;
  }
  for (const entry of value) collectLiteralFonts(entry, into);
}
