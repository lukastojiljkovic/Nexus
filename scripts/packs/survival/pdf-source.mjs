// Reading a source PDF: its text, where each run of it sits on the page, and
// where each embedded image is placed.
//
// Text comes from pdfjs-dist, the dev dependency the pack builders share. The
// positions matter for two things and nothing else: they tell the normaliser
// which lines are page furniture (see `normalise.mjs`'s margin band), and they
// tell the figure binder which printed line is a figure's anchor, so an image
// lands in the article next to the words that belong with it.
//
// The images themselves are NOT decoded here. pdfjs in this install cannot
// decode the two sources' JBIG2 scans (it asks for a wasm module the package
// does not ship), and the placement of an image is all this file needs from it:
// the content stream's transform gives the box in points. Poppler extracts the
// bytes, and {@link pairImages} proves the two orderings are the same one.

/** pdfjs, loaded once; the legacy build is the one that runs under Node. */
let pdfjsPromise = null;

async function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

/**
 * Every page of a PDF: its size, its text runs, and the placement of each
 * embedded image, all in content order.
 */
export async function readPdf(bytes, options = {}) {
  const pdfjs = await loadPdfjs();
  // pdfjs refuses a Node `Buffer`, so the bytes are handed over as a view on
  // the same memory: a 26-megabyte manual is not copied to be read.
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  const pages = [];
  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = [];
    for (const item of content.items) {
      if (typeof item.str !== "string" || item.str.trim() === "") continue;
      const [, b, c, , e, f] = item.transform;
      // A rotated run (the cloud chart's labels) still has a font size; the
      // height pdfjs reports is the size the page draws it at.
      items.push({
        text: item.str,
        x: e,
        y: f,
        width: item.width,
        height: item.height,
        size: item.height,
        rotated: Math.abs(b) > 0.01 || Math.abs(c) > 0.01,
      });
    }
    pages.push({
      index,
      width: viewport.width,
      height: viewport.height,
      rotate: page.rotate,
      images: await placements(page, pdfjs),
      items,
    });
    options.onPage?.(index, doc.numPages);
  }
  return { pageCount: doc.numPages, pages };
}

/**
 * Where each of a page's images is drawn, in content order.
 *
 * An image in a PDF is drawn into the unit square, so the current transform is
 * the box: `e,f` is its lower-left corner and `a,d` its width and height in
 * points. The image's own pixel size comes with the operator, which is what
 * pairs this list with the files Poppler wrote.
 */
async function placements(page, pdfjs) {
  const ops = await page.getOperatorList();
  const images = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    if (fn === pdfjs.OPS.transform) {
      ctm = ops.argsArray[i];
    } else if (fn === pdfjs.OPS.paintImageXObject) {
      const [, width, height] = ops.argsArray[i];
      images.push({
        width,
        height,
        box: {
          x: Math.min(ctm[4], ctm[4] + ctm[0]),
          y: Math.min(ctm[5], ctm[5] + ctm[3]),
          width: Math.abs(ctm[0]),
          height: Math.abs(ctm[3]),
        },
      });
    }
  }
  return images;
}

/**
 * Is this image a figure, or page furniture?
 *
 * The measured shapes in these sources: a figure is at least 120 by 80 points
 * (the ATP's smallest captioned figure is 283 by 145; FM 21-76's plant
 * illustrations are 330 by 249), the ATP's change bars in the margin are 21.5
 * by 8.6, FM 21-76's decorative rules are 324 by 50, and a full-page scan would
 * be the page. A figure is the one thing in between.
 */
export const FIGURE_MIN_WIDTH = 120;
export const FIGURE_MIN_HEIGHT = 80;
export const FIGURE_MAX_PAGE_SHARE = 0.85;

export function isFigureImage(image, page) {
  const { width, height } = image.box;
  if (width < FIGURE_MIN_WIDTH || height < FIGURE_MIN_HEIGHT) return false;
  return (width * height) / (page.width * page.height) < FIGURE_MAX_PAGE_SHARE;
}

/** `Figure 2-1.`, `Figure B-1.`, `Figure 12-4.` — the sources' caption openings. */
export const FIGURE_CAPTION = /^Figure\s+[A-Z]?-?\d+[A-Z]?-\d+\s*\./;

/**
 * The caption a figure keeps, or "" when the source prints none.
 *
 * The caption is a printed line near the figure's box, and it is taken
 * verbatim: this pack never writes a caption of its own. FM 21-76's 1992
 * reprint labels no figure at all (`docs/packs/survival.md` records it), so
 * its illustrations ship with no caption rather than with one invented here.
 */
export function captionFor(figure, lines, maxDistance = 130) {
  let best = null;
  for (const line of lines) {
    if (!FIGURE_CAPTION.test(line.text)) continue;
    const distance = Math.abs(line.y - (figure.box.y + figure.box.height / 2));
    if (distance > maxDistance) continue;
    if (best === null || distance < best.distance) best = { line, distance };
  }
  return best?.line.text ?? "";
}

/**
 * Where a figure belongs in the reading order: the index of the first line the
 * reader meets after the box, or the end of the span when the figure is last.
 *
 * The two sources print a caption in two different places — the ATP puts it
 * under the figure, FM 21-76's entries put the illustration above their own
 * text — and this one rule handles both, because in both the next printed line
 * is the one the figure belongs with. A plate page with no text of its own (FM
 * 21-76's Appendix E has six) anchors on the line after it, which is the first
 * line of the next entry, so the plate closes the entry it illustrates.
 */
export function anchorIndex(figure, lines) {
  const after = lines.findIndex(
    (line) => line.page > figure.page || (line.page === figure.page && line.y < figure.box.y),
  );
  return after < 0 ? lines.length : after;
}
