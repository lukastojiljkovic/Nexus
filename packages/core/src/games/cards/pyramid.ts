/**
 * Pyramid: twenty-eight cards in seven rows, and the rule that a pair of exposed
 * cards whose ranks total thirteen leaves the table — the Ace as one, the Jack as
 * eleven, the Queen as twelve and the King as thirteen, so a King goes home alone.
 *
 * The rules are the article's
 * (https://en.wikipedia.org/wiki/Pyramid_(solitaire) § Rules): the pyramid is
 * built one card, then two, then three, and so on to seven, the twenty-four cards
 * left over are the stock, a card may be matched only when nothing covers it, the
 * top card of the waste may be matched with the next card drawn or with any
 * uncovered pyramid card, and discarded cards never come back. `pass1` turns the
 * stock over once and `pass3` is the article's Par Pyramid, which turns the waste
 * back into a new stock twice more.
 *
 * **Two decisions the article leaves open, both named.** The win is the article's
 * *relaxed* one, which the same page states as its own variation: a game is won
 * when the PYRAMID is empty, and the stock and waste may still hold cards
 * („Relaxed Pyramid"). The strict rule — every card, stock included — needs a deal
 * whose whole stock can be matched away, which is a rarer game than the one
 * stages 2 plays, and it is listed in the report as a stage-2 option rather than
 * quietly substituted. And the score is the article's own: one point for each
 * card still in the pyramid when the game ends, so FEWER is better and a win
 * scores zero — which is why `CARD_GAME_SCORE_DIRECTION` calls Pyramid a `lower`
 * game. That does mean a win's recorded best score is always zero; it is the
 * source's arithmetic rather than an omission, and the score is still what tells
 * a lost game from a lost game.
 *
 * A state is a pure function of its deal and its log, as in every engine here.
 */

