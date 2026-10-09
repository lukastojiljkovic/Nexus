/**
 * Four in a row (`ÄŒetiri u nizu`) â€” a 7x6 board, a disc dropped down a column,
 * and four in a line (horizontal, vertical or either diagonal) to win.
 *
 * Rules source: the standard four-in-a-row rules as printed in Milton Bradley's
 * *Connect Four* rule sheet. The game is `four-in-a-row` here and `ÄŒetiri u
 * nizu` in the copy, because *Connect Four* is a trademark; no rule depends on
 * the name.
 *
 * Pure: no I/O, no clock, no `Math.random`. Time does not enter the rules at
 * all, and `bestMove` takes the caller's seeded `SeededRandom` for its equal-move
 * tie-break. Discs are only ever added, so a position can never repeat and the
 * only draw is the full board.
 *
 * The state carries the winner alongside the cells. It is derived, but it is
 * carried rather than rescanned because the search asks "is this over?" at
 * every node and "who has four?" is a 69-window scan: dropping that scan from
 * the inner loop is what keeps level 3 inside its budget (see the report).
 */

import { InvalidStateError } from "../boards-shared/errors.js";
import { IN_PROGRESS, draw, win } from "../boards-shared/outcome.js";
import type { Outcome, Player } from "../boards-shared/outcome.js";
import type { SeededRandom } from "../random.js";
import { search } from "../boards-shared/search.js";
import type { Choice, SearchGame, SearchLimits } from "../boards-shared/search.js";

export const FOUR_COLUMNS = 7;
export const FOUR_ROWS = 6;
export const FOUR_CELLS = FOUR_COLUMNS * FOUR_ROWS;
/** A line is this many discs; the board is 7 wide so a run can never be longer. */
export const FOUR_RUN = 4;

/** Cell contents: `0` empty, `1` seat 0's disc, `2` seat 1's disc. */
export type FourDisc = 0 | 1 | 2;

export interface FourState {
  /** `FOUR_CELLS` cells, index `row * FOUR_COLUMNS + column`, row 0 at the bottom. */
  readonly cells: readonly FourDisc[];
  readonly toMove: Player;
  readonly moveCount: number;
  /** The disc with four in a line, or `null`. Derived â€” see the header. */
  readonly winner: FourDisc | null;
}

/** A drop: the column is the whole move, gravity decides the row. */
export interface FourMove {
  readonly column: number;
}

export interface FourOptions {
  /** A position to start from instead of the empty board (tests, saved games). */
  readonly cells?: readonly FourDisc[] | undefined;
  readonly toMove?: Player | undefined;
}

/** One difficulty: how deep the search may go and how many nodes it may visit. */
export type FourLevel = SearchLimits;

/**
 * Three levels, documented rather than tuned by feel: level 1 sees only its own
 * reply (it still spots an immediate win, because a win is a terminal leaf),
 * level 2 sees two plies each, level 3 three. The budgets are the hard caps that
 * keep a move short; see the report for the measured cost per level.
 */
export const FOUR_LEVELS: readonly FourLevel[] = [
  { depth: 1, nodeBudget: 20_000 },
  { depth: 4, nodeBudget: 200_000 },
  { depth: 6, nodeBudget: 400_000 },
];

/** The score a finished game is worth; a win in fewer moves scores higher. */
const MATE = 100_000;

/** What a completed window of four is worth per own disc in it. */
const WINDOW_SCORE = [0, 1, 12, 60] as const;

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** Cell index of the given column and row. */
export function fourIndex(column: number, row: number): number {
  return row * FOUR_COLUMNS + column;
}

/** How many discs stand in `column`, i.e. the row the next one lands on. */
export function fourColumnHeight(cells: readonly FourDisc[], column: number): number {
  let height = 0;
  while (height < FOUR_ROWS && cells[fourIndex(column, height)] !== 0) height += 1;
  return height;
}

function other(player: Player): Player {
  return player === 0 ? 1 : 0;
}

function discOf(player: Player): FourDisc {
  return (player + 1) as FourDisc;
}

