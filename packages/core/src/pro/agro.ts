/**
 * „Agro" — the arithmetic behind the agronomy toolkit's tools.
 *
 * Same discipline as `pro/gradnja.ts`: pure functions, refuse rather than
 * repair, no user-facing text, and a `life-safety`/`food-safety` tool never
 * returns a verdict — only the quantity and, where the user typed a limit of
 * their own, the plain ratio against it (`ratioAgainst`). Constants embedded
 * here are `physical` tier (derived arithmetic or a material property) or
 * `published` tier with a named, dated source; anything the label, the
 * contract or the buyer decides is an INPUT with no default, per
 * `TOOL_CONSTANT_TIERS`.
 */

import {
  ceilSnapped,
  fail,
  floorSnapped,
  isInRange,
  isIntegerIn,
  isKeyOf,
  isNonNegative,
  isPositive,
  ratioAgainst,
  roundHalfUp,
  type ProResult,
} from "./result.js";

/**
 * `hours` split into whole hours and rounded minutes, with the 60-minute
 * carry done. `Math.round((t − h) × 60)` alone can print „6 h 60 min" at the
 * boundary; this is the one place that carry happens; every caller below uses it.
 */
function hoursAndMinutes(hours: number): { readonly h: number; readonly min: number } {
  const h0 = Math.floor(hours);
  let min = Math.round((hours - h0) * 60);
  let h = h0;
  if (min === 60) {
    min = 0;
    h += 1;
  }
  return { h, min };
}

/**
 * `value·(100 − from)/(100 − to)` — the dry-matter-balance identity shared by
 * every tool in this pack that moves a mass or a yield from one moisture
 * reading to another (grain shrink, honey drying, yield-sample reference
 * moisture). Written once so the `to = 100` refusal is written once.
 */
function moistureAdjust(value: number, fromMoisture: number, toMoisture: number): number | undefined {
  if (toMoisture >= 100) return undefined;
  return (value * (100 - fromMoisture)) / (100 - toMoisture);
}

const HECTARE_M2 = 10000;

/** floor(widthAvailable/rowSpacing) + 1 — the „how many rows fit across an
 * available width" arithmetic shared by orchard-trellis-layout and
 * plant-spacing-density, written once so the two never drift apart. */
function rowsAcrossWidth(widthAvailableM: number, rowSpacingM: number): number {
  return floorSnapped(widthAvailableM / rowSpacingM) + 1;
}

/* ---------------------------------------------------------------------------
 * bale-count-storage — „Bale i skladište"
 * ------------------------------------------------------------------------ */

export type BaleShape = "round" | "square";
export type BaleMassMode = "measured" | "density";
export type RoundBaleOrientation = "onEnd" | "onSide";
export type BaleQuantityMode = "yieldPerArea" | "totalMass";

export interface RoundBaleDimensions {
  readonly diameterM: number;
  readonly widthM: number;
}

export interface SquareBaleDimensions {
  readonly lengthM: number;
  readonly widthM: number;
  readonly heightM: number;
}

export interface BaleStorageDimensions {
  readonly lengthM: number;
  readonly widthM: number;
  readonly usableHeightM: number;
}

export interface BaleCountInput {
  readonly shape: BaleShape;
  readonly round?: RoundBaleDimensions | undefined;
  readonly square?: SquareBaleDimensions | undefined;
  readonly massMode: BaleMassMode;
  /** kg — required when `massMode` is `"measured"`. */
  readonly measuredMassKg?: number | undefined;
  /** kg/m³, 30–400 — required when `massMode` is `"density"`. */
  readonly densityKgM3?: number | undefined;
  readonly quantityMode: BaleQuantityMode;
  /** t/ha — required when `quantityMode` is `"yieldPerArea"`. */
  readonly yieldTHa?: number | undefined;
  /** t — required when `quantityMode` is `"totalMass"`. */
  readonly totalMassT?: number | undefined;
  /** ha — optional even in `"yieldPerArea"` mode is disallowed there; see `baleCountStorage`. */
  readonly areaHa?: number | undefined;
  readonly balingLossPercent: number;
  readonly storage?: BaleStorageDimensions | undefined;
  readonly roundOrientation: RoundBaleOrientation;
}

export interface BaleFootprintFit {
  readonly perRow: number;
  readonly perColumn: number;
  readonly perLayer: number;
  readonly layers: number;
  readonly capacity: number;
  /** capacity × the resolved bale mass, in TONNES — the bale mass is always
   * resolved before storage is computed, so this is never a placeholder 0. */
  readonly capacityTonnes: number;
  /** L_sk − perRow·rowDimension, m — the strip nothing else fits into. */
  readonly unusedLengthM: number;
  readonly unusedWidthM: number;
  /** Which square-bale orientation this is, for the square-bale branch only. */
  readonly orientation: "footprint" | "onLengthFace" | "onWidthFace" | "onEnd" | "onSide" | undefined;
}

export interface BaleCountResult {
  readonly baleVolumeM3: number;
  readonly baleMassKg: number;
  readonly totalMassAfterLossT: number;
  readonly countExact: number;
  readonly countCeil: number;
  readonly totalVolumeM3: number;
  /** Undefined when `areaHa` was not given — never divided by zero. */
  readonly balesPerHa: number | undefined;
  readonly storage: BaleFootprintFit | undefined;
  /** countCeil − storage.capacity — negative means the store has spare room. */
  readonly shortfall: number | undefined;
}

/**
 * Bale count, volume and store capacity from cut yield, measured or
 * calculated bale mass, and the store's own footprint.
 *
 * **The count used for bales/ha is the EXACT, un-ceiled one.** Ceiling the
 * count first and then dividing by area inflates the density by up to almost
 * one whole bale per hectare — the review's own example. The store's capacity
 * is a separate, purely geometric question this tool does not judge for
 * stability, floor load or stacking height.
 */
export function baleCountStorage(input: BaleCountInput): ProResult<BaleCountResult> {
  let volume: number;
  if (input.shape === "round") {
    const r = input.round;
    if (r === undefined) return fail("round");
    if (!isInRange(r.diameterM, 0.5, 2.5)) return fail("diameterM");
    if (!isInRange(r.widthM, 0.5, 2.5)) return fail("widthM");
    volume = Math.PI * (r.diameterM / 2) ** 2 * r.widthM;
  } else {
    const s = input.square;
    if (s === undefined) return fail("square");
    if (!isInRange(s.lengthM, 0.3, 3)) return fail("lengthM");
    if (!isInRange(s.widthM, 0.3, 3)) return fail("widthM");
    if (!isInRange(s.heightM, 0.3, 3)) return fail("heightM");
    volume = s.lengthM * s.widthM * s.heightM;
  }

  let baleMass: number;
  if (input.massMode === "measured") {
    if (!isPositive(input.measuredMassKg)) return fail("measuredMassKg");
    baleMass = input.measuredMassKg;
  } else {
    if (!input.densityKgM3 || !isInRange(input.densityKgM3, 30, 400)) return fail("densityKgM3");
    baleMass = volume * input.densityKgM3;
  }
  if (baleMass <= 0) return fail("baleMassKg");

  if (!isInRange(input.balingLossPercent, 0, 30)) return fail("balingLossPercent");
  // areaHa is REQUIRED in "yieldPerArea" mode (checked below) but only
  // optional in "totalMass" mode, where it drives balesPerHa alone. A typed 0
  // there must be refused explicitly — not silently treated the same as an
  // empty field, which would just omit balesPerHa from the result.
  if (input.areaHa !== undefined && !isPositive(input.areaHa)) return fail("areaHa");

  let totalMassT: number;
  if (input.quantityMode === "yieldPerArea") {
    if (!isPositive(input.yieldTHa)) return fail("yieldTHa");
    if (!isPositive(input.areaHa)) return fail("areaHa");
    totalMassT = input.yieldTHa * input.areaHa * (1 - input.balingLossPercent / 100);
  } else {
    if (!isPositive(input.totalMassT)) return fail("totalMassT");
    totalMassT = input.totalMassT * (1 - input.balingLossPercent / 100);
  }

  const countExact = (totalMassT * 1000) / baleMass;
  const countCeil = Math.ceil(countExact);
  const totalVolumeM3 = countCeil * volume;
  const balesPerHa = isPositive(input.areaHa) ? countExact / input.areaHa : undefined;

  let storage: BaleFootprintFit | undefined;
  if (input.storage !== undefined) {
    const { lengthM: lSk, widthM: wSk, usableHeightM: h } = input.storage;
    if (!isPositive(lSk)) return fail("storageLengthM");
    if (!isPositive(wSk)) return fail("storageWidthM");
    if (!isPositive(h)) return fail("usableHeightM");

    const fit = (rowDim: number, colDim: number, heightDim: number): BaleFootprintFit => {
      const perRowA = floorSnapped(lSk / rowDim);
      const perColA = floorSnapped(wSk / colDim);
      const perRowB = floorSnapped(lSk / colDim);
      const perColB = floorSnapped(wSk / rowDim);
      const useB = perRowB * perColB > perRowA * perColA;
      const perRow = useB ? perRowB : perRowA;
      const perCol = useB ? perColB : perColA;
      const usedRowDim = useB ? colDim : rowDim;
      const usedColDim = useB ? rowDim : colDim;
      const perLayer = perRow * perCol;
      const layers = floorSnapped(h / heightDim);
      const capacity = perLayer * layers;
      return {
        perRow,
        perColumn: perCol,
        perLayer,
        layers,
        capacity,
        capacityTonnes: (capacity * baleMass) / 1000,
        unusedLengthM: lSk - perRow * usedRowDim,
        unusedWidthM: wSk - perCol * usedColDim,
        orientation: undefined,
      };
    };

    if (input.shape === "round") {
      const r = input.round;
      if (r === undefined) return fail("round");
      storage =
        input.roundOrientation === "onEnd"
          ? { ...fit(r.diameterM, r.diameterM, r.widthM), orientation: "onEnd" }
          : { ...fit(r.widthM, r.diameterM, r.diameterM), orientation: "onSide" };
    } else {
      const s = input.square;
      if (s === undefined) return fail("square");
      const options: readonly [BaleFootprintFit, "footprint" | "onLengthFace" | "onWidthFace"][] = [
        [fit(s.lengthM, s.widthM, s.heightM), "footprint"],
        [fit(s.lengthM, s.heightM, s.widthM), "onLengthFace"],
        [fit(s.widthM, s.heightM, s.lengthM), "onWidthFace"],
      ];
      let best = options[0];
      for (const option of options) {
        if (best === undefined || option[0].capacity > best[0].capacity) best = option;
      }
      if (best === undefined) return fail("square");
      storage = { ...best[0], orientation: best[1] };
    }
  }

  return {
    ok: true,
    baleVolumeM3: volume,
    baleMassKg: baleMass,
    totalMassAfterLossT: totalMassT,
    countExact,
    countCeil,
    totalVolumeM3,
    balesPerHa,
    storage,
    shortfall: storage === undefined ? undefined : countCeil - storage.capacity,
  };
}

/* ---------------------------------------------------------------------------
 * bee-syrup-mix — „Sirup za pčele"
 * ------------------------------------------------------------------------ */

/** Apparent volume of dissolved sucrose in a ~20 °C solution, L/kg — NOT its
 * crystal volume (1/1.5879 = 0.6298 L/kg). A density computed with it is
 * estimated, never measured, which is why `densityIsEstimated` always reads true. */
const SUGAR_APPARENT_VOLUME_L_PER_KG = 0.63;

export type SyrupGiven = "targetVolume" | "targetMass" | "availableSugar";

export interface BeeSyrupInput {
  /** a:b by mass — 1 kg sugar to 1 L water is the same ratio, since 1 L water = 1 kg. */
  readonly ratioA: number;
  readonly ratioB: number;
  readonly given: SyrupGiven;
  /** L for `targetVolume`, kg for `targetMass` or `availableSugar`. */
  readonly value: number;
  readonly hiveCount?: number | undefined;
  readonly literPerHive?: number | undefined;
  readonly bagMassKg: number;
}

export interface BeeSyrupResult {
  readonly sugarKg: number;
  readonly waterVolumeL: number;
  readonly waterMassKg: number;
  readonly syrupMassKg: number;
  readonly syrupVolumeL: number;
  readonly densityKgL: number;
  readonly densityIsEstimated: true;
  readonly concentrationPercent: number;
  readonly bagsExact: number;
  readonly bagsCeil: number;
  /** floor(syrupVolumeL / literPerHive) — undefined without `literPerHive`. */
  readonly hivesCovered: number | undefined;
  readonly hivesRemainderL: number | undefined;
  /** hiveCount × literPerHive routed back through the `targetVolume` path. */
  readonly apiary: { readonly volumeL: number; readonly sugarKg: number; readonly bagsCeil: number } | undefined;
}

/**
 * Sugar, water and derived density for a syrup ratio, from whichever of
 * volume, mass or sugar the beekeeper actually measured.
 *
 * **The 0.63 L/kg factor is why volume ≠ water + sugar's own dry volume**:
 * dissolved sucrose does not carry its crystal volume into solution, so a
 * naive `waterVolume + sugarMass/crystalDensity` overstates the syrup made.
 * The derived density is always labelled estimated, never a measurement.
 */
