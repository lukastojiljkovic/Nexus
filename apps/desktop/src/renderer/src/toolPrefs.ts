/**
 * What the tool drawers remember about THIS DEVICE (UTIL slice c, PRO slice a;
 * per profile since the finder), stored in `localStorage` on the
 * `habitPrefs.ts` / `financePrefs.ts` recipe: a key each, a safe fallback for
 * anything unrecognized, and no IPC.
 *
 * Three things: the rate the PDV tool opens on, the tools a profile STARRED, and
 * the tools a profile opened last („Nedavno“).
 *
 * **What they are, and what they deliberately are not.** The rate is the rate
 * the PDV tool OPENS on — nothing more. It does not decide what any figure is
 * computed at (every result carries the rate it used), it changes no stored row,
 * and forgetting it changes nothing that exists. That is what makes it a device
 * preference and what earns „Alatke“ the „Vrati na podrazumevano“ link a
 * profile-stored card cannot have (SET §5).
 *
 * The default is the general rate, which is not a judgement: 20% is what
 * applies unless the law lists the goods otherwise, so it is the answer that is
 * right more often, and the user changes it in one click if their trade is the
 * other one.
 *
 * **The two lists are keyed by profile, the rate is not.** A PDV rate is a fact
 * about the country the machine is in; a star and a history are facts about what
 * one PERSON did, and two people who share an account share the machine and not
 * their drawers. See the header over the lists below for why that choice lives
 * in `localStorage` rather than in the profile database.
 */

import { PDV_RATES, PDV_RATE_STANDARD } from "@nexus/core";

const DEFAULT_VAT_RATE_KEY = "nexus.tools.defaultVatRate";

/** The rate a fresh install opens the PDV tool on. */
export const DEFAULT_TOOL_VAT_RATE = PDV_RATE_STANDARD;

/**
 * Whether a number is one of the two rates the law has. Restated against
 * `PDV_RATES` rather than hard-coded, so a stored „17“ from a hand-edited
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

/**
 * Forgets everything this device remembers about either drawer — the PDV rate
 * the tool opens on, every profile's stars and every profile's „Nedavno“ — so
 * the next read opens on the general rate, and the finder opens on a catalogue
 * with no stars and no history (SET §5).
 *
 * It clears BOTH drawers, from the card of one of them, because „Stručne
 * alatke“ declares no settings panel and a key with no reset path is a key the
 * promise quietly stops covering.
 *
 * The two lists are keyed BY PROFILE, so this walks the store rather than
 * removing two keys by name: a profile nobody has opened since the update is
 * still a profile whose stars this promise covers, and a list of key names here
 * would have to grow one entry per profile to be able to say so.
 */
