/**
 * A duration in words, for the two processes that have to agree about one.
 *
 * It lives in `shared/` rather than in either side because the rest countdown
 * (ADR-081 §7) is DRAWN in the renderer and ANNOUNCED by main: the page shows
 * „1:30" ticking down and the OS toast says „Pauza od 1:30" when it ends. Two
 * copies of that formatting would be two chances for the toast and the page to
 * describe the same rest differently — the defect class the ledger calls „a rule
 * written twice", and one nobody would notice until a user read both.
 *
 * Nothing here reads a clock. A duration is a number of seconds; where those
 * seconds came from is the caller's business.
 */

/**
 * Seconds as „1:30" — whole minutes, then seconds zero-padded to two digits.
 *
 * Under a minute it is still „0:45" rather than „45 s": one shape for one
 * quantity, so a countdown does not change form as it crosses a minute. Negative
 * and fractional inputs are floored at zero and to whole seconds respectively —
 * a countdown past its end is over, not overdue by nine seconds.
 */
export function clockText(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}
