/**
 * „Zanat" — the arithmetic behind the crafts and trades toolkit.
 *
 * **One file per PACK.** See `pro/gradnja.ts` for the layout rule this follows.
 *
 * **Pure functions that refuse rather than repair.** A surface owns its own
 * state and formats nothing on its own; every number it shows comes from here,
 * and every test vector below is hand-worked rather than copied from a run.
 *
 * **Nothing here decides anything.** `glassPaneWeight` and `shelfDeflection`
 * are `life-safety`: they return a quantity and, where the user supplied their
 * own limit, the ratio against it — never a verdict, a colour or a word about
 * what the ratio means. Every other tool in this file may return whatever its
 * computation produces, but none of them holds a regulated constant either:
 * where a rule sets a number, that number is an input with no default.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isNonNegative,
  isPositive,
  ratioAgainst,
  type ProResult,
} from "./result.js";

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/* =============================================================================
 * fabric-yardage-repeat — „Tkanina i raport"
 * ========================================================================== */

export interface FabricPieceRow {
  /** Cut piece width, in cm — BEFORE seam allowance. */
  readonly width: number;
  /** Cut piece height, in cm — BEFORE seam allowance. */
  readonly height: number;
  readonly count: number;
}

export interface FabricYardageInput {
  readonly rows: readonly FabricPieceRow[];
  /** Usable roll width, in cm. */
  readonly rollWidth: number;
  /** Added to every edge of every piece, in cm. */
  readonly seamAllowance: number;
  /** Vertical (along-the-roll) pattern step, in cm. 0 = no pattern. */
  readonly verticalRepeat: number;
  /** Horizontal (across-the-roll) pattern step, in cm. 0 = no pattern, default 0. */
  readonly horizontalRepeat?: number | undefined;
  readonly waste: number;
  /** When true (the default) a piece may not be turned 90° to fit the roll. */
  readonly grainMandatory: boolean;
}

export interface FabricRowResult {
  /** width + 2×seam, in cm. */
  readonly cutWidth: number;
  /** height + 2×seam, in cm. */
  readonly cutHeight: number;
  readonly orientation: "normal" | "rotated";
  /**
   * Which of the two cut dimensions was rounded up to the horizontal repeat to
   * keep the pattern centred — undefined when there is no horizontal repeat.
   */
  readonly centeredDimension: "width" | "height" | undefined;
  /** The across-the-roll measure actually used, in cm — after any centering. */
  readonly acrossRoll: number;
  readonly piecesAcrossRoll: number;
  readonly cutRows: number;
  /** One row of the cut along the roll, in cm — rounded up to the vertical repeat. */
  readonly rowLength: number;
  /** One vertical repeat added once for this row type, because the roll never starts on the pattern. */
  readonly alignmentAllowance: number;
  /** cutRows × rowLength + alignmentAllowance, in cm — before waste. */
  readonly exactLength: number;
  /** This row type's own share of the total length, in m — WITH waste applied. */
  readonly usage: number;
  readonly usagePerPiece: number;
}

export interface FabricYardageResult {
  readonly rows: readonly FabricRowResult[];
  readonly totalLength: number;
  /** totalLength rounded UP to 0.1 m — fabric is not bought by the millimetre. */
  readonly orderLength: number;
  readonly usedArea: number;
  readonly usefulArea: number;
  readonly wasteArea: number;
}

interface FabricOrientationTrial {
  readonly acrossAdjusted: number;
  readonly alongRoll: number;
  readonly piecesAcrossRoll: number;
  readonly centeredDimension: "width" | "height" | undefined;
}

function tryFabricOrientation(
  orientation: "normal" | "rotated",
  cutWidth: number,
  cutHeight: number,
  rollWidth: number,
  horizontalRepeat: number,
): FabricOrientationTrial {
  const across = orientation === "normal" ? cutWidth : cutHeight;
  const alongRoll = orientation === "normal" ? cutHeight : cutWidth;
  const acrossAdjusted =
    horizontalRepeat > 0 ? Math.ceil(across / horizontalRepeat) * horizontalRepeat : across;
  const centeredDimension: "width" | "height" | undefined =
    horizontalRepeat > 0 ? (orientation === "normal" ? "width" : "height") : undefined;
  return {
    acrossAdjusted,
    alongRoll,
    piecesAcrossRoll: Math.floor(rollWidth / acrossAdjusted),
    centeredDimension,
  };
}

/**
 * Fabric consumption for a cutting list, with seam allowance and both a
 * vertical (along-the-roll) and a horizontal (across-the-roll) pattern repeat.
 *
 * **n_a is checked before it is ever divided by.** `rows = ceil(count/n_a)`
 * divides by zero the moment a piece is wider than the roll; that check runs
 * BEFORE the row count, for every candidate orientation, and only refuses when
 * NEITHER orientation admits even one piece across the roll.
 *
 * **The roll never starts on the pattern**, so one vertical repeat is added
 * once per row type as its own named figure (`alignmentAllowance`) rather than
 * folded into the waste percentage, which would hide a real, computable loss
 * behind an estimate.
 */
export function fabricYardageRepeat(input: FabricYardageInput): ProResult<FabricYardageResult> {
  const { rows, rollWidth, seamAllowance, verticalRepeat, waste, grainMandatory } = input;
  if (!isIntegerIn(rows.length, 1, 500)) return fail("rows");
  if (!isPositive(rollWidth) || rollWidth < 50 || rollWidth > 320) return fail("rollWidth");
  if (!isInRange(seamAllowance, 0, 20)) return fail("seamAllowance");
  if (!isInRange(verticalRepeat, 0, 120)) return fail("verticalRepeat");
  const horizontalRepeat = input.horizontalRepeat ?? 0;
  if (!isInRange(horizontalRepeat, 0, 160)) return fail("horizontalRepeat");
  if (!isInRange(waste, 0, 30)) return fail("waste");

  const results: FabricRowResult[] = [];
  let usefulArea = 0;

  for (const [index, row] of rows.entries()) {
    if (!isPositive(row.width)) return fail(`width:${index}`);
    if (!isPositive(row.height)) return fail(`height:${index}`);
    if (!isIntegerIn(row.count, 1, 500)) return fail(`count:${index}`);

    const cutWidth = row.width + 2 * seamAllowance;
    const cutHeight = row.height + 2 * seamAllowance;
    const normal = tryFabricOrientation("normal", cutWidth, cutHeight, rollWidth, horizontalRepeat);
    const rotated = grainMandatory
      ? undefined
      : tryFabricOrientation("rotated", cutWidth, cutHeight, rollWidth, horizontalRepeat);

    const normalFits = normal.piecesAcrossRoll >= 1;
    const rotatedFits = rotated !== undefined && rotated.piecesAcrossRoll >= 1;
    if (!normalFits && !rotatedFits) return fail(`acrossRoll:${index}`);

    const build = (
      orientation: "normal" | "rotated",
      trial: FabricOrientationTrial,
    ): FabricRowResult => {
      const cutRows = Math.ceil(row.count / trial.piecesAcrossRoll);
      const rowLength =
        verticalRepeat > 0
          ? Math.ceil(trial.alongRoll / verticalRepeat) * verticalRepeat
          : trial.alongRoll;
      const alignmentAllowance = verticalRepeat > 0 ? verticalRepeat : 0;
      const exactLength = cutRows * rowLength + alignmentAllowance;
      const usage = (exactLength * (1 + waste / 100)) / 100;
      return {
        cutWidth,
        cutHeight,
        orientation,
        centeredDimension: trial.centeredDimension,
        acrossRoll: trial.acrossAdjusted,
        piecesAcrossRoll: trial.piecesAcrossRoll,
        cutRows,
        rowLength,
        alignmentAllowance,
        exactLength,
        usage,
        usagePerPiece: usage / row.count,
      };
    };

    let chosen: FabricRowResult;
    if (normalFits && rotatedFits && rotated !== undefined) {
      const a = build("normal", normal);
      const b = build("rotated", rotated);
      chosen = a.exactLength <= b.exactLength ? a : b;
    } else if (normalFits) {
      chosen = build("normal", normal);
    } else {
      // rotatedFits is true here, and rotated is therefore defined.
      chosen = build("rotated", rotated as FabricOrientationTrial);
    }
    results.push(chosen);
    usefulArea += (row.width * row.height * row.count) / 10000;
  }

  const totalLength = results.reduce((sum, r) => sum + r.usage, 0);
  const orderLength = Math.ceil(totalLength * 10) / 10;
  const usedArea = totalLength * (rollWidth / 100);
  return {
    ok: true,
    rows: results,
    totalLength,
    orderLength,
    usedArea,
    usefulArea,
    wasteArea: usedArea - usefulArea,
  };
}

/* =============================================================================
 * glass-pane-weight — „Masa stakla" (life-safety)
 * ========================================================================== */

/** Density of PVB interlayer film, kg/m³ — gives 1.07 kg/m² per millimetre of thickness. */
const PVB_DENSITY = 1070;

export type GlassComposition = "monolithic" | "laminated" | "insulated";

export interface GlassPaneInput {
  readonly width: number;
  readonly height: number;
  readonly composition: GlassComposition;
  /**
   * Every glass ply's own thickness, in mm — one entry for `monolithic`, two
   * or more for `laminated`/`insulated`. The interspace of an insulated unit
   * carries no mass and is never one of these entries.
   */
  readonly plyThicknesses: readonly number[];
  /** PVB layers between the glass plies, `laminated` only. */
  readonly pvbLayers?: number | undefined;
  /** Thickness of ONE PVB layer, in mm — default 0.38. */
  readonly pvbLayerThickness?: number | undefined;
  readonly pieces?: number | undefined;
  /** kg/m³ — default 2500 (soda-lime float glass); a special glass is the user's own figure. */
  readonly density?: number | undefined;
}

export interface GlassPaneResult {
  readonly area: number;
  readonly totalArea: number;
  readonly massPerArea: number;
  readonly massPerPiece: number;
  readonly totalMass: number;
  readonly perimeter: number;
  readonly densityUsed: number;
  readonly pvbLayerThicknessUsed: number;
  readonly glassThicknessSum: number;
  readonly pvbThicknessSum: number;
}

/**
 * Mass of a glass pane — monolithic, laminated or insulated — from its plies
 * alone. Tempering does not change the density, so a tempered pane weighs
 * exactly what an annealed one of the same makeup does.
 *
 * **`life-safety`: this returns a QUANTITY, never a verdict.** No handling
 * class, no person count, no equipment recommendation, no comparison to any
 * limit — the tool holds no such limit and is never asked to judge the pane.
 *
 * **An empty or all-zero ply list is refused, not silently priced at 0 kg** —
 * a glass pane massing nothing is a wrong answer dressed as a real one.
 * **The total mass is taken from the UNROUNDED per-piece mass** — rounding
 * `massPerPiece` first and then multiplying by `pieces` compounds the rounding
 * error across every piece in the order.
 */
export function glassPaneWeight(input: GlassPaneInput): ProResult<GlassPaneResult> {
  const { width, height, composition, plyThicknesses } = input;
  if (!isInRange(width, 50, 6000)) return fail("width");
  if (!isInRange(height, 50, 6000)) return fail("height");
  const density = input.density ?? 2500;
  if (!isInRange(density, 2200, 3000)) return fail("density");
  const pieces = input.pieces ?? 1;
  if (!isIntegerIn(pieces, 1, 1000)) return fail("pieces");

  const glassThicknessSum = plyThicknesses.reduce((sum, t) => sum + t, 0);
  if (plyThicknesses.length === 0 || glassThicknessSum <= 0) return fail("plyThicknesses");
  for (const [index, t] of plyThicknesses.entries()) {
    if (!isInRange(t, 2, 25)) return fail(`plyThicknesses:${index}`);
  }
  if (composition === "monolithic" && plyThicknesses.length !== 1) return fail("plyThicknesses");
  if (composition !== "monolithic" && plyThicknesses.length < 2) return fail("plyThicknesses");

  const pvbLayers = input.pvbLayers ?? 0;
  if (!isIntegerIn(pvbLayers, 0, 8)) return fail("pvbLayers");
  if (composition !== "laminated" && pvbLayers > 0) return fail("pvbLayers");
  const pvbLayerThickness = input.pvbLayerThickness ?? 0.38;
  if (!isInRange(pvbLayerThickness, 0.1, 2)) return fail("pvbLayerThickness");
  const pvbThicknessSum = pvbLayers * pvbLayerThickness;

  const area = (width / 1000) * (height / 1000);
  const massPerArea = density * 1e-3 * glassThicknessSum + PVB_DENSITY * 1e-3 * pvbThicknessSum;
  const massPerPieceExact = area * massPerArea;
  const totalMassExact = massPerPieceExact * pieces;
  return {
    ok: true,
    area,
    totalArea: area * pieces,
    massPerArea,
    massPerPiece: massPerPieceExact,
    totalMass: totalMassExact,
    perimeter: 2 * (width + height) / 1000,
    densityUsed: density,
    pvbLayerThicknessUsed: pvbLayerThickness,
    glassThicknessSum,
    pvbThicknessSum,
  };
}

/* =============================================================================
 * iso-286-fits — „Tolerancije i naleganje"
 * ========================================================================== */

/**
 * ISO 286-1:2010 range boundaries, in mm. The FIRST range is closed at both
 * ends (1–3 mm inclusive); every later range is open at its lower bound and
 * closed at its upper one, so a nominal size sitting exactly on a boundary
 * belongs to the range below it — 30 mm reads IT7 from the 18–30 row, and
 * 30.5 mm from the 30–50 row, a full grade apart for half a millimetre.
 */
