/**
 * Hearts for four players, played to a hundred points, with the three opponents
 * the brief asks for.
 *
 * The rules are the article's (https://en.wikipedia.org/wiki/Hearts_(card_game)
 * § Passing, § Playing and § Scoring): a standard pack, thirteen cards each, three
 * cards passed to another player in a cycle that changes every deal — left, then
 * right, then across, then no pass at all — the player who leads must be followed
 * in suit, the highest card of the led suit takes the trick and leads the next,
 * every heart is a penalty point and the queen of spades is thirteen, a heart may
 * not be led until another heart has been played off-suit („breaking Hearts"), and
 * a penalty card may not be played to the first trick. A player who takes every
 * penalty card has shot the moon: the article offers two settlements, and the one
 * implemented here is „add it to every other player's score", which keeps a
 * running total a thing that only grows. The game ends the deal somebody reaches
 * a hundred, and the lowest total wins.
 *
 * **Seat 0 is the person and the other three are the computer's.** Every rule here
 * is symmetric and the state names a seat wherever a rule needs one, but the level
 * ladder only ever plays seats 1, 2 and 3 — the seat to act is the position's own
 * next player (`heartsToAct`), so a move never carries one.
 *
 * **The opponents only see what a person sees.** The three levels are
 * `CARD_OPPONENT_LEVELS`: `easy` plays a uniformly random legal move, `medium`
 * plays this module's rules of thumb — ducking under the trick, sloughing the
 * queen of spades or a high heart when void, dodging a suit while the queen is
 * still out — and `hard` plays a bounded search: for each legal card it samples
 * the cards it has not seen, plays the rest of the trick out with the medium rule,
 * and picks the card with the best average. The sampling draws from the unseen
 * pool only, never from the hands it is not allowed to look at, so a „hard"
 * opponent is informed rather than clairvoyant.
 *
 * A state is a pure function of `(variant, seed, log)`: `initial` is the first
 * deal, every later deal is shuffled from `(seed, deal index)` by `deal.ts`, and an
 * illegal log is refused rather than repaired.
 */

