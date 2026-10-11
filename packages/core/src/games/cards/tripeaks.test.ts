import { describe, expect, it } from "vitest";
import { cardFromCode, type Card } from "./card.js";
import { IllegalMoveError } from "./game.js";
import {
  applyTriPeaks,
  canUndoTriPeaks,
  dealTriPeaks,
  hasTriPeaksMoves,
  isTriPeaksMoveLegal,
  isTriPeaksWon,
  replayTriPeaks,
  TRIPEAKS_STOCK,
  TRIPEAKS_TABLEAU,
  triPeaksMoves,
  undoTriPeaks,
  type TriPeaksBoard,
  type TriPeaksMove,
  type TriPeaksState,
} from "./tripeaks.js";

function card(code: string): Card {
  const parsed = cardFromCode(code);
  if (parsed === null) throw new Error(`fixture is not a card: ${code}`);
  return parsed;
}

function stock(text: string): Card[] {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map(card);
}

/**
 * A hand-built table: whichever slots the fixture names hold cards, the rest are
 * already gone. The slots are the deal's own order — the row of ten is 0..9, the
 * row of nine 10..18, the row of six 19..24 and the three caps 25..27.
 */
function stateOf(
  spec: { at: Readonly<Record<number, string>>; waste: string; stock?: string },
  variant: TriPeaksState["variant"] = "classic",
): TriPeaksState {
  const tableau: (Card | null)[] = Array.from({ length: TRIPEAKS_TABLEAU }, () => null);
  for (const [slot, code] of Object.entries(spec.at)) tableau[Number(slot)] = card(code);
  const board: TriPeaksBoard = { tableau, waste: stock(spec.waste), stock: stock(spec.stock ?? "") };
  return { variant, seed: 7, initial: board, board, log: [], score: 0, streak: 0 };
}

const play = (slot: number): TriPeaksMove => ({ kind: "play", slot });
const turn: TriPeaksMove = { kind: "turn" };

describe("the TriPeaks deal", () => {
  it("lays out twenty-eight cards, turns the first stock card onto the waste, and keeps twenty-three", () => {
    const state = dealTriPeaks("classic", 1);
    expect(state.board.tableau).toHaveLength(TRIPEAKS_TABLEAU);
    expect(state.board.tableau.every((held) => held !== null)).toBe(true);
    expect(state.board.waste).toHaveLength(1);
    expect(state.board.stock).toHaveLength(TRIPEAKS_STOCK - 1);
    expect({ score: state.score, streak: state.streak, log: state.log }).toEqual({
      score: 0,
      streak: 0,
      log: [],
    });
  });

  it("deals every card exactly once, and the same table twice for one seed", () => {
    const state = dealTriPeaks("classic", 4321);
    const codes = [
      ...state.board.tableau.flatMap((held) => (held === null ? [] : [held])),
      ...state.board.waste,
      ...state.board.stock,
    ].map((held) => `${held.suit}-${held.rank}`);
    expect(new Set(codes).size).toBe(52);
    expect(dealTriPeaks("classic", 8).board).toEqual(dealTriPeaks("classic", 8).board);
    expect(dealTriPeaks("classic", 8).board).not.toEqual(dealTriPeaks("classic", 9).board);
  });
});

