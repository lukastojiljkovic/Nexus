/**
 * Spades for two partnerships, played to five hundred points, with the three
 * opponents the brief asks for.
 *
 * The rules are the article's (https://en.wikipedia.org/wiki/Spades_(card_game)
 * § The deal, § Bidding, § Game play and § Scoring): four players in two fixed
 * partnerships sitting opposite each other, thirteen cards each, spades always
 * trump and never named, a bid of zero called nil, must-follow-suit, the highest
 * card of the suit led taking the trick unless a spade fell. The article's „common
 * variant rule, borrowed from Hearts" — a spade may not be LED until a spade has
 * been played to trump another trick — is the one implemented here, and it is
 * named rather than assumed.
 *
 * The scoring is the article's basic method: the partners' bids add up, ten
 * points a bid trick when the contract is made, minus ten a bid trick when it is
 * set, one point for each overtrick — a „bag" — and a hundred-point penalty each
 * time a partnership's tenth bag arrives. A successful nil is worth a hundred and
 * a failed one costs a hundred, either way to the partnership, which is what the
 * article's table says and what makes a nil a real bid rather than a free one.
 * **The game ends on either of the article's two conditions**: „the first to reach
 * 500 points, or forcing the opposing team to drop to −200 points". Both are
 * implemented, which is what makes a game against a badly bidding opponent a game
 * at all rather than a run of hands that never climbs; if both conditions are met
 * in one deal the higher total wins, and an exact tie is another deal.
 *
 * **Seats 0 and 2 are the person's partnership** — the person sits in seat 0 —
 * and all four seats are played by the level ladder, so a whole game can be run
 * without a person at all.
 *
 * **The opponents only see what a person sees**, as in Hearts: `easy` plays a
 * random legal move, `medium` counts its hand for a bid and plays to the contract,
 * and `hard` samples the unseen cards and plays the rest of the trick out with
 * the medium rule, picking the card with the best average.
 */

