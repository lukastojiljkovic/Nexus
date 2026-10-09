/**
 * Spider: ten columns, two decks, and one, two or four suits.
 *
 * The rules this module implements, from
 * https://en.wikipedia.org/wiki/Spider_(solitaire) § Rules: 54 cards are dealt
 * face down in ten piles — six in the first four, five in the other six — with
 * only the top card face up, and the 50 remaining cards are dealt ten at a time
 * WHEN NO PILE IS EMPTY. Piles build down by rank with no attention to suit, and
 * an in-suit sequence can be moved as one.
 *
 * **A completed King-to-Ace run of one suit is removed, and collecting it is a
 * MOVE rather than a side effect.** The rules remove it the moment it is
 * complete, so the engine refuses every other action while a run waits (see
 * `spiderMoves`) — that makes the collection unskippable without hiding it from
 * the log, which is what lets a saved game replay to the same position and lets
 * the page animate the run leaving the table. `spiderAutoMoves` is the list of
 * those collections, and it is what a caller plays without asking.
 *
 * **The score is the published Windows one**: start at 500, one point off for
 * each move, an undo counted as a move, and 100 on for each in-suit stack
 * completed (https://en.wikipedia.org/wiki/Spider_(solitaire) § Scoring). A
 * collection is not a player's move in the classic game, so it costs nothing;
 * it only pays.
 */

import { deckOf, SUITS, type Card, type Suit } from "./card.js";
import {
  CardGameError,
  IllegalMoveError,
  isCardGameVariant,
  isCardSeed,
  type CardGameRefusal,
  type CardGameReplay,
  type SpiderVariant,
} from "./game.js";
import {
  isGameLogEntry,
  isUndoEntry,
  logCanUndo,
  logPushMove,
  logPushUndo,
  type GameLogEntry,
} from "./log.js";
import { createSeededRandom, shuffle } from "./shuffle.js";

export const SPIDER_COLUMNS = 10;
/** Eight completed runs win: two decks hold eight Kings, and one run takes one of them. */
export const SPIDER_FOUNDATIONS = 8;
/** King down to Ace. */
export const SPIDER_RUN = 13;
/** The cards dealt to the tableau before the stock; the rest is the stock. */
const TABLEAU_CARDS = 54;

/**
 * Which suits the three variants use. One suit is Spades because the classic
 * one-suit game is Spades; two suits are Spades and Hearts, the pair the classic
 * two-suit game uses — one black and one red, so a run of either is readable.
 */
export const SPIDER_SUITS: Readonly<Record<SpiderVariant, readonly Suit[]>> = {
  suits1: ["spades"],
  suits2: ["spades", "hearts"],
  suits4: SUITS,
};

/**
 * The published Windows Spider scoring: 500 to start, −1 per move (an undo
 * counts as a move), +100 per completed in-suit stack.
 * https://en.wikipedia.org/wiki/Spider_(solitaire) § Scoring
 */
export const SPIDER_SCORE = {
  start: 500,
  perAction: -1,
  perRun: 100,
} as const;

/** One tableau card: the card, and whether its face is showing. */
export interface SpiderCard {
  readonly card: Card;
  readonly faceUp: boolean;
}

export interface SpiderBoard {
  /** Ten columns; the last card of a column is its top. */
  readonly columns: readonly (readonly SpiderCard[])[];
  /** The face-down stock, dealt ten at a time; the last card is the next one dealt. */
  readonly stock: readonly Card[];
  /** The completed runs, in the order they were collected — each a King-to-Ace run of that suit. */
  readonly runs: readonly Suit[];
}

export type SpiderMove =
  /** Deal one card face up to every column. Legal only when no column is empty and the stock can pay. */
  | { readonly kind: "deal" }
  | {
      readonly kind: "move";
      readonly from: number;
      /** How many cards, taken from the top of the source. They must be one suit, descending. */
      readonly count: number;
      readonly to: number;
    }
  /** Take a completed King-to-Ace run off the table. */
  | { readonly kind: "collect"; readonly column: number };

export interface SpiderState {
  readonly variant: SpiderVariant;
  readonly seed: number;
  readonly initial: SpiderBoard;
  readonly board: SpiderBoard;
  readonly log: readonly GameLogEntry<SpiderMove>[];
  readonly score: number;
}

export type SpiderReplay = CardGameReplay<SpiderState>;

