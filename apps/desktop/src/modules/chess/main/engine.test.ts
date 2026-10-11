import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { START_FEN } from "@nexus/core";
import { afterEach, describe, expect, it } from "vitest";

import { createModuleTools, type ModuleToolsAccess } from "../../../main/moduleTools.js";
import { fixtureScript, installedToolPack } from "../../../main/tools/fixtures.js";
import { TOOL_LIMITS } from "../../../main/tools/run.js";
import { makeKey } from "../../../main/packs/fixtures.js";
import { parseInfo } from "../../../main/tools/uci.js";
import { createStockfishSessions, engineAnswer, type StockfishSessions } from "./engine.js";

/**
 * The pack's sessions through the whole path: an installed, signed pack folder,
 * the kit's tool capability, the UCI client, and a real process on the other end.
 *
 * The engine is `tools/fixtures/fake-engine.mts` — a real UCI program over real
 * pipes, whose answers are fixed, so the assertions below can name the move, the
 * depth, the node count and the score instead of „a number“. Never Stockfish: the
 * point of this file is that this module's plumbing carries a UCI conversation
 * correctly, and a fixed engine is the only way to state what „correctly“ means.
 */

let root: string | null = null;
let open: StockfishSessions | null = null;

afterEach(async () => {
  await open?.closeAll();
  open = null;
  if (root !== null) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  root = null;
});

/** The capability over a freshly installed pack, or over no pack at all. */
function toolsFor(input: { readonly protocol: "uci"; readonly args: readonly string[] } | null): ModuleToolsAccess {
  const userData = mkdtempSync(join(tmpdir(), "nexus-chess-engine-"));
  root = userData;
  if (input === null) {
    return createModuleTools({ userData: () => userData, publicKeyPem: "no key", tempRoot: userData });
  }
  const key = makeKey();
  installedToolPack({
    userData,
    key,
    id: "stockfish",
    version: "19.0.0",
    protocol: input.protocol,
    args: [...input.args],
  });
  return createModuleTools({
    userData: () => userData,
    publicKeyPem: key.publicKeyPem,
    tempRoot: userData,
    limits: { ...TOOL_LIMITS, timeoutMs: 30_000 },
  });
}

describe("a pack search", () => {
  it("plays the move the engine answered, with the engine's own numbers", async () => {
    open = createStockfishSessions({ tools: toolsFor({ protocol: "uci", args: [fixtureScript("fake-engine.mts")] }) });
    const answer = await open.move({ game: "g1", fen: START_FEN, moves: [], level: 8 });
    // The fake engine's second `info` line, quoted from `tools/fixtures/fake-engine.mts`:
    // `info depth 2 seldepth 4 multipv 1 score cp 12 nodes 200 …`.
    expect(answer).toEqual({
      outcome: "move",
      move: "e2e4",
      depth: 2,
      nodes: 200,
      score: 12,
    });
    // Measured: 480 ms with the shared executable already cached — the entry's
    // hash, the handshake and the search are all of it. The budget is CI's margin
    // on a machine three times slower than this one.
  }, 30_000);

  it("reuses one session per game, and starts a fresh one after it is closed", async () => {
    open = createStockfishSessions({ tools: toolsFor({ protocol: "uci", args: [fixtureScript("fake-engine.mts")] }) });
    await open.move({ game: "g1", fen: START_FEN, moves: [], level: 7 });
    // The same game again: the SECOND search on the session the first one opened.
    // A session is a game, so this must not pay for a second process — and the
    // answer proves the position was set again rather than the search refused.
    const second = await open.move({ game: "g1", fen: START_FEN, moves: ["e2e4"], level: 7 });
    expect(second.outcome).toBe("move");

    // Closing answers whether there was anything to close, which is what the
    // page's own `engineClose` reports back.
    expect(await open.close("g1")).toBe(true);
    expect(await open.close("g1")).toBe(false);

    // A search after the close opens a new session, so a page that reopens a game
    // is never left without an engine.
    expect((await open.move({ game: "g1", fen: START_FEN, moves: [], level: 7 })).outcome).toBe("move");
  }, 30_000);

});

/**
 * The mapping from the engine's own lines onto what the page draws — pure, and
 * therefore asserted with the engine's recorded numbers rather than through a
 * process that would have to be arranged to produce each one.
 */
describe("the answer built from the engine's own lines", () => {
  it("reports the last iteration's depth, nodes and centipawn score", () => {
    const info = [
      parseInfo("info depth 1 seldepth 2 multipv 1 score cp 30 nodes 20 time 1 pv d2d4"),
      parseInfo("info depth 2 seldepth 3 multipv 1 score cp 29 nodes 148 time 1 pv e2e4"),
    ];
    expect(engineAnswer("e2e4", info)).toEqual({
      outcome: "move",
      move: "e2e4",
      depth: 2,
      nodes: 148,
      score: 29,
    });
  });

  it("reports a position with no move in it as `none`, not as the word the engine wrote", () => {
    // `bestmove (none)` is what a real engine answers for a mate or a stalemate.
    expect(engineAnswer("(none)", [])).toEqual({ outcome: "none" });
  });

  it("leaves the score null for a mate, because a mate is a distance and not centipawns", () => {
    const info = [parseInfo("info depth 3 score mate -2 pv h7h8q")];
    expect(engineAnswer("h7h8q", info)).toEqual({
      outcome: "move",
      move: "h7h8q",
      depth: 3,
      nodes: null,
      score: null,
    });
  });
});

describe("what a pack search refuses", () => {
  it("refuses with `no-pack` when no engine pack is installed", async () => {
    open = createStockfishSessions({ tools: toolsFor(null) });
    await expect(open.move({ game: "g1", fen: START_FEN, moves: [], level: 8 })).resolves.toEqual({
      outcome: "refused",
      code: "no-pack",
    });
  });

  it("refuses with `engine` when the pack's program is not an engine", async () => {
    // A pack whose entry starts, fails and exits: the handshake never completes,
    // and the page is told which half of the pair went wrong.
    open = createStockfishSessions({
      tools: toolsFor({ protocol: "uci", args: [fixtureScript("fake-tool.mts"), "fail"] }),
    });
    await expect(open.move({ game: "g1", fen: START_FEN, moves: [], level: 6 })).resolves.toEqual({
      outcome: "refused",
      code: "engine",
    });
  }, 30_000);
});
