/**
 * Nine men's morris (`Mlin`) — 24 points on three nested squares, nine pieces
 * a side, and mills of three in a line.
 *
 * Rules source: there is no governing federation, so the rule set here is the
 * standard game as it is printed in the game's literature — the placement
 * phase, the mill and its removal, the moving phase, flying, and the two
 * losses. Our own choices are named where they are made, and the one that is
 * ours alone is the draw rule below.
 *
 * - Placing: the sides alternate placing one piece on any EMPTY point, nine
 *   each. A side that has placed its nine goes on to the moving phase while the
 *   opponent is still placing, which is the standard reading and the reason a
 *   side's phase is a property of that side and not of the game.
 * - A mill is three of one side's pieces on the three points of one of the
 *   board's sixteen lines. Forming one removes an opponent's piece from the
 *   board, and the removal is part of the SAME move — see below for why.
 * - Removal: never a piece that stands in a mill, unless EVERY opponent piece
 *   stands in a mill, in which case any of them may go. When the opponent has
 *   nothing on the board there is no removal at all.
 * - Moving: a piece walks along a line to an adjacent empty point. Flying: a
 *   side reduced to three pieces may move a piece to ANY empty point.
 * - A side loses at two pieces or fewer once its hand is empty, or when it has
 *   no legal move.
 * - Draw: a game in which nothing has been removed for `MLIN_DRAW_PLIES` plies
 *   (thirty moves each) is a draw. This rule is OURS: the standard game states
 *   no draw rule, a three-piece-each endgame is a known fortress, and the
 *   alternative is a game that cannot end by itself. Repetition is not counted
 *   here, because `result` reads the state alone; `mlinPositionKey` is exported
 *   for stage 2, which holds the move history and can count it.
 *
 * WHY THE REMOVAL RIDES ALONG WITH THE MILL. The obvious model is a turn that
 * does not pass: the mover forms a mill, and plays again to take a piece. That
 * model breaks negamax, which is what `boards-shared/search.ts` is: it flips
 * the sign of a child's score because the OTHER side is to move there, so a
 * turn that never passed would be scored as if it had. A mill-forming move here
 * therefore carries `remove` — the point it takes — and every move once again
 * ends with the other side to move. Stage 2 draws the mill being formed and the
 * piece being taken from the two halves of one move; no rule changes.
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

export const MLIN_POINTS = 24;
export const MLIN_PER_SIDE = 9;
/** Three pieces on a line. */
export const MLIN_MILL = 3;

/** Point contents: `0` empty, `1` seat 0's piece, `2` seat 1's piece. */
export type MlinPoint = 0 | 1 | 2;

export interface MlinState {
  /** The 24 points, numbered as the board is drawn — see `MLIN_NEIGHBOURS`. */
  readonly points: readonly MlinPoint[];
  readonly toMove: Player;
  /** How many pieces each side has placed; `MLIN_PER_SIDE` ends its placing. */
  readonly placed: readonly [number, number];
  /** Plies since the last removal — the counter our draw rule reads. */
  readonly sinceProgress: number;
}

/**
 * Placing a piece, or walking one along a line. `remove` is the opponent's
 * piece this move takes, and is non-`null` exactly when the move forms a mill
 * and the opponent has something on the board to take.
 */
export type MlinMove =
  | { readonly kind: "place"; readonly point: number; readonly remove: number | null }
  | {
      readonly kind: "move";
      readonly from: number;
      readonly to: number;
      readonly remove: number | null;
    };

export interface MlinOptions {
  readonly points?: readonly MlinPoint[] | undefined;
  readonly toMove?: Player | undefined;
  readonly placed?: readonly [number, number] | undefined;
  readonly sinceProgress?: number | undefined;
}

/** One difficulty: how deep the search may go and how many nodes it may visit. */
export type MlinLevel = SearchLimits;

/**
 * Three levels, a full-width alpha-beta search with the evaluation below:
 * level 1 sees a move and its reply, level 2 four plies, level 3 five. Six was
 * measured and dropped: placing has twenty-odd branches, and on this machine a
 * sixth ply cost about 200 ms a move against about 50 for the fifth, for a
 * difference the evaluation below does not make good use of. `Choice.cut` says
 * when the budget — not the depth — ended the search.
 */
