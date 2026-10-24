import { describe, expect, it } from "vitest";

import {
  encodedImageSize,
  MAX_GALLERY_EDGE,
  MAX_GALLERY_PIXELS,
  THUMBNAIL_EDGE,
  thumbnailSize,
  validateImageSize,
} from "./assets.js";

describe("Gallery encoded headers", () => {
  it("reads dimensions before any raster decoder allocates pixels", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlB4ZkAAAAASUVORK5CYII=",
      "base64",
    );
    expect(encodedImageSize(png)).toEqual({ width: 1, height: 1 });

    const gif = Buffer.from("GIF89a\x03\x00\x02\x00", "latin1");
    expect(encodedImageSize(gif)).toEqual({ width: 3, height: 2 });

    const jpeg = Buffer.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ]);
    expect(encodedImageSize(jpeg)).toEqual({ width: 3, height: 2 });

    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "latin1");
    webp.writeUInt32LE(22, 4);
    webp.write("WEBP", 8, "latin1");
    webp.write("VP8X", 12, "latin1");
    webp.writeUInt32LE(10, 16);
    webp.writeUIntLE(2, 24, 3);
    webp.writeUIntLE(4, 27, 3);
    expect(encodedImageSize(webp)).toEqual({ width: 3, height: 5 });
  });

  it("returns null for a truncated or unknown header", () => {
    expect(encodedImageSize(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
    expect(encodedImageSize(new TextEncoder().encode("not an image"))).toBeNull();
  });
});

describe("Gallery image constraints", () => {
  it("accepts a bounded original and fits its thumbnail inside the tile edge", () => {
    expect(validateImageSize(1600, 900)).toEqual({ width: 1600, height: 900 });
    expect(thumbnailSize(1600, 900)).toEqual({ width: THUMBNAIL_EDGE, height: 288 });
    expect(thumbnailSize(300, 1200)).toEqual({ width: 128, height: THUMBNAIL_EDGE });
  });

  it("never enlarges an image for its thumbnail", () => {
    expect(thumbnailSize(320, 180)).toEqual({ width: 320, height: 180 });
  });

  it("refuses empty, non-integral, oversized-edge and decompression-bomb dimensions", () => {
    for (const [width, height] of [
      [0, 10],
      [10, 0],
      [1.5, 10],
      [MAX_GALLERY_EDGE + 1, 10],
      [10_000, Math.floor(MAX_GALLERY_PIXELS / 10_000) + 1],
    ]) {
      expect(() => validateImageSize(width!, height!)).toThrow();
    }
  });
});
