/**
 * 2048 — the sliding-merge board, four by four by default and five or six by
 * option, with the original game's rules and none of its look.
 *
 * **The whole game is a value.** `moveTile2048` takes a state and a direction
 * and returns a new state; nothing here mutates what it was handed, reads a
 * clock or draws from `Math.random`. The random stream travels inside the state
 * as `rngState`, so a save file is a board plus a number and the same file
 * replays the same game.
 *
 * **The merge rule is `mergeLine`, and it is the one thing a copy gets wrong.**
 * A line is compacted first, then scanned left to right, and a tile merges at
 * most ONCE per move: `2 2 2 2` becomes `4 4`, never `8`, and `4 4 4 4` becomes
 * `8 8`. The scan skips the tile it just consumed, which is the entire
 * implementation of "at most once".
 *
 * **The spawn rule is the original's.** The 2014 game by Gabriele Cirulli, MIT
 * licensed, spawns `var value = Math.random() < 0.9 ? 2 : 4;` in
 * `js/game_manager.js` (`addRandomTile`), so a new tile is a 2 nine times out of
 * ten and a 4 the tenth — `nextTileValue` below is that line and nothing else,
 * and the test measures it over a hundred thousand draws.
 *
 * **Winning is not the end of the game.** Reaching 2048 sets `won`, and the
 * board keeps playing until the player says otherwise: a surface shows the win
 * the moment `won && !keepGoing`, and `continueAfterWin` is how it goes away.
 *
 * **One step of undo lives in the state.** The move that produced a state is
 * recorded inside it (`undo`), so `undoLastMove` is a pure function too — and a
 * move that changed nothing keeps no record, because it was not a move.
 */

import type { SeededRandom } from "../random.js";
import { createSeededRandom, randomBelow } from "../random.js";

/** The boards this engine builds. */
export type Tile2048Size = 4 | 5 | 6;

export const TILE_2048_SIZES: readonly Tile2048Size[] = [4, 5, 6];

export type Tile2048Move = "left" | "right" | "up" | "down";

/** The tile that wins a game, on every board size. */
export const TILE_2048_WIN = 2048;

/** Everything a state holds except the board's history, so one can be restored. */
export interface Tile2048Snapshot {
  readonly cells: readonly number[];
  readonly score: number;
  readonly won: boolean;
  readonly keepGoing: boolean;
  readonly over: boolean;
  readonly moves: number;
  readonly rngState: number;
}

export interface Tile2048State extends Tile2048Snapshot {
  readonly size: Tile2048Size;
  /** The state the last move was played from, or `null`; one step, not a history. */
  readonly undo: Tile2048Snapshot | null;
}

/** A board to start from — a save file, or a case a test wants to pin. */
export interface Tile2048Setup {
  readonly cells: readonly number[];
  readonly size?: Tile2048Size;
  readonly seed?: number;
  readonly score?: number;
  readonly won?: boolean;
  readonly keepGoing?: boolean;
  readonly moves?: number;
  readonly rngState?: number;
}

/**
 * The original game's spawn rule, as `js/game_manager.js` writes it: a 2 nine
 * times out of ten, a 4 the rest. Kept in one function so the probability is
 * stated once and can be measured rather than assumed.
 */
export function nextTileValue(random: SeededRandom): 2 | 4 {
  return random.next() < 0.9 ? 2 : 4;
}

/**
 * One line of the board, compacted and merged toward the front. Exported because
 * it is the rule every case in the test names, and because a surface that wants
 * to preview a move needs exactly this and nothing else.
 */
export function mergeLine(line: readonly number[]): { line: number[]; gained: number } {
  const kept = line.filter((value) => value !== 0);
  const merged: number[] = [];
  let gained = 0;
  for (let index = 0; index < kept.length; index += 1) {
    const value = kept[index] as number;
    if (index + 1 < kept.length && kept[index + 1] === value) {
      // The partner is consumed here, which is the whole of "at most once per
      // move": the loop never sees it again.
      merged.push(value * 2);
      gained += value * 2;
      index += 1;
      continue;
    }
    merged.push(value);
  }
  while (merged.length < line.length) merged.push(0);
  return { line: merged, gained };
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value >= 2 && (value & (value - 1)) === 0;
}

function checkSetup(setup: Tile2048Setup, size: Tile2048Size): void {
  if (setup.cells.length !== size * size) {
    throw new RangeError(
      `tile2048From: a ${size}x${size} board needs ${size * size} cells, got ${setup.cells.length}`,
    );
  }
  for (const value of setup.cells) {
    if (value !== 0 && !isPowerOfTwo(value)) {
      throw new RangeError(`tile2048From: ${value} is not an empty cell or a power of two`);
    }
  }
}

/**
 * A state from a board someone else provides — a stored game, or a test's pinned
 * case. The board is validated here rather than trusted, because it arrives from
 * outside this module; `seed` starts the stream where the caller wants it and
 * defaults to `rngState` when that is given instead.
 */
export function tile2048From(setup: Tile2048Setup): Tile2048State {
  const size = setup.size ?? 4;
  if (!TILE_2048_SIZES.includes(size)) {
    throw new RangeError(`tile2048From: this engine builds 4x4, 5x5 and 6x6 boards, got ${size}`);
  }
  checkSetup(setup, size);
  const cells = [...setup.cells];
  const score = setup.score ?? 0;
  return {
    size,
    cells,
    score,
    won: setup.won ?? cells.some((value) => value >= TILE_2048_WIN),
    keepGoing: setup.keepGoing ?? false,
    over: !canMove(cells, size),
    moves: setup.moves ?? 0,
    rngState: (setup.seed ?? setup.rngState ?? 0) >>> 0,
    undo: null,
  };
}

