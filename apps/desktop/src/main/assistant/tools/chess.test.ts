import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  START_FEN,
  applyUci,
  createGame,
  gamePgn,
  legalUci,
  type AssistantLocale,
  type ConfirmRequest,
  type Tool,
  type ToolContext,
} from "@nexus/core";
import { ChessStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import { makeKey } from "../../packs/fixtures.js";
import { createModuleTools, type ModuleToolsAccess } from "../../moduleTools.js";
import { fixtureScript, installedToolPack } from "../../tools/fixtures.js";
import { TOOL_LIMITS } from "../../tools/run.js";
import { chessTools, type ChessToolDeps } from "./chess.js";
import { USER_DECLINED } from "./support.js";

/**
 * The chess tools over a real profile database. The pack's analysis runs through the
 * kit's own tool capability against a signed fixture pack whose program is the
 * UCI fixture engine (`tools/fixtures/fake-engine.mts`), so the move, the score and
 * the licence line are the fixture's own numbers. Its process is real, which is the
 * only way the pack path is proved end to end; the whole file stays inside the
 * three-second budget because the built-in searches are at the shallow levels.
 */

const NOW_MS = new Date(2026, 9, 12, 19, 40, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();
/** The position after 1. e4, which the resume slot holds in most tests. */
const AFTER_E4 = (() => {
  const game = createGame();
  applyUci(game, "e2e4");
  return game.fen();
})();
/** Black is checkmated: the position has no move in it. */
const CHECKMATED = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";

let dir: string;
let db: NexusDatabase;
let profileId: string;
let userData: string;
let roots: string[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-chess-tools-"));
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
  userData = mkdtempSync(join(tmpdir(), "nexus-chess-packs-"));
  roots = [userData];
});

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** Saves one finished engine game: the scholar's mate, won by White at `level`. */
function saveWhiteWin(level: number, playedAt = NOW_ISO): string {
  const game = createGame();
  for (const move of ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]) applyUci(game, move);
  const saved = new ChessStore(db.raw, profileId).saveGame(
    {
      pgn: gamePgn(game),
      result: "white",
      playedAt,
      playedColor: "w",
      opponent: "engine",
      level,
      timeControl: "600+5",
    },
    NOW_ISO,
  );
  return saved.id;
}

/** The chess tools, with no pack installed unless `tools` says otherwise. */
function toolsWith(tools: ModuleToolsAccess = noPack()): readonly Tool[] {
  const deps: ChessToolDeps = {
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
    tools,
  };
  return chessTools(deps);
}

function noPack(): ModuleToolsAccess {
  return createModuleTools({ userData: () => userData, publicKeyPem: "no key", tempRoot: userData });
}

/** The fixture pack, installed under this test's own folder and signed with its own key. */
function packTools(): ModuleToolsAccess {
  const key = makeKey();
  installedToolPack({
    userData,
    key,
    id: "stockfish",
    version: "19.0.0",
    protocol: "uci",
    args: [fixtureScript("fake-engine.mts")],
  });
  return createModuleTools({
    userData: () => userData,
    publicKeyPem: key.publicKeyPem,
    tempRoot: userData,
    limits: { ...TOOL_LIMITS, timeoutMs: 30_000 },
  });
}

function tool(name: string, tools: readonly Tool[] = toolsWith()): Tool {
  const found = tools.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

/** A context whose confirmation answers `answer`, and which records every question asked. */
function context(
  locale: AssistantLocale = "en",
  answer = true,
): { readonly context: ToolContext; readonly asked: ConfirmRequest[] } {
  const asked: ConfirmRequest[] = [];
  return {
    asked,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        asked.push(request);
        return Promise.resolve(answer);
      },
    },
  };
}

