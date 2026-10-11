import {
  chooseEngineMove,
  createSeededRandom,
  searchPosition,
  START_FEN,
  type SearchResult,
} from "@nexus/core";

/**
 * THE ENGINE SEAM (this module's brief): one interface a board talks to, and one
 * implementation behind it — the built-in engine this project owns, running in a
 * Web Worker.
 *
 * **Why the seam exists before there is a second implementation.** A UCI engine
 * from a content pack has to plug in here without the page learning what a
 * process is. The vocabulary below is therefore UCI's own — start position, set
 * position, `go` with limits, stop, a best move, info lines — because that is the
 * protocol such an engine already speaks, and a seam shaped like the thing that
 * will arrive is a seam that will not have to be re-cut. What this file does NOT
 * contain is any part of that future: no process, no pack, no `uci` handshake.
 *
 * **Why the search runs in a Worker.** A level's budget is up to four seconds
 * (`CHESS_LEVELS`, measured), and four seconds of arithmetic on the UI thread is
 * a frozen window — the one thing a board may never be. The page therefore talks
 * to a worker through `postMessage`, and stays responsive while it thinks. The
 * message protocol is `EngineRequest`/`EngineResponse` below; `engineWorker.ts`
 * is the other side of it.
 *
 * **The caught fallback, and what it costs.** `openBuiltInEngine` starts the
 * worker and proves it answers (a probe, because a worker that loads and then
 * dies is otherwise indistinguishable from one that is thinking). When it does
 * not — a build whose page origin denies workers — the engine falls back to the
 * SAME ladder evaluated on the main thread, capped at `MAIN_THREAD_MAX_LEVEL`.
 * The cap is the level whose budget is 500 ms (`CHESS_LEVELS`: level 5, depth 4
 * — about 0,2 s measured, the number `levels.ts` records — so the ceiling rarely
 * binds), because a level's budget belongs to the LEVEL and no caller can lower
 * it: four seconds of arithmetic on the UI thread is a frozen board, and a weaker
 * opponent is a far smaller defect than a window that stops painting. The session
 * reports `degraded: true`, and the page says so on screen rather than leaving
 * the user to wonder why the opponent is not playing at the level they chose.
 *
 * **A built-in search cannot be interrupted, and the seam says so.** A worker's
 * message loop is blocked while `chooseEngineMove` runs, so a `stop` posted
 * during a search is delivered when it finishes; the session therefore answers
 * the CALLER's stop by ignoring whatever the abandoned search returns, and a
 * later engine that can interrupt (a process) needs no change here. The request
 * id is what makes a stale answer harmless rather than a move on the board.
 *
 * **One info line per search, not a stream.** `SearchResult` is the whole of what
 * the built-in engine produces — a completed iterative deepening answers once —
 * so `onInfo` carries that summary (depth, score, nodes, principal variation),
 * and the page shows its own elapsed-time progress while it waits. Per-iteration
 * streaming is what a UCI engine adds; the handler is already in place for it.
 */

/** What a `go` asks for. `level` is this module's ladder (1..8); the other two are the UCI-style limits a caller may use instead. */
export interface EngineLimits {
  /** The engine level to play at, 1..`CHESS_LEVELS.length`. */
  readonly level?: number;
  /** A search depth in plies, when the caller wants a specific one (a hint, a test). */
  readonly depth?: number;
  /** A soft time budget in milliseconds. */
  readonly timeMs?: number;
}

/** One engine report, in UCI's own terms. */
export interface EngineInfo {
  /** The deepest iteration that COMPLETED. */
  readonly depth: number;
  /** Nodes visited, quiescence included. */
  readonly nodes: number;
  /** Centipawns from the mover's point of view. */
  readonly score: number;
  /** The principal variation, best move first, in UCI text. */
  readonly pv: readonly string[];
  /** How long the search really took, measured in the worker. */
  readonly elapsedMs: number;
}

/** Everything the page may send the engine, exactly as a UCI client sends `position` and `go`. */
export type EngineRequest =
  | { readonly type: "position"; readonly fen: string; readonly moves: readonly string[]; readonly seed: number }
  | { readonly type: "go"; readonly id: number; readonly limits: EngineLimits }
  | { readonly type: "stop" }
  | { readonly type: "probe" };