import {
  cardCode,
  rankStrength,
  sameCard,
  standardDeck,
  SUITS,
  type Card,
  type Rank,
  type Suit,
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
  type HeartsVariant,
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

export const HEARTS_SEATS = 4;
export const HEARTS_HAND = 13;
/** The article's own ending: „when one player reaches an agreed ending score, such as 100 points". */
export const HEARTS_TARGET = 100;
/** Every penalty card in one deal: thirteen hearts and the queen of spades. */
export const HEARTS_MOON = 26;
const QUEEN_OF_SPADES: Rank = 12;
/** How many cards a seat passes. */
const PASS_SIZE = 3;

/** Where a deal's three cards go; „hold" is the deal nobody passes. */
export type HeartsPassDirection = "left" | "right" | "across" | "hold";

/**
 * The cycle the article describes — „a predetermined cycle that changes each
 * hand" — spelled out: left, right, across, hold, and round again.
 */
export const HEARTS_PASS_CYCLE: readonly HeartsPassDirection[] = ["left", "right", "across", "hold"];

/** One card as it fell in the trick in play. */
export interface HeartsTrickCard {
  readonly seat: number;
  readonly card: Card;
}

export interface HeartsBoard {
  /** Which deal of the game this is, counting from zero; the dealer and the pass direction follow it. */
  readonly deal: number;
  readonly dealer: number;
  readonly phase: "passing" | "playing" | "complete";
  /** Each seat's hand, in a fixed suit-then-rank order so a saved game reads the same twice. */
  readonly hands: readonly (readonly Card[])[];
  /** What each seat has put aside to pass; empty while that seat has not chosen yet. */
  readonly passed: readonly (readonly Card[])[];
  /** The trick in play, in the order the cards fell; empty between tricks. */
  readonly trick: readonly HeartsTrickCard[];
  /** The seat that led (or is leading) the trick in play. */
  readonly leader: number;
  /** How many tricks of this deal are finished; the first trick has a rule of its own. */
  readonly tricksPlayed: number;
  readonly heartsBroken: boolean;
  /** Cards each seat has taken in tricks this deal; the deal's points are read off it. */
  readonly taken: readonly (readonly Card[])[];
  /** Running totals, one per seat; a deal's points are added when it ends. */
  readonly scores: readonly number[];
}

export type HeartsMove =
  /** The three cards a seat passes. The four passes of a deal are logged in seat order. */
  | { readonly kind: "pass"; readonly cards: readonly Card[] }
  /** One card played to the trick in play. */
  | { readonly kind: "play"; readonly card: Card };

export interface HeartsState {
  readonly variant: HeartsVariant;
  readonly seed: number;
  readonly initial: HeartsBoard;
  readonly board: HeartsBoard;
  readonly log: readonly GameLogEntry<HeartsMove>[];
}

export type HeartsReplay = CardGameReplay<HeartsState>;

interface HeartsFrame {
  readonly move: HeartsMove;
  readonly board: HeartsBoard;
}

interface HeartsFold {
  readonly board: HeartsBoard;
  readonly pending: readonly HeartsFrame[];
}

/** Deals the first hand of a game. Throws for a variant or a seed nobody could have meant. */
export function dealHearts(variant: HeartsVariant, seed: number): HeartsState {
  if (!isCardGameVariant("hearts", variant)) {
    throw new CardGameError(`"${variant}" is not a Hearts variant.`);
  }
  if (!isCardSeed(seed)) {
    throw new CardGameError(`A Hearts seed must be a 32-bit unsigned integer, got ${seed}.`);
  }
  const initial = dealtBoard(seed, 0, emptyScores());
  return { variant, seed, initial, board: initial, log: [] };
}

/** Rebuilds the state a saved `(variant, seed, log)` describes, or says why it cannot be one. */
export function replayHearts(variant: HeartsVariant, seed: number, log: unknown): HeartsReplay {
  if (!isCardGameVariant("hearts", variant)) {
    return {
      ok: false,
      refusal: {
        code: "unknown-variant",
        atIndex: null,
        detail: `"${variant}" is not a Hearts variant.`,
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
  const initial = dealtBoard(seed, 0, emptyScores());
  const folded = foldHearts(seed, initial, log as readonly unknown[]);
  if (!folded.ok) return { ok: false, refusal: folded.refusal };
  return {
    ok: true,
    state: {
      variant,
      seed,
      initial,
      board: folded.fold.board,
      log: log as readonly GameLogEntry<HeartsMove>[],
    },
  };
}

export function isHeartsMove(value: unknown): value is HeartsMove {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; cards?: unknown; card?: unknown };
  if (candidate.kind === "pass") {
    const { cards } = candidate;
    return Array.isArray(cards) && cards.length === PASS_SIZE && cards.every(isCardShape);
  }
  return candidate.kind === "play" && isCardShape(candidate.card);
}

export function isHeartsEntry(value: unknown): value is GameLogEntry<HeartsMove> {
  return isGameLogEntry(value, isHeartsMove);
}

/** The seat whose move it is, or -1 when the game is over. */
export function heartsToAct(state: HeartsState): number {
  if (state.board.phase === "complete") return -1;
  if (state.board.phase === "passing") return passingSeat(state.board);
  return playingSeat(state.board);
}

/**
 * Every move the position allows. During the pass that is every three-card
 * combination of the passer's hand; during play it is every card that follows the
 * suit and the two leading rules; when the game is over it is nothing.
 */
export function heartsMoves(state: HeartsState): HeartsMove[] {
  const board = state.board;
  if (board.phase === "complete") return [];
  if (board.phase === "passing") {
    const seat = passingSeat(board);
    return combinations(board.hands[seat] ?? [], PASS_SIZE).map((cards) => ({ kind: "pass", cards }));
  }
  const seat = playingSeat(board);
  return (board.hands[seat] ?? [])
    .filter((card) => canPlay(board, seat, card))
    .map((card) => ({ kind: "play", card }));
}

export function isHeartsMoveLegal(state: HeartsState, move: HeartsMove): boolean {
  return isHeartsMove(move) && isMoveLegalOn(state.board, move);
}

export function hasHeartsMoves(state: HeartsState): boolean {
  return heartsMoves(state).length > 0;
}

export function applyHearts(state: HeartsState, move: HeartsMove): HeartsState {
  if (!isHeartsMove(move)) {
    throw new IllegalMoveError(`Not a Hearts move: ${JSON.stringify(move)}.`);
  }
  if (!isMoveLegalOn(state.board, move)) {
    throw new IllegalMoveError("That move is not legal in the position it was played from.");
  }
  // Stepped, not folded: a game is hundreds of moves long and folding the whole
  // log per move is quadratic, which a thousand games notice. `undoHearts` and
  // `replayHearts` still fold, so the two paths have to agree — and they do,
  // because both validate with `isMoveLegalOn` and both step with `stepHearts`.
  return { ...state, board: stepHearts(state.seed, state.board, move), log: logPushMove(state.log, move) };
}

export function canUndoHearts(state: HeartsState): boolean {
  return logCanUndo(state.log);
}

/** Takes back one move; undoing a pass takes the three cards back together. */
export function undoHearts(state: HeartsState): HeartsState {
  if (!canUndoHearts(state)) {
    throw new IllegalMoveError("Nothing left to undo in this game.");
  }
  const log = logPushUndo(state.log);
  const folded = foldHearts(state.seed, state.initial, log);
  if (!folded.ok) throw new IllegalMoveError(folded.refusal.detail);
  return { ...state, board: folded.fold.board, log };
}

/**
 * Whether the person won the game: it is over and seat 0's total is strictly
 * lower than every other seat's. A tie is not a win — „the winner is the player
 * with the lowest score", and two lowest scores are two winners.
 */
export function isHeartsWon(state: HeartsState): boolean {
  const { phase, scores } = state.board;
  const mine = scores[0];
  if (phase !== "complete" || mine === undefined) return false;
  return scores.every((value, seat) => seat === 0 || value > mine);
}

/** The deal's points per seat before the moon is settled — what a screen shows when a deal ends. */
export function heartsDealPoints(board: HeartsBoard): readonly number[] {
  return board.taken.map(
    (pile) =>
      pile.filter((card) => card.suit === "hearts").length +
      (pile.some((card) => card.suit === "spades" && card.rank === QUEEN_OF_SPADES) ? 13 : 0),
  );
}

/**
 * The whole game, from the first deal to the last. Every deal's shuffle is
 * `(seed, deal)` and every seat's total is carried forward, so the fold and a live
 * game cannot disagree about which deal is being played.
 */
function foldHearts(
  seed: number,
  initial: HeartsBoard,
  log: readonly unknown[],
): { ok: true; fold: HeartsFold } | { ok: false; refusal: CardGameRefusal } {
  let board = initial;
  const pending: HeartsFrame[] = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (!isHeartsEntry(entry)) {
      return {
        ok: false,
        refusal: {
          code: "bad-entry",
          atIndex: index,
          detail: `Entry ${index} is neither a Hearts move nor an undo.`,
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
    board = stepHearts(seed, board, entry);
  }
  return { ok: true, fold: { board, pending } };
}

/** One move applied to a board, with the deal's own transition at the end of a hand. */
function stepHearts(seed: number, board: HeartsBoard, move: HeartsMove): HeartsBoard {
  return move.kind === "pass" ? stepPass(board, move) : stepPlay(seed, board, move);
}

/**
 * Whether a move is legal in a board — the rules themselves, in one place, which
 * `heartsMoves` enumerates and `applyHearts`, the fold and `isHeartsMoveLegal` all
 * ask. Two statements of the same rule is how „legal for the button, refused by
 * the engine" happens, so there is one.
 */
function isMoveLegalOn(board: HeartsBoard, move: HeartsMove): boolean {
  if (board.phase === "complete") return false;
  if (board.phase === "passing") {
    if (move.kind !== "pass") return false;
    const hand = board.hands[passingSeat(board)] ?? [];
    return move.cards.every((card) => hand.some((held) => sameCard(held, card)));
  }
  if (move.kind !== "play") return false;
  return canPlay(board, playingSeat(board), move.card);
}

/**
 * One seat's three cards. The four choices are logged in seat order and the swap
 * happens when the fourth arrives, because that is what the four players actually
 * do: they choose at once, and no seat sees what it is given until it has given
 * its own away.
 */
function stepPass(board: HeartsBoard, move: HeartsMove & { kind: "pass" }): HeartsBoard {
  const seat = passingSeat(board);
  const hands = board.hands.map((hand, index) =>
    index === seat ? hand.filter((card) => !move.cards.some((given) => sameCard(given, card))) : hand,
  );
  const passed = board.passed.map((cards, index) => (index === seat ? move.cards : cards));
  if (!passed.every((cards) => cards.length === PASS_SIZE)) return { ...board, hands, passed };

  const direction = HEARTS_PASS_CYCLE[board.deal % HEARTS_PASS_CYCLE.length]!;
  const offset =
    direction === "left" ? 1 : direction === "right" ? HEARTS_SEATS - 1 : HEARTS_SEATS / 2;
  const received = hands.map((hand, index) => [
    ...hand,
    ...(passed[(index - offset + HEARTS_SEATS) % HEARTS_SEATS] ?? []),
  ]);
  return startPlaying(board, received.map(sortHand));
}

function startPlaying(board: HeartsBoard, hands: readonly (readonly Card[])[]): HeartsBoard {
  return {
    ...board,
    hands,
    passed: hands.map(() => []),
    phase: "playing",
    leader: (board.dealer + 1) % HEARTS_SEATS,
    trick: [],
    tricksPlayed: 0,
  };
}

function stepPlay(seed: number, board: HeartsBoard, move: HeartsMove & { kind: "play" }): HeartsBoard {
  const seat = playingSeat(board);
  const hands = board.hands.map((hand, index) =>
    index === seat ? hand.filter((card) => !sameCard(card, move.card)) : hand,
  );
  const trick = [...board.trick, { seat, card: move.card }];
  const heartsBroken = board.heartsBroken || move.card.suit === "hearts";
  if (trick.length < HEARTS_SEATS) return { ...board, hands, trick, heartsBroken };

  const winner = trickWinner(trick);
  const taken = board.taken.map((pile, index) =>
    index === winner ? [...pile, ...trick.map((played) => played.card)] : pile,
  );
  const played: HeartsBoard = {
    ...board,
    hands,
    trick: [],
    heartsBroken,
    leader: winner,
    tricksPlayed: board.tricksPlayed + 1,
    taken,
  };
  if (!hands.every((hand) => hand.length === 0)) return played;
  return scoreDeal(seed, played);
}

/** The deal's points, the moon's settlement, and the next deal — or the end of the game. */
function scoreDeal(seed: number, board: HeartsBoard): HeartsBoard {
  const points = heartsDealPoints(board);
  const shooter = points.findIndex((value) => value === HEARTS_MOON);
  const scores = board.scores.map((total, seat) => {
    if (shooter === -1) return total + (points[seat] ?? 0);
    return seat === shooter ? total : total + HEARTS_MOON;
  });
  if (scores.some((total) => total >= HEARTS_TARGET)) {
    return { ...board, scores, phase: "complete" };
  }
  return dealtBoard(seed, board.deal + 1, scores);
}

/** The deal: thirteen cards each from the deal's own shuffle, and the pass skipped when the deal holds. */
function dealtBoard(seed: number, deal: number, scores: readonly number[]): HeartsBoard {
  const deck = shuffled(standardDeck(), dealRandom(seed, deal));
  const dealer = deal % HEARTS_SEATS;
  const hands = seatOrder(HEARTS_SEATS).map((seat) =>
    sortHand(deck.slice(seat * HEARTS_HAND, (seat + 1) * HEARTS_HAND)),
  );
  const direction = HEARTS_PASS_CYCLE[deal % HEARTS_PASS_CYCLE.length]!;
  const board: HeartsBoard = {
    deal,
    dealer,
    phase: direction === "hold" ? "playing" : "passing",
    hands,
    passed: seatOrder(HEARTS_SEATS).map(() => []),
    trick: [],
    leader: (dealer + 1) % HEARTS_SEATS,
    tricksPlayed: 0,
    heartsBroken: false,
    taken: seatOrder(HEARTS_SEATS).map(() => []),
    scores,
  };
  return board;
}

/** The seat that has not chosen its pass yet, in seat order. Only called while the phase is `passing`. */
function passingSeat(board: HeartsBoard): number {
  const seat = board.passed.findIndex((cards) => cards.length === 0);
  return seat === -1 ? 0 : seat;
}

/** Whose turn it is to play a card: the trick's leader, then the seats in order after whoever just played. */
function playingSeat(board: HeartsBoard): number {
  const last = board.trick[board.trick.length - 1];
  return last === undefined ? board.leader : (last.seat + 1) % HEARTS_SEATS;
}

/** The highest card of the suit that was led. Hearts has no trump. */
function trickWinner(trick: readonly HeartsTrickCard[]): number {
  const led = trick[0]!;
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
 * Whether a seat may play a card. Three rules, in the order they are told: follow
 * the suit that was led if you can; a heart may not be LED until hearts are broken
 * or the hand holds nothing else; and a penalty card may not be DISCARDED on the
 * first trick.
 *
 * **The last rule is about discards, not about following suit**, and the
 * distinction is not pedantry: a first trick led in spades forces every seat to
 * follow with a spade, and the seat holding the queen of spades alone would have
 * no legal card at all — the engine has no move to offer and the deal cannot be
 * played. Following suit is mandatory and wins, so the penalty rule is read as
 * the article's „a penalty card may not be played to the first trick" that has
 * always meant in play: you may not throw one away there.
 */
function canPlay(board: HeartsBoard, seat: number, card: Card): boolean {
  const hand = board.hands[seat] ?? [];
  if (!hand.some((held) => sameCard(held, card))) return false;
  const onlyPenalty = hand.every(isPenalty);
  const bannedPenalty = board.tricksPlayed === 0 && !onlyPenalty;

  const led = board.trick[0]?.card.suit;
  if (led === undefined) {
    if (bannedPenalty && isPenalty(card)) return false;
    if (card.suit !== "hearts") return true;
    return board.heartsBroken || hand.every((held) => held.suit === "hearts");
  }
  // Must follow suit, whichever card that is: the penalty rule never outranks it.
  if (hand.some((held) => held.suit === led)) return card.suit === led;
  return !(bannedPenalty && isPenalty(card));
}

function isPenalty(card: Card): boolean {
  return card.suit === "hearts" || (card.suit === "spades" && card.rank === QUEEN_OF_SPADES);
}

/** The suit-then-strength order a hand is kept in: Ace first, Two last, so a saved game reads back the same. */
function sortHand(hand: readonly Card[]): Card[] {
  return [...hand].sort(
    (left, right) =>
      SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit) ||
      rankStrength(right.rank) - rankStrength(left.rank),
  );
}

function emptyScores(): number[] {
  return seatOrder(HEARTS_SEATS).map(() => 0);
}

function seatOrder(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function combinations(hand: readonly Card[], size: number): Card[][] {
  const out: Card[][] = [];
  const pick: Card[] = [];
  const walk = (start: number): void => {
    if (pick.length === size) {
      out.push([...pick]);
      return;
    }
    for (let index = start; index < hand.length; index += 1) {
      pick.push(hand[index]!);
      walk(index + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

function isCardShape(value: unknown): value is Card {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { suit?: unknown; rank?: unknown };
  return isSuitShape(candidate.suit) && isRankShape(candidate.rank);
}

function isSuitShape(value: unknown): value is Suit {
  return (SUITS as readonly unknown[]).includes(value);
}

function isRankShape(value: unknown): value is Rank {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 13;
}

/** One rung of the ladder, and what it is allowed to spend. */
export interface HeartsLevel {
  readonly level: CardOpponentLevel;
  /** Determinizations the hard level averages over; the two rungs below it sample none. */
  readonly samples: number;
  /**
   * A soft ceiling in milliseconds for one move's worth of sampling. Zero means no
   * clock at all, which is what a test wants: the level's play is then a pure
   * function of the state and the seeded random, and a thousand games replay.
   */
  readonly timeMs: number;
}

/**
 * The three rungs. `hard` samples twelve unseen-card deals per move and stops
 * early if the clock says so — a soft ceiling, so a slower machine plays a little
 * worse rather than stalling the table. The numbers are this project's own,
 * measured on the development machine (see `hearts.test.ts`).
 */
export const HEARTS_LEVELS: readonly HeartsLevel[] = [
  { level: "easy", samples: 0, timeMs: 0 },
  { level: "medium", samples: 0, timeMs: 0 },
  { level: "hard", samples: 12, timeMs: 30 },
];

export function heartsLevel(level: CardOpponentLevel): HeartsLevel {
  const config = HEARTS_LEVELS.find((candidate) => candidate.level === level);
  if (config === undefined) throw new CardGameError(`"${level}" is not an opponent level.`);
  return config;
}

export interface HeartsChooserOptions {
  /** An injected clock, so the engine stays pure and a test can measure it. Omitted means no deadline. */
  readonly now?: () => number;
}

/**
 * The move one of the computer's seats plays at `level`. The move is always one
 * `heartsMoves` offered — every rung picks out of the enumeration rather than
 * building a move of its own, which is what makes „never illegal" one statement.
 */
export function heartsChooseMove(
  state: HeartsState,
  level: CardOpponentLevel,
  random: SeededRandom,
  options: HeartsChooserOptions = {},
): HeartsMove {
  const config = heartsLevel(level);
  const moves = heartsMoves(state);
  if (moves.length === 0) {
    throw new CardGameError("There is no move to choose: this game is over.");
  }
  if (config.level === "easy") return moves[randomBelow(random, moves.length)]!;

  const board = state.board;
  const seat = heartsToAct(state);
  if (board.phase === "passing") {
    // The pass is a choice about the whole hand, not about a trick, so the search
    // that makes `hard` hard has nothing to search: every rung above easy passes
    // the three most dangerous cards.
    return { kind: "pass", cards: mediumPass(board, seat) };
  }
  const card =
    config.level === "medium" ? mediumPlayCard(board, seat) : hardPlayCard(board, seat, random, config, options);
  return { kind: "play", card };
}

/**
 * The three cards a hand most wants rid of: the queen of spades first, then the
 * highest spades, then the highest hearts. The score is a danger ranking and
 * nothing more — a king of spades is a trick waiting to happen and an ace of
 * hearts is thirteen points waiting to be taken.
 */
function mediumPass(board: HeartsBoard, seat: number): readonly Card[] {
  const queenOut = queenOfSpadesPlayed(board);
  const hand = board.hands[seat] ?? [];
  return [...hand]
    .sort((left, right) => passDanger(right, queenOut) - passDanger(left, queenOut))
    .slice(0, PASS_SIZE);
}

function passDanger(card: Card, queenOut: boolean): number {
  if (card.suit === "spades" && card.rank === QUEEN_OF_SPADES) return queenOut ? 0 : 100;
  if (card.suit === "spades") return 60 + card.rank;
  if (card.suit === "hearts") return 40 + card.rank;
  return card.rank;
}

/** The card the medium rule plays for `seat`, which is always one of the legal ones. */
function mediumPlayCard(board: HeartsBoard, seat: number): Card {
  const legal = (board.hands[seat] ?? []).filter((card) => canPlay(board, seat, card));
  const first = legal[0];
  if (first === undefined) {
    // Unreachable: the seat to act always holds a legal card, because following
    // suit can always be done with a card it holds.
    throw new CardGameError(`Seat ${seat} has no legal card to play.`);
  }
  const led = board.trick[0]?.card.suit;
  if (led === undefined) return leadChoice(board, seat, legal);
  const following = legal.filter((card) => card.suit === led);
  if (following.length > 0) return duckChoice(board, led, following);
  return discardChoice(board, legal);
}

/** Leading: the least dangerous low card — never a heart unless it is all the hand holds. */
function leadChoice(board: HeartsBoard, seat: number, legal: readonly Card[]): Card {
  const queenOut = queenOfSpadesPlayed(board);
  const holdsQueen = (board.hands[seat] ?? []).some(
    (card) => card.suit === "spades" && card.rank === QUEEN_OF_SPADES,
  );
  return leastBy(legal, (card) => {
    if (card.suit === "hearts") return 40 + card.rank;
    if (card.suit === "spades") return (queenOut || holdsQueen ? 0 : 30) + card.rank;
    return card.rank;
  });
}

/** Following suit: duck under the trick if anything can, otherwise take it on the lowest card. */
function duckChoice(board: HeartsBoard, led: Suit, following: readonly Card[]): Card {
  let high = 0;
  for (const played of board.trick) {
    if (played.card.suit === led && played.card.rank > high) high = played.card.rank;
  }
  const below = following.filter((card) => card.rank < high);
  if (below.length > 0) return leastBy(below, (card) => -card.rank);
  return leastBy(following, (card) => card.rank);
}

/**
 * Void in the suit that was led: the trick cannot be won, so every card is free
 * and the best use of the turn is to throw the worst card in the hand — the queen
 * of spades if that is what the seat holds, else the highest heart, else the
 * highest card it has.
 */
function discardChoice(board: HeartsBoard, legal: readonly Card[]): Card {
  return leastBy(legal, (card) => -discardDanger(card));
}

function discardDanger(card: Card): number {
  if (card.suit === "spades" && card.rank === QUEEN_OF_SPADES) return 200;
  if (card.suit === "hearts") return 40 + card.rank;
  if (card.suit === "spades") return 50 + card.rank;
  return card.rank;
}

/**
 * The hard level: for each legal card, average the trick's outcome over a handful
 * of unseen-card deals and play the best. The samples come from `unseenCards`,
 * which is the deck minus the acting seat's own hand minus everything already
 * played, so the search is over the opponents' hands rather than inside them.
 */
function hardPlayCard(
  board: HeartsBoard,
  seat: number,
  random: SeededRandom,
  config: HeartsLevel,
  options: HeartsChooserOptions,
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

  // The legal order is fixed, so equal averages keep the earlier card rather than
  // depending on which sample happened to be drawn first.
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
 * What one card is worth to `seat`, averaged over nothing: the trick it leads to
 * is played out with the medium rule, the penalty the seat would take is
 * subtracted, and what the seat still holds afterwards is added as a small
 * preference among moves that cost the same.
 */
function trickScore(sampled: HeartsBoard, seat: number, card: Card): number {
  const { trick, board } = playOutTrick(sampled, seat, card);
  const winner = trickWinner(trick);
  return -(winner === seat ? trickPenalty(trick) : 0) + positionScore(board, seat);
}

/** What a finished trick is worth to whoever took it: a point a heart, thirteen for the queen. */
function trickPenalty(trick: readonly HeartsTrickCard[]): number {
  return trick.reduce(
    (total, played) =>
      total +
      (played.card.suit === "hearts"
        ? 1
        : played.card.suit === "spades" && played.card.rank === QUEEN_OF_SPADES
          ? 13
          : 0),
    0,
  );
}

/** The rest of the trick, played out with the medium rule for every seat that follows. */
function playOutTrick(
  sampled: HeartsBoard,
  seat: number,
  card: Card,
): { readonly trick: readonly HeartsTrickCard[]; readonly board: HeartsBoard } {
  let board = sampled;
  let mover = seat;
  let next = card;
  const trick: HeartsTrickCard[] = [];
  while (board.trick.length < HEARTS_SEATS) {
    trick.push({ seat: mover, card: next });
    board = {
      ...board,
      hands: board.hands.map((hand, index) =>
        index === mover ? hand.filter((held) => !sameCard(held, next)) : hand,
      ),
      trick: [...board.trick, { seat: mover, card: next }],
      heartsBroken: board.heartsBroken || next.suit === "hearts",
    };
    if (board.trick.length === HEARTS_SEATS) break;
    mover = playingSeat(board);
    next = mediumPlayCard(board, mover);
  }
  return { trick, board };
}

/**
 * How much of a liability a seat's own hand still is, negated and scaled down so
 * that it only ever separates two moves whose tricks cost the same. This is a
 * heuristic and says so: the queen is thirteen points if she is still out, a high
 * heart is half its rank, a high spade is a trick waiting to happen.
 */
function positionScore(board: HeartsBoard, seat: number): number {
  const queenOut = queenOfSpadesPlayed(board);
  const liability = (board.hands[seat] ?? []).reduce((total, card) => {
    if (card.suit === "spades" && card.rank === QUEEN_OF_SPADES) return total + (queenOut ? 0 : 13);
    if (card.suit === "hearts") return total + card.rank / 2;
    if (card.suit === "spades" && card.rank >= 13) return total + 3;
    return total;
  }, 0);
  return -liability / 10;
}

/** Whether the queen of spades has fallen: in a finished trick, or in the trick in play. */
function queenOfSpadesPlayed(board: HeartsBoard): boolean {
  const held = (card: Card): boolean => card.suit === "spades" && card.rank === QUEEN_OF_SPADES;
  return board.taken.some((pile) => pile.some(held)) || board.trick.some((played) => held(played.card));
}

/**
 * The deck minus the acting seat's own hand minus every card already played —
 * the pool the opponents' hands are sampled from. It is deliberately the only
 * thing the hard level reads about the other seats, which is what keeps the
 * opponent informed rather than clairvoyant.
 */
function unseenCards(board: HeartsBoard, seat: number): Card[] {
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
  board: HeartsBoard,
  seat: number,
  pool: readonly Card[],
  random: SeededRandom,
): HeartsBoard {
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