const ISO286_BOUNDARIES = [1, 3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500] as const;

/** IT5..IT12, µm, one row per ISO286_BOUNDARIES range. ISO 286-1:2010, table of standard tolerances. */
const ISO286_IT = [
  [4, 6, 10, 14, 25, 40, 60, 100],
  [5, 8, 12, 18, 30, 48, 75, 120],
  [6, 9, 15, 22, 36, 58, 90, 150],
  [8, 11, 18, 27, 43, 70, 110, 180],
  [9, 13, 21, 33, 52, 84, 130, 210],
  [11, 16, 25, 39, 62, 100, 160, 250],
  [13, 19, 30, 46, 74, 120, 190, 300],
  [15, 22, 35, 54, 87, 140, 220, 350],
  [18, 25, 40, 63, 100, 160, 250, 400],
  [20, 29, 46, 72, 115, 185, 290, 460],
  [23, 32, 52, 81, 130, 210, 320, 520],
  [25, 36, 57, 89, 140, 230, 360, 570],
  [27, 40, 63, 97, 155, 250, 400, 630],
] as const;

/** Basic (upper) deviation es for shafts d, e, f, g — µm, always negative. ISO 286-1:2010. */
const ISO286_SHAFT_ES = [
  [-20, -14, -6, -2],
  [-30, -20, -10, -4],
  [-40, -25, -13, -5],
  [-50, -32, -16, -6],
  [-65, -40, -20, -7],
  [-80, -50, -25, -9],
  [-100, -60, -30, -10],
  [-120, -72, -36, -12],
  [-145, -85, -43, -14],
  [-170, -100, -50, -15],
  [-190, -110, -56, -17],
  [-210, -125, -62, -18],
  [-230, -135, -68, -20],
] as const;

const ISO286_GRADES = [5, 6, 7, 8, 9, 10, 11, 12] as const;
const ISO286_LETTERS = ["d", "e", "f", "g"] as const;
export type Iso286ShaftLetter = "d" | "e" | "f" | "g" | "h";

function iso286RangeIndex(nominal: number): number | undefined {
  if (!isInRange(nominal, 1, 500)) return undefined;
  if (nominal <= 3) return 0;
  for (let i = 1; i < ISO286_BOUNDARIES.length - 1; i += 1) {
    const lo = ISO286_BOUNDARIES[i];
    const hi = ISO286_BOUNDARIES[i + 1];
    if (lo === undefined || hi === undefined) return undefined;
    if (nominal > lo && nominal <= hi) return i;
  }
  return undefined;
}

function iso286It(rangeIndex: number, grade: number): number | undefined {
  const gradeIndex = ISO286_GRADES.indexOf(grade as (typeof ISO286_GRADES)[number]);
  if (gradeIndex < 0) return undefined;
  return ISO286_IT[rangeIndex]?.[gradeIndex];
}

export interface Iso286Deviations {
  readonly upper: number;
  readonly lower: number;
}

export interface Iso286Input {
  readonly nominalSize: number;
  /** IT grade of the hole, IT5–IT12 — default 7 (H7). Ignored when `holeDeviations` is given. */
  readonly holeGrade?: number | undefined;
  /** Manual override for the hole's own upper/lower deviation, in µm, instead of an H letter. */
  readonly holeDeviations?: Iso286Deviations | undefined;
  readonly shaftLetter?: Iso286ShaftLetter | undefined;
  readonly shaftGrade?: number | undefined;
  /** Manual override for the shaft's own upper/lower deviation, in µm, instead of a letter+grade. */
  readonly shaftDeviations?: Iso286Deviations | undefined;
}

export interface Iso286PartResult {
  readonly upperDeviation: number;
  readonly lowerDeviation: number;
  readonly maxSize: number;
  readonly minSize: number;
  /** upper − lower, µm — the width of the tolerance zone. */
  readonly toleranceWidth: number;
  /** Midpoint of the tolerance zone, in mm — what a fixed tool is set to. */
  readonly meanSize: number;
}

export interface Iso286Result {
  readonly rangeLow: number;
  readonly rangeHigh: number;
  readonly hole: Iso286PartResult;
  readonly shaft: Iso286PartResult;
  /** ES − ei, µm. Negative means interference, not clearance — printed as a signed number. */
  readonly maxClearance: number;
  /** EI − es, µm. Negative means interference even at the tightest combination. */
  readonly minClearance: number;
  readonly meanClearance: number;
  /** "H7/g6" when both sides used a letter+grade; undefined once either side was entered manually. */
  readonly fitDesignation: string | undefined;
}

/**
 * Limit sizes and running clearance for an ISO 286 hole/shaft pair.
 *
 * **The nominal size is looked up in a table, not a formula** — ISO 286 IS the
 * table, and the derivation from the tolerance unit `i` in the source
 * standard is a check on the table, not a substitute for it.
 *
 * **A clearance is signed and never judged.** With a manually entered
 * deviation the two parts can overlap; that prints as a negative clearance,
 * not a refusal and not a fit this tool did not offer.
 */
export function iso286Fit(input: Iso286Input): ProResult<Iso286Result> {
  const rangeIndex = iso286RangeIndex(input.nominalSize);
  if (rangeIndex === undefined) return fail("nominalSize");
  const lo = ISO286_BOUNDARIES[rangeIndex] as number;
  const hi = ISO286_BOUNDARIES[rangeIndex + 1] as number;

  let holeUpper: number;
  let holeLower: number;
  let holeGradeUsed: number | undefined;
  if (input.holeDeviations !== undefined) {
    const { upper, lower } = input.holeDeviations;
    if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper < lower) {
      return fail("holeDeviations");
    }
    holeUpper = upper;
    holeLower = lower;
  } else {
    const grade = input.holeGrade ?? 7;
    if (!isIntegerIn(grade, 5, 12)) return fail("holeGrade");
    const it = iso286It(rangeIndex, grade);
    if (it === undefined) return fail("holeGrade");
    holeUpper = it;
    holeLower = 0;
    holeGradeUsed = grade;
  }

  let shaftUpper: number;
  let shaftLower: number;
  let shaftLetterUsed: Iso286ShaftLetter | undefined;
  let shaftGradeUsed: number | undefined;
  if (input.shaftDeviations !== undefined) {
    const { upper, lower } = input.shaftDeviations;
    if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper < lower) {
      return fail("shaftDeviations");
    }
    shaftUpper = upper;
    shaftLower = lower;
  } else {
    if (input.shaftLetter === undefined) return fail("shaftLetter");
    if (input.shaftGrade === undefined || !isIntegerIn(input.shaftGrade, 5, 12)) {
      return fail("shaftGrade");
    }
    const it = iso286It(rangeIndex, input.shaftGrade);
    if (it === undefined) return fail("shaftGrade");
    if (input.shaftLetter === "h") {
      shaftUpper = 0;
    } else {
      const letterIndex = ISO286_LETTERS.indexOf(input.shaftLetter);
      const es = ISO286_SHAFT_ES[rangeIndex]?.[letterIndex];
      if (es === undefined) return fail("shaftLetter");
      shaftUpper = es;
    }
    shaftLower = shaftUpper - it;
    shaftLetterUsed = input.shaftLetter;
    shaftGradeUsed = input.shaftGrade;
  }

  const D = input.nominalSize;
  const hole: Iso286PartResult = {
    upperDeviation: holeUpper,
    lowerDeviation: holeLower,
    maxSize: D + holeUpper / 1000,
    minSize: D + holeLower / 1000,
    toleranceWidth: holeUpper - holeLower,
    meanSize: D + (holeUpper + holeLower) / 2000,
  };
  const shaft: Iso286PartResult = {
    upperDeviation: shaftUpper,
    lowerDeviation: shaftLower,
    maxSize: D + shaftUpper / 1000,
    minSize: D + shaftLower / 1000,
    toleranceWidth: shaftUpper - shaftLower,
    meanSize: D + (shaftUpper + shaftLower) / 2000,
  };
  const maxClearance = holeUpper - shaftLower;
  const minClearance = holeLower - shaftUpper;
  const fitDesignation =
    holeGradeUsed !== undefined && shaftLetterUsed !== undefined && shaftGradeUsed !== undefined
      ? `H${holeGradeUsed}/${shaftLetterUsed}${shaftGradeUsed}`
      : undefined;

  return {
    ok: true,
    rangeLow: lo,
    rangeHigh: hi,
    hole,
    shaft,
    maxClearance,
    minClearance,
    meanClearance: (maxClearance + minClearance) / 2,
    fitDesignation,
  };
}

/* =============================================================================
 * linear-cutting-stock — „Krojenje šipki"
 * ========================================================================== */

export interface CuttingStockItem {
  readonly length: number;
  readonly count: number;
}

export interface CuttingStockInput {
  readonly items: readonly CuttingStockItem[];
  readonly barLength: number;
  readonly kerf: number;
  readonly startWaste?: number | undefined;
  readonly endWaste?: number | undefined;
  /** A remnant shorter than this counts as waste rather than a usable offcut. Default 0. */
  readonly minUsableRemnant?: number | undefined;
}

export interface CuttingStockPiece {
  readonly length: number;
  /** From the very start of the bar, INCLUDING the start trim. */
  readonly start: number;
  readonly end: number;
}

export interface CuttingStockBar {
  readonly pieces: readonly CuttingStockPiece[];
  readonly usedLength: number;
  readonly remainder: number;
  readonly remainderUsable: boolean;
}

export interface CuttingStockResult {
  readonly bars: readonly CuttingStockBar[];
  readonly barCount: number;
  readonly usableLength: number;
  readonly totalCutLength: number;
  readonly totalPurchasedLength: number;
  readonly cutCount: number;
  readonly kerfLength: number;
  /** Every remnant counted as waste, including ones long enough to be usable. */
  readonly wasteIncludingUsable: number;
  readonly wasteIncludingUsablePercent: number;
  /** Waste with the usable remnants subtracted back out — the honest scrap figure. */
  readonly wasteExcludingUsable: number;
  readonly wasteExcludingUsablePercent: number;
  readonly usableRemnantLength: number;
  readonly lowerBoundBars: number;
}

/**
 * First-fit-decreasing bar cutting, deliberately conservative: a cut is
 * charged to the piece that needed it even when that piece lands flush with
 * the bar's end, because the model does not know in advance which piece that
 * will be.
 *
 * **Everything is done in whole tenths of a millimetre.** A float comparison
 * `remaining >= d + w` can fail on a cut that lands exactly at the usable
 * length, which is precisely the case a conservative model exists to get
 * right; integers under the hood remove the question entirely.
 *
 * **The usable length is checked before it is ever divided by**, and so is
 * every individual piece against it — a piece needing more than the bar can
 * ever give is named and refused before the loop starts, because inside the
 * loop it would open bars forever.
 */
export function linearCuttingStock(input: CuttingStockInput): ProResult<CuttingStockResult> {
  const { items, barLength, kerf } = input;
  if (!isIntegerIn(items.length, 1, 500)) return fail("items");
  if (!isInRange(barLength, 100, 24000)) return fail("barLength");
  if (!isInRange(kerf, 0, 15)) return fail("kerf");
  const startWaste = input.startWaste ?? 0;
  const endWaste = input.endWaste ?? 0;
  if (!isInRange(startWaste, 0, 500)) return fail("startWaste");
  if (!isInRange(endWaste, 0, 500)) return fail("endWaste");
  const minUsableRemnant = input.minUsableRemnant ?? 0;
  if (!isInRange(minUsableRemnant, 0, 5000)) return fail("minUsableRemnant");

  const toDeci = (mm: number): number => Math.round(mm * 10);
  const barDeci = toDeci(barLength);
  const kerfDeci = toDeci(kerf);
  const startDeci = toDeci(startWaste);
  const endDeci = toDeci(endWaste);
  const usableDeci = barDeci - startDeci - endDeci;
  if (usableDeci <= 0) return fail("usableLength");

  const pieces: number[] = [];
  for (const [index, item] of items.entries()) {
    if (!isInRange(item.length, 1, 24000)) return fail(`length:${index}`);
    if (!isIntegerIn(item.count, 1, 999)) return fail(`count:${index}`);
    const lengthDeci = toDeci(item.length);
    if (lengthDeci + kerfDeci > usableDeci) return fail(`length:${index}`);
    for (let i = 0; i < item.count; i += 1) pieces.push(lengthDeci);
  }
  pieces.sort((a, b) => b - a);

  interface BarDraft {
    used: number;
    pieces: { length: number; start: number; end: number }[];
  }
  const bars: BarDraft[] = [];
  for (const lengthDeci of pieces) {
    const needed = lengthDeci + kerfDeci;
    let bar = bars.find((b) => usableDeci - b.used >= needed);
    if (bar === undefined) {
      bar = { used: 0, pieces: [] };
      bars.push(bar);
    }
    const start = startDeci + bar.used;
    bar.pieces.push({ length: lengthDeci, start, end: start + lengthDeci });
    bar.used += needed;
  }

  const minUsableDeci = toDeci(minUsableRemnant);
  let totalCutDeci = 0;
  let cutCount = 0;
  let usableRemnantDeci = 0;
  const resultBars: CuttingStockBar[] = bars.map((b) => {
    const remainderDeci = usableDeci - b.used;
    const remainderUsable = remainderDeci >= minUsableDeci;
    if (remainderUsable) usableRemnantDeci += remainderDeci;
    for (const p of b.pieces) {
      totalCutDeci += p.length;
      cutCount += 1;
    }
    return {
      pieces: b.pieces.map((p) => ({ length: p.length / 10, start: p.start / 10, end: p.end / 10 })),
      usedLength: b.used / 10,
      remainder: remainderDeci / 10,
      remainderUsable,
    };
  });

  const barCount = bars.length;
  const totalPurchasedDeci = barCount * barDeci;
  const kerfLengthDeci = cutCount * kerfDeci;
  const wasteIncludingUsableDeci = totalPurchasedDeci - totalCutDeci;
  const wasteExcludingUsableDeci = wasteIncludingUsableDeci - usableRemnantDeci;
  const sumDW = totalCutDeci + kerfLengthDeci;
  const lowerBoundBars = Math.ceil(sumDW / usableDeci);

  return {
    ok: true,
    bars: resultBars,
    barCount,
    usableLength: usableDeci / 10,
    totalCutLength: totalCutDeci / 10,
    totalPurchasedLength: totalPurchasedDeci / 10,
    cutCount,
    kerfLength: kerfLengthDeci / 10,
    wasteIncludingUsable: wasteIncludingUsableDeci / 10,
    wasteIncludingUsablePercent: (wasteIncludingUsableDeci / totalPurchasedDeci) * 100,
    wasteExcludingUsable: wasteExcludingUsableDeci / 10,
    wasteExcludingUsablePercent: (wasteExcludingUsableDeci / totalPurchasedDeci) * 100,
    usableRemnantLength: usableRemnantDeci / 10,
    lowerBoundBars,
  };
}

