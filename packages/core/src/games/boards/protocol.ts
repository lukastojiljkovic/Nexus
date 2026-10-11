/**
 * The board games' TURN PROTOCOL (ADR-090 stage 2) — the thin layer over the six
 * engines in `games/` that says what a game is made of, so that the module's main
 * half (which stores a game and replays it) and the module's page (which plays it
 * and draws it) read the same rules from the same place.
 *
 * **Why this exists at all.** Each engine is pure and complete: it knows its
 * legal moves, its transition, its result and its seeded dice. What no single
 * engine knows is the shape the OTHER five share — which games are two-seat and
 * which is four-seat, which need a die rolled before a move, how one game's move
 * is written down for a move list, and where a game begins. Writing those six
 * answers twice (once in `@nexus/db`'s store and once in the module's renderer)
 * would be the arrangement this repository has already paid for repeatedly: two
 * copies of one rule agree until one of them moves. They are stated once, here,
 * and both halves import them.
 *
 * **The event log is the module's, not the engines'.** An engine says what a
 * MOVE is; a saved game needs a little more, because a game is not only its
 * moves: backgammon and ludo must have a die rolled before a play, a mill's
 * removal rides along with the placement that formed it, and a doubling cube
 * changes the stake without moving a checker. So a game's history is a list of
 * `BoardEvent`s — a roll, a move, a passed turn, a double — and `replayBoard`
 * folds that list back into the position the engine holds. Two properties follow
 * and both are load-bearing:
 *
 *  - **The log is replayable under the engine's own rules.** Every event is
 *    applied by the engine and nothing is applied twice, so a log that describes
 *    an illegal game is refused by `applyMove`, not by a second implementation of
 *    the rules. `@nexus/db`'s `BoardsStore` keeps the stronger half: a saved
 *    position and the log that produced it must agree, and a row where they do
 *    not is refused rather than stored.
 *  - **A roll is recorded, not implied.** The dice come from the engine's seeded
 *    source, so the log could omit them and re-draw — but then a game saved
 *    between a roll and the move it was rolled for would not replay, and the
 *    move list could not show the throw. `{kind: "roll", dice}` records the
 *    position in the stream AND what came out of it, and the replay checks the
 *    two against each other.
 *
 * **An event's `move` is untrusted and the ENGINE is what refuses it.** The
 * module's main process passes a payload from the renderer straight in here
 * (SEC-EL-02), so `step` hands the value to `applyMove` — which answers a move it
 * cannot play with `InvalidStateError` — rather than re-checking the shape of six
 * different move types in this file. Ludo is the one game whose event carries
 * more than the engine's move (see `LUDO_EVENT`), so it is the one game whose
 * extra fields are checked here, against the position they claim to describe.
 *
 * **Notation, never copy.** `describeBoardEvent` answers in each game's own
 * notation — `d3`, `b3×d5×f7`, `13/8 6/5`, `f1`, `F2 6→11` — which is why it has
 * nothing to say about Serbian or English. What a user reads around it is the
 * module's copy table.
 */

import { InvalidStateError } from "../boards-shared/errors.js";
import type { SeededRandom } from "../random.js";
import { createSeededRandom } from "../random.js";
import * as backgammon from "../backgammon/backgammon.js";
import * as draughts from "../draughts/draughts.js";
import * as fourInARow from "../four-in-a-row/fourInARow.js";
import * as ludo from "../ludo/ludo.js";
import * as mlin from "../mlin/mlin.js";
import * as reversi from "../reversi/reversi.js";

/**
 * The six games, in the order the module's own list draws them. The ids are
 * ASCII and are the stored key (`boards_saves.game`), never a label.
 */
export const BOARDS_GAMES = [
  "reversi",
  "draughts",
  "mlin",
  "backgammon",
  "four-in-a-row",
  "ludo",
] as const;

export type BoardsGame = (typeof BOARDS_GAMES)[number];

/** Who plays a seat: a person at this machine, or the engine. */
export type BoardSeatKind = "human" | "computer";

/**
 * How a position stands. Two-seat games answer `Player` (0 or 1); backgammon and
 * ludo answer their own result with a seat number, so the winner is a plain
 * number here and the page reads `seats` to know who that is.
 */