interface SpiderFrame {
  readonly move: SpiderMove;
  readonly board: SpiderBoard;
  readonly score: number;
}

interface SpiderFold {
  readonly board: SpiderBoard;
  readonly score: number;
  readonly pending: readonly SpiderFrame[];
}

export function dealSpider(variant: SpiderVariant, seed: number): SpiderState {
  if (!isCardGameVariant("spider", variant)) {
    throw new CardGameError(`"${variant}" is not a Spider variant.`);
  }
  if (!isCardSeed(seed)) {
    throw new CardGameError(`A Spider seed must be a 32-bit unsigned integer, got ${seed}.`);
  }
  const initial = dealtBoard(variant, seed);
  return { variant, seed, initial, board: initial, log: [], score: SPIDER_SCORE.start };
}

export function replaySpider(
  variant: SpiderVariant,
  seed: number,
  log: unknown,
): SpiderReplay {
  if (!isCardGameVariant("spider", variant)) {
    return {
      ok: false,
      refusal: {
        code: "unknown-variant",
        atIndex: null,
        detail: `"${variant}" is not a Spider variant.`,
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
  const initial = dealtBoard(variant, seed);
  const folded = foldSpider(initial, log as readonly unknown[]);
  if (!folded.ok) return { ok: false, refusal: folded.refusal };
  return {
    ok: true,
    state: {
      variant,
      seed,
      initial,
      board: folded.fold.board,
      log: log as readonly GameLogEntry<SpiderMove>[],
      score: folded.fold.score,
    },
  };
}

export function isSpiderMove(value: unknown): value is SpiderMove {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown };
  if (candidate.kind === "deal") return Object.keys(value).length === 1;
  if (candidate.kind === "collect") {
    const { column } = value as { column?: unknown };
    return isColumnIndex(column) && Object.keys(value).length === 2;
  }
  if (candidate.kind !== "move") return false;
  const { from, to, count } = value as { from?: unknown; to?: unknown; count?: unknown };
  return (
    isColumnIndex(from) &&
    isColumnIndex(to) &&
    typeof count === "number" &&
    Number.isSafeInteger(count) &&
    count >= 1
  );
}

export function isSpiderEntry(value: unknown): value is GameLogEntry<SpiderMove> {
  return isGameLogEntry(value, isSpiderMove);
}

/**
 * Every move the position allows. A pending collection is the WHOLE answer while
 * one waits — the rules remove a finished run, so nothing else may happen first.
 * Otherwise: every length of every same-suit run onto every column that takes it,
 * and the deal when the stock can pay and no column is empty.
 */
export function spiderMoves(state: SpiderState): SpiderMove[] {
  return movesOnBoard(state.board);
}

export function isSpiderMoveLegal(state: SpiderState, move: SpiderMove): boolean {
  return movesOnBoard(state.board).some((candidate) => sameMove(candidate, move));
}

export function applySpider(state: SpiderState, move: SpiderMove): SpiderState {
  if (!isSpiderMove(move)) {
    throw new IllegalMoveError(`Not a Spider move: ${JSON.stringify(move)}.`);
  }
  const log = logPushMove(state.log, move);
  const folded = foldSpider(state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log, score: folded.fold.score };
}

export function canUndoSpider(state: SpiderState): boolean {
  return logCanUndo(state.log);
}

export function undoSpider(state: SpiderState): SpiderState {
  if (!canUndoSpider(state)) {
    throw new IllegalMoveError("Nothing left to undo in this deal.");
  }
  const log = logPushUndo(state.log);
  const folded = foldSpider(state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log, score: folded.fold.score };
}

/** The completed runs waiting to be taken off the table, in column order — what a caller plays without asking. */
export function spiderAutoMoves(state: SpiderState): SpiderMove[] {
  return collectionsOnBoard(state.board);
}

/** How many rows the stock can still deal: one row is ten cards. */
export function spiderDealCount(state: SpiderState): number {
  return Math.floor(state.board.stock.length / SPIDER_COLUMNS);
}

export function isSpiderWon(state: SpiderState): boolean {
  return state.board.runs.length === SPIDER_FOUNDATIONS;
}

/** Whether any action is left — the same cheap, exact question the other two games answer. */
export function hasSpiderMoves(state: SpiderState): boolean {
  return movesOnBoard(state.board).length > 0;
}

/**
 * One useful move, or null. The heuristic, in order: collect a finished run; turn
 * a face-down card face up; extend a same-suit run; empty a column when the stock
 * is ALREADY empty (nothing is left to block); any move that keeps its column
 * non-empty; empty a column anyway; deal. The order encodes the one trap this
 * game has: an empty column stops the stock from dealing, so emptying one while
 * cards remain in the stock is a cost, not a gain.
 */
export function spiderHint(state: SpiderState): SpiderMove | null {
  const moves = movesOnBoard(state.board);
  const pending = moves.filter((move) => move.kind === "collect");
  if (pending.length > 0) return pending[0]!;

  const tableau = moves.filter((move) => move.kind === "move");
  const reveals = tableau.find((move) => revealsFaceDown(state.board, move));
  if (reveals !== undefined) return reveals;

  const extendsRun = tableau.find((move) => {
    if (move.kind !== "move") return false;
    const destination = state.board.columns[move.to]!;
    const top = destination[destination.length - 1];
    const carried = state.board.columns[move.from]!;
    const deepest = carried[carried.length - move.count];
    return top !== undefined && deepest !== undefined && top.card.suit === deepest.card.suit;
  });
  if (extendsRun !== undefined) return extendsRun;

  const empties = (move: SpiderMove): boolean =>
    move.kind === "move" &&
    move.count === (state.board.columns[move.from]?.length ?? 0);
  const stockEmpty = state.board.stock.length === 0;
  const keepsColumn = tableau.find((move) => !empties(move));
  if (stockEmpty && tableau.some(empties)) return tableau.find(empties)!;
  if (keepsColumn !== undefined) return keepsColumn;
  const emptier = tableau.find(empties);
  if (emptier !== undefined) return emptier;
  return moves.find((move) => move.kind === "deal") ?? null;
}

/**
 * The deal: two decks of the variant's suits shuffled by the seeded generator,
 * dealt column by column — six cards to the first four columns, five to the other
 * six — with only each column's last card face up, and the remaining fifty in the
 * stock with its top last.
 */
function dealtBoard(variant: SpiderVariant, seed: number): SpiderBoard {
  // One hundred and four cards whatever the variant: each rank appears eight
  // times, spread over the suits the variant plays (see the file's header).
  const suits = SPIDER_SUITS[variant];
  const deck = shuffle(deckOf(suits, SPIDER_FOUNDATIONS / suits.length), createSeededRandom(seed));
  const columns: SpiderCard[][] = [];
  let at = 0;
  for (let column = 0; column < SPIDER_COLUMNS; column += 1) {
    const size = column < 4 ? 6 : 5;
    const pile: SpiderCard[] = [];
    for (let depth = 0; depth < size; depth += 1) {
      pile.push({ card: deck[at]!, faceUp: depth === size - 1 });
      at += 1;
    }
    columns.push(pile);
  }
  // Reversed so that the last card of the stock is the next one dealt, and the
  // fifty cards after the tableau are exactly the ones the deck had left.
  return { columns, stock: deck.slice(at, at + (104 - TABLEAU_CARDS)).reverse(), runs: [] };
}

function foldSpider(
  initial: SpiderBoard,
  log: readonly unknown[],
): { ok: true; fold: SpiderFold } | { ok: false; refusal: CardGameRefusal } {
  let board = initial;
  let score = SPIDER_SCORE.start;
  const pending: SpiderFrame[] = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (!isSpiderEntry(entry)) {
      return {
        ok: false,
        refusal: {
          code: "bad-entry",
          atIndex: index,
          detail: `Entry ${index} is neither a Spider move nor an undo.`,
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
      // The undone move keeps its own point — the published table charges the
      // undo as a move, it does not refund the one being taken back.
      score += SPIDER_SCORE.perAction;
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
    score += deltaFor(entry);
    board = applyToBoard(board, entry);
  }
  return { ok: true, fold: { board, score, pending } };
}

function movesOnBoard(board: SpiderBoard): SpiderMove[] {
  const pending = collectionsOnBoard(board);
  if (pending.length > 0) return pending;

  const moves: SpiderMove[] = [];
  board.columns.forEach((pile, from) => {
    const top = pile[pile.length - 1];
    if (top === undefined || !top.faceUp) return;
    const run = sameSuitRun(pile);
    for (let count = 1; count <= run; count += 1) {
      const deepest = pile[pile.length - count];
      if (deepest === undefined) break;
      board.columns.forEach((destination, to) => {
        if (to === from) return;
        if (canLand(destination, deepest.card)) {
          moves.push({ kind: "move", from, count, to });
        }
      });
    }
  });

  const dealable =
    board.stock.length >= SPIDER_COLUMNS && board.columns.every((pile) => pile.length > 0);
  if (dealable) moves.push({ kind: "deal" });
  return moves;
}

/** The columns whose top thirteen cards are a King-to-Ace run of one suit. */
function collectionsOnBoard(board: SpiderBoard): SpiderMove[] {
  const collections: SpiderMove[] = [];
  board.columns.forEach((pile, column) => {
    if (isCompleteRun(pile)) collections.push({ kind: "collect", column });
  });
  return collections;
}

function isCompleteRun(pile: readonly SpiderCard[]): boolean {
  if (pile.length < SPIDER_RUN) return false;
  const top = pile[pile.length - 1]!;
  const suit = top.card.suit;
  for (let step = 0; step < SPIDER_RUN; step += 1) {
    const held = pile[pile.length - 1 - step]!;
    // The Ace is the top of the run and the King the bottom, so the rank at
    // `step` cards down from the top is one more than `step`.
    if (!held.faceUp || held.card.suit !== suit || held.card.rank !== step + 1) {
      return false;
    }
  }
  return true;
}

/** The longest run at the top of a column that is one suit, descending by one. */
function sameSuitRun(pile: readonly SpiderCard[]): number {
  let run = 0;
  for (let index = pile.length - 1; index >= 0; index -= 1) {
    const held = pile[index]!;
    if (!held.faceUp) break;
    const above = pile[index + 1];
    if (above === undefined) {
      run = 1;
      continue;
    }
    if (held.card.suit !== above.card.suit || held.card.rank !== above.card.rank + 1) break;
    run += 1;
  }
  return run;
}

/** Any suit may land on the next rank up; an empty column takes anything. */
function canLand(destination: readonly SpiderCard[], card: Card): boolean {
  const top = destination[destination.length - 1];
  if (top === undefined) return true;
  return top.card.rank === card.rank + 1;
}

function deltaFor(move: SpiderMove): number {
  return move.kind === "collect" ? SPIDER_SCORE.perRun : SPIDER_SCORE.perAction;
}

function applyToBoard(board: SpiderBoard, move: SpiderMove): SpiderBoard {
  if (move.kind === "deal") {
    const row = board.stock.slice(-SPIDER_COLUMNS);
    const columns = board.columns.map((pile, index) => {
      const held = row[index];
      return held === undefined ? [...pile] : [...pile, { card: held, faceUp: true }];
    });
    return { ...board, columns, stock: board.stock.slice(0, board.stock.length - row.length) };
  }

  if (move.kind === "collect") {
    const columns = board.columns.map((pile) => [...pile]);
    const pile = columns[move.column]!;
    const held = pile[pile.length - 1]!;
    columns[move.column] = turnUp(pile.slice(0, pile.length - SPIDER_RUN));
    return { ...board, columns, runs: [...board.runs, held.card.suit] };
  }

  const columns = board.columns.map((pile) => [...pile]);
  const source = columns[move.from]!;
  const carried = source.slice(source.length - move.count);
  columns[move.from] = turnUp(source.slice(0, source.length - move.count));
  columns[move.to] = [...columns[move.to]!, ...carried];
  return { ...board, columns };
}

/** A card uncovered by a move or a collection is turned face up in the same action. */
function turnUp(pile: SpiderCard[]): SpiderCard[] {
  const top = pile[pile.length - 1];
  if (top === undefined || top.faceUp) return pile;
  pile[pile.length - 1] = { card: top.card, faceUp: true };
  return pile;
}

function revealsFaceDown(board: SpiderBoard, move: SpiderMove): boolean {
  if (move.kind !== "move") return false;
  const pile = board.columns[move.from];
  if (pile === undefined) return false;
  const exposed = pile[pile.length - move.count - 1];
  return exposed !== undefined && !exposed.faceUp;
}

function sameMove(left: SpiderMove, right: SpiderMove): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "deal" || right.kind === "deal") return left.kind === right.kind;
  if (left.kind === "collect" && right.kind === "collect") return left.column === right.column;
  if (left.kind === "move" && right.kind === "move") {
    return left.from === right.from && left.to === right.to && left.count === right.count;
  }
  return false;
}

function isColumnIndex(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value < SPIDER_COLUMNS
  );
}
