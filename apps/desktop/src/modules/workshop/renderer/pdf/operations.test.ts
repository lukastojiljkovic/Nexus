import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  arrangePages,
  mergePdfs,
  readPdfInfo,
  rotatePdfPages,
  splitPdf,
  splitPartName,
  stampPageNumbers,
  type PdfSource,
} from "./operations.js";

/**
 * The PDF operations, against documents generated in the test.
 *
 * **The oracle is the page's own width.** `generatedPdf(name, count, base)`
 * writes page `i` as `(base + i) x 200` points, so a document's page identity
 * travels with the page through a copy, a merge, a split and a rotation — and
 * every expectation below is a width or a `/Rotate` read back out of the OUTPUT
 * with pdf-lib, which is a different code path from the one that wrote it.
 * "The merge produced five pages" would pass on a merge that shuffled them.
 */

/** A PDF whose page `i` is `(base + i) x 200` points. */
async function generatedPdf(base: number, pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([base + index, 200]);
  }
  return await document.save();
}

/** The widths of every page of a saved document, in order. */
async function widthsOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getSize().width);
}

/** The `/Rotate` of every page of a saved document, in order. */
async function rotationsOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getRotation().angle);
}

/**
 * The bytes a stream carries, inflated when pdf-lib wrote it Flate-compressed.
 *
 * pdf-lib's own `getContentsString` answers the RAW bytes, so a saved content
 * stream comes back as zlib-compressed noise. The `0x78` first byte is the zlib
 * header (RFC 1950 §2.2), and a stream without it is already the text. The web
 * platform's own decompressor does the work: it is available in Node 24 and it
 * needs no dependency the renderer project does not already type.
 */
async function streamText(node: unknown): Promise<string> {
  const stream = node as { getContents?: () => Uint8Array } | null | undefined;
  if (stream === null || stream === undefined || typeof stream.getContents !== "function") {
    return "";
  }
  const raw = stream.getContents();
  if (raw.length < 2 || raw[0] !== 0x78) return new TextDecoder("latin1").decode(raw);
  const piped = new Blob([Uint8Array.from(raw)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new TextDecoder("latin1").decode(new Uint8Array(await new Response(piped).arrayBuffer()));
}

/**
 * Everything a page's content streams say, decoded — where a drawn number can be
 * read back.
 *
 * Read by shape rather than by `instanceof`, because a page's `/Contents` is
 * either a stream or an array of REFERENCES to streams, and pdf-lib's own
 * `context.lookup` is what resolves either. A class check on the elements would
 * also be the one assertion in this file that depends on which build of pdf-lib
 * the test and the code under test each resolved to.
 */
async function pageContent(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const document = await PDFDocument.load(bytes);
  const page = document.getPages()[pageIndex];
  if (page === undefined) return "";
  const contents = page.node.Contents();
  if (contents === undefined) return "";
  const nodes = "asArray" in contents ? contents.asArray() : [contents];
  const texts = await Promise.all(nodes.map((node) => streamText(document.context.lookup(node))));
  return texts.join("");
}

/**
 * Every string a content stream shows with `Tj`, decoded.
 *
 * pdf-lib writes text as a hex string of WinAnsi bytes (`<31202F2032> Tj` for
 * `1 / 2`), so an assertion on the raw stream would be an assertion about pdf-lib's
 * spelling rather than about what the reader sees. Both spellings a PDF allows
 * are read here; the plain one is what a hand-written or differently-encoded
 * stream would carry.
 */
function drawnTexts(content: string): string[] {
  const texts: string[] = [];
  for (const match of content.matchAll(/(?:\(([^)]*)\)|<([0-9A-Fa-f]*)>)\s*Tj/g)) {
    const literal = match[1];
    const hex = match[2];
    if (literal !== undefined) {
      texts.push(literal);
      continue;
    }
    if (hex === undefined) continue;
    let text = "";
    for (let at = 0; at + 1 < hex.length; at += 2) {
      text += String.fromCharCode(Number.parseInt(hex.slice(at, at + 2), 16));
    }
    texts.push(text);
  }
  return texts;
}

/**
 * A PDF every reader must treat as encrypted: pdf-lib's own trailer, with an
 * `/Encrypt` entry pointing at a security-handler dictionary the library
 * registered itself.
 *
 * Built through `PDFContext` rather than by splicing bytes into a saved file,
 * because the trailer is exactly where a reader looks and a hand-inserted
 * `/Encrypt` would have to keep the xref table's offsets true as well. Nothing
 * ever decrypts this: `PDFDocument.load` refuses it on the trailer entry alone,
 * which is the behaviour under test.
 */
async function encryptedPdf(name: string): Promise<PdfSource> {
  const document = await PDFDocument.create();
  document.addPage([100, 200]);
  const handler = document.context.obj({
    Filter: "Standard",
    V: 1,
    R: 2,
    O: "owner-password-placeholder",
    U: "user-password-placeholder",
    P: -1,
  });
  document.context.trailerInfo.Encrypt = document.context.register(handler);
  return { name, bytes: await document.save() };
}

describe("readPdfInfo", () => {
  it("reports the page count, every page's size and its rotation", async () => {
    const source: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 3) };
    const info = await readPdfInfo(source);
    expect(info.pageCount).toBe(3);
    expect(info.pages.map((page) => page.width)).toEqual([100, 101, 102]);
    expect(info.pages.map((page) => page.height)).toEqual([200, 200, 200]);
    expect(info.pages.map((page) => page.rotation)).toEqual([0, 0, 0]);
  });

  it("refuses bytes that are not a PDF, and refuses a password-protected one by reason", async () => {
    await expect(readPdfInfo({ name: "x.pdf", bytes: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject(
      { reason: "unreadable" },
    );
    await expect(readPdfInfo(await encryptedPdf("locked.pdf"))).rejects.toMatchObject({
      reason: "encrypted",
    });
  });
});

describe("mergePdfs", () => {
  it("keeps every page and the order the files were given in", async () => {
    const first: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 2) };
    const second: PdfSource = { name: "b.pdf", bytes: await generatedPdf(200, 3) };
    const merged = await mergePdfs([first, second]);
    expect(await widthsOf(merged)).toEqual([100, 101, 200, 201, 202]);
    expect(await widthsOf(await mergePdfs([second, first]))).toEqual([200, 201, 202, 100, 101]);
  });

  it("reports its progress per file", async () => {
    const steps: string[] = [];
    const first: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 1) };
    const second: PdfSource = { name: "b.pdf", bytes: await generatedPdf(200, 1) };
    await mergePdfs([first, second], (done, total) => steps.push(`${done}/${total}`));
    expect(steps).toEqual(["1/2", "2/2"]);
  });
});

