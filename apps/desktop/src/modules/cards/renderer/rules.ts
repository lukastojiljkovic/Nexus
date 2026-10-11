import {
  CARD_GAMES,
  CARD_GAME_VARIANTS,
  applyFreeCell,
  applyGolf,
  applyHearts,
  applyKlondike,
  applyPyramid,
  applySpades,
  applySpider,
  applyTablic,
  applyTriPeaks,
  CardGameError,
  canUndoFreeCell,
  canUndoGolf,
  canUndoHearts,
  canUndoKlondike,
  canUndoPyramid,
  canUndoSpades,
  canUndoSpider,
  canUndoTablic,
  canUndoTriPeaks,
  cardCode,
  createSeededRandom,
  dealFreeCell,
  dealGolf,
  dealHearts,
  dealKlondike,
  dealPyramid,
  dealSpades,
  dealSpider,
  dealTablic,
  dealTriPeaks,
  freeCellAutoMoves,
  freeCellHint,
  freeCellMoves,
  golfMoves,
  golfSolve,
  hasFreeCellMoves,
  hasGolfMoves,
  hasHeartsMoves,
  hasKlondikeMoves,
  hasPyramidMoves,
  hasSpadesMoves,
  hasSpiderMoves,
  hasTablicMoves,
  hasTriPeaksMoves,
  heartsChooseMove,
  heartsMoves,
  heartsToAct,
  isFreeCellMove,
  isFreeCellWon,
  isGolfMove,
  isGolfWon,
  isHeartsMove,
  isHeartsWon,
  isKlondikeMove,
  isKlondikeWon,
  isPyramidMove,
  isPyramidWon,
  isSpadesMove,
  isSpadesWon,
  isSpiderMove,
  isSpiderWon,
  isTablicMove,
  isTablicWon,
  isTriPeaksMove,
  isTriPeaksWon,
  klondikeAutoMoves,
  klondikeHint,
  klondikeMoves,
  logMoves,
  logPushMove,
  logPushUndo,
  pyramidMoves,
  pyramidSolve,
  replayFreeCell,
  replayGolf,
  replayHearts,
  replayKlondike,
  replayPyramid,
  replaySpades,
  replaySpider,
  replayTablic,
  replayTriPeaks,
  spadesChooseMove,
  spadesMoves,
  spadesToAct,
  spiderAutoMoves,
  spiderDealCount,
  spiderHint,
  spiderMoves,
  tablicChooseMove,
  tablicMoves,
  tablicToAct,
  triPeaksMoves,
  undoFreeCell,
  undoGolf,
  undoHearts,
  undoKlondike,
  undoPyramid,
  undoSpades,
  undoSpider,
  undoTablic,
  undoTriPeaks,
} from "@nexus/core";
import type {
  Card as CardModel,
  CardGameId,
  CardGameVariant,
  CardOpponentLevel,
  GameLogEntry,
  SolverVerdict,
} from "@nexus/core";

/**
 * The page's own turn logic, as pure functions (ADR-090).
 *
 * **What is here and what is not.** What a legal move IS, what a position means and
 * whether a game is over are the ENGINES' — this file reads them through one small
 * registry and never restates a rule. What is here is the page's own shape: the
 * session it holds while somebody plays, the one-step transitions a click makes, and
 * the two things no engine owns — the undo anchor a turn is taken back to, and the
 * per-move stream the computer's search draws its tie-break from.
 *
 * **Why the session is a value with one-step transitions.** A card is drawn the
 * moment it is played and stored a moment later, so the page needs the position, the
 * log that produced it and the undo anchors in ONE value a React state update can
 * replace. Every transition returns a new session and never mutates the old one,
 * which is what makes „what the screen shows" and „what was written" the same thing.
 *
 * **Why the engines are reached through one cast per call.** The nine engines are
 * structurally identical — `deal`, `*Moves`, `apply*`, `replay*`, `undo*`,
 * `is*Won` — but each is parameterised by its own state and move type, so a
 * `Record<CardGameId, …>` of them is a union the compiler will not collapse. The
 * registry below therefore takes the game id and narrows inside each branch: the
 * branch is chosen by the id, and the state it folds is the state that same id's
 * engine produced, which is exactly the fact the cast records. It is the same
 * arrangement `Board.tsx` uses over `boardEngine`.
 */

