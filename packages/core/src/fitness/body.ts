/**
 * FIT's body vocabulary: who a person is, what a scale said about them on a
 * given day, and the three ways this app is willing to put a number on what
 * they burn.
 *
 * **A profile and a measurement are different KINDS of thing, and conflating
 * them is the mistake this file exists to avoid.** A profile holds facts that
 * change rarely — sex, birth date, height, how active the person is. A
 * measurement is an observation ON A DAY: weight, and whatever else the scale or
 * the caliper reported that morning. One profile, many measurements, and no
 * field that is honestly either.
 *
 * **Age is DERIVED and never stored.** „30" written down once is wrong from the
 * next birthday onwards, and a metabolic equation with a stale age in it is
 * wrong quietly. `ageOnDay` takes the reference day as an ARGUMENT — nothing in
 * `@nexus/core` reads a clock, the same rule `computeHabitStreak` and
 * `studyStats` already follow — so the answer is reproducible and testable
 * rather than dependent on when the test ran.
 *
 * **Three tiers of energy expenditure, and the module says which one the data
 * supports.** Tier 1 is MEASURED from the user's own intake and weight trend and
 * needs no equation at all; tier 2 is Katch–McArdle off a measured body-fat
 * percentage; tier 3 is Mifflin–St Jeor off sex, age, height and weight. Every
 * returned estimate names the method that produced it and the assumptions it
 * rests on, because a number without its method is not a number this product
 * prints. `energyTiers` reports what is available AND what each unavailable tier
 * is still missing — that report is the feature, not a nicety: it is how a user
 * learns that entering a body-fat reading would buy them a better answer.
 *
 * **What this module refuses to compute:**
 *
 *  - **No body-fat estimation.** Navy-tape and BMI-derived estimates carry
 *    roughly ±4 percentage points — more than a year of real change — so an
 *    „estimate" would move more from its own error than from the user's
 *    training. The circumferences below are RECORDED and consumed by nothing;
 *    neck is deliberately not among them, because tracking a neck is not a thing
 *    people do for its own sake — it is the Navy formula's input, and offering
 *    the field would be offering the formula.
 *  - **No calorie burn for a workout.** No heart rate, no VO2, no accelerometer,
 *    no MET table. A MET figure's error bar is wider than the meal it would
 *    offset, and „you earned 400 kcal" is the single most misleading number a
 *    fitness app can print.
 *  - **No write to `fit_targets`.** `suggestDailyEnergy` produces a SUGGESTION
 *    and says so in its name and its type. Adopting it is a later slice's
 *    deliberate user action. A computed number that silently replaced somebody's
 *    own decision would be the same failure as converting money at a rate the
 *    app cannot verify, which FIN refuses in five places.
 *
 * Nothing here rounds. Rounding is a display decision and belongs where the
 * number is drawn — `food.ts`'s rule, for the same reason: a figure rounded on
 * the way through makes the total disagree with the rows above it.
 */

import { dayKeyToUtcMs, isValidDayKey, type DayKey } from "../calendar/calendarGrid.js";

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;

/**
 * Sex, as a BIOLOGICAL INPUT TO A METABOLIC EQUATION and nothing else. It exists
 * in this file because Mifflin–St Jeor has a sex term and for no other reason;
 * nothing else in the app reads it.
 *
 * English keys rather than Serbian ones, unlike `FOOD_CATEGORIES`: the food
 * catalogue is a Serbian DATASET whose keys are data, while this is a formula
 * parameter that a reader checks against the published equation. The Serbian
 * labels are copy and live in `strings.ts` with the rest of it.
 *
 * It is OPTIONAL on a profile (`sex: BodySex | null`) and there is no default.
 * A default would pick one silently and then hand back a BMR the user never
 * supplied the input for — the consequence of leaving it blank is that tier 3
 * becomes unavailable, and `energyTiers` says exactly that instead.
 */
export const BODY_SEXES = ["male", "female"] as const;

export type BodySex = (typeof BODY_SEXES)[number];

/**
 * How active a person is, as the rung of the ladder the activity multiplier is
 * read off. Five rungs, the conventional ones.
 *
 * **This is the crudest part of the entire calculation and the module refuses to
 * hide that.** The multipliers below are a convention drawn from studies with a
 * wide spread, not a measurement of anybody; the step between two adjacent rungs
 * is ~0.175, so on a 1700 kcal BMR the difference between „light" and „moderate"
 * is ~300 kcal a day — more than a meal, decided by a dropdown. Every total this
 * module produces therefore carries the `activity-multiplier` assumption so the
 * surface can say so, and tier 1 exists precisely so that a user with enough
 * history never has to touch this ladder at all.
 */
export const ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "active", "very-active"] as const;

export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/** The conventional multipliers, BMR → TDEE. See `ACTIVITY_LEVELS` for why these are the weakest numbers in the file. */
export const ACTIVITY_FACTORS: Readonly<Record<ActivityLevel, number>> = Object.freeze({
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  "very-active": 1.9,
});

/**
 * Facts about a person that change rarely.
 *
 * `heightCm` and `birthDate` are REQUIRED and `sex` is not, which is not an
 * oversight: a profile without a height or a date of birth is not a profile at
 * all, and a user who wants none of this simply never creates one — measurements
 * stand on their own and need no profile to be logged, which is the whole point
 * of keeping the two types apart.
 */
export interface BodyProfile {
  /** Null means „not given", never „unknown, assume male". Its absence closes tier 3 and `energyTiers` reports that. */
  readonly sex: BodySex | null;
  /** "YYYY-MM-DD". Age is derived from this on a reference day and is never stored. */
  readonly birthDate: DayKey;
  readonly heightCm: number;
  readonly activity: ActivityLevel;
}

/**
 * What a scale reports for muscle, in the unit IT reported it in.
 *
 * **The unit travels with the number rather than being normalised away at
 * entry.** Scales disagree: some print „skeletal muscle mass" in kilograms,
 * others a „muscle %" of body weight, and converting one into the other at entry
 * time would store a number the app computed while making it look like a number
 * the device measured — the same failure as rewriting a food's published
 * calories to the Atwater estimate. Kept verbatim, the value is re-checkable
 * against the display the user read it off.
 *
 * `muscleMassKg` converts a percentage when a caller wants kilograms, using the
 * weight from the SAME measurement — never another day's, which is the one way
 * that conversion can go quietly wrong.
 *
 * Muscle is RECORDED, and no formula in this file consumes it. Katch–McArdle
 * runs on lean body mass from the fat percentage, which is a different quantity
 * (lean mass includes bone, organs and water); a muscle figure substituted into
 * it would produce a plausible-looking BMR that is simply about something else.
 */
