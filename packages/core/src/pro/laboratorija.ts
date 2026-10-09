/**
 * „Laboratorija" — the arithmetic behind the laboratory toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains:
 * a maintainer asks „where does the molar mass live", and `pro/laboratorija.ts`
 * answers it where `pro/chemistry.ts` would not.
 *
 * **These are pure functions and they refuse rather than repair.** No I/O, no
 * locale, no formatting: every concentration arrives in mol/L or g/L and the
 * surface converts only what it prints.
 *
 * **Four of these tools are `life-safety`, because the class list names chemical
 * exposure.** They return quantities — a mass to weigh, a volume of solvent, a
 * pH — and never a word about whether a preparation is appropriate, permitted or
 * safe. Where the user types a limit of their own, the answer carries
 * `ratioAgainst` and nothing else: no boolean, no severity, no verdict.
 *
 * **The atomic weights are the one published table here, and the whole table is
 * embedded deliberately.** It is `published` tier under
 * `TOOL_CONSTANT_TIERS`: stable, versioned and cited on the surface (CIAAW 2021),
 * and a molar mass is a display-only figure that nothing downstream judges
 * against. An element with no standard atomic weight — Tc, Pm, Po and the rest
 * of the radioactive series — is refused by name rather than given a mass number
 * this file would have to invent.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isKeyOf,
  isPositive,
  quotient,
  type ProResult,
} from "./result.js";

/**
 * Standard atomic weights, CIAAW/IUPAC 2021 (abridged), in g/mol.
 *
 * The abridged table is the one IUPAC publishes as „the" standard atomic
 * weights: it carries a single conventional value per element, which is what a
 * stoichiometry calculation wants. Elements whose standard atomic weight is
 * given only as an interval (H, Li, B, C, N, O, Mg, Si, S, Cl, Br, Tl) use the
 * conventional value from that same table.
 */
const ATOMIC_WEIGHTS: Readonly<Record<string, number>> = {
  H: 1.008,
  He: 4.0026,
  Li: 6.94,
  Be: 9.0122,
  B: 10.81,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  F: 18.998,
  Ne: 20.18,
  Na: 22.99,
  Mg: 24.305,
  Al: 26.982,
  Si: 28.085,
  P: 30.974,
  S: 32.06,
  Cl: 35.45,
  Ar: 39.95,
  K: 39.098,
  Ca: 40.078,
  Sc: 44.956,
  Ti: 47.867,
  V: 50.942,
  Cr: 51.996,
  Mn: 54.938,
  Fe: 55.845,
  Co: 58.933,
  Ni: 58.693,
  Cu: 63.546,
  Zn: 65.38,
  Ga: 69.723,
  Ge: 72.63,
  As: 74.922,
  Se: 78.971,
  Br: 79.904,
  Kr: 83.798,
  Rb: 85.468,
  Sr: 87.62,
  Y: 88.906,
  Zr: 91.224,
  Nb: 92.906,
  Mo: 95.95,
  Ru: 101.07,
  Rh: 102.91,
  Pd: 106.42,
  Ag: 107.87,
  Cd: 112.41,
  In: 114.82,
  Sn: 118.71,
  Sb: 121.76,
  Te: 127.6,
  I: 126.9,
  Xe: 131.29,
  Cs: 132.91,
  Ba: 137.33,
  La: 138.91,
  Ce: 140.12,
  Pr: 140.91,
  Nd: 144.24,
  Sm: 150.36,
  Eu: 151.96,
  Gd: 157.25,
  Tb: 158.93,
  Dy: 162.5,
  Ho: 164.93,
  Er: 167.26,
  Tm: 168.93,
  Yb: 173.05,
  Lu: 174.97,
  Hf: 178.49,
  Ta: 180.95,
  W: 183.84,
  Re: 186.21,
  Os: 190.23,
  Ir: 192.22,
  Pt: 195.08,
  Au: 196.97,
  Hg: 200.59,
  Tl: 204.38,
  Pb: 207.2,
  Bi: 208.98,
  Th: 232.04,
  Pa: 231.04,
  U: 238.03,
};

/** The marks a hydrate may be written with. `*` and `.` are the plain-text spellings. */
const HYDRATE_MARKS = "·.*•×";

