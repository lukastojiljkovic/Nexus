import { describe, expect, it } from "vitest";

import * as backgammon from "../backgammon/backgammon.js";
import * as draughts from "../draughts/draughts.js";
import * as fourInARow from "../four-in-a-row/fourInARow.js";
import * as ludo from "../ludo/ludo.js";
import * as mlin from "../mlin/mlin.js";
import { createSeededRandom, rollDie } from "../random.js";
import * as reversi from "../reversi/reversi.js";
import {
  BOARDS_GAMES,
  MLIN_LAYOUT,
  boardEngine,
  describeBoardEvent,
  isBoardsGame,
  moveEvent,
  normalizeBoardState,
  replayBoard,
  rollEvent,
} from "./protocol.js";
import type { BoardEvent, BoardOutcome, BoardsGame } from "./protocol.js";

/**
 * The board games' turn protocol (ADR-090 stage 2). What is pinned here is the
 * one property the module's main half and its page both stand on: **a game is its
 * seed plus its event log**, so folding the log back through the engines produces
 * the position it was played to — and a log that does not is refused rather than
 * resumed.
 *
 * Every expected value below is either read off the engine that produced it (an
 * oracle, stated as such) or a hand-derived notation string.
 */

/** A state, compared the way the store compares one: canonically. */
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

describe("the six engines", () => {
  it("answers one engine per game id, with the seat counts and level counts the module offers", () => {
    expect(BOARDS_GAMES).toHaveLength(6);
    expect(boardEngine("reversi").seats).toEqual([2]);
    expect(boardEngine("draughts").seats).toEqual([2]);
    expect(boardEngine("mlin").seats).toEqual([2]);
    expect(boardEngine("backgammon").seats).toEqual([2]);
    expect(boardEngine("four-in-a-row").seats).toEqual([2]);
    // The one game with a choice of seats, and the reason a seat count is data.
    expect(boardEngine("ludo").seats).toEqual([2, 3, 4]);
    // Each engine publishes exactly three levels, which is what the level bound
    // (1..3) in the schema and the renderer both read from here.
    for (const game of BOARDS_GAMES) {
      expect(boardEngine(game).levels).toBe(3);
    }
  });

  it("recognises exactly the six game ids", () => {
    for (const game of BOARDS_GAMES) expect(isBoardsGame(game)).toBe(true);
    expect(isBoardsGame("chess")).toBe(false);
    expect(isBoardsGame(7)).toBe(false);
    expect(isBoardsGame(null)).toBe(false);
  });

  it("reads a state back through the engine that wrote it, canonically", () => {
    for (const game of BOARDS_GAMES) {
      const engine = boardEngine(game);
      const opening = engine.initial(engine.fromJSON(starter(game)));
      expect(same(engine.json(opening), engine.json(engine.fromJSON(engine.json(opening))))).toBe(
        true,
      );
    }
  });

  it("normalizes a state that crossed JSON, restoring the field four in a row derives", () => {
    const engine = boardEngine("four-in-a-row");
    // A position seat 0 has won in: four discs stacked in column 0.
    const cells = new Array<number>(42).fill(0);
    for (let row = 0; row < 4; row += 1) cells[row * 7] = 1;
    const live = engine.fromJSON({ cells, toMove: 1, moveCount: 4 });
    const json = engine.json(live);

    // What is written to a column, and what `postMessage` carries: no winner —
    // the rules derive it, so `toJSON` does not write it.
    expect((json as { winner?: unknown }).winner).toBeUndefined();
    // The hazard this function exists for: the raw JSON is not a state the
    // engine's derived readers can answer from.
    expect((engine.outcome(json) as BoardOutcome).winner).toBeNaN();
    // Normalized, it is: the winner comes back with the discs.
    const normalized = normalizeBoardState("four-in-a-row", json) as fourInARow.FourState;
    expect(normalized.winner).toBe(1);
    expect(engine.outcome(normalized)).toEqual({ status: "win", winner: 0 });
  });
});

