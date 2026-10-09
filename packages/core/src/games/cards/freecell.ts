/**
 * FreeCell: four free cells, eight columns, four foundations, and the Microsoft
 * deal numbering.
 *
 * **The deal is the published one, and it is the whole point of the game
 * number.** Jim Horne's algorithm, as described on Rosetta Code
 * (https://rosettacode.org/wiki/Deal_cards_for_FreeCell, which also publishes the
 * layouts of deals #1 and #617 that `freecell.test.ts` asserts): seed Microsoft
 * C's linear congruential generator with the deal number,
 * `state ← (214013 × state + 2531011) mod 2^31`, take `state ÷ 2^16`, and use it
 * modulo the number of cards left to pick a card to swap with the last one. That
 * is a BIASED shuffle by modern standards — the modulus is not uniform — and it
 * is reproduced exactly anyway, because „game #1" is a layout players know by
 * name and a faithful-looking deal would be a different game under the same
 * number. The general shuffle (`shuffle.ts`) is the unbiased one and is used by
 * Klondike and Spider, which have no published deals to be faithful to.
 *
 * The deal numbers are the classic 1…32 000. Microsoft's later 1 000 000 numbering
 * is deliberately NOT accepted: this app does not claim to reproduce those deals,
 * and quietly answering a number outside the range with an invented layout would
 * be worse than refusing it.
 */

import { autoplaySafeCards } from "./autoplay.js";
import { colourOf, RANKS, SUITS, type Card, type Suit } from "./card.js";
import {
  CardGameError,
  IllegalMoveError,
  FREE_CELL_MAX_DEAL,
  FREE_CELL_MIN_DEAL,
  isFreeCellDeal,
  type CardGameRefusal,
  type CardGameReplay,
} from "./game.js";
import {
  isGameLogEntry,
  isUndoEntry,
  logCanUndo,
  logPushMove,
  logPushUndo,
  type GameLogEntry,
} from "./log.js";

export const FREE_CELL_COUNT = 4;
export const FREE_CELL_COLUMNS = 8;

const FULL_FOUNDATION = 13;

/**
 * This app's own scoring, and it says so because the classic game has none:
 * Microsoft FreeCell keeps no score at all, so `best score` in the store needs a
 * table from somewhere and the honest place to put one is beside the game that
 * uses it. Ten for a card sent home, ten back for a card that leaves again (the
 * move is legal in FreeCell and must not be a way to farm points), and −2 for an
 * undo — the same house rule Klondike states, for the same reason: unlimited
 * undo should not be a free search.
 */
export const FREE_CELL_SCORE = {
  toFoundation: 10,
  fromFoundation: -10,
  undo: -2,
} as const;

/**
 * The table. Columns and foundations are read and written with their LAST
 * element as the top, and a free cell holds one card or nothing.
 */
export interface FreeCellBoard {
  /** Eight columns; every card is face up, and the last is a column's top. */
  readonly columns: readonly (readonly Card[])[];
  /** Four cells, in order; null is an empty cell. */
  readonly cells: readonly (Card | null)[];
  /** One pile per suit, in `SUITS` order, each holding that suit's cards from the Ace up. */
  readonly foundations: readonly (readonly Card[])[];
}

/** Where a move takes cards from, or puts them. */
export type FreeCellSlot =
  | { readonly kind: "column"; readonly column: number }
  | { readonly kind: "cell"; readonly cell: number }
  | { readonly kind: "foundation"; readonly suit: Suit };

export type FreeCellMove = {
  readonly kind: "move";
  readonly from: FreeCellSlot;
  /** The number of cards, taken from the top of the source. Only a column can give more than one. */
  readonly count: number;
  readonly to: FreeCellSlot;
};

export interface FreeCellState {
  /** The deal number — „game #617" — which is also what re-deals this table. */
  readonly seed: number;
  readonly initial: FreeCellBoard;
  readonly board: FreeCellBoard;
  readonly log: readonly GameLogEntry<FreeCellMove>[];
  readonly score: number;
}

