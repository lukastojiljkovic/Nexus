// The image pipeline's tests: the geometry rule, the metadata rule, and the
// PSNR arithmetic the shipped quality is chosen by.
//
// The images here are GENERATED rather than fixtures, because what is under test
// is arithmetic and not a museum: a 2400 x 1200 source must land on 2048 x 1024
// exactly (2400 / 1200 is 2:1, so the long side fits 2048 and the short one is
// 1024), a 400 px thumbnail of the same picture must be 400 x 200, and a
// picture already smaller than 2048 must come out unchanged rather than
// upscaled. PSNR's expected values are hand-calculated in the comments beside
// them.

import sharp from "sharp";

import { describe, expect, it } from "vitest";

import { MAX_SIDE, MIN_PSNR_DB, QUALITY_CANDIDATES, measureQuality, prepareImage, psnr } from "./images.mjs";

/** A smooth two-axis gradient: easy for WebP, so a high quality already clears 40 dB. */
function smoothGradient(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      pixels[index] = Math.round((x / width) * 255);
      pixels[index + 1] = Math.round((y / height) * 255);
      pixels[index + 2] = Math.round(((x + y) / (width + height)) * 255);
    }
  }
  return pixels;
}

/** Deterministic noise: WebP cannot encode it cheaply, so no quality clears 40 dB. */
function noise(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 1;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[index] = seed & 0xff;
  }
  return pixels;
}

async function jpegOf(pixels, width, height, { exif = false } = {}) {
  const image = sharp(pixels, { raw: { width, height, channels: 3 } });
  return (exif ? image.withMetadata().withExif({ IFD0: { Copyright: "nexus-pack-test" } }) : image)
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe("the geometry rule", () => {
  it("fits a 2400 x 1200 source to 2048 x 1024 and its thumbnail to 400 x 200", async () => {
    const source = await jpegOf(smoothGradient(2400, 1200), 2400, 1200);
    const result = await prepareImage(source, 80);
    expect({ width: result.width, height: result.height }).toEqual({ width: MAX_SIDE, height: 1024 });
    expect({ width: result.thumbWidth, height: result.thumbHeight }).toEqual({ width: 400, height: 200 });
    // The shipped bytes are WebP, whatever came in.
    expect((await sharp(result.main).metadata()).format).toBe("webp");
    expect((await sharp(result.thumb).metadata()).format).toBe("webp");
  });

  it("does not enlarge a source whose longest side is already under 2048", async () => {
    const source = await jpegOf(smoothGradient(320, 200), 320, 200);
    const result = await prepareImage(source, 80);
    expect({ width: result.width, height: result.height }).toEqual({ width: 320, height: 200 });
  });
});

describe("the metadata rule", () => {
  it("drops the EXIF the source carried", async () => {
    const source = await jpegOf(smoothGradient(320, 200), 320, 200, { exif: true });
    // The input really has EXIF, or the assertion below would pass for the
    // wrong reason.
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const result = await prepareImage(source, 80);
    expect((await sharp(result.main).metadata()).exif).toBeUndefined();
    expect((await sharp(result.thumb).metadata()).exif).toBeUndefined();
  });
});

describe("PSNR", () => {
  it("is the textbook 10 log10(255^2 / MSE)", () => {
    // One byte off by one in four: MSE = 1/4, so 65025 / 0.25 = 260100 and
    // 10 * log10(260100) = 54.1514 dB.
    expect(psnr(Uint8Array.from([0, 0, 0, 0]), Uint8Array.from([1, 0, 0, 0]))).toBeCloseTo(54.1514, 3);
    // Two bytes swapped end to end: MSE = 65025, so the ratio is 1 and the
    // result is 0 dB.
    expect(psnr(Uint8Array.from([0, 255]), Uint8Array.from([255, 0]))).toBeCloseTo(0, 6);
  });

  it("is infinite for two identical images, and refuses two different sizes", () => {
    expect(psnr(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3]))).toBe(Number.POSITIVE_INFINITY);
    expect(() => psnr(Uint8Array.from([1]), Uint8Array.from([1, 2]))).toThrow(/not the same image/);
  });
});

describe("the quality measurement", () => {
  it("walks every candidate in ascending order and reports bytes and dB for each", async () => {
    const source = await jpegOf(smoothGradient(1600, 900), 1600, 900);
    const measured = await measureQuality([source]);
    expect(measured.table.map((row) => row.quality)).toEqual(QUALITY_CANDIDATES);
    for (const row of measured.table) {
      expect(row.meanBytes).toBeGreaterThan(0);
      expect(Number.isFinite(row.meanPsnrDb)).toBe(true);
    }
  });

  it("picks the lowest quality that clears 40 dB", async () => {
    const source = await jpegOf(smoothGradient(1600, 900), 1600, 900);
    const measured = await measureQuality([source]);
    // A smooth gradient is easy: the lowest candidate is the highest its own
    // requirement, and the run has just measured that.
    expect(measured.table[0].meanPsnrDb).toBeGreaterThanOrEqual(MIN_PSNR_DB);
    expect(measured.quality).toBe(QUALITY_CANDIDATES[0]);
  });

  it("falls back to the highest candidate when none clears the line", async () => {
    const source = await jpegOf(noise(640, 480), 640, 480);
    const measured = await measureQuality([source]);
    const clearing = measured.table.find((row) => row.meanPsnrDb >= MIN_PSNR_DB);
    expect(clearing).toBeUndefined();
    expect(measured.quality).toBe(QUALITY_CANDIDATES[QUALITY_CANDIDATES.length - 1]);
  });
});