/** Every 4-cell window on the board, as index quadruples. Built once. */
const FOUR_WINDOWS: readonly (readonly number[])[] = buildWindows();

function buildWindows(): number[][] {
  const windows: number[][] = [];
  for (let row = 0; row < FOUR_ROWS; row += 1) {
    for (let column = 0; column < FOUR_COLUMNS; column += 1) {
      for (const [dc, dr] of DIRECTIONS) {
        const window: number[] = [];
        for (let step = 0; step < FOUR_RUN; step += 1) {
          const c = column + dc * step;
          const r = row + dr * step;
          if (c < 0 || c >= FOUR_COLUMNS || r < 0 || r >= FOUR_ROWS) {
            window.length = 0;
            break;
          }
          window.push(fourIndex(c, r));
        }
        if (window.length === FOUR_RUN) windows.push(window);
      }
    }
  }
  return windows;
}

/** True when the disc at `index` completes a line of four. */
function lineThrough(cells: readonly FourDisc[], index: number, disc: FourDisc): boolean {
  const row = Math.floor(index / FOUR_COLUMNS);
  const column = index % FOUR_COLUMNS;
  for (const [dc, dr] of DIRECTIONS) {
    let run = 1;
    for (const sign of [1, -1] as const) {
      for (let step = 1; step < FOUR_RUN; step += 1) {
        const c = column + sign * dc * step;
        const r = row + sign * dr * step;
        if (c < 0 || c >= FOUR_COLUMNS || r < 0 || r >= FOUR_ROWS) break;
        if (cells[fourIndex(c, r)] !== disc) break;
        run += 1;
      }
    }
    if (run >= FOUR_RUN) return true;
  }
  return false;
}

/** The disc that has four in a line anywhere, or `null`. */
export function fourWinner(cells: readonly FourDisc[]): FourDisc | null {
  for (const window of FOUR_WINDOWS) {
    const first = cells[window[0] as number];
    if (first === undefined || first === 0) continue;
    if (
      cells[window[1] as number] === first &&
      cells[window[2] as number] === first &&
      cells[window[3] as number] === first
    ) {
      return first;
    }
  }
  return null;
}

/** True when the game has ended (a line, or a full board). */
export function fourOver(state: FourState): boolean {
  return state.winner !== null || state.moveCount >= FOUR_CELLS;
}

export function initialState(options: FourOptions = {}): FourState {
  const cells = options.cells ?? new Array<FourDisc>(FOUR_CELLS).fill(0);
  if (cells.length !== FOUR_CELLS) throw new InvalidStateError("cells-length");
  let filled = 0;
  for (let column = 0; column < FOUR_COLUMNS; column += 1) {
    const height = fourColumnHeight(cells, column);
    // Gravity is part of the board's meaning, so a saved position that floats a
    // disc is refused here rather than played on.
    for (let row = height; row < FOUR_ROWS; row += 1) {
      if (cells[fourIndex(column, row)] !== 0) throw new InvalidStateError("cells-gravity");
    }
    for (let row = 0; row < height; row += 1) {
      const disc = cells[fourIndex(column, row)];
      if (disc !== 1 && disc !== 2) throw new InvalidStateError("cells-disc");
    }
    filled += height;
  }
  const copy = cells.slice();
  return { cells: copy, toMove: options.toMove ?? 0, moveCount: filled, winner: fourWinner(copy) };
}

export function legalMoves(state: FourState): FourMove[] {
  if (fourOver(state)) return [];
  const moves: FourMove[] = [];
  for (let column = 0; column < FOUR_COLUMNS; column += 1) {
    if (fourColumnHeight(state.cells, column) < FOUR_ROWS) moves.push({ column });
  }
  return moves;
}