/** A fresh board with the two tiles the game opens with, drawn from `seed`. */
export function createTile2048(seed: number, size: Tile2048Size = 4): Tile2048State {
  if (!TILE_2048_SIZES.includes(size)) {
    throw new RangeError(`createTile2048: this engine builds 4x4, 5x5 and 6x6 boards, got ${size}`);
  }
  const random = createSeededRandom(seed);
  const cells = new Array<number>(size * size).fill(0);
  placeRandomTile(cells, random);
  placeRandomTile(cells, random);
  return {
    size,
    cells,
    score: 0,
    won: false,
    keepGoing: false,
    over: !canMove(cells, size),
    moves: 0,
    rngState: random.state,
    undo: null,
  };
}

/** Put a fresh tile on a random empty cell; the caller has already checked there is one. */
function placeRandomTile(cells: number[], random: SeededRandom): void {
  const empty: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] === 0) empty.push(index);
  }
  const at = empty[randomBelow(random, empty.length)] as number;
  cells[at] = nextTileValue(random);
}

function rowOf(cells: readonly number[], size: number, row: number): number[] {
  return cells.slice(row * size, (row + 1) * size);
}

function columnOf(cells: readonly number[], size: number, column: number): number[] {
  const out: number[] = [];
  for (let row = 0; row < size; row += 1) out.push(cells[row * size + column] as number);
  return out;
}

/**
 * Move every line toward `move` and put the results back. A "line" read forward
 * is `left`, read backward is `right`, a column top-down is `up`; `down` is `up`
 * read backwards. Every direction is therefore the same merge.
 */
function slide(
  cells: readonly number[],
  size: number,
  move: Tile2048Move,
): { cells: number[]; gained: number; moved: boolean } {
  const next = new Array<number>(cells.length).fill(0);
  let gained = 0;
  let moved = false;
  const horizontal = move === "left" || move === "right";
  const lines = size;
  for (let line = 0; line < lines; line += 1) {
    const before = horizontal ? rowOf(cells, size, line) : columnOf(cells, size, line);
    const reversed = move === "right" || move === "down";
    const source = reversed ? [...before].reverse() : before;
    const merged = mergeLine(source);
    gained += merged.gained;
    const result = reversed ? [...merged.line].reverse() : merged.line;
    for (let position = 0; position < size; position += 1) {
      const value = result[position] as number;
      if (value !== before[position]) moved = true;
      const index = horizontal ? line * size + position : position * size + line;
      next[index] = value;
    }
  }
  return { cells: next, gained, moved };
}

/** True while some direction would change the board: an empty cell, or a neighbour to merge with. */
function canMove(cells: readonly number[], size: number): boolean {
  if (cells.some((value) => value === 0)) return true;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const value = cells[row * size + column] as number;
      if (column + 1 < size && cells[row * size + column + 1] === value) return true;
      if (row + 1 < size && cells[(row + 1) * size + column] === value) return true;
    }
  }
  return false;
}

export function canMoveTile2048(state: Tile2048State): boolean {
  return canMove(state.cells, state.size);
}

/** The largest tile on the board, which is what a "best tile" readout shows. */
export function highestTile(state: Tile2048State): number {
  return state.cells.reduce((best, value) => Math.max(best, value), 0);
}

function snapshotOf(state: Tile2048State): Tile2048Snapshot {
  return {
    cells: [...state.cells],
    score: state.score,
    won: state.won,
    keepGoing: state.keepGoing,
    over: state.over,
    moves: state.moves,
    rngState: state.rngState,
  };
}

/**
 * Play `move`. A move that changes nothing returns the state unchanged and is
 * not a move: no tile spawns, no score changes, and the step of undo already in
 * the state survives, because undoing it would have to undo the move before it.
 */
export function moveTile2048(state: Tile2048State, move: Tile2048Move): Tile2048State {
  if (state.over) return state;
  const slid = slide(state.cells, state.size, move);
  if (!slid.moved) return state;

  const random = createSeededRandom(state.rngState);
  const cells = slid.cells;
  placeRandomTile(cells, random);
  const won = state.won || cells.some((value) => value >= TILE_2048_WIN);
  return {
    size: state.size,
    cells,
    score: state.score + slid.gained,
    won,
    keepGoing: state.keepGoing,
    over: !canMove(cells, state.size),
    moves: state.moves + 1,
    rngState: random.state,
    undo: snapshotOf(state),
  };
}

/**
 * The state a board is left in when the player answers the win prompt by
 * carrying on. Idempotent, so a surface may call it per render without asking
 * whether it already did.
 */
export function continueAfterWin(state: Tile2048State): Tile2048State {
  if (state.keepGoing) return state;
  return { ...state, keepGoing: true };
}

/**
 * Step back over the last move — the board, the score and the draw position all
 * as they were — or `null` when there is nothing to step back over. The step of
 * undo is consumed by using it, so a second call has nothing to return.
 */
export function undoLastMove(state: Tile2048State): Tile2048State | null {
  const history = state.undo;
  if (history === null) return null;
  return {
    size: state.size,
    cells: [...history.cells],
    score: history.score,
    won: history.won,
    keepGoing: history.keepGoing,
    over: history.over,
    moves: history.moves,
    rngState: history.rngState,
    undo: null,
  };
}