export type MuscleReading =
  | { readonly unit: "percent"; readonly value: number }
  | { readonly unit: "kg"; readonly value: number };

/**
 * Tape measurements, in centimetres, each null when not taken.
 *
 * Recorded and consumed by nothing — see the file header on why there is no
 * `neck` field and no body-fat estimate derived from any of these.
 */
export interface BodyCircumferences {
  readonly waist: number | null;
  readonly hip: number | null;
  readonly chest: number | null;
  readonly thigh: number | null;
  readonly upperArm: number | null;
}

/** All five untaken. One shared value; nothing here mutates a `BodyCircumferences`. */
export const NO_CIRCUMFERENCES: BodyCircumferences = Object.freeze({
  waist: null,
  hip: null,
  chest: null,
  thigh: null,
  upperArm: null,
});

/**
 * One observation, on one day.
 *
 * `weightKg` is the only required number: it is what makes the row an
 * observation. The other four are what a smart scale hands over in the same
 * step, each independently null because a bathroom scale gives one of them and a
 * DEXA scan gives another — and null means „not measured", never zero. A
 * body-fat percentage of 0 is impossible, so the two could never be confused;
 * the type says it anyway, because a reader should not have to know that to
 * trust the field.
 */
export interface BodyMeasurement {
  readonly day: DayKey;
  readonly weightKg: number;
  /** Whatever the caliper or the scale reported. This module estimates it from nothing (file header). */
  readonly bodyFatPercent: number | null;
  readonly muscle: MuscleReading | null;
  readonly waterPercent: number | null;
  readonly circumferences: BodyCircumferences;
}

/**
 * Plausibility bounds, not medical opinion — `MAX_FIT_TARGET`'s posture: these
 * are typo guards on numbers a progress bar will divide by, each set well
 * outside every human ever recorded (tallest 272 cm, shortest adult 63 cm,
 * heaviest 635 kg). They exist so an accidental „1750 cm" is refused where it is
 * entered rather than discovered inside a BMI.
 *
 * The percentage bounds are ARITHMETIC rather than judgement: a body cannot be
 * 0 % or 100 % fat, or 0 % or 100 % water, whatever anybody's training looks
 * like.
 */
export const MIN_HEIGHT_CM = 50;
export const MAX_HEIGHT_CM = 260;
export const MAX_WEIGHT_KG = 500;
export const MAX_CIRCUMFERENCE_CM = 300;

/**
 * What is wrong with one profile or one measurement, in the shape
 * `validateFoodEntry` established: `{ field, code }`, `field` a path into the
 * value so a failing test names the number rather than the row.
 *
 * One vocabulary for both validators, because both speak about the same body.
 */
export interface BodyProblem {
  readonly field: string;
  readonly code: BodyProblemCode;
}

export type BodyProblemCode =
  /** Missing, or the wrong kind of thing entirely. */
  | "shape"
  /** A number outside what it is allowed to be — negative, non-finite, or past a plausibility bound. */
  | "range"
  /** Not a real calendar day. */
  | "day"
  /** A day after the reference day: an observation nobody has made yet, or a birth date in the future. */
  | "future"
  /** Outside `BODY_SEXES`. */
  | "sex"
  /** Outside `ACTIVITY_LEVELS`. */
  | "activity"
  /** A muscle reading whose unit is neither `percent` nor `kg`. */
  | "unit"
  /** Numbers that cannot describe one body at once — muscle mass above total weight. */
  | "composition";

/**
 * Everything wrong with `value` as a body profile, in a fixed order; an EMPTY
 * array means it passed. `validateFoodEntry`'s contract exactly — `unknown` in,
 * a list of problems out, never a throw and never a partially-repaired value —
 * so a caller that knows one knows the other.
 *
 * `today` is a PARAMETER because a birth date in the future is only knowable
 * against a reference day, and this module reads no clock.
 */
export function validateBodyProfile(value: unknown, today: DayKey): readonly BodyProblem[] {
  const problems: BodyProblem[] = [];
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  const sex = value["sex"];
  if (sex !== null && !(BODY_SEXES as readonly unknown[]).includes(sex)) {
    problems.push({ field: "sex", code: "sex" });
  }
  problems.push(...dayProblems(value["birthDate"], "birthDate", today));
  problems.push(...numberProblems(value["heightCm"], "heightCm", MIN_HEIGHT_CM, MAX_HEIGHT_CM));
  if (!(ACTIVITY_LEVELS as readonly unknown[]).includes(value["activity"])) {
    problems.push({ field: "activity", code: "activity" });
  }
  return problems;
}

/**
 * Everything wrong with `value` as a measurement; an EMPTY array means it
 * passed. Same contract as `validateBodyProfile`, same reason `today` is a
 * parameter: a weigh-in dated tomorrow is not an observation, and only a
 * reference day can say so.
 *
 * The cross-field rule is deliberately the only one: muscle mass cannot exceed
 * the body it is part of. Fat % plus water % is left alone even though it also
 * has a physiological ceiling — that ceiling depends on the hydration fraction
 * of lean tissue, which is a constant this file would have to invent, and an
 * invented constant enforcing a rule is worse than no rule.
 */
export function validateBodyMeasurement(value: unknown, today: DayKey): readonly BodyProblem[] {
  const problems: BodyProblem[] = [];
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  problems.push(...dayProblems(value["day"], "day", today));

  const weight = value["weightKg"];
  const weightProblems = numberProblems(weight, "weightKg", 0, MAX_WEIGHT_KG);
  problems.push(...weightProblems);
  problems.push(...percentProblems(value["bodyFatPercent"], "bodyFatPercent"));
  problems.push(...percentProblems(value["waterPercent"], "waterPercent"));
  // The muscle rule compares against the weight, so it is only asked when the
  // weight itself passed — one honest problem beats two, the second derived from
  // the first (`macroProblems`' rule).
  problems.push(
    ...muscleProblems(
      value["muscle"],
      weightProblems.length === 0 && typeof weight === "number" ? weight : null,
    ),
  );
  problems.push(...circumferenceProblems(value["circumferences"]));

  return problems;
}

