// The Survival pack's builder.
//
//   node scripts/packs/survival/build.mjs              # build the pack
//   node scripts/packs/survival/build.mjs --fixtures   # re-cut the test fixtures
//
// WHAT IT DOES. Downloads every source `sources.json` names into
// `%TEMP%\nexus-pack-cache\survival\`, verifies each download against the
// SHA-256 and size that file records, extracts the text with pdfjs-dist and the
// figures with Poppler (fetched into the same cache), converts each article to
// CommonMark, proves the fidelity of every article, and writes the pack folder
// to `%TEMP%\nexus-packs\survival\` with the metadata `pack-sign.mjs` takes
// BESIDE that folder. Re-running reuses the cache; a cached file whose digest
// no longer matches the evidence is discarded and fetched again.
//
// THE SAFETY RULES ARE GATES HERE, NOT NOTES. Every article's Markdown is
// compared with the source span it came from (`stripMarkup(markdown)` equals
// that span's text, whitespace collapsed), and an article whose text matches a
// pattern in `plan.mjs` is not written at all: it is counted, printed, and left
// for `docs/packs/survival.md` to list. The only Markdown this builder adds is
// markup, the images, and one Source line per article.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";

import { itemsText, mergeFigures, toBlocks } from "./article.mjs";
import { plainText, stripMarkup, toMarkdown } from "./blocks.mjs";
import { articleHtml, articleText, htmlToBlocks } from "./html-source.mjs";
import { assertFurnitureOnly, collapse, joinHyphenated, normalisePage, slugify } from "./normalise.mjs";
import { captionFor, isFigureImage, readPdf } from "./pdf-source.mjs";
import { FORBIDDEN, PLAN } from "./plan.mjs";
import { ensurePoppler, listImages, renderPage, POPPLER } from "./poppler.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const SOURCES_FILE = join(HERE, "sources.json");
const FIXTURES_DIR = join(HERE, "fixtures");

export const PACK_ID = "survival";
/** The only `sources.json` layout this builder reads. */
export const SOURCES_LAYOUT = 1;
/** A figure is re-encoded at this width at most, and never enlarged. */
export const FIGURE_MAX_PIXELS = 820;
/** The page render a figure is cropped out of. 150 dpi is 2.08 pixels per point. */
export const FIGURE_DPI = 150;
/** A heading is a heading when it is set at least this much larger than the body. */
export const HEADING_SCALE = 1.15;
/**
 * What the builder calls itself when it fetches a source.
 *
 * Two agents, both measured: archive.org and the FM 21-76 mirror answer a named
 * programmatic agent, while the federal pages (measured on Ready.gov,
 * FoodSafety.gov and NOAA/NWS) answer HTTP 403 to one and serve a desktop
 * browser. The browser string is the same one the research run used, and it is
 * a browser's because that is what those edges accept — the pages are
 * public-domain government material either way.
 */
