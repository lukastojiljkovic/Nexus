import {
  BOARDS_GAMES,
  backgammon,
  boardEngine,
  createSeededRandom,
  draughts,
  describeBoardEvent,
  ludo,
  moveEvent,
  normalizeBoardState,
  rollEvent,
  turnSeat,
} from "@nexus/core";
import type { BoardEvent, BoardOutcome, BoardSeatKind, BoardsGame } from "@nexus/core";

/**
 * The page's own turn logic, as pure functions (ADR-090).
 *
 * **What is here and what is not.** What a legal move IS, what a position means
 * and whether a game is over are the engines' — `boardEngine` reads them and this
 * file never restates one. What is here is the page's own shape: the session it
 * holds while somebody plays, the one-step transitions a click makes, and the two
 * policies a board game needs and no engine owns (when the COMPUTER offers the
 * doubling cube, and whether it takes one).
 *
 * **Why the session is a value with one-step transitions.** A move is drawn the
 * moment it is played and stored a moment later, so the page needs the position,
 * the log that produced it and the dice stream's position in ONE value that a
 * React state update can replace. Every transition below returns a new session and
 * never mutates the old one, which is what makes "what the screen shows" and "what
 * was written" the same thing rather than two things kept in step by hand.
 *
 * **Why the state is normalized on the way in.** `normalizeBoardState` is the
 * engines' own gate, and a state that crossed JSON has to pass it before any rule
 * reads it — four in a row's `winner` is derived and `toJSON` does not carry it
 * (`@nexus/core`'s protocol says so at length). Both entries into a session — a
 * new game and a resumed one — go through it, so no other function here has to
 * ask where its state came from.
 *
 * **The dice belong to the game, the tie-breaks do not.** A game's rolls draw from
 * ONE seeded stream, which is what makes a saved game replayable; the computer's
 * SEARCH is given a stream derived from the game's seed and the move number
 * (`moveSeed`), so its equal-move shuffle cannot shift the dice a later replay
 * expects. That split is the reason a game can be resumed at all.
 */

/** How a session ended, in the store's vocabulary — `"position"` when the rules ended it. */
export type SessionEnding = "position" | "resigned" | "cube-declined" | "abandoned";

/** Where an undo returns to: the position, the log and the dice stream, as one value. */
export interface Snapshot {
  readonly state: unknown;
  readonly events: BoardEvent[];
  readonly rng: number;
}

/**
 * One game being played on this page.
 *
 * `state` and `events` are the pair the store insists agree; `seed` and `rng` are
 * the dice stream and where in it the game stands; `undo` is the position the
 * current turn began at, once it is a person's turn to play.
 */
export interface BoardSession {
  readonly game: BoardsGame;
  readonly state: unknown;
  readonly events: BoardEvent[];
  readonly seed: number;
  readonly rng: number;
  readonly seats: readonly BoardSeatKind[];
  readonly level: number | null;
  /** The start of the turn now in progress, when that turn is a person's, or null. */
  readonly undo: Snapshot | null;
  /** Whether an anchor has already been taken for the turn in progress. */
  readonly anchored: boolean;
  /** Whether a doubling cube has been offered and not yet answered. */
  readonly awaitingCube: boolean;
  /** How the match ended, once it has. */
  readonly ending: SessionEnding;
}

/** The six games in the order the module lists them. */
export const GAME_ORDER = BOARDS_GAMES;

/** Everything a new game needs besides its game id: who plays, how well, and the shape's two options. */
export interface GameSetup {
  readonly seats: readonly BoardSeatKind[];
  readonly level: number | null;
  /** Draughts only: which printed rule set, or null for the game that has none. */
  readonly variant: "english" | "russian" | null;
  /** Backgammon only: whether the doubling cube is in play. */
  readonly cubeEnabled: boolean;
}

