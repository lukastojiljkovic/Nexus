import type {
  CalculatorAngleMode,
  CalculatorLocale,
  CalculatorPrecision,
  CalculatorSession,
} from "@nexus/core";
import type { CalculatorAnswer } from "./expression.js";

/**
 * The renderer's half of the Web Worker boundary (ADR-090 §4: heavy computation
 * never runs on the UI thread).
 *
 * **Why a worker at all.** An expression is a program, and `limits.ts` says out
 * loud that its guard models the shapes it can see rather than every shape there
 * is - `kron(range(1, 2000), range(1, 2000))` is one line to type and grows a
 * matrix nobody asked for. Evaluated on the UI thread, that expression freezes
 * the window with no way back; in a worker it costs exactly one worker, which
 * this file terminates when its deadline passes.
 *
 * **Why the deadline is here and not in the engine.** The engine is synchronous
 * by design (`engine.ts`: everything an `evaluate` needs is in its arguments), so
 * nothing inside it can be interrupted. The only thing that CAN stop a runaway
 * evaluation is the process it does not block, which is what the renderer is
 * while the worker works - so the deadline is a `terminate()` and a refusal, and
 * the worker is thrown away rather than reused, because a worker that was
 * interrupted mid-expression may hold a half-built scope.
 *
 * **Why this file takes its port as a parameter.** So the policy is testable
 * without a browser: the tests hand in a `EnginePort` that never answers, or one
 * backed by a real `node:worker_threads` thread running a busy loop, and what
 * they pin is the deadline and the termination. `workerPort.ts` is the ten lines
 * that build the real one, and it is the only file in this module that names
 * Vite's `?worker` import.
 */

/** Everything one evaluation needs; the engine's own options, plus the expression. */
export interface EngineRequest {
  readonly id: number;
  readonly expression: string;
  readonly precision: CalculatorPrecision;
  readonly angleMode: CalculatorAngleMode;
  readonly locale: CalculatorLocale;
  readonly session: CalculatorSession;
}

/** What the worker answers with: the engine's outcome, for the request it belongs to. */
export interface EngineReply {
  readonly id: number;
  readonly outcome: CalculatorAnswer;
}

/**
 * The worker, as this file uses it.
 *
 * Four members and no more, which is what lets a test stand a fake in for the
 * real thing (`Worker` itself, with `?worker`, is `workerPort.ts`'s business).
 */
export interface EnginePort {
  postMessage(message: EngineRequest): void;
  terminate(): void;
  onMessage(handler: (reply: EngineReply) => void): void;
  onError(handler: (error: unknown) => void): void;
}

/**
 * How long one evaluation may take, measured on this machine rather than guessed.
 *
 * The engine's own guard refuses the shapes it can see before evaluating them
 * (`limits.ts`: `ones(10000, 10000)` held a process for twenty-five seconds and
 * was killed), so what reaches this deadline is the residue the guard does not
 * model. Four seconds is deliberately longer than anything a person waits for
 * on a calculator and short enough that the page's „prekinuto" sentence arrives
 * while the user is still looking at the line they typed; an ordinary expression
 * answers in single-digit milliseconds, so the deadline never enters the path a
 * working calculation takes.
 */
export const ENGINE_TIMEOUT_MS = 4_000;

/** The two ways the worker can fail without answering: it took too long, or it fell over. */
export type EngineStop = "timeout" | "stopped";

export interface EngineClientOptions {
  /** Builds a worker. Called again after a stop, because a stopped worker is discarded. */
  readonly spawn: () => EnginePort;
  /** Overridable so a test can drive the clock instead of waiting for it. */
  readonly timeoutMs?: number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** One expression's answer: the engine's outcome, or the engine's own refusal shape for a stop. */
export interface EngineClient {
  evaluate(request: Omit<EngineRequest, "id">): Promise<CalculatorAnswer>;
  /** Terminates the worker and settles anything in flight. Called when the page unmounts. */
  dispose(): void;
}

interface Waiting {
  readonly settle: (outcome: CalculatorAnswer) => void;
  readonly handle: unknown;
}

export function createEngineClient(options: EngineClientOptions): EngineClient {
  const timeoutMs = options.timeoutMs ?? ENGINE_TIMEOUT_MS;
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let port: EnginePort | null = null;
  let nextId = 1;
  /** At most one evaluation is in flight at a time (`Page.tsx` awaits in order), but the map is keyed so that a late reply cannot settle the wrong request. */
  const waiting = new Map<number, Waiting>();

  /** Terminates the worker, discards it, and refuses everything in flight with `reason`. */
  function abandon(reason: EngineStop): void {
    port?.terminate();
    port = null;
    const pending = [...waiting.values()];
    waiting.clear();
    for (const entry of pending) {
      clearTimer(entry.handle);
      entry.settle({ ok: false, code: reason });
    }
  }

  function receive(reply: EngineReply): void {
    const entry = waiting.get(reply.id);
    if (entry === undefined) return;
    waiting.delete(reply.id);
    clearTimer(entry.handle);
    entry.settle(reply.outcome);
  }

  function start(): EnginePort {
    const created = options.spawn();
    created.onMessage(receive);
    // An uncaught error inside the worker (a chunk that failed to load, a bug in
    // the boundary) arrives here and nowhere else; it is a stop, not an engine
    // refusal, so the page is told the calculation did not finish.
    created.onError(() => abandon("stopped"));
    return created;
  }

  return {
    evaluate(request) {
      const current = port ?? (port = start());
      const id = nextId;
      nextId += 1;
      return new Promise<CalculatorAnswer>((settle) => {
        // The entry is recorded BEFORE the message is posted, so a worker that
        // answers synchronously (a fake in a test) cannot beat its own entry into
        // the map.
        const handle = setTimer(() => abandon("timeout"), timeoutMs);
        waiting.set(id, { settle, handle });
        current.postMessage({ ...request, id });
      });
    },
    dispose() {
      abandon("stopped");
    },
  };
}
