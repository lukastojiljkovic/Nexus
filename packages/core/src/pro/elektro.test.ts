import { describe, expect, it } from "vitest";

import {
  conduitFill,
  energyCost,
  lightingCount,
  luminaireSpacing,
  motorStartingCurrent,
  transformerCurrent,
} from "./elektro.js";

/**
 * The electrician's toolkit, against numbers worked out by hand.
 *
 * Every expected value is the formula evaluated on paper and written in the
 * comment beside it — never a snapshot of what the code happened to produce.
 */

describe("energyCost", () => {
  it("costs a load over a month", () => {
    // 2000 W × 5 h = 10 kWh a day; × 30 days = 300 kWh; × 15 = 4500
    const result = energyCost({
      powerW: 2000,
      hoursPerDay: 5,
      days: 30,
      pricePerKwh: 15,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dutyPercentUsed).toBe(100);
    expect(result.effectivePowerW).toBeCloseTo(2000, 9);
    expect(result.hoursTotal).toBeCloseTo(150, 9);
    expect(result.energyPerDayKwh).toBeCloseTo(10, 9);
    expect(result.energyKwh).toBeCloseTo(300, 9);
    expect(result.cost).toBeCloseTo(4500, 9);
    expect(result.costPerDay).toBeCloseTo(150, 9);
  });

  it("applies the duty cycle to the power once, not to the hours as well", () => {
    // 2000 W at 50 % = 1000 W; × 5 h = 5 kWh a day; × 30 = 150 kWh; × 15 = 2250
    const result = energyCost({
      powerW: 2000,
      hoursPerDay: 5,
      days: 30,
      pricePerKwh: 15,
      dutyPercent: 50,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.energyKwh).toBeCloseTo(150, 9);
    expect(result.cost).toBeCloseTo(2250, 9);
    // The hours row stays the wall-clock hours, which is what a bill reads.
    expect(result.hoursTotal).toBeCloseTo(150, 9);
  });

  it("refuses an empty field, a fractional day count and a duty above 100", () => {
    const base = { powerW: 100, hoursPerDay: 1, days: 30, pricePerKwh: 15 };
    expect(energyCost({ ...base, powerW: 0 }).ok).toBe(false);
    expect(energyCost({ ...base, hoursPerDay: 0 }).ok).toBe(false);
    expect(energyCost({ ...base, hoursPerDay: 25 }).ok).toBe(false);
    expect(energyCost({ ...base, days: 0 }).ok).toBe(false);
    expect(energyCost({ ...base, days: 30.5 }).ok).toBe(false);
    expect(energyCost({ ...base, dutyPercent: 101 }).ok).toBe(false);
    // A price of zero is allowed: an own pump is a real case and every money row is honestly zero.
    expect(energyCost({ ...base, pricePerKwh: 0 }).ok).toBe(true);
  });
});

describe("lightingCount", () => {
  it("counts the fittings for 500 lx over 50 m²", () => {
    // Φ_needed = 500 × 50 / (0,8 × 0,8) = 25000 / 0,64 = 39062,5 lm
    // N = ceil(39062,5 / 4000) = ceil(9,765625) = 10
    // achieved = 10 × 4000 × 0,64 / 50 = 512 lx
    const result = lightingCount({
      areaM2: 50,
      targetLux: 500,
      luminaireLumens: 4000,
      utilisationFactor: 0.8,
      maintenanceFactor: 0.8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requiredLumens).toBeCloseTo(39062.5, 6);
    expect(result.luminaireCount).toBe(10);
    expect(result.installedLumens).toBeCloseTo(40000, 6);
    expect(result.achievedLux).toBeCloseTo(512, 9);
    expect(result.luxRatio).toBeCloseTo(1.024, 9);
  });

  it("rounds the count up, never down", () => {
    // Φ_needed = 300 × 20 / 0,72 = 8333,33 lm → ceil(8333,33/2000) = 5
    const result = lightingCount({
      areaM2: 20,
      targetLux: 300,
      luminaireLumens: 2000,
      utilisationFactor: 0.9,
      maintenanceFactor: 0.8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.luminaireCount).toBe(5);
  });

  it("refuses a missing area or factor rather than dividing by it", () => {
    const base = {
      areaM2: 50,
      targetLux: 500,
      luminaireLumens: 4000,
      utilisationFactor: 0.8,
      maintenanceFactor: 0.8,
    };
    expect(lightingCount({ ...base, areaM2: 0 }).ok).toBe(false);
    expect(lightingCount({ ...base, targetLux: 0 }).ok).toBe(false);
    expect(lightingCount({ ...base, utilisationFactor: 0.05 }).ok).toBe(false);
    expect(lightingCount({ ...base, maintenanceFactor: 1.5 }).ok).toBe(false);
  });
});

describe("luminaireSpacing", () => {
  it("measures the ratio from the work plane, not the floor", () => {
    // h' = 3,2 − 0,85 = 2,35 m; S = 1,2 × 2,35 = 2,82 m
    // along 8 m: ceil(8/2,82) = 3; across 5 m: ceil(5/2,82) = 2; total 6
    const result = luminaireSpacing({
      spacingToHeightRatio: 1.2,
      mountingHeightM: 3.2,
      workPlaneHeightM: 0.85,
      roomLengthM: 8,
      roomWidthM: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.heightAboveWorkPlaneM).toBeCloseTo(2.35, 9);
    expect(result.maxSpacingM).toBeCloseTo(2.82, 9);
    expect(result.countAlong).toBe(3);
    expect(result.countAcross).toBe(2);
    expect(result.totalCount).toBe(6);
  });

  it("refuses a work plane at or above the fitting", () => {
    expect(
      luminaireSpacing({
        spacingToHeightRatio: 1.2,
        mountingHeightM: 2,
        workPlaneHeightM: 2,
        roomLengthM: 8,
        roomWidthM: 5,
      }).ok,
    ).toBe(false);
    expect(
      luminaireSpacing({
        spacingToHeightRatio: 0,
        mountingHeightM: 3,
        workPlaneHeightM: 1,
        roomLengthM: 8,
        roomWidthM: 5,
      }).ok,
    ).toBe(false);
  });
});

describe("transformerCurrent", () => {
  it("gives both full-load currents of a three-phase transformer", () => {
    // I = S/(√3·U); 630000/(√3·10000) = 36,3731 A and 630000/(√3·400) = 909,3265 A
    const result = transformerCurrent({
      apparentPowerKva: 630,
      primaryVoltageV: 10000,
      secondaryVoltageV: 400,
      phases: "three",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.apparentPowerVa).toBeCloseTo(630000, 6);
    expect(result.phaseFactor).toBeCloseTo(Math.sqrt(3), 12);
    expect(result.primaryCurrentA).toBeCloseTo(36.3731, 3);
    expect(result.secondaryCurrentA).toBeCloseTo(909.3265, 3);
  });

  it("divides by nothing but the voltage in a single-phase transformer", () => {
    // I = S/U; 10000/230 = 43,4783 A
    const result = transformerCurrent({
      apparentPowerKva: 10,
      primaryVoltageV: 230,
      secondaryVoltageV: 230,
      phases: "single",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.phaseFactor).toBe(1);
    expect(result.primaryCurrentA).toBeCloseTo(43.4783, 4);
  });

  it("refuses an empty rating or voltage", () => {
    expect(
      transformerCurrent({
        apparentPowerKva: 0,
        primaryVoltageV: 230,
        secondaryVoltageV: 230,
        phases: "single",
      }).ok,
    ).toBe(false);
    expect(
      transformerCurrent({
        apparentPowerKva: 10,
        primaryVoltageV: 0,
        secondaryVoltageV: 230,
        phases: "single",
      }).ok,
    ).toBe(false);
  });
});

describe("conduitFill", () => {
  it("fills by the ratio of circle areas", () => {
    // Σd²/D² = 4 × 3,6² / 20² = 51,84/400 = 0,1296 → 12,96 %
    // A = π·400/4 = 314,15927 mm²; Σa = π·4·12,96/4 = 40,71504 mm²
    const result = conduitFill({
      conduitInnerDiameterMm: 20,
      conductorDiameterMm: 3.6,
      conductorCount: 4,
      fillLimitPercent: 40,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conduitAreaMm2).toBeCloseTo(314.15927, 5);
    expect(result.conductorsAreaMm2).toBeCloseTo(40.71504, 5);
    expect(result.fillPercent).toBeCloseTo(12.96, 6);
    expect(result.remainingAreaMm2).toBeCloseTo(273.44422, 5);
    expect(result.fillRatio).toBeCloseTo(0.324, 9);
  });

  it("withholds the ratio when the user typed no limit", () => {
    const result = conduitFill({
      conduitInnerDiameterMm: 20,
      conductorDiameterMm: 3.6,
      conductorCount: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fillRatio).toBeUndefined();
  });

  it("refuses a conductor that does not fit the bore and a missing diameter", () => {
    expect(
      conduitFill({ conduitInnerDiameterMm: 20, conductorDiameterMm: 20, conductorCount: 1 }).ok,
    ).toBe(false);
    expect(
      conduitFill({ conduitInnerDiameterMm: 20, conductorDiameterMm: 3.6, conductorCount: 0 }).ok,
    ).toBe(false);
    expect(
      conduitFill({ conduitInnerDiameterMm: 0, conductorDiameterMm: 3.6, conductorCount: 1 }).ok,
    ).toBe(false);
    expect(
      conduitFill({
        conduitInnerDiameterMm: 20,
        conductorDiameterMm: 3.6,
        conductorCount: 1,
        fillLimitPercent: 0,
      }).ok,
    ).toBe(false);
  });
});

describe("motorStartingCurrent", () => {
  it("takes the locked-rotor current from the nameplate ratio", () => {
    // k = 7, I_N = 10 A → I_LR = 70 A; direct on line draws all of it
    const result = motorStartingCurrent({
      ratedCurrentA: 10,
      startingRatio: 7,
      method: "dol",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lockedRotorCurrentA).toBeCloseTo(70, 9);
    expect(result.startingCurrentA).toBeCloseTo(70, 9);
    expect(result.startingRatio).toBeCloseTo(7, 9);
    expect(result.torqueShare).toBe(1);
  });

  it("divides both the current and the torque by three for a star–delta start", () => {
    // 70 / 3 = 23,3333 A; the voltage law (1/√3)² = 1/3 is the whole result
    const result = motorStartingCurrent({
      ratedCurrentA: 10,
      startingRatio: 7,
      method: "starDelta",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.startingCurrentA).toBeCloseTo(23.333333, 6);
    expect(result.startingRatio).toBeCloseTo(2.333333, 6);
    expect(result.torqueShare).toBeCloseTo(1 / 3, 12);
  });

  it("scales a soft start with the voltage and its square", () => {
    // 70 A at 60 % → 42 A; torque (0,6)² = 0,36
    const result = motorStartingCurrent({
      ratedCurrentA: 10,
      startingRatio: 7,
      method: "soft",
      softStartPercent: 60,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.startingCurrentA).toBeCloseTo(42, 9);
    expect(result.startingRatio).toBeCloseTo(4.2, 9);
    expect(result.torqueShare).toBeCloseTo(0.36, 12);
  });

  it("refuses a soft start with no setting, and a setting on a switching method", () => {
    expect(motorStartingCurrent({ ratedCurrentA: 10, startingRatio: 7, method: "soft" }).ok).toBe(
      false,
    );
    expect(
      motorStartingCurrent({
        ratedCurrentA: 10,
        startingRatio: 7,
        method: "dol",
        softStartPercent: 60,
      }).ok,
    ).toBe(false);
    expect(
      motorStartingCurrent({
        ratedCurrentA: 10,
        startingRatio: 7,
        method: "soft",
        softStartPercent: 5,
      }).ok,
    ).toBe(false);
    expect(motorStartingCurrent({ ratedCurrentA: 0, startingRatio: 7, method: "dol" }).ok).toBe(
      false,
    );
    expect(motorStartingCurrent({ ratedCurrentA: 10, startingRatio: 0.5, method: "dol" }).ok).toBe(
      false,
    );
  });
});
