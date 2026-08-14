/**
 * „Event i produkcija" — the arithmetic behind the event/production toolkit.
 *
 * Same discipline as `pro/gradnja.ts`: pure functions, refuse rather than
 * repair, no locale, no user-facing text. Where a tool's `riskClass` is
 * `life-safety` or `food-safety` (`generatorSizing`, `ledWallLayout`,
 * `slingForce`, `stageDeckLayout`, `threePhaseLoadBalance`,
 * `trussHoistReactions`, `voltageDrop`, `venueOccupancyArea`, `iceChilling`)
 * the function returns a QUANTITY and, where the user typed a limit, the
 * plain ratio against it — never a verdict, a colour or a word that judges.
 */

import {
  ceilSnapped,
  fail,
  floorSnapped,
  isInRange,
  isIntegerIn,
  isNonNegative,
  isPositive,
  ratioAgainst,
  roundHalfUp,
  type ProResult,
} from "./result.js";

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;
const SQRT3 = 1.7320508075688772;

/**
 * Round UP to a currency unit (a cent), never to the nearest — see
 * `eventBudget`. Not `ceilSnapped`: that snaps to a whole number, and a cent
 * is two decimals, so the value is scaled by 100 first and the result scaled
 * back — `ceilSnapped` still does the representation-noise removal for us.
 */
function ceilToCent(value: number): number {
  return ceilSnapped(value * 100) / 100;
}

/* ---------------------------------------------------------------------------
 * beam-spot-diameter — „Snop reflektora"
 * ------------------------------------------------------------------------ */

export interface BeamSpotInput {
  /** Beam angle at 50 % intensity, in degrees. */
  readonly beamAngleDeg: number;
  /** Field angle at 10 % intensity, in degrees. Wider than the beam angle. */
  readonly fieldAngleDeg?: number | undefined;
  /** Perpendicular throw distance, in m — the NORMAL-incidence path. */
  readonly distanceM?: number | undefined;
  /** Fixture height above the target plane, in m — the OBLIQUE path. */
  readonly heightM?: number | undefined;
  /** Horizontal offset of the aim point from directly below the fixture, in m. Requires `heightM`. */
  readonly horizontalOffsetM?: number | undefined;
  readonly intensityCd?: number | undefined;
  readonly overlapPct?: number | undefined;
  readonly coverageLengthM?: number | undefined;
}

export interface BeamSpotResult {
  /** Circular spot diameter, m — normal incidence only. */
  readonly beamDiameterM: number | undefined;
  readonly fieldDiameterM: number | undefined;
  /** Distance to the aim point, m — `distanceM` itself, or the oblique slant distance. */
  readonly slantDistanceM: number;
  /** Ellipse minor axis, m — exact closed form, not the small-angle approximation. */
  readonly minorAxisM: number | undefined;
  readonly majorAxisM: number | undefined;
  readonly tiltDeg: number | undefined;
  /** Near edge of the oblique spot, measured from directly below the fixture, m. */
  readonly nearEdgeM: number | undefined;
  readonly farEdgeM: number | undefined;
  /** Illuminance AT THE AIM POINT — not at the ellipse's geometric centre. */
  readonly illuminanceAtAimPointLx: number | undefined;
  /** The diameter actually used for spacing: `beamDiameterM` normal, `majorAxisM` oblique. */
  readonly effectiveDiameterM: number | undefined;
  /** Exact, unrounded spacing — see the comment on `coveredLengthM`. */
  readonly spacingM: number | undefined;
  readonly fixtureCount: number | undefined;
  /**
   * `(n-1) * spacing + effectiveDiameter`, from the UNROUNDED spacing and
   * diameter. Computing it from numbers already rounded to 3 decimals is the
   * defect the review caught: it moves the last millimetres of the answer.
   */
  readonly coveredLengthM: number | undefined;
}

/**
 * Spot/field diameter, illuminance and fixture spacing for a beam angle.
 *
 * **Normal incidence (`distanceM`) and oblique incidence (`heightM` +
 * `horizontalOffsetM`) are mutually exclusive** — giving both leaves the tool
 * unable to say which distance the illuminance used, so it refuses. Under
 * oblique incidence the spot is an ellipse with an EXACT minor axis; the old
 * small-angle approximation was off by 11 % at 60° tilt and 32 % at 70°,
 * which is precisely the steep-incidence case the ellipse exists to cover.
 *
 * **`spacingM`/`fixtureCount`/`coveredLengthM` hold only ALONG the array
 * axis.** Two adjacent circular (or elliptical) spots meet in a lens-shaped
 * intersection, not a rectangle, so the coverage OFF that axis is narrower
 * than `coveredLengthM` suggests — a reader who takes `fixtureCount` as a
 * uniform grid count in both directions will be short on the cross axis.
 */
export function beamSpot(input: BeamSpotInput): ProResult<BeamSpotResult> {
  if (!isInRange(input.beamAngleDeg, 1, 120)) return fail("beamAngleDeg");
  if (input.fieldAngleDeg !== undefined && !isInRange(input.fieldAngleDeg, 1, 160)) {
    return fail("fieldAngleDeg");
  }
  const hasD = input.distanceM !== undefined;
  const hasH = input.heightM !== undefined;
  if (hasD && hasH) return fail("ambiguousDistance");
  if (!hasD && !hasH) return fail("distanceM");
  if (input.horizontalOffsetM !== undefined && !hasH) return fail("horizontalOffsetM");
  // A field-angle ellipse under oblique incidence needs its own exact-form
  // major/minor axes, which this tool does not compute — refusing rather than
  // silently dropping the figure is what keeps "no field diameter printed"
  // distinguishable from "field diameter forgotten".
  if (input.fieldAngleDeg !== undefined && hasH) return fail("fieldAngleDeg");
  if (input.intensityCd !== undefined && !isInRange(input.intensityCd, 100, 1e7)) {
    return fail("intensityCd");
  }
  const hasOverlap = input.overlapPct !== undefined;
  const hasCoverage = input.coverageLengthM !== undefined;
  if (hasOverlap !== hasCoverage) return fail(hasOverlap ? "coverageLengthM" : "overlapPct");
  if (hasOverlap && !isInRange(input.overlapPct as number, 0, 90)) return fail("overlapPct");
  if (hasCoverage && !isInRange(input.coverageLengthM as number, 0.5, 200)) {
    return fail("coverageLengthM");
  }

  const theta = input.beamAngleDeg * RAD_PER_DEG;
  let beamDiameterM: number | undefined;
  let fieldDiameterM: number | undefined;
  let slantDistanceM: number;
  let minorAxisM: number | undefined;
  let majorAxisM: number | undefined;
  let tiltDeg: number | undefined;
  let nearEdgeM: number | undefined;
  let farEdgeM: number | undefined;
  let illuminanceAtAimPointLx: number | undefined;
  let effectiveDiameterM: number;

  if (hasD) {
    const D = input.distanceM as number;
    if (!isInRange(D, 0.5, 200)) return fail("distanceM");
    slantDistanceM = D;
    beamDiameterM = 2 * D * Math.tan(theta / 2);
    fieldDiameterM =
      input.fieldAngleDeg === undefined
        ? undefined
        : 2 * D * Math.tan((input.fieldAngleDeg * RAD_PER_DEG) / 2);
    illuminanceAtAimPointLx = input.intensityCd === undefined ? undefined : input.intensityCd / D ** 2;
    effectiveDiameterM = beamDiameterM;
  } else {
    const h = input.heightM as number;
    if (!isInRange(h, 0.5, 60)) return fail("heightM");
    const x = input.horizontalOffsetM ?? 0;
    if (!isInRange(x, 0, 100)) return fail("horizontalOffsetM");
    const gamma = Math.atan2(x, h);
    if (gamma + theta / 2 >= Math.PI / 2) return fail("grazing");
    const Ds = Math.hypot(h, x);
    slantDistanceM = Ds;
    tiltDeg = gamma * DEG_PER_RAD;
    const near = gamma - theta / 2;
    const far = gamma + theta / 2;
    minorAxisM = (2 * h * Math.sin(theta / 2)) / Math.sqrt(Math.cos(near) * Math.cos(far));
    majorAxisM = h * (Math.tan(far) - Math.tan(near));
    nearEdgeM = h * Math.tan(near);
    farEdgeM = h * Math.tan(far);
    illuminanceAtAimPointLx =
      input.intensityCd === undefined ? undefined : (input.intensityCd * Math.cos(gamma)) / Ds ** 2;
    effectiveDiameterM = majorAxisM;
  }

  let spacingM: number | undefined;
  let fixtureCount: number | undefined;
  let coveredLengthM: number | undefined;
  if (hasOverlap && hasCoverage) {
    const overlap = input.overlapPct as number;
    const L = input.coverageLengthM as number;
    spacingM = effectiveDiameterM * (1 - overlap / 100);
    const raw = (L - effectiveDiameterM) / spacingM;
    fixtureCount = Math.max(1, ceilSnapped(raw) + 1);
    coveredLengthM = (fixtureCount - 1) * spacingM + effectiveDiameterM;
  }

  return {
    ok: true,
    beamDiameterM,
    fieldDiameterM,
    slantDistanceM,
    minorAxisM,
    majorAxisM,
    tiltDeg,
    nearEdgeM,
    farEdgeM,
    illuminanceAtAimPointLx,
    // hasD||hasH is always true here — line 108 already refuses when neither is given.
    effectiveDiameterM,
    spacingM,
    fixtureCount,
    coveredLengthM,
  };
}

/* ---------------------------------------------------------------------------
 * budget-per-guest — „Budžet po gostu"
 * ------------------------------------------------------------------------ */

export type CostLineType = "fixed" | "perGuest" | "perTable" | "percent";

export interface CostLine {
  readonly type: CostLineType;
  /** The line amount for fixed/perGuest/perTable lines; a PERCENTAGE (0–100) for `percent` lines. */
  readonly amount: number;
  /**
   * `percent` lines only: indices into THIS SAME array whose amounts this
   * line is a percentage of. Undefined means every non-percent line — a
   * percent line may never point at another percent line, which is the rule
   * that keeps the arithmetic non-circular.
   */
  readonly percentOfLines?: readonly number[] | undefined;
  /** Whether this line counts toward the tax base when `taxBaseMode` is `"marked"`. */
  readonly taxable?: boolean | undefined;
}

export interface RevenueLine {
  readonly amount: number;
}

export type TaxBaseMode = "total" | "marked";

export interface EventBudgetInput {
  readonly guests: number;
  /** 0 when there is no table-based costing at all. */
  readonly tables: number;
  readonly lines: readonly CostLine[];
  readonly reservePct: number;
  /** The user's own tax rate — this package holds no rate and applies none by default. */
  readonly taxRatePct: number;
  readonly taxBaseMode: TaxBaseMode;
  readonly revenueLines?: readonly RevenueLine[] | undefined;
  readonly payingGuests?: number | undefined;
  readonly ticketPrice?: number | undefined;
}

export interface CostLineResult {
  readonly amount: number;
  /** `undefined` when the grand total is 0 — a share of nothing is not defined. */
  readonly sharePct: number | undefined;
  /** `percent` lines only: the amount the percentage was taken of. */
  readonly percentBaseAmount: number | undefined;
}

export interface EventBudgetResult {
  readonly lines: readonly CostLineResult[];
  /** Sum of fixed + per-guest + per-table lines — the base a `percent` line may reference. */
  readonly base: number;
  readonly percentSum: number;
  readonly subtotal: number;
  readonly reserve: number;
  readonly preTaxTotal: number;
  /** The amount the tax rate was actually applied to — printed beside the rate itself. */
  readonly taxBaseAmount: number;
  readonly tax: number;
  readonly grandTotal: number;
  readonly costPerGuestWithTax: number;
  readonly costPerGuestWithoutTax: number;
  readonly costPerTableWithTax: number | undefined;
  readonly costPerTableWithoutTax: number | undefined;
  /** Sum of `revenueLines` plus ticket revenue when both `ticketPrice` and `payingGuests` are given. */
  readonly revenueTotal: number | undefined;
  readonly revenueDifference: number | undefined;
  /** Ticket price at which `revenueDifference` is exactly zero, rounded UP to a cent — see the note below. */
  readonly breakEvenTicketPriceCeil: number | undefined;
  readonly ticketRevenue: number | undefined;
}

/**
 * Line-by-line cost roll-up, reserve, tax and the break-even ticket price.
 *
 * **A `percent` line's base is fixed BEFORE any percentage is applied — the
 * base is never the running subtotal.** Chaining two 10 % lines onto each
 * other over a 100 000 base gives 121 000 that way; done correctly (both
 * against the same 100 000 base) it is 120 000, and the second test below is
 * exactly that check.
 *
 * **The break-even ticket price rounds UP to the cent, never to the
 * nearest.** Nearest-rounding a ticket price down by half a cent times
 * thousands of tickets is real money short of covering the budget — the
 * printed price has to clear the total, not merely approximate it.
 */
export function eventBudget(input: EventBudgetInput): ProResult<EventBudgetResult> {
  const { guests, tables, lines } = input;
  if (!isIntegerIn(guests, 1, 100000)) return fail("guests");
  if (!isIntegerIn(tables, 0, 10000)) return fail("tables");
  if (lines.length === 0) return fail("lines");
  if (!isInRange(input.reservePct, 0, 50)) return fail("reservePct");
  if (!isInRange(input.taxRatePct, 0, 100)) return fail("taxRatePct");

  for (const [i, line] of lines.entries()) {
    if (!Number.isFinite(line.amount) || line.amount < 0) return fail(`amount:${i}`);
    if (line.type === "perTable" && tables === 0) return fail("tables");
    if (line.type === "percent") {
      if (line.amount > 100) return fail(`amount:${i}`);
      if (line.percentOfLines !== undefined) {
        for (const ref of line.percentOfLines) {
          const target = lines[ref];
          if (target === undefined || target.type === "percent") return fail(`percentOfLines:${i}`);
        }
      }
    }
  }

  const base = lines.reduce((sum, line) => {
    if (line.type === "fixed") return sum + line.amount;
    if (line.type === "perGuest") return sum + line.amount * guests;
    if (line.type === "perTable") return sum + line.amount * tables;
    return sum;
  }, 0);

  const lineAmounts: number[] = lines.map((line) => {
    if (line.type === "fixed") return line.amount;
    if (line.type === "perGuest") return line.amount * guests;
    if (line.type === "perTable") return line.amount * tables;
    const refs = line.percentOfLines ?? lines.map((_, j) => j).filter((j) => lines[j]?.type !== "percent");
    const percentBase = refs.reduce((sum, ref) => {
      const target = lines[ref];
      if (target === undefined) return sum;
      if (target.type === "fixed") return sum + target.amount;
      if (target.type === "perGuest") return sum + target.amount * guests;
      return sum + target.amount * tables;
    }, 0);
    return (line.amount / 100) * percentBase;
  });

  const percentBaseAmounts: (number | undefined)[] = lines.map((line) => {
    if (line.type !== "percent") return undefined;
    const refs = line.percentOfLines ?? lines.map((_, j) => j).filter((j) => lines[j]?.type !== "percent");
    return refs.reduce((sum, ref) => {
      const target = lines[ref];
      if (target === undefined) return sum;
      if (target.type === "fixed") return sum + target.amount;
      if (target.type === "perGuest") return sum + target.amount * guests;
      return sum + target.amount * tables;
    }, 0);
  });

  const percentSum = lines.reduce((sum, line, i) => (line.type === "percent" ? sum + (lineAmounts[i] ?? 0) : sum), 0);
  const subtotal = base + percentSum;
  const reserve = subtotal * (input.reservePct / 100);
  const preTaxTotal = subtotal + reserve;

  // "marked" mode taxes only the lines the user flagged `taxable` — the
  // reserve is deliberately NOT part of that base, since it is a markup on
  // the whole budget rather than a line item anyone could mark.
  const taxBaseAmount =
    input.taxBaseMode === "total"
      ? preTaxTotal
      : lines.reduce((sum, line, i) => (line.taxable === true ? sum + (lineAmounts[i] ?? 0) : sum), 0);
  const tax = taxBaseAmount * (input.taxRatePct / 100);
  const grandTotal = preTaxTotal + tax;

  const lineResults: CostLineResult[] = lines.map((_, i) => ({
    amount: lineAmounts[i] ?? 0,
    sharePct: grandTotal === 0 ? undefined : ((lineAmounts[i] ?? 0) / grandTotal) * 100,
    percentBaseAmount: percentBaseAmounts[i],
  }));

  // A ticket-only event (no sponsor/donation lines) still has a revenue total
  // once BOTH ticketPrice and payingGuests are given — the earlier version
  // required a revenueLines entry to exist at all, which starved the one
  // number ("did the tickets cover the budget?") an events that sells only
  // tickets needs most.
  const hasTicketRevenue = input.ticketPrice !== undefined && input.payingGuests !== undefined;
  const hasRevenue = input.revenueLines !== undefined || hasTicketRevenue;
  const revenueTotal = hasRevenue
    ? (input.revenueLines?.reduce((sum, r) => sum + r.amount, 0) ?? 0) +
      (hasTicketRevenue ? (input.ticketPrice as number) * (input.payingGuests as number) : 0)
    : undefined;

  const nonTicketRevenue = input.revenueLines?.reduce((sum, r) => sum + r.amount, 0) ?? 0;
  const breakEvenTicketPriceCeil =
    input.payingGuests !== undefined && isPositive(input.payingGuests)
      ? ceilToCent((grandTotal - nonTicketRevenue) / input.payingGuests)
      : undefined;

  return {
    ok: true,
    lines: lineResults,
    base,
    percentSum,
    subtotal,
    reserve,
    preTaxTotal,
    taxBaseAmount,
    tax,
    grandTotal,
    costPerGuestWithTax: grandTotal / guests,
    costPerGuestWithoutTax: preTaxTotal / guests,
    costPerTableWithTax: tables > 0 ? grandTotal / tables : undefined,
    costPerTableWithoutTax: tables > 0 ? preTaxTotal / tables : undefined,
    revenueTotal,
    revenueDifference: revenueTotal === undefined ? undefined : revenueTotal - grandTotal,
    breakEvenTicketPriceCeil,
    ticketRevenue:
      input.ticketPrice !== undefined && input.payingGuests !== undefined
        ? input.ticketPrice * input.payingGuests
        : undefined,
  };
}