/** A state of each game, built by the engine, for the round trips above and below. */
function starter(game: BoardsGame): unknown {
  switch (game) {
    case "reversi":
      return reversi.toJSON(reversi.initialState());
    case "draughts":
      return draughts.toJSON(draughts.initialState({ kind: "russian" }));
    case "mlin":
      return mlin.toJSON(mlin.initialState());
    case "four-in-a-row":
      return fourInARow.toJSON(fourInARow.initialState());
    case "backgammon":
      return backgammon.toJSON(backgammon.initialState({ cubeEnabled: true }));
    case "ludo":
      return ludo.toJSON(ludo.initialState({ seats: 3 }));
  }
}

describe("replaying a game from its seed and its log", () => {
  it("reproduces a position from a log of engine moves, with no dice involved", () => {
    const opening = reversi.initialState();
    // Two placements, both legal from the standard opening: d3 and then the reply
    // c3 (the engine's own legal moves decide, so nothing here is hand-chosen
    // beyond the first cell).
    const first = { kind: "place", cell: reversi.reversiIndex(3, 2) } as const;
    const afterFirst = reversi.applyMove(opening, first);
    const reply = reversi.legalMoves(afterFirst)[0] as reversi.ReversiMove;
    const log: BoardEvent[] = [
      moveEvent("reversi", opening, first),
      moveEvent("reversi", afterFirst, reply),
    ];

    const replayed = replayBoard("reversi", 1, log, reversi.toJSON(opening));

    expect(same(replayed, reversi.applyMove(afterFirst, reply))).toBe(true);
  });

  it("re-draws the same dice for backgammon, so a game is its seed", () => {
    const opening = backgammon.initialState({ cubeEnabled: true });
    const rolled = backgammon.rollFor(opening, createSeededRandom(4242));
    const move = backgammon.bestMove(rolled, 1, createSeededRandom(9)).move as backgammon.BackgammonMove;
    const log: BoardEvent[] = [rollEvent("backgammon", rolled), moveEvent("backgammon", rolled, move)];

    const replayed = replayBoard("backgammon", 4242, log, backgammon.toJSON(rolled));

    // The oracle is the engine's own transition, applied to the position the
    // engine reached by rolling the same seed.
    expect(same(replayed, backgammon.applyMove(rolled, move))).toBe(true);
  });

  it("takes ludo's third six as the lost turn it is, and keeps the turn when a six is playable", () => {
    // The first three draws of one stream must all be sixes, which is what makes
    // this a derivation rather than an invented number: the search below is over
    // a 6³ space, and the assertion says it found one.
    let seed = 0;
    for (let candidate = 1; candidate < 100_000 && seed === 0; candidate += 1) {
      const probe = createSeededRandom(candidate);
      if ([1, 2, 3].every(() => rollDie(probe, 6) === 6)) seed = candidate;
    }
    expect(seed).not.toBe(0);

    const opening = ludo.toJSON(ludo.initialState({ seats: 2 }));
    // Eight turns of the module's own loop, which is what the page and the store
    // both run: roll when the game needs it, else play (or pass when the die
    // cannot be played at all).
    const played = drive("ludo", seed, opening, 8);

    const replayed = replayBoard("ludo", seed, played.log, opening);

    expect(same(replayed, played.state)).toBe(true);
    // The third throw is the branch this case exists for. Three sixes in a row
    // took the turn away from seat 0 (LUDO_DEFAULTS.threeSixesLoseTurn): the first
    // two sixes each brought a token out (progress 0 → 1 → 7), and the third left
    // no die at all and seat 1 to roll.
    const thirdThrow = played.log
      .map((event, index) => (event.kind === "roll" ? index : -1))
      .filter((index) => index >= 0)[2] as number;
    expect(played.log[thirdThrow]?.kind).toBe("roll");
    const afterThreeThrows = replayBoard("ludo", seed, played.log.slice(0, thirdThrow + 1), opening);
    expect((afterThreeThrows as ludo.LudoState).toMove).toBe(1);
    expect((afterThreeThrows as ludo.LudoState).die).toBeNull();
    expect((afterThreeThrows as ludo.LudoState).sixes).toBe(0);
    expect((afterThreeThrows as ludo.LudoState).tokens[0]?.[0]).toBe(7);
  });

  it("refuses a roll the engine did not make, rather than storing a board and a log that disagree", () => {
    const opening = backgammon.initialState();
    const rolled = backgammon.rollFor(opening, createSeededRandom(1));
    const wrong: number[] = [...rolled.dice].map((die) => (die === 6 ? 1 : die + 1));

    expect(() =>
      replayBoard("backgammon", 1, [{ kind: "roll", dice: wrong }], backgammon.toJSON(opening)),
    ).toThrow(INVALID_STATE);
  });

  it("refuses a move in a game that has no dice, and a die where none belongs", () => {
    const opening = fourInARow.initialState();
    expect(() =>
      replayBoard("four-in-a-row", 1, [{ kind: "roll", dice: [3] }], fourInARow.toJSON(opening)),
    ).toThrow(INVALID_STATE);
    expect(() =>
      replayBoard("four-in-a-row", 1, [{ kind: "pass" }], fourInARow.toJSON(opening)),
    ).toThrow(INVALID_STATE);
  });

  it("refuses a doubling cube where the cube was not in play, and applies it where it was", () => {
    const off = backgammon.initialState();
    expect(() =>
      replayBoard("backgammon", 1, [{ kind: "double" }], backgammon.toJSON(off)),
    ).toThrow(INVALID_STATE);

    const on = backgammon.initialState({ cubeEnabled: true });
    const doubled = replayBoard("backgammon", 1, [{ kind: "double" }], backgammon.toJSON(on));
    expect((doubled as backgammon.BackgammonState).cube).toBe(2);
    expect((doubled as backgammon.BackgammonState).cubeOwner).toBe(1);
  });
});