/* =============================================================================
 * mitre-angles — „Gerung i složeni gerung"
 * ========================================================================== */

export interface MitreInput {
  /** Number of sides of a regular polygon frame — instead of `baseAngle`. */
  readonly sides?: number | undefined;
  /** The base angle θ directly, in degrees — instead of `sides`. */
  readonly baseAngle?: number | undefined;
  /** Slope of the side from vertical, in degrees. 0 = an upright, flat frame. Default 0. */
  readonly slope?: number | undefined;
  /** Spring angle from the wall, in degrees — used INSTEAD of `slope`, via slope = 90 − spring. */
  readonly springAngle?: number | undefined;
  readonly pieceWidth?: number | undefined;
  readonly insideLength?: number | undefined;
}

export interface MitreResult {
  readonly baseAngle: number;
  /** 90 − θ/2 — the flat-frame saw setting, and the reference the compound formula reduces to at slope 0. */
  readonly m0: number;
  readonly slopeUsed: number;
  /** θ/2 — the flat-frame mitre angle at the piece's own face. */
  readonly simpleMitre: number;
  /** The saw's mitre-gauge setting, degrees off the square, at slope 0 or above. */
  readonly sawMitreAngle: number;
  /** 90 − sawMitreAngle — the complementary reading some saw scales use instead. */
  readonly sawMitreComplement: number;
  /** The saw's bevel (blade tilt) setting, degrees. 0 at slope 0. */
  readonly sawBevelAngle: number;
  readonly tanM0: number;
  /**
   * False once m0 ≥ 85° — a caution, not a withholding. `outsideLength` is
   * still computed and returned; this only flags that tan(m0) has grown large
   * enough that the resulting length is impractical to cut to.
   */
  readonly lengthsAvailable: boolean;
  readonly outsideLength: number | undefined;
  readonly lengthToLongPoint: number | undefined;
  readonly lengthToShortPoint: number | undefined;
  readonly centeredMeasure: "outside width" | "outside height" | undefined;
}

/**
 * Mitre and, for a leaning side, the compound bevel — from a regular
 * polygon's side count or an arbitrary base angle.
 *
 * **The length formula projects the piece width through the slope.** A
 * leaning side's horizontal footprint is `w·cos(B)`, not `w` — the review
 * caught an earlier version of this formula that skipped the projection and
 * so over-stated every leaning frame's outside length.
 *
 * **Past m0 = 85° the lengths are still named, not withheld.** `tan(m0)` is
 * finite everywhere in this function's domain (m0 tops out at 89.5°, from
 * `baseAngle`'s own 1–179° range) — `lengthsAvailable` is a caution that the
 * figure is impractically large to cut to, never a reason to hide the number
 * the review clause requires (`tanM0` and the length it produces) behind
 * `undefined`.
 *
 * **`pieceWidth` and `insideLength` are validated and required together,
 * regardless of `lengthsAvailable`.** Giving one without the other, or one
 * out of range, is refused rather than silently producing no lengths.
 */
export function mitreAngles(input: MitreInput): ProResult<MitreResult> {
  let baseAngle: number;
  if (input.sides !== undefined && input.baseAngle !== undefined) return fail("sides");
  if (input.sides !== undefined) {
    if (!isIntegerIn(input.sides, 3, 48)) return fail("sides");
    baseAngle = ((input.sides - 2) * 180) / input.sides;
  } else if (input.baseAngle !== undefined) {
    if (!isInRange(input.baseAngle, 1, 179)) return fail("baseAngle");
    baseAngle = input.baseAngle;
  } else {
    return fail("sides");
  }

  let slope: number;
  if (input.springAngle !== undefined) {
    if (!isInRange(input.springAngle, 1, 89)) return fail("springAngle");
    slope = 90 - input.springAngle;
  } else {
    slope = input.slope ?? 0;
    if (!isInRange(slope, 0, 89)) return fail("slope");
  }

  const m0 = 90 - baseAngle / 2;
  const m0Rad = m0 * RAD_PER_DEG;
  const slopeRad = slope * RAD_PER_DEG;
  const sawMitreAngle = Math.atan(Math.cos(slopeRad) * Math.tan(m0Rad)) * DEG_PER_RAD;
  const sawBevelAngle = Math.asin(Math.sin(slopeRad) * Math.cos(m0Rad)) * DEG_PER_RAD;
  const tanM0 = Math.tan(m0Rad);
  const lengthsAvailable = m0 < 85;

  let outsideLength: number | undefined;
  let centeredMeasure: "outside width" | "outside height" | undefined;
  const wantsLengths = input.pieceWidth !== undefined || input.insideLength !== undefined;
  if (wantsLengths) {
    if (input.pieceWidth === undefined) return fail("pieceWidth");
    if (input.insideLength === undefined) return fail("insideLength");
    if (!isInRange(input.pieceWidth, 5, 500)) return fail("pieceWidth");
    if (!isInRange(input.insideLength, 10, 10000)) return fail("insideLength");
    outsideLength =
      input.insideLength + 2 * input.pieceWidth * Math.cos(slopeRad) * tanM0;
    centeredMeasure = "outside width";
  }

  return {
    ok: true,
    baseAngle,
    m0,
    slopeUsed: slope,
    simpleMitre: baseAngle / 2,
    sawMitreAngle,
    sawMitreComplement: 90 - sawMitreAngle,
    sawBevelAngle,
    tanM0,
    lengthsAvailable,
    outsideLength,
    lengthToLongPoint: outsideLength,
    lengthToShortPoint: outsideLength === undefined ? undefined : input.insideLength,
    centeredMeasure,
  };
}

/* =============================================================================
 * mortar-mix-quantity — „Malter i lepak"
 * ========================================================================== */

export type ConsumptionUnit = "perM2mm" | "perM3";

interface MortarVolumeInput {
  readonly area?: number | undefined;
  readonly volume?: number | undefined;
  readonly thickness?: number | undefined;
  readonly waste: number;
}

function mortarFreshVolume(input: MortarVolumeInput): ProResult<{ readonly volume: number }> {
  if (!isInRange(input.waste, 0, 30)) return fail("waste");
  if (input.volume !== undefined) {
    if (!isPositive(input.volume)) return fail("volume");
    return { ok: true, volume: input.volume * (1 + input.waste / 100) };
  }
  if (input.area === undefined || input.thickness === undefined) return fail("area");
  if (!isInRange(input.area, 0.1, 10000)) return fail("area");
  if (!isInRange(input.thickness, 1, 200)) return fail("thickness");
  return { ok: true, volume: input.area * (input.thickness / 1000) * (1 + input.waste / 100) };
}

export interface MortarPremixedInput {
  readonly mode: "premixed";
  readonly area: number;
  readonly thickness: number;
  readonly waste: number;
  readonly consumption: number;
  readonly consumptionUnit?: ConsumptionUnit | undefined;
  readonly bagMass: number;
  readonly waterPerKg: number;
}

export interface MortarOnsiteInput {
  readonly mode: "onsite";
  readonly area?: number | undefined;
  readonly volume?: number | undefined;
  readonly thickness?: number | undefined;
  readonly waste: number;
  readonly packingFactor: number;
  readonly ratio: number;
  readonly binderDensity: number;
  readonly aggregateDensity: number;
  readonly waterCementRatio: number;
  readonly bagMass: number;
  readonly aggregateMoisture?: number | undefined;
  /** Mixer or truck-mixer batch size, in litres. */
  readonly mixerVolume?: number | undefined;
}

export type MortarInput = MortarPremixedInput | MortarOnsiteInput;

export interface MortarPremixedResult {
  readonly mode: "premixed";
  readonly freshVolume: number;
  /** The unit the coverage rate was ENTERED in — printed alongside the converted `consumptionUsed`. */
  readonly consumptionUnitUsed: ConsumptionUnit;
  readonly consumptionUsed: number;
  readonly mass: number;
  readonly bags: number;
  readonly bagSurplus: number;
  readonly water: number;
}

export interface MortarOnsiteResult {
  readonly mode: "onsite";
  readonly freshVolume: number;
  /** Fresh volume × packing factor — the sum of the ingredient volumes. */
  readonly compactedVolume: number;
  readonly binderVolume: number;
  readonly aggregateVolume: number;
  readonly binderMass: number;
  readonly aggregateMass: number;
  readonly binderBags: number;
  readonly binderBagSurplus: number;
  /** Water called for by the water/cement ratio alone, before any moisture already in the sand. */
  readonly waterTheoretical: number;
  readonly aggregateMoistureWater: number | undefined;
  /** Water actually to add, floored at zero — never negative. */
  readonly water: number;
  readonly batches: number | undefined;
  readonly batchBinderMass: number | undefined;
  readonly batchAggregateMass: number | undefined;
  readonly batchAggregateVolume: number | undefined;
  readonly batchWater: number | undefined;
}

export type MortarResult = MortarPremixedResult | MortarOnsiteResult;

/**
 * Mortar or adhesive quantity — a bagged premix by coverage rate, or an
 * on-site mix by a chosen binder:aggregate ratio.
 *
 * **The packing factor is never assumed.** Fresh mortar occupies LESS volume
 * than the sum of its dry ingredients, because the binder paste fills the
 * gaps between aggregate grains — the factor that says by how much is a
 * property of the specific materials and is always the user's own figure.
 *
 * **Water already in the sand is subtracted, and never past zero.** A wet
 * aggregate can supply more water than the ratio calls for; when it does, the
 * water to add is 0, not a negative instruction.
 */
export function mortarMixQuantity(input: MortarInput): ProResult<MortarResult> {
  if (input.mode === "premixed") {
    const fresh = mortarFreshVolume(input);
    if (!fresh.ok) return fresh;
    if (!isPositive(input.consumption)) return fail("consumption");
    if (!isPositive(input.bagMass) || input.bagMass > 50) return fail("bagMass");
    if (!isInRange(input.waterPerKg, 0.05, 0.5)) return fail("waterPerKg");
    const unit = input.consumptionUnit ?? "perM2mm";
    const consumptionUsed = unit === "perM3" ? input.consumption / 1000 : input.consumption;
    if (!isInRange(consumptionUsed, 0.5, 3)) return fail("consumption");

    const mass = input.area * (1 + input.waste / 100) * consumptionUsed * input.thickness;
    const bags = Math.ceil(mass / input.bagMass);
    return {
      ok: true,
      mode: "premixed",
      freshVolume: fresh.volume,
      consumptionUnitUsed: unit,
      consumptionUsed,
      mass,
      bags,
      bagSurplus: bags * input.bagMass - mass,
      water: mass * input.waterPerKg,
    };
  }

  const fresh = mortarFreshVolume(input);
  if (!fresh.ok) return fresh;
  if (!isInRange(input.packingFactor, 1, 1.6)) return fail("packingFactor");
  if (!isInRange(input.ratio, 1, 10)) return fail("ratio");
  if (!isInRange(input.binderDensity, 800, 2000)) return fail("binderDensity");
  if (!isInRange(input.aggregateDensity, 1200, 2000)) return fail("aggregateDensity");
  if (!isInRange(input.waterCementRatio, 0.3, 1)) return fail("waterCementRatio");
  if (!isPositive(input.bagMass) || input.bagMass > 50) return fail("bagMass");
  if (input.aggregateMoisture !== undefined && !isInRange(input.aggregateMoisture, 0, 100)) {
    return fail("aggregateMoisture");
  }
  if (input.mixerVolume !== undefined && !isPositive(input.mixerVolume)) return fail("mixerVolume");

  const compactedVolume = fresh.volume * input.packingFactor;
  const binderVolume = compactedVolume / (1 + input.ratio);
  const aggregateVolume = (compactedVolume * input.ratio) / (1 + input.ratio);
  const binderMass = binderVolume * input.binderDensity;
  const aggregateMass = aggregateVolume * input.aggregateDensity;
  const binderBags = Math.ceil(binderMass / input.bagMass);
  const waterTheoretical = input.waterCementRatio * binderMass;
  const aggregateMoistureWater =
    input.aggregateMoisture === undefined
      ? undefined
      : aggregateMass * (input.aggregateMoisture / 100);
  const water = Math.max(0, waterTheoretical - (aggregateMoistureWater ?? 0));

  let batches: number | undefined;
  let batchBinderMass: number | undefined;
  let batchAggregateMass: number | undefined;
  let batchAggregateVolume: number | undefined;
  let batchWater: number | undefined;
  if (input.mixerVolume !== undefined) {
    batches = Math.ceil((compactedVolume * 1000) / input.mixerVolume);
    batchBinderMass = binderMass / batches;
    batchAggregateMass = aggregateMass / batches;
    batchAggregateVolume = aggregateVolume / batches;
    batchWater = water / batches;
  }

  return {
    ok: true,
    mode: "onsite",
    freshVolume: fresh.volume,
    compactedVolume,
    binderVolume,
    aggregateVolume,
    binderMass,
    aggregateMass,
    binderBags,
    binderBagSurplus: binderBags * input.bagMass - binderMass,
    waterTheoretical,
    aggregateMoistureWater,
    water,
    batches,
    batchBinderMass,
    batchAggregateMass,
    batchAggregateVolume,
    batchWater,
  };
}

