/**
 * Demo content for FIT — training (migration 060) and nutrition (migration 058).
 *
 * Everything here references the app-shipped catalogues (`EXERCISE_CATALOGUE`,
 * `FOOD_CATALOGUE` in `@nexus/core`) rather than inventing an exercise or a
 * food: every `exerciseRef`/`foodRef` this file writes is `catalogue:<id>`,
 * resolved through `catalogueExercise`/`catalogueFood` exactly the way
 * `resolveLoggedExercise`/`resolveLoggedFood` do at the real IPC boundary in
 * `index.ts`. A demo row and a row a person made are indistinguishable this
 * way, which is the whole point of seeding through the front door.
 *
 * The body: a body profile for a ~23-year-old man, and ~8 months of weight
 * (plus occasional tape) readings on a slow, believable upward trend — a lean
 * bulk, not a fabricated statistic.
 *
 * The training: four routines built from real catalogue exercises (an
 * upper/lower split, a full-body day and a conditioning day), each line
 * carrying a full prescription — sets, a rep range where the exercise has reps,
 * seconds/weight/distance where its METRIC calls for them, and a rest time.
 * ~5 months of logged sessions follow those routines 3–4×/week with a sick
 * week and an exam week missing from the calendar, warm-ups ahead of the
 * working sets, slow weight progression, and the occasional drop or failure
 * set. The muscle spread is wide by construction — 18 of the 20 catalogue
 * muscle groups appear somewhere in a set — and two (hip abduction, hip
 * flexors) never do, on purpose: a body map that lights up everywhere would
 * have nothing to say.
 *
 * The food: the last ~30 days of meals across the five slots, portions typed
 * as grams against the catalogue's own per-100 g figures, a few days left
 * deliberately incomplete and a couple pushed well over target with a logged
 * treat.
 */

import {
  catalogueExercise,
  catalogueFood,
  exerciseRefText,
  foodRefText,
} from "@nexus/core";
import type {
  BodyCircumferences,
  ExerciseEntry,
  ExerciseMetric,
  FoodEntry,
  MuscleGroup,
  SetKind,
} from "@nexus/core";
import {
  FitBodyProfileStore,
  FitMealStore,
  FitMeasurementStore,
  FitRoutineStore,
  FitTargetStore,
  FitWorkoutStore,
} from "@nexus/db";
import type { FitRoutineItemInput, MealSlot } from "@nexus/db";
import {
  demoAt,
  demoDay,
  demoRandom,
  minutes,
  type DatabaseHandle,
  type DemoContext,
  type DemoRandom,
} from "./context.js";

/** A local instant `offset` days from today, as the ISO-8601 string every store's `now` wants. */
function demoIso(ctx: DemoContext, offset: number, hour: number, minute = 0): string {
  return new Date(demoAt(ctx, offset, hour, minute)).toISOString();
}

function clampFraction(fraction: number): number {
  return Math.min(1, Math.max(0, fraction));
}

/** Linear interpolation between `start` and `end` at `fraction` (0..1, clamped). */
function trendLinear(start: number, end: number, fraction: number): number {
  return start + (end - start) * clampFraction(fraction);
}

/**
 * `trendLinear`, snapped to the nearest `step` and wobbled — a plate
 * increment a real log would actually show, never a raw float.
 */
