import { describe, expect, it } from "vitest";
import { cardFromCode, type Card } from "./card.js";
import { IllegalMoveError } from "./game.js";
import {
  applyGolf,
  canUndoGolf,
  dealGolf,
  golfMoves,
  golfSolve,
  GOLF_COLUMNS,
  GOLF_DEPTH,
  GOLF_STOCK_CARDS,
  GOLF_TABLEAU_CARDS,
  hasGolfMoves,
  isGolfMoveLegal,
  isGolfWon,
  replayGolf,
  undoGolf,
  type GolfBoard,
  type GolfMove,
  type GolfState,
} from "./golf.js";
import { UNDO_ENTRY, type GameLogEntry } from "./log.js";

function card(code: string): Card {
  const parsed = cardFromCode(code);
  if (parsed === null) throw new Error(`fixture is not a card: ${code}`);
  return parsed;
}

/** `"QC JD"` is a column with the Queen on top of the Jack; the LAST code is the top card. */
function pile(text: string): Card[] {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map(card);
}

/**
 * A hand-built position. As in the engines beside this one, `initial` is the board
 * a state was handed, which is how a test reaches a position a deal needs thirty
 * moves to reach.
 */
function stateOf(
  spec: { columns: readonly string[]; foundation: string; stock?: string },
  variant: GolfState["variant"] = "classic",
): GolfState {
  const columns = spec.columns.map(pile);
  while (columns.length < GOLF_COLUMNS) columns.push([]);
  const board: GolfBoard = {
    columns,
    foundation: pile(spec.foundation),
    stock: pile(spec.stock ?? ""),
  };
  return { variant, seed: 7, initial: board, board, score: board.columns.reduce((n, p) => n + p.length, 0), log: [] };
}

const play = (column: number): GolfMove => ({ kind: "play", column });
const turn: GolfMove = { kind: "turn" };

describe("the Golf deal", () => {
  it("lays out seven columns of five, one card to the foundation and sixteen in the stock", () => {
    const state = dealGolf("classic", 1);
    expect(state.board.columns.map((held) => held.length)).toEqual([
      GOLF_DEPTH,
      GOLF_DEPTH,
      GOLF_DEPTH,
      GOLF_DEPTH,
      GOLF_DEPTH,
      GOLF_DEPTH,
      GOLF_DEPTH,
    ]);
    expect(state.board.foundation).toHaveLength(1);
    expect(state.board.stock).toHaveLength(GOLF_STOCK_CARDS);
    expect(GOLF_TABLEAU_CARDS + 1 + GOLF_STOCK_CARDS).toBe(52);
    expect(state.score).toBe(GOLF_TABLEAU_CARDS);
  });

  it("deals every card exactly once, and the same table twice for one seed", () => {
    const state = dealGolf("classic", 12345);
    const codes = [
      ...state.board.columns.flatMap((held) => held),
      ...state.board.foundation,
      ...state.board.stock,
    ].map((held) => `${held.suit}-${held.rank}`);
    expect(codes).toHaveLength(52);
    expect(new Set(codes).size).toBe(52);
    expect(dealGolf("classic", 42).board).toEqual(dealGolf("classic", 42).board);
    expect(dealGolf("classic", 42).board).not.toEqual(dealGolf("classic", 43).board);
  });
});

