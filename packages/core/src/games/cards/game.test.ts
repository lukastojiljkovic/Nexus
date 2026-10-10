import { describe, expect, it } from "vitest";
import {
  CARD_GAMES,
  CARD_GAME_SCORE_DIRECTION,
  CARD_GAME_VARIANTS,
  CARD_OPPONENT_LEVELS,
  FREE_CELL_MAX_DEAL,
  FREE_CELL_MIN_DEAL,
  isCardGameId,
  isCardGameVariant,
  isCardOpponentLevel,
  isCardSeed,
  MAX_CARD_SEED,
} from "./game.js";

describe("the card game vocabulary", () => {
  it("names the nine games and their variants, once each", () => {
    expect(CARD_GAMES).toEqual([
      "klondike",
      "freecell",
      "spider",
      "pyramid",
      "tripeaks",
      "golf",
      "hearts",
      "spades",
      "tablic",
    ]);
    expect(CARD_GAME_VARIANTS).toEqual({
      klondike: ["draw1", "draw3"],
      freecell: ["classic"],
      spider: ["suits1", "suits2", "suits4"],
      pyramid: ["pass1", "pass3"],
      tripeaks: ["classic", "wrap"],
      golf: ["classic", "wrap"],
      hearts: ["standard"],
      spades: ["standard"],
      tablic: ["duo", "pairs"],
    });
  });

  it("refuses a game or a variant the closed table does not carry", () => {
    expect(isCardGameId("spider")).toBe(true);
    expect(isCardGameId("Spider")).toBe(false);
    expect(isCardGameId("minesweeper")).toBe(false);
    expect(isCardGameId("tablic")).toBe(true);
    expect(isCardGameVariant("klondike", "draw3")).toBe(true);
    expect(isCardGameVariant("klondike", "suits2")).toBe(false);
    expect(isCardGameVariant("freecell", "classic")).toBe(true);
    expect(isCardGameVariant("spider", "classic")).toBe(false);
    expect(isCardGameVariant("tablic", "pairs")).toBe(true);
    // Two games' variants may share a word: the game is half of the question, so
    // `wrap` is a Golf variant and a TriPeaks variant and neither list leaks.
    expect(isCardGameVariant("golf", "wrap")).toBe(true);
    expect(isCardGameVariant("hearts", "wrap")).toBe(false);
  });

  it("states which end of each game's score is the good one", () => {
    // The table is a Record keyed by the closed list, so a game added without a
    // direction is a compile error rather than a silent default.
    expect(Object.keys(CARD_GAME_SCORE_DIRECTION).sort()).toEqual([...CARD_GAMES].sort());
    // Hearts counts penalty points and Golf the cards it failed to clear; the
    // solitaires that pay for progress and Tablić's card points are the other way.
    expect(CARD_GAME_SCORE_DIRECTION.hearts).toBe("lower");
    expect(CARD_GAME_SCORE_DIRECTION.golf).toBe("lower");
    expect(CARD_GAME_SCORE_DIRECTION.pyramid).toBe("lower");
    expect(CARD_GAME_SCORE_DIRECTION.klondike).toBe("higher");
    expect(CARD_GAME_SCORE_DIRECTION.tripeaks).toBe("higher");
    expect(CARD_GAME_SCORE_DIRECTION.spades).toBe("higher");
    expect(CARD_GAME_SCORE_DIRECTION.tablic).toBe("higher");
  });

  it("names the three opponent levels and refuses anything else", () => {
    expect(CARD_OPPONENT_LEVELS).toEqual(["easy", "medium", "hard"]);
    expect(isCardOpponentLevel("hard")).toBe(true);
    expect(isCardOpponentLevel("expert")).toBe(false);
    expect(isCardOpponentLevel(3)).toBe(false);
  });

  it("bounds a seed to a 32-bit unsigned integer", () => {
    expect(MAX_CARD_SEED).toBe(4_294_967_295);
    expect(isCardSeed(0)).toBe(true);
    expect(isCardSeed(MAX_CARD_SEED)).toBe(true);
    expect(isCardSeed(-1)).toBe(false);
    expect(isCardSeed(1.5)).toBe(false);
    expect(isCardSeed(Number.NaN)).toBe(false);
  });

  it("bounds a FreeCell deal number to the 32 000 the classic game ships", () => {
    expect(FREE_CELL_MIN_DEAL).toBe(1);
    expect(FREE_CELL_MAX_DEAL).toBe(32_000);
  });
});
