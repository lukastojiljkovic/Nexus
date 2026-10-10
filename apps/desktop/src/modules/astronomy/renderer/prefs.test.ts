import { zonePoint } from "@nexus/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryStorage } from "../../../renderer/src/testStorage.js";
import {
  astronomyPrefKey,
  clearStoredAstronomyPreferences,
  parseAstronomyPrefs,
  persistAstronomyPrefs,
  readAstronomyPrefs,
  resolveObserver,
} from "./prefs.js";

/**
 * ASTRONOMY's one preference and the default that makes a first open right.
 *
 * The desktop package's Vitest runs under node, so `localStorage` is stubbed per
 * file as `focusPrefs`/`signalPrefs`' own suites do. What is pinned is that a
 * stored or hand-edited key can only ever become a coordinate the engine can
 * draw a sky for, and that the ZONE default is the tz table's own principal city
 * rather than a number this module invented.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function withStorage(seed: Record<string, string> = {}): void {
  vi.stubGlobal("localStorage", memoryStorage(seed));
}

describe("parseAstronomyPrefs", () => {
  it("answers „no place“ for nothing stored, for junk, and for half a pair", () => {
    for (const stored of [
      null,
      "",
      "not json",
      "[]",
      "7",
      // Half a coordinate is not a place: answering the other half would be
      // inventing the second number.
      JSON.stringify({ latDeg: 44.8 }),
      JSON.stringify({ lonDeg: 20.47 }),
    ]) {
      expect(parseAstronomyPrefs(stored), String(stored)).toEqual({ place: null });
    }
  });

  it("reads a stored pair back field by field", () => {
    expect(parseAstronomyPrefs(JSON.stringify({ latDeg: 44.8, lonDeg: 20.47 }))).toEqual({
      place: { latDeg: 44.8, lonDeg: 20.47 },
    });
  });

  it("refuses a coordinate outside its own range, and a value that is not a number", () => {
    const cases = [
      { latDeg: 90.1, lonDeg: 20 },
      { latDeg: -90.1, lonDeg: 20 },
      { latDeg: 45, lonDeg: 180.1 },
      { latDeg: 45, lonDeg: -180.1 },
      { latDeg: "45", lonDeg: 20 },
      { latDeg: 45, lonDeg: Number.NaN },
    ];
    for (const stored of cases) {
      expect(parseAstronomyPrefs(JSON.stringify(stored)), JSON.stringify(stored)).toEqual({
        place: null,
      });
    }
    // The two edges themselves are places, not refusals: the poles and the date
    // line are somewhere somebody can stand.
    expect(parseAstronomyPrefs(JSON.stringify({ latDeg: 90, lonDeg: 180 }))).toEqual({
      place: { latDeg: 90, lonDeg: 180 },
    });
  });
});

describe("resolveObserver", () => {
  it("prefers the place the user picked, whatever the zone says", () => {
    const picked = { latDeg: -33.87, lonDeg: 151.21 };
    expect(resolveObserver(picked, "Europe/Belgrade")).toEqual(picked);
  });

  it("falls back to the principal city of the machine's zone", () => {
    // The oracle is the shipped table's own reader: this asserts that the
    // default IS the zone's city, not that Belgrade sits at one coordinate.
    expect(resolveObserver(null, "Europe/Belgrade")).toEqual(zonePoint("Europe/Belgrade"));
    expect(zonePoint("Europe/Belgrade")).not.toBeNull();
  });

  it("answers null for a zone the table does not carry, and for no zone at all", () => {
    // `zoneLocation.ts` records the measurement: zone1970.tab describes zones
    // whose civil clocks have agreed since 1970, so a zone that keeps a
    // neighbour's time has no row — Oslo, Stockholm and Zagreb among them. The
    // module's answer is „no place", never a neighbour's coordinates.
    expect(zonePoint("Europe/Oslo")).toBeNull();
    expect(resolveObserver(null, "Europe/Oslo")).toBeNull();
    expect(resolveObserver(null, null)).toBeNull();
  });
});

describe("the stored place", () => {
  it("round-trips through one per-profile key, and removes the key for „no place“", () => {
    withStorage();
    const place = { latDeg: 44.8, lonDeg: 20.47 };
    persistAstronomyPrefs("p1", { place });
    expect(localStorage.getItem(astronomyPrefKey("p1"))).toBe(
      JSON.stringify({ latDeg: 44.8, lonDeg: 20.47 }),
    );
    expect(readAstronomyPrefs("p1")).toEqual({ place });
    // Per profile: one person's place is not another's.
    expect(readAstronomyPrefs("p2")).toEqual({ place: null });

    persistAstronomyPrefs("p1", { place: null });
    expect(localStorage.getItem(astronomyPrefKey("p1"))).toBeNull();
    expect(readAstronomyPrefs("p1")).toEqual({ place: null });
  });

  it("forgets the place on the settings card's own reset", () => {
    withStorage({ [astronomyPrefKey("p1")]: JSON.stringify({ latDeg: 44.8, lonDeg: 20.47 }) });
    clearStoredAstronomyPreferences("p1");
    expect(readAstronomyPrefs("p1")).toEqual({ place: null });
  });
});