export type FreeCellReplay = CardGameReplay<FreeCellState>;

interface FreeCellFrame {
  readonly move: FreeCellMove;
  readonly board: FreeCellBoard;
  readonly score: number;
}

interface FreeCellFold {
  readonly board: FreeCellBoard;
  readonly score: number;
  readonly pending: readonly FreeCellFrame[];
}

/** Deals the numbered game. Throws for a number the classic set does not carry. */
export function dealFreeCell(seed: number): FreeCellState {
  if (!isFreeCellDeal(seed)) {
    throw new CardGameError(
      `A FreeCell deal number must be a whole number in ${FREE_CELL_MIN_DEAL}…${FREE_CELL_MAX_DEAL}, got ${seed}.`,
    );
  }
  const initial = dealtBoard(seed);
  return { seed, initial, board: initial, log: [], score: 0 };
}

/** Rebuilds the state a saved `(deal number, log)` describes, or says why it cannot be one. */
export function replayFreeCell(seed: number, log: unknown): FreeCellReplay {
  if (!isFreeCellDeal(seed)) {
    return {
      ok: false,
      refusal: {
        code: "bad-seed",
        atIndex: null,
        detail: `${seed} is not a FreeCell deal number in ${FREE_CELL_MIN_DEAL}…${FREE_CELL_MAX_DEAL}.`,
      },
    };
  }
  if (!Array.isArray(log)) {
    return {
      ok: false,
      refusal: { code: "bad-entry", atIndex: null, detail: "The move list is not a list." },
    };
  }
  const initial = dealtBoard(seed);
  const folded = foldFreeCell(initial, log as readonly unknown[]);
  if (!folded.ok) return { ok: false, refusal: folded.refusal };
  return {
    ok: true,
    state: {
      seed,
      initial,
      board: folded.fold.board,
      log: log as readonly GameLogEntry<FreeCellMove>[],
      score: folded.fold.score,
    },
  };
}

export function isFreeCellMove(value: unknown): value is FreeCellMove {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; from?: unknown; to?: unknown; count?: unknown };
  if (candidate.kind !== "move") return false;
  const { from, to, count } = candidate;
  return (
    isSlot(from) &&
    isSlot(to) &&
    typeof count === "number" &&
    Number.isSafeInteger(count) &&
    count >= 1
  );
}

export function isFreeCellEntry(value: unknown): value is GameLogEntry<FreeCellMove> {
  return isGameLogEntry(value, isFreeCellMove);
}

/**
 * Every move the position allows, in a fixed order: cells onto foundations, cells
 * onto columns, columns onto foundations, columns onto columns (shortest run
 * first), columns into cells, and foundations back onto columns. Defined by
 * enumeration and nothing else, so „legal" and „offered" cannot disagree.
 */
export function freeCellMoves(state: FreeCellState): FreeCellMove[] {
  return movesOnBoard(state.board);
}

export function isFreeCellMoveLegal(state: FreeCellState, move: FreeCellMove): boolean {
  return movesOnBoard(state.board).some((candidate) => sameMove(candidate, move));
}

export function applyFreeCell(state: FreeCellState, move: FreeCellMove): FreeCellState {
  if (!isFreeCellMove(move)) {
    throw new IllegalMoveError(`Not a FreeCell move: ${JSON.stringify(move)}.`);
  }
  const log = logPushMove(state.log, move);
  const folded = foldFreeCell(state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log, score: folded.fold.score };
}

export function canUndoFreeCell(state: FreeCellState): boolean {
  return logCanUndo(state.log);
}

export function undoFreeCell(state: FreeCellState): FreeCellState {
  if (!canUndoFreeCell(state)) {
    throw new IllegalMoveError("Nothing left to undo in this deal.");
  }
  const log = logPushUndo(state.log);
  const folded = foldFreeCell(state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log, score: folded.fold.score };
}

