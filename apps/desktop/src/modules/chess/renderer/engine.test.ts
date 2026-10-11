import { afterEach, describe, expect, it, vi } from "vitest";

import { START_FEN, createGame, legalUci } from "@nexus/core";
import {
  connectEngine,
  type ChessEngine,
  type EnginePort,
  type EngineRequest,
  type EngineResponse,
} from "./engine.js";

/**
 * The engine seam, and the built-in engine behind it.
 *
 * Two halves, and both are needed. The first drives the seam with a port that
 * answers by hand, which is how the protocol's rules — request ids, callbacks, a
 * stale answer being dropped — are pinned without a worker. The second drives the
 * WORKER'S OWN CODE by stubbing the two globals a worker has and importing it,
 * so the moves it produces are the moves the shipped worker produces, checked
 * against `chess.js`'s legal list for the same position.
 */

/** A port that records what it was asked and lets the test answer. */
function fakePort(): {
  readonly posted: EngineRequest[];
  readonly port: EnginePort;
  readonly terminated: () => boolean;
  answer: (response: EngineResponse) => void;
} {
  const posted: EngineRequest[] = [];
  let handle: ((response: EngineResponse) => void) | null = null;
  let done = false;
  return {
    posted,
    terminated: () => done,
    port: {
      post: (request) => posted.push(request),
      listen: (listener) => {
        handle = listener;
      },
      terminate: () => {
        done = true;
      },
    },
    answer: (response) => {
      if (handle === null) throw new Error("the seam never listened");
      handle(response);
    },
  };
}

/** The seam, with its two callbacks recorded. */
function seam(port: EnginePort, degraded = false): {
  engine: ChessEngine;
  readonly moves: (string | null)[];
  readonly infos: { depth: number; nodes: number; score: number; pv: readonly string[] }[];
} {
  const moves: (string | null)[] = [];
  const infos: { depth: number; nodes: number; score: number; pv: readonly string[] }[] = [];
  const engine = connectEngine(port, degraded);
  engine.onBestMove((move) => moves.push(move));
  engine.onInfo((info) =>
    infos.push({ depth: info.depth, nodes: info.nodes, score: info.score, pv: info.pv }),
  );
  return { engine, moves, infos };
}