/**
 * How many years this person has COMPLETED on `on`, or null when `on` precedes
 * their birth — `ageAtOccurrence`'s posture restated: a mistyped future date
 * reports nothing rather than „-3 godine", and nothing downstream ever divides
 * by a negative age.
 *
 * **A 29 February person turns a year older on 1 March in a non-leap year, which
 * is deliberately NOT what `birthdayOccurrencesInRange` does.** That function
 * clamps the CELEBRATION to the 28th, because the household holds the party a
 * day early. This one counts COMPLETED years, and on 28 February the year is not
 * yet complete. Two different questions about the same date; the divergence is
 * intentional and is stated here so nobody „fixes" it into agreement.
 *
 * Throws on anything that is not a real calendar day, the way `dayKeyToUtcMs`
 * does: every caller validates first, so a bad key arriving here is a
 * programming error and answering it quietly would hide the bug inside an age.
 */
export function ageOnDay(birthDate: DayKey, on: DayKey): number | null {
  if (!isValidDayKey(birthDate)) throw new TypeError(`Invalid day key: "${birthDate}"`);
  if (!isValidDayKey(on)) throw new TypeError(`Invalid day key: "${on}"`);

  // The "MM-DD" suffixes are fixed-width, so a lexicographic compare IS a
  // calendar compare — no Date arithmetic, no timezone to be wrong about.
  const years = Number(on.slice(0, 4)) - Number(birthDate.slice(0, 4));
  const age = on.slice(5) >= birthDate.slice(5) ? years : years - 1;
  return age < 0 ? null : age;
}

/**
 * The kilograms of this body that are not fat. The input is a MEASURED
 * percentage — this module derives one from nothing (file header) — so the
 * arithmetic is the whole of it.
 *
 * Throws rather than coercing, `macrosFor`'s rule: callers validate first, and a
 * silent answer for an impossible percentage would travel into a BMR.
 */
export function leanBodyMassKg(weightKg: number, bodyFatPercent: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new RangeError(`"weightKg" must be a finite positive number (got ${String(weightKg)}).`);
  }
  if (!Number.isFinite(bodyFatPercent) || bodyFatPercent <= 0 || bodyFatPercent >= 100) {
    throw new RangeError(
      `"bodyFatPercent" must be a finite number above 0 and below 100 (got ${String(bodyFatPercent)}).`,
    );
  }
  return weightKg * (1 - bodyFatPercent / 100);
}

/**
 * This measurement's muscle in kilograms, or null when none was reported. A
 * percentage is resolved against the weight recorded on the SAME day, which is
 * the only weight it can honestly mean.
 */
export function muscleMassKg(measurement: BodyMeasurement): number | null {
  const muscle = measurement.muscle;
  if (muscle === null) return null;
  return muscle.unit === "kg" ? muscle.value : measurement.weightKg * (muscle.value / 100);
}

/**
 * The one caveat that must travel with a BMI. A single-member union rather than
 * a boolean or a comment: it will grow if another caveat is ever found, and
 * being a member of a union it forces every surface that renders a BMI to handle
 * it rather than to forget it.
 */
export type BmiCaveat = "population-screening";

/**
 * A BMI and what a reader has to know about it in the same breath.
 *
 * `supersededByBodyFat` is the field that makes the number honest. BMI is a
 * proxy for body composition, and it is a poor one — it reads a muscular person
 * as overweight, because it cannot tell muscle from fat. When the same
 * measurement carries a real body-fat percentage, the question BMI approximates
 * has already been ANSWERED, and a surface holding this record can drop the
 * proxy rather than print two numbers that disagree.
 */
export interface BmiReading {
  readonly value: number;
  readonly caveat: BmiCaveat;
  readonly supersededByBodyFat: boolean;
}

/** kg / m², with its caveat attached. Throws on impossible inputs, `leanBodyMassKg`'s rule. */
export function bmiFor(profile: BodyProfile, measurement: BodyMeasurement): BmiReading {
  if (!Number.isFinite(profile.heightCm) || profile.heightCm <= 0) {
    throw new RangeError(`"heightCm" must be a finite positive number (got ${String(profile.heightCm)}).`);
  }
  if (!Number.isFinite(measurement.weightKg) || measurement.weightKg <= 0) {
    throw new RangeError(
      `"weightKg" must be a finite positive number (got ${String(measurement.weightKg)}).`,
    );
  }
  const metres = profile.heightCm / 100;
  return {
    value: measurement.weightKg / (metres * metres),
    caveat: "population-screening",
    supersededByBodyFat: measurement.bodyFatPercent !== null,
  };
}

/**
 * The three ways this app will put a number on expenditure, BEST FIRST. The
 * order is the point: it is what „which tier does this data support" means, and
 * `energyTiers` walks exactly this list.
 *
 *  - `measured` — the user's own intake and weight trend. No equation, no
 *    population, no activity ladder: their body, their data.
 *  - `katch-mcardle` — `BMR = 370 + 21.6 × LBM`, from a MEASURED body-fat
 *    percentage. This is the tier a scale buys you.
 *  - `mifflin-st-jeor` — `10×kg + 6.25×cm − 5×age + 5` (male) / `− 161` (female).
 *    The fallback when composition is unknown.
 *
 * **Harris–Benedict is deliberately absent.** It is a 1919 regression on a
 * population whose body composition and measurement methods no longer describe
 * anybody, and it was superseded by Mifflin–St Jeor for cause. It is written
 * down here so that nobody „improves" the file by adding it back.
 */
export const ENERGY_METHODS = ["measured", "katch-mcardle", "mifflin-st-jeor"] as const;

export type EnergyMethod = (typeof ENERGY_METHODS)[number];

/**
 * What an estimate RESTS ON, as codes the surface renders rather than as prose
 * buried in this file. The uncertainty is a FIELD, which is `FoodSource`'s rule
 * for a `stated` food restated for a calculation.
 *
 * A user shown „2 750 kcal" with nothing beside it will trust a digit that was
 * never there; shown the same number with „procenjeno na osnovu jednačine za
 * populaciju" beside it, they know what they are looking at.
 */
