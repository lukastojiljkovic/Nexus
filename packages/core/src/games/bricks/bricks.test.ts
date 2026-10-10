import { describe, expect, it } from "vitest";

import {
  BRICKS_BALL_RADIUS,
  BRICKS_BRICK_POINTS,
  BRICKS_BRICK_TOP,
  BRICKS_COLUMNS,
  BRICKS_LIVES,
  BRICKS_LEVEL_BONUS,
  BRICKS_MAX_SPEED,
  BRICKS_PADDLE_WIDTH,
  BRICKS_ROWS,
  BRICKS_TENTHS,
  BRICKS_TICK_MS,
  bricksRemaining,
  bricksSpeed,
  createBricks,
  step,
} from "./bricks.js";
import type { BricksState } from "./bricks.js";

const FIELD_WIDTH = BRICKS_COLUMNS * BRICKS_TENTHS;
const FIELD_HEIGHT = BRICKS_ROWS * BRICKS_TENTHS;
const PADDLE_TOP = FIELD_HEIGHT - 10 - 2 * BRICKS_TENTHS;
const PADDLE_CENTRE = Math.floor((FIELD_WIDTH - BRICKS_PADDLE_WIDTH) / 2);

/** A real game with a few fields replaced, for a rule that needs exact geometry. */
function stateWith(overrides: Partial<BricksState>): BricksState {
  return { ...createBricks(1, 0), ...overrides };
}

/** A layout of `rows` rows with bricks as listed, `[row, column]`. */
function bricksOf(rows: number, bricks: readonly (readonly [number, number])[]): boolean[] {
  const cells = new Array<boolean>(rows * BRICKS_COLUMNS).fill(false);
  for (const [row, column] of bricks) cells[row * BRICKS_COLUMNS + column] = true;
  return cells;
}

function checkInvariants(state: BricksState): void {
  expect(state.bricks).toHaveLength(state.brickRows * state.columns);
  expect(state.paddleLeft).toBeGreaterThanOrEqual(0);
  expect(state.paddleLeft).toBeLessThanOrEqual(FIELD_WIDTH - BRICKS_PADDLE_WIDTH);
  expect(state.ballX).toBeGreaterThanOrEqual(-BRICKS_BALL_RADIUS);
  expect(state.ballX).toBeLessThanOrEqual(FIELD_WIDTH + BRICKS_BALL_RADIUS);
  expect(state.lives).toBeGreaterThanOrEqual(0);
  expect(state.score).toBeGreaterThanOrEqual(0);
  expect(Math.abs(state.ballDx) + Math.abs(state.ballDy)).toBeLessThanOrEqual(BRICKS_MAX_SPEED);
}

describe("bricksSpeed", () => {
  it("ramps a tenth of a cell a level and stops below a whole one", () => {
    expect(bricksSpeed(1)).toBe(4);
    expect(bricksSpeed(2)).toBe(5);
    expect(bricksSpeed(6)).toBe(BRICKS_MAX_SPEED);
    expect(bricksSpeed(50)).toBe(BRICKS_MAX_SPEED);
    // The ceiling exists so a tick can never cross a whole brick row: the
    // collision test is a rectangle overlap and not a swept ray.
    expect(BRICKS_MAX_SPEED).toBeLessThan(BRICKS_TENTHS);
  });
});

describe("createBricks", () => {
  it("opens with three lives, a level of bricks and the ball on the paddle", () => {
    const state = createBricks(2, 0);
    expect(state.lives).toBe(BRICKS_LIVES);
    expect(state.level).toBe(1);
    expect(state.score).toBe(0);
    expect(state.over).toBe(false);
    expect(state.waiting).toBe(true);
    expect(bricksRemaining(state)).toBeGreaterThan(0);
    expect(state.brickRows).toBe(3);
    expect(state.ballY).toBe(PADDLE_TOP - BRICKS_BALL_RADIUS);
    checkInvariants(state);
  });

  it("draws the same level for the same seed", () => {
    expect(createBricks(5, 0)).toEqual(createBricks(5, 0));
    expect(createBricks(5, 0).bricks).not.toEqual(createBricks(6, 0).bricks);
  });
});

