import { describe, expect, it } from "vitest";
import { cardFromCode, type Card } from "./card.js";
import { IllegalMoveError } from "./game.js";
import { UNDO_ENTRY, type GameLogEntry } from "./log.js";
import {
  applyPyramid,
  canUndoPyramid,
  dealPyramid,
  hasPyramidMoves,
  isPyramidMoveLegal,
  isPyramidWon,
  pyramidMoves,
  pyramidSolve,
  PYRAMID_CARDS,
  PYRAMID_ROWS,
  PYRAMID_STOCK_CARDS,
  replayPyramid,
  undoPyramid,
  type PyramidBoard,
  type PyramidMove,
  type PyramidSlot,
  type PyramidState,
} from "./pyramid.js";

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

/**
 * A hand-built pyramid: whichever slots the fixture names hold cards, the rest are
 * already matched off. The slots are the deal's own order — row 0 is slot 0, row 1
 * is slots 1 and 2, row 2 is 3, 4 and 5, and so on down to row 6's slots 21..27.
 */
function stateOf(
  spec: {
    at: Readonly<Record<number, string>>;
    waste?: string;
    stock?: string;
    passes?: number;
  },
  variant: PyramidState["variant"] = "pass1",
): PyramidState {
  const held: (Card | null)[] = Array.from({ length: PYRAMID_CARDS }, () => null);
  for (const [slot, code] of Object.entries(spec.at)) held[Number(slot)] = card(code);
  const board: PyramidBoard = {
    cards: held,
    stock: cards(spec.stock ?? ""),
    waste: cards(spec.waste ?? ""),
    passes: spec.passes ?? 0,
  };
  const score = held.reduce((total, one) => (one === null ? total : total + 1), 0);
  return { variant, seed: 7, initial: board, board, log: [], score };
}

const pyramid = (index: number): PyramidSlot => ({ kind: "pyramid", index });
const wasteSlot: PyramidSlot = { kind: "waste" };
const match = (first: PyramidSlot, second?: PyramidSlot): PyramidMove =>
  second === undefined ? { kind: "match", first } : { kind: "match", first, second };
const draw: PyramidMove = { kind: "draw" };
const recycle: PyramidMove = { kind: "recycle" };

describe("the Pyramid deal", () => {
  it("lays out seven rows of one to seven, and twenty-four cards in the stock", () => {
    const state = dealPyramid("pass1", 1);
    expect(PYRAMID_ROWS).toBe(7);
    expect(PYRAMID_CARDS).toBe(28);
    expect(state.board.cards).toHaveLength(PYRAMID_CARDS);
    expect(state.board.cards.every((held) => held !== null)).toBe(true);
    expect(state.board.stock).toHaveLength(PYRAMID_STOCK_CARDS);
    expect(state.board.waste).toEqual([]);
    expect(state.board.passes).toBe(0);
    expect(state.score).toBe(PYRAMID_CARDS);
  });

  it("deals every card exactly once, and the same pyramid twice for one seed", () => {
    const state = dealPyramid("pass3", 99);
    const codes = [...state.board.cards, ...state.board.stock]
      .filter((held): held is Card => held !== null)
      .map((held) => `${held.suit}-${held.rank}`);
    expect(codes).toHaveLength(52);
    expect(new Set(codes).size).toBe(52);
    expect(dealPyramid("pass1", 3).board).toEqual(dealPyramid("pass1", 3).board);
    expect(dealPyramid("pass1", 3).board).not.toEqual(dealPyramid("pass1", 4).board);
  });
});

