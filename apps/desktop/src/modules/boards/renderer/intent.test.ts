import { describe, expect, it } from "vitest";
import { boardEngine } from "@nexus/core";
import { startRequestOf } from "./intent.js";

describe("startRequestOf", () => {
  it("reads a start the assistant sent, for any game at any level the game offers", () => {
    expect(startRequestOf({ game: "reversi", opponent: "computer", level: 2 })).toEqual({
      game: "reversi",
      opponent: "computer",
      level: 2,
    });
    expect(startRequestOf({ game: "ludo", opponent: "human", level: 1 })).toEqual({
      game: "ludo",
      opponent: "human",
      level: 1,
    });
  });

  it("refuses a game, an opponent or a level the page cannot start", () => {
    expect(startRequestOf({ game: "chess", opponent: "computer", level: 1 })).toBeNull();
    expect(startRequestOf({ game: "reversi", opponent: "robot", level: 1 })).toBeNull();
    expect(startRequestOf({ game: "reversi", opponent: "computer", level: 0 })).toBeNull();
    expect(startRequestOf({ game: "reversi", opponent: "computer", level: 1.5 })).toBeNull();
    expect(
      startRequestOf({
        game: "reversi",
        opponent: "computer",
        level: boardEngine("reversi").levels + 1,
      }),
    ).toBeNull();
    expect(startRequestOf(null)).toBeNull();
    expect(startRequestOf("reversi")).toBeNull();
  });
});
