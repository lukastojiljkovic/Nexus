/**
 * Golf: seven columns of five face-up cards, one card as the foundation's base,
 * sixteen face down in the stock, and one rule for going home — the exposed card
 * of a column is played when it is one rank above or below the card on the
 * foundation, whatever the suit.
 *
 * The rules are the article's
 * (https://en.wikipedia.org/wiki/Golf_(patience) § Rules and § Play): cards rank
 * Ace to King, there is no wrapping in the strict form (so a King can only be
 * followed by a Queen and an Ace only by a Two), a turn of the stock happens only
 * when nothing on the tableau can be played, there is no redeal, and the game
 * ends when the stock is exhausted and nothing is playable. `classic` is that
 * game and `wrap` is the article's named „Putt Putt" variation, in which a King
 * goes on an Ace and an Ace on a King.
 *
 * **The score is the article's own**: one point for each card left in the tableau
 * when the game ends, so FEWER is better and a cleared tableau is zero — which is
 * why `CARD_GAME_SCORE_DIRECTION` calls Golf a `lower` game and why the store
 * keeps the smallest result rather than the largest. The score is a function of
 * the board (the cards still in the columns), never a counter, so undo cannot
 * leave it disagreeing with what is on the table.
 *
 * As in the three engines before it, the state is a pure function of its deal and
 * its log: `initial` is the board that was dealt, the fold replays the log from
 * it, and a saved game is `(variant, seed, log)`.
 */

import { cardCode, standardDeck, type Card } from "./card.js";
import {
  CardGameError,
  IllegalMoveError,
  isCardGameVariant,
  isCardSeed,
  type CardGameRefusal,
  type CardGameReplay,
  type GolfVariant,
} from "./game.js";
import {
  isGameLogEntry,
  isUndoEntry,
  logCanUndo,
  logPushMove,
  logPushUndo,
  type GameLogEntry,
} from "./log.js";
import { createSeededRandom, shuffled } from "../random.js";
import { SOLVER_NODE_BOUND, solveSolitaire, type SolitaireSolver, type SolverAnswer } from "./solver.js";

/** Seven columns of five: the article's layout, and the whole tableau. */
export const GOLF_COLUMNS = 7;
export const GOLF_DEPTH = 5;
/** The tableau, the foundation's base card and the stock: 35 + 1 + 16 of a 52-card deck. */
export const GOLF_TABLEAU_CARDS = GOLF_COLUMNS * GOLF_DEPTH;
export const GOLF_STOCK_CARDS = 52 - GOLF_TABLEAU_CARDS - 1;

/**
 * The table. Every pile is read and written with its LAST element as its top: a
 * column's last card is the exposed one, the foundation's last is the rank a move
 * has to touch, and the stock's last is the next card turned over.
 */
export interface GolfBoard {
  /** Seven columns, left to right; only the last card of each can be played. */
  readonly columns: readonly (readonly Card[])[];
  /** One pile that starts with the base card and only ever grows. */
  readonly foundation: readonly Card[];
  /** The face-down stock; the last card is the next one turned. */
  readonly stock: readonly Card[];
}

export type GolfMove =
  /** Play the exposed card of a column onto the foundation. */
  | { readonly kind: "play"; readonly column: number }
  /** Turn the stock's next card onto the foundation. Legal only when nothing on the tableau can be played. */
  | { readonly kind: "turn" };

export interface GolfState {
  readonly variant: GolfVariant;
  readonly seed: number;
  readonly initial: GolfBoard;
  readonly board: GolfBoard;
  readonly log: readonly GameLogEntry<GolfMove>[];
  /** Cards left in the tableau — the article's score, and smaller is better. */
  readonly score: number;
}

export type GolfReplay = CardGameReplay<GolfState>;

interface GolfFrame {
  readonly move: GolfMove;
  readonly board: GolfBoard;
  readonly score: number;
}

interface GolfFold {
  readonly board: GolfBoard;
  readonly score: number;
  readonly pending: readonly GolfFrame[];
}

/** Deals a fresh table. Throws for a variant or a seed nobody could have meant. */
export function dealGolf(variant: GolfVariant, seed: number): GolfState {
  if (!isCardGameVariant("golf", variant)) {
    throw new CardGameError(`"${variant}" is not a Golf variant.`);
  }
  if (!isCardSeed(seed)) {
    throw new CardGameError(`A Golf seed must be a 32-bit unsigned integer, got ${seed}.`);
  }
  const initial = dealtBoard(seed);
  return { variant, seed, initial, board: initial, log: [], score: tableauCount(initial) };
}

