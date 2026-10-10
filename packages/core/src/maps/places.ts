/**
 * The offline place index: the shape of `places.json` inside a map pack, and
 * the ranking that turns a typed query into an ordered list of places.
 *
 * **Why the index is ours and not a geocoder.** The research run found no
 * maintained, permissively licensed, self-contained geocoder that fits in a
 * desktop pack (Photon is Apache-2.0 but is a Java service over a 1.5 GB
 * database; Nominatim is GPL-3.0 and must not be linked into this app). What a
 * map needs here is much smaller than a full geocoder: the named places of one
 * region, in both Serbian scripts, with the two facts that decide which of them
 * a person meant - what kind of place it is, and how big it is. The pack's
 * builder extracts exactly that from the same OpenStreetMap extract the tiles
 * are cut from, so the index and the map can never disagree about where a town
 * is.
 *
 * **Two scripts, one place.** Serbian is written in both, and a person types
 * whichever they think in: `Краљево` and `Kraljevo` are one row. Both are
 * stored, both are searched, and the ranking folds diacritics away on both
 * sides (`foldSearchText`, the app's own fold) so `kraljevo`, `KRALJEVO` and
 * `Краљево` all land on it. The Latin form is what the map draws.
 *
 * **The zoom ladder is a policy, not a measurement.** Nothing in the data says
 * at which zoom a village's name should appear; that is an editorial decision,
 * and it is stated as a table below so it can be argued with. Its thresholds
 * are round numbers on purpose - a rule that reads `20000` is a rule somebody
 * can hold in their head while deciding whether a label appears too early.
 */

import { foldSearchText } from "../search/searchText.js";

/**
 * The `place=*` values the index carries, in the order the map's labels prefer
 * them. An OpenStreetMap `place` value outside this list is not a settled
 * toponym (or is not a thing a person searches a map for) and is skipped rather
 * than carried with an unknown kind: the kinds below are the values
 * `https://wiki.openstreetmap.org/wiki/Key:place` documents (read 2026-10-10),
 * and the ranking has to be able to say what each one is worth.
 */
export const MAP_PLACE_KINDS = [
  "country",
  "state",
  "region",
  "province",
  "district",
  "county",
  "municipality",
  "city",
  "town",
  "village",
  "suburb",
  "quarter",
  "neighbourhood",
  "hamlet",
  "isolated_dwelling",
  "farm",
  "locality",
  "island",
] as const;

export type MapPlaceKind = (typeof MAP_PLACE_KINDS)[number];

/**
 * How much a kind is worth when two places match a query equally well. Lower
 * wins. It is the order a person scans a result list in - a city before a
 * village of the same name, a village before the neighbourhood inside it - and
 * it is deliberately not the same order as `MAP_PLACE_KINDS`, which groups the
 * values by what they are rather than by which one a search meant.
 */
export const MAP_PLACE_KIND_RANK: Readonly<Record<MapPlaceKind, number>> = {
  country: 0,
  state: 1,
  region: 2,
  province: 3,
  district: 4,
  county: 5,
  municipality: 6,
  city: 7,
  town: 8,
  suburb: 9,
  quarter: 10,
  neighbourhood: 11,
  village: 12,
  hamlet: 13,
  isolated_dwelling: 14,
  farm: 15,
  island: 16,
  locality: 17,
};

/** One named place, as `places.json` carries it. */
export interface MapPlace {
  /** The OpenStreetMap node id it was read from, so a row can be traced back to its source. */
  readonly id: number;
  /** What the map draws: the Serbian Latin form when the data has one, the OSM name otherwise. */
  readonly name: string;
  /** The Serbian Cyrillic form, or `null` where the node carries none. */
  readonly nameCyr: string | null;
  /** The `name:en` the node carries, or `null`; what the interface draws when it is reading English. */
  readonly nameEn: string | null;
  readonly kind: MapPlaceKind;
  readonly lat: number;
  readonly lon: number;
  /** The `population` tag as a number, or `null` when the node states none. */
  readonly population: number | null;
}

/** The file's own version, checked rather than assumed: a newer one is refused by name. */
export const MAP_PLACES_VERSION = 1;

