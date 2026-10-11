/**
 * The undo stack: a game's whole action list, with undo as an entry in it rather
 * than a second list beside it.
 *
 * **Why the undo is IN the log.** A saved game is „a seed and what the player
 * did" — the smallest thing that resumes a deal exactly — and a player who undid
 * four moves did something. Keeping the undos in the one list means the state is
 * a pure function of `(variant, seed, log)`, replay is the only place a state is
 * built, and „unlimited undo" costs nothing to support: an undo appends, and the
 * stack the player sees is the log walked with a pop per undo.
 *
 * **Undo cannot go back past the beginning, and a log that says otherwise is
 * refused rather than repaired** — `logMoves` stops at empty so a caller reading
 * a stored log never sees a negative stack, while `replay` in each engine treats
 * an undo with nothing to undo as a `bad-entry`/`empty-undo` refusal. The
 * difference is deliberate: reading is total, writing is validated.
 */

/**
 * An entry IS the move itself — `{ kind: "draw" }`, `{ kind: "move", … }` — and
 * the undo is the one entry that is not a move. That is the shape it is stored
 * in, so a wrapper around every move would be one more bracket per save; the only
 * price is that a game may not name a move kind `"undo"`, and none does.
 */

/** One press of undo. Shared by every game, because it carries nothing of its own. */
export interface GameUndoEntry {
  readonly kind: "undo";
}

/** Every action the player took: a move, or an undo of the last move still standing. */
export type GameLogEntry<M extends { readonly kind: string }> = M | GameUndoEntry;

/** The one undo entry, reused — it is a constant, not a value per game. */
export const UNDO_ENTRY: GameUndoEntry = { kind: "undo" };

export function isUndoEntry(value: unknown): value is GameUndoEntry {
  return (
    typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "undo"
  );
}

/**
 * Guards one log entry against the game's own move vocabulary — the shape check
 * stage 2's IPC and the store both run before a stored log is replayed.
 */
export function isGameLogEntry<M extends { readonly kind: string }>(
  value: unknown,
  isMove: (candidate: unknown) => candidate is M,
): value is GameLogEntry<M> {
  return isUndoEntry(value) || isMove(value);
}

export function logPushMove<M extends { readonly kind: string }>(
  log: readonly GameLogEntry<M>[],
  move: M,
): GameLogEntry<M>[] {
  return [...log, move];
}

export function logPushUndo<M extends { readonly kind: string }>(
  log: readonly GameLogEntry<M>[],
): GameLogEntry<M>[] {
  return [...log, UNDO_ENTRY];
}

/**
 * The moves still standing, in the order they were played — the log walked with
 * a pop per undo. Reading is total: an undo with nothing to undo leaves the
 * stack as it was (`log.test.ts` pins that, because „the first n moves" is the
 * wrong answer the moment an undo sits between two moves).
 */
export function logMoves<M extends { readonly kind: string }>(
  log: readonly GameLogEntry<M>[],
): M[] {
  const stack: M[] = [];
  for (const entry of log) {
    if (isUndoEntry(entry)) stack.pop();
    // The union is disjoint on `kind` — no game names a move „undo" — so what is
    // left after the undo is a move. TypeScript cannot see that from `M`, which
    // is exactly why the rule is written down in this file's header.
    else stack.push(entry as M);
  }
  return stack;
}

export function logCanUndo<M extends { readonly kind: string }>(
  log: readonly GameLogEntry<M>[],
): boolean {
  return logMoves(log).length > 0;
}