/* =============================================================================
 * panel-cutting-yield — „Raskroj ploče"
 * ========================================================================== */

export interface PanelCuttingInput {
  readonly panelWidth: number;
  readonly panelHeight: number;
  readonly pieceWidth: number;
  readonly pieceHeight: number;
  readonly piecesNeeded: number;
  readonly kerf: number;
  /** Trimmed off EACH of the four edges, in mm. Default 0. */
  readonly edgeTrim?: number | undefined;
  /** When true, the piece may not be turned 90° — its grain direction is fixed. Default false. */
  readonly grainMandatory?: boolean | undefined;
}

export interface PanelStrip {
  readonly width: number;
  readonly height: number;
  readonly area: number;
}

export interface PanelCuttingResult {
  readonly piecesPerPanel: number;
  readonly panelsNeeded: number;
  readonly leftoverOnLastPanel: number;
  readonly yieldPercent: number;
  readonly wasteArea: number;
  readonly totalWasteArea: number;
  readonly rightStrip: PanelStrip;
  readonly bottomStrip: PanelStrip;
  readonly cutCount: number;
  /** Metres of guillotine cut on ONE panel — billed per running metre on a beam saw. */
  readonly cutLength: number;
  readonly totalCutLength: number;
}

interface PanelLayoutTrial {
  readonly total: number;
  readonly cols: number;
  readonly rows: number;
  readonly colWidth: number;
  readonly rowFullLength: number;
  readonly extraCuts: number;
  readonly extraLength: number;
  readonly rightStrip: { readonly width: number; readonly height: number };
  readonly bottomStrip: { readonly width: number; readonly height: number };
}

/** Guillotine cut count and length to divide a `cols × rows` grid, one cut per internal seam. */
function gridCuts(
  cols: number,
  rows: number,
  colWidth: number,
  fullLength: number,
): { readonly count: number; readonly length: number } {
  if (cols <= 0 || rows <= 0) return { count: 0, length: 0 };
  const count = (cols - 1) + cols * (rows - 1);
  const length = (cols - 1) * fullLength + cols * (rows - 1) * colWidth;
  return { count, length };
}

/**
 * What is left of a `fullWidth`-wide strip after `count` pieces of
 * `pieceWidth` (plus their kerfs, plus the trailing kerf) have been cut from
 * it — the same leftover-after-a-cut arithmetic `rA`/`rB` already use one
 * level up, applied to a strip instead of the whole panel.
 */
function residualStripWidth(fullWidth: number, pieceWidth: number, count: number, kerf: number): number {
  if (count <= 0) return fullWidth;
  return Math.max(0, fullWidth - (count * pieceWidth + (count - 1) * kerf) - kerf);
}

function panelLayoutFor(
  usableA: number,
  usableB: number,
  a: number,
  b: number,
  kerf: number,
): PanelLayoutTrial {
  const n1 = Math.floor((usableA + kerf) / (a + kerf));
  const m1 = Math.floor((usableB + kerf) / (b + kerf));
  const grid = n1 * m1;
  const rA = Math.max(0, usableA - (n1 * a + (n1 - 1) * kerf) - kerf);
  const rB = Math.max(0, usableB - (m1 * b + (m1 - 1) * kerf) - kerf);

  const nRd = Math.floor((rA + kerf) / (b + kerf));
  const mRd = Math.floor((usableB + kerf) / (a + kerf));
  const rightExtra = nRd * mRd;
  const rightCuts = gridCuts(nRd, mRd, b, usableB);

  const nBd = Math.floor((usableA + kerf) / (b + kerf));
  const mBd = Math.floor((rB + kerf) / (a + kerf));
  const bottomExtra = nBd * mBd;
  const bottomCuts = gridCuts(nBd, mBd, b, rB);

  const nC = Math.floor((usableA - rA) / (b + kerf));
  const mC = Math.floor((rB + kerf) / (a + kerf));
  const combinedExtra = rightExtra + nC * mC;
  const combinedCuts = gridCuts(nC, mC, b, rB);

  const mainCuts = gridCuts(n1, m1, a, usableB);
  const sepRight = rA > 0 ? { count: 1, length: usableB } : { count: 0, length: 0 };
  const sepBottom = rB > 0 ? { count: 1, length: usableA } : { count: 0, length: 0 };

  const candidates = [
    { kind: "grid" as const, total: grid, extraCuts: 0, extraLength: 0 },
    {
      kind: "right" as const,
      total: grid + rightExtra,
      extraCuts: sepRight.count + rightCuts.count,
      extraLength: sepRight.length + rightCuts.length,
    },
    {
      kind: "bottom" as const,
      total: grid + bottomExtra,
      extraCuts: sepBottom.count + bottomCuts.count,
      extraLength: sepBottom.length + bottomCuts.length,
    },
    {
      kind: "combined" as const,
      total: grid + combinedExtra,
      extraCuts: sepRight.count + sepBottom.count + rightCuts.count + combinedCuts.count,
      extraLength: sepRight.length + sepBottom.length + rightCuts.length + combinedCuts.length,
    },
  ];
  const best = candidates.reduce((a1, b1) => (b1.total > a1.total ? b1 : a1));

  // The reported strip shrinks to its genuine leftover ONLY along whichever
  // side the winning candidate actually drew extra pieces from — a strip the
  // winner never touched is reported at its full, untouched size, and a strip
  // it did cut from is never reported as both "pieces cut" AND "intact
  // remnant" at once.
  const rightStripWidth =
    best.kind === "right" || best.kind === "combined" ? residualStripWidth(rA, b, nRd, kerf) : rA;
  const bottomStripWidth =
    best.kind === "bottom"
      ? residualStripWidth(usableA, b, nBd, kerf)
      : best.kind === "combined"
        ? residualStripWidth(usableA - rA, b, nC, kerf)
        : usableA;

  return {
    total: best.total,
    cols: n1,
    rows: m1,
    colWidth: a,
    rowFullLength: usableB,
    extraCuts: mainCuts.count + best.extraCuts,
    extraLength: mainCuts.length + best.extraLength,
    rightStrip: { width: rightStripWidth, height: usableB },
    bottomStrip: { width: bottomStripWidth, height: rB },
  };
}

/**
 * How many pieces of one fixed format come out of one panel — the grid on
 * the panel's face, plus whatever the right-hand and bottom offcut strips
 * still hold — how many panels that takes, and the guillotine cuts it costs.
 *
 * **A fifth candidate uses BOTH offcut strips from the same grid at once**,
 * narrowing the bottom strip to the width the right strip has not already
 * claimed; taking the better of the two strips alone (the earlier version of
 * this tool) leaves real, cuttable pieces on the panel.
 *
 * **Every comparison runs on tenths of a millimetre**, because a floor
 * division at the true boundary of a fit is exactly where a float error
 * costs a whole extra piece.
 *
 * **`rightStrip`/`bottomStrip` report what is ACTUALLY left over from the
 * winning candidate**, not the base grid's strips unconditionally — a strip
 * the winner cut extra pieces from comes back narrowed by exactly what those
 * pieces used, so its area is never counted twice, once as pieces and once
 * as an intact remnant.
 */
export function panelCuttingYield(input: PanelCuttingInput): ProResult<PanelCuttingResult> {
  const { panelWidth, panelHeight, pieceWidth, pieceHeight, piecesNeeded, kerf } = input;
  if (!isInRange(panelWidth, 100, 6000)) return fail("panelWidth");
  if (!isInRange(panelHeight, 100, 6000)) return fail("panelHeight");
  if (!isInRange(pieceWidth, 10, 6000)) return fail("pieceWidth");
  if (!isInRange(pieceHeight, 10, 6000)) return fail("pieceHeight");
  if (!isIntegerIn(piecesNeeded, 1, 100000)) return fail("piecesNeeded");
  if (!isInRange(kerf, 0, 15)) return fail("kerf");
  const edgeTrim = input.edgeTrim ?? 0;
  if (!isInRange(edgeTrim, 0, 100)) return fail("edgeTrim");
  const grainMandatory = input.grainMandatory ?? false;

  const toDeci = (mm: number): number => Math.round(mm * 10);
  const A = toDeci(panelWidth) - 2 * toDeci(edgeTrim);
  const B = toDeci(panelHeight) - 2 * toDeci(edgeTrim);
  if (A <= 0 || B <= 0) return fail("edgeTrim");
  const a = toDeci(pieceWidth);
  const b = toDeci(pieceHeight);
  const w = toDeci(kerf);

  const position1 = panelLayoutFor(A, B, a, b, w);
  const position2 = grainMandatory ? undefined : panelLayoutFor(A, B, b, a, w);
  const best =
    position2 === undefined || position1.total >= position2.total ? position1 : position2;

  if (best.total === 0) return fail("pieceWidth");

  const panelsNeeded = Math.ceil(piecesNeeded / best.total);
  const yieldArea = best.total * pieceWidth * pieceHeight;
  const panelArea = panelWidth * panelHeight;
  return {
    ok: true,
    piecesPerPanel: best.total,
    panelsNeeded,
    leftoverOnLastPanel: panelsNeeded * best.total - piecesNeeded,
    yieldPercent: (yieldArea / panelArea) * 100,
    wasteArea: (panelArea - yieldArea) / 1e6,
    totalWasteArea: (panelsNeeded * (panelArea - yieldArea)) / 1e6,
    rightStrip: {
      width: best.rightStrip.width / 10,
      height: best.rightStrip.height / 10,
      area: (best.rightStrip.width * best.rightStrip.height) / 1e8,
    },
    bottomStrip: {
      width: best.bottomStrip.width / 10,
      height: best.bottomStrip.height / 10,
      area: (best.bottomStrip.width * best.bottomStrip.height) / 1e8,
    },
    cutCount: best.extraCuts,
    // extraLength is in tenths of a millimetre (mm × 10); ÷10000 gives metres,
    // matching the running-metre unit the formatter's shop-floor cost figure needs.
    cutLength: best.extraLength / 10000,
    totalCutLength: (panelsNeeded * best.extraLength) / 10000,
  };
}

/* =============================================================================
 * sheet-metal-bend — „Razvijena dužina lima"
 * ========================================================================== */

export interface SheetMetalBendInput {
  readonly thickness: number;
  readonly radius: number;
  /** Turn angle of the bend, in degrees — same for every bend in `legs`. */
  readonly angle: number;
  readonly kFactor: number;
  readonly legs: readonly number[];
  readonly legsAs: "outer" | "tangent";
}

export interface SheetMetalBendLine {
  readonly start: number;
  readonly end: number;
  readonly startFromOppositeEdge: number;
  readonly endFromOppositeEdge: number;
}

export interface SheetMetalBendResult {
  readonly bendAllowance: number;
  readonly bendDeduction: number;
  readonly setback: number;
  readonly developedLength: number;
  readonly bendLines: readonly SheetMetalBendLine[];
}

export interface SheetMetalKFactorInput {
  readonly thickness: number;
  readonly radius: number;
  readonly angle: number;
  /** The sample's OUTER leg measures as designed — used to derive the tangent legs and the setback. */
  readonly outerLegs: readonly number[];
  readonly measuredLength: number;
}

export interface SheetMetalKFactorResult {
  readonly kFactor: number;
  readonly thickness: number;
  readonly radius: number;
  readonly angle: number;
  readonly radiusToThickness: number;
}

function sheetMetalGeometry(
  thickness: number,
  radius: number,
  angle: number,
  kFactor: number,
): { readonly ba: number; readonly setback: number; readonly bd: number } {
  const angleRad = angle * RAD_PER_DEG;
  const ba = (Math.PI / 180) * angle * (radius + kFactor * thickness);
  const setback = (radius + thickness) * Math.tan(angleRad / 2);
  return { ba, setback, bd: 2 * setback - ba };
}

/**
 * Developed (flat) length of a sheet-metal part, from its bend allowance and
 * the outer or tangent-point leg measures — plus where each bend line lands.
 *
 * **A leg is checked against the setback it must clear before anything else
 * runs**: a middle leg touches two bends and an end leg touches one, so the
 * refusal compares the leg to `setback × 1` or `× 2` — never a bare setback
 * — before the tangent length it implies can go negative.
 */
