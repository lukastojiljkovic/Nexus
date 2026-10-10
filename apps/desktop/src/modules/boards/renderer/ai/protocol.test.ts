import { describe, expect, it } from "vitest";
import {
  backgammon,
  boardEngine,
  createSeededRandom,
  fourInARow,
  ludo,
  reversi,
} from "@nexus/core";
import { answerMoveRequest, requestedGame } from "./protocol.js";

/**
 * The AI worker's protocol (ADR-090 stage 2). What is pinned here is the one
 * promise a page makes when it hands a position to another thread: the answer is a
 * move the RULES allow, or a named refusal — never a move nobody checked, and never
 * an exception.
 *
 * The searches run at level 1, which is the cheapest limit each engine offers, so
 * the whole file is a few milliseconds of work.
 */

const REVERSI_OPENING = boardEngine("reversi").json(reversi.initialState());

describe("the move request", () => {
  it("answers with a legal move, and says what the search cost", () => {
    const answer = answerMoveRequest({ id: 7, game: "reversi", level: 1, state: REVERSI_OPENING, seed: 1 });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const legal = boardEngine("reversi").legalMoves(reversi.initialState());
    expect(legal).toContainEqual(answer.move);
    expect(answer.nodes).toBeGreaterThan(0);
    expect(answer.depth).toBeGreaterThanOrEqual(1);
    expect(answer.rng).not.toBe(1);
  });

  it("answers the same request the same way: the seed is the whole of its randomness", () => {
    const request = { id: 1, game: "ludo", level: 1, state: answeredLudoState(), seed: 4 };
    const first = answerMoveRequest(request);
    const second = answerMoveRequest({ ...request, id: 2 });
    expect(first.ok && second.ok && JSON.stringify(first.move)).toBe(
      JSON.stringify(second.ok ? second.move : null),
    );
  });

  it("answers a dice game once its dice are on the board", () => {
    const rolled = backgammon.rollFor(backgammon.initialState(), createSeededRandom(9));
    const answer = answerMoveRequest({
      id: 3,
      game: "backgammon",
      level: 1,
      state: backgammon.toJSON(rolled),
      seed: 9,
    });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(backgammon.legalMoves(rolled)).toContainEqual(answer.move);
  });

  it("answers a finished position with no move at all", () => {
    const cells = new Array<number>(fourInARow.FOUR_CELLS).fill(0);
    for (let row = 0; row < 4; row += 1) cells[fourInARow.fourIndex(0, row)] = 1;
    const answer = answerMoveRequest({
      id: 4,
      game: "four-in-a-row",
      level: 1,
      state: fourInARow.toJSON(fourInARow.fromJSON({ cells, toMove: 1, moveCount: 4 })),
      seed: 2,
    });
    expect(answer).toEqual({ id: 4, ok: true, move: null, nodes: 0, depth: 0, cut: false, rng: 2 });
  });
});

describe("the refusals", () => {
  it("refuses a game it does not know, a level it does not have and a stream it cannot read", () => {
    for (const request of [
      { id: 1, game: "chess", level: 1, state: REVERSI_OPENING, seed: 1 },
      { id: 2, game: "reversi", level: 0, state: REVERSI_OPENING, seed: 1 },
      { id: 3, game: "reversi", level: 4, state: REVERSI_OPENING, seed: 1 },
      { id: 4, game: "reversi", level: 1, state: REVERSI_OPENING, seed: -1 },
      { id: 5, game: "reversi", level: 1, state: REVERSI_OPENING, seed: 2 ** 32 },
      { id: 6, game: "reversi", level: 1, state: REVERSI_OPENING, seed: 1.5 },
      { id: 7, game: "reversi", level: 1, state: REVERSI_OPENING },
      "not even an object",
    ]) {
      const answer = answerMoveRequest(request);
      expect(answer.ok).toBe(false);
      if (!answer.ok) expect(answer.problem).toBe("invalid-request");
    }
  });

  it("refuses a position it cannot read rather than searching it", () => {
    const answer = answerMoveRequest({
      id: 8,
      game: "reversi",
      level: 1,
      state: { discs: [1, 2, 3] },
      seed: 1,
    });
    expect(answer).toEqual({ id: 8, ok: false, problem: "unreadable-position" });
  });

  it("refuses a dice game whose dice have not been rolled: the page rolls, the worker thinks", () => {
    const answer = answerMoveRequest({
      id: 9,
      game: "backgammon",
      level: 1,
      state: backgammon.toJSON(backgammon.initialState()),
      seed: 1,
    });
    expect(answer).toEqual({ id: 9, ok: false, problem: "must-roll" });
    const ludoAnswer = answerMoveRequest({
      id: 10,
      game: "ludo",
      level: 1,
      state: ludo.toJSON(ludo.initialState({ seats: 2 })),
      seed: 1,
    });
    expect(ludoAnswer).toEqual({ id: 10, ok: false, problem: "must-roll" });
  });

  it("reads the game id off a request without answering it, for a caller that needs to look first", () => {
    expect(requestedGame({ game: "mlin" })).toBe("mlin");
    expect(requestedGame({ game: "go" })).toBeNull();
    expect(requestedGame(null)).toBeNull();
  });
});

describe("what `postMessage` does to an answer", () => {
  it("survives a structured clone, because that is how it crosses the thread boundary", () => {
    const answer = answerMoveRequest({ id: 11, game: "reversi", level: 1, state: REVERSI_OPENING, seed: 3 });
    expect(structuredClone(answer)).toEqual(answer);
  });
});

/**
 * A ludo position with a six on the board, so the search has something to decide:
 * a six is the one face that brings a token out of the yard, and the position is
 * the engine's own (`die` and `sixes` are part of a state, which is why a test can
 * state one instead of rolling until it happens).
 */
function answeredLudoState(): unknown {
  return ludo.toJSON(ludo.initialState({ seats: 2, die: 6, sixes: 1 }));
}