export type EnergyAssumption =
  /** The BMR came from a regression fitted to other people's bodies, not from this one. */
  | "population-equation"
  /** Mifflin's sex term is standing in for body composition — see `mifflinStJeorBmr`. */
  | "sex-term-proxies-composition"
  /** A resting figure was multiplied by the activity ladder — the crudest step here (`ACTIVITY_LEVELS`). */
  | "activity-multiplier"
  /** `KCAL_PER_KG_BODY_MASS` was used to price a weight change. */
  | "energy-density"
  /** Some days in the window carried no intake log, and the logged days' mean stood in for them. */
  | "unlogged-days-imputed";

/**
 * A number and everything a reader needs to judge it.
 *
 * `kind` is not decoration: a resting figure and a total differ by 20–90 %, and
 * a surface that printed a Katch–McArdle BMR under „dnevna potrošnja" would
 * understate somebody's expenditure by a third. The two are different
 * quantities, so they are different values of a field rather than a convention
 * about which function returned them.
 */
export interface EnergyEstimate {
  readonly kcal: number;
  /** `resting` = BMR, `total` = TDEE. */
  readonly kind: "resting" | "total";
  readonly method: EnergyMethod;
  /** In `EnergyAssumption`'s declaration order, so two identical estimates compare equal. */
  readonly assumptions: readonly EnergyAssumption[];
}

const KATCH_MCARDLE_INTERCEPT = 370;
const KATCH_MCARDLE_SLOPE = 21.6;

/**
 * `BMR = 370 + 21.6 × LBM`.
 *
 * **Sex-independent BY CONSTRUCTION, and that is the reason this tier outranks
 * the next one.** The sex term in Mifflin–St Jeor is not about sex as such — it
 * is standing in for the average difference in body composition between two
 * populations. Here the composition itself is known, so there is nothing left
 * for a sex term to proxy and the equation does not carry one. A user who
 * measures their body fat gets an answer about their body rather than about
 * their demographic.
 */
export function katchMcArdleBmr(leanMassKg: number): number {
  if (!Number.isFinite(leanMassKg) || leanMassKg <= 0) {
    throw new RangeError(`"leanMassKg" must be a finite positive number (got ${String(leanMassKg)}).`);
  }
  return KATCH_MCARDLE_INTERCEPT + KATCH_MCARDLE_SLOPE * leanMassKg;
}

/**
 * `10×kg + 6.25×cm − 5×age + 5` for male, `− 161` for female.
 *
 * See `ENERGY_METHODS` for why this and not Harris–Benedict, and
 * `katchMcArdleBmr` for what the sex term actually stands for — which is why an
 * estimate built on this one carries the `sex-term-proxies-composition`
 * assumption and one built on Katch–McArdle does not.
 */
export function mifflinStJeorBmr(
  sex: BodySex,
  weightKg: number,
  heightCm: number,
  ageYears: number,
): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new RangeError(`"weightKg" must be a finite positive number (got ${String(weightKg)}).`);
  }
  if (!Number.isFinite(heightCm) || heightCm <= 0) {
    throw new RangeError(`"heightCm" must be a finite positive number (got ${String(heightCm)}).`);
  }
  if (!Number.isFinite(ageYears) || ageYears < 0) {
    throw new RangeError(`"ageYears" must be a finite non-negative number (got ${String(ageYears)}).`);
  }
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "male" ? base + 5 : base - 161;
}

/**
 * The best RESTING estimate this data supports, or null when it supports none.
 *
 * Katch–McArdle first whenever a body-fat percentage is present, and note that
 * it needs no profile at all — weight and composition are the whole input.
 * Mifflin–St Jeor otherwise, and only when a profile carries a sex and a birth
 * date that yields an age on `today`.
 */
export function restingEnergy(
  measurement: BodyMeasurement,
  profile: BodyProfile | null,
  today: DayKey,
): EnergyEstimate | null {
  if (measurement.bodyFatPercent !== null) {
    return {
      kcal: katchMcArdleBmr(leanBodyMassKg(measurement.weightKg, measurement.bodyFatPercent)),
      kind: "resting",
      method: "katch-mcardle",
      assumptions: ["population-equation"],
    };
  }
  if (profile === null || profile.sex === null) return null;
  const age = ageOnDay(profile.birthDate, today);
  if (age === null) return null;
  return {
    kcal: mifflinStJeorBmr(profile.sex, measurement.weightKg, profile.heightCm, age),
    kind: "resting",
    method: "mifflin-st-jeor",
    assumptions: ["population-equation", "sex-term-proxies-composition"],
  };
}

/**
 * A resting figure multiplied up by the activity ladder, carrying the
 * `activity-multiplier` assumption that says how weak that step is
 * (`ACTIVITY_LEVELS`).
 *
 * Refuses a `total` input rather than multiplying twice: a TDEE fed back through
 * here would come out ~50 % high and look entirely reasonable, which is exactly
 * the kind of error a type should be made to catch.
 */
export function totalEnergy(resting: EnergyEstimate, activity: ActivityLevel): EnergyEstimate {
  if (resting.kind !== "resting") {
    throw new TypeError(`"resting" must be a resting estimate (got kind "${resting.kind}").`);
  }
  return {
    kcal: resting.kcal * ACTIVITY_FACTORS[activity],
    kind: "total",
    method: resting.method,
    assumptions: [...resting.assumptions, "activity-multiplier"],
  };
}

/**
 * What a kilogram of body-mass change is billed at.
 *
 * **A STATED ASSUMPTION, not physics.** The literature runs roughly
 * 7 000–7 700 kcal/kg depending on how much of the change is fat and how much is
 * lean tissue; 7 700 is the classic pure-adipose figure and it is what this app
 * ships. The consequence is directional and worth knowing: for a loss, using the
 * larger constant OVERSTATES the resulting TDEE slightly. It is named here, in
 * one place, so it can be changed in one place — `food.ts` names its Atwater
 * factors the same way and for the same reason.
 */
export const KCAL_PER_KG_BODY_MASS = 7700;

