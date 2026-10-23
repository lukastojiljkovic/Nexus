// No shebang — this module is both a CLI and an import target for its own test.
//
// Builds the world outline the map picker draws and the neutral layer of
// disputed areas drawn over it, each reduced to the fields the app reads and to
// a size it can ship.
//
//   node scripts/maps/world-outline.mjs
//
// It downloads three Natural Earth sources once into
// `%TEMP%\nexus-pack-cache\world-outline\` (a present file is reused, and every
// SHA-256 is printed) and writes `outline.json` and `disputed.json` beside this
// repository's typed readers. The README there records the sources and licence.
//
// The same polygons decide which map tiles a region's download contains, so the
// outline keeps what the source says exactly: the simplification only drops a
// vertex that lies within the tolerance of the line through its neighbours, and
// the endpoints of every ring always survive. Simplification is plain
// Douglas–Peucker, written here so the build needs no dependency.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeCacheFile } from "../packs/lib/cacheWrite.mjs";
import { readIfPresent } from "../packs/lib/readIfPresent.mjs";

export const SOURCE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";
export const DISPUTED_SOURCE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_disputed_areas.geojson";
export const ADMIN1_SOURCE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";

const CACHE_DIR = join(tmpdir(), "nexus-pack-cache", "world-outline");
const SOURCE_FILE = join(CACHE_DIR, "ne_50m_admin_0_countries.geojson");
const DISPUTED_SOURCE_FILE = join(CACHE_DIR, "ne_10m_admin_0_disputed_areas.geojson");
const ADMIN1_SOURCE_FILE = join(CACHE_DIR, "ne_10m_admin_1_states_provinces.geojson");
const OUTLINE_OUTPUT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/desktop/src/modules/maps/shared/world/outline.json",
);
const DISPUTED_OUTPUT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/desktop/src/modules/maps/shared/world/disputed.json",
);

/**
 * Douglas–Peucker tolerance, in degrees (about 1.1 km at the equator). The
 * finest value swept that stays under the size ceiling, measured on the 1:50m
 * source: 0.01 gives 1 245 894 bytes and 72 310 positions, from 99 613 in the
 * source; 0.005 gave 1 523 106 bytes, over the ceiling. The sweep is in the README.
 */
export const SIMPLIFY_TOLERANCE = 0.01;
/**
 * Decimal places kept on every coordinate. Three is about 110 m at the equator,
 * and the sweep gave 1 245 894 bytes at three against 1 391 558 at four.
 */
export const COORDINATE_DECIMALS = 3;
/** The shipped file's ceiling, in bytes. The build refuses to write a larger one. */
export const MAX_OUTLINE_BYTES = 1_500_000;
/** The disputed layer's shipped ceiling. */
export const MAX_DISPUTED_BYTES = 250_000;

/**
 * The explicit decisions for records Natural Earth cannot state neutrally or
 * completely. One reason travels with each decision so the override table is
 * reviewable without reading the builder.
 */
