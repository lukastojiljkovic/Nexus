/**
 * The place picker's list: every city on Earth with 100 000 people or more, by
 * name, country and coordinates.
 *
 * **Why the table exists at all.** A zone name gets a reader close and no
 * closer (see `zoneLocation.ts`: 121 of the zones a machine can report have no
 * principal city in the tz table, and the city a zone is named for can be far
 * from where the reader stands). The picker is the way out of both, and it has
 * to work with the network off, so the list is shipped rather than looked up:
 * `cityTable.ts` carries the GeoNames `cities15000` dump filtered to the
 * hundred thousand, with the licence and the attribution beside it.
 *
 * **One measured limitation to know about.** The names are GeoNames' own
 * preferred spelling, which is usually the English one: the row for Serbia's
 * capital is `Belgrade`, so a query of `Beograd` finds `Novi Beograd` and not
 * the city itself. Local and English spellings that differ (Beograd/Belgrade,
 * Roma/Rome, Wien/Vienna) cannot both be had from this dump's `name` column
 * alone; the coordinates are the fact the picker exists for, and typed
 * coordinates are the other way in. Widening it would mean shipping GeoNames'
 * alternate-name table, which is two orders of magnitude larger.
 *
 * **The order is the sr-Latn collator's**, `Intl.Collator(["sr-Latn", "sr"])`
 * as everywhere else in this repository, built once when the list is first
 * asked for. The shipped file is in population order, which is what makes the
 * table's own reading pleasant; the order the reader sees is this one, and a
 * later locale's list would follow its own collator without touching the data.
 *
 * **Searching folds**, through the same `foldSearchText` the search index uses
 * (ADR-021): `nis` finds `Niš`, `djordje` finds both spellings of `Đorđe`, and
 * a Cyrillic query finds the Latin name it transliterates to. Folding is for
 * MATCHING only; the city returned is the one the table spells, never the
 * query.
 *
 * **Ranking is one rule, stated here rather than left to the sort:** a name that
 * STARTS with the query comes before a name that merely contains it, and inside
 * each of those two ranks the order is the collator's. A list of eight is what a
 * picker shows; the caller may ask for more, and no caller is handed the whole
 * table.
 */
import { foldSearchText } from "../search/searchText.js";
import { CITY_TABLE } from "./cityTable.js";

/** One city, as the table spells it. */
export interface City {
  /** The name the table carries, in the language the place is named in. */
  readonly name: string;
  /** ISO 3166-1 alpha-2 country code, as the source file carries it. */
  readonly countryCode: string;
  readonly latDeg: number;
  readonly lonDeg: number;
}

/** How many cities a picker offers when the caller does not say. */
export const DEFAULT_CITY_LIMIT = 8;

/** The house collator: `sr-Latn` first, because plain `"sr"` tailors Cyrillic. */
const SR_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

interface IndexedCity {
  readonly city: City;
  /** The name folded for matching, computed once at load. */
  readonly folded: string;
}

let index: readonly IndexedCity[] | null = null;
let list: readonly City[] | null = null;

/** The parsed table, sorted for reading, built on first use and kept. */
function cityIndex(): readonly IndexedCity[] {
  if (index !== null) return index;
  const parsed: IndexedCity[] = [];
  for (const row of CITY_TABLE.split("\n")) {
    const [name, countryCode, latDeg, lonDeg] = row.split("|");
    if (name === undefined || countryCode === undefined || latDeg === undefined || lonDeg === undefined) {
      continue;
    }
    parsed.push({
      city: { name, countryCode, latDeg: Number(latDeg), lonDeg: Number(lonDeg) },
      folded: foldSearchText(name),
    });
  }
  parsed.sort((left, right) => SR_COLLATOR.compare(left.city.name, right.city.name));
  index = parsed;
  return parsed;
}

/** How many cities the shipped table carries. Exported for the census its test prints. */
export function cityCount(): number {
  return cityIndex().length;
}

/** Every city, in sr-Latn alphabetical order. */
export function cities(): readonly City[] {
  if (list === null) list = cityIndex().map((entry) => entry.city);
  return list;
}

/**
 * The cities whose name matches `query`, prefix matches first, the collator's
 * order inside each rank, at most `limit` of them.
 *
 * An empty (or whitespace-only) query answers nothing rather than everything:
 * a list of six thousand rows is not a search result, and the picker shows its
 * own empty state instead.
 */
export function searchCities(query: string, limit: number = DEFAULT_CITY_LIMIT): readonly City[] {
  const needle = foldSearchText(query.trim());
  if (needle.length === 0 || limit <= 0) return [];
  const prefix: City[] = [];
  const within: City[] = [];
  for (const entry of cityIndex()) {
    if (entry.folded.startsWith(needle)) prefix.push(entry.city);
    else if (entry.folded.includes(needle)) within.push(entry.city);
  }
  return [...prefix, ...within].slice(0, limit);
}

/**
 * How a city is WRITTEN on a surface: `Niš, RS`.
 *
 * The country code rather than a country name, because a name would be a table
 * of 171 translated pairs for a label that has to stay short beside a search
 * box, and the code is what disambiguates the same name in another country
 * (the table carries two `Athens`, and three `Springfield` in the US alone).
 */
export function cityLabel(city: City): string {
  return `${city.name}, ${city.countryCode}`;
}
