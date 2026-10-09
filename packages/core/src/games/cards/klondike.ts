/**
 * Klondike („Solitaire"), draw one or draw three, with unlimited redeals.
 *
 * **No Vegas mode.** The brief says so, and it is worth repeating here because
 * the whole difference between the two modes is where the score comes from:
 * Vegas charges for every card turned over and pays for every card sent home,
 * while the standard table below is a running total over the moves themselves.
 * This module implements the standard table and nothing else.
 *
 * **The score is a function of the log, never of a mutable counter.** Every
 * state is folded from the deal its own log names — the same fold builds the
 * board and the score, in the same pass — so `undo` is exact by construction
 * rather than by remembering to reverse a delta, and a state whose log is
 * inconsistent with its board cannot exist.
 *
 * **`initial` is why that is true.** The board the state was dealt (or, in a
 * test, the board a position is handed) is kept inside the state, so undo and
 * the score fold from the position the state actually started from rather than
 * from a re-deal of the seed. The seed remains the thing a SAVED game carries
 * (`replayKlondike` re-deals from it, which is what makes a save three fields
 * long: variant, seed, log), and the two agree because the deal is deterministic.
 */

import { autoplaySafe } from "./autoplay.js";
import { colourOf, standardDeck, SUITS, type Card, type Suit } from "./card.js";
import {
  CardGameError,
  IllegalMoveError,
  isCardGameVariant,
  isCardSeed,
  type CardGameRefusal,
  type CardGameReplay,
  type KlondikeVariant,
} from "./game.js";
import {
  isGameLogEntry,
  logCanUndo,
  logPushMove,
  logPushUndo,
  isUndoEntry,
  type GameLogEntry,
} from "./log.js";
import { createSeededRandom, shuffled } from "../random.js";

/** Seven columns, one more card each, the seventh's top card face up. */
export const KLONDIKE_COLUMNS = 7;

/**
 * The published Microsoft Windows Solitaire scoring table
 * (https://en.wikipedia.org/wiki/Klondike_(solitaire) § Scoring): waste to
 * tableau 5, waste to foundation 10, tableau to foundation 10, turn over a
 * tableau card 5, foundation to tableau −15, recycle the waste −100, and a
 * minimum of zero.
 *
 * Two entries in that table are worth naming here rather than leaving to the
 * reader. The recycle row: Wikipedia states the figure for playing by ONES, and
 * does not publish one for playing by threes, so this module charges −100 in
 * both variants and says so instead of inventing a second number. The undo row:
 * the published table does not price undo at all — it is a Solitaire-for-Windows
 * omission, and Vegas mode, which does price it, is not offered here — so −2 is
 * this app's own rule, written down so that „unlimited undo" is not a free
 * licence to search. Every other number in the object is the source's.
 */
export const KLONDIKE_SCORE = {
  wasteToTableau: 5,
  toFoundation: 10,
  turnFaceUp: 5,
  foundationToTableau: -15,
  recycle: -100,
  undo: -2,
} as const;

/** One tableau card: the card itself, and whether the player can see it. */
export interface KlondikeCard {
  readonly card: Card;
  readonly faceUp: boolean;
}

/**
 * The table. Every pile is read and written with its LAST element as its top, so
 * „the top n cards" is a suffix everywhere and no pile has its own direction.
 */
export interface KlondikeBoard {
  /** Seven columns, left to right; a face-down card may only be below every face-up one. */
  readonly tableau: readonly (readonly KlondikeCard[])[];
  /** One pile per suit, in `SUITS` order, each holding that suit's cards from the Ace up. */
  readonly foundations: readonly (readonly Card[])[];
  /** The face-down pile; the last card is the next one drawn. */
  readonly stock: readonly Card[];
  /** The face-up pile; the last card is the one a move can use. */
  readonly waste: readonly Card[];
}

/** Where a move takes cards from, or puts them. */
export type KlondikePile =
  | { readonly kind: "waste" }
  | { readonly kind: "tableau"; readonly column: number }
  | { readonly kind: "foundation"; readonly suit: Suit };

export type KlondikeMove =
  /** Turn one card (draw one) or three (draw three) from the stock onto the waste. */
  | { readonly kind: "draw" }
  /** Turn the waste face down into the stock again. Legal only with an empty stock — redeals are unlimited. */
  | { readonly kind: "recycle" }
  | {
      readonly kind: "move";
      readonly from: KlondikePile;
      readonly to: KlondikePile;
      /** How many cards, taken from the top of the source. Always 1 out of the waste or a foundation. */
      readonly count: number;
    };

