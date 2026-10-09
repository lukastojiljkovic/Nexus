/**
 * Snake — the grid snake, as a pure engine with one entry point:
 * `step(state, input, now)`.
 *
 * **Time is a reading the caller owns, and only its differences matter.** A step
 * advances the snake only when `now - lastTickAt` has reached the current tick,
 * and it may run several ticks in one call to make up for a slow frame. `now` is
 * whatever monotonic millisecond reading the caller has (`performance.now()` in
 * main), never a wall clock: a system clock stepping backwards would freeze the
 * snake, so the engine reads none.
 *
 * **A fixed tick, and no interpolation.** `SNAKE_TICK_MS` is the rung the snake
 * moves on at level one, and the tick shortens with the level by
 * `SNAKE_TICK_STEP_MS` down to a floor. Two steps in the same millisecond
 * therefore move the snake exactly as far as one step would, and the engine is
 * deterministic: a seed plus an input log replays a whole game, which is what
 * the test pins.
 *
 * **The turn queue is what stops a player from killing themselves.** A turn is
 * buffered rather than applied, at most `SNAKE_MAX_PENDING_TURNS` of them, and a
 * turn that reverses the direction the snake is already committed to is dropped
 * rather than obeyed. Without the buffer, two fast key presses in one tick would
 * be one press; without the reversal rule, pressing left while moving right
 * would fold the snake into its own neck.
 *
 * **The board has walls and the snake dies on them.** Walls, not wrapping: the
 * wrap is a different game, and a course that leaves through one edge and
 * returns through the other is not the one the level ramp is tuned for.
 */

import type { SeededRandom } from "../random.js";
import { createSeededRandom, randomBelow } from "../random.js";

export const SNAKE_COLUMNS = 20;
export const SNAKE_ROWS = 20;

/** The tick at level one, how much each level shaves off it, and the floor it never goes below. */
export const SNAKE_TICK_MS = 120;
export const SNAKE_TICK_STEP_MS = 10;
export const SNAKE_MIN_TICK_MS = 60;

export const SNAKE_FOOD_POINTS = 10;
export const SNAKE_POINTS_PER_LEVEL = 50;

/** The snake opens four cells long, pointing right, in the middle of the board. */
export const SNAKE_START_LENGTH = 4;

/**
 * How many ticks one call may run to make up for lost time. A window that was
 * suspended for a minute must not be paid back as a hundred moves; past this the
 * clock is simply put back to the caller's reading.
 */
export const SNAKE_MAX_TICKS_PER_STEP = 4;

export type SnakeDirection = "up" | "down" | "left" | "right";

/** What the player is asking for this step. Both fields are optional. */
export interface SnakeInput {
  readonly turn?: SnakeDirection;
}

export interface SnakeState {
  readonly columns: number;
  readonly rows: number;
  /** Cells from head to tail, row-major indices. */
  readonly body: readonly number[];
  readonly direction: SnakeDirection;
  /** Turns accepted but not yet used, oldest first. */
  readonly pending: readonly SnakeDirection[];
  /** The cell holding the food. */
  readonly food: number;
  readonly score: number;
  readonly eaten: number;
  readonly level: number;
  readonly over: boolean;
  /** How many times the snake has moved. */
  readonly ticks: number;
  readonly rngState: number;
  /** The reading of the tick the snake last moved on. */
  readonly lastTickAt: number;
  readonly seed: number;
}

/** The tick the snake moves on at `level`. Faster is a shorter tick, never below the floor. */
export function snakeTickMs(level: number): number {
  return Math.max(SNAKE_MIN_TICK_MS, SNAKE_TICK_MS - (level - 1) * SNAKE_TICK_STEP_MS);
}

const DELTAS: Record<SnakeDirection, readonly [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

function isOpposite(left: SnakeDirection, right: SnakeDirection): boolean {
  return (
    (left === "up" && right === "down") ||
    (left === "down" && right === "up") ||
    (left === "left" && right === "right") ||
    (left === "right" && right === "left")
  );
}

/** A board with the snake in the middle, food already placed, and the clock started. */
export function createSnake(
  seed: number,
  now: number,
  columns = SNAKE_COLUMNS,
  rows = SNAKE_ROWS,
): SnakeState {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 6 || rows < 6) {
    throw new RangeError(
      `createSnake: a board of at least 6x6 is needed for the opening snake, got ${columns}x${rows}`,
    );
  }
  const row = Math.floor(rows / 2);
  const headColumn = Math.floor(columns / 2);
  const body: number[] = [];
  for (let step = 0; step < SNAKE_START_LENGTH; step += 1) {
    body.push(row * columns + (headColumn - step));
  }
  const random = createSeededRandom(seed);
  const food = placeFood(body, columns, rows, random);
  return {
    columns,
    rows,
    body,
    direction: "right",
    pending: [],
    food,
    score: 0,
    eaten: 0,
    level: 1,
    over: false,
    ticks: 0,
    rngState: random.state,
    lastTickAt: now,
    seed,
  };
}