/**
 * One action as the log carries it.
 *
 * The page's own view of a move is `{ kind, … }` and nothing tighter: the nine
 * engines' move types are read through their own guards at the board, and a log that
 * crossed this seam as a union of nine would force every consumer to switch on it.
 * `GameLogEntry` needs its `kind` to tell a move from an undo, which is the only
 * property the logger itself reads.
 */
type CardLogMove = { readonly kind: string } & Record<string, unknown>;

/** One frame of the undo stack: the position a turn began in, and the log that stood there. */
interface CardFrame {
  readonly state: unknown;
  readonly log: readonly GameLogEntry<CardLogMove>[];
  readonly moves: number;
}

/** One game being played on this page. */
export interface CardSession {
  readonly game: CardGameId;
  readonly variant: CardGameVariant;
  readonly seed: number;
  /** The position the log folds to — the engines' own state, opaque here. */
  readonly state: unknown;
  /** Every action since the deal, undos among them — the store's own `moves`. */
  readonly log: readonly GameLogEntry<CardLogMove>[];
  readonly score: number;
  /** How long the page has been on this deal; handed to main, which stamps it. */
  readonly elapsedSeconds: number;
  /** The level the computer plays at. It is the PAGE's fact — the store has no column for it. */
  readonly level: CardOpponentLevel;
  /** Restore points, newest last: one per human turn. The page's own, never stored. */
  readonly undo: readonly CardFrame[];
  /** The log length the newest anchor was taken at, or null — read to stage one anchor per turn. */
  readonly anchoredAt: number | null;
}

/** What one level of the computer costs and how it decides — read for the new-game panel. */
export const LEVELS: readonly CardOpponentLevel[] = ["easy", "medium", "hard"];

/** The level a game opens at when the person does not choose one. */
export const DEFAULT_LEVEL_NAME: CardOpponentLevel = "medium";

/** Every game in the order the module lists them — the module's own shelf order. */
export const GAME_ORDER: readonly CardGameId[] = CARD_GAMES;

/** The variants of one game, in the vocabulary's own order. */
export function variantsOf(game: CardGameId): readonly CardGameVariant[] {
  return CARD_GAME_VARIANTS[game];
}

/** The three games played against the computer; the other six are solitaires. */
export function isComputerGame(game: CardGameId): boolean {
  return game === "hearts" || game === "spades" || game === "tablic";
}

/** How many seats a game has: four for Hearts and Spades, two or four for Tablić, one for a solitaire. */
export function seatCount(game: CardGameId, variant: CardGameVariant): number {
  if (game === "hearts" || game === "spades") return 4;
  if (game === "tablic") return variant === "pairs" ? 4 : 2;
  return 1;
}

function dealState(game: CardGameId, variant: CardGameVariant, seed: number): unknown {
  switch (game) {
    case "klondike":
      return dealKlondike(variant as never, seed);
    case "freecell":
      return dealFreeCell(seed);
    case "spider":
      return dealSpider(variant as never, seed);
    case "pyramid":
      return dealPyramid(variant as never, seed);
    case "tripeaks":
      return dealTriPeaks(variant as never, seed);
    case "golf":
      return dealGolf(variant as never, seed);
    case "hearts":
      return dealHearts(variant as never, seed);
    case "spades":
      return dealSpades(variant as never, seed);
    case "tablic":
      return dealTablic(variant as never, seed);
  }
}

function scoreOf(game: CardGameId, state: unknown): number {
  if (game === "hearts") return (state as { board: { scores: readonly number[] } }).board.scores[0] ?? 0;
  if (game === "spades") return (state as { board: { scores: readonly number[] } }).board.scores[0] ?? 0;
  if (game === "tablic") return (state as { board: { scores: readonly number[] } }).board.scores[0] ?? 0;
  return (state as { score: number }).score;
}

function wonState(game: CardGameId, state: unknown): boolean {
  switch (game) {
    case "klondike":
      return isKlondikeWon(state as never);
    case "freecell":
      return isFreeCellWon(state as never);
    case "spider":
      return isSpiderWon(state as never);
    case "pyramid":
      return isPyramidWon(state as never);
    case "tripeaks":
      return isTriPeaksWon(state as never);
    case "golf":
      return isGolfWon(state as never);
    case "hearts":
      return isHeartsWon(state as never);
    case "spades":
      return isSpadesWon(state as never);
    case "tablic":
      return isTablicWon(state as never);
  }
}