/* ---------------------------------------------------------------------------
 * catering-per-guest — „Hrana i piće po gostu"
 * ------------------------------------------------------------------------ */

export type CateringUnit = "g" | "ml" | "kom";
export type CateringPackUnit = "g" | "kg" | "ml" | "l" | "kom";
export type PackRounding = "up" | "exact";

export interface CateringLine {
  readonly unit: CateringUnit;
  readonly quantityPerGuest: number;
  /** Share of guests who take this item at all, in %. */
  readonly uptakePct: number;
  readonly reservePct: number;
  readonly packSize: number;
  readonly packUnit: CateringPackUnit;
  readonly pricePerPack?: number | undefined;
  /** Liquid lines only, in ml — the size a single pour is served at. */
  readonly pourSizeMl?: number | undefined;
}

export interface CateringInput {
  readonly guests: number;
  readonly lines: readonly CateringLine[];
  readonly packRounding: PackRounding;
}

export interface CateringLineResult {
  /** Gross quantity in the line's own base unit (g, ml or kom). */
  readonly grossQuantity: number;
  /** The same, in kg or l — undefined for `kom` lines. */
  readonly grossQuantityBig: number | undefined;
  readonly packs: number;
  /** In the line's base unit — always ≥ 0 under `"up"` rounding. */
  readonly surplus: number;
  /** floor(net need ÷ pour size) — what the recipe calls for. */
  readonly poursFromNeed: number | undefined;
  /** floor(purchased quantity ÷ pour size) — what the bartender actually has. */
  readonly poursFromPurchased: number | undefined;
  readonly cost: number | undefined;
  readonly costPerGuest: number | undefined;
  /** Cost divided by the guests who actually TAKE the item, not by every guest. */
  readonly costPerTakingGuest: number | undefined;
  /**
   * Purchased mass/volume over the NET need (before reserve) — reserve and
   * rounding combined. `undefined` on a 0 % uptake line, where the net need
   * is 0 and "actual reserve" over nothing is not a percentage of anything.
   */
  readonly actualReservePct: number | undefined;
}

export interface CateringResult {
  readonly lines: readonly CateringLineResult[];
  readonly totalCost: number | undefined;
  readonly totalCostPerGuest: number | undefined;
}

/**
 * Purchase quantity, packs and cost for each catering line.
 *
 * **Uptake and reserve compound multiplicatively, in that order, and are
 * never added.** A pack size may be entered in kg or l as an explicit ×1000
 * of the line's own unit; anything else — g against ml, a mass against a
 * count — is refused rather than guessed, because there is no density here
 * to convert with.
 */
export function cateringPerGuest(input: CateringInput): ProResult<CateringResult> {
  const { guests, lines } = input;
  if (!isIntegerIn(guests, 1, 5000)) return fail("guests");
  if (lines.length === 0) return fail("lines");

  const results: CateringLineResult[] = [];
  let anyCost = false;
  let totalCost = 0;

  for (const [i, line] of lines.entries()) {
    if (!isPositive(line.quantityPerGuest)) return fail(`quantityPerGuest:${i}`);
    if (!isInRange(line.uptakePct, 0, 100)) return fail(`uptakePct:${i}`);
    if (!isInRange(line.reservePct, 0, 100)) return fail(`reservePct:${i}`);
    if (!isPositive(line.packSize)) return fail(`packSize:${i}`);

    const dimensionOf = (u: CateringUnit | CateringPackUnit): "mass" | "volume" | "count" =>
      u === "g" || u === "kg" ? "mass" : u === "ml" || u === "l" ? "volume" : "count";
    if (dimensionOf(line.unit) !== dimensionOf(line.packUnit)) return fail(`packUnit:${i}`);
    const packFactor = line.packUnit === "kg" || line.packUnit === "l" ? 1000 : 1;
    const packSizeBase = line.packSize * packFactor;

    const netNeed = guests * line.quantityPerGuest * (line.uptakePct / 100);
    const grossQuantity = netNeed * (1 + line.reservePct / 100);

    const exactPacks = grossQuantity / packSizeBase;
    const packs = input.packRounding === "up" ? ceilSnapped(exactPacks) : exactPacks;
    const purchased = packs * packSizeBase;
    const surplus = purchased - grossQuantity;

    let poursFromNeed: number | undefined;
    let poursFromPurchased: number | undefined;
    if (line.unit === "ml" && line.pourSizeMl !== undefined) {
      if (!isPositive(line.pourSizeMl)) return fail(`pourSizeMl:${i}`);
      poursFromNeed = floorSnapped(grossQuantity / line.pourSizeMl);
      poursFromPurchased = floorSnapped(purchased / line.pourSizeMl);
    }

    let cost: number | undefined;
    let costPerGuest: number | undefined;
    let costPerTakingGuest: number | undefined;
    if (line.pricePerPack !== undefined) {
      if (!isNonNegative(line.pricePerPack)) return fail(`pricePerPack:${i}`);
      cost = packs * line.pricePerPack;
      costPerGuest = cost / guests;
      const takingGuests = guests * (line.uptakePct / 100);
      costPerTakingGuest = takingGuests > 0 ? cost / takingGuests : undefined;
      anyCost = true;
      totalCost += cost;
    }

    results.push({
      grossQuantity,
      grossQuantityBig: line.unit === "kom" ? undefined : grossQuantity / 1000,
      packs,
      surplus,
      poursFromNeed,
      poursFromPurchased,
      cost,
      costPerGuest,
      costPerTakingGuest,
      actualReservePct: netNeed > 0 ? (purchased / netNeed - 1) * 100 : undefined,
    });
  }

  return {
    ok: true,
    lines: results,
    totalCost: anyCost ? totalCost : undefined,
    totalCostPerGuest: anyCost ? totalCost / guests : undefined,
  };
}

/* ---------------------------------------------------------------------------
 * generator-sizing — „Snaga agregata"
 * ------------------------------------------------------------------------ */

export interface GeneratorConsumer {
  readonly kw: number;
  /** Signed: positive lagging (the usual case), negative LEADING (LED drivers, filters). */
  readonly cosPhi: number;
  readonly simultaneityPct?: number | undefined;
  readonly isMotor?: boolean | undefined;
  /** Motor rows only: locked-rotor apparent power per rated kW, in kVA/kW. */
  readonly startingKvaPerKw?: number | undefined;
  /** Motor rows only: power factor at the instant of starting. */
  readonly startingCosPhi?: number | undefined;
}

export interface GeneratorSizingInput {
  readonly consumers: readonly GeneratorConsumer[];
  readonly reservePct: number;
  readonly deratePct: number;
  /** From the genset's OWN nameplate — no default, because it belongs to one specific machine. */
  readonly ratedPowerFactor: number;
  readonly specificFuelConsumptionLPerKwh?: number | undefined;
  readonly hours?: number | undefined;
  /** Nameplate output, kW — needed only to print the load percentage and l/h. */
  readonly ratedPowerKw?: number | undefined;
}

export interface GeneratorSizingResult {
  readonly runningActiveKw: number;
  readonly runningReactiveKvar: number;
  readonly runningApparentKva: number;
  /** `undefined` when the running apparent power is 0 — a power factor of nothing is not defined. */
  readonly runningPowerFactor: number | undefined;
  /** Which consumer row produced the worst starting peak — undefined when there is no motor. */
  readonly peakMotorIndex: number | undefined;
  readonly peakActiveKw: number;
  readonly peakReactiveKvar: number;
  readonly peakApparentKva: number;
  readonly designApparentKva: number;
  readonly designActiveKw: number;
  readonly fuelLitresPerHour: number | undefined;
  readonly fuelLitresTotal: number | undefined;
  readonly loadPct: number | undefined;
}

/**
 * Running load, the worst motor-starting peak, and the resulting design kVA.
 *
 * **The peak is picked by the computed starting kVA, never by the largest
 * nameplate kW.** A small motor with a high locked-rotor multiplier can beat
 * a bigger, gentler one on the peak it actually produces, and starting
 * figures now live on the consumer's own row because they differ motor to
 * motor. Reactive power is SIGNED so a leading load (negative `cosPhi`)
 * partially cancels a lagging one rather than adding to it.
 *
 * **The fuel figure is LINEAR in delivered active energy and carries no idle
 * consumption** — `fuelLitresPerHour` is `specificFuelConsumptionLPerKwh ×
 * runningActiveKw` with no term for a genset idling below load, which is why
 * the input is a single catalogue l/kWh rather than a curve: a real engine's
 * specific consumption is read per LOAD BAND, not assumed constant across
 * the whole range.
 */
export function generatorSizing(input: GeneratorSizingInput): ProResult<GeneratorSizingResult> {
  const { consumers } = input;
  if (consumers.length === 0) return fail("consumers");
  if (!isInRange(input.reservePct, 0, 100)) return fail("reservePct");
  if (!isInRange(input.deratePct, 0, 50)) return fail("deratePct");
  if (!isInRange(input.ratedPowerFactor, 0.5, 1.0)) return fail("ratedPowerFactor");
  if (input.ratedPowerKw !== undefined && !isPositive(input.ratedPowerKw)) return fail("ratedPowerKw");
  if (input.specificFuelConsumptionLPerKwh !== undefined && !isPositive(input.specificFuelConsumptionLPerKwh)) {
    return fail("specificFuelConsumptionLPerKwh");
  }
  if (input.hours !== undefined && !isPositive(input.hours)) return fail("hours");

  interface Row {
    readonly p: number;
    readonly q: number;
    readonly isMotor: boolean;
    readonly startingKva: number;
    readonly startingCos: number;
  }
  const rows: Row[] = [];
  for (const [i, c] of consumers.entries()) {
    if (!isPositive(c.kw)) return fail(`kw:${i}`);
    const mag = Math.abs(c.cosPhi);
    if (!isInRange(mag, 0.1, 1.0)) return fail(`cosPhi:${i}`);
    const simultaneity = c.simultaneityPct ?? 100;
    if (!isInRange(simultaneity, 0, 100)) return fail(`simultaneityPct:${i}`);
    let startingKva = 0;
    let startingCos = 1;
    if (c.isMotor === true) {
      const kvaPerKw = c.startingKvaPerKw;
      if (!isPositive(kvaPerKw) || !isInRange(kvaPerKw, 1.0, 10.0)) return fail(`startingKvaPerKw:${i}`);
      const startCos = c.startingCosPhi;
      if (!isPositive(startCos) || !isInRange(startCos, 0.1, 1.0)) return fail(`startingCosPhi:${i}`);
      startingKva = c.kw * kvaPerKw;
      startingCos = startCos;
    }
    const p = c.kw * (simultaneity / 100);
    const tanPhi = Math.sqrt(1 - mag * mag) / mag;
    const q = p * tanPhi * Math.sign(c.cosPhi === 0 ? 1 : c.cosPhi);
    rows.push({ p, q, isMotor: c.isMotor === true, startingKva, startingCos });
  }

  const runningActiveKw = rows.reduce((s, r) => s + r.p, 0);
  const runningReactiveKvar = rows.reduce((s, r) => s + r.q, 0);
  const runningApparentKva = Math.hypot(runningActiveKw, runningReactiveKvar);
  const runningPowerFactor = runningApparentKva === 0 ? undefined : runningActiveKw / runningApparentKva;

  let peakMotorIndex: number | undefined;
  let peakActiveKw = runningActiveKw;
  let peakReactiveKvar = runningReactiveKvar;
  let peakApparentKva = runningApparentKva;
  for (const [i, row] of rows.entries()) {
    if (!row.isMotor) continue;
    const startSin = Math.sqrt(1 - row.startingCos * row.startingCos);
    const pPeak = runningActiveKw - row.p + row.startingKva * row.startingCos;
    const qPeak = runningReactiveKvar - row.q + row.startingKva * startSin;
    const sPeak = Math.hypot(pPeak, qPeak);
    if (peakMotorIndex === undefined || sPeak > peakApparentKva) {
      peakMotorIndex = i;
      peakActiveKw = pPeak;
      peakReactiveKvar = qPeak;
      peakApparentKva = sPeak;
    }
  }

  const worst = Math.max(runningApparentKva, peakApparentKva);
  const designApparentKva = (worst * (1 + input.reservePct / 100)) / (1 - input.deratePct / 100);
  const designActiveKw = designApparentKva * input.ratedPowerFactor;

  const fuelLitresPerHour =
    input.specificFuelConsumptionLPerKwh === undefined
      ? undefined
      : input.specificFuelConsumptionLPerKwh * runningActiveKw;
  const fuelLitresTotal =
    fuelLitresPerHour === undefined || input.hours === undefined ? undefined : fuelLitresPerHour * input.hours;
  const loadPct = input.ratedPowerKw === undefined ? undefined : (runningActiveKw / input.ratedPowerKw) * 100;

  return {
    ok: true,
    runningActiveKw,
    runningReactiveKvar,
    runningApparentKva,
    runningPowerFactor,
    peakMotorIndex,
    peakActiveKw,
    peakReactiveKvar,
    peakApparentKva,
    designApparentKva,
    designActiveKw,
    fuelLitresPerHour,
    fuelLitresTotal,
    loadPct,
  };
}

/* ---------------------------------------------------------------------------
 * ice-and-chilling — „Led za rashlađivanje"
 * ------------------------------------------------------------------------ */

/** Latent heat of fusion of ice at 0 °C, kJ/kg. */
const LATENT_HEAT_ICE = 333.55;
/** Specific heat of liquid water, kJ/(kg·K). */
const SPECIFIC_HEAT_WATER = 4.184;
/** Specific heat of ice below 0 °C, kJ/(kg·K). */
const SPECIFIC_HEAT_ICE = 2.108;
/** Density of ice at 0 °C, kg/m³. */
const DENSITY_ICE = 917;

