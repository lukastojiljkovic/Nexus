export const MAX_GALLERY_EDGE = 16_384;
export const MAX_GALLERY_PIXELS = 80_000_000;
export const THUMBNAIL_EDGE = 512;

export interface GalleryImageSize {
  readonly width: number;
  readonly height: number;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function uint16be(bytes: Uint8Array, at: number): number {
  return (bytes[at]! << 8) | bytes[at + 1]!;
}

function uint32be(bytes: Uint8Array, at: number): number {
  return (
    bytes[at]! * 0x1000000 +
    (bytes[at + 1]! << 16) +
    (bytes[at + 2]! << 8) +
    bytes[at + 3]!
  );
}

function uint24le(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
}

/**
 * Image dimensions from the container header, before a raster decoder runs.
 *
 * The decoder is the expensive component: a tiny PNG can declare tens of
 * millions of pixels and make the decoder allocate a full RGBA surface before
 * `getSize()` can refuse it. This reads only the four formats Gallery accepts
 * and returns null for a truncated or unknown container.
 */
export function encodedImageSize(bytes: Uint8Array): GalleryImageSize | null {
  if (
    bytes.byteLength >= 24 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    ascii(bytes, 12, 4) === "IHDR"
  ) {
    return { width: uint32be(bytes, 16), height: uint32be(bytes, 20) };
  }

  if (bytes.byteLength >= 10 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) {
    return { width: bytes[6]! | (bytes[7]! << 8), height: bytes[8]! | (bytes[9]! << 8) };
  }

  if (
    bytes.byteLength >= 30 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X" && bytes.byteLength >= 30) {
      return { width: uint24le(bytes, 24) + 1, height: uint24le(bytes, 27) + 1 };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.byteLength >= 25) {
      const width = 1 + ((bytes[21]! | (bytes[22]! << 8)) & 0x3fff);
      const height = 1 + (((bytes[22]! >>> 6) | (bytes[23]! << 2) | (bytes[24]! << 10)) & 0x3fff);
      return { width, height };
    }
    if (
      chunk === "VP8 " &&
      bytes.byteLength >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return {
        width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
        height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
      };
    }
  }

  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 1 < bytes.byteLength) {
      if (bytes[at] !== 0xff) return null;
      while (bytes[at] === 0xff) at += 1;
      const marker = bytes[at++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > bytes.byteLength) return null;
      const size = uint16be(bytes, at);
      if (size < 2 || at + size > bytes.byteLength) return null;
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame) {
        if (size < 7) return null;
        return { width: uint16be(bytes, at + 5), height: uint16be(bytes, at + 3) };
      }
      at += size;
    }
  }
  return null;
}

export function validateImageSize(width: number, height: number): GalleryImageSize {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("The selected file does not contain a decodable image.");
  }
  if (width > MAX_GALLERY_EDGE || height > MAX_GALLERY_EDGE || width * height > MAX_GALLERY_PIXELS) {
    throw new Error(
      `Gallery images may be at most ${String(MAX_GALLERY_EDGE)} pixels on either edge and ${String(MAX_GALLERY_PIXELS)} pixels in total.`,
    );
  }
  return { width, height };
}

export function thumbnailSize(width: number, height: number): GalleryImageSize {
  const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
