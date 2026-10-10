import {
  BLOCKS_TICK_MS,
  type BlocksInput,
  type SnakeDirection,
  type Tile2048Move,
} from "@nexus/core";

/**
 * What a key means to each game, as pure functions of `KeyboardEvent.key`
 * (ADR-090): the mapping the page applies, and the two rates a held key needs.
 *
 * **Why the mapping is data rather than a listener per game.** Five games map
 * five sets of keys onto five engines' vocabularies, and the only way any of that
 * can be checked is by asking the function what a key means - which a test can do
 * and a `keydown` handler cannot. So each game's listener is three lines: read
 * `event.key`, ask this module, hand what comes back to its own queue.
 *
 * **Every game is keyboard-first, and the arrows are the base.** A letter alias
 * is offered where the classic game has one (WASD for the four direction games),
 * and nothing here claims a key a text field could want: these listeners live on
 * the page's own canvas, which holds focus only when the page put it there.
 *
 * **The repeat rates are whole ticks of the engine's own clock.** Blocks steps at
 * `BLOCKS_TICK_MS`, so a delay stated in ticks cannot be shorter than a step the
 * engine can act on: the shift delay is eight ticks (128 ms), the repeat two
 * (32 ms) - about thirty cells a second, which is a piece a player can steer -
 * and a held soft drop is the same two ticks, which is two and a half rows a
 * frame-free second against a level-one gravity of one row per 800 ms. The ratios
 * are our own tuning; the unit is the engine's.
 */

/** Milliseconds a sideways key is held before it starts repeating, and the interval it repeats at. */
export const BLOCKS_DAS_MS = 8 * BLOCKS_TICK_MS;
export const BLOCKS_ARR_MS = 2 * BLOCKS_TICK_MS;
/** Milliseconds between the rows a held soft drop asks for. */
export const BLOCKS_SOFT_DROP_MS = 2 * BLOCKS_TICK_MS;

/** `event.key` as this module compares it: a single character is case-folded, a named key is left alone. */
function normalise(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * What one key asks Blocks for, or `null` for a key it does not use.
 *
 * The two rotations are on two keys because a player turning a piece either way
 * needs both, and `Shift` holds because the game's own vocabulary has a slot for
 * it - a piece is held once per piece, which is the engine's rule and not this
 * map's.
 */
export function blocksActionFor(key: string): BlocksInput | null {
  switch (normalise(key)) {
    case "ArrowLeft":
    case "a":
      return "left";
    case "ArrowRight":
    case "d":
      return "right";
    case "ArrowUp":
    case "w":
    case "x":
      return "rotateCW";
    case "z":
      return "rotateCCW";
    case "ArrowDown":
    case "s":
      return "softDrop";
    case " ":
      return "hardDrop";
    case "c":
    case "Shift":
      return "hold";
    default:
      return null;
  }
}

/** The direction a key steers with, for the three games that have one. */
export function directionFor(key: string): SnakeDirection | null {
  switch (normalise(key)) {
    case "ArrowUp":
    case "w":
      return "up";
    case "ArrowDown":
    case "s":
      return "down";
    case "ArrowLeft":
    case "a":
      return "left";
    case "ArrowRight":
    case "d":
      return "right";
    default:
      return null;
  }
}

/** The move a key plays on the 2048 board, or `null`. Its own alias for the direction, because a tile board has no `turn`. */
export function tile2048MoveFor(key: string): Tile2048Move | null {
  const direction = directionFor(key);
  return direction === null ? null : MOVES[direction];
}

/** `SnakeDirection` and `Tile2048Move` are the same four words; this is the one place that fact is written down. */
const MOVES: Readonly<Record<SnakeDirection, Tile2048Move>> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
};

/** Whether a key asks 2048 for the one step of undo the engine keeps. */
export function isUndoKey(key: string): boolean {
  return normalise(key) === "u";
}

/**
 * Which way the brick paddle is being pushed, from the keys currently down.
 *
 * Both at once is no direction at all rather than the more recent one: the engine
 * takes a single direction per tick, and "the last key pressed wins" would need
 * this map to remember an order it has no business holding. A player holding both
 * has asked for nothing.
 */
export function paddleFor(keys: ReadonlySet<string>): -1 | 0 | 1 {
  const left = [...keys].some((key) => normalise(key) === "ArrowLeft" || normalise(key) === "a");
  const right = [...keys].some((key) => normalise(key) === "ArrowRight" || normalise(key) === "d");
  if (left === right) return 0;
  return left ? -1 : 1;
}

/** The step a Minesweeper cursor key makes, or `null`. Never diagonal: the cursor moves one cell at a time. */
export function minesweeperStepFor(key: string): { readonly dx: number; readonly dy: number } | null {
  const direction = directionFor(key);
  switch (direction) {
    case "up":
      return { dx: 0, dy: -1 };
    case "down":
      return { dx: 0, dy: 1 };
    case "left":
      return { dx: -1, dy: 0 };
    case "right":
      return { dx: 1, dy: 0 };
    default:
      return null;
  }
}

/** Whether a key opens the cell the cursor is on. */
export function isRevealKey(key: string): boolean {
  return key === " " || key === "Enter";
}

/** Whether a key puts a flag on the cell the cursor is on (and cycles it, when the module has questions on). */
export function isMarkKey(key: string): boolean {
  return normalise(key) === "f";
}

/** Whether a key asks the board to open the cell's neighbours - the chord, on the keyboard. */
export function isChordKey(key: string): boolean {
  return normalise(key) === "c";
}
