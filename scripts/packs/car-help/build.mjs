// The Car help pack's builder.
//
//   node scripts/packs/car-help/build.mjs               # build the pack
//   node scripts/packs/car-help/build.mjs --evidence    # re-measure and refill sources.json's digests
//   node scripts/packs/car-help/build.mjs --fixtures    # re-cut the test fixtures
//   node scripts/packs/car-help/build.mjs --corrections # print docs/packs/car-help.md's OCR table
//
// WHAT IT DOES. Downloads every source `sources.json` names into
// `%TEMP%\nexus-pack-cache\car-help\`, verifies each download against the
// SHA-256 and size that file records, converts each source to CommonMark, proves
// the fidelity of every article, and writes the pack folder to
// `%TEMP%\nexus-packs\car-help\` with the metadata `pack-sign.mjs` takes BESIDE
// that folder. Re-running reuses the cache; a cached file whose digest no longer
// matches the evidence is discarded and fetched again.
//
// THE SAFETY RULES ARE GATES HERE, NOT NOTES. Every article's Markdown is
// compared with the source span it came from (`stripMarkup(markdown)` equals
// that span's text, whitespace collapsed) and the block list is compared with the
// same span read out of the page; a correction whose OCR text is not on its page,
// and a licence sentence that is not on the page that states it, both stop the
// build. The only Markdown this builder adds is markup, the section's provenance
// article, and one Source line per article.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { firstDifference, plainText, stripMarkup, toMarkdown } from "./blocks.mjs";
import { applyCorrections, CORRECTIONS, correctionsTable } from "./corrections.mjs";
import { articleHtml, htmlParse, sliceEntries } from "./html.mjs";
import { assertFurnitureOnly, normalisePage, parseDjvu, spanText, toBlocks } from "./ocr.mjs";
import { OMITTED, PACK_ID, PACK_VERSION, provenanceMarkdown, SECTIONS, sourceLine } from "./plan.mjs";
import { collapse } from "./text.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const SOURCES_FILE = join(HERE, "sources.json");
const FIXTURES_DIR = join(HERE, "fixtures");

/** The only `sources.json` layout this builder reads. */
export const SOURCES_LAYOUT = 1;

/** Where the page images of the two scanned manuals live, for a human checking a correction against the scan. */
export const FM_SCAN_URL =
  "https://archive.org/download/fm-21-305-manual-for-the-wheeled-vehicle-driver-1993/page/n<leaf>.jpg";
export const TM_SCAN_URL =
  "https://archive.org/download/tm-9-8000-principles-of-automotive-vehicles-1985/page/n<leaf>.jpg";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Where the cache, the pack and the metadata live. All under `%TEMP%`. */
export function outputPaths() {
  return {
    cacheDir: join(tmpdir(), "nexus-pack-cache", PACK_ID),
    packDir: join(tmpdir(), "nexus-packs", PACK_ID),
    metaPath: join(tmpdir(), "nexus-packs", `${PACK_ID}.meta.json`),
  };
}