describe("step", () => {
  it("does nothing until the tick has passed", () => {
    const state = createBricks(1, 0);
    expect(step(state, {}, BRICKS_TICK_MS - 1)).toBe(state);
    expect(step(state, {}, BRICKS_TICK_MS).ticks).toBe(1);
  });

  it("launches the ball from the paddle when asked", () => {
    const state = createBricks(1, 0);
    const launched = step(state, { launch: true }, BRICKS_TICK_MS);
    expect(launched.waiting).toBe(false);
    expect(launched.ballDy).toBeLessThan(0);
    expect(Math.abs(launched.ballDx) + Math.abs(launched.ballDy)).toBe(launched.speed);
    const moved = step(launched, {}, BRICKS_TICK_MS * 2);
    expect(moved.ballY).toBeLessThan(launched.ballY);
    checkInvariants(moved);
  });

  it("rides the paddle while it waits", () => {
    const state = createBricks(1, 0);
    const pushed = step(state, { paddle: 1 }, BRICKS_TICK_MS);
    expect(pushed.paddleLeft).toBe(PADDLE_CENTRE + 8);
    expect(pushed.ballX).toBe(PADDLE_CENTRE + 8 + BRICKS_PADDLE_WIDTH / 2);
    // The paddle never leaves the field.
    let pushedFar = pushed;
    for (let tick = 2; tick <= 20; tick += 1) {
      pushedFar = step(pushedFar, { paddle: 1 }, BRICKS_TICK_MS * tick);
    }
    expect(pushedFar.paddleLeft).toBe(FIELD_WIDTH - BRICKS_PADDLE_WIDTH);
  });
});

describe("collisions", () => {
  it("bounces off the top wall", () => {
    const state = stateWith({
      bricks: bricksOf(3, [[2, 12]]),
      brickRows: 3,
      waiting: false,
      ballX: 60,
      ballY: 4,
      ballDx: 2,
      ballDy: -2,
    });
    const after = step(state, {}, BRICKS_TICK_MS);
    expect(after.ballY).toBe(BRICKS_BALL_RADIUS);
    expect(after.ballDy).toBe(2);
    expect(after.ballX).toBe(62);
    checkInvariants(after);
  });

  it("bounces off the paddle, and the edge of the paddle sends the ball sideways", () => {
    const centre = stateWith({
      bricks: bricksOf(3, [[2, 12]]),
      brickRows: 3,
      waiting: false,
      ballX: PADDLE_CENTRE + BRICKS_PADDLE_WIDTH / 2,
      ballY: PADDLE_TOP - BRICKS_BALL_RADIUS - 2,
      ballDx: 0,
      ballDy: 4,
    });
    const bounced = step(centre, {}, BRICKS_TICK_MS);
    // Dead centre: a small sideways nudge and a steep climb back.
    expect(bounced.ballDy).toBeLessThan(0);
    expect(bounced.ballDx).toBe(1);
    expect(bounced.ballY).toBe(PADDLE_TOP - BRICKS_BALL_RADIUS);
    const edge = stateWith({
      bricks: bricksOf(3, [[2, 12]]),
      brickRows: 3,
      waiting: false,
      ballX: PADDLE_CENTRE + 2,
      ballY: PADDLE_TOP - BRICKS_BALL_RADIUS - 2,
      ballDx: 0,
      ballDy: 4,
    });
    const sent = step(edge, {}, BRICKS_TICK_MS);
    expect(sent.ballDx).toBeLessThan(0);
    expect(sent.ballDy).toBeLessThan(0);
    expect(Math.abs(sent.ballDx) + Math.abs(sent.ballDy)).toBe(sent.speed);
  });

  it("takes a brick from below and scores it", () => {
    // The brick is row 4, columns 6..6, so its box is y 70..80 and x 60..70.
    const state = stateWith({
      // A second brick keeps the wall standing, so this stays a collision test
      // rather than a level change.
      bricks: bricksOf(5, [[4, 6], [0, 0]]),
      brickRows: 5,
      waiting: false,
      ballX: 65,
      ballY: 85,
      ballDx: 0,
      ballDy: -3,
    });
    const after = step(state, {}, BRICKS_TICK_MS);
    expect(after.bricks[4 * BRICKS_COLUMNS + 6]).toBe(false);
    expect(after.score).toBe(BRICKS_BRICK_POINTS);
    expect(after.ballDy).toBe(3);
    // Pushed out of the brick's underside: y 80 plus the radius.
    expect(after.ballY).toBe(80 + BRICKS_BALL_RADIUS);
    checkInvariants(after);
  });

  it("takes a brick from the side and sends the ball back across", () => {
    const state = stateWith({
      bricks: bricksOf(5, [[4, 6], [0, 0]]),
      brickRows: 5,
      waiting: false,
      ballX: 55,
      ballY: 75,
      ballDx: 3,
      ballDy: 0,
    });
    const after = step(state, {}, BRICKS_TICK_MS);
    expect(after.bricks[4 * BRICKS_COLUMNS + 6]).toBe(false);
    expect(after.ballDx).toBe(-3);
    expect(after.ballX).toBe(60 - BRICKS_BALL_RADIUS);
  });

  it("takes at most one brick in a tick", () => {
    // Two bricks side by side under a ball wide enough to touch both: only the
    // first is taken, so one bounce can never be worth two bricks.
    const state = stateWith({
      bricks: bricksOf(5, [[4, 6], [4, 7]]),
      brickRows: 5,
      waiting: false,
      ballX: 70,
      ballY: 85,
      ballDx: 0,
      ballDy: -3,
    });
    const after = step(state, {}, BRICKS_TICK_MS);
    expect(after.score).toBe(BRICKS_BRICK_POINTS);
    expect(bricksRemaining(after)).toBe(1);
  });
});

