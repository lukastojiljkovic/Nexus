/**
 * „Dizajn i priprema za štampu" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` states
 * it: the rail groups by category and the profile filters by pack, but a
 * maintainer asks „where does the spine calculator live", and `pro/dizajn.ts`
 * answers it where `pro/geometry.ts` would not. A tool several packs share lives
 * in the file of its FIRST pack, a rule with no judgement in it.
 *
 * **These are pure functions and they refuse rather than repair.** No dates, no
 * randomness, no locale, no I/O. An input that cannot produce an answer returns
 * `fail("<inputName>")` rather than a clamped or defaulted number — a zero
 * printed for „nothing typed yet" is the defect that reaches the plate.
 *
 * **Nothing here is a verdict, and in this pack nothing has to be.** Every tool
 * is `riskClass: "none"`: a spine is millimetres, a ΔE is a number, an
 * imposition is a table of page numbers. No tool takes a regulatory limit, which
 * is why `ratioAgainst` — the only comparison a limit-bearing tool may draw — is
 * deliberately not imported here. Where a number could be read as advice (which
 * orientation yields more, whether a printed check digit matches a computed one)
 * the result reports the two quantities and names the comparison for what it is.
 *
 * **No user-facing text.** `reason` is an ASCII key the surface's own Serbian
 * table turns into a line, which is what lets the maths be tested against
 * hand-worked numbers rather than against copy.
 */

import {
  ceilSnapped,
  fail,
  floorSnapped,
  isInRange,
  isIntegerIn,
  isNonNegative,
  isPositive,
  quotient,
  type ProResult,
} from "./result.js";

/** Standard gravity is not needed here; this is the inch, and it is exact. */
const MM_PER_INCH = 25.4;

/** CSS Values and Units Module Level 3: the reference pixel is 1/96 in. */
const CSS_PX_PER_INCH = 96;

/** The PostScript/DTP point is 1/72 in by definition. */
const PT_PER_INCH = 72;

/** Definition of the pica. */
const PT_PER_PICA = 12;

/** CSS Values and Units Module Level 3 defines Q as exactly a quarter millimetre. */
const MM_PER_Q = 0.25;

/** Android platform documentation: 1 dp = 1 px at the 160 dpi (mdpi) baseline. */
const DP_BASELINE_DPI = 160;

/** Euclid, on whole numbers only — the caller checks that both sides are integers. */
function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const rest = x % y;
    x = y;
    y = rest;
  }
  return x;
}

/**
 * How many pieces of `piece` fit an `usable` run with a `gutter` between each
 * pair: n*piece + (n−1)*gutter ≤ usable rearranges to n ≤ (usable + gutter) /
 * (piece + gutter). Written once because `columnGrid`, `rollYield` and
 * `sheetImposition` all need exactly this rearrangement — the review's own
 * complaint about the sheet and roll tools duplicating it was that two hand
 * copies are two chances for one to lose the `+ gutter`.
 */
function packCount(usable: number, piece: number, gutter: number): number {
  return usable <= 0 ? 0 : floorSnapped((usable + gutter) / (piece + gutter));
}

/**
 * mm → px at a given pixel density. Shared by `typographicUnits` and
 * `printResolution`, which the review flagged as the same identity written
 * twice in the same file — one helper, two callers, never two transcriptions
 * of `25.4` that could drift apart.
 */
function mmToPxAt(mm: number, pixelsPerInch: number): number {
  return (mm * pixelsPerInch) / MM_PER_INCH;
}

/** px → mm at a given pixel density — the inverse of `mmToPxAt`. */
function pxToMmAt(px: number, pixelsPerInch: number): number {
  return (px * MM_PER_INCH) / pixelsPerInch;
}

/* ------------------------------------------------------------------ *
 * Odnos stranica — aspect ratio, fit, letterbox bars and crop
 * ------------------------------------------------------------------ */

/**
 * How the source is placed in the frame. Five ordinary answers, none of them a
 * default the tool may pick on the user's behalf: `contain` letterboxes,
 * `cover` crops, the two exact modes honour one axis, `stretch` distorts.
 */
export type FitMode = "contain" | "cover" | "exactWidth" | "exactHeight" | "stretch";

export type FitRounding = "none" | "wholePixel";

export interface AspectRatioInput {
  /** Source width, in px or mm — one unit for every field on this input. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Frame width. Required by every mode except `exactHeight`. */
  readonly targetWidth?: number | undefined;
  /** Frame height. Required by every mode except `exactWidth`. */
  readonly targetHeight?: number | undefined;
  readonly mode: FitMode;
  readonly roundTo: FitRounding;
}

export interface AspectRatioFit {
  /** Reduced integer ratio — only when BOTH source sides are whole numbers. */
  readonly ratioWidth: number | undefined;
  readonly ratioHeight: number | undefined;
  /** sourceWidth / sourceHeight, always available. */
  readonly decimalRatio: number;
  /** The single uniform factor; undefined for `stretch`, which has two. */
  readonly scale: number | undefined;
  readonly scaleX: number;
  readonly scaleY: number;
  /** scaleX / scaleY — exactly 1 whenever the fit is uniform. */
  readonly distortion: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  /** The size after `roundTo`; identical to the raw size when `none`. */
  readonly displayWidth: number;
  readonly displayHeight: number;
  /**
   * Ratio of the DISPLAYED size — how far independent rounding moved it.
   * Undefined only when `roundTo: "wholePixel"` rounds an axis to zero, which
   * a sub-pixel frame can do; the raw `decimalRatio` above is never affected.
   */
  readonly displayRatio: number | undefined;
  /**
   * displayWidth − outputWidth, in frame units. Zero when `roundTo` is `none`.
   *
   * Printed rather than left implicit: rounding each axis on its own can move
   * a `contain` bar by up to half a pixel per side, so the two bars a layout
   * tool draws either side of a letterboxed image can end up one pixel apart
   * even though the fit was uniform. This is the number that says why.
   */
  readonly roundingRemainderWidth: number;
  readonly roundingRemainderHeight: number;
  /** Letterbox bar per side, in frame units. Only `contain` produces bars. */
  readonly barWidth: number | undefined;
  readonly barHeight: number | undefined;
  /** Crop per side, in frame units. Only `cover` crops. */
  readonly cropWidth: number | undefined;
  readonly cropHeight: number | undefined;
  /** The same crop expressed in SOURCE units — crop / scale. */
  readonly cropWidthSource: number | undefined;
  readonly cropHeightSource: number | undefined;
  /** How much of the source survives the crop, in source units. */
  readonly visibleSourceWidth: number | undefined;
  readonly visibleSourceHeight: number | undefined;
}

/**
 * Fit a source rectangle into a frame, and say what that costs — bars or crop.
 *
 * **The scale factor is never rounded**, only the displayed size is. Rounding
 * `s` and multiplying is how a 1080-wide export becomes 1079: the two axes are
 * derived from one factor, so the factor has to stay exact and the rounding has
 * to happen once, at the end, per axis. Rounding both axes independently can
 * move the ratio by up to half a pixel per axis, which is why `displayRatio` is
 * reported next to `decimalRatio` instead of being assumed equal to it.
 *
 * The integer ratio appears only when both source sides are whole numbers,
 * because `gcd` on a fraction is not a ratio, it is a coincidence of rounding.
 */
