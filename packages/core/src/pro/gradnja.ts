/**
 * „Gradnja i projektovanje" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category.** The rail groups by category and the
 * profile filters by pack (`TOOL_CATEGORIES`), but neither of those is a file
 * layout: what a maintainer asks is „where does the stair calculator live", and
 * `pro/gradnja.ts` answers it where `pro/geometry.ts` would not. A tool several
 * packs share lives in the file of its FIRST pack in `TOOL_PACKS` order — a rule
 * with no judgement in it, so nobody has to relitigate ownership per tool.
 *
 * **These are pure functions and they refuse rather than repair**, exactly as
 * `@nexus/core/devtools/*` does. A surface owns its own state, formats nothing
 * on its own, and asks here for every number it prints — which is why the test
 * vectors below are the ones a person can check by hand rather than snapshots of
 * whatever the code happened to produce.
 *
 * **Nothing here decides anything.** A tool in this pack computes a quantity;
 * whether that quantity is acceptable is a question for the licensed
 * professional who is answerable for the building, and the contract makes that
 * structural rather than aspirational (`toolForbidsVerdict`). Where a rule has a
 * limit, the limit is an INPUT with no default, and what comes back is the pair
 * of numbers and their ratio — never a word about what the pair means.
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
  type ProResult,
} from "./result.js";

const DEG_PER_RAD = 180 / Math.PI;

/**
 * How a flight meets the landing at the top, which is the only thing that
 * decides whether there are `n` goings or `n − 1`.
 *
 * It is an input rather than an assumption because both are ordinary and the
 * difference is one whole going — the width of the flight's footprint being
 * wrong by 280 mm is exactly the error that is discovered on site.
 */
export type StairTop = "flush" | "landing";

export interface StairInput {
  /** Floor-to-floor height, in millimetres. Finished floor to finished floor. */
  readonly rise: number;
  /** Number of RISERS, not of goings. */
  readonly risers: number;
  /** Going — the horizontal tread depth, in millimetres. */
  readonly going: number;
  readonly top: StairTop;
  /**
   * The user's own limits, from whichever rule they are working to. Absent means
   * they gave none, and then no comparison is drawn at all.
   *
   * These are `regulated`-tier constants (`TOOL_CONSTANT_TIERS`): a maximum
   * riser is a number a rule-maker chose and can change, it differs between a
   * dwelling, a school and a fire escape, and it differs between countries. An
   * embedded default would be this app asserting which rule applies to a
   * building it has never seen.
   */
  readonly riserLimit?: number | undefined;
  readonly goingLimit?: number | undefined;
  /**
   * The increment the riser will be set out to, in millimetres. Absent means
   * 1 mm, which is how a stair is marked out in practice.
   *
   * `physical` tier and nothing more: this is the resolution of the joiner's
   * rule, not a figure any rulebook fixes, so a default is a convenience rather
   * than an assertion about the building.
   */
  readonly roundTo?: number | undefined;
}

export interface StairFlight {
  /** Rise of one step, in mm. Deliberately NOT rounded — see the note in `stairFlight`. */
  readonly riser: number;
  readonly goings: number;
  /** Total horizontal run of the flight, in mm. */
  readonly run: number;
  /** Pitch above the horizontal, in degrees. */
  readonly pitch: number;
  /** 2r + g, in mm — Blondel's 1675 expression, which is a defined quantity and not a rule. */
  readonly blondel: number;
  /** computed ÷ the user's own limit, or undefined when they supplied none. */
  readonly riserRatio: number | undefined;
  readonly goingRatio: number | undefined;
  /**
   * What building it to a buildable number actually costs.
   *
   * `riser` above is `H/n` exactly, and nobody sets out a stair to six decimals
   * of a millimetre — the joiner rounds. The review of this tool called the
   * original „difference between the first and last riser (always 0)" what it
   * was, an ornament: it restated that a division is a division. THIS is the
   * number that was missing, and it is the one that decides whether the drawing
   * survives contact with the site.
   */
  readonly rounded: StairRounding;
}

/**
 * The flight as it will actually be built: the riser rounded to a step the
 * setter-out can mark, and the millimetres that rounding leaves over.
 *
 * **The remainder has to go somewhere and this names where.** `n` risers of
 * `r_rounded` do not add up to `H` unless the division came out even, so the
 * difference lands on one step — in practice the last one, against the upper
 * floor. A flight of seventeen at 167,647 mm rounded to 168 mm OVERSHOOTS by
 * 6 mm — 17 × 168 = 2856 against the 2850 asked for — which is one step 6 mm
 * out of line with the other sixteen: not a tolerance, a trip hazard, and the
 * single most common defect in a built
 * stair. Printing it is not a warning — it is the quantity, and what to do
 * about it (spread it, re-cut the pitch, move the floor level) is the
 * designer's call.
 */
export interface StairRounding {
  /** The step the riser was rounded to, in mm — the user's, not a rule's. */
  readonly step: number;
  /** `riser` rounded to the nearest `step`. */
  readonly riser: number;
  /** `risers × rounded riser` — the height the flight actually reaches. */
  readonly rise: number;
  /**
   * Requested rise minus achieved rise, in mm. Positive means the flight lands
   * SHORT of the upper floor and the last step is that much taller; negative
   * means it overshoots and the last step is that much shorter. Zero means the
   * division came out even and there is nothing to place.
   */
  readonly remainder: number;
}

/**
 * A straight flight, from its floor-to-floor height and its riser count.
 *
 * **The riser is not rounded, and that is the whole point of computing it here.**
 * A flight is built to a floor-to-floor height that is fixed, so `H/n` is exact
 * by construction and every riser in the flight is identical. Rounding it to a
 * whole millimetre spreads the remainder somewhere — in practice onto the last
 * step, which is the single most common defect in a built stair and the one a
 * person actually trips on. Three decimals of a millimetre is not false
 * precision here; it is the statement that the division was not fudged.
 *
 * **And then it rounds anyway, in `rounded`, because the joiner will.** Keeping
 * only the exact riser would be precision theatre: nobody marks out a stair to
 * six decimals, so the number that gets built is the rounded one and the
 * millimetres it leaves over land on a single step. Both are returned, and
 * neither is called the answer — the exact one says the division was honest,
 * the rounded one says what the site will produce.
 *
 * `goings = risers − 1` for a flight that arrives flush with the upper floor:
 * the last riser lands ON the floor, so it has no tread of its own. A flight
 * arriving at a landing in the plane of the last riser has `n` goings.
 */
export function stairFlight(input: StairInput): ProResult<StairFlight> {
  const { rise, risers, going, top } = input;
  if (!isPositive(rise)) return fail("rise");
  if (!isIntegerIn(risers, 1, 60)) return fail("risers");
  if (!isPositive(going)) return fail("going");

  const step = input.roundTo === undefined ? 1 : input.roundTo;
  if (!isPositive(step)) return fail("roundTo");

  const riser = rise / risers;
  const goings = top === "flush" ? risers - 1 : risers;
  // `Math.round(x / step) * step` and not `toFixed`: the step is a length in
  // millimetres and may be 5 or 2,5 as readily as 1, so rounding has to be to a
  // multiple rather than to a number of decimal places.
  const roundedRiser = Math.round(riser / step) * step;
  const achieved = risers * roundedRiser;
  return {
    ok: true,
    riser,
    rounded: {
      step,
      riser: roundedRiser,
      rise: achieved,
      remainder: rise - achieved,
    },
    goings,
    run: goings * going,
    pitch: Math.atan(riser / going) * DEG_PER_RAD,
    blondel: 2 * riser + going,
    riserRatio: ratioAgainst(riser, input.riserLimit),
    goingRatio: ratioAgainst(going, input.goingLimit),
  };
}

/**
 * The riser count a desired riser height implies, with its two neighbours.
 *
 * Returned as three candidates rather than one because the rounded answer is
 * frequently the worse stair: `H/r*` almost never lands on an integer, and the
 * flight one riser longer often has both a kinder pitch and a going that fits
 * the space. Choosing between them is the designer's, so the tool hands over all
 * three and names none of them the answer.
 */
export function stairRiserCandidates(rise: number, desiredRiser: number): ProResult<{
  readonly candidates: readonly { readonly risers: number; readonly riser: number }[];
}> {
  if (!isPositive(rise)) return fail("rise");
  if (!isPositive(desiredRiser)) return fail("desiredRiser");
  const nearest = Math.round(rise / desiredRiser);
  const candidates = [nearest - 1, nearest, nearest + 1]
    .filter((risers) => risers >= 1 && risers <= 60)
    .map((risers) => ({ risers, riser: rise / risers }));
  return candidates.length === 0 ? fail("rise") : { ok: true, candidates };
}

/* ---------------------------------------------------------------------------
 * angle-units — „Uglovi i direkcioni ugao"
 * ------------------------------------------------------------------------ */

/**
 * The radian is the internal base and every other notation is one factor away
 * from it. Going deg → gon directly would be one fewer rounding, but it would
 * also be a conversion table per pair instead of one hub, and the entry added
 * later is the one that disagrees with the others.
 *
 * All three full circles are DEFINITIONS, not measurements: 360°, 400 gon and
 * 2π rad are the same angle by construction, so none of these factors is a
 * value anybody measured or a rule-maker chose.
 */
const TAU = 2 * Math.PI;
const RAD_PER_DEG = Math.PI / 180;
const RAD_PER_GON = Math.PI / 200;
const GON_PER_RAD = 200 / Math.PI;

/** Finite, at or above zero and strictly below sixty — one sexagesimal digit. */
function isSexagesimal(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value < 60;
}

/**
 * An angle folded into `[0, full)`, by FLOOR and never by truncation.
 *
 * Truncating would send −1.5° to −1.5° and leave the caller to notice; the floor
 * sends it to 358.5°, which is the direction a person standing on the site is
 * actually facing. The `>= full` guard catches the one case the arithmetic
 * cannot: a tiny negative input whose sum with `full` rounds up to `full`.
 */
function foldRadians(radians: number): number {
  const folded = radians - Math.floor(radians / TAU) * TAU;
  return folded >= TAU || folded < 0 ? 0 : folded;
}

/**
 * Degrees, minutes and seconds with the sign carried by the WHOLE record.
 *
 * −1°30′ is −1.5°, not −0.5°: the minus belongs to the reading, not to its first
 * component. Keeping it as its own field is what makes that unmistakable — a
 * negative `degrees` with positive minutes is the exact shape of that bug.
 */
export interface AngleDms {
  readonly negative: boolean;
  /** Whole degrees, always at or above zero — the sign lives in `negative`. */
  readonly degrees: number;
  readonly minutes: number;
  readonly seconds: number;
}

export type AngleUnit = "deg" | "gon" | "rad";

export interface AngleValueInput {
  readonly unit: AngleUnit;
  readonly value: number;
  /** Fold the answer into one full circle. The folded value is reported either way. */
  readonly normalize: boolean;
}

export interface AngleDmsInput {
  readonly unit: "dms";
  readonly dms: AngleDms;
  readonly normalize: boolean;
}

export type AngleInput = AngleValueInput | AngleDmsInput;

export interface AngleForms {
  readonly degrees: number;
  readonly gon: number;
  readonly radians: number;
  readonly dms: AngleDms;
  /** The same angle folded into [0, 360) — shown even when `normalize` is off. */
  readonly normalizedDegrees: number;
  /** The same angle folded into [0, 400) gon. */
  readonly normalizedGon: number;
  /** The reciprocal direction: +180°, i.e. +200 gon, folded into the circle. */
  readonly oppositeDegrees: number;
  readonly oppositeGon: number;
}

/**
 * A degrees-minutes-seconds reading as a decimal degree.
 *
 * Refuses a minute or second at or above 60 rather than carrying it: 45°17′75″
 * is a transcription error, and reading it as 45°18′15″ would silently accept a
 * reading nobody wrote down.
 */
export function dmsToDegrees(dms: AngleDms): ProResult<{ readonly degrees: number }> {
  if (!Number.isFinite(dms.degrees) || dms.degrees < 0) return fail("degrees");
  if (!isSexagesimal(dms.minutes)) return fail("minutes");
  if (!isSexagesimal(dms.seconds)) return fail("seconds");
  const magnitude = dms.degrees + dms.minutes / 60 + dms.seconds / 3600;
  return { ok: true, degrees: dms.negative ? -magnitude : magnitude };
}

/**
 * A decimal degree as degrees, minutes and seconds, with the carry done.
 *
 * The carry is judged at three decimals of a second BECAUSE that is the
 * precision the reading is displayed at: 39.99999999° truncates to 39° 59′
 * 59.999964″, which prints as `39° 59′ 60.000″` — an impossible reading that a
 * surveyor would rightly file as a bug. Rounding first and carrying afterwards
 * is the only order that cannot produce it.
 */