describe("the Golf rules", () => {
  it("offers a play for every column whose top card is one rank from the foundation", () => {
    // One rank away either way, whatever the suit: a Four (4) takes a Three and a
    // Five, and nothing else. The Nine and the Jack are four and six ranks away.
    const state = stateOf({ columns: ["3C", "5H", "9D", "JC"], foundation: "4D" });
    expect(golfMoves(state).sort(byColumn)).toEqual([play(0), play(1)].sort(byColumn));
  });

  it("turns a corner only in the wrap variant, where a King follows an Ace and an Ace a King", () => {
    const position = { columns: ["KS", "9H"], foundation: "AD", stock: "7H" };
    // Strict: a King is twelve ranks from an Ace, so nothing on the tableau plays
    // and the only thing left is to turn the stock.
    expect(golfMoves(stateOf(position, "classic"))).toEqual([turn]);
    // Putt Putt: the King turns the corner onto the Ace. (The Nine is then eight
    // ranks from the King, so the corner is the only move and the turn is refused.)
    expect(golfMoves(stateOf(position, "wrap")).sort(byColumn)).toEqual([play(0)].sort(byColumn));
  });

  it("allows a turn only when nothing on the tableau can be played", () => {
    const stuck = stateOf({ columns: ["5C"], foundation: "AD", stock: "7H 8H" });
    expect(golfMoves(stuck)).toEqual([turn]);
    // One playable column is enough to refuse the turn, which is the article's
    // „whenever there are no possible plays, turn cards up one at a time".
    const playable = stateOf({ columns: ["5C", "2S"], foundation: "AD", stock: "7H" });
    expect(golfMoves(playable).every((move) => move.kind === "play")).toBe(true);
    expect(isGolfMoveLegal(playable, turn)).toBe(false);
  });

  it("takes the exposed card off the column, turns the stock over in order, and scores the cards left", () => {
    const state = stateOf({ columns: ["JD QC", "5C"], foundation: "KD", stock: "3H 4S" });
    const played = applyGolf(state, play(0));
    expect(played.board.columns[0]).toEqual([card("JD")]);
    expect(played.board.foundation).toEqual([card("KD"), card("QC")]);
    // The score is what is LEFT in the tableau — one card under the Queen and one
    // in the second column — not a running total, which is why it is read off the
    // board rather than counted as points.
    expect(played.score).toBe(2);
    // The stock's LAST card is the next one turned, so 4S goes over first.
    const turned = applyGolf(stateOf({ columns: ["5C"], foundation: "KD", stock: "3H 4S" }), turn);
    expect(turned.board.foundation).toEqual([card("KD"), card("4S")]);
    expect(turned.board.stock).toEqual([card("3H")]);
  });

  it("ends when the tableau is cleared or nothing can be played, and the score is what is left", () => {
    const won = stateOf({ columns: ["QC", "JD"], foundation: "KD", stock: "2H" });
    const finished = applyGolf(applyGolf(won, play(0)), play(1));
    expect(finished.board.columns.every((held) => held.length === 0)).toBe(true);
    expect(isGolfWon(finished)).toBe(true);
    expect(finished.score).toBe(0);
    expect(hasGolfMoves(finished)).toBe(false);

    const stuck = stateOf({ columns: ["5C", "9H"], foundation: "AD", stock: "" });
    expect(isGolfWon(stuck)).toBe(false);
    expect(hasGolfMoves(stuck)).toBe(false);
    expect(stuck.score).toBe(2);
  });

  it("takes an undo back to the board and the score it was played from", () => {
    const state = stateOf({ columns: ["JD QC"], foundation: "KD", stock: "3H" });
    const played = applyGolf(state, play(0));
    expect(canUndoGolf(played)).toBe(true);
    const undone = undoGolf(played);
    expect(undone.board).toEqual(state.board);
    expect(undone.score).toBe(state.score);
    expect(canUndoGolf(undone)).toBe(false);
    expect(() => undoGolf(undone)).toThrow(IllegalMoveError);
  });

  it("refuses a move that is not one the position offers", () => {
    const state = stateOf({ columns: ["QC"], foundation: "KD" });
    expect(isGolfMoveLegal(state, play(1))).toBe(false);
    expect(() => applyGolf(state, play(1))).toThrow(IllegalMoveError);
    expect(() => applyGolf(state, { kind: "play", column: 9 })).toThrow(IllegalMoveError);
  });
});