export interface IceChillingInput {
  readonly drinkMassKg?: number | undefined;
  readonly drinkVolumeL?: number | undefined;
  /** Required only when `drinkVolumeL` is given instead of `drinkMassKg`, in kg/L. */
  readonly drinkDensityKgPerL?: number | undefined;
  readonly drinkSpecificHeat?: number | undefined;
  readonly packagingMassKg?: number | undefined;
  readonly packagingSpecificHeat?: number | undefined;
  readonly startTempC: number;
  /** The user's own target — this package never asserts what "cold enough" is. */
  readonly targetTempC: number;
  readonly iceTempC?: number | undefined;
  readonly ambientHeatIngressW?: number | undefined;
  /** Alternative to `ambientHeatIngressW`: a UA figure (W/K) against `ambientTempC`. */
  readonly holdUaWPerK?: number | undefined;
  readonly ambientTempC?: number | undefined;
  readonly holdHours?: number | undefined;
  readonly bagMassKg?: number | undefined;
  /** Solid fraction of a bag of ice, 0–1 — cubes/flakes carry 35–45 % voids. No default: the tool holds no packing table. */
  readonly bulkSolidFraction?: number | undefined;
  /** True when the ice melts directly INTO the drink (punch, bowla) rather than in a sealed container. */
  readonly meltsIntoDrink?: boolean | undefined;
}

export interface IceChillingResult {
  readonly heatToRemoveKj: number;
  /**
   * `true` when `targetTempC >= startTempC` — nothing to remove, so
   * `heatToRemoveKj`/`icePulldownKg` are 0 by definition rather than by a
   * silent clamp. Distinguishes "computed zero" from "asked for a target
   * already reached", which a bare `0` cannot.
   */
  readonly noCoolingNeeded: boolean;
  /** kJ absorbed by one kilogram of ice on its way to `targetTempC`. */
  readonly heatCapacityPerKgIce: number;
  readonly icePulldownKg: number;
  readonly iceHoldingMeltKg: number | undefined;
  /**
   * Ambient heat ingress DURING HOLDING, watts, exactly as computed —
   * negative when the ambient is colder than `targetTempC` (only reachable
   * via `holdUaWPerK`/`ambientTempC`). `iceHoldingMeltKg` clamps this at 0
   * before turning it into melt; this field is what makes that clamp legible
   * instead of a silent "no melt" that looks identical to "not asked".
   */
  readonly holdIngressW: number | undefined;
  readonly totalIceKg: number;
  readonly solidVolumeL: number;
  /** `solidVolumeL / bulkSolidFraction` — the tub/cooler volume the bagged ice actually needs. */
  readonly bulkVolumeL: number | undefined;
  readonly bags: number;
  /** Mass of meltwater from the pull-down ice alone, kg — 1 kg ice → 1 kg water. */
  readonly meltwaterMassKg: number;
  /** Only when `meltsIntoDrink` is true: pull-down ice mass over (drink + that ice), in %. */
  readonly dilutionPct: number | undefined;
  /** Pull-down ice per kg of drink — the IDEAL, complete-melt LOWER bound on ice needed. */
  readonly iceToDrinkRatio: number;
}

/**
 * Ice needed to pull a drink down to a target temperature, plus holding melt.
 *
 * **This is one equilibrium step to the target, not a cooling curve** — it
 * has no time axis for the pull-down and says nothing about how fast
 * anything gets cold. `icePulldownKg` is therefore an IDEAL lower bound (all
 * the ice melts); `iceHoldingMeltKg` uses the latent term only and so is an
 * UPPER bound on what actually melts while holding. Both directions are
 * named in the field comments rather than asserted as a single "right"
 * number, because the tool makes no claim about how the ice is packed.
 */
export function iceChilling(input: IceChillingInput): ProResult<IceChillingResult> {
  const cDrink = input.drinkSpecificHeat ?? SPECIFIC_HEAT_WATER;
  const cPack = input.packagingSpecificHeat ?? 0.84;
  const iceTemp = input.iceTempC ?? 0;
  const bagMass = input.bagMassKg ?? 5;
  if (!isInRange(cDrink, 1.0, 5.0)) return fail("drinkSpecificHeat");
  if (!isInRange(cPack, 0.4, 1.2)) return fail("packagingSpecificHeat");
  if (!isInRange(iceTemp, -30, 0)) return fail("iceTempC");
  if (!isInRange(input.startTempC, -10, 60)) return fail("startTempC");
  if (!isInRange(input.targetTempC, 0, 40)) return fail("targetTempC");
  if (!isInRange(bagMass, 0.5, 25)) return fail("bagMassKg");
  if (input.bulkSolidFraction !== undefined && !isInRange(input.bulkSolidFraction, 0.1, 1)) {
    return fail("bulkSolidFraction");
  }

  let drinkMass: number;
  if (input.drinkMassKg !== undefined) {
    if (!isPositive(input.drinkMassKg)) return fail("drinkMassKg");
    drinkMass = input.drinkMassKg;
  } else {
    if (!isPositive(input.drinkVolumeL)) return fail("drinkVolumeL");
    if (!isPositive(input.drinkDensityKgPerL)) return fail("drinkDensityKgPerL");
    drinkMass = input.drinkVolumeL * input.drinkDensityKgPerL;
  }
  const packagingMass = input.packagingMassKg ?? 0;
  if (!isNonNegative(packagingMass)) return fail("packagingMassKg");

  const q = (drinkMass * cDrink + packagingMass * cPack) * (input.startTempC - input.targetTempC);
  const noCoolingNeeded = q <= 0;
  const heatToRemoveKj = Math.max(0, q);
  const waterTerm = SPECIFIC_HEAT_WATER * Math.max(input.targetTempC, 0);
  const heatCapacityPerKgIce = SPECIFIC_HEAT_ICE * (0 - iceTemp) + LATENT_HEAT_ICE + waterTerm;
  const icePulldownKg = heatCapacityPerKgIce > 0 ? heatToRemoveKj / heatCapacityPerKgIce : 0;

  const hasWattPath = input.ambientHeatIngressW !== undefined;
  const hasUaPath = input.holdUaWPerK !== undefined || input.ambientTempC !== undefined;
  if (hasWattPath && hasUaPath) return fail("ambiguousHoldPath");
  let iceHoldingMeltKg: number | undefined;
  let holdIngressW: number | undefined;
  if (hasWattPath || hasUaPath) {
    if (!isPositive(input.holdHours)) return fail("holdHours");
    if (hasWattPath) {
      if (!isPositive(input.ambientHeatIngressW)) return fail("ambientHeatIngressW");
      holdIngressW = input.ambientHeatIngressW;
    } else {
      if (!isPositive(input.holdUaWPerK) || !Number.isFinite(input.ambientTempC)) return fail("holdUaWPerK");
      // UNCLAMPED — a colder ambient than the target gives a NEGATIVE figure
      // here, on purpose: see `holdIngressW`'s doc comment.
      holdIngressW = input.holdUaWPerK * ((input.ambientTempC as number) - input.targetTempC);
    }
    const energyKj = (Math.max(0, holdIngressW) * input.holdHours * 3600) / 1000;
    iceHoldingMeltKg = energyKj / LATENT_HEAT_ICE;
  }

  const totalIceKg = icePulldownKg + (iceHoldingMeltKg ?? 0);
  const solidVolumeL = (totalIceKg / DENSITY_ICE) * 1000;
  const bulkVolumeL = input.bulkSolidFraction === undefined ? undefined : solidVolumeL / input.bulkSolidFraction;
  const bags = totalIceKg > 0 ? ceilSnapped(totalIceKg / bagMass) : 0;
  const meltwaterMassKg = icePulldownKg;

  return {
    ok: true,
    heatToRemoveKj,
    noCoolingNeeded,
    heatCapacityPerKgIce,
    icePulldownKg,
    iceHoldingMeltKg,
    holdIngressW,
    totalIceKg,
    solidVolumeL,
    bulkVolumeL,
    bags,
    meltwaterMassKg,
    dilutionPct:
      input.meltsIntoDrink === true ? (icePulldownKg / (drinkMass + icePulldownKg)) * 100 : undefined,
    iceToDrinkRatio: icePulldownKg / drinkMass,
  };
}

/* ---------------------------------------------------------------------------
 * led-wall-pitch-viewing — „LED zid"
 * ------------------------------------------------------------------------ */

/** π / 10800 — one arcminute in radians. */
const RAD_PER_ARCMIN = 0.0002908882086657216;

export interface LedWallInput {
  /** Pixel pitch, mm — the panel's own catalogue figure (e.g. "P2.5" is 2.5). */
  readonly pitchMm: number;
  readonly panelWidthMm?: number | undefined;
  readonly panelHeightMm?: number | undefined;
  readonly panelsWide?: number | undefined;
  readonly panelsHigh?: number | undefined;
  /** Alternative to `panelsWide`/`panelsHigh`: a target wall size, m. */
  readonly targetWidthM?: number | undefined;
  readonly targetHeightM?: number | undefined;
  /** No default: a catalogue/acuity reference the tool holds no opinion on. */
  readonly acuityArcmin: number;
  readonly portCapacityPx?: number | undefined;
  readonly panelMaxW?: number | undefined;
  readonly panelAvgW?: number | undefined;
  readonly voltage?: number | undefined;
  readonly powerFactor?: number | undefined;
}

export interface LedWallResult {
  readonly panelPixelsWide: number;
  readonly panelPixelsHigh: number;
  readonly panelsWide: number;
  readonly panelsHigh: number;
  readonly wallWidthM: number;
  readonly wallHeightM: number;
  readonly resolutionWide: number;
  readonly resolutionHigh: number;
  readonly totalPixels: number;
  readonly aspectDecimal: number;
  readonly aspectReducedWide: number;
  readonly aspectReducedHigh: number;
  readonly pixelDensityPxPerM: number;
  readonly viewingDistanceAtAcuityM: number;
  readonly viewingDistanceAt1ArcminM: number;
  readonly viewingDistanceAt2ArcminM: number;
  readonly ports: number | undefined;
  readonly powerMaxKw: number | undefined;
  readonly powerAvgKw: number | undefined;
  readonly apparentMaxKva: number | undefined;
  readonly apparentAvgKva: number | undefined;
  readonly currentMaxA: number | undefined;
  readonly currentAvgA: number | undefined;
}

/**
 * Panel resolution, wall size, viewing distance and power for an LED wall.
 *
 * **Ports are counted by WHOLE panels, never by slicing a panel's pixels
 * across two ports.** `ceil(totalPixels / capacity)` under-counts because a
 * real processor cannot split a panel; the right arithmetic is panels-per-port
 * from `floor`, then `ceil(panels / thatCount)`. Divisibility of the panel by
 * the pitch is checked with a small tolerance, because 168/0.7 lands on
 * 240.00000000000003 in IEEE 754 and would otherwise refuse a panel that is
 * exactly right.
 *
 * **`apparentMaxKva`/`apparentAvgKva` model steady-state load only — panel
 * switch-on inrush is not modelled.** A wall's power-up current draw can
 * exceed its steady-state figure by several times for a brief instant; sizing
 * an upstream breaker from these numbers alone ignores that.
 */
export function ledWallLayout(input: LedWallInput): ProResult<LedWallResult> {
  if (!isPositive(input.pitchMm)) return fail("pitchMm");
  const panelW = input.panelWidthMm ?? 500;
  const panelH = input.panelHeightMm ?? 500;
  if (!isInRange(panelW, 100, 2000)) return fail("panelWidthMm");
  if (!isInRange(panelH, 100, 2000)) return fail("panelHeightMm");
  if (!isInRange(input.acuityArcmin, 0.5, 10)) return fail("acuityArcmin");

  const pxWExact = panelW / input.pitchMm;
  const pxHExact = panelH / input.pitchMm;
  const TOL = 1e-6;
  if (Math.abs(pxWExact - Math.round(pxWExact)) > TOL) return fail("pitchMm");
  if (Math.abs(pxHExact - Math.round(pxHExact)) > TOL) return fail("pitchMm");
  const pxW = Math.round(pxWExact);
  const pxH = Math.round(pxHExact);

  const hasCounts = input.panelsWide !== undefined && input.panelsHigh !== undefined;
  const hasTarget = input.targetWidthM !== undefined && input.targetHeightM !== undefined;
  if (hasCounts === hasTarget) return fail("panelsWide");
  let panelsWide: number;
  let panelsHigh: number;
  if (hasCounts) {
    if (!isIntegerIn(input.panelsWide as number, 1, 200)) return fail("panelsWide");
    if (!isIntegerIn(input.panelsHigh as number, 1, 100)) return fail("panelsHigh");
    panelsWide = input.panelsWide as number;
    panelsHigh = input.panelsHigh as number;
  } else {
    if (!isPositive(input.targetWidthM)) return fail("targetWidthM");
    if (!isPositive(input.targetHeightM)) return fail("targetHeightM");
    panelsWide = ceilSnapped((input.targetWidthM * 1000) / panelW);
    panelsHigh = ceilSnapped((input.targetHeightM * 1000) / panelH);
    // The explicit-count branch above enforces 1-200 / 1-100 on what the user
    // TYPED; a target size derives the same two counts, and without this they
    // are never checked against the same bound — a 400m target width would
    // silently produce a 667-panel wall.
    if (!isIntegerIn(panelsWide, 1, 200)) return fail("targetWidthM");
    if (!isIntegerIn(panelsHigh, 1, 100)) return fail("targetHeightM");
  }

  const wallWidthM = (panelsWide * panelW) / 1000;
  const wallHeightM = (panelsHigh * panelH) / 1000;
  const resolutionWide = panelsWide * pxW;
  const resolutionHigh = panelsHigh * pxH;
  const totalPixels = resolutionWide * resolutionHigh;

  const divisor = gcdEvent(resolutionWide, resolutionHigh);
  const distanceAt = (arcmin: number): number => input.pitchMm / (arcmin * RAD_PER_ARCMIN) / 1000;

  let ports: number | undefined;
  if (input.portCapacityPx !== undefined) {
    if (!isInRange(input.portCapacityPx, 10000, 2000000)) return fail("portCapacityPx");
    const panelPixels = pxW * pxH;
    const panelsPerPort = Math.floor(input.portCapacityPx / panelPixels);
    if (panelsPerPort < 1) return fail("portCapacityPx");
    ports = Math.ceil((panelsWide * panelsHigh) / panelsPerPort);
  }

  let powerMaxKw: number | undefined;
  let powerAvgKw: number | undefined;
  let apparentMaxKva: number | undefined;
  let apparentAvgKva: number | undefined;
  let currentMaxA: number | undefined;
  let currentAvgA: number | undefined;
  if (input.panelMaxW !== undefined || input.panelAvgW !== undefined) {
    if (!isPositive(input.panelMaxW) || !isInRange(input.panelMaxW, 10, 2000)) return fail("panelMaxW");
    if (!isPositive(input.panelAvgW) || !isInRange(input.panelAvgW, 5, 2000)) return fail("panelAvgW");
    const panelCount = panelsWide * panelsHigh;
    powerMaxKw = (panelCount * input.panelMaxW) / 1000;
    powerAvgKw = (panelCount * input.panelAvgW) / 1000;
    if (input.powerFactor !== undefined) {
      if (!isInRange(input.powerFactor, 0.5, 1.0)) return fail("powerFactor");
      apparentMaxKva = powerMaxKw / input.powerFactor;
      apparentAvgKva = powerAvgKw / input.powerFactor;
      const voltage = input.voltage ?? 230;
      if (!isInRange(voltage, 100, 400)) return fail("voltage");
      currentMaxA = (powerMaxKw * 1000) / (voltage * input.powerFactor);
      currentAvgA = (powerAvgKw * 1000) / (voltage * input.powerFactor);
    }
  }

  return {
    ok: true,
    panelPixelsWide: pxW,
    panelPixelsHigh: pxH,
    panelsWide,
    panelsHigh,
    wallWidthM,
    wallHeightM,
    resolutionWide,
    resolutionHigh,
    totalPixels,
    aspectDecimal: wallWidthM / wallHeightM,
    aspectReducedWide: resolutionWide / divisor,
    aspectReducedHigh: resolutionHigh / divisor,
    pixelDensityPxPerM: 1000 / input.pitchMm,
    viewingDistanceAtAcuityM: distanceAt(input.acuityArcmin),
    viewingDistanceAt1ArcminM: distanceAt(1),
    viewingDistanceAt2ArcminM: distanceAt(2),
    ports,
    powerMaxKw,
    powerAvgKw,
    apparentMaxKva,
    apparentAvgKva,
    currentMaxA,
    currentAvgA,
  };
}