export function beeSyrupMix(input: BeeSyrupInput): ProResult<BeeSyrupResult> {
  if (!isPositive(input.ratioA)) return fail("ratioA");
  if (!isPositive(input.ratioB)) return fail("ratioB");
  const r = input.ratioA / input.ratioB;
  if (!isPositive(input.value)) return fail("value");
  if (!isPositive(input.bagMassKg)) return fail("bagMassKg");
  // Both optional, both divisors below (literPerHive) or a multiplicand that
  // gates the whole apiary block (hiveCount) — a typed 0 must be refused, not
  // silently treated the same as an empty field that just omits the block.
  if (input.hiveCount !== undefined && !isPositive(input.hiveCount)) return fail("hiveCount");
  if (input.literPerHive !== undefined && !isPositive(input.literPerHive)) return fail("literPerHive");

  const fromVolume = (volumeL: number): { readonly sugar: number; readonly water: number } => {
    const water = volumeL / (1 + SUGAR_APPARENT_VOLUME_L_PER_KG * r);
    return { sugar: r * water, water };
  };

  let sugarKg: number;
  let waterVolumeL: number;
  if (input.given === "targetVolume") {
    const { sugar, water } = fromVolume(input.value);
    sugarKg = sugar;
    waterVolumeL = water;
  } else if (input.given === "targetMass") {
    waterVolumeL = input.value / (1 + r);
    sugarKg = r * waterVolumeL;
  } else {
    sugarKg = input.value;
    waterVolumeL = input.value / r;
  }

  const syrupMassKg = sugarKg + waterVolumeL;
  const syrupVolumeL = waterVolumeL + SUGAR_APPARENT_VOLUME_L_PER_KG * sugarKg;
  const bagsExact = sugarKg / input.bagMassKg;

  let hivesCovered: number | undefined;
  let hivesRemainderL: number | undefined;
  if (isPositive(input.literPerHive)) {
    // floorSnapped: syrupVolumeL is built from two divisions and a
    // multiplication, so an exact multiple of literPerHive frequently lands
    // one ULP below the whole number and a bare floor would silently drop an
    // entire hive's dose.
    hivesCovered = floorSnapped(syrupVolumeL / input.literPerHive);
    hivesRemainderL = syrupVolumeL - hivesCovered * input.literPerHive;
  }

  let apiary: BeeSyrupResult["apiary"];
  if (isPositive(input.hiveCount) && isPositive(input.literPerHive)) {
    const totalVolumeL = input.hiveCount * input.literPerHive;
    const { sugar } = fromVolume(totalVolumeL);
    apiary = { volumeL: totalVolumeL, sugarKg: sugar, bagsCeil: Math.ceil(sugar / input.bagMassKg) };
  }

  return {
    ok: true,
    sugarKg,
    waterVolumeL,
    waterMassKg: waterVolumeL,
    syrupMassKg,
    syrupVolumeL,
    densityKgL: syrupMassKg / syrupVolumeL,
    densityIsEstimated: true,
    concentrationPercent: (sugarKg / syrupMassKg) * 100,
    bagsExact,
    bagsCeil: Math.ceil(bagsExact),
    hivesCovered,
    hivesRemainderL,
    apiary,
  };
}

/* ---------------------------------------------------------------------------
 * cadastral-area-units — „Katastarske mere"
 * ------------------------------------------------------------------------ */

const AR_M2 = 100;
/** Exact square of the 1.896484 m Viennese Klafter fixed by the 1871 Austrian metrication. */
const HVAT2_M2 = 3.596651562256;
/** 1600 kvadratnih hvati by the same metrication — the default only; a real
 * cadastral sheet may carry a different local jutro, so `jutroM2Used` echoes it. */
const DEFAULT_JUTRO_M2 = 5754.6424996096;

export type CadastralUnit = "m2" | "ar" | "ha" | "hvat2" | "jutro";

export interface CadastralConvertInput {
  readonly value: number;
  readonly fromUnit: CadastralUnit;
  /** Overrides `DEFAULT_JUTRO_M2` for a sheet using a different local jutro. */
  readonly jutroM2Override?: number | undefined;
}

export interface CadastralConvertResult {
  readonly m2: number;
  readonly ar: number;
  readonly ha: number;
  readonly hvat2: number;
  readonly jutro: number;
  readonly jutroM2Used: number;
}

/**
 * A land area in all five units at once — m², ar, ha, kvadratni hvat and
 * katastarsko jutro — from any one of them.
 *
 * **Always via the m² base, never jutro → hvat directly**: two divisions
 * chained in one expression double up rounding error in a way that going
 * through the base and back out does not. The jutro figure is a PUBLISHED
 * constant that older land-registry sheets may still use a locally different
 * value for, so it can be overridden and the value actually used is echoed.
 */
export function cadastralAreaUnits(input: CadastralConvertInput): ProResult<CadastralConvertResult> {
  if (!Number.isFinite(input.value) || input.value < 0) return fail("value");
  if (input.jutroM2Override !== undefined && !isPositive(input.jutroM2Override)) {
    return fail("jutroM2Override");
  }
  const jutroM2 = input.jutroM2Override ?? DEFAULT_JUTRO_M2;

  let m2: number;
  switch (input.fromUnit) {
    case "m2":
      m2 = input.value;
      break;
    case "ar":
      m2 = input.value * AR_M2;
      break;
    case "ha":
      m2 = input.value * HECTARE_M2;
      break;
    case "hvat2":
      m2 = input.value * HVAT2_M2;
      break;
    default:
      m2 = input.value * jutroM2;
      break;
  }
  // The ceiling is stated in m² — checked on the CONVERTED base, not on the
  // raw entered number, so a huge value in a small unit (e.g. 1e12 jutro)
  // cannot slip through three orders of magnitude past the stated limit.
  if (m2 > 1e12) return fail("value");

  return {
    ok: true,
    m2: roundHalfUp(m2, 2),
    ar: roundHalfUp(m2 / AR_M2, 4),
    ha: roundHalfUp(m2 / HECTARE_M2, 6),
    hvat2: roundHalfUp(m2 / HVAT2_M2, 3),
    jutro: roundHalfUp(m2 / jutroM2, 6),
    jutroM2Used: jutroM2,
  };
}

/* ---------------------------------------------------------------------------
 * fertiliser-nutrient-blend — „Preračun đubriva"
 * ------------------------------------------------------------------------ */

/** 2·M(P)/M(P₂O₅) = 61.947524/141.942524, from standard atomic masses. */
const P2O5_TO_P = 0.436427;
/** 2·M(K)/M(K₂O) = 78.1966/94.1956, from standard atomic masses. */
const K2O_TO_K = 0.830151;
const P_TO_P2O5 = 2.291335;
const K_TO_K2O = 1.204600;

export type LeadNutrient = "N" | "P2O5" | "K2O";

export interface FertiliserComposition {
  readonly nPercent: number;
  readonly p2o5Percent: number;
  readonly k2oPercent: number;
}

export interface FertiliserForwardInput {
  readonly direction: "nutrientsToFertiliser";
  /** Whether targetP/targetK below are entered as oxide or as bare element. */
  readonly targetForm: "oxide" | "element";
  readonly targetN: number;
  readonly targetP: number;
  readonly targetK: number;
  readonly primary: FertiliserComposition;
  readonly primaryLead: LeadNutrient;
  readonly secondary?: FertiliserComposition | undefined;
  readonly secondaryLead?: LeadNutrient | undefined;
  readonly areaHa: number;
  readonly bagMassKg: number;
}

export interface FertiliserReverseInput {
  readonly direction: "fertiliserToNutrients";
  readonly composition: FertiliserComposition;
  readonly doseKgHa: number;
  readonly areaHa: number;
  readonly bagMassKg: number;
}

export type FertiliserBlendInput = FertiliserForwardInput | FertiliserReverseInput;

export interface FertiliserDoseLine {
  readonly lead: LeadNutrient | undefined;
  readonly doseKgHa: number;
  readonly totalKg: number;
  readonly bagsExact: number;
  readonly bagsCeil: number;
  /** ceil(bags)·bagMass/area — the dose actually applied once bags are whole. */
  readonly actualDoseKgHa: number;
  readonly deliveredNKgHa: number;
  readonly deliveredP2o5KgHa: number;
  readonly deliveredK2oKgHa: number;
}

export interface FertiliserBlendResult {
  readonly lines: readonly FertiliserDoseLine[];
  readonly deliveredNKgHa: number;
  readonly deliveredP2o5KgHa: number;
  readonly deliveredK2oKgHa: number;
  readonly deliveredPElementKgHa: number;
  readonly deliveredKElementKgHa: number;
  readonly totalDeliveredNKg: number;
  readonly totalDeliveredP2o5Kg: number;
  readonly totalDeliveredK2oKg: number;
  readonly targetNKgHa: number | undefined;
  readonly targetP2o5KgHa: number | undefined;
  readonly targetK2oKgHa: number | undefined;
  readonly targetPElementKgHa: number | undefined;
  readonly targetKElementKgHa: number | undefined;
  /** „cilj − isporučeno", kg/ha — positive means below target, never called a verdict. */
  readonly targetMinusDeliveredN: number | undefined;
  readonly targetMinusDeliveredP2o5: number | undefined;
  readonly targetMinusDeliveredK2o: number | undefined;
}

function compositionPercent(c: FertiliserComposition, lead: LeadNutrient): number {
  return lead === "N" ? c.nPercent : lead === "P2O5" ? c.p2o5Percent : c.k2oPercent;
}

function validComposition(c: FertiliserComposition): boolean {
  return (
    isInRange(c.nPercent, 0, 100) &&
    isInRange(c.p2o5Percent, 0, 100) &&
    isInRange(c.k2oPercent, 0, 100) &&
    c.nPercent + c.p2o5Percent + c.k2oPercent <= 100 + 1e-9
  );
}

function doseLine(dose: number, lead: LeadNutrient | undefined, c: FertiliserComposition, area: number, bagMass: number): FertiliserDoseLine {
  const totalKg = dose * area;
  const bagsExact = totalKg / bagMass;
  const bagsCeil = Math.ceil(bagsExact);
  return {
    lead,
    doseKgHa: dose,
    totalKg,
    bagsExact,
    bagsCeil,
    actualDoseKgHa: (bagsCeil * bagMass) / area,
    deliveredNKgHa: (dose * c.nPercent) / 100,
    deliveredP2o5KgHa: (dose * c.p2o5Percent) / 100,
    deliveredK2oKgHa: (dose * c.k2oPercent) / 100,
  };
}

/**
 * Fertiliser dose from a nutrient target, or nutrients delivered from an
 * entered dose — never both computed from the same number.
 *
 * **A target entered as element (P, K) has to be converted to oxide (P₂O₅,
 * K₂O) before anything else runs**, because the composition percentages on
 * every bag are oxide — mixing the two forms is off by the 2.29× / 1.20×
 * conversion factor, silently. A secondary fertiliser whose lead nutrient is
 * already covered gets a dose of exactly zero, never a negative one.
 */
export function fertiliserNutrientBlend(input: FertiliserBlendInput): ProResult<FertiliserBlendResult> {
  if (!isPositive(input.areaHa)) return fail("areaHa");
  if (!isPositive(input.bagMassKg)) return fail("bagMassKg");

  if (input.direction === "fertiliserToNutrients") {
    if (!validComposition(input.composition)) return fail("composition");
    if (!isPositive(input.doseKgHa)) return fail("doseKgHa");
    const line = doseLine(input.doseKgHa, undefined, input.composition, input.areaHa, input.bagMassKg);
    return {
      ok: true,
      lines: [line],
      deliveredNKgHa: line.deliveredNKgHa,
      deliveredP2o5KgHa: line.deliveredP2o5KgHa,
      deliveredK2oKgHa: line.deliveredK2oKgHa,
      deliveredPElementKgHa: line.deliveredP2o5KgHa * P2O5_TO_P,
      deliveredKElementKgHa: line.deliveredK2oKgHa * K2O_TO_K,
      totalDeliveredNKg: line.deliveredNKgHa * input.areaHa,
      totalDeliveredP2o5Kg: line.deliveredP2o5KgHa * input.areaHa,
      totalDeliveredK2oKg: line.deliveredK2oKgHa * input.areaHa,
      targetNKgHa: undefined,
      targetP2o5KgHa: undefined,
      targetK2oKgHa: undefined,
      targetPElementKgHa: undefined,
      targetKElementKgHa: undefined,
      targetMinusDeliveredN: undefined,
      targetMinusDeliveredP2o5: undefined,
      targetMinusDeliveredK2o: undefined,
    };
  }

  if (!isInRange(input.targetN, 0, 500)) return fail("targetN");
  if (!isInRange(input.targetP, 0, 500)) return fail("targetP");
  if (!isInRange(input.targetK, 0, 500)) return fail("targetK");
  if (!validComposition(input.primary)) return fail("primary");
  if (input.secondary !== undefined && !validComposition(input.secondary)) return fail("secondary");

  const targetP2o5 = input.targetForm === "element" ? input.targetP * P_TO_P2O5 : input.targetP;
  const targetK2o = input.targetForm === "element" ? input.targetK * K_TO_K2O : input.targetK;
  const targetOf = (lead: LeadNutrient): number => (lead === "N" ? input.targetN : lead === "P2O5" ? targetP2o5 : targetK2o);

  const primaryPct = compositionPercent(input.primary, input.primaryLead);
  if (primaryPct <= 0) return fail("primaryLead");
  const dose1 = (100 * targetOf(input.primaryLead)) / primaryPct;
  const line1 = doseLine(dose1, input.primaryLead, input.primary, input.areaHa, input.bagMassKg);

  const lines: FertiliserDoseLine[] = [line1];
  if (input.secondary !== undefined && input.secondaryLead !== undefined) {
    const deliveredSoFar =
      input.secondaryLead === "N"
        ? line1.deliveredNKgHa
        : input.secondaryLead === "P2O5"
          ? line1.deliveredP2o5KgHa
          : line1.deliveredK2oKgHa;
    const deficit = targetOf(input.secondaryLead) - deliveredSoFar;
    const secondaryPct = compositionPercent(input.secondary, input.secondaryLead);
    if (deficit <= 0 || secondaryPct <= 0) {
      lines.push(doseLine(0, input.secondaryLead, input.secondary, input.areaHa, input.bagMassKg));
    } else {
      const dose2 = (100 * deficit) / secondaryPct;
      lines.push(doseLine(dose2, input.secondaryLead, input.secondary, input.areaHa, input.bagMassKg));
    }
  }

  const deliveredNKgHa = lines.reduce((s, l) => s + l.deliveredNKgHa, 0);
  const deliveredP2o5KgHa = lines.reduce((s, l) => s + l.deliveredP2o5KgHa, 0);
  const deliveredK2oKgHa = lines.reduce((s, l) => s + l.deliveredK2oKgHa, 0);

  return {
    ok: true,
    lines,
    deliveredNKgHa,
    deliveredP2o5KgHa,
    deliveredK2oKgHa,
    deliveredPElementKgHa: deliveredP2o5KgHa * P2O5_TO_P,
    deliveredKElementKgHa: deliveredK2oKgHa * K2O_TO_K,
    totalDeliveredNKg: deliveredNKgHa * input.areaHa,
    totalDeliveredP2o5Kg: deliveredP2o5KgHa * input.areaHa,
    totalDeliveredK2oKg: deliveredK2oKgHa * input.areaHa,
    targetNKgHa: input.targetN,
    targetP2o5KgHa: targetP2o5,
    targetK2oKgHa: targetK2o,
    targetPElementKgHa: targetP2o5 * P2O5_TO_P,
    targetKElementKgHa: targetK2o * K2O_TO_K,
    targetMinusDeliveredN: input.targetN - deliveredNKgHa,
    targetMinusDeliveredP2o5: targetP2o5 - deliveredP2o5KgHa,
    targetMinusDeliveredK2o: targetK2o - deliveredK2oKgHa,
  };
}

