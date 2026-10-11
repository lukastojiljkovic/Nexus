import { describe, expect, it } from "vitest";
import {
  ScoreboardError,
  emptyScoreboardState,
  scoreboardCanRedo,
  scoreboardCanUndo,
  scoreboardIsOver,
  scoreboardLeaders,
  scoreboardReduce,
  scoreboardReachedTarget,
  scoreboardStandings,
  scoreboardTotalFor,
  type ScoreboardAction,
  type ScoreboardState,
} from "./scoreboard.js";

const add = (id: string, name: string): ScoreboardAction => ({ type: "add-player", id, name });
const round = (scores: Record<string, number>): ScoreboardAction => ({ type: "add-round", scores });

const apply = (state: ScoreboardState, ...actions: readonly ScoreboardAction[]): ScoreboardState =>
  actions.reduce(scoreboardReduce, state);

/** Two players, three recorded rounds: Ana 10 / 5 / 3, Boško 4 / 5 / 12. */
const played = apply(
  emptyScoreboardState(),
  add("ana", "Ana"),
  add("bosko", "Bosko"),
  round({ ana: 10, bosko: 4 }),
  round({ ana: 5, bosko: 5 }),
  round({ ana: 3, bosko: 12 }),
);

describe("scoreboardReduce", () => {
  it("starts empty, with no target", () => {
    expect(emptyScoreboardState()).toEqual({
      players: [],
      rounds: [],
      target: null,
      past: [],
      future: [],
    });
  });

  it("adds players in order, with trimmed names", () => {
    const state = apply(emptyScoreboardState(), add("ana", "  Ana  "), add("bosko", "Bosko"));
    expect(state.players).toEqual([
      { id: "ana", name: "Ana" },
      { id: "bosko", name: "Bosko" },
    ]);
  });

  it("defaults a player who is missing from a round to zero", () => {
    const state = apply(
      emptyScoreboardState(),
      add("ana", "Ana"),
      add("bosko", "Bosko"),
      round({ ana: 7 }),
    );
    expect(state.rounds[0]?.scores).toEqual({ ana: 7, bosko: 0 });
    expect(scoreboardTotalFor(state, "bosko")).toBe(0);
  });

  it("corrects a single score inside a round", () => {
    const corrected = apply(played, { type: "set-score", round: 0, playerId: "bosko", score: 9 });
    expect(corrected.rounds[0]?.scores).toEqual({ ana: 10, bosko: 9 });
    expect(scoreboardTotalFor(corrected, "bosko")).toBe(26);
  });

  it("totals each player's rounds", () => {
    expect(scoreboardTotalFor(played, "ana")).toBe(18);
    expect(scoreboardTotalFor(played, "bosko")).toBe(21);
  });

  it("drops a removed player's column from every round", () => {
    const state = apply(played, { type: "remove-player", id: "bosko" });
    expect(state.players.map((player) => player.id)).toEqual(["ana"]);
    expect(state.rounds.map((playedRound) => Object.keys(playedRound.scores))).toEqual([
      ["ana"],
      ["ana"],
      ["ana"],
    ]);
  });

  it("gives a player who joins mid-game a zero column in the rounds already played", () => {
    // Adding a column of zeros is what keeps everybody else's total where it was.
    const state = apply(
      emptyScoreboardState(),
      add("ana", "Ana"),
      round({ ana: 7 }),
      add("bosko", "Bosko"),
    );
    expect(state.rounds[0]?.scores).toEqual({ ana: 7, bosko: 0 });
    expect(scoreboardTotalFor(state, "ana")).toBe(7);
    expect(scoreboardTotalFor(state, "bosko")).toBe(0);
  });

  it("refuses what it cannot carry out", () => {
    const code = (state: ScoreboardState, action: ScoreboardAction) => {
      try {
        scoreboardReduce(state, action);
      } catch (error) {
        expect(error).toBeInstanceOf(ScoreboardError);
        return (error as ScoreboardError).code;
      }
      return "did not throw";
    };
    const one = apply(emptyScoreboardState(), add("ana", "Ana"));
    expect(code(one, add("ana", "Again"))).toBe("duplicate-id");
    expect(code(emptyScoreboardState(), add("", "Ana"))).toBe("id");
    expect(code(emptyScoreboardState(), add("a", "   "))).toBe("name");
    expect(code(emptyScoreboardState(), add("a", "x".repeat(41)))).toBe("name");
    expect(code(one, { type: "rename-player", id: "ghost", name: "Ghost" })).toBe(
      "unknown-player",
    );
    expect(code(one, round({ ghost: 5 }))).toBe("unknown-player");
    expect(code(one, round({ ana: 1.5 }))).toBe("score-range");
    expect(code(one, round({ ana: 100_001 }))).toBe("score-range");
    expect(code(one, { type: "set-score", round: 0, playerId: "ana", score: 3 })).toBe(
      "unknown-round",
    );
    expect(code(one, { type: "set-target", target: 0 })).toBe("target-range");
    expect(code(one, { type: "set-target", target: 2.5 })).toBe("target-range");
  });
});

