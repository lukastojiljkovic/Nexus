/**
 * „Vino i rakija" — the arithmetic behind the toolkit's tools.
 *
 * One file per PACK, as `pro/gradnja.ts` explains.
 *
 * **What this pack will not do is made explicit in the code, not just in the
 * copy.** Two conversions the brief for it asked about are NOT here:
 *
 *  - **Brix to specific gravity.** The relation between a refractometer reading
 *    and a hydrometer reading is a TABLE (ICUMSA's sucrose scale, or the
 *    Oechsle/Plato scale), and every closed form of it in circulation is a
 *    polynomial fit whose coefficients this repository cannot verify. Writing
 *    one from memory would be inventing a number that then decides a wine's
 *    sugar — so the tool takes the refractometer reading and the hydrometer
 *    reading TOGETHER, from the user's own two instruments, and converts what is
 *    exact between them.
 *  - **The OIML R 22 temperature correction of an alcoholmeter.** The tables of
 *    that recommendation are not in this repository, so the reading is taken as
 *    it was read.
 *
 * What IS exact here is chemistry and definition: the Oechsle scale is defined
 * as `(SG − 1)·1000`, Brix is a mass fraction, and Gay-Lussac's equation fixes
 * the ethanol a sugar can yield. The practical fermentation yield is lower than
 * the stoichiometric one, so it is an INPUT — the user's own cellars decide it,
 * and the answer prints which figure produced it.
 *
 * **Calculations only.** Nothing here says how much to drink, or what a wine
 * should contain. The one regulated figure in the trade — the legal SO₂ maximum
 * — is not in this file at all, and the tool that doses metabisulfite reports
 * the mass it would add and no verdict about it.
 */

import { fail, isInRange, isNonNegative, isPositive, type ProResult } from "./result.js";

/**
 * Standard atomic weights, g/mol — IUPAC/CIAAW 2021, the values the periodic
 * table carries. Written with their element names so the stoichiometry below
 * can be followed without a lookup.
 */
const CARBON = 12.011;
const HYDROGEN = 1.008;
const OXYGEN = 15.999;
const POTASSIUM = 39.0983;
const SULFUR = 32.06;

/** C₆H₁₂O₆ — glucose, 180,156 g/mol. */
const GLUCOSE = 6 * CARBON + 12 * HYDROGEN + 6 * OXYGEN;

/** C₂H₅OH — ethanol, 46,069 g/mol. */
const ETHANOL = 2 * CARBON + 6 * HYDROGEN + OXYGEN;

/**
 * The ethanol one gram of sugar can yield, g/g — the theoretical maximum from
 * Gay-Lussac's equation `C₆H₁₂O₆ → 2 C₂H₅OH + 2 CO₂`: two moles of ethanol per
 * mole of glucose, so `2·46,069 / 180,156 = 0,5114`.
 *
 * Real fermentations stop short of it — carbon goes into biomass and glycerol —
 * which is why the tools take the yield the user's own experience gives and
 * only fall back to this when nobody has typed one. The value used is echoed.
 */
const THEORETICAL_YIELD = (2 * ETHANOL) / GLUCOSE;

/**
 * Grams of ethanol in one litre of a 1 % v/v solution, g/L.
 *
 * Ethanol's density at 20 °C is 789,3 kg/m³, so one percent by volume is
 * 0,01 × 789,3 = 7,893 g/L. By volume is what the strength of a wine or a
 * rakija is written in, so this is the bridge between the mass the chemistry
 * gives and the percentage the label carries.
 */
const ETHANOL_GRAMS_PER_PERCENT_PER_LITRE = 789.3 * 0.01;

/** K₂S₂O₅ — potassium metabisulfite, 222,31 g/mol. */
const METABISULFITE = 2 * POTASSIUM + 2 * SULFUR + 5 * OXYGEN;

/** SO₂ — sulfur dioxide, 64,058 g/mol. */
const SULFUR_DIOXIDE = SULFUR + 2 * OXYGEN;

export interface MustSugarInput {
  /** Refractometer reading, °Bx — sugar as a mass percentage of the must. */
  readonly brix?: number | undefined;
  /** Hydrometer reading, specific gravity. 1.090 rather than 90. */
  readonly specificGravity?: number | undefined;
  /** Must volume, litres — turns all the concentrations into masses. */
  readonly volumeL?: number | undefined;
  /** Fermentation yield, g ethanol per g sugar. Absent uses the stoichiometric one. */
  readonly yieldFactor?: number | undefined;
}

