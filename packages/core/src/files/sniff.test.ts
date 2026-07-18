import { describe, expect, it } from "vitest";
import { isInlineImageMime, sniffMime } from "./sniff.js";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(text: string): number[] {
  return [...text].map((ch) => ch.charCodeAt(0));
}

describe("sniffMime", () => {
  it("detects image/png from its 8-byte magic", () => {
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3))).toBe(
      "image/png",
    );
  });

  it("detects image/jpeg from its 3-byte magic", () => {
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
  });

  it("detects image/gif from both GIF87a and GIF89a headers", () => {
    expect(sniffMime(new Uint8Array(ascii("GIF87a").concat([1, 2])))).toBe("image/gif");
    expect(sniffMime(new Uint8Array(ascii("GIF89a").concat([1, 2])))).toBe("image/gif");
  });

  it("detects image/webp only when both RIFF and WEBP markers are present", () => {
    const webp = new Uint8Array(ascii("RIFF").concat([0, 0, 0, 0]).concat(ascii("WEBP")));
    expect(sniffMime(webp)).toBe("image/webp");

    // RIFF without a WEBP marker at offset 8 is not a webp (e.g. a WAV file).
    const wav = new Uint8Array(ascii("RIFF").concat([0, 0, 0, 0]).concat(ascii("WAVE")));
    expect(sniffMime(wav)).toBe("application/octet-stream");
  });

  it("detects application/pdf from its %PDF magic", () => {
    expect(sniffMime(new Uint8Array(ascii("%PDF-1.4")))).toBe("application/pdf");
  });

  it("detects application/zip from both the local-file-header and empty-archive magics", () => {
    expect(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04, 1, 2))).toBe("application/zip");
    expect(sniffMime(bytes(0x50, 0x4b, 0x05, 0x06, 1, 2))).toBe("application/zip");
  });

  it("falls back to application/octet-stream for unrecognized bytes", () => {
    expect(sniffMime(bytes(1, 2, 3, 4, 5))).toBe("application/octet-stream");
  });

  it("falls back to application/octet-stream for an empty input", () => {
    expect(sniffMime(new Uint8Array(0))).toBe("application/octet-stream");
  });

  it("falls back to application/octet-stream for a truncated magic prefix", () => {
    // Only the first two of PNG's eight magic bytes are present.
    expect(sniffMime(bytes(0x89, 0x50))).toBe("application/octet-stream");
    // Only the first three of GIF's six magic bytes are present.
    expect(sniffMime(new Uint8Array(ascii("GIF")))).toBe("application/octet-stream");
  });

  it("sniffs from bytes alone — a .png-named file whose content is actually a zip reports application/zip", () => {
    // sniffMime never takes a file name, so a mismatched extension cannot fool it:
    // this is exactly the zip-content case, independent of whatever name accompanies it.
    expect(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04, 9, 9))).toBe("application/zip");
  });
});

describe("isInlineImageMime", () => {
  it("is true for exactly the four inline-preview raster formats", () => {
    expect(isInlineImageMime("image/png")).toBe(true);
    expect(isInlineImageMime("image/jpeg")).toBe(true);
    expect(isInlineImageMime("image/gif")).toBe(true);
    expect(isInlineImageMime("image/webp")).toBe(true);
  });

  it("is false for every non-raster or unknown mime", () => {
    expect(isInlineImageMime("application/pdf")).toBe(false);
    expect(isInlineImageMime("application/zip")).toBe(false);
    expect(isInlineImageMime("application/octet-stream")).toBe(false);
    expect(isInlineImageMime("image/svg+xml")).toBe(false);
    expect(isInlineImageMime("text/html")).toBe(false);
  });
});