export interface BoardOutcome {
  readonly status: "in_progress" | "win" | "draw";
  /** Defined exactly when `status` is `"win"`. */
  readonly winner: number | null;
}

/**
 * One thing that happened in a game. `dice` on a roll is what the throw showed
 * (`[3, 5]`, `[4, 4, 4, 4]` for a double, `[6]` for ludo) — recorded so the move
 * list can show it, and checked against the engine's own draw on the way back in.
 */
export type BoardEvent =
  | { readonly kind: "roll"; readonly dice: readonly number[] }
  | { readonly kind: "move"; readonly move: unknown }
  | { readonly kind: "pass" }
  | { readonly kind: "double" };

/** One row of a move list: a game's notation, or the pass reversi's own rules make a move. */
export type BoardEventLabel = { readonly kind: "notation"; readonly text: string } | { readonly kind: "pass" };

/** What one search cost, in the terms the engines already report. */
export interface BoardChoice {
  readonly move: unknown | null;
  readonly nodes: number;
  readonly depth: number;
  readonly cut: boolean;
}

/**
 * One game, as everything above this line needs it.
 *
 * Every method takes and answers `unknown`, and each engine's adapter narrows
 * that with one documented cast per method. That is deliberate rather than lax:
 * the six states are six different types, the caller (a store, a page, a worker)
 * holds a value it got from JSON or from `postMessage` and cannot type, and the
 * alternative — six generic engines threaded through every call site — would put
 * the union's complexity in six places instead of one. Nothing here trusts the
 * value: `fromJSON` is the engine's own gate and `step` is the engine's own
 * transition.
 */
export interface BoardEngine {
  readonly game: BoardsGame;
  /** The seat counts this game is played with, ascending. Ludo is the only one with a choice. */
  readonly seats: readonly number[];
  /** How many difficulty levels the engine offers; `level` is 1..this. */
  readonly levels: number;
  /** The engine's own reader: normalizes and validates a state, or throws. */
  fromJSON(value: unknown): unknown;
  /** Canonical JSON for a state — what is stored, and what two states are compared by. */
  json(value: unknown): unknown;
  /** The position a game of this shape begins from (the shape comes from a state of it). */
  initial(value: unknown): unknown;
  legalMoves(state: unknown): readonly unknown[];
  /** Applies one event. A move the rules do not admit throws `InvalidStateError`. */
  step(state: unknown, event: BoardEvent): unknown;
  outcome(state: unknown): BoardOutcome;
  /** The rule set a position is played under, or `""` — the level record's own key. */
  variant(state: unknown): string;
  /** True when the side to move must roll before it can move. */
  needsRoll(state: unknown): boolean;
  /** Rolls the die or dice from the caller's seeded source. */
  roll(state: unknown, rng: SeededRandom): unknown;
  bestMove(state: unknown, level: number, rng: SeededRandom): BoardChoice;
  /** The tagged event for one user-made move (ludo's carries where the token went). */
  event(state: unknown, move: unknown): BoardEvent;
  /** One MOVE, in the game's own notation — see `describeBoardEvent`. */
  describe(event: BoardEvent): BoardEventLabel;
}

// --- Notation ----------------------------------------------------------------

/** `a`..`h` for a column, or `?` for one off the board (never produced by a legal move). */
function file(column: number): string {
  return column >= 0 && column < 8 ? (String.fromCharCode(97 + column) as string) : "?";
}

/**
 * A draughts square as `b3`: row 0 is the bottom, so the rank is `row + 1`.
 *
 * Exported because a board DRAWS these names too — a cell's accessible name is
 * its notation, which is the one spelling this file already owns — and a second
 * spelling in the renderer would be a square named one thing on screen and
 * another in the move list.
 */
export function draughtsSquareName(square: number): string {
  return `${file(draughts.draughtsColumn(square))}${draughts.draughtsRow(square) + 1}`;
}

/** A reversi cell as `d3`, on `draughtsSquareName`'s terms — exported for the same reason. */
export function reversiCellName(cell: number): string {
  const column = cell % reversi.REVERSI_SIZE;
  const row = Math.floor(cell / reversi.REVERSI_SIZE);
  return `${file(column)}${row + 1}`;
}

/** A four-in-a-row column as its letter, `a`…`g` — a drop names the column and nothing else. */
export function fourColumnName(column: number): string {
  return file(column);
}

