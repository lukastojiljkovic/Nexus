/**
 * The FIN module's device preference (FIN slice b), stored in `localStorage` on
 * the `notePrefs.ts` / `taskPrefs.ts` recipe: one key, a safe fallback for
 * anything unrecognized, and no IPC.
 *
 * **Why the primary currency is a DEVICE preference and not a profile one.**
 * The currency of the user's money lives on each ACCOUNT (migration 051) and
 * nowhere else — that is the module's whole no-FX design, and a second,
 * profile-level "the currency" would be a fact competing with it. What this key
 * holds is strictly narrower and honest about itself: which code the „Novi
 * račun" form OPENS ON. It changes no stored row, it is read by one form, and
 * turning it off changes nothing that already exists — which is exactly what a
 * device preference is, and is why „Finansije" earns the „Vrati na
 * podrazumevano" link that a profile-stored card cannot have (SET §5).
 *
 * The default is RSD because the app's language is Serbian; it is the locale's
 * own currency, not a guess about anybody's money.
 */

const PRIMARY_CURRENCY_KEY = "nexus.finance.primaryCurrency";

/** The code a fresh install's „Novi račun" form opens on. */
export const DEFAULT_PRIMARY_CURRENCY = "RSD";

/** ISO-4217 as the schema spells it (migration 051): exactly three upper-case ASCII letters. */
const ISO_4217 = /^[A-Z]{3}$/;

export function isCurrencyCode(value: string): boolean {
  return ISO_4217.test(value);
}

/**
 * What the user typed into a currency field, as a code the wire accepts — or
 * `null` when it is not one. Trimming and up-casing here is a FIELD's courtesy,
 * deliberately not the store's: `FinAccountStore` refuses „rsd" by name, on the
 * grounds that a caller sending it has a bug, and this is the one place that
 * caller is a person typing rather than code.
 */
export function normalizeCurrencyInput(text: string): string | null {
  const code = text.trim().toUpperCase();
  return isCurrencyCode(code) ? code : null;
}

export function readStoredPrimaryCurrency(): string {
  const stored = localStorage.getItem(PRIMARY_CURRENCY_KEY);
  return stored !== null && isCurrencyCode(stored) ? stored : DEFAULT_PRIMARY_CURRENCY;
}

export function persistPrimaryCurrency(currency: string): void {
  localStorage.setItem(PRIMARY_CURRENCY_KEY, currency);
}

/** Forgets this card's one key, so the next read opens on RSD again — „Finansije"'s „Vrati na podrazumevano" (SET §5). */
export function clearStoredFinancePreferences(): void {
  localStorage.removeItem(PRIMARY_CURRENCY_KEY);
}