function legalMovesOf(game: CardGameId, state: unknown): unknown[] {
  switch (game) {
    case "klondike":
      return klondikeMoves(state as never);
    case "freecell":
      return freeCellMoves(state as never);
    case "spider":
      return spiderMoves(state as never);
    case "pyramid":
      return pyramidMoves(state as never);
    case "tripeaks":
      return triPeaksMoves(state as never);
    case "golf":
      return golfMoves(state as never);
    case "hearts":
      return heartsMoves(state as never);
    case "spades":
      return spadesMoves(state as never);
    case "tablic":
      return tablicMoves(state as never);
  }
}

function hasMoves(game: CardGameId, state: unknown): boolean {
  switch (game) {
    case "klondike":
      return hasKlondikeMoves(state as never);
    case "freecell":
      return hasFreeCellMoves(state as never);
    case "spider":
      return hasSpiderMoves(state as never);
    case "pyramid":
      return hasPyramidMoves(state as never);
    case "tripeaks":
      return hasTriPeaksMoves(state as never);
    case "golf":
      return hasGolfMoves(state as never);
    case "hearts":
      return hasHeartsMoves(state as never);
    case "spades":
      return hasSpadesMoves(state as never);
    case "tablic":
      return hasTablicMoves(state as never);
  }
}

function applied(game: CardGameId, state: unknown, move: unknown): unknown {
  switch (game) {
    case "klondike":
      return applyKlondike(state as never, move as never);
    case "freecell":
      return applyFreeCell(state as never, move as never);
    case "spider":
      return applySpider(state as never, move as never);
    case "pyramid":
      return applyPyramid(state as never, move as never);
    case "tripeaks":
      return applyTriPeaks(state as never, move as never);
    case "golf":
      return applyGolf(state as never, move as never);
    case "hearts":
      return applyHearts(state as never, move as never);
    case "spades":
      return applySpades(state as never, move as never);
    case "tablic":
      return applyTablic(state as never, move as never);
  }
}

/** Whether the position's own engine would still accept a move list — the guard `undo` replays through. */
export function listIsValid(game: CardGameId, variant: CardGameVariant, seed: number, log: readonly unknown[]): boolean {
  const replayed = replayState(game, variant, seed, log);
  return replayed.kind === "ok";
}

/** The engine's answer to „is this log a game": its state, or the reason it is not. */
function replayState(
  game: CardGameId,
  variant: CardGameVariant,
  seed: number,
  log: readonly unknown[],
): { readonly kind: "ok"; readonly state: unknown } | { readonly kind: "refused"; readonly detail: string } {
  const replay =
    game === "klondike"
      ? replayKlondike(variant as never, seed, log)
      : game === "freecell"
        ? replayFreeCell(seed, log)
        : game === "spider"
          ? replaySpider(variant as never, seed, log)
          : game === "pyramid"
            ? replayPyramid(variant as never, seed, log)
            : game === "tripeaks"
              ? replayTriPeaks(variant as never, seed, log)
              : game === "golf"
                ? replayGolf(variant as never, seed, log)
                : game === "hearts"
                  ? replayHearts(variant as never, seed, log)
                  : game === "spades"
                    ? replaySpades(variant as never, seed, log)
                    : replayTablic(variant as never, seed, log);
  return replay.ok
    ? { kind: "ok", state: replay.state }
    : { kind: "refused", detail: replay.refusal.detail };
}

/** A fresh deal, dealt from the seed and the variant. Throws for a pair the vocabulary does not carry. */
export function startGame(
  game: CardGameId,
  variant: CardGameVariant,
  seed: number,
  level: CardOpponentLevel = DEFAULT_LEVEL_NAME,
): CardSession {
  const state = dealState(game, variant, seed);
  return {
    game,
    variant,
    seed,
    state,
    log: [],
    score: scoreOf(game, state),
    elapsedSeconds: 0,
    level,
    undo: [],
    anchoredAt: null,
  };
}

/**
 * A session rebuilt from a saved game: `replay*` and nothing else.
 *
 * The stored score never crosses this seam — it is folded again from the log, so a
 * row that had drifted from its own moves would be caught by the engine rather than
 * drawn as a wrong number.
 */
