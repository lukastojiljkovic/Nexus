import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import {
  normalizeRotation,
  pageNumberText,
  type PageNumberFormat,
  type PageNumberPosition,
} from "@nexus/core";

/**
 * The PDF work, in pdf-lib terms: open a document, read what is in it, and write
 * a new one.
 *
 * **Every operation is `source bytes -> new bytes`.** Nothing here mutates a
 * document the caller holds, and nothing here keeps state between calls: the
 * page decides WHAT to write, this module writes it, and the two meet at the
 * function signatures. That is what makes all of it testable without a renderer:
 * `operations.test.ts` generates its own PDFs, merges and splits them, and reads
 * the `/Rotate` back off the output with the same library.
 *
 * **Why the refusal is a class and not a thrown string.** An encrypted PDF is
 * not a broken file, and the page has to say something different about it: "this
 * file is protected, and this tool does not try to open it" is an answer the
 * user needs, where "could not be read" would send them looking for a corrupt
 * file. So a password-protected document becomes a `PdfRefusal` with the reason
 * `"encrypted"` and everything else `"unreadable"`, and the page words each one.
 *
 * **What pdf-lib does not have, and therefore what these tools do not claim.**
 * There is no rasteriser here, so a page tile is a to-scale outline with its
 * number and size rather than a picture of the page - the honest version of a
 * thumbnail for a library that parses documents instead of drawing them.
 */

/** One PDF the tools hold: the name main derived for it, and its bytes. */
export interface PdfSource {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** One page's geometry, as the tile grid draws it. */
export interface PdfPageInfo {
  /** Width in PDF points (1/72 inch), before rotation. */
  readonly width: number;
  /** Height in PDF points, before rotation. */
  readonly height: number;
  /** The page's own `/Rotate`, in degrees clockwise: 0, 90, 180 or 270. */
  readonly rotation: number;
}

/** What a document is, for a page that has to show a grid of what it holds. */
export interface PdfDocumentInfo {
  readonly pageCount: number;
  readonly pages: readonly PdfPageInfo[];
}

/** One file a split produced. */
export interface PdfOutput {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Why a PDF could not be worked on. */
export type PdfRefusalReason = "encrypted" | "unreadable";

/** A document this module will not open, with the reason the page prints. */
export class PdfRefusal extends Error {
  readonly reason: PdfRefusalReason;

