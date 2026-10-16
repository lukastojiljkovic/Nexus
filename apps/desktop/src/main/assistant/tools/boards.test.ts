import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BoardsStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import {
  boardEngine,
  describeBoardEvent,
  type BoardsGame,
  type Tool,
  type ToolContext,
} from "@nexus/core";
import { boardsTools } from "./boards.js";

/**
 * The BOARDS tools over a real database.
 *
 * The positions are built by the engines themselves (a legal first move, played
 * through `step`), so each save is one the store accepts, and the assertions read
 * the notation the engine prints. Every write is tested for the three answers a
 * user can give: yes, no, and a request the store would refuse.
 */

const NOW_MS = new Date(2026, 9, 16, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-boards-"));
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

function store(): BoardsStore {
  return new BoardsStore(db.raw, profileId);
}

function context(
  locale: "sr" | "en",
  confirm: ToolContext["confirm"] = () => Promise.resolve(true),
): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm,
  };
}

function tool(name: string): Tool {
  const found = boardsTools({
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
  }).find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

/**
 * A game the human has just moved in: the engine's opening position, then its first
 * legal move, with the seats and level a page would save.
 */
function saveAfterOneMove(game: BoardsGame, level: number | null = 2): string {
  const engine = boardEngine(game);
  const opening = engine.initial(undefined);
  const move = engine.legalMoves(opening)[0];
  const event = engine.event(opening, move);
  const after = engine.step(opening, event);
  store().save(
    {
      game,
      state: engine.json(after),
      events: [event],
      seed: 7,
      level,
      seats: level === null ? ["human", "human"] : ["human", "computer"],
    },
    NOW_ISO,
  );
  const label = describeBoardEvent(game, event);
  return label.kind === "notation" ? label.text : "";
}

describe("boards.stats", () => {
  it("says there is nothing yet, rather than answering with nothing", async () => {
    const result = await tool("boards.stats").run({}, context("sr"));
    expect(result).toEqual({ ok: true, content: "Još nema sačuvanih partija ni rezultata." });
  });

  it("lists the game in progress for the game asked about", async () => {
    saveAfterOneMove("reversi");
    saveAfterOneMove("mlin");
    const result = await tool("boards.stats").run({ game: "reversi" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: ["In progress:", "- Reversi: 1 moves, against the computer, level 2"].join("\n"),
    });
  });
});

describe("boards.record", () => {
  it("counts a game against the computer once it ends, at the level it was played", async () => {
    const engine = boardEngine("four-in-a-row");
    const opening = engine.initial(undefined);
    const event = engine.event(opening, engine.legalMoves(opening)[0]);
    store().finish(
      {
        game: "four-in-a-row",
        state: engine.json(engine.step(opening, event)),
        events: [event],
        seed: 7,
        level: 2,
        seats: ["human", "computer"],
        ending: "resigned",
      },
      NOW_ISO,
    );
    const result = await tool("boards.stats").run({ game: "four-in-a-row" }, context("en"));
    expect(result.content).toMatch(/^Record:\n- Four in a row, level 2: played 1, won \d, drawn 0, lost \d$/);
  });
});

describe("boards.position", () => {
  it("says whose move it is, and prints the last moves in the page's notation", async () => {
    const notation = saveAfterOneMove("reversi");
    const result = await tool("boards.position").run({ game: "reversi" }, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Reversi: protiv računara, nivo 2.",
        "Na potezu: računar.",
        "Poslednji potezi:",
        `1. ${notation}`,
      ].join("\n"),
    });
  });

  it("says so when the game has no saved position", async () => {
    const result = await tool("boards.position").run({ game: "ludo" }, context("en"));
    expect(result).toEqual({
      ok: false,
      content: "Failed: there is no game in progress for Ludo.",
    });
  });

  it("refuses a game the module does not have", async () => {
    await expect(tool("boards.position").run({ game: "chess" }, context("en"))).resolves.toEqual({
      ok: false,
      content: expect.stringContaining('"game" must be one of'),
    });
  });
});