/* ---------------------------------------------------------------------------
 * grain-moisture-shrink — „Kalo sušenja zrna"
 * ------------------------------------------------------------------------ */

/** Latent heat of vaporisation of water near 100 °C, kJ/kg — theoretical minimum only. */
const WATER_VAPORISATION_KJ_PER_KG = 2257;

export type DeductionOrder = "impuritiesFirst" | "moistureFirst";
export type DeductionMode = "excessOnly" | "twoSided";

export interface GrainShrinkInput {
  readonly grossMassKg: number;
  readonly measuredMoisturePercent: number;
  readonly targetMoisturePercent: number;
  readonly impuritiesPercent: number;
  /** From the buyer's contract — never embedded, never defaulted. */
  readonly impuritiesFreeLimitPercent: number;
  readonly order: DeductionOrder;
  /** `"excessOnly"`: nothing is deducted below the free limit. `"twoSided"`:
   * a delivery cleaner than the limit gets a negative deduction (a credit). */
  readonly deductionMode: DeductionMode;
  readonly pricePerKg?: number | undefined;
  readonly dryerEfficiencyPercent?: number | undefined;
}

export interface DeductionBranch {
  readonly impurityDeductionKg: number;
  readonly finalMassKg: number;
  /** Water removed by DRYING alone, under this branch's own mass path —
   * `impuritiesFirst` dries the already-cleaned mass, `moistureFirst` dries
   * the full gross mass. NOT the same number in general; see `grainMoistureShrink`. */
  readonly waterOutKg: number;
}

export interface GrainShrinkResult {
  readonly driedMassKg: number;
  readonly waterOutKg: number;
  readonly shrinkPercent: number;
  /** Same value, derived without needing the mass — NOT an independent check. */
  readonly shrinkPercentMassIndependent: number;
  readonly impuritiesFirst: DeductionBranch;
  readonly moistureFirst: DeductionBranch;
  readonly selected: DeductionOrder;
  readonly grossValue: number | undefined;
  readonly netValue: number | undefined;
  readonly valueDifference: number | undefined;
  readonly minimumEnergyMJ: number | undefined;
  readonly minimumEnergyKWh: number | undefined;
  readonly actualEnergyMJ: number | undefined;
  readonly actualEnergyKWh: number | undefined;
}

/**
 * Post-drying mass, shrink percentage and the two impurity-deduction orders
 * for a grain delivery — from the dry-matter balance alone.
 *
 * **This is a physical model of water loss only**: it assumes nothing else
 * leaves with the water (no dry-matter or handling loss), which is exactly
 * the gap a weighbridge reconciliation argues about.
 *
 * **Both deductions are struck off the AS-RECEIVED (gross) mass, per real
 * buy-in-contract practice — never off whichever mass happens to be current
 * at that step.** If the impurity kg were instead computed as a percentage of
 * the mass at hand (gross for `impuritiesFirst`, already-dried for
 * `moistureFirst`), the two orders would be algebraically IDENTICAL — both
 * reduce to `m1·k·(1−x)` — because a percentage-of-current-mass deduction
 * commutes with the moisture-ratio multiplication. Order only starts to
 * matter, and the input genuinely earns its place, once the impurity kg is
 * fixed independently of when in the sequence it is subtracted: `finalMass =
 * (m1 − deduction)·k` when impurities come off before drying, versus `m1·k −
 * deduction` when they come off after — the drying factor `k` scales the
 * deduction's effect in the first case and leaves it undiminished in the
 * second.
 *
 * **`driedMassKg`/`waterOutKg` at the top level are the MOISTURE-ONLY
 * baseline — the gross mass adjusted for moisture alone, with no impurities
 * involved at all — and stay that way regardless of `order`, exactly like
 * `shrinkPercentMassIndependent`.** They are not what a dryer actually saw
 * once impurities entered the picture. The water actually removed by DRYING
 * under the SELECTED order is `impuritiesFirst`/`moistureFirst`'s own
 * `waterOutKg`, and `minimumEnergyMJ`/`actualEnergyMJ` are drawn from that
 * per-order figure, never from the top-level baseline.
 */
export function grainMoistureShrink(input: GrainShrinkInput): ProResult<GrainShrinkResult> {
  if (!isPositive(input.grossMassKg)) return fail("grossMassKg");
  if (!isInRange(input.measuredMoisturePercent, 0, 60)) return fail("measuredMoisturePercent");
  if (!isInRange(input.targetMoisturePercent, 0, 60)) return fail("targetMoisturePercent");
  if (!isInRange(input.impuritiesPercent, 0, 50)) return fail("impuritiesPercent");
  if (!isInRange(input.impuritiesFreeLimitPercent, 0, 50)) return fail("impuritiesFreeLimitPercent");
  if (input.pricePerKg !== undefined && !isNonNegative(input.pricePerKg)) return fail("pricePerKg");
  if (input.dryerEfficiencyPercent !== undefined && !isInRange(input.dryerEfficiencyPercent, 1, 100)) {
    return fail("dryerEfficiencyPercent");
  }

  const m1 = input.grossMassKg;
  const w1 = input.measuredMoisturePercent;
  const w2 = input.targetMoisturePercent;
  const driedMassKg = moistureAdjust(m1, w1, w2);
  if (driedMassKg === undefined) return fail("targetMoisturePercent");
  const waterOutKg = m1 - driedMassKg;

  const excess = input.impuritiesPercent - input.impuritiesFreeLimitPercent;
  // Always a percentage of the GROSS mass — see the doc comment above for why
  // computing it against whichever mass is current at that step would make
  // the two orders numerically identical and the `order` input meaningless.
  const grossDeduction = ((input.deductionMode === "excessOnly" ? Math.max(0, excess) : excess) * m1) / 100;

  const impuritiesFirstDried = moistureAdjust(m1 - grossDeduction, w1, w2);
  if (impuritiesFirstDried === undefined) return fail("targetMoisturePercent");
  // impuritiesFirst dries the ALREADY-CLEANED mass (m1 - grossDeduction), so
  // the water removed by drying under this order is measured from that mass,
  // not from the gross one.
  const impuritiesFirstWaterOutKg = m1 - grossDeduction - impuritiesFirstDried;

  const driedFull = moistureAdjust(m1, w1, w2);
  if (driedFull === undefined) return fail("targetMoisturePercent");
  const moistureFirstFinal = driedFull - grossDeduction;
  // moistureFirst dries the FULL gross mass before impurities ever come off,
  // so its water-out is exactly the top-level (moisture-only) waterOutKg.
  const moistureFirstWaterOutKg = waterOutKg;

  const branches: Record<DeductionOrder, DeductionBranch> = {
    impuritiesFirst: {
      impurityDeductionKg: grossDeduction,
      finalMassKg: impuritiesFirstDried,
      waterOutKg: impuritiesFirstWaterOutKg,
    },
    moistureFirst: {
      impurityDeductionKg: grossDeduction,
      finalMassKg: moistureFirstFinal,
      waterOutKg: moistureFirstWaterOutKg,
    },
  };
  // `branches` is a `Record<DeductionOrder, …>` indexed by a `DeductionOrder`,
  // which TypeScript believes is always present — so the `.finalMassKg` below is
  // a thrown TypeError for any other string rather than a refusal.
  if (!isKeyOf(input.order, branches)) return fail("order");
  const selected = branches[input.order];
  const selectedFinal = selected.finalMassKg;

  const grossValue = input.pricePerKg === undefined ? undefined : m1 * input.pricePerKg;
  const netValue = input.pricePerKg === undefined ? undefined : selectedFinal * input.pricePerKg;

  // Energy is drawn from the SELECTED order's own water-out, not the
  // top-level moisture-only baseline — see the doc comment above.
  const minimumEnergyMJ = (selected.waterOutKg * WATER_VAPORISATION_KJ_PER_KG) / 1000;
  const minimumEnergyKWh = minimumEnergyMJ / 3.6;
  const actualEnergyMJ =
    input.dryerEfficiencyPercent === undefined ? undefined : minimumEnergyMJ / (input.dryerEfficiencyPercent / 100);

  return {
    ok: true,
    driedMassKg,
    waterOutKg,
    shrinkPercent: (waterOutKg / m1) * 100,
    shrinkPercentMassIndependent: ((w1 - w2) / (100 - w2)) * 100,
    impuritiesFirst: branches.impuritiesFirst,
    moistureFirst: branches.moistureFirst,
    selected: input.order,
    grossValue,
    netValue,
    valueDifference: grossValue === undefined || netValue === undefined ? undefined : netValue - grossValue,
    minimumEnergyMJ,
    minimumEnergyKWh,
    actualEnergyMJ,
    actualEnergyKWh: actualEnergyMJ === undefined ? undefined : actualEnergyMJ / 3.6,
  };
}

/* ---------------------------------------------------------------------------
 * growing-degree-days — „Suma temperatura"
 * ------------------------------------------------------------------------ */

export interface CalendarDate {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  /** 1–31. */
  readonly day: number;
}

/** Proleptic-Gregorian Julian day number — pure arithmetic, no `Date`, no time zone. */
function toDayNumber(d: CalendarDate): number {
  const a = Math.floor((14 - d.month) / 12);
  const y = d.year + 4800 - a;
  const m = d.month + 12 * a - 3;
  return d.day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function fromDayNumber(jdn: number): CalendarDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return { year, month, day };
}

export interface GddReading {
  readonly date: CalendarDate;
  readonly tMaxC: number;
  readonly tMinC: number;
}

export interface GddInput {
  readonly readings: readonly GddReading[];
  readonly baseTempC: number;
  readonly upperLimitC?: number | undefined;
  readonly targetSum?: number | undefined;
  readonly averageWindowDays: number;
}

export interface GddRow {
  readonly date: CalendarDate;
  readonly simpleDaily: number;
  readonly simpleCumulative: number;
  readonly modifiedDaily: number;
  readonly modifiedCumulative: number;
}

export interface GddResult {
  readonly rows: readonly GddRow[];
  readonly totalSimple: number;
  readonly totalModified: number;
  readonly averageSimple: number;
  readonly averageSimpleRecent: number;
  readonly recentWindowDays: number;
  readonly zeroContributionDays: number;
  readonly remainingToTarget: number | undefined;
  readonly daysToTarget: number | undefined;
  readonly projectedDate: CalendarDate | undefined;
}

/**
 * Daily and cumulative growing-degree-days by the simple and the modified
 * (capped) method, over a caller-supplied series of daily highs and lows.
 *
 * **Both methods are always computed and neither is called correct** — they
 * are two different, equally standard conventions, and mixing them mid-season
 * is the most common source of a sum that will not reproduce. Parsing a
 * pasted block of rows is the surface's job; this function's input is already
 * one row per day.
 */
export function growingDegreeDays(input: GddInput): ProResult<GddResult> {
  if (!isIntegerIn(input.readings.length, 1, 400)) return fail("readings");
  if (!isInRange(input.baseTempC, -10, 30)) return fail("baseTempC");
  if (input.upperLimitC !== undefined) {
    if (!isInRange(input.upperLimitC, 10, 45)) return fail("upperLimitC");
    if (input.upperLimitC < input.baseTempC) return fail("upperLimitC");
  }
  if (input.targetSum !== undefined && !isPositive(input.targetSum)) return fail("targetSum");
  if (!isIntegerIn(input.averageWindowDays, 1, 60)) return fail("averageWindowDays");

  let previousDay: number | undefined;
  const rows: GddRow[] = [];
  let simpleTotal = 0;
  let modifiedTotal = 0;
  let zeroDays = 0;
  const recentSimple: number[] = [];

  for (const [i, r] of input.readings.entries()) {
    if (!isInRange(r.tMaxC, -40, 55)) return fail(`tMaxC:${i}`);
    if (!isInRange(r.tMinC, -40, 55)) return fail(`tMinC:${i}`);
    if (r.tMinC > r.tMaxC) return fail(`row:${i}`);
    const day = toDayNumber(r.date);
    if (previousDay !== undefined && day <= previousDay) return fail(`date:${i}`);
    previousDay = day;

    const simple = Math.max(0, (r.tMaxC + r.tMinC) / 2 - input.baseTempC);
    const tMinP = Math.max(r.tMinC, input.baseTempC);
    let tMaxP = input.upperLimitC === undefined ? r.tMaxC : Math.min(r.tMaxC, input.upperLimitC);
    tMaxP = Math.max(tMaxP, input.baseTempC);
    const modified = (tMaxP + tMinP) / 2 - input.baseTempC;

    simpleTotal += simple;
    modifiedTotal += modified;
    if (simple === 0) zeroDays += 1;
    recentSimple.push(simple);
    if (recentSimple.length > input.averageWindowDays) recentSimple.shift();

    rows.push({ date: r.date, simpleDaily: simple, simpleCumulative: simpleTotal, modifiedDaily: modified, modifiedCumulative: modifiedTotal });
  }

  const recentWindowDays = recentSimple.length;
  const averageSimpleRecent = recentSimple.reduce((s, v) => s + v, 0) / recentWindowDays;
  const averageSimple = simpleTotal / rows.length;

  let remainingToTarget: number | undefined;
  let daysToTarget: number | undefined;
  let projectedDate: CalendarDate | undefined;
  if (input.targetSum !== undefined) {
    remainingToTarget = input.targetSum - simpleTotal;
    if (remainingToTarget > 0 && averageSimpleRecent > 0) {
      daysToTarget = Math.ceil(remainingToTarget / averageSimpleRecent);
      const lastRow = rows[rows.length - 1];
      if (lastRow !== undefined) projectedDate = fromDayNumber(toDayNumber(lastRow.date) + daysToTarget);
    }
  }

  return {
    ok: true,
    rows,
    totalSimple: simpleTotal,
    totalModified: modifiedTotal,
    averageSimple,
    averageSimpleRecent,
    recentWindowDays,
    zeroContributionDays: zeroDays,
    remainingToTarget,
    daysToTarget,
    projectedDate,
  };
}