  constructor(reason: PdfRefusalReason, message: string) {
    super(message);
    this.name = "PdfRefusal";
    this.reason = reason;
  }
}

/** How far along a long job is, in the unit the job is measured in (files, or pages). */
export type PdfProgress = (done: number, total: number) => void;

/**
 * Opens one document, or refuses it by name.
 *
 * `throwOnInvalidObject: true` is the difference between "the file has one
 * damaged object" and "the file parsed": pdf-lib's default is to warn and carry
 * on, which would hand a half-read document to a merge and produce a file whose
 * missing object nobody can trace back to its source. A refusal here names the
 * file; a silent repair would name nothing.
 *
 * **Encryption is read, never broken.** Loading with `ignoreEncryption: true`
 * gets past pdf-lib's own refusal so the trailer can be read, and
 * `document.isEncrypted` is then the library's public answer to the only
 * question this tool set asks: is this file locked? It is asked and answered
 * before a page is touched, and a locked file is refused — nothing here
 * decrypts, guesses a password or writes anything. The alternative, catching
 * `EncryptedPDFError`, was measured and is not usable: on pdf-lib 1.17.1 the
 * error `load` throws for this case is a plain `Error`, so `instanceof` never
 * matches and every locked file would be reported as a corrupt one.
 */
export async function openPdf(bytes: Uint8Array): Promise<PDFDocument> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: true,
    });
  } catch (error) {
    throw new PdfRefusal(
      "unreadable",
      `This file could not be read as a PDF: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (document.isEncrypted) {
    throw new PdfRefusal("encrypted", "This PDF is password-protected.");
  }
  return document;
}

/** The page count, every page's size, and every page's current rotation. */
export async function readPdfInfo(source: PdfSource): Promise<PdfDocumentInfo> {
  const document = await openPdf(source.bytes);
  const pages: PdfPageInfo[] = document.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width, height, rotation: normalizeRotation(page.getRotation().angle) };
  });
  return { pageCount: pages.length, pages };
}

/** Every page index of a document, in order. */
function allPages(document: PDFDocument): number[] {
  return Array.from({ length: document.getPageCount() }, (_, index) => index);
}

/** Writes a document out with object streams on - pdf-lib's own default, stated so it is a decision rather than an accident. */
async function save(document: PDFDocument): Promise<Uint8Array> {
  return await document.save({ useObjectStreams: true });
}

/**
 * The files merged into one document, in the order they are given.
 *
 * Sources are opened, copied and released one at a time rather than all at
 * once, so a batch of twenty files holds one parsed source plus the growing
 * result instead of twenty parsed sources beside it. That is also why progress
 * is counted in FILES: the pages of a source that has not been opened yet are
 * not known, and a total invented for a progress bar would be a number this app
 * made up.
 */
export async function mergePdfs(
  sources: readonly PdfSource[],
  progress?: PdfProgress,
): Promise<Uint8Array> {
  if (sources.length === 0) {
    throw new PdfRefusal("unreadable", "There is nothing to merge.");
  }
  const merged = await PDFDocument.create();
  let done = 0;
  for (const source of sources) {
    const document = await openPdf(source.bytes);
    const pages = await merged.copyPages(document, allPages(document));
    for (const page of pages) merged.addPage(page);
    done += 1;
    progress?.(done, sources.length);
  }
  return await save(merged);
}

/**
 * The pages named by `order`, in that order, as a new document.
 *
 * This is extract, reorder and delete in one function, because they are one
 * operation on a page order: `order` is 0-based indices into the source, a page
 * left out is a deleted page, and a page named first is a page that moved. The
 * indices are checked here rather than trusted - a caller that computed them
 * from a page count it read a moment ago can be one short after a delete, and
 * pdf-lib would answer that with a copy of nothing.
 */
export async function arrangePages(
  source: PdfSource,
  order: readonly number[],
  progress?: PdfProgress,
): Promise<Uint8Array> {
  const document = await openPdf(source.bytes);
  const pageCount = document.getPageCount();
  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
      throw new PdfRefusal("unreadable", `Page ${index + 1} is not in this document.`);
    }
  }
  if (order.length === 0) {
    throw new PdfRefusal("unreadable", "A PDF must keep at least one page.");
  }
  const arranged = await PDFDocument.create();
  const pages = await arranged.copyPages(document, [...order]);
  pages.forEach((page, index) => {
    arranged.addPage(page);
    progress?.(index + 1, pages.length);
  });
  return await save(arranged);
}

/**
 * The document with each page turned by `turns[i]` degrees, clockwise.
 *
 * The turn is ADDED to the page's own `/Rotate` rather than set: a page that
 * arrived at 90 degrees from a scanner is at 180 after one turn of the button,
 * which is what the user watching the tile expects. `turns` must name a turn
 * for every page, and a shorter or longer list is a bug in the caller rather
 * than a document.
 */
export async function rotatePdfPages(
  source: PdfSource,
  turns: readonly number[],
  progress?: PdfProgress,
): Promise<Uint8Array> {
  const document = await openPdf(source.bytes);
  const pages = document.getPages();
  if (turns.length !== pages.length) {
    throw new PdfRefusal("unreadable", "A rotation plan must name every page of the document.");
  }
  pages.forEach((page, index) => {
    const turn = turns[index] ?? 0;
    page.setRotation(degrees(normalizeRotation(page.getRotation().angle + turn)));
    progress?.(index + 1, pages.length);
  });
  return await save(document);
}

/** Half an inch, in points: how far a page number sits from the edge of the page. */
export const PAGE_NUMBER_MARGIN_POINTS = 36;

/** The size, in points, a page number is set in. */
export const PAGE_NUMBER_SIZE_POINTS = 10;

/**
 * The document with a number drawn at the foot of every page.
 *
 * The font is `StandardFonts.Helvetica`, one of the fourteen fonts a PDF reader
 * is required to have. Measured on pdf-lib 1.17.1, that means no font file
 * travels in the output at all: `embedFont`'s `subset` option is read only for a
 * font whose bytes the caller supplies, and a standard font is referenced by
 * name instead, under a generated alias like `/Helvetica-7098480789`. The
 * measurement: a 12-page A4 document was 675 bytes before numbering and 2 922
 * after — 2 247 bytes for twelve pages, no `FontFile` object in the file — which
 * is the whole reason a base-14 font is the right choice here rather than a
 * bundled one.
 *
 * The number is digits and a slash, and that is what makes the WinAnsi encoding
 * safe: pdf-lib writes the text as a hex string of those bytes
 * (`<31202F2032> Tj` is `1 / 2`), which every reader extracts as text, where a
 * letter like `c with a caron` is not in the encoding at all. That is why
 * `pageNumberText` is the only thing allowed to write the string.
 *
 * Both positions are measured with the string's own width, so "bottom-right" is
 * flush to the margin rather than to a number of characters - a difference that
 * is invisible on page 9 and obvious on page 100.
 */
export async function stampPageNumbers(
  source: PdfSource,
  format: PageNumberFormat,
  position: PageNumberPosition,
  progress?: PdfProgress,
): Promise<Uint8Array> {
  const document = await openPdf(source.bytes);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = document.getPages();
  pages.forEach((page, index) => {
    const text = pageNumberText(format, index + 1, pages.length);
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, PAGE_NUMBER_SIZE_POINTS);
    const x =
      position === "bottom-centre"
        ? Math.max(0, (width - textWidth) / 2)
        : Math.max(0, width - textWidth - PAGE_NUMBER_MARGIN_POINTS);
    // The baseline is half an inch up, or the page's middle for a page shorter
    // than an inch - a strip of paper still gets a number on it.
    const y = Math.min(PAGE_NUMBER_MARGIN_POINTS, Math.max(0, height / 2));
    page.drawText(text, { x, y, size: PAGE_NUMBER_SIZE_POINTS, font });
    progress?.(index + 1, pages.length);
  });
  return await save(document);
}

/**
 * The name one part of a split gets: the source's base name and the page or the
 * page range it holds - `ugovor-1-3.pdf`, `ugovor-5.pdf`.
 *
 * A part is always a contiguous run, because the grammar splits the expression
 * on commas and each piece is a range: `1-3,5,8-` is three parts, and `1,3` is
 * two. That is what lets the name be the two end pages and nothing vaguer.
 */
export function splitPartName(name: string, pages: readonly number[]): string {
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (first === undefined || last === undefined) return name;
  const extension = name.toLowerCase().endsWith(".pdf") ? name.slice(-4) : ".pdf";
  const base = name.toLowerCase().endsWith(".pdf") ? name.slice(0, -4) : name;
  const suffix = pages.length === 1 ? `${first}` : `${first}-${last}`;
  return `${base}-${suffix}${extension}`;
}

/**
 * One file per part, each holding that part's pages in order.
 *
 * The document is opened once and every part is copied out of it, which is the
 * difference between splitting a hundred-page file and opening it once per
 * part. Progress is counted in PARTS, so the page shows "3/12" for a split into
 * twelve files rather than a count of pages the reader did not ask about.
 */
export async function splitPdf(
  source: PdfSource,
  parts: readonly (readonly number[])[],
  progress?: PdfProgress,
): Promise<readonly PdfOutput[]> {
  const document = await openPdf(source.bytes);
  const pageCount = document.getPageCount();
  const outputs: PdfOutput[] = [];
  for (const part of parts) {
    for (const page of part) {
      if (!Number.isInteger(page) || page < 1 || page > pageCount) {
        throw new PdfRefusal("unreadable", `Page ${page} is not in this document.`);
      }
    }
    const partDocument = await PDFDocument.create();
    const copied = await partDocument.copyPages(
      document,
      part.map((page) => page - 1),
    );
    for (const page of copied) partDocument.addPage(page);
    outputs.push({
      name: splitPartName(source.name, part),
      bytes: await save(partDocument),
    });
    progress?.(outputs.length, parts.length);
  }
  return outputs;
}
