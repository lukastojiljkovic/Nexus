import { afterAll, afterEach, describe, expect, it } from "vitest";

import { fixtureScript, removeSharedToolPacks, sharedToolPack } from "./fixtures.js";
import { createToolSession, TOOL_LIMITS, type ToolSession } from "./run.js";
import {
  UciEngine,
  UciError,
  goCommand,
  parseBestmove,
  parseInfo,
  parseOption,
  positionCommand,
} from "./uci.js";

/**
 * The UCI client against `fixtures/fake-engine.mts`, a real process over real
 * pipes. The expected values below are the fake engine's own lines — quoted, so
 * a change to the parser that agreed with a change to the fixture would still
 * have to change this file.
 */

let session: ToolSession | null = null;
let engine: UciEngine | null = null;

afterEach(async () => {
  // The pack folder is shared between cases (`fixtures.ts` says why), so a case
  // ends its own engine and session and leaves the folder alone.
  engine?.kill();
  engine = null;
  if (session !== null) await session.close();
  session = null;
});

afterAll(() => {
  removeSharedToolPacks();
});

/** The fixture pack's folder and a session over it; the UCI tool spec is what `start` checks. */
async function uciSession(): Promise<ToolSession> {
  const fixture = sharedToolPack({ tool: { protocol: "uci" } });
  session = await createToolSession({
    dir: fixture.dir,
    manifest: fixture.manifest,
    tempRoot: fixture.root,
    limits: { ...TOOL_LIMITS, timeoutMs: 30_000 },
  });
  return session;
}