export function aspectRatioFit(input: AspectRatioInput): ProResult<AspectRatioFit> {
  const { sourceWidth: w, sourceHeight: h, mode, roundTo } = input;
  if (!isPositive(w)) return fail("sourceWidth");
  if (!isPositive(h)) return fail("sourceHeight");
  if (roundTo !== "none" && roundTo !== "wholePixel") return fail("roundTo");
  const tw = input.targetWidth;
  const th = input.targetHeight;

  let scaleX: number;
  let scaleY: number;
  switch (mode) {
    case "contain":
    case "cover":
    case "stretch": {
      if (tw === undefined || !isPositive(tw)) return fail("targetWidth");
      if (th === undefined || !isPositive(th)) return fail("targetHeight");
      const fx = tw / w;
      const fy = th / h;
      if (mode === "stretch") {
        scaleX = fx;
        scaleY = fy;
      } else {
        // contain takes the factor that fits BOTH axes, cover the one that
        // covers both; every other difference between the two follows from this.
        const uniform = mode === "contain" ? Math.min(fx, fy) : Math.max(fx, fy);
        scaleX = uniform;
        scaleY = uniform;
      }
      break;
    }
    case "exactWidth": {
      if (tw === undefined || !isPositive(tw)) return fail("targetWidth");
      scaleX = tw / w;
      scaleY = scaleX;
      break;
    }
    case "exactHeight": {
      if (th === undefined || !isPositive(th)) return fail("targetHeight");
      scaleY = th / h;
      scaleX = scaleY;
      break;
    }
    default:
      return fail("mode");
  }

  const outputWidth = w * scaleX;
  const outputHeight = h * scaleY;
  const round = roundTo === "wholePixel" ? Math.round : (value: number): number => value;
  const displayWidth = round(outputWidth);
  const displayHeight = round(outputHeight);

  const whole = Number.isInteger(w) && Number.isInteger(h);
  const divisor = whole ? gcd(w, h) : 0;

  const bar = mode === "contain";
  const crop = mode === "cover";
  return {
    ok: true,
    ratioWidth: whole && divisor > 0 ? w / divisor : undefined,
    ratioHeight: whole && divisor > 0 ? h / divisor : undefined,
    decimalRatio: w / h,
    scale: mode === "stretch" ? undefined : scaleX,
    scaleX,
    scaleY,
    distortion: scaleX / scaleY,
    outputWidth,
    outputHeight,
    displayWidth,
    displayHeight,
    // A sub-pixel frame can round BOTH axes to 0, and 0/0 is refused rather
    // than reported as NaN.
    displayRatio: quotient(displayWidth, displayHeight),
    roundingRemainderWidth: displayWidth - outputWidth,
    roundingRemainderHeight: displayHeight - outputHeight,
    barWidth: bar && tw !== undefined ? (tw - outputWidth) / 2 : undefined,
    barHeight: bar && th !== undefined ? (th - outputHeight) / 2 : undefined,
    cropWidth: crop && tw !== undefined ? (outputWidth - tw) / 2 : undefined,
    cropHeight: crop && th !== undefined ? (outputHeight - th) / 2 : undefined,
    cropWidthSource: crop && tw !== undefined ? (outputWidth - tw) / 2 / scaleX : undefined,
    cropHeightSource: crop && th !== undefined ? (outputHeight - th) / 2 / scaleY : undefined,
    visibleSourceWidth: crop && tw !== undefined ? tw / scaleX : undefined,
    visibleSourceHeight: crop && th !== undefined ? th / scaleY : undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Prored i vertikalni ritam — line height against a baseline grid
 * ------------------------------------------------------------------ */

export type LineHeightUnit = "multiplier" | "px";

export type SnapMode = "up" | "nearest" | "down";

export interface BaselineRhythmInput {
  readonly fontSize: number;
  /** Read as a multiplier or as px, whichever `lineHeightUnit` says. */
  readonly lineHeight: number;
  readonly lineHeightUnit: LineHeightUnit;
  /** The baseline grid step, in px. */
  readonly gridUnit: number;
  /** Column height in px, when the user wants the line count too. */
  readonly columnHeight?: number | undefined;
  readonly snapMode: SnapMode;
}

export interface RhythmColumn {
  readonly lines: number;
  /** lines * lineHeight, in px. */
  readonly used: number;
  readonly leftover: number;
}

export interface BaselineRhythm {
  readonly lineHeightPx: number;
  readonly multiplier: number;
  /** lineHeightPx − fontSize. NEGATIVE when the line is set tighter than the type. */
  readonly leading: number;
  readonly halfLeading: number;
  /** How far past the last whole grid unit the line height sits, in px. */
  readonly gridRemainder: number;
  readonly onGrid: boolean;
  readonly snapped: number;
  readonly snappedMultiplier: number;
  readonly snappedLeading: number;
  /** Column figures for the RAW line height; undefined when no column was given. */
  readonly column: RhythmColumn | undefined;
  /** The same figures for the snapped line height — the comparison the decision needs. */
  readonly snappedColumn: RhythmColumn | undefined;
}

/**
 * Line height in px, its distance from the baseline grid, and how many lines a
 * column holds — for the raw value and for the snapped one, side by side.
 *
 * **Negative leading is not an error.** A display line set at 0.9 of the type
 * size is ordinary typography; clamping it at zero would hide the very number
 * the designer typed the value to see.
 *
 * **The grid remainder is computed in whole THOUSANDTHS of a pixel, as
 * integers, never as a float modulo.** `1.4 * 18` is `25.199999999999999` and
 * `1.5 * 16` can just as easily land a few ulps on the wrong side of a whole
 * multiple of the grid; a naive `lh − floor(lh/grid)*grid` then answers
 * „off grid" for a line height that is exactly on it, in precisely the clean
 * cases this tool exists to get right. Rounding both operands to the nearest
 * thousandth of a pixel first and doing the floor/mod in INTEGER milli-pixels
 * removes the float error rather than papering over it with an epsilon: two
 * integers whose true quotient is a whole number divide to exactly that whole
 * number in IEEE 754, with no tolerance band needed at all.
 */
export function baselineRhythm(input: BaselineRhythmInput): ProResult<BaselineRhythm> {
  const { fontSize, lineHeight, lineHeightUnit, gridUnit, snapMode } = input;
  if (!isPositive(fontSize)) return fail("fontSize");
  if (!Number.isFinite(lineHeight)) return fail("lineHeight");
  if (!isPositive(gridUnit)) return fail("gridUnit");
  if (lineHeightUnit !== "px" && lineHeightUnit !== "multiplier") return fail("lineHeightUnit");
  if (snapMode !== "up" && snapMode !== "down" && snapMode !== "nearest") return fail("snapMode");

  const lineHeightPx = lineHeightUnit === "px" ? lineHeight : lineHeight * fontSize;
  if (!isPositive(lineHeightPx)) return fail("lineHeight");

  // Milli-pixels: both are integers, so the division below is exact whenever
  // the mathematical quotient is a whole number — no epsilon required.
  const milliLine = Math.round(lineHeightPx * 1000);
  const milliGrid = Math.round(gridUnit * 1000);
  // Both inputs pass `isPositive` above, but a value below half a milli-pixel
  // (0.0004999… px) quantises to zero — the same trap `quotient` exists to
  // catch, here applied to the QUANTISED operand rather than the raw one: an
  // `isPositive` guard on `gridUnit` cannot see that its own rounding is about
  // to manufacture a zero divisor two lines below.
  if (milliLine === 0) return fail("lineHeight");
  if (milliGrid === 0) return fail("gridUnit");
  const milliRemainder = milliLine % milliGrid;
  const gridRemainder = milliRemainder / 1000;
  const onGrid = milliRemainder === 0;

  const gridQuotient = milliLine / milliGrid;
  const steps =
    snapMode === "up"
      ? Math.ceil(gridQuotient)
      : snapMode === "down"
        ? Math.floor(gridQuotient)
        : Math.round(gridQuotient);
  const snapped = steps * gridUnit;

  const columnHeight = input.columnHeight;
  if (columnHeight !== undefined && !isPositive(columnHeight)) return fail("columnHeight");
  const fit = (step: number): RhythmColumn | undefined => {
    if (columnHeight === undefined) return undefined;
    const lines = floorSnapped(columnHeight / step);
    const used = lines * step;
    return { lines, used, leftover: columnHeight - used };
  };

  return {
    ok: true,
    lineHeightPx,
    multiplier: lineHeightPx / fontSize,
    leading: lineHeightPx - fontSize,
    halfLeading: (lineHeightPx - fontSize) / 2,
    gridRemainder,
    onGrid,
    snapped,
    snappedMultiplier: snapped / fontSize,
    snappedLeading: snapped - fontSize,
    column: fit(lineHeightPx),
    snappedColumn: snapped > 0 ? fit(snapped) : undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Debljina hrbata — book spine and flat cover
 * ------------------------------------------------------------------ */

/** Which of the three routes produced the caliper actually used. */
export type SpineCaliperSource = "typed" | "grammage" | "measured";

/**
 * `2 * coverWidth + spine` is the flat width of a SOFT cover with no wrap and
 * no groove. A hard case adds a groove either side of the spine board for the
 * board to hinge on; `soft` has none.
 */
export type SpineBindingStyle = "soft" | "hard";

export interface BookSpineInput {
  /** PAGES, not leaves. An odd count still occupies a whole leaf. */
  readonly pageCount: number;
  /** Measured thickness of ONE leaf, in mm. Wins over the other two routes. */
  readonly paperCaliper?: number | undefined;
  /** Grammage in g/m² — labelled beside the caliper it derives, never alone. */
  readonly grammage?: number | undefined;
  /** Bulk in cm³/g, the figure the paper maker publishes. */
  readonly bulk?: number | undefined;
  /** Thickness of ONE cover board, in mm. */
  readonly coverCaliper: number;
  /** Glue, endpapers, boards — whatever the binder adds, in mm. */
  readonly extraAllowance: number;
  /** Width of one cover panel, in mm, for the flat cover figure. */
  readonly coverWidth?: number | undefined;
  readonly coverHeight?: number | undefined;
  /** Measured height of the whole block, in mm — the third caliper route. */
  readonly measuredStack?: number | undefined;
  /**
   * Turn-in / wrap allowance beyond EACH outer edge of the flat cover, in mm.
   * `2 * coverWidth + spine` alone is exact only for a cover trimmed flush with
   * the block, which is not what a wrap-around cover is — the review's point.
   */
  readonly edgeWrap: number;
  readonly bindingStyle: SpineBindingStyle;
  /** Width of ONE hinge groove, in mm. Read only when `bindingStyle` is `hard`. */
  readonly hingeGroove: number;
}

export interface BookSpine {
  readonly leaves: number;
  /** Thickness of one leaf, in mm. */
  readonly caliper: number;
  readonly caliperSource: SpineCaliperSource;
  /** leaves * caliper, in mm. */
  readonly block: number;
  readonly spine: number;
  /** 2 * coverWidth + spine + 2 * edgeWrap, plus two grooves for a hard case. */
  readonly flatCoverWidth: number | undefined;
  /** coverHeight + 2 * edgeWrap — the wrap is a turn-in at EVERY outer edge, head and tail included. */
  readonly flatCoverHeight: number | undefined;
}

/**
 * Spine thickness from a page count and a paper, and the flat cover it implies.
 *
 * **The caliper is per LEAF.** A micrometer reading taken on a single sheet is
 * the right number; one taken across a folded signature is four leaves and will
 * quadruple the spine. `grammage * bulk / 1000` is dimensionally exact rather
 * than a trade rule of thumb: (g/m²)·(cm³/g) = cm³/m² = 1e-4 cm = 1e-3 mm, so 80
 * g/m² at bulk 1.25 is 100/1000 = 0.1 mm and no table is being consulted — and
 * the derived caliper is always returned, never hidden behind the grammage/bulk
 * pair, because a bulk field typed with a caliper's own value (0.10 instead of
 * 1.25) produces a spine 12.5× too thin with nothing else to catch it.
 *
 * `leaves = ceil(pages / 2)` — an odd page count is a real book with a blank
 * verso, and rounding it down would lose a whole leaf of thickness.
 *
 * **The flat cover carries the wrap and, for a hard case, the groove.**
 * `2 * coverWidth + spine` alone is only ever right for a soft cover trimmed
 * flush with the block; a wrap-around cover needs `edgeWrap` added at each
 * outer edge, and a case binding needs a hinge groove either side of the
 * spine board for the boards to open on. „Each outer edge" is literal: a
 * turn-in wraps the head and tail exactly as it wraps the fore-edges, so
 * `flatCoverHeight` carries `2 * edgeWrap` too — only the spine, which runs
 * along the WIDTH axis, is absent from the height figure.
 */
export function bookSpine(input: BookSpineInput): ProResult<BookSpine> {
  const { pageCount, coverCaliper, extraAllowance, edgeWrap, hingeGroove, bindingStyle } = input;
  if (!isIntegerIn(pageCount, 1, 20000)) return fail("pageCount");
  if (!isNonNegative(coverCaliper)) return fail("coverCaliper");
  if (!isNonNegative(extraAllowance)) return fail("extraAllowance");
  if (!isNonNegative(edgeWrap)) return fail("edgeWrap");
  if (!isNonNegative(hingeGroove)) return fail("hingeGroove");
  if (bindingStyle !== "soft" && bindingStyle !== "hard") return fail("bindingStyle");

  const leaves = Math.ceil(pageCount / 2);

  let caliper: number;
  let caliperSource: SpineCaliperSource;
  if (input.paperCaliper !== undefined) {
    if (!isPositive(input.paperCaliper)) return fail("paperCaliper");
    caliper = input.paperCaliper;
    caliperSource = "typed";
  } else if (input.grammage !== undefined || input.bulk !== undefined) {
    if (input.grammage === undefined || !isPositive(input.grammage)) return fail("grammage");
    if (input.bulk === undefined || !isPositive(input.bulk)) return fail("bulk");
    caliper = (input.grammage * input.bulk) / 1000;
    caliperSource = "grammage";
  } else if (input.measuredStack !== undefined) {
    if (!isPositive(input.measuredStack)) return fail("measuredStack");
    caliper = input.measuredStack / leaves;
    caliperSource = "measured";
  } else {
    return fail("caliper");
  }

  const block = leaves * caliper;
  const spine = block + 2 * coverCaliper + extraAllowance;

  const coverWidth = input.coverWidth;
  const coverHeight = input.coverHeight;
  if (coverWidth !== undefined && !isPositive(coverWidth)) return fail("coverWidth");
  if (coverHeight !== undefined && !isPositive(coverHeight)) return fail("coverHeight");

  const grooveTotal = bindingStyle === "hard" ? 2 * hingeGroove : 0;
  return {
    ok: true,
    leaves,
    caliper,
    caliperSource,
    block,
    spine,
    // The spine runs along the width axis only; the wrap runs along BOTH.
    flatCoverWidth:
      coverWidth === undefined ? undefined : 2 * coverWidth + spine + 2 * edgeWrap + grooveTotal,
    flatCoverHeight: coverHeight === undefined ? undefined : coverHeight + 2 * edgeWrap,
  };
}

/* ------------------------------------------------------------------ *
 * Mreža kolona — the column grid
 * ------------------------------------------------------------------ */

export interface ColumnGridInput {
  readonly containerWidth: number;
  readonly columns: number;
  /** Space BETWEEN columns, in px. There are columns − 1 of them. */
  readonly gutter: number;
  /** Margin on each side of the container, in px. It is applied twice. */
  readonly outerMargin: number;
  /** k, when the user wants one particular span called out. */
  readonly spanColumns?: number | undefined;
  /** The reverse question: how many columns of at least this width fit. */
  readonly minColumnWidth?: number | undefined;
}

export interface ColumnGrid {
  readonly contentWidth: number;
  /** Undefined when the gutters alone exceed the content — see `minRequiredContentWidth`. */
  readonly columnWidth: number | undefined;
  readonly columnPercent: number | undefined;
  /** Index k − 1 holds the width of a k-column span, k = 1…columns. Empty when no grid exists. */
  readonly spans: readonly number[];
  /** Index i − 1 holds column i's left edge, measured from the container's left. */
  readonly leftEdges: readonly number[];
  readonly span: number | undefined;
  readonly maxColumns: number | undefined;
  /**
   * `(columns − 1) * gutter` — the content width the gutters alone consume.
   * Present ONLY when no valid grid exists, as the useful answer at that
   * boundary: the content has to exceed this figure before a single pixel is
   * left for a column.
   */
  readonly minRequiredContentWidth: number | undefined;
}

/**
 * Column width, every span, every left edge, and the reverse column count.
 *
 * **The column width is not rounded.** A fractional column is exactly what a
 * percentage grid produces in a browser, and rounding it here would hide the
 * sub-pixel the browser actually renders — the one that makes a 12-column span
 * miss the container's right edge.
 *
 * **A negative column is never printed as a number.** When the gutters alone
 * exceed the content, that is not a column of negative width, it is the
 * absence of a grid — and the useful thing to hand back at that boundary is
 * how much content WOULD be needed, not a refusal with no number in it.
 *
 * `maxColumns` uses the shared `packCount` rearrangement: n columns of w with
 * n − 1 gutters need n*w + (n − 1)*g ≤ content, so n ≤ (content + g)/(w + g).
 */
export function columnGrid(input: ColumnGridInput): ProResult<ColumnGrid> {
  const { containerWidth, columns, gutter, outerMargin } = input;
  if (!isPositive(containerWidth)) return fail("containerWidth");
  if (!isIntegerIn(columns, 1, 24)) return fail("columns");
  if (!isNonNegative(gutter)) return fail("gutter");
  if (!isNonNegative(outerMargin)) return fail("outerMargin");

  const contentWidth = containerWidth - 2 * outerMargin;
  if (contentWidth <= 0) return fail("outerMargin");

  const spanColumns = input.spanColumns;
  if (spanColumns !== undefined && !isIntegerIn(spanColumns, 1, columns)) {
    return fail("spanColumns");
  }
  const minColumnWidth = input.minColumnWidth;
  if (minColumnWidth !== undefined && !isPositive(minColumnWidth)) return fail("minColumnWidth");
  const maxColumns =
    minColumnWidth === undefined ? undefined : packCount(contentWidth, minColumnWidth, gutter);

  const columnWidth = (contentWidth - (columns - 1) * gutter) / columns;
  if (columnWidth <= 0) {
    return {
      ok: true,
      contentWidth,
      columnWidth: undefined,
      columnPercent: undefined,
      spans: [],
      leftEdges: [],
      span: undefined,
      maxColumns,
      minRequiredContentWidth: (columns - 1) * gutter,
    };
  }

  const spans: number[] = [];
  const leftEdges: number[] = [];
  for (let k = 1; k <= columns; k += 1) {
    spans.push(k * columnWidth + (k - 1) * gutter);
    leftEdges.push(outerMargin + (k - 1) * (columnWidth + gutter));
  }

  return {
    ok: true,
    contentWidth,
    columnWidth,
    columnPercent: (columnWidth / contentWidth) * 100,
    spans,
    leftEdges,
    span: spanColumns === undefined ? undefined : spans[spanColumns - 1],
    maxColumns,
    minRequiredContentWidth: undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Proračun obima teksta — copyfitting
 * ------------------------------------------------------------------ */

export interface CopyfittingInput {
  /** Characters INCLUDING spaces. */
  readonly characterCount: number;
  /** Typed directly, or derived from the two fields below. */
  readonly charactersPerLine?: number | undefined;
  readonly columnWidth?: number | undefined;
  /** Average character width in mm, MEASURED on the real setting. */
  readonly averageCharacterWidth?: number | undefined;
  /** Typed directly, or derived from the two fields below. */
  readonly linesPerColumn?: number | undefined;
  readonly columnHeight?: number | undefined;
  /** Line height in mm — the same unit as the column height. */
  readonly lineHeight?: number | undefined;
  readonly columnsPerPage: number;
  /** The reverse question: land the text on exactly this many pages. */
  readonly targetPages?: number | undefined;
  /**
   * Number of paragraphs in the piece, when known. `totalLines` alone is a
   * LOWER bound — it assumes every line fills to the measure, which is false
   * at the end of every paragraph — so this feeds `totalLinesUpperBound`.
   */
  readonly paragraphs?: number | undefined;
}

export interface Copyfitting {
  readonly charactersPerLine: number;
  readonly linesPerColumn: number;
  /** ceil(characters / cpl) — the LOWER bound: every line filled to the measure. */
  readonly totalLines: number;
  /**
   * `totalLines + paragraphs − 1` — the exact UPPER bound, since each paragraph
   * after the first can waste up to one whole line at its own break. Undefined
   * without a paragraph count; still arithmetic, not an estimate, once one is given.
   */
  readonly totalLinesUpperBound: number | undefined;
  readonly linesPerPage: number;
  readonly pages: number;
  readonly lastPageLines: number;
  /** Per cent of the last page that carries text. */
  readonly lastPageFill: number;
  readonly requiredCharactersPerLine: number | undefined;
}

/**
 * How many lines, columns and pages a character count occupies — an estimate
 * built from an average character width the user measured, not a typesetting.
 *
 * The model assumes evenly set prose: it knows nothing of headings, widows or
 * hyphenation, so the page count is a planning figure and the surface says so.
 * Paragraph breaks are the one exception with an exact fix rather than a
 * caveat: `totalLines` is a LOWER bound because it assumes every line fills to
 * the measure, which the last line of a paragraph never does, so a `paragraphs`
 * count turns it into a true upper bound too, `totalLines + paragraphs − 1`.
 *
 * What the arithmetic gets exactly right either way: the floors are done in
 * whole HUNDREDTHS of a millimetre, as integers, rather than as a float
 * division with an epsilon bolted on. `82 / 2.05` and its neighbours land
 * within an ulp of a whole number in binary floating point, and a naive floor
 * is then one character short on EVERY line of the job — rounding both
 * operands to centi-millimetres first removes the float error instead of
 * tolerating it, because two integers whose true quotient is a whole number
 * divide to exactly that whole number in IEEE 754.
 */
export function copyfitting(input: CopyfittingInput): ProResult<Copyfitting> {
  const { characterCount, columnsPerPage } = input;
  if (!isIntegerIn(characterCount, 1, 1e9)) return fail("characterCount");
  if (!isIntegerIn(columnsPerPage, 1, 12)) return fail("columnsPerPage");

  // Integer centi-millimetres: see the note above on why this replaces a
  // float floor with an epsilon. `quotient` is the guard against the OTHER
  // half of the same trap: an operand under half a centi-millimetre (0.004mm)
  // passes `isPositive` yet rounds to zero once quantised, and dividing by
  // that zero must refuse rather than manufacture an `Infinity` that slips
  // straight past a `< 1` check.
  const floorMm = (numerator: number, denominator: number): number | undefined => {
    const q = quotient(Math.round(numerator * 100), Math.round(denominator * 100));
    return q === undefined ? undefined : Math.floor(q);
  };

  let charactersPerLine: number;
  if (input.charactersPerLine !== undefined) {
    if (!isIntegerIn(input.charactersPerLine, 1, 1000)) return fail("charactersPerLine");
    charactersPerLine = input.charactersPerLine;
  } else {
    const width = input.columnWidth;
    const perChar = input.averageCharacterWidth;
    if (width === undefined || !isPositive(width)) return fail("columnWidth");
    if (perChar === undefined || !isPositive(perChar)) return fail("averageCharacterWidth");
    const cpl = floorMm(width, perChar);
    if (cpl === undefined) return fail("averageCharacterWidth");
    charactersPerLine = cpl;
    if (charactersPerLine < 1) return fail("charactersPerLine");
  }

  let linesPerColumn: number;
  if (input.linesPerColumn !== undefined) {
    if (!isIntegerIn(input.linesPerColumn, 1, 1000)) return fail("linesPerColumn");
    linesPerColumn = input.linesPerColumn;
  } else {
    const height = input.columnHeight;
    const line = input.lineHeight;
    if (height === undefined || !isPositive(height)) return fail("columnHeight");
    if (line === undefined || !isPositive(line)) return fail("lineHeight");
    const lpc = floorMm(height, line);
    if (lpc === undefined) return fail("lineHeight");
    linesPerColumn = lpc;
    if (linesPerColumn < 1) return fail("linesPerColumn");
  }

  // Both operands are whole numbers here, and IEEE division of exact integers is
  // correctly rounded — so these ceilings need no epsilon, unlike the floors above.
  const totalLines = Math.ceil(characterCount / charactersPerLine);
  const linesPerPage = linesPerColumn * columnsPerPage;
  const pages = Math.ceil(totalLines / linesPerPage);
  const lastPageLines = totalLines - (pages - 1) * linesPerPage;

  const targetPages = input.targetPages;
  if (targetPages !== undefined && !isIntegerIn(targetPages, 1, 100000)) return fail("targetPages");
  const paragraphs = input.paragraphs;
  if (paragraphs !== undefined && !isIntegerIn(paragraphs, 1, 1e6)) return fail("paragraphs");

  return {
    ok: true,
    charactersPerLine,
    linesPerColumn,
    totalLines,
    totalLinesUpperBound: paragraphs === undefined ? undefined : totalLines + paragraphs - 1,
    linesPerPage,
    pages,
    lastPageLines,
    lastPageFill: (lastPageLines / linesPerPage) * 100,
    requiredCharactersPerLine:
      targetPages === undefined
        ? undefined
        : Math.ceil(characterCount / (targetPages * linesPerPage)),
  };
}

/* ------------------------------------------------------------------ *
 * Tipografske jedinice — px, rem, em, pt, pc, mm, cm, in, Q, dp
 * ------------------------------------------------------------------ */

export type TypographicUnit = "px" | "rem" | "em" | "pt" | "pc" | "mm" | "cm" | "in" | "Q" | "dp";

export type AssetScale = 1 | 2 | 3;

export interface TypographicUnitsInput {
  /** May be negative — a negative margin is a real thing. */
  readonly value: number;
  readonly fromUnit: TypographicUnit;
  /** px the `rem` column is referred to. */
  readonly rootFontSize: number;
  /** px the `em` column is referred to. */
  readonly parentFontSize: number;
  /** Real screen or press density. Absent means the device row is omitted. */
  readonly deviceDpi?: number | undefined;
  readonly assetScale: AssetScale;
}

export interface TypographicUnits {
  readonly px: number;
  readonly rem: number;
  readonly em: number;
  readonly pt: number;
  readonly pc: number;
  readonly mm: number;
  readonly cm: number;
  readonly inch: number;
  readonly q: number;
  /** CSS px expressed back as Android dp at the 160 dpi baseline. */
  readonly dp: number;
  /** Whole device pixels at `deviceDpi`; undefined when no density was given. */
  readonly devicePx: number | undefined;
  readonly assetPx: number;
  readonly assetPx1x: number;
  readonly assetPx2x: number;
  readonly assetPx3x: number;
  /** Echoed so the surface can say which font size the rem/em columns used. */
  readonly rootFontSizeUsed: number;
  readonly parentFontSizeUsed: number;
  /**
   * Echoed so the surface can say `devicePx` was computed „at a given
   * density" rather than as a fact about the device: a real screen reports a
   * STEPPED bucket (mdpi/hdpi/…/xxxhdpi), never its physical dpi, so this
   * number is only ever as good as what was typed into `deviceDpi`.
   */
  readonly deviceDpiUsed: number | undefined;
}

/**
 * One length in every unit a designer meets, plus the device pixels and the
 * asset export sizes.
 *
 * **Everything converts through the inch**, which is what makes the table
 * consistent: px/96 = pt/72 = pc*12/72 = mm/25.4 = Q/101.6 are all the same
 * length. The two font-relative units and `dp` are the exceptions and they are
 * exceptions for different reasons — rem and em are ratios to a font size the
 * user supplies, while dp is a relation to a SCREEN, not to the CSS inch.
 *
 * The two happen to agree: dp → CSS px is value * 96/160 = value * 0.6, and
 * device px from CSS px is px * dpi/96, so a dp converted through CSS px gives
 * value * dpi/160 — the Android definition, arrived at rather than special-cased.
 *
 * The @2x and @3x figures are `round(px * scale)`, not `round(px) * scale`: an
 * export built on an already-rounded number compounds the same half pixel three
 * times.
 */
export function typographicUnits(input: TypographicUnitsInput): ProResult<TypographicUnits> {
  const { value, fromUnit, rootFontSize, parentFontSize, assetScale } = input;
  if (!Number.isFinite(value)) return fail("value");
  if (!isPositive(rootFontSize)) return fail("rootFontSize");
  if (!isPositive(parentFontSize)) return fail("parentFontSize");
  if (assetScale !== 1 && assetScale !== 2 && assetScale !== 3) return fail("assetScale");

  const perInch = CSS_PX_PER_INCH;
  let px: number;
  switch (fromUnit) {
    case "px":
      px = value;
      break;
    case "rem":
      px = value * rootFontSize;
      break;
    case "em":
      px = value * parentFontSize;
      break;
    case "pt":
      px = (value * perInch) / PT_PER_INCH;
      break;
    case "pc":
      px = (value * PT_PER_PICA * perInch) / PT_PER_INCH;
      break;
    case "mm":
      px = mmToPxAt(value, perInch);
      break;
    case "cm":
      px = mmToPxAt(value * 10, perInch);
      break;
    case "in":
      px = value * perInch;
      break;
    case "Q":
      px = mmToPxAt(value * MM_PER_Q, perInch);
      break;
    case "dp":
      px = (value * perInch) / DP_BASELINE_DPI;
      break;
    default:
      return fail("fromUnit");
  }

  const deviceDpi = input.deviceDpi;
  if (deviceDpi !== undefined && !isPositive(deviceDpi)) return fail("deviceDpi");

  const inch = px / perInch;
  const mm = inch * MM_PER_INCH;
  return {
    ok: true,
    px,
    rem: px / rootFontSize,
    em: px / parentFontSize,
    pt: inch * PT_PER_INCH,
    pc: (inch * PT_PER_INCH) / PT_PER_PICA,
    mm,
    cm: mm / 10,
    inch,
    q: mm / MM_PER_Q,
    dp: (px * DP_BASELINE_DPI) / perInch,
    devicePx: deviceDpi === undefined ? undefined : Math.round((px * deviceDpi) / perInch),
    assetPx: Math.round(px * assetScale),
    assetPx1x: Math.round(px),
    assetPx2x: Math.round(px * 2),
    assetPx3x: Math.round(px * 3),
    rootFontSizeUsed: rootFontSize,
    parentFontSizeUsed: parentFontSize,
    deviceDpiUsed: deviceDpi,
  };
}

/* ------------------------------------------------------------------ *
 * Razlika boja — ΔE*ab, ΔE94, CIEDE2000
 * ------------------------------------------------------------------ */

const DEG_PER_RAD = 180 / Math.PI;
const sinDeg = (deg: number): number => Math.sin(deg / DEG_PER_RAD);
const cosDeg = (deg: number): number => Math.cos(deg / DEG_PER_RAD);

/** atan2 in degrees, mapped into 0…360 as CIEDE2000 requires. */
function atan2Deg(y: number, x: number): number {
  const deg = Math.atan2(y, x) * DEG_PER_RAD;
  return deg < 0 ? deg + 360 : deg;
}

/**
 * 25^7, the constant in the CIEDE2000 chroma weighting. Written out because
 * `Math.pow(25, 7)` in the middle of the formula reads as if it were tunable.
 */
const POW_25_7 = 6103515625;

export interface LabColour {
  /** L*, 0…100. */
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

/** CIE 116-1995 splits the weighting constants by trade. */
export type DeltaE94Application = "graphicArts" | "textiles";

export interface ColourDifferenceInput {
  /**
   * The STANDARD / original colour. ΔE94 is asymmetric — its chroma weighting
   * is built from THIS colour alone — so which of the pair is „standard" and
   * which is „sample" changes the answer, not just its sign.
   */
  readonly colour1: LabColour;
  /** The SAMPLE / print being measured against `colour1`. */
  readonly colour2: LabColour;
  /**
   * Parametric lightness factor for CIEDE2000. Absent means the CIE reference
   * value, 1. This is independent of `de94Application`'s own kL — see
   * `kL94Used`, which is never overridden by this field.
   */
  readonly kL?: number | undefined;
  readonly kC?: number | undefined;
  readonly kH?: number | undefined;
  readonly de94Application: DeltaE94Application;
}

export interface ColourDifference {
  readonly deltaE76: number;
  readonly deltaE94: number;
  readonly deltaE00: number;
  /** The CIEDE2000 component differences — primed, not the raw ΔL, Δa, Δb. */
  readonly deltaLPrime: number;
  readonly deltaCPrime: number;
  readonly deltaHPrime: number;
  readonly kLUsed: number;
  readonly kCUsed: number;
  readonly kHUsed: number;
  /**
   * The lightness factor ΔE94 actually used: 1 for graphic arts, 2 for
   * textiles, LOCKED to `de94Application` and never taken from `kL` — CIE
   * 116-1995 defines kL = 2 as part of the same textile condition as its own
   * K1/K2 weights, and letting a typed `kL` override just this one number
   * would produce a ΔE94 that matches neither published condition.
   */
  readonly kL94Used: number;
}

/**
 * The three published colour differences between two L*a*b* colours, side by
 * side. What an acceptable difference is belongs to the user and their customer;
 * this returns numbers and no opinion about a print.
 *
 * **All trigonometry is in degrees.** CIEDE2000 is defined with 30°, 6° and 63°
 * offsets and a 275°/25° Gaussian; an implementation that leaves them in radians
 * produces plausible numbers that are wrong, which is the whole reason the
 * published test data exists.
 *
 * **The achromatic pair is the trap.** With C1' = C2' = 0 the hue difference is
 * undefined, so the standard's own branches fix Δh' = 0 and hbar' = h1' + h2';
 * an implementation that divides by the chroma product returns NaN for two
 * identical greys — the easiest comparison a user will ever make.
 *
 * The three numbers are NOT on one scale and are never converted between: ΔE*ab
 * of 1 and ΔE00 of 1 do not describe the same pair of colours.
 */
export function colourDifference(input: ColourDifferenceInput): ProResult<ColourDifference> {
  const { colour1, colour2 } = input;
  if (!isInRange(colour1.l, 0, 100) || !Number.isFinite(colour1.a) || !Number.isFinite(colour1.b)) {
    return fail("colour1");
  }
  if (!isInRange(colour2.l, 0, 100) || !Number.isFinite(colour2.a) || !Number.isFinite(colour2.b)) {
    return fail("colour2");
  }
  if (input.kL !== undefined && !isPositive(input.kL)) return fail("kL");
  if (input.kC !== undefined && !isPositive(input.kC)) return fail("kC");
  if (input.kH !== undefined && !isPositive(input.kH)) return fail("kH");
  // Unlike `roundTo` or a display-only rounding mode, this enum selects
  // between two DIFFERENT published K1/K2/kL conditions — an unrecognised
  // value must not silently compute one of them, the way the other enums in
  // this file that are true display preferences are allowed to.
  if (input.de94Application !== "graphicArts" && input.de94Application !== "textiles") {
    return fail("de94Application");
  }

  const kL = input.kL ?? 1;
  const kC = input.kC ?? 1;
  const kH = input.kH ?? 1;
  const textiles = input.de94Application === "textiles";
  // Locked to the application, never to `input.kL`: CIE 116-1995 fixes textile
  // kL = 2 as part of the SAME condition as K1 = 0.048 / K2 = 0.014, and an
  // override here would produce a ΔE94 that is neither published condition.
  const kL94 = textiles ? 2 : 1;
  const k1 = textiles ? 0.048 : 0.045;
  const k2 = textiles ? 0.014 : 0.015;

  const dL = colour2.l - colour1.l;
  const da = colour2.a - colour1.a;
  const db = colour2.b - colour1.b;
  const deltaE76 = Math.sqrt(dL * dL + da * da + db * db);

  const c1 = Math.hypot(colour1.a, colour1.b);
  const c2 = Math.hypot(colour2.a, colour2.b);
  const dC = c2 - c1;
  // max(0, …) because floating point can make a difference of two nearly equal
  // squares a very small NEGATIVE number, and sqrt of that is NaN.
  const dH94 = Math.sqrt(Math.max(0, da * da + db * db - dC * dC));
  const sC94 = 1 + k1 * c1;
  const sH94 = 1 + k2 * c1;
  const deltaE94 = Math.hypot(dL / kL94, dC / (kC * sC94), dH94 / (kH * sH94));

  const cBar = (c1 + c2) / 2;
  const cBar7 = Math.pow(cBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + POW_25_7)));
  const a1p = (1 + g) * colour1.a;
  const a2p = (1 + g) * colour2.a;
  const c1p = Math.hypot(a1p, colour1.b);
  const c2p = Math.hypot(a2p, colour2.b);
  const h1p = a1p === 0 && colour1.b === 0 ? 0 : atan2Deg(colour1.b, a1p);
  const h2p = a2p === 0 && colour2.b === 0 ? 0 : atan2Deg(colour2.b, a2p);

  const chromaProduct = c1p * c2p;
  const dLp = colour2.l - colour1.l;
  const dCp = c2p - c1p;
  let dhp: number;
  if (chromaProduct === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else {
    dhp = h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(chromaProduct) * sinDeg(dhp / 2);

  const lBarP = (colour1.l + colour2.l) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP: number;
  if (chromaProduct === 0) {
    hBarP = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarP = (h1p + h2p) / 2;
  } else {
    hBarP = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }

  const t =
    1 -
    0.17 * cosDeg(hBarP - 30) +
    0.24 * cosDeg(2 * hBarP) +
    0.32 * cosDeg(3 * hBarP + 6) -
    0.2 * cosDeg(4 * hBarP - 63);
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const cBarP7 = Math.pow(cBarP, 7);
  const rC = 2 * Math.sqrt(cBarP7 / (cBarP7 + POW_25_7));
  const sL = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -sinDeg(2 * dTheta) * rC;

  const termL = dLp / (kL * sL);
  const termC = dCp / (kC * sC);
  const termH = dHp / (kH * sH);
  const deltaE00 = Math.sqrt(termL * termL + termC * termC + termH * termH + rT * termC * termH);

  return {
    ok: true,
    deltaE76,
    deltaE94,
    deltaE00,
    deltaLPrime: dLp,
    deltaCPrime: dCp,
    deltaHPrime: dHp,
    kLUsed: kL,
    kCUsed: kC,
    kHUsed: kH,
    kL94Used: kL94,
  };
}

export interface SrgbColour {
  /** 0…255, the range a hex triplet parses to. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface SrgbLab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
  /** The white point the conversion used, echoed so the number is attributable. */
  readonly illuminant: "D65";
}

/** IEC 61966-2-1:1999 — the sRGB electro-optical transfer function. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** CIE 15 — the CIELAB f(), with its cube-root branch and its linear tail. */
function labF(t: number): number {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

/**
 * An sRGB triplet to L*a*b* through XYZ, D65-referred.
 *
 * **D65, not D50.** CSS's `lab()` is D50-referred and a value converted under
 * the wrong white point is out by more than most of the differences the ΔE tool
 * is asked about, so the illuminant comes back with the numbers rather than
 * being left for the reader to assume.
 *
 * The linear tail below 0.04045 is not decoration: it is what keeps the transfer
 * function differentiable at the origin, and dropping it moves near-black.
 */
export function srgbToLab(colour: SrgbColour): ProResult<SrgbLab> {
  if (!isInRange(colour.r, 0, 255)) return fail("r");
  if (!isInRange(colour.g, 0, 255)) return fail("g");
  if (!isInRange(colour.b, 0, 255)) return fail("b");

  const r = linearise(colour.r);
  const g = linearise(colour.g);
  const b = linearise(colour.b);

  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;

  const fx = labF(x / 0.95047);
  const fy = labF(y / 1.0);
  const fz = labF(z / 1.08883);

  return {
    ok: true,
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
    illuminant: "D65",
  };
}

/* ------------------------------------------------------------------ *
 * EAN barkod — check digit and symbol geometry
 * ------------------------------------------------------------------ */

export type Symbology = "ean13" | "ean8" | "upca";

/**
 * ISO/IEC 15420:2009 defines the STRUCTURE only: module counts, quiet-zone
 * module counts, and the check-digit algorithm. The nominal X-dimension, the
 * nominal bar heights and the (asymmetric) quiet-zone widths in millimetres
 * are not that standard's numbers — they are the GS1 General Specifications'
 * — and the two sources are kept apart in these comments because attributing
 * a figure to the wrong edition is worse than leaving it uncited.
 */
const EAN_SPECS: Record<
  Symbology,
  {
    readonly dataDigits: number;
    readonly encodedModules: number;
    readonly leftQuietModules: number;
    readonly rightQuietModules: number;
    /** GS1 General Specifications — nominal (100 %) bar height, in mm. */
    readonly nominalHeight: number;
    /** GS1 General Specifications — nominal (100 %) height INCLUDING the human-readable digits, in mm. */
    readonly nominalTotalHeight: number;
  }
> = {
  ean13: {
    dataDigits: 12,
    encodedModules: 95,
    leftQuietModules: 11,
    rightQuietModules: 7,
    nominalHeight: 22.85,
    nominalTotalHeight: 25.93,
  },
  ean8: {
    dataDigits: 7,
    encodedModules: 67,
    leftQuietModules: 7,
    rightQuietModules: 7,
    nominalHeight: 18.23,
    nominalTotalHeight: 21.31,
  },
  upca: {
    dataDigits: 11,
    encodedModules: 95,
    leftQuietModules: 9,
    rightQuietModules: 9,
    nominalHeight: 22.85,
    nominalTotalHeight: 25.93,
  },
};

/** GS1 General Specifications — nominal module width, in mm, at 100 % magnification. */
const NOMINAL_X_DIMENSION = 0.33;

export interface EanBarcodeInput {
  /** Data digits WITHOUT the check digit, as text — leading zeros are significant. */
  readonly digits: string;
  readonly symbology: Symbology;
  /**
   * Module width in mm. Give this OR `magnificationPercent`, never neither and
   * never both — a print order as often reads „print at 85 %" as it reads an
   * X-dimension in millimetres, and the two are the same number read from
   * either end, so typing both leaves one of them silently discarded.
   */
  readonly xDimension?: number | undefined;
  /** Magnification as a percentage of the nominal 0.33 mm X-dimension, e.g. 85. */
  readonly magnificationPercent?: number | undefined;
  /** A complete printed code, check digit included, to be recomputed and compared. */
  readonly verifyDigits?: string | undefined;
}

export interface EanVerification {
  /** The digit printed on the code the user typed. */
  readonly typed: number;
  /** The digit the algorithm produces from the same data digits. */
  readonly computed: number;
  /** Whether those two digits are the same. Nothing about the printed symbol. */
  readonly matches: boolean;
}

export interface EanBarcode {
  readonly checkDigit: number;
  /** The data digits with the check digit appended, as text. */
  readonly code: string;
  readonly weightedSum: number;
  /** X-dimension actually used, in mm — whichever of the two inputs supplied it. */
  readonly xDimension: number;
  /** X-dimension as a percentage of the GS1 nominal 0.33 mm — the other half of the pair. */
  readonly magnification: number;
  readonly totalModules: number;
  /**
   * Bars plus quiet zones, in mm. Does NOT include a supplemental (add-on)
   * symbol — the 2- or 5-digit periodical/EAN add-on carries its own module
   * count and spacing, outside this tool's scope, and adding it silently to
   * this width would be the more dangerous of the two ways to get it wrong.
   */
  readonly symbolWidth: number;
  /** Width of the encoded bars alone, without the quiet zones. */
  readonly encodedWidth: number;
  readonly leftQuietZone: number;
  readonly rightQuietZone: number;
  /** Height of the bars alone, in mm. */
  readonly barHeight: number;
  /** Height of the whole symbol INCLUDING the human-readable digits, in mm. */
  readonly totalHeight: number;
  readonly verification: EanVerification | undefined;
}

/** The GS1 modulo-10 check: weight 3 on the RIGHTMOST data digit, then 1, 3, … */
function modulo10(digits: string): { readonly sum: number; readonly check: number } {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    // charCodeAt is used rather than an index, which under
    // noUncheckedIndexedAccess would be string | undefined for a string we have
    // already validated as digits-only.
    const digit = digits.charCodeAt(digits.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  // The outer mod 10 is what turns a sum ending in 0 into a check digit of 0
  // rather than 10 — the single most common defect in a hand-written check.
  return { sum, check: (10 - (sum % 10)) % 10 };
}

const DIGITS_ONLY = /^[0-9]+$/;

/**
 * The check digit for EAN-13, EAN-8 or UPC-A, and the symbol's geometry at the
 * user's magnification.
 *
 * **One rule for all three symbologies, counted from the RIGHT.** Expressed from
 * the left it looks like three rules — weight 3 on the even positions for the
 * 12-digit EAN-13, on the ODD positions for the 7-digit EAN-8 and the 11-digit
 * UPC-A — and choosing the wrong parity for the odd-length codes is the classic
 * defect. Counting from the right makes the parity a consequence of the length
 * instead of a case to get wrong.
 *
 * Digits stay TEXT throughout. `parseInt` on „0360002914" loses the leading zero
 * and produces a valid check digit for a code nobody asked about.
 *
 * The tool draws no bars and says nothing about print quality, contrast, or the
 * magnification a trading partner will accept — and it accepts no upper bound
 * on the X-dimension either, because which magnifications are acceptable is a
 * question for the customer of the print, not for this arithmetic.
 *
 * **Magnification and X-dimension are always derived from the SAME number.**
 * Whichever of the two the caller typed, `magnification` is computed from the
 * resulting `xDimension` rather than echoed back — so a caller who supplied
 * `magnificationPercent: 85` gets back an `xDimension` of exactly
 * `0.85 * 0.33` and a `magnification` that is exactly 85, never a value
 * rounded to one decimal and then multiplied back out, which is the specific
 * mistake that moves the last printed digit of the bar height.
 */
export function eanBarcode(input: EanBarcodeInput): ProResult<EanBarcode> {
  const { digits, symbology } = input;
  const spec = EAN_SPECS[symbology];
  if (spec === undefined) return fail("symbology");
  if (typeof digits !== "string" || !DIGITS_ONLY.test(digits)) return fail("digits");
  if (digits.length !== spec.dataDigits) return fail("digits");

  let xDimension: number;
  if (input.xDimension !== undefined) {
    if (!isPositive(input.xDimension)) return fail("xDimension");
    // Typing both is never a silent preference for xDimension — it is refused,
    // rather than discarding magnificationPercent with nothing to show for it.
    if (input.magnificationPercent !== undefined) return fail("magnificationPercent");
    xDimension = input.xDimension;
  } else if (input.magnificationPercent !== undefined) {
    if (!isPositive(input.magnificationPercent)) return fail("magnificationPercent");
    xDimension = (input.magnificationPercent / 100) * NOMINAL_X_DIMENSION;
  } else {
    return fail("xDimension");
  }

  const { sum, check } = modulo10(digits);

  let verification: EanVerification | undefined;
  const verifyDigits = input.verifyDigits;
  if (verifyDigits !== undefined) {
    if (!DIGITS_ONLY.test(verifyDigits)) return fail("verifyDigits");
    // The length must match the SELECTED symbology exactly: 12 digits is at
    // once a whole UPC-A and an EAN-13 without its check digit, so accepting
    // any of the three lengths here would check an EAN-13 label against the
    // 11-digit UPC-A parity rule and answer wrong.
    if (verifyDigits.length !== spec.dataDigits + 1) return fail("verifyDigits");
    const typed = verifyDigits.charCodeAt(verifyDigits.length - 1) - 48;
    const computed = modulo10(verifyDigits.slice(0, -1)).check;
    verification = { typed, computed, matches: typed === computed };
  }

  const totalModules = spec.encodedModules + spec.leftQuietModules + spec.rightQuietModules;
  // The raw ratio, never the magnification rounded for display, is what feeds
  // every downstream millimetre — see the function doc for why that matters.
  const magnification = (xDimension / NOMINAL_X_DIMENSION) * 100;

  return {
    ok: true,
    checkDigit: check,
    code: `${digits}${check}`,
    weightedSum: sum,
    xDimension,
    magnification,
    totalModules,
    symbolWidth: totalModules * xDimension,
    encodedWidth: spec.encodedModules * xDimension,
    leftQuietZone: spec.leftQuietModules * xDimension,
    rightQuietZone: spec.rightQuietModules * xDimension,
    barHeight: (spec.nominalHeight * magnification) / 100,
    totalHeight: (spec.nominalTotalHeight * magnification) / 100,
    verification,
  };
}

/* ------------------------------------------------------------------ *
 * Metrike fonta — cap-height trim from font metrics
 * ------------------------------------------------------------------ */

/**
 * Which family of metrics `ascender`/`descender` were read from. A font
 * carries several: the `hhea` table, `OS/2`'s `sTypo*` fields and `OS/2`'s
 * `usWin*` fields commonly disagree with one another in the SAME font, and
 * CSS 2.1 §10.6.1 leaves which one a browser uses to the browser. The tool is
 * exact over whichever numbers were typed in; it is never a claim about what
 * a particular browser will render, and this field is what lets the surface
 * say which metric family the answer is FOR.
 */
export type FontMetricSource = "hhea" | "os2Typo" | "os2Win";

export interface FontMetricsInput {
  /** Font design units per em — 1000 for a PostScript face, 2048 for a TrueType one. */
  readonly unitsPerEm: number;
  readonly ascender: number;
  /** Stored negative in most fonts; the sign is taken off once, here. */
  readonly descender: number;
  readonly lineGap: number;
  readonly capHeight: number;
  readonly xHeight?: number | undefined;
  readonly fontSize: number;
  /** The line box height in px — the CSS line-height, not the font's own. */
  readonly lineHeight: number;
  /** Which table `ascender`/`descender`/`lineGap` were read from. Echoed, not used in the maths. */
  readonly metricSource: FontMetricSource;
}

export interface FontMetricsTrim {
  /** px per font unit — fontSize / unitsPerEm. */
  readonly unitScale: number;
  readonly ascenderPx: number;
  readonly descenderPx: number;
  readonly lineGapPx: number;
  readonly capHeightPx: number;
  readonly xHeightPx: number | undefined;
  /** (ascender + |descender| + lineGap) in px — the content area of the line box. */
  readonly contentArea: number;
  /** May be NEGATIVE when the line box is shorter than the content area. */
  readonly halfLeading: number;
  readonly trimTop: number;
  readonly trimBottom: number;
  readonly trimTopEm: number;
  readonly trimBottomEm: number;
  /** The margins to apply: −trimTop and −trimBottom, in px. */
  readonly marginTop: number;
  readonly marginBottom: number;
  /** Echoed from the input — which metric family this whole result is FOR. */
  readonly metricSourceUsed: FontMetricSource;
}

/**
 * The negative margins that make a text box sit on the capitals instead of on
 * the font's own ascent and descent.
 *
 * The invariant that makes this checkable without a browser:
 * `trimTop + capHeightPx + trimBottom = lineHeight`, exactly, always. It holds
 * algebraically because 2 * halfLeading is lineHeight − contentArea, so the two
 * trims sum to lineHeight − capHeightPx — which means a wrong number here shows
 * up as a broken identity rather than as a box that looks nearly right.
 *
 * **`lineGap` cancels out of both trims, exactly.** `halfLeading + gapHalf`
 * reduces algebraically to `(lineHeight − ascenderPx − descenderPx) / 2`, with
 * `lineGapPx` gone — so two designers using rival conventions about whether
 * the „content area" includes the line gap land on the SAME trim either way.
 * This is worth stating plainly rather than leaving implicit, because a reader
 * who does not see the cancellation will expect `lineGap` to move the margins
 * and go looking for a bug that is not there.
 *
 * **Nothing is clamped.** A line box shorter than the content area gives a
 * negative half-leading (legal, and what a tight display setting produces), and
 * a cap height above the ascender gives a negative top trim (which is the fact
 * that the capitals overshoot, not an error). These figures describe the metrics
 * the user typed in; the tool does not read a font file, and `metricSource`
 * exists precisely because it is never entitled to claim it describes what a
 * particular browser will render — CSS 2.1 leaves that choice to the browser.
 */
export function fontMetricsTrim(input: FontMetricsInput): ProResult<FontMetricsTrim> {
  const { unitsPerEm, ascender, descender, lineGap, capHeight, fontSize, lineHeight } = input;
  if (!isIntegerIn(unitsPerEm, 1, 16384)) return fail("unitsPerEm");
  if (!isPositive(ascender)) return fail("ascender");
  if (!Number.isFinite(descender) || descender === 0) return fail("descender");
  if (!isNonNegative(lineGap)) return fail("lineGap");
  if (!isPositive(capHeight)) return fail("capHeight");
  if (!isPositive(fontSize)) return fail("fontSize");
  if (!isPositive(lineHeight)) return fail("lineHeight");
  if (
    input.metricSource !== "hhea" &&
    input.metricSource !== "os2Typo" &&
    input.metricSource !== "os2Win"
  ) {
    return fail("metricSource");
  }
  const xHeight = input.xHeight;
  if (xHeight !== undefined && !isPositive(xHeight)) return fail("xHeight");

  const unitScale = fontSize / unitsPerEm;
  const descent = Math.abs(descender);
  const ascenderPx = ascender * unitScale;
  const descenderPx = descent * unitScale;
  const lineGapPx = lineGap * unitScale;
  const capHeightPx = capHeight * unitScale;

  const contentArea = ascenderPx + descenderPx + lineGapPx;
  const halfLeading = (lineHeight - contentArea) / 2;
  const gapHalf = lineGapPx / 2;
  const trimTop = halfLeading + gapHalf + (ascender - capHeight) * unitScale;
  const trimBottom = halfLeading + gapHalf + descenderPx;

  return {
    ok: true,
    unitScale,
    ascenderPx,
    descenderPx,
    lineGapPx,
    capHeightPx,
    xHeightPx: xHeight === undefined ? undefined : xHeight * unitScale,
    contentArea,
    halfLeading,
    trimTop,
    trimBottom,
    trimTopEm: trimTop / fontSize,
    trimBottomEm: trimBottom / fontSize,
    marginTop: -trimTop,
    marginBottom: -trimBottom,
    metricSourceUsed: input.metricSource,
  };
}

/* ------------------------------------------------------------------ *
 * ISO formati papira — the A, B and C series
 * ------------------------------------------------------------------ */

export type PaperSeries = "A" | "B" | "C" | "RA" | "SRA";

/**
 * ISO 216:2007 (A and B), ISO 269:1985 (C) and ISO 217:2013 (RA and SRA) — the
 * anchors, short × long in mm. A0 is the 1 m² sheet of ratio √2, B0 the
 * geometric-mean size with a 1 m short edge, C0 the geometric mean of the two.
 * RA and SRA are raw and „supplementary raw" stock sizes trimmed down to A
 * sizes after printing; they follow the identical halve-and-floor rule.
 *
 * **This is ISO 216 B, not JIS B.** The Japanese JIS B series is a DIFFERENT
 * table under the same letter — JIS B0 is 1030 × 1456 mm against ISO B0's
 * 1000 × 1414, and JIS B5 is 182 × 257 against ISO B5's 176 × 250 — so a
 * caller working to Japanese sizes needs its own table, not this one silently
 * reused under a matching name.
 */
const ISO_ANCHORS: Record<PaperSeries, readonly [number, number]> = {
  A: [841, 1189],
  B: [1000, 1414],
  C: [917, 1297],
  RA: [860, 1220],
  SRA: [900, 1280],
};

/** Every series this tool recognises, for the nearest-format search below. */
const ALL_ISO_SERIES = ["A", "B", "C", "RA", "SRA"] as const;

const ISO_MAX_INDEX = 10;

export interface IsoSize {
  readonly series: PaperSeries;
  readonly index: number;
  readonly shortEdge: number;
  readonly longEdge: number;
}

/**
 * The whole series by the standard's OWN construction rule: halve the long edge
 * and round DOWN to a whole millimetre, at every step.
 *
 * Never `841 / 2^(n/2)`. The rounding is applied at each step and compounds, and
 * it is that compounding which produces the published table — the closed form
 * gives B5 as 176.8 → 177 where the standard says 176.
 */
function isoSeries(series: PaperSeries): readonly IsoSize[] {
  const anchor = ISO_ANCHORS[series];
  const sizes: IsoSize[] = [
    { series, index: 0, shortEdge: anchor[0], longEdge: anchor[1] },
  ];
  for (let index = 1; index <= ISO_MAX_INDEX; index += 1) {
    const previous = sizes[index - 1];
    if (previous === undefined) break;
    sizes.push({
      series,
      index,
      shortEdge: Math.floor(previous.longEdge / 2),
      longEdge: previous.shortEdge,
    });
  }
  return sizes;
}

export interface IsoPaperMatch extends IsoSize {
  readonly deltaShort: number;
  readonly deltaLong: number;
}

export interface IsoPaperSize {
  readonly shortEdge: number;
  readonly longEdge: number;
  readonly areaM2: number;
  readonly areaCm2: number;
  readonly diagonal: number;
  /** longEdge / shortEdge AS BUILT — the floors make it drift off √2. */
  readonly ratio: number;
  /** √2, for the comparison the previous field invites. */
  readonly nominalRatio: number;
  /** The C envelope that takes this sheet flat. A series only. */
  readonly envelopeFlat: IsoSize | undefined;
  /** The C envelope that takes it folded once. A series only. */
  readonly envelopeFoldedOnce: IsoSize | undefined;
  readonly target: IsoSize | undefined;
  /** How many target sheets fit the chosen one, nominally: 2^(m − n). SAME series only. */
  readonly nominalCount: number | undefined;
  /**
   * Copier percentage from this size to the target, unrounded. Computed as
   * `min(targetShort/short, targetLong/long) * 100` from the ACTUAL (floored)
   * millimetres of both sizes — not `2^((p−q)/2)*100` — because that power-of-
   * root-2 shortcut only holds within one series: A4 → C4 is 109 %, not the
   * 100 % a same-series-only formula would wrongly print for two different
   * series that happen to share an index.
   */
  readonly copierScale: number | undefined;
  readonly copierScaleRounded: number | undefined;
  readonly match: IsoPaperMatch | undefined;
}

export interface IsoPaperInput {
  readonly series: PaperSeries;
  readonly index: number;
  readonly targetSeries?: PaperSeries | undefined;
  readonly targetIndex?: number | undefined;
  readonly measuredWidth?: number | undefined;
  readonly measuredHeight?: number | undefined;
  /** How far a measured sheet may be off and still be called a match, in mm. */
  readonly matchTolerance: number;
}

/**
 * A sheet from the A, B, C, RA or SRA series, its geometry, its envelope, and
 * the copier percentage to another size.
 *
 * **The nominal count is a fact about the series, not a promise about cutting.**
 * Because every step floors, two A2 side by side are 840 mm against A1's 841 —
 * so 2^(m − n) says how the series is defined, and the guillotine still needs a
 * millimetre that is not there.
 *
 * A measured sheet is matched in both orientations (short and long edge are
 * sorted before comparing), against every series this tool knows, and the
 * candidate chosen is the one minimising `max(|Δshort|, |Δlong|)` — the WORST
 * axis, not the summed error, because a sum lets a large error on one edge
 * hide behind a small one on the other and still pass as „close". Reported as
 * a match only when that worst-axis distance is inside `matchTolerance`; past
 * it, the honest answer is that the sheet is not an ISO size at all.
 */
export function isoPaperSize(input: IsoPaperInput): ProResult<IsoPaperSize> {
  const { series, index, matchTolerance } = input;
  if (ISO_ANCHORS[series] === undefined) return fail("series");
  if (!isIntegerIn(index, 0, ISO_MAX_INDEX)) return fail("index");
  if (!isInRange(matchTolerance, 0, 10)) return fail("matchTolerance");

  const sizes = isoSeries(series);
  const size = sizes[index];
  if (size === undefined) return fail("index");

  const cSeries = isoSeries("C");
  const envelopeFlat = series === "A" ? cSeries[index] : undefined;
  const envelopeFoldedOnce = series === "A" ? cSeries[index + 1] : undefined;

  const targetIndex = input.targetIndex;
  const targetSeries = input.targetSeries ?? series;
  if (targetIndex !== undefined && !isIntegerIn(targetIndex, 0, ISO_MAX_INDEX)) {
    return fail("targetIndex");
  }
  if (input.targetSeries !== undefined && ISO_ANCHORS[input.targetSeries] === undefined) {
    return fail("targetSeries");
  }
  const target = targetIndex === undefined ? undefined : isoSeries(targetSeries)[targetIndex];
  const sameSeries = targetSeries === series;

  const measuredWidth = input.measuredWidth;
  const measuredHeight = input.measuredHeight;
  if (measuredWidth !== undefined && !isPositive(measuredWidth)) return fail("measuredWidth");
  if (measuredHeight !== undefined && !isPositive(measuredHeight)) return fail("measuredHeight");
  let match: IsoPaperMatch | undefined;
  if (measuredWidth !== undefined && measuredHeight !== undefined) {
    const measuredShort = Math.min(measuredWidth, measuredHeight);
    const measuredLong = Math.max(measuredWidth, measuredHeight);
    let best: IsoPaperMatch | undefined;
    let bestDistance = Infinity;
    for (const candidateSeries of ALL_ISO_SERIES) {
      for (const candidate of isoSeries(candidateSeries)) {
        const deltaShort = measuredShort - candidate.shortEdge;
        const deltaLong = measuredLong - candidate.longEdge;
        // The WORST axis, not the sum — a sum lets one edge's error hide
        // behind the other's and still read as „close".
        const distance = Math.max(Math.abs(deltaShort), Math.abs(deltaLong));
        if (distance < bestDistance) {
          best = { ...candidate, deltaShort, deltaLong };
          bestDistance = distance;
        }
      }
    }
    if (best !== undefined && bestDistance <= matchTolerance) match = best;
  }

  const areaMm2 = size.shortEdge * size.longEdge;
  const rawScale =
    target === undefined
      ? undefined
      : Math.min(target.shortEdge / size.shortEdge, target.longEdge / size.longEdge) * 100;
  return {
    ok: true,
    shortEdge: size.shortEdge,
    longEdge: size.longEdge,
    areaM2: areaMm2 / 1e6,
    areaCm2: areaMm2 / 100,
    diagonal: Math.hypot(size.shortEdge, size.longEdge),
    ratio: size.longEdge / size.shortEdge,
    nominalRatio: Math.SQRT2,
    envelopeFlat,
    envelopeFoldedOnce,
    target,
    nominalCount:
      targetIndex === undefined || !sameSeries || targetIndex <= index
        ? undefined
        : 2 ** (targetIndex - index),
    copierScale: rawScale,
    copierScaleRounded: rawScale === undefined ? undefined : Math.round(rawScale),
    match,
  };
}

/* ------------------------------------------------------------------ *
 * Tipografska skala — the modular type scale
 * ------------------------------------------------------------------ */

/**
 * The ratios the surface offers by name. Each is an exact rational or a
 * mathematical constant — the musical interval names are definitions, not
 * measurements, so nothing here is a published table that could be revised.
 */
export const TYPE_SCALE_RATIOS = {
  octave: 2,
  perfectFifth: 1.5,
  perfectFourth: 4 / 3,
  majorThird: 1.25,
  minorThird: 1.2,
  wide: 16 / 9,
  sqrt2: Math.SQRT2,
  golden: (1 + Math.sqrt(5)) / 2,
} as const;

export type TypeScaleUnit = "px" | "pt";

export type TypeScaleRounding = "none" | "halfPixel" | "pixel" | "fourPixel";

export interface ModularTypeScaleInput {
  readonly baseSize: number;
  readonly baseUnit: TypeScaleUnit;
  /** A value from TYPE_SCALE_RATIOS or any number above 1. */
  readonly ratio: number;
  readonly stepsUp: number;
  readonly stepsDown: number;
  readonly rootFontSize: number;
  readonly rounding: TypeScaleRounding;
}

export interface TypeScaleStep {
  /** Step index, negative below the base. */
  readonly step: number;
  /** Raw size in CSS px, unrounded. */
  readonly px: number;
  /** The px column after `rounding`; equal to `px` when `none`. */
  readonly roundedPx: number;
  readonly rem: number;
  readonly pt: number;
}

export interface ModularTypeScale {
  readonly basePx: number;
  readonly steps: readonly TypeScaleStep[];
}

/**
 * A geometric type scale, one row per step, in px, rem and pt.
 *
 * **Rounding never feeds the next step.** Each size is `base * ratio^n` computed
 * from the base, so a scale rounded to whole pixels still reads 16, 20, 25, 31,
 * 39, 49 — where feeding the rounded 31 back in would have produced 48. That
 * drift is the only thing that makes a scale stop being a scale.
 *
 * Negative steps are `1 / ratio^|n|` rather than repeated division, so the
 * sequence is symmetric about the base to the last bit.
 *
 * The rem and pt columns are computed from the RAW px, since the rounding is a
 * decision about the px column alone.
 */
export function modularTypeScale(input: ModularTypeScaleInput): ProResult<ModularTypeScale> {
  const { baseSize, baseUnit, ratio, stepsUp, stepsDown, rootFontSize, rounding } = input;
  if (!isPositive(baseSize)) return fail("baseSize");
  if (!Number.isFinite(ratio) || ratio <= 1) return fail("ratio");
  if (!isIntegerIn(stepsUp, 0, 12)) return fail("stepsUp");
  if (!isIntegerIn(stepsDown, 0, 12)) return fail("stepsDown");
  if (!isPositive(rootFontSize)) return fail("rootFontSize");
  if (baseUnit !== "px" && baseUnit !== "pt") return fail("baseUnit");
  if (
    rounding !== "none" &&
    rounding !== "halfPixel" &&
    rounding !== "pixel" &&
    rounding !== "fourPixel"
  ) {
    return fail("rounding");
  }

  // Work in CSS px throughout: 1 pt = 1/72 in and 1 px = 1/96 in, so pt = px * 0.75.
  const pxPerPt = CSS_PX_PER_INCH / PT_PER_INCH;
  const basePx = baseUnit === "pt" ? baseSize * pxPerPt : baseSize;

  const round = (size: number): number => {
    switch (rounding) {
      case "halfPixel":
        return Math.round(size * 2) / 2;
      case "pixel":
        return Math.round(size);
      case "fourPixel":
        return Math.round(size / 4) * 4;
      default:
        return size;
    }
  };

  const steps: TypeScaleStep[] = [];
  for (let step = -stepsDown; step <= stepsUp; step += 1) {
    const factor = step < 0 ? 1 / ratio ** -step : ratio ** step;
    const px = basePx * factor;
    steps.push({
      step,
      px,
      roundedPx: round(px),
      rem: px / rootFontSize,
      pt: px / pxPerPt,
    });
  }

  return { ok: true, basePx, steps };
}

/* ------------------------------------------------------------------ *
 * Gramatura i masa papira — sheet, ream and roll
 * ------------------------------------------------------------------ */

export interface PaperWeightInput {
  readonly grammage: number;
  readonly sheetWidth: number;
  readonly sheetHeight: number;
  readonly sheetCount: number;
  /** Mass of the weighed stack in g, for the reverse direction. */
  readonly measuredMass?: number | undefined;
  /** Roll width in mm — needs rollMass to produce a length. */
  readonly rollWidth?: number | undefined;
  /** Roll mass in KILOGRAMS, unlike measuredMass. */
  readonly rollMass?: number | undefined;
}

export interface PaperWeight {
  readonly areaM2: number;
  readonly sheetMass: number;
  readonly totalMass: number;
  readonly totalMassKg: number;
  /** Grammage back-computed from a weighed stack; undefined when none was weighed. */
  readonly measuredGrammage: number | undefined;
  /** Running length of the roll in metres. */
  readonly rollLength: number | undefined;
}

/**
 * Sheet area, sheet mass, job mass — and the two reverse questions.
 *
 * Grammage is mass per square metre of the SHEET, regardless of how many sides
 * are printed on it; ink is not in this number and neither is moisture.
 *
 * The roll length is `mass_kg * 1e6 / (grammage * width_mm)`, which is the same
 * expression as „grams of paper divided by grams per square metre, spread over
 * the web width" with the millimetres cancelled once instead of twice. It
 * ignores the core, so a weighed roll carries the core's mass unless the user
 * takes it off first.
 */
export function paperWeight(input: PaperWeightInput): ProResult<PaperWeight> {
  const { grammage, sheetWidth, sheetHeight, sheetCount } = input;
  if (!isPositive(grammage)) return fail("grammage");
  if (!isPositive(sheetWidth)) return fail("sheetWidth");
  if (!isPositive(sheetHeight)) return fail("sheetHeight");
  if (!isIntegerIn(sheetCount, 1, 1e9)) return fail("sheetCount");

  const areaM2 = (sheetWidth * sheetHeight) / 1e6;
  const sheetMass = grammage * areaM2;
  const totalMass = sheetMass * sheetCount;

  const measuredMass = input.measuredMass;
  if (measuredMass !== undefined && !isPositive(measuredMass)) return fail("measuredMass");

  const rollWidth = input.rollWidth;
  const rollMass = input.rollMass;
  let rollLength: number | undefined;
  if (rollWidth !== undefined || rollMass !== undefined) {
    // Half a roll is not a roll: a width without a mass cannot give a length, and
    // guessing either of them would be repair rather than refusal.
    if (rollWidth === undefined || !isPositive(rollWidth)) return fail("rollWidth");
    if (rollMass === undefined || !isPositive(rollMass)) return fail("rollMass");
    rollLength = (rollMass * 1e6) / (grammage * rollWidth);
  }

  return {
    ok: true,
    areaM2,
    sheetMass,
    totalMass,
    totalMassKg: totalMass / 1000,
    measuredGrammage:
      measuredMass === undefined ? undefined : measuredMass / (sheetCount * areaM2),
    rollLength,
  };
}

/* ------------------------------------------------------------------ *
 * Rezolucija za štampu — pixels, millimetres and ppi
 * ------------------------------------------------------------------ */

export type PrintDirection = "pxToSize" | "sizeToPx" | "effectivePpi";

export type PhysicalUnit = "mm" | "cm" | "in";

export interface PrintResolutionInput {
  readonly widthPx?: number | undefined;
  readonly heightPx?: number | undefined;
  /** ppi. Required except when the direction is `effectivePpi`, which derives it. */
  readonly resolution?: number | undefined;
  readonly physicalWidth?: number | undefined;
  readonly physicalHeight?: number | undefined;
  /** The unit the two physical fields are in. Absent reads them as mm. */
  readonly physicalUnit?: PhysicalUnit | undefined;
  readonly direction: PrintDirection;
  /** Bleed per EDGE, in mm — it enters each axis twice. */
  readonly bleed: number;
  /** s of a 1:s drawing. 1 means full size. */
  readonly scaleDenominator: number;
  readonly channels: number;
  readonly bitsPerChannel: number;
}

export interface PrintResolution {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly widthIn: number;
  readonly heightIn: number;
  readonly ppiWidth: number;
  readonly ppiHeight: number;
  /** True when the axes differ by more than 0.01 ppi — non-square source pixels. */
  readonly axesDisagree: boolean;
  readonly artboardWidthMm: number;
  readonly artboardHeightMm: number;
  /**
   * `ceil`, not `round` — this is a working-area size, and rounding it DOWN
   * cuts into the bleed the artboard exists to hold. `widthPx`/`heightPx`
   * above stay rounded, because those are the informative px↔mm read-out, not
   * a canvas the artwork has to survive being trimmed out of.
   */
  readonly artboardWidthPx: number;
  readonly artboardHeightPx: number;
  /** Size at 1:s. Equal to the trim size when s is 1. */
  readonly finalWidthMm: number;
  readonly finalHeightMm: number;
  readonly finalPpiWidth: number;
  readonly finalPpiHeight: number;
  readonly megapixels: number;
  /**
   * Raw sample count only: `width * height * channels * bitsPerChannel / 8`,
   * with no alpha channel, no ICC profile, no layers and no per-row padding
   * assumed or added. A file format's own header and padding will always make
   * a saved file larger than this number, and this is not a defect in either
   * figure — the two are answering different questions.
   */
  readonly bytes: number;
  readonly mebibytes: number;
}

const MM_PER_PHYSICAL_UNIT: Record<PhysicalUnit, number> = { mm: 1, cm: 10, in: MM_PER_INCH };

/**
 * The one identity — mm = px * 25.4 / ppi — read in all three directions.
 *
 * **The rounding to whole pixels is terminal.** A pixel figure is rounded for
 * display and never fed back into a further conversion; feeding it back is what
 * turns a 2480 px A4 into 209.97 mm and then into 2479 px on the next screen.
 *
 * The effective-ppi direction computes each axis on its own and never averages
 * them: two different numbers mean the source has non-square pixels, and an
 * average would hide exactly the fact the user opened the tool to find.
 *
 * **The artboard is rounded UP, everything else to the nearest pixel.** A
 * working-area size that loses a fraction of a pixel to `round` has quietly
 * eaten part of the bleed it was built to hold; the plain px↔mm read-out
 * carries no such consequence and stays rounded normally. `mmToPxAt`/
 * `pxToMmAt` are the same helper `typographicUnits` uses — one identity,
 * shared, rather than two hand copies of `25.4` that could drift apart.
 *
 * It reports figures and nothing about whether a resolution is enough for a job
 * — that depends on the press, the stock and the viewing distance, none of which
 * are inputs here.
 */
export function printResolution(input: PrintResolutionInput): ProResult<PrintResolution> {
  const { direction, bleed, scaleDenominator, channels, bitsPerChannel } = input;
  if (!isNonNegative(bleed)) return fail("bleed");
  if (!Number.isFinite(scaleDenominator) || scaleDenominator < 1) return fail("scaleDenominator");
  if (!isIntegerIn(channels, 1, 8)) return fail("channels");
  if (
    bitsPerChannel !== 1 &&
    bitsPerChannel !== 8 &&
    bitsPerChannel !== 16 &&
    bitsPerChannel !== 32
  ) {
    return fail("bitsPerChannel");
  }

  const physicalUnit = input.physicalUnit ?? "mm";
  const mmPerUnit = MM_PER_PHYSICAL_UNIT[physicalUnit];
  if (mmPerUnit === undefined) return fail("physicalUnit");

  let widthPx: number;
  let heightPx: number;
  let widthMm: number;
  let heightMm: number;
  let ppiWidth: number;
  let ppiHeight: number;

  if (direction === "pxToSize") {
    const w = input.widthPx;
    const h = input.heightPx;
    const ppi = input.resolution;
    if (w === undefined || !isIntegerIn(w, 1, 1e9)) return fail("widthPx");
    if (h === undefined || !isIntegerIn(h, 1, 1e9)) return fail("heightPx");
    if (ppi === undefined || !isPositive(ppi)) return fail("resolution");
    widthPx = w;
    heightPx = h;
    ppiWidth = ppi;
    ppiHeight = ppi;
    widthMm = pxToMmAt(w, ppi);
    heightMm = pxToMmAt(h, ppi);
  } else if (direction === "sizeToPx") {
    const pw = input.physicalWidth;
    const ph = input.physicalHeight;
    const ppi = input.resolution;
    if (pw === undefined || !isPositive(pw)) return fail("physicalWidth");
    if (ph === undefined || !isPositive(ph)) return fail("physicalHeight");
    if (ppi === undefined || !isPositive(ppi)) return fail("resolution");
    widthMm = pw * mmPerUnit;
    heightMm = ph * mmPerUnit;
    ppiWidth = ppi;
    ppiHeight = ppi;
    widthPx = Math.round(mmToPxAt(widthMm, ppi));
    heightPx = Math.round(mmToPxAt(heightMm, ppi));
  } else if (direction === "effectivePpi") {
    const w = input.widthPx;
    const h = input.heightPx;
    const pw = input.physicalWidth;
    const ph = input.physicalHeight;
    if (w === undefined || !isIntegerIn(w, 1, 1e9)) return fail("widthPx");
    if (h === undefined || !isIntegerIn(h, 1, 1e9)) return fail("heightPx");
    if (pw === undefined || !isPositive(pw)) return fail("physicalWidth");
    if (ph === undefined || !isPositive(ph)) return fail("physicalHeight");
    widthPx = w;
    heightPx = h;
    widthMm = pw * mmPerUnit;
    heightMm = ph * mmPerUnit;
    ppiWidth = (w * MM_PER_INCH) / widthMm;
    ppiHeight = (h * MM_PER_INCH) / heightMm;
  } else {
    return fail("direction");
  }

  const artboardWidthMm = widthMm + 2 * bleed;
  const artboardHeightMm = heightMm + 2 * bleed;
  const pixels = widthPx * heightPx;
  const bytes = (pixels * channels * bitsPerChannel) / 8;

  return {
    ok: true,
    widthPx,
    heightPx,
    widthMm,
    heightMm,
    widthIn: widthMm / MM_PER_INCH,
    heightIn: heightMm / MM_PER_INCH,
    ppiWidth,
    ppiHeight,
    axesDisagree: Math.abs(ppiWidth - ppiHeight) > 0.01,
    artboardWidthMm,
    artboardHeightMm,
    // ceilSnapped, deliberately not round: a working area may never come up
    // short of the bleed it was built to hold.
    artboardWidthPx: ceilSnapped(mmToPxAt(artboardWidthMm, ppiWidth)),
    artboardHeightPx: ceilSnapped(mmToPxAt(artboardHeightMm, ppiHeight)),
    finalWidthMm: widthMm * scaleDenominator,
    finalHeightMm: heightMm * scaleDenominator,
    finalPpiWidth: ppiWidth / scaleDenominator,
    finalPpiHeight: ppiHeight / scaleDenominator,
    megapixels: pixels / 1e6,
    bytes,
    mebibytes: bytes / 1048576,
  };
}

/* ------------------------------------------------------------------ *
 * Iskoristivost rolne — running length off a roll
 * ------------------------------------------------------------------ */

export interface RollYieldInput {
  readonly rollWidth: number;
  readonly pieceWidth: number;
  readonly pieceHeight: number;
  /** Unprinted edge of the web, per side. Applied twice. */
  readonly sideMargin: number;
  /** Space between pieces, both across and along the web. */
  readonly gutter: number;
  /** Waste at the start and at the end of the job. Applied once at each end. */
  readonly leadTrailMargin: number;
  readonly quantity: number;
  readonly allowRotation: boolean;
  /** Length of one roll, in metres, when the roll count is wanted. */
  readonly rollLength?: number | undefined;
  readonly pricePerMetre?: number | undefined;
}

export interface RollLayout {
  /** Pieces across the web. 0 means the piece does not fit and there is no layout. */
  readonly across: number;
  /** Unused width inside the usable web, in mm — whether a narrower roll would carry the same layout. */
  readonly leftoverWidth: number;
  readonly rows: number | undefined;
  readonly lengthMm: number | undefined;
  readonly lengthM: number | undefined;
  /** rows * across — at least the quantity, usually a few more. */
  readonly produced: number | undefined;
  /**
   * Rolls needed, from how many ROWS one roll actually holds — never a plain
   * `ceil(length / rollLength)`, which lets a row straddle the splice between
   * two rolls. A row that crosses a splice is printed and unusable, so the
   * roll count is built from a whole number of rows per roll, the same
   * `n*piece + (n−1)*gutter ≤ usable` packing every other layout tool uses.
   */
  readonly rolls: number | undefined;
  readonly cost: number | undefined;
}

export interface RollYield {
  readonly usableWidth: number;
  readonly upright: RollLayout;
  /** The 90°-turned layout; undefined when rotation was not allowed. */
  readonly rotated: RollLayout | undefined;
  /** Which layout runs shorter. Undefined when neither has a layout at all. */
  readonly shorter: "upright" | "rotated" | "equal" | undefined;
}

/**
 * How much web a run consumes, upright and turned, so the two can be compared.
 *
 * `across` is the shared `packCount` rearrangement: n pieces with n − 1
 * gutters need n*w + (n − 1)*g ≤ usable, so n ≤ (usable + g)/(w + g). The
 * running length subtracts ONE gutter, because the last row's trailing gutter
 * is never printed, and adds the lead and trail margins once each.
 *
 * `leftoverWidth` is the strip the layout does not use — the number that says
 * whether a narrower, cheaper roll would carry the identical layout.
 *
 * A piece wider than the usable web gives `across: 0` and no length at all,
 * rather than a division by zero dressed up as a number. Splitting a job
 * across rolls is the operator's call and the tool does not make it — but the
 * roll COUNT it does report never assumes a row survives crossing a splice.
 */
export function rollYield(input: RollYieldInput): ProResult<RollYield> {
  const { rollWidth, pieceWidth, pieceHeight, sideMargin, gutter, leadTrailMargin } = input;
  const { quantity, allowRotation } = input;
  if (!isPositive(rollWidth)) return fail("rollWidth");
  if (!isPositive(pieceWidth)) return fail("pieceWidth");
  if (!isPositive(pieceHeight)) return fail("pieceHeight");
  if (!isNonNegative(sideMargin)) return fail("sideMargin");
  if (!isNonNegative(gutter)) return fail("gutter");
  if (!isNonNegative(leadTrailMargin)) return fail("leadTrailMargin");
  if (!isIntegerIn(quantity, 1, 1e9)) return fail("quantity");
  const rollLength = input.rollLength;
  const pricePerMetre = input.pricePerMetre;
  if (rollLength !== undefined && !isPositive(rollLength)) return fail("rollLength");
  if (pricePerMetre !== undefined && !isNonNegative(pricePerMetre)) return fail("pricePerMetre");

  const usableWidth = rollWidth - 2 * sideMargin;

  const layout = (width: number, height: number): RollLayout => {
    const across = packCount(usableWidth, width, gutter);
    if (across < 1) {
      return {
        across: 0,
        leftoverWidth: usableWidth,
        rows: undefined,
        lengthMm: undefined,
        lengthM: undefined,
        produced: undefined,
        rolls: undefined,
        cost: undefined,
      };
    }
    const rows = ceilSnapped(quantity / across);
    const lengthMm = rows * (height + gutter) - gutter + 2 * leadTrailMargin;
    const lengthM = lengthMm / 1000;
    // How many ROWS one roll actually holds, the same n*piece + (n−1)*gutter
    // ≤ usable packing as `across` — never `ceil(length/rollLength)`, which
    // would let the last row of one roll straddle the splice onto the next.
    // `leadTrailMargin` is NOT subtracted here: the field's own doc is that it
    // is waste "at the start and at the end of the job", applied once, exactly
    // as `lengthMm` above applies it — a physical roll spliced into the middle
    // of a run pays no such cost, and treating it as a per-roll cost would make
    // this figure and `lengthMm` describe two different, inconsistent jobs.
    const rowsPerRoll =
      rollLength === undefined ? undefined : packCount(rollLength * 1000, height, gutter);
    return {
      across,
      leftoverWidth: usableWidth - (across * width + (across - 1) * gutter),
      rows,
      lengthMm,
      lengthM,
      produced: rows * across,
      rolls:
        rowsPerRoll === undefined
          ? undefined
          : rowsPerRoll < 1
            ? undefined
            : ceilSnapped(rows / rowsPerRoll),
      cost: pricePerMetre === undefined ? undefined : lengthM * pricePerMetre,
    };
  };

  const upright = layout(pieceWidth, pieceHeight);
  const rotated = allowRotation ? layout(pieceHeight, pieceWidth) : undefined;

  const uprightLength = upright.lengthMm;
  const rotatedLength = rotated?.lengthMm;
  let shorter: "upright" | "rotated" | "equal" | undefined;
  if (uprightLength !== undefined && rotatedLength !== undefined) {
    shorter =
      uprightLength < rotatedLength
        ? "upright"
        : uprightLength > rotatedLength
          ? "rotated"
          : "equal";
  } else if (uprightLength !== undefined) {
    shorter = "upright";
  } else if (rotatedLength !== undefined) {
    shorter = "rotated";
  }

  return { ok: true, usableWidth, upright, rotated, shorter };
}

/* ------------------------------------------------------------------ *
 * Slog knjižice — saddle-stitch imposition
 * ------------------------------------------------------------------ */

/** Folding one sheet once gives two leaves and four sides. Geometry, not trade. */
const PAGES_PER_SHEET = 4;

export interface SaddleStitchInput {
  readonly pageCount: number;
  /**
   * Pages per section, a multiple of 4. The value 4 means SADDLE STITCH: one
   * nested booklet of every sheet, which is what this tool is named for. Any
   * larger value sections the job into separate folded gatherings of that size.
   */
  readonly signatureSize: number;
  /** The printed number of the job's first page. Shifts every number, pairs unchanged. */
  readonly startPage: number;
}

export interface ImpositionSheet {
  /** Sheet number across the whole job, 1 = the outermost sheet of section 1. */
  readonly sheet: number;
  readonly signature: number;
  readonly frontLeft: number;
  readonly frontRight: number;
  readonly backLeft: number;
  readonly backRight: number;
}

export interface SaddleStitchImposition {
  /** pageCount rounded up to a multiple of 4. */
  readonly pagesRoundedToFour: number;
  /** pageCount rounded up to a whole section — what actually gets folded. */
  readonly paddedPages: number;
  readonly blanks: number;
  /** Printed number of the first blank page; undefined when there are none. */
  readonly firstBlankPage: number | undefined;
  readonly sheets: number;
  readonly signatures: number;
  readonly pagesPerSignature: number;
  readonly plan: readonly ImpositionSheet[];
}

/**
 * Which two pages sit on each side of each sheet of a saddle-stitched booklet.
 *
 * The pairing rule, for a section of S pages with sheet k = 1 the OUTERMOST:
 * front is (S − 2k + 2 | 2k − 1) and back is (2k | S − 2k + 1). The invariant
 * that catches every off-by-one is that each printed pair sums to S + 1 — before
 * the section offset, and to S + 1 + 2 * offset after it.
 *
 * **A signature size of 4 means „do not section".** A single folded sheet is not
 * a gathering, so the saddle-stitch default nests the whole booklet: 8 pages give
 * 8|1, 2|7, 6|3, 4|5 and not two loose 4-page sheets. A size of 8 or more makes
 * each section its own nested booklet, padded to a full section at the end so the
 * fold still works.
 *
 * There is deliberately no creep column: the trade uses several incompatible
 * definitions of creep, while the pairing is the part that is unambiguous.
 */
export function saddleStitchImposition(
  input: SaddleStitchInput,
): ProResult<SaddleStitchImposition> {
  const { pageCount, signatureSize, startPage } = input;
  if (!isIntegerIn(pageCount, 1, 4000)) return fail("pageCount");
  if (!isIntegerIn(signatureSize, PAGES_PER_SHEET, 64) || signatureSize % PAGES_PER_SHEET !== 0) {
    return fail("signatureSize");
  }
  if (!isIntegerIn(startPage, 1, 1e6)) return fail("startPage");

  const pagesRoundedToFour = Math.ceil(pageCount / PAGES_PER_SHEET) * PAGES_PER_SHEET;
  // A signature size of 4 is the saddle-stitch case: the section IS the booklet.
  const sectionPages = signatureSize === PAGES_PER_SHEET ? pagesRoundedToFour : signatureSize;
  const signatures = Math.ceil(pagesRoundedToFour / sectionPages);
  const paddedPages = signatures * sectionPages;
  const blanks = paddedPages - pageCount;
  const offsetToPrinted = startPage - 1;

  const plan: ImpositionSheet[] = [];
  const sheetsPerSignature = sectionPages / PAGES_PER_SHEET;
  for (let signature = 1; signature <= signatures; signature += 1) {
    const offset = (signature - 1) * sectionPages + offsetToPrinted;
    for (let k = 1; k <= sheetsPerSignature; k += 1) {
      plan.push({
        sheet: (signature - 1) * sheetsPerSignature + k,
        signature,
        frontLeft: sectionPages - 2 * k + 2 + offset,
        frontRight: 2 * k - 1 + offset,
        backLeft: 2 * k + offset,
        backRight: sectionPages - 2 * k + 1 + offset,
      });
    }
  }

  return {
    ok: true,
    pagesRoundedToFour,
    paddedPages,
    blanks,
    // The blanks go at the END of the last section, never anywhere in the text.
    firstBlankPage: blanks === 0 ? undefined : pageCount + 1 + offsetToPrinted,
    sheets: paddedPages / PAGES_PER_SHEET,
    signatures,
    pagesPerSignature: sectionPages,
    plan,
  };
}

/* ------------------------------------------------------------------ *
 * Uklapanje na tabak — sheet imposition
 * ------------------------------------------------------------------ */

export interface SheetImpositionInput {
  readonly sheetWidth: number;
  readonly sheetHeight: number;
  readonly pieceWidth: number;
  readonly pieceHeight: number;
  /** The gripper edge, in mm. */
  readonly marginTop: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  /** Bleed plus knife width between pieces, in mm. */
  readonly gutter: number;
  readonly allowRotation: boolean;
  readonly requiredQuantity?: number | undefined;
}

export interface SheetLayout {
  readonly across: number;
  readonly down: number;
  readonly count: number;
  /** Unused strip inside the usable area, in mm. */
  readonly leftoverWidth: number;
  readonly leftoverHeight: number;
}

export interface SheetImposition {
  readonly usableWidth: number;
  readonly usableHeight: number;
  readonly upright: SheetLayout;
  readonly rotated: SheetLayout | undefined;
  readonly best: SheetLayout;
  /** Which orientation yields more; „either" when the two tie. */
  readonly bestOrientation: "upright" | "rotated" | "either";
  /** Per cent of the WHOLE sheet the pieces occupy — what the customer PAYS for. */
  readonly usedPercent: number | undefined;
  readonly wastePercent: number | undefined;
  /** Per cent of the USABLE area (inside the margins) the pieces occupy — what the layout ITSELF cost. */
  readonly usedPercentOfUsable: number | undefined;
  readonly wastePercentOfUsable: number | undefined;
  readonly sheets: number | undefined;
}

/**
 * How many pieces a sheet yields, upright and turned, and what it wastes.
 *
 * `across`/`down` use the shared `packCount` rearrangement: n pieces occupy
 * n*w + (n − 1)*g ≤ usable, which rearranges to n ≤ (usable + g)/(w + g), with
 * the shared `floorSnapped` so an exact fit such as 320/80 survives binary
 * floating point instead of becoming 3.
 *
 * **Waste is reported TWICE, against two different areas, because the two
 * answer different questions.** Against the whole sheet — margins included —
 * it is what the customer actually pays for, since the gripper edge and the
 * trim are exactly what the guillotine throws away. Against the usable area
 * alone it is what the LAYOUT itself cost, with the unavoidable gripper margin
 * taken back out; a figure computed only the first way flatters no layout, but
 * a figure computed only the second way makes every generous-margin sheet look
 * identically efficient, which is the complaint this second figure answers.
 */
export function sheetImposition(input: SheetImpositionInput): ProResult<SheetImposition> {
  const { sheetWidth, sheetHeight, pieceWidth, pieceHeight, gutter, allowRotation } = input;
  const { marginTop, marginBottom, marginLeft, marginRight } = input;
  if (!isPositive(sheetWidth)) return fail("sheetWidth");
  if (!isPositive(sheetHeight)) return fail("sheetHeight");
  if (!isPositive(pieceWidth)) return fail("pieceWidth");
  if (!isPositive(pieceHeight)) return fail("pieceHeight");
  if (!isNonNegative(marginTop)) return fail("marginTop");
  if (!isNonNegative(marginBottom)) return fail("marginBottom");
  if (!isNonNegative(marginLeft)) return fail("marginLeft");
  if (!isNonNegative(marginRight)) return fail("marginRight");
  if (!isNonNegative(gutter)) return fail("gutter");
  const requiredQuantity = input.requiredQuantity;
  if (requiredQuantity !== undefined && !isIntegerIn(requiredQuantity, 1, 1e9)) {
    return fail("requiredQuantity");
  }

  const usableWidth = sheetWidth - marginLeft - marginRight;
  const usableHeight = sheetHeight - marginTop - marginBottom;

  const layout = (width: number, height: number): SheetLayout => {
    const fits = usableWidth > 0 && usableHeight > 0;
    const across = fits ? packCount(usableWidth, width, gutter) : 0;
    const down = fits ? packCount(usableHeight, height, gutter) : 0;
    return {
      across,
      down,
      count: across * down,
      leftoverWidth:
        across >= 1 ? usableWidth - (across * width + (across - 1) * gutter) : usableWidth,
      leftoverHeight:
        down >= 1 ? usableHeight - (down * height + (down - 1) * gutter) : usableHeight,
    };
  };

  const upright = layout(pieceWidth, pieceHeight);
  const rotated = allowRotation ? layout(pieceHeight, pieceWidth) : undefined;
  const best = rotated !== undefined && rotated.count > upright.count ? rotated : upright;
  const bestOrientation =
    rotated === undefined || rotated.count < upright.count
      ? "upright"
      : rotated.count > upright.count
        ? "rotated"
        : "either";

  const pieceArea = best.count * pieceWidth * pieceHeight;
  const sheetArea = sheetWidth * sheetHeight;
  const usableArea = usableWidth * usableHeight;
  return {
    ok: true,
    usableWidth,
    usableHeight,
    upright,
    rotated,
    best,
    bestOrientation,
    // No layout means no waste figure: 100 % of nothing would read as a result.
    usedPercent: best.count === 0 ? undefined : (pieceArea / sheetArea) * 100,
    wastePercent: best.count === 0 ? undefined : (1 - pieceArea / sheetArea) * 100,
    usedPercentOfUsable:
      best.count === 0 || usableArea <= 0 ? undefined : (pieceArea / usableArea) * 100,
    wastePercentOfUsable:
      best.count === 0 || usableArea <= 0 ? undefined : (1 - pieceArea / usableArea) * 100,
    sheets:
      requiredQuantity === undefined || best.count === 0
        ? undefined
        : ceilSnapped(requiredQuantity / best.count),
  };
}
