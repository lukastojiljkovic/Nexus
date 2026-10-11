/**
 * What one ingredient line IS, and the one piece of arithmetic a cookbook does
 * to it: cooking a recipe for a different number of people.
 *
 * **Scaling is rounding, and the rounding rules are the module's opinion.** A
 * recipe for four scaled to six multiplies 200 g by 1.5 and lands on a number
 * nobody can weigh; the point of scaling is to produce a number a KITCHEN can
 * act on, so every scaled quantity is rounded by the rule of its own unit:
 *
 * - grams and millilitres — to whole numbers below 100, to 5 at or above;
 * - kilograms and litres — to 0.01 below 1, to 0.05 at or above;
 * - teaspoons, tablespoons and fluid ounces — to the nearest 1/4;
 * - cups — to the nearest 1/8;
 * - a count — pinch, clove, piece, … and a line with no unit at all — to the
 *   nearest 1/2, because half a clove of garlic is a thing a person does and
 *   1/4 of one is not.
 *
 * A positive amount never rounds down to zero: 0.1 clove comes back as 1/2, and
 * 0.2 g as 1 g. Rounding a real amount out of existence would silently drop an
 * ingredient from a recipe, which is worse than naming an amount nobody can
 * measure exactly.
 *
 * **A factor of exactly 1 changes nothing at all.** Asking for a recipe at the
 * servings it already has is that recipe, not a rounding of it — otherwise
 * opening a recipe and pressing "scale" with no change would rewrite the author's
 * 0.3 tsp into 1/4 tsp. The lines are handed back untouched, which also lets a
 * caller compare by identity.
 *
 * **Ranges scale on both ends, independently.** `2–3 tbsp` doubled is `4–6 tbsp`,
 * and each end is rounded by its own rule rather than one end computed from the
 * other — the two ends are two amounts, and the author chose them separately.
 *
 * Nothing here reads a clock, touches a DOM or imports `node:` anything.
 */

import type { FoodRef } from "../fitness/food.js";
import type { IngredientUnit } from "./units.js";

/**
 * One line of a recipe's ingredient list, as the module models it.
 *
 * `quantityMax` is the upper end of a range and is never set without a
 * `quantity` — `2–3 kašike` is a range, while `kašika` with no amount is an
 * amount nobody stated, and a range whose lower end is missing has no lower end
 * to be the range OF. The store refuses the second shape rather than interpreting
 * it.
 *
 * `gramsPerUnit` is the ONE place a volume may become a mass: the weight of a
 * single unit of THIS line, as the recipe's author knew it. It is deliberately
 * a field rather than a table of densities — see `units.ts`' header and
 * `nutrition.ts` — because a cook who knows that their tablespoon of olive oil
 * weighs 14 g is stating a fact about their own kitchen, and a module that held
 * a density table instead would be guessing for every kitchen it had never seen.
 * It is meaningful only beside a `foodRef` (there is nothing to weigh into
 * otherwise), which the store also refuses.
 */
export interface IngredientLine {
  /** The amount, or null for a line that states none („so", „malo ulja"). */
  readonly quantity: number | null;
  /** The upper end of a range such as „2–3", or null when the line is a single amount. */
  readonly quantityMax: number | null;
  /** The unit `quantity` counts, or null for a bare count („2 jajeta"). */
  readonly unit: IngredientUnit | null;
  readonly name: string;
  /** „sitno seckano", „divided" — how the ingredient is prepared, or null. */
  readonly preparation: string | null;
  /** „Za sos" — the heading this line sits under, or null. */
  readonly group: string | null;
  /** The nutrition food-table entry this line measures into, or null. */
  readonly foodRef: FoodRef | null;
  /** What one `unit` of this line weighs in grams, or null when nobody stated it. */
  readonly gramsPerUnit: number | null;
}

/** The three fields scaling reads. Generic so a store row keeps its own `id` and everything else beside them. */
export type ScalableIngredient = Pick<IngredientLine, "quantity" | "quantityMax" | "unit">;

