// The Make pack's builder: mending, candles, simple tools and clay, from US
// government bulletins, Project Gutenberg editions and Wikibooks pages.
//
//   node scripts/packs/make/build.mjs             # build the pack
//   node scripts/packs/make/build.mjs --fixtures  # re-cut the test fixtures
//
// WHAT IT DOES. Downloads every source `sources.json` names into
// `%TEMP%\nexus-pack-cache\make-by-hand\`, verifies each download against the
// size and SHA-256 that file records, converts each article to CommonMark,
// proves the fidelity of every article, writes the figures the articles keep,
// and writes the pack folder to `%TEMP%\nexus-packs\make-by-hand\` with the
// metadata `pack-sign.mjs` takes BESIDE that folder. Re-running reuses the
// cache; a cached file whose digest no longer matches the evidence is discarded
// and fetched again.
//
// THE SAFETY RULES ARE GATES HERE, NOT NOTES. Every article's Markdown is
// compared with the text of the source span it came from (`stripMarkup` of the
// Markdown equals that span's own words, whitespace collapsed), and an article
// whose text matches a pattern in `lib/plan.mjs` is not written at all: it is
// counted, printed, and left for `docs/packs/make.md` to list beside the
// deliberate omissions. The only Markdown this builder adds is markup, the
// figure images, and one Source line per article.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";

import { assertReaderSubset, plainText, stripMarkup, toMarkdown } from "./lib/blocks.mjs";
import { ebookBody, htmlWords, itemsToBlocks, parseItems, sectionItems } from "./lib/html.mjs";
import { documentLines, ocrToBlocks, ocrWords } from "./lib/ocr.mjs";
import { FORBIDDEN, OMISSIONS, PLAN } from "./lib/plan.mjs";
import { collapse, headingKey, kib, slugify } from "./lib/text.mjs";
import { sectionSource, wikitextToBlocks, wikitextWords } from "./lib/wikitext.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const SOURCES_FILE = join(HERE, "sources.json");
const FIXTURES_DIR = join(HERE, "fixtures");

export const PACK_ID = "make-by-hand";
/** The only `sources.json` layout this builder reads. */
export const SOURCES_LAYOUT = 1;
/** A figure is re-encoded at this width at most, and never enlarged. */
export const FIGURE_MAX_PIXELS = 1100;
/** The three kinds of source this pack is built from. */
export const SOURCE_KINDS = ["gutenberg-html", "ia-ocr", "wikibooks"];

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Where the cache, the pack and the metadata live. All under `%TEMP%`. */
export function outputPaths() {
  return {
    cacheDir: join(tmpdir(), "nexus-pack-cache", PACK_ID),
    workDir: join(tmpdir(), "nexus-pack-cache", PACK_ID, "figures"),
    packDir: join(tmpdir(), "nexus-packs", PACK_ID),
    metaPath: join(tmpdir(), "nexus-packs", `${PACK_ID}.meta.json`),
  };
}

/**
 * `sources.json`, checked.
 *
 * Every source carries a licence and the sentence that licence was read from,
 * because a source without evidence is not used. A download is pinned by size
 * and digest, so a source that changes under a rebuild is a refusal rather than
 * a silently different book; a book whose figures are shipped also pins a digest
 * over them, see {@link figuresDigest} for what it covers.
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
    if (!SOURCE_KINDS.includes(source.kind)) {
      throw new Error(`${PACK_ID}: "${source.id}" has kind ${JSON.stringify(source.kind)}.`);
    }
    if (typeof source.evidence?.url !== "string" || typeof source.evidence?.quote !== "string") {
      throw new Error(`${PACK_ID}: "${source.id}" has no licence evidence.`);
    }
    if (!/^https?:\/\//.test(source.evidence.url) || source.evidence.quote.trim().length < 40) {
      throw new Error(`${PACK_ID}: "${source.id}" has empty licence evidence.`);
    }
    if (!/^[0-9a-f]{64}$/.test(source.sha256 ?? "") || !Number.isInteger(source.bytes)) {
      throw new Error(`${PACK_ID}: "${source.id}" has no SHA-256 and size.`);
    }
    if (source.kind === "ia-ocr" && !Array.isArray(source.furniture)) {
      throw new Error(`${PACK_ID}: "${source.id}" needs the list of furniture patterns it is read with.`);
    }
    if (source.kind === "gutenberg-html" && !/^[0-9a-f]{64}$/.test(source.figuresSha256 ?? "")) {
      throw new Error(`${PACK_ID}: "${source.id}" has no digest over the figures it ships.`);
    }
    if (byId.has(source.id)) throw new Error(`${PACK_ID}: "${source.id}" is listed twice.`);
    byId.set(source.id, source);
  }
  if (byId.size === 0) throw new Error(`${PACK_ID}: sources.json holds no sources.`);
  return { fetched: parsed.fetched, byId };
}

/** Where a source's own bytes live in the cache. */
export function cacheFile(cacheDir, source) {
  const name = new URL(source.url).pathname.split("/").pop() ?? "source";
  return join(cacheDir, `${source.id}${extname(name) || ".txt"}`);
}

