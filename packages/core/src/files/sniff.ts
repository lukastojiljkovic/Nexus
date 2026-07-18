/**
 * Magic-byte MIME sniffing for note attachments (ADR-014 / NOTE-003, SEC-FILE-02):
 * a file's type is determined from its own bytes, never from its name or the
 * renderer's claim — a `.png`-named upload whose content is actually something
 * else sniffs as whatever its bytes really are. Only the formats the
 * attachment pipeline needs to recognize are detected; anything else —
 * including a well-formed but unlisted format — falls back to
 * `application/octet-stream`, which is never treated as renderable markup by
 * the `nx-blob:` protocol (see that module's doc comment).
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF87A_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
const ZIP_LOCAL_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY_MAGIC = [0x50, 0x4b, 0x05, 0x06];

/** The four raster formats `isInlineImageMime` allows (module-private; iterated only there). */
const INLINE_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

function hasMagic(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((byte, i) => bytes[offset + i] === byte);
}

/**
 * Determines a file's MIME type from its magic bytes (SEC-FILE-02) — never
 * from its name. Recognizes png/jpeg/gif/webp/pdf/zip; anything else,
 * including truncated or empty input, is `application/octet-stream`.
 */
export function sniffMime(bytes: Uint8Array): string {
  if (hasMagic(bytes, PNG_MAGIC)) return "image/png";
  if (hasMagic(bytes, JPEG_MAGIC)) return "image/jpeg";
  if (hasMagic(bytes, GIF87A_MAGIC) || hasMagic(bytes, GIF89A_MAGIC)) return "image/gif";
  if (hasMagic(bytes, RIFF_MAGIC) && hasMagic(bytes, WEBP_MAGIC, 8)) return "image/webp";
  if (hasMagic(bytes, PDF_MAGIC)) return "application/pdf";
  if (hasMagic(bytes, ZIP_LOCAL_MAGIC) || hasMagic(bytes, ZIP_EMPTY_MAGIC)) return "application/zip";
  return "application/octet-stream";
}

/** The inline-preview allowlist (ADR-014): raster images Chromium decodes safely in its sandboxed renderer. */
export function isInlineImageMime(mime: string): boolean {
  return (INLINE_IMAGE_MIMES as readonly string[]).includes(mime);
}
