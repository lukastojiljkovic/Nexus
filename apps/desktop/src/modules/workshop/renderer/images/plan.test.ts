import { describe, expect, it } from "vitest";
import {
  IMAGE_QUALITY_MAX,
  needsReencode,
  outputMime,
  outputName,
  planSize,
  sourceFormat,
  targetFormat,
  type ImagePlan,
} from "./plan.js";

/**
 * The image tool set's planning arithmetic, every expectation a hand
 * calculation or a stated rule.
 *
 * The resize expectations are the products written out (`1000 × 0.25`), and the
 * re-encode expectations are `needsReencode`'s own sentence: a file is copied
 * only when the plan asks for exactly what it already is.
 */

/** A plan with everything left alone, so each test states only what it changes. */
const NOTHING: ImagePlan = { resize: { kind: "none" }, format: "keep", quality: IMAGE_QUALITY_MAX };

describe("sourceFormat", () => {
  it("recognises the three formats a canvas can read, and nothing else", () => {
    expect(sourceFormat("image/png")).toBe("png");
    expect(sourceFormat("image/jpeg")).toBe("jpeg");
    expect(sourceFormat("image/webp")).toBe("webp");
    expect(sourceFormat("image/gif")).toBeNull();
    expect(sourceFormat("application/pdf")).toBeNull();
    expect(sourceFormat("")).toBeNull();
  });
});

describe("planSize", () => {
  it("answers the source size when the plan does not resize", () => {
    expect(planSize({ width: 800, height: 600 }, { kind: "none" })).toEqual({ width: 800, height: 600 });
  });

  it("scales by the percentage, rounding each side", () => {
    // 1000 × 25% = 250; 500 × 25% = 125.
    expect(planSize({ width: 1000, height: 500 }, { kind: "percent", percent: 25 })).toEqual({
      width: 250,
      height: 125,
    });
    // 3 × 33% = 0.99 → 1, never 0: a zero-sized canvas throws.
    expect(planSize({ width: 3, height: 3 }, { kind: "percent", percent: 33 })).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("fits into a box without stretching and without enlarging", () => {
    // scale = min(400/1000, 400/500) = 0.4 → 400 × 200.
    expect(planSize({ width: 1000, height: 500 }, { kind: "box", width: 400, height: 400 })).toEqual({
      width: 400,
      height: 200,
    });
    // Nothing to gain: the picture is already inside the box.
    expect(planSize({ width: 100, height: 100 }, { kind: "box", width: 800, height: 800 })).toEqual({
      width: 100,
      height: 100,
    });
  });
});

describe("targetFormat", () => {
  it("keeps the source format, or takes the chosen one", () => {
    expect(targetFormat(NOTHING, "png")).toBe("png");
    expect(targetFormat({ ...NOTHING, format: "jpeg" }, "png")).toBe("jpeg");
    expect(targetFormat({ ...NOTHING, format: "webp" }, "jpeg")).toBe("webp");
  });
});

describe("outputMime and outputName", () => {
  it("names each encode the way the sniffer at the other end reads it", () => {
    expect(outputMime("png")).toBe("image/png");
    expect(outputMime("jpeg")).toBe("image/jpeg");
    expect(outputMime("webp")).toBe("image/webp");
  });

  it("replaces the extension rather than appending to it", () => {
    expect(outputName("holiday.png", "jpeg")).toBe("holiday.jpg");
    expect(outputName("holiday.JPG", "webp")).toBe("holiday.webp");
    expect(outputName("bez-ekstenzije", "png")).toBe("bez-ekstenzije.png");
    // A dotfile's leading dot is part of its name, not an extension.
    expect(outputName(".hidden", "png")).toBe(".hidden.png");
    expect(outputName("archive.tar.gz", "png")).toBe("archive.tar.png");
  });
});

describe("needsReencode", () => {
  it("copies a file the plan leaves exactly as it is", () => {
    expect(needsReencode(NOTHING, { width: 10, height: 10 }, "png")).toBe(false);
    expect(needsReencode(NOTHING, { width: 10, height: 10 }, "jpeg")).toBe(false);
  });

  it("re-encodes when the size, the format or the quality is a change", () => {
    expect(needsReencode({ ...NOTHING, resize: { kind: "percent", percent: 50 } }, { width: 10, height: 10 }, "png")).toBe(true);
    expect(needsReencode({ ...NOTHING, format: "webp" }, { width: 10, height: 10 }, "png")).toBe(true);
    expect(needsReencode({ ...NOTHING, quality: 80 }, { width: 10, height: 10 }, "jpeg")).toBe(true);
  });

  it("treats a box that does not shrink the picture as no change", () => {
    // The box is bigger than the image, so `fitWithinBox` answers the image's
    // own size and nothing has to be drawn: the file is copied, EXIF and all.
    expect(needsReencode({ ...NOTHING, resize: { kind: "box", width: 500, height: 500 } }, { width: 10, height: 10 }, "jpeg")).toBe(false);
  });

  it("ignores the quality for PNG, where there is no quality to choose", () => {
    expect(needsReencode({ ...NOTHING, quality: 30 }, { width: 10, height: 10 }, "png")).toBe(false);
  });
});
