import { describe, expect, it } from "vitest";
import {
  isInlineImageMime,
  isPreviewableMime,
  MIME_FAMILIES,
  mimeFamily,
  sniffMime,
  TEXT_SNIFF_SCAN_BYTES,
} from "./sniff.js";

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

  it("never reads a truncated magic prefix as the format it starts", () => {
    // Only the first two of PNG's eight magic bytes are present — and 0x89 is
    // no valid UTF-8 lead byte either, so this is octet-stream all the way.
    expect(sniffMime(bytes(0x89, 0x50))).toBe("application/octet-stream");
    // Only the first three of GIF's six magic bytes are present: not a gif —
    // and since ADR-064's text heuristic sits downstream of every magic check,
    // three bytes of clean ASCII now honestly read as text/plain.
    expect(sniffMime(new Uint8Array(ascii("GIF")))).toBe("text/plain");
  });

  it("sniffs from bytes alone — a .png-named file whose content is actually a zip reports application/zip", () => {
    // sniffMime never takes a file name, so a mismatched extension cannot fool it:
    // this is exactly the zip-content case, independent of whatever name accompanies it.
    expect(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04, 9, 9))).toBe("application/zip");
  });

  it("detects text/plain for ASCII text (ADR-064)", () => {
    expect(sniffMime(new TextEncoder().encode("Zdravo, svete!\nDruga linija.\n"))).toBe(
      "text/plain",
    );
  });

  it("detects text/plain for multi-byte UTF-8 text (š/č/ć/đ)", () => {
    expect(sniffMime(new TextEncoder().encode("Rešenje za Đorđa: čćžšđ — u redu.\n"))).toBe(
      "text/plain",
    );
  });

  it("detects text/plain behind a UTF-8 BOM", () => {
    const body = new TextEncoder().encode("sadržaj sa BOM-om");
    expect(sniffMime(new Uint8Array([0xef, 0xbb, 0xbf, ...body]))).toBe("text/plain");
  });

  it("keeps tab/LF/CR as text but reads any other control byte as binary", () => {
    expect(sniffMime(new TextEncoder().encode("kol 1\tkol 2\r\nkol 3"))).toBe("text/plain");
    // A NUL byte is the classic binary tell; ESC and DEL likewise.
    expect(sniffMime(bytes(0x61, 0x00, 0x62))).toBe("application/octet-stream");
    expect(sniffMime(bytes(0x61, 0x1b, 0x62))).toBe("application/octet-stream");
    expect(sniffMime(bytes(0x61, 0x7f, 0x62))).toBe("application/octet-stream");
  });

  it("reads invalid UTF-8 as binary, not text", () => {
    // A UTF-16LE BOM: bytes no UTF-8 sequence may start with.
    expect(sniffMime(bytes(0xff, 0xfe, 0x61, 0x00))).toBe("application/octet-stream");
    // A bare continuation byte, and an overlong two-byte encoding of "/".
    expect(sniffMime(bytes(0x61, 0x80))).toBe("application/octet-stream");
    expect(sniffMime(bytes(0xc0, 0xaf))).toBe("application/octet-stream");
    // A CESU-8-style surrogate half (ED A0 80) is not valid UTF-8 either.
    expect(sniffMime(bytes(0xed, 0xa0, 0x80))).toBe("application/octet-stream");
  });

  it("reads a multi-byte sequence cut off by the end of the file as binary", () => {
    // "š" is c5 a1; the lead byte alone is a truncated sequence, not text.
    expect(sniffMime(bytes(0x61, 0xc5))).toBe("application/octet-stream");
  });

  it("bounds the text scan — binary garbage past the scan window does not change the verdict", () => {
    const scanned = new Uint8Array(TEXT_SNIFF_SCAN_BYTES + 4).fill(0x61);
    scanned[TEXT_SNIFF_SCAN_BYTES + 1] = 0x00; // a NUL the bounded scan never reaches
    expect(sniffMime(scanned)).toBe("text/plain");
  });

  it("NEVER answers a markup type — HTML-looking bytes are text/plain, not text/html", () => {
    // The stated invariant: nothing sniffMime returns is renderable markup, so
    // the worst case anywhere downstream stays an inert download or plain text.
    expect(sniffMime(new TextEncoder().encode("<!DOCTYPE html><script>alert(1)</script>"))).toBe(
      "text/plain",
    );
    expect(sniffMime(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).toBe("text/plain");
  });

  it("magic bytes still win over the text heuristic — %PDF is a pdf, not text", () => {
    expect(sniffMime(new Uint8Array(ascii("%PDF-1.4 sav od ASCII teksta")))).toBe(
      "application/pdf",
    );
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

describe("isPreviewableMime", () => {
  it("is true for exactly the in-app preview set: the four raster images, pdf, and plain text", () => {
    expect(isPreviewableMime("image/png")).toBe(true);
    expect(isPreviewableMime("image/jpeg")).toBe(true);
    expect(isPreviewableMime("image/gif")).toBe(true);
    expect(isPreviewableMime("image/webp")).toBe(true);
    expect(isPreviewableMime("application/pdf")).toBe(true);
    expect(isPreviewableMime("text/plain")).toBe(true);
  });

  it("is false for everything else — including the zip that a DOCX/XLSX/PPTX sniffs as", () => {
    expect(isPreviewableMime("application/zip")).toBe(false);
    expect(isPreviewableMime("application/octet-stream")).toBe(false);
    expect(isPreviewableMime("image/svg+xml")).toBe(false);
    expect(isPreviewableMime("text/html")).toBe(false);
    expect(isPreviewableMime("text/markdown")).toBe(false);
  });
});

describe("mimeFamily", () => {
  it("families every mime the sniffer can return, so the browse filter covers its own corpus", () => {
    expect(mimeFamily("image/png")).toBe("slika");
    expect(mimeFamily("image/jpeg")).toBe("slika");
    expect(mimeFamily("image/gif")).toBe("slika");
    expect(mimeFamily("image/webp")).toBe("slika");
    expect(mimeFamily("application/pdf")).toBe("pdf");
    expect(mimeFamily("text/plain")).toBe("tekst");
    expect(mimeFamily("application/zip")).toBe("ostalo");
    expect(mimeFamily("application/octet-stream")).toBe("ostalo");
  });

  it("families by TYPE rather than by an allowlist, so a mime the sniffer never returns still lands somewhere", () => {
    // Deliberately wider than `isInlineImageMime`: somebody filtering „Slike"
    // means pictures, and a raster this build cannot render inline is still
    // one. What the row may DO with it stays that predicate's decision.
    expect(mimeFamily("image/svg+xml")).toBe("slika");
    expect(mimeFamily("image/avif")).toBe("slika");
    expect(mimeFamily("text/markdown")).toBe("tekst");
    expect(mimeFamily("text/html")).toBe("tekst");
    expect(mimeFamily("audio/mpeg")).toBe("ostalo");
    expect(mimeFamily("")).toBe("ostalo");
  });

  it("answers with a member of MIME_FAMILIES and nothing else", () => {
    for (const mime of ["image/png", "application/pdf", "text/plain", "video/mp4", "x/y"]) {
      expect(MIME_FAMILIES, mime).toContain(mimeFamily(mime));
    }
  });
});
