/**
 * BLOCKS' pure engine — the falling-blocks game that is not called by a
 * trademarked name (see `pieces.ts`), and whose only clock is the `now` the
 * caller passes in.
 *
 * **One function does everything: `step(state, input, now)`.** Gravity, a
 * sideways nudge, a rotation, a drop, a hold, a lock, a line clear — every one of
 * them is that call, and the whole model is a VALUE that comes back. That is what
 * makes the game deterministic: `createBlocks(seed, t0)` followed by a list of
 * `(input, now)` pairs always produces the same board and the same score, so a
 * test replays a game exactly and a report that carries its seed and its input
 * log is a reproduction.
 *
 * **The state is a plain value, and the engine never mutates the one it is
 * handed.** A step copies the arrays it might write — the board, the queue and
 * the bag — into a private draft, works on that, and returns a new state; the
 * caller's state is untouched from the first line to the last. The random stream
 * travels the same way: the draft resumes from `state.rngState` and writes the
 * position back on the way out, which is the only reason a `step` can be pure and
 * still deal pieces.
 *
 * **Time is a monotonic millisecond reading, not a wall clock.** `now` is
 * whatever the caller's clock says (`performance.now()` in main), and only its
 * DIFFERENCES matter: gravity accumulates the interval between two steps, and the
 * lock delay counts from the step at which the piece came to rest. A system clock
 * that steps backwards would stall a falling piece, so this module reads none, and
 * a step whose `now` is behind the last one contributes zero elapsed time rather
 * than a negative one.
 *
 * **The fixed tick is the caller's.** A step is not a frame — nothing here
 * interpolates, and a caller that stepped twice in one millisecond would get two
 * ticks with no time between them. What the tick size decides is how finely a held
 * key repeats and how fine the gravity granularity is, which is why
 * `BLOCKS_TICK_MS` is exported beside the engine rather than hidden in the
 * renderer.
 */

import type { BlockCell, BlockPieceId } from "./pieces.js";
import { BLOCKS_PIECE_IDS, pieceCells, pieceFrame } from "./pieces.js";
import type { SeededRandom } from "../random.js";
import { createSeededRandom, shuffled } from "../random.js";

/** Twelve wide, twenty-two tall — NOT the ten-by-twenty field the trademarked game is drawn on, on purpose. */
export const BLOCKS_COLUMNS = 12;
export const BLOCKS_ROWS = 22;
export const BLOCKS_BOARD_CAPACITY = BLOCKS_COLUMNS * BLOCKS_ROWS;

/** How many pieces the player can see coming. Three, because two is not enough to plan a well and four is clutter. */
export const BLOCKS_PREVIEW_COUNT = 3;

/**
 * The tick the caller is expected to step at: 60 steps a second, in whole
 * milliseconds. Exported so main and the renderer cannot disagree about it.
 */
export const BLOCKS_TICK_MS = 16;

/** How long a piece may rest before it locks. */
export const BLOCKS_LOCK_DELAY_MS = 500;

/**
 * How many times a move or a rotation may restart that delay, per time the piece
 * comes to rest. Fifteen: high enough that a player correcting an overhang is
 * never cut short, low enough that wiggling a piece cannot keep it in play
 * forever.
 */
export const BLOCKS_MAX_LOCK_RESETS = 15;

/** Lines per level. */
export const BLOCKS_LINES_PER_LEVEL = 10;

/**
 * Our own scoring table, indexed by the number of rows cleared in one lock and
 * multiplied by the level the clear happened at.
 *
 * The SHAPE is the decision rather than the numbers: clearing more at once is
 * worth more than the sum of the clears it replaces (100 + 100 + 100 < 600),
 * which is what rewards building a well instead of scraping four single lines.
 */
export const BLOCKS_CLEAR_SCORES: readonly number[] = [0, 100, 300, 600, 1000];

/** Points per row for a soft drop, and for a hard drop — the hard drop is worth more because it is committed. */
export const BLOCKS_SOFT_DROP_POINTS = 1;
export const BLOCKS_HARD_DROP_POINTS = 2;