describe("arrangePages", () => {
  it("reorders pages, and a page left out is a deleted page", async () => {
    const source: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 4) };
    expect(await widthsOf(await arrangePages(source, [3, 1, 0]))).toEqual([103, 101, 100]);
    expect(await widthsOf(await arrangePages(source, [2]))).toEqual([102]);
  });

  it("refuses a page index that is not in the document, and an empty order", async () => {
    const source: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 2) };
    await expect(arrangePages(source, [0, 2])).rejects.toMatchObject({ reason: "unreadable" });
    await expect(arrangePages(source, [])).rejects.toMatchObject({ reason: "unreadable" });
  });
});

describe("rotatePdfPages", () => {
  it("writes the turn into the page's own /Rotate", async () => {
    const source: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 3) };
    expect(await rotationsOf(await rotatePdfPages(source, [90, 0, -90]))).toEqual([90, 0, 270]);
  });

  it("adds to a rotation the page already carried", async () => {
    const source: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 1) };
    const once = await rotatePdfPages(source, [90]);
    const twice = await rotatePdfPages({ name: "a.pdf", bytes: once }, [90]);
    expect(await rotationsOf(twice)).toEqual([180]);
    expect(await rotationsOf(await rotatePdfPages({ name: "a.pdf", bytes: once }, [-90]))).toEqual([0]);
  });

  it("refuses a plan that does not name every page", async () => {
    const source: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 3) };
    await expect(rotatePdfPages(source, [90])).rejects.toMatchObject({ reason: "unreadable" });
  });
});

describe("stampPageNumbers", () => {
  it("draws the number into every page's content stream and keeps the page count", async () => {
    const source: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 2) };
    expect(await pageContent(source.bytes, 0)).toBe("");
    const numbered = await stampPageNumbers(source, "of-total", "bottom-centre");
    const document = await PDFDocument.load(numbered);
    expect(document.getPageCount()).toBe(2);
    expect(drawnTexts(await pageContent(numbered, 0))).toEqual(["1 / 2"]);
    expect(drawnTexts(await pageContent(numbered, 1))).toEqual(["2 / 2"]);
  });

  it("writes the bare page number in the plain format", async () => {
    const source: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 1) };
    const numbered = await stampPageNumbers(source, "plain", "bottom-right");
    expect(drawnTexts(await pageContent(numbered, 0))).toEqual(["1"]);
  });

  it("keeps the pages' own rotation untouched", async () => {
    const source: PdfSource = { name: "a.pdf", bytes: await generatedPdf(100, 2) };
    const rotated = await rotatePdfPages(source, [90, 0]);
    const numbered = await stampPageNumbers({ name: "a.pdf", bytes: rotated }, "plain", "bottom-centre");
    expect(await rotationsOf(numbered)).toEqual([90, 0]);
  });
});

describe("splitPdf", () => {
  it("makes one file per part, named by the pages it holds", async () => {
    const source: PdfSource = { name: "ugovor.pdf", bytes: await generatedPdf(100, 4) };
    const parts = await splitPdf(source, [[1, 2], [4]]);
    expect(parts.map((part) => part.name)).toEqual(["ugovor-1-2.pdf", "ugovor-4.pdf"]);
    expect(await widthsOf(parts[0]?.bytes ?? new Uint8Array())).toEqual([100, 101]);
    expect(await widthsOf(parts[1]?.bytes ?? new Uint8Array())).toEqual([103]);
  });

  it("refuses a part that names a page outside the file", async () => {
    const source: PdfSource = { name: "ugovor.pdf", bytes: await generatedPdf(100, 2) };
    await expect(splitPdf(source, [[3]])).rejects.toMatchObject({ reason: "unreadable" });
  });
});

describe("splitPartName", () => {
  it("names a part by its first and last page", () => {
    expect(splitPartName("ugovor.pdf", [1, 2, 3])).toBe("ugovor-1-3.pdf");
    expect(splitPartName("ugovor.pdf", [5])).toBe("ugovor-5.pdf");
    expect(splitPartName("Ugovor.PDF", [2])).toBe("Ugovor-2.PDF");
    expect(splitPartName("bez-ekstenzije", [1])).toBe("bez-ekstenzije-1.pdf");
  });
});