function gcdEvent(a: number, b: number): number {
  let x = Math.round(Math.abs(a));
  let y = Math.round(Math.abs(b));
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x === 0 ? 1 : x;
}

/* ---------------------------------------------------------------------------
 * parking-cloakroom — „Parking i garderoba"
 * ------------------------------------------------------------------------ */

export interface ParkingCloakroomInput {
  readonly guests: number;
  readonly carSharePct: number;
  readonly occupancyPerCar: number;
  readonly busSharePct?: number | undefined;
  readonly seatsPerBus?: number | undefined;
  readonly areaPerStallM2: number;
  readonly availableStalls?: number | undefined;
  readonly coatSharePct: number;
  readonly itemsPerGuest: number;
  readonly hangerPitchM: number;
  /** Each element is one physical rail — capacity is computed PER SEGMENT, never on the summed length. */
  readonly availableRailSegmentsM?: readonly number[] | undefined;
  readonly checkInWindowMinutes: number;
  /** Pieces per minute, per attendant — a piece, not a guest, is the unit of work. */
  readonly checkInRatePiecesPerMinute: number;
  readonly checkInAttendants?: number | undefined;
  readonly checkOutWindowMinutes?: number | undefined;
  readonly checkOutRatePiecesPerMinute?: number | undefined;
  readonly checkOutAttendants?: number | undefined;
}

export interface ThroughputResult {
  readonly attendantsNeeded: number;
  readonly clearTimeMinutes: number | undefined;
  readonly clearTimeDiffMinutes: number | undefined;
}

export interface ParkingCloakroomResult {
  readonly carGuests: number;
  readonly cars: number;
  readonly parkingAreaM2: number;
  readonly busGuests: number | undefined;
  readonly buses: number | undefined;
  readonly stallRatio: number | undefined;
  readonly stallDiff: number | undefined;
  readonly coatGuests: number;
  readonly items: number;
  readonly railLengthNeededM: number;
  readonly railCapacityItems: number | undefined;
  readonly railRatio: number | undefined;
  readonly railDiff: number | undefined;
  readonly checkIn: ThroughputResult;
  readonly checkOut: ThroughputResult | undefined;
}

/**
 * Cars, parking area and cloakroom rail length from the guest count and the
 * user's own modal split and service rates.
 *
 * **The service rate is per PIECE, not per guest** — a guest with three coats
 * is three units of work, and this tool never conflates the two. Rail
 * capacity is computed PER SEGMENT (`floor(length/pitch)` for each rail,
 * summed) rather than on the total length, because three short rails hold
 * fewer coats than one rail of the same combined length.
 */
export function parkingCloakroom(input: ParkingCloakroomInput): ProResult<ParkingCloakroomResult> {
  const { guests } = input;
  if (!isIntegerIn(guests, 1, 100000)) return fail("guests");
  if (!isInRange(input.carSharePct, 0, 100)) return fail("carSharePct");
  if (!isPositive(input.occupancyPerCar) || !isInRange(input.occupancyPerCar, 1.0, 8.0)) {
    return fail("occupancyPerCar");
  }
  const busShare = input.busSharePct ?? 0;
  if (!isInRange(busShare, 0, 100)) return fail("busSharePct");
  if (input.carSharePct + busShare > 100) return fail("shareSum");
  if (!isInRange(input.areaPerStallM2, 5, 100)) return fail("areaPerStallM2");
  if (!isInRange(input.coatSharePct, 0, 100)) return fail("coatSharePct");
  if (!isPositive(input.itemsPerGuest) || !isInRange(input.itemsPerGuest, 0.5, 4.0)) {
    return fail("itemsPerGuest");
  }
  if (!isPositive(input.hangerPitchM) || !isInRange(input.hangerPitchM, 0.03, 0.15)) {
    return fail("hangerPitchM");
  }
  if (!isPositive(input.checkInWindowMinutes)) return fail("checkInWindowMinutes");
  if (!isPositive(input.checkInRatePiecesPerMinute)) return fail("checkInRatePiecesPerMinute");

  const carGuests = roundHalfUp(guests * (input.carSharePct / 100), 0);
  const cars = ceilSnapped(carGuests / input.occupancyPerCar);
  const parkingAreaM2 = cars * input.areaPerStallM2;

  let busGuests: number | undefined;
  let buses: number | undefined;
  if (input.busSharePct !== undefined) {
    if (!isPositive(input.seatsPerBus) || !isInRange(input.seatsPerBus, 10, 100)) return fail("seatsPerBus");
    busGuests = roundHalfUp(guests * (input.busSharePct / 100), 0);
    buses = ceilSnapped(busGuests / input.seatsPerBus);
  }

  let stallRatio: number | undefined;
  let stallDiff: number | undefined;
  if (input.availableStalls !== undefined) {
    if (!isNonNegative(input.availableStalls)) return fail("availableStalls");
    stallRatio = input.availableStalls > 0 ? cars / input.availableStalls : undefined;
    stallDiff = cars - input.availableStalls;
  }

  const coatGuests = roundHalfUp(guests * (input.coatSharePct / 100), 0);
  const items = ceilSnapped(coatGuests * input.itemsPerGuest);
  const railLengthNeededM = items * input.hangerPitchM;

  let railCapacityItems: number | undefined;
  let railRatio: number | undefined;
  let railDiff: number | undefined;
  if (input.availableRailSegmentsM !== undefined) {
    for (const [i, seg] of input.availableRailSegmentsM.entries()) {
      if (!isNonNegative(seg)) return fail(`availableRailSegmentsM:${i}`);
    }
    railCapacityItems = input.availableRailSegmentsM.reduce(
      (sum, seg) => sum + floorSnapped(seg / input.hangerPitchM),
      0,
    );
    railRatio = railCapacityItems > 0 ? items / railCapacityItems : undefined;
    railDiff = items - railCapacityItems;
  }

  const throughput = (
    windowMinutes: number | undefined,
    ratePerMinute: number | undefined,
    attendantsGiven: number | undefined,
  ): ProResult<ThroughputResult> => {
    if (windowMinutes === undefined || ratePerMinute === undefined) return fail("window");
    if (!isPositive(windowMinutes) || !isPositive(ratePerMinute)) return fail("rate");
    if (attendantsGiven !== undefined && !isIntegerIn(attendantsGiven, 1, 100)) return fail("attendants");
    const attendantsNeeded = ceilSnapped(items / (windowMinutes * ratePerMinute));
    const clearTimeMinutes = attendantsGiven === undefined ? undefined : items / (attendantsGiven * ratePerMinute);
    return {
      ok: true,
      attendantsNeeded,
      clearTimeMinutes,
      clearTimeDiffMinutes: clearTimeMinutes === undefined ? undefined : clearTimeMinutes - windowMinutes,
    };
  };

  const checkIn = throughput(input.checkInWindowMinutes, input.checkInRatePiecesPerMinute, input.checkInAttendants);
  if (!checkIn.ok) return checkIn;

  let checkOut: ThroughputResult | undefined;
  const hasCheckOut =
    input.checkOutWindowMinutes !== undefined || input.checkOutRatePiecesPerMinute !== undefined;
  if (hasCheckOut) {
    const result = throughput(input.checkOutWindowMinutes, input.checkOutRatePiecesPerMinute, input.checkOutAttendants);
    if (!result.ok) return result;
    checkOut = result;
  }

  return {
    ok: true,
    carGuests,
    cars,
    parkingAreaM2,
    busGuests,
    buses,
    stallRatio,
    stallDiff,
    coatGuests,
    items,
    railLengthNeededM,
    railCapacityItems,
    railRatio,
    railDiff,
    checkIn,
    checkOut,
  };
}

/* ---------------------------------------------------------------------------
 * projector-throw-screen — „Projekcija i platno"
 * ------------------------------------------------------------------------ */

/** 1 fL = 3.4262591 cd/m² — definition of the foot-lambert. */
const FOOT_LAMBERT_CD_M2 = 3.4262591;
/** 1 m² = 10.76391… ft² — definition of the unit. */
const SQ_M_IN_SQ_FT = 10.763910416709722;

export type ProjectorKnown = "distance" | "width" | "diagonal";

export interface ProjectorInput {
  readonly throwRatio?: number | undefined;
  readonly throwRatioMin?: number | undefined;
  readonly throwRatioMax?: number | undefined;
  readonly known: ProjectorKnown;
  readonly knownValueM: number;
  /** Width ÷ height, e.g. 16/9. */
  readonly aspectRatio: number;
  readonly lumens?: number | undefined;
  readonly gain?: number | undefined;
  readonly contrastRatio?: number | undefined;
  readonly ambientLux?: number | undefined;
  /** Screen's diffuse reflectance for AMBIENT light — distinct from `gain`, which is a directional figure. */
  readonly diffuseReflectance?: number | undefined;
  readonly seatingDistanceM?: number | undefined;
  /** Reverse direction: the flux needed to reach this on-axis luminance, in fL. */
  readonly targetLuminanceFl?: number | undefined;
}

export interface ProjectorResult {
  readonly widthM: number;
  readonly heightM: number;
  readonly diagonalM: number;
  readonly diagonalIn: number;
  readonly areaM2: number;
  /**
   * A single fixed lens only: `width × throwRatio` — the D = W·TR direction.
   * `undefined` for a zoom lens, which has a RANGE instead — see
   * `zoomDistanceMinM`/`zoomDistanceMaxM`.
   */
  readonly distanceM: number | undefined;
  readonly zoomDistanceMinM: number | undefined;
  readonly zoomDistanceMaxM: number | undefined;
  /** lm ÷ (W×H) — the ANSI NINE-POINT AVERAGE, not the brighter centre of the image. */
  readonly avgIlluminanceLx: number | undefined;
  readonly avgLuminanceCdM2: number | undefined;
  readonly avgLuminanceFl: number | undefined;
  readonly ambientUsesGainApproximation: boolean;
  readonly onScreenContrast: number | undefined;
  readonly requiredLumensForTarget: number | undefined;
  readonly viewingAngleDeg: number | undefined;
}

/**
 * Image geometry, on-axis illuminance/luminance and on-screen contrast.
 *
 * **The illuminance is the ANSI nine-point AVERAGE — the true centre often
 * reads 10–30 % brighter.** Ambient contribution to on-screen contrast uses
 * the screen's own diffuse reflectance when given; `gain` is a DIRECTIONAL
 * figure for the projector's own beam, and reusing it for ambient light
 * (which arrives from every direction) overstates the contrast of any
 * screen with gain above 1 — the exact screens chosen for that number.
 *
 * **The whole geometry assumes the projector sits on-axis, perpendicular to
 * the screen centre, with no lens shift** — under keystone (an off-axis or
 * angled throw) every printed area, distance and illuminance figure is void,
 * since none of them account for the resulting trapezoidal image.
 */
export function projectorThrowScreen(input: ProjectorInput): ProResult<ProjectorResult> {
  const gain = input.gain ?? 1.0;
  if (!isInRange(gain, 0.4, 4.0)) return fail("gain");
  if (!isPositive(input.aspectRatio)) return fail("aspectRatio");
  if (!isPositive(input.knownValueM)) return fail("knownValueM");

  const hasSingle = input.throwRatio !== undefined;
  const hasZoom = input.throwRatioMin !== undefined && input.throwRatioMax !== undefined;
  // A single fixed lens and a zoom range are two different fixtures — giving
  // both, or neither, leaves the tool unable to say which one is meant.
  if (hasSingle === hasZoom) return fail("throwRatio");
  if (hasSingle && !isPositive(input.throwRatio)) return fail("throwRatio");
  let trMin = input.throwRatioMin;
  let trMax = input.throwRatioMax;
  if (hasZoom) {
    if (!isPositive(trMin) || !isPositive(trMax)) return fail("throwRatioMin");
    if (trMin > trMax) [trMin, trMax] = [trMax, trMin];
  }
  if (hasZoom && input.known === "distance") return fail("ambiguousZoom");

  let width: number;
  let height: number;
  if (input.known === "width") {
    width = input.knownValueM;
    height = width / input.aspectRatio;
  } else if (input.known === "diagonal") {
    width = input.knownValueM / Math.sqrt(1 + 1 / input.aspectRatio ** 2);
    height = width / input.aspectRatio;
  } else {
    if (hasZoom) return fail("ambiguousZoom");
    width = input.knownValueM / (input.throwRatio as number);
    height = width / input.aspectRatio;
  }

  const diagonalM = Math.hypot(width, height);
  const areaM2 = width * height;
  const areaFt2 = areaM2 * SQ_M_IN_SQ_FT;

  // D = W·TR. For `known: "distance"` this is an identity (width was itself
  // derived as knownValueM / throwRatio, so multiplying back out returns
  // knownValueM exactly); for "width"/"diagonal" it is the actual answer to
  // "where does a fixed lens of this ratio put the projector".
  const distanceM = hasSingle ? width * (input.throwRatio as number) : undefined;
  const zoomDistanceMinM = hasZoom ? width * (trMin as number) : undefined;
  const zoomDistanceMaxM = hasZoom ? width * (trMax as number) : undefined;

  let avgIlluminanceLx: number | undefined;
  let avgLuminanceCdM2: number | undefined;
  let avgLuminanceFl: number | undefined;
  if (input.lumens !== undefined) {
    if (!isInRange(input.lumens, 100, 100000)) return fail("lumens");
    avgIlluminanceLx = input.lumens / areaM2;
    avgLuminanceCdM2 = (avgIlluminanceLx * gain) / Math.PI;
    avgLuminanceFl = (input.lumens * gain) / areaFt2;
  }

  let onScreenContrast: number | undefined;
  const ambientUsesGainApproximation = input.diffuseReflectance === undefined;
  if (input.contrastRatio !== undefined && input.ambientLux !== undefined && avgLuminanceCdM2 !== undefined) {
    if (!isInRange(input.contrastRatio, 100, 2000000)) return fail("contrastRatio");
    if (!isInRange(input.ambientLux, 0, 2000)) return fail("ambientLux");
    if (input.diffuseReflectance !== undefined && !isInRange(input.diffuseReflectance, 0, 1)) {
      return fail("diffuseReflectance");
    }
    const reflectance = input.diffuseReflectance ?? gain;
    const lWhite = avgLuminanceCdM2;
    const lBlack = lWhite / input.contrastRatio;
    const lAmbient = (input.ambientLux * reflectance) / Math.PI;
    onScreenContrast = (lWhite + lAmbient) / (lBlack + lAmbient);
  }

  let requiredLumensForTarget: number | undefined;
  if (input.targetLuminanceFl !== undefined) {
    if (!isPositive(input.targetLuminanceFl)) return fail("targetLuminanceFl");
    requiredLumensForTarget = (input.targetLuminanceFl * areaFt2) / gain;
  }

  let viewingAngleDeg: number | undefined;
  if (input.seatingDistanceM !== undefined) {
    if (!isInRange(input.seatingDistanceM, 0.5, 100)) return fail("seatingDistanceM");
    viewingAngleDeg = 2 * Math.atan(width / 2 / input.seatingDistanceM) * DEG_PER_RAD;
  }

  return {
    ok: true,
    widthM: width,
    heightM: height,
    diagonalM,
    diagonalIn: diagonalM / 0.0254,
    areaM2,
    distanceM,
    zoomDistanceMinM,
    zoomDistanceMaxM,
    avgIlluminanceLx,
    avgLuminanceCdM2,
    avgLuminanceFl,
    ambientUsesGainApproximation,
    onScreenContrast,
    requiredLumensForTarget,
    viewingAngleDeg,
  };
}

/* ---------------------------------------------------------------------------
 * rigging-sling-angle-force — „Sila u kraku"
 * ------------------------------------------------------------------------ */

/** Standard gravity, m/s². */
const STANDARD_GRAVITY = 9.80665;

export type SlingAngleMode = "fromVertical" | "fromHorizontal" | "included" | "heightRadius";
export type WllUnit = "kg" | "kN";

export interface SlingTwoPoint {
  readonly spanM: number;
  /** Distance from point A to the load's centre of gravity, m. */
  readonly cogFromAM: number;
  /** Height of the single hook above the two pick points, m — both legs share this hook. */
  readonly hookHeightM: number;
}