/**
 * A nine men's morris point as it is DRAWN: three nested squares on a 7×7 lattice,
 * `column` 0..6 from the left and `row` 0..6 from the TOP, so point 0 is a7 (the
 * top-left corner) and point 23 is g1 — exactly the geometry `MLIN_NEIGHBOURS`'s
 * own header states ("point 0 is the top-left corner and point 23 the
 * bottom-right").
 *
 * **The renderer draws from this table rather than from one of its own**, which is
 * the whole reason it is here: a board drawn from a second copy of the geometry
 * would sooner or later put a piece on the wrong point while the move list went on
 * naming the right one.
 */
export const MLIN_LAYOUT: readonly (readonly [column: number, row: number])[] = [
  [0, 0], [3, 0], [6, 0],
  [1, 1], [3, 1], [5, 1],
  [2, 2], [3, 2], [4, 2],
  [0, 3], [1, 3], [2, 3],
  [4, 3], [5, 3], [6, 3],
  [2, 4], [3, 4], [4, 4],
  [1, 5], [3, 5], [5, 5],
  [0, 6], [3, 6], [6, 6],
];

/** A morris point as `a7`..`g1`, read off `MLIN_LAYOUT` — exported for the board to name its points. */
export function mlinPointName(point: number): string {
  const at = MLIN_LAYOUT[point];
  if (at === undefined) throw new InvalidStateError("point");
  return `${file(at[0])}${7 - at[1]}`;
}

/** A backgammon site as `13`, `bar` or `off` — exported for the board to name its points. */
export function backgammonSiteName(site: backgammon.BackgammonSite): string {
  if (site === "bar") return "bar";
  if (site === "off") return "off";
  return String(site + 1);
}

// --- Reading events ----------------------------------------------------------

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidStateError(field);
  }
  return value as Record<string, unknown>;
}

function asWhole(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new InvalidStateError(field);
  return value;
}

// --- The six engines ---------------------------------------------------------

const REVERSI: BoardEngine = {
  game: "reversi",
  seats: [2],
  levels: reversi.REVERSI_LEVELS.length,
  fromJSON: (value) => reversi.fromJSON(value),
  json: (value) => reversi.toJSON(reversi.fromJSON(value)),
  initial: () => reversi.initialState(),
  legalMoves: (state) => reversi.legalMoves(state as reversi.ReversiState),
  step: (state, event) => {
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-reversi`);
    // The cast is the caller's move handed to the engine that refuses it: a
    // placement the rules do not admit throws `illegal`, and so does a pass that
    // was not needed.
    return reversi.applyMove(state as reversi.ReversiState, event.move as reversi.ReversiMove);
  },
  outcome: (state) => {
    const result = reversi.result(state as reversi.ReversiState);
    return { status: result.status, winner: result.winner };
  },
  variant: () => "",
  needsRoll: () => false,
  roll: () => {
    throw new InvalidStateError("reversi-has-no-dice");
  },
  bestMove: (state, level, rng) => {
    const choice = reversi.bestMove(state as reversi.ReversiState, level, rng);
    return { move: choice.move, nodes: choice.nodes, depth: choice.depth, cut: choice.cut };
  },
  event: (_state, move) => ({ kind: "move", move }),
  describe: (event) => {
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-reversi`);
    const move = event.move as reversi.ReversiMove;
    return move.kind === "pass"
      ? { kind: "pass" }
      : { kind: "notation", text: reversiCellName(move.cell) };
  },
};