describe("the seam's protocol", () => {
  it("starts from the standard position, and sets any position with its history", () => {
    const kit = fakePort();
    const { engine } = seam(kit.port);

    engine.startPosition();
    expect(kit.posted).toHaveLength(1);
    expect(kit.posted[0]).toMatchObject({ type: "position", fen: START_FEN, moves: [] });

    engine.setPosition("8/8/8/8/8/8/8/K6k w - - 0 1", ["e2e4", "e7e5"], 42);
    expect(kit.posted[1]).toMatchObject({
      type: "position",
      fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
      moves: ["e2e4", "e7e5"],
      seed: 42,
    });
  });

  it("answers a go with the move the engine found, and reports its info line", () => {
    const kit = fakePort();
    const { engine, moves, infos } = seam(kit.port);

    engine.go({ level: 4 });
    const request = kit.posted[0];
    expect(request).toMatchObject({ type: "go", limits: { level: 4 } });
    const id = request?.type === "go" ? request.id : -1;

    kit.answer({
      type: "info",
      id,
      info: { depth: 3, nodes: 1_200, score: 25, pv: ["e2e4", "e7e5"], elapsedMs: 40 },
    });
    kit.answer({ type: "bestmove", id, move: "e2e4" });

    expect(infos).toEqual([{ depth: 3, nodes: 1_200, score: 25, pv: ["e2e4", "e7e5"] }]);
    expect(moves).toEqual(["e2e4"]);
  });

  it("drops an answer nobody is waiting for, which is what `stop` can mean for a blocking search", () => {
    const kit = fakePort();
    const { engine, moves } = seam(kit.port);

    engine.go({ level: 8 });
    const first = kit.posted[0];
    engine.stop();
    engine.go({ level: 2 });
    const second = kit.posted[2];

    // The abandoned search still finishes (a worker's loop is blocked while the
    // arithmetic runs), and its answer must not land on the board.
    kit.answer({ type: "bestmove", id: first?.type === "go" ? first.id : -1, move: "e2e4" });
    expect(moves).toEqual([]);

    kit.answer({ type: "bestmove", id: second?.type === "go" ? second.id : -1, move: "g1f3" });
    expect(moves).toEqual(["g1f3"]);
  });

  it("hands over a null move when the engine has no answer", () => {
    const kit = fakePort();
    const { engine, moves } = seam(kit.port);
    engine.go({ level: 1 });
    const id = kit.posted[0]?.type === "go" ? kit.posted[0].id : -1;
    kit.answer({ type: "bestmove", id, move: null });
    expect(moves).toEqual([null]);
  });

  it("stops listening once it is disposed, and tears the transport down", () => {
    const kit = fakePort();
    const { engine, moves } = seam(kit.port);
    engine.go({ level: 1 });
    const id = kit.posted[0]?.type === "go" ? kit.posted[0].id : -1;

    engine.dispose();
    expect(kit.terminated()).toBe(true);
    kit.answer({ type: "bestmove", id, move: "e2e4" });
    expect(moves).toEqual([]);
  });

  it("says whether it is a worker or the main thread", () => {
    expect(seam(fakePort().port).engine.degraded).toBe(false);
    expect(seam(fakePort().port, true).engine.degraded).toBe(true);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the built-in engine, driven directly", () => {
  /** The worker's own code, with the two globals a worker has supplied by hand. */
  async function startWorker(): Promise<{
    readonly posted: EngineResponse[];
    send: (request: EngineRequest) => void;
  }> {
    const posted: EngineResponse[] = [];
    vi.stubGlobal("postMessage", (message: EngineResponse) => posted.push(message));
    vi.stubGlobal("onmessage", null);
    await import("./engineWorker.js");
    const scope = globalThis as unknown as {
      onmessage: ((event: { data: EngineRequest }) => void) | null;
    };
    return {
      posted,
      send: (request) => {
        if (scope.onmessage === null) throw new Error("the worker never took its message handler");
        scope.onmessage({ data: request });
      },
    };
  }

  it("answers the probe, so a page can tell a live worker from a dead one", async () => {
    const worker = await startWorker();
    worker.send({ type: "probe" });
    expect(worker.posted).toEqual([{ type: "probe" }]);
  });

  it("plays a legal move at a level, with an info line that measured its own search", async () => {
    const worker = await startWorker();
    worker.send({ type: "position", fen: START_FEN, moves: [], seed: 20_261_010 });
    worker.send({ type: "go", id: 7, limits: { level: 1 } });

    const info = worker.posted.find((response) => response.type === "info");
    const best = worker.posted.find((response) => response.type === "bestmove");
    expect(best).toMatchObject({ type: "bestmove", id: 7 });
    const move = best?.type === "bestmove" ? best.move : null;

    // Legal in the position it was given, which is the one thing a board cannot
    // check for itself without trusting the engine.
    expect(legalUci(createGame())).toContain(move);
    if (info?.type === "info") {
      expect(info.info.depth).toBeGreaterThanOrEqual(1);
      expect(info.info.nodes).toBeGreaterThan(0);
      expect(info.info.elapsedMs).toBeGreaterThanOrEqual(0);
    } else {
      throw new Error("the engine answered without an info line");
    }
  });

  it("draws its levels' randomness from the seed, so the same seed plays the same move", async () => {
    const first = await startWorker();
    first.send({ type: "position", fen: START_FEN, moves: [], seed: 4_242 });
    first.send({ type: "go", id: 1, limits: { level: 1 } });
    const one = first.posted.find((response) => response.type === "bestmove");

    vi.resetModules();
    const second = await startWorker();
    second.send({ type: "position", fen: START_FEN, moves: [], seed: 4_242 });
    second.send({ type: "go", id: 1, limits: { level: 1 } });
    const two = second.posted.find((response) => response.type === "bestmove");

    expect(one).toEqual(two);
  });

  it("answers with no move when the position is over", async () => {
    const worker = await startWorker();
    // Fool's mate: Black is not to move and has already been mated.
    worker.send({
      type: "position",
      fen: "rnb1kbnr/pppp1ppp/4p3/8/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
      moves: [],
      seed: 1,
    });
    worker.send({ type: "go", id: 3, limits: { level: 1 } });
    expect(worker.posted).toEqual([{ type: "bestmove", id: 3, move: null }]);
  });
});
