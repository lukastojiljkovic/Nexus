/**
 * Bricks — a ball, a paddle and walls of brick, as a pure engine with the same
 * entry point as the snake: `step(state, input, now)`.
 *
 * **Our own field, our own levels.** Nothing here is taken from any existing
 * game's design: the field is thirteen cells by twenty-two, the layout of each
 * level is DRAWN from the state's own random stream, and the numbers (paddle
 * speed, brick worth, the speed ramp) were chosen here and are asserted by the
 * tests. A brick is one cell, the field is measured in tenths of a cell, and
 * every quantity is an integer, so the arithmetic is exact on every machine.
 *
 * **The tick is fixed, and the speed never reaches a whole cell a tick.**
 * `BRICKS_TICK_MS` is the rung the engine expects to be called at, and the ball
 * moves `BRICKS_BASE_SPEED + level - 1` tenths per tick, capped at
 * `BRICKS_MAX_SPEED` = 9. That cap is not tuning: a ball moving ten tenths or
 * more in one tick could pass through a brick row without ever overlapping it,
 * and the collision test is a rectangle overlap rather than a swept ray. The cap
 * is what keeps the simple test sufficient.
 *
 * **Deterministic in the order of its own steps.** One tick means: move the
 * paddle, move the ball, bounce off the walls, maybe the paddle, at most ONE
 * brick, then check the floor and the cleared level. Nothing in the order is
 * arbitrary — a test that pins a whole game depends on it — and it is written
 * down here so a later change has to be a decision.
 *
 * **The seed is what makes levels.** A level's bricks are drawn from
 * `rngState`, so two machines with the same seed see the same walls, and the
 * report of a game is a seed plus an input log.
 */

import type { PuzzleRandom } from "../puzzles-shared/random.js";
import { createPuzzleRandom } from "../puzzles-shared/random.js";

export const BRICKS_COLUMNS = 13;
export const BRICKS_ROWS = 22;

/** The rung the caller is expected to step at, and how many ticks one call may run. */
export const BRICKS_TICK_MS = 16;
export const BRICKS_MAX_TICKS_PER_STEP = 4;

export const BRICKS_LIVES = 3;
export const BRICKS_BRICK_POINTS = 10;
export const BRICKS_LEVEL_BONUS = 100;

/** A tenth of a cell is the unit everything is measured in. */
export const BRICKS_TENTHS = 10;
export const BRICKS_BALL_RADIUS = 3;
export const BRICKS_PADDLE_WIDTH = 40;
export const BRICKS_PADDLE_HEIGHT = 10;
export const BRICKS_PADDLE_SPEED = 8;

/** How many rows of bricks a level may carry, and where the field starts. */
export const BRICKS_MAX_BRICK_ROWS = 7;
export const BRICKS_BRICK_TOP = 3;

/** The chance a cell of a drawn level is a brick; a layout is redrawn if it is empty. */
const BRICKS_FILL_CHANCE = 0.75;

/**
 * The ball's speed in tenths per tick at a level, and the ceiling on it. Nine,
 * because ten would let the ball cross a whole brick row between two ticks.
 */
export const BRICKS_BASE_SPEED = 4;
export const BRICKS_MAX_SPEED = 9;

export function bricksSpeed(level: number): number {
  return Math.min(BRICKS_MAX_SPEED, BRICKS_BASE_SPEED + (level - 1));
}

export interface BricksInput {
  /** Which way the paddle is being pushed: left, none, right. */
  readonly paddle?: -1 | 0 | 1;
  /** Asked for this step; only does anything while the ball is waiting on the paddle. */
  readonly launch?: boolean;
}

export interface BricksState {
  readonly columns: number;
  readonly rows: number;
  /** `columns * brickRows` cells, row-major, `true` where a brick still stands. */
  readonly bricks: readonly boolean[];
  readonly brickRows: number;
  /** The paddle's left edge, in tenths. */
  readonly paddleLeft: number;
  /** The ball's centre, in tenths. */
  readonly ballX: number;
  readonly ballY: number;
  /** Tenths per tick. */
  readonly ballDx: number;
  readonly ballDy: number;
  /** True while the ball rides the paddle, waiting to be launched. */
  readonly waiting: boolean;
  readonly speed: number;
  readonly lives: number;
  readonly score: number;
  readonly level: number;
  readonly cleared: number;
  readonly over: boolean;
  readonly ticks: number;
  readonly rngState: number;
  readonly lastTickAt: number;
  readonly seed: number;
}

/** How many bricks are still standing. */
export function bricksRemaining(state: BricksState): number {
  return state.bricks.filter(Boolean).length;
}

/** The field's width and the height the floor sits at, in tenths. */
function fieldWidth(state: { columns: number }): number {
  return state.columns * BRICKS_TENTHS;
}

function fieldHeight(state: { rows: number }): number {
  return state.rows * BRICKS_TENTHS;
}

