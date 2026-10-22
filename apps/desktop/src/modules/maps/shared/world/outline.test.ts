import { describe, expect, it } from "vitest";

import {
  CONTINENTS,
  regionBounds,
  regionById,
  regions,
  regionsOfContinent,
} from "./outline";

/**
 * The shipped outline, read through the module that the picker imports. These
 * tests are about what the BUILD produced: the ids are unique, the four
 * territories a reader will look for are present, and the bounds of a known
 * country fall inside its known extent. They are not a check of the
 * simplification, which is `scripts/maps/world-outline.test.mjs`.
 */

describe("the world outline", () => {
  it("has a unique id for every territory", () => {
    const ids = regions.map((region) => region.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains Serbia, France, Russia and Fiji", () => {
    for (const id of ["SRB", "FRA", "RUS", "FJI"]) {
      expect(regionById(id), id).toBeDefined();
    }
  });

  it("returns undefined for an id that is not in the outline", () => {
    expect(regionById("XXX")).toBeUndefined();
  });

  it("keeps the placeholder codes as null, as the build does", () => {
    expect(regionById("SOL")).toMatchObject({ iso2: null, iso3: null });
  });

  it("lists every continent once, in a fixed order", () => {
    expect(new Set(CONTINENTS).size).toBe(CONTINENTS.length);
    expect([...CONTINENTS]).toEqual([...CONTINENTS].sort());
  });

  it("has at least one territory on every continent", () => {
    for (const continent of CONTINENTS) {
      expect(regionsOfContinent(continent).length, continent).toBeGreaterThan(0);
    }
  });

  it("groups Serbia under Europe", () => {
    expect(regionsOfContinent("Europe").map((region) => region.id)).toContain("SRB");
  });
});

describe("regionBounds", () => {
  it("places Serbia inside its known extent", () => {
    const bounds = regionBounds("SRB");

    expect(bounds.minLon).toBeGreaterThanOrEqual(18);
    expect(bounds.maxLon).toBeLessThanOrEqual(23.1);
    expect(bounds.minLat).toBeGreaterThanOrEqual(41.8);
    expect(bounds.maxLat).toBeLessThanOrEqual(46.3);
  });

  it("covers every part of a multi-polygon region", () => {
    const bounds = regionBounds("ITA");

    expect(bounds.maxLon - bounds.minLon).toBeGreaterThan(10);
  });

  it("throws for an id that is not in the outline", () => {
    expect(() => regionBounds("XXX")).toThrow(/XXX/);
  });
});
