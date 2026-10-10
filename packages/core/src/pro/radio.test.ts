import { describe, expect, it } from "vitest";

import {
  antennaLengths,
  coaxLoss,
  frequencyWavelength,
  fresnelRadius,
  linkBudget,
  pathLoss,
  swrMatch,
} from "./radio.js";

/**
 * The radio toolkit's arithmetic, against numbers worked out by hand.
 *
 * The whole file rests on one exact constant — the speed of light,
 * 299 792 458 m/s — so every wavelength below is `c/f` and can be re-derived
 * from a calculator. The two logarithmic cases carry their arithmetic in the
 * comment beside them, and the free-space path loss is cross-checked against
 * the amateur shortcut `32,44 + 20·log d(km) + 20·log f(MHz)`, which is the
 * same expression with the constant folded out.
 */

describe("frequencyWavelength", () => {
  it("answers 7,1 MHz in metres, with the halves an antenna needs", () => {
    // c/7,1 MHz = 299 792 458/7 100 000 = 42,224290 m
    const result = frequencyWavelength({ frequencyHz: 7.1e6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wavelengthM).toBeCloseTo(42.22429, 5);
    expect(result.halfWavelengthM).toBeCloseTo(21.112145, 5);
    expect(result.quarterWavelengthM).toBeCloseTo(10.556072, 5);
    expect(result.frequencyMhz).toBeCloseTo(7.1, 9);
  });

  it("answers a two-metre wavelength in frequency", () => {
    // c/2 = 149 896 229 Hz = 149,896229 MHz
    const result = frequencyWavelength({ wavelengthM: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frequencyHz).toBeCloseTo(149896229, 0);
    expect(result.frequencyMhz).toBeCloseTo(149.896229, 5);
  });

  it("refuses both fields and neither field", () => {
    expect(frequencyWavelength({ frequencyHz: 7.1e6, wavelengthM: 42 }).ok).toBe(false);
    expect(frequencyWavelength({}).ok).toBe(false);
    const pair = frequencyWavelength({ frequencyHz: 7.1e6, wavelengthM: 42 });
    if (!pair.ok) expect(pair.reason).toBe("pair");
  });
});

describe("antennaLengths", () => {
  it("shortens the element by the velocity factor", () => {
    // λ = 42,224290 m; a wire with VF 0,95 is 40,113075 m of conductor, so the
    // dipole is 20,056538 m and the quarter wave 10,028269 m
    const result = antennaLengths({ frequencyHz: 7.1e6, velocityFactor: 0.95 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wavelengthM).toBeCloseTo(42.22429, 5);
    expect(result.conductorWavelengthM).toBeCloseTo(40.113075, 5);
    expect(result.dipoleM).toBeCloseTo(20.056538, 5);
    expect(result.quarterWaveM).toBeCloseTo(10.028269, 5);
    expect(result.dipoleFt).toBeCloseTo(65.802, 3);
  });

  it("is the free-space length when the velocity factor is one", () => {
    const result = antennaLengths({ frequencyHz: 145e6, velocityFactor: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dipoleM).toBeCloseTo(1.0338, 4);
    expect(result.quarterWaveM).toBeCloseTo(0.5169, 4);
  });

  it("refuses a velocity factor that is not one", () => {
    expect(antennaLengths({ frequencyHz: 7.1e6, velocityFactor: 0 }).ok).toBe(false);
    expect(antennaLengths({ frequencyHz: 7.1e6, velocityFactor: 1.4 }).ok).toBe(false);
  });
});

describe("swrMatch", () => {
  it("turns an SWR of 2 into the other three names for the same fact", () => {
    // |Γ| = (2 − 1)/(2 + 1) = 1/3; RL = −20·log(1/3) = 9,542425 dB;
    // ML = −10·log(1 − 1/9) = −10·log(0,888889) = 0,511525 dB
    const result = swrMatch({ kind: "swr", value: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reflectionCoefficient).toBeCloseTo(1 / 3, 9);
    expect(result.returnLossDb).toBeCloseTo(9.542425, 5);
    expect(result.mismatchLossDb).toBeCloseTo(0.511525, 5);
    expect(result.reflectedPercent).toBeCloseTo(33.3333333, 6);
    expect(result.powerDelivered).toBeCloseTo(8 / 9, 9);
  });

  it("reads back from a reflection coefficient of one half", () => {
    // |Γ| = 0,5 → SWR = 1,5/0,5 = 3; RL = −20·log(0,5) = 6,020600 dB;
    // ML = −10·log(0,75) = 1,249387 dB
    const result = swrMatch({ kind: "reflection", value: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.swr).toBeCloseTo(3, 9);
    expect(result.returnLossDb).toBeCloseTo(6.0206, 4);
    expect(result.mismatchLossDb).toBeCloseTo(1.249387, 5);
  });

  it("reports no return loss at all for a perfect match", () => {
    const result = swrMatch({ kind: "swr", value: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reflectionCoefficient).toBe(0);
    expect(result.returnLossDb).toBeUndefined();
    expect(result.mismatchLossDb).toBe(0);
    expect(result.powerDelivered).toBe(1);
  });

  it("refuses an SWR below one and a reflection above one", () => {
    expect(swrMatch({ kind: "swr", value: 0.9 }).ok).toBe(false);
    expect(swrMatch({ kind: "reflection", value: 1.5 }).ok).toBe(false);
    expect(swrMatch({ kind: "nonsense" as "swr", value: 2 }).ok).toBe(false);
  });
});

describe("pathLoss", () => {
  it("matches the amateur form of the Friis loss at 10 km on 144 MHz", () => {
    // λ = c/144 MHz = 2,081892 m; L = 20·log(4π·10 000/2,081892) = 95,615033 dB.
    // The familiar 32,44 + 20·log10(10) + 20·log10(144) = 95,607 dB is the same
    // expression with the constant rounded, and agrees to 8 mdB.
    const result = pathLoss({ distanceKm: 10, frequencyHz: 144e6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wavelengthM).toBeCloseTo(2.0818921, 6);
    expect(result.lossDb).toBeCloseTo(95.61503, 4);
    expect(Math.abs(result.lossDb - (32.44 + 20 * Math.log10(10) + 20 * Math.log10(144)))).toBeLessThan(0.01);
  });

  it("costs 6,02 dB for a doubling of distance or of frequency", () => {
    const near = pathLoss({ distanceKm: 1, frequencyHz: 144e6 });
    const far = pathLoss({ distanceKm: 2, frequencyHz: 144e6 });
    expect(near.ok && far.ok).toBe(true);
    if (!near.ok || !far.ok) return;
    expect(far.lossDb - near.lossDb).toBeCloseTo(6.0206, 4);
  });

  it("refuses a distance and a frequency it cannot use", () => {
    expect(pathLoss({ distanceKm: 0, frequencyHz: 144e6 }).ok).toBe(false);
    expect(pathLoss({ distanceKm: 10, frequencyHz: 0 }).ok).toBe(false);
  });
});

describe("fresnelRadius", () => {
  it("is largest at the midpoint, where the zone is the whole path", () => {
    // 10 km at 144 MHz, obstruction at half way: r = √(λ·5000·5000/10 000)
    // = √(2,081892 × 2500) = 72,1438 m — which is √(λD/4) at the midpoint.
    const result = fresnelRadius({ pathKm: 10, fromEndKm: 5, frequencyHz: 144e6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.radiusM).toBeCloseTo(72.1438, 4);
    expect(result.radiusM).toBeCloseTo(Math.sqrt((result.wavelengthM * 10000) / 4), 6);
    expect(result.clearance60M).toBeCloseTo(43.2863, 4);
    expect(result.toEndKm).toBeCloseTo(5, 9);
  });

  it("falls towards either end and is symmetric about the midpoint", () => {
    const near = fresnelRadius({ pathKm: 10, fromEndKm: 1, frequencyHz: 144e6 });
    const far = fresnelRadius({ pathKm: 10, fromEndKm: 9, frequencyHz: 144e6 });
    const mid = fresnelRadius({ pathKm: 10, fromEndKm: 5, frequencyHz: 144e6 });
    expect(near.ok && far.ok && mid.ok).toBe(true);
    if (!near.ok || !far.ok || !mid.ok) return;
    expect(near.radiusM).toBeCloseTo(far.radiusM, 9);
    expect(near.radiusM).toBeLessThan(mid.radiusM);
  });

  it("refuses an obstruction at or past the far end", () => {
    expect(fresnelRadius({ pathKm: 10, fromEndKm: 10, frequencyHz: 144e6 }).ok).toBe(false);
    expect(fresnelRadius({ pathKm: 10, fromEndKm: 12, frequencyHz: 144e6 }).ok).toBe(false);
    expect(fresnelRadius({ pathKm: 10, fromEndKm: 0, frequencyHz: 144e6 }).ok).toBe(false);
  });
});

describe("coaxLoss", () => {
  it("multiplies the datasheet's figure by the length", () => {
    // 3,5 dB/100 m over 20 m is 0,7 dB; 10^(−0,07) = 0,851138 of the power
    // arrives, so 14,8862 % is lost and 100 W becomes 85,1138 W
    const result = coaxLoss({ dbPer100m: 3.5, lengthM: 20, inputWatts: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lossDb).toBeCloseTo(0.7, 9);
    expect(result.powerFraction).toBeCloseTo(0.8511380, 6);
    expect(result.lossPercent).toBeCloseTo(14.886196, 4);
    expect(result.outputWatts).toBeCloseTo(85.113804, 4);
  });

  it("reports the loss alone when no power was typed", () => {
    const result = coaxLoss({ dbPer100m: 10, lengthM: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lossDb).toBeCloseTo(10, 9);
    expect(result.powerFraction).toBeCloseTo(0.1, 9);
    expect(result.outputWatts).toBeUndefined();
  });

  it("refuses a length of zero and a loss that is not a loss", () => {
    expect(coaxLoss({ dbPer100m: 3.5, lengthM: 0 }).ok).toBe(false);
    expect(coaxLoss({ dbPer100m: -1, lengthM: 20 }).ok).toBe(false);
  });
});

describe("linkBudget", () => {
  it("adds up the gains and subtracts the losses", () => {
    // 5 W is 10·log(5/0,001) = 36,9897 dBm; EIRP = 36,9897 − 1 + 6 = 41,9897 dBm
    // received = 41,9897 + 3 − 0,5 − 95,6 = −51,1103 dBm
    const result = linkBudget({
      txPowerDbm: 36.9897,
      txLossDb: 1,
      txGainDbi: 6,
      rxLossDb: 0.5,
      rxGainDbi: 3,
      pathLossDb: 95.6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eirpDbm).toBeCloseTo(41.9897, 6);
    expect(result.receivedDbm).toBeCloseTo(-51.1103, 6);
    // 0,001 × 10^(−5,11103) = 7,74408e−9 W = 7,74408 nW
    expect(result.receivedW).toBeCloseTo(7.744083e-9, 14);
    // √(7,74408e−9 × 50) = 6,22257e−4 V = 622,257 µV
    expect(result.receivedMicrovolts).toBeCloseTo(622.2573, 3);
    expect(result.netGainDb).toBeCloseTo(7.5, 9);
  });

  it("refuses a gain or a loss that is not one", () => {
    const base = {
      txPowerDbm: 30,
      txLossDb: 1,
      txGainDbi: 6,
      rxLossDb: 0.5,
      rxGainDbi: 3,
      pathLossDb: 95,
    };
    expect(linkBudget({ ...base, txLossDb: -1 }).ok).toBe(false);
    expect(linkBudget({ ...base, rxGainDbi: 100 }).ok).toBe(false);
    expect(linkBudget({ ...base, pathLossDb: 500 }).ok).toBe(false);
  });
});