export const DISPUTE_OVERRIDE_REASONS = Object.freeze({
  // The whole state is not a disputed territory; its disputed parts are separate features.
  Israel: "The whole state is not a disputed territory; its disputed parts are separate features.",
  // Natural Earth leaves Gaza without a note.
  Gaza: "The source note is empty; the dispute is between Israel and Palestine.",
  // Natural Earth leaves the West Bank without a note.
  "West Bank": "The source note is empty; the dispute is between Israel and Palestine.",
  // Natural Earth leaves Kosovo without a note.
  Kosovo: "The source note is empty; the dispute is between Kosovo and Serbia.",
  // Natural Earth leaves Belize without a note.
  Belize: "The source note is empty; the dispute is between Belize and Guatemala.",
  // Natural Earth leaves Dragonja without a note.
  "Dragonja River": "The source note is empty; the dispute is between Croatia and Slovenia.",
  // Natural Earth leaves Vukovar Island without a note.
  "Vukovar Island": "The source note is empty; the dispute is between Croatia and Serbia.",
  // Natural Earth leaves Sarengrad Island without a note.
  "Šarengrad Island": "The source note is empty; the dispute is between Croatia and Serbia.",
  // This misspelt duplicate carries no note and repeats Ilemi Triangle.
  "Ilemi Triange": "The misspelt duplicate is merged into Ilemi Triangle.",
  // The two W. Sahara records are the two perspectives on one territory.
  "W. Sahara": "The two perspectives are one Western Sahara area.",
  // Natural Earth leaves North Borneo without a note.
  "North Borneo": "The source note is empty; the dispute is between Malaysia and the Philippines.",
  // Natural Earth leaves Ceuta without a note.
  Ceuta: "The empty Geo subunit is included; the dispute is between Morocco and Spain.",
  // Natural Earth leaves Melilla without a note.
  Melilla: "The empty Geo subunit is included; the dispute is between Morocco and Spain.",
  // Natural Earth leaves the Cyprus buffer zone without a note.
  "Cyprus U.N. Buffer Zone": "The source note is empty; the parties are Cyprus and Northern Cyprus.",
  // Natural Earth omits Vietnam from the Spratly claimants.
  "Spratly Is.": "Vietnam also claims the Spratlys.",
  // Claimed by multiple cannot be resolved by the note parser.
  "Bird Island": "The source says only multiple; the named claimants are Dominica and Venezuela.",
  // Bir Tawil is terra nullius, not a two-party dispute.
  "Bir Tawil": "No state claims Bir Tawil; the note kind is unclaimed.",
  // Artsakh dissolved and is no longer disputed.
  Artsakh: "The Republic of Artsakh dissolved on 2024-01-01; the area is no longer disputed.",
  "Hans Island": "Canada and Denmark divided the island by their treaty of 14 June 2022.",
  // The breakaway polygons are narrower than the oblasts now claimed.
  "Donetsk People's Republic": "The breakaway polygon is replaced by Donetsk Oblast.",
  // The breakaway polygons are narrower than the oblasts now claimed.
  "Luhansk People's Republic": "The breakaway polygon is replaced by Luhansk Oblast.",
  // Russia claimed the whole oblast in 2022.
  "UA-14": "Donetsk Oblast is disputed because Russia claims the whole oblast.",
  // Russia claimed the whole oblast in 2022.
  "UA-09": "Luhansk Oblast is disputed because Russia claims the whole oblast.",
  // Russia claimed the whole oblast in 2022.
  "UA-23": "Zaporizhzhia Oblast is disputed because Russia claims the whole oblast.",
  // Russia claimed the whole oblast in 2022.
  "UA-65": "Kherson Oblast is disputed because Russia claims the whole oblast.",
  // The source has only an offshore polygon and does not use the common name.
  "Senkaku / Diaoyu Islands": "The islands are marked as a point and named for both disputed names.",
  // A point makes the small rocks visible at world scale.
  "Liancourt Rocks": "The rocks are marked as a point at world scale.",
  // A point makes the reef visible at world scale.
  "Scarborough Shoal": "The reef is marked as a point at world scale.",
  // Natural Earth's disputed layer omits this island.
  "Machias Seal Island": "Natural Earth's disputed layer omits the island; Canada and the United States claim it.",
});

/** Natural Earth's country spellings, mapped once into the outline's ADM0_A3 ids. */
const PARTY_IDS = Object.freeze({
  "American Samoa": "ASM",
  Argentina: "ARG",
  "Azer.": "AZE",
  Azerbaijan: "AZE",
  Belize: "BLZ",
  Brazil: "BRA",
  Bhutan: "BTN",
  Brunei: "BRN",
  Canada: "CAN",
  Chile: "CHL",
  China: "CHN",
  Colombia: "COL",
  Comoros: "COM",
  Croatia: "HRV",
  Cuba: "CUB",
  Cyprus: "CYP",
  Denmark: "DNK",
  Djibouti: "DJI",
  Dominica: "DMA",
  Egypt: "EGY",
  "Equatorial Guinea": "GNQ",
  Eritrea: "ERI",
  France: "FRA",
  Gabon: "GAB",
  Georgia: "GEO",
  Guatemala: "GTM",
  Guyana: "GUY",
  Haiti: "HTI",
  Honduras: "HND",
  Iceland: "ISL",
  Iran: "IRN",
  India: "IND",
  Ireland: "IRL",
  Israel: "ISR",
  Jamaica: "JAM",
  Japan: "JPN",
  Kazakhstan: "KAZ",
  Kenya: "KEN",
  Lebanon: "LBN",
  Madagascar: "MDG",
  Malaysia: "MYS",
  "Marshall Islands": "MHL",
  Mauritius: "MUS",
  Moldova: "MDA",
  Morocco: "MAR",
  Nepal: "NPL",
  "New Caledonia": "NCL",
  Nicaragua: "NIC",
  "North Korea": "PRK",
  "Northern Cyprus": "CYN",
  Palestine: "PSX",
  Pakistan: "PAK",
  "the Philippines": "PHL",
  Philippines: "PHL",
  Portugal: "PRT",
  Russia: "RUS",
  "Saudi Arabia": "SAU",
  Serbia: "SRB",
  Seychelles: "SYC",
  "the Seychelles": "SYC",
  Slovenia: "SVN",
  Somalia: "SOM",
  "South Korea": "KOR",
  "South Sudan": "SDS",
  Spain: "ESP",
  Sudan: "SDN",
  Suriname: "SUR",
  Syria: "SYR",
  Taiwan: "TWN",
  // Tokelau has no outline territory; the party is its name, which reads the same in Serbian.
  Tokelau: "Tokelau",
  UAE: "ARE",
  "U.K.": "GBR",
  "U.S.A": "USA",
  "U.S.A.": "USA",
  "United Kingdom": "GBR",
  "the United States": "USA",
  "United States": "USA",
  Ukraine: "UKR",
  Uruguay: "URY",
  Vanuatu: "VUT",
  Venezuela: "VEN",
  Vietnam: "VNM",
  "Western Sahara": "SAH",
});

