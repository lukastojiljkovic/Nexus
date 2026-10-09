/**
 * Draughts (`Dama`) — 8x8, twelve pieces a side, on the dark squares, with
 * compulsory capture. Two rule sets, chosen by an option:
 *
 * - `english` — English draughts (American checkers): a man MOVES forward one
 *   square and CAPTURES forward only; a king moves and captures one square in
 *   any of the four diagonals; a man that reaches the crown row is crowned
 *   there and the move ends, so a capture it could continue is not played; a
 *   capture is compulsory but the CHOICE of capture is free, because English
 *   draughts has no maximum-capture rule.
 * - `russian` — Russian draughts (draughts-64): a man captures forwards and
 *   backwards (it still only moves forwards); kings fly — they move any
 *   distance along a diagonal and capture a piece any distance away provided
 *   every square between is empty; the MAXIMUM number of pieces must be taken;
 *   and a man that reaches the crown row during a capture is crowned there and
 *   goes on capturing as a king, which is the rule that makes a Russian
 *   sequence longer than the move that created it.
 *
 * Rules source: the World Checkers Draughts Federation's rules for English
 * draughts, and the FMJD Section 64 rules for draughts-64, which is the 8x8
 * game with flying kings. Where the two differ, the difference is the option
 * above and nothing else.
 *
 * In BOTH rule sets a capture is taken as it is made — the jumped piece leaves
 * the board before the next jump is chosen, so a piece can never be jumped
 * twice. (Pieces that stay on the board until the move ends, and the "Turkish
 * strike" that follows from that, belong to international draughts on the
 * 10x10 board.)
 *
 * Draws are the two no-progress rules, counted in plies: `english` draws after
 * forty moves by each side without a capture and without a man being moved (the
 * forty-move rule); `russian` draws after fifteen moves by each side of kings
 * alone (draughts-64's fifteen-move rule). Both counters live on the state, so
 * `result` can answer from the state alone. The threefold-repetition rule is NOT
 * here for that same reason — it needs the game's move history, which stage 2
 * holds — and `draughtsPositionKey` is the position key it counts.
 *
 * Pure: no I/O, no clock, no `Math.random`. `bestMove` takes the caller's
 * seeded `SeededRandom` for its equal-move tie-break.
 */

import { InvalidStateError } from "../boards-shared/errors.js";
import { IN_PROGRESS, draw, win } from "../boards-shared/outcome.js";
import type { Outcome, Player } from "../boards-shared/outcome.js";
import type { SeededRandom } from "../random.js";
import { search } from "../boards-shared/search.js";
import type { Choice, SearchGame, SearchLimits } from "../boards-shared/search.js";

export const DRAUGHTS_SIZE = 8;
/** The playable (dark) squares of an 8x8 board. */
export const DRAUGHTS_SQUARES = 32;
export const DRAUGHTS_MEN_PER_SIDE = 12;

/**
 * `0` empty, `1` seat 0's man, `2` seat 0's king, `3` seat 1's man, `4` seat
 * 1's king. A number rather than an object because the board is 32 cells and
 * the search copies it at every node.
 */
export type DraughtsPiece = 0 | 1 | 2 | 3 | 4;

/** The two rule sets; see the header for the difference between them. */
export type DraughtsKind = "english" | "russian";

export interface DraughtsState {
  /** The 32 dark squares, index `row * 4 + column / 2`; row 0 is at the bottom. */
  readonly squares: readonly DraughtsPiece[];
  readonly toMove: Player;
  readonly kind: DraughtsKind;
  /**
   * Plies since the last capture or the last move by a man — the counter both
   * draw rules read. Reset to `0` by any capture and by any man's move, so it
   * measures exactly "only kings have moved".
   */
  readonly sinceProgress: number;
}

/**
 * A step, or a whole capture sequence. A capture is ONE move however many
 * pieces it takes, because a man must go on jumping while it can: `from` is
 * where the piece stood and `path` the squares it landed on, in order, so
 * `path.length` is the number of pieces taken.
 */
export type DraughtsMove =
  | { readonly kind: "step"; readonly from: number; readonly to: number }
  | { readonly kind: "capture"; readonly from: number; readonly path: readonly number[] };

