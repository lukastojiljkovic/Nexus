/**
 * „Transport i logistika" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category**, for the reason `gradnja.ts` gives:
 * the question a maintainer asks is „where does the axle-load calculator live",
 * and `pro/transport.ts` answers it where `pro/statics.ts` would not.
 *
 * **These are pure functions and they refuse rather than repair.** No clock, no
 * locale, no I/O: a plan that spans midnight returns a day offset and a
 * minute-of-day, and a service interval takes today's date as a parameter. That
 * is what makes the vectors below checkable by hand.
 *
 * **Nothing here decides anything.** Half of this pack is `life-safety`: axle
 * loads, gross mass, lashing forces, the centre of gravity of a load and the
 * driver's hours. Every one of them computes a QUANTITY. The limits — axle
 * limits, gross-mass limits, the acceleration and friction coefficients of a
 * securing standard, the driving and rest limits — are `regulated`-tier
 * numbers: a rule-maker chose them, they differ by country, by vehicle and by
 * the vehicle's own registration document, and they change. Every one of them
 * is an INPUT with no default, and what comes back is the pair of numbers and
 * their ratio (`LimitFigure`) — never a word about what the pair means, never a
 * boolean, never a status. A tool that shipped „prelazi dozvoljeno" would be
 * this app asserting which rule applies to a vehicle it has never seen.
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
  ratioAgainst,
  type ProResult,
} from "./result.js";

/* -------------------------------------------------------------------------- */
/* Constants and shared machinery                                             */
/* -------------------------------------------------------------------------- */

/** Standard gravity, m/s² — CGPM 1901, exact by definition. */
const G = 9.80665;

/** Millimetres in an inch, exact by definition. */
const MM_PER_INCH = 25.4;

/** Litres in a US gallon: 231 in³ with an inch of exactly 25.4 mm. */
const L_PER_US_GALLON = 3.785411784;

/** Litres in an imperial gallon, exact by definition. */
const L_PER_IMP_GALLON = 4.54609;

/** Kilometres in a mile: 1 mi = 1609.344 m, exact by definition. */
const KM_PER_MILE = 1.609344;

/** Unit arithmetic: cm³ in a m³, mm³ in a litre, mm in a km — all 10⁶. */
const MILLION = 1000000;

/** Minutes in an hour, and minutes in a day. */
const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 1440;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Diesel density at 15 °C, kg/l. EN 590:2022 gives the band 820.0–845.0 kg/m³;
 * 0.835 is a value INSIDE that band, not its midpoint and not a rule. Exported
 * so a surface can seed its field with it — never applied as a default inside a
 * function, because the number that matters is the one on the delivery note.
 */
export const DIESEL_DENSITY_15C = 0.835;

/**
 * AUS 32 (AdBlue) density at 20 °C, kg/l. ISO 22241-1:2019 gives 1.087–1.093;
 * 1.09 sits inside that band. Same rule as the diesel figure above.
 */
export const AUS32_DENSITY_20C = 1.09;

/**
 * Pallet footprints in mm, from the standards that define them:
 * EUR 800 × 1200 mm (EN 13698-1:2003) and industrial 1000 × 1200 mm
 * (ISO 6780:2003). A footprint is a published dimension, not a limit — nothing
 * about it says how much may be stacked on one.
 */
export const PALLET_FOOTPRINTS = {
  eur: { length: 1200, width: 800 },
  industrial: { length: 1200, width: 1000 },
} as const;

/**
 * A computed quantity beside the limit the user typed — the whole of what a
 * `life-safety` tool in this pack is allowed to say about a rule.
 *
 * `minusLimit` is signed arithmetic and `ratio` is a quotient. Neither is a
 * verdict: 1.09 is a fact about two numbers, while „over the limit" would be
 * this app choosing which limit applies.
 */
export interface LimitFigure {
  /** The computed quantity, in the tool's own unit. */
  readonly value: number;
  /** The number the USER typed, echoed back; undefined when they typed none. */
  readonly limit: number | undefined;
  /** value − limit. Undefined when no usable limit was given. */
  readonly minusLimit: number | undefined;
  /** value ÷ limit. Undefined when no usable limit was given. */
  readonly ratio: number | undefined;
}

/**
 * Pair a value with the user's own limit. A limit of zero or less is treated as
 * no limit, exactly as `ratioAgainst` does, so the two halves never disagree.
 *
 * `ratioUsable = false` keeps the limit and the difference but drops the
 * quotient — used where the ratio would be arithmetic nonsense, e.g. a negative
 * axle reaction, which is a real result of statics but not something a ratio
 * against a mass limit describes.
 */
function figure(value: number, limit: number | undefined, ratioUsable = true): LimitFigure {
  if (!isPositive(limit)) {
    return { value, limit: undefined, minusLimit: undefined, ratio: undefined };
  }
  return {
    value,
    limit,
    minusLimit: value - limit,
    ratio: ratioUsable ? ratioAgainst(value, limit) : undefined,
  };
}

/**
 * Round up to a whole multiple of `step`, without charging for the last bit.
 *
 * `Math.ceil(1.1 / 0.1)` is 12, not 11: neither decimal is representable in
 * binary, so the quotient lands a hair above the integer it should be and a
 * bare ceil charges one extra step for a mass that was exactly on one.
 * `ceilSnapped` takes that representation error out at nine significant digits
 * — a relative tolerance, so it holds at 2 kg and at 20 000 kg alike, and it is
 * the same one every other toolkit uses rather than this file's own constant.
 */
function ceilToStep(value: number, step: number): number {
  return ceilSnapped(value / step) * step;
}

/**
 * How many whole `unit` lengths fit in `space`, with the same tolerance and for
 * the same reason: 13.62 m typed in metres becomes 13620.000000000002 mm, and
 * a length that divides exactly must not lose a pallet to the last bit.
 */
function fitCount(space: number, unit: number): number {
  if (!isPositive(unit) || !Number.isFinite(space)) return 0;
  return Math.max(0, floorSnapped(space / unit));
}

/** Σ of a mapped list, written once so no tool hand-rolls a reduce. */
function sumOf<T>(rows: readonly T[], value: (row: T) => number): number {
  return rows.reduce((total, row) => total + value(row), 0);
}

/* -------------------------------------------------------------------------- */
/* Osovinsko opterećenje — axle load distribution (life-safety)               */
/* -------------------------------------------------------------------------- */

/** One row of cargo: a mass and where along the vehicle it sits. */
export interface MassAtDistance {
  /** Mass of the row, kg. */
  readonly mass: number;
  /**
   * Distance in m along the vehicle, measured as the mode defines its zero:
   * from the front axle backwards on a rigid, from the kingpin backwards on a
   * semitrailer. Negative is ahead of the zero and is a legitimate position.
   */
  readonly distance: number;
}

/** What one row of cargo puts on each axle, kg. */
export interface RigidItemShare {
  readonly mass: number;
  readonly distance: number;
  /** m·(1 − x/b). Negative for a row behind the rear axle. */
  readonly toFront: number;
  /** m·x/b. Negative for a row ahead of the front axle. */
  readonly toRear: number;
}

export interface RigidAxleInput {
  /** Wheelbase b, m. */
  readonly wheelbase: number;
  /** Weighed front axle load of the EMPTY vehicle, kg. */
  readonly emptyFront: number;
  /** Weighed rear axle (or bogie) load of the EMPTY vehicle, kg. */
  readonly emptyRear: number;
  /** Cargo rows, distances from the front axle backwards. */
  readonly items: readonly MassAtDistance[];
  /** The user's own limits, from the registration document. No defaults. */
  readonly frontLimit?: number | undefined;
  readonly rearLimit?: number | undefined;
  readonly totalLimit?: number | undefined;
}

export interface RigidAxleLoads {
  readonly front: LimitFigure;
  readonly rear: LimitFigure;
  readonly total: LimitFigure;
  /** Σm — the cargo alone, kg. */
  readonly payload: number;
  /** Σm·x about the front axle, kg·m. */
  readonly payloadMoment: number;
  readonly shares: readonly RigidItemShare[];
  /**
   * F0 + R0 + Σm — the same total reached the other way. It agrees with
   * `total.value` by construction (statics conserves mass), and both are
   * returned so a surface can show the check rather than assert it.
   */
  readonly totalByMasses: number;
}

function validRows(items: readonly MassAtDistance[], maxRows: number): boolean {
  return (
    items.length >= 1 &&
    items.length <= maxRows &&
    items.every((row) => isInRange(row.mass, 0, 60000) && isInRange(row.distance, -20, 20))
  );
}

/**
 * Front and rear axle loads of a rigid vehicle, by moments about the front axle.
 *
 * **The empty axle loads are weighed, not derived.** A tare split by any rule of
 * thumb is the error this tool exists to remove, so both come in from the
 * weighbridge and the tool only ever adds the cargo's share to them.
 *
 * A row ahead of the front axle (`distance < 0`) LIFTS the rear axle: its share
 * comes back negative, which is the physics and not a defect. When the resulting
 * axle load itself is negative the ratio against a limit is dropped — a quotient
 * of a negative reaction against a mass limit describes nothing — while the
 * load and the difference are still reported.
 */
export function rigidAxleLoads(input: RigidAxleInput): ProResult<RigidAxleLoads> {
  const { wheelbase, emptyFront, emptyRear, items } = input;
  if (!isInRange(wheelbase, 0.5, 12)) return fail("wheelbase");
  if (!isInRange(emptyFront, 0, 30000)) return fail("emptyFront");
  if (!isInRange(emptyRear, 0, 40000)) return fail("emptyRear");
  if (!validRows(items, 100)) return fail("items");

  const payload = sumOf(items, (row) => row.mass);
  const payloadMoment = sumOf(items, (row) => row.mass * row.distance);
  const toRear = payloadMoment / wheelbase;
  const front = emptyFront + (payload - toRear);
  const rear = emptyRear + toRear;

  return {
    ok: true,
    front: figure(front, input.frontLimit, front >= 0),
    rear: figure(rear, input.rearLimit, rear >= 0),
    total: figure(front + rear, input.totalLimit),
    payload,
    payloadMoment,
    shares: items.map((row) => ({
      mass: row.mass,
      distance: row.distance,
      toFront: row.mass * (1 - row.distance / wheelbase),
      toRear: (row.mass * row.distance) / wheelbase,
    })),
    totalByMasses: emptyFront + emptyRear + payload,
  };
}

export interface RigidAxleTargetInput {
  readonly wheelbase: number;
  /** Needed to report the front axle at the new position, not only the rear. */
  readonly emptyFront: number;
  readonly emptyRear: number;
  readonly items: readonly MassAtDistance[];
  /** Which row is allowed to move, as an index into `items`. */
  readonly itemIndex: number;
  /** The rear axle load the user is aiming at, kg. */
  readonly targetRear: number;
}

export interface RigidAxleTargetDistance {
  /** Sc = (target − R0)·b, the total moment about the front axle, kg·m. */
  readonly requiredMoment: number;
  /** Where the chosen row would have to sit, m from the front axle. */
  readonly distance: number;
  /** New distance − current distance, m. Positive is further back. */
  readonly shift: number;
  /**
   * Front axle load with the chosen row moved, kg — moving one row changes
   * BOTH axles, and the review's own worked figure is this number (8200 → 7500),
   * not the rear axle the target was stated in.
   */
  readonly newFront: number;
  /** Rear axle load at the new position, kg — equal to `targetRear` by construction. */
  readonly newRear: number;
  /**
   * Front + rear at the new position — unchanged from before the move, and
   * shown as the check.
   */
  readonly newTotal: number;
  /** True when the solved distance is negative or beyond the wheelbase. */
  readonly distanceOutOfBounds: boolean;
}

/**
 * The distance at which ONE chosen row would produce a chosen rear axle load.
 *
 * The inverse of `rigidAxleLoads` with every other row frozen: the total moment
 * the target implies, less the moment the other rows already contribute, over
 * the chosen row's mass. A massless row cannot move the axle load at all, so
 * that case refuses rather than dividing by zero — and the answer is a distance,
 * never an instruction to move anything.
 *
 * **Moving one row moves both axles**, which is why `newFront` is returned
 * beside `newRear`: a plan that only showed the rear axle reaching its target
 * would hide that the front axle just changed by exactly the opposite amount.
 */
export function rigidAxleTargetDistance(
  input: RigidAxleTargetInput,
): ProResult<RigidAxleTargetDistance> {
  const { wheelbase, emptyFront, emptyRear, items, itemIndex, targetRear } = input;
  if (!isInRange(wheelbase, 0.5, 12)) return fail("wheelbase");
  if (!isInRange(emptyFront, 0, 30000)) return fail("emptyFront");
  if (!isInRange(emptyRear, 0, 40000)) return fail("emptyRear");
  if (!validRows(items, 100)) return fail("items");
  if (!isIntegerIn(itemIndex, 0, items.length - 1)) return fail("itemIndex");
  if (!isInRange(targetRear, 0, 40000)) return fail("targetRear");

  const chosen = items[itemIndex];
  if (chosen === undefined) return fail("itemIndex");
  if (!isPositive(chosen.mass)) return fail("itemMass");

  const requiredMoment = (targetRear - emptyRear) * wheelbase;
  const others = sumOf(
    items.filter((_, index) => index !== itemIndex),
    (row) => row.mass * row.distance,
  );
  const distance = (requiredMoment - others) / chosen.mass;

  const payload = sumOf(items, (row) => row.mass);
  const newRear = targetRear;
  const newFront = emptyFront + payload - (newRear - emptyRear);
  return {
    ok: true,
    requiredMoment,
    distance,
    shift: distance - chosen.distance,
    newFront,
    newRear,
    newTotal: newFront + newRear,
    distanceOutOfBounds: distance < 0 || distance > wheelbase,
  };
}

/** What one row of cargo on the semitrailer puts on each of the four points. */
export interface SemitrailerItemShare {
  readonly mass: number;
  readonly distance: number;
  /** m·d/s — the trailer bogie's share, kg. */
  readonly toBogie: number;
  /** m·(1 − d/s) — what reaches the fifth wheel, kg. */
  readonly toFifthWheel: number;
  /** The fifth-wheel share carried through to the tractor's drive axle, kg. */
  readonly toDrive: number;
  /** …and to the tractor's front axle, kg. Negative when u > b. */
  readonly toFront: number;
}

export interface TractorSemitrailerInput {
  /** Tractor wheelbase b_tr, m. */
  readonly tractorWheelbase: number;
  /** Fifth wheel u, m behind the tractor's front axle. May exceed the wheelbase. */
  readonly fifthWheelFromFrontAxle: number;
  /** Weighed empty tractor axle loads, kg. */
  readonly emptyFront: number;
  readonly emptyDrive: number;
  /** Kingpin to the centre of the trailer's axle group, s, m. */
  readonly kingpinToBogie: number;
  /** Trailer tare, kg, and its centre of gravity c, m behind the kingpin. */
  readonly trailerTare: number;
  readonly trailerTareCentre: number;
  /** Cargo rows, distances from the KINGPIN backwards. */
  readonly items: readonly MassAtDistance[];
  readonly frontLimit?: number | undefined;
  readonly driveLimit?: number | undefined;
  readonly bogieLimit?: number | undefined;
  readonly totalLimit?: number | undefined;
}

export interface TractorSemitrailerLoads {
  readonly front: LimitFigure;
  readonly drive: LimitFigure;
  readonly bogie: LimitFigure;
  readonly total: LimitFigure;
  /** Load on the fifth wheel K, kg — the trailer's whole reaction on the tractor. */
  readonly fifthWheel: number;
  readonly payload: number;
  readonly shares: readonly SemitrailerItemShare[];
  /** F0 + R0 + trailer tare + Σm, the same total by the other route. */
  readonly totalByMasses: number;
}

/**
 * Tractor and semitrailer: bogie, fifth wheel, then the two tractor axles.
 *
 * Two statics problems in series. The trailer is a beam on the kingpin and the
 * bogie, so its bogie load is the moment of tare and cargo about the kingpin
 * over s, and whatever is left rides on the fifth wheel. That fifth-wheel load
 * is then a point load on the tractor, u behind its front axle.
 *
 * **A fifth wheel BEHIND the drive axle is allowed** (`u > b_tr`): the front
 * axle's share goes negative, meaning the coupling lifts the front of the
 * tractor, which is physically what happens and is reported as a negative
 * number rather than refused.
 */
