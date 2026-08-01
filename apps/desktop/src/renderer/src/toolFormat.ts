/**
 * „Alatke"'s display edge — the one place a tool's exact result becomes Serbian
 * text.
 *
 * The model never rounds (`@nexus/core`'s `units.ts` and `calculators.ts` both
 * say so), so every figure the drawer draws passes through here and nowhere
 * else. `Intl` does the formatting, all of it, in the `"sr-Latn"` this renderer
 * spells everywhere: the decimal comma, the group separator and the placement
 * of the minus sign are the locale's, never this file's.
 *
 * **Three formatters, because there are three honestly different figures.** A
 * conversion spans a millionth to a billion and needs SIGNIFICANT digits; money
 * has a fixed two; a unit price is money that is routinely smaller than a
 * hundredth and would round to „0,00" at two. Using one formatter for all three
 * would make one of them useless.
 */

import { roundForDisplay } from "@nexus/core";

/** The locale every formatter in this renderer spells (`money.ts`, `fitDay.ts` and friends). */
const TOOL_LOCALE = "sr-Latn";

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const existing = formatters.get(key);
  if (existing !== undefined) return existing;
  const created = new Intl.NumberFormat(TOOL_LOCALE, options);
  formatters.set(key, created);
  return created;
}

/**
 * A converted quantity — „1.609,344", „0,000001", „1.073.741.824".
 *
 * Significant digits rather than decimal places, because one converter spans
 * both ends of that range and any fixed decimal count is wrong at one of them.
 * `roundForDisplay` runs first to clear the float noise that would otherwise
 * spend the twelve digits on an artefact (0,1 + 0,2 → 0,30000000000000004).
 */
export function formatToolNumber(value: number): string {
  return formatterFor("sig", { maximumSignificantDigits: 12 }).format(roundForDisplay(value));
}

/**
 * A money-shaped figure at exactly two decimals — a PDV split, an instalment.
 * No currency code: the drawer never asks which money this is, and naming one
 * would be a claim it has no basis for.
 */
export function formatToolAmount(value: number): string {
  return formatterFor("amount", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * A price per unit, to at most four decimals. Two would render „0,24 din. po
 * gramu" as „0,24" fine but a price per millilitre as „0,00", which is the
 * exact figure the comparison exists to show.
 */
export function formatToolUnitPrice(value: number): string {
  return formatterFor("unitPrice", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

/** A percentage to at most two decimals, with the sign the locale places — „17,5%", „−10%". */
export function formatToolPercent(value: number): string {
  return `${formatterFor("percent", { maximumFractionDigits: 2 }).format(roundForDisplay(value))}%`;
}
