import type { ImageInfo, ImageRefusalReason, ImageSource, ProcessedImage } from "./operations.js";
import type { ImagePlan } from "./plan.js";

/**
 * The image tool set's worker protocol: one job in, one reply per file plus the
 * final answer.
 *
 * The shape is the PDF tool set's (`../pdf/protocol.ts`) with the ops this tool
 * needs: images are a BATCH from the start — "many files at once" is the point
 * of the tool — so one job carries every file and the answer is one list.
 */

export type ImageJob =
  | { readonly id: number; readonly op: "inspect"; readonly files: readonly ImageSource[] }
  | {
      readonly id: number;
      readonly op: "process";
      readonly plan: ImagePlan;
      readonly files: readonly ImageSource[];
    };

export type ImageJobOp = ImageJob["op"];

export type ImageJobOf<Op extends ImageJobOp> = Extract<ImageJob, { op: Op }>;

export type ImageResultOf<Op extends ImageJobOp> = Op extends "inspect"
  ? readonly ImageInfo[]
  : readonly ProcessedImage[];

export type ImageReply =
  | { readonly id: number; readonly status: "progress"; readonly done: number; readonly total: number }
  | { readonly id: number; readonly status: "ok"; readonly value: unknown }
  | {
      readonly id: number;
      readonly status: "failed";
      readonly reason: ImageRefusalReason;
      readonly message: string;
    };

/** A job that failed, carrying why — the mirror of the PDF tool set's `PdfJobError`. */
export class ImageJobError extends Error {
  readonly reason: ImageRefusalReason;

  constructor(reason: ImageRefusalReason, message: string) {
    super(message);
    this.name = "ImageJobError";
    this.reason = reason;
  }
}
