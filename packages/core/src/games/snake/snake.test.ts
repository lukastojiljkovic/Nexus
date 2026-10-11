import { describe, expect, it } from "vitest";

import {
  SNAKE_COLUMNS,
  SNAKE_FOOD_POINTS,
  SNAKE_MAX_TICKS_PER_STEP,
  SNAKE_MIN_TICK_MS,
  SNAKE_ROWS,
  SNAKE_TICK_MS,
  createSnake,
  snakeTickMs,
  step,
} from "./snake.js";
import type { SnakeDirection, SnakeState } from "./snake.js";

function index(row: number, column: number): number {
  return row * SNAKE_COLUMNS + column;
}

/** Every rule a snake state must obey, whatever route it took to get there. */
function checkInvariants(state: SnakeState): void {
  const cells = new Set(state.body);
  expect(cells.size).toBe(state.body.length);
  for (const cell of state.body) {
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(cell).toBeLessThan(state.columns * state.rows);
  }
  if (!state.over) expect(cells.has(state.food)).toBe(false);
  expect(state.score).toBe(state.eaten * SNAKE_FOOD_POINTS);
  expect(state.level).toBe(1 + Math.floor(state.score / 50));
  expect(state.ticks).toBeGreaterThanOrEqual(0);
  // The body is one unbroken path: each cell after the head is a neighbour of
  // the one before it.
  for (let index = 1; index < state.body.length; index += 1) {
    const previous = state.body[index - 1] as number;
    const current = state.body[index] as number;
    const distance =
      Math.abs(Math.floor(previous / state.columns) - Math.floor(current / state.columns)) +
      Math.abs((previous % state.columns) - (current % state.columns));
    expect(distance).toBe(1);
  }
}

describe("snakeTickMs", () => {
  it("shortens the tick by ten milliseconds a level and floors it", () => {
    expect(snakeTickMs(1)).toBe(SNAKE_TICK_MS);
    expect(snakeTickMs(2)).toBe(SNAKE_TICK_MS - 10);
    expect(snakeTickMs(7)).toBe(SNAKE_MIN_TICK_MS);
    expect(snakeTickMs(40)).toBe(SNAKE_MIN_TICK_MS);
  });
});

describe("createSnake", () => {
  it("opens with the snake four long in the middle, pointing right", () => {
    const state = createSnake(1, 0);
    expect(state.body).toHaveLength(4);
    expect(state.direction).toBe("right");
    expect(state.body[0]).toBe(index(10, 10));
    expect(state.body).toEqual([index(10, 10), index(10, 9), index(10, 8), index(10, 7)]);
    expect(state.over).toBe(false);
    expect(state.score).toBe(0);
    expect(state.level).toBe(1);
    expect(state.ticks).toBe(0);
    checkInvariants(state);
  });

  it("replays the same opening, and its food, for the same seed", () => {
    expect(createSnake(7, 0)).toEqual(createSnake(7, 0));
    expect(createSnake(7, 0).food).not.toBe(createSnake(8, 0).food);
  });
});

