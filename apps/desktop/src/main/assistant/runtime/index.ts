/**
 * `createModelHost` — the assistant's model runtime, as the module will call it.
 *
 * This builds the app's own wiring, which is the one thing here that imports
 * Electron (`electron.ts`); a test builds `host.ts`'s factory with fake
 * dependencies instead:
 *
 *   const host = createModelHost(launchMode);        // the app, with the real worker
 *   const host = build(testDeps);                     // a test, with a fake one
 *
 * WHAT IS NOT HERE, deliberately: nothing in this file, `host.ts`, `install.ts`,
 * `huggingface.ts`, `recommend.ts`, `catalogue.ts`, `gguf.ts` or `protocol.ts`
 * imports `node-llama-cpp`. The native addon is loaded by the utility process
 * only (`worker.ts` → `llama.ts`), which is the ADR's rule and the reason main's
 * event loop and main's memory are untouched by a 16 GB model.
 */

import type { ModelHost } from "@nexus/core";

import type { NetworkMode } from "../../net/offline.js";
import { createModelHostDeps } from "./electron.js";
import { createModelHost as build, type ModelHostDeps, type WorkerPort } from "./host.js";

export type { ModelHostDeps, WorkerPort };

/** The app's model host, for a launch that came up under `launchMode`. */
export function createModelHost(launchMode: NetworkMode): ModelHost {
  return build(createModelHostDeps(launchMode));
}
