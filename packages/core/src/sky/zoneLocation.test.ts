import { describe, expect, it } from "vitest";
import { ZONE_TABLE } from "./tzTable.js";
import { computerObserver, computerZone, zoneCount, zonePoint } from "./zoneLocation.js";

/**
 * The zone table is data, so what a test can check is that the lookup reads it
 * the way the file's own header says it is written, and that the rows really are
 * the tz database's. The expected values below are `zone1970.tab`'s own, read
 * from the fetched file, with the source cell beside each one so the arithmetic
 * can be checked by hand: `+4450+02030` is 44 degrees 50 minutes north and 020
 * degrees 30 minutes east, and 50 minutes is 0.8333 degrees, hence
 * 44.833 / 20.5.
 */
const ZONES: readonly (readonly [string, number, number, string])[] = [
  ["Europe/Andorra", 42.5, 1.517, "+4230+00131"],
  ["Europe/Belgrade", 44.833, 20.5, "+4450+02030"],
  ["Europe/London", 51.508, -0.125, "+513030-0000731"],
  ["America/New_York", 40.714, -74.006, "+404251-0740023"],
  ["Asia/Tokyo", 35.654, 139.745, "+353916+1394441"],
  ["Australia/Sydney", -33.867, 151.217, "-3352+15113"],
  ["America/Sao_Paulo", -23.533, -46.617, "-2332-04637"],
  ["Africa/Cairo", 30.05, 31.25, "+3003+03115"],
  ["Asia/Kolkata", 22.533, 88.367, "+2232+08822"],
  ["Pacific/Auckland", -36.867, 174.767, "-3652+17446"],
  ["Europe/Moscow", 55.756, 37.618, "+5545+03735"],
  ["Asia/Shanghai", 31.233, 121.467, "+3114+12128"],
  ["Antarctica/Casey", -66.283, 110.517, "-6617+11031"],
];

describe("zonePoint", () => {
  it("answers the principal city the tz database's own row names", () => {
    for (const [zone, latDeg, lonDeg, cell] of ZONES) {
      expect(zonePoint(zone), `${zone} (zone1970.tab ${cell})`).toEqual({ latDeg, lonDeg });
    }
  });

  it("keeps the source's own precision, inside the Earth", () => {
    for (const [zone] of ZONES) {
      const point = zonePoint(zone)!;
      expect(Number.isFinite(point.latDeg), zone).toBe(true);
      expect(Math.abs(point.latDeg), zone).toBeLessThanOrEqual(90);
      expect(Number.isFinite(point.lonDeg), zone).toBe(true);
      expect(Math.abs(point.lonDeg), zone).toBeLessThanOrEqual(180);
    }
  });

  it("answers null for a zone whose row the table does not carry", () => {
    // Measured 2026-10-10: `Intl.supportedValuesOf("timeZone")` names 418 zones
    // in this runtime and 121 of them have no zone1970.tab row, because a zone
    // that keeps a neighbour's clock has no row of its own. Europe/Amsterdam,
    // Europe/Oslo and Asia/Calcutta are three of them; `UTC` is a link in the
    // database's `etcetera` file rather than a row either. A borrowed neighbour
    // would be wrong by hundreds of kilometres (see the module's header), so the
    // answer is null and the surface above asks for a place.
    const missing = ["Europe/Amsterdam", "Europe/Oslo", "Asia/Calcutta", "UTC", "", "europe/belgrade"];
    for (const zone of missing) {
      expect(zonePoint(zone), zone).toBeNull();
    }
  });

  it("reads every shipped row, and only zones, with no duplicate name", () => {
    const rows = ZONE_TABLE.split("\n");
    const names = new Set<string>();
    for (const row of rows) {
      const [zone = "", latDeg = "", lonDeg = ""] = row.split("|");
      expect(zone, row).toMatch(/^[A-Za-z][A-Za-z0-9_+/-]*$/);
      expect(Number.isFinite(Number(latDeg)), row).toBe(true);
      expect(Number.isFinite(Number(lonDeg)), row).toBe(true);
      expect(Math.abs(Number(latDeg)), row).toBeLessThanOrEqual(90);
      expect(Math.abs(Number(lonDeg)), row).toBeLessThanOrEqual(180);
      expect(names.has(zone), `${zone} appears twice`).toBe(false);
      names.add(zone);
      // The lookup is the parse: the two must agree for every row, or one of
      // them is reading a different table than the other.
      expect(zonePoint(zone), zone).toEqual({ latDeg: Number(latDeg), lonDeg: Number(lonDeg) });
    }
    expect(names.size).toBe(312);
    expect(zoneCount()).toBe(names.size);
  });
});

describe("the computer's own zone", () => {
  it("answers a zone and its point together, or neither", () => {
    const zone = computerZone();
    const observer = computerObserver();
    if (zone === null) {
      expect(observer).toBeNull();
      return;
    }
    expect(observer?.zone).toBe(zone);
    expect(observer?.point ?? null).toEqual(zonePoint(zone));
  });
});
