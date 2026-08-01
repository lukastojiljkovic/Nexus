/**
 * What „urađeno" means for a habit, in ONE place — the module's smallest rule
 * and the one two processes both have to answer with the same sentence.
 *
 * It lived in the renderer alone while the renderer was the only surface asking
 * (HABIT slice b: the „Danas" ticks, the history grid, the streak pair). Slice c
 * gives the main process the same question — a habit reminder must not fire for
 * something already done today — and main cannot import the renderer, so the
 * rule moved HERE rather than being spelled a second time. The renderer's
 * `habitDone.ts` re-exports this function, so its callers and its tests are
 * untouched and there is still exactly one definition of „done".
 *
 * Deliberately NOT beside the streak engine: `computeHabitStreak` hands this
 * derivation to its caller on purpose (the target lives on the habit row and the
 * engine is about periods, not values), and a rule the engine refuses to own
 * should not sit in the engine's file.
 */

/**
 * THE rule. `value` is 0 when the day has no entry at all, which is why a binary
 * habit reads `> 0` rather than „an entry exists": the two say the same thing
 * and only one of them needs the caller to hold the entry.
 */
export function countsAsDone(target: number | null, value: number): boolean {
  return target === null ? value > 0 : value >= target;
}
