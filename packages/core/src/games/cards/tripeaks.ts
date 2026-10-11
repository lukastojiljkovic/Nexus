/**
 * TriPeaks: three pyramids and a row of ten, and one rule for the waste — the
 * exposed card of the tableau is played when it is one rank above or below the
 * card on the waste, whatever the suit.
 *
 * The layout and the rules are the article's
 * (https://en.wikipedia.org/wiki/Tri_Peaks_(game) § Gameplay): twenty-eight
 * tableau cards — a row of ten, then rows of nine, six and three — and
 * twenty-four stock cards of which the first starts the waste. A card covers the
 * one or two cards beneath it, so a pyramid's middle card is hidden by two
 * cards at once and its base card by two, which is the shape the three valleys
 * have. Cards are turned from the stock one at a time and only while nothing on
 * the tableau can be played, and the game is won when all twenty-eight tableau
 * cards are gone.
 *
 * `classic` is that game and `wrap` is the optional turning of the corner, King
 * on Ace and Ace on King, which the article lists as a variation.
 *
 * **The score is this app's own, and it says so.** The article describes the
 * original scoring as streak-based — the cost of the stock „is paid for from the
 * creation of the appropriate streaks" — and publishes no table for it, so there
 * is no number to copy and none is invented. What is written down here instead is
 * the shape the brief asks for: playing a tableau card is worth one more than the
 * card before it in the same run, a turn of the stock starts a new run, and a run
 * of k cards is therefore worth k(k+1)/2. Bigger is better, which is why
 * `CARD_GAME_SCORE_DIRECTION` calls TriPeaks a `higher` game. Clearing the peaks
 * is the win, score or no score.
 *
 * As in the engines beside it, a state is a pure function of its deal and its
 * log: a saved game is `(variant, seed, log)`.
 */

