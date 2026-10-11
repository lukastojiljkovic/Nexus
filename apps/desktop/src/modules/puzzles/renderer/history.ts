/**
 * The undo/redo stack every panel in this module steps through, as one pure
 * value (ADR-090's rule that the half of a page that can be tested without a DOM
 * is not written inline in the component).
 *
 * **Why it is a snapshot stack and not an inverse-move log.** Each of the four
 * puzzles has a state that is a few hundred numbers: an entry, a mark, a pair of
 * tiles, an expression. Undoing one means putting the previous state back, and
 * an inverse operation per puzzle would be four more procedures whose only job
 * is to be the mirror of the code that made the change. The state is what the
 * store already carries; a snapshot of it is the same value one step earlier,
 * and there is nothing to get wrong.
 *
 * **The stack is bounded, and the oldest step is what falls off.** A puzzle can
 * be played for an hour and every state is 81 cells; a bound that dropped the
 * newest step would be a bound nobody can see, so it drops the oldest and the
 * only cost is that undo eventually stops somewhere far back.
 */

/** How many steps back a board can be stepped. Far past any real game, and the whole stack is cells rather than a journal. */
export const MAX_HISTORY = 200;

export interface History<T> {
  /** Older states, oldest first. The last one is what `undo` restores. */
  readonly past: readonly T[];
  readonly present: T;
  /** States that were stepped back from, newest last. The last one is what `redo` restores. */
  readonly future: readonly T[];
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Records a new state. A step taken after an undo drops the branch that was stepped back from, which is what every editor does and the only meaning „redo" can have. */
export function push<T>(history: History<T>, next: T): History<T> {
  const past = [...history.past, history.present];
  return {
    past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
    present: next,
    future: [],
  };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}