/* ---------------------------------------------------------------------------
 * honey-mass-moisture — „Med, masa i vlaga"
 * ------------------------------------------------------------------------ */

export type HoneyQuantityMode = "grossTare" | "volume";

export interface HoneyInput {
  readonly quantityMode: HoneyQuantityMode;
  readonly grossMassKg?: number | undefined;
  readonly tareKg?: number | undefined;
  readonly containerVolumeL?: number | undefined;
  /** kg/L, 1.35–1.50 — the user's own reading, never derived from `sampleMassKg`/`sampleVolumeL`. */
  readonly densityKgL: number;
  readonly sampleMassKg?: number | undefined;
  readonly sampleVolumeL?: number | undefined;
  readonly moisturePercent: number;
  readonly targetMoisturePercent?: number | undefined;
  readonly jarVolumeMl?: number | undefined;
  readonly jarDeclaredNetMassG?: number | undefined;
  readonly jarToleranceG?: number | undefined;
  readonly pricePerKg?: number | undefined;
}

export interface HoneyResult {
  readonly netMassKg: number;
  readonly volumeFromMassL: number;
  readonly measuredDensityKgL: number | undefined;
  readonly waterMassKg: number;
  readonly dryMatterMassKg: number;
  readonly driedMassKg: number | undefined;
  readonly waterRemovedKg: number | undefined;
  readonly shrinkPercent: number | undefined;
  readonly massPerJarKg: number | undefined;
  /** Same figure in grams — jar labels are printed in g, never kg. */
  readonly massPerJarG: number | undefined;
  readonly fullJars: number | undefined;
  readonly jarRemainderKg: number | undefined;
  readonly jarsFromDeclaredMass: number | undefined;
  readonly fillMassVsDeclaredG: number | undefined;
  readonly jarToleranceG: number | undefined;
  readonly grossValue: number | undefined;
  readonly driedValue: number | undefined;
}

/**
 * Net mass, water/dry-matter split and jar counts for a batch of honey, from
 * an independently entered density and moisture.
 *
 * **Density and moisture are never derived from each other**, even though a
 * sample-mass/volume pair can compute an independent `measuredDensityKgL`:
 * the two ARE physically linked, but coupling them here would let an
 * impossible pair silently read as confirmed.
 */
export function honeyMassMoisture(input: HoneyInput): ProResult<HoneyResult> {
  if (!isInRange(input.densityKgL, 1.35, 1.5)) return fail("densityKgL");
  if (!isInRange(input.moisturePercent, 12, 25)) return fail("moisturePercent");
  if (input.targetMoisturePercent !== undefined && !isInRange(input.targetMoisturePercent, 12, 25)) {
    return fail("targetMoisturePercent");
  }
  if (input.pricePerKg !== undefined && !isNonNegative(input.pricePerKg)) return fail("pricePerKg");

  let netMassKg: number;
  if (input.quantityMode === "grossTare") {
    if (!isPositive(input.grossMassKg)) return fail("grossMassKg");
    if (!isNonNegative(input.tareKg)) return fail("tareKg");
    netMassKg = input.grossMassKg - input.tareKg;
    if (netMassKg <= 0) return fail("netMassKg");
  } else {
    if (!isPositive(input.containerVolumeL)) return fail("containerVolumeL");
    netMassKg = input.containerVolumeL * input.densityKgL;
  }

  let measuredDensityKgL: number | undefined;
  if (input.sampleMassKg !== undefined || input.sampleVolumeL !== undefined) {
    if (!isPositive(input.sampleMassKg)) return fail("sampleMassKg");
    if (!isPositive(input.sampleVolumeL)) return fail("sampleVolumeL");
    measuredDensityKgL = input.sampleMassKg / input.sampleVolumeL;
    if (!isInRange(measuredDensityKgL, 1.35, 1.5)) return fail("sampleDensity");
  }

  const waterMassKg = netMassKg * (input.moisturePercent / 100);
  const dryMatterMassKg = netMassKg - waterMassKg;

  let driedMassKg: number | undefined;
  let waterRemovedKg: number | undefined;
  let shrinkPercent: number | undefined;
  if (input.targetMoisturePercent !== undefined) {
    driedMassKg = moistureAdjust(netMassKg, input.moisturePercent, input.targetMoisturePercent);
    if (driedMassKg === undefined) return fail("targetMoisturePercent");
    waterRemovedKg = netMassKg - driedMassKg;
    shrinkPercent = (waterRemovedKg / netMassKg) * 100;
  }

  let massPerJarKg: number | undefined;
  let fullJars: number | undefined;
  let jarRemainderKg: number | undefined;
  let fillMassVsDeclaredG: number | undefined;
  if (input.jarVolumeMl !== undefined) {
    if (!isPositive(input.jarVolumeMl)) return fail("jarVolumeMl");
    massPerJarKg = (input.jarVolumeMl / 1000) * input.densityKgL;
    // floorSnapped: an exact multiple of massPerJarKg routinely lands one ULP
    // below the whole number after this chain of divisions, and a bare floor
    // would drop a full jar into the remainder.
    fullJars = floorSnapped(netMassKg / massPerJarKg);
    jarRemainderKg = netMassKg - fullJars * massPerJarKg;
    if (input.jarDeclaredNetMassG !== undefined) {
      if (!isPositive(input.jarDeclaredNetMassG)) return fail("jarDeclaredNetMassG");
      fillMassVsDeclaredG = massPerJarKg * 1000 - input.jarDeclaredNetMassG;
    }
  }
  let jarsFromDeclaredMass: number | undefined;
  if (input.jarDeclaredNetMassG !== undefined) {
    if (!isPositive(input.jarDeclaredNetMassG)) return fail("jarDeclaredNetMassG");
    jarsFromDeclaredMass = floorSnapped(netMassKg / (input.jarDeclaredNetMassG / 1000));
  }
  if (input.jarToleranceG !== undefined && !isNonNegative(input.jarToleranceG)) return fail("jarToleranceG");

  const grossValue = input.pricePerKg === undefined ? undefined : netMassKg * input.pricePerKg;
  const driedValue =
    input.pricePerKg === undefined || driedMassKg === undefined ? undefined : driedMassKg * input.pricePerKg;

  return {
    ok: true,
    netMassKg,
    volumeFromMassL: netMassKg / input.densityKgL,
    measuredDensityKgL,
    waterMassKg,
    dryMatterMassKg,
    driedMassKg,
    waterRemovedKg,
    shrinkPercent,
    massPerJarKg,
    massPerJarG: massPerJarKg === undefined ? undefined : massPerJarKg * 1000,
    fullJars,
    jarRemainderKg,
    jarsFromDeclaredMass,
    fillMassVsDeclaredG,
    jarToleranceG: input.jarToleranceG,
    grossValue,
    driedValue,
  };
}

/* ---------------------------------------------------------------------------
 * irrigation-depth-volume — „Norma zalivanja"
 * ------------------------------------------------------------------------ */

export type IrrigationMethod = "sprinkler" | "drip";
export type FlowUnit = "m3h" | "ls";

export interface IrrigationInput {
  readonly normMm: number;
  readonly areaHa: number;
  readonly efficiencyPercent: number;
  readonly flowUnit: FlowUnit;
  readonly flowValue: number;
  readonly method: IrrigationMethod;
  readonly sprinklerSpacingInRowM?: number | undefined;
  readonly sprinklerSpacingBetweenRowsM?: number | undefined;
  /** L/h — the surface converts m³/h before calling. */
  readonly nozzleFlowLh?: number | undefined;
  readonly dripsPerPlant?: number | undefined;
  readonly dripFlowLh?: number | undefined;
  readonly areaPerPlantM2?: number | undefined;
  readonly hoursPerDay: number;
}

export interface IrrigationResult {
  readonly netVolumeM3: number;
  readonly netVolumeL: number;
  readonly grossVolumeM3: number;
  readonly flowM3h: number;
  readonly timeHours: number;
  readonly timeHoursPart: number;
  readonly timeMinutesPart: number;
  readonly daysNeeded: number;
  readonly intensityMmH: number | undefined;
  /** Time per sprinkler position for the NET norm — see `grossTimePerPositionH`. */
  readonly netTimePerPositionH: number | undefined;
  readonly grossTimePerPositionH: number | undefined;
  readonly positions: number | undefined;
  /** floor(hoursPerDay / grossTimePerPositionH) — GROSS, because that is the
   * time the system must actually run at one position. */
  readonly positionsPerDay: number | undefined;
  readonly netLitersPerPlant: number | undefined;
  readonly netDripDurationH: number | undefined;
  readonly grossLitersPerPlant: number | undefined;
  readonly grossDripDurationH: number | undefined;
}

/**
 * Water volume, pump run time and, per method, either sprinkler intensity or
 * drip-cycle duration for one irrigation.
 *
 * **Net and gross norm both drive the per-position/per-cycle numbers** — the
 * assignment's own review found the original mixed net (application) and
 * gross (pumped) norms in the same screen without saying so, so both are
 * returned rather than one silently chosen.
 */
export function irrigationDepthVolume(input: IrrigationInput): ProResult<IrrigationResult> {
  if (!isInRange(input.normMm, 0.5, 200)) return fail("normMm");
  if (!isPositive(input.areaHa)) return fail("areaHa");
  if (!isInRange(input.efficiencyPercent, 30, 100)) return fail("efficiencyPercent");
  if (!isPositive(input.flowValue)) return fail("flowValue");
  if (!isInRange(input.hoursPerDay, 0.5, 24)) return fail("hoursPerDay");
  // A typed 0 on any of these must be indistinguishable from an EMPTY field
  // only in the sense that both leave the dependent outputs undefined — never
  // in the sense of silently passing validation. Each is a divisor somewhere
  // below, so a zero the user actually typed is refused here explicitly,
  // while an omitted (`undefined`) field simply skips that output block.
  if (input.sprinklerSpacingInRowM !== undefined && !isPositive(input.sprinklerSpacingInRowM)) {
    return fail("sprinklerSpacingInRowM");
  }
  if (input.sprinklerSpacingBetweenRowsM !== undefined && !isPositive(input.sprinklerSpacingBetweenRowsM)) {
    return fail("sprinklerSpacingBetweenRowsM");
  }
  if (input.nozzleFlowLh !== undefined && !isPositive(input.nozzleFlowLh)) return fail("nozzleFlowLh");
  if (input.dripsPerPlant !== undefined && !isPositive(input.dripsPerPlant)) return fail("dripsPerPlant");
  if (input.dripFlowLh !== undefined && !isPositive(input.dripFlowLh)) return fail("dripFlowLh");
  if (input.areaPerPlantM2 !== undefined && !isPositive(input.areaPerPlantM2)) return fail("areaPerPlantM2");

  const netVolumeM3 = input.normMm * 10 * input.areaHa;
  const grossVolumeM3 = netVolumeM3 / (input.efficiencyPercent / 100);
  const grossNormMm = input.normMm / (input.efficiencyPercent / 100);
  const flowM3h = input.flowUnit === "ls" ? input.flowValue * 3.6 : input.flowValue;
  const timeHours = grossVolumeM3 / flowM3h;
  const { h, min } = hoursAndMinutes(timeHours);
  const daysNeeded = Math.ceil(timeHours / input.hoursPerDay);

  let intensityMmH: number | undefined;
  let netTimePerPositionH: number | undefined;
  let grossTimePerPositionH: number | undefined;
  let positions: number | undefined;
  let positionsPerDay: number | undefined;
  if (input.method === "sprinkler") {
    if (isPositive(input.sprinklerSpacingInRowM) && isPositive(input.sprinklerSpacingBetweenRowsM) && isPositive(input.nozzleFlowLh)) {
      const w = input.sprinklerSpacingInRowM * input.sprinklerSpacingBetweenRowsM;
      intensityMmH = input.nozzleFlowLh / w;
      netTimePerPositionH = input.normMm / intensityMmH;
      grossTimePerPositionH = grossNormMm / intensityMmH;
      positions = (input.areaHa * HECTARE_M2) / w;
      // The system must actually RUN the gross time at a position to leave
      // the net depth behind after losses — using the net time here would
      // schedule more positions into a day than the pump can really cover.
      positionsPerDay = Math.floor(input.hoursPerDay / grossTimePerPositionH);
    }
  }

  let netLitersPerPlant: number | undefined;
  let netDripDurationH: number | undefined;
  let grossLitersPerPlant: number | undefined;
  let grossDripDurationH: number | undefined;
  if (input.method === "drip") {
    if (isPositive(input.dripsPerPlant) && isPositive(input.dripFlowLh) && isPositive(input.areaPerPlantM2)) {
      const q = input.dripsPerPlant * input.dripFlowLh;
      netLitersPerPlant = input.normMm * input.areaPerPlantM2;
      netDripDurationH = netLitersPerPlant / q;
      grossLitersPerPlant = grossNormMm * input.areaPerPlantM2;
      grossDripDurationH = grossLitersPerPlant / q;
    }
  }

  return {
    ok: true,
    netVolumeM3,
    netVolumeL: netVolumeM3 * 1000,
    grossVolumeM3,
    flowM3h,
    timeHours,
    timeHoursPart: h,
    timeMinutesPart: min,
    daysNeeded,
    intensityMmH,
    netTimePerPositionH,
    grossTimePerPositionH,
    positions,
    positionsPerDay,
    netLitersPerPlant,
    netDripDurationH,
    grossLitersPerPlant,
    grossDripDurationH,
  };
}

