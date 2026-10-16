import { describe, expect, it } from "vitest";
import { parseChessStart } from "./setup.js";

describe("parseChessStart", () => {
  it("accepts a start request, with or without the level and the clock", () => {
    expect(parseChessStart({ color: "white", opponent: "engine", level: 8, time: "600+5" })).toEqual({
      color: "white",
      opponent: "engine",
      level: 8,
      time: "600+5",
    });
    expect(parseChessStart({ color: "black", opponent: "human", time: "none" })).toEqual({
      color: "black",
      opponent: "human",
      time: "none",
    });
    expect(parseChessStart({ color: "black", opponent: "human" })).toEqual({
      color: "black",
      opponent: "human",
    });
  });

  it("refuses a payload the form would not accept, whatever the shell carried", () => {
    expect(parseChessStart(null)).toBeNull();
    expect(parseChessStart("start")).toBeNull();
    expect(parseChessStart({ color: "w", opponent: "engine" })).toBeNull();
    expect(parseChessStart({ color: "white", opponent: "robot" })).toBeNull();
    expect(parseChessStart({ color: "white", opponent: "engine", level: 0 })).toBeNull();
    expect(parseChessStart({ color: "white", opponent: "engine", level: 9 })).toBeNull();
    expect(parseChessStart({ color: "white", opponent: "engine", level: 2.5 })).toBeNull();
    expect(parseChessStart({ color: "white", opponent: "engine", time: "5+0" })).toBeNull();
  });
});