/** Longest formula this reads, and how deep its brackets may nest. Both are this tool's own bounds. */
const FORMULA_MAX_LENGTH = 500;
const FORMULA_MAX_DEPTH = 10;

/** How many atoms, per element, a parsed formula weighed out. */
export interface MolarMassElement {
  readonly symbol: string;
  /** Total atoms of this element, counting every group and hydrate multiplier. */
  readonly count: number;
  /** `count × Ar`, g/mol. */
  readonly mass: number;
  /** `100·mass / molarMass`, the percentage of the molar mass this element is. */
  readonly sharePercent: number;
}

export interface MolarMassInput {
  /** As written on the label: `H2O`, `Ca(OH)2`, `CuSO4·5H2O`, `Al2[SO4]3`. */
  readonly formula: string;
}

export interface MolarMassResult {
  readonly molarMass: number;
  /** In order of first appearance in the formula, so the breakdown reads like the label. */
  readonly elements: readonly MolarMassElement[];
  readonly totalAtoms: number;
}

interface ParseState {
  readonly text: string;
  position: number;
  /** The serbian-free reason code: `formula` for syntax, `element:<symbol>` for an unknown symbol. */
  error: string;
}

function isUpper(ch: string): boolean {
  return ch >= "A" && ch <= "Z";
}