export function degreesToDms(degrees: number): ProResult<AngleDms> {
  if (!Number.isFinite(degrees)) return fail("degrees");
  const magnitude = Math.abs(degrees);
  let whole = Math.trunc(magnitude);
  let minutes = Math.trunc((magnitude - whole) * 60);
  let seconds = ((magnitude - whole) * 60 - minutes) * 60;
  if (Math.round(seconds * 1000) >= 60000) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    whole += 1;
  }
  return { ok: true, negative: degrees < 0, degrees: whole, minutes, seconds };
}

/**
 * One angle in all four notations at once, plus its folded value and its
 * reciprocal direction.
 *
 * `normalize` decides what the four notations SHOW; it never decides what is
 * computed. With it off, 720° stays 720° — a surveyor summing turning angles
 * wants the sum — and the folded value is still reported alongside, because the
 * two answers are both true and only one of them is a direction.
 */
export function convertAngle(input: AngleInput): ProResult<AngleForms> {
  let radians: number;
  if (input.unit === "dms") {
    const decimal = dmsToDegrees(input.dms);
    if (!decimal.ok) return decimal;
    radians = decimal.degrees * RAD_PER_DEG;
  } else {
    if (!Number.isFinite(input.value)) return fail("value");
    const factor = input.unit === "deg" ? RAD_PER_DEG : input.unit === "gon" ? RAD_PER_GON : 1;
    radians = input.value * factor;
  }

  const folded = foldRadians(radians);
  const shown = input.normalize ? folded : radians;
  const written = degreesToDms(shown * DEG_PER_RAD);
  if (!written.ok) return written;
  const opposite = foldRadians(folded + Math.PI);
  return {
    ok: true,
    degrees: shown * DEG_PER_RAD,
    gon: shown * GON_PER_RAD,
    radians: shown,
    dms: {
      negative: written.negative,
      degrees: written.degrees,
      minutes: written.minutes,
      seconds: written.seconds,
    },
    normalizedDegrees: folded * DEG_PER_RAD,
    normalizedGon: folded * GON_PER_RAD,
    oppositeDegrees: opposite * DEG_PER_RAD,
    oppositeGon: opposite * GON_PER_RAD,
  };
}

/* ---------------------------------------------------------------------------
 * bar-spacing — „Jednaki razmaci"
 * ------------------------------------------------------------------------ */

/**
 * Where the pieces sit relative to the ends of the usable run.
 *
 * `ends` puts a piece on each end — n pieces, n−1 gaps, which is how bars in a
 * slab and balusters between two posts are set out. `field` centres each piece
 * in its own share of the run — n pieces, n gaps — which is how rafters between
 * two walls and posts along a fence line are set out. The two differ by one
 * whole piece and by half a spacing at each end.
 */
export type BarLayout = "ends" | "field";

export interface BarSpacingInput {
  /** Total length, in mm. The surface converts metres before calling. */
  readonly length: number;
  /** Distance from the start of the run to the first piece, in mm. */
  readonly startCover: number;
  /** Distance from the last piece to the end of the run, in mm. */
  readonly endCover: number;
  readonly layout: BarLayout;
  /**
   * The user's own maximum spacing, in mm. It is a `regulated`-tier quantity —
   * a designer's or a rule-maker's number for THIS element — so the tool holds
   * none, defaults none and proposes none. Give either this or `count`.
   */
  readonly maxSpacing?: number | undefined;
  /** A piece count fixed by the user, used INSTEAD of `maxSpacing`. */
  readonly count?: number | undefined;
  /**
   * Width of one piece itself, in mm — the baluster or picket, not the gap
   * between them. The `ends`/`field` modes above space POINTS and never need
   * it; it exists for `maxGap` and for `axisPitch` below.
   */
  readonly pieceWidth?: number | undefined;
  /**
   * The largest allowed CLEAR gap between pieces, in mm — used INSTEAD of
   * `maxSpacing`/`count`. This absorbs the retired „Ispuna ograde" tool
   * (guard-rail infill): a child-safety clearance or similar is a
   * `regulated`-tier figure the tool holds no value for and proposes none.
   * Requires `pieceWidth` — a clear gap is meaningless without knowing what it
   * is a gap BETWEEN.
   */
  readonly maxGap?: number | undefined;
}

export interface BarSpacingResult {
  readonly count: number;
  readonly spaces: number;
  /** The exact spacing, in mm — the division, never a rounded step. */
  readonly spacing: number;
  /** L − e1 − e2, in mm. */
  readonly usableLength: number;
  /** Every piece, measured from the start of L, in mm. */
  readonly positions: readonly number[];
  /** spacing ÷ the user's own maximum, or undefined when they supplied none. */
  readonly spacingRatio: number | undefined;
  /**
   * Centre-to-centre distance between adjacent pieces, in mm — `spacing +
   * pieceWidth`. Undefined without a piece width: the base modes place points,
   * and a point has no centre distinct from its position.
   */
  readonly axisPitch: number | undefined;
}

/**
 * Equal spacings over a run, from a maximum spacing or from a fixed count.
 *
 * **The COUNT is rounded up and the spacing is then divided out exactly.** This
 * is the whole reason the tool exists: rounding the spacing instead — say 4900
 * over 150 taken as 32 gaps of 150 — leaves a 100 mm remainder that becomes a
 * final gap of 250 mm, which is larger than the maximum the user typed and is
 * precisely the gap that fails on site. Rounding the count first cannot produce
 * a gap above the maximum, ever.
 *
 * With `count` given the spacing may exceed any maximum, and that is the user's
 * arithmetic rather than the tool's: it still reports the ratio and still says
 * nothing about it.
 *
 * **`maxGap` is its own layout, because it is a different shape.** `ends` and
 * `field` place zero-width points; `maxGap` places n pieces of real width
 * between two fixed posts, which makes n+1 clear gaps rather than n or n−1.
 * The same up-front rounding of the COUNT applies — the clear gap is then
 * divided out exactly, for the same reason a rounded spacing instead of a
 * rounded count would leave a gap over the maximum.
 */
export function barSpacing(input: BarSpacingInput): ProResult<BarSpacingResult> {
  const { length, startCover, endCover, layout } = input;
  if (!isPositive(length)) return fail("length");
  if (!isNonNegative(startCover)) return fail("startCover");
  if (!isNonNegative(endCover)) return fail("endCover");

  const usableLength = length - startCover - endCover;
  if (usableLength <= 0) return fail("usableLength");

  // The `maxGap` mode is physically a third layout, not a variant count fed
  // into `ends`/`field`: two fixed posts and n pickets between them always
  // make n+1 clear gaps, a shape neither of the point-based layouts has, so
  // `layout` is not consulted at all on this path.
  if (input.maxGap !== undefined) {
    // `count` and `maxSpacing` belong to the `ends`/`field` layouts below and
    // are not consulted anywhere on this path; a value left in either — after
    // switching to `maxGap` without clearing it — must be refused rather than
    // silently dropped, the same rule `beamCheck` applies to a spare
    // `force`/`load` left over from a scheme switch.
    if (input.count !== undefined) return fail("count");
    if (input.maxSpacing !== undefined) return fail("maxSpacing");
    if (!isPositive(input.pieceWidth)) return fail("pieceWidth");
    if (!isPositive(input.maxGap)) return fail("maxGap");
    const { pieceWidth, maxGap } = input;
    // n pieces of width w make n+1 clear gaps of size g against two fixed
    // ends: U = n*w + (n+1)*g, so the smallest n keeping every gap at or under
    // the maximum is n = ceil((U - g)/(w + g)). The floor at 0 stops a gap
    // wider than the whole run from producing a negative piece count.
    const count = Math.max(0, ceilSnapped((usableLength - maxGap) / (pieceWidth + maxGap)));
    if (!isIntegerIn(count, 1, 10000)) return fail("maxGap");
    // The ceiling above can add up to one whole extra piece beyond what the
    // continuous U/(w+g) implies, so `count*pieceWidth` can reach or pass
    // `usableLength` — the pieces themselves no longer fit and there is no
    // clear gap left to report. Clamping that to zero would hand back a
    // spacing of 0 mm as if it satisfied the maximum; it does not, and no n
    // does for these dimensions, so the tool refuses rather than answer with
    // a gap that has gone negative.
    if (count * pieceWidth >= usableLength) return fail("maxGap");
    const spaces = count + 1;
    const spacing = (usableLength - count * pieceWidth) / spaces;
    const positions: number[] = [];
    for (let i = 0; i < count; i += 1) {
      positions.push(startCover + spacing + pieceWidth / 2 + i * (spacing + pieceWidth));
    }
    return {
      ok: true,
      count,
      spaces,
      spacing,
      usableLength,
      positions,
      spacingRatio: ratioAgainst(spacing, maxGap),
      axisPitch: spacing + pieceWidth,
    };
  }

  // `ends` needs at least two pieces to have a gap at all; one piece on each
  // end of nothing is not a layout, it is a division by zero.
  const minimum = layout === "ends" ? 2 : 1;

  let spaces: number;
  if (input.count !== undefined) {
    if (!isIntegerIn(input.count, minimum, 10000)) return fail("count");
    spaces = layout === "ends" ? input.count - 1 : input.count;
  } else {
    if (!isPositive(input.maxSpacing)) return fail("maxSpacing");
    spaces = ceilSnapped(usableLength / input.maxSpacing);
  }

  const count = layout === "ends" ? spaces + 1 : spaces;
  const spacing = usableLength / spaces;
  const positions: number[] = [];
  for (let i = 0; i < count; i += 1) {
    positions.push(layout === "ends" ? startCover + i * spacing : startCover + (i + 0.5) * spacing);
  }
  return {
    ok: true,
    count,
    spaces,
    spacing,
    usableLength,
    positions,
    spacingRatio: ratioAgainst(spacing, input.maxSpacing),
    axisPitch: input.pieceWidth === undefined ? undefined : spacing + input.pieceWidth,
  };
}

/* ---------------------------------------------------------------------------
 * beam-check — „Greda i konzola"
 * ------------------------------------------------------------------------ */

/**
 * The four schemes, each a closed-form solution of the Euler-Bernoulli bending
 * equation for one load case. The coefficients (5/384, 1/48, 1/8, 1/3 for the
 * deflection; 1/8, 1/4, 1/2, 1 for the moment) are derived arithmetic, not a
 * tabulated or regulated figure, which is why they may live in the code at all.
 */
export type BeamScheme = "simple-udl" | "simple-point" | "cantilever-udl" | "cantilever-point";

export interface BeamSection {
  /** Width b, in mm — across the bending plane. */
  readonly width: number;
  /** Depth h, in mm — IN the bending plane. Swapping the two changes I cubically. */
  readonly height: number;
}

export interface BeamInput {
  readonly scheme: BeamScheme;
  /** Span, or cantilever projection, in m. */
  readonly span: number;
  /** Uniformly distributed load, in kN/m. Required by the two udl schemes. */
  readonly load?: number | undefined;
  /** Point load, in kN. Required by the two point schemes. */
  readonly force?: number | undefined;
  /** Modulus of elasticity, in GPa — a material property the user supplies. */
  readonly modulus?: number | undefined;
  /** Second moment of area, in cm^4. Wins over `section` when both are given. */
  readonly inertia?: number | undefined;
  /** A rectangular section, from which I and W are derived when not given directly. */
  readonly section?: BeamSection | undefined;
  /** Section modulus, in cm^3 — for a section that is not rectangular. */
  readonly sectionModulus?: number | undefined;
  /**
   * The user's own limits, in MPa and as a bare L/f ratio. Both are regulated
   * and material quantities that change with the code, the material and the
   * building; the tool holds neither and defaults neither.
   */
  readonly stressLimit?: number | undefined;
  readonly deflectionRatioLimit?: number | undefined;
}

export interface BeamResult {
  /** Support reaction in kN — each support of a simple beam, the fixing of a cantilever. */
  readonly reaction: number;
  /**
   * Maximum shear force, in kN. For all four schemes it is numerically equal
   * to `reaction` — the shear at a support IS the reaction there — but it is
   * named separately because a reader scanning „reactions" for a shear check
   * should not have to re-derive that equality themselves.
   */
  readonly shear: number;
  /** Maximum bending moment in kNm — at midspan, or at the fixing of a cantilever. */
  readonly maxMoment: number;
  /**
   * Moment at the cantilever's fixed support, in kNm — equal to `maxMoment` for
   * the two cantilever schemes, undefined for the two simple-beam schemes,
   * which have no fixing at all. A second name for the same number because
   * „reactions" and „moment" read as separate quantities to someone checking a
   * fixing detail against a drawing.
   */
  readonly fixingMoment: number | undefined;
  /** The I actually used, in cm^4 — from the input or from the rectangle. */
  readonly inertia: number | undefined;
  /** The W actually used, in cm^3. */
  readonly sectionModulus: number | undefined;
  /** Bending stress M/W, in MPa. Undefined when no W was given or derivable. */
  readonly stress: number | undefined;
  /** Maximum deflection, in mm. Undefined when E or I is missing. */
  readonly deflection: number | undefined;
  /** L/f, rounded DOWN to a whole number. Undefined when f is zero. */
  readonly spanOverDeflection: number | undefined;
  /** stress ÷ the user's own limit. */
  readonly stressRatio: number | undefined;
  /**
   * The user's own L/f limit ÷ the computed L/f — inverted on purpose so that
   * both ratios in this result point the same way: a larger number is a larger
   * demand on the beam in both cases.
   */
  readonly deflectionRatio: number | undefined;
}