export function tractorSemitrailerLoads(
  input: TractorSemitrailerInput,
): ProResult<TractorSemitrailerLoads> {
  const {
    tractorWheelbase,
    fifthWheelFromFrontAxle: u,
    emptyFront,
    emptyDrive,
    kingpinToBogie: s,
    trailerTare,
    trailerTareCentre,
    items,
  } = input;
  if (!isInRange(tractorWheelbase, 0.5, 12)) return fail("tractorWheelbase");
  if (!isInRange(u, 0, 12)) return fail("fifthWheelFromFrontAxle");
  if (!isInRange(emptyFront, 0, 30000)) return fail("emptyFront");
  if (!isInRange(emptyDrive, 0, 40000)) return fail("emptyDrive");
  if (!isInRange(s, 1, 15)) return fail("kingpinToBogie");
  if (!isInRange(trailerTare, 0, 20000)) return fail("trailerTare");
  if (!isInRange(trailerTareCentre, 0, 15)) return fail("trailerTareCentre");
  if (!validRows(items, 100)) return fail("items");

  const payload = sumOf(items, (row) => row.mass);
  const bogie = (trailerTare * trailerTareCentre + sumOf(items, (r) => r.mass * r.distance)) / s;
  const fifthWheel = trailerTare + payload - bogie;
  const share = u / tractorWheelbase;
  const front = emptyFront + fifthWheel * (1 - share);
  const drive = emptyDrive + fifthWheel * share;

  return {
    ok: true,
    front: figure(front, input.frontLimit, front >= 0),
    drive: figure(drive, input.driveLimit, drive >= 0),
    bogie: figure(bogie, input.bogieLimit, bogie >= 0),
    total: figure(front + drive + bogie, input.totalLimit),
    fifthWheel,
    payload,
    shares: items.map((row) => {
      const toBogie = (row.mass * row.distance) / s;
      const toFifthWheel = row.mass - toBogie;
      return {
        mass: row.mass,
        distance: row.distance,
        toBogie,
        toFifthWheel,
        toDrive: toFifthWheel * share,
        toFront: toFifthWheel * (1 - share),
      };
    }),
    totalByMasses: emptyFront + emptyDrive + trailerTare + payload,
  };
}

export interface SemitrailerTargetInput {
  /** Kingpin to the centre of the trailer's axle group, s, m. */
  readonly kingpinToBogie: number;
  readonly trailerTare: number;
  readonly trailerTareCentre: number;
  /** Cargo rows, distances from the kingpin backwards. */
  readonly items: readonly MassAtDistance[];
  /** Which row is allowed to move, as an index into `items`. */
  readonly itemIndex: number;
  /** The trailer axle-group load the user is aiming at, kg. */
  readonly targetBogie: number;
  /** Tractor geometry, needed to recompute the fifth wheel and its two axles. */
  readonly tractorWheelbase: number;
  readonly fifthWheelFromFrontAxle: number;
  readonly emptyFront: number;
  readonly emptyDrive: number;
}

export interface SemitrailerTargetDistance {
  /** Sc = target·s, the moment about the kingpin the target implies, kg·m. */
  readonly requiredMoment: number;
  /** Where the chosen row would have to sit, m from the kingpin. */
  readonly distance: number;
  readonly shift: number;
  /** True when the solved distance is negative or beyond the kingpin-to-bogie span. */
  readonly distanceOutOfBounds: boolean;
  /** Trailer axle-group load at the new position, kg — equal to `targetBogie` by construction. */
  readonly newBogie: number;
  /** Fifth-wheel load at the new position, kg — moving one row changes this too. */
  readonly newFifthWheel: number;
  /** Tractor front and drive axle loads once the new fifth-wheel load is carried through. */
  readonly newFront: number;
  readonly newDrive: number;
  /** newFront + newDrive + newBogie — unchanged from before the move, shown as the check. */
  readonly newTotal: number;
}

/**
 * The distance at which one chosen row would produce a chosen trailer
 * axle-group load — the semitrailer counterpart of `rigidAxleTargetDistance`.
 *
 * The trailer tare's own moment (`mt·c`) has to be subtracted from the required
 * moment before it is divided among the cargo rows: it is weight the trailer
 * carries regardless of where any one row sits, and leaving it in would credit
 * the moved row with tare that was never its own.
 *
 * **Moving one row moves all four points, not just the trailer's own axle
 * group**: it changes the fifth-wheel load, and through it both tractor axles.
 * The rigid counterpart returns the recomputed front axle for exactly this
 * reason, and a load moved on a semitrailer reaches further, not less.
 */
export function tractorSemitrailerTargetDistance(
  input: SemitrailerTargetInput,
): ProResult<SemitrailerTargetDistance> {
  const {
    kingpinToBogie: s,
    trailerTare: mt,
    trailerTareCentre: c,
    items,
    itemIndex,
    targetBogie,
    tractorWheelbase,
    fifthWheelFromFrontAxle: u,
    emptyFront,
    emptyDrive,
  } = input;
  if (!isInRange(s, 1, 15)) return fail("kingpinToBogie");
  if (!isInRange(mt, 0, 20000)) return fail("trailerTare");
  if (!isInRange(c, 0, 15)) return fail("trailerTareCentre");
  if (!validRows(items, 100)) return fail("items");
  if (!isIntegerIn(itemIndex, 0, items.length - 1)) return fail("itemIndex");
  if (!isInRange(targetBogie, 0, 40000)) return fail("targetBogie");
  if (!isInRange(tractorWheelbase, 0.5, 12)) return fail("tractorWheelbase");
  if (!isInRange(u, 0, 12)) return fail("fifthWheelFromFrontAxle");
  if (!isInRange(emptyFront, 0, 30000)) return fail("emptyFront");
  if (!isInRange(emptyDrive, 0, 40000)) return fail("emptyDrive");

  const chosen = items[itemIndex];
  if (chosen === undefined) return fail("itemIndex");
  if (!isPositive(chosen.mass)) return fail("itemMass");

  const requiredMoment = targetBogie * s;
  const others = sumOf(
    items.filter((_, index) => index !== itemIndex),
    (row) => row.mass * row.distance,
  );
  const distance = (requiredMoment - mt * c - others) / chosen.mass;

  const payload = sumOf(items, (row) => row.mass);
  const newBogie = targetBogie;
  const newFifthWheel = mt + payload - newBogie;
  const share = u / tractorWheelbase;
  const newFront = emptyFront + newFifthWheel * (1 - share);
  const newDrive = emptyDrive + newFifthWheel * share;

  return {
    ok: true,
    requiredMoment,
    distance,
    shift: distance - chosen.distance,
    distanceOutOfBounds: distance < 0 || distance > s,
    newBogie,
    newFifthWheel,
    newFront,
    newDrive,
    newTotal: newFront + newDrive + newBogie,
  };
}

/* -------------------------------------------------------------------------- */
/* Težište tereta — cargo centre of gravity (life-safety)                      */
/* -------------------------------------------------------------------------- */