const DRAUGHTS: BoardEngine = {
  game: "draughts",
  seats: [2],
  levels: draughts.DRAUGHTS_LEVELS.length,
  fromJSON: (value) => draughts.fromJSON(value),
  json: (value) => draughts.toJSON(draughts.fromJSON(value)),
  initial: (state) => {
    const read = state as draughts.DraughtsState;
    return draughts.initialState({ kind: read.kind });
  },
  legalMoves: (state) => draughts.legalMoves(state as draughts.DraughtsState),
  step: (state, event) => {
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-draughts`);
    return draughts.applyMove(state as draughts.DraughtsState, event.move as draughts.DraughtsMove);
  },
  outcome: (state) => {
    const result = draughts.result(state as draughts.DraughtsState);
    return { status: result.status, winner: result.winner };
  },
  variant: (state) => (state as draughts.DraughtsState).kind,
  needsRoll: () => false,
  roll: () => {
    throw new InvalidStateError("draughts-has-no-dice");
  },
  bestMove: (state, level, rng) => {
    const choice = draughts.bestMove(state as draughts.DraughtsState, level, rng);
    return { move: choice.move, nodes: choice.nodes, depth: choice.depth, cut: choice.cut };
  },
  event: (_state, move) => ({ kind: "move", move }),
  describe: (event) => {
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-draughts`);
    const move = event.move as draughts.DraughtsMove;
    if (move.kind === "step") {
      return {
        kind: "notation",
        text: `${draughtsSquareName(move.from)}–${draughtsSquareName(move.to)}`,
      };
    }
    const path = move.path.map(draughtsSquareName);
    return { kind: "notation", text: `${draughtsSquareName(move.from)}×${path.join("×")}` };
  },
};

const MLIN: BoardEngine = {
  game: "mlin",
  seats: [2],
  levels: mlin.MLIN_LEVELS.length,
  fromJSON: (value) => mlin.fromJSON(value),
  json: (value) => mlin.toJSON(mlin.fromJSON(value)),
  initial: () => mlin.initialState(),
  legalMoves: (state) => mlin.legalMoves(state as mlin.MlinState),
  step: (state, event) => {
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-mlin`);
    return mlin.applyMove(state as mlin.MlinState, event.move as mlin.MlinMove);
  },
  outcome: (state) => {
    const result = mlin.result(state as mlin.MlinState);
    return { status: result.status, winner: result.winner };
  },
  variant: () => "",
  needsRoll: () => false,
  roll: () => {
    throw new InvalidStateError("mlin-has-no-dice");
  },
  bestMove: (state, level, rng) => {
    const choice = mlin.bestMove(state as mlin.MlinState, level, rng);
    return { move: choice.move, nodes: choice.nodes, depth: choice.depth, cut: choice.cut };
  },
  event: (_state, move) => ({ kind: "move", move }),
  describe: (event) => {
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-mlin`);
    const move = event.move as mlin.MlinMove;
    const taken = move.remove === null ? "" : `×${mlinPointName(move.remove)}`;
    if (move.kind === "place") {
      return { kind: "notation", text: `${mlinPointName(move.point)}${taken}` };
    }
    return {
      kind: "notation",
      text: `${mlinPointName(move.from)}–${mlinPointName(move.to)}${taken}`,
    };
  },
};

const FOUR: BoardEngine = {
  game: "four-in-a-row",
  seats: [2],
  levels: fourInARow.FOUR_LEVELS.length,
  fromJSON: (value) => fourInARow.fromJSON(value),
  json: (value) => fourInARow.toJSON(fourInARow.fromJSON(value)),
  initial: () => fourInARow.initialState(),
  legalMoves: (state) => fourInARow.legalMoves(state as fourInARow.FourState),
  step: (state, event) => {
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-four`);
    return fourInARow.applyMove(state as fourInARow.FourState, event.move as fourInARow.FourMove);
  },
  outcome: (state) => {
    const result = fourInARow.result(state as fourInARow.FourState);
    return { status: result.status, winner: result.winner };
  },
  variant: () => "",
  needsRoll: () => false,
  roll: () => {
    throw new InvalidStateError("four-has-no-dice");
  },
  bestMove: (state, level, rng) => {
    const choice = fourInARow.bestMove(state as fourInARow.FourState, level, rng);
    return { move: choice.move, nodes: choice.nodes, depth: choice.depth, cut: choice.cut };
  },
  event: (_state, move) => ({ kind: "move", move }),
  describe: (event) => {
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-four`);
    const move = event.move as fourInARow.FourMove;
    return { kind: "notation", text: file(move.column) };
  },
};

/**
 * Backgammon is the one game whose TURN is a set of checker plays, so a `move`
 * event carries the engine's `BackgammonMove` unchanged and the notation is the
 * plays written `13/8 6/5`. The cube is an event of its own (`double`) rather
 * than a move, because it moves no checker and ends nothing: the doubler's
 * opponent answers it, and a refusal is stage 2's `finish` — the position the
 * engine holds stays the position that was doubled.
 */
