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
 *
 * **The VALUE is checked too, and for a while it was not.** The original guarded
 * only the limit, on the reasoning that the value is computed by the tool and
 * therefore sound — which is exactly the assumption this drawer keeps finding to
 * be false. A section modulus that underflowed to zero gave a bending stress of
 * `Infinity`, and `Infinity / 235` is `Infinity`, so the stress ratio came out as
 * a second infinity wearing the authority of a comparison against the user's own
 * allowable. Withholding is the honest answer: a ratio of a number that is not a
 * number is not a smaller claim, it is a different one.
 */
export function ratioAgainst(value: number, limit: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return undefined;
  return value / limit;
}

/**
 * The four guards, and why each takes `number | undefined` and narrows.
 *
 * They started as `(value: number) => boolean`, and three toolkits promptly
 * wrote their own `positive` / `nonNegative` beside the import — not out of
 * carelessness, but because an optional input is `number | undefined` and a
 * guard that cannot narrow leaves the caller holding a `number | undefined` it
 * has just proved is a number. The choice on offer was a private copy or a
 * non-null assertion, and a private copy is the better of those two.
 *
 * So the kit takes the wider type and returns a predicate, which removes the
 * reason to copy rather than forbidding the copy. `if (!isPositive(input.x))
 * return fail("x");` now leaves `input.x` a `number` on the line below it, in
 * every module, without an assertion anywhere.
 */

/** Finite and above zero — the guard for anything that will be divided BY. */
export function isPositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