export interface SlingForceInput {
  readonly massKg: number;
  readonly legs: number;
  readonly angleMode: SlingAngleMode;
  readonly angleValueDeg?: number | undefined;
  readonly heightM?: number | undefined;
  readonly radiusM?: number | undefined;
  readonly twoPoint?: SlingTwoPoint | undefined;
  readonly dynamicFactor?: number | undefined;
  readonly wllPerLeg?: number | undefined;
  readonly wllUnit?: WllUnit | undefined;
}

export interface SlingForceResult {
  /** UNFACTORED — the load's own weight is a fact independent of any dynamic factor. */
  readonly weightKn: number;
  readonly weightKgf: number;
  readonly weightKnFactored: number;
  readonly weightKgfFactored: number;
  /** Single-hang modes only — see `twoPointBetaADeg`/`twoPointBetaBDeg` for a two-point pick. */
  readonly betaDeg: number | undefined;
  /** UNFACTORED — see `forceLegKnFactored`/`forceLegKgfFactored` for the design figure. */
  readonly forceLegKn: number | undefined;
  readonly forceLegKgf: number | undefined;
  readonly forceLegKnFactored: number | undefined;
  readonly forceLegKgfFactored: number | undefined;
  /** Presses the load INWARD — the compression a spreader bar would carry. UNFACTORED. */
  readonly horizontalKgf: number;
  readonly horizontalKgfFactored: number;
  readonly verticalKgf: number | undefined;
  readonly verticalKgfFactored: number | undefined;
  readonly angleFactor: number | undefined;
  /** 4-leg rig only: the statically-indeterminate ideal split across all 4, UNFACTORED. */
  readonly fourLegShareKgf: number | undefined;
  readonly fourLegShareKgfFactored: number | undefined;
  /** 4-leg rig only: the conservative 2-leg share, since 4 legs are not statically determinate. UNFACTORED. */
  readonly twoLegShareKgf: number | undefined;
  readonly twoLegShareKgfFactored: number | undefined;
  readonly legLengthM: number | undefined;
  /**
   * The user's own dynamic factor, exactly as entered. `undefined` means none
   * was typed — distinct from an entered `1.0` — which the FACTORED fields
   * above cannot tell apart on their own, since both equal the static figure.
   */
  readonly dynamicFactor: number | undefined;
  /** Compares the FACTORED force (the one actually carried) against the WLL. */
  readonly wllRatio: number | undefined;
  readonly twoPointBetaADeg: number | undefined;
  readonly twoPointBetaBDeg: number | undefined;
  readonly twoPointForceAKgf: number | undefined;
  readonly twoPointForceBKgf: number | undefined;
  readonly twoPointForceAKgfFactored: number | undefined;
  readonly twoPointForceBKgfFactored: number | undefined;
  readonly twoPointVerticalAKgf: number | undefined;
  readonly twoPointVerticalBKgf: number | undefined;
  readonly twoPointVerticalAKgfFactored: number | undefined;
  readonly twoPointVerticalBKgfFactored: number | undefined;
  readonly twoPointLegLengthAM: number | undefined;
  readonly twoPointLegLengthBM: number | undefined;
}

/**
 * Sling force per leg, from the mass, the number of legs and the hang angle.
 *
 * **A two-point pick to a single hook is NOT a free angle at each leg** — the
 * hook sits above the load, so both angles are consequences of the hook
 * height, `β_A = atan(a/h)` and `β_B = atan((L−a)/h)`, and the horizontal
 * components come out equal on both sides by construction. Entering the two
 * angles independently (as an earlier version of this tool did) can produce
 * a pair that is not in horizontal equilibrium at all.
 *
 * **Every force is returned twice: STATIC (no dynamic factor) and FACTORED**
 * — including the load's own weight. An earlier version multiplied the
 * factor into every field, which made the static figure unrecoverable from
 * the result; `dynamicFactor` is also returned exactly as entered so a
 * caller can tell "no factor typed" from "factor 1.0 typed", which two equal
 * numbers cannot.
 */
export function slingForce(input: SlingForceInput): ProResult<SlingForceResult> {
  if (!isPositive(input.massKg) || !isInRange(input.massKg, 0.1, 100000)) return fail("massKg");
  if (!isIntegerIn(input.legs, 1, 4)) return fail("legs");
  if (input.dynamicFactor !== undefined && !isInRange(input.dynamicFactor, 1.0, 5.0)) {
    return fail("dynamicFactor");
  }
  const factor = input.dynamicFactor ?? 1;
  const weightKn = (input.massKg * STANDARD_GRAVITY) / 1000;
  const weightKgf = input.massKg;

  if (input.twoPoint !== undefined) {
    const { spanM, cogFromAM, hookHeightM } = input.twoPoint;
    if (!isPositive(spanM)) return fail("spanM");
    if (!isNonNegative(cogFromAM) || cogFromAM > spanM) return fail("cogFromAM");
    if (!isPositive(hookHeightM)) return fail("hookHeightM");

    const vAKgf = input.massKg * ((spanM - cogFromAM) / spanM);
    const vBKgf = input.massKg * (cogFromAM / spanM);
    const betaA = Math.atan(cogFromAM / hookHeightM);
    const betaB = Math.atan((spanM - cogFromAM) / hookHeightM);
    if (betaA >= Math.PI / 2 || betaB >= Math.PI / 2) return fail("hookHeightM");
    const fAKgf = vAKgf / Math.cos(betaA);
    const fBKgf = vBKgf / Math.cos(betaB);
    const fAKgfFactored = fAKgf * factor;
    const fBKgfFactored = fBKgf * factor;

    let wllRatio: number | undefined;
    if (input.wllPerLeg !== undefined) {
      if (!isPositive(input.wllPerLeg)) return fail("wllPerLeg");
      // Compared against the FACTORED force — the one the leg actually carries.
      const worstKgf = Math.max(fAKgfFactored, fBKgfFactored);
      const worstInUnit = input.wllUnit === "kN" ? (worstKgf * STANDARD_GRAVITY) / 1000 : worstKgf;
      wllRatio = ratioAgainst(worstInUnit, input.wllPerLeg);
    }

    return {
      ok: true,
      weightKn,
      weightKgf,
      weightKnFactored: weightKn * factor,
      weightKgfFactored: weightKgf * factor,
      betaDeg: undefined,
      forceLegKn: undefined,
      forceLegKgf: undefined,
      forceLegKnFactored: undefined,
      forceLegKgfFactored: undefined,
      // Equal on both sides by construction — see the function's own doc comment.
      horizontalKgf: fAKgf * Math.sin(betaA),
      horizontalKgfFactored: fAKgfFactored * Math.sin(betaA),
      verticalKgf: undefined,
      verticalKgfFactored: undefined,
      angleFactor: undefined,
      fourLegShareKgf: undefined,
      fourLegShareKgfFactored: undefined,
      twoLegShareKgf: undefined,
      twoLegShareKgfFactored: undefined,
      legLengthM: undefined,
      dynamicFactor: input.dynamicFactor,
      wllRatio,
      twoPointBetaADeg: betaA * DEG_PER_RAD,
      twoPointBetaBDeg: betaB * DEG_PER_RAD,
      twoPointForceAKgf: fAKgf,
      twoPointForceBKgf: fBKgf,
      twoPointForceAKgfFactored: fAKgfFactored,
      twoPointForceBKgfFactored: fBKgfFactored,
      twoPointVerticalAKgf: vAKgf,
      twoPointVerticalBKgf: vBKgf,
      twoPointVerticalAKgfFactored: vAKgf * factor,
      twoPointVerticalBKgfFactored: vBKgf * factor,
      twoPointLegLengthAM: hookHeightM / Math.cos(betaA),
      twoPointLegLengthBM: hookHeightM / Math.cos(betaB),
    };
  }

  if (input.angleValueDeg === undefined && input.angleMode !== "heightRadius") return fail("angleValueDeg");
  let betaDeg: number;
  let legLengthM: number | undefined;
  if (input.angleMode === "heightRadius") {
    if (!isPositive(input.heightM)) return fail("heightM");
    if (!isNonNegative(input.radiusM)) return fail("radiusM");
    betaDeg = Math.atan(input.radiusM / input.heightM) * DEG_PER_RAD;
    legLengthM = Math.hypot(input.heightM, input.radiusM);
  } else if (input.angleMode === "fromVertical") {
    betaDeg = input.angleValueDeg as number;
  } else if (input.angleMode === "fromHorizontal") {
    betaDeg = 90 - (input.angleValueDeg as number);
  } else {
    betaDeg = (input.angleValueDeg as number) / 2;
  }
  if (!isInRange(betaDeg, 0, 89.999)) return fail("angle");
  const betaRad = betaDeg * RAD_PER_DEG;
  const cosBeta = Math.cos(betaRad);
  const n = input.legs;

  const forceLegKgf = input.massKg / (n * cosBeta);
  const verticalKgf = input.massKg / n;
  const horizontalKgf = forceLegKgf * Math.sin(betaRad);
  const forceLegKgfFactored = forceLegKgf * factor;
  const verticalKgfFactored = verticalKgf * factor;
  const horizontalKgfFactored = horizontalKgf * factor;
  const fourLegShareKgf = n === 4 ? input.massKg / (4 * cosBeta) : undefined;
  const twoLegShareKgf = n === 4 ? input.massKg / (2 * cosBeta) : undefined;

  let wllRatio: number | undefined;
  if (input.wllPerLeg !== undefined) {
    if (!isPositive(input.wllPerLeg)) return fail("wllPerLeg");
    // Compared against the FACTORED force — the one the leg actually carries.
    const inUnit = input.wllUnit === "kN" ? (forceLegKgfFactored * STANDARD_GRAVITY) / 1000 : forceLegKgfFactored;
    wllRatio = ratioAgainst(inUnit, input.wllPerLeg);
  }

  return {
    ok: true,
    weightKn,
    weightKgf,
    weightKnFactored: weightKn * factor,
    weightKgfFactored: weightKgf * factor,
    betaDeg,
    forceLegKn: (forceLegKgf * STANDARD_GRAVITY) / 1000,
    forceLegKgf,
    forceLegKnFactored: (forceLegKgfFactored * STANDARD_GRAVITY) / 1000,
    forceLegKgfFactored,
    horizontalKgf,
    horizontalKgfFactored,
    verticalKgf,
    verticalKgfFactored,
    angleFactor: 1 / cosBeta,
    fourLegShareKgf,
    fourLegShareKgfFactored: fourLegShareKgf === undefined ? undefined : fourLegShareKgf * factor,
    twoLegShareKgf,
    twoLegShareKgfFactored: twoLegShareKgf === undefined ? undefined : twoLegShareKgf * factor,
    legLengthM,
    dynamicFactor: input.dynamicFactor,
    wllRatio,
    twoPointBetaADeg: undefined,
    twoPointBetaBDeg: undefined,
    twoPointForceAKgf: undefined,
    twoPointForceBKgf: undefined,
    twoPointForceAKgfFactored: undefined,
    twoPointForceBKgfFactored: undefined,
    twoPointVerticalAKgf: undefined,
    twoPointVerticalBKgf: undefined,
    twoPointVerticalAKgfFactored: undefined,
    twoPointVerticalBKgfFactored: undefined,
    twoPointLegLengthAM: undefined,
    twoPointLegLengthBM: undefined,
  };
}

/* ---------------------------------------------------------------------------
 * run-of-show — „Satnica događaja"
 * ------------------------------------------------------------------------ */

/**
 * All times are minutes since the run's start-day midnight and MAY exceed
 * 1440 (a run crossing midnight) — this package carries no locale and no
 * clock, so HH:MM / "+1 dan" formatting is entirely the renderer's job.
 *
 * **DST transitions are unmodelled.** The minute axis is a plain count, never
 * a wall-clock lookup — a run crossing 02:00 on the last Sunday in March or
 * the last Sunday in October has every printed minute after the jump off by
 * an hour against the actual wall clock.
 */
export interface RunOfShowItem {
  readonly durationMin: number;
  /**
   * Absolute minutes-since-midnight this item is pinned to. In `"backward"`
   * direction only the LAST item may carry one — see `runOfShow`'s doc comment.
   */
  readonly anchorMin?: number | undefined;
}

export type RunOfShowDirection = "forward" | "backward";

export interface RunOfShowInput {
  readonly startMin: number;
  readonly items: readonly RunOfShowItem[];
  /** Uniform changeover between consecutive items, min. */
  readonly changeoverMin: number;
  readonly curfewMin?: number | undefined;
  readonly direction: RunOfShowDirection;
  /** `"backward"` only: reserve to hold BEFORE the anchored final item, min. */
  readonly bufferBeforeServiceMin?: number | undefined;
}

export interface RunOfShowRow {
  readonly startMin: number;
  readonly endMin: number;
  readonly durationMin: number;
  readonly sharePct: number;
  /** Minutes of dead air before this item — 0 when there is none. */
  readonly gapBeforeMin: number;
  /** Minutes this item's anchor arrived before the previous item could finish — 0 when there is no collision. */
  readonly collisionMin: number;
}

export interface RunOfShowResult {
  readonly rows: readonly RunOfShowRow[];
  readonly totalDurationMin: number;
  readonly totalChangeoverMin: number;
  readonly totalGapMin: number;
  readonly totalCollisionMin: number;
  readonly spanMin: number;
  readonly startMin: number;
  readonly endMin: number;
  readonly curfewRemainingMin: number | undefined;
  /** `"backward"` only: the start the schedule actually needs to hit the anchor. */
  readonly requiredStartMin: number | undefined;
  /** requiredStart − entered start: positive is spare time, negative is a shortfall. */
  readonly slackMin: number | undefined;
}

/**
 * A run-of-show forward from a start time, or backward from a service anchor.
 *
 * **One arithmetic engine, two directions — not two calculators.** Forward
 * builds every row from `startMin`; backward first solves for the start that
 * lands the LAST item (which must carry the only anchor) exactly on its
 * pinned time, including the optional buffer held before it, and THEN builds
 * every row forward from that solved start — which is what makes the two
 * directions share one code path instead of silently disagreeing.
 *
 * **A fixed time earlier than the previous item can finish is a COLLISION,
 * not a quietly-accepted new start.** The item still starts at its anchor —
 * the tool never invents time — but the overlap is its own named quantity
 * rather than a negative number folded into a gap.
 */
