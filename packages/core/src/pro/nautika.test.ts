import { describe, expect, it } from "vitest";

import {
  anchorRode,
  courseToSteer,
  fuelRange,
  greatCircle,
  hullSpeed,
  ruleOfTwelfths,
  speedRun,
  vmg,
} from "./nautika.js";

/**
 * The sailing toolkit's arithmetic, against numbers worked out by hand.
 *
 * The great-circle cases are the ones worth checking twice, because the
 * spherical formulae are easy to write with a swapped argument and the error is
 * a plausible-looking bearing rather than a failure. Each expected value below
 * carries the arithmetic that produced it in the comment beside it.
 */

describe("speedRun", () => {
  it("gives the distance for a speed and a time", () => {
    // 6 kn × 3 h = 18 NM; 18 × 1852 m = 33 336 m over 3600 s = 9,26 m/s
    const result = speedRun({ speedKnots: 6, timeHours: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceNm).toBeCloseTo(18, 9);
    expect(result.distanceKm).toBeCloseTo(33.336, 9);
    expect(result.speedMs).toBeCloseTo(3.08667, 4);
    // 6 kn = 6 × 1852 m/h = 11 112 m/h = 11,112 km/h
    expect(result.speedKmh).toBeCloseTo(11.112, 4);
  });

  it("gives the time for a distance and a speed", () => {
    // 12 NM at 6 kn = 2 h = 120 min
    const result = speedRun({ speedKnots: 6, distanceNm: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timeHours).toBeCloseTo(2, 9);
    expect(result.timeMinutes).toBeCloseTo(120, 6);
  });

  it("gives the speed for a distance and a time", () => {
    // 20 NM in 2,5 h = 8 kn
    const result = speedRun({ distanceNm: 20, timeHours: 2.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.speedKnots).toBeCloseTo(8, 9);
    expect(result.distanceNm).toBeCloseTo(20, 9);
  });

  it("accepts a drift with no speed", () => {
    const result = speedRun({ distanceNm: 0, timeHours: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.speedKnots).toBe(0);
  });

  it("refuses a pair it cannot arbitrate, and a field it never received", () => {
    expect(speedRun({ speedKnots: 6, distanceNm: 12, timeHours: 2 }).ok).toBe(false);
    expect(speedRun({ speedKnots: 6 }).ok).toBe(false);
    expect(speedRun({ timeHours: 2 }).ok).toBe(false);
    expect(speedRun({ distanceNm: 12 }).ok).toBe(false);
    expect(speedRun({ distanceNm: 12, timeHours: 0 }).ok).toBe(false);
    const pair = speedRun({ speedKnots: 6, distanceNm: 12, timeHours: 2 });
    if (!pair.ok) expect(pair.reason).toBe("pair");
  });
});

describe("greatCircle", () => {
  it("measures a degree of longitude on the equator", () => {
    // 1° = 0,0174533 rad; 6371,0088 km × 0,0174533 = 111,195 km = 60,04 NM
    const result = greatCircle({ from: { lat: 0, lon: 0 }, to: { lat: 0, lon: 1 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceKm).toBeCloseTo(111.1949, 3);
    expect(result.distanceNm).toBeCloseTo(60.0402, 3);
    expect(result.initialBearingDeg).toBeCloseTo(90, 6);
    expect(result.finalBearingDeg).toBeCloseTo(90, 6);
  });

  it("measures a degree of latitude, and points due north", () => {
    const result = greatCircle({ from: { lat: 0, lon: 0 }, to: { lat: 1, lon: 0 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceKm).toBeCloseTo(111.1949, 3);
    expect(result.initialBearingDeg).toBeCloseTo(0, 6);
    expect(result.rhumbBearingDeg).toBeCloseTo(0, 6);
    expect(result.rhumbDistanceNm).toBeCloseTo(result.distanceNm, 6);
  });

  it("separates the orthodrome from the loxodrome on a long leg", () => {
    // From (0°, 0°) to (60°N, 90°E):
    //   haversine a = sin²30° + cos0°·cos60°·sin²45° = 0,25 + 0,25 = 0,5
    //   so the central angle is 2·asin(√0,5) = 90°, and with the IUGG mean
    //   radius 6371,0088 km the distance is R·π/2 = 10 007,557 km
    //   initial bearing = atan2(sin90°·cos60°, sin60°) = atan2(0,5; 0,8660) = 30°
    //   Mercator: Δψ = ln(tan75°) = 1,316958, q = (π/3)/Δψ = 0,795164
    //   rhumb = R·√(Δφ² + (q·Δλ)²) = R·1,630190 = 10 384,403 km, bearing 50,023°
    const result = greatCircle({ from: { lat: 0, lon: 0 }, to: { lat: 60, lon: 90 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.centralAngleDeg).toBeCloseTo(90, 9);
    expect(result.distanceKm).toBeCloseTo(10007.557, 3);
    expect(result.initialBearingDeg).toBeCloseTo(30, 9);
    // 10 384,403 km / 1,852 = 5607,129 NM
    expect(result.rhumbDistanceNm * 1.852).toBeCloseTo(10384.4033, 2);
    expect(result.rhumbBearingDeg).toBeCloseTo(50.0235, 3);
    // (10 384,403 − 10 007,557)/10 007,557 = 0,037656
    expect(result.rhumbExcess).toBeCloseTo(0.037656, 5);
  });

  it("gives the initial and final bearing apart on a long leg", () => {
    // The classic Atlantic case: London (51,5°N 0°W) to New York (40,7°N 74°W)
    // is 5 579,4 km with an initial course of 288,398°. The arrival bearing is
    // checked the other way round: the initial bearing from New York BACK to
    // London is 51,182°, so the course on arrival there is 51,182 + 180 =
    // 231,182°.
    const result = greatCircle({ from: { lat: 51.5, lon: 0 }, to: { lat: 40.7, lon: -74 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceKm).toBeGreaterThan(5500);
    expect(result.distanceKm).toBeLessThan(5650);
    expect(result.initialBearingDeg).toBeCloseTo(288.398, 3);
    expect(result.finalBearingDeg).toBeCloseTo(231.182, 3);
  });

  it("refuses a bearing for coincident points rather than returning due north", () => {
    const result = greatCircle({ from: { lat: 44, lon: 20 }, to: { lat: 44, lon: 20 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceNm).toBe(0);
    expect(result.initialBearingDeg).toBeUndefined();
    expect(result.rhumbBearingDeg).toBeUndefined();
  });

  it("refuses a latitude or a longitude that is not one", () => {
    expect(greatCircle({ from: { lat: 95, lon: 0 }, to: { lat: 0, lon: 0 } }).ok).toBe(false);
    expect(greatCircle({ from: { lat: 0, lon: 0 }, to: { lat: 0, lon: 200 } }).ok).toBe(false);
    const from = greatCircle({ from: { lat: 95, lon: 0 }, to: { lat: 0, lon: 0 } });
    if (!from.ok) expect(from.reason).toBe("from");
  });
});

describe("anchorRode", () => {
  it("measures the scope from the bow, not from the waterline", () => {
    // 5 m of water + 1,5 m of bow = 6,5 m; 5:1 scope = 32,5 m = 106,63 ft
    const result = anchorRode({ depthM: 5, bowHeightM: 1.5, scope: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.depthUsedM).toBeCloseTo(6.5, 9);
    expect(result.rodeM).toBeCloseTo(32.5, 9);
    expect(result.rodeFt).toBeCloseTo(106.627, 3);
  });

  it("treats an omitted bow height as the waterline", () => {
    const result = anchorRode({ depthM: 4, scope: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.depthUsedM).toBeCloseTo(4, 9);
    expect(result.rodeM).toBeCloseTo(28, 9);
  });

  it("refuses a depth, a scope and a bow it cannot use", () => {
    expect(anchorRode({ depthM: 0, scope: 5 }).ok).toBe(false);
    expect(anchorRode({ depthM: 5, scope: 0 }).ok).toBe(false);
    expect(anchorRode({ depthM: 5, bowHeightM: -1, scope: 5 }).ok).toBe(false);
  });
});

describe("fuelRange", () => {
  it("takes the usable part, holds the reserve back and gives the range", () => {
    // usable = 200 × 0,95 = 190 l; reserve = 190 × 0,20 = 38 l; burnable = 152 l
    // hours = 152/8 = 19 h; range = 6 kn × 19 h = 114 NM = 211,13 km
    const result = fuelRange({
      tankLitres: 200,
      usablePercent: 95,
      burnLitresPerHour: 8,
      speedKnots: 6,
      reservePercent: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usableLitres).toBeCloseTo(190, 9);
    expect(result.reserveLitres).toBeCloseTo(38, 9);
    expect(result.burnableLitres).toBeCloseTo(152, 9);
    expect(result.hours).toBeCloseTo(19, 9);
    expect(result.hoursWithoutReserve).toBeCloseTo(23.75, 9);
    expect(result.rangeNm).toBeCloseTo(114, 9);
    expect(result.rangeKm).toBeCloseTo(211.128, 3);
  });

  it("refuses an empty tank and a zero burn", () => {
    expect(
      fuelRange({ tankLitres: 0, usablePercent: 100, burnLitresPerHour: 8, speedKnots: 6, reservePercent: 0 })
        .ok,
    ).toBe(false);
    expect(
      fuelRange({ tankLitres: 100, usablePercent: 100, burnLitresPerHour: 0, speedKnots: 6, reservePercent: 0 })
        .ok,
    ).toBe(false);
    expect(
      fuelRange({
        tankLitres: 100,
        usablePercent: 100,
        burnLitresPerHour: 8,
        speedKnots: 6,
        reservePercent: 120,
      }).ok,
    ).toBe(false);
  });
});

describe("hullSpeed", () => {
  it("follows Fr·√(g·L), which is the 1,34·√L_ft rule", () => {
    // v = 0,40 × √(9,80665 × 8) = 0,40 × 8,85739 = 3,54296 m/s
    //    = 3,54296/0,514444 = 6,887 kn;  6,887/√(8/0,3048) = 6,887/5,1232 = 1,344
    const result = hullSpeed({ lengthWaterlineM: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hullSpeedMs).toBeCloseTo(3.542952, 6);
    expect(result.hullSpeedKnots).toBeCloseTo(6.887, 3);
    expect(result.hullSpeedKmh).toBeCloseTo(12.755, 3);
    expect(result.lengthWaterlineFt).toBeCloseTo(26.2467, 4);
    expect(result.speedLengthRatio).toBeCloseTo(1.344, 3);
  });

  it("takes the Froude number from the user, and refuses one out of range", () => {
    // 0,30 × √78,4532 = 2,6572 m/s = 5,165 kn
    const result = hullSpeed({ lengthWaterlineM: 8, froude: 0.3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hullSpeedKnots).toBeCloseTo(5.165, 3);
    expect(result.froudeUsed).toBe(0.3);
    expect(hullSpeed({ lengthWaterlineM: 8, froude: 2 }).ok).toBe(false);
    expect(hullSpeed({ lengthWaterlineM: 0 }).ok).toBe(false);
  });
});

describe("ruleOfTwelfths", () => {
  const table = (rangeM: number) => ruleOfTwelfths({ rangeM, hoursFromTurn: 3, durationHours: 6 });

  it("moves half the range in the middle three hours", () => {
    // 1+2+3 = 6 twelfth-parts of 12 by the end of the third hour
    const result = table(3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fraction).toBeCloseTo(0.5, 9);
    expect(result.movedM).toBeCloseTo(1.5, 9);
    expect(result.heightAboveLowM).toBeCloseTo(1.5, 9);
  });

  it("moves the whole range by the end of the interval", () => {
    const result = ruleOfTwelfths({ rangeM: 3, hoursFromTurn: 6, durationHours: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fraction).toBeCloseTo(1, 9);
    expect(result.movedM).toBeCloseTo(3, 9);
    expect(result.heightAboveLowM).toBeCloseTo(0, 9);
    expect(result.table).toHaveLength(6);
  });

  it("interpolates inside the hour it is in", () => {
    // The second block carries the tide's second twelve-part (2/12 more than
    // the first), and 1,5 h is half way through a one-hour block:
    // 1/12 + (3/12 − 1/12)/2 = 2/12
    const result = ruleOfTwelfths({ rangeM: 12, hoursFromTurn: 1.5, durationHours: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fraction).toBeCloseTo(2 / 12, 9);
    expect(result.movedM).toBeCloseTo(2, 9);
  });

  it("scales the parts to the interval the user gives", () => {
    // A five-hour interval: the first block ends at 5/6 h, so 1 h is 1,2 blocks in
    const result = ruleOfTwelfths({ rangeM: 6, hoursFromTurn: 5 / 6, durationHours: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fraction).toBeCloseTo(1 / 12, 9);
  });

  it("refuses a time past the turn it is measuring from", () => {
    expect(ruleOfTwelfths({ rangeM: 3, hoursFromTurn: 7, durationHours: 6 }).ok).toBe(false);
    expect(ruleOfTwelfths({ rangeM: 0, hoursFromTurn: 1, durationHours: 6 }).ok).toBe(false);
  });
});

describe("vmg", () => {
  it("is the component of boat speed along the wind axis", () => {
    // 6 kn at 45° = 6 × 0,70711 = 4,2426 kn;  at 135° = −4,2426 kn
    const upwind = vmg({ boatSpeedKnots: 6, windAngleDeg: 45 });
    expect(upwind.ok).toBe(true);
    if (!upwind.ok) return;
    expect(upwind.vmgKnots).toBeCloseTo(4.2426, 4);
    expect(upwind.vmgKmh).toBeCloseTo(7.857, 3);
    expect(upwind.upwind).toBe(true);

    const downwind = vmg({ boatSpeedKnots: 6, windAngleDeg: 135 });
    expect(downwind.ok).toBe(true);
    if (!downwind.ok) return;
    expect(downwind.vmgKnots).toBeCloseTo(-4.2426, 4);
    expect(downwind.upwind).toBe(false);
  });

  it("refuses an angle outside the half circle and an empty speed", () => {
    expect(vmg({ boatSpeedKnots: 6, windAngleDeg: 200 }).ok).toBe(false);
    expect(vmg({ boatSpeedKnots: 0, windAngleDeg: 45 }).ok).toBe(false);
  });
});

describe("courseToSteer", () => {
  it("steers into the current to hold the track", () => {
    // track 000°, boat 5 kn, current setting 090° at 2 kn:
    //   sin θ = −(2/5)·sin 90° = −0,4 → θ = −23,578°
    //   heading = 336,422°;  GS = 5·cos 23,578° = 4,5826 kn
    const result = courseToSteer({
      trackDeg: 0,
      boatSpeedKnots: 5,
      currentSetDeg: 90,
      currentDriftKnots: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.driftAngleDeg).toBeCloseTo(-23.578, 3);
    expect(result.headingDeg).toBeCloseTo(336.422, 3);
    expect(result.groundSpeedKnots).toBeCloseTo(4.5826, 4);
    expect(result.groundSpeedKmh).toBeCloseTo(8.487, 3);
  });

  it("leaves the heading alone when there is no current", () => {
    const result = courseToSteer({
      trackDeg: 45,
      boatSpeedKnots: 6,
      currentSetDeg: 0,
      currentDriftKnots: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headingDeg).toBeCloseTo(45, 9);
    expect(result.groundSpeedKnots).toBeCloseTo(6, 9);
  });

  it("refuses a current no heading can hold", () => {
    // 3 kn of east-going current across a track of 000° with only 1 kn of boat
    // speed is a ratio of 3, and sin θ cannot reach it.
    const result = courseToSteer({
      trackDeg: 0,
      boatSpeedKnots: 1,
      currentSetDeg: 90,
      currentDriftKnots: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("current");
  });
});

