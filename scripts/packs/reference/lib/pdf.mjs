// The text layer of a PDF, as lines.
//
// WHY `pdfjs-dist`. It is one of the two root dev dependencies this wave
// installed for pack builders, and unlike the HTML side there is no honest way
// to hand-write this: a PDF's text is a sequence of positioned glyph runs, and
// the positions are the only thing that says where a line ended. A hand-rolled
// reader would be a second, worse implementation of a thing the repository
// already depends on.
//
// WHICH SOURCES USE IT. A gazette act published as a PDF - the Serbian
// Official Gazette's own export, whose text layer carries the act and nothing
// about the page it was printed on. A scanned act has no text layer and is
// therefore not a source this builder can take: `linesFromPdf` answers an empty
// list for one, and `build.mjs` refuses the document rather than shipping an
// empty article.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * A line of text is a run of glyphs the page placed on one baseline, so the
 * vertical position is what groups them. `LINE_TOLERANCE` is in PDF units at
 * the page's own scale, where one line is about twelve: two units is the space
 * between a character's own ascent and descent, and anything larger is a new
 * line. A build that started gluing lines together would fail its fidelity
 * check, which is the point of putting the number in a named constant.
 */
const LINE_TOLERANCE = 2;

async function loadPdfjs() {
  const require = createRequire(import.meta.url);
  const module = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFonts = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";
  return { module, standardFonts };
}

/** PDF bytes into lines, in reading order, pages in order. */
export async function linesFromPdf(bytes) {
  const { module, standardFonts } = await loadPdfjs();
  const task = module.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: standardFonts,
    isEvalSupported: false,
    useSystemFonts: true,
    // The builder is offline for everything it does not fetch on purpose, and
    // pdf.js's cmap fetching is the one thing in it that would reach the
    // network on its own.
    disableFontFace: true,
  });
  const document = await task.promise;

  const lines = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    let current = "";
    let baseline = null;
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (typeof y === "number" && baseline !== null && Math.abs(y - baseline) > LINE_TOLERANCE) {
        lines.push(current);
        current = "";
      }
      if (typeof y === "number") baseline = y;
      current += item.str ?? "";
    }
    lines.push(current);
    page.cleanup();
  }
  // The loading task owns the worker; destroying the document through it is what
  // releases the worker thread, which matters when a build reads several PDFs in
  // one process.
  await task.destroy();
  return lines;
}
