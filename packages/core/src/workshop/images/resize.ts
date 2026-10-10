/**
 * The arithmetic behind the image tools' two resize modes: by percent, and into
 * a box that keeps the aspect ratio.
 *
 * **Why the maths is not in the worker that uses it.** The worker draws with a
 * canvas, and no test in this repository can construct one — but "what size does
 * a 1001×500 picture become at 50%?" has one right answer, and it is not a
 * question about canvases. Every function here is pure, so the answer is pinned
 * by a test rather than by looking at a page.
 *
 * **Whole pixels, rounded, never zero.** A canvas is sized in whole pixels and
 * a zero-sized canvas throws, so a rounding that lands on zero would turn a
 * legal 1%-of-a-tiny-image request into an exception in the middle of a batch.
 * Every result is therefore at least 1×1. The cost is stated where it can be
 * seen: a 1×1000 picture at 50% keeps a width of one pixel while its height
 * halves, so rounding can move the aspect ratio by a pixel on an edge this
 * thin — which is the honest outcome of asking for a fraction of a pixel.
 */

/** A width and a height, in pixels. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** The smallest and largest percentage the percent mode accepts. */
export const RESIZE_PERCENT_MIN = 1;
export const RESIZE_PERCENT_MAX = 400;

/**
 * The bounds on a box side, in pixels.
 *
 * 20 000 is above every camera this app will meet and below the size at which a
 * single canvas would be an out-of-memory rather than a resize; the lower bound
 * is one pixel, because that is the smallest image there is.
 */
export const RESIZE_BOX_MIN_PX = 1;
export const RESIZE_BOX_MAX_PX = 20_000;

/**
 * A whole number typed into a field, or `null` when the text is not one.
 *
 * Whole numbers only, in both modes: a percentage with a decimal point is a
 * request whose extra precision no encoder can honour anyway (the result is
 * rounded to a pixel), and a box side is a pixel count. Refusing beats silently
 * truncating `12.9` to `12`, which is a size the user did not ask for and
 * cannot see.
 */
export function parseScaleNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < min || value > max) return null;
  return value;
}

/** One side of a result: the scaled value rounded to whole pixels, and never below one. */
function pixel(value: number): number {
  return Math.max(1, Math.round(value));
}

/** The size at `percent` of the original, each side rounded to whole pixels. */
export function scaleByPercent(size: ImageSize, percent: number): ImageSize {
  const factor = percent / 100;
  return { width: pixel(size.width * factor), height: pixel(size.height * factor) };
}

/**
 * The largest size with the original's aspect ratio that fits inside `box`.
 *
 * **It never enlarges.** A picture smaller than the box comes back untouched:
 * the mode's promise is "make this fit", and upscaling a small file to fill a
 * big box adds pixels that were never in the picture while calling the result a
 * resize. A user who wants it bigger has the percent mode, where the intent is
 * explicit and the number is their own.
 *
 * The scale is applied to both sides and each side is then rounded
 * independently, so a result can be a pixel off the source's exact ratio — the
 * same statement `pixel` makes above, and the reason this returns a size rather
 * than a factor.
 */
export function fitWithinBox(size: ImageSize, box: ImageSize): ImageSize {
  if (size.width < 1 || size.height < 1) {
    throw new RangeError("An image has a positive whole number of pixels on both sides.");
  }
  const scale = Math.min(box.width / size.width, box.height / size.height, 1);
  return { width: pixel(size.width * scale), height: pixel(size.height * scale) };
}