/**
 * `sources.json`, checked.
 *
 * Every source carries a licence and the sentence that licence was read from,
 * because a source without evidence is not used. `licenceUrl` is the page that
 * STATES the licence and `licenceQuote` is the sentence on it; `evidence` quotes
 * what identifies the WORK, read from the source's own bytes or from another
 * source listed here.
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
    for (const field of [
      "id",
      "kind",
      "title",
      "credit",
      "url",
      "file",
      "cacheFile",
      "licence",
      "licenceUrl",
      "licenceQuote",
    ]) {
      if (typeof source?.[field] !== "string" || source[field].length === 0) {
        throw new Error(`${PACK_ID}: a source is missing "${field}".`);
      }
    }
    if (!["html", "ocr", "metadata", "reference"].includes(source.kind)) {
      throw new Error(`${PACK_ID}: "${source.id}" has kind ${JSON.stringify(source.kind)}.`);
    }
    if (!["article", "metadata-fields", "file"].includes(source.pinned)) {
      throw new Error(`${PACK_ID}: "${source.id}" has no rule for the bytes its digest pins.`);
    }
    if (source.kind === "html" && source.pinned !== "article") {
      throw new Error(`${PACK_ID}: "${source.id}" is a page, so its digest pins its article element.`);
    }
    if (!Array.isArray(source.evidence) || source.evidence.length === 0) {
      throw new Error(`${PACK_ID}: "${source.id}" has no evidence.`);
    }
    for (const entry of source.evidence) {
      if (!["document", "cross-reference"].includes(entry?.in)) {
        throw new Error(`${PACK_ID}: "${source.id}" has evidence from ${JSON.stringify(entry?.in)}.`);
      }
      if (typeof entry.quote !== "string" || collapse(entry.quote).length < 20) {
        throw new Error(`${PACK_ID}: "${source.id}" has empty evidence.`);
      }
      if (entry.in === "cross-reference" && typeof entry.source !== "string") {
        throw new Error(`${PACK_ID}: "${source.id}" cites another source without naming it.`);
      }
    }
    if (source.kind === "ocr" && !Array.isArray(source.vocabulary)) {
      throw new Error(`${PACK_ID}: "${source.id}" needs its running-head vocabulary.`);
    }
    if (source.kind === "html" && source.region !== "article") {
      throw new Error(`${PACK_ID}: "${source.id}" needs the region its text is taken from.`);
    }
    if (byId.has(source.id)) throw new Error(`${PACK_ID}: "${source.id}" is listed twice.`);
    byId.set(source.id, source);
  }
  if (byId.size === 0) throw new Error(`${PACK_ID}: sources.json holds no sources.`);
  for (const source of byId.values()) {
    if (licenceSource(source, byId) === undefined) {
      throw new Error(
        `${PACK_ID}: "${source.id}" states its licence at ${source.licenceUrl}, which no source in sources.json pins.`,
      );
    }
    for (const entry of source.evidence) {
      if (entry.in === "cross-reference" && !byId.has(entry.source)) {
        throw new Error(`${PACK_ID}: "${source.id}" cites ${entry.source}, which is not a source.`);
      }
    }
  }
  return { fetched: parsed.fetched, byId };
}

/** The source whose URL is where this source's licence is stated. */
function licenceSource(source, byId) {
  for (const candidate of byId.values()) {
    if (candidate.url === source.licenceUrl) return candidate;
  }
  return undefined;
}

/** Where a source's bytes live in the cache. */
export function cacheFile(cacheDir, source) {
  return join(cacheDir, source.cacheFile);
}

function verify(bytes, url, expected) {
  const digest = sha256(bytes);
  if (expected.sha256 !== "" && (digest !== expected.sha256 || bytes.byteLength !== expected.bytes)) {
    throw new Error(
      `${PACK_ID}: ${url} is ${String(bytes.byteLength)} bytes / ${digest}, and sources.json records ` +
        `${String(expected.bytes)} / ${expected.sha256}. Update the evidence deliberately, or do not build.`,
    );
  }
  return digest;
}

/**
 * A source's bytes, from the cache or the network, verified either way.
 *
 * The cache is not trusted: a cached file whose digest disagrees is treated as
 * absent. A download that disagrees with the recorded digest is a refusal, and
 * the message carries what was found, because the two legitimate answers — the
 * source really changed, or something is serving another page — are told apart
 * by exactly that.
 *
 * WHAT THE DIGEST PINS is the article ELEMENT of an HTML page, not the response
 * that carried it. Measured: two fetches of the same Wayback snapshot served
 * 262,243 and 262,242 bytes — the playback envelope moved by one byte while the
 * archived page did not — so pinning the envelope would refuse a source that has
 * not changed. The whole response is what the cache keeps, because a licence
 * quote is a fact about the page and not about the span a pack is made of.
 *
 * `--evidence` is the one mode that skips the comparison: it is the act of
 * measuring the sources again, and a check that refused to measure would never
 * be able to follow a source that legitimately changed.
 */
export async function fetchSource(source, options) {
  const file = cacheFile(options.cacheDir, source);
  const expected = { bytes: source.bytes, sha256: source.sha256 };
  let bytes = existsSync(file) ? readFileSync(file) : null;
  if (options.trust !== true && bytes !== null && source.sha256 !== "" && sha256(pinnedBytes(source, bytes)) !== source.sha256) {
    bytes = null;
  }
  let fetched = false;
  if (bytes === null) {
    const response = await options.fetchImpl(source.file, { headers: { "user-agent": "nexus-pack-builder" } });
    if (response.ok !== true) throw new Error(`${PACK_ID}: ${source.file} answered ${String(response.status)}.`);
    bytes = Buffer.from(await response.arrayBuffer());
    fetched = true;
  }
  const pinned = pinnedBytes(source, bytes);
  const digest = options.trust === true ? sha256(pinned) : verify(pinned, source.file, expected);
  if (fetched) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  options.log(
    `  ${source.id}: ${String(pinnedBytes(source, bytes).byteLength).padStart(9)} B pinned ` +
      `(${String(bytes.byteLength)} B read)  ${fetched ? "net  " : "cache"}  ${source.file}`,
  );
  return { bytes, fetched, digest };
}

