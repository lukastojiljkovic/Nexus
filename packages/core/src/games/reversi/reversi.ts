/**
 * Reversi (`Reversi`) — the 8x8 disc-flipping game: two seats, a disc placed
 * only where it brackets at least one enemy disc, every bracketed disc turned
 * over, a side with nowhere to play passing, and the game decided on the disc
 * count once neither side can play.
 *
 * Rules source: the World Othello Federation's *Laws of Othello*
 * (worldothello.org), which is the rule text for the game as it is played in
 * competition — placement, turning over in all eight directions, passing,
 * the end of the game and the counting. The game is called `reversi` here and
 * *Reversi* in the copy, never *Othello*: that is a trademark, and no rule
 * depends on it.
 *
 * Pure: no I/O, no clock, no `Math.random`. Nothing here depends on time, and
 * `bestMove` takes the caller's seeded `Rng` for its equal-move tie-break.
 *
 * The state is the board and whose turn it is. Nothing else is needed, because
 * everything else about the position is derived: the legal placements, the
 * pass, and the end (a game is over exactly when NEITHER side can place, which
 * is why `result` asks the question twice). A state that is over can never
 * become live again, and a disc is only ever turned over in place, so a
 * position cannot repeat.
 */

import { InvalidStateError } from "../boards-shared/errors.js";
import { IN_PROGRESS, draw, win } from "../boards-shared/outcome.js";
import type { Outcome, Player } from "../boards-shared/outcome.js";
import type { Rng } from "../boards-shared/rng.js";
import { search } from "../boards-shared/search.js";
import type { Choice, SearchGame, SearchLimits } from "../boards-shared/search.js";

export const REVERSI_SIZE = 8;
export const REVERSI_CELLS = REVERSI_SIZE * REVERSI_SIZE;

/** Cell contents: `0` empty, `1` seat 0's disc, `2` seat 1's disc. */
export type ReversiDisc = 0 | 1 | 2;

export interface ReversiState {
  /** `REVERSI_CELLS` cells, index `row * REVERSI_SIZE + column`, row 0 at the bottom. */
  readonly discs: readonly ReversiDisc[];
  readonly toMove: Player;
}

/**
 * A placement, or the pass a side makes when it has no placement and the game
 * is not over. The pass is a MOVE here and not a silent skip: stage 2 draws the
 * board after every move, and a search that could not tell a pass from a
 * terminal position would score a stuck side as if it had lost.
 */
export type ReversiMove =
  | { readonly kind: "place"; readonly cell: number }
  | { readonly kind: "pass" };

export interface ReversiOptions {
  /** A position to start from instead of the standard opening (tests, saved games). */
  readonly discs?: readonly ReversiDisc[] | undefined;
  readonly toMove?: Player | undefined;
}

/** One difficulty: how deep the search may go and how many nodes it may visit. */
export type ReversiLevel = SearchLimits;

/**
 * Three levels, all of them a full-width alpha-beta search with the evaluation
 * below: level 1 sees two plies, level 2 four, level 3 six. The budgets are the
 * hard caps that keep a move short on a shared machine: measured here (see the
 * report), a level-3 move visits about 24 nodes on a nearly finished board, 14
 * thousand at 45 discs and 40 thousand at 25, so 120 thousand is a cap rather
 * than a target, and `Choice.cut` says when it did bind.
 */
export const REVERSI_LEVELS: readonly ReversiLevel[] = [
  { depth: 2, nodeBudget: 5_000 },
  { depth: 4, nodeBudget: 40_000 },
  { depth: 6, nodeBudget: 120_000 },
];

/** Cell index of the given column and row (column 0 and row 0 at the bottom-left). */
export function reversiIndex(column: number, row: number): number {
  return row * REVERSI_SIZE + column;
}

export function reversiOpponent(player: Player): Player {
  return player === 0 ? 1 : 0;
}

/** The disc `player` places: seat 0 is `1`, seat 1 is `2`. */
export function reversiDisc(player: Player): ReversiDisc {
  return (player + 1) as ReversiDisc;
}