/**
 * Reactions, moment, stress and deflection for one of four textbook schemes.
 *
 * **Everything is converted to SI before anything is multiplied.** The inputs
 * are in the units an engineer writes down (kN/m, GPa, cm^4, cm^3) and those
 * span sixteen orders of magnitude between them; a single missing 1e-8 turns a
 * deflection of 7.75 mm into 7.75e8 mm, which is obvious, or into a stress that
 * is merely a thousand times wrong, which is not.
 *
 * Absent E or I means no deflection rather than a refusal: the moment and the
 * reactions are complete answers on their own, and a person sizing a section has
 * not chosen a material yet.
 */
export function beamCheck(input: BeamInput): ProResult<BeamResult> {
  const { scheme, span } = input;
  if (!isPositive(span)) return fail("span");

  const distributed = scheme === "simple-udl" || scheme === "cantilever-udl";
  if (distributed && !isNonNegative(input.load)) return fail("load");
  if (!distributed && !isNonNegative(input.force)) return fail("force");
  // The scheme fixes which of the two the arithmetic below actually reads; a
  // value left in the OTHER field — typically after switching schemes without
  // clearing it — is not consumed, and answering anyway would let a typed
  // number look included when it was silently dropped.
  if (distributed && input.force !== undefined) return fail("force");
  if (!distributed && input.load !== undefined) return fail("load");
  if (input.modulus !== undefined && !isPositive(input.modulus)) return fail("modulus");
  if (input.inertia !== undefined && !isPositive(input.inertia)) return fail("inertia");
  if (input.sectionModulus !== undefined && !isPositive(input.sectionModulus)) {
    return fail("sectionModulus");
  }
  if (
    input.section !== undefined &&
    (!isPositive(input.section.width) || !isPositive(input.section.height))
  ) {
    return fail("section");
  }

  const q = (input.load ?? 0) * 1000; // kN/m -> N/m
  const p = (input.force ?? 0) * 1000; // kN -> N
  const e = input.modulus === undefined ? undefined : input.modulus * 1e9; // GPa -> Pa

  // A rectangle in metres: I = b*h^3/12 and W = b*h^2/6, both about the axis the
  // beam bends around. The height is the dimension IN the bending plane.
  const sectionInertia =
    input.section === undefined
      ? undefined
      : (input.section.width / 1000) * (input.section.height / 1000) ** 3 / 12;
  const sectionW =
    input.section === undefined
      ? undefined
      : (input.section.width / 1000) * (input.section.height / 1000) ** 2 / 6;
  const inertiaM4 = input.inertia === undefined ? sectionInertia : input.inertia * 1e-8;
  const modulusM3 =
    input.sectionModulus === undefined ? sectionW : input.sectionModulus * 1e-6;
  const stiffness = e === undefined || inertiaM4 === undefined ? undefined : e * inertiaM4;

  // Positive dimensions do not imply a positive product, and every quantity
  // above is a product. `b·h³/12` for a rectangle of 1e-100 mm underflows to
  // exactly zero, and `E·I` does so from two factors that are each perfectly
  // ordinary — after which the stress and the deflection below are `Infinity` on
  // an `ok: true` result, in a tool somebody sizes a beam with. The check belongs
  // on the derived quantity rather than on the inputs it came from; the refusal
  // names whichever field the user actually typed.
  if (inertiaM4 !== undefined && !isPositive(inertiaM4)) {
    return fail(input.inertia === undefined ? "section" : "inertia");
  }
  if (modulusM3 !== undefined && !isPositive(modulusM3)) {
    return fail(input.sectionModulus === undefined ? "section" : "sectionModulus");
  }
  if (stiffness !== undefined && !isPositive(stiffness)) return fail("modulus");

  let reaction: number;
  let momentNm: number;
  let deflectionM: number | undefined;
  switch (scheme) {
    case "simple-udl":
      reaction = (q * span) / 2;
      momentNm = (q * span ** 2) / 8;
      deflectionM = stiffness === undefined ? undefined : (5 * q * span ** 4) / (384 * stiffness);
      break;
    case "simple-point":
      reaction = p / 2;
      momentNm = (p * span) / 4;
      deflectionM = stiffness === undefined ? undefined : (p * span ** 3) / (48 * stiffness);
      break;
    case "cantilever-udl":
      reaction = q * span;
      momentNm = (q * span ** 2) / 2;
      deflectionM = stiffness === undefined ? undefined : (q * span ** 4) / (8 * stiffness);
      break;
    default:
      reaction = p;
      momentNm = p * span;
      deflectionM = stiffness === undefined ? undefined : (p * span ** 3) / (3 * stiffness);
      break;
  }

  const stress = modulusM3 === undefined ? undefined : momentNm / modulusM3 / 1e6;
  // f = 0 means no load, and L/0 is not a slenderness — it is an empty beam.
  const exactRatio =
    deflectionM === undefined || deflectionM <= 0 ? undefined : span / deflectionM;
  const isCantilever = scheme === "cantilever-udl" || scheme === "cantilever-point";
  return {
    ok: true,
    reaction: reaction / 1000,
    shear: reaction / 1000,
    maxMoment: momentNm / 1000,
    fixingMoment: isCantilever ? momentNm / 1000 : undefined,
    inertia: inertiaM4 === undefined ? undefined : inertiaM4 / 1e-8,
    sectionModulus: modulusM3 === undefined ? undefined : modulusM3 / 1e-6,
    stress,
    deflection: deflectionM === undefined ? undefined : deflectionM * 1000,
    spanOverDeflection: exactRatio === undefined ? undefined : floorSnapped(exactRatio),
    stressRatio: stress === undefined ? undefined : ratioAgainst(stress, input.stressLimit),
    deflectionRatio:
      exactRatio === undefined || input.deflectionRatioLimit === undefined
        ? undefined
        : ratioAgainst(input.deflectionRatioLimit, exactRatio),
  };
}

/* ---------------------------------------------------------------------------
 * concrete-takeoff — „Kubatura i oplata"
 * ------------------------------------------------------------------------ */

/**
 * The five elements, each carrying its own dimension names.
 *
 * A discriminated union rather than one bag of optional numbers because the
 * formwork formula differs per element in a way that is not derivable from the
 * dimensions: a strip footing is formed on two faces and a slab on five, and a
 * shape that could hold a slab's dimensions with a footing's `kind` would be a
 * takeoff that is quietly 60 % short.
 */
export type ConcreteElement =
  | { readonly kind: "slab"; readonly a: number; readonly b: number; readonly d: number }
  | {
      readonly kind: "beam";
      readonly b: number;
      /**
       * The beam's OWN full depth, not its drop below a slab soffit. Its
       * formwork (`2h + b`, two sides plus the soffit) is counted entirely on
       * its own — if the beam sits under a slab counted separately, the strip
       * of soffit the beam and the slab share is the beam's, so do not also
       * count it as part of the slab's underside or the takeoff double-counts
       * that strip of ceiling formwork.
       */
      readonly h: number;
      readonly length: number;
    }
  | { readonly kind: "column"; readonly a: number; readonly b: number; readonly h: number }
  | {
      readonly kind: "strip-footing";
      readonly b: number;
      readonly h: number;
      readonly length: number;
    }
  | { readonly kind: "pad-footing"; readonly a: number; readonly b: number; readonly h: number };

export interface ConcreteInput {
  /** Every dimension in metres. */
  readonly element: ConcreteElement;
  readonly pieces: number;
  /** Total opening area to deduct, in m^2. Slab only. */
  readonly openings?: number | undefined;
  /** Waste, in %. A site and placing-method figure the user knows, never a default. */
  readonly waste: number;
  /** Mixer or truck capacity, in m^3. */
  readonly mixerVolume?: number | undefined;
  /** Density of the user's own mix, in kg/m^3. */
  readonly density?: number | undefined;
  /** Reinforcement rate, in kg per m^3 of concrete — a design figure. */
  readonly rebarRate?: number | undefined;
}

export interface ConcreteResult {
  readonly netVolume: number;
  readonly grossVolume: number;
  /** Formwork area, in m^2 — see `concreteTakeoff` for what each element counts. */
  readonly formwork: number;
  /** Concrete mass in TONNES, from the volume including waste. */
  readonly concreteMass: number | undefined;
  /** Reinforcement mass in kg, from the NET volume — waste is concrete, not steel. */
  readonly rebarMass: number | undefined;
  readonly batches: number | undefined;
}

/**
 * Volume, formwork area and batch count for one repeated element.
 *
 * **What counts as formwork is the only line two estimators read differently**,
 * so it is fixed here and printed beside the answer: a slab is soffit plus four
 * edge bands, a beam under a slab is two sides plus the soffit, a column and a
 * pad footing are all four sides, and a strip footing is the two sides only
 * because its bottom is the ground.
 *
 * An opening reduces the VOLUME and never the formwork: the hole has to be
 * boxed out, so it adds shuttering rather than removing it. Counting it off the
 * formwork is the error this note exists to prevent.
 */
export function concreteTakeoff(input: ConcreteInput): ProResult<ConcreteResult> {
  const { element, pieces } = input;
  if (!isIntegerIn(pieces, 1, 100000)) return fail("pieces");
  if (!isInRange(input.waste, 0, 100)) return fail("waste");
  if (input.mixerVolume !== undefined && !isPositive(input.mixerVolume)) {
    return fail("mixerVolume");
  }
  if (input.density !== undefined && !isInRange(input.density, 1000, 3500)) return fail("density");
  if (input.rebarRate !== undefined && !isPositive(input.rebarRate)) return fail("rebarRate");
  // `openings` is read only inside the slab branch below; a value left there
  // after switching the element kind away from `slab` describes a deduction
  // this takeoff would never apply, and answering with the undeducted volume
  // would be the typed-but-dropped mistake this file refuses elsewhere.
  if (element.kind !== "slab" && input.openings !== undefined) return fail("openings");

  let plan: number;
  let netVolume: number;
  let formwork: number;
  if (element.kind === "slab") {
    if (!isPositive(element.a)) return fail("a");
    if (!isPositive(element.b)) return fail("b");
    if (!isPositive(element.d)) return fail("d");
    plan = element.a * element.b;
    const openings = input.openings ?? 0;
    if (!isNonNegative(openings) || openings >= plan) return fail("openings");
    netVolume = (plan - openings) * element.d * pieces;
    formwork = (plan + 2 * (element.a + element.b) * element.d) * pieces;
  } else if (element.kind === "beam") {
    if (!isPositive(element.b)) return fail("b");
    if (!isPositive(element.h)) return fail("h");
    if (!isPositive(element.length)) return fail("length");
    netVolume = element.b * element.h * element.length * pieces;
    formwork = (2 * element.h + element.b) * element.length * pieces;
  } else if (element.kind === "strip-footing") {
    if (!isPositive(element.b)) return fail("b");
    if (!isPositive(element.h)) return fail("h");
    if (!isPositive(element.length)) return fail("length");
    netVolume = element.b * element.h * element.length * pieces;
    formwork = 2 * element.h * element.length * pieces;
  } else {
    if (!isPositive(element.a)) return fail("a");
    if (!isPositive(element.b)) return fail("b");
    if (!isPositive(element.h)) return fail("h");
    netVolume = element.a * element.b * element.h * pieces;
    formwork = 2 * (element.a + element.b) * element.h * pieces;
  }

  const grossVolume = netVolume * (1 + input.waste / 100);
  return {
    ok: true,
    netVolume,
    grossVolume,
    formwork,
    concreteMass: input.density === undefined ? undefined : (grossVolume * input.density) / 1000,
    rebarMass: input.rebarRate === undefined ? undefined : netVolume * input.rebarRate,
    batches:
      input.mixerVolume === undefined ? undefined : ceilSnapped(grossVolume / input.mixerVolume),
  };
}

/* ---------------------------------------------------------------------------
 * drawing-scale — „Razmera crteža"
 * ------------------------------------------------------------------------ */

/**
 * ISO 216:2007 A-series sheets, in mm, as width x height in PORTRAIT.
 *
 * The series is derived rather than measured — every sheet is the 1:sqrt(2)
 * rectangle and A0 is one square metre — so these are definitional figures and
 * may be embedded. Landscape is the same sheet turned, never a separate row.
 */
const SHEETS = {
  A0: { width: 841, height: 1189 },
  A1: { width: 594, height: 841 },
  A2: { width: 420, height: 594 },
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
} as const;