const BACKGAMMON: BoardEngine = {
  game: "backgammon",
  seats: [2],
  levels: backgammon.BACKGAMMON_LEVELS.length,
  fromJSON: (value) => backgammon.fromJSON(value),
  json: (value) => backgammon.toJSON(backgammon.fromJSON(value)),
  initial: (state) => {
    const read = state as backgammon.BackgammonState;
    return backgammon.initialState({ cubeEnabled: read.cubeEnabled });
  },
  legalMoves: (state) => backgammon.legalMoves(state as backgammon.BackgammonState),
  step: (state, event) => {
    const read = state as backgammon.BackgammonState;
    if (event.kind === "move") {
      return backgammon.applyMove(read, event.move as backgammon.BackgammonMove);
    }
    if (event.kind === "pass") return backgammon.endTurn(read);
    if (event.kind === "double") return backgammon.applyDouble(read, read.toMove);
    throw new InvalidStateError(`${event.kind}-in-backgammon`);
  },
  outcome: (state) => {
    const result = backgammon.result(state as backgammon.BackgammonState);
    return result.status === "win"
      ? { status: "win", winner: result.winner }
      : { status: "in_progress", winner: null };
  },
  variant: () => "",
  needsRoll: (state) => (state as backgammon.BackgammonState).dice.length === 0,
  roll: (state, rng) => backgammon.rollFor(state as backgammon.BackgammonState, rng),
  bestMove: (state, level, rng) => {
    const choice = backgammon.bestMove(state as backgammon.BackgammonState, level, rng);
    return { move: choice.move, nodes: choice.nodes, depth: choice.depth, cut: choice.cut };
  },
  event: (_state, move) => ({ kind: "move", move }),
  describe: (event) => {
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-backgammon`);
    const move = event.move as backgammon.BackgammonMove;
    const plays = move.plays.map(
      (play) => `${backgammonSiteName(play.from)}/${backgammonSiteName(play.to)}`,
    );
    return { kind: "notation", text: plays.join(" ") };
  },
};

/**
 * Ludo's event carries more than the engine's move, and the difference is the
 * die: `LudoMove` is `{token}` and the engine reads the die off the position, so
 * a list of `{token}` alone could not say what was rolled. An event therefore
 * records `{token, die, from, to}` — and `step` checks all three against the
 * position the replay actually reaches, which is the one place in this file where
 * a value is checked here rather than by an engine.
 */
interface LudoMoveFields {
  token: number;
  die: number;
  from: number;
  to: number;
}

function readLudoMove(value: unknown): LudoMoveFields {
  const record = asRecord(value, "ludo-move");
  const token = asWhole(record["token"], "token");
  const die = asWhole(record["die"], "die");
  const from = asWhole(record["from"], "from");
  const to = asWhole(record["to"], "to");
  if (token < 0 || token >= ludo.LUDO_TOKENS) throw new InvalidStateError("token");
  if (die < 1 || die > 6) throw new InvalidStateError("die");
  return { token, die, from, to };
}

const LUDO: BoardEngine = {
  game: "ludo",
  seats: [2, 3, 4],
  levels: ludo.LUDO_LEVELS.length,
  fromJSON: (value) => ludo.fromJSON(value),
  json: (value) => ludo.toJSON(ludo.fromJSON(value)),
  initial: (state) => ludo.initialState({ seats: (state as ludo.LudoState).seats }),
  legalMoves: (state) => ludo.legalMoves(state as ludo.LudoState),
  step: (state, event) => {
    const read = state as ludo.LudoState;
    if (event.kind === "pass") return ludo.endTurn(read);
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-ludo`);
    const fields = readLudoMove(event.move);
    if (read.die !== fields.die) throw new InvalidStateError("die-mismatch");
    const before = (read.tokens[read.toMove] as readonly number[])[fields.token] as number;
    if (before !== fields.from) throw new InvalidStateError("from-mismatch");
    const after = ludo.applyMove(read, { token: fields.token });
    const landed = (after.tokens[read.toMove] as readonly number[])[fields.token] as number;
    if (landed !== fields.to) throw new InvalidStateError("to-mismatch");
    return after;
  },
  outcome: (state) => {
    const result = ludo.result(state as ludo.LudoState);
    return result.status === "win"
      ? { status: "win", winner: result.winner }
      : { status: "in_progress", winner: null };
  },
  variant: () => "",
  needsRoll: (state) => (state as ludo.LudoState).die === null,
  roll: (state, rng) => ludo.rollFor(state as ludo.LudoState, rng),
  bestMove: (state, level, rng) => {
    const choice = ludo.bestMove(state as ludo.LudoState, level, rng);
    return { move: choice.move, nodes: choice.nodes, depth: choice.depth, cut: choice.cut };
  },
  event: (state, move) => {
    const read = state as ludo.LudoState;
    const token = (move as ludo.LudoMove).token;
    const before = (read.tokens[read.toMove] as readonly number[])[token] as number;
    const after = ludo.applyMove(read, { token });
    const landed = (after.tokens[read.toMove] as readonly number[])[token] as number;
    return { kind: "move", move: { token, die: read.die, from: before, to: landed } };
  },
  describe: (event) => {
    if (event.kind !== "move") throw new InvalidStateError(`${event.kind}-in-ludo`);
    const fields = readLudoMove(event.move);
    return { kind: "notation", text: `F${fields.token + 1} ${fields.from}→${fields.to}` };
  },
};