describe("step", () => {
  it("moves once the tick has passed and not before", () => {
    const state = createSnake(3, 0);
    const early = step(state, {}, SNAKE_TICK_MS - 1);
    expect(early).toBe(state);
    const moved = step(state, {}, SNAKE_TICK_MS);
    expect(moved.ticks).toBe(1);
    expect(moved.body[0]).toBe(index(10, 11));
    expect(moved.body[3]).toBe(index(10, 8));
    checkInvariants(moved);
  });

  it("runs at most the catch-up limit in one call", () => {
    const state = createSnake(3, 0);
    const late = step(state, {}, SNAKE_TICK_MS * 10);
    expect(late.ticks).toBe(SNAKE_MAX_TICKS_PER_STEP);
    // The backlog is dropped, so the next call at the same reading does nothing.
    expect(step(late, {}, SNAKE_TICK_MS * 10).ticks).toBe(SNAKE_MAX_TICKS_PER_STEP);
  });

  it("drops a turn that would fold the snake into its own neck", () => {
    const state = createSnake(3, 0);
    const turned = step(state, { turn: "left" }, SNAKE_TICK_MS);
    expect(turned.body[0]).toBe(index(10, 11));
    expect(turned.pending).toEqual([]);
  });

  it("queues two turns and uses them on the next two ticks", () => {
    let state = createSnake(3, 0);
    state = step(state, { turn: "up" }, 1);
    state = step(state, { turn: "left" }, 2);
    expect(state.pending).toEqual(["up", "left"]);
    state = step(state, {}, SNAKE_TICK_MS);
    expect(state.body[0]).toBe(index(9, 10));
    expect(state.pending).toEqual(["left"]);
    state = step(state, {}, SNAKE_TICK_MS + snakeTickMs(1));
    expect(state.body[0]).toBe(index(9, 9));
  });

  it("dies on the wall and stays dead", () => {
    let state = createSnake(3, 0);
    // Nine ticks walk the head from column 10 to column 19; the tenth step
    // would leave the board, and the wall stops it where it stands.
    for (let tick = 1; tick <= 12; tick += 1) {
      state = step(state, {}, SNAKE_TICK_MS * tick);
    }
    expect(state.over).toBe(true);
    expect(state.body[0]).toBe(index(10, 19));
    // The head is where it was: the move that would leave the board is not made.
    expect(step(state, {}, SNAKE_TICK_MS * 20)).toBe(state);
  });

  it("dies on itself", () => {
    // A hand-built coil: the head at (5,5) points down into its own fourth
    // segment at (6,5). A four-cell snake cannot reach this by driving it
    // around a two-by-two loop — it has to have grown first — so the body is
    // stated outright.
    const coiled: SnakeState = {
      columns: SNAKE_COLUMNS,
      rows: SNAKE_ROWS,
      body: [index(5, 5), index(5, 6), index(6, 6), index(6, 5), index(6, 4)],
      direction: "down",
      pending: [],
      food: index(0, 0),
      score: SNAKE_FOOD_POINTS,
      eaten: 1,
      level: 1,
      over: false,
      ticks: 0,
      rngState: createSnake(3, 0).rngState,
      lastTickAt: 0,
      seed: 3,
    };
    const bitten = step(coiled, {}, SNAKE_TICK_MS);
    expect(bitten.over).toBe(true);
    expect(bitten.body[0]).toBe(index(5, 5));
  });

  it("grows, scores and speeds up when the food is taken", () => {
    // The food is wherever the seed put it, so the test walks the snake there
    // one tick at a time, turning toward the food's row and then its column.
    let state = createSnake(5, 0);
    let now = 0;
    for (let guard = 0; guard < 400 && state.eaten === 0 && !state.over; guard += 1) {
      const head = state.body[0] as number;
      const headRow = Math.floor(head / state.columns);
      const headColumn = head % state.columns;
      const foodRow = Math.floor(state.food / state.columns);
      const foodColumn = state.food % state.columns;
      let turn: SnakeDirection | undefined;
      if (headRow !== foodRow && state.direction !== "up" && state.direction !== "down") {
        turn = foodRow < headRow ? "up" : "down";
      } else if (headColumn !== foodColumn && state.direction !== "left" && state.direction !== "right") {
        turn = foodColumn < headColumn ? "left" : "right";
      }
      now += snakeTickMs(state.level);
      state = step(state, turn === undefined ? {} : { turn }, now);
    }
    expect(state.over).toBe(false);
    expect(state.eaten).toBe(1);
    expect(state.score).toBe(SNAKE_FOOD_POINTS);
    expect(state.body).toHaveLength(5);
    checkInvariants(state);
  });
});

describe("a replayed game", () => {
  it("ends in exactly the same state from the same seed and input log", () => {
    // The log: a turn every fifth tick, cycling through four directions, over
    // four hundred ticks of level one. Five-cell legs from the opening square
    // make a lap the snake can run for ever, so the replay exercises four
    // hundred moves rather than dying at the wall after ten; the food for this
    // seed is at row 4 column 18, off every leg, so nothing is eaten. Nothing
    // here reads a clock or draws a random number outside the engine, so the
    // whole game is a function of (seed, log) and the final state is pinned.
    const log: readonly SnakeDirection[] = ["up", "right", "down", "left"];
    const play = (): SnakeState => {
      let state = createSnake(20261009, 0);
      let now = 0;
      for (let tick = 1; tick <= 400; tick += 1) {
        now += snakeTickMs(state.level);
        const turn = tick % 5 === 0 ? log[(tick / 5) % log.length] : undefined;
        state = step(state, turn === undefined ? {} : { turn }, now);
      }
      return state;
    };
    const first = play();
    const again = play();
    expect(again).toEqual(first);
    checkInvariants(first);
    expect(first.over).toBe(false);
    expect(first.ticks).toBe(400);
    expect(first.score).toBe(0);
    expect(first.level).toBe(1);
    expect(first.eaten).toBe(0);
    // Pinned below: the whole state after four hundred ticks of this log.
    expect(first.lastTickAt).toBe(nowOf(400));
    expect(first).toEqual({
      columns: SNAKE_COLUMNS,
      rows: SNAKE_ROWS,
      body: [294, 314, 315, 316],
      direction: "up",
      pending: [],
      food: 98,
      score: 0,
      eaten: 0,
      level: 1,
      over: false,
      ticks: 400,
      rngState: 1851826822,
      lastTickAt: nowOf(400),
      seed: 20261009,
    });
  });
});

/** The reading the replay above ends on: four hundred ticks of level one. */
function nowOf(ticks: number): number {
  return ticks * SNAKE_TICK_MS;
}

describe("the board the engine assumes", () => {
  it("is twenty by twenty", () => {
    expect(SNAKE_COLUMNS).toBe(20);
    expect(SNAKE_ROWS).toBe(20);
  });
});