export function resumeGame(save: {
  readonly game: CardGameId;
  readonly variant: CardGameVariant;
  readonly seed: number;
  readonly moves: readonly unknown[];
  readonly elapsedSeconds: number;
  readonly level?: CardOpponentLevel;
}): CardSession {
  const replayed = replayState(save.game, save.variant, save.seed, save.moves);
  if (replayed.kind === "refused") {
    throw new CardGameError(`The saved ${save.game} game does not replay: ${replayed.detail}`);
  }
  return {
    game: save.game,
    variant: save.variant,
    seed: save.seed,
    state: replayed.state,
    log: save.moves as readonly GameLogEntry<CardLogMove>[],
    score: scoreOf(save.game, replayed.state),
    elapsedSeconds: save.elapsedSeconds,
    level: save.level ?? DEFAULT_LEVEL_NAME,
    undo: [],
    anchoredAt: null,
  };
}

/** The legal moves of the position on screen. */
export function legalMoves(session: CardSession): readonly unknown[] {
  return legalMovesOf(session.game, session.state);
}

/** Whether the position allows any move at all. */
export function hasMovesLeft(session: CardSession): boolean {
  return hasMoves(session.game, session.state);
}

/** Whether the game is won — the engine's own test, in its own direction. */
export function isWon(session: CardSession): boolean {
  return wonState(session.game, session.state);
}

/** Whether the position is finished: won, or with nothing left to play. */
export function isFinished(session: CardSession): boolean {
  return isWon(session) || !hasMovesLeft(session);
}

/** Which seat is to act, or -1 for a finished game. Solitaires have one seat: the person. */
export function seatToAct(session: CardSession): number {
  switch (session.game) {
    case "hearts":
      return heartsToAct(session.state as never);
    case "spades":
      return spadesToAct(session.state as never);
    case "tablic":
      return tablicToAct(session.state as never);
    default:
      return isFinished(session) ? -1 : 0;
  }
}

/**
 * Whose turn it is, read off the position rather than folded from the log.
 *
 * **Why this exists beside `seatToAct`.** The engine's own `*ToAct` is the authority
 * and `seatToAct` reads it — but it answers by replaying the whole move list, which
 * is O(plies), and the page asks „is this the computer's turn" after EVERY action. A
 * game against the computer runs to several hundred plies, so a step that called the
 * engine's question would spend the game replaying itself. This reads the same rules
 * off the position directly — the four facts the engines' own `passingSeat` /
 * `biddingSeat` / `playingSeat` read — and `rules.test.ts` pins it against the
 * engine's answer, so a drift between the two fails a test rather than a screen.
 */
export function seatNow(session: CardSession): number {
  const board = (session.state as { board?: Record<string, unknown> }).board;
  if (board === undefined) return isFinished(session) ? -1 : 0;
  const phase = board["phase"];
  if (phase === "complete") return -1;
  if (session.game === "tablic") {
    return typeof board["seat"] === "number" ? board["seat"] : 0;
  }
  if (session.game === "hearts") {
    if (phase === "passing") {
      const passed = (board["passed"] as readonly unknown[] | undefined) ?? [];
      const seat = passed.findIndex((entry) => Array.isArray(entry) && entry.length === 0);
      // Every seat has chosen its pass: the phase is about to turn over, and the
      // seat to act is no longer a passer. -1 says so instead of naming the table's
      // own first seat.
      return seat;
    }
    return nextInTrick(board, 4);
  }
  if (session.game === "spades") {
    if (phase === "bidding") {
      const bids = (board["bids"] as readonly (number | null)[] | undefined) ?? [];
      const dealer = typeof board["dealer"] === "number" ? board["dealer"] : 0;
      for (let step = 0; step < 4; step += 1) {
        const seat = (dealer + 1 + step) % 4;
        if (bids[seat] === null) return seat;
      }
      return dealer;
    }
    return nextInTrick(board, 4);
  }
  return isFinished(session) ? -1 : 0;
}

/** The leader of the trick in play, or the seat after whoever played last. */
function nextInTrick(board: Record<string, unknown>, seats: number): number {
  const trick = (board["trick"] as readonly { readonly seat?: unknown }[] | undefined) ?? [];
  const last = trick[trick.length - 1];
  if (last !== undefined && typeof last.seat === "number") return (last.seat + 1) % seats;
  return typeof board["leader"] === "number" ? board["leader"] : 0;
}

/** The undo entry one press appends to a log, kept whole so the page never spells it. */
export function undoEntry(): GameLogEntry<CardLogMove> {
  return { kind: "undo" };
}

