/**
 * The copy layer the app imports — `import { strings } from "./strings.js"`,
 * unchanged at all ~1,570 call sites.
 *
 * WHAT THIS SOLVES. Every user-facing string already lived in one table; what
 * did not exist was a way to serve a DIFFERENT table without touching those
 * call sites. The obvious answers all fail here:
 *
 *   - a `useStrings()` context is the industry shape and the wrong one — it
 *     can only be called inside components, so the ~17 non-React modules that
 *     read copy (error mappers, comparators, the search index builder) would
 *     have to take `strings` as a parameter, cascading through their callers
 *     and their tests;
 *   - dotted-key lookup (`t("tasks.tags.actionError")`) would trade a compile
 *     error for a runtime missing-key and kill autocomplete — a typed object
 *     table is BETTER technology than string keys, not a stepping stone to
 *     them;
 *   - swapping the exported object wholesale would leave every module-scope
 *     alias pointing at the old one.
 *
 * WHAT IT DOES INSTEAD. `strings` is one object whose IDENTITY never changes
 * for the life of the process; switching locale overwrites its leaves in place.
 * Anything that reads `strings.a.b` at render time sees the new text, and so
 * does anything holding a subtree alias (`const s = strings.tools`), because
 * the alias points at the very object being rewritten. Only two things need
 * care, and both are handled: a module that copies a LEAF at import time keeps
 * a stale primitive forever (guarded by `scripts/check-string-capture.mjs`),
 * and React has to be told to re-render (`applyLocale` is called before the
 * state update that remounts the page).
 *
 * ADDING A LANGUAGE is then one file and one line: write `strings.<code>.ts`
 * exporting a table typed `Strings`, and add it to `LOCALES` below. The
 * compiler reports one error per string not yet translated and one per key
 * invented — there is no way to half-add a locale and not know it.
 */
import { sr, type Strings } from "./strings.sr.js";
import { en } from "./strings.en.js";

export type { Strings } from "./strings.sr.js";

/**
 * Every locale the app can serve.
 *
 * Serbian and English, each a whole table typed `Strings`; the compiler
 * reports one error per leaf a locale has not translated and one per key it
 * invented, so there is no way to half-add a locale and not know it. The order
 * is the order the settings row offers, and `DEFAULT_LOCALE` below is what an
 * unrecognised stored value falls back to.
 *
 * The union is written out rather than derived from the record with
 * `keyof typeof LOCALES`, because a record of two full tables is thousands of
 * literal types and the declaration emitter refuses to serialize a `keyof` of
 * it (TS7056). Drift is still impossible: `LOCALES` is typed
 * `Record<Locale, Strings>`, so a code missing from the union, missing from the
 * record, or present only in the record is one compile error each.
 */
export type Locale = "sr" | "en";

export const LOCALES: Record<Locale, Strings> = { sr, en };

/**
 * The fallback: the table the process starts on and the table an unrecognised
 * stored code resolves to. First-run detection (system locale `sr*` keeps
 * Serbian, anything else starts English) lives in `localePrefs.ts`, beside the
 * storage it belongs to - this module touches no browser API.
 */
export const DEFAULT_LOCALE: Locale = "sr";

/**
 * BCP-47 tags for `Intl`, per locale.
 *
 * Serbian is asked for as `sr-Latn` first for the same reason the app's
 * collators are: plain `"sr"` resolves to the Cyrillic tailoring, which sorts
 * Latin š/č/ć wrongly. Plural CATEGORIES are identical either way, so this is
 * belt-and-braces here — but the list is the house idiom and a future locale
 * with a script split would need it to be right.
 */
const INTL_TAGS: Record<Locale, readonly string[]> = {
  sr: ["sr-Latn", "sr"],
  en: ["en-GB", "en"],
};

/**
 * The live table. Same object for the life of the process — see the header.
 * Typed as the deep-readonly `Strings`, so call sites still cannot write to it;
 * the only mutation is `applyLocale`, through one cast, below.
 */
export const strings: Strings = structuredClone(sr) as Strings;

let currentLocale: Locale = DEFAULT_LOCALE;

/** Which locale the table currently holds. */
export function activeLocale(): Locale {
  return currentLocale;
}

type Node = Record<string, unknown>;