export const MLIN_LEVELS: readonly MlinLevel[] = [
  { depth: 2, nodeBudget: 5_000 },
  { depth: 4, nodeBudget: 40_000 },
  { depth: 5, nodeBudget: 60_000 },
];

/**
 * The draw rule: thirty moves by each side with nothing removed. Ours, for the
 * reason in the header.
 */
export const MLIN_DRAW_PLIES = 60;

/**
 * The board, as it is drawn: three nested squares whose side midpoints are
 * joined by a line. The outer square is 0-1-2, 21-22-23, 0-9-21 and 2-14-23;
 * the middle one 3-4-5, 18-19-20, 3-10-18 and 5-13-20; the inner one 6-7-8,
 * 15-16-17, 6-11-15 and 8-12-17; and the four arms are 9-10-11, 12-13-14,
 * 1-4-7 and 16-19-22. Point 0 is the top-left corner and point 23 the
 * bottom-right.
 *
 * **The table is exactly the union of those sixteen lines' consecutive pairs,
 * and four entries used to carry one edge more.** Points 18 and 21 (the middle
 * and the outer square's bottom-left corners) and 20 and 23 (their bottom-right
 * ones) were each listed as neighbours of the other, which no line of the drawn
 * board joins: a piece at an outer corner can walk to the two points beside it
 * on its own square's edges and to nothing else, and the asymmetry said so on its
 * own — the top-left corner 0 has two neighbours while the bottom-left 21 had
 * three. Stage 2 found it while drawing the board (both corners agreed on the
 * picture and disagreed with the rules), and
 * `games/boards/protocol.test.ts`'s lattice case is the regression test: it fails
 * on the four entries above and passes on the sixteen lines.
 */
export const MLIN_NEIGHBOURS: readonly (readonly number[])[] = [
  [1, 9],
  [0, 2, 4],
  [1, 14],
  [4, 10],
  [1, 3, 5, 7],
  [4, 13],
  [7, 11],
  [4, 6, 8],
  [7, 12],
  [0, 10, 21],
  [3, 9, 11, 18],
  [6, 10, 15],
  [8, 13, 17],
  [5, 12, 14, 20],
  [2, 13, 23],
  [11, 16],
  [15, 17, 19],
  [12, 16],
  [10, 19],
  [16, 18, 20, 22],
  [13, 19],
  [9, 22],
  [19, 21, 23],
  [14, 22],
];

/** The board's sixteen mills, each as the three points of one line. */
export const MLIN_MILLS: readonly (readonly number[])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [9, 10, 11],
  [12, 13, 14],
  [15, 16, 17],
  [18, 19, 20],
  [21, 22, 23],
  [0, 9, 21],
  [3, 10, 18],
  [6, 11, 15],
  [1, 4, 7],
  [8, 12, 17],
  [16, 19, 22],
  [5, 13, 20],
  [2, 14, 23],
];

export function mlinPiece(player: Player): MlinPoint {
  return (player + 1) as MlinPoint;
}

export function mlinOpponent(player: Player): Player {
  return player === 0 ? 1 : 0;
}

/** How many pieces `player` has on the board. */
export function mlinOnBoard(points: readonly MlinPoint[], player: Player): number {
  const piece = mlinPiece(player);
  let count = 0;
  for (const point of points) if (point === piece) count += 1;
  return count;
}

/** How many pieces `player` still has in hand. */
export function mlinInHand(state: MlinState, player: Player): number {
  return MLIN_PER_SIDE - (state.placed[player] as number);
}

/** Every complete mill `player` holds. */
export function mlinMills(points: readonly MlinPoint[], player: Player): number[][] {
  const piece = mlinPiece(player);
  const mills: number[][] = [];
  for (const mill of MLIN_MILLS) {
    if (
      points[mill[0] as number] === piece &&
      points[mill[1] as number] === piece &&
      points[mill[2] as number] === piece
    ) {
      mills.push([...(mill as readonly number[])]);
    }
  }
  return mills;
}

