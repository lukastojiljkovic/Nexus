/**
 * The three answers a finished-or-not game gives, shared by every game in
 * `games/` that ends in a win or a draw. Backgammon does NOT use this: its
 * result carries a stake (single, gammon, backgammon) and a cube value, which
 * this shape deliberately has no room for.
 *
 * `reason` is a short machine token, not copy: stage 2 maps it to a Serbian and
 * an English sentence. Keeping it a token here is what stops a rules engine
 * from owning any user-facing string.
 */

/** Which seat plays: two-seat games use `0` (first to move) and `1`. */
export type Player = 0 | 1;

export interface Outcome {
  readonly status: "in_progress" | "win" | "draw";
  /** Defined exactly when `status` is `"win"`. */
  readonly winner: Player | null;
  /**
   * Machine token: `"line"`, `"no-moves"`, `"board-full"`, `"no-progress"`,
   * `"repetition"`, `"pieces"`. `null` while the game is in progress.
   */
  readonly reason: string | null;
}

export const IN_PROGRESS: Outcome = { status: "in_progress", winner: null, reason: null };

export function win(winner: Player, reason: string): Outcome {
  return { status: "win", winner, reason };
}

export function draw(reason: string): Outcome {
  return { status: "draw", winner: null, reason };
}