export function sheetMetalBend(input: SheetMetalBendInput): ProResult<SheetMetalBendResult> {
  const { thickness, radius, angle, kFactor, legs, legsAs } = input;
  if (!isInRange(thickness, 0.1, 20)) return fail("thickness");
  if (!isInRange(radius, 0.1, 200)) return fail("radius");
  if (!isInRange(angle, 1, 179)) return fail("angle");
  if (!isInRange(kFactor, 0, 0.5)) return fail("kFactor");
  if (!isIntegerIn(legs.length, 2, 50)) return fail("legs");

  const { ba, setback, bd } = sheetMetalGeometry(thickness, radius, angle, kFactor);
  const bendCount = legs.length - 1;

  const tangents: number[] = [];
  if (legsAs === "outer") {
    for (const [index, outer] of legs.entries()) {
      if (!isPositive(outer)) return fail(`legs:${index}`);
      const touches = index === 0 || index === legs.length - 1 ? 1 : 2;
      const tangent = outer - setback * touches;
      if (tangent <= 0) return fail(`legs:${index}`);
      tangents.push(tangent);
    }
  } else {
    for (const [index, tangent] of legs.entries()) {
      if (!isPositive(tangent)) return fail(`legs:${index}`);
      tangents.push(tangent);
    }
  }

  const totalTangent = tangents.reduce((sum, t) => sum + t, 0);
  const developedLength = totalTangent + bendCount * ba;

  const bendLines: SheetMetalBendLine[] = [];
  let cumulative = 0;
  for (let i = 0; i < bendCount; i += 1) {
    const legLength = tangents[i];
    if (legLength === undefined) return fail(`legs:${i}`);
    cumulative += legLength;
    const start = cumulative;
    const end = start + ba;
    bendLines.push({
      start,
      end,
      startFromOppositeEdge: developedLength - start,
      endFromOppositeEdge: developedLength - end,
    });
    cumulative = end;
  }

  return { ok: true, bendAllowance: ba, bendDeduction: bd, setback, developedLength, bendLines };
}

/**
 * The K-factor a real sample implies, from its designed outer legs and the
 * developed length actually measured after cutting.
 *
 * **The bend count divides the shortfall before it reaches the angle term.**
 * A sample with more than one identical bend spreads its total excess over
 * `measuredLength − Σtangent` across ALL of them; skipping that division
 * silently assumes a one-bend sample and inflates K for every additional bend.
 */
export function sheetMetalKFactorFromSample(
  input: SheetMetalKFactorInput,
): ProResult<SheetMetalKFactorResult> {
  const { thickness, radius, angle, outerLegs, measuredLength } = input;
  if (!isInRange(thickness, 0.1, 20)) return fail("thickness");
  if (!isInRange(radius, 0.1, 200)) return fail("radius");
  if (!isInRange(angle, 1, 179)) return fail("angle");
  if (!isIntegerIn(outerLegs.length, 2, 50)) return fail("outerLegs");
  if (!isInRange(measuredLength, 1, 6000)) return fail("measuredLength");

  const angleRad = angle * RAD_PER_DEG;
  const setback = (radius + thickness) * Math.tan(angleRad / 2);
  const bendCount = outerLegs.length - 1;

  let totalTangent = 0;
  for (const [index, outer] of outerLegs.entries()) {
    if (!isPositive(outer)) return fail(`outerLegs:${index}`);
    const touches = index === 0 || index === outerLegs.length - 1 ? 1 : 2;
    const tangent = outer - setback * touches;
    if (tangent <= 0) return fail(`outerLegs:${index}`);
    totalTangent += tangent;
  }

  const perBendExcess = (measuredLength - totalTangent) / bendCount;
  const kFactor = (perBendExcess / ((Math.PI / 180) * angle) - radius) / thickness;
  return { ok: true, kFactor, thickness, radius, angle, radiusToThickness: radius / thickness };
}

/* =============================================================================
 * shelf-deflection — „Ugib police" (life-safety)
 * ========================================================================== */

/** Standard acceleration of gravity, m/s² — a definition, not a measurement. */
const GRAVITY = 9.80665;

export interface ShelfDeflectionInput {
  readonly span: number;
  readonly width: number;
  readonly thickness: number;
  /** Total mass of the uniformly distributed load, in kg — 0 is a valid, empty shelf. */
  readonly udlMass: number;
  readonly pointLoadMass?: number | undefined;
  readonly modulus: number;
  /** Panel density, kg/m³ — its own weight is derived from this and the section, INSTEAD of `shelfMass`. */
  readonly shelfDensity?: number | undefined;
  /** The panel's own mass, kg, given directly — INSTEAD of `shelfDensity`. */
  readonly shelfMass?: number | undefined;
  /** The user's own deflection limit, in mm — never a default, never a rule this tool chose. */
  readonly deflectionLimit?: number | undefined;
  /** The user's own limit as a bare L/x ratio — used INSTEAD of `deflectionLimit`. */
  readonly deflectionLimitDivisor?: number | undefined;
  readonly stressLimit?: number | undefined;
}

export interface ShelfDeflectionResult {
  readonly inertia: number;
  readonly sectionModulus: number;
  readonly selfWeightMass: number | undefined;
  /**
   * The self-weight's OWN share of `distributedDeflection` — undefined only
   * when no `shelfMass`/`shelfDensity` was given at all. It is already
   * counted inside `distributedDeflection` and `totalDeflection`; this is
   * the same combined bending broken out by cause, not an addition to it.
   */
  readonly selfWeightDeflection: number | undefined;
  readonly distributedDeflection: number;
  readonly pointDeflection: number;
  readonly totalDeflection: number;
  /** L/δ, rounded to one decimal — undefined when the shelf carries no load at all. */
  readonly spanOverDeflection: number | undefined;
  readonly maxMoment: number;
  readonly stress: number;
  readonly reaction: number;
  readonly reactionMass: number;
  readonly deflectionLimit: number | undefined;
  readonly deflectionRatio: number | undefined;
  readonly stressRatio: number | undefined;
}

/**
 * Deflection, moment and stress for a shelf as a simple beam on two supports.
 *
 * **`life-safety`: no verdict, ever.** The two limits are the user's own
 * numbers with no default; what comes back is the pair and its ratio, never a
 * word about whether the shelf is „fine".
 *
 * **The shelf's own weight is folded into the distributed load, AND broken
 * out as its own line item.** A panel this tool is not told the mass of is
 * not weightless, and leaving it out under-states every unloaded shelf's own
 * deflection; `selfWeightDeflection` names how much of `totalDeflection` is
 * the shelf carrying itself, computed from the self-weight's own share of q
 * — deflection is linear in q, so this and the placed-load share always sum
 * back to `distributedDeflection` exactly.
 *
 * **`L/δ` is withheld, not printed as infinity, when δ is exactly zero** — an
 * empty shelf with no self-weight given carries no load at all, and a ratio
 * against zero says nothing.
 */
export function shelfDeflection(input: ShelfDeflectionInput): ProResult<ShelfDeflectionResult> {
  const { span, width, thickness, udlMass, modulus } = input;
  if (!isInRange(span, 50, 5000)) return fail("span");
  if (!isInRange(width, 10, 2000)) return fail("width");
  if (!isInRange(thickness, 3, 200)) return fail("thickness");
  if (!isInRange(udlMass, 0, 2000)) return fail("udlMass");
  const pointLoadMass = input.pointLoadMass ?? 0;
  if (!isInRange(pointLoadMass, 0, 2000)) return fail("pointLoadMass");
  if (!isInRange(modulus, 100, 20000)) return fail("modulus");
  if (input.shelfDensity !== undefined && !isPositive(input.shelfDensity)) {
    return fail("shelfDensity");
  }
  if (input.shelfMass !== undefined && !isNonNegative(input.shelfMass)) return fail("shelfMass");

  let selfWeightMass: number | undefined;
  if (input.shelfMass !== undefined) {
    selfWeightMass = input.shelfMass;
  } else if (input.shelfDensity !== undefined) {
    selfWeightMass =
      (width / 1000) * (thickness / 1000) * (span / 1000) * input.shelfDensity;
  }

  let deflectionLimit = input.deflectionLimit;
  if (input.deflectionLimitDivisor !== undefined) {
    if (!isPositive(input.deflectionLimitDivisor)) return fail("deflectionLimitDivisor");
    deflectionLimit = span / input.deflectionLimitDivisor;
  }
  if (deflectionLimit !== undefined && !isPositive(deflectionLimit)) {
    return fail("deflectionLimit");
  }
  if (input.stressLimit !== undefined && !isPositive(input.stressLimit)) return fail("stressLimit");

  const inertia = (width * thickness ** 3) / 12;
  const sectionModulus = (width * thickness ** 2) / 6;

  const q = ((udlMass + (selfWeightMass ?? 0)) * GRAVITY) / span;
  const qSelf = ((selfWeightMass ?? 0) * GRAVITY) / span;
  const force = pointLoadMass * GRAVITY;
  const distributedDeflection = (5 * q * span ** 4) / (384 * modulus * inertia);
  const selfWeightDeflection =
    selfWeightMass === undefined ? undefined : (5 * qSelf * span ** 4) / (384 * modulus * inertia);
  const pointDeflection = (force * span ** 3) / (48 * modulus * inertia);
  const totalDeflection = distributedDeflection + pointDeflection;
  const spanOverDeflection =
    totalDeflection > 0 ? Math.round((span / totalDeflection) * 10) / 10 : undefined;

  const maxMoment = (q * span ** 2) / 8 + (force * span) / 4;
  const stress = maxMoment / sectionModulus;
  const reaction = (q * span + force) / 2;

  return {
    ok: true,
    inertia,
    sectionModulus,
    selfWeightMass,
    selfWeightDeflection,
    distributedDeflection,
    pointDeflection,
    totalDeflection,
    spanOverDeflection,
    maxMoment,
    stress,
    reaction,
    reactionMass: reaction / GRAVITY,
    deflectionLimit,
    deflectionRatio: ratioAgainst(totalDeflection, deflectionLimit),
    stressRatio: ratioAgainst(stress, input.stressLimit),
  };
}

/* =============================================================================
 * shelf-spacing — „Raspored polica"
 * ========================================================================== */

export type ShelfSpacingMode = "equal-clear" | "equal-axis" | "given-first";

export interface ShelfSpacingInput {
  readonly innerHeight: number;
  readonly shelfCount?: number | undefined;
  /** Largest allowed clear opening, mm — derives `shelfCount` INSTEAD of it being given directly. */
  readonly maxClearOpening?: number | undefined;
  readonly thickness: number;
  readonly mode: ShelfSpacingMode;
  /** Height of the bottom opening, mm — `given-first` mode only. */
  readonly firstOpeningHeight?: number | undefined;
  readonly raster?: number | undefined;
  /** No default — the reviewed correction: this is not part of the System 32 convention. */
  readonly firstHoleFromBottom?: number | undefined;
  readonly snap: boolean;
}

export interface ShelfPosition {
  readonly bottomEdge: number;
  readonly topEdgeDistance: number;
  readonly holeIndex: number | undefined;
  readonly snappedBottomEdge: number | undefined;
  readonly snappedTopEdgeDistance: number | undefined;
  readonly deviation: number | undefined;
}

export interface ShelfSpacingResult {
  readonly shelfCount: number;
  readonly usableHeight: number;
  readonly shelves: readonly ShelfPosition[];
  /** One per opening (shelfCount + 1), unsnapped — the bottom gap, every gap between shelves, the top gap. */
  readonly clearOpenings: readonly number[];
  readonly snappedClearOpenings: readonly number[] | undefined;
}

/**
 * Shelf positions for equal clear openings, equal axis (pin) spacing, or a
 * fixed bottom opening — with an optional snap to a drilled hole raster.
 *
 * **`equal-axis` does NOT give equal clear gaps even with identical shelf
 * thickness.** The two end gaps are `p − t/2` and every middle gap is `p −
 * t` — the review's own correction, and the reason every opening is reported
 * individually here rather than as one shared number.
 *
 * **The opening list is built the same way for every mode**, from whatever
 * positions that mode produced: `openings[0]` is the floor to the first
 * shelf, `openings[i]` is shelf `i` to shelf `i+1`, `openings[n]` is the last
 * shelf to the top. One formula, so the modes cannot silently disagree on
 * what „the opening" means.
 */
