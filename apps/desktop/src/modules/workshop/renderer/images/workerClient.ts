import { ImageJobError, type ImageJobOf, type ImageJobOp, type ImageReply, type ImageResultOf } from "./protocol.js";

/**
 * The image tool set's worker client: jobs in, promises out.
 *
 * **Why this is not the PDF tool set's client.** The two are the same forty lines
 * of plumbing — an id, a map of pending promises, progress passthrough, dispose —
 * but their job unions are different types, and a shared client would have to
 * live outside both tool folders: this one is copied into the module's page as
 * its own subtree, and a dependency between the two tool sets is exactly what
 * "the maintainer wires them in" must not have. The logic with a rule in it (what
 * a reply settles going wrong) is tested once, in `../pdf/workerClient.test.ts`.
 */

/** The smallest part of a `Worker` this client uses. */
export interface ImageWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

/** A job without its id or its op name, both of which the runner adds (see `../pdf/workerClient.ts`). */
export type ImageJobRequest<Op extends ImageJobOp> = Omit<ImageJobOf<Op>, "id" | "op">;

export interface ImageJobRunner {
  run<Op extends ImageJobOp>(
    op: Op,
    job: ImageJobRequest<Op>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ImageResultOf<Op>>;
  dispose(): void;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress: ((done: number, total: number) => void) | undefined;
}

export function createImageWorker(spawn: () => ImageWorkerLike): ImageJobRunner {
  let worker: ImageWorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function ensure(): ImageWorkerLike {
    if (worker !== null) return worker;
    const created = spawn();
    created.addEventListener("message", (event) => {
      const reply = event.data as ImageReply;
      const entry = pending.get(reply.id);
      if (entry === undefined) return;
      if (reply.status === "progress") {
        entry.onProgress?.(reply.done, reply.total);
        return;
      }
      pending.delete(reply.id);
      if (reply.status === "ok") entry.resolve(reply.value);
      else entry.reject(new ImageJobError(reply.reason, reply.message));
    });
    worker = created;
    return created;
  }

  return {
    run<Op extends ImageJobOp>(
      op: Op,
      job: ImageJobRequest<Op>,
      onProgress?: (done: number, total: number) => void,
    ): Promise<ImageResultOf<Op>> {
      return new Promise<ImageResultOf<Op>>((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve: (value) => resolve(value as ImageResultOf<Op>), reject, onProgress });
        ensure().postMessage({ ...job, op, id });
      });
    },
    dispose(): void {
      worker?.terminate();
      worker = null;
      const outstanding = [...pending.values()];
      pending.clear();
      for (const entry of outstanding) {
        entry.reject(new ImageJobError("unreadable", "The worker was terminated."));
      }
    },
  };
}

/** The real spawn, over the worker Vite bundles from `worker.ts`. */
export function spawnImageWorker(): ImageWorkerLike {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}