const ENGINES: Readonly<Record<BoardsGame, BoardEngine>> = {
  reversi: REVERSI,
  draughts: DRAUGHTS,
  mlin: MLIN,
  backgammon: BACKGAMMON,
  "four-in-a-row": FOUR,
  ludo: LUDO,
};

/** The one engine for one game id. An id off the wire is checked by `isBoardsGame` first. */
export function boardEngine(game: BoardsGame): BoardEngine {
  return ENGINES[game];
}

/**
 * The gate a state that crossed JSON has to pass before anything else here reads
 * it.
 *
 * **Why this is a named step and not a habit.** What is stored, and what
 * `postMessage` carries, is six engines' `toJSON` output — and one of them, four
 * in a row, deliberately drops a field its own rules read back: `winner` is
 * derived from the discs, so `toJSON` does not carry it, and `result` or
 * `legalMoves` given that value would read `undefined` off it (a full board with
 * no line, and a game that reports a winner of `NaN`). The engine's own
 * `fromJSON` recomputes it, which is why every boundary that receives a state
 * from outside normalizes it here FIRST: `BoardsStore` on the way out of the
 * archive, the module's AI worker on the way in, and the page when it resumes a
 * saved game. It is the same call each engine's `fromJSON` makes; it exists to be
 * named, so "where do I normalize" has one answer rather than six.
 */
export function normalizeBoardState(game: BoardsGame, value: unknown): unknown {
  return boardEngine(game).fromJSON(value);
}

/**
 * The seat to move.
 *
 * Every one of the six states carries `toMove` — `Player` (`0 | 1`) for the five
 * two-seat games and a seat index `0..3` for ludo — so this is a read of the one
 * field they share rather than six readers. It exists because two callers need
 * the answer WITHOUT the position's own type: the store, which explains a refused
 * doubling cube ("the doubler takes the stake, and the doubler is the side that
 * was to move"), and the page, which asks whose turn it is on every render.
 */
export function turnSeat(state: unknown): number {
  const seat = (state as { toMove?: unknown }).toMove;
  if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat > 3) {
    throw new InvalidStateError("toMove");
  }
  return seat;
}

/** Whether a value is one of the six game ids — the gate a stored row and an IPC payload both pass. */
export function isBoardsGame(value: unknown): value is BoardsGame {
  return typeof value === "string" && (BOARDS_GAMES as readonly string[]).includes(value);
}

/** Whether a value is a seat kind (`"human"` / `"computer"`). */
export function isBoardSeatKind(value: unknown): value is BoardSeatKind {
  return value === "human" || value === "computer";
}

// --- Folding a game ----------------------------------------------------------

