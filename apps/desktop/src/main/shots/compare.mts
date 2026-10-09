/**
 * Two sweeps, one verdict per frame.
 *
 * Every comparison of two sweeps this month was a throwaway script in a scratch
 * directory, and each one had to re-learn what noise looks like: the sweep
 * photographs the same build twice and a hundred-odd frames differ, not because
 * the app changed but because software rendering and text rasterisation are not
 * bit-identical run to run. A comparison written from scratch each time either
 * drowns in that noise or, worse, gets a threshold picked to make one run quiet.
 *
 * So the tolerance is a MEASUREMENT, and the defaults are that measurement:
 * on 2026-09-26 two partial sweeps of one build were compared and 157 of 342
 * frames differed, every one by at most 100 pixels and, in all but one, by no
 * more than 32 of 255 levels in any channel (`docs/STATUS.md` §4.1 item 3). Two
 * of the differing frames were deliberate — the placeholder-text generator and
 * the tool that shows the time — which is why the class is called `noise`
 * rather than `fine`: a frame inside the tolerance may still be a real change
 * too small to see, and the report says how many pixels moved so a reader can
 * judge that rather than being told the answer.
 *
 * **No Electron.** This module is plain Node, which is what lets it be tested
 * without a window and run as `scripts/shots-compare.mjs` without a build. The
 * one thing it borrows from a runtime is a PNG decoder, and `node:zlib` is the
 * only PNG machinery in the tree — `png-chunks-extract` arrives through
 * `@excalidraw/excalidraw` and stops at the chunk layer — so decoding is
 * `pngjs` (MIT, and shipped with `@types/pngjs` for the declaration it does not
 * carry). A hand-rolled decoder was the alternative and lost on one point: the
 * input is not ours, it is one encoder's output (Electron's `toPNG()`), and the
 * shapes it can arrive in are that encoder's choices rather than ours to fix,
 * so `compare.test.ts` builds both colour types it writes, in the test, rather
 * than leaning on the decoder's own encoder to say what a PNG looks like.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PNG } from "pngjs";

/**
 * What one pair of frames turned out to be.
 *
 * - `identical` — not one pixel differs.
 * - `noise` — inside the tolerance below: anti-aliasing, not content.
 * - `changed` — outside it, so the frame is worth a pair of human eyes.
 * - `size-changed` — the two frames are not the same shape, so there are no
 *   two pixels to compare and `differingPixels` and `maxChannelDifference` are
 *   both 0. A window the sweep could not size, or a frame the sweep took at a
 *   different size, reads as this rather than as `changed`, because the diff
 *   image below could not be drawn for it anyway.
 */
export type FrameVerdict = "identical" | "noise" | "changed" | "size-changed";

export interface FrameComparison {
  readonly verdict: FrameVerdict;
  /** Pixels differing in at least one channel, alpha included. */
  readonly differingPixels: number;
  /** The largest difference any one channel carries, of 255. */
  readonly maxChannelDifference: number;
}

/** The two bounds of `noise`. Both are options, and these are the measured values they default to. */
export interface NoiseThresholds {
  readonly pixels: number;
  readonly channel: number;
}

/**
 * The measured noise, and the reason both bounds exist rather than a single one.
 *
 * A pixel count alone calls a one-pixel hairline shift across a whole card
 * noise; a channel bound alone calls a frame in which a thousand pixels moved
 * by one level noise. Measured 2026-09-26 on two partial sweeps of one build:
 * 157 of 342 frames differed, each by at most 100 pixels and, in all but one,
 * by no more than 32 of 255 levels in any channel. Frames inside BOTH bounds
 * are anti-aliasing.
 */
export const DEFAULT_NOISE: NoiseThresholds = { pixels: 100, channel: 32 };

/** Decodes one PNG, or throws naming the file — a frame that will not decode is a comparison that would otherwise be a lie. */
function decode(png: Buffer, file: string): PNG {
  try {
    return PNG.sync.read(png);
  } catch (error) {
    throw new Error(`${file} is not a PNG this tool can decode: ${String(error)}`, { cause: error });
  }
}

/**
 * One pair of frames, compared channel by channel.
 *
 * The whole frame is walked rather than a sample: the defects worth catching
 * here are small and local (a clipped glyph, a badge over a label), and a
 * sample that missed them would report `identical` about a frame that is not.
 */