describe("losing and winning", () => {
  it("loses a life on the floor and puts the ball back on the paddle", () => {
    const state = stateWith({
      bricks: bricksOf(3, [[2, 12]]),
      brickRows: 3,
      waiting: false,
      ballX: 5,
      ballY: FIELD_HEIGHT,
      ballDx: 1,
      ballDy: 4,
    });
    const after = step(state, {}, BRICKS_TICK_MS);
    expect(after.lives).toBe(BRICKS_LIVES - 1);
    expect(after.waiting).toBe(true);
    expect(after.ballY).toBe(PADDLE_TOP - BRICKS_BALL_RADIUS);
    expect(after.over).toBe(false);
  });

  it("ends the game when the last life is lost, and then stays ended", () => {
    const state = stateWith({
      bricks: bricksOf(3, [[2, 12]]),
      brickRows: 3,
      lives: 1,
      waiting: false,
      ballX: 5,
      ballY: FIELD_HEIGHT,
      ballDx: 1,
      ballDy: 4,
    });
    const after = step(state, {}, BRICKS_TICK_MS);
    expect(after.over).toBe(true);
    expect(after.lives).toBe(0);
    expect(step(after, {}, BRICKS_TICK_MS * 10)).toBe(after);
  });

  it("clears the wall, pays the bonus and draws the next level", () => {
    const state = stateWith({
      bricks: bricksOf(5, [[4, 6]]),
      brickRows: 5,
      waiting: false,
      ballX: 65,
      ballY: 85,
      ballDx: 0,
      ballDy: -3,
    });
    const after = step(state, {}, BRICKS_TICK_MS);
    expect(after.level).toBe(2);
    expect(after.cleared).toBe(1);
    expect(after.score).toBe(BRICKS_BRICK_POINTS + BRICKS_LEVEL_BONUS);
    expect(after.speed).toBe(bricksSpeed(2));
    expect(after.waiting).toBe(true);
    expect(after.brickRows).toBe(4);
    expect(bricksRemaining(after)).toBeGreaterThan(0);
    checkInvariants(after);
  });
});

describe("a replayed game", () => {
  it("ends in exactly the same state from the same seed and input log", () => {
    // The log: launch on the first tick, then push the paddle right and left on
    // a fixed cycle. Every reading is the same in both runs, so the game is a
    // function of (seed, log) and the final state is pinned below.
    const play = (): BricksState => {
      let state = createBricks(20261009, 0);
      let now = 0;
      for (let tick = 1; tick <= 600; tick += 1) {
        now += BRICKS_TICK_MS;
        const paddle: -1 | 0 | 1 = tick % 60 < 20 ? 1 : tick % 60 < 40 ? -1 : 0;
        state = step(state, tick === 1 ? { launch: true } : { paddle }, now);
      }
      return state;
    };
    const first = play();
    const again = play();
    expect(again).toEqual(first);
    checkInvariants(first);
    expect(first.ticks).toBe(600);
    expect(first.lastTickAt).toBe(600 * BRICKS_TICK_MS);
    expect(first.over).toBe(false);
    // Pinned from the run this test was written against. The bricks are listed
    // as the cells still standing, which is the half of the state a change to
    // the collision order would move first.
    expect(
      first.bricks.flatMap((brick, at) => (brick ? [at] : [])),
    ).toEqual([0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 30, 34, 37, 38]);
    expect({
      brickRows: first.brickRows,
      paddleLeft: first.paddleLeft,
      ballX: first.ballX,
      ballY: first.ballY,
      ballDx: first.ballDx,
      ballDy: first.ballDy,
      waiting: first.waiting,
      speed: first.speed,
      lives: first.lives,
      score: first.score,
      level: first.level,
      cleared: first.cleared,
      over: first.over,
      ticks: first.ticks,
      rngState: first.rngState,
      lastTickAt: first.lastTickAt,
    }).toEqual({
      brickRows: 3,
      paddleLeft: 8,
      ballX: 28,
      ballY: 187,
      ballDx: 0,
      ballDy: 0,
      waiting: true,
      speed: 4,
      lives: 2,
      score: 30,
      level: 1,
      cleared: 0,
      over: false,
      ticks: 600,
      rngState: 2731850980,
      lastTickAt: 600 * BRICKS_TICK_MS,
    });
    // The opening level for this seed, for the same reason.
    expect(bricksRemaining(createBricks(20261009, 0))).toBe(30);
  });
});

describe("the field the engine assumes", () => {
  it("is thirteen wide and twenty-two tall with the wall three rows down", () => {
    expect(BRICKS_COLUMNS).toBe(13);
    expect(BRICKS_ROWS).toBe(22);
    expect(BRICKS_BRICK_TOP).toBe(3);
  });
});
