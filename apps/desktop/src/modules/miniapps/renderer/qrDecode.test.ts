import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { decodeRgba, type RgbaImage } from "./qrDecode.js";

/**
 * The QR decoder, on a fixture image (mini-apps).
 *
 * **Where the fixture comes from.** `__fixtures__/qr-fixture.png` is a 220x220
 * 8-bit RGB PNG holding the text `NEXUS-QR-FIXTURE-2026`, generated once with
 * zxing's own `QRCodeWriter` (`@zxing/library` 0.23.0) and written through
 * Node's `zlib`: `QRCodeWriter.encode(text, BarcodeFormat.QR_CODE, 220, 220, new Map())`
 * gives the module matrix, and the PNG is that matrix's pixels with every row
 * written unfiltered (filter type 0). The generator was a throwaway script; this
 * file is the fixture's reader, and it understands exactly the shape that script
 * wrote - 8-bit, colour types 0, 2 and 6, filter types 0-4, no interlace.
 *
 * **Why the decode is exercised on real pixels rather than on a constructed
 * array.** The step under test is "an RGBA buffer in, the code's text out", and
 * the buffer is what a canvas hands over. Handing it a fixture that came off
 * disk therefore tests the conversion and the binarisation together, which is
 * the pair that would otherwise only be exercised by pointing a camera at a
 * screen.
 */

const FIXTURE = fileURLToPath(new URL("./__fixtures__/qr-fixture.png", import.meta.url));
const FIXTURE_TEXT = "NEXUS-QR-FIXTURE-2026";

/** One PNG chunk: its type and its payload. */
function chunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array }[] = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    out.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === "IEND") break;
  }
  return out;
}

/** Paeth's predictor, from the PNG specification's own definition. */
function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/**
 * A PNG's pixels as RGBA bytes.
 *
 * Only the three colour types an 8-bit fixture can be (grey, RGB, RGBA) and the
 * five filter types; that is the whole of what this file needs, and a reader
 * that quietly mishandled interlace would be worse than one that says it does
 * not read it.
 */
function readPng(png: Uint8Array): RgbaImage {
  const list = chunks(png);
  const header = list.find((chunk) => chunk.type === "IHDR")?.data;
  if (header === undefined) throw new Error("the fixture has no IHDR");
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = header[8] ?? 0;
  const colourType = header[9] ?? 0;
  const interlace = header[12] ?? 0;
  if (bitDepth !== 8 || interlace !== 0) throw new Error("the fixture reader needs an 8-bit, non-interlaced PNG");
  const channels = colourType === 0 ? 1 : colourType === 2 ? 3 : colourType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`the fixture reader does not read colour type ${colourType}`);

  const compressed = Buffer.concat(
    list.filter((chunk) => chunk.type === "IDAT").map((chunk) => Buffer.from(chunk.data)),
  );
  const raw = inflateSync(compressed);

  const stride = width * channels;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const line = new Uint8Array(stride);
    for (let at = 0; at < stride; at += 1) {
      const left = at >= channels ? (line[at - channels] ?? 0) : 0;
      const up = previous[at] ?? 0;
      const upLeft = at >= channels ? (previous[at - channels] ?? 0) : 0;
      const value = row[at] ?? 0;
      let unfiltered: number;
      switch (filter) {
        case 0:
          unfiltered = value;
          break;
        case 1:
          unfiltered = value + left;
          break;
        case 2:
          unfiltered = value + up;
          break;
        case 3:
          unfiltered = value + ((left + up) >> 1);
          break;
        case 4:
          unfiltered = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
      line[at] = unfiltered & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      const grey = line[source] ?? 0;
      rgba[target] = channels === 1 ? grey : (line[source] ?? 0);
      rgba[target + 1] = channels === 1 ? grey : (line[source + 1] ?? 0);
      rgba[target + 2] = channels === 1 ? grey : (line[source + 2] ?? 0);
      rgba[target + 3] = channels === 4 ? (line[source + 3] ?? 0) : 255;
    }
    previous.set(line);
  }
  return { width, height, rgba };
}

describe("decodeRgba", () => {
  it("reads the text out of the fixture image", () => {
    const image = readPng(readFileSync(FIXTURE));

    expect(image.width).toBe(220);
    expect(image.height).toBe(220);
    expect(decodeRgba(image)).toBe(FIXTURE_TEXT);
  });

  it("answers null for an image with no code in it, rather than throwing", () => {
    const width = 64;
    const height = 64;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(255);

    expect(decodeRgba({ width, height, rgba })).toBeNull();
  });

  it("refuses a buffer whose length does not match its dimensions", () => {
    expect(() => decodeRgba({ width: 10, height: 10, rgba: new Uint8ClampedArray(4) })).toThrow(
      RangeError,
    );
    expect(() => decodeRgba({ width: 0, height: 10, rgba: new Uint8ClampedArray(0) })).toThrow(
      RangeError,
    );
  });
});