/**
 * The module's own turn loop, written once here so the cases above can build a
 * real log to replay: roll while the position asks for a roll, play the first
 * legal move (or pass when the rules allow nothing else), and stop when the game
 * is over. It is deliberately the same shape the page runs — a test that built its
 * log differently would be proving a different loop.
 */
function drive(
  game: BoardsGame,
  seed: number,
  opening: unknown,
  turns: number,
): { state: unknown; log: BoardEvent[] } {
  const engine = boardEngine(game);
  const rng = createSeededRandom(seed);
  let state = engine.fromJSON(opening);
  const log: BoardEvent[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    if (engine.outcome(state).status !== "in_progress") break;
    if (engine.needsRoll(state)) {
      state = engine.roll(state, rng);
      log.push(rollEvent(game, state));
      // A roll that grants no die at all — ludo's third six — has already passed
      // the turn, and there is nothing to play and nothing to pass.
      if (engine.needsRoll(state)) continue;
    }
    const moves = engine.legalMoves(state);
    if (moves.length === 0) {
      log.push({ kind: "pass" });
      state = engine.step(state, { kind: "pass" });
      continue;
    }
    const event = moveEvent(game, state, moves[0] as unknown);
    log.push(event);
    state = engine.step(state, event);
  }
  return { state, log };
}

const INVALID_STATE = /invalid game state/;