/**
 * A game's position after its event log, from the seed the dice come out of.
 *
 * **One place, so the store and the page cannot disagree about what a game is.**
 * `@nexus/db`'s `BoardsStore` calls this to check that a saved position is the
 * position its own log produces, and the page calls it for nothing at all — but
 * the check is the reason the log exists in this shape: a hand-edited archive, or
 * a build that changed a rule, is refused here rather than resumed into a board
 * that does not match its own move list.
 *
 * `opening` is any state of this game: the position a game begins from depends on
 * the shape (draughts' rule set, ludo's seat count, whether backgammon's cube is
 * in play), and a state is where those live.
 *
 * A roll is checked against the position it claims: the engine did the drawing,
 * so what the event carries must be what came out — two dice for backgammon or
 * four for a double, one for ludo, and for ludo's third six the position really
 * does move on with no die to play, which is the one case where the throw and the
 * position disagree on purpose.
 */
export function replayBoard(
  game: BoardsGame,
  seed: number,
  events: readonly BoardEvent[],
  opening: unknown,
): unknown {
  const engine = boardEngine(game);
  const rng = createSeededRandom(seed);
  let state = engine.initial(engine.fromJSON(opening));
  for (const event of events) {
    if (event.kind !== "roll") {
      state = engine.step(state, event);
      continue;
    }
    if (!engine.needsRoll(state)) throw new InvalidStateError("rolled-twice");
    const before = state;
    state = engine.roll(state, rng);
    assertRollMatches(game, before, state, event);
  }
  return state;
}

/** That the throw an event records is the throw the engine made. */
function assertRollMatches(
  game: BoardsGame,
  before: unknown,
  after: unknown,
  event: Extract<BoardEvent, { kind: "roll" }>,
): void {
  const dice = event.dice;
  if (!Array.isArray(dice) || dice.length === 0 || dice.length > 4) {
    throw new InvalidStateError("roll-dice");
  }
  for (const die of dice) {
    if (typeof die !== "number" || !Number.isInteger(die) || die < 1 || die > 6) {
      throw new InvalidStateError("roll-die");
    }
  }
  if (game === "backgammon") {
    const state = after as backgammon.BackgammonState;
    if (state.dice.length !== dice.length) throw new InvalidStateError("roll-mismatch");
    for (let index = 0; index < dice.length; index += 1) {
      if (state.dice[index] !== dice[index]) throw new InvalidStateError("roll-mismatch");
    }
    return;
  }
  if (game === "ludo") {
    if (dice.length !== 1) throw new InvalidStateError("roll-dice");
    const state = after as ludo.LudoState;
    const previous = before as ludo.LudoState;
    // The throw itself, or a third six — which the rules take as a lost turn and
    // so leaves no die to play and the next seat to roll.
    const thirdSix = previous.sixes >= 2 && previous.threeSixesLoseTurn && (dice[0] as number) === 6;
    if (!thirdSix && state.die !== dice[0]) throw new InvalidStateError("roll-mismatch");
    if (thirdSix && (state.die !== null || state.toMove === previous.toMove)) {
      throw new InvalidStateError("roll-mismatch");
    }
    return;
  }
  throw new InvalidStateError("roll-in-a-game-without-dice");
}

/**
 * The move event for a move of this game, with everything a move list needs.
 *
 * A page calls this with the position it is about to move in; the ludo case is
 * why it takes the position at all.
 */
export function moveEvent(game: BoardsGame, state: unknown, move: unknown): BoardEvent {
  return boardEngine(game).event(state, move);
}

/** The roll event for a throw the engine just made — `dice` is read off the position it produced. */
export function rollEvent(game: BoardsGame, state: unknown): BoardEvent {
  if (game === "backgammon") {
    return { kind: "roll", dice: [...(state as backgammon.BackgammonState).dice] };
  }
  if (game === "ludo") {
    const die = (state as ludo.LudoState).die;
    return { kind: "roll", dice: [die === null ? 6 : die] };
  }
  throw new InvalidStateError("roll-in-a-game-without-dice");
}

/**
 * One MOVE, in the game's own notation.
 *
 * Only a move is asked: a roll, a passed turn and a doubled stake are shown from
 * their own fields — the dice an event already carries, and the one word each
 * needs, which is the module's copy rather than a notation — so this function has
 * nothing to answer for them and refuses rather than inventing a spelling. What a
 * move list actually draws is: the throw, the pass and the double from the copy
 * table, and every move from here.
 */
export function describeBoardEvent(game: BoardsGame, event: BoardEvent): BoardEventLabel {
  return boardEngine(game).describe(event);
}