/** Decisions that replace or extend what a source note says. */
const PARTY_OVERRIDES = Object.freeze({
  Gaza: ["ISR", "PSX"],
  "West Bank": ["ISR", "PSX"],
  Kosovo: ["self", "SRB"],
  Belize: ["BLZ", "GTM"],
  "Dragonja River": ["HRV", "SVN"],
  "Vukovar Island": ["HRV", "SRB"],
  "Šarengrad Island": ["HRV", "SRB"],
  "W. Sahara": ["MAR", "SAH"],
  "North Borneo": ["MYS", "PHL"],
  Ceuta: ["MAR", "ESP"],
  Melilla: ["MAR", "ESP"],
  "Cyprus U.N. Buffer Zone": ["CYP", "CYN"],
  "Spratly Is.": ["BRN", "CHN", "MYS", "PHL", "TWN", "VNM"],
  "Bird Island": ["DMA", "VEN"],
  "Bir Tawil": [],
  "Senkaku Islands": ["CHN", "JPN", "TWN"],
  "Liancourt Rocks": ["JPN", "KOR"],
  "Scarborough Shoal": ["CHN", "PHL", "TWN"],
});

/**
 * The reader sees Natural Earth's own short name (`BRK_NAME`), which is the
 * neutral one (`West of Essequibo River`, not a claimant's name for the area),
 * with its abbreviations written out here.
 */
const DISPLAY_NAMES = Object.freeze({
  "W. Sahara": "Western Sahara",
  "Guantanamo Bay USNB": "Guantánamo Bay Naval Base",
  "N. Cyprus": "Northern Cyprus",
  "Cyprus U.N. Buffer Zone": "Cyprus UN Buffer Zone",
  "Tiran and Sanafir Is.": "Tiran and Sanafir Islands",
  "Juan De Nova I.": "Juan de Nova Island",
  "Diego Garcia NSF": "Diego Garcia",
  "Kuril Is.": "Kuril Islands",
  "Br. Indian Ocean Ter.": "British Indian Ocean Territory",
  "S. Sandwich Is.": "South Sandwich Islands",
  "S. Georgia": "South Georgia",
  "Falkland Is.": "Falkland Islands",
  "Paracel Is.": "Paracel Islands",
  "Spratly Is.": "Spratly Islands",
  "Rockall I.": "Rockall",
  "Navassa I.": "Navassa Island",
  "Tromelin I.": "Tromelin Island",
  "Glorioso Is.": "Glorioso Islands",
  "Abu Musa I.": "Abu Musa",
  "Bajo Nuevo Bank (Petrel Is.)": "Bajo Nuevo Bank",
  "Matthew and Hunter Is.": "Matthew and Hunter Islands",
  "Islas Chafarinas": "Chafarinas Islands",
  "Isla del Perejil": "Perejil Island",
  "Penon de Alhucemas": "Peñón de Alhucemas",
  "Doumera Island": "Doumeira Islands",
});

/** Outline names that take a side, replaced by the neutral one. */
const OUTLINE_NAMES = Object.freeze({
  // Natural Earth's NAME_EN is the self-proclaimed state's full name.
  CYN: "Northern Cyprus",
});

/** Islands too small for the source polygon to be legible at world scale. */
const POINT_FEATURES = Object.freeze([
  {
    sourceName: "Senkaku Islands",
    name: "Senkaku / Diaoyu Islands",
    coordinates: [123.48, 25.74],
    parties: ["CHN", "JPN", "TWN"],
  },
  {
    sourceName: "Liancourt Rocks",
    name: "Liancourt Rocks",
    coordinates: [131.87, 37.24],
    parties: ["JPN", "KOR"],
  },
  {
    sourceName: "Scarborough Shoal",
    name: "Scarborough Shoal",
    coordinates: [117.76, 15.15],
    parties: ["CHN", "PHL", "TWN"],
  },
  {
    sourceName: null,
    name: "Machias Seal Island",
    coordinates: [-67.1, 44.5],
    parties: ["CAN", "USA"],
  },
]);

/** The four whole Ukrainian oblasts that replace the narrower 2014 lines. */
const UKRAINE_OBLASTS = Object.freeze([
  { iso: "UA-14", name: "Donetsk Oblast" },
  { iso: "UA-09", name: "Luhansk Oblast" },
  { iso: "UA-23", name: "Zaporizhzhia Oblast" },
  { iso: "UA-65", name: "Kherson Oblast" },
]);