/** Where the ball sits while it waits, and where the paddle is centred to start. */
function paddleCentre(state: { columns: number; rows: number }): number {
  return Math.floor((fieldWidth(state) - BRICKS_PADDLE_WIDTH) / 2);
}

function paddleTop(state: { rows: number }): number {
  return fieldHeight(state) - BRICKS_PADDLE_HEIGHT - 2 * BRICKS_TENTHS;
}

/**
 * One level's bricks, drawn from the stream: `2 + level` rows up to the ceiling,
 * each cell a brick with probability three quarters. An empty draw is redrawn,
 * because a level with no bricks in it would be over before it was played.
 */
function drawBricks(
  random: PuzzleRandom,
  columns: number,
  level: number,
): { bricks: boolean[]; brickRows: number } {
  const brickRows = Math.min(BRICKS_MAX_BRICK_ROWS, 2 + level);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const bricks = new Array<boolean>(columns * brickRows);
    let standing = 0;
    for (let cell = 0; cell < bricks.length; cell += 1) {
      const brick = random.next() < BRICKS_FILL_CHANCE;
      bricks[cell] = brick;
      if (brick) standing += 1;
    }
    if (standing > 0) return { bricks, brickRows };
  }
  // Sixty-four empty draws in a row is not a layout question: treat it as the
  // stream being broken rather than shipping an empty level.
  throw new Error("drawBricks: the stream never produced a brick");
}

/** The velocity the ball leaves the paddle with, at `speed` tenths a tick. */
function launchVelocity(speed: number, horizontal: 1 | -1): { dx: number; dy: number } {
  const across = Math.max(1, speed >> 1);
  return { dx: horizontal * across, dy: -(speed - across) };
}

/** A fresh game: level one drawn, the ball waiting on the paddle, three lives. */
export function createBricks(seed: number, now: number): BricksState {
  const random = createPuzzleRandom(seed);
  const { bricks, brickRows } = drawBricks(random, BRICKS_COLUMNS, 1);
  const skeleton = { columns: BRICKS_COLUMNS, rows: BRICKS_ROWS };
  const paddleLeft = paddleCentre(skeleton);
  return {
    ...skeleton,
    bricks,
    brickRows,
    paddleLeft,
    ballX: paddleLeft + BRICKS_PADDLE_WIDTH / 2,
    ballY: paddleTop(skeleton) - BRICKS_BALL_RADIUS,
    ballDx: 0,
    ballDy: 0,
    waiting: true,
    speed: bricksSpeed(1),
    lives: BRICKS_LIVES,
    score: 0,
    level: 1,
    cleared: 0,
    over: false,
    ticks: 0,
    rngState: random.state,
    lastTickAt: now,
    seed,
  };
}

/**
 * One call of the game. The paddle is moved first and the ball second, so the
 * ball is reflected by the paddle's new position rather than the one it was
 * under; at most one brick is taken per tick, so a corner cannot score twice for
 * one bounce.
 */
export function step(state: BricksState, input: BricksInput, now: number): BricksState {
  if (state.over) return state;
  let draft = state;
  let moved = 0;
  let lastTickAt = draft.lastTickAt;
  while (!draft.over && now - lastTickAt >= BRICKS_TICK_MS) {
    if (moved >= BRICKS_MAX_TICKS_PER_STEP) {
      lastTickAt = now;
      break;
    }
    lastTickAt += BRICKS_TICK_MS;
    draft = tick(draft, input);
    moved += 1;
  }
  if (draft === state && lastTickAt === state.lastTickAt) return state;
  return { ...draft, lastTickAt };
}

