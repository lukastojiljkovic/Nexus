import { AnalysisEngine, type AnalysisJob, type AnalysisReply } from "./analysis.js";

/**
 * Where the analysis runs: a worker when this window will give us one, and this
 * thread when it will not.
 *
 * **Why there is a fallback at all.** A dedicated worker's script is fetched
 * same-origin, and a packaged Nexus renderer is a `file://` page — the same
 * assumption `ADR-079` records as unproven for the canvas engine, which is why
 * that one ships a caught fallback too. The alternative to a fallback is a page
 * whose tuner silently never shows a pitch, which is a worse failure than a
 * page that says it is working harder than it wanted to: the frame is small, the
 * job is one function, and `onMainThread` is what lets the page SAY so instead of
 * hiding it.
 *
 * The engine instance is per ANALYZER, whichever side it runs on, so the meter's
 * equivalent-level window accumulates identically in both worlds.
 */

export interface Analyzer {
  /** Runs one job and answers its reading. */
  analyse(job: AnalysisJobWithoutId): Promise<AnalysisReply>;
  /** True once the worker could not be used and the readings come from this thread. */
  readonly onMainThread: boolean;
  /** Ends the worker, if there was one. Called when the page unmounts. */
  dispose(): void;
}

/** A job without its id: the caller does not name requests, the analyzer does. */
export type AnalysisJobWithoutId =
  | Omit<Extract<AnalysisJob, { kind: "tuner" }>, "id">
  | Omit<Extract<AnalysisJob, { kind: "meter" }>, "id">;

/**
 * One job with its id attached, field by field rather than by spreading the
 * union: a spread of a union in TypeScript widens to one object whose `kind`
 * keeps every branch's fields optional, and that shape is exactly what the
 * engine's discriminated union refuses. Naming the fields keeps the two branches
 * checked against the job type the worker reads.
 */
function withId(job: AnalysisJobWithoutId, id: number): AnalysisJob {
  return job.kind === "tuner"
    ? { kind: "tuner", id, sampleRate: job.sampleRate, a4Hz: job.a4Hz, samples: job.samples }
    : { kind: "meter", id, samples: job.samples, fresh: job.fresh };
}

/** The path the worker module has to be built for. A static literal, because that is what the bundler rewrites. */
const WORKER_URL = new URL("./analysis.worker.ts", import.meta.url);

export function createAnalyzer(): Analyzer {
  const engine = new AnalysisEngine();
  let worker: Worker | null = null;
  try {
    worker = new Worker(WORKER_URL, { type: "module" });
  } catch (error) {
    // A window that refuses `file://` workers throws here, synchronously, before
    // any request exists — so this is a decision about how the page works, not a
    // recovery in the middle of one.
    console.warn("Nexus: the Signals analysis worker could not be started; reading on the main thread.", error);
  }

  let inline = worker === null;
  let nextId = 0;
  /** Requests in flight, so a worker that dies can still settle them. */
  const pending = new Map<number, { job: AnalysisJobWithoutId; resolve: (reply: AnalysisReply) => void }>();

  /** Gives up on the worker, answers everything already in flight from this thread, and stays here. */
  function degrade(): void {
    if (inline) return;
    inline = true;
    worker?.terminate();
    worker = null;
    // The frame that was in flight when the worker died is EMPTY by now — it was
    // transferred, and a transferred buffer is detached — so the inline answer for
    // it is „no pitch" rather than a reading. That costs one frame: the page reads
    // a fresh window on its next tick (`readFrame` allocates one per read), and the
    // alternative — leaving the promise unsettled — would hang the page's own
    // pacing, which is the one thing the fallback exists to avoid.
    for (const [id, request] of pending) request.resolve(engine.run(withId(request.job, id)));
    pending.clear();
  }

  worker?.addEventListener("message", (event: MessageEvent<AnalysisReply>) => {
    const reply = event.data;
    const request = pending.get(reply.id);
    if (request === undefined) return;
    pending.delete(reply.id);
    request.resolve(reply);
  });
  // An `error` event is a script that did not load or threw at the top: either
  // way this window will not be answering, and every later job goes inline.
  worker?.addEventListener("error", () => degrade());

  return {
    analyse(job: AnalysisJobWithoutId): Promise<AnalysisReply> {
      const id = (nextId += 1);
      if (inline || worker === null) {
        return Promise.resolve(engine.run(withId(job, id)));
      }
      return new Promise<AnalysisReply>((resolve) => {
        pending.set(id, { job, resolve });
        // The frame is TRANSFERRED rather than copied: the page allocated it for
        // this read and will not look at it again, which is what keeps a 16 KB
        // buffer per tenth of a second off both heaps.
        const message = withId(job, id);
        worker?.postMessage(message, [message.samples.buffer as ArrayBuffer]);
      });
    },
    get onMainThread(): boolean {
      return inline;
    },
    dispose(): void {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