export interface MustSugarResult {
  /** The Brix reading itself, as sugar grams per 100 g of must. */
  readonly sugarGPer100g: number | undefined;
  /** The Oechsle reading the specific gravity IS, by the scale's own definition. */
  readonly oechsle: number | undefined;
  /** Sugar concentration, g per litre of must. Absent without both readings. */
  readonly sugarGPerL: number | undefined;
  /** Total sugar in the volume, kg. Absent without the volume. */
  readonly sugarKg: number | undefined;
  readonly yieldUsed: number;
  readonly yieldIsTheoretical: boolean;
  /** Potential alcohol, % v/v, at that yield. */
  readonly potentialAbv: number | undefined;
  /** Sugar per litre that each 1 % v/v would need, at that yield. */
  readonly sugarPerPercentPerL: number;
}

/**
 * Sugar and potential alcohol from a must's own readings.
 *
 *     °Oe = (SG − 1)·1000                     (definition of the Oechsle scale)
 *     c   = Bx · 10 · SG                      (Brix is a mass fraction, so
 *                                              g/100 g × density)
 *     ABV = c · y / 7,893                     (y = g ethanol per g sugar)
 *
 * **Both readings are needed for the concentration, and that is a fact about
 * instruments rather than a limitation.** A refractometer measures the mass
 * fraction and a hydrometer measures the density; the sugar in a litre is the
 * one times the other. With only the refractometer the tool still answers the
 * mass fraction and the sugar a percent of alcohol needs; it withholds the
 * grams per litre and the potential alcohol rather than multiplying by a
 * density nobody measured.
 */
export function mustSugar(input: MustSugarInput): ProResult<MustSugarResult> {
  if (input.brix !== undefined && !isInRange(input.brix, 0, 60)) return fail("brix");
  if (input.specificGravity !== undefined && !isInRange(input.specificGravity, 0.9, 1.3)) {
    return fail("specificGravity");
  }
  if (input.brix === undefined && input.specificGravity === undefined) return fail("brix");
  const volume = input.volumeL;
  if (volume !== undefined && !isPositive(volume)) return fail("volume");

  const yieldFactor = input.yieldFactor;
  if (yieldFactor !== undefined && !isInRange(yieldFactor, 0.3, 0.55)) return fail("yieldFactor");
  const yieldUsed = yieldFactor ?? THEORETICAL_YIELD;

  const sugarPerPercentPerL =
    ETHANOL_GRAMS_PER_PERCENT_PER_LITRE / yieldUsed;

  const oechsle =
    input.specificGravity === undefined ? undefined : (input.specificGravity - 1) * 1000;

  let sugarGPerL: number | undefined;
  if (input.brix !== undefined && input.specificGravity !== undefined) {
    sugarGPerL = input.brix * 10 * input.specificGravity;
  }

  return {
    ok: true,
    sugarGPer100g: input.brix,
    oechsle,
    sugarGPerL,
    sugarKg: sugarGPerL === undefined || volume === undefined ? undefined : (sugarGPerL * volume) / 1000,
    yieldUsed,
    yieldIsTheoretical: yieldFactor === undefined,
    potentialAbv: sugarGPerL === undefined ? undefined : sugarGPerL / sugarPerPercentPerL,
    sugarPerPercentPerL,
  };
}

export interface SugarAdditionInput {
  /** Must volume, litres. */
  readonly volumeL: number;
  /** Sugar already in the must, g/L. Zero is a valid, dry must. */
  readonly currentSugarGPerL: number;
  /** The potential alcohol wanted, % v/v. */
  readonly targetAbv: number;
  /** Fermentation yield, g ethanol per g sugar. Absent uses the stoichiometric one. */
  readonly yieldFactor?: number | undefined;
}

export interface SugarAdditionResult {
  readonly requiredSugarGPerL: number;
  /** Sugar to add, g per litre of must. Negative when the must is already past the target. */
  readonly additionGPerL: number;
  /** Total sugar to add, kg — the number that goes on the scale. */
  readonly additionKg: number;
  readonly totalSugarKg: number;
  readonly yieldUsed: number;
  readonly yieldIsTheoretical: boolean;
}

/**
 * Sugar to add to reach a target potential alcohol — chaptalisation as
 * arithmetic, with the sugar already present taken off.
 *
 * The target is `ABV · 7,893 / y` grams per litre, and what is added is the
 * difference. **A NEGATIVE addition is returned rather than refused**, because
 * a must that is already stronger than the target is an ordinary outcome —
 * the answer is that this must needs diluting, and hiding the sign would hide
 * which direction the batch is wrong in.
 */
