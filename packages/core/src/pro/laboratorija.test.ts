import { describe, expect, it } from "vitest";

import {
  bufferPh,
  concentrationUnits,
  dilution,
  molarMass,
  molarity,
  strongAcidPh,
} from "./laboratorija.js";

/**
 * The laboratory toolkit's arithmetic, against numbers worked out by hand.
 *
 * Every expected molar mass below is `Σ nᵢ·Arᵢ` evaluated with the CIAAW 2021
 * abridged weights the module embeds — the sum is written out in the comment
 * beside each case so a reader can check it without the code.
 */

/** The molar mass of an element from the module's own table, via a one-atom formula. */
function atomWeight(symbol: string): number {
  const result = molarMass({ formula: symbol });
  if (!result.ok) throw new Error(`no weight for ${symbol}: ${result.reason}`);
  return result.molarMass;
}

describe("molarMass", () => {
  it("reads a plain formula", () => {
    // 2·1,008 + 15,999 = 18,015
    const result = molarMass({ formula: "H2O" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.molarMass).toBeCloseTo(18.015, 6);
    expect(result.totalAtoms).toBe(3);
    expect(result.elements.map((element) => element.symbol)).toEqual(["H", "O"]);
    expect(result.elements[0]?.count).toBe(2);
    // 200 × 2,016 / 18,015 = 11,1907 %
    expect(result.elements[0]?.sharePercent).toBeCloseTo(11.1907, 4);
  });

  it("reads a two-letter symbol as one element", () => {
    // Na 22,990 + Cl 35,45 = 58,44 — read as "Na"+"Cl", never as N+a+C+l.
    const result = molarMass({ formula: "NaCl" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.molarMass).toBeCloseTo(58.44, 6);
    expect(result.elements).toHaveLength(2);
  });

  it("applies a group multiplier", () => {
    // Ca 40,078 + 2·(15,999 + 1,008) = 40,078 + 34,014 = 74,092
    const result = molarMass({ formula: "Ca(OH)2" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.molarMass).toBeCloseTo(74.092, 6);
    expect(result.elements.find((element) => element.symbol === "O")?.count).toBe(2);
    expect(result.elements.find((element) => element.symbol === "H")?.count).toBe(2);
  });

  it("nests a group and accepts square brackets", () => {
    // 2·26,982 + 3·(32,06 + 4·15,999) = 53,964 + 3·96,056 = 53,964 + 288,168
    const result = molarMass({ formula: "Al2[SO4]3" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.molarMass).toBeCloseTo(342.132, 6);
    expect(result.elements.find((element) => element.symbol === "O")?.count).toBe(12);
  });

  it("applies a hydrate multiplier to the water and only the water", () => {
    // Cu 63,546 + S 32,06 + 4·15,999 + 5·(2·1,008 + 15,999)
    //   = 63,546 + 32,06 + 63,996 + 90,075 = 249,677
    const result = molarMass({ formula: "CuSO4·5H2O" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.molarMass).toBeCloseTo(249.677, 6);
    expect(result.elements.find((element) => element.symbol === "H")?.count).toBe(10);
    expect(result.elements.find((element) => element.symbol === "O")?.count).toBe(9);
    expect(result.totalAtoms).toBe(21);
  });

  it("accepts the plain-text hydrate mark and a multiplier of ten", () => {
    // 2·22,990 + 12,011 + 3·15,999 + 10·18,015 = 45,98 + 12,011 + 47,997 + 180,15
    const result = molarMass({ formula: "Na2CO3.10H2O" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.molarMass).toBeCloseTo(286.138, 6);
  });

  it("reads a formula written with spaces", () => {
    // 6·12,011 + 12·1,008 + 6·15,999 = 72,066 + 12,096 + 95,994
    const result = molarMass({ formula: " C6 H12 O6 " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.molarMass).toBeCloseTo(180.156, 6);
  });

  it("refuses a syntax it cannot read rather than guessing a count", () => {
    for (const formula of ["", "H2O)", "Ca(OH2", "H2O·", "2H2O", "H2O+"]) {
      const result = molarMass({ formula });
      expect(result.ok, formula).toBe(false);
      if (!result.ok) expect(result.reason, formula).toBe("formula");
    }
  });

  it("names the element it has no standard atomic weight for", () => {
    // Technetium and promethium have no standard atomic weight at all, and the
    // refusal names what it could not weigh rather than returning a mass number.
    const result = molarMass({ formula: "TcO4" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("element:Tc");
  });

  it("agrees with the element's own single-atom formula", () => {
    expect(atomWeight("Fe")).toBeCloseTo(55.845, 9);
    expect(atomWeight("U")).toBeCloseTo(238.03, 9);
  });
});

describe("molarity", () => {
  it("weighs the mass for a solution", () => {
    // n = 0,1 mol/l × 0,250 l = 0,025 mol; m = 0,025 · 58,44 = 1,461 g
    const result = molarity({
      mode: "massForSolution",
      concentrationMolL: 0.1,
      volumeMl: 250,
      molarMassGmol: 58.44,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.volumeL).toBeCloseTo(0.25, 12);
    expect(result.moles).toBeCloseTo(0.025, 12);
    expect(result.massG).toBeCloseTo(1.461, 9);
  });

  it("reads the concentration back from a mass that was dissolved", () => {
    // n = 5,844 / 58,44 = 0,1 mol in 0,5 l → 0,2 mol/l
    const result = molarity({
      mode: "concentrationFromMass",
      massG: 5.844,
      volumeMl: 500,
      molarMassGmol: 58.44,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moles).toBeCloseTo(0.1, 12);
    expect(result.concentrationMolL).toBeCloseTo(0.2, 12);
  });

  it("refuses an empty volume, an empty molar mass and an empty concentration", () => {
    expect(
      molarity({ mode: "massForSolution", concentrationMolL: 1, volumeMl: 0, molarMassGmol: 58.44 })
        .ok,
    ).toBe(false);
    expect(
      molarity({ mode: "massForSolution", concentrationMolL: 1, volumeMl: 100, molarMassGmol: 0 }).ok,
    ).toBe(false);
    expect(molarity({ mode: "massForSolution", volumeMl: 100, molarMassGmol: 58.44 }).ok).toBe(
      false,
    );
    expect(
      molarity({ mode: "concentrationFromMass", volumeMl: 100, molarMassGmol: 58.44, massG: 0 }).ok,
    ).toBe(false);
  });
});

describe("dilution", () => {
  it("solves C1V1 = C2V2 for the final volume", () => {
    // 1 mol/l × 25 ml = 0,1 mol/l × 250 ml; solvent = 250 − 25 = 225 ml
    const result = dilution({
      mode: "solveForVolume",
      stockConcentration: 1,
      stockVolumeMl: 25,
      targetConcentration: 0.1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetVolumeMl).toBeCloseTo(250, 9);
    expect(result.solventToAddMl).toBeCloseTo(225, 9);
    expect(result.dilutionFactor).toBeCloseTo(10, 9);
  });

  it("solves the same equation for the stock volume", () => {
    // V1 = 0,05 × 100 / 0,5 = 10 ml; solvent = 100 − 10 = 90 ml
    const result = dilution({
      mode: "solveForStockVolume",
      stockConcentration: 0.5,
      targetConcentration: 0.05,
      targetVolumeMl: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stockVolumeMl).toBeCloseTo(10, 9);
    expect(result.solventToAddMl).toBeCloseTo(90, 9);
  });

  it("refuses a target above the stock, which no solvent reaches", () => {
    const result = dilution({
      mode: "solveForVolume",
      stockConcentration: 0.1,
      stockVolumeMl: 10,
      targetConcentration: 0.5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("targetOutOfRange");
  });

  it("accepts an equal concentration as a factor of one, adding nothing", () => {
    const result = dilution({
      mode: "solveForVolume",
      stockConcentration: 0.2,
      stockVolumeMl: 50,
      targetConcentration: 0.2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetVolumeMl).toBeCloseTo(50, 9);
    expect(result.solventToAddMl).toBeCloseTo(0, 9);
  });
});

describe("concentrationUnits", () => {
  it("converts percent (w/v) into every other unit", () => {
    // 0,9 % (w/v) = 9 g/l = 9000 ppm = 9·10⁶ ppb = 9 mg/ml
    const result = concentrationUnits({ value: 0.9, unit: "percentWV" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gramPerL).toBeCloseTo(9, 9);
    expect(result.milligramPerMl).toBeCloseTo(9, 9);
    expect(result.ppm).toBeCloseTo(9000, 6);
    expect(result.ppb).toBeCloseTo(9_000_000, 3);
    expect(result.molPerL).toBeUndefined();
  });

  it("uses the molar mass for the two molar units and nowhere else", () => {
    // 1 mmol/l of glucose (M = 180,156) = 0,180156 g/l = 180,156 ppm
    const result = concentrationUnits({
      value: 1,
      unit: "millimolPerL",
      molarMassGmol: 180.156,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gramPerL).toBeCloseTo(0.180156, 9);
    expect(result.ppm).toBeCloseTo(180.156, 9);
    expect(result.molPerL).toBeCloseTo(0.001, 12);
  });

  it("withholds the molar rows when no molar mass was typed", () => {
    const result = concentrationUnits({ value: 5000, unit: "ppm" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gramPerL).toBeCloseTo(5, 9);
    expect(result.percentWV).toBeCloseTo(0.5, 9);
    expect(result.molPerL).toBeUndefined();
  });

  it("refuses a molar unit with no molar mass", () => {
    const result = concentrationUnits({ value: 0.1, unit: "molPerL" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("molarMass");
  });
});

describe("strongAcidPh", () => {
  it("gives pH 1 for 0,1 M HCl", () => {
    const result = strongAcidPh({ mode: "acid", concentrationMolL: 0.1, ionisableGroups: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ph).toBeCloseTo(1, 9);
    expect(result.poh).toBeCloseTo(13, 9);
  });

  it("counts both ionisable groups of 0,05 M H2SO4", () => {
    // c(H⁺) = 0,05 × 2 = 0,1 → pH = 1
    const result = strongAcidPh({ mode: "acid", concentrationMolL: 0.05, ionisableGroups: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ionConcentration).toBeCloseTo(0.1, 12);
    expect(result.ph).toBeCloseTo(1, 9);
  });

  it("gives pH 12 for 0,01 M NaOH", () => {
    // pOH = −log(0,01) = 2 → pH = 14 − 2 = 12
    const result = strongAcidPh({ mode: "base", concentrationMolL: 0.01, ionisableGroups: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.poh).toBeCloseTo(2, 9);
    expect(result.ph).toBeCloseTo(12, 9);
  });

  it("refuses an empty concentration and a group count it cannot count", () => {
    expect(strongAcidPh({ mode: "acid", concentrationMolL: 0, ionisableGroups: 1 }).ok).toBe(false);
    expect(strongAcidPh({ mode: "acid", concentrationMolL: 0.1, ionisableGroups: 0 }).ok).toBe(
      false,
    );
    expect(strongAcidPh({ mode: "acid", concentrationMolL: 0.1, ionisableGroups: 2.5 }).ok).toBe(
      false,
    );
  });
});

describe("bufferPh", () => {
  it("gives the pKa itself when the two forms are equimolar", () => {
    const result = bufferPh({
      mode: "phFromRatio",
      pka: 4.76,
      acidConcentration: 0.1,
      baseConcentration: 0.1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ph).toBeCloseTo(4.76, 9);
    expect(result.ratio).toBeCloseTo(1, 9);
  });

  it("adds log10 of the ratio", () => {
    // log10(2) = 0,301029995…
    const result = bufferPh({
      mode: "phFromRatio",
      pka: 4.76,
      acidConcentration: 0.1,
      baseConcentration: 0.2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ph).toBeCloseTo(5.06103, 5);
  });

  it("solves the equation backwards for a wanted pH", () => {
    // 10^(7,4 − 7,2) = 10^0,2 = 1,5848931924611140
    const result = bufferPh({ mode: "ratioForPh", pka: 7.2, targetPh: 7.4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(1.584893192461114, 12);
    expect(result.ph).toBeCloseTo(7.4, 12);
  });

  it("refuses a missing concentration rather than dividing by it", () => {
    expect(bufferPh({ mode: "phFromRatio", pka: 4.76, baseConcentration: 0.1 }).ok).toBe(false);
    expect(
      bufferPh({ mode: "phFromRatio", pka: 4.76, acidConcentration: 0, baseConcentration: 0.1 })
        .ok,
    ).toBe(false);
    expect(bufferPh({ mode: "ratioForPh", pka: 7.2, targetPh: 15 }).ok).toBe(false);
  });
});
