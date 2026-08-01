/**
 * Magic-byte MIME sniffing for note attachments (ADR-014 / NOTE-003, SEC-FILE-02):
 * a file's type is determined from its own bytes, never from its name or the
 * renderer's claim — a `.png`-named upload whose content is actually something
 * else sniffs as whatever its bytes really are. Only the formats the
 * attachment pipeline needs to recognize are detected; anything else —
 * including a well-formed but unlisted format — falls back to
 * `application/octet-stream`, which is never treated as renderable markup by
 * the `nx-blob:` protocol (see that module's doc comment).
 *
 * INVARIANT (load-bearing for both blob protocols and ADR-064's preview):
 * nothing this module returns is EVER a markup type — no `text/html`, no
 * `image/svg+xml`, no `application/xml`. `text/plain` (the one text type the
 * heuristic below may add) is inert under the protocols' `nosniff` header, so
 * the worst case anywhere downstream stays an inert download or plain text,
 * never script execution.
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
 * How many leading bytes the text heuristic examines (ADR-064). Bounded so
 * sniffing a 50 MB attachment never walks all of it: a file whose first 4 KiB
 * is clean UTF-8 text is, for the purpose of OFFERING a preview, a text file —
 * and a wrong verdict costs nothing, because `text/plain` under `nosniff` is
 * inert and the preview pane just shows what decodes.
 */
export const TEXT_SNIFF_SCAN_BYTES = 4096;

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/** True for a byte allowed in the ASCII range of a text file: printable, or tab/LF/CR. NUL, ESC, DEL and every other control byte read as binary. */
function isTextAsciiByte(byte: number): boolean {
  if (byte === 0x09 || byte === 0x0a || byte === 0x0d) return true;
  return byte >= 0x20 && byte !== 0x7f;
}

function isContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x80 && byte <= 0xbf;
}

/**
 * The bounded UTF-8-validity heuristic behind the `text/plain` verdict
 * (ADR-064): the first `TEXT_SNIFF_SCAN_BYTES` bytes (after an optional BOM)
 * must be strictly valid UTF-8 — overlong encodings and surrogate halves
 * rejected, exactly what `TextDecoder` would refuse — with no control bytes
 * beyond tab/LF/CR. A multi-byte sequence that starts inside the window is
 * validated in full even when it ends past it (the bound may cut mid-character,
 * the file may not: a sequence cut off by the END OF THE FILE is binary).
 * Runs only after every magic-byte check has missed, so a PNG or a PDF never
 * reaches it.
 */
function isProbablyUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const offset = hasMagic(bytes, UTF8_BOM) ? UTF8_BOM.length : 0;
  const limit = Math.min(bytes.length, offset + TEXT_SNIFF_SCAN_BYTES);
  let i = offset;
  while (i < limit) {
    const byte = bytes[i]!;
    if (byte < 0x80) {
      if (!isTextAsciiByte(byte)) return false;
      i += 1;
      continue;
    }

    // Lead-byte ranges per the UTF-8 definition; the second byte's window is
    // what excludes overlong encodings (E0/F0) and surrogate halves (ED),
    // and caps the code space at U+10FFFF (F4).
    let continuations: number;
    let secondMin = 0x80;
    let secondMax = 0xbf;
    if (byte >= 0xc2 && byte <= 0xdf) {
      continuations = 1;
    } else if (byte === 0xe0) {
      continuations = 2;
      secondMin = 0xa0;
    } else if (byte >= 0xe1 && byte <= 0xec) {
      continuations = 2;
    } else if (byte === 0xed) {
      continuations = 2;
      secondMax = 0x9f;
    } else if (byte === 0xee || byte === 0xef) {
      continuations = 2;
    } else if (byte === 0xf0) {
      continuations = 3;
      secondMin = 0x90;
    } else if (byte >= 0xf1 && byte <= 0xf3) {
      continuations = 3;
    } else if (byte === 0xf4) {
      continuations = 3;
      secondMax = 0x8f;
    } else {
      // 0x80–0xC1 (a stray continuation or an overlong lead) and 0xF5–0xFF.
      return false;
    }

    const second = bytes[i + 1];
    if (second === undefined || second < secondMin || second > secondMax) return false;
    for (let extra = 2; extra <= continuations; extra += 1) {
      if (!isContinuationByte(bytes[i + extra])) return false;
    }
    i += continuations + 1;
  }
  return true;
}