/**
 * One action for one seat: the move is applied and appended to the log.
 *
 * **The anchor is taken when a turn BEGINS for a person, once.** A solitaire's
 * turn is one action, so every action anchors and every press of undo walks back
 * one card. A game against the computer's turn is the person's move AND every
 * answer the machine gives before the person is up again — so the anchor is taken
 * on the first action of that turn and the machine's replies are recorded on top
 * of it, which is what makes one press of undo take the whole turn back rather
 * than handing the table to the wrong seat (see the page's `undoHint`).
 */
export function stepSession(session: CardSession, move: unknown, playerSeat: number): CardSession {
  const seat = seatNow(session);
  const state = applied(session.game, session.state, move);
  const log = logPushMove(session.log, move as GameLogEntry<CardLogMove>);
  const anchored =
    session.anchoredAt === session.log.length &&
    session.undo[session.undo.length - 1]?.moves === session.log.length;
  // A solitaire's turn is one action, so every action anchors and every press of undo
  // walks back one card. At the table the anchor is staged ONCE per person's turn — as
  // that turn BEGINS, so the machine's answers ride on it — which is what makes a single
  // press take the whole turn back rather than hand the table to a seat that has not
  // played.
  const stage = !anchored && (seat === playerSeat || !isComputerGame(session.game));
  const undo = stage
    ? [...session.undo, { state: session.state, log: session.log, moves: session.log.length }]
    : session.undo;
  return {
    ...session,
    state,
    log,
    score: scoreOf(session.game, state),
    undo,
    // The frame is stamped with the length BEFORE the action, so a second action
    // lands at a longer log and stages nothing: one frame per turn.
    anchoredAt: stage ? session.log.length : null,
  };
}

/** Whether the page offers „Nazad": an anchor to return to, and nobody mid-turn to interrupt. */
export function canUndo(session: CardSession): boolean {
  if (session.undo.length === 0) return false;
  if (isComputerGame(session.game) && seatNow(session) !== 0) return false;
  if (!isComputerGame(session.game)) {
    return canUndoOf(session.game, session.state);
  }
  return true;
}

function canUndoOf(game: CardGameId, state: unknown): boolean {
  switch (game) {
    case "klondike":
      return canUndoKlondike(state as never);
    case "freecell":
      return canUndoFreeCell(state as never);
    case "spider":
      return canUndoSpider(state as never);
    case "pyramid":
      return canUndoPyramid(state as never);
    case "tripeaks":
      return canUndoTriPeaks(state as never);
    case "golf":
      return canUndoGolf(state as never);
    case "hearts":
      return canUndoHearts(state as never);
    case "spades":
      return canUndoSpades(state as never);
    case "tablic":
      return canUndoTablic(state as never);
  }
}

function undid(game: CardGameId, state: unknown): unknown {
  switch (game) {
    case "klondike":
      return undoKlondike(state as never);
    case "freecell":
      return undoFreeCell(state as never);
    case "spider":
      return undoSpider(state as never);
    case "pyramid":
      return undoPyramid(state as never);
    case "tripeaks":
      return undoTriPeaks(state as never);
    case "golf":
      return undoGolf(state as never);
    case "hearts":
      return undoHearts(state as never);
    case "spades":
      return undoSpades(state as never);
    case "tablic":
      return undoTablic(state as never);
  }
}

/**
 * Takes the current turn back.
 *
 * A SOLITAIRE undoes through its own engine, which prices the undo in the score
 * (Klondike's table charges for the search), so the log and the score stay the
 * engine's. A game against the computer restores the ANCHOR instead: the engine's
 * own undo would take exactly one ply back, which after the machine has answered
 * is the machine's move rather than the person's turn — so the position, the log
 * and the score are the ones that stood when the person's turn began.
 */
export function undoSession(session: CardSession): CardSession {
  if (!canUndo(session)) return session;
  if (isComputerGame(session.game)) {
    const anchor = session.undo[session.undo.length - 1];
    if (anchor === undefined) return session;
    return {
      ...session,
      state: anchor.state,
      log: anchor.log,
      score: scoreOf(session.game, anchor.state),
      undo: session.undo.slice(0, -1),
      anchoredAt: null,
    };
  }
  const state = undid(session.game, session.state);
  const log = logPushUndo(session.log);
  return {
    ...session,
    state,
    log,
    score: scoreOf(session.game, state),
    undo: session.undo.slice(0, -1),
    anchoredAt: null,
  };
}