export interface DraughtsOptions {
  readonly squares?: readonly DraughtsPiece[] | undefined;
  readonly toMove?: Player | undefined;
  readonly kind?: DraughtsKind | undefined;
  readonly sinceProgress?: number | undefined;
}

/** One difficulty: how deep the search may go and how many nodes it may visit. */
export type DraughtsLevel = SearchLimits;

/**
 * Three levels, a full-width alpha-beta search with the evaluation below:
 * level 1 sees its own move and the reply, level 2 four plies, level 3 six. The
 * budgets are hard caps; see the report for what each level costs per move.
 */
export const DRAUGHTS_LEVELS: readonly DraughtsLevel[] = [
  { depth: 2, nodeBudget: 5_000 },
  { depth: 4, nodeBudget: 40_000 },
  { depth: 6, nodeBudget: 150_000 },
];

/**
 * The English forty-move rule and the draughts-64 fifteen-move rule, in plies:
 * a "move" in both texts is one side's move, and a ply is one side's move.
 */
export const DRAUGHTS_DRAW_PLIES: Readonly<Record<DraughtsKind, number>> = {
  english: 80,
  russian: 30,
};

/** The dark square at `(row, column)`, or `null` when that square is not playable. */
export function draughtsSquareAt(row: number, column: number): number | null {
  if (row < 0 || row >= DRAUGHTS_SIZE || column < 0 || column >= DRAUGHTS_SIZE) return null;
  if ((row + column) % 2 !== 0) return null;
  return row * 4 + (column >> 1);
}

export function draughtsSquare(row: number, column: number): number {
  return row * 4 + (column >> 1);
}

export function draughtsRow(square: number): number {
  return square >> 2;
}

/** Column of a square: 0, 2, 4, 6 on the even rows and 1, 3, 5, 7 on the odd. */
export function draughtsColumn(square: number): number {
  return ((square & 3) << 1) | ((square >> 2) & 1);
}

/** The seat that owns a piece, or `null` for an empty square. */
export function draughtsOwner(piece: DraughtsPiece): Player | null {
  if (piece === 0) return null;
  return piece <= 2 ? 0 : 1;
}

export function draughtsIsKing(piece: DraughtsPiece): boolean {
  return piece === 2 || piece === 4;
}

/** The piece a man of `player` becomes when it reaches the crown row. */
export function draughtsKing(player: Player): DraughtsPiece {
  return player === 0 ? 2 : 4;
}

/** The piece a man of `player` starts as. */
export function draughtsMan(player: Player): DraughtsPiece {
  return player === 0 ? 1 : 3;
}

export function draughtsOpponent(player: Player): Player {
  return player === 0 ? 1 : 0;
}

/** The row a man of `player` is crowned on: seat 0 walks up the board, seat 1 down. */
function crownRow(player: Player): number {
  return player === 0 ? DRAUGHTS_SIZE - 1 : 0;
}

/** The row delta a man of `player` moves by. */
function forward(player: Player): number {
  return player === 0 ? 1 : -1;
}

const DIAGONALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** The 32-square opening: twelve men a side, seat 0 on the bottom three rows. */
export function initialState(options: DraughtsOptions = {}): DraughtsState {
  const kind = options.kind ?? "english";
  if (kind !== "english" && kind !== "russian") throw new InvalidStateError("kind");
  const toMove = options.toMove ?? 0;
  if (toMove !== 0 && toMove !== 1) throw new InvalidStateError("toMove");
  const squares = options.squares ?? openingSquares();
  if (squares.length !== DRAUGHTS_SQUARES) throw new InvalidStateError("squares-length");
  const counts: [number, number] = [0, 0];
  for (const piece of squares) {
    if (piece !== 0 && piece !== 1 && piece !== 2 && piece !== 3 && piece !== 4) {
      throw new InvalidStateError("squares-piece");
    }
    const owner = draughtsOwner(piece);
    if (owner !== null) counts[owner] += 1;
  }
  // A side never gains a piece, so more than twelve is not a draughts position.
  if (counts[0] > DRAUGHTS_MEN_PER_SIDE || counts[1] > DRAUGHTS_MEN_PER_SIDE) {
    throw new InvalidStateError("squares-count");
  }
  const sinceProgress = options.sinceProgress ?? 0;
  if (!Number.isInteger(sinceProgress) || sinceProgress < 0) {
    throw new InvalidStateError("sinceProgress");
  }
  return { squares: squares.slice(), toMove, kind, sinceProgress };
}

