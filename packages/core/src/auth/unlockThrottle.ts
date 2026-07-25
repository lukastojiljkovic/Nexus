/**
 * The unlock-attempt throttle (SEC-LOC-02, ADR-018): a pure state machine over
 * an escalating backoff. This slice owns only the arithmetic; slice b persists
 * `AttemptState` inside the `guard` blob (safeStorage-encrypted, beside the
 * keychain file) so a counter in plain JSON can't be reset with a text editor.
 * No clock reads here — `now`/`lockedUntil` are explicit ISO-8601 instants, the
 * same "caller owns the clock" idiom as `planEngine.ts`/`notificationEngine.ts`.
 */

export interface AttemptState {
  failedAttempts: number;
  /** ISO-8601 instant, or `null` while no wait is currently in effect. */
  lockedUntil: string | null;
}

/** The reset value after a successful unlock (slice b's job — exposed so it has one place to import it from). */
export const INITIAL_ATTEMPT_STATE: AttemptState = { failedAttempts: 0, lockedUntil: null };

/** Wrong attempts allowed before any waiting starts. */
export const FREE_ATTEMPTS = 4;

/** Escalating wait after each attempt beyond `FREE_ATTEMPTS`; the last entry is the cap for every further failure. */
const LOCK_SCHEDULE_MS = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000];

/** The schedule's final (and capped) delay — kept as a named constant so the fallback below states its own meaning. */
const CAPPED_DELAY_MS = 15 * 60_000;

/**
 * Folds one failed attempt into the state, stamping the new lock deadline
 * from `now` (never from a stored clock, so a slow test or a real gap between
 * attempts behaves identically). The first `FREE_ATTEMPTS` failures leave
 * `lockedUntil` at `null`; every one after follows the schedule in
 * `LOCK_SCHEDULE_MS`, repeating its last entry forever once exhausted.
 */
export function registerFailedAttempt(state: AttemptState, now: string): AttemptState {
  const failedAttempts = state.failedAttempts + 1;
  const overLimit = failedAttempts - FREE_ATTEMPTS;
  if (overLimit <= 0) {
    return { failedAttempts, lockedUntil: null };
  }
  const scheduleIndex = Math.min(overLimit - 1, LOCK_SCHEDULE_MS.length - 1);
  // `scheduleIndex` is always in range (clamped above); the `??` only satisfies
  // noUncheckedIndexedAccess and never actually falls back at runtime.
  const delayMs = LOCK_SCHEDULE_MS[scheduleIndex] ?? CAPPED_DELAY_MS;
  const lockedUntil = new Date(Date.parse(now) + delayMs).toISOString();
  return { failedAttempts, lockedUntil };
}

/**
 * Milliseconds still to wait at `now` — 0 when unlocking is allowed. Never
 * negative: a clock that jumps forward past the deadline clamps to 0, and one
 * that jumps backward before it just waits longer, exactly as a real elapsed
 * gap would. A `lockedUntil` that fails to parse (a corrupt guard blob) is
 * treated as "not locked" rather than thrown — refusing to unlock over a
 * damaged guard file would brick the app worse than the throttle it enforces.
 */
export function remainingLockMs(state: AttemptState, now: string): number {
  if (state.lockedUntil === null) return 0;
  const lockedUntilMs = Date.parse(state.lockedUntil);
  if (Number.isNaN(lockedUntilMs)) return 0;
  const remaining = lockedUntilMs - Date.parse(now);
  return remaining > 0 ? remaining : 0;
}