/**
 * Determines a file's MIME type from its magic bytes (SEC-FILE-02) — never
 * from its name. Recognizes png/jpeg/gif/webp/pdf/zip; what none of those
 * magics claim is tried against the bounded UTF-8 text heuristic (ADR-064,
 * `text/plain` — NEVER a markup type, see the module invariant above);
 * anything else, including truncated or empty input, is
 * `application/octet-stream`.
 */
export function sniffMime(bytes: Uint8Array): string {
  if (hasMagic(bytes, PNG_MAGIC)) return "image/png";
  if (hasMagic(bytes, JPEG_MAGIC)) return "image/jpeg";
  if (hasMagic(bytes, GIF87A_MAGIC) || hasMagic(bytes, GIF89A_MAGIC)) return "image/gif";
  if (hasMagic(bytes, RIFF_MAGIC) && hasMagic(bytes, WEBP_MAGIC, 8)) return "image/webp";
  if (hasMagic(bytes, PDF_MAGIC)) return "application/pdf";
  if (hasMagic(bytes, ZIP_LOCAL_MAGIC) || hasMagic(bytes, ZIP_EMPTY_MAGIC)) return "application/zip";
  if (isProbablyUtf8Text(bytes)) return "text/plain";
  return "application/octet-stream";
}

/** The inline-preview allowlist (ADR-014): raster images Chromium decodes safely in its sandboxed renderer. */
export function isInlineImageMime(mime: string): boolean {
  return (INLINE_IMAGE_MIMES as readonly string[]).includes(mime);
}

/**
 * The in-app preview allowlist (DOC / ADR-064): what a stored mime lets the
 * app render itself — an inline raster image (the lightbox), Chromium's own
 * PDF viewer (the dedicated hardened window), or plain text (the text/markdown
 * pane). `isInlineImageMime`'s sibling, and closed the same way: everything
 * else — the zip a DOCX/XLSX/PPTX sniffs as, octet-stream, any markup type —
 * keeps „Otvori" (the OS handler) as its only viewer.
 */
export function isPreviewableMime(mime: string): boolean {
  return isInlineImageMime(mime) || mime === "application/pdf" || mime === "text/plain";
}

/**
 * The coarse buckets „Datoteke" filters by (DOC). Serbian slugs, the way
 * `SMART_LIST_IDS` are: they are ids a filter is expressed in, never copy — the
 * chip labels live in `strings.ts` like every other label in the app.
 */
export const MIME_FAMILIES = ["slika", "pdf", "tekst", "ostalo"] as const;

export type MimeFamily = (typeof MIME_FAMILIES)[number];

/**
 * Which bucket a stored mime falls in. Deliberately wider than
 * `isInlineImageMime`/`isPreviewableMime` above, and the difference is the
 * point: those two answer "may the app RENDER this", while this one answers
 * "what KIND of file is this" — so an `image/avif` nothing here can draw is
 * still a picture to somebody narrowing the page down to their screenshots,
 * and offering it under „Ostalo" would be the surface lying about what it holds.
 *
 * It is the one definition of the four families: `AttachmentIndexStore` filters
 * by the same rule in SQL (`FAMILY_PREDICATES`, pinned against this function by
 * that store's own test), so the chips and the query can never disagree about
 * what a family means. Type-prefix matching is case-SENSITIVE here where the
 * SQL's `LIKE` is not, which costs nothing: every stored mime is lower-case by
 * the attachment stores' own validators.
 */
export function mimeFamily(mime: string): MimeFamily {
  if (mime.startsWith("image/")) return "slika";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "tekst";
  return "ostalo";
}
