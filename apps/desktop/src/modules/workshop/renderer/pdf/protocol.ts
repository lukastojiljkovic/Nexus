import type { PageNumberFormat, PageNumberPosition } from "@nexus/core";
import type { PdfDocumentInfo, PdfOutput, PdfRefusalReason, PdfSource } from "./operations.js";

/**
 * What crosses the boundary between the page and its Web Worker: one job in, one
 * reply per progress step and one reply at the end.
 *
 * **Why the work is in a worker at all.** Merging twenty files, copying five
 * hundred pages or re-encoding a document with pdf-lib is CPU work measured in
 * seconds, and on the renderer's own thread it would be a frozen window — no
 * progress, no cancel, no typing. So the page owns the state and the worker owns
 * the bytes, and the two agree on this file.
 *
 * **Why the reply is a union and not a callback.** A worker can only post
 * messages; a promise-based client (`workerClient.ts`) is what turns them back
 * into `await`. The `id` is what pairs a reply with its job, because jobs are
 * started from event handlers and can therefore overlap.
 */

/** One unit of work, with the id its answers carry back. */
export type PdfJob =
  | { readonly id: number; readonly op: "inspect"; readonly source: PdfSource }
  | { readonly id: number; readonly op: "merge"; readonly sources: readonly PdfSource[] }
  | {
      readonly id: number;
      readonly op: "arrange";
      readonly source: PdfSource;
      readonly order: readonly number[];
    }
  | {
      readonly id: number;
      readonly op: "rotate";
      readonly source: PdfSource;
      readonly turns: readonly number[];
    }
  | {
      readonly id: number;
      readonly op: "number";
      readonly source: PdfSource;
      readonly format: PageNumberFormat;
      readonly position: PageNumberPosition;
    }
  | {
      readonly id: number;
      readonly op: "split";
      readonly source: PdfSource;
      readonly parts: readonly (readonly number[])[];
    };

/** The job names, for the client's own dispatch. */
export type PdfJobOp = PdfJob["op"];

/** The job whose `op` is `Op`, so a caller's payload is the one that op takes. */
export type PdfJobOf<Op extends PdfJobOp> = Extract<PdfJob, { op: Op }>;

/**
 * What one op answers — derived from the op's name rather than restated at each
 * call site, so the page cannot await a page count from a merge.
 */
export type PdfResultOf<Op extends PdfJobOp> = Op extends "inspect"
  ? PdfDocumentInfo
  : Op extends "split"
    ? readonly PdfOutput[]
    : Uint8Array;

/** One message from the worker. `progress` arrives zero or more times before an `ok` or a `failed`. */
export type PdfReply =
  | { readonly id: number; readonly status: "progress"; readonly done: number; readonly total: number }
  | { readonly id: number; readonly status: "ok"; readonly value: unknown }
  | {
      readonly id: number;
      readonly status: "failed";
      readonly reason: PdfRefusalReason;
      readonly message: string;
    };

/**
 * A job that failed, carrying WHY.
 *
 * Declared here rather than reusing `PdfRefusal` from `operations.ts`, because
 * that class lives beside pdf-lib: a page importing it would pull the whole
 * library into the page's chunk, which is precisely what the worker exists to
 * avoid. The worker — which does have pdf-lib — throws `PdfRefusal`; the client
 * — which does not — rebuilds the reason from the reply's own field.
 */
export class PdfJobError extends Error {
  readonly reason: PdfRefusalReason;

  constructor(reason: PdfRefusalReason, message: string) {
    super(message);
    this.name = "PdfJobError";
    this.reason = reason;
  }
}
