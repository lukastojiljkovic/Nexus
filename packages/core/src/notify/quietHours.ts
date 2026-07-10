/**
 * Pure quiet-hours check for the NOTIFICATIONS module (NTF piece a2): given the
 * caller's local wall-clock time and a profile's configured quiet-hours window
 * ("HH:MM" strings, or both null when quiet hours are off), returns whether
 * `nowLocalTime` currently falls inside it. No clock reads — mirrors
 * `deriveNotificationCandidates`'s pure-function idiom exactly; the desktop
 * main process's scheduler is the only caller. The caller, not this function,
 * applies the PRD's `max`-priority quiet-hours exception (the final-warning
 * document reminder and security alerts still fire).
 */

/**
 * True while `nowLocalTime` falls inside `[quietFrom, quietTo)`. Both null
 * (quiet hours off) is always false. Equal `quietFrom`/`quietTo` is a
 * zero-length window — always false, never a 24-hour one. `quietFrom <
 * quietTo` is a same-day window (`quietFrom <= now < quietTo`); `quietFrom >
 * quietTo` wraps past midnight (`now >= quietFrom || now < quietTo`). "HH:MM"
 * strings compare correctly as plain strings, mirroring the engine's own
 * morning-hour comparison.
 */
export function isWithinQuietHours(
  nowLocalTime: string,
  quietFrom: string | null,
  quietTo: string | null,
): boolean {
  if (quietFrom === null || quietTo === null) return false;
  if (quietFrom === quietTo) return false;
  if (quietFrom < quietTo) return nowLocalTime >= quietFrom && nowLocalTime < quietTo;
  return nowLocalTime >= quietFrom || nowLocalTime < quietTo;
}
