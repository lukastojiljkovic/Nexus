/**
 * MINESWEEPER's pure engine — the board, the moves, and the arithmetic that says
 * who won. No I/O, no `Date.now()`, no `Math.random()`: every transition takes
 * the instant it happened at and (for the first click alone) a seeded source, so
 * the same inputs always give the same answer and a test never freezes a clock.
 * `games/random.ts` carries the argument for the source this takes in.
 *
 * **Every transition returns a NEW state, and the input is never touched.** Two
 * shapes were available — a mutable board with an owner, or a value — and this
 * module is a value for one reason above the rest: a state that nobody can change
 * from under a holder is what lets `apps/desktop`'s renderer paint from it
 * mid-render without a copy, and it is what makes `expect(after).toBe(before)`
 * a meaningful assertion for the moves that do nothing at all (a click on an
 * already-open cell, a chord whose flags do not add up). A 30 × 24 board is 720
 * cells, so a copy is a few microseconds; the alternative is a class the UI has
 * to remember not to hold across a frame.
 *
 * **The board is a flat array in row-major order.** `columns * rows` entries, an
 * index `y * columns + x`, and no nested arrays: a nested grid would allocate a
 * new inner array on every reveal for no gain, and stage 2 maps a click to an
 * index once rather than walking two dimensions on every paint.
 *
 * **Mines are placed ON THE FIRST CLICK, and never before.** Both facts matter.
 * Placing them at creation would mean a board whose layout is decided before the
 * player has touched it, and no first click could then be guaranteed safe. So
 * `createMinesweeper` returns a board with `minesPlaced: false`, the first
 * `revealCell` draws the layout AVOIDING the clicked cell and its eight
 * neighbours, and the clock starts on that same call — the board the clock is
 * measuring does not exist until then.
 *
 * **Timing is two instants, never a counter.** `startedAt` is stamped on the
 * first reveal and `endedAt` on the win or the loss; everything else is
 * subtraction. A ticking counter would be a second source of truth about a
 * duration that already exists in the record, and it drifts the moment the
 * machine sleeps or a frame is dropped.
 */

import type { SeededRandom } from "../random.js";
import { shuffled } from "../random.js";

/** The three named boards, in the order the picker shows them. */
export const MINESWEEPER_PRESET_IDS = ["beginner", "intermediate", "expert"] as const;
export type MinesweeperPresetId = (typeof MINESWEEPER_PRESET_IDS)[number];

/**
 * A board's own identity: the preset it matches exactly, or `custom:CxRxM`.
 *
 * A custom board is keyed by its DIMENSIONS rather than lumped under one
 * `custom` — a best time over a 9 × 9 with 10 mines says nothing about a
 * 30 × 16 with 99, so the two must not share a column. Two custom boards of the
 * same shape therefore share a record, which is exactly right: they are the
 * same game.
 */
export type MinesweeperVariant = MinesweeperPresetId | `custom:${number}x${number}x${number}`;

/** One board's dimensions and mine count — the whole of what a Minesweeper game is configured with. */
export interface MinesweeperConfig {
  columns: number;
  rows: number;
  mines: number;
}

/**
 * The three presets, and the only three. Expert is 30 WIDE and 16 TALL — the
 * orientation matters, because the window it is drawn in is wider than it is
 * tall. The numbers are the classic ones and there is nothing else behind them.
 */
export const MINESWEEPER_PRESETS: Readonly<Record<MinesweeperPresetId, MinesweeperConfig>> = {
  beginner: { columns: 9, rows: 9, mines: 10 },
  intermediate: { columns: 16, rows: 16, mines: 40 },
  expert: { columns: 30, rows: 16, mines: 99 },
};

export const MINESWEEPER_MIN_COLUMNS = 1;
export const MINESWEEPER_MAX_COLUMNS = 30;
export const MINESWEEPER_MIN_ROWS = 1;
export const MINESWEEPER_MAX_ROWS = 24;
export const MINESWEEPER_MIN_MINES = 1;

