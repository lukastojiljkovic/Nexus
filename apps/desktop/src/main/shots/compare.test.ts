import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  compareFrames,
  compareRuns,
  diffImage,
  runCompare,
  type NoiseThresholds,
} from "./compare.mjs";

/**
 * The tolerance, stated as numbers rather than as a feeling.
 *
 * `compare.mts` holds a measurement — 157 of 342 frames differing by at most 100
 * pixels and, in all but one, by at most 32 of 255 levels in any channel — and
 * what a threshold needs is the two cases either side of it: 32 and 100 are
 * noise, 33 and 101 are not. A suite that only tested a large obvious change
 * would pass against a tool whose bounds were off by one in the direction that
 * silences a real defect.
 *
 * The PNGs are built HERE, out of `node:zlib` — the same idiom
 * `main/demo/attachments.ts` writes its fixture in — rather than with the
 * decoder's own encoder. Two reasons: a fixture and a decoder from one library
 * would agree with each other whether or not either was right, and a hand-built
 * `IHDR` is the only way to state the pixels a case is about.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** One chunk: length, type, body, and the CRC over type and body — never over the length, the format's own rule. */
function chunkOf(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  const named = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(named) >>> 0, 0);
  return Buffer.concat([head, named, crc]);
}

/**
 * A truecolour PNG: one `IHDR`, one deflated `IDAT`, one `IEND`, filter 0 on
 * every row.
 *
 * Both colour types are here because Chromium's PNG encoder writes both — an
 * opaque capture goes out without alpha — and a decoder tested against one of
 * them is a decoder that never met half the frames this tool is pointed at.
 */
function pngOf(width: number, height: number, rgba: Buffer, colourType: 2 | 6 = 6): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(colourType, 9); // 2: truecolour; 6: truecolour with alpha
  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    if (bpp === 4) {
      rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    } else {
      for (let x = 0; x < width; x += 1) {
        // The source offset carries the row as well as the column: without it
        // every row would be built out of the FIRST row's pixels, and a fixture
        // that smears one row down the frame is not the frame a case means.
        const from = (y * width + x) * 4;
        rgba.copy(raw, y * (stride + 1) + 1 + x * bpp, from, from + 3);
      }
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunkOf("IHDR", ihdr),
    chunkOf("IDAT", deflateSync(raw)),
    chunkOf("IEND", Buffer.alloc(0)),
  ]);
}

/** Opaque pixels of one size and one fill — the canvas a case paints on, before it is wrapped in a PNG. */
function canvasOf(width: number, height: number, fill = 0x40): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.writeUInt8(fill, index);
    pixels.writeUInt8(fill, index + 1);
    pixels.writeUInt8(fill, index + 2);
    pixels.writeUInt8(255, index + 3);
  }
  return pixels;
}

/**
 * Sets one channel of the first `count` pixels to `value`.
 *
 * A copy, and the copy is load-bearing: the caller's canvas goes on to be
 * encoded as the OLD frame of the same case, so a helper that painted in place
 * would move the pixel in both frames and every case would read `identical`.
 */
function repaint(pixels: Buffer, count: number, channel: number, value: number): Buffer {
  const moved = Buffer.from(pixels);
  for (let pixel = 0; pixel < count; pixel += 1) {
    moved.writeUInt8(value, pixel * 4 + channel);
  }
  return moved;
}

/** Two frames of one size: one as painted, one after `paint` has moved something in it. */
function pair(
  width: number,
  height: number,
  paint: (pixels: Buffer) => Buffer,
): { old: Buffer; next: Buffer } {
  const pixels = canvasOf(width, height);
  return { old: pngOf(width, height, pixels), next: pngOf(width, height, paint(pixels)) };
}

/** The same pair, twice: a case about tolerance rather than about a frame's content. */
function frames(width: number, height: number): { old: Buffer; next: Buffer } {
  return pair(width, height, (pixels) => pixels);
}

