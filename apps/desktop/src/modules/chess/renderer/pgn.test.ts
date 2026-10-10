import { describe, expect, it } from "vitest";

import {
  START_FEN,
  applyUci,
  createGame,
  gamePgn,
  gameStatus,
  loadGamePgn,
  resultToken,
} from "@nexus/core";
import { FOOLS_MATE, OPERA_GAME, PGN_FIXTURES } from "./pgnFixtures.js";

/**
 * The module's PGN road, against two games other people recorded.
 *
 * What is pinned here is the exchange the product promises: a PGN from outside
 * is read as the collection that recorded it reads it, and a PGN this module
 * writes is read back as the same game. The expected values are the source's own
 * moves and the position `chess.js` 1.4.0 measures for them, which is why every
 * one of them is written out rather than computed from the code under test.
 */

describe("reading a recorded game", () => {
  for (const fixture of PGN_FIXTURES) {
    it(`reads ${fixture.name} exactly as the source gives it`, () => {
      const chess = loadGamePgn(fixture.pgn);
      const status = gameStatus(chess);

      // The article spells the castle „0-0-0"; the library writes „O-O-O". The
      // comparison is against the LIBRARY's notation, so the source's spelling is
      // carried beside it rather than being quietly treated as the same string.
      expect(fixture.sourceSan.length).toBe(fixture.san.length);
      expect(status.san).toEqual([...fixture.san]);
      expect(status.uci).toEqual(fixture.uci.split(" "));
      expect(status.fen).toBe(fixture.fen);
      expect(resultToken(chess)).toBe(fixture.result);
      // Both fixtures end in mate, which is also what makes them worth keeping: a
      // game ending in „*" would not exercise the result token at all.
      expect(status.checkmate).toBe(true);
    });
  }

  it("reads the Opera Game's castling as the library's own notation", () => {
    const chess = loadGamePgn(OPERA_GAME.pgn);
    // The ply at which White castles queenside, in both spellings.
    expect(OPERA_GAME.sourceSan[22]).toBe("0-0-0");
    expect(gameStatus(chess).san[22]).toBe("O-O-O");
  });

  it("refuses text that is not a game", () => {
    expect(() => loadGamePgn("1. e5 e4")).toThrow();
    expect(() => loadGamePgn("this is not a game at all")).toThrow();
  });
});

describe("writing a game and reading it back", () => {
  for (const fixture of PGN_FIXTURES) {
    it(`round-trips ${fixture.name} with its tags`, () => {
      const chess = loadGamePgn(fixture.pgn);
      const written = gamePgn(chess, {
        Event: "Nexus test",
        Site: "Nexus",
        Date: "2026.10.10",
        White: "Belki",
        Black: "Crni",
      });
      const reloaded = loadGamePgn(written);
      const before = gameStatus(chess);
      const after = gameStatus(reloaded);

      expect(after.san).toEqual(before.san);
      expect(after.uci).toEqual(before.uci);
      expect(after.fen).toBe(before.fen);
      expect(resultToken(reloaded)).toBe(fixture.result);
      // The tags ride the file, which is what „with the tags" means: a reader
      // that only got the moves back would have lost who played, and where.
      expect(reloaded.header()["Event"]).toBe("Nexus test");
      expect(reloaded.header()["White"]).toBe("Belki");
      expect(reloaded.header()["Black"]).toBe("Crni");
      expect(reloaded.header()["Date"]).toBe("2026.10.10");
    });
  }

  it("writes no result for a game the position has not decided", () => {
    const chess = createGame();
    applyUci(chess, "e2e4");
    const written = gamePgn(chess, { White: "Belki", Black: "Crni" });

    // A resigned or agreed game is stored with its own result BESIDE a PGN whose
    // position is still unfinished: `chess_games.result` holds the claim and the
    // PGN's Result holds the position, which is the arrangement that lets both be
    // true at once.
    expect(written).toContain('[Result "*"]');
    expect(gameStatus(loadGamePgn(written)).uci).toEqual(["e2e4"]);
  });

  it("carries a position set up from a FEN, so a game can begin anywhere", () => {
    const fen = "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1";
    const chess = createGame(fen);
    applyUci(chess, "e1e8");
    const written = gamePgn(chess, { White: "Belki", Black: "Crni" });
    const reloaded = loadGamePgn(written);
    const start = reloaded.header()["FEN"];

    // `SetUp` and `FEN` are what tell a reader that the moves do not begin on the
    // standard board; without them the same text would be read from the start
    // position, and `Re8` would not be a move there at all.
    expect(start).toBe(fen);
    expect(reloaded.header()["SetUp"]).toBe("1");
    expect(gameStatus(reloaded).fen).toBe(gameStatus(chess).fen);
    expect(gameStatus(reloaded).san).toEqual(["Re8#"]);
  });

  it("leaves the standard start implicit, which is the same fact as a missing FEN", () => {
    const chess = loadGamePgn(FOOLS_MATE.pgn);
    // The library answers `null` for a tag a game does not carry, which is what
    // the page reads with `?? START_FEN` when it opens a stored game.
    expect(chess.header()["FEN"]).toBeNull();
    expect(START_FEN).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(createGame().fen()).toBe(START_FEN);
  });
});
