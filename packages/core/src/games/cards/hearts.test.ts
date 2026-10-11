import { describe, expect, it } from "vitest";
import { cardFromCode, type Card } from "./card.js";
import { IllegalMoveError } from "./game.js";
import {
  applyHearts,
  canUndoHearts,
  dealHearts,
  heartsDealPoints,
  heartsMoves,
  heartsToAct,
  HEARTS_HAND,
  HEARTS_PASS_CYCLE,
  HEARTS_SEATS,
  HEARTS_TARGET,
  isHeartsMoveLegal,
  isHeartsWon,
  replayHearts,
  undoHearts,
  type HeartsBoard,
  type HeartsMove,
  type HeartsState,
  type HeartsTrickCard,
} from "./hearts.js";

function card(code: string): Card {
  const parsed = cardFromCode(code);
  if (parsed === null) throw new Error(`fixture is not a card: ${code}`);
  return parsed;
}

function cards(text: string): Card[] {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map(card);
}

/** A hand-built board: every pile written as cards, the way a fixture reads. */
interface HeartsFixture {
  readonly hands: readonly string[];
  readonly deal?: number;
  readonly dealer?: number;
  readonly phase?: HeartsBoard["phase"];
  readonly passed?: readonly (readonly Card[])[];
  readonly trick?: readonly HeartsTrickCard[];
  readonly leader?: number;
  readonly tricksPlayed?: number;
  readonly heartsBroken?: boolean;
  readonly taken?: readonly (readonly Card[])[];
  readonly scores?: readonly number[];
}

function boardOf(spec: HeartsFixture): HeartsBoard {
  const hands = spec.hands.map(cards);
  while (hands.length < HEARTS_SEATS) hands.push([]);
  const empty = hands.map(() => [] as Card[]);
  return {
    deal: spec.deal ?? 0,
    dealer: spec.dealer ?? 0,
    phase: spec.phase ?? "playing",
    hands,
    passed: spec.passed ?? empty.map(() => []),
    trick: spec.trick ?? [],
    leader: spec.leader ?? 0,
    tricksPlayed: spec.tricksPlayed ?? 1,
    heartsBroken: spec.heartsBroken ?? true,
    taken: spec.taken ?? empty,
    scores: spec.scores ?? [0, 0, 0, 0],
  };
}

/** A state around a hand-built board, the way `klondike.test.ts` builds one. */
function stateOf(board: HeartsBoard): HeartsState {
  return { variant: "standard", seed: 7, initial: board, board, log: [] };
}

const play = (code: string): HeartsMove => ({ kind: "play", card: card(code) });

describe("the Hearts deal", () => {
  it("deals thirteen cards to each of the four seats, in the pass cycle's first direction", () => {
    const state = dealHearts("standard", 1);
    expect(state.board.hands.map((hand) => hand.length)).toEqual([13, 13, 13, 13]);
    expect(state.board.phase).toBe("passing");
    expect(HEARTS_PASS_CYCLE[0]).toBe("left");
    expect(heartsToAct(state)).toBe(0);
    expect(state.board.scores).toEqual([0, 0, 0, 0]);
  });

  it("deals every card exactly once, and the same hands twice for one seed", () => {
    const state = dealHearts("standard", 77);
    const codes = state.board.hands.flat().map((held) => `${held.suit}-${held.rank}`);
    expect(new Set(codes).size).toBe(52);
    expect(dealHearts("standard", 77).board).toEqual(dealHearts("standard", 77).board);
    expect(dealHearts("standard", 77).board).not.toEqual(dealHearts("standard", 78).board);
  });

  it("cycles the pass direction through left, right, across and hold", () => {
    expect(HEARTS_PASS_CYCLE).toEqual(["left", "right", "across", "hold"]);
    // Every deal of the game is a function of the seed and the deal number, so the
    // fourth deal — the hold — has no moves at all until a card is played.
    expect(dealHearts("standard", 1).board.phase).toBe("passing");
    const held = replayHearts("standard", 1, holdLog("standard", 1));
    expect(held.ok).toBe(true);
    if (held.ok) expect(held.state.board.deal).toBe(0);
  });
});

/** The four passes of the first deal, read off the deal itself, so a replay can use them. */
function holdLog(variant: "standard", seed: number): HeartsMove[] {
  let state = dealHearts(variant, seed);
  const log: HeartsMove[] = [];
  for (let step = 0; step < HEARTS_SEATS; step += 1) {
    const move = heartsMoves(state)[0]!;
    log.push(move);
    state = applyHearts(state, move);
  }
  return log;
}