export interface KlondikeState {
  readonly variant: KlondikeVariant;
  readonly seed: number;
  readonly initial: KlondikeBoard;
  readonly board: KlondikeBoard;
  /** Every action, in order — with undos among them. */
  readonly log: readonly GameLogEntry<KlondikeMove>[];
  readonly score: number;
}

export type KlondikeReplay = CardGameReplay<KlondikeState>;

/** One stack frame: the move, and the position and score it was played from. */
interface KlondikeFrame {
  readonly move: KlondikeMove;
  readonly board: KlondikeBoard;
  readonly score: number;
}

interface KlondikeFold {
  readonly board: KlondikeBoard;
  readonly score: number;
  readonly pending: readonly KlondikeFrame[];
}

/** Deals a fresh table. Throws for a variant or a seed nobody could have meant. */
export function dealKlondike(variant: KlondikeVariant, seed: number): KlondikeState {
  if (!isCardGameVariant("klondike", variant)) {
    throw new CardGameError(`"${variant}" is not a Klondike variant.`);
  }
  if (!isCardSeed(seed)) {
    throw new CardGameError(`A Klondike seed must be a 32-bit unsigned integer, got ${seed}.`);
  }
  const initial = dealtBoard(seed);
  return { variant, seed, initial, board: initial, log: [], score: 0 };
}