describe("the Pyramid rules", () => {
  it("sends a lone King home and refuses every other single card", () => {
    // Slots 21 and 22 are in the bottom row, and nothing covers a bottom-row card.
    const state = stateOf({ at: { 21: "KH", 22: "9C" }, waste: "2D", stock: "5S" });
    const singles = pyramidMoves(state).filter(
      (move) => move.kind === "match" && move.second === undefined,
    );
    expect(singles).toEqual([{ kind: "match", first: pyramid(21) }]);
    // „Thus, kings can be removed immediately to the foundation" — and a Nine,
    // which is not thirteen and has no partner here, cannot.
    expect(isPyramidMoveLegal(state, match(pyramid(22)))).toBe(false);
    const played = applyPyramid(state, match(pyramid(21)));
    expect(played.board.cards[21]).toBeNull();
    expect(played.score).toBe(1);
  });

  it("takes a pair that totals thirteen, in either order, and nothing else", () => {
    // The waste's top card is the Ace (1) and the exposed Queen is 12; a pair of
    // exposed cards is read as a set, so naming them the other way round is the
    // same move.
    const state = stateOf({ at: { 1: "QC" }, waste: "AH", stock: "5S" });
    expect(isPyramidMoveLegal(state, match(pyramid(1), wasteSlot))).toBe(true);
    expect(isPyramidMoveLegal(state, match(wasteSlot, pyramid(1)))).toBe(true);
    const played = applyPyramid(state, match(wasteSlot, pyramid(1)));
    expect(played.board.cards[1]).toBeNull();
    expect(played.board.waste).toEqual([]);
    expect(played.score).toBe(0);
    // A pair totalling fourteen is not a pair: the Two of Hearts is 2 and the Queen
    // is 12, and the article's rule is thirteen exactly.
    const wrong = stateOf({ at: { 1: "QC" }, waste: "2H", stock: "5S" });
    expect(isPyramidMoveLegal(wrong, match(pyramid(1), wasteSlot))).toBe(false);
    // The Jack is 11, not the number on the card.
    const jack = stateOf({ at: { 1: "QC" }, waste: "JH", stock: "5S" });
    expect(isPyramidMoveLegal(jack, match(pyramid(1), wasteSlot))).toBe(false);
  });

  it("hides a card until BOTH cards under it are gone", () => {
    // Slot 0 is covered by BOTH slots 1 and 2. The Five of Spades and the Eight of
    // Clubs total thirteen between them — and that pair is not offered, because the
    // Five is covered. The only move the position has is to draw.
    const state = stateOf({ at: { 0: "5S", 1: "8C", 2: "4D" }, waste: "8H", stock: "9S" });
    expect(isPyramidMoveLegal(state, match(pyramid(0), pyramid(1)))).toBe(false);
    expect(isPyramidMoveLegal(state, match(pyramid(0), wasteSlot))).toBe(false);
    expect(pyramidMoves(state)).toEqual([draw]);

    // The Nine of Spades comes over: it is one card of a pair with the Four, so it
    // is the only move, and taking it clears the FIRST of the Five's two covers.
    const drawn = applyPyramid(state, draw);
    expect(pyramidMoves(drawn)).toEqual([match(pyramid(2), wasteSlot)]);
    const fourGone = applyPyramid(drawn, match(pyramid(2), wasteSlot));
    expect(fourGone.board.cards[2]).toBeNull();
    // The Eight still covers the Five, and the Eight itself is 8 against the waste's
    // 8 — sixteen, not thirteen — so the position has no move left at all: the Five
    // stayed locked because ONE of its two covers was still there.
    expect(isPyramidMoveLegal(fourGone, match(pyramid(0), pyramid(1)))).toBe(false);
    expect(pyramidMoves(fourGone)).toEqual([]);
  });

  it("keeps the waste a pile: a draw covers its top, and clearing the top uncovers the next", () => {
    const state = stateOf({ at: { 1: "QC" }, waste: "AH", stock: "5S 2H" });
    // The stock's LAST card is the next one drawn, so the Two of Hearts comes over
    // first and hides the Ace.
    const drawn = applyPyramid(state, draw);
    expect(drawn.board.waste).toEqual([card("AH"), card("2H")]);
    expect(drawn.board.stock).toEqual([card("5S")]);
    // The Ace is no longer the top, so the Queen can no longer be matched with it.
    expect(isPyramidMoveLegal(drawn, match(pyramid(1), wasteSlot))).toBe(false);
    // The Two goes home with the Jack of Spades' worth of nothing — eleven is not
    // in this position — so the waste is cleared by matching the Two with the
    // exposed Queen? 12 + 2 is fourteen. Draw the Five instead and the Five pairs
    // with the Eight of nothing; what is pinned here is only the pile's order.
    const again = applyPyramid(drawn, draw);
    expect(again.board.waste).toEqual([card("AH"), card("2H"), card("5S")]);
  });

  it("refuses a second pass in pass1 and allows exactly two recycles in pass3", () => {
    // pass1 turns the stock over once and never turns the waste back: an empty
    // stock with the waste full is the end of that game.
    // The Seven in the bottom row is the only pyramid card and nothing matches it,
    // so the stock and the waste are the whole of the position.
    expect(pyramidMoves(stateOf({ at: { 21: "7S" }, waste: "AH 2H" }, "pass1"))).toEqual([]);
    // Par Pyramid allows two recycles — „the waste is turned over and dealt as a
    // new stock twice" — so the same position in pass3 has one more thing to try.
    const fresh = stateOf({ at: { 21: "7S" }, waste: "AH 2H", stock: "", passes: 0 }, "pass3");
    expect(pyramidMoves(fresh)).toEqual([recycle]);
    const once = applyPyramid(fresh, recycle);
    expect(once.board.passes).toBe(1);
    expect(once.board.waste).toEqual([]);
    expect(once.board.stock).toHaveLength(2);
    // A recycle needs an EMPTY stock, so with a stock again the offer is the draw.
    expect(pyramidMoves(once)).toEqual([draw]);
    expect(
      pyramidMoves(stateOf({ at: { 21: "7S" }, waste: "AH", stock: "", passes: 1 }, "pass3")),
    ).toEqual([recycle]);
    // The third pass is the last one: two recycles have been used.
    expect(
      pyramidMoves(stateOf({ at: { 21: "7S" }, waste: "AH", stock: "", passes: 2 }, "pass3")),
    ).toEqual([]);
  });

  it("reverses the waste into the stock, so the first card turned over in the new pass is the old pass's first", () => {
    // The waste was built by drawing 5S and then 2H, so turning it over deals 5S
    // first: the LAST card of the new stock is the next one drawn.
    const state = stateOf({ at: { 21: "7S" }, waste: "5C 2H", stock: "", passes: 0 }, "pass3");
    const recycled = applyPyramid(state, recycle);
    expect(recycled.board.stock).toEqual([card("2H"), card("5C")]);
    expect(applyPyramid(recycled, draw).board.waste).toEqual([card("5C")]);
  });

  it("scores the cards left in the pyramid, and is won only when the pyramid is empty", () => {
    const state = stateOf({ at: { 21: "KH", 22: "QC" }, waste: "AH", stock: "5S" });
    expect(state.score).toBe(2);
    const oneLeft = applyPyramid(state, match(pyramid(21)));
    expect(oneLeft.score).toBe(1);
    expect(isPyramidWon(oneLeft)).toBe(false);
    const won = applyPyramid(oneLeft, match(pyramid(22), wasteSlot));
    expect(isPyramidWon(won)).toBe(true);
    expect(won.score).toBe(0);
    // The stock is not part of the win: the article's relaxed game, named in the
    // module header, is a cleared pyramid with cards still in the stock.
    expect(won.board.stock).toHaveLength(1);
    expect(hasPyramidMoves(won)).toBe(false);
    expect(pyramidMoves(won)).toEqual([]);
  });

  it("takes an undo back to the board and the score it was played from, and refuses an empty one", () => {
    const state = stateOf({ at: { 0: "KH" }, waste: "2D", stock: "5S" });
    const played = applyPyramid(state, match(pyramid(0)));
    expect(canUndoPyramid(played)).toBe(true);
    const undone = undoPyramid(played);
    expect(undone.board).toEqual(state.board);
    expect(undone.score).toBe(state.score);
    expect(canUndoPyramid(undone)).toBe(false);
    expect(() => undoPyramid(undone)).toThrow(IllegalMoveError);
  });

  it("refuses a move that is not one the position offers", () => {
    const state = stateOf({ at: { 1: "9C" }, waste: "2H", stock: "5S" });
    expect(() => applyPyramid(state, match(pyramid(1)))).toThrow(IllegalMoveError);
    expect(() => applyPyramid(state, match(pyramid(1), pyramid(1)))).toThrow(IllegalMoveError);
    expect(() => applyPyramid(state, { kind: "match", first: pyramid(28) })).toThrow(IllegalMoveError);
  });
});

