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

/** The system language, or "" where there is no `navigator` (the Node test environment). */
function systemLanguage(): string {
  return typeof navigator === "undefined" ? "" : (navigator.language ?? "");
}

/**
 * The language a device that has never been asked starts in.
 *
 * The system locale decides, and only once: `sr`/`sr-Latn`/`sr-Cyrl` all read
 * as "this person already reads Serbian", and every other system language
 * starts in English, because a reader of `de` is likelier to read English than
 * Serbian. The answer is never written down - it is the absence of a stored
 * choice, not a decision the app made for the user.
 */
function firstRunLocale(): Locale {
  return systemLanguage().toLowerCase().startsWith("sr") ? "sr" : "en";
}

/**
 * The stored choice; on a device that has never stored one, the system language
 * decides. A value that IS stored but not a locale this build serves (a code
 * removed from `LOCALES`, or one typed into localStorage by hand) falls back to
 * `DEFAULT_LOCALE` rather than to the system language: the user has already
 * answered the question once, and re-asking it because the answer went stale
 * would flip their interface on them.
 */
export function readStoredLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (isLocale(stored)) return stored;
  if (stored !== null) return DEFAULT_LOCALE;
  return firstRunLocale();
}

export function persistLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}

/**
 * Forgets the choice, so the next read is a first run again: the system
 * language decides (Serbian for `sr*`, otherwise English), exactly as on a
 * device that has never stored one. This is "Vrati na podrazumevano".
 */
export function clearStoredLocale(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Tells the main process which language the interface is in.
 *
 * Main composes the native file-dialog chrome and the OS notifications, and it
 * cannot import this table (a separate bundle, browser-only build), so it has
 * to be told. A report and not a request, like `profiles:set-active`: it changes
 * what main writes next, never what the renderer may read, so there is nothing
 * in it for a compromised renderer to widen. The call is fire-and-forget - the
 * table is already switched by the time it lands, and a main process that is
 * slow to hear is a stale dialog title, not a failed render.
 */
export function reportLocaleToMain(locale: Locale): void {
  if (typeof window === "undefined") return;
  void window.nexus?.setLocale(locale);
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
  const locale = readStoredLocale();
  applyLocale(locale);
  reportLocaleToMain(locale);
}