export const FETCH_AGENTS = {
  binary: "nexus-pack-builder",
  page: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Where the cache, the pack and the metadata live. All under `%TEMP%`. */
export function outputPaths() {
  return {
    cacheDir: join(tmpdir(), "nexus-pack-cache", PACK_ID),
    workDir: join(tmpdir(), "nexus-pack-cache", PACK_ID, "images"),
    packDir: join(tmpdir(), "nexus-packs", PACK_ID),
    metaPath: join(tmpdir(), "nexus-packs", `${PACK_ID}.meta.json`),
  };
}

/**
 * `sources.json`, checked.
 *
 * Every source carries a licence and the sentence that licence was read from,
 * because a source without evidence is not used. An HTML source is pinned by
 * the digest of its page's own `<article>` element rather than of the whole
 * response: measured, the envelope of a federal page can move between two
 * fetches while the element does not, and the element is what the pack is made
 * of.
 */
export function assertSources(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${PACK_ID}: sources.json must be an object.`);
  }
  if (parsed.layout !== SOURCES_LAYOUT) {
    throw new Error(`${PACK_ID}: sources.json layout must be ${String(SOURCES_LAYOUT)}.`);
  }
  if (typeof parsed.fetched !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.fetched)) {
    throw new Error(`${PACK_ID}: sources.json needs the date its sources were read.`);
  }
  const byId = new Map();
  for (const source of parsed.sources ?? []) {
    for (const field of ["id", "kind", "title", "url", "licence", "credit"]) {
      if (typeof source?.[field] !== "string" || source[field].length === 0) {
        throw new Error(`${PACK_ID}: a source is missing "${field}".`);
      }
    }
    if (!["pdf", "html"].includes(source.kind)) {
      throw new Error(`${PACK_ID}: "${source.id}" has kind ${JSON.stringify(source.kind)}.`);
    }
    if (typeof source.evidence?.url !== "string" || typeof source.evidence?.quote !== "string") {
      throw new Error(`${PACK_ID}: "${source.id}" has no licence evidence.`);
    }
    if (!/^https?:\/\//.test(source.evidence.url) || source.evidence.quote.trim().length < 40) {
      throw new Error(`${PACK_ID}: "${source.id}" has empty licence evidence.`);
    }
    if (source.kind === "pdf") {
      if (!/^[0-9a-f]{64}$/.test(source.sha256 ?? "") || !Number.isInteger(source.bytes)) {
        throw new Error(`${PACK_ID}: "${source.id}" has no SHA-256 and size.`);
      }
      if (!Array.isArray(source.vocabulary)) {
        throw new Error(`${PACK_ID}: "${source.id}" needs its running-head vocabulary.`);
      }
    } else {
      if (!Array.isArray(source.documents) || source.documents.length === 0) {
        throw new Error(`${PACK_ID}: "${source.id}" holds no pages.`);
      }
      for (const page of source.documents) {
        for (const field of ["path", "url", "sha256"]) {
          if (typeof page?.[field] !== "string" || page[field].length === 0) {
            throw new Error(`${PACK_ID}: "${source.id}" has a page missing "${field}".`);
          }
        }
        if (!/^[0-9a-f]{64}$/.test(page.sha256) || !Number.isInteger(page.bytes)) {
          throw new Error(`${PACK_ID}: "${source.id}${page.path}" has no SHA-256 and size.`);
        }
      }
    }
    if (byId.has(source.id)) throw new Error(`${PACK_ID}: "${source.id}" is listed twice.`);
    byId.set(source.id, source);
  }
  if (byId.size === 0) throw new Error(`${PACK_ID}: sources.json holds no sources.`);
  return { fetched: parsed.fetched, byId };
}

/** Where a PDF source's bytes live in the cache. */
export function cacheFile(cacheDir, source) {
  return join(cacheDir, `${source.id}.pdf`);
}

/** Where one HTML page's bytes live in the cache. */
export function pageCacheFile(cacheDir, source, page) {
  return join(cacheDir, `${source.id}${page.path.replace(/[^a-z0-9]+/gi, "-")}.html`);
}

function verify(bytes, url, expected) {
  const digest = sha256(bytes);
  if (digest !== expected.sha256 || bytes.byteLength !== expected.bytes) {
    throw new Error(
      `${PACK_ID}: ${url} is ${String(bytes.byteLength)} bytes / ${digest}, and sources.json records ` +
        `${String(expected.bytes)} / ${expected.sha256}. Update the evidence deliberately, or do not build.`,
    );
  }
}

/**
 * PDF bytes from the cache or the network, verified either way.
 *
 * The cache is not trusted: a cached file whose digest disagrees is treated as
 * absent. A download that disagrees is a refusal, and the message carries what
 * was found, because the two legitimate answers — the source really changed, or
 * something is serving another page — are told apart by exactly that.
 */
export async function fetchSource(url, expected, options) {
  let bytes = existsSync(expected.file) ? readFileSync(expected.file) : null;
  if (bytes !== null && (sha256(bytes) !== expected.sha256 || bytes.byteLength !== expected.bytes)) bytes = null;
  let fetched = false;
  if (bytes === null) {
    const response = await options.fetchImpl(url, { headers: { "user-agent": FETCH_AGENTS.binary } });
    if (response.ok !== true) throw new Error(`${PACK_ID}: ${url} answered ${String(response.status)}.`);
    bytes = Buffer.from(await response.arrayBuffer());
    fetched = true;
  }
  verify(bytes, url, expected);
  if (fetched) {
    mkdirSync(dirname(expected.file), { recursive: true });
    writeFileSync(expected.file, bytes);
  }
  return { bytes, fetched };
}

/**
 * An HTML page's article element, from the cache or the network, verified
 * against the digest of that element (see {@link assertSources}).
 */
export async function fetchFragment(page, source, options) {
  const file = pageCacheFile(options.cacheDir, source, page);
  let fragment = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (fragment !== null && (sha256(fragment) !== page.sha256 || Buffer.byteLength(fragment, "utf8") !== page.bytes)) {
    fragment = null;
  }
  let fetched = false;
  if (fragment === null) {
    const response = await options.fetchImpl(page.url, { headers: { "user-agent": FETCH_AGENTS.page } });
    if (response.ok !== true) throw new Error(`${PACK_ID}: ${page.url} answered ${String(response.status)}.`);
    fragment = articleHtml(await response.text());
    if (fragment === null) throw new Error(`${PACK_ID}: ${page.url} has no <article> element.`);
    fetched = true;
  }
  verify(Buffer.from(fragment, "utf8"), page.url, { bytes: page.bytes, sha256: page.sha256 });
  if (fetched) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, fragment);
  }
  return { fragment, fetched };
}

/**
 * A PDF source as a document: its normalised lines in reading order, and the
 * figure-sized images Poppler extracted, each with the caption the source
 * prints near it.
 */
export async function loadPdfSource(source, options) {
  const file = cacheFile(options.cacheDir, source);
  const { bytes, fetched } = await fetchSource(
    source.url,
    { file, bytes: source.bytes, sha256: source.sha256 },
    options,
  );
  const document = await readPdf(bytes);
  const lines = [];
  const dropped = [];
  for (const page of document.pages) {
    const result = normalisePage(page, {
      vocabulary: source.vocabulary,
      runningTitle: source.runningTitle,
      band: source.band,
    });
    lines.push(...result.lines);
    dropped.push(...result.dropped);
  }
  assertFurnitureOnly(dropped, source.id, source.vocabulary, source.runningTitle);
  const byRule = new Map();
  for (const line of dropped) byRule.set(line.rule, (byRule.get(line.rule) ?? 0) + 1);
  // Where the licence sentence is the document's own statement, the document
  // must carry it: a distribution statement the extractor cannot find is a
  // licence claim this build cannot stand behind.
  const ownText = collapse(lines.map((line) => line.text).join(" "));
  const inDocument = ownText.includes(collapse(source.evidence.quote));
  options.log(
    `  ${source.id}: ${String(document.pageCount)} pages, ${String(lines.length)} lines, furniture dropped ` +
      `${[...byRule].map(([rule, count]) => `${rule}=${String(count)}`).join(" ")}; licence sentence ` +
      `${inDocument ? "read from this document" : "read elsewhere (see sources.json)"}${fetched ? "" : " (cache)"}`,
  );
  let figures = [];
  if (source.figures === "none") {
    options.log(`  ${source.id}: text only, no figures (see docs/packs/survival.md)`);
  } else {
    const listed = listImages(options.tools.pdfimages, file, 1, document.pageCount);
    figures = await cropFigures(source.id, document.pages, file, lines, options);
    // `pdfimages -list` is the second opinion that a page's placement really is
    // an image: a page the render crops a figure from should be a page that
    // embeds at least one, and a figure count above the embedded count means the
    // page's own picture was found somewhere the images are not.
    const embedded = new Set(listed.map((record) => record.page));
    const from = new Set(figures.map((figure) => figure.page));
    const unbacked = [...from].filter((page) => !embedded.has(page));
    if (unbacked.length > 0) {
      throw new Error(
        `${PACK_ID}: ${source.id}: pages ${unbacked.slice(0, 8).join(", ")} carry a figure placement and embed no image.`,
      );
    }
    options.log(
      `  ${source.id}: ${String(figures.length)} figures of ${String(listed.length)} embedded images` +
        ` on ${String(embedded.size)} pages`,
    );
  }
  return { source, kind: "pdf", bytes, lines, figures, pageCount: document.pageCount };
}

/**
 * The figures of a source: every embedded image the page's content stream draws
 * at figure size, cropped out of the page's own render.
 *
 * One render per page, however many figures it carries. A crop that comes back
 * one flat tone is a refusal rather than a figure: it is what a placement box
 * that missed the picture looks like, and nothing downstream would notice.
 */
async function cropFigures(sourceId, pages, pdfPath, lines, options) {
  const figures = [];
  for (const page of pages) {
    const placements = page.images.filter((image) => isFigureImage(image, page));
    if (placements.length === 0) continue;
    if (page.rotate !== 0) {
      throw new Error(`${PACK_ID}: ${sourceId} page ${String(page.index)} is rotated ${String(page.rotate)}.`);
    }
    const rendered = renderPage(
      options.tools.pdftoppm,
      pdfPath,
      page.index,
      join(options.workDir, `${sourceId}-p${String(page.index)}`),
      FIGURE_DPI,
    );
    const renderedSize = await sharp(rendered).metadata();
    const pageWidth = renderedSize.width ?? 0;
    const pageHeight = renderedSize.height ?? 0;
    for (const [index, placement] of placements.entries()) {
      const scale = FIGURE_DPI / 72;
      const left = Math.max(0, Math.round(placement.box.x * scale) - 4);
      const top = Math.max(0, Math.round((page.height - placement.box.y - placement.box.height) * scale) - 4);
      // The crop is clamped to the rendered page: a figure printed against the
      // page's edge has no padding to give, and the clamp is what keeps a
      // rounding difference from asking sharp for an area that does not exist.
      const width = Math.min(Math.round(placement.box.width * scale) + 8, pageWidth - left);
      const height = Math.min(Math.round(placement.box.height * scale) + 8, pageHeight - top);
      if (width <= 0 || height <= 0 || (width * height) / (Math.round(placement.box.width * scale) * Math.round(placement.box.height * scale)) < 0.6) {
        throw new Error(
          `${PACK_ID}: ${sourceId} page ${String(page.index)}: the figure box at ${placement.box.x.toFixed(0)},` +
            `${placement.box.y.toFixed(0)} does not fit the page it is drawn on.`,
        );
      }
      const file = join(options.workDir, `${sourceId}-p${String(page.index)}-${String(index)}.png`);
      const cropped = sharp(rendered).extract({ left, top, width, height }).resize({ width: FIGURE_MAX_PIXELS, withoutEnlargement: true });
      const stats = await cropped.clone().greyscale().stats();
      const spread = Math.max(...stats.channels.map((channel) => channel.stdev));
      if (spread < 2) {
        throw new Error(
          `${PACK_ID}: ${sourceId} page ${String(page.index)}: the crop for figure ${String(index)} is one flat tone.`,
        );
      }
      await cropped.png({ compressionLevel: 9, palette: true }).toFile(file);
      figures.push({
        page: page.index,
        index,
        box: placement.box,
        crop: file,
        caption: captionFor({ box: placement.box }, lines.filter((line) => line.page === page.index)),
      });
    }
  }
  return figures;
}

/** An HTML source as a document: one entry per page, its text and its blocks. */
export async function loadHtmlSource(source, options) {
  const documents = new Map();
  for (const page of source.documents) {
    const { fragment, fetched } = await fetchFragment(page, source, options);
    documents.set(page.path, {
      path: page.path,
      url: page.url,
      text: articleText(fragment),
      blocks: htmlToBlocks(fragment),
    });
    options.log(
      `  ${source.id}${page.path}: ${String(documents.get(page.path).text.length)} characters, ` +
        `${String(documents.get(page.path).blocks.length)} blocks${fetched ? "" : " (cache)"}`,
    );
  }
  return { source, kind: "html", documents };
}

/**
 * The article jobs, flattened out of the plan in the order the plan declares.
 *
 * The plan is grouped by topic and a source's chapters are spread across those
 * groups, so the reading order is resolved later, from the headings themselves.
 */
export function flattenPlan(plan = PLAN) {
  const jobs = [];
  const walk = (entries, groups) => {
    for (const entry of entries) {
      if (Array.isArray(entry.children)) {
        walk(entry.children, [...groups, { id: entry.id, title: entry.title }]);
        continue;
      }
      jobs.push({ ...entry, groups });
    }
  };
  walk(plan, []);
  return jobs;
}

/**
 * A heading's identity: its letters and digits, upper-cased.
 *
 * The sources print their headings in ways that defeat a text comparison —
 * FM 21-76's are upper-case and split mid-phrase ("EDIBLEAND" / "MEDICINALPLANTS"
 * over two lines), FEMA's guide prints "Landslides and Debris" / "Flow
 * (Mudslide)" across two — so the comparison is made on what a reader would
 * agree the heading SAYS, and the removal of punctuation and spacing is what
 * lets a two-line heading be matched at all.
 */
export function headingKey(text) {
  return collapse(text)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * The line index a heading starts at.
 *
 * A heading is where the source SETS one, so a line the source prints at body
 * size cannot be it (a table of contents names every chapter; the chapter
 * itself sets the name larger), and a heading the source prints over two or
 * three lines is matched as the one heading it is. Among the candidates that
 * remain, the largest is the heading — measured, FM 21-76 sets a chapter title
 * at 17.7 points over its section headings' 15.8, and FEMA's guide sets a
 * section's title at 48 over the running head's 11 that repeats it.
 * `occurrence` then picks among candidates the source sets at the same size,
 * because FM 21-76 really does have a chapter and an appendix both called
 * "Poisonous Plants".
 */
export function findHeading(lines, text, occurrence = 1) {
  const target = headingKey(text);
  if (target === "") return -1;
  const body = bodySizeOf(lines);
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    let key = "";
    let size = 0;
    for (let take = 1; take <= 3; take += 1) {
      const line = lines[index + take - 1];
      if (line === undefined || line.size < body * HEADING_SCALE) break;
      key += headingKey(line.text);
      size = size === 0 ? line.size : Math.min(size, line.size);
      if (key === target) candidates.push({ index, size });
      if (!target.startsWith(key)) break;
    }
  }
  if (candidates.length === 0) return -1;
  const largest = Math.max(...candidates.map((candidate) => candidate.size));
  const atSize = candidates.filter((candidate) => candidate.size === largest);
  return (atSize[occurrence - 1] ?? atSize[atSize.length - 1]).index;
}

/**
 * Every job's span, as line indices, resolved in the source's own reading
 * order.
 *
 * `end` defaults to the next job of the same source in READING order, so a plan
 * declares what it wants by topic and the document decides the boundaries. A
 * heading that cannot be found stops the build: every article after it would
 * otherwise move to the wrong text, and a pack that quietly ships the wrong
 * chapter is worse than a pack that is not built.
 */
export function resolveSpans(documents, jobs) {
  const bySource = new Map();
  for (const job of jobs) bySource.set(job.source, [...(bySource.get(job.source) ?? []), job]);
  const resolved = new Map();
  for (const [sourceId, list] of bySource) {
    const document = documents.get(sourceId);
    if (document === undefined) {
      throw new Error(`${PACK_ID}: "${list[0].id}" names no source ${JSON.stringify(sourceId)}.`);
    }
    if (document.kind !== "pdf") continue;
    const ordered = list
      .filter((job) => job.start !== "")
      .map((job) => {
        const from = findHeading(document.lines, job.start, job.occurrence ?? 1);
        if (from < 0) {
          throw new Error(`${PACK_ID}: ${sourceId} has no heading ${JSON.stringify(job.start)} for "${job.id}".`);
        }
        return { job, from };
      })
      .sort((a, b) => a.from - b.from);
    for (const [index, item] of ordered.entries()) {
      const next = ordered[index + 1]?.from ?? document.lines.length;
      let to = next;
      if (item.job.end !== undefined) {
        to = findHeading(document.lines, item.job.end, item.job.endOccurrence ?? 1);
        if (to < 0) {
          throw new Error(`${PACK_ID}: ${sourceId} has no heading ${JSON.stringify(item.job.end)} for "${item.job.id}".`);
        }
      }
      if (to <= item.from) {
        throw new Error(`${PACK_ID}: ${sourceId}: "${item.job.id}" ends before it starts.`);
      }
      resolved.set(item.job.id, { from: item.from, to, next });
    }
  }
  return resolved;
}

/** Figures printed inside a line range, in reading order. */
export function insideFigures(figures, start, end) {
  if (start === undefined) return [];
  const after = (figure) => figure.page > start.page || (figure.page === start.page && figure.box.y <= start.y);
  const before =
    end === undefined
      ? () => true
      : (figure) => figure.page < end.page || (figure.page === end.page && figure.box.y > end.y);
  return figures.filter((figure) => after(figure) && before(figure));
}

/**
 * The span's text, in the order the reader meets it, from the same walk the
 * Markdown is built by — the walk is what decides that a figure's caption is
 * the caption line rather than a paragraph, and the comparison has to be made
 * about the same walk or it would not be about anything.
 */
export function sourceTextOf(lines, figures) {
  return itemsText(mergeFigures(lines, figures));
}

/** A PDF span as an article. */
export function pdfArticle(job, lines, figures) {
  const prepared = figures.map((item) => ({
    ...item,
    file: `${job.source}-p${String(item.page)}-${String(item.index)}.png`,
  }));
  return {
    id: job.id,
    title: job.title,
    source: job.source,
    groups: job.groups,
    blocks: toBlocks({ lines, figures: prepared, title: job.title }),
    figures: prepared,
    sourceText: collapse(sourceTextOf(lines, prepared)),
    lines: lines.length,
  };
}

/** An HTML page as an article: the page's article element, whole. */
export function htmlArticle(job, page) {
  return {
    id: job.id,
    title: job.title,
    source: job.source,
    groups: job.groups,
    blocks: page.blocks,
    figures: [],
    sourceText: collapse(page.text),
    lines: 0,
  };
}

/**
 * The fidelity check, in the one place it can be enforced.
 *
 * Two comparisons, because there are two ways to lose a word: the Markdown read
 * back must equal the blocks it was written from (markup only), and the blocks
 * must equal the source span (nothing added, nothing dropped, nothing moved).
 * The Source line is outside both, because it is the pack's own attribution
 * rather than something the source prints.
 */
export function fidelity(article) {
  const markdown = toMarkdown(article.blocks);
  // Hyphenation at a line end (rule R4) is undone where a paragraph is
  // assembled, and the source side has no paragraphs to assemble, so both sides
  // pass through the same rule once more here. The only difference this can
  // hide is a hyphen that falls exactly on a paragraph boundary, and that is a
  // difference R4 itself decides.
  const fromMarkdown = joinHyphenated(collapse(stripMarkup(markdown)));
  const fromBlocks = joinHyphenated(collapse(plainText(article.blocks)));
  if (fromMarkdown !== fromBlocks) {
    throw new Error(
      `${PACK_ID}: fidelity: ${article.id}: the Markdown and the blocks disagree\n` +
        `  markdown ${firstDifference(fromMarkdown, fromBlocks)}\n  blocks   ${firstDifference(fromBlocks, fromMarkdown)}`,
    );
  }
  if (fromBlocks !== joinHyphenated(article.sourceText)) {
    throw new Error(
      `${PACK_ID}: fidelity: ${article.id}: the article and the source span disagree\n` +
        `  article ${firstDifference(fromBlocks, article.sourceText)}\n` +
        `  source  ${firstDifference(article.sourceText, fromBlocks)}`,
    );
  }
  return markdown;
}

/** Where two texts start to differ, with a little of each side. */
function firstDifference(one, other) {
  let index = 0;
  while (index < one.length && index < other.length && one[index] === other[index]) index += 1;
  return `differ at ${String(index)}: ${JSON.stringify(one.slice(index, index + 140))}`;
}

/** The safety sweep: an article whose text matches a forbidden pattern is left out. */
export function forbiddenMatch(article) {
  const text = plainText(article.blocks);
  for (const rule of FORBIDDEN) {
    // `String.match` rather than `RegExp.exec`: a rule's pattern may be global,
    // and a global `exec` carries its own `lastIndex` from one article to the
    // next. A rule may also require more than one mention — `plan.mjs` says why
    // for `combat`.
    const found = text.match(rule.pattern);
    if (found === null) continue;
    const minimum = rule.minimum ?? 1;
    // One rule counts DISTINCT terms (see `combat` in `plan.mjs`): a section
    // about weapons names several, while a sentence that mentions one military
    // object in passing — an ammunition can used as a cooking pot — names one.
    const scored = rule.distinct === true ? new Set(found.map((term) => term.toLowerCase())).size : found.length;
    if (scored < minimum) continue;
    return { rule: rule.id, match: found.slice(0, 3).join(", ") };
  }
  return null;
}

/**
 * The whole build: fetch, extract, convert, prove. Nothing is written here;
 * `main` writes, so a test can drive the conversion with nothing on disk.
 */
export async function build(options) {
  const started = Date.now();
  const documents = new Map();
  for (const source of options.sources.values()) {
    documents.set(
      source.id,
      source.kind === "pdf" ? await loadPdfSource(source, options) : await loadHtmlSource(source, options),
    );
  }
  const jobs = flattenPlan();
  const spans = resolveSpans(documents, jobs);
  const articles = [];
  const omitted = [];
  for (const job of jobs) {
    const document = documents.get(job.source);
    if (document.kind === "html") {
      const page = document.documents.get(job.document);
      if (page === undefined) throw new Error(`${PACK_ID}: "${job.id}" names no page ${JSON.stringify(job.document)}.`);
      keep(htmlArticle(job, page), articles, omitted, options);
      continue;
    }
    const span = spans.get(job.id);
    if (job.entries === true) {
      for (const entry of splitEntries(document, job, span)) {
        const lines = document.lines.slice(entry.from, entry.to);
        keep(pdfArticle(entry, lines, insideFigures(document.figures, lines[0], document.lines[entry.to])), articles, omitted, options);
      }
      continue;
    }
    const lines = document.lines.slice(span.from, span.to);
    keep(pdfArticle(job, lines, insideFigures(document.figures, lines[0], document.lines[span.to])), articles, omitted, options);
  }
  return { articles, omitted, documents, spans, jobs, elapsed: Date.now() - started };
}

/**
 * `entries: true` jobs become one article per entry heading inside the span.
 *
 * Two exclusions, both measured. The span's own heading is not an entry, and
 * neither is the rest of it when the source prints that heading over two lines
 * (`SURVIVAL USE` / `OFPLANTS`) — the part of it is recognised as a prefix of
 * the heading the plan names. And an entry with no text of its own and no
 * figure is a heading the source repeats rather than a section: it is merged
 * into the entry after it instead of becoming a one-line article.
 */
export function splitEntries(document, job, span) {
  const slice = document.lines.slice(span.from, span.to);
  const body = bodySizeOf(slice);
  const headingOfSpan = headingKey(job.start);
  const starts = [];
  let accumulated = "";
  for (const [offset, line] of slice.entries()) {
    // The span's heading may be printed over two or three lines, so what is
    // tested is whether the lines read so far still spell a prefix of the
    // heading the plan names.
    accumulated = offset <= 2 ? accumulated + headingKey(line.text) : accumulated;
    const partOfSpanHeading = offset <= 2 && headingOfSpan.startsWith(accumulated);
    // A single letter, or a single letter followed by a space, is the source's
    // own list marker set at heading size: ATP 3-50.21's water tables put an
    // `X` in their first column, and FM 21-76's first chapter lists `S - Size
    // Up the Situation`. Measured, both arrived as headings and became articles
    // named `water-x-dig-behind-first-group` until this rule.
    const listMarker = /^[A-Za-z](\s|$)/.test(line.text);
    if (line.size >= body * HEADING_SCALE && line.text.length <= 120 && !partOfSpanHeading && !listMarker) starts.push(offset);
  }
  if (starts.length === 0) {
    throw new Error(`${PACK_ID}: ${document.source.id} ${JSON.stringify(job.start)} holds no entry headings.`);
  }
  // The span's own heading is not an entry, and nothing before the first entry
  // may be dropped: a source that prints its heading over two lines and sets
  // the first entry four lines later has an introduction in between.
  if (starts[0] !== 0) starts.unshift(0);
  const ranges = starts.map((from, index) => ({ from, to: starts[index + 1] ?? slice.length }));
  const kept = [];
  for (const range of ranges) {
    const own = slice.slice(range.from + 1, range.to).filter((line) => line.size < body * HEADING_SCALE);
    // A heading with no text of its own is a title the source repeats, not a
    // section: it joins the entry before it rather than becoming one line of
    // its own. The first range is always kept.
    if (own.length >= 2 || kept.length === 0) kept.push(range);
    else kept[kept.length - 1].to = range.to;
  }
  return kept.map((range) => ({
    ...job,
    id: `${job.prefix}-${slugify(range.from === 0 ? job.title : slice[range.from].text)}`,
    title: range.from === 0 ? job.title : slice[range.from].text,
    from: span.from + range.from,
    to: span.from + range.to,
  }));
}