function openingSquares(): DraughtsPiece[] {
  const squares = new Array<DraughtsPiece>(DRAUGHTS_SQUARES).fill(0);
  for (let square = 0; square < DRAUGHTS_SQUARES; square += 1) {
    const row = draughtsRow(square);
    if (row <= 2) squares[square] = 1;
    else if (row >= 5) squares[square] = 3;
  }
  return squares;
}

/** The squares `player` still has a piece on, ascending — the move order is fixed. */
function piecesOf(squares: readonly DraughtsPiece[], player: Player): number[] {
  const mine: number[] = [];
  for (let square = 0; square < DRAUGHTS_SQUARES; square += 1) {
    if (draughtsOwner(squares[square] as DraughtsPiece) === player) mine.push(square);
  }
  return mine;
}

/**
 * The one square of `board` occupied strictly between two squares of a single
 * diagonal — the piece a jump takes. `null` when the two are not on a diagonal
 * or when the space between them does not hold exactly one piece, which is what
 * a flying king needs: every square between is empty except the one it takes.
 */
function jumpedSquare(
  board: readonly DraughtsPiece[],
  from: number,
  to: number,
): number | null {
  const row = draughtsRow(from);
  const column = draughtsColumn(from);
  const dr = Math.sign(draughtsRow(to) - row);
  const dc = Math.sign(draughtsColumn(to) - column);
  if (dr === 0 || dc === 0) return null;
  let r = row + dr;
  let c = column + dc;
  let found: number | null = null;
  let occupied = 0;
  while (r !== draughtsRow(to) || c !== draughtsColumn(to)) {
    const square = draughtsSquare(r, c);
    if ((board[square] as DraughtsPiece) !== 0) {
      found = square;
      occupied += 1;
    }
    r += dr;
    c += dc;
  }
  return occupied === 1 ? found : null;
}

/**
 * Every jump `piece` may make from `at`, as `over` (the piece taken) and `land`.
 * A man jumps forward only under `english`; under `russian` a man jumps either
 * way and a king jumps any distance along an open diagonal.
 */
function jumpOptions(
  board: readonly DraughtsPiece[],
  kind: DraughtsKind,
  player: Player,
  at: number,
  piece: DraughtsPiece,
): { over: number; land: number }[] {
  const options: { over: number; land: number }[] = [];
  const row = draughtsRow(at);
  const column = draughtsColumn(at);
  const king = draughtsIsKing(piece);
  for (const [dr, dc] of DIAGONALS) {
    if (!king && kind === "english" && dr !== forward(player)) continue;
    if (king && kind === "russian") {
      // The first occupied square outward is the piece to take, and every empty
      // square beyond it is a landing square.
      let r = row + dr;
      let c = column + dc;
      for (;;) {
        const over = draughtsSquareAt(r, c);
        if (over === null) break;
        const occupant = board[over] as DraughtsPiece;
        const owner = draughtsOwner(occupant);
        if (owner === null) {
          r += dr;
          c += dc;
          continue;
        }
        if (owner === player) break;
        let lr = r + dr;
        let lc = c + dc;
        for (;;) {
          const land = draughtsSquareAt(lr, lc);
          if (land === null || board[land] !== 0) break;
          options.push({ over, land });
          lr += dr;
          lc += dc;
        }
        break;
      }
      continue;
    }
    const over = draughtsSquareAt(row + dr, column + dc);
    const land = draughtsSquareAt(row + 2 * dr, column + 2 * dc);
    if (over === null || land === null) continue;
    const occupant = board[over] as DraughtsPiece;
    if (draughtsOwner(occupant) !== draughtsOpponent(player)) continue;
    if (board[land] !== 0) continue;
    options.push({ over, land });
  }
  return options;
}

/**
 * Every complete capture sequence from `at`, as landing paths. A capture is
 * taken as it is made (`board[over]` is cleared before the next choice), which
 * is the whole reason a piece can never be taken twice, and under `english` a
 * man crowned mid-sequence stops there.
 */