import {
  cardCode,
  rankStrength,
  sameCard,
  standardDeck,
  SUITS,
  type Card,
} from "./card.js";
import { dealRandom } from "./deal.js";
import {
  CardGameError,
  IllegalMoveError,
  isCardGameVariant,
  isCardSeed,
  type CardGameRefusal,
  type CardGameReplay,
  type CardOpponentLevel,
  type SpadesVariant,
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

export const SPADES_SEATS = 4;
export const SPADES_HAND = 13;
export const SPADES_TRICKS = 13;
/** The article: „shorter variants of the game, where players play to 250 points, instead of the standard 500". */
export const SPADES_TARGET = 500;
/** The other half of the article's ending: „or forcing the opposing team to drop to −200 points". */
export const SPADES_LOSS = -200;
export const SPADES_BAGS_PER_PENALTY = 10;
export const SPADES_NIL_BONUS = 100;
export const SPADES_BAG_PENALTY = -100;

/** One card as it fell in the trick in play. */
export interface SpadesTrickCard {
  readonly seat: number;
  readonly card: Card;
}

export interface SpadesBoard {
  readonly deal: number;
  readonly dealer: number;
  readonly phase: "bidding" | "playing" | "complete";
  /** Each seat's hand, in the fixed suit-then-rank order a saved game reads back. */
  readonly hands: readonly (readonly Card[])[];
  /** Each seat's bid for this deal; null while the seat has not bid. Zero is nil. */
  readonly bids: readonly (number | null)[];
  readonly trick: readonly SpadesTrickCard[];
  readonly leader: number;
  readonly tricksPlayed: number;
  readonly spadesBroken: boolean;
  /** Tricks each seat has taken this deal. */
  readonly taken: readonly (readonly Card[])[];
  /** Partnership totals, index 0 being the person's partnership (seats 0 and 2). */
  readonly scores: readonly number[];
  /** Overtricks each partnership has banked; ten of them are the penalty. */
  readonly bags: readonly number[];
}

export type SpadesMove =
  /** A bid from zero (nil) to thirteen, in the article's order: to the dealer's left, round to the dealer. */
  | { readonly kind: "bid"; readonly bid: number }
  | { readonly kind: "play"; readonly card: Card };

export interface SpadesState {
  readonly variant: SpadesVariant;
  readonly seed: number;
  readonly initial: SpadesBoard;
  readonly board: SpadesBoard;
  readonly log: readonly GameLogEntry<SpadesMove>[];
}

export type SpadesReplay = CardGameReplay<SpadesState>;

interface SpadesFrame {
  readonly move: SpadesMove;
  readonly board: SpadesBoard;
}

interface SpadesFold {
  readonly board: SpadesBoard;
  readonly pending: readonly SpadesFrame[];
}

/** The partnership a seat belongs to: partners sit opposite each other. */
export function spadesPartnerOf(seat: number): number {
  return seat % 2;
}

/** Deals the first hand of a game. Throws for a variant or a seed nobody could have meant. */
export function dealSpades(variant: SpadesVariant, seed: number): SpadesState {
  if (!isCardGameVariant("spades", variant)) {
    throw new CardGameError(`"${variant}" is not a Spades variant.`);
  }
  if (!isCardSeed(seed)) {
    throw new CardGameError(`A Spades seed must be a 32-bit unsigned integer, got ${seed}.`);
  }
  const initial = dealtBoard(seed, 0, [0, 0], [0, 0]);
  return { variant, seed, initial, board: initial, log: [] };
}

/** Rebuilds the state a saved `(variant, seed, log)` describes, or says why it cannot be one. */
export function replaySpades(variant: SpadesVariant, seed: number, log: unknown): SpadesReplay {
  if (!isCardGameVariant("spades", variant)) {
    return {
      ok: false,
      refusal: {
        code: "unknown-variant",
        atIndex: null,
        detail: `"${variant}" is not a Spades variant.`,
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
  const initial = dealtBoard(seed, 0, [0, 0], [0, 0]);
  const folded = foldSpades(seed, initial, log as readonly unknown[]);
  if (!folded.ok) return { ok: false, refusal: folded.refusal };
  return {
    ok: true,
    state: {
      variant,
      seed,
      initial,
      board: folded.fold.board,
      log: log as readonly GameLogEntry<SpadesMove>[],
    },
  };
}

export function isSpadesMove(value: unknown): value is SpadesMove {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; bid?: unknown; card?: unknown };
  if (candidate.kind === "bid") {
    const { bid } = candidate;
    return (
      Object.keys(value).length === 2 &&
      typeof bid === "number" &&
      Number.isSafeInteger(bid) &&
      bid >= 0 &&
      bid <= SPADES_TRICKS
    );
  }
  return candidate.kind === "play" && isCardShape(candidate.card);
}

export function isSpadesEntry(value: unknown): value is GameLogEntry<SpadesMove> {
  return isGameLogEntry(value, isSpadesMove);
}

/** The seat whose move it is, or -1 when the game is over. */
export function spadesToAct(state: SpadesState): number {
  const board = state.board;
  if (board.phase === "complete") return -1;
  if (board.phase === "bidding") return biddingSeat(board);
  return playingSeat(board);
}

/** Every move the position allows: a bid for the seat to bid, or every card that follows suit and the leading rule. */
export function spadesMoves(state: SpadesState): SpadesMove[] {
  const board = state.board;
  if (board.phase === "complete") return [];
  if (board.phase === "bidding") {
    return bidRange().map((bid) => ({ kind: "bid", bid }));
  }
  const seat = playingSeat(board);
  return (board.hands[seat] ?? [])
    .filter((card) => canPlay(board, seat, card))
    .map((card) => ({ kind: "play", card }));
}

export function isSpadesMoveLegal(state: SpadesState, move: SpadesMove): boolean {
  return isSpadesMove(move) && isMoveLegalOn(state.board, move);
}

export function hasSpadesMoves(state: SpadesState): boolean {
  return spadesMoves(state).length > 0;
}

export function applySpades(state: SpadesState, move: SpadesMove): SpadesState {
  if (!isSpadesMove(move)) {
    throw new IllegalMoveError(`Not a Spades move: ${JSON.stringify(move)}.`);
  }
  if (!isMoveLegalOn(state.board, move)) {
    throw new IllegalMoveError("That move is not legal in the position it was played from.");
  }
  // Stepped, not folded — see `applyHearts` for why; the fold is what `replaySpades`
  // and `undoSpades` do, and both paths validate with `isMoveLegalOn`.
  return { ...state, board: stepSpades(state.seed, state.board, move), log: logPushMove(state.log, move) };
}

export function canUndoSpades(state: SpadesState): boolean {
  return logCanUndo(state.log);
}

/** Takes back one move — a card, or a bid that has not been followed by play yet. */
export function undoSpades(state: SpadesState): SpadesState {
  if (!canUndoSpades(state)) {
    throw new IllegalMoveError("Nothing left to undo in this game.");
  }
  const log = logPushUndo(state.log);
  const folded = foldSpades(state.seed, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log };
}

/** Whether the person's partnership won: the game is over and its total is the higher one. */
export function isSpadesWon(state: SpadesState): boolean {
  const { phase, scores } = state.board;
  const mine = scores[0];
  const theirs = scores[1];
  if (phase !== "complete" || mine === undefined || theirs === undefined) return false;
  return mine > theirs;
}

/**
 * How many tricks a partnership has taken this deal. `taken` holds the CARDS a
 * seat won, and a trick is four of them, so the count divides by the four seats —
 * a pile's length is cards, and the article's scoring counts tricks.
 */
export function spadesPartnershipTricks(board: SpadesBoard, partnership: number): number {
  return board.taken.reduce(
    (total, pile, seat) =>
      spadesPartnerOf(seat) === partnership ? total + pile.length / SPADES_SEATS : total,
    0,
  );
}

/** The partnership's contract for this deal: the two bids added, a nil counting zero. */
export function spadesContract(board: SpadesBoard, partnership: number): number {
  let contract = 0;
  board.bids.forEach((bid, seat) => {
    if (spadesPartnerOf(seat) === partnership && bid !== null) contract += bid;
  });
  return contract;
}

function foldSpades(
  seed: number,
  initial: SpadesBoard,
  log: readonly unknown[],
): { ok: true; fold: SpadesFold } | { ok: false; refusal: CardGameRefusal } {
  let board = initial;
  const pending: SpadesFrame[] = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (!isSpadesEntry(entry)) {
      return {
        ok: false,
        refusal: {
          code: "bad-entry",
          atIndex: index,
          detail: `Entry ${index} is neither a Spades move nor an undo.`,
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
    board = stepSpades(seed, board, entry);
  }
  return { ok: true, fold: { board, pending } };
}

/**
 * Whether a move is legal in a board — the rules themselves, in one place, which
 * `spadesMoves` enumerates and `applySpades`, the fold and `isSpadesMoveLegal` all
 * ask.
 */
function isMoveLegalOn(board: SpadesBoard, move: SpadesMove): boolean {
  if (board.phase === "complete") return false;
  if (board.phase === "bidding") return move.kind === "bid";
  return move.kind === "play" && canPlay(board, playingSeat(board), move.card);
}

function stepSpades(seed: number, board: SpadesBoard, move: SpadesMove): SpadesBoard {
  if (move.kind === "bid") {
    const seat = biddingSeat(board);
    const bids = board.bids.map((bid, index) => (index === seat ? move.bid : bid));
    if (bids.some((bid) => bid === null)) return { ...board, bids };
    return {
      ...board,
      bids,
      phase: "playing",
      leader: (board.dealer + 1) % SPADES_SEATS,
      trick: [],
    };
  }

  const seat = playingSeat(board);
  const hands = board.hands.map((hand, index) =>
    index === seat ? hand.filter((card) => !sameCard(card, move.card)) : hand,
  );
  const trick = [...board.trick, { seat, card: move.card }];
  const spadesBroken = board.spadesBroken || move.card.suit === "spades";
  if (trick.length < SPADES_SEATS) return { ...board, hands, trick, spadesBroken };

  const winner = trickWinner(trick);
  const taken = board.taken.map((pile, index) =>
    index === winner ? [...pile, ...trick.map((played) => played.card)] : pile,
  );
  const played: SpadesBoard = {
    ...board,
    hands,
    trick: [],
    spadesBroken,
    leader: winner,
    tricksPlayed: board.tricksPlayed + 1,
    taken,
  };
  if (!hands.every((hand) => hand.length === 0)) return played;
  return scoreDeal(seed, played);
}

/**
 * The deal's score, the bags, and the next deal — or the end of the game. Nil is
 * settled per seat and the contract per partnership, in that order, because the
 * article's table says a bonus „does not affect and is not affected by any other
 * bonus or penalty, or the contract score".
 */
function scoreDeal(seed: number, board: SpadesBoard): SpadesBoard {
  const scores = [...board.scores];
  const bags = [...board.bags];
  for (const partnership of [0, 1]) {
    const contract = spadesContract(board, partnership);
    const tricks = spadesPartnershipTricks(board, partnership);
    if (tricks >= contract) {
      scores[partnership] = (scores[partnership] ?? 0) + 10 * contract + (tricks - contract);
      bags[partnership] = (bags[partnership] ?? 0) + (tricks - contract);
    } else {
      scores[partnership] = (scores[partnership] ?? 0) - 10 * contract;
    }
    while ((bags[partnership] ?? 0) >= SPADES_BAGS_PER_PENALTY) {
      bags[partnership] = (bags[partnership] ?? 0) - SPADES_BAGS_PER_PENALTY;
      scores[partnership] = (scores[partnership] ?? 0) + SPADES_BAG_PENALTY;
    }
  }
  board.bids.forEach((bid, seat) => {
    if (bid !== 0) return;
    const partnership = spadesPartnerOf(seat);
    const took = board.taken[seat]?.length ?? 0;
    scores[partnership] =
      (scores[partnership] ?? 0) + (took === 0 ? SPADES_NIL_BONUS : -SPADES_NIL_BONUS);
  });

  const over = scores.map((total) => total >= SPADES_TARGET || total <= SPADES_LOSS);
  if (over[0] === true || over[1] === true) {
    if ((scores[0] ?? 0) !== (scores[1] ?? 0)) {
      return { ...board, scores, bags, phase: "complete" };
    }
  }
  return dealtBoard(seed, board.deal + 1, scores, bags);
}

function dealtBoard(
  seed: number,
  deal: number,
  scores: readonly number[],
  bags: readonly number[],
): SpadesBoard {
  const deck = shuffled(standardDeck(), dealRandom(seed, deal));
  const dealer = deal % SPADES_SEATS;
  const hands = seatOrder(SPADES_SEATS).map((seat) =>
    sortHand(deck.slice(seat * SPADES_HAND, (seat + 1) * SPADES_HAND)),
  );
  return {
    deal,
    dealer,
    phase: "bidding",
    hands,
    bids: seatOrder(SPADES_SEATS).map(() => null),
    trick: [],
    leader: (dealer + 1) % SPADES_SEATS,
    tricksPlayed: 0,
    spadesBroken: false,
    taken: seatOrder(SPADES_SEATS).map(() => []),
    scores,
    bags,
  };
}

/** The seat to bid: the article's order — to the dealer's left, clockwise, ending with the dealer. */
function biddingSeat(board: SpadesBoard): number {
  for (let step = 0; step < SPADES_SEATS; step += 1) {
    const seat = (board.dealer + 1 + step) % SPADES_SEATS;
    if (board.bids[seat] === null) return seat;
  }
  // Unreachable: the phase leaves `bidding` as the fourth bid lands.
  return board.dealer;
}

/** Whose turn it is to play: the trick's leader, then the seats after whoever just played. */
function playingSeat(board: SpadesBoard): number {
  const last = board.trick[board.trick.length - 1];
  return last === undefined ? board.leader : (last.seat + 1) % SPADES_SEATS;
}

/** The highest card of the suit led, unless a spade fell — then the highest spade. */
function trickWinner(trick: readonly SpadesTrickCard[]): number {
  const led = trick[0]!;
  const spades = trick.filter((played) => played.card.suit === "spades");
  if (spades.length > 0 && led.card.suit !== "spades") {
    return spades.reduce((best, played) =>
      rankStrength(played.card.rank) > rankStrength(best.card.rank) ? played : best,
    ).seat;
  }
  let winner = led;
  for (const played of trick) {
    if (
      played.card.suit === led.card.suit &&
      rankStrength(played.card.rank) > rankStrength(winner.card.rank)
    ) {
      winner = played;
    }
  }
  return winner.seat;
}

/**
 * Whether a seat may play a card: follow the suit that was led if it can, and a
 * spade may not be LED until spades are broken — the article's „common variant
 * rule, borrowed from Hearts", which this module implements on purpose.
 */
function canPlay(board: SpadesBoard, seat: number, card: Card): boolean {
  const hand = board.hands[seat] ?? [];
  if (!hand.some((held) => sameCard(held, card))) return false;
  const led = board.trick[0]?.card.suit;
  if (led === undefined) {
    if (card.suit !== "spades") return true;
    return board.spadesBroken || hand.every((held) => held.suit === "spades");
  }
  if (card.suit === led) return true;
  return !hand.some((held) => held.suit === led);
}

function bidRange(): number[] {
  return Array.from({ length: SPADES_TRICKS + 1 }, (_, index) => index);
}

function sortHand(hand: readonly Card[]): Card[] {
  return [...hand].sort(
    (left, right) =>
      SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit) ||
      rankStrength(right.rank) - rankStrength(left.rank),
  );
}

function seatOrder(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
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
export interface SpadesLevel {
  readonly level: CardOpponentLevel;
  /** Determinizations the hard level averages over; the two rungs below it sample none. */
  readonly samples: number;
  /** A soft ceiling in milliseconds for one move's worth of sampling; zero means no clock, which is what a test wants. */
  readonly timeMs: number;
}

/**
 * The three rungs, this project's own numbers: `hard` samples twelve unseen-card
 * deals per move and stops early if the clock says so, so a slower machine plays
 * a little worse rather than stalling the table.
 */
export const SPADES_LEVELS: readonly SpadesLevel[] = [
  { level: "easy", samples: 0, timeMs: 0 },
  { level: "medium", samples: 0, timeMs: 0 },
  { level: "hard", samples: 12, timeMs: 30 },
];

export function spadesLevel(level: CardOpponentLevel): SpadesLevel {
  const config = SPADES_LEVELS.find((candidate) => candidate.level === level);
  if (config === undefined) throw new CardGameError(`"${level}" is not an opponent level.`);
  return config;
}

export interface SpadesChooserOptions {
  /** An injected clock, so the engine stays pure and a test can measure it. Omitted means no deadline. */
  readonly now?: () => number;
}

/**
 * The move one of the four seats plays at `level`, always one `spadesMoves`
 * offered — every rung picks out of the enumeration rather than building a move
 * of its own.
 */
export function spadesChooseMove(
  state: SpadesState,
  level: CardOpponentLevel,
  random: SeededRandom,
  options: SpadesChooserOptions = {},
): SpadesMove {
  const config = spadesLevel(level);
  const moves = spadesMoves(state);
  if (moves.length === 0) {
    throw new CardGameError("There is no move to choose: this game is over.");
  }
  if (config.level === "easy") return moves[randomBelow(random, moves.length)]!;

  const board = state.board;
  const seat = spadesToAct(state);
  if (board.phase === "bidding") {
    // A bid is a statement about the whole hand rather than a choice in a trick,
    // so the sampling that makes `hard` hard has nothing to sample: every rung
    // above easy bids the hand's own count.
    return { kind: "bid", bid: mediumBid(board, seat) };
  }
  const card =
    config.level === "medium"
      ? mediumPlayCard(board, seat)
      : hardPlayCard(board, seat, random, config, options);
  return { kind: "play", card };
}

/**
 * A hand's own count: the trump suit pays for every spade from the ten up and for
 * a fifth spade, a side suit pays for its ace, for its king when the suit is not
 * bare, and for a fifth card when the ace is there to run it. A count of zero is
 * the article's nil.
 */
function mediumBid(board: SpadesBoard, seat: number): number {
  const hand = board.hands[seat] ?? [];
  let tricks = 0;
  for (const suit of SUITS) {
    const cards = hand.filter((card) => card.suit === suit);
    const count = cards.length;
    if (count === 0) continue;
    const hasAce = cards.some((card) => card.rank === 1);
    if (suit === "spades") {
      tricks += cards.filter((card) => rankStrength(card.rank) >= 10).length;
      if (count >= 5) tricks += 1;
      continue;
    }
    if (hasAce) tricks += 1;
    if (cards.some((card) => card.rank === 13) && (hasAce || count >= 3)) tricks += 1;
    if (hasAce && count >= 5) tricks += 1;
  }
  return Math.max(0, Math.min(SPADES_TRICKS, tricks));
}

/** The card the medium rule plays for `seat`, which is always one of the legal ones. */
function mediumPlayCard(board: SpadesBoard, seat: number): Card {
  const legal = (board.hands[seat] ?? []).filter((card) => canPlay(board, seat, card));
  const first = legal[0];
  if (first === undefined) {
    // Unreachable: following suit can always be done with a card the seat holds.
    throw new CardGameError(`Seat ${seat} has no legal card to play.`);
  }
  const partnership = spadesPartnerOf(seat);
  const need = spadesContract(board, partnership) - spadesPartnershipTricks(board, partnership);
  const led = board.trick[0]?.card.suit;
  if (led === undefined) return mediumLeadCard(board, seat, legal);

  const following = legal.filter((card) => card.suit === led);
  if (following.length > 0) {
    if (need <= 0) return leastBy(following, (card) => rankStrength(card.rank));
    const winners = following.filter((card) => wouldWin(board.trick, card, seat));
    return leastBy(winners.length > 0 ? winners : following, (card) => rankStrength(card.rank));
  }

  // Void in the suit led: trump in while the partnership still owes tricks, and
  // otherwise throw the lowest card away.
  const winners = legal.filter((card) => wouldWin(board.trick, card, seat));
  if (need > 0 && winners.length > 0) return leastBy(winners, (card) => rankStrength(card.rank));
  return leastBy(legal, (card) => rankStrength(card.rank));
}

/** Leading: cash a trump once they are broken and the hand holds a few, else the lowest card of the longest side suit. */
function mediumLeadCard(board: SpadesBoard, seat: number, legal: readonly Card[]): Card {
  const hand = board.hands[seat] ?? [];
  const spades = legal.filter((card) => card.suit === "spades");
  if (board.spadesBroken && spades.length >= 2) {
    return leastBy(spades, (card) => -rankStrength(card.rank));
  }
  const side = legal.filter((card) => card.suit !== "spades");
  if (side.length === 0) return leastBy(legal, (card) => rankStrength(card.rank));
  const longest = SUITS.filter((suit) => suit !== "spades").reduce((best, suit) => {
    const length = hand.filter((card) => card.suit === suit).length;
    const bestLength = hand.filter((card) => card.suit === best).length;
    return length > bestLength ? suit : best;
  });
  const candidates = side.filter((card) => card.suit === longest);
  return leastBy(candidates.length > 0 ? candidates : side, (card) => rankStrength(card.rank));
}

/**
 * The hard level: for each legal card, average the trick's outcome over a handful
 * of unseen-card deals and play the best. The samples come from `unseenCards`,
 * which is the deck minus the acting seat's own hand minus everything already
 * played, so the search is over the opponents' hands rather than inside them.
 */
function hardPlayCard(
  board: SpadesBoard,
  seat: number,
  random: SeededRandom,
  config: SpadesLevel,
  options: SpadesChooserOptions,
): Card {
  const legal = (board.hands[seat] ?? []).filter((card) => canPlay(board, seat, card));
  const only = legal[0];
  if (only === undefined) throw new CardGameError(`Seat ${seat} has no legal card to play.`);
  if (legal.length === 1) return only;

  const pool = unseenCards(board, seat);
  const totals = new Map<string, number>();
  for (const card of legal) totals.set(cardCode(card), 0);
  const deadline = options.now === undefined || config.timeMs === 0 ? null : options.now() + config.timeMs;

  let samples = 0;
  for (let sample = 0; sample < config.samples; sample += 1) {
    if (deadline !== null && (options.now?.() ?? 0) >= deadline) break;
    const sampled = sampleBoard(board, seat, pool, random);
    for (const card of legal) {
      const key = cardCode(card);
      totals.set(key, (totals.get(key) ?? 0) + trickScore(sampled, seat, card));
    }
    samples += 1;
  }
  if (samples === 0) return mediumPlayCard(board, seat);

  let best = legal[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const card of legal) {
    const average = (totals.get(cardCode(card)) ?? 0) / samples;
    if (average > bestScore) {
      bestScore = average;
      best = card;
    }
  }
  return best;
}

/**
 * What one card is worth to `seat`: the trick it leads to is played out with the
 * medium rule, a trick the partnership takes is worth ten points while it still
 * owes its contract and a trick it loses the same, and what the seat still holds
 * afterwards separates two moves whose tricks cost the same.
 */
function trickScore(sampled: SpadesBoard, seat: number, card: Card): number {
  const { trick, board } = playOutTrick(sampled, seat, card);
  const winner = trickWinner(trick);
  const partnership = spadesPartnerOf(seat);
  const ours = spadesPartnerOf(winner) === partnership;
  const need = spadesContract(board, partnership) - spadesPartnershipTricks(board, partnership);
  const value = need > 0 ? (ours ? 10 : -10) : ours ? 1 : -1;
  return value + positionScore(board, seat);
}

/** The rest of the trick, played out with the medium rule for every seat that follows. */
function playOutTrick(
  sampled: SpadesBoard,
  seat: number,
  card: Card,
): { readonly trick: readonly SpadesTrickCard[]; readonly board: SpadesBoard } {
  let board = sampled;
  let mover = seat;
  let next = card;
  const trick: SpadesTrickCard[] = [];
  while (board.trick.length < SPADES_SEATS) {
    trick.push({ seat: mover, card: next });
    board = {
      ...board,
      hands: board.hands.map((hand, index) =>
        index === mover ? hand.filter((held) => !sameCard(held, next)) : hand,
      ),
      trick: [...board.trick, { seat: mover, card: next }],
      spadesBroken: board.spadesBroken || next.suit === "spades",
    };
    if (board.trick.length === SPADES_SEATS) break;
    mover = playingSeat(board);
    next = mediumPlayCard(board, mover);
  }
  return { trick, board };
}

/**
 * How much strength the seat still holds, scaled down so that it only ever
 * separates two moves whose tricks are worth the same. This is a heuristic and
 * says so: with spades always trump, a hand that keeps its high cards keeps its
 * chances of taking the tricks a contract still needs.
 */
function positionScore(board: SpadesBoard, seat: number): number {
  const strength = (board.hands[seat] ?? []).reduce(
    (total, card) => total + rankStrength(card.rank),
    0,
  );
  return strength / 100;
}

/** Whether `card`, played by `seat`, would take the trick as it stands. */
function wouldWin(trick: readonly SpadesTrickCard[], card: Card, seat: number): boolean {
  return trickWinner([...trick, { seat, card }]) === seat;
}

/**
 * The deck minus the acting seat's own hand minus every card already played — the
 * pool the other hands are sampled from. It is deliberately the only thing the
 * hard level reads about the other seats.
 */
function unseenCards(board: SpadesBoard, seat: number): Card[] {
  const mine = board.hands[seat] ?? [];
  const played = [
    ...board.taken.flatMap((pile) => [...pile]),
    ...board.trick.map((entry) => entry.card),
  ];
  return standardDeck().filter(
    (card) =>
      !mine.some((held) => sameCard(held, card)) &&
      !played.some((seen) => sameCard(seen, card)),
  );
}

/** A hypothetical table: the acting seat's hand is real, the other three are dealt the unseen pool. */
function sampleBoard(
  board: SpadesBoard,
  seat: number,
  pool: readonly Card[],
  random: SeededRandom,
): SpadesBoard {
  const deck = shuffled(pool, random);
  let at = 0;
  const hands = board.hands.map((hand, index) => {
    if (index === seat) return hand;
    const dealt = deck.slice(at, at + hand.length);
    at += hand.length;
    return sortHand(dealt);
  });
  return { ...board, hands };
}

/** The least of `cards` by `score`; ties keep the earlier card, so a choice is deterministic. */
function leastBy(cards: readonly Card[], score: (card: Card) => number): Card {
  let best = cards[0]!;
  let bestScore = score(best);
  for (const card of cards) {
    const value = score(card);
    if (value < bestScore) {
      bestScore = value;
      best = card;
    }
  }
  return best;
}