/** The body size of a slice: the size most of its lines are set at. */
export function bodySizeOf(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line.size, (counts.get(line.size) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [size, count] of counts) if (count > bestCount) [best, bestCount] = [size, count];
  return best;
}

function keep(article, articles, omitted, options) {
  const forbidden = forbiddenMatch(article);
  if (forbidden !== null) {
    options.log(`  omitted "${article.id}": ${forbidden.rule} — ${JSON.stringify(forbidden.match)}`);
    omitted.push({ id: article.id, title: article.title, source: article.source, ...forbidden });
    return;
  }
  articles.push(article);
}

/** The `content.json` the Reader reads: the plan's shape, only what was shipped. */
export function buildToc(articles, sources) {
  const toc = [];
  for (const article of articles) {
    const source = sources.get(article.source);
    const entry = {
      id: article.id,
      title: article.title,
      file: `articles/${article.id}.md`,
      source: { title: source.credit, url: source.url },
    };
    let target = toc;
    for (const group of article.groups) {
      let container = target.find((candidate) => candidate.id === group.id);
      if (container === undefined) {
        container = { id: group.id, title: group.title, children: [] };
        target.push(container);
      }
      target = container.children;
    }
    target.push(entry);
  }
  return toc;
}

/**
 * The text a source has that no article of this pack carries, as the headings
 * inside it: this is the omission list `docs/packs/survival.md` prints, and
 * generating it where the decision is made is what keeps the two from drifting.
 */