/** The points of `player` that stand in a mill, ascending and without repeats. */
export function mlinPointsInMills(points: readonly MlinPoint[], player: Player): number[] {
  const inMill = new Set<number>();
  for (const mill of mlinMills(points, player)) for (const point of mill) inMill.add(point);
  return [...inMill].sort((a, b) => a - b);
}

/**
 * True when a piece of `player` standing on `point` completes a mill. `vacated`
 * is the square a moving-phase move leaves, treated as empty: a mill cannot be
 * completed by a piece that is walking away from one of its own points.
 */
function completesMill(
  points: readonly MlinPoint[],
  player: Player,
  point: number,
  vacated: number | null,
): boolean {
  const piece = mlinPiece(player);
  for (const mill of MLIN_MILLS) {
    if (!mill.includes(point)) continue;
    let complete = true;
    for (const other of mill) {
      if (other === point) continue;
      if (other === vacated) {
        complete = false;
        continue;
      }
      if (points[other as number] !== piece) complete = false;
    }
    if (complete) return true;
  }
  return false;
}

/** The opening: an empty board, both sides to place nine. */
export function initialState(options: MlinOptions = {}): MlinState {
  const points = options.points ?? new Array<MlinPoint>(MLIN_POINTS).fill(0);
  if (points.length !== MLIN_POINTS) throw new InvalidStateError("points-length");
  for (const point of points) {
    if (point !== 0 && point !== 1 && point !== 2) throw new InvalidStateError("points-point");
  }
  const toMove = options.toMove ?? 0;
  if (toMove !== 0 && toMove !== 1) throw new InvalidStateError("toMove");
  const placed = options.placed ?? ([0, 0] as const);
  if (placed.length !== 2) throw new InvalidStateError("placed-length");
  for (let seat = 0; seat < 2; seat += 1) {
    const count = placed[seat] as number;
    if (!Number.isInteger(count) || count < 0 || count > MLIN_PER_SIDE) {
      throw new InvalidStateError("placed");
    }
    // A side cannot have more pieces out than it has placed.
    if (mlinOnBoard(points, seat as Player) > count) throw new InvalidStateError("placed-board");
  }
  const sinceProgress = options.sinceProgress ?? 0;
  if (!Number.isInteger(sinceProgress) || sinceProgress < 0) {
    throw new InvalidStateError("sinceProgress");
  }
  return { points: points.slice(), toMove, placed: [placed[0], placed[1]], sinceProgress };
}

/** The opponent's pieces that may be taken, ascending; empty when none stand. */
function removablePoints(state: MlinState): number[] {
  const opponent = mlinOpponent(state.toMove);
  const piece = mlinPiece(opponent);
  const theirs: number[] = [];
  for (let point = 0; point < MLIN_POINTS; point += 1) {
    if (state.points[point] === piece) theirs.push(point);
  }
  if (theirs.length === 0) return [];
  const inMills = new Set(mlinPointsInMills(state.points, opponent));
  const outside = theirs.filter((point) => !inMills.has(point));
  // Every piece in a mill: any of them may go, which is the rule's escape hatch
  // and the only move left when a side is reduced to three pieces in a mill.
  return outside.length > 0 ? outside : theirs;
}

/** A side with an empty hand and exactly three pieces flies; more than three walks. */
export function mlinFlies(state: MlinState, player: Player): boolean {
  return mlinInHand(state, player) === 0 && mlinOnBoard(state.points, player) === MLIN_MILL;
}

/**
 * What a mill-forming move may take: the unprotected opponent pieces, or all of
 * them when every one is protected, or a single `null` for "nothing to take"
 * when the opponent has nothing on the board. A mill formed against a side
 * whose pieces are all still in hand owes no removal, rather than leaving the
 * mover with a move that has nothing to play.
 */
function removalChoices(state: MlinState): (number | null)[] {
  const pool = removablePoints(state);
  return pool.length > 0 ? pool : [null];
}

