import { readExifSummary, sniffMime, type ImageExifSummary } from "@nexus/core";
import { WORKSHOP_MAX_OUTPUT_BYTES } from "../../shared/workshopFiles.js";
import {
  needsReencode,
  outputMime,
  outputName,
  planSize,
  sourceFormat,
  targetFormat,
  type ImagePlan,
  type ImageSourceFormat,
} from "./plan.js";

/**
 * The image work: decode, resize, re-encode — on a canvas, in a worker.
 *
 * **What a canvas can and cannot do, stated once.** It decodes the three
 * formats Chromium decodes, it draws at any size, and it encodes PNG, JPEG and
 * WebP. It has no metadata channel at all: what goes in is pixels, so a
 * re-encoded file has no EXIF block, no GPS and no camera line. That is the
 * behaviour the page warns about BEFORE the button is pressed, and it is also
 * why `needsReencode` exists — a plan that changes nothing copies the file
 * instead, and a copy keeps every byte of its metadata.
 *
 * **Why the orientation has to be applied here.** JPEGs from phones are usually
 * stored sideways with an EXIF orientation tag telling the reader to turn them.
 * Since the tag is exactly what a re-encode loses, the decode asks for
 * `imageOrientation: "from-image"`, which bakes the turn into the pixels: the
 * output is upright on its own, which is what a user means by "resized". Without
 * it, every phone photo would come out rotated and the metadata that said so
 * would be gone.
 *
 * **Nothing here is testable in this repository, and that is why the arithmetic
 * is not here.** Node has no canvas, so `plan.ts` holds the size, the format,
 * the name and the re-encode question, and this file is the thin layer that
 * drives the API. What is left here is one draw and one encode per file.
 */

/** One image the tools hold: main's name for it, and its bytes. */
export interface ImageSource {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** What one picked file is, before anything is done to it. */
export interface ImageInfo {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly format: ImageSourceFormat;
  /** The metadata a re-encode would drop. */
  readonly exif: ImageExifSummary;
}

/** One file the tool wrote, and what it holds now. */
export interface ProcessedImage {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** `false` means the file was COPIED, because the plan asked for no change to it. */
  readonly reencoded: boolean;
}

/** Why an image could not be worked on. */
export type ImageRefusalReason = "unsupported" | "unreadable" | "too-large";

export class ImageRefusal extends Error {
  readonly reason: ImageRefusalReason;

  constructor(reason: ImageRefusalReason, message: string) {
    super(message);
    this.name = "ImageRefusal";
    this.reason = reason;
  }
}

/** How far along a batch is, in files. */
export type ImageProgress = (done: number, total: number) => void;

/**
 * The bytes as a `Blob` part, without copying them.
 *
 * The DOM's `BlobPart` asks for an `ArrayBufferView<ArrayBuffer>`, and a bare
 * `Uint8Array` in TypeScript 5.7 is `Uint8Array<ArrayBufferLike>` — a supertype
 * that also admits shared memory. These bytes came over Electron's IPC clone,
 * so the buffer is a plain `ArrayBuffer` and the shared case cannot arise; the
 * cast states what the DOM's types cannot see, and it is the only one here.
 */
function asBlobPart(bytes: Uint8Array): BlobPart {
  return bytes as unknown as BlobPart;
}

/** Decodes the bytes, or refuses them by reason. */
async function decode(bytes: Uint8Array): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(new Blob([asBlobPart(bytes)]), { imageOrientation: "from-image" });
  } catch (error) {
    throw new ImageRefusal(
      "unreadable",
      `This file could not be decoded as an image: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** What one file is, including the metadata a re-encode would drop. */
export async function readImageInfo(source: ImageSource): Promise<ImageInfo> {
  const format = sourceFormat(sniffMime(source.bytes));
  if (format === null) {
    throw new ImageRefusal("unsupported", "This is not a PNG, JPEG or WebP image.");
  }
  const bitmap = await decode(source.bytes);
  try {
    return {
      name: source.name,
      width: bitmap.width,
      height: bitmap.height,
      format,
      // Read from the ORIGINAL bytes, before any canvas exists: this is the
      // sentence the page prints about what is about to be lost.
      exif: readExifSummary(source.bytes),
    };
  } finally {
    bitmap.close();
  }
}

/** Draws `bitmap` at the target size and encodes it, in the chosen format and quality. */
async function encode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  mime: string,
  quality: number,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new ImageRefusal("unreadable", "This machine's canvas has no 2D context.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  // `quality` is 0..1 to the encoder, and 1..100 in the plan: the single
  // conversion between the two units is this line.
  const blob = await canvas.convertToBlob({ type: mime, quality: quality / 100 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new ImageRefusal("unreadable", "The encoder produced an empty file.");
  }
  if (bytes.byteLength > WORKSHOP_MAX_OUTPUT_BYTES) {
    throw new ImageRefusal("too-large", "The result is larger than this tool will write.");
  }
  return bytes;
}

/**
 * One file through the plan: copied when nothing about it has to change, and
 * otherwise decoded, drawn at the target size and encoded.
 */
export async function processImage(source: ImageSource, plan: ImagePlan): Promise<ProcessedImage> {
  const info = await readImageInfo(source);
  const size = { width: info.width, height: info.height };
  const target = targetFormat(plan, info.format);
  if (!needsReencode(plan, size, info.format)) {
    // The copy is not an optimisation: it is the only path that keeps the file's
    // metadata, and the page says so before the user presses the button.
    return { name: source.name, bytes: source.bytes, width: size.width, height: size.height, reencoded: false };
  }

  const next = planSize(size, plan.resize);
  const bitmap = await decode(source.bytes);
  try {
    return {
      name: outputName(source.name, target),
      bytes: await encode(bitmap, next.width, next.height, outputMime(target), plan.quality),
      width: next.width,
      height: next.height,
      reencoded: true,
    };
  } finally {
    bitmap.close();
  }
}
