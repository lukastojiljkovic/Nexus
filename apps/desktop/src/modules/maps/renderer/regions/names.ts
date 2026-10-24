import { regionById, type WorldRegion } from "../../shared/world/outline.js";
import { en } from "../copy.en.js";
import { sr } from "../copy.sr.js";

export type Locale = "sr" | "en";

/** The eight continent names the outline carries, as the copy table keys them. */
export type Continent =
  | "Africa"
  | "Antarctica"
  | "Asia"
  | "Europe"
  | "North America"
  | "Oceania"
  | "Seven seas (open ocean)"
  | "South America";

const TABLES = { sr, en } as const;
const TAGS: Record<Locale, string> = { sr: "sr-Latn", en: "en" };
const CONTINENT_PREFIX = "continent:";

/** Continents a reader never picks: one territory, or no land at all. */
const NO_CONTINENT_CHOICE: ReadonlySet<string> = new Set(["Seven seas (open ocean)", "Antarctica"]);

const displayNames = new Map<Locale, Intl.DisplayNames>();

function regionNames(locale: Locale): Intl.DisplayNames {
  let names = displayNames.get(locale);
  if (names === undefined) {
    names = new Intl.DisplayNames([TAGS[locale]], { type: "region" });
    displayNames.set(locale, names);
  }
  return names;
}

function isContinent(name: string): name is Continent {
  return Object.hasOwn(sr.regions.continents, name);
}

/** A territory's name in the reader's language; the outline's English name where its ISO code gives none. */
export function territoryName(region: WorldRegion, locale: Locale): string {
  if (region.iso2 === null) return region.name;
  const name = regionNames(locale).of(region.iso2);
  return name === undefined || name === region.iso2 ? region.name : name;
}

/** The name of a scope: `world`, `continent:<name>`, or a territory's outline id. */
export function regionName(id: string, locale: Locale): string {
  if (id === "world") return TABLES[locale].regions.world;
  if (id.startsWith(CONTINENT_PREFIX)) {
    const continent = id.slice(CONTINENT_PREFIX.length);
    return isContinent(continent) ? TABLES[locale].regions.continents[continent] : id;
  }
  const region = regionById(id);
  return region === undefined ? id : territoryName(region, locale);
}

/** The scopes a territory can be downloaded at, from the narrowest to the whole world. */
export function regionScopes(region: WorldRegion): readonly string[] {
  const continent = NO_CONTINENT_CHOICE.has(region.continent) ? [] : [`${CONTINENT_PREFIX}${region.continent}`];
  return [region.id, ...continent, "world"];
}