/**
 * How many cards one move may carry: `(free cells + 1) × 2^(empty columns)`, the
 * destination excluded from the empty columns — which is Wikipedia's C = 2^M ×
 * (N + 1) and its „half of it onto an empty cascade" rolled into one statement
 * (https://en.wikipedia.org/wiki/FreeCell § Supermoves). A cell or a foundation
 * takes one card, so the answer there is one.
 */
export function freeCellSupermoveLimit(state: FreeCellState, to: FreeCellSlot): number {
  if (to.kind !== "column") return 1;
  const destination = state.board.columns[to.column];
  if (destination === undefined) return 1;
  const emptyCells = state.board.cells.filter((held) => held === null).length;
  const others = state.board.columns.filter(
    (pile, index) => pile.length === 0 && index !== to.column,
  ).length;
  return (emptyCells + 1) * 2 ** others;
}

/** The safe foundation moves, in the order `klondikeAutoMoves` uses: rank, then suit, then where the card sits. */
export function freeCellAutoMoves(state: FreeCellState): FreeCellMove[] {
  const board = state.board;
  const candidates: { move: FreeCellMove; card: Card; order: number }[] = [];
  board.columns.forEach((pile, column) => {
    const top = pile[pile.length - 1];
    if (top === undefined || !canGoHome(board, top)) return;
    candidates.push({
      move: { kind: "move", from: { kind: "column", column }, to: { kind: "foundation", suit: top.suit }, count: 1 },
      card: top,
      order: column,
    });
  });
  board.cells.forEach((held, index) => {
    if (held === null || !canGoHome(board, held)) return;
    candidates.push({
      move: { kind: "move", from: { kind: "cell", cell: index }, to: { kind: "foundation", suit: held.suit }, count: 1 },
      card: held,
      order: board.columns.length + index,
    });
  });
  // The same card objects are handed in and filtered back out, so „is it in the
  // safe list" is an identity question and no comparison helper is needed.
  const safe = autoplaySafeCards(
    board.foundations,
    candidates.map((candidate) => candidate.card),
  );
  return candidates
    .filter((candidate) => safe.includes(candidate.card))
    .sort(
      (left, right) =>
        left.card.rank - right.card.rank ||
        SUITS.indexOf(left.card.suit) - SUITS.indexOf(right.card.suit) ||
        left.order - right.order,
    )
    .map((candidate) => candidate.move);
}

export function isFreeCellWon(state: FreeCellState): boolean {
  return state.board.foundations.every((pile) => pile.length === FULL_FOUNDATION);
}

/** Whether any action is left — the same cheap, exact question Klondike answers. */
export function hasFreeCellMoves(state: FreeCellState): boolean {
  return movesOnBoard(state.board).length > 0;
}

/**
 * One useful move, or null. The heuristic, in order: a safe foundation move; any
 * foundation move; a column move that empties its column; a card out of a free
 * cell onto a column; a card onto an empty column; and finally parking a column
 * card in a free cell. The first four each make the position easier to work in —
 * a card that will never be needed again, a column or a cell given back.
 */
export function freeCellHint(state: FreeCellState): FreeCellMove | null {
  const automatic = freeCellAutoMoves(state)[0];
  if (automatic !== undefined) return automatic;
  const moves = movesOnBoard(state.board);
  const empties = (move: FreeCellMove): boolean =>
    move.from.kind === "column" &&
    move.count === (state.board.columns[move.from.column]?.length ?? 0);
  return (
    moves.find((move) => move.to.kind === "foundation") ??
    moves.find((move) => move.from.kind === "column" && move.to.kind === "column" && empties(move)) ??
    moves.find((move) => move.from.kind === "cell" && move.to.kind === "column") ??
    moves.find((move) => move.to.kind === "column" && state.board.columns[move.to.column]?.length === 0) ??
    moves.find((move) => move.to.kind === "cell") ??
    null
  );
}

/**
 * The published deal: one card at a time out of a 52-card array in the order the
 * task names it (Ace of Clubs first, King of Spades last), swapped with the last
 * card and removed, then laid across eight columns — the first eight cards are
 * the first card of each column.
 */
