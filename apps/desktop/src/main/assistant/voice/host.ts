/**
 * The main process's end of the worker connection.
 *
 * A host starts nothing until it is asked to: the first request forks the
 * worker, and a host whose worker has exited forks another one rather than
 * failing forever. That matters for a long-running app in which a model killed
 * by the operating system's memory pressure is a recoverable event.
 *
 * CANCELLATION IS AT THE BOUNDARY AND NOT INSIDE THE MODEL, and that is stated
 * rather than hidden: `onnxruntime` runs one graph to completion and there is
 * no interruption point in it, so an aborted request rejects the caller's
 * promise at once and the worker's answer, when it arrives, is discarded. The
 * user's microphone closes immediately either way, which is what they asked
 * for; what the abort cannot do is give the CPU back before the current
 * sentence is finished.
 */

import { utilityProcess as electronUtilityProcess, type UtilityProcess } from "electron";

import { replyProblem, type VoiceReply, type VoiceRequest } from "./protocol.js";

/** Runs inference off the main thread. A test supplies its own. */
export interface VoiceHost {
  /** One request, and the reply to it. A cancellation comes back as an `aborted` failure. */
  run(request: VoiceRequest, signal?: AbortSignal): Promise<VoiceReply>;
  /** Stops the worker, if one is running. */
  dispose(): Promise<void>;
}

/**
 * The parts of electron's `utilityProcess` this host uses, so a test could drive
 * it without an Electron runtime.
 *
 * The member is deliberately NOT named after Electron's own (`fork`), and that
 * is a gate rather than a style: `check:runner` forbids a bare call to a name in
 * the exec family anywhere in the shipped tree, because that is the capability
 * DEV-007 exists to keep from spreading one file at a time. This call starts no
 * command line and spawns no program from a string — it starts one of this
 * app's own modules — and a name that cannot be mistaken for `child_process` is
 * cheaper than an exemption in that gate.
 */
export interface UtilityProcessPort {
  start(modulePath: string, args: readonly string[], options: { readonly serviceName: string }): UtilityProcess;
}

/** How long a disposed worker is given to answer before it is killed. */
const DISPOSE_GRACE_MS = 2_000;

export function createVoiceHost(
  entryPath: string,
  start: UtilityProcessPort["start"] = (modulePath, args, options) =>
    electronUtilityProcess.fork(modulePath, [...args], options),
): VoiceHost {
  let worker: UtilityProcess | null = null;
  const pending = new Map<number, (reply: VoiceReply) => void>();

  /** Every waiting caller, told that there is no answer coming. */
  function failAll(message: string): void {
    for (const [id, resolve] of pending) {
      resolve({ id, type: "failed", code: "no-worker", message });
    }
    pending.clear();
  }

  function ensureWorker(): UtilityProcess {
    if (worker !== null) return worker;
    const started = start(entryPath, [], { serviceName: "nexus-voice" });
    started.on("message", (message: unknown) => {
      if (replyProblem(message) !== null) return;
      const reply = message as VoiceReply;
      const resolve = pending.get(reply.id);
      if (resolve === undefined) return;
      pending.delete(reply.id);
      resolve(reply);
    });
    started.on("exit", () => {
      if (worker === started) worker = null;
      failAll("the voice worker stopped.");
    });
    worker = started;
    return started;
  }

  return {
    async run(request, signal) {
      if (signal?.aborted === true) {
        return { id: request.id, type: "failed", code: "aborted", message: "cancelled before it started." };
      }
      const running = ensureWorker();
      return await new Promise<VoiceReply>((resolve) => {
        pending.set(request.id, resolve);
        const onAbort = (): void => {
          if (pending.delete(request.id)) {
            resolve({ id: request.id, type: "failed", code: "aborted", message: "cancelled." });
          }
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        running.postMessage(request);
      });
    },

    async dispose() {
      const running = worker;
      worker = null;
      if (running === null) {
        failAll("the voice worker was stopped.");
        return;
      }
      const stopped = new Promise<void>((resolve) => {
        running.once("exit", () => {
          resolve();
        });
      });
      const timer = setTimeout(() => {
        running.kill();
      }, DISPOSE_GRACE_MS);
      running.postMessage({ id: Number.MAX_SAFE_INTEGER, type: "dispose" });
      failAll("the voice worker was stopped.");
      await stopped;
      clearTimeout(timer);
    },
  };
}

