// Where the map pack's sources come from, what licence each one carries, and the
// cache all of them land in.
//
// **The catalogue is the authority and `sources.json` is the record.** Every
// entry below carries the URL of a page that STATES the licence and the sentence
// on it, quoted: a source without evidence is not used, and a licence name on
// its own is a claim rather than evidence. What a build actually fetched — the
// date, the size and the digest — is written into `sources.json` beside the
// pack, because those are the three facts only a run can know.
//
// **Why the cache matters, and why the digests matter with it.** Two of these
// sources are hundreds of megabytes and one is 138 GB; a builder that fetched
// them again every time would be a builder nobody runs. So everything lands in
// `%TEMP%/nexus-pack-cache/map-serbia/` and a second run reuses it — and the
// digests are what turn "the cache was stale" into a refusal rather than a pack
// cut from yesterday's neighbours.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The pack's own id: the folder the app installs it into, and the authority in every URL it serves. */
export const PACK_ID = "map-serbia";
/** The style generator, pinned: two builds of one pack produce the same style. */
export const BASEMAPS_VERSION = "5.7.2";
/** The tile CLI, pinned: the release whose asset names this builder knows. */
export const PMTILES_VERSION = "1.31.2";
/** The app version this pack needs. */
export const MIN_APP_VERSION = "1.5.0";
/** The pack's own version; a rebuild is a new MINOR and the maintainer bumps it. */
export const PACK_VERSION = "2026.10.0";

/** Where a run downloads, and the one place it may write besides its output. */
export const CACHE = join(process.env.TEMP ?? "/tmp", "nexus-pack-cache", PACK_ID);
/** Where a run writes the pack folder. Never the repository: a pack is signed and uploaded, not committed. */
export const OUT = join(process.env.TEMP ?? "/tmp", "nexus-packs", PACK_ID);

/**
 * The glyph ranges the labels can need: Latin, Latin-1, punctuation, Greek and
 * Cyrillic, in the 256-codepoint steps MapLibre's glyph template is built from.
 * Nineteen files, measured by the research run at 1.65 MB for one stack.
 */
export const GLYPH_RANGES = [
  "0-255",
  "256-511",
  "512-767",
  "768-1023",
  "1024-1279",
  "1280-1535",
  "1536-1791",
  "1792-2047",
  "2048-2303",
  "2304-2559",
  "2560-2815",
  "2816-3071",
  "3072-3327",
  "3328-3583",
  "3584-3839",
  "3840-4095",
  "4096-4351",
  "4352-4607",
  "4608-4863",
];

