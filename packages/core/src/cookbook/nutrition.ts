/**
 * What one serving of a recipe carries, from the nutrition food table the
 * Fitness log already uses.
 *
 * **The arithmetic is FIT's, not a second copy of it.** An ingredient line that
 * links a food reports grams, and `macrosFor(per100g, grams)` scales the
 * catalogue row while `sumMacros` adds the lines — the two functions the
 * nutrition log itself reads a day's figures through. A cookbook that multiplied
 * by `grams / 100` on its own would be a second answer to „how many calories is
 * 180 g of this", and the two answers would disagree the first time one of them
 * changed.
 *
 * **A line the module cannot weigh is listed, never estimated.** Three things
 * have to be true for a line to count: it has a link, that link resolves, and one
 * unit of it has a known weight. Anything else lands in `uncounted` with the
 * reason, and the caller shows „nije uračunato" beside it. The alternative — a
 * default density, an average, a zero — is a number the user would believe.
 *
 * **No line becomes a mass from a volume.** A tablespoon of oil and a gram of
 * oil are different amounts, the ratio between them is a density, and this
 * module holds no density table (`units.ts` says why). What it does hold is the
 * author's own `gramsPerUnit`: a cook who knows their tablespoon of oil weighs
 * 14 g has stated a fact about their kitchen, and that line counts. A mass unit
 * needs no such help — a kilogram IS a thousand grams.
 *
 * **A range counts at its lower end.** „2–3 čena belog luka" counts two cloves:
 * the lower end is the amount certainly in the pot, the upper end is an amount
 * the author allows and does not assert, and an average would be a number
 * neither of them wrote.
 *
 * Nothing here reads a clock, touches a DOM or imports `node:` anything, and
 * nothing here resolves a `foodRef` itself: the catalogue ships inside the app
 * and the profile's own foods live in `@nexus/db`, so the caller is handed the
 * lookup as a function. A reference to a food this build no longer ships answers
 * null, which is the honest answer rather than a hole to fill with a guess.
 */

import { type FoodMacros, type FoodRef, macrosFor, sumMacros } from "../fitness/food.js";
import type { ScalableIngredient } from "./ingredient.js";
import { convertQuantity } from "./units.js";

/** The least a line must be for this module to weigh it: what it is called, what it points at, and how much one of them weighs. */
export interface NutritionLine extends ScalableIngredient {
  readonly name: string;
  /** The nutrition food-table entry this line measures into, or null. */
  readonly foodRef: FoodRef | null;
  /** What one unit of this line weighs in grams, or null when nobody stated it. */
  readonly gramsPerUnit: number | null;
}

/**
 * Why a line was not counted. Three answers, because they ask the user for three
 * different things: `unlinked` — pick a food; `unknown-food` — the food this
 * pointed at is gone, pick another; `unknown-grams` — say what one unit weighs.
 */
export type UncountedReason = "unlinked" | "unknown-food" | "unknown-grams";

/** One line left out of the total, named the way the recipe names it. */
export interface UncountedIngredient {
  readonly name: string;
  readonly reason: UncountedReason;
}

/** What one serving carries, and what was left out of that answer. */
export interface RecipeNutrition {
  /** Energy and the four macros (plus fibre, sugar and sodium, the same seven fields the log sums) per serving. */
  readonly perServing: FoodMacros;
  /** How many lines contributed — what makes „nothing weighable" tellable from „everything was weighed". */
  readonly countedLines: number;
  /** The lines that did not contribute, in the order the recipe lists them. */
  readonly uncounted: readonly UncountedIngredient[];
}

/**
 * The nutrition of one recipe, per serving.
 *
 * `servings` is what the recipe is FOR, so a recipe for four divided by four is
 * one serving — the caller passes the recipe's own servings and not a desired
 * one, because scaling changes the amounts and not what one portion is.
 *
 * `resolve` answers what 100 g of a linked food carries, or null when the
 * reference does not resolve. It is the caller's because the catalogue is
 * app-shipped JSON and the user's own foods are database rows, and this package
 * is neither.
 */
export function nutritionPerServing(
  lines: readonly NutritionLine[],
  servings: number,
  resolve: (ref: FoodRef) => FoodMacros | null,
): RecipeNutrition {
  if (!Number.isFinite(servings) || servings <= 0) {
    throw new RangeError(`"servings" must be a finite number above 0 (got ${String(servings)}).`);
  }

  const counted: FoodMacros[] = [];
  const uncounted: UncountedIngredient[] = [];

  for (const line of lines) {
    if (line.foodRef === null) {
      uncounted.push({ name: line.name, reason: "unlinked" });
      continue;
    }
    const per100g = resolve(line.foodRef);
    if (per100g === null) {
      uncounted.push({ name: line.name, reason: "unknown-food" });
      continue;
    }
    const grams = gramsOf(line);
    if (grams === null) {
      uncounted.push({ name: line.name, reason: "unknown-grams" });
      continue;
    }
    counted.push(macrosFor(per100g, grams));
  }

  const total = sumMacros(counted);
  return {
    perServing: {
      kcal: total.kcal / servings,
      protein: total.protein / servings,
      carbs: total.carbs / servings,
      fat: total.fat / servings,
      fiber: total.fiber / servings,
      sugar: total.sugar / servings,
      sodiumMg: total.sodiumMg / servings,
    },
    countedLines: counted.length,
    uncounted,
  };
}

/**
 * What one line weighs, or null when that is not knowable from what the line
 * says. The stated `gramsPerUnit` comes first because it is the more specific
 * claim — it is what the author weighed — and a mass unit is the fallback,
 * because a kilogram is a thousand grams by definition.
 */
function gramsOf(line: NutritionLine): number | null {
  if (line.quantity === null || !Number.isFinite(line.quantity) || line.quantity <= 0) return null;
  if (line.gramsPerUnit !== null) {
    if (!Number.isFinite(line.gramsPerUnit) || line.gramsPerUnit <= 0) return null;
    return line.quantity * line.gramsPerUnit;
  }
  // `convertQuantity` answers grams for a mass unit and null for everything
  // else, which is exactly this function's question.
  return convertQuantity(line.quantity, line.unit, "g");
}
