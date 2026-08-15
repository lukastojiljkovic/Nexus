import { describe, expect, it } from "vitest";

import {
  awgToMetric,
  batteryBankRuntime,
  beltDrive,
  cableCrossSection,
  convertPressure,
  gearPair,
  inductionMotorRating,
  junctionTemperature,
  metricThread,
  metricToAwg,
  nearestPreferredValue,
  networkEquivalent,
  ohmsLaw,
  permissibleDissipation,
  pipeFlow,
  pistonForce,
  powerFactorCorrection,
  requiredSinkResistance,
  resistorBandsForValue,
  resistorFromBands,
  rlcResponse,
  sectionProperties,
  threePhasePower,
  torqueSpeedPower,
  voltageDivider,
} from "./inzenjering.js";

/**
 * Every expectation here was worked by hand from the inputs before it was
 * written down, and the arithmetic is in the comment above it so a reader can
 * check it without running anything. A test whose expected value was copied out
 * of a first run pins the bug as firmly as the behaviour.
 *
 * Two habits this file keeps deliberately. First, where a published table exists
 * — ISO 898-1 stress areas, AWG diameters, E24 — the vector is checked against
 * the table as well as against the formula, because agreeing with a table is the
 * only evidence that the formula is the RIGHT formula and not merely a
 * self-consistent one. Second, no test asserts a verdict, because no function
 * returns one: a `life-safety` tool is tested on its quantities and on the ratio
 * against a limit the test itself supplies.
 */

/**
 * Every key on a result, including the ones inside its groups.
 *
 * Two tools below assert that no field on their answer is named after a
 * verdict, and that check used to read `Object.keys(result)` — which was the
 * whole result back when every field was flat. Grouping the correlated
 * optionals moved fields one level down, so a flat read would now pass over a
 * `passes` that had grown inside `nearest`, `engagement` or `polar`. A check
 * whose reach shrinks when the data moves is the shape DC-45 named; it walks
 * now, exactly as `agro.test.ts` does.
 */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, out);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    out.push(key);
    allKeys(child, out);
  }
  return out;
}