/**
 * ISO 5455:1979 Technical drawings - Scales: the enlargement series, full
 * size, and the reduction series, as M in 1:M — so an enlargement of 2:1 is
 * M = 0.5. Ascending by M, which is DESCENDING by drawn size: the detail
 * scales (2:1 … 50:1) come first because a smaller M draws larger.
 */
const SCALE_SERIES = [
  0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
] as const;

export type SheetSize = keyof typeof SHEETS;
export type SheetOrientation = "portrait" | "landscape";
export type ScaleDirection = "paper-to-real" | "real-to-paper";

export interface ScaleLengthInput {
  /** M in the 1:M notation. Above 0 — below 1 is an ISO 5455 enlargement, e.g. 2:1 is M = 0.5. */
  readonly denominator: number;
  readonly direction: ScaleDirection;
  /** In mm for `paper-to-real`, in m for `real-to-paper`. */
  readonly length: number;
}

export interface ScaleLengthResult {
  readonly paperLength: number;
  readonly realLength: number;
}

/**
 * A length across the scale, in either direction.
 *
 * The two directions are one input rather than two functions because they are
 * the same equation read from either end, and a pair of functions is a pair that
 * can disagree. Both numbers come back every time, so the surface never has to
 * work out which one it asked for.
 */
export function drawingScaleLength(input: ScaleLengthInput): ProResult<ScaleLengthResult> {
  const { denominator, direction, length } = input;
  if (!isPositive(denominator)) return fail("denominator");
  if (!isPositive(length)) return fail("length");
  if (direction === "paper-to-real") {
    return { ok: true, paperLength: length, realLength: (length * denominator) / 1000 };
  }
  return { ok: true, paperLength: (length * 1000) / denominator, realLength: length };
}

/**
 * An area across the scale: cm^2 measured on the sheet as m^2 on the ground.
 *
 * The scale factor is SQUARED, and that is the whole content of this function.
 * 12.5 cm^2 at 1:100 is 12.5 m^2 and not 12.5 dm^2 — the factor is 100^2, and
 * carrying the linear factor into an area is the single most common scale error
 * on a take-off sheet.
 */
export function drawingScaleArea(
  denominator: number,
  paperArea: number,
): ProResult<{ readonly realArea: number }> {
  if (!isPositive(denominator)) return fail("denominator");
  if (!isPositive(paperArea)) return fail("paperArea");
  return { ok: true, realArea: paperArea * 1e-4 * denominator ** 2 };
}

export interface ScaleFitInput {
  readonly denominator: number;
  /** The object's plan size, in m. */
  readonly objectWidth: number;
  readonly objectHeight: number;
  readonly sheet: SheetSize;
  readonly orientation: SheetOrientation;
  /** Title block and border allowance, in mm, taken off BOTH edges of each axis. */
  readonly margin: number;
}

export interface ScaleFitResult {
  readonly drawnWidth: number;
  readonly drawnHeight: number;
  readonly usableWidth: number;
  readonly usableHeight: number;
  readonly fits: boolean;
  /** Whether it fits with the OBJECT turned 90 degrees — the sheet stays as chosen. */
  readonly fitsRotated: boolean;
  /** The smallest M from the ISO 5455 series that fits, i.e. the largest scale. */
  readonly seriesDenominator: number | undefined;
  /** The exact M at which it would just fit, whether or not the series holds it. */
  readonly requiredDenominator: number;
}

/**
 * Whether an object drawn at 1:M fits the chosen sheet, and which standard scale
 * would.
 *
 * „Largest scale that fits" means the SMALLEST M: 1:50 is larger than 1:100.
 * That inversion is the reason this is computed rather than eyeballed.
 *
 * `requiredDenominator` considers the object turned 90 degrees exactly as the
 * fit test does. A required scale that ignored a placement the fit test accepts
 * would contradict its own neighbour in the same result.
 */
export function drawingScaleFit(input: ScaleFitInput): ProResult<ScaleFitResult> {
  const { denominator, objectWidth, objectHeight, margin } = input;
  if (!isPositive(denominator)) return fail("denominator");
  if (!isPositive(objectWidth)) return fail("objectWidth");
  if (!isPositive(objectHeight)) return fail("objectHeight");
  if (!isNonNegative(margin)) return fail("margin");

  // `SheetSize` is `keyof typeof SHEETS`, so TypeScript treats this index as
  // always defined and `sheet.width` two lines down would throw rather than
  // refuse. The type is derived FROM the table, which makes the two agree today
  // and says nothing about the string that actually arrives.
  if (!isKeyOf(input.sheet, SHEETS)) return fail("sheet");
  const sheet = SHEETS[input.sheet];
  const portrait = input.orientation === "portrait";
  const usableWidth = (portrait ? sheet.width : sheet.height) - 2 * margin;
  const usableHeight = (portrait ? sheet.height : sheet.width) - 2 * margin;
  // A margin at or past half the shorter side leaves nothing to draw on, and a
  // fit answer computed against a negative sheet is worse than no answer.
  if (usableWidth <= 0 || usableHeight <= 0) return fail("margin");

  const at = (m: number): { readonly w: number; readonly h: number } => ({
    w: (objectWidth * 1000) / m,
    h: (objectHeight * 1000) / m,
  });
  const fitsAt = (m: number): boolean => {
    const { w, h } = at(m);
    return (w <= usableWidth && h <= usableHeight) || (h <= usableWidth && w <= usableHeight);
  };
  const drawn = at(denominator);
  const upright = drawn.w <= usableWidth && drawn.h <= usableHeight;
  const turned = drawn.h <= usableWidth && drawn.w <= usableHeight;
  const required = Math.min(
    Math.max(drawn.w / usableWidth, drawn.h / usableHeight),
    Math.max(drawn.h / usableWidth, drawn.w / usableHeight),
  );
  return {
    ok: true,
    drawnWidth: drawn.w,
    drawnHeight: drawn.h,
    usableWidth,
    usableHeight,
    fits: upright,
    fitsRotated: turned,
    seriesDenominator: SCALE_SERIES.find(fitsAt),
    requiredDenominator: required * denominator,
  };
}

/* ---------------------------------------------------------------------------
 * earthwork-prismoidal — „Zapremina između profila"
 * ------------------------------------------------------------------------ */

export interface EarthworkProfile {
  /** Chainage, in m. Strictly increasing down the list. */
  readonly station: number;
  /** Cut area of this cross-section, in m^2. */
  readonly cut: number;
  /** Fill area of this cross-section, in m^2. */
  readonly fill: number;
  /**
   * Measured mid-section area of the segment that BEGINS at this station, in
   * m^2. Present only when the user actually measured it — see `earthworkVolumes`.
   */
  readonly midCut?: number | undefined;
  readonly midFill?: number | undefined;
}

export interface EarthworkInput {
  readonly profiles: readonly EarthworkProfile[];
  /** Bulking of the excavated soil, in % — a ground property the user knows. */
  readonly bulking?: number | undefined;
  /** Settlement of the placed fill, in %. */
  readonly settlement?: number | undefined;
}

export type EarthworkMethod = "average-end-area" | "prismoidal";

export interface EarthworkSegment {
  readonly from: number;
  readonly to: number;
  readonly length: number;
  readonly cut: number;
  readonly fill: number;
  readonly cutMethod: EarthworkMethod;
  readonly fillMethod: EarthworkMethod;
}

export interface EarthworkResult {
  readonly segments: readonly EarthworkSegment[];
  readonly totalCut: number;
  readonly totalFill: number;
  /** Cut minus fill, both IN SITU — the honest balance when no percentages are given. */
  readonly balance: number;
  /** Cut loose, from `bulking` alone — a complete answer on its own, with no fill to pair it against. */
  readonly cutLoose: number | undefined;
  /** Fill after settlement, from `settlement` alone — likewise complete by itself. */
  readonly fillWithSettlement: number | undefined;
  /**
   * The balance in the two adjusted states — only when BOTH percentages are
   * given. This is the field the review's „ne odbija primenu procenta samo na
   * jednu stranu" note is actually about: a BALANCE built from a bulked cut
   * and an un-settled fill would be comparing two different physical states as
   * if they were one, which is the one-sided mistake the clause exists to
   * stop. `cutLoose` and `fillWithSettlement` above are not that — each is a
   * complete, correctly-named answer about ONE pile of earth on its own, and
   * refusing a `bulking` typed without a `settlement` would refuse an honest
   * question nobody asked. The names already carry the state (`cutLoose` is
   * loose, `fillWithSettlement` is settled), so nothing here can be misread as
   * the other.
   */
  readonly balanceAdjusted: number | undefined;
}

/**
 * Volumes between cross-sections, by average end area or by the prismoidal rule.
 *
 * **The prismoidal rule is applied only where a mid-section area was measured.**
 * A_m is not the average of the two ends — for a shape that tapers (a frustum
 * going 4x4 to 2x2, say) it is SMALLER than the average, which is exactly why
 * average-end-area OVERestimates a tapering volume: a 10 x 30 x 20 frustum
 * segment gives 450 m^3 by average-end-area against 430 m^3 by the prismoidal
 * rule, not the other way round. Deriving A_m from the two ends would be
 * inventing the very correction the formula exists to make, so it is taken only
 * where the user measured it.
 *
 * Cut and fill are summed separately and never netted inside a section: earth
 * cut here does not cancel earth filled there, it has to be moved, and a tool
 * that subtracted them would hide the haul.
 */
export function earthworkVolumes(input: EarthworkInput): ProResult<EarthworkResult> {
  const { profiles } = input;
  if (!isIntegerIn(profiles.length, 2, 500)) return fail("rows");
  if (input.bulking !== undefined && !isInRange(input.bulking, 0, 100)) return fail("bulking");
  if (input.settlement !== undefined && !isInRange(input.settlement, 0, 100)) {
    return fail("settlement");
  }
  for (const [index, row] of profiles.entries()) {
    if (!Number.isFinite(row.station)) return fail(`station:${index}`);
    if (!isNonNegative(row.cut)) return fail(`cut:${index}`);
    if (!isNonNegative(row.fill)) return fail(`fill:${index}`);
    if (row.midCut !== undefined && !isNonNegative(row.midCut)) return fail(`midCut:${index}`);
    if (row.midFill !== undefined && !isNonNegative(row.midFill)) return fail(`midFill:${index}`);
  }

  // A mid-section area is attached to the profile that BEGINS the segment it
  // describes (`start.midCut` below) — the last profile begins no segment at
  // all, so a value typed there is exactly the field a surveyor who measured
  // the mid-section of the FINAL segment would reach for, and it would
  // otherwise pass the loop above and then never be read by the one after
  // it. Refusing it is the same rule this file applies to `levelRun`'s
  // `distance` and `beamCheck`'s spare `force`/`load`: a typed value must
  // not look included when it has been silently dropped.
  const lastIndex = profiles.length - 1;
  const lastProfile = profiles[lastIndex];
  if (lastProfile?.midCut !== undefined) return fail(`midCut:${lastIndex}`);
  if (lastProfile?.midFill !== undefined) return fail(`midFill:${lastIndex}`);

  const segments: EarthworkSegment[] = [];
  let totalCut = 0;
  let totalFill = 0;
  for (let i = 1; i < profiles.length; i += 1) {
    const start = profiles[i - 1];
    const end = profiles[i];
    if (start === undefined || end === undefined) return fail(`station:${i}`);
    const length = end.station - start.station;
    if (length <= 0) return fail(`station:${i}`);
    const volume = (area1: number, area2: number, mid: number | undefined): number =>
      mid === undefined ? (length * (area1 + area2)) / 2 : (length / 6) * (area1 + 4 * mid + area2);
    const cut = volume(start.cut, end.cut, start.midCut);
    const fill = volume(start.fill, end.fill, start.midFill);
    totalCut += cut;
    totalFill += fill;
    segments.push({
      from: start.station,
      to: end.station,
      length,
      cut,
      fill,
      cutMethod: start.midCut === undefined ? "average-end-area" : "prismoidal",
      fillMethod: start.midFill === undefined ? "average-end-area" : "prismoidal",
    });
  }

  const cutLoose = input.bulking === undefined ? undefined : totalCut * (1 + input.bulking / 100);
  const fillWithSettlement =
    input.settlement === undefined ? undefined : totalFill * (1 + input.settlement / 100);
  return {
    ok: true,
    segments,
    totalCut,
    totalFill,
    balance: totalCut - totalFill,
    cutLoose,
    fillWithSettlement,
    balanceAdjusted:
      cutLoose === undefined || fillWithSettlement === undefined
        ? undefined
        : cutLoose - fillWithSettlement,
  };
}

/* ---------------------------------------------------------------------------
 * level-run — „Nivelman"
 * ------------------------------------------------------------------------ */

export interface LevelReading {
  /** The point's own label, passed straight through — data, not copy. */
  readonly point: string;
  /** Backsight, in m. Opens a station from a point whose elevation is known. */
  readonly backsight?: number | undefined;
  /** Intermediate sight, in m. Reads a point WITHOUT carrying height forward. */
  readonly intermediate?: number | undefined;
  /** Foresight, in m. Establishes the point and closes the station. */
  readonly foresight?: number | undefined;
  /** Sight length of the station this row opens, in m. */
  readonly distance?: number | undefined;
}

