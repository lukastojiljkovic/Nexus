import { fitWithinBox, scaleByPercent, type ImageSize } from "@nexus/core";

/**
 * The image tool set's arithmetic and naming, with no canvas in sight.
 *
 * **Why this is a file of its own.** The work itself — decode, draw, encode —
 * happens on a canvas, and no test in this repository can construct one. What
 * DOES have a right and a wrong answer is everything decided BEFORE the canvas
 * is touched: what size the output is, what format it is written in, what it is
 * called, and whether the file has to be re-encoded at all. Those four answers
 * are here, they are pure, and `plan.test.ts` pins them.
 *
 * **The one decision with a consequence the user has to be told about.** A
 * canvas has no metadata channel: what it draws is pixels, so a re-encoded file
 * loses its EXIF block — GPS included. When the plan asks for nothing that needs
 * a re-encode (same size, same format, same bytes), the tool COPIES the file
 * instead, and the copy keeps everything. `needsReencode` is that line, and the
 * page says which side of it each file is on before the user presses the button.
 */

/** The formats an image may be written in. `keep` writes what the file already was. */
export const IMAGE_OUTPUT_FORMATS = ["keep", "png", "jpeg", "webp"] as const;

export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

/** The formats this tool set can read, which is Chromium's own set for a canvas. */
export type ImageSourceFormat = "png" | "jpeg" | "webp";

/** The quality bounds for a lossy encode. 100 is "as little as this encoder can". */
export const IMAGE_QUALITY_MIN = 1;
export const IMAGE_QUALITY_MAX = 100;

/** What the user asked for: a size, a format and (for a lossy format) a quality. */
export interface ImagePlan {
  readonly resize:
    | { readonly kind: "none" }
    | { readonly kind: "percent"; readonly percent: number }
    | { readonly kind: "box"; readonly width: number; readonly height: number };
  readonly format: ImageOutputFormat;
  /** Used only by `jpeg` and `webp`; the encoder ignores it for `png`. */
  readonly quality: number;
}

/** The MIME type each output format is encoded as. */
const OUTPUT_MIME: Record<Exclude<ImageOutputFormat, "keep">, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** The extension each output format is written with — the same four `@nexus/core`'s sniffer knows. */
const OUTPUT_EXTENSION: Record<Exclude<ImageOutputFormat, "keep">, string> = {
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
};

/** The format a file already is, or `null` for bytes that are not one of the three. */
export function sourceFormat(mime: string): ImageSourceFormat | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/webp") return "webp";
  return null;
}

/**
 * The size the output is written at.
 *
 * The percent mode may enlarge and the box mode may not, which is the pair of
 * behaviours `@nexus/core`'s two functions already state: `scaleByPercent`
 * answers the fraction the user typed, `fitWithinBox` fits without inventing
 * pixels. `none` answers the source size untouched, so `needsReencode` can use
 * this function's result to detect the no-op case.
 */
export function planSize(size: ImageSize, resize: ImagePlan["resize"]): ImageSize {
  switch (resize.kind) {
    case "none":
      return { width: size.width, height: size.height };
    case "percent":
      return scaleByPercent(size, resize.percent);
    case "box":
      return fitWithinBox(size, { width: resize.width, height: resize.height });
  }
}

/** The format the output is encoded as: what the file already was, or what the user chose. */
export function targetFormat(plan: ImagePlan, current: ImageSourceFormat): Exclude<ImageOutputFormat, "keep"> {
  return plan.format === "keep" ? current : plan.format;
}

/** The MIME type an encode writes, for the bytes main sniffs at the other end. */
export function outputMime(format: Exclude<ImageOutputFormat, "keep">): string {
  return OUTPUT_MIME[format];
}

/**
 * The name an output file gets: the source's base name with the extension the
 * chosen format earns.
 *
 * The base is kept — it is how the user recognises the file — and the extension
 * is REPLACED rather than appended, because `holiday.png` converted to JPEG is
 * `holiday.jpg` and not `holiday.png.jpg`. A name with no extension simply gains
 * one.
 */
export function outputName(name: string, format: Exclude<ImageOutputFormat, "keep">): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}${OUTPUT_EXTENSION[format]}`;
}

/**
 * Whether writing this file needs the canvas at all.
 *
 * It does not when the plan asks for exactly what the file already is: the same
 * size, the same format, and — for a lossy format — a quality of 100, which is
 * the encoder's own "keep as much as I can" and therefore not a change anybody
 * asked for. Such a file is COPIED, and the copy keeps its EXIF block, GPS
 * included. Everything else goes through the canvas and loses it.
 */
export function needsReencode(
  plan: ImagePlan,
  size: ImageSize,
  current: ImageSourceFormat,
): boolean {
  const target = targetFormat(plan, current);
  if (target !== current) return true;
  const next = planSize(size, plan.resize);
  if (next.width !== size.width || next.height !== size.height) return true;
  if (target !== "png" && plan.quality < IMAGE_QUALITY_MAX) return true;
  return false;
}