export function gaps(document, spans, jobs = []) {
  if (document.kind !== "pdf") return [];
  const lines = document.lines;
  // Only THIS source's spans: every source numbers its lines from zero, so a
  // union over all of them would let one source's span cover another's gap, and
  // the first version of this report did exactly that (ATP 3-50.21's chapter 4
  // disappeared from the omission list because FM 21-76 had an article across
  // the same numbers).
  const mine = new Set(jobs.filter((job) => job.source === document.source.id).map((job) => job.id));
  const ranges = [...spans.entries()]
    .filter(([id]) => mine.has(id))
    .map(([, span]) => span)
    .filter((span) => span.from !== undefined)
    .map((span) => [Math.max(0, span.from), Math.min(lines.length, span.to)])
    .sort((a, b) => a[0] - b[0]);
  const body = bodySizeOf(lines);
  const result = [];
  const addGap = (from, to) => {
    const start = Math.max(0, from);
    const end = Math.min(lines.length, to);
    if (end - start <= 0) return;
    const headings = [];
    for (let index = start; index < end; index += 1) {
      const line = lines[index];
      if (line === undefined) continue;
      if (line.size >= body * HEADING_SCALE && line.text.length <= 120) headings.push(line.text);
    }
    result.push({ from: start, to: end, lines: end - start, headings: [...new Set(headings)] });
  };
  let cursor = 0;
  for (const [from, to] of ranges) {
    addGap(cursor, from);
    cursor = Math.max(cursor, to);
  }
  addGap(cursor, lines.length);
  return result;
}

