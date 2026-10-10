/**
 * Tablić, the Serbian fishing game, for two players or four in two fixed
 * partnerships — the three opponents the brief asks for, on top of the rules.
 *
 * **The source is John McLeod's page on pagat.com**
 * (https://www.pagat.com/fishing/tablic.html), and the rules implemented here are
 * exactly its, quoted where the wording is the rule:
 *
 * - „For the purpose of capture the cards have values: king=14, queen=13,
 *   jack=12, ace=1 or 11 at the choice of the player, other cards face value."
 *   The rank model of `card.ts` numbers the Ace 1 and the King 13, so Tablić maps
 *   every rank onto ITS OWN value rather than reusing `rankStrength`; the two
 *   disagree on the ten (ten here, nine there) and that is the point.
 * - „Normally either two players, or for four players in fixed partnerships,
 *   partners sitting opposite each other" — the `duo` and `pairs` variants.
 * - The deal: „the player to dealer's left cuts and places the bottom four cards
 *   of the lifted section of the pack face up on the table as an initial layout,
 *   known in this game as the talon", then „deals the cards in batches of three,
 *   going around the table twice so that each player has a hand of six cards",
 *   and „After all players have played their cards, the same dealer will deal
 *   another six cards each in the same way". Two players therefore play four such
 *   deals and four players two, and 4 + 6 × 2 × 4 = 52 either way.
 * - „The player to dealer's right plays first, and the play continues
 *   anticlockwise."
 * - Capture: a played card captures „a card or a set of cards in the layout"
 *   whose values add up to it — several such sets at once are allowed, and „No
 *   card can belong to more than one captured set at the same time" — and „you are
 *   not obliged to capture everything that you can".
 * - „Capturing all the cards on the table, leaving it empty, is called a 'tabla'
 *   and is worth an extra point."
 * - „When all cards have been played and the deck is empty, all cards remaining on
 *   the table are taken by the dealer's team"; that final sweep is NOT a tabla,
 *   which the source states in so many words („It is not possible for the
 *   dealer's team to score a tabla with this final card").
 * - Scoring: „Each Ace, King, Queen or Jack: 1 point; 10 of diamonds: 2 points;
 *   Other tens: 1 point; 2 of clubs: 1 point; The player or team with most cards:
 *   3 points", plus a point a tabla, and „If there is a tie for most cards, no one
 *   gets the 3 points".
 * - „The object of the game is to achieve a score of 101 points or more." The
 *   simplest form the source describes is implemented: the totals are added up
 *   after each hand, the game is over when the higher total is past 101 and the
 *   two differ, and an exact tie is another hand.
 *
 * **Where sources disagree, this one wins and the variants are listed, not
 * mixed in.** The capture claim in the middle of a hand, the three-player game
 * with a 40-card pack, and the several ways of limiting tablas after the sixth
 * hand are all real Tablić, and all absent here because this page states them as
 * the variants of the game rather than as the game; the report lists them for
 * stage 2.
 *
 * A state is a pure function of `(variant, seed, log)`, as everywhere in this
 * package: the undelt remainder of the pack travels in the state (the deal is a
 * function of the seed and the hand number), and a log that plays a card its hand
 * does not hold, or takes a set of table cards that does not add up, is refused.
 */

import { sameCard, standardDeck, SUITS, type Card } from "./card.js";
import { dealRandom } from "./deal.js";
import {
  CardGameError,
  IllegalMoveError,
  isCardGameVariant,
  isCardSeed,
  type CardGameRefusal,
  type CardGameReplay,
  type CardOpponentLevel,
  type TablicVariant,
} from "./game.js";
import {
  isGameLogEntry,
  isUndoEntry,
  logCanUndo,
  logPushMove,
  logPushUndo,
  type GameLogEntry,
} from "./log.js";
import { randomBelow, shuffled, type SeededRandom } from "../random.js";

/** Four cards face up in the talon. */
export const TABLIC_TALON = 4;
/** Six each: „deals the cards in batches of three, going around the table twice". */
export const TABLIC_HAND = 6;
/** The source's ending: „to achieve a score of 101 points or more". */
export const TABLIC_TARGET = 101;
/** Everything except the three points for most cards, which is the total the rest add up to. */
export const TABLIC_CARD_POINTS = 22;
export const TABLIC_MOST_CARDS_POINTS = 3;

