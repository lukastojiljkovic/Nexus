import { describe, expect, it } from "vitest";
import { CITY_TABLE } from "./cityTable.js";
import { DEFAULT_CITY_LIMIT, cities, cityCount, cityLabel, searchCities } from "./cities.js";

/**
 * The list is data, so the tests here are of three kinds, and each says which
 * source it trusts:
 *
 *  - the LOOKUP's own rules (the collator's order, prefix-before-contains, the
 *    fold, the limit), asserted against expectations read out of the shipped
 *    table itself;
 *  - the TABLE's invariants, which are what make the encoding parseable at all
 *    (a `|` in a name would truncate it silently) and what a regeneration must
 *    not break;
 *  - the count, 6 280 rows, which is the filter the file's header states,
 *    measured on 2026-10-10.
 */
const SR_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

describe("the shipped city table", () => {
  it("carries the whole filtered dump", () => {
    expect(cityCount()).toBe(6280);
    expect(cities().length).toBe(6280);
  });

  it("is in sr-Latn alphabetical order", () => {
    const list = cities();
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1]!;
      const current = list[index]!;
      expect(
        SR_COLLATOR.compare(previous.name, current.name),
        `${previous.name} before ${current.name}`,
      ).toBeLessThanOrEqual(0);
    }
    // Three pairs spelled out, so a reader does not have to trust the loop above
    // on its own. The comparison is the collator's, not a bare `sort()`'s, and
    // the two are not the same rule: Serbian Latin sorts the letters with
    // diacritics as letters of their own, next to the base letter.
    const position = (name: string): number => list.findIndex((city) => city.name === name);
    expect(position("Belgrade")).toBeLessThan(position("Niš"));
    expect(position("Niš")).toBeLessThan(position("Novi Sad"));
    expect(position("Zagreb")).toBeLessThan(position("Zürich"));
  });

  it("ships rows an unescaped `|`-separated reader can always parse", () => {
    const rows = CITY_TABLE.split("\n");
    const places = new Map<string, Set<string>>();
    // The same set `scripts/check-invisibles.mjs` refuses, by code point rather
    // than as a character class: a class containing these is a class a reader
    // cannot see, which is the defect the gate exists for.
    const invisibles = new Set([
      0x0000, 0x00a0, 0x00ad, 0x200b, 0x200c, 0x200d, 0x2028, 0x2029, 0x2060, 0xfeff,
    ]);
    for (const row of rows) {
      const [name = "", countryCode = "", latDeg = "", lonDeg = ""] = row.split("|");
      expect(name.length, row).toBeGreaterThan(0);
      expect(name, row).not.toMatch(/[|`\\\t]/);
      expect(name, row).not.toMatch(/\$\{/);
      const invisible = [...name].find((char) => invisibles.has(char.codePointAt(0) ?? -1));
      expect(invisible, `${row} carries an invisible character`).toBeUndefined();
      expect(countryCode, row).toMatch(/^[A-Z]{2}$/);
      expect(Math.abs(Number(latDeg)), row).toBeLessThanOrEqual(90);
      expect(Math.abs(Number(lonDeg)), row).toBeLessThanOrEqual(180);
      // The source names 57 pairs of places that share a name within a country
      // (three Springfields in the US among them, measured 2026-10-10) and never
      // the same place twice: a repeated name in a repeated country always
      // carries a different position, so the table holds no accidental
      // duplicate of one city.
      const key = `${name}|${countryCode}`;
      const seen = places.get(key) ?? new Set<string>();
      const coordinates = `${latDeg},${lonDeg}`;
      expect(seen.has(coordinates), `${key} at ${coordinates}`).toBe(false);
      seen.add(coordinates);
      places.set(key, seen);
    }
    expect(rows.length).toBe(6280);
  });
});

describe("searchCities", () => {
  it("folds the query, and never the table's own spelling", () => {
    // `cacak` reaches `Čačak`: the fold is what makes a Latin keyboard enough
    // for a Serbian name. The city that comes back is the table's spelling.
    expect(searchCities("cacak")).toEqual([
      { name: "Čačak", countryCode: "RS", latDeg: 43.89, lonDeg: 20.35 },
    ]);
    // The same fold reaches an accented Latin name.
    expect(searchCities("reykjavik")).toEqual([
      { name: "Reykjavík", countryCode: "IS", latDeg: 64.14, lonDeg: -21.9 },
    ]);
    // And it transliterates Cyrillic (ADR-021), so a query in the other script
    // is the same query: `Ниш` is `Niš` written the other way.
    expect(searchCities("Ниш")).toEqual(searchCities("nis"));
  });

  it("puts a name that STARTS with the query before a name that contains it", () => {
    // Measured against the shipped table: `nis` has four prefix matches
    // (Nishi-Tokyo-shi, Nishinomiya, Nishio, Niš) and 8 more that merely contain
    // it. Six are asked for, so the last two are the first two of the second
    // rank, in the collator's order, which is what makes `Niš` reachable at all.
    expect(searchCities("nis", 6).map(cityLabel)).toEqual([
      "Nishi-Tokyo-shi, JP",
      "Nishinomiya, JP",
      "Nishio, JP",
      "Niš, RS",
      "Dikirnis, EG",
      "Inisa, NG",
    ]);
  });

  it("orders each rank by the collator, not by the file", () => {
    // The shipped file is in population order (Shanghai first), so these two
    // would come back in another order if the rows were read as they are stored.
    expect(searchCities("san", 2).map(cityLabel)).toEqual(["San, ML", "San Antonio, US"]);
    expect(searchCities("a", 2).map(cityLabel)).toEqual(["A Coruña, ES", "Aachen, DE"]);
  });

  it("answers at most `limit` rows, and nothing for a query that asks nothing", () => {
    expect(DEFAULT_CITY_LIMIT).toBe(8);
    expect(searchCities("a").length).toBe(DEFAULT_CITY_LIMIT);
    expect(searchCities("a", 1).length).toBe(1);
    expect(searchCities("a", 0)).toEqual([]);
    expect(searchCities("   ")).toEqual([]);
    expect(searchCities("")).toEqual([]);
    expect(searchCities("zzzzzzzz")).toEqual([]);
  });
});

describe("cityLabel", () => {
  it("writes the name and the country code the table carries", () => {
    expect(cityLabel({ name: "Niš", countryCode: "RS", latDeg: 43.32, lonDeg: 21.9 })).toBe("Niš, RS");
  });
});
