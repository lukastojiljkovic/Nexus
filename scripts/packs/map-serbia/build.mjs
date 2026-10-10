// The map pack's builder: everything from the sources to a folder
// `scripts/pack-sign.mjs` can sign.
//
//   node scripts/packs/map-serbia/build.mjs [--build=YYYYMMDD] [--maxzoom=15]
//
// WHAT IT DOES, in order, and each step says what it fetched and how long it
// took: the region polygon and the camera come out of Geofabrik's own index; the
// style is generated from `@protomaps/basemaps`, painted with this app's tokens
// and given this module's own place labels; the tiles are cut out of the
// Protomaps planet build with `pmtiles extract`; the place index and the label
// file are read from the same OpenStreetMap extract; the glyph ranges the style
// asks for are fetched; the ODbL text, the attribution and a record of what was
// altered ride along; and `sources.json` records every URL, date, size and
// digest the run measured.
//
// NOTHING HERE IS COMMITTED. The pack lands in `%TEMP%/nexus-packs/map-serbia/`,
// the maintainer signs it with the release key and uploads it, and the repository
// keeps this script, its tests and the small fixtures beside them.

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readOsmNodes } from "./pbf.mjs";
import {
  MAX_PLACES,
  appPlaceKinds,
  buildPlaces,
  labelRungs,
  labelsGeoJson,
  placesFile,
} from "./places.mjs";
import {
  BASEMAPS_VERSION,
  CACHE,
  GLYPH_RANGES,
  MIN_APP_VERSION,
  OUT,
  PACK_ID,
  PACK_VERSION,
  cached,
  formatBytes,
  headSize,
  newestBuild,
  plainText,
  pmtilesCli,
  record,
  regionFrom,
  sha256,
  sourceOf,
  unpack,
} from "./sources.mjs";
import { LABEL_FONT_STACK, assertLocalStyle, flavourFor, fontStacksIn, packStyle } from "./style.mjs";
import { readTokenFiles } from "./tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const args = parseArgs(process.argv.slice(2));
const started = Date.now();
const log = (message) => console.log(`[${String(Math.round((Date.now() - started) / 1000))}s] ${message}`);

