/**
 * The FITNESS module through the assistant's eyes: what was eaten and what is
 * left of the day's goals, what was trained and what the body weighs, and the
 * writes someone asks for by voice: a meal, a set, a session, a measurement, the
 * goals.
 *
 * **Every write goes through the functions the IPC handlers call.** A logged
 * food's macros come from `resolveLoggedFood` and a logged set's metric and
 * muscles from `resolveLoggedExercise` (`main/fitness/refs.ts`, the module's
 * security boundary). The model names a food or an exercise and says how much;
 * it never supplies a number the row is stamped with.
 *
 * **A name is resolved, never guessed.** A food, an exercise or a routine is
 * matched by name, folded and case-insensitively, against the profile's own pool.
 * An exact name wins. Otherwise a single ranked hit wins, and several are refused
 * with the candidates listed, so the model can ask which one was meant.
 *
 * **The metric decides the fields.** A set records what its exercise's metric
 * records, read from `SET_FIELDS` in `@nexus/core` (the table the page draws). A
 * weight on a timed exercise is refused, not stored.
 *
 * **The page cannot reveal a row.** Fitness is a compiled-in page that takes no
 * `item`, so every write names the module alone.
 */

import {
  FitExerciseStore,
  FitFoodStore,
  FitMealStore,
  FitMeasurementStore,
  FitRoutineStore,
  FitTargetStore,
  FitWorkoutStore,
  MAX_FIT_TARGET,
  MAX_MEAL_ITEM_GRAMS,
} from "@nexus/db";
import type { FitMeasurement, FitWorkout, FitWorkoutSet, MealSlot } from "@nexus/db";
import {
  MAX_CIRCUMFERENCE_CM,
  MAX_WEIGHT_KG,
  NO_CIRCUMFERENCES,
  SET_FIELDS,
  foldSearchText,
  macrosFor,
  searchExercises,
  searchFoods,
  type AssistantLocale,
  type ExerciseMetric,
  type SetField,
  type Tool,
} from "@nexus/core";
import {
  exerciseCandidates,
  foodCandidates,
  resolveLoggedExercise,
  resolveLoggedFood,
} from "../../fitness/refs.js";
import {
  asArgs,
  asEnum,
  asNumber,
  asOptionalCount,
  asOptionalDay,
  asOptionalNumber,
  asOptionalText,
  asText,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatDayInSentence,
  formatNumber,
  guard,
  localDay,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface FitnessToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** Main's wall clock: the "today" a day the model did not name falls back to, and the stamp a write carries. */
  readonly now: () => number;
}

interface Words {
  readonly sr: string;
  readonly en: string;
}

const MAX_NAME_LENGTH = 80;
/** The shortest portion the diary records: a sprinkle of salt is not logged in grams. A policy floor, not a measurement. */
const MIN_GRAMS = 1;
/** Caps the ranked hits a name is matched against, and the candidates a refusal lists. */
const NAME_HITS = 10;
const NAME_CANDIDATES_LISTED = 6;
const MAX_REPS = 9999;
const MAX_SECONDS = 86_400;
const MAX_DISTANCE_M = 1_000_000;
const DEFAULT_TRAINING_DAYS = 14;
const MAX_TRAINING_DAYS = 90;
const DEFAULT_MEASUREMENT_DAYS = 30;
const MAX_MEASUREMENT_DAYS = 366;
/** How many rows a read answers with before it says how many more there are. */
const MAX_SESSIONS_LISTED = 10;
const MAX_READINGS_LISTED = 30;

/** The five slots as the model names them, each with the stored value the meal store keeps it under. */
const SLOT_KEYS = ["breakfast", "morning-snack", "lunch", "afternoon-snack", "dinner"] as const;
type SlotKey = (typeof SLOT_KEYS)[number];
const SLOT_VALUE: Readonly<Record<SlotKey, MealSlot>> = {
  breakfast: "dorucak",
  "morning-snack": "uzina1",
  lunch: "rucak",
  "afternoon-snack": "uzina2",
  dinner: "vecera",
};
const SLOT_WORDS: Readonly<Record<SlotKey, Words>> = {
  breakfast: { sr: "doručak", en: "breakfast" },
  "morning-snack": { sr: "prepodnevna užina", en: "mid-morning snack" },
  lunch: { sr: "ručak", en: "lunch" },
  "afternoon-snack": { sr: "popodnevna užina", en: "afternoon snack" },
  dinner: { sr: "večera", en: "dinner" },
};

/**
 * The four goals: the argument name a goal is written under, the macro it
 * measures, its unit and its name. Read by the day's totals, by the goals write
 * and by its confirmation, so the four cannot disagree about what a goal is.
 */
const GOALS = [
  { goal: "kcal", total: "kcal", unit: "kcal", word: { sr: "kalorije", en: "calories" } },
  { goal: "proteinG", total: "protein", unit: "g", word: { sr: "proteini", en: "protein" } },
  { goal: "carbsG", total: "carbs", unit: "g", word: { sr: "ugljeni hidrati", en: "carbs" } },
  { goal: "fatG", total: "fat", unit: "g", word: { sr: "masti", en: "fat" } },
] as const;