/**
 * Copy `source`'s leaves onto `target`, keeping every object identity.
 *
 * Recurses rather than reassigning precisely so that subtree aliases taken at
 * module scope stay live. Arrays are replaced element-wise for the same reason.
 */
function overwrite(target: Node, source: Node): void {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value === null || typeof value !== "object") {
      target[key] = value;
      continue;
    }
    const existing = target[key];
    if (existing === null || typeof existing !== "object") {
      target[key] = value;
      continue;
    }
    overwrite(existing as Node, value as Node);
  }
}

/**
 * Serve a different language.
 *
 * Must be called BEFORE the React state update that re-renders, so the render
 * pass reads the new text rather than the old. It is synchronous and cheap —
 * a walk of a few thousand leaves — so there is nothing to await.
 */
export function applyLocale(locale: Locale): void {
  currentLocale = locale;
  overwrite(strings as unknown as Node, LOCALES[locale] as unknown as Node);
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

function rulesFor(locale: Locale): Intl.PluralRules {
  const cached = pluralRules.get(locale);
  if (cached !== undefined) return cached;
  const created = new Intl.PluralRules([...INTL_TAGS[locale]]);
  pluralRules.set(locale, created);
  return created;
}

/**
 * Numeral agreement for day counts — two forms.
 *
 * Was a hand-written Serbian rule (`n % 10 === 1 && n % 100 !== 11`); it now
 * asks `Intl.PluralRules`, which carries CLDR's table for every locale and
 * agrees with that rule exactly on Serbian, including the 11 exception. The
 * signature is unchanged, so its 23 callers did not move — and a locale added
 * later gets correct agreement without anyone editing this function.
 */
export function dayUnit(count: number, one: string, many: string): string {
  return rulesFor(currentLocale).select(count) === "one" ? one : many;
}

/**
 * Full numeral agreement — the three forms `dayUnit` deliberately does not
 * model: 1 (and 21, 31, …) takes `one`, 2–4 (and 22–24, …) take `few`, and
 * everything else takes `many`; the teens 11–14 are the exception that takes
 * `many` at every one of them.
 *
 * `dayUnit` gets away with two forms because „dan"/„dana" happen to collapse
 * there. A counted noun that does not collapse — „3 praznine" beside „5
 * praznina" — needs this. Only ever applied to a count the app itself computed
 * (see the `recurrence` note in the table on why a freely typed number keeps
 * its labelled-field phrasing instead).
 *
 * A locale with more than three forms (Arabic has six) would need the extra
 * slots added here and in the table — a change the compiler would report at
 * every call site, which is the right way for it to surface.
 */
export function countUnit(count: number, one: string, few: string, many: string): string {
  const category = rulesFor(currentLocale).select(count);
  if (category === "one") return one;
  if (category === "few") return few;
  return many;
}

/**
 * Read a string out of a table whose keys are only known at runtime — a module
 * id, a registry category, a smart-list id.
 *
 * Exists so those tables can keep LITERAL key types (`satisfies`, not `as
 * Record<string, string>`). The cast used to sit on the table, which quietly
 * cost two things: `strings.modules.anythingAtAll` type-checked, and a widened
 * subtree is exempt from the completeness check a second locale relies on. The
 * widening belongs at the one place a dynamic key is actually used, and this
 * is it.
 */
export function lookup(table: Readonly<Record<string, string>>, key: string): string | undefined {
  return table[key];
}

/**
 * Fill the `{name}` slots of a copy string.
 *
 * **Why the table cannot just hold a function.** A leaf that is
 * `(n) => \`Linija ${n}\`` reads as the tidier answer and is a live defect: the
 * live table is `structuredClone(sr)`, and `structuredClone` throws
 * `DataCloneError` on a function — so ONE such leaf anywhere in the tree kills
 * the module at import, which means a white window rather than a bad string.
 * That is why `LocaleShape` refuses functions outright and why interpolation
 * needs a data form. The app's older answer — `…Prefix` / `…Suffix` keys
 * composed at the call site — stays right for a value at one end of a sentence
 * and does not survive „{a} zahteva {b} {c}, a upisano je {d}", where a
 * translator has to be able to move all four.
 *
 * An unknown placeholder is left standing rather than blanked: `{count}` in the
 * UI names the key that was not supplied, where an empty gap says only that a
 * sentence reads oddly.
 */
export function fill(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole: string, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}
