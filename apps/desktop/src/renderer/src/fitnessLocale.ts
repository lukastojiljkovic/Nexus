/**
 * The fitness catalogue's English text, picked by the ACTIVE interface locale.
 *
 * The catalogue ships an `en` field beside every Serbian one (`nameEn`,
 * `notesEn`, `servings[].labelEn`; exercises already carried `nameEn`), but the
 * searches run in main and the IPC options it returns carry a single `name`.
 * This module is the renderer's edge: it resolves a `catalogue:<id>` reference
 * back to the shipped entry and answers the active language, so a surface shows
 * English without main having to know the interface language at all.
 *
 * Nothing here is captured at module scope: `activeLocale()` is read on every
 * call, because the language switches at runtime without a reload.
 */
import { catalogueFood, parseFoodRef } from "@nexus/core";
import type { FoodServing } from "@nexus/core";

import { activeLocale } from "./strings.js";

/** The catalogue entry behind a `catalogue:<id>` reference, or undefined for a user's own food. */
function catalogueEntryFor(ref: string): ReturnType<typeof catalogueFood> {
  const parsed = parseFoodRef(ref);
  return parsed !== null && parsed.kind === "catalogue" ? catalogueFood(parsed.id) : undefined;
}

/** A food option's name in the active language; the Serbian name for a user's own food. */
export function foodOptionName(option: { readonly ref: string; readonly name: string }): string {
  if (activeLocale() !== "en") return option.name;
  return catalogueEntryFor(option.ref)?.nameEn ?? option.name;
}

/** A food option's notes in the active language; the snapshot for a user's own food. */
export function foodOptionNotes(option: { readonly ref: string; readonly notes: string }): string {
  if (activeLocale() !== "en") return option.notes;
  return catalogueEntryFor(option.ref)?.notesEn ?? option.notes;
}

/** A serving's label in the active language. `labelEn` rides the IPC payload with the catalogue serving. */
export function servingLabel(serving: FoodServing): string {
  return activeLocale() === "en" && serving.labelEn !== undefined ? serving.labelEn : serving.label;
}

/** An exercise's name in the active language; the Serbian name when it has no English one. */
export function exerciseOptionName(option: { readonly name: string; readonly nameEn: string }): string {
  return activeLocale() === "en" && option.nameEn.trim().length > 0 ? option.nameEn : option.name;
}
