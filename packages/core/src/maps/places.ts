/**
 * The offline place index: a place as the map's search holds it, and the
 * ranking that turns a typed query into an ordered list of places.
 *
 * **Why the index is ours and not a geocoder.** The research run found no
 * maintained, permissively licensed, self-contained geocoder that fits in a
 * desktop app (Photon is Apache-2.0 but is a Java service over a 1.5 GB
 * database; Nominatim is GPL-3.0 and must not be linked into this app). What a
 * map needs here is much smaller than a full geocoder: the named places of the
 * downloaded regions, with the two facts that decide which of them a person
 * meant - what kind of place it is, and how big it is. The app reads them from
 * the `places` layer of the regions' own tiles
 * (`apps/desktop/src/modules/maps/renderer/placeIndex.ts`), so the index and the
 * map can never disagree about where a town is.
 *
 * **Two scripts, one place.** Serbian is written in both, and a person types
 * whichever they think in: `Краљево` and `Kraljevo` are one row. Both are
 * stored, both are searched, and the ranking folds diacritics away on both
 * sides (`foldSearchText`, the app's own fold) so `kraljevo`, `KRALJEVO` and
 * `Краљево` all land on it. The Latin form is what the map draws.
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

/** One named place, as the search holds it. */
export interface MapPlace {
  /** The id its tile feature carries, or a negative one the index gives a place without one: unique within one index. */
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
