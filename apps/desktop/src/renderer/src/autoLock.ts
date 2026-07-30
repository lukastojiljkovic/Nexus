/**
 * The idle auto-lock preference (ADR-018 / AUTH-005): how many minutes of
 * inactivity before `App` locks the local account on its own. Owns the
 * `localStorage` key exactly the way `accent.ts` owns the accent choice — a
 * closed set of allowed values and a safe fallback for anything else
 * (including nothing stored yet).
 */

export const AUTO_LOCK_MINUTES = [5, 15, 30, 60, 0] as const;

/** Minutes of inactivity before auto-lock; `0` means "never". */
export type AutoLockMinutes = (typeof AUTO_LOCK_MINUTES)[number];

const STORAGE_KEY = "nexus.autoLock";
const DEFAULT_MINUTES: AutoLockMinutes = 15;

function isAutoLockMinutes(value: number): value is AutoLockMinutes {
  return (AUTO_LOCK_MINUTES as readonly number[]).includes(value);
}

/** Reads the stored auto-lock preference, falling back to 15 minutes for anything unrecognized. */
export function readStoredAutoLock(): AutoLockMinutes {
  // Blank text is not a value: `Number("")` and `Number("  ")` are 0, itself an
  // allowed member meaning "never lock", so a corrupted or tampered key would
  // switch a security control OFF instead of falling back. Only trimmed,
  // non-empty text is parsed; an explicit "0" the user chose still reads as never.
  const stored = localStorage.getItem(STORAGE_KEY)?.trim();
  if (stored === undefined || stored === "") return DEFAULT_MINUTES;
  const parsed = Number(stored);
  return isAutoLockMinutes(parsed) ? parsed : DEFAULT_MINUTES;
}

/** Persists the auto-lock preference. */
export function persistAutoLock(value: AutoLockMinutes): void {
  localStorage.setItem(STORAGE_KEY, String(value));
}