/** Rebuilds the state a saved `(variant, seed, log)` describes, or says why it cannot be one. */
export function replayGolf(variant: GolfVariant, seed: number, log: unknown): GolfReplay {
  if (!isCardGameVariant("golf", variant)) {
    return {
      ok: false,
      refusal: { code: "unknown-variant", atIndex: null, detail: `"${variant}" is not a Golf variant.` },
    };
  }
  if (!isCardSeed(seed)) {
    return {
      ok: false,
      refusal: { code: "bad-seed", atIndex: null, detail: `"${seed}" is not a 32-bit unsigned seed.` },
    };
  }
  if (!Array.isArray(log)) {
    return {
      ok: false,
      refusal: { code: "bad-entry", atIndex: null, detail: "The move list is not a list." },
    };
  }
  const initial = dealtBoard(seed);
  const folded = foldGolf(variant, initial, log as readonly unknown[]);
  if (!folded.ok) return { ok: false, refusal: folded.refusal };
  return {
    ok: true,
    state: {
      variant,
      seed,
      initial,
      board: folded.fold.board,
      log: log as readonly GameLogEntry<GolfMove>[],
      score: folded.fold.score,
    },
  };
}

export function isGolfMove(value: unknown): value is GolfMove {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; column?: unknown };
  if (candidate.kind === "turn") return Object.keys(value).length === 1;
  return candidate.kind === "play" && isColumnIndex(candidate.column);
}

export function isGolfEntry(value: unknown): value is GameLogEntry<GolfMove> {
  return isGameLogEntry(value, isGolfMove);
}

/**
 * Every move the position allows. A play is offered for each column whose exposed
 * card touches the foundation's rank, and a TURN is offered only when no column
 * does — the article's „whenever there are no possible plays", which is a rule
 * about the move rather than a hint, so a turn beside an available play is
 * illegal and not merely unwise.
 *
 * An empty tableau has NO moves, not a turn: the article scores „a negative point
 * for every card left in the stock" once the tableau is cleared, so a cleared
 * tableau ends the game however much stock is left, and offering a turn there
 * would let a player go on turning cards over after winning.
 */
export function golfMoves(state: GolfState): GolfMove[] {
  return golfMovesOnBoard(state.variant, state.board);
}

export function isGolfMoveLegal(state: GolfState, move: GolfMove): boolean {
  return golfMoves(state).some((candidate) => sameMove(candidate, move));
}

export function applyGolf(state: GolfState, move: GolfMove): GolfState {
  if (!isGolfMove(move)) {
    throw new IllegalMoveError(`Not a Golf move: ${JSON.stringify(move)}.`);
  }
  const log = logPushMove(state.log, move);
  const folded = foldGolf(state.variant, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log, score: folded.fold.score };
}

export function canUndoGolf(state: GolfState): boolean {
  return logCanUndo(state.log);
}

/** Takes back the last move. The score comes back with the board, because it IS the board's card count. */
export function undoGolf(state: GolfState): GolfState {
  if (!canUndoGolf(state)) {
    throw new IllegalMoveError("Nothing left to undo in this deal.");
  }
  const log = logPushUndo(state.log);
  const folded = foldGolf(state.variant, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log, score: folded.fold.score };
}

/** A cleared tableau. The article's win is the tableau, not the stock: cards left face down cost nothing. */
export function isGolfWon(state: GolfState): boolean {
  return state.board.columns.every((pile) => pile.length === 0);
}

/** Whether any action is left — false exactly when the game is over, won or stuck. */
export function hasGolfMoves(state: GolfState): boolean {
  return golfMovesOnBoard(state.variant, state.board).length > 0;
}

/**
 * „Winnable from here?" for one position, by the shared bounded search — see
 * `solver.ts` for the bound and for why the memo is a proof. Both Golf and
 * Pyramid answer this question with it.
 */
export function golfSolve(state: GolfState, bound: number = SOLVER_NODE_BOUND): SolverAnswer<GolfMove> {
  return solveSolitaire(GOLF_SOLVER, state, bound);
}

const GOLF_SOLVER: SolitaireSolver<GolfState, GolfMove> = {
  moves: (state) => golfMovesOnBoard(state.variant, state.board),
  apply: (state, move) => withBoard(state, stepBoard(state.variant, state.board, move)),
  isWon: (state) => state.board.columns.every((pile) => pile.length === 0),
  // Depths, the foundation's top and how much stock is left: two positions that
  // agree on all three have the same cards in the columns (a column only ever
  // loses its top), the same rank to play onto, and the same next card to turn.
  key: (state) =>
    `${state.variant}|${state.board.columns.map((pile) => pile.length).join("")}|` +
    `${foundationTopCode(state.board)}|${state.board.stock.length}`,
};