export function shelfSpacing(input: ShelfSpacingInput): ProResult<ShelfSpacingResult> {
  const { innerHeight: H, thickness: t, mode } = input;
  if (!isInRange(H, 50, 5000)) return fail("innerHeight");
  if (!isInRange(t, 3, 100)) return fail("thickness");

  let n: number;
  if (input.shelfCount !== undefined) {
    if (!isIntegerIn(input.shelfCount, 0, 30)) return fail("shelfCount");
    n = input.shelfCount;
  } else if (input.maxClearOpening !== undefined) {
    const sMax = input.maxClearOpening;
    if (!isPositive(sMax) || t + sMax <= 0) return fail("maxClearOpening");
    n = Math.ceil((H - sMax) / (t + sMax));
    if (!isIntegerIn(n, 0, 30)) return fail("maxClearOpening");
  } else {
    return fail("shelfCount");
  }

  const U = H - n * t;
  if (U <= 0) return fail("usableHeight");

  const positions: number[] = [];
  if (mode === "equal-clear") {
    const k = n + 1;
    const s = U / k;
    for (let i = 1; i <= n; i += 1) positions.push(i * s + (i - 1) * t);
  } else if (mode === "equal-axis") {
    const p = H / (n + 1);
    for (let i = 1; i <= n; i += 1) positions.push(i * p - t / 2);
  } else {
    if (n < 1) return fail("shelfCount");
    if (input.firstOpeningHeight === undefined || !isPositive(input.firstOpeningHeight)) {
      return fail("firstOpeningHeight");
    }
    const s1 = input.firstOpeningHeight;
    if (s1 >= U) return fail("firstOpeningHeight");
    const s = (U - s1) / n;
    let y = s1;
    positions.push(y);
    for (let i = 2; i <= n; i += 1) {
      y = y + t + s;
      positions.push(y);
    }
  }

  // n = 0 gives exactly ONE opening, equal to the whole usable height — not
  // the floor-to-shelf-0 opening AND the shelf-0-to-top opening, which do not
  // exist when there is no shelf 0.
  const openings: number[] = [];
  if (n === 0) {
    openings.push(U);
  } else {
    openings.push(positions[0] ?? U);
    for (let i = 1; i < n; i += 1) {
      const prev = positions[i - 1];
      const cur = positions[i];
      if (prev === undefined || cur === undefined) return fail("shelfCount");
      openings.push(cur - (prev + t));
    }
    const last = positions[n - 1];
    openings.push(H - ((last ?? 0) + t));
  }

  let snappedClearOpenings: number[] | undefined;
  const shelves: ShelfPosition[] = positions.map((y) => ({
    bottomEdge: y,
    topEdgeDistance: H - y - t,
    holeIndex: undefined,
    snappedBottomEdge: undefined,
    snappedTopEdgeDistance: undefined,
    deviation: undefined,
  }));

  if (input.snap) {
    if (input.firstHoleFromBottom === undefined || !isInRange(input.firstHoleFromBottom, 0, 200)) {
      return fail("firstHoleFromBottom");
    }
    const raster = input.raster ?? 32;
    if (!isInRange(raster, 1, 100)) return fail("raster");
    const o = input.firstHoleFromBottom;

    const snapped: number[] = [];
    for (let i = 0; i < positions.length; i += 1) {
      const y = positions[i];
      if (y === undefined) return fail("shelfCount");
      const j = Math.round((y - o) / raster);
      const yPrime = o + j * raster;
      if (yPrime < 0 || yPrime + t > H) return fail("snap");
      const prevPrime = snapped[i - 1];
      if (prevPrime !== undefined && prevPrime + t > yPrime) return fail("snap");
      snapped.push(yPrime);
      const row = shelves[i];
      if (row === undefined) return fail("shelfCount");
      shelves[i] = {
        ...row,
        holeIndex: j,
        snappedBottomEdge: yPrime,
        snappedTopEdgeDistance: H - yPrime - t,
        deviation: yPrime - y,
      };
    }

    const snappedOpenings: number[] = [];
    if (n === 0) {
      snappedOpenings.push(U);
    } else {
      snappedOpenings.push(snapped[0] ?? U);
      for (let i = 1; i < n; i += 1) {
        const prev = snapped[i - 1];
        const cur = snapped[i];
        if (prev === undefined || cur === undefined) return fail("snap");
        snappedOpenings.push(cur - (prev + t));
      }
      const lastSnap = snapped[n - 1];
      snappedOpenings.push(H - ((lastSnap ?? 0) + t));
    }
    snappedClearOpenings = snappedOpenings;
  }

  return { ok: true, shelfCount: n, usableHeight: U, shelves, clearOpenings: openings, snappedClearOpenings };
}

/* =============================================================================
 * tap-drill-size — „Bušenje za navoj"
 * ========================================================================== */

/** ISO 261:1998 coarse pitch, mm, keyed by nominal diameter D (mm). */
const ISO261_COARSE: Readonly<Record<number, number>> = {
  1.6: 0.35, 2: 0.4, 2.5: 0.45, 3: 0.5, 3.5: 0.6, 4: 0.7, 5: 0.8, 6: 1, 8: 1.25,
  10: 1.5, 12: 1.75, 14: 2, 16: 2, 18: 2.5, 20: 2.5, 22: 2.5, 24: 3, 27: 3, 30: 3.5,
};

/** ISO 261:1998 common fine pitches, mm, keyed by nominal diameter D (mm). */
const ISO261_FINE: Readonly<Record<number, readonly number[]>> = {
  8: [1], 10: [1.25, 1], 12: [1.5, 1.25], 14: [1.5], 16: [1.5], 18: [1.5], 20: [1.5], 22: [1.5], 24: [2],
};

/**
 * ISO 273:1979 clearance-hole diameters, mm, by series, keyed by nominal
 * diameter D (mm) — table 2 of the standard, transcribed in full for every
 * row inside `TapDrillInput.nominalDiameter`'s own 1.6–30 mm domain, so no
 * valid diameter in that range comes back with an empty `passHoleDiameter`.
 */
const ISO273_CLEARANCE: Readonly<Record<number, { readonly fine: number; readonly medium: number; readonly coarse: number }>> = {
  1.6: { fine: 1.7, medium: 1.8, coarse: 2 },
  2: { fine: 2.2, medium: 2.4, coarse: 2.6 },
  2.5: { fine: 2.7, medium: 2.9, coarse: 3.1 },
  3: { fine: 3.2, medium: 3.4, coarse: 3.6 },
  3.5: { fine: 3.7, medium: 3.9, coarse: 4.2 },
  4: { fine: 4.3, medium: 4.5, coarse: 4.8 },
  5: { fine: 5.3, medium: 5.5, coarse: 5.8 },
  6: { fine: 6.4, medium: 6.6, coarse: 7 },
  8: { fine: 8.4, medium: 9, coarse: 10 },
  10: { fine: 10.5, medium: 11, coarse: 12 },
  12: { fine: 13, medium: 13.5, coarse: 14.5 },
  14: { fine: 15, medium: 15.5, coarse: 16.5 },
  16: { fine: 17, medium: 17.5, coarse: 18.5 },
  18: { fine: 19, medium: 20, coarse: 21 },
  20: { fine: 21, medium: 22, coarse: 24 },
  22: { fine: 23, medium: 24, coarse: 26 },
  24: { fine: 25, medium: 26, coarse: 28 },
  27: { fine: 28, medium: 30, coarse: 32 },
  30: { fine: 31, medium: 33, coarse: 35 },
};

/** H = 0.866025·P (60° profile) → depth per side 0.75·H = 0.649519·P → full-engagement drop 2× that. */
const THREAD_FULL_DROP_FACTOR = 1.299038;
/** D₁ = D − 2·(5/8)·H = D − 1.082532·P. ISO 68-1:1998. */
const THREAD_CORE_FACTOR = 1.082532;

export type PassHoleSeries = "fine" | "medium" | "coarse";
export type PitchSource = "coarse-auto" | "coarse-entered" | "fine" | "custom";

export interface TapDrillInput {
  readonly nominalDiameter: number;
  /** mm — default is the ISO 261 coarse pitch for `nominalDiameter`; a fine pitch is entered explicitly. */
  readonly pitch?: number | undefined;
  readonly desiredEngagement?: number | undefined;
  readonly ownDrillDiameter?: number | undefined;
  readonly passHoleSeries?: PassHoleSeries | undefined;
  /** Chamfered lead threads on the tap — for the minimum blind-hole depth. */
  readonly chamferedThreads?: number | undefined;
  /**
   * Axial depth of full thread wanted in the hole, mm („dubina navoja") — for
   * the minimum blind-hole depth, taken together with `chamferedThreads`.
   */
  readonly threadDepth?: number | undefined;
}

export interface TapDrillResult {
  readonly pitchUsed: number;
  readonly pitchSource: PitchSource;
  /** The engagement percentage actually applied — the default (75) is invisible without this. */
  readonly engagementUsed: number;
  readonly coreDiameter: number;
  readonly drillDiameter: number;
  readonly threadDepthPerSide: number;
  readonly ownDrillEngagement: number | undefined;
  readonly ownDrillThreadDepth: number | undefined;
  readonly passHoleDiameter: number | undefined;
  readonly minBlindHoleDepth: number | undefined;
}

/**
 * Tap drill diameter for a target percentage of thread engagement, the
 * engagement a drill you already have would give, and the matching
 * clearance-hole diameter.
 *
 * **The reverse calculation refuses `d ≥ D`** — that would mean an
 * engagement at or below zero, which is not a drill for this tap at all —
 * and prints an engagement above 100 % as-is rather than clamping it: that
 * number means the drill is smaller than the thread's own core.
 *
 * **The minimum blind-hole depth is `threadDepth + chamferedThreads·P`.**
 * `threadDepth` is the AXIAL depth of full thread wanted — `threadDepthPerSide`
 * is a different quantity entirely (the thread profile's own RADIAL
 * half-height, `(D − d)/2`) and does not belong in this sum; using it there
 * reports a hole short by the entire axial thread depth.
 */
export function tapDrillSize(input: TapDrillInput): ProResult<TapDrillResult> {
  const { nominalDiameter: D } = input;
  if (!isInRange(D, 1.6, 30)) return fail("nominalDiameter");

  let pitch: number;
  let pitchSource: PitchSource;
  if (input.pitch === undefined) {
    const coarse = ISO261_COARSE[D];
    if (coarse === undefined) return fail("pitch");
    pitch = coarse;
    pitchSource = "coarse-auto";
  } else {
    if (!isInRange(input.pitch, 0.2, 3.5)) return fail("pitch");
    pitch = input.pitch;
    const coarse = ISO261_COARSE[D];
    const fineOptions = ISO261_FINE[D] ?? [];
    if (coarse !== undefined && Math.abs(coarse - pitch) < 1e-9) pitchSource = "coarse-entered";
    else if (fineOptions.some((f) => Math.abs(f - pitch) < 1e-9)) pitchSource = "fine";
    else pitchSource = "custom";
  }

  const engagement = input.desiredEngagement ?? 75;
  if (!isInRange(engagement, 50, 100)) return fail("desiredEngagement");

  const coreDiameter = D - THREAD_CORE_FACTOR * pitch;
  const drillDiameter = D - (engagement / 100) * THREAD_FULL_DROP_FACTOR * pitch;
  const threadDepthPerSide = (D - drillDiameter) / 2;

  let ownDrillEngagement: number | undefined;
  let ownDrillThreadDepth: number | undefined;
  if (input.ownDrillDiameter !== undefined) {
    if (!isInRange(input.ownDrillDiameter, 0.5, 30)) return fail("ownDrillDiameter");
    if (input.ownDrillDiameter >= D) return fail("ownDrillDiameter");
    ownDrillEngagement = (100 * (D - input.ownDrillDiameter)) / (THREAD_FULL_DROP_FACTOR * pitch);
    ownDrillThreadDepth = (D - input.ownDrillDiameter) / 2;
  }

  const series = input.passHoleSeries ?? "medium";
  const passHoleDiameter = ISO273_CLEARANCE[D]?.[series];

  let minBlindHoleDepth: number | undefined;
  if (input.chamferedThreads !== undefined || input.threadDepth !== undefined) {
    if (!isPositive(input.chamferedThreads)) return fail("chamferedThreads");
    if (!isPositive(input.threadDepth)) return fail("threadDepth");
    minBlindHoleDepth = input.threadDepth + input.chamferedThreads * pitch;
  }

  return {
    ok: true,
    pitchUsed: pitch,
    pitchSource,
    engagementUsed: engagement,
    coreDiameter,
    drillDiameter,
    threadDepthPerSide,
    ownDrillEngagement,
    ownDrillThreadDepth,
    passHoleDiameter,
    minBlindHoleDepth,
  };
}

/* =============================================================================
 * timber-volume — „Kubikaza drveta"
 * ========================================================================== */

export type TimberMode =
  | { readonly kind: "huber"; readonly meanDiameter: number; readonly length: number; readonly logCount?: number | undefined }
  | { readonly kind: "smalian"; readonly d1: number; readonly d2: number; readonly length: number; readonly logCount?: number | undefined }
  | {
      readonly kind: "huber-smalian";
      readonly meanDiameter: number;
      readonly d1: number;
      readonly d2: number;
      readonly length: number;
      readonly logCount?: number | undefined;
    }
  | {
      readonly kind: "sawn";
      readonly thickness: number;
      readonly width: number;
      readonly pieceLength: number;
      readonly pieces: number;
      readonly section: "rough" | "planed";
    }
  | {
      readonly kind: "sawn-from-volume";
      readonly thickness: number;
      readonly width: number;
      readonly pieceLength: number;
      readonly targetVolume: number;
      readonly section: "rough" | "planed";
    }
  | { readonly kind: "stacked-to-solid"; readonly stackedVolume: number; readonly packingCoefficient: number }
  | { readonly kind: "solid-to-stacked"; readonly solidVolume: number; readonly packingCoefficient: number };

export interface TimberVolumeInput {
  readonly mode: TimberMode;
  readonly barkThickness?: number | undefined;
  readonly density?: number | undefined;
}

export interface TimberVolumeResult {
  readonly huberVolume: number | undefined;
  readonly smalianVolume: number | undefined;
  readonly volumeDifference: number | undefined;
  readonly volumeDifferencePercent: number | undefined;
  readonly taper: number | undefined;
  readonly logCount: number | undefined;
  /** Undefined for `huber-smalian` — see `totalLogVolumeHuber`/`totalLogVolumeSmalian`. */
  readonly totalLogVolume: number | undefined;
  /** `huber-smalian` only: the Huber total, offered alongside Smalian's, neither elected. */
  readonly totalLogVolumeHuber: number | undefined;
  /** `huber-smalian` only: the Smalian total, offered alongside Huber's, neither elected. */
  readonly totalLogVolumeSmalian: number | undefined;
  readonly pieceVolume: number | undefined;
  readonly totalVolume: number | undefined;
  readonly pieceCount: number | undefined;
  readonly surfaceArea: number | undefined;
  readonly sawnSection: "rough" | "planed" | undefined;
  readonly stackedVolume: number | undefined;
  /** Undefined for `huber-smalian` — see `massHuber`/`massSmalian` instead. */
  readonly mass: number | undefined;
  /** `huber-smalian` only: mass from the Huber total, offered alongside Smalian's. */
  readonly massHuber: number | undefined;
  /** `huber-smalian` only: mass from the Smalian total, offered alongside Huber's. */
  readonly massSmalian: number | undefined;
}

