import type { Event } from "../../shared/ipc.js";
import { collator } from "./intl.js";

/**
 * A free-text field as the store takes it: trimmed, and blank means no value.
 * It is the rule the title and the location already follow, so clearing a box
 * clears the stored text instead of saving an empty string beside it.
 */
export function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The categories the profile's events already carry, for the category field to
 * offer. CAL has no category list of its own: a category is free text, arriving
 * from an ICS import, a template or the user, so the field suggests what is in
 * use rather than inventing a vocabulary the calendar would then have to keep.
 */
export function categorySuggestions(events: readonly Event[]): string[] {
  const used = new Set<string>();
  for (const event of events) {
    if (event.category !== null) used.add(event.category);
  }
  return [...used].sort((a, b) => collator().compare(a, b));
}
