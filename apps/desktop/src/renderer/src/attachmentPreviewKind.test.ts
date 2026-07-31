import { describe, expect, it } from "vitest";
import { DOC_TEXT_PREVIEW_MAX_BYTES } from "../../shared/ipc.js";
import { attachmentPreviewKind } from "./attachmentPreviewKind.js";

describe("attachmentPreviewKind", () => {
  it("reads the four inline raster mimes as the image lightbox", () => {
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(attachmentPreviewKind(mime, "slika.bin", 1024)).toBe("image");
    }
  });

  it("reads application/pdf as the dedicated-window kind, whatever the name", () => {
    expect(attachmentPreviewKind("application/pdf", "skripta.pdf", 1024)).toBe("pdf");
    expect(attachmentPreviewKind("application/pdf", "bez-ekstenzije", 1024)).toBe("pdf");
  });

  it("splits a text/plain row into text vs markdown by its extension alone", () => {
    expect(attachmentPreviewKind("text/plain", "beleska.txt", 1024)).toBe("text");
    expect(attachmentPreviewKind("text/plain", "README.md", 1024)).toBe("markdown");
    expect(attachmentPreviewKind("text/plain", "BELESKA.MD", 1024)).toBe("markdown");
    // The sniff already read the bytes, so any other name still previews as text.
    expect(attachmentPreviewKind("text/plain", "podaci.csv", 1024)).toBe("text");
    expect(attachmentPreviewKind("text/plain", "bez-ekstenzije", 1024)).toBe("text");
  });

  it("offers octet-stream rows (stored before the text sniff) on the .txt/.md extension reading only", () => {
    expect(attachmentPreviewKind("application/octet-stream", "stara-beleska.txt", 1024)).toBe(
      "text",
    );
    expect(attachmentPreviewKind("application/octet-stream", "stara-beleska.md", 1024)).toBe(
      "markdown",
    );
    expect(attachmentPreviewKind("application/octet-stream", "program.exe", 1024)).toBeNull();
    expect(attachmentPreviewKind("application/octet-stream", "bez-ekstenzije", 1024)).toBeNull();
  });

  it("does not offer a text preview past the doc:read-text cap — the row keeps Otvori/Sačuvaj kao", () => {
    expect(attachmentPreviewKind("text/plain", "veliki.txt", DOC_TEXT_PREVIEW_MAX_BYTES)).toBe(
      "text",
    );
    expect(
      attachmentPreviewKind("text/plain", "veliki.txt", DOC_TEXT_PREVIEW_MAX_BYTES + 1),
    ).toBeNull();
    expect(
      attachmentPreviewKind("application/octet-stream", "veliki.md", DOC_TEXT_PREVIEW_MAX_BYTES + 1),
    ).toBeNull();
    // The cap is the TEXT channel's, not the preview's: images and PDFs never
    // cross doc:read-text, so their size does not gate the offer.
    expect(
      attachmentPreviewKind("application/pdf", "veliki.pdf", DOC_TEXT_PREVIEW_MAX_BYTES + 1),
    ).toBe("pdf");
    expect(
      attachmentPreviewKind("image/png", "velika.png", DOC_TEXT_PREVIEW_MAX_BYTES + 1),
    ).toBe("image");
  });

  it("offers nothing for every other mime — DOCX/XLSX/PPTX sniff as zip and stay external-only by name", () => {
    expect(attachmentPreviewKind("application/zip", "dokument.docx", 1024)).toBeNull();
    expect(attachmentPreviewKind("application/zip", "dokument.txt", 1024)).toBeNull();
    expect(attachmentPreviewKind("image/svg+xml", "slika.svg", 1024)).toBeNull();
    expect(attachmentPreviewKind("text/html", "stranica.html", 1024)).toBeNull();
  });
});