/**
 * A game that has not been played yet: the opening position of the game's shape,
 * the seat list, the level and the seed the dice will come out of.
 *
 * The opening comes from the ENGINE, per game, so a rule set or a seat count is a
 * parameter rather than something this file decides: draughts builds its own
 * opening for the chosen rules, ludo for the number of players, backgammon with or
 * without the cube — and the other three have exactly one opening each.
 */
export function newSession(game: BoardsGame, setup: GameSetup, seed: number): BoardSession {
  const engine = boardEngine(game);
  const opening =
    game === "draughts"
      ? draughts.toJSON(draughts.initialState({ kind: setup.variant ?? "english" }))
      : game === "ludo"
        ? ludo.toJSON(ludo.initialState({ seats: setup.seats.length }))
        : game === "backgammon"
          ? backgammon.toJSON(backgammon.initialState({ cubeEnabled: setup.cubeEnabled }))
          : engine.json(engine.initial(undefined));
  return {
    game,
    state: engine.fromJSON(opening),
    events: [],
    seed,
    rng: seed,
    seats: setup.seats,
    level: setup.level,
    undo: null,
    anchored: false,
    awaitingCube: false,
    ending: "position",
  };
}

/** A session resumed from a saved game: the stored position, log, seed and settings. */
export function savedSession(save: {
  readonly game: BoardsGame;
  readonly state: unknown;
  readonly events: readonly BoardEvent[];
  readonly seed: number;
  readonly level: number | null;
  readonly seats: readonly BoardSeatKind[];
}): BoardSession {
  const state = normalizeBoardState(save.game, save.state);
  const engine = boardEngine(save.game);
  // The dice stream's position is not stored, and does not have to be: a roll is
  // the only thing that advances it, every roll is in the log, and the log's rolls
  // are the stream's draws in order — so folding the log here puts the stream
  // exactly where the game left it. Deriving it any other way would be inventing a
  // position in a generator.
  //
  // The fold is ALSO the check that the stored position is the one the log
  // produces. The store already refuses a row where they disagree, so a mismatch
  // here means this build and the one that wrote the row have parted company —
  // which is worth saying out loud rather than opening a board that shows one game
  // and a move list that describes another.
  const stream = createSeededRandom(save.seed);
  let walk = engine.initial(state);
  for (const event of save.events) {
    walk = event.kind === "roll" ? engine.roll(walk, stream) : engine.step(walk, event);
  }
  if (JSON.stringify(engine.json(walk)) !== JSON.stringify(engine.json(state))) {
    throw new Error("boards: the saved position is not the position its move log produces");
  }
  return {
    game: save.game,
    state,
    events: [...save.events],
    seed: save.seed,
    rng: stream.state,
    seats: [...save.seats],
    level: save.level,
    undo: null,
    anchored: false,
    awaitingCube: false,
    ending: "position",
  };
}

/** The legal moves of the position on screen. */
export function legalMovesOf(session: BoardSession): readonly unknown[] {
  return boardEngine(session.game).legalMoves(session.state);
}

/** How the position stands. */
export function outcomeOf(session: BoardSession): BoardOutcome {
  return boardEngine(session.game).outcome(session.state);
}

/** Whose turn it is. */
export function turnSeatOf(session: BoardSession): number {
  return turnSeat(session.state);
}

/** Whether the game is over — by the rules, or because somebody resigned or refused the cube. */
export function isOver(session: BoardSession): boolean {
  return session.ending !== "position" || outcomeOf(session).status !== "in_progress";
}

/** Whether the side to move has to roll before it can play. */
export function mustRoll(session: BoardSession): boolean {
  return !isOver(session) && boardEngine(session.game).needsRoll(session.state);
}

/** Whether one seat is a person at this machine. */
export function seatIsHuman(session: BoardSession, seat: number): boolean {
  return session.seats[seat] === "human";
}

/** Whether the side to move is a person — the page's own question, every render. */
export function awaitingHuman(session: BoardSession): boolean {
  return !isOver(session) && seatIsHuman(session, turnSeatOf(session));
}