/* ---------------------------------------------------------------------------
 * livestock-ration-dm — „Obrok po suvoj materiji"
 * ------------------------------------------------------------------------ */

export type IntakeMode = "percentOfBody" | "kgPerHeadPerDay";

export interface RationFeed {
  readonly name: string;
  readonly dmPercent: number;
  readonly shareOfDmPercent: number;
  readonly pricePerKgFresh?: number | undefined;
  readonly packageMassKg?: number | undefined;
}

export interface RationInput {
  readonly headCount: number;
  readonly avgBodyMassKg: number;
  readonly intakeMode: IntakeMode;
  readonly intakeValue: number;
  readonly feeds: readonly RationFeed[];
  readonly days: number;
  readonly wastePercent: number;
}

export interface RationFeedResult {
  readonly name: string;
  readonly dmKgPerDay: number;
  readonly freshEatenKgPerDay: number;
  readonly freshIssuedKgPerDay: number;
  readonly periodIssuedKg: number;
  readonly periodIssuedT: number;
  readonly packagesExact: number | undefined;
  readonly packagesCeil: number | undefined;
  readonly dailyCost: number | undefined;
  readonly periodCost: number | undefined;
}

export interface RationResult {
  readonly dmPerHeadKgDay: number;
  readonly dmHerdKgDay: number;
  readonly shareSumPercent: number;
  readonly feeds: readonly RationFeedResult[];
  readonly totalFreshEatenKgDay: number;
  readonly totalFreshIssuedKgDay: number;
  readonly totalFreshEatenPerHeadKgDay: number;
  /** Σ dmKgPerDay / Σ freshEatenKgPerDay — waste is spillage of the SAME
   * mixture at the trough, so it does not change the DM concentration, and
   * dividing by the issued (waste-inflated) mass instead would report a
   * concentration no feed in the barn actually has. Undefined when the eaten
   * mass is zero (every share was 0%) — never NaN; the spec forbids silently
   * normalising the shares, so this stays unset rather than dividing by zero. */
  readonly rationDmPercentAsIssued: number | undefined;
  readonly totalDailyCost: number | undefined;
  readonly totalPeriodCost: number | undefined;
}

/**
 * Fresh-mass ration for a herd from a dry-matter intake and a feed mix, plus
 * the quantity actually issued once waste at the trough is accounted for.
 *
 * **Waste inflates what is ISSUED, never what is eaten**: `freshEatenKgPerDay`
 * is the formulated ration, and every cost and every order quantity is taken
 * from `freshIssuedKgPerDay = eaten/(1 − waste/100)` — pricing the eaten
 * figure understates the order by exactly the waste fraction.
 */
export function livestockRationDm(input: RationInput): ProResult<RationResult> {
  if (!isIntegerIn(input.headCount, 1, 100000)) return fail("headCount");
  if (!isPositive(input.avgBodyMassKg)) return fail("avgBodyMassKg");
  if (input.intakeMode === "percentOfBody") {
    if (!isInRange(input.intakeValue, 0.5, 6)) return fail("intakeValue");
  } else if (!isPositive(input.intakeValue)) {
    return fail("intakeValue");
  }
  if (!isIntegerIn(input.feeds.length, 1, 20)) return fail("feeds");
  if (!isIntegerIn(input.days, 1, 730)) return fail("days");
  if (!isInRange(input.wastePercent, 0, 30)) return fail("wastePercent");

  const dmPerHeadKgDay =
    input.intakeMode === "percentOfBody" ? (input.avgBodyMassKg * input.intakeValue) / 100 : input.intakeValue;
  const dmHerdKgDay = input.headCount * dmPerHeadKgDay;
  const shareSumPercent = input.feeds.reduce((s, f) => s + f.shareOfDmPercent, 0);

  const feeds: RationFeedResult[] = [];
  for (const [i, f] of input.feeds.entries()) {
    if (!isInRange(f.dmPercent, 1, 100)) return fail(`dmPercent:${i}`);
    if (!isInRange(f.shareOfDmPercent, 0, 100)) return fail(`shareOfDmPercent:${i}`);
    if (f.pricePerKgFresh !== undefined && !isNonNegative(f.pricePerKgFresh)) return fail(`pricePerKgFresh:${i}`);
    if (f.packageMassKg !== undefined && !isPositive(f.packageMassKg)) return fail(`packageMassKg:${i}`);

    const dmKgPerDay = (dmHerdKgDay * f.shareOfDmPercent) / 100;
    const freshEatenKgPerDay = (100 * dmKgPerDay) / f.dmPercent;
    const freshIssuedKgPerDay = freshEatenKgPerDay / (1 - input.wastePercent / 100);
    const periodIssuedKg = freshIssuedKgPerDay * input.days;
    const dailyCost = f.pricePerKgFresh === undefined ? undefined : freshIssuedKgPerDay * f.pricePerKgFresh;
    feeds.push({
      name: f.name,
      dmKgPerDay,
      freshEatenKgPerDay,
      freshIssuedKgPerDay,
      periodIssuedKg,
      periodIssuedT: periodIssuedKg / 1000,
      packagesExact: f.packageMassKg === undefined ? undefined : periodIssuedKg / f.packageMassKg,
      packagesCeil: f.packageMassKg === undefined ? undefined : Math.ceil(periodIssuedKg / f.packageMassKg),
      dailyCost,
      periodCost: dailyCost === undefined ? undefined : dailyCost * input.days,
    });
  }

  const totalFreshEatenKgDay = feeds.reduce((s, f) => s + f.freshEatenKgPerDay, 0);
  const totalFreshIssuedKgDay = feeds.reduce((s, f) => s + f.freshIssuedKgPerDay, 0);
  const totalDmKgDay = feeds.reduce((s, f) => s + f.dmKgPerDay, 0);
  const pricedDaily = feeds.filter((f) => f.dailyCost !== undefined);

  return {
    ok: true,
    dmPerHeadKgDay,
    dmHerdKgDay,
    shareSumPercent,
    feeds,
    totalFreshEatenKgDay,
    totalFreshIssuedKgDay,
    totalFreshEatenPerHeadKgDay: totalFreshEatenKgDay / input.headCount,
    rationDmPercentAsIssued: totalFreshEatenKgDay > 0 ? (totalDmKgDay / totalFreshEatenKgDay) * 100 : undefined,
    totalDailyCost: pricedDaily.length === 0 ? undefined : pricedDaily.reduce((s, f) => s + (f.dailyCost ?? 0), 0),
    totalPeriodCost: pricedDaily.length === 0 ? undefined : pricedDaily.reduce((s, f) => s + (f.periodCost ?? 0), 0),
  };
}

/* ---------------------------------------------------------------------------
 * machine-field-capacity — „Učinak mašine"
 * ------------------------------------------------------------------------ */

export interface MachineCapacityInput {
  readonly nominalWidthM: number;
  readonly overlapPercent: number;
  readonly speedKmh: number;
  readonly utilizationPercent: number;
  readonly areaHa: number;
  readonly fuelLPerHour?: number | undefined;
  readonly fuelPricePerL?: number | undefined;
  readonly hoursPerDay: number;
  readonly turnSeconds?: number | undefined;
  readonly fieldLengthM?: number | undefined;
}

export interface MachineCapacityResult {
  readonly actualWidthM: number;
  readonly theoreticalCapacityHaH: number;
  readonly effectiveCapacityHaH: number;
  readonly timeHours: number;
  readonly timeHoursPart: number;
  readonly timeMinutesPart: number;
  readonly daysNeeded: number;
  readonly capacityPerDayHa: number;
  readonly lastDayHours: number;
  readonly fuelLPerHa: number | undefined;
  readonly fuelTotalL: number | undefined;
  readonly fuelCostPerHa: number | undefined;
  readonly fuelCostTotal: number | undefined;
  /** `passes − 1` turns — nothing follows the last pass. */
  readonly turnCount: number | undefined;
  readonly turnTimeHours: number | undefined;
  readonly turnTimeSharePercent: number | undefined;
}

/**
 * Field capacity, run time and fuel use for an implement, from its working
 * width, speed and time-utilisation factor.
 *
 * **Turn count is passes MINUS ONE**: an implement turns between passes, not
 * after the last one, so `ceil(passes)` alone overstates headland turning by
 * one turn every time.
 */
export function machineFieldCapacity(input: MachineCapacityInput): ProResult<MachineCapacityResult> {
  if (!isInRange(input.nominalWidthM, 0.5, 60)) return fail("nominalWidthM");
  if (!isInRange(input.overlapPercent, 0, 30)) return fail("overlapPercent");
  if (!isInRange(input.speedKmh, 0.5, 30)) return fail("speedKmh");
  if (!isInRange(input.utilizationPercent, 30, 100)) return fail("utilizationPercent");
  if (!isPositive(input.areaHa)) return fail("areaHa");
  if (!isInRange(input.hoursPerDay, 0.5, 24)) return fail("hoursPerDay");
  if (input.fuelLPerHour !== undefined && !isPositive(input.fuelLPerHour)) return fail("fuelLPerHour");
  if (input.fuelPricePerL !== undefined && !isNonNegative(input.fuelPricePerL)) return fail("fuelPricePerL");
  if (input.turnSeconds !== undefined && !isInRange(input.turnSeconds, 0, 600)) return fail("turnSeconds");
  if (input.fieldLengthM !== undefined && !isPositive(input.fieldLengthM)) return fail("fieldLengthM");

  const actualWidthM = input.nominalWidthM * (1 - input.overlapPercent / 100);
  const theoreticalCapacityHaH = (actualWidthM * input.speedKmh) / 10;
  const effectiveCapacityHaH = theoreticalCapacityHaH * (input.utilizationPercent / 100);
  const timeHours = input.areaHa / effectiveCapacityHaH;
  const { h, min } = hoursAndMinutes(timeHours);
  const daysNeeded = Math.ceil(timeHours / input.hoursPerDay);
  const fullDays = Math.floor(timeHours / input.hoursPerDay);
  const remainder = timeHours - fullDays * input.hoursPerDay;
  const lastDayHours = remainder > 0 ? remainder : input.hoursPerDay;

  const fuelLPerHa = input.fuelLPerHour === undefined ? undefined : input.fuelLPerHour / effectiveCapacityHaH;
  const fuelTotalL = fuelLPerHa === undefined ? undefined : fuelLPerHa * input.areaHa;
  const fuelCostPerHa =
    fuelLPerHa === undefined || input.fuelPricePerL === undefined ? undefined : fuelLPerHa * input.fuelPricePerL;
  const fuelCostTotal =
    fuelTotalL === undefined || input.fuelPricePerL === undefined ? undefined : fuelTotalL * input.fuelPricePerL;

  let turnCount: number | undefined;
  let turnTimeHours: number | undefined;
  let turnTimeSharePercent: number | undefined;
  if (input.fieldLengthM !== undefined && input.turnSeconds !== undefined) {
    const passes = ceilSnapped((input.areaHa * HECTARE_M2) / (actualWidthM * input.fieldLengthM));
    turnCount = Math.max(0, passes - 1);
    turnTimeHours = (turnCount * input.turnSeconds) / 3600;
    turnTimeSharePercent = (turnTimeHours / timeHours) * 100;
  }

  return {
    ok: true,
    actualWidthM,
    theoreticalCapacityHaH,
    effectiveCapacityHaH,
    timeHours,
    timeHoursPart: h,
    timeMinutesPart: min,
    daysNeeded,
    capacityPerDayHa: effectiveCapacityHaH * input.hoursPerDay,
    lastDayHours,
    fuelLPerHa,
    fuelTotalL,
    fuelCostPerHa,
    fuelCostTotal,
    turnCount,
    turnTimeHours,
    turnTimeSharePercent,
  };
}

/* ---------------------------------------------------------------------------
 * orchard-trellis-layout — „Naslon i redovi"
 * ------------------------------------------------------------------------ */

/** Density of ordinary structural/galvanised-fence steel wire, kg/m³. */
const STEEL_DENSITY = 7850;

export interface TrellisInput {
  readonly lengthM: number;
  readonly widthM: number;
  readonly rowSpacingM: number;
  readonly headlandM: number;
  readonly boundaryOffsetM: number;
  readonly postSpacingM: number;
  readonly wireRows: number;
  readonly wireDiameterMm?: number | undefined;
  readonly wireSlackPercent: number;
  readonly plantSpacingM: number;
  readonly anchorsPerEnd: number;
  readonly coilLengthM?: number | undefined;
  /** `true`: a plant at each end of the row (floor + 1). `false`: set back half a spacing (floor). */
  readonly plantAtBothEnds: boolean;
  /** Declared mass per km from the wire's own label, kg/km — overrides the steel-density estimate. */
  readonly wireMassPerKmOverride?: number | undefined;
}

