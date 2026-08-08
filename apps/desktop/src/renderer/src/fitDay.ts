import { macrosFor, sumMacros } from "@nexus/core";
import type { FitMealItem, FitTargets, FoodMacros } from "../../shared/ipc.js";

/**
 * „Ishrana"'s pure half (FIT slice b): what a day's figures ARE, before anything
 * draws them.
 *
 * **The arithmetic is `@nexus/core`'s, never this file's.** `macrosFor` scales a
 * portion and `sumMacros` adds a list up — the very functions `FitMealStore`
 * totals a day with — so the figure under a list and the rows in it cannot start
 * disagreeing. Nothing here multiplies by `grams / 100` on its own.
 *
 * **Nothing is rounded until it is drawn.** Rounding is a display decision, and
 * a total rounded on the way through would make the day's figure differ from the
 * rows above it by a little, every time. `formatKcal`/`formatGrams` are the one
 * place a number becomes text.
 *
 * **The page draws no figure this module could not derive.** There is no
 * recommended intake here, no projection, no verdict — the goals are whatever
 * the user set and the totals are whatever was logged, and „over the goal" is a
 * fact about those two numbers rather than an opinion about the day.
 */

/** The locale every formatter in this renderer spells (`money.ts`'s own). */
const FIT_LOCALE = "sr-Latn";

/**
 * The four macros the goals cover, in the order every surface lists them:
 * energy first, then the three the energy is made of.
 *
 * `fiber`, `sugar` and `sodiumMg` are deliberately NOT here. `fit_targets` holds
 * four nullable goals and no more (migration 058), so a fifth row would be a bar
 * with nothing to fill against — the three still ride every snapshot and are
 * shown as plain figures where a food is inspected.
 */
export const GOAL_MACROS = ["kcal", "protein", "carbs", "fat"] as const;

export type GoalMacro = (typeof GOAL_MACROS)[number];

/** A goal is either a limit to stay under or a level to reach. See `MacroGoal.sense`. */
export type GoalSense = "ceiling" | "floor";

/**
 * Which way each macro's goal is meant. Only protein is a floor, and it is the
 * whole reason this table exists: „preko cilja" on protein is an achievement,
 * while on the other three it is the thing the goal was set to catch.
 */
const GOAL_SENSE: Readonly<Record<GoalMacro, GoalSense>> = {
  kcal: "ceiling",
  protein: "floor",
  carbs: "ceiling",
  fat: "ceiling",
};

/** Which `FitTargets` field carries each macro's goal — one mapping, so nothing reads `proteinG` twice. */
const GOAL_FIELD: Readonly<Record<GoalMacro, keyof Omit<FitTargets, "updatedAt">>> = {
  kcal: "kcal",
  protein: "proteinG",
  carbs: "carbsG",
  fat: "fatG",
};

/**
 * How one macro's day stands against its goal.
 *
 * The union is the point rather than an optional field: a macro with NO goal
 * carries no ratios at all, because there is no scale to draw one against and a
 * `valueRatio` of 0 beside a real figure would be a fill the page invented. The
 * page draws a track for the second shape and a bare figure for the first, and
 * the type is what stops it doing anything else.
 */
export type MacroGoal =
  | { readonly macro: GoalMacro; readonly value: number; readonly target: null }
  | {
      readonly macro: GoalMacro;
      readonly value: number;
      readonly target: number;
      /** Fill on the row's own scale, 0..1. */
      readonly valueRatio: number;
      /** Where the goal's tick sits on that same scale, 0..1. */
      readonly targetRatio: number;
      /** Past the goal. A FACT about two numbers, and never an error state — see the page. */
      readonly over: boolean;
      /**
       * Which WAY this goal is meant, and therefore what being past it means.
       *
       * A calorie, carbohydrate or fat goal is a **ceiling**: going past it is
       * the thing the user set it to notice. A protein goal is a **floor** —
       * people set one to make sure they reach it — so passing it is the goal
       * being MET, not missed. Without this the page paints „preko cilja" in the
       * danger grammar for all four, which turns eating enough protein into a
       * warning: precisely the scold this module is not allowed to be.
       *
       * A per-goal direction the user picks is the honest refinement (a
       * kidney-restricted diet makes protein a ceiling too), but nobody has
       * asked for one, and shipping the overwhelmingly common reading beats
       * shipping a wrong one while we wait.
       */
      readonly sense: GoalSense;
    };

/**
 * What one logged item actually carried — its snapshot scaled by its own weight.
 * The item's `per100g` is what was recorded at the time, so this answers what was
 * eaten rather than what the food says today.
 */
export function itemMacros(item: FitMealItem): FoodMacros {
  return macrosFor(item.per100g, item.grams);
}

/** A list of items totalled. An empty list totals to zero of everything, which is what such a meal carried. */
export function totalOfItems(items: readonly FitMealItem[]): FoodMacros {
  return sumMacros(items.map((item) => itemMacros(item)));
}