/** The metadata `pack-sign.mjs` takes: what the pack IS, never its file list. */
export function buildMetadata(appVersion) {
  return {
    format: 1,
    id: PACK_ID,
    version: "2026.10.0",
    kind: "content",
    title: { sr: "Preživljavanje", en: "Survival" },
    description: {
      sr: "Preživljavanje u prirodi, prva pomoć i elementarne nepogode, iz američkih vojnih priručnika, FEMA-e, USDA i NOAA-e. Poglavlja o biljkama i životinjama su svetski, a ne regionalni vodič.",
      en: "Survival craft, first aid and disasters from US Army manuals, FEMA, USDA and NOAA. The plant and animal chapters are world-wide Army reference, not a regional identification guide.",
    },
    licence: {
      spdx: "LicenseRef-PD-USGov",
      attribution:
        "US Government works, not subject to copyright in the United States (17 U.S.C. 105(a)): US Army " +
        "ATP 3-50.21 Survival (2018), FM 21-76 Survival (1992), ATP 4-02.11 (2026); FEMA Are You Ready? " +
        "(IS-22, 2004) and Ready.gov; USDA FSIS / FoodSafety.gov; NOAA/NWS JetStream. Per-article " +
        "attribution and the full licence evidence: docs/packs/survival.md.",
      url: "https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm",
    },
    source: { name: "US Department of the Army; FEMA; USDA FSIS; NOAA/NWS", url: "https://www.ready.gov/" },
    minAppVersion: appVersion,
  };
}

