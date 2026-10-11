import { PdfJobError, type PdfJobOf, type PdfJobOp, type PdfReply, type PdfResultOf } from "./protocol.js";

/**
 * The page's side of the worker: jobs in, promises out.
 *
 * **One worker per tool set, created when the first job runs.** A worker is a
 * whole second JavaScript realm, and this module's page is loaded lazily, so a
 * tool nobody touches must not pay for one at all. It is kept after the first
 * job because the second job — a rotate after a merge — should reuse the realm
 * the first one warmed up.
 *
 * **The client assigns the ids**, which is what makes overlapping jobs safe: the
 * page starts a job from an event handler, so two can be in flight, and the id
 * on a reply is the only thing that says which promise it settles.
 *
 * **Failed jobs reject, and there is no cancel.** The jobs are seconds long, the
 * page disables its controls while one runs, and a cancel that left a
 * half-copied document in the worker would be a second state to reason about for
 * a button nobody asked for. `dispose` rejects whatever is outstanding, so a
 * page that goes away cannot leave an unresolved promise behind.
 *
 * **The one cast in the tool set lives here.** A worker's reply is
 * structured-cloned data, so `value` arrives as `unknown`; `PdfResultOf<Op>`
 * says what the op that was just sent produces, and this function is the only
 * place that statement is made.
 */

/** The smallest part of a `Worker` this client uses, so a test can hand it a fake. */
export interface PdfWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

/**
 * A job without its id or its op name, both of which the runner adds.
 *
 * The op name is not part of the payload the caller passes: it is `run`'s own
 * first argument, so TypeScript can infer WHICH payload this call takes —
 * inference through `Extract<…, { op: Op }>` cannot recover `Op` from an object
 * literal, so `run({ op: "inspect", … })` widened to the whole union and every
 * call site would have needed a cast.
 */
export type PdfJobRequest<Op extends PdfJobOp> = Omit<PdfJobOf<Op>, "id" | "op">;

export interface PdfJobRunner {
  run<Op extends PdfJobOp>(
    op: Op,
    job: PdfJobRequest<Op>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<PdfResultOf<Op>>;
  /** Terminates the worker and rejects whatever it still owed. */
  dispose(): void;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress: ((done: number, total: number) => void) | undefined;
}

export function createPdfWorker(spawn: () => PdfWorkerLike): PdfJobRunner {
  let worker: PdfWorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function ensure(): PdfWorkerLike {
    if (worker !== null) return worker;
    const created = spawn();
    created.addEventListener("message", (event) => {
      const reply = event.data as PdfReply;
      const entry = pending.get(reply.id);
      if (entry === undefined) return;
      if (reply.status === "progress") {
        entry.onProgress?.(reply.done, reply.total);
        return;
      }
      pending.delete(reply.id);
      if (reply.status === "ok") entry.resolve(reply.value);
      else entry.reject(new PdfJobError(reply.reason, reply.message));
    });
    worker = created;
    return created;
  }

  return {
    run<Op extends PdfJobOp>(
      op: Op,
      job: PdfJobRequest<Op>,
      onProgress?: (done: number, total: number) => void,
    ): Promise<PdfResultOf<Op>> {
      return new Promise<PdfResultOf<Op>>((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve: (value) => resolve(value as PdfResultOf<Op>), reject, onProgress });
        ensure().postMessage({ ...job, op, id });
      });
    },
    dispose(): void {
      worker?.terminate();
      worker = null;
      const outstanding = [...pending.values()];
      pending.clear();
      for (const entry of outstanding) {
        entry.reject(new PdfJobError("unreadable", "The worker was terminated."));
      }
    },
  };
}

/**
 * The real spawn: Vite's worker constructor, which bundles `worker.ts` — and
 * pdf-lib with it — into a chunk of its own. `new URL(…, import.meta.url)` is
 * the form electron-vite resolves at build time; a string path would be a 404 in
 * the packaged app, where the renderer loads over `file://`.
 */
export function spawnPdfWorker(): PdfWorkerLike {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}