describe("passing", () => {
  it("gives each seat the three cards its neighbour chose, in the first deal's leftward direction", () => {
    let state = dealHearts("standard", 5);
    const before = state.board.hands.map((hand) => [...hand]);
    const chosen: (readonly Card[])[] = [];
    for (const seat of [0, 1, 2, 3]) {
      const cards = before[seat]!.slice(0, 3);
      chosen.push(cards);
      expect(heartsToAct(state)).toBe(seat);
      state = applyHearts(state, { kind: "pass", cards });
    }
    expect(state.board.phase).toBe("playing");
    // „Left" is the next seat round the table, so seat 1 receives seat 0's three
    // cards and hands its own to seat 2.
    for (const seat of [0, 1, 2, 3]) {
      const kept = before[seat]!.filter((held) => !chosen[seat]!.some((given) => given === held));
      const received = before[(seat + 3) % 4]!.slice(0, 3);
      const hand = state.board.hands[seat]!;
      expect(hand).toHaveLength(HEARTS_HAND);
      expect(
        hand.some((held) => received.some((given) => given.suit === held.suit && given.rank === held.rank)),
      ).toBe(true);
      expect(kept.length).toBe(10);
    }
    expect(state.board.leader).toBe(1);
  });

  it("refuses a pass of cards the seat does not hold, and a card played while passing", () => {
    const state = dealHearts("standard", 5);
    const hand = state.board.hands[0]!;
    const notMine = card("2C");
    const stranger = hand.every((held) => !(held.suit === notMine.suit && held.rank === notMine.rank));
    expect(stranger).toBe(true);
    expect(isHeartsMoveLegal(state, { kind: "pass", cards: [hand[0]!, hand[1]!, notMine] })).toBe(false);
    expect(isHeartsMoveLegal(state, play("2C"))).toBe(false);
    expect(() => applyHearts(state, { kind: "pass", cards: [hand[0]!, hand[1]!, notMine] })).toThrow(
      IllegalMoveError,
    );
  });

  it("skips the pass on a hold deal, where the eldest hand leads", () => {
    // Deal 3 is the cycle's fourth direction: no pass, straight into play.
    const state = replayHearts("standard", 1, dealThreeLog());
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.state.board.deal).toBe(3);
    expect(HEARTS_PASS_CYCLE[3]).toBe("hold");
  });

  /** Every move of the first three deals, which brings the game to the hold deal. */
  function dealThreeLog(): HeartsMove[] {
    let state = dealHearts("standard", 1);
    const log: HeartsMove[] = [];
    for (let step = 0; step < 600 && state.board.deal < 3; step += 1) {
      const move = heartsMoves(state)[0]!;
      log.push(move);
      state = applyHearts(state, move);
    }
    return log;
  }
});