/** `apps/desktop`'s version, the floor a pack has to be installable in. */
export function appVersion() {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "apps", "desktop", "package.json"), "utf8"));
  if (typeof manifest.version !== "string") throw new Error(`${PACK_ID}: no app version to floor on.`);
  return manifest.version;
}

/** The source line every article ends with: the work, its section and its URL. */
export function sourceLine(source, article) {
  return `*Source: ${source.credit} Section: ${article.title}. ${source.url}*`;
}

/**
 * A pack id that is not already taken.
 *
 * Ids must be unique in a pack, and the derived ones can collide: FM 21-76's
 * Appendix E names the same snake under more than one heading, and two entries
 * that slug to one id would write one file twice and leave the table of
 * contents pointing at it from two places. Measured: nine articles of the first
 * full build of this pack collided. The second keeps its words and gains a
 * number.
 */
export function uniqueId(id, used) {
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${id}-${String(suffix)}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/**
 * One figure written into the pack, under a name that says where it came from.
 *
 * The crop was encoded once, in the work directory; this is a copy, because
 * re-encoding a line drawing is how a figure loses the thin lines that make it
 * readable.
 */
export function writeFigure(figure, packDir) {
  const file = join(packDir, "images", figure.file);
  writeFileSync(file, readFileSync(figure.crop));
  return file;
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function directorySize(dir) {
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = directorySize(path);
      bytes += inner.bytes;
      files += inner.files;
    } else {
      bytes += statSync(path).size;
      files += 1;
    }
  }
  return { bytes, files };
}