describe("chess.games", () => {
  it("lists the saved games, the game in progress and the record against the engine", async () => {
    const id = saveWhiteWin(3);
    new ChessStore(db.raw, profileId).setResume(
      {
        startFen: START_FEN,
        fen: AFTER_E4,
        moves: ["e2e4"],
        playedColor: "w",
        opponent: "engine",
        level: 2,
        timeControl: null,
      },
      NOW_ISO,
    );

    const result = await tool("chess.games").run({}, context().context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Saved games (1):");
    expect(result.content).toContain(
      `- 12 October 2026 19:40 · The engine · Level 3 · 10 min + 5 s · White wins (${id})`,
    );
    expect(result.content).toContain("Game in progress: The engine · Level 2. Moves played: 1.");
    expect(result.content).toContain("Level 3: played 1, won 1, drawn 0, lost 0.");
    expect(result.navigateTo).toBeUndefined();
  });

  it("says so when nothing is saved, and names how many games a long list leaves out", async () => {
    const empty = await tool("chess.games").run({}, context().context);
    expect(empty.content).toBe("No saved games.\n\nNo game against the engine has finished yet.");

    for (let index = 0; index < 21; index += 1) saveWhiteWin(1);
    const long = await tool("chess.games").run({}, context().context);
    expect(long.content).toContain("Saved games (21):");
    expect(long.content).toContain("…and 1 more.");
  });

  it("answers in Serbian Latin when the interface is Serbian", async () => {
    saveWhiteWin(3);
    const result = await tool("chess.games").run({}, context("sr").context);
    expect(result.content).toContain("Sačuvane partije (1):");
    expect(result.content).toContain("Nivo 3");
    expect(result.content).toContain("Pobeda belih");
  });
});

describe("chess.analyze", () => {
  it("suggests a legal move from the built-in engine for the position it is given", async () => {
    const result = await tool("chess.analyze").run(
      { fen: START_FEN, level: 1 },
      context().context,
    );

    expect(result.ok).toBe(true);
    const move = /^Best move: (\S+)/.exec(result.content)?.[1];
    expect(legalUci(createGame(START_FEN))).toContain(move);
    expect(result.content).toContain(`Legal moves (20): ${legalUci(createGame(START_FEN)).join(", ")}`);
    expect(result.content).toContain("Material: 0.00 (positive favours White)");
    expect(result.content).not.toContain("Engine:");
  });

  it("analyses the game in progress when no FEN is given", async () => {
    new ChessStore(db.raw, profileId).setResume(
      {
        startFen: START_FEN,
        fen: AFTER_E4,
        moves: ["e2e4"],
        playedColor: "b",
        opponent: "engine",
        level: 1,
        timeControl: null,
      },
      NOW_ISO,
    );

    const result = await tool("chess.analyze").run({}, context().context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Legal moves (");
    expect(result.content).toContain("e7e5");
  });

  it("refuses a FEN that is not a position, and a request with no position at all", async () => {
    const bad = await tool("chess.analyze").run({ fen: "not a position" }, context().context);
    expect(bad).toEqual({ ok: false, content: "Failed: That FEN is not a chess position." });

    const none = await tool("chess.analyze").run({}, context().context);
    expect(none.ok).toBe(false);
    expect(none.content).toContain("no game is in progress");
  });

  it("reports a finished position as over rather than inventing a move", async () => {
    const result = await tool("chess.analyze").run({ fen: CHECKMATED }, context().context);
    expect(result).toEqual({ ok: true, content: "The position has no move: the game is over." });
  });

  it("says the built-in engine answered when no pack is installed for a level the pack plays", async () => {
    const result = await tool("chess.analyze").run({ fen: START_FEN, level: 6 }, context().context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Best move: ");
    expect(result.content).toContain(
      "The Stockfish pack is not installed, so the built-in engine answered.",
    );
  });

  it("plays a level the pack covers through the pack, and names its licence", async () => {
    const result = await tool("chess.analyze", toolsWith(packTools())).run(
      { fen: START_FEN, level: 8 },
      context().context,
    );

    // The fixture engine's own answer: its move, and its centipawn score for White.
    expect(result.ok).toBe(true);
    expect(result.content.startsWith("Best move: e2e4\nEvaluation: +0.12 (positive favours White)")).toBe(true);
    expect(result.content).toContain(
      "Engine: Fixture tool 19.0.0 · GPL-3.0-or-later · The fixture's own authors · https://www.gnu.org/licenses/gpl-3.0.html",
    );
  }, 30_000);
});

describe("chess.start", () => {
  it("opens a new game through the page's own action, with what the request names", async () => {
    const { context: ctx, asked } = context();
    const result = await tool("chess.start").run(
      { color: "black", opponent: "engine", level: 2, time: "180+2" },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.content).toBe("Opening a new game on the chess page: Black · The engine · Level 2 · 3 min + 2 s.");
    expect(result.navigateTo).toEqual({
      module: "chess",
      action: {
        name: "start",
        payload: { color: "black", opponent: "engine", level: 2, time: "180+2" },
      },
    });
    // Navigation writes nothing, so nothing is asked: the page asks for itself when a game would be replaced.
    expect(asked).toEqual([]);
  });

  it("leaves out what the request does not name, and refuses a colour or a clock the form does not offer", async () => {
    const minimal = await tool("chess.start").run({ color: "white", opponent: "human" }, context().context);
    expect(minimal.navigateTo).toEqual({
      module: "chess",
      action: { name: "start", payload: { color: "white", opponent: "human" } },
    });

    const colour = await tool("chess.start").run({ color: "red", opponent: "engine" }, context().context);
    expect(colour.ok).toBe(false);
    expect(colour.content).toContain('"color" must be one of: white, black.');

    const clock = await tool("chess.start").run(
      { color: "white", opponent: "engine", time: "5+0" },
      context().context,
    );
    expect(clock.ok).toBe(false);
    expect(clock.content).toContain('"time" must be one of:');
  });
});

describe("chess.open", () => {
  it("reveals a saved game on the page", async () => {
    const id = saveWhiteWin(3);
    const result = await tool("chess.open").run({ id }, context().context);

    expect(result.ok).toBe(true);
    expect(result.content).toBe(`Opening the saved game on the chess page (12 October 2026, White wins).`);
    expect(result.navigateTo).toEqual({ module: "chess", item: id });
  });

  it("refuses an id this profile does not hold", async () => {
    const result = await tool("chess.open").run({ id: uuidv7() }, context().context);
    expect(result).toEqual({ ok: false, content: "Failed: No saved game has that id." });
  });
});

describe("chess.delete", () => {
  it("asks first, naming the game, and deletes it when the user agrees", async () => {
    const id = saveWhiteWin(3);
    const { context: ctx, asked } = context("en", true);

    const result = await tool("chess.delete").run({ id }, ctx);

    expect(asked).toEqual([
      {
        tool: "chess.delete",
        effect: "write",
        summary: "Delete the saved game (12 October 2026, White wins).",
      },
    ]);
    expect(result).toEqual({
      ok: true,
      content: "Deleted the saved game (12 October 2026, White wins).",
      navigateTo: { module: "chess" },
    });
    expect(new ChessStore(db.raw, profileId).listGames()).toEqual([]);
  });

  it("writes nothing when the user declines", async () => {
    const id = saveWhiteWin(3);
    const result = await tool("chess.delete").run({ id }, context("en", false).context);

    expect(result).toEqual({ ok: false, content: USER_DECLINED });
    expect(new ChessStore(db.raw, profileId).listGames().map((game) => game.id)).toEqual([id]);
  });

  it("refuses an id this profile does not hold, without asking", async () => {
    const { context: ctx, asked } = context();
    const result = await tool("chess.delete").run({ id: uuidv7() }, ctx);

    expect(result.ok).toBe(false);
    expect(asked).toEqual([]);
  });

  it("refuses an id that is not a bounded string", async () => {
    const result = await tool("chess.delete").run({ id: "" }, context().context);
    expect(result.ok).toBe(false);
  });
});