function extendCaptures(
  board: DraughtsPiece[],
  kind: DraughtsKind,
  player: Player,
  at: number,
  piece: DraughtsPiece,
  path: number[],
  out: number[][],
): void {
  const options = jumpOptions(board, kind, player, at, piece);
  if (options.length === 0) {
    if (path.length > 0) out.push(path.slice());
    return;
  }
  for (const { over, land } of options) {
    const taken = board[over] as DraughtsPiece;
    const crowned = !draughtsIsKing(piece) && draughtsRow(land) === crownRow(player);
    const next = crowned ? draughtsKing(player) : piece;
    board[over] = 0;
    board[at] = 0;
    board[land] = next;
    path.push(land);
    if (crowned && kind === "english") {
      out.push(path.slice());
    } else {
      extendCaptures(board, kind, player, land, next, path, out);
    }
    path.pop();
    board[land] = 0;
    board[at] = piece;
    board[over] = taken;
  }
}

/** Every step `piece` may make from `at` — no capture exists in the position. */
function stepOptions(
  board: readonly DraughtsPiece[],
  kind: DraughtsKind,
  player: Player,
  at: number,
  piece: DraughtsPiece,
): number[] {
  const steps: number[] = [];
  const row = draughtsRow(at);
  const column = draughtsColumn(at);
  const king = draughtsIsKing(piece);
  for (const [dr, dc] of DIAGONALS) {
    if (!king && dr !== forward(player)) continue;
    if (king && kind === "russian") {
      let r = row + dr;
      let c = column + dc;
      for (;;) {
        const land = draughtsSquareAt(r, c);
        if (land === null || board[land] !== 0) break;
        steps.push(land);
        r += dr;
        c += dc;
      }
      continue;
    }
    const land = draughtsSquareAt(row + dr, column + dc);
    if (land !== null && board[land] === 0) steps.push(land);
  }
  return steps;
}

function captureMoves(state: DraughtsState): DraughtsMove[] {
  // One working copy for the whole scan: every `extendCaptures` call restores
  // what it changed, so the copy is exactly `state.squares` again afterwards.
  const board = state.squares.slice();
  const captures: DraughtsMove[] = [];
  for (const from of piecesOf(state.squares, state.toMove)) {
    const paths: number[][] = [];
    extendCaptures(board, state.kind, state.toMove, from, board[from] as DraughtsPiece, [], paths);
    for (const path of paths) captures.push({ kind: "capture", from, path });
  }
  return captures;
}

/**
 * The moves of the side to move: every capture when one exists (compulsory
 * capture in both rule sets), and under `russian` only the longest of them.
 * Otherwise every step. An empty list means the side to move has lost.
 */
export function legalMoves(state: DraughtsState): DraughtsMove[] {
  const captures = captureMoves(state);
  if (captures.length === 0) return stepMoves(state);
  if (state.kind !== "russian") return captures;
  const most = longestCapture(captures);
  return captures.filter((capture) => capture.kind === "capture" && capture.path.length === most);
}

/** The number of pieces the longest capture takes, `0` when there is none. */
function longestCapture(captures: readonly DraughtsMove[]): number {
  let most = 0;
  for (const capture of captures) {
    if (capture.kind === "capture" && capture.path.length > most) most = capture.path.length;
  }
  return most;
}

/** Every step the side to move may make; only reached when no capture exists. */
function stepMoves(state: DraughtsState): DraughtsMove[] {
  const steps: DraughtsMove[] = [];
  for (const from of piecesOf(state.squares, state.toMove)) {
    const piece = state.squares[from] as DraughtsPiece;
    for (const to of stepOptions(state.squares, state.kind, state.toMove, from, piece)) {
      steps.push({ kind: "step", from, to });
    }
  }
  return steps;
}

function sameMove(a: DraughtsMove, b: DraughtsMove): boolean {
  if (a.kind !== b.kind || a.from !== b.from) return false;
  if (a.kind === "step" && b.kind === "step") return a.to === b.to;
  if (a.kind === "capture" && b.kind === "capture") {
    return a.path.length === b.path.length && a.path.every((square, i) => square === b.path[i]);
  }
  return false;
}