/**
 * The window's minimum length. Below two weeks the endpoint noise dominates
 * outright: with a daily weight swing of ~1 kg on water and gut contents alone,
 * a trend endpoint averaged over n readings still carries ~1/√n kg of noise, and
 * that error is multiplied by 7 700 and divided by the span — so halving the
 * span doubles the nonsense. Fourteen days is the floor at which an answer is
 * worth printing at all; four weeks is materially better and the surface should
 * say so.
 */
export const MEASURED_MIN_WINDOW_DAYS = 14;

/**
 * How many days each trend endpoint averages over. Seven, because body weight
 * has a WEEKLY cycle — weekend eating shows up as a Monday high — and a smoothing
 * window shorter than the cycle it is smoothing leaves the cycle in the answer.
 * At the 14-day minimum the two blocks tile the window exactly and can never
 * overlap.
 */
export const MEASURED_TREND_DAYS = 7;

/**
 * How many weigh-ins each 7-day endpoint block must contain.
 *
 * Four of a possible seven: more than half the block, and enough that
 * independent daily noise is halved (√4 = 2) rather than merely reduced by 1.7×
 * (√3). The difference is not academic — at the 14-day minimum the two endpoints
 * are 7 days apart, so 0.3 kg of residual endpoint noise is already ~330 kcal/day
 * of pure invention. Two readings would make the „trend" a pair of weigh-ins with
 * extra steps, which is the thing this whole tier exists to avoid.
 */
export const MEASURED_MIN_TREND_READINGS = 4;

/**
 * The fraction of window days that must carry an intake log.
 *
 * Mean intake over the LOGGED days stands in for mean intake over ALL days, and
 * that substitution is only small while the unlogged days are few: at 80 %
 * coverage, one unlogged 3 000 kcal day in five shifts a 2 000 kcal mean by up
 * to 200 kcal/day, which is inside the noise this tier already carries. Below
 * that the substitution stops being a correction and becomes an assumption about
 * days nobody recorded — and the answer would be confidently wrong rather than
 * absent, which is the worse of the two failures.
 */
export const MEASURED_MIN_INTAKE_COVERAGE = 0.8;

/**
 * One day's intake total, in kcal.
 *
 * **A day with nothing logged is ABSENT from the list, never a zero.** The two
 * are different claims and the coverage rule turns on the difference: a zero here
 * is a genuine fasted day and counts towards both the mean and the coverage.
 * Emitting zero rows for blank days would drag the mean down and hand back a TDEE
 * that is too low by exactly as much as the user forgot to log.
 */
export interface IntakeDay {
  readonly day: DayKey;
  readonly kcal: number;
}

/** One weigh-in. Nothing else from a measurement is needed to trend weight. */
export interface WeightReading {
  readonly day: DayKey;
  readonly weightKg: number;
}

/** The history tier 1 reads: a closed day range and everything logged inside it. Anything dated outside `[from, to]` is ignored. */
export interface MeasuredEnergyInput {
  readonly from: DayKey;
  /** Inclusive. */
  readonly to: DayKey;
  readonly intake: readonly IntakeDay[];
  readonly weights: readonly WeightReading[];
}

/**
 * Why tier 1 declined, and what would fix it. `have` and `need` are the two
 * numbers a surface needs to write „13 od 14 dana" without knowing the rule:
 *
 *  - `window-days` — days in the range, against `MEASURED_MIN_WINDOW_DAYS`.
 *  - `intake-coverage` — logged fraction 0..1, against `MEASURED_MIN_INTAKE_COVERAGE`.
 *  - `trend-readings` — the THINNER of the two endpoint blocks, against
 *    `MEASURED_MIN_TREND_READINGS`; naming the thinner one is what makes the
 *    message actionable.
 *  - `plausible-result` — the kcal the arithmetic produced, against the 0 it has
 *    to exceed.
 */
export type MeasuredEnergyRefusalCode =
  | "window-days"
  | "intake-coverage"
  | "trend-readings"
  | "plausible-result";

export interface MeasuredEnergyRefusal {
  readonly code: MeasuredEnergyRefusalCode;
  readonly have: number;
  readonly need: number;
}

/**
 * Tier 1's working, so the surface can SHOW it rather than ask to be trusted —
 * the same reason a `derived` food carries its recipe.
 *
 * `daysBetweenTrends` is the distance between the two endpoint AVERAGES, not the
 * window length. They differ by a whole trend block, and dividing by the window
 * instead would understate the daily rate of change by up to a factor of two at
 * the 14-day minimum.
 */
export interface MeasuredEnergyDetail {
  readonly meanIntakeKcal: number;
  readonly trendStartKg: number;
  readonly trendEndKg: number;
  /** End minus start: negative for a loss. */
  readonly deltaKg: number;
  readonly daysBetweenTrends: number;
  readonly windowDays: number;
  readonly loggedDays: number;
  /** `loggedDays / windowDays`, 0..1. */
  readonly intakeCoverage: number;
}

/** `CsvFinanceTranslation`'s shape, for the same reason: a refusal is an outcome, not an exception. */
export type MeasuredEnergyResult =
  | { readonly status: "refused"; readonly refusals: readonly MeasuredEnergyRefusal[] }
  | {
      readonly status: "ready";
      readonly estimate: EnergyEstimate;
      readonly detail: MeasuredEnergyDetail;
    };

/**
 * Expenditure MEASURED from the user's own data:
 *
 * ```
 * TDEE ≈ mean daily intake − (Δ trend weight in kg × 7700 / days between trends)
 * ```
 *
 * **The trend, not the scale.** Both ends are a 7-day mean rather than a single
 * weigh-in, because body weight swings 1–2 kg a day on water and gut contents
 * alone — two raw readings a fortnight apart could easily disagree by more than
 * the real change they are supposed to measure. The two ends are the first and
 * last `MEASURED_TREND_DAYS` of the window, and the span between them is the
 * distance between the readings' own day CENTROIDS, not the nominal block
 * centres: a user who weighed in on days 0–3 of the opening block has a trend
 * that is really about day 1.5, and pretending otherwise would misprice every
 * gram of the change.
 *
 * Mean intake is taken over the WHOLE window while the weight change spans only
 * the inner distance. That is deliberate: mean daily intake is a rate, the window
 * is the best sample of it, and restricting the sample to the inner span would
 * throw away half the logged days at a 14-day window to buy an alignment the
 * arithmetic does not need.
 *
 * **The preconditions are refusals, and they are the entire reason this tier can
 * be trusted.** A short window, a sparse intake log or a thin endpoint block each
 * produce a number that looks exactly like a good one, so each is named instead
 * (`MeasuredEnergyRefusal`). A failing `window-days` SHORT-CIRCUITS the other
 * two: with no window there are no endpoint blocks to be thin, and a coverage
 * figure over three days is noise dressed as diagnosis.
 *
 * A repeated day in either list is a caller error — the store holds one row per
 * day — and the last one given wins, which is the rule an upsert would apply.
 * Days outside `[from, to]` and malformed keys are dropped rather than thrown on:
 * this reads history, and history should not be able to crash a screen.
 */