/** Gravity at level 1, the 70 ms shaved off per level, and the floor it never goes below. */
export const BLOCKS_GRAVITY_BASE_MS = 800;
export const BLOCKS_GRAVITY_STEP_MS = 70;
export const BLOCKS_GRAVITY_MIN_MS = 80;

/**
 * The offsets a rotation is allowed to try, in order, when the rotated piece does
 * not fit where it stands: exactly as it is, one column left, one column right,
 * one row up. **Our own list, not a published kick table** — those three are the
 * offsets this board's geometry can actually need (a bar in the last column
 * turning horizontal needs the left shift, a piece resting on the floor needs the
 * upward one), and nothing measured elsewhere is reproduced here.
 */
const ROTATION_KICKS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
];

/** `playing` until a piece cannot be dealt, which is the only way this game ends. */
export type BlocksStatus = "playing" | "over";

/** One piece in play: which shape, which quarter turn, and where its frame's top-left corner sits on the board. */
export interface BlocksPiece {
  id: BlockPieceId;
  /** Quarter turns clockwise from the spawn orientation, 0–3. */
  rotation: number;
  /** Board column of the frame's column 0. */
  x: number;
  /** Board row of the frame's row 0. */
  y: number;
}

/**
 * One action per step — the shape a key event and a fixed tick produce between
 * them. A held key is the caller's business: the renderer sends `softDrop` once
 * per tick while the key is down, which is what makes a soft drop a rate the
 * player can feel rather than one jump.
 */
export type BlocksInput =
  | "none"
  | "left"
  | "right"
  | "rotateCW"
  | "rotateCCW"
  | "softDrop"
  | "hardDrop"
  | "hold";

/** One game, as a value. */
export interface BlocksState {
  /** `BLOCKS_BOARD_CAPACITY` entries, row-major from the top: entry `row * columns + column`. A settled cell holds the piece it came from; an empty one holds null. */
  readonly board: readonly (BlockPieceId | null)[];
  active: BlocksPiece | null;
  /** The pieces after the active one; `next[0]` is dealt next. Always `BLOCKS_PREVIEW_COUNT` long while the game runs. */
  next: readonly BlockPieceId[];
  /** What is left of the shuffled bag the queue is dealt from. */
  bag: readonly BlockPieceId[];
  /** The 32-bit position of the bag's stream — carried in the state so a replay resumes the exact sequence. */
  rngState: number;
  /** The piece in the hold slot, or null. One slot, and one use per piece. */
  hold: BlockPieceId | null;
  /** True once the player has held the current piece; cleared when the next one locks. */
  holdUsed: boolean;
  score: number;
  lines: number;
  level: number;
  status: BlocksStatus;
  /** Milliseconds accumulated towards the next gravity step. */
  gravityAccMs: number;
  /** The `now` of the last step, which is what the next one measures its elapsed time against. */
  lastTickAt: number;
  /** The `now` at which the active piece came to rest, or null while it can still fall. */
  restingSinceMs: number | null;
  /** Lock-delay restarts used since the piece last came to rest, capped at `BLOCKS_MAX_LOCK_RESETS`. */
  lockResets: number;
}

/** The engine's private working copy. The state handed back is built from this; the state handed in is never touched. */
interface Draft {
  board: (BlockPieceId | null)[];
  active: BlocksPiece | null;
  next: BlockPieceId[];
  bag: BlockPieceId[];
  random: SeededRandom;
  hold: BlockPieceId | null;
  holdUsed: boolean;
  score: number;
  lines: number;
  level: number;
  status: BlocksStatus;
  gravityAccMs: number;
  restingSinceMs: number | null;
  lockResets: number;
}

/** How long gravity waits between single-row falls at `level`, floored so the top of the curve stays playable. */
export function gravityIntervalMs(level: number): number {
  return Math.max(
    BLOCKS_GRAVITY_MIN_MS,
    BLOCKS_GRAVITY_BASE_MS - (level - 1) * BLOCKS_GRAVITY_STEP_MS,
  );
}

/** The level a total line count earns: one, and one more for every ten lines. */
export function levelForLines(lines: number): number {
  return 1 + Math.floor(lines / BLOCKS_LINES_PER_LEVEL);
}