export function applyMove(state: DraughtsState, move: DraughtsMove): DraughtsState {
  const captures = captureMoves(state);
  const most = longestCapture(captures);
  const legal: DraughtsMove[] =
    captures.length === 0
      ? stepMoves(state)
      : state.kind === "russian"
        ? captures.filter((capture) => capture.kind === "capture" && capture.path.length === most)
        : captures;
  const match = legal.find((candidate) => sameMove(candidate, move));
  if (match === undefined) {
    // The refusals are named rather than lumped together: stage 2 passes
    // untrusted input here, and "you had to take" is a different answer from
    // "there is no such move".
    if (move.kind === "step" && captures.length > 0) {
      throw new InvalidStateError("capture-available");
    }
    if (move.kind === "capture") {
      const own = captures.filter(
        (capture): capture is Extract<DraughtsMove, { kind: "capture" }> =>
          capture.kind === "capture" && capture.from === move.from,
      );
      // Ending a sequence while it could be continued is not a shorter capture,
      // it is an unfinished one, and that is the answer for both rule sets.
      const unfinished = own.some(
        (capture) =>
          capture.path.length > move.path.length &&
          move.path.every((square, index) => square === capture.path[index]),
      );
      if (unfinished) throw new InvalidStateError("capture-incomplete");
      // Taking fewer pieces than the rules allow, while taking all the pieces
      // this one piece could take, is the maximum-capture refusal.
      const complete = own.some(
        (capture) =>
          capture.path.length === move.path.length &&
          capture.path.every((square, index) => square === move.path[index]),
      );
      if (state.kind === "russian" && complete && move.path.length < most) {
        throw new InvalidStateError("capture-not-maximal");
      }
    }
    throw new InvalidStateError("illegal");
  }

  const squares = state.squares.slice();
  const piece = state.squares[move.from] as DraughtsPiece;
  const wasMan = !draughtsIsKing(piece);
  squares[move.from] = 0;
  if (move.kind === "step") {
    squares[move.to] =
      wasMan && draughtsRow(move.to) === crownRow(state.toMove) ? draughtsKing(state.toMove) : piece;
  } else {
    let previous = move.from;
    for (const landing of move.path) {
      // Read the board as the sequence has left it so far, not the board it
      // started from: a flying king may cross a square this same move has
      // already cleared, and that square is no longer a piece to take.
      const taken = jumpedSquare(squares, previous, landing);
      if (taken === null) throw new InvalidStateError("illegal");
      squares[taken] = 0;
      previous = landing;
    }
    // A man crowned anywhere along the path finished the move a king, whether
    // or not the last jump landed back off the crown row (russian only: under
    // english a crowning jump ends the sequence there).
    const crowned = move.path.some((landing) => draughtsRow(landing) === crownRow(state.toMove));
    squares[move.path[move.path.length - 1] as number] = crowned ? draughtsKing(state.toMove) : piece;
  }
  const progress = move.kind === "capture" || wasMan;
  return {
    squares,
    toMove: draughtsOpponent(state.toMove),
    kind: state.kind,
    sinceProgress: progress ? 0 : state.sinceProgress + 1,
  };
}

/**
 * The position alone, as a key: stage 2 counts repetitions of it. The counters
 * are deliberately NOT in it — the same position arrives with a different
 * `sinceProgress` and is still the same position.
 */
export function draughtsPositionKey(state: DraughtsState): string {
  return `${state.kind}:${state.toMove}:${state.squares.join("")}`;
}

export function result(state: DraughtsState): Outcome {
  if (piecesOf(state.squares, state.toMove).length === 0) {
    return win(draughtsOpponent(state.toMove), "pieces");
  }
  if (legalMoves(state).length === 0) return win(draughtsOpponent(state.toMove), "no-moves");
  if (state.sinceProgress >= (DRAUGHTS_DRAW_PLIES[state.kind] as number)) {
    return draw("no-progress");
  }
  return IN_PROGRESS;
}

/** The score a finished game is worth, far above every position score below. */
const MATE = 100_000;

/**
 * Our own evaluation, and deliberately not a table of published piece-square
 * values: a man is worth 100 and a king 175 (a king is not quite two men,
 * because a man close to crowning is nearly one already), a man gains `ADVANCE`
 * for every row it has travelled toward the crown row, and a man left on its own
 * back row is worth `BACK_ROW` more because it is what stops the opponent
 * crowning. Non-terminal scores stay under a seventh of `MATE`.
 */
