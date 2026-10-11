import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseBestmove, parseInfo, parseOption, type UciOption } from "../../../main/tools/uci.js";
import {
  applyStrength,
  eloRangeOf,
  needsPack,
  packStrength,
  PACK_FIRST_LEVEL,
  type PackStrength,
} from "./stockfish.js";

/**
 * The level mapping (ADR-094) against RECORDED Stockfish output.
 *
 * `fixtures/stockfish-19-uci.txt` is the whole stdout of a real session with the
 * engine the `stockfish` pack ships — the release's own Windows x64 binary, at
 * the version the pack pins — and the fixture's README records how it was taken,
 * from which URL, and the digest of the executable that produced it. Nothing
 * here is a hand-written example of what Stockfish „would“ print: the option
 * lines are the engine's, so a change in them is a change in what the pack
 * ships, which is exactly the thing worth being told about.
 *
 * No engine is started and no process is spawned: every value below is read by
 * the same pure parser the UCI client uses in the app, from lines the engine
 * really wrote.
 */

const TRANSCRIPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "stockfish-19-uci.txt"),
  "utf8",
).split("\n");

/** The `option` lines of the recorded handshake, parsed. */
const ADVERTISED: readonly UciOption[] = TRANSCRIPT.flatMap((line) => {
  const option = line.startsWith("option ") ? parseOption(line) : null;
  return option === null ? [] : [option];
});

describe("the recorded transcript", () => {
  it("is the engine's own handshake, and the parser reads all of it", () => {
    expect(TRANSCRIPT).toContain("id name Stockfish 19");
    expect(TRANSCRIPT).toContain("uciok");
    // Stockfish 19 advertises nineteen options; a transcription that lost a line
    // would still parse, and this is what would notice.
    expect(ADVERTISED).toHaveLength(19);
    // The banner, the `info string` lines and `tbhits` are all things this client
    // does NOT model, and it skips them rather than refusing the line: the engine
    // writes them, and a client that died on one would fail on a good engine.
    const search = TRANSCRIPT.filter((line) => line.startsWith("info depth")).map(parseInfo);
    expect(search).toHaveLength(6);
    const last = search[search.length - 1];
    expect(last?.depth).toBe(6);
    expect(last?.nodes).toBe(2282);
    expect(last?.score).toEqual({ kind: "cp", value: 30, lowerBound: false, upperBound: false });
    expect(last?.pv).toEqual(["e2e4", "d7d5", "e4d5", "d8d5"]);
    expect(parseBestmove(TRANSCRIPT.find((line) => line.startsWith("bestmove")) ?? "")).toEqual({
      move: "e2e4",
      ponder: "d7d5",
    });
  });
});

describe("the engine's own strength options", () => {
  it("reads the Elo bounds the engine advertises, not a number written down here", () => {
    // `option name UCI_Elo type spin default 1320 min 1320 max 3190` — the engine's
    // line, and the reason the ladder below is expressed across a range rather
    // than in ratings this module chose.
    expect(eloRangeOf(ADVERTISED)).toEqual({ min: 1320, max: 3190 });
  });

  it("answers null when the engine cannot be asked for a rating at all", () => {
    // An engine with neither option (nothing to set), and one with only half the
    // pair (a rating it will not accept) are both „no rating“, which the caller
    // then states rather than guessing a strength.
    expect(eloRangeOf([])).toBeNull();
    const elo = ADVERTISED.filter((option) => option.name === "UCI_Elo");
    expect(eloRangeOf(elo)).toBeNull();
    const limit = ADVERTISED.filter((option) => option.name === "UCI_LimitStrength");
    expect(eloRangeOf(limit)).toBeNull();
  });
});

describe("the level mapping", () => {
  const range = { min: 1320, max: 3190 };

  it("spreads the levels it plays across the engine's own range", () => {
    // Hand calculation, and the arithmetic is the whole assertion:
    // 3190 - 1320 = 1870; level 7 is halfway, so 1870 / 2 = 935, and
    // 1320 + 935 = 2255. Level 6 takes the bottom of the range and level 8 its
    // top, so this module never asks for a rating the engine does not offer.
    expect(packStrength(6, range)).toEqual({ elo: 1320, depth: 5, timeMs: 1_500 });
    expect(packStrength(7, range)).toEqual({ elo: 2255, depth: 6, timeMs: 2_000 });
    expect(packStrength(8, range)).toEqual({ elo: 3190, depth: 7, timeMs: 4_000 });
  });

  it("keeps the search budget of this module's own ladder", () => {
    // The depth and the time budget are `@nexus/core`'s eight levels — the same
    // dials the built-in engine searches to — so a level means the same amount of
    // thinking whichever engine plays it.
    for (const level of [6, 7, 8]) {
      const strength = packStrength(level, range);
      const built = packStrength(level, null);
      expect(strength.depth).toBe(built.depth);
      expect(strength.timeMs).toBe(built.timeMs);
    }
  });

  it("asks for no rating at all when the engine advertises none", () => {
    expect(packStrength(8, null)).toEqual({ elo: null, depth: 7, timeMs: 4_000 });
  });

  it("leaves the levels below the pack's own to the module's engine", () => {
    expect(PACK_FIRST_LEVEL).toBe(6);
    expect(needsPack(5)).toBe(false);
    expect(needsPack(6)).toBe(true);
    expect(needsPack(8)).toBe(true);
  });
});

describe("applying a strength", () => {
  /** A recorder standing in for the engine, so the exact option calls are assertable. */
  function recorder(): { readonly calls: string[][]; readonly setOption: (name: string, value: string | null) => Promise<void> } {
    const calls: string[][] = [];
    return {
      calls,
      setOption: (name, value) => {
        calls.push(value === null ? [name] : [name, value]);
        return Promise.resolve();
      },
    };
  }

  it("sets the pair that carries a rating, in the order the protocol reads it", async () => {
    const engine = recorder();
    await applyStrength(engine, { elo: 2255, depth: 6, timeMs: 2_000 });
    expect(engine.calls).toEqual([
      ["UCI_LimitStrength", "true"],
      ["UCI_Elo", "2255"],
    ]);
  });

  it("turns the limit OFF rather than leaving whatever the last session set", async () => {
    // UCI is one process: a `setoption` that was never sent is a setting the
    // engine keeps, so „no rating“ has to be stated.
    const engine = recorder();
    await applyStrength(engine, { elo: null, depth: 7, timeMs: 4_000 });
    expect(engine.calls).toEqual([["UCI_LimitStrength", "false"]]);
  });

  it("sends nothing but the two options, whatever the level's budget is", async () => {
    const engine = recorder();
    const strength: PackStrength = packStrength(7, { min: 1320, max: 3190 });
    await applyStrength(engine, strength);
    expect(engine.calls.flat()).not.toContain("depth");
    expect(engine.calls).toHaveLength(2);
  });
});