export interface TrellisResult {
  readonly zeroRows: boolean;
  readonly rowsCount: number;
  readonly rowLengthM: number;
  readonly totalRowLengthM: number;
  readonly postGapsPerRow: number;
  readonly postsPerRow: number;
  readonly endPostsPerRow: number;
  readonly midPostsPerRow: number;
  readonly actualPostSpacingM: number;
  readonly totalPosts: number;
  readonly anchors: number;
  readonly wireLengthM: number;
  readonly wireMassKg: number | undefined;
  readonly coilsCeil: number | undefined;
  readonly kgPerCoil: number | undefined;
  readonly plantsPerRow: number;
  readonly totalPlants: number;
  readonly plotAreaHa: number;
  readonly densityPerHa: number;
  readonly theoreticalDensityPerHa: number;
  /** ((n_r−1)·a + a)·L_r, ha — the row-covered rectangle, NOT the full plot `plotAreaHa`. */
  readonly usedAreaHa: number;
}

/**
 * Row count, post/anchor/wire quantities and plant count for a trellised
 * orchard or vineyard block.
 *
 * **`plotAreaHa` (L×W) and `usedAreaHa` are two different denominators** —
 * the reported density is per the FULL plot, while `usedAreaHa` is only the
 * rectangle the rows actually occupy; conflating them under-reports density
 * by exactly the headland and boundary margin.
 */
export function orchardTrellisLayout(input: TrellisInput): ProResult<TrellisResult> {
  if (!isPositive(input.lengthM)) return fail("lengthM");
  if (!isPositive(input.widthM)) return fail("widthM");
  if (!isInRange(input.rowSpacingM, 0.5, 20)) return fail("rowSpacingM");
  if (!isInRange(input.headlandM, 0, 30)) return fail("headlandM");
  if (!isInRange(input.boundaryOffsetM, 0, 30)) return fail("boundaryOffsetM");
  if (!isInRange(input.postSpacingM, 2, 15)) return fail("postSpacingM");
  if (!isIntegerIn(input.wireRows, 1, 8)) return fail("wireRows");
  if (input.wireDiameterMm !== undefined && !isInRange(input.wireDiameterMm, 1, 5)) return fail("wireDiameterMm");
  if (!isInRange(input.wireSlackPercent, 0, 30)) return fail("wireSlackPercent");
  if (!isInRange(input.plantSpacingM, 0.3, 10)) return fail("plantSpacingM");
  if (!isIntegerIn(input.anchorsPerEnd, 0, 2)) return fail("anchorsPerEnd");
  if (input.coilLengthM !== undefined && !isPositive(input.coilLengthM)) return fail("coilLengthM");
  if (input.wireMassPerKmOverride !== undefined && !isPositive(input.wireMassPerKmOverride)) {
    return fail("wireMassPerKmOverride");
  }

  const widthAvailable = input.widthM - 2 * input.boundaryOffsetM;
  const rowLengthM = input.lengthM - 2 * input.headlandM;
  // rowLengthM === 0 must fall into the zero-rows branch too, not just < 0: a
  // zero-length row still has a post-gap count of ceil(0/postSpacing) = 0,
  // which then makes `postGapsPerRow − 1` a negative mid-post count and
  // `rowLengthM / postGapsPerRow` a 0/0 NaN actual spacing.
  const zeroRows = widthAvailable < 0 || rowLengthM <= 0;
  const rowsCount = zeroRows ? 0 : rowsAcrossWidth(widthAvailable, input.rowSpacingM);
  const plotAreaHa = (input.lengthM * input.widthM) / HECTARE_M2;

  if (zeroRows || rowsCount === 0) {
    return {
      ok: true,
      zeroRows: true,
      rowsCount: 0,
      rowLengthM: Math.max(0, rowLengthM),
      totalRowLengthM: 0,
      postGapsPerRow: 0,
      postsPerRow: 0,
      endPostsPerRow: 0,
      midPostsPerRow: 0,
      actualPostSpacingM: 0,
      totalPosts: 0,
      anchors: 0,
      wireLengthM: 0,
      wireMassKg: undefined,
      coilsCeil: undefined,
      kgPerCoil: undefined,
      plantsPerRow: 0,
      totalPlants: 0,
      plotAreaHa,
      densityPerHa: 0,
      theoreticalDensityPerHa: HECTARE_M2 / (input.rowSpacingM * input.plantSpacingM),
      usedAreaHa: 0,
    };
  }

  const totalRowLengthM = rowsCount * rowLengthM;
  const postGapsPerRow = ceilSnapped(rowLengthM / input.postSpacingM);
  const postsPerRow = postGapsPerRow + 1;
  const totalPosts = rowsCount * postsPerRow;
  const anchors = rowsCount * 2 * input.anchorsPerEnd;
  const wireLengthM = totalRowLengthM * input.wireRows * (1 + input.wireSlackPercent / 100);

  const massPerM =
    input.wireMassPerKmOverride !== undefined
      ? input.wireMassPerKmOverride / 1000
      : input.wireDiameterMm === undefined
        ? undefined
        : Math.PI * (input.wireDiameterMm / 2000) ** 2 * STEEL_DENSITY;
  const wireMassKg = massPerM === undefined ? undefined : wireLengthM * massPerM;
  const coilsCeil = input.coilLengthM === undefined ? undefined : Math.ceil(wireLengthM / input.coilLengthM);
  const kgPerCoil = input.coilLengthM === undefined || massPerM === undefined ? undefined : input.coilLengthM * massPerM;

  const plantsPerRow = floorSnapped(rowLengthM / input.plantSpacingM) + (input.plantAtBothEnds ? 1 : 0);
  const totalPlants = rowsCount * plantsPerRow;

  return {
    ok: true,
    zeroRows: false,
    rowsCount,
    rowLengthM,
    totalRowLengthM,
    postGapsPerRow,
    postsPerRow,
    endPostsPerRow: 2,
    midPostsPerRow: postGapsPerRow - 1,
    actualPostSpacingM: rowLengthM / postGapsPerRow,
    totalPosts,
    anchors,
    wireLengthM,
    wireMassKg,
    coilsCeil,
    kgPerCoil,
    plantsPerRow,
    totalPlants,
    plotAreaHa,
    densityPerHa: totalPlants / plotAreaHa,
    theoreticalDensityPerHa: HECTARE_M2 / (input.rowSpacingM * input.plantSpacingM),
    usedAreaHa: (rowsCount * input.rowSpacingM * rowLengthM) / HECTARE_M2,
  };
}

/* ---------------------------------------------------------------------------
 * plant-spacing-density — „Razmak sadnje"
 * ------------------------------------------------------------------------ */

export type PlantingPattern = "rectangular" | "triangular";
/** √3/2 — area of the rhombus half formed by two adjacent equilateral-triangle spacings. */
const TRIANGULAR_FACTOR = Math.sqrt(3) / 2;

export interface PlantSpacingInput {
  readonly pattern: PlantingPattern;
  readonly rowSpacingM: number;
  /** In-row spacing for `"rectangular"`; the uniform neighbour distance `d` for `"triangular"`. */
  readonly spacingM: number;
  readonly lengthM?: number | undefined;
  readonly widthM?: number | undefined;
  readonly headlandM: number;
  readonly boundaryOffsetM: number;
  readonly desiredDensityPerHa?: number | undefined;
}

export interface PlantSpacingResult {
  readonly areaPerPlantM2: number;
  readonly theoreticalDensityPerHa: number;
  readonly rowsCount: number | undefined;
  readonly rowLengthM: number | undefined;
  readonly plantsPerRow: number | undefined;
  readonly totalPlants: number | undefined;
  readonly plotAreaHa: number | undefined;
  readonly usedAreaHa: number | undefined;
  readonly actualDensityPerHa: number | undefined;
  readonly requiredInRowSpacingM: number | undefined;
  readonly requiredSpacingRoundedM: number | undefined;
  readonly densityAtRoundedSpacing: number | undefined;
}

/**
 * Planting density from row and in-row spacing, or the spacing a desired
 * density requires — for a rectangular or a triangular (staggered) pattern.
 *
 * **The on-parcel count is only computed for the rectangular pattern.** A
 * triangular layout offsets every second row by `d/2`, which can drop a
 * plant from that row when the offset does not fit the width — a shape this
 * function does not model, so it reports the two per-plant geometries only.
 */
export function plantSpacingDensity(input: PlantSpacingInput): ProResult<PlantSpacingResult> {
  if (!isInRange(input.rowSpacingM, 0.05, 50)) return fail("rowSpacingM");
  if (!isInRange(input.spacingM, 0.05, 50)) return fail("spacingM");
  if (!isInRange(input.headlandM, 0, 50)) return fail("headlandM");
  if (!isInRange(input.boundaryOffsetM, 0, 50)) return fail("boundaryOffsetM");
  if (input.desiredDensityPerHa !== undefined && !isPositive(input.desiredDensityPerHa)) {
    return fail("desiredDensityPerHa");
  }
  // Both optional (the on-parcel block below is skipped without them), but a
  // typed 0 must be refused rather than silently treated the same as an
  // absent parcel — it would otherwise drop rowsCount/plantsPerRow/
  // actualDensityPerHa without saying why.
  if (input.lengthM !== undefined && !isPositive(input.lengthM)) return fail("lengthM");
  if (input.widthM !== undefined && !isPositive(input.widthM)) return fail("widthM");

  const areaPerPlantM2 =
    input.pattern === "rectangular" ? input.rowSpacingM * input.spacingM : TRIANGULAR_FACTOR * input.spacingM ** 2;
  const theoreticalDensityPerHa = HECTARE_M2 / areaPerPlantM2;

  let rowsCount: number | undefined;
  let rowLengthM: number | undefined;
  let plantsPerRow: number | undefined;
  let totalPlants: number | undefined;
  let plotAreaHa: number | undefined;
  let usedAreaHa: number | undefined;
  let actualDensityPerHa: number | undefined;
  if (input.pattern === "rectangular" && isPositive(input.lengthM) && isPositive(input.widthM)) {
    const widthAvailable = input.widthM - 2 * input.boundaryOffsetM;
    const rl = input.lengthM - 2 * input.headlandM;
    if (widthAvailable < 0 || rl < 0) {
      rowsCount = 0;
      rowLengthM = Math.max(0, rl);
      plantsPerRow = 0;
      totalPlants = 0;
    } else {
      rowsCount = rowsAcrossWidth(widthAvailable, input.rowSpacingM);
      rowLengthM = rl;
      plantsPerRow = floorSnapped(rl / input.spacingM) + 1;
      totalPlants = rowsCount * plantsPerRow;
    }
    plotAreaHa = (input.lengthM * input.widthM) / HECTARE_M2;
    usedAreaHa = (rowsCount * input.rowSpacingM * rowLengthM) / HECTARE_M2;
    actualDensityPerHa = totalPlants / plotAreaHa;
  }

  let requiredInRowSpacingM: number | undefined;
  let requiredSpacingRoundedM: number | undefined;
  let densityAtRoundedSpacing: number | undefined;
  if (input.pattern === "rectangular" && input.desiredDensityPerHa !== undefined) {
    requiredInRowSpacingM = HECTARE_M2 / (input.desiredDensityPerHa * input.rowSpacingM);
    // Rounded to the centimetre — the step a planter can actually be set to.
    requiredSpacingRoundedM = Math.round(requiredInRowSpacingM * 100) / 100;
    // A desired density so far beyond what the row spacing and a 1 cm planter
    // step can deliver rounds the required in-row spacing down to exactly
    // zero, which would otherwise divide by zero below and return Infinity
    // wrapped in `ok: true`.
    if (requiredSpacingRoundedM <= 0) return fail("desiredDensityPerHa");
    densityAtRoundedSpacing = HECTARE_M2 / (input.rowSpacingM * requiredSpacingRoundedM);
  }

  return {
    ok: true,
    areaPerPlantM2,
    theoreticalDensityPerHa,
    rowsCount,
    rowLengthM,
    plantsPerRow,
    totalPlants,
    plotAreaHa,
    usedAreaHa,
    actualDensityPerHa,
    requiredInRowSpacingM,
    requiredSpacingRoundedM,
    densityAtRoundedSpacing,
  };
}

/* ---------------------------------------------------------------------------
 * polygon-area — „Površina poligona"
 * ------------------------------------------------------------------------ */

export type PolygonColumnOrder = "YX" | "XY";

export interface PolygonVertex {
  readonly a: number;
  readonly b: number;
}

export interface PolygonAreaInput {
  readonly vertices: readonly PolygonVertex[];
  readonly columnOrder: PolygonColumnOrder;
}

export type PolygonWinding = "ccw" | "cw";

export interface PolygonAreaResult {
  readonly areaM2: number;
  readonly areaAr: number;
  readonly areaHa: number;
  readonly perimeterM: number;
  /** Undefined only when the signed area is exactly zero (collinear vertices). */
  readonly centroid: PolygonVertex | undefined;
  readonly winding: PolygonWinding;
}

interface XyPoint {
  readonly x: number;
  readonly y: number;
}

function cross2(ux: number, uy: number, vx: number, vy: number): number {
  return ux * vy - uy * vx;
}

function onSegment(a: XyPoint, b: XyPoint, p: XyPoint, eps: number): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - eps &&
    p.x <= Math.max(a.x, b.x) + eps &&
    p.y >= Math.min(a.y, b.y) - eps &&
    p.y <= Math.max(a.y, b.y) + eps
  );
}

function segmentsCross(p1: XyPoint, p2: XyPoint, p3: XyPoint, p4: XyPoint, eps: number): boolean {
  const d1 = cross2(p4.x - p3.x, p4.y - p3.y, p1.x - p3.x, p1.y - p3.y);
  const d2 = cross2(p4.x - p3.x, p4.y - p3.y, p2.x - p3.x, p2.y - p3.y);
  const d3 = cross2(p2.x - p1.x, p2.y - p1.y, p3.x - p1.x, p3.y - p1.y);
  const d4 = cross2(p2.x - p1.x, p2.y - p1.y, p4.x - p1.x, p4.y - p1.y);
  const straddles = (u: number, v: number): boolean => (u > eps && v < -eps) || (u < -eps && v > eps);
  if (straddles(d1, d2) && straddles(d3, d4)) return true;
  // A sign test alone misses a folded-back, exactly-collinear overlap, where
  // every cross product is zero — checked here by range instead of sign.
  if (Math.abs(d1) <= eps && onSegment(p3, p4, p1, eps)) return true;
  if (Math.abs(d2) <= eps && onSegment(p3, p4, p2, eps)) return true;
  if (Math.abs(d3) <= eps && onSegment(p1, p2, p3, eps)) return true;
  if (Math.abs(d4) <= eps && onSegment(p1, p2, p4, eps)) return true;
  return false;
}

