import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CardGameStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import {
  CARD_GAMES,
  CARD_GAME_VARIANTS,
  hintMove,
  legalCardMoves,
  startGame,
  type AssistantLocale,
  type ConfirmRequest,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "@nexus/core";
import { cardsTools } from "./cards.js";

/**
 * The CARDS tools over a REAL database. The record and the saved games are what
 * the app's own store holds, so each test seeds the store the way the page would
 * and then asserts what the tool reads, refuses, clears or asks the page to do.
 *
 * A deal is the page's: `cards.start` answers with an `action`, and these tests
 * assert the payload and that main wrote no saved game of its own.
 */

const NOW_ISO = new Date(2026, 9, 10, 9, 0, 0).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-cards-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function cards(): CardGameStore {
  return new CardGameStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return cardsTools({ profileDb: (id, open) => open(db.raw, id) });
}

interface Outcome {
  readonly result: ToolResult;
  readonly confirms: ConfirmRequest[];
}

/** Runs one tool, answering its confirmation with `allow`, and remembers every question asked. */
async function run(
  name: string,
  args: unknown,
  { allow = true, locale = "en" }: { allow?: boolean; locale?: AssistantLocale } = {},
): Promise<Outcome> {
  const tool = tools().find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`Test setup: no tool "${name}".`);
  const confirms: ConfirmRequest[] = [];
  const context: ToolContext = {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm: (request) => {
      confirms.push(request);
      return Promise.resolve(allow);
    },
  };
  return { result: await tool.run(args, context), confirms };
}

/** A game saved with no moves: the seed alone, which every game can replay. */
function saveEmpty(game: (typeof CARD_GAMES)[number], variant = CARD_GAME_VARIANTS[game][0]!, seed = 7): void {
  cards().saveProgress({ game, variant, seed, moves: [], elapsedSeconds: 42 }, NOW_ISO);
}