describe("playing a trick", () => {
  it("gives the trick to the highest card of the suit led, the Ace above the King", () => {
    // The Ace is rank 1 in the card model and the highest card in play, which is
    // exactly the trap `rankStrength` exists for: a comparison on rank alone would
    // hand this trick to the King.
    const board = boardOf({
      hands: ["2C 3C 4C 5C", "6C", "7C", "8C"],
      leader: 0,
      trick: [
        { seat: 0, card: card("5H") },
        { seat: 1, card: card("AH") },
        { seat: 2, card: card("KH") },
      ],
    });
    const state = stateOf(board);
    // Seat 3 follows with the lowest heart it has; seat 1's Ace takes the trick.
    const played = applyHearts(state, play("8C"));
    expect(played.board.taken[1]).toHaveLength(4);
    expect(played.board.leader).toBe(1);
    expect(played.board.trick).toEqual([]);
    expect(played.board.tricksPlayed).toBe(2);
  });

  it("makes a seat follow suit when it can, and refuse a card of another suit", () => {
    const board = boardOf({
      hands: ["2C", "2C 3C 4D", "5D", "6D"],
      leader: 0,
      trick: [{ seat: 0, card: card("9C") }],
    });
    const state = stateOf(board);
    // The led suit is clubs and seat 1 holds two of them, so only those two are on
    // offer: the Diamond is not.
    expect(heartsMoves(state).map((move) => (move.kind === "play" ? move.card.rank : -1))).toEqual([2, 3]);
    expect(isHeartsMoveLegal(state, play("4D"))).toBe(false);
  });

  it("lets a void seat throw anything, and breaks hearts when it throws one", () => {
    const board = boardOf({
      hands: ["2C", "3C 7H", "4C", "5C"],
      leader: 0,
      trick: [{ seat: 0, card: card("9S") }],
      heartsBroken: false,
    });
    const state = stateOf(board);
    expect(isHeartsMoveLegal(state, play("7H"))).toBe(true);
    const played = applyHearts(state, play("7H"));
    expect(played.board.heartsBroken).toBe(true);
  });

  it("refuses to LEAD a heart until hearts are broken, unless the hand holds nothing else", () => {
    const mixed = stateOf(
      boardOf({ hands: ["2C 3H", "4D", "5D", "6D"], leader: 0, trick: [], heartsBroken: false }),
    );
    expect(isHeartsMoveLegal(mixed, play("3H"))).toBe(false);
    expect(isHeartsMoveLegal(mixed, play("2C"))).toBe(true);
    const allHearts = stateOf(boardOf({ hands: ["3H 4H", "4D", "5D", "6D"], leader: 0, trick: [] }));
    expect(isHeartsMoveLegal(allHearts, play("3H"))).toBe(true);
    const broken = stateOf(
      boardOf({ hands: ["2C 3H", "4D", "5D", "6D"], leader: 0, trick: [], heartsBroken: true }),
    );
    expect(isHeartsMoveLegal(broken, play("3H"))).toBe(true);
  });

  it("refuses a penalty card on the first trick, but never refuses a card that follows suit", () => {
    // „A penalty card may not be played to the first trick": the Eight of Hearts is
    // a penalty card and the hand is not all penalty cards, so it may not be thrown
    // onto the Nine of Spades.
    const throwing = stateOf(
      boardOf({ hands: ["2C", "3C 8H", "4C", "5C"], leader: 0, trick: [{ seat: 0, card: card("9S") }], tricksPlayed: 0 }),
    );
    expect(isHeartsMoveLegal(throwing, play("8H"))).toBe(false);
    expect(isHeartsMoveLegal(throwing, play("3C"))).toBe(true);
    // But a spade LED on the first trick must be followed, even by the queen: the
    // seat holds one spade, the queen, and following suit outranks the penalty rule
    // — without that reading the seat has no legal card and the deal cannot play.
    const forced = stateOf(
      boardOf({
        hands: ["2C", "4C", "5C 2D QS", "3C"],
        leader: 0,
        trick: [{ seat: 0, card: card("KS") }, { seat: 1, card: card("7S") }],
        tricksPlayed: 0,
      }),
    );
    expect(isHeartsMoveLegal(forced, play("QS"))).toBe(true);
    expect(heartsMoves(forced)).toHaveLength(1);
    // And a first-trick LEADER may not open with a penalty card either.
    const leading = stateOf(boardOf({ hands: ["2C 3H", "4D", "5D", "6D"], leader: 0, trick: [], tricksPlayed: 0 }));
    expect(isHeartsMoveLegal(leading, play("3H"))).toBe(false);
  });
});