describe("compareFrames", () => {
  it("calls two frames of one build identical when not a pixel moved", () => {
    const { old, next } = frames(8, 4);
    expect(compareFrames(old, next)).toEqual({
      verdict: "identical",
      differingPixels: 0,
      maxChannelDifference: 0,
    });
  });

  it("calls one pixel of anti-aliasing noise noise", () => {
    const { old, next } = pair(8, 4, (pixels) => repaint(pixels, 1, 0, 0x41));
    expect(compareFrames(old, next)).toEqual({
      verdict: "noise",
      differingPixels: 1,
      maxChannelDifference: 1,
    });
  });

  /**
   * The two sides of the channel bound, one level apart. `noise` means „no
   * channel differing by MORE than 32", so 32 is on the far side of it: a
   * threshold read as „less than 32" would call a whole class of ordinary
   * rasterisation a visible change and bury the real ones.
   */
  it("keeps a 32-level channel difference at noise and refuses a 33-level one", () => {
    const within = pair(8, 4, (pixels) => repaint(pixels, 1, 0, 0x60));
    expect(compareFrames(within.old, within.next)).toEqual({
      verdict: "noise",
      differingPixels: 1,
      maxChannelDifference: 32,
    });
    const { old, next } = pair(8, 4, (pixels) => repaint(pixels, 1, 0, 0x61));
    expect(compareFrames(old, next)).toEqual({
      verdict: "changed",
      differingPixels: 1,
      maxChannelDifference: 33,
    });
  });

  /** The two sides of the pixel bound, by the same rule: at most 100 is inside it. */
  it("keeps 100 differing pixels at noise and refuses 101", () => {
    // 256 pixels in the frame, so 101 of them is a small part of it.
    const { old, next } = pair(64, 4, (pixels) => repaint(pixels, 100, 0, 0x41));
    expect(compareFrames(old, next)).toEqual({
      verdict: "noise",
      differingPixels: 100,
      maxChannelDifference: 1,
    });
    const over = pair(64, 4, (pixels) => repaint(pixels, 101, 0, 0x41));
    expect(compareFrames(over.old, over.next).verdict).toBe("changed");
  });

  /**
   * The counting rule, with a case that a red-channel-only loop would report as
   * `identical`: the pixel moved in green and nothing else.
   */
  it("counts a pixel that moved in one trailing channel", () => {
    const { old, next } = pair(4, 2, (pixels) => repaint(pixels, 1, 1, 0x68));
    expect(compareFrames(old, next)).toEqual({
      verdict: "changed",
      differingPixels: 1,
      maxChannelDifference: 40,
    });
  });

  it("calls two frames of different sizes size-changed, with no pixel count to report", () => {
    const { old } = frames(8, 4);
    const { next } = frames(8, 5);
    expect(compareFrames(old, next)).toEqual({
      verdict: "size-changed",
      differingPixels: 0,
      maxChannelDifference: 0,
    });
  });

  it("reads a frame written as truecolour without alpha", () => {
    const pixels = canvasOf(8, 4);
    const before = pngOf(8, 4, pixels, 2);
    expect(compareFrames(before, pngOf(8, 4, pixels, 2)).verdict).toBe("identical");
    const moved = pngOf(8, 4, repaint(pixels, 1, 0, 0xff), 2);
    expect(compareFrames(before, moved)).toEqual({
      verdict: "changed",
      differingPixels: 1,
      maxChannelDifference: 191,
    });
  });

  it("takes both bounds as options rather than as constants", () => {
    const strict: NoiseThresholds = { pixels: 0, channel: 0 };
    const one = pair(8, 4, (pixels) => repaint(pixels, 1, 0, 0x41));
    expect(compareFrames(one.old, one.next, strict).verdict).toBe("changed");
    // A whole frame's pixels moved by more than a channel bound could allow,
    // and still noise: bounds are ANDed, and the looser pair says both of them
    // are the caller's, not constants baked in behind the API.
    const loose: NoiseThresholds = { pixels: 100, channel: 255 };
    const hundred = pair(64, 4, (pixels) => repaint(pixels, 100, 0, 0xff));
    expect(compareFrames(hundred.old, hundred.next, loose).verdict).toBe("noise");
  });

  it("says which file it could not decode instead of comparing rubbish", () => {
    const { old } = frames(2, 2);
    expect(() => compareFrames(old, Buffer.from("not a png"))).toThrow(/not a PNG/);
  });
});

describe("diffImage", () => {
  it("paints the pixels that moved by how far they moved, and the rest black", () => {
    // One pixel ten levels of red away from the frame it is compared with, and
    // the gain stated as a number: 10 levels land in the image as 40, on that
    // pixel's red channel alone. Compared against a frame built here that is
    // black, so the numbers below are the image a reader opens.
    const { old, next } = pair(4, 2, (pixels) => repaint(pixels, 1, 0, 0x4a));
    const black = pngOf(4, 2, canvasOf(4, 2, 0));
    expect(compareFrames(diffImage(old, next), black)).toEqual({
      verdict: "changed",
      differingPixels: 1,
      maxChannelDifference: 40,
    });
  });

  it("has nothing lit up when nothing moved", () => {
    const { old, next } = frames(4, 2);
    // Black, which is how a PNG says „there was nothing to draw".
    expect(compareFrames(diffImage(old, next), pngOf(4, 2, canvasOf(4, 2, 0))).verdict).toBe(
      "identical",
    );
  });

  it("refuses to draw one for two frames of different sizes", () => {
    const { old } = frames(4, 2);
    const { next } = frames(4, 3);
    expect(() => diffImage(old, next)).toThrow(/one size/);
  });
});