export interface LevelRunInput {
  /** Elevation of the opening benchmark, in m. */
  readonly startElevation: number;
  readonly readings: readonly LevelReading[];
  /** Known elevation of the closing benchmark, in m. Without it there is no misclosure. */
  readonly closingElevation?: number | undefined;
}

export interface LevelRow {
  readonly point: string;
  /** Height of collimation after this row's backsight, in m. Only on rows that carry one. */
  readonly instrumentHeight: number | undefined;
  readonly elevation: number;
  /** Distribution correction, in m. Undefined until a closing elevation is given. */
  readonly correction: number | undefined;
  readonly adjustedElevation: number | undefined;
}

export interface LevelRunResult {
  readonly rows: readonly LevelRow[];
  readonly sumBacksights: number;
  readonly sumForesights: number;
  readonly firstElevation: number;
  readonly lastElevation: number;
  /** (SumBS - SumFS) - (H_last - H_first) — the arithmetic check, as ONE number. */
  readonly checkDifference: number;
  /** Misclosure, in m, computed minus known. The sign is kept. */
  readonly misclosure: number | undefined;
  readonly stations: number;
}

/**
 * A levelling run by height of collimation, with the check and the misclosure.
 *
 * **Intermediate sights are deliberately outside the check.** A point seen only
 * as an IS carries no height forward, so `SumBS − SumFS` must equal the change in
 * elevation of the chain alone — that is what makes the check able to catch a
 * miscopied turning point at all. Folding the IS readings in would make it
 * balance always and detect nothing.
 *
 * In code the check is an identity and cannot fail; it is computed and returned
 * because the number a person then compares against their field book is the one
 * that catches the transcription error, which is the error this check is for.
 *
 * The correction is distributed by sight length when the lengths are given, and
 * by station count otherwise. Either way the corrections sum to exactly −f, so
 * the last point lands on the known elevation rather than near it.
 */
export function levelRun(input: LevelRunInput): ProResult<LevelRunResult> {
  const { startElevation, readings, closingElevation } = input;
  if (!Number.isFinite(startElevation)) return fail("startElevation");
  if (!isIntegerIn(readings.length, 1, 200)) return fail("rows");
  if (closingElevation !== undefined && !Number.isFinite(closingElevation)) {
    return fail("closingElevation");
  }

  interface Draft {
    readonly point: string;
    readonly instrumentHeight: number | undefined;
    readonly elevation: number;
    readonly stationWeight: number;
    readonly distanceWeight: number;
  }

  let elevation = startElevation;
  let instrument: number | undefined;
  // A backsight needs a point whose elevation is already established: the
  // opening benchmark, or the point the last foresight just fixed. Two
  // backsights with no foresight between them stand on nothing.
  let pointAvailable = true;
  let stations = 0;
  let distanceSoFar = 0;
  let distanceCount = 0;
  let sumBacksights = 0;
  let sumForesights = 0;
  const drafts: Draft[] = [];

  for (const [index, row] of readings.entries()) {
    const { backsight, intermediate, foresight } = row;
    if (backsight === undefined && intermediate === undefined && foresight === undefined) {
      return fail(`row:${index}`);
    }
    if (backsight !== undefined && !Number.isFinite(backsight)) return fail(`backsight:${index}`);
    if (intermediate !== undefined && !Number.isFinite(intermediate)) {
      return fail(`intermediate:${index}`);
    }
    if (foresight !== undefined && !Number.isFinite(foresight)) return fail(`foresight:${index}`);
    // The sight length belongs to the STATION a backsight opens; on any other
    // row — foresight- or intermediate-only — it names nothing this run can
    // act on. Dropping it silently would be the „typed but not included"
    // mistake refusal exists to prevent, not a convenience.
    if (row.distance !== undefined && backsight === undefined) return fail(`distance:${index}`);

    let rowElevation = elevation;
    if (foresight !== undefined) {
      if (instrument === undefined) return fail(`foresight:${index}`);
      rowElevation = instrument - foresight;
      elevation = rowElevation;
      sumForesights += foresight;
      pointAvailable = true;
    } else if (intermediate !== undefined) {
      if (instrument === undefined) return fail(`intermediate:${index}`);
      rowElevation = instrument - intermediate;
    }

    // Captured BEFORE this row's own backsight is consumed: the row's elevation
    // was fixed by the stations that came before it, not by the one it opens.
    const stationWeight = stations;
    const distanceWeight = distanceSoFar;
    let instrumentHeight: number | undefined;
    if (backsight !== undefined) {
      if (!pointAvailable) return fail(`backsight:${index}`);
      instrumentHeight = rowElevation + backsight;
      instrument = instrumentHeight;
      sumBacksights += backsight;
      stations += 1;
      pointAvailable = false;
      if (row.distance !== undefined) {
        if (!isPositive(row.distance)) return fail(`distance:${index}`);
        distanceSoFar += row.distance;
        distanceCount += 1;
      }
    }
    drafts.push({
      point: row.point,
      instrumentHeight,
      elevation: rowElevation,
      stationWeight,
      distanceWeight,
    });
  }

  // Weighting by sight length only means what it says when EVERY station
  // reports one. A run with lengths on some backsights and none on the rest
  // is not "mostly by distance" — it is an incomplete field book, and station
  // -count weighting would treat the missing lengths as zero without saying so.
  if (distanceCount > 0 && distanceCount < stations) return fail("distance");

  const misclosure = closingElevation === undefined ? undefined : elevation - closingElevation;
  // Sight lengths that sum to nothing are lengths nobody entered; falling back
  // to the station count is the same distribution with every leg equal.
  const byDistance = distanceSoFar > 0;
  const divisor = byDistance ? distanceSoFar : stations;
  const rows: LevelRow[] = drafts.map((draft) => {
    const correction =
      misclosure === undefined || divisor <= 0
        ? undefined
        : -misclosure * ((byDistance ? draft.distanceWeight : draft.stationWeight) / divisor);
    return {
      point: draft.point,
      instrumentHeight: draft.instrumentHeight,
      elevation: draft.elevation,
      correction,
      adjustedElevation: correction === undefined ? undefined : draft.elevation + correction,
    };
  });

  return {
    ok: true,
    rows,
    sumBacksights,
    sumForesights,
    firstElevation: startElevation,
    lastElevation: elevation,
    checkDifference: sumBacksights - sumForesights - (elevation - startElevation),
    misclosure,
    stations,
  };
}

/* ---------------------------------------------------------------------------
 * rebar-weight — „Masa armature"
 * ------------------------------------------------------------------------ */

/**
 * Conventional density of reinforcing steel, kg/m^3.
 *
 * EN 10080:2005 and ISO 6935-2:2019 both fix 7,85 kg/dm^3 as the CONVENTIONAL
 * density from which the nominal mass per metre is derived from the nominal
 * diameter. It is a definitional figure and not a measurement of any particular
 * batch, which is why a table of nominal masses and this multiplication agree to
 * the third decimal — the table is this arithmetic, already done.
 */
const STEEL_DENSITY = 7850;

export interface RebarLengthInput {
  /** Nominal diameter, in mm. */
  readonly diameter: number;
  /** Length of one bar, in m. */
  readonly barLength: number;
  readonly bars: number;
}

export interface RebarLengthResult {
  readonly massPerMetre: number;
  readonly totalLength: number;
  readonly totalMass: number;
  readonly totalTonnes: number;
}

export interface RebarMassInput {
  readonly diameter: number;
  /** Mass to convert back into metres, in kg. */
  readonly mass: number;
  /** Stock bar length, in m. Without it only the total length is answerable. */
  readonly barLength?: number | undefined;
}

export interface RebarMassResult {
  readonly massPerMetre: number;
  readonly totalLength: number;
  readonly wholeBars: number | undefined;
  /** Metres left over after the whole bars, in m. */
  readonly remainder: number | undefined;
}

/**
 * Nominal mass per metre of a bar of nominal diameter, in kg/m.
 *
 * The ribs are not modelled, and that is correct rather than a simplification:
 * nominal mass is DEFINED from the plain nominal cross-section, so a rolled rib
 * pattern changes the real bar and not the figure everyone bills against.
 */
export function rebarMassPerMetre(diameter: number): ProResult<{ readonly massPerMetre: number }> {
  if (!isInRange(diameter, 1, 60)) return fail("diameter");
  const area = (Math.PI / 4) * (diameter / 1000) ** 2;
  return { ok: true, massPerMetre: area * STEEL_DENSITY };
}

/** Metres of bar into kilograms. */
export function rebarFromLength(input: RebarLengthInput): ProResult<RebarLengthResult> {
  const perMetre = rebarMassPerMetre(input.diameter);
  if (!perMetre.ok) return perMetre;
  if (!isPositive(input.barLength)) return fail("barLength");
  if (!isIntegerIn(input.bars, 1, 1000000)) return fail("bars");
  const totalLength = input.barLength * input.bars;
  const totalMass = perMetre.massPerMetre * totalLength;
  return {
    ok: true,
    massPerMetre: perMetre.massPerMetre,
    totalLength,
    totalMass,
    totalTonnes: totalMass / 1000,
  };
}

/**
 * Kilograms back into metres, and into whole stock bars.
 *
 * The bar count is rounded DOWN: the offcut of the last bar is metres you have
 * and cannot use as a bar, so rounding up would report stock that does not
 * exist. Without a stock length the count is simply not answered.
 */
export function rebarFromMass(input: RebarMassInput): ProResult<RebarMassResult> {
  const perMetre = rebarMassPerMetre(input.diameter);
  if (!perMetre.ok) return perMetre;
  if (!isPositive(input.mass)) return fail("mass");
  if (input.barLength !== undefined && !isPositive(input.barLength)) return fail("barLength");
  const totalLength = input.mass / perMetre.massPerMetre;
  const wholeBars =
    input.barLength === undefined ? undefined : floorSnapped(totalLength / input.barLength);
  return {
    ok: true,
    massPerMetre: perMetre.massPerMetre,
    totalLength,
    wholeBars,
    remainder:
      wholeBars === undefined || input.barLength === undefined
        ? undefined
        : totalLength - wholeBars * input.barLength,
  };
}

/**
 * Slope percent, permille, degrees or 1:n (rise:run) as an angle in radians —
 * the one conversion `roofPitch` and `slopeGrade` both need.
 *
 * Written once and called from both, because four copies of `atan(x/100)`
 * scattered across two functions are the exact shape of defect the doctrine
 * forbids: the fourth copy is the one that silently uses a different
 * convention for 1:n. `undefined` means the notation cannot express an angle
 * at all here — degrees at or past vertical, or 1:n with n = 0 (which would be
 * a horizontal run of zero, i.e. vertical again).
 */
function angleFromSlopeNotation(
  value: number,
  unit: "percent" | "permille" | "degrees" | "ratio",
): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (unit === "percent") return Math.atan(value / 100);
  if (unit === "permille") return Math.atan(value / 1000);
  if (unit === "degrees") return Math.abs(value) >= 90 ? undefined : value * RAD_PER_DEG;
  return value === 0 ? undefined : Math.atan(1 / value);
}

/* ---------------------------------------------------------------------------
 * roof-pitch — „Nagib krova"
 * ------------------------------------------------------------------------ */

/** How the pitch was written down: in degrees, in per cent, or as 1:n. */
export type RoofPitchUnit = "degrees" | "percent" | "ratio";

export interface RoofInput {
  /** The pitch in `pitchUnit`. For `ratio` this is n in the 1:n notation. */
  readonly pitch: number;
  readonly pitchUnit: RoofPitchUnit;
  /** Horizontal run from eaves to ridge, in m. */
  readonly base: number;
  /** Eaves overhang measured HORIZONTALLY, in m. */
  readonly eaves?: number | undefined;
  /** Plan area of the roof plane, in m^2. */
  readonly planArea?: number | undefined;
  /** The second plane's run, in m — the hip needs both. */
  readonly secondBase?: number | undefined;
}

export interface RoofResult {
  readonly angle: number;
  readonly height: number;
  readonly rafter: number;
  readonly rafterWithEaves: number | undefined;
  /** True area of the roof plane, in m^2. */
  readonly slopeArea: number | undefined;
  /** Horizontal projection of the hip, in m. */
  readonly hipRun: number | undefined;
  readonly hipLength: number | undefined;
  /** The hip's own pitch above the horizontal, in degrees. */
  readonly hipAngle: number | undefined;
}

/**
 * Ridge height, rafter length, true plane area and the hip, from a pitch in any
 * of its three notations.
 *
 * **The plan area is DIVIDED by the cosine, never multiplied by the pitch.**
 * Multiplying a plan area by the slope percentage is the substitution that is
 * made on site constantly and it is out by about 13 % at 30 degrees — enough to
 * order a pallet of tiles too few.
 *
 * The hip is always slacker than either plane it joins, because its horizontal
 * run sqrt(b1^2 + b2^2) is longer than either run while the height is the same.
 * A hip that came out steeper than the planes is the sign the two runs were
 * added instead of squared.
 */
