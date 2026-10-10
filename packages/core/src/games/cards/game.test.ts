import { describe, expect, it } from "vitest";
import {
  CARD_GAMES,
  CARD_GAME_VARIANTS,
  FREE_CELL_MAX_DEAL,
  FREE_CELL_MIN_DEAL,
  isCardGameId,
  isCardGameVariant,
  isCardSeed,
  MAX_CARD_SEED,
} from "./game.js";

describe("the card game vocabulary", () => {
  it("names the three games and their variants, once each", () => {
    expect(CARD_GAMES).toEqual(["klondike", "freecell", "spider"]);
    expect(CARD_GAME_VARIANTS).toEqual({
      klondike: ["draw1", "draw3"],
      freecell: ["classic"],
      spider: ["suits1", "suits2", "suits4"],
    });
  });

  it("refuses a game or a variant the closed table does not carry", () => {
    expect(isCardGameId("spider")).toBe(true);
    expect(isCardGameId("Spider")).toBe(false);
    expect(isCardGameId("minesweeper")).toBe(false);
    expect(isCardGameVariant("klondike", "draw3")).toBe(true);
    expect(isCardGameVariant("klondike", "suits2")).toBe(false);
    expect(isCardGameVariant("freecell", "classic")).toBe(true);
    expect(isCardGameVariant("spider", "classic")).toBe(false);
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
