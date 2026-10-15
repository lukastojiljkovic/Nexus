/**
 * The 72-hour kit checklist: the default items, and the three edits a person
 * makes to it (tick, add, remove), kept as a value so the page and the storage
 * read one shape.
 *
 * **The defaults are Ready.gov's basic list, and the list is cited.** The
 * „Build A Kit" page (checked 2026-10-15) prints fourteen items under „Basic
 * Disaster Supplies Kit": water, food, a battery-powered or hand-crank radio, a
 * flashlight, a first aid kit, extra batteries, a whistle, a dust mask, plastic
 * sheeting with scissors and duct tape, moist towelettes with garbage bags and
 * plastic ties, a wrench or pliers, a manual can opener, local maps, and a cell
 * phone with chargers and a backup battery. Each one is an id here, and its
 * words live in the copy tables. The page says „several days", and the checklist
 * keeps its name; nothing in it claims a number of hours Ready.gov does not print.
 *
 * **An entry is an id, a tick and, for an item the user added, its text.** A
 * default item has `text: null` and reads its words from the copy table, so a
 * language change does not touch the stored list. A user's item carries its own
 * words, which are not translated.
 *
 * Every function is total and returns a new list: the page holds one value and
 * replaces it, and `parseKit` refuses a stored value it cannot read rather than
 * repairing it into something the user did not write.
 */

/** The fourteen basic items, in the order the page prints them. */
export const KIT72_DEFAULT_IDS = [
  "water",
  "food",
  "radio",
  "flashlight",
  "firstAid",
  "batteries",
  "whistle",
  "dustMask",
  "sheeting",
  "towelettes",
  "tools",
  "canOpener",
  "maps",
  "phone",
] as const;

export type KitDefaultId = (typeof KIT72_DEFAULT_IDS)[number];

/** Policy: the most entries a list may hold, so a stored list stays a checklist and not a file. */
export const MAX_KIT_ENTRIES = 60;

/** Policy: the longest text of an item the user adds. */
export const MAX_KIT_TEXT_LENGTH = 120;

/** One line of the checklist. */
export interface KitEntry {
  /** A default id, or `custom-<n>` for an item the user added. Unique within a list. */
  readonly id: string;
  /** The words of an item the user added; null for a default item, whose words are in the copy table. */
  readonly text: string | null;
  readonly done: boolean;
}

/** The checklist as it ships: every default item, none ticked. */
export function defaultKit(): readonly KitEntry[] {
  return KIT72_DEFAULT_IDS.map((id) => ({ id, text: null, done: false }));
}

/** The list with the entry's tick flipped; a list without that id comes back unchanged. */
export function toggleKitEntry(kit: readonly KitEntry[], id: string): readonly KitEntry[] {
  return kit.map((entry) => (entry.id === id ? { ...entry, done: !entry.done } : entry));
}

/** The list without that entry. Removing a default item is allowed: the list is the user's. */
export function removeKitEntry(kit: readonly KitEntry[], id: string): readonly KitEntry[] {
  return kit.filter((entry) => entry.id !== id);
}

/**
 * The list with an item appended, or the list unchanged when the text is empty,
 * too long, or the list is full. The text is trimmed; the caller shows the limit.
 */
export function addKitEntry(kit: readonly KitEntry[], text: string): readonly KitEntry[] {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > MAX_KIT_TEXT_LENGTH) return kit;
  if (kit.length >= MAX_KIT_ENTRIES) return kit;
  // One above the highest custom number still in the list: an id is unique within
  // a list, which is all a stored checklist needs.
  const highest = Math.max(0, ...kit.map((entry) => customNumber(entry.id) ?? 0));
  return [...kit, { id: `custom-${highest + 1}`, text: trimmed, done: false }];
}

function customNumber(id: string): number | null {
  const match = /^custom-([1-9][0-9]{0,5})$/.exec(id);
  return match === null ? null : Number(match[1]);
}

/**
 * A stored list, or null when it is not one this module wrote: not an array, too
 * long, a duplicate id, an unknown default, a custom id without text, or text
 * outside the limits.
 */
export function parseKit(raw: unknown): readonly KitEntry[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_KIT_ENTRIES) return null;
  const ids = new Set<string>();
  const entries: KitEntry[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { id, text, done } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof done !== "boolean" || ids.has(id)) return null;
    ids.add(id);
    if (text === null) {
      if (!(KIT72_DEFAULT_IDS as readonly string[]).includes(id)) return null;
    } else if (typeof text !== "string" || customNumber(id) === null) {
      return null;
    } else if (text.trim() === "" || text.length > MAX_KIT_TEXT_LENGTH) {
      return null;
    }
    entries.push({ id, text: text as string | null, done });
  }
  return entries;
}