/** The most places one file may carry. A pack of a region is far below this; the bound is for a hostile file. */
export const MAX_MAP_PLACES = 500_000;

/** The longest a name may be. OSM's longest settled names are well under this. */
export const MAX_PLACE_NAME_LENGTH = 120;

/** A whole `places.json`, as the builder writes it. */
export interface MapPlacesFile {
  readonly version: number;
  /** The pack's region id, so a file that does not belong to this pack is visible as such. */
  readonly region: string;
  readonly places: readonly MapPlace[];
}

/**
 * Reads one `places.json` completely, or throws naming the field that is wrong.
 *
 * Total and throwing, like every other reader of a file this app did not write:
 * the pack is signed, but the signature says who built it, not that the file
 * parses, and a half-read index would put an `undefined` into a search result a
 * person then clicks.
 */
export function parsePlacesFile(value: unknown): MapPlacesFile {
  const record = asRecord(value, "places.json");
  if (record.version !== MAP_PLACES_VERSION) {
    throw new Error(
      `places.json was written by another version (found ${String(record.version)}, expected ${MAP_PLACES_VERSION}).`,
    );
  }
  const region = record.region;
  if (typeof region !== "string" || region.length === 0 || region.length > 64) {
    throw new Error('places.json: "region" must be a non-empty string of at most 64 characters.');
  }
  const rows = record.places;
  if (!Array.isArray(rows)) throw new Error('places.json: "places" must be an array.');
  if (rows.length > MAX_MAP_PLACES) {
    throw new Error(`places.json: at most ${MAX_MAP_PLACES} places may be carried.`);
  }
  const places = rows.map(readPlace);
  return { version: MAP_PLACES_VERSION, region, places };
}

