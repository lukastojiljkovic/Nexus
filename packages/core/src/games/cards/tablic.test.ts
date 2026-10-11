import { describe, expect, it } from "vitest";
import { cardFromCode, type Card } from "./card.js";
import { IllegalMoveError } from "./game.js";
import {
  applyTablic,
  dealTablic,
  isTablicMoveLegal,
  legalCaptures,
  replayTablic,
  TABLIC_CARD_POINTS,
  TABLIC_HAND,
  TABLIC_MOST_CARDS_POINTS,
  TABLIC_TALON,
  TABLIC_TARGET,
  tablicCardPoints,
  tablicMoves,
  tablicMostCardsPoints,
  tablicSeats,
  tablicSideOf,
  tablicToAct,
  tablicValue,
  type TablicBoard,
  type TablicMove,
  type TablicState,
} from "./tablic.js";
import type { TablicVariant } from "./game.js";

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

/** A hand-built board, with every pile written as cards — the way a fixture reads. */
interface TablicFixture {
  readonly hand?: number;
  readonly dealer?: number;
  readonly phase?: TablicBoard["phase"];
  readonly hands?: readonly string[];
  readonly table?: string;
  readonly deck?: string;
  readonly captured?: readonly string[];
  readonly tablas?: readonly number[];
  readonly scores?: readonly number[];
  readonly seat?: number;
}

function boardOf(spec: TablicFixture): TablicBoard {
  const hands = (spec.hands ?? []).map(cards);
  const seats = Math.max(2, spec.hands?.length ?? 2);
  while (hands.length < seats) hands.push([]);
  return {
    hand: spec.hand ?? 0,
    dealer: spec.dealer ?? 0,
    phase: spec.phase ?? "playing",
    hands,
    table: cards(spec.table ?? ""),
    deck: cards(spec.deck ?? ""),
    captured: (spec.captured ?? ["", ""]).map(cards),
    tablas: spec.tablas ?? [0, 0],
    scores: spec.scores ?? [0, 0],
    seat: spec.seat ?? 0,
  };
}

function stateOf(board: TablicBoard, variant: TablicVariant = "duo"): TablicState {
  return { variant, seed: 7, initial: board, board, log: [] };
}

/** One move: a card and the table indices it takes. */
function play(code: string, capture: readonly number[] = []): TablicMove {
  return { kind: "play", card: card(code), capture };
}

/**
 * The example in the source's own text, in one place because the tests below all
 * start from it: „the cards on the table are A, 3, 6, 7, 8, Q."
 * https://www.pagat.com/fishing/tablic.html § Play
 */
const SOURCE_TABLE = ["AS", "3C", "6D", "7H", "8S", "QD"] as const;
const source = (): Card[] => SOURCE_TABLE.map(card);

/** The capture sets as index lists, sorted, so an expectation reads as the table. */
function captures(cardCode: string): string[] {
  return legalCaptures(source(), card(cardCode))
    .map((capture) => [...capture].sort((left, right) => left - right).join("+"))
    .sort();
}

describe("the card values the source states", () => {
  it("counts king 14, queen 13, jack 12, the ace one or eleven, and the rest at face value", () => {
    expect(tablicValue(card("KS"))).toBe(14);
    expect(tablicValue(card("QD"))).toBe(13);
    expect(tablicValue(card("JH"))).toBe(12);
    expect(tablicValue(card("AS"))).toBe(1);
    expect(tablicValue(card("AS"), true)).toBe(11);
    expect(tablicValue(card("TC"))).toBe(10);
    expect(tablicValue(card("2D"))).toBe(2);
  });
});