export function runOfShow(input: RunOfShowInput): ProResult<RunOfShowResult> {
  const { items } = input;
  if (!isIntegerIn(items.length, 1, 200)) return fail("items");
  if (!isInRange(input.startMin, 0, 1439)) return fail("startMin");
  if (!isNonNegative(input.changeoverMin) || input.changeoverMin > 240) return fail("changeoverMin");
  for (const [i, item] of items.entries()) {
    if (!isPositive(item.durationMin)) return fail(`durationMin:${i}`);
  }

  let effectiveStart = input.startMin;
  let requiredStartMin: number | undefined;
  let slackMin: number | undefined;

  if (input.direction === "backward") {
    for (const [i, item] of items.entries()) {
      const isLast = i === items.length - 1;
      if (isLast && item.anchorMin === undefined) return fail("anchorMin");
      if (!isLast && item.anchorMin !== undefined) return fail(`anchorMin:${i}`);
    }
    const lastItem = items[items.length - 1];
    if (lastItem === undefined) return fail("items");
    const anchor = lastItem.anchorMin as number;
    if (!isInRange(anchor, 0, 1439)) return fail("anchorMin");
    const beforeLast = items.slice(0, -1).reduce((sum, item) => sum + item.durationMin + input.changeoverMin, 0);
    const buffer = input.bufferBeforeServiceMin ?? 0;
    if (!isNonNegative(buffer)) return fail("bufferBeforeServiceMin");
    requiredStartMin = anchor - beforeLast - buffer;
    slackMin = requiredStartMin - input.startMin;
    effectiveStart = requiredStartMin;
  }

  const rows: RunOfShowRow[] = [];
  let cursor = effectiveStart;
  let totalGapMin = 0;
  let totalCollisionMin = 0;
  const totalDurationMin = items.reduce((sum, item) => sum + item.durationMin, 0);

  for (const item of items) {
    let start = cursor;
    let gapBeforeMin = 0;
    let collisionMin = 0;
    // Applies in BOTH directions: in "backward" only the last item ever
    // carries an anchor (validated above), and the buffer folded into
    // `requiredStartMin` is exactly the gap this produces here — one
    // arithmetic path, not two that have to be kept in agreement by hand.
    if (item.anchorMin !== undefined) {
      // An anchor more than 12 h behind the cursor is read as the NEXT day —
      // the continuum a run-of-show actually walks along.
      let anchor = item.anchorMin;
      while (anchor < cursor - 720) anchor += 1440;
      const gap = anchor - cursor;
      if (gap > 0) {
        gapBeforeMin = gap;
        totalGapMin += gap;
      } else if (gap < 0) {
        collisionMin = -gap;
        totalCollisionMin += collisionMin;
      }
      start = anchor;
    }
    const end = start + item.durationMin;
    rows.push({
      startMin: start,
      endMin: end,
      durationMin: item.durationMin,
      sharePct: totalDurationMin > 0 ? (item.durationMin / totalDurationMin) * 100 : 0,
      gapBeforeMin,
      collisionMin,
    });
    cursor = end + input.changeoverMin;
  }

  const totalChangeoverMin = (items.length - 1) * input.changeoverMin;
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  if (firstRow === undefined || lastRow === undefined) return fail("items");

  let curfewRemainingMin: number | undefined;
  if (input.curfewMin !== undefined) {
    if (!isInRange(input.curfewMin, 0, 1439)) return fail("curfewMin");
    let curfew = input.curfewMin;
    while (curfew < lastRow.endMin - 720) curfew += 1440;
    curfewRemainingMin = curfew - lastRow.endMin;
  }

  return {
    ok: true,
    rows,
    totalDurationMin,
    totalChangeoverMin,
    totalGapMin,
    totalCollisionMin,
    spanMin: lastRow.endMin - firstRow.startMin,
    startMin: firstRow.startMin,
    endMin: lastRow.endMin,
    curfewRemainingMin,
    requiredStartMin,
    slackMin,
  };
}

/* ---------------------------------------------------------------------------
 * seating-tables — „Stolovi i raspored"
 * ------------------------------------------------------------------------ */

export type SeatingTable =
  | { readonly kind: "round"; readonly diameterM: number }
  | { readonly kind: "long"; readonly lengthM: number; readonly widthM: number; readonly ends: boolean };

export interface SeatingSpace {
  readonly widthM: number;
  readonly depthM: number;
}

export interface SeatingInput {
  readonly guests: number;
  readonly table: SeatingTable;
  readonly seatWidthM: number;
  readonly clearanceM: number;
  readonly availableAreaM2?: number | undefined;
  readonly availableSpace?: SeatingSpace | undefined;
}

export interface SeatingResult {
  readonly seatsPerTable: number;
  readonly tables: number;
  readonly lastTableGuests: number;
  /**
   * `(D + 2c)²` (or `(L+2c)(W+2c)` for a long table) — a FULL clearance band
   * `c` on all four sides of THIS table alone. Two neighbouring tables are
   * therefore `2c` apart, double the single shared band `c` a person needs to
   * pass between them; see the function's own doc comment.
   */
  readonly cellAreaM2: number;
  readonly totalCellAreaM2: number;
  /** Round tables only — the circular zone of influence, `π(D/2+c)²`. */
  readonly circularFootprintM2: number | undefined;
  readonly totalCircularFootprintM2: number | undefined;
  /** Long tables only: a continuous run's true seat count — ends count only at the TWO FAR ends. */
  readonly continuousSegments: number | undefined;
  readonly continuousLengthM: number | undefined;
  readonly continuousCapacity: number | undefined;
  readonly areaRatio: number | undefined;
  /**
   * From `availableSpace`: tables that fit in a grid, `floor(w/cell) ×
   * floor(d/cell)`, using the same full-band `cellAreaM2` cell — so it
   * inherits that cell's conservatism. A layout that shared the clearance
   * band between two interior tables fits more than this number says.
   */
  readonly gridFitTables: number | undefined;
}

/**
 * Seats per table, table count and footprint for round or long tables.
 *
 * **A continuous banquet run is not `tables × floor(L/s)`.** Butting three
 * 2.20 m tables end to end makes one 6.60 m table, and seating it from the
 * combined length seats one more guest per side than adding up each table's
 * own floor division — the joins are not walls. `floor`/`ceil` here use a
 * small tolerance because 2.40/0.80 is 2.9999999999999996 in IEEE 754.
 *
 * **Every cell gives its table a FULL clearance band `c` on all four sides**
 * (`cellAreaM2` is `(D+2c)²`, or the long-table equivalent) — two neighbouring
 * tables therefore sit `2c` apart, not the single shared band `c` a person
 * actually needs to pass between them. `totalCellAreaM2` and `gridFitTables`
 * are conservative by exactly that double-counted band, not a tight packing;
 * a room laid out with a shared interior band fits more tables than either
 * one reports.
 */
export function seatingTables(input: SeatingInput): ProResult<SeatingResult> {
  const { guests, table } = input;
  if (!isIntegerIn(guests, 1, 5000)) return fail("guests");
  if (!isPositive(input.seatWidthM) || !isInRange(input.seatWidthM, 0.45, 1.0)) return fail("seatWidthM");
  if (!isInRange(input.clearanceM, 0.4, 2.0)) return fail("clearanceM");
  const c = input.clearanceM;

  let seatsPerTable: number;
  let cellAreaM2: number;
  let circularFootprintM2: number | undefined;
  let continuousSegments: number | undefined;
  let continuousLengthM: number | undefined;
  let continuousCapacity: number | undefined;

  if (table.kind === "round") {
    if (!isPositive(table.diameterM) || !isInRange(table.diameterM, 0.8, 3.0)) return fail("diameterM");
    const perimeter = Math.PI * table.diameterM;
    seatsPerTable = floorSnapped(perimeter / input.seatWidthM);
    if (seatsPerTable < 2) return fail("tooFewSeats");
    cellAreaM2 = (table.diameterM + 2 * c) ** 2;
    circularFootprintM2 = Math.PI * (table.diameterM / 2 + c) ** 2;
  } else {
    if (!isPositive(table.lengthM) || !isInRange(table.lengthM, 0.8, 6.0)) return fail("lengthM");
    if (!isPositive(table.widthM) || !isInRange(table.widthM, 0.6, 2.0)) return fail("widthM");
    const perSide = floorSnapped(table.lengthM / input.seatWidthM);
    const endsSeats = table.ends ? 2 * floorSnapped(table.widthM / input.seatWidthM) : 0;
    seatsPerTable = 2 * perSide + endsSeats;
    if (seatsPerTable < 1) return fail("tooFewSeats");
    cellAreaM2 = (table.lengthM + 2 * c) * (table.widthM + 2 * c);

    // Continuous run: both long sides always seated, ends only at the two
    // far ends of the WHOLE run — never re-added at every internal join.
    const neededLength = guests * input.seatWidthM * 0.5;
    continuousSegments = Math.max(1, ceilSnapped(neededLength / table.lengthM));
    continuousLengthM = continuousSegments * table.lengthM;
    continuousCapacity = 2 * floorSnapped(continuousLengthM / input.seatWidthM) + endsSeats;
  }

  const tables = ceilSnapped(guests / seatsPerTable);
  const lastTableGuests = guests - (tables - 1) * seatsPerTable;
  const totalCellAreaM2 = tables * cellAreaM2;
  const totalCircularFootprintM2 = circularFootprintM2 === undefined ? undefined : tables * circularFootprintM2;

  let areaRatio: number | undefined;
  if (input.availableAreaM2 !== undefined) {
    if (!isNonNegative(input.availableAreaM2)) return fail("availableAreaM2");
    areaRatio = input.availableAreaM2 > 0 ? totalCellAreaM2 / input.availableAreaM2 : undefined;
  }

  let gridFitTables: number | undefined;
  if (input.availableSpace !== undefined) {
    if (!isPositive(input.availableSpace.widthM) || !isPositive(input.availableSpace.depthM)) {
      return fail("availableSpace");
    }
    const cellWidth = table.kind === "round" ? table.diameterM + 2 * c : table.lengthM + 2 * c;
    const cellDepth = table.kind === "round" ? table.diameterM + 2 * c : table.widthM + 2 * c;
    gridFitTables =
      floorSnapped(input.availableSpace.widthM / cellWidth) * floorSnapped(input.availableSpace.depthM / cellDepth);
  }

  return {
    ok: true,
    seatsPerTable,
    tables,
    lastTableGuests,
    cellAreaM2,
    totalCellAreaM2,
    circularFootprintM2,
    totalCircularFootprintM2,
    continuousSegments,
    continuousLengthM,
    continuousCapacity,
    areaRatio,
    gridFitTables,
  };
}

/* ---------------------------------------------------------------------------
 * stage-deck-layout — „Bina i podijum"
 * ------------------------------------------------------------------------ */

export type SkirtSides = "all" | "three" | "two" | "none";

export interface StageOrientationResult {
  readonly decksWide: number;
  readonly decksDeep: number;
  readonly decks: number;
  readonly coveredAreaM2: number;
  readonly wasteM2: number;
  readonly wastePct: number;
  readonly legs: number;
  readonly massPerLegKg: number | undefined;
}

export interface StageDeckInput {
  readonly widthM: number;
  readonly depthM: number;
  readonly moduleLengthM: number;
  readonly moduleWidthM: number;
  readonly stageHeightM: number;
  readonly skirtSides: SkirtSides;
  readonly totalMassKg?: number | undefined;
  readonly deckUdlLimitKgM2?: number | undefined;
  readonly occupancyDensityM2PerPerson?: number | undefined;
}

export interface StageDeckResult {
  readonly requiredAreaM2: number;
  readonly perimeterM: number;
  readonly skirtAreaM2: number;
  /** Modules laid one way — named "A", never "the better one". */
  readonly positionA: StageOrientationResult;
  /** Modules laid the other way. Mixed orientation is NOT considered by either. */
  readonly positionB: StageOrientationResult;
  readonly fewerDecksPosition: "A" | "B" | "equal";
  /** `totalMass / (width×depth)` — the NOMINAL stage area, not the (larger) area the decks actually cover. */
  readonly udlKgM2: number | undefined;
  readonly udlRatio: number | undefined;
  readonly occupancyPersons: number | undefined;
}

/**
 * Deck count in both module orientations, skirt area and uniform load.
 *
 * **Neither orientation is called "better"** — a mixed layout can beat both
 * pure orientations (a 7×5 m stage with 2×1 m decks: 20 decks position A, 21
 * position B, but 18 by mixing), so the tool names them A and B and states
 * plainly that mixed layouts are not evaluated. The load figure divides by
 * the NOMINAL stage area (`width × depth`), not the larger area the deck
 * grid actually covers — a defensible choice, but the field name says which.
 */
export function stageDeckLayout(input: StageDeckInput): ProResult<StageDeckResult> {
  if (!isInRange(input.widthM, 0.5, 100)) return fail("widthM");
  if (!isInRange(input.depthM, 0.5, 100)) return fail("depthM");
  if (!isPositive(input.moduleLengthM) || !isInRange(input.moduleLengthM, 0.5, 4.0)) {
    return fail("moduleLengthM");
  }
  if (!isPositive(input.moduleWidthM) || !isInRange(input.moduleWidthM, 0.5, 4.0)) {
    return fail("moduleWidthM");
  }
  if (!isInRange(input.stageHeightM, 0.1, 3.0)) return fail("stageHeightM");
  if (input.totalMassKg !== undefined && !isNonNegative(input.totalMassKg)) return fail("totalMassKg");

  const requiredAreaM2 = input.widthM * input.depthM;
  const perimeterM = 2 * (input.widthM + input.depthM);

  const orient = (moduleLen: number, moduleWid: number): StageOrientationResult => {
    const decksWide = ceilSnapped(input.widthM / moduleLen);
    const decksDeep = ceilSnapped(input.depthM / moduleWid);
    const decks = decksWide * decksDeep;
    const coveredAreaM2 = decksWide * moduleLen * decksDeep * moduleWid;
    const wasteM2 = coveredAreaM2 - requiredAreaM2;
    const legs = (decksWide + 1) * (decksDeep + 1);
    return {
      decksWide,
      decksDeep,
      decks,
      coveredAreaM2,
      wasteM2,
      wastePct: (wasteM2 / requiredAreaM2) * 100,
      legs,
      massPerLegKg: input.totalMassKg === undefined ? undefined : input.totalMassKg / legs,
    };
  };

  const positionA = orient(input.moduleLengthM, input.moduleWidthM);
  const positionB = orient(input.moduleWidthM, input.moduleLengthM);

  const skirtLength =
    input.skirtSides === "all"
      ? 2 * (input.widthM + input.depthM)
      : input.skirtSides === "three"
        ? input.widthM + 2 * input.depthM
        : input.skirtSides === "two"
          ? 2 * input.depthM
          : 0;

  let udlKgM2: number | undefined;
  let udlRatio: number | undefined;
  if (input.totalMassKg !== undefined) {
    udlKgM2 = input.totalMassKg / requiredAreaM2;
    if (input.deckUdlLimitKgM2 !== undefined) {
      if (!isPositive(input.deckUdlLimitKgM2)) return fail("deckUdlLimitKgM2");
      udlRatio = ratioAgainst(udlKgM2, input.deckUdlLimitKgM2);
    }
  }

  let occupancyPersons: number | undefined;
  if (input.occupancyDensityM2PerPerson !== undefined) {
    if (!isPositive(input.occupancyDensityM2PerPerson)) return fail("occupancyDensityM2PerPerson");
    occupancyPersons = floorSnapped(requiredAreaM2 / input.occupancyDensityM2PerPerson);
  }

  return {
    ok: true,
    requiredAreaM2,
    perimeterM,
    skirtAreaM2: skirtLength * input.stageHeightM,
    positionA,
    positionB,
    fewerDecksPosition: positionA.decks < positionB.decks ? "A" : positionA.decks > positionB.decks ? "B" : "equal",
    udlKgM2,
    udlRatio,
    occupancyPersons,
  };
}

/* ---------------------------------------------------------------------------
 * tent-bay-layout — „Veličina šatora"
 * ------------------------------------------------------------------------ */

export type TentSides = "all" | "noEnds" | "none";

export interface TentBayInput {
  readonly requiredAreaM2?: number | undefined;
  readonly requiredLengthM?: number | undefined;
  readonly widthM: number;
  readonly bayLengthM: number;
  readonly eaveHeightM: number;
  readonly roofPitchDeg: number;
  readonly marginM: number;
  readonly sides: TentSides;
  /** Head height the user actually needs somewhere under the pitched roof, m. */
  readonly requiredHeadHeightM?: number | undefined;
}

export interface TentBayResult {
  readonly bays: number;
  readonly lengthM: number;
  readonly areaM2: number;
  /** Only when sized from `requiredAreaM2`. */
  readonly wasteM2: number | undefined;
  readonly wastePct: number | undefined;
  /** Only when sized from `requiredLengthM`: achieved minus requested, m. */
  readonly lengthDiffM: number | undefined;
  readonly footprintWidthM: number;
  readonly footprintLengthM: number;
  readonly footprintAreaM2: number;
  readonly tentPerimeterM: number;
  readonly footprintPerimeterM: number;
  readonly ridgeRiseM: number;
  readonly ridgeHeightM: number;
  readonly roofAreaM2: number;
  readonly sideWallAreaM2: number;
  readonly gableEndsAreaM2: number;
  /** Geometric NET area — no seam overlap, no door openings. Not an order quantity. */
  readonly totalSheetingM2: number;
  readonly legs: number;
  /** Usable width at `requiredHeadHeightM`, under the sloped roof — undefined without that input. */
  readonly usableWidthAtHeadHeightM: number | undefined;
}

/**
 * Bay count, footprint and sheeting area for a gable tent.
 *
 * **The two sizing directions are not symmetric.** Sizing from a required
 * AREA reports waste against that area; sizing from a required LENGTH has no
 * area to compare against, so it reports the length difference instead —
 * dividing by an area that was never given would be a silent divide by zero.
 */
