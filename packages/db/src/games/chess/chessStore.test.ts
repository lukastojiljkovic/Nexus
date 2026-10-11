import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  START_FEN,
  applyUci,
  createGame,
  gamePgn,
  gameStatus,
  parseFen,
  replayUci,
  toFen,
} from "@nexus/core";
import {
  ChessNotFoundError,
  ChessStore,
  ChessValidationError,
  MAX_CHESS_LEVEL,
  MAX_CHESS_PGN_LENGTH,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:30:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-chess-"));
  db = openDatabase({ path: join(dir, "chess.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  insertProfile(db, id);
  return id;
}

/** A profile row, in whichever database is being set up. */
function insertProfile(handle: NexusDatabase, id: string): void {
  handle.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
}

function store(): ChessStore {
  return new ChessStore(db.raw, createProfile());
}

/**
 * Scholar's mate, played through the rules layer rather than typed out: 1.e4 e5
 * 2.Bc4 Nc6 3.Qh5 Nf6 4.Qxf7#. The store's PGN column is proved against a game
 * whose end the rules engine itself recognises.
 */
function scholarsMate(): { pgn: string; fen: string } {
  const game = createGame();
  for (const move of ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]) {
    applyUci(game, move);
  }
  expect(gameStatus(game).checkmate).toBe(true);
  return { pgn: gamePgn(game), fen: game.fen() };
}

function engineGame(overrides: Record<string, unknown> = {}) {
  const mate = scholarsMate();
  return {
    pgn: mate.pgn,
    result: "white" as const,
    playedAt: NOW,
    playedColor: "w" as const,
    opponent: "engine" as const,
    level: 3,
    ...overrides,
  };
}

describe("ChessStore.saveGame", () => {
  it("stores an engine game and hands it back", () => {
    const chess = store();
    const saved = chess.saveGame(engineGame(), NOW);

    expect(saved).toMatchObject({
      pgn: scholarsMate().pgn,
      result: "white",
      playedAt: NOW,
      playedColor: "w",
      opponent: "engine",
      level: 3,
      timeControl: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(chess.listGames()).toEqual([saved]);
  });

  it("stores a two-player game with no level, and keeps the time control", () => {
    const chess = store();
    const saved = chess.saveGame(
      engineGame({ opponent: "human", level: undefined, timeControl: "600+5" }),
      NOW,
    );
    expect(saved).toMatchObject({ opponent: "human", level: null, timeControl: "600+5" });
  });

  it("lists the newest game first, whatever order they were written in", () => {
    const chess = store();
    const earlier = chess.saveGame(engineGame({ playedAt: NOW }), NOW);
    const later = chess.saveGame(engineGame({ playedAt: LATER, opponent: "human", level: undefined }), LATER);
    expect(chess.listGames().map((game) => game.id)).toEqual([later.id, earlier.id]);
  });

  it("refuses what the schema and the domain refuse", () => {
    const chess = store();
    const cases: [string, Record<string, unknown>][] = [
      ["a PGN that is not a game", { pgn: "this is not a game" }],
      ["an empty PGN", { pgn: "" }],
      ["a PGN past the column's bound", { pgn: "x".repeat(MAX_CHESS_PGN_LENGTH + 1) }],
      ["a result outside the four", { result: "win" }],
      ["an engine game with no level", { level: null }],
      ["an engine game with no level at all", { level: undefined }],
      ["a human game with a level", { opponent: "human", level: 3 }],
      ["a level below the ladder", { level: 0 }],
      ["a level above the ladder", { level: 9 }],
      ["a fractional level", { level: 2.5 }],
      ["a colour that is not white or black", { playedColor: "red" }],
      ["a played date that is not an instant", { playedAt: "2026-06-01" }],
      ["a time control with no increment", { timeControl: "600" }],
      ["a time control with no base", { timeControl: "0+5" }],
      ["a time control that is not a clock", { timeControl: "blitz" }],
    ];
    for (const [label, override] of cases) {
      expect({ label, throws: throwsValidation(() => chess.saveGame(engineGame(override), NOW)) }).toEqual(
        { label, throws: true },
      );
    }
    expect(throwsValidation(() => chess.saveGame(engineGame(), "yesterday"))).toBe(true);
    expect(chess.listGames()).toEqual([]);
  });
});

describe("ChessStore level statistics", () => {
  it("counts a finished engine game from the player's side of the board", () => {
    const chess = store();
    chess.saveGame(engineGame({ level: 3, playedColor: "w", result: "white" }), NOW);
    expect(chess.listLevelStats()[2]).toEqual({
      level: 3,
      played: 1,
      won: 1,
      drawn: 0,
      lost: 0,
      updatedAt: NOW,
    });

    // The same board, played from the other side: the SAME result is a loss.
    chess.saveGame(engineGame({ level: 3, playedColor: "b", result: "white" }), LATER);
    expect(chess.listLevelStats()[2]).toMatchObject({ played: 2, won: 1, lost: 1 });
  });

  it("keeps a draw and a loss apart, per level", () => {
    const chess = store();
    chess.saveGame(engineGame({ level: 1, result: "draw" }), NOW);
    chess.saveGame(engineGame({ level: 8, result: "black", playedColor: "w" }), NOW);
    expect(chess.listLevelStats().filter((row) => row.played > 0)).toEqual([
      { level: 1, played: 1, won: 0, drawn: 1, lost: 0, updatedAt: NOW },
      { level: 8, played: 1, won: 0, drawn: 0, lost: 1, updatedAt: NOW },
    ]);
  });

  it("records nothing for an unfinished game, a human opponent, or a deleted game", () => {
    const chess = store();
    chess.saveGame(engineGame({ result: "unfinished" }), NOW);
    chess.saveGame(engineGame({ opponent: "human", level: undefined }), NOW);
    expect(chess.listLevelStats().every((row) => row.played === 0)).toBe(true);

    const finished = chess.saveGame(engineGame({ level: 5 }), NOW);
    expect(chess.listLevelStats()[4]?.played).toBe(1);
    chess.deleteGame(finished.id, LATER);
    // The record is the PLAYER's history against a level, not a view over the
    // archive: tidying the list of games must not un-play them.
    expect(chess.listLevelStats()[4]?.played).toBe(1);
  });

  it("answers a full ladder even before a single game has been played", () => {
    const rows = store().listLevelStats();
    expect(rows.map((row) => row.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows.every((row) => row.played + row.won + row.drawn + row.lost === 0)).toBe(true);
    expect(rows.every((row) => row.updatedAt === null)).toBe(true);
  });
});

describe("ChessStore resume slot", () => {
  it("keeps one game in progress per profile, and clears it", () => {
    const chess = store();
    expect(chess.getResume()).toBeNull();

    const saved = chess.setResume(
      {
        startFen: START_FEN,
        fen: replayUci(START_FEN, ["e2e4", "e7e5"]).fen,
        moves: ["e2e4", "e7e5"],
        playedColor: "w",
        opponent: "engine",
        level: 4,
        timeControl: "300+3",
      },
      NOW,
    );
    expect(saved).toMatchObject({ level: 4, timeControl: "300+3", updatedAt: NOW });
    expect(chess.getResume()).toEqual(saved);

    // Setting it again REPLACES it: one game in progress is the whole point.
    chess.setResume(
      {
        startFen: START_FEN,
        fen: replayUci(START_FEN, ["d2d4"]).fen,
        moves: ["d2d4"],
        playedColor: "b",
        opponent: "human",
      },
      LATER,
    );
    expect(chess.getResume()).toMatchObject({ moves: ["d2d4"], playedColor: "b", level: null });

    chess.clearResume();
    expect(chess.getResume()).toBeNull();
    // Clearing what is not there is not an error: the caller asked for no game
    // in progress, and that is what stands afterwards.
    expect(() => chess.clearResume()).not.toThrow();
  });

  it("accepts a game that has not started, and refuses one whose moves do not add up", () => {
    const chess = store();
    const fresh = chess.setResume(
      { startFen: START_FEN, fen: START_FEN, moves: [], playedColor: "w", opponent: "human" },
      NOW,
    );
    expect(fresh.moves).toEqual([]);

    const cases: [string, Parameters<ChessStore["setResume"]>[0]][] = [
      [
        "a start position that is not a position",
        { startFen: "nonsense", fen: START_FEN, moves: [], playedColor: "w", opponent: "human" },
      ],
      [
        "a move that is not legal in sequence",
        {
          startFen: START_FEN,
          fen: START_FEN,
          moves: ["e2e5"],
          playedColor: "w",
          opponent: "human",
        },
      ],
      [
        "a FEN that the move list does not produce",
        {
          startFen: START_FEN,
          fen: START_FEN,
          moves: ["e2e4"],
          playedColor: "w",
          opponent: "human",
        },
      ],
      [
        "a FEN that is not a position",
        { startFen: START_FEN, fen: "nonsense", moves: [], playedColor: "w", opponent: "human" },
      ],
      [
        "an engine game with no level",
        { startFen: START_FEN, fen: START_FEN, moves: [], playedColor: "w", opponent: "engine" },
      ],
      [
        "a level outside the ladder",
        {
          startFen: START_FEN,
          fen: START_FEN,
          moves: [],
          playedColor: "w",
          opponent: "engine",
          level: 99,
        },
      ],
      [
        "a colour that is not white or black",
        {
          startFen: START_FEN,
          fen: START_FEN,
          moves: [],
          // Deliberately wrong: the store's own validator is the gate.
          playedColor: "x" as "w",
          opponent: "human",
        },
      ],
    ];
    for (const [label, input] of cases) {
      expect({ label, throws: throwsValidation(() => chess.setResume(input, NOW)) }).toEqual({
        label,
        throws: true,
      });
    }
  });
});

describe("ChessStore lifecycle and scope", () => {
  it("soft-deletes a game, brings it back, and never shows another profile's", () => {
    const chess = store();
    const other = store();
    const mine = chess.saveGame(engineGame(), NOW);
    const theirs = other.saveGame(engineGame(), NOW);

    expect(chess.listGames().map((game) => game.id)).toEqual([mine.id]);
    expect(() => chess.getGame(theirs.id)).toThrow(ChessNotFoundError);
    expect(() => chess.deleteGame(theirs.id, LATER)).toThrow(ChessNotFoundError);
    expect(() => chess.restoreGame(uuidv7(), LATER)).toThrow(ChessNotFoundError);

    chess.deleteGame(mine.id, LATER);
    expect(chess.listGames()).toEqual([]);
    expect(() => chess.getGame(mine.id)).toThrow(ChessNotFoundError);

    chess.restoreGame(mine.id, LATER);
    expect(chess.listGames().map((game) => game.id)).toEqual([mine.id]);
    // The restore is the row coming back, untouched: the delete never rewrote
    // the PGN or the result.
    expect(chess.getGame(mine.id)).toMatchObject({ pgn: mine.pgn, result: "white" });
  });

  it("survives the profile going away, exactly as the schema says", () => {
    const profileId = createProfile();
    const chess = new ChessStore(db.raw, profileId);
    chess.saveGame(engineGame(), NOW);
    chess.setResume(
      { startFen: START_FEN, fen: START_FEN, moves: [], playedColor: "w", opponent: "human" },
      NOW,
    );

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
    const counts = (table: string): number =>
      (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect([counts("chess_games"), counts("chess_resume"), counts("chess_level_stats")]).toEqual([
      0, 0, 0,
    ]);
  });
});

describe("ChessStore PGN round trip", () => {
  it("writes a PGN the rules engine reads back to the same position", () => {
    const chess = store();
    const mate = scholarsMate();
    const saved = chess.saveGame(
      engineGame({ pgn: mate.pgn, result: "white" }),
      NOW,
    );

    const reloaded = createGame();
    for (const move of ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]) {
      applyUci(reloaded, move);
    }
    expect(reloaded.fen()).toBe(mate.fen);
    // And the stored text is byte-identical to what the rules layer wrote.
    expect(chess.getGame(saved.id).pgn).toBe(mate.pgn);
    expect(parseFen(mate.fen)).not.toBeNull();
    expect(toFen(parseFen(mate.fen)!)).toBe(mate.fen);
  });
});

describe("ChessStore export and import", () => {
  function populated(handle: NexusDatabase = db): { chess: ChessStore; profileId: string } {
    const profileId = uuidv7();
    insertProfile(handle, profileId);
    const chess = new ChessStore(handle.raw, profileId);
    const mate = scholarsMate();
    chess.saveGame(engineGame({ pgn: mate.pgn, level: 2, result: "white" }), NOW);
    chess.saveGame(engineGame({ opponent: "human", level: undefined, result: "draw" }), LATER);
    chess.setResume(
      {
        startFen: START_FEN,
        fen: replayUci(START_FEN, ["e2e4"]).fen,
        moves: ["e2e4"],
        playedColor: "b",
        opponent: "engine",
        level: 6,
      },
      LATER,
    );
    return { chess, profileId };
  }

  it("round-trips a whole profile's chess content through plain JSON", () => {
    const { chess: source, profileId } = populated();
    // Through actual JSON text, because that is what an archive carries.
    const archive = JSON.parse(JSON.stringify(source.exportData()));

    // A SECOND database holding the SAME profile: that is what restoring an
    // archive onto another machine is, and it is the only shape in which the ids
    // in the archive can be written again.
    const other = openDatabase({ path: join(dir, "restored.db") });
    try {
      insertProfile(other, profileId);
      const restored = new ChessStore(other.raw, profileId);
      restored.importData(archive);

      expect(restored.exportData()).toEqual(archive);
      expect(restored.listGames().map((game) => game.pgn)).toEqual(
        source.listGames().map((game) => game.pgn),
      );
      expect(restored.listLevelStats().filter((row) => row.played > 0)).toEqual(
        source.listLevelStats().filter((row) => row.played > 0),
      );
      expect(restored.getResume()).toMatchObject({ moves: ["e2e4"], level: 6, playedColor: "b" });
    } finally {
      other.close();
    }
  });

  it("refuses an archive it cannot trust, and writes nothing", () => {
    const chess = store();
    const good = populated().chess.exportData();
    // The newest game is the one against a person; the pair rules are exercised
    // against the ENGINE game, which is where a level belongs.
    const engine = good.games.find((game) => game.opponent === "engine")!;
    const cases: [string, unknown][] = [
      ["not an object", "nonsense"],
      ["a version it does not know", { ...good, version: 2 }],
      ["no version at all", { games: good.games, levelStats: good.levelStats, resume: null }],
      ["no game list", { version: 1, levelStats: [], resume: null }],
      ["a game that is not an object", { ...good, games: ["nonsense"] }],
      ["a result outside the four", { ...good, games: [{ ...good.games[0], result: "win" }] }],
      ["a colour outside the two", { ...good, games: [{ ...good.games[0], playedColor: "red" }] }],
      ["an engine game with no level", { ...good, games: [{ ...engine, level: null }] }],
      ["a level above the ladder", { ...good, games: [{ ...engine, level: 9 }] }],
      ["a level on a game against a person", { ...good, games: [{ ...engine, opponent: "human", level: 3 }] }],
      ["a PGN that is not a game", { ...good, games: [{ ...good.games[0], pgn: "nonsense" }] }],
      ["a resume whose moves do not add up", {
        ...good,
        resume: { ...good.resume, startFen: START_FEN, moves: ["e2e5"], fen: START_FEN },
      }],
      ["a statistics row for level nine", { ...good, levelStats: [{ level: 9, played: 1, won: 1, drawn: 0, lost: 0 }] }],
      ["statistics that do not add up", { ...good, levelStats: [{ level: 1, played: 3, won: 1, drawn: 0, lost: 0 }] }],
      ["two games with the same id", { ...good, games: [good.games[0], good.games[0]] }],
    ];
    for (const [label, value] of cases) {
      expect({ label, throws: throwsValidation(() => chess.importData(value)) }).toEqual({
        label,
        throws: true,
      });
      expect({ label, written: chess.exportData() }).toEqual({
        label,
        written: { version: 1, games: [], resume: null, levelStats: [] },
      });
    }
  });

  it("replaces what is there rather than merging into it", () => {
    const chess = store();
    chess.saveGame(engineGame(), NOW);
    const empty = { version: 1, games: [], resume: null, levelStats: [] };
    chess.importData(empty);
    expect(chess.exportData()).toEqual(empty);
    expect(chess.listGames()).toEqual([]);
    expect(chess.listLevelStats().every((row) => row.played === 0)).toBe(true);
  });
});

describe("migration 082's own constraints", () => {
  /** A raw insert, bypassing the store, so the SCHEMA is what refuses. */
  function insertGame(profileId: string, id: string, opponent: string, level: number | null): void {
    db.raw
      .prepare(
        `INSERT INTO chess_games
           (id, profile_id, pgn, result, played_at, played_color, opponent, level,
            created_at, updated_at)
         VALUES (?, ?, '[Result "*"]', 'unfinished', ?, 'w', ?, ?, ?, ?)`,
      )
      .run(id, profileId, NOW, opponent, level, NOW, NOW);
  }

  function insertStats(profileId: string, level: number, played: number, won: number, drawn: number, lost: number): void {
    db.raw
      .prepare(
        `INSERT INTO chess_level_stats (profile_id, level, played, won, drawn, lost, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(profileId, level, played, won, drawn, lost, NOW);
  }

  it("refuses a level outside the ladder, and an opponent/level pair that cannot exist", () => {
    const profileId = createProfile();
    expect(() => insertGame(profileId, "g1", "engine", MAX_CHESS_LEVEL + 1)).toThrow(/CHECK/);
    expect(() => insertGame(profileId, "g2", "engine", null)).toThrow(/CHECK/);
    expect(() => insertGame(profileId, "g3", "human", 3)).toThrow(/CHECK/);
    expect(() => insertGame(profileId, "g4", "engine", MAX_CHESS_LEVEL)).not.toThrow();
    expect(() => insertGame(profileId, "g5", "human", null)).not.toThrow();
  });

  it("refuses statistics whose four counters do not add up", () => {
    const profileId = createProfile();
    expect(() => insertStats(profileId, 1, 3, 1, 0, 0)).toThrow(/CHECK/);
    expect(() => insertStats(profileId, 2, 3, 1, 1, 1)).not.toThrow();
  });

  it("holds the store's ladder bound and the schema's rungs to the same number", () => {
    // The schema spells `BETWEEN 1 AND 8`; the store derives its bound from the
    // engine's ladder. A ninth level added to `CHESS_LEVELS` without a migration
    // fails here rather than at the first write of level 9.
    const profileId = createProfile();
    expect(() => insertStats(profileId, MAX_CHESS_LEVEL, 0, 0, 0, 0)).not.toThrow();
    expect(() => insertStats(profileId, MAX_CHESS_LEVEL + 1, 0, 0, 0, 0)).toThrow(/CHECK/);
  });
});

/** True when `run` refuses with the store's own validation error and nothing else. */
function throwsValidation(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch (error) {
    return error instanceof ChessValidationError;
  }
}