describe("boards.suggest", () => {
  it("suggests a legal move for the side to move, from the engine", async () => {
    saveAfterOneMove("reversi");
    const result = await tool("boards.suggest").run({ game: "reversi", level: 1 }, context("en"));
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/^Suggested move for the computer: \S+\. Level 1, search to depth \d+\./);
  });

  it("uses the saved level when the request names none", async () => {
    saveAfterOneMove("reversi", 3);
    const result = await tool("boards.suggest").run({ game: "reversi" }, context("en"));
    expect(result.content).toContain("Level 3, search to depth");
  });

  it("says so, and suggests nothing, when the game has no saved position", async () => {
    const result = await tool("boards.suggest").run({ game: "mlin" }, context("sr"));
    expect(result).toEqual({
      ok: false,
      content: "Neuspešno: nema partije u toku za Mlin.",
    });
  });

  it("refuses a level the game does not offer", async () => {
    saveAfterOneMove("reversi");
    const result = await tool("boards.suggest").run(
      { game: "reversi", level: boardEngine("reversi").levels + 1 },
      context("en"),
    );
    expect(result.ok).toBe(false);
  });
});

describe("boards.level", () => {
  it("sets the default level when the user agrees, and points at the settings card", async () => {
    const summaries: string[] = [];
    const result = await tool("boards.level").run(
      { level: 3 },
      context("en", (request) => {
        summaries.push(request.summary);
        return Promise.resolve(true);
      }),
    );
    expect(summaries).toEqual(["Set the default computer level for new games to 3?"]);
    expect(store().settings()).toEqual({ defaultLevel: 3 });
    expect(result).toEqual({
      ok: true,
      content: "The default level is now 3.",
      navigateTo: { module: "settings", settings: "boards" },
    });
  });

  it("changes nothing when the user declines", async () => {
    const result = await tool("boards.level").run({ level: 1 }, context("sr", () => Promise.resolve(false)));
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().settings()).toEqual({ defaultLevel: 2 });
  });

  it("refuses a level outside the range, with the schema's own message", async () => {
    const result = await tool("boards.level").run({ level: 4 }, context("en"));
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/^Failed: /);
  });
});

describe("boards.start", () => {
  it("asks first, then hands the page an action that starts the game", async () => {
    const summaries: string[] = [];
    const result = await tool("boards.start").run(
      { game: "four-in-a-row", opponent: "computer", level: 2 },
      context("en", (request) => {
        summaries.push(request.summary);
        return Promise.resolve(true);
      }),
    );
    expect(summaries).toEqual(["Start a new Four in a row game, against the computer, level 2?"]);
    expect(result).toEqual({
      ok: true,
      content: "Opening a new Four in a row game.",
      navigateTo: {
        module: "boards",
        action: {
          name: "start",
          payload: { game: "four-in-a-row", opponent: "computer", level: 2 },
        },
      },
    });
  });

  it("says a saved game of that kind will be replaced", async () => {
    saveAfterOneMove("reversi");
    const summaries: string[] = [];
    await tool("boards.start").run(
      { game: "reversi" },
      context("sr", (request) => {
        summaries.push(request.summary);
        return Promise.resolve(false);
      }),
    );
    expect(summaries).toEqual([
      "Započeti novu partiju: Reversi, protiv računara, nivo 2? Sačuvana partija te igre biće zamenjena.",
    ]);
  });

  it("starts nothing when the user declines", async () => {
    const result = await tool("boards.start").run(
      { game: "ludo", opponent: "human" },
      context("en", () => Promise.resolve(false)),
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
  });
});

describe("boards.remove", () => {
  it("discards the saved game when the user agrees, and leaves the record alone", async () => {
    saveAfterOneMove("four-in-a-row");
    const result = await tool("boards.remove").run({ game: "four-in-a-row" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: "The saved Four in a row game was discarded.",
      navigateTo: { module: "boards" },
    });
    expect(store().getSave("four-in-a-row")).toBeNull();
    expect(store().listStats().every((row) => row.played === 0)).toBe(true);
  });

  it("keeps the game when the user declines, and says what it would discard", async () => {
    saveAfterOneMove("mlin");
    const summaries: string[] = [];
    const result = await tool("boards.remove").run(
      { game: "mlin" },
      context("en", (request) => {
        summaries.push(request.summary);
        return Promise.resolve(false);
      }),
    );
    expect(summaries).toEqual(["Discard the saved Nine men's morris game (1 moves)? It is not counted in the record."]);
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().getSave("mlin")).not.toBeNull();
  });

  it("says so when there is no saved game to discard", async () => {
    const result = await tool("boards.remove").run({ game: "ludo" }, context("sr"));
    expect(result).toEqual({ ok: false, content: "Neuspešno: nema sačuvane partije: Ne ljuti se, čoveče." });
  });
});