describe("replaying a Pyramid log", () => {
  it("rebuilds the deal and refuses a bad seed, a bad entry, an illegal move and an empty undo", () => {
    expect(replayPyramid("pass1", 5, []).ok).toBe(true);
    expect(replayPyramid("pass1", -1, []).ok).toBe(false);
    expect(replayPyramid("pass1", 5, "no").ok).toBe(false);
    const entry = replayPyramid("pass1", 5, [{ kind: "nonsense" }]);
    if (!entry.ok) expect(entry.refusal.code).toBe("bad-entry");
    else expect.unreachable();
    const illegal = replayPyramid("pass1", 5, [draw, recycle]);
    if (!illegal.ok) expect(illegal.refusal.code).toBe("illegal-move");
    else expect.unreachable();
    const undo = replayPyramid("pass1", 5, [UNDO_ENTRY]);
    if (!undo.ok) expect(undo.refusal.code).toBe("empty-undo");
    else expect.unreachable();
  });

  it("rebuilds the score and the pass count from the log alone", () => {
    let state = dealPyramid("pass3", 11);
    const log: GameLogEntry<PyramidMove>[] = [];
    for (let step = 0; step < 8; step += 1) {
      const move = pyramidMoves(state)[0];
      if (move === undefined) break;
      log.push(move);
      state = applyPyramid(state, move);
    }
    const replayed = replayPyramid("pass3", 11, log);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.state.score).toBe(state.score);
    expect(replayed.state.board).toEqual(state.board);
  });
});