/** Everything the engine may answer with. `move: null` is „no answer": a finished position, or one it could not read. */
export type EngineResponse =
  | { readonly type: "info"; readonly id: number; readonly info: EngineInfo }
  | { readonly type: "bestmove"; readonly id: number; readonly move: string | null }
  | { readonly type: "probe" };

/**
 * One transport to an engine: a worker here, a process in the run that brings a
 * UCI pack. Injected rather than constructed, so the seam is testable with a fake
 * and so nothing in this file reaches for `Worker` itself.
 */
export interface EnginePort {
  post(request: EngineRequest): void;
  listen(handle: (response: EngineResponse) => void): void;
  /** Tears the transport down. Idempotent, because both a session end and a failed probe may ask. */
  terminate(): void;
}

/** What the board holds: one live engine session. */
export interface ChessEngine {
  /** The standard start position, with no history. */
  startPosition(): void;
  /** A position to think about, and the moves that led to it — what a UCI client sends as `position fen … moves …`. */
  setPosition(fen: string, moves: readonly string[], seed: number): void;
  /** Asks for a move. One search at a time; a second call supersedes the first. */
  go(limits: EngineLimits): void;
  /** Abandons the search in flight: its answer is dropped rather than played. */
  stop(): void;
  /** The move for the last `go` that was not stopped, as UCI text, or null when the engine has no answer. */
  onBestMove(handle: (move: string | null) => void): void;
  /** One line per completed search (see the header). */
  onInfo(handle: (info: EngineInfo) => void): void;
  /** True when the engine is not in a worker (see the header's fallback). */
  readonly degraded: boolean;
  dispose(): void;
}

/**
 * The seam's client half: request ids, the callbacks, and the rule that a stale
 * answer is dropped. Pure in the sense that matters — it holds no transport of
 * its own, so a test drives it with a port that answers by hand.
 */
export function connectEngine(port: EnginePort, degraded = false): ChessEngine {
  const bestMoveHandles: ((move: string | null) => void)[] = [];
  const infoHandles: ((info: EngineInfo) => void)[] = [];
  let nextId = 1;
  /** The request in flight, or null when nothing is being searched for. */
  let pending: number | null = null;
  let disposed = false;

  port.listen((response) => {
    if (disposed || response.type === "probe") return;
    // A stopped search still finishes (see the header), so its answer arrives
    // here for an id nobody waits for. Dropping it is the whole of what `stop`
    // can mean for an engine that runs its search in one call.
    if (response.id !== pending) return;
    if (response.type === "info") {
      for (const handle of infoHandles) handle(response.info);
      return;
    }
    pending = null;
    for (const handle of bestMoveHandles) handle(response.move);
  });

  return {
    degraded,
    startPosition() {
      pending = null;
      port.post({ type: "position", fen: START_FEN, moves: [], seed: Date.now() });
    },
    setPosition(fen, moves, seed) {
      pending = null;
      port.post({ type: "position", fen, moves: [...moves], seed });
    },
    go(limits) {
      if (disposed) return;
      const id = nextId;
      nextId += 1;
      pending = id;
      port.post({ type: "go", id, limits });
    },
    stop() {
      pending = null;
      port.post({ type: "stop" });
    },
    onBestMove(handle) {
      bestMoveHandles.push(handle);
    },
    onInfo(handle) {
      infoHandles.push(handle);
    },
    dispose() {
      disposed = true;
      pending = null;
      port.terminate();
    },
  };
}

/**
 * The strongest level the main-thread fallback plays (see the header).
 *
 * Level 5's own budget is 500 ms at depth 4 — about 0,2 s measured from the start
 * position, the number `levels.ts` records — so a fallback move costs the user a
 * fraction of a second, and a level-8 game is answered by a level-5 opponent
 * instead of a window that stops painting for four seconds.
 */
const MAIN_THREAD_MAX_LEVEL = 5;

/** How long the worker is given to prove it answers, before the page settles for the main thread. */
const PROBE_TIMEOUT_MS = 750;

/** The same limits, with the level capped as the header describes. */
function boundedLimits(limits: EngineLimits): EngineLimits {
  if (limits.level === undefined) return limits;
  return { ...limits, level: Math.min(limits.level, MAIN_THREAD_MAX_LEVEL) };
}