function parseArgs(argv) {
  const parsed = { build: null, maxzoom: 15 };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "build") parsed.build = value ?? null;
    else if (key === "maxzoom") parsed.maxzoom = Number(value);
    else throw new Error(`unknown argument "${arg}"; usage: --build=YYYYMMDD --maxzoom=15`);
  }
  return parsed;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const sources = [];
  const now = () => new Date().toISOString();

  // 1. The region, from Geofabrik's index.
  const index = await cached(sourceOf("geofabrik-index").url, "index-v1.json", log);
  const region = regionFrom(JSON.parse(new TextDecoder().decode(index.bytes)), "serbia");
  const regionText = `${JSON.stringify({ type: "Feature", properties: {}, geometry: region.geometry })}\n`;
  writeFileSync(join(OUT, "region.geojson"), regionText);
  sources.push({ ...sourceOf("geofabrik-index"), files: [record("region.geojson", Buffer.from(regionText))], fetched: now() });
  log(
    `region     Serbia: ${formatBounds(region.bounds)}, centre ` +
      `${region.center.lon.toFixed(3)}/${region.center.lat.toFixed(3)}, zoom ${String(region.zoom)}`,
  );

  // 2. The tokens, and the style generator they are painted into.
  const tokens = readTokenFiles(REPO_ROOT);
  const generator = await cached(sourceOf("style-generator").url, `basemaps-${BASEMAPS_VERSION}.tgz`, log);
  const generatorDir = unpack(generator.path, `basemaps-${BASEMAPS_VERSION}`, "tar.gz");
  const vendor = await import(pathToFileURL(join(generatorDir, "package/dist/esm/index.js")).href);
  sources.push({
    ...sourceOf("style-generator"),
    files: [record(`basemaps-${BASEMAPS_VERSION}.tgz`, generator.bytes)],
    fetched: now(),
  });

  // 3. The place index and the label file, from the ODbL extract.
  const extract = await cached(sourceOf("geofabrik-extract").url, "serbia-latest.osm.pbf", log);
  const collected = [];
  const counts = readOsmNodes(extract.path, (entry) => collected.push(entry));
  const { places, skipped } = buildPlaces(collected, appPlaceKinds());
  if (places.length === 0) throw new Error("map-serbia: the extract yielded no places at all.");
  if (places.length > MAX_PLACES) throw new Error("map-serbia: far too many places; is that one country's extract?");
  const placesText = `${JSON.stringify(placesFile("serbia", places))}\n`;
  const labelsText = `${JSON.stringify(labelsGeoJson(places))}\n`;
  writeFileSync(join(OUT, "places.json"), placesText);
  writeFileSync(join(OUT, "labels.geojson"), labelsText);
  sources.push({
    ...sourceOf("geofabrik-extract"),
    files: [record("serbia-latest.osm.pbf", extract.bytes), record("places.json", Buffer.from(placesText)), record("labels.geojson", Buffer.from(labelsText))],
    fetched: now(),
  });
  log(
    `places     ${String(places.length)} places from ${String(counts.nodes)} nodes ` +
      `(left out: ${String(skipped.kind)} other kind, ${String(skipped.nameless)} unnamed, ${String(skipped.repeated)} repeated)`,
  );

  // 4. Both styles: the vendor's geometry, our palette, our labels.
  const rungs = labelRungs(places);
  for (const theme of ["dan", "noc"]) {
    const style = packStyle({
      semantic: tokens[theme],
      geometryLayers: vendor.layers("protomaps", flavourFor(tokens[theme], vendor.namedFlavor("light"))),
      rungs,
      region,
      packId: PACK_ID,
      files: {
        tiles: "maps.pmtiles",
        labels: "labels.geojson",
        glyphs: "fonts/{fontstack}/{range}.pbf",
      },
    });
    assertLocalStyle(style, PACK_ID);
    const json = `${JSON.stringify(style, null, 1)}\n`;
    writeFileSync(join(OUT, `style.${theme}.json`), json);
    log(`style      style.${theme}.json: ${String(style.layers.length)} layers, ${formatBytes(Buffer.byteLength(json))}`);
  }

  // 5. The glyphs the style asks for, and only those stacks.
  const stacks = fontStacksIn(JSON.parse(readFileSync(join(OUT, "style.dan.json"), "utf8")));
  if (stacks.length !== 1 || stacks[0] !== LABEL_FONT_STACK) {
    throw new Error(
      `map-serbia: the style asks for ${stacks.join(", ")}; this builder ships ${LABEL_FONT_STACK}.`,
    );
  }
  const glyphFiles = [];
  for (const range of GLYPH_RANGES) {
    const file = await cached(sourceOf("noto-sans-glyphs").url.replace("{range}", range), `NotoSansRegular-${range}.pbf`, log);
    const target = join(OUT, "fonts", LABEL_FONT_STACK, `${range}.pbf`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
    glyphFiles.push(record(`fonts/${LABEL_FONT_STACK}/${range}.pbf`, file.bytes));
  }
  sources.push({ ...sourceOf("noto-sans-glyphs"), files: glyphFiles, fetched: now() });
  log(`glyphs     ${String(glyphFiles.length)} ranges for "${LABEL_FONT_STACK}"`);

  // 6. The tiles: the region cut out of the planet build by range requests.
  const build = args.build ?? (await newestBuild());
  const planetUrl = `https://build.protomaps.com/${build}.pmtiles`;
  const planetSize = await headSize(planetUrl);
  const cli = await pmtilesCli(log);
  log(`extract    ${planetUrl} (${formatBytes(planetSize)} at the source) -> maps.pmtiles`);
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    cli,
    [
      "extract",
      planetUrl,
      join(OUT, "maps.pmtiles"),
      `--region=${join(OUT, "region.geojson")}`,
      `--maxzoom=${String(args.maxzoom)}`,
    ],
    { stdio: "inherit" },
  );
  const tiles = readFileSync(join(OUT, "maps.pmtiles"));
  sources.push({
    ...sourceOf("planet-basemap"),
    url: planetUrl,
    size: planetSize,
    sha256: null,
    files: [record("maps.pmtiles", tiles)],
    fetched: now(),
  });
  log(`tiles      maps.pmtiles: ${formatBytes(tiles.byteLength)}, ${sha256(tiles).slice(0, 12)}…`);

  // 7. The licence, the notice, and the record of what was altered.
  const odblPage = await cached(sourceOf("odbl-text").url, "odbl-1-0.html", log);
  const odblText = plainText(new TextDecoder().decode(odblPage.bytes));
  if (odblText.length < 20_000 || !odblText.includes("Open Database License")) {
    throw new Error(
      "map-serbia: the fetched ODbL page did not strip to the licence text; refusing to ship a truncated licence.",
    );
  }
  writeFileSync(join(OUT, "LICENSE-ODbL.txt"), `${odblText}\n`);
  writeFileSync(join(OUT, "ATTRIBUTION.txt"), attributionText());
  writeFileSync(join(OUT, "CHANGES.txt"), changesText(planetUrl, build));

  // 8. What was fetched, and the metadata the signing tool reads.
  writeFileSync(
    join(OUT, "sources.json"),
    `${JSON.stringify({ pack: PACK_ID, generated: now(), sources }, null, 1)}\n`,
  );
  // The metadata is written BESIDE the pack folder and not inside it: `pack.json`
  // lists every file the folder holds, and a build's own metadata is not content.
  const metaPath = join(dirname(OUT), `${PACK_ID}.meta.json`);
  writeFileSync(metaPath, `${JSON.stringify(metadata(planetUrl), null, 2)}\n`);

  log(`done       ${OUT}`);
  log(`next       node scripts/pack-sign.mjs --dir ${OUT} --meta ${metaPath} --key <release-key.pem>`);
}

