import { describe, expect, it } from "vitest";
import {
  START_FEN,
  applyUci,
  createGame,
  gamePgn,
  gameStatus,
  isValidFen,
  legalUci,
  loadGamePgn,
  parseFen,
  replayUci,
  toFen,
} from "./index.js";

/**
 * The rules layer is a thin, project-shaped wrapper over `chess.js`, and this
 * file is what keeps it thin: every refusal and every flag below is asserted
 * against what `chess.js` actually answers, because the wrapper's only job is
 * to have already asked.
 */

describe("FEN", () => {
  it("accepts the abbreviated form every human writes", () => {
    // Four fields, as the brief spells Kiwipete: found here rather than by the
    // caller, who would otherwise have to pad it before the wrapper would look.
    expect(
      isValidFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1P/PPPBBPPP/R3K2R w KQkq -"),
    ).toBe(true);
    expect(isValidFen("not a position")).toBe(false);
    // chess.js refuses this one, and it is right to: a board with no king is
    // not a position, whatever its eight ranks look like.
    expect(isValidFen("8/8/8/8/8/8/8/8 w - - 0 1")).toBe(false);
  });

  it("pads the abbreviated form and round-trips the full one", () => {
    const abbreviated = parseFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -");
    expect(abbreviated).not.toBeNull();
    expect(toFen(abbreviated!)).toBe("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");

    const full = "4k3/8/8/8/3pP3/8/8/4K3 b - e3 7 42";
    expect(toFen(parseFen(full)!)).toBe(full);
    expect(parseFen("nonsense")).toBeNull();
  });
});

describe("a game's state", () => {
  it("describes the opening position", () => {
    const status = gameStatus(createGame());
    expect(status).toMatchObject({
      turn: "w",
      moveNumber: 1,
      inCheck: false,
      checkmate: false,
      stalemate: false,
      draw: false,
      gameOver: false,
      result: "*",
      san: [],
      uci: [],
    });
    expect(status.fen).toBe(START_FEN);
  });

  it("calls checkmate a win for the side that is not to move", () => {
    const status = gameStatus(createGame("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"));
    expect(status).toMatchObject({ checkmate: true, gameOver: true, result: "1-0" });
    expect(status.inCheck).toBe(true);
  });

  it("separates stalemate from every other draw", () => {
    const status = gameStatus(createGame("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"));
    expect(status).toMatchObject({
      stalemate: true,
      draw: true,
      gameOver: true,
      checkmate: false,
      result: "1/2-1/2",
    });
  });

  it("knows the two draws that are about the position and not the clock", () => {
    expect(gameStatus(createGame("8/8/8/4k3/8/8/4K3/8 w - - 0 1")).insufficientMaterial).toBe(true);
    expect(gameStatus(createGame("8/8/8/4k3/8/8/4KB2/8 w - - 0 1")).insufficientMaterial).toBe(true);
    // Two knights are NOT a dead position in the strict sense chess.js uses —
    // mate is reachable, just not forceable — and the wrapper reports the
    // rules engine's answer rather than a second opinion of its own.
    expect(gameStatus(createGame("8/8/8/4k3/8/8/4KNN1/8 w - - 0 1")).insufficientMaterial).toBe(false);
  });

  it("sees a repetition on the third occurrence, and the fifty-move clock reaching 100", () => {
    const shuffled = createGame();
    for (const move of ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]) {
      applyUci(shuffled, move);
    }
    expect(gameStatus(shuffled).threefoldRepetition).toBe(true);
    expect(gameStatus(shuffled).draw).toBe(true);

    const clock = createGame("4k3/8/8/8/8/8/8/4K3 w - - 99 60");
    applyUci(clock, "e1e2");
    expect(gameStatus(clock).fiftyMoveDraw).toBe(true);
    expect(gameStatus(clock).draw).toBe(true);
  });
});

describe("playing moves", () => {
  it("answers a square's moves, or every move when asked for all", () => {
    const game = createGame();
    expect(legalUci(game).length).toBe(20);
    expect(legalUci(game, "e2").sort()).toEqual(["e2e3", "e2e4"]);
    expect(legalUci(game, "e4")).toEqual([]);
  });

  it("reports the SAN of the move it played, and refuses one that is not legal", () => {
    const game = createGame();
    expect(applyUci(game, "e2e4")).toBe("e4");
    expect(applyUci(game, "e7e5")).toBe("e5");
    expect(() => applyUci(game, "e4e7")).toThrow();
    expect(() => applyUci(game, "e2e9")).toThrow();
  });

  it("replays a move list onto a FEN, and refuses a list that does not fit", () => {
    const replayed = replayUci(START_FEN, ["e2e4", "e7e5", "g1f3"]);
    const expected = createGame();
    for (const move of ["e2e4", "e7e5", "g1f3"]) applyUci(expected, move);
    expect(replayed).toEqual({ fen: expected.fen(), san: ["e4", "e5", "Nf3"] });
    expect(() => replayUci(START_FEN, ["e2e5"])).toThrow();
    expect(() => replayUci("nonsense", [])).toThrow();
  });
});

describe("PGN", () => {
  it("round-trips a game, headers and all", () => {
    const game = createGame();
    for (const move of ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6"]) applyUci(game, move);
    const pgn = gamePgn(game, { Event: "Nexus test", White: "Čovek", Black: "Mašina" });

    const reloaded = loadGamePgn(pgn);
    expect(reloaded.fen()).toBe(game.fen());
    expect(reloaded.history()).toEqual(game.history());
    expect(reloaded.getHeaders()["Event"]).toBe("Nexus test");
    expect(reloaded.getHeaders()["White"]).toBe("Čovek");
  });

  it("writes the result it can see, and refuses a PGN it cannot read", () => {
    const finished = createGame("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
    expect(gamePgn(finished)).toContain('[Result "1-0"]');
    expect(gamePgn(createGame())).toContain('[Result "*"]');
    expect(() => loadGamePgn("this is not a game")).toThrow();
  });
});

