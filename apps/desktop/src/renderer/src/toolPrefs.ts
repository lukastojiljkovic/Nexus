/**
 * What the tool drawer remembers about THIS DEVICE (UTIL slice c, PRO slice a),
 * stored in `localStorage` on the `habitPrefs.ts` / `financePrefs.ts` recipe: a
 * key each, a safe fallback for anything unrecognized, and no IPC.
 *
 * Two things: the rate the PDV tool opens on, and which tools were opened last
 * („Nedavno", at the foot of this file).
 *
 * **What they are, and what they deliberately are not.** The rate is the rate
 * the PDV tool OPENS on — nothing more. It does not decide what any figure is computed
 * at (every result carries the rate it used), it changes no stored row, and
 * forgetting it changes nothing that exists. That is what makes it a device
 * preference and what earns „Alatke" the „Vrati na podrazumevano" link a
 * profile-stored card cannot have (SET §5).
 *
 * The default is the general rate, which is not a judgement: 20% is what
 * applies unless the law lists the goods otherwise, so it is the answer that is
 * right more often, and the user changes it in one click if their trade is the
 * other one.
 */

import { PDV_RATES, PDV_RATE_STANDARD, TOOL_DRAWERS, type ToolDrawer } from "@nexus/core";

const DEFAULT_VAT_RATE_KEY = "nexus.tools.defaultVatRate";

/** The rate a fresh install opens the PDV tool on. */
export const DEFAULT_TOOL_VAT_RATE = PDV_RATE_STANDARD;

/**
 * Whether a number is one of the two rates the law has. Restated against
 * `PDV_RATES` rather than hard-coded, so a stored „17" from a hand-edited
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
 * the tool opens on, and „Nedavno" — so the next read opens on the general rate
 * and an empty history (SET §5).
 *
 * It clears BOTH drawers, from the card of one of them, because „Stručne
 * alatke" declares no settings panel and a key with no reset path is a key the
 * promise quietly stops covering. See the „Nedavno" header below.
 */
export function clearStoredToolPreferences(): void {
  localStorage.removeItem(DEFAULT_VAT_RATE_KEY);
  localStorage.removeItem(RECENT_KEY);
}

/* --- „Nedavno" -------------------------------------------------------------
 *
 * The tools this device has opened, newest first.
 *
 * **Why the drawer needs one at all.** „Alatke" has eleven tools and „Stručne
 * alatke" has hundreds. At eleven a rail is a menu; at hundreds it is an index, and the four or five tools a
 * particular electrician actually uses are somewhere inside it every single
 * time. Nothing else in the drawer can know which those are, because the answer
 * is not in the catalogue — it is in what this person did last week.
 *
 * **A device preference, not a profile row**, on `readStoredDefaultVatRate`'s
 * exact reasoning: it is a fact about how this machine was used, it changes no
 * stored data, and forgetting it costs nothing but a shortcut. That is what
 * makes it eligible for „Vrati na podrazumevano" (SET §5), and
 * `clearStoredToolPreferences` forgets it with the rest.
 *
 * **One key for both drawers.** They are one instrument standing in two rooms,
 * and only one of the two (`tools`) declares a settings card — a second key
 * belonging to `pro` would be a key with no reset path, which is the shape a
 * „forget everything this device remembers" promise quietly stops covering.
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

const RECENT_KEY = "nexus.tools.recent";

type RecentMap = Partial<Record<ToolDrawer, readonly string[]>>;

/**
 * The stored map, defended at every step: `localStorage` is editable by hand and
 * survives a downgrade, so the parse can fail, the value can be an array or a
 * number instead of an object, a drawer's list can be anything at all, and the
 * list can be a hundred thousand entries long. Each of those answers with an
 * empty list for that drawer rather than throwing inside a click handler.
 */
function readRecentMap(): RecentMap {
  const stored = localStorage.getItem(RECENT_KEY);
  if (stored === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const map: Record<string, readonly string[]> = {};
  for (const drawer of TOOL_DRAWERS) {
    const list = (parsed as Record<string, unknown>)[drawer];
    if (!Array.isArray(list)) continue;
    map[drawer] = list.filter((id): id is string => typeof id === "string").slice(0, RECENT_LIMIT);
  }
  return map;
}

/** What this device has opened in one drawer, newest first. */
export function readRecentTools(drawer: ToolDrawer): readonly string[] {
  return readRecentMap()[drawer] ?? [];
}

/**
 * Records that a tool was opened, and hands back the new list so the caller does
 * not have to read what it just wrote.
 *
 * The write is guarded where `persistDefaultVatRate`'s is not, and the
 * difference is how often each runs: the rate is written when somebody changes
 * it, this on every tool anyone opens. A full or disabled `localStorage` must
 * not be able to turn „open a tool" into a click that throws — the list is a
 * convenience, and the tool opening is not.
 */
export function rememberRecentTool(drawer: ToolDrawer, id: string): readonly string[] {
  const next = [id, ...readRecentTools(drawer).filter((seen) => seen !== id)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify({ ...readRecentMap(), [drawer]: next }));
  } catch {
    // See above: the drawer still opens, and this device simply does not
    // remember that it did.
  }
  return next;
}
