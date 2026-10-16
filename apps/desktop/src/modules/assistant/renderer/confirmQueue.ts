/**
 * THE QUESTIONS A TURN IS WAITING ON, oldest first.
 *
 * **Why a queue and not one slot.** Two `write` or `network` calls in one model
 * step produce two `confirm` events, because both tools park in main and wait to
 * be asked. One slot answered that by overwriting: the dialog showed the second
 * question, and the first tool stayed parked on a promise nobody could ever
 * answer - from the user's side, a turn that had stopped with no Stop to press
 * and no question left to read. The queue is the page's side of the fix; the
 * loop's own half is asking one question at a time.
 *
 * **What clears it.** Answering drops the head and the next question is drawn.
 * The end of a turn clears the lot: a question whose turn is over has no tool
 * left to answer, and `Page.tsx`'s unmount stops the turn, which resolves every
 * parked question as refused.
 */

import type { ConfirmEffect } from "./surfaceStates.js";

/** One parked question: the request its answer goes back to, the tool's name and effect, and its own summary. */
export interface ConfirmAsk {
  readonly requestId: string;
  readonly tool: string;
  readonly effect: ConfirmEffect;
  readonly summary: string;
}

/** The empty queue. One shared value, so "nothing is being asked" is one identity. */
export const NO_CONFIRMS: readonly ConfirmAsk[] = [];

/** The queue with one question at the end of it. */
export function enqueueConfirm(
  queue: readonly ConfirmAsk[],
  ask: ConfirmAsk,
): readonly ConfirmAsk[] {
  return [...queue, ask];
}

/** The question the dialog draws: the oldest one, or `null` when nothing is waiting. */
export function headConfirm(queue: readonly ConfirmAsk[]): ConfirmAsk | null {
  return queue[0] ?? null;
}

/** The queue without its head - what answering that question means. */
export function dropConfirm(queue: readonly ConfirmAsk[]): readonly ConfirmAsk[] {
  return queue.length === 0 ? queue : queue.slice(1);
}