function huberVolumeOf(diameterCm: number, lengthM: number): number {
  return Math.PI * (diameterCm / 200) ** 2 * lengthM;
}
function smalianVolumeOf(d1Cm: number, d2Cm: number, lengthM: number): number {
  const a1 = Math.PI * (d1Cm / 200) ** 2;
  const a2 = Math.PI * (d2Cm / 200) ** 2;
  return ((a1 + a2) / 2) * lengthM;
}

/**
 * Round-log volume by Huber or Smalian, sawn-timber volume, or a stacked/prm
 * conversion — never claiming one of the two log formulas is „the" answer.
 *
 * **`huber-smalian` never elects a winner for the TOTAL either.** Both
 * per-log volumes were always returned side by side; `totalLogVolume` and
 * `mass` cannot honestly represent "both, unelected" as one number, so in
 * this mode they stay undefined and `totalLogVolumeHuber`/`totalLogVolumeSmalian`
 * (and `massHuber`/`massSmalian`) carry the two totals instead — which formula
 * applies is a matter of agreement with the buyer, not this tool's business.
 *
 * **Bark is subtracted from EVERY diameter that enters a formula**, not only
 * the Huber mean — the review's own correction, because Smalian needs both
 * ends debarked or its comparison to Huber is comparing a debarked figure to
 * a barked one.
 */
export function timberVolume(input: TimberVolumeInput): ProResult<TimberVolumeResult> {
  const bark = input.barkThickness ?? 0;
  if (!isInRange(bark, 0, 10)) return fail("barkThickness");
  if (input.density !== undefined && !isInRange(input.density, 300, 1300)) return fail("density");
  const { mode } = input;

  const debark = (d: number): ProResult<{ readonly value: number }> => {
    const value = d - 2 * bark;
    return value > 0 ? { ok: true, value } : fail("barkThickness");
  };

  const empty: TimberVolumeResult = {
    huberVolume: undefined,
    smalianVolume: undefined,
    volumeDifference: undefined,
    volumeDifferencePercent: undefined,
    taper: undefined,
    logCount: undefined,
    totalLogVolume: undefined,
    totalLogVolumeHuber: undefined,
    totalLogVolumeSmalian: undefined,
    pieceVolume: undefined,
    totalVolume: undefined,
    pieceCount: undefined,
    surfaceArea: undefined,
    sawnSection: undefined,
    stackedVolume: undefined,
    mass: undefined,
    massHuber: undefined,
    massSmalian: undefined,
  };

  if (mode.kind === "huber" || mode.kind === "smalian" || mode.kind === "huber-smalian") {
    if (!isInRange(mode.length, 0.5, 30)) return fail("length");
    if (mode.logCount !== undefined && !isIntegerIn(mode.logCount, 1, 100000)) return fail("logCount");

    let huber: number | undefined;
    let smalian: number | undefined;
    let taper: number | undefined;

    if (mode.kind === "huber" || mode.kind === "huber-smalian") {
      if (!isInRange(mode.meanDiameter, 5, 200)) return fail("meanDiameter");
      const d = debark(mode.meanDiameter);
      if (!d.ok) return d;
      huber = huberVolumeOf(d.value, mode.length);
    }
    if (mode.kind === "smalian" || mode.kind === "huber-smalian") {
      if (!isInRange(mode.d1, 5, 200)) return fail("d1");
      if (!isInRange(mode.d2, 5, 200)) return fail("d2");
      const dd1 = debark(mode.d1);
      if (!dd1.ok) return dd1;
      const dd2 = debark(mode.d2);
      if (!dd2.ok) return dd2;
      smalian = smalianVolumeOf(dd1.value, dd2.value, mode.length);
      taper = (mode.d2 - mode.d1) / mode.length;
    }

    // Combined mode never elects one formula's total as THE total: the
    // per-formula totals and masses are offered side by side instead, and
    // the single `totalLogVolume`/`mass` fields — which cannot represent
    // "both, unelected" — stay undefined there.
    const perLog = mode.kind === "huber" ? huber : mode.kind === "smalian" ? smalian : undefined;
    const totalLogVolume =
      mode.kind === "huber-smalian" || mode.logCount === undefined || perLog === undefined
        ? undefined
        : perLog * mode.logCount;
    const totalLogVolumeHuber =
      mode.kind !== "huber-smalian" || mode.logCount === undefined || huber === undefined
        ? undefined
        : huber * mode.logCount;
    const totalLogVolumeSmalian =
      mode.kind !== "huber-smalian" || mode.logCount === undefined || smalian === undefined
        ? undefined
        : smalian * mode.logCount;
    return {
      ok: true,
      ...empty,
      huberVolume: huber,
      smalianVolume: smalian,
      volumeDifference: huber !== undefined && smalian !== undefined ? smalian - huber : undefined,
      volumeDifferencePercent:
        huber !== undefined && smalian !== undefined ? ((smalian - huber) / huber) * 100 : undefined,
      taper,
      logCount: mode.logCount,
      totalLogVolume,
      totalLogVolumeHuber,
      totalLogVolumeSmalian,
      mass:
        input.density === undefined || perLog === undefined
          ? undefined
          : (totalLogVolume ?? perLog) * input.density,
      massHuber:
        input.density === undefined || mode.kind !== "huber-smalian" || huber === undefined
          ? undefined
          : (totalLogVolumeHuber ?? huber) * input.density,
      massSmalian:
        input.density === undefined || mode.kind !== "huber-smalian" || smalian === undefined
          ? undefined
          : (totalLogVolumeSmalian ?? smalian) * input.density,
    };
  }

  if (mode.kind === "sawn") {
    if (!isInRange(mode.thickness, 5, 500)) return fail("thickness");
    if (!isInRange(mode.width, 5, 500)) return fail("width");
    if (!isInRange(mode.pieceLength, 0.1, 20)) return fail("pieceLength");
    if (!isIntegerIn(mode.pieces, 1, 100000)) return fail("pieces");
    const pieceVolume = (mode.thickness / 1000) * (mode.width / 1000) * mode.pieceLength;
    const totalVolume = pieceVolume * mode.pieces;
    const surfaceArea = (mode.width / 1000) * mode.pieceLength * mode.pieces;
    return {
      ok: true,
      ...empty,
      pieceVolume,
      totalVolume,
      surfaceArea,
      sawnSection: mode.section,
      mass: input.density === undefined ? undefined : totalVolume * input.density,
    };
  }

  if (mode.kind === "sawn-from-volume") {
    if (!isInRange(mode.thickness, 5, 500)) return fail("thickness");
    if (!isInRange(mode.width, 5, 500)) return fail("width");
    if (!isInRange(mode.pieceLength, 0.1, 20)) return fail("pieceLength");
    if (!isPositive(mode.targetVolume)) return fail("targetVolume");
    const pieceVolume = (mode.thickness / 1000) * (mode.width / 1000) * mode.pieceLength;
    const pieceCount = Math.floor(mode.targetVolume / pieceVolume);
    return {
      ok: true,
      ...empty,
      pieceVolume,
      pieceCount,
      sawnSection: mode.section,
      mass: input.density === undefined ? undefined : mode.targetVolume * input.density,
    };
  }

  if (mode.kind === "stacked-to-solid") {
    if (!isPositive(mode.stackedVolume)) return fail("stackedVolume");
    if (!isInRange(mode.packingCoefficient, 0.4, 0.9)) return fail("packingCoefficient");
    const totalVolume = mode.stackedVolume * mode.packingCoefficient;
    return {
      ok: true,
      ...empty,
      stackedVolume: mode.stackedVolume,
      totalVolume,
      mass: input.density === undefined ? undefined : totalVolume * input.density,
    };
  }

  if (!isPositive(mode.solidVolume)) return fail("solidVolume");
  if (!isInRange(mode.packingCoefficient, 0.4, 0.9)) return fail("packingCoefficient");
  const stackedVolume = mode.solidVolume / mode.packingCoefficient;
  return {
    ok: true,
    ...empty,
    stackedVolume,
    totalVolume: mode.solidVolume,
    mass: input.density === undefined ? undefined : mode.solidVolume * input.density,
  };
}

/* =============================================================================
 * wallpaper-rolls — „Broj rolni tapeta"
 * ========================================================================== */

export interface WallpaperWall {
  readonly width: number;
  /** A full-height opening on THIS wall (a door), in m — its width is deducted. Default 0. */
  readonly fullHeightOpening?: number | undefined;
}

export type WallpaperMatching = "straight" | "half-drop";

export interface WallpaperRollsInput {
  readonly walls: readonly WallpaperWall[];
  readonly height: number;
  readonly rollWidth: number;
  readonly rollLength: number;
  readonly repeat: number;
  readonly matching: WallpaperMatching;
  readonly allowance: number;
  readonly reserveStrips?: number | undefined;
  /** Height of a piece cut above a door/window from roll remnants, m — for `sparePiecesFromRemnants`. */
  readonly spareStripHeight?: number | undefined;
}

export interface WallpaperRoll {
  readonly stripCount: number;
  readonly remainder: number;
  readonly patternWaste: number;
}

export interface WallpaperRollsResult {
  readonly stripCount: number;
  /** Closed-form strip length ceil(H/R)·R, straight matching — a cross-check on the simulation. */
  readonly stripLength: number;
  readonly stripsPerRollCheck: number;
  readonly rolls: readonly WallpaperRoll[];
  readonly rollCount: number;
  readonly totalPatternWaste: number;
  readonly sparePiecesFromRemnants: number | undefined;
}

/**
 * Wallpaper roll count from a wall-by-wall strip count and a sequential,
 * roll-by-roll pattern-matching simulation.
 *
 * **Strips are counted PER WALL, not from the total perimeter.** A strip
 * never turns a corner, so `Σ ceil(w_i / rollWidth)` is the real count; the
 * perimeter divided by the roll width is only ever a lower bound, and the
 * gap between the two is exactly the corner waste this correction restores.
 *
 * **The half-drop phase alternates by the strip's position ON ITS OWN WALL**,
 * not by its position in the running total — cutting a fresh wall does not
 * inherit the phase the last strip on the previous wall happened to land on.
 *
 * **Everything below is done in whole millimetres.** `p mod R` on floating
 * millimetres drifts the phase by fractions of a millimetre per strip, and
 * over dozens of strips that drift changes which strip is the one that does
 * not fit — i.e. it changes the roll count, not just the decimals.
 */
export function wallpaperRolls(input: WallpaperRollsInput): ProResult<WallpaperRollsResult> {
  const { walls, height, rollWidth, rollLength, repeat, matching, allowance } = input;
  if (!isIntegerIn(walls.length, 1, 100)) return fail("walls");
  if (!isInRange(height, 0.5, 10)) return fail("height");
  if (!isInRange(rollWidth, 0.3, 1.6)) return fail("rollWidth");
  if (!isInRange(rollLength, 1, 100)) return fail("rollLength");
  if (!isInRange(repeat, 0, 1.5)) return fail("repeat");
  if (!isInRange(allowance, 0, 0.5)) return fail("allowance");
  const reserveStrips = input.reserveStrips ?? 0;
  if (!isIntegerIn(reserveStrips, 0, 20)) return fail("reserveStrips");

  const toMm = (m: number): number => Math.round(m * 1000);
  const rollWidthMm = toMm(rollWidth);
  const rollLengthMm = toMm(rollLength);
  const repeatMm = toMm(repeat);
  const heightMm = toMm(height + allowance);
  if (heightMm <= 0) return fail("height");
  if (heightMm > rollLengthMm) return fail("rollLength");

  // Build the ordered list of strip phases: per wall, alternating 0/R÷2 for
  // half-drop by the strip's own position on that wall; reserve strips are
  // assumed straight, since they belong to no particular wall.
  const phases: number[] = [];
  for (const [index, wall] of walls.entries()) {
    if (!isPositive(wall.width)) return fail(`walls:${index}`);
    const opening = wall.fullHeightOpening ?? 0;
    if (!isNonNegative(opening) || opening >= wall.width) return fail(`walls:${index}`);
    const netMm = toMm(wall.width - opening);
    const stripsForWall = Math.ceil(netMm / rollWidthMm);
    for (let k = 1; k <= stripsForWall; k += 1) {
      phases.push(matching === "half-drop" && repeatMm > 0 && k % 2 === 0 ? repeatMm / 2 : 0);
    }
  }
  for (let i = 0; i < reserveStrips; i += 1) phases.push(0);
  const stripCount = phases.length;

  const stripLengthMm =
    repeatMm > 0 ? Math.ceil(heightMm / repeatMm) * repeatMm : heightMm;
  const stripsPerRollCheck = Math.floor(rollLengthMm / stripLengthMm);

  interface RollDraft {
    used: number;
    strips: number;
    waste: number;
  }
  const rolls: RollDraft[] = [{ used: 0, strips: 0, waste: 0 }];
  for (const phi of phases) {
    let roll = rolls[rolls.length - 1];
    if (roll === undefined) return fail("rollLength");
    let phaseAtP = repeatMm > 0 ? ((roll.used % repeatMm) + repeatMm) % repeatMm : 0;
    let d = repeatMm > 0 ? (((phi - phaseAtP) % repeatMm) + repeatMm) % repeatMm : 0;
    let needed = d + heightMm;
    if (rollLengthMm - roll.used < needed) {
      rolls.push({ used: 0, strips: 0, waste: 0 });
      roll = rolls[rolls.length - 1];
      if (roll === undefined) return fail("rollLength");
      phaseAtP = 0;
      d = repeatMm > 0 ? phi % repeatMm : 0;
      needed = d + heightMm;
      if (needed > rollLengthMm) return fail("rollLength");
    }
    roll.used += needed;
    roll.strips += 1;
    roll.waste += d;
  }

  const totalPatternWaste = rolls.reduce((sum, r) => sum + r.waste, 0);
  const spareHeightMm = input.spareStripHeight === undefined ? undefined : toMm(input.spareStripHeight);
  let sparePiecesFromRemnants: number | undefined;
  if (spareHeightMm !== undefined) {
    if (!isPositive(spareHeightMm)) return fail("spareStripHeight");
    sparePiecesFromRemnants = rolls.reduce(
      (sum, r) => sum + Math.floor((rollLengthMm - r.used) / spareHeightMm),
      0,
    );
  }

  return {
    ok: true,
    stripCount,
    stripLength: stripLengthMm / 1000,
    stripsPerRollCheck,
    rolls: rolls.map((r) => ({
      stripCount: r.strips,
      remainder: (rollLengthMm - r.used) / 1000,
      patternWaste: r.waste / 1000,
    })),
    rollCount: rolls.length,
    totalPatternWaste: totalPatternWaste / 1000,
    sparePiecesFromRemnants,
  };
}