export function tentBayLayout(input: TentBayInput): ProResult<TentBayResult> {
  const hasArea = input.requiredAreaM2 !== undefined;
  const hasLength = input.requiredLengthM !== undefined;
  if (hasArea === hasLength) return fail("requiredAreaM2");
  if (!isInRange(input.widthM, 3, 60)) return fail("widthM");
  if (!isPositive(input.bayLengthM) || !isInRange(input.bayLengthM, 1, 10)) return fail("bayLengthM");
  if (!isInRange(input.eaveHeightM, 1.5, 8)) return fail("eaveHeightM");
  if (!isInRange(input.roofPitchDeg, 5, 45)) return fail("roofPitchDeg");
  if (!isNonNegative(input.marginM)) return fail("marginM");

  let bays: number;
  let wasteM2: number | undefined;
  let wastePct: number | undefined;
  let lengthDiffM: number | undefined;
  if (hasArea) {
    if (!isPositive(input.requiredAreaM2)) return fail("requiredAreaM2");
    bays = ceilSnapped(input.requiredAreaM2 / (input.widthM * input.bayLengthM));
  } else {
    if (!isPositive(input.requiredLengthM)) return fail("requiredLengthM");
    bays = ceilSnapped(input.requiredLengthM / input.bayLengthM);
  }
  const lengthM = bays * input.bayLengthM;
  const areaM2 = input.widthM * lengthM;
  if (hasArea) {
    wasteM2 = areaM2 - (input.requiredAreaM2 as number);
    wastePct = (wasteM2 / (input.requiredAreaM2 as number)) * 100;
  } else {
    lengthDiffM = lengthM - (input.requiredLengthM as number);
  }

  const footprintWidthM = input.widthM + 2 * input.marginM;
  const footprintLengthM = lengthM + 2 * input.marginM;

  const pitchRad = input.roofPitchDeg * RAD_PER_DEG;
  const ridgeRiseM = (input.widthM / 2) * Math.tan(pitchRad);
  const ridgeHeightM = input.eaveHeightM + ridgeRiseM;
  const roofAreaM2 = (input.widthM * lengthM) / Math.cos(pitchRad);
  const sideWallAreaM2 = 2 * lengthM * input.eaveHeightM;
  const gableEndsAreaM2 = 2 * (input.widthM * input.eaveHeightM + (input.widthM * ridgeRiseM) / 2);

  const totalSheetingM2 =
    roofAreaM2 +
    (input.sides === "none" ? 0 : sideWallAreaM2) +
    (input.sides === "all" ? gableEndsAreaM2 : 0);

  let usableWidthAtHeadHeightM: number | undefined;
  if (input.requiredHeadHeightM !== undefined) {
    if (!isPositive(input.requiredHeadHeightM) || input.requiredHeadHeightM >= ridgeHeightM) {
      return fail("requiredHeadHeightM");
    }
    usableWidthAtHeadHeightM =
      input.requiredHeadHeightM <= input.eaveHeightM
        ? input.widthM
        : input.widthM - (2 * (input.requiredHeadHeightM - input.eaveHeightM)) / Math.tan(pitchRad);
  }

  return {
    ok: true,
    bays,
    lengthM,
    areaM2,
    wasteM2,
    wastePct,
    lengthDiffM,
    footprintWidthM,
    footprintLengthM,
    footprintAreaM2: footprintWidthM * footprintLengthM,
    tentPerimeterM: 2 * (input.widthM + lengthM),
    footprintPerimeterM: 2 * (footprintWidthM + footprintLengthM),
    ridgeRiseM,
    ridgeHeightM,
    roofAreaM2,
    sideWallAreaM2,
    gableEndsAreaM2,
    totalSheetingM2,
    legs: 2 * (bays + 1),
    usableWidthAtHeadHeightM,
  };
}

/* ---------------------------------------------------------------------------
 * three-phase-load-balance — „Balans faza"
 * ------------------------------------------------------------------------ */

export type PhaseConnection = "L1" | "L2" | "L3" | "three-phase" | "L1L2" | "L2L3" | "L3L1";

export interface ThreePhaseConsumer {
  readonly kw: number;
  readonly cosPhi: number;
  readonly connection: PhaseConnection;
  readonly simultaneityPct?: number | undefined;
}

export interface ThreePhaseLoadBalanceInput {
  readonly lineVoltage?: number | undefined;
  /** Direct line-to-neutral voltage for a genuinely single-phase installation — overrides `lineVoltage/√3`. */
  readonly phaseVoltage?: number | undefined;
  readonly consumers: readonly ThreePhaseConsumer[];
  readonly ratedBreakerA?: number | undefined;
}

export interface ThreePhasePhaseResult {
  readonly activeKw: number;
  readonly reactiveKvar: number;
  readonly apparentKva: number;
  readonly currentA: number;
  readonly breakerRatio: number | undefined;
}

export interface ThreePhaseLoadBalanceResult {
  readonly phases: readonly [ThreePhasePhaseResult, ThreePhasePhaseResult, ThreePhasePhaseResult];
  readonly totalActiveKw: number;
  readonly totalReactiveKvar: number;
  /** Vector total, `√(P²+Q²)` — the whole system's apparent power. */
  readonly totalApparentKva: number;
  /** Σ Sₖ — the sum of the three PHASE apparent powers, always ≥ `totalApparentKva`. */
  readonly sumPhaseApparentKva: number;
  readonly threeTimesMaxPhaseKva: number;
  /** `undefined` when the total apparent power is 0 — a power factor of nothing is not defined. */
  readonly powerFactor: number | undefined;
  readonly neutralCurrentA: number;
  readonly avgCurrentA: number;
  /** `undefined` when the average current is 0 — an imbalance ratio against nothing is not defined. */
  readonly imbalancePct: number | undefined;
}

/** Phase reference angles for L1/L2/L3, 120° apart. */
const PHASE_ANGLES = [0, (-2 * Math.PI) / 3, (2 * Math.PI) / 3] as const;
const PHASE_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 0],
];

/**
 * Per-phase load, neutral current and imbalance for a set of single-,
 * three-phase and phase-to-phase consumers.
 *
 * **Every consumer becomes a CURRENT PHASOR first**, summed per phase in
 * rectangular form, and P/Q/S/imbalance are all derived from that sum
 * afterwards. A phase-to-phase load (say L1–L2) does not draw through the
 * neutral at all for its own loop — its current phasor is added to L1 and
 * subtracted from L2 at the correct ±30° angle relative to their line-line
 * voltage — so treating it as a single-phase load on one phase, as an
 * earlier version of this tool did, is wrong on BOTH magnitude (missing the
 * √3) and angle (missing the 30°). The neutral current then falls out as
 * `|I_L1 + I_L2 + I_L3|` with no separate formula to keep in sync.
 */
export function threePhaseLoadBalance(
  input: ThreePhaseLoadBalanceInput,
): ProResult<ThreePhaseLoadBalanceResult> {
  const { consumers } = input;
  if (consumers.length === 0) return fail("consumers");
  const lineVoltage = input.lineVoltage ?? 400;
  if (!isInRange(lineVoltage, 100, 1000)) return fail("lineVoltage");
  if (input.phaseVoltage !== undefined && !isInRange(input.phaseVoltage, 60, 600)) return fail("phaseVoltage");
  const isolatedSinglePhase = input.phaseVoltage !== undefined;
  const uLn = input.phaseVoltage ?? lineVoltage / SQRT3;
  const uLl = SQRT3 * uLn;
  if (input.ratedBreakerA !== undefined && !isInRange(input.ratedBreakerA, 1, 630)) {
    return fail("ratedBreakerA");
  }

  const currentRe = [0, 0, 0];
  const currentIm = [0, 0, 0];
  for (const [i, c] of consumers.entries()) {
    if (!isPositive(c.kw)) return fail(`kw:${i}`);
    // Signed: a NEGATIVE cosPhi is a LEADING load (LED drivers, filter
    // banks) — its current phasor leads the voltage instead of lagging it,
    // which flips the sign of the phase angle below but leaves the apparent
    // power magnitude, taken from |cosPhi|, exactly as it would be lagging.
    const mag = Math.abs(c.cosPhi);
    if (!isInRange(mag, 0.1, 1.0)) return fail(`cosPhi:${i}`);
    const simultaneity = c.simultaneityPct ?? 100;
    if (!isInRange(simultaneity, 0, 100)) return fail(`simultaneityPct:${i}`);
    if (isolatedSinglePhase && c.connection !== "L1") return fail(`connection:${i}`);

    const p = c.kw * (simultaneity / 100);
    // VA, not kVA: `magnitude` below is divided only by a VOLTAGE to become a
    // current, so the power fed into it has to already be in watts.
    const s = (p * 1000) / mag;
    const phi = Math.sign(c.cosPhi) * Math.acos(mag);

    const addAt = (angle: number, magnitude: number, phaseIndex: number): void => {
      currentRe[phaseIndex] = (currentRe[phaseIndex] ?? 0) + magnitude * Math.cos(angle);
      currentIm[phaseIndex] = (currentIm[phaseIndex] ?? 0) + magnitude * Math.sin(angle);
    };

    if (c.connection === "three-phase") {
      const perPhaseMag = s / 3 / uLn;
      for (let k = 0; k < 3; k += 1) addAt((PHASE_ANGLES[k] ?? 0) - phi, perPhaseMag, k);
    } else if (c.connection === "L1" || c.connection === "L2" || c.connection === "L3") {
      const k = c.connection === "L1" ? 0 : c.connection === "L2" ? 1 : 2;
      addAt((PHASE_ANGLES[k] ?? 0) - phi, s / uLn, k);
    } else {
      const pairIndex = c.connection === "L1L2" ? 0 : c.connection === "L2L3" ? 1 : 2;
      const pair = PHASE_PAIRS[pairIndex];
      if (pair === undefined) return fail(`connection:${i}`);
      const [a, b] = pair;
      const thetaA = PHASE_ANGLES[a] ?? 0;
      const iAb = s / uLl;
      const angle = thetaA + Math.PI / 6 - phi;
      addAt(angle, iAb, a);
      addAt(angle + Math.PI, iAb, b);
    }
  }

  const phaseResults: ThreePhasePhaseResult[] = [];
  const apparentPerPhase: number[] = [];
  for (let k = 0; k < 3; k += 1) {
    const re = currentRe[k] ?? 0;
    const im = currentIm[k] ?? 0;
    const theta = PHASE_ANGLES[k] ?? 0;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    // Rotate the current into this phase's own reference frame (its voltage
    // at angle 0) to read off P and Q for THAT phase.
    const activeKw = (uLn * (re * cosT + im * sinT)) / 1000;
    const reactiveKvar = (uLn * (re * sinT - im * cosT)) / 1000;
    const currentA = Math.hypot(re, im);
    const apparentKva = (uLn * currentA) / 1000;
    apparentPerPhase.push(apparentKva);
    phaseResults.push({
      activeKw,
      reactiveKvar,
      apparentKva,
      currentA,
      breakerRatio: ratioAgainst(currentA, input.ratedBreakerA),
    });
  }
  const p0 = phaseResults[0];
  const p1 = phaseResults[1];
  const p2 = phaseResults[2];
  if (p0 === undefined || p1 === undefined || p2 === undefined) return fail("phases");
  const phases: readonly [ThreePhasePhaseResult, ThreePhasePhaseResult, ThreePhasePhaseResult] = [p0, p1, p2];

  const totalActiveKw = phaseResults.reduce((sum, p) => sum + p.activeKw, 0);
  const totalReactiveKvar = phaseResults.reduce((sum, p) => sum + p.reactiveKvar, 0);
  const totalApparentKva = Math.hypot(totalActiveKw, totalReactiveKvar);
  const sumPhaseApparentKva = apparentPerPhase.reduce((sum, s) => sum + s, 0);
  const threeTimesMaxPhaseKva = 3 * Math.max(...apparentPerPhase);
  const powerFactor = totalApparentKva === 0 ? undefined : totalActiveKw / totalApparentKva;

  const sumRe = (currentRe[0] ?? 0) + (currentRe[1] ?? 0) + (currentRe[2] ?? 0);
  const sumIm = (currentIm[0] ?? 0) + (currentIm[1] ?? 0) + (currentIm[2] ?? 0);
  let neutralCurrentA = Math.hypot(sumRe, sumIm);
  if (neutralCurrentA < 1e-9) neutralCurrentA = 0;

  const currents = phaseResults.map((p) => p.currentA);
  const avgCurrentA = currents.reduce((sum, i) => sum + i, 0) / 3;
  const imbalancePct =
    avgCurrentA > 0 ? (Math.max(...currents.map((i) => Math.abs(i - avgCurrentA))) / avgCurrentA) * 100 : undefined;

  return {
    ok: true,
    phases,
    totalActiveKw,
    totalReactiveKvar,
    totalApparentKva,
    sumPhaseApparentKva,
    threeTimesMaxPhaseKva,
    powerFactor,
    neutralCurrentA,
    avgCurrentA,
    imbalancePct,
  };
}

/* ---------------------------------------------------------------------------
 * truss-hoist-reactions — „Opterećenje trase i motora"
 * ------------------------------------------------------------------------ */

export interface TrussPointLoad {
  readonly massKg: number;
  readonly positionM: number;
}

export interface TrussHoistInput {
  readonly lengthM: number;
  readonly selfWeightKgPerM: number;
  readonly pointAM: number;
  readonly pointBM: number;
  readonly loads: readonly TrussPointLoad[];
  readonly extraDistributedKgPerM?: number | undefined;
  readonly hoistCapacityAKg?: number | undefined;
  readonly hoistCapacityBKg?: number | undefined;
  /** A bridle angle to report leg tension at each hoist, ° from vertical. */
  readonly slingAngleDeg?: number | undefined;
}

export interface TrussHoistResult {
  readonly totalMassKg: number;
  readonly pointMassKg: number;
  readonly distributedMassKg: number;
  readonly reactionAKg: number;
  readonly reactionBKg: number;
  readonly reactionAKn: number;
  readonly reactionBKn: number;
  readonly cogPositionM: number;
  /** Should be ~0 — `M·(x_cg−x_A) − R_B·(x_B−x_A)`, the arithmetic self-check. */
  readonly checkResidual: number;
  readonly swappedSupports: boolean;
  readonly maxMomentKgM: number;
  readonly maxMomentPositionM: number;
  readonly shearAtAKg: number;
  readonly shearAtBKg: number;
  /** `8·M_max / span²` — the load a manufacturer's table would index this span against. */
  readonly equivalentUdlKgM: number;
  readonly ratioA: number | undefined;
  readonly ratioB: number | undefined;
  readonly legTensionAKg: number | undefined;
  readonly legTensionBKg: number | undefined;
}

/**
 * Support reactions, centre of gravity and the bending-moment envelope for a
 * truss hung at two points.
 *
 * **Three or more hang points are refused, not approximated** — a truss on
 * three supports is statically indeterminate and this tool solves nothing
 * beyond statics. The moment envelope is exact, not sampled: `M(x)` is
 * piecewise quadratic (a constant self-weight run between any two point
 * loads/supports), so between every pair of consecutive load/support
 * positions the shear is linear and its zero, if inside that span, is found
 * algebraically rather than by scanning a grid.
 */