/** All eight directions, as `(column delta, row delta)`. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * The eight rays out of every cell, as cell indices in walk order and stopping
 * at the edge. Built once, and read by both the placement scan and the flip
 * walk: the search asks "what may the side to move play here" once per node, so
 * that scan walks these instead of doing arithmetic on columns and rows.
 */
const RAYS: readonly (readonly (readonly number[])[])[] = buildRays();

function buildRays(): number[][][] {
  const rays: number[][][] = [];
  for (let cell = 0; cell < REVERSI_CELLS; cell += 1) {
    const row = Math.floor(cell / REVERSI_SIZE);
    const column = cell % REVERSI_SIZE;
    const cellRays: number[][] = [];
    for (const [dc, dr] of DIRECTIONS) {
      const ray: number[] = [];
      let c = column + dc;
      let r = row + dr;
      while (c >= 0 && c < REVERSI_SIZE && r >= 0 && r < REVERSI_SIZE) {
        ray.push(reversiIndex(c, r));
        c += dc;
        r += dr;
      }
      cellRays.push(ray);
    }
    rays.push(cellRays);
  }
  return rays;
}

/**
 * True when a placement on `cell` would turn at least one disc over. The
 * placement scan asks only this question, and it asks it 64 times per node, so
 * it answers without building the list of discs a placement would turn: the run
 * of enemy discs has to be closed by one of the mover's own discs, and an enemy
 * run that reaches the edge of the board — the end of its ray — never is.
 */
function flipsSomething(discs: readonly ReversiDisc[], player: Player, cell: number): boolean {
  if (discs[cell] !== 0) return false;
  const mine = reversiDisc(player);
  const theirs = reversiDisc(reversiOpponent(player));
  for (const ray of RAYS[cell] as readonly (readonly number[])[]) {
    let step = 0;
    while (step < ray.length && discs[ray[step] as number] === theirs) step += 1;
    if (step === 0 || step >= ray.length) continue;
    if (discs[ray[step] as number] === mine) return true;
  }
  return false;
}

/**
 * The cells a placement on `cell` would turn over, or an empty list when the
 * placement is not legal — the one rule of the game, asked in the one place.
 * An enemy run that reaches the edge of the board, or a friendly disc, without
 * a bracketing disc of the mover's own colour behind it is not a run: it is the
 * walk that failed, and it turns nothing over.
 */
export function reversiFlips(
  discs: readonly ReversiDisc[],
  player: Player,
  cell: number,
): number[] {
  const flips: number[] = [];
  if (!Number.isInteger(cell) || cell < 0 || cell >= REVERSI_CELLS) return flips;
  if (discs[cell] !== 0) return flips;
  const mine = reversiDisc(player);
  const theirs = reversiDisc(reversiOpponent(player));
  for (const ray of RAYS[cell] as readonly (readonly number[])[]) {
    let step = 0;
    while (step < ray.length && discs[ray[step] as number] === theirs) step += 1;
    if (step === 0 || step >= ray.length) continue;
    if (discs[ray[step] as number] !== mine) continue;
    for (let index = 0; index < step; index += 1) flips.push(ray[index] as number);
  }
  return flips;
}

/** Every cell `player` may place on in this position. */
export function reversiPlacements(discs: readonly ReversiDisc[], player: Player): number[] {
  const placements: number[] = [];
  for (let cell = 0; cell < REVERSI_CELLS; cell += 1) {
    if (flipsSomething(discs, player, cell)) placements.push(cell);
  }
  return placements;
}

/** The disc count, `[seat 0, seat 1]`. */
export function reversiCounts(discs: readonly ReversiDisc[]): [number, number] {
  let zero = 0;
  let one = 0;
  for (const disc of discs) {
    if (disc === 1) zero += 1;
    else if (disc === 2) one += 1;
  }
  return [zero, one];
}

/**
 * The standard opening: seat 0 (which moves first) on e4 and d5, seat 1 on d4
 * and e5. Both seats have exactly four placements from here — c4, d3, e6 and
 * f5 for seat 0 — and the four centre discs are on the two diagonals, not on a
 * row or a column, which is what makes those four placements bracket anything
 * at all.
 */