function dealtBoard(seed: number): FreeCellBoard {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) deck.push({ suit, rank });
  }
  const columns: Card[][] = Array.from({ length: FREE_CELL_COLUMNS }, () => []);
  let state = seed;
  let at = 0;
  while (deck.length > 0) {
    state = (state * 214013 + 2531011) % 2147483648;
    const pick = (state >> 16) % deck.length;
    const held = deck[pick]!;
    deck[pick] = deck[deck.length - 1]!;
    deck.pop();
    columns[at % FREE_CELL_COLUMNS]!.push(held);
    at += 1;
  }
  return { columns, cells: Array.from({ length: FREE_CELL_COUNT }, () => null), foundations: SUITS.map(() => []) };
}

/**
 * The one place a FreeCell state is built, exactly as `foldKlondike` is: the log
 * walked from `initial`, scoring as it goes and remembering each frame, so that
 * applying, undoing and replaying can never disagree about what a log means.
 */
function foldFreeCell(
  initial: FreeCellBoard,
  log: readonly unknown[],
): { ok: true; fold: FreeCellFold } | { ok: false; refusal: CardGameRefusal } {
  let board = initial;
  let score = 0;
  const pending: FreeCellFrame[] = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (!isFreeCellEntry(entry)) {
      return {
        ok: false,
        refusal: {
          code: "bad-entry",
          atIndex: index,
          detail: `Entry ${index} is neither a FreeCell move nor an undo.`,
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
      score = frame.score + FREE_CELL_SCORE.undo;
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

function movesOnBoard(board: FreeCellBoard): FreeCellMove[] {
  const moves: FreeCellMove[] = [];

  board.cells.forEach((held, index) => {
    if (held === null) return;
    if (canGoHome(board, held)) {
      moves.push({
        kind: "move",
        from: { kind: "cell", cell: index },
        to: { kind: "foundation", suit: held.suit },
        count: 1,
      });
    }
    board.columns.forEach((pile, column) => {
      if (canLand(pile, held)) {
        moves.push({
          kind: "move",
          from: { kind: "cell", cell: index },
          to: { kind: "column", column },
          count: 1,
        });
      }
    });
  });

  board.columns.forEach((pile, column) => {
    const top = pile[pile.length - 1];
    if (top === undefined) return;
    if (canGoHome(board, top)) {
      moves.push({
        kind: "move",
        from: { kind: "column", column },
        to: { kind: "foundation", suit: top.suit },
        count: 1,
      });
    }
    const run = runLength(pile);
    board.columns.forEach((destination, index) => {
      if (index === column) return;
      const limit = supermoveLimitIn(board, index);
      for (let count = 1; count <= Math.min(run, limit); count += 1) {
        const deepest = pile[pile.length - count];
        if (deepest === undefined) break;
        if (destination.length === 0) {
          moves.push({
            kind: "move",
            from: { kind: "column", column },
            to: { kind: "column", column: index },
            count,
          });
          continue;
        }
        // A non-empty destination takes exactly one run length — the one whose
        // deepest card is the rank it wants — and which one that is cannot be
        // known without walking the run.
        if (canLand(destination, deepest)) {
          moves.push({
            kind: "move",
            from: { kind: "column", column },
            to: { kind: "column", column: index },
            count,
          });
          break;
        }
      }
    });
    board.cells.forEach((held, index) => {
      if (held !== null) return;
      moves.push({
        kind: "move",
        from: { kind: "column", column },
        to: { kind: "cell", cell: index },
        count: 1,
      });
    });
  });

  board.foundations.forEach((pile, index) => {
    const top = pile[pile.length - 1];
    if (top === undefined) return;
    board.columns.forEach((destination, column) => {
      if (canLand(destination, top)) {
        moves.push({
          kind: "move",
          from: { kind: "foundation", suit: SUITS[index]! },
          to: { kind: "column", column },
          count: 1,
        });
      }
    });
  });

  return moves;
}

function supermoveLimitIn(board: FreeCellBoard, destination: number): number {
  const emptyCells = board.cells.filter((held) => held === null).length;
  const others = board.columns.filter(
    (pile, index) => pile.length === 0 && index !== destination,
  ).length;
  return (emptyCells + 1) * 2 ** others;
}

/** The longest run at the top of a column that packs: descending by one, alternating colour. */
function runLength(pile: readonly Card[]): number {
  let run = pile.length > 0 ? 1 : 0;
  for (let index = pile.length - 1; index > 0; index -= 1) {
    const above = pile[index]!;
    const below = pile[index - 1]!;
    if (below.rank !== above.rank + 1 || colourOf(below.suit) === colourOf(above.suit)) break;
    run += 1;
  }
  return run;
}

function canLand(destination: readonly Card[], card: Card): boolean {
  const top = destination[destination.length - 1];
  if (top === undefined) return true;
  return top.rank === card.rank + 1 && colourOf(top.suit) !== colourOf(card.suit);
}

function canGoHome(board: FreeCellBoard, card: Card): boolean {
  return board.foundations[SUITS.indexOf(card.suit)]!.length === card.rank - 1;
}

function deltaFor(move: FreeCellMove): number {
  if (move.to.kind === "foundation") return FREE_CELL_SCORE.toFoundation;
  if (move.from.kind === "foundation") return FREE_CELL_SCORE.fromFoundation;
  return 0;
}

function applyToBoard(board: FreeCellBoard, move: FreeCellMove): FreeCellBoard {
  const { from, to, count } = move;
  const columns = board.columns.map((pile) => [...pile]);
  const cells = [...board.cells];
  const foundations = board.foundations.map((pile) => [...pile]);

  let carried: Card[];
  if (from.kind === "cell") {
    carried = cells[from.cell] === null ? [] : [cells[from.cell]!];
    cells[from.cell] = null;
  } else if (from.kind === "foundation") {
    const index = SUITS.indexOf(from.suit);
    const pile = foundations[index]!;
    carried = pile.slice(-1);
    foundations[index] = pile.slice(0, -1);
  } else {
    const pile = columns[from.column]!;
    carried = pile.slice(pile.length - count);
    columns[from.column] = pile.slice(0, pile.length - count);
  }

  if (to.kind === "cell") {
    cells[to.cell] = carried[0] ?? null;
  } else if (to.kind === "foundation") {
    const index = SUITS.indexOf(to.suit);
    foundations[index] = [...foundations[index]!, ...carried];
  } else {
    columns[to.column] = [...columns[to.column]!, ...carried];
  }

  return { columns, cells, foundations };
}

function sameMove(left: FreeCellMove, right: FreeCellMove): boolean {
  return left.count === right.count && sameSlot(left.from, right.from) && sameSlot(left.to, right.to);
}

function sameSlot(left: FreeCellSlot, right: FreeCellSlot): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "column" && right.kind === "column") return left.column === right.column;
  if (left.kind === "cell" && right.kind === "cell") return left.cell === right.cell;
  if (left.kind === "foundation" && right.kind === "foundation") return left.suit === right.suit;
  return false;
}

function isSlot(value: unknown): value is FreeCellSlot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; column?: unknown; cell?: unknown; suit?: unknown };
  if (candidate.kind === "column") {
    return (
      typeof candidate.column === "number" &&
      Number.isSafeInteger(candidate.column) &&
      candidate.column >= 0 &&
      candidate.column < FREE_CELL_COLUMNS
    );
  }
  if (candidate.kind === "cell") {
    return (
      typeof candidate.cell === "number" &&
      Number.isSafeInteger(candidate.cell) &&
      candidate.cell >= 0 &&
      candidate.cell < FREE_CELL_COUNT
    );
  }
  if (candidate.kind === "foundation") return (SUITS as readonly unknown[]).includes(candidate.suit);
  return false;
}
