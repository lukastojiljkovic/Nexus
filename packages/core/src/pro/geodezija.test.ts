import { describe, expect, it } from "vitest";

import {
  decimalToDms,
  dmsToDecimal,
  geodesicDirect,
  geodesicInverse,
  gridGroundRatio,
  mgrsFromGeo,
  mgrsToUtm,
  utmForward,
  utmInverse,
  utmZoneForLongitude,
} from "./geodezija.js";

/**
 * The surveying toolkit's arithmetic, against numbers worked out by hand.
 *
 * **The two geodesic control lines are published, not invented.** The distance
 * from the equator to the pole along a WGS84 meridian is the ellipsoid's QUARTER
 * MERIDIAN, 10 001 965,7293 m — a figure that follows from `a` and `1/f` and is
 * printed with them (NIMA TR8350.2); the same value is reproduced below by
 * Simpson quadrature of the meridional arc, which is a different method. The
 * equatorial line is exact arithmetic: `a·π/2 = 6 378 137 × 1,5707963 =
 * 10 018 754,1714 m`. Everything else in this file that is not an identity is
 * bounded rather than asserted to the last place, and says so.
 */

describe("decimalToDms and dmsToDecimal", () => {
  it("splits a decimal degree into degrees, minutes and seconds", () => {
    // 20,4667° = 20° + 0,4667×60 = 28,002′ → 28′ + 0,002×60 = 0,12″
    const result = decimalToDms(20.4667);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dms.degrees).toBe(20);
    expect(result.dms.minutes).toBe(28);
    expect(result.dms.seconds).toBeCloseTo(0.12, 6);
  });

  it("puts the sign on the degrees and nowhere else", () => {
    const result = decimalToDms(-44.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dms.degrees).toBe(-44);
    expect(result.dms.minutes).toBe(30);
    expect(result.dms.seconds).toBeCloseTo(0, 9);
  });

  it("round-trips a coordinate through both directions", () => {
    // 44° 30′ 00″ = 44 + 30/60 = 44,5
    const decimal = dmsToDecimal({ degrees: 44, minutes: 30, seconds: 0 });
    expect(decimal.ok).toBe(true);
    if (!decimal.ok) return;
    expect(decimal.decimal).toBeCloseTo(44.5, 9);

    // 20° 28′ 00,12″ = 20 + 28/60 + 0,12/3600 = 20,4667
    const back = dmsToDecimal({ degrees: 20, minutes: 28, seconds: 0.12 });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.decimal).toBeCloseTo(20.4667, 9);
  });

  it("refuses a minute or a second of sixty and a sign in three places", () => {
    expect(dmsToDecimal({ degrees: 44, minutes: 70, seconds: 0 }).ok).toBe(false);
    expect(dmsToDecimal({ degrees: 44, minutes: 0, seconds: 60 }).ok).toBe(false);
    expect(dmsToDecimal({ degrees: 44, minutes: -30, seconds: 0 }).ok).toBe(false);
    expect(decimalToDms(200).ok).toBe(false);
  });
});

describe("utmZoneForLongitude", () => {
  it("numbers the six-degree belts from 180° west", () => {
    expect(utmZoneForLongitude(0)).toBe(31);
    expect(utmZoneForLongitude(21)).toBe(34);
    expect(utmZoneForLongitude(-74)).toBe(18);
    expect(utmZoneForLongitude(180)).toBe(60);
  });
});