export function measuredEnergy(input: MeasuredEnergyInput): MeasuredEnergyResult {
  if (!isValidDayKey(input.from) || !isValidDayKey(input.to)) {
    throw new TypeError(`Invalid day key: "${input.from}".."${input.to}"`);
  }
  const fromMs = dayKeyToUtcMs(input.from);
  const windowDays = (dayKeyToUtcMs(input.to) - fromMs) / MS_PER_DAY + 1;
  if (windowDays < MEASURED_MIN_WINDOW_DAYS) {
    return {
      status: "refused",
      refusals: [
        { code: "window-days", have: Math.max(0, windowDays), need: MEASURED_MIN_WINDOW_DAYS },
      ],
    };
  }

  const intakeByIndex = indexByDay(input.intake, fromMs, windowDays, (entry) => entry.kcal);
  const weightByIndex = indexByDay(input.weights, fromMs, windowDays, (entry) => entry.weightKg);

  const refusals: MeasuredEnergyRefusal[] = [];

  const loggedDays = intakeByIndex.size;
  const intakeCoverage = loggedDays / windowDays;
  if (intakeCoverage < MEASURED_MIN_INTAKE_COVERAGE) {
    refusals.push({
      code: "intake-coverage",
      have: intakeCoverage,
      need: MEASURED_MIN_INTAKE_COVERAGE,
    });
  }

  const start = trendBlock(weightByIndex, 0, MEASURED_TREND_DAYS);
  const end = trendBlock(weightByIndex, windowDays - MEASURED_TREND_DAYS, windowDays);
  const thinnest = Math.min(start.count, end.count);
  if (thinnest < MEASURED_MIN_TREND_READINGS) {
    refusals.push({
      code: "trend-readings",
      have: thinnest,
      need: MEASURED_MIN_TREND_READINGS,
    });
  }

  if (refusals.length > 0) return { status: "refused", refusals };

  const meanIntakeKcal = sum(intakeByIndex.values()) / loggedDays;
  const deltaKg = end.meanValue - start.meanValue;
  const daysBetweenTrends = end.meanIndex - start.meanIndex;
  const kcal = meanIntakeKcal - (deltaKg * KCAL_PER_KG_BODY_MASS) / daysBetweenTrends;

  // A body cannot expend negative energy. This is arithmetic rather than
  // judgement, so it is the ONE post-hoc refusal here — there is deliberately no
  // upper bound, which would be a medical opinion this module has no business
  // holding.
  if (kcal <= 0) {
    return { status: "refused", refusals: [{ code: "plausible-result", have: kcal, need: 0 }] };
  }

  const assumptions: EnergyAssumption[] = ["energy-density"];
  if (loggedDays < windowDays) assumptions.push("unlogged-days-imputed");

  return {
    status: "ready",
    estimate: { kcal, kind: "total", method: "measured", assumptions },
    detail: {
      meanIntakeKcal,
      trendStartKg: start.meanValue,
      trendEndKg: end.meanValue,
      deltaKg,
      daysBetweenTrends,
      windowDays,
      loggedDays,
      intakeCoverage,
    },
  };
}

/**
 * What a tier still needs before it can answer.
 *
 * The four measured codes are `MeasuredEnergyRefusalCode` verbatim rather than a
 * parallel vocabulary — one list of reasons, so a surface renders each string
 * once.
 */
export type EnergyRequirement =
  /** No body profile at all: no height, no birth date, no activity level. */
  | "profile"
  /** The profile carries no sex, which is what closes Mifflin–St Jeor. */
  | "sex"
  /** No weight reading to work from. */
  | "measurement"
  /** The measurement carries no body-fat percentage, which is what would open Katch–McArdle. */
  | "body-fat"
  /** No intake/weight history was supplied at all. */
  | "history"
  | MeasuredEnergyRefusalCode;

/** One unavailable method and what it is waiting for. `missing` is never empty — a method with nothing missing is available instead. */
export interface EnergyGap {
  readonly method: EnergyMethod;
  readonly missing: readonly EnergyRequirement[];
}

/**
 * Which tier the data supports, and what the others are still missing.
 *
 * `gaps` is the answer to the founder's „ako ima da može da nam se uračuna
 * preciznije": it is what lets a screen say „unesi procenat masti i računamo ti
 * preciznije" instead of silently printing the weakest available number forever.
 *
 * `measured` carries tier 1's full result — its numbered refusals or its working
 * — so a caller never has to run the window twice to learn how far off it is.
 */
export interface EnergyTierReport {
  /** The best estimate the data supports, always a TOTAL, or null when nothing does. */
  readonly estimate: EnergyEstimate | null;
  /** Every method the data supports, best first; `available[0]` is `estimate`'s method. */
  readonly available: readonly EnergyMethod[];
  /** Every method it does not, best first. */
  readonly gaps: readonly EnergyGap[];
  /** Tier 1's own result, or null when no history was supplied. */
  readonly measured: MeasuredEnergyResult | null;
}

/** Everything the tier report reads. Each part independently absent, because that is the state a new profile is in. */
export interface EnergyTierInput {
  readonly profile: BodyProfile | null;
  /** The latest measurement — the one an estimate is about. */
  readonly measurement: BodyMeasurement | null;
  readonly history: MeasuredEnergyInput | null;
  readonly today: DayKey;
}

