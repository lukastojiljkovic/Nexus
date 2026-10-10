/**
 * The map packs this build knows how to draw, and the file names it expects
 * inside one.
 *
 * **Why the app names the pack id at all.** A pack is installed under
 * `<userData>/packs/<id>/<version>/`, and the app reads it through the
 * `nx-pack://<packId>/<path>` scheme — so the id is the one fact the renderer
 * needs in order to address the files of the map it draws. There is no channel
 * that lists installed packs to a module (ADR-091's `packs:list` is the Packs
 * card's own surface), and there does not need to be: the regions this build can
 * draw are a list compiled into the app, exactly as a curated catalogue is, and
 * a region arrives with one row here.
 *
 * **What happens when the pack is not installed.** Every read fails, and the
 * page says so and names the card that installs it. That is a better answer than
 * a "which packs do you have" round trip: the question the page actually has is
 * "can I read the pack I know how to draw", and a failed read answers it.
 *
 * **The file names are a contract with the pack's builder.** They are stated
 * here, in the app, and again in `scripts/packs/map-serbia/build.mjs` — the two
 * sides of a pack's layout cannot import each other (one is TypeScript the
 * renderer bundles, the other a Node script), and `docs/packs/map-serbia.md`
 * is the third statement of the same list. The builder's own test writes the
 * four names out, so a rename costs a failing test rather than a blank map.
 */

/** The region this build ships a pack for. A second region is a second row and nothing else. */
export const MAP_PACK_REGIONS = ["map-serbia"] as const;

/** The region the page draws. */
export const MAP_PACK_ID: string = MAP_PACK_REGIONS[0];

/** The two style variants, one per theme. A theme is a different palette, and the style is where a palette lives. */
export const MAP_PACK_STYLES = {
  dan: "style.dan.json",
  noc: "style.noc.json",
} as const;

export type MapPackTheme = keyof typeof MAP_PACK_STYLES;

/** The tile archive: one PMTiles file, the whole of the basemap (ADR-099). */
export const MAP_PACK_TILES = "maps.pmtiles";

/** The place index the search and the labels both read. */
export const MAP_PACK_PLACES = "places.json";

/** The glyph template the pack ships, as a MapLibre style states it … */
export const MAP_PACK_GLYPHS_TEMPLATE = "fonts/{fontstack}/{range}.pbf";
