import { DEFAULT_FOCUS_CONFIG, validateFocusConfig } from "@nexus/core";
import type { FocusConfig } from "@nexus/core";

/**
 * FOKUS's device preference (UTIL slice b) — the Pomodoro shape — stored in
 * `localStorage` on the `habitPrefs.ts` / `financePrefs.ts` recipe: one key, a
 * safe fallback for anything unrecognized, and no IPC.
 *
 * **Why the DEVICE and not the profile, which is the one decision this file
 * makes.** Every alternative was a database migration for four integers, and
 * the four integers do exactly one thing: they say how long the NEXT phase is
 * planned for. They are not history — a finished phase records its own
 * `planned_minutes`, so changing 25 to 50 tomorrow does not restate a single
 * thing about yesterday, which is precisely the property that made
 * `study_settings` a profile row and makes this one not. And they are read by
 * exactly one page and one settings card, both of which run in the renderer.
 *
 * That is also the honest test for a device preference, the one FIN's currency
 * and HABIT's reminder hour already pass: it changes no stored row, it is read
 * by one surface, and forgetting it changes nothing that already exists — which
 * is what earns „Fokus" the „Vrati na podrazumevano" link a profile-stored card
 * is deliberately denied (SET §5).
 *
 * The one thing this arrangement gives up is stated rather than hidden: a
 * second machine would open on 25/5/15/4 again. Nothing syncs today (CLOUD OUT),
 * so there is no second machine for it to disagree with; if that changes, this
 * moves to a profile row and the card's `storage` changes with it.
 *
 * **The read runs the ENGINE's validator, never a second reading of it.** A
 * hand-edited key, a half-written value or a config from a future build lands
 * on `validateFocusConfig`, exactly as an IPC payload would — so the page can
 * never hold a config the timer would refuse, and the bounds live in the one
 * place that owns them.
 */

const CONFIG_KEY = "nexus.focus.config";

/**
 * The stored Pomodoro shape, or the classic 25/5/15/4 when there is nothing
 * usable stored. Always a FRESH object (`validateFocusConfig`'s own contract),
 * so a caller that mutates what it got back cannot reach into the next read.
 *
 * The fallback is WHOLE rather than per-field, and that is deliberate: half a
 * stored config beside half a default would be a shape nobody ever chose — a
 * 50-minute work phase somebody set, next to a 5-minute break they never saw.
 * The four numbers are one setting, so they are kept or dropped together.
 */
export function readStoredFocusConfig(): FocusConfig {
  const stored = localStorage.getItem(CONFIG_KEY);
  if (stored === null) return { ...DEFAULT_FOCUS_CONFIG };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { ...DEFAULT_FOCUS_CONFIG };
  }
  const result = validateFocusConfig(parsed);
  return result.ok ? result.config : { ...DEFAULT_FOCUS_CONFIG };
}

/**
 * Writes a config the caller has already validated. Not re-validated here on
 * purpose: the settings form's whole job is to refuse an invalid value AND say
 * which field was wrong, and a silent second refusal down here would turn a
 * pointed error message into a save that appeared to work.
 */
export function persistFocusConfig(config: FocusConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

/** Forgets this card's one key, so the next read opens on 25/5/15/4 again — „Fokus"'s „Vrati na podrazumevano" (SET §5). */
export function clearStoredFocusPreferences(): void {
  localStorage.removeItem(CONFIG_KEY);
}