/**
 * Walks `ENERGY_METHODS` best-first and reports what each one has and lacks.
 *
 * Tiers 2 and 3 both require a PROFILE even though Katch–McArdle's equation does
 * not: this report is about TOTAL expenditure, and the activity level that turns
 * a BMR into a TDEE lives on the profile. A caller that genuinely wants a BMR
 * without one calls `restingEnergy` directly, which is why that function takes a
 * nullable profile.
 */
export function energyTiers(input: EnergyTierInput): EnergyTierReport {
  const { profile, measurement, history, today } = input;
  const measured = history === null ? null : measuredEnergy(history);

  // One candidate per method, best first: an estimate when the data supports it,
  // otherwise the list of what it is still waiting for. Built as a plain array
  // rather than accumulated by a helper so the order is visible on the page.
  const candidates: { method: EnergyMethod; estimate: EnergyEstimate | null; missing: EnergyRequirement[] }[] = [];

  candidates.push({
    method: "measured",
    estimate: measured !== null && measured.status === "ready" ? measured.estimate : null,
    missing:
      measured === null
        ? ["history"]
        : measured.status === "refused"
          ? measured.refusals.map((refusal) => refusal.code)
          : [],
  });

  const katchMissing: EnergyRequirement[] = [];
  if (profile === null) katchMissing.push("profile");
  if (measurement === null) katchMissing.push("measurement");
  else if (measurement.bodyFatPercent === null) katchMissing.push("body-fat");
  candidates.push({
    method: "katch-mcardle",
    estimate:
      profile !== null && measurement !== null && measurement.bodyFatPercent !== null
        ? totalEnergy(
            {
              kcal: katchMcArdleBmr(leanBodyMassKg(measurement.weightKg, measurement.bodyFatPercent)),
              kind: "resting",
              method: "katch-mcardle",
              assumptions: ["population-equation"],
            },
            profile.activity,
          )
        : null,
    missing: katchMissing,
  });

  const age = profile === null ? null : ageOnDay(profile.birthDate, today);
  const mifflinMissing: EnergyRequirement[] = [];
  if (profile === null) mifflinMissing.push("profile");
  else if (profile.sex === null) mifflinMissing.push("sex");
  // A birth date in the FUTURE yields no age (`ageOnDay`). `validateBodyProfile`
  // refuses one, so this can only be an unvalidated profile — and the honest
  // report is that the profile itself is not yet usable, not that some fourth
  // thing is missing.
  else if (age === null) mifflinMissing.push("profile");
  if (measurement === null) mifflinMissing.push("measurement");
  candidates.push({
    method: "mifflin-st-jeor",
    estimate:
      profile !== null && profile.sex !== null && measurement !== null && age !== null
        ? totalEnergy(
            {
              kcal: mifflinStJeorBmr(profile.sex, measurement.weightKg, profile.heightCm, age),
              kind: "resting",
              method: "mifflin-st-jeor",
              assumptions: ["population-equation", "sex-term-proxies-composition"],
            },
            profile.activity,
          )
        : null,
    missing: mifflinMissing,
  });

  const available: EnergyMethod[] = [];
  const gaps: EnergyGap[] = [];
  let estimate: EnergyEstimate | null = null;
  for (const candidate of candidates) {
    const ready = candidate.estimate;
    if (ready === null || candidate.missing.length > 0) {
      gaps.push({ method: candidate.method, missing: candidate.missing });
      continue;
    }
    available.push(candidate.method);
    estimate ??= ready;
  }

  return { estimate, available, gaps, measured };
}

/** Which way a suggestion moves. `maintain` is a real choice, not the absence of one, and it pins the delta at zero. */
export const WEIGHT_GOALS = ["lose", "maintain", "gain"] as const;

export type WeightGoal = (typeof WEIGHT_GOALS)[number];

/**
 * A daily intake this expenditure and this goal WOULD imply. A suggestion, and
 * the type says so in its name — nothing in FIT adopts it, and `fit_targets` is
 * written only by a user who chose to.
 */
export interface SuggestedEnergyTarget {
  readonly kcal: number;
  readonly goal: WeightGoal;
  /** kcal/day above (positive) or below (negative) the expenditure. Zero for `maintain`. */
  readonly deltaKcal: number;
  /** The signed weekly change the delta implies at `KCAL_PER_KG_BODY_MASS`. */
  readonly weeklyKg: number;
  /** The estimate this was built on, VERBATIM — a suggestion may not restate its source. */
  readonly from: EnergyEstimate;
  /**
   * Everything behind the suggested number: the source estimate's own
   * assumptions, plus `energy-density` when the delta actually used it. Carried
   * here rather than folded into `from`, so the estimate the user was shown and
   * the estimate this cites stay the same object.
   *
   * **A `maintain` suggestion does NOT carry `energy-density`**, because its
   * delta is zero and `KCAL_PER_KG_BODY_MASS` never entered the arithmetic.
   * Listing an assumption a number does not rest on is a small false statement,
   * and a module whose whole thesis is that assumptions travel with the figure
   * does not get to make small ones.
   */
  readonly assumptions: readonly EnergyAssumption[];
}

/**
 * Prices a goal against an expenditure estimate.
 *
 * `weeklyKg` is a MAGNITUDE the caller supplies and `goal` gives it its sign;
 * `maintain` ignores it. There is deliberately no default rate — „0,5 kg
 * nedeljno" is a recommendation, this module makes none, and a default would be
 * a medical opinion arriving through a parameter nobody passed.
 *
 * Refuses a RESTING estimate outright. Suggesting a day's food off a BMR would
 * hand somebody a deficit of a third of their expenditure without saying so, and
 * that mistake is one keystroke away at the call site.
 */
export function suggestDailyEnergy(
  expenditure: EnergyEstimate,
  goal: WeightGoal,
  weeklyKg: number,
): SuggestedEnergyTarget {
  if (expenditure.kind !== "total") {
    throw new TypeError(
      `"expenditure" must be a total estimate (got kind "${expenditure.kind}"); a resting figure is not a day's expenditure.`,
    );
  }
  if (!Number.isFinite(weeklyKg) || weeklyKg < 0) {
    throw new RangeError(`"weeklyKg" must be a finite non-negative magnitude (got ${String(weeklyKg)}).`);
  }
  const signed = goal === "maintain" ? 0 : goal === "lose" ? -weeklyKg : weeklyKg;
  const deltaKcal = (signed * KCAL_PER_KG_BODY_MASS) / DAYS_PER_WEEK;
  // Only a NON-ZERO delta priced a weight change, so only a non-zero delta rests
  // on the energy-density constant — see `SuggestedEnergyTarget.assumptions`.
  const pricedAChange = deltaKcal !== 0;
  return {
    kcal: expenditure.kcal + deltaKcal,
    goal,
    deltaKcal,
    weeklyKg: signed,
    from: expenditure,
    assumptions:
      !pricedAChange || expenditure.assumptions.includes("energy-density")
        ? expenditure.assumptions
        : [...expenditure.assumptions, "energy-density"],
  };
}