/**
 * Area, perimeter, centroid and winding direction of a closed field boundary,
 * by the shoelace formula.
 *
 * **Points are translated to the first vertex before any product is
 * formed.** Real cadastral eastings run to seven-figure metres, and the
 * shoelace cross products land near 10¹³ there — right where the two
 * decimal digits this tool promises get eaten by subtraction. Self-crossing
 * boundaries are refused outright: the shoelace sum over a bow-tie is a
 * difference of two areas that looks like an ordinary answer.
 */
export function polygonArea(input: PolygonAreaInput): ProResult<PolygonAreaResult> {
  const raw = input.vertices;
  if (!isIntegerIn(raw.length, 3, 512)) return fail("vertices");
  for (const [i, v] of raw.entries()) {
    if (!Number.isFinite(v.a) || !Number.isFinite(v.b)) return fail(`vertices:${i}`);
  }
  const first = raw[0];
  if (first === undefined) return fail("vertices");
  const last = raw[raw.length - 1];
  const trimmed =
    raw.length > 3 && last !== undefined && last.a === first.a && last.b === first.b ? raw.slice(0, -1) : raw;
  if (!isIntegerIn(trimmed.length, 3, 512)) return fail("vertices");

  // (x, y) = (first column, second column) IN BOTH column orders — this is
  // the binding correction over the tool's own main computation text, which
  // read the default Y,X order the other way round and inverted the winding
  // sign. In the default „Y X" (geodetic) entry, Y — the FIRST column — is
  // itself the abscissa (east: geodetic Y = math x, geodetic X = math y,
  // since geodetic X points north = math "up"). In „X,Y" (mathematical)
  // entry the first column is already the abscissa by definition. Area and
  // perimeter do not care which axis is which, but a straight vs a swapped
  // (x,y) reading is a MIRROR of the plane and flips cw/ccw — the only
  // reason this mapping matters at all. Because the FIRST column is always
  // the abscissa (x) under both orders, the centroid below is ALREADY in the
  // order the user typed once it is echoed as (cx, cy) — `columnOrder` needs
  // no separate swap here; swapping it would hand back a=X to a user who
  // typed Y first.
  const toXY = (v: PolygonVertex): XyPoint => ({ x: v.a, y: v.b });
  const origin = toXY(first);
  const points: XyPoint[] = trimmed.map((v) => {
    const p = toXY(v);
    return { x: p.x - origin.x, y: p.y - origin.y };
  });

  const n = points.length;
  let maxAbs = 1;
  for (const p of points) maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
  const eps = maxAbs * 1e-9;

  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    for (let k = i + 1; k < n; k += 1) {
      const l = (k + 1) % n;
      if (k === i || k === j || l === i || l === j) continue;
      const pi = points[i];
      const pj = points[j];
      const pk = points[k];
      const pl = points[l];
      if (pi === undefined || pj === undefined || pk === undefined || pl === undefined) continue;
      if (segmentsCross(pi, pj, pk, pl, eps)) return fail(`intersect:${i}:${k}`);
    }
  }

  let signedArea2 = 0;
  let perimeter = 0;
  let cxSum = 0;
  let cySum = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const p = points[i];
    const q = points[j];
    if (p === undefined || q === undefined) continue;
    const c = p.x * q.y - q.x * p.y;
    signedArea2 += c;
    cxSum += (p.x + q.x) * c;
    cySum += (p.y + q.y) * c;
    perimeter += Math.hypot(q.x - p.x, q.y - p.y);
  }

  const areaM2 = Math.abs(signedArea2) / 2;
  let centroid: PolygonVertex | undefined;
  if (signedArea2 !== 0) {
    const cx = cxSum / (3 * signedArea2) + origin.x;
    const cy = cySum / (3 * signedArea2) + origin.y;
    // Unconditional: cx is already the value of whichever column the user
    // typed FIRST (see the toXY comment above), so echoing (cx, cy) is
    // already in the order the user typed, under BOTH column orders.
    centroid = { a: cx, b: cy };
  }

  return {
    ok: true,
    areaM2,
    areaAr: areaM2 / AR_M2,
    areaHa: areaM2 / HECTARE_M2,
    perimeterM: perimeter,
    centroid,
    winding: signedArea2 > 0 ? "ccw" : "cw",
  };
}

/* ---------------------------------------------------------------------------
 * seeding-rate — „Setvena norma"
 * ------------------------------------------------------------------------ */

export type SeedStandMode = "perM2" | "perHa";
export type SeedPriceMode = "perKg" | "perUnit";

export interface SeedingRateInput {
  readonly standMode: SeedStandMode;
  readonly standValue: number;
  readonly tkwGrams: number;
  readonly germinationPercent: number;
  readonly purityPercent: number;
  readonly fieldLossPercent: number;
  readonly areaHa: number;
  readonly bagMassKg: number;
  readonly rowSpacingCm?: number | undefined;
  readonly seedsPerUnit?: number | undefined;
  readonly priceMode?: SeedPriceMode | undefined;
  readonly pricePerKg?: number | undefined;
  readonly pricePerUnit?: number | undefined;
}

export interface SeedingRateResult {
  readonly normKgHa: number;
  readonly seedsPerM2: number;
  readonly seedsPerHa: number;
  readonly totalSeedKg: number;
  readonly bagsExact: number;
  readonly bagsCeil: number;
  readonly totalSeeds: number;
  readonly unitsExact: number | undefined;
  readonly unitsCeil: number | undefined;
  readonly seedsPerLinearMeter: number | undefined;
  readonly spacingInRowCm: number | undefined;
  /** The same formula applied to the norm just computed — informational, not an independent check. */
  readonly reverseStandCheckPerM2: number;
  readonly totalCost: number | undefined;
}

/**
 * Seeding rate in kg/ha, seed count and bag/unit count, from a target stand
 * and the seed lot's own TKW, germination and purity.
 *
 * **Germination and purity are percentages, not fractions** — a value under
 * 1 is refused rather than silently treated as 1 %, because 0.92 typed where
 * 92 was meant is the single most common transcription error this tool sees.
 */
export function seedingRate(input: SeedingRateInput): ProResult<SeedingRateResult> {
  if (!isInRange(input.standValue, 1, input.standMode === "perM2" ? 1000 : 1000 * HECTARE_M2)) {
    return fail("standValue");
  }
  if (!isInRange(input.tkwGrams, 0.05, 2000)) return fail("tkwGrams");
  if (!isInRange(input.germinationPercent, 1, 100)) return fail("germinationPercent");
  if (!isInRange(input.purityPercent, 1, 100)) return fail("purityPercent");
  if (!isInRange(input.fieldLossPercent, 0, 60)) return fail("fieldLossPercent");
  if (!isPositive(input.areaHa)) return fail("areaHa");
  if (!isPositive(input.bagMassKg)) return fail("bagMassKg");
  if (input.rowSpacingCm !== undefined && !isPositive(input.rowSpacingCm)) return fail("rowSpacingCm");
  if (input.seedsPerUnit !== undefined && !isPositive(input.seedsPerUnit)) return fail("seedsPerUnit");
  if (input.pricePerKg !== undefined && !isNonNegative(input.pricePerKg)) return fail("pricePerKg");
  if (input.pricePerUnit !== undefined && !isNonNegative(input.pricePerUnit)) return fail("pricePerUnit");

  const standPerM2 = input.standMode === "perHa" ? input.standValue / HECTARE_M2 : input.standValue;
  const f = (input.germinationPercent / 100) * (input.purityPercent / 100) * (1 - input.fieldLossPercent / 100);
  if (f <= 0) return fail("fieldLossPercent");

  const seedsPerM2 = standPerM2 / f;
  const normKgHa = (standPerM2 * input.tkwGrams) / (100 * f);
  const seedsPerHa = seedsPerM2 * HECTARE_M2;
  const totalSeedKg = normKgHa * input.areaHa;
  const bagsExact = totalSeedKg / input.bagMassKg;
  const totalSeeds = seedsPerHa * input.areaHa;
  const unitsExact = input.seedsPerUnit === undefined ? undefined : totalSeeds / input.seedsPerUnit;

  let seedsPerLinearMeter: number | undefined;
  let spacingInRowCm: number | undefined;
  if (input.rowSpacingCm !== undefined) {
    seedsPerLinearMeter = seedsPerM2 * (input.rowSpacingCm / 100);
    spacingInRowCm = 100 / seedsPerLinearMeter;
  }

  let totalCost: number | undefined;
  if (input.priceMode === "perKg" && input.pricePerKg !== undefined) {
    totalCost = totalSeedKg * input.pricePerKg;
  } else if (input.priceMode === "perUnit" && input.pricePerUnit !== undefined && unitsExact !== undefined) {
    totalCost = unitsExact * input.pricePerUnit;
  }

  return {
    ok: true,
    normKgHa,
    seedsPerM2,
    seedsPerHa,
    totalSeedKg,
    bagsExact,
    bagsCeil: Math.ceil(bagsExact),
    totalSeeds,
    unitsExact,
    unitsCeil: unitsExact === undefined ? undefined : Math.ceil(unitsExact),
    seedsPerLinearMeter,
    spacingInRowCm,
    reverseStandCheckPerM2: (normKgHa * 100 * f) / input.tkwGrams,
    totalCost,
  };
}

/* ---------------------------------------------------------------------------
 * sprayer-calibration — „Kalibracija prskalice"
 * ------------------------------------------------------------------------ */

export type NozzleFlowSource =
  | { readonly mode: "direct"; readonly flowLMin: number }
  | { readonly mode: "catch"; readonly volumeMl: number };

export interface SprayerCalibrationInput {
  readonly nozzleFlow: NozzleFlowSource;
  readonly nozzleSpacingM: number;
  readonly nozzleCount?: number | undefined;
  readonly workingWidthM?: number | undefined;
  readonly speedKmh: number;
  readonly catchTimeS: number;
  readonly targetRateLHa?: number | undefined;
  readonly tankVolumeL?: number | undefined;
}

export interface SprayerCalibrationResult {
  readonly nozzleFlowLMin: number;
  readonly rateFromSpacingLHa: number;
  readonly totalFlowLMin: number | undefined;
  readonly widthFromCountM: number | undefined;
  /** workingWidthM − nozzleCount·nozzleSpacingM, m — undefined unless both are
   * entered. A plain difference, not a verdict: this is a `life-safety` tool,
   * so no pass/fail threshold is baked in here — the surface decides what
   * counts as a mismatch worth flagging. */
  readonly widthDifferenceM: number | undefined;
  readonly rateFromCountWidthLHa: number | undefined;
  readonly requiredNozzleFlowLMin: number | undefined;
  readonly expectedCatchVolumeMl: number | undefined;
  readonly ratioPercent: number | undefined;
  readonly coverageHaPerTank: number | undefined;
  readonly distancePerTankM: number | undefined;
}

/**
 * Spray rate in L/ha from a caught nozzle flow, boom spacing and travel
 * speed — and, given a label rate, the flow that rate needs.
 *
 * **Spacing and working-width are never silently reconciled.** Entering both
 * `nozzleCount×nozzleSpacingM` and a separately measured `workingWidthM` is
 * accepted, and both resulting rates are always returned side by side along
 * with their plain difference (`widthDifferenceM`) rather than one of the two
 * being silently picked — a mistyped boom width would otherwise produce a
 * confident, wrong rate. No mismatch tolerance is baked in here: this is a
 * `life-safety` tool, so the difference is a quantity, never a verdict.
 */
export function sprayerCalibration(input: SprayerCalibrationInput): ProResult<SprayerCalibrationResult> {
  if (!isInRange(input.nozzleSpacingM, 0.1, 2)) return fail("nozzleSpacingM");
  if (!isInRange(input.speedKmh, 0.5, 30)) return fail("speedKmh");
  if (!isPositive(input.catchTimeS)) return fail("catchTimeS");
  if (input.nozzleCount !== undefined && !isIntegerIn(input.nozzleCount, 1, 200)) return fail("nozzleCount");
  if (input.workingWidthM !== undefined && !isPositive(input.workingWidthM)) return fail("workingWidthM");
  if (input.targetRateLHa !== undefined && !isInRange(input.targetRateLHa, 20, 2000)) return fail("targetRateLHa");
  if (input.tankVolumeL !== undefined && !isPositive(input.tankVolumeL)) return fail("tankVolumeL");

  let nozzleFlowLMin: number;
  if (input.nozzleFlow.mode === "direct") {
    if (!isInRange(input.nozzleFlow.flowLMin, 0.05, 20)) return fail("nozzleFlowLMin");
    nozzleFlowLMin = input.nozzleFlow.flowLMin;
  } else {
    if (!isPositive(input.nozzleFlow.volumeMl)) return fail("catchVolumeMl");
    nozzleFlowLMin = (input.nozzleFlow.volumeMl / 1000) * (60 / input.catchTimeS);
  }

  const rateFromSpacingLHa = (600 * nozzleFlowLMin) / (input.speedKmh * input.nozzleSpacingM);

  const totalFlowLMin = input.nozzleCount === undefined ? undefined : input.nozzleCount * nozzleFlowLMin;
  const widthFromCountM = input.nozzleCount === undefined ? undefined : input.nozzleCount * input.nozzleSpacingM;
  const widthDifferenceM =
    input.workingWidthM !== undefined && widthFromCountM !== undefined
      ? input.workingWidthM - widthFromCountM
      : undefined;
  const effectiveWidthM = input.workingWidthM ?? widthFromCountM;
  const rateFromCountWidthLHa =
    totalFlowLMin === undefined || effectiveWidthM === undefined
      ? undefined
      : (600 * totalFlowLMin) / (input.speedKmh * effectiveWidthM);

  let requiredNozzleFlowLMin: number | undefined;
  let expectedCatchVolumeMl: number | undefined;
  let ratioPercent: number | undefined;
  if (input.targetRateLHa !== undefined) {
    requiredNozzleFlowLMin = (input.targetRateLHa * input.speedKmh * input.nozzleSpacingM) / 600;
    expectedCatchVolumeMl = (requiredNozzleFlowLMin * input.catchTimeS * 1000) / 60;
    const ratio = ratioAgainst(rateFromSpacingLHa, input.targetRateLHa);
    ratioPercent = ratio === undefined ? undefined : ratio * 100;
  }

  const coverageHaPerTank = input.tankVolumeL === undefined ? undefined : input.tankVolumeL / rateFromSpacingLHa;
  const distancePerTankM =
    coverageHaPerTank === undefined || effectiveWidthM === undefined
      ? undefined
      : (coverageHaPerTank * HECTARE_M2) / effectiveWidthM;

  return {
    ok: true,
    nozzleFlowLMin,
    rateFromSpacingLHa,
    totalFlowLMin,
    widthFromCountM,
    widthDifferenceM,
    rateFromCountWidthLHa,
    requiredNozzleFlowLMin,
    expectedCatchVolumeMl,
    ratioPercent,
    coverageHaPerTank,
    distancePerTankM,
  };
}