/** A throw for the side to move, and the event that records it. */
export function withRoll(session: BoardSession): BoardSession {
  const stream = createSeededRandom(session.rng);
  const state = boardEngine(session.game).roll(session.state, stream);
  return {
    ...session,
    state,
    events: [...session.events, rollEvent(session.game, state)],
    rng: stream.state,
  };
}

/** One move, as the event the log records and the position it leads to. */
export function withMove(session: BoardSession, move: unknown): BoardSession {
  const event = moveEvent(session.game, session.state, move);
  return {
    ...session,
    state: boardEngine(session.game).step(session.state, event),
    events: [...session.events, event],
  };
}

/** The turn a side passes when its dice allow no move at all. */
export function withPass(session: BoardSession): BoardSession {
  const event: BoardEvent = { kind: "pass" };
  return {
    ...session,
    state: boardEngine(session.game).step(session.state, event),
    events: [...session.events, event],
  };
}

/** The doubling cube, doubled: an event of its own, because it moves no checker. */
export function withDouble(session: BoardSession): BoardSession {
  const event: BoardEvent = { kind: "double" };
  return {
    ...session,
    state: boardEngine(session.game).step(session.state, event),
    events: [...session.events, event],
    // The offer stands until the opponent answers it — and the opponent is the
    // seat the cube passed to, not the side to move, which the double leaves
    // exactly where it was.
    awaitingCube: true,
  };
}

/** The opponent answered the offer by taking it: the game goes on. */
export function withCubeAnswer(session: BoardSession): BoardSession {
  return { ...session, awaitingCube: false };
}

/** One seat gives up: the match ends, at whatever the position was. */
export function withResignation(session: BoardSession): BoardSession {
  return { ...session, ending: "resigned" };
}

/** The cube was refused: the match ends, and the doubler takes the stake as it stood. */
export function withDeclinedCube(session: BoardSession): BoardSession {
  return { ...session, ending: "cube-declined", awaitingCube: false };
}

/**
 * Whether a doubling cube is waiting for an answer — the question the page asks to
 * decide whether to offer „Prihvati" and „Odbij", and to hold the board still
 * until somebody answers.
 */
export function cubeAwaitingAnswer(session: BoardSession): boolean {
  return session.awaitingCube && !isOver(session);
}

/** The seat that must answer the offer: the one the cube passed to. */
export function cubeAnswerSeat(session: BoardSession): number | null {
  if (session.game !== "backgammon") return null;
  return (session.state as backgammon.BackgammonState).cubeOwner;
}

/**
 * Anchors the position an undo returns to, once per turn.
 *
 * An undo in this module takes back a whole turn — the throw, the move and the
 * engine's answer — because a move is not undoable on its own in a dice game and a
 * single ply back would hand the player a position no rule produces. So the anchor
 * is taken when a PERSON's turn begins and cleared the moment the turn passes,
 * which is what makes the button mean the same thing every time.
 *
 * Cheap and idempotent: called after every transition, it takes one snapshot per
 * turn, at most.
 */
export function beginTurn(session: BoardSession): BoardSession {
  if (isOver(session)) return session;
  if (!seatIsHuman(session, turnSeatOf(session))) return { ...session, anchored: false };
  if (session.anchored) return session;
  return {
    ...session,
    undo: { state: session.state, events: [...session.events], rng: session.rng },
    anchored: true,
  };
}

/** Whether the page offers „Nazad": one person against the engine, with a turn to take back. */
export function canUndo(session: BoardSession): boolean {
  const humans = session.seats.filter((seat) => seat === "human").length;
  const computers = session.seats.filter((seat) => seat === "computer").length;
  return humans === 1 && computers === 1 && session.undo !== null;
}

/** Takes the current turn back. Without an anchor this is the same session. */
export function withUndo(session: BoardSession): BoardSession {
  const anchor = session.undo;
  if (anchor === null) return session;
  return {
    ...session,
    state: anchor.state,
    events: [...anchor.events],
    rng: anchor.rng,
    undo: null,
    // The turn that follows an undo is the SAME turn, so its anchor stays spent
    // until the turn passes: a second press must not walk further back.
    anchored: true,
  };
}

