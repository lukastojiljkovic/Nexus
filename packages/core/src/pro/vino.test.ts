import { describe, expect, it } from "vitest";

import { abvGravity, mustSugar, spiritDilution, sugarAddition, sulfite } from "./vino.js";

describe("mustSugar", () => {
  it("reads Oechsle straight off the definition", () => {
    const result = mustSugar({ specificGravity: 1.09 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.oechsle).toBeCloseTo(90, 6);
  });

  it("takes the sugar in a litre from Brix times specific gravity", () => {
    // 21,5 °Bx · 10 · 1,09 = 234,35 g/L; over 100 L that is 23,435 kg.
    const result = mustSugar({ brix: 21.5, specificGravity: 1.09, volumeL: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sugarGPer100g).toBeCloseTo(21.5, 9);
    expect(result.sugarGPerL).toBeCloseTo(234.35, 9);
    expect(result.sugarKg).toBeCloseTo(23.435, 9);
  });

  it("uses the stoichiometric yield when nobody typed one, and says so", () => {
    // 2·46,069/180,156 = 0,511434 g/g; 7,893 g/L is 1 % v/v of ethanol; so
    // 15,4331 g/L per percent and 234,35/15,4331 = 15,1849 %.
    const result = mustSugar({ brix: 21.5, specificGravity: 1.09 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.yieldIsTheoretical).toBe(true);
    expect(result.yieldUsed).toBeCloseTo(0.511435, 6);
    expect(result.sugarPerPercentPerL).toBeCloseTo(15.4331, 3);
    expect(result.potentialAbv).toBeCloseTo(15.1849, 4);
  });

  it("uses the cellar's own yield when it is given", () => {
    // y = 0,47 → 7,893/0,47 = 16,7936 g/L per percent; 234,35/16,7936 = 13,9547 %.
    const result = mustSugar({ brix: 21.5, specificGravity: 1.09, yieldFactor: 0.47 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.yieldIsTheoretical).toBe(false);
    expect(result.potentialAbv).toBeCloseTo(13.9547, 4);
  });

  it("withholds the concentration without a hydrometer reading", () => {
    const result = mustSugar({ brix: 21.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sugarGPer100g).toBeCloseTo(21.5, 9);
    expect(result.sugarGPerL).toBeUndefined();
    expect(result.potentialAbv).toBeUndefined();
    expect(result.oechsle).toBeUndefined();
  });

  it("refuses an empty reading", () => {
    expect(mustSugar({})).toEqual({ ok: false, reason: "brix" });
  });
});

describe("sugarAddition", () => {
  it("gives 21,83 kg of sugar for 100 L heading to 13 % v/v", () => {
    // 13 · 7,893 / 0,47 = 218,317 g/L; · 100 L = 21,8317 kg.
    const result = sugarAddition({
      volumeL: 100,
      currentSugarGPerL: 0,
      targetAbv: 13,
      yieldFactor: 0.47,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requiredSugarGPerL).toBeCloseTo(218.317, 3);
    expect(result.additionGPerL).toBeCloseTo(218.317, 3);
    expect(result.additionKg).toBeCloseTo(21.8317, 4);
  });

  it("takes off the sugar the must already carries", () => {
    const result = sugarAddition({
      volumeL: 100,
      currentSugarGPerL: 50,
      targetAbv: 13,
      yieldFactor: 0.47,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.additionGPerL).toBeCloseTo(168.317, 3);
    expect(result.additionKg).toBeCloseTo(16.8317, 4);
  });

  it("returns a negative addition for a must already past the target", () => {
    const result = sugarAddition({
      volumeL: 100,
      currentSugarGPerL: 250,
      targetAbv: 13,
      yieldFactor: 0.47,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.additionGPerL).toBeCloseTo(-31.683, 3);
    expect(result.additionKg).toBeCloseTo(-3.1683, 4);
  });
});

describe("abvGravity", () => {
  it("turns a 1,050 → 1,010 drop into 5,25 % v/v", () => {
    const result = abvGravity({ originalGravity: 1.05, finalGravity: 1.01 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gravityDrop).toBeCloseTo(0.04, 9);
    expect(result.abv).toBeCloseTo(5.25, 6);
    expect(result.abw).toBeCloseTo(4.2, 6);
    expect(result.apparentAttenuationPercent).toBeCloseTo(80, 6);
  });

  it("refuses a final gravity above the original", () => {
    const result = abvGravity({ originalGravity: 1.04, finalGravity: 1.05 });
    expect(result).toEqual({ ok: false, reason: "finalGravity" });
  });
});

describe("spiritDilution", () => {
  it("adds 5 L of water to 10 L at 60 % to reach 40 %", () => {
    const result = spiritDilution({
      direction: "dilute",
      currentStrength: 60,
      targetStrength: 40,
      volumeL: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.addedVolumeL).toBeCloseTo(5, 9);
    expect(result.finalVolumeL).toBeCloseTo(15, 9);
    expect(result.alcoholL).toBeCloseTo(6, 9);
  });

  it("adds 5,556 L of 96 % spirit to 10 L at 40 % to reach 60 %", () => {
    const result = spiritDilution({
      direction: "fortify",
      currentStrength: 40,
      targetStrength: 60,
      volumeL: 10,
      addedStrength: 96,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.addedVolumeL).toBeCloseTo(5.555556, 6);
    expect(result.finalVolumeL).toBeCloseTo(15.555556, 6);
  });

  it("refuses a dilution that would strengthen the batch", () => {
    const result = spiritDilution({
      direction: "dilute",
      currentStrength: 40,
      targetStrength: 60,
      volumeL: 10,
    });
    expect(result).toEqual({ ok: false, reason: "targetStrength" });
  });
});

describe("sulfite", () => {
  it("turns 1 g of metabisulfite into 0,5763 g of SO₂", () => {
    // 2·64,058 / (2·39,0983 + 2·32,06 + 5·15,999) = 128,116/222,3116 = 0,57629.
    const result = sulfite({ mode: "fromMetabisulfite", metabisulfiteG: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.so2Fraction).toBeCloseTo(0.57629, 4);
    expect(result.so2G).toBeCloseTo(0.57629, 4);
  });

  it("gives the dose per litre when the volume is known", () => {
    const result = sulfite({ mode: "fromMetabisulfite", metabisulfiteG: 1, volumeL: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metabisulfiteMgPerL).toBeCloseTo(50, 9);
    expect(result.so2MgPerL).toBeCloseTo(28.8145, 3);
  });

  it("reads the wanted SO₂ back into the metabisulfite to weigh out", () => {
    // 3/0,57629 = 5,20674 g.
    const result = sulfite({ mode: "fromSo2", so2G: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metabisulfiteG).toBeCloseTo(5.20571, 4);
  });

  it("refuses both masses at once", () => {
    const result = sulfite({ mode: "fromSo2", so2G: 3, metabisulfiteG: 5 });
    expect(result).toEqual({ ok: false, reason: "known" });
  });
});