/**
 * A private moving average, and a note about why it is private.
 *
 * `training.ts` (the sibling FIT lane) carries a moving average of its own for a
 * different series. Importing across a lane boundary mid-flight would have made
 * one file's merge depend on the other's, so this file keeps the small amount of
 * arithmetic it needs. A later slice may unify them — the shapes differ today
 * (this one is a block mean plus the readings' day centroid, which is what makes
 * `daysBetweenTrends` honest), and duplicated arithmetic is the lesser evil
 * against a broken merge.
 *
 * Returns the mean value and the mean DAY INDEX of the readings actually found in
 * `[fromIndex, toIndex)`, plus how many there were. An empty block reports
 * `count: 0` and is refused upstream rather than divided by.
 */
function trendBlock(
  byIndex: ReadonlyMap<number, number>,
  fromIndex: number,
  toIndex: number,
): { meanValue: number; meanIndex: number; count: number } {
  let total = 0;
  let indexTotal = 0;
  let count = 0;
  for (const [index, value] of byIndex) {
    if (index < fromIndex || index >= toIndex) continue;
    total += value;
    indexTotal += index;
    count += 1;
  }
  if (count === 0) return { meanValue: 0, meanIndex: 0, count: 0 };
  return { meanValue: total / count, meanIndex: indexTotal / count, count };
}

/**
 * Day-keyed entries as a map from day INDEX (0 = `from`) to value, dropping
 * anything malformed or outside the window. Last one given wins for a repeated
 * day — see `measuredEnergy` on why that is the rule.
 */
function indexByDay<T extends { readonly day: DayKey }>(
  entries: readonly T[],
  fromMs: number,
  windowDays: number,
  read: (entry: T) => number,
): Map<number, number> {
  const byIndex = new Map<number, number>();
  for (const entry of entries) {
    if (!isValidDayKey(entry.day)) continue;
    const index = (dayKeyToUtcMs(entry.day) - fromMs) / MS_PER_DAY;
    if (index < 0 || index >= windowDays) continue;
    const value = read(entry);
    if (!Number.isFinite(value)) continue;
    byIndex.set(index, value);
  }
  return byIndex;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * A day key that is a real calendar day and is not in the future.
 *
 * **A malformed `today` THROWS rather than skipping the future rule.** `value` is
 * the untrusted input and gets a problem code; `today` is the caller's own
 * reference day, so a bad one is a programming error — and silently dropping the
 * one rule it governs would let a birth date in 2090 validate clean, which is the
 * quiet-degradation class this codebase treats as a defect rather than a
 * fallback. `ageOnDay` already throws on the same input for the same reason.
 */
function dayProblems(value: unknown, field: string, today: DayKey): BodyProblem[] {
  if (!isValidDayKey(today)) throw new TypeError(`Invalid reference day: "${today}"`);
  if (typeof value !== "string") return [{ field, code: "shape" }];
  if (!isValidDayKey(value)) return [{ field, code: "day" }];
  // Fixed-width keys, so a lexicographic compare IS a calendar compare.
  if (value > today) return [{ field, code: "future" }];
  return [];
}

/** A required number inside `(min, max]` — `min` exclusive, so a zero weight is refused rather than accepted as „nothing". */
function numberProblems(value: unknown, field: string, min: number, max: number): BodyProblem[] {
  if (typeof value !== "number") return [{ field, code: "shape" }];
  if (!Number.isFinite(value) || value <= min || value > max) return [{ field, code: "range" }];
  return [];
}

/** An optional percentage strictly between 0 and 100 — see `MIN_HEIGHT_CM` on why those bounds are arithmetic rather than judgement. */
function percentProblems(value: unknown, field: string): BodyProblem[] {
  if (value === null) return [];
  if (typeof value !== "number") return [{ field, code: "shape" }];
  if (!Number.isFinite(value) || value <= 0 || value >= 100) return [{ field, code: "range" }];
  return [];
}

function muscleProblems(value: unknown, weightKg: number | null): BodyProblem[] {
  if (value === null) return [];
  if (!isRecord(value)) return [{ field: "muscle", code: "shape" }];

  const unit = value["unit"];
  if (unit !== "percent" && unit !== "kg") return [{ field: "muscle.unit", code: "unit" }];

  const raw = value["value"];
  if (typeof raw !== "number") return [{ field: "muscle.value", code: "shape" }];
  if (unit === "percent") return percentProblems(raw, "muscle.value");
  if (!Number.isFinite(raw) || raw <= 0 || raw > MAX_WEIGHT_KG) {
    return [{ field: "muscle.value", code: "range" }];
  }
  // The one cross-field rule, and it is arithmetic: a part cannot outweigh the
  // whole. `weightKg` is null when the weight did not pass its own check, which
  // is what keeps this from inventing a second problem out of the first.
  if (weightKg !== null && raw > weightKg) {
    return [{ field: "muscle.value", code: "composition" }];
  }
  return [];
}

function circumferenceProblems(value: unknown): BodyProblem[] {
  if (!isRecord(value)) return [{ field: "circumferences", code: "shape" }];

  const problems: BodyProblem[] = [];
  for (const field of ["waist", "hip", "chest", "thigh", "upperArm"] as const) {
    const raw = value[field];
    if (raw === null) continue;
    if (typeof raw !== "number") {
      problems.push({ field: `circumferences.${field}`, code: "shape" });
      continue;
    }
    if (!Number.isFinite(raw) || raw <= 0 || raw > MAX_CIRCUMFERENCE_CM) {
      problems.push({ field: `circumferences.${field}`, code: "range" });
    }
  }
  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
