import { describe, expect, it } from "vitest";
import { MINIAPPS_CITIES, cityOfZone, zoneOfCity } from "./cities.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * The world clock's city list (mini-apps).
 *
 * The ids and zones are data, so what is checked here is the two properties
 * nothing else can see: that every zone is one the runtime's own time zone
 * database knows (a typo would otherwise only surface as an empty clock), and
 * that every city has a name in BOTH locales - the compiler checks that the two
 * copy tables have the same shape, but not that the city list and the label table
 * agree about which cities exist.
 */
describe("the city list", () => {
  it("names each city once, in both languages", () => {
    const serbian: Record<string, string> = sr.cities;
    const english: Record<string, string> = en.cities;
    for (const city of MINIAPPS_CITIES) {
      expect(serbian[city.id], city.id).toBeTruthy();
      expect(english[city.id], city.id).toBeTruthy();
    }
    expect(Object.keys(serbian).sort()).toEqual(MINIAPPS_CITIES.map((city) => city.id).sort());
    expect(Object.keys(english).sort()).toEqual(MINIAPPS_CITIES.map((city) => city.id).sort());
  });

  it("lists no zone twice", () => {
    const zones = MINIAPPS_CITIES.map((city) => city.zone);
    expect(new Set(zones).size).toBe(zones.length);
  });

  it("offers only zones the runtime's time zone database knows", () => {
    for (const city of MINIAPPS_CITIES) {
      // Constructing the formatter is the check: an id the runtime does not know
      // throws a RangeError.
      expect(
        () => new Intl.DateTimeFormat("en-US", { timeZone: city.zone }),
        city.zone,
      ).not.toThrow();
    }
  });

  it("maps a city to its zone and back", () => {
    expect(zoneOfCity("beograd")).toBe("Europe/Belgrade");
    expect(cityOfZone("Europe/Belgrade")).toBe("beograd");
    expect(zoneOfCity("atlantis")).toBeNull();
    expect(cityOfZone("Mars/Olympus")).toBeNull();
  });
});
