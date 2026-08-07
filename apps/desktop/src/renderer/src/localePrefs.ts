import { applyLocale, DEFAULT_LOCALE, LOCALES, type Locale } from "./strings.js";

/**
 * Which language the interface is served in, on THIS device.
 *
 * A device preference and not a profile one, deliberately: it describes the
 * person sitting in front of the machine, exactly as the theme, the clock
 * format and the first day of the week do. Two profiles on one laptop share a
 * keyboard and a pair of eyes; they do not need two answers to „which language
 * do I read".
 *
 * The stored value is validated against `LOCALES` on every read rather than
 * cast, so a code that was removed from the build — or typed into localStorage
 * by hand — falls back to Serbian instead of leaving the app with a table that
 * does not exist.
 */

const STORAGE_KEY = "nexus.locale";

/** Narrowing over the stored string. Never a cast: an unknown code must fall through to the default. */
function isLocale(value: string | null): value is Locale {
  return value !== null && Object.prototype.hasOwnProperty.call(LOCALES, value);
}

/** Every language the build can actually serve, in declaration order — what the settings row offers. */
export function availableLocales(): Locale[] {
  return Object.keys(LOCALES) as Locale[];
}

/** The stored choice, or Serbian for anything unrecognized (including nothing stored yet). */
export function readStoredLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}

/** Forgets the choice, so the next read is Serbian again — „Izgled“'s „Vrati na podrazumevano“. */
export function clearStoredLocale(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Serves the stored language, before the first render.
 *
 * Called from `main.tsx` beside the theme and the accent, and an EXPLICIT call
 * rather than a side effect inside `strings.ts`: that module is imported by
 * every test in the package, and those run in a Node environment with no
 * `localStorage` at all. A copy table that touched storage on import would make
 * the whole suite depend on a DOM it does not have.
 */
export function applyStoredLocale(): void {
  applyLocale(readStoredLocale());
}
