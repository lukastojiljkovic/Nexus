import { describe, expect, it, vi } from "vitest";

import { processGalleryImage } from "./nativeImage.js";

const decoder = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("the raster decoder must not run for an oversized declaration");
  }),
);

vi.mock("electron", () => ({
  nativeImage: { createFromBuffer: decoder },
}));

describe("Gallery raster input", () => {
  it("rejects an oversized declared canvas before invoking the decoder", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(20_000, 16);
    png.writeUInt32BE(5_000, 20);

    expect(() => processGalleryImage(png)).toThrow(/at most 16384 pixels/);
    expect(decoder).not.toHaveBeenCalled();
  });
});