export function legalMoves(state: MlinState): MlinMove[] {
  const moves: MlinMove[] = [];
  if (mlinInHand(state, state.toMove) > 0) {
    const choices = removalChoices(state);
    for (let point = 0; point < MLIN_POINTS; point += 1) {
      if (state.points[point] !== 0) continue;
      if (completesMill(state.points, state.toMove, point, null)) {
        for (const remove of choices) moves.push({ kind: "place", point, remove });
      } else {
        moves.push({ kind: "place", point, remove: null });
      }
    }
    return moves;
  }
  const piece = mlinPiece(state.toMove);
  const choices = removalChoices(state);
  const flying = mlinFlies(state, state.toMove);
  for (let from = 0; from < MLIN_POINTS; from += 1) {
    if (state.points[from] !== piece) continue;
    const destinations: number[] = [];
    if (flying) {
      for (let to = 0; to < MLIN_POINTS; to += 1) {
        if (state.points[to] === 0) destinations.push(to);
      }
    } else {
      for (const to of MLIN_NEIGHBOURS[from] as readonly number[]) {
        if (state.points[to] === 0) destinations.push(to);
      }
    }
    for (const to of destinations) {
      if (completesMill(state.points, state.toMove, to, from)) {
        for (const remove of choices) moves.push({ kind: "move", from, to, remove });
      } else {
        moves.push({ kind: "move", from, to, remove: null });
      }
    }
  }
  return moves;
}

export function applyMove(state: MlinState, move: MlinMove): MlinState {
  const match = legalMoves(state).find((candidate) => sameMove(candidate, move));
  if (match === undefined) throw new InvalidStateError("illegal");
  const points = state.points.slice();
  const placed: [number, number] = [state.placed[0], state.placed[1]];
  if (move.kind === "place") {
    points[move.point] = mlinPiece(state.toMove);
    placed[state.toMove] = (placed[state.toMove] as number) + 1;
  } else {
    points[move.from] = 0;
    points[move.to] = mlinPiece(state.toMove);
  }
  if (move.remove !== null) points[move.remove] = 0;
  return {
    points,
    toMove: mlinOpponent(state.toMove),
    placed,
    // A removal is progress, and so is any moving-phase move; a bare placement
    // leaves the counter where it was, because placing cannot go on forever.
    sinceProgress:
      move.remove !== null ? 0 : move.kind === "move" ? state.sinceProgress + 1 : state.sinceProgress,
  };
}

function sameMove(a: MlinMove, b: MlinMove): boolean {
  if (a.kind !== b.kind || a.remove !== b.remove) return false;
  if (a.kind === "place" && b.kind === "place") return a.point === b.point;
  if (a.kind === "move" && b.kind === "move") return a.from === b.from && a.to === b.to;
  return false;
}

/**
 * The position alone: stage 2 counts repetitions of it. The counters are not in
 * it, for the reason draughts gives — the same position arrives with a
 * different counter and is still the same position.
 */
export function mlinPositionKey(state: MlinState): string {
  return `${state.toMove}:${state.placed[0]},${state.placed[1]}:${state.points.join("")}`;
}

export function result(state: MlinState): Outcome {
  const opponent = mlinOpponent(state.toMove);
  // Two pieces and an empty hand is the loss; three is not, because three fly.
  if (mlinInHand(state, state.toMove) === 0 && mlinOnBoard(state.points, state.toMove) <= 2) {
    return win(opponent, "pieces");
  }
  if (legalMoves(state).length === 0) return win(opponent, "no-moves");
  if (state.sinceProgress >= MLIN_DRAW_PLIES) return draw("no-progress");
  return IN_PROGRESS;
}

/** The score a finished game is worth, far above every position score below. */
const MATE = 10_000;

/**
 * Our own evaluation, and a scan of the sixteen lines and nothing else: a piece
 * on the board is 100, a complete mill is 25 on top of the three pieces in it,
 * and a line holding two of one side's pieces with its third point empty is 6.
 * That last term is what makes a position threaten rather than wait, and it is
 * why the search prefers a mill two thirds built over three loose pieces. The
 * search reads this at every leaf, so it does not ask for mobility.
 */
const PIECE = 100;
const MILL = 25;
const TWO_IN_LINE = 6;