describe("the move list's notation", () => {
  it("names a reversi cell the way the board is read, and a pass as a pass", () => {
    expect(
      describeBoardEvent("reversi", { kind: "move", move: { kind: "place", cell: 3 } }),
    ).toEqual({ kind: "notation", text: "d1" });
    expect(describeBoardEvent("reversi", { kind: "move", move: { kind: "pass" } })).toEqual({
      kind: "pass",
    });
  });

  it("writes a draughts step and a whole capture sequence", () => {
    // Square names come from the engine's own row/column arithmetic: square 8 is
    // row 2, column 0, i.e. a3, and square 13 is row 3, column 3, i.e. d4
    // (`draughtsColumn(13) = ((13 & 3) << 1) | ((13 >> 2) & 1) = 2 | 1`).
    expect(draughts.draughtsRow(8)).toBe(2);
    expect(draughts.draughtsColumn(8)).toBe(0);
    expect(
      describeBoardEvent("draughts", { kind: "move", move: { kind: "step", from: 8, to: 13 } }),
    ).toEqual({ kind: "notation", text: "a3–d4" });
    expect(
      describeBoardEvent("draughts", {
        kind: "move",
        move: { kind: "capture", from: 8, path: [17, 26] },
      }),
    ).toEqual({ kind: "notation", text: "a3×c5×e7" });
  });

  it("names a morris point on the drawn lattice, and shows the piece a mill takes", () => {
    // The lattice is stated in MLIN_LAYOUT: point 0 is the top-left corner (a7)
    // and point 23 the bottom-right (g1).
    expect(MLIN_LAYOUT[0]).toEqual([0, 0]);
    expect(MLIN_LAYOUT[23]).toEqual([6, 6]);
    expect(
      describeBoardEvent("mlin", { kind: "move", move: { kind: "place", point: 0, remove: null } }),
    ).toEqual({ kind: "notation", text: "a7" });
    expect(
      describeBoardEvent("mlin", {
        kind: "move",
        move: { kind: "place", point: 1, remove: 21 },
      }),
    ).toEqual({ kind: "notation", text: "d7×a1" });
    expect(
      describeBoardEvent("mlin", {
        kind: "move",
        move: { kind: "move", from: 0, to: 1, remove: null },
      }),
    ).toEqual({ kind: "notation", text: "a7–d7" });
  });

  it("writes a four-in-a-row drop as its column and a backgammon turn as its plays", () => {
    expect(
      describeBoardEvent("four-in-a-row", { kind: "move", move: { column: 0 } }),
    ).toEqual({ kind: "notation", text: "a" });
    expect(
      describeBoardEvent("backgammon", {
        kind: "move",
        move: {
          plays: [
            { from: 12, to: 7, die: 5 },
            { from: "bar", to: 22, die: 2 },
            { from: 3, to: "off", die: 4 },
          ],
        },
      }),
    ).toEqual({ kind: "notation", text: "13/8 bar/23 4/off" });
  });

  it("refuses to spell an event that is not a move: dice and the cube are not notation", () => {
    // A roll, a pass and a double are drawn from their own fields — the dice the
    // event carries and one word of the module's copy — so asking this for their
    // notation is a caller's bug rather than a sentence to invent.
    for (const event of [{ kind: "roll", dice: [3, 5] }, { kind: "pass" }, { kind: "double" }] as const) {
      expect(() => describeBoardEvent("backgammon", event)).toThrow(/invalid game state/);
    }
  });

  it("writes a ludo play as the token that moved and where it went", () => {
    expect(
      describeBoardEvent("ludo", {
        kind: "move",
        move: { token: 2, die: 5, from: 0, to: 1 },
      }),
    ).toEqual({ kind: "notation", text: "F3 0→1" });
  });
});

describe("the morris lattice", () => {
  /**
   * The table is a DRAWING, so it is checked against the rules it has to agree
   * with: every neighbour pair and every mill in `MLIN_NEIGHBOURS` / `MLIN_MILLS`
   * must be two points joined along a row or a column of the lattice with nothing
   * standing between them. A table that satisfied the rules without the picture
   * would draw a piece on a line that is not there.
   */
  it("is the board the engine's own neighbours and mills describe", () => {
    const at = (point: number): readonly [number, number] => {
      const position = MLIN_LAYOUT[point];
      if (position === undefined) throw new Error(`no layout for point ${point}`);
      return position;
    };
    const between = (one: readonly [number, number], other: readonly [number, number]): string => {
      const [c1, r1] = one;
      const [c2, r2] = other;
      if (c1 !== c2 && r1 !== r2) throw new Error(`points ${String(one)} and ${String(other)} are not on a line`);
      const line: string[] = [];
      const steps = Math.max(Math.abs(c2 - c1), Math.abs(r2 - r1));
      for (let step = 1; step <= steps; step += 1) {
        line.push(
          `${Math.min(c1, c2) + (c1 === c2 ? 0 : step)}:${Math.min(r1, r2) + (r1 === r2 ? 0 : step)}`,
        );
      }
      return line.join(",");
    };

    // Every point that lies strictly between two points of a line, as a set of
    // lattice cells, so "nothing stands between them" is a lookup.
    for (const [point, neighbours] of mlin.MLIN_NEIGHBOURS.entries()) {
      for (const neighbour of neighbours) {
        const cells = between(at(point), at(neighbour)).split(",");
        const inside = cells.slice(0, -1);
        for (const cell of inside) {
          const [column, row] = cell.split(":").map(Number) as [number, number];
          const occupied = MLIN_LAYOUT.some(([c, r]) => c === column && r === row);
          expect(occupied).toBe(false);
        }
      }
    }
    for (const mill of mlin.MLIN_MILLS) {
      const [a, b, c] = mill as [number, number, number];
      expect(between(at(a), at(c))).toContain(`${at(b)[0]}:${at(b)[1]}`);
    }
  });
});