export function trussHoistReactions(input: TrussHoistInput): ProResult<TrussHoistResult> {
  if (!isPositive(input.lengthM)) return fail("lengthM");
  const L = input.lengthM;
  if (!isNonNegative(input.selfWeightKgPerM)) return fail("selfWeightKgPerM");
  if (!isInRange(input.pointAM, 0, L)) return fail("pointAM");
  if (!isInRange(input.pointBM, 0, L)) return fail("pointBM");
  const extra = input.extraDistributedKgPerM ?? 0;
  if (!isNonNegative(extra)) return fail("extraDistributedKgPerM");
  for (const [i, load] of input.loads.entries()) {
    if (!isPositive(load.massKg)) return fail(`massKg:${i}`);
    if (!isInRange(load.positionM, 0, L)) return fail(`positionM:${i}`);
  }

  let xA = input.pointAM;
  let xB = input.pointBM;
  const swappedSupports = xA > xB;
  if (swappedSupports) [xA, xB] = [xB, xA];
  if (xB - xA <= 0) return fail("pointAM");

  const pointMassKg = input.loads.reduce((sum, l) => sum + l.massKg, 0);
  const wTotal = input.selfWeightKgPerM + extra;
  const distributedMassKg = wTotal * L;
  const totalMassKg = pointMassKg + distributedMassKg;
  if (totalMassKg <= 0) return fail("noLoad");

  const momentAboutA =
    input.loads.reduce((sum, l) => sum + l.massKg * (l.positionM - xA), 0) + distributedMassKg * (L / 2 - xA);
  const reactionBKg = momentAboutA / (xB - xA);
  const reactionAKg = totalMassKg - reactionBKg;

  const cogPositionM =
    (input.loads.reduce((sum, l) => sum + l.massKg * l.positionM, 0) + distributedMassKg * (L / 2)) / totalMassKg;
  const checkResidual = totalMassKg * (cogPositionM - xA) - reactionBKg * (xB - xA);

  // M(x): moments of everything to the LEFT of x, sagging positive — upward
  // reactions add, downward point loads and the self-weight run subtract.
  const momentAt = (x: number): number =>
    reactionAKg * Math.max(0, x - xA) +
    reactionBKg * Math.max(0, x - xB) -
    input.loads.reduce((sum, l) => sum + l.massKg * Math.max(0, x - l.positionM), 0) -
    (wTotal * x * x) / 2;
  const shearAt = (x: number, side: "left" | "right"): number => {
    const eps = 1e-6;
    const at = side === "right" ? x + eps : x - eps;
    return (
      reactionAKg * (at >= xA ? 1 : 0) +
      reactionBKg * (at >= xB ? 1 : 0) -
      input.loads.reduce((sum, l) => sum + (at >= l.positionM ? l.massKg : 0), 0) -
      wTotal * at
    );
  };

  const kinks = Array.from(new Set([0, xA, xB, L, ...input.loads.map((l) => l.positionM)])).sort((a, b) => a - b);
  const candidates = [...kinks];
  if (wTotal > 0) {
    for (let i = 0; i + 1 < kinks.length; i += 1) {
      const left = kinks[i];
      const right = kinks[i + 1];
      if (left === undefined || right === undefined) continue;
      const v0 = shearAt(left, "right");
      const x0 = left + v0 / wTotal;
      if (x0 > left && x0 < right) candidates.push(x0);
    }
  }

  let maxMomentKgM = 0;
  let maxMomentPositionM = 0;
  for (const x of candidates) {
    const m = momentAt(x);
    if (Math.abs(m) > Math.abs(maxMomentKgM)) {
      maxMomentKgM = m;
      maxMomentPositionM = x;
    }
  }

  const span = xB - xA;
  const equivalentUdlKgM = (8 * Math.abs(maxMomentKgM)) / span ** 2;

  let legTensionAKg: number | undefined;
  let legTensionBKg: number | undefined;
  if (input.slingAngleDeg !== undefined) {
    if (!isInRange(input.slingAngleDeg, 0, 89)) return fail("slingAngleDeg");
    const cosB = Math.cos(input.slingAngleDeg * RAD_PER_DEG);
    legTensionAKg = Math.abs(reactionAKg) / cosB;
    legTensionBKg = Math.abs(reactionBKg) / cosB;
  }

  return {
    ok: true,
    totalMassKg,
    pointMassKg,
    distributedMassKg,
    reactionAKg,
    reactionBKg,
    reactionAKn: (reactionAKg * STANDARD_GRAVITY) / 1000,
    reactionBKn: (reactionBKg * STANDARD_GRAVITY) / 1000,
    cogPositionM,
    checkResidual,
    swappedSupports,
    maxMomentKgM,
    maxMomentPositionM,
    shearAtAKg: shearAt(xA, "right"),
    shearAtBKg: shearAt(xB, "left"),
    equivalentUdlKgM,
    ratioA: input.hoistCapacityAKg === undefined ? undefined : ratioAgainst(Math.abs(reactionAKg), input.hoistCapacityAKg),
    ratioB: input.hoistCapacityBKg === undefined ? undefined : ratioAgainst(Math.abs(reactionBKg), input.hoistCapacityBKg),
    legTensionAKg,
    legTensionBKg,
  };
}

/* ---------------------------------------------------------------------------
 * venue-occupancy-area — „Kapacitet prostora"
 * ------------------------------------------------------------------------ */

export type LayoutBasis = "gross" | "net";

export interface VenueLayoutRow {
  readonly densityM2PerPerson: number;
  readonly basis: LayoutBasis;
  readonly documentedCount?: number | undefined;
}

export interface VenueOccupancyInput {
  readonly grossAreaM2: number;
  readonly deductedZonesM2?: readonly number[] | undefined;
  readonly deductPct?: number | undefined;
  readonly layouts: readonly VenueLayoutRow[];
  readonly guests?: number | undefined;
}

export interface VenueLayoutResult {
  readonly areaUsedM2: number;
  readonly persons: number;
  readonly documentedRatio: number | undefined;
  readonly documentedDiff: number | undefined;
  /** Only with `guests`: `areaUsed − guests × density`, signed — spare (+) or short (−). */
  readonly requiredAreaDiffM2: number | undefined;
}

export interface VenueOccupancyResult {
  readonly netAreaM2: number;
  readonly deductedAreaM2: number;
  readonly layouts: readonly VenueLayoutResult[];
  readonly areaPerGuestM2: number | undefined;
}

/**
 * Net area and the person count each named layout allows at its OWN density.
 *
 * **The tool never sums densities and never picks a layout** — every row is
 * the user's own name and own density, applied to gross or net area exactly
 * as that row says. `floor` uses a tolerance because 9.60/0.80 is
 * 11.999999999999998 in IEEE 754 — a whole person short on an input that was
 * entered perfectly round.
 */
export function venueOccupancyArea(input: VenueOccupancyInput): ProResult<VenueOccupancyResult> {
  if (!isInRange(input.grossAreaM2, 1, 100000)) return fail("grossAreaM2");
  const hasZones = input.deductedZonesM2 !== undefined;
  const hasPct = input.deductPct !== undefined;
  if (hasZones && hasPct) return fail("deduction");
  if (input.layouts.length === 0) return fail("layouts");
  if (input.guests !== undefined && !isPositive(input.guests)) return fail("guests");

  let deductedAreaM2 = 0;
  if (hasZones) {
    for (const [i, z] of (input.deductedZonesM2 as readonly number[]).entries()) {
      if (!isNonNegative(z)) return fail(`deductedZonesM2:${i}`);
      deductedAreaM2 += z;
    }
  } else if (hasPct) {
    if (!isInRange(input.deductPct as number, 0, 90)) return fail("deductPct");
    deductedAreaM2 = input.grossAreaM2 * ((input.deductPct as number) / 100);
  }

  const netAreaM2 = input.grossAreaM2 - deductedAreaM2;
  if (netAreaM2 <= 0) return fail("netAreaM2");

  const layouts: VenueLayoutResult[] = [];
  for (const [i, row] of input.layouts.entries()) {
    if (!isPositive(row.densityM2PerPerson)) return fail(`densityM2PerPerson:${i}`);
    const areaUsedM2 = row.basis === "gross" ? input.grossAreaM2 : netAreaM2;
    const persons = floorSnapped(areaUsedM2 / row.densityM2PerPerson);
    let documentedRatio: number | undefined;
    let documentedDiff: number | undefined;
    if (row.documentedCount !== undefined) {
      if (!isPositive(row.documentedCount)) return fail(`documentedCount:${i}`);
      documentedRatio = persons / row.documentedCount;
      documentedDiff = persons - row.documentedCount;
    }
    const requiredAreaDiffM2 =
      input.guests === undefined ? undefined : areaUsedM2 - input.guests * row.densityM2PerPerson;
    layouts.push({ areaUsedM2, persons, documentedRatio, documentedDiff, requiredAreaDiffM2 });
  }

  return {
    ok: true,
    netAreaM2,
    deductedAreaM2,
    layouts,
    areaPerGuestM2: input.guests === undefined ? undefined : netAreaM2 / input.guests,
  };
}

/* ---------------------------------------------------------------------------
 * voltage-drop — „Pad napona na vodu"
 * ------------------------------------------------------------------------ */

/** Resistivity of annealed copper at 20 °C, Ω·mm²/m — IEC 60228 / IEC 60287-1-1 (1/58). */
const RESISTIVITY_COPPER_20C = 0.017241;
/** Resistivity of aluminium at 20 °C, Ω·mm²/m — IEC 60228 / IEC 60287-1-1 (1/35.38). */
const RESISTIVITY_ALUMINIUM_20C = 0.028264;
/** Temperature coefficient of copper at 20 °C, 1/K — IEC 60287-1-1. */
const TEMP_COEFF_COPPER = 0.00393;
/** Temperature coefficient of aluminium at 20 °C, 1/K — IEC 60287-1-1. */
const TEMP_COEFF_ALUMINIUM = 0.00403;
/** IEC 60228 standard conductor cross-sections, mm² — the series this tool selects from and stops at. */
const STANDARD_SECTIONS_MM2 = [
  0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000,
] as const;

export type VoltageDropSystem = "dc" | "single-phase" | "three-phase";
export type ConductorMaterial = "copper" | "aluminium";

export interface VoltageDropInput {
  readonly system: VoltageDropSystem;
  readonly material: ConductorMaterial;
  /** Forward mode: the installed cross-section, mm². Omit when solving for one instead. */
  readonly crossSectionMm2?: number | undefined;
  readonly lengthM: number;
  readonly currentA: number;
  readonly nominalVoltage?: number | undefined;
  readonly conductorTempC?: number | undefined;
  /** The user's own limit — doubles as the TARGET when `solveForSection` is true. No default, ever. */
  readonly dropLimitPct?: number | undefined;
  /** From the cable's own datasheet — bypasses ρ(θ) entirely (stranding lay, tolerance, plating). */
  readonly customResistanceOhmPerKm?: number | undefined;
  readonly solveForSection?: boolean | undefined;
}

export interface VoltageDropResult {
  readonly resistanceOhm: number;
  readonly dropVolts: number;
  /** Three-phase only: the SAME drop, per phase (`÷√3`) — the figure most often misread. */
  readonly dropVoltsPerPhase: number | undefined;
  readonly dropPct: number | undefined;
  readonly farEndVoltage: number | undefined;
  readonly powerLossW: number;
  readonly dropRatio: number | undefined;
  /** Reverse mode: the exact minimum section for `dropLimitPct`, uncatalogued. */
  readonly requiredSectionMm2: number | undefined;
  /** Reverse mode: the smallest IEC 60228 size ≥ `requiredSectionMm2` — undefined past 1000 mm². */
  readonly selectedStandardSectionMm2: number | undefined;
  readonly achievedDropPctAtSelected: number | undefined;
}

/**
 * Conductor resistance and voltage drop, forward from a cross-section or
 * solved backward from a target drop percentage.
 *
 * **Three-phase `dropVolts` is the LINE-TO-LINE figure** — `dropVoltsPerPhase`
 * (`÷√3`) is printed alongside because reading the wrong one against a
 * per-phase limit is the most common mistake with this formula. A
 * `customResistanceOhmPerKm` from the cable's own datasheet bypasses ρ(θ)
 * entirely — the nominal IEC 60228 resistance is systematically lower than
 * what a real stranded conductor measures.
 */
export function voltageDrop(input: VoltageDropInput): ProResult<VoltageDropResult> {
  if (!isPositive(input.lengthM) || !isInRange(input.lengthM, 0.1, 5000)) return fail("lengthM");
  if (!isPositive(input.currentA) || !isInRange(input.currentA, 0.01, 2000)) return fail("currentA");
  const temp = input.conductorTempC ?? 20;
  if (!isInRange(temp, -20, 120)) return fail("conductorTempC");
  if (input.nominalVoltage !== undefined && !isInRange(input.nominalVoltage, 12, 1000)) {
    return fail("nominalVoltage");
  }
  if (input.dropLimitPct !== undefined && !isInRange(input.dropLimitPct, 0.1, 20)) return fail("dropLimitPct");

  const rho20 = input.material === "copper" ? RESISTIVITY_COPPER_20C : RESISTIVITY_ALUMINIUM_20C;
  const alpha = input.material === "copper" ? TEMP_COEFF_COPPER : TEMP_COEFF_ALUMINIUM;
  const rhoTheta = rho20 * (1 + alpha * (temp - 20));
  const threePhase = input.system === "three-phase";

  const resistancePerMetreOf = (sectionMm2: number): number =>
    input.customResistanceOhmPerKm !== undefined
      ? input.customResistanceOhmPerKm / 1000
      : rhoTheta / sectionMm2;

  const dropFromR1 = (r1: number): number => (threePhase ? SQRT3 * input.currentA * r1 : 2 * input.currentA * r1);
  const lossFromR1 = (r1: number): number =>
    threePhase ? 3 * input.currentA ** 2 * r1 : input.currentA ** 2 * (2 * r1);

  if (input.solveForSection === true) {
    if (input.dropLimitPct === undefined) return fail("dropLimitPct");
    if (!isPositive(input.nominalVoltage)) return fail("nominalVoltage");
    const targetDropVolts = (input.dropLimitPct / 100) * input.nominalVoltage;
    const r1Target = threePhase ? targetDropVolts / (SQRT3 * input.currentA) : targetDropVolts / (2 * input.currentA);
    if (!isPositive(r1Target)) return fail("dropLimitPct");
    const requiredSectionMm2 =
      input.customResistanceOhmPerKm !== undefined
        ? undefined
        : rhoTheta * (input.lengthM / r1Target);
    if (requiredSectionMm2 === undefined) return fail("customResistanceOhmPerKm");

    const selected = STANDARD_SECTIONS_MM2.find((s) => s >= requiredSectionMm2);
    let achievedDropPctAtSelected: number | undefined;
    let r1Used = resistancePerMetreOf(requiredSectionMm2) * input.lengthM;
    let dropVolts = dropFromR1(r1Used);
    if (selected !== undefined) {
      r1Used = resistancePerMetreOf(selected) * input.lengthM;
      dropVolts = dropFromR1(r1Used);
      achievedDropPctAtSelected = (dropVolts / input.nominalVoltage) * 100;
    }
    return {
      ok: true,
      resistanceOhm: threePhase ? r1Used : 2 * r1Used,
      dropVolts,
      dropVoltsPerPhase: threePhase ? dropVolts / SQRT3 : undefined,
      dropPct: (dropVolts / input.nominalVoltage) * 100,
      farEndVoltage: input.nominalVoltage - dropVolts,
      powerLossW: lossFromR1(r1Used),
      dropRatio: ratioAgainst(achievedDropPctAtSelected ?? (dropVolts / input.nominalVoltage) * 100, input.dropLimitPct),
      requiredSectionMm2,
      selectedStandardSectionMm2: selected,
      achievedDropPctAtSelected,
    };
  }

  const hasSection = input.crossSectionMm2 !== undefined;
  const hasCustomR = input.customResistanceOhmPerKm !== undefined;
  if (!hasSection && !hasCustomR) return fail("crossSectionMm2");
  if (hasCustomR && !isPositive(input.customResistanceOhmPerKm)) return fail("customResistanceOhmPerKm");
  if (!hasCustomR) {
    if (!isPositive(input.crossSectionMm2) || !isInRange(input.crossSectionMm2, 0.5, 630)) {
      return fail("crossSectionMm2");
    }
  }
  const r1 = resistancePerMetreOf(input.crossSectionMm2 ?? 0) * input.lengthM;

  const resistanceOhm = threePhase ? r1 : 2 * r1;
  const dropVolts = dropFromR1(r1);
  const powerLossW = lossFromR1(r1);
  const dropPct = input.nominalVoltage === undefined ? undefined : (dropVolts / input.nominalVoltage) * 100;

  return {
    ok: true,
    resistanceOhm,
    dropVolts,
    dropVoltsPerPhase: threePhase ? dropVolts / SQRT3 : undefined,
    dropPct,
    farEndVoltage: input.nominalVoltage === undefined ? undefined : input.nominalVoltage - dropVolts,
    powerLossW,
    dropRatio: dropPct === undefined ? undefined : ratioAgainst(dropPct, input.dropLimitPct),
    requiredSectionMm2: undefined,
    selectedStandardSectionMm2: undefined,
    achievedDropPctAtSelected: undefined,
  };
}