/** The engine's hint for the position, or null where the engine offers none. */
export function hintMove(session: CardSession): unknown | null {
  switch (session.game) {
    case "klondike":
      return klondikeHint(session.state as never);
    case "freecell":
      return freeCellHint(session.state as never);
    case "spider":
      return spiderHint(session.state as never);
    default:
      return null;
  }
}

/** The moves „play what is safe" would make, in order — the page's own button. */
export function safeMoves(session: CardSession): readonly unknown[] {
  switch (session.game) {
    case "klondike":
      return klondikeAutoMoves(session.state as never);
    case "freecell":
      return freeCellAutoMoves(session.state as never);
    case "spider":
      return spiderAutoMoves(session.state as never);
    default:
      return [];
  }
}

/** Whether the game has a solver the page can ask about the deal in front of it. */
export function canSolve(session: CardSession): boolean {
  return session.game === "pyramid" || session.game === "golf";
}

/**
 * The solver's verdict on the position — Pyramid and Golf only, and a BOUNDED
 * search: `unknown` is a real answer for a table too wide to finish, and the page
 * says which of the three it got rather than pretending to certainty.
 */
export function solveVerdict(session: CardSession): SolverVerdict | null {
  if (session.game === "pyramid") return pyramidSolve(session.state as never).verdict;
  if (session.game === "golf") return golfSolve(session.state as never).verdict;
  return null;
}

/** How many redeals Spider's stock can still pay, for the row that shows it. */
export function spiderRows(session: CardSession): number | null {
  return session.game === "spider" ? spiderDealCount(session.state as never) : null;
}

/** The moves still standing, in order — what the move list prints. */
export function playedMoves(session: CardSession): readonly unknown[] {
  return logMoves(session.log as readonly GameLogEntry<{ readonly kind: string }>[]);
}

/**
 * The stream the computer's SEARCH draws its equal-move tie-break from: the deal's
 * seed mixed with the ply.
 *
 * **Why not the deal's own stream.** The engines shuffle their root moves once per
 * call, and a shuffle consumes the stream it is given. If that stream were the
 * deal's, a saved game's later moves would depend on how many searches happened to
 * run — so the seed is mixed per ply with the 32-bit golden-ratio odd multiplier
 * (the standard spreading constant, wrapping on purpose) and the search's stream
 * never touches the deal's.
 */
export function moveSeed(seed: number, ply: number): number {
  return (seed + 0x9e37_79b9 * (ply + 1)) >>> 0;
}

/**
 * The move the computer plays at this seat.
 *
 * **Measured, which is why this is a worker call and not a local one.** Hearts at
 * `hard` runs a twelve-determinization Monte Carlo: the probe run for this module
 * timed one move at 4.6 ms worst case and a whole game's worth of them at 88 ms,
 * with Spades at 1.4/179 ms and Tablić at 1.9/83 ms. A few milliseconds inside one
 * animation frame is survivable, 88 ms of them is not — so the choice is made off
 * the UI thread (`renderer/ai/protocol.ts`) and the page shows it is thinking.
 */
export function computerMove(
  game: CardGameId,
  level: CardOpponentLevel,
  state: unknown,
  seed: number,
): unknown {
  const random = createSeededRandom(seed);
  // `state` is the engines' own position. It is passed explicitly rather than read
  // off a session because the worker is handed a POSITION — the page keeps the seed
  // and the log — and this is the one function that reads it.
  switch (game) {
    case "hearts":
      return heartsChooseMove(state as never, level, random);
    case "spades":
      return spadesChooseMove(state as never, level, random);
    case "tablic":
      return tablicChooseMove(state as never, level, random);
    default:
      throw new CardGameError(`"${game}" is not played against the computer.`);
  }
}

/** The move guards, by game — what the worker's protocol checks an answer against. */
export function isMoveFor(game: CardGameId, value: unknown): boolean {
  switch (game) {
    case "klondike":
      return isKlondikeMove(value);
    case "freecell":
      return isFreeCellMove(value);
    case "spider":
      return isSpiderMove(value);
    case "pyramid":
      return isPyramidMove(value);
    case "tripeaks":
      return isTriPeaksMove(value);
    case "golf":
      return isGolfMove(value);
    case "hearts":
      return isHeartsMove(value);
    case "spades":
      return isSpadesMove(value);
    case "tablic":
      return isTablicMove(value);
  }
}

/** The engine's own leaf for one card — the notation the fixtures and the move list use. */
export function cardCodeOf(card: CardModel): string {
  return cardCode(card);
}