/** One row, field by field. */
function readPlace(row: unknown, index?: number): MapPlace {
  const at = index === undefined ? "" : `places[${String(index)}]`;
  const record = asRecord(row, at === "" ? "places[]" : at);
  const id = record.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`places.json: "${at}.id" must be a positive integer.`);
  }
  const kind = record.kind;
  if (typeof kind !== "string" || !(MAP_PLACE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`places.json: "${at}.kind" is not a place kind this build knows.`);
  }
  return {
    id,
    name: asName(record.name, `${at}.name`),
    nameCyr: asNullableName(record.nameCyr, `${at}.nameCyr`),
    nameEn: asNullableName(record.nameEn, `${at}.nameEn`),
    kind: kind as MapPlaceKind,
    lat: asCoordinate(record.lat, `${at}.lat`, 90),
    lon: asCoordinate(record.lon, `${at}.lon`, 180),
    population: asPopulation(record.population, `${at}.population`),
  };
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`places.json: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asName(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`places.json: "${field}" must be a string.`);
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_PLACE_NAME_LENGTH) {
    throw new Error(
      `places.json: "${field}" must be 1..${MAX_PLACE_NAME_LENGTH} characters.`,
    );
  }
  return name;
}

function asNullableName(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return asName(value, field);
}

function asCoordinate(value: unknown, field: string, limit: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`places.json: "${field}" must be a finite number.`);
  }
  if (value < -limit || value > limit) {
    throw new Error(`places.json: "${field}" must be between -${String(limit)} and ${String(limit)}.`);
  }
  return value;
}

function asPopulation(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`places.json: "${field}" must be a non-negative whole number.`);
  }
  return value;
}

/**
 * How well one place matches, smaller being better. The five tiers are the
 * whole of the ranking's shape:
 *
 * 0. the query IS the name (`čacak` finds Čačak before anything containing it);
 * 1. the name begins with it (`beo` finds Beograd);
 * 2. a word inside the name begins with it (`novi` finds `Nova Varoš`);
 * 3. the name merely contains it (`grad` finds `Beograd`);
 * 4. a multi-term query whose every term is a word prefix somewhere in the name
 *    (`novi sad` finds `Novi Sad` by the same rule the palette uses).
 */
export type PlaceMatchTier = 0 | 1 | 2 | 3 | 4;

const TIER_EXACT: PlaceMatchTier = 0;
const TIER_PREFIX: PlaceMatchTier = 1;
const TIER_WORD: PlaceMatchTier = 2;
const TIER_CONTAINS: PlaceMatchTier = 3;
const TIER_TERMS: PlaceMatchTier = 4;

/** Folded once per place, because a query walks the whole index and folding 40 000 names per keystroke is the cost this avoids. */
export interface FoldedPlace {
  readonly place: MapPlace;
  /** Every folded spelling of the name: Latin, Cyrillic and English, duplicates dropped. */
  readonly folded: readonly string[];
}

/**
 * The index as the search reads it: each place with its folded spellings.
 *
 * Built once when `places.json` arrives and kept by the worker, so a keystroke
 * costs one fold (the query) rather than one per place.
 */
export function foldPlaces(places: readonly MapPlace[]): readonly FoldedPlace[] {
  return places.map((place) => {
    const folded = new Set<string>();
    for (const spelling of [place.name, place.nameCyr, place.nameEn]) {
      if (spelling !== null) folded.add(foldSearchText(spelling));
    }
    return { place, folded: [...folded] };
  });
}

/** The tier one folded name matches a folded query at, or `null` when it does not. */
function tierOf(foldedName: string, query: string, terms: readonly string[]): PlaceMatchTier | null {
  if (foldedName === query) return TIER_EXACT;
  if (foldedName.startsWith(query)) return TIER_PREFIX;
  const words = foldedName.split(/[^\p{L}\p{N}]+/u);
  if (words.some((word) => word.startsWith(query))) return TIER_WORD;
  if (foldedName.includes(query)) return TIER_CONTAINS;
  // The multi-term rule is LAST and not first: a query of two words is also a
  // substring test, and "Novi Sad" typed in full should rank as a prefix match
  // rather than as the weaker "every term is somewhere in there".
  if (terms.length > 1 && terms.every((term) => words.some((word) => word.startsWith(term)))) {
    return TIER_TERMS;
  }
  return null;
}

/** One ranked hit, with the tier that placed it there (the page shows the kind and the population, not the tier, but a test reads it). */
export interface PlaceHit {
  readonly place: MapPlace;
  readonly tier: PlaceMatchTier;
}

/**
 * The best `limit` places for a query, best first.
 *
 * **The comparison is total.** Tier, then the kind's own rank, then population
 * (bigger first, and a place that states none sorts last), then the collator
 * over the drawn name, then the id. Every step is needed: without the collator
 * two same-sized villages of one kind would come back in file order, which is
 * alphabetical by accident and changes the day the builder streams the extract
 * in a different order.
 */
export function rankPlaces(
  places: readonly FoldedPlace[],
  query: string,
  limit: number,
): readonly PlaceHit[] {
  const foldedQuery = foldSearchText(query).trim();
  if (foldedQuery === "" || limit <= 0) return [];
  const terms = foldedQuery.split(/\s+/).filter((term) => term.length > 0);
  const collator = new Intl.Collator(["sr-Latn", "sr"]);
  const hits: PlaceHit[] = [];
  for (const entry of places) {
    let best: PlaceMatchTier | null = null;
    for (const spelling of entry.folded) {
      const tier = tierOf(spelling, foldedQuery, terms);
      if (tier !== null && (best === null || tier < best)) best = tier;
    }
    if (best !== null) hits.push({ place: entry.place, tier: best });
  }
  hits.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const rankA = MAP_PLACE_KIND_RANK[a.place.kind];
    const rankB = MAP_PLACE_KIND_RANK[b.place.kind];
    if (rankA !== rankB) return rankA - rankB;
    const popA = a.place.population ?? -1;
    const popB = b.place.population ?? -1;
    if (popA !== popB) return popB - popA;
    const byName = collator.compare(a.place.name, b.place.name);
    if (byName !== 0) return byName;
    return a.place.id - b.place.id;
  });
  return hits.slice(0, limit);
}

/**
 * NOTE ON WHAT THIS FILE DOES NOT DECIDE: the zoom at which a place's label
 * appears. That ladder decides what the LABEL FILE carries (a `minZoom` property,
 * which the style's per-rung layers filter on), and the label file is written by
 * the pack's builder — `scripts/packs/map-serbia/places.mjs`. Keeping a second
 * copy of the ladder here would be a second answer to the same question, and the
 * app has no use for it: it draws the labels the pack shipped, not ones it
 * computed.
 */