/** A circumference the assistant records: the three the tool names, keyed as the store keys them. */
const SITES = ["waist", "chest", "hip"] as const;
type Site = (typeof SITES)[number];
const SITE_WORDS: Readonly<Record<Site, Words>> = {
  waist: { sr: "struk", en: "waist" },
  chest: { sr: "grudi", en: "chest" },
  hip: { sr: "kukovi", en: "hips" },
};

/** The four numbers a set may carry, as the arguments name them. `assist` writes into `weight`. */
const SET_ARGS = ["weight", "reps", "seconds", "distance"] as const;
type SetArg = (typeof SET_ARGS)[number];
const ARG_WORDS: Readonly<Record<SetArg, Words>> = {
  weight: { sr: "težinu", en: "weight" },
  reps: { sr: "ponavljanja", en: "reps" },
  seconds: { sr: "vreme", en: "time" },
  distance: { sr: "distancu", en: "distance" },
};
const ASSIST_WORD: Words = { sr: "pomoć", en: "assist" };
const NO_ROUTINE: Words = { sr: "bez rutine", en: "no routine" };
const IN_PROGRESS: Words = { sr: "u toku", en: "in progress" };
const NOUNS: Readonly<Record<"food" | "exercise" | "routine", Words>> = {
  food: { sr: "namirnice", en: "food" },
  exercise: { sr: "vežbe", en: "exercise" },
  routine: { sr: "rutine", en: "routine" },
};
const DAY_ONE: Words = { sr: "dan", en: "day" };
const DAY_MANY: Words = { sr: "dana", en: "days" };

const NO_MATCH: AssistantPhrase<[noun: string, name: string]> = {
  sr: (noun, name) => `Nema ${noun} „${name}“.`,
  en: (noun, name) => `No ${noun} called “${name}”.`,
};
const SEVERAL_MATCH: AssistantPhrase<[name: string, names: string]> = {
  sr: (name, names) => `„${name}“ može da bude više stavki: ${names}. Reci koja.`,
  en: (name, names) => `“${name}” could be more than one entry: ${names}. Say which one.`,
};
const MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};
const DAY_HEADING: AssistantPhrase<[day: string]> = {
  sr: (day) => `Ishrana, ${day}:`,
  en: (day) => `Food, ${day}:`,
};
const NOTHING_LOGGED: Words = { sr: "Ništa nije upisano za taj dan.", en: "Nothing is logged for that day." };
const TOTALS: AssistantPhrase<[parts: string]> = {
  sr: (parts) => `Ukupno: ${parts}.`,
  en: (parts) => `Total: ${parts}.`,
};
const SESSIONS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Treninzi (${count}):`,
  en: (count) => `Workouts (${count}):`,
};
const NO_SESSIONS: AssistantPhrase<[days: string]> = {
  sr: (days) => `Nema treninga u poslednjih ${days}.`,
  en: (days) => `No workouts in the last ${days}.`,
};
const ROUTINES_LINE: AssistantPhrase<[names: string]> = {
  sr: (names) => `Rutine: ${names}.`,
  en: (names) => `Routines: ${names}.`,
};
const MEASUREMENTS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Merenja (${count}):`,
  en: (count) => `Measurements (${count}):`,
};
const NO_MEASUREMENTS: AssistantPhrase<[days: string]> = {
  sr: (days) => `Nema merenja u poslednjih ${days}.`,
  en: (days) => `No measurements in the last ${days}.`,
};
const MEAL_SUMMARY: AssistantPhrase<[day: string, slot: string, grams: string, food: string]> = {
  sr: (day, slot, grams, food) => `Upiši za ${day}, ${slot}: ${grams} g „${food}“.`,
  en: (day, slot, grams, food) => `Log for ${day}, ${slot}: ${grams} g “${food}”.`,
};
const MEAL_LOGGED: AssistantPhrase<[day: string, slot: string, grams: string, food: string]> = {
  sr: (day, slot, grams, food) => `Upisano: ${grams} g „${food}“, ${slot} (${day}).`,
  en: (day, slot, grams, food) => `Logged: ${grams} g “${food}”, ${slot} (${day}).`,
};
const START_SUMMARY: AssistantPhrase<[day: string, routine: string]> = {
  sr: (day, routine) => `Pokreni trening${routine} za ${day}.`,
  en: (day, routine) => `Start a workout${routine} for ${day}.`,
};
const ROUTINE_PART: AssistantPhrase<[name: string]> = {
  sr: (name) => ` po rutini „${name}“`,
  en: (name) => ` from routine “${name}”`,
};
const STARTED: AssistantPhrase<[day: string]> = {
  sr: (day) => `Trening pokrenut za ${day}.`,
  en: (day) => `Workout started for ${day}.`,
};
const FINISH_SUMMARY: AssistantPhrase<[day: string]> = {
  sr: (day) => `Završi trening od ${day}.`,
  en: (day) => `Finish the workout from ${day}.`,
};
const FINISHED: Words = { sr: "Trening završen.", en: "Workout finished." };
const ALREADY_OPEN: Words = {
  sr: "Trening je već u toku; prvo ga završi.",
  en: "A workout is already in progress; finish it first.",
};
const NONE_OPEN: Words = { sr: "Nema treninga u toku.", en: "No workout is in progress." };
const ROUTINE_ON_START: Words = {
  sr: "Rutina se bira samo pri pokretanju treninga.",
  en: "A routine is only chosen when a workout starts.",
};
const SET_SUMMARY: AssistantPhrase<[exercise: string, values: string]> = {
  sr: (exercise, values) => `Zapiši „${exercise}“: ${values}.`,
  en: (exercise, values) => `Log “${exercise}”: ${values}.`,
};
const SET_START_TAIL: AssistantPhrase<[day: string]> = {
  sr: (day) => ` Pokreće se trening za ${day}.`,
  en: (day) => ` A workout for ${day} starts with it.`,
};
const SET_LOGGED: AssistantPhrase<[exercise: string, values: string]> = {
  sr: (exercise, values) => `Zapisano: „${exercise}“, ${values}.`,
  en: (exercise, values) => `Logged: “${exercise}”, ${values}.`,
};
const FIELD_NEEDED: AssistantPhrase<[field: string, exercise: string]> = {
  sr: (field, exercise) => `„${exercise}“ traži: ${field}.`,
  en: (field, exercise) => `“${exercise}” needs: ${field}.`,
};
const FIELD_UNUSED: AssistantPhrase<[field: string, exercise: string]> = {
  sr: (field, exercise) => `„${exercise}“ ne beleži: ${field}.`,
  en: (field, exercise) => `“${exercise}” does not record: ${field}.`,
};
const MEASURE_SUMMARY: AssistantPhrase<[day: string, parts: string]> = {
  sr: (day, parts) => `Upiši merenje za ${day}: ${parts}.`,
  en: (day, parts) => `Record the measurement for ${day}: ${parts}.`,
};
const MEASURE_LOGGED: AssistantPhrase<[day: string]> = {
  sr: (day) => `Merenje za ${day} upisano.`,
  en: (day) => `Measurement for ${day} recorded.`,
};
const MEASURE_NEEDS_WEIGHT: AssistantPhrase<[day: string]> = {
  sr: (day) => `Za ${day} još nema težine; navedi je.`,
  en: (day) => `There is no weight for ${day} yet; give one.`,
};
const NOTHING_TO_RECORD: Words = {
  sr: "Nema šta da se upiše: navedi težinu ili obim.",
  en: "Nothing to record: give a weight or a girth.",
};
const GOALS_SUMMARY: AssistantPhrase<[parts: string]> = {
  sr: (parts) => `Postavi ciljeve: ${parts}.`,
  en: (parts) => `Set the goals: ${parts}.`,
};
const GOALS_SET: AssistantPhrase<[parts: string]> = {
  sr: (parts) => `Ciljevi postavljeni: ${parts}.`,
  en: (parts) => `Goals set: ${parts}.`,
};
const GOALS_SAME: Words = { sr: "Ciljevi su već takvi.", en: "The goals already read that way." };
const GOALS_NOTHING: Words = {
  sr: "Nema šta da se postavi: navedi bar jedan cilj.",
  en: "Nothing to set: give at least one goal.",
};

