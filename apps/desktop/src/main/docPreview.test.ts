import { describe, expect, it } from "vitest";
import { sniffMime } from "@nexus/core";
import {
  decodePreviewText,
  isAllowedPreviewNavigation,
  isTextPreviewAttachment,
  minimalPdfBytes,
} from "./docPreview.js";

describe("isTextPreviewAttachment", () => {
  it("accepts a text/plain row whatever its name — the sniff already decided", () => {
    expect(isTextPreviewAttachment("text/plain", "beleska.txt")).toBe(true);
    expect(isTextPreviewAttachment("text/plain", "README.md")).toBe(true);
    expect(isTextPreviewAttachment("text/plain", "podaci.csv")).toBe(true);
    expect(isTextPreviewAttachment("text/plain", "bez-ekstenzije")).toBe(true);
  });

  it("accepts an application/octet-stream row only on the .txt/.md extension reading (rows stored before the text sniff)", () => {
    expect(isTextPreviewAttachment("application/octet-stream", "beleska.txt")).toBe(true);
    expect(isTextPreviewAttachment("application/octet-stream", "README.md")).toBe(true);
    expect(isTextPreviewAttachment("application/octet-stream", "BELESKA.TXT")).toBe(true);
    expect(isTextPreviewAttachment("application/octet-stream", "program.exe")).toBe(false);
    expect(isTextPreviewAttachment("application/octet-stream", "bez-ekstenzije")).toBe(false);
  });

  it("refuses every other stored mime by name — an extension never overrides a sniffed type", () => {
    expect(isTextPreviewAttachment("application/pdf", "dokument.txt")).toBe(false);
    expect(isTextPreviewAttachment("application/zip", "arhiva.md")).toBe(false);
    expect(isTextPreviewAttachment("image/png", "slika.txt")).toBe(false);
    expect(isTextPreviewAttachment("text/html", "stranica.txt")).toBe(false);
  });
});

describe("decodePreviewText", () => {
  it("decodes UTF-8, diacritics included", () => {
    const bytes = new TextEncoder().encode("Rešenje za Đorđa: čćžšđ");
    expect(decodePreviewText(bytes)).toBe("Rešenje za Đorđa: čćžšđ");
  });

  it("strips a leading BOM", () => {
    const body = new TextEncoder().encode("sadržaj");
    expect(decodePreviewText(new Uint8Array([0xef, 0xbb, 0xbf, ...body]))).toBe("sadržaj");
  });

  it("keeps a BOM that is not leading — only the byte-order mark is stripped", () => {
    const bytes = new TextEncoder().encode("a\ufeffb");
    expect(decodePreviewText(bytes)).toBe("a\ufeffb");
  });
});

describe("isAllowedPreviewNavigation", () => {
  const blobUrl = `nx-blob://${"a".repeat(64)}`;

  it("allows exactly the URL the window was opened with, with or without Chromium's trailing slash", () => {
    expect(isAllowedPreviewNavigation(blobUrl, blobUrl)).toBe(true);
    expect(isAllowedPreviewNavigation(blobUrl, `${blobUrl}/`)).toBe(true);
  });

  it("blocks every other destination — another hash, another scheme, anything appended", () => {
    expect(isAllowedPreviewNavigation(blobUrl, `nx-blob://${"b".repeat(64)}`)).toBe(false);
    expect(isAllowedPreviewNavigation(blobUrl, "https://example.com/")).toBe(false);
    expect(isAllowedPreviewNavigation(blobUrl, `${blobUrl}/anything`)).toBe(false);
    expect(isAllowedPreviewNavigation(blobUrl, "about:blank")).toBe(false);
  });
});

describe("minimalPdfBytes", () => {
  it("sniffs as application/pdf — the fixture goes through the real attachment path, and the sniff is its first gate", () => {
    expect(sniffMime(minimalPdfBytes())).toBe("application/pdf");
  });

  it("is a structurally complete document: header, three objects, xref and trailer all present", () => {
    const text = new TextDecoder().decode(minimalPdfBytes());
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Type /Pages");
    expect(text).toContain("/Type /Page ");
    expect(text).toContain("xref\n0 4\n");
    expect(text).toContain("trailer\n<< /Size 4 /Root 1 0 R >>");
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });

  it("computes real xref offsets — each entry points at the object it numbers", () => {
    const text = new TextDecoder().decode(minimalPdfBytes());
    const entries = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) =>
      Number(match[1]),
    );
    expect(entries).toHaveLength(3);
    entries.forEach((offset, index) => {
      expect(text.slice(offset, offset + 8)).toBe(`${index + 1} 0 obj\n`);
    });
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 5)).toBe("xref\n");
  });
});