/**
 * The bytes a source's digest covers.
 *
 * Three answers, and each is the part a pack's claim actually rests on:
 *
 *   * an HTML page's article ELEMENT — the Wayback envelope moved between
 *     fetches of the same snapshot (measured: NHTSA's page came back as 262,243,
 *     262,242 and 262,240 bytes; Ready.gov's as 65,053 and 65,046) while the
 *     archived page did not;
 *   * an Internet Archive item's metadata FIELDS the pack cites — the item's
 *     `item_last_updated` moved between two fetches, and the licence it states
 *     did not;
 *   * otherwise the file itself.
 *
 * A pin that covered the moving parts would refuse a source that has not
 * changed, and a check nobody can keep green is a check nobody runs.
 */
export function pinnedBytes(source, bytes) {
  if (source.pinned === "article") {
    const region = articleHtml(bytes.toString("utf8"));
    if (region === null) throw new Error(`${PACK_ID}: ${source.id} has no <article> element to pin.`);
    return Buffer.from(region, "utf8");
  }
  if (source.pinned === "metadata-fields") {
    const metadata = JSON.parse(bytes.toString("utf8")).metadata ?? {};
    const cited = {};
    for (const key of ["identifier", "title", "creator", "date", "licenseurl"]) cited[key] = metadata[key] ?? null;
    return Buffer.from(JSON.stringify(cited), "utf8");
  }
  return bytes;
}

/**
 * A source's cached bytes as a document the converter can read.
 *
 * `plain` is the whole document's readable text, which is what a licence quote
 * is checked against: the licence is a property of the PAGE, not of the span a
 * pack happens to be made of, so the check reads the page and not the article.
 */
export function loadSource(source, bytes) {
  const raw = bytes.toString("utf8");
  if (source.kind === "html") {
    const region = articleHtml(raw);
    if (region === null) throw new Error(`${PACK_ID}: ${source.id} has no <article> element to read.`);
    const { text, entries } = htmlParse(region, { skipClasses: source.skipClasses });
    return {
      source,
      kind: "html",
      text,
      entries,
      plain: collapse(htmlParse(raw).text),
      raw: bytes,
      pinned: pinnedBytes(source, bytes),
    };
  }
  if (source.kind === "ocr") {
    const pages = parseDjvu(raw);
    const normalised = new Map();
    for (const page of pages) {
      const result = normalisePage(page, { vocabulary: source.vocabulary });
      assertFurnitureOnly(result.dropped, source.id, source.vocabulary);
      normalised.set(page.leaf, { leaf: page.leaf, label: result.label, lines: result.lines });
    }
    applyCorrections([...normalised.values()], source.id, () => {});
    // The text a licence quote is checked against is the CORRECTED text: the
    // corrections are what the pack ships, so an evidence sentence that the OCR
    // mangled is a sentence this build really does carry.
    const plain = collapse(
      [...normalised.values()].map((page) => page.lines.map((line) => line.text).join(" ")).join(" "),
    );
    return { source, kind: "ocr", pages: normalised, rawPages: pages, plain, raw: bytes, pinned: pinnedBytes(source, bytes) };
  }
  return { source, kind: source.kind, plain: collapse(htmlParse(raw).text), raw: bytes, pinned: pinnedBytes(source, bytes) };
}

/**
 * The licence evidence, checked against the bytes the build hashed.
 *
 * A quote that is not on the page it is attributed to is a licence claim this
 * build cannot stand behind, so it stops the build rather than shipping.
 */
export function checkEvidence(documents) {
  const byUrl = new Map();
  for (const document of documents.values()) byUrl.set(document.source.url, document);
  for (const document of documents.values()) {
    const source = document.source;
    const stated = byUrl.get(source.licenceUrl);
    if (stated === undefined) {
      throw new Error(`${PACK_ID}: "${source.id}": ${source.licenceUrl} is not a source of this pack.`);
    }
    if (!stated.plain.includes(collapse(source.licenceQuote))) {
      throw new Error(
        `${PACK_ID}: "${source.id}": the licence sentence is not on ${source.licenceUrl}:\n  ${source.licenceQuote}`,
      );
    }
    for (const entry of source.evidence) {
      const target = entry.in === "document" ? document : documents.get(entry.source);
      if (target === undefined || !target.plain.includes(collapse(entry.quote))) {
        throw new Error(`${PACK_ID}: "${source.id}": the evidence quote is not where it says it is:\n  ${entry.quote}`);
      }
    }
  }
}

