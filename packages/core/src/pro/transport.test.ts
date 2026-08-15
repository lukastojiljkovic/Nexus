import { describe, expect, it } from "vitest";

import {
  cargoCentreOfGravity,
  chargeableWeight,
  costPerKm,
  drivingSchedule,
  etaWithBreaks,
  fuelConsumption,
  gearRoadSpeed,
  grossMassAndPayload,
  lashingForce,
  loadingSpaceUtilisation,
  palletLoadPlan,
  reeferFuelUse,
  rigidAxleLoads,
  rigidAxleTargetDistance,
  serviceInterval,
  tankVolumeByLevel,
  tractorSemitrailerLoads,
  tractorSemitrailerTargetDistance,
  tripCostQuote,
  tyreChangeDeviation,
} from "./transport.js";

/**
 * Every expectation here was re-derived by hand from the assignment's own
 * inputs, independently of the code, and the arithmetic is written into the
 * comment above each assertion so it can be checked without running anything.
 */

describe("rigidAxleLoads", () => {
  it("splits cargo moments about the front axle — 8000@3.5 + 2000@1.0 over b=5", () => {
    const result = rigidAxleLoads({
      wheelbase: 5,
      emptyFront: 4200,
      emptyRear: 3300,
      items: [
        { mass: 8000, distance: 3.5 },
        { mass: 2000, distance: 1.0 },
      ],
      frontLimit: 7500,
      rearLimit: 11500,
      totalLimit: 18000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Σm·x = 8000·3.5 + 2000·1.0 = 28000 + 2000 = 30000; Rt = 30000/5 = 6000.
    expect(result.payload).toBe(10000);
    expect(result.payloadMoment).toBe(30000);
    // Ft = 10000 - 6000 = 4000; F = 4200 + 4000 = 8200; R = 3300 + 6000 = 9300.
    expect(result.front.value).toBe(8200);
    expect(result.rear.value).toBe(9300);
    expect(result.total.value).toBe(17500);
    expect(result.totalByMasses).toBe(17500);
    // The two totals must agree — statics conserves mass regardless of position.
    expect(result.total.value).toBe(result.totalByMasses);
    // ISPRAVKA (1): the sign is computed − limit, so a load under its limit is negative.
    expect(result.front.minusLimit).toBeCloseTo(700, 6); // 8200 - 7500
    expect(result.front.ratio).toBeCloseTo(1.093333, 6); // 8200/7500
    expect(result.rear.minusLimit).toBeCloseTo(-2200, 6); // 9300 - 11500
    expect(result.rear.ratio).toBeCloseTo(0.808696, 6); // 9300/11500
    expect(result.total.ratio).toBeCloseTo(0.972222, 6); // 17500/18000
    // Item shares: toRear = m·x/b, toFront = m·(1 - x/b).
    expect(result.shares[0]?.toRear).toBeCloseTo(5600, 6); // 8000·3.5/5
    expect(result.shares[0]?.toFront).toBeCloseTo(2400, 6); // 8000·(1-0.7)
    expect(result.shares[1]?.toRear).toBeCloseTo(400, 6); // 2000·1/5
    expect(result.shares[1]?.toFront).toBeCloseTo(1600, 6); // 2000·0.8
  });

  it("draws no comparison when the user typed no limit — an absent rule is not a satisfied one", () => {
    const result = rigidAxleLoads({
      wheelbase: 5,
      emptyFront: 4200,
      emptyRear: 3300,
      items: [{ mass: 8000, distance: 3.5 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.front.ratio).toBeUndefined();
    expect(result.front.minusLimit).toBeUndefined();
    expect(result.rear.ratio).toBeUndefined();
  });

  it("shows a negative reaction as a negative number, with no ratio against it", () => {
    // A row 10 m AHEAD of the front axle lifts the rear axle into the negative.
    const result = rigidAxleLoads({
      wheelbase: 5,
      emptyFront: 0,
      emptyRear: 0,
      items: [{ mass: 1000, distance: -10 }],
      rearLimit: 5000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Rt = 1000·(-10)/5 = -2000; R = 0 + (-2000) = -2000.
    expect(result.rear.value).toBeCloseTo(-2000, 6);
    // A ratio of a negative reaction against a mass limit describes nothing.
    expect(result.rear.ratio).toBeUndefined();
    // Ft = 1000 - (-2000) = 3000; F = 3000.
    expect(result.front.value).toBeCloseTo(3000, 6);
  });

  it("refuses rather than repairs: an out-of-range wheelbase, an empty axle mass, and an empty item list", () => {
    const base = { wheelbase: 5, emptyFront: 4200, emptyRear: 3300, items: [{ mass: 1, distance: 0 }] };
    expect(rigidAxleLoads({ ...base, wheelbase: 0.4 })).toEqual({ ok: false, reason: "wheelbase" });
    expect(rigidAxleLoads({ ...base, emptyFront: -1 })).toEqual({ ok: false, reason: "emptyFront" });
    expect(rigidAxleLoads({ ...base, emptyRear: 50000 })).toEqual({ ok: false, reason: "emptyRear" });
    expect(rigidAxleLoads({ ...base, items: [] })).toEqual({ ok: false, reason: "items" });
  });
});

describe("rigidAxleTargetDistance", () => {
  it("solves the position for a target rear load, and recomputes BOTH axles there", () => {
    const result = rigidAxleTargetDistance({
      wheelbase: 5,
      emptyFront: 4200,
      emptyRear: 3300,
      items: [
        { mass: 8000, distance: 3.5 },
        { mass: 2000, distance: 1.0 },
      ],
      itemIndex: 0,
      targetRear: 10000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sc = (10000 - 3300)·5 = 33500; minus the other row's 2000·1.0 = 2000 → 31500.
    expect(result.requiredMoment).toBeCloseTo(33500, 6);
    expect(result.distance).toBeCloseTo(3.9375, 6); // 31500/8000
    expect(result.shift).toBeCloseTo(0.4375, 6); // 3.9375 - 3.5, further back
    expect(result.distanceOutOfBounds).toBe(false); // 0 ≤ 3.9375 ≤ 5
    // ISPRAVKA (3): moving one row moves the front axle too — the review's own
    // worked figure is F falling from 8200 to 7500, not R alone.
    expect(result.newFront).toBeCloseTo(7500, 6);
    expect(result.newRear).toBe(10000);
    // Total mass is unchanged by moving cargo — the check the review asked for.
    expect(result.newTotal).toBeCloseTo(17500, 6);
  });

  it("flags a solved distance that lands outside the wheelbase", () => {
    const result = rigidAxleTargetDistance({
      wheelbase: 5,
      emptyFront: 0,
      emptyRear: 0,
      items: [{ mass: 100, distance: 1 }],
      itemIndex: 0,
      targetRear: 40000, // Wildly over what a 100 kg row could ever produce within [0,5].
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceOutOfBounds).toBe(true);
  });

  it("refuses a massless chosen row rather than dividing by zero", () => {
    const result = rigidAxleTargetDistance({
      wheelbase: 5,
      emptyFront: 0,
      emptyRear: 0,
      items: [{ mass: 0, distance: 1 }],
      itemIndex: 0,
      targetRear: 100,
    });
    expect(result).toEqual({ ok: false, reason: "itemMass" });
  });
});

describe("tractorSemitrailerLoads", () => {
  it("splits the trailer at the kingpin, then the fifth-wheel load across the tractor axles", () => {
    const result = tractorSemitrailerLoads({
      tractorWheelbase: 3.7,
      fifthWheelFromFrontAxle: 3.2,
      emptyFront: 4600,
      emptyDrive: 3400,
      kingpinToBogie: 7.6,
      trailerTare: 7000,
      trailerTareCentre: 5.2,
      items: [{ mass: 24000, distance: 5.0 }],
      frontLimit: 7500,
      driveLimit: 11500,
      bogieLimit: 24000,
      totalLimit: 40000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // B = 7000·5.2/7.6 + 24000·5.0/7.6 = 36400/7.6 + 120000/7.6 = 4789.4737 + 15789.4737
    expect(result.bogie.value).toBeCloseTo(20578.947368, 4);
    // K = (7000+24000) - B = 31000 - 20578.947368
    expect(result.fifthWheel).toBeCloseTo(10421.052632, 4);
    // to drive: K·u/btr = (198000/19)·(3.2/3.7) = 9012.802276
    expect(result.drive.value).toBeCloseTo(12412.802276, 3); // 3400 + 9012.802276
    // to front: K - toDrive = 10421.052632 - 9012.802276
    expect(result.front.value).toBeCloseTo(6008.250356, 3); // 4600 + 1408.250356
    // Total is 8000(tractor tare)+7000(trailer tare)+24000(cargo) = 39000.
    expect(result.total.value).toBeCloseTo(39000, 2);
    expect(result.totalByMasses).toBeCloseTo(39000, 6);
    expect(result.front.ratio).toBeCloseTo(0.801100, 3); // 6008.250/7500
    expect(result.drive.ratio).toBeCloseTo(1.079374, 3); // 12412.802/11500
    expect(result.drive.minusLimit).toBeCloseTo(912.802, 2);
    expect(result.bogie.ratio).toBeCloseTo(0.857456, 4); // 20578.947/24000
    expect(result.total.ratio).toBeCloseTo(0.975, 4); // 39000/40000
  });

  it("allows the fifth wheel behind the drive axle — the front share goes negative, not refused", () => {
    const result = tractorSemitrailerLoads({
      tractorWheelbase: 3.7,
      fifthWheelFromFrontAxle: 5, // u > btr
      emptyFront: 4600,
      emptyDrive: 3400,
      kingpinToBogie: 7.6,
      trailerTare: 7000,
      trailerTareCentre: 5.2,
      items: [{ mass: 24000, distance: 5.0 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // share = u/btr = 5/3.7 = 1.351351 > 1, so (1 - share) < 0.
    const share = 5 / 3.7;
    expect(result.front.value).toBeCloseTo(4600 + result.fifthWheel * (1 - share), 6);
    expect(result.front.value).toBeLessThan(4600); // the coupling lifts the front
    // No `frontLimit` was typed at all in this vector, so no ratio can be
    // drawn regardless of sign — see the vector below for the sign rule itself.
    expect(result.front.ratio).toBeUndefined();
  });

  it("draws no ratio once a supplied front limit meets an ACTUALLY negative front load", () => {
    // u = 8 m (well past btr = 3.7 m) makes (1 - share) steeply negative,
    // unlike the u = 5 m vector above where front.value stays positive.
    const result = tractorSemitrailerLoads({
      tractorWheelbase: 3.7,
      fifthWheelFromFrontAxle: 8,
      emptyFront: 4600,
      emptyDrive: 3400,
      kingpinToBogie: 7.6,
      trailerTare: 7000,
      trailerTareCentre: 5.2,
      items: [{ mass: 24000, distance: 5.0 }],
      frontLimit: 7500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // B = (7000·5.2+24000·5.0)/7.6 = 156400/7.6 = 20578.947368;
    // K = 31000 - B = 10421.052632; share = 8/3.7 = 2.162162;
    // front = 4600 + 10421.052632·(1 - 2.162162) = 4600 - 12110.953058
    expect(result.front.value).toBeCloseTo(-7510.953058, 3);
    expect(result.front.value).toBeLessThan(0);
    // This time the value itself is negative — the case the u = 5 m vector,
    // with no limit typed at all, could never actually exercise.
    expect(result.front.ratio).toBeUndefined();
    expect(result.front.minusLimit).toBeCloseTo(-15010.953058, 3); // -7510.953058 - 7500
  });

  it("refuses an out-of-range kingpin-to-bogie distance and an empty item list", () => {
    const base = {
      tractorWheelbase: 3.7,
      fifthWheelFromFrontAxle: 3.2,
      emptyFront: 4600,
      emptyDrive: 3400,
      kingpinToBogie: 7.6,
      trailerTare: 7000,
      trailerTareCentre: 5.2,
      items: [{ mass: 1, distance: 0 }],
    };
    expect(tractorSemitrailerLoads({ ...base, kingpinToBogie: 0.5 })).toEqual({
      ok: false,
      reason: "kingpinToBogie",
    });
    expect(tractorSemitrailerLoads({ ...base, items: [] })).toEqual({ ok: false, reason: "items" });
  });
});

describe("tractorSemitrailerTargetDistance", () => {
  // Shared tractor geometry, matching the `tractorSemitrailerLoads` vector above,
  // so `newFront`/`newDrive` can be checked against numbers already worked by hand.
  const tractor = { tractorWheelbase: 3.7, fifthWheelFromFrontAxle: 3.2, emptyFront: 4600, emptyDrive: 3400 };

  it("round-trips: solving for the CURRENT bogie load returns the current distance unchanged", () => {
    const result = tractorSemitrailerTargetDistance({
      kingpinToBogie: 7.6,
      trailerTare: 7000,
      trailerTareCentre: 5.2,
      items: [{ mass: 24000, distance: 5.0 }],
      itemIndex: 0,
      // B computed by hand above: 156400/7.6 = 20578.947368...
      targetBogie: 156400 / 7.6,
      ...tractor,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sc = Bc·s = (156400/7.6)·7.6 = 156400 exactly.
    expect(result.requiredMoment).toBeCloseTo(156400, 4);
    expect(result.distance).toBeCloseTo(5.0, 6);
    expect(result.shift).toBeCloseTo(0, 6);
    expect(result.distanceOutOfBounds).toBe(false);
    // Unchanged position: the recomputed points match the `tractorSemitrailerLoads` vector.
    expect(result.newBogie).toBeCloseTo(20578.947368, 4);
    expect(result.newFifthWheel).toBeCloseTo(10421.052632, 4);
    expect(result.newFront).toBeCloseTo(6008.250356, 3);
    expect(result.newDrive).toBeCloseTo(12412.802276, 3);
    // 8000(tractor tare) + 7000(trailer tare) + 24000(cargo) = 39000, unaffected by position.
    expect(result.newTotal).toBeCloseTo(39000, 2);
  });

  it("moves the distance when a different bogie load is targeted, and recomputes all four points", () => {
    const result = tractorSemitrailerTargetDistance({
      kingpinToBogie: 7.6,
      trailerTare: 7000,
      trailerTareCentre: 5.2,
      items: [{ mass: 24000, distance: 5.0 }],
      itemIndex: 0,
      targetBogie: 22000,
      ...tractor,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sc = 22000·7.6 = 167200; dk = (167200 - 7000·5.2)/24000 = (167200-36400)/24000
    expect(result.requiredMoment).toBeCloseTo(167200, 4);
    expect(result.distance).toBeCloseTo(5.45, 6); // 130800/24000
    // Total cargo unchanged (24000) → newFifthWheel = 7000+24000-22000 = 9000.
    expect(result.newFifthWheel).toBeCloseTo(9000, 4);
    const share = 3.2 / 3.7;
    // newFront = 4600 + 9000·(1 - 3.2/3.7); newDrive = 3400 + 9000·3.2/3.7.
    expect(result.newFront).toBeCloseTo(4600 + 9000 * (1 - share), 4);
    expect(result.newDrive).toBeCloseTo(3400 + 9000 * share, 4);
    // Total mass is unchanged by moving cargo, exactly as in the rigid case.
    expect(result.newTotal).toBeCloseTo(39000, 2);
  });

  it("flags a solved distance that lands outside the kingpin-to-bogie span", () => {
    const result = tractorSemitrailerTargetDistance({
      kingpinToBogie: 7.6,
      trailerTare: 0,
      trailerTareCentre: 0,
      items: [{ mass: 100, distance: 1 }],
      itemIndex: 0,
      targetBogie: 40000, // wildly over what a 100 kg row could produce within [0, 7.6]
      ...tractor,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceOutOfBounds).toBe(true);
  });

  it("refuses a chosen row index outside the list", () => {
    const result = tractorSemitrailerTargetDistance({
      kingpinToBogie: 7.6,
      trailerTare: 7000,
      trailerTareCentre: 5.2,
      items: [{ mass: 24000, distance: 5.0 }],
      itemIndex: 5,
      targetBogie: 20000,
      ...tractor,
    });
    expect(result).toEqual({ ok: false, reason: "itemIndex" });
  });
});

describe("cargoCentreOfGravity", () => {
  it("computes the centroid and its lateral share — three pieces, asymmetric", () => {
    const result = cargoCentreOfGravity({
      items: [
        { mass: 2000, x: 1.0, y: 0.0, z: 0.6 },
        { mass: 3000, x: 3.0, y: 0.3, z: 0.9 },
        { mass: 5000, x: 6.0, y: -0.2, z: 1.2 },
      ],
      useItemDimensions: false,
      floorHeight: 1.15,
      track: 2.04,
      innerWidth: 2.48,
      momentReference: 2.0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalMass).toBe(10000);
    // Sx = 2000·1 + 3000·3 + 5000·6 = 2000+9000+30000 = 41000 → x̄ = 4.10
    expect(result.x).toBeCloseTo(4.1, 6);
    // Sy = 0 + 900 - 1000 = -100 → ȳ = -0.010
    expect(result.y).toBeCloseTo(-0.01, 6);
    // Sz = 1200 + 2700 + 6000 = 9900 → z̄ = 0.990
    expect(result.z).toBeCloseTo(0.99, 6);
    expect(result.heightAboveGround).toBeCloseTo(2.14, 6); // 0.99 + 1.15
    expect(result.lateralShare).toBeCloseTo(0.0080645, 6); // 0.01/1.24
    // (2.04/2)/2.14 = 1.02/2.14
    expect(result.halfTrackOverHeight).toBeCloseTo(0.476636, 5);
    // Mr = Sx - M·xr = 41000 - 10000·2
    expect(result.momentAboutReference).toBe(21000);
  });

  it("computes a symmetric load with zero lateral offset and the second worked ratio", () => {
    const result = cargoCentreOfGravity({
      items: [
        { mass: 5000, x: 2.0, y: 0.5, z: 1.0 },
        { mass: 5000, x: 6.0, y: -0.5, z: 1.0 },
      ],
      useItemDimensions: false,
      floorHeight: 1.2,
      track: 2.04,
      innerWidth: 2.48,
      momentReference: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.x).toBeCloseTo(4.0, 6);
    expect(result.y).toBe(0);
    expect(result.lateralShare).toBe(0);
    expect(result.heightAboveGround).toBeCloseTo(2.2, 6);
    expect(result.halfTrackOverHeight).toBeCloseTo(0.463636, 5); // 1.02/2.2
    expect(result.momentAboutReference).toBe(40000);
  });

  it("takes the piece's dimensions from its corner, per the stated convention", () => {
    const result = cargoCentreOfGravity({
      items: [{ mass: 1000, x: 0, y: 0, z: 0, length: 2, width: 1, height: 0.5 }],
      useItemDimensions: true,
      floorHeight: 0,
      track: 2.0,
      innerWidth: 2.0,
      momentReference: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Centroid = corner + half of each dimension: (0+1, 0+0.5, 0+0.25).
    expect(result.x).toBeCloseTo(1, 6);
    expect(result.y).toBeCloseTo(0.5, 6);
    expect(result.z).toBeCloseTo(0.25, 6);
  });

  it("leaves out the geometric ratio when the height above ground is zero or negative, never dividing by it", () => {
    const zero = cargoCentreOfGravity({
      items: [{ mass: 1000, x: 0, y: 0, z: 0 }],
      useItemDimensions: false,
      floorHeight: 0,
      track: 2.0,
      innerWidth: 2.0,
      momentReference: 0,
    });
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.heightAboveGround).toBe(0);
    expect(zero.halfTrackOverHeight).toBeUndefined();

    const negative = cargoCentreOfGravity({
      items: [{ mass: 1000, x: 0, y: 0, z: -1 }],
      useItemDimensions: false,
      floorHeight: 0,
      track: 2.0,
      innerWidth: 2.0,
      momentReference: 0,
    });
    expect(negative.ok).toBe(true);
    if (!negative.ok) return;
    expect(negative.heightAboveGround).toBe(-1);
    expect(negative.halfTrackOverHeight).toBeUndefined();
  });

  it("combines cargo and vehicle centres once a vehicle mass and centre are given", () => {
    const result = cargoCentreOfGravity({
      items: [{ mass: 1000, x: 0, y: 0, z: 0 }],
      useItemDimensions: false,
      floorHeight: 1.0,
      track: 2.0,
      innerWidth: 2.0,
      momentReference: 0,
      vehicleMass: 4000,
      vehicleCentre: { x: 0, y: 0, z: 1.0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.combined).toBeDefined();
    // height = (Sz + M·floorHeight + mv·zv)/(M+mv) = (0 + 1000·1.0 + 4000·1.0)/5000
    expect(result.combined?.heightAboveGround).toBeCloseTo(1.0, 6);
    expect(result.combined?.mass).toBe(5000);
  });

  it("refuses a vehicle mass given without its centre, and a centre coordinate outside its range", () => {
    const base = {
      items: [{ mass: 1000, x: 0, y: 0, z: 0 }],
      useItemDimensions: false as const,
      floorHeight: 1.0,
      track: 2.0,
      innerWidth: 2.0,
      momentReference: 0,
    };
    // A vehicle mass with no centre is a half-entered pair, not „no vehicle".
    expect(cargoCentreOfGravity({ ...base, vehicleMass: 4000 })).toEqual({
      ok: false,
      reason: "vehicleCentre",
    });
    expect(
      cargoCentreOfGravity({ ...base, vehicleMass: 4000, vehicleCentre: { x: 0, y: 0, z: 25 } }),
    ).toEqual({ ok: false, reason: "vehicleCentre" });
    // A vehicle mass of exactly 0 is the documented „no combined centre" case, not a refusal.
    const zeroMass = cargoCentreOfGravity({
      ...base,
      vehicleMass: 0,
      vehicleCentre: { x: 0, y: 0, z: 1 },
    });
    expect(zeroMass.ok).toBe(true);
    if (!zeroMass.ok) return;
    expect(zeroMass.combined).toBeUndefined();
  });

  it("refuses an empty item list and a non-positive total mass", () => {
    expect(
      cargoCentreOfGravity({
        items: [],
        useItemDimensions: false,
        floorHeight: 1,
        track: 2,
        innerWidth: 2,
        momentReference: 0,
      }),
    ).toEqual({ ok: false, reason: "items" });
    expect(
      cargoCentreOfGravity({
        items: [{ mass: 0, x: 0, y: 0, z: 0 }],
        useItemDimensions: false,
        floorHeight: 1,
        track: 2,
        innerWidth: 2,
        momentReference: 0,
      }),
    ).toEqual({ ok: false, reason: "totalMass" });
  });
});

describe("grossMassAndPayload", () => {
  it("adds every mass on a single vehicle, and the packaging-adjusted headroom", () => {
    const result = grossMassAndPayload({
      mode: "single",
      vehicleTare: 7850,
      tareIncludesFuelAndCrew: false,
      fuelLitres: 300,
      fuelDensity: 0.835,
      adBlueLitres: 40,
      adBlueDensity: 1.09,
      crew: 85,
      equipment: 120,
      packaging: 500,
      cargo: 8400,
      vehicleLimit: 18000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fuelMass).toBeCloseTo(250.5, 6); // 300·0.835
    expect(result.adBlueMass).toBeCloseTo(43.6, 6); // 40·1.09
    // Mv = 7850 + 250.5 + 43.6 + 85 + 120
    expect(result.runningMass).toBeCloseTo(8349.1, 6);
    expect(result.payloadMass).toBe(8900); // 8400 + 500
    expect(result.totalMass).toBeCloseTo(17249.1, 6);
    // ISPRAVKA (3): the sign matches the axle-load tool, computed − limit.
    expect(result.total.minusLimit).toBeCloseTo(-750.9, 6); // 17249.1 - 18000
    expect(result.total.ratio).toBeCloseTo(0.958283, 5); // 17249.1/18000
    // N = 18000 - 8349.1 = 9650.9; used = 8900/9650.9
    expect(result.payloadHeadroom).toBeCloseTo(9650.9, 6);
    expect(result.headroomUsed).toBeCloseTo(0.9222, 4);
    // ISPRAVKA (4): a kilogram figure, reduced by the packaging tare: 9650.9 - 500.
    expect(result.vehicleCargoHeadroom).toBeCloseTo(9150.9, 6);
    // Single mode: this would only repeat `vehicleCargoHeadroom` under a second name.
    expect(result.combinationCargoHeadroom).toBeUndefined();
    expect(result.minCargoHeadroom).toBeCloseTo(9150.9, 6);
  });

  it("does not re-add fuel and crew when the tare already reads as running-order mass", () => {
    // Same vehicle as the first vector, but the tare on the papers already
    // includes fuel, AdBlue, crew and equipment — 8349.1 kg running order.
    const result = grossMassAndPayload({
      mode: "single",
      vehicleTare: 8349.1,
      tareIncludesFuelAndCrew: true,
      fuelLitres: 300,
      fuelDensity: 0.835,
      adBlueLitres: 40,
      adBlueDensity: 1.09,
      crew: 85,
      equipment: 0, // already folded into the tare; only NOT re-added by the switch
      packaging: 500,
      cargo: 8400,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // runningMass = tare + equipment only — fuel/AdBlue/crew are reported but not re-summed.
    expect(result.runningMass).toBeCloseTo(8349.1, 6);
    expect(result.fuelMass).toBeCloseTo(250.5, 6); // still reported as a fact
    expect(result.totalMass).toBeCloseTo(17249.1, 6); // same total as the un-switched vector
  });

  it("splits a tractor-semitrailer combination and shows the whole-mass limit only", () => {
    const result = grossMassAndPayload({
      mode: "combination",
      vehicleTare: 8000,
      tareIncludesFuelAndCrew: false,
      trailerTare: 7000,
      fuelLitres: 600,
      fuelDensity: 0.835,
      adBlueLitres: 0,
      crew: 80,
      equipment: 0,
      packaging: 0,
      cargo: 24000,
      combinationLimit: 40000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ms = 8000 + 600·0.835 + 80 + 7000 = 8000 + 501 + 80 + 7000
    expect(result.combinationEmptyMass).toBeCloseTo(15581, 6);
    expect(result.totalMass).toBeCloseTo(39581, 6);
    expect(result.total.minusLimit).toBeCloseTo(-419, 6); // 39581 - 40000
    expect(result.total.ratio).toBeCloseTo(0.98953, 4); // 39581/40000
    // N = 40000 - 15581 = 24419; used = 24000/24419
    expect(result.headroomUsed).toBeCloseTo(0.9828, 4);
    expect(result.combinationCargoHeadroom).toBeCloseTo(24419, 6);
  });

  it("refuses a fuel volume without a density, and a mass outside its range", () => {
    const base = {
      mode: "single" as const,
      vehicleTare: 7850,
      tareIncludesFuelAndCrew: false,
      fuelLitres: 300,
      adBlueLitres: 0,
      crew: 85,
      equipment: 0,
      packaging: 0,
      cargo: 0,
    };
    expect(grossMassAndPayload(base)).toEqual({ ok: false, reason: "fuelDensity" });
    expect(grossMassAndPayload({ ...base, fuelDensity: 0.835, vehicleTare: -1 })).toEqual({
      ok: false,
      reason: "vehicleTare",
    });
  });

  it("draws no ratio when no limit is typed", () => {
    const result = grossMassAndPayload({
      mode: "single",
      vehicleTare: 7850,
      tareIncludesFuelAndCrew: false,
      fuelLitres: 0,
      adBlueLitres: 0,
      crew: 0,
      equipment: 0,
      packaging: 0,
      cargo: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total.ratio).toBeUndefined();
    expect(result.payloadHeadroom).toBeUndefined();
    expect(result.minCargoHeadroom).toBeUndefined();
  });
});

describe("lashingForce", () => {
  it("computes a top-over arrangement in all three directions at once — 6 lashings, α=80°, k=0.5", () => {
    const result = lashingForce({
      method: "topOver",
      mass: 2000,
      forwardCoefficient: 0.8,
      backwardCoefficient: 0.5,
      lateralCoefficient: 0.6,
      friction: 0.3,
      verticalAngle: 80,
      transferFactor: 0.5,
      stf: 400,
      lashings: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // G = 2000·9.80665/10 = 19613.3/10
    expect(result.weight).toBeCloseTo(1961.33, 2);
    expect(result.frictionForce).toBeCloseTo(588.399, 2); // 0.3·1961.33 — same in every direction
    // Fv = 400·sin80°·1.5 = 400·0.9848078·1.5
    expect(result.verticalForce).toBeCloseTo(590.885, 2);
    // perLashing/setForce are the ARRANGEMENT's own geometry — one number, not one per direction.
    expect(result.perLashing).toBeCloseTo(177.2654, 3); // 0.3·590.885
    expect(result.perLashingKn).toBeCloseTo(1.772654, 4); // ·10/1000
    expect(result.setForce).toBeCloseTo(1063.5924, 3); // 6·177.2654
    expect(result.setForceKn).toBeCloseTo(10.635924, 4);
    // Forward: Fd = 0.8·1961.33 = 1569.064; Fp = 1569.064 - 588.399 = 980.665.
    expect(result.forward.drivingForce).toBeCloseTo(1569.064, 2);
    expect(result.forward.remainingForce).toBeCloseTo(980.665, 2);
    expect(result.forward.quotient).toBeCloseTo(5.532185, 4); // 980.665/177.2654
    expect(result.forward.setRatio).toBeCloseTo(1.084562, 4); // 1063.5924/980.665
    // Backward: Fd = 0.5·1961.33 = 980.665; Fp = 980.665 - 588.399 = 392.266.
    expect(result.backward.drivingForce).toBeCloseTo(980.665, 2);
    expect(result.backward.remainingForce).toBeCloseTo(392.266, 2);
    expect(result.backward.quotient).toBeCloseTo(2.212874, 4);
    expect(result.backward.setRatio).toBeCloseTo(2.711406, 4);
    // Lateral: Fd = 0.6·1961.33 = 1176.798; Fp = 1176.798 - 588.399 = 588.399.
    expect(result.lateral.drivingForce).toBeCloseTo(1176.798, 2);
    expect(result.lateral.remainingForce).toBeCloseTo(588.399, 2);
    expect(result.lateral.quotient).toBeCloseTo(3.319311, 4);
    expect(result.lateral.setRatio).toBeCloseTo(1.807604, 4);
  });

  it("computes a direct (diagonal) arrangement — α=30°, β=20°, 2 lashings, all three directions", () => {
    const result = lashingForce({
      method: "direct",
      mass: 5000,
      forwardCoefficient: 0.8,
      backwardCoefficient: 0.5,
      lateralCoefficient: 0.6,
      friction: 0.3,
      verticalAngle: 30,
      horizontalAngle: 20,
      lc: 2000,
      lashings: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.weight).toBeCloseTo(4903.325, 2);
    expect(result.frictionForce).toBeCloseTo(1470.9975, 3); // 0.3·4903.325
    // along = cos30°·cos20° = 0.8660254·0.9396926; +μ·sin30° = +0.15
    expect(result.perLashing).toBeCloseTo(1927.5954, 3);
    expect(result.setForce).toBeCloseTo(3855.1907, 3); // 2·1927.5954
    // Forward: Fd = 0.8·4903.325 = 3922.66; Fp = 3922.66 - 1470.9975 = 2451.6625.
    expect(result.forward.remainingForce).toBeCloseTo(2451.6625, 3);
    expect(result.forward.quotient).toBeCloseTo(1.271876, 4);
    expect(result.forward.setRatio).toBeCloseTo(1.572480, 4);
    // Backward: Fd = 0.5·4903.325 = 2451.6625; Fp = 2451.6625 - 1470.9975 = 980.665.
    expect(result.backward.remainingForce).toBeCloseTo(980.665, 3);
    expect(result.backward.quotient).toBeCloseTo(0.508750, 4);
    expect(result.backward.setRatio).toBeCloseTo(3.931200, 4);
    // Lateral: Fd = 0.6·4903.325 = 2941.995; Fp = 2941.995 - 1470.9975 = 1470.9975.
    expect(result.lateral.remainingForce).toBeCloseTo(1470.9975, 3);
    expect(result.lateral.quotient).toBeCloseTo(0.763126, 4);
    expect(result.lateral.setRatio).toBeCloseTo(2.620800, 4);
  });

  it("shows only the force blocking must take, with no lashing count at all, per direction", () => {
    const result = lashingForce({
      method: "blocking",
      mass: 2000,
      forwardCoefficient: 0.8,
      backwardCoefficient: 0.5,
      lateralCoefficient: 0.6,
      friction: 0.3,
      lashings: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forward.remainingForce).toBeCloseTo(980.665, 2);
    expect(result.backward.remainingForce).toBeCloseTo(392.266, 2);
    expect(result.perLashing).toBeUndefined();
    expect(result.setForce).toBeUndefined();
    expect(result.forward.quotient).toBeUndefined();
    expect(result.forward.setRatio).toBeUndefined();
  });

  it("gives no remaining force to secure when friction alone already exceeds the driving coefficient", () => {
    const result = lashingForce({
      method: "blocking",
      mass: 1000,
      forwardCoefficient: 0.3,
      backwardCoefficient: 0.3,
      lateralCoefficient: 0.3,
      friction: 0.5, // μ ≥ c in every direction
      lashings: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forward.remainingForce).toBeLessThanOrEqual(0);
    expect(result.backward.remainingForce).toBeLessThanOrEqual(0);
    expect(result.lateral.remainingForce).toBeLessThanOrEqual(0);
  });

  it("refuses when no securing coefficient was typed at all, and an out-of-range mass", () => {
    expect(
      lashingForce({
        method: "blocking",
        mass: 0, // below the 1 kg minimum
        forwardCoefficient: 0.5,
        backwardCoefficient: 0.5,
        lateralCoefficient: 0.5,
        friction: 0.3,
        lashings: 0,
      }),
    ).toEqual({ ok: false, reason: "mass" });
  });

  it("refuses a direct arrangement with no horizontal angle typed, rather than assuming β = 0", () => {
    // β = 0 (the default a fallback would silently use) is the SINGLE MOST
    // FAVOURABLE value — cos 0° = 1 — so an unstated angle must refuse, not
    // quietly overstate what one lashing delivers.
    const result = lashingForce({
      method: "direct",
      mass: 5000,
      forwardCoefficient: 0.8,
      backwardCoefficient: 0.5,
      lateralCoefficient: 0.6,
      friction: 0.3,
      verticalAngle: 30,
      lc: 2000,
      lashings: 2,
    });
    expect(result).toEqual({ ok: false, reason: "horizontalAngle" });
  });

  it("reads a direct α=90°, μ=0 arrangement as Fe=0 (life-safety), not an astronomical quotient", () => {
    // ISPRAVKA (2) requires Fe=0 be refused before q — α=90° (vertical) with
    // μ=0 (iced/greased deck) is one of the two cases it names, and both are
    // inside this tool's own accepted ranges. In IEEE double, cos(90°) is
    // 6.123233995736766e-17, not exactly 0, so without the tolerance
    // perLashing comes out ≈ 2000·6.123233995736766e-17·cos(20°)
    // ≈ 1.15e-13 daN — a tiny POSITIVE number that would pass a bare `> 0`
    // guard and produce an implausible q, worse than the Infinity the rule
    // exists to prevent.
    const result = lashingForce({
      method: "direct",
      mass: 5000,
      forwardCoefficient: 0.8,
      backwardCoefficient: 0.5,
      lateralCoefficient: 0.6,
      friction: 0,
      verticalAngle: 90,
      horizontalAngle: 20,
      lc: 2000,
      lashings: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perLashing).toBe(0);
    expect(result.setForce).toBe(0); // 4·0
    expect(result.forward.quotient).toBeUndefined();
    expect(result.forward.setRatio).toBeUndefined();
  });
});

describe("drivingSchedule", () => {
  it("lays out an 8-hour drive with one break, and the clock at which each remaining limit is used up", () => {
    const result = drivingSchedule({
      departureMinuteOfDay: 360, // 06:00
      plannedDrivingMinutes: 480,
      continuousLimit: 270, // 4:30
      breakMinutes: 45,
      dailyLimit: 540, // 9:00
      dailyRestMinutes: 660,
      splitBreak: false,
      drivenSinceBreak: 0,
      drivenToday: 0,
      otherWork: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks.map((b) => b.kind)).toEqual(["drive", "break", "drive"]);
    expect(result.blocks[0]?.minutes).toBe(270);
    expect(result.blocks[1]?.minutes).toBe(45);
    expect(result.blocks[2]?.minutes).toBe(210); // 480 - 270
    // Block counters: after 270 min of driving, sinceBreak/today both read 270;
    // the (unsplit) break resets sinceBreak to 0 but leaves today at 270;
    // the final 210 min of driving brings both back up to 480.
    expect(result.blocks[0]?.sinceBreakAfter).toBe(270);
    expect(result.blocks[0]?.todayAfter).toBe(270);
    expect(result.blocks[1]?.breakPart).toBe("full");
    expect(result.blocks[1]?.sinceBreakAfter).toBe(0);
    expect(result.blocks[1]?.todayAfter).toBe(270);
    expect(result.blocks[2]?.sinceBreakAfter).toBe(210);
    expect(result.blocks[2]?.todayAfter).toBe(480);
    expect(result.arrivalMinuteOfDay).toBe(885); // 14:45
    expect(result.arrivalDayOffset).toBe(0);
    expect(result.elapsedMinutes).toBe(525); // 8:45
    expect(result.drivingMinutes).toBe(480);
    expect(result.breakMinutes).toBe(45);
    expect(result.today.ratio).toBeCloseTo(0.888889, 5); // 480/540
    // Both remaining allowances (60 min each) run out at the same clock time.
    expect(result.continuousLimitReachedAt).toBe(945); // 15:45
    expect(result.dailyLimitReachedAt).toBe(945);
    expect(result.truncated).toBe(false);
    expect(result.unplacedOtherWork).toEqual([]);
  });

  it("inserts other work, then a daily rest, and carries the plan past midnight", () => {
    const result = drivingSchedule({
      departureMinuteOfDay: 300, // 05:00
      plannedDrivingMinutes: 660,
      continuousLimit: 270,
      breakMinutes: 45,
      dailyLimit: 540,
      dailyRestMinutes: 660,
      splitBreak: false,
      drivenSinceBreak: 0,
      drivenToday: 0,
      otherWork: [{ minutes: 60, afterDrivingMinutes: 0 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks.map((b) => b.kind)).toEqual([
      "otherWork",
      "drive",
      "break",
      "drive",
      "dailyRest",
      "drive",
    ]);
    expect(result.arrivalDayOffset).toBe(1);
    expect(result.arrivalMinuteOfDay).toBe(285); // 04:45
    expect(result.elapsedMinutes).toBe(1425); // 23:45
    expect(result.drivingMinutes).toBe(660); // 11:00
    expect(result.breakMinutes).toBe(45);
    expect(result.restMinutes).toBe(660);
    expect(result.otherWorkMinutes).toBe(60);
  });

  it("derives the planned driving from distance and speed when no minutes are typed", () => {
    const result = drivingSchedule({
      departureMinuteOfDay: 360,
      distance: 340,
      averageSpeed: 68, // 60·340/68 = 300 min exactly
      continuousLimit: 270,
      breakMinutes: 45,
      dailyLimit: 540,
      dailyRestMinutes: 660,
      splitBreak: false,
      drivenSinceBreak: 0,
      drivenToday: 0,
      otherWork: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drivingMinutes).toBe(300);
  });

  it("refuses a non-positive limit rather than looping without progress", () => {
    const base = {
      departureMinuteOfDay: 360,
      plannedDrivingMinutes: 100,
      continuousLimit: 270,
      breakMinutes: 45,
      dailyLimit: 540,
      dailyRestMinutes: 660,
      splitBreak: false,
      drivenSinceBreak: 0,
      drivenToday: 0,
      otherWork: [],
    };
    expect(drivingSchedule({ ...base, continuousLimit: 0 })).toEqual({
      ok: false,
      reason: "continuousLimit",
    });
    expect(drivingSchedule({ ...base, dailyRestMinutes: -1 })).toEqual({
      ok: false,
      reason: "dailyRestMinutes",
    });
  });

  it("splits the break: the first part does NOT reset the continuous allowance, only the second does", () => {
    const result = drivingSchedule({
      departureMinuteOfDay: 0,
      plannedDrivingMinutes: 300,
      continuousLimit: 270,
      breakMinutes: 45,
      dailyLimit: 540,
      dailyRestMinutes: 660,
      splitBreak: true,
      firstBreakPart: 15,
      drivingBeforeFirstPart: 200,
      drivenSinceBreak: 0,
      drivenToday: 0,
      otherWork: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks.map((b) => b.kind)).toEqual(["drive", "break", "drive", "break", "drive"]);
    expect(result.blocks.map((b) => b.minutes)).toEqual([200, 15, 70, 30, 30]);
    expect(result.blocks[1]?.breakPart).toBe("first");
    // The second part's own length is `breakMinutes − firstPart` = 45 − 15 = 30.
    expect(result.blocks[3]?.breakPart).toBe("second");
    // sinceBreakAfter: 200 after the first drive; UNCHANGED at 200 through the
    // first part (it buys nothing back); 270 after the second drive leg
    // (200+70); reset to 0 by the second part; 30 after the final drive.
    expect(result.blocks.map((b) => b.sinceBreakAfter)).toEqual([200, 200, 270, 0, 30]);
    expect(result.drivingMinutes).toBe(300);
    expect(result.breakMinutes).toBe(45);
  });

  it("refuses a first break part at or beyond the whole break's own length", () => {
    const result = drivingSchedule({
      departureMinuteOfDay: 0,
      plannedDrivingMinutes: 300,
      continuousLimit: 270,
      breakMinutes: 45,
      dailyLimit: 540,
      dailyRestMinutes: 660,
      splitBreak: true,
      firstBreakPart: 45, // leaves nothing for a second part
      drivingBeforeFirstPart: 200,
      drivenSinceBreak: 0,
      drivenToday: 0,
      otherWork: [],
    });
    expect(result).toEqual({ ok: false, reason: "firstBreakPart" });
  });

  it("takes a break (not a drive) as the FIRST block when already over the continuous allowance", () => {
    const result = drivingSchedule({
      departureMinuteOfDay: 0,
      plannedDrivingMinutes: 60,
      continuousLimit: 270,
      breakMinutes: 45,
      dailyLimit: 540,
      dailyRestMinutes: 660,
      splitBreak: false,
      drivenSinceBreak: 280, // already past the 270 continuous limit
      drivenToday: 100,
      otherWork: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks[0]?.kind).toBe("break");
    expect(result.blocks[0]?.breakPart).toBe("full");
  });

  it("takes a DAILY REST as the first block when over the daily limit, even under the continuous one", () => {
    const result = drivingSchedule({
      departureMinuteOfDay: 0,
      plannedDrivingMinutes: 60,
      continuousLimit: 270,
      breakMinutes: 45,
      dailyLimit: 540,
      dailyRestMinutes: 660,
      splitBreak: false,
      drivenSinceBreak: 0,
      drivenToday: 550, // already past the 540 daily limit
      otherWork: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Daily rest is checked BEFORE the break — a driver out of daily driving
    // does not fix that with 45 minutes.
    expect(result.blocks[0]?.kind).toBe("dailyRest");
  });

  it("lists an other-work row past the end of the plan as unplaced, instead of dropping it silently", () => {
    const result = drivingSchedule({
      departureMinuteOfDay: 0,
      plannedDrivingMinutes: 300,
      continuousLimit: 270,
      breakMinutes: 45,
      dailyLimit: 540,
      dailyRestMinutes: 660,
      splitBreak: false,
      drivenSinceBreak: 0,
      drivenToday: 0,
      otherWork: [{ minutes: 30, afterDrivingMinutes: 700 }], // beyond the 300 min plan
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks.map((b) => b.kind)).toEqual(["drive", "break", "drive"]);
    expect(result.otherWorkMinutes).toBe(0);
    expect(result.unplacedOtherWork).toEqual([{ minutes: 30, afterDrivingMinutes: 700 }]);
  });

  it("shows what was computed and marks the plan truncated once 200 blocks is reached", () => {
    // continuousLimit = breakMinutes = 1 forces a fresh block every single
    // minute of driving, so the 200-block cap is reached long before a plan
    // this long could otherwise finish.
    const result = drivingSchedule({
      departureMinuteOfDay: 0,
      plannedDrivingMinutes: 5940, // the 99-hour maximum
      continuousLimit: 1,
      breakMinutes: 1,
      dailyLimit: 1440,
      dailyRestMinutes: 1440,
      splitBreak: false,
      drivenSinceBreak: 0,
      drivenToday: 0,
      otherWork: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks.length).toBe(200);
    expect(result.truncated).toBe(true);
    // 100 drive/break cycles of 1 minute each drove 100 of the 5940 minutes.
    expect(result.drivingMinutes).toBe(100);
    expect(result.remainingDriving).toBe(5840);
  });
});

describe("etaWithBreaks", () => {
  it("adds driving time, stops and a reserve applied to BOTH — 620 km at 68 km/h", () => {
    const result = etaWithBreaks({
      distance: 620,
      averageSpeed: 68,
      departureMinuteOfDay: 440, // 07:20
      stopMinutes: [90, 40, 60],
      reserve: 0.05,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // tv = 60·620/68 = 37200/68
    expect(result.drivingMinutes).toBeCloseTo(547.058824, 5);
    expect(result.stopMinutes).toBe(190);
    expect(result.totalMinutes).toBeCloseTo(737.058824, 5);
    // ·1.05
    expect(result.totalWithReserve).toBeCloseTo(773.911765, 5);
    expect(result.arrivalDayOffset).toBe(0);
    expect(result.arrivalMinuteOfDay).toBeCloseTo(1213.911765, 5); // 440 + 773.911765
    // 620/(773.911765/60)
    expect(result.doorToDoorSpeed).toBeCloseTo(48.07, 2);
    // The same quotient WITHOUT the reserve — shown beside it so the reserve's
    // own cost (48.07 vs 50.47) is visible instead of only one figure.
    expect(result.doorToDoorSpeedNoReserve).toBeCloseTo(50.47, 2); // 620/(737.058824/60)
  });

  it("solves the latest departure and the required moving speed for a target arrival", () => {
    const result = etaWithBreaks({
      distance: 180,
      averageSpeed: 60,
      departureMinuteOfDay: 480, // 08:00
      stopMinutes: [],
      reserve: 0,
      targetMinuteOfDay: 630, // 10:30
      targetDayOffset: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.arrivalMinuteOfDay).toBe(660); // 11:00
    expect(result.doorToDoorSpeed).toBeCloseTo(60, 6);
    expect(result.target?.available).toBe(150); // 630 - 480
    expect(result.target?.latestDeparture).toBe(450); // 630 - 180 = 07:30
    // 60·180/(150 - 0)
    expect(result.target?.requiredSpeed).toBeCloseTo(72, 6);
    // The denominator itself, printed so a reader sees how far it is from zero.
    expect(result.target?.minutesAvailableForDriving).toBeCloseTo(150, 6);
  });

  it("reports no required speed at all when the target is at or before departure", () => {
    const result = etaWithBreaks({
      distance: 100,
      averageSpeed: 60,
      departureMinuteOfDay: 600,
      stopMinutes: [],
      reserve: 0,
      targetMinuteOfDay: 500, // earlier the SAME day
      targetDayOffset: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target?.available).toBeLessThan(0);
    expect(result.target?.requiredSpeed).toBeUndefined();
  });

  it("refuses a non-positive average speed and an out-of-range departure minute", () => {
    const base = { distance: 100, averageSpeed: 60, departureMinuteOfDay: 480, stopMinutes: [], reserve: 0 };
    expect(etaWithBreaks({ ...base, averageSpeed: 0 })).toEqual({ ok: false, reason: "averageSpeed" });
    expect(etaWithBreaks({ ...base, departureMinuteOfDay: 1440 })).toEqual({
      ok: false,
      reason: "departure",
    });
  });
});

describe("serviceInterval", () => {
  it("finds the first basis due and the days to the next one — km, hours and months together", () => {
    const result = serviceInterval({
      currentKm: 412350,
      lastServiceKm: 398000,
      distanceInterval: 45000,
      currentHours: 9420,
      lastServiceHours: 8990,
      hoursInterval: 800,
      lastServiceDate: { year: 2026, month: 2, day: 14 },
      monthsInterval: 12,
      kmPerDay: 480,
      hoursPerDay: 11,
      today: { year: 2026, month: 8, day: 13 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.travelledKm).toBe(14350); // 412350 - 398000
    expect(result.travelledHours).toBe(430);
    // Rk = 45000 - 14350 = 30650; 30650/480 = 63.854 → 64 days → 16 Oct 2026
    expect(result.distance?.remaining).toBe(30650);
    expect(result.distance?.days).toBe(64);
    expect(result.distance?.date).toEqual({ year: 2026, month: 10, day: 16 });
    // Rh = 800 - 430 = 370; 370/11 = 33.64 → 34 days → 16 Sep 2026
    expect(result.hours?.remaining).toBe(370);
    expect(result.hours?.days).toBe(34);
    expect(result.hours?.date).toEqual({ year: 2026, month: 9, day: 16 });
    expect(result.months?.date).toEqual({ year: 2027, month: 2, day: 14 });
    expect(result.first).toBe("hours");
    expect(result.daysToNext).toBe(30); // 64 - 34
    // K = 14350/430
    expect(result.kmPerEngineHour).toBeCloseTo(33.372093, 5);
    expect(result.distanceIntervalInHours).toBeCloseTo(1348.4, 1); // 45000/33.372093
    expect(result.hoursIntervalInKm).toBeCloseTo(26697.7, 1); // 800·33.372093
    // The absolute reading each basis falls due at — what goes on a work order.
    expect(result.distance?.dueAt).toBe(443000); // 398000 + 45000
    expect(result.hours?.dueAt).toBe(9790); // 8990 + 800
    expect(result.months?.dueAt).toBeUndefined(); // due on a DATE, not a reading
  });

  it("rounds an OVERDUE basis away from zero, not toward it — ceil(-0.02…) would read as due today", () => {
    const result = serviceInterval({
      currentKm: 399010, // 10 km past the 1000 km interval
      lastServiceKm: 398000,
      distanceInterval: 1000,
      currentHours: 0,
      lastServiceHours: 0,
      kmPerDay: 480,
      hoursPerDay: 8,
      today: { year: 2026, month: 8, day: 13 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Rk = 1000 - 1010 = -10; -10/480 = -0.02083…
    expect(result.distance?.remaining).toBe(-10);
    // Math.floor(-0.02083) = -1, NOT Math.ceil(-0.02083) = -0 — the whole point
    // of the fix: „-0" would print as due TODAY for a basis already overdue.
    expect(result.distance?.days).toBe(-1);
    expect(result.distance?.date).toEqual({ year: 2026, month: 8, day: 12 });
    expect(result.distance?.dueAt).toBe(399000); // 398000 + 1000, already passed
  });

  it("leaves the months basis out of the comparison entirely when no service date was typed", () => {
    const result = serviceInterval({
      currentKm: 120000,
      lastServiceKm: 118500,
      distanceInterval: 15000,
      currentHours: 4000,
      lastServiceHours: 3950,
      hoursInterval: 500,
      kmPerDay: 300,
      hoursPerDay: 8,
      today: { year: 2026, month: 1, day: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.months).toBeUndefined();
    // Rk = 15000-1500=13500; 13500/300=45
    expect(result.distance?.days).toBe(45);
    // Rh = 500-50=450; ceil(450/8)=ceil(56.25)=57
    expect(result.hours?.days).toBe(57);
    expect(result.first).toBe("distance");
    expect(result.daysToNext).toBe(12); // 57 - 45
    expect(result.kmPerEngineHour).toBeCloseTo(30, 6); // 1500/50
    // 15000/30 = 500, exactly the hours interval
    expect(result.distanceIntervalInHours).toBeCloseTo(500, 6);
  });

  it("refuses a current reading below the last-service reading rather than a negative travelled distance", () => {
    const result = serviceInterval({
      currentKm: 1000,
      lastServiceKm: 2000,
      currentHours: 0,
      lastServiceHours: 0,
      kmPerDay: 300,
      hoursPerDay: 8,
      today: { year: 2026, month: 1, day: 1 },
    });
    expect(result).toEqual({ ok: false, reason: "currentKm" });
  });

  it("treats a zero interval as the basis switched off in the two conversion rows too", () => {
    // „interval prazan ili 0 — osnovica je isključena" — already honoured for
    // the basis itself (distance/hours come back undefined below), but the
    // two conversion rows tested only `=== undefined`, so a 0 interval — the
    // documented way to switch a basis off — still divided or multiplied
    // through kmPerEngineHour and printed a false „0 h" / would-be figure.
    const result = serviceInterval({
      currentKm: 100300,
      lastServiceKm: 100000,
      distanceInterval: 0,
      currentHours: 4010,
      lastServiceHours: 4000,
      hoursInterval: 0,
      kmPerDay: 300,
      hoursPerDay: 8,
      today: { year: 2026, month: 1, day: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distance).toBeUndefined();
    expect(result.hours).toBeUndefined();
    // kmPerEngineHour = 300/10 = 30 — defined, so the old bug would have
    // printed distanceIntervalInHours = quotient(0, 30) = 0 here.
    expect(result.kmPerEngineHour).toBeCloseTo(30, 6);
    expect(result.distanceIntervalInHours).toBeUndefined();
    expect(result.hoursIntervalInKm).toBeUndefined();
  });
});

describe("fuelConsumption", () => {
  it("computes consumption, mpg and cost per tonne-km — 645 km on 187.4 l", () => {
    const result = fuelConsumption({
      distance: 645,
      litres: 187.4,
      pricePerLitre: 199.9,
      cargoTonnes: 22,
      fuelRemaining: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // C100 = 100·187.4/645 = 18740/645
    expect(result.per100Km).toBeCloseTo(29.054264, 5);
    expect(result.kmPerLitre).toBeCloseTo(3.441836, 5);
    // mpg(US) = E·3.785411784/1.609344
    expect(result.mpgUs).toBeCloseTo(8.096, 2);
    expect(result.mpgImperial).toBeCloseTo(9.723, 2);
    // T = 187.4·199.9 = 37480 - 18.74
    expect(result.totalCost).toBeCloseTo(37461.26, 2);
    expect(result.costPerKm).toBeCloseTo(58.0795, 3); // 37461.26/645
    expect(result.tonneKm).toBe(14190); // 22·645
    expect(result.litresPer100TonneKm).toBeCloseTo(1.3206, 3); // 18740/14190
    expect(result.costPerTonneKm).toBeCloseTo(2.64, 3); // 37461.26/14190
    expect(result.range).toBeUndefined(); // fuelRemaining = 0
  });

  it("leaves the tonne-km rows out entirely when no cargo mass is given, and computes the range", () => {
    const result = fuelConsumption({
      distance: 100,
      litres: 7.5,
      pricePerLitre: 200,
      cargoTonnes: 0,
      fuelRemaining: 42,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.per100Km).toBeCloseTo(7.5, 6);
    expect(result.kmPerLitre).toBeCloseTo(13.333333, 5);
    expect(result.mpgUs).toBeCloseTo(31.362, 2);
    expect(result.mpgImperial).toBeCloseTo(37.664, 2);
    expect(result.totalCost).toBe(1500);
    expect(result.costPerKm).toBe(15);
    expect(result.tonneKm).toBeUndefined();
    expect(result.litresPer100TonneKm).toBeUndefined();
    // R = 100·42/7.5
    expect(result.range).toBeCloseTo(560, 6);
  });

  it("uses the odometer difference over the typed distance when both readings are given", () => {
    const result = fuelConsumption({
      distance: 999999, // must be IGNORED once both odometer readings are present
      odometerStart: 100000,
      odometerEnd: 100500,
      litres: 50,
      pricePerLitre: 0,
      cargoTonnes: 0,
      fuelRemaining: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distance).toBe(500);
    expect(result.totalCost).toBe(0); // a price of 0 is a legitimate answer, not a refusal
  });

  it("refuses a zero or negative distance from the odometer readings, and litres out of range", () => {
    expect(
      fuelConsumption({
        distance: 100,
        odometerStart: 500,
        odometerEnd: 400, // end before start
        litres: 10,
        pricePerLitre: 0,
        cargoTonnes: 0,
        fuelRemaining: 0,
      }),
    ).toEqual({ ok: false, reason: "odometer" });
    expect(
      fuelConsumption({ distance: 100, litres: 0, pricePerLitre: 0, cargoTonnes: 0, fuelRemaining: 0 }),
    ).toEqual({ ok: false, reason: "litres" });
  });

  it("refuses a HALF-typed odometer pair rather than silently falling back to `distance`", () => {
    // A reader who typed only the end reading has no way to tell that apart
    // from the odometer never having been used at all — so it must refuse.
    expect(
      fuelConsumption({
        distance: 999999, // must NOT be used
        odometerEnd: 100500,
        litres: 50,
        pricePerLitre: 0,
        cargoTonnes: 0,
        fuelRemaining: 0,
      }),
    ).toEqual({ ok: false, reason: "odometer" });
    expect(
      fuelConsumption({
        distance: 999999,
        odometerStart: 100000,
        litres: 50,
        pricePerLitre: 0,
        cargoTonnes: 0,
        fuelRemaining: 0,
      }),
    ).toEqual({ ok: false, reason: "odometer" });
  });

  it("prices the tonne-kilometre only over the LADEN distance, not the empty running too", () => {
    const result = fuelConsumption({
      distance: 500, // 300 laden + 200 empty
      ladenDistance: 300,
      litres: 150,
      pricePerLitre: 200,
      cargoTonnes: 20,
      fuelRemaining: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tonneKmDistance).toBe(300);
    expect(result.tonneKm).toBe(6000); // 20·300, NOT 20·500 = 10000
    expect(result.totalCost).toBe(30000); // 150·200
    expect(result.litresPer100TonneKm).toBeCloseTo(2.5, 6); // 100·150/6000
    expect(result.costPerTonneKm).toBeCloseTo(5, 6); // 30000/6000
  });

  it("refuses the two tonne-km rates at a zero LADEN distance, rather than dividing by zero", () => {
    // ladenDistance = 0 is a valid entry (isInRange 0..100000, and a surface
    // that renders it starting at 0 is a real state) — tonneKmDistance and
    // tonneKm both come out an honest 0, but a rate PER tonne-km cannot.
    const result = fuelConsumption({
      distance: 645,
      ladenDistance: 0,
      litres: 187.4,
      pricePerLitre: 199.9,
      cargoTonnes: 22,
      fuelRemaining: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tonneKmDistance).toBe(0);
    expect(result.tonneKm).toBe(0); // 22·0 — a real fact, not a refusal
    expect(result.litresPer100TonneKm).toBeUndefined(); // NOT Infinity
    expect(result.costPerTonneKm).toBeUndefined(); // NOT Infinity
  });
});

describe("reeferFuelUse", () => {
  it("adds fuel across three running modes and gives autonomy and the trip share", () => {
    const result = reeferFuelUse({
      continuousHours: 6,
      continuousRate: 3.8,
      startStopHours: 30,
      startStopRate: 1.9,
      pullDownHours: 2,
      pullDownRate: 4.5,
      pricePerLitre: 199.9,
      tankLitres: 120,
      tractionLitres: 187.4,
      pallets: 33,
      days: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // L = 6·3.8 + 30·1.9 + 2·4.5 = 22.8 + 57 + 9
    expect(result.litres).toBeCloseTo(88.8, 6);
    expect(result.hours).toBe(38);
    expect(result.averageRate).toBeCloseTo(2.336842, 5); // 88.8/38
    expect(result.cost).toBeCloseTo(17751.12, 2); // 88.8·199.9
    expect(result.litresPerDay).toBeCloseTo(29.6, 6);
    expect(result.costPerDay).toBeCloseTo(5917.04, 1);
    expect(result.litresPerPalletDay).toBeCloseTo(0.89697, 4); // 88.8/99
    expect(result.autonomyHours).toBeCloseTo(51.351, 2); // 120/2.336842
    expect(result.autonomyDays).toBeCloseTo(2.1396, 3);
    expect(result.shareOfTripFuel).toBeCloseTo(0.321506, 5); // 88.8/276.2
    // The three autonomy-per-mode figures describe the MODE that follows, not
    // the burned mixture, so each divides the tank by its own rate alone.
    expect(result.autonomyContinuousHours).toBeCloseTo(31.578947, 5); // 120/3.8
    expect(result.autonomyStartStopHours).toBeCloseTo(63.157895, 5); // 120/1.9
    expect(result.autonomyPullDownHours).toBeCloseTo(26.666667, 5); // 120/4.5
    // A ÷ 24 assumes round-the-clock running; at the trip's own 38/3 ≈ 12.67
    // h/day it is LONGER, not shorter — fewer hours burned per day stretches
    // the same tank across more days (4.054054 > 2.1396).
    expect(result.autonomyDaysAtTripRate).toBeCloseTo(4.054054, 5); // 51.351351/(38/3)
    // Billed by the pallet, for the whole trip — not the pallet-day.
    expect(result.litresPerPallet).toBeCloseTo(2.690909, 5); // 88.8/33
    expect(result.costPerPallet).toBeCloseTo(537.912727, 3); // 88.8·199.9/33
  });

  it("leaves the pallet, day and trip-share rows out when their own inputs are absent", () => {
    const result = reeferFuelUse({
      continuousHours: 0,
      continuousRate: 0,
      startStopHours: 24,
      startStopRate: 2.2,
      pullDownHours: 0,
      pullDownRate: 0,
      pricePerLitre: 210,
      tankLitres: 150,
      tractionLitres: 0,
      pallets: 0,
      days: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.litres).toBeCloseTo(52.8, 6);
    expect(result.hours).toBe(24);
    expect(result.averageRate).toBeCloseTo(2.2, 6);
    expect(result.cost).toBe(11088);
    expect(result.autonomyHours).toBeCloseTo(68.1818, 3);
    expect(result.autonomyDays).toBeCloseTo(2.8409, 3);
    expect(result.shareOfTripFuel).toBeUndefined();
    expect(result.litresPerDay).toBeUndefined();
    expect(result.litresPerPalletDay).toBeUndefined();
  });

  it("gives no average rate at all when nothing ran, rather than dividing by zero hours", () => {
    const result = reeferFuelUse({
      continuousHours: 0,
      continuousRate: 0,
      startStopHours: 0,
      startStopRate: 0,
      pullDownHours: 0,
      pullDownRate: 0,
      pricePerLitre: 200,
      tankLitres: 100,
      tractionLitres: 0,
      pallets: 0,
      days: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hours).toBe(0);
    expect(result.averageRate).toBeUndefined();
    expect(result.autonomyHours).toBeUndefined();
  });

  it("excludes a mode's hours AND litres from the total when its rate was never typed", () => {
    // start-stop ran 30 hours but no l/h was entered for it — an absent rate is
    // NOT a rate of zero, so those 30 hours must not depress the average that
    // the other two (rated) modes are judged against.
    const result = reeferFuelUse({
      continuousHours: 6,
      continuousRate: 3.8,
      startStopHours: 30,
      pullDownHours: 2,
      pullDownRate: 4.5,
      pricePerLitre: 200,
      tankLitres: 100,
      tractionLitres: 0,
      pallets: 0,
      days: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.omittedModes).toEqual([{ mode: "startStop", hours: 30 }]);
    // L = 6·3.8 + 2·4.5 = 22.8 + 9 = 31.8; H = 6 + 2 = 8 — the 30 rate-less hours excluded.
    expect(result.litres).toBeCloseTo(31.8, 6);
    expect(result.hours).toBe(8);
    expect(result.averageRate).toBeCloseTo(3.975, 6); // 31.8/8
  });

  it("refuses autonomy when every included mode's own rate is a typed zero, not an infinite run", () => {
    // continuous and pull-down never ran (0 hours); start-stop ran 24 hours at
    // a typed 0 l/h — a reefer on electric standby, a real entry inside the
    // rate's own 0..30 range. L = 0·0 + 24·0 + 0·0 = 0; H = 0+24+0 = 24;
    // averageRate = 0/24 = 0 — DEFINED, not undefined, so the old
    // `averageRate === undefined` guard let a 150 l tank divide by that zero.
    const result = reeferFuelUse({
      continuousHours: 0,
      continuousRate: 0,
      startStopHours: 24,
      startStopRate: 0,
      pullDownHours: 0,
      pullDownRate: 0,
      pricePerLitre: 200,
      tankLitres: 150,
      tractionLitres: 0,
      pallets: 0,
      days: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.litres).toBe(0);
    expect(result.hours).toBe(24);
    expect(result.averageRate).toBe(0);
    expect(result.autonomyHours).toBeUndefined(); // NOT Infinity (150/0)
    expect(result.autonomyDays).toBeUndefined();
    expect(result.autonomyDaysAtTripRate).toBeUndefined();
  });
});

describe("costPerKm", () => {
  it("adds fixed and variable costs per km, and spreads the year over the laden km only", () => {
    const result = costPerKm({
      fixedAnnual: 3600000,
      annualKm: 120000,
      emptyShare: 0.15,
      consumptionPer100Km: 30,
      fuelPrice: 200,
      tyreSetPrice: 480000,
      tyreLifeKm: 160000,
      servicePrice: 240000,
      serviceIntervalKm: 60000,
      repairsPerKm: 8,
      adBlueShare: 0.05,
      adBluePrice: 90,
      marginOnPrice: 0.2,
      markupOnCost: 0.2,
      workingDays: 220,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fixedPerKm).toBe(30); // 3600000/120000
    expect(result.fuelPerKm).toBeCloseTo(60, 6); // 0.30·200
    expect(result.tyresPerKm).toBeCloseTo(3, 6);
    expect(result.servicePerKm).toBeCloseTo(4, 6);
    expect(result.adBluePerKm).toBeCloseTo(1.35, 6); // 0.30·0.05·90
    expect(result.variablePerKm).toBeCloseTo(76.35, 6);
    expect(result.totalPerKm).toBeCloseTo(106.35, 6);
    expect(result.ladenKm).toBeCloseTo(102000, 6); // 120000·0.85
    // annual = 106.35·120000 = 12762000; /102000
    expect(result.perLadenKm).toBeCloseTo(125.117647, 4);
    expect(result.priceAtMargin).toBeCloseTo(156.397059, 3); // /0.8
    expect(result.priceAtMarkup).toBeCloseTo(150.141176, 3); // ·1.2
    expect(result.markupEquivalent).toBeCloseTo(0.25, 6); // 0.2/0.8, reconciles with priceAtMargin
    expect(result.emptyKm).toBeCloseTo(18000, 6); // 120000 - 102000
    // (30/100)·0.05·120000 — checkable against the AdBlue supplier's invoice.
    expect(result.annualAdBlueLitres).toBeCloseTo(1800, 6);
  });

  it("leaves fuel and tyres out of the total when their own inputs are absent, instead of a silent zero", () => {
    const result = costPerKm({
      fixedAnnual: 1200000,
      annualKm: 40000,
      emptyShare: 0,
      consumptionPer100Km: 9,
      fuelPrice: 180,
      repairsPerKm: 0,
      workingDays: 220,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tyresPerKm).toBeUndefined();
    expect(result.servicePerKm).toBeUndefined();
    expect(result.fuelPerKm).toBeCloseTo(16.2, 6); // 0.09·180
    expect(result.totalPerKm).toBeCloseTo(46.2, 6);
    expect(result.ladenKm).toBe(40000); // no empty running at all
    expect(result.perLadenKm).toBeCloseTo(46.2, 6);
    expect(result.perWorkingDay).toBeCloseTo(8400, 2); // 46.2·40000/220
  });

  it("refuses an empty share at or above 100%, which would leave no laden kilometres at all", () => {
    const result = costPerKm({
      fixedAnnual: 100,
      annualKm: 1000,
      emptyShare: 1,
      repairsPerKm: 0,
      workingDays: 1,
    });
    expect(result).toEqual({ ok: false, reason: "emptyShare" });
  });

  it("refuses every optional money and rate input outside its own range, not just the required ones", () => {
    const base = {
      fixedAnnual: 100000,
      annualKm: 100000,
      emptyShare: 0.1,
      repairsPerKm: 1,
      workingDays: 220,
    };
    expect(costPerKm({ ...base, tyreSetPrice: -1 })).toEqual({ ok: false, reason: "tyreSetPrice" });
    expect(costPerKm({ ...base, servicePrice: -1 })).toEqual({ ok: false, reason: "servicePrice" });
    expect(costPerKm({ ...base, adBlueShare: 0.5 })).toEqual({ ok: false, reason: "adBlueShare" });
    expect(costPerKm({ ...base, adBluePrice: -1 })).toEqual({ ok: false, reason: "adBluePrice" });
    expect(costPerKm({ ...base, marginOnPrice: 1 })).toEqual({ ok: false, reason: "marginOnPrice" });
    expect(costPerKm({ ...base, markupOnCost: 6 })).toEqual({ ok: false, reason: "markupOnCost" });
  });
});

describe("tripCostQuote", () => {
  it("prices a trip at a margin on price, with VAT — 1400 total km", () => {
    const result = tripCostQuote({
      ladenKm: 1240,
      emptyKm: 160,
      costPerKm: 106.35,
      tolls: 18400,
      ferriesAndVignettes: 0,
      terminalCharges: 3500,
      waitingHours: 4,
      waitingRate: 2500,
      days: 4,
      perDiem: 5400,
      nights: 0,
      nightRate: 0,
      otherCosts: 0,
      marginMethod: "onPrice",
      marginOnPrice: 0.18,
      vatRate: 0.2,
      cargoTonnes: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalKm).toBe(1400);
    expect(result.drivingCost).toBeCloseTo(148890, 2); // 1400·106.35
    expect(result.roadCost).toBe(31900); // 18400+3500+10000
    expect(result.driverCost).toBe(21600); // 4·5400
    expect(result.totalCost).toBe(202390);
    expect(result.priceBeforeVat).toBeCloseTo(246817.073171, 3); // /0.82
    expect(result.profit).toBeCloseTo(44427.073171, 3);
    expect(result.profitPerDay).toBeCloseTo(11106.768293, 3);
    expect(result.vat).toBeCloseTo(49363.414634, 3);
    expect(result.priceWithVat).toBeCloseTo(296180.487805, 2);
    expect(result.pricePerKm).toBeCloseTo(176.297909, 3);
    expect(result.pricePerLadenKm).toBeCloseTo(199.046027, 6); // 246817.073171/1240
    // priceAtMargin is `priceBeforeVat` again, by construction of this method;
    // priceAtMarkup is undefined because no markupOnCost was typed at all.
    expect(result.priceAtMargin).toBeCloseTo(246817.073171, 3);
    expect(result.priceAtMarkup).toBeUndefined();
    expect(result.markupEquivalent).toBeCloseTo(0.219512, 5); // 0.18/0.82
    expect(result.breakEvenPricePerKm).toBeCloseTo(144.564286, 4); // 202390/1400
    // profit ÷ price IS the margin rate that produced it; profit ÷ cost is the markup it implies.
    expect(result.profitShareOfPrice).toBeCloseTo(0.18, 6);
    expect(result.profitShareOfCost).toBeCloseTo(0.219512, 5);
  });

  it("computes BOTH margin methods side by side when both rates are given, joined by u = m/(1 − m)", () => {
    const result = tripCostQuote({
      ladenKm: 100,
      emptyKm: 0,
      costPerKm: 100,
      tolls: 0,
      ferriesAndVignettes: 0,
      terminalCharges: 0,
      waitingHours: 0,
      waitingRate: 0,
      days: 0,
      perDiem: 0,
      nights: 0,
      nightRate: 0,
      otherCosts: 0,
      marginMethod: "onPrice",
      marginOnPrice: 0.2, // 25% markup on cost gives the SAME price as a 20% margin on price
      markupOnCost: 0.2,
      cargoTonnes: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalCost).toBe(10000);
    expect(result.priceAtMargin).toBeCloseTo(12500, 6); // 10000/0.8
    expect(result.priceAtMarkup).toBeCloseTo(12000, 6); // 10000·1.2 — a DIFFERENT price at the same 20%
    expect(result.markupEquivalent).toBeCloseTo(0.25, 6); // 0.2/0.8 — the markup that WOULD match priceAtMargin
  });

  it("prices a short trip by markup on cost — the same 25% gives a different number than a margin would", () => {
    const result = tripCostQuote({
      ladenKm: 60,
      emptyKm: 20,
      costPerKm: 90,
      tolls: 0,
      ferriesAndVignettes: 0,
      terminalCharges: 0,
      waitingHours: 0,
      waitingRate: 0,
      days: 0,
      perDiem: 0,
      nights: 0,
      nightRate: 0,
      otherCosts: 0,
      marginMethod: "onCost",
      markupOnCost: 0.25,
      vatRate: 0.2,
      cargoTonnes: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalCost).toBe(7200); // 80·90
    expect(result.priceBeforeVat).toBe(9000); // 7200·1.25
    expect(result.profit).toBe(1800);
    expect(result.vat).toBe(1800);
    expect(result.priceWithVat).toBe(10800);
    expect(result.pricePerKm).toBeCloseTo(112.5, 6);
    expect(result.pricePerLadenKm).toBeCloseTo(150, 6);
    expect(result.profitPerDay).toBeUndefined(); // days = 0
  });

  it("leaves every VAT row out when no rate was typed, rather than assuming one", () => {
    const result = tripCostQuote({
      ladenKm: 100,
      emptyKm: 0,
      costPerKm: 50,
      tolls: 0,
      ferriesAndVignettes: 0,
      terminalCharges: 0,
      waitingHours: 0,
      waitingRate: 0,
      days: 0,
      perDiem: 0,
      nights: 0,
      nightRate: 0,
      otherCosts: 0,
      marginMethod: "onPrice",
      marginOnPrice: 0.1,
      cargoTonnes: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vat).toBeUndefined();
    expect(result.priceWithVat).toBeUndefined();
  });

  it("refuses a margin on price at or beyond 100%, which is not a large price but no price", () => {
    const result = tripCostQuote({
      ladenKm: 100,
      emptyKm: 0,
      costPerKm: 50,
      tolls: 0,
      ferriesAndVignettes: 0,
      terminalCharges: 0,
      waitingHours: 0,
      waitingRate: 0,
      days: 0,
      perDiem: 0,
      nights: 0,
      nightRate: 0,
      otherCosts: 0,
      marginMethod: "onPrice",
      marginOnPrice: 1,
      cargoTonnes: 0,
    });
    expect(result).toEqual({ ok: false, reason: "marginOnPrice" });
  });
});

describe("chargeableWeight", () => {
  it("bills the largest of three bases — loading metre beats actual and volumetric here", () => {
    const result = chargeableWeight({
      items: [{ length: 120, width: 80, height: 160, quantity: 3, massPerPiece: 210, layers: 1 }],
      divisor: 5000,
      ldmWidth: 2.4,
      massPerLdm: 1750,
      roundingStep: 0.5,
      rounding: "perShipment",
      pricePerKg: 42,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.volume).toBeCloseTo(4.608, 6); // 120·80·160·3/1e6
    expect(result.actualMass).toBe(630); // 3·210
    expect(result.volumetricMass).toBeCloseTo(921.6, 6); // 4608000/5000
    expect(result.loadingMetres).toBeCloseTo(1.2, 6); // (120·80·3)/(10000·2.4·1)
    expect(result.loadingMetreMass).toBeCloseTo(2100, 6); // 1.2·1750
    expect(result.basis).toBe("loadingMetre");
    expect(result.chargeableMass).toBeCloseTo(2100, 6);
    expect(result.roundedPerShipment).toBeCloseTo(2100, 6);
    expect(result.billedMass).toBeCloseTo(2100, 6);
    expect(result.amount).toBeCloseTo(88200, 2); // 2100·42
  });

  it("falls back to the volumetric mass once the loading-metre basis is left out", () => {
    const result = chargeableWeight({
      items: [{ length: 120, width: 80, height: 160, quantity: 3, massPerPiece: 210, layers: 1 }],
      divisor: 5000,
      ldmWidth: 2.4,
      roundingStep: 0.5,
      rounding: "perShipment",
      pricePerKg: 42,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basis).toBe("volumetric");
    expect(result.chargeableMass).toBeCloseTo(921.6, 6);
    // ceil(921.6/0.5)·0.5 = ceil(1843.2)·0.5 = 1844·0.5
    expect(result.roundedPerShipment).toBeCloseTo(922, 6);
    expect(result.amount).toBeCloseTo(38724, 2); // 922·42
  });

  it("accepts a divisor given as kg/m³ and converts it — one pallet, weight over volume", () => {
    const result = chargeableWeight({
      items: [{ length: 120, width: 100, height: 120, quantity: 1, massPerPiece: 850, layers: 1 }],
      densityDivisor: 1000000 / 6000, // the same 6000 cm³/kg contract term, upside down
      ldmWidth: 2.4,
      massPerLdm: 1750,
      roundingStep: 0.5,
      rounding: "perShipment",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.volumetricMass).toBeCloseTo(240, 6); // 1440000/6000
    expect(result.actualMass).toBe(850);
    expect(result.loadingMetreMass).toBeCloseTo(875, 6); // 0.5·1750
    expect(result.basis).toBe("loadingMetre");
    expect(result.chargeableMass).toBeCloseTo(875, 6);
  });

  it("leaves the volumetric basis out of the maximum entirely when no divisor is given", () => {
    const result = chargeableWeight({
      items: [{ length: 100, width: 100, height: 100, quantity: 1, massPerPiece: 50, layers: 1 }],
      ldmWidth: 2.4,
      roundingStep: 1,
      rounding: "perShipment",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.volumetricMass).toBeUndefined();
    expect(result.basis).toBe("actual");
  });

  it("refuses an empty item list and a loading-metre width out of range", () => {
    expect(
      chargeableWeight({ items: [], ldmWidth: 2.4, roundingStep: 1, rounding: "perShipment" }),
    ).toEqual({ ok: false, reason: "items" });
    expect(
      chargeableWeight({
        items: [{ length: 1, width: 1, height: 1, quantity: 1, massPerPiece: 1 }],
        ldmWidth: 0,
        roundingStep: 1,
        rounding: "perShipment",
      }),
    ).toEqual({ ok: false, reason: "ldmWidth" });
  });
});

describe("loadingSpaceUtilisation", () => {
  it("compares volume, floor and loading-metre usage for 22 unstacked pallets", () => {
    const result = loadingSpaceUtilisation({
      innerLength: 13.62,
      innerWidth: 2.48,
      innerHeight: 2.7,
      items: [{ length: 1.2, width: 0.8, height: 1.6, quantity: 22, layers: 1 }],
      ldmWidth: 2.4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.availableFloorArea).toBeCloseTo(33.7776, 4);
    expect(result.availableVolume).toBeCloseTo(91.19952, 4);
    expect(result.usedVolume).toBeCloseTo(33.792, 4); // 22·1.2·0.8·1.6
    expect(result.usedFloorArea).toBeCloseTo(21.12, 4); // 22·1.2·0.8
    expect(result.usedLoadingMetres).toBeCloseTo(8.8, 4); // 21.12/2.4
    expect(result.volumeShare).toBeCloseTo(0.370528, 6); // 33.792/91.19952
    expect(result.floorShare).toBeCloseTo(0.625266, 4); // 21.12/33.7776
    expect(result.loadingMetreShare).toBeCloseTo(0.646109, 4);
    expect(result.largestBasis).toBe("loadingMetre");
    expect(result.averageStackHeight).toBeCloseTo(1.6, 4);
    expect(result.stackHeightShare).toBeCloseTo(0.592593, 4);
  });

  it("halves the floor share by stacking two layers, while the volume share rises", () => {
    const result = loadingSpaceUtilisation({
      innerLength: 13.62,
      innerWidth: 2.48,
      innerHeight: 2.7,
      items: [{ length: 1.2, width: 0.8, height: 1.2, quantity: 40, layers: 2 }],
      ldmWidth: 2.4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usedVolume).toBeCloseTo(46.08, 4); // 40·1.2·0.8·1.2
    expect(result.usedFloorArea).toBeCloseTo(19.2, 4); // 40·1.2·0.8/2
    expect(result.usedLoadingMetres).toBeCloseTo(8, 4);
    expect(result.volumeShare).toBeCloseTo(0.505263, 4);
    expect(result.floorShare).toBeCloseTo(0.568424, 6); // 19.2/33.7776
    expect(result.loadingMetreShare).toBeCloseTo(0.587371, 4);
    expect(result.averageStackHeight).toBeCloseTo(2.4, 4); // 46.08/19.2
    expect(result.stackHeightShare).toBeCloseTo(0.888889, 4);
  });

  it("flags a piece taller than the load space without excluding its volume", () => {
    const result = loadingSpaceUtilisation({
      innerLength: 10,
      innerWidth: 2.4,
      innerHeight: 2.0,
      items: [{ length: 1, width: 1, height: 2.5, quantity: 1, layers: 1 }],
      ldmWidth: 2.4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]?.tallerThanSpace).toBe(true);
    expect(result.usedVolume).toBeCloseTo(2.5, 6); // still counted
  });

  it("refuses an item list outside its bounds and an inner width out of range", () => {
    expect(
      loadingSpaceUtilisation({ innerLength: 10, innerWidth: 5, innerHeight: 2, items: [], ldmWidth: 2.4 }),
    ).toEqual({ ok: false, reason: "innerWidth" });
  });

  it("rounds floor positions up to whole columns — 41 pallets in 2 layers occupy 21, not 20.5", () => {
    const result = loadingSpaceUtilisation({
      innerLength: 13.62,
      innerWidth: 2.48,
      innerHeight: 2.7,
      items: [{ length: 1.2, width: 0.8, height: 1.2, quantity: 41, layers: 2 }],
      ldmWidth: 2.4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // columns = ceil(41/2) = 21 — an incomplete top layer still takes a whole
    // floor position, so 20 (= 41/2, what a plain division would give) is wrong.
    expect(result.usedFloorArea).toBeCloseTo(20.16, 6); // 21·1.2·0.8
    expect(result.usedLoadingMetres).toBeCloseTo(8.4, 6); // 20.16/2.4
    expect(result.usedVolume).toBeCloseTo(47.232, 6); // 41·1.2·0.8·1.2, NOT column-rounded
    expect(result.lines[0]?.floorArea).toBeCloseTo(20.16, 6);
  });

  it("checks STACKED height against the space, and flags a footprint too wide for any rotation", () => {
    const result = loadingSpaceUtilisation({
      innerLength: 10,
      innerWidth: 2.48,
      innerHeight: 2.7,
      items: [
        // Two layers of a 1.5 m piece stand 3.0 m tall — over the 2.7 m space —
        // even though ONE piece alone (1.5 m) would clear it easily.
        { length: 1.2, width: 0.8, height: 1.5, quantity: 1, layers: 2 },
        // Neither side of this footprint fits inside the 2.48 m inner width.
        { length: 3.0, width: 3.0, height: 0.5, quantity: 1, layers: 1 },
      ],
      ldmWidth: 2.4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]?.tallerThanSpace).toBe(true);
    expect(result.lines[0]?.widerThanSpace).toBe(false);
    expect(result.lines[1]?.tallerThanSpace).toBe(false);
    expect(result.lines[1]?.widerThanSpace).toBe(true);
  });

  it("does not flag a piece whose SHORTER side fits, even though its longer side alone would not", () => {
    // ISPRAVKA (5), read literally, would flag EITHER dimension exceeding the
    // inner width. This pack flags only when NEITHER orientation fits
    // (`Math.min(length, width) > innerWidth`): a 3.0 × 0.8 m piece in a
    // 2.48 m space still has an orientation (0.8 m) that clears it, and its
    // footprint arithmetic still describes something that goes in the space —
    // an intentional, recorded deviation from a literal reading of the clause.
    const result = loadingSpaceUtilisation({
      innerLength: 10,
      innerWidth: 2.48,
      innerHeight: 2.7,
      items: [{ length: 3.0, width: 0.8, height: 0.5, quantity: 1, layers: 1 }],
      ldmWidth: 2.4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]?.widerThanSpace).toBe(false);
  });
});

describe("palletLoadPlan", () => {
  it("finds a better mixed-band layout than either pure orientation — a semitrailer, EUR pallets", () => {
    const result = palletLoadPlan({
      innerLength: 13.62,
      innerWidth: 2.48,
      innerHeight: 2.7,
      palletLength: 1200,
      palletWidth: 800,
      loadedHeight: 1050,
      stacking: true,
      maxLayers: 2,
      rotationAllowed: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lengthwise.perFloor).toBe(33); // 3 across × 11 rows
    expect(result.lengthwise.usedLength).toBe(13200);
    expect(result.lengthwise.remainingLength).toBe(420);
    expect(result.crosswise?.perFloor).toBe(34); // 2 across × 17 rows
    expect(result.crosswise?.usedLength).toBe(13600);
    expect(result.crosswise?.remainingLength).toBe(20);
    expect(result.combined?.perFloor).toBe(34); // ties the pure crosswise optimum here
    expect(result.layers).toBe(2); // min(2, floor(2700/1050)=2)
    expect(result.combined?.places).toBe(68); // 34·2
    expect(result.combined?.floorArea).toBeCloseTo(32.64, 4); // 34·1.2·0.8
    expect(result.combined?.freeFloorArea).toBeCloseTo(1.1376, 4); // 33.7776 - 32.64
  });

  it("beats both pure layouts on a 20-foot container with industrial pallets", () => {
    const result = palletLoadPlan({
      innerLength: 5.9,
      innerWidth: 2.35,
      innerHeight: 2.39,
      palletLength: 1200,
      palletWidth: 1000,
      loadedHeight: 1400,
      stacking: false,
      maxLayers: 1,
      rotationAllowed: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lengthwise.perFloor).toBe(8); // 2 across × 4 rows
    expect(result.crosswise?.perFloor).toBe(5); // 1 across × 5 rows
    expect(result.combined?.perFloor).toBe(9); // beats both: 4·2 + 1·1
    expect(result.combined?.usedLength).toBe(5800);
    expect(result.combinedLengthwiseBands).toBe(4);
    expect(result.combinedCrosswiseBands).toBe(1);
    expect(result.layers).toBe(1); // stacking off
    expect(result.combined?.places).toBe(9);
  });

  it("gives no crosswise layout at all when rotation is barred", () => {
    const result = palletLoadPlan({
      innerLength: 13.62,
      innerWidth: 2.48,
      innerHeight: 2.7,
      palletLength: 1200,
      palletWidth: 800,
      loadedHeight: 1050,
      stacking: false,
      maxLayers: 1,
      rotationAllowed: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crosswise).toBeUndefined();
    expect(result.combined).toBeUndefined();
  });

  it("gives zero pallets, not a crash, when the pallet is wider than the load space", () => {
    const result = palletLoadPlan({
      innerLength: 5,
      innerWidth: 2,
      innerHeight: 2,
      palletLength: 3000, // both dimensions exceed the 2 m inside width
      palletWidth: 2999,
      loadedHeight: 1000,
      stacking: false,
      maxLayers: 1,
      rotationAllowed: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lengthwise.perFloor).toBe(0);
    expect(result.crosswise?.perFloor).toBe(0);
  });

  it("gives zero layers and zero places when a loaded pallet does not clear the height, EVEN with stacking off", () => {
    // Stacking off means „stack at most one" — it does not mean „ignore
    // height": a pallet too tall for even one layer still fits nothing.
    const result = palletLoadPlan({
      innerLength: 5,
      innerWidth: 2,
      innerHeight: 1.0, // 1000 mm
      palletLength: 1200,
      palletWidth: 800,
      loadedHeight: 1400, // taller than the 1000 mm space
      stacking: false,
      maxLayers: 1,
      rotationAllowed: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers).toBe(0);
    expect(result.lengthwise.perFloor).toBeGreaterThan(0); // the floor plan itself is fine
    expect(result.lengthwise.places).toBe(0); // perFloor · 0 layers
  });

  it("refuses an inner length and a pallet length outside their ranges", () => {
    const base = {
      innerLength: 13.62,
      innerWidth: 2.48,
      innerHeight: 2.7,
      palletLength: 1200,
      palletWidth: 800,
      loadedHeight: 1050,
      stacking: false,
      maxLayers: 1,
      rotationAllowed: true,
    };
    expect(palletLoadPlan({ ...base, innerLength: 0.1 })).toEqual({ ok: false, reason: "innerLength" });
    expect(palletLoadPlan({ ...base, palletLength: 50 })).toEqual({ ok: false, reason: "palletLength" });
  });
});

describe("tyreChangeDeviation", () => {
  it("computes the speed and odometer error of moving from a 70 to an 80 profile", () => {
    const result = tyreChangeDeviation({
      current: { width: 315, profile: 70, rim: 22.5 },
      replacement: { width: 315, profile: 80, rim: 22.5 },
      measuredCurrent: 0,
      measuredReplacement: 0,
      deflection: 1.0,
      indicatedSpeed: 85,
      indicatedDistance: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentDiameter).toBe(1012.5); // 22.5·25.4 + 2·315·0.70
    expect(result.replacementDiameter).toBe(1075.5); // 22.5·25.4 + 2·315·0.80
    expect(result.currentCircumference).toBeCloseTo(3180.863, 2); // π·1012.5
    expect(result.replacementCircumference).toBeCloseTo(3378.783, 2);
    expect(result.circumferenceRatio).toBeCloseTo(1.062222, 5); // 1075.5/1012.5
    expect(result.currentRevsPerKm).toBeCloseTo(314.38, 1);
    expect(result.replacementRevsPerKm).toBeCloseTo(295.96, 1);
    expect(result.diameterChange).toBe(63); // 1075.5 - 1012.5
    expect(result.diameterChangeShare).toBeCloseTo(0.062222, 5);
    expect(result.axleHeightChange).toBe(31.5);
    expect(result.trueSpeed).toBeCloseTo(90.29, 1); // 85·1.062222
    expect(result.trueDistance).toBeCloseTo(106.2222, 3); // 100·1.062222
    expect(result.errorPer100Km).toBeCloseTo(6.2222, 3);
    expect(result.currentFromMeasurement).toBe(false);
    expect(result.replacementFromMeasurement).toBe(false);
  });

  it("computes a small profile change — the odometer error is under half a percent", () => {
    const result = tyreChangeDeviation({
      current: { width: 205, profile: 55, rim: 16 },
      replacement: { width: 225, profile: 45, rim: 17 },
      measuredCurrent: 0,
      measuredReplacement: 0,
      deflection: 1.0,
      indicatedSpeed: 130,
      indicatedDistance: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentDiameter).toBeCloseTo(631.9, 6); // 16·25.4 + 2·205·0.55
    expect(result.replacementDiameter).toBeCloseTo(634.3, 6); // 17·25.4 + 2·225·0.45
    expect(result.circumferenceRatio).toBeCloseTo(1.003798, 5); // 634.3/631.9
    expect(result.trueSpeed).toBeCloseTo(130.49, 1);
    expect(result.diameterChange).toBeCloseTo(2.4, 6);
    expect(result.diameterChangeShare).toBeCloseTo(0.0037988, 5);
    expect(result.axleHeightChange).toBeCloseTo(1.2, 6);
    expect(result.errorPer100Km).toBeCloseTo(0.379807, 4);
  });

  it("uses a measured circumference over the geometric one when it is given", () => {
    const result = tyreChangeDeviation({
      current: { width: 315, profile: 70, rim: 22.5 },
      replacement: { width: 315, profile: 80, rim: 22.5 },
      measuredCurrent: 3100, // deliberately different from the geometric 3180.86
      measuredReplacement: 0,
      deflection: 1.0,
      indicatedSpeed: 90,
      indicatedDistance: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentCircumference).toBe(3100);
    // The mixed case the review named: one side measured, the other geometric —
    // two different scales feeding one ratio. „a measurement was used somewhere"
    // cannot say that; only the pair of per-side flags (and their XOR) can, and
    // the summary flag that could not has been removed.
    expect(result.currentFromMeasurement).toBe(true);
    expect(result.replacementFromMeasurement).toBe(false);
    expect(result.mixedSource).toBe(true);
  });

  it("carries an optional characteristic coefficient through as a plain quotient against the ratio", () => {
    const result = tyreChangeDeviation({
      current: { width: 315, profile: 70, rim: 22.5 },
      replacement: { width: 315, profile: 80, rim: 22.5 },
      measuredCurrent: 0,
      measuredReplacement: 0,
      deflection: 1.0,
      indicatedSpeed: 85,
      indicatedDistance: 100,
      characteristicCoefficient: 636, // imp/km, an odometer sensor's own w
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.w).toBe(636);
    // circumferenceRatio = 1075.5/1012.5 = 1.062222…
    expect(result.wOverRatio).toBeCloseTo(598.744770, 3); // 636/(1075.5/1012.5)
  });

  it("leaves w and wOverRatio out entirely when no characteristic coefficient was typed", () => {
    const result = tyreChangeDeviation({
      current: { width: 315, profile: 70, rim: 22.5 },
      replacement: { width: 315, profile: 80, rim: 22.5 },
      measuredCurrent: 0,
      measuredReplacement: 0,
      deflection: 1.0,
      indicatedSpeed: 85,
      indicatedDistance: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.w).toBeUndefined();
    expect(result.wOverRatio).toBeUndefined();
  });

  it("reports no change at all for two identical sizes", () => {
    const size = { width: 315, profile: 70, rim: 22.5 };
    const result = tyreChangeDeviation({
      current: size,
      replacement: size,
      measuredCurrent: 0,
      measuredReplacement: 0,
      deflection: 1.0,
      indicatedSpeed: 90,
      indicatedDistance: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.circumferenceRatio).toBeCloseTo(1, 9);
    expect(result.diameterChange).toBe(0);
    expect(result.errorPer100Km).toBeCloseTo(0, 9);
  });

  it("refuses a tyre width and a deflection factor outside their ranges", () => {
    const good = { width: 315, profile: 70, rim: 22.5 };
    expect(
      tyreChangeDeviation({
        current: { ...good, width: 50 },
        replacement: good,
        measuredCurrent: 0,
        measuredReplacement: 0,
        deflection: 1,
        indicatedSpeed: 90,
        indicatedDistance: 0,
      }),
    ).toEqual({ ok: false, reason: "tyreWidth" });
    expect(
      tyreChangeDeviation({
        current: good,
        replacement: good,
        measuredCurrent: 0,
        measuredReplacement: 0,
        deflection: 0.5,
        indicatedSpeed: 90,
        indicatedDistance: 0,
      }),
    ).toEqual({ ok: false, reason: "deflection" });
  });
});

describe("gearRoadSpeed", () => {
  it("ties engine speed to road speed through the final drive — direct top gear", () => {
    const result = gearRoadSpeed({
      engineRpm: 1400,
      gearRatio: 1.0,
      finalDrive: 2.64,
      transferRatio: 1.0,
      rollingCircumference: 3178,
      desiredSpeed: 90,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalRatio).toBeCloseTo(2.64, 6);
    expect(result.wheelRpm).toBeCloseTo(530.303, 2); // 1400/2.64
    expect(result.speed).toBeCloseTo(101.118, 2);
    expect(result.speedPer1000Rpm).toBeCloseTo(72.227, 2); // 0.06·3178/2.64
    expect(result.rpmAtDesiredSpeed).toBeCloseTo(1246.1, 0); // 90·2.64·1e6/(60·3178)
  });

  it("gives the road speed per gear and the rpm drop on the upshift, for a full gearbox", () => {
    const result = gearRoadSpeed({
      engineRpm: 2000,
      gearRatio: 3.2, // unused directly once `gears` is supplied for the table
      finalDrive: 4.1,
      transferRatio: 1.0,
      rollingCircumference: 1985,
      gears: [3.2, 2.0],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalRatio).toBeCloseTo(13.12, 6); // 3.2·4.1
    expect(result.wheelRpm).toBeCloseTo(152.439, 2);
    expect(result.speed).toBeCloseTo(18.155, 2);
    expect(result.speedPer1000Rpm).toBeCloseTo(9.078, 2);
    // Shifting from 3.20 to 2.00 at the same road speed and the same shift rpm.
    expect(result.gearLines[0]?.rpmAfterUpshift).toBeCloseTo(1250, 0); // 2000·2.00/3.20
    expect(result.gearLines[0]?.rpmDrop).toBeCloseTo(750, 0);
  });

  it("gives the road speed IN THIS GEAR at the shift point — the drop alone does not say at which speed", () => {
    const result = gearRoadSpeed({
      engineRpm: 2000,
      gearRatio: 3.2,
      finalDrive: 4.1,
      transferRatio: 1.0,
      rollingCircumference: 1985,
      gears: [3.2, 2.0],
      shiftRpm: 1800, // deliberately different from engineRpm, to discriminate the two speeds
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // total ratio for gear 0 is 3.2·4.1 = 13.12; speedFor(1800, 13.12).
    expect(result.gearLines[0]?.speedAtShiftRpm).toBeCloseTo(16.339939, 4);
    // total ratio for gear 1 (the one the driver shifts INTO) is 2.0·4.1 = 8.2.
    expect(result.gearLines[1]?.speedAtShiftRpm).toBeCloseTo(26.143902, 4);
    // `speed` (at engineRpm, not shiftRpm) is a different number from `speedAtShiftRpm`.
    expect(result.speed).toBeCloseTo(18.155488, 4);
  });

  it("refuses a gearbox ratio at or below zero rather than dividing a later shift by it", () => {
    const result = gearRoadSpeed({
      engineRpm: 2000,
      gearRatio: 3.2,
      finalDrive: 4.1,
      transferRatio: 1.0,
      rollingCircumference: 1985,
      gears: [3.2, 0, 2.0],
    });
    expect(result).toEqual({ ok: false, reason: "gears" });
  });

  it("refuses an engine speed and a rolling circumference outside their ranges", () => {
    const base = {
      engineRpm: 1400,
      gearRatio: 1,
      finalDrive: 2.64,
      transferRatio: 1,
      rollingCircumference: 3178,
    };
    expect(gearRoadSpeed({ ...base, engineRpm: 50 })).toEqual({ ok: false, reason: "engineRpm" });
    expect(gearRoadSpeed({ ...base, rollingCircumference: 100 })).toEqual({
      ok: false,
      reason: "rollingCircumference",
    });
  });
});

describe("tankVolumeByLevel", () => {
  it("computes the volume in a lying cylinder with flat ends — 700 mm in a 2 m tank", () => {
    const result = tankVolumeByLevel({
      shape: { kind: "lying-cylinder", diameter: 2000, length: 6000, domeDepth: 0 },
      level: 700,
      density: 0.835,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A = R²·acos((R-h)/R) - (R-h)·√(2Rh-h²), R=1000: acos(0.3)=1.2661037
    // A = 1000000·1.2661037 - 300·√910000 = 1266103.7 - 286181.8 = 979921.9 mm²
    // V = 979921.9·6000/1e6
    expect(result.volume).toBeCloseTo(5879.53, 1);
    // full = π·1000²·6000/1e6
    expect(result.fullVolume).toBeCloseTo(18849.56, 1);
    expect(result.fillShare).toBeCloseTo(0.3119, 3); // 5879.53/18849.56
    expect(result.emptySpace).toBeCloseTo(12970.02, 1);
    expect(result.mass).toBeCloseTo(4909.41, 1); // 5879.53·0.835
    // dV/dh = 2·L·√(2Rh-h²)/1e6 = 2·6000·953.9392/1e6
    expect(result.sensitivityLPerMm).toBeCloseTo(11.45, 1);
    expect(result.levelAboveCapacity).toBe(false);
  });

  it("computes the volume in a standing cylinder — the fill share equals the level share exactly", () => {
    const result = tankVolumeByLevel({
      shape: { kind: "standing-cylinder", diameter: 1200, height: 1500 },
      level: 850,
      density: 0.835,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.volume).toBeCloseTo(961.33, 1); // π·600²·850/1e6
    expect(result.fullVolume).toBeCloseTo(1696.46, 1);
    expect(result.fillShare).toBeCloseTo(850 / 1500, 6); // exact, by construction
    expect(result.emptySpace).toBeCloseTo(735.13, 1);
    expect(result.mass).toBeCloseTo(802.71, 1);
  });

  it("solves the level for a target volume by bisection, and round-trips the forward answer", () => {
    const forward = tankVolumeByLevel({
      shape: { kind: "lying-cylinder", diameter: 2000, length: 6000, domeDepth: 0 },
      level: 700,
    });
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    const reverse = tankVolumeByLevel({
      shape: { kind: "lying-cylinder", diameter: 2000, length: 6000, domeDepth: 0 },
      level: 0,
      targetVolume: forward.volume,
    });
    expect(reverse.ok).toBe(true);
    if (!reverse.ok) return;
    expect(reverse.levelForTarget).toBeCloseTo(700, 1);
  });

  it("solves the level directly for a box, by an exact formula rather than bisection", () => {
    const result = tankVolumeByLevel({
      shape: { kind: "box", length: 2000, width: 1000, height: 1000 },
      level: 0,
      targetVolume: 1000, // 1 m³ over a 2 m² footprint → 500 mm
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levelForTarget).toBeCloseTo(500, 3);
  });

  it("gives the exact ellipsoid-cap identity at a full domed end: (4/3)·π·R²·a", () => {
    const domed = tankVolumeByLevel({
      shape: { kind: "lying-cylinder", diameter: 2000, length: 6000, domeDepth: 400 },
      level: 2000, // full — the domed-ends term alone should equal (4/3)πR²a
    });
    const flat = tankVolumeByLevel({
      shape: { kind: "lying-cylinder", diameter: 2000, length: 6000, domeDepth: 0 },
      level: 2000,
    });
    expect(domed.ok && flat.ok).toBe(true);
    if (!domed.ok || !flat.ok) return;
    const domeVolumeL = domed.fullVolume - flat.fullVolume;
    // (4/3)·π·1000²·400 mm³, to litres
    expect(domeVolumeL).toBeCloseTo((4 / 3) * Math.PI * 1000 ** 2 * 400 / 1e6, 2);
  });

  it("caps the volume at full and flags a level entered above the vessel", () => {
    const result = tankVolumeByLevel({
      shape: { kind: "standing-cylinder", diameter: 1200, height: 1500 },
      level: 1600, // past the 1500 mm height
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levelAboveCapacity).toBe(true);
    expect(result.volume).toBeCloseTo(result.fullVolume, 6);
  });

  it("gives no level for a target volume that exceeds the vessel's own full capacity", () => {
    const result = tankVolumeByLevel({
      shape: { kind: "standing-cylinder", diameter: 1200, height: 1500 },
      level: 0,
      targetVolume: 5000, // full capacity here is ~1696 l
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levelForTarget).toBeUndefined();
  });

  it("refuses a dome depth deeper than the tank's own radius, and a negative level", () => {
    expect(
      tankVolumeByLevel({
        shape: { kind: "lying-cylinder", diameter: 2000, length: 6000, domeDepth: 1200 }, // > R=1000
        level: 500,
      }),
    ).toEqual({ ok: false, reason: "domeDepth" });
    expect(
      tankVolumeByLevel({
        shape: { kind: "standing-cylinder", diameter: 1200, height: 1500 },
        level: -1,
      }),
    ).toEqual({ ok: false, reason: "level" });
  });
});