export function compareFrames(
  oldFrame: Buffer,
  newFrame: Buffer,
  noise: NoiseThresholds = DEFAULT_NOISE,
): FrameComparison {
  const before = decode(oldFrame, "the old frame");
  const after = decode(newFrame, "the new frame");
  if (before.width !== after.width || before.height !== after.height) {
    return { verdict: "size-changed", differingPixels: 0, maxChannelDifference: 0 };
  }

  let differingPixels = 0;
  let maxChannelDifference = 0;
  // Per PIXEL, over all four channels: a pixel that moved in green alone is a
  // differing pixel, and counting on the red channel because it comes first
  // would report zero for a frame that had shifted its whole hue.
  for (let pixel = 0; pixel < before.data.length; pixel += 4) {
    let differs = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(
        (before.data[pixel + channel] ?? 0) - (after.data[pixel + channel] ?? 0),
      );
      if (difference === 0) continue;
      differs = true;
      if (difference > maxChannelDifference) maxChannelDifference = difference;
    }
    if (differs) differingPixels += 1;
  }

  if (differingPixels === 0) return { verdict: "identical", differingPixels, maxChannelDifference };
  const withinNoise = differingPixels <= noise.pixels && maxChannelDifference <= noise.channel;
  return { verdict: withinNoise ? "noise" : "changed", differingPixels, maxChannelDifference };
}

/**
 * How a differing pixel is painted in the diff image.
 *
 * Fourfold, because the measured noise ceiling is 32 of 255: at this gain the
 * boundary between what the tool calls noise and what it calls content sits at
 * 128, halfway to white, so the eye sorts the two out in the picture the same
 * way the verdict did in the numbers. The four channels of a pixel are the
 * absolute differences themselves, in that order, which is why this needs no
 * palette: an image of the frame's own error is more use than a coloured
 * overlay in the one place the colour would have to mean something.
 */
const DIFF_GAIN = 4;

/**
 * The diff image for one pair: every pixel that differs, painted by how much it
 * differs. Identical pixels are black, so a `changed` frame is a mostly-black
 * image with the change lit up in it.
 */
export function diffImage(oldFrame: Buffer, newFrame: Buffer): Buffer {
  const before = decode(oldFrame, "the old frame");
  const after = decode(newFrame, "the new frame");
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("a diff image needs two frames of one size");
  }

  const diff = new PNG({ width: before.width, height: before.height });
  for (let index = 0; index < before.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(
        (before.data[index + channel] ?? 0) - (after.data[index + channel] ?? 0),
      );
      diff.data[index + channel] = Math.min(255, difference * DIFF_GAIN);
    }
    diff.data[index + 3] = 255;
  }
  return PNG.sync.write(diff);
}

export interface ComparedFrame extends FrameComparison {
  /** The frame's path from its sweep's root, with `/` separators, so two runs are lined up by name. */
  readonly frame: string;
}

export interface RunComparison {
  /** Every frame both runs have, in path order. */
  readonly frames: readonly ComparedFrame[];
  /** Frames only the old run has, in path order — a scene or a size this run did not take. */
  readonly onlyOld: readonly string[];
  readonly onlyNew: readonly string[];
}

/**
 * The diff images' folder, inside the NEW run.
 *
 * Named here because the walk has to know about it: the command writes PNGs of
 * its own into the sweep it is comparing, and a second comparison would then
 * find every diff the first one wrote and report it as a frame the old run does
 * not have. A directory of this name at the root of either sweep is this
 * command's own output and is skipped.
 */
const DIFF_DIR = "diff";

/**
 * Every PNG under one sweep's root, as a path relative to it, in a stable
 * order.
 *
 * RECURSIVE, because a sweep is not a flat directory: frames live at
 * `<size>/<theme>/<stem>.png`, and a comparison that only looked at the root
 * would pair nothing and report a clean run. Skipping the diff folder is the
 * one exclusion, and the report says so rather than leaving a reader to wonder
 * why a frame they can see is not in the count.
 */