export function clearStoredToolPreferences(): void {
  localStorage.removeItem(DEFAULT_VAT_RATE_KEY);
  localStorage.removeItem(LEGACY_RECENT_KEY);
  // Backwards over a live `length`: `removeItem` renumbers the store under us,
  // so a forward walk would skip every key it deletes.
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key === null) continue;
    if (key.startsWith(FAVOURITES_KEY_PREFIX) || key.startsWith(RECENT_KEY_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

/* --- Favourites and „Nedavno“ ----------------------------------------------
 *
 * The tools one PROFILE starred, and the tools it opened last — two per-profile
 * device preferences on `navPrefs.ts`'s exact recipe (`nexus.nav.pinned.
 * <profileId>`): one key each, `localStorage`, no IPC.
 *
 * **Why per profile, when the drawer used to keep one list for the whole
 * device.** Two people who share an account share the machine, not their
 * drawers: a star an electrician put on a cable-drop tool is not an answer for
 * the student profile beside it, and a shared „Nedavno“ would hand one person
 * the other's shortcuts under their own name. `navPrefs` already made exactly
 * this call for the sidebar's pinned rows.
 *
 * **Why a star and a history need to exist at all.** „Alatke“ has eleven tools
 * and „Stručne alatke“ has hundreds. At eleven a rail is a menu; at hundreds it
 * is an index, and the four or five tools a particular electrician actually
 * uses are somewhere inside it every single time. Nothing else in the drawer can
 * know which those are, because the answer is not in the catalogue — it is in
 * what this person did last week.
 *
 * **Device preferences and not profile ROWS**, and that is the half the word
 * „profile“ does not settle. The profile database holds facts about the DATA — a
 * task, a flag, a goal — while these two are facts about how this machine was
 * USED. They change no stored row, forgetting them costs nothing but a shortcut,
 * and that is what makes them eligible for „Vrati na podrazumevano“ (SET §5), a
 * link every profile-stored card is deliberately denied. A database design would
 * also have meant a migration, a new IPC channel through the whole `as*`
 * validation chain and a store method, to protect a list of shortcuts.
 *
 * **One list for both drawers, unlike the device-wide pair this replaces.** The
 * finder searches the whole catalogue at once, so its „Nedavno“ is one history:
 * a tool just opened in „Alatke“ belongs in the professional drawer's list too,
 * and keeping it out would be the one finder lying about what this device did
 * last. The rail's own search still narrows the rail by drawer, and the
 * directory still filters the history against the tools it can draw.
 *
 * **Nothing here resolves an id.** The caller filters against the tools it
 * actually has, so a tool whose module was switched off, whose toolkit was
 * dropped, or which this build no longer ships simply does not appear — and a
 * hand-edited `localStorage` full of invented ids draws an empty list rather
 * than a row that opens nothing.
 */

/**
 * How many a drawer remembers. Long enough to cover a working session, short
 * enough that the list stays a shortcut rather than becoming a second rail.
 */
const RECENT_LIMIT = 8;

/**
 * How many a profile may star. Generous rather than tight — a favourite is a
 * shortcut somebody chose, and the finder lists them all — but bounded, for the
 * reason `RECENT_LIMIT` is applied on READ: `localStorage` is editable by hand,
 * and the list feeds a row per entry.
 */
const FAVOURITES_LIMIT = 64;

const FAVOURITES_KEY_PREFIX = "nexus.tools.favourites.";
const RECENT_KEY_PREFIX = "nexus.tools.recent.";

/**
 * The device-wide „Nedavno“ map this file kept before the lists moved to
 * profiles. Nothing reads it: handing one device's history to whichever profile
 * opens the drawer first is the sharing the move exists to end. It is only
 * forgotten with the rest, because the prefix walk does not match it (no dot)
 * and a key no reset reaches is the gap SET §5 forbids.
 */
const LEGACY_RECENT_KEY = "nexus.tools.recent";

/**
 * One stored id list, defended at every step: `localStorage` is editable by hand
 * and survives a downgrade, so the value can be missing, not JSON, an object or
 * a number instead of an array, an array of things that are not ids, or a
 * hundred thousand entries long. Every one of those answers „nothing stored“
 * rather than throwing inside a click handler.
 */
function readIdList(key: string, limit: number): string[] {
  const stored = localStorage.getItem(key);
  if (stored === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string" || seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
    if (ids.length === limit) break;
  }
  return ids;
}

/**
 * Writes one list, and never lets a full or switched-off `localStorage` turn the
 * caller's action into a throw. `persistDefaultVatRate` is deliberately not
 * guarded like this, and the difference is how often each runs: the rate changes
 * when somebody changes it, these on every star and on every tool anyone opens.
 * A star is a convenience; opening the tool is not.
 */
function writeIdList(key: string, ids: readonly string[]): void {
  try {
    if (ids.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // See above: the tool still opens, or still stars, and this device simply
    // does not remember that it did.
  }
}

/** The tools one profile has starred, in the order they were starred. */
export function readFavouriteTools(profileId: string): readonly string[] {
  return readIdList(FAVOURITES_KEY_PREFIX + profileId, FAVOURITES_LIMIT);
}

/**
 * Stars or unstars a tool, and hands back the new list so the caller does not
 * have to read what it just wrote.
 */
export function toggleFavouriteTool(profileId: string, id: string): readonly string[] {
  const current = readFavouriteTools(profileId);
  const next = current.includes(id)
    ? current.filter((seen) => seen !== id)
    : [...current, id];
  writeIdList(FAVOURITES_KEY_PREFIX + profileId, next);
  return next;
}

/** What one profile has opened, across both drawers, newest first. */
export function readRecentTools(profileId: string): readonly string[] {
  return readIdList(RECENT_KEY_PREFIX + profileId, RECENT_LIMIT);
}

/**
 * Records that a tool was opened, and hands back the new list so the caller does
 * not have to read what it just wrote.
 */
export function rememberRecentTool(profileId: string, id: string): readonly string[] {
  const next = [id, ...readRecentTools(profileId).filter((seen) => seen !== id)].slice(
    0,
    RECENT_LIMIT,
  );
  writeIdList(RECENT_KEY_PREFIX + profileId, next);
  return next;
}
