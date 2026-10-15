import { defaultKit, parseKit, type KitEntry } from "@nexus/core";

/**
 * The 72-hour kit's ticks and added items, kept per profile on this machine.
 *
 * **Why not the card's database.** The checklist is a plan for a bag or a cupboard,
 * not a fact about the person the card holds, so it does not belong in the
 * card's tables and would need a migration for fourteen ticks. It is the same
 * arrangement the Signals module makes for its device preferences: `localStorage`,
 * keyed by profile so one person's list is not forced on another. The list is
 * read through `parseKit`, so a value this module did not write falls back to the
 * defaults rather than to whatever the storage happens to hold.
 */

const keyFor = (profileId: string): string => `nexus.emergency.${profileId}.kit72`;

/** The stored checklist, or the defaults for nothing stored, an unreadable value or no storage at all. */
export function readKit(profileId: string): readonly KitEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(profileId));
    if (raw === null) return defaultKit();
    return parseKit(JSON.parse(raw)) ?? defaultKit();
  } catch {
    return defaultKit();
  }
}

export function writeKit(profileId: string, kit: readonly KitEntry[]): void {
  localStorage.setItem(keyFor(profileId), JSON.stringify(kit));
}
