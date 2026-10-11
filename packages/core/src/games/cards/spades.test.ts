import { describe, expect, it } from "vitest";
import { cardFromCode, type Card } from "./card.js";
import { IllegalMoveError } from "./game.js";
import {
  applySpades,
  canUndoSpades,
  dealSpades,
  isSpadesMoveLegal,
  isSpadesWon,
  replaySpades,
  SPADES_HAND,
  SPADES_LOSS,
  SPADES_NIL_BONUS,
  SPADES_SEATS,
  SPADES_TARGET,
  spadesContract,
  spadesMoves,
  spadesPartnerOf,
  spadesToAct,
  undoSpades,
  type SpadesBoard,
  type SpadesMove,
  type SpadesState,
  type SpadesTrickCard,
} from "./spades.js";

function card(code: string): Card {
  const parsed = cardFromCode(code);
  if (parsed === null) throw new Error(`fixture is not a card: ${code}`);
  return parsed;
}

function trickPile(tricks: number): Card[] {
  // A pile of won cards: a trick is four cards, and the only property the rules
  // read is how many tricks the pile is. `T` is the ten in this notation.
  const clubs = ["2C", "3C", "4C", "5C", "6C", "7C", "8C", "9C", "TC", "JC", "QC", "KC", "AC"];
  return Array.from({ length: tricks * SPADES_SEATS }, (_, index) =>
    card(clubs[index % clubs.length]!),
  );
}

function handsOf(spec: readonly string[]): Card[][] {
  const hands = spec.map((text) =>
    text
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .map(card),
  );
  while (hands.length < SPADES_SEATS) hands.push([]);
  return hands;
}

/** A hand-built board; the fields a test does not name are the ones a deal settles. */
interface SpadesFixture {
  readonly hands?: readonly string[];
  readonly bids?: readonly (number | null)[];
  readonly trick?: readonly SpadesTrickCard[];
  readonly taken?: readonly (readonly Card[])[];
  readonly deal?: number;
  readonly dealer?: number;
  readonly phase?: SpadesBoard["phase"];
  readonly leader?: number;
  readonly tricksPlayed?: number;
  readonly spadesBroken?: boolean;
  readonly scores?: readonly number[];
  readonly bags?: readonly number[];
}

function boardOf(spec: SpadesFixture): SpadesBoard {
  const hands = handsOf(spec.hands ?? []);
  return {
    deal: spec.deal ?? 0,
    dealer: spec.dealer ?? 0,
    phase: spec.phase ?? "playing",
    hands,
    bids: spec.bids ?? [null, null, null, null],
    trick: spec.trick ?? [],
    leader: spec.leader ?? 0,
    tricksPlayed: spec.tricksPlayed ?? 12,
    spadesBroken: spec.spadesBroken ?? true,
    taken: spec.taken ?? hands.map(() => []),
    scores: spec.scores ?? [0, 0],
    bags: spec.bags ?? [0, 0],
  };
}

function stateOf(board: SpadesBoard): SpadesState {
  return { variant: "standard", seed: 7, initial: board, board, log: [] };
}

const play = (code: string): SpadesMove => ({ kind: "play", card: card(code) });
const bid = (value: number): SpadesMove => ({ kind: "bid", bid: value });

/**
 * A board one trick from the end of a hand: four hands of one card, the tricks that
 * have been taken already, the bids, and the last trick to be played. The Clubs run
 * low to high so the seat holding the highest one takes the trick.
 */
function lastTrick(spec: {
  hands: readonly string[];
  bids: readonly number[];
  taken: readonly number[];
  scores: readonly number[];
  bags?: readonly number[];
  leader?: number;
}): SpadesState {
  return stateOf(
    boardOf({
      hands: spec.hands,
      bids: spec.bids,
      taken: spec.taken.map(trickPile),
      scores: spec.scores,
      bags: spec.bags ?? [0, 0],
      leader: spec.leader ?? 0,
    }),
  );
}