/** The lines of one OCR span: from the `from` line to (not including) the `to` line. */
export function spanLines(document, span) {
  const page = pageOfLabel(document, span.page);
  const from = page.lines.findIndex((line) => line.text.startsWith(span.from));
  if (from < 0) throw new Error(`${PACK_ID}: page ${span.page} has no line starting ${JSON.stringify(span.from)}.`);
  if (span.to === undefined) return page.lines.slice(from);
  const to = page.lines.findIndex((line, index) => index > from && line.text.startsWith(span.to));
  if (to < 0) throw new Error(`${PACK_ID}: page ${span.page} has no line starting ${JSON.stringify(span.to)}.`);
  return page.lines.slice(from, to);
}

/** A printed page number as the page the extractor found it on. */
function pageOfLabel(document, label) {
  for (const page of document.pages.values()) {
    if (page.label === label) return page;
  }
  throw new Error(`${PACK_ID}: "${document.source.id}" has no page labelled ${JSON.stringify(label)}.`);
}

/**
 * One plan article as blocks, plus the source text those blocks must equal.
 *
 * The two come from the same source span and are computed differently on
 * purpose: the blocks are what the converter writes, and `sourceText` is the
 * span read out of the page (for HTML, the characters between the first and the
 * last block of the slice). `fidelity` is the comparison.
 */
export function articleOf(plan, document) {
  if (document.kind === "html") {
    const blocks = [];
    const parts = [];
    let after = 0;
    for (const span of plan.spans) {
      const slice = sliceEntries(document.entries, span, after);
      if (slice.entries.length === 0) continue;
      blocks.push(...slice.entries.map((entry) => entry.block));
      // Each span contributes its OWN slice of the page's text. Reading from the
      // first span's start to the last span's end would pull in whatever the
      // page prints between them, which the article does not carry.
      parts.push(
        document.text.slice(slice.entries[0].start, slice.entries[slice.entries.length - 1].end),
      );
      after = slice.next;
    }
    if (blocks.length === 0) throw new Error(`${PACK_ID}: "${plan.id}" selects no blocks.`);
    return { ...plan, blocks, sourceText: collapse(parts.join(" ")) };
  }
  const lines = plan.spans.flatMap((span) => spanLines(document, span));
  if (lines.length === 0) throw new Error(`${PACK_ID}: "${plan.id}" selects no lines.`);
  return { ...plan, blocks: toBlocks(lines, { declared: plan.declared }), sourceText: spanText(lines) };
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
  const fromMarkdown = collapse(stripMarkup(markdown));
  const fromBlocks = collapse(plainText(article.blocks));
  if (fromMarkdown !== fromBlocks) {
    throw new Error(
      `${PACK_ID}: fidelity: ${article.id}: the Markdown and the blocks disagree\n` +
        `  markdown ${firstDifference(fromMarkdown, fromBlocks)}\n  blocks   ${firstDifference(fromBlocks, fromMarkdown)}`,
    );
  }
  if (fromBlocks !== article.sourceText) {
    throw new Error(
      `${PACK_ID}: fidelity: ${article.id}: the article and the source span disagree\n` +
        `  article ${firstDifference(fromBlocks, article.sourceText)}\n` +
        `  source  ${firstDifference(article.sourceText, fromBlocks)}`,
    );
  }
  return markdown;
}

/** The `content.json` the Reader reads: one language, the safety notice, and the plan's shape. */
export function buildContent(toc) {
  return { layout: 1, language: "en", notice: "safety", toc };
}

/** The table of contents: the plan's shape, only what was shipped. */
export function buildToc(articles, sources) {
  const toc = [];
  for (const section of SECTIONS) {
    const children = section.articles.map((plan) => {
      const article = articles.get(plan.id);
      const source = sources.get(article.source);
      return {
        id: article.id,
        title: article.title,
        file: `articles/${article.id}.md`,
        source: { title: source.credit, url: source.url },
      };
    });
    children.push({
      id: `${section.id}-sources`,
      title: "Sources",
      file: `articles/${section.id}-sources.md`,
    });
    toc.push({ id: section.id, title: section.title, children });
  }
  return toc;
}

