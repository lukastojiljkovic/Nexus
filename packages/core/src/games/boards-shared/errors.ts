/**
 * The one error a board-game engine throws: a state, a move or a saved game
 * that the rules do not admit. Stage 2 passes untrusted input (a file on disk,
 * a message from the renderer) straight into `fromJSON` and `applyMove`, so
 * both refuse rather than coerce, and the caller sees this type.
 *
 * `problem` is a short machine token (`"column-full"`, `"cells"`, â€¦), never
 * copy: the sentence a user reads is stage 2's.
 */
export class InvalidStateError extends Error {
  readonly problem: string;

  constructor(problem: string) {
    super(`invalid game state: ${problem}`);
    this.name = "InvalidStateError";
    this.problem = problem;
  }
}