/** Every source this builder reads, with the evidence for its licence. */
export const SOURCES = [
  {
    id: "planet-basemap",
    url: "https://build.protomaps.com/{date}.pmtiles",
    licence: "ODbL-1.0",
    licenceEvidence: {
      url: "https://raw.githubusercontent.com/protomaps/docs/main/basemaps/downloads.md",
      quote:
        "distributed as an [Open Database License](https://opendatacommons.org/licenses/odbl/) Produced Work (OpenStreetMap attribution required)",
    },
    note: "The daily Protomaps vector basemap build. Never downloaded whole: the region is cut out of it with byte-range requests by `pmtiles extract`, which is why this entry carries no digest.",
  },
  {
    id: "geofabrik-extract",
    url: "https://download.geofabrik.de/europe/serbia-latest.osm.pbf",
    licence: "ODbL-1.0",
    licenceEvidence: { url: "https://download.geofabrik.de/", quote: "License: ODbL 1.0" },
    note: "The OpenStreetMap extract the place index and the label file are built from, so the search index and the tiles describe the same country.",
  },
  {
    id: "geofabrik-index",
    url: "https://download.geofabrik.de/index-v1.json",
    licence: "ODbL-1.0",
    licenceEvidence: { url: "https://download.geofabrik.de/", quote: "License: ODbL 1.0" },
    note: "The region polygon, and therefore the pack's camera, comes from here: no coordinate of Serbia is typed into this builder.",
  },
  {
    id: "style-generator",
    url: `https://registry.npmjs.org/@protomaps/basemaps/-/basemaps-${BASEMAPS_VERSION}.tgz`,
    licence: "BSD-3-Clause",
    licenceEvidence: {
      url: "https://raw.githubusercontent.com/protomaps/basemaps/main/LICENSE.md",
      quote: "The BSD 3-Clause License (BSD-3-Clause)",
    },
    note: "The geometry layers. Its visual design is dedicated to the public domain under CC0: \"The visual design of the Protomaps basemap styles was created by Geraldine Sarmiento for Protomaps LLC and released under a Creative Commons 0 (CC0) license.\" (same file).",
  },
  {
    id: "pmtiles-cli",
    url: `https://github.com/protomaps/go-pmtiles/releases/tag/v${PMTILES_VERSION}`,
    licence: "BSD-3-Clause",
    licenceEvidence: {
      url: "https://raw.githubusercontent.com/protomaps/go-pmtiles/main/LICENSE",
      quote:
        "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met",
    },
    note: "A BUILD TOOL. It is never shipped inside the app and never committed: it is fetched into the cache, cuts the region, and stays there.",
  },
  {
    id: "noto-sans-glyphs",
    url: "https://protomaps.github.io/basemaps-assets/fonts/Noto%20Sans%20Regular/{range}.pbf",
    licence: "OFL-1.1",
    licenceEvidence: {
      url: "https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts/OFL.txt",
      quote: "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
    },
    note: "The signed-distance-field glyph sets the labels are drawn with, one file per 256-codepoint range.",
  },
  {
    id: "odbl-text",
    url: "https://opendatacommons.org/licenses/odbl/1-0/",
    licence: "ODbL-1.0",
    licenceEvidence: {
      url: "https://opendatacommons.org/licenses/odbl/1-0/",
      quote: "Open Database License (ODbL) v1.0",
    },
    note: "The licence text itself, shipped inside the pack: a conveyed database must carry it (ODbL 4.2).",
  },
];

/** The catalogue entry for one id, refusing by name when it is not there. */
export function sourceOf(id) {
  const source = SOURCES.find((candidate) => candidate.id === id);
  if (source === undefined) throw new Error(`map-serbia: no source "${id}" in the catalogue.`);
  return source;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** One file as this builder records it: what it is, how big, and its digest. */
export function record(path, bytes) {
  return { path, size: bytes.byteLength, sha256: sha256(bytes) };
}

/** A size a person reads: `1.7 MB`, not `1733498`. */
export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${String(bytes)} B`;
}

async function get(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`GET ${url} answered ${String(response.status)}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** A cached fetch: a second run of this builder does not ask for anything twice. */
export async function cached(url, name, log = () => undefined) {
  const path = join(CACHE, name);
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    log(`cache hit  ${name} (${formatBytes(bytes.byteLength)})`);
    return { path, bytes };
  }
  log(`fetching   ${url}`);
  const bytes = await get(url);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, bytes);
  log(`fetched    ${name} (${formatBytes(bytes.byteLength)})`);
  return { path, bytes };
}

/** One source's size by HEAD — the planet build is 138 GB, and this is how its size is known without fetching it. */
export async function headSize(url) {
  const response = await fetch(url, { method: "HEAD" });
  if (!response.ok) throw new Error(`HEAD ${url} answered ${String(response.status)}`);
  return Number(response.headers.get("content-length") ?? 0);
}

/**
 * The newest dated build the Protomaps channel offers.
 *
 * The channel's own index is a JSON array of `{ key: "YYYYMMDD.pmtiles", … }`;
 * the daily builds are kept for about a week, so an older date in a script would
 * be a builder that stops working seven days after it was written.
 */
export async function newestBuild() {
  const bytes = await get("https://build-metadata.protomaps.dev/builds.json");
  const builds = JSON.parse(new TextDecoder().decode(bytes));
  const dated = (Array.isArray(builds) ? builds : [])
    .map((entry) => String(entry.key ?? ""))
    .filter((key) => /^\d{8}\.pmtiles$/.test(key))
    .sort();
  const newest = dated[dated.length - 1];
  if (newest === undefined) throw new Error("map-serbia: no dated build in the Protomaps channel.");
  return newest.replace(".pmtiles", "");
}