/**
 * The engine, in the page: a worker when one can be started and answers, the
 * main thread otherwise (see the header for why both exist and what the fallback
 * costs). Async because „did it answer" is a fact about the transport and there
 * is no way to know it synchronously.
 */
export async function openBuiltInEngine(): Promise<ChessEngine> {
  try {
    const worker = new Worker(new URL("./engineWorker.ts", import.meta.url), { type: "module" });
    const port = workerPort(worker);
    if (await probe(port)) return connectEngine(port);
    port.terminate();
  } catch (error) {
    console.error("Nexus: the chess engine's worker could not be started.", error);
  }
  console.error(
    "Nexus: the chess engine is running on the main thread — its search is capped so the board stays responsive.",
  );
  return connectEngine(inlinePort(), true);
}

/** A `Worker` as an `EnginePort`: messages both ways, and a terminate that really tears it down. */
function workerPort(worker: Worker): EnginePort {
  return {
    post: (request) => worker.postMessage(request),
    listen: (handle) => {
      worker.addEventListener("message", (event: MessageEvent<EngineResponse>) => handle(event.data));
    },
    terminate: () => worker.terminate(),
  };
}

/**
 * Asks the port whether it is there, and waits at most `PROBE_TIMEOUT_MS` for the
 * answer. A worker that loads its script but fails inside it never answers, which
 * is exactly the case this exists to catch — constructing a `Worker` happily
 * succeeds for a script that will not run.
 */
function probe(port: EnginePort): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
    port.listen((response) => {
      if (response.type !== "probe") return;
      clearTimeout(timer);
      resolve(true);
    });
    port.post({ type: "probe" });
  });
}

/**
 * The fallback transport: the same engine, the same protocol, evaluated in this
 * thread. `setTimeout(0)` rather than an immediate call, so a caller's render
 * lands before the search blocks, and so a `stop` that arrives in the same tick
 * wins — the one thing a blocking search can still honour.
 */
function inlinePort(): EnginePort {
  let current: { fen: string; seed: number } = { fen: START_FEN, seed: 0 };
  let handles: ((response: EngineResponse) => void)[] = [];
  let cancelled = 0;
  let live = true;

  return {
    post(request) {
      if (!live) return;
      if (request.type === "probe") {
        for (const handle of handles) handle({ type: "probe" });
        return;
      }
      if (request.type === "position") {
        current = { fen: request.fen, seed: request.seed };
        return;
      }
      if (request.type === "stop") {
        cancelled += 1;
        return;
      }
      const generation = cancelled;
      const id = request.id;
      const limits = boundedLimits(request.limits);
      setTimeout(() => {
        if (!live || generation !== cancelled) return;
        const answer = searchFor(current.fen, limits, current.seed);
        if (answer === null) {
          for (const handle of handles) handle({ type: "bestmove", id, move: null });
          return;
        }
        for (const handle of handles) handle({ type: "info", id, info: answer.info });
        for (const handle of handles) handle({ type: "bestmove", id, move: answer.move });
      }, 0);
    },
    listen(handle) {
      handles.push(handle);
    },
    terminate() {
      live = false;
      handles = [];
    },
  };
}

/**
 * The limits a bare `searchPosition` call takes: the depth it insists on, and a
 * time budget only when there is one (`exactOptionalPropertyTypes` refuses an
 * explicit `undefined`, and passing one would be a different statement anyway).
 */
function searchLimits(limits: EngineLimits): { depth: number; timeMs?: number } {
  const depth = limits.depth ?? 1;
  return limits.timeMs === undefined ? { depth } : { depth, timeMs: limits.timeMs };
}

/** One search, whichever limit was given — the two roads `EngineLimits` describes, and nothing else. */
function searchFor(
  fen: string,
  limits: EngineLimits,
  seed: number,
): { move: string | null; info: EngineInfo } | null {
  const startedAt = performance.now();
  const random = createSeededRandom(seed);
  const options = { rng: () => random.next(), now: () => performance.now() };
  let result: SearchResult | null;
  if (limits.level !== undefined) {
    result = chooseEngineMove(fen, limits.level, options);
  } else {
    result = searchPosition(fen, searchLimits(limits), options);
  }
  if (result === null) return null;
  return {
    move: result.move,
    info: {
      depth: result.depth,
      nodes: result.nodes,
      score: result.score,
      pv: result.pv,
      elapsedMs: Math.round(performance.now() - startedAt),
    },
  };
}
