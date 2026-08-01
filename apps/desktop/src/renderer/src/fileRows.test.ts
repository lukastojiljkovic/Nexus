import { describe, expect, it } from "vitest";
import type { DocAttachmentEntry } from "../../shared/ipc.js";

import { fileExtensionMark, formatFileSize, totalFileBytes } from "./fileRows.js";

function entry(sizeBytes: number): DocAttachmentEntry {
  return {
    id: "a",
    ownerKind: "note",
    ownerId: "n",
    ownerTitle: "Beleška",
    fileName: "a.pdf",
    mime: "application/pdf",
    sizeBytes,
    sha256: "a".repeat(64),
    createdAt: "2026-07-30T10:00:00.000Z",
  };
}

describe("formatFileSize", () => {
  it("keeps whole bytes under a kilobyte", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1)).toBe("1 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("switches to KB and then MB, at one decimal and with the Serbian decimal comma", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1,5 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
    expect(formatFileSize(1024 * 1024 * 2.25)).toBe("2,3 MB");
  });
});

describe("totalFileBytes", () => {
  it("is zero for nothing, and the sum of exactly what it was given", () => {
    expect(totalFileBytes([])).toBe(0);
    expect(totalFileBytes([entry(100), entry(200), entry(1)])).toBe(301);
  });
});

describe("fileExtensionMark", () => {
  it("uppercases the extension the NAME carries, whatever the file sniffed as", () => {
    expect(fileExtensionMark("skripta.pdf")).toBe("PDF");
    expect(fileExtensionMark("Ugovor.DocX")).toBe("DOCX");
    expect(fileExtensionMark("arhiva.tar.gz")).toBe("GZ");
    expect(fileExtensionMark("snimak.mp3")).toBe("MP3");
  });

  it("shows nothing where there is no extension to show", () => {
    expect(fileExtensionMark("bez-ekstenzije")).toBeNull();
    expect(fileExtensionMark("zavrsava-tackom.")).toBeNull();
    // A dotfile has a hidden NAME, not an extension.
    expect(fileExtensionMark(".gitignore")).toBeNull();
    expect(fileExtensionMark("")).toBeNull();
  });

  it("refuses a tail that is not plainly a type mark", () => {
    expect(fileExtensionMark("beleska.dokument")).toBeNull();
    expect(fileExtensionMark("cena.100 din")).toBeNull();
    expect(fileExtensionMark("naziv.pdf ")).toBeNull();
  });
});