import { standardDeck, type Card } from "./card.js";
import {
  CardGameError,
  IllegalMoveError,
  isCardGameVariant,
  isCardSeed,
  type CardGameRefusal,
  type CardGameReplay,
  type TriPeaksVariant,
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

/** The 28 tableau cards, in row order: ten, nine, six, three. */
export const TRIPEAKS_TABLEAU = 28;
/** And the 24 the stock is dealt from; the first of them starts the waste. */
export const TRIPEAKS_STOCK = 24;

/**
 * Which slots each covering card hides, lower row first: the row of nine covers
 * the row of ten two cards at a time, the row of six covers three pyramids' base
 * rows, and the three caps cover the pairs beneath them. Read as the deal's own
 * geometry — each card is offset half a card from the row below it — and written
 * out because the covering relation is the whole of what „exposed" means.
 */
const TRIPEAKS_COVERS: readonly (readonly number[])[] = [
  [], [], [], [], [], [], [], [], [], [],
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [10, 11], [11, 12], [13, 14], [14, 15], [16, 17], [17, 18],
  [19, 20], [21, 22], [23, 24],
];

/**
 * The inverse: for each slot, the slots that must be gone before it is exposed.
 * Derived from {@link TRIPEAKS_COVERS} so the two can never disagree — a hand-kept
 * second table is a second table that can be wrong.
 */
const TRIPEAKS_COVERED_BY: readonly (readonly number[])[] = TRIPEAKS_COVERS.reduce<
  number[][]
>((covered, covers, index) => {
  for (const slot of covers) covered[slot]!.push(index);
  return covered;
}, Array.from({ length: TRIPEAKS_TABLEAU }, () => [] as number[]));

/** One tableau slot, or the waste — where a card may be played from or onto. */
export interface TriPeaksBoard {
  /** 28 slots in deal order; null is a card already played off the tableau. */
  readonly tableau: readonly (Card | null)[];
  /** The waste pile; its last card is the rank everything is played against. */
  readonly waste: readonly Card[];
  /** The face-down stock; the last card is the next one turned. */
  readonly stock: readonly Card[];
}

export type TriPeaksMove =
  /** Play an exposed tableau card onto the waste. */
  | { readonly kind: "play"; readonly slot: number }
  /** Turn the stock's next card onto the waste. Legal only when nothing on the tableau can be played. */
  | { readonly kind: "turn" };

export interface TriPeaksState {
  readonly variant: TriPeaksVariant;
  readonly seed: number;
  readonly initial: TriPeaksBoard;
  readonly board: TriPeaksBoard;
  readonly log: readonly GameLogEntry<TriPeaksMove>[];
  /** This app's streak score — see the file's header. Bigger is better. */
  readonly score: number;
  /** Cards played since the last turn of the stock; the next play is worth one more than this. */
  readonly streak: number;
}

export type TriPeaksReplay = CardGameReplay<TriPeaksState>;

interface TriPeaksFrame {
  readonly move: TriPeaksMove;
  readonly board: TriPeaksBoard;
  readonly score: number;
  readonly streak: number;
}

interface TriPeaksFold {
  readonly board: TriPeaksBoard;
  readonly score: number;
  readonly streak: number;
  readonly pending: readonly TriPeaksFrame[];
}

/** Deals a fresh table. Throws for a variant or a seed nobody could have meant. */
export function dealTriPeaks(variant: TriPeaksVariant, seed: number): TriPeaksState {
  if (!isCardGameVariant("tripeaks", variant)) {
    throw new CardGameError(`"${variant}" is not a TriPeaks variant.`);
  }
  if (!isCardSeed(seed)) {
    throw new CardGameError(`A TriPeaks seed must be a 32-bit unsigned integer, got ${seed}.`);
  }
  const initial = dealtBoard(seed);
  return { variant, seed, initial, board: initial, log: [], score: 0, streak: 0 };
}

/** Rebuilds the state a saved `(variant, seed, log)` describes, or says why it cannot be one. */
export function replayTriPeaks(variant: TriPeaksVariant, seed: number, log: unknown): TriPeaksReplay {
  if (!isCardGameVariant("tripeaks", variant)) {
    return {
      ok: false,
      refusal: {
        code: "unknown-variant",
        atIndex: null,
        detail: `"${variant}" is not a TriPeaks variant.`,
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
  const folded = foldTriPeaks(variant, initial, log as readonly unknown[]);
  if (!folded.ok) return { ok: false, refusal: folded.refusal };
  return {
    ok: true,
    state: {
      variant,
      seed,
      initial,
      board: folded.fold.board,
      log: log as readonly GameLogEntry<TriPeaksMove>[],
      score: folded.fold.score,
      streak: folded.fold.streak,
    },
  };
}

export function isTriPeaksMove(value: unknown): value is TriPeaksMove {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; slot?: unknown };
  if (candidate.kind === "turn") return Object.keys(value).length === 1;
  return candidate.kind === "play" && isSlotIndex(candidate.slot);
}

export function isTriPeaksEntry(value: unknown): value is GameLogEntry<TriPeaksMove> {
  return isGameLogEntry(value, isTriPeaksMove);
}

/**
 * Every move the position allows: a play for each exposed card that touches the
 * waste, and a TURN only when no such card exists — the article's „as long as it
 * does not begin a new sequence", which makes a turn beside an available play
 * illegal rather than merely unwise.
 *
 * A cleared tableau has NO moves, not a turn: the article says the game „is won
 * if all three peaks are cleared before or after the last card from the stock is
 * discarded", so a cleared tableau ends the game however much stock is left, and
 * offering a turn there would let a player go on turning cards over after winning.
 */
export function triPeaksMoves(state: TriPeaksState): TriPeaksMove[] {
  return isTriPeaksWon(state) ? [] : movesOnBoard(state.variant, state.board);
}

export function isTriPeaksMoveLegal(state: TriPeaksState, move: TriPeaksMove): boolean {
  return triPeaksMoves(state).some((candidate) => sameMove(candidate, move));
}

export function applyTriPeaks(state: TriPeaksState, move: TriPeaksMove): TriPeaksState {
  if (!isTriPeaksMove(move)) {
    throw new IllegalMoveError(`Not a TriPeaks move: ${JSON.stringify(move)}.`);
  }
  const log = logPushMove(state.log, move);
  const folded = foldTriPeaks(state.variant, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return {
    ...state,
    board: folded.fold.board,
    log,
    score: folded.fold.score,
    streak: folded.fold.streak,
  };
}

export function canUndoTriPeaks(state: TriPeaksState): boolean {
  return logCanUndo(state.log);
}

/** Takes back the last move — a turn, a play and the streak it was part of, all at once. */
export function undoTriPeaks(state: TriPeaksState): TriPeaksState {
  if (!canUndoTriPeaks(state)) {
    throw new IllegalMoveError("Nothing left to undo in this deal.");
  }
  const log = logPushUndo(state.log);
  const folded = foldTriPeaks(state.variant, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return {
    ...state,
    board: folded.fold.board,
    log,
    score: folded.fold.score,
    streak: folded.fold.streak,
  };
}

/** Every tableau card gone — the article's win, whatever the score says. */
export function isTriPeaksWon(state: TriPeaksState): boolean {
  return state.board.tableau.every((held) => held === null);
}

/** Whether any action is left — false exactly when the game is over, won or stuck. */
export function hasTriPeaksMoves(state: TriPeaksState): boolean {
  return triPeaksMoves(state).length > 0;
}

/** The deal: ten, nine, six and three cards to the rows, the first stock card to the waste. */
function dealtBoard(seed: number): TriPeaksBoard {
  const deck = shuffled(standardDeck(), createSeededRandom(seed));
  const tableau = deck.slice(0, TRIPEAKS_TABLEAU);
  const waste = deck[TRIPEAKS_TABLEAU]!;
  // Reversed, because the last card of the stock is the next one turned over and
  // the deal's own order is „first card dealt is turned first".
  return { tableau, waste: [waste], stock: deck.slice(TRIPEAKS_TABLEAU + 1).reverse() };
}

/**
 * The one place a TriPeaks state is built: the log walked from `initial`, adding
 * the streak score each play is worth. A turn scores nothing and starts a new
 * run, which is the whole of what the score's own rule says.
 */
function foldTriPeaks(
  variant: TriPeaksVariant,
  initial: TriPeaksBoard,
  log: readonly unknown[],
): { ok: true; fold: TriPeaksFold } | { ok: false; refusal: CardGameRefusal } {
  let board = initial;
  let score = 0;
  let streak = 0;
  const pending: TriPeaksFrame[] = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (!isTriPeaksEntry(entry)) {
      return {
        ok: false,
        refusal: {
          code: "bad-entry",
          atIndex: index,
          detail: `Entry ${index} is neither a TriPeaks move nor an undo.`,
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
      streak = frame.streak;
      continue;
    }
    const played = board.tableau.some((held) => held !== null);
    const legal =
      played && movesOnBoard(variant, board).some((candidate) => sameMove(candidate, entry));
    if (!legal) {
      return {
        ok: false,
        refusal: {
          code: "illegal-move",
          atIndex: index,
          detail: `Entry ${index} is not legal in the position it was played from.`,
        },
      };
    }
    pending.push({ move: entry, board, score, streak });
    if (entry.kind === "turn") {
      board = stepBoard(board, entry);
      streak = 0;
      continue;
    }
    streak += 1;
    score += streak;
    board = stepBoard(board, entry);
  }
  return { ok: true, fold: { board, score, streak, pending } };
}

function movesOnBoard(variant: TriPeaksVariant, board: TriPeaksBoard): TriPeaksMove[] {
  const top = board.waste[board.waste.length - 1];
  const plays: TriPeaksMove[] = [];
  if (top !== undefined) {
    board.tableau.forEach((held, slot) => {
      if (held === null || !isExposed(board, slot)) return;
      if (touches(top, held, variant)) plays.push({ kind: "play", slot });
    });
  }
  if (plays.length > 0) return plays;
  return board.stock.length > 0 ? [{ kind: "turn" }] : [];
}

function stepBoard(board: TriPeaksBoard, move: TriPeaksMove): TriPeaksBoard {
  if (move.kind === "turn") {
    const next = board.stock[board.stock.length - 1]!;
    return {
      ...board,
      waste: [...board.waste, next],
      stock: board.stock.slice(0, board.stock.length - 1),
    };
  }
  const tableau = [...board.tableau];
  const card = tableau[move.slot]!;
  tableau[move.slot] = null;
  return { ...board, tableau, waste: [...board.waste, card] };
}

/** A slot is exposed when every card that covers it has already been played off. */
function isExposed(board: TriPeaksBoard, slot: number): boolean {
  return TRIPEAKS_COVERED_BY[slot]!.every((above) => board.tableau[above] === null);
}

/** One rank away, or — in the wrap variant only — a King on an Ace or an Ace on a King. */
function touches(top: Card, card: Card, variant: TriPeaksVariant): boolean {
  const gap = Math.abs(top.rank - card.rank);
  return gap === 1 || (variant === "wrap" && gap === 12);
}

function sameMove(left: TriPeaksMove, right: TriPeaksMove): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "play" && right.kind === "play") return left.slot === right.slot;
  return left.kind === right.kind;
}

function isSlotIndex(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value < TRIPEAKS_TABLEAU
  );
}