describe("compareRuns", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nexus-shots-compare-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Writes one frame at `<run>/<size>/<theme>/<name>.png`, the shape a sweep writes. */
  function sweep(run: string, size: string, theme: string, name: string, png: Buffer): void {
    const folder = join(dir, run, size, theme);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${name}.png`), png);
  }

  it("pairs frames by their path inside the sweep, not by their name alone", () => {
    const { old, next } = frames(8, 4);
    sweep("old", "min", "dan", "dashboard", old);
    sweep("new", "min", "dan", "dashboard", next);
    const comparison = compareRuns(join(dir, "old"), join(dir, "new"));
    expect(comparison.frames).toEqual([
      { frame: "min/dan/dashboard.png", verdict: "identical", differingPixels: 0, maxChannelDifference: 0 },
    ]);
    expect(comparison.onlyOld).toEqual([]);
    expect(comparison.onlyNew).toEqual([]);
  });

  it("lists a frame only one of the two runs has, on the side that has it", () => {
    const { old, next } = frames(8, 4);
    sweep("old", "min", "dan", "gone", old);
    sweep("old", "min", "dan", "kept", old);
    sweep("new", "min", "dan", "kept", next);
    sweep("new", "wide", "noc", "fresh", next);
    const comparison = compareRuns(join(dir, "old"), join(dir, "new"));
    expect(comparison.frames.map((frame) => frame.frame)).toEqual(["min/dan/kept.png"]);
    expect(comparison.onlyOld).toEqual(["min/dan/gone.png"]);
    expect(comparison.onlyNew).toEqual(["wide/noc/fresh.png"]);
  });

  it("names the directory it was pointed at when there is no sweep there", () => {
    expect(() => compareRuns(join(dir, "nothing"), join(dir, "nothing"))).toThrow(/no such sweep/);
  });
});

describe("runCompare", () => {
  let dir: string;
  let oldDir: string;
  let newDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nexus-shots-run-"));
    oldDir = join(dir, "old");
    newDir = join(dir, "new");
    mkdirSync(join(oldDir, "min", "dan"), { recursive: true });
    mkdirSync(join(newDir, "min", "dan"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const loose: NoiseThresholds = { pixels: 100, channel: 32 };
  const options = { noise: loose, failOnChange: true };

  /** Plants one frame in each run, `paint` moving whatever the case below is about in the new one. */
  function plant(paint: (pixels: Buffer) => Buffer): void {
    const { old, next } = pair(8, 4, paint);
    writeFileSync(join(oldDir, "min", "dan", "dashboard.png"), old);
    writeFileSync(join(newDir, "min", "dan", "dashboard.png"), next);
  }

  it("writes the report beside the new run's frames and returns the report too", () => {
    plant((pixels) => repaint(pixels, 2, 0, 0x41));
    const { report, exitCode } = runCompare(oldDir, newDir, { ...options, failOnChange: false });
    expect(readFileSync(join(newDir, "compare.md"), "utf8")).toBe(report);
    expect(report).toContain("- noise: 1");
    expect(report).toContain("- changed: 0");
    expect(exitCode).toBe(0);
  });

  it("draws one diff image per changed frame, under the new run", () => {
    plant((pixels) => repaint(pixels, 3, 0, 0xff));
    const { report, exitCode } = runCompare(oldDir, newDir, options);
    expect(exitCode).toBe(1);
    expect(report).toContain("min/dan/dashboard.png");
    const diff = readFileSync(join(newDir, "diff", "min", "dan", "dashboard.png"));
    expect(diff.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it("fails only when it was asked to, and only for a changed frame", () => {
    plant((pixels) => repaint(pixels, 1, 0, 0x41));
    expect(runCompare(oldDir, newDir, options).exitCode).toBe(0);
    expect(runCompare(oldDir, newDir, { ...options, failOnChange: false }).exitCode).toBe(0);
  });

  /**
   * The stale-diff case, which is why the folder is cleared rather than merged
   * into: a frame that matched again on the next run would otherwise leave the
   * previous run's diff sitting there, named after a change that is no longer
   * in it.
   */
  it("takes the previous comparison's diffs away rather than leaving them to be misread", () => {
    plant((pixels) => repaint(pixels, 3, 0, 0xff));
    runCompare(oldDir, newDir, options);
    writeFileSync(join(newDir, "min", "dan", "dashboard.png"), frames(8, 4).old);
    runCompare(oldDir, newDir, options);
    expect(() => readFileSync(join(newDir, "diff", "min", "dan", "dashboard.png"))).toThrow();
  });

  it("ignores the diff folder it wrote when it is run again", () => {
    plant((pixels) => repaint(pixels, 3, 0, 0xff));
    runCompare(oldDir, newDir, options);
    const second = runCompare(oldDir, newDir, options);
    expect(second.report).toContain("only in the new run: 0");
    expect(second.report).toContain("- changed: 1");
  });
});