export function initialState(options: ReversiOptions = {}): ReversiState {
  const discs = options.discs ?? standardOpening();
  if (discs.length !== REVERSI_CELLS) throw new InvalidStateError("discs-length");
  for (const disc of discs) {
    if (disc !== 0 && disc !== 1 && disc !== 2) throw new InvalidStateError("discs-disc");
  }
  const toMove = options.toMove ?? 0;
  if (toMove !== 0 && toMove !== 1) throw new InvalidStateError("toMove");
  return { discs: discs.slice(), toMove };
}

function standardOpening(): ReversiDisc[] {
  const discs = new Array<ReversiDisc>(REVERSI_CELLS).fill(0);
  discs[reversiIndex(4, 3)] = 1;
  discs[reversiIndex(3, 4)] = 1;
  discs[reversiIndex(3, 3)] = 2;
  discs[reversiIndex(4, 4)] = 2;
  return discs;
}

/**
 * The placements of the side to move, or the single pass when it has none and
 * the opponent still has one. An empty list means the game is over — that is
 * the definition, and `result` reads it the same way.
 */
export function legalMoves(state: ReversiState): ReversiMove[] {
  const placements = reversiPlacements(state.discs, state.toMove);
  if (placements.length > 0) {
    return placements.map((cell): ReversiMove => ({ kind: "place", cell }));
  }
  const replies = reversiPlacements(state.discs, reversiOpponent(state.toMove));
  return replies.length === 0 ? [] : [{ kind: "pass" }];
}

export function applyMove(state: ReversiState, move: ReversiMove): ReversiState {
  const opponent = reversiOpponent(state.toMove);
  if (move.kind === "pass") {
    if (reversiPlacements(state.discs, state.toMove).length > 0) {
      throw new InvalidStateError("pass-not-needed");
    }
    if (reversiPlacements(state.discs, opponent).length === 0) {
      throw new InvalidStateError("over");
    }
    // The board is untouched, so it is shared rather than copied: a pass is not
    // a placement and nothing that holds the old board can see a difference.
    return { discs: state.discs, toMove: opponent };
  }
  const flips = reversiFlips(state.discs, state.toMove, move.cell);
  if (flips.length === 0) throw new InvalidStateError("illegal");
  const mine = reversiDisc(state.toMove);
  const discs = state.discs.slice();
  discs[move.cell] = mine;
  for (const index of flips) discs[index] = mine;
  return { discs, toMove: opponent };
}

/**
 * In progress while ANY side can place: a side with no placement passes, so
 * the game is over only when the pass is not available either. Then the disc
 * count decides, and an equal count is a draw — the one draw reversi has.
 */
export function result(state: ReversiState): Outcome {
  if (reversiPlacements(state.discs, state.toMove).length > 0) return IN_PROGRESS;
  const opponent = reversiOpponent(state.toMove);
  if (reversiPlacements(state.discs, opponent).length > 0) return IN_PROGRESS;
  const [zero, one] = reversiCounts(state.discs);
  const mine = state.toMove === 0 ? zero : one;
  const theirs = state.toMove === 0 ? one : zero;
  if (mine > theirs) return win(state.toMove, "pieces");
  if (theirs > mine) return win(opponent, "pieces");
  return draw("pieces");
}

/**
 * The score a finished game is worth, above every position score below.
 */
const MATE = 10_000;

/**
 * Positional weights, our own table: a corner can never be turned over, so it
 * is worth 100; the square diagonally inside a corner (an X-square) hands that
 * corner to the opponent, so it is worth -25; the two squares beside a corner
 * (C-squares) do the same more slowly, so they are -10; every other square is 1.
 */
const REVERSI_WEIGHTS: readonly number[] = buildWeights();

function buildWeights(): number[] {
  const weights = new Array<number>(REVERSI_CELLS).fill(1);
  for (const corner of [
    [0, 0],
    [REVERSI_SIZE - 1, 0],
    [0, REVERSI_SIZE - 1],
    [REVERSI_SIZE - 1, REVERSI_SIZE - 1],
  ] as const) {
    const column = corner[0];
    const row = corner[1];
    const dc = column === 0 ? 1 : -1;
    const dr = row === 0 ? 1 : -1;
    weights[reversiIndex(column, row)] = 100;
    weights[reversiIndex(column + dc, row + dr)] = -25;
    weights[reversiIndex(column + dc, row)] = -10;
    weights[reversiIndex(column, row + dr)] = -10;
  }
  return weights;
}