function isLower(ch: string): boolean {
  return ch >= "a" && ch <= "z";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** The element symbol at `position`, or null when the text does not start one. */
function readSymbol(state: ParseState): string | null {
  const first = state.text[state.position];
  if (first === undefined || !isUpper(first)) return null;
  const second = state.text[state.position + 1];
  if (second !== undefined && isLower(second)) return `${first}${second}`;
  return first;
}

/** Digits at `position`, as a whole number; an absent count is 1. */
function readCount(state: ParseState): number | undefined {
  const from = state.position;
  while (isDigit(state.text[state.position] ?? "")) state.position += 1;
  if (state.position === from) return 1;
  const value = Number(state.text.slice(from, state.position));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * One sequence of elements, groups and hydrates, folded into `counts` with the
 * multiplier the caller arrived with.
 *
 * Recursive descent, and the three things it has to get right are the three
 * things a formula has that a plain list does not: a bracketed group followed by
 * its own multiplier, a hydrate whose multiplier reaches the whole remainder of
 * the formula, and a two-letter symbol that must be read as one element rather
 * than two.
 */
function parseSequence(
  state: ParseState,
  counts: Map<string, number>,
  factor: number,
  depth: number,
  closer: string | null,
): boolean {
  while (state.position < state.text.length) {
    const ch = state.text[state.position] ?? "";
    if (closer !== null && ch === closer) {
      state.position += 1;
      return true;
    }
    if (ch === ")" || ch === "]") {
      // A closing bracket with nothing open: the formula's brackets do not pair.
      state.error = "formula";
      return false;
    }
    if (ch === " " || ch === "\t") {
      state.position += 1;
      continue;
    }
    if (ch === "(" || ch === "[") {
      if (depth >= FORMULA_MAX_DEPTH) {
        state.error = "formula";
        return false;
      }
      state.position += 1;
      const inner = new Map<string, number>();
      if (!parseSequence(state, inner, 1, depth + 1, ch === "(" ? ")" : "]")) return false;
      const multiplier = readCount(state);
      if (multiplier === undefined) {
        state.error = "formula";
        return false;
      }
      for (const [symbol, atoms] of inner) {
        counts.set(symbol, (counts.get(symbol) ?? 0) + atoms * multiplier * factor);
      }
      continue;
    }
    if (HYDRATE_MARKS.includes(ch)) {
      state.position += 1;
      const multiplier = readCount(state);
      if (multiplier === undefined) {
        state.error = "formula";
        return false;
      }
      // A mark with nothing behind it multiplies nothing: `H2O·` is a label
      // somebody cut off, not a formula with a trailing multiplier.
      if (state.position >= state.text.length) {
        state.error = "formula";
        return false;
      }
      // The rest of the formula belongs to this hydrate, so it is parsed as its
      // own sequence and this loop ends with it.
      return parseSequence(state, counts, factor * multiplier, depth, closer);
    }
    const symbol = readSymbol(state);
    if (symbol === null) {
      state.error = "formula";
      return false;
    }
    if (!isKeyOf(symbol, ATOMIC_WEIGHTS)) {
      state.error = `element:${symbol}`;
      return false;
    }
    state.position += symbol.length;
    const count = readCount(state);
    if (count === undefined) {
      state.error = "formula";
      return false;
    }
    counts.set(symbol, (counts.get(symbol) ?? 0) + count * factor);
  }
  // Ran out of text with a bracket still open.
  if (closer !== null) {
    state.error = "formula";
    return false;
  }
  return true;
}

/**
 * Molar mass from a chemical formula, with the per-element breakdown.
 *
 * `M = Σ nᵢ·Arᵢ` — the defining relation, with `nᵢ` the total atom count after
 * every bracket and hydrate multiplier is applied. The parse is the tool: the
 * arithmetic is one sum once the counts are right, and the counts are wrong in
 * exactly three ways — a two-letter symbol read as two elements, a group
 * multiplier dropped, and a hydrate multiplier applied to one molecule instead
 * of the water it multiplies.
 */
export function molarMass(input: MolarMassInput): ProResult<MolarMassResult> {
  const text = input.formula.trim();
  if (text === "" || text.length > FORMULA_MAX_LENGTH) return fail("formula");
  const state: ParseState = { text, position: 0, error: "formula" };
  const counts = new Map<string, number>();
  if (!parseSequence(state, counts, 1, 0, null)) return fail(state.error);
  if (counts.size === 0) return fail("formula");

  let molarMassValue = 0;
  let totalAtoms = 0;
  for (const [symbol, count] of counts) {
    const weight = ATOMIC_WEIGHTS[symbol];
    if (weight === undefined) return fail(`element:${symbol}`);
    molarMassValue += count * weight;
    totalAtoms += count;
  }
  if (!Number.isFinite(molarMassValue) || molarMassValue <= 0) return fail("formula");

  const elements: MolarMassElement[] = [...counts].map(([symbol, count]) => {
    const mass = count * (ATOMIC_WEIGHTS[symbol] ?? 0);
    return { symbol, count, mass, sharePercent: (100 * mass) / molarMassValue };
  });
  return { ok: true, molarMass: molarMassValue, elements, totalAtoms };
}

/* -------------------------------------------------------------------------- */
/* molarity-mass — molarnost i odmeravanje                                     */
/* -------------------------------------------------------------------------- */

/** Cubic centimetres in a litre: 1 l = 1000 ml = 1000 cm³, by the SI prefix alone. */
const ML_PER_L = 1000;

export type MolarityMode = "massForSolution" | "concentrationFromMass";

export interface MolarityInput {
  readonly mode: MolarityMode;
  /** mol/L. Required in `massForSolution`, computed in the other mode. */
  readonly concentrationMolL?: number | undefined;
  /** The volume of solution, ml. */
  readonly volumeMl: number;
  /** Molar mass of the substance, g/mol — from `molarMass` or the label. */
  readonly molarMassGmol: number;
  /** Mass weighed out, g — required in `concentrationFromMass`. */
  readonly massG?: number | undefined;
}

export interface MolarityResult {
  readonly concentrationMolL: number;
  readonly moles: number;
  readonly massG: number;
  /** The volume, in litres — the unit the two identities are written in. */
  readonly volumeL: number;
}

/**
 * `n = c·V` and `m = n·M`, solved either way.
 *
 * The two modes are the same identity read from opposite ends: a preparation
 * sheet asks „how much do I weigh for 250 ml of 0,1 M", and a stock bottle asks
 * „what did I make if I dissolved 4,00 g in 500 ml".
 */
export function molarity(input: MolarityInput): ProResult<MolarityResult> {
  const { volumeMl, molarMassGmol } = input;
  if (!isInRange(volumeMl, 0.001, 1e6)) return fail("volume");
  if (!isInRange(molarMassGmol, 0.0001, 1e6)) return fail("molarMass");
  const volumeL = volumeMl / ML_PER_L;

  if (input.mode === "massForSolution") {
    const concentration = input.concentrationMolL;
    if (!isInRange(concentration, 0.0000001, 1000)) return fail("concentration");
    const moles = concentration * volumeL;
    return { ok: true, concentrationMolL: concentration, moles, massG: moles * molarMassGmol, volumeL };
  }

  const mass = input.massG;
  if (!isInRange(mass, 0.0000001, 1e9)) return fail("mass");
  const moles = quotient(mass, molarMassGmol);
  if (moles === undefined) return fail("molarMass");
  const concentration = quotient(moles, volumeL);
  if (concentration === undefined) return fail("volume");
  return { ok: true, concentrationMolL: concentration, moles, massG: mass, volumeL };
}

/* -------------------------------------------------------------------------- */
/* dilution — razblaživanje                                                     */
/* -------------------------------------------------------------------------- */

export type DilutionMode = "solveForVolume" | "solveForStockVolume";

export interface DilutionInput {
  readonly mode: DilutionMode;
  /** Concentration of the stock, mol/L (or any one unit — the ratio is unit-free). */
  readonly stockConcentration: number;
  /** Volume of stock taken, ml — required in `solveForVolume`. */
  readonly stockVolumeMl?: number | undefined;
  /** The concentration wanted, same unit as the stock. Never above it. */
  readonly targetConcentration: number;
  /** The volume wanted, ml — required in `solveForStockVolume`. */
  readonly targetVolumeMl?: number | undefined;
}

export interface DilutionResult {
  readonly stockVolumeMl: number;
  readonly targetVolumeMl: number;
  /** Solvent to add: final volume minus the stock already in the flask. */
  readonly solventToAddMl: number;
  /** `C1/C2` — how many times the stock is diluted. 10 means „1 : 10". */
  readonly dilutionFactor: number;
}

/**
 * `C1·V1 = C2·V2`, solved for whichever volume was not typed.
 *
 * The equation is the conservation of the amount of solute: diluting changes the
 * volume and not the number of moles. `C2 > C1` is refused rather than answered —
 * no addition of solvent reaches a concentration above the stock's, and the
 * arithmetic would otherwise return a negative volume of solvent that reads like
 * a plausible number.
 *
 * In `solveForVolume` the volumes are those of the FINAL solution, which is the
 * convention a volumetric flask is marked in; `solventToAddMl` is therefore what
 * goes in after the stock, and `targetVolumeMl` is where the meniscus ends.
 */
export function dilution(input: DilutionInput): ProResult<DilutionResult> {
  const { stockConcentration: c1, targetConcentration: c2 } = input;
  if (!isInRange(c1, 0.0000001, 1e6)) return fail("stockConcentration");
  if (!isInRange(c2, 0.0000001, 1e6)) return fail("targetConcentration");
  if (c2 > c1) return fail("targetOutOfRange");

  if (input.mode === "solveForVolume") {
    const v1 = input.stockVolumeMl;
    if (!isInRange(v1, 0.001, 1e6)) return fail("stockVolume");
    const v2 = quotient(c1 * v1, c2);
    if (v2 === undefined) return fail("targetConcentration");
    return {
      ok: true,
      stockVolumeMl: v1,
      targetVolumeMl: v2,
      solventToAddMl: v2 - v1,
      dilutionFactor: c1 / c2,
    };
  }

  const v2 = input.targetVolumeMl;
  if (!isInRange(v2, 0.001, 1e6)) return fail("targetVolume");
  const v1 = quotient(c2 * v2, c1);
  if (v1 === undefined) return fail("stockConcentration");
  return {
    ok: true,
    stockVolumeMl: v1,
    targetVolumeMl: v2,
    solventToAddMl: v2 - v1,
    dilutionFactor: c1 / c2,
  };
}

/* -------------------------------------------------------------------------- */
/* concentration-units — jedinice koncentracije                                 */
/* -------------------------------------------------------------------------- */

export const CONCENTRATION_UNITS = [
  "molPerL",
  "millimolPerL",
  "gramPerL",
  "milligramPerMl",
  "percentWV",
  "ppm",
  "ppb",
] as const;

export type ConcentrationUnit = (typeof CONCENTRATION_UNITS)[number];

export interface ConcentrationUnitsInput {
  readonly value: number;
  readonly unit: ConcentrationUnit;
  /** g/mol — needed for the two molar units and nothing else. */
  readonly molarMassGmol?: number | undefined;
}

export interface ConcentrationUnitsResult {
  readonly molPerL: number | undefined;
  readonly millimolPerL: number | undefined;
  /** g/L, the unit every conversion passes through. */
  readonly gramPerL: number;
  readonly milligramPerMl: number;
  readonly percentWV: number;
  readonly ppm: number;
  readonly ppb: number;
}

/** g/L in one percent (w/v), one ppm and one ppb of a dilute aqueous solution. */
const GRAM_PER_L_PER_PERCENT = 10;
const GRAM_PER_L_PER_PPM = 0.001;
const GRAM_PER_L_PER_PPB = 0.000001;

/**
 * One concentration, in every unit a laboratory writes it in.
 *
 * **The basis is stated because it is a convention and not a fact.** Percent
 * here is `w/v` — grams of solute per 100 ml of solution — which is the
 * convention on a reagent label and in a recipe, and NOT the `%` by mass that
 * `solution-concentration` works in. ppm and ppb are `m/v` in a dilute aqueous
 * solution, where the density of water at room temperature makes 1 l ≈ 1 kg; in
 * a solvent whose density is not that, the ppm row is the convention and not a
 * mass fraction, and the surface says so.
 *
 * The molar rows are withheld rather than guessed when no molar mass was typed:
 * `undefined` is a missing input, not a wrong answer.
 */
export function concentrationUnits(
  input: ConcentrationUnitsInput,
): ProResult<ConcentrationUnitsResult> {
  if (!isInRange(input.value, 0, 1e9)) return fail("value");
  const molarMassValue = input.molarMassGmol;
  const molar = input.unit === "molPerL" || input.unit === "millimolPerL";
  if (molar && !isInRange(molarMassValue, 0.0001, 1e6)) return fail("molarMass");
  if (!molar && molarMassValue !== undefined && !isInRange(molarMassValue, 0.0001, 1e6)) {
    return fail("molarMass");
  }
  const m = molarMassValue ?? 0;

  let gramPerL: number;
  switch (input.unit) {
    case "molPerL":
      gramPerL = input.value * m;
      break;
    case "millimolPerL":
      gramPerL = (input.value / 1000) * m;
      break;
    case "gramPerL":
      gramPerL = input.value;
      break;
    case "milligramPerMl":
      gramPerL = input.value;
      break;
    case "percentWV":
      gramPerL = input.value * GRAM_PER_L_PER_PERCENT;
      break;
    case "ppm":
      gramPerL = input.value * GRAM_PER_L_PER_PPM;
      break;
    case "ppb":
      gramPerL = input.value * GRAM_PER_L_PER_PPB;
      break;
  }
  if (!Number.isFinite(gramPerL)) return fail("value");

  const perMole = molarMassValue === undefined ? undefined : quotient(gramPerL, molarMassValue);
  const millimolarValue = perMole === undefined ? undefined : perMole * 1000;
  return {
    ok: true,
    molPerL: perMole,
    millimolPerL: millimolarValue,
    gramPerL,
    milligramPerMl: gramPerL,
    percentWV: gramPerL / GRAM_PER_L_PER_PERCENT,
    ppm: gramPerL / GRAM_PER_L_PER_PPM,
    ppb: gramPerL / GRAM_PER_L_PER_PPB,
  };
}

/* -------------------------------------------------------------------------- */
/* strong-acid-ph — pH jake kiseline ili baze                                   */
/* -------------------------------------------------------------------------- */

/**
 * `pKw = 14,00` at 25 °C — the conventional value of the ionic product of water
 * at that temperature, which is the same convention the pH scale itself is
 * defined on (Sørensen's scale, `pH = −log₁₀ a(H⁺)`). It is not a measurement
 * this tool makes and not a property of the user's solution.
 */
const PKW_25C = 14;

export type AcidBaseMode = "acid" | "base";

export interface StrongAcidPhInput {
  readonly mode: AcidBaseMode;
  /** Analytical concentration, mol/L. */
  readonly concentrationMolL: number;
  /**
   * Ionisable groups per formula unit — 1 for HCl, 2 for H2SO4's first
   * dissociation, 2 for Ca(OH)2. A whole number from 1 to 3, entered by the user
   * because it is a fact about the substance.
   */
  readonly ionisableGroups: number;
}

export interface StrongAcidPhResult {
  readonly ionConcentration: number;
  readonly ph: number;
  readonly poh: number;
  /** `−log₁₀` of what the tool used — the arithmetic, echoed. */
  readonly pIonConcentration: number;
}

/**
 * The pH of a strong acid or base from its analytical concentration.
 *
 * `pH = −log₁₀(c·n)` for an acid and `pH = pKw − (−log₁₀(c·n))` for a base, with
 * `n` the number of ionisable groups. **Strong means fully dissociated**: this is
 * the idealisation, true for HCl and NaOH at ordinary concentrations and
 * increasingly wrong as the solution gets very dilute (where water's own
 * dissociation takes over) or very concentrated (where activities replace
 * concentrations). The surface states that rather than hiding it, and the tool
 * refuses the two ends where the idealisation stops describing anything.
 */
export function strongAcidPh(input: StrongAcidPhInput): ProResult<StrongAcidPhResult> {
  const { concentrationMolL: c, ionisableGroups: n } = input;
  if (!isInRange(c, 0.000000001, 10)) return fail("concentration");
  if (!isIntegerIn(n, 1, 3)) return fail("ionisableGroups");
  const ionConcentration = c * n;
  const pIon = -Math.log10(ionConcentration);
  if (!Number.isFinite(pIon)) return fail("concentration");
  const ph = input.mode === "acid" ? pIon : PKW_25C - pIon;
  return { ok: true, ionConcentration, ph, poh: PKW_25C - ph, pIonConcentration: pIon };
}

/* -------------------------------------------------------------------------- */
/* buffer-ph — Henderson–Hasselbalch                                            */
/* -------------------------------------------------------------------------- */

export type BufferMode = "phFromRatio" | "ratioForPh";

export interface BufferInput {
  readonly mode: BufferMode;
  /** The acid's pKa, as the user's own table gives it. Never guessed here. */
  readonly pka: number;
  /** Analytical concentration of the acid form, mol/L — `phFromRatio` only. */
  readonly acidConcentration?: number | undefined;
  /** Analytical concentration of the base form, mol/L — `phFromRatio` only. */
  readonly baseConcentration?: number | undefined;
  /** The pH wanted — `ratioForPh` only. */
  readonly targetPh?: number | undefined;
}

export interface BufferResult {
  readonly ph: number | undefined;
  /** `[A⁻]/[HA]` — what came in, or what is needed for `targetPh`. */
  readonly ratio: number | undefined;
  readonly logRatio: number | undefined;
}

/**
 * Henderson–Hasselbalch: `pH = pKa + log₁₀([A⁻]/[HA])`.
 *
 * pKa is an INPUT and has no default, because it is a property of the acid the
 * user chose and this file has no table of them — a pKa quoted to two decimals is
 * a figure out of a handbook, and inventing one for a `life-safety` tool would be
 * the same defect as inventing a limit. In `ratioForPh` the equation is solved
 * the other way, `[A⁻]/[HA] = 10^(pH − pKa)`, which is how a buffer is designed
 * once the pH is the requirement.
 *
 * Both modes return the RATIO, because a ratio is what a preparation sheet can
 * act on; the concentration rows belong to the user's own stock.
 */
export function bufferPh(input: BufferInput): ProResult<BufferResult> {
  if (!isInRange(input.pka, -10, 30)) return fail("pka");
  if (input.mode === "phFromRatio") {
    const acid = input.acidConcentration;
    const base = input.baseConcentration;
    if (!isPositive(acid)) return fail("acidConcentration");
    if (!isPositive(base)) return fail("baseConcentration");
    const logRatio = Math.log10(base / acid);
    if (!Number.isFinite(logRatio)) return fail("acidConcentration");
    return { ok: true, ph: input.pka + logRatio, ratio: base / acid, logRatio };
  }
  const target = input.targetPh;
  if (!isInRange(target, 0, 14)) return fail("targetPh");
  const logRatio = target - input.pka;
  const ratio = 10 ** logRatio;
  if (!Number.isFinite(ratio) || ratio <= 0) return fail("targetPh");
  return { ok: true, ph: target, ratio, logRatio };
}
