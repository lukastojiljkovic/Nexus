/**
 * The QR decoder's one pure step: pixels in, text out.
 *
 * **Why the boundary sits here.** `@zxing/library` reads a luminance plane, and
 * everything before it - reading a file, drawing it to a canvas, reading the
 * canvas's pixels back - is the browser's own work (`createImageBitmap`,
 * `OffscreenCanvas`, `getImageData`). So the only part worth having is the
 * conversion and the decode, and it is a pure function of an RGBA buffer: no
 * `document`, no canvas, no file. That is what lets it run in a Web Worker (the
 * page's own requirement: a decode is tens of milliseconds of CPU and does not
 * belong on the thread drawing the window) AND be tested in Node against a
 * fixture image, which no canvas-bound version could be.
 *
 * **Why the luminance is computed here rather than handed to the library's own
 * ARGB path.** `RGBLuminanceSource` takes either an `Int32Array` of packed ARGB
 * or a byte-per-pixel luminance plane; passing an RGBA byte buffer would be read
 * as the luminance plane itself, i.e. as garbage. So this file converts with the
 * standard Rec. 601 weights, which is a quality decision rather than a
 * concession: the library's cheap path averages channels with a green bias that
 * costs contrast on a photograph of a code.
 *
 * **What "no code" is.** `null`, never a throw: an image without a code is the
 * ordinary case - the user pointed at the wrong file - and the page says so in
 * its own words (`copy.qr.noCode`). A throw is reserved for a buffer whose
 * dimensions do not match its length, which is a programming error.
 */
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
  type Result,
} from "@zxing/library";

/** An image as the renderer's canvas hands it over: RGBA bytes, row-major. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** `width * height * 4` bytes: red, green, blue, alpha per pixel. */
  readonly rgba: Uint8ClampedArray;
}

/**
 * How large an image this will attempt, in pixels.
 *
 * A bound rather than a guess: `getImageData` on a 40-megapixel photograph is a
 * hundred megabytes of buffer, and a decode that has to binarise it is seconds
 * of work. 16 megapixels is past any camera this app will ever be handed a photo
 * from and well under what the buffer costs.
 */
export const MAX_QR_PIXELS = 16_000_000;

/** Rec. 601 luminance, written over the RGBA buffer rather than into a second one per pixel. */
function toLuminance(image: RgbaImage): Uint8ClampedArray {
  const { width, height, rgba } = image;
  const plane = new Uint8ClampedArray(width * height);
  for (let pixel = 0; pixel < plane.length; pixel += 1) {
    const red = rgba[pixel * 4] ?? 0;
    const green = rgba[pixel * 4 + 1] ?? 0;
    const blue = rgba[pixel * 4 + 2] ?? 0;
    plane[pixel] = (0.299 * red + 0.587 * green + 0.114 * blue) | 0;
  }
  return plane;
}

/** The text of the first QR code in the image, or `null` when there is none. */
export function decodeRgba(image: RgbaImage): string | null {
  const { width, height, rgba } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("an image needs whole positive dimensions");
  }
  if (rgba.length !== width * height * 4) {
    throw new RangeError("the pixel buffer does not match the image's dimensions");
  }
  if (width * height > MAX_QR_PIXELS) return null;

  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(toLuminance(image), width, height)));
  const reader = new MultiFormatReader();
  try {
    const result: Result = reader.decode(
      bitmap,
      new Map<DecodeHintType, unknown>([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]],
        [DecodeHintType.TRY_HARDER, true],
      ]),
    );
    return result.getText();
  } catch {
    // `NotFoundException` for an image without a code, `FormatException` for a
    // damaged one, `ChecksumException` for a misread one: to a reader of the
    // page those are one answer, and it is "no text".
    return null;
  }
}