/**
 * The four goal rows for one day.
 *
 * **The scale is `max(value, goal)`, which is the FIN month report's own
 * grammar.** A goal half used fills half the track with its tick at the end; a
 * goal exceeded fills the track and the tick slides back to where the goal sits
 * on the larger scale — so the bar says HOW FAR past rather than clipping at
 * full and hiding it. Nothing else changes: the same track, the same tick, one
 * state more.
 *
 * A goal of ZERO is a goal (migration 058 keeps `0` and `NULL` apart), so it
 * gets a row with a tick at the very start; `null` is „no goal" and gets no
 * ratios at all.
 */
export function macroGoals(totals: FoodMacros, targets: FitTargets): MacroGoal[] {
  return GOAL_MACROS.map((macro) => {
    const value = totals[macro];
    const target = targets[GOAL_FIELD[macro]];
    if (target === null) return { macro, value, target: null };
    const scale = Math.max(value, target);
    return {
      macro,
      value,
      target,
      valueRatio: scale === 0 ? 0 : value / scale,
      targetRatio: scale === 0 ? 0 : target / scale,
      over: value > target,
      sense: GOAL_SENSE[macro],
    };
  });
}

/**
 * A typed amount — grams, a per-100 g figure, a daily goal — or `null` when the
 * text is not one. The ONE path by which a number the user typed becomes a
 * quantity in this module.
 *
 * The grammar is `parseMoneyInput`'s, minus the sign: digits, and at most one
 * separator, either `,` (Serbian) or `.` (what a numeric keypad gives you), both
 * read as the DECIMAL point. Grouping is not accepted at all, which is what
 * makes „1.234" a refusal rather than a guess — it would mean 1234 to one reader
 * and 1,234 to another.
 *
 * At most two decimals, refused rather than rounded: „12,345 g" is not 12,34 and
 * not 12,35, it is something to say again — and two decimals is already finer
 * than any kitchen scale and finer than any label prints.
 *
 * ZERO passes. It is not a legal portion (the store refuses one) but it IS a
 * legal goal, and a parser that refused it would make „cilj: 0 g šećera"
 * unsayable. The caller checks the bound its own field has.
 */
export function parseAmountInput(text: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (match === null) return null;
  const [, whole = "", fraction] = match;
  const value = Number(fraction === undefined ? whole : `${whole}.${fraction}`);
  return Number.isFinite(value) ? value : null;
}

/**
 * A quantity as the field holds it — the decimal comma, no grouping and no unit.
 * Exactly `parseAmountInput`'s input language, so opening a row for editing and
 * saving it back unchanged is a no-op.
 */
export function gramsInputValue(value: number): string {
  return String(value).replace(".", ",");
}

/** One `Intl.NumberFormat` per fraction-digit count, built on first use — a day's screen formats every visible figure on every render. */
const formatters = new Map<number, Intl.NumberFormat>();

function formatterFor(maxFractionDigits: number): Intl.NumberFormat {
  const existing = formatters.get(maxFractionDigits);
  if (existing !== undefined) return existing;
  const created = new Intl.NumberFormat(FIT_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
  formatters.set(maxFractionDigits, created);
  return created;
}

/** Calories, whole. A tenth of a kilocalorie is noise beside a figure in the hundreds. */
export function formatKcal(value: number): string {
  return formatterFor(0).format(value);
}

/** Grams, to at most one decimal — enough for „87,5 g", and a trailing zero is dropped rather than drawn. */
export function formatGrams(value: number): string {
  return formatterFor(1).format(value);
}

/**
 * A FIT day key as a person reads it: „5. avg 2026.".
 *
 * The module was printing `2026-08-05` verbatim in five places across three
 * files — a personal record's date, a measurement row, a weekly-volume row, the
 * body map's „poslednji put" and the workout list — because there was nowhere
 * to put the one line that fixes it. A bare ISO key is a storage format wearing
 * a display's clothes: it is the only date shape in the app a Serbian reader
 * has to decode rather than read.
 *
 * `month: "short"` rather than `"long"`: these dates sit at the end of dense
 * rows beside a figure, where „5. avgust 2026." is the widest thing on the line
 * and the least important. The year stays, because a record from last August
 * and one from this August are different claims.
 *
 * A malformed key comes back verbatim rather than as „Invalid Date" — this
 * reads history, and history should not be able to blank a row.
 */
export function formatFitDay(day: string): string {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : FIT_DAY_FORMAT.format(date);
}

const FIT_DAY_FORMAT = new Intl.DateTimeFormat(FIT_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Whether the day navigation may step FORWARD from `day`.
 *
 * The diary walks back through history and stops at today: a meal is a fact
 * about a day that happened, so tomorrow's lunch is not something to record. The
 * wire refuses a future day too (`FitItemAddRequest`) — this is what keeps the
 * user from reaching that refusal by pressing a button.
 */
export function canStepForward(day: string, today: string): boolean {
  return day < today;
}
