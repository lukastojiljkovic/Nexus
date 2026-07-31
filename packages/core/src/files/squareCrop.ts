/**
 * The geometry behind a profile picture (SET-001): the largest centred square
 * inside an image, and the edge every stored picture is resized to.
 *
 * Pure and platform-neutral, and deliberately here rather than beside the
 * decoder that uses it: the decode/crop/resize/re-encode pipeline runs on
 * Electron's `nativeImage` in the main process (`main/profilePicture.ts`), which
 * no test in this repo can construct — while the one piece of that pipeline with
 * a right and a wrong answer is this rectangle, which needs nothing but two
 * numbers. Keeping it separable is what makes it testable at all.
 */

/**
 * The edge, in pixels, every stored profile picture is resized to. 512 rather
 * than the ~64px the UI actually draws: the avatar is rendered at several sizes
 * and on displays with a device pixel ratio of 2 or 3, and a picture stored at
 * its smallest use would be visibly soft at every other one. 512² of PNG is tens
 * of kilobytes — the ceiling this trades against is the 10 MiB the PICK accepts,
 * not what is kept.
 */
export const PROFILE_PICTURE_SIZE = 512;

/** A crop rectangle in source-image pixels — structurally Electron's `Rectangle`, declared here so this module imports nothing. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The largest centred square inside a `width`×`height` image.
 *
 * The overhang is split evenly and the offset FLOORED, so an odd remainder
 * gives the extra pixel to the right/bottom rather than putting the origin
 * between two pixels — a fractional rectangle is not something any decoder can
 * crop to. An already-square image comes back whole.
 *
 * Throws on anything that is not a positive whole number of pixels: those are
 * the dimensions a decoded image cannot have, so reaching this with one means
 * the decode above it went wrong and a silently-clamped rectangle would hide it.
 */
export function centerSquareCrop(width: number, height: number): CropRect {
  assertPixels(width, "width");
  assertPixels(height, "height");
  const edge = Math.min(width, height);
  return {
    x: Math.floor((width - edge) / 2),
    y: Math.floor((height - edge) / 2),
    width: edge,
    height: edge,
  };
}

function assertPixels(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`"${field}" must be a positive whole number of pixels.`);
  }
}