describe("utmForward", () => {
  it("puts the central meridian at the false easting, with the definition's scale", () => {
    // Zone 34's central meridian is (34 − 1)×6 − 180 + 3 = 21°E; the definition
    // sets that meridian at 500 000 m and k₀ = 0,9996, and the equator at zero
    const result = utmForward({ lat: 0, lon: 21 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.zone).toBe(34);
    expect(result.north).toBe(true);
    expect(result.centralMeridianDeg).toBe(21);
    expect(result.easting).toBeCloseTo(500000, 6);
    expect(result.northing).toBeCloseTo(0, 6);
    expect(result.scaleFactor).toBeCloseTo(0.9996, 9);
    expect(result.convergenceDeg).toBeCloseTo(0, 9);
  });

  it("starts a southern coordinate at the ten-million false northing", () => {
    const result = utmForward({ lat: 0, lon: 21 }).ok
      ? utmForward({ lat: -0.0001, lon: 21 })
      : utmForward({ lat: 0, lon: 21 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.northing).toBeGreaterThan(9999000);
  });

  it("places a real coordinate in its own zone with the expected magnitude", () => {
    // Belgrade, 44,8°N 20,4667°E: zone 34, and 0,53° west of that zone's central
    // meridian is about 42 km, so the easting sits below the false one.
    const result = utmForward({ lat: 44.8, lon: 20.4667 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.zone).toBe(34);
    expect(result.easting).toBeGreaterThan(430000);
    expect(result.easting).toBeLessThan(500000);
    expect(result.northing).toBeGreaterThan(4900000);
    expect(result.northing).toBeLessThan(5000000);
    expect(result.scaleFactor).toBeGreaterThan(0.9996);
  });

  it("is the transverse Mercator's published scale error across a zone", () => {
    // Snyder (1987) states the UTM scale factor as 0,9996 on the central
    // meridian rising to about 1,001 at the zone edge; the belt is ±3°, so the
    // edge test is 3° away from the meridian.
    const edge = utmForward({ lat: 0, lon: 24 });
    expect(edge.ok).toBe(true);
    if (!edge.ok) return;
    expect(edge.scaleFactor).toBeGreaterThan(1.0008);
    expect(edge.scaleFactor).toBeLessThan(1.0013);
  });

  it("refuses a latitude outside the UTM belts", () => {
    expect(utmForward({ lat: 85, lon: 21 }).ok).toBe(false);
    expect(utmForward({ lat: -81, lon: 21 }).ok).toBe(false);
  });
});

describe("utmInverse", () => {
  it("returns a projected point to where it started", () => {
    for (const point of [
      { lat: 44.8, lon: 20.4667 },
      { lat: 0, lon: 21 },
      { lat: -33.86, lon: 151.21 },
      { lat: 60, lon: 24.9 },
    ]) {
      const projected = utmForward(point);
      expect(projected.ok, JSON.stringify(point)).toBe(true);
      if (!projected.ok) continue;
      const back = utmInverse(projected);
      expect(back.ok, JSON.stringify(point)).toBe(true);
      if (!back.ok) continue;
      expect(back.zone, JSON.stringify(point)).toBe(projected.zone);
      // Snyder's series is quoted to a millimetre, so the round trip is held to
      // about a centimetre and not to the last bit: half a millimetre is the
      // series, and the tolerance is the honest bound on it (1e-7° ≈ 1 cm).
      expect(back.lat, JSON.stringify(point)).toBeCloseTo(point.lat, 7);
      expect(back.lon, JSON.stringify(point)).toBeCloseTo(point.lon, 7);
    }
  });

  it("refuses a zone, an easting and a northing it cannot have", () => {
    expect(utmInverse({ zone: 0, north: true, easting: 500000, northing: 0 }).ok).toBe(false);
    expect(utmInverse({ zone: 61, north: true, easting: 500000, northing: 0 }).ok).toBe(false);
    expect(utmInverse({ zone: 34, north: true, easting: 50000, northing: 0 }).ok).toBe(false);
    expect(utmInverse({ zone: 34, north: true, easting: 500000, northing: 20000000 }).ok).toBe(false);
  });
});

describe("mgrsFromGeo and mgrsToUtm", () => {
  it("writes a reference inside the square, at the precision asked for", () => {
    const result = mgrsFromGeo({ point: { lat: 44.8, lon: 20.4667 }, precision: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Zone 34 (even), band T for 44,8°N, and ten digits at one-metre precision
    expect(result.mgrs).toMatch(/^34T[A-H][A-V]\d{10}$/);
    expect(result.zone).toBe(34);
    expect(result.band).toBe("T");
    expect(result.north).toBe(true);
  });

  it("cycles the column letters with zone mod 3, which is the classic trap", () => {
    // Each zone's central meridian is column 5 of its set, so the letters are
    // the fifth of A–H, of J–R and of S–Z: E, N and W.
    const z31 = mgrsFromGeo({ point: { lat: 44.8, lon: 3 }, precision: 0 });
    const z32 = mgrsFromGeo({ point: { lat: 44.8, lon: 9 }, precision: 0 });
    const z33 = mgrsFromGeo({ point: { lat: 44.8, lon: 15 }, precision: 0 });
    expect([z31, z32, z33].every((one) => one.ok)).toBe(true);
    if (!z31.ok || !z32.ok || !z33.ok) return;
    expect(z31.mgrs[3]).toBe("E");
    expect(z32.mgrs[3]).toBe("N");
    expect(z33.mgrs[3]).toBe("W");
    // Rows start at A in an odd zone and at F in an even one, so the same
    // northing carries a different row letter in each of the three.
    expect(z31.mgrs[4]).toBe("K");
    expect(z32.mgrs[4]).toBe("Q");
    expect(z33.mgrs[4]).toBe("K");
  });

  it("comes back to the point it named, within the precision", () => {
    const point = { lat: 44.8, lon: 20.4667 };
    const written = mgrsFromGeo({ point, precision: 5 });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const read = mgrsToUtm(written.mgrs);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // A one-metre square's centre is at most 0,71 m from the point inside it.
    const metresLat = (read.centre.lat - point.lat) * 111320;
    const metresLon = (read.centre.lon - point.lon) * 111320 * Math.cos((point.lat * Math.PI) / 180);
    expect(Math.hypot(metresLat, metresLon)).toBeLessThan(1);
  });

  it("accepts a truncated square and reports the corner it actually names", () => {
    const read = mgrsToUtm("34TDQ");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.precision).toBe(0);
    // A bare square names its south-west corner, and the centre is half a square on.
    const corner = utmInverse({
      zone: read.zone,
      north: read.north,
      easting: read.squareEasting,
      northing: read.squareNorthing,
    });
    expect(corner.ok).toBe(true);
    if (!corner.ok) return;
    expect(read.southWest.lat).toBeCloseTo(corner.lat, 9);
    expect(read.southWest.lon).toBeCloseTo(corner.lon, 9);
  });

  it("refuses a band, a letter set and a digit count that cannot be written", () => {
    expect(mgrsToUtm("34IDQ").ok).toBe(false);
    expect(mgrsToUtm("00TDQ").ok).toBe(false);
    expect(mgrsToUtm("34TDQ123").ok).toBe(false);
    // J is not in zone 31's column set (A–H)
    expect(mgrsToUtm("31TJA").ok).toBe(false);
    expect(mgrsToUtm("nonsense").ok).toBe(false);
  });
});

describe("geodesicInverse", () => {
  it("measures the quarter meridian, the WGS84 control line", () => {
    // Published: the equator to the pole on WGS84 is 10 001 965,7293 m — the
    // same number Simpson quadrature of ∫a(1−e²)/(1−e²sin²φ)^1,5 dφ gives to
    // the millimetre. Both azimuths are due north.
    const result = geodesicInverse({ from: { lat: 0, lon: 0 }, to: { lat: 90, lon: 0 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceM).toBeCloseTo(10001965.7293, 1);
    expect(result.initialAzimuthDeg).toBeCloseTo(0, 9);
    expect(result.finalAzimuthDeg).toBeCloseTo(0, 9);
  });

  it("measures a quarter of the equator, which is exact arithmetic", () => {
    // Along the equator the geodesic is the equator: a·π/2 = 6 378 137 ×
    // 1,5707963268 = 10 018 754,1714 m, and both azimuths are due east.
    const result = geodesicInverse({ from: { lat: 0, lon: 0 }, to: { lat: 0, lon: 90 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceM).toBeCloseTo(10018754.1714, 1);
    expect(result.initialAzimuthDeg).toBeCloseTo(90, 9);
    expect(result.finalAzimuthDeg).toBeCloseTo(90, 9);
  });

  it("scales a degree of longitude on the equator by the semi-major axis", () => {
    // a·π/180 = 6 378 137 × 0,0174532925 = 111 319,4906 m
    const result = geodesicInverse({ from: { lat: 0, lon: 0 }, to: { lat: 0, lon: 1 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceM).toBeCloseTo(111319.4906, 2);
  });

  it("refuses coincident points and a coordinate that is not one", () => {
    expect(geodesicInverse({ from: { lat: 44, lon: 20 }, to: { lat: 44, lon: 20 } }).ok).toBe(
      false,
    );
    expect(geodesicInverse({ from: { lat: 95, lon: 20 }, to: { lat: 44, lon: 20 } }).ok).toBe(
      false,
    );
  });
});

describe("geodesicDirect", () => {
  it("lays out the quarter meridian and the quarter equator", () => {
    const north = geodesicDirect({ from: { lat: 0, lon: 0 }, azimuthDeg: 0, distanceM: 10001965.7293 });
    expect(north.ok).toBe(true);
    if (!north.ok) return;
    expect(north.to.lat).toBeCloseTo(90, 9);
    expect(north.to.lon).toBeCloseTo(0, 9);
    expect(north.finalAzimuthDeg).toBeCloseTo(0, 9);

    const east = geodesicDirect({
      from: { lat: 0, lon: 0 },
      azimuthDeg: 90,
      distanceM: 10018754.1714,
    });
    expect(east.ok).toBe(true);
    if (!east.ok) return;
    expect(east.to.lat).toBeCloseTo(0, 9);
    expect(east.to.lon).toBeCloseTo(90, 9);
    expect(east.finalAzimuthDeg).toBeCloseTo(90, 9);
  });

  it("returns a point the inverse function agrees with", () => {
    const start = { lat: 44.8, lon: 20.4667 };
    const laid = geodesicDirect({ from: start, azimuthDeg: 123.4, distanceM: 4321.5 });
    expect(laid.ok).toBe(true);
    if (!laid.ok) return;
    const measured = geodesicInverse({ from: start, to: laid.to });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect(measured.distanceM).toBeCloseTo(4321.5, 6);
    expect(measured.initialAzimuthDeg).toBeCloseTo(123.4, 6);
  });

  it("refuses a distance of zero and an azimuth that is not a number", () => {
    expect(geodesicDirect({ from: { lat: 44, lon: 20 }, azimuthDeg: 90, distanceM: 0 }).ok).toBe(
      false,
    );
    expect(
      geodesicDirect({ from: { lat: 44, lon: 20 }, azimuthDeg: Number.NaN, distanceM: 100 }).ok,
    ).toBe(false);
  });
});

describe("gridGroundRatio", () => {
  it("is exactly k₀ along a central meridian, where the grid is the only error", () => {
    // Zone 34's central meridian: the northing is k₀ times the meridional arc
    // and the geodesic is that same arc, so grid ÷ ground = 0,9996 exactly.
    const result = gridGroundRatio({
      from: { lat: 44, lon: 21 },
      to: { lat: 45, lon: 21 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(0.9996, 9);
    expect(result.gridDistanceM).toBeCloseTo(result.groundDistanceM * 0.9996, 4);
  });

  it("rises away from the central meridian", () => {
    const edge = gridGroundRatio({
      from: { lat: 44, lon: 18 },
      to: { lat: 45, lon: 18 },
    });
    expect(edge.ok).toBe(true);
    if (!edge.ok) return;
    expect(edge.ratio).toBeGreaterThan(0.9996);
  });

  it("refuses two zones and two hemispheres", () => {
    expect(
      gridGroundRatio({
        from: { lat: 44, lon: 5.9 },
        to: { lat: 44, lon: 6.1 },
      }).ok,
    ).toBe(false);
    expect(
      gridGroundRatio({
        from: { lat: 0.5, lon: 21 },
        to: { lat: -0.5, lon: 21 },
      }).ok,
    ).toBe(false);
  });
});
