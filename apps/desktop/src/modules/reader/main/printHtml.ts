import { resolvePackPath, type ReaderBlock, type ReaderInline } from "@nexus/core";

/**
 * The printed page: one pack's articles as a HTML document main hands to a print
 * view, and the running header and footer Chromium repeats on every sheet.
 *
 * **Why this is HTML built here and not React.** The print view is a window with
 * its own document: it loads one file, from `file:`, with no bundle, no
 * stylesheet and therefore no design tokens - so the only thing that can style it
 * is the sheet inside it. That is a deliberate boundary rather than a shortcut
 * (`check:tokens` is what would otherwise be worked around): the app's tokens are
 * the screen's, and paper is not the screen. The document is monochrome because a
 * printed page is: black text on white is what a printer does with whatever it is
 * given, and a colour that only survives on a colour printer is a colour that
 * fails when the power is out.
 *
 * **Why the notice and the attribution go into the templates.** Chromium's
 * `headerTemplate`/`footerTemplate` are the only place a repeated line can come
 * from - CSS cannot repeat an element across pages - so the pack's title and its
 * safety notice ride the header, and the licence, the source and the page number
 * ride the footer. Every page carries them, including a chapter printed on its
 * own, which is the point of printing a handbook at all.
 *
 * **Every value is escaped.** A pack's title, its attribution and its articles are
 * all text written by somebody else; nothing here is interpolated as markup.
 */

export interface ReaderPrintArticle {
  readonly path: string;
  readonly title: string;
  readonly blocks: readonly ReaderBlock[];
}

export interface ReaderPrintDocument {
  /** The pack's id, so a relative image can be resolved to its `nx-pack:` address. */
  readonly packId: string;
  readonly packTitle: string;
  /** `SPDX - attribution`, as a printed page has to say it. */
  readonly licence: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  /** The safety notice's sentence in the language being printed, or `null` for a pack without one. */
  readonly notice: string | null;
  readonly articles: readonly ReaderPrintArticle[];
}

export const PRINT_LANGUAGES = ["sr", "en"] as const;
export type PrintLanguage = (typeof PRINT_LANGUAGES)[number];

/**
 * The document itself. Every article is a section with its own heading, so a
 * chapter printed as one file reads as consecutive sections rather than as one
 * run-on page; a page break before each article after the first keeps two
 * articles off the same sheet.
 */
