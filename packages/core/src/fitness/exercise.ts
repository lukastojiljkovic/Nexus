/**
 * FIT's exercise vocabulary: what an exercise IS, and the four closed lists that
 * make a training log something more than a table of names.
 *
 * **`metric` is the field that carries the module.** Most exercise catalogues
 * store a name, a muscle and a piece of equipment, and then let every set carry
 * a weight column and a reps column that the app hopes are filled in. That is
 * how a plank ends up with 0 kg × 1 rep and a run ends up in a tonnage total.
 * Here the entry declares up front what a set of it RECORDS, and `training.ts`
 * switches on that declaration rather than guessing from which fields happen to
 * be present.
 *
 * **`assisted_reps` is a metric of its own and not `weighted_reps` with a minus
 * sign.** An assisted pull-up gets EASIER as the number goes down — 30 kg of
 * machine help this month against 40 kg last month is progress — while every
 * other loaded metric improves upwards. A single signed column would make every
 * progression indicator in the app draw that improvement as a regression unless
 * each of them remembered the sign convention on its own, which is exactly the
 * kind of thing one of them would eventually forget. The direction is therefore
 * a property of the METRIC, stated once, where the arithmetic can read it.
 *
 * **The catalogue this vocabulary describes ships INSIDE the app and is not
 * database rows** — the same arrangement `food.ts` documents at length, for the
 * same reason: seeding a couple of hundred identical exercises into every
 * profile's encrypted database would put app data where user data lives, and
 * from there into every export archive. `data/exercises.json` is a file the
 * build inlines; a user's own exercises are the user's own rows.
 *
 * **Two names, both real.** `name` is Serbian and is what the app displays;
 * `nameEn` is the English one, because the lifting world writes „RDL" and „hip
 * thrust" and a Serb reaching for either will type either. A catalogue that
 * carried only the Serbian would be unsearchable for half of what its own users
 * call these movements.
 *
 * Nothing here reads a clock, touches a DOM or imports `node:` anything.
 */

import { foldSearchText } from "../search/searchText.js";

/**
 * The muscles an exercise can be attributed to. Serbian keys, for `food.ts`'s
 * reason: they are DATA in a Serbian dataset rather than copy, and an English
 * key would need a second mapping nobody would keep in step.
 *
 * The granularity is „what a training split actually separates", not „what an
 * anatomy atlas separates". Chest is one group because no program trains
 * pectoralis minor on its own; the deltoid is three because front, side and rear
 * are trained by different movements and a program can genuinely miss one of
 * them for months. Two conventions worth stating, because entries were written
 * against them:
 *
 * - `gluteusi` is the gluteus MAXIMUS — hip extension, what a hip thrust trains.
 *   `abduktori` is the abduction side (gluteus medius/minimus and TFL), which
 *   the machines and the band work and which hip extension does not.
 * - `donja-ledja` is the erector spinae as a spinal extensor, listed when an
 *   exercise loads it, whether it is holding a position (deadlift) or moving
 *   through one (hyperextension).
 *
 * Closed on purpose: an unknown muscle is refused rather than absorbed, which is
 * what keeps a per-muscle weekly-volume read from growing a silent bucket.
 */