/** The metadata `pack-sign.mjs` takes: what the pack IS, never its file list. */
export function buildMetadata(appVersion) {
  return {
    format: 1,
    id: PACK_ID,
    version: PACK_VERSION,
    kind: "content",
    title: { sr: "Pomo\u0107 na putu", en: "Car help" },
    description: {
      sr: "\u0160ta uraditi kad guma padne, akumulator je prazan, motor se pregreva ili se upali lampica na tabli \u2014 ameri\u010dki dr\u017eavni izvori, tekst nije menjan.",
      en: "What to do about a flat tyre, a dead battery, an overheating engine and a warning light on the dashboard \u2014 US Government sources, printed word for word.",
    },
    licence: {
      spdx: "LicenseRef-PD-USGov",
      attribution:
        'US Government works, not subject to copyright in the United States (17 U.S.C. 105(a)): NHTSA "Tires" ' +
        '(TireWise) and Ready.gov "Car Safety"; US Army FM 21-305 / AFMAN 24-306 (1993) and TM 9-8000 (1985). ' +
        "Per-article attribution, the licence evidence and the OCR corrections table: docs/packs/car-help.md.",
      url: "https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm",
    },
    source: {
      name: "NHTSA; FEMA (Ready.gov); US Department of the Army",
      url: "https://www.nhtsa.gov/vehicle-safety/tires",
    },
    minAppVersion: appVersion,
  };
}

/** `apps/desktop`'s version, the floor a pack has to be installable in. */
export function appVersion() {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "apps", "desktop", "package.json"), "utf8"));
  if (typeof manifest.version !== "string") throw new Error(`${PACK_ID}: no app version to floor on.`);
  return manifest.version;
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
  const parsed = assertSources(JSON.parse(readFileSync(SOURCES_FILE, "utf8")));
  const options = {
    ...paths,
    sources: parsed.byId,
    fetchImpl: fetch,
    // See `fetchSource`: `--evidence` exists to measure the sources again, so it
    // is the only mode that does not compare against the recorded digest first.
    trust: process.argv.includes("--evidence"),
    log: (line) => {
      console.log(line);
    },
  };
  mkdirSync(paths.cacheDir, { recursive: true });
  console.log(`${PACK_ID} ${PACK_VERSION}: ${String(parsed.byId.size)} sources, evidence dated ${parsed.fetched}`);
  console.log("fetched:");
  const started = Date.now();

  const documents = new Map();
  for (const source of options.sources.values()) {
    const { bytes, digest } = await fetchSource(source, options);
    documents.set(source.id, { ...loadSource(source, bytes), digest });
  }
  checkEvidence(documents);

  if (process.argv.includes("--evidence")) {
    writeEvidence(documents);
    return;
  }
  if (process.argv.includes("--fixtures")) {
    cutFixtures(documents);
    return;
  }
  if (process.argv.includes("--corrections")) {
    printCorrections();
    return;
  }

  rmSync(paths.packDir, { recursive: true, force: true });
  mkdirSync(join(paths.packDir, "articles"), { recursive: true });
  const articles = new Map();
  let characters = 0;
  for (const section of SECTIONS) {
    for (const plan of section.articles) {
      const article = articleOf(plan, documents.get(plan.source));
      const markdown = fidelity(article);
      articles.set(article.id, article);
      const source = options.sources.get(article.source);
      writeFileSync(
        join(paths.packDir, "articles", `${article.id}.md`),
        `${markdown}\n\n${sourceLine(source, article)}\n`,
      );
      characters += markdown.length;
      console.log(
        `  ${article.id.padEnd(28)} ${String(article.blocks.length).padStart(3)} blocks ` +
          `${String(markdown.length).padStart(6)} chars  ${article.source}`,
      );
    }
    const sectionArticles = section.articles.map((plan) => articles.get(plan.id));
    writeFileSync(
      join(paths.packDir, "articles", `${section.id}-sources.md`),
      `${provenanceMarkdown(section, sectionArticles, options.sources, parsed.fetched)}\n`,
    );
  }

  writeFileSync(
    join(paths.packDir, "content.json"),
    `${JSON.stringify(buildContent(buildToc(articles, options.sources)), null, 2)}\n`,
  );
  writeFileSync(paths.metaPath, `${JSON.stringify(buildMetadata(appVersion()), null, 2)}\n`);

  console.log("-- what the pack leaves out");
  for (const item of OMITTED) console.log(`  ${item.what}: ${item.why}`);
  const total = directorySize(paths.packDir);
  console.log(`articles: ${String(articles.size)} + ${String(SECTIONS.length)} provenance`);
  console.log(`text: ${String(characters)} characters; corrections in the table: ${String(CORRECTIONS.length)}`);
  console.log(`pack: ${kib(total.bytes)} in ${String(total.files)} files -> ${paths.packDir}`);
  console.log(`metadata: ${paths.metaPath} (kind content, minAppVersion ${appVersion()})`);
  console.log(`build: ${((Date.now() - started) / 1000).toFixed(1)} s of fetch+convert`);
  console.log(
    `sign with: node scripts/pack-sign.mjs --dir ${paths.packDir} --meta ${paths.metaPath} --key <release-key.pem>`,
  );
}