/**
 * The digest over a book's shipped figures: one line per file, `name space
 * digest`, sorted by name, hashed as UTF-8 with a trailing newline.
 *
 * The book's HTML document is pinned by its own digest like every other source;
 * its figures are separate files, and pinning a hundred of them one entry at a
 * time would bury the licence evidence in a list nobody reads. One digest over
 * the set says the same thing — "these bytes and no others" — and a mismatch
 * prints the digest that was computed, so re-pinning it is one copy.
 */
export function figuresDigest(figures) {
  const lines = [...figures]
    .map((figure) => `${figure.name} ${figure.sha256}`)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return sha256(Buffer.from(`${lines.join("\n")}\n`, "utf8"));
}

/**
 * Bytes from the cache or the network, verified either way.
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
    const response = await options.fetchImpl(url, { headers: { "user-agent": "nexus-pack-builder" } });
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
 * A source's own bytes with the passages the plan removes taken out.
 *
 * A passage is removed here, before anything is parsed, so the article and the
 * oracle that is compared with it are looking at the SAME text: a passage hidden
 * between the two would be exactly the difference the fidelity test exists to
 * catch, and this builder must not be the thing that hides it. What was removed
 * is printed by the build, and `docs/packs/make.md` lists it with the reason the
 * plan gives.
 */
export function applyDrops(text, drops, label) {
  const removed = [];
  let out = text;
  for (const drop of drops ?? []) {
    // Every occurrence is removed and recorded, so a passage that a source
    // prints twice cannot leave one of them in the article.
    const pattern = new RegExp(drop.pattern.source, `${drop.pattern.flags.replace("g", "")}g`);
    const matches = out.match(pattern) ?? [];
    if (matches.length === 0) {
      throw new Error(`${PACK_ID}: ${label}: the passage to leave out is not in the source: ${String(drop.pattern)}`);
    }
    for (const match of matches) removed.push({ text: collapse(match), reason: drop.reason });
    out = out.replace(pattern, " ");
  }
  return { text: out, removed };
}

/** A book's HTML edition: the items every article of it is cut from. */
export async function loadBook(source, options) {
  const file = cacheFile(options.cacheDir, source);
  const { bytes, fetched } = await fetchSource(
    source.url,
    { file, bytes: source.bytes, sha256: source.sha256 },
    options,
  );
  const applied = applyDrops(ebookBody(bytes.toString("utf8")), options.drops?.get(source.id), source.id);
  const body = applied.text;
  const parsed = parseItems(body);
  options.log(
    `  ${source.id}: ${String(bytes.byteLength)} bytes, ${String(parsed.items.length)} items, ` +
      `${String(parsed.dropped.pageNumbers)} page numbers dropped` +
      `${parsed.dropped.uncaptionedImages > 0 ? `, ${String(parsed.dropped.uncaptionedImages)} uncaptioned images left out` : ""}` +
      `${fetched ? "" : " (cache)"}`,
  );
  for (const passage of applied.removed) options.log(`  ${source.id}: left out ${JSON.stringify(passage.text)}`);
  return { source, kind: source.kind, body, items: parsed.items, dropped: parsed.dropped, removed: applied.removed };
}