/**
 * The `pmtiles` CLI in the cache, fetched and unpacked once.
 *
 * The archive is chosen by platform and unpacked with the platform's own `tar`
 * (`.tar.gz` everywhere; `.zip` only where the system tar is bsdtar, which is
 * Windows 10 and later). If that fails the error names the file to unpack by
 * hand: a build tool that silently cannot run is worse than one that says so.
 */
export async function pmtilesCli(log = () => undefined) {
  const asset = cliAsset();
  const url = `https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/${asset}`;
  const archive = await cached(url, asset, log);
  const dir = unpack(archive.path, `go-pmtiles-${PMTILES_VERSION}`, asset.endsWith(".zip") ? "zip" : "tar.gz");
  const cli = join(dir, process.platform === "win32" ? "pmtiles.exe" : "pmtiles");
  if (!existsSync(cli)) {
    throw new Error(
      `map-serbia: ${asset} did not unpack to ${cli}. Unpack it into ${dir} by hand and run this again.`,
    );
  }
  return cli;
}

function cliAsset() {
  const arch = process.arch === "arm64" ? "arm64" : "x86_64";
  if (process.platform === "win32") return `go-pmtiles_${PMTILES_VERSION}_Windows_${arch}.zip`;
  if (process.platform === "darwin") return `go-pmtiles-${PMTILES_VERSION}_Darwin_${arch}.zip`;
  return `go-pmtiles_${PMTILES_VERSION}_Linux_${arch}.tar.gz`;
}

/** Unpack one cached archive into a directory beside it, once. */
export function unpack(archive, name, kind) {
  const dir = join(CACHE, `${name}-${kind}`);
  const marker = join(dir, ".unpacked");
  if (existsSync(marker)) return dir;
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync("tar", ["-xf", archive, "-C", dir], { stdio: "inherit" });
  } catch (error) {
    throw new Error(
      `map-serbia: the platform's tar could not unpack ${archive} (${String(error)}). ` +
        "On Windows the system tar reads a .zip; elsewhere unpack the .tar.gz by hand.",
      { cause: error },
    );
  }
  writeFileSync(marker, "");
  return dir;
}

/**
 * The region this pack is cut from: Geofabrik's own polygon for Serbia.
 *
 * Nothing about Serbia is typed in here — not its bounding box, not its centre.
 * The polygon decides both, and the zoom is the level at which the region's
 * width fits one screen: `2^z >= 360 / spanLon`, floored and clamped to a
 * readable range. A second region changes one argument and nothing else.
 */
export function regionFrom(index, id) {
  const feature = (index.features ?? []).find((candidate) => candidate.properties?.id === id);
  if (feature === undefined) throw new Error(`map-serbia: the region "${id}" is not in the index.`);
  const points = [];
  const walk = (node) => {
    if (typeof node[0] === "number") points.push(node);
    else for (const child of node) walk(child);
  };
  walk(feature.geometry.coordinates);
  if (points.length === 0) throw new Error(`map-serbia: the region "${id}" has no coordinates.`);
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const bounds = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  const spanLon = bounds[2] - bounds[0];
  return {
    bounds,
    center: { lon: (bounds[0] + bounds[2]) / 2, lat: (bounds[1] + bounds[3]) / 2 },
    zoom: Math.max(3, Math.min(9, Math.floor(Math.log2(360 / spanLon)))),
    geometry: feature.geometry,
  };
}

/**
 * A fetched HTML page as text.
 *
 * Block-level tags become a line break — `<p>one</p><p>two</p>` is two lines and
 * not `onetwo` — and every other tag is dropped, so an inline `<a>` inside a
 * sentence does not break it in half. Scripts and styles go entirely: they are
 * the page's behaviour rather than its words, and a licence text made of them
 * would be a licence text nobody could read.
 */
export function plainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // A line break where a block ENDS — not where one begins, and not both:
    // `</h1><p>` is one break between two lines, and two would leave a blank
    // line between every paragraph of the licence.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|section|article|table|ul|ol|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