/* =============================================================================
 * weld-consumable — „Potrošnja za zavarivanje"
 * ========================================================================== */

/** Density of unalloyed steel, kg/m³ — the default; aluminium is the user's own figure. */
const STEEL_DENSITY = 7850;

export type WeldSeamType = "fillet" | "butt-v" | "butt-x";

export interface WeldConsumableInput {
  readonly seamType: WeldSeamType;
  /** Fillet leg, mm — equal-leg convention. */
  readonly leg?: number | undefined;
  /** Fillet throat, mm — used INSTEAD of `leg`, converted as leg = throat·√2. */
  readonly throat?: number | undefined;
  readonly plateThickness?: number | undefined;
  /** Full included groove angle, degrees — butt welds. */
  readonly grooveAngle?: number | undefined;
  readonly rootGap?: number | undefined;
  readonly rootFaceHeight?: number | undefined;
  readonly reinforcement: number;
  readonly weldLength: number;
  readonly seamCount?: number | undefined;
  readonly density?: number | undefined;
  readonly efficiency: number;
  readonly waste: number;
  readonly wireDiameter?: number | undefined;
  readonly electrodeMass?: number | undefined;
  readonly electrodeUsableFraction?: number | undefined;
  readonly spoolMass?: number | undefined;
}

export interface WeldConsumableResult {
  readonly legUsed: number | undefined;
  readonly crossSectionArea: number;
  readonly weldMassPerMetre: number;
  readonly weldVolume: number;
  readonly weldMass: number;
  readonly consumableMass: number;
  readonly wireLength: number | undefined;
  readonly electrodeCount: number | undefined;
  readonly spoolCount: number | undefined;
}

/**
 * Weld-metal volume and mass, and the consumable mass it takes to deposit
 * it — as wire length or as a whole number of electrodes or spools.
 *
 * **The seam count is applied to the MASS before anything is rounded, once.**
 * Rounding a single seam's electrode count and then multiplying by the seam
 * count compounds that rounding across every seam; this always rounds the
 * TOTAL, exactly once, at the very end.
 */
export function weldConsumable(input: WeldConsumableInput): ProResult<WeldConsumableResult> {
  const { seamType } = input;
  if (!isInRange(input.reinforcement, 0, 30)) return fail("reinforcement");
  if (!isInRange(input.weldLength, 0.01, 10000)) return fail("weldLength");
  const seamCount = input.seamCount ?? 1;
  if (!isIntegerIn(seamCount, 1, 10000)) return fail("seamCount");
  const density = input.density ?? STEEL_DENSITY;
  if (!isInRange(density, 2000, 9000)) return fail("density");
  if (!isInRange(input.efficiency, 0.3, 1)) return fail("efficiency");
  if (!isInRange(input.waste, 0, 20)) return fail("waste");

  let legUsed: number | undefined;
  let area: number;
  if (seamType === "fillet") {
    if (input.throat !== undefined) {
      if (!isPositive(input.throat)) return fail("throat");
      legUsed = input.throat * Math.SQRT2;
    } else {
      if (input.leg === undefined || !isInRange(input.leg, 2, 30)) return fail("leg");
      legUsed = input.leg;
    }
    area = legUsed ** 2 / 2;
  } else {
    const { plateThickness: t, grooveAngle: alpha, rootGap: b, rootFaceHeight: c } = input;
    if (t === undefined || !isInRange(t, 1, 100)) return fail("plateThickness");
    if (alpha === undefined || !isInRange(alpha, 30, 90)) return fail("grooveAngle");
    if (b === undefined || !isInRange(b, 0, 10)) return fail("rootGap");
    if (c === undefined || !isInRange(c, 0, 10)) return fail("rootFaceHeight");
    if (c >= t) return fail("rootFaceHeight");
    const halfAngle = (alpha * RAD_PER_DEG) / 2;
    area =
      seamType === "butt-v"
        ? b * t + (t - c) ** 2 * Math.tan(halfAngle)
        : b * t + 2 * ((t - c) / 2) ** 2 * Math.tan(halfAngle);
  }

  const areaTotal = area * (1 + input.reinforcement / 100);
  const weldMassPerMetre = areaTotal * 1e-9 * density * 1000;
  const totalVolumeMm3 = areaTotal * (input.weldLength * 1000) * seamCount;
  const weldMassExact = totalVolumeMm3 * 1e-9 * density;
  const consumableMassExact = (weldMassExact / input.efficiency) * (1 + input.waste / 100);

  let wireLength: number | undefined;
  if (input.wireDiameter !== undefined) {
    if (!isInRange(input.wireDiameter, 0.6, 2.4)) return fail("wireDiameter");
    const wireMassPerMetre = ((Math.PI * input.wireDiameter ** 2) / 4) * 1000 * 1e-9 * density;
    wireLength = consumableMassExact / wireMassPerMetre;
  }

  let electrodeCount: number | undefined;
  if (input.electrodeMass !== undefined || input.electrodeUsableFraction !== undefined) {
    if (input.electrodeMass === undefined || !isInRange(input.electrodeMass, 10, 500)) {
      return fail("electrodeMass");
    }
    if (
      input.electrodeUsableFraction === undefined ||
      !isInRange(input.electrodeUsableFraction, 50, 95)
    ) {
      return fail("electrodeUsableFraction");
    }
    const usableGrams = input.electrodeMass * (input.electrodeUsableFraction / 100);
    electrodeCount = Math.ceil((consumableMassExact * 1000) / usableGrams);
  }

  let spoolCount: number | undefined;
  if (input.spoolMass !== undefined) {
    if (!isPositive(input.spoolMass)) return fail("spoolMass");
    spoolCount = Math.ceil(consumableMassExact / input.spoolMass);
  }

  return {
    ok: true,
    legUsed,
    crossSectionArea: areaTotal,
    weldMassPerMetre,
    weldVolume: totalVolumeMm3 / 1000,
    weldMass: weldMassExact,
    consumableMass: consumableMassExact,
    wireLength,
    electrodeCount,
    spoolCount,
  };
}

/* =============================================================================
 * wood-moisture-movement — „Rad drveta po vlazi"
 * ========================================================================== */

export type GrainDirection = "radial" | "tangential" | "longitudinal";

export interface WoodMoistureMovementInput {
  readonly initialDimension: number;
  readonly initialMoisture: number;
  readonly finalMoisture: number;
  /** %/%MC — a species-and-direction figure the user supplies. INSTEAD of `totalShrinkage`. */
  readonly shrinkageCoefficient?: number | undefined;
  /** Green-to-oven-dry shrinkage, % — derives `shrinkageCoefficient` as S/FSP. INSTEAD of it directly. */
  readonly totalShrinkage?: number | undefined;
  readonly grainDirection: GrainDirection;
  readonly fiberSaturationPoint?: number | undefined;
  /**
   * WOOD moisture content, %MC — never relative air humidity, %RH. This
   * module has no %RH→EMC conversion (the USDA Wood Handbook equation); a
   * caller holding %RH must convert before calling, and the surface's own
   * field copy is what has to tell the user which figure is wanted, since
   * this package carries no user-facing text.
   */
  readonly roomMoistureMin?: number | undefined;
  /** WOOD moisture content, %MC — see `roomMoistureMin`. */
  readonly roomMoistureMax?: number | undefined;
  /** WOOD moisture content, %MC — see `roomMoistureMin`. */
  readonly installMoisture?: number | undefined;
  readonly elementWidth?: number | undefined;
}

export interface WoodMoistureMovementResult {
  /** Echoes the input — the coefficient means nothing without knowing which direction it was measured in. */
  readonly grainDirection: GrainDirection;
  readonly clampedInitialMoisture: number;
  readonly clampedFinalMoisture: number;
  readonly dimensionChange: number;
  readonly dimensionChangePercent: number;
  readonly finalDimension: number;
  readonly derivedCoefficient: number | undefined;
  readonly swellToMax: number | undefined;
  readonly shrinkToMin: number | undefined;
  readonly totalSwing: number | undefined;
  readonly clampedInstallMoisture: number | undefined;
  readonly clampedRoomMin: number | undefined;
  readonly clampedRoomMax: number | undefined;
}

/**
 * How much a wood dimension changes between two moisture contents, and the
 * swing to expect against a room's moisture range.
 *
 * Wood moves only BELOW the fibre saturation point, so every moisture value
 * — MC₀, MC₁, and (when given) the install and room figures — is capped at
 * the FSP before it enters any formula; the correction widened that cap from
 * the two endpoints to all four of them.
 *
 * **No default coefficient, ever, for any species or direction** — radial and
 * tangential movement in the same board differ by up to double, and the
 * coefficient's lower bound is set low enough to admit the longitudinal
 * direction too, which moves far less than either.
 */
export function woodMoistureMovement(
  input: WoodMoistureMovementInput,
): ProResult<WoodMoistureMovementResult> {
  const { initialDimension: D0 } = input;
  if (!isInRange(D0, 1, 5000)) return fail("initialDimension");
  if (!isInRange(input.initialMoisture, 0, 40)) return fail("initialMoisture");
  if (!isInRange(input.finalMoisture, 0, 40)) return fail("finalMoisture");
  const fsp = input.fiberSaturationPoint ?? 30;
  if (!isInRange(fsp, 25, 35)) return fail("fiberSaturationPoint");

  let coefficient: number;
  let derivedCoefficient: number | undefined;
  if (input.shrinkageCoefficient !== undefined && input.totalShrinkage !== undefined) {
    return fail("shrinkageCoefficient");
  }
  if (input.shrinkageCoefficient !== undefined) {
    if (!isInRange(input.shrinkageCoefficient, 0.01, 0.6)) return fail("shrinkageCoefficient");
    coefficient = input.shrinkageCoefficient;
  } else if (input.totalShrinkage !== undefined) {
    if (!isInRange(input.totalShrinkage, 1, 20)) return fail("totalShrinkage");
    coefficient = input.totalShrinkage / fsp;
    derivedCoefficient = coefficient;
  } else {
    return fail("shrinkageCoefficient");
  }

  const clamp = (mc: number): number => Math.min(mc, fsp);
  const mc0 = clamp(input.initialMoisture);
  const mc1 = clamp(input.finalMoisture);
  const dimensionChange = D0 * (coefficient / 100) * (mc1 - mc0);
  const finalDimension = D0 + dimensionChange;

  let swellToMax: number | undefined;
  let shrinkToMin: number | undefined;
  let totalSwing: number | undefined;
  let clampedInstallMoisture: number | undefined;
  let clampedRoomMin: number | undefined;
  let clampedRoomMax: number | undefined;
  if (
    input.elementWidth !== undefined &&
    input.installMoisture !== undefined &&
    input.roomMoistureMin !== undefined &&
    input.roomMoistureMax !== undefined
  ) {
    if (!isPositive(input.elementWidth)) return fail("elementWidth");
    if (!isInRange(input.installMoisture, 3, 25)) return fail("installMoisture");
    if (!isInRange(input.roomMoistureMin, 3, 25)) return fail("roomMoistureMin");
    if (!isInRange(input.roomMoistureMax, 3, 25)) return fail("roomMoistureMax");
    const W = input.elementWidth;
    clampedInstallMoisture = clamp(input.installMoisture);
    clampedRoomMin = clamp(input.roomMoistureMin);
    clampedRoomMax = clamp(input.roomMoistureMax);
    swellToMax = W * (coefficient / 100) * (clampedRoomMax - clampedInstallMoisture);
    shrinkToMin = W * (coefficient / 100) * (clampedInstallMoisture - clampedRoomMin);
    totalSwing = W * (coefficient / 100) * (clampedRoomMax - clampedRoomMin);
  }

  return {
    ok: true,
    grainDirection: input.grainDirection,
    clampedInitialMoisture: mc0,
    clampedFinalMoisture: mc1,
    dimensionChange,
    dimensionChangePercent: (dimensionChange / D0) * 100,
    finalDimension,
    derivedCoefficient,
    swellToMax,
    shrinkToMin,
    totalSwing,
    clampedInstallMoisture,
    clampedRoomMin,
    clampedRoomMax,
  };
}