/**
 * The stream the computer's SEARCH draws its equal-move tie-break from: the game's
 * seed mixed with the move number.
 *
 * **Why not the game's own stream.** A search shuffles its root moves once per
 * call, and a shuffle consumes the stream it is given. If that stream were the
 * game's, the dice a later replay expects would depend on how many searches the
 * engine happened to run, and a resumed game would roll different numbers than the
 * log says. Deriving a stream per move keeps the two apart: the game's stream is
 * drawn on by rolls and nothing else, so a seed plus a log is still a whole game.
 *
 * The constant is the 32-bit golden-ratio odd multiplier, a standard way to spread
 * consecutive move numbers across a generator's state; the arithmetic wraps on
 * purpose, which is why it ends in `>>> 0`.
 */
export function moveSeed(seed: number, ply: number): number {
  return (seed + 0x9e3779b9 * (ply + 1)) >>> 0;
}

/**
 * How far ahead the computer must be, in pips, before it offers the doubling
 * cube, and how far behind before it refuses one.
 *
 * OUR policy, not the engine's: `backgammon.ts` gives the cube's rules and a
 * static evaluation, and nothing in it says when a human would reach for the cube.
 * Twenty pips is a little over a checker's journey round the board — the point at
 * which the race is no longer close — and twenty-five is where taking the cube
 * costs more than the chance of coming back. Both are stated as pip counts, which
 * is what `pipCount` measures and what a player reads off the board, so they can
 * be argued with rather than merely trusted.
 */
export const CUBE_OFFER_PIPS = 20;
export const CUBE_DECLINE_PIPS = 25;

/** The leading side's advantage in pips, positive when `seat` is ahead; null for a game without a race. */
export function pipLead(session: BoardSession, seat: number): number | null {
  if (session.game !== "backgammon" || (seat !== 0 && seat !== 1)) return null;
  const state = session.state as backgammon.BackgammonState;
  const other = seat === 0 ? 1 : 0;
  return backgammon.pipCount(state, other) - backgammon.pipCount(state, seat);
}

/** Whether the side to move may offer the cube at all. */
export function canOfferCube(session: BoardSession): boolean {
  if (session.game !== "backgammon" || isOver(session)) return false;
  const state = session.state as backgammon.BackgammonState;
  const seat = turnSeat(session.state);
  return (seat === 0 || seat === 1) && backgammon.canDouble(state, seat);
}

/** Whether the computer, on turn, should offer the cube. */
export function computerOffersCube(session: BoardSession, seat: number): boolean {
  if (session.game !== "backgammon" || (seat !== 0 && seat !== 1)) return false;
  const state = session.state as backgammon.BackgammonState;
  if (!backgammon.canDouble(state, seat)) return false;
  const lead = pipLead(session, seat);
  return lead !== null && lead >= CUBE_OFFER_PIPS;
}

/** Whether the computer answers an offer by taking it. */
export function computerTakesCube(session: BoardSession, seat: number): boolean {
  const lead = pipLead(session, seat);
  return lead === null || lead > -CUBE_DECLINE_PIPS;
}

/** One move event, in the game's own notation; null for anything that is not a move. */
export function notationOf(game: BoardsGame, event: BoardEvent): string | null {
  if (event.kind !== "move") return null;
  const label = describeBoardEvent(game, event);
  return label.kind === "notation" ? label.text : null;
}

/** Whether one move event is reversi's own pass rather than a placement. */
export function isPassMove(game: BoardsGame, event: BoardEvent): boolean {
  return event.kind === "move" && describeBoardEvent(game, event).kind === "pass";
}

/** The cube's value, or null for a game without one. */
export function cubeValue(session: BoardSession): number | null {
  return session.game === "backgammon"
    ? (session.state as backgammon.BackgammonState).cube
    : null;
}