export function sugarAddition(input: SugarAdditionInput): ProResult<SugarAdditionResult> {
  const { volumeL, currentSugarGPerL, targetAbv } = input;
  if (!isPositive(volumeL) || volumeL > 1e6) return fail("volume");
  if (!isNonNegative(currentSugarGPerL) || currentSugarGPerL > 500) return fail("currentSugar");
  if (!isInRange(targetAbv, 0.1, 25)) return fail("targetAbv");

  const yieldFactor = input.yieldFactor;
  if (yieldFactor !== undefined && !isInRange(yieldFactor, 0.3, 0.55)) return fail("yieldFactor");
  const yieldUsed = yieldFactor ?? THEORETICAL_YIELD;

  const requiredSugarGPerL = (targetAbv * ETHANOL_GRAMS_PER_PERCENT_PER_LITRE) / yieldUsed;
  const additionGPerL = requiredSugarGPerL - currentSugarGPerL;
  return {
    ok: true,
    requiredSugarGPerL,
    additionGPerL,
    additionKg: (additionGPerL * volumeL) / 1000,
    totalSugarKg: (requiredSugarGPerL * volumeL) / 1000,
    yieldUsed,
    yieldIsTheoretical: yieldFactor === undefined,
  };
}

/**
 * The two customary linear rules from the Balling/Plato scale, in the spelling
 * the trade uses.
 *
 * They are EMPIRICAL fits, not laws: `ABV = (OG − FG) × 131,25` and
 * `ABW = (OG − FG) × 105` are accurate over the ordinary brewing range and
 * drift at the extremes. Both are printed for that reason — a reader who
 * knows the rule they trust can see whether this file used it.
 */
const ABV_PER_GRAVITY_POINT = 131.25;
const ABW_PER_GRAVITY_POINT = 105;

export interface AbvGravityInput {
  /** Original gravity, specific gravity. */
  readonly originalGravity: number;
  /** Final gravity, specific gravity. */
  readonly finalGravity: number;
}

export interface AbvGravityResult {
  readonly gravityDrop: number;
  readonly abv: number;
  readonly abw: number;
  /** Apparent attenuation, %, of the extract that was there to ferment. */
  readonly apparentAttenuationPercent: number;
}

/**
 * Alcohol from the two hydrometer readings, and the attenuation between them.
 *
 *     ABV = (OG − FG) · 131,25      ABW = (OG − FG) · 105
 *     apparent attenuation = (OG − FG) / (OG − 1) · 100
 *
 * **The final gravity may not be above the original** — that is not a strong
 * beer but a mistyped reading, and the refusal says so rather than returning a
 * negative alcohol content.
 */
export function abvGravity(input: AbvGravityInput): ProResult<AbvGravityResult> {
  const { originalGravity: og, finalGravity: fg } = input;
  if (!isInRange(og, 1, 1.3)) return fail("originalGravity");
  if (!isInRange(fg, 0.98, 1.3)) return fail("finalGravity");
  if (fg > og) return fail("finalGravity");
  const gravityDrop = og - fg;
  return {
    ok: true,
    gravityDrop,
    abv: gravityDrop * ABV_PER_GRAVITY_POINT,
    abw: gravityDrop * ABW_PER_GRAVITY_POINT,
    apparentAttenuationPercent: og === 1 ? 0 : (gravityDrop / (og - 1)) * 100,
  };
}

export type StrengthDirection = "dilute" | "fortify";

export interface SpiritDilutionInput {
  readonly direction: StrengthDirection;
  /** Strength of what is in the vessel, % v/v. */
  readonly currentStrength: number;
  /** Strength wanted, % v/v. */
  readonly targetStrength: number;
  /** Volume in the vessel, litres. */
  readonly volumeL: number;
  /** Strength of what is being added — water is 0 % v/v. */
  readonly addedStrength?: number | undefined;
}

export interface SpiritDilutionResult {
  /** Litres to add. */
  readonly addedVolumeL: number;
  /** Volume after the addition, litres — the simple mixing equation's answer. */
  readonly finalVolumeL: number;
  readonly addedStrength: number;
  /** Alcohol in the vessel before and after, litres — identical by construction. */
  readonly alcoholL: number;
}

/**
 * Diluting or fortifying a spirit to a target strength: `V₁·C₁ + V_a·C_a =
 * (V₁ + V_a)·C₂`, solved for the volume to add.
 *
 * **This is the simple mixing equation, and the contraction is NOT applied.**
 * Ethanol and water do not add volumes linearly — mixing 50 L of alcohol with
 * 50 L of water gives rather less than 100 L, by an amount the OIML
 * alcoholometric tables carry — and those tables are not in this repository, so
 * the surface says the answer is the un-corrected one. For a small adjustment
 * at cask strength the difference is small; for a bulk reduction to bottling
 * strength it is not, and knowing which of the two equations ran is the point.
 */
