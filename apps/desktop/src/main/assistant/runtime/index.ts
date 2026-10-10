/**
 * `createModelHost` — the assistant's model runtime, as the module will call it.
 *
 * The factory takes its dependencies so that every part of it can be driven in a
 * test; called with no arguments it builds the app's own wiring, which is the one
 * thing here that imports Electron (`electron.ts`). The next wave's
 * `main/register.ts` therefore has two correct ways to use it:
 *
 *   const host = createModelHost();                  // the app, with the real worker
 *   const host = createModelHost(testDeps);          // a test, with a fake one
 *
 * WHAT IS NOT HERE, deliberately: nothing in this file, `host.ts`, `install.ts`,
 * `huggingface.ts`, `recommend.ts`, `catalogue.ts`, `gguf.ts` or `protocol.ts`
 * imports `node-llama-cpp`. The native addon is loaded by the utility process
 * only (`worker.ts` → `llama.ts`), which is the ADR's rule and the reason main's
 * event loop and main's memory are untouched by a 16 GB model.
 */

import type { ModelHost } from "@nexus/core";
import { createModelHostDeps } from "./electron.js";
import { createModelHost as build, type ModelHostDeps, type WorkerPort } from "./host.js";

export type { ModelHostDeps, WorkerPort };

export function createModelHost(deps: ModelHostDeps = createModelHostDeps()): ModelHost {
  return build(deps);
}