/**
 * The floor a custom board has to clear, and it is about the first click rather
 * than about taste: the click that places the mines promises the clicked cell and
 * its eight neighbours are clear, which is nine cells — so a board has to be able
 * to spare nine cells for the player AND one for a mine. A board that cannot is
 * refused rather than dealt with a smaller promise, because „the first click is
 * always safe" is what the whole game is built on.
 */
export const MINESWEEPER_MIN_FREE_CELLS = 9;

/**
 * A validation ANSWER rather than an exception — the caller here is a settings
 * form and a store boundary, both of which want to say which field is wrong
 * rather than catch something (`validateFocusConfig`'s contract). `field` is
 * `null` when the value was not a config at all, because there is no single field
 * to blame for „this is not the shape" and pointing at one would blame an input
 * the user never touched.
 */
export type MinesweeperConfigResult =
  | { ok: true; config: MinesweeperConfig }
  | { ok: false; field: keyof MinesweeperConfig | null };

const CONFIG_KEYS: ReadonlyArray<keyof MinesweeperConfig> = ["columns", "rows", "mines"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural validation of an untrusted config into a fresh, canonical one.
 * Exactly these three keys, no more and no fewer (`habitSchedule.ts`'s rule): an
 * unknown key means the value was not produced by this module, and ignoring it
 * would let a renamed field go on being read as its own default. Never returns
 * the caller's own object, so a config that came back from here cannot be mutated
 * from under its holder.
 */
export function validateMinesweeperConfig(value: unknown): MinesweeperConfigResult {
  if (!isRecord(value)) return { ok: false, field: null };
  if (Object.keys(value).length !== CONFIG_KEYS.length) return { ok: false, field: null };
  for (const key of CONFIG_KEYS) {
    if (!Number.isInteger(value[key])) return { ok: false, field: key };
  }

  const columns = value["columns"] as number;
  const rows = value["rows"] as number;
  const mines = value["mines"] as number;

  if (columns < MINESWEEPER_MIN_COLUMNS || columns > MINESWEEPER_MAX_COLUMNS) {
    return { ok: false, field: "columns" };
  }
  if (rows < MINESWEEPER_MIN_ROWS || rows > MINESWEEPER_MAX_ROWS) {
    return { ok: false, field: "rows" };
  }
  // Both bounds of the mine count: at least one (a board with none is won before
  // it starts) and at most the area minus the nine cells the first click clears.
  if (mines < MINESWEEPER_MIN_MINES) return { ok: false, field: "mines" };
  if (columns * rows - mines < MINESWEEPER_MIN_FREE_CELLS) return { ok: false, field: "mines" };

  return { ok: true, config: { columns, rows, mines } };
}

/**
 * The board's identity for a store row — the preset it matches exactly, or
 * `custom:CxRxM`. Derived from the config rather than passed alongside it, so the
 * two can never disagree about which board a score belongs to.
 */
export function minesweeperVariant(config: MinesweeperConfig): MinesweeperVariant {
  for (const id of MINESWEEPER_PRESET_IDS) {
    const preset = MINESWEEPER_PRESETS[id];
    if (
      preset.columns === config.columns &&
      preset.rows === config.rows &&
      preset.mines === config.mines
    ) {
      return id;
    }
  }
  return `custom:${config.columns}x${config.rows}x${config.mines}`;
}

/**
 * What the player has done to one cell. `flag` and `question` are the two states
 * a right-click cycles through; `none` is a cell nobody has marked.
 *
 * A flag is a claim that a mine is here, and the board treats it as one: a
 * flagged cell cannot be opened by a click, a flood fill stops at it, and it
 * counts towards a chord. A question mark is the opposite — it is a note to
 * self that says „not sure", so the cell still opens normally and the mark
 * clears when it does.
 */
export type MinesweeperMark = "none" | "flag" | "question";

export interface MinesweeperCell {
  /** True once the cell's number is visible to the player. A mine can never be revealed — stepping on one ends the game instead. */
  revealed: boolean;
  mark: MinesweeperMark;
}

/** `ready` until the first reveal, then `playing` until a win or a loss. There is no fifth state. */
export type MinesweeperStatus = "ready" | "playing" | "won" | "lost";

/**
 * One game, as a value.
 *
 * `mines` and `adjacent` are always the board's full size, so stage 2 can index
 * them beside `cells` without a branch. Before the first click `mines` is all
 * `false` and `minesPlaced` is `false`; `adjacent` is meaningless until mines
 * exist and is what `minesweeperFaces` reads only for revealed cells, which
 * cannot happen before then.
 */
export interface MinesweeperState {
  config: MinesweeperConfig;
  /** Whether a right-click cycles through the question mark — the user's setting, read at creation so every transition below is a function of the state alone. */
  questions: boolean;
  status: MinesweeperStatus;
  /** True once the first click has drawn the layout. The flag is what tells „no mines yet" apart from „a board whose mines are all… impossible", so the drawing rule reads it rather than counting. */
  minesPlaced: boolean;
  /** One entry per cell, row-major. */
  mines: readonly boolean[];
  /** Mines among each cell's neighbours, 0–8. */
  adjacent: readonly number[];
  cells: readonly MinesweeperCell[];
  /** ISO instants. Null until the first reveal / until the game ends. */
  startedAt: string | null;
  endedAt: string | null;
}

export interface MinesweeperOptions {
  questions?: boolean;
}

/** What one cell looks like on screen. The NUMBER beside a `number` face is `adjacent[index]`. */
export type MinesweeperFace =
  /** Face down, unmarked. */
  | "hidden"
  | "flag"
  | "question"
  /** Revealed, no adjacent mines. */
  | "empty"
  /** Revealed, one to eight adjacent mines. */
  | "number"
  /** Only on a loss: a mine the player did not flag. */
  | "mine"
  /** Only on a loss: a flag standing on a cell that had no mine. */
  | "wrong-flag";

/**
 * The shape every `now` this module accepts has to have — main stamps the clock,
 * so a malformed instant is a caller's bug worth naming. The FIN module's
 * `isDateTime` states the same shape and this restates it, because `@nexus/core`
 * does not depend on `@nexus/db`; it differs in one character, and the difference
 * is the point of the doc below.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Milliseconds since the epoch for a stamped instant. Strict about the zone: an
 * instant with no offset is read by `Date.parse` in the machine's LOCAL time, so
 * two devices would disagree about a value that is supposed to be one moment —
 * exactly the class of quiet disagreement this module avoids by refusing it.
 */
function instantMs(instant: string): number {
  if (!ISO_INSTANT.test(instant)) {
    throw new TypeError(`Not an ISO-8601 instant with a zone offset: ${instant}`);
  }
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) throw new TypeError(`Not a readable instant: ${instant}`);
  return ms;
}

/**
 * `instant` restated as the ONE spelling the state keeps: UTC, milliseconds
 * always present. The state is what a test compares and what a later run reads
 * back, so two instants that name the same moment have to be the same string —
 * `2026-06-01T10:00:00+02:00` and `2026-06-01T08:00:00.000Z` are one moment and
 * must not be two states.
 */
function canonicalInstant(instant: string): string {
  return new Date(instantMs(instant)).toISOString();
}

/** A fresh, empty board for `config` — mines in no cell, because they are placed on the first click. Throws on a config `validateMinesweeperConfig` refuses, so nothing downstream can hold a board that cannot be played. */
export function createMinesweeper(
  config: MinesweeperConfig,
  options: MinesweeperOptions = {},
): MinesweeperState {
  const checked = validateMinesweeperConfig(config);
  if (!checked.ok) {
    throw new RangeError(
      `Minesweeper config refused at field ${checked.field ?? "whole value"}: ` +
        `${JSON.stringify(config)}`,
    );
  }
  const size = checked.config.columns * checked.config.rows;
  return {
    config: checked.config,
    questions: options.questions === true,
    status: "ready",
    minesPlaced: false,
    mines: new Array<boolean>(size).fill(false),
    adjacent: new Array<number>(size).fill(0),
    cells: Array.from({ length: size }, () => ({ revealed: false, mark: "none" })),
    startedAt: null,
    endedAt: null,
  };
}

/**
 * A board over an EXPLICIT mine layout, for the cases a seeded click cannot set
 * up on demand: a hand-drawn board to read a flood fill off, a chord whose flags
 * are known to be right or wrong, and a loss that has to happen at a named cell.
 *
 * It is PUBLIC rather than a test-only door because the alternative — a private
 * back door the tests reach through an interface nobody else uses — would leave
 * the real one unproven (`blocksFrom` is the same arrangement, one game over). The
 * layout is checked against the config (every cell accounted for, exactly
 * `config.mines` mines), so this is not a way to hand the engine a board it could
 * not have dealt. It does not replace the first-click rule: a board from here
 * already has its mines, so `revealCell` places none.
 */
export function minesweeperFromMines(
  config: MinesweeperConfig,
  mines: readonly boolean[],
  options: MinesweeperOptions = {},
): MinesweeperState {
  const board = createMinesweeper(config, options);
  if (mines.length !== board.cells.length) {
    throw new RangeError(
      `Minesweeper layout must have ${board.cells.length} cells, got ${mines.length}`,
    );
  }
  const placed = mines.filter((mine) => mine).length;
  if (placed !== board.config.mines) {
    throw new RangeError(`Minesweeper layout must hold ${board.config.mines} mines, got ${placed}`);
  }
  return {
    ...board,
    minesPlaced: true,
    mines: [...mines],
    adjacent: adjacentCounts(board.config, mines),
  };
}

/** The index a cell is at, row-major. Exported rather than kept private because stage 2 maps every pointer event through it, and a second spelling of `row * columns + column` is a second place to get the board wrong. */
export function minesweeperIndex(config: MinesweeperConfig, column: number, row: number): number {
  return row * config.columns + column;
}

/** The mines among each cell's neighbours, 0–8. */
function adjacentCounts(config: MinesweeperConfig, mines: readonly boolean[]): number[] {
  const counts = new Array<number>(mines.length).fill(0);
  for (let index = 0; index < mines.length; index += 1) {
    if (mines[index] !== true) continue;
    for (const neighbour of neighbourIndexes(config, index)) {
      counts[neighbour] = (counts[neighbour] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * The indexes around `index`, row-major order, clipped at the board's edges —
 * clipped rather than wrapped, and that is the rule the whole game runs on: a
 * cell in column 0 does not neighbour anything in the column the board ends on.
 * Computed instead of tabulated so a custom board of any size is the same code
 * path as a preset.
 */
function neighbourIndexes(config: MinesweeperConfig, index: number): number[] {
  const column = index % config.columns;
  const row = Math.floor(index / config.columns);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    const y = row + dy;
    if (y < 0 || y >= config.rows) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = column + dx;
      if (x < 0 || x >= config.columns) continue;
      out.push(minesweeperIndex(config, x, y));
    }
  }
  return out;
}

/**
 * The layout for a first click at `safeIndex`: every cell but the clicked one and
 * its neighbours is a candidate, and `config.mines` of them are drawn from the
 * shuffled candidates.
 *
 * The exclusion is the promise the game is built on, and the validation is what
 * makes it keepable — `MINESWEEPER_MIN_FREE_CELLS` guarantees at least nine cells
 * stay in hand for the mine-free block, so at least one candidate is left for
 * every mine. The throw below is therefore unreachable through the public door
 * and is a guard against a future caller assembling a board by hand.
 */
function placeMines(
  config: MinesweeperConfig,
  safeIndex: number,
  random: SeededRandom,
): boolean[] {
  const protectedIndexes = new Set<number>([safeIndex, ...neighbourIndexes(config, safeIndex)]);
  const candidates: number[] = [];
  for (let index = 0; index < config.columns * config.rows; index += 1) {
    if (!protectedIndexes.has(index)) candidates.push(index);
  }
  if (candidates.length < config.mines) {
    throw new RangeError(
      `A ${config.columns}x${config.rows} board cannot keep ${config.mines} mines out of the ` +
        `${protectedIndexes.size} cells around a first click.`,
    );
  }

  const mines = new Array<boolean>(config.columns * config.rows).fill(false);
  for (const index of shuffled(candidates, random).slice(0, config.mines)) mines[index] = true;
  return mines;
}

/** A wrong index is a renderer's bug and must be loud — a silent no-op would look exactly like a click that did nothing. */
function assertIndex(state: MinesweeperState, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= state.cells.length) {
    throw new RangeError(`Minesweeper cell index out of range: ${index}`);
  }
}

/**
 * Opens `start` and, if it is a zero cell, everything reachable from it — the
 * flood fill, on an explicit stack rather than by recursion. A recursive fill
 * would be one frame per cell it walked, in the order it walked them, and the
 * worst case is a board this module allows: 30 × 24 with nine mines opens up to
 * 711 cells, so a recursive fill could stand 711 frames deep on a single click.
 * That is not a number to leave to a JavaScript engine's frame budget.
 *
 * Mutates the array it is handed — always the caller's own working copy — and
 * answers whether it stepped on a mine. The walk skips flagged cells (a flag is a
 * claim the player made and the board does not overrule it), clears a question
 * mark on the way in, and cannot reach a mine from a zero cell: a cell with no
 * adjacent mines has no mine for a neighbour.
 */
function openFrom(
  state: MinesweeperState,
  cells: MinesweeperCell[],
  start: number,
): boolean {
  const stack: number[] = [start];
  while (stack.length > 0) {
    const index = stack.pop() as number;
    const cell = cells[index] as MinesweeperCell;
    if (cell.revealed || cell.mark === "flag") continue;
    if (state.mines[index] === true) return true;
    cells[index] = { revealed: true, mark: "none" };
    if (state.adjacent[index] === 0) {
      for (const neighbour of neighbourIndexes(state.config, index)) stack.push(neighbour);
    }
  }
  return false;
}

/** Every cell that is not a mine is open — the win condition, and the only one. */
function allSafeCellsOpen(state: MinesweeperState, cells: readonly MinesweeperCell[]): boolean {
  return cells.every((cell, index) => cell.revealed || state.mines[index] === true);
}

/**
 * Opens one cell. The first call of a game also draws the layout, avoiding the
 * clicked cell, and starts the clock.
 *
 * Returns the SAME state for a click that cannot mean anything: after the game
 * has ended, on a cell that is already open, and on a flagged one. That last is
 * the useful half — a mis-click on a flag must not blow up a board the player has
 * reasoned about.
 */
export function revealCell(
  state: MinesweeperState,
  index: number,
  random: SeededRandom,
  now: string,
): MinesweeperState {
  assertIndex(state, index);
  if (state.status === "won" || state.status === "lost") return state;
  const target = state.cells[index] as MinesweeperCell;
  if (target.revealed || target.mark === "flag") return state;
  const at = canonicalInstant(now);

  let board = state;
  if (!board.minesPlaced) {
    const mines = placeMines(board.config, index, random);
    board = {
      ...board,
      minesPlaced: true,
      mines,
      adjacent: adjacentCounts(board.config, mines),
    };
  }

  const cells = board.cells.map((cell) => ({ ...cell }));
  const lost = openFrom(board, cells, index);
  const startedAt = board.startedAt ?? at;
  if (lost) return { ...board, status: "lost", cells, startedAt, endedAt: at };

  const won = allSafeCellsOpen(board, cells);
  return {
    ...board,
    status: won ? "won" : "playing",
    cells,
    startedAt,
    endedAt: won ? at : null,
  };
}

/**
 * Chording: a click on an OPEN number whose neighbouring flags equal the number
 * opens every other neighbour at once.
 *
 * It is the move that makes a finished board fast, and it is also where a board
 * is most often lost: the flags are the player's belief, and if they are wrong
 * the chord opens the mine they were standing over. So the rule is exact — as
 * many flags as the number says, or nothing happens at all — and a chord that
 * hits a mine ends the game the same way a direct click does. Cells opened before
 * the mine are kept, which is what the classic game shows.
 */
export function chordCell(state: MinesweeperState, index: number, now: string): MinesweeperState {
  assertIndex(state, index);
  if (state.status !== "playing") return state;
  const target = state.cells[index] as MinesweeperCell;
  const adjacent = state.adjacent[index] as number;
  if (!target.revealed || adjacent === 0) return state;

  const around = neighbourIndexes(state.config, index);
  const flags = around.filter(
    (neighbour) => (state.cells[neighbour] as MinesweeperCell).mark === "flag",
  );
  if (flags.length !== adjacent) return state;
  const instant = canonicalInstant(now);

  const cells = state.cells.map((cell) => ({ ...cell }));
  let lost = false;
  for (const neighbour of around) {
    const cell = cells[neighbour] as MinesweeperCell;
    if (cell.revealed || cell.mark === "flag") continue;
    if (openFrom(state, cells, neighbour)) {
      lost = true;
      break;
    }
  }
  if (lost) return { ...state, status: "lost", cells, endedAt: instant };

  // A chord whose neighbours were all open or flagged already changes nothing,
  // and saying so by handing back the same object keeps the „did that click do
  // anything" question answerable by identity.
  const opened = cells.some((cell, at) => cell.revealed !== state.cells[at]?.revealed);
  return opened ? { ...state, cells } : state;
}

/**
 * Cycles a cell's mark: none → flag → (question →) none. The question mark is in
 * the cycle only when the player asked for it, which is state rather than an
 * argument so that a state on screen always says which cycle it is in.
 */
export function cycleMark(state: MinesweeperState, index: number): MinesweeperState {
  assertIndex(state, index);
  if (state.status === "won" || state.status === "lost") return state;
  const cell = state.cells[index] as MinesweeperCell;
  if (cell.revealed) return state;

  const mark: MinesweeperMark =
    cell.mark === "none"
      ? "flag"
      : cell.mark === "flag"
        ? state.questions
          ? "question"
          : "none"
        : "none";

  const cells = state.cells.map((each) => ({ ...each }));
  cells[index] = { revealed: cell.revealed, mark };
  return { ...state, cells };
}

/**
 * What the board looks like right now, one face per cell, row-major.
 *
 * The two end states are the interesting half. On a LOSS every mine is shown, a
 * flag that stood on a mine stays a flag (the player got it right), and a flag
 * that stood on nothing becomes `wrong-flag` — which is the reveal the classic
 * game ends on, and the one that teaches the player what they misread. On a WIN
 * every cell that is not open is a mine, so those read as flags: the board the
 * player was working towards, drawn for them.
 */
export function minesweeperFaces(state: MinesweeperState): readonly MinesweeperFace[] {
  return state.cells.map((cell, index) => {
    const marked: MinesweeperFace =
      cell.mark === "flag" ? "flag" : cell.mark === "question" ? "question" : "hidden";
    if (state.mines[index] === true) {
      if (state.status === "won") return "flag";
      if (state.status === "lost") return cell.mark === "flag" ? "flag" : "mine";
      return marked;
    }
    if (cell.revealed) return (state.adjacent[index] as number) > 0 ? "number" : "empty";
    if (state.status === "lost" && cell.mark === "flag") return "wrong-flag";
    return marked;
  });
}

/** Mines still unaccounted for: the mine count less the flags on the board. Negative once the player has over-flagged — the UI owes that number the minus sign rather than a clamp. */
export function minesweeperRemainingMines(state: MinesweeperState): number {
  const flags = state.cells.filter((cell) => cell.mark === "flag").length;
  return state.config.mines - flags;
}

/**
 * How long the game has taken: the two instants when it is over, `now` while it
 * runs, and nothing at all before the first reveal. Never a stored counter — the
 * record only ever holds two instants, so this cannot drift from them.
 */
export function minesweeperElapsedMs(state: MinesweeperState, now: string): number | null {
  if (state.startedAt === null) return null;
  const from = instantMs(state.startedAt);
  const to = state.endedAt === null ? instantMs(now) : instantMs(state.endedAt);
  return to - from;
}
