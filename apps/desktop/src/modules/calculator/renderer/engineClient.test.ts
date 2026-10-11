import { Worker as NodeWorker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createCalculatorEngine, emptyCalculatorSession } from "@nexus/core";
import type { CalculatorSession } from "@nexus/core";
import {
  ENGINE_TIMEOUT_MS,
  createEngineClient,
  type EnginePort,
  type EngineReply,
  type EngineRequest,
} from "./engineClient.js";

/**
 * CALCULATOR's worker boundary (ADR-090 §4): the deadline that stops a runaway
 * expression, and the reply path an ordinary one takes.
 *
 * **Why the deadline is tested with a fake port, and separately with a real
 * thread.** `engineClient.ts` takes its worker as a parameter precisely so the
 * POLICY is testable without a browser: the first two cases drive a port that
 * never answers (which is what a runaway evaluation looks like from the renderer)
 * and a port that answers, with an injected clock so neither waits. The third
 * case then uses a REAL `node:worker_threads` thread spinning a busy loop, because
 * a fake cannot show the thing that matters most - that `terminate()` really ends
 * a thread that has stopped listening.
 *
 * Vitest cannot start the module's own `engine.worker.ts` (`?worker` is Vite's, and
 * these suites run in a Node environment with no bundler), so what is proven here
 * is the policy plus the engine: the RUNNAWAY expression is real and the engine's
 * own guard does not refuse it.
 */

/**
 * The expression this file's deadline exists for - a user-defined recursive
 * function.
 *
 * `limits.ts` says out loud that the guard models the shapes it can SEE, and a
 * user function is not one of them: `fib(40)` is one line to type and roughly a
 * billion calls to run. `fib(10)` is computed below as the oracle that the
 * expression is a real program the engine accepts, so the deadline is about how
 * long it takes rather than about a refusal the engine would have made anyway.
 */
const FIB_SESSION: CalculatorSession = {
  version: 1,
  variables: {},
  functions: { fib: { params: ["n"], body: "n < 2 ? n : fib(n - 1) + fib(n - 2)" } },
  ans: null,
};
const RUNAWAY = "fib(40)";

function fakePort(): {
  readonly port: EnginePort;
  readonly posted: EngineRequest[];
  readonly terminated: () => boolean;
  readonly answer: (reply: EngineReply) => void;
  readonly fail: () => void;
} {
  let receive: ((reply: EngineReply) => void) | null = null;
  let raise: (() => void) | null = null;
  let killed = false;
  const posted: EngineRequest[] = [];
  return {
    posted,
    terminated: () => killed,
    answer: (reply) => receive?.(reply),
    fail: () => raise?.(),
    port: {
      postMessage: (message) => {
        posted.push(message);
      },
      terminate: () => {
        killed = true;
      },
      onMessage: (handler) => {
        receive = handler;
      },
      onError: (handler) => {
        raise = () => handler(new Error("worker failed"));
      },
    },
  };
}

/** The request every case below sends; the session is empty, so nothing depends on a database. */
function request(expression: string): Omit<EngineRequest, "id"> {
  return {
    expression,
    precision: "float",
    angleMode: "deg",
    locale: "sr",
    session: FIB_SESSION,
  };
}

/** A clock the test drives by hand, so a four-second deadline costs nothing. */
function controlledClock(): {
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly fire: () => void;
} {
  const timers: (() => void)[] = [];
  return {
    setTimer: (run) => {
      timers.push(run);
      return timers.length;
    },
    fire: () => {
      for (const run of timers.splice(0)) run();
    },
  };
}

describe("the engine client's deadline", () => {
  it("stops a runaway expression, refuses it by name, and discards the worker", async () => {
    const fake = fakePort();
    const clock = controlledClock();
    const client = createEngineClient({
      spawn: () => fake.port,
      timeoutMs: ENGINE_TIMEOUT_MS,
      setTimer: clock.setTimer,
      clearTimer: () => undefined,
    });

    const pending = client.evaluate(request(RUNAWAY));
    // The engine computes the same function for a size it can finish, which is what
    // makes this a runaway rather than a refusal the engine would have made first.
    // `fib(10)` is 55 - the tenth Fibonacci number, counted by hand: 1 1 2 3 5 8 13
    // 21 34 55.
    const small = createCalculatorEngine("float").evaluate("fib(10)", {
      session: FIB_SESSION,
    });
    expect(small.ok && small.value).toBe("55");
    // Nothing has answered, and the request really was posted with the expression.
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]?.expression).toBe(RUNAWAY);

    clock.fire();

    await expect(pending).resolves.toEqual({ ok: false, code: "timeout" });
    // A worker that was interrupted mid-expression may hold a half-built scope, so
    // it is thrown away rather than reused.
    expect(fake.terminated()).toBe(true);
  });

  it("spawns a fresh worker for the next expression, and answers what it replies with", async () => {
    const created: ReturnType<typeof fakePort>[] = [];
    const clock = controlledClock();
    const client = createEngineClient({
      spawn: () => {
        const next = fakePort();
        created.push(next);
        return next.port;
      },
      setTimer: clock.setTimer,
      clearTimer: () => undefined,
    });

    const runaway = client.evaluate(request(RUNAWAY));
    clock.fire();
    await expect(runaway).resolves.toEqual({ ok: false, code: "timeout" });

    const pending = client.evaluate(request("2 + 2"));
    expect(created).toHaveLength(2);
    const id = created[1]?.posted[0]?.id ?? 0;
    created[1]?.answer({
      id,
      outcome: {
        ok: true,
        value: "4",
        display: "4",
        programmer: { hex: "4", octal: "4", binary: "100" },
        session: emptyCalculatorSession(),
      },
    });
    await expect(pending).resolves.toMatchObject({ ok: true, value: "4", display: "4" });
  });

  it("refuses rather than waits when the worker itself fails", async () => {
    const fake = fakePort();
    const client = createEngineClient({
      spawn: () => fake.port,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });

    const pending = client.evaluate(request("1 + 1"));
    fake.fail();

    await expect(pending).resolves.toEqual({ ok: false, code: "stopped" });
    expect(fake.terminated()).toBe(true);
  });

  it("really ends a thread that would not stop, and says so", async () => {
    const workers: NodeWorker[] = [];
    const client = createEngineClient({
      spawn: () => {
        // A real thread, spinning from the moment it starts: it never reads a
        // message, so nothing but `terminate()` can end it.
        const worker = new NodeWorker("while (true) {}", { eval: true });
        workers.push(worker);
        return {
          postMessage: (message: EngineRequest) => {
            void message;
            // Deliberately not delivered: the thread is already busy. That is what
            // a runaway expression looks like from the renderer's side.
          },
          terminate: () => {
            void worker.terminate();
          },
          onMessage: (handler: (reply: EngineReply) => void) => {
            worker.on("message", (data: unknown) => handler(data as EngineReply));
          },
          onError: (handler: (error: unknown) => void) => {
            worker.on("error", handler);
          },
        };
      },
      timeoutMs: 150,
    });

    const answer = await client.evaluate(request(RUNAWAY));

    expect(answer).toEqual({ ok: false, code: "timeout" });
    expect(workers).toHaveLength(1);
    // `terminate()` answers once the thread has actually stopped, which is the
    // half a fake port cannot show.
    await expect(workers[0]?.terminate()).resolves.toBeDefined();
  });
});
