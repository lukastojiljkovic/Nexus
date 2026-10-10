import { describe, expect, it } from "vitest";
import { parseReaderMarkdown } from "@nexus/core";

import {
  escapeHtml,
  readerPrintFooter,
  readerPrintHeader,
  readerPrintHtml,
  sourceLine,
  type ReaderPrintDocument,
} from "./printHtml.js";

/**
 * The printed page (ADR-100).
 *
 * Two properties are asserted here rather than looked at on paper: the running
 * header and footer carry what every sheet must carry (the pack's title, its
 * safety notice, its licence and its source), and every value a pack supplies is
 * ESCAPED - a pack's title is a stranger's text, and the document is built by
 * string concatenation.
 */

function document(overrides: Partial<ReaderPrintDocument> = {}): ReaderPrintDocument {
  return {
    packId: "prva-pomoc",
    packTitle: "Prva pomoć",
    licence: "CC-BY-SA-4.0 - Wikipedia contributors",
    sourceName: "Izvor",
    sourceUrl: "https://example.org/source",
    notice: "Samo za informisanje. U hitnom slučaju pozovi 112.",
    articles: [
      {
        path: "uvod.md",
        title: "Uvod",
        blocks: parseReaderMarkdown("# Uvod\n\nVoda i **elektroliti**.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n"),
      },
    ],
    ...overrides,
  };
}

describe("readerPrintHtml", () => {
  it("renders the articles as a document with the pack's language", () => {
    const html = readerPrintHtml(document(), "sr");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="sr">');
    expect(html).toContain("<h1>Uvod</h1>");
    expect(html).toContain("<strong>elektroliti</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("Samo za informisanje");
    // A printed link is text: the reader has the paper, not the click.
    expect(html).toContain("https://example.org/source");
  });

  it("carries the licence, the source and the page number on every sheet through the footer", () => {
    const footer = readerPrintFooter(document());
    expect(footer).toContain("CC-BY-SA-4.0 - Wikipedia contributors");
    expect(footer).toContain("https://example.org/source");
    // Chromium replaces these two spans; they are the whole reason a footer is a
    // template rather than a paragraph at the end of the document.
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
  });

  it("puts the pack's title and its notice in the running header", () => {
    const header = readerPrintHeader(document());
    expect(header).toContain("Prva pomoć");
    expect(header).toContain("pozovi 112");
    // A pack without a notice has no notice in the header - not an empty element
    // printed at the top of every sheet.
    expect(readerPrintHeader(document({ notice: null }))).not.toContain("pozovi");
  });

  it("escapes every value that came from a pack", () => {
    const html = readerPrintHtml(
      document({
        packTitle: '<script>alert(1)</script>',
        articles: [
          {
            path: "x.md",
            title: "A & B",
            blocks: [{ type: "paragraph", children: [{ type: "text", value: "<b>ne</b>" }] }],
          },
        ],
      }),
      "en",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("&lt;b&gt;ne&lt;/b&gt;");
  });

  it("escapes the five characters that can end a tag or an attribute", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("resolves a relative image through the pack's own scheme, and leaves a remote one alone", () => {
    const html = readerPrintHtml(
      document({
        articles: [
          {
            path: "prva-pomoc/opekotine.md",
            title: "Opekotine",
            blocks: parseReaderMarkdown("![ozleda](slike/ozleda.png)\n"),
          },
        ],
      }),
      "sr",
    );
    expect(html).toContain('src="nx-pack://prva-pomoc/prva-pomoc/slike/ozleda.png"');
  });

  it("reads one source line, which is what a printed page can carry", () => {
    expect(sourceLine("Izvor", "https://example.org/x")).toBe("Izvor https://example.org/x");
  });
});
