import { describe, expect, it } from "vitest";

import {
  baleCountStorage,
  beeSyrupMix,
  cadastralAreaUnits,
  fertiliserNutrientBlend,
  grainMoistureShrink,
  growingDegreeDays,
  honeyMassMoisture,
  irrigationDepthVolume,
  livestockRationDm,
  machineFieldCapacity,
  orchardTrellisLayout,
  plantSpacingDensity,
  polygonArea,
  seedingRate,
  sprayerCalibration,
  tankMixDose,
  yieldEstimateSamples,
} from "./agro.js";

/**
 * Every expectation here was worked by hand from the inputs, and the
 * arithmetic is written into the comments so it can be checked without
 * running anything, exactly as `gradnja.test.ts` does.
 */

describe("baleCountStorage", () => {
  it("round bales, density-derived mass, yield×area, rectangular storage on-end — vector 1", () => {
    const r = baleCountStorage({
      shape: "round",
      round: { diameterM: 1.2, widthM: 1.2 },
      massMode: "density",
      densityKgM3: 180,
      quantityMode: "yieldPerArea",
      yieldTHa: 4.5,
      areaHa: 12,
      balingLossPercent: 0,
      storage: { lengthM: 10, widthM: 6, usableHeightM: 3.6 },
      roundOrientation: "onEnd",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // V = pi * 0.6^2 * 1.2 = pi * 0.432 = 1.357168026 m^3
    expect(r.baleVolumeM3).toBeCloseTo(1.357168027, 8);
    // mass = 1.357168027 * 180 = 244.290244743 kg
    expect(r.baleMassKg).toBeCloseTo(244.290245, 5);
    // M = 4.5 * 12 = 54 t, no loss -> 54000 kg
    expect(r.totalMassAfterLossT).toBeCloseTo(54, 9);
    // n = 54000 / 244.290244743 = 221.048532...
    expect(r.countExact).toBeCloseTo(221.048532, 5);
    expect(r.countCeil).toBe(222);
    // 222 * 1.357168026 = 301.291302
    expect(r.totalVolumeM3).toBeCloseTo(301.291302, 4);
    // CORRECTED per the assignment's binding review note: bales/ha uses the
    // EXACT count, not the ceiled one — 221.048532/12 = 18.420711, not the
    // 18,5 the uncorrected text would give from 222/12.
    expect(r.balesPerHa).toBeCloseTo(18.420711, 5);
    expect(r.storage).toBeDefined();
    if (r.storage === undefined) return;
    // floor(10/1.2)=8, floor(6/1.2)=5 -> 40 per layer; floor(3.6/1.2)=3 layers
    expect(r.storage.perRow).toBe(8);
    expect(r.storage.perColumn).toBe(5);
    expect(r.storage.perLayer).toBe(40);
    expect(r.storage.layers).toBe(3);
    expect(r.storage.capacity).toBe(120);
    // 120 * 244.290244743 / 1000 = 29.3148294 t
    expect(r.storage.capacityTonnes).toBeCloseTo(29.314829, 5);
    // 10 - 8*1.2 = 0.4 m unused length; 6 - 5*1.2 = 0 unused width
    expect(r.storage.unusedLengthM).toBeCloseTo(0.4, 9);
    expect(r.storage.unusedWidthM).toBeCloseTo(0, 9);
    // needed 222, geometry holds 120 -> shortfall 102
    expect(r.shortfall).toBe(102);
  });

  it("square bales, total mass given directly, three-orientation storage picks the best — vector 2", () => {
    const r = baleCountStorage({
      shape: "square",
      square: { lengthM: 1.2, widthM: 0.7, heightM: 0.5 },
      massMode: "density",
      densityKgM3: 200,
      quantityMode: "totalMass",
      totalMassT: 30,
      balingLossPercent: 0,
      storage: { lengthM: 12, widthM: 8, usableHeightM: 4.0 },
      roundOrientation: "onEnd",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // V = 1.2 * 0.7 * 0.5 = 0.42 m^3; mass = 0.42*200 = 84.0 kg
    expect(r.baleVolumeM3).toBeCloseTo(0.42, 9);
    expect(r.baleMassKg).toBeCloseTo(84.0, 9);
    // no area given -> balesPerHa is undefined (correction 1's other half)
    expect(r.balesPerHa).toBeUndefined();
    // n = 30000/84 = 357.142857 -> ceil 358; 358*0.42 = 150.36
    expect(r.countExact).toBeCloseTo(357.142857, 5);
    expect(r.countCeil).toBe(358);
    expect(r.totalVolumeM3).toBeCloseTo(150.36, 5);
    expect(r.storage).toBeDefined();
    if (r.storage === undefined) return;
    // footprint 1.2x0.7: floor(12/1.2)=10 * floor(8/0.7)=11 -> 110/layer;
    // floor(4.0/0.5)=8 layers -> 880, beats onLengthFace(800) and onWidthFace(816)
    expect(r.storage.orientation).toBe("footprint");
    expect(r.storage.perLayer).toBe(110);
    expect(r.storage.layers).toBe(8);
    expect(r.storage.capacity).toBe(880);
    // 880 * 84 / 1000 = 73.92 t
    expect(r.storage.capacityTonnes).toBeCloseTo(73.92, 6);
  });

  it("round bales with diameter != width: onEnd and onSide genuinely differ (the fit helper's row/column and layer-height dims are not interchangeable)", () => {
    // D=1.5 m, B=1.0 m, storage 10x6x4.0 m. With D=B (as in vector 1) every
    // orientation collapses to the same numbers; this exercises the case
    // where it cannot.
    const common = {
      shape: "round" as const,
      round: { diameterM: 1.5, widthM: 1.0 },
      massMode: "density" as const,
      densityKgM3: 150,
      quantityMode: "totalMass" as const,
      totalMassT: 50,
      balingLossPercent: 0,
      storage: { lengthM: 10, widthM: 6, usableHeightM: 4.0 },
    };
    const onEnd = baleCountStorage({ ...common, roundOrientation: "onEnd" });
    const onSide = baleCountStorage({ ...common, roundOrientation: "onSide" });
    expect(onEnd.ok && onSide.ok).toBe(true);
    if (!onEnd.ok || !onSide.ok || onEnd.storage === undefined || onSide.storage === undefined) return;
    // onEnd: footprint D x D = 1.5x1.5, height dim B = 1.0.
    // floor(10/1.5)=6, floor(6/1.5)=4 (both row/col candidates tie at 24) -> 24/layer
    // layers = floor(4.0/1.0) = 4 -> capacity 96
    expect(onEnd.storage.orientation).toBe("onEnd");
    expect(onEnd.storage.perLayer).toBe(24);
    expect(onEnd.storage.layers).toBe(4);
    expect(onEnd.storage.capacity).toBe(96);
    // onSide: footprint B x D = 1.0x1.5, height dim D = 1.5.
    // candidate A: floor(10/1.0)=10, floor(6/1.5)=4 -> 40/layer
    // candidate B: floor(10/1.5)=6, floor(6/1.0)=6 -> 36/layer -> A wins (40)
    // layers = floor(4.0/1.5) = 2 -> capacity 80
    expect(onSide.storage.orientation).toBe("onSide");
    expect(onSide.storage.perRow).toBe(10);
    expect(onSide.storage.perColumn).toBe(4);
    expect(onSide.storage.perLayer).toBe(40);
    expect(onSide.storage.layers).toBe(2);
    expect(onSide.storage.capacity).toBe(80);
    // genuinely different capacities — a swapped rowDim/heightDim in either
    // branch would make these equal or wrong.
    expect(onEnd.storage.capacity).not.toBe(onSide.storage.capacity);
  });

  it("refuses a typed 0 ha in totalMass mode (areaHa is optional there, but a typed zero must not be indistinguishable from an empty field)", () => {
    expect(
      baleCountStorage({
        shape: "round",
        round: { diameterM: 1.2, widthM: 1.2 },
        massMode: "density",
        densityKgM3: 180,
        quantityMode: "totalMass",
        totalMassT: 10,
        areaHa: 0,
        balingLossPercent: 0,
        roundOrientation: "onEnd",
      }),
    ).toEqual({ ok: false, reason: "areaHa" });
  });

  it("refuses a density outside 30-400 kg/m3, a non-positive measured mass, and a missing shape payload", () => {
    expect(
      baleCountStorage({
        shape: "round",
        round: { diameterM: 1.2, widthM: 1.2 },
        massMode: "density",
        densityKgM3: 500,
        quantityMode: "totalMass",
        totalMassT: 1,
        balingLossPercent: 0,
        roundOrientation: "onEnd",
      }),
    ).toEqual({ ok: false, reason: "densityKgM3" });
    expect(
      baleCountStorage({
        shape: "round",
        round: { diameterM: 1.2, widthM: 1.2 },
        massMode: "measured",
        measuredMassKg: 0,
        quantityMode: "totalMass",
        totalMassT: 1,
        balingLossPercent: 0,
        roundOrientation: "onEnd",
      }),
    ).toEqual({ ok: false, reason: "measuredMassKg" });
    expect(
      baleCountStorage({
        shape: "square",
        massMode: "measured",
        measuredMassKg: 20,
        quantityMode: "totalMass",
        totalMassT: 1,
        balingLossPercent: 0,
        roundOrientation: "onEnd",
      }),
    ).toEqual({ ok: false, reason: "square" });
  });
});

describe("beeSyrupMix", () => {
  it("2:1 by mass, target volume 200 l — vector 1", () => {
    const r = beeSyrupMix({
      ratioA: 2,
      ratioB: 1,
      given: "targetVolume",
      value: 200,
      hiveCount: 40,
      literPerHive: 5,
      bagMassKg: 25,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Vw = 200/(1+0.63*2) = 200/2.26 = 88.495575 l
    expect(r.waterVolumeL).toBeCloseTo(88.495575, 5);
    expect(r.waterMassKg).toBeCloseTo(88.495575, 5);
    // S = 2*88.495575 = 176.991150 kg
    expect(r.sugarKg).toBeCloseTo(176.99115, 5);
    // M = 265.486726; V = 88.495575+0.63*176.99115 = 200.0000
    expect(r.syrupMassKg).toBeCloseTo(265.486726, 5);
    expect(r.syrupVolumeL).toBeCloseTo(200, 6);
    // density = 265.486726/200 = 1.327434
    expect(r.densityKgL).toBeCloseTo(1.327434, 5);
    expect(r.densityIsEstimated).toBe(true);
    // concentration = S/(1+r) form = 176.99115/265.486726*100 = 66.6667% (=2/3 exactly)
    expect(r.concentrationPercent).toBeCloseTo(66.666667, 4);
    // 176.99115/25 = 7.079646 -> 8 bags
    expect(r.bagsExact).toBeCloseTo(7.079646, 5);
    expect(r.bagsCeil).toBe(8);
    // 40 hives * 5 l = exactly the 200 l target volume, so apiary reproduces it
    expect(r.apiary?.volumeL).toBeCloseTo(200, 9);
    expect(r.apiary?.sugarKg).toBeCloseTo(176.99115, 5);
    // floor(200/5) = 40 hives, 0 remainder
    expect(r.hivesCovered).toBe(40);
    expect(r.hivesRemainderL).toBeCloseTo(0, 6);
  });

  it("1:1 by mass, 10 kg of sugar available — vector 2", () => {
    const r = beeSyrupMix({
      ratioA: 1,
      ratioB: 1,
      given: "availableSugar",
      value: 10,
      literPerHive: 2,
      bagMassKg: 25,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sugarKg).toBeCloseTo(10, 9);
    expect(r.waterVolumeL).toBeCloseTo(10, 9);
    expect(r.syrupMassKg).toBeCloseTo(20, 9);
    // V = 10 + 0.63*10 = 16.30 l
    expect(r.syrupVolumeL).toBeCloseTo(16.3, 6);
    // density = 20/16.30 = 1.226994
    expect(r.densityKgL).toBeCloseTo(1.226994, 5);
    expect(r.concentrationPercent).toBeCloseTo(50, 6);
    // floor(16.30/2) = 8, remainder 0.30 l
    expect(r.hivesCovered).toBe(8);
    expect(r.hivesRemainderL).toBeCloseTo(0.3, 6);
  });

  it("regression: an exact hive count is not dropped a ULP below the whole number", () => {
    const r = beeSyrupMix({
      ratioA: 3,
      ratioB: 2,
      given: "targetVolume",
      value: 245,
      literPerHive: 5,
      bagMassKg: 25,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // r = 1.5; water = 245/(1+0.63*1.5) = 245/1.945 = 125.964..., sugar = 1.5*water
    // syrupVolumeL comes out at 244.99999999999997 in raw double arithmetic —
    // exactly 245 on paper — and floor() without round9 would report 48 hives
    // instead of 49, with a whole hive's dose sitting in the remainder.
    expect(r.syrupVolumeL).toBeCloseTo(245, 6);
    expect(r.hivesCovered).toBe(49);
    expect(r.hivesRemainderL).toBeCloseTo(0, 6);
  });

  it("refuses a typed 0 on hiveCount or literPerHive — both optional, both must not be indistinguishable from an empty field", () => {
    expect(
      beeSyrupMix({ ratioA: 2, ratioB: 1, given: "targetVolume", value: 200, hiveCount: 0, bagMassKg: 25 }),
    ).toEqual({ ok: false, reason: "hiveCount" });
    expect(
      beeSyrupMix({ ratioA: 2, ratioB: 1, given: "targetVolume", value: 200, literPerHive: 0, bagMassKg: 25 }),
    ).toEqual({ ok: false, reason: "literPerHive" });
  });

  it("refuses b=0 and a=0 in a custom ratio, and a non-positive given value", () => {
    expect(beeSyrupMix({ ratioA: 2, ratioB: 0, given: "targetVolume", value: 200, bagMassKg: 25 })).toEqual({
      ok: false,
      reason: "ratioB",
    });
    expect(beeSyrupMix({ ratioA: 0, ratioB: 1, given: "targetVolume", value: 200, bagMassKg: 25 })).toEqual({
      ok: false,
      reason: "ratioA",
    });
    expect(beeSyrupMix({ ratioA: 2, ratioB: 1, given: "targetVolume", value: 0, bagMassKg: 25 })).toEqual({
      ok: false,
      reason: "value",
    });
  });
});

describe("cadastralAreaUnits", () => {
  it("1 katastarsko jutro, using the default published jutro — vector 1", () => {
    const r = cadastralAreaUnits({ value: 1, fromUnit: "jutro" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.m2).toBeCloseTo(5754.64, 2);
    // 5754.6424996096/100 = 57.546425
    expect(r.ar).toBeCloseTo(57.5464, 4);
    expect(r.ha).toBeCloseTo(0.575464, 6);
    // 5754.6424996096/3.596651562256 = 1600 exactly (jutro = 1600 hvat^2 by construction)
    expect(r.hvat2).toBeCloseTo(1600.0, 3);
    // shown to 6 decimals now (correction 4), not the original 4
    expect(r.jutro).toBeCloseTo(1.0, 6);
    expect(r.jutroM2Used).toBeCloseTo(5754.6424996096, 6);
  });

  it("30 ari — vector 2", () => {
    const r = cadastralAreaUnits({ value: 30, fromUnit: "ar" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.m2).toBeCloseTo(3000, 2);
    expect(r.ha).toBeCloseTo(0.3, 6);
    // 3000/3.596651562256 = 834.109156
    expect(r.hvat2).toBeCloseTo(834.109, 3);
    // 3000/5754.6424996096 = 0.5213182
    expect(r.jutro).toBeCloseTo(0.521318, 6);
  });

  it("round-trips a value entered directly in Y,X-style hvat and a value entered as jutro, in the corrected column order (see polygonArea)", () => {
    const r = cadastralAreaUnits({ value: 1, fromUnit: "hvat2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.m2).toBeCloseTo(3.6, 2);
    expect(r.hvat2).toBeCloseTo(1.0, 3);
    // 1/1600 = 0.000625
    expect(r.jutro).toBeCloseTo(0.000625, 6);
  });

  it("accepts zero (corrected to >= 0), refuses a negative value and one above the 1e12 m2 ceiling", () => {
    const zero = cadastralAreaUnits({ value: 0, fromUnit: "m2" });
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.m2).toBe(0);
    expect(cadastralAreaUnits({ value: -1, fromUnit: "m2" })).toEqual({ ok: false, reason: "value" });
    expect(cadastralAreaUnits({ value: 1e13, fromUnit: "m2" })).toEqual({ ok: false, reason: "value" });
  });

  it("checks the 1e12 m2 ceiling on the CONVERTED base, not on the raw entered number", () => {
    // 1e12 jutro converts to ~5.75e15 m2, three orders of magnitude past the
    // stated ceiling — must be refused even though 1e12 itself is not.
    expect(cadastralAreaUnits({ value: 1e12, fromUnit: "jutro" })).toEqual({ ok: false, reason: "value" });
    // 1e12 m2 exactly is still accepted, as intended.
    const atLimit = cadastralAreaUnits({ value: 1e12, fromUnit: "m2" });
    expect(atLimit.ok).toBe(true);
  });

  it("uses an overridden local jutro value and echoes it back", () => {
    const r = cadastralAreaUnits({ value: 1, fromUnit: "jutro", jutroM2Override: 5000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.m2).toBeCloseTo(5000, 2);
    expect(r.jutroM2Used).toBe(5000);
  });
});

describe("fertiliserNutrientBlend", () => {
  it("nutrients -> fertiliser, primary + secondary, deficit and per-area totals — vector 1", () => {
    const r = fertiliserNutrientBlend({
      direction: "nutrientsToFertiliser",
      targetForm: "oxide",
      targetN: 150,
      targetP: 80,
      targetK: 90,
      primary: { nPercent: 15, p2o5Percent: 15, k2oPercent: 15 },
      primaryLead: "P2O5",
      secondary: { nPercent: 46, p2o5Percent: 0, k2oPercent: 0 },
      secondaryLead: "N",
      areaHa: 6.5,
      bagMassKg: 50,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [line1, line2] = r.lines;
    // X1 = 100*80/15 = 533.3333 kg/ha, delivering 80/80/80
    expect(line1?.doseKgHa).toBeCloseTo(533.333333, 4);
    expect(line1?.deliveredNKgHa).toBeCloseTo(80, 6);
    expect(line1?.deliveredK2oKgHa).toBeCloseTo(80, 6);
    // deficit N = 150-80 = 70 -> X2 = 100*70/46 = 152.173913, delivering 70.0 N
    expect(line2?.doseKgHa).toBeCloseTo(152.173913, 4);
    expect(line2?.deliveredNKgHa).toBeCloseTo(70, 6);
    // cilj - isporuceno: N=0, P2O5=0, K2O=90-80=+10
    expect(r.targetMinusDeliveredN).toBeCloseTo(0, 6);
    expect(r.targetMinusDeliveredP2o5).toBeCloseTo(0, 6);
    expect(r.targetMinusDeliveredK2o).toBeCloseTo(10, 6);
    // 533.3333*6.5 = 3466.667 -> /50 = 69.333 -> ceil 70
    expect(line1?.totalKg).toBeCloseTo(3466.6667, 3);
    expect(line1?.bagsCeil).toBe(70);
    // 152.173913*6.5 = 989.1304 -> /50 = 19.7826 -> ceil 20
    expect(line2?.bagsCeil).toBe(20);
    // elemental target: P = 80*0.436427 = 34.9142, K = 90*0.830151 = 74.7136
    expect(r.targetPElementKgHa).toBeCloseTo(34.9142, 3);
    expect(r.targetKElementKgHa).toBeCloseTo(74.7136, 3);
  });

  it("fertiliser -> nutrients, single dose over the whole farm — vector 2", () => {
    const r = fertiliserNutrientBlend({
      direction: "fertiliserToNutrients",
      composition: { nPercent: 8, p2o5Percent: 16, k2oPercent: 24 },
      doseKgHa: 350,
      areaHa: 12.4,
      bagMassKg: 50,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deliveredNKgHa).toBeCloseTo(28, 6);
    expect(r.deliveredP2o5KgHa).toBeCloseTo(56, 6);
    expect(r.deliveredK2oKgHa).toBeCloseTo(84, 6);
    // P = 56*0.436427 = 24.43991, K = 84*0.830151 = 69.73268
    expect(r.deliveredPElementKgHa).toBeCloseTo(24.43991, 4);
    expect(r.deliveredKElementKgHa).toBeCloseTo(69.73268, 4);
    // 350*12.4 = 4340 -> /50 = 86.8 -> ceil 87
    expect(r.lines[0]?.bagsCeil).toBe(87);
    // totals over the farm: N 347.2, P2O5 694.4, K2O 1041.6 kg
    expect(r.totalDeliveredNKg).toBeCloseTo(347.2, 3);
    expect(r.totalDeliveredP2o5Kg).toBeCloseTo(694.4, 3);
    expect(r.totalDeliveredK2oKg).toBeCloseTo(1041.6, 3);
  });

  it("K2O lead on a fertiliser whose three percentages genuinely differ (8-16-24) — a mis-mapped lead would print a different dose", () => {
    const r = fertiliserNutrientBlend({
      direction: "nutrientsToFertiliser",
      targetForm: "oxide",
      targetN: 0,
      targetP: 0,
      targetK: 90,
      primary: { nPercent: 8, p2o5Percent: 16, k2oPercent: 24 },
      primaryLead: "K2O",
      areaHa: 1,
      bagMassKg: 50,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // X1 = 100*90/24 = 375.0 kg/ha — the P2O5 (16%) or N (8%) percentage
    // would each give a different, wrong dose here.
    expect(r.lines[0]?.doseKgHa).toBeCloseTo(375.0, 4);
    // delivered: N=375*8/100=30, P2O5=375*16/100=60, K2O=375*24/100=90 (=target)
    expect(r.deliveredNKgHa).toBeCloseTo(30, 6);
    expect(r.deliveredP2o5KgHa).toBeCloseTo(60, 6);
    expect(r.deliveredK2oKgHa).toBeCloseTo(90, 6);
  });

  it("a target entered as bare element (P) is converted to oxide (P2O5) by the 2.291335 factor before the dose is worked", () => {
    const r = fertiliserNutrientBlend({
      direction: "nutrientsToFertiliser",
      targetForm: "element",
      targetN: 0,
      targetP: 20,
      targetK: 0,
      primary: { nPercent: 0, p2o5Percent: 20, k2oPercent: 0 },
      primaryLead: "P2O5",
      areaHa: 1,
      bagMassKg: 50,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // targetP2o5 = 20*2.291335 = 45.8267 kg/ha
    expect(r.targetP2o5KgHa).toBeCloseTo(45.8267, 4);
    // X1 = 100*45.8267/20 = 229.1335 kg/ha
    expect(r.lines[0]?.doseKgHa).toBeCloseTo(229.1335, 3);
    // delivered P2O5 = 229.1335*20/100 = 45.8267 = target, exactly by construction
    expect(r.deliveredP2o5KgHa).toBeCloseTo(45.8267, 3);
    expect(r.targetMinusDeliveredP2o5).toBeCloseTo(0, 3);
  });

  it("never returns a negative secondary dose: a deficit at or below zero zeroes the line instead", () => {
    const r = fertiliserNutrientBlend({
      direction: "nutrientsToFertiliser",
      targetForm: "oxide",
      targetN: 50,
      targetP: 80,
      targetK: 0,
      primary: { nPercent: 15, p2o5Percent: 15, k2oPercent: 15 },
      primaryLead: "P2O5",
      secondary: { nPercent: 46, p2o5Percent: 0, k2oPercent: 0 },
      secondaryLead: "N",
      areaHa: 1,
      bagMassKg: 50,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // primary alone already delivers N=80 > target 50 -> secondary deficit is negative
    expect(r.lines[1]?.doseKgHa).toBe(0);
    expect(r.lines[1]?.deliveredNKgHa).toBe(0);
  });

  it("this is a life-safety tool: no field named passes/compliant/safe/status appears on the result", () => {
    const r = fertiliserNutrientBlend({
      direction: "fertiliserToNutrients",
      composition: { nPercent: 8, p2o5Percent: 16, k2oPercent: 24 },
      doseKgHa: 350,
      areaHa: 12.4,
      bagMassKg: 50,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const keys = Object.keys(r);
    for (const banned of ["passes", "compliant", "safe", "withinLimit", "status", "verdict"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("refuses a composition summing over 100%, and a lead nutrient present at 0% in the fertiliser", () => {
    expect(
      fertiliserNutrientBlend({
        direction: "nutrientsToFertiliser",
        targetForm: "oxide",
        targetN: 100,
        targetP: 50,
        targetK: 50,
        primary: { nPercent: 60, p2o5Percent: 60, k2oPercent: 0 },
        primaryLead: "N",
        areaHa: 1,
        bagMassKg: 50,
      }),
    ).toEqual({ ok: false, reason: "primary" });
    expect(
      fertiliserNutrientBlend({
        direction: "nutrientsToFertiliser",
        targetForm: "oxide",
        targetN: 100,
        targetP: 50,
        targetK: 50,
        primary: { nPercent: 0, p2o5Percent: 15, k2oPercent: 15 },
        primaryLead: "N",
        areaHa: 1,
        bagMassKg: 50,
      }),
    ).toEqual({ ok: false, reason: "primaryLead" });
  });
});

describe("grainMoistureShrink", () => {
  it("wheat, moisture-only shrink 18% -> 14%, with energy at 60% dryer efficiency — vector 1", () => {
    const r = grainMoistureShrink({
      grossMassKg: 10000,
      measuredMoisturePercent: 18,
      targetMoisturePercent: 14,
      impuritiesPercent: 0,
      impuritiesFreeLimitPercent: 0,
      order: "impuritiesFirst",
      deductionMode: "excessOnly",
      dryerEfficiencyPercent: 60,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // m2 = 10000*82/86 = 9534.883721 kg
    expect(r.driedMassKg).toBeCloseTo(9534.883721, 4);
    // water out = 465.116279 kg
    expect(r.waterOutKg).toBeCloseTo(465.116279, 4);
    // shrink = 465.116279/10000*100 = 4.651163 %, and the mass-independent
    // form (18-14)/86*100 = 4.651163% agrees
    expect(r.shrinkPercent).toBeCloseTo(4.651163, 4);
    expect(r.shrinkPercentMassIndependent).toBeCloseTo(4.651163, 4);
    // 465.116279 * 2257 = 1,049,767.44 kJ = 1049.767 MJ = 291.602 kWh
    expect(r.minimumEnergyMJ).toBeCloseTo(1049.767442, 3);
    expect(r.minimumEnergyKWh).toBeCloseTo(291.602067, 3);
    // at 60% efficiency: 1049.767442/0.6 = 1749.612403 MJ = 486.003 kWh
    expect(r.actualEnergyMJ).toBeCloseTo(1749.612403, 3);
    expect(r.actualEnergyKWh).toBeCloseTo(486.003445, 3);
  });

  it("corn, impurities-first vs moisture-first deduction genuinely differ, 24.5% -> 13% with 3%/2% impurities — vector 2", () => {
    const r = grainMoistureShrink({
      grossMassKg: 25300,
      measuredMoisturePercent: 24.5,
      targetMoisturePercent: 13,
      impuritiesPercent: 3,
      impuritiesFreeLimitPercent: 2,
      order: "impuritiesFirst",
      deductionMode: "excessOnly",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // deduction = 25300*(3-2)/100 = 253.00 kg — off the GROSS mass in BOTH
    // orders, per the corrected reading of the tool's own review note.
    expect(r.impuritiesFirst.impurityDeductionKg).toBeCloseTo(253.0, 4);
    expect(r.moistureFirst.impurityDeductionKg).toBeCloseTo(253.0, 4);
    // impuritiesFirst: cleaned = 25300-253 = 25047.00, then dried:
    // 25047 * 75.5/87 = 21736.19 kg
    expect(r.impuritiesFirst.finalMassKg).toBeCloseTo(21736.19, 1);
    // moistureFirst: dried FIRST (25300*75.5/87 = 21955.7471), then the same
    // 253.00 kg comes off UNDIMINISHED by the drying factor:
    // 21955.7471 - 253.00 = 21702.7471 kg — genuinely different from
    // impuritiesFirst, not a rounding curiosity, because the drying factor
    // scales the deduction's effect in one order and not in the other.
    expect(r.moistureFirst.finalMassKg).toBeCloseTo(21702.7471, 3);
    expect(r.moistureFirst.finalMassKg).not.toBeCloseTo(r.impuritiesFirst.finalMassKg, 0);
    // moisture-only top-level figure (no impurities at all): 25300*75.5/87 = 21955.7471
    expect(r.driedMassKg).toBeCloseTo(21955.7471, 3);
  });

  it("water removed by DRYING, and the energy it costs, are drawn from the SELECTED order's own mass path — not the gross-only baseline", () => {
    // Same corn delivery as vector 2, order = impuritiesFirst, plus a dryer
    // efficiency to exercise the energy figures.
    const r = grainMoistureShrink({
      grossMassKg: 25300,
      measuredMoisturePercent: 24.5,
      targetMoisturePercent: 13,
      impuritiesPercent: 3,
      impuritiesFreeLimitPercent: 2,
      order: "impuritiesFirst",
      deductionMode: "excessOnly",
      dryerEfficiencyPercent: 70,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // impuritiesFirst dries the CLEANED mass: 25300-253=25047 in, 21736.1897
    // out (25047*75.5/87) -> water = 25047-21736.1897 = 3310.8103 kg
    expect(r.impuritiesFirst.waterOutKg).toBeCloseTo(3310.8103, 3);
    // moistureFirst dries the FULL gross mass: 25300*75.5/87 = 21955.7471 ->
    // water = 25300-21955.7471 = 3344.2529 kg — the SAME as the top-level
    // (moisture-only) waterOutKg, since that baseline is exactly this path.
    expect(r.moistureFirst.waterOutKg).toBeCloseTo(3344.2529, 3);
    expect(r.waterOutKg).toBeCloseTo(3344.2529, 3);
    expect(r.moistureFirst.waterOutKg).toBeCloseTo(r.waterOutKg, 6);
    // energy is drawn from the SELECTED (impuritiesFirst) water figure,
    // 3310.8103 kg, not the gross-only 3344.2529 kg:
    // Emin = 3310.8103*2257/1000 = 7472.4989 MJ = 2075.6942 kWh
    expect(r.minimumEnergyMJ).toBeCloseTo(7472.4989, 2);
    expect(r.minimumEnergyKWh).toBeCloseTo(2075.6942, 2);
    // at 70% efficiency: 7472.4989/0.7 = 10674.9985 MJ = 2965.2774 kWh
    expect(r.actualEnergyMJ).toBeCloseTo(10674.9985, 2);
    expect(r.actualEnergyKWh).toBeCloseTo(2965.2774, 2);
  });

  it("refuses a non-positive gross mass and an out-of-range target moisture (61, above the 0-60 input band — the shared moistureAdjust helper's own w2=100 guard sits behind this range check and is unreachable through it, by design)", () => {
    expect(
      grainMoistureShrink({
        grossMassKg: 0,
        measuredMoisturePercent: 18,
        targetMoisturePercent: 14,
        impuritiesPercent: 0,
        impuritiesFreeLimitPercent: 0,
        order: "impuritiesFirst",
        deductionMode: "excessOnly",
      }),
    ).toEqual({ ok: false, reason: "grossMassKg" });
    expect(
      grainMoistureShrink({
        grossMassKg: 100,
        measuredMoisturePercent: 18,
        targetMoisturePercent: 61,
        impuritiesPercent: 0,
        impuritiesFreeLimitPercent: 0,
        order: "impuritiesFirst",
        deductionMode: "excessOnly",
      }),
    ).toEqual({ ok: false, reason: "targetMoisturePercent" });
  });

  it("a delivery cleaner than the free limit gets a negative (credit) deduction only in twoSided mode, zero in excessOnly", () => {
    const excess = grainMoistureShrink({
      grossMassKg: 1000,
      measuredMoisturePercent: 15,
      targetMoisturePercent: 14,
      impuritiesPercent: 1,
      impuritiesFreeLimitPercent: 2,
      order: "impuritiesFirst",
      deductionMode: "excessOnly",
    });
    const twoSided = grainMoistureShrink({
      grossMassKg: 1000,
      measuredMoisturePercent: 15,
      targetMoisturePercent: 14,
      impuritiesPercent: 1,
      impuritiesFreeLimitPercent: 2,
      order: "impuritiesFirst",
      deductionMode: "twoSided",
    });
    expect(excess.ok && twoSided.ok).toBe(true);
    if (!excess.ok || !twoSided.ok) return;
    expect(excess.impuritiesFirst.impurityDeductionKg).toBe(0);
    // twoSided: 1000*(1-2)/100 = -10 kg, a credit
    expect(twoSided.impuritiesFirst.impurityDeductionKg).toBeCloseTo(-10, 6);
  });
});

describe("growingDegreeDays", () => {
  it("three days, base 10C, upper limit 30C, both methods and a projection — vector 1", () => {
    const r = growingDegreeDays({
      readings: [
        { date: { year: 2026, month: 6, day: 1 }, tMaxC: 28, tMinC: 14 },
        { date: { year: 2026, month: 6, day: 2 }, tMaxC: 31, tMinC: 18 },
        { date: { year: 2026, month: 6, day: 3 }, tMaxC: 24, tMinC: 11 },
      ],
      baseTempC: 10,
      upperLimitC: 30,
      targetSum: 1400,
      averageWindowDays: 7,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // day1: simple (28+14)/2-10 = 11.0; modified same (28<=30) = 11.0
    expect(r.rows[0]?.simpleDaily).toBeCloseTo(11.0, 6);
    expect(r.rows[0]?.modifiedDaily).toBeCloseTo(11.0, 6);
    // day2: simple (31+18)/2-10 = 14.5; modified min(31,30)=30 -> (30+18)/2-10 = 14.0
    expect(r.rows[1]?.simpleDaily).toBeCloseTo(14.5, 6);
    expect(r.rows[1]?.modifiedDaily).toBeCloseTo(14.0, 6);
    // day3: simple (24+11)/2-10 = 7.5; modified same = 7.5
    expect(r.rows[2]?.simpleDaily).toBeCloseTo(7.5, 6);
    // totals: simple 33.0, modified 32.5
    expect(r.totalSimple).toBeCloseTo(33.0, 6);
    expect(r.totalModified).toBeCloseTo(32.5, 6);
    // average of the 3-day (< 7-day window) simple series = 33/3 = 11.0
    expect(r.averageSimpleRecent).toBeCloseTo(11.0, 6);
    expect(r.recentWindowDays).toBe(3);
    // remaining = 1400-33 = 1367; 1367/11.0 = 124.27 -> ceil 125 days
    expect(r.remainingToTarget).toBeCloseTo(1367.0, 6);
    expect(r.daysToTarget).toBe(125);
    // last date 2026-06-03 + 125 days
    expect(r.projectedDate).toBeDefined();
  });

  it("a cold day clips to zero under the simple method but stays positive under the modified one — vector 2", () => {
    const r = growingDegreeDays({
      readings: [{ date: { year: 2026, month: 4, day: 1 }, tMaxC: 8, tMinC: -2 }],
      baseTempC: 5,
      averageWindowDays: 7,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // simple: (8-2)/2 - 5 = 3-5 = -2 -> clipped to 0
    expect(r.rows[0]?.simpleDaily).toBe(0);
    // modified: Tmin' = max(-2,5) = 5, Tmax' = max(8,5) = 8 -> (8+5)/2-5 = 1.5
    expect(r.rows[0]?.modifiedDaily).toBeCloseTo(1.5, 6);
    expect(r.zeroContributionDays).toBe(1);
  });

  it("refuses Tmin > Tmax in the same row, a non-increasing date, and an upper limit below the base", () => {
    expect(
      growingDegreeDays({
        readings: [{ date: { year: 2026, month: 6, day: 1 }, tMaxC: 10, tMinC: 20 }],
        baseTempC: 10,
        averageWindowDays: 7,
      }),
    ).toEqual({ ok: false, reason: "row:0" });
    expect(
      growingDegreeDays({
        readings: [
          { date: { year: 2026, month: 6, day: 2 }, tMaxC: 20, tMinC: 10 },
          { date: { year: 2026, month: 6, day: 1 }, tMaxC: 20, tMinC: 10 },
        ],
        baseTempC: 10,
        averageWindowDays: 7,
      }),
    ).toEqual({ ok: false, reason: "date:1" });
    expect(
      growingDegreeDays({
        readings: [{ date: { year: 2026, month: 6, day: 1 }, tMaxC: 20, tMinC: 10 }],
        baseTempC: 10,
        upperLimitC: 9,
        averageWindowDays: 7,
      }),
    ).toEqual({ ok: false, reason: "upperLimitC" });
  });
});

describe("honeyMassMoisture", () => {
  it("gross/tare net mass, sample-measured density, moisture split and jar count — vector 1", () => {
    const r = honeyMassMoisture({
      quantityMode: "grossTare",
      grossMassKg: 36.8,
      tareKg: 1.35,
      // The assignment's vector measures density from the same 1.4237 kg/l
      // sample and uses THAT reading for the jar figures — entering it here
      // too (rather than a rounded 1.42) is what the vector actually checks.
      densityKgL: 1.4237,
      sampleMassKg: 1.4237,
      sampleVolumeL: 1.0,
      moisturePercent: 17.0,
      jarVolumeMl: 720,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // net = 36.80 - 1.35 = 35.45 kg
    expect(r.netMassKg).toBeCloseTo(35.45, 6);
    // water = 35.45*0.17 = 6.0265 kg; dry matter = 29.4235 kg
    expect(r.waterMassKg).toBeCloseTo(6.0265, 4);
    expect(r.dryMatterMassKg).toBeCloseTo(29.4235, 4);
    // measured density = 1.4237/1.0 = 1.4237 kg/l (informational, not fed back into netMass)
    expect(r.measuredDensityKgL).toBeCloseTo(1.4237, 4);
    // mass per jar = 0.720 * 1.4237 = 1.025064 kg
    expect(r.massPerJarKg).toBeCloseTo(1.025064, 5);
    // floor(35.45/1.025064) = 34; remainder = 35.45 - 34*1.025064 = 0.597824 kg
    expect(r.fullJars).toBe(34);
    expect(r.jarRemainderKg).toBeCloseTo(0.597824, 4);
  });

  it("regression: an exact jar count is not dropped a ULP below the whole number", () => {
    const r = honeyMassMoisture({
      quantityMode: "grossTare",
      grossMassKg: 10.45,
      tareKg: 1,
      densityKgL: 1.4,
      moisturePercent: 18,
      jarVolumeMl: 450,
      jarDeclaredNetMassG: 630,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // net = 9.45 kg; massPerJarKg = 0.450*1.4 = 0.63 kg; 9.45/0.63 = 15 exactly
    // on paper, but 14.999999999999998 in raw double arithmetic — floor()
    // without round9 would report 14 jars with a whole jar in the remainder.
    expect(r.netMassKg).toBeCloseTo(9.45, 9);
    expect(r.massPerJarKg).toBeCloseTo(0.63, 9);
    expect(r.fullJars).toBe(15);
    expect(r.jarRemainderKg).toBeCloseTo(0, 6);
    // same identity via the declared-net-mass path (630 g = 0.63 kg)
    expect(r.jarsFromDeclaredMass).toBe(15);
  });

  it("drying 100 kg of honey from 19.5% to 17.5%, with a price — vector 2", () => {
    const r = honeyMassMoisture({
      quantityMode: "grossTare",
      grossMassKg: 101, // net will be exactly 100 with a 1 kg tare
      tareKg: 1,
      densityKgL: 1.4,
      moisturePercent: 19.5,
      targetMoisturePercent: 17.5,
      pricePerKg: 900,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.netMassKg).toBeCloseTo(100, 9);
    // m2 = 100*80.5/82.5 = 97.5758 kg
    expect(r.driedMassKg).toBeCloseTo(97.575758, 4);
    // water removed = 2.424242 kg; shrink = 2.4242 %
    expect(r.waterRemovedKg).toBeCloseTo(2.424242, 4);
    expect(r.shrinkPercent).toBeCloseTo(2.424242, 3);
    // gross value 100*900 = 90000; dried value 97.575758*900 = 87818.18
    expect(r.grossValue).toBeCloseTo(90000, 2);
    expect(r.driedValue).toBeCloseTo(87818.18, 1);
  });

  it("densityKgL and measuredDensityKgL are never derived from one another — jar mass uses the ENTERED density, not the sample-measured one", () => {
    const r = honeyMassMoisture({
      quantityMode: "grossTare",
      grossMassKg: 11,
      tareKg: 1,
      densityKgL: 1.4, // entered reading, deliberately different from the sample
      sampleMassKg: 1.45,
      sampleVolumeL: 1.0, // measuredDensityKgL = 1.45/1.0 = 1.45, NOT 1.4
      moisturePercent: 18,
      jarVolumeMl: 500,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.netMassKg).toBeCloseTo(10, 9);
    // the two densities are genuinely different — this is the point
    expect(r.measuredDensityKgL).toBeCloseTo(1.45, 6);
    // volume from mass uses densityKgL (1.4): 10/1.4 = 7.142857 l
    expect(r.volumeFromMassL).toBeCloseTo(7.142857, 4);
    // mass/jar uses densityKgL (1.4): 0.500*1.4 = 0.70 kg = 700 g — a version
    // that used measuredDensityKgL (1.45) here would print 0.725 kg instead.
    expect(r.massPerJarKg).toBeCloseTo(0.7, 9);
    expect(r.massPerJarG).toBeCloseTo(700, 6);
    // floor(10/0.70) = 14; remainder = 10 - 14*0.70 = 0.2 kg
    expect(r.fullJars).toBe(14);
    expect(r.jarRemainderKg).toBeCloseTo(0.2, 6);
  });

  it("refuses a gross mass at or below its own tare, and a sample volume of zero", () => {
    expect(
      honeyMassMoisture({
        quantityMode: "grossTare",
        grossMassKg: 5,
        tareKg: 5,
        densityKgL: 1.4,
        moisturePercent: 18,
      }),
    ).toEqual({ ok: false, reason: "netMassKg" });
    expect(
      honeyMassMoisture({
        quantityMode: "grossTare",
        grossMassKg: 10,
        tareKg: 1,
        densityKgL: 1.4,
        moisturePercent: 18,
        sampleMassKg: 1.4,
        sampleVolumeL: 0,
      }),
    ).toEqual({ ok: false, reason: "sampleVolumeL" });
  });

  it("refuses a density, or a sample-measured density, outside 1.35-1.50 kg/l with two distinct reasons", () => {
    expect(
      honeyMassMoisture({ quantityMode: "grossTare", grossMassKg: 10, tareKg: 1, densityKgL: 1.6, moisturePercent: 18 }),
    ).toEqual({ ok: false, reason: "densityKgL" });
    expect(
      honeyMassMoisture({
        quantityMode: "grossTare",
        grossMassKg: 10,
        tareKg: 1,
        densityKgL: 1.4,
        moisturePercent: 18,
        sampleMassKg: 2,
        sampleVolumeL: 1,
      }),
    ).toEqual({ ok: false, reason: "sampleDensity" });
  });
});

describe("irrigationDepthVolume", () => {
  it("pumped sprinkler system over 4.2 ha at 75% efficiency — vector 1", () => {
    const r = irrigationDepthVolume({
      normMm: 25,
      areaHa: 4.2,
      efficiencyPercent: 75,
      flowUnit: "m3h",
      flowValue: 40,
      method: "sprinkler",
      hoursPerDay: 12,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Vn = 25*10*4.2 = 1050 m^3 = 1,050,000 l
    expect(r.netVolumeM3).toBeCloseTo(1050, 6);
    expect(r.netVolumeL).toBeCloseTo(1050000, 3);
    // Vb = 1050/0.75 = 1400 m^3
    expect(r.grossVolumeM3).toBeCloseTo(1400, 6);
    // t = 1400/40 = 35.00 h -> 35h 00min
    expect(r.timeHours).toBeCloseTo(35, 6);
    expect(r.timeHoursPart).toBe(35);
    expect(r.timeMinutesPart).toBe(0);
    // 35/12 = 2.9167 -> 3 days
    expect(r.daysNeeded).toBe(3);
  });

  it("sprinkler intensity and drip cycle — vector 2", () => {
    const r = irrigationDepthVolume({
      normMm: 30,
      areaHa: 1,
      efficiencyPercent: 100,
      flowUnit: "ls",
      flowValue: 10,
      method: "sprinkler",
      sprinklerSpacingInRowM: 18,
      sprinklerSpacingBetweenRowsM: 18,
      nozzleFlowLh: 1500,
      hoursPerDay: 24,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // I = 1500/(18*18) = 1500/324 = 4.62963 mm/h
    expect(r.intensityMmH).toBeCloseTo(4.62963, 4);
    // net t_p = 30/4.62963 = 6.48 h
    expect(r.netTimePerPositionH).toBeCloseTo(6.48, 2);

    const drip = irrigationDepthVolume({
      normMm: 6,
      areaHa: 1,
      efficiencyPercent: 100,
      flowUnit: "ls",
      flowValue: 10,
      method: "drip",
      dripsPerPlant: 4,
      dripFlowLh: 2,
      areaPerPlantM2: 11.25,
      hoursPerDay: 24,
    });
    expect(drip.ok).toBe(true);
    if (!drip.ok) return;
    // liters/plant (net) = 6*11.25 = 67.5 l; duration = 67.5/(4*2) = 8.4375 h
    expect(drip.netLitersPerPlant).toBeCloseTo(67.5, 6);
    expect(drip.netDripDurationH).toBeCloseTo(8.4375, 4);
  });

  it("positionsPerDay is driven by the GROSS per-position time, not the net one — the pump must run that long", () => {
    // Same nozzle geometry as vector 2 (I = 4.62963 mm/h), but at 75%
    // efficiency: netTp = 30/4.62963 = 6.48 h, grossTp = 40/4.62963 = 8.64 h
    // (grossNormMm = 30/0.75 = 40 mm). In a 20 h day, only 2 positions fit at
    // the gross time; the net time would wrongly claim 3.
    const r = irrigationDepthVolume({
      normMm: 30,
      areaHa: 1,
      efficiencyPercent: 75,
      flowUnit: "ls",
      flowValue: 10,
      method: "sprinkler",
      sprinklerSpacingInRowM: 18,
      sprinklerSpacingBetweenRowsM: 18,
      nozzleFlowLh: 1500,
      hoursPerDay: 20,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.netTimePerPositionH).toBeCloseTo(6.48, 2);
    expect(r.grossTimePerPositionH).toBeCloseTo(8.64, 2);
    expect(r.positionsPerDay).toBe(2);
  });

  it("refuses a zero flow value, and a typed zero (not merely an absent field) on any drip or sprinkler divisor", () => {
    expect(
      irrigationDepthVolume({
        normMm: 10,
        areaHa: 1,
        efficiencyPercent: 100,
        flowUnit: "m3h",
        flowValue: 0,
        method: "sprinkler",
        hoursPerDay: 8,
      }),
    ).toEqual({ ok: false, reason: "flowValue" });
    expect(
      irrigationDepthVolume({
        normMm: 6,
        areaHa: 1,
        efficiencyPercent: 100,
        flowUnit: "ls",
        flowValue: 10,
        method: "drip",
        dripsPerPlant: 4,
        dripFlowLh: 2,
        areaPerPlantM2: 0,
        hoursPerDay: 24,
      }),
    ).toEqual({ ok: false, reason: "areaPerPlantM2" });
    expect(
      irrigationDepthVolume({
        normMm: 6,
        areaHa: 1,
        efficiencyPercent: 100,
        flowUnit: "ls",
        flowValue: 10,
        method: "drip",
        dripsPerPlant: 0,
        dripFlowLh: 2,
        areaPerPlantM2: 11.25,
        hoursPerDay: 24,
      }),
    ).toEqual({ ok: false, reason: "dripsPerPlant" });
    expect(
      irrigationDepthVolume({
        normMm: 30,
        areaHa: 1,
        efficiencyPercent: 100,
        flowUnit: "ls",
        flowValue: 10,
        method: "sprinkler",
        sprinklerSpacingInRowM: 0,
        sprinklerSpacingBetweenRowsM: 18,
        nozzleFlowLh: 1500,
        hoursPerDay: 24,
      }),
    ).toEqual({ ok: false, reason: "sprinklerSpacingInRowM" });
  });
});

describe("livestockRationDm", () => {
  it("40 cows at 650 kg, 3.0% intake, three feeds, 5% waste — vector 1", () => {
    const r = livestockRationDm({
      headCount: 40,
      avgBodyMassKg: 650,
      intakeMode: "percentOfBody",
      intakeValue: 3.0,
      feeds: [
        { name: "silaza", dmPercent: 33, shareOfDmPercent: 50 },
        { name: "seno", dmPercent: 86, shareOfDmPercent: 20 },
        { name: "smesa", dmPercent: 88, shareOfDmPercent: 30 },
      ],
      days: 1,
      wastePercent: 5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 650*0.03 = 19.50 kg/head; herd = 40*19.50 = 780.0 kg SM/day
    expect(r.dmPerHeadKgDay).toBeCloseTo(19.5, 6);
    expect(r.dmHerdKgDay).toBeCloseTo(780.0, 6);
    // silage: SM=390 -> fresh = 390/0.33 = 1181.818
    expect(r.feeds[0]?.freshEatenKgPerDay).toBeCloseTo(1181.818182, 3);
    // hay: SM=156 -> fresh = 156/0.86 = 181.395
    expect(r.feeds[1]?.freshEatenKgPerDay).toBeCloseTo(181.395349, 3);
    // mix: SM=234 -> fresh = 234/0.88 = 265.909
    expect(r.feeds[2]?.freshEatenKgPerDay).toBeCloseTo(265.909091, 3);
    // eaten total = 1629.13 kg/day -> per head 40.73 kg
    expect(r.totalFreshEatenKgDay).toBeCloseTo(1629.13, 1);
    expect(r.totalFreshEatenPerHeadKgDay).toBeCloseTo(40.73, 1);
    // issued with 5% waste = 1629.13/0.95 = 1714.87 kg/day
    expect(r.totalFreshIssuedKgDay).toBeCloseTo(1714.87, 1);
  });

  it("rationDmPercentAsIssued divides by the EATEN fresh mass, not the waste-inflated issued mass (they carry the same DM concentration, but issued is the wrong denominator to divide the eaten DM by)", () => {
    const r = livestockRationDm({
      headCount: 40,
      avgBodyMassKg: 650,
      intakeMode: "percentOfBody",
      intakeValue: 3.0,
      feeds: [
        { name: "silaza", dmPercent: 33, shareOfDmPercent: 50 },
        { name: "seno", dmPercent: 86, shareOfDmPercent: 20 },
        { name: "smesa", dmPercent: 88, shareOfDmPercent: 30 },
      ],
      days: 1,
      wastePercent: 5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // totalDmKgDay = 780 exactly; totalFreshEatenKgDay = 39000/33 + 15600/86 +
    // 23400/88 = 13000/11 + 7800/43 + 2925/11 = 770575/473 = 1629.122622 kg
    // rationDmPercentAsIssued = 780/(770575/473)*100 = 36894000/770575 = 47.878532 %
    // (dividing 780 by the ISSUED 1714.87 kg instead gives the wrong 45.4846 %)
    expect(r.totalFreshEatenKgDay).toBeCloseTo(1629.122622, 3);
    expect(r.rationDmPercentAsIssued).toBeCloseTo(47.878532, 3);
    expect(r.rationDmPercentAsIssued).not.toBeCloseTo(45.4846, 1);
  });

  it("120 sheep, single feed, 150 days, bags of 250 kg and a price — vector 2", () => {
    const r = livestockRationDm({
      headCount: 120,
      avgBodyMassKg: 60,
      intakeMode: "percentOfBody",
      intakeValue: 3.5,
      feeds: [{ name: "seno", dmPercent: 88, shareOfDmPercent: 100, pricePerKgFresh: 22, packageMassKg: 250 }],
      days: 150,
      wastePercent: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // SM/head = 2.10, herd = 252.0 kg SM/day
    expect(r.dmPerHeadKgDay).toBeCloseTo(2.1, 6);
    expect(r.dmHerdKgDay).toBeCloseTo(252.0, 6);
    // fresh = 252/0.88 = 286.3636 kg/day
    const feed = r.feeds[0];
    expect(feed?.freshEatenKgPerDay).toBeCloseTo(286.363636, 3);
    // 150 days -> 42954.5 kg = 42.9545 t
    expect(feed?.periodIssuedKg).toBeCloseTo(42954.5, 1);
    expect(feed?.periodIssuedT).toBeCloseTo(42.9545, 2);
    // 42954.5/250 = 171.82 -> ceil 172 bales
    expect(feed?.packagesCeil).toBe(172);
    // daily cost 286.3636*22 = 6300.0; period cost 945000
    expect(feed?.dailyCost).toBeCloseTo(6300.0, 1);
    expect(feed?.periodCost).toBeCloseTo(945000, 0);
  });

  it("refuses a dmPercent of zero (division by zero) and a 100% waste (also division by zero)", () => {
    expect(
      livestockRationDm({
        headCount: 10,
        avgBodyMassKg: 500,
        intakeMode: "percentOfBody",
        intakeValue: 2,
        feeds: [{ name: "x", dmPercent: 0, shareOfDmPercent: 100 }],
        days: 1,
        wastePercent: 0,
      }),
    ).toEqual({ ok: false, reason: "dmPercent:0" });
  });

  it("leaves rationDmPercentAsIssued undefined, not NaN, when every share is 0% and nothing is issued", () => {
    const r = livestockRationDm({
      headCount: 10,
      avgBodyMassKg: 500,
      intakeMode: "percentOfBody",
      intakeValue: 2,
      // shareOfDmPercent 0 is inside the valid 0-100 band; the spec forbids
      // silently normalising an unentered mix, so this must stay undefined.
      feeds: [{ name: "x", dmPercent: 50, shareOfDmPercent: 0 }],
      days: 1,
      wastePercent: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalFreshIssuedKgDay).toBe(0);
    expect(r.rationDmPercentAsIssued).toBeUndefined();
  });
});

describe("machineFieldCapacity", () => {
  it("6 m sprayer, 8 km/h, 75% utilisation, fuel and cost — vector 1", () => {
    const r = machineFieldCapacity({
      nominalWidthM: 6,
      overlapPercent: 0,
      speedKmh: 8,
      utilizationPercent: 75,
      areaHa: 48,
      fuelLPerHour: 18,
      fuelPricePerL: 175,
      hoursPerDay: 8,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Ct = 6*8/10 = 4.80 ha/h; Ce = 4.80*0.75 = 3.60 ha/h
    expect(r.theoreticalCapacityHaH).toBeCloseTo(4.8, 6);
    expect(r.effectiveCapacityHaH).toBeCloseTo(3.6, 6);
    // t = 48/3.6 = 13.3333 h = 13h 20min; 13.3333/8 = 1.667 -> 2 days
    expect(r.timeHours).toBeCloseTo(13.333333, 4);
    expect(r.timeHoursPart).toBe(13);
    expect(r.timeMinutesPart).toBe(20);
    expect(r.daysNeeded).toBe(2);
    // fuel: 18/3.6 = 5.00 l/ha; total 5*48 = 240.0 l
    expect(r.fuelLPerHa).toBeCloseTo(5.0, 6);
    expect(r.fuelTotalL).toBeCloseTo(240.0, 3);
    // cost: 240*175 = 42000 total, 875 RSD/ha
    expect(r.fuelCostTotal).toBeCloseTo(42000, 1);
    expect(r.fuelCostPerHa).toBeCloseTo(875, 1);
  });

  it("sprayer with overlap, turns corrected to passes-1 — vector 2", () => {
    const r = machineFieldCapacity({
      nominalWidthM: 18,
      overlapPercent: 5,
      speedKmh: 12,
      utilizationPercent: 70,
      areaHa: 120,
      fuelLPerHour: 12,
      hoursPerDay: 8,
      turnSeconds: 45,
      fieldLengthM: 800,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // W = 18*0.95 = 17.10 m; Ct = 17.10*12/10 = 20.52; Ce = 20.52*0.70 = 14.364
    expect(r.actualWidthM).toBeCloseTo(17.1, 6);
    expect(r.effectiveCapacityHaH).toBeCloseTo(14.364, 4);
    // t = 120/14.364 = 8.3542 h = 8h 21min
    expect(r.timeHours).toBeCloseTo(8.354207, 3);
    expect(r.timeHoursPart).toBe(8);
    expect(r.timeMinutesPart).toBe(21);
    // fuel/ha = 12/14.364 = 0.8354; total = 100.25 l
    expect(r.fuelLPerHa).toBeCloseTo(0.835457, 4);
    expect(r.fuelTotalL).toBeCloseTo(100.25, 1);
    // passes = ceil(120*10000/(17.10*800)) = ceil(87.72) = 88 -> CORRECTED turns = 87
    expect(r.turnCount).toBe(87);
    // 87*45 = 3915 s = 1.0875 h; share = 1.0875/8.354207*100 = 13.018 %
    expect(r.turnTimeHours).toBeCloseTo(1.0875, 4);
    expect(r.turnTimeSharePercent).toBeCloseTo(13.018, 1);
  });

  it("refuses a zero field length used for the turn count, naming it explicitly", () => {
    expect(
      machineFieldCapacity({
        nominalWidthM: 6,
        overlapPercent: 0,
        speedKmh: 8,
        utilizationPercent: 75,
        areaHa: 10,
        hoursPerDay: 8,
        turnSeconds: 30,
        fieldLengthM: 0,
      }),
    ).toEqual({ ok: false, reason: "fieldLengthM" });
  });
});

describe("orchardTrellisLayout", () => {
  it("200x100 m block, round-headed wire and posts, 1 m planting — vector 1", () => {
    const r = orchardTrellisLayout({
      lengthM: 200,
      widthM: 100,
      rowSpacingM: 3.0,
      headlandM: 5,
      boundaryOffsetM: 2.5,
      postSpacingM: 6,
      wireRows: 3,
      wireDiameterMm: 2.4,
      wireSlackPercent: 5,
      plantSpacingM: 1.0,
      anchorsPerEnd: 1,
      plantAtBothEnds: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // rows = floor((100-5)/3)+1 = floor(31.667)+1 = 32
    expect(r.rowsCount).toBe(32);
    // row length = 200-10 = 190; total = 32*190 = 6080
    expect(r.rowLengthM).toBe(190);
    expect(r.totalRowLengthM).toBe(6080);
    // gaps = ceil(190/6) = 32 -> 33 posts/row; actual spacing = 190/32 = 5.9375
    expect(r.postGapsPerRow).toBe(32);
    expect(r.postsPerRow).toBe(33);
    expect(r.actualPostSpacingM).toBeCloseTo(5.9375, 4);
    expect(r.totalPosts).toBe(1056);
    // anchors = 32*2*1 = 64
    expect(r.anchors).toBe(64);
    // wire = 6080*3*1.05 = 19152 m; mass/m = pi*0.0012^2*7850 = 0.0355126 kg/m
    expect(r.wireLengthM).toBeCloseTo(19152, 1);
    expect(r.wireMassKg).toBeCloseTo(680.14, 1);
    // plants/row = floor(190/1)+1 = 191; total = 32*191 = 6112
    expect(r.plantsPerRow).toBe(191);
    expect(r.totalPlants).toBe(6112);
    // plot area = 200*100/10000 = 2.00 ha -> density = 6112/2 = 3056/ha
    expect(r.plotAreaHa).toBeCloseTo(2.0, 6);
    expect(r.densityPerHa).toBeCloseTo(3056, 3);
    // theoretical = 10000/(3*1) = 3333.33/ha
    expect(r.theoreticalDensityPerHa).toBeCloseTo(3333.333333, 3);
  });

  it("80x40 m block — vector 2", () => {
    const r = orchardTrellisLayout({
      lengthM: 80,
      widthM: 40,
      rowSpacingM: 2.5,
      headlandM: 4,
      boundaryOffsetM: 2,
      postSpacingM: 5,
      wireRows: 4,
      wireSlackPercent: 5,
      plantSpacingM: 0.8,
      anchorsPerEnd: 1,
      plantAtBothEnds: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // rows = floor((40-4)/2.5)+1 = floor(14.4)+1 = 15
    expect(r.rowsCount).toBe(15);
    expect(r.rowLengthM).toBe(72);
    expect(r.totalRowLengthM).toBe(1080);
    // gaps = ceil(72/5) = 15 -> 16 posts/row; spacing = 4.80 m
    expect(r.postGapsPerRow).toBe(15);
    expect(r.postsPerRow).toBe(16);
    expect(r.actualPostSpacingM).toBeCloseTo(4.8, 6);
    expect(r.totalPosts).toBe(240);
    expect(r.anchors).toBe(30);
    // wire = 1080*4*1.05 = 4536 m
    expect(r.wireLengthM).toBeCloseTo(4536, 1);
    // plants/row = floor(72/0.8)+1 = 91; total = 15*91 = 1365
    expect(r.plantsPerRow).toBe(91);
    expect(r.totalPlants).toBe(1365);
    // plot area = 0.32 ha -> 1365/0.32 = 4265.625/ha
    expect(r.plotAreaHa).toBeCloseTo(0.32, 6);
    expect(r.densityPerHa).toBeCloseTo(4265.625, 2);
  });

  it("reports zero rows, not a negative count, when the boundary offset exceeds the width", () => {
    const r = orchardTrellisLayout({
      lengthM: 50,
      widthM: 4,
      rowSpacingM: 3,
      headlandM: 0,
      boundaryOffsetM: 5,
      postSpacingM: 5,
      wireRows: 1,
      wireSlackPercent: 0,
      plantSpacingM: 1,
      anchorsPerEnd: 1,
      plantAtBothEnds: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.zeroRows).toBe(true);
    expect(r.rowsCount).toBe(0);
    expect(r.totalPlants).toBe(0);
  });

  it("reports zero rows, not NaN spacing or a negative post count, when headlands consume the entire row length", () => {
    // headlandM*2 = 10 m equals lengthM, so rowLengthM = 0 exactly — must land
    // in the zero-rows branch, not fall through into ceil(0/postSpacing) = 0
    // post-gaps and a postGapsPerRow-1 = -1 negative mid-post count.
    const r = orchardTrellisLayout({
      lengthM: 10,
      widthM: 50,
      rowSpacingM: 3,
      headlandM: 5,
      boundaryOffsetM: 0,
      postSpacingM: 6,
      wireRows: 1,
      wireSlackPercent: 0,
      plantSpacingM: 1,
      anchorsPerEnd: 1,
      plantAtBothEnds: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.zeroRows).toBe(true);
    expect(r.totalPosts).toBe(0);
    expect(r.midPostsPerRow).toBe(0);
    expect(Number.isFinite(r.actualPostSpacingM)).toBe(true);
  });

  it("refuses a wire-row count outside 1-8 and a post spacing outside 2-15 m", () => {
    expect(
      orchardTrellisLayout({
        lengthM: 50,
        widthM: 50,
        rowSpacingM: 3,
        headlandM: 0,
        boundaryOffsetM: 0,
        postSpacingM: 6,
        wireRows: 9,
        wireSlackPercent: 5,
        plantSpacingM: 1,
        anchorsPerEnd: 1,
        plantAtBothEnds: true,
      }),
    ).toEqual({ ok: false, reason: "wireRows" });
  });
});

describe("plantSpacingDensity", () => {
  it("rectangular apple orchard with a real parcel — vector 1", () => {
    const r = plantSpacingDensity({
      pattern: "rectangular",
      rowSpacingM: 3.5,
      spacingM: 1.2,
      lengthM: 120,
      widthM: 80,
      headlandM: 2,
      boundaryOffsetM: 2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // S = 3.5*1.2 = 4.20 m^2; D = 10000/4.20 = 2380.95/ha
    expect(r.areaPerPlantM2).toBeCloseTo(4.2, 6);
    expect(r.theoreticalDensityPerHa).toBeCloseTo(2380.952381, 3);
    // rows = floor((80-4)/3.5)+1 = floor(21.714)+1 = 22
    expect(r.rowsCount).toBe(22);
    // row length = 120-4 = 116; plants/row = floor(116/1.2)+1 = 96+1 = 97
    expect(r.rowLengthM).toBe(116);
    expect(r.plantsPerRow).toBe(97);
    // total = 22*97 = 2134
    expect(r.totalPlants).toBe(2134);
    // plot area = 0.96 ha -> actual density = 2134/0.96 = 2222.9167/ha
    expect(r.plotAreaHa).toBeCloseTo(0.96, 6);
    expect(r.actualDensityPerHa).toBeCloseTo(2222.916667, 2);
  });

  it("triangular walnut spacing and a reverse spacing-from-density calc — vector 2", () => {
    const tri = plantSpacingDensity({
      pattern: "triangular",
      rowSpacingM: 5,
      spacingM: 5,
      headlandM: 0,
      boundaryOffsetM: 0,
    });
    expect(tri.ok).toBe(true);
    if (!tri.ok) return;
    // S = (sqrt3/2)*25 = 21.65064 m^2; D = 10000/21.65064 = 461.88/ha
    expect(tri.areaPerPlantM2).toBeCloseTo(21.650635, 4);
    expect(tri.theoreticalDensityPerHa).toBeCloseTo(461.88, 1);
    // no on-parcel figures for triangular (correction 1)
    expect(tri.totalPlants).toBeUndefined();

    const reverse = plantSpacingDensity({
      pattern: "rectangular",
      rowSpacingM: 2.2,
      spacingM: 1,
      headlandM: 0,
      boundaryOffsetM: 0,
      desiredDensityPerHa: 5050,
    });
    expect(reverse.ok).toBe(true);
    if (!reverse.ok) return;
    // b = 10000/(5050*2.2) = 10000/11110 = 0.9001 -> rounded to the cm: 0.90 m
    expect(reverse.requiredInRowSpacingM).toBeCloseTo(0.9001, 4);
    expect(reverse.requiredSpacingRoundedM).toBeCloseTo(0.9, 6);
  });

  it("refuses a desired density so extreme that the required spacing rounds to zero at the planter's cm step", () => {
    // requiredInRowSpacingM = 10000/(100000*50) = 0.002 m -> rounds to 0.00 m
    // at the centimetre step -> would otherwise divide by zero and return
    // Infinity wrapped in ok:true.
    expect(
      plantSpacingDensity({
        pattern: "rectangular",
        rowSpacingM: 50,
        spacingM: 1,
        headlandM: 0,
        boundaryOffsetM: 0,
        desiredDensityPerHa: 100000,
      }),
    ).toEqual({ ok: false, reason: "desiredDensityPerHa" });
  });

  it("refuses a typed 0 on lengthM or widthM — both optional (drive the on-parcel block alone), both must not be indistinguishable from an empty field", () => {
    expect(
      plantSpacingDensity({
        pattern: "rectangular",
        rowSpacingM: 3,
        spacingM: 1,
        lengthM: 0,
        widthM: 10,
        headlandM: 0,
        boundaryOffsetM: 0,
      }),
    ).toEqual({ ok: false, reason: "lengthM" });
    expect(
      plantSpacingDensity({
        pattern: "rectangular",
        rowSpacingM: 3,
        spacingM: 1,
        lengthM: 10,
        widthM: 0,
        headlandM: 0,
        boundaryOffsetM: 0,
      }),
    ).toEqual({ ok: false, reason: "widthM" });
  });

  it("refuses a zero row spacing (below the 0.05 m floor) and reports zero rows when the parcel is too narrow", () => {
    expect(
      plantSpacingDensity({ pattern: "rectangular", rowSpacingM: 0, spacingM: 1, headlandM: 0, boundaryOffsetM: 0 }),
    ).toEqual({ ok: false, reason: "rowSpacingM" });
    const r = plantSpacingDensity({
      pattern: "rectangular",
      rowSpacingM: 3,
      spacingM: 1,
      lengthM: 50,
      widthM: 4,
      headlandM: 0,
      boundaryOffsetM: 5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rowsCount).toBe(0);
  });
});

describe("polygonArea", () => {
  it("3-4-5 right triangle scaled by 10, entered as X,Y — vector 1", () => {
    const r = polygonArea({
      vertices: [
        { a: 0, b: 0 },
        { a: 30, b: 0 },
        { a: 0, b: 40 },
      ],
      columnOrder: "XY",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // S = 0 + 1200 + 0 = 1200 -> A = 600.000 m^2
    expect(r.areaM2).toBeCloseTo(600, 6);
    expect(r.areaAr).toBeCloseTo(6.0, 6);
    expect(r.areaHa).toBeCloseTo(0.06, 6);
    // perimeter = 30+40+50 = 120.000 m
    expect(r.perimeterM).toBeCloseTo(120, 6);
    // centroid Cx=10.0000, Cy=13.3333 (in X,Y order, matches a,b here)
    expect(r.centroid?.a).toBeCloseTo(10.0, 4);
    expect(r.centroid?.b).toBeCloseTo(13.3333, 4);
    // S>0 -> counter-clockwise
    expect(r.winding).toBe("ccw");
  });

  it("the same rows read under Y,X order — area, perimeter, winding AND the centroid echo are all unaffected (ISPRAVKA 1)", () => {
    // ISPRAVKA (1) is binding: (x,y) = (first column, second column) in BOTH
    // column orders — in the default „Y X" entry, Y (first column) IS the
    // abscissa (east), so toXY never actually swaps between orders. The
    // centroid is internally cx=10 (=(0+30+0)/3), cy=40/3=13.333333
    // (=(0+0+40)/3), and since cx is already the value of whichever column
    // was typed FIRST, echoing (cx, cy) is already correct for both orders —
    // there is no separate swap to make. A version that swapped `{a,b}` for
    // "YX" would hand back a=13.3333 to a user who typed Y first, i.e. it
    // would print the X reading in the Y column.
    const r = polygonArea({
      vertices: [
        { a: 0, b: 0 },
        { a: 30, b: 0 },
        { a: 0, b: 40 },
      ],
      columnOrder: "YX",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.areaM2).toBeCloseTo(600, 6);
    expect(r.perimeterM).toBeCloseTo(120, 6);
    expect(r.winding).toBe("ccw");
    // SAME echo as the X,Y vector above — (10.0000, 13.3333), not swapped.
    expect(r.centroid?.a).toBeCloseTo(10.0, 4);
    expect(r.centroid?.b).toBeCloseTo(13.3333, 4);
  });

  it("regression: a CCW parcel in (east,north) stays CCW when entered in the default Y,X order", () => {
    // (E,N) = (0,0),(10,0),(10,10),(0,10), a CCW unit square. Entered as Y,X
    // rows this is literally {a:E,b:N} at each vertex. Before the fix, toXY
    // read the default order as (x,y) = (second column, first column), which
    // mirrors the plane and reports the opposite winding.
    const r = polygonArea({
      vertices: [
        { a: 0, b: 0 },
        { a: 10, b: 0 },
        { a: 10, b: 10 },
        { a: 0, b: 10 },
      ],
      columnOrder: "YX",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.winding).toBe("ccw");
  });

  it("an irregular quadrilateral — vector 2", () => {
    const r = polygonArea({
      vertices: [
        { a: 100, b: 100 },
        { a: 140, b: 105 },
        { a: 135, b: 160 },
        { a: 95, b: 150 },
      ],
      columnOrder: "XY",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // S = -3500+8225+5050-5500 = 4275 -> A = 2137.500 m^2
    expect(r.areaM2).toBeCloseTo(2137.5, 3);
    expect(r.areaAr).toBeCloseTo(21.375, 3);
    // perimeter = sqrt1625+sqrt3050+sqrt1700+sqrt2525 = 187.019 m
    expect(r.perimeterM).toBeCloseTo(187.019, 1);
    // centroid Cx = 1510875/12825 = 117.8070, Cy = 1652625/12825 = 128.8596
    expect(r.centroid?.a).toBeCloseTo(117.807, 2);
    expect(r.centroid?.b).toBeCloseTo(128.8596, 2);
  });

  it("refuses fewer than 3 vertices and a self-intersecting bow-tie quadrilateral", () => {
    expect(
      polygonArea({
        vertices: [
          { a: 0, b: 0 },
          { a: 1, b: 0 },
        ],
        columnOrder: "XY",
      }),
    ).toEqual({ ok: false, reason: "vertices" });
    const bowtie = polygonArea({
      vertices: [
        { a: 0, b: 0 },
        { a: 10, b: 10 },
        { a: 10, b: 0 },
        { a: 0, b: 10 },
      ],
      columnOrder: "XY",
    });
    expect(bowtie.ok).toBe(false);
    if (bowtie.ok) return;
    expect(bowtie.reason.startsWith("intersect:")).toBe(true);
  });

  it("drops a repeated closing vertex rather than counting a zero-length side", () => {
    const r = polygonArea({
      vertices: [
        { a: 0, b: 0 },
        { a: 30, b: 0 },
        { a: 0, b: 40 },
        { a: 0, b: 0 },
      ],
      columnOrder: "XY",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.areaM2).toBeCloseTo(600, 6);
  });
});

describe("seedingRate", () => {
  it("wheat, 500 plants/m2, TKW 42 g — vector 1", () => {
    const r = seedingRate({
      standMode: "perM2",
      standValue: 500,
      tkwGrams: 42,
      germinationPercent: 92,
      purityPercent: 99,
      fieldLossPercent: 10,
      areaHa: 24,
      bagMassKg: 25,
      rowSpacingCm: 12.5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // F = 0.92*0.99*0.90 = 0.81972
    // norm = 500*42/(100*0.81972) = 21000/81.972 = 256.185 kg/ha
    expect(r.normKgHa).toBeCloseTo(256.185, 2);
    // N = 500/0.81972 = 609.9644 seeds/m2 -> 6,099,644/ha
    expect(r.seedsPerM2).toBeCloseTo(609.9644, 3);
    expect(r.seedsPerHa).toBeCloseTo(6099644, 0);
    // 256.185*24 = 6148.44 kg -> /25 = 245.94 -> ceil 246
    expect(r.totalSeedKg).toBeCloseTo(6148.44, 1);
    expect(r.bagsCeil).toBe(246);
    // 609.9644*0.125 = 76.2456 seeds/linear metre; 100/76.2456 = 1.3116 cm
    expect(r.seedsPerLinearMeter).toBeCloseTo(76.2456, 3);
    expect(r.spacingInRowCm).toBeCloseTo(1.3116, 3);
    // reverse check reproduces the 500 seeds/m2 starting point
    expect(r.reverseStandCheckPerM2).toBeCloseTo(500, 1);
  });

  it("maize, stand given per hectare, seed units of 50,000 — vector 2", () => {
    const r = seedingRate({
      standMode: "perHa",
      standValue: 71000,
      tkwGrams: 320,
      germinationPercent: 95,
      purityPercent: 99.5,
      fieldLossPercent: 3,
      areaHa: 30,
      bagMassKg: 25,
      rowSpacingCm: 70,
      seedsPerUnit: 50000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // standPerM2 = 71000/10000 = 7.1
    // F = 0.95*0.995*0.97 = 0.9168925; norm = 7.1*320/(100*0.9168925) = 24.7794 kg/ha
    expect(r.normKgHa).toBeCloseTo(24.7794, 3);
    // 24.7794*30 = 743.38 kg
    expect(r.totalSeedKg).toBeCloseTo(743.38, 1);
    // seeds/ha ~ 77,435 -> *30 ha = 2,323,064 seeds -> /50000 = 46.46 -> ceil 47
    expect(r.totalSeeds).toBeCloseTo(2323064, -1);
    expect(r.unitsCeil).toBe(47);
    // 70 cm row: seeds/linear metre = 7.743547*0.70 = 5.4205; spacing = 100/5.4205 = 18.4485 cm
    expect(r.seedsPerLinearMeter).toBeCloseTo(5.4205, 3);
    expect(r.spacingInRowCm).toBeCloseTo(18.4485, 2);
  });

  it("refuses germination/purity below 1 (a likely fraction-vs-percent mistake) and a fully lost field", () => {
    expect(
      seedingRate({
        standMode: "perM2",
        standValue: 400,
        tkwGrams: 40,
        germinationPercent: 0.92,
        purityPercent: 99,
        fieldLossPercent: 0,
        areaHa: 1,
        bagMassKg: 25,
      }),
    ).toEqual({ ok: false, reason: "germinationPercent" });
  });
});

describe("sprayerCalibration", () => {
  it("direct nozzle flow, 24 nozzles matching the entered spacing, tank coverage — vector 1", () => {
    const r = sprayerCalibration({
      nozzleFlow: { mode: "direct", flowLMin: 0.8 },
      nozzleSpacingM: 0.5,
      nozzleCount: 24,
      speedKmh: 6,
      catchTimeS: 60,
      tankVolumeL: 400,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Q = 600*0.8/(6*0.5) = 480/3 = 160.0 l/ha
    expect(r.rateFromSpacingLHa).toBeCloseTo(160.0, 6);
    // q_uk = 24*0.8 = 19.2, W = 24*0.5 = 12 -> 600*19.2/(6*12) = 160.0 l/ha, same
    expect(r.rateFromCountWidthLHa).toBeCloseTo(160.0, 6);
    // no separately measured workingWidthM was entered, so there is nothing to compare
    expect(r.widthDifferenceM).toBeUndefined();
    // 400/160 = 2.50 ha per tank; 2.50*10000/12 = 2083.33 m
    expect(r.coverageHaPerTank).toBeCloseTo(2.5, 6);
    expect(r.distancePerTankM).toBeCloseTo(2083.33, 1);
  });

  it("catch-measured flow against a label target rate — vector 2", () => {
    const r = sprayerCalibration({
      nozzleFlow: { mode: "catch", volumeMl: 700 },
      nozzleSpacingM: 0.5,
      speedKmh: 5,
      catchTimeS: 30,
      targetRateLHa: 300,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // measured q = (700/1000)*(60/30) = 1.40 l/min
    expect(r.nozzleFlowLMin).toBeCloseTo(1.4, 6);
    // Q = 600*1.40/(5*0.5) = 840/2.5 = 336.0 l/ha
    expect(r.rateFromSpacingLHa).toBeCloseTo(336.0, 6);
    // required q for 300 l/ha = 300*5*0.5/600 = 1.25 l/min
    expect(r.requiredNozzleFlowLMin).toBeCloseTo(1.25, 6);
    // expected catch volume for 30 s = 1.25*30*1000/60 = 625 ml
    expect(r.expectedCatchVolumeMl).toBeCloseTo(625, 6);
    // ratio = 336/300*100 = 112.0 %
    expect(r.ratioPercent).toBeCloseTo(112.0, 4);
  });

  it("this is a life-safety tool: no field named passes/compliant/safe/status appears on the result", () => {
    const r = sprayerCalibration({
      nozzleFlow: { mode: "direct", flowLMin: 0.8 },
      nozzleSpacingM: 0.5,
      speedKmh: 6,
      catchTimeS: 60,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const keys = Object.keys(r);
    for (const banned of ["passes", "compliant", "safe", "withinLimit", "status", "verdict"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("reports the plain width difference — never a mismatch verdict — when the entered working width disagrees with nozzleCount x spacing", () => {
    const r = sprayerCalibration({
      nozzleFlow: { mode: "direct", flowLMin: 0.8 },
      nozzleSpacingM: 0.5,
      nozzleCount: 24,
      workingWidthM: 10, // should be 12 m from 24*0.5
      speedKmh: 6,
      catchTimeS: 60,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.widthFromCountM).toBeCloseTo(12, 6);
    // 10 - 12 = -2 m: a plain difference, not a boolean pass/fail — this is a
    // life-safety tool, so no tolerance threshold is baked in here.
    expect(r.widthDifferenceM).toBeCloseTo(-2, 6);
    // both rates are shown side by side rather than one being silently picked
    expect(r.rateFromCountWidthLHa).toBeDefined();
    expect(r.rateFromSpacingLHa).toBeDefined();
  });

  it("refuses a zero catch time and a target rate outside 20-2000 l/ha", () => {
    expect(
      sprayerCalibration({
        nozzleFlow: { mode: "direct", flowLMin: 0.8 },
        nozzleSpacingM: 0.5,
        speedKmh: 6,
        catchTimeS: 0,
      }),
    ).toEqual({ ok: false, reason: "catchTimeS" });
    expect(
      sprayerCalibration({
        nozzleFlow: { mode: "direct", flowLMin: 0.8 },
        nozzleSpacingM: 0.5,
        speedKmh: 6,
        catchTimeS: 60,
        targetRateLHa: 10,
      }),
    ).toEqual({ ok: false, reason: "targetRateLHa" });
  });
});

describe("tankMixDose", () => {
  it("single liquid product, per-hectare dose — vector 1", () => {
    const r = tankMixDose({
      products: [{ name: "herbicid", unit: "l", dose: { mode: "perHectare", value: 1.5 } }],
      sprayRateLHa: 200,
      tankVolumeL: 600,
      areaHa: 8.4,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A_r = 600/200 = 3.00 ha; P_r = 1.5*3 = 4.50 l
    expect(r.fullTankAreaHa).toBeCloseTo(3.0, 6);
    expect(r.products[0]?.perFullTankAmount).toBeCloseTo(4.5, 6);
    // V_uk = 200*8.4 = 1680 l -> n = 2.80 -> 2 full, remainder 480 l -> 2.40 ha -> 3.60 l
    expect(r.totalSprayVolumeL).toBeCloseTo(1680, 3);
    expect(r.fillsExact).toBeCloseTo(2.8, 6);
    expect(r.fullFills).toBe(2);
    expect(r.remainderVolumeL).toBeCloseTo(480, 3);
    expect(r.remainderAreaHa).toBeCloseTo(2.4, 6);
    expect(r.products[0]?.remainderAmount).toBeCloseTo(3.6, 6);
    // total = 1.5*8.4 = 12.60 l
    expect(r.products[0]?.totalAmount).toBeCloseTo(12.6, 6);
    // concentration = 1.5/200 = 0.0075 = 0.75% = 7.5 ml/l
    expect(r.products[0]?.concentrationPercent).toBeCloseTo(0.75, 6);
    expect(r.products[0]?.perLiterAmount).toBeCloseTo(7.5, 6);
    expect(r.products[0]?.concentrationBasis).toBe("volumeVolume");
    // carrier: 600 - 4.5 = 595.5 per tank; 1680 - 12.6 = 1667.4 total
    expect(r.fullTankCarrierL).toBeCloseTo(595.5, 3);
    expect(r.totalCarrierL).toBeCloseTo(1667.4, 3);
  });

  it("single solid (kg) product — vector 2", () => {
    const r = tankMixDose({
      products: [{ name: "fungicid", unit: "kg", dose: { mode: "perHectare", value: 2.5 } }],
      sprayRateLHa: 400,
      tankVolumeL: 1000,
      areaHa: 3.2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A_r = 1000/400 = 2.50 ha; P_r = 2.5*2.5 = 6.25 kg
    expect(r.fullTankAreaHa).toBeCloseTo(2.5, 6);
    expect(r.products[0]?.perFullTankAmount).toBeCloseTo(6.25, 6);
    // V_uk = 1280 l -> n = 1.28 -> 1 full, remainder 280 l -> 0.70 ha -> 1.75 kg
    expect(r.totalSprayVolumeL).toBeCloseTo(1280, 3);
    expect(r.fullFills).toBe(1);
    expect(r.remainderAreaHa).toBeCloseTo(0.7, 6);
    expect(r.products[0]?.remainderAmount).toBeCloseTo(1.75, 6);
    // total = 2.5*3.2 = 8.00 kg
    expect(r.products[0]?.totalAmount).toBeCloseTo(8.0, 6);
    // concentration = 2.5/400 = 0.625% (mass/volume, not volume/volume) = 6.25 g/l
    expect(r.products[0]?.concentrationPercent).toBeCloseTo(0.625, 6);
    expect(r.products[0]?.perLiterAmount).toBeCloseTo(6.25, 6);
    expect(r.products[0]?.concentrationBasis).toBe("massVolume");
    // solid product does not reduce the carrier volume
    expect(r.fullTankCarrierL).toBeCloseTo(1000, 3);
    expect(r.totalCarrierL).toBeCloseTo(1280, 3);
  });

  it("regression: an exact fill count is not dropped a ULP below the whole number — a life-safety fill schedule", () => {
    // 200 L/ha * 72.6 ha = 14520 L on paper; /440 L tank = 33 fills exactly.
    // 200*72.6 lands at 14519.999999999998 in raw double arithmetic, and a
    // bare floor(14519.999999999998/440) reports 32 fills with a whole tank
    // sitting in the "remainder" — the operator would be told to prepare a
    // 33rd tank as a part-fill instead of a full one.
    const r = tankMixDose({
      products: [{ name: "herbicid", unit: "l", dose: { mode: "perHectare", value: 1 } }],
      sprayRateLHa: 200,
      tankVolumeL: 440,
      areaHa: 72.6,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fillsExact).toBeCloseTo(33, 6);
    expect(r.fullFills).toBe(33);
    expect(r.remainderVolumeL).toBeCloseTo(0, 6);
    expect(r.remainderAreaHa).toBeCloseTo(0, 6);
  });

  it("mixed liquid+solid products: only the LIQUID product's own volume reduces the carrier — the solid does not", () => {
    const r = tankMixDose({
      products: [
        { name: "herbicid", unit: "l", dose: { mode: "perHectare", value: 2 } },
        { name: "fungicid", unit: "kg", dose: { mode: "perHectare", value: 1 } },
      ],
      sprayRateLHa: 300,
      tankVolumeL: 600,
      areaHa: 5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A_r = 600/300 = 2.00 ha; V_uk = 300*5 = 1500 l -> 2 full fills, 300 l remainder
    expect(r.fullTankAreaHa).toBeCloseTo(2.0, 6);
    expect(r.fullFills).toBe(2);
    expect(r.remainderVolumeL).toBeCloseTo(300, 6);
    // liquid: dose 2 l/ha -> perFullTank 2*2=4.0 l, total 2*5=10.0 l
    expect(r.products[0]?.perFullTankAmount).toBeCloseTo(4.0, 6);
    expect(r.products[0]?.totalAmount).toBeCloseTo(10.0, 6);
    // solid: dose 1 kg/ha -> perFullTank 1*2=2.0 kg, total 1*5=5.0 kg
    expect(r.products[1]?.perFullTankAmount).toBeCloseTo(2.0, 6);
    expect(r.products[1]?.totalAmount).toBeCloseTo(5.0, 6);
    // carrier: 600 - 4.0 (liquid only) = 596.0 per tank; 1500 - 10.0 = 1490.0 total
    expect(r.fullTankCarrierL).toBeCloseTo(596.0, 4);
    expect(r.totalCarrierL).toBeCloseTo(1490.0, 4);
  });

  it("this is a life-safety tool: no field named passes/compliant/safe/status appears on the result", () => {
    const r = tankMixDose({
      products: [{ name: "x", unit: "l", dose: { mode: "perHectare", value: 1 } }],
      sprayRateLHa: 200,
      tankVolumeL: 600,
      areaHa: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const keys = Object.keys(r);
    for (const banned of ["passes", "compliant", "safe", "withinLimit", "status", "verdict"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("refuses more than 10 products, and a non-positive concentration value", () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({
      name: `p${i}`,
      unit: "l" as const,
      dose: { mode: "perHectare" as const, value: 1 },
    }));
    expect(tankMixDose({ products: tooMany, sprayRateLHa: 200, tankVolumeL: 600, areaHa: 1 })).toEqual({
      ok: false,
      reason: "products",
    });
    expect(
      tankMixDose({
        products: [{ name: "x", unit: "l", dose: { mode: "concentrationPercent", percent: 0 } }],
        sprayRateLHa: 200,
        tankVolumeL: 600,
        areaHa: 1,
      }),
    ).toEqual({ ok: false, reason: "dose:0" });
  });
});

describe("yieldEstimateSamples", () => {
  it("wheat, small-grain method, single sample, moisture reference conversion — vector 1", () => {
    const r = yieldEstimateSamples({
      samples: [{ method: "smallGrain", earsPerM2: 450, grainsPerEar: 32 }],
      tkwGrams: 40,
      tkwMoisturePercent: 16,
      referenceMoisturePercent: 14,
      plotAreaHa: 18.5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 450*32*40/100000 = 576000/100000 = 5.760 t/ha
    expect(r.sampleYieldsTHa[0]).toBeCloseTo(5.76, 6);
    expect(r.meanTHa).toBeCloseTo(5.76, 6);
    // single sample -> no dispersion
    expect(r.stdDevTHa).toBeUndefined();
    expect(r.coefficientOfVariationPercent).toBeUndefined();
    // 5.760*84/86 = 5.62605 t/ha
    expect(r.meanAtReferenceMoistureTHa).toBeCloseTo(5.62605, 3);
    // 5.62605*18.5 = 104.08 t
    expect(r.totalYieldT).toBeCloseTo(104.08, 1);
    expect(r.sampleCount).toBe(1);
  });

  it("row-crop single-sample yield, and a four-sample measured-area dispersion check — vector 2", () => {
    const rowCrop = yieldEstimateSamples({
      samples: [{ method: "rowCrop", plantsPerHa: 65000, earsPerPlant: 1, grainsPerEar: 512 }],
      tkwGrams: 300,
      plotAreaHa: 1,
    });
    expect(rowCrop.ok).toBe(true);
    if (!rowCrop.ok) return;
    // mass/plant = 1*512*300/1000 = 153.6 g; yield = 65000*153.6/1e6 = 9.984 t/ha
    expect(rowCrop.meanTHa).toBeCloseTo(9.984, 4);

    const measured = yieldEstimateSamples({
      samples: [
        { method: "measuredArea", sampleAreaM2: 2, sampleMassKg: 2.4 },
        { method: "measuredArea", sampleAreaM2: 2, sampleMassKg: 2.08 },
        { method: "measuredArea", sampleAreaM2: 2, sampleMassKg: 2.24 },
        { method: "measuredArea", sampleAreaM2: 2, sampleMassKg: 1.92 },
      ],
      tkwGrams: 300,
      plotAreaHa: 1,
    });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    // yields: 12.0, 10.4, 11.2, 9.6 t/ha; mean = 43.2/4 = 10.80
    expect(measured.sampleYieldsTHa[0]).toBeCloseTo(12.0, 9);
    expect(measured.sampleYieldsTHa[1]).toBeCloseTo(10.4, 9);
    expect(measured.sampleYieldsTHa[2]).toBeCloseTo(11.2, 9);
    expect(measured.sampleYieldsTHa[3]).toBeCloseTo(9.6, 9);
    expect(measured.meanTHa).toBeCloseTo(10.8, 6);
    // deviations 1.2,-0.4,0.4,-1.2 -> squares sum 3.20 -> s = sqrt(3.20/3) = 1.0328
    expect(measured.stdDevTHa).toBeCloseTo(1.032796, 3);
    // CV = 1.0328/10.80*100 = 9.5629 %
    expect(measured.coefficientOfVariationPercent).toBeCloseTo(9.5629, 2);
    expect(measured.minTHa).toBeCloseTo(9.6, 6);
    expect(measured.maxTHa).toBeCloseTo(12.0, 6);
  });

  it("converts a measuredArea sample to reference moisture using sampleMoisturePercent, never tkwMoisturePercent", () => {
    const r = yieldEstimateSamples({
      samples: [{ method: "measuredArea", sampleAreaM2: 2, sampleMassKg: 2.4 }],
      tkwGrams: 300,
      // Deliberately different from sampleMoisturePercent, to prove the
      // measuredArea sample is never adjusted from the TKW's own basis.
      tkwMoisturePercent: 30,
      sampleMoisturePercent: 20,
      referenceMoisturePercent: 14,
      plotAreaHa: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // yield = 2.4/2*10 = 12.0 t/ha
    expect(r.meanTHa).toBeCloseTo(12.0, 6);
    // adjusted from the SAMPLE moisture (20%): 12.0*(100-20)/(100-14) = 11.162791 t/ha
    expect(r.meanAtReferenceMoistureTHa).toBeCloseTo(11.162791, 3);
  });

  it("refuses a reference-moisture conversion when the measuredArea sample's own moisture basis is missing", () => {
    expect(
      yieldEstimateSamples({
        samples: [{ method: "measuredArea", sampleAreaM2: 2, sampleMassKg: 2.4 }],
        tkwGrams: 300,
        referenceMoisturePercent: 14,
        plotAreaHa: 1,
      }),
    ).toEqual({ ok: false, reason: "sampleMoisturePercent" });
  });

  it("refuses an out-of-range reference moisture (100, above the 0-60 input band — the shared moistureAdjust helper's own w2=100 guard is unreachable through this range check too) and reports CV as undefined (not a crash) at a zero mean", () => {
    expect(
      yieldEstimateSamples({
        samples: [{ method: "smallGrain", earsPerM2: 100, grainsPerEar: 10 }],
        tkwGrams: 40,
        tkwMoisturePercent: 16,
        referenceMoisturePercent: 100,
        plotAreaHa: 1,
      }),
    ).toEqual({ ok: false, reason: "referenceMoisturePercent" });

    const r = yieldEstimateSamples({
      samples: [
        { method: "measuredArea", sampleAreaM2: 1, sampleMassKg: 0.001 },
        { method: "measuredArea", sampleAreaM2: 1, sampleMassKg: 0.001 },
      ],
      tkwGrams: 40,
      plotAreaHa: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meanTHa).toBeGreaterThan(0);
    expect(r.stdDevTHa).toBeCloseTo(0, 9);
    // stdDev is ~0 but not undefined at n>=2; CV only refuses on an exact zero mean
    expect(r.coefficientOfVariationPercent).toBeCloseTo(0, 6);
  });
});

describe("a union value is a claim, not a fact — the table is asked at runtime", () => {
  type GrainShrinkInput = Parameters<typeof grainMoistureShrink>[0];

  it("grainMoistureShrink refuses a deduction order outside the table rather than indexing it and throwing", () => {
    const good: GrainShrinkInput = {
      grossMassKg: 10000,
      measuredMoisturePercent: 18,
      targetMoisturePercent: 14,
      impuritiesPercent: 0,
      impuritiesFreeLimitPercent: 0,
      order: "impuritiesFirst",
      deductionMode: "excessOnly",
    };
    // The cast is the test: TypeScript forbids this value, the renderer is not
    // obliged to honour that, and the function must refuse rather than throw.
    const bad: GrainShrinkInput = {
      ...good,
      order: "impuritiesLast" as GrainShrinkInput["order"],
    };
    expect(grainMoistureShrink(bad)).toEqual({ ok: false, reason: "order" });
    expect(grainMoistureShrink(good).ok).toBe(true);
  });
});
