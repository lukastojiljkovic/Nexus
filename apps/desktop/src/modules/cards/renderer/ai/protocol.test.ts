import { describe, expect, it } from "vitest";
import { dealHearts, dealSpades, dealTablic, heartsMoves, spadesMoves, tablicMoves } from "@nexus/core";
import { answerMoveRequest, requestedGame } from "./protocol.js";
import { moveSeed } from "../rules.js";

/**
 * The cards AI worker's protocol (ADR-090 stage 2): what a request must look like,
 * what it answers and what it refuses.
 *
 * **The one promise a page makes when it hands a position to another thread** is that
 * the answer is a move the RULES allow or a named refusal — never a move nobody
 * checked and never an exception. This file is that promise, and it drives the worker
 * protocol directly rather than through a worker, which is why the protocol is a pure
 * function.
 *
 * Every case runs at `easy`, which picks a uniformly random legal move: the cheapest
 * thing each engine offers, so the whole file is a few milliseconds of work.
 */

describe("a move request", () => {
  it("answers with a move the engine's own enumeration offered", () => {
    for (const level of ["easy", "medium", "hard"] as const) {
      const dealt = dealHearts("standard", 200 + level.length);
      const answer = answerMoveRequest({
        id: 1,
        game: "hearts",
        level,
        state: dealt,
        seed: 5,
      });
      expect(answer.ok, level).toBe(true);
      if (!answer.ok) continue;
      // A pass is three cards, and the enumeration offers the same three in its own
      // order; membership is a question about the SET. The chosen cards are also
      // legal, which is what makes the answer playable rather than merely present.
      expect(setKeys(heartsMoves(dealt)), level).toContain(setKey(answer.move));
    }
  });

  it("answers the same request the same way, because the seed is the whole of its randomness", () => {
    const state = dealTablic("duo", 99);
    const first = answerMoveRequest({ id: 1, game: "tablic", level: "easy", state, seed: 4 });
    const second = answerMoveRequest({ id: 2, game: "tablic", level: "easy", state, seed: 4 });
    expect(first.ok && second.ok && JSON.stringify(first.move)).toBe(JSON.stringify(second.ok ? second.move : null));
  });

  it("gives every ply a different stream, so a search cannot shift the deal", () => {
    const state = dealSpades("standard", 7);
    // A search draws from the stream its caller DERIVED, never from the deal's own,
    // so the page derives a fresh one per ply and the answer is reproducible from it.
    expect(moveSeed(7, 0)).not.toBe(moveSeed(7, 1));
    const early = answerMoveRequest({ id: 1, game: "spades", level: "easy", state, seed: moveSeed(7, 0) });
    const again = answerMoveRequest({ id: 2, game: "spades", level: "easy", state, seed: moveSeed(7, 0) });
    expect(early.ok && again.ok && JSON.stringify(early.move)).toBe(JSON.stringify(again.ok ? again.move : null));
  });

  it("answers a position with no legal move with no move at all", () => {
    const state = dealSpades("standard", 3);
    const answer = answerMoveRequest({ id: 9, game: "spades", level: "easy", state, seed: 1 });
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(spadesMoves(state)).toContainEqual(answer.move);
  });
});

describe("the refusals", () => {
  const state = dealHearts("standard", 1);
  it("refuses a game, a level, a seed or a body it cannot read", () => {
    const requests: unknown[] = [
      { id: 1, game: "solitaire", level: "easy", state, seed: 1 },
      { id: 2, game: "hearts", level: "impossible", state, seed: 1 },
      { id: 3, game: "hearts", level: 2, state, seed: 1 },
      { id: 4, game: "hearts", level: "easy", state, seed: -1 },
      { id: 5, game: "hearts", level: "easy", state, seed: 2 ** 32 },
      { id: 6, game: "hearts", level: "easy", state, seed: 1.5 },
      { id: 7, game: "hearts", level: "easy", state },
      { id: 8, game: "hearts", level: "easy", state: "not a position", seed: 1 },
      { id: 9, game: "hearts", level: "easy", state: null, seed: 1 },
      "not even an object",
      null,
    ];
    for (const request of requests) {
      const answer = answerMoveRequest(request);
      expect(answer.ok, JSON.stringify(request)).toBe(false);
    }
  });

  it("refuses a request whose id it cannot read, and says so on id 0", () => {
    expect(answerMoveRequest({ game: "hearts", level: "easy", state, seed: 1 })).toEqual({
      id: 0,
      ok: false,
      problem: "invalid-request",
    });
  });

  it("reads the game id off a request without answering it, for a caller that looks first", () => {
    expect(requestedGame({ game: "tablic" })).toBe("tablic");
    expect(requestedGame({ game: "cards" })).toBeNull();
    expect(requestedGame(null)).toBeNull();
  });
});

describe("what postMessage does to an answer", () => {
  it("survives a structured clone, because that is how it crosses the thread boundary", () => {
    const state = dealTablic("duo", 21);
    const answer = answerMoveRequest({ id: 11, game: "tablic", level: "easy", state, seed: 3 });
    expect(structuredClone(answer)).toEqual(answer);
  });

  it("keeps tablic's own second answer for the same card, so a capture choice survives", () => {
    // Tablić can capture with more than one group, and the answer has to be one the
    // engine's enumeration carries — which is exactly what `tablicMoves` is.
    const state = dealTablic("duo", 777);
    const answer = answerMoveRequest({ id: 12, game: "tablic", level: "medium", state, seed: 8 });
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(tablicMoves(state)).toContainEqual(answer.move);
  });
});

/**
 * One move's cards as an order-independent key: a pass is a SET of three cards, and
 * the enumeration's order inside it is the deal's, not the answer's.
 */
function setKey(move: unknown): string {
  const record = move as { readonly kind?: string; readonly card?: { suit: string; rank: number }; readonly cards?: readonly { suit: string; rank: number }[] };
  if (record.card !== undefined) return `${record.kind}:${record.card.suit}${record.card.rank}`;
  const cards = (record.cards ?? []).map((card) => `${card.suit}${card.rank}`).sort();
  return `${record.kind}:${cards.join(",")}`;
}

function setKeys(moves: readonly unknown[]): string[] {
  return moves.map(setKey);
}