/** How many seats a variant deals to; partners are seats 0 and 2 against 1 and 3. */
const TABLIC_SEATS: Readonly<Record<TablicVariant, number>> = { duo: 2, pairs: 4 };

/** One card as it lies on the table, with the index a move uses to name it. */
export interface TablicTableCard {
  readonly index: number;
  readonly card: Card;
}

export interface TablicBoard {
  /** Which hand of the game this is, counting from zero; the dealer rotates with it. */
  readonly hand: number;
  readonly dealer: number;
  readonly phase: "playing" | "complete";
  /** Each seat's hand, in the fixed suit-then-strength order a saved game reads back. */
  readonly hands: readonly (readonly Card[])[];
  /** The face-up layout, in the order the cards were played; a move names them by index. */
  readonly table: readonly Card[];
  /** What is left of the pack; the next round is dealt from its front. */
  readonly deck: readonly Card[];
  /** What each SIDE has taken; index 0 is the person's side (seat 0 and, in `pairs`, seat 2). */
  readonly captured: readonly (readonly Card[])[];
  /** Tablas each side has made, one point each. */
  readonly tablas: readonly number[];
  /** Running totals, one per side. */
  readonly scores: readonly number[];
  /** Whose turn it is. */
  readonly seat: number;
}

export type TablicMove = {
  readonly kind: "play";
  /** The card played, which must be in the acting seat's hand. */
  readonly card: Card;
  /**
   * The table cards this play takes, as indices into the table as it stands;
   * empty means the card is simply left face up. The set must add up to the
   * played card's own value, in one or more groups.
   */
  readonly capture: readonly number[];
};

export interface TablicState {
  readonly variant: TablicVariant;
  readonly seed: number;
  readonly initial: TablicBoard;
  readonly board: TablicBoard;
  readonly log: readonly GameLogEntry<TablicMove>[];
}

export type TablicReplay = CardGameReplay<TablicState>;

interface TablicFrame {
  readonly move: TablicMove;
  readonly board: TablicBoard;
}

interface TablicFold {
  readonly board: TablicBoard;
  readonly pending: readonly TablicFrame[];
}

/**
 * A card's capture value. The Ace is the one card with two: „ace=1 or 11 at the
 * choice of the player", so `aceHigh` picks which, and every group of a capture is
 * allowed to pick for itself.
 */
export function tablicValue(card: Card, aceHigh = false): number {
  if (card.rank === 1) return aceHigh ? 11 : 1;
  if (card.rank === 11) return 12;
  if (card.rank === 12) return 13;
  if (card.rank === 13) return 14;
  return card.rank;
}

/** The side a seat plays for: partner seats are two apart. */
export function tablicSideOf(seat: number): number {
  return seat % 2;
}

/** How many seats this variant deals to. */
export function tablicSeats(variant: TablicVariant): number {
  return TABLIC_SEATS[variant];
}

/** Deals the first hand of a game. Throws for a variant or a seed nobody could have meant. */
export function dealTablic(variant: TablicVariant, seed: number): TablicState {
  if (!isCardGameVariant("tablic", variant)) {
    throw new CardGameError(`"${variant}" is not a Tablić variant.`);
  }
  if (!isCardSeed(seed)) {
    throw new CardGameError(`A Tablić seed must be a 32-bit unsigned integer, got ${seed}.`);
  }
  const initial = dealtBoard(variant, seed, 0, [0, 0], [0, 0]);
  return { variant, seed, initial, board: initial, log: [] };
}

