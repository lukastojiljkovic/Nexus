import { describe, expect, it } from "vitest";
import {
  CONSTELLATION_ANCHORS,
  CONSTELLATIONS,
  STAR_NAMES,
  STAR_TABLE,
} from "./starCatalogue.js";
import { NAKED_EYE_MAGNITUDE_LIMIT, STAR_COUNT, allStars, constellations, searchSky, skyFrame, starPlacement, starsBrighterThan } from "./stars.js";

describe("the shipped star table", () => {
  it("is a whole number of five-field rows", () => {
    expect(STAR_TABLE.length % 5).toBe(0);
    expect(STAR_COUNT).toBe(5080);
    expect(allStars()).toHaveLength(STAR_COUNT);
  });

  it("keeps every row inside the sky and inside the magnitude limit", () => {
    const naughty: string[] = [];
    for (const star of allStars()) {
      if (star.raDeg < 0 || star.raDeg >= 360) naughty.push(`HR ${star.hr} right ascension`);
      if (star.decDeg < -90 || star.decDeg > 90) naughty.push(`HR ${star.hr} declination`);
      if (star.magnitude > NAKED_EYE_MAGNITUDE_LIMIT) naughty.push(`HR ${star.hr} magnitude`);
      // The B-V column runs from -0.28 (a hot blue-white) to 3.86 (a carbon
      // star) in this subset; the bound here is the sky's, not the table's, and
      // the two stars past 3 are V/50's own.
      if (star.colourIndex !== undefined && (star.colourIndex < -1 || star.colourIndex > 4)) {
        naughty.push(`HR ${star.hr} colour index`);
      }
    }
    expect(naughty).toEqual([]);
  });

  it("is one row per HR number, in increasing order", () => {
    const hrs = allStars().map((star) => star.hr);
    expect(new Set(hrs).size).toBe(hrs.length);
    expect([...hrs]).toEqual([...hrs].sort((a, b) => a - b));
  });

  it("carries the catalogue's own values for the five stars the oracle uses", () => {
    // V/50 (Hoffleit & Warren 1991, preliminary 5th edition) via the VizieR ASU
    // service, the request URL in `starCatalogue.ts`'s header: HR 2491 is
    // Sirius at 06 45 08.9 -16 42 58, V = -1.46, B-V = 0.00, and the four
    // others are read out here the same way.
    const byHr = new Map(allStars().map((star) => [star.hr, star]));
    expect(byHr.get(2491)).toMatchObject({
      name: "Sirius",
      raDeg: 101.28708,
      decDeg: -16.71611,
      magnitude: -1.46,
      colourIndex: 0,
    });
    expect(byHr.get(7001)).toMatchObject({
      name: "Vega",
      raDeg: 279.23458,
      decDeg: 38.78361,
      magnitude: 0.03,
      colourIndex: 0,
    });
    expect(byHr.get(5340)).toMatchObject({ name: "Arcturus", magnitude: -0.04, colourIndex: 1.23 });
    expect(byHr.get(1457)).toMatchObject({ name: "Aldebaran", magnitude: 0.85, colourIndex: 1.54 });
    expect(byHr.get(1708)).toMatchObject({ name: "Capella", magnitude: 0.08, colourIndex: 0.8 });
  });

  it("leaves the colour index of the 53 stars V/50 does not measure it for unset", () => {
    // The catalogue prints a blank for those, and a blank is not a colour: the
    // table carries `NaN`, and `Star` carries no property at all.
    let unmeasuredRows = 0;
    for (let row = 0; row < STAR_COUNT; row += 1) {
      if (Number.isNaN(STAR_TABLE[row * 5 + 4])) unmeasuredRows += 1;
    }
    expect(unmeasuredRows).toBe(53);
    expect(allStars().filter((star) => star.colourIndex === undefined)).toHaveLength(unmeasuredRows);
  });

  it("carries the IAU's own names, and only for stars it has", () => {
    // IAU WGSN, "IAU Catalog of Star Names", last updated 2022-04-04; joined to
    // the catalogue by HR number.
    expect(STAR_NAMES).toHaveLength(310);
    const hrs = new Set(allStars().map((star) => star.hr));
    for (const [hr, name] of STAR_NAMES) {
      expect(hrs.has(hr), `HR ${hr} (${name})`).toBe(true);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("filters by magnitude without inventing stars", () => {
    const bright = starsBrighterThan(1);
    expect(bright.length).toBeGreaterThan(0);
    expect(bright.every((star) => star.magnitude <= 1)).toBe(true);
    expect(bright.length).toBeLessThan(STAR_COUNT);
    expect(starsBrighterThan(NAKED_EYE_MAGNITUDE_LIMIT)).toHaveLength(STAR_COUNT);
  });
});

describe("the 88 constellations", () => {
  it("is one row per IAU abbreviation, all with three names", () => {
    expect(CONSTELLATIONS).toHaveLength(88);
    expect(new Set(CONSTELLATIONS.map((row) => row.id)).size).toBe(88);
    for (const row of CONSTELLATIONS) {
      expect(row.id, row.latin).toMatch(/^[A-Z][A-Za-z]{2}$/);
      expect(row.latin.length, row.id).toBeGreaterThan(2);
      expect(row.sr.length, row.id).toBeGreaterThan(2);
      expect(row.en.length, row.id).toBeGreaterThan(2);
    }
    expect(constellations()).toHaveLength(88);
  });

  it("has no Cyrillic name left in the Serbian column", () => {
    // The sr-el rendering of the source list left Antlia's cell in Cyrillic;
    // the build transliterates it with the standard Serbian table, and this is
    // the assertion that no second cell ever slips through unnoticed.
    const cyrillic = CONSTELLATIONS.filter((row) => /[\u0400-\u04ff]/.test(row.sr));
    expect(cyrillic).toEqual([]);
  });

  it("keeps the sources' own words, including the Serbian letters and the articles", () => {
    const byId = new Map(CONSTELLATIONS.map((row) => [row.id, row]));
    // The IAU's Latin name and its own English name, article and all.
    expect(byId.get("UMa")).toEqual({
      id: "UMa",
      latin: "Ursa Major",
      sr: "Veliki medved",
      en: "The Great Bear",
    });
    // A Serbian name with the letters this app writes (Wikipedia's list).
    expect(byId.get("Sco")?.sr).toBe("Škorpija");
    expect(byId.get("Cru")?.sr).toBe("Južni krst");
    // The one cell the sr-el rendering left in Cyrillic, transliterated.
    expect(byId.get("Ant")?.sr).toBe("Šmrk");
  });

  it("anchors every name inside the sky", () => {
    expect(CONSTELLATION_ANCHORS).toHaveLength(88);
    expect(new Set(CONSTELLATION_ANCHORS.map(([id]) => id)).size).toBe(88);
    for (const [id, raDeg, decDeg] of CONSTELLATION_ANCHORS) {
      expect(Number.isFinite(raDeg), id).toBe(true);
      expect(raDeg, id).toBeGreaterThanOrEqual(0);
      expect(raDeg, id).toBeLessThan(360);
      expect(decDeg, id).toBeGreaterThanOrEqual(-90);
      expect(decDeg, id).toBeLessThanOrEqual(90);
    }
    // Orion's anchor, from the IAU's own boundary vertices: the middle of the
    // figure, a degree or so north of the belt.
    expect(CONSTELLATION_ANCHORS.find(([id]) => id === "Ori")).toEqual(["Ori", 85.7827, 9.9435]);
  });
});

describe("searchSky", () => {
  it("finds a star by its IAU name, brightest match first", () => {
    const matches = searchSky("sirius", "en");
    expect(matches[0]?.kind).toBe("star");
    expect(matches[0]?.label).toBe("Sirius");
    if (matches[0]?.kind === "star") expect(matches[0].star.hr).toBe(2491);
  });

  it("folds the diacritics a Serbian keyboard may not have", () => {
    // "škorpija" typed as "skorpija" on a keyboard without the letter.
    const matches = searchSky("skorpija", "sr");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: "constellation", label: "Škorpija" });
  });

  it("reads the constellation name in the language it is asked for", () => {
    const serbian = searchSky("veliki medved", "sr");
    expect(serbian[0]).toMatchObject({ kind: "constellation", label: "Veliki medved" });
    const english = searchSky("great bear", "en");
    expect(english[0]).toMatchObject({ kind: "constellation", label: "The Great Bear" });
  });

  it("finds a star by HR number", () => {
    const matches = searchSky("2491", "sr");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: "star", label: "HR 2491" });
  });

  it("ranks an exact name first, then a brighter star before a fainter one", () => {
    // "Vega" is the star itself; nothing else is called that.
    expect(searchSky("vega", "sr")[0]).toMatchObject({ kind: "star", label: "Vega" });
    // Three IAU names begin "Adh", at V = 1.50, 3.43 and 4.87, so the order is
    // the catalogue's brightnesses and not the alphabet's.
    expect(searchSky("adh", "en").slice(0, 3).map((match) => match.label)).toEqual([
      "Adhara",
      "Adhafera",
      "Adhil",
    ]);
  });

  it("answers nothing for nothing", () => {
    expect(searchSky("", "en")).toEqual([]);
    expect(searchSky("   ", "en")).toEqual([]);
    expect(searchSky("zzzz", "en")).toEqual([]);
  });
});