export function roofPitch(input: RoofInput): ProResult<RoofResult> {
  const { pitch, pitchUnit, base } = input;
  // A roof pitch is never negative in this tool — `percent`/`degrees` reject it
  // up front, `ratio` rejects it via `isPositive` — even though the shared
  // helper below would happily compute an angle for a negative percent.
  if (!Number.isFinite(pitch)) return fail("pitch");
  if (pitchUnit === "ratio" ? !isPositive(pitch) : pitch < 0) return fail("pitch");
  const angle = angleFromSlopeNotation(pitch, pitchUnit);
  // 90 degrees is refused rather than clamped: cos goes to zero and the rafter,
  // the true area and the hip all go to infinity together.
  if (angle === undefined) return fail("pitch");
  if (!isPositive(base)) return fail("base");
  if (input.eaves !== undefined && !isNonNegative(input.eaves)) return fail("eaves");
  if (input.planArea !== undefined && !isPositive(input.planArea)) return fail("planArea");
  if (input.secondBase !== undefined && !isPositive(input.secondBase)) return fail("secondBase");

  const cosine = Math.cos(angle);
  const height = base * Math.tan(angle);
  const hipRun =
    input.secondBase === undefined ? undefined : Math.hypot(base, input.secondBase);
  return {
    ok: true,
    angle: angle * DEG_PER_RAD,
    height,
    rafter: base / cosine,
    rafterWithEaves:
      input.eaves === undefined ? undefined : base / cosine + input.eaves / cosine,
    slopeArea: input.planArea === undefined ? undefined : input.planArea / cosine,
    hipRun,
    hipLength: hipRun === undefined ? undefined : Math.hypot(hipRun, height),
    hipAngle: hipRun === undefined ? undefined : Math.atan(height / hipRun) * DEG_PER_RAD,
  };
}

/* ---------------------------------------------------------------------------
 * room-surfaces — „Površine prostorije"
 * ------------------------------------------------------------------------ */

/** How the product's coverage was declared. The same figure means two things. */
export type CoverageMode = "area-per-litre" | "mass-per-area";

/** A door has no sill to reveal; a window ordinarily does. */
export type RoomOpeningKind = "door" | "window";

export interface RoomOpening {
  /** In m. */
  readonly width: number;
  readonly height: number;
  readonly count: number;
  readonly kind: RoomOpeningKind;
  /**
   * Count the sill's own reveal for THIS opening. Undefined defers to the
   * convention — on, for a window; off, for a door — because the two trades
   * that read this field disagree by default and neither guess should be
   * silent: the field exists precisely so a window with no sill reveal, or a
   * door with one, can say so per opening rather than for the whole room.
   */
  readonly includeSill?: boolean | undefined;
}

export interface RoomInput {
  /** Room length and width, in m. Give these or `perimeter`. */
  readonly length?: number | undefined;
  readonly width?: number | undefined;
  /** Perimeter measured directly, in m — for a plan that is not a rectangle. */
  readonly perimeter?: number | undefined;
  /** Clear height, in m. */
  readonly height: number;
  readonly openings: readonly RoomOpening[];
  readonly deductOpenings: boolean;
  /** Reveal depth, in m. */
  readonly revealDepth?: number | undefined;
  /** Ceiling area, in m^2 — needed when only a perimeter was given. */
  readonly ceilingArea?: number | undefined;
  readonly includeWalls: boolean;
  readonly includeReveals: boolean;
  readonly includeCeiling: boolean;
  /** Coverage from the product declaration: m^2 per litre, or kg per m^2. */
  readonly coverage?: number | undefined;
  readonly coverageMode?: CoverageMode | undefined;
  readonly coats?: number | undefined;
}

export interface RoomResult {
  readonly perimeter: number;
  readonly grossWall: number;
  readonly openingArea: number;
  /** Gross wall less the openings when they are deducted. May be NEGATIVE — see below. */
  readonly netWall: number;
  /** Running length of reveal, in m. */
  readonly revealLength: number;
  /** Undefined without a reveal depth — see `roomSurfaces` for when that can happen. */
  readonly revealArea: number | undefined;
  readonly ceiling: number | undefined;
  readonly totalArea: number;
  /** Material needed, in litres or in kg according to `coverageMode`. */
  readonly quantity: number | undefined;
}

/**
 * Wall, ceiling and reveal areas for one room, and the material they need.
 *
 * **A negative net wall is reported as it is.** Openings larger than the wall
 * means the measurements are wrong, and clamping to zero would hide exactly the
 * mistake the person needs to see.
 *
 * **The ceiling is never derived from a perimeter.** Two rooms of the same
 * perimeter can differ in floor area by any factor you like; the perimeter says
 * nothing about the area it encloses. When only a perimeter was measured, the
 * ceiling area is asked for separately or the ceiling is left out.
 *
 * The coverage mode is a required choice rather than a guess because the same
 * number, say 1.2, is a plausible declaration in both units and the two answers
 * differ by a factor of 1.44 — reading kg/m^2 as m^2/l is not a small error.
 */
export function roomSurfaces(input: RoomInput): ProResult<RoomResult> {
  if (!isPositive(input.height)) return fail("height");
  if (input.length !== undefined && !isPositive(input.length)) return fail("length");
  if (input.width !== undefined && !isPositive(input.width)) return fail("width");
  const derived =
    isPositive(input.length) && isPositive(input.width)
      ? { plan: input.length * input.width, perimeter: 2 * (input.length + input.width) }
      : undefined;
  const perimeter = input.perimeter ?? derived?.perimeter;
  if (!isPositive(perimeter)) return fail("perimeter");
  if (input.revealDepth !== undefined && !isNonNegative(input.revealDepth)) {
    return fail("revealDepth");
  }
  // Symmetric with the other three optional-but-required pairings below
  // (coverage needs a mode and a coat count, a ceiling from a perimeter needs
  // its own area): asking for reveals with no depth is „nothing typed yet",
  // and answering that with 0 m² is the silent-zero this pack refuses to give.
  if (input.includeReveals && input.revealDepth === undefined) return fail("revealDepth");

  let openingArea = 0;
  let revealLength = 0;
  for (const [index, opening] of input.openings.entries()) {
    if (
      !isPositive(opening.width) ||
      !isPositive(opening.height) ||
      !isIntegerIn(opening.count, 1, 10000)
    ) {
      return fail(`opening:${index}`);
    }
    openingArea += opening.width * opening.height * opening.count;
    // Two jambs and a head always; the sill on top of that when this opening
    // counts it — which defaults to on for a window and off for a door, the
    // convention each trade actually works to, and can be said explicitly per
    // opening either way.
    const includeSill = opening.includeSill ?? opening.kind === "window";
    const perimeterOfReveal = includeSill
      ? 2 * opening.height + 2 * opening.width
      : 2 * opening.height + opening.width;
    revealLength += perimeterOfReveal * opening.count;
  }

  const grossWall = perimeter * input.height;
  const netWall = input.deductOpenings ? grossWall - openingArea : grossWall;
  // `includeReveals` with no depth is already refused above; this is the room
  // where reveals are simply not counted (`includeReveals: false`) and no
  // depth was ever typed — an undefined area rather than a silent 0.0000 m²
  // that would print as though a measurement had been taken.
  const revealArea =
    input.revealDepth === undefined ? undefined : revealLength * input.revealDepth;
  const ceiling = input.ceilingArea ?? derived?.plan;
  if (input.ceilingArea !== undefined && !isPositive(input.ceilingArea)) return fail("ceilingArea");
  if (input.includeCeiling && ceiling === undefined) return fail("ceilingArea");

  const totalArea =
    (input.includeWalls ? netWall : 0) +
    (input.includeReveals ? (revealArea ?? 0) : 0) +
    (input.includeCeiling ? (ceiling ?? 0) : 0);

  let quantity: number | undefined;
  if (input.coverage !== undefined) {
    if (!isPositive(input.coverage)) return fail("coverage");
    if (input.coverageMode === undefined) return fail("coverageMode");
    const coats = input.coats;
    if (coats === undefined || !isIntegerIn(coats, 1, 20)) return fail("coats");
    quantity =
      input.coverageMode === "area-per-litre"
        ? (totalArea * coats) / input.coverage
        : totalArea * coats * input.coverage;
  }

  return {
    ok: true,
    perimeter,
    grossWall,
    openingArea,
    netWall,
    revealLength,
    revealArea,
    ceiling,
    totalArea,
    quantity,
  };
}

/* ---------------------------------------------------------------------------
 * slope-grade — „Nagib i pad"
 * ------------------------------------------------------------------------ */

/**
 * Which two of the four quantities — run, rise, slant distance, slope — the
 * user actually has. All six pairs of the four are covered: the three that
 * pair the slope notation with one length go through the shared angle
 * conversion, and the three that pair two lengths are plain Pythagoras and
 * never touch a slope unit at all.
 */
export type SlopeKnown =
  | "run-rise"
  | "run-slope"
  | "rise-slope"
  | "slant-slope"
  | "slant-rise"
  | "slant-run";

/** How the slope was written down. `ratio` is n in 1:n, and it is RISE:RUN. */
export type SlopeUnit = "percent" | "permille" | "degrees" | "ratio";

export interface SlopeInput {
  readonly known: SlopeKnown;
  /** Horizontal distance L, in m. */
  readonly run?: number | undefined;
  /** Height difference h, in m. Negative is a fall in the other direction. */
  readonly rise?: number | undefined;
  /** Slope distance s, in m. */
  readonly slant?: number | undefined;
  readonly slope?: number | undefined;
  readonly slopeUnit?: SlopeUnit | undefined;
}

export interface SlopeResult {
  readonly percent: number;
  readonly permille: number;
  readonly degrees: number;
  /** n in 1:n, ALWAYS rise:run and always positive. Undefined when it is flat. */
  readonly ratio: number | undefined;
  /** True when the run falls rather than rises — the sign of 1:n, kept apart from n. */
  readonly descending: boolean;
  readonly rise: number;
  readonly run: number;
  readonly slant: number;
}

/**
 * Every notation of a slope, from any two of run, rise, slope distance and the
 * slope itself.
 *
 * **1:n here is rise:run — one metre up for n metres along.** The same notation
 * is read the other way round in half the trades, so the convention is named
 * rather than guessed: a tool that guessed would be right half the time and
 * silent about which half.
 *
 * A vertical is not representable and is not meant to be: the run is required
 * positive and the angle strictly under 90 degrees, so the percentage that would
 * be infinite cannot be produced at all.
 *
 * **`slant-run` cannot recover a direction from two lengths alone.** Given only
 * the slope distance and the horizontal run, the rise could as easily be a
 * climb as a fall of the same size — the tool reports it as a climb and says so
 * in the field's own doc comment, rather than guessing.
 */
export function slopeGrade(input: SlopeInput): ProResult<SlopeResult> {
  const { known } = input;
  const needsAngle = known === "run-slope" || known === "rise-slope" || known === "slant-slope";

  // The slope arrives in one of four notations and leaves as an angle, because
  // an angle is the only one of the four that composes with the trigonometry.
  // The two lengths-only pairs below never touch this — they are Pythagoras.
  let angle: number | undefined;
  if (needsAngle) {
    const { slope, slopeUnit } = input;
    if (slope === undefined || slopeUnit === undefined) return fail("slope");
    angle = angleFromSlopeNotation(slope, slopeUnit);
    if (angle === undefined) return fail("slope");
  }

  let run: number;
  let rise: number;
  if (known === "run-rise") {
    if (!isPositive(input.run)) return fail("run");
    if (input.rise === undefined || !Number.isFinite(input.rise)) return fail("rise");
    run = input.run;
    rise = input.rise;
  } else if (known === "run-slope") {
    if (angle === undefined) return fail("slope");
    if (!isPositive(input.run)) return fail("run");
    run = input.run;
    rise = run * Math.tan(angle);
  } else if (known === "rise-slope") {
    if (angle === undefined) return fail("slope");
    if (input.rise === undefined || !Number.isFinite(input.rise)) return fail("rise");
    // A zero slope with a non-zero rise has no run at all, and a zero rise on a
    // zero slope has any run at all. Neither is an answer.
    if (Math.tan(angle) === 0) return fail("slope");
    rise = input.rise;
    run = rise / Math.tan(angle);
    if (!isPositive(run)) return fail("run");
  } else if (known === "slant-slope") {
    if (angle === undefined) return fail("slope");
    if (!isPositive(input.slant)) return fail("slant");
    run = input.slant * Math.cos(angle);
    rise = input.slant * Math.sin(angle);
    if (!isPositive(run)) return fail("run");
  } else if (known === "slant-rise") {
    // Two sides of the right triangle fix the third by Pythagoras alone — no
    // slope notation is involved, and none is accepted on this path.
    if (!isPositive(input.slant)) return fail("slant");
    if (input.rise === undefined || !Number.isFinite(input.rise)) return fail("rise");
    if (Math.abs(input.rise) >= input.slant) return fail("rise");
    rise = input.rise;
    run = Math.sqrt(input.slant ** 2 - rise ** 2);
  } else {
    // `slant-run`: the two lengths alone cannot say whether the run climbs or
    // falls, so a rise is returned as an ascent (non-negative) — a descending
    // reading needs `slant-rise` or `run-rise` instead, where the sign is given.
    if (!isPositive(input.slant)) return fail("slant");
    if (!isPositive(input.run)) return fail("run");
    if (input.run >= input.slant) return fail("run");
    run = input.run;
    rise = Math.sqrt(input.slant ** 2 - run ** 2);
  }

  return {
    ok: true,
    percent: (100 * rise) / run,
    permille: (1000 * rise) / run,
    degrees: Math.atan(rise / run) * DEG_PER_RAD,
    ratio: rise === 0 ? undefined : Math.abs(run / rise),
    descending: rise < 0,
    rise,
    run,
    slant: Math.hypot(run, rise),
  };
}