export function fitnessTools(deps: FitnessToolDeps): readonly Tool[] {
  const stamp = (): string => new Date(deps.now()).toISOString();

  const day: Tool = {
    name: "fitness.day",
    description: {
      sr: "Pokazuje šta je korisnik jeo za dan, po obrocima, i zbir u odnosu na ciljeve. Koristi ga kada pita šta je jeo danas ili koliko kalorija mu je ostalo.",
      en: "Shows what the user ate on a day, by meal, and the day's totals against the goals. Use it when they ask what they ate today or how many calories they have left.",
    },
    parameters: {
      type: "object",
      properties: {
        day: { type: "string", format: "date", description: "The day, YYYY-MM-DD. Left out, today." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const today = localDay(deps.now());
        const wanted = pastDay(args.day, today);
        const locale = context.locale;
        const read = deps.profileDb(context.profileId, (db, id) => ({
          meals: new FitMealStore(db, id).listDay(wanted),
          totals: new FitMealStore(db, id).dayTotals(wanted),
          targets: new FitTargetStore(db, id).get(),
        }));

        const slots = SLOT_KEYS.flatMap((key) => {
          const items = read.meals[SLOT_VALUE[key]];
          if (items.length === 0) return [];
          const listed = items.map(
            (item) =>
              `${item.label} ${formatNumber(locale, item.grams)} g (${formatNumber(locale, macrosFor(item.per100g, item.grams).kcal)} kcal)`,
          );
          return [`- ${text(locale, SLOT_WORDS[key])}: ${listed.join("; ")}`];
        });
        const totals = GOALS.map((macro) => {
          const total = formatNumber(locale, read.totals[macro.total]);
          const goal = read.targets[macro.goal];
          const shown = goal === null ? total : `${total} / ${formatNumber(locale, goal)}`;
          return `${text(locale, macro.word)} ${shown} ${macro.unit}`;
        });
        return okResult(
          [
            phrase(locale, DAY_HEADING, formatDayInSentence(locale, wanted)),
            ...(slots.length === 0 ? [text(locale, NOTHING_LOGGED)] : slots),
            phrase(locale, TOTALS, totals.join(", ")),
          ].join("\n"),
        );
      }),
  };

  const meal: Tool = {
    name: "fitness.meal",
    description: {
      sr: "Upisuje namirnicu u obrok za dan, u gramima. Koristi ga kada korisnik kaže šta je pojeo ili popio i koliko (npr. „banana za doručak“).",
      en: "Logs a food to a meal of a day, in grams. Use it when the user says what they ate or drank and how much (for example \"a banana for breakfast\").",
    },
    parameters: {
      type: "object",
      properties: {
        food: { type: "string", minLength: 1, maxLength: MAX_NAME_LENGTH, description: "The food, by the name the user gave it." },
        slot: { type: "string", enum: [...SLOT_KEYS], description: "The meal it belongs to." },
        grams: { type: "number", minimum: MIN_GRAMS, maximum: MAX_MEAL_ITEM_GRAMS, description: "How much was eaten, in grams." },
        day: { type: "string", format: "date", description: "The day it was eaten, YYYY-MM-DD. Left out, today." },
      },
      required: ["food", "slot", "grams"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const locale = context.locale;
        const food = asText(args.food, "food", MAX_NAME_LENGTH);
        const slot = asEnum(args.slot, "slot", SLOT_KEYS);
        const grams = asNumber(args.grams, "grams", MIN_GRAMS, MAX_MEAL_ITEM_GRAMS);
        const wanted = pastDay(args.day, localDay(deps.now()));
        const match = deps.profileDb(context.profileId, (db, id) =>
          pickByName(
            locale,
            foodCandidates(new FitFoodStore(db, id)),
            (entries, query) => searchFoods(entries, query, NAME_HITS),
            food,
            NOUNS.food,
          ),
        );

        const declined = await confirmOrDecline(
          context,
          "fitness.meal",
          "write",
          phrase(
            locale,
            MEAL_SUMMARY,
            formatDayInSentence(locale, wanted),
            text(locale, SLOT_WORDS[slot]),
            formatNumber(locale, grams),
            match.name,
          ),
        );
        if (declined !== null) return declined;

        const logged = deps.profileDb(context.profileId, (db, id) =>
          new FitMealStore(db, id).addItem(
            {
              date: wanted,
              slot: SLOT_VALUE[slot],
              grams,
              ...resolveLoggedFood(new FitFoodStore(db, id), match.id),
            },
            stamp(),
          ),
        );
        return okResult(
          phrase(
            locale,
            MEAL_LOGGED,
            formatDayInSentence(locale, wanted),
            text(locale, SLOT_WORDS[slot]),
            formatNumber(locale, grams),
            logged.label,
          ),
          { navigateTo: { module: "fitness" } },
        );
      }),
  };

  const training: Tool = {
    name: "fitness.training",
    description: {
      sr: "Izlistava poslednje treninge sa serijama i nazivima rutina, uz trening koji je u toku. Koristi ga kada korisnik pita šta je radio, šta je dizao ili koje rutine ima.",
      en: "Lists recent workouts with their sets and the routine names, and the workout in progress. Use it when the user asks what they trained, what they lifted or which routines they have.",
    },
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 1,
          maximum: MAX_TRAINING_DAYS,
          description: `How many days back to look, today included. Defaults to ${String(DEFAULT_TRAINING_DAYS)}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const locale = context.locale;
        const days = asOptionalCount(args.days, "days", 1, MAX_TRAINING_DAYS) ?? DEFAULT_TRAINING_DAYS;
        const today = localDay(deps.now());
        const read = deps.profileDb(context.profileId, (db, id) => ({
          sessions: new FitWorkoutStore(db, id).listRange(daysBefore(today, days - 1), today),
          routines: new FitRoutineStore(db, id).list(),
        }));
        if (read.sessions.length === 0) {
          return okResult(phrase(locale, NO_SESSIONS, daysText(locale, days)));
        }

        const lines = [...read.sessions]
          .reverse()
          .map((session) => sessionLine(locale, session));
        const out = [phrase(locale, SESSIONS_HEADING, read.sessions.length), ...lines.slice(0, MAX_SESSIONS_LISTED)];
        if (lines.length > MAX_SESSIONS_LISTED) {
          out.push(phrase(locale, MORE, lines.length - MAX_SESSIONS_LISTED));
        }
        if (read.routines.length > 0) {
          out.push(phrase(locale, ROUTINES_LINE, read.routines.map((routine) => routine.name).join(", ")));
        }
        return okResult(out.join("\n"));
      }),
  };

  const workout: Tool = {
    name: "fitness.workout",
    description: {
      sr: "Pokreće trening (opciono po rutini) ili završava onaj koji je u toku. Koristi ga kada korisnik kaže da kreće na trening ili da ga je završio.",
      en: "Starts a workout, optionally from a routine, or finishes the one in progress. Use it when the user says they are starting training or have finished.",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "finish"], description: "Start a workout or finish the one in progress." },
        routine: { type: "string", minLength: 1, maxLength: MAX_NAME_LENGTH, description: "A routine to start from, by its name. Only with start." },
        day: { type: "string", format: "date", description: "The day of the workout, YYYY-MM-DD. Left out, today." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const locale = context.locale;
        const action = asEnum(args.action, "action", ["start", "finish"] as const);
        const routineName = asOptionalText(args.routine, "routine", MAX_NAME_LENGTH);
        const wanted = pastDay(args.day, localDay(deps.now()));
        if (action === "finish" && routineName !== undefined) {
          throw new Error(text(locale, ROUTINE_ON_START));
        }
        const open = deps.profileDb(context.profileId, (db, id) => new FitWorkoutStore(db, id).open());

        if (action === "finish") {
          if (open === null) throw new Error(text(locale, NONE_OPEN));
          const declined = await confirmOrDecline(
            context,
            "fitness.workout",
            "write",
            phrase(locale, FINISH_SUMMARY, formatDayInSentence(locale, open.day)),
          );
          if (declined !== null) return declined;
          deps.profileDb(context.profileId, (db, id) => new FitWorkoutStore(db, id).finish(open.id, stamp()));
          return okResult(text(locale, FINISHED), { navigateTo: { module: "fitness" } });
        }

        if (open !== null) throw new Error(text(locale, ALREADY_OPEN));
        const routine =
          routineName === undefined
            ? undefined
            : deps.profileDb(context.profileId, (db, id) =>
                pickByName(
                  locale,
                  new FitRoutineStore(db, id).list(),
                  (entries, query) => entries.filter((entry) => foldSearchText(entry.name).includes(foldSearchText(query))),
                  routineName,
                  NOUNS.routine,
                ),
              );
        const declined = await confirmOrDecline(
          context,
          "fitness.workout",
          "write",
          phrase(
            locale,
            START_SUMMARY,
            formatDayInSentence(locale, wanted),
            routine === undefined ? "" : phrase(locale, ROUTINE_PART, routine.name),
          ),
        );
        if (declined !== null) return declined;
        deps.profileDb(context.profileId, (db, id) =>
          new FitWorkoutStore(db, id).start(
            {
              day: wanted,
              ...(routine === undefined ? {} : { routineRef: routine.id, routineLabel: routine.name }),
            },
            stamp(),
          ),
        );
        return okResult(phrase(locale, STARTED, formatDayInSentence(locale, wanted)), {
          navigateTo: { module: "fitness" },
        });
      }),
  };

  const set: Tool = {
    name: "fitness.set",
    description: {
      sr: "Zapisuje jednu seriju vežbe sa brojevima koje ta vežba beleži: težinom, ponavljanjima, vremenom ili distancom. Ako trening nije u toku, pokreće ga. Koristi ga kada korisnik kaže šta je uradio u seriji.",
      en: "Logs one set of an exercise with the numbers that exercise records: weight, reps, time or distance. Starts a workout if none is in progress. Use it when the user says what they did in a set.",
    },
    parameters: {
      type: "object",
      properties: {
        exercise: { type: "string", minLength: 1, maxLength: MAX_NAME_LENGTH, description: "The exercise, by the name the user gave it." },
        weight: { type: "number", minimum: 0, maximum: MAX_WEIGHT_KG, description: "Kilograms on the bar (or the assistance on an assisted exercise)." },
        reps: { type: "integer", minimum: 0, maximum: MAX_REPS, description: "Repetitions done." },
        seconds: { type: "number", minimum: 0, maximum: MAX_SECONDS, description: "Time in seconds." },
        distance: { type: "number", minimum: 0, maximum: MAX_DISTANCE_M, description: "Distance in metres." },
        day: { type: "string", format: "date", description: "The day, used only when this set starts a workout. Left out, today." },
      },
      required: ["exercise"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const locale = context.locale;
        const exerciseName = asText(args.exercise, "exercise", MAX_NAME_LENGTH);
        const given: Readonly<Record<SetArg, number | undefined>> = {
          weight: asOptionalNumber(args.weight, "weight", 0, MAX_WEIGHT_KG),
          reps: asOptionalCount(args.reps, "reps", 0, MAX_REPS),
          seconds: asOptionalNumber(args.seconds, "seconds", 0, MAX_SECONDS),
          distance: asOptionalNumber(args.distance, "distance", 0, MAX_DISTANCE_M),
        };
        const wanted = pastDay(args.day, localDay(deps.now()));
        const exercise = deps.profileDb(context.profileId, (db, id) => {
          const exercises = new FitExerciseStore(db, id);
          const match = pickByName(
            locale,
            exerciseCandidates(exercises),
            (entries, query) => searchExercises(entries, query, NAME_HITS),
            exerciseName,
            NOUNS.exercise,
          );
          return resolveLoggedExercise(exercises, match.id);
        });

        // The metric decides the fields: each one it records must be given, and
        // no other may be. A weight on a timed exercise is refused here, not stored.
        const recorded = new Set(SET_FIELDS[exercise.metric].map(argOf));
        for (const arg of SET_ARGS) {
          if (recorded.has(arg) && given[arg] === undefined) {
            throw new Error(phrase(locale, FIELD_NEEDED, text(locale, ARG_WORDS[arg]), exercise.label));
          }
          if (!recorded.has(arg) && given[arg] !== undefined) {
            throw new Error(phrase(locale, FIELD_UNUSED, text(locale, ARG_WORDS[arg]), exercise.label));
          }
        }

        const values = setText(locale, exercise.metric, (field) => given[argOf(field)] ?? null);
        const starting = deps.profileDb(context.profileId, (db, id) => new FitWorkoutStore(db, id).open() === null);
        const declined = await confirmOrDecline(
          context,
          "fitness.set",
          "write",
          phrase(locale, SET_SUMMARY, exercise.label, values) +
            (starting ? phrase(locale, SET_START_TAIL, formatDayInSentence(locale, wanted)) : ""),
        );
        if (declined !== null) return declined;

        deps.profileDb(context.profileId, (db, id) => {
          const workouts = new FitWorkoutStore(db, id);
          const workoutId = (workouts.open() ?? workouts.start({ day: wanted }, stamp())).id;
          workouts.logSet(
            workoutId,
            {
              exerciseRef: exercise.exerciseRef,
              label: exercise.label,
              metric: exercise.metric,
              primaryMuscles: exercise.primaryMuscles,
              kind: "working",
              weightKg: given.weight ?? null,
              reps: given.reps ?? null,
              seconds: given.seconds ?? null,
              distanceM: given.distance ?? null,
            },
            stamp(),
          );
        });
        return okResult(phrase(locale, SET_LOGGED, exercise.label, values), {
          navigateTo: { module: "fitness" },
        });
      }),
  };

  const measure: Tool = {
    name: "fitness.measure",
    description: {
      sr: "Upisuje telesno merenje za dan: težinu i obim struka, grudi ili kukova. Ostala polja tog dana ostaju. Koristi ga kada korisnik kaže koliko je težak ili šta je izmerio.",
      en: "Records a body measurement for a day: weight and the waist, chest or hip girth. Other fields of that day are kept. Use it when the user says what they weigh or measured a girth.",
    },
    parameters: {
      type: "object",
      properties: {
        day: { type: "string", format: "date", description: "The day, YYYY-MM-DD. Left out, today." },
        weightKg: { type: "number", minimum: 1, maximum: MAX_WEIGHT_KG, description: "Body weight in kilograms." },
        waistCm: { type: "number", minimum: 1, maximum: MAX_CIRCUMFERENCE_CM, description: "Waist in centimetres." },
        chestCm: { type: "number", minimum: 1, maximum: MAX_CIRCUMFERENCE_CM, description: "Chest in centimetres." },
        hipsCm: { type: "number", minimum: 1, maximum: MAX_CIRCUMFERENCE_CM, description: "Hips in centimetres." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const locale = context.locale;
        const changes = {
          weightKg: asOptionalNumber(args.weightKg, "weightKg", 1, MAX_WEIGHT_KG),
          waist: asOptionalNumber(args.waistCm, "waistCm", 1, MAX_CIRCUMFERENCE_CM),
          chest: asOptionalNumber(args.chestCm, "chestCm", 1, MAX_CIRCUMFERENCE_CM),
          hip: asOptionalNumber(args.hipsCm, "hipsCm", 1, MAX_CIRCUMFERENCE_CM),
        };
        if (Object.values(changes).every((value) => value === undefined)) {
          throw new Error(text(locale, NOTHING_TO_RECORD));
        }
        const wanted = pastDay(args.day, localDay(deps.now()));
        const existing = deps.profileDb(context.profileId, (db, id) => new FitMeasurementStore(db, id).get(wanted));
        const weightKg = changes.weightKg ?? existing?.weightKg;
        if (weightKg === undefined) throw new Error(phrase(locale, MEASURE_NEEDS_WEIGHT, formatDayInSentence(locale, wanted)));

        const declined = await confirmOrDecline(
          context,
          "fitness.measure",
          "write",
          phrase(
            locale,
            MEASURE_SUMMARY,
            formatDayInSentence(locale, wanted),
            measureParts(locale, changes).join(", "),
          ),
        );
        if (declined !== null) return declined;

        const base = existing?.circumferences ?? NO_CIRCUMFERENCES;
        deps.profileDb(context.profileId, (db, id) =>
          new FitMeasurementStore(db, id).save(
            {
              day: wanted,
              weightKg,
              bodyFatPercent: existing?.bodyFatPercent ?? null,
              muscle: existing?.muscle ?? null,
              waterPercent: existing?.waterPercent ?? null,
              circumferences: {
                ...base,
                waist: changes.waist ?? base.waist,
                chest: changes.chest ?? base.chest,
                hip: changes.hip ?? base.hip,
              },
            },
            stamp(),
          ),
        );
        return okResult(phrase(locale, MEASURE_LOGGED, formatDayInSentence(locale, wanted)), {
          navigateTo: { module: "fitness" },
        });
      }),
  };

  const goals: Tool = {
    name: "fitness.goals",
    description: {
      sr: "Postavlja dnevne ciljeve za kalorije, proteine, ugljene hidrate i masti. Menja samo navedene. Koristi ga kada korisnik kaže koliko želi da jede dnevno.",
      en: "Sets the daily goals for calories, protein, carbs and fat. Only the given ones change. Use it when the user says how much they want to eat each day.",
    },
    parameters: {
      type: "object",
      properties: {
        kcal: { type: "integer", minimum: 0, maximum: MAX_FIT_TARGET, description: "Calories per day." },
        proteinG: { type: "integer", minimum: 0, maximum: MAX_FIT_TARGET, description: "Protein per day, in grams." },
        carbsG: { type: "integer", minimum: 0, maximum: MAX_FIT_TARGET, description: "Carbohydrates per day, in grams." },
        fatG: { type: "integer", minimum: 0, maximum: MAX_FIT_TARGET, description: "Fat per day, in grams." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const locale = context.locale;
        const requested = {
          kcal: asOptionalCount(args.kcal, "kcal", 0, MAX_FIT_TARGET),
          proteinG: asOptionalCount(args.proteinG, "proteinG", 0, MAX_FIT_TARGET),
          carbsG: asOptionalCount(args.carbsG, "carbsG", 0, MAX_FIT_TARGET),
          fatG: asOptionalCount(args.fatG, "fatG", 0, MAX_FIT_TARGET),
        };
        if (Object.values(requested).every((value) => value === undefined)) {
          throw new Error(text(locale, GOALS_NOTHING));
        }
        const current = deps.profileDb(context.profileId, (db, id) => new FitTargetStore(db, id).get());
        // A goal the caller repeats with its current value is not a change, and
        // the summary names only the changes.
        const changed = GOALS.filter(
          (macro) => requested[macro.goal] !== undefined && requested[macro.goal] !== current[macro.goal],
        );
        if (changed.length === 0) return okResult(text(locale, GOALS_SAME));
        const parts = changed.map(
          (macro) => `${text(locale, macro.word)} ${formatNumber(locale, requested[macro.goal] ?? 0)} ${macro.unit}`,
        );

        const declined = await confirmOrDecline(
          context,
          "fitness.goals",
          "write",
          phrase(locale, GOALS_SUMMARY, parts.join(", ")),
        );
        if (declined !== null) return declined;
        deps.profileDb(context.profileId, (db, id) =>
          new FitTargetStore(db, id).save(
            {
              kcal: requested.kcal ?? current.kcal,
              proteinG: requested.proteinG ?? current.proteinG,
              carbsG: requested.carbsG ?? current.carbsG,
              fatG: requested.fatG ?? current.fatG,
            },
            stamp(),
          ),
        );
        return okResult(phrase(locale, GOALS_SET, parts.join(", ")), {
          navigateTo: { module: "fitness" },
        });
      }),
  };

  const measurements: Tool = {
    name: "fitness.measurements",
    description: {
      sr: "Izlistava telesna merenja u poslednjih nekoliko dana: težinu i obime. Koristi ga kada korisnik pita kako mu se menja težina ili obim.",
      en: "Lists body measurements over the last few days: weight and girths. Use it when the user asks how their weight or girth has changed.",
    },
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 1,
          maximum: MAX_MEASUREMENT_DAYS,
          description: `How many days back to look, today included. Defaults to ${String(DEFAULT_MEASUREMENT_DAYS)}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const locale = context.locale;
        const days = asOptionalCount(args.days, "days", 1, MAX_MEASUREMENT_DAYS) ?? DEFAULT_MEASUREMENT_DAYS;
        const today = localDay(deps.now());
        const readings = deps.profileDb(context.profileId, (db, id) =>
          new FitMeasurementStore(db, id).listRange(daysBefore(today, days - 1), today),
        );
        if (readings.length === 0) return okResult(phrase(locale, NO_MEASUREMENTS, daysText(locale, days)));

        const lines = [...readings]
          .reverse()
          .map((reading) => `- ${formatDayInSentence(locale, reading.day)}: ${measureParts(locale, readingValues(reading)).join(", ")}`);
        const out = [phrase(locale, MEASUREMENTS_HEADING, readings.length), ...lines.slice(0, MAX_READINGS_LISTED)];
        if (lines.length > MAX_READINGS_LISTED) {
          out.push(phrase(locale, MORE, lines.length - MAX_READINGS_LISTED));
        }
        return okResult(out.join("\n"));
      }),
  };

  return [day, meal, training, workout, set, measure, goals, measurements];
}