/** What a clear of `lines` rows is worth at `level`. A count past four is not a clear this board can produce, and is worth nothing rather than being guessed at. */
export function lineScore(lines: number, level: number): number {
  return (BLOCKS_CLEAR_SCORES[lines] ?? 0) * level;
}

function emptyBoard(): (BlockPieceId | null)[] {
  return new Array<BlockPieceId | null>(BLOCKS_BOARD_CAPACITY).fill(null);
}

/** The board cells a piece covers as it stands. */
function cellsOf(piece: BlocksPiece): BlockCell[] {
  return pieceCells(piece.id, piece.rotation).map((cell) => ({
    x: piece.x + cell.x,
    y: piece.y + cell.y,
  }));
}

/**
 * Whether the piece would collide if it moved by `(dx, dy)`.
 *
 * Four walls and the settled board, and the ceiling counts: a piece never exists
 * above row 0. That refuses the upward kick when the piece is already as high as
 * it goes, which is the one case where the kick would put a cell somewhere the
 * board cannot draw — the alternative is a second coordinate system for cells
 * that are off-screen, and nothing on this board needs one.
 */
function collides(
  board: readonly (BlockPieceId | null)[],
  piece: BlocksPiece,
  dx = 0,
  dy = 0,
): boolean {
  for (const cell of cellsOf(piece)) {
    const x = cell.x + dx;
    const y = cell.y + dy;
    if (x < 0 || x >= BLOCKS_COLUMNS || y < 0 || y >= BLOCKS_ROWS) return true;
    if (board[y * BLOCKS_COLUMNS + x] !== null) return true;
  }
  return false;
}

/** How many single-row falls the piece has left before it rests. */
function rowsDroppable(board: readonly (BlockPieceId | null)[], piece: BlocksPiece): number {
  let rows = 0;
  while (!collides(board, piece, 0, rows + 1)) rows += 1;
  return rows;
}

function dropped(piece: BlocksPiece, rows: number): BlocksPiece {
  return { ...piece, y: piece.y + rows };
}

/** A piece of `id` in its spawn orientation, centred across the top of the board. */
function spawnOf(id: BlockPieceId): BlocksPiece {
  return {
    id,
    rotation: 0,
    x: Math.floor((BLOCKS_COLUMNS - pieceFrame(id)) / 2),
    y: 0,
  };
}

/**
 * The next piece out of the bag, refilling it by shuffling all seven when it runs
 * out — the 7-bag: every piece appears exactly once in every seven, so the worst
 * case is a known drought rather than an unlucky run of the same shape, and a
 * player can hold a plan across it.
 */
function deal(draft: Draft): BlockPieceId {
  if (draft.bag.length === 0) draft.bag = shuffled(BLOCKS_PIECE_IDS, draft.random);
  return draft.bag.shift() as BlockPieceId;
}

/**
 * The piece the queue has been SHOWING, with the queue refilled from the bag in
 * the same breath — so the queue is never short while the game runs.
 *
 * One function rather than a `shift` at each call site, and never a draw straight
 * from the bag: a spawn that ignored the preview would leave the player looking at
 * three pieces that never arrive.
 */
function dealFromQueue(draft: Draft): BlockPieceId {
  const id = draft.next.shift() as BlockPieceId;
  draft.next.push(deal(draft));
  return id;
}

function draftOf(state: BlocksState): Draft {
  return {
    board: [...state.board],
    active: state.active,
    next: [...state.next],
    bag: [...state.bag],
    random: createSeededRandom(state.rngState),
    hold: state.hold,
    holdUsed: state.holdUsed,
    score: state.score,
    lines: state.lines,
    level: state.level,
    status: state.status,
    gravityAccMs: state.gravityAccMs,
    restingSinceMs: state.restingSinceMs,
    lockResets: state.lockResets,
  };
}

function stateOf(draft: Draft, now: number): BlocksState {
  return {
    board: draft.board,
    active: draft.active,
    next: draft.next,
    bag: draft.bag,
    rngState: draft.random.state,
    hold: draft.hold,
    holdUsed: draft.holdUsed,
    score: draft.score,
    lines: draft.lines,
    level: draft.level,
    status: draft.status,
    gravityAccMs: draft.gravityAccMs,
    lastTickAt: now,
    restingSinceMs: draft.restingSinceMs,
    lockResets: draft.lockResets,
  };
}

