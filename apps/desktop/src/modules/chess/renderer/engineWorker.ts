import { chooseEngineMove, createSeededRandom, searchPosition, START_FEN } from "@nexus/core";
import type { SearchResult } from "@nexus/core";
import type { EngineRequest, EngineResponse } from "./engine.js";

/**
 * CHESS' engine, in a Web Worker (`engine.ts` is the seam's page-side half).
 *
 * **Why a worker at all.** A level's search runs for up to four seconds
 * (`CHESS_LEVELS`, measured), and those four seconds on the UI thread are a
 * frozen board. This file is the other side of the wire: it holds one position
 * and one random stream, answers `go` with a best move and an info line, and
 * touches no DOM.
 *
 * **The stream is seeded, and the seed belongs to the caller.** The engine never
 * calls `Math.random` (`games/random.ts` carries that rule for every game in this
 * project): the page hands a seed with each position, so the engine's tie-breaks
 * are the same on every machine for the same seed.
 *
 * **The position's HISTORY is accepted and not used.** `setPosition` carries the
 * moves that led to the FEN because that is what a UCI engine is sent, and the
 * built-in search needs only the position itself — `chooseEngineMove` answers
 * from the FEN, and a search has no use for how a position arose. The field is
 * kept in the protocol so the pack that plugs in here later needs no new shape.
 *
 * **The scope is reached through `globalThis`, not through `self`.** The
 * desktop's web tsconfig carries the DOM lib and not `webworker`, so naming
 * `DedicatedWorkerGlobalScope` would not typecheck; what this file actually uses
 * is two members, and they are declared below rather than imported from a lib
 * that would then also describe a `window` this file does not have.
 */

interface WorkerScope {
  onmessage: ((event: { readonly data: EngineRequest }) => void) | null;
  postMessage(message: EngineResponse): void;
}

const scope = globalThis as unknown as WorkerScope;

/** What the last `position` set. */
let fen = START_FEN;

/**
 * The engine's own randomness, reseeded at every position. One stream per
 * position rather than per session, so a resumed game does not inherit the tail
 * of another one's sequence.
 */
let seed = 0;

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "probe") {
    scope.postMessage({ type: "probe" });
    return;
  }
  if (request.type === "position") {
    fen = request.fen;
    seed = request.seed;
    return;
  }
  // A `stop` cannot interrupt a search that is already running (the message
  // waits for the arithmetic to finish), and the client knows it: the id it
  // abandoned is the id this answer will not match (see `connectEngine`).
  if (request.type === "stop") return;

  const startedAt = performance.now();
  let result: SearchResult | null = null;
  try {
    const random = createSeededRandom(seed);
    const options = { rng: () => random.next(), now: () => performance.now() };
    const limit = request.limits;
    result =
      limit.level === undefined
        ? searchPosition(
            fen,
            limit.timeMs === undefined
              ? { depth: limit.depth ?? 1 }
              : { depth: limit.depth ?? 1, timeMs: limit.timeMs },
            options,
          )
        : chooseEngineMove(fen, limit.level, options);
  } catch (error) {
    // A FEN this engine cannot read is a caller's bug, and the answer is still a
    // well-formed „no move" — the board then reports a failure instead of
    // waiting for a message that will never come.
    console.error("Nexus: the chess engine could not search that position.", error);
  }

  if (result !== null) {
    scope.postMessage({
      type: "info",
      id: request.id,
      info: {
        depth: result.depth,
        nodes: result.nodes,
        score: result.score,
        pv: result.pv,
        elapsedMs: Math.round(performance.now() - startedAt),
      },
    });
  }
  scope.postMessage({ type: "bestmove", id: request.id, move: result?.move ?? null });
};
