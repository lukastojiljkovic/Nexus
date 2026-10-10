import { ImageRefusal, processImage, readImageInfo } from "./operations.js";
import type { ImageJob, ImageReply } from "./protocol.js";

/**
 * The image tool set's Web Worker: the batch runs here, one file at a time, and
 * the page stays responsive while it does.
 *
 * Decoding and re-encoding a photo is tens of milliseconds; a batch of twenty of
 * them is long enough that doing it on the renderer's thread would be a frozen
 * window, which is the whole reason this file exists. Progress is counted in
 * FILES, because that is the unit the user picked them in.
 */

/** The two things a worker can do with the page. Declared because `self` under the DOM lib is a `Window`. */
interface ImageWorkerScope {
  postMessage(message: ImageReply): void;
  onmessage: ((event: MessageEvent<ImageJob>) => void) | null;
}

const scope = self as unknown as ImageWorkerScope;

async function handle(job: ImageJob): Promise<void> {
  const progress = (done: number, total: number): void => {
    scope.postMessage({ id: job.id, status: "progress", done, total });
  };
  try {
    if (job.op === "inspect") {
      const infos = [];
      for (const file of job.files) {
        infos.push(await readImageInfo(file));
        progress(infos.length, job.files.length);
      }
      scope.postMessage({ id: job.id, status: "ok", value: infos });
      return;
    }
    const processed = [];
    for (const file of job.files) {
      processed.push(await processImage(file, job.plan));
      progress(processed.length, job.files.length);
    }
    scope.postMessage({ id: job.id, status: "ok", value: processed });
  } catch (error) {
    scope.postMessage({
      id: job.id,
      status: "failed",
      reason: error instanceof ImageRefusal ? error.reason : "unreadable",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

scope.onmessage = (event) => {
  void handle(event.data);
};
