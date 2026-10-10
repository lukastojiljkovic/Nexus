/**
 * Several recipes become one shopping list.
 *
 * The rule is one sentence — merge the lines that name the same thing in
 * compatible units, keep the rest apart, sort the result — and every interesting
 * decision is in what „the same thing" and „compatible" mean.
 *
 * **The same thing is the name folded for case and spacing, and nothing else.**
 * „Brašno", „brašno" and „brašno " are one purchase; „beli luk" and „beli luk u
 * prahu" are two, and so are „beli luk" and „crni luk", which merely rhyme.
 * Diacritics are deliberately NOT folded: a fold can only merge more
 * aggressively, and two lines wrongly merged into one quantity is a number the
 * shopper cannot split back apart. (`foldSearchText` exists for the search
 * index, where a wrong match costs a glance.)
 *
 * **Compatible means the units can be added without inventing anything**, which
 * is `compatibleUnits`' answer: mass with mass, volume with volume, a count only
 * with the same count, and a line with no unit only with another line with no
 * unit. Flour by weight and flour by volume stay two lines, because the module
 * holds no densities — the same refusal `nutrition.ts` makes, for the same
 * reason.
 *
 * **The common unit is the first line's.** „200 g" from the first recipe plus
 * „1 kg" from the second is 1 200 g, not 1.2 kg: the first recipe is the one
 * whose ingredients the shopper is reading, and a list that silently changed
 * units between its own lines would be harder to check against the pages it came
 * from. Amounts are added, never rounded — this is a list of what to BUY, and
 * rounding a purchase down is how the pot comes up short. Each line was already
 * rounded to a kitchen value when it was scaled (`ingredient.ts`).
 *
 * Nothing here reads a clock, touches a DOM or imports `node:` anything.
 */

import type { IngredientLine } from "./ingredient.js";
import { INGREDIENT_UNITS, type IngredientUnit, compatibleUnits, convertQuantity, unitFamily } from "./units.js";

/** One thing to buy: what to call it, how much, and in what. A range keeps both ends. */
export interface ShoppingLine {
  /** The name as the FIRST line that named it spelled it. */
  readonly name: string;
  /** The amount, or null when no recipe stated one („so po ukusu" twice is still no amount). */
  readonly quantity: number | null;
  /** The upper end of the merged range, or null when no contributing line had one. */
  readonly quantityMax: number | null;
  readonly unit: IngredientUnit | null;
}

/**
 * Serbian Latin ordering for the list, the app's one collator spelling
 * (`Intl.Collator(["sr-Latn", "sr"])`): plain `"sr"` mis-tailors š/č/ć/ž, and
 * SQLite has no Serbian collation at all.
 */
const SHOPPING_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** What the merged list is accumulated in, before it is an answer. */
interface Bucket {
  name: string;
  unit: IngredientUnit | null;
  quantity: number;
  quantityMax: number;
  /** Whether any contributing line stated an amount at all. */
  stated: boolean;
  /** Whether any contributing line stated a RANGE — what decides if the answer has an upper end. */
  ranged: boolean;
}

/**
 * The list for a set of already-scaled lines, from any number of recipes in any
 * order: lines are concatenated by the caller, and a recipe's own `group`
 * heading is ignored here because a heading describes one recipe's layout and
 * the list is not laid out that way.
 */
export function buildShoppingList(lines: readonly IngredientLine[]): ShoppingLine[] {
  const buckets = new Map<string, Bucket>();

  for (const line of lines) {
    const name = collapse(line.name);
    const key = `${name.toLowerCase()}\u0000${bucketOf(line.unit)}`;
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      // A Map keeps insertion order, so the first recipe's spelling and unit win
      // without a second sort that could disagree with these lines.
      bucket = { name, unit: line.unit, quantity: 0, quantityMax: 0, stated: false, ranged: false };
      buckets.set(key, bucket);
    }
    if (line.quantity === null) continue;

    bucket.stated = true;
    bucket.quantity += convertWithinBucket(line.quantity, line.unit, bucket.unit);
    // A line with a single amount is a range of one when a neighbour has a
    // range: „2 tbsp" and „1–2 tbsp" are three to four tablespoons together.
    const upper = line.quantityMax ?? line.quantity;
    bucket.quantityMax += convertWithinBucket(upper, line.unit, bucket.unit);
    if (line.quantityMax !== null) bucket.ranged = true;
  }

  return [...buckets.values()]
    .map((bucket) => ({
      name: bucket.name,
      quantity: bucket.stated ? bucket.quantity : null,
      quantityMax: bucket.ranged ? bucket.quantityMax : null,
      unit: bucket.unit,
    }))
    .sort(
      (left, right) =>
        SHOPPING_COLLATOR.compare(left.name, right.name) ||
        unitOrder(left.unit) - unitOrder(right.unit),
    );
}

/** Trim, and collapse the runs of whitespace a pasted line arrives with. */
function collapse(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Which lines may be added to each other. Masses and volumes group by FAMILY,
 * so grams and kilograms land in one bucket; counts group by the unit itself,
 * because a clove and a pinch are not a quantity of anything; and a missing unit
 * groups with itself, as `compatibleUnits` decides.
 */
function bucketOf(unit: IngredientUnit | null): string {
  if (unit === null) return "none";
  const family = unitFamily(unit);
  return family === "count" ? `count:${unit}` : family;
}

/**
 * Converts a line's amount into its bucket's unit. `compatibleUnits` is what
 * built the bucket, so this cannot fail — and if it ever did, the grouping and
 * the conversion would be disagreeing about what is addable, where silently
 * dropping an amount is the one answer a shopping list must never give.
 */
function convertWithinBucket(
  value: number,
  from: IngredientUnit | null,
  to: IngredientUnit | null,
): number {
  if (!compatibleUnits(from, to)) {
    throw new RangeError(`"${String(from)}" and "${String(to)}" cannot be added.`);
  }
  const converted = convertQuantity(value, from, to);
  if (converted === null) {
    throw new RangeError(`"${String(from)}" cannot be expressed in "${String(to)}".`);
  }
  return converted;
}

/** Where a unit sits in the vocabulary, for breaking a name tie; a missing unit sorts last. */
function unitOrder(unit: IngredientUnit | null): number {
  return unit === null ? INGREDIENT_UNITS.length : INGREDIENT_UNITS.indexOf(unit);
}