function trendStepped(
  start: number,
  end: number,
  fraction: number,
  step: number,
  wobble: number,
): number {
  const raw = trendLinear(start, end, fraction) + wobble;
  return Math.max(step, Math.round(raw / step) * step);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function requireExercise(id: string): ExerciseEntry {
  const entry = catalogueExercise(id);
  if (entry === undefined) {
    throw new Error(`Demo fitness: catalogue exercise "${id}" does not exist in this build.`);
  }
  return entry;
}

function requireFood(id: string): FoodEntry {
  const entry = catalogueFood(id);
  if (entry === undefined) {
    throw new Error(`Demo fitness: catalogue food "${id}" does not exist in this build.`);
  }
  return entry;
}

// --- Body: profile, targets, measurements -----------------------------------

/** Seeds the body profile, the nutrition targets, and ~8 months of weigh-ins. */
function seedBody(db: DatabaseHandle, ctx: DemoContext, rng: DemoRandom): void {
  // ~23 years old on `ctx.today` — the exact day within the birth year is not
  // load-bearing, so a fixed mid-year date keeps the arithmetic simple.
  const birthYear = Number(ctx.today.slice(0, 4)) - 23;
  new FitBodyProfileStore(db, ctx.profileId).save(
    { sex: "male", birthDate: `${birthYear}-06-15`, heightCm: 181, activity: "moderate" },
    demoIso(ctx, -240, 8),
  );

  // Macros consistent with an ~80 kg moderately active man in a slow lean
  // bulk: 4·180 + 4·310 + 9·90 ≈ 2 770 kcal, close enough to the 2 800 goal
  // that the two numbers do not visibly disagree on the targets screen.
  new FitTargetStore(db, ctx.profileId).save(
    { kcal: 2800, proteinG: 180, carbsG: 310, fatG: 90 },
    demoIso(ctx, -14, 9),
  );

  const measurementStore = new FitMeasurementStore(db, ctx.profileId);
  for (const offset of measurementOffsets()) {
    const fraction = clampFraction((offset + 240) / 240);
    const weightKg = round1(trendLinear(78.4, 82.6, fraction) + rng.int(-4, 4) * 0.15);
    measurementStore.save(
      {
        day: demoDay(ctx, offset),
        weightKg,
        bodyFatPercent: null,
        muscle: null,
        waterPercent: null,
        circumferences: measurementCircumferences(rng, fraction),
      },
      demoIso(ctx, offset, 7, 30),
    );
  }
}

/**
 * ~240 days of weigh-in dates, denser recently: every 12 days for the first
 * five months, every 5 days for the last three — the pattern of someone who
 * only started weighing in regularly once the training stuck.
 */
function measurementOffsets(): readonly number[] {
  const offsets: number[] = [];
  for (let offset = -240; offset <= -90; offset += 12) offsets.push(offset);
  for (let offset = -84; offset <= 0; offset += 5) offsets.push(offset);
  return offsets;
}

/**
 * A few tape sites, not every one every time — the way somebody with a
 * flexible tape actually measures. Waist trends slightly DOWN while weight
 * trends up (a lean bulk), chest and the upper arm trend up with it.
 */
function measurementCircumferences(rng: DemoRandom, fraction: number): BodyCircumferences {
  const wobble = (spread: number): number => rng.int(-spread, spread) * 0.3;
  const waist = rng.chance(0.6) ? round1(trendLinear(84, 81, fraction) + wobble(3)) : null;
  const chest = rng.chance(0.45) ? round1(trendLinear(98, 101.5, fraction) + wobble(3)) : null;
  const upperArm = rng.chance(0.45) ? round1(trendLinear(34, 36.5, fraction) + wobble(2)) : null;
  const neck = rng.chance(0.2) ? round1(38 + wobble(2)) : null;
  const hip = rng.chance(0.2) ? round1(trendLinear(97, 96, fraction) + wobble(2)) : null;
  const thigh = rng.chance(0.2) ? round1(trendLinear(56, 58, fraction) + wobble(2)) : null;
  return { neck, waist, hip, chest, thigh, upperArm };
}

// --- Training: routines and logged sessions ----------------------------------

/** One routine line before it is resolved against the catalogue. */
interface RoutineLine {
  readonly id: string;
  readonly targetSets: number;
  readonly targetRepsMin?: number;
  readonly targetRepsMax?: number;
  readonly targetSeconds?: number;
  readonly targetWeightKg?: number;
  readonly targetDistanceM?: number;
  readonly restSeconds: number;
}

/**
 * Resolves one routine line against `EXERCISE_CATALOGUE` — the same lookup
 * `index.ts`'s `resolveLoggedExercise` runs on the way in from a real IPC call.
 */
function routineItem(line: RoutineLine): FitRoutineItemInput {
  const entry = requireExercise(line.id);
  return {
    exerciseRef: exerciseRefText({ kind: "catalogue", id: entry.id }),
    label: entry.name,
    targetSets: line.targetSets,
    targetRepsMin: line.targetRepsMin ?? null,
    targetRepsMax: line.targetRepsMax ?? null,
    targetSeconds: line.targetSeconds ?? null,
    targetWeightKg: line.targetWeightKg ?? null,
    targetDistanceM: line.targetDistanceM ?? null,
    restSeconds: line.restSeconds,
  };
}

// Push/pull for the upper day. The curl → pushdown pair carries `restSeconds:
// 0` on the curl — straight into the pushdown, the superset case the routine
// store's own doc calls out.
const UPPER_LINES: readonly RoutineLine[] = [
  { id: "potisak-sa-klupe", targetSets: 4, targetRepsMin: 6, targetRepsMax: 8,
    targetWeightKg: 72.5, restSeconds: 120 },
  { id: "veslanje-u-pretklonu", targetSets: 4, targetRepsMin: 6, targetRepsMax: 8,
    targetWeightKg: 60, restSeconds: 120 },
  { id: "potisak-bucicama-iznad-glave-sedeci", targetSets: 3, targetRepsMin: 8,
    targetRepsMax: 10, targetWeightKg: 20, restSeconds: 90 },
  { id: "povlacenje-lat-masina-nathvat", targetSets: 3, targetRepsMin: 8, targetRepsMax: 10,
    targetWeightKg: 58, restSeconds: 90 },
  { id: "bocno-podizanje-bucicama", targetSets: 3, targetRepsMin: 12, targetRepsMax: 15,
    targetWeightKg: 10, restSeconds: 60 },
  { id: "pregib-biceps-sipka", targetSets: 3, targetRepsMin: 10, targetRepsMax: 12,
    targetWeightKg: 30, restSeconds: 0 },
  { id: "ekstenzija-tricepsa-na-sajli", targetSets: 3, targetRepsMin: 10, targetRepsMax: 12,
    targetWeightKg: 27.5, restSeconds: 90 },
];

// Squat-anchored lower day. The leg-curl → leg-extension pair is the second
// superset (leg curl's `restSeconds: 0`); `plank` carries only a target time —
// its metric has no reps and no weight at all.
const LOWER_LINES: readonly RoutineLine[] = [
  { id: "cucanj", targetSets: 4, targetRepsMin: 5, targetRepsMax: 8,
    targetWeightKg: 92.5, restSeconds: 150 },
  { id: "rumunsko-mrtvo-dizanje", targetSets: 3, targetRepsMin: 8, targetRepsMax: 10,
    targetWeightKg: 80, restSeconds: 120 },
  { id: "potisak-nogama", targetSets: 3, targetRepsMin: 10, targetRepsMax: 12,
    targetWeightKg: 170, restSeconds: 90 },
  { id: "pregib-potkolenica-lezeci", targetSets: 3, targetRepsMin: 10, targetRepsMax: 12,
    targetWeightKg: 37.5, restSeconds: 0 },
  { id: "opruzanje-potkolenica", targetSets: 3, targetRepsMin: 12, targetRepsMax: 15,
    targetWeightKg: 45, restSeconds: 75 },
  { id: "podizanje-na-prste-stojeci-sipka", targetSets: 4, targetRepsMin: 12,
    targetRepsMax: 15, targetWeightKg: 55, restSeconds: 60 },
  { id: "plank", targetSets: 3, targetSeconds: 50, restSeconds: 60 },
];

// The third weekly session: a deadlift-led full-body day. `zgibovi-nathvatom`
// (bodyweight pull-ups) carries a rep range and no weight target at all —
// its metric is `reps`, not `weight_reps`.
const FULL_BODY_LINES: readonly RoutineLine[] = [
  { id: "mrtvo-dizanje", targetSets: 3, targetRepsMin: 4, targetRepsMax: 6,
    targetWeightKg: 110, restSeconds: 180 },
  { id: "zgibovi-nathvatom", targetSets: 4, targetRepsMin: 6, targetRepsMax: 10, restSeconds: 90 },
  { id: "vojnicki-potisak", targetSets: 3, targetRepsMin: 6, targetRepsMax: 8,
    targetWeightKg: 45, restSeconds: 120 },
  { id: "iskorak", targetSets: 3, targetRepsMin: 10, targetRepsMax: 12,
    targetWeightKg: 16, restSeconds: 90 },
  { id: "veslanje-na-sajli-sedeci", targetSets: 3, targetRepsMin: 10, targetRepsMax: 12,
    targetWeightKg: 58, restSeconds: 90 },
  { id: "farmerski-hod", targetSets: 3, targetSeconds: 40, targetWeightKg: 32, restSeconds: 90 },
];

// Conditioning day: grip, hips and the engine. Both cardio lines carry a
// target DISTANCE and a target TIME — `distance_time` is the one metric that
// records both at once.
const CONDITIONING_LINES: readonly RoutineLine[] = [
  { id: "zamah-girjom", targetSets: 4, targetRepsMin: 15, targetRepsMax: 20,
    targetWeightKg: 24, restSeconds: 45 },
  { id: "veslanje-na-veslacu", targetSets: 4, targetDistanceM: 500, targetSeconds: 110,
    restSeconds: 90 },
  { id: "farmerski-hod-girjama", targetSets: 3, targetSeconds: 40,
    targetWeightKg: 28, restSeconds: 75 },
  { id: "trcanje-na-traci", targetSets: 1, targetDistanceM: 3000,
    targetSeconds: 780, restSeconds: 60 },
];

type RoutineKey = "upper" | "lower" | "full" | "cond";

const ROUTINE_LINES: Record<RoutineKey, readonly RoutineLine[]> = {
  upper: UPPER_LINES,
  lower: LOWER_LINES,
  full: FULL_BODY_LINES,
  cond: CONDITIONING_LINES,
};

const ROUTINE_NAMES: Record<RoutineKey, string> = {
  upper: "Gornje telo",
  lower: "Donje telo",
  full: "Celo telo",
  cond: "Kondicioni trening",
};

const ROUTINE_NOTES: Record<RoutineKey, string> = {
  upper: "Guranje i povlačenje za gornji deo tela, dva puta nedeljno.",
  lower: "Noge i stomak, sa akcentom na čučanj i zadnju ložu.",
  full: "Treći trening nedeljno — mrtvo dizanje, zgibovi i noge u jednoj sesiji.",
  cond: "Kondicija i hvat — girje, veslački ergometar i traka.",
};

const ROUTINE_START_HOUR: Record<RoutineKey, number> = {
  upper: 18,
  lower: 18,
  full: 10,
  cond: 17,
};

/** One logged set before it is stamped with the exercise it belongs to. */
interface SetPlan {
  readonly kind: SetKind;
  readonly weightKg?: number | null;
  readonly reps?: number | null;
  readonly seconds?: number | null;
  readonly distanceM?: number | null;
  readonly rir?: number | null;
}

/**
 * `weight_reps` progression: warm-ups ahead of the working sets, the working
 * weight climbing from `startKg` to `endKg` over the training window, and a
 * chance of a failure set or a drop set trailing the last working set — the
 * texture a real log has and a flat „N sets of M" never does.
 */
function weightReps(cfg: {
  readonly startKg: number;
  readonly endKg: number;
  readonly step: number;
  readonly repMin: number;
  readonly repMax: number;
  readonly sets: number;
  readonly warmups: number;
}): (rng: DemoRandom, fraction: number) => SetPlan[] {
  return (rng, fraction) => {
    const working = trendStepped(
      cfg.startKg, cfg.endKg, fraction, cfg.step, rng.int(-1, 1) * cfg.step,
    );
    const plans: SetPlan[] = [];
    for (let warmup = 0; warmup < cfg.warmups; warmup += 1) {
      const pct = warmup === 0 ? 0.5 : 0.72;
      plans.push({
        kind: "warmup",
        weightKg: Math.max(cfg.step, Math.round((working * pct) / cfg.step) * cfg.step),
        reps: cfg.repMax + rng.int(2, 4),
        rir: null,
      });
    }
    for (let set = 0; set < cfg.sets; set += 1) {
      const isLast = set === cfg.sets - 1;
      const failing = isLast && rng.chance(0.22);
      plans.push({
        kind: failing ? "failure" : "working",
        weightKg: working,
        reps: rng.int(cfg.repMin, cfg.repMax),
        rir: failing ? 0 : rng.int(0, 3),
      });
      if (isLast && !failing && rng.chance(0.15)) {
        plans.push({
          kind: "drop",
          weightKg: Math.max(cfg.step, Math.round((working * 0.75) / cfg.step) * cfg.step),
          reps: rng.int(cfg.repMin, cfg.repMax + 3),
          rir: 0,
        });
      }
    }
    return plans;
  };
}

/**
 * `reps` progression (bodyweight): the rep count itself climbs, fatigue
 * trims a rep or two off the later sets.
 */
function repsOnly(cfg: {
  readonly startReps: number;
  readonly endReps: number;
  readonly sets: number;
}): (rng: DemoRandom, fraction: number) => SetPlan[] {
  return (rng, fraction) => {
    const target = Math.round(trendLinear(cfg.startReps, cfg.endReps, fraction));
    const plans: SetPlan[] = [];
    for (let set = 0; set < cfg.sets; set += 1) {
      const isLast = set === cfg.sets - 1;
      const failing = isLast && rng.chance(0.2);
      const fatigue = Math.min(set, 2);
      plans.push({
        kind: failing ? "failure" : "working",
        reps: Math.max(1, target - fatigue + rng.int(-1, 1)),
        rir: failing ? 0 : rng.int(0, 3),
      });
    }
    return plans;
  };
}

/** `time` progression (a hold): every set is the same shape, just longer as the months go by. */
function timeOnly(cfg: {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly sets: number;
}): (rng: DemoRandom, fraction: number) => SetPlan[] {
  return (rng, fraction) => {
    const target = Math.round(trendLinear(cfg.startSeconds, cfg.endSeconds, fraction));
    const plans: SetPlan[] = [];
    for (let set = 0; set < cfg.sets; set += 1) {
      plans.push({ kind: "working", seconds: Math.max(10, target + rng.int(-5, 5)) });
    }
    return plans;
  };
}

/** `weight_time` progression (a loaded carry): both the load and the hold climb together. */
function weightTime(cfg: {
  readonly startKg: number;
  readonly endKg: number;
  readonly step: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly sets: number;
}): (rng: DemoRandom, fraction: number) => SetPlan[] {
  return (rng, fraction) => {
    const weightKg = trendStepped(
      cfg.startKg, cfg.endKg, fraction, cfg.step, rng.int(-1, 1) * cfg.step,
    );
    const seconds = Math.round(trendLinear(cfg.startSeconds, cfg.endSeconds, fraction));
    const plans: SetPlan[] = [];
    for (let set = 0; set < cfg.sets; set += 1) {
      plans.push({
        kind: "working",
        weightKg,
        seconds: Math.max(15, seconds + rng.int(-4, 4)),
      });
    }
    return plans;
  };
}

/** `distance_time` progression (cardio): the distance grows and the pace tightens. */
function distanceTime(cfg: {
  readonly startM: number;
  readonly endM: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly sets: number;
}): (rng: DemoRandom, fraction: number) => SetPlan[] {
  return (rng, fraction) => {
    const distanceM = Math.round(trendLinear(cfg.startM, cfg.endM, fraction) / 10) * 10;
    const seconds = Math.round(trendLinear(cfg.startSeconds, cfg.endSeconds, fraction));
    const plans: SetPlan[] = [];
    for (let set = 0; set < cfg.sets; set += 1) {
      plans.push({
        kind: "working",
        distanceM: Math.max(50, distanceM + rng.int(-20, 20)),
        seconds: Math.max(20, seconds + rng.int(-10, 10)),
      });
    }
    return plans;
  };
}

/**
 * The historical performance behind every catalogue exercise a routine names
 * — deliberately a SECOND table from the routines' own target numbers above,
 * not derived from them: a routine's target is the aspiration written on the
 * card, a logged set is what actually happened that day, and the two are
 * allowed to disagree exactly the way a real log's newest set can beat the
 * routine card it was never updated to match.
 */
const EXERCISE_PLANS: Record<string, (rng: DemoRandom, fraction: number) => SetPlan[]> = {
  "potisak-sa-klupe":
    weightReps({ startKg: 55, endKg: 72.5, step: 2.5, repMin: 6, repMax: 8, sets: 4, warmups: 2 }),
  "veslanje-u-pretklonu":
    weightReps({ startKg: 45, endKg: 60, step: 2.5, repMin: 6, repMax: 8, sets: 4, warmups: 1 }),
  "potisak-bucicama-iznad-glave-sedeci":
    weightReps({ startKg: 14, endKg: 20, step: 2, repMin: 8, repMax: 10, sets: 3, warmups: 1 }),
  "povlacenje-lat-masina-nathvat":
    weightReps({ startKg: 45, endKg: 58, step: 2.5, repMin: 8, repMax: 10, sets: 3, warmups: 1 }),
  "bocno-podizanje-bucicama":
    weightReps({ startKg: 6, endKg: 10, step: 1, repMin: 12, repMax: 15, sets: 3, warmups: 0 }),
  "pregib-biceps-sipka":
    weightReps({ startKg: 20, endKg: 30, step: 2.5, repMin: 10, repMax: 12, sets: 3, warmups: 0 }),
  "ekstenzija-tricepsa-na-sajli": weightReps({
    startKg: 18, endKg: 27.5, step: 2.5, repMin: 10, repMax: 12, sets: 3, warmups: 0,
  }),

  cucanj:
    weightReps({ startKg: 65, endKg: 92.5, step: 2.5, repMin: 5, repMax: 8, sets: 4, warmups: 2 }),
  "rumunsko-mrtvo-dizanje":
    weightReps({ startKg: 55, endKg: 80, step: 2.5, repMin: 8, repMax: 10, sets: 3, warmups: 1 }),
  "potisak-nogama":
    weightReps({ startKg: 120, endKg: 170, step: 5, repMin: 10, repMax: 12, sets: 3, warmups: 1 }),
  "pregib-potkolenica-lezeci": weightReps({
    startKg: 25, endKg: 37.5, step: 2.5, repMin: 10, repMax: 12, sets: 3, warmups: 0,
  }),
  "opruzanje-potkolenica":
    weightReps({ startKg: 30, endKg: 45, step: 2.5, repMin: 12, repMax: 15, sets: 3, warmups: 0 }),
  "podizanje-na-prste-stojeci-sipka":
    weightReps({ startKg: 40, endKg: 55, step: 2.5, repMin: 12, repMax: 15, sets: 4, warmups: 0 }),
  plank: timeOnly({ startSeconds: 30, endSeconds: 55, sets: 3 }),

  "mrtvo-dizanje":
    weightReps({ startKg: 80, endKg: 112.5, step: 2.5, repMin: 4, repMax: 5, sets: 3, warmups: 2 }),
  "zgibovi-nathvatom": repsOnly({ startReps: 4, endReps: 9, sets: 4 }),
  "vojnicki-potisak":
    weightReps({ startKg: 30, endKg: 45, step: 2.5, repMin: 6, repMax: 8, sets: 3, warmups: 1 }),
  iskorak:
    weightReps({ startKg: 10, endKg: 16, step: 2, repMin: 10, repMax: 12, sets: 3, warmups: 0 }),
  "veslanje-na-sajli-sedeci":
    weightReps({ startKg: 45, endKg: 58, step: 2.5, repMin: 10, repMax: 12, sets: 3, warmups: 1 }),
  "farmerski-hod":
    weightTime({ startKg: 24, endKg: 32, step: 2, startSeconds: 30, endSeconds: 42, sets: 3 }),

  "zamah-girjom":
    weightReps({ startKg: 16, endKg: 24, step: 2, repMin: 15, repMax: 20, sets: 4, warmups: 1 }),
  "veslanje-na-veslacu":
    distanceTime({ startM: 400, endM: 550, startSeconds: 130, endSeconds: 108, sets: 4 }),
  "farmerski-hod-girjama":
    weightTime({ startKg: 20, endKg: 28, step: 2, startSeconds: 30, endSeconds: 42, sets: 3 }),
  "trcanje-na-traci":
    distanceTime({ startM: 2000, endM: 3500, startSeconds: 720, endSeconds: 900, sets: 1 }),
};

interface PlannedSession {
  readonly offset: number;
  readonly routine: RoutineKey;
}

/**
 * ~5 months of training dates, 3–4 sessions a week with a genuine gap in two
 * places: a full week lost to being sick, and an exam week that survives on a
 * single full-body session instead of the usual three or four. The
 * microcycle (upper, lower, full, upper, lower, conditioning) is what keeps
 * every routine appearing repeatedly rather than the calendar drawing one at
 * random each time, which is what a person who actually follows a split does.
 */
function buildSessionCalendar(rng: DemoRandom): readonly PlannedSession[] {
  const microcycle: readonly RoutineKey[] = ["upper", "lower", "full", "upper", "lower", "cond"];
  const sessions: PlannedSession[] = [];
  const sickWeekStart = -98;
  const examWeekStart = -49;
  let cycleIndex = 0;
  let offset = -150;

  while (offset <= 0) {
    if (offset >= sickWeekStart && offset < sickWeekStart + 7) {
      offset = sickWeekStart + 7;
      continue;
    }
    if (offset >= examWeekStart && offset < examWeekStart + 7) {
      sessions.push({ offset: examWeekStart + 3, routine: "full" });
      cycleIndex += 1;
      offset = examWeekStart + 7;
      continue;
    }
    sessions.push({ offset, routine: microcycle[cycleIndex % microcycle.length] ?? "upper" });
    cycleIndex += 1;
    offset += rng.int(1, 3);
  }

  return sessions;
}

/**
 * One catalogue exercise, resolved into the shape `FitWorkoutStore.logSet`
 * wants — `resolveLoggedExercise`'s own return shape.
 */
function loggedExercise(id: string): {
  exerciseRef: string;
  label: string;
  metric: ExerciseMetric;
  primaryMuscles: MuscleGroup[];
} {
  const entry = requireExercise(id);
  return {
    exerciseRef: exerciseRefText({ kind: "catalogue", id: entry.id }),
    label: entry.name,
    metric: entry.metric,
    primaryMuscles: [...entry.primaryMuscles],
  };
}

/** Starts, logs and finishes one training session. */
function logSession(
  store: FitWorkoutStore,
  ctx: DemoContext,
  rng: DemoRandom,
  session: PlannedSession,
  routineRef: string,
  routineLabel: string,
): void {
  const startHour = ROUTINE_START_HOUR[session.routine];
  const startInstant = demoAt(ctx, session.offset, startHour, rng.int(0, 45));
  const startedAt = new Date(startInstant).toISOString();

  const workout = store.start(
    { day: demoDay(ctx, session.offset), routineRef, routineLabel },
    startedAt,
  );

  const fraction = clampFraction((session.offset + 150) / 150);
  for (const line of ROUTINE_LINES[session.routine]) {
    const exercise = loggedExercise(line.id);
    const plan = EXERCISE_PLANS[line.id];
    if (plan === undefined) {
      throw new Error(`Demo fitness: no set progression for catalogue exercise "${line.id}".`);
    }
    for (const set of plan(rng, fraction)) {
      store.logSet(
        workout.id,
        {
          exerciseRef: exercise.exerciseRef,
          label: exercise.label,
          metric: exercise.metric,
          primaryMuscles: exercise.primaryMuscles,
          kind: set.kind,
          weightKg: set.weightKg ?? null,
          reps: set.reps ?? null,
          seconds: set.seconds ?? null,
          distanceM: set.distanceM ?? null,
          rir: set.rir ?? null,
        },
        startedAt,
      );
    }
  }

  const endInstant = startInstant + minutes(rng.int(35, 75));
  store.finish(workout.id, new Date(endInstant).toISOString());
}

/** Seeds the four routines and ~5 months of sessions logged against them. */
function seedTraining(db: DatabaseHandle, ctx: DemoContext, rng: DemoRandom): void {
  const routineStore = new FitRoutineStore(db, ctx.profileId);
  const workoutStore = new FitWorkoutStore(db, ctx.profileId);
  const createdAt = demoIso(ctx, -150, 8);

  const routines: Record<RoutineKey, { readonly id: string; readonly name: string }> = {
    upper: routineStore.create(
      {
        name: ROUTINE_NAMES.upper,
        notes: ROUTINE_NOTES.upper,
        items: UPPER_LINES.map(routineItem),
      },
      createdAt,
    ),
    lower: routineStore.create(
      {
        name: ROUTINE_NAMES.lower,
        notes: ROUTINE_NOTES.lower,
        items: LOWER_LINES.map(routineItem),
      },
      createdAt,
    ),
    full: routineStore.create(
      {
        name: ROUTINE_NAMES.full,
        notes: ROUTINE_NOTES.full,
        items: FULL_BODY_LINES.map(routineItem),
      },
      createdAt,
    ),
    cond: routineStore.create(
      {
        name: ROUTINE_NAMES.cond,
        notes: ROUTINE_NOTES.cond,
        items: CONDITIONING_LINES.map(routineItem),
      },
      createdAt,
    ),
  };

  for (const session of buildSessionCalendar(rng)) {
    const routine = routines[session.routine];
    logSession(workoutStore, ctx, rng, session, routine.id, routine.name);
  }
}

// --- Nutrition: the last month of meals --------------------------------------

interface MealOption {
  readonly foodId: string;
  readonly gramsMin: number;
  readonly gramsMax: number;
}

const MEAL_MENU: Record<MealSlot, readonly MealOption[]> = {
  dorucak: [
    { foodId: "jaje-kuvano", gramsMin: 100, gramsMax: 120 },
    { foodId: "ovsena-kasa-kuvana", gramsMin: 200, gramsMax: 280 },
    { foodId: "hleb-integralni", gramsMin: 60, gramsMax: 90 },
    { foodId: "jogurt-punomasni", gramsMin: 150, gramsMax: 220 },
    { foodId: "banana-sveza", gramsMin: 100, gramsMax: 140 },
  ],
  uzina1: [
    { foodId: "jabuka-sveza-sa-korom", gramsMin: 130, gramsMax: 180 },
    { foodId: "badem-jezgro", gramsMin: 20, gramsMax: 35 },
    { foodId: "jogurt-posni", gramsMin: 150, gramsMax: 200 },
  ],
  rucak: [
    { foodId: "piletina-belo-meso-grilovano", gramsMin: 150, gramsMax: 220 },
    { foodId: "pirinac-beli-kuvan", gramsMin: 150, gramsMax: 220 },
    { foodId: "krompir-pecen", gramsMin: 150, gramsMax: 220 },
    { foodId: "brokoli-svez", gramsMin: 100, gramsMax: 160 },
    { foodId: "sopska-salata", gramsMin: 150, gramsMax: 220 },
  ],
  uzina2: [
    { foodId: "puter-od-kikirikija", gramsMin: 15, gramsMax: 30 },
    { foodId: "orah-jezgro", gramsMin: 20, gramsMax: 35 },
    { foodId: "jogurt-lagani", gramsMin: 150, gramsMax: 200 },
  ],
  vecera: [
    { foodId: "govedina-biftek-peceno", gramsMin: 150, gramsMax: 200 },
    { foodId: "testenina-kuvana", gramsMin: 150, gramsMax: 220 },
    { foodId: "spanac-svez", gramsMin: 100, gramsMax: 160 },
    { foodId: "sir-kackavalj", gramsMin: 25, gramsMax: 45 },
  ],
};

/** Logged only on a deliberately over-target day, on top of the ordinary slots. */
const TREAT_FOODS: readonly MealOption[] = [
  { foodId: "cips-od-krompira", gramsMin: 60, gramsMax: 100 },
  { foodId: "sladoled-cokolada", gramsMin: 100, gramsMax: 180 },
  { foodId: "pljeskavica-u-lepinji", gramsMin: 220, gramsMax: 280 },
  { foodId: "pomfrit", gramsMin: 150, gramsMax: 220 },
];

const SLOT_HOUR: Record<MealSlot, number> = {
  dorucak: 8,
  uzina1: 11,
  rucak: 13,
  uzina2: 17,
  vecera: 20,
};

const CORE_SLOTS: readonly MealSlot[] = ["dorucak", "rucak", "vecera"];
const SNACK_SLOTS: readonly MealSlot[] = ["uzina1", "uzina2"];
const TREAT_SLOTS: readonly MealSlot[] = ["uzina1", "uzina2", "vecera"];

/** Logs one catalogue food into one slot, at the plausible hour that slot is usually eaten. */
function logMealItem(
  store: FitMealStore,
  ctx: DemoContext,
  rng: DemoRandom,
  day: string,
  offset: number,
  slot: MealSlot,
  option: MealOption,
): void {
  const food = requireFood(option.foodId);
  store.addItem(
    {
      date: day,
      slot,
      foodRef: foodRefText({ kind: "catalogue", id: food.id }),
      label: food.name,
      grams: rng.int(option.gramsMin, option.gramsMax),
      per100g: food.per100g,
    },
    demoIso(ctx, offset, SLOT_HOUR[slot]),
  );
}

/**
 * Seeds ~30 days of meals: mostly 3–4 core entries a day, a few thin days, a
 * couple pushed over target with a treat.
 */
function seedMeals(db: DatabaseHandle, ctx: DemoContext, rng: DemoRandom): void {
  const store = new FitMealStore(db, ctx.profileId);

  for (let offset = -29; offset <= 0; offset += 1) {
    const day = demoDay(ctx, offset);
    const roll = rng.next();
    const incomplete = roll < 0.12;
    const overTarget = roll >= 0.88;

    const slots: readonly MealSlot[] = incomplete
      ? rng.some(CORE_SLOTS, rng.chance(0.5) ? 1 : 2)
      : [...CORE_SLOTS, ...(rng.chance(0.6) ? [rng.of(SNACK_SLOTS)] : [])];

    for (const slot of slots) {
      logMealItem(store, ctx, rng, day, offset, slot, rng.of(MEAL_MENU[slot]));
    }

    if (overTarget) {
      const treatCount = rng.int(1, 2);
      for (let treat = 0; treat < treatCount; treat += 1) {
        const slot = rng.of(TREAT_SLOTS);
        logMealItem(store, ctx, rng, day, offset, slot, rng.of(TREAT_FOODS));
      }
    }
  }
}

/** Seeds a full FIT profile: body, training and the last month of nutrition. */
export function seedDemoFitness(db: DatabaseHandle, ctx: DemoContext): void {
  const rng = demoRandom("fitness");
  seedBody(db, ctx, rng);
  seedTraining(db, ctx, rng);
  seedMeals(db, ctx, rng);
}