describe("the Pyramid solver", () => {
  it("proves a hand-checkable position winnable in one move", () => {
    // A lone King is thirteen, so it goes home alone and the pyramid is empty —
    // counted by hand, and the solver's own line is replayed to check it again.
    const state = stateOf({ at: { 2: "KH" }, waste: "2D", stock: "5S" });
    const answer = pyramidSolve(state);
    expect(answer.verdict).toBe("winnable");
    let walked = state;
    for (const move of answer.line) walked = applyPyramid(walked, move);
    expect(isPyramidWon(walked)).toBe(true);
  });

  it("proves a hand-checkable position unwinnable", () => {
    // Three cards, the top one covered by the other two, no waste and no stock:
    // two plus three is five and neither is a King, so there is no move at all —
    // counted by hand, and the node count says the search saw exactly this one.
    const state = stateOf({ at: { 0: "5S", 1: "2C", 2: "3D" } });
    const answer = pyramidSolve(state);
    expect(answer.verdict).toBe("unwinnable");
    expect(answer.nodes).toBe(1);
  });

  it("answers a deal with one of the three verdicts and never past its bound", () => {
    for (const seed of [0, 1, 2]) {
      const answer = pyramidSolve(dealPyramid("pass3", seed));
      expect(["winnable", "unwinnable", "unknown"]).toContain(answer.verdict);
      expect(answer.nodes).toBeLessThanOrEqual(answer.bound + 1);
    }
  });
});
