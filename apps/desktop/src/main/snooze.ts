/**
 * Snooze resolution for the NOTIFICATIONS module: turning a preset the renderer
 * NAMED into an absolute instant main computes from its own clock (SEC-EL-02 —
 * a deadline is never accepted from the renderer, only a member of a closed
 * set of words).
 *
 * A separate main-side module rather than another function in `index.ts`, for
 * `notificationStrings.ts`'s reason: it touches nothing of Electron, so pulling
 * it out is what makes it testable at all — and this is date arithmetic across
 * midnight, month ends and an evening that may already have passed, which is
 * exactly the kind of code that should be pinned by tests rather than reasoned
 * about twice.
 */

import type { SnoozePreset } from "@nexus/db";

const MS_PER_MINUTE = 60_000;

/**
 * The local hour „Večeras“ means. Not a user preference: the point of the
 * preset is "later today, when the day is done", and a configurable evening
 * would make it a second morning hour rather than a shortcut.
 */
export const TONIGHT_HOUR = 18;

/**
 * Resolves a snooze preset to an absolute ISO-8601 `until`, entirely from the
 * caller's clock. `10m`/`1h` are fixed offsets; `tonight` is today at
 * `TONIGHT_HOUR` local (the store's own "`until` must be strictly after `now`"
 * check rejects it once evening has already passed — the UI hides the preset
 * then, and `resolveDefaultSnoozePreset` below handles the one case that has no
 * UI to hide); `tomorrow-morning` is tomorrow at the profile's configured
 * morning hour.
 *
 * Every branch builds its result from LOCAL y/m/d fields (`clock.ts`'s rule),
 * so "tomorrow" is the user's tomorrow rather than UTC's.
 */
export function computeSnoozeUntil(preset: SnoozePreset, now: Date, morningHour: string): string {
  switch (preset) {
    case "10m":
      return new Date(now.getTime() + 10 * MS_PER_MINUTE).toISOString();
    case "1h":
      return new Date(now.getTime() + 60 * MS_PER_MINUTE).toISOString();
    case "tonight":
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        TONIGHT_HOUR,
        0,
        0,
        0,
      ).toISOString();
    case "tomorrow-morning": {
      const [hour, minute] = morningHour.split(":").map(Number);
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        hour,
        minute,
        0,
        0,
      ).toISOString();
    }
  }
}

/**
 * Which preset the notification center's plain „Odloži“ button means right now
 * (NTF-009): the profile's stored default, except that „Večeras“ has nothing
 * left to offer once `TONIGHT_HOUR` has passed — the store refuses a deadline
 * that is not in the future, so the button would simply fail for the rest of
 * the evening.
 *
 * The explicit chip is hidden by the center in that window, which is the same
 * answer in a different shape; the default has no chip to hide, so it falls
 * forward to the next quiet moment there is, which is tomorrow morning. Applied
 * ONLY to the default: an explicitly chosen „Večeras“ still means what it says
 * and is still refused, because rewriting a choice the user just made would be
 * a different, quieter kind of wrong.
 */
export function resolveDefaultSnoozePreset(preset: SnoozePreset, now: Date): SnoozePreset {
  return preset === "tonight" && now.getHours() >= TONIGHT_HOUR ? "tomorrow-morning" : preset;
}