/** Finite and not below zero — a quantity that may legitimately be nothing. */
export function isNonNegative(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

/** Finite and inside an inclusive band. Both ends are the tool's, never a rule's. */
export function isInRange(value: number | undefined, min: number, max: number): value is number {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max;
}

/** A whole count inside an inclusive band — risers, bars, courses, servings. */
export function isIntegerIn(value: number | undefined, min: number, max: number): value is number {
  return value !== undefined && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * The two guards for the OTHER untrusted input: a string that claims to name a
 * branch.
 *
 * **A compile-time union is not a runtime guarantee, and here that matters more
 * than usual.** These functions run in the Electron main process on objects that
 * came from the renderer over IPC (SEC-EL), so a field declared
 * `"copper" | "aluminium"` is a claim the renderer makes, not a fact the main
 * process has checked. TypeScript's `noUncheckedIndexedAccess` catches the easy
 * half — indexing a `Record<string, T>` yields `T | undefined` and forces a
 * check — and is silent on exactly the dangerous half: indexing a
 * `Record<"copper" | "aluminium", T>` by a value declared as that union is
 * believed to be defined, so nothing forces a check and the lookup returns
 * `undefined` at runtime.
 *
 * What follows is never a refusal, which is the point. Destructuring it throws a
 * `TypeError` inside an IPC handler; spreading it gives `{}`, so the result is
 * `ok: true` with `NaN` in half its fields; and an `===` chain simply falls
 * through to whichever branch it happens to end on — silently the wrong metal,
 * the wrong tax rate, the wrong allowable. All three are worse than `fail()`.
 */

/** Whether `value` really is a key of `table`, asked of the object, not the type. */
export function isKeyOf<T extends Record<string, unknown>>(
  value: string,
  table: T,
): value is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(table, value);
}

/** Whether `value` is one of a fixed set — for selectors that branch on `===`. */
export function isOneOf<T extends string>(value: string, options: readonly T[]): value is T {
  return (options as readonly string[]).includes(value);
}

/**
 * A quotient that refuses to be `Infinity`.
 *
 * **This is here because it was the single commonest defect across all
 * seventeen toolkits.** Two independent verification rounds over 274 tools
 * produced sixty-three correctness findings, and thirty-six of them were one
 * shape: a divisor that reached the division without a guard. The symptom is
 * always identical and always looks like something else — the tool accepts the
 * input, divides, and the surface prints „∞ mm", which reads as a rendering bug
 * rather than as arithmetic that should have refused.
 *
 * It exists in two forms, and the second is why a guard at the top of the
 * function is not enough on its own:
 *
 *  - the input was simply never validated, and
 *  - the input WAS validated and then quantised to zero. `isPositive(0.0004)`
 *    is true; `Math.round(0.0004 * 100)` is 0, and the division three lines
 *    later is by that zero.
 *
 * `undefined` rather than a refusal, deliberately. Most call sites are one
 * figure among twenty in a result the rest of which is perfectly good, and a
 * whole tool that refuses because one derived ratio is undefined answers less
 * than a tool that withholds that one ratio. Where the quotient IS the answer,
 * the caller turns the `undefined` into `fail("<input>")` itself — which is a
 * decision about the tool, and belongs in the tool.
 *
 * A negative divisor is allowed and a zero one is not: dividing by −2 is
 * ordinary arithmetic (a reaction acting the other way is still a reaction),
 * while dividing by nothing is the failure this exists to catch. The result is
 * checked too — `1e308 / 1e-308` overflows to `Infinity` from two divisors that
 * both passed.
 */
export function quotient(numerator: number, divisor: number): number | undefined {
  if (!Number.isFinite(divisor) || divisor === 0) return undefined;
  const value = numerator / divisor;
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The nine-significant-digit snap that has to happen before a floor.
 *
 * `Math.floor` over a quantity built from two divisions lands one unit in the
 * last place BELOW a whole number often enough to matter — and when it does,
 * „koliko punih komada staje" is one too few. It is invisible to any test
 * written from round numbers, which is every test anyone writes first, and it
 * is wrong in the direction that costs the user material.
 *
 * Nine digits because double precision carries between fifteen and seventeen,
 * so the error being removed lives well below the ninth and the snap reaches it
 * without reaching anything real. Zero and the non-finite values pass through,
 * since `log10` of either is not a magnitude.
 *
 * **It is for the step before a floor, not for a returned figure.** A value
 * with more than nine significant digits IS moved — `snap(167.647058823)` is
 * `167.647059` — which is exactly what makes it safe in front of `Math.floor`
 * and wrong as a last pass over an answer. Use `floorSnapped` / `ceilSnapped`
 * and leave the underlying quantity alone.
 */
export function snap(value: number): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const magnitude = Math.floor(Math.log10(Math.abs(value))) + 1;
  const factor = 10 ** (9 - magnitude);
  return Math.round(value * factor) / factor;
}

/** `Math.floor` with the representation error taken out first. */
export function floorSnapped(value: number): number {
  return Math.floor(snap(value));
}

/** `Math.ceil` with the representation error taken out first. */
export function ceilSnapped(value: number): number {
  return Math.ceil(snap(value));
}

/**
 * Half away from zero, at a fixed number of decimals — money's rounding, and
 * every „na dve decimale" in the drawer.
 *
 * **The nudge is relative, and that is the whole point of it being here.** Four
 * toolkits had each written their own version with an ABSOLUTE `+ 1e-9` before
 * the round, which is two different bugs depending on the size of the number:
 * on a total of 900 000 000 it is far smaller than one unit in the last place
 * and does nothing, and on a quantity of 5e-8 it is twenty times the value and
 * rounds noise up to a whole unit. Scaling the nudge to the magnitude is the
 * only spelling that behaves the same way at both ends of the range.
 *
 * **And the relative nudge is CAPPED, because unbounded it becomes the error it
 * was written to remove.** `racunovodstvo.ts` refused to adopt this function and
 * said why, which was the right call and is the reason the cap exists: four ulps
 * of 9 000 000 000 000 000 is about 8, so `roundHalfUp(9e15, 0)` returned
 * `9_000_000_000_000_008` — eight whole minor units invented on a total that
 * `allocateWithoutRemainder` is proven exact at. At that magnitude doubles are
 * spaced two apart, there is no fractional part left to correct, and the right
 * nudge is none at all. The cap is `2^48`, whose four ulps are exactly `0.25`:
 * large enough to still absorb a representation error at every scale where one
 * can exist, and half the distance to the `0.5` boundary it must never cross.
 *
 * `Math.round` alone is not this function: it rounds half UP, so −2.5 becomes
 * −2, while every invoice, tax return and cut list in this drawer wants −3.
 */
const NUDGE_CAP = 2 ** 48;

export function roundHalfUp(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const scaled = Math.abs(value) * factor;
  const nudged = scaled + Math.min(Math.max(scaled, 1), NUDGE_CAP) * 4 * Number.EPSILON;
  const magnitude = Math.round(nudged) / factor;
  // Zero has no sign here. Without this, −0.004 at two decimals comes back as
  // `-0`, which every formatter in the app then prints as „−0,00".
  return magnitude === 0 ? 0 : Math.sign(value) * magnitude;
}