export function readerPrintHtml(document: ReaderPrintDocument, language: PrintLanguage): string {
  const title = `${document.packTitle} - ${
    document.articles.length === 1 ? (document.articles[0]?.title ?? "") : document.packTitle
  }`;
  const notice =
    document.notice === null ? "" : `<p class="notice">${escapeHtml(document.notice)}</p>`;
  const body = document.articles
    .map(
      (article) =>
        `<section class="article"><h1>${escapeHtml(article.title)}</h1>` +
        `<p class="source">${escapeHtml(sourceLine(document.sourceName, document.sourceUrl))}</p>` +
        `${renderBlocks(article.blocks, document.packId, article.path)}</section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="${language}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { margin: 18mm 16mm 20mm; }
      html { font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
      body { margin: 0; font-size: 11pt; line-height: 1.5; }
      h1 { font-size: 17pt; margin: 0 0 2mm; }
      h2 { font-size: 13pt; margin: 6mm 0 2mm; }
      h3, h4, h5, h6 { font-size: 11.5pt; margin: 5mm 0 2mm; }
      p { margin: 0 0 3mm; }
      .article { break-before: page; }
      .article:first-of-type { break-before: auto; }
      .notice {
        border: 0.4mm solid black;
        padding: 2mm 3mm;
        margin: 0 0 5mm;
        font-size: 10pt;
      }
      .source { font-size: 9pt; color: gray; }
      ul, ol { margin: 0 0 3mm 6mm; padding: 0; }
      li { margin: 0 0 1mm; }
      blockquote { margin: 0 0 3mm 6mm; font-style: italic; }
      pre { font-family: "Cascadia Mono", Consolas, monospace; font-size: 9.5pt;
            border: 0.2mm solid gray; padding: 2mm; white-space: pre-wrap; }
      table { border-collapse: collapse; margin: 0 0 3mm; width: 100%; }
      th, td { border: 0.2mm solid gray; padding: 1mm 2mm; text-align: left; }
      img { max-width: 100%; }
      hr { border: 0; border-top: 0.2mm solid gray; margin: 4mm 0; }
    </style>
  </head>
  <body>
    ${notice}
    ${body}
  </body>
</html>
`;
}

/**
 * The running header: the pack's title on the left, its notice on the right when
 * it has one. Chromium prints this above every page, which is what makes "the
 * notice on every printed page" true rather than a promise about the first page.
 */
export function readerPrintHeader(document: Pick<ReaderPrintDocument, "packTitle" | "notice">): string {
  const notice = document.notice === null ? "" : `<span>${escapeHtml(document.notice)}</span>`;
  return `<div style="width:100%;padding:0 16mm;font-size:7pt;font-family:'Segoe UI',sans-serif;display:flex;justify-content:space-between;gap:8mm">
  <span>${escapeHtml(document.packTitle)}</span>${notice}
</div>`;
}

/** The running footer: the licence and the source, which are what a copied page must carry, plus the sheet number. */
export function readerPrintFooter(
  document: Pick<ReaderPrintDocument, "licence" | "sourceName" | "sourceUrl">,
): string {
  return `<div style="width:100%;padding:0 16mm;font-size:7pt;font-family:'Segoe UI',sans-serif;display:flex;justify-content:space-between;gap:8mm">
  <span>${escapeHtml(`${document.licence} - ${document.sourceName} ${document.sourceUrl}`)}</span>
  <span><span class="pageNumber"></span>/<span class="totalPages"></span></span>
</div>`;
}

/** The one line every article carries under its title: where the text came from. */
export function sourceLine(name: string, url: string): string {
  return `${name} ${url}`;
}

// --- Blocks to HTML --------------------------------------------------------

function renderBlocks(blocks: readonly ReaderBlock[], packId: string, articlePath: string): string {
  return blocks.map((block) => renderBlock(block, packId, articlePath)).join("\n");
}

function renderBlock(block: ReaderBlock, packId: string, articlePath: string): string {
  switch (block.type) {
    case "heading": {
      const level = Math.min(6, Math.max(2, block.level));
      return `<h${String(level)}>${renderInline(block.children, packId, articlePath)}</h${String(level)}>`;
    }
    case "paragraph":
      return `<p>${renderInline(block.children, packId, articlePath)}</p>`;
    case "code":
      return `<pre>${escapeHtml(block.text)}</pre>`;
    case "quote":
      return `<blockquote>${renderBlocks(block.children, packId, articlePath)}</blockquote>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const attributes = block.ordered && block.start !== 1 ? ` start="${String(block.start)}"` : "";
      const items = block.items
        .map((item) => `<li>${renderBlocks(item, packId, articlePath)}</li>`)
        .join("");
      return `<${tag}${attributes}>${items}</${tag}>`;
    }
    case "table": {
      const head = `<tr>${block.head
        .map((cell) => `<th>${renderInline(cell, packId, articlePath)}</th>`)
        .join("")}</tr>`;
      const rows = block.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => `<td>${renderInline(cell, packId, articlePath)}</td>`)
              .join("")}</tr>`,
        )
        .join("");
      return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    }
    case "rule":
      return "<hr />";
  }
}

function renderInline(nodes: readonly ReaderInline[], packId: string, articlePath: string): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeHtml(node.value);
        case "code":
          return `<code>${escapeHtml(node.value)}</code>`;
        case "strong":
          return `<strong>${renderInline(node.children, packId, articlePath)}</strong>`;
        case "emphasis":
          return `<em>${renderInline(node.children, packId, articlePath)}</em>`;
        case "link":
          return `<a href="${escapeAttribute(node.href)}">${renderInline(node.children, packId, articlePath)}</a>`;
        case "image": {
          const src = imageSource(node.src, packId, articlePath);
          return src === null
            ? `<em>${escapeHtml(node.alt)}</em>`
            : `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(node.alt)}" />`;
        }
      }
    })
    .join("");
}

/**
 * An image's address on paper. A relative source is resolved against the pack
 * through the `nx-pack:` scheme, which is the only way this process serves a
 * pack's bytes; a fragment names nothing on paper and answers `null`, so the alt
 * text is printed instead of a broken frame.
 */
function imageSource(src: string, packId: string, articlePath: string): string | null {
  if (/^https?:\/\//i.test(src)) return src;
  const target = resolvePackPath(articlePath, src);
  return target === null ? null : `nx-pack://${packId}/${target}`;
}

/** `&`, `<`, `>` and the two quote characters, so no pack text can end a tag or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