describe("cards.stats", () => {
  it("says so when nothing has been played or saved", async () => {
    const { result } = await run("cards.stats", {});
    expect(result.ok).toBe(true);
    expect(result.content).toBe("No games played and none saved.");
  });

  it("lists the record and the saved games, in the record's own order", async () => {
    cards().recordResult(
      { game: "klondike", variant: "draw1", won: true, elapsedSeconds: 252, score: 340 },
      NOW_ISO,
    );
    saveEmpty("spider", "suits1");
    const { result } = await run("cards.stats", {});
    expect(result.content).toContain("Results (1):");
    expect(result.content).toContain(
      "- Klondike (draw one): 1 played, 1 won, best score 340, best time 4 min 12 s, longest win streak 1.",
    );
    expect(result.content).toContain("Saved in progress:");
    expect(result.content).toContain("- Spider (one suit): 0 moves, played for 42 s");
  });

  it("filters to one game, and reads Serbian in Serbian", async () => {
    saveEmpty("klondike");
    saveEmpty("hearts");
    const { result } = await run("cards.stats", { game: "hearts" }, { locale: "sr" });
    expect(result.content).toContain("Sačuvano u toku:");
    expect(result.content).toContain("- Herc (standardna): 0 poteza, odigrano 42 s");
    expect(result.content).not.toContain("Klondajk");
  });

  it("refuses a game that is not in the vocabulary, with the schema's message", async () => {
    const { result } = await run("cards.stats", { game: "bridge" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"game" must be one of');
  });
});

describe("cards.position", () => {
  it.each(CARD_GAMES.map((game) => [game]))("describes a saved %s with no moves", async (game) => {
    saveEmpty(game);
    const { result } = await run("cards.position", { game });
    expect(result.ok).toBe(true);
    expect(result.content.split("\n")[0]).toContain("score");
    expect(result.content).toMatch(/It is your turn\.|It is the computer's turn\./);
  });

  it("keeps the computer's hand out of a game against it", async () => {
    saveEmpty("hearts");
    const { result } = await run("cards.position", { game: "hearts" });
    expect(result.content).not.toContain("column");
    expect(result.content).not.toMatch(/\b(?:2|10|Q|K|A)[CDHS]\b/);
  });

  it("reads a solitaire's piles and the moves it has, after a real move", async () => {
    const dealt = startGame("klondike", "draw1", 7);
    const first = legalCardMoves(dealt)[0];
    cards().saveProgress(
      { game: "klondike", variant: "draw1", seed: 7, moves: [first], elapsedSeconds: 10 },
      NOW_ISO,
    );
    const { result } = await run("cards.position", { game: "klondike", variant: "draw1" });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Legal moves:");
    expect(result.content).toContain("column 1:");
    expect(result.content).toContain("stock:");
  });

  it("refuses a game with nothing saved", async () => {
    const { result } = await run("cards.position", { game: "golf" });
    expect(result.ok).toBe(false);
    expect(result.content).toBe("Failed: No saved game: Golf.");
  });

  it("asks for the variant when two of a game are saved and none is named", async () => {
    saveEmpty("klondike", "draw1");
    saveEmpty("klondike", "draw3");
    const { result } = await run("cards.position", { game: "klondike" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("More than one game is saved: Klondike. Name the variant: draw one, draw three.");
  });
});

describe("cards.hint", () => {
  it("suggests the engine's own hint for a saved solitaire, in words", async () => {
    saveEmpty("klondike", "draw1");
    const move = hintMove(startGame("klondike", "draw1", 7)) as { kind: string } | null;
    expect(move).not.toBeNull();
    const { result } = await run("cards.hint", { game: "klondike" });
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(move?.kind === "draw" ? /stock/ : /→/);
  });

  it("does not hint for a game the engines give no hint for", async () => {
    const { result } = await run("cards.hint", { game: "pyramid" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"game" must be one of');
  });

  it("does not hint for a game against the computer", async () => {
    const { result } = await run("cards.hint", { game: "spades" });
    expect(result.ok).toBe(false);
  });
});

describe("cards.start", () => {
  it("asks first, and a declined deal writes nothing and answers the refusal", async () => {
    const { result, confirms } = await run("cards.start", { game: "klondike" }, { allow: false });
    expect(result.ok).toBe(false);
    expect(confirms).toHaveLength(1);
    expect(cards().getProgress("klondike", "draw1")).toBeNull();
  });

  it("asks the page to deal the named game, with a seed, and writes no save itself", async () => {
    const { result, confirms } = await run("cards.start", { game: "hearts", level: "easy" });
    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toBe("Deal a new Hearts game (standard)");
    expect(result.navigateTo).toMatchObject({
      module: "cards",
      item: "hearts/standard",
      action: { name: "start", payload: { game: "hearts", variant: "standard", level: "easy" } },
    });
    const seed = (result.navigateTo?.action?.payload as { seed: number }).seed;
    expect(Number.isInteger(seed) && seed >= 0).toBe(true);
    expect(cards().listProgress()).toHaveLength(0);
  });

  it("deals FreeCell by the deal number it is given, and by a random one in range when none", async () => {
    const named = await run("cards.start", { game: "freecell", deal: 617 });
    expect(named.result.navigateTo?.action?.payload).toMatchObject({ game: "freecell", seed: 617 });
    const random = await run("cards.start", { game: "freecell" });
    const seed = (random.result.navigateTo?.action?.payload as { seed: number }).seed;
    expect(seed).toBeGreaterThanOrEqual(1);
    expect(seed).toBeLessThanOrEqual(32000);
  });

  it("refuses a deal number for a game that is not FreeCell, and a level for a solitaire", async () => {
    const deal = await run("cards.start", { game: "klondike", deal: 5 });
    expect(deal.result.ok).toBe(false);
    expect(deal.result.content).toBe("Failed: A deal number applies only to FreeCell.");
    const level = await run("cards.start", { game: "golf", level: "hard" });
    expect(level.result.ok).toBe(false);
    expect(level.result.content).toBe(
      "Failed: A level applies only to a game against the computer, and Golf is a solitaire.",
    );
    expect(level.confirms).toHaveLength(0);
  });

  it("refuses a variant the game does not have, before asking anything", async () => {
    const { result, confirms } = await run("cards.start", { game: "spider", variant: "draw1" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Spider has no such variant. Its variants: one suit, two suits, four suits.");
    expect(confirms).toHaveLength(0);
  });

  it("says in the question that it replaces a saved game of the same kind", async () => {
    saveEmpty("klondike", "draw3");
    const { confirms } = await run("cards.start", { game: "klondike", variant: "draw3" }, { allow: false });
    expect(confirms[0]?.summary).toBe(
      "Deal a new Klondike game (draw three), which replaces the saved game of 0 moves",
    );
  });
});

describe("cards.clear", () => {
  it("refuses a game that is not saved", async () => {
    const { result, confirms } = await run("cards.clear", { game: "freecell" });
    expect(result.ok).toBe(false);
    expect(result.content).toBe("Failed: No saved game: FreeCell.");
    expect(confirms).toHaveLength(0);
  });

  it("asks first, naming the exact slot, and a declined discard keeps the save", async () => {
    saveEmpty("pyramid", "pass3");
    const declined = await run("cards.clear", { game: "pyramid", variant: "pass3" }, { allow: false });
    expect(declined.result.ok).toBe(false);
    expect(declined.confirms[0]?.summary).toBe("Discard the saved Pyramid game (three passes) of 0 moves");
    expect(cards().getProgress("pyramid", "pass3")).not.toBeNull();
  });

  it("discards the one saved slot, and names it to the page", async () => {
    saveEmpty("golf", "wrap");
    const { result } = await run("cards.clear", { game: "golf" });
    expect(result.ok).toBe(true);
    expect(result.content).toBe("Discarded the saved Golf game (wrap).");
    expect(result.navigateTo).toEqual({ module: "cards", item: "golf/wrap" });
    expect(cards().getProgress("golf", "wrap")).toBeNull();
  });

  it("asks for the variant when two of a game are saved and none is named, and clears nothing", async () => {
    saveEmpty("tripeaks", "classic");
    saveEmpty("tripeaks", "wrap");
    const { result } = await run("cards.clear", { game: "tripeaks" });
    expect(result.ok).toBe(false);
    expect(result.content).toBe(
      "Failed: More than one game is saved: TriPeaks. Name the variant: classic, wrap.",
    );
    expect(cards().listProgress()).toHaveLength(2);
  });

  it("answers Serbian in Serbian", async () => {
    saveEmpty("spider", "suits2");
    const { result } = await run("cards.clear", { game: "spider" }, { locale: "sr" });
    expect(result.content).toBe("Odbačena je sačuvana igra Pauk (dve boje).");
  });
});

describe("the tool declarations", () => {
  it("declares the two writes as writes and the rest as reads", () => {
    const effects = Object.fromEntries(tools().map((tool) => [tool.name, tool.effect]));
    expect(effects).toEqual({
      "cards.stats": "read",
      "cards.position": "read",
      "cards.hint": "read",
      "cards.start": "write",
      "cards.clear": "write",
    });
  });
});