/** A day the model named, or today; never a day after today, which has not happened yet. */
function pastDay(value: unknown, today: string): string {
  const day = asOptionalDay(value, "day") ?? today;
  if (day > today) throw new Error(`"day" must not be in the future.`);
  return day;
}

/** The day `count` days before `day`, as `YYYY-MM-DD`. */
function daysBefore(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function daysText(locale: AssistantLocale, count: number): string {
  return `${String(count)} ${text(locale, count === 1 ? DAY_ONE : DAY_MANY)}`;
}

/** Which argument a set field is written under: `assist` is a weight, because it is the same column. */
function argOf(field: SetField): SetArg {
  return field === "assist" ? "weight" : field;
}

/** One field's value as the person reads it: a load, a count, a time or a distance. `null` is not recorded. */
function fieldText(locale: AssistantLocale, field: SetField, value: number | null): string {
  if (value === null) return "—";
  const number = formatNumber(locale, value);
  switch (field) {
    case "weight":
      return `${number} kg`;
    case "assist":
      return `${text(locale, ASSIST_WORD)} ${number} kg`;
    case "reps":
      return number;
    case "seconds":
      return `${number} s`;
    case "distance":
      return `${number} m`;
  }
}

/** A set as its metric draws it: the fields the metric records, in the order a form draws them. */
function setText(
  locale: AssistantLocale,
  metric: ExerciseMetric,
  valueOf: (field: SetField) => number | null,
): string {
  return SET_FIELDS[metric].map((field) => fieldText(locale, field, valueOf(field))).join(" × ");
}

/** A stored set's number for one field. `assist` and `weight` share the kilograms column. */
function setValue(set: FitWorkoutSet, field: SetField): number | null {
  switch (field) {
    case "weight":
    case "assist":
      return set.weightKg;
    case "reps":
      return set.reps;
    case "seconds":
      return set.seconds;
    case "distance":
      return set.distanceM;
  }
}

/** One session on a line: its day, its routine and whether it is still running, then each exercise with its sets. */
function sessionLine(locale: AssistantLocale, session: FitWorkout): string {
  const label = [
    session.routineLabel === "" ? text(locale, NO_ROUTINE) : session.routineLabel,
    session.endedAt === null ? text(locale, IN_PROGRESS) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  const byExercise = new Map<string, { label: string; sets: string[] }>();
  for (const set of session.sets) {
    const group = byExercise.get(set.exerciseRef) ?? { label: set.label, sets: [] };
    group.sets.push(setText(locale, set.metric, (field) => setValue(set, field)));
    byExercise.set(set.exerciseRef, group);
  }
  const exercises = [...byExercise.values()].map((group) => `${group.label} ${group.sets.join(", ")}`);
  return `- ${formatDayInSentence(locale, session.day)} (${label})${exercises.length === 0 ? "" : `: ${exercises.join("; ")}`}`;
}

/** A measurement's values, each one optional: a day records what it records. */
interface MeasureValues {
  readonly weightKg?: number | undefined;
  readonly waist?: number | undefined;
  readonly chest?: number | undefined;
  readonly hip?: number | undefined;
}

/** The parts of a measurement that are present, as the person reads them: the weight, then each girth. */
function measureParts(locale: AssistantLocale, values: MeasureValues): string[] {
  const parts: string[] = [];
  if (values.weightKg !== undefined) parts.push(`${formatNumber(locale, values.weightKg)} kg`);
  for (const site of SITES) {
    const value = values[site];
    if (value !== undefined) parts.push(`${text(locale, SITE_WORDS[site])} ${formatNumber(locale, value)} cm`);
  }
  return parts;
}

/** A stored reading's values in the shape `measureParts` takes: a recorded girth, or nothing. */
function readingValues(reading: FitMeasurement): MeasureValues {
  const { waist, chest, hip } = reading.circumferences;
  return {
    weightKg: reading.weightKg,
    waist: waist ?? undefined,
    chest: chest ?? undefined,
    hip: hip ?? undefined,
  };
}

/**
 * Resolves a name the model said to one candidate of its pool. An exact name
 * (folded, or the English name) wins; otherwise the one ranked hit wins. Nothing
 * or several is a refusal, and the refusal names what there is.
 */
function pickByName<T extends { readonly id: string; readonly name: string; readonly nameEn?: string }>(
  locale: AssistantLocale,
  entries: readonly T[],
  rank: (entries: readonly T[], query: string) => readonly T[],
  query: string,
  noun: Words,
): T {
  const folded = foldSearchText(query);
  const hits = rank(entries, query);
  const exact = hits.filter(
    (hit) => foldSearchText(hit.name) === folded || (hit.nameEn !== undefined && foldSearchText(hit.nameEn) === folded),
  );
  const pool = exact.length > 0 ? exact : hits;
  const [first, ...rest] = pool;
  if (first === undefined) throw new Error(phrase(locale, NO_MATCH, text(locale, noun), query));
  if (rest.length > 0) {
    const names = pool.slice(0, NAME_CANDIDATES_LISTED).map((candidate) => candidate.name);
    throw new Error(phrase(locale, SEVERAL_MATCH, query, names.join(", ")));
  }
  return first;
}