const INCLUDED_TYPES = new Set(["Disputed", "Indeterminate", "Breakaway"]);
const ALWAYS_EXCLUDED = new Map([
  ["Israel", "The whole state is not a disputed territory; its disputed parts are separate features."],
  ["Artsakh", "The Republic of Artsakh dissolved on 2024-01-01; the area is no longer disputed."],
  ["Donetsk People's Republic", "The breakaway polygon is replaced by Donetsk Oblast."],
  ["Luhansk People's Republic", "The breakaway polygon is replaced by Luhansk Oblast."],
  ["Ilemi Triange", "The misspelt duplicate is merged into Ilemi Triangle."],
  ["Hans Island", "Canada and Denmark divided the island by their treaty of 14 June 2022."],
]);
const INCLUDED_DESPITE_TYPE = new Set(["Ceuta", "Melilla"]);

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const roundRing = (ring, decimals) => ring.map(([x, y]) => [round(x, decimals), round(y, decimals)]);

const sameAs = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Distance from a point to a segment; a degenerate segment is its single point. */
function distanceToSegment([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - ax, y - ay);
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/**
 * Douglas–Peucker over a closed ring. The ring's first and last positions are
 * the same point, so the first split is the vertex farthest from it, and the
 * recursion then works on proper segments. Iterative, so a long coastline cannot
 * exhaust the call stack.
 */
export function simplifyRing(ring, tolerance) {
  const keep = new Array(ring.length).fill(false);
  keep[0] = true;
  keep[ring.length - 1] = true;
  const pending = [[0, ring.length - 1]];
  while (pending.length > 0) {
    const [start, end] = pending.pop();
    let farthest = -1;
    let farthestDistance = 0;
    for (let i = start + 1; i < end; i++) {
      const distance = distanceToSegment(ring[i], ring[start], ring[end]);
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest !== -1 && farthestDistance > tolerance) {
      keep[farthest] = true;
      pending.push([start, farthest], [farthest, end]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

/**
 * A closed ring with no repeated neighbour and at least three distinct corners,
 * or `null` when it has fewer than four positions once closed. Rounding can make
 * two neighbours equal, and a collapsed ring is not a shape.
 */
function tidy(ring) {
  const distinct = [];
  for (const point of ring.slice(0, -1)) {
    if (distinct.length === 0 || !sameAs(point, distinct[distinct.length - 1])) distinct.push(point);
  }
  while (distinct.length > 1 && sameAs(distinct[distinct.length - 1], distinct[0])) distinct.pop();
  return distinct.length < 3 ? null : [...distinct, distinct[0]];
}

/** The shoelace area of a closed ring, used only to pick a feature's largest ring. */
function area(ring) {
  let twice = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    twice += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(twice) / 2;
}

/**
 * Simplifies one geometry. A ring that collapses is dropped, and a polygon whose
 * exterior collapses goes with its holes. A feature never loses every ring: if
 * all its exteriors collapse, its largest exterior is kept unsimplified, so a
 * small territory stays on the map.
 */
function outlineGeometry(geometry, tolerance, decimals) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const kept = polygons
    .map((rings) => rings.map((ring) => tidy(roundRing(simplifyRing(ring, tolerance), decimals))))
    .filter((rings) => rings[0] !== null)
    .map((rings) => rings.filter((ring) => ring !== null));

  const polygonsOut =
    kept.length > 0
      ? kept
      : [[tidy(roundRing(largestExterior(polygons), decimals))]];
  if (polygonsOut[0][0] === null) throw new Error("world-outline: a feature has no ring left after rounding.");

  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: polygonsOut[0] }
    : { type: "MultiPolygon", coordinates: polygonsOut };
}

function largestExterior(polygons) {
  let best = polygons[0][0];
  for (const rings of polygons) {
    if (area(rings[0]) > area(best)) best = rings[0];
  }
  return best;
}

const cleanText = (value) => String(value ?? "").replace(/^\uFEFF/, "").trim();

function sourceName(feature) {
  const properties = feature.properties ?? {};
  return cleanText(properties.BRK_NAME ?? properties.NAME_EN);
}

function excludedName(feature) {
  const name = sourceName(feature);
  return name === "W. Sahara" && feature.properties?.TYPE === "Indeterminate"
    ? "W. Sahara (Indeterminate)"
    : name;
}

/** Classify every record by a named rule. */
export function classifyDisputedAreas(collection) {
  const included = [];
  const excluded = [];
  for (const feature of collection.features) {
    const name = sourceName(feature);
    const type = cleanText(feature.properties?.TYPE);
    const note = cleanText(feature.properties?.NOTE_BRK);
    const duplicateWesternSahara = name === "W. Sahara" && type === "Indeterminate";
    const reason = duplicateWesternSahara
      ? "The second Western Sahara perspective is merged into the first."
      : ALWAYS_EXCLUDED.get(name);
    if (reason !== undefined || duplicateWesternSahara) {
      excluded.push({ name: excludedName(feature), reason: reason ?? "The second perspective is merged." });
      continue;
    }
    if (INCLUDED_DESPITE_TYPE.has(name) || INCLUDED_TYPES.has(type) || note.includes("Claimed by")) {
      included.push(feature);
      continue;
    }
    excluded.push({ name: excludedName(feature), reason: String(type || "Unknown") + " without a claim." });
  }
  return { included, excluded };
}

function partyId(name, featureName) {
  const id = PARTY_IDS[name];
  if (id === undefined) {
    throw new Error("world-outline: unknown party " + JSON.stringify(name) + " in " + JSON.stringify(featureName) + ".");
  }
  return id;
}

function claimNames(text) {
  return text.split(/,\s*(?:and\s+)?|\s+and\s+/).map((name) => name.trim()).filter((name) => name !== "");
}

/** Parse every note form the source uses; unknown names stop the build. */
export function disputedParties(note, featureName) {
  const parties = new Set();
  for (const raw of cleanText(note).split(";")) {
    const segment = raw.trim();
    if (segment === "" || segment.toLowerCase() === "under survey") continue;
    if (/^self admin\.?$/i.test(segment)) {
      parties.add("self");
      continue;
    }
    const admin = /^admin\.?\s+by\s+(.+)$/i.exec(segment);
    if (admin !== null) {
      const forWords = /^(.+?)\s+for\s+(.+)$/i.exec(admin[1]);
      for (const name of forWords === null ? [admin[1]] : [forWords[1], forWords[2]]) {
        parties.add(partyId(name.trim(), featureName));
      }
      continue;
    }
    const lease = /^leased\s+to\s+(.+?)\s+by\s+(.+)$/i.exec(segment);
    if (lease !== null) {
      parties.add(partyId(lease[1].trim(), featureName));
      parties.add(partyId(lease[2].trim(), featureName));
      continue;
    }
    const ceded = /^ceded\s+to\s+(.+?)\s+by\s+(.+)$/i.exec(segment);
    if (ceded !== null) {
      parties.add(partyId(ceded[1].trim(), featureName));
      parties.add(partyId(ceded[2].trim(), featureName));
      continue;
    }
    const claimed = /^claimed\s+by\s+(.+)$/i.exec(segment);
    if (claimed !== null) {
      for (const name of claimNames(claimed[1])) parties.add(partyId(name, featureName));
      continue;
    }
    throw new Error("world-outline: unsupported note segment " + JSON.stringify(segment) + " in " + JSON.stringify(featureName) + ".");
  }
  return [...parties].sort();
}

/** A stable kebab-case identifier derived from the English display name. */
export function disputeSlug(name) {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function polygonsOf(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function geometryPositions(geometry) {
  if (geometry?.type === "Point") return [geometry.coordinates];
  return polygonsOf(geometry).flatMap((polygon) => polygon.flat());
}

function geometryBounds(geometry) {
  const positions = geometryPositions(geometry);
  if (positions.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of positions) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return { minLon, minLat, maxLon, maxLat };
}

function pointOnSegment([x, y], [ax, ay], [bx, by]) {
  const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  if (Math.abs(cross) > 1e-10) return false;
  return x >= Math.min(ax, bx) - 1e-10 && x <= Math.max(ax, bx) + 1e-10 && y >= Math.min(ay, by) - 1e-10 && y <= Math.max(ay, by) + 1e-10;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let at = 0, previous = ring.length - 1; at < ring.length; previous = at++) {
    const current = ring[at];
    const prior = ring[previous];
    if (pointOnSegment(point, prior, current)) return true;
    if ((current[1] > point[1]) !== (prior[1] > point[1]) && point[0] < ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0]) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  if (geometry?.type === "Point") return point[0] === geometry.coordinates[0] && point[1] === geometry.coordinates[1];
  return polygonsOf(geometry).some((rings) => pointInRing(point, rings[0]) && !rings.slice(1).some((hole) => pointInRing(point, hole)));
}

function insideBox(point, box) {
  return point[0] >= box.minLon && point[0] <= box.maxLon && point[1] >= box.minLat && point[1] <= box.maxLat;
}

function outlineCandidates(outlineCollection) {
  return outlineCollection.features.flatMap((feature) => {
    const box = geometryBounds(feature.geometry);
    const label = feature.properties?.label;
    if (box === null || !Array.isArray(label) || typeof feature.id !== "string") return [];
    return [{ id: feature.id, label, geometry: feature.geometry, box }];
  });
}

/** Grid points per axis, and the share of them a territory must hold to count as overlapping an area. */
const OVERLAP_GRID = 24;
const OVERLAP_SHARE = 0.1;

/** Points of an even grid over the area's bounds that lie inside the area. */
function interiorSamples(geometry) {
  const box = geometry.type === "Point" ? null : geometryBounds(geometry);
  if (box === null) return [];
  const samples = [];
  for (let column = 0; column < OVERLAP_GRID; column += 1) {
    for (let row = 0; row < OVERLAP_GRID; row += 1) {
      const point = [
        box.minLon + ((column + 0.5) / OVERLAP_GRID) * (box.maxLon - box.minLon),
        box.minLat + ((row + 0.5) / OVERLAP_GRID) * (box.maxLat - box.minLat),
      ];
      if (pointInGeometry(point, geometry)) samples.push(point);
    }
  }
  return samples;
}

/**
 * The outline territories an area is in or overlaps: the territory that holds
 * its label point, any territory whose own label lies in the area (listed
 * first: the area is that territory), and any that holds `OVERLAP_SHARE` of
 * points sampled inside the area. Border vertices are no evidence: the area
 * (1:10m) and the outline (1:50m) trace a shared border at different scales, so
 * its vertices fall on both sides, and every neighbour would list the area.
 */
function withinOutline(geometry, label, candidates) {
  const samples = interiorSamples(geometry);
  const holds = (candidate, point) => insideBox(point, candidate.box) && pointInGeometry(point, candidate.geometry);
  const own = candidates.filter((candidate) => pointInGeometry(candidate.label, geometry)).map((candidate) => candidate.id);
  const overlapping = candidates.filter(
    (candidate) =>
      !own.includes(candidate.id) &&
      (holds(candidate, label) ||
        (samples.length > 0 && samples.filter((point) => holds(candidate, point)).length >= OVERLAP_SHARE * samples.length)),
  );
  return [...own.sort(), ...overlapping.map((candidate) => candidate.id).sort()];
}

function unionGeometries(geometries) {
  const polygons = geometries.flatMap((geometry) => polygonsOf(geometry));
  const unique = new Map();
  for (const polygon of polygons) unique.set(JSON.stringify(polygon), polygon);
  const kept = [...unique.values()];
  if (kept.length === 0) throw new Error("world-outline: a merged geometry has no polygon.");
  return kept.length === 1 ? { type: "Polygon", coordinates: kept[0] } : { type: "MultiPolygon", coordinates: kept };
}

/**
 * Two adjacent simple territories as one boundary. Exact opposite edges are
 * cancelled, then the remaining directed edges are traced into rings, so the
 * shared border is not drawn as an internal line. The two source records here
 * have one exterior each and no holes; anything else is refused rather than
 * silently losing a ring.
 */
export function dissolveAdjacentExteriors(geometries) {
  const rings = geometries.flatMap((geometry) =>
    polygonsOf(geometry).map((polygon) => {
      if (polygon.length !== 1) throw new Error("world-outline: a dissolved outline territory has a hole.");
      return tidy(polygon[0]);
    }),
  );
  if (rings.some((ring) => ring === null)) throw new Error("world-outline: a dissolved outline territory has no ring.");

  const edgeKey = (from, to) => {
    const left = `${from[0]},${from[1]}`;
    const right = `${to[0]},${to[1]}`;
    return left < right ? `${left}|${right}` : `${right}|${left}`;
  };
  const groups = new Map();
  for (const ring of rings) {
    for (let at = 0; at < ring.length - 1; at += 1) {
      const edge = { from: ring[at], to: ring[at + 1], used: false };
      const key = edgeKey(edge.from, edge.to);
      const group = groups.get(key) ?? [];
      group.push(edge);
      groups.set(key, group);
    }
  }
  for (const group of groups.values()) {
    const forward = group.find((edge) => `${edge.from[0]},${edge.from[1]}` < `${edge.to[0]},${edge.to[1]}`);
    const reverse = group.find((edge) => `${edge.from[0]},${edge.from[1]}` > `${edge.to[0]},${edge.to[1]}`);
    if (forward !== undefined && reverse !== undefined) {
      forward.used = true;
      reverse.used = true;
    }
  }
  const edges = [...groups.values()].flat().filter((edge) => !edge.used);
  const outgoing = new Map();
  for (const edge of edges) {
    const key = `${edge.from[0]},${edge.from[1]}`;
    const list = outgoing.get(key) ?? [];
    list.push(edge);
    outgoing.set(key, list);
  }

  const kept = [];
  while (edges.some((edge) => !edge.used)) {
    const first = edges.find((edge) => !edge.used);
    const ring = [first.from];
    let current = first;
    for (let step = 0; step <= edges.length; step += 1) {
      current.used = true;
      ring.push(current.to);
      if (current.to[0] === first.from[0] && current.to[1] === first.from[1]) break;
      const next = (outgoing.get(`${current.to[0]},${current.to[1]}`) ?? []).find((edge) => !edge.used);
      if (next === undefined) throw new Error("world-outline: a dissolved outline boundary is open.");
      current = next;
    }
    const closed = tidy(ring);
    if (closed === null) throw new Error("world-outline: a dissolved outline boundary collapsed.");
    kept.push(closed);
  }
  if (kept.length === 0) throw new Error("world-outline: a dissolved outline has no boundary.");
  return kept.length === 1
    ? { type: "Polygon", coordinates: [kept[0]] }
    : { type: "MultiPolygon", coordinates: kept.map((ring) => [ring]) };
}

function simplifyGeometry(geometry, tolerance, decimals) {
  if (geometry?.type === "Point") return { type: "Point", coordinates: [round(geometry.coordinates[0], decimals), round(geometry.coordinates[1], decimals)] };
  if (geometry?.type !== "Polygon" && geometry?.type !== "MultiPolygon") throw new Error("world-outline: unsupported disputed geometry " + String(geometry?.type) + ".");
  return outlineGeometry(geometry, tolerance, decimals);
}

function pointArea(point, within, decimals) {
  return {
    type: "Feature",
    id: disputeSlug(point.name),
    properties: { name: point.name, parties: [...point.parties].sort(), note: null, within },
    geometry: { type: "Point", coordinates: [round(point.coordinates[0], decimals), round(point.coordinates[1], decimals)] },
  };
}

/** Build the disputed collection and decide every containing territory now. */
export function buildDisputedAreas(disputedCollection, admin1Collection, outlineCollection, { tolerance = SIMPLIFY_TOLERANCE, decimals = COORDINATE_DECIMALS } = {}) {
  const { included } = classifyDisputedAreas(disputedCollection);
  const candidates = outlineCandidates(outlineCollection);
  const westernSahara = disputedCollection.features.filter((feature) => sourceName(feature) === "W. Sahara");
  const ilemi = disputedCollection.features.filter((feature) => ["Ilemi Triangle", "Ilemi Triange"].includes(sourceName(feature)));
  const usedPoints = new Set();
  const features = [];
  let westernEmitted = false;

  for (const source of included) {
    const key = sourceName(source);
    if (key === "W. Sahara") {
      if (westernEmitted) continue;
      westernEmitted = true;
    }
    const sourceEnglishName = cleanText(source.properties.NAME_EN);
    const point = POINT_FEATURES.find(
      (candidate) => candidate.sourceName !== null && (candidate.sourceName === key || candidate.sourceName === sourceEnglishName),
    );
    if (point !== undefined) usedPoints.add(point);
    const name = point?.name ?? DISPLAY_NAMES[key] ?? key;
    const note = key === "Bir Tawil" ? "unclaimed" : null;
    const parties = point?.parties ?? PARTY_OVERRIDES[key] ?? disputedParties(source.properties.NOTE_BRK, name);
    const merged = key === "W. Sahara"
      ? unionGeometries(westernSahara.map((feature) => feature.geometry))
      : key === "Ilemi Triangle"
        ? unionGeometries(ilemi.map((feature) => feature.geometry))
        : source.geometry;
    const geometry = point === undefined ? simplifyGeometry(merged, tolerance, decimals) : { type: "Point", coordinates: [round(point.coordinates[0], decimals), round(point.coordinates[1], decimals)] };
    const within = withinOutline(geometry, [Number(source.properties.LABEL_X), Number(source.properties.LABEL_Y)], candidates);
    features.push({ type: "Feature", id: disputeSlug(name), properties: { name, parties: [...parties].sort(), note, within }, geometry });
  }

  for (const point of POINT_FEATURES) {
    if (usedPoints.has(point)) continue;
    const geometry = { type: "Point", coordinates: [round(point.coordinates[0], decimals), round(point.coordinates[1], decimals)] };
    features.push(pointArea(point, withinOutline(geometry, point.coordinates, candidates), decimals));
  }

  const admin1 = new Map(admin1Collection.features.map((feature) => [feature.properties?.iso_3166_2, feature]));
  for (const oblast of UKRAINE_OBLASTS) {
    const source = admin1.get(oblast.iso);
    if (source === undefined) throw new Error("world-outline: the admin-1 source has no " + oblast.iso + ".");
    const geometry = simplifyGeometry(source.geometry, tolerance, decimals);
    // Natural Earth's own label point for the oblast; a vertex would sit on a border.
    const label = [Number(source.properties.longitude), Number(source.properties.latitude)];
    features.push({ type: "Feature", id: disputeSlug(oblast.name), properties: { name: oblast.name, parties: ["RUS", "UKR"], note: null, within: withinOutline(geometry, label, candidates) }, geometry });
  }

  const ids = features.map((feature) => feature.id);
  if (new Set(ids).size !== ids.length) {
    const duplicates = [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))];
    throw new Error("world-outline: disputed feature ids are not unique: " + duplicates.join(", ") + ".");
  }
  for (const id of ids) if (id === "") throw new Error("world-outline: a disputed feature produced an empty id.");
  return { type: "FeatureCollection", features };
}

function countDisputedPositions(collection) {
  return collection.features.reduce((total, feature) => total + geometryPositions(feature.geometry).length, 0);
}

/** The Natural Earth placeholder for a missing code, as the picker expects it. */
const codeOrNull = (value) => (value === "-99" ? null : value);

/**
 * The outline of a Natural Earth FeatureCollection: one feature per record, the
 * record's ADM0_A3 as its id, and exactly the five properties the picker reads.
 */
export function buildOutline(collection, { tolerance = SIMPLIFY_TOLERANCE, decimals = COORDINATE_DECIMALS } = {}) {
  const kosovo = collection.features.filter((feature) => feature.properties.ADM0_A3 === "KOS");
  return {
    type: "FeatureCollection",
    // Kosovo is part of Serbia and is shown only as a disputed area.
    features: collection.features.filter((feature) => feature.properties.ADM0_A3 !== "KOS").map((feature) => {
      const properties = feature.properties;
      return {
        type: "Feature",
        id: properties.ADM0_A3,
        properties: {
          iso2: codeOrNull(properties.ISO_A2_EH),
          iso3: codeOrNull(properties.ISO_A3_EH),
          name: OUTLINE_NAMES[properties.ADM0_A3] ?? properties.NAME_EN,
          continent: properties.CONTINENT,
          label: [round(properties.LABEL_X, decimals), round(properties.LABEL_Y, decimals)],
        },
        geometry: outlineGeometry(
          properties.ADM0_A3 === "SRB" && kosovo.length > 0
            ? dissolveAdjacentExteriors([feature.geometry, ...kosovo.map((entry) => entry.geometry)])
            : feature.geometry,
          tolerance,
          decimals,
        ),
      };
    }),
  };
}

function countVertices(outline) {
  return outline.features.reduce((total, feature) => {
    const polygons =
      feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return total + polygons.reduce((sum, rings) => sum + rings.reduce((s, ring) => s + ring.length, 0), 0);
  }, 0);
}

async function readSource(url, file) {
  const cached = readIfPresent(file);
  if (cached !== null) return cached;
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`world-outline: ${url} could not be downloaded: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!response.ok) throw new Error(`world-outline: ${url} answered ${String(response.status)}.`);
  const source = Buffer.from(await response.arrayBuffer());
  mkdirSync(CACHE_DIR, { recursive: true });
  writeCacheFile(file, source);
  return source;
}

async function main() {
  const [outlineSource, disputedSource, admin1Source] = await Promise.all([
    readSource(SOURCE_URL, SOURCE_FILE),
    readSource(DISPUTED_SOURCE_URL, DISPUTED_SOURCE_FILE),
    readSource(ADMIN1_SOURCE_URL, ADMIN1_SOURCE_FILE),
  ]);
  const outlineHash = createHash("sha256").update(outlineSource).digest("hex");
  const disputedHash = createHash("sha256").update(disputedSource).digest("hex");
  const admin1Hash = createHash("sha256").update(admin1Source).digest("hex");

  const outline = buildOutline(JSON.parse(outlineSource.toString("utf8")));
  const disputedSourceData = JSON.parse(disputedSource.toString("utf8"));
  const disputed = buildDisputedAreas(
    disputedSourceData,
    JSON.parse(admin1Source.toString("utf8")),
    outline,
  );
  const census = classifyDisputedAreas(disputedSourceData);
  const outlineText = `${JSON.stringify(outline)}\n`;
  const disputedText = `${JSON.stringify(disputed)}\n`;
  const outlineBytes = Buffer.byteLength(outlineText, "utf8");
  const disputedBytes = Buffer.byteLength(disputedText, "utf8");
  if (outlineBytes > MAX_OUTLINE_BYTES) {
    throw new Error(`world-outline: ${String(outlineBytes)} bytes is over the ${String(MAX_OUTLINE_BYTES)} byte ceiling.`);
  }
  if (disputedBytes > MAX_DISPUTED_BYTES) {
    throw new Error(`world-outline: disputed.json is ${String(disputedBytes)} bytes, over the ${String(MAX_DISPUTED_BYTES)} byte ceiling.`);
  }
  mkdirSync(dirname(OUTLINE_OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTLINE_OUTPUT_FILE, outlineText);
  writeFileSync(DISPUTED_OUTPUT_FILE, disputedText);

  // Counts, sizes and hashes, never a coordinate.
  console.log(`world-outline: countries source ${SOURCE_FILE} (${String(outlineSource.byteLength)} bytes, sha256 ${outlineHash})`);
  console.log(
    `world-outline: disputed source ${DISPUTED_SOURCE_FILE} (${String(disputedSource.byteLength)} bytes, sha256 ${disputedHash})`,
  );
  console.log(
    `world-outline: admin-1 source ${ADMIN1_SOURCE_FILE} (${String(admin1Source.byteLength)} bytes, sha256 ${admin1Hash})`,
  );
  console.log(
    `world-outline: ${OUTLINE_OUTPUT_FILE} written (${String(outline.features.length)} features, ${String(countVertices(outline))} positions, ${String(outlineBytes)} bytes)`,
  );
  console.log(
    `world-outline: ${DISPUTED_OUTPUT_FILE} written (${String(disputed.features.length)} features, ${String(countDisputedPositions(disputed))} positions, ${String(disputedBytes)} bytes; ${String(census.included.length)} included and ${String(census.excluded.length)} excluded source records)`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
