import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOARDS_GAMES,
  boardEngine,
  backgammon,
  createSeededRandom,
  draughts,
  fourInARow,
  ludo,
  mlin,
  moveEvent,
  replayBoard,
  reversi,
  rollEvent,
} from "@nexus/core";
import type { BoardEvent, BoardSeatKind, BoardsGame } from "@nexus/core";
import {
  BoardsStore,
  BoardsValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../../index.js";

/**
 * The board games' store (migration 089). What is pinned here is the module's
 * whole promise about a saved game: **a game is its seed plus its event log, and
 * the position it stores is the position that log produces** — per game, because
 * six engines means six chances for the fold to be wrong.
 *
 * The log in every round trip below is built by PLAYING the engine, not by hand:
 * `play` runs the module's own turn loop (roll when the position asks for a roll,
 * play the first legal move, pass when the rules allow nothing else), so a test
 * that passed here would have passed with a page driving it.
 */

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:30:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-boards-"));
  db = openDatabase({ path: join(dir, "boards.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(name = "P"): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

function store(profileId = createProfile()): BoardsStore {
  return new BoardsStore(db.raw, profileId);
}

/** A game's opening position, as this test plays each of the six. */
function opening(game: BoardsGame): unknown {
  switch (game) {
    case "reversi":
      return reversi.toJSON(reversi.initialState());
    case "draughts":
      return draughts.toJSON(draughts.initialState({ kind: "english" }));
    case "mlin":
      return mlin.toJSON(mlin.initialState());
    case "four-in-a-row":
      return fourInARow.toJSON(fourInARow.initialState());
    case "backgammon":
      // The cube in play, because that is the shape a doubling cube game has and
      // the one `initial` has to reproduce.
      return backgammon.toJSON(backgammon.initialState({ cubeEnabled: true }));
    case "ludo":
      return ludo.toJSON(ludo.initialState({ seats: 3 }));
  }
}

/**
 * Plays `turns` of the module's own loop and answers the position and the log —
 * the input to a save. The moves are the engine's first legal ones; nothing here
 * evaluates or searches, so a case costs microseconds.
 */
function play(
  game: BoardsGame,
  seed: number,
  turns: number,
  from: unknown = opening(game),
): { state: unknown; events: BoardEvent[] } {
  const engine = boardEngine(game);
  const rng = createSeededRandom(seed);
  let state = engine.fromJSON(from);
  const events: BoardEvent[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    if (engine.outcome(state).status !== "in_progress") break;
    if (engine.needsRoll(state)) {
      state = engine.roll(state, rng);
      events.push(rollEvent(game, state));
      // A roll that grants no die at all (ludo's third six) has passed the turn.
      if (engine.needsRoll(state)) continue;
    }
    const moves = engine.legalMoves(state);
    if (moves.length === 0) {
      events.push({ kind: "pass" });
      state = engine.step(state, { kind: "pass" });
      continue;
    }
    const event = moveEvent(game, state, moves[0]);
    events.push(event);
    state = engine.step(state, event);
  }
  return { state, events };
}

describe("the game in progress", () => {
  it("round-trips a save for every one of the six games", () => {
    const boards = store();
    for (const game of BOARDS_GAMES) {
      const seats: BoardSeatKind[] = game === "ludo" ? ["human", "computer", "computer"] : ["human", "computer"];
      const played = play(game, 11, 6);
      const saved = boards.save(
        { game, state: played.state, events: played.events, seed: 11, level: 1, seats },
        NOW,
      );
      expect(saved.game).toBe(game);

      const resumed = boards.getSave(game);
      expect(resumed).not.toBeNull();
      // The resumed position is the position that was played, read back through
      // the same engine the page will draw it with, and the log is the log.
      expect(boardEngine(game).json(resumed?.state)).toEqual(boardEngine(game).json(played.state));
      expect(resumed?.events).toEqual(played.events);
      expect(resumed?.seed).toBe(11);
      expect(resumed?.level).toBe(1);
      expect(resumed?.seats).toEqual(seats);
      expect(resumed?.startedAt).toBe(NOW);
      expect(resumed?.updatedAt).toBe(NOW);
      // And the store's own invariant, restated where it is cheapest to see: the
      // log folds back to the state that was stored.
      expect(
        boardEngine(game).json(replayBoard(game, 11, played.events, resumed?.state)),
      ).toEqual(boardEngine(game).json(resumed?.state));
    }
    expect(boards.listSaves()).toHaveLength(6);
  });

  it("keeps one game per game, replacing it and keeping the instant the game began", () => {
    const boards = store();
    const first = play("reversi", 5, 2);
    const started = boards.save(
      { game: "reversi", state: first.state, events: first.events, seed: 5, level: 1, seats: ["human", "computer"] },
      NOW,
    );
    const second = play("reversi", 5, 4);
    const replaced = boards.save(
      { game: "reversi", state: second.state, events: second.events, seed: 5, level: 2, seats: ["human", "computer"] },
      LATER,
    );

    expect(boards.listSaves()).toHaveLength(1);
    expect(replaced.startedAt).toBe(started.startedAt);
    expect(replaced.updatedAt).toBe(LATER);
    expect(replaced.level).toBe(2);
    expect(replaced.moves).toBeGreaterThan(started.moves);
  });

  it("counts moves and rolls apart, so a move list and a length cannot be confused", () => {
    const boards = store();
    const played = play("backgammon", 7, 3);
    const saved = boards.save(
      { game: "backgammon", state: played.state, events: played.events, seed: 7, level: 1, seats: ["human", "computer"] },
      NOW,
    );
    const moves = played.events.filter((event) => event.kind === "move").length;
    const rolls = played.events.filter((event) => event.kind === "roll").length;
    expect(rolls).toBeGreaterThan(0);
    expect(saved.moves).toBe(moves);
    expect(saved.moves).not.toBe(played.events.length);
  });

  it("refuses a position and a log that describe different games, rather than storing both", () => {
    const boards = store();
    const played = play("reversi", 3, 4);
    const trimmed = played.events.slice(0, played.events.length - 1);

    expect(() =>
      boards.save(
        { game: "reversi", state: played.state, events: trimmed, seed: 3, level: 1, seats: ["human", "computer"] },
        NOW,
      ),
    ).toThrow(/not the position its move log produces/);
    expect(boards.listSaves()).toEqual([]);
  });

  it("refuses a log the rules do not allow", () => {
    const boards = store();
    const played = play("reversi", 3, 2);
    // A placement on a cell the first move of this game cannot be: the engine
    // refuses it, and the store turns that into its own sentence.
    const forged: BoardEvent[] = [{ kind: "move", move: { kind: "place", cell: 0 } }];
    expect(() =>
      boards.save(
        { game: "reversi", state: played.state, events: forged, seed: 3, level: 1, seats: ["human", "computer"] },
        NOW,
      ),
    ).toThrow(BoardsValidationError);
  });

  it("refuses a seed, a level, a seat list and a game id the schema would not hold", () => {
    const boards = store();
    const played = play("reversi", 3, 2);
    const base = {
      game: "reversi" as BoardsGame,
      state: played.state,
      events: played.events as readonly unknown[],
      seed: 3,
      level: 1 as number | null,
      seats: ["human", "computer"] as readonly unknown[],
    };

    expect(() => boards.save({ ...base, seed: -1 }, NOW)).toThrow(/from 0 to 4294967295/);
    expect(() => boards.save({ ...base, seed: 2 ** 32 }, NOW)).toThrow(/from 0 to 4294967295/);
    expect(() => boards.save({ ...base, level: 4 }, NOW)).toThrow(/from 1 to 3/);
    expect(() => boards.save({ ...base, level: null }, NOW)).toThrow(/must name a level/);
    expect(() =>
      boards.save({ ...base, level: null, seats: ["human", "human"] }, NOW),
    ).not.toThrow();
    expect(() => boards.save({ ...base, level: 1, seats: ["human", "human"] }, NOW)).toThrow(
      /has no level/,
    );
    expect(() => boards.save({ ...base, seats: ["human"] }, NOW)).toThrow(/played with 2 seats/);
    expect(() => boards.save({ ...base, seats: ["human", "robot"] }, NOW)).toThrow(
      /"human" or "computer"/,
    );
    expect(() => boards.save({ ...base, game: "chess" as BoardsGame }, NOW)).toThrow(
      /not one of this module's games/,
    );
    expect(() => boards.save({ ...base, state: { discs: [1] } }, NOW)).toThrow(
      /not one the rules allow/,
    );
    expect(() => boards.save({ ...base, events: [{ kind: "roll", dice: [7] }] }, NOW)).toThrow(
      /from 1 to 6/,
    );
    expect(() => boards.save({ ...base, events: [{ kind: "hop" }] }, NOW)).toThrow(
      /not "hop"/,
    );
  });

  it("empties a slot, and clearing one that is not there is not an error", () => {
    const boards = store();
    const played = play("mlin", 2, 2);
    boards.save(
      { game: "mlin", state: played.state, events: played.events, seed: 2, level: 1, seats: ["human", "computer"] },
      NOW,
    );
    boards.remove("mlin");
    expect(boards.getSave("mlin")).toBeNull();
    expect(() => boards.remove("mlin")).not.toThrow();
  });
});

describe("the record against the computer", () => {
  /** A four-in-a-row game seat 0 wins on move seven — the shortest line a person can play. */
  function wonFour(): { state: unknown; events: BoardEvent[] } {
    const engine = boardEngine("four-in-a-row");
    let state = engine.fromJSON(opening("four-in-a-row"));
    const events: BoardEvent[] = [];
    for (const column of [0, 1, 0, 1, 0, 1, 0]) {
      const event = moveEvent("four-in-a-row", state, { column });
      events.push(event);
      state = engine.step(state, event);
    }
    expect(engine.outcome(state)).toEqual({ status: "win", winner: 0 });
    return { state, events };
  }

  it("records a win for the person, under the engine's own level", () => {
    const boards = store();
    const game = wonFour();
    const recorded = boards.finish(
      { game: "four-in-a-row", ...game, seed: 1, level: 2, seats: ["human", "computer"], ending: "position" },
      NOW,
    );

    expect(recorded).toBe("won");
    const row = boards.listStats().find((stats) => stats.game === "four-in-a-row" && stats.level === 2);
    expect(row).toEqual({
      game: "four-in-a-row",
      variant: "",
      level: 2,
      played: 1,
      won: 1,
      drawn: 0,
      lost: 0,
      updatedAt: NOW,
    });
    expect(boards.listSaves()).toEqual([]);
  });

  it("reads the winner from the position, not from the caller", () => {
    const boards = store();
    const game = wonFour();
    // The same finished game, told from the other side of the board: seat 1 is
    // the person, so the very same position is a loss.
    expect(
      boards.finish(
        { game: "four-in-a-row", ...game, seed: 1, level: 1, seats: ["computer", "human"], ending: "position" },
        NOW,
      ),
    ).toBe("lost");
  });

  it("keeps the record after the slot is gone, because the record outlives the game", () => {
    const boards = store();
    const game = wonFour();
    boards.finish(
      { game: "four-in-a-row", ...game, seed: 1, level: 1, seats: ["human", "computer"], ending: "position" },
      NOW,
    );
    const record = boards.listStats().find((stats) => stats.game === "four-in-a-row" && stats.level === 1);
    expect(record?.played).toBe(1);
  });

  it("counts a draughts game under the rule set it was played by", () => {
    const boards = store();
    const played = play("draughts", 9, 3, draughts.toJSON(draughts.initialState({ kind: "russian" })));
    boards.finish(
      { game: "draughts", ...played, seed: 9, level: 3, seats: ["human", "computer"], ending: "resigned" },
      NOW,
    );
    const russian = boards
      .listStats()
      .find((stats) => stats.game === "draughts" && stats.variant === "russian" && stats.level === 3);
    const english = boards
      .listStats()
      .find((stats) => stats.game === "draughts" && stats.variant === "english" && stats.level === 3);
    expect(russian).toMatchObject({ played: 1, lost: 1 });
    expect(english).toMatchObject({ played: 0 });
  });

  it("keeps no record for a game between two people, an abandoned game, or a ludo table", () => {
    const boards = store();
    const played = play("reversi", 4, 2);
    const endings = [
      { game: "reversi" as BoardsGame, ...played, seed: 4, level: null, seats: ["human", "human"], ending: "resigned" as const },
      { game: "reversi" as BoardsGame, ...played, seed: 4, level: 1, seats: ["human", "computer"], ending: "abandoned" as const },
      { game: "ludo" as BoardsGame, ...play("ludo", 4, 2), seed: 4, level: 1, seats: ["human", "computer", "computer"], ending: "abandoned" as const },
    ];
    for (const input of endings) {
      expect(boards.finish(input, NOW)).toBeNull();
    }
    expect(boards.listStats().every((stats) => stats.played === 0)).toBe(true);
  });

  it("refuses an ending by position on a game that is still in progress", () => {
    const boards = store();
    const played = play("reversi", 4, 2);
    expect(() =>
      boards.finish(
        { game: "reversi", ...played, seed: 4, level: 1, seats: ["human", "computer"], ending: "position" },
        NOW,
      ),
    ).toThrow(/not over/);
  });

  it("counts a refused doubling cube as a win for the person who offered it", () => {
    const boards = store();
    const played = play("backgammon", 6, 2);
    expect(
      boards.finish(
        { game: "backgammon", ...played, seed: 6, level: 1, seats: ["human", "computer"], ending: "cube-declined" },
        NOW,
      ),
    ).toBe("won");
    const row = boards
      .listStats()
      .find((stats) => stats.game === "backgammon" && stats.level === 1);
    expect(row).toMatchObject({ played: 1, won: 1 });
  });

  it("reads a refused cube in the other direction too, from the side to move", () => {
    const boards = store();
    const played = play("backgammon", 6, 2, opening("backgammon"));
    // Two turns end where they began: seat 0 rolled and played, then seat 1 did,
    // so the side to move — the doubler — is seat 0.
    expect((played.state as { toMove: number }).toMove).toBe(0);
    // The engine offered and the person refused: a loss for the person.
    expect(
      boards.finish(
        { game: "backgammon", ...played, seed: 6, level: 1, seats: ["computer", "human"], ending: "cube-declined" },
        NOW,
      ),
    ).toBe("lost");
  });
});

describe("the module's preference", () => {
  it("answers the shipped default where there is no row, and keeps what is written", () => {
    const boards = store();
    expect(boards.settings()).toEqual({ defaultLevel: 2 });
    expect(boards.setDefaultLevel(3, NOW)).toEqual({ defaultLevel: 3 });
    expect(boards.settings()).toEqual({ defaultLevel: 3 });
    expect(() => boards.setDefaultLevel(0, NOW)).toThrow(/from 1 to 3/);
  });
});

describe("the board games archive section", () => {
  it("round-trips the saves, the record and the preference between two profiles", () => {
    const source = store();
    const target = store();
    // The game in progress is a REVERSI one: finishing the four-in-a-row game
    // below takes that game's slot away (a finished game has nothing to resume),
    // which is exactly why the two have to be different games here.
    const played = play("reversi", 1, 4);
    source.save(
      { game: "reversi", state: played.state, events: played.events, seed: 1, level: 2, seats: ["human", "computer"] },
      NOW,
    );
    const win = (() => {
      const engine = boardEngine("four-in-a-row");
      let state = engine.fromJSON(opening("four-in-a-row"));
      const events: BoardEvent[] = [];
      for (const column of [0, 1, 0, 1, 0, 1, 0]) {
        const event = moveEvent("four-in-a-row", state, { column });
        events.push(event);
        state = engine.step(state, event);
      }
      return { state, events };
    })();
    source.finish(
      { game: "four-in-a-row", ...win, seed: 1, level: 2, seats: ["human", "computer"], ending: "position" },
      LATER,
    );
    source.setDefaultLevel(3, LATER);

    const archive = source.exportData();
    expect(archive.version).toBe(1);
    target.importData(archive);

    expect(target.getSave("reversi")?.events).toEqual(played.events);
    expect(target.listStats().find((stats) => stats.game === "four-in-a-row" && stats.level === 2)).toMatchObject(
      { played: 1, won: 1, updatedAt: LATER },
    );
    expect(target.settings()).toEqual({ defaultLevel: 3 });
  });

  it("empties the archived state when the section names no board games entry", () => {
    const boards = store();
    const played = play("reversi", 1, 2);
    boards.save(
      { game: "reversi", state: played.state, events: played.events, seed: 1, level: 1, seats: ["human", "computer"] },
      NOW,
    );
    boards.setDefaultLevel(3, NOW);

    // What a restore of an archive written before this module existed hands over:
    // a restore replaces a profile whole, so this is a profile with no board games.
    boards.importData({ version: 1, saves: [], stats: [], settings: null });

    expect(boards.listSaves()).toEqual([]);
    expect(boards.listStats().every((stats) => stats.played === 0)).toBe(true);
    expect(boards.settings()).toEqual({ defaultLevel: 2 });
  });

  it("refuses an archive it cannot read whole, leaving the profile exactly as it found it", () => {
    const boards = store();
    const played = play("reversi", 1, 2);
    boards.save(
      { game: "reversi", state: played.state, events: played.events, seed: 1, level: 1, seats: ["human", "computer"] },
      NOW,
    );
    const good = boards.exportData();

    for (const broken of [
      { ...good, version: 99 },
      { ...good, saves: [{ ...good.saves[0], seed: -1 }] },
      { ...good, saves: [{ ...good.saves[0], events: [] }] },
      { version: 1, saves: [], stats: [{ game: "reversi", variant: "", level: 1, played: 3, won: 1, drawn: 0, lost: 0, updatedAt: NOW }], settings: null },
      { version: 1, saves: [], stats: [], settings: { defaultLevel: 9 } },
    ]) {
      expect(() => boards.importData(broken)).toThrow(BoardsValidationError);
      expect(boards.getSave("reversi")?.events).toEqual(played.events);
      expect(boards.settings()).toEqual({ defaultLevel: 2 });
    }
  });
});