describe("skyFrame and starPlacement", () => {
  it("puts Polaris within a degree of the observer's own latitude", () => {
    // The pole star is 0.74 degrees from the pole, so its altitude from a place
    // at 44.82 N is 44.82 +- that - a sanity check on the whole chain that a
    // wrong sign in any step fails loudly.
    const frame = skyFrame({ latitude: 44.82, longitude: 20.46 }, Date.parse("2026-10-10T00:00:00Z"));
    const polaris = allStars().find((star) => star.name === "Polaris");
    expect(polaris).toBeDefined();
    const placement = starPlacement(polaris!, frame);
    expect(Math.abs(placement.altitude - 44.82)).toBeLessThan(1);
    expect(placement.azimuth).toBeGreaterThan(0);
    expect(placement.azimuth).toBeLessThan(360);
  });

  it("reports a refraction-free altitude and a lifted apparent one", () => {
    // The two altitudes are the Sun's own pair: geometric for a rise, apparent
    // for a drawing. At the horizon the atmosphere is worth about half a degree.
    const frame = skyFrame({ latitude: 44.82, longitude: 20.46 }, Date.parse("2026-10-09T19:00:00Z"));
    const arcturus = allStars().find((star) => star.hr === 5340)!;
    const placement = starPlacement(arcturus, frame);
    expect(placement.altitude).toBeGreaterThan(0);
    expect(placement.altitude).toBeLessThan(1);
    expect(placement.apparentAltitude - placement.altitude).toBeGreaterThan(0.4);
    expect(placement.apparentAltitude - placement.altitude).toBeLessThan(0.6);
  });
});