/**
 * Put the food on a cell the snake is not using. Returns `-1` when the board is
 * full, which the caller reads as a board won rather than a snake that is stuck.
 */
function placeFood(
  body: readonly number[],
  columns: number,
  rows: number,
  random: SeededRandom,
): number {
  const occupied = new Set(body);
  const empty: number[] = [];
  for (let cell = 0; cell < columns * rows; cell += 1) {
    if (!occupied.has(cell)) empty.push(cell);
  }
  if (empty.length === 0) return -1;
  return empty[randomBelow(random, empty.length)] as number;
}

/**
 * One call of the game: take the player's turn, then let the clock catch up.
 *
 * A turn that reverses the direction the snake still has to move in is dropped,
 * where "still has to move in" includes the turns already queued: pressing up
 * and then down inside one tick must not fold the snake either.
 */
export function step(state: SnakeState, input: SnakeInput, now: number): SnakeState {
  if (state.over) return state;
  let draft = state;
  const turn = input.turn;
  if (turn !== undefined) {
    // The direction the snake is committed to is the last turn still queued, or
    // the one it is already moving in when the queue is empty — checking against
    // `direction` alone would refuse a legal turn (up, then left, while the
    // state still says "right").
    const last = draft.pending[draft.pending.length - 1] ?? draft.direction;
    if (!isOpposite(turn, last) && turn !== last && draft.pending.length < 2) {
      draft = { ...draft, pending: [...draft.pending, turn] };
    }
  }
  let moved = 0;
  let lastTickAt = draft.lastTickAt;
  while (!draft.over && now - lastTickAt >= snakeTickMs(draft.level)) {
    if (moved >= SNAKE_MAX_TICKS_PER_STEP) {
      // Too far behind to make up honestly: drop the backlog and carry on from
      // the caller's reading, so a suspended window costs nothing but time.
      lastTickAt = now;
      break;
    }
    lastTickAt += snakeTickMs(draft.level);
    draft = advance(draft, lastTickAt);
    moved += 1;
  }
  if (draft === state && lastTickAt === state.lastTickAt) return state;
  return { ...draft, lastTickAt };
}

/** Move the snake one cell, applying the queue, the food, the walls and the length. */
function advance(state: SnakeState, at: number): SnakeState {
  const queued = state.pending[0];
  const direction = queued ?? state.direction;
  const pending = queued === undefined ? state.pending : state.pending.slice(1);
  const [deltaRow, deltaColumn] = DELTAS[direction];
  const head = state.body[0] as number;
  const row = Math.floor(head / state.columns) + deltaRow;
  const column = (head % state.columns) + deltaColumn;
  if (row < 0 || row >= state.rows || column < 0 || column >= state.columns) {
    return { ...state, direction, pending, over: true, lastTickAt: at, ticks: state.ticks + 1 };
  }
  const next = row * state.columns + column;
  const eating = next === state.food;
  // The tail cell is about to be vacated, so it is not a collision unless the
  // snake is growing and the tail stays put.
  const body = eating ? state.body : state.body.slice(0, -1);
  if (body.includes(next)) {
    return { ...state, direction, pending, over: true, lastTickAt: at, ticks: state.ticks + 1 };
  }
  const grown = [next, ...body];
  if (!eating) {
    return {
      ...state,
      body: grown,
      direction,
      pending,
      over: grown.length === state.columns * state.rows,
      lastTickAt: at,
      ticks: state.ticks + 1,
    };
  }
  const score = state.score + SNAKE_FOOD_POINTS;
  const random = createSeededRandom(state.rngState);
  const food = placeFood(grown, state.columns, state.rows, random);
  return {
    ...state,
    body: grown,
    direction,
    pending,
    food,
    score,
    eaten: state.eaten + 1,
    level: 1 + Math.floor(score / SNAKE_POINTS_PER_LEVEL),
    over: food === -1,
    rngState: random.state,
    lastTickAt: at,
    ticks: state.ticks + 1,
  };
}