async function startedEngine(timeoutMs?: number): Promise<UciEngine> {
  const toolSession = await uciSession();
  const live = await UciEngine.start({
    session: toolSession,
    args: [fixtureScript("fake-engine.mts")],
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  engine = live;
  return live;
}

describe("parseInfo", () => {
  it("reads a depth line field by field", () => {
    expect(
      parseInfo("info depth 2 seldepth 4 multipv 1 score cp 12 nodes 200 nps 40000 time 5 hashfull 3 pv d2d4 d7d5"),
    ).toEqual({
      depth: 2,
      seldepth: 4,
      multipv: 1,
      score: { kind: "cp", value: 12, lowerBound: false, upperBound: false },
      nodes: 200,
      nps: 40000,
      timeMs: 5,
      hashfull: 3,
      currmove: null,
      pv: ["d2d4", "d7d5"],
      raw: "info depth 2 seldepth 4 multipv 1 score cp 12 nodes 200 nps 40000 time 5 hashfull 3 pv d2d4 d7d5",
    });
  });

  it("reads a mate score, including a negative one", () => {
    const info = parseInfo("info depth 3 score mate -2 pv h7h8q");
    expect(info.score).toEqual({ kind: "mate", value: -2, lowerBound: false, upperBound: false });
    expect(info.depth).toBe(3);
    expect(info.nodes).toBeNull();
  });

  it("marks a bounded score as bounded rather than reporting it as exact", () => {
    expect(parseInfo("info depth 1 score cp 30 lowerbound pv e2e4").score).toEqual({
      kind: "cp",
      value: 30,
      lowerBound: true,
      upperBound: false,
    });
  });

  it("skips fields it does not model rather than refusing the line", () => {
    const info = parseInfo("info depth 9 tbhits 3 wdl 12 0 4 currmove g1f3 pv g1f3");
    expect(info.depth).toBe(9);
    expect(info.currmove).toBe("g1f3");
    expect(info.pv).toEqual(["g1f3"]);
  });

  it("answers null for a field the engine left out, which is not the same as zero", () => {
    const info = parseInfo("info");
    expect(info.depth).toBeNull();
    expect(info.score).toBeNull();
    expect(info.pv).toEqual([]);
  });
});

describe("parseOption", () => {
  it("reads a spin's default and bounds", () => {
    expect(parseOption("option name Hash type spin default 16 min 1 max 1024")).toEqual({
      name: "Hash",
      type: "spin",
      default: "16",
      min: 1,
      max: 1024,
      vars: [],
    });
  });

  it("keeps a name that contains spaces whole", () => {
    expect(parseOption("option name Move Overhead type spin default 10 min 0 max 5000")?.name).toBe(
      "Move Overhead",
    );
  });

  it("reads a combo's variants in order", () => {
    expect(parseOption("option name Style type combo default Normal var Normal var Aggressive")).toEqual({
      name: "Style",
      type: "combo",
      default: "Normal",
      min: null,
      max: null,
      vars: ["Normal", "Aggressive"],
    });
  });

  it("reads a check's default as the word the engine wrote", () => {
    expect(parseOption("option name UCI_Chess960 type check default false")?.default).toBe("false");
  });

  it("refuses a line that is not an option", () => {
    expect(parseOption("id name Fake Engine 1.0")).toBeNull();
  });
});

describe("the commands the client sends", () => {
  it("builds a go line from the limits it was given", () => {
    expect(goCommand({ depth: 3 })).toBe("go depth 3\n");
    expect(goCommand({ searchMoves: ["e2e4", "d2d4"], moveTimeMs: 1000 })).toBe(
      "go searchmoves e2e4 d2d4 movetime 1000\n",
    );
    expect(goCommand({ nodes: 250000, mateIn: 2 })).toBe("go nodes 250000 mate 2\n");
  });

  it("refuses a search with no limit, which would be go infinite", () => {
    expect(() => goCommand({})).toThrow(UciError);
    try {
      goCommand({});
    } catch (error) {
      expect(error).toMatchObject({ code: "protocol" });
    }
  });

  it("builds position lines for startpos and for a FEN", () => {
    expect(positionCommand({ fen: "startpos" })).toBe("position startpos\n");
    expect(positionCommand({ fen: "startpos", moves: ["e2e4", "e7e5"] })).toBe(
      "position startpos moves e2e4 e7e5\n",
    );
    expect(positionCommand({ fen: "8/8/8/8/8/8/8/K6k w - - 0 1", moves: ["a1a2"] })).toBe(
      "position fen 8/8/8/8/8/8/8/K6k w - - 0 1 moves a1a2\n",
    );
  });

  it("reads a bestmove line with and without a ponder move", () => {
    expect(parseBestmove("bestmove e2e4 ponder d7d5")).toEqual({ move: "e2e4", ponder: "d7d5" });
    expect(parseBestmove("bestmove e2e4")).toEqual({ move: "e2e4", ponder: null });
    expect(parseBestmove("info depth 1")).toBeNull();
  });
});

describe("a live engine", () => {
  it("handshakes and reports who it is and what it takes", async () => {
    const live = await startedEngine();
    expect(live.id).toEqual({ name: "Fake Engine 1.0", author: "Nexus tests" });
    expect(live.options.map((option) => option.name)).toEqual([
      "Hash",
      "Threads",
      "Move Overhead",
      "UCI_Chess960",
      "Style",
    ]);
    expect(live.options[0]?.max).toBe(1024);
    // Measured: 531 ms warm, and this whole file is 8.9 s with the executable
    // cache cold, against a 10 s budget — the first spawn of a fresh executable
    // is what costs. The budget is the margin CI needs on a slower runner.
  }, 30_000);

  it("applies an option and waits for the engine to confirm it", async () => {
    const live = await startedEngine();
    await expect(live.setOption("Hash", "64")).resolves.toBeUndefined();
    await expect(live.setOption("UCI_Chess960", "true")).resolves.toBeUndefined();
    await expect(live.newGame()).resolves.toBeUndefined();
  });

  it("refuses an option name that carries a line break, which would be a second command", async () => {
    const live = await startedEngine();
    await expect(live.setOption("Hash\nquit")).rejects.toMatchObject({ code: "protocol" });
  });

  it("plays a bounded search and answers with the info lines and the best move", async () => {
    const live = await startedEngine();
    live.position({ fen: "startpos", moves: ["e2e4"] });
    const result = await live.go({ depth: 2 });
    expect(result.bestmove).toBe("e2e4");
    expect(result.ponder).toBe("d7d5");
    expect(result.stopped).toBe(false);
    expect(result.info).toHaveLength(2);
    expect(result.info[0]?.depth).toBe(1);
    expect(result.info[1]?.nodes).toBe(200);
    expect(result.info[1]?.pv).toEqual(["d2d4", "d7d5"]);
  });

  it("stops a search that will not finish on its own, and says the search was stopped", async () => {
    const live = await startedEngine();
    const searching = live.go({ depth: 64, searchMoves: ["stopme"] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    live.stop();
    const result = await searching;
    expect(result.bestmove).toBe("e2e4");
    expect(result.stopped).toBe(true);
    expect(result.info[0]?.depth).toBe(1);
  });

  it("refuses a second search while one is running", async () => {
    const live = await startedEngine();
    const searching = live.go({ depth: 64, searchMoves: ["stopme"] });
    await expect(live.go({ depth: 1 })).rejects.toMatchObject({ code: "busy" });
    live.stop();
    await searching;
  });

  it("gives up on an engine that never answers, rather than waiting for it", async () => {
    // The deadline covers the handshake as well as the search, and the handshake
    // includes starting a process — which is why this is a second and a half and
    // not the few hundred milliseconds a search alone would need.
    const live = await startedEngine(1_500);
    await expect(live.go({ depth: 10, searchMoves: ["silent"] })).rejects.toMatchObject({ code: "timeout" });
  });

  it("reports an engine that dies mid-search, with the exit it died with", async () => {
    const live = await startedEngine();
    try {
      await live.go({ depth: 10, searchMoves: ["quit"] });
      expect.unreachable("a search against a dead engine must not resolve");
    } catch (error) {
      expect(error).toBeInstanceOf(UciError);
      expect(error).toMatchObject({ code: "engine-exited" });
      expect((error as UciError).exit?.code).toBe(0);
    }
  });

  it("ends a session politely on quit, and the entry exits zero", async () => {
    const live = await startedEngine();
    const exit = await live.quit();
    expect(exit.code).toBe(0);
    expect(exit.spawnError).toBeNull();
  });
});