describe("the capture rules, against the source's own example", () => {
  it("captures the card itself when the played card matches one card on the table", () => {
    // „If you play a 6, you can only capture the 6."
    expect(captures("6C")).toEqual(["2"]);
  });

  it("captures several sets at once, and never a card twice", () => {
    // „If you play a 9 you can capture (A+8) + (3+6)." The three captures are the
    // two sets and the union of both — and nowhere does a card appear twice, which
    // is the source's „No card can belong to more than one captured set".
    expect(captures("9C")).toEqual(["0+1+2+4", "0+4", "1+2"]);
  });

  it("captures the set the source names for a ten", () => {
    // „If you play a 10 you can capture 7+3." The other set that adds up to ten is
    // the ace counted as one, the three and the six — the two sets share the three,
    // so they cannot be taken together.
    expect(captures("TC")).toEqual(["0+1+2", "1+3"]);
  });

  it("captures the three sets the source names for a king, ace high or low", () => {
    // „If you play a King (14) you could capture A+6+7, or (A+Q) + (6+8), or
    // (A+3) + (6+8) (counting the Ace as 11)": with the ace as one, A+Q is fourteen
    // and so is 6+8; with the ace as eleven, A+3 is fourteen.
    expect(captures("KC")).toEqual(["0+1", "0+1+2+4", "0+2+3", "0+2+4+5", "0+5", "2+4"]);
    // The three named captures are all there, spelled as the source spells them.
    expect(captures("KC")).toEqual(expect.arrayContaining(["0+2+3", "0+2+4+5", "0+1+2+4"]));
  });

  it("captures nothing when nothing adds up", () => {
    // „If you play a 5 it captures nothing and remains face up on the table."
    expect(captures("5C")).toEqual([]);
  });
});

describe("the Tablić deal", () => {
  it("lays out the talon, six cards each and the rest of the pack, for two players and for four", () => {
    const duo = dealTablic("duo", 1);
    expect(duo.board.hands.map((hand) => hand.length)).toEqual([TABLIC_HAND, TABLIC_HAND]);
    expect(duo.board.table).toHaveLength(TABLIC_TALON);
    expect(duo.board.deck).toHaveLength(52 - TABLIC_TALON - 2 * TABLIC_HAND);
    expect(tablicSeats("duo")).toBe(2);
    // „The player to dealer's right plays first, and the play continues
    // anticlockwise": with seat 0 dealing, seat 1 opens in a two-player game.
    expect(tablicToAct(duo)).toBe(1);
    expect(tablicSideOf(0)).toBe(0);
    expect(tablicSideOf(2)).toBe(0);

    const pairs = dealTablic("pairs", 1);
    expect(pairs.board.hands.map((hand) => hand.length)).toEqual([TABLIC_HAND, TABLIC_HAND, TABLIC_HAND, TABLIC_HAND]);
    expect(pairs.board.deck).toHaveLength(52 - TABLIC_TALON - 4 * TABLIC_HAND);
    expect(tablicSeats("pairs")).toBe(4);
    expect(tablicToAct(pairs)).toBe(3);
  });

  it("deals every card exactly once, and the same table twice for one seed", () => {
    for (const variant of ["duo", "pairs"] as const) {
      const state = dealTablic(variant, 4242);
      const codes = [...state.board.hands.flat(), ...state.board.table, ...state.board.deck].map(
        (held) => `${held.suit}-${held.rank}`,
      );
      expect(codes).toHaveLength(52);
      expect(new Set(codes).size).toBe(52);
      expect(dealTablic(variant, 4242).board).toEqual(dealTablic(variant, 4242).board);
      expect(dealTablic(variant, 4242).board).not.toEqual(dealTablic(variant, 4243).board);
    }
  });

  it("deals another six cards each when the hands run out, and the same dealer deals it", () => {
    // Two players, the last card of the round on the table: the next state is the
    // next round, dealt from the deck, with the table left as it stands.
    const board = boardOf({
      hands: ["", "3C"],
      deck: "4H 5H 6H 7H 8H 9H TH JH QH KH AH 2S 3S",
      table: "5D",
      seat: 1,
      dealer: 0,
    });
    const played = applyTablic(stateOf(board), play("3C"));
    // No capture (3 + nothing: the Five of Diamonds is not a three), so the Three
    // joins the table and the next round is dealt.
    expect(played.board.table).toEqual([card("5D"), card("3C")]);
    expect(played.board.hands.map((hand) => hand.length)).toEqual([TABLIC_HAND, TABLIC_HAND]);
    expect(played.board.deck).toHaveLength(13 - 12);
  });
});