export function applyMove(state: FourState, move: FourMove): FourState {
  const { column } = move;
  if (!Number.isInteger(column) || column < 0 || column >= FOUR_COLUMNS) {
    throw new InvalidStateError("column");
  }
  if (fourOver(state)) throw new InvalidStateError("over");
  const height = fourColumnHeight(state.cells, column);
  if (height >= FOUR_ROWS) throw new InvalidStateError("column-full");
  const cells = state.cells.slice();
  const index = fourIndex(column, height);
  const disc = discOf(state.toMove);
  cells[index] = disc;
  return {
    cells,
    toMove: other(state.toMove),
    moveCount: state.moveCount + 1,
    winner: lineThrough(cells, index, disc) ? disc : null,
  };
}

export function result(state: FourState): Outcome {
  if (state.winner !== null) return win((state.winner - 1) as Player, "line");
  if (state.moveCount >= FOUR_CELLS) return draw("board-full");
  return IN_PROGRESS;
}

/**
 * Terminal scores are `Â±MATE` shrunk by how far into the game the line landed,
 * so a quicker win outranks a slower one and every non-terminal score is far
 * below them. Mid-game the score is one side's windows minus the other's â€” a
 * single pass over the 69 windows, counting each one for the mover and against
 * them, because a window holding both colours is worth nothing to either.
 */
export function evaluate(state: FourState): number {
  if (state.winner !== null) {
    const mate = MATE - state.moveCount;
    return state.winner === discOf(state.toMove) ? mate : -mate;
  }
  if (state.moveCount >= FOUR_CELLS) return 0;
  const mine = discOf(state.toMove);
  const theirs = discOf(other(state.toMove));
  let score = 0;
  for (const window of FOUR_WINDOWS) {
    let countMine = 0;
    let countTheirs = 0;
    for (const index of window) {
      const cell = state.cells[index] as FourDisc;
      if (cell === mine) countMine += 1;
      else if (cell === theirs) countTheirs += 1;
    }
    if (countMine > 0 && countTheirs === 0) score += WINDOW_SCORE[countMine] as number;
    if (countTheirs > 0 && countMine === 0) score -= WINDOW_SCORE[countTheirs] as number;
  }
  return score;
}

/** Centre columns first: they take part in more windows, so they cut deeper. */
const FOUR_ORDER: readonly number[] = [3, 2, 4, 1, 5, 0, 6];

const GAME: SearchGame<FourState, FourMove> = {
  legalMoves,
  applyMove,
  isTerminal: fourOver,
  evaluate,
  orderMoves: (_state, moves) =>
    moves
      .slice()
      .sort((a, b) => FOUR_ORDER.indexOf(a.column) - FOUR_ORDER.indexOf(b.column)),
};

function levelLimits(level: number): FourLevel {
  const index = Math.min(Math.max(Math.floor(level), 1), FOUR_LEVELS.length) - 1;
  return FOUR_LEVELS[index] as FourLevel;
}

/**
 * The computer's move. `level` is 1..3, anything outside is clamped. The
 * returned `Choice.move` is always a legal move (or `null` on a finished game),
 * and `Choice.nodes` never exceeds the level's budget.
 */
export function bestMove(state: FourState, level: number, rng: SeededRandom): Choice<FourMove> {
  return search(GAME, state, levelLimits(level), rng);
}

/** The shape `toJSON` writes and `fromJSON` accepts. The winner is derived. */
export interface FourJson {
  readonly cells: readonly FourDisc[];
  readonly toMove: Player;
  readonly moveCount: number;
}

export function toJSON(state: FourState): FourJson {
  return { cells: state.cells.slice(), toMove: state.toMove, moveCount: state.moveCount };
}

export function fromJSON(value: unknown): FourState {
  if (typeof value !== "object" || value === null) throw new InvalidStateError("json");
  const record = value as Record<string, unknown>;
  const cells = record["cells"];
  if (!Array.isArray(cells)) throw new InvalidStateError("cells");
  const toMove = record["toMove"];
  if (toMove !== 0 && toMove !== 1) throw new InvalidStateError("toMove");
  const moveCount = record["moveCount"];
  if (!Number.isInteger(moveCount)) throw new InvalidStateError("moveCount");
  const state = initialState({ cells: cells as readonly FourDisc[], toMove });
  if (state.moveCount !== moveCount) throw new InvalidStateError("moveCount-mismatch");
  return state;
}