import { standardDeck, type Card } from "./card.js";
import {
  CardGameError,
  IllegalMoveError,
  isCardGameVariant,
  isCardSeed,
  type CardGameRefusal,
  type CardGameReplay,
  type PyramidVariant,
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
import { solveSolitaire, type SolitaireSolver, type SolverAnswer } from "./solver.js";

/** Seven rows of one to seven: the whole pyramid, and the deal's own arithmetic. */
export const PYRAMID_ROWS = 7;
export const PYRAMID_CARDS = (PYRAMID_ROWS * (PYRAMID_ROWS + 1)) / 2;
/** The stock the pyramid leaves: 52 − 28. */
export const PYRAMID_STOCK_CARDS = 52 - PYRAMID_CARDS;

/**
 * How many times the waste may be turned back into the stock, one per variant.
 * `pass3` is Par Pyramid's „turned over and dealt as a new stock twice", so two
 * recycles on top of the deal's own pass make three.
 */
const PYRAMID_RECYCLES: Readonly<Record<PyramidVariant, number>> = { pass1: 0, pass3: 2 };

/** Thirteen, and the top of the ranks — the one card that goes home alone. */
const KING = 13;

/**
 * The one or two slots directly below each slot, precomputed once. Row `r` holds
 * rows 0..r-1 before it, so the card at row `r`, position `p` sits at slot
 * `r(r+1)/2 + p`, and row `r+1`'s positions `p` and `p+1` are the two that cover
 * it. A row-arithmetic helper called in the inner loop of a search is the kind of
 * thing that costs a budget and hides a bug; a table cannot be off by one.
 */
const PYRAMID_COVERS: readonly (readonly number[])[] = (() => {
  const table: number[][] = [];
  for (let row = 0; row < PYRAMID_ROWS; row += 1) {
    for (let position = 0; position <= row; position += 1) {
      const below = ((row + 1) * (row + 2)) / 2 + position;
      table.push(row === PYRAMID_ROWS - 1 ? [] : [below, below + 1]);
    }
  }
  return table;
})();

/**
 * The bound the Pyramid solver runs under. Smaller than the shared default
 * because a Pyramid key is the whole table — 28 slots, the waste, the stock and
 * the pass count — and the memo holds one of those per position visited; fifty
 * thousand positions is what keeps a probe inside a second on this machine. See
 * `solver.ts` for what a verdict of `unknown` means.
 */
export const PYRAMID_SOLVER_BOUND = 50_000;

/**
 * The table. Every pile is read and written with its LAST element as its top: the
 * last drawn card is the waste's top and the only one that may be matched, and
 * the stock's last card is the next one drawn.
 */
export interface PyramidBoard {
  /** 28 slots in row order — row 0 is slot 0, row 6 is slots 21..27 — with null for a card already matched off. */
  readonly cards: readonly (Card | null)[];
  readonly stock: readonly Card[];
  readonly waste: readonly Card[];
  /** How many times the waste has been turned back into the stock so far. */
  readonly passes: number;
}

/** Where a card is: one pyramid slot, or the waste's top card. */
export type PyramidSlot =
  | { readonly kind: "pyramid"; readonly index: number }
  | { readonly kind: "waste" };

export type PyramidMove =
  /**
   * Cards totalling thirteen leave the table: a lone King (`second` absent) or two
   * cards that add up to thirteen. Both must be exposed, and a pair may name them
   * in either order — `isPyramidMoveLegal` reads the two as a set.
   */
  | {
      readonly kind: "match";
      readonly first: PyramidSlot;
      readonly second?: PyramidSlot;
    }
  /** Draw the stock's next card onto the waste. */
  | { readonly kind: "draw" }
  /** Turn the waste back into the stock. Legal only with an empty stock and a recycle left. */
  | { readonly kind: "recycle" };

export interface PyramidState {
  readonly variant: PyramidVariant;
  readonly seed: number;
  readonly initial: PyramidBoard;
  readonly board: PyramidBoard;
  readonly log: readonly GameLogEntry<PyramidMove>[];
  /** Cards left in the pyramid — the article's score, and smaller is better. */
  readonly score: number;
}

export type PyramidReplay = CardGameReplay<PyramidState>;

interface PyramidFrame {
  readonly move: PyramidMove;
  readonly board: PyramidBoard;
  readonly score: number;
}

interface PyramidFold {
  readonly board: PyramidBoard;
  readonly score: number;
  readonly pending: readonly PyramidFrame[];
}

/** Deals a fresh pyramid. Throws for a variant or a seed nobody could have meant. */
export function dealPyramid(variant: PyramidVariant, seed: number): PyramidState {
  if (!isCardGameVariant("pyramid", variant)) {
    throw new CardGameError(`"${variant}" is not a Pyramid variant.`);
  }
  if (!isCardSeed(seed)) {
    throw new CardGameError(`A Pyramid seed must be a 32-bit unsigned integer, got ${seed}.`);
  }
  const initial = dealtBoard(seed);
  return { variant, seed, initial, board: initial, log: [], score: PYRAMID_CARDS };
}

/** Rebuilds the state a saved `(variant, seed, log)` describes, or says why it cannot be one. */
export function replayPyramid(variant: PyramidVariant, seed: number, log: unknown): PyramidReplay {
  if (!isCardGameVariant("pyramid", variant)) {
    return {
      ok: false,
      refusal: {
        code: "unknown-variant",
        atIndex: null,
        detail: `"${variant}" is not a Pyramid variant.`,
      },
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
  const folded = foldPyramid(variant, initial, log as readonly unknown[]);
  if (!folded.ok) return { ok: false, refusal: folded.refusal };
  return {
    ok: true,
    state: {
      variant,
      seed,
      initial,
      board: folded.fold.board,
      log: log as readonly GameLogEntry<PyramidMove>[],
      score: folded.fold.score,
    },
  };
}

export function isPyramidMove(value: unknown): value is PyramidMove {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown };
  if (candidate.kind === "draw" || candidate.kind === "recycle") {
    return Object.keys(value).length === 1;
  }
  if (candidate.kind !== "match") return false;
  const { first, second } = value as { first?: unknown; second?: unknown };
  if (!isPyramidSlot(first)) return false;
  if (second === undefined) return Object.keys(value).length === 2;
  return isPyramidSlot(second) && Object.keys(value).length === 3;
}

export function isPyramidEntry(value: unknown): value is GameLogEntry<PyramidMove> {
  return isGameLogEntry(value, isPyramidMove);
}

/**
 * Every move the position allows: every lone King, then every exposed pair that
 * totals thirteen, then the draw, then the recycle. Defined by enumeration and
 * nothing else, so „legal" and „offered" cannot disagree.
 *
 * An empty pyramid has NO moves, not a draw: the win this engine implements is the
 * article's relaxed one, a cleared pyramid, so the game is over there however much
 * stock is left — and offering a draw afterwards would let a player keep going
 * after winning.
 */
export function pyramidMoves(state: PyramidState): PyramidMove[] {
  return pyramidMovesOnBoard(state.variant, state.board);
}

export function isPyramidMoveLegal(state: PyramidState, move: PyramidMove): boolean {
  return pyramidMoves(state).some((candidate) => sameMove(candidate, move));
}

export function applyPyramid(state: PyramidState, move: PyramidMove): PyramidState {
  if (!isPyramidMove(move)) {
    throw new IllegalMoveError(`Not a Pyramid move: ${JSON.stringify(move)}.`);
  }
  const log = logPushMove(state.log, move);
  const folded = foldPyramid(state.variant, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log, score: folded.fold.score };
}

export function canUndoPyramid(state: PyramidState): boolean {
  return logCanUndo(state.log);
}

/** Takes back the last move. The score comes back with the board, because it IS the pyramid's card count. */
export function undoPyramid(state: PyramidState): PyramidState {
  if (!canUndoPyramid(state)) {
    throw new IllegalMoveError("Nothing left to undo in this deal.");
  }
  const log = logPushUndo(state.log);
  const folded = foldPyramid(state.variant, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log, score: folded.fold.score };
}

/** An empty pyramid — the article's relaxed win. */
export function isPyramidWon(state: PyramidState): boolean {
  return state.board.cards.every((held) => held === null);
}

/** Whether any action is left — false exactly when the game is over, won or stuck. */
export function hasPyramidMoves(state: PyramidState): boolean {
  return pyramidMoves(state).length > 0;
}

/**
 * „Winnable from here?" for one position, by the shared bounded search — see
 * `solver.ts` for what the three verdicts mean and `PYRAMID_SOLVER_BOUND` for the
 * bound this game runs it under.
 */
export function pyramidSolve(
  state: PyramidState,
  bound: number = PYRAMID_SOLVER_BOUND,
): SolverAnswer<PyramidMove> {
  return solveSolitaire(PYRAMID_SOLVER, state, bound);
}

const PYRAMID_SOLVER: SolitaireSolver<PyramidState, PyramidMove> = {
  moves: (state) => movesOnBoard(state.variant, state.board),
  apply: (state, move) => withBoard(state, stepBoard(state.variant, state.board, move)),
  isWon: (state) => state.board.cards.every((held) => held === null),
  // The whole table, because every part of it is read by some move: which pyramid
  // cards are still there, the waste pile top-down, the stock pile in the order it
  // will be drawn (a recycle makes it a different sequence from the deal's own),
  // and how many recycles are left.
  key: (state) =>
    `${state.board.cards.map((held) => (held === null ? ".." : slotCode(held))).join("")}|` +
    `${state.board.waste.map(slotCode).join("")}|${state.board.stock.map(slotCode).join("")}|` +
    `${state.board.passes}`,
};

/** The deal: one card, then two, and so on to seven; the rest is the stock. */
function dealtBoard(seed: number): PyramidBoard {
  const deck = shuffled(standardDeck(), createSeededRandom(seed));
  const cards = deck.slice(0, PYRAMID_CARDS);
  // Reversed, because the last card of the stock is the next one drawn and the
  // deal's own order is „first card dealt is drawn first".
  return { cards, stock: deck.slice(PYRAMID_CARDS).reverse(), waste: [], passes: 0 };
}

/**
 * The one place a Pyramid state is built: the log walked from `initial`, with the
 * score read off the pyramid each step leaves behind. A King match is a match with
 * nothing to pair with; a pair is read as a set, so the two orders of the same
 * pair are one move.
 */
function foldPyramid(
  variant: PyramidVariant,
  initial: PyramidBoard,
  log: readonly unknown[],
): { ok: true; fold: PyramidFold } | { ok: false; refusal: CardGameRefusal } {
  let board = initial;
  let score = pyramidCount(initial);
  const pending: PyramidFrame[] = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (!isPyramidEntry(entry)) {
      return {
        ok: false,
        refusal: {
          code: "bad-entry",
          atIndex: index,
          detail: `Entry ${index} is neither a Pyramid move nor an undo.`,
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
    if (!pyramidMovesOnBoard(variant, board).some((candidate) => sameMove(candidate, entry))) {
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
    score = pyramidCount(board);
  }
  return { ok: true, fold: { board, score, pending } };
}

function movesOnBoard(variant: PyramidVariant, board: PyramidBoard): PyramidMove[] {
  const moves: PyramidMove[] = [];
  const exposed: PyramidSlot[] = [];
  board.cards.forEach((held, index) => {
    if (held !== null && isExposed(board, index)) exposed.push({ kind: "pyramid", index });
  });
  if (board.waste.length > 0) exposed.push({ kind: "waste" });

  for (const slot of exposed) {
    // A King is thirteen on its own, and no card has rank zero, so it is never
    // part of a pair — which is why it is the one card that goes home alone.
    // Thirteen is the King, and the ranks stop there: no card has rank zero, so
    // a King is never one half of a pair.
    if (cardAt(board, slot).rank === KING) {
      moves.push({ kind: "match", first: slot });
    }
  }
  for (let left = 0; left < exposed.length; left += 1) {
    for (let right = left + 1; right < exposed.length; right += 1) {
      const first = exposed[left]!;
      const second = exposed[right]!;
      if (cardAt(board, first).rank + cardAt(board, second).rank === 13) {
        moves.push({ kind: "match", first, second });
      }
    }
  }

  if (board.stock.length > 0) moves.push({ kind: "draw" });
  else if (board.waste.length > 0 && board.passes < PYRAMID_RECYCLES[variant]) {
    moves.push({ kind: "recycle" });
  }
  return moves;
}

/** The moves of one board, with a cleared pyramid being the end of the game — see `pyramidMoves`. */
function pyramidMovesOnBoard(variant: PyramidVariant, board: PyramidBoard): PyramidMove[] {
  return board.cards.every((held) => held === null) ? [] : movesOnBoard(variant, board);
}

function stepBoard(variant: PyramidVariant, board: PyramidBoard, move: PyramidMove): PyramidBoard {
  if (move.kind === "draw") {
    const next = board.stock[board.stock.length - 1]!;
    return {
      ...board,
      stock: board.stock.slice(0, board.stock.length - 1),
      waste: [...board.waste, next],
    };
  }
  if (move.kind === "recycle") {
    // Reversed, exactly as Klondike's recycle is: the first card turned over in the
    // new pass is the first card of the old one, which is the pile's own order.
    return { ...board, stock: [...board.waste].reverse(), waste: [], passes: board.passes + 1 };
  }

  const cards = [...board.cards];
  let waste = board.waste;
  for (const slot of move.second === undefined ? [move.first] : [move.first, move.second]) {
    if (slot.kind === "pyramid") cards[slot.index] = null;
    else waste = waste.slice(0, waste.length - 1);
  }
  return { ...board, cards, waste };
}

/** One board later, with the score read off it — the fold's step, and the solver's transition. */
function withBoard(state: PyramidState, board: PyramidBoard): PyramidState {
  return { ...state, board, score: pyramidCount(board) };
}

/** A pyramid card is exposed when neither card below it is still there. */
function isExposed(board: PyramidBoard, index: number): boolean {
  for (const below of PYRAMID_COVERS[index]!) {
    if (board.cards[below] !== null) return false;
  }
  return true;
}

function cardAt(board: PyramidBoard, slot: PyramidSlot): Card {
  if (slot.kind === "pyramid") {
    const held = board.cards[slot.index];
    if (held === undefined || held === null) {
      throw new CardGameError("A Pyramid slot in a move is not a card on the table.");
    }
    return held;
  }
  const held = board.waste[board.waste.length - 1];
  if (held === undefined) throw new CardGameError("A Pyramid move names a waste that is empty.");
  return held;
}

function pyramidCount(board: PyramidBoard): number {
  return board.cards.reduce((total, held) => (held === null ? total : total + 1), 0);
}

/** A card's two characters in a solver key: the suit's initial and the rank's code. */
function slotCode(card: Card): string {
  return `${card.suit[0]!}${card.rank.toString(36)}`;
}

/** One pair or one King matches the same way round. */
function sameMove(left: PyramidMove, right: PyramidMove): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "match" || right.kind !== "match") return true;
  if (left.second === undefined && right.second === undefined) {
    return sameSlot(left.first, right.first);
  }
  if (left.second === undefined || right.second === undefined) return false;
  return (
    (sameSlot(left.first, right.first) && sameSlot(left.second, right.second)) ||
    (sameSlot(left.first, right.second) && sameSlot(left.second, right.first))
  );
}

function sameSlot(left: PyramidSlot, right: PyramidSlot): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "pyramid" && right.kind === "pyramid") return left.index === right.index;
  return true;
}

function isPyramidSlot(value: unknown): value is PyramidSlot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; index?: unknown };
  if (candidate.kind === "waste") return true;
  if (candidate.kind !== "pyramid") return false;
  const { index } = candidate;
  return (
    typeof index === "number" &&
    Number.isSafeInteger(index) &&
    index >= 0 &&
    index < PYRAMID_CARDS
  );
}