function framePaths(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (dir === root && entry.name === DIFF_DIR) continue;
        walk(file);
      } else if (entry.name.endsWith(".png")) {
        found.push(relative(root, file).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return found.sort();
}

/** One sweep's frames, decoded one pair at a time — a full run's worth of RGBA held at once would be gigabytes. */
export function compareRuns(
  oldDir: string,
  newDir: string,
  noise: NoiseThresholds = DEFAULT_NOISE,
): RunComparison {
  for (const dir of [oldDir, newDir]) {
    if (!existsSync(dir)) throw new Error(`no such sweep directory: ${dir}`);
  }

  const oldFrames = framePaths(oldDir);
  const newFrames = new Set(framePaths(newDir));
  const frames: ComparedFrame[] = [];
  const onlyOld: string[] = [];
  for (const frame of oldFrames) {
    if (!newFrames.has(frame)) {
      onlyOld.push(frame);
      continue;
    }
    newFrames.delete(frame);
    frames.push({
      frame,
      ...compareFrames(readFileSync(join(oldDir, frame)), readFileSync(join(newDir, frame)), noise),
    });
  }
  return { frames, onlyOld, onlyNew: [...newFrames].sort() };
}

/** The four classes, in the order the report counts them. */
const VERDICTS: readonly FrameVerdict[] = ["identical", "noise", "changed", "size-changed"];

function countOf(comparison: RunComparison, verdict: FrameVerdict): number {
  return comparison.frames.filter((frame) => frame.verdict === verdict).length;
}

/** One line per frame, for the two classes a reader has to look at. */
function lines(frames: readonly ComparedFrame[]): string[] {
  return frames.map(
    (frame) =>
      `- \`${frame.frame}\` — ${String(frame.differingPixels)} ` +
      `${frame.differingPixels === 1 ? "pixel" : "pixels"}, ` +
      `largest channel difference ${String(frame.maxChannelDifference)}`,
  );
}

/**
 * The report, which is the product: the counts are what tells a reader whether
 * a change is visible anywhere, and the two lists are what to look at when it
 * is.
 *
 * Both roots are named in full, because the report outlives the terminal it was
 * printed in and `shots/2026-10-09-1` says nothing about which machine or which
 * checkout it was.
 */
export function renderReport(
  comparison: RunComparison,
  oldDir: string,
  newDir: string,
  noise: NoiseThresholds = DEFAULT_NOISE,
): string {
  const changed = comparison.frames.filter((frame) => frame.verdict === "changed");
  const resized = comparison.frames.filter((frame) => frame.verdict === "size-changed");
  const out: string[] = [
    "# Sweep comparison",
    "",
    `old: ${resolve(oldDir)}`,
    `new: ${resolve(newDir)}`,
    "",
    `noise: at most ${String(noise.pixels)} differing pixels and no channel differing by more than ` +
      `${String(noise.channel)} of 255 levels (measured 2026-09-26 on two partial sweeps of one build)`,
    `pairs: ${String(comparison.frames.length)}, only in the old run: ${String(comparison.onlyOld.length)}, ` +
      `only in the new run: ${String(comparison.onlyNew.length)}`,
    "",
  ];
  for (const verdict of VERDICTS) {
    out.push(`- ${verdict}: ${String(countOf(comparison, verdict))}`);
  }

  out.push("", `## changed (${String(changed.length)})`, "");
  out.push(
    ...(changed.length === 0
      ? ["Nothing outside the noise — this change is not visible in the sweep."]
      : lines(changed)),
  );

  out.push("", `## size-changed (${String(resized.length)})`, "");
  out.push(...(resized.length === 0 ? ["Nothing."] : lines(resized)));

  if (comparison.onlyOld.length > 0) {
    out.push("", `## only in the old run (${String(comparison.onlyOld.length)})`, "");
    out.push(...comparison.onlyOld.map((frame) => `- \`${frame}\``));
  }
  if (comparison.onlyNew.length > 0) {
    out.push("", `## only in the new run (${String(comparison.onlyNew.length)})`, "");
    out.push(...comparison.onlyNew.map((frame) => `- \`${frame}\``));
  }
  return `${out.join("\n")}\n`;
}

export interface CompareCommandOptions {
  readonly noise: NoiseThresholds;
  /**
   * Whether a `changed` frame fails the run. `size-changed` deliberately does
   * NOT: the flag is named for `changed`, and a frame that changed shape is
   * already listed at the top of the report where a reader cannot miss it.
   */
  readonly failOnChange: boolean;
}

/**
 * The whole command: compare, write the report, write a diff image per changed
 * frame, and answer with the exit code.
 *
 * The diff folder is REMOVED before it is written rather than merged into,
 * because it holds the previous comparison's findings: a frame that has since
 * gone back to matching would leave its old diff sitting there to be read as
 * this run's. The removal is bounded — the path is built from the new run's own
 * root and checked to be inside it — and only ever touches a directory this
 * command created.
 */
export function runCompare(
  oldDir: string,
  newDir: string,
  options: CompareCommandOptions,
): { readonly report: string; readonly exitCode: number } {
  const comparison = compareRuns(oldDir, newDir, options.noise);
  const report = renderReport(comparison, oldDir, newDir, options.noise);
  writeFileSync(join(newDir, "compare.md"), report);

  const newRoot = resolve(newDir);
  const diffRoot = join(newRoot, DIFF_DIR);
  if (dirname(diffRoot) !== newRoot) throw new Error(`refusing to write outside ${newDir}`);
  rmSync(diffRoot, { recursive: true, force: true });
  const changed = comparison.frames.filter((frame) => frame.verdict === "changed");
  if (changed.length > 0) mkdirSync(diffRoot, { recursive: true });
  for (const frame of changed) {
    const file = join(diffRoot, frame.frame);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      diffImage(readFileSync(join(oldDir, frame.frame)), readFileSync(join(newDir, frame.frame))),
    );
  }

  const failed = options.failOnChange && changed.length > 0;
  return { report, exitCode: failed ? 1 : 0 };
}
