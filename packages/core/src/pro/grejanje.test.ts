import { describe, expect, it } from "vitest";

import {
  heatingCost,
  pipePressureDrop,
  powerUnits,
  radiatorOutput,
  roomHeatLoss,
  waterHeater,
} from "./grejanje.js";

/**
 * The vectors below are worked out on paper first and typed as literals, so a
 * change in the arithmetic has to disagree with a number a person wrote down
 * rather than with whatever the function last produced.
 */

describe("roomHeatLoss", () => {
  it("adds transmission, thermal bridges and ventilation at 0,34 Wh/(m³·K)", () => {
    // U·A: 20·0,3 = 6 and 5·1,4 = 7 → H_T = 13; +2 bridge = 15 W/K.
    // Δθ = 30 K → Φ_T = 450 W.
    // H_V = 0,34 · 0,5 · 60 = 10,2 W/K → Φ_V = 306 W. Total 756 W.
    const result = roomHeatLoss({
      temperatureDifference: 30,
      surfaces: [
        { area: 20, uValue: 0.3 },
        { area: 5, uValue: 1.4 },
      ],
      thermalBridgeCoefficient: 2,
      airChangesPerHour: 0.5,
      volume: 60,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transmissionCoefficient).toBeCloseTo(13, 9);
    expect(result.ventilationCoefficient).toBeCloseTo(10.2, 9);
    expect(result.transmissionLoss).toBeCloseTo(450, 9);
    expect(result.ventilationLoss).toBeCloseTo(306, 9);
    expect(result.totalLoss).toBeCloseTo(756, 9);
    expect(result.surfaces[1]?.loss).toBeCloseTo(210, 9);
    expect(result.lossPerFloorArea).toBeUndefined();
  });

  it("takes the same ventilation coefficient from a per-area air flow", () => {
    // 0,34 · 1,5 m³/(h·m²) · 20 m² = 10,2 W/K — the same figure by the other basis.
    const result = roomHeatLoss({
      temperatureDifference: 30,
      surfaces: [{ area: 20, uValue: 0.3 }],
      airFlowPerArea: 1.5,
      floorArea: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ventilationCoefficient).toBeCloseTo(10.2, 9);
    // Φ_T = 6·30 = 180, Φ_V = 10,2·30 = 306, total 486 → 486/20 = 24,3 W/m².
    expect(result.lossPerFloorArea).toBeCloseTo(24.3, 9);
  });

  it("refuses two ventilation bases, and refuses none", () => {
    const both = roomHeatLoss({
      temperatureDifference: 30,
      surfaces: [{ area: 20, uValue: 0.3 }],
      airChangesPerHour: 0.5,
      volume: 60,
      airFlowPerArea: 1.5,
      floorArea: 20,
    });
    expect(both).toEqual({ ok: false, reason: "ventilation" });
    const neither = roomHeatLoss({
      temperatureDifference: 30,
      surfaces: [{ area: 20, uValue: 0.3 }],
    });
    expect(neither).toEqual({ ok: false, reason: "ventilation" });
  });
});

describe("radiatorOutput", () => {
  it("returns the nominal rating at the nominal spread", () => {
    // (75 + 65)/2 − 20 = 50 K, the EN 442 rating spread → factor 1.
    const result = radiatorOutput({
      nominalOutput: 2000,
      flowTemperature: 75,
      returnTemperature: 65,
      roomTemperature: 20,
      exponent: 1.3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spreadUsed).toBeCloseTo(50, 9);
    expect(result.output).toBeCloseTo(2000, 6);
  });

  it("falls away from nominal by the exponent", () => {
    // (55 + 45)/2 − 20 = 30 K → (30/50)^1,3 = 0,514782 → 1029,56 W.
    const result = radiatorOutput({
      nominalOutput: 2000,
      flowTemperature: 55,
      returnTemperature: 45,
      roomTemperature: 20,
      exponent: 1.3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factor).toBeCloseTo(0.51475, 6);
    expect(result.output).toBeCloseTo(1029.5, 1);
  });

  it("inverts to the spread a wanted output needs", () => {
    // 50 · (1500/2000)^(1/1,3) = 50 · 0,8016108 = 40,08 K.
    const result = radiatorOutput({ nominalOutput: 2000, spread: 50, exponent: 1.3, requiredOutput: 1500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requiredSpread).toBeCloseTo(40.074, 3);
  });

  it("refuses a spread given beside the temperatures that would produce one", () => {
    const result = radiatorOutput({
      nominalOutput: 2000,
      spread: 30,
      flowTemperature: 55,
      exponent: 1.3,
    });
    expect(result).toEqual({ ok: false, reason: "spread" });
  });
});

describe("waterHeater", () => {
  it("heats 100 litres by 50 K at 2 kW", () => {
    // Q = 100 · 4186 · 50 = 20 930 000 J = 5,8139 kWh; t = 20 930 000/2000 = 10 465 s.
    const result = waterHeater({
      volume: 100,
      initialTemperature: 10,
      targetTemperature: 60,
      power: 2000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mass).toBeCloseTo(100, 9);
    expect(result.energyJoules).toBeCloseTo(20930000, 6);
    expect(result.energyKwh).toBeCloseTo(5.813889, 6);
    expect(result.timeSeconds).toBeCloseTo(10465, 6);
    expect(result.timeMinutes).toBeCloseTo(174.4167, 3);
  });

  it("adds the standing losses the user measured", () => {
    // +25 % → 26 162 500 J and 13 081,25 s.
    const result = waterHeater({
      volume: 100,
      initialTemperature: 10,
      targetTemperature: 60,
      power: 2000,
      lossPercent: 25,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.energyJoules).toBeCloseTo(26162500, 6);
    expect(result.timeSeconds).toBeCloseTo(13081.25, 6);
  });

  it("refuses a target at or below the starting temperature", () => {
    const result = waterHeater({
      volume: 100,
      initialTemperature: 60,
      targetTemperature: 60,
      power: 2000,
    });
    expect(result).toEqual({ ok: false, reason: "targetTemperature" });
  });
});

describe("pipePressureDrop", () => {
  it("is turbulent at 1 l/s in a 50 mm pipe, and the numbers add up", () => {
    // A = π·0,05²/4 = 0,001963495 m²; v = 0,001/0,001963495 = 0,5092958 m/s.
    // Re = 0,5092958 · 0,05 / 1,004e−6 = 25 363,3 — turbulent.
    // Swamee–Jain at ε/D = 0,001 gives f = 0,026905; head = 0,071164 m;
    // Δp = 0,026905 · 200 · 998 · 0,5092958²/2 = 696,5 Pa.
    const result = pipePressureDrop({
      innerDiameterMm: 50,
      lengthM: 10,
      flow: { value: 1, unit: "l/s" },
      roughnessMm: 0.05,
      kinematicViscosityMm2S: 1.004,
      densityKgM3: 998,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.velocityMs).toBeCloseTo(0.509296, 6);
    expect(result.reynolds).toBeCloseTo(25363.34, 1);
    expect(result.regime).toBe("turbulent");
    expect(result.frictionFactor).toBeCloseTo(0.0268997, 6);
    expect(result.headLossM).toBeCloseTo(0.0711486, 6);
    expect(result.pressureDropPa).toBeCloseTo(696.33, 1);
    // Δp = ρ·g·h, checked against the head the same run produced.
    expect(result.pressureDropPa).toBeCloseTo(998 * 9.80665 * result.headLossM, 6);
  });

  it("uses 64/Re below the laminar limit", () => {
    // Re = 0,02 · 0,02 / 1,004e−6 = 398,4 → f = 64/398,4 = 0,16064.
    const result = pipePressureDrop({
      innerDiameterMm: 20,
      lengthM: 5,
      velocityMs: 0.02,
      roughnessMm: 0.007,
      kinematicViscosityMm2S: 1.004,
      densityKgM3: 998,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reynolds).toBeCloseTo(398.41, 1);
    expect(result.regime).toBe("laminar");
    expect(result.frictionFactor).toBeCloseTo(0.16064, 5);
  });

  it("adds the fittings' equivalent length to the run", () => {
    const result = pipePressureDrop({
      innerDiameterMm: 20,
      lengthM: 5,
      velocityMs: 0.02,
      roughnessMm: 0.007,
      kinematicViscosityMm2S: 1.004,
      densityKgM3: 998,
      fittingsEquivalentLengthM: 1.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalLengthM).toBeCloseTo(6.5, 9);
    // 0,16064 · (6,5/0,02) · 0,02²/(2·9,80665) = 1,0647 mm.
    expect(result.headLossM).toBeCloseTo(0.0010647, 6);
  });
});

describe("powerUnits", () => {
  it("converts a kilowatt into all four units", () => {
    const result = powerUnits({ value: 1, unit: "kw" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.watts).toBeCloseTo(1000, 9);
    expect(result.btuPerHour).toBeCloseTo(3412.1416, 3);
    expect(result.kcalPerHour).toBeCloseTo(859.8452, 3);
  });

  it("round-trips a BTU/h figure back to the same watt", () => {
    const result = powerUnits({ value: 3412.1416, unit: "btuPerHour" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kilowatts).toBeCloseTo(1, 4);
    expect(result.kcalPerHour).toBeCloseTo(859.8452, 3);
  });

  it("refuses a unit it does not know", () => {
    // The cast is the point: the renderer can send this, and the tool refuses
    // it rather than indexing a table with a key it does not have.
    const result = powerUnits({ value: 1, unit: "horses" as never });
    expect(result).toEqual({ ok: false, reason: "unit" });
  });
});

describe("heatingCost", () => {
  it("costs a useful kilowatt-hour from the price and the fuel's own energy", () => {
    // Gas: 50/10 = 5 per delivered kWh, /0,9 = 5,5556 per useful.
    // Electricity: 12/1 = 12, /1 = 12. Cheapest is row 0.
    const result = heatingCost({
      fuels: [
        { name: "Gas", pricePerUnit: 50, energyPerUnit: 10, efficiency: 0.9 },
        { name: "Struja", pricePerUnit: 12, energyPerUnit: 1, efficiency: 1 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fuels[0]?.costPerDeliveredKwh).toBeCloseTo(5, 9);
    expect(result.fuels[0]?.costPerUsefulKwh).toBeCloseTo(5.555556, 6);
    expect(result.fuels[1]?.costPerUsefulKwh).toBeCloseTo(12, 9);
    expect(result.cheapestIndex).toBe(0);
  });

  it("names a different cheapest row when the prices change", () => {
    const result = heatingCost({
      fuels: [
        { name: "Gas", pricePerUnit: 90, energyPerUnit: 10, efficiency: 0.9 },
        { name: "Struja", pricePerUnit: 5, energyPerUnit: 1, efficiency: 1 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cheapestIndex).toBe(1);
  });

  it("refuses an efficiency that is not a fraction", () => {
    const result = heatingCost({
      fuels: [{ name: "Gas", pricePerUnit: 50, energyPerUnit: 10, efficiency: 90 }],
    });
    expect(result).toEqual({ ok: false, reason: "fuels:0:efficiency" });
  });
});