/** A game dealt from `seed`, whose first tick is `now`. The first piece is already in play — a board with nothing falling is not a state anyone plays from. */
export function createBlocks(seed: number, now: number): BlocksState {
  const draft: Draft = {
    board: emptyBoard(),
    active: null,
    next: [],
    bag: [],
    // ONE stream, cut once: the bag is the shuffle this stream produced, and every
    // refill and every later game state continues from it.
    random: createSeededRandom(seed),
    hold: null,
    holdUsed: false,
    score: 0,
    lines: 0,
    level: 1,
    status: "playing",
    gravityAccMs: 0,
    restingSinceMs: null,
    lockResets: 0,
  };
  draft.bag = shuffled(BLOCKS_PIECE_IDS, draft.random);
  draft.active = spawnOf(deal(draft));
  draft.next = [deal(draft), deal(draft), deal(draft)];
  return stateOf(draft, now);
}

/**
 * A game built around a board and a piece order the CALLER names, instead of a
 * seed — the seam the wall kick, the floor, the line clear and the lock delay are
 * tested through, because none of those can be set up on demand by dealing pieces
 * and hoping.
 *
 * It is public rather than a test-only door, on `minesweeperFromMines`' terms: a
 * position a player can describe is a position a future screen may want to open
 * in place, and the alternative — an interface with a private back door tested
 * through it — would leave the real one unproven. The scripted pieces are handed
 * out in order and the ordinary bag finishes the game once the script runs out, so
 * everything after the setup is the same code the seeded game runs.
 */
export interface BlocksSetup {
  /** The pieces to hand out, the first one in play. At least one. */
  order: readonly BlockPieceId[];
  /** Settled cells, row-major; absent means an empty board. */
  board?: readonly (BlockPieceId | null)[];
  /** The seed the bag continues from once the script runs out. */
  seed?: number;
  /** The first tick's clock reading. */
  now?: number;
}

export function blocksFrom(setup: BlocksSetup): BlocksState {
  const order = [...setup.order];
  if (order.length === 0) throw new RangeError("BlocksSetup.order must name at least one piece");
  for (const id of order) {
    if (!BLOCKS_PIECE_IDS.includes(id)) {
      throw new TypeError(`BlocksSetup.order names no such piece: ${String(id)}`);
    }
  }
  const board = setup.board === undefined ? emptyBoard() : [...setup.board];
  if (board.length !== BLOCKS_BOARD_CAPACITY) {
    throw new RangeError(
      `BlocksSetup.board must hold ${BLOCKS_BOARD_CAPACITY} cells, got ${board.length}`,
    );
  }
  for (const cell of board) {
    if (cell !== null && !BLOCKS_PIECE_IDS.includes(cell)) {
      throw new TypeError(`BlocksSetup.board holds no such piece: ${String(cell)}`);
    }
  }

  const draft: Draft = {
    board,
    active: null,
    next: [],
    bag: order.slice(1),
    random: createSeededRandom(setup.seed ?? 0),
    hold: null,
    holdUsed: false,
    score: 0,
    lines: 0,
    level: 1,
    status: "playing",
    gravityAccMs: 0,
    restingSinceMs: null,
    lockResets: 0,
  };
  draft.active = spawnOf(order[0] as BlockPieceId);
  draft.next = [deal(draft), deal(draft), deal(draft)];
  return stateOf(draft, setup.now ?? 0);
}

/**
 * Writes the piece into the board, clears what it completed, scores it, and deals
 * the next piece. One function because those are one moment: a lock that cleared
 * lines but did not score them, or scored them at the level it was about to
 * become, is a defect with three places to hide.
 */
