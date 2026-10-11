import {
  arrangePages,
  mergePdfs,
  PdfRefusal,
  readPdfInfo,
  rotatePdfPages,
  splitPdf,
  stampPageNumbers,
} from "./operations.js";
import type { PdfJob, PdfReply } from "./protocol.js";

/**
 * The PDF tool set's Web Worker: one job in, a reply out, and nothing else.
 *
 * **Why the worker holds no state.** It answers jobs and forgets them. The page
 * owns the picked files, the working document and the undo-less history of what
 * the user did, because that is what a React component can render; a worker that
 * kept a copy would be a second source of truth for the same bytes, and the two
 * would disagree the first time a job failed halfway.
 *
 * **Why the reply carries `unknown` and the client narrows it.** A worker
 * message is structured-cloned data, so the type can only be re-asserted at the
 * boundary; `workerClient.ts` is that boundary, and it is the one place that
 * says which op produced which value. Spreading that cast across the page would
 * be the same lie told in five places.
 */

/** The two things a worker can do with the page. Declared because `self` under the DOM lib is a `Window`. */
interface PdfWorkerScope {
  postMessage(message: PdfReply): void;
  onmessage: ((event: MessageEvent<PdfJob>) => void) | null;
}

const scope = self as unknown as PdfWorkerScope;

/** Posts one reply. The worker's only way out. */
function reply(message: PdfReply): void {
  scope.postMessage(message);
}

async function handle(job: PdfJob): Promise<void> {
  const progress = (done: number, total: number): void => {
    reply({ id: job.id, status: "progress", done, total });
  };
  try {
    switch (job.op) {
      case "inspect":
        reply({ id: job.id, status: "ok", value: await readPdfInfo(job.source) });
        return;
      case "merge":
        reply({ id: job.id, status: "ok", value: await mergePdfs(job.sources, progress) });
        return;
      case "arrange":
        reply({
          id: job.id,
          status: "ok",
          value: await arrangePages(job.source, job.order, progress),
        });
        return;
      case "rotate":
        reply({
          id: job.id,
          status: "ok",
          value: await rotatePdfPages(job.source, job.turns, progress),
        });
        return;
      case "number":
        reply({
          id: job.id,
          status: "ok",
          value: await stampPageNumbers(job.source, job.format, job.position, progress),
        });
        return;
      case "split":
        reply({ id: job.id, status: "ok", value: await splitPdf(job.source, job.parts, progress) });
        return;
    }
  } catch (error) {
    reply({
      id: job.id,
      status: "failed",
      reason: error instanceof PdfRefusal ? error.reason : "unreadable",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

scope.onmessage = (event) => {
  void handle(event.data);
};