function tick(state: BricksState, input: BricksInput): BricksState {
  const width = fieldWidth(state);
  const height = fieldHeight(state);
  let paddleLeft = state.paddleLeft + (input.paddle ?? 0) * BRICKS_PADDLE_SPEED;
  paddleLeft = Math.max(0, Math.min(width - BRICKS_PADDLE_WIDTH, paddleLeft));
  const top = paddleTop(state);
  const ticks = state.ticks + 1;

  if (state.waiting) {
    const ballX = paddleLeft + BRICKS_PADDLE_WIDTH / 2;
    const ballY = top - BRICKS_BALL_RADIUS;
    if (input.launch !== true) {
      return { ...state, paddleLeft, ballX, ballY, ticks };
    }
    const velocity = launchVelocity(state.speed, 1);
    return {
      ...state,
      paddleLeft,
      ballX,
      ballY,
      ballDx: velocity.dx,
      ballDy: velocity.dy,
      waiting: false,
      ticks,
    };
  }

  const previousY = state.ballY;
  let ballX = state.ballX + state.ballDx;
  let ballY = previousY + state.ballDy;
  let ballDx = state.ballDx;
  let ballDy = state.ballDy;
  const radius = BRICKS_BALL_RADIUS;

  if (ballX - radius < 0) {
    ballX = radius;
    ballDx = Math.abs(ballDx);
  } else if (ballX + radius > width) {
    ballX = width - radius;
    ballDx = -Math.abs(ballDx);
  }
  if (ballY - radius < 0) {
    ballY = radius;
    ballDy = Math.abs(ballDy);
  }

  let score = state.score;
  let bricks = state.bricks;
  let brickRows = state.brickRows;
  let level = state.level;
  let cleared = state.cleared;
  let speed = state.speed;
  let lives = state.lives;
  let over = false;
  let rngState = state.rngState;
  let waiting = false;

  // The paddle, only on the way down and only if the ball crossed its top edge
  // rather than being below it.
  if (ballDy > 0 && ballY + radius >= top && previousY + radius <= top) {
    if (ballX + radius >= paddleLeft && ballX - radius <= paddleLeft + BRICKS_PADDLE_WIDTH) {
      ballY = top - radius;
      const centre = paddleLeft + BRICKS_PADDLE_WIDTH / 2;
      const offset = (ballX - centre) / (BRICKS_PADDLE_WIDTH / 2);
      let across = Math.round(offset * (speed - 1));
      across = Math.max(-(speed - 1), Math.min(speed - 1, across));
      if (across === 0) across = offset < 0 ? -1 : 1;
      ballDx = across;
      ballDy = -(speed - Math.abs(across));
    }
  }

  // At most one brick a tick, taken row by row from the top, then resolved by
  // which axis the ball is least inside the brick: the shallower overlap is the
  // face it came through, and the ball is pushed back out of that face.
  const hit = firstBrickHit(state, ballX, ballY, radius);
  if (hit !== null) {
    const standing = [...bricks];
    standing[hit] = false;
    bricks = standing;
    score += BRICKS_BRICK_POINTS;
    const row = Math.floor(hit / state.columns);
    const column = hit % state.columns;
    const brickLeft = column * BRICKS_TENTHS;
    const brickRight = brickLeft + BRICKS_TENTHS;
    const brickTop = (BRICKS_BRICK_TOP + row) * BRICKS_TENTHS;
    const brickBottom = brickTop + BRICKS_TENTHS;
    const overlapX =
      Math.min(brickRight, ballX + radius) - Math.max(brickLeft, ballX - radius);
    const overlapY =
      Math.min(brickBottom, ballY + radius) - Math.max(brickTop, ballY - radius);
    if (overlapX < overlapY) {
      ballX = ballDx > 0 ? brickLeft - radius : brickRight + radius;
      ballDx = -ballDx;
    } else {
      ballY = ballDy > 0 ? brickTop - radius : brickBottom + radius;
      ballDy = -ballDy;
    }
  }

  if (ballY - radius > height) {
    lives -= 1;
    if (lives <= 0) {
      over = true;
    } else {
      waiting = true;
      ballX = paddleLeft + BRICKS_PADDLE_WIDTH / 2;
      ballY = top - radius;
      ballDx = 0;
      ballDy = 0;
    }
  } else if (bricks.every((brick) => !brick)) {
    // The wall is down: the next level's bricks come from the same stream, so
    // the level that follows is a function of the seed too.
    level += 1;
    score += BRICKS_LEVEL_BONUS;
    cleared += 1;
    speed = bricksSpeed(level);
    const random = createPuzzleRandom(rngState);
    const drawn = drawBricks(random, state.columns, level);
    bricks = drawn.bricks;
    brickRows = drawn.brickRows;
    rngState = random.state;
    waiting = true;
    paddleLeft = paddleCentre(state);
    ballX = paddleLeft + BRICKS_PADDLE_WIDTH / 2;
    ballY = top - radius;
    ballDx = 0;
    ballDy = 0;
  }

  return {
    ...state,
    bricks,
    brickRows,
    paddleLeft,
    ballX,
    ballY,
    ballDx,
    ballDy,
    waiting,
    speed,
    lives,
    score,
    level,
    cleared,
    over,
    ticks,
    rngState,
  };
}

/**
 * The first standing brick the ball's box overlaps, or `null`. Row-major order,
 * so which brick a corner takes is decided and not a matter of iteration order.
 */
function firstBrickHit(
  state: BricksState,
  ballX: number,
  ballY: number,
  radius: number,
): number | null {
  const left = ballX - radius;
  const right = ballX + radius;
  const topEdge = ballY - radius;
  const bottomEdge = ballY + radius;
  for (let row = 0; row < state.brickRows; row += 1) {
    const brickTop = (BRICKS_BRICK_TOP + row) * BRICKS_TENTHS;
    if (bottomEdge <= brickTop || topEdge >= brickTop + BRICKS_TENTHS) continue;
    for (let column = 0; column < state.columns; column += 1) {
      const index = row * state.columns + column;
      if (state.bricks[index] !== true) continue;
      const brickLeft = column * BRICKS_TENTHS;
      if (right <= brickLeft || left >= brickLeft + BRICKS_TENTHS) continue;
      return index;
    }
  }
  return null;
}
