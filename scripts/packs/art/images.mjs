// The image pipeline: one download in, a 2048 px WebP and a 400 px thumbnail
// out, with the metadata gone and the size measured rather than assumed.
//
// WHY THE QUALITY IS MEASURED AND NOT CHOSEN. A fixed quality is a number
// somebody guessed once; the pack is 300 photographs from four encoders and
// three scanner generations, and "80 looks fine" is a statement about the
// pictures that were looked at. So the build encodes a SAMPLE of the works it is
// about to ship at several qualities, decodes each result, and computes its PSNR
// against a lossless PNG of the same 2048 px image — the encoder's own error,
// with the resampling excluded. The quality that ships is the lowest one whose
// mean PSNR clears 40 dB (`MIN_PSNR_DB`), which is the conventional line for
// "the difference is not visible at a viewing distance"; the table the build
// prints is the receipt, and `docs/packs/art.md` quotes it.
//
// WHY PSNR AND NOT SSIM. sharp computes neither, and PSNR is four lines of
// arithmetic over two byte arrays that this repository can own, read and test
// with hand-calculated values, where SSIM would be a second dependency in a
// builder that is allowed one image library and nothing else. PSNR is what the
// WebP encoder's own documentation quotes for exactly this decision.
//
// METADATA. sharp drops EXIF, IPTC, XMP and the ICC profile unless it is asked
// to keep them (`withMetadata()`), and this pipeline never asks. The test
// asserts it on the output rather than trusting the default, because a
// `withMetadata()` added later for a reason that has since been forgotten is
// invisible in a screenshot.

import sharp from "sharp";

/** The longest side of a shipped image, per the pack's brief. */
export const MAX_SIDE = 2048;

/** The longest side of the thumbnail beside it. */
export const THUMB_SIDE = 400;

/** The candidate qualities the measurement walks, in ascending order. */
export const QUALITY_CANDIDATES = [70, 75, 80, 85, 90];

/**
 * The mean PSNR a candidate must clear to ship. 40 dB on 8-bit sRGB is the
 * figure the literature uses for "visually lossless"; it is a RULE this build
 * states and measures against, not a measurement of these particular images.
 */
export const MIN_PSNR_DB = 40;

/**
 * Peak signal-to-noise ratio, in dB, between two equally sized byte arrays.
 *
 * `10 · log10(255² / MSE)`, with `MSE` the mean of the squared differences. The
 * inputs are the RAW pixels of two encodings of the same image, so the whole of
 * the difference being measured is the encoder's.
 */
export function psnr(reference, test) {
  if (reference.length !== test.length) {
    throw new Error(`psnr: ${String(reference.length)} and ${String(test.length)} bytes are not the same image.`);
  }
  if (reference.length === 0) return Number.POSITIVE_INFINITY;
  let squared = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const difference = reference[index] - test[index];
    squared += difference * difference;
  }
  const mse = squared / reference.length;
  return mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / mse);
}

/** `{ data, width, height }` of a buffer decoded to raw RGBA, for comparison. */
async function rawPixels(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * The quality the pack ships, with the table that produced the answer.
 *
 * `samples` are source images, already downloaded. Each is resized to the
 * shipped geometry once, encoded at every candidate, and compared with the
 * lossless PNG of that same geometry. The answer is the lowest candidate whose
 * MEAN PSNR clears {@link MIN_PSNR_DB}; if none does — which would mean the
 * candidates are all too harsh for the material — the highest candidate is used
 * and the table says so.
 */
export async function measureQuality(samples, candidates = QUALITY_CANDIDATES) {
  const table = candidates.map((quality) => ({ quality, bytes: 0, psnrSum: 0, count: 0 }));
  for (const sample of samples) {
    const base = await sharp(sample)
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const reference = await rawPixels(base);
    for (const row of table) {
      const encoded = await sharp(base).webp({ quality: row.quality }).toBuffer();
      const decoded = await rawPixels(encoded);
      row.bytes += encoded.byteLength;
      row.psnrSum += psnr(reference.data, decoded.data);
      row.count += 1;
    }
  }
  const measured = table.map((row) => ({
    quality: row.quality,
    meanBytes: Math.round(row.bytes / row.count),
    meanPsnrDb: row.psnrSum / row.count,
  }));
  const chosen = measured.find((row) => row.meanPsnrDb >= MIN_PSNR_DB) ?? measured[measured.length - 1];
  return { quality: chosen.quality, table: measured };
}

/**
 * One source image, encoded twice: the shipped WebP and its thumbnail.
 *
 * `withoutEnlargement` is the whole of the geometry rule: a 600 px drawing stays
 * 600 px rather than being blown up to 2048, because an upscaled scan is larger
 * and no more detailed. The thumbnail is taken from the ORIGINAL buffer rather
 * than from the encoded main image, so it is one resample rather than two.
 */
export async function prepareImage(buffer, quality) {
  const main = await sharp(buffer)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  const thumb = await sharp(buffer)
    .rotate()
    .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  return {
    main: main.data,
    width: main.info.width,
    height: main.info.height,
    thumb: thumb.data,
    thumbWidth: thumb.info.width,
    thumbHeight: thumb.info.height,
  };
}