/* ---------------------------------------------------------------------------
 * tank-mix-dose — „Doza po rezervoaru"
 * ------------------------------------------------------------------------ */

export type TankMixUnit = "l" | "kg";
export type TankMixDoseMode =
  | { readonly mode: "perHectare"; readonly value: number }
  | { readonly mode: "concentrationPercent"; readonly percent: number }
  | { readonly mode: "concentrationPerLiter"; readonly perLiter: number };

export interface TankMixProductInput {
  readonly name: string;
  readonly unit: TankMixUnit;
  readonly dose: TankMixDoseMode;
}

export interface TankMixInput {
  readonly products: readonly TankMixProductInput[];
  readonly sprayRateLHa: number;
  readonly tankVolumeL: number;
  readonly areaHa: number;
}

export interface TankMixProductResult {
  readonly name: string;
  readonly unit: TankMixUnit;
  readonly doseKgOrLPerHa: number;
  readonly perFullTankAmount: number;
  readonly totalAmount: number;
  readonly remainderAmount: number;
  readonly concentrationFraction: number;
  readonly concentrationPercent: number;
  /** `"l"` doses are volume/volume; `"kg"` doses are mass/volume — never the same physical percentage. */
  readonly concentrationBasis: "volumeVolume" | "massVolume";
  readonly perLiterAmount: number;
}

export interface TankMixResult {
  readonly products: readonly TankMixProductResult[];
  readonly fullTankAreaHa: number;
  readonly totalSprayVolumeL: number;
  readonly fillsExact: number;
  readonly fullFills: number;
  readonly remainderVolumeL: number;
  readonly remainderAreaHa: number;
  /** tankVolumeL minus every LIQUID product's per-tank amount — solids do not reduce it. */
  readonly fullTankCarrierL: number;
  readonly totalCarrierL: number;
}

/**
 * Per-tank and total quantities for one or more tank-mixed products, from a
 * per-hectare or concentration dose and the sprayer's own spray rate.
 *
 * **„Ukupna zapremina vode" is renamed `totalCarrierL` and computed, not
 * assumed equal to the spray volume** — a litre-dosed product occupies part
 * of the tank itself, so the carrier is the spray-mix volume MINUS every
 * liquid product's own volume; a kilogram-dosed product does not subtract.
 */
export function tankMixDose(input: TankMixInput): ProResult<TankMixResult> {
  if (!isIntegerIn(input.products.length, 1, 10)) return fail("products");
  if (!isInRange(input.sprayRateLHa, 20, 2000)) return fail("sprayRateLHa");
  if (!isPositive(input.tankVolumeL)) return fail("tankVolumeL");
  if (!isPositive(input.areaHa)) return fail("areaHa");

  const fullTankAreaHa = input.tankVolumeL / input.sprayRateLHa;
  const totalSprayVolumeL = input.sprayRateLHa * input.areaHa;
  const fillsExact = totalSprayVolumeL / input.tankVolumeL;
  // floorSnapped: an exact fill count (e.g. 200 l/ha over 72.6 ha into a
  // 440 l tank, i.e. 14520/440 = 33 on paper) frequently lands one ULP below
  // the whole number in double precision, and a bare floor reports one fewer
  // full tank than actually fits — on a life-safety tool this is the fill
  // schedule the operator follows, not a cosmetic rounding.
  const fullFills = floorSnapped(fillsExact);
  const remainderVolumeL = totalSprayVolumeL - fullFills * input.tankVolumeL;
  const remainderAreaHa = remainderVolumeL / input.sprayRateLHa;

  const products: TankMixProductResult[] = [];
  for (const [i, p] of input.products.entries()) {
    let dose: number;
    if (p.dose.mode === "perHectare") {
      if (!isPositive(p.dose.value)) return fail(`dose:${i}`);
      dose = p.dose.value;
    } else if (p.dose.mode === "concentrationPercent") {
      if (!isPositive(p.dose.percent)) return fail(`dose:${i}`);
      dose = (p.dose.percent / 100) * input.sprayRateLHa;
    } else {
      if (!isPositive(p.dose.perLiter)) return fail(`dose:${i}`);
      dose = (p.dose.perLiter / 1000) * input.sprayRateLHa;
    }
    const concentrationFraction = dose / input.sprayRateLHa;
    products.push({
      name: p.name,
      unit: p.unit,
      doseKgOrLPerHa: dose,
      perFullTankAmount: dose * fullTankAreaHa,
      totalAmount: dose * input.areaHa,
      remainderAmount: dose * remainderAreaHa,
      concentrationFraction,
      concentrationPercent: concentrationFraction * 100,
      concentrationBasis: p.unit === "l" ? "volumeVolume" : "massVolume",
      perLiterAmount: (dose * 1000) / input.sprayRateLHa,
    });
  }

  const liquidPerTank = products.filter((p) => p.unit === "l").reduce((s, p) => s + p.perFullTankAmount, 0);
  const liquidTotal = products.filter((p) => p.unit === "l").reduce((s, p) => s + p.totalAmount, 0);

  return {
    ok: true,
    products,
    fullTankAreaHa,
    totalSprayVolumeL,
    fillsExact,
    fullFills,
    remainderVolumeL,
    remainderAreaHa,
    fullTankCarrierL: input.tankVolumeL - liquidPerTank,
    totalCarrierL: totalSprayVolumeL - liquidTotal,
  };
}

/* ---------------------------------------------------------------------------
 * yield-estimate-samples — „Procena prinosa"
 * ------------------------------------------------------------------------ */

export type YieldMethod = "smallGrain" | "rowCrop" | "measuredArea";

export type YieldSample =
  | { readonly method: "smallGrain"; readonly earsPerM2: number; readonly grainsPerEar: number }
  | { readonly method: "rowCrop"; readonly plantsPerHa: number; readonly earsPerPlant: number; readonly grainsPerEar: number }
  | { readonly method: "measuredArea"; readonly sampleAreaM2: number; readonly sampleMassKg: number };

export interface YieldEstimateInput {
  readonly samples: readonly YieldSample[];
  readonly tkwGrams: number;
  /** Moisture the TKW mass was itself measured at — the basis the reference
   * conversion adjusts FROM for `smallGrain`/`rowCrop` (counting) samples. */
  readonly tkwMoisturePercent?: number | undefined;
  /** Moisture of the weighed cut itself — the basis for `measuredArea`
   * samples. A DIFFERENT physical quantity from `tkwMoisturePercent`: the
   * counting methods carry the TKW's own moisture, not the moisture of
   * whatever was actually cut and weighed, and the two are never interchanged. */
  readonly sampleMoisturePercent?: number | undefined;
  readonly referenceMoisturePercent?: number | undefined;
  readonly harvestLossPercent?: number | undefined;
  readonly plotAreaHa: number;
}

export interface YieldEstimateResult {
  readonly sampleYieldsTHa: readonly number[];
  readonly meanTHa: number;
  readonly minTHa: number;
  readonly maxTHa: number;
  readonly stdDevTHa: number | undefined;
  readonly coefficientOfVariationPercent: number | undefined;
  readonly standardErrorTHa: number | undefined;
  readonly meanAtReferenceMoistureTHa: number | undefined;
  readonly meanAfterLossTHa: number;
  readonly totalYieldT: number;
  readonly sampleCount: number;
}

/**
 * Per-hectare yield from counted samples — ears/grains, plant/row counts, or
 * a weighed harvest cut — averaged AFTER converting each sample, not before.
 *
 * **`mean(K)·mean(Z) ≠ mean(K·Z)`**: averaging the raw counts and then
 * multiplying is a different, wrong number from multiplying per sample and
 * then averaging, so every sample is converted to t/ha on its own first.
 *
 * **The reference-moisture conversion uses a DIFFERENT „from" moisture per
 * method**: a `smallGrain`/`rowCrop` sample's mass came from TKW × a count,
 * so it carries the moisture the TKW itself was weighed at
 * (`tkwMoisturePercent`); a `measuredArea` sample is a weighed cut, whose
 * moisture is whatever `sampleMoisturePercent` says, a physically different
 * number. Mixing the two would adjust a sample from a moisture basis that
 * describes a different sample entirely.
 */
export function yieldEstimateSamples(input: YieldEstimateInput): ProResult<YieldEstimateResult> {
  if (!isIntegerIn(input.samples.length, 1, 50)) return fail("samples");
  if (!isInRange(input.tkwGrams, 0.05, 2000)) return fail("tkwGrams");
  if (input.tkwMoisturePercent !== undefined && !isInRange(input.tkwMoisturePercent, 0, 60)) {
    return fail("tkwMoisturePercent");
  }
  if (input.sampleMoisturePercent !== undefined && !isInRange(input.sampleMoisturePercent, 0, 60)) {
    return fail("sampleMoisturePercent");
  }
  if (input.referenceMoisturePercent !== undefined && !isInRange(input.referenceMoisturePercent, 0, 60)) {
    return fail("referenceMoisturePercent");
  }
  if (input.harvestLossPercent !== undefined && !isInRange(input.harvestLossPercent, 0, 100)) {
    return fail("harvestLossPercent");
  }
  if (!isPositive(input.plotAreaHa)) return fail("plotAreaHa");

  const yields: number[] = [];
  for (const [i, s] of input.samples.entries()) {
    if (s.method === "smallGrain") {
      if (!isInRange(s.earsPerM2, 1, 2000)) return fail(`earsPerM2:${i}`);
      if (!isInRange(s.grainsPerEar, 1, 200)) return fail(`grainsPerEar:${i}`);
      yields.push((s.earsPerM2 * s.grainsPerEar * input.tkwGrams) / 100000);
    } else if (s.method === "rowCrop") {
      if (!isPositive(s.plantsPerHa)) return fail(`plantsPerHa:${i}`);
      if (!isPositive(s.earsPerPlant)) return fail(`earsPerPlant:${i}`);
      if (!isPositive(s.grainsPerEar)) return fail(`grainsPerEar:${i}`);
      const massPerPlantG = s.earsPerPlant * s.grainsPerEar * (input.tkwGrams / 1000);
      yields.push((s.plantsPerHa * massPerPlantG) / 1000000);
    } else {
      if (!isPositive(s.sampleAreaM2)) return fail(`sampleAreaM2:${i}`);
      if (!isPositive(s.sampleMassKg)) return fail(`sampleMassKg:${i}`);
      yields.push((s.sampleMassKg / s.sampleAreaM2) * 10);
    }
  }

  const n = yields.length;
  const mean = yields.reduce((s, v) => s + v, 0) / n;
  const min = Math.min(...yields);
  const max = Math.max(...yields);

  let stdDevTHa: number | undefined;
  let coefficientOfVariationPercent: number | undefined;
  let standardErrorTHa: number | undefined;
  if (n >= 2) {
    const sumSq = yields.reduce((s, v) => s + (v - mean) ** 2, 0);
    stdDevTHa = Math.sqrt(sumSq / (n - 1));
    standardErrorTHa = stdDevTHa / Math.sqrt(n);
    coefficientOfVariationPercent = mean === 0 ? undefined : (stdDevTHa / mean) * 100;
  }

  let meanAtReferenceMoistureTHa: number | undefined;
  if (input.referenceMoisturePercent !== undefined) {
    const adjusted: number[] = [];
    for (const [i, s] of input.samples.entries()) {
      const fromMoisture = s.method === "measuredArea" ? input.sampleMoisturePercent : input.tkwMoisturePercent;
      if (fromMoisture === undefined) {
        return fail(s.method === "measuredArea" ? "sampleMoisturePercent" : "tkwMoisturePercent");
      }
      const y = yields[i];
      if (y === undefined) return fail(`yield:${i}`);
      const adj = moistureAdjust(y, fromMoisture, input.referenceMoisturePercent);
      if (adj === undefined) return fail("referenceMoisturePercent");
      adjusted.push(adj);
    }
    meanAtReferenceMoistureTHa = adjusted.reduce((s, v) => s + v, 0) / adjusted.length;
  }

  const lossFactor = input.harvestLossPercent === undefined ? 1 : 1 - input.harvestLossPercent / 100;
  const meanAfterLossTHa = (meanAtReferenceMoistureTHa ?? mean) * lossFactor;

  return {
    ok: true,
    sampleYieldsTHa: yields,
    meanTHa: mean,
    minTHa: min,
    maxTHa: max,
    stdDevTHa,
    coefficientOfVariationPercent,
    standardErrorTHa,
    meanAtReferenceMoistureTHa,
    meanAfterLossTHa,
    totalYieldT: meanAfterLossTHa * input.plotAreaHa,
    sampleCount: n,
  };
}
