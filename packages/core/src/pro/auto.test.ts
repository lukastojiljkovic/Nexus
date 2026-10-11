import { describe, expect, it } from "vitest";

import {
  airFuelRatio,
  compressionRatio,
  engineDisplacement,
  injectorFlow,
  meanPistonSpeed,
  wheelOffset,
} from "./auto.js";

/**
 * The car mechanic's toolkit, against numbers worked out by hand.
 *
 * Two of these cases are real engines with published capacities — 86 × 86 mm over
 * four cylinders is the two-litre the arithmetic should land on — which is what
 * makes it checkable without a dyno.
 */

describe("engineDisplacement", () => {
  it("lands a 86 × 86 four on two litres", () => {
    // V_h = π·86²·86/4000 = 499,557214 cm³; ×4 = 1998,228857 cm³ = 1,9982 l
    const result = engineDisplacement({ boreMm: 86, strokeMm: 86, cylinders: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perCylinderCc).toBeCloseTo(499.557214, 5);
    expect(result.totalCc).toBeCloseTo(1998.228857, 5);
    expect(result.totalLitres).toBeCloseTo(1.998228857, 7);
    expect(result.boreStrokeRatio).toBeCloseTo(1, 12);
  });

  it("reads an oversquare engine", () => {
    // V_h = π·90²·84/4000 = π·170,1 = 534,384910 cm³; ×4 = 2137,539641 cm³; b/s = 1,0714
    const result = engineDisplacement({ boreMm: 90, strokeMm: 84, cylinders: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perCylinderCc).toBeCloseTo(534.38491, 5);
    expect(result.totalCc).toBeCloseTo(2137.539641, 5);
    expect(result.boreStrokeRatio).toBeCloseTo(1.0714286, 6);
  });

  it("refuses an empty bore or stroke and a fractional cylinder count", () => {
    expect(engineDisplacement({ boreMm: 0, strokeMm: 86, cylinders: 4 }).ok).toBe(false);
    expect(engineDisplacement({ boreMm: 86, strokeMm: 0, cylinders: 4 }).ok).toBe(false);
    expect(engineDisplacement({ boreMm: 86, strokeMm: 86, cylinders: 0 }).ok).toBe(false);
    expect(engineDisplacement({ boreMm: 86, strokeMm: 86, cylinders: 4.5 }).ok).toBe(false);
  });
});

describe("compressionRatio", () => {
  it("adds every clearance volume above the crown", () => {
    // V_c = 50 + 5 + 1 = 56 cm³; CR = (499,5572 + 56)/56 = 9,9207
    const result = compressionRatio({
      boreMm: 86,
      strokeMm: 86,
      chamberVolumeCc: 50,
      gasketVolumeCc: 5,
      deckVolumeCc: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sweptVolumeCc).toBeCloseTo(499.5572, 4);
    expect(result.clearanceVolumeCc).toBeCloseTo(56, 9);
    expect(result.compressionRatio).toBeCloseTo(9.920664, 5);
  });

  it("subtracts a domed piston", () => {
    // V_c = 50 + 5 + 1 − 10 = 46 cm³; CR = 545,5572/46 = 11,8599
    const result = compressionRatio({
      boreMm: 86,
      strokeMm: 86,
      chamberVolumeCc: 50,
      gasketVolumeCc: 5,
      deckVolumeCc: 1,
      pistonVolumeCc: -10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clearanceVolumeCc).toBeCloseTo(46, 9);
    expect(result.compressionRatio).toBeCloseTo(11.85994, 5);
  });

  it("refuses a clearance volume that is not positive", () => {
    const result = compressionRatio({
      boreMm: 86,
      strokeMm: 86,
      chamberVolumeCc: 1,
      pistonVolumeCc: -500,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("clearanceVolume");
    expect(compressionRatio({ boreMm: 86, strokeMm: 86, chamberVolumeCc: 0 }).ok).toBe(false);
  });
});

describe("meanPistonSpeed", () => {
  it("doubles the stroke per revolution", () => {
    // 2·0,086·6000/60 = 17,2 m/s; ×196,850394 = 3385,8268 ft/min
    const result = meanPistonSpeed({ strokeMm: 86, rpm: 6000, limitMs: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meanPistonSpeedMs).toBeCloseTo(17.2, 9);
    expect(result.meanPistonSpeedFpm).toBeCloseTo(3385.8268, 3);
    expect(result.speedPer1000RpmMs).toBeCloseTo(2.8666667, 6);
    expect(result.speedRatio).toBeCloseTo(0.86, 9);
  });

  it("withholds the ratio when the user typed no limit", () => {
    const result = meanPistonSpeed({ strokeMm: 86, rpm: 6000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.speedRatio).toBeUndefined();
  });

  it("refuses an empty stroke, a speed off the tachometer and a limit of zero", () => {
    expect(meanPistonSpeed({ strokeMm: 0, rpm: 6000 }).ok).toBe(false);
    expect(meanPistonSpeed({ strokeMm: 86, rpm: 50 }).ok).toBe(false);
    expect(meanPistonSpeed({ strokeMm: 86, rpm: 6000, limitMs: 0 }).ok).toBe(false);
  });
});

describe("injectorFlow", () => {
  it("sizes four injectors for 200 kW at 300 g/kWh", () => {
    // ṁ = 200 × 300 / 1000 = 60 kg/h; ÷ 0,75 kg/l = 80 l/h
    // per injector at 80 % duty: 80/4/0,8 = 25 l/h = 416,667 cm³/min
    // in pounds: 25 × 0,75 / 0,45359237 = 41,3366 lb/h
    const result = injectorFlow({
      targetPowerKw: 200,
      bsfcGKwh: 300,
      cylinders: 4,
      maxDutyPercent: 80,
      fuelDensityKgPerL: 0.75,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fuelMassFlowKgPerH).toBeCloseTo(60, 9);
    expect(result.fuelVolumeFlowLPerH).toBeCloseTo(80, 9);
    expect(result.injectorFlowLPerH).toBeCloseTo(25, 9);
    expect(result.injectorFlowCcPerMin).toBeCloseTo(416.6667, 3);
    expect(result.injectorFlowLbPerH).toBeCloseTo(41.3366, 3);
    expect(result.dutyPercentUsed).toBe(80);
  });

  it("asks for more injector as the duty cycle falls", () => {
    // 80/4/0,5 = 40 l/h
    const result = injectorFlow({
      targetPowerKw: 200,
      bsfcGKwh: 300,
      cylinders: 4,
      maxDutyPercent: 50,
      fuelDensityKgPerL: 0.75,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.injectorFlowLPerH).toBeCloseTo(40, 9);
  });

  it("refuses an empty power, a density of nothing and a duty below the floor", () => {
    const base = {
      targetPowerKw: 200,
      bsfcGKwh: 300,
      cylinders: 4,
      maxDutyPercent: 80,
      fuelDensityKgPerL: 0.75,
    };
    expect(injectorFlow({ ...base, targetPowerKw: 0 }).ok).toBe(false);
    expect(injectorFlow({ ...base, bsfcGKwh: 40 }).ok).toBe(false);
    expect(injectorFlow({ ...base, fuelDensityKgPerL: 0 }).ok).toBe(false);
    expect(injectorFlow({ ...base, maxDutyPercent: 5 }).ok).toBe(false);
  });
});

describe("airFuelRatio", () => {
  it("divides the air by the fuel", () => {
    // 147/10 = 14,7 and λ = 14,7/14,7 = 1
    const result = airFuelRatio({
      mode: "afrFromMasses",
      airMassG: 147,
      fuelMassG: 10,
      stoichiometricAfr: 14.7,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.airFuelRatio).toBeCloseTo(14.7, 9);
    expect(result.lambda).toBeCloseTo(1, 9);
  });

  it("reads a rich mixture as lambda below one", () => {
    // 12,5/1 with petrol's 14,7 → λ = 0,8503
    const result = airFuelRatio({
      mode: "afrFromMasses",
      airMassG: 125,
      fuelMassG: 10,
      stoichiometricAfr: 14.7,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.airFuelRatio).toBeCloseTo(12.5, 9);
    expect(result.lambda).toBeCloseTo(0.8503401, 6);
  });

  it("solves for the fuel a target ratio needs", () => {
    // 147/14,7 = 10 g
    const result = airFuelRatio({
      mode: "fuelForTarget",
      airMassG: 147,
      targetAfr: 14.7,
      stoichiometricAfr: 14.7,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fuelMassG).toBeCloseTo(10, 9);
    expect(result.airFuelRatio).toBeCloseTo(14.7, 9);
    expect(result.lambda).toBeCloseTo(1, 9);
  });

  it("keeps E85's stoichiometry apart from petrol's", () => {
    // λ = 14,7/9,8 = 1,5
    const result = airFuelRatio({
      mode: "afrFromMasses",
      airMassG: 147,
      fuelMassG: 10,
      stoichiometricAfr: 9.8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lambda).toBeCloseTo(1.5, 9);
  });

  it("withholds lambda without a stoichiometric ratio", () => {
    const result = airFuelRatio({ mode: "afrFromMasses", airMassG: 147, fuelMassG: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lambda).toBeUndefined();
    expect(result.stoichiometricAfrUsed).toBeUndefined();
  });

  it("refuses an empty mass or ratio rather than dividing by it", () => {
    expect(airFuelRatio({ mode: "afrFromMasses", airMassG: 0, fuelMassG: 10 }).ok).toBe(false);
    expect(airFuelRatio({ mode: "afrFromMasses", airMassG: 147, fuelMassG: 0 }).ok).toBe(false);
    expect(airFuelRatio({ mode: "fuelForTarget", airMassG: 147, targetAfr: 0 }).ok).toBe(false);
    expect(
      airFuelRatio({
        mode: "afrFromMasses",
        airMassG: 147,
        fuelMassG: 10,
        stoichiometricAfr: 0.5,
      }).ok,
    ).toBe(false);
  });
});

describe("wheelOffset", () => {
  it("splits the width around the mounting face by the offset", () => {
    // W/2 = 8 × 25,4/2 = 101,6 mm; backspace = 101,6 + 45 = 146,6;
    // front space = 101,6 − 45 = 56,6; 146,6/25,4 = 5,7717 in
    const result = wheelOffset({ rimWidthIn: 8, offsetMm: 45 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rimWidthMm).toBeCloseTo(203.2, 9);
    expect(result.backspaceMm).toBeCloseTo(146.6, 9);
    expect(result.frontSpaceMm).toBeCloseTo(56.6, 9);
    expect(result.backspaceIn).toBeCloseTo(5.7716535, 6);
    expect(result.outerFaceShiftMm).toBeUndefined();
  });

  it("measures both faces' movement outward against a reference wheel", () => {
    // reference W/2 = 7,5 × 25,4/2 = 95,25; front = 95,25 − 35 = 60,25
    // outer shift = 56,6 − 60,25 = −3,65 (in by 3,65 mm)
    // reference back = 95,25 + 35 = 130,25; inner shift = 130,25 − 146,6 = −16,35
    const result = wheelOffset({
      rimWidthIn: 8,
      offsetMm: 45,
      referenceWidthIn: 7.5,
      referenceOffsetMm: 35,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outerFaceShiftMm).toBeCloseTo(-3.65, 9);
    expect(result.innerFaceShiftMm).toBeCloseTo(-16.35, 9);
  });

  it("refuses half a reference wheel", () => {
    expect(wheelOffset({ rimWidthIn: 8, offsetMm: 45, referenceWidthIn: 7.5 }).ok).toBe(false);
    expect(wheelOffset({ rimWidthIn: 8, offsetMm: 45, referenceOffsetMm: 35 }).ok).toBe(false);
  });

  it("refuses an empty width and an offset off the scale", () => {
    expect(wheelOffset({ rimWidthIn: 0, offsetMm: 45 }).ok).toBe(false);
    expect(wheelOffset({ rimWidthIn: 8, offsetMm: 200 }).ok).toBe(false);
  });
});