describe("playing a card", () => {
  it("takes the captured cards and the played card into the pile, and leaves a no-capture card on the table", () => {
    const board = boardOf({ hands: ["6D 4C", "5C"], table: "AS 3C", seat: 0 });
    const state = stateOf(board);
    // The Six takes the Ace and the Three? 6 = 1 + 3 = 4, no — 6 alone is a group
    // of one only if a Six is on the table. The Ace and the Three add up to four,
    // so a Four takes them: the Four is the second card in seat 0's hand.
    const legal = tablicMoves(state).filter((move) => move.capture.length > 0);
    expect(legal).toEqual([{ kind: "play", card: card("4C"), capture: [0, 1] }]);
    const played = applyTablic(state, play("4C", [0, 1]));
    expect(played.board.table).toEqual([]);
    expect(played.board.captured[0]).toEqual([card("4C"), card("AS"), card("3C")]);
    // Not obliged to capture: the same Four may simply be laid on the table.
    const laid = applyTablic(state, play("4C"));
    expect(laid.board.table).toEqual([card("AS"), card("3C"), card("4C")]);
    expect(laid.board.captured[0]).toEqual([]);
  });

  it("scores a tabla — a capture that leaves the table empty — with its own point", () => {
    const board = boardOf({ hands: ["4C", "5C"], table: "AS 3C", seat: 0 });
    const played = applyTablic(stateOf(board), play("4C", [0, 1]));
    // Four takes the ace and the three (1 + 3), and the Table is left empty.
    expect(played.board.tablas).toEqual([1, 0]);
    const notTabla = boardOf({ hands: ["4C", "5C"], table: "AS 3C 9D", seat: 0 });
    expect(applyTablic(stateOf(notTabla), play("4C", [0, 1])).board.tablas).toEqual([0, 0]);
  });

  it("refuses a capture that does not add up, and a card the seat does not hold", () => {
    const board = boardOf({ hands: ["6D", "5C"], table: "AS 3C", seat: 0 });
    const state = stateOf(board);
    // Six against a one and a three is four: not a capture.
    expect(tablicMoves(state).some((move) => move.capture.length > 0)).toBe(false);
    expect(() => applyTablic(state, play("6D", [0, 1]))).toThrow(IllegalMoveError);
    expect(() => applyTablic(state, play("9H"))).toThrow(IllegalMoveError);
    expect(() => applyTablic(state, play("6D", [0, 0]))).toThrow(IllegalMoveError);
  });

  it("keeps the move enumeration and the legality predicate saying the same thing", () => {
    // The rule is written twice — once as the enumeration a screen draws and once
    // as the predicate a replay asks — and the only way to know they agree is to
    // ask both the same questions.
    const board = boardOf({
      hands: ["4C 6D 9H", "5C KC"],
      table: "AS 3C QD 7H",
      seat: 0,
      deck: "2S 3S",
    });
    const state = stateOf(board);
    const offered = tablicMoves(state);
    for (const move of offered) {
      expect(isTablicMoveLegal(state, move)).toBe(true);
    }
    // And everything the enumeration did NOT offer is refused by the predicate.
    const refused = [
      play("9H", [0, 1]),
      play("6D", [2]),
      play("KC", [0, 1, 2, 3]),
      play("4C", [3, 3]),
    ];
    for (const move of refused) {
      expect(isTablicMoveLegal(state, move)).toBe(false);
    }
  });
});