/** A scanned bulletin's OCR text, with the furniture census its reading reports. */
export async function loadOcr(source, options) {
  const file = cacheFile(options.cacheDir, source);
  const { bytes, fetched } = await fetchSource(
    source.url,
    { file, bytes: source.bytes, sha256: source.sha256 },
    options,
  );
  const applied = applyDrops(bytes.toString("utf8"), options.drops?.get(source.id), source.id);
  const text = applied.text;
  const { dropped } = documentLines(text, source.furniture);
  options.log(
    `  ${source.id}: ${String(bytes.byteLength)} bytes, ${String(text.length)} characters of OCR text, furniture ` +
      [...dropped].map(([rule, count]) => `${rule}=${String(count)}`).join(" ") +
      `${fetched ? "" : " (cache)"}`,
  );
  for (const passage of applied.removed) options.log(`  ${source.id}: left out ${JSON.stringify(passage.text)}`);
  return { source, kind: source.kind, text: applied.text, removed: applied.removed };
}

/** A Wikibooks page's wikitext. */
export async function loadWikitext(source, options) {
  const file = cacheFile(options.cacheDir, source);
  const { bytes, fetched } = await fetchSource(
    source.url,
    { file, bytes: source.bytes, sha256: source.sha256 },
    options,
  );
  const applied = applyDrops(bytes.toString("utf8"), options.drops?.get(source.id), source.id);
  const text = applied.text;
  if (/^\s*#redirect/im.test(text)) throw new Error(`${PACK_ID}: ${source.id} is a redirect, not a page.`);
  options.log(`  ${source.id}: ${String(bytes.byteLength)} bytes, ${String(text.length)} characters of wikitext${fetched ? "" : " (cache)"}`);
  for (const passage of applied.removed) options.log(`  ${source.id}: left out ${JSON.stringify(passage.text)}`);
  return { source, kind: source.kind, text, removed: applied.removed };
}

/**
 * The plan's jobs, flattened in the order the plan declares them.
 *
 * The plan is grouped into the pack's chapters, and an article may be a whole
 * document, a page, or a span of one; flattening carries the chapter path down
 * so the table of contents can be rebuilt from the shipped articles alone.
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
 * One job as an article: its blocks, the figures it keeps, and the source text
 * the fidelity test compares it with.
 */
export function articleFor(job, documents) {
  const document = documents.get(job.source);
  if (document === undefined) throw new Error(`${PACK_ID}: "${job.id}" names no source ${JSON.stringify(job.source)}.`);
  if (document.kind === "gutenberg-html") {
    if (job.at === undefined) throw new Error(`${PACK_ID}: "${job.id}" must name the heading it starts at.`);
    const span = sectionItems(document.items, job.at, { occurrence: job.occurrence, until: job.until });
    const end = document.items[span.to]?.offset ?? document.body.length;
    const fragment = document.body.slice(span.items[0]?.offset ?? 0, end);
    return {
      ...job,
      blocks: withTitle(itemsToBlocks(span.items), job.title, job.at),
      figures: span.items.filter((item) => item.kind === "figure" && item.file !== "").map((item) => item.file),
      sourceText: collapse(htmlWords(fragment)),
      stats: { items: span.items.length, bytes: fragment.length },
    };
  }
  if (document.kind === "ia-ocr") {
    if (job.at !== undefined) throw new Error(`${PACK_ID}: "${job.id}" is a whole-document source; "at" is not read for it.`);
    return {
      ...job,
      blocks: withTitle(ocrToBlocks(document.text, { furniture: document.source.furniture }), job.title),
      figures: [],
      sourceText: ocrWords(document.text, { furniture: document.source.furniture }),
      stats: { characters: document.text.length },
    };
  }
  const text = sectionSource(document.text, job.at);
  const converted = wikitextToBlocks(text);
  return {
    ...job,
    blocks: withTitle(converted.blocks, job.title),
    figures: [],
    dropped: converted.dropped,
    sourceText: wikitextWords(text),
    stats: { characters: text.length },
  };
}

/**
 * The article's own title as its first heading, at the level a book's title is
 * set at.
 *
 * A source prints its own title — a chapter's subject (`CHAPTER IV The Nature and
 * Properties of Clay`), a bulletin's masthead, a book's `DARNING` — and the pack
 * marks THAT heading as the article's title rather than writing one: the text a
 * reader sees is the source's, and what changes is where the heading sits in the
 * outline. A source that prints no heading matching the article's title keeps
 * the articles' own levels untouched; nothing is inserted, because a title this
 * builder wrote would be text the pack added.
 */
export function withTitle(blocks, title, at) {
  const wanted = [headingKey(title), at === undefined ? null : headingKey(at)];
  const index = blocks.findIndex(
    (block) => block.kind === "heading" && wanted.some((key) => key !== null && headingKey(block.text) === key),
  );
  if (index >= 0) blocks[index] = { ...blocks[index], level: 2 };
  return blocks;
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
  const markdown = assertReaderSubset(toMarkdown(article.blocks));
  const fromMarkdown = collapse(stripMarkup(markdown));
  const fromBlocks = collapse(plainText(article.blocks));
  if (fromMarkdown !== fromBlocks) {
    throw new Error(
      `${PACK_ID}: fidelity: ${article.id}: the Markdown and the blocks disagree\n` +
        `  markdown ${firstDifference(fromMarkdown, fromBlocks)}\n  blocks   ${firstDifference(fromBlocks, fromMarkdown)}`,
    );
  }
  if (fromBlocks !== collapse(article.sourceText)) {
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
    const match = rule.pattern.exec(text);
    if (match !== null) return { rule: rule.id, match: match[0] };
  }
  return null;
}

/**
 * The whole conversion: every source loaded, every article cut, proven and
 * swept. Nothing is written here; `main` writes, so a test can drive the
 * conversion with nothing on disk.
 */
export async function build(options) {
  const started = Date.now();
  const jobs = flattenPlan();
  // A passage the plan leaves out is removed from the SOURCE, before anything is
  // parsed, so the article and the oracle it is compared with never disagree
  // about a passage this builder chose to drop.
  const drops = new Map();
  for (const job of jobs) {
    if (job.drop === undefined) continue;
    drops.set(job.source, [...(drops.get(job.source) ?? []), ...job.drop]);
  }
  options.drops = drops;
  const documents = new Map();
  for (const source of options.sources.values()) {
    const load = source.kind === "gutenberg-html" ? loadBook : source.kind === "ia-ocr" ? loadOcr : loadWikitext;
    documents.set(source.id, await load(source, options));
  }
  for (const omission of OMISSIONS) {
    const document = documents.get(omission.source);
    if (document === undefined) throw new Error(`${PACK_ID}: omission "${omission.id}" names no source.`);
    if (!omissionPresent(document, omission)) {
      throw new Error(
        `${PACK_ID}: omission "${omission.id}" is not in ${omission.source}: ` +
          `${JSON.stringify(omission.heading)}. A list of what was left out must be checked, not trusted.`,
      );
    }
  }
  const articles = [];
  const omitted = [];
  for (const job of jobs) {
    const article = articleFor(job, documents);
    const forbidden = forbiddenMatch(article);
    if (forbidden !== null) {
      options.log(`  omitted "${article.id}": ${forbidden.rule} — ${JSON.stringify(forbidden.match)}`);
      omitted.push({ id: article.id, title: article.title, source: article.source, ...forbidden });
      continue;
    }
    articles.push(article);
  }
  return { articles, omitted, documents, elapsed: Date.now() - started };
}

/**
 * Every word of a document, in order, whether or not any article ships it: the
 * whole book as one string, which is what an omission is checked against.
 */
export function documentWords(document) {
  if (document.kind === "gutenberg-html") return collapse(plainText(itemsToBlocks(document.items)));
  return collapse(document.text);
}

/**
 * Whether an omission's heading is really in the source it names.
 *
 * A book prints a chapter's number and its subject as two headings over one
 * title (`CHAPTER II` over `Construction and Equipment of a Soap Plant`), so the
 * check is made against the document's whole text rather than against one
 * heading: a title written the way a reader would say it is exactly how a
 * document's words read once they are joined.
 */
function omissionPresent(document, omission) {
  return documentWords(document).toLowerCase().includes(collapse(omission.heading).toLowerCase());
}

/**
 * The `content.json` the Reader reads: the pack's chapters, only what shipped.
 *
 * The article paths carry their chapter folder, so a reader that walks the paths
 * and a reader that reads this file draw the same book — see `docs/packs/make.md`
 * for why the folder is part of the address rather than metadata beside it.
 */
export function buildToc(articles, sources) {
  const toc = [];
  for (const article of articles) {
    const source = sources.get(article.source);
    const entry = {
      id: article.id,
      title: article.title,
      file: article.path,
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
 * The metadata `pack-sign.mjs` takes: what the pack IS, never its file list.
 *
 * `notice` is ADR-100's safety declaration, and it travels with the pack for the
 * same reason `content.json` carries it: this text is reference material about
 * fire, blades and hot wax, and the Reader must be able to say so before the
 * first article is opened.
 */
export function buildMetadata(appVersion) {
  return {
    format: 1,
    id: PACK_ID,
    version: "2026.10.0",
    kind: "content",
    notice: "safety",
    title: { sr: "Popravke i izrada", en: "Mending and making by hand" },
    description: {
      sr: "Krpljenje i šivenje rukom, sveće i sapun, prost alat i njegovo održavanje, glina i pečenje. Iz državnih biltena Sjedinjenih Država i starih priručnika; tekst je izvorni, bez izmena.",
      en: "Mending and hand sewing, candles and soap, simple tools and their care, clay and firing, from US government bulletins and old manuals. The text is the source's own, unaltered.",
    },
    licence: {
      spdx: "LicenseRef-PD-and-CC-BY-SA-4.0",
      attribution:
        "Public-domain works: Farmers' Bulletins and other publications of the US Department of Agriculture, and " +
        "works not subject to copyright in the United States (17 U.S.C. 105(a)); Project Gutenberg editions whose " +
        "own rights statement is \"Public domain in the USA\". Wikibooks pages are used verbatim under " +
        "CC BY-SA 4.0 and are labelled in their own sections. Per-article attribution and the full licence " +
        "evidence: docs/packs/make.md.",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    source: { name: "US Department of Agriculture; Project Gutenberg; Wikibooks", url: "https://www.gutenberg.org/" },
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

/** Where a book's figures live: the edition's own folder, beside its HTML. */
export function figuresBase(source) {
  return `${source.url.slice(0, source.url.lastIndexOf("/"))}/images/`;
}

/**
 * One figure written into the pack.
 *
 * The bytes are the source's own drawing, re-encoded only where it is wider than
 * a page needs; nothing is cropped, and the caption travels in the Markdown
 * rather than in the image, so a reader who never loads the picture still reads
 * what the source said about it. The pack's own name for the file carries the
 * source id, because two books' `fig1.jpg` are two different drawings.
 */
export async function writeFigure(name, source, options) {
  const target = join(options.packDir, "images", name);
  const cached = join(options.cacheDir, "figures", name);
  if (!existsSync(cached)) {
    const url = figuresBase(source) + name.slice(source.id.length + 1);
    const response = await options.fetchImpl(url, { headers: { "user-agent": "nexus-pack-builder" } });
    if (response.ok !== true) throw new Error(`${PACK_ID}: ${url} answered ${String(response.status)}.`);
    mkdirSync(dirname(cached), { recursive: true });
    writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  }
  const image = sharp(cached);
  const metadata = await image.metadata();
  const pipeline =
    (metadata.width ?? 0) > FIGURE_MAX_PIXELS ? image.resize({ width: FIGURE_MAX_PIXELS, withoutEnlargement: true }) : image;
  const extension = extname(name).toLowerCase();
  const encoded =
    extension === ".png"
      ? pipeline.png({ compressionLevel: 9, palette: true })
      : extension === ".webp"
        ? pipeline.webp({ quality: 82 })
        : pipeline.jpeg({ quality: 82, mozjpeg: true });
  await encoded.toFile(target);
  return { name, bytes: readFileSync(target) };
}

/** A pack path as a path on this platform: the manifest's own `/`-separated form. */
export function packFile(packDir, path) {
  return join(packDir, ...path.split("/"));
}

/**
 * The article's path inside the pack: its chapter folder and its ordered file
 * name.
 *
 * The order prefix is not decoration: a reader that sorts a folder's files gets
 * the reading order the plan declares rather than the alphabet's, and the
 * chapter folder is what makes the pack a book rather than a pile of articles.
 */
export function articlePath(article, indexInChapter) {
  const chapter = article.groups[0]?.id ?? "articles";
  return `articles/${chapter}/${String(indexInChapter + 1).padStart(2, "0")}-${slugify(article.title)}.md`;
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
    await cutFixtures(options);
    return;
  }

  rmSync(paths.packDir, { recursive: true, force: true });
  mkdirSync(join(paths.packDir, "images"), { recursive: true });
  console.log(`${PACK_ID}: ${String(sources.byId.size)} sources, evidence dated ${sources.fetched}`);
  const converting = Date.now();
  const result = await build(options);
  const conversion = ((Date.now() - converting) / 1000).toFixed(1);
  const perChapter = new Map();
  const writtenFigures = new Map();
  const writtenPaths = new Set();
  let characters = 0;
  let figures = 0;
  for (const article of result.articles) {
    const markdown = fidelity(article);
    const source = sources.byId.get(article.source);
    const chapter = article.groups[0]?.id ?? "articles";
    article.path = articlePath(article, perChapter.get(chapter) ?? 0);
    perChapter.set(chapter, (perChapter.get(chapter) ?? 0) + 1);
    // Two articles that resolved to one file would leave one of them silently
    // unwritten, which is the kind of loss nothing downstream can see.
    if (writtenPaths.has(article.path)) throw new Error(`${PACK_ID}: two articles share the path ${article.path}.`);
    writtenPaths.add(article.path);
    mkdirSync(dirname(packFile(paths.packDir, article.path)), { recursive: true });
    writeFileSync(packFile(paths.packDir, article.path), `${markdown}\n${sourceLine(source, article)}\n`);
    for (const name of article.figures) {
      const written = await writeFigure(`${source.id}-${name}`, source, options);
      writtenFigures.set(source.id, [...(writtenFigures.get(source.id) ?? []), { name, bytes: written.bytes }]);
      figures += 1;
    }
    characters += markdown.length;
    console.log(
      `  ${article.path.padEnd(60)} ${String(article.blocks.length).padStart(4)} blocks ` +
        `${String(article.figures.length).padStart(3)} figures ${String(markdown.length).padStart(7)} chars`,
    );
  }

  // What the figures came to, against the digest `sources.json` pins for each
  // book: the pin is what makes a figure part of the evidence rather than a
  // picture fetched from wherever the URL happened to point today.
  const mismatched = [];
  for (const [sourceId, written] of writtenFigures) {
    const source = sources.byId.get(sourceId);
    const digest = figuresDigest(written.map((item) => ({ name: item.name, sha256: sha256(item.bytes) })));
    if (digest !== source.figuresSha256) {
      mismatched.push(`${sourceId}: ${String(written.length)} figures, digest ${digest} (sources.json pins ${source.figuresSha256})`);
    }
  }
  if (mismatched.length > 0) {
    throw new Error(
      `${PACK_ID}: the figure pins do not match what was fetched. Update them deliberately, or do not build:\n  ` +
        mismatched.join("\n  "),
    );
  }

  writeFileSync(
    join(paths.packDir, "content.json"),
    `${JSON.stringify({ layout: 1, language: "en", notice: "safety", toc: buildToc(result.articles, sources.byId) }, null, 2)}\n`,
  );
  writeFileSync(paths.metaPath, `${JSON.stringify(buildMetadata(appVersion()), null, 2)}\n`);

  console.log("-- what the pack deliberately does not carry");
  for (const omission of OMISSIONS) console.log(`  ${omission.source}: ${omission.heading} — ${omission.reason}`);
  for (const document of result.documents.values()) {
    for (const passage of document.removed ?? []) {
      console.log(`  ${document.source.id}: passage left out: ${JSON.stringify(passage.text)}`);
      console.log(`    because: ${passage.reason}`);
    }
  }
  const total = directorySize(paths.packDir);
  console.log(`articles: ${String(result.articles.length)} written, ${String(result.omitted.length)} omitted`);
  console.log(`text: ${String(characters)} characters; figures: ${String(figures)}`);
  console.log(`pack: ${kib(total.bytes)} in ${String(total.files)} files -> ${paths.packDir}`);
  console.log(`metadata: ${paths.metaPath} (kind content, notice safety, minAppVersion ${appVersion()})`);
  console.log(`build: ${conversion} s of fetch+convert`);
  console.log(
    `sign with: node scripts/pack-sign.mjs --dir ${paths.packDir} --meta ${paths.metaPath} --key <release-key.pem>`,
  );
}

/**
 * Re-cuts the test fixtures from the cached sources.
 *
 * A fixture is a few kilobytes of one real source, cut from the file the build
 * reads: a chapter of a Project Gutenberg edition as the edition's own HTML, a
 * run of OCR lines from a bulletin, and a Wikibooks page's wikitext. Cutting
 * them here rather than by hand is what keeps them the source's own data;
 * `fixtures/README.md` records the provenance and licence of each.
 */
async function cutFixtures(options) {
  const cuts = [
    {
      id: "carpentry-chapter-ii",
      source: "carpentry-for-boys",
      kind: "html",
      at: "CHAPTER II",
      until: "CHAPTER III",
      bytes: 12000,
    },
    { id: "abcs-of-mending", source: "farmers-bulletin-1925", kind: "ocr", bytes: 6000 },
    { id: "candlemaking", source: "wikibooks-candlemaking", kind: "wikitext", bytes: 4000 },
  ];
  for (const cut of cuts) {
    const source = options.sources.get(cut.source);
    const { bytes } = await fetchSource(
      source.url,
      { file: cacheFile(options.cacheDir, source), bytes: source.bytes, sha256: source.sha256 },
      options,
    );
    const text = bytes.toString("utf8");
    if (cut.kind === "html") {
      const body = ebookBody(text);
      // Start at the TAG that sets the heading, not at the words inside it: a
      // slice that began inside `<h2>` would hand the parser a stray `</h2>` and
      // the fixture would test a fragment no edition ever wrote.
      const from = body.lastIndexOf("<h", body.indexOf(cut.at));
      const to = body.indexOf(cut.until, from);
      if (from < 0 || to < 0) throw new Error(`${PACK_ID}: fixture ${cut.id}: ${cut.at} or ${cut.until} not found.`);
      // Cut whole elements: a fixture that ended inside a tag would be a fragment
      // no edition ever wrote, and the parser's answer about it would say nothing
      // about the real book.
      const window = body.slice(from, Math.min(to, from + cut.bytes));
      const end = window.lastIndexOf("</p>");
      const slice = end < 0 ? window : window.slice(0, end + 4);
      writeFileSync(join(FIXTURES_DIR, `${cut.id}.html`), `${slice}\n`);
      options.log(`  fixture ${cut.id}.html: ${String(slice.length)} bytes`);
      continue;
    }
    const extension = cut.kind === "ocr" ? "txt" : "wikitext";
    const window = text.slice(0, cut.bytes);
    // End on a line the source ended: an office document's fixture that stopped
    // mid-line would test the converter with a paragraph no page ever set.
    const end = window.lastIndexOf("\n\n");
    const slice = end < 0 ? window : window.slice(0, end + 2);
    writeFileSync(join(FIXTURES_DIR, `${cut.id}.${extension}`), `${slice}\n`);
    options.log(`  fixture ${cut.id}.${extension}: ${String(slice.length)} bytes of ${String(text.length)}`);
  }
  options.log(`fixtures written to ${FIXTURES_DIR}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
