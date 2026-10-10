// OSM place nodes into the two files the map pack ships: `places.json` (the
// search index) and `labels.geojson` (what the style draws on the map).
//
// WHY TWO FILES FROM ONE PASS. They answer two different questions and are
// therefore shaped differently. The search index carries EVERY name a place has
// — Serbian Latin, Serbian Cyrillic and the `name:en` an English reader may type
// — plus the two facts that decide which "Kraljevo" somebody meant; the label
// file carries the one name the map draws and the zoom at which it may appear,
// because a label layer reads a FeatureCollection and nothing else. Deriving
// both from the same extracted nodes is what keeps them from disagreeing about
// where a town is.
//
// WHY THE KIND LIST IS READ FROM THE APP. `places.json` is read by
// `parsePlacesFile` in `@nexus/core`, which refuses a file carrying a kind it
// does not know — and it refuses it WHOLE, because a half-read index would put
// an `undefined` into a search result somebody then clicks. So the builder's
// list cannot be a second opinion: `appPlaceKinds()` reads the app's own
// `MAP_PLACE_KINDS` out of its source file, and a test asserts that it found
// all of them. A kind added to the app is a kind this builder starts writing;
// one removed is one it stops writing.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** The app's own place-kind list, read from the file that defines it. */
export function appPlaceKinds(placesSource) {
  const source =
    placesSource ?? readFileSync(join(REPO_ROOT, "packages/core/src/maps/places.ts"), "utf8");
  const block = /MAP_PLACE_KINDS = \[([\s\S]*?)\] as const;/.exec(source);
  if (block === null) {
    throw new Error(
      "map-serbia: MAP_PLACE_KINDS could not be read from packages/core/src/maps/places.ts. " +
        "The app's list is the authority for what a pack may carry; fix the reader before building.",
    );
  }
  const kinds = [...(block[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  if (kinds.length < 10) {
    throw new Error(`map-serbia: only ${String(kinds.length)} place kinds were read; the parser is wrong.`);
  }
  return kinds;
}

/** The longest a name may be, mirroring `MAX_PLACE_NAME_LENGTH` in the app. */
export const MAX_PLACE_NAME_LENGTH = 120;

/** The most places one file may carry, mirroring `MAX_MAP_PLACES` in the app. */
export const MAX_PLACES = 500_000;

/** A run of Cyrillic letters, which is how a name written in Cyrillic is recognised. */
const CYRILLIC = /[\u0400-\u04ff]/;
/** A run of Latin letters with the diacritics Serbian uses. */
const LATIN = /[A-Za-z\u00c0-\u024f]/;

function isCyrillic(text) {
  return CYRILLIC.test(text);
}

function isLatin(text) {
  return LATIN.test(text) && !isCyrillic(text);
}

/**
 * A `population` tag as a number.
 *
 * OSM states populations as free text: `1234`, `1 234`, `1,234`, `~1200`,
 * `1234 (2011)`. This reads the leading run of DIGITS after dropping separators,
 * and answers `null` for anything else — a guess here would be a number in a
 * search result that no source states.
 */
export function populationOf(tag) {
  if (typeof tag !== "string") return null;
  // A trailing note is ignored ("1234 (2011)" is a population with the census
  // year after it), but a LEADING character that is not a digit is not: `~1200`
  // and `about 1200` are estimates, and an estimate is not a number this pack
  // can state.
  if (!/^\s*[\d]/.test(tag)) return null;
  const digits = tag.replace(/[\s\u00a0.,]/g, "").match(/^\d{1,9}/);
  if (digits === null) return null;
  const value = Number(digits[0]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * One node as a place, or `null` for a node this index does not carry.
 *
 * **What is skipped, and why:** a node with no `place` tag (the overwhelming
 * majority of an extract), one whose `place` value is not in the app's list (a
 * `place=plot` is not a toponym), one with no name at all (an unnamed place
 * cannot be searched for or drawn), and one whose only name is longer than the
 * app's bound (which the app would refuse the whole file over).
 */
export function placeFromNode(entry, kinds) {
  const tags = entry.tags;
  const kind = tags.place;
  if (typeof kind !== "string" || !kinds.includes(kind)) return null;
  const raw = tags.name;
  const latinFromTag = tags["name:sr-Latn"];
  const latin = typeof latinFromTag === "string" && isLatin(latinFromTag)
    ? latinFromTag
    : typeof raw === "string" && isLatin(raw)
      ? raw
      : typeof tags.int_name === "string" && isLatin(tags.int_name)
        ? tags.int_name
        : null;
  const cyrFromTag = tags["name:sr"];
  const cyrillic = typeof cyrFromTag === "string" && isCyrillic(cyrFromTag)
    ? cyrFromTag
    : typeof raw === "string" && isCyrillic(raw)
      ? raw
      : null;
  const name = latin ?? cyrillic ?? raw;
  if (typeof name !== "string" || name.trim() === "") return null;
  if (name.length > MAX_PLACE_NAME_LENGTH) return null;
  if (cyrillic !== null && cyrillic.length > MAX_PLACE_NAME_LENGTH) return null;
  const nameEn = typeof tags["name:en"] === "string" && tags["name:en"].length <= MAX_PLACE_NAME_LENGTH
    ? tags["name:en"]
    : null;
  const id = entry.id;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    name: name.trim(),
    nameCyr: cyrillic === null ? null : cyrillic.trim(),
    nameEn: nameEn === null ? null : nameEn.trim(),
    kind,
    lat: entry.lat,
    lon: entry.lon,
    population: populationOf(tags.population),
  };
}

/**
 * The zoom at which a place's label appears, from its kind and its population.
 *
 * **A policy, and stated as one.** Nothing in the data says when a village's
 * name should appear; that is an editorial decision, and it lives here rather
 * than in the app because the LABEL FILE is what carries it (a feature property,
 * read by a filter). The thresholds are round numbers on purpose, so the rule is
 * one a reader can hold in their head while arguing with it. A place whose kind
 * is not in the ladder would be a kind the app's list gained and this one did
 * not — the caller refuses those rather than inventing a zoom for them.
 */
export function minZoomOf(kind, population) {
  switch (kind) {
    case "country":
      return 2;
    case "state":
    case "region":
    case "province":
      return 4;
    case "district":
    case "county":
    case "municipality":
      return 6;
    case "city":
      if (population === null) return 7;
      if (population >= 100_000) return 5;
      if (population >= 20_000) return 6;
      if (population >= 5_000) return 7;
      return 8;
    case "town":
      return population !== null && population >= 5_000 ? 10 : 11;
    case "suburb":
    case "quarter":
      return 11;
    case "village":
      return 11;
    case "neighbourhood":
      return 12;
    case "hamlet":
    case "isolated_dwelling":
    case "farm":
    case "locality":
      return 13;
    case "island":
      return 8;
    default:
      return null;
  }
}

/**
 * One pass over the extract: every place node, the search index and the label
 * file.
 *
 * `onNode` is the reader's callback, so a caller with a 240 MB extract never
 * holds its nodes; what this holds is the result — a few thousand places.
 */
export function buildPlaces(nodes, kinds) {
  const places = [];
  const skipped = { kind: 0, nameless: 0, long: 0, repeated: 0 };
  const seen = new Set();
  for (const entry of nodes) {
    const kind = entry.tags.place;
    if (typeof kind !== "string") continue;
    if (!kinds.includes(kind)) {
      skipped.kind += 1;
      continue;
    }
    const place = placeFromNode(entry, kinds);
    if (place === null) {
      skipped.nameless += 1;
      continue;
    }
    if (minZoomOf(place.kind, place.population) === null) {
      skipped.kind += 1;
      continue;
    }
    // The same place mapped twice (a node and its duplicate, or a node repeated
    // across two extract boundaries) is one entry: the id is the identity the
    // extract gives it, and two rows with one name would offer a search result
    // that leads to the same point twice.
    if (seen.has(place.id)) {
      skipped.repeated += 1;
      continue;
    }
    seen.add(place.id);
    places.push(place);
    if (places.length > MAX_PLACES) {
      throw new Error(`map-serbia: more than ${String(MAX_PLACES)} places; the region is the wrong one.`);
    }
  }
  places.sort((left, right) => left.id - right.id);
  return { places, skipped };
}

/** The search index, as the app reads it. */
export function placesFile(region, places) {
  return { version: 1, region, places };
}

/** The label file: what the map draws, with the zoom each label may appear at. */
export function labelsGeoJson(places) {
  return {
    type: "FeatureCollection",
    features: places.map((place) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [place.lon, place.lat] },
      properties: {
        name: place.name,
        kind: place.kind,
        minZoom: minZoomOf(place.kind, place.population),
      },
    })),
  };
}

/** Every distinct label zoom the file contains, ascending — the style gets one layer per rung. */
export function labelRungs(places) {
  const rungs = new Set();
  for (const place of places) rungs.add(minZoomOf(place.kind, place.population));
  return [...rungs].sort((left, right) => left - right);
}