/** Rebuilds the state a saved `(variant, seed, log)` describes, or says why it cannot be one. */
export function replayKlondike(
  variant: KlondikeVariant,
  seed: number,
  log: unknown,
): KlondikeReplay {
  if (!isCardGameVariant("klondike", variant)) {
    return {
      ok: false,
      refusal: { code: "unknown-variant", atIndex: null, detail: `"${variant}" is not a Klondike variant.` },
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
  const folded = foldKlondike(variant, initial, log as readonly unknown[]);
  if (!folded.ok) return { ok: false, refusal: folded.refusal };
  return {
    ok: true,
    state: {
      variant,
      seed,
      initial,
      board: folded.fold.board,
      log: log as readonly GameLogEntry<KlondikeMove>[],
      score: folded.fold.score,
    },
  };
}

export function isKlondikeMove(value: unknown): value is KlondikeMove {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown };
  if (candidate.kind === "draw" || candidate.kind === "recycle") {
    return Object.keys(value).length === 1;
  }
  if (candidate.kind !== "move") return false;
  const { from, to, count } = value as { from?: unknown; to?: unknown; count?: unknown };
  return (
    isPile(from) &&
    isPile(to) &&
    to.kind !== "waste" &&
    typeof count === "number" &&
    Number.isSafeInteger(count) &&
    count >= 1
  );
}

export function isKlondikeEntry(value: unknown): value is GameLogEntry<KlondikeMove> {
  return isGameLogEntry(value, isKlondikeMove);
}

/** Every move the position allows, in a fixed order: the draw, then column by column, then the waste, then the foundations. */
export function klondikeMoves(state: KlondikeState): KlondikeMove[] {
  return movesOnBoard(state.board);
}

/**
 * Whether the position allows this move. Deliberately defined as membership in
 * `klondikeMoves`, the same enumeration `applyKlondike` folds through: one
 * statement of the rules means a move cannot be legal for the button and
 * illegal for the engine.
 */
export function isKlondikeMoveLegal(state: KlondikeState, move: KlondikeMove): boolean {
  return movesOnBoard(state.board).some((candidate) => sameMove(candidate, move));
}

export function applyKlondike(state: KlondikeState, move: KlondikeMove): KlondikeState {
  if (!isKlondikeMove(move)) {
    throw new IllegalMoveError(`Not a Klondike move: ${JSON.stringify(move)}.`);
  }
  const log = logPushMove(state.log, move);
  const folded = foldKlondike(state.variant, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log, score: folded.fold.score };
}

export function canUndoKlondike(state: KlondikeState): boolean {
  return logCanUndo(state.log);
}

/**
 * Takes back the last move. Unlimited: an undo is a log entry like any other, so
 * one may follow another, and undoing an undo puts the move back. The BOARD comes
 * back exactly as it was; the score does not, because the undo's own −2 is the
 * price of the rule rather than a change to the position.
 */
export function undoKlondike(state: KlondikeState): KlondikeState {
  if (!canUndoKlondike(state)) {
    throw new IllegalMoveError("Nothing left to undo in this deal.");
  }
  const log = logPushUndo(state.log);
  const folded = foldKlondike(state.variant, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log, score: folded.fold.score };
}

/**
 * The foundation moves that are safe to play without asking — see
 * `autoplaySafe` for the rule and its source. Ordered by rank, then by suit, then
 * by where the card sits, so the same position always offers the same first move.
 */
export function klondikeAutoMoves(state: KlondikeState): KlondikeMove[] {
  const board = state.board;
  const candidates: { move: KlondikeMove; card: Card; order: number }[] = [];
  board.tableau.forEach((pile, column) => {
    const top = pile[pile.length - 1];
    if (top === undefined || !top.faceUp) return;
    if (!canGoHome(board, top.card)) return;
    candidates.push({
      move: { kind: "move", from: { kind: "tableau", column }, to: { kind: "foundation", suit: top.card.suit }, count: 1 },
      card: top.card,
      order: column,
    });
  });
  const wasteTop = board.waste[board.waste.length - 1];
  if (wasteTop !== undefined && canGoHome(board, wasteTop)) {
    candidates.push({
      move: { kind: "move", from: { kind: "waste" }, to: { kind: "foundation", suit: wasteTop.suit }, count: 1 },
      card: wasteTop,
      order: board.tableau.length,
    });
  }
  return candidates
    .filter((candidate) => autoplaySafe(board.foundations, candidate.card))
    .sort(
      (left, right) =>
        left.card.rank - right.card.rank ||
        SUITS.indexOf(left.card.suit) - SUITS.indexOf(right.card.suit) ||
        left.order - right.order,
    )
    .map((candidate) => candidate.move);
}

/** Every card visible and the stock empty — the condition the auto-complete offer stands on. */
export function klondikeAllFaceUp(state: KlondikeState): boolean {
  return (
    state.board.stock.length === 0 &&
    state.board.tableau.every((pile) => pile.every((held) => held.faceUp))
  );
}

/** How many steps the greedy finisher may take before it gives up; a Klondike win is tens of moves, not hundreds. */
const AUTOCOMPLETE_MAX_STEPS = 400;

/**
 * The moves that finish a deal whose cards are all face up, or null.
 *
 * Greedy, and deliberately so — a solver is out of scope. Each step plays a safe
 * foundation move; when there is none, it plays the lowest exposed card that its
 * foundation needs; when there is none of those either, it looks for a tableau
 * move that uncovers such a card. A position that needs a deeper rearrangement
 * answers null rather than looping, and null is also the answer for a position
 * that is not all face up, which is the precondition the rule is stated with.
 */
export function klondikeAutoComplete(state: KlondikeState): KlondikeMove[] | null {
  if (!klondikeAllFaceUp(state)) return null;
  const moves: KlondikeMove[] = [];
  let current = state;
  for (let step = 0; step < AUTOCOMPLETE_MAX_STEPS; step += 1) {
    if (isKlondikeWon(current)) return moves;
    const automatic = klondikeAutoMoves(current)[0];
    if (automatic !== undefined) {
      current = applyKlondike(current, automatic);
      moves.push(automatic);
      continue;
    }
    const progress = progressMove(current);
    if (progress === null) return null;
    current = applyKlondike(current, progress);
    moves.push(progress);
  }
  return null;
}

export function isKlondikeWon(state: KlondikeState): boolean {
  return state.board.foundations.every((pile) => pile.length === 13);
}

/**
 * One step of the greedy finisher: the lowest card the foundations want right
 * now, wherever it is exposed; and when nothing can go home yet, a tableau move
 * that uncovers such a card. Null when neither exists, which is the finisher's
 * signal that the position needs more thought than a greedy walk.
 */
function progressMove(state: KlondikeState): KlondikeMove | null {
  const board = state.board;
  const ready: { move: KlondikeMove; rank: number; order: number }[] = [];
  board.tableau.forEach((pile, column) => {
    const top = pile[pile.length - 1];
    if (top === undefined || !top.faceUp || !canGoHome(board, top.card)) return;
    ready.push({
      move: {
        kind: "move",
        from: { kind: "tableau", column },
        to: { kind: "foundation", suit: top.card.suit },
        count: 1,
      },
      rank: top.card.rank,
      order: column,
    });
  });
  const wasteTop = board.waste[board.waste.length - 1];
  if (wasteTop !== undefined && canGoHome(board, wasteTop)) {
    ready.push({
      move: {
        kind: "move",
        from: { kind: "waste" },
        to: { kind: "foundation", suit: wasteTop.suit },
        count: 1,
      },
      rank: wasteTop.rank,
      order: board.tableau.length,
    });
  }
  if (ready.length > 0) {
    ready.sort((left, right) => left.rank - right.rank || left.order - right.order);
    return ready[0]!.move;
  }

  for (const move of movesOnBoard(board)) {
    if (move.kind !== "move" || move.from.kind !== "tableau" || move.to.kind !== "tableau") continue;
    const after = applyToBoard(state.variant, board, move);
    const pile = after.tableau[move.from.column]!;
    const exposed = pile[pile.length - 1];
    if (exposed !== undefined && exposed.faceUp && canGoHome(after, exposed.card)) return move;
  }
  return null;
}

/**
 * Whether ANY action is left. Cheap and exact — it answers „is there something
 * to do", not „can this deal still be won" (that would be a solver). A stock
 * that still holds a card is a move, because drawing is a move.
 */
export function hasKlondikeMoves(state: KlondikeState): boolean {
  return movesOnBoard(state.board).length > 0;
}

/**
 * One useful move, or null. The heuristic, in order: a safe foundation move; any
 * foundation move; a tableau move that turns a face-down card face up; a card
 * off the waste; a tableau move that empties a column; the draw; the recycle.
 * „Useful" means it either puts a card where it can never be needed again or
 * reveals one that has never been seen.
 */
export function klondikeHint(state: KlondikeState): KlondikeMove | null {
  const automatic = klondikeAutoMoves(state)[0];
  if (automatic !== undefined) return automatic;
  const moves = movesOnBoard(state.board);
  return (
    moves.find((move) => move.kind === "move" && move.to.kind === "foundation") ??
    moves.find(
      (move) =>
        move.kind === "move" &&
        move.from.kind === "tableau" &&
        move.to.kind === "tableau" &&
        exposesFaceDown(state.board, move),
    ) ??
    moves.find((move) => move.kind === "move" && move.from.kind === "waste") ??
    moves.find(
      (move) =>
        move.kind === "move" &&
        move.from.kind === "tableau" &&
        move.to.kind === "tableau" &&
        move.count === state.board.tableau[move.from.column]?.length,
    ) ??
    moves.find((move) => move.kind === "draw") ??
    moves.find((move) => move.kind === "recycle") ??
    null
  );
}

/** The shuffle-deal: twenty-eight cards across the columns, the rest face down in the stock. */
function dealtBoard(seed: number): KlondikeBoard {
  const deck = shuffled(standardDeck(), createSeededRandom(seed));
  const tableau: KlondikeCard[][] = [];
  let at = 0;
  for (let column = 0; column < KLONDIKE_COLUMNS; column += 1) {
    const pile: KlondikeCard[] = [];
    for (let depth = 0; depth <= column; depth += 1) {
      pile.push({ card: deck[at]!, faceUp: depth === column });
      at += 1;
    }
    tableau.push(pile);
  }
  // Reversed, because the last card of the stock is the next one turned over and
  // the deal's own order is „first card dealt is drawn first".
  return { tableau, foundations: SUITS.map(() => []), stock: deck.slice(at).reverse(), waste: [] };
}

/**
 * The one place a Klondike state is built: the log walked from `initial`, adding
 * the score each move is worth and remembering the frame each one was played
 * from. The same pass answers „what does this log describe" and „why can this log
 * not be one", which is why replay and apply cannot disagree.
 */
function foldKlondike(
  variant: KlondikeVariant,
  initial: KlondikeBoard,
  log: readonly unknown[],
): { ok: true; fold: KlondikeFold } | { ok: false; refusal: CardGameRefusal } {
  let board = initial;
  let score = 0;
  const pending: KlondikeFrame[] = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (!isKlondikeEntry(entry)) {
      return {
        ok: false,
        refusal: {
          code: "bad-entry",
          atIndex: index,
          detail: `Entry ${index} is neither a Klondike move nor an undo.`,
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
      score = clampScore(frame.score + KLONDIKE_SCORE.undo);
      continue;
    }
    if (!movesOnBoard(board).some((candidate) => sameMove(candidate, entry))) {
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
    score = clampScore(score + deltaFor(board, entry));
    board = applyToBoard(variant, board, entry);
  }
  return { ok: true, fold: { board, score, pending } };
}

function movesOnBoard(board: KlondikeBoard): KlondikeMove[] {
  const moves: KlondikeMove[] = [];
  if (board.stock.length > 0) moves.push({ kind: "draw" });
  else if (board.waste.length > 0) moves.push({ kind: "recycle" });

  for (let column = 0; column < board.tableau.length; column += 1) {
    const pile = board.tableau[column]!;
    const top = pile[pile.length - 1];
    if (top === undefined || !top.faceUp) continue;
    if (canGoHome(board, top.card)) {
      moves.push({
        kind: "move",
        from: { kind: "tableau", column },
        to: { kind: "foundation", suit: top.card.suit },
        count: 1,
      });
    }
    const run = faceUpRun(pile);
    for (let to = 0; to < board.tableau.length; to += 1) {
      if (to === column) continue;
      for (const count of landingsOn(board.tableau[to]!, pile, run)) {
        moves.push({
          kind: "move",
          from: { kind: "tableau", column },
          to: { kind: "tableau", column: to },
          count,
        });
      }
    }
  }

  const wasteTop = board.waste[board.waste.length - 1];
  if (wasteTop !== undefined) {
    if (canGoHome(board, wasteTop)) {
      moves.push({
        kind: "move",
        from: { kind: "waste" },
        to: { kind: "foundation", suit: wasteTop.suit },
        count: 1,
      });
    }
    for (let to = 0; to < board.tableau.length; to += 1) {
      if (canLand(board.tableau[to]!, wasteTop)) {
        moves.push({
          kind: "move",
          from: { kind: "waste" },
          to: { kind: "tableau", column: to },
          count: 1,
        });
      }
    }
  }

  for (const suit of SUITS) {
    const pile = board.foundations[SUITS.indexOf(suit)]!;
    const top = pile[pile.length - 1];
    if (top === undefined) continue;
    for (let to = 0; to < board.tableau.length; to += 1) {
      if (canLand(board.tableau[to]!, top)) {
        moves.push({
          kind: "move",
          from: { kind: "foundation", suit },
          to: { kind: "tableau", column: to },
          count: 1,
        });
      }
    }
  }

  return moves;
}

/**
 * How many cards of `pile`'s face-up run may land on `destination`. Any length
 * may go to an empty column; at most one may go elsewhere, because a run is
 * strictly descending — of every card in it, exactly one is the rank the
 * destination wants, and the enumeration stops at the first that fits.
 */
function landingsOn(
  destination: readonly KlondikeCard[],
  pile: readonly KlondikeCard[],
  run: number,
): number[] {
  const lengths: number[] = [];
  for (let count = 1; count <= run; count += 1) {
    const deepest = pile[pile.length - count];
    if (deepest === undefined) continue;
    if (destination.length === 0) {
      lengths.push(count);
      continue;
    }
    if (canLand(destination, deepest.card)) {
      lengths.push(count);
      break;
    }
  }
  return lengths;
}

/** A card can land where the top card is one rank higher in the other colour, or on an empty column. */
function canLand(destination: readonly KlondikeCard[], card: Card): boolean {
  const top = destination[destination.length - 1];
  if (top === undefined) return true;
  return top.card.rank === card.rank + 1 && colourOf(top.card.suit) !== colourOf(card.suit);
}

function canGoHome(board: KlondikeBoard, card: Card): boolean {
  return board.foundations[SUITS.indexOf(card.suit)]!.length === card.rank - 1;
}

/** How many cards at the top of a column are face up — the only cards a move may take. */
function faceUpRun(pile: readonly KlondikeCard[]): number {
  let run = 0;
  for (let index = pile.length - 1; index >= 0 && pile[index]!.faceUp; index -= 1) run += 1;
  return run;
}

/** What one move is worth, read off the position it is played from. */
function deltaFor(board: KlondikeBoard, move: KlondikeMove): number {
  if (move.kind === "draw") return 0;
  if (move.kind === "recycle") return KLONDIKE_SCORE.recycle;
  if (move.to.kind === "foundation") return KLONDIKE_SCORE.toFoundation;
  if (move.from.kind === "foundation") return KLONDIKE_SCORE.foundationToTableau;
  if (move.from.kind === "waste") return KLONDIKE_SCORE.wasteToTableau;
  return exposesFaceDown(board, move) ? KLONDIKE_SCORE.turnFaceUp : 0;
}

function exposesFaceDown(
  board: KlondikeBoard,
  move: KlondikeMove & { kind: "move" },
): boolean {
  const { from, count } = move;
  if (from.kind !== "tableau") return false;
  const pile = board.tableau[from.column];
  if (pile === undefined) return false;
  const exposed = pile[pile.length - count - 1];
  return exposed !== undefined && !exposed.faceUp;
}

function applyToBoard(
  variant: KlondikeVariant,
  board: KlondikeBoard,
  move: KlondikeMove,
): KlondikeBoard {
  if (move.kind === "draw") {
    // The stock's last card is its top, and the waste keeps the draw's order: the
    // last card turned over is the one on top.
    const taken = Math.min(variant === "draw3" ? 3 : 1, board.stock.length);
    return {
      ...board,
      stock: board.stock.slice(0, board.stock.length - taken),
      waste: [...board.waste, ...board.stock.slice(board.stock.length - taken)],
    };
  }
  if (move.kind === "recycle") {
    // Reversed: the first card turned over in the new pass is the first card of
    // the old one, which is what „unlimited redeals" promises the player.
    return { ...board, stock: [...board.waste].reverse(), waste: [] };
  }

  const { from, to, count } = move;
  const tableau = board.tableau.map((pile) => [...pile]);
  const foundations = board.foundations.map((pile) => [...pile]);
  let waste = [...board.waste];

  let carried: Card[];
  if (from.kind === "waste") {
    carried = waste.slice(-1);
    waste = waste.slice(0, -1);
  } else if (from.kind === "foundation") {
    const index = SUITS.indexOf(from.suit);
    const pile = foundations[index]!;
    carried = pile.slice(-1);
    foundations[index] = pile.slice(0, -1);
  } else {
    const pile = tableau[from.column]!;
    carried = pile.slice(-count).map((held) => held.card);
    tableau[from.column] = turnUp(pile.slice(0, pile.length - count));
  }

  if (to.kind === "tableau") {
    tableau[to.column] = [...tableau[to.column]!, ...carried.map((card) => ({ card, faceUp: true }))];
  } else if (to.kind === "foundation") {
    const index = SUITS.indexOf(to.suit);
    foundations[index] = [...foundations[index]!, ...carried];
  } else {
    // Unreachable: `isKlondikeMove` refuses a waste destination, which is the
    // shape rule this function relies on rather than re-checks.
    throw new CardGameError("A Klondike move cannot land on the waste pile.");
  }

  return { ...board, tableau, foundations, waste };
}

/** A card uncovered by a move is turned face up in the same move — the table never shows a face-down card above a face-up one. */
function turnUp(pile: KlondikeCard[]): KlondikeCard[] {
  const top = pile[pile.length - 1];
  if (top === undefined || top.faceUp) return pile;
  pile[pile.length - 1] = { card: top.card, faceUp: true };
  return pile;
}

/** The published table's own floor: the score never goes below zero. */
function clampScore(value: number): number {
  return Math.max(0, value);
}

function sameMove(left: KlondikeMove, right: KlondikeMove): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "move" || right.kind !== "move") return true;
  return (
    left.count === right.count &&
    samePile(left.from, right.from) &&
    samePile(left.to, right.to)
  );
}

function samePile(left: KlondikePile, right: KlondikePile): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "tableau" && right.kind === "tableau") return left.column === right.column;
  if (left.kind === "foundation" && right.kind === "foundation") return left.suit === right.suit;
  return left.kind !== "tableau" && left.kind !== "foundation";
}

function isPile(value: unknown): value is KlondikePile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; column?: unknown; suit?: unknown };
  if (candidate.kind === "waste") return true;
  if (candidate.kind === "tableau") {
    return typeof candidate.column === "number" && Number.isSafeInteger(candidate.column) && candidate.column >= 0;
  }
  if (candidate.kind === "foundation") return (SUITS as readonly unknown[]).includes(candidate.suit);
  return false;
}