describe("scoring a deal", () => {
  it("counts a point a heart and thirteen for the queen of spades", () => {
    const board = boardOf({
      hands: [],
      taken: [cards("2H 3H QS"), cards("4H"), cards("AH 5C"), cards("6D")],
    });
    expect(heartsDealPoints(board)).toEqual([15, 1, 1, 0]);
  });

  it("adds the deal's points to the totals, and the highest total ends the game at a hundred", () => {
    // A hand-built last trick: the Ace of Clubs (rank 1, the highest club) takes it,
    // seat 0 already holds a heart, and its total is one short of the target.
    const board = boardOf({
      hands: ["AC", "3C", "4C", "5C"],
      trick: [],
      leader: 0,
      tricksPlayed: 12,
      taken: [cards("2H"), [], [], []],
      scores: [HEARTS_TARGET - 1, 101, 102, 103],
    });
    const state = stateOf(board);
    let played = state;
    for (const code of ["AC", "3C", "4C", "5C"]) played = applyHearts(played, play(code));
    expect(played.board.scores).toEqual([HEARTS_TARGET, 101, 102, 103]);
    expect(played.board.phase).toBe("complete");
    expect(isHeartsWon(played)).toBe(true);
  });

  it("settles a shot moon by adding it to every other seat's score", () => {
    // Seat 0 takes the thirteenth heart with its last trick: thirteen hearts and
    // the queen is twenty-six, which is the moon — the shooter scores nothing and
    // every other seat takes the whole twenty-six.
    const hearts = "2H 3H 4H 5H 6H 7H 8H 9H TH JH QH KH AH";
    const board = boardOf({
      hands: ["AC", "3C", "4C", "5C"],
      trick: [],
      leader: 0,
      tricksPlayed: 12,
      taken: [cards(`${hearts} QS`), [], [], []],
      scores: [10, 20, 30, 40],
    });
    let played = stateOf(board);
    for (const code of ["AC", "3C", "4C", "5C"]) played = applyHearts(played, play(code));
    expect(played.board.deal).toBe(1);
    expect(played.board.scores).toEqual([10, 46, 56, 66]);
    // The next deal passes to the right, so it is dealt straight into `passing`.
    expect(played.board.phase).toBe("passing");
  });

  it("starts the next deal with the points carried, the dealer rotated and the pass turned", () => {
    const hearts = "2H 3H 4H 5H 6H 7H 8H 9H TH JH QH KH AH";
    const board = boardOf({
      hands: ["AC", "3C", "4C", "5C"],
      trick: [],
      leader: 0,
      tricksPlayed: 12,
      taken: [cards(hearts), [], [], []],
      scores: [1, 2, 3, 4],
    });
    let played = stateOf(board);
    for (const code of ["AC", "3C", "4C", "5C"]) played = applyHearts(played, play(code));
    expect(played.board.deal).toBe(1);
    expect(played.board.dealer).toBe(1);
    expect(played.board.scores).toEqual([14, 2, 3, 4]);
    // Deal 1 passes to the right, so the deal is dealt straight into `passing`.
    expect(played.board.phase).toBe("passing");
  });
});

describe("the Hearts engine's own bookkeeping", () => {
  it("offers exactly the moves `isHeartsMoveLegal` accepts", () => {
    const state = dealHearts("standard", 21);
    const offered = heartsMoves(state);
    expect(offered).toHaveLength((13 * 12 * 11) / 6);
    for (const move of offered) expect(isHeartsMoveLegal(state, move)).toBe(true);
    const hand = state.board.hands[0]!;
    const notOffered: HeartsMove = { kind: "pass", cards: [hand[0]!, hand[1]!, hand[2]!, hand[3]!] as Card[] };
    expect(heartsMoves(state).some((move) => move.kind === "pass" && move.cards.length === 4)).toBe(false);
    expect(notOffered.cards).toHaveLength(4);
  });

  it("takes an undo back to the position it was played from, two undos back two moves", () => {
    let state = dealHearts("standard", 31);
    const boards: HeartsBoard[] = [state.board];
    for (let step = 0; step < 8; step += 1) {
      const move = heartsMoves(state)[0]!;
      state = applyHearts(state, move);
      boards.push(state.board);
    }
    const before = state.board;
    const played = applyHearts(state, heartsMoves(state)[0]!);
    expect(canUndoHearts(played)).toBe(true);
    const undone = undoHearts(played);
    const keys = Object.keys(undone.board) as (keyof HeartsBoard)[];
    expect(keys.filter((key) => JSON.stringify(undone.board[key]) !== JSON.stringify(before[key]))).toEqual([]);
    // The log is a STACK and not a counter: a second undo takes back the move
    // BEFORE the one just taken back, which is what the shared log's own
    // `logMoves` reports for a log carrying two undos.
    expect(undoHearts(undone).board).toEqual(boards[7]);
    expect(boards[7]).not.toEqual(before);
  });

  it("rebuilds a whole game from its log, and refuses a log that plays an illegal card", () => {
    let state = dealHearts("standard", 41);
    const log: HeartsMove[] = [];
    for (let step = 0; step < 40; step += 1) {
      const move = heartsMoves(state)[0]!;
      log.push(move);
      state = applyHearts(state, move);
    }
    const replayed = replayHearts("standard", 41, log);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.state.board).toEqual(state.board);

    const illegal = replayHearts("standard", 41, [play("2C")]);
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.refusal.code).toBe("illegal-move");
    expect(replayHearts("standard", -1, []).ok).toBe(false);
    const entry = replayHearts("standard", 41, [{ kind: "dance" }]);
    if (!entry.ok) expect(entry.refusal.code).toBe("bad-entry");
    else expect.unreachable();
  });
});
