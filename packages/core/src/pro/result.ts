/**
 * The one answer shape every professional tool returns, and the four guards
 * every one of them needs before it may answer at all.
 *
 * **Written once because it was about to be written eighteen times.** Each
 * toolkit is its own file (`pro/<pack>.ts`), which is the right seam for the
 * arithmetic and the wrong one for this: `ProResult` copied per pack is
 * eighteen types that are structurally identical and drift the moment one of
 * them gains a field, and `value > 0 && Number.isFinite(value)` copied per tool
 * is the four-copies-of-the-arithmetic defect at its smallest scale. A guard
 * spelled `value > 0` alone passes `Infinity`, which is what a division by a
 * field the user left empty produces — so the copy that forgets `isFinite` does
 * not fail loudly, it prints `∞ mm` and looks like a bug in the display.
 *
 * **A refusal names an input, never a sentence.** `@nexus/core` holds no
 * user-facing text; `reason` is a key the surface's own Serbian table turns into
 * a line. That is what lets the maths be tested against hand-worked numbers
 * rather than against copy, and what stops a translation from breaking a test.
 */

/** A refusal: the tool cannot answer, and says which input made that so. */
export interface ProFailure {
  readonly ok: false;
  /** A key into the tool's own Serbian copy, never a sentence. */
  readonly reason: string;
}

/** The one shape every professional tool returns. */
export type ProResult<T> = ({ readonly ok: true } & T) | ProFailure;

export const fail = (reason: string): ProFailure => ({ ok: false, reason });

/**
 * A computed quantity over the limit the user typed — the only comparison a
 * `life-safety` or `food-safety` tool is allowed to make.
 *
 * A ratio and not a verdict: `1.04` is a fact about two numbers, while „prelazi
 * dozvoljeno" would be this app choosing which rule applies and asserting that
 * the limit typed into the box was the right one. A limit of zero or less is
 * treated as no limit, because a ratio against it says nothing.
 */
export function ratioAgainst(value: number, limit: number | undefined): number | undefined {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return undefined;
  return value / limit;
}

/** Finite and above zero — the guard for anything that will be divided BY. */
export function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Finite and not below zero — a quantity that may legitimately be nothing. */
export function isNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Finite and inside an inclusive band. Both ends are the tool's, never a rule's. */
export function isInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** A whole count inside an inclusive band — risers, bars, courses, servings. */
export function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}