const MAN = 100;
const KING = 175;
const ADVANCE = 3;
const BACK_ROW = 10;

export function evaluate(state: DraughtsState): number {
  const opponent = draughtsOpponent(state.toMove);
  const mine = piecesOf(state.squares, state.toMove).length;
  const theirs = piecesOf(state.squares, opponent).length;
  if (theirs === 0) return MATE;
  if (mine === 0) return -MATE;
  let score = 0;
  for (let square = 0; square < DRAUGHTS_SQUARES; square += 1) {
    const piece = state.squares[square] as DraughtsPiece;
    const owner = draughtsOwner(piece);
    if (owner === null) continue;
    const row = draughtsRow(square);
    const crowned = draughtsIsKing(piece);
    let value = crowned ? KING : MAN;
    if (!crowned) {
      const travelled = owner === 0 ? row : DRAUGHTS_SIZE - 1 - row;
      value += ADVANCE * travelled;
      if (row === (owner === 0 ? 0 : DRAUGHTS_SIZE - 1)) value += BACK_ROW;
    }
    score += owner === state.toMove ? value : -value;
  }
  if (legalMoves(state).length === 0) return -MATE;
  return score;
}

/** Captures first and longest first: the moves that decide a draughts game. */
const GAME: SearchGame<DraughtsState, DraughtsMove> = {
  legalMoves,
  applyMove,
  isTerminal: (state) => result(state).status !== "in_progress",
  evaluate,
  orderMoves: (state, moves) =>
    // Captures first, longest first; then the step that has travelled furthest,
    // which for seat 1 is the LOWEST row and so needs the sign of its seat.
    moves
      .slice()
      .sort(
        (a, b) =>
          lengthOf(b) - lengthOf(a) ||
          travelled(state.toMove, b) - travelled(state.toMove, a),
      ),
};

function lengthOf(move: DraughtsMove): number {
  return move.kind === "capture" ? move.path.length : 0;
}

function travelled(player: Player, move: DraughtsMove): number {
  const to = move.kind === "step" ? move.to : (move.path[move.path.length - 1] as number);
  const row = draughtsRow(to);
  return player === 0 ? row : DRAUGHTS_SIZE - 1 - row;
}

function levelLimits(level: number): DraughtsLevel {
  const index = Math.min(Math.max(Math.floor(level), 1), DRAUGHTS_LEVELS.length) - 1;
  return DRAUGHTS_LEVELS[index] as DraughtsLevel;
}

/**
 * The computer's move. `level` is 1..3, anything outside is clamped. The
 * returned `Choice.move` is always legal (or `null` on a finished game), and
 * `Choice.nodes` never exceeds the level's budget.
 */
export function bestMove(state: DraughtsState, level: number, rng: SeededRandom): Choice<DraughtsMove> {
  return search(GAME, state, levelLimits(level), rng);
}

/** The shape `toJSON` writes and `fromJSON` accepts. */
export interface DraughtsJson {
  readonly squares: readonly DraughtsPiece[];
  readonly toMove: Player;
  readonly kind: DraughtsKind;
  readonly sinceProgress: number;
}

export function toJSON(state: DraughtsState): DraughtsJson {
  return {
    squares: state.squares.slice(),
    toMove: state.toMove,
    kind: state.kind,
    sinceProgress: state.sinceProgress,
  };
}

export function fromJSON(value: unknown): DraughtsState {
  if (typeof value !== "object" || value === null) throw new InvalidStateError("json");
  const record = value as Record<string, unknown>;
  const squares = record["squares"];
  if (!Array.isArray(squares)) throw new InvalidStateError("squares");
  const kind = record["kind"];
  if (kind !== "english" && kind !== "russian") throw new InvalidStateError("kind");
  const toMove = record["toMove"];
  if (toMove !== 0 && toMove !== 1) throw new InvalidStateError("toMove");
  const sinceProgress = record["sinceProgress"];
  if (typeof sinceProgress !== "number") throw new InvalidStateError("sinceProgress");
  return initialState({
    squares: squares as readonly DraughtsPiece[],
    toMove,
    kind,
    sinceProgress,
  });
}
