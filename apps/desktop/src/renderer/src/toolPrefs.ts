/**
 * „Alatke"'s one device preference (UTIL slice c), stored in `localStorage` on
 * the `habitPrefs.ts` / `financePrefs.ts` recipe: one key, a safe fallback for
 * anything unrecognized, and no IPC.
 *
 * **What it is, and what it deliberately is not.** It holds the rate the PDV
 * tool OPENS on — nothing more. It does not decide what any figure is computed
 * at (every result carries the rate it used), it changes no stored row, and
 * forgetting it changes nothing that exists. That is what makes it a device
 * preference and what earns „Alatke" the „Vrati na podrazumevano" link a
 * profile-stored card cannot have (SET §5).
 *
 * The default is the general rate, which is not a judgement: 20% is what
 * applies unless the law lists the goods otherwise, so it is the answer that is
 * right more often, and the user changes it in one click if their trade is the
 * other one.
 */

import { PDV_RATES, PDV_RATE_STANDARD } from "@nexus/core";

const DEFAULT_VAT_RATE_KEY = "nexus.tools.defaultVatRate";

/** The rate a fresh install opens the PDV tool on. */
export const DEFAULT_TOOL_VAT_RATE = PDV_RATE_STANDARD;

/**
 * Whether a number is one of the two rates the law has. Restated against
 * `PDV_RATES` rather than hard-coded, so a stored „17" from a hand-edited
 * `localStorage` falls back rather than reaching a calculation.
 */
export function isPdvRate(value: number): boolean {
  return PDV_RATES.includes(value);
}

export function readStoredDefaultVatRate(): number {
  const stored = localStorage.getItem(DEFAULT_VAT_RATE_KEY);
  if (stored === null) return DEFAULT_TOOL_VAT_RATE;
  const parsed = Number(stored);
  return Number.isFinite(parsed) && isPdvRate(parsed) ? parsed : DEFAULT_TOOL_VAT_RATE;
}

export function persistDefaultVatRate(rate: number): void {
  localStorage.setItem(DEFAULT_VAT_RATE_KEY, String(rate));
}

/** Forgets this card's one key, so the next read opens on the general rate again (SET §5). */
export function clearStoredToolPreferences(): void {
  localStorage.removeItem(DEFAULT_VAT_RATE_KEY);
}