/** Rebuilds the state a saved `(variant, seed, log)` describes, or says why it cannot be one. */
export function replayTablic(variant: TablicVariant, seed: number, log: unknown): TablicReplay {
  if (!isCardGameVariant("tablic", variant)) {
    return {
      ok: false,
      refusal: {
        code: "unknown-variant",
        atIndex: null,
        detail: `"${variant}" is not a Tablić variant.`,
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
  const initial = dealtBoard(variant, seed, 0, [0, 0], [0, 0]);
  const folded = foldTablic(variant, seed, initial, log as readonly unknown[]);
  if (!folded.ok) return { ok: false, refusal: folded.refusal };
  return {
    ok: true,
    state: {
      variant,
      seed,
      initial,
      board: folded.fold.board,
      log: log as readonly GameLogEntry<TablicMove>[],
    },
  };
}

export function isTablicMove(value: unknown): value is TablicMove {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; card?: unknown; capture?: unknown };
  if (candidate.kind !== "play" || !isCardShape(candidate.card)) return false;
  const { capture } = candidate;
  return (
    Array.isArray(capture) &&
    capture.every(
      (index) => typeof index === "number" && Number.isSafeInteger(index) && index >= 0,
    ) &&
    new Set(capture).size === capture.length
  );
}

export function isTablicEntry(value: unknown): value is GameLogEntry<TablicMove> {
  return isGameLogEntry(value, isTablicMove);
}

/** The seat whose move it is, or -1 when the game is over. */
export function tablicToAct(state: TablicState): number {
  return state.board.phase === "complete" ? -1 : state.board.seat;
}

/**
 * Every move the position allows: for each card in the acting seat's hand, that
 * card with no capture and with every legal capture — every non-empty set of
 * table cards that can be split into groups each adding up to the card's value.
 * Legality is membership in this list, so „offered" and „legal" cannot disagree.
 */
export function tablicMoves(state: TablicState): TablicMove[] {
  return movesOnBoard(state.board);
}

function movesOnBoard(board: TablicBoard): TablicMove[] {
  if (board.phase === "complete") return [];
  const hand = board.hands[board.seat] ?? [];
  const moves: TablicMove[] = [];
  for (const card of hand) {
    moves.push({ kind: "play", card, capture: [] });
    for (const capture of legalCaptures(board.table, card)) {
      moves.push({ kind: "play", card, capture });
    }
  }
  return moves;
}

export function isTablicMoveLegal(state: TablicState, move: TablicMove): boolean {
  return isTablicMove(move) && isMoveLegalOn(state.board, move);
}

export function hasTablicMoves(state: TablicState): boolean {
  return tablicMoves(state).length > 0;
}

export function applyTablic(state: TablicState, move: TablicMove): TablicState {
  if (!isTablicMove(move)) {
    throw new IllegalMoveError(`Not a Tablić move: ${JSON.stringify(move)}.`);
  }
  if (!isMoveLegalOn(state.board, move)) {
    throw new IllegalMoveError("That move is not legal in the position it was played from.");
  }
  // Stepped, not folded — see `applyHearts` for why. The fold is what
  // `replayTablic` and `undoTablic` do, and both paths validate with `isMoveLegalOn`.
  return {
    ...state,
    board: stepTablic(state.variant, state.seed, state.board, move),
    log: logPushMove(state.log, move),
  };
}

export function canUndoTablic(state: TablicState): boolean {
  return logCanUndo(state.log);
}

/** Takes back one move — a card, the cards it took and the tabla it made, all at once. */
export function undoTablic(state: TablicState): TablicState {
  if (!canUndoTablic(state)) {
    throw new IllegalMoveError("Nothing left to undo in this game.");
  }
  const log = logPushUndo(state.log);
  const folded = foldTablic(state.variant, state.seed, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log };
}

/** Whether the person's side won: the game is over and its total is the higher one. */
export function isTablicWon(state: TablicState): boolean {
  const { phase, scores } = state.board;
  const mine = scores[0];
  const theirs = scores[1];
  if (phase !== "complete" || mine === undefined || theirs === undefined) return false;
  return mine > theirs;
}

/**
 * What one side's captures are worth: a point for every Ace, King, Queen and
 * Jack, two for the ten of diamonds and one for the other tens, one for the two
 * of clubs. The three points for most cards are added when the hand ends, because
 * they are a comparison rather than a property of a pile.
 */
export function tablicCardPoints(captured: readonly Card[]): number {
  let points = 0;
  for (const card of captured) {
    if (card.rank === 1 || card.rank >= 11) points += 1;
    else if (card.rank === 10) points += card.suit === "diamonds" ? 2 : 1;
    else if (card.suit === "clubs" && card.rank === 2) points += 1;
  }
  return points;
}

/** The three points for most cards, and the source's answer to a tie: nobody gets them. */
export function tablicMostCardsPoints(
  captured: readonly (readonly Card[])[],
): readonly number[] {
  const counts = captured.map((pile) => pile.length);
  const best = Math.max(...counts);
  const winners = counts.filter((count) => count === best).length;
  return counts.map((count) => (winners === 1 && count === best ? TABLIC_MOST_CARDS_POINTS : 0));
}

/** The card's own value as the capture target: the Ace is worth either one or eleven, so both are tried. */
function captureTargets(card: Card): readonly number[] {
  return card.rank === 1 ? [1, 11] : [tablicValue(card)];
}

/**
 * Every non-empty set of table cards a play of `card` may take: a set is legal
 * when it can be split into groups that each add up to the played card's value,
 * because „you may capture any such cards or sets" and a union of disjoint sets is
 * itself such a set. Computed exactly rather than sampled — the groups are found
 * by a subset search that prunes as soon as a group passes the target, which is
 * what keeps a table of a dozen cards cheap.
 */
export function legalCaptures(table: readonly Card[], card: Card): number[][] {
  const sets = new Map<string, number[]>();
  for (const target of captureTargets(card)) {
    const groups = groupCandidates(table, target);
    for (const capture of combineDisjoint(groups)) {
      sets.set(keyOf(capture), capture);
    }
  }
  return [...sets.values()];
}

/** The subsets of the table that add up to `target`, each index used once and each Ace at one value. */
function groupCandidates(table: readonly Card[], target: number): number[][] {
  const groups = new Map<string, number[]>();
  const pick: number[] = [];
  const walk = (start: number, remaining: number): void => {
    if (remaining === 0 && pick.length > 0) {
      groups.set(keyOf(pick), [...pick]);
      return;
    }
    for (let index = start; index < table.length; index += 1) {
      const card = table[index]!;
      for (const value of card.rank === 1 ? [1, 11] : [tablicValue(card)]) {
        if (value > remaining) continue;
        pick.push(index);
        walk(index + 1, remaining - value);
        pick.pop();
      }
    }
  };
  walk(0, target);
  return [...groups.values()];
}

/** Every union of pairwise-disjoint groups, which is every legal capture set. */
function combineDisjoint(groups: readonly (readonly number[])[]): number[][] {
  const unions = new Map<string, number[]>();
  const walk = (start: number, used: ReadonlySet<number>, picked: number[]): void => {
    if (picked.length > 0) unions.set(keyOf(picked), [...picked]);
    for (let index = start; index < groups.length; index += 1) {
      const group = groups[index]!;
      if (group.some((slot) => used.has(slot))) continue;
      const next = new Set(used);
      for (const slot of group) next.add(slot);
      picked.push(...group);
      walk(index + 1, next, picked);
      picked.length -= group.length;
    }
  };
  walk(0, new Set<number>(), []);
  return [...unions.values()];
}

function keyOf(indices: readonly number[]): string {
  return [...indices].sort((left, right) => left - right).join(",");
}

function foldTablic(
  variant: TablicVariant,
  seed: number,
  initial: TablicBoard,
  log: readonly unknown[],
): { ok: true; fold: TablicFold } | { ok: false; refusal: CardGameRefusal } {
  let board = initial;
  const pending: TablicFrame[] = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (!isTablicEntry(entry)) {
      return {
        ok: false,
        refusal: {
          code: "bad-entry",
          atIndex: index,
          detail: `Entry ${index} is neither a Tablić move nor an undo.`,
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
      continue;
    }
    if (!isMoveLegalOn(board, entry)) {
      return {
        ok: false,
        refusal: {
          code: "illegal-move",
          atIndex: index,
          detail: `Entry ${index} is not legal in the position it was played from.`,
        },
      };
    }
    pending.push({ move: entry, board });
    board = stepTablic(variant, seed, board, entry);
  }
  return { ok: true, fold: { board, pending } };
}

/**
 * Whether a move is legal in a board — the rules themselves, in one place, which
 * `tablicMoves` enumerates and `applyTablic`, the fold and `isTablicMoveLegal` all
 * ask. The test beside this engine pins the two against each other on random
 * tables, because an enumeration and a predicate are two ways of saying one thing
 * and the only way to know they agree is to check.
 */
function isMoveLegalOn(board: TablicBoard, move: TablicMove): boolean {
  if (board.phase === "complete" || move.kind !== "play") return false;
  const hand = board.hands[board.seat] ?? [];
  if (!hand.some((card) => sameCard(card, move.card))) return false;
  return canCapture(board.table, move.card, move.capture);
}

/** Whether these table cards, and no others, add up to the played card's value. */
function canCapture(table: readonly Card[], card: Card, capture: readonly number[]): boolean {
  if (capture.length === 0) return true;
  if (capture.some((slot) => slot < 0 || slot >= table.length)) return false;
  const cards = capture.map((slot) => table[slot]!);
  return captureTargets(card).some((target) => formsGroups(cards, target));
}

/**
 * Whether a multiset of cards splits into groups that each add up to `target`,
 * each Ace counted as one or as eleven. The anchor is always the lowest card not
 * yet spent, so no partition is counted twice and none is missed.
 */
function formsGroups(cards: readonly Card[], target: number): boolean {
  const options = cards.map(captureTargets);
  const used = options.map(() => false);

  const rest = (): boolean => {
    const anchor = used.indexOf(false);
    if (anchor === -1) return true;
    used[anchor] = true;
    for (const value of options[anchor]!) {
      if (value <= target && fill(anchor, target - value)) {
        used[anchor] = false;
        return true;
      }
    }
    used[anchor] = false;
    return false;
  };

  const fill = (anchor: number, remaining: number): boolean => {
    if (remaining === 0) return rest();
    for (let index = anchor + 1; index < options.length; index += 1) {
      if (used[index] === true) continue;
      for (const value of options[index]!) {
        if (value > remaining) continue;
        used[index] = true;
        const done = fill(index, remaining - value);
        used[index] = false;
        if (done) return true;
      }
    }
    return false;
  };

  return rest();
}

/** One move applied to a board, with the next round or the end of the hand as the rules ask. */
function stepTablic(
  variant: TablicVariant,
  seed: number,
  board: TablicBoard,
  move: TablicMove,
): TablicBoard {
  const seat = board.seat;
  const side = tablicSideOf(seat);
  const hands = board.hands.map((hand, index) =>
    index === seat ? hand.filter((card) => !sameCard(card, move.card)) : hand,
  );
  const taken = move.capture.map((slot) => board.table[slot]!).filter((card) => card !== undefined);
  const table =
    move.capture.length === 0
      ? [...board.table, move.card]
      : board.table.filter((_, slot) => !move.capture.includes(slot));
  // „Capturing all the cards on the table, leaving it empty, is called a 'tabla'":
  // a capture that leaves nothing behind, and only a capture — the sweep at the
  // end of the hand is not one.
  const tabla = move.capture.length > 0 && table.length === 0;
  // „You take the captured cards, along with the card you played": the played card
  // joins the pile only when it TOOK something. Played onto the table it is an
  // „extra card of the layout, which may be captured in a future play" — so it is
  // on the table and in nobody's pile, and never in both.
  const captured =
    move.capture.length === 0
      ? board.captured
      : board.captured.map((pile, index) =>
          index === side ? [...pile, move.card, ...taken] : pile,
        );
  const tablas = board.tablas.map((count, index) => (index === side && tabla ? count + 1 : count));
  const next = nextSeat(seat, tablicSeats(variant));

  if (hands.some((hand) => hand.length > 0)) {
    return { ...board, hands, table, captured, tablas, seat: next };
  }
  if (board.deck.length > 0) {
    const round = dealRound(variant, board.deck, board.dealer);
    return { ...board, hands: round.hands, deck: round.deck, table, captured, tablas, seat: next };
  }
  return finishHand(variant, board, hands, table, captured, tablas, seed);
}

/**
 * The end of a hand: „all cards remaining on the table are taken by the dealer's
 * team and added to their captures", the points are added up, and either another
 * hand is dealt or the game is over.
 */
function finishHand(
  variant: TablicVariant,
  board: TablicBoard,
  hands: readonly (readonly Card[])[],
  table: readonly Card[],
  captured: readonly (readonly Card[])[],
  tablas: readonly number[],
  seed: number,
): TablicBoard {
  const dealerSide = tablicSideOf(board.dealer);
  const swept = captured.map((pile, index) => (index === dealerSide ? [...pile, ...table] : pile));
  const most = tablicMostCardsPoints(swept);
  const scores = board.scores.map(
    (total, index) =>
      total + tablicCardPoints(swept[index] ?? []) + (most[index] ?? 0) + (tablas[index] ?? 0),
  );
  const settled: TablicBoard = {
    ...board,
    hands,
    table: [],
    captured: swept,
    tablas,
    scores,
    seat: firstSeat(board.dealer, tablicSeats(variant)),
  };
  const higher = Math.max(...scores);
  if (higher > TABLIC_TARGET && (scores[0] ?? 0) !== (scores[1] ?? 0)) {
    return { ...settled, phase: "complete" };
  }
  return dealtBoard(variant, seed, board.hand + 1, scores, [0, 0]);
}

/** The player to the dealer's right acts first, and the play runs anticlockwise — one seat down. */
function firstSeat(dealer: number, seats: number): number {
  return (dealer + seats - 1) % seats;
}

function nextSeat(seat: number, seats: number): number {
  return (seat + seats - 1) % seats;
}

/**
 * One hand's deal: the talon face up, then „batches of three, going around the
 * table twice" starting with the player to the dealer's right and moving
 * anticlockwise, so that the seat to be dealt to next is one card-table step down
 * rather than the next index.
 */
function dealtBoard(
  variant: TablicVariant,
  seed: number,
  hand: number,
  scores: readonly number[],
  tablas: readonly number[],
): TablicBoard {
  const seats = tablicSeats(variant);
  const dealer = hand % seats;
  const deck = shuffled(standardDeck(), dealRandom(seed, hand));
  const talon = deck.slice(0, TABLIC_TALON);
  const round = dealRound(variant, deck.slice(TABLIC_TALON), dealer);
  return {
    hand,
    dealer,
    phase: "playing",
    hands: round.hands,
    table: talon,
    deck: round.deck,
    captured: [0, 1].map(() => []),
    tablas,
    scores,
    seat: firstSeat(dealer, seats),
  };
}

/** Six cards each, three at a time, anticlockwise from the dealer's right. */
function dealRound(
  variant: TablicVariant,
  deck: readonly Card[],
  dealer: number,
): { readonly hands: readonly (readonly Card[])[]; readonly deck: readonly Card[] } {
  const seats = tablicSeats(variant);
  const hands: Card[][] = Array.from({ length: seats }, () => []);
  const first = firstSeat(dealer, seats);
  let at = 0;
  for (let batch = 0; batch < TABLIC_HAND / 3; batch += 1) {
    for (let step = 0; step < seats; step += 1) {
      const seat = (first + step * (seats - 1)) % seats;
      for (let card = 0; card < 3; card += 1) {
        const next = deck[at];
        if (next === undefined) break;
        hands[seat]!.push(next);
        at += 1;
      }
    }
  }
  return { hands: hands.map(sortHand), deck: deck.slice(at) };
}

function sortHand(hand: readonly Card[]): Card[] {
  return [...hand].sort(
    (left, right) =>
      SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit) ||
      tablicValue(right) - tablicValue(left) ||
      left.rank - right.rank,
  );
}

function isCardShape(value: unknown): value is Card {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { suit?: unknown; rank?: unknown };
  return (
    (SUITS as readonly unknown[]).includes(candidate.suit) &&
    typeof candidate.rank === "number" &&
    Number.isSafeInteger(candidate.rank) &&
    candidate.rank >= 1 &&
    candidate.rank <= 13
  );
}

/** One rung of the ladder, and what it is allowed to spend. */
export interface TablicLevel {
  readonly level: CardOpponentLevel;
  /** Determinizations the hard level averages over; the two rungs below it sample none. */
  readonly samples: number;
  /** A soft ceiling in milliseconds for one move's worth of sampling; zero means no clock, which is what a test wants. */
  readonly timeMs: number;
}

/**
 * The three rungs, this project's own numbers: `hard` samples six unseen-card
 * deals per move and stops early if the clock says so, so a slower machine plays a
 * little worse rather than stalling the table.
 */
export const TABLIC_LEVELS: readonly TablicLevel[] = [
  { level: "easy", samples: 0, timeMs: 0 },
  { level: "medium", samples: 0, timeMs: 0 },
  { level: "hard", samples: 6, timeMs: 30 },
];

export function tablicLevel(level: CardOpponentLevel): TablicLevel {
  const config = TABLIC_LEVELS.find((candidate) => candidate.level === level);
  if (config === undefined) throw new CardGameError(`"${level}" is not an opponent level.`);
  return config;
}

export interface TablicChooserOptions {
  /** An injected clock, so the engine stays pure and a test can measure it. Omitted means no deadline. */
  readonly now?: () => number;
}

/**
 * The move one of the seats plays at `level`, always one `tablicMoves` offered —
 * every rung picks out of the enumeration rather than building a move of its own,
 * which is what makes „never illegal" one statement.
 */
export function tablicChooseMove(
  state: TablicState,
  level: CardOpponentLevel,
  random: SeededRandom,
  options: TablicChooserOptions = {},
): TablicMove {
  const config = tablicLevel(level);
  const moves = tablicMoves(state);
  if (moves.length === 0) {
    throw new CardGameError("There is no move to choose: this game is over.");
  }
  if (config.level === "easy") return moves[randomBelow(random, moves.length)]!;
  if (config.level === "medium") return mediumMove(state.board);
  return hardMove(state.variant, state.board, random, config, options);
}

/**
 * The medium rule: take points, take a tabla, take cards, and do not feed the
 * opponent a fat card — the four things the scoring column is made of. The
 * numbers are a ranking and are documented as such rather than measured: a card
 * point is worth six times a card (3 points for most cards over 52 cards is about
 * a twentieth of a card each), and a tabla is worth a card point.
 */
function mediumMove(board: TablicBoard): TablicMove {
  const moves = movesOnBoard(board);
  const first = moves[0];
  if (first === undefined) throw new CardGameError("There is no move to choose: this game is over.");
  let best = first;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const move of moves) {
    const score = heuristic(board, move);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

function heuristic(board: TablicBoard, move: TablicMove): number {
  const taken = move.capture.map((slot) => board.table[slot]!).filter((card) => card !== undefined);
  const tabla = move.capture.length > 0 && board.table.length === move.capture.length ? 1 : 0;
  const points = tablicCardPoints(taken);
  const fed = move.capture.length === 0 ? tablicValue(move.card) / 2 : 0;
  return 6 * points + 6 * tabla + taken.length - fed;
}

/**
 * The hard level: for each legal move, sample the cards it has not seen, play the
 * rest of the round out with the greedy rule, and average the swing in card
 * points for its own side. The samples come from `unseenCards` — the deck and the
 * other hands — so the search is over the opponents' cards rather than inside
 * them.
 */
function hardMove(
  variant: TablicVariant,
  board: TablicBoard,
  random: SeededRandom,
  config: TablicLevel,
  options: TablicChooserOptions,
): TablicMove {
  const moves = movesOnBoard(board);
  const first = moves[0];
  if (first === undefined) throw new CardGameError("There is no move to choose: this game is over.");
  if (moves.length === 1) return first;

  const side = tablicSideOf(board.seat);
  const pool = unseenCards(board);
  const totals = new Map<string, number>();
  const keys = moves.map((move) => `${keyOf(move.capture)}#${move.card.suit}${move.card.rank}`);
  keys.forEach((key) => totals.set(key, 0));
  const deadline = options.now === undefined || config.timeMs === 0 ? null : options.now() + config.timeMs;

  let samples = 0;
  for (let sample = 0; sample < config.samples; sample += 1) {
    if (deadline !== null && (options.now?.() ?? 0) >= deadline) break;
    const sampled = sampleBoard(board, pool, random);
    moves.forEach((move, index) => {
      const key = keys[index]!;
      totals.set(key, (totals.get(key) ?? 0) + playoutSwing(variant, sampled, move, side));
    });
    samples += 1;
  }
  if (samples === 0) return mediumMove(board);

  let best = first;
  let bestScore = Number.NEGATIVE_INFINITY;
  moves.forEach((move, index) => {
    const average = (totals.get(keys[index]!) ?? 0) / samples;
    if (average > bestScore) {
      bestScore = average;
      best = move;
    }
  });
  return best;
}

/**
 * The rest of the round played out from a sampled table with the greedy rule, and
 * the swing in card points it leaves the side with. It stops at the end of the
 * round — a new round, a new hand or the end of the game all end the walk — so a
 * sample costs one round rather than one game.
 */
function playoutSwing(
  variant: TablicVariant,
  sampled: TablicBoard,
  move: TablicMove,
  side: number,
): number {
  const before = tablicCardPoints(sampled.captured[side] ?? []) -
    tablicCardPoints(sampled.captured[1 - side] ?? []);
  let board = stepTablic(variant, 0, sampled, move);
  let guard = 0;
  while (board.phase === "playing" && board.hand === sampled.hand && guard < 64) {
    if (board.deck.length !== sampled.deck.length || !board.hands.some((hand) => hand.length > 0)) {
      break;
    }
    const next = stepTablic(variant, 0, board, greedyMove(board));
    // A step that ends the round or the hand leaves a board about a different
    // deal; the swing is read off the last board that is still this one.
    if (next.phase !== "playing" || next.hand !== sampled.hand || next.deck.length !== sampled.deck.length) {
      break;
    }
    board = next;
    guard += 1;
  }
  return (
    tablicCardPoints(board.captured[side] ?? []) -
    tablicCardPoints(board.captured[1 - side] ?? []) -
    before
  );
}

/**
 * A cheap legal move for a playout: the first capture the table offers to the
 * best card in hand, and otherwise the lowest card played onto the table. The
 * medium rule would enumerate every capture, which is what a search cannot afford
 * to do at every step of every sample.
 */
function greedyMove(board: TablicBoard): TablicMove {
  const hand = [...(board.hands[board.seat] ?? [])].sort(
    (left, right) => tablicValue(right) - tablicValue(left) || left.rank - right.rank,
  );
  for (const card of hand) {
    const capture = firstCapture(board.table, card);
    if (capture !== undefined) return { kind: "play", card, capture };
  }
  const cheapest = [...hand].sort((left, right) => tablicValue(left) - tablicValue(right))[0]!;
  return { kind: "play", card: cheapest, capture: [] };
}

/** The first set of table cards that adds up to the card's value, or undefined. */
function firstCapture(table: readonly Card[], card: Card): number[] | undefined {
  for (const target of captureTargets(card)) {
    const found = firstGroup(table, 0, target, []);
    if (found !== undefined) return found;
  }
  return undefined;
}

function firstGroup(
  table: readonly Card[],
  start: number,
  remaining: number,
  picked: readonly number[],
): number[] | undefined {
  if (remaining === 0 && picked.length > 0) return [...picked];
  for (let index = start; index < table.length; index += 1) {
    const card = table[index]!;
    for (const value of captureTargets(card)) {
      if (value > remaining) continue;
      const found = firstGroup(table, index + 1, remaining - value, [...picked, index]);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** The deck and the other seats' hands: everything the acting seat has not seen. */
function unseenCards(board: TablicBoard): Card[] {
  const mine = board.hands[board.seat] ?? [];
  return [...board.deck, ...board.hands.filter((_, seat) => seat !== board.seat).flatMap((hand) => [...hand])]
    .filter((card) => !mine.some((held) => sameCard(held, card)));
}

/** A hypothetical table: the acting seat's hand is real, the other hands are dealt the unseen pool. */
function sampleBoard(board: TablicBoard, pool: readonly Card[], random: SeededRandom): TablicBoard {
  const deck = shuffled(pool, random);
  let at = 0;
  const hands = board.hands.map((hand, seat) => {
    if (seat === board.seat) return hand;
    const dealt = deck.slice(at, at + hand.length);
    at += hand.length;
    return sortHand(dealt);
  });
  return { ...board, hands };
}