export const MUSCLE_GROUPS = [
  "grudi",
  "latovi",
  "romboidi",
  "trapez",
  "donja-ledja",
  "prednja-ramena",
  "bocna-ramena",
  "zadnja-ramena",
  "biceps",
  "triceps",
  "podlaktica",
  "kvadriceps",
  "zadnja-loza",
  "gluteusi",
  "adduktori",
  "abduktori",
  "listovi",
  "trbusnjaci",
  "kosi-trbusni",
  "fleksori-kuka",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/**
 * What provides the resistance. Not „what is in the room" — a bench and a rack
 * are supports rather than loads, and neither is a value here.
 *
 * The cardio machines are listed individually rather than as one
 * „kardio-sprava", because they are what a user picks between when they log a
 * session and because a rower and a stair climber load different legs. Outdoor
 * running, swimming and every bodyweight movement carry `sopstvena-tezina`:
 * there is no implement, and that is a fact about the exercise rather than a
 * gap in the list.
 *
 * `bicikl` covers the road bike and the stationary one alike — the exercise
 * entry says which, and splitting the equipment would claim they load the legs
 * differently, which they do not.
 */
export const EXERCISE_EQUIPMENT = [
  "sipka",
  "ez-sipka",
  "t-sipka",
  "bucice",
  "girja",
  "sprava",
  "smit",
  "kabl",
  "sopstvena-tezina",
  "guma",
  "karike",
  "trx",
  "medicinka",
  "tocak",
  "vijaca",
  "traka-za-trcanje",
  "bicikl",
  "veslac",
  "elipticna",
  "stepper",
] as const;

export type ExerciseEquipment = (typeof EXERCISE_EQUIPMENT)[number];

/**
 * The movement pattern — the shape of the exercise rather than the muscle it
 * bills. This is the vocabulary a program is checked against („nothing pulled
 * vertically in three weeks"), which is a question no muscle list can answer:
 * a lat pulldown and a barbell row both say `latovi` and are not
 * interchangeable.
 *
 * The set, and why it is exactly this one:
 *
 * - The four upper-body patterns are the plane × direction grid — push/pull
 *   crossed with horizontal/vertical. An incline press is `horizontalni-potisak`
 *   and not a third thing: it is still a press away from the torso, and only the
 *   overhead press is genuinely vertical. Dips are `vertikalni-potisak`, because
 *   the load travels along the spine even though the body moves instead of the
 *   bar.
 * - `cucanj`, `pregib-kuka` and `iskorak` are the three lower-body patterns that
 *   a program has to balance: knee-dominant, hip-dominant, and split-stance.
 *   Jumps sit with the pattern they are the explosive version of rather than in a
 *   „plyometric" bucket, which would be an intensity label wearing a pattern's
 *   clothes.
 * - `nosenje` is loaded locomotion and static holds. It is the one pattern that
 *   is neither a push nor a pull, and the one a program most commonly omits
 *   entirely, so it earns a name.
 * - `olimpijski` is triple extension under a bar — the snatch and clean family.
 *   Filing a clean as a hinge would be true about its first half and useless
 *   about the rest.
 * - `trup` is trunk work, both the anti-motion holds and the flexion/rotation
 *   movements.
 * - `kardio` is cyclical conditioning.
 * - **`izolacija` is honestly a SCOPE and not a shape**, and it is the one entry
 *   in this list that does not describe a movement. The alternative was ten
 *   single-joint „patterns" — elbow flexion, knee extension, shoulder abduction —
 *   that no coach uses to plan a week and no screen would group by. Naming it
 *   what it is beats pretending a lateral raise has a pattern it does not have.
 */
export const MOVEMENT_PATTERNS = [
  "horizontalni-potisak",
  "vertikalni-potisak",
  "horizontalno-privlacenje",
  "vertikalno-privlacenje",
  "cucanj",
  "pregib-kuka",
  "iskorak",
  "nosenje",
  "olimpijski",
  "trup",
  "izolacija",
  "kardio",
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

/**
 * What one set of this exercise RECORDS. Seven values, closed, and every one of
 * them is a different pair of columns on the logging screen:
 *
 * | value | a set carries | example |
 * |---|---|---|
 * | `weight_reps` | weight and reps | potisak sa klupe |
 * | `reps` | reps alone | zgibovi, sklekovi |
 * | `weighted_reps` | ADDED weight (0 is legal) and reps | zgibovi sa tegom |
 * | `assisted_reps` | SUBTRACTED assistance and reps | zgibovi na spravi za pomoć |
 * | `time` | seconds | plank |
 * | `weight_time` | weight and seconds | farmerski hod |
 * | `distance_time` | distance and seconds | trčanje, veslanje |
 *
 * `weighted_reps` and `assisted_reps` both carry „a load and a rep count" and
 * are still two values, because their loads point in opposite directions: +10 kg
 * on the belt is a harder pull-up, 10 kg of machine help is an easier one. See
 * the file header for why that lives in the metric rather than in a sign.
 *
 * The keys are English while `MUSCLE_GROUPS` and the rest are Serbian, and the
 * split is deliberate: those three name things in a Serbian dataset, while this
 * is a structural discriminant that `training.ts` switches on — the same role
 * `FoodSource.kind`'s `"usda" | "derived" | "stated"` already plays, and spelt
 * the same way.
 */
export const EXERCISE_METRICS = [
  "weight_reps",
  "reps",
  "weighted_reps",
  "assisted_reps",
  "time",
  "weight_time",
  "distance_time",
] as const;

export type ExerciseMetric = (typeof EXERCISE_METRICS)[number];

/**
 * One catalogue exercise.
 *
 * `id` is a stable kebab-case ASCII slug and is what a logged set REFERS to, so
 * renaming an exercise is free and re-slugging one is not — the log would stop
 * finding it. ASCII rather than the Serbian name folded, for `food.ts`'s reason:
 * a slug that changed when the folding table changed would silently orphan
 * history.
 *
 * **There is no description or instruction field, on purpose.** How to perform a
 * movement is the one genuinely expressive part of this domain — it is prose,
 * and prose is what gets copied out of somebody else's product. Everything here
 * is a statement of fact we can state ourselves: this movement is called this,
 * it trains these muscles, it uses this implement, it is this shape, and a set
 * of it records these numbers. Half-written instructions would be worse than
 * none, so there are none.
 *
 * `unilateral` is a field rather than something inferred from the name, because
 * it changes what one „set" MEANS: eight reps of a one-arm row is eight per
 * side, and any per-week set count that treats it as eight total is off by half
 * for every single-limb exercise in the log.
 */
export interface ExerciseEntry {
  readonly id: string;
  /** The Serbian name, as it is said in a gym here — this is what the app displays. */
  readonly name: string;
  /** The English name, searched but never displayed. */
  readonly nameEn: string;
  /** What the exercise is FOR. Never empty: an exercise trains something, or it is not an entry. */
  readonly primaryMuscles: readonly MuscleGroup[];
  /** What also works, and may legitimately be empty — a leg extension assists nothing. */
  readonly secondaryMuscles: readonly MuscleGroup[];
  readonly equipment: ExerciseEquipment;
  readonly pattern: MovementPattern;
  /** One limb at a time, so a logged set is „per side" rather than „in total". */
  readonly unilateral: boolean;
  readonly metric: ExerciseMetric;
}

/**
 * What is wrong with one entry, in the vocabulary the catalogue's own gate
 * speaks — `food.ts`'s `FoodEntryProblem` in every respect but the codes.
 * `field` is a path into the entry (`"primaryMuscles[1]"`) so a failing test
 * names the value rather than the row.
 */
export interface ExerciseEntryProblem {
  readonly field: string;
  readonly code: ExerciseProblemCode;
}

export type ExerciseProblemCode =
  /** Missing, or the wrong kind of thing entirely (a number where a string belongs, a non-array muscle list). */
  | "shape"
  /** Not a kebab-case ASCII slug. */
  | "id"
  /** Outside `MUSCLE_GROUPS`. */
  | "muscle"
  /** Outside `EXERCISE_EQUIPMENT`. */
  | "equipment"
  /** Outside `MOVEMENT_PATTERNS`. */
  | "pattern"
  /** Outside `EXERCISE_METRICS`, or a metric that contradicts the equipment. */
  | "metric"
  /** `primaryMuscles` is empty — an exercise that trains nothing is not an entry. */
  | "empty"
  /** The same muscle listed twice inside one list. */
  | "duplicate"
  /** A muscle listed as both primary and secondary, which any per-muscle rollup would count twice. */
  | "overlap";

/**
 * Lower-case ASCII words joined by single hyphens. Mirrors `food.ts`'s
 * `FOOD_ID_RE` deliberately rather than importing it: the two govern separate
 * id namespaces that answer to their own catalogues, and the codebase already
 * repeats a small shared rule this way where the alternative is a dependency
 * between modules that have nothing else to say to each other (`studyStats.ts`
 * and `habitStreak.ts` each carry their own `utcDayMs` for the same reason).
 */
const EXERCISE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Everything wrong with `value`, in a fixed order; an EMPTY array means it
 * passed. Takes `unknown` on purpose — its main caller is the test that guards
 * `data/exercises.json`, and that file is replaced wholesale by a dataset this
 * module never typechecked. The contract is `validateFoodEntry`'s, down to the
 * `{ field, code }` pair and the total return.
 *
 * **The one cross-field rule: bodyweight is never `weight_reps`.** A movement
 * whose resistance is the body has no bar to put kilograms on. What it can have
 * is a belt (`weighted_reps`, where the number is what was ADDED), a machine or
 * a band taking weight off (`assisted_reps`), a clock (`time`), or nothing but
 * the count (`reps`). An entry claiming `sopstvena-tezina` and `weight_reps`
 * together is asking the logging screen for a load column nobody can fill, and
 * the answer users would give it is their bodyweight — a number that would then
 * be summed into tonnage as though they had lifted a barbell.
 *
 * Nothing else is checked across fields. Rules like „cardio must be timed" read
 * plausibly and are the kind that turn out to be wrong about the eleventh
 * entry; the closed vocabularies plus the structural rules are what this gate
 * can enforce without inventing an opinion.
 */
export function validateExerciseEntry(value: unknown): readonly ExerciseEntryProblem[] {
  const problems: ExerciseEntryProblem[] = [];
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  if (typeof value["id"] !== "string" || !EXERCISE_ID_RE.test(value["id"])) {
    problems.push({ field: "id", code: "id" });
  }
  for (const field of ["name", "nameEn"] as const) {
    const text = value[field];
    if (typeof text !== "string" || text.trim().length === 0) {
      problems.push({ field, code: "shape" });
    }
  }

  const primary = muscleListProblems(value["primaryMuscles"], "primaryMuscles", true);
  const secondary = muscleListProblems(value["secondaryMuscles"], "secondaryMuscles", false);
  problems.push(...primary.problems, ...secondary.problems);
  // Reported against the SECONDARY entry: primary is where a muscle belongs when
  // it is in both lists, so that is the side with the mistake on it.
  secondary.seen.forEach((index, muscle) => {
    if (primary.seen.has(muscle)) {
      problems.push({ field: `secondaryMuscles[${index}]`, code: "overlap" });
    }
  });

  if (!(EXERCISE_EQUIPMENT as readonly unknown[]).includes(value["equipment"])) {
    problems.push({ field: "equipment", code: "equipment" });
  }
  if (!(MOVEMENT_PATTERNS as readonly unknown[]).includes(value["pattern"])) {
    problems.push({ field: "pattern", code: "pattern" });
  }
  if (typeof value["unilateral"] !== "boolean") {
    problems.push({ field: "unilateral", code: "shape" });
  }
  if (!(EXERCISE_METRICS as readonly unknown[]).includes(value["metric"])) {
    problems.push({ field: "metric", code: "metric" });
  } else if (value["equipment"] === "sopstvena-tezina" && value["metric"] === "weight_reps") {
    problems.push({ field: "metric", code: "metric" });
  }

  return problems;
}

/**
 * Reads one muscle list. Returns the problems AND the muscles it saw with the
 * index each first appeared at, so the caller can check the two lists against
 * each other without walking them a second time.
 */
function muscleListProblems(
  value: unknown,
  path: string,
  required: boolean,
): { problems: ExerciseEntryProblem[]; seen: Map<string, number> } {
  const seen = new Map<string, number>();
  if (!Array.isArray(value)) return { problems: [{ field: path, code: "shape" }], seen };

  const problems: ExerciseEntryProblem[] = [];
  if (required && value.length === 0) problems.push({ field: path, code: "empty" });

  value.forEach((muscle: unknown, index) => {
    if (typeof muscle !== "string" || !(MUSCLE_GROUPS as readonly string[]).includes(muscle)) {
      problems.push({ field: `${path}[${index}]`, code: "muscle" });
      return;
    }
    if (seen.has(muscle)) {
      problems.push({ field: `${path}[${index}]`, code: "duplicate" });
      return;
    }
    seen.set(muscle, index);
  });
  return { problems, seen };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * How a stored row points at an exercise — `catalogue:<slug>` for one the app
 * ships, `user:<uuid>` for one the profile added.
 *
 * `FoodRef`'s grammar, one table over and for its reason: the store that writes
 * `fit_routine_items.exercise_ref` and `fit_workout_sets.exercise_ref`, the IPC
 * boundary that receives one from an untrusted renderer, and the interchange
 * reader that re-validates one on import must all agree on what a legal
 * reference IS. Three copies of a regex is three chances to disagree, and the
 * disagreement would show up as a routine that silently points at nothing.
 *
 * Deliberately NOT `FoodRef` itself: a food reference and an exercise reference
 * resolve against different catalogues, and a type that admitted both would let
 * a food id be written into a set.
 */
export type ExerciseRef =
  | { readonly kind: "catalogue"; readonly id: string }
  | { readonly kind: "user"; readonly id: string };

/** Longest reference this grammar admits — a bound on an untrusted string that goes into an indexed column. */
export const MAX_EXERCISE_REF_LENGTH = 80;

/** A user exercise's id is a UUIDv7 as `@nexus/db` mints them; the class is wider than that and still narrow enough to be a token. */
const USER_EXERCISE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The text an `exercise_ref` column holds. The ONE place that spelling is decided. */
export function exerciseRefText(ref: ExerciseRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * Reads a stored or transmitted reference, or null when it is not one. Each
 * half is checked by the rules its own side uses — a `catalogue:` id must be a
 * real catalogue slug — so a reference that could never resolve is refused
 * where it ENTERS rather than where it is read.
 */
export function parseExerciseRef(text: string): ExerciseRef | null {
  if (text.length > MAX_EXERCISE_REF_LENGTH) return null;
  const separator = text.indexOf(":");
  if (separator <= 0) return null;
  const id = text.slice(separator + 1);
  switch (text.slice(0, separator)) {
    case "catalogue":
      return EXERCISE_ID_RE.test(id) ? { kind: "catalogue", id } : null;
    case "user":
      return USER_EXERCISE_ID_RE.test(id) ? { kind: "user", id } : null;
    default:
      return null;
  }
}

/**
 * One ranked list over a pool assembled from BOTH sources — the shipped
 * catalogue and the profile's own exercises — exactly as `searchFoods` is, and
 * for its reason: two lists merged by the caller would be a second definition
 * of „best match".
 *
 * **Both names are searched, and that is the point.** „RDL", „hip thrust" and
 * „good morning" are what the lifting world writes, and a Serb reaching for
 * their exercise types whichever comes to hand first. The Serbian name is what
 * gets DISPLAYED; the English one only has to be findable.
 *
 * Prefix beats substring, Serbian name beats English, then sr-Latn
 * alphabetical, then `id` so the order is TOTAL. A blank query answers nothing
 * rather than everything.
 */
export function searchExercises<T extends { readonly id: string; readonly name: string; readonly nameEn: string }>(
  entries: readonly T[],
  query: string,
  limit: number,
): readonly T[] {
  const needle = foldSearchText(query.trim());
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (needle.length === 0 || cap === 0) return [];

  const hits: { entry: T; rank: number }[] = [];
  for (const entry of entries) {
    const rank = exerciseMatchRank(entry.name, entry.nameEn, needle);
    if (rank !== null) hits.push({ entry, rank });
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      EXERCISE_COLLATOR.compare(a.entry.name, b.entry.name) ||
      a.entry.id.localeCompare(b.entry.id),
  );
  return hits.slice(0, cap).map((hit) => hit.entry);
}

/**
 * What one muscle group is trained BY, split the way the catalogue itself
 * splits it.
 *
 * The two lists are never merged. „Šta pogađa grudi" has two honest answers —
 * the movements chest is the POINT of, and the movements it happens to assist
 * — and a single ranked list would put the close-grip bench press among the
 * chest exercises on the strength of a secondary billing. That is the same
 * distinction `weeklyVolume` already enforces when it counts only primary
 * muscles: a set bills what it was for.
 *
 * Order inside each list is sr-Latn alphabetical, and the input order breaks
 * ties — `Array.prototype.sort` is stable, and two entries with the same name
 * are a catalogue defect rather than something to invent an order for.
 */
export interface MuscleExercises<T> {
  readonly primary: readonly T[];
  readonly secondary: readonly T[];
}

/**
 * Every exercise in `entries` that trains `muscle`, primary and secondary kept
 * apart (`MuscleExercises`).
 *
 * Generic over the entry, exactly as `searchExercises` is, so the shipped
 * catalogue's `ExerciseEntry` and the merged shape a surface builds from the
 * catalogue plus a profile's own rows both go through one function. Neither
 * caller has to know which of them a given row came from — which is the whole
 * point, because a user's own accessory movement belongs in this list beside
 * the shipped ones.
 */
export function exercisesForMuscle<
  T extends {
    readonly name: string;
    readonly primaryMuscles: readonly MuscleGroup[];
    readonly secondaryMuscles: readonly MuscleGroup[];
  },
>(entries: readonly T[], muscle: MuscleGroup): MuscleExercises<T> {
  const primary: T[] = [];
  const secondary: T[] = [];
  for (const entry of entries) {
    // Primary wins outright. `validateExerciseEntry` refuses an entry that
    // lists the same muscle on both sides, so this only matters for a merged
    // pool whose user rows were written before that gate existed.
    if (entry.primaryMuscles.includes(muscle)) primary.push(entry);
    else if (entry.secondaryMuscles.includes(muscle)) secondary.push(entry);
  }
  const byName = (a: T, b: T): number => EXERCISE_COLLATOR.compare(a.name, b.name);
  return { primary: primary.sort(byName), secondary: secondary.sort(byName) };
}

/** Serbian prefix < Serbian substring < English prefix < English substring; `null` for no match at all. */
function exerciseMatchRank(name: string, nameEn: string, needle: string): number | null {
  const sr = foldSearchText(name);
  if (sr.startsWith(needle)) return 0;
  if (sr.includes(needle)) return 1;
  const en = foldSearchText(nameEn);
  if (en.length === 0) return null;
  if (en.startsWith(needle)) return 2;
  if (en.includes(needle)) return 3;
  return null;
}

/** sr-Latn, the app's one collator spelling — plain "sr" mis-tailors š/č/ć/ž. */
const EXERCISE_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);