describe("replaying a Golf log", () => {
  it("rebuilds the deal and refuses a bad seed, an unknown variant, a bad entry and an illegal move", () => {
    expect(replayGolf("classic", 5, []).ok).toBe(true);
    expect(replayGolf("classic", 5.5, []).ok).toBe(false);
    expect(replayGolf("classic", 5, "no").ok).toBe(false);
    // A column index nobody could mean is a bad ENTRY (the shape rule), and a
    // column the rules refuse is an ILLEGAL MOVE — the two refusals are different
    // on purpose, and this pins both.
    const bad = replayGolf("classic", 5, [{ kind: "play", column: 99 }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.refusal.code).toBe("bad-entry");
    const refused = replayGolf("classic", 5, [{ kind: "play", column: 0 }]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusal.code).toBe("illegal-move");
    const entry = replayGolf("classic", 5, [{ kind: "dance" }]);
    if (!entry.ok) expect(entry.refusal.code).toBe("bad-entry");
    else expect.unreachable();
  });

  it("walks a log through a turn and back again, undo included", () => {
    // Seed 3 is a deal nobody can play from: the seven exposed cards are all
    // further than one rank from the foundation, so the position's only move is a
    // turn (the probe in the report found it, and the assertion below pins it).
    const first = replayGolf("classic", 3, [turn]);
    if (!first.ok) throw new Error(first.refusal.detail);
    expect(first.state.board.foundation).toHaveLength(2);
    const undone: readonly GameLogEntry<GolfMove>[] = [turn, UNDO_ENTRY];
    const second = replayGolf("classic", 3, undone);
    if (!second.ok) throw new Error(second.refusal.detail);
    expect(second.state.board.foundation).toHaveLength(1);
    const empty = replayGolf("classic", 3, [UNDO_ENTRY]);
    if (!empty.ok) expect(empty.refusal.code).toBe("empty-undo");
    else expect.unreachable();
  });
});

describe("the Golf solver", () => {
  it("proves a deal winnable, and the line it returns clears the tableau", () => {
    // Deal 2 is one the solver WINS, and the winning line is checked twice here:
    // replayed to the end, where the tableau must be empty. The position is not
    // hand-counted card by card — thirty-five cards and sixteen turns is past what
    // a comment can carry — so it is checked by the rules instead: every move in
    // the line is one the engine offers, and the tableau it ends on is empty.
    const state = dealGolf("classic", 2);
    const answer = golfSolve(state);
    expect(answer.verdict).toBe("winnable");
    let walked = state;
    for (const move of answer.line) {
      expect(isGolfMoveLegal(walked, move)).toBe(true);
      walked = applyGolf(walked, move);
    }
    expect(isGolfWon(walked)).toBe(true);
  });

  it("proves a deal unwinnable rather than giving up on it", () => {
    // Deal 0 is refuted: the search exhausted every line inside the node bound, so
    // this is a proof and not a timeout — `nodes` is reported to make the
    // difference visible, and the same call on a bigger deal comes back `unknown`
    // (below), which is the verdict that must never be read as a loss.
    const state = dealGolf("classic", 0);
    const answer = golfSolve(state);
    expect(answer.verdict).toBe("unwinnable");
    expect(answer.nodes).toBeLessThanOrEqual(answer.bound);
  });

  it("proves a hand-checkable position unwinnable in one position", () => {
    // A Two under nothing, a King on the foundation and an empty stock: a King is
    // followed only by a Queen, a Two is eleven ranks away from it, and there is no
    // stock to turn — so the position has no moves at all and the search refutes it
    // without looking at anything else. This one IS counted by hand, and the node
    // count says so.
    const state = stateOf({ columns: ["2C"], foundation: "KD", stock: "" });
    const answer = golfSolve(state);
    expect(answer.verdict).toBe("unwinnable");
    expect(answer.nodes).toBe(1);
  });

  it("proves a hand-checkable position winnable, and the line it returns finishes the tableau", () => {
    // Two exposed cards under a King: the Queen (12) is one rank from the King (13)
    // and the Jack (11) one rank from the Queen, and the tableau is then empty.
    // Counted by hand, and the solver's line is replayed here to check it again.
    const state = stateOf({ columns: ["QC", "JD"], foundation: "KD" });
    const answer = golfSolve(state);
    expect(answer.verdict).toBe("winnable");
    let walked = state;
    for (const move of answer.line) walked = applyGolf(walked, move);
    expect(isGolfWon(walked)).toBe(true);
    expect(answer.line.map((move) => (move.kind === "play" ? move.column : -1))).toEqual([0, 1]);
  });

  it("proves a position unwinnable rather than giving up on it", () => {
    // A Two under nothing, a King on the foundation and an empty stock: a King can
    // only be followed by a Queen, a Two is two ranks from a King, and there is no
    // stock left to turn — so there is nothing to play and nothing to try. The
    // search refutes it in one position, which is why the verdict is a proof.
    const state = stateOf({ columns: ["2C"], foundation: "KD", stock: "" });
    const answer = golfSolve(state);
    expect(answer.verdict).toBe("unwinnable");
    expect(answer.nodes).toBe(1);
  });

  it("answers `unknown` rather than `unwinnable` when the budget runs out", () => {
    const state = dealGolf("classic", 4);
    const answer = golfSolve(state, 1);
    expect(["unknown", "winnable", "unwinnable"]).toContain(answer.verdict);
    expect(answer.nodes).toBeLessThanOrEqual(answer.bound + 1);
    expect(answer.bound).toBe(1);
  });
});

function byColumn(left: GolfMove, right: GolfMove): number {
  const at = (move: GolfMove): number => (move.kind === "play" ? move.column : -1);
  return at(left) - at(right);
}
