import { createCalculatorEngine, type CalculatorEngine, type CalculatorPrecision } from "@nexus/core";
import type { EngineReply, EngineRequest } from "./engineClient.js";

/**
 * The calculator's ENGINE THREAD: the only place in this application where an
 * expression a user typed is actually evaluated (ADR-090 §4).
 *
 * **Why an engine per precision rather than per request.** `createCalculatorEngine`
 * builds one mathjs instance (about 5 ms, `engine.ts`) and keeps it in a module
 * map, and its `evaluate` is stateless from the caller's point of view -
 * everything one call needs arrives in its arguments, session included. So the
 * worker holds two, one for each mode, and never rebuilds them; the session
 * travels with the request and comes back in the outcome.
 *
 * **Nothing is caught here.** The engine never throws at its caller (every
 * refusal is a code - `engine.ts`'s third rule), so an exception reaching this
 * file means the boundary itself is broken, and the honest thing is to let it
 * reach the worker's `error` event, which `engineClient.ts` turns into a
 * „stopped" refusal. Swallowing it here would leave the page waiting for a reply
 * that will never come.
 *
 * The cast is the DOM lib's own gap rather than a shortcut: a module worker's
 * global scope is a `DedicatedWorkerGlobalScope`, and the renderer's tsconfig
 * carries the `DOM` lib where `self` is typed as a `Window`. `Worker` is the
 * closest DOM type that has both `onmessage` and `postMessage`, and this file
 * uses exactly those two.
 */

const engines = new Map<CalculatorPrecision, CalculatorEngine>();

function engineFor(precision: CalculatorPrecision): CalculatorEngine {
  const existing = engines.get(precision);
  if (existing !== undefined) return existing;
  const created = createCalculatorEngine(precision);
  engines.set(precision, created);
  return created;
}

const scope = self as unknown as Worker;

scope.onmessage = (event: MessageEvent<EngineRequest>): void => {
  const request = event.data;
  const outcome = engineFor(request.precision).evaluate(request.expression, {
    session: request.session,
    angleMode: request.angleMode,
    format: { locale: request.locale },
  });
  const reply: EngineReply = { id: request.id, outcome };
  scope.postMessage(reply);
};