describe("scoring a hand", () => {
  it("counts a point for every ace, king, queen and jack, two for the ten of diamonds and one for the other tens and the two of clubs", () => {
    const counting = cards("AS AC AH AD KS KC KH KD QS QC QH QD JS JC JH JD TD TC TH TS 2C");
    expect(tablicCardPoints(counting)).toBe(TABLIC_CARD_POINTS);
    expect(TABLIC_CARD_POINTS).toBe(22);
    expect(TABLIC_MOST_CARDS_POINTS).toBe(3);
    expect(tablicCardPoints(cards("TD"))).toBe(2);
    expect(tablicCardPoints(cards("TC"))).toBe(1);
    expect(tablicCardPoints(cards("2C"))).toBe(1);
    expect(tablicCardPoints(cards("2D"))).toBe(0);
  });

  it("pays three points for most cards, and none at all when two sides tie", () => {
    expect(tablicMostCardsPoints([cards("2C 3C"), cards("4C")])).toEqual([3, 0]);
    expect(tablicMostCardsPoints([cards("2C"), cards("3C")])).toEqual([0, 0]);
  });

  it("sweeps the table to the dealer's side at the end of a hand, and counts no tabla for it", () => {
    // The hand's last card, the deck empty: seat 1 plays it, the table is swept to
    // seat 0's side (the dealer's), and no tabla is scored for the sweep.
    const board = boardOf({
      hands: ["", "5C"],
      table: "AS 3C QD",
      seat: 1,
      dealer: 0,
      captured: ["2D 2H", "KH"],
      scores: [0, 0],
    });
    const played = applyTablic(stateOf(board), play("5C"));
    expect(played.board.tablas).toEqual([0, 0]);
    // The hand is over, so the piles have been counted and a new deal has its own
    // empty ones: what the sweep was worth is in the SCORES. The dealer's side takes
    // the three table cards — an Ace and a Queen are two card points — on top of the
    // Two of Diamonds and the Two of Hearts it already had; the other side keeps its
    // King, worth one, and the played Five joins that pile. Most cards are 5 to 2,
    // which is the other three points.
    expect(played.board.scores).toEqual([2 + 3, 1]);
  });

  it("ends the game past a hundred and one, and plays another hand on a tie", () => {
    const winning = boardOf({
      hands: ["", "5C"],
      table: "AS",
      seat: 1,
      dealer: 0,
      captured: ["KH QD JS JC TD TC TH TS 2C", ""],
      scores: [TABLIC_TARGET, 20],
    });
    const played = applyTablic(stateOf(winning), play("5C"));
    expect(played.board.scores[0]).toBeGreaterThan(TABLIC_TARGET);
    expect(played.board.phase).toBe("complete");

    const tied = boardOf({
      hands: ["", "5C"],
      table: "",
      seat: 1,
      dealer: 0,
      // The played Five stays on the table (it took nothing) and the sweep adds it
      // to the dealer's side, so the piles end three clues apiece and none of them a
      // scoring card: the hand is worth nothing to anybody and the tie stands.
      captured: ["2D 4D", "3D 6D 8D"],
      scores: [100, 100],
    });
    const again = applyTablic(stateOf(tied), play("5C"));
    // Nothing on the table and a Five that scores nothing, so both sides end on 100:
    // the source says a tie is another hand, and another hand means a fresh deal
    // with the scores carried.
    expect(again.board.scores[0]).toBe(again.board.scores[1]);
    expect(again.board.phase).toBe("playing");
    expect(again.board.hand).toBe(1);
    expect(again.board.hands.map((hand) => hand.length)).toEqual([TABLIC_HAND, TABLIC_HAND]);
  });
});

describe("replaying a Tablić log", () => {
  it("rebuilds a game from its log and refuses an illegal one", () => {
    let state = dealTablic("duo", 9);
    const log: TablicMove[] = [];
    for (let step = 0; step < 12; step += 1) {
      const move = tablicMoves(state)[0]!;
      log.push(move);
      state = applyTablic(state, move);
    }
    const replayed = replayTablic("duo", 9, log);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.state.board).toEqual(state.board);

    const illegal = replayTablic("duo", 9, [{ kind: "play", card: card("AS"), capture: [] }]);
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.refusal.code).toBe("illegal-move");
    expect(replayTablic("duo", -1, []).ok).toBe(false);
    const entry = replayTablic("duo", 9, [{ kind: "fish" }]);
    if (!entry.ok) expect(entry.refusal.code).toBe("bad-entry");
    else expect.unreachable();
    const wrongVariant = replayTablic("bridge" as TablicVariant, 9, []);
    if (!wrongVariant.ok) expect(wrongVariant.refusal.code).toBe("unknown-variant");
    else expect.unreachable();
  });
});