function formatBounds([west, south, east, north]) {
  return `${west.toFixed(2)}..${east.toFixed(2)} E, ${south.toFixed(2)}..${north.toFixed(2)} N`;
}

/**
 * The notice the pack itself carries.
 *
 * ODbL 4.2 requires a conveyed database to carry the licence (or its URI) and
 * the attribution, and 4.3 requires a Produced Work to make its source
 * understandable to anyone who sees it. This file is those duties written out,
 * and the same words are drawn on the map by the app.
 */
function attributionText() {
  return [
    "Map data from OpenStreetMap",
    "",
    "© OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
    "",
    "The map data in this pack is OpenStreetMap data, made available under the Open",
    "Database License (ODbL) v1.0. The licence text is in LICENSE-ODbL.txt beside this",
    "file. The vector tiles are a Produced Work made from that database; places.json",
    "and labels.geojson are built from the same extract and carry nothing else.",
    "",
    "Other components and their licences:",
    "  - MapLibre GL JS (renderer) — BSD-3-Clause",
    "  - PMTiles (tile format and library) — BSD-3-Clause; the specification is CC0",
    "  - @protomaps/basemaps (style geometry) — BSD-3-Clause; its visual design CC0",
    "  - Noto Sans glyphs — SIL Open Font License 1.1 (fonts/OFL.txt ships with them",
    "    in the source repository; the glyph files here are unmodified subsets)",
    "  - go-pmtiles (the tool that cut the region) — BSD-3-Clause; a build tool, not",
    "    part of this pack",
    "",
  ].join("\n");
}

/** What was altered: the source offer ODbL 4.6 asks for, as a recipe anybody can run. */
function changesText(planetUrl, build) {
  return [
    "What this pack is, and what was done to the data it carries.",
    "",
    "Method, exactly:",
    "",
    `  1. The vector tiles were cut out of the Protomaps planet build (${build}.pmtiles)`,
    "     with the go-pmtiles CLI:",
    "",
    `       pmtiles extract ${planetUrl} maps.pmtiles \\`,
    "         --region=region.geojson --maxzoom=" + String(args.maxzoom),
    "",
    "     That selects, verbatim, the tiles inside the region polygon published by",
    "     Geofabrik for Serbia (region.geojson, shipped in this folder). No geometry",
    "     and no attribute was edited.",
    "",
    "  2. places.json and labels.geojson were read out of",
    "     https://download.geofabrik.de/europe/serbia-latest.osm.pbf by",
    "     scripts/packs/map-serbia/build.mjs: the nodes carrying a place tag, their",
    "     names (name, name:sr, name:sr-Latn, name:en), their coordinates and their",
    "     population. Nothing was re-worded. Rows that are not a place kind this app",
    "     draws, carry no name, or state a name past the app's bound were left out, and",
    "     the counts are printed by the build.",
    "",
    `  3. The style was generated from @protomaps/basemaps ${BASEMAPS_VERSION} and painted with`,
    "     the Nexus design tokens. Every address in it points into this pack.",
    "",
    "  4. The label glyphs are the Noto Sans Regular ranges the style can ask for, as",
    "     published by Protomaps, unmodified.",
    "",
    "Every source's URL, fetch date, size and SHA-256 are in sources.json, which sits",
    "beside this file in the pack.",
    "",
  ].join("\n");
}

/** The metadata `pack-sign.mjs` takes: what the pack IS, without `files`, which the tool computes. */
function metadata(planetUrl) {
  return {
    id: PACK_ID,
    version: PACK_VERSION,
    kind: "map",
    title: { sr: "Mapa Srbije", en: "Map of Serbia" },
    description: {
      sr: "Detaljna karta Srbije koja radi bez interneta: ulice, naselja i pretraga mesta.",
      en: "A detailed map of Serbia that works offline: streets, settlements and place search.",
    },
    licence: {
      spdx: "ODbL-1.0",
      attribution: "© OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
      url: "https://opendatacommons.org/licenses/odbl/1-0/",
    },
    source: { name: "OpenStreetMap via Geofabrik, vector tiles from the Protomaps basemap build", url: planetUrl },
    minAppVersion: MIN_APP_VERSION,
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