/* ---------------------------------------------------------------------------
 * square-check — „Provera pravouglosti"
 * ------------------------------------------------------------------------ */

export interface SquareInput {
  /** The two sides at the corner, in m. */
  readonly sideA: number;
  readonly sideB: number;
  /** The diagonal as measured, in m. Without it only the target diagonal is answered. */
  readonly measuredDiagonal?: number | undefined;
  /** The other diagonal of the quadrilateral, in m. */
  readonly secondDiagonal?: number | undefined;
}

export interface SquareResult {
  /** The diagonal a right angle would give, in m. */
  readonly expectedDiagonal: number;
  /** Measured minus expected, in MM. */
  readonly diagonalError: number | undefined;
  /** The actual corner angle, in degrees. */
  readonly angle: number | undefined;
  /** angle − 90, in degrees. */
  readonly angleError: number | undefined;
  /**
   * How far the far end of side b sits from where it would land if the corner
   * were exactly square, measured PARALLEL to side a (an earlier draft of this
   * tool called it „perpendicular", which points a person moving the peg in
   * the wrong direction entirely). Positive means the corner is acute and the
   * point is pulled in along a; negative means it is obtuse and the point has
   * been pushed out along a.
   */
  readonly offsetAlongA: number | undefined;
  /** Measured minus second diagonal, in mm — zero for a rectangle. */
  readonly diagonalDifference: number | undefined;
  /**
   * The second diagonal q a PARALLELOGRAM of `sideA`, `sideB` and this
   * measured diagonal p would have: q = sqrt(2(a² + b²) − p²), the
   * parallelogram diagonal law p² + q² = 2(a² + b²) solved for q. **This holds
   * only if the quadrilateral actually is a parallelogram** — two sides and
   * one diagonal do not prove that on their own, so this is a prediction
   * against which a second, independently measured diagonal can be checked,
   * never a fact this tool asserts about the shape on site.
   */
  readonly expectedSecondDiagonal: number | undefined;
  /**
   * The measured second diagonal minus `expectedSecondDiagonal`, in mm —
   * defined only when BOTH diagonals were actually given. Zero means the
   * measured pair is exactly consistent with a parallelogram of these two
   * sides; anything else means the four corners are not the two pairs of
   * parallel sides a parallelogram would require, and by how much.
   */
  readonly parallelogramSkew: number | undefined;
}

/**
 * How far out of square a corner is, from its two sides and the measured
 * diagonal.
 *
 * The 3-4-5 rule is not a separate method — it is the integer case of Pythagoras
 * and this function reduces to it exactly, which is why the 3-4-5 vector must
 * come back as exactly 90 degrees and exactly zero offset rather than as
 * 89.99999.
 *
 * `offsetAlongA` is `b·cos(alpha)` and that is EXACT, not a small-angle
 * approximation: the component of side b ALONG side a — not across it — is
 * what has to be zero for the corner to be right, and it is zero precisely
 * when the angle is. Calling it „perpendicular" or „poprečno" sends the wrong
 * direction to move the peg, which is why the field is named `offsetAlongA`.
 */
export function squareCheck(input: SquareInput): ProResult<SquareResult> {
  const { sideA, sideB } = input;
  if (!isPositive(sideA)) return fail("sideA");
  if (!isPositive(sideB)) return fail("sideB");
  const expectedDiagonal = Math.hypot(sideA, sideB);

  const measured = input.measuredDiagonal;
  if (measured === undefined) {
    if (input.secondDiagonal !== undefined && !isPositive(input.secondDiagonal)) {
      return fail("secondDiagonal");
    }
    return {
      ok: true,
      expectedDiagonal,
      diagonalError: undefined,
      angle: undefined,
      angleError: undefined,
      offsetAlongA: undefined,
      diagonalDifference: undefined,
      expectedSecondDiagonal: undefined,
      parallelogramSkew: undefined,
    };
  }
  // Outside the triangle inequality there is no triangle: the cosine would leave
  // [−1, 1] and acos would answer NaN, which looks like a rounding bug rather
  // than like the three lengths not meeting.
  if (!isPositive(measured) || measured <= Math.abs(sideA - sideB) || measured >= sideA + sideB) {
    return fail("measuredDiagonal");
  }
  if (input.secondDiagonal !== undefined && !isPositive(input.secondDiagonal)) {
    return fail("secondDiagonal");
  }

  const cosine = (sideA ** 2 + sideB ** 2 - measured ** 2) / (2 * sideA * sideB);
  const angle = Math.acos(cosine) * DEG_PER_RAD;
  // q = sqrt(2(a² + b²) − p²) — see `expectedSecondDiagonal`'s own doc for the
  // parallelogram-only caveat. The radicand is never negative here: as a
  // function of p² it is linear, and over the triangle-inequality range
  // already enforced on `measured` above it stays between (a−b)² and (a+b)²,
  // both non-negative, so it never needs a guard of its own.
  const expectedSecondDiagonal = Math.sqrt(2 * (sideA ** 2 + sideB ** 2) - measured ** 2);
  return {
    ok: true,
    expectedDiagonal,
    diagonalError: (measured - expectedDiagonal) * 1000,
    angle,
    angleError: angle - 90,
    offsetAlongA: sideB * cosine * 1000,
    diagonalDifference:
      input.secondDiagonal === undefined ? undefined : (measured - input.secondDiagonal) * 1000,
    expectedSecondDiagonal,
    parallelogramSkew:
      input.secondDiagonal === undefined
        ? undefined
        : (input.secondDiagonal - expectedSecondDiagonal) * 1000,
  };
}

/* ---------------------------------------------------------------------------
 * survey-bearing-distance — „Geodetski zadatak"
 * ------------------------------------------------------------------------ */

/** Y is east, X is north — the national convention, and it is not interchangeable. */
export interface SurveyPoint {
  readonly y: number;
  readonly x: number;
}

export type SurveyAngleUnit = "gon" | "deg" | "dms";

export interface SurveyInverseInput {
  readonly from: SurveyPoint;
  readonly to: SurveyPoint;
}

export interface SurveyInverseResult {
  readonly deltaY: number;
  readonly deltaX: number;
  readonly distance: number;
  /** Bearing from north, clockwise, folded into [0, 400) gon. Undefined for a zero length. */
  readonly bearingGon: number | undefined;
  readonly bearingDeg: number | undefined;
  readonly oppositeGon: number | undefined;
  readonly oppositeDeg: number | undefined;
}

export interface SurveyForwardInput {
  readonly from: SurveyPoint;
  /** The bearing in `bearingUnit`. Ignored — and may be omitted — when the unit is `dms`. */
  readonly bearing?: number | undefined;
  readonly bearingUnit: SurveyAngleUnit;
  /** The bearing as degrees-minutes-seconds — an older plan's angle. Used only when `bearingUnit` is `dms`. */
  readonly bearingDms?: AngleDms | undefined;
  readonly distance: number;
}

export interface SurveyForwardResult {
  readonly point: SurveyPoint;
  readonly bearingGon: number;
  readonly bearingDeg: number;
  readonly oppositeGon: number;
  readonly oppositeDeg: number;
}

/**
 * The second geodetic problem: distance and bearing between two known points.
 *
 * **`atan2(dY, dX)` — in that order.** With the arguments the other way round
 * the angle is measured from east instead of from north, every bearing in the
 * traverse is silently reflected about 50 gon, and every one of them still looks
 * like a perfectly ordinary bearing. There is no output that reveals the swap,
 * which is why the order is written down here.
 *
 * Two coincident points have a distance of zero and NO bearing: the direction
 * from a point to itself is undefined, and zero would be a direction.
 */
export function surveyInverse(input: SurveyInverseInput): ProResult<SurveyInverseResult> {
  const { from, to } = input;
  if (!Number.isFinite(from.y) || !Number.isFinite(from.x)) return fail("pointA");
  if (!Number.isFinite(to.y) || !Number.isFinite(to.x)) return fail("pointB");
  const deltaY = to.y - from.y;
  const deltaX = to.x - from.x;
  const distance = Math.hypot(deltaY, deltaX);
  if (deltaY === 0 && deltaX === 0) {
    return {
      ok: true,
      deltaY,
      deltaX,
      distance: 0,
      bearingGon: undefined,
      bearingDeg: undefined,
      oppositeGon: undefined,
      oppositeDeg: undefined,
    };
  }
  const bearing = foldRadians(Math.atan2(deltaY, deltaX));
  const opposite = foldRadians(bearing + Math.PI);
  return {
    ok: true,
    deltaY,
    deltaX,
    distance,
    bearingGon: bearing * GON_PER_RAD,
    bearingDeg: bearing * DEG_PER_RAD,
    oppositeGon: opposite * GON_PER_RAD,
    oppositeDeg: opposite * DEG_PER_RAD,
  };
}

/**
 * The first geodetic problem: a new point from a known one, a bearing and a
 * distance.
 *
 * Y takes the sine and X takes the cosine, because the bearing is measured from
 * north: at 0 gon the whole step goes into X. A bearing outside the circle is
 * folded BEFORE it is used in the sine and cosine, not only reported folded
 * afterwards — a traverse that has been summing turning angles arrives at
 * 470 gon quite legitimately, and the fold has to happen before the trig or
 * the two are computed from different angles.
 *
 * `bearingUnit: "dms"` reads an older plan's angle written as degrees, minutes
 * and seconds, going through the same `dmsToDegrees` the angle-conversion tool
 * uses rather than a second parser.
 */
export function surveyForward(input: SurveyForwardInput): ProResult<SurveyForwardResult> {
  const { from, bearingUnit, distance } = input;
  if (!Number.isFinite(from.y) || !Number.isFinite(from.x)) return fail("pointA");
  if (!isNonNegative(distance)) return fail("distance");

  let bearingRadians: number;
  if (bearingUnit === "dms") {
    if (input.bearingDms === undefined) return fail("bearing");
    const decimal = dmsToDegrees(input.bearingDms);
    if (!decimal.ok) return decimal;
    bearingRadians = decimal.degrees * RAD_PER_DEG;
  } else {
    if (input.bearing === undefined || !Number.isFinite(input.bearing)) return fail("bearing");
    bearingRadians = input.bearing * (bearingUnit === "gon" ? RAD_PER_GON : RAD_PER_DEG);
  }

  const folded = foldRadians(bearingRadians);
  const opposite = foldRadians(folded + Math.PI);
  return {
    ok: true,
    point: {
      y: from.y + distance * Math.sin(folded),
      x: from.x + distance * Math.cos(folded),
    },
    bearingGon: folded * GON_PER_RAD,
    bearingDeg: folded * DEG_PER_RAD,
    oppositeGon: opposite * GON_PER_RAD,
    oppositeDeg: opposite * DEG_PER_RAD,
  };
}

/* ---------------------------------------------------------------------------
 * tile-count — „Broj pločica"
 * ------------------------------------------------------------------------ */

/** 1 m^2 = 10^6 mm^2, by the definition of the prefix. */
const MM2_PER_M2 = 1000000;

/** Which box figure the count was taken from, when the user gave both. */
export type TileBoxBasis = "pieces" | "area";

export interface TileInput {
  /** Area to cover, in m^2. */
  readonly area: number;
  /** Tile format, in mm. */
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Joint width, in mm. Zero is a butt joint. */
  readonly joint: number;
  /** Waste, in % — a format, bond and room-geometry figure the user knows. */
  readonly waste: number;
  /** Pieces per box. Wins over `areaPerBox` when both are given. */
  readonly perBox?: number | undefined;
  /** Area per box, in m^2. */
  readonly areaPerBox?: number | undefined;
}