function lockPiece(draft: Draft): void {
  const active = draft.active;
  if (active === null) return;
  for (const cell of cellsOf(active)) draft.board[cell.y * BLOCKS_COLUMNS + cell.x] = active.id;

  const cleared = clearLines(draft.board);
  if (cleared > 0) {
    // Scored at the level the clear happened at, then the level is recomputed — so
    // the tenth line is worth what it was worth when it landed, and the speed that
    // follows is the reward rather than the score.
    draft.score += lineScore(cleared, draft.level);
    draft.lines += cleared;
    draft.level = levelForLines(draft.lines);
  }

  draft.gravityAccMs = 0;
  draft.restingSinceMs = null;
  draft.lockResets = 0;
  draft.holdUsed = false;
  const next = spawnOf(dealFromQueue(draft));
  draft.active = next;
  // The piece that cannot be dealt is KEPT as the active one, so the board shows
  // what ended the game rather than clearing to a tidier, less useful picture.
  if (collides(draft.board, next)) draft.status = "over";
}

/**
 * Removes every full row, bottom-up, and answers how many went.
 *
 * Bottom-up and re-examining the same index after each clear, so a stack that
 * clears four rows at once is four iterations of one rule rather than four special
 * cases — and so a row that falls INTO a cleared index is looked at again instead
 * of being skipped.
 */
function clearLines(board: (BlockPieceId | null)[]): number {
  let cleared = 0;
  let row = BLOCKS_ROWS - 1;
  while (row >= 0) {
    const start = row * BLOCKS_COLUMNS;
    const full = board.slice(start, start + BLOCKS_COLUMNS).every((cell) => cell !== null);
    if (!full) {
      row -= 1;
      continue;
    }
    cleared += 1;
    for (let move = row; move > 0; move -= 1) {
      board.copyWithin(move * BLOCKS_COLUMNS, (move - 1) * BLOCKS_COLUMNS, move * BLOCKS_COLUMNS);
    }
    board.fill(null, 0, BLOCKS_COLUMNS);
  }
  return cleared;
}

/**
 * Gravity for the time between two steps, in whole rows of the level's interval.
 *
 * A piece that cannot fall accumulates NOTHING: the accumulator measures time
 * towards a row the piece is able to move into, so it reads zero for as long as
 * the piece is resting (where the lock delay decides when it leaves) and it does
 * not carry a surplus into a piece that lands later. The loop re-reads the active
 * piece on every pass, because each row it gains is a row closer to the stack.
 */
function applyGravity(draft: Draft, elapsed: number): void {
  if (draft.active === null) return;
  if (collides(draft.board, draft.active, 0, 1)) {
    draft.gravityAccMs = 0;
    return;
  }
  draft.gravityAccMs += elapsed;
  const interval = gravityIntervalMs(draft.level);
  while (draft.gravityAccMs >= interval) {
    const falling = draft.active;
    if (falling === null || collides(draft.board, falling, 0, 1)) {
      draft.gravityAccMs = 0;
      return;
    }
    draft.active = dropped(falling, 1);
    draft.gravityAccMs -= interval;
  }
}

/**
 * A successful move or rotation of a RESTING piece restarts the lock delay, up to
 * `BLOCKS_MAX_LOCK_RESETS` times, so a piece cannot be kept in play by wiggling
 * it. A piece in the air has nothing to restart, and its counter belongs to the
 * next time it lands.
 */
function bumpLockDelay(draft: Draft, now: number): void {
  if (draft.restingSinceMs === null) return;
  if (draft.lockResets >= BLOCKS_MAX_LOCK_RESETS) return;
  draft.restingSinceMs = now;
  draft.lockResets += 1;
}

function move(draft: Draft, dx: number, now: number): void {
  const active = draft.active;
  if (active === null) return;
  if (collides(draft.board, active, dx, 0)) return;
  draft.active = { ...active, x: active.x + dx };
  bumpLockDelay(draft, now);
}

/** Rotates by `turns` quarter turns and tries the offsets in `ROTATION_KICKS` in order. A rotation no offset rescues does not happen at all, and the piece stays exactly where it was. */
function rotate(draft: Draft, turns: number, now: number): void {
  const active = draft.active;
  if (active === null) return;
  const rotated: BlocksPiece = { ...active, rotation: (active.rotation + turns) % 4 };
  for (const [dx, dy] of ROTATION_KICKS) {
    if (collides(draft.board, rotated, dx, dy)) continue;
    draft.active = { ...rotated, x: rotated.x + dx, y: rotated.y + dy };
    bumpLockDelay(draft, now);
    return;
  }
}