async function main() {
  const paths = outputPaths();
  const sources = assertSources(JSON.parse(readFileSync(SOURCES_FILE, "utf8")));
  const options = {
    ...paths,
    sources: sources.byId,
    fetchImpl: fetch,
    log: (line) => {
      console.log(line);
    },
  };
  mkdirSync(paths.workDir, { recursive: true });

  if (process.argv.includes("--fixtures")) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    options.tools = await ensurePoppler(options);
    await cutFixtures(options);
    return;
  }

  rmSync(paths.packDir, { recursive: true, force: true });
  mkdirSync(join(paths.packDir, "articles"), { recursive: true });
  mkdirSync(join(paths.packDir, "images"), { recursive: true });
  console.log(`${PACK_ID}: ${String(sources.byId.size)} sources, evidence dated ${sources.fetched}`);
  options.tools = await ensurePoppler(options);
  const converting = Date.now();
  const result = await build(options);
  const conversion = ((Date.now() - converting) / 1000).toFixed(1);
  let characters = 0;
  let figures = 0;
  const usedIds = new Set();
  for (const article of result.articles) {
    const id = uniqueId(article.id, usedIds);
    if (id !== article.id) options.log(`  id taken, "${article.id}" written as "${id}"`);
    article.id = id;
    const markdown = fidelity(article);
    const source = sources.byId.get(article.source);
    writeFileSync(join(paths.packDir, "articles", `${article.id}.md`), `${markdown}\n\n${sourceLine(source, article)}\n`);
    for (const item of article.figures) {
      writeFigure(item, paths.packDir);
      figures += 1;
    }
    characters += markdown.length;
    console.log(
      `  ${article.id.padEnd(42)} ${article.source.padEnd(14)} ${String(article.lines).padStart(5)} lines ` +
        `${String(article.figures.length).padStart(3)} figures ${String(markdown.length).padStart(7)} chars`,
    );
  }
  writeFileSync(
    join(paths.packDir, "content.json"),
    `${JSON.stringify({ layout: 1, language: "en", notice: "safety", toc: buildToc(result.articles, sources.byId) }, null, 2)}\n`,
  );
  writeFileSync(paths.metaPath, `${JSON.stringify(buildMetadata(appVersion()), null, 2)}\n`);

  console.log("-- what no article carries");
  for (const document of result.documents.values()) {
    if (document.kind !== "pdf") continue;
    for (const gap of gaps(document, result.spans, result.jobs)) {
      const headings = gap.headings.slice(0, 8).join(" / ");
      console.log(
        `  ${document.source.id}: ${String(gap.lines)} lines (${headings || "no heading"})` +
          `${gap.headings.length > 8 ? " …" : ""}`,
      );
    }
  }
  const total = directorySize(paths.packDir);
  console.log(`articles: ${String(result.articles.length)} written, ${String(result.omitted.length)} omitted`);
  console.log(`text: ${String(characters)} characters; figures: ${String(figures)}`);
  console.log(`poppler: ${POPPLER.version} (${POPPLER.licence}), ${kib(POPPLER.bytes)} unpacked in the cache`);
  console.log(`pack: ${kib(total.bytes)} in ${String(total.files)} files -> ${paths.packDir}`);
  console.log(`metadata: ${paths.metaPath} (kind content, minAppVersion ${appVersion()})`);
  console.log(`build: ${conversion} s of fetch+convert`);
  console.log(`sign with: node scripts/pack-sign.mjs --dir ${paths.packDir} --meta ${paths.metaPath} --key <release-key.pem>`);
}