/** How coarse one unit's rounding is: a whole number, a multiple of a step, or a fraction. */
type Granularity =
  | { readonly kind: "whole" }
  | { readonly kind: "step"; readonly step: number }
  | { readonly kind: "fraction"; readonly of: number };

/** One unit's rule: `low` below `threshold`, `high` at or above it. A single rule says `threshold: Infinity`. */
interface Rounding {
  readonly threshold: number;
  readonly low: Granularity;
  readonly high: Granularity;
}

const WHOLE: Granularity = { kind: "whole" };
const QUARTER: Granularity = { kind: "fraction", of: 4 };
const EIGHTH: Granularity = { kind: "fraction", of: 8 };
const HALF: Granularity = { kind: "fraction", of: 2 };
const FIVE: Granularity = { kind: "step", step: 5 };

function only(granularity: Granularity): Rounding {
  return { threshold: Infinity, low: granularity, high: granularity };
}

function ruleFor(unit: IngredientUnit | null): Rounding {
  switch (unit) {
    case "g":
    case "ml":
      return { threshold: 100, low: WHOLE, high: FIVE };
    case "kg":
    case "l":
      return { threshold: 1, low: { kind: "fraction", of: 100 }, high: { kind: "fraction", of: 20 } };
    case "tsp":
    case "tbsp":
    case "fl_oz":
      return only(QUARTER);
    case "cup":
      return only(EIGHTH);
    default:
      return only(HALF);
  }
}

/** The smallest positive value a granularity can produce — what stands in when a real amount would round to zero. */
function smallestPositive(granularity: Granularity): number {
  switch (granularity.kind) {
    case "whole":
      return 1;
    case "step":
      return granularity.step;
    case "fraction":
      return 1 / granularity.of;
  }
}

function roundTo(value: number, granularity: Granularity): number {
  switch (granularity.kind) {
    case "whole":
      return Math.round(value);
    case "step":
      return Math.round(value / granularity.step) * granularity.step;
    case "fraction":
      // Multiplying by the denominator keeps this exact: quarters and eighths
      // are binary fractions, and 39/20 is the double a reader means by 1.95.
      return Math.round(value * granularity.of) / granularity.of;
  }
}

/**
 * One amount, expressed the way a kitchen writes it — the rules are the file
 * header's, and a positive amount comes back positive.
 */
export function roundToKitchen(value: number, unit: IngredientUnit | null): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  const rule = ruleFor(unit);
  const granularity = value >= rule.threshold ? rule.high : rule.low;
  const rounded = roundTo(value, granularity);
  return rounded > 0 ? rounded : smallestPositive(granularity);
}

/**
 * The ingredients of a recipe at another size: every quantity multiplied by
 * `factor`, then rounded to kitchen-friendly values per unit. `factor` is
 * `targetServings / ownServings`; a factor of exactly 1 hands the lines back
 * unchanged (see the file header).
 *
 * Generic over the line's own type so a store row keeps whatever it carries
 * beside these three fields — `id`, `position`, the rest of the model — and the
 * result is the same row type the caller passed in. A line with no quantity is
 * returned as it is, because there is nothing to multiply and „po ukusu" does
 * not become „po ukusu × 1.5".
 */
export function scaleIngredients<L extends ScalableIngredient>(
  lines: readonly L[],
  factor: number,
): L[] {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`"factor" must be a finite number above 0 (got ${String(factor)}).`);
  }
  if (factor === 1) return [...lines];

  return lines.map((line) => {
    if (line.quantity === null) return line;
    const quantity = roundToKitchen(line.quantity * factor, line.unit);
    const quantityMax =
      line.quantityMax === null ? null : roundToKitchen(line.quantityMax * factor, line.unit);
    // The spread preserves the caller's own type; TypeScript cannot prove that
    // replacing two numbers with two numbers stays assignable to `L`, and this
    // is the one place that costs a cast.
    return { ...line, quantity, quantityMax } as L;
  });
}