describe("scoreboardStandings", () => {
  it("orders by total and ranks ties as ties", () => {
    const tied = apply(
      emptyScoreboardState(),
      add("ana", "Ana"),
      add("bosko", "Bosko"),
      add("cvetko", "Cvetko"),
      round({ ana: 10 }),
      round({ bosko: 10, cvetko: 3 }),
    );
    expect(
      scoreboardStandings(tied).map((row) => [row.player.id, row.total, row.rank, row.tied]),
    ).toEqual([
      ["ana", 10, 1, true],
      ["bosko", 10, 1, true],
      ["cvetko", 3, 3, false],
    ]);
    expect(scoreboardLeaders(tied).map((player) => player.id)).toEqual(["ana", "bosko"]);
    expect(scoreboardStandings(tied).map((row) => row.roundsWon)).toEqual([1, 1, 0]);
  });

  it("counts a round nobody won outright as no win at all", () => {
    const state = apply(played, round({ ana: 5, bosko: 5 }));
    const rows = scoreboardStandings(state);
    expect(rows.map((row) => [row.player.id, row.total])).toEqual([
      ["bosko", 26],
      ["ana", 23],
    ]);
    // Ana won round one (10 against 4) and Bosko round three (12 against 3);
    // the tied rounds two and four belong to neither of them.
    expect(rows.map((row) => row.roundsWon)).toEqual([1, 1]);
  });

  it("names every player as a leader before the first round", () => {
    const state = apply(emptyScoreboardState(), add("ana", "Ana"), add("bosko", "Bosko"));
    expect(scoreboardLeaders(state).map((player) => player.id)).toEqual(["ana", "bosko"]);
    expect(scoreboardStandings(state).map((row) => row.rank)).toEqual([1, 1]);
  });

  it("has no leader without players", () => {
    expect(scoreboardLeaders(emptyScoreboardState())).toEqual([]);
    expect(scoreboardStandings(emptyScoreboardState())).toEqual([]);
  });
});

describe("the target score", () => {
  it("ends the game when a total reaches it", () => {
    expect(scoreboardIsOver(played)).toBe(false);
    const over = apply(played, { type: "set-target", target: 20 });
    expect(scoreboardIsOver(over)).toBe(true);
    expect(scoreboardReachedTarget(over).map((player) => player.id)).toEqual(["bosko"]);
    expect(scoreboardLeaders(over).map((player) => player.id)).toEqual(["bosko"]);
  });

  it("clears the game-over flag when the target is removed", () => {
    const over = apply(played, { type: "set-target", target: 20 }, { type: "set-target", target: null });
    expect(scoreboardIsOver(over)).toBe(false);
    expect(scoreboardReachedTarget(over)).toEqual([]);
  });

  it("does not end a game whose target nobody has reached", () => {
    expect(scoreboardIsOver(apply(played, { type: "set-target", target: 30 }))).toBe(false);
  });
});

describe("undo and redo", () => {
  it("restores players, rounds and target together", () => {
    const state = apply(
      emptyScoreboardState(),
      add("ana", "Ana"),
      round({ ana: 4 }),
      { type: "set-target", target: 10 },
    );
    expect(scoreboardCanUndo(state)).toBe(true);
    expect(scoreboardCanRedo(state)).toBe(false);

    const back = apply(state, { type: "undo" }, { type: "undo" }, { type: "undo" });
    expect(back).toMatchObject({ players: [], rounds: [], target: null, future: expect.anything() });
    expect(scoreboardCanUndo(back)).toBe(false);

    const forward = apply(back, { type: "redo" }, { type: "redo" }, { type: "redo" });
    expect(forward.players).toEqual(state.players);
    expect(forward.rounds).toEqual(state.rounds);
    expect(forward.target).toBe(10);
  });

  it("does nothing at either end, and drops the redo stack on a new change", () => {
    const empty = emptyScoreboardState();
    expect(scoreboardReduce(empty, { type: "undo" })).toEqual(empty);
    expect(scoreboardReduce(empty, { type: "redo" })).toEqual(empty);

    const undone = scoreboardReduce(played, { type: "undo" });
    expect(scoreboardCanRedo(undone)).toBe(true);
    const branched = scoreboardReduce(undone, round({ ana: 1, bosko: 1 }));
    expect(scoreboardCanRedo(branched)).toBe(false);
    // The undone third round is gone for good: the branch holds rounds one and
    // two, plus the new one that replaced the redo.
    expect(branched.rounds).toHaveLength(3);
    expect(branched.rounds[2]?.scores).toEqual({ ana: 1, bosko: 1 });
  });
});
