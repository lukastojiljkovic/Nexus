import { type CookbookCourse, type IngredientUnit, scaleIngredients } from "@nexus/core";
import { numberFormat } from "../../../renderer/src/intl.js";
import type { RecipeIngredientView, RecipeView } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * The COOKBOOK page's arithmetic and wording, as pure functions (ADR-090).
 *
 * **Why this is not inline in `Page.tsx`.** Scaling, the amount text and the
 * step walk are the half of the page that can be checked without a DOM — the app
 * has no DOM test environment, so anything written inside a component is checked
 * by nobody. The rules themselves are `@nexus/core`'s (`scaleIngredients` rounds
 * by each unit's own rule); what lives here is the page's use of them and the
 * words around the numbers.
 *
 * **Every number goes through `Intl`.** `numberFormat` reads the ACTIVE locale's
 * tags through the shell's own factories rather than a tag spelled here, which is
 * what makes „1,5 kašike" in Serbian and „1.5 tbsp" in English two readings of
 * one value instead of two spellings somebody kept in step by hand.
 */

/** The most servings the store holds (migration 076's CHECK) — the page's own ceiling for the stepper. */
export const MAX_SERVINGS = 100;

/** A servings count the store will take: a whole number in `1..100`. */
export function clampServings(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_SERVINGS, Math.max(1, Math.round(value)));
}

/**
 * One recipe's ingredients for a wanted number of servings.
 *
 * The factor is `wanted / own`, and a factor of exactly 1 hands the lines back
 * untouched — `scaleIngredients`' own rule, which is what makes opening a recipe
 * and reading it show the author's amounts rather than a rounding of them.
 */
export function scaleLines(
  lines: readonly RecipeIngredientView[],
  ownServings: number,
  wanted: number,
): RecipeIngredientView[] {
  const factor = clampServings(wanted) / Math.max(1, clampServings(ownServings));
  return scaleIngredients(lines, factor);
}

/** The label of a unit, or the empty string for a bare count — `copy.units` is indexed because its keys ARE the vocabulary. */
export function unitLabel(unit: IngredientUnit | null): string {
  return unit === null ? "" : copy.units[unit];
}

/** The label of a course — indexed for the same reason, and the list is `@nexus/core`'s own. */
export function courseLabel(course: CookbookCourse): string {
  return copy.courses[course];
}

/**
 * An amount as a kitchen reads it: the locale's digits, the unit's own label,
 * and a range written with the en dash a recipe prints.
 *
 * A line that states no amount answers an empty string — „po ukusu" is not a
 * quantity, and printing a zero there would invent one.
 */
export function formatAmount(
  quantity: number | null,
  quantityMax: number | null,
  unit: IngredientUnit | null,
): string {
  if (quantity === null) return "";
  const formatter = numberFormat({ maximumFractionDigits: 2 });
  const amount =
    quantityMax === null
      ? formatter.format(quantity)
      : `${formatter.format(quantity)}–${formatter.format(quantityMax)}`;
  const label = unitLabel(unit);
  return label === "" ? amount : `${amount} ${label}`;
}

/**
 * One ingredient line as the cooking view and the detail list draw it: the
 * amount, the name, and the preparation note after a comma.
 *
 * The amount is the SCALED one — what the servings stepper is for — while the
 * author's own spelling of the whole line is what the editor shows, which is why
 * the raw line is stored beside these fields rather than reconstructed from them.
 */
export function lineText(line: RecipeIngredientView, factor: number): string {
  const scaled = scaleIngredients([line], factor)[0] ?? line;
  const amount = formatAmount(scaled.quantity, scaled.quantityMax, scaled.unit);
  const preparation = scaled.preparation === null ? "" : `, ${scaled.preparation}`;
  const named = amount === "" ? scaled.name : `${amount} ${scaled.name}`;
  return `${named}${preparation}`;
}

/** The factor a recipe's lines are drawn at, for a wanted number of servings. */
export function factorFor(recipe: Pick<RecipeView, "servings">, wanted: number): number {
  return clampServings(wanted) / Math.max(1, clampServings(recipe.servings));
}

/**
 * A duration as a recipe prints it: „45 min", „1 h 30 min", „2 h".
 *
 * The digits come through `Intl` and the two unit words come from the copy
 * table, because the two are different tables and neither is the other's
 * business.
 */
export function formatTime(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${numberFormat().format(rest)} ${copy.detail.minutes}`;
  if (rest === 0) return `${numberFormat().format(hours)} ${copy.detail.hours}`;
  return `${numberFormat().format(hours)} ${copy.detail.hours} ${numberFormat().format(rest)} ${copy.detail.minutes}`;
}

/** Total time, or null when the recipe states neither half — a zero here would be a claim nobody made. */
export function totalMinutes(
  recipe: Pick<RecipeView, "prepMinutes" | "cookMinutes">,
): number | null {
  const parts = [recipe.prepMinutes, recipe.cookMinutes].filter(
    (value): value is number => value !== null,
  );
  if (parts.length === 0) return null;
  return parts.reduce((total, value) => total + value, 0);
}

/**
 * The step an arrow key moves to, clamped at both ends.
 *
 * Clamped rather than wrapped: the cooking view is a place somebody follows in
 * order, and a right arrow on the last step jumping back to the first would be a
 * gesture that loses their place instead of ending the recipe.
 */
export function stepIndex(index: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, index + delta));
}