export interface CargoItem {
  /** Mass of the piece, kg. */
  readonly mass: number;
  /** Longitudinal position, m from the chosen zero, backwards positive. */
  readonly x: number;
  /** Lateral position, m from the vehicle centreline, right-hand side positive. */
  readonly y: number;
  /** Height of the piece's own centre above the deck, m. */
  readonly z: number;
  /** Piece dimensions, m — read only when `useItemDimensions` is on. */
  readonly length?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface VehicleCentre {
  readonly x: number;
  readonly y: number;
  /** Height of the vehicle's centre of gravity ABOVE THE GROUND, m. */
  readonly z: number;
}

export interface CargoCentreInput {
  readonly items: readonly CargoItem[];
  /**
   * When true, x/y/z are the piece's CORNER and the centroid is taken at
   * x + l/2, y + w/2, z + h/2 — the piece's own dimensions must then be given.
   */
  readonly useItemDimensions: boolean;
  /** Deck height above the ground, m. */
  readonly floorHeight: number;
  /** Wheel track, m. */
  readonly track: number;
  /** Inside width of the load space, m. */
  readonly innerWidth: number;
  /** The x the longitudinal moment is taken about, m. */
  readonly momentReference: number;
  /** Vehicle mass, kg. Absent means the combined centre is not computed. */
  readonly vehicleMass?: number | undefined;
  readonly vehicleCentre?: VehicleCentre | undefined;
}

export interface CombinedCentre {
  /** Cargo + vehicle, kg. */
  readonly mass: number;
  readonly x: number;
  readonly y: number;
  /** Combined centre height ABOVE THE GROUND, m. */
  readonly heightAboveGround: number;
  readonly lateralOffset: number;
  readonly lateralShare: number | undefined;
  readonly halfTrackOverHeight: number | undefined;
}

export interface CargoCentre {
  readonly totalMass: number;
  readonly momentX: number;
  readonly momentY: number;
  readonly momentZ: number;
  readonly x: number;
  readonly y: number;
  /** Centre height above the DECK, m. */
  readonly z: number;
  /** Centre height above the GROUND, m: z + deck height. */
  readonly heightAboveGround: number;
  /** |ȳ|, m. */
  readonly lateralOffset: number;
  /** |ȳ| ÷ half the inside width, as a fraction. */
  readonly lateralShare: number | undefined;
  /** Σm·(x − x_ref), kg·m. */
  readonly momentAboutReference: number;
  /**
   * (track ÷ 2) ÷ centre height above ground — a quotient of two LENGTHS and
   * nothing else. It is not a tipping threshold, a safety factor or a margin;
   * what it means for a given vehicle is a question for whoever is answerable
   * for the load. Undefined when the height is zero.
   */
  readonly halfTrackOverHeight: number | undefined;
  readonly combined: CombinedCentre | undefined;
}

/**
 * The centre of gravity of a load, from a list of pieces.
 *
 * **`z` is measured above the DECK for cargo and above the GROUND for the
 * vehicle**, because that is how each is known: a piece's centre is measured
 * where it stands, while a manufacturer quotes the vehicle's centre above the
 * road. Mixing the two is the error that makes a combined centre come out a
 * whole deck height wrong, so the deck height is added to the cargo before the
 * two are combined and never afterwards.
 */
export function cargoCentreOfGravity(input: CargoCentreInput): ProResult<CargoCentre> {
  const { items, useItemDimensions, floorHeight, track, innerWidth, momentReference } = input;
  if (items.length < 1 || items.length > 200) return fail("items");
  if (!items.every((row) => isNonNegative(row.mass))) return fail("itemMass");
  if (!items.every((row) => isInRange(row.x, -50, 50) && isInRange(row.y, -20, 20))) {
    return fail("itemPosition");
  }
  if (!items.every((row) => isInRange(row.z, -20, 20))) return fail("itemPosition");
  if (!isInRange(floorHeight, 0, 3)) return fail("floorHeight");
  if (!isInRange(track, 0.5, 3.5)) return fail("track");
  if (!isInRange(innerWidth, 0.5, 4)) return fail("innerWidth");
  if (!isInRange(momentReference, -20, 20)) return fail("momentReference");

  const half = (size: number | undefined): number | undefined =>
    size === undefined || !isNonNegative(size) ? undefined : size / 2;
  const centres = items.map((row) => {
    if (!useItemDimensions) return { mass: row.mass, x: row.x, y: row.y, z: row.z };
    const dl = half(row.length);
    const dw = half(row.width);
    const dh = half(row.height);
    if (dl === undefined || dw === undefined || dh === undefined) return undefined;
    return { mass: row.mass, x: row.x + dl, y: row.y + dw, z: row.z + dh };
  });
  if (centres.some((row) => row === undefined)) return fail("itemDimensions");
  const pieces = centres.filter((row): row is NonNullable<typeof row> => row !== undefined);

  const totalMass = sumOf(pieces, (row) => row.mass);
  if (!isPositive(totalMass)) return fail("totalMass");
  const momentX = sumOf(pieces, (row) => row.mass * row.x);
  const momentY = sumOf(pieces, (row) => row.mass * row.y);
  const momentZ = sumOf(pieces, (row) => row.mass * row.z);
  const x = momentX / totalMass;
  const y = momentY / totalMass;
  const z = momentZ / totalMass;
  const heightAboveGround = z + floorHeight;

  const vehicleMass = input.vehicleMass;
  const vehicleCentre = input.vehicleCentre;
  let combined: CombinedCentre | undefined;
  if (vehicleMass !== undefined) {
    // A vehicle mass with no centre is a half-entered pair, not „no vehicle" —
    // refusing it is what stops a combined block from silently being dropped.
    if (!isInRange(vehicleMass, 0, 60000)) return fail("vehicleMass");
    if (
      vehicleCentre === undefined ||
      !isInRange(vehicleCentre.x, -20, 20) ||
      !isInRange(vehicleCentre.y, -20, 20) ||
      !isInRange(vehicleCentre.z, -20, 20)
    ) {
      return fail("vehicleCentre");
    }
  }
  if (vehicleMass !== undefined && vehicleMass > 0 && vehicleCentre !== undefined) {
    const mass = totalMass + vehicleMass;
    // The cargo's z is lifted to ground datum here — once, and only here.
    const height = (momentZ + totalMass * floorHeight + vehicleMass * vehicleCentre.z) / mass;
    const lateral = (momentY + vehicleMass * vehicleCentre.y) / mass;
    combined = {
      mass,
      x: (momentX + vehicleMass * vehicleCentre.x) / mass,
      y: lateral,
      heightAboveGround: height,
      lateralOffset: Math.abs(lateral),
      lateralShare: quotient(Math.abs(lateral), innerWidth / 2),
      // The shared `quotient` allows a NEGATIVE divisor (a reaction the other
      // way is still a reaction); a height above ground is not that case, so
      // the positive guard is kept explicit here rather than folded into the
      // divisor check.
      halfTrackOverHeight: isPositive(height) ? quotient(track / 2, height) : undefined,
    };
  }

  return {
    ok: true,
    totalMass,
    momentX,
    momentY,
    momentZ,
    x,
    y,
    z,
    heightAboveGround,
    lateralOffset: Math.abs(y),
    lateralShare: quotient(Math.abs(y), innerWidth / 2),
    momentAboutReference: momentX - totalMass * momentReference,
    // Same explicit positive guard as the combined block above — a height at
    // or below ground level draws no ratio, and the shared `quotient` alone
    // would allow a negative divisor through.
    halfTrackOverHeight: isPositive(heightAboveGround)
      ? quotient(track / 2, heightAboveGround)
      : undefined,
    combined,
  };
}

/* -------------------------------------------------------------------------- */
/* Ukupna masa i nosivost — gross mass and payload (life-safety)               */
/* -------------------------------------------------------------------------- */

export type MassMode = "single" | "combination";

export interface GrossMassInput {
  readonly mode: MassMode;
  /** Tare of the vehicle with its body, kg — off the weighbridge or the papers. */
  readonly vehicleTare: number;
  /**
   * True when `vehicleTare` is ALREADY the running-order mass (fuel, AdBlue and
   * crew included, as some registration documents record it). Fuel, AdBlue and
   * crew are then reported as usual but not added a second time on top of the
   * tare — adding them unconditionally double-counts a full tank's mass.
   */
  readonly tareIncludesFuelAndCrew: boolean;
  /** Tare of the trailer or semitrailer, kg. Combination mode only. */
  readonly trailerTare?: number | undefined;
  /** Fuel in the tank, l, and its density in kg/l — no density is assumed. */
  readonly fuelLitres: number;
  readonly fuelDensity?: number | undefined;
  readonly adBlueLitres: number;
  readonly adBlueDensity?: number | undefined;
  /** Driver and crew, kg. */
  readonly crew: number;
  /** Tools, equipment, personal luggage, kg. */
  readonly equipment: number;
  /** Packaging and pallets, kg — counted with the payload, not with the vehicle. */
  readonly packaging: number;
  readonly cargo: number;
  /** The user's own limits, from the registration document. No defaults. */
  readonly vehicleLimit?: number | undefined;
  readonly trailerLimit?: number | undefined;
  readonly combinationLimit?: number | undefined;
}

export interface GrossMass {
  /** Fuel mass, kg. */
  readonly fuelMass: number;
  readonly adBlueMass: number;
  /** Vehicle in running order: tare + fuel + AdBlue + crew + equipment, kg. */
  readonly runningMass: number;
  /** Running order + trailer tare, kg. Combination mode only. */
  readonly combinationEmptyMass: number | undefined;
  /** Cargo + packaging, kg. */
  readonly payloadMass: number;
  readonly totalMass: number;
  /**
   * The total against the limit that covers the whole thing: the vehicle limit
   * in single mode, the combination limit in combination mode.
   */
  readonly total: LimitFigure;
  /**
   * In combination mode only, the two halves against their own limits — the
   * VEHICLE figure carries no cargo and the TRAILER figure is the bare tare,
   * because how the load splits between them depends on where it sits, which is
   * the axle-load tool's question and is not guessed here.
   */
  readonly vehicleWithoutCargo: LimitFigure | undefined;
  readonly trailerWithoutCargo: LimitFigure | undefined;
  /** Limit − empty mass, kg: what is left for cargo before any is loaded. */
  readonly payloadHeadroom: number | undefined;
  /** Payload ÷ that headroom, as a fraction. Undefined when the headroom is ≤ 0. */
  readonly headroomUsed: number | undefined;
  /**
   * Limit − empty mass − packaging tare, kg, one per entered limit — the review
   * asked for a kilogram figure rather than the percentage `headroomUsed`
   * already gives, because „92.22%" does not say how many more kilograms fit.
   * Packaging is subtracted because it already occupies capacity wherever the
   * next kilogram of cargo would go; each is `undefined` when its own limit was
   * not typed.
   */
  readonly vehicleCargoHeadroom: number | undefined;
  readonly trailerCargoHeadroom: number | undefined;
  /**
   * Combination mode only — undefined in single mode, where it would just
   * repeat `vehicleCargoHeadroom`.
   */
  readonly combinationCargoHeadroom: number | undefined;
  /** The smallest of the three above — the binding one when more than one limit was given. */
  readonly minCargoHeadroom: number | undefined;
}

/**
 * Every mass that is on the vehicle, added up, beside the user's own limits.
 *
 * **Fuel and AdBlue are volumes until a density is given**, and no density is
 * assumed even though EN 590 and ISO 22241-1 publish bands — the number that
 * decides the mass is on the delivery note, and a litre of winter diesel is not
 * a litre of summer diesel. A volume without its density refuses.
 *
 * The payload figures answer the question a dispatcher actually asks: not „what
 * is the total" but „how much of what was left is used up", which is
 * `payload ÷ (limit − running mass)`.
 */
export function grossMassAndPayload(input: GrossMassInput): ProResult<GrossMass> {
  const {
    mode,
    vehicleTare,
    tareIncludesFuelAndCrew,
    fuelLitres,
    adBlueLitres,
    crew,
    equipment,
    packaging,
    cargo,
  } = input;
  if (!isInRange(vehicleTare, 0, 60000)) return fail("vehicleTare");
  if (!isInRange(fuelLitres, 0, 2000)) return fail("fuelLitres");
  if (!isInRange(adBlueLitres, 0, 200)) return fail("adBlueLitres");
  if (!isInRange(crew, 0, 600)) return fail("crew");
  if (!isInRange(equipment, 0, 5000)) return fail("equipment");
  if (!isInRange(packaging, 0, 20000)) return fail("packaging");
  if (!isInRange(cargo, 0, 60000)) return fail("cargo");

  const fuelDensity = input.fuelDensity;
  if (fuelLitres > 0 && (fuelDensity === undefined || !isInRange(fuelDensity, 0.7, 1.1))) {
    return fail("fuelDensity");
  }
  const adBlueDensity = input.adBlueDensity;
  if (adBlueLitres > 0 && (adBlueDensity === undefined || !isInRange(adBlueDensity, 1.0, 1.2))) {
    return fail("adBlueDensity");
  }
  const trailerTare = input.trailerTare ?? 0;
  if (mode === "combination" && !isInRange(trailerTare, 0, 40000)) return fail("trailerTare");

  const fuelMass = fuelLitres * (fuelDensity ?? 0);
  const adBlueMass = adBlueLitres * (adBlueDensity ?? 0);
  // A tare that already reads as running-order mass must not have fuel, AdBlue
  // and crew added a second time — that would double-count a full tank.
  const runningMass = tareIncludesFuelAndCrew
    ? vehicleTare + equipment
    : vehicleTare + fuelMass + adBlueMass + crew + equipment;
  const combinationEmptyMass = mode === "combination" ? runningMass + trailerTare : undefined;
  const emptyMass = combinationEmptyMass ?? runningMass;
  const payloadMass = cargo + packaging;
  const totalMass = emptyMass + payloadMass;

  const wholeLimit = mode === "combination" ? input.combinationLimit : input.vehicleLimit;
  const total = figure(totalMass, wholeLimit);
  const payloadHeadroom =
    total.limit === undefined ? undefined : total.limit - emptyMass;
  const headroomUsed =
    payloadHeadroom === undefined || payloadHeadroom <= 0
      ? undefined
      : payloadMass / payloadHeadroom;

  const vehicleCargoHeadroom =
    input.vehicleLimit === undefined ? undefined : input.vehicleLimit - runningMass - packaging;
  const trailerCargoHeadroom =
    mode !== "combination" || input.trailerLimit === undefined
      ? undefined
      : input.trailerLimit - trailerTare - packaging;
  // Combination mode only: in single mode this would just repeat
  // `vehicleCargoHeadroom` under a second name, since `emptyMass` IS `runningMass` there.
  const combinationCargoHeadroom =
    mode !== "combination" || total.limit === undefined
      ? undefined
      : total.limit - emptyMass - packaging;
  const cargoHeadrooms = [
    vehicleCargoHeadroom,
    trailerCargoHeadroom,
    combinationCargoHeadroom,
  ].filter((value): value is number => value !== undefined);

  return {
    ok: true,
    fuelMass,
    adBlueMass,
    runningMass,
    combinationEmptyMass,
    payloadMass,
    totalMass,
    total,
    vehicleWithoutCargo:
      mode === "combination" ? figure(runningMass, input.vehicleLimit) : undefined,
    trailerWithoutCargo:
      mode === "combination" ? figure(trailerTare, input.trailerLimit) : undefined,
    payloadHeadroom,
    headroomUsed,
    vehicleCargoHeadroom,
    trailerCargoHeadroom,
    combinationCargoHeadroom,
    minCargoHeadroom: cargoHeadrooms.length === 0 ? undefined : Math.min(...cargoHeadrooms),
  };
}

/* -------------------------------------------------------------------------- */
/* Sila u vezicama — lashing forces (life-safety)                              */
/* -------------------------------------------------------------------------- */

export type LashingMethod = "topOver" | "direct" | "blocking";

export interface LashingInput {
  readonly method: LashingMethod;
  readonly mass: number;
  /**
   * The acceleration coefficients c for the three directions the standard
   * grades separately — forward, backward, lateral — each the user's own
   * number. One arrangement gives a different Fp per direction, which is why
   * all three come back side by side instead of one call per direction
   * repeating the mass/friction/geometry validation three times over.
   */
  readonly forwardCoefficient: number;
  readonly backwardCoefficient: number;
  readonly lateralCoefficient: number;
  /** The friction coefficient μ between load and deck. */
  readonly friction: number;
  /** Vertical angle α of the lashing, degrees. Top-over and direct. */
  readonly verticalAngle?: number | undefined;
  /** Horizontal angle β, degrees. Direct lashing only. */
  readonly horizontalAngle?: number | undefined;
  /** k — the share of the tension that reaches the far side. Top-over only. */
  readonly transferFactor?: number | undefined;
  /** STF from the label of the actual lashing, daN. Top-over only. */
  readonly stf?: number | undefined;
  /** LC from the label of the actual lashing, daN. Direct only. */
  readonly lc?: number | undefined;
  /** How many lashings the user's own arrangement has. Not a recommendation. */
  readonly lashings: number;
}

/**
 * What one direction's own driving force leaves for the securing arrangement
 * to take — the only part of the answer that differs by direction, because
 * the arrangement itself (one lashing's own contribution) does not.
 */
export interface LashingDirection {
  /** c·G for this direction, daN. */
  readonly drivingForce: number;
  /** Fp = (c − μ)·G, daN. Zero or negative when μ ≥ c, and shown as such. */
  readonly remainingForce: number;
  readonly remainingForceKn: number;
  /**
   * Fp ÷ perLashing, as a plain decimal that is NOT rounded up. Rounding it up
   * would be this tool naming a number of lashings, which is the securing
   * decision itself and belongs to whoever signs for the load.
   */
  readonly quotient: number | undefined;
  /** setForce ÷ Fp for THIS direction, as a plain decimal. */
  readonly setRatio: number | undefined;
}

export interface LashingForce {
  /** Weight of the load, daN (1 daN = 10 N). */
  readonly weight: number;
  /** μ·G — friction from the load's own weight, daN. Same in every direction. */
  readonly frictionForce: number;
  /** Fv = STF·sinα·(1 + k) — the vertical force one top-over lashing applies, daN. */
  readonly verticalForce: number | undefined;
  /** What one lashing contributes, daN — the arrangement's own geometry, not the direction. */
  readonly perLashing: number | undefined;
  readonly perLashingKn: number | undefined;
  /** The user's own arrangement: lashings × perLashing, daN. */
  readonly setForce: number | undefined;
  readonly setForceKn: number | undefined;
  readonly forward: LashingDirection;
  readonly backward: LashingDirection;
  readonly lateral: LashingDirection;
}

/**
 * The force a securing arrangement has to take, and what the arrangement the
 * user described delivers — for all three graded directions at once.
 *
 * **Everything except g is the user's number.** c, μ and k are the securing
 * standard's, STF and LC are printed on the label of the actual lashing, and
 * the count is the arrangement being described. The tool multiplies them.
 *
 * **What one lashing delivers does not depend on which direction is being
 * checked** — β is the angle of the arrangement itself, not of a direction —
 * so `perLashing` (and `setForce`) is computed once and only the driving
 * force, and therefore Fp, differs per direction.
 *
 * The top-over convention is stated in the result rather than assumed away:
 * `Fv = STF·sinα·(1 + k)`, where k = 1 means both sides pull full STF. The same
 * factor appears in the literature as a multiplier on 2·STF, which is the same
 * number written differently — `verticalForce` comes back so a reader can see
 * which one is in use instead of inferring it from the answer.
 */
export function lashingForce(input: LashingInput): ProResult<LashingForce> {
  const {
    method,
    mass,
    forwardCoefficient,
    backwardCoefficient,
    lateralCoefficient,
    friction: mu,
    lashings,
  } = input;
  if (!isInRange(mass, 1, 60000)) return fail("mass");
  if (!isInRange(forwardCoefficient, 0, 2)) return fail("forwardCoefficient");
  if (!isInRange(backwardCoefficient, 0, 2)) return fail("backwardCoefficient");
  if (!isInRange(lateralCoefficient, 0, 2)) return fail("lateralCoefficient");
  if (!isInRange(mu, 0, 1)) return fail("friction");
  if (!isIntegerIn(lashings, 0, 50)) return fail("lashings");

  const weight = (mass * G) / 10;
  const frictionForce = mu * weight;

  let verticalForce: number | undefined;
  let perLashing: number | undefined;

  if (method === "topOver") {
    const alpha = input.verticalAngle;
    const k = input.transferFactor;
    const stf = input.stf;
    // α = 0 is representable: sin 0 = 0, so the lashing adds no vertical force
    // and no friction at all. That is an answer, not a division by zero.
    if (alpha === undefined || !isInRange(alpha, 0, 90)) return fail("verticalAngle");
    if (k === undefined || !isInRange(k, 0, 1)) return fail("transferFactor");
    if (stf === undefined || !isInRange(stf, 1, 2000)) return fail("stf");
    verticalForce = stf * Math.sin(alpha * DEG_TO_RAD) * (1 + k);
    perLashing = mu * verticalForce;
  } else if (method === "direct") {
    const alpha = input.verticalAngle;
    const beta = input.horizontalAngle;
    const lc = input.lc;
    if (alpha === undefined || !isInRange(alpha, 0, 90)) return fail("verticalAngle");
    // No default: an unstated β would silently take cos β = 1, the single
    // most favourable value, and overstate what one lashing delivers.
    if (beta === undefined || !isInRange(beta, 0, 89)) return fail("horizontalAngle");
    if (lc === undefined || !isInRange(lc, 1, 20000)) return fail("lc");
    const along = Math.cos(alpha * DEG_TO_RAD) * Math.cos(beta * DEG_TO_RAD);
    const rawPerLashing = lc * (along + mu * Math.sin(alpha * DEG_TO_RAD));
    // ISPRAVKA (2): α = 90° with μ = 0 must read as Fe = 0, not as whatever
    // floating point leaves behind. `Math.cos(90°)` is 6.123233995736766e-17,
    // not exactly 0, so `rawPerLashing` comes out an implausible-looking
    // positive number instead of the zero it physically is — worse than the
    // Infinity this guard exists to prevent, because it looks like an answer.
    // Tolerance is a fraction of LC (not an absolute constant) because LC
    // itself ranges from 1 to 20000 daN.
    perLashing = Math.abs(rawPerLashing) > lc * 1e-9 ? rawPerLashing : 0;
  }

  const setForce = perLashing === undefined ? undefined : lashings * perLashing;

  const direction = (c: number): LashingDirection => {
    const drivingForce = c * weight;
    const remainingForce = drivingForce - frictionForce;
    const usable = perLashing !== undefined && perLashing > 0 && remainingForce > 0;
    return {
      drivingForce,
      remainingForce,
      remainingForceKn: (remainingForce * 10) / 1000,
      quotient: usable && perLashing !== undefined ? remainingForce / perLashing : undefined,
      setRatio:
        usable && setForce !== undefined ? setForce / remainingForce : undefined,
    };
  };

  return {
    ok: true,
    weight,
    frictionForce,
    verticalForce,
    perLashing,
    perLashingKn: perLashing === undefined ? undefined : (perLashing * 10) / 1000,
    setForce,
    setForceKn: setForce === undefined ? undefined : (setForce * 10) / 1000,
    forward: direction(forwardCoefficient),
    backward: direction(backwardCoefficient),
    lateral: direction(lateralCoefficient),
  };
}

/* -------------------------------------------------------------------------- */
/* Vožnja i pauze — driving and rest schedule (life-safety)                    */
/* -------------------------------------------------------------------------- */

export type DrivingBlockKind = "drive" | "break" | "dailyRest" | "otherWork";

export interface DrivingBlock {
  readonly kind: DrivingBlockKind;
  /** Minutes from midnight of the DEPARTURE day — may exceed 1440. */
  readonly start: number;
  readonly end: number;
  readonly minutes: number;
  /**
   * Driving since the last break, and today, in minutes, immediately AFTER
   * this block. A surface cannot safely re-derive these — a split break's two
   * parts are both `kind: "break"` and are told apart only by `breakPart`,
   * and re-deriving from that pairing is the duplicated-arithmetic defect
   * this file exists to avoid.
   */
  readonly sinceBreakAfter: number;
  readonly todayAfter: number;
  /**
   * Which half of a split break this is; `"full"` for an un-split break and
   * `"none"` for every other kind. The first half does NOT reset
   * `sinceBreakAfter`; only the second half (or a full break) does.
   */
  readonly breakPart: "first" | "second" | "full" | "none";
}

/** Other work — loading, unloading, a border — booked at a driving total. */
export interface OtherWork {
  readonly minutes: number;
  /** Inserted once the cumulative driving reaches this many minutes. */
  readonly afterDrivingMinutes: number;
}

export interface DrivingScheduleInput {
  /** Departure, minutes from midnight. */
  readonly departureMinuteOfDay: number;
  /** Planned driving, whole minutes. Absent means it is derived from km ÷ km/h. */
  readonly plannedDrivingMinutes?: number | undefined;
  readonly distance?: number | undefined;
  readonly averageSpeed?: number | undefined;
  /**
   * The four limits. Every one of them is the user's own number — this tool
   * holds no driving rule, names none and knows none. All four must be positive
   * or the schedule cannot advance at all.
   */
  readonly continuousLimit: number;
  readonly breakMinutes: number;
  readonly dailyLimit: number;
  readonly dailyRestMinutes: number;
  /** Splitting the break: the first part, and the driving after which it falls. */
  readonly splitBreak: boolean;
  readonly firstBreakPart?: number | undefined;
  readonly drivingBeforeFirstPart?: number | undefined;
  /** Already driven since the last break, and already driven today, minutes. */
  readonly drivenSinceBreak: number;
  readonly drivenToday: number;
  readonly otherWork: readonly OtherWork[];
}

export interface DrivingSchedule {
  readonly blocks: readonly DrivingBlock[];
  /** Minutes from midnight of the departure day at which the plan ends. */
  readonly arrival: number;
  readonly arrivalDayOffset: number;
  readonly arrivalMinuteOfDay: number;
  readonly elapsedMinutes: number;
  readonly drivingMinutes: number;
  readonly breakMinutes: number;
  readonly restMinutes: number;
  readonly otherWorkMinutes: number;
  /** Driving since the last break, and today, against the user's own limits. */
  readonly sinceBreak: LimitFigure;
  readonly today: LimitFigure;
  /** The clock at which uninterrupted driving from the arrival would use up… */
  readonly continuousLimitReachedAt: number;
  /** …each of the two remainders. Minutes from midnight of the departure day. */
  readonly dailyLimitReachedAt: number;
  /** Driving still unplaced, minutes — non-zero only when the plan was cut short. */
  readonly remainingDriving: number;
  /** True when the block cap stopped the walk before the driving ran out. */
  readonly truncated: boolean;
  /**
   * Other-work rows whose driving threshold was never reached — past the end
   * of the plan, or past whatever cut the walk short. Each keeps its own
   * `minutes` and `afterDrivingMinutes` so a surface can show what did not
   * get inserted rather than have it vanish with no trace.
   */
  readonly unplacedOtherWork: readonly OtherWork[];
}

/** A plan longer than this is shown as far as it goes, not walked forever. */
const MAX_BLOCKS = 200;

/**
 * A driving day laid out as blocks: drive, break, daily rest, other work.
 *
 * **Every limit is an input and none has a default.** Driving rules differ by
 * country, by vehicle, by whether the work is in scope of them at all, and they
 * change; a schedule built on a limit this app chose would be an assertion about
 * which rule applies. What comes back is a sequence of blocks and two ratios.
 *
 * **The order inside one step is fixed and it matters**: daily rest is taken
 * before a break, because a driver who has run out of daily driving does not
 * fix that with 45 minutes. Other work is inserted at a cumulative-driving mark
 * and moves the clock without touching either remaining allowance — it is
 * neither driving nor a break — which is why a plan can arrive late without any
 * of the driving figures changing.
 *
 * **A split break does not reset the continuous allowance on its first part.**
 * Only the second part does, which is the whole difference between a split and
 * two breaks and the thing a hand-drawn plan gets wrong.
 */
export function drivingSchedule(input: DrivingScheduleInput): ProResult<DrivingSchedule> {
  const {
    departureMinuteOfDay,
    continuousLimit,
    breakMinutes,
    dailyLimit,
    dailyRestMinutes,
    splitBreak,
    drivenSinceBreak,
    drivenToday,
    otherWork,
  } = input;
  if (!isIntegerIn(departureMinuteOfDay, 0, MIN_PER_DAY - 1)) return fail("departure");
  if (!isInRange(continuousLimit, 1, 24 * MIN_PER_HOUR)) return fail("continuousLimit");
  if (!isInRange(breakMinutes, 1, 600)) return fail("breakMinutes");
  if (!isInRange(dailyLimit, 1, 24 * MIN_PER_HOUR)) return fail("dailyLimit");
  if (!isInRange(dailyRestMinutes, 1, 24 * MIN_PER_HOUR)) return fail("dailyRestMinutes");
  if (!isInRange(drivenSinceBreak, 0, 24 * MIN_PER_HOUR)) return fail("drivenSinceBreak");
  if (!isInRange(drivenToday, 0, 24 * MIN_PER_HOUR)) return fail("drivenToday");
  if (otherWork.length > 20) return fail("otherWork");
  if (!otherWork.every((w) => isNonNegative(w.minutes) && isNonNegative(w.afterDrivingMinutes))) {
    return fail("otherWork");
  }

  let planned = input.plannedDrivingMinutes;
  if (planned === undefined) {
    const distance = input.distance;
    const speed = input.averageSpeed;
    if (distance === undefined || !isNonNegative(distance)) return fail("plannedDriving");
    if (speed === undefined || !isPositive(speed)) return fail("averageSpeed");
    planned = Math.round((MIN_PER_HOUR * distance) / speed);
  }
  if (!isInRange(planned, 1, 99 * MIN_PER_HOUR)) return fail("plannedDriving");

  let firstPart = 0;
  if (splitBreak) {
    const part = input.firstBreakPart;
    const threshold = input.drivingBeforeFirstPart;
    if (part === undefined || !isInRange(part, 1, breakMinutes - 1)) return fail("firstBreakPart");
    if (threshold === undefined || !isInRange(threshold, 1, 24 * MIN_PER_HOUR)) {
      return fail("drivingBeforeFirstPart");
    }
    firstPart = part;
  }
  const splitThreshold = input.drivingBeforeFirstPart ?? 0;

  const pending = [...otherWork].sort((a, b) => a.afterDrivingMinutes - b.afterDrivingMinutes);
  const blocks: DrivingBlock[] = [];
  let clock = departureMinuteOfDay;
  let remaining = planned;
  let sinceBreak = continuousLimit - drivenSinceBreak;
  let today = dailyLimit - drivenToday;
  // Elapsed counters, in minutes — the inverse of `sinceBreak`/`today` above,
  // kept in step so each block can carry „how much driving since X" rather
  // than a remaining allowance the surface would have to invert itself.
  let elapsedSinceBreak = drivenSinceBreak;
  let elapsedToday = drivenToday;
  let driven = 0;
  let sinceFullBreak = 0;
  let firstPartTaken = false;
  let cursor = 0;

  const push = (
    kind: DrivingBlockKind,
    minutes: number,
    breakPart: DrivingBlock["breakPart"] = "none",
  ): void => {
    blocks.push({
      kind,
      start: clock,
      end: clock + minutes,
      minutes,
      sinceBreakAfter: elapsedSinceBreak,
      todayAfter: elapsedToday,
      breakPart,
    });
    clock += minutes;
  };

  while (blocks.length < MAX_BLOCKS) {
    // Other work first: a row booked at the total planned driving is the
    // unloading at the end, and it has to land before the walk stops.
    const due = pending[cursor];
    if (due !== undefined && due.afterDrivingMinutes <= driven) {
      push("otherWork", due.minutes);
      cursor += 1;
      continue;
    }
    if (remaining <= 0) break;
    if (today <= 0) {
      elapsedToday = 0;
      elapsedSinceBreak = 0;
      push("dailyRest", dailyRestMinutes);
      today = dailyLimit;
      sinceBreak = continuousLimit;
      sinceFullBreak = 0;
      firstPartTaken = false;
      continue;
    }
    if (sinceBreak <= 0) {
      elapsedSinceBreak = 0;
      push(
        "break",
        firstPartTaken ? breakMinutes - firstPart : breakMinutes,
        firstPartTaken ? "second" : "full",
      );
      sinceBreak = continuousLimit;
      sinceFullBreak = 0;
      firstPartTaken = false;
      continue;
    }
    if (splitBreak && !firstPartTaken && sinceFullBreak >= splitThreshold) {
      // The first part buys nothing back — that is what makes it the first
      // part — so `elapsedSinceBreak` is deliberately left untouched here.
      push("break", firstPart, "first");
      firstPartTaken = true;
      continue;
    }
    let step = Math.min(sinceBreak, today, remaining);
    const next = pending[cursor];
    if (next !== undefined) step = Math.min(step, next.afterDrivingMinutes - driven);
    if (splitBreak && !firstPartTaken) step = Math.min(step, splitThreshold - sinceFullBreak);
    if (step <= 0) break; // No progress is possible; show what there is.
    elapsedSinceBreak += step;
    elapsedToday += step;
    push("drive", step);
    remaining -= step;
    sinceBreak -= step;
    today -= step;
    driven += step;
    sinceFullBreak += step;
  }

  const total = (kind: DrivingBlockKind): number =>
    sumOf(
      blocks.filter((block) => block.kind === kind),
      (block) => block.minutes,
    );

  return {
    ok: true,
    blocks,
    arrival: clock,
    arrivalDayOffset: Math.floor(clock / MIN_PER_DAY),
    arrivalMinuteOfDay: clock - Math.floor(clock / MIN_PER_DAY) * MIN_PER_DAY,
    elapsedMinutes: clock - departureMinuteOfDay,
    drivingMinutes: total("drive"),
    breakMinutes: total("break"),
    restMinutes: total("dailyRest"),
    otherWorkMinutes: total("otherWork"),
    sinceBreak: figure(continuousLimit - sinceBreak, continuousLimit),
    today: figure(dailyLimit - today, dailyLimit),
    continuousLimitReachedAt: clock + Math.max(sinceBreak, 0),
    dailyLimitReachedAt: clock + Math.max(today, 0),
    remainingDriving: Math.max(remaining, 0),
    truncated: remaining > 0,
    unplacedOtherWork: pending.slice(cursor),
  };
}

/* -------------------------------------------------------------------------- */
/* Procena dolaska — ETA with stops                                            */
/* -------------------------------------------------------------------------- */

export interface EtaInput {
  readonly distance: number;
  /** Average speed WHILE MOVING, km/h — the user's planning assumption. */
  readonly averageSpeed: number;
  readonly departureMinuteOfDay: number;
  /** Breaks, border and ferry waits, loading and unloading — minutes, any number of rows. */
  readonly stopMinutes: readonly number[];
  /** Reserve as a decimal fraction: 0.05 is 5%. Applied to driving PLUS stops. */
  readonly reserve: number;
  readonly targetMinuteOfDay?: number | undefined;
  /** Whole days between the departure date and the target date. */
  readonly targetDayOffset?: number | undefined;
}

export interface EtaTarget {
  /** Latest departure for the target, minutes from midnight of the departure day. */
  readonly latestDeparture: number;
  /** Target − departure, minutes. Negative when the target is before departure. */
  readonly available: number;
  /**
   * The average moving speed the entered numbers imply, km/h — arithmetic, not
   * advice about how fast to drive. Undefined when the stops alone consume the
   * available time, because then no speed exists rather than a very large one.
   */
  readonly requiredSpeed: number | undefined;
  /**
   * ta ÷ (1 + r) − Z, minutes — the denominator `requiredSpeed` divides by,
   * printed so a reader can see how far from zero it is instead of only
   * seeing the speed (or its absence) that comes out of it.
   */
  readonly minutesAvailableForDriving: number;
}

export interface Eta {
  readonly drivingMinutes: number;
  readonly stopMinutes: number;
  readonly totalMinutes: number;
  /** The total once the reserve is applied to driving AND stops together. */
  readonly totalWithReserve: number;
  readonly arrivalMinutes: number;
  readonly arrivalDayOffset: number;
  readonly arrivalMinuteOfDay: number;
  /** Distance ÷ total elapsed hours, km/h — WITH the reserve applied. */
  readonly doorToDoorSpeed: number | undefined;
  /** The same quotient WITHOUT the reserve, so the reserve's own cost is visible. */
  readonly doorToDoorSpeedNoReserve: number | undefined;
  readonly target: EtaTarget | undefined;
}

/**
 * Arrival time from a distance, a planning speed and a list of stops.
 *
 * **The reserve is applied to driving plus stops, not to driving alone**, and
 * that is stated here because both conventions are in use and they give
 * different answers: 5% of 12 hours is 36 minutes, 5% of 9 hours is 27.
 *
 * The day is carried as an offset rather than a date, so the function stays
 * free of any clock: the surface knows the departure date.
 */
export function etaWithBreaks(input: EtaInput): ProResult<Eta> {
  const { distance, averageSpeed, departureMinuteOfDay, stopMinutes, reserve } = input;
  if (!isInRange(distance, 0, 20000)) return fail("distance");
  if (!isInRange(averageSpeed, 1, 130)) return fail("averageSpeed");
  if (!isIntegerIn(departureMinuteOfDay, 0, MIN_PER_DAY - 1)) return fail("departure");
  if (!stopMinutes.every((stop) => isInRange(stop, 0, 6000))) return fail("stopMinutes");
  if (!isInRange(reserve, 0, 1)) return fail("reserve");

  const drivingMinutes = (MIN_PER_HOUR * distance) / averageSpeed;
  const stops = sumOf(stopMinutes, (stop) => stop);
  const totalMinutes = drivingMinutes + stops;
  const totalWithReserve = totalMinutes * (1 + reserve);
  const arrivalMinutes = departureMinuteOfDay + totalWithReserve;
  const arrivalDayOffset = Math.floor(arrivalMinutes / MIN_PER_DAY);

  const targetMinuteOfDay = input.targetMinuteOfDay;
  let target: EtaTarget | undefined;
  if (targetMinuteOfDay !== undefined) {
    if (!isIntegerIn(targetMinuteOfDay, 0, MIN_PER_DAY - 1)) return fail("targetTime");
    const dayOffset = input.targetDayOffset ?? 0;
    if (!isIntegerIn(dayOffset, 0, 365)) return fail("targetDayOffset");
    const targetMinutes = dayOffset * MIN_PER_DAY + targetMinuteOfDay;
    const available = targetMinutes - departureMinuteOfDay;
    const forDriving = available / (1 + reserve) - stops;
    target = {
      latestDeparture: targetMinutes - totalWithReserve,
      available,
      requiredSpeed: forDriving > 0 ? (MIN_PER_HOUR * distance) / forDriving : undefined,
      minutesAvailableForDriving: forDriving,
    };
  }

  return {
    ok: true,
    drivingMinutes,
    stopMinutes: stops,
    totalMinutes,
    totalWithReserve,
    arrivalMinutes,
    arrivalDayOffset,
    arrivalMinuteOfDay: arrivalMinutes - arrivalDayOffset * MIN_PER_DAY,
    doorToDoorSpeed: quotient(distance, totalWithReserve / MIN_PER_HOUR),
    doorToDoorSpeedNoReserve: quotient(distance, totalMinutes / MIN_PER_HOUR),
    target,
  };
}

/* -------------------------------------------------------------------------- */
/* Servisni interval — service interval by km, engine hours and months         */
/* -------------------------------------------------------------------------- */

/** A date with no clock and no zone: the calendar day itself. */
export interface CivilDate {
  readonly year: number;
  /** 1 = January. */
  readonly month: number;
  readonly day: number;
}

/**
 * Days since 1970-01-01, by Howard Hinnant's civil-calendar algorithm.
 *
 * Written out rather than delegated to `Date`, because `new Date(y, m, d)` is a
 * LOCAL-time construction: the same three numbers give different day counts
 * either side of a DST boundary, and „64 days from today" is then occasionally
 * 63. Pure integer arithmetic has no such day.
 */
function daysFromCivil(date: CivilDate): number {
  const shifted = date.year - (date.month <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const marchMonth = (date.month + 9) % 12;
  const dayOfYear = Math.floor((153 * marchMonth + 2) / 5) + date.day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The inverse of `daysFromCivil`. */
function civilFromDays(days: number): CivilDate {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const marchMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * marchMonth + 2) / 5) + 1;
  const month = marchMonth < 10 ? marchMonth + 3 : marchMonth - 9;
  return { year: year + (month <= 2 ? 1 : 0), month, day };
}

function isValidDate(date: CivilDate): boolean {
  if (!isIntegerIn(date.year, 1, 9999)) return false;
  if (!isIntegerIn(date.month, 1, 12)) return false;
  return isIntegerIn(date.day, 1, daysInMonth(date.year, date.month));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Add whole months, clamping the day to the end of the target month.
 *
 * 31 January plus one month is 28 or 29 February, not 3 March: a service due
 * „in 12 months" is due on a day that exists.
 */
function addMonths(date: CivilDate, months: number): CivilDate {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export type ServiceBasisName = "distance" | "hours" | "months";

export interface ServiceBasis {
  /** Interval − used, in the basis's own unit (km, engine hours, or days). */
  readonly remaining: number;
  /**
   * Whole days from today at the user's own daily average, rounded AWAY FROM
   * ZERO — `Math.ceil` alone turns a small overdue amount into `-0` and reads
   * as due today instead of overdue. Undefined when the daily average is zero.
   */
  readonly days: number | undefined;
  readonly date: CivilDate | undefined;
  /**
   * The absolute reading at which this basis falls due — last-service reading
   * plus the interval, in the basis's own unit. What goes on a work order,
   * as distinct from `remaining`, which is relative to today's reading.
   */
  readonly dueAt: number | undefined;
}

export interface ServiceIntervalInput {
  readonly currentKm: number;
  readonly lastServiceKm: number;
  /** Interval from the vehicle's service book. Absent or 0 switches the basis off. */
  readonly distanceInterval?: number | undefined;
  readonly currentHours: number;
  readonly lastServiceHours: number;
  readonly hoursInterval?: number | undefined;
  readonly lastServiceDate?: CivilDate | undefined;
  readonly monthsInterval?: number | undefined;
  /** The user's own planning averages. */
  readonly kmPerDay: number;
  readonly hoursPerDay: number;
  readonly today: CivilDate;
}

export interface ServiceIntervalResult {
  readonly travelledKm: number;
  readonly travelledHours: number;
  readonly distance: ServiceBasis | undefined;
  readonly hours: ServiceBasis | undefined;
  readonly months: ServiceBasis | undefined;
  /** Which basis falls due first, and how many days before the next one does. */
  readonly first: ServiceBasisName | undefined;
  readonly daysToNext: number | undefined;
  /** Δkm ÷ Δh — this vehicle's own average between the two services, km/h. */
  readonly kmPerEngineHour: number | undefined;
  /** The distance interval expressed in engine hours, and the reverse. */
  readonly distanceIntervalInHours: number | undefined;
  readonly hoursIntervalInKm: number | undefined;
}

/**
 * Which service basis falls due first — distance, engine hours or months.
 *
 * The dates are estimates from the daily averages the user typed, and the
 * intervals are the numbers in the vehicle's own service book; the tool holds
 * no schedule for any vehicle. An overdue basis comes back as a NEGATIVE
 * remainder and a date in the past rather than as a zero, because „30 000 km
 * overdue" and „due now" are not the same fact.
 */
export function serviceInterval(input: ServiceIntervalInput): ProResult<ServiceIntervalResult> {
  const { currentKm, lastServiceKm, currentHours, lastServiceHours, kmPerDay, hoursPerDay } = input;
  if (!isInRange(currentKm, 0, 9999999)) return fail("currentKm");
  if (!isInRange(lastServiceKm, 0, 9999999)) return fail("lastServiceKm");
  if (!isInRange(currentHours, 0, 200000)) return fail("currentHours");
  if (!isInRange(lastServiceHours, 0, 200000)) return fail("lastServiceHours");
  if (!isInRange(kmPerDay, 0, 3000)) return fail("kmPerDay");
  if (!isInRange(hoursPerDay, 0, 24)) return fail("hoursPerDay");
  if (!isValidDate(input.today)) return fail("today");

  const travelledKm = currentKm - lastServiceKm;
  const travelledHours = currentHours - lastServiceHours;
  if (travelledKm < 0) return fail("currentKm");
  if (travelledHours < 0) return fail("currentHours");

  const todayDay = daysFromCivil(input.today);
  // An overdue basis (remaining < 0) rounds AWAY from zero — floor, not ceil —
  // because `Math.ceil(-0.3)` is `-0`, which would print „due today" for a
  // basis that is in fact already overdue.
  const byRate = (remaining: number, perDay: number, dueAt: number | undefined): ServiceBasis => {
    if (!isPositive(perDay)) return { remaining, days: undefined, date: undefined, dueAt };
    const days = remaining < 0 ? Math.floor(remaining / perDay) : Math.ceil(remaining / perDay);
    return { remaining, days, date: civilFromDays(todayDay + days), dueAt };
  };

  const distanceInterval = input.distanceInterval;
  const distance =
    distanceInterval !== undefined && isPositive(distanceInterval)
      ? byRate(distanceInterval - travelledKm, kmPerDay, lastServiceKm + distanceInterval)
      : undefined;
  const hoursInterval = input.hoursInterval;
  const hours =
    hoursInterval !== undefined && isPositive(hoursInterval)
      ? byRate(hoursInterval - travelledHours, hoursPerDay, lastServiceHours + hoursInterval)
      : undefined;

  const monthsInterval = input.monthsInterval;
  const lastServiceDate = input.lastServiceDate;
  let months: ServiceBasis | undefined;
  if (monthsInterval !== undefined && isPositive(monthsInterval) && lastServiceDate !== undefined) {
    if (!isValidDate(lastServiceDate)) return fail("lastServiceDate");
    if (!isIntegerIn(monthsInterval, 1, 120)) return fail("monthsInterval");
    const due = addMonths(lastServiceDate, monthsInterval);
    const days = daysFromCivil(due) - todayDay;
    // The months basis is due on a DATE, not a reading — there is no reading
    // to report and `dueAt` stays undefined, unlike the other two bases.
    months = { remaining: days, days, date: due, dueAt: undefined };
  }

  const dated = (
    [
      ["distance", distance],
      ["hours", hours],
      ["months", months],
    ] as const
  )
    .flatMap(([name, basis]) =>
      basis?.date === undefined ? [] : [{ name, day: daysFromCivil(basis.date) }],
    )
    .sort((a, b) => a.day - b.day);

  const firstEntry = dated[0];
  const secondEntry = dated[1];

  const kmPerEngineHour = quotient(travelledKm, travelledHours);
  return {
    ok: true,
    travelledKm,
    travelledHours,
    distance,
    hours,
    months,
    first: firstEntry?.name,
    daysToNext:
      firstEntry === undefined || secondEntry === undefined
        ? undefined
        : secondEntry.day - firstEntry.day,
    kmPerEngineHour,
    // A zero interval is the documented „basis switched off" (same as the
    // basis itself, above), not zero hours or zero kilometres — `isPositive`
    // rather than `=== undefined` so the switched-off state reads the same
    // way in every row that derives from the interval.
    distanceIntervalInHours:
      isPositive(distanceInterval) && kmPerEngineHour !== undefined
        ? quotient(distanceInterval, kmPerEngineHour)
        : undefined,
    hoursIntervalInKm:
      isPositive(hoursInterval) && kmPerEngineHour !== undefined
        ? hoursInterval * kmPerEngineHour
        : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Potrošnja i cena goriva — fuel consumption and cost                         */
/* -------------------------------------------------------------------------- */

export interface FuelConsumptionInput {
  /** Distance, km. Ignored when both odometer readings are given. */
  readonly distance: number;
  readonly odometerStart?: number | undefined;
  readonly odometerEnd?: number | undefined;
  readonly litres: number;
  /** Price per litre — the market's number, which this tool does not know. */
  readonly pricePerLitre: number;
  /** Cargo mass, t. Zero switches the tonne-kilometre rows off entirely. */
  readonly cargoTonnes: number;
  /**
   * Distance actually run LADEN, km — defaults to `distance` when absent. A
   * mixed trip with empty running should not have that empty distance
   * counted as if the cargo travelled it too; which figure was used comes
   * back in `ladenDistance` so a surface can show it.
   */
  readonly ladenDistance?: number | undefined;
  /** Fuel left in the tank, l. Zero switches the range row off. */
  readonly fuelRemaining: number;
}

export interface FuelConsumption {
  readonly distance: number;
  /** l/100 km. */
  readonly per100Km: number;
  /** km/l. */
  readonly kmPerLitre: number;
  readonly mpgUs: number;
  readonly mpgImperial: number;
  readonly totalCost: number;
  /** Total cost ÷ distance — computed once so it cannot drift from the total. */
  readonly costPerKm: number;
  /** The distance that entered `tonneKm` — `ladenDistance` if given, else `distance`. */
  readonly tonneKmDistance: number | undefined;
  readonly tonneKm: number | undefined;
  readonly litresPer100TonneKm: number | undefined;
  readonly costPerTonneKm: number | undefined;
  /** Remaining fuel at the same consumption, km. A quotient, not a promise. */
  readonly range: number | undefined;
}

/**
 * Consumption and cost from a distance and a quantity of fuel.
 *
 * **`costPerKm` is `total ÷ distance`, not `l/100 km × price ÷ 100`.** They are
 * the same number until each is rounded for display, and then they are not; one
 * expression means the two figures on the screen can never disagree.
 *
 * A price of zero is allowed — fuel from an own pump is a real case — and then
 * every money row is honestly zero.
 */
export function fuelConsumption(input: FuelConsumptionInput): ProResult<FuelConsumption> {
  const { litres, pricePerLitre, cargoTonnes, fuelRemaining } = input;
  const start = input.odometerStart;
  const end = input.odometerEnd;
  let distance = input.distance;
  if (start !== undefined || end !== undefined) {
    // Half-filled is refused rather than silently falling back to the typed
    // `distance` — a reader who typed one reading has no way to tell the two
    // apart otherwise.
    if (start === undefined || end === undefined) return fail("odometer");
    if (!isInRange(start, 0, 9999999) || !isInRange(end, 0, 9999999)) return fail("odometer");
    distance = end - start;
    if (distance <= 0) return fail("odometer");
  }
  if (!isInRange(distance, 0.1, 100000)) return fail("distance");
  if (!isInRange(litres, 0.01, 5000)) return fail("litres");
  if (!isInRange(pricePerLitre, 0, 100000)) return fail("pricePerLitre");
  if (!isInRange(cargoTonnes, 0, 100)) return fail("cargoTonnes");
  if (!isInRange(fuelRemaining, 0, 5000)) return fail("fuelRemaining");
  const ladenDistanceInput = input.ladenDistance;
  if (ladenDistanceInput !== undefined && !isInRange(ladenDistanceInput, 0, 100000)) {
    return fail("ladenDistance");
  }

  const kmPerLitre = distance / litres;
  const totalCost = litres * pricePerLitre;
  const tonneKmDistance = cargoTonnes > 0 ? (ladenDistanceInput ?? distance) : undefined;
  const tonneKm = tonneKmDistance === undefined ? undefined : cargoTonnes * tonneKmDistance;

  return {
    ok: true,
    distance,
    per100Km: (100 * litres) / distance,
    kmPerLitre,
    mpgUs: (kmPerLitre * L_PER_US_GALLON) / KM_PER_MILE,
    mpgImperial: (kmPerLitre * L_PER_IMP_GALLON) / KM_PER_MILE,
    totalCost,
    costPerKm: totalCost / distance,
    tonneKmDistance,
    tonneKm,
    // `tonneKm` can be a defined ZERO — cargo carried over a laden distance of
    // 0 — and `=== undefined` alone would let that reach a division and print
    // Infinity (or NaN at a price of 0). `quotient` refuses the zero divisor.
    litresPer100TonneKm: tonneKm === undefined ? undefined : quotient(100 * litres, tonneKm),
    costPerTonneKm: tonneKm === undefined ? undefined : quotient(totalCost, tonneKm),
    range: fuelRemaining > 0 ? fuelRemaining * kmPerLitre : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Potrošnja hladnjače — reefer unit fuel use                                  */
/* -------------------------------------------------------------------------- */

export interface ReeferFuelInput {
  /**
   * Hours in continuous, start-stop and pull-down running, and l/h for each.
   * A rate left empty is NOT a rate of zero: a mode with hours but no rate is
   * excluded from the totals rather than silently costed at nothing, and
   * comes back in `omittedModes` so the gap is visible.
   */
  readonly continuousHours: number;
  readonly continuousRate?: number | undefined;
  readonly startStopHours: number;
  readonly startStopRate?: number | undefined;
  readonly pullDownHours: number;
  readonly pullDownRate?: number | undefined;
  readonly pricePerLitre: number;
  /** Fuel in the unit's own tank, l. Zero switches the autonomy quotient off. */
  readonly tankLitres: number;
  /** Fuel the tractor burned on the same trip, l. Zero switches the share off. */
  readonly tractionLitres: number;
  readonly pallets: number;
  readonly days: number;
}

export type ReeferMode = "continuous" | "startStop" | "pullDown";

/** A running mode whose hours entered the trip but whose rate was never typed. */
export interface ReeferOmittedMode {
  readonly mode: ReeferMode;
  readonly hours: number;
}

export interface ReeferFuel {
  readonly litres: number;
  readonly hours: number;
  /** Modes left out of `litres`/`hours` entirely — hours without a rate. */
  readonly omittedModes: readonly ReeferOmittedMode[];
  /** Litres ÷ hours — undefined when nothing ran. */
  readonly averageRate: number | undefined;
  readonly cost: number;
  readonly litresPerDay: number | undefined;
  readonly costPerDay: number | undefined;
  readonly litresPerPalletDay: number | undefined;
  readonly costPerPalletDay: number | undefined;
  /**
   * Litres and cost for the whole trip, per pallet — billed by the pallet,
   * not the pallet-day.
   */
  readonly litresPerPallet: number | undefined;
  readonly costPerPallet: number | undefined;
  /** Tank ÷ average rate, in hours and in days. A quotient, not a guaranteed run. */
  readonly autonomyHours: number | undefined;
  readonly autonomyDays: number | undefined;
  /**
   * `autonomyDays` assumes round-the-clock running (÷ 24). When the trip's
   * own hours-per-day are known (`days` and `hours` both given), the same
   * tank expressed at THAT daily rate instead — A ÷ (H ÷ d).
   */
  readonly autonomyDaysAtTripRate: number | undefined;
  /**
   * Tank ÷ each mode's own rate, hours — the mode that follows, not the
   * mixture already burned.
   */
  readonly autonomyContinuousHours: number | undefined;
  readonly autonomyStartStopHours: number | undefined;
  readonly autonomyPullDownHours: number | undefined;
  /** Unit fuel ÷ (unit + traction) fuel, as a fraction. */
  readonly shareOfTripFuel: number | undefined;
}

/**
 * Fuel the refrigeration unit burns, from hours per running mode.
 *
 * This computes fuel and nothing else. Temperature, set point, cooling mode and
 * the state of the load are not inputs and no statement about the cold chain
 * comes out — the unit's own consumption figures are from its manual or the
 * operator's own measurement, and the tool has no default for any of them.
 */
export function reeferFuelUse(input: ReeferFuelInput): ProResult<ReeferFuel> {
  const {
    continuousHours,
    continuousRate,
    startStopHours,
    startStopRate,
    pullDownHours,
    pullDownRate,
    pricePerLitre,
    tankLitres,
    tractionLitres,
    pallets,
    days,
  } = input;
  if (!isInRange(continuousHours, 0, 2000)) return fail("continuousHours");
  if (!isInRange(startStopHours, 0, 2000)) return fail("startStopHours");
  if (!isInRange(pullDownHours, 0, 200)) return fail("pullDownHours");
  if (continuousRate !== undefined && !isInRange(continuousRate, 0, 30)) {
    return fail("continuousRate");
  }
  if (startStopRate !== undefined && !isInRange(startStopRate, 0, 30)) return fail("startStopRate");
  if (pullDownRate !== undefined && !isInRange(pullDownRate, 0, 30)) return fail("pullDownRate");
  if (!isInRange(pricePerLitre, 0, 100000)) return fail("pricePerLitre");
  if (!isInRange(tankLitres, 0, 1000)) return fail("tankLitres");
  if (!isInRange(tractionLitres, 0, 5000)) return fail("tractionLitres");
  if (!isIntegerIn(pallets, 0, 100)) return fail("pallets");
  if (!isInRange(days, 0, 90)) return fail("days");

  // A mode with hours but no rate is excluded from L and H entirely — an
  // empty rate field is not a rate of zero, and treating it as one would
  // quietly depress the average rate the surviving modes are judged against.
  const modes: readonly {
    readonly mode: ReeferMode;
    readonly hours: number;
    readonly rate: number | undefined;
  }[] = [
    { mode: "continuous", hours: continuousHours, rate: continuousRate },
    { mode: "startStop", hours: startStopHours, rate: startStopRate },
    { mode: "pullDown", hours: pullDownHours, rate: pullDownRate },
  ];
  const omittedModes = modes
    .filter((m) => m.hours > 0 && m.rate === undefined)
    .map((m) => ({ mode: m.mode, hours: m.hours }));
  const included = modes.filter((m) => !(m.hours > 0 && m.rate === undefined));

  const litres = sumOf(included, (m) => m.hours * (m.rate ?? 0));
  const hours = sumOf(included, (m) => m.hours);
  const averageRate = quotient(litres, hours);
  const cost = litres * pricePerLitre;
  const palletDays = pallets * days;

  // `averageRate` can be a defined ZERO — every included mode typed at 0 l/h,
  // e.g. a reefer on electric standby — and `=== undefined` alone would let
  // that reach a division and print Infinity. `quotient` refuses it, and the
  // two derived autonomy figures are built from the same guarded value so the
  // fix cannot drift between them.
  const autonomyHours =
    averageRate === undefined || tankLitres <= 0 ? undefined : quotient(tankLitres, averageRate);

  return {
    ok: true,
    litres,
    hours,
    omittedModes,
    averageRate,
    cost,
    litresPerDay: quotient(litres, days),
    costPerDay: quotient(cost, days),
    litresPerPalletDay: quotient(litres, palletDays),
    costPerPalletDay: quotient(cost, palletDays),
    litresPerPallet: quotient(litres, pallets),
    costPerPallet: quotient(cost, pallets),
    autonomyHours,
    autonomyDays: autonomyHours === undefined ? undefined : autonomyHours / 24,
    autonomyDaysAtTripRate:
      autonomyHours === undefined || days <= 0 || hours <= 0
        ? undefined
        : autonomyHours / (hours / days),
    autonomyContinuousHours:
      continuousRate === undefined || tankLitres <= 0
        ? undefined
        : quotient(tankLitres, continuousRate),
    autonomyStartStopHours:
      startStopRate === undefined || tankLitres <= 0
        ? undefined
        : quotient(tankLitres, startStopRate),
    autonomyPullDownHours:
      pullDownRate === undefined || tankLitres <= 0
        ? undefined
        : quotient(tankLitres, pullDownRate),
    shareOfTripFuel: tractionLitres > 0 ? quotient(litres, litres + tractionLitres) : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Trošak po kilometru — cost per kilometre                                    */
/* -------------------------------------------------------------------------- */

export interface CostPerKmInput {
  /** Fixed costs for the year, RSD — leasing, insurance, wages, everything. */
  readonly fixedAnnual: number;
  readonly annualKm: number;
  /** Empty running as a decimal fraction: 0.15 is 15%. */
  readonly emptyShare: number;
  /** l/100 km. Absent leaves fuel out of the total rather than assuming it. */
  readonly consumptionPer100Km?: number | undefined;
  readonly fuelPrice?: number | undefined;
  readonly tyreSetPrice?: number | undefined;
  readonly tyreLifeKm?: number | undefined;
  readonly servicePrice?: number | undefined;
  readonly serviceIntervalKm?: number | undefined;
  readonly repairsPerKm: number;
  /** AdBlue as a decimal fraction of diesel volume: 0.05 is 5%. */
  readonly adBlueShare?: number | undefined;
  readonly adBluePrice?: number | undefined;
  /** Margin ON PRICE and markup ON COST, both as decimal fractions. */
  readonly marginOnPrice?: number | undefined;
  readonly markupOnCost?: number | undefined;
  readonly workingDays: number;
}

export interface CostPerKm {
  readonly fixedPerKm: number;
  readonly fuelPerKm: number | undefined;
  readonly tyresPerKm: number | undefined;
  readonly servicePerKm: number | undefined;
  readonly repairsPerKm: number;
  readonly adBluePerKm: number | undefined;
  readonly variablePerKm: number;
  readonly totalPerKm: number;
  readonly ladenKm: number;
  /** Annual km − laden km — the empty running, in kilometres. */
  readonly emptyKm: number;
  /** The same annual cost spread over the laden kilometres only. */
  readonly perLadenKm: number | undefined;
  readonly annualCost: number;
  /**
   * (C100/100)·a·Kt, litres — the year's AdBlue volume, checkable against the
   * supplier's invoice.
   */
  readonly annualAdBlueLitres: number | undefined;
  readonly perWorkingDay: number | undefined;
  /** Price at a margin on price, and at a markup on cost — both, side by side. */
  readonly priceAtMargin: number | undefined;
  readonly priceAtMarkup: number | undefined;
  /** The markup that reconciles with `marginOnPrice`: u = m/(1 − m). Same price either way. */
  readonly markupEquivalent: number | undefined;
}

/**
 * What a kilometre costs, and what a LADEN kilometre costs.
 *
 * The laden figure is written `c·Kt/Kl` rather than `c/(1 − e)` — the same
 * number, but the form shows what is happening: one year's cost spread over
 * fewer kilometres, because the empty ones still have to be paid for.
 *
 * **Margin on price and markup on cost are both returned.** The same 20% gives
 * different prices (÷0.80 against ×1.20), and a tool that showed one of them
 * would be picking a side in an argument every haulier has already had.
 *
 * A missing consumption or tyre life LEAVES ITS LINE OUT of the total instead
 * of contributing a zero, so an incomplete total is visibly incomplete.
 */
export function costPerKm(input: CostPerKmInput): ProResult<CostPerKm> {
  const { fixedAnnual, annualKm, emptyShare, repairsPerKm, workingDays } = input;
  if (!isInRange(fixedAnnual, 0, 1e9)) return fail("fixedAnnual");
  if (!isInRange(annualKm, 1, 1000000)) return fail("annualKm");
  if (!isInRange(emptyShare, 0, 0.99)) return fail("emptyShare");
  if (!isInRange(repairsPerKm, 0, 10000)) return fail("repairsPerKm");
  if (!isIntegerIn(workingDays, 1, 366)) return fail("workingDays");

  const consumption = input.consumptionPer100Km;
  const fuelPrice = input.fuelPrice;
  if (consumption !== undefined && !isInRange(consumption, 0, 200)) return fail("consumption");
  if (fuelPrice !== undefined && !isInRange(fuelPrice, 0, 100000)) return fail("fuelPrice");
  const fuelPerKm =
    consumption === undefined || fuelPrice === undefined
      ? undefined
      : (consumption / 100) * fuelPrice;

  const tyreSetPrice = input.tyreSetPrice;
  if (tyreSetPrice !== undefined && !isInRange(tyreSetPrice, 0, 1e8)) return fail("tyreSetPrice");
  const tyreLifeKm = input.tyreLifeKm;
  const tyresPerKm =
    tyreSetPrice === undefined || tyreLifeKm === undefined || !isPositive(tyreLifeKm)
      ? undefined
      : tyreSetPrice / tyreLifeKm;

  const servicePrice = input.servicePrice;
  if (servicePrice !== undefined && !isInRange(servicePrice, 0, 1e8)) return fail("servicePrice");
  const serviceKm = input.serviceIntervalKm;
  const servicePerKm =
    servicePrice === undefined || serviceKm === undefined || !isPositive(serviceKm)
      ? undefined
      : servicePrice / serviceKm;

  const adBlueShare = input.adBlueShare;
  if (adBlueShare !== undefined && !isInRange(adBlueShare, 0, 0.2)) return fail("adBlueShare");
  const adBluePrice = input.adBluePrice;
  if (adBluePrice !== undefined && !isInRange(adBluePrice, 0, 100000)) return fail("adBluePrice");
  const adBluePerKm =
    consumption === undefined || adBlueShare === undefined || adBluePrice === undefined
      ? undefined
      : (consumption / 100) * adBlueShare * adBluePrice;

  const marginOnPrice = input.marginOnPrice;
  if (marginOnPrice !== undefined && !isInRange(marginOnPrice, 0, 0.95)) {
    return fail("marginOnPrice");
  }
  const markupOnCost = input.markupOnCost;
  if (markupOnCost !== undefined && !isInRange(markupOnCost, 0, 5)) return fail("markupOnCost");

  const variablePerKm =
    (fuelPerKm ?? 0) + (tyresPerKm ?? 0) + (servicePerKm ?? 0) + repairsPerKm + (adBluePerKm ?? 0);
  const fixedPerKm = fixedAnnual / annualKm;
  const totalPerKm = fixedPerKm + variablePerKm;
  const ladenKm = annualKm * (1 - emptyShare);
  const annualCost = totalPerKm * annualKm;
  const perLadenKm = quotient(annualCost, ladenKm);
  const annualAdBlueLitres =
    consumption === undefined || adBlueShare === undefined
      ? undefined
      : (consumption / 100) * adBlueShare * annualKm;

  return {
    ok: true,
    fixedPerKm,
    fuelPerKm,
    tyresPerKm,
    servicePerKm,
    repairsPerKm,
    adBluePerKm,
    variablePerKm,
    totalPerKm,
    ladenKm,
    emptyKm: annualKm - ladenKm,
    perLadenKm,
    annualCost,
    annualAdBlueLitres,
    perWorkingDay: annualCost / workingDays,
    priceAtMargin:
      perLadenKm === undefined || marginOnPrice === undefined
        ? undefined
        : perLadenKm / (1 - marginOnPrice),
    priceAtMarkup:
      perLadenKm === undefined || markupOnCost === undefined
        ? undefined
        : perLadenKm * (1 + markupOnCost),
    markupEquivalent: marginOnPrice === undefined ? undefined : marginOnPrice / (1 - marginOnPrice),
  };
}

/* -------------------------------------------------------------------------- */
/* Cena ture — trip cost and quote                                             */
/* -------------------------------------------------------------------------- */

export type MarginMethod = "onPrice" | "onCost";

export interface TripCostInput {
  readonly ladenKm: number;
  readonly emptyKm: number;
  /** Cost per kilometre — from `costPerKm` or typed. */
  readonly costPerKm: number;
  readonly tolls: number;
  readonly ferriesAndVignettes: number;
  readonly terminalCharges: number;
  readonly waitingHours: number;
  readonly waitingRate: number;
  readonly days: number;
  /** Per diem, RSD/day — the state sets it and changes it; this tool has none. */
  readonly perDiem: number;
  readonly nights: number;
  readonly nightRate: number;
  readonly otherCosts: number;
  readonly marginMethod: MarginMethod;
  /** Both as decimal fractions; only the chosen method's rate is used. */
  readonly marginOnPrice?: number | undefined;
  readonly markupOnCost?: number | undefined;
  /** VAT rate as a decimal fraction. Absent leaves every VAT row out. */
  readonly vatRate?: number | undefined;
  readonly cargoTonnes: number;
}

export interface TripCost {
  readonly totalKm: number;
  readonly drivingCost: number;
  readonly roadCost: number;
  readonly driverCost: number;
  readonly totalCost: number;
  /** Price before VAT at the chosen margin method. */
  readonly priceBeforeVat: number;
  /** Price before VAT at a margin on price — undefined when no margin rate was given. */
  readonly priceAtMargin: number | undefined;
  /** Price before VAT at a markup on cost — undefined when no markup rate was given. */
  readonly priceAtMarkup: number | undefined;
  /** The markup that reconciles with `marginOnPrice`: u = m/(1 − m). Same price either way. */
  readonly markupEquivalent: number | undefined;
  /** Price at zero margin — the cost itself — and the cost per kilometre it implies. */
  readonly breakEvenPrice: number;
  readonly breakEvenPricePerKm: number | undefined;
  readonly profit: number;
  readonly profitPerDay: number | undefined;
  /** Profit ÷ price, and profit ÷ cost — the same margin read two ways. */
  readonly profitShareOfPrice: number | undefined;
  readonly profitShareOfCost: number | undefined;
  readonly vat: number | undefined;
  readonly priceWithVat: number | undefined;
  readonly pricePerKm: number | undefined;
  readonly pricePerLadenKm: number | undefined;
  readonly pricePerTonne: number | undefined;
}

/**
 * The cost of one trip, and the price a chosen margin produces.
 *
 * The per diem and the VAT rate are `regulated`-tier numbers: the state sets
 * both and changes both. They are inputs with no default, and nothing here says
 * that any amount is deductible or that any rate is the right one — it adds up
 * the numbers that were typed.
 *
 * A margin on price of 1 or more is refused rather than clamped: `C/(1 − 1)` is
 * not a large price, it is no price at all.
 */
export function tripCostQuote(input: TripCostInput): ProResult<TripCost> {
  const {
    ladenKm,
    emptyKm,
    costPerKm: rate,
    tolls,
    ferriesAndVignettes,
    terminalCharges,
    waitingHours,
    waitingRate,
    days,
    perDiem,
    nights,
    nightRate,
    otherCosts,
    marginMethod,
    cargoTonnes,
  } = input;
  if (!isInRange(ladenKm, 0, 20000)) return fail("ladenKm");
  if (!isInRange(emptyKm, 0, 20000)) return fail("emptyKm");
  if (!isInRange(rate, 0, 100000)) return fail("costPerKm");
  if (!isInRange(tolls, 0, 1e8)) return fail("tolls");
  if (!isInRange(ferriesAndVignettes, 0, 1e8)) return fail("ferriesAndVignettes");
  if (!isInRange(terminalCharges, 0, 1e8)) return fail("terminalCharges");
  if (!isInRange(waitingHours, 0, 500)) return fail("waitingHours");
  if (!isInRange(waitingRate, 0, 1000000)) return fail("waitingRate");
  if (!isIntegerIn(days, 0, 90)) return fail("days");
  if (!isInRange(perDiem, 0, 1000000)) return fail("perDiem");
  if (!isIntegerIn(nights, 0, 90)) return fail("nights");
  if (!isInRange(nightRate, 0, 1000000)) return fail("nightRate");
  if (!isInRange(otherCosts, 0, 1e8)) return fail("otherCosts");
  if (!isInRange(cargoTonnes, 0, 100)) return fail("cargoTonnes");

  const totalKm = ladenKm + emptyKm;
  const drivingCost = totalKm * rate;
  const roadCost =
    tolls + ferriesAndVignettes + terminalCharges + waitingHours * waitingRate + otherCosts;
  const driverCost = days * perDiem + nights * nightRate;
  const totalCost = drivingCost + roadCost + driverCost;

  const marginOnPrice = input.marginOnPrice;
  if (marginOnPrice !== undefined && !isInRange(marginOnPrice, 0, 0.95)) {
    return fail("marginOnPrice");
  }
  const markupOnCost = input.markupOnCost;
  if (markupOnCost !== undefined && !isInRange(markupOnCost, 0, 5)) return fail("markupOnCost");

  // Both methods are computed independently, whichever rates were given — the
  // chosen `marginMethod` only decides which one is ALSO `priceBeforeVat`,
  // the figure VAT and profit are computed from.
  const priceAtMargin = marginOnPrice === undefined ? undefined : totalCost / (1 - marginOnPrice);
  const priceAtMarkup = markupOnCost === undefined ? undefined : totalCost * (1 + markupOnCost);

  let priceBeforeVat: number;
  if (marginMethod === "onPrice") {
    if (priceAtMargin === undefined) return fail("marginOnPrice");
    priceBeforeVat = priceAtMargin;
  } else {
    if (priceAtMarkup === undefined) return fail("markupOnCost");
    priceBeforeVat = priceAtMarkup;
  }

  const vatRate = input.vatRate;
  if (vatRate !== undefined && !isInRange(vatRate, 0, 1)) return fail("vatRate");

  const profit = priceBeforeVat - totalCost;

  return {
    ok: true,
    totalKm,
    drivingCost,
    roadCost,
    driverCost,
    totalCost,
    priceBeforeVat,
    priceAtMargin,
    priceAtMarkup,
    markupEquivalent: marginOnPrice === undefined ? undefined : marginOnPrice / (1 - marginOnPrice),
    breakEvenPrice: totalCost,
    breakEvenPricePerKm: quotient(totalCost, totalKm),
    profit,
    profitPerDay: quotient(profit, days),
    profitShareOfPrice: quotient(profit, priceBeforeVat),
    profitShareOfCost: quotient(profit, totalCost),
    vat: vatRate === undefined ? undefined : priceBeforeVat * vatRate,
    priceWithVat: vatRate === undefined ? undefined : priceBeforeVat * (1 + vatRate),
    pricePerKm: quotient(priceBeforeVat, totalKm),
    pricePerLadenKm: quotient(priceBeforeVat, ladenKm),
    pricePerTonne: quotient(priceBeforeVat, cargoTonnes),
  };
}

/* -------------------------------------------------------------------------- */
/* Obračunska masa — chargeable weight                                         */
/* -------------------------------------------------------------------------- */

export type ChargeableBasis = "actual" | "volumetric" | "loadingMetre" | "palletSpace";

export interface ChargeableItem {
  /** Outer dimensions of one piece, cm. */
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly quantity: number;
  readonly massPerPiece: number;
  /** How many of these stack into one floor position. Absent or 0 reads as 1. */
  readonly layers?: number | undefined;
}

export interface ChargeableWeightInput {
  readonly items: readonly ChargeableItem[];
  /** The carrier's divisor in cm³/kg — 4000, 5000, 6000. No default: it is contractual. */
  readonly divisor?: number | undefined;
  /** The same divisor written as kg/m³; converted as 10⁶ ÷ k when the other is absent. */
  readonly densityDivisor?: number | undefined;
  /** Contractual width for the loading metre, m. */
  readonly ldmWidth: number;
  readonly massPerLdm?: number | undefined;
  readonly massPerPalletSpace?: number | undefined;
  readonly palletSpaces?: number | undefined;
  readonly roundingStep: number;
  readonly rounding: "perItem" | "perShipment";
  readonly pricePerKg?: number | undefined;
}

export interface ChargeableLine {
  /** Volume of the row, m³. */
  readonly volume: number;
  readonly actualMass: number;
  readonly volumetricMass: number | undefined;
  readonly loadingMetres: number;
  /** The row's own largest included basis, kg, before rounding. */
  readonly chargeableMass: number;
}

export interface ChargeableWeight {
  readonly lines: readonly ChargeableLine[];
  readonly volume: number;
  readonly actualMass: number;
  readonly volumetricMass: number | undefined;
  readonly loadingMetres: number;
  readonly loadingMetreMass: number | undefined;
  readonly palletSpaceMass: number | undefined;
  readonly chargeableMass: number;
  /** Which basis produced the maximum. */
  readonly basis: ChargeableBasis;
  readonly roundedPerShipment: number;
  readonly roundedPerItem: number;
  /** Whichever of the two the caller asked to be billed. */
  readonly billedMass: number;
  readonly amount: number | undefined;
}

/**
 * The mass a shipment is charged on, by whichever contractual basis is largest.
 *
 * **Nothing here is a carrier's tariff.** The divisor, the loading-metre width,
 * the kilograms per loading metre and per pallet space are numbers out of the
 * user's own contract; a basis whose number is missing is left out of the
 * maximum rather than defaulted, so an answer never rests on a rate nobody
 * agreed.
 *
 * **Both rounding orders come back.** Σceil(mᵢ) and ceil(Σm) differ by up to
 * one step per row, carriers genuinely do both, and the invoice line depends on
 * which — so the tool computes both and bills the one that was asked for.
 */
export function chargeableWeight(input: ChargeableWeightInput): ProResult<ChargeableWeight> {
  const { items, ldmWidth, roundingStep, rounding } = input;
  if (items.length < 1 || items.length > 200) return fail("items");
  if (!isInRange(ldmWidth, 1, 4)) return fail("ldmWidth");
  if (!isInRange(roundingStep, 0.01, 100)) return fail("roundingStep");
  for (const row of items) {
    if (!isInRange(row.length, 0, 10000)) return fail("itemDimensions");
    if (!isInRange(row.width, 0, 10000)) return fail("itemDimensions");
    if (!isInRange(row.height, 0, 10000)) return fail("itemDimensions");
    if (!isIntegerIn(row.quantity, 0, 100000)) return fail("itemQuantity");
    if (!isInRange(row.massPerPiece, 0, 100000)) return fail("itemMass");
    if (row.layers !== undefined && !isIntegerIn(row.layers, 0, 100)) return fail("itemLayers");
  }

  // A divisor given as kg/m³ is the same contract term upside down.
  const density = input.densityDivisor;
  const divisor =
    input.divisor !== undefined && isPositive(input.divisor)
      ? input.divisor
      : density !== undefined && isPositive(density)
        ? MILLION / density
        : undefined;

  const massPerLdm = input.massPerLdm;
  const massPerPalletSpace = input.massPerPalletSpace;
  const palletSpaces = input.palletSpaces ?? 0;
  if (!isIntegerIn(palletSpaces, 0, 100)) return fail("palletSpaces");

  const lines = items.map((row) => {
    // „Empty or 0 layers" is the contract's own way of writing „not stacked",
    // not a missing number to be repaired.
    const layers = row.layers === undefined || row.layers === 0 ? 1 : row.layers;
    const cubicCm = row.length * row.width * row.height * row.quantity;
    const actualMass = row.quantity * row.massPerPiece;
    const volumetricMass = divisor === undefined ? undefined : cubicCm / divisor;
    const loadingMetres = (row.length * row.width * row.quantity) / (10000 * ldmWidth * layers);
    const rowBases = [
      actualMass,
      volumetricMass,
      massPerLdm !== undefined && massPerLdm > 0 ? loadingMetres * massPerLdm : undefined,
    ].filter((value): value is number => value !== undefined);
    return {
      volume: cubicCm / MILLION,
      actualMass,
      volumetricMass,
      loadingMetres,
      chargeableMass: Math.max(...rowBases),
    };
  });

  const volume = sumOf(lines, (line) => line.volume);
  const actualMass = sumOf(lines, (line) => line.actualMass);
  const volumetricMass = divisor === undefined ? undefined : (volume * MILLION) / divisor;
  const loadingMetres = sumOf(lines, (line) => line.loadingMetres);
  const loadingMetreMass =
    massPerLdm !== undefined && massPerLdm > 0 ? loadingMetres * massPerLdm : undefined;
  const palletSpaceMass =
    massPerPalletSpace !== undefined && massPerPalletSpace > 0 && palletSpaces > 0
      ? palletSpaces * massPerPalletSpace
      : undefined;

  const bases: readonly { readonly name: ChargeableBasis; readonly mass: number }[] = [
    { name: "actual", mass: actualMass },
    ...(volumetricMass === undefined
      ? []
      : [{ name: "volumetric" as const, mass: volumetricMass }]),
    ...(loadingMetreMass === undefined
      ? []
      : [{ name: "loadingMetre" as const, mass: loadingMetreMass }]),
    ...(palletSpaceMass === undefined
      ? []
      : [{ name: "palletSpace" as const, mass: palletSpaceMass }]),
  ];
  const best = bases.reduce((top, entry) => (entry.mass > top.mass ? entry : top));

  const roundedPerShipment = ceilToStep(best.mass, roundingStep);
  const roundedPerItem = sumOf(lines, (line) => ceilToStep(line.chargeableMass, roundingStep));
  const billedMass = rounding === "perItem" ? roundedPerItem : roundedPerShipment;
  const pricePerKg = input.pricePerKg;

  return {
    ok: true,
    lines,
    volume,
    actualMass,
    volumetricMass,
    loadingMetres,
    loadingMetreMass,
    palletSpaceMass,
    chargeableMass: best.mass,
    basis: best.name,
    roundedPerShipment,
    roundedPerItem,
    billedMass,
    amount: pricePerKg === undefined ? undefined : billedMass * pricePerKg,
  };
}

/* -------------------------------------------------------------------------- */
/* Iskorišćenje tovarnog prostora — loading space utilisation                   */
/* -------------------------------------------------------------------------- */

export interface SpaceItem {
  /** Dimensions of one piece, m. */
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly quantity: number;
  /** How many stack into one floor position. Absent or 0 reads as 1. */
  readonly layers?: number | undefined;
}

export interface SpaceUtilisationInput {
  /** Inside dimensions of the load space, m. */
  readonly innerLength: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly items: readonly SpaceItem[];
  /** Contractual width for the loading metre, m. */
  readonly ldmWidth: number;
}

export interface SpaceLine {
  readonly volume: number;
  readonly floorArea: number;
  readonly loadingMetres: number;
  /** layers × height is taller than the inside height. Geometry, stated plainly. */
  readonly tallerThanSpace: boolean;
  /** The piece's own footprint is wider than the inside width — nothing here fits it. */
  readonly widerThanSpace: boolean;
}

export interface SpaceUtilisation {
  readonly availableVolume: number;
  readonly availableFloorArea: number;
  readonly availableLoadingMetres: number;
  readonly usedVolume: number;
  readonly usedFloorArea: number;
  readonly usedLoadingMetres: number;
  readonly volumeShare: number;
  readonly floorShare: number;
  readonly loadingMetreShare: number;
  readonly remainingVolume: number;
  readonly remainingFloorArea: number;
  readonly remainingLoadingMetres: number;
  /** Used volume ÷ used floor area, m — the average stacking height. */
  readonly averageStackHeight: number | undefined;
  readonly stackHeightShare: number | undefined;
  /** Which basis came out largest. */
  readonly largestBasis: "volume" | "floor" | "loadingMetre";
  readonly lines: readonly SpaceLine[];
}

/**
 * How much of a load space a shipment uses, on all three bases at once.
 *
 * **Floor area is divided by the stacking count and volume is not**, which is
 * the whole reason the three shares differ: two layers occupy one floor
 * position but two lots of cubic metres.
 *
 * The loading-metre share is computed against the CONTRACTUAL width while the
 * floor share uses the real inside width. When the two widths are equal the two
 * shares are identical by construction; both are shown so the difference the
 * contract makes is visible instead of hidden inside one number.
 */
export function loadingSpaceUtilisation(
  input: SpaceUtilisationInput,
): ProResult<SpaceUtilisation> {
  const { innerLength, innerWidth, innerHeight, items, ldmWidth } = input;
  if (!isInRange(innerLength, 0.5, 30)) return fail("innerLength");
  if (!isInRange(innerWidth, 0.5, 4)) return fail("innerWidth");
  if (!isInRange(innerHeight, 0.3, 5)) return fail("innerHeight");
  if (!isInRange(ldmWidth, 1, 4)) return fail("ldmWidth");
  if (items.length < 1 || items.length > 200) return fail("items");
  for (const row of items) {
    if (!isInRange(row.length, 0, 100)) return fail("itemDimensions");
    if (!isInRange(row.width, 0, 100)) return fail("itemDimensions");
    if (!isInRange(row.height, 0, 100)) return fail("itemDimensions");
    if (!isIntegerIn(row.quantity, 0, 100000)) return fail("itemQuantity");
    if (row.layers !== undefined && !isIntegerIn(row.layers, 0, 100)) return fail("itemLayers");
  }

  const lines = items.map((row) => {
    const layers = row.layers === undefined || row.layers === 0 ? 1 : row.layers;
    // Floor area and loading metres go by whole COLUMNS: an incomplete top
    // layer still occupies a whole floor position — 41 pallets stacked two
    // high occupy 21 floor positions, not 20.5, and dividing by `layers`
    // directly understates both by however much the top layer is short.
    const columns = Math.ceil(row.quantity / layers);
    const columnFootprint = columns * row.length * row.width;
    return {
      volume: row.length * row.width * row.quantity * row.height,
      floorArea: columnFootprint,
      loadingMetres: columnFootprint / ldmWidth,
      // `layers` pieces are stacked vertically, so it is layers × height that
      // has to clear the inside height, not one piece's own height alone.
      tallerThanSpace: layers * row.height > innerHeight,
      widerThanSpace: Math.min(row.length, row.width) > innerWidth,
    };
  });

  const availableFloorArea = innerLength * innerWidth;
  const availableVolume = availableFloorArea * innerHeight;
  const usedVolume = sumOf(lines, (line) => line.volume);
  const usedFloorArea = sumOf(lines, (line) => line.floorArea);
  const usedLoadingMetres = sumOf(lines, (line) => line.loadingMetres);
  const volumeShare = usedVolume / availableVolume;
  const floorShare = usedFloorArea / availableFloorArea;
  const loadingMetreShare = usedLoadingMetres / innerLength;
  const averageStackHeight = quotient(usedVolume, usedFloorArea);

  // A tie is broken loadingMetre, then floor, then volume — an arbitrary but
  // fixed order, stated here so it reads as a choice and not an accident.
  const largestBasis =
    loadingMetreShare >= floorShare && loadingMetreShare >= volumeShare
      ? "loadingMetre"
      : floorShare >= volumeShare
        ? "floor"
        : "volume";

  return {
    ok: true,
    availableVolume,
    availableFloorArea,
    availableLoadingMetres: innerLength,
    usedVolume,
    usedFloorArea,
    usedLoadingMetres,
    volumeShare,
    floorShare,
    loadingMetreShare,
    remainingVolume: availableVolume - usedVolume,
    remainingFloorArea: availableFloorArea - usedFloorArea,
    remainingLoadingMetres: innerLength - usedLoadingMetres,
    averageStackHeight,
    stackHeightShare:
      averageStackHeight === undefined ? undefined : averageStackHeight / innerHeight,
    largestBasis,
    lines,
  };
}

/* -------------------------------------------------------------------------- */
/* Raspored paleta — pallet load plan                                          */
/* -------------------------------------------------------------------------- */

export interface PalletLayout {
  /** Pallets per floor in this layout. */
  readonly perFloor: number;
  /** Length of the load space this layout consumes, mm. */
  readonly usedLength: number;
  readonly remainingLength: number;
  /** perFloor × layers. */
  readonly places: number;
  /** Floor area the pallets occupy, m². */
  readonly floorArea: number;
  readonly freeFloorArea: number;
  /** usedLength as loading metres. */
  readonly loadingMetres: number;
}

export interface PalletPlanInput {
  /** Inside dimensions of the load space, m. */
  readonly innerLength: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
  /** Pallet footprint, mm. Use `PALLET_FOOTPRINTS` for the standard ones. */
  readonly palletLength: number;
  readonly palletWidth: number;
  /** Height of the LOADED pallet, mm. */
  readonly loadedHeight: number;
  readonly stacking: boolean;
  readonly maxLayers: number;
  readonly rotationAllowed: boolean;
}

export interface PalletPlan {
  /** Pallet length running along the vehicle. */
  readonly lengthwise: PalletLayout;
  /** Pallet width running along the vehicle. Undefined when rotation is barred. */
  readonly crosswise: PalletLayout | undefined;
  /** The best mix of lengthwise and crosswise bands. Undefined for a square pallet. */
  readonly combined: PalletLayout | undefined;
  /** Bands of each orientation in the combined answer. */
  readonly combinedLengthwiseBands: number | undefined;
  readonly combinedCrosswiseBands: number | undefined;
  /** Layers that fit by height: 1 without stacking, 0 when the pallet is too tall. */
  readonly layers: number;
}

/**
 * How many pallets fit on the floor, in each orientation and in the best mix.
 *
 * **This is geometry and only geometry.** Mass, axle loads, the rated capacity
 * of the pallet and how the load is secured are other tools; a count here is
 * not a statement that this many may be loaded.
 *
 * The mixed answer is an exact maximum, not a heuristic: for a fixed number of
 * lengthwise bands the count rises with the crosswise bands, so taking the most
 * crosswise bands that still fit for every possible number of lengthwise bands
 * covers every optimum — and the loop is a few dozen iterations at most.
 *
 * No gap is added between pallets. A user who wants clearance reduces the
 * inside dimensions, which is visible, where a built-in gap would not be.
 */
export function palletLoadPlan(input: PalletPlanInput): ProResult<PalletPlan> {
  const {
    innerLength,
    innerWidth,
    innerHeight,
    palletLength,
    palletWidth,
    loadedHeight,
    stacking,
    maxLayers,
    rotationAllowed,
  } = input;
  if (!isInRange(innerLength, 0.5, 30)) return fail("innerLength");
  if (!isInRange(innerWidth, 0.5, 4)) return fail("innerWidth");
  if (!isInRange(innerHeight, 0.3, 5)) return fail("innerHeight");
  if (!isInRange(palletLength, 100, 3000)) return fail("palletLength");
  if (!isInRange(palletWidth, 100, 3000)) return fail("palletWidth");
  if (!isInRange(loadedHeight, 50, 3000)) return fail("loadedHeight");
  if (!isIntegerIn(maxLayers, 1, 10)) return fail("maxLayers");

  const spaceLength = innerLength * 1000;
  const spaceWidth = innerWidth * 1000;
  const spaceHeight = innerHeight * 1000;
  const floorArea = spaceLength * spaceWidth;
  // A pallet taller than the space fits ZERO layers regardless of stacking —
  // stacking off does not mean „ignore height", it means „stack at most one".
  const fits = fitCount(spaceHeight, loadedHeight);
  const layers = fits === 0 ? 0 : stacking ? Math.min(maxLayers, fits) : 1;

  const perRowLengthwise = fitCount(spaceWidth, palletWidth);
  const perRowCrosswise = fitCount(spaceWidth, palletLength);
  const layout = (perFloor: number, usedLength: number): PalletLayout => {
    const occupied = (perFloor * palletLength * palletWidth) / MILLION;
    return {
      perFloor,
      usedLength,
      remainingLength: spaceLength - usedLength,
      places: perFloor * layers,
      floorArea: occupied,
      freeFloorArea: floorArea / MILLION - occupied,
      loadingMetres: usedLength / 1000,
    };
  };

  const rowsLengthwise = fitCount(spaceLength, palletLength);
  const lengthwise = layout(perRowLengthwise * rowsLengthwise, rowsLengthwise * palletLength);

  let crosswise: PalletLayout | undefined;
  let combined: PalletLayout | undefined;
  let combinedLengthwiseBands: number | undefined;
  let combinedCrosswiseBands: number | undefined;

  if (rotationAllowed) {
    const rowsCrosswise = fitCount(spaceLength, palletWidth);
    crosswise = layout(perRowCrosswise * rowsCrosswise, rowsCrosswise * palletWidth);
    if (palletLength !== palletWidth) {
      let bestCount = -1;
      let bestUsed = 0;
      let bestBands: readonly [number, number] = [0, 0];
      for (let bands = 0; bands <= rowsLengthwise; bands += 1) {
        const rest = spaceLength - bands * palletLength;
        const other = fitCount(rest, palletWidth);
        const count = bands * perRowLengthwise + other * perRowCrosswise;
        const used = bands * palletLength + other * palletWidth;
        // Ties go to the arrangement that leaves more floor free, which is the
        // one a loader would rather have for the same number of pallets.
        if (count > bestCount || (count === bestCount && used < bestUsed)) {
          bestCount = count;
          bestUsed = used;
          bestBands = [bands, other];
        }
      }
      combined = layout(Math.max(bestCount, 0), bestUsed);
      combinedLengthwiseBands = bestBands[0];
      combinedCrosswiseBands = bestBands[1];
    }
  }

  return {
    ok: true,
    lengthwise,
    crosswise,
    combined,
    combinedLengthwiseBands,
    combinedCrosswiseBands,
    layers,
  };
}

/* -------------------------------------------------------------------------- */
/* Odstupanje brzinomera — tyre size change                                    */
/* -------------------------------------------------------------------------- */

export interface TyreSize {
  /** Section width, mm. */
  readonly width: number;
  /** Aspect ratio, as a percentage: 70 means 70%. */
  readonly profile: number;
  /** Rim diameter, inches. */
  readonly rim: number;
}

/** Outer diameter of a tyre from its marking, mm. */
export function tyreOuterDiameter(size: TyreSize): number {
  return size.rim * MM_PER_INCH + (2 * size.width * size.profile) / 100;
}

/**
 * Rolling circumference from the marking, mm — π·D·f.
 *
 * `f` is the deflection factor: 1.000 is pure geometry, and a loaded tyre rolls
 * shorter than that. Shared by the speedometer and the gear-ratio tool so the
 * two can never drift apart, which is exactly the „four copies of the
 * arithmetic" defect this file is meant not to have.
 */
export function tyreRollingCircumference(size: TyreSize, deflection: number): number {
  return Math.PI * tyreOuterDiameter(size) * deflection;
}

export interface TyreChangeInput {
  readonly current: TyreSize;
  readonly replacement: TyreSize;
  /** Measured rolling circumference, mm. Zero means „compute it from the size". */
  readonly measuredCurrent: number;
  readonly measuredReplacement: number;
  /** Deflection factor, 0.90 to 1.00. */
  readonly deflection: number;
  /** What the speedometer reads, km/h. */
  readonly indicatedSpeed: number;
  /** What the trip computer shows, km. */
  readonly indicatedDistance: number;
  readonly desiredTrueSpeed?: number | undefined;
  /**
   * A characteristic coefficient w, imp/km — the tachograph constant printed
   * on some vehicles. Optional; when given, `wOverRatio` is the plain
   * quotient w ÷ k, arithmetic only, never a claim about instrument calibration.
   */
  readonly characteristicCoefficient?: number | undefined;
}

export interface TyreChange {
  readonly currentDiameter: number;
  readonly replacementDiameter: number;
  readonly currentCircumference: number;
  readonly replacementCircumference: number;
  /** Revolutions per kilometre for each. */
  readonly currentRevsPerKm: number;
  readonly replacementRevsPerKm: number;
  /** C₂ ÷ C₁ — everything else on this result is this number times something. */
  readonly circumferenceRatio: number;
  readonly diameterChange: number;
  readonly diameterChangeShare: number;
  /** Half the diameter change — how much the axle rises, mm. */
  readonly axleHeightChange: number;
  readonly trueSpeed: number;
  readonly indicatedForDesired: number | undefined;
  readonly trueDistance: number;
  /** Error per 100 km, km. */
  readonly errorPer100Km: number;
  /**
   * Which of the two circumferences came from a measurement rather than
   * geometry. There used to be a third flag above these, the OR of them, and
   * its own test already said what was wrong with it: it „alone cannot say"
   * anything the reader needs, because what matters is WHICH side was measured
   * — which is what these two and `mixedSource` below carry.
   */
  readonly currentFromMeasurement: boolean;
  readonly replacementFromMeasurement: boolean;
  /**
   * True when the two circumferences come from DIFFERENT sources — one
   * measured, one geometric. A measured circumference typically reads several
   * percent shorter than the geometric one for the same tyre (load
   * deflection), so mixing the two biases `circumferenceRatio` without either
   * figure being wrong on its own.
   */
  readonly mixedSource: boolean;
  /** The user's own characteristic coefficient, echoed back, and w ÷ k. */
  readonly w: number | undefined;
  readonly wOverRatio: number | undefined;
}

/**
 * What changing tyre size does to the speedometer and the odometer.
 *
 * **This is the DIFFERENCE the size change makes, not the absolute accuracy of
 * the instrument.** A speedometer has its own calibration, usually reading
 * high; nothing here can see it, so nothing here claims a true speed in an
 * absolute sense — only the ratio between two circumferences applied to what
 * the instrument reads today.
 */
export function tyreChangeDeviation(input: TyreChangeInput): ProResult<TyreChange> {
  const { current, replacement, deflection, indicatedSpeed, indicatedDistance } = input;
  for (const size of [current, replacement]) {
    if (!isInRange(size.width, 125, 495)) return fail("tyreWidth");
    if (!isInRange(size.profile, 20, 100)) return fail("tyreProfile");
    if (!isInRange(size.rim, 8, 26)) return fail("tyreRim");
  }
  if (!isInRange(deflection, 0.9, 1)) return fail("deflection");
  if (!isInRange(input.measuredCurrent, 0, 6000)) return fail("measuredCurrent");
  if (!isInRange(input.measuredReplacement, 0, 6000)) return fail("measuredReplacement");
  if (!isInRange(indicatedSpeed, 1, 250)) return fail("indicatedSpeed");
  if (!isInRange(indicatedDistance, 0, 1000000)) return fail("indicatedDistance");
  const w = input.characteristicCoefficient;
  if (w !== undefined && !isPositive(w)) return fail("characteristicCoefficient");

  const currentDiameter = tyreOuterDiameter(current);
  const replacementDiameter = tyreOuterDiameter(replacement);
  const currentFromMeasurement = input.measuredCurrent > 0;
  const replacementFromMeasurement = input.measuredReplacement > 0;
  const currentCircumference = currentFromMeasurement
    ? input.measuredCurrent
    : tyreRollingCircumference(current, deflection);
  const replacementCircumference = replacementFromMeasurement
    ? input.measuredReplacement
    : tyreRollingCircumference(replacement, deflection);

  const circumferenceRatio = replacementCircumference / currentCircumference;
  const diameterChange = replacementDiameter - currentDiameter;
  const desired = input.desiredTrueSpeed;

  return {
    ok: true,
    currentDiameter,
    replacementDiameter,
    currentCircumference,
    replacementCircumference,
    currentRevsPerKm: MILLION / currentCircumference,
    replacementRevsPerKm: MILLION / replacementCircumference,
    circumferenceRatio,
    diameterChange,
    diameterChangeShare: diameterChange / currentDiameter,
    axleHeightChange: diameterChange / 2,
    trueSpeed: indicatedSpeed * circumferenceRatio,
    indicatedForDesired:
      desired === undefined || !isPositive(desired) ? undefined : desired / circumferenceRatio,
    trueDistance: indicatedDistance * circumferenceRatio,
    errorPer100Km: 100 * (circumferenceRatio - 1),
    currentFromMeasurement,
    replacementFromMeasurement,
    mixedSource: currentFromMeasurement !== replacementFromMeasurement,
    w,
    wOverRatio: w === undefined ? undefined : w / circumferenceRatio,
  };
}

/* -------------------------------------------------------------------------- */
/* Prenosni odnos i brzina — gear ratio and road speed                         */
/* -------------------------------------------------------------------------- */

export interface GearLine {
  readonly ratio: number;
  /** ratio × final drive × transfer. */
  readonly totalRatio: number;
  /** Road speed in this gear at the entered engine speed, km/h. */
  readonly speed: number;
  /**
   * Road speed in THIS gear at the entered shift rpm — the drop alone does
   * not say at which speed the next gear begins.
   */
  readonly speedAtShiftRpm: number;
  readonly rpmAtDesiredSpeed: number | undefined;
  /** Engine speed after shifting into the next gear at the same road speed. */
  readonly rpmAfterUpshift: number | undefined;
  readonly rpmDrop: number | undefined;
}

export interface GearRoadSpeedInput {
  readonly engineRpm: number;
  readonly gearRatio: number;
  readonly finalDrive: number;
  /** Transfer case or hub reduction; 1.000 when there is none. */
  readonly transferRatio: number;
  /** Rolling circumference, mm — from `tyreRollingCircumference` or measured. */
  readonly rollingCircumference: number;
  /** The gearbox's ratios, for the table. */
  readonly gears?: readonly number[] | undefined;
  /** Engine speed at which gears are changed; the current rpm when absent. */
  readonly shiftRpm?: number | undefined;
  readonly desiredSpeed?: number | undefined;
}

export interface GearRoadSpeed {
  readonly totalRatio: number;
  /** Wheel speed, rev/min. */
  readonly wheelRpm: number;
  readonly speed: number;
  /** Road speed per 1000 engine rpm, km/h. */
  readonly speedPer1000Rpm: number;
  readonly rpmAtDesiredSpeed: number | undefined;
  readonly gearLines: readonly GearLine[];
}

/**
 * Engine speed, gearing and tyre circumference tied to road speed.
 *
 * The unit chain is the thing to get right and it is written as one expression:
 * circumference in mm × wheel rev/min is mm/min, × 60 is mm/h, ÷ 10⁶ is km/h.
 * Splitting it into steps is where a factor of 60 goes missing.
 */
export function gearRoadSpeed(input: GearRoadSpeedInput): ProResult<GearRoadSpeed> {
  const { engineRpm, gearRatio, finalDrive, transferRatio, rollingCircumference } = input;
  if (!isInRange(engineRpm, 100, 12000)) return fail("engineRpm");
  if (!isInRange(gearRatio, 0.3, 20)) return fail("gearRatio");
  if (!isInRange(finalDrive, 1, 12)) return fail("finalDrive");
  if (!isInRange(transferRatio, 0.3, 10)) return fail("transferRatio");
  if (!isInRange(rollingCircumference, 500, 5000)) return fail("rollingCircumference");

  const gears = input.gears;
  if (gears !== undefined) {
    if (gears.length < 1 || gears.length > 16) return fail("gears");
    if (!gears.every((ratio) => isInRange(ratio, 0.3, 20))) return fail("gears");
  }
  const desired = input.desiredSpeed;
  if (desired !== undefined && !isInRange(desired, 1, 250)) return fail("desiredSpeed");
  const shiftRpm = input.shiftRpm ?? engineRpm;
  if (!isInRange(shiftRpm, 100, 12000)) return fail("shiftRpm");

  const totalRatio = gearRatio * finalDrive * transferRatio;
  const speedFor = (rpm: number, ratio: number): number =>
    (rpm * rollingCircumference * MIN_PER_HOUR) / (ratio * MILLION);
  const rpmFor = (speed: number, ratio: number): number =>
    (speed * ratio * MILLION) / (MIN_PER_HOUR * rollingCircumference);

  const gearLines: readonly GearLine[] =
    gears === undefined
      ? []
      : gears.map((ratio, index) => {
          const total = ratio * finalDrive * transferRatio;
          const next = gears[index + 1];
          return {
            ratio,
            totalRatio: total,
            speed: speedFor(engineRpm, total),
            speedAtShiftRpm: speedFor(shiftRpm, total),
            rpmAtDesiredSpeed: desired === undefined ? undefined : rpmFor(desired, total),
            rpmAfterUpshift: next === undefined ? undefined : (shiftRpm * next) / ratio,
            rpmDrop: next === undefined ? undefined : shiftRpm - (shiftRpm * next) / ratio,
          };
        });

  return {
    ok: true,
    totalRatio,
    wheelRpm: engineRpm / totalRatio,
    speed: speedFor(engineRpm, totalRatio),
    speedPer1000Rpm: speedFor(1000, totalRatio),
    rpmAtDesiredSpeed: desired === undefined ? undefined : rpmFor(desired, totalRatio),
    gearLines,
  };
}

/* -------------------------------------------------------------------------- */
/* Zapremina rezervoara — tank volume by dipstick level                        */
/* -------------------------------------------------------------------------- */

/**
 * The three vessel shapes, each with its own dimensions — a discriminated
 * union rather than one bag of optional numbers, so a standing cylinder cannot
 * be built with a dome depth that only ever means something on its side.
 */
export type TankShape =
  | {
      readonly kind: "lying-cylinder";
      readonly diameter: number;
      /**
       * Length of the CYLINDRICAL barrel only, mm — between the two tangent
       * planes where the domed ends begin, never the vessel's overall length.
       * Using the overall length here double-counts the domes' own volume.
       */
      readonly length: number;
      /** Depth of ONE domed end, mm. 0 is a flat end. Ignored above `diameter/2`. */
      readonly domeDepth: number;
    }
  | { readonly kind: "standing-cylinder"; readonly diameter: number; readonly height: number }
  | {
      readonly kind: "box";
      readonly length: number;
      readonly width: number;
      readonly height: number;
    };

export interface TankVolumeInput {
  readonly shape: TankShape;
  /** Dipstick reading, mm from the bottom of the vessel. */
  readonly level: number;
  /** Density of the liquid, kg/l — the delivery note's own figure, never assumed. */
  readonly density?: number | undefined;
  readonly pricePerLitre?: number | undefined;
  /** A volume to solve the level for, litres. */
  readonly targetVolume?: number | undefined;
}

export interface TankVolumeResult {
  readonly volume: number;
  readonly volumeM3: number;
  readonly fullVolume: number;
  readonly fillShare: number;
  readonly emptySpace: number;
  readonly mass: number | undefined;
  readonly value: number | undefined;
  /**
   * How much the reading is worth at the measured level, litres per mm.
   * Constant for a standing cylinder or a box; for a lying cylinder it is the
   * width of the liquid surface times the length, smallest near the bottom and
   * the top — the same millimetre of dipstick reads very differently there.
   */
  readonly sensitivityLPerMm: number;
  /** True when the entered level is above the vessel — volume is then capped at full. */
  readonly levelAboveCapacity: boolean;
  readonly levelForTarget: number | undefined;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** Cross-sectional area of the liquid in a lying cylinder at height h, mm² — flat ends. */
function lyingSegmentArea(radius: number, height: number): number {
  if (height <= 0) return 0;
  if (height >= 2 * radius) return Math.PI * radius * radius;
  const rise = radius - height;
  return (
    radius * radius * Math.acos(clampUnit(rise / radius)) -
    rise * Math.sqrt(Math.max(0, 2 * radius * height - height * height))
  );
}

/** Volume of BOTH domed ends together, up to height h — a scaled spherical cap, mm³. */
function domedEndsVolume(radius: number, domeDepth: number, height: number): number {
  if (domeDepth <= 0 || height <= 0) return 0;
  const h = Math.min(height, 2 * radius);
  return ((domeDepth / radius) * Math.PI * h * h * (3 * radius - h)) / 3;
}

/**
 * Volume of liquid in a vessel, from a dipstick reading.
 *
 * **The reverse solve for a lying cylinder is by bisection, not a formula.**
 * The segment area has no closed-form inverse in `h`; it is strictly
 * increasing on `[0, D]`, so sixty halvings of an interval under 5 m pin the
 * level to a fraction of a micrometre — far tighter than a dipstick reads.
 */
export function tankVolumeByLevel(input: TankVolumeInput): ProResult<TankVolumeResult> {
  const { shape, level } = input;
  if (!isInRange(level, 0, 5000)) return fail("level");
  if (input.density !== undefined && !isInRange(input.density, 0.5, 2.0)) return fail("density");
  if (input.pricePerLitre !== undefined && !isInRange(input.pricePerLitre, 0, 100000)) {
    return fail("pricePerLitre");
  }
  if (input.targetVolume !== undefined && !isInRange(input.targetVolume, 0, 200000)) {
    return fail("targetVolume");
  }

  let capacityMm: number;
  let volumeAt: (h: number) => number; // mm³
  let crossSectionAt: (h: number) => number; // mm²

  if (shape.kind === "lying-cylinder") {
    if (!isInRange(shape.diameter, 100, 5000)) return fail("diameter");
    if (!isInRange(shape.length, 100, 20000)) return fail("length");
    if (!isInRange(shape.domeDepth, 0, 1500)) return fail("domeDepth");
    const radius = shape.diameter / 2;
    if (shape.domeDepth > radius) return fail("domeDepth");
    capacityMm = shape.diameter;
    const { length, domeDepth } = shape;
    volumeAt = (h) => lyingSegmentArea(radius, h) * length + domedEndsVolume(radius, domeDepth, h);
    // The written sensitivity is the BARREL's alone — chord width times length —
    // deliberately excluding the domes' own rate of change; the assignment's
    // worked figure (11.45 l/mm) is this expression and nothing more.
    crossSectionAt = (h) => 2 * Math.sqrt(Math.max(0, 2 * radius * h - h * h)) * length;
  } else if (shape.kind === "standing-cylinder") {
    if (!isInRange(shape.diameter, 100, 5000)) return fail("diameter");
    if (!isInRange(shape.height, 100, 5000)) return fail("height");
    const radius = shape.diameter / 2;
    const area = Math.PI * radius * radius;
    capacityMm = shape.height;
    volumeAt = (h) => area * Math.min(Math.max(h, 0), capacityMm);
    crossSectionAt = () => area;
  } else {
    if (!isInRange(shape.length, 100, 20000)) return fail("length");
    if (!isInRange(shape.width, 100, 5000)) return fail("width");
    if (!isInRange(shape.height, 100, 5000)) return fail("height");
    const area = shape.length * shape.width;
    capacityMm = shape.height;
    volumeAt = (h) => area * Math.min(Math.max(h, 0), capacityMm);
    crossSectionAt = () => area;
  }

  const levelAboveCapacity = level > capacityMm;
  const clampedLevel = Math.min(level, capacityMm);
  const volume = volumeAt(clampedLevel) / MILLION;
  const fullVolume = volumeAt(capacityMm) / MILLION;

  let levelForTarget: number | undefined;
  const target = input.targetVolume;
  if (target !== undefined && target <= fullVolume) {
    if (shape.kind === "lying-cylinder") {
      const targetMm3 = target * MILLION;
      let lo = 0;
      let hi = capacityMm;
      for (let i = 0; i < 60; i += 1) {
        const mid = (lo + hi) / 2;
        if (volumeAt(mid) < targetMm3) lo = mid;
        else hi = mid;
      }
      levelForTarget = (lo + hi) / 2;
    } else {
      // h = Vc·10⁶ ÷ crossSection — litres to mm³, then mm³ to mm over a
      // constant cross-section, in one step so no intermediate gets rounded.
      levelForTarget = (target * MILLION) / crossSectionAt(0);
    }
  }

  return {
    ok: true,
    volume,
    volumeM3: volume / 1000,
    fullVolume,
    fillShare: volume / fullVolume,
    emptySpace: fullVolume - volume,
    mass: input.density === undefined ? undefined : volume * input.density,
    value: input.pricePerLitre === undefined ? undefined : volume * input.pricePerLitre,
    sensitivityLPerMm: crossSectionAt(clampedLevel) / MILLION,
    levelAboveCapacity,
    levelForTarget,
  };
}