export function spiritDilution(input: SpiritDilutionInput): ProResult<SpiritDilutionResult> {
  const { currentStrength, targetStrength, volumeL } = input;
  if (!isInRange(currentStrength, 0, 96)) return fail("currentStrength");
  if (!isInRange(targetStrength, 0, 96)) return fail("targetStrength");
  if (!isPositive(volumeL) || volumeL > 1e6) return fail("volume");
  const addedStrength = input.addedStrength ?? 0;
  if (!isInRange(addedStrength, 0, 96)) return fail("addedStrength");

  if (input.direction === "dilute") {
    if (targetStrength >= currentStrength) return fail("targetStrength");
    if (addedStrength >= targetStrength) return fail("addedStrength");
  } else if (input.direction === "fortify") {
    if (targetStrength <= currentStrength) return fail("targetStrength");
    if (addedStrength <= targetStrength) return fail("addedStrength");
  } else {
    return fail("direction");
  }

  const alcoholL = (volumeL * currentStrength) / 100;
  const addedVolumeL =
    (volumeL * (targetStrength - currentStrength)) / (addedStrength - targetStrength);
  return {
    ok: true,
    addedVolumeL,
    finalVolumeL: volumeL + addedVolumeL,
    addedStrength,
    alcoholL,
  };
}

export type SulfiteMode = "fromMetabisulfite" | "fromSo2";

export interface SulfiteInput {
  readonly mode: SulfiteMode;
  /** Mass of potassium metabisulfite, g — with `fromMetabisulfite`. */
  readonly metabisulfiteG?: number | undefined;
  /** Mass of SO₂ wanted, g — with `fromSo2`. */
  readonly so2G?: number | undefined;
  /** Volume the dose is for, litres. Optional: without it only the masses are given. */
  readonly volumeL?: number | undefined;
}

export interface SulfiteResult {
  readonly metabisulfiteG: number;
  readonly so2G: number;
  readonly metabisulfiteMgPerL: number | undefined;
  readonly so2MgPerL: number | undefined;
  /** The SO₂ share of metabisulfite by mass, g/g — returned so it can be checked. */
  readonly so2Fraction: number;
}

/**
 * The sulfur dioxide a dose of potassium metabisulfite carries, and the dose
 * that carries a wanted amount — from the stoichiometry alone.
 *
 *     K₂S₂O₅ → 2 SO₂          so   m(SO₂) = m(K₂S₂O₅) · 2·M(SO₂) / M(K₂S₂O₅)
 *
 * With the 2021 atomic weights that share is 0,5763 g of SO₂ per gram of
 * metabisulfite, and the figure is RETURNED as `so2Fraction` so a reader can
 * check the arithmetic against their own supplier's data sheet.
 *
 * **What this is not.** It is not the free SO₂ in the wine: metabisulfite
 * binds as well as it dissolves, and how much stays free depends on the wine's
 * pH and its own binding sites, which this file cannot see. The mass of SO₂
 * added is the fact; what it does in the vessel is not claimed.
 */
export function sulfite(input: SulfiteInput): ProResult<SulfiteResult> {
  const so2Fraction = (2 * SULFUR_DIOXIDE) / METABISULFITE;
  const volume = input.volumeL;
  if (volume !== undefined && !isPositive(volume)) return fail("volume");

  let metabisulfiteG: number;
  let so2G: number;
  if (input.mode === "fromMetabisulfite") {
    if (input.so2G !== undefined) return fail("known");
    const mass = input.metabisulfiteG;
    if (mass === undefined || !isNonNegative(mass) || mass > 1e6) return fail("metabisulfite");
    metabisulfiteG = mass;
    so2G = mass * so2Fraction;
  } else if (input.mode === "fromSo2") {
    if (input.metabisulfiteG !== undefined) return fail("known");
    const mass = input.so2G;
    if (mass === undefined || !isNonNegative(mass) || mass > 1e6) return fail("so2");
    so2G = mass;
    metabisulfiteG = mass / so2Fraction;
  } else {
    return fail("mode");
  }

  return {
    ok: true,
    metabisulfiteG,
    so2G,
    metabisulfiteMgPerL: volume === undefined ? undefined : (metabisulfiteG * 1000) / volume,
    so2MgPerL: volume === undefined ? undefined : (so2G * 1000) / volume,
    so2Fraction,
  };
}