/**
 * Re-cuts the test fixtures from the cached sources.
 *
 * A fixture is one real page of a source, cut from the file the build reads:
 * the page's normalised lines, its text runs and its image boxes as JSON (a few
 * KB), the page's figure as a small PNG, and one real HTML page's article
 * element. Cutting them here rather than by hand is what keeps them the
 * source's own data; `fixtures/README.md` records the provenance and licence.
 */
async function cutFixtures(options) {
  const cuts = [
    { source: "atp-3-50-21", page: 24, figure: 0 },
    { source: "fm-21-76", page: 372, figure: 0 },
  ];
  for (const cut of cuts) {
    const source = options.sources.get(cut.source);
    const file = cacheFile(options.cacheDir, source);
    const { bytes } = await fetchSource(source.url, { file, bytes: source.bytes, sha256: source.sha256 }, options);
    const document = await readPdf(bytes);
    const page = document.pages.find((candidate) => candidate.index === cut.page);
    const lines = normalisePage(page, { vocabulary: source.vocabulary }).lines;
    writeFileSync(
      join(FIXTURES_DIR, `${source.id}-p${String(cut.page)}.json`),
      // Deliberately the page's RAW runs, not its normalised lines: the test
      // that reads this fixture runs the normaliser itself, on the same data
      // the build normalises, so a rule that changes is a test that changes.
      `${JSON.stringify({ source: source.id, page: cut.page, width: page.width, height: page.height, items: page.items, images: page.images.map((image) => ({ box: image.box, width: image.width, height: image.height })) }, null, 1)}\n`,
    );
    const wanted = (await cropFigures(source.id, document.pages, file, lines, options)).filter(
      (item) => item.page === cut.page,
    )[cut.figure];
    if (wanted === undefined) {
      throw new Error(`${PACK_ID}: ${source.id} page ${String(cut.page)} has no figure ${String(cut.figure)}.`);
    }
    await sharp(wanted.crop).resize({ width: 200, withoutEnlargement: true }).png({ palette: true })
      .toFile(join(FIXTURES_DIR, `${source.id}-p${String(cut.page)}-figure.png`));
    options.log(`  fixture ${source.id} page ${String(cut.page)}: figure ${String(cut.figure)}`);
  }
  const foodsafety = options.sources.get("foodsafety-gov");
  const page = foodsafety.documents.find((document) => document.path === "/food-safety-charts/safe-minimum-internal-temperatures");
  const { fragment } = await fetchFragment(page, foodsafety, options);
  writeFileSync(join(FIXTURES_DIR, "foodsafety-temperatures.html"), `${fragment}\n`);
  options.log(`  fixture foodsafety-gov: ${String(fragment.length)} bytes of the article element`);
  options.log(`fixtures written to ${FIXTURES_DIR}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