describe("awgToMetric", () => {
  it("evaluates the defining law: AWG 12 in copper", () => {
    const result = awgToMetric({ gauge: 12, material: "copper" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (36 - 12)/39 = 0.615384615; x ln 92 (4.5217885770) = 2.78263915;
    // e^2.78263915 = 16.1616172; x 0.127 = 2.05252539 mm.
    expect(result.diameterMm).toBeCloseTo(2.05252539, 8);
    // 2.05252539/25.4 = 0.0808080862 in
    expect(result.diameterInch).toBeCloseTo(0.0808080862, 10);
    // d^2 = 4.21286048; x pi/4 = 3.30877288 mm2 — the printed table says 3.31.
    expect(result.areaMm2).toBeCloseTo(3.30877288, 8);
    // (1000/58) = 17.2413793 ohm*mm2/km; /3.30877288 = 5.21080774 ohm/km
    expect(result.resistanceOhmPerKm).toBeCloseTo(5.21080774, 8);
  });

  // „4/0" rather than „#0000": the four-zero gauge written with a hash is four
  // hex digits, and `check:colours` cannot tell it from a raw colour literal.
  it("returns the second defining point exactly: 4/0 AWG is 0.4600 in", () => {
    // The series is fixed by its two ends, so at gauge -3 the law must give back
    // 0.46 in — 0.127 x 92 = 11.684 mm — with no rounding anywhere in between.
    const result = awgToMetric({ gauge: -3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diameterMm).toBeCloseTo(11.684, 9);
    expect(result.diameterInch).toBeCloseTo(0.46, 12);
  });

  it("puts aluminium's higher resistivity into the ohm/km row and nowhere else", () => {
    const copper = awgToMetric({ gauge: 12, material: "copper" });
    const aluminium = awgToMetric({ gauge: 12, material: "aluminium" });
    expect(copper.ok && aluminium.ok).toBe(true);
    if (!copper.ok || !aluminium.ok) return;
    expect(aluminium.diameterMm).toBe(copper.diameterMm);
    // 28.264 / 3.30877288 = 8.5421397 ohm/km (copper's 5.21080774 x the fixed
    // resistivity ratio 0.028264 x 58 = 1.639312 agrees: 5.21080774 x 1.639312
    // = 8.5421397)
    expect(aluminium.resistanceOhmPerKm).toBeCloseTo(8.5421397, 6);
  });

  it("refuses a gauge outside the defined series or one that is not a whole designation", () => {
    expect(awgToMetric({ gauge: 41 })).toEqual({ ok: false, reason: "gauge" });
    expect(awgToMetric({ gauge: -4 })).toEqual({ ok: false, reason: "gauge" });
    expect(awgToMetric({ gauge: 12.5 })).toEqual({ ok: false, reason: "gauge" });
    expect(awgToMetric({ gauge: Number.NaN })).toEqual({ ok: false, reason: "gauge" });
  });
});

describe("metricToAwg", () => {
  it("inverts the law for 6 mm2 and shows the whole gauge beside the fractional one", () => {
    const result = metricToAwg({ areaMm2: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // d = sqrt(4*6/pi) = sqrt(7.63943727) = 2.76395320 mm
    expect(result.diameterMm).toBeCloseTo(2.7639532, 7);
    // d/0.127 = 21.7634110; ln = 3.08023015; x39 = 120.128976;
    // /4.5217885770 = 26.5666947; 36 - 26.5666947 = 9.43330534
    expect(result.gauge).toBeCloseTo(9.43330534, 8);
    expect(result.nearest?.gauge).toBe(9);
    // (36 - 9)/39 = 0.692307692; x ln 92 = 3.13046904; e^... = 22.8847103;
    // x0.127 = 2.90635821 mm; area = pi/4 x 8.44691... = 6.63419391 mm2
    expect(result.nearest?.diameterMm).toBeCloseTo(2.90635821, 8);
    expect(result.nearest?.areaMm2).toBeCloseTo(6.63419391, 8); // table: AWG 9 = 6.63
  });

  it("leaves the whole-gauge fields absent past the end of the defined series", () => {
    // 20 mm of copper is AWG -7.636, and #00000000 is not a designation that
    // exists — so the neighbour is omitted rather than extrapolated. All three
    // figures at once: a gauge outside the series has no diameter and therefore
    // no area, so they are one field and cannot go missing one at a time.
    const result = metricToAwg({ diameterMm: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gauge).toBeCloseTo(-7.63598935, 8);
    expect(result.nearest).toBeUndefined();
  });

  it("refuses both-or-neither, and a non-positive or oversized dimension", () => {
    expect(metricToAwg({})).toEqual({ ok: false, reason: "known" });
    expect(metricToAwg({ diameterMm: 2, areaMm2: 6 })).toEqual({ ok: false, reason: "known" });
    expect(metricToAwg({ diameterMm: 0 })).toEqual({ ok: false, reason: "diameter" });
    expect(metricToAwg({ diameterMm: 21 })).toEqual({ ok: false, reason: "diameter" });
    expect(metricToAwg({ areaMm2: -1 })).toEqual({ ok: false, reason: "area" });
    expect(metricToAwg({ areaMm2: 301 })).toEqual({ ok: false, reason: "area" });
  });
});

describe("batteryBankRuntime", () => {
  it("runs a 24 V pack at 300 W through the converter", () => {
    const result = batteryBankRuntime({
      cellCapacityAh: 100,
      cellVoltage: 12,
      series: 2,
      depthOfDischargePct: 50,
      load: { kind: "power", watts: 300 },
      converterEfficiencyPct: 90,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packVoltage).toBe(24); // 2 x 12
    expect(result.packCapacityAh).toBe(100); // 1 x 100
    expect(result.energyWh).toBe(2400); // 24 x 100
    expect(result.usableEnergyWh).toBe(1080); // 2400 x 0.5 x 0.9
    expect(result.hours).toBeCloseTo(3.6, 10); // 1080/300
    // The current path must agree: I = 300/(24 x 0.9) = 13.8889 A, and
    // 100 x 0.5 / 13.8889 = 3.6 h. The converter loss comes out of the battery.
    expect(result.packCurrentA).toBeCloseTo(13.8888889, 7);
    expect(result.wholeHours).toBe(3);
    expect(result.minutes).toBe(36); // 0.6 x 60
    expect(result.peukertFullHours).toBeUndefined();
  });

  it("applies Peukert only when the exponent is above one, and shows both times", () => {
    const result = batteryBankRuntime({
      cellCapacityAh: 200,
      cellVoltage: 12,
      depthOfDischargePct: 80,
      load: { kind: "current", amps: 50 },
      peukertExponent: 1.25,
      ratedDischargeHours: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // C/(H*I) = 200/(20 x 50) = 0.2; ln 0.2 = -1.60943791; x1.25 = -2.01179739;
    // e^-2.01179739 = 0.133748061; x20 = 2.67496122 h
    expect(result.peukertFullHours).toBeCloseTo(2.67496122, 8);
    // x DoD 0.8 = 2.13996898 h; 0.13996898 x 60 = 8.398 min -> 8
    expect(result.hours).toBeCloseTo(2.13996898, 8);
    expect(result.wholeHours).toBe(2);
    expect(result.minutes).toBe(8);
    // Without the correction it would have been 200 x 0.8 / 50 = 3.2 h.
    expect(result.hoursWithoutPeukert).toBeCloseTo(3.2, 10);
  });

  it("returns H exactly when the load happens to be the rated discharge rate", () => {
    // The Peukert form is written so that at I = C/H it gives back H whatever the
    // exponent is — the identity the exponent is fitted to. 200/20 = 10 A.
    const result = batteryBankRuntime({
      cellCapacityAh: 200,
      cellVoltage: 12,
      depthOfDischargePct: 100,
      load: { kind: "current", amps: 10 },
      peukertExponent: 1.3,
      ratedDischargeHours: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.peukertFullHours).toBeCloseTo(20, 10);
    expect(result.hours).toBeCloseTo(20, 10); // DoD 100 % is permitted arithmetic
  });

  it("carries the converter efficiency into the Peukert current on the POWER branch", () => {
    // Peukert's law is defined for a constant-current discharge; a power load
    // with k > 1 is treated as its constant-current equivalent, and the
    // efficiency belongs to that equivalent current — not to the raw P/U. This
    // is the one path where a dropped `eta` or a DoD applied inside rather than
    // outside the exponent would go unnoticed by the current-load Peukert tests.
    const result = batteryBankRuntime({
      cellCapacityAh: 100,
      cellVoltage: 12,
      series: 2,
      depthOfDischargePct: 50,
      load: { kind: "power", watts: 300 },
      converterEfficiencyPct: 90,
      peukertExponent: 1.25,
      ratedDischargeHours: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // packCurrentA = 300/(24 x 0.9) = 13.8888889 A
    expect(result.packCurrentA).toBeCloseTo(13.8888889, 6);
    // rateRatio = 100/(20 x 13.8888889) = 100/277.777778 = 0.36
    // peukertFullHours = 20 x 0.36^1.25 = 20 x 0.36 x sqrt(0.6) = 5.57709602 h
    expect(result.peukertFullHours).toBeCloseTo(5.57709602, 6);
    // hours = 5.57709602 x 0.5 = 2.78854801 h -> 2 h 47 min
    expect(result.hours).toBeCloseTo(2.78854801, 6);
    expect(result.wholeHours).toBe(2);
    expect(result.minutes).toBe(47);
    // Without Peukert the same load gives the plain linear 1080 Wh/300 W = 3.6 h,
    // making the size of the correction (3.6 -> 2.79 h) visible and large enough
    // that a wrong branch could not hide behind it.
    expect(result.hoursWithoutPeukert).toBeCloseTo(3.6, 10);
  });

  it("refuses each missing or impossible input by name, and Peukert without a rated regime", () => {
    const base = {
      cellCapacityAh: 100,
      cellVoltage: 12,
      depthOfDischargePct: 50,
      load: { kind: "power", watts: 300 },
    } as const;
    expect(batteryBankRuntime({ ...base, cellCapacityAh: 0 })).toEqual({
      ok: false,
      reason: "capacity",
    });
    expect(batteryBankRuntime({ ...base, cellVoltage: -12 })).toEqual({
      ok: false,
      reason: "voltage",
    });
    expect(batteryBankRuntime({ ...base, series: 1.5 })).toEqual({ ok: false, reason: "series" });
    expect(batteryBankRuntime({ ...base, parallel: 0 })).toEqual({ ok: false, reason: "parallel" });
    expect(batteryBankRuntime({ ...base, depthOfDischargePct: 101 })).toEqual({
      ok: false,
      reason: "depthOfDischarge",
    });
    expect(batteryBankRuntime({ ...base, converterEfficiencyPct: 0 })).toEqual({
      ok: false,
      reason: "efficiency",
    });
    expect(batteryBankRuntime({ ...base, peukertExponent: 2.5 })).toEqual({
      ok: false,
      reason: "peukert",
    });
    expect(batteryBankRuntime({ ...base, load: { kind: "current", amps: 0 } })).toEqual({
      ok: false,
      reason: "load",
    });
    // k > 1 needs the regime the capacity was rated at; it is not guessable.
    expect(batteryBankRuntime({ ...base, peukertExponent: 1.2 })).toEqual({
      ok: false,
      reason: "ratedHours",
    });
  });
});

describe("beltDrive", () => {
  it("computes the exact open-belt geometry of a 100/250 pair at 500 mm centres", () => {
    const result = beltDrive({
      drivingDiameterMm: 100,
      drivenDiameterMm: 250,
      drivingSpeedRpm: 1450,
      centreDistanceMm: 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBe(2.5); // 250/100
    expect(result.drivenSpeedRpm).toBe(580); // 1450/2.5
    // pi x 100 x 1450 / 60000 = 455530.935/60000 = 7.59218225 m/s
    expect(result.beltSpeedMs).toBeCloseTo(7.59218225, 8);
    // gamma = arcsin(150/1000) = 0.150568273 rad;
    // sqrt(1000000 - 22500) = 988.685997;
    // 125 x (pi + 0.301136546) = 430.341150; 50 x (pi - 0.301136546) = 142.022805
    expect(result.beltLengthMm).toBeCloseTo(1561.04995, 5);
    expect(result.wrapLargeDeg).toBeCloseTo(197.253853, 6);
    expect(result.wrapSmallDeg).toBeCloseTo(162.746147, 6);
    // The two arcs are the whole circle between them — the implementation's check.
    expect(result.wrapSmallDeg + result.wrapLargeDeg).toBeCloseTo(360, 10);
  });

  it("degenerates correctly to two equal pulleys: gamma = 0 and L = 2C + pi*d", () => {
    const result = beltDrive({
      drivingDiameterMm: 100,
      drivenDiameterMm: 100,
      drivingSpeedRpm: 1000,
      centreDistanceMm: 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2 x 500 + pi x 100 = 1000 + 314.159265 = 1314.15927 mm, straight from the
    // general formula rather than from a special case in the code.
    expect(result.beltLengthMm).toBeCloseTo(1314.15927, 5);
    expect(result.wrapSmallDeg).toBeCloseTo(180, 10);
    expect(result.wrapLargeDeg).toBeCloseTo(180, 10);
    expect(result.ratio).toBe(1);
  });

  it("carries the torque through the ratio and the efficiency", () => {
    const result = beltDrive({
      drivingDiameterMm: 100,
      drivenDiameterMm: 250,
      drivingSpeedRpm: 1450,
      centreDistanceMm: 500,
      drivingTorqueNm: 20,
      efficiencyPct: 95,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 20 x 2.5 x 0.95 = 47.5 N*m
    expect(result.drivenTorqueNm).toBeCloseTo(47.5, 10);
  });

  it("stands still at zero speed instead of refusing — a stopped drive is defined", () => {
    const result = beltDrive({
      drivingDiameterMm: 100,
      drivenDiameterMm: 250,
      drivingSpeedRpm: 0,
      centreDistanceMm: 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drivenSpeedRpm).toBe(0);
    expect(result.beltSpeedMs).toBe(0);
    expect(result.beltLengthMm).toBeCloseTo(1561.04995, 5);
  });

  it("refuses a centre distance that puts one pulley inside the other, and each bad dimension", () => {
    // 2C = 140 is less than D - d = 150: there are no tangents to draw.
    expect(
      beltDrive({
        drivingDiameterMm: 100,
        drivenDiameterMm: 250,
        drivingSpeedRpm: 1450,
        centreDistanceMm: 70,
      }),
    ).toEqual({ ok: false, reason: "centreDistance" });
    const base = {
      drivingDiameterMm: 100,
      drivenDiameterMm: 250,
      drivingSpeedRpm: 1450,
      centreDistanceMm: 500,
    } as const;
    expect(beltDrive({ ...base, drivingDiameterMm: 0 })).toEqual({
      ok: false,
      reason: "drivingDiameter",
    });
    expect(beltDrive({ ...base, drivenDiameterMm: 10001 })).toEqual({
      ok: false,
      reason: "drivenDiameter",
    });
    expect(beltDrive({ ...base, drivingSpeedRpm: -1 })).toEqual({ ok: false, reason: "speed" });
    expect(beltDrive({ ...base, centreDistanceMm: 0 })).toEqual({
      ok: false,
      reason: "centreDistance",
    });
    expect(beltDrive({ ...base, efficiencyPct: 101 })).toEqual({ ok: false, reason: "efficiency" });
    expect(beltDrive({ ...base, drivingTorqueNm: -5 })).toEqual({ ok: false, reason: "torque" });
  });
});

describe("gearPair", () => {
  it("takes a 20/60 pair of module 2 through ratio, speeds, diameters and centres", () => {
    const result = gearPair({
      drivingTeeth: 20,
      drivenTeeth: 60,
      drivingSpeedRpm: 1500,
      moduleMm: 2,
      drivingTorqueNm: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBe(3); // 60/20
    expect(result.drivenSpeedRpm).toBe(500); // 1500/3
    expect(result.drivingPitchDiameterMm).toBe(40); // 2 x 20
    expect(result.drivenPitchDiameterMm).toBe(120); // 2 x 60
    expect(result.centreDistanceMm).toBe(80); // 2 x (20 + 60)/2
    expect(result.drivenTorqueNm).toBe(30); // 10 x 3 x 1.00
  });

  it("omits the geometry rather than inventing a module", () => {
    const result = gearPair({ drivingTeeth: 20, drivenTeeth: 60, drivingSpeedRpm: 1500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBe(3);
    expect(result.drivingPitchDiameterMm).toBeUndefined();
    expect(result.centreDistanceMm).toBeUndefined();
  });

  it("refuses a fractional or zero tooth count and each other bad input", () => {
    const base = { drivingTeeth: 20, drivenTeeth: 60, drivingSpeedRpm: 1500 } as const;
    expect(gearPair({ ...base, drivingTeeth: 0 })).toEqual({ ok: false, reason: "drivingTeeth" });
    expect(gearPair({ ...base, drivenTeeth: 20.5 })).toEqual({ ok: false, reason: "drivenTeeth" });
    expect(gearPair({ ...base, drivingSpeedRpm: -1 })).toEqual({ ok: false, reason: "speed" });
    expect(gearPair({ ...base, moduleMm: 0 })).toEqual({ ok: false, reason: "module" });
    expect(gearPair({ ...base, efficiencyPct: 0 })).toEqual({ ok: false, reason: "efficiency" });
    expect(gearPair({ ...base, drivingTorqueNm: -1 })).toEqual({ ok: false, reason: "torque" });
  });
});

describe("cableCrossSection", () => {
  it("sizes a single-phase copper run to the user's own 3 % limit", () => {
    const result = cableCrossSection({
      system: "single",
      material: "copper",
      lengthM: 25,
      currentA: 16,
      voltageV: 230,
      permittedDropPct: 3,
      chosenAreaMm2: 2.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The loop factor is the return-path 2 for a single-phase run, not sqrt(3).
    expect(result.loopFactor).toBe(2);
    expect(result.maxDropV).toBeCloseTo(6.9, 10); // 230 x 0.03
    // 2 x (1/58) x 25 x 16 = 13.7931034 V*mm2; /6.9 = 1.99900050 mm2
    expect(result.minimumAreaMm2).toBeCloseTo(1.9990005, 7);
    // At 2.5 mm2: 13.7931034/2.5 = 5.51724138 V = 2.39880060 % of 230
    expect(result.dropAtChosenV).toBeCloseTo(5.51724138, 8);
    expect(result.dropAtChosenPct).toBeCloseTo(2.3988006, 7);
    // 2.3988006/3 = 0.7996002 — a ratio of two numbers, and nothing else.
    expect(result.dropRatio).toBeCloseTo(0.7996002, 7);
  });

  it("uses sqrt(3) for a balanced three-phase run instead of the return-path 2", () => {
    const result = cableCrossSection({
      system: "three",
      material: "copper",
      lengthM: 80,
      currentA: 100,
      voltageV: 400,
      permittedDropPct: 1,
      chosenAreaMm2: 70,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Balanced three-phase uses sqrt(3), never the single-phase return-path 2.
    expect(result.loopFactor).toBeCloseTo(Math.sqrt(3), 12);
    expect(result.maxDropV).toBeCloseTo(4, 10);
    // sqrt(3)/58 = 0.029862945; x80 x100 = 238.903560; /4 = 59.7258899 mm2
    expect(result.minimumAreaMm2).toBeCloseTo(59.7258899, 7);
    // 238.903560/70 = 3.41290800 V = 0.853227000 %
    expect(result.dropAtChosenV).toBeCloseTo(3.412908, 6);
    expect(result.dropAtChosenPct).toBeCloseTo(0.853227, 6);
    expect(result.dropRatio).toBeCloseTo(0.853227, 6);
  });

  it("needs more aluminium than copper for the same job, and rounds to no series at all", () => {
    const result = cableCrossSection({
      system: "three",
      material: "aluminium",
      lengthM: 80,
      currentA: 100,
      voltageV: 400,
      permittedDropPct: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // sqrt(3) x 0.028264 = 0.048954684; x80 x100 = 391.637472; /4 = 97.9093680
    expect(result.minimumAreaMm2).toBeCloseTo(97.909368, 6);
    // Emphatically not 95 and not 120: the tool computes an area, not a cable.
    expect(result.minimumAreaMm2).not.toBe(95);
  });

  it("draws no comparison when the user chose no section — an absent section is not a passing one", () => {
    const result = cableCrossSection({
      system: "single",
      material: "copper",
      lengthM: 25,
      currentA: 16,
      voltageV: 230,
      permittedDropPct: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dropAtChosenV).toBeUndefined();
    expect(result.dropAtChosenPct).toBeUndefined();
    expect(result.dropRatio).toBeUndefined();
  });

  it("reports a ratio above one as a plain number, with no styling and no word", () => {
    // 1.5 mm2 is below the 1.999 mm2 the limit implies, and the result says so by
    // arithmetic only: 9.1954/230 = 3.998 %, which over 3 % is 1.3327.
    const result = cableCrossSection({
      system: "single",
      material: "copper",
      lengthM: 25,
      currentA: 16,
      voltageV: 230,
      permittedDropPct: 3,
      chosenAreaMm2: 1.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 13.7931034/1.5 = 9.19540230 V; 100 x 9.1954023/230 = 3.99800100 %
    expect(result.dropAtChosenV).toBeCloseTo(9.1954023, 7);
    expect(result.dropRatio).toBeCloseTo(1.332667, 6); // 3.998001/3
    expect(allKeys(result)).not.toContain("passes");
    expect(allKeys(result)).not.toContain("status");
  });

  it("warms the conductor by the linear law", () => {
    const result = cableCrossSection({
      system: "single",
      material: "copper",
      lengthM: 25,
      currentA: 16,
      voltageV: 230,
      permittedDropPct: 3,
      conductorTempC: 70,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // rho(70) = (1/58) x (1 + 0.00393 x 50) = 0.0172413793 x 1.1965 = 0.0206293103
    expect(result.resistivity).toBeCloseTo(0.02062931, 8);
    // 2 x 0.0206293103 x 25 x 16 / 6.9 = 16.5034483/6.9 = 2.39180410 mm2
    expect(result.minimumAreaMm2).toBeCloseTo(2.3918041, 7);
  });

  it("refuses every input it cannot divide by, each under its own name", () => {
    const base = {
      system: "single",
      material: "copper",
      lengthM: 25,
      currentA: 16,
      voltageV: 230,
      permittedDropPct: 3,
    } as const;
    expect(cableCrossSection({ ...base, lengthM: 0 })).toEqual({ ok: false, reason: "length" });
    expect(cableCrossSection({ ...base, currentA: -16 })).toEqual({ ok: false, reason: "current" });
    expect(cableCrossSection({ ...base, voltageV: 0 })).toEqual({ ok: false, reason: "voltage" });
    // No default is ever supplied for the limit: without it there is no answer.
    expect(cableCrossSection({ ...base, permittedDropPct: 0 })).toEqual({
      ok: false,
      reason: "permittedDrop",
    });
    expect(cableCrossSection({ ...base, conductorTempC: -61 })).toEqual({
      ok: false,
      reason: "temperature",
    });
    expect(cableCrossSection({ ...base, chosenAreaMm2: 0 })).toEqual({
      ok: false,
      reason: "chosenArea",
    });
  });
});

describe("inductionMotorRating", () => {
  it("reads a 7.5 kW four-pole nameplate", () => {
    const result = inductionMotorRating({
      shaftPowerKw: 7.5,
      lineVoltageV: 400,
      powerFactor: 0.86,
      efficiencyPct: 89,
      poles: 4,
      measuredSpeedRpm: 1440,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // sqrt(3) x 400 = 692.820323; x0.86 = 595.825478; x0.89 = 530.284675;
    // 7500/530.284675 = 14.1433467 A
    expect(result.currentA).toBeCloseTo(14.1433467, 7);
    expect(result.inputPowerKw).toBeCloseTo(8.42696629, 8); // 7.5/0.89
    expect(result.synchronousSpeedRpm).toBe(1500); // 120 x 50 / 4
    expect(result.slipPercent).toBeCloseTo(4, 10); // (1500 - 1440)/1500
    // 30000 x 7.5 = 225000; pi x 1440 = 4523.89342; ratio = 49.7359197 N*m
    expect(result.torqueNm).toBeCloseTo(49.7359197, 7);
    expect(result.torqueSpeedRpm).toBe(1440);
  });

  it("drops the phase factor for a single-phase machine", () => {
    const result = inductionMotorRating({
      shaftPowerKw: 0.75,
      lineVoltageV: 230,
      powerFactor: 0.95,
      efficiencyPct: 72,
      poles: 2,
      measuredSpeedRpm: 2820,
      system: "single",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 230 x 0.95 x 0.72 = 157.32; 750/157.32 = 4.76735317 A
    expect(result.currentA).toBeCloseTo(4.76735317, 8);
    expect(result.inputPowerKw).toBeCloseTo(1.04166667, 8); // 0.75/0.72
    expect(result.synchronousSpeedRpm).toBe(3000); // 120 x 50 / 2
    expect(result.slipPercent).toBeCloseTo(6, 10); // (3000 - 2820)/3000
    // 30000 x 0.75 = 22500; pi x 2820 = 8859.29171; 22500/8859.29171 = 2.53970654
    expect(result.torqueNm).toBeCloseTo(2.53970654, 8);
  });

  it("falls back to the synchronous speed for torque and names the speed it used", () => {
    const result = inductionMotorRating({
      shaftPowerKw: 7.5,
      lineVoltageV: 400,
      powerFactor: 0.86,
      efficiencyPct: 89,
      poles: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slipPercent).toBeUndefined();
    expect(result.torqueSpeedRpm).toBe(1500);
    // 225000/(pi x 1500) = 225000/4712.38898 = 47.7464829 N*m
    expect(result.torqueNm).toBeCloseTo(47.7464829, 7);
  });

  it("reports a negative slip above synchronism as a number, not as an error", () => {
    const result = inductionMotorRating({
      shaftPowerKw: 7.5,
      lineVoltageV: 400,
      powerFactor: 0.86,
      efficiencyPct: 89,
      poles: 4,
      measuredSpeedRpm: 1530,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (1500 - 1530)/1500 = -0.02 — the machine is being driven, which is a fact.
    expect(result.slipPercent).toBeCloseTo(-2, 10);
  });

  it("refuses an odd pole count, a zero speed and every nameplate figure it cannot use", () => {
    const base = {
      shaftPowerKw: 7.5,
      lineVoltageV: 400,
      powerFactor: 0.86,
      efficiencyPct: 89,
      poles: 4,
    } as const;
    expect(inductionMotorRating({ ...base, poles: 3 })).toEqual({ ok: false, reason: "poles" });
    expect(inductionMotorRating({ ...base, poles: 0 })).toEqual({ ok: false, reason: "poles" });
    expect(inductionMotorRating({ ...base, shaftPowerKw: 0 })).toEqual({
      ok: false,
      reason: "power",
    });
    expect(inductionMotorRating({ ...base, lineVoltageV: 0 })).toEqual({
      ok: false,
      reason: "voltage",
    });
    expect(inductionMotorRating({ ...base, powerFactor: 1.1 })).toEqual({
      ok: false,
      reason: "powerFactor",
    });
    expect(inductionMotorRating({ ...base, efficiencyPct: 101 })).toEqual({
      ok: false,
      reason: "efficiency",
    });
    expect(inductionMotorRating({ ...base, frequencyHz: 0 })).toEqual({
      ok: false,
      reason: "frequency",
    });
    // Zero measured speed would put the torque beyond any number.
    expect(inductionMotorRating({ ...base, measuredSpeedRpm: 0 })).toEqual({
      ok: false,
      reason: "speed",
    });
  });
});

describe("junctionTemperature", () => {
  it("walks the chain from ambient to junction and back down to the sink", () => {
    const result = junctionTemperature({
      dissipationW: 25,
      ambientC: 40,
      junctionToCase: 0.7,
      caseToSink: 0.5,
      sinkToAmbient: 2.1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalResistance).toBeCloseTo(3.3, 10); // 0.7 + 0.5 + 2.1
    expect(result.junctionC).toBeCloseTo(122.5, 10); // 40 + 25 x 3.3
    expect(result.caseC).toBeCloseTo(105, 10); // 122.5 - 25 x 0.7
    expect(result.sinkC).toBeCloseTo(92.5, 10); // 122.5 - 25 x 1.2
  });

  it("accepts a zero link — an ideal joint is a modelling choice, not an error", () => {
    const result = junctionTemperature({
      dissipationW: 10,
      ambientC: 25,
      junctionToCase: 1,
      caseToSink: 0,
      sinkToAmbient: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.junctionC).toBeCloseTo(55, 10); // 25 + 10 x 3
    expect(result.caseC).toBe(result.sinkC); // nothing between case and sink
  });

  it("refuses each input outside its band", () => {
    const base = {
      dissipationW: 25,
      ambientC: 40,
      junctionToCase: 0.7,
      caseToSink: 0.5,
      sinkToAmbient: 2.1,
    } as const;
    expect(junctionTemperature({ ...base, dissipationW: 0 })).toEqual({
      ok: false,
      reason: "dissipation",
    });
    expect(junctionTemperature({ ...base, ambientC: -61 })).toEqual({
      ok: false,
      reason: "ambient",
    });
    expect(junctionTemperature({ ...base, junctionToCase: -1 })).toEqual({
      ok: false,
      reason: "junctionToCase",
    });
    expect(junctionTemperature({ ...base, caseToSink: 1001 })).toEqual({
      ok: false,
      reason: "caseToSink",
    });
    expect(junctionTemperature({ ...base, sinkToAmbient: Number.NaN })).toEqual({
      ok: false,
      reason: "sinkToAmbient",
    });
  });
});

describe("requiredSinkResistance", () => {
  it("spends the temperature budget on the two data-sheet links first", () => {
    const result = requiredSinkResistance({
      maxJunctionC: 150,
      ambientC: 45,
      dissipationW: 40,
      junctionToCase: 0.5,
      caseToSink: 0.3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.availableRiseK).toBe(105); // 150 - 45
    // 105/40 = 2.625 K/W of budget; 2.625 - 0.5 - 0.3 = 1.825 K/W left for the sink
    expect(result.requiredSinkResistance).toBeCloseTo(1.825, 10);
  });

  it("refuses rather than printing a negative thermal resistance", () => {
    // 105/200 = 0.525 K/W of budget, and the two links already eat 0.8 — no
    // heatsink at that mounting can do it, which is an impossibility and not a
    // small number.
    expect(
      requiredSinkResistance({
        maxJunctionC: 150,
        ambientC: 45,
        dissipationW: 200,
        junctionToCase: 0.5,
        caseToSink: 0.3,
      }),
    ).toEqual({ ok: false, reason: "chainAlreadyOverBudget" });
  });

  it("refuses when the ambient is already at or above the junction limit", () => {
    expect(
      requiredSinkResistance({
        maxJunctionC: 125,
        ambientC: 125,
        dissipationW: 10,
        junctionToCase: 0.5,
        caseToSink: 0.3,
      }),
    ).toEqual({ ok: false, reason: "ambientAtOrAboveLimit" });
  });

  it("refuses each input outside its band, including a zero dissipation", () => {
    const base = {
      maxJunctionC: 150,
      ambientC: 45,
      dissipationW: 40,
      junctionToCase: 0.5,
      caseToSink: 0.3,
    } as const;
    expect(requiredSinkResistance({ ...base, maxJunctionC: 401 })).toEqual({
      ok: false,
      reason: "maxJunction",
    });
    expect(requiredSinkResistance({ ...base, ambientC: 201 })).toEqual({
      ok: false,
      reason: "ambient",
    });
    expect(requiredSinkResistance({ ...base, dissipationW: 0 })).toEqual({
      ok: false,
      reason: "dissipation",
    });
    expect(requiredSinkResistance({ ...base, junctionToCase: -0.1 })).toEqual({
      ok: false,
      reason: "junctionToCase",
    });
    expect(requiredSinkResistance({ ...base, caseToSink: 1001 })).toEqual({
      ok: false,
      reason: "caseToSink",
    });
  });
});

describe("permissibleDissipation", () => {
  it("inverts the same chain: 105 K over 2.8 K/W is 37.5 W", () => {
    const result = permissibleDissipation({
      maxJunctionC: 150,
      ambientC: 45,
      junctionToCase: 0.5,
      caseToSink: 0.3,
      sinkToAmbient: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalResistance).toBeCloseTo(2.8, 10); // 0.5 + 0.3 + 2.0
    expect(result.maxDissipationW).toBeCloseTo(37.5, 10); // 105/2.8
  });

  it("refuses an all-zero chain instead of answering with infinity", () => {
    expect(
      permissibleDissipation({
        maxJunctionC: 150,
        ambientC: 45,
        junctionToCase: 0,
        caseToSink: 0,
        sinkToAmbient: 0,
      }),
    ).toEqual({ ok: false, reason: "totalResistance" });
  });

  it("refuses a chain that is positive but too small to divide by, not just an exactly-zero one", () => {
    // Number.MIN_VALUE (about 4.9406564584124654e-324) is the smallest positive
    // double, so `isPositive` alone lets it through as a link. 105 K over that
    // is more than 200 orders of magnitude past the largest finite double
    // (about 1.7976931348623157e308) — an overflow, not an ideal heat path.
    expect(
      permissibleDissipation({
        maxJunctionC: 150,
        ambientC: 45,
        junctionToCase: Number.MIN_VALUE,
        caseToSink: 0,
        sinkToAmbient: 0,
      }),
    ).toEqual({ ok: false, reason: "totalResistance" });
  });

  it("refuses an ambient at the limit and every out-of-band link", () => {
    const base = {
      maxJunctionC: 150,
      ambientC: 45,
      junctionToCase: 0.5,
      caseToSink: 0.3,
      sinkToAmbient: 2,
    } as const;
    expect(permissibleDissipation({ ...base, ambientC: 160 })).toEqual({
      ok: false,
      reason: "ambientAtOrAboveLimit",
    });
    expect(permissibleDissipation({ ...base, maxJunctionC: -1 })).toEqual({
      ok: false,
      reason: "maxJunction",
    });
    expect(permissibleDissipation({ ...base, ambientC: -61 })).toEqual({
      ok: false,
      reason: "ambient",
    });
    expect(permissibleDissipation({ ...base, junctionToCase: -1 })).toEqual({
      ok: false,
      reason: "junctionToCase",
    });
    expect(permissibleDissipation({ ...base, caseToSink: -1 })).toEqual({
      ok: false,
      reason: "caseToSink",
    });
    expect(permissibleDissipation({ ...base, sinkToAmbient: 1001 })).toEqual({
      ok: false,
      reason: "sinkToAmbient",
    });
  });
});

describe("metricThread", () => {
  it("matches the ISO 898-1 table for M10 x 1.5 and takes the force from the user's strength", () => {
    const result = metricThread({
      nominalDiameterMm: 10,
      pitchMm: 1.5,
      strengthMpa: 640,
      tappingDrillMm: 8.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // H = 1.5 x 0.8660254038 = 1.29903811
    expect(result.fundamentalHeightMm).toBeCloseTo(1.29903811, 8);
    // d2 = 10 - 0.649519053 x 1.5 = 9.02572142
    expect(result.pitchDiameterMm).toBeCloseTo(9.02572142, 8);
    // d3 = 10 - 1.226869322 x 1.5 = 8.15969602
    expect(result.minorDiameterBoltMm).toBeCloseTo(8.15969602, 8);
    // D1 = 10 - 1.082531755 x 1.5 = 8.37620237
    expect(result.minorDiameterNutMm).toBeCloseTo(8.37620237, 8);
    // mean = 8.59270872; squared = 73.8346432; x pi/4 = 57.9895931 mm2,
    // which the ISO 898-1 table gives as 58.0 — the check that this is the
    // standard's stress area and not merely a self-consistent one.
    expect(result.stressAreaMm2).toBeCloseTo(57.9895931, 7);
    expect(result.forceKn).toBeCloseTo(37.1133396, 7); // 57.9895931 x 640 / 1000
    // 100 x (10 - 8.5)/1.623797632 = 92.3760431 %
    const engagement = result.engagement;
    if (engagement === undefined) throw new Error("expected engagement");
    expect(engagement.isoPct).toBeCloseTo(92.3760431, 7);
    // The workshop convention divides by 1.5xROOT3_OVER_2 instead of
    // 1.25xROOT3_OVER_2, so it is exactly 5/6 of the H1 figure for any drill:
    // 92.3760431 x 5/6 = 76.9800359 %, matching the review's worked "76,98 %".
    expect(engagement.workshopPct).toBeCloseTo(76.9800359, 6);
    expect(engagement.workshopPct).toBeCloseTo((engagement.isoPct * 5) / 6, 9);
  });

  it("matches the table for M16 x 2 and omits the force until a strength is entered", () => {
    const result = metricThread({ nominalDiameterMm: 16, pitchMm: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fundamentalHeightMm).toBeCloseTo(1.73205081, 8); // 2 x 0.866025404
    expect(result.pitchDiameterMm).toBeCloseTo(14.7009619, 7); // 16 - 1.299038106
    expect(result.minorDiameterBoltMm).toBeCloseTo(13.5462614, 7); // 16 - 2.453738644
    expect(result.minorDiameterNutMm).toBeCloseTo(13.8349365, 7); // 16 - 2.165063509
    // mean = 14.1236116; squared = 199.476405; x pi/4 = 156.668402 (table: 157)
    expect(result.stressAreaMm2).toBeCloseTo(156.668402, 6);
    // No strength was entered, so there is no force row at all — an absent
    // property class is not a default one.
    expect(result.forceKn).toBeUndefined();
    // Both conventions or neither: one drill measured two ways is one field.
    expect(result.engagement).toBeUndefined();
  });

  it("refuses a pitch that would leave the bolt no core, and a drill outside (D1, d)", () => {
    // d/1.226869322 for M10 is 8.15 mm of pitch; at that pitch d3 is zero.
    expect(metricThread({ nominalDiameterMm: 10, pitchMm: 8.2 })).toEqual({
      ok: false,
      reason: "pitch",
    });
    expect(metricThread({ nominalDiameterMm: 10, pitchMm: 0 })).toEqual({
      ok: false,
      reason: "pitch",
    });
    expect(metricThread({ nominalDiameterMm: 0, pitchMm: 1.5 })).toEqual({
      ok: false,
      reason: "diameter",
    });
    // D1 = 8.3762 mm, so 8.3 is below the thread root and 10.5 is past the crest.
    expect(
      metricThread({ nominalDiameterMm: 10, pitchMm: 1.5, tappingDrillMm: 8.3 }),
    ).toEqual({ ok: false, reason: "drill" });
    expect(
      metricThread({ nominalDiameterMm: 10, pitchMm: 1.5, tappingDrillMm: 10.5 }),
    ).toEqual({ ok: false, reason: "drill" });
    expect(metricThread({ nominalDiameterMm: 10, pitchMm: 1.5, strengthMpa: 0 })).toEqual({
      ok: false,
      reason: "strength",
    });
  });

  it("accepts a drill exactly at D1 — the full-form 100 % engagement hole, not a boundary to refuse", () => {
    // D1 = 10 - 1.082531754730548 x 1.5 = 8.376202367904177 mm exactly. It is
    // the canonical full-form internal thread and belongs to the accepted band;
    // only the upper end (drill = d, no thread left) stays strictly excluded.
    const result = metricThread({
      nominalDiameterMm: 10,
      pitchMm: 1.5,
      tappingDrillMm: 10 - 1.082531754730548 * 1.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // At drill = D1 the numerator (d - D1) equals the denominator (H1) exactly,
    // so the engagement is exactly 100 % under the ISO 898-1 convention.
    expect(result.engagement?.isoPct).toBeCloseTo(100, 9);
  });
});

describe("ohmsLaw", () => {
  it("fills in the other two from U and R", () => {
    const result = ohmsLaw({ voltageV: 230, resistanceOhm: 46 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentA).toBeCloseTo(5, 12); // 230/46 exactly
    expect(result.powerW).toBeCloseTo(1150, 10); // 52900/46 exactly
  });

  it("takes the square roots on the R and P branch", () => {
    const result = ohmsLaw({ resistanceOhm: 100, powerW: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.voltageV).toBeCloseTo(50, 12); // sqrt(2500)
    expect(result.currentA).toBeCloseTo(0.5, 12); // sqrt(0.25)
  });

  it("never divides on the I and R branch — it is defined even at all zeros", () => {
    const result = ohmsLaw({ currentA: 16, resistanceOhm: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.voltageV).toBe(8); // 16 x 0.5
    expect(result.powerW).toBe(128); // 256 x 0.5
    const zeros = ohmsLaw({ currentA: 0, resistanceOhm: 0 });
    expect(zeros.ok).toBe(true);
    if (!zeros.ok) return;
    expect(zeros.voltageV).toBe(0);
    expect(zeros.powerW).toBe(0);
  });

  it("refuses each degenerate pair by the name of the input that made it so", () => {
    // An open circuit says nothing about resistance, so the pair has no answer.
    expect(ohmsLaw({ voltageV: 230, currentA: 0 })).toEqual({ ok: false, reason: "current" });
    expect(ohmsLaw({ voltageV: 230, resistanceOhm: 0 })).toEqual({
      ok: false,
      reason: "resistance",
    });
    expect(ohmsLaw({ voltageV: 0, powerW: 100 })).toEqual({ ok: false, reason: "voltage" });
    expect(ohmsLaw({ currentA: 0, powerW: 100 })).toEqual({ ok: false, reason: "current" });
    expect(ohmsLaw({ resistanceOhm: 0, powerW: 100 })).toEqual({ ok: false, reason: "resistance" });
  });

  it("refuses anything but exactly two entries, and any negative magnitude", () => {
    expect(ohmsLaw({ voltageV: 230 })).toEqual({ ok: false, reason: "pair" });
    expect(ohmsLaw({ voltageV: 230, currentA: 5, resistanceOhm: 46 })).toEqual({
      ok: false,
      reason: "pair",
    });
    expect(ohmsLaw({})).toEqual({ ok: false, reason: "pair" });
    expect(ohmsLaw({ voltageV: -230, currentA: 5 })).toEqual({ ok: false, reason: "voltage" });
    expect(ohmsLaw({ voltageV: 230, currentA: -5 })).toEqual({ ok: false, reason: "current" });
    expect(ohmsLaw({ resistanceOhm: -1, powerW: 5 })).toEqual({ ok: false, reason: "resistance" });
    expect(ohmsLaw({ voltageV: 230, powerW: -5 })).toEqual({ ok: false, reason: "power" });
  });

  it("refuses zero power with a voltage present — the same open circuit as (U, I = 0)", () => {
    // P = 0 with V != 0 forces I = P/V = 0 too, which is the open circuit
    // `ohmsLaw({ voltageV: 230, currentA: 0 })` already refuses above; without
    // this check R = V^2/P computed 230*230/0 = 52900/0, printed as Infinity.
    expect(ohmsLaw({ voltageV: 230, powerW: 0 })).toEqual({ ok: false, reason: "power" });
  });

  it("refuses rather than overflowing a valid pair at the extremes of its own band", () => {
    // 1e9 V (the top of the voltage band) over 1e-300 A (inside [0, 1e6]) is
    // 1e309 ohm by exponent arithmetic alone (9 - (-300) = 309), past the
    // largest finite double, about 1.7976931348623157e308.
    expect(ohmsLaw({ voltageV: 1e9, currentA: 1e-300 })).toEqual({ ok: false, reason: "current" });
    // The symmetric case on the (U, R) branch: 1e9 V over 1e-300 ohm is again
    // 1e309 A by the same exponent arithmetic.
    expect(ohmsLaw({ voltageV: 1e9, resistanceOhm: 1e-300 })).toEqual({
      ok: false,
      reason: "resistance",
    });
    // R = 1e-300 ohm (inside [0, 1e12]) with P = 1e9 W (the top of its band)
    // gives P/R = 1e309, which no square root turns back into a finite current.
    expect(ohmsLaw({ resistanceOhm: 1e-300, powerW: 1e9 })).toEqual({
      ok: false,
      reason: "resistance",
    });
  });

  it("refuses rather than dividing by a divisor that underflows to zero after squaring", () => {
    // I = 1e-200 A is a validated positive double, but I^2 = 1e-400 is smaller
    // than the smallest positive double (about 4.9e-324) and rounds to exactly
    // 0 — so R = P/I^2 divides by a zero that `isPositive(currentA)` never saw,
    // because it only ever checked I itself, not I squared.
    expect(ohmsLaw({ currentA: 1e-200, powerW: 100 })).toEqual({ ok: false, reason: "current" });
  });
});

describe("pipeFlow", () => {
  it("turns 3 m3/h through a 50 mm bore into a velocity and a Reynolds number", () => {
    const result = pipeFlow({
      innerDiameterMm: 50,
      flow: { value: 3, unit: "m3/h" },
      kinematicViscosityMm2S: 1.004,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // pi x 0.05^2/4 = 1.96349541e-3 m2
    expect(result.areaM2).toBeCloseTo(0.00196349541, 9);
    expect(result.areaMm2).toBeCloseTo(1963.49541, 5);
    // 3/3600 = 8.33333333e-4 m3/s; /1.96349541e-3 = 0.424413182 m/s
    expect(result.flowM3s).toBeCloseTo(0.000833333333, 12);
    expect(result.velocityMs).toBeCloseTo(0.424413182, 9);
    expect(result.flowLs).toBeCloseTo(0.833333333, 9);
    expect(result.flowLmin).toBeCloseTo(50, 9);
    // 0.424413182 x 0.05 = 0.0212206591; /1.004e-6 = 21136.1146
    expect(result.reynolds).toBeCloseTo(21136.1146, 4);
    expect(result.massFlow).toBeUndefined(); // no density was given
  });

  it("goes the other way, from a velocity to a flow and a mass flow", () => {
    const result = pipeFlow({ innerDiameterMm: 20, velocityMs: 2, densityKgM3: 998 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.areaMm2).toBeCloseTo(314.159265, 6); // pi x 1e-4 m2
    // 3.14159265e-4 x 2 = 6.28318531e-4 m3/s
    expect(result.flowLs).toBeCloseTo(0.628318531, 9);
    expect(result.flowLmin).toBeCloseTo(37.6991118, 7);
    expect(result.flowM3h).toBeCloseTo(2.26194671, 8);
    // 998 x 6.28318531e-4 = 0.627061894 kg/s; x3600 = 2257.42282 kg/h
    expect(result.massFlow?.kgS).toBeCloseTo(0.627061894, 9);
    expect(result.massFlow?.kgH).toBeCloseTo(2257.42282, 5);
    expect(result.reynolds).toBeUndefined(); // no viscosity was given
  });

  it("treats the four flow units as exact and interchangeable", () => {
    const perSecond = pipeFlow({ innerDiameterMm: 50, flow: { value: 0.833333333, unit: "l/s" } });
    const perHour = pipeFlow({ innerDiameterMm: 50, flow: { value: 3, unit: "m3/h" } });
    expect(perSecond.ok && perHour.ok).toBe(true);
    if (!perSecond.ok || !perHour.ok) return;
    expect(perSecond.velocityMs).toBeCloseTo(perHour.velocityMs, 9);
  });

  it("gives zeros for a stopped flow, which is defined", () => {
    const result = pipeFlow({ innerDiameterMm: 50, velocityMs: 0, densityKgM3: 998 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flowM3s).toBe(0);
    expect(result.massFlow?.kgS).toBe(0);
  });

  it("refuses a zero viscosity rather than returning an infinite Reynolds number", () => {
    expect(
      pipeFlow({ innerDiameterMm: 50, velocityMs: 1, kinematicViscosityMm2S: 0 }),
    ).toEqual({ ok: false, reason: "viscosity" });
  });

  it("refuses both-or-neither of the known quantities, and each bad property", () => {
    expect(pipeFlow({ innerDiameterMm: 50 })).toEqual({ ok: false, reason: "known" });
    expect(
      pipeFlow({ innerDiameterMm: 50, velocityMs: 1, flow: { value: 1, unit: "l/s" } }),
    ).toEqual({ ok: false, reason: "known" });
    expect(pipeFlow({ innerDiameterMm: 0, velocityMs: 1 })).toEqual({
      ok: false,
      reason: "diameter",
    });
    expect(pipeFlow({ innerDiameterMm: 50, velocityMs: -1 })).toEqual({
      ok: false,
      reason: "velocity",
    });
    expect(pipeFlow({ innerDiameterMm: 50, flow: { value: -1, unit: "l/s" } })).toEqual({
      ok: false,
      reason: "flow",
    });
    expect(pipeFlow({ innerDiameterMm: 50, velocityMs: 1, densityKgM3: 0 })).toEqual({
      ok: false,
      reason: "density",
    });
  });
});

describe("powerFactorCorrection", () => {
  it("moves 50 kW from 0.75 to 0.95 with a delta bank on 400 V", () => {
    const result = powerFactorCorrection({
      activePowerKw: 50,
      presentPowerFactor: 0.75,
      targetPowerFactor: 0.95,
      lineVoltageV: 400,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // tan p1 = sqrt(0.4375)/0.75 = 0.881917104; tan p2 = sqrt(0.0975)/0.95 = 0.328684105
    expect(result.reactiveBeforeKvar).toBeCloseTo(44.0958552, 7); // 50 x 0.881917104
    expect(result.reactiveAfterKvar).toBeCloseTo(16.4342053, 7); // 50 x 0.328684105
    expect(result.correctionKvar).toBeCloseTo(27.6616499, 7); // 50 x 0.553232999
    // omega = 314.159265; 3 x omega x 160000 = 150796447;
    // 27661.6499/150796447 = 1.83437013e-4 F
    expect(result.capacitancePerPhaseUf).toBeCloseTo(183.437013, 6);
    // 50000/(sqrt(3) x 400 x 0.75) = 50000/519.615242 = 96.2250449 A
    expect(result.currentBeforeA).toBeCloseTo(96.2250449, 7);
    expect(result.currentAfterA).toBeCloseTo(75.9671407, 7); // 50000/658.179307
  });

  it("needs three times the capacitance in star, because each unit sees U/sqrt(3)", () => {
    const delta = powerFactorCorrection({
      activePowerKw: 50,
      presentPowerFactor: 0.75,
      targetPowerFactor: 0.95,
      lineVoltageV: 400,
      connection: "delta",
    });
    const star = powerFactorCorrection({
      activePowerKw: 50,
      presentPowerFactor: 0.75,
      targetPowerFactor: 0.95,
      lineVoltageV: 400,
      connection: "star",
    });
    expect(delta.ok && star.ok).toBe(true);
    if (!delta.ok || !star.ok) return;
    expect(star.capacitancePerPhaseUf).toBeCloseTo(3 * delta.capacitancePerPhaseUf, 6);
    expect(star.capacitancePerPhaseUf).toBeCloseTo(550.311040, 5); // 3 x 183.437013
  });

  it("handles the single-phase case, where cos p2 = 1 makes tan p2 exactly zero", () => {
    const result = powerFactorCorrection({
      activePowerKw: 10,
      presentPowerFactor: 0.8,
      targetPowerFactor: 1,
      lineVoltageV: 230,
      system: "single",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reactiveAfterKvar).toBe(0);
    expect(result.correctionKvar).toBeCloseTo(7.5, 10); // 10 x (0.6/0.8)
    // omega x 52900 = 16619025.1; 7500/16619025.1 = 4.51290009e-4 F
    expect(result.capacitancePerPhaseUf).toBeCloseTo(451.290009, 6);
    expect(result.currentBeforeA).toBeCloseTo(54.3478261, 7); // 10000/184
    expect(result.currentAfterA).toBeCloseTo(43.4782609, 7); // 10000/230
  });

  it("refuses a target worse than the present factor — that is not compensation", () => {
    // Binding review correction: a negative Qc used to be printed as a plain
    // signed number; it is now refused outright, because a target the load
    // already exceeds is an input mistake, not a smaller capacitor bank.
    expect(
      powerFactorCorrection({
        activePowerKw: 50,
        presentPowerFactor: 0.95,
        targetPowerFactor: 0.75,
        lineVoltageV: 400,
      }),
    ).toEqual({ ok: false, reason: "targetPowerFactor" });
    // Equal factors are the boundary and are allowed: Qc is exactly zero.
    const equal = powerFactorCorrection({
      activePowerKw: 50,
      presentPowerFactor: 0.85,
      targetPowerFactor: 0.85,
      lineVoltageV: 400,
    });
    expect(equal.ok).toBe(true);
    if (!equal.ok) return;
    expect(equal.correctionKvar).toBeCloseTo(0, 9);
  });

  it("refuses a zero power factor, frequency, voltage or power", () => {
    const base = {
      activePowerKw: 50,
      presentPowerFactor: 0.75,
      targetPowerFactor: 0.95,
      lineVoltageV: 400,
    } as const;
    expect(powerFactorCorrection({ ...base, activePowerKw: 0 })).toEqual({
      ok: false,
      reason: "power",
    });
    expect(powerFactorCorrection({ ...base, presentPowerFactor: 0 })).toEqual({
      ok: false,
      reason: "presentPowerFactor",
    });
    expect(powerFactorCorrection({ ...base, targetPowerFactor: 1.5 })).toEqual({
      ok: false,
      reason: "targetPowerFactor",
    });
    expect(powerFactorCorrection({ ...base, lineVoltageV: 0 })).toEqual({
      ok: false,
      reason: "voltage",
    });
    expect(powerFactorCorrection({ ...base, frequencyHz: 0 })).toEqual({
      ok: false,
      reason: "frequency",
    });
  });
});

describe("convertPressure", () => {
  it("converts 6 bar gauge into every unit and into the absolute reading", () => {
    const result = convertPressure({ value: 6, unit: "bar", kind: "gauge" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gaugePa).toBe(600000); // 6 x 1e5
    expect(result.absolutePa).toBe(701325); // 600000 + 101325
    expect(result.absolute.bar).toBeCloseTo(7.01325, 10);
    // 600000/6894.757293168361 = 87.0226426
    expect(result.gauge.psi).toBeCloseTo(87.0226426, 7);
    expect(result.gauge["kgf/cm2"]).toBeCloseTo(6.11829728, 8); // 600000/98066.5
    expect(result.gauge.mmHg).toBeCloseTo(4500.36946, 5); // 600000/133.322387415
    expect(result.gauge.mH2O).toBeCloseTo(61.1829728, 7); // 600000/9806.65
    // mmH2O was ADDED by the review clause, at the same conventional 1000 kg/m3
    // and g_n as mH2O: 600000/9.80665 = 61182.9727786757.
    expect(result.gauge.mmH2O).toBeCloseTo(61182.9727786757, 4);
    // inHg is the one unit chained through another factor (25.4 x mmHg), so it
    // is the most exposed to a drift in MMHG_IN_PA: 600000/3386.388640341.
    expect(result.gauge.inHg).toBeCloseTo(177.17989980606055, 6);
    expect(result.gauge.kPa).toBeCloseTo(600, 9); // 600000/1000
    expect(result.gauge.MPa).toBeCloseTo(0.6, 9); // 600000/1e6
    expect(result.gauge.mbar).toBeCloseTo(6000, 6); // 600000/100
  });

  it("keeps the torr and the millimetre of mercury apart, because they are not the same unit", () => {
    const result = convertPressure({ value: 101325, unit: "Pa", kind: "absolute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The standard atmosphere is 760 torr by definition, but not 760 mmHg:
    // 133.322387415 x 760 = 101325.014435, so 101325/133.322387415 is 760 minus
    // 0.014435/133.322387415 = 0.0001083, i.e. 759.9998917.
    expect(result.absolute.torr).toBeCloseTo(760, 10);
    expect(result.absolute.mmHg).toBeCloseTo(759.9998917, 6);
    expect(result.absolute.atm).toBeCloseTo(1, 12);
  });

  it("subtracts the local atmosphere when the entry was absolute, and takes a measured one", () => {
    const standard = convertPressure({ value: 7.01325, unit: "bar", kind: "absolute" });
    expect(standard.ok).toBe(true);
    if (!standard.ok) return;
    expect(standard.gaugePa).toBeCloseTo(600000, 6); // 701325 - 101325
    // At 900 hPa on a mountain the same absolute pressure is a higher gauge one.
    const mountain = convertPressure({
      value: 7.01325,
      unit: "bar",
      kind: "absolute",
      atmosphericPa: 90000,
    });
    expect(mountain.ok).toBe(true);
    if (!mountain.ok) return;
    expect(mountain.gaugePa).toBeCloseTo(611325, 6); // 701325 - 90000
  });

  it("carries a vacuum as a negative gauge pressure, down to but not past absolute zero", () => {
    const result = convertPressure({ value: -0.5, unit: "bar", kind: "gauge" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.absolutePa).toBe(51325); // -50000 + 101325
    expect(result.gauge.psi).toBeCloseTo(-7.25188689, 8);
    // Below -101325 Pa gauge the absolute pressure would be negative, which no
    // fluid does.
    expect(convertPressure({ value: -1.5, unit: "bar", kind: "gauge" })).toEqual({
      ok: false,
      reason: "value",
    });
  });

  it("refuses a non-finite value and an impossible atmosphere", () => {
    expect(convertPressure({ value: Number.NaN, unit: "bar", kind: "gauge" })).toEqual({
      ok: false,
      reason: "value",
    });
    expect(
      convertPressure({ value: 1, unit: "bar", kind: "gauge", atmosphericPa: 0 }),
    ).toEqual({ ok: false, reason: "atmospheric" });
  });
});

describe("pistonForce", () => {
  it("computes both directions of a 63/36 cylinder at 160 bar", () => {
    const result = pistonForce({ gaugePressurePa: 1.6e7, boreMm: 63, rodMm: 36 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // pi x 3969/4 = pi x 992.25 = 3117.24531 mm2
    expect(result.boreAreaMm2).toBeCloseTo(3117.24531, 5);
    // 1.6e7 x 3.11724531e-3 m2 = 49875.9250 N
    expect(result.extendForceN).toBeCloseTo(49875.925, 3);
    // pi x (3969 - 1296)/4 = pi x 668.25 = 2099.36929 mm2
    expect(result.annulusAreaMm2).toBeCloseTo(2099.36929, 5);
    expect(result.retractForceN).toBeCloseTo(33589.9087, 4);
    // The annulus is the bore less the rod: 3117.24531 - pi x 324 = 2099.36929.
    expect(result.boreAreaMm2 - result.annulusAreaMm2).toBeCloseTo(1017.87602, 5);
  });

  it("treats a plunger with no rod as an equal area in both directions", () => {
    const result = pistonForce({ gaugePressurePa: 1.6e7, boreMm: 63 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.annulusAreaMm2).toBe(result.boreAreaMm2);
    expect(result.retractForceN).toBe(result.extendForceN);
  });

  it("refuses a rod at least as large as the bore, and each bad dimension", () => {
    expect(pistonForce({ gaugePressurePa: 1e6, boreMm: 63, rodMm: 63 })).toEqual({
      ok: false,
      reason: "rod",
    });
    expect(pistonForce({ gaugePressurePa: 1e6, boreMm: 63, rodMm: -1 })).toEqual({
      ok: false,
      reason: "rod",
    });
    expect(pistonForce({ gaugePressurePa: 1e6, boreMm: 0 })).toEqual({ ok: false, reason: "bore" });
    expect(pistonForce({ gaugePressurePa: Number.NaN, boreMm: 63 })).toEqual({
      ok: false,
      reason: "pressure",
    });
  });

  it("refuses a gauge pressure below minus the local atmosphere, the same invariant convertPressure enforces", () => {
    // -5e5 Pa gauge is below -101325 Pa (the default standard atmosphere), so the
    // implied absolute pressure would be negative — impossible for any fluid.
    expect(pistonForce({ gaugePressurePa: -5e5, boreMm: 63 })).toEqual({
      ok: false,
      reason: "pressure",
    });
    // A shallower vacuum, above -101325 Pa, is a real and defined state.
    const partial = pistonForce({ gaugePressurePa: -50000, boreMm: 63 });
    expect(partial.ok).toBe(true);
    // On a mountain the local atmosphere is lower, so the same -5e5 Pa gauge is
    // now further below it and the value used to refuse is the CALLER's own.
    expect(
      pistonForce({ gaugePressurePa: -5e5, boreMm: 63, atmosphericPa: 90000 }),
    ).toEqual({ ok: false, reason: "pressure" });
  });
});

describe("resistorFromBands", () => {
  it("reads a four-ring 1 k with a gold tolerance ring", () => {
    const result = resistorFromBands({ bands: ["brown", "black", "red", "gold"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // digits 1 and 0 give 10; red as a multiplier is x100; 10 x 100 = 1000 ohm
    expect(result.ohms).toBeCloseTo(1000, 9);
    expect(result.tolerancePct).toBe(5);
    expect(result.minOhms).toBeCloseTo(950, 9); // 1000 x 0.95
    expect(result.maxOhms).toBeCloseTo(1050, 9); // 1000 x 1.05
    // 1000 is 10 x 10^2, a member of E24, so the deviation is exactly zero.
    expect(result.preferredValueOhms).toBeCloseTo(1000, 9);
    expect(result.preferredDeviationPct).toBeCloseTo(0, 12);
  });

  it("reads a five-ring 4.7 k, where the third ring is a digit and not the multiplier", () => {
    const result = resistorFromBands({
      bands: ["yellow", "violet", "black", "brown", "brown"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // digits 4, 7 and 0 give 470; brown as a multiplier is x10; 470 x 10 = 4700
    expect(result.ohms).toBeCloseTo(4700, 9);
    expect(result.tolerancePct).toBe(1);
    expect(result.minOhms).toBeCloseTo(4653, 9); // 4700 x 0.99
    expect(result.maxOhms).toBeCloseTo(4747, 9); // 4700 x 1.01
    expect(result.preferredDeviationPct).toBeCloseTo(0, 12); // 47 is in E24
  });

  it("takes the fractional multipliers and the sixth ring", () => {
    // brown-black-gold is 10 x 0.1 = 1 ohm; the sixth ring is 50 ppm/K.
    const result = resistorFromBands({
      bands: ["brown", "black", "black", "gold", "brown", "red"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ohms).toBeCloseTo(10, 9); // digits 100, x0.1
    expect(result.tolerancePct).toBe(1);
    expect(result.tempCoefficientPpmK).toBe(50);
  });

  it("gives a three-ring part the +/-20 % convention it carries no ring for", () => {
    const result = resistorFromBands({ bands: ["orange", "orange", "brown"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ohms).toBeCloseTo(330, 9); // 33 x 10
    expect(result.tolerancePct).toBe(20);
    expect(result.minOhms).toBeCloseTo(264, 9); // 330 x 0.8
    expect(result.maxOhms).toBeCloseTo(396, 9); // 330 x 1.2
    expect(result.tempCoefficientPpmK).toBeUndefined();
  });

  it("follows the chosen E series when the value is not in it", () => {
    // 5.6 k is in E24 and in E12, but E6 has only 4.7 k and 6.8 k around it;
    // ln(5600/4700) = 0.17513 and ln(5600/6800) = -0.19416, so E6 says 4.7 k.
    const e24 = resistorFromBands({
      bands: ["green", "blue", "red", "gold"],
      series: "E24",
    });
    const e6 = resistorFromBands({ bands: ["green", "blue", "red", "gold"], series: "E6" });
    expect(e24.ok && e6.ok).toBe(true);
    if (!e24.ok || !e6.ok) return;
    expect(e24.ohms).toBeCloseTo(5600, 9);
    expect(e24.preferredDeviationPct).toBeCloseTo(0, 12);
    expect(e6.preferredValueOhms).toBeCloseTo(4700, 9);
    // 100 x (4700 - 5600)/5600 = -16.0714 %
    expect(e6.preferredDeviationPct).toBeCloseTo(-16.0714286, 7);
  });

  it("refuses a colour that means nothing in the position it occupies", () => {
    // Gold is a multiplier and a tolerance; it is never a digit.
    expect(resistorFromBands({ bands: ["gold", "black", "red", "gold"] })).toEqual({
      ok: false,
      reason: "digitBand",
    });
    // Yellow is a digit and a multiplier, but not a tolerance.
    expect(resistorFromBands({ bands: ["brown", "black", "red", "yellow"] })).toEqual({
      ok: false,
      reason: "toleranceBand",
    });
    // Black is a digit and a multiplier, but not a temperature coefficient.
    expect(
      resistorFromBands({ bands: ["brown", "black", "black", "gold", "brown", "black"] }),
    ).toEqual({ ok: false, reason: "tempCoefficientBand" });
    expect(resistorFromBands({ bands: ["brown", "black"] })).toEqual({
      ok: false,
      reason: "bandCount",
    });
    // All-black digits give zero ohms, which is a short and not a resistor.
    expect(resistorFromBands({ bands: ["black", "black", "black", "gold"] })).toEqual({
      ok: false,
      reason: "value",
    });
  });
});

describe("resistorBandsForValue", () => {
  it("paints 12 k on four rings", () => {
    const result = resistorBandsForValue({ ohms: 12000, tolerancePct: 5, bandCount: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 12000 = 12 x 10^3: e = 4, two digits, mantissa 12, multiplier exponent 3.
    expect(result.bands).toEqual(["brown", "red", "orange", "gold"]);
  });

  it("paints 3.3 k on four rings and reads back to the same value", () => {
    const result = resistorBandsForValue({ ohms: 3300, tolerancePct: 5, bandCount: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3300 = 33 x 10^2: digits 3 and 3, multiplier red.
    expect(result.bands).toEqual(["orange", "orange", "red", "gold"]);
    const back = resistorFromBands({ bands: result.bands });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ohms).toBeCloseTo(3300, 9);
    expect(back.tolerancePct).toBe(5);
  });

  it("uses three digits on a five-ring part", () => {
    const result = resistorBandsForValue({ ohms: 4700, tolerancePct: 1, bandCount: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 4700 = 470 x 10^1: digits 4, 7, 0 and a brown multiplier.
    expect(result.bands).toEqual(["yellow", "violet", "black", "brown", "brown"]);
  });

  it("refuses a value it cannot write at that many digits, rather than rounding it silently", () => {
    // 4530 would have to become 4500 on two digits, and a silent round here is a
    // part that reads back as a different resistor.
    expect(resistorBandsForValue({ ohms: 4530, tolerancePct: 5, bandCount: 4 })).toEqual({
      ok: false,
      reason: "precision",
    });
    // Three digits can carry it: 453 x 10^1.
    const five = resistorBandsForValue({ ohms: 4530, tolerancePct: 1, bandCount: 5 });
    expect(five.ok).toBe(true);
    if (!five.ok) return;
    expect(five.bands).toEqual(["yellow", "green", "orange", "brown", "brown"]);
  });

  it("refuses a multiplier that has no ring, and each missing companion value", () => {
    // 0.05 ohm on two digits needs x10^-3, and the lowest painted multiplier is
    // silver at x10^-2.
    expect(resistorBandsForValue({ ohms: 0.05, tolerancePct: 5, bandCount: 4 })).toEqual({
      ok: false,
      reason: "multiplier",
    });
    expect(resistorBandsForValue({ ohms: 1000, bandCount: 4 })).toEqual({
      ok: false,
      reason: "tolerance",
    });
    expect(resistorBandsForValue({ ohms: 1000, tolerancePct: 3, bandCount: 4 })).toEqual({
      ok: false,
      reason: "tolerance",
    });
    expect(
      resistorBandsForValue({ ohms: 1000, tolerancePct: 1, bandCount: 6 }),
    ).toEqual({ ok: false, reason: "tempCoefficient" });
    expect(resistorBandsForValue({ ohms: 0, tolerancePct: 5, bandCount: 4 })).toEqual({
      ok: false,
      reason: "value",
    });
    expect(resistorBandsForValue({ ohms: 1000, tolerancePct: 5, bandCount: 7 })).toEqual({
      ok: false,
      reason: "bandCount",
    });
  });
});

describe("nearestPreferredValue", () => {
  it("measures nearness on the ratio, not on the difference", () => {
    // 10.49 sits just above the geometric mean of 10 and 11, sqrt(110) =
    // 10.4880885, so the ratio metric picks 11 — while the absolute difference
    // (0.49 against 0.51) would have picked 10.
    const result = nearestPreferredValue(10.49, "E24");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeCloseTo(11, 9);
    // 100 x (11 - 10.49)/10.49 = 4.86177312 %
    expect(result.deviationPct).toBeCloseTo(4.86177312, 8);
  });

  it("crosses decades cleanly", () => {
    // 95 k lies between 91 k (E24) and 100 k, and ln(95/91) = 0.04301 against
    // ln(95/100) = -0.05129, so 91 k wins.
    const result = nearestPreferredValue(95000, "E24");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeCloseTo(91000, 6);
    // 100 x (91000 - 95000)/95000 = -4.21052632 %
    expect(result.deviationPct).toBeCloseTo(-4.21052632, 8);
  });

  it("refuses a non-positive value", () => {
    expect(nearestPreferredValue(0, "E12")).toEqual({ ok: false, reason: "value" });
    expect(nearestPreferredValue(-1, "E12")).toEqual({ ok: false, reason: "value" });
  });
});

describe("rlcResponse", () => {
  it("takes a series RLC at 1 kHz through reactances, impedance, phase and resonance", () => {
    const result = rlcResponse({
      frequencyHz: 1000,
      resistanceOhm: 100,
      inductanceH: 0.01,
      capacitanceF: 1e-6,
      connection: "series",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // omega = 6283.18531; x0.01 = 62.8318531 ohm
    expect(result.reactanceInductiveOhm).toBeCloseTo(62.8318531, 7);
    // 1/(6283.18531 x 1e-6) = 159.154943 ohm
    expect(result.reactanceCapacitiveOhm).toBeCloseTo(159.154943, 6);
    expect(result.netReactanceOhm).toBeCloseTo(-96.3230900, 7);
    // sqrt(10000 + 9278.13766) = sqrt(19278.1377) = 138.845733
    expect(result.impedanceOhm).toBeCloseTo(138.845733, 6);
    // atan(-0.96323090) = -43.9270401 degrees — capacitive, by its sign alone
    expect(result.phaseDeg).toBeCloseTo(-43.9270401, 7);
    // sqrt(0.01 x 1e-6) = 1e-4; 1/(2 pi x 1e-4) = 1591.54943 Hz
    expect(result.resonanceHz).toBeCloseTo(1591.54943, 5);
    // (1/100) x sqrt(0.01/1e-6) = 0.01 x 100 = 1
    expect(result.qualityFactor).toBeCloseTo(1, 10);
    expect(result.bandwidthHz).toBeCloseTo(1591.54943, 5); // f0/Q
  });

  it("mirrors the phase in the parallel connection", () => {
    const result = rlcResponse({
      frequencyHz: 1000,
      resistanceOhm: 100,
      inductanceH: 0.01,
      capacitanceF: 1e-6,
      connection: "parallel",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conductanceS).toBeCloseTo(0.01, 12);
    // omega C = 6.28318531e-3; 1/(omega L) = 0.0159154943; B = -9.63230900e-3
    expect(result.susceptanceS).toBeCloseTo(-0.009632309, 10);
    // |Y| = sqrt(1e-4 + 9.27813766e-5) = 0.0138845733; |Z| = 72.0223788
    expect(result.impedanceOhm).toBeCloseTo(72.0223788, 7);
    // The impedance angle is the negative of the admittance angle: +43.9270401.
    expect(result.phaseDeg).toBeCloseTo(43.9270401, 7);
    // Q in parallel is R x sqrt(C/L) = 100 x sqrt(1e-6/0.01) = 100 x 0.01 = 1
    expect(result.qualityFactor).toBeCloseTo(1, 10);
    // BW = f0/Q = 1591.54943/1 = 1591.54943 Hz — asserted here too, since Q = 1
    // in this particular vector cannot by itself catch a wrong bandwidth formula.
    expect(result.bandwidthHz).toBeCloseTo(1591.54943, 5);
  });

  it("gives the RC corner and time constant when only R and C are present", () => {
    const result = rlcResponse({
      frequencyHz: 1000,
      resistanceOhm: 10000,
      capacitanceF: 1e-7,
      connection: "series",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1/(2 pi x 10000 x 1e-7) = 1/6.28318531e-3 = 159.154943 Hz
    expect(result.rc?.cornerHz).toBeCloseTo(159.154943, 6);
    expect(result.rc?.timeConstantS).toBeCloseTo(0.001, 12); // 10000 x 1e-7
    // No inductor: the inductive reactance, the resonance and the RL corner are
    // absent rather than zero.
    expect(result.reactanceInductiveOhm).toBeUndefined();
    expect(result.resonanceHz).toBeUndefined();
    expect(result.rl).toBeUndefined();
  });

  it("gives the RL corner when only R and L are present", () => {
    const result = rlcResponse({
      frequencyHz: 1000,
      resistanceOhm: 100,
      inductanceH: 0.01,
      connection: "series",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100/(2 pi x 0.01) = 100/0.0628318531 = 1591.54943 Hz; tau = 1e-4 s
    expect(result.rl?.cornerHz).toBeCloseTo(1591.54943, 5);
    expect(result.rl?.timeConstantS).toBeCloseTo(0.0001, 12);
    expect(result.reactanceCapacitiveOhm).toBeUndefined();
  });

  it("returns exactly +90 degrees for a lossless series inductor", () => {
    const result = rlcResponse({
      frequencyHz: 1000,
      resistanceOhm: 0,
      inductanceH: 0.01,
      connection: "series",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.impedanceOhm).toBeCloseTo(62.8318531, 7);
    expect(result.phaseDeg).toBe(90); // atan2(X, 0) is exact, not 89.9999
  });

  it("treats a resistor alone as purely resistive in either connection", () => {
    const series = rlcResponse({ frequencyHz: 50, resistanceOhm: 230, connection: "series" });
    const parallel = rlcResponse({ frequencyHz: 50, resistanceOhm: 230, connection: "parallel" });
    expect(series.ok && parallel.ok).toBe(true);
    if (!series.ok || !parallel.ok) return;
    expect(series.impedanceOhm).toBe(230);
    expect(series.phaseDeg).toBe(0);
    expect(parallel.impedanceOhm).toBeCloseTo(230, 9);
    expect(parallel.phaseDeg).toBe(-0); // atan2(0, G) is zero, and so is its negation
  });

  it("shorts the parallel network at zero resistance instead of dividing by it", () => {
    const result = rlcResponse({
      frequencyHz: 1000,
      resistanceOhm: 0,
      inductanceH: 0.01,
      capacitanceF: 1e-6,
      connection: "parallel",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.impedanceOhm).toBe(0);
    expect(result.phaseDeg).toBe(0);
    expect(result.conductanceS).toBeUndefined();
    expect(result.qualityFactor).toBeUndefined(); // Q needs a finite R above zero
  });

  it("regresses the series/parallel Q swap: at R = 1 kOhm they are reciprocals, not equal", () => {
    // At R = 100 (the vector above) Q_series and Q_parallel both happen to be 1,
    // which is exactly the value at which a series/parallel formula swap is
    // invisible to a test. At R = 1 kOhm they pull apart to 0.1 and 10 — a
    // hundredfold difference a swapped formula cannot hide behind.
    const base = { frequencyHz: 1000, resistanceOhm: 1000, inductanceH: 0.01, capacitanceF: 1e-6 };
    const series = rlcResponse({ ...base, connection: "series" });
    const parallel = rlcResponse({ ...base, connection: "parallel" });
    expect(series.ok && parallel.ok).toBe(true);
    if (!series.ok || !parallel.ok) return;
    // f0 = 1/(2 pi sqrt(0.01 x 1e-6)) = 1/(2 pi x 1e-4) = 1591.54943 Hz, the same
    // in both connections since it depends only on L and C.
    expect(series.resonanceHz).toBeCloseTo(1591.54943, 5);
    expect(parallel.resonanceHz).toBeCloseTo(1591.54943, 5);
    // Q_series = (1/1000) x sqrt(0.01/1e-6) = 0.001 x 100 = 0.1
    expect(series.qualityFactor).toBeCloseTo(0.1, 9);
    // BW_series = f0/Q = 1591.54943/0.1 = 15915.4943 Hz (= R/(2 pi L))
    expect(series.bandwidthHz).toBeCloseTo(15915.4943, 4);
    // Q_parallel = 1000 x sqrt(1e-6/0.01) = 1000 x 0.01 = 10 — the RECIPROCAL of
    // the series Q, not the same number the series formula would also produce.
    expect(parallel.qualityFactor).toBeCloseTo(10, 9);
    // BW_parallel = f0/Q = 1591.54943/10 = 159.154943 Hz (= 1/(2 pi R C))
    expect(parallel.bandwidthHz).toBeCloseTo(159.154943, 6);
  });

  it("refuses a zero frequency and each element outside its band", () => {
    // At f = 0 the capacitive reactance is unbounded, so there is no answer.
    expect(rlcResponse({ frequencyHz: 0, resistanceOhm: 100, connection: "series" })).toEqual({
      ok: false,
      reason: "frequency",
    });
    expect(rlcResponse({ frequencyHz: 50, resistanceOhm: -1, connection: "series" })).toEqual({
      ok: false,
      reason: "resistance",
    });
    expect(
      rlcResponse({ frequencyHz: 50, resistanceOhm: 1, inductanceH: -1, connection: "series" }),
    ).toEqual({ ok: false, reason: "inductance" });
    expect(
      rlcResponse({ frequencyHz: 50, resistanceOhm: 1, capacitanceF: 2, connection: "series" }),
    ).toEqual({ ok: false, reason: "capacitance" });
  });
});

describe("sectionProperties", () => {
  it("computes a 100 x 200 rectangle about both axes", () => {
    const result = sectionProperties({
      shape: { kind: "rectangle", widthMm: 100, heightMm: 200 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.areaMm2).toBe(20000); // 100 x 200
    expect(result.momentOfInertiaXMm4).toBeCloseTo(66666666.6667, 3); // 100 x 8e6/12
    expect(result.sectionModulusXMm3).toBeCloseTo(666666.666667, 6); // 100 x 40000/6
    // sqrt(66666666.7/20000) = sqrt(3333.33) = 57.7350269, which is h/sqrt(12)
    expect(result.radiusOfGyrationXMm).toBeCloseTo(57.7350269, 7);
    expect(result.momentOfInertiaYMm4).toBeCloseTo(16666666.6667, 3); // 200 x 1e6/12
    expect(result.sectionModulusYMm3).toBeCloseTo(333333.333333, 6);
    expect(result.radiusOfGyrationYMm).toBeCloseTo(28.8675135, 7);
    // A rectangle has no meaningful polar pair — see the note on St Venant.
    expect(result.polar).toBeUndefined();
  });

  it("computes a 60/50 tube and its torsional stress", () => {
    const result = sectionProperties({
      shape: { kind: "tube", outerDiameterMm: 60, innerDiameterMm: 50 },
      torsionMomentNm: 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.areaMm2).toBeCloseTo(863.937980, 6); // pi x (3600 - 2500)/4
    // (12960000 - 6250000)/64 = 104843.75; x pi = 329376.355 mm4
    expect(result.momentOfInertiaXMm4).toBeCloseTo(329376.355, 3);
    expect(result.sectionModulusXMm3).toBeCloseTo(10979.2118, 4); // 2I/60
    // sqrt(3600 + 2500)/4 = 78.1024968/4 = 19.5256242, and sqrt(I/A) agrees
    expect(result.radiusOfGyrationXMm).toBeCloseTo(19.5256242, 7);
    expect(result.polar?.momentMm4).toBeCloseTo(658752.710, 3);
    expect(result.polar?.modulusMm3).toBeCloseTo(21958.4237, 4);
    // 500 N*m = 500000 N*mm; /21958.4237 = 22.7703048 MPa
    expect(result.torsionalStressMpa).toBeCloseTo(22.7703048, 7);
  });

  it("computes a symmetric I-section with square corners", () => {
    const result = sectionProperties({
      shape: {
        kind: "iSection",
        flangeWidthMm: 100,
        depthMm: 200,
        flangeThicknessMm: 8,
        webThicknessMm: 6,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.areaMm2).toBe(2704); // 2 x 100 x 8 + 184 x 6
    // (100 x 8e6 - 94 x 6229504)/12 = (8e8 - 585573376)/12 = 17868885.3
    expect(result.momentOfInertiaXMm4).toBeCloseTo(17868885.3333, 3);
    expect(result.sectionModulusXMm3).toBeCloseTo(178688.853333, 5); // 2I/200
    expect(result.radiusOfGyrationXMm).toBeCloseTo(81.2915468, 7); // sqrt(6608.31558)
    // (2 x 8 x 1e6 + 184 x 216)/12 = 16039744/12 = 1336645.33
    expect(result.momentOfInertiaYMm4).toBeCloseTo(1336645.33333, 4);
    expect(result.sectionModulusYMm3).toBeCloseTo(26732.9066667, 6); // 2I/100
    expect(result.radiusOfGyrationYMm).toBeCloseTo(22.2333421, 7);
    // No polar pair: I_x + I_y is not the torsion constant of an open section.
    expect(result.polar).toBeUndefined();
  });

  it("computes a rectangular tube as the difference of two rectangles", () => {
    const result = sectionProperties({
      shape: {
        kind: "rectangularTube",
        outerWidthMm: 100,
        outerHeightMm: 60,
        innerWidthMm: 92,
        innerHeightMm: 52,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.areaMm2).toBe(1216); // 6000 - 4784
    // (100 x 216000 - 92 x 140608)/12 = (21600000 - 12935936)/12 = 722005.333
    expect(result.momentOfInertiaXMm4).toBeCloseTo(722005.333333, 6);
    expect(result.sectionModulusXMm3).toBeCloseTo(24066.8444444, 7); // 2I/60
    // (60 x 1e6 - 52 x 778688)/12 = (60000000 - 40491776)/12 = 1625685.33
    expect(result.momentOfInertiaYMm4).toBeCloseTo(1625685.33333, 5);
    expect(result.sectionModulusYMm3).toBeCloseTo(32513.7066667, 6); // 2I/100
    expect(result.radiusOfGyrationXMm).toBeCloseTo(24.3670759, 7);
    expect(result.radiusOfGyrationYMm).toBeCloseTo(36.5638111, 7);
  });

  it("computes a solid circle, where the radius of gyration is exactly d/4", () => {
    const result = sectionProperties({ shape: { kind: "circle", diameterMm: 40 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.areaMm2).toBeCloseTo(1256.63706, 5); // pi x 1600/4
    expect(result.momentOfInertiaXMm4).toBeCloseTo(125663.706, 3); // pi x 2560000/64
    expect(result.sectionModulusXMm3).toBeCloseTo(6283.18531, 5); // pi x 64000/32
    expect(result.radiusOfGyrationXMm).toBeCloseTo(10, 10); // d/4
    expect(result.polar?.modulusMm3).toBeCloseTo(12566.3706, 4); // 2W
  });

  it("reports the stress and the ratio against the user's own allowable", () => {
    const result = sectionProperties({
      shape: { kind: "rectangle", widthMm: 100, heightMm: 200 },
      allowableStressMpa: 160,
      bendingMomentNm: 50000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // W_x x 160/1000 = 666666.667 x 0.16 = 106666.667 N*m
    expect(result.allowableMomentNm).toBeCloseTo(106666.666667, 6);
    // 50000 x 1000/666666.667 = 75 MPa
    expect(result.bendingStressMpa).toBeCloseTo(75, 9);
    expect(result.stressRatio).toBeCloseTo(0.46875, 10); // 75/160
    expect(allKeys(result)).not.toContain("passes");
  });

  it("draws no comparison at all when no allowable was typed", () => {
    const result = sectionProperties({
      shape: { kind: "rectangle", widthMm: 100, heightMm: 200 },
      bendingMomentNm: 50000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bendingStressMpa).toBeCloseTo(75, 9);
    expect(result.stressRatio).toBeUndefined();
    expect(result.allowableMomentNm).toBeUndefined();
  });

  it("refuses every impossible geometry by the name of the dimension", () => {
    expect(
      sectionProperties({ shape: { kind: "rectangle", widthMm: 0, heightMm: 200 } }),
    ).toEqual({ ok: false, reason: "width" });
    expect(
      sectionProperties({ shape: { kind: "rectangle", widthMm: 100, heightMm: -1 } }),
    ).toEqual({ ok: false, reason: "height" });
    expect(sectionProperties({ shape: { kind: "circle", diameterMm: 0 } })).toEqual({
      ok: false,
      reason: "diameter",
    });
    expect(
      sectionProperties({ shape: { kind: "tube", outerDiameterMm: 60, innerDiameterMm: 60 } }),
    ).toEqual({ ok: false, reason: "innerDiameter" });
    expect(
      sectionProperties({ shape: { kind: "tube", outerDiameterMm: 0, innerDiameterMm: 1 } }),
    ).toEqual({ ok: false, reason: "outerDiameter" });
    expect(
      sectionProperties({
        shape: {
          kind: "rectangularTube",
          outerWidthMm: 100,
          outerHeightMm: 60,
          innerWidthMm: 100,
          innerHeightMm: 52,
        },
      }),
    ).toEqual({ ok: false, reason: "innerWidth" });
    expect(
      sectionProperties({
        shape: {
          kind: "rectangularTube",
          outerWidthMm: 100,
          outerHeightMm: 60,
          innerWidthMm: 92,
          innerHeightMm: 60,
        },
      }),
    ).toEqual({ ok: false, reason: "innerHeight" });
    // Two 30 mm flanges leave no web in a 60 mm section.
    expect(
      sectionProperties({
        shape: {
          kind: "iSection",
          flangeWidthMm: 100,
          depthMm: 60,
          flangeThicknessMm: 30,
          webThicknessMm: 6,
        },
      }),
    ).toEqual({ ok: false, reason: "flangeThickness" });
    expect(
      sectionProperties({
        shape: {
          kind: "iSection",
          flangeWidthMm: 100,
          depthMm: 200,
          flangeThicknessMm: 8,
          webThicknessMm: 100,
        },
      }),
    ).toEqual({ ok: false, reason: "webThickness" });
    expect(
      sectionProperties({
        shape: { kind: "rectangle", widthMm: 100, heightMm: 200 },
        allowableStressMpa: 0,
      }),
    ).toEqual({ ok: false, reason: "allowableStress" });
    expect(
      sectionProperties({
        shape: { kind: "rectangle", widthMm: 100, heightMm: 200 },
        bendingMomentNm: -1,
      }),
    ).toEqual({ ok: false, reason: "bendingMoment" });
    expect(
      sectionProperties({
        shape: { kind: "rectangle", widthMm: 100, heightMm: 200 },
        torsionMomentNm: -1,
      }),
    ).toEqual({ ok: false, reason: "torsionMoment" });
  });

  // Every dimension below is a positive finite number, so every per-input guard
  // in the function passes; it is the PRODUCT that leaves the range of a double.
  // A section modulus that underflows to exactly zero used to be returned as a
  // valid section, and the bending stress computed from it came back `Infinity`
  // with `ok: true` — a life-safety tool answering with an authority it did not
  // have. The guard now sits on the constructed section, so no shape can produce
  // one whose derived properties are not positive and finite.
  it("refuses a section whose derived properties leave the range of a double", () => {
    // 1e-200 x 1e-200 = 1e-400, which underflows to 0: zero area, zero modulus,
    // a bending stress of 100000/0 and a radius of gyration of sqrt(0/0).
    expect(
      sectionProperties({
        shape: { kind: "rectangle", widthMm: 1e-200, heightMm: 1e-200 },
        bendingMomentNm: 100,
      }),
    ).toEqual({ ok: false, reason: "dimensions" });
    // The other end cannot get this far and should not: every dimension is
    // banded at 10 000 mm, so the band guard refuses first and names the
    // dimension, which is the more useful of the two refusals. Asserted so that
    // widening a band never silently moves an overflow into the generic reason.
    expect(
      sectionProperties({ shape: { kind: "rectangle", widthMm: 1e200, heightMm: 1e200 } }),
    ).toEqual({ ok: false, reason: "width" });
    // d^4 underflows two hundred orders of magnitude before d^2 does, so a
    // circle can have a positive area and no moment of inertia at all.
    expect(sectionProperties({ shape: { kind: "circle", diameterMm: 1e-100 } })).toEqual({
      ok: false,
      reason: "dimensions",
    });
  });
});

describe("networkEquivalent", () => {
  it("adds resistors in series and reciprocally in parallel", () => {
    const parallel = networkEquivalent({
      element: "resistor",
      connection: "parallel",
      values: [100, 220, 470],
    });
    const series = networkEquivalent({
      element: "resistor",
      connection: "series",
      values: [100, 220, 470],
    });
    expect(parallel.ok && series.ok).toBe(true);
    if (!parallel.ok || !series.ok) return;
    // 0.01 + 0.00454545455 + 0.00212765957 = 0.01667311412; 1/that = 59.9767981
    expect(parallel.equivalent).toBeCloseTo(59.9767981, 7);
    expect(series.equivalent).toBe(790); // 100 + 220 + 470
    expect(parallel.mantissa).toBeCloseTo(59.9767981, 7);
    expect(parallel.exponent).toBe(0);
  });

  it("treats capacitors as the dual, and gives back the product-over-sum for two", () => {
    const result = networkEquivalent({
      element: "capacitor",
      connection: "series",
      values: [100e-6, 220e-6],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1/100 + 1/220 = 0.014545455 (in 1/uF); 1/that = 68.75 uF, which the
    // product over the sum confirms: 100 x 220/320 = 68.75.
    expect(result.equivalent).toBeCloseTo(68.75e-6, 12);
    expect(result.mantissa).toBeCloseTo(68.75, 8);
    expect(result.exponent).toBe(-6);
    const parallel = networkEquivalent({
      element: "capacitor",
      connection: "parallel",
      values: [100e-6, 220e-6],
    });
    expect(parallel.ok).toBe(true);
    if (!parallel.ok) return;
    expect(parallel.equivalent).toBeCloseTo(320e-6, 12);
  });

  it("adds inductors the way it adds resistors", () => {
    const result = networkEquivalent({
      element: "inductor",
      connection: "series",
      values: [1e-3, 1e-3, 1e-3],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.equivalent).toBeCloseTo(3e-3, 12);
    expect(result.mantissa).toBeCloseTo(3, 9);
    expect(result.exponent).toBe(-3);
  });

  it("short-circuits on a zero instead of dividing by it", () => {
    // A 0 ohm resistor in parallel is a short: the answer is exactly 0 and no
    // reciprocal is ever evaluated.
    const shorted = networkEquivalent({
      element: "resistor",
      connection: "parallel",
      values: [100, 0, 470],
    });
    expect(shorted.ok).toBe(true);
    if (!shorted.ok) return;
    expect(shorted.equivalent).toBe(0);
    // The same zero in series simply contributes nothing.
    const inSeries = networkEquivalent({
      element: "resistor",
      connection: "series",
      values: [100, 0, 470],
    });
    expect(inSeries.ok).toBe(true);
    if (!inSeries.ok) return;
    expect(inSeries.equivalent).toBe(570);
    // For capacitors it is the series connection that a zero blocks.
    const blocked = networkEquivalent({
      element: "capacitor",
      connection: "series",
      values: [1e-6, 0],
    });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.equivalent).toBe(0);
  });

  it("refuses an empty list, a negative value and more rows than it accepts", () => {
    expect(networkEquivalent({ element: "resistor", connection: "series", values: [] })).toEqual({
      ok: false,
      reason: "values",
    });
    expect(
      networkEquivalent({ element: "resistor", connection: "series", values: [100, -1] }),
    ).toEqual({ ok: false, reason: "values" });
    expect(
      networkEquivalent({
        element: "resistor",
        connection: "series",
        values: Array.from({ length: 33 }, () => 100),
      }),
    ).toEqual({ ok: false, reason: "tooManyValues" });
  });
});

describe("voltageDivider", () => {
  it("splits 12 V across 6.8 k and 3.3 k, with the power in each leg", () => {
    const result = voltageDivider({ inputVoltageV: 12, upperOhm: 6800, lowerOhm: 3300 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 12 x 3300/10100 = 39600/10100 = 3.92079208 V
    expect(result.outputVoltageV).toBeCloseTo(3.92079208, 8);
    expect(result.currentA).toBeCloseTo(0.00118811881, 11); // 12/10100
    // I^2 = 144/102010000 = 1.41162621e-6; x6800 = 9.59905892e-3 W
    expect(result.upperPowerW).toBeCloseTo(0.00959905892, 11);
    expect(result.lowerPowerW).toBeCloseTo(0.00465836683, 11); // x3300
    // The consistency check: U x I must be the two leg powers added.
    expect(result.totalPowerW).toBeCloseTo(0.0142574257, 10);
    expect(result.upperPowerW + result.lowerPowerW).toBeCloseTo(result.totalPowerW, 12);
    // R_th = R1*R2/(R1+R2) = 6800*3300/10100 = 22440000/10100 = 2221.78218 ohm —
    // what a load sees, and the number that makes outputVoltageV honestly UNLOADED.
    expect(result.theveninResistanceOhm).toBeCloseTo(2221.78218, 5);
  });

  it("passes the whole input through when the upper resistor is zero", () => {
    const result = voltageDivider({ inputVoltageV: 12, upperOhm: 0, lowerOhm: 3300 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outputVoltageV).toBe(12);
    expect(result.upperPowerW).toBe(0);
    expect(result.theveninResistanceOhm).toBe(0); // 0*3300/3300
  });

  it("refuses a total resistance that is positive but too small to divide by", () => {
    // Neither leg has an upper bound, so Number.MIN_VALUE ohm (about
    // 4.9406564584124654e-324) passes `isNonNegative` on its own; 12 V over it
    // is far past the largest finite double, by exponent arithmetic alone.
    expect(
      voltageDivider({ inputVoltageV: 12, upperOhm: Number.MIN_VALUE, lowerOhm: 0 }),
    ).toEqual({ ok: false, reason: "total" });
  });

  it("refuses a divider with no resistance at all, and each bad input", () => {
    expect(voltageDivider({ inputVoltageV: 12, upperOhm: 0, lowerOhm: 0 })).toEqual({
      ok: false,
      reason: "total",
    });
    expect(voltageDivider({ inputVoltageV: -12, upperOhm: 100, lowerOhm: 100 })).toEqual({
      ok: false,
      reason: "inputVoltage",
    });
    expect(voltageDivider({ inputVoltageV: 12, upperOhm: -1, lowerOhm: 100 })).toEqual({
      ok: false,
      reason: "upper",
    });
    expect(voltageDivider({ inputVoltageV: 12, upperOhm: 100, lowerOhm: Number.NaN })).toEqual({
      ok: false,
      reason: "lower",
    });
  });
});

describe("threePhasePower", () => {
  it("goes from 11 kW at 0.85 to the apparent power, the current and the angle", () => {
    const result = threePhasePower({
      system: "three",
      lineVoltageV: 400,
      powerFactor: 0.85,
      activePowerKw: 11,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.apparentKva).toBeCloseTo(12.9411765, 7); // 11/0.85
    // 12941.1765/(sqrt(3) x 400) = 12941.1765/692.820323 = 18.6789793 A
    expect(result.currentA).toBeCloseTo(18.6789793, 7);
    // sin = sqrt(1 - 0.7225) = 0.526782688; 12.9411765 x that = 6.81718772 kvar
    expect(result.reactiveKvar).toBeCloseTo(6.81718772, 8);
    expect(result.activeKw).toBeCloseTo(11, 10);
    expect(result.phaseDeg).toBeCloseTo(31.7883306, 7); // acos(0.85)
    expect(result.tanPhi).toBeCloseTo(0.619744338, 9); // 0.526782688/0.85
  });

  it("drops the sqrt(3) in a single-phase system, where cos = 1 zeroes the reactive part", () => {
    const result = threePhasePower({
      system: "single",
      lineVoltageV: 230,
      powerFactor: 1,
      currentA: 16,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.apparentKva).toBeCloseTo(3.68, 10); // 230 x 16 / 1000
    expect(result.activeKw).toBeCloseTo(3.68, 10);
    expect(result.reactiveKvar).toBe(0); // sqrt(1 - 1) is exactly zero
    expect(result.phaseDeg).toBe(0);
    expect(result.tanPhi).toBe(0);
    // In a single-phase system the phase values ARE the line values.
    expect(result.phaseVoltageV).toBe(230);
    expect(result.phaseCurrentA).toBe(16);
  });

  it("moves the sqrt(3) between voltage and current according to the winding", () => {
    const star = threePhasePower({
      system: "three",
      lineVoltageV: 400,
      powerFactor: 0.85,
      apparentPowerKva: 12.9411765,
      connection: "star",
    });
    const delta = threePhasePower({
      system: "three",
      lineVoltageV: 400,
      powerFactor: 0.85,
      apparentPowerKva: 12.9411765,
      connection: "delta",
    });
    expect(star.ok && delta.ok).toBe(true);
    if (!star.ok || !delta.ok) return;
    expect(star.phaseVoltageV).toBeCloseTo(230.940108, 6); // 400/sqrt(3)
    expect(star.phaseCurrentA).toBeCloseTo(18.6789793, 6); // the line current
    expect(delta.phaseVoltageV).toBe(400);
    // 18.6789793/1.7320508076 = 10.7843138 (1.7320508076 x 10.78 = 18.6715077;
    // remainder 0.0074716/1.7320508076 = 0.0043138)
    expect(delta.phaseCurrentA).toBeCloseTo(10.7843138, 5);
    // The line quantities are untouched by the winding — the usual confusion.
    expect(star.currentA).toBeCloseTo(delta.currentA, 12);
  });

  it("gives all zeros at zero current, which is defined", () => {
    const result = threePhasePower({
      system: "three",
      lineVoltageV: 400,
      powerFactor: 0.85,
      currentA: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.apparentKva).toBe(0);
    expect(result.activeKw).toBe(0);
    expect(result.reactiveKvar).toBe(0);
  });

  it("refuses anything but exactly one known quantity, and a zero voltage or power factor", () => {
    const base = { system: "three", lineVoltageV: 400, powerFactor: 0.85 } as const;
    expect(threePhasePower({ ...base })).toEqual({ ok: false, reason: "known" });
    expect(threePhasePower({ ...base, currentA: 16, activePowerKw: 11 })).toEqual({
      ok: false,
      reason: "known",
    });
    expect(threePhasePower({ ...base, lineVoltageV: 0, currentA: 16 })).toEqual({
      ok: false,
      reason: "voltage",
    });
    expect(threePhasePower({ ...base, powerFactor: 0, currentA: 16 })).toEqual({
      ok: false,
      reason: "powerFactor",
    });
    expect(threePhasePower({ ...base, currentA: -1 })).toEqual({ ok: false, reason: "current" });
    expect(threePhasePower({ ...base, activePowerKw: -1 })).toEqual({
      ok: false,
      reason: "activePower",
    });
    expect(threePhasePower({ ...base, apparentPowerKva: -1 })).toEqual({
      ok: false,
      reason: "apparentPower",
    });
  });
});

describe("torqueSpeedPower", () => {
  it("finds the torque of 5.5 kW at 1450 min^-1 and shows it in every unit", () => {
    const result = torqueSpeedPower({ powerW: 5500, speedRpm: 1450 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 30 x 5500/(pi x 1450) = 165000/4555.30935 = 36.2214698 N*m
    expect(result.torqueNm).toBeCloseTo(36.2214698, 7);
    expect(result.torqueKgfM).toBeCloseTo(3.693562, 6); // /9.80665
    expect(result.torqueLbfFt).toBeCloseTo(26.7155851, 7); // /1.35581794833
    expect(result.angularVelocityRadS).toBeCloseTo(151.843645, 6); // 2 pi x 1450/60
    expect(result.powerMetricHp).toBeCloseTo(7.4779189, 7); // 5500/735.49875
    expect(result.powerMechanicalHp).toBeCloseTo(7.37562149, 8); // 5500/745.699872
    // The identity closes: M x omega must be the power we started from.
    expect(result.torqueNm * result.angularVelocityRadS).toBeCloseTo(5500, 9);
  });

  it("finds the power of 200 N*m at 60 min^-1, where omega is exactly 2 pi", () => {
    const result = torqueSpeedPower({ torqueNm: 200, speedRpm: 60 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.angularVelocityRadS).toBeCloseTo(6.28318531, 8);
    expect(result.powerW).toBeCloseTo(1256.63706, 5); // 200 x 2 pi
    expect(result.powerKw).toBeCloseTo(1.25663706, 8);
    expect(result.powerMetricHp).toBeCloseTo(1.70855091, 8); // 1256.63706/735.49875
  });

  it("accepts the angular velocity in place of the speed and agrees with itself", () => {
    const byRpm = torqueSpeedPower({ powerW: 5500, speedRpm: 1450 });
    const byOmega = torqueSpeedPower({ powerW: 5500, angularVelocityRadS: 151.8436449 });
    expect(byRpm.ok && byOmega.ok).toBe(true);
    if (!byRpm.ok || !byOmega.ok) return;
    expect(byOmega.speedRpm).toBeCloseTo(1450, 6); // 30 x 151.8436449/pi
    expect(byOmega.torqueNm).toBeCloseTo(byRpm.torqueNm, 6);
  });

  it("finds the speed from torque and power", () => {
    const result = torqueSpeedPower({ torqueNm: 36.2214698, powerW: 5500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // omega = 5500/36.2214698 = 151.843645 rad/s; n = 30 x omega/pi = 1450
    expect(result.angularVelocityRadS).toBeCloseTo(151.843645, 6);
    expect(result.speedRpm).toBeCloseTo(1450, 5);
  });

  it("turns a shaft against nothing at zero torque with a speed given", () => {
    const result = torqueSpeedPower({ torqueNm: 0, speedRpm: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.powerW).toBe(0);
    expect(result.powerMetricHp).toBe(0);
  });

  it("refuses the two unbounded combinations and anything but exactly two quantities", () => {
    // Zero speed is outside the input band precisely because power at zero speed
    // puts the torque beyond any number.
    expect(torqueSpeedPower({ powerW: 5500, speedRpm: 0 })).toEqual({ ok: false, reason: "speed" });
    // Power with no torque puts the speed beyond any number.
    expect(torqueSpeedPower({ powerW: 5500, torqueNm: 0 })).toEqual({
      ok: false,
      reason: "torque",
    });
    expect(torqueSpeedPower({ powerW: 5500 })).toEqual({ ok: false, reason: "pair" });
    expect(torqueSpeedPower({ powerW: 5500, speedRpm: 1450, torqueNm: 36 })).toEqual({
      ok: false,
      reason: "pair",
    });
    // The speed is one quantity, however it is written.
    expect(
      torqueSpeedPower({ powerW: 5500, speedRpm: 1450, angularVelocityRadS: 151.8 }),
    ).toEqual({ ok: false, reason: "speed" });
    expect(torqueSpeedPower({ powerW: -1, speedRpm: 1450 })).toEqual({
      ok: false,
      reason: "power",
    });
    expect(torqueSpeedPower({ torqueNm: -1, speedRpm: 1450 })).toEqual({
      ok: false,
      reason: "torque",
    });
  });

  it("bounds omega against the SAME 1e6 min^-1 ceiling as n, not a looser one of its own", () => {
    // n and omega are one quantity, so typing a speed in rad/s must not buy a
    // wider band than typing the same speed in min^-1 would. The ceiling on n is
    // 1e6 min^-1, which is 2*pi*1e6/60 = 104719.755 rad/s: 100000 rad/s sits just
    // under it, 110000 rad/s just over.
    const underCeiling = torqueSpeedPower({ powerW: 5500, angularVelocityRadS: 100000 });
    expect(underCeiling.ok).toBe(true);
    if (!underCeiling.ok) return;
    // 30 x 100000/pi = 3000000/3.14159265359 = 954929.658629
    expect(underCeiling.speedRpm).toBeCloseTo(954929.658629, 3);
    expect(torqueSpeedPower({ powerW: 5500, angularVelocityRadS: 110000 })).toEqual({
      ok: false,
      reason: "speed",
    });
    // 1e9 rad/s converts to 30*1e9/pi = 9.549e9 min^-1, nine orders past the
    // declared 1e6 ceiling — refused, not silently accepted as a valid speed.
    expect(torqueSpeedPower({ powerW: 5500, angularVelocityRadS: 1e9 })).toEqual({
      ok: false,
      reason: "speed",
    });
  });

  it("refuses rather than overflowing when a valid power and a valid but extreme speed cannot be reconciled", () => {
    // omega = 2*pi*1e-300/60 is about 1.047e-301 rad/s; speedRpm = 1e-300 is
    // still inside the (0, 1e6] band on its own. 1e9 W over that omega is on
    // the order of 1e310 by exponent arithmetic (9 - (-301) = 310), past the
    // largest finite double, about 1.7976931348623157e308.
    expect(torqueSpeedPower({ powerW: 1e9, speedRpm: 1e-300 })).toEqual({
      ok: false,
      reason: "power",
    });
  });

  it("refuses rather than overflowing when the torque is merely tiny rather than exactly zero", () => {
    // torqueNm = 1e-300 is inside [0, 1e9] and is not the torque = 0 case the
    // existing refusal above already catches. 1e9 W over that torque is again
    // beyond any finite double by the same exponent arithmetic (9 - (-300) =
    // 309 > 308).
    expect(torqueSpeedPower({ powerW: 1e9, torqueNm: 1e-300 })).toEqual({
      ok: false,
      reason: "torque",
    });
  });
});

describe("a union value is a claim, not a fact — the table is asked at runtime", () => {
  type PipeFlowInput = Parameters<typeof pipeFlow>[0];
  type PipeFlowGiven = NonNullable<PipeFlowInput["flow"]>;

  it("pipeFlow refuses a flow unit outside the table instead of multiplying by an undefined factor", () => {
    const good: PipeFlowInput = {
      innerDiameterMm: 50,
      flow: { value: 3, unit: "m3/h" },
      kinematicViscosityMm2S: 1.004,
    };
    // The cast is the test: TypeScript forbids this value, the renderer is not
    // obliged to honour that, and the function must refuse rather than throw.
    const bad: PipeFlowInput = {
      ...good,
      flow: { value: 3, unit: "gpm" as PipeFlowGiven["unit"] },
    };
    expect(pipeFlow(bad)).toEqual({ ok: false, reason: "flowUnit" });
    expect(pipeFlow(good).ok).toBe(true);
  });
});

/**
 * The screen must not be the second author of a number the arithmetic chose.
 *
 * Each of these three tools defaults an input the user may leave empty, and each
 * of their surfaces used to restate that default beside the echo — twice in
 * string clothing (`series.trim() === "" ? "1"`), which is why a grep for `??`
 * did not find them. Two copies of a default agree until one moves, and then the
 * screen reports a value the arithmetic did not use.
 */
describe("the resolved defaults are returned rather than restated", () => {
  it("batteryBankRuntime reports the series, parallel and efficiency it used", () => {
    const base = {
      cellCapacityAh: 100,
      cellVoltage: 3.2,
      depthOfDischargePct: 80,
      load: { kind: "power", watts: 200 },
    } as const;

    const defaulted = batteryBankRuntime(base);
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.seriesUsed).toBe(1);
    expect(defaulted.parallelUsed).toBe(1);
    expect(defaulted.efficiencyPctUsed).toBe(100);

    const explicit = batteryBankRuntime({
      ...base,
      series: 16,
      parallel: 2,
      converterEfficiencyPct: 92,
    });
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.seriesUsed).toBe(16);
    expect(explicit.parallelUsed).toBe(2);
    expect(explicit.efficiencyPctUsed).toBe(92);
    // And the reported efficiency is the one actually in the arithmetic: the
    // pack current is P/(U*eta) = 200/(51.2*0.92), not P/U.
    expect(explicit.packCurrentA).toBeCloseTo(200 / (16 * 3.2 * 0.92), 12);

    // The Peukert branch is a second return statement, and it carries them too.
    const peukert = batteryBankRuntime({ ...base, peukertExponent: 1.1, ratedDischargeHours: 20 });
    expect(peukert.ok).toBe(true);
    if (!peukert.ok) return;
    expect(peukert.seriesUsed).toBe(1);
    expect(peukert.parallelUsed).toBe(1);
    expect(peukert.efficiencyPctUsed).toBe(100);
  });

  it("cableCrossSection reports the conductor temperature it corrected to", () => {
    const base = {
      lengthM: 30,
      currentA: 16,
      voltageV: 230,
      permittedDropPct: 3,
      material: "copper",
      system: "single",
    } as const;

    const defaulted = cableCrossSection(base);
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.conductorTempCUsed).toBe(20);
    // 20 °C is the reference, so the correction factor is exactly 1 and the
    // resistivity is the IEC copper value 1/58 ohm*mm2/m unchanged.
    expect(defaulted.resistivity).toBeCloseTo(1 / 58, 12);

    const explicit = cableCrossSection({ ...base, conductorTempC: 70 });
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.conductorTempCUsed).toBe(70);
    expect(explicit.resistivity).toBeCloseTo((1 / 58) * 1.1965, 12);
  });

  it("inductionMotorRating reports the supply frequency it assumed", () => {
    const base = {
      shaftPowerKw: 7.5,
      lineVoltageV: 400,
      powerFactor: 0.86,
      efficiencyPct: 90,
      poles: 4,
    } as const;

    const defaulted = inductionMotorRating(base);
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.frequencyHzUsed).toBe(50);
    expect(defaulted.synchronousSpeedRpm).toBe(1500);

    const explicit = inductionMotorRating({ ...base, frequencyHz: 60 });
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.frequencyHzUsed).toBe(60);
    expect(explicit.synchronousSpeedRpm).toBe(1800);
  });
});

/**
 * `rodMm` defaults to 0 — a cylinder with no rod on the return side — and the
 * surface restated that 0 beside the echo. See `ShelfSpacingResult.rasterUsed`.
 */
describe("pistonForce returns the rod diameter it used", () => {
  it("reports 0 when no rod was given, and the annulus equals the bore", () => {
    const result = pistonForce({ gaugePressurePa: 1.6e7, boreMm: 63 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rodMmUsed).toBe(0);
    // No rod: the return side sees the full bore, so the two forces are equal.
    expect(result.annulusAreaMm2).toBeCloseTo(result.boreAreaMm2, 12);
    expect(result.retractForceN).toBeCloseTo(result.extendForceN, 9);
  });

  it("reports the rod given, and it is the one the annulus was taken from", () => {
    const result = pistonForce({ gaugePressurePa: 1.6e7, boreMm: 63, rodMm: 36 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rodMmUsed).toBe(36);
    // pi x (63^2 - 36^2)/4 = pi x (3969 - 1296)/4 = pi x 668.25 = 2099.36929 mm2
    expect(result.annulusAreaMm2).toBeCloseTo(2099.36929, 5);
  });
});

/**
 * `atmosphericPa` defaults to the standard atmosphere, and the surface restated
 * that 101325 beside its echo. See `ShelfSpacingResult.rasterUsed`.
 *
 * Here the restatement is worse than usual, because the atmosphere IS the
 * difference between the two readings the tool exists to show side by side: a
 * compressor stating 6 bar and a data sheet stating 7 bar can be the same
 * pressure. A screen printing 101325 while the arithmetic used a measured
 * 95 000 would contradict the pair of numbers directly above it.
 */
describe("convertPressure returns the atmosphere it used", () => {
  const base = { value: 6, unit: "bar", kind: "gauge" } as const;

  it("reports the standard atmosphere when none was given", () => {
    const result = convertPressure(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.atmosphericPaUsed).toBe(101325);
    // 6 bar = 600 000 Pa gauge; absolute is that plus the reported atmosphere.
    expect(result.gaugePa).toBeCloseTo(600000, 6);
    expect(result.absolutePa).toBeCloseTo(701325, 6);
  });

  it("reports a measured atmosphere, and it is the one in the arithmetic", () => {
    // 950 mbar, roughly Belgrade in a deep low — the case the field exists for.
    const result = convertPressure({ ...base, atmosphericPa: 95000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.atmosphericPaUsed).toBe(95000);
    expect(result.gaugePa).toBeCloseTo(600000, 6);
    expect(result.absolutePa).toBeCloseTo(695000, 6);
  });

  it("carries it on the absolute-entry direction too, where it is subtracted", () => {
    const result = convertPressure({ value: 7, unit: "bar", kind: "absolute", atmosphericPa: 95000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.atmosphericPaUsed).toBe(95000);
    // Entered absolute: gauge = 700 000 - 95 000 = 605 000.
    expect(result.gaugePa).toBeCloseTo(605000, 6);
    expect(result.absolutePa).toBeCloseTo(700000, 6);
  });
});