describe("the TriPeaks rules", () => {
  it("plays a card when it is one rank above or below the waste, whatever the suit", () => {
    // The waste is 5H: the 4C is one below and the 6D one above; the 5S is equal
    // (not a move) and the 8C is three ranks away.
    const state = stateOf({
      at: { 0: "4C", 1: "6D", 2: "5S", 3: "8C" },
      waste: "5H",
      stock: "2C",
    });
    expect(triPeaksMoves(state).map((move) => (move.kind === "play" ? move.slot : -1))).toEqual([0, 1]);
    expect(isTriPeaksMoveLegal(state, play(2))).toBe(false);
  });

  it("hides a card until every card covering it is gone, and a pyramid's middle card until BOTH are", () => {
    // Slot 0 is in the bottom row; slot 10 covers slots 0 and 1, and slot 11 covers
    // slots 1 and 2 — so slot 0 is exposed by 10 alone, while slot 1 is covered by
    // 10 and by 11 and needs both gone.
    const state = stateOf({ at: { 0: "4C", 1: "3C", 10: "5H", 11: "2C" }, waste: "6D", stock: "9S" });
    expect(triPeaksMoves(state).map((move) => (move.kind === "play" ? move.slot : -1))).toEqual([10]);
    const afterTen = applyTriPeaks(state, play(10));
    // 11 still covers slot 1, so only slot 0 came free; and the new waste is 5H,
    // one rank from the 4C and two from the 2C.
    expect(triPeaksMoves(afterTen).map((move) => (move.kind === "play" ? move.slot : -1))).toEqual([0]);
    const afterZero = applyTriPeaks(afterTen, play(0));
    // The waste is now 4C, one rank from the 3C under slot 1 — which is still
    // covered by 11, so it is not on offer yet; the only thing left is the stock.
    expect(triPeaksMoves(afterZero)).toEqual([turn]);
  });

  it("turns the stock only when nothing on the tableau can be played", () => {
    const stuck = stateOf({ at: { 0: "8C" }, waste: "5H", stock: "2C 3C" });
    expect(triPeaksMoves(stuck)).toEqual([turn]);
    const playable = stateOf({ at: { 0: "4C" }, waste: "5H", stock: "2C" });
    expect(triPeaksMoves(playable)).toEqual([play(0)]);
    expect(isTriPeaksMoveLegal(playable, turn)).toBe(false);
  });

  it("turns a corner only in the wrap variant", () => {
    const position = { at: { 0: "AD" }, waste: "KS", stock: "2C" };
    expect(triPeaksMoves(stateOf(position, "classic"))).toEqual([turn]);
    expect(triPeaksMoves(stateOf(position, "wrap"))).toEqual([play(0)]);
  });

  it("scores a run 1, 2, 3 and starts again after a turn of the stock", () => {
    // Four cards, and the sequence the rule makes of them: 4C on 5H (+1), 3C on 4C
    // (+2), a turn onto 6S which starts a new run, then 7D on 6S (+1). One, three,
    // three, four — the streak score added up rather than asserted per step.
    let state = stateOf({ at: { 0: "3C", 7: "7D", 10: "4C" }, waste: "5H", stock: "6S" });
    state = applyTriPeaks(state, play(10));
    expect({ score: state.score, streak: state.streak }).toEqual({ score: 1, streak: 1 });
    state = applyTriPeaks(state, play(0));
    expect({ score: state.score, streak: state.streak }).toEqual({ score: 3, streak: 2 });
    state = applyTriPeaks(state, turn);
    expect({ score: state.score, streak: state.streak }).toEqual({ score: 3, streak: 0 });
    state = applyTriPeaks(state, play(7));
    expect({ score: state.score, streak: state.streak }).toEqual({ score: 4, streak: 1 });
    expect(hasTriPeaksMoves(state)).toBe(false);
  });

  it("takes an undo back to the score and the streak the move was played from", () => {
    const state = stateOf({ at: { 0: "4C", 10: "5H" }, waste: "6D", stock: "9S" });
    const played = applyTriPeaks(state, play(10));
    expect(played.score).toBe(1);
    expect(canUndoTriPeaks(played)).toBe(true);
    const undone = undoTriPeaks(played);
    expect(undone.board).toEqual(state.board);
    expect({ score: undone.score, streak: undone.streak }).toEqual({ score: 0, streak: 0 });
    expect(canUndoTriPeaks(undone)).toBe(false);
    expect(() => undoTriPeaks(undone)).toThrow(IllegalMoveError);
  });

  it("is won when every tableau card is gone, however much stock is left", () => {
    const won = stateOf({ at: {}, waste: "5H", stock: "3C 4C" });
    expect(isTriPeaksWon(won)).toBe(true);
    expect(hasTriPeaksMoves(won)).toBe(false);
    expect(triPeaksMoves(won)).toEqual([]);
    const one = stateOf({ at: { 0: "4C" }, waste: "5H" });
    expect(isTriPeaksWon(one)).toBe(false);
    expect(isTriPeaksWon(applyTriPeaks(one, play(0)))).toBe(true);
  });

  it("refuses a play the position does not offer, and a slot nobody could mean", () => {
    const state = stateOf({ at: { 0: "8C" }, waste: "5H", stock: "2C" });
    expect(isTriPeaksMoveLegal(state, play(0))).toBe(false);
    expect(() => applyTriPeaks(state, play(0))).toThrow(IllegalMoveError);
    expect(() => applyTriPeaks(state, { kind: "play", slot: 28 })).toThrow(IllegalMoveError);
  });
});

describe("replaying a TriPeaks log", () => {
  it("rebuilds the deal and refuses a bad seed, a bad entry, an illegal move and an empty undo", () => {
    expect(replayTriPeaks("classic", 5, []).ok).toBe(true);
    expect(replayTriPeaks("classic", -1, []).ok).toBe(false);
    expect(replayTriPeaks("classic", 5, "no").ok).toBe(false);
    const entry = replayTriPeaks("classic", 5, [{ kind: "jump" }]);
    if (!entry.ok) expect(entry.refusal.code).toBe("bad-entry");
    else expect.unreachable();
    const illegal = replayTriPeaks("classic", 5, [play(27)]);
    if (!illegal.ok) expect(illegal.refusal.code).toBe("illegal-move");
    else expect.unreachable();
    const undo = replayTriPeaks("classic", 5, [{ kind: "undo" }]);
    if (!undo.ok) expect(undo.refusal.code).toBe("empty-undo");
    else expect.unreachable();
  });

  it("rebuilds the score and the streak from the log alone", () => {
    // A real deal, played by the engine's own first offered move until the first
    // turn and then two more cards: the log a save would carry, and the score it
    // must fold back to rather than remember.
    let state = dealTriPeaks("classic", 5);
    const log: TriPeaksMove[] = [];
    for (let step = 0; step < 6; step += 1) {
      const move = triPeaksMoves(state)[0];
      if (move === undefined) break;
      log.push(move);
      state = applyTriPeaks(state, move);
    }
    expect(log.length).toBeGreaterThan(2);
    const replayed = replayTriPeaks("classic", 5, log);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.state.score).toBe(state.score);
    expect(replayed.state.streak).toBe(state.streak);
    expect(replayed.state.board).toEqual(state.board);
  });
});
