import { cloneImage, type RgbaImage } from "./imageOps.js";

/**
 * The small amount of canvas glue the scanner needs: a source picture into
 * pixels, pixels back onto a canvas.
 *
 * Deliberately thin, and deliberately not where the arithmetic is: everything
 * that decides a pixel's value is in `imageOps.ts`, which is pure and tested
 * there. What is here cannot be (there is no DOM in this repository's test
 * environment) and is therefore as small as it can be made.
 */

/**
 * The longest side a picture is scaled to before recognition.
 *
 * A CHOICE, not a measurement, and written down so it can be changed on
 * evidence: a phone frame is 4000 pixels wide, which is 48 MB of RGBA in the
 * renderer and several times that inside the engine's own buffers, for
 * characters a 2000-pixel-wide page already resolves at about 240 dpi (A4 is
 * 210 mm wide). Everything the scanner is for - a receipt, a page, a label, a
 * sign - fits under this, so a picture is scaled only when the alternative is
 * memory spent on pixels the engine cannot use.
 */
export const MAX_SCAN_SIDE = 2000;

/** A source picture drawn into a fresh canvas, scaled to fit `maxSide`. */
export function canvasFromSource(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxSide: number = MAX_SCAN_SIDE,
): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Nexus: this machine has no 2D canvas context.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A canvas's pixels, in the shape `ImageData` has. */
export function pixelsFromCanvas(canvas: HTMLCanvasElement): RgbaImage {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Nexus: this machine has no 2D canvas context.");
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: data.width, height: data.height, data: data.data };
}

/** Draws a bitmap onto a canvas of exactly its size - what the engine and the page's own preview both take. */
export function canvasFromPixels(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Nexus: this machine has no 2D canvas context.");
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  return canvas;
}

/** A picked or pasted file into pixels, scaled by `MAX_SCAN_SIDE`. The bitmap is released even when the draw throws. */
export async function pixelsFromBlob(blob: Blob): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    return cloneImage(pixelsFromCanvas(canvasFromSource(bitmap, bitmap.width, bitmap.height)));
  } finally {
    bitmap.close();
  }
}