/** The deal: five cards to each of seven columns, one to the foundation, sixteen to the stock. */
function dealtBoard(seed: number): GolfBoard {
  const deck = shuffled(standardDeck(), createSeededRandom(seed));
  const columns: Card[][] = [];
  for (let column = 0; column < GOLF_COLUMNS; column += 1) {
    columns.push(deck.slice(column * GOLF_DEPTH, (column + 1) * GOLF_DEPTH));
  }
  const base = deck[GOLF_TABLEAU_CARDS]!;
  // Reversed, because the last card of the stock is the next one turned over and
  // the deal's own order is „first card dealt is turned first".
  return {
    columns,
    foundation: [base],
    stock: deck.slice(GOLF_TABLEAU_CARDS + 1).reverse(),
  };
}

/**
 * The one place a Golf state is built: the log walked from `initial`. Every step
 * is the board change alone, and the score is read off the board it produces.
 */
function foldGolf(
  variant: GolfVariant,
  initial: GolfBoard,
  log: readonly unknown[],
): { ok: true; fold: GolfFold } | { ok: false; refusal: CardGameRefusal } {
  let board = initial;
  let score = tableauCount(initial);
  const pending: GolfFrame[] = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (!isGolfEntry(entry)) {
      return {
        ok: false,
        refusal: {
          code: "bad-entry",
          atIndex: index,
          detail: `Entry ${index} is neither a Golf move nor an undo.`,
        },
      };
    }
    if (isUndoEntry(entry)) {
      const frame = pending.pop();
      if (frame === undefined) {
        return {
          ok: false,
          refusal: {
            code: "empty-undo",
            atIndex: index,
            detail: `Entry ${index} undoes a move that is no longer there.`,
          },
        };
      }
      board = frame.board;
      score = frame.score;
      continue;
    }
    if (!golfMovesOnBoard(variant, board).some((candidate) => sameMove(candidate, entry))) {
      return {
        ok: false,
        refusal: {
          code: "illegal-move",
          atIndex: index,
          detail: `Entry ${index} is not legal in the position it was played from.`,
        },
      };
    }
    pending.push({ move: entry, board, score });
    board = stepBoard(variant, board, entry);
    score = tableauCount(board);
  }
  return { ok: true, fold: { board, score, pending } };
}

function movesOnBoard(variant: GolfVariant, board: GolfBoard): GolfMove[] {
  const plays: GolfMove[] = [];
  board.columns.forEach((pile, column) => {
    const top = pile[pile.length - 1];
    if (top !== undefined && touches(board, top, variant)) plays.push({ kind: "play", column });
  });
  if (plays.length > 0) return plays;
  return board.stock.length > 0 ? [{ kind: "turn" }] : [];
}

/**
 * The moves of one board, with a cleared tableau being the end of the game rather
 * than a position that may be turned from — see `golfMoves` for the rule.
 */
function golfMovesOnBoard(variant: GolfVariant, board: GolfBoard): GolfMove[] {
  return board.columns.every((pile) => pile.length === 0) ? [] : movesOnBoard(variant, board);
}

function stepBoard(variant: GolfVariant, board: GolfBoard, move: GolfMove): GolfBoard {
  if (move.kind === "turn") {
    const next = board.stock[board.stock.length - 1]!;
    return {
      ...board,
      foundation: [...board.foundation, next],
      stock: board.stock.slice(0, board.stock.length - 1),
    };
  }
  const columns = board.columns.map((pile) => [...pile]);
  const pile = columns[move.column]!;
  const card = pile.pop()!;
  return { ...board, columns, foundation: [...board.foundation, card] };
}

/** One board later, with the score read off it — the fold's step, and the solver's transition. */
function withBoard(state: GolfState, board: GolfBoard): GolfState {
  return { ...state, board, score: tableauCount(board) };
}

/** One rank away, or — in the wrap variant only — a King on an Ace or an Ace on a King. */
function touches(board: GolfBoard, card: Card, variant: GolfVariant): boolean {
  const top = board.foundation[board.foundation.length - 1];
  if (top === undefined) return false;
  const gap = Math.abs(top.rank - card.rank);
  return gap === 1 || (variant === "wrap" && gap === 12);
}

function tableauCount(board: GolfBoard): number {
  return board.columns.reduce((total, pile) => total + pile.length, 0);
}

function foundationTopCode(board: GolfBoard): string {
  const top = board.foundation[board.foundation.length - 1];
  return top === undefined ? "-" : cardCode(top);
}

function sameMove(left: GolfMove, right: GolfMove): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "play" && right.kind === "play") return left.column === right.column;
  return left.kind === right.kind;
}

function isColumnIndex(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value < GOLF_COLUMNS
  );
}