describe("the Spades deal", () => {
  it("deals thirteen cards to each seat and opens the bidding at the dealer's left", () => {
    const state = dealSpades("standard", 1);
    expect(state.board.hands.map((hand) => hand.length)).toEqual([13, 13, 13, 13]);
    expect(state.board.phase).toBe("bidding");
    expect(SPADES_HAND * SPADES_SEATS).toBe(52);
    expect(spadesToAct(state)).toBe(1);
    expect(state.board.bids).toEqual([null, null, null, null]);
    // Zero to thirteen, nil included: „A bid of zero is called nil".
    expect(spadesMoves(state).map((move) => (move.kind === "bid" ? move.bid : -1))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it("deals every card exactly once, and the same hands twice for one seed", () => {
    const state = dealSpades("standard", 88);
    const codes = state.board.hands.flat().map((held) => `${held.suit}-${held.rank}`);
    expect(new Set(codes).size).toBe(52);
    expect(dealSpades("standard", 88).board).toEqual(dealSpades("standard", 88).board);
    expect(dealSpades("standard", 88).board).not.toEqual(dealSpades("standard", 89).board);
  });

  it("takes the bids in the article's order and adds the partners' bids up", () => {
    let state = dealSpades("standard", 2);
    expect(spadesToAct(state)).toBe(1);
    state = applySpades(state, bid(4));
    expect(spadesToAct(state)).toBe(2);
    state = applySpades(state, bid(2));
    state = applySpades(state, bid(3));
    expect(spadesToAct(state)).toBe(0);
    state = applySpades(state, bid(0));
    expect(state.board.phase).toBe("playing");
    expect(state.board.leader).toBe(1);
    // Seats 0 and 2 are one partnership and 1 and 3 the other; a nil counts zero.
    expect(spadesPartnerOf(0)).toBe(0);
    expect(spadesPartnerOf(2)).toBe(0);
    expect(spadesContract(state.board, 0)).toBe(2);
    expect(spadesContract(state.board, 1)).toBe(7);
  });
});

describe("playing a trick", () => {
  it("follows suit, and takes the trick with the highest card of the suit led", () => {
    const state = stateOf(
      boardOf({ hands: ["2C", "3C 4D", "5C", "6C"], leader: 0, trick: [{ seat: 0, card: card("9C") }] }),
    );
    expect(spadesMoves(state).map((move) => (move.kind === "play" ? move.card.rank : -1))).toEqual([3]);
    expect(isSpadesMoveLegal(state, play("4D"))).toBe(false);
  });

  it("an Ace beats a King, and a spade beats the suit led", () => {
    // The ace is rank 1 and the highest card in play — the trap `rankStrength`
    // exists for — and with spades always trump a low spade still takes a trick led
    // in clubs.
    const ace = stateOf(
      boardOf({
        hands: ["2D", "3D", "4D", "5D"],
        leader: 0,
        trick: [
          { seat: 0, card: card("KH") },
          { seat: 1, card: card("AH") },
          { seat: 2, card: card("QH") },
        ],
      }),
    );
    // Seat 3 is void in hearts, so any card will do; the Ace of Hearts still wins.
    expect(applySpades(ace, play("5D")).board.leader).toBe(1);
    const trump = stateOf(
      boardOf({
        hands: ["2D", "3D", "4D", "2S"],
        leader: 0,
        trick: [
          { seat: 0, card: card("KH") },
          { seat: 1, card: card("AH") },
          { seat: 2, card: card("2H") },
        ],
      }),
    );
    expect(applySpades(trump, play("2S")).board.leader).toBe(3);
  });

  it("refuses to LEAD a spade until a spade has been played, unless the hand holds only spades", () => {
    const unbroken = stateOf(
      boardOf({ hands: ["2S 3C", "4C", "5C", "6C"], leader: 0, trick: [], spadesBroken: false }),
    );
    expect(isSpadesMoveLegal(unbroken, play("2S"))).toBe(false);
    expect(isSpadesMoveLegal(unbroken, play("3C"))).toBe(true);
    const broken = stateOf(
      boardOf({ hands: ["2S 3C", "4C", "5C", "6C"], leader: 0, trick: [], spadesBroken: true }),
    );
    expect(isSpadesMoveLegal(broken, play("2S"))).toBe(true);
    const onlySpades = stateOf(
      boardOf({ hands: ["2S 3S", "4C", "5C", "6C"], leader: 0, trick: [], spadesBroken: false }),
    );
    expect(isSpadesMoveLegal(onlySpades, play("2S"))).toBe(true);
  });
});

describe("scoring a hand", () => {
  it("pays ten a bid trick, one a bag, and takes ten a bid trick away when set", () => {
    // A bid 5 and takes 6 (51, one bag); B bids 8 and takes 7 (−80).
    const state = lastTrick({
      hands: ["TC", "3C", "4C", "5C"],
      bids: [3, 4, 2, 4],
      taken: [4, 5, 1, 2],
      scores: [0, 0],
    });
    expect(spadesContract(state.board, 0)).toBe(5);
    expect(spadesContract(state.board, 1)).toBe(8);
    let played = state;
    for (const code of ["TC", "3C", "4C", "5C"]) played = applySpades(played, play(code));
    expect(played.board.scores).toEqual([51, -80]);
    expect(played.board.bags).toEqual([1, 0]);
    // Nobody has reached five hundred and nobody has dropped to minus two hundred,
    // so the next deal is dealt: the article's ending needs one of the two.
    expect(played.board.phase).toBe("bidding");
    expect(played.board.deal).toBe(1);
  });

  it("pays a hundred for a nil made and takes a hundred for one that fails", () => {
    const made = lastTrick({
      hands: ["2C", "TC", "4C", "5C"],
      bids: [0, 4, 2, 4],
      taken: [0, 5, 4, 3],
      scores: [0, 0],
    });
    let played = made;
    for (const code of ["2C", "TC", "4C", "5C"]) played = applySpades(played, play(code));
    // Seat 2's four tricks against a contract of two are 22 with two bags, plus the
    // hundred for the nil; the other partnership's nine tricks against eight are
    // 81 with a bag of its own. Seat 1 took the last trick, so the nil stands.
    expect(played.board.scores).toEqual([122, 81]);
    expect(played.board.bags).toEqual([2, 1]);

    const failed = lastTrick({
      hands: ["2C", "3C", "4C", "AC"],
      bids: [0, 4, 2, 4],
      taken: [1, 5, 0, 6],
      scores: [0, 0],
    });
    let lost = failed;
    for (const code of ["2C", "3C", "4C", "AC"]) lost = applySpades(lost, play(code));
    // Seat 0 took a trick, so the nil is failed: its contract of two is set too,
    // and the ace of clubs takes the last trick for seat 3.
    expect(lost.board.scores).toEqual([-120, 84]);
  });

  it("charges a hundred when the tenth bag arrives", () => {
    const state = lastTrick({
      hands: ["TC", "3C", "4C", "5C"],
      bids: [3, 4, 2, 4],
      taken: [4, 6, 1, 1],
      scores: [200, 300],
      bags: [9, 0],
    });
    let played = state;
    for (const code of ["TC", "3C", "4C", "5C"]) played = applySpades(played, play(code));
    // 200 + 51 = 251, then the tenth bag costs a hundred and the count rolls over.
    expect(played.board.scores).toEqual([151, 220]);
    expect(played.board.bags).toEqual([0, 0]);
  });

  it("ends the game at five hundred, and at minus two hundred for the partnership that dropped there", () => {
    const winning = lastTrick({
      hands: ["TC", "3C", "4C", "5C"],
      bids: [3, 4, 2, 4],
      taken: [4, 5, 1, 2],
      scores: [490, 10],
    });
    let won = winning;
    for (const code of ["TC", "3C", "4C", "5C"]) won = applySpades(won, play(code));
    expect(won.board.scores[0]).toBeGreaterThanOrEqual(SPADES_TARGET);
    expect(won.board.phase).toBe("complete");
    expect(isSpadesWon(won)).toBe(true);

    const losing = lastTrick({
      hands: ["2C", "TC", "4C", "5C"],
      bids: [3, 4, 2, 4],
      taken: [0, 7, 0, 5],
      scores: [-190, 10],
    });
    let lost = losing;
    for (const code of ["2C", "TC", "4C", "5C"]) lost = applySpades(lost, play(code));
    expect(lost.board.scores[0]).toBeLessThanOrEqual(SPADES_LOSS);
    expect(lost.board.phase).toBe("complete");
    expect(isSpadesWon(lost)).toBe(false);
    expect(SPADES_NIL_BONUS).toBe(100);
  });

  it("plays another deal when the two totals land on the same number", () => {
    const state = lastTrick({
      hands: ["TC", "3C", "4C", "5C"],
      bids: [3, 4, 2, 3],
      taken: [4, 6, 1, 1],
      scores: [490, 471],
    });
    let played = state;
    for (const code of ["TC", "3C", "4C", "5C"]) played = applySpades(played, play(code));
    // Both partnerships land on 541: „If there is a tie, then all players
    // participate in one more round of play until a winner is decided."
    expect(played.board.scores).toEqual([541, 541]);
    expect(played.board.phase).toBe("bidding");
    expect(played.board.deal).toBe(1);
  });
});

describe("the Spades engine's own bookkeeping", () => {
  it("takes an undo back to the position it was played from", () => {
    let state = dealSpades("standard", 12);
    for (let step = 0; step < 5; step += 1) state = applySpades(state, spadesMoves(state)[0]!);
    const before = state.board;
    const played = applySpades(state, spadesMoves(state)[0]!);
    expect(before).not.toEqual(played.board);
    expect(canUndoSpades(played)).toBe(true);
    expect(undoSpades(played).board).toEqual(before);
  });

  it("rebuilds a hand from its log, and refuses an illegal one", () => {
    let state = dealSpades("standard", 21);
    const log: SpadesMove[] = [];
    for (let step = 0; step < 30; step += 1) {
      const move = spadesMoves(state)[0]!;
      log.push(move);
      state = applySpades(state, move);
    }
    const replayed = replaySpades("standard", 21, log);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.state.board).toEqual(state.board);
    // A card played while the bidding is still open is not a move at all.
    const illegal = replaySpades("standard", 21, [play("2C")]);
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.refusal.code).toBe("illegal-move");
    const outOfRange = replaySpades("standard", 21, [bid(14)]);
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) expect(outOfRange.refusal.code).toBe("bad-entry");
    expect(() => applySpades(dealSpades("standard", 21), bid(14))).toThrow(IllegalMoveError);
  });
});
