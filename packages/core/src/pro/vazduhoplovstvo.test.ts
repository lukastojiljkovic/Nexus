import { describe, expect, it } from "vitest";

import {
  altimeterUnits,
  fuelReserve,
  isaAtmosphere,
  pressureAltitude,
  trueAirspeed,
  windComponents,
  windTriangle,
} from "./vazduhoplovstvo.js";

/**
 * The aviation toolkit's arithmetic, against numbers worked out by hand.
 *
 * The ISA cases are quoted from the standard's own table as well as recomputed,
 * because a typo in a constant produces a column of perfectly ordinary-looking
 * figures: at 10 000 ft the troposphere law gives −4,81 °C, 696,82 hPa and
 * 0,9046 kg/m³, which is what Doc 7488's table prints. Each expected value below
 * carries the arithmetic that produced it.
 */

describe("isaAtmosphere", () => {
  it("is the standard day at mean sea level", () => {
    // T0 = 288,15 K = 15 °C; p0 = 1013,25 hPa; ρ0 = p0/(R·T0) = 1,225 kg/m³
    // a0 = √(1,4 × 287,05287 × 288,15) = 340,294 m/s
    const result = isaAtmosphere({ altitudeFt: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layer).toBe("troposphere");
    expect(result.temperatureC).toBeCloseTo(15, 9);
    expect(result.pressureHpa).toBeCloseTo(1013.25, 6);
    // The gas law gives 101325/(287,05287·288,15) = 1,2249992 kg/m³, which is
    // the standard's 1,225 rounded to four places — so the ratio against the
    // published ρ₀ is 0,9999993 and not exactly one.
    expect(result.densityKgM3).toBeCloseTo(1.225, 5);
    expect(result.speedOfSoundMs).toBeCloseTo(340.294, 3);
    expect(result.densityRatio).toBeCloseTo(1, 5);
  });

  it("follows the 6,5 K/km lapse and its pressure exponent at 10 000 ft", () => {
    // h = 3048 m; T = 288,15 − 0,0065 × 3048 = 268,338 K = −4,812 °C
    // (T/T0)^5,255876 = 0,931262^5,255876 = 0,687738 → p = 696,82 hPa
    // ρ = p/(R·T) = 0,90464 kg/m³; a = √(1,4·R·T) = 328,387 m/s
    const result = isaAtmosphere({ altitudeFt: 10000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.temperatureC).toBeCloseTo(-4.812, 3);
    expect(result.pressureHpa).toBeCloseTo(696.8166, 3);
    expect(result.densityKgM3).toBeCloseTo(0.904637, 5);
    expect(result.speedOfSoundMs).toBeCloseTo(328.387, 3);
    expect(result.densityRatio).toBeCloseTo(0.738479, 5);
  });

  it("holds 216,65 K above the tropopause", () => {
    // 40 000 ft = 12 192 m, in the isothermal layer: T = −56,5 °C exactly, and
    // p = p₁₁·exp(−g·Δh/(R·T₁₁)) with p₁₁ = 226,3206 hPa at 11 km
    const result = isaAtmosphere({ altitudeFt: 40000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layer).toBe("isothermal");
    expect(result.temperatureC).toBeCloseTo(-56.5, 9);
    expect(result.pressureHpa).toBeCloseTo(187.5393, 3);
    expect(result.speedOfSoundMs).toBeCloseTo(295.07, 2);
  });

  it("refuses an altitude it does not model", () => {
    expect(isaAtmosphere({ altitudeFt: -2000 }).ok).toBe(false);
    expect(isaAtmosphere({ altitudeFt: 70000 }).ok).toBe(false);
    const high = isaAtmosphere({ altitudeFt: 70000 });
    if (!high.ok) expect(high.reason).toBe("altitude");
  });
});

describe("pressureAltitude", () => {
  it("puts the standard sea-level pressure at zero and at the standard temperature", () => {
    const result = pressureAltitude({ pressureHpa: 1013.25, temperatureC: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pressureAltitudeFt).toBeCloseTo(0, 6);
    expect(result.isaTemperatureC).toBeCloseTo(15, 9);
    expect(result.isaDeviationK).toBeCloseTo(0, 9);
    // The same rounded ρ₀ leaves a floor of about 0,02 ft on the DENSITY
    // altitude while the pressure altitude is exactly zero.
    expect(result.pressureAltitudeM).toBeCloseTo(0, 9);
    expect(result.densityAltitudeFt).toBeCloseTo(0, 1);
  });

  it("inverts the standard atmosphere for a low-pressure day", () => {
    // 900 hPa: h = 44295,077·(1 − (900/1013,25)^(1/5,255876)) = 988,501 m =
    // 3243,11 ft, where the ISA temperature is 8,575 °C
    const result = pressureAltitude({ pressureHpa: 900, temperatureC: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pressureAltitudeM).toBeCloseTo(988.501, 3);
    expect(result.pressureAltitudeFt).toBeCloseTo(3243.11, 2);
    expect(result.isaTemperatureC).toBeCloseTo(8.575, 3);
    // 15 °C against 8,575 °C is a deviation of +6,425 K
    expect(result.isaDeviationK).toBeCloseTo(6.425, 3);
  });

  it("puts a hot day's density above its pressure altitude", () => {
    // 1000 hPa and 30 °C: ρ = 1000·100/(287,05287·303,15) = 1,149159 kg/m³,
    // DA = 44295,077·(1 − (1,149159/1,225)^(1/4,255876)) = 660,739 m = 2167,8 ft
    const result = pressureAltitude({ pressureHpa: 1000, temperatureC: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.densityKgM3).toBeCloseTo(1.149159, 6);
    expect(result.densityAltitudeFt).toBeCloseTo(2167.78, 2);
    expect(result.densityAltitudeFt).toBeGreaterThan(result.pressureAltitudeFt);
  });

  it("refuses a pressure and a temperature outside the range it inverts", () => {
    expect(pressureAltitude({ pressureHpa: 0, temperatureC: 15 }).ok).toBe(false);
    expect(pressureAltitude({ pressureHpa: 2000, temperatureC: 15 }).ok).toBe(false);
    expect(pressureAltitude({ pressureHpa: 900, temperatureC: 200 }).ok).toBe(false);
  });
});

describe("trueAirspeed", () => {
  it("raises the true airspeed by the square root of the density ratio", () => {
    // 5000 ft = 1524 m, ISA pressure 843,07 hPa, at 20 °C:
    // ρ = 1,001874 kg/m³, σ = 0,817856, TAS = 120·√(1/0,817856) = 132,691 kt
    const result = trueAirspeed({ casKt: 120, pressureAltitudeFt: 5000, temperatureC: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.densityKgM3).toBeCloseTo(1.001874, 6);
    expect(result.densityRatio).toBeCloseTo(0.817856, 6);
    expect(result.tasKt).toBeCloseTo(132.6914, 4);
    expect(result.tasMs).toBeCloseTo(68.262, 3);
  });

  it("agrees with the calibrated airspeed at sea level on a standard day", () => {
    const result = trueAirspeed({ casKt: 150, pressureAltitudeFt: 0, temperatureC: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ρ from the gas law is 1,2249992, so σ is 0,9999993 and the TAS is
    // 150,000052 kt rather than exactly 150.
    expect(result.tasKt).toBeCloseTo(150, 3);
  });

  it("refuses an airspeed and an altitude outside the model", () => {
    expect(trueAirspeed({ casKt: 0, pressureAltitudeFt: 0, temperatureC: 15 }).ok).toBe(false);
    expect(trueAirspeed({ casKt: 120, pressureAltitudeFt: 60000, temperatureC: 15 }).ok).toBe(false);
  });
});

describe("windTriangle", () => {
  it("turns the nose into the wind and keeps the course", () => {
    // Course 090°, TAS 120 kt, wind from 360° at 30 kt (a pure crosswind from
    // the left): sin(WCA) = (30/120)·sin(−90°) = −0,25 → WCA = −14,4775°
    // heading = 090 − 14,4775 = 075,5225°; GS = 120·cos(14,4775°) = 116,190 kt
    const result = windTriangle({
      courseDeg: 90,
      tasKt: 120,
      windFromDeg: 360,
      windKt: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.windCorrectionAngleDeg).toBeCloseTo(-14.4775, 4);
    expect(result.headingDeg).toBeCloseTo(75.5225, 4);
    expect(result.groundSpeedKt).toBeCloseTo(116.1895, 4);
    expect(result.crosswindKt).toBeCloseTo(-30, 6);
    expect(result.headwindKt).toBeCloseTo(0, 9);
  });

  it("adds a tailwind and subtracts a headwind", () => {
    // Wind from 270° on a course of 090° is a dead tailwind: GS = 120 + 40
    const tail = windTriangle({ courseDeg: 90, tasKt: 120, windFromDeg: 270, windKt: 40 });
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    expect(tail.groundSpeedKt).toBeCloseTo(160, 6);
    expect(tail.headwindKt).toBeCloseTo(-40, 6);

    const head = windTriangle({ courseDeg: 90, tasKt: 120, windFromDeg: 90, windKt: 40 });
    expect(head.ok).toBe(true);
    if (!head.ok) return;
    expect(head.groundSpeedKt).toBeCloseTo(80, 6);
    expect(head.headwindKt).toBeCloseTo(40, 6);
  });

  it("refuses a crosswind no heading can hold", () => {
    // 20 kt of crosswind across a 10 kt airspeed is a ratio of 2, which
    // asin cannot reach.
    const result = windTriangle({ courseDeg: 0, tasKt: 10, windFromDeg: 90, windKt: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("noSolution");
  });
});

describe("windComponents", () => {
  it("splits the wind down the runway and flips it for the reciprocal", () => {
    // Wind from 040° at 25 kt, runway 090°: Δ = −50°,
    // head = 25·cos(−50°) = 16,0697 kt, cross = 25·sin(−50°) = −19,1511 kt
    const result = windComponents({ windFromDeg: 40, windKt: 25, runwayDeg: 90 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.angleDeg).toBeCloseTo(50, 6);
    expect(result.headwindKt).toBeCloseTo(16.0697, 4);
    expect(result.crosswindKt).toBeCloseTo(-19.1511, 4);
    expect(result.reciprocalHeadwindKt).toBeCloseTo(-16.0697, 4);
    expect(result.reciprocalCrosswindKt).toBeCloseTo(19.1511, 4);
  });

  it("reads a dead headwind and a dead tailwind", () => {
    const head = windComponents({ windFromDeg: 90, windKt: 20, runwayDeg: 90 });
    expect(head.ok).toBe(true);
    if (!head.ok) return;
    expect(head.headwindKt).toBeCloseTo(20, 9);
    expect(head.crosswindKt).toBeCloseTo(0, 9);
    expect(head.angleDeg).toBeCloseTo(0, 9);

    const tail = windComponents({ windFromDeg: 270, windKt: 20, runwayDeg: 90 });
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    expect(tail.headwindKt).toBeCloseTo(-20, 9);
    expect(tail.angleDeg).toBeCloseTo(180, 9);
  });

  it("refuses a wind, a runway or a speed outside its ranges", () => {
    expect(windComponents({ windFromDeg: 400, windKt: 10, runwayDeg: 90 }).ok).toBe(false);
    expect(windComponents({ windFromDeg: 90, windKt: 10, runwayDeg: -10 }).ok).toBe(false);
    expect(windComponents({ windFromDeg: 90, windKt: 400, runwayDeg: 90 }).ok).toBe(false);
  });
});

describe("fuelReserve", () => {
  it("takes the reserve off the top in minutes and gives endurance and range", () => {
    // 120 l at 30 l/h with a 45-minute reserve:
    // reserve = 30 × 45/60 = 22,5 l; burnable = 97,5 l; t = 3,25 h = 195 min
    // range = 110 kt × 3,25 h = 357,5 NM = 662,09 km
    const result = fuelReserve({
      fuelLitres: 120,
      burnLitresPerHour: 30,
      speedKt: 110,
      reserveMinutes: 45,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reserveLitres).toBeCloseTo(22.5, 9);
    expect(result.burnableLitres).toBeCloseTo(97.5, 9);
    expect(result.enduranceHours).toBeCloseTo(3.25, 9);
    expect(result.enduranceMinutes).toBeCloseTo(195, 9);
    expect(result.rangeNm).toBeCloseTo(357.5, 9);
    expect(result.rangeKm).toBeCloseTo(662.09, 2);
    expect(result.hoursWithoutReserve).toBeCloseTo(4, 9);
    expect(result.rangeWithoutReserveNm).toBeCloseTo(440, 9);
  });

  it("refuses a reserve that eats the whole load", () => {
    // 120 l at 30 l/h and a 300-minute reserve is 150 l of reserve
    const result = fuelReserve({
      fuelLitres: 120,
      burnLitresPerHour: 30,
      speedKt: 110,
      reserveMinutes: 300,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("reserve");
  });
});

describe("altimeterUnits", () => {
  it("converts inches of mercury exactly, and hPa into mb one for one", () => {
    // 1 inHg = 25,4 × 133,322387415 Pa = 3386,388640341 Pa, so 30 inHg =
    // 1015,9165921 hPa
    const result = altimeterUnits({ value: 30, unit: "inhg" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pa).toBeCloseTo(101591.65921, 5);
    expect(result.hpa).toBeCloseTo(1015.9165921, 6);
    expect(result.mb).toBeCloseTo(result.hpa, 9);
  });

  it("comes back to the same inches of mercury from a hectopascal figure", () => {
    // 1013,25 hPa = 101325/3386,388640341 = 29,921256 inHg
    const result = altimeterUnits({ value: 1013.25, unit: "hpa" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inHg).toBeCloseTo(29.921256, 6);
  });

  it("refuses a pressure it cannot be, and a unit it does not know", () => {
    expect(altimeterUnits({ value: 0, unit: "inhg" }).ok).toBe(false);
    expect(altimeterUnits({ value: 100, unit: "inhg" }).ok).toBe(false);
    // A selector value from outside the union is a claim, not a fact.
    expect(altimeterUnits({ value: 1013, unit: "psi" as "hpa" }).ok).toBe(false);
  });
});