export function evaluate(state: MlinState): number {
  const opponent = mlinOpponent(state.toMove);
  const mine = mlinOnBoard(state.points, state.toMove);
  const theirs = mlinOnBoard(state.points, opponent);
  if (mlinInHand(state, state.toMove) === 0 && mine <= 2) return -MATE;
  if (mlinInHand(state, opponent) === 0 && theirs <= 2) return MATE;
  if (legalMoves(state).length === 0) return -MATE;
  let score = PIECE * (mine - theirs);
  for (const mill of MLIN_MILLS) {
    let counting = 0;
    let empty = 0;
    let against = 0;
    for (const point of mill) {
      const occupant = state.points[point as number] as MlinPoint;
      if (occupant === mlinPiece(state.toMove)) counting += 1;
      else if (occupant === 0) empty += 1;
      else against += 1;
    }
    if (counting === MLIN_MILL) score += MILL;
    else if (counting === 2 && empty === 1) score += TWO_IN_LINE;
    if (against === MLIN_MILL) score -= MILL;
    else if (against === 2 && empty === 1) score -= TWO_IN_LINE;
  }
  return score;
}

/** What a point is worth to `player`: a mill first, then a line holding two. */
function pointOrder(points: readonly MlinPoint[], player: Player, point: number): number {
  const piece = mlinPiece(player);
  let value = 0;
  for (const mill of MLIN_MILLS) {
    if (!mill.includes(point)) continue;
    let mine = 0;
    let spare = 1;
    for (const other of mill) {
      if (other === point) continue;
      if (points[other as number] === piece) mine += 1;
      else if (points[other as number] !== 0) spare = 0;
    }
    value += mine * 2 + spare;
  }
  return value;
}

/** How good a move looks before it is searched: a mill first, then the rest. */
function orderValue(state: MlinState, move: MlinMove): number {
  const taken =
    move.remove === null
      ? 0
      : 40 + pointOrder(state.points, mlinOpponent(state.toMove), move.remove);
  if (move.kind === "place") return taken + pointOrder(state.points, state.toMove, move.point);
  return taken + pointOrder(state.points, state.toMove, move.to);
}

const GAME: SearchGame<MlinState, MlinMove> = {
  legalMoves,
  applyMove,
  isTerminal: (state) => result(state).status !== "in_progress",
  evaluate,
  orderMoves: (state, moves) =>
    moves.slice().sort((a, b) => orderValue(state, b) - orderValue(state, a)),
};

function levelLimits(level: number): MlinLevel {
  const index = Math.min(Math.max(Math.floor(level), 1), MLIN_LEVELS.length) - 1;
  return MLIN_LEVELS[index] as MlinLevel;
}

/**
 * The computer's move. `level` is 1..3, anything outside is clamped. The
 * returned `Choice.move` is always legal (or `null` on a finished game), and
 * `Choice.nodes` never exceeds the level's budget.
 */
export function bestMove(state: MlinState, level: number, rng: SeededRandom): Choice<MlinMove> {
  return search(GAME, state, levelLimits(level), rng);
}

/** The shape `toJSON` writes and `fromJSON` accepts. */
export interface MlinJson {
  readonly points: readonly MlinPoint[];
  readonly toMove: Player;
  readonly placed: readonly [number, number];
  readonly sinceProgress: number;
}

export function toJSON(state: MlinState): MlinJson {
  return {
    points: state.points.slice(),
    toMove: state.toMove,
    placed: [state.placed[0], state.placed[1]],
    sinceProgress: state.sinceProgress,
  };
}

export function fromJSON(value: unknown): MlinState {
  if (typeof value !== "object" || value === null) throw new InvalidStateError("json");
  const record = value as Record<string, unknown>;
  const points = record["points"];
  if (!Array.isArray(points)) throw new InvalidStateError("points");
  const toMove = record["toMove"];
  if (toMove !== 0 && toMove !== 1) throw new InvalidStateError("toMove");
  const placed = record["placed"];
  if (!Array.isArray(placed) || placed.length !== 2) throw new InvalidStateError("placed");
  const sinceProgress = record["sinceProgress"];
  if (typeof sinceProgress !== "number") throw new InvalidStateError("sinceProgress");
  return initialState({
    points: points as readonly MlinPoint[],
    toMove,
    placed: [placed[0] as number, placed[1] as number],
    sinceProgress,
  });
}