/** `--corrections`: the table `docs/packs/car-help.md` prints, generated from the table the build applies. */
function printCorrections() {
  for (const source of ["fm-21-305", "tm-9-8000"]) {
    console.log(`\n### ${source}\n`);
    console.log(correctionsTable(source, source === "fm-21-305" ? FM_SCAN_URL : TM_SCAN_URL));
  }
}

/** `--evidence`: the digest and size of every source as it was fetched, written back into sources.json. */
function writeEvidence(documents) {
  const parsed = JSON.parse(readFileSync(SOURCES_FILE, "utf8"));
  for (const source of parsed.sources) {
    const document = documents.get(source.id);
    source.bytes = document.pinned.byteLength;
    source.sha256 = document.digest;
  }
  writeFileSync(SOURCES_FILE, `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`wrote ${String(parsed.sources.length)} digests into ${SOURCES_FILE}`);
}

/**
 * `--fixtures`: the small slices of the real sources the tests convert.
 *
 * A fixture is one page of a scanned manual as the extractor's own lines and
 * boxes (a few KB of JSON, so the normaliser, the corrections and the block
 * builder are the code under test), and one section of an HTML page as the exact
 * bytes the tokeniser reads. `fixtures/README.md` records where each came from
 * and the licence it is cut under.
 */
function cutFixtures(documents) {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const fm = documents.get("fm-21-305");
  const page = [...fm.pages.values()].find((candidate) => candidate.label === "17-4");
  if (page === undefined) throw new Error(`${PACK_ID}: the FM source has no page 17-4.`);
  const rawPage = fm.rawPages[page.leaf];
  writeFileSync(
    join(FIXTURES_DIR, "fm-21-305-17-4.json"),
    `${JSON.stringify(
      {
        source: "fm-21-305",
        leaf: rawPage.leaf,
        label: page.label,
        width: rawPage.width,
        height: rawPage.height,
        lines: rawPage.lines,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`  fixture fm-21-305 page 17-4: ${String(rawPage.lines.length)} raw lines`);

  const cuts = [
    {
      source: "nhtsa-tires",
      from: "Tire Blowouts",
      to: "Tire Pressure Monitoring System (TPMS)",
      file: "nhtsa-tires-blowouts.html",
    },
    {
      source: "nhtsa-tires",
      from: "Maintaining Proper Tire Pressure",
      to: "Tire Blowouts",
      file: "nhtsa-tires-pressure.html",
    },
    { source: "ready-car", from: "Emergency Kit for the Car", to: "Car Safety Tips", file: "ready-car-kit.html" },
  ];
  for (const cut of cuts) {
    // The slice comes out of the REGION the converter reads, not out of the
    // whole response: ready.gov prints its section headings in a navigation
    // block too, and a fixture cut from there would be a fixture of the menu.
    const region = articleHtml(documents.get(cut.source).raw.toString("utf8"));
    if (region === null) throw new Error(`${PACK_ID}: ${cut.source} has no article region.`);
    const fragment = sliceHtml(region, cut.from, cut.to);
    writeFileSync(join(FIXTURES_DIR, cut.file), `${fragment}\n`);
    console.log(`  fixture ${cut.source} ${JSON.stringify(cut.from)}: ${String(fragment.length)} bytes`);
  }
  console.log(`fixtures written to ${FIXTURES_DIR}`);
}

/** The bytes of the section between two headings of an HTML region, cut on the heading's own tag. */
export function sliceHtml(region, from, to) {
  const at = region.indexOf(from);
  if (at < 0) throw new Error(`${PACK_ID}: the fixture's start heading is not in the region: ${from}`);
  const openAt = region.lastIndexOf("<h", at);
  const endAt = region.indexOf(to, at);
  if (endAt < 0) throw new Error(`${PACK_ID}: the fixture's end heading is not in the region: ${to}`);
  const closeAt = region.lastIndexOf("<h", endAt);
  return region.slice(openAt < 0 ? at : openAt, closeAt < 0 ? endAt : closeAt);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
