/**
 * The electronics catalogue's English text, picked by the ACTIVE interface
 * locale.
 *
 * The catalogue ships an English field beside every shipped Serbian one
 * (`nameEn`, `summaryEn`, and `labelEn` on the few pins whose label is a Serbian
 * word), but the values are DATA inside `@nexus/core` and know nothing about
 * which language the user chose. This module is the renderer's edge, exactly as
 * `fitnessLocale.ts` is FIT's: it answers the active language, falling back to
 * the Serbian field for a component the user typed in themselves, which has no
 * English one to give.
 *
 * Nothing here is captured at module scope: `activeLocale()` is read on every
 * call, because the language switches at runtime without a reload.
 */
import type { ComponentDef, Pin } from "@nexus/core";

import { activeLocale, type Locale } from "./strings.js";

/** A component's name in the active language. */
export function componentName(component: ComponentDef, locale: Locale = activeLocale()): string {
  return locale === "en" && component.nameEn !== undefined
    ? component.nameEn
    : component.name;
}

/** A component's one-line summary in the active language. */
export function componentSummary(component: ComponentDef, locale: Locale = activeLocale()): string {
  return locale === "en" && component.summaryEn !== undefined
    ? component.summaryEn
    : component.summary;
}

/** What is printed beside a pin in the active language. */
export function pinLabel(pin: Pin, locale: Locale = activeLocale()): string {
  return locale === "en" && pin.labelEn !== undefined ? pin.labelEn : pin.label;
}