/**
 * How much a free choice of squares is worth against the opponent's.
 *
 * Reversi is decided by mobility and by who owns the corners, not by who has
 * more discs on the board: every disc is a flip target, so the material term is
 * NEGATIVE midgame. Both terms are read off the position as it stands, the
 * count once over the 64 squares and the two mobility figures from the same
 * `reversiPlacements` call `legalMoves` makes — the search evaluates only at
 * leaves, so this is paid once per leaf and not once per node.
 */
const MOBILITY_WEIGHT = 8;
const MATERIAL_WEIGHT = -2;

export function evaluate(state: ReversiState): number {
  const [zero, one] = reversiCounts(state.discs);
  const mine = state.toMove === 0 ? zero : one;
  const theirs = state.toMove === 0 ? one : zero;
  const opponent = reversiOpponent(state.toMove);
  if (
    reversiPlacements(state.discs, state.toMove).length === 0 &&
    reversiPlacements(state.discs, opponent).length === 0
  ) {
    const difference = mine - theirs;
    if (difference === 0) return 0;
    return difference > 0 ? MATE + difference : -(MATE - difference);
  }
  let positional = 0;
  for (let cell = 0; cell < REVERSI_CELLS; cell += 1) {
    const disc = state.discs[cell] as ReversiDisc;
    if (disc === 0) continue;
    const weight = REVERSI_WEIGHTS[cell] as number;
    positional += disc === reversiDisc(state.toMove) ? weight : -weight;
  }
  const mobility =
    reversiPlacements(state.discs, state.toMove).length -
    reversiPlacements(state.discs, opponent).length;
  return positional + MOBILITY_WEIGHT * mobility + MATERIAL_WEIGHT * (mine - theirs);
}

/**
 * Corners first: they are the only squares whose disc is worth holding, and
 * alpha-beta cuts most on the moves that matter most.
 */
const GAME: SearchGame<ReversiState, ReversiMove> = {
  legalMoves,
  applyMove,
  isTerminal: (state) =>
    reversiPlacements(state.discs, state.toMove).length === 0 &&
    reversiPlacements(state.discs, reversiOpponent(state.toMove)).length === 0,
  evaluate,
  orderMoves: (_state, moves) =>
    moves
      .slice()
      .sort((a, b) => weightOf(b) - weightOf(a)),
};

function weightOf(move: ReversiMove): number {
  return move.kind === "pass" ? 0 : (REVERSI_WEIGHTS[move.cell] as number);
}

function levelLimits(level: number): ReversiLevel {
  const index = Math.min(Math.max(Math.floor(level), 1), REVERSI_LEVELS.length) - 1;
  return REVERSI_LEVELS[index] as ReversiLevel;
}

/**
 * The computer's move. `level` is 1..3, anything outside is clamped. The
 * returned `Choice.move` is always legal (or `null` on a finished game), and
 * `Choice.nodes` never exceeds the level's budget.
 */
export function bestMove(state: ReversiState, level: number, rng: Rng): Choice<ReversiMove> {
  return search(GAME, state, levelLimits(level), rng);
}

/** The shape `toJSON` writes and `fromJSON` accepts. */
export interface ReversiJson {
  readonly discs: readonly ReversiDisc[];
  readonly toMove: Player;
}

export function toJSON(state: ReversiState): ReversiJson {
  return { discs: state.discs.slice(), toMove: state.toMove };
}

export function fromJSON(value: unknown): ReversiState {
  if (typeof value !== "object" || value === null) throw new InvalidStateError("json");
  const record = value as Record<string, unknown>;
  const discs = record["discs"];
  if (!Array.isArray(discs)) throw new InvalidStateError("discs");
  const toMove = record["toMove"];
  if (toMove !== 0 && toMove !== 1) throw new InvalidStateError("toMove");
  return initialState({ discs: discs as readonly ReversiDisc[], toMove });
}