export interface TileResult {
  readonly perSquareMetre: number;
  readonly areaWithWaste: number;
  readonly pieces: number;
  readonly boxes: number | undefined;
  readonly boxBasis: TileBoxBasis | undefined;
  /** Pieces left over in the last box. Only when the count came from pieces per box. */
  readonly surplusPieces: number | undefined;
  /** Those pieces as NOMINAL area a*b, in m^2 — they go back as goods, not as coverage. */
  readonly surplusArea: number | undefined;
}

/**
 * Pieces, boxes and the leftovers, from an area and a format.
 *
 * **One joint per axis, not two.** A joint is shared between two neighbours, so
 * a tile occupies (a + s) by (b + s); counting a joint on each of the four sides
 * would double the allowance and over-order every job.
 *
 * **The (a + s)(b + s) module assumes a straight grid.** An offset (running
 * bond) or a herringbone lay leaves the same net area to cover — this count
 * does not change — but produces more cut waste than a straight grid does,
 * because a straight grid is the one layout where every cut piece can be the
 * offcut of its neighbour. `waste` is where that difference belongs.
 *
 * **Rounding happens once, at the very end.** Rounding the pieces per square
 * metre and multiplying afterwards gives a smaller number every time — that is
 * the classic error copied out of printed tables, and on 24 m^2 of 300x600 it is
 * short by several tiles.
 *
 * The surplus is valued at the nominal tile area a*b, NOT at the effective area
 * including its joints: a tile in a box is goods you return, and nobody buys
 * back the grout you did not use.
 */
export function tileCount(input: TileInput): ProResult<TileResult> {
  const { area, tileWidth, tileHeight, joint } = input;
  if (!isPositive(area)) return fail("area");
  if (!isPositive(tileWidth)) return fail("tileWidth");
  if (!isPositive(tileHeight)) return fail("tileHeight");
  if (!isNonNegative(joint)) return fail("joint");
  if (!isInRange(input.waste, 0, 100)) return fail("waste");
  if (input.perBox !== undefined && !isIntegerIn(input.perBox, 1, 100000)) return fail("perBox");
  if (input.areaPerBox !== undefined && !isPositive(input.areaPerBox)) return fail("areaPerBox");

  const effective = (tileWidth + joint) * (tileHeight + joint);
  const areaWithWaste = area * (1 + input.waste / 100);
  const pieces = ceilSnapped((areaWithWaste * MM2_PER_M2) / effective);
  const nominal = (tileWidth * tileHeight) / MM2_PER_M2;

  if (input.perBox !== undefined) {
    const boxes = ceilSnapped(pieces / input.perBox);
    const surplusPieces = boxes * input.perBox - pieces;
    return {
      ok: true,
      perSquareMetre: MM2_PER_M2 / effective,
      areaWithWaste,
      pieces,
      boxes,
      boxBasis: "pieces",
      surplusPieces,
      surplusArea: surplusPieces * nominal,
    };
  }
  return {
    ok: true,
    perSquareMetre: MM2_PER_M2 / effective,
    areaWithWaste,
    pieces,
    boxes: input.areaPerBox === undefined ? undefined : ceilSnapped(areaWithWaste / input.areaPerBox),
    boxBasis: input.areaPerBox === undefined ? undefined : "area",
    // Boxes bought by area say nothing about how many pieces are in the last
    // one, so the leftover is not answered rather than estimated.
    surplusPieces: undefined,
    surplusArea: undefined,
  };
}

/* ---------------------------------------------------------------------------
 * trench-volume — „Iskop rova"
 * ------------------------------------------------------------------------ */

export interface TrenchInput {
  /** Trench length, in m. */
  readonly length: number;
  /**
   * Width at the bottom, in m. Give this directly, or give `pipeDiameter` and
   * `workingSpace` instead and let the bottom width be derived — typing the
   * pipe's own diameter twice, once here and once as `pipeDiameter`, is exactly
   * the copy that drifts when one of the two is edited and the other is not.
   */
  readonly bottomWidth?: number | undefined;
  readonly depth: number;
  /**
   * Batter m: horizontal metres per 1 metre of depth, on each side. Zero is a
   * vertical face. It is a regulated and design quantity about the ground and
   * the shoring, so the tool holds no value and proposes none.
   */
  readonly batter: number;
  /** Outside diameter of the pipe, in m. */
  readonly pipeDiameter?: number | undefined;
  /**
   * Working space beside the pipe, in m, on EACH side — used only to derive
   * `bottomWidth` as `pipeDiameter + 2*workingSpace` when `bottomWidth` itself
   * is not given directly. A design allowance, not a fact this tool knows.
   */
  readonly workingSpace?: number | undefined;
  /** Bedding thickness, in m. */
  readonly beddingThickness?: number | undefined;
  /** Bulking, in % — a ground property the user knows from site. */
  readonly bulking: number;
  /**
   * Whether the excavated soil is put back as backfill around the pipe. When
   * false, none of it is — everything dug comes out and the backfill is
   * entirely imported material, so the whole excavation (not just the bedding
   * and the pipe) is the volume to cart away. There is no default: which one
   * is true is a fact about the ground, not an assumption this tool can make.
   */
  readonly returnsSpoil: boolean;
}

export interface TrenchResult {
  readonly crossSection: number;
  readonly topWidth: number;
  readonly excavation: number;
  readonly bedding: number;
  readonly pipe: number;
  readonly backfill: number;
  /** Spoil to cart away, IN SITU, in m^3. */
  readonly surplus: number;
  /** The same spoil loose, in m^3. */
  readonly surplusLoose: number;
}

/**
 * Excavation, backfill and spoil for a trapezoidal trench.
 *
 * **Bulking is applied ONLY to the spoil that leaves the site.** The excavation
 * is a volume of ground in place and the surplus is the same soil in a truck;
 * they are two states of one mass, and adding a bulked excavation to an in-situ
 * backfill — the usual mistake here — counts the same cubic metre twice in two
 * different sizes.
 *
 * The surplus equals bedding plus pipe exactly WHEN the dug soil goes back as
 * backfill (`returnsSpoil: true`); when it does not, the entire excavation is
 * the surplus, because none of what came out goes back and the backfill is
 * imported. Treating the two as the same formula is the mistake this switch
 * exists to stop — it is out by the whole excavation volume, not by a detail.
 */
export function trenchVolume(input: TrenchInput): ProResult<TrenchResult> {
  const { length, depth, batter } = input;
  if (!isPositive(length)) return fail("length");
  if (!isPositive(depth)) return fail("depth");
  if (!isNonNegative(batter)) return fail("batter");
  if (!isInRange(input.bulking, 0, 100)) return fail("bulking");
  const diameter = input.pipeDiameter;
  if (diameter !== undefined && !isPositive(diameter)) return fail("pipeDiameter");

  let bottomWidth: number;
  if (input.bottomWidth !== undefined) {
    if (!isPositive(input.bottomWidth)) return fail("bottomWidth");
    bottomWidth = input.bottomWidth;
  } else {
    if (diameter === undefined || !isPositive(input.workingSpace)) return fail("bottomWidth");
    bottomWidth = diameter + 2 * input.workingSpace;
  }
  // A pipe wider than the bottom does not go into the trench that was described,
  // so both numbers go back rather than a volume computed from an impossibility.
  if (diameter !== undefined && diameter > bottomWidth) return fail("pipeDiameter");
  const bedding = input.beddingThickness;
  if (bedding !== undefined && (!isNonNegative(bedding) || bedding >= depth)) {
    return fail("beddingThickness");
  }
  // The bedding sits under the pipe, so it is the TWO of them stacked that has
  // to fit inside the depth, not the bedding alone. Past this point the pipe
  // would have to rise above the trench, and `excavation - bedding - pipe`
  // goes negative — a backfill volume that is impossible, not merely small.
  if ((bedding ?? 0) + (diameter ?? 0) > depth) return fail("beddingThickness");

  const crossSection = depth * (bottomWidth + batter * depth);
  const excavation = crossSection * length;
  const beddingVolume = bedding === undefined ? 0 : bottomWidth * bedding * length;
  const pipeVolume = diameter === undefined ? 0 : (Math.PI / 4) * diameter ** 2 * length;
  const surplus = input.returnsSpoil ? beddingVolume + pipeVolume : excavation;
  return {
    ok: true,
    crossSection,
    topWidth: bottomWidth + 2 * batter * depth,
    excavation,
    bedding: beddingVolume,
    pipe: pipeVolume,
    backfill: input.returnsSpoil ? excavation - beddingVolume - pipeVolume : 0,
    surplus,
    surplusLoose: surplus * (1 + input.bulking / 100),
  };
}

/* ---------------------------------------------------------------------------
 * wall-u-value — „U-vrednost sklopa"
 * ------------------------------------------------------------------------ */

export interface WallLayer {
  /** Thickness, in m. Ignored when `resistance` is given. */
  readonly thickness?: number | undefined;
  /** Thermal conductivity, in W/(m*K) — from the product declaration. */
  readonly conductivity?: number | undefined;
  /**
   * A ready-made resistance, in m^2K/W. An unventilated air layer is entered
   * this way because it has no conductivity to divide a thickness by — its
   * resistance is a cavity property, not a material one.
   */
  readonly resistance?: number | undefined;
}

export interface WallInput {
  /** Inside to outside, in that order. */
  readonly layers: readonly WallLayer[];
  /** Internal surface resistance, in m^2K/W — from the standard the user applies. */
  readonly rsi: number;
  readonly rse: number;
  /** Internal and external air temperature, in degrees C. */
  readonly insideTemperature?: number | undefined;
  readonly outsideTemperature?: number | undefined;
}

export interface WallLayerResult {
  readonly resistance: number;
  /** This layer's share of the total resistance, in %. */
  readonly share: number;
  /** Temperature at this layer's OUTER face, in degrees C. */
  readonly boundaryTemperature: number | undefined;
}

export interface WallResult {
  readonly layers: readonly WallLayerResult[];
  readonly totalResistance: number;
  readonly uValue: number | undefined;
  readonly innerSurfaceTemperature: number | undefined;
  readonly outerSurfaceTemperature: number | undefined;
}

/**
 * Total resistance, U-value and the temperature at every interface of a layered
 * assembly.
 *
 * **Temperature falls in proportion to RESISTANCE, not to thickness.** That is
 * the entire reason a 10 cm layer of insulation carries most of the drop while
 * 25 cm of block carries little of it, and reading the profile off the section
 * drawing instead is how a designer misplaces the dew point.
 *
 * One-dimensional steady conduction through homogeneous layers only. Thermal
 * bridges, inhomogeneous layers and moisture are outside this arithmetic
 * entirely — not approximated by it, which is a different and worse claim.
 * So are two further cases a designer can meet in the same wall: the
 * point-transmittance correction for mechanical fasteners through an
 * insulation layer (a delta-U this sum does not contain), and a
 * well-ventilated air layer, which is not a resistance to add at all —
 * standard practice discards everything outboard of it and starts the sum
 * fresh from there, a different PROCEDURE rather than a different number in
 * this one.
 */
export function wallAssembly(input: WallInput): ProResult<WallResult> {
  if (!isIntegerIn(input.layers.length, 1, 20)) return fail("layers");
  if (!isInRange(input.rsi, 0, 1)) return fail("rsi");
  if (!isInRange(input.rse, 0, 1)) return fail("rse");

  const resistances: number[] = [];
  for (const [index, layer] of input.layers.entries()) {
    if (layer.resistance !== undefined) {
      if (!isPositive(layer.resistance)) return fail(`resistance:${index}`);
      resistances.push(layer.resistance);
      continue;
    }
    if (!isPositive(layer.thickness)) return fail(`thickness:${index}`);
    if (!isPositive(layer.conductivity)) return fail(`conductivity:${index}`);
    resistances.push(layer.thickness / layer.conductivity);
  }

  const totalResistance =
    input.rsi + resistances.reduce((sum, value) => sum + value, 0) + input.rse;
  const inside = input.insideTemperature;
  const outside = input.outsideTemperature;
  const drop =
    inside === undefined ||
    outside === undefined ||
    !Number.isFinite(inside) ||
    !Number.isFinite(outside) ||
    totalResistance <= 0
      ? undefined
      : inside - outside;

  let cumulative = input.rsi;
  const layers: WallLayerResult[] = resistances.map((resistance) => {
    cumulative += resistance;
    return {
      resistance,
      share: totalResistance > 0 ? (resistance / totalResistance) * 100 : 0,
      boundaryTemperature:
        drop === undefined || inside === undefined
          ? undefined
          : inside - (cumulative / totalResistance) * drop,
    };
  });

  return {
    ok: true,
    layers,
    totalResistance,
    uValue: totalResistance > 0 ? 1 / totalResistance : undefined,
    innerSurfaceTemperature:
      drop === undefined || inside === undefined
        ? undefined
        : inside - (input.rsi / totalResistance) * drop,
    outerSurfaceTemperature:
      drop === undefined || outside === undefined
        ? undefined
        : outside + (input.rse / totalResistance) * drop,
  };
}