function softDrop(draft: Draft): void {
  const active = draft.active;
  if (active === null) return;
  if (collides(draft.board, active, 0, 1)) return;
  draft.active = dropped(active, 1);
  draft.score += BLOCKS_SOFT_DROP_POINTS;
  // The manual row IS this tick's gravity, so holding the key cannot stack the two
  // rates on top of each other.
  draft.gravityAccMs = 0;
}

function hardDrop(draft: Draft): void {
  const active = draft.active;
  if (active === null) return;
  const rows = rowsDroppable(draft.board, active);
  draft.active = dropped(active, rows);
  draft.score += rows * BLOCKS_HARD_DROP_POINTS;
  lockPiece(draft);
}

/**
 * One hold per piece: the slot may be filled and emptied as often as the player
 * likes, but not twice before the piece locks. A held piece that cannot be placed
 * ends the game exactly as a dealt one does — the hold is not a way to reach a
 * board state the deal could not have produced.
 */
function takeHold(draft: Draft): void {
  const active = draft.active;
  if (active === null || draft.holdUsed) return;
  const held = draft.hold;
  draft.hold = active.id;
  draft.holdUsed = true;
  draft.gravityAccMs = 0;
  draft.restingSinceMs = null;
  draft.lockResets = 0;
  // An empty slot is filled from the queue, which moves the queue along exactly as
  // a lock would have: the piece that was coming early is paid for later.
  draft.active = spawnOf(held ?? dealFromQueue(draft));
  if (collides(draft.board, draft.active)) draft.status = "over";
}

function act(draft: Draft, input: BlocksInput, now: number): void {
  switch (input) {
    case "none":
      return;
    case "left":
      move(draft, -1, now);
      return;
    case "right":
      move(draft, 1, now);
      return;
    case "rotateCW":
      rotate(draft, 1, now);
      return;
    case "rotateCCW":
      rotate(draft, 3, now);
      return;
    case "softDrop":
      softDrop(draft);
      return;
    case "hardDrop":
      hardDrop(draft);
      return;
    case "hold":
      takeHold(draft);
      return;
  }
}

/** Starts the lock delay on the tick a piece first cannot fall, and locks it when the delay is up. */
function settle(draft: Draft, now: number): void {
  const active = draft.active;
  if (active === null) return;
  if (!collides(draft.board, active, 0, 1)) {
    draft.restingSinceMs = null;
    draft.lockResets = 0;
    return;
  }
  if (draft.restingSinceMs === null) draft.restingSinceMs = now;
  if (now - draft.restingSinceMs >= BLOCKS_LOCK_DELAY_MS) lockPiece(draft);
}

/**
 * One tick: gravity for the elapsed time, then the player's action, then the lock
 * bookkeeping. The order is fixed and stated because a replay depends on it —
 * gravity before the input means a piece that would have fallen this tick falls
 * first, and the lock is decided after the input so the last nudge of a tick
 * counts before the piece is written down.
 *
 * Returns the SAME state once the game is over: no input changes a finished board,
 * and saying so by identity is what lets the renderer skip the work.
 */
export function step(state: BlocksState, input: BlocksInput, now: number): BlocksState {
  if (state.status === "over") return state;
  const draft = draftOf(state);
  applyGravity(draft, Math.max(0, now - state.lastTickAt));
  act(draft, input, now);
  settle(draft, now);
  return stateOf(draft, now);
}

/** The board cells the active piece covers, or nothing when there is none. */
export function activeCells(state: BlocksState): readonly BlockCell[] {
  return state.active === null ? [] : cellsOf(state.active);
}

/**
 * Where the active piece would land if it fell now — what stage 2 draws as the
 * ghost. Computed here because it is the same collision rule as the drop, and a
 * renderer that worked it out again would be a second answer to „where does this
 * stop", free to disagree with the first.
 */
export function ghostCells(state: BlocksState): readonly BlockCell[] {
  const active = state.active;
  if (active === null) return [];
  return cellsOf(dropped(active, rowsDroppable(state.board, active)));
}
