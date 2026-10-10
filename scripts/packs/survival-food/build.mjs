// The Food chapter's pack builder: download, convert, verify, write.
//
//   node scripts/packs/survival-food/build.mjs            build both packs
//   node scripts/packs/survival-food/build.mjs --measure   print the type-size
//                                                          and baseline-step
//                                                          measurements the
//                                                          converter's constants
//                                                          are derived from
//
// WHERE THINGS GO, and why the repository holds none of it beyond the small
// fixtures its tests use: sources are cached under `%TEMP%\nexus-pack-cache\
// survival-food\`, the packs are written to `%TEMP%\nexus-packs\<id>\`, and
// `sources.json` beside this file records every source's URL, fetch date,
// SHA-256, licence and the licence evidence. Re-running the builder reuses the
// cache and re-derives everything from it, so a run costs no network at all.
//
// WHAT A RUN PROVES, before it writes a byte of pack:
//
//  1. every licence claim is on the page it cites (the sentence, verbatim);
//  2. every glyph run of every USDA guide is in exactly one block of the
//     converted document (`documentFindings`), and every table cell holds the
//     runs that were printed in it (`tableFindings`);
//  3. every article's Markdown, with its markup stripped, is the source text.
//
// A failure at any of the three stops the run.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { connect as connectHttp2 } from "node:http2";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { blocksToMarkdown, blocksToText } from "./lib/blocks.mjs";
import {
  documentBodyHeight,
  documentBlocks,
  documentFindings,
  findFurniture,
  finishLines,
  openDocument,
  readPage,
  tableFindings,
  toLines,
} from "./lib/pdf.mjs";
import { writeContentPack, writeDatasetPack, writeMetadata } from "./lib/pack.mjs";
import { recipesFrom } from "./lib/recipes.mjs";
import { CDC_NOTICE, FURTHER_READING, LICENCES, LINK_LICENCES, SOURCES } from "./lib/sources.mjs";
import { normalise, stripMarkup, textToBlocks } from "./lib/text.mjs";
import { parseHtml, selectMain, textContent, toMarkdown } from "./lib/html.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(process.env.TEMP ?? process.env.TMP ?? ".", "nexus-pack-cache", "survival-food");
const OUT = join(process.env.TEMP ?? process.env.TMP ?? ".", "nexus-packs");
const CACHE_INDEX = join(CACHE, "index.json");
/**
 * The application version a pack needs.
 *
 * The Reader, its safety notice and the pack installer all arrive in the release
 * after the current one (`apps/desktop/package.json` says 1.5.0), so a pack that
 * asked for 1.5.0 would install into a build that cannot read it. The maintainer
 * sets the final number when signing; 1.6.0 is the smallest number that can be
 * right and is the one ADR-091's own manifest example uses.
 */
const MIN_APP_VERSION = "1.6.0";

/**
 * The pack's own version, and the date of the run that produced its content.
 *
 * The date is a fact about this pack's sources — every URL in `sources.json` was
 * read on it — so it is recorded rather than computed from the machine's clock.
 * A rebuild that fetched nothing new keeps the date it records.
 */
const PACK_VERSION = "2026.10.10";

/**
 * The two `--meta` files `scripts/pack-sign.mjs` reads.
 *
 * `licence.attribution` is required by ADR-091 and is always shown, so it names
 * the works and the fact that they arrived unmodified; the pack is a
 * public-domain compilation and its SPDX-independent identifier says so.
 */
const METADATA = {
  "survival-food": {
    format: 1,
    id: "survival-food",
    version: PACK_VERSION,
    kind: "content",
    title: {
      sr: "Hrana: čuvanje i priprema bez struje",
      en: "Food: preserving and cooking without power",
    },
    description: {
      sr: "Vodič USDA za konzervisanje, bezbednost hrane pri nestanku struje, botulizam, trovanje ugljen-monoksidom i istorijski terenski kuvari — izvorni tekstovi javnog domena i radova američke vlade.",
      en: "The USDA Complete Guide to Home Canning, food safety in a power outage, botulism, carbon monoxide and the public-domain field-cooking manuals — the sources' own text, unmodified.",
    },
    licence: {
      spdx: "LicenseRef-Public-Domain-US-Government",
      attribution:
        "Compilation of United States Government works and public-domain works, shipped unmodified. USDA Complete Guide to Home Canning, Revised 2015 (AIB No. 539), USDA Food Safety and Inspection Service, US Centers for Disease Control and Prevention, FoodSafety.gov, Ready.gov/FEMA, and US War Department field manuals digitized by the Internet Archive. CDC material is used with attribution, with its substantive content unchanged, and without any implication of CDC, ATSDR, HHS or US Government endorsement.",
      url: "https://www.cdc.gov/other/agencymaterials.html",
    },
    source: {
      name: "USDA, FSIS, CDC, FoodSafety.gov, Ready.gov/FEMA, Internet Archive",
      url: "https://nchfp.uga.edu/papers/guide/",
    },
    minAppVersion: MIN_APP_VERSION,
  },
  "recipes-preserving": {
    format: 1,
    id: "recipes-preserving",
    version: PACK_VERSION,
    kind: "dataset",
    title: {
      sr: "Recepti za konzervisanje",
      en: "Preserving recipes",
    },
    description: {
      sr: "Pripreme iz Vodiča za konzervisanje USDA (2015), uključujući kiseli kupus — korak po korak, izvornim rečima vodiča.",
      en: "The procedures of the USDA Complete Guide to Home Canning (2015 revision), sauerkraut among them — step by step, in the guide's own words.",
    },
    licence: {
      spdx: "LicenseRef-Public-Domain-US-Government",
      attribution:
        "Complete Guide to Home Canning, Revised 2015 (Agriculture Information Bulletin No. 539), United States Department of Agriculture. Recipes reproduced unmodified.",
      url: "https://nchfp.uga.edu/papers/guide/",
    },
    source: {
      name: "USDA Complete Guide to Home Canning, Guide 6 (Fermented Foods and Pickled Vegetables)",
      url: "https://nchfp.uga.edu/papers/guide/GUIDE06_HomeCan_rev0715.pdf",
    },
    minAppVersion: MIN_APP_VERSION,
  },
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * A URL's bytes, from the cache when they are already there.
 *
 * `redirect: "manual"` and a hand-followed `location` rather than the default
 * follow, because the licence-evidence for the Sphere Handbook is an
 * archive.org capture whose chain has to be walked one hop at a time to record
 * where the bytes actually came from.
 *
 * A host that refuses HTTP/1.1 — UNHCR's does, with a 403 — is asked again over
 * HTTP/2, which is the fallback the research run needed for the same pages
 * (`h2fetch.js` in the research folder, copied here as a function). The retry
 * verifies the certificate: a build script that disabled TLS verification to
 * read a licence would be the wrong kind of evidence.
 */
async function fetchCached(url, name, index) {
  const file = join(CACHE, name);
  const known = index[name];
  if (existsSync(file) && known !== undefined) {
    const bytes = readFileSync(file);
    return { file, bytes, sha256: known.sha256, fetchedAt: known.fetchedAt, cached: true, finalUrl: known.finalUrl ?? url };
  }
  let target = url;
  let response = null;
  for (let hop = 0; hop < 6; hop += 1) {
    // A busy archive answers 429, and one 429 is not a dead source: the
    // Internet Archive's replay of the Sphere Handbook is the only page that
    // states that licence in a form this environment can reach at all (the
    // publisher's own site answers Cloudflare's challenge, not the request), so
    // the builder waits and asks again rather than giving up on it.
    response = await withRetries(target);
    if (response.status === 403 || response.status === 405) {
      const overHttp2 = await fetchOverHttp2(target);
      if (overHttp2 === null) continue;
      if (overHttp2.status === 200) {
        return store(name, target, overHttp2.bytes, index);
      }
      if (overHttp2.location !== null) {
        target = new URL(overHttp2.location, target).href;
        continue;
      }
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location !== null) {
      target = new URL(location, target).href;
      continue;
    }
    break;
  }
  if (response === null || !response.ok) {
    throw new Error(`fetch failed: ${url} (${response === null ? "no response" : String(response.status)})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return store(name, target, bytes, index);
}

/** A GET that waits out a 429 or a 503, then refuses like any other failure. */
async function withRetries(target) {
  const waits = [5_000, 15_000, 30_000];
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(target, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: ACCEPT_HEADERS },
    });
    if (response.status !== 429 && response.status !== 503) return response;
    const wait = waits[attempt];
    if (wait === undefined) return response;
    console.log(`  waiting ${String(wait / 1000)} s — ${target} answered ${String(response.status)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, wait));
  }
}

const ACCEPT_HEADERS = "text/html,application/xhtml+xml,application/pdf,*/*";

/** A fetched body written to the cache with its digest. */
function store(name, finalUrl, bytes, index) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, name);
  writeFileSync(file, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const record = { finalUrl, sha256, fetchedAt: new Date().toISOString().slice(0, 10) };
  index[name] = record;
  return { file, bytes, sha256, fetchedAt: record.fetchedAt, cached: false, finalUrl };
}

/**
 * One GET over HTTP/2, for a host that will not answer over HTTP/1.1.
 *
 * Returns `null` when the host will not talk HTTP/2 either, so the caller can
 * let the original HTTP/1.1 response stand as the answer.
 */
function fetchOverHttp2(url) {
  return new Promise((resolvePromise) => {
    const parsed = new URL(url);
    const client = connectHttp2(`${parsed.protocol}//${parsed.host}`);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {
        // A connection already closed is not a failure of the fetch.
      }
      resolvePromise(value);
    };
    client.on("error", () => finish(null));
    const request = client.request({
      ":method": "GET",
      ":path": parsed.pathname + parsed.search,
      "user-agent": USER_AGENT,
      accept: ACCEPT_HEADERS,
      "accept-encoding": "identity",
    });
    let status = 0;
    let location = null;
    const chunks = [];
    request.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
      location = typeof headers.location === "string" ? headers.location : null;
    });
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", () => finish(null));
    request.on("end", () => finish({ status, location, bytes: Buffer.concat(chunks) }));
    request.end();
  });
}

/**
 * A page's text, for checking that a licence sentence is on it.
 *
 * NOT `pruneChrome`d, unlike an article: a copyright line lives in the footer,
 * and the footer is exactly what an article drops. Checking the licence against
 * the pruned page reported the NCHFP, Solar Cookers and Aprovecho notices as
 * absent when they were on the page the whole time.
 */
function pageText(bytes) {
  return textContent(parseHtml(bytes.toString("utf8")));
}

/** A PDF's text, for the one licence whose evidence is a PDF. */
async function pdfText(path) {
  const doc = await openDocument(path);
  const parts = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    parts.push(...content.items.map((item) => (typeof item.str === "string" ? item.str : "")));
  }
  return parts.join(" ");
}

/** The image files a page's figures become, and the figures that were written. */
async function figuresOf(page, prefix) {
  const written = [];
  for (const [index, figure] of page.figures.entries()) {
    // A mark smaller than a paragraph of text is a rule, a bullet glyph or a
    // scanner's speck rather than a figure: the guide's photographs are at least
    // 300 points wide, and shipping the specks would be shipping noise.
    if (figure.imageWidth < 300 || figure.imageHeight < 150) continue;
    const channels = Math.round(figure.channels ?? 0);
    if (channels !== 3 && channels !== 4) continue;
    // JPEG rather than PNG, at a bounded width. The guide's figures are
    // photographs and the eight guides' pages carry 327 of them; kept as PNG at
    // their embedded size the pack came to 56 MB, of which the largest single
    // figure was 4.5 MB for one scanned page. The pack allows `.jpg`, and a
    // photograph is what JPEG is for.
    const file = `${prefix}-p${String(page.number)}-${String(index + 1)}.jpg`;
    const data = await sharp(
      Buffer.from(figure.data.buffer, figure.data.byteOffset, figure.data.length),
      { raw: { width: figure.imageWidth, height: figure.imageHeight, channels } },
    )
      .resize({ width: 1400, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    written.push({ file: `images/${file}`, data, y: figure.y, name: file, page: page.number });
  }
  return written;
}

/** Attach each figure to the last block printed above it, or give it its own. */
function attachFigures(blocks, pageNumber, figures) {
  const page = blocks.filter((block) => block.page === pageNumber);
  for (const figure of figures) {
    let host = null;
    for (const block of page) {
      const runs = block.runs ?? block.sourceItems ?? [];
      if (runs.length === 0) continue;
      const top = Math.max(...runs.map((run) => run.y));
      if (top >= figure.y) host = block;
    }
    const entry = { file: figure.file, alt: "" };
    if (host === null) {
      blocks.push({ kind: "paragraph", text: "", runs: [], figures: [entry], page: pageNumber });
    }
    else (host.figures ??= []).push(entry);
  }
}

/**
 * The USDA guide PDFs, converted and checked.
 *
 * `proseOnly` is what the recipe extractor asks for: the same pages with the
 * tables left out, because a recipe's ingredients and steps are the prose beside
 * the table, and because each of these pages carries a hidden copy of another
 * page's table threaded through that prose (see `pageBlocks`).
 */
async function convertGuides(source, cache, report, { proseOnly = false, figures: wantFigures = true } = {}) {
  const doc = await openDocument(cache.file);
  const pages = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const read = await readPage(page);
    pages.push({
      number,
      lines: finishLines(toLines(read.items)),
      figures: read.figures,
      pageHeight: read.pageHeight,
      pageWidth: read.pageWidth,
    });
  }
  const furniture = findFurniture(pages);
  const blocks = documentBlocks(pages, furniture, { prose: proseOnly });
  const lost = documentFindings(pages, furniture, blocks);
  // Prose mode is not the article: it drops the tables on purpose, so the two
  // checks below — every run accounted for, every cell where it was printed —
  const tables = blocks.filter((block) => block.kind === "table");
  const tableProblems = tables.flatMap((table) => tableFindings(table));
  if (!proseOnly && (lost.length > 0 || tableProblems.length > 0)) {
    throw new Error(
      `${source.id}: ${String(lost.length)} lost or doubled text runs and ` +
        `${String(tableProblems.length)} table-cell problems — refusing to ship`,
    );
  }
  const figures = [];
  if (wantFigures) {
    for (const page of pages) {
      figures.push(...(await figuresOf(page, source.id)));
    }
  }
  // Figures are placed after the text they belong beside, page by page, so a
  // reader meets a photograph where the guide printed it and not at the end.
  for (const page of pages) {
    attachFigures(blocks, page.number, figures.filter((figure) => figure.page === page.number));
  }
  report.push({
    id: source.id,
    pages: pages.length,
    blocks: blocks.length,
    tables: tables.length,
    tableRows: tables.reduce((sum, table) => sum + table.cells.length, 0),
    verbatimPages: blocks.filter((block) => block.kind === "code").length,
    figures: figures.length,
    lost: lost.length,
    tableProblems: tableProblems.length,
  });
  return {
    blocks,
    figures: figures.map((figure) => ({
      name: figure.name,
      data: figure.data,
    })),
    body: documentBodyHeight(pages),
  };
}

/** The Source line every article ends with. */
function sourceLine(source, fetched) {
  return `---\n\n*Source: ${source.work} — ${source.section}. ${source.url} (retrieved ${fetched}, unmodified).*`;
}

/** The CDC reuse notice, quoted, at the foot of every CDC-derived article. */
function cdcNotice() {
  const quoted = CDC_NOTICE.quotes.map((quote) => `> ${quote}`).join("\n>\n");
  return (
    "The CDC/ATSDR reuse policy requires attribution, a non-endorsement disclaimer and no " +
    `substantive change. Quoted from ${CDC_NOTICE.url}:\n\n${quoted}`
  );
}

/** The article for a source the pack reads as a PDF. */
function simpleArticle(source, blocks, fetched) {
  const markdown = blocksToMarkdown(blocks, { levelOffset: 0 });
  const parts = [markdown.trimEnd(), sourceLine(source, fetched)];
  if (source.licence === "cdc-reuse") parts.push(cdcNotice());
  return `${parts.join("\n\n")}\n`;
}

/** The "Further reading" article: links, their licences and where each is stated. */
function furtherReadingArticle() {
  const lines = [
    "These sources are read at their own sites and are not part of this pack: none of them " +
      "permits redistribution. Each licence below is quoted from the page that states it.",
  ];
  for (const key of FURTHER_READING) {
    const entry = LINK_LICENCES[key];
    lines.push(`## ${entry.title}`);
    lines.push(`Licence: ${entry.licence}`);
    lines.push(`Source: ${entry.url}`);
    lines.push(`Licence evidence: ${entry.evidenceUrl}`);
    for (const quote of entry.evidenceQuotes) lines.push(`> ${quote}`);
  }
  return `${lines.join("\n\n")}\n`;
}

/** The credits article: who made each shipped work, and under what rule. */
function creditsArticle() {
  const lines = ["Every work in this pack is a United States Government work or a public-domain work."];
  for (const source of SOURCES) {
    const licence = LICENCES[source.licence];
    lines.push(`## ${source.work}`);
    lines.push(`${source.publisher}. ${source.section}.`);
    lines.push(`Licence: ${licence.name}`);
    lines.push(`Licence evidence: ${licence.url}`);
    for (const quote of licence.quotes) lines.push(`> ${quote}`);
    lines.push(`Text: ${source.url}`);
  }
  lines.push("## CDC material");
  lines.push(cdcNotice().split("\n\n")[0]);
  lines.push(CDC_NOTICE.quotes.map((quote) => `> ${quote}`).join("\n>\n"));
  lines.push("## Not shipped");
  lines.push(
    "The following sources were researched for this chapter and are linked to from the " +
      "“Further reading” article instead, because their licences do not permit redistribution: " +
      FURTHER_READING.map((key) => `${LINK_LICENCES[key].title} (${LINK_LICENCES[key].licence})`).join("; ") +
      ".",
  );
  return `${lines.join("\n\n")}\n`;
}

/** The whole run. */
async function build() {
  const started = Date.now();
  mkdirSync(CACHE, { recursive: true });
  const index = existsSync(CACHE_INDEX)
    ? JSON.parse(readFileSync(CACHE_INDEX, "utf8"))
    : {};
  const fetched = [];
  const record = (id, cache, extra) => {
    fetched.push({ id, ...cache, ...extra });
    // The index is written as each source lands rather than once at the end, so
    // a run stopped by one unreachable host does not throw away the work of the
    // twenty that answered.
    writeFileSync(CACHE_INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    console.log(
      `  ${cache.cached ? "cached" : "fetched"} ${id} ${String(cache.bytes.length)} bytes ${cache.sha256.slice(0, 12)}…`,
    );
  };

  console.log("sources:");
  const caches = new Map();
  for (const source of SOURCES) {
    const cache = await fetchCached(source.url, source.file, index);
    caches.set(source.id, cache);
    record(source.id, cache, {});
  }

  console.log("licence evidence:");
  const evidencePages = new Map();
  for (const [id, licence] of Object.entries(LICENCES)) {
    const name = `licence-${id}.${licence.url.endsWith(".pdf") ? "pdf" : "html"}`;
    const cache = await fetchCached(licence.url, name, index);
    evidencePages.set(id, cache);
    record(`licence:${id}`, cache, {});
  }
  for (const [key, entry] of Object.entries(LINK_LICENCES)) {
    if (Object.values(LICENCES).some((licence) => licence.url === entry.evidenceUrl)) continue;
    const name = `licence-${key}.${entry.evidenceUrl.endsWith(".pdf") ? "pdf" : "html"}`;
    const cache = await fetchCached(entry.evidenceUrl, name, index);
    evidencePages.set(key, cache);
    record(`licence:${key}`, cache, {});
  }
  writeFileSync(CACHE_INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  // 1. Every licence claim is on the page it cites, verbatim.
  const evidenceProblems = [];
  const checkQuote = (where, text, quote) => {
    if (!normalise(text).includes(normalise(quote))) evidenceProblems.push({ where, quote });
  };
  const evidenceText = new Map();
  for (const [id, cache] of evidencePages) {
    evidenceText.set(id, id === "sphere" || cache.file.endsWith(".pdf") ? await pdfText(cache.file) : pageText(cache.bytes));
  }
  for (const [id, licence] of Object.entries(LICENCES)) {
    const text = evidenceText.get(id);
    for (const quote of licence.quotes) checkQuote(`licence ${id}`, text ?? "", quote);
  }
  for (const [key, entry] of Object.entries(LINK_LICENCES)) {
    const text = evidenceText.get(key) ?? evidenceText.get(entry.evidenceUrl);
    for (const quote of entry.evidenceQuotes) checkQuote(`licence ${key}`, text ?? "", quote);
  }
  if (evidenceProblems.length > 0) {
    for (const problem of evidenceProblems) {
      console.error(`licence evidence FAILED: ${problem.where} does not carry "${problem.quote.slice(0, 70)}…"`);
    }
    throw new Error(`${String(evidenceProblems.length)} licence quote(s) could not be verified`);
  }
  console.log(`licence evidence: ${String(evidenceText.size)} pages read, every quote found`);

  // 2. Convert, and check each article's text is the source's text.
  console.log("articles:");
  const articles = new Map();
  const figures = [];
  const report = [];
  const converted = new Map();
  for (const source of SOURCES) {
    const cache = caches.get(source.id);
    const fetched = cache.fetchedAt;
    let blocks;
    if (source.reader === "pdf") {
      const result = await convertGuides(source, cache, report);
      converted.set(source.id, result);
      blocks = result.blocks;
      figures.push(...result.figures.map((figure) => ({ ...figure, id: source.id })));
    } else if (source.reader === "html") {
      const root = selectMain(parseHtml(cache.bytes.toString("utf8")));
      const referrer = cache.finalUrl;
      const htmlText = textContent(root);
      const markdown = toMarkdown(root, { url: referrer, images: new Map() });
      if (normalise(stripMarkup(markdown)) !== normalise(htmlText)) {
        throw new Error(`${source.id}: the article is not the page's own text`);
      }
      articles.set(source.id, {
        markdown:
          `${markdown.trimEnd()}\n\n` +
          `${source.licence === "cdc-reuse" ? `${cdcNotice()}\n\n` : ""}${sourceLine(source, fetched)}\n`,
        figures: [],
      });
      report.push({ id: source.id, chars: markdown.length });
      console.log(`  ${source.id} ${String(markdown.length)} chars, fidelity ok`);
      continue;
    } else {
      const raw = cache.bytes.toString("utf8");
      blocks = textToBlocks(raw);
      if (source.startAt !== undefined) {
        const at = blocks.findIndex((block) => block.text.includes(source.startAt));
        blocks = blocks.slice(at === -1 ? 0 : at);
      }
      const reference = blocksToText(blocks);
      const markdown = blocksToMarkdown(blocks, { levelOffset: 0 });
      if (normalise(stripMarkup(markdown)) !== normalise(reference)) {
        throw new Error(`${source.id}: the article is not the scan's own text`);
      }
      articles.set(source.id, { markdown: `${markdown.trimEnd()}\n\n${sourceLine(source, fetched)}\n`, figures: [] });
      report.push({ id: source.id, chars: markdown.length });
      console.log(`  ${source.id} ${String(markdown.length)} chars, fidelity ok`);
      continue;
    }
    const markdown = simpleArticle(source, blocks, fetched);
    const reference = normalise(blocksToText(blocks));
    const rendered = normalise(stripMarkup(blocksToMarkdown(blocks, { levelOffset: 0 })));
    if (reference !== rendered) {
      throw new Error(
        `${source.id}: the article's text is not the page's text ` +
          `(${String(rendered.length)} characters against ${String(reference.length)})`,
      );
    }
    articles.set(source.id, { markdown, figures: [] });
    const stats = report[report.length - 1];
    console.log(
      `  ${source.id} ${String(stats.pages)} pages, ${String(stats.tables)} tables, ` +
        `${String(stats.verbatimPages)} pages kept verbatim`,
    );
  }

  // 3. The two articles that are a list of links and a list of credits.
  articles.set("further-reading", { markdown: furtherReadingArticle(), figures: [] });
  articles.set("credits", { markdown: creditsArticle(), figures: [] });

  // 4. Figures: rename into a per-article namespace and hand them to their pack.
  const articleFigures = new Map();
  for (const figure of figures) {
    const list = articleFigures.get(figure.id) ?? [];
    list.push(figure);
    articleFigures.set(figure.id, list);
  }
  for (const [id, list] of articleFigures) {
    const article = articles.get(id);
    if (article !== undefined) article.figures = list.map(({ name, data }) => ({ name, data }));
  }

  // 5. The Reader's table of contents.
  const groups = [
    {
      id: "home-canning",
      title: "Home canning — the USDA Complete Guide",
      members: SOURCES.filter((source) => source.reader === "pdf").map((source) => source.id),
    },
    {
      id: "power-outage",
      title: "Keeping food safe in a power outage",
      members: [
        "fsis-power-outage",
        "cdc-power-outage",
        "foodsafety-power-outage",
        "ready-food",
        "ready-water",
      ],
    },
    {
      id: "botulism-and-drying",
      title: "Botulism, and drying meat safely",
      members: ["cdc-botulism-about", "cdc-botulism-prevention", "fsis-jerky"],
    },
    {
      id: "without-power",
      title: "Cooking and heating without power",
      members: ["cdc-carbon-monoxide", "ready-power-outages"],
    },
    {
      id: "field-cooking",
      title: "Field cooking and historical rations",
      members: ["tm-10-405", "army-cooks-1914", "army-cooks-1917", "hardtack-and-coffee"],
    },
  ];
  const toc = groups.map((group) => ({
    id: group.id,
    title: group.title,
    children: group.members.map((id) => {
      const source = SOURCES.find((entry) => entry.id === id);
      return {
        id: source.entry.id,
        title: source.entry.title,
        file: `articles/${id}.md`,
        source: { title: source.work, url: source.url },
      };
    }),
  }));
  toc.push({ id: "further-reading", title: "Further reading (links, not shipped)", file: "articles/further-reading.md" });
  toc.push({ id: "credits", title: "Sources, licences and attribution", file: "articles/credits.md" });

  // 6. Write both packs.
  const contentDir = join(OUT, "survival-food");
  const datasetDir = join(OUT, "recipes-preserving");
  const contentFiles = writeContentPack({
    dir: contentDir,
    articles: Object.fromEntries(articles),
    toc,
    notice: "safety",
  });

  const guide6 = report.find((entry) => entry.id === "usda-guide-6");
  void guide6;
  const guide6Prose = await convertGuides(
    SOURCES.find((source) => source.id === "usda-guide-6"),
    caches.get("usda-guide-6"),
    [],
    { proseOnly: true, figures: false },
  );
  const recipes = recipesFrom(guide6Prose.blocks, {
    title: "Complete Guide to Home Canning, Revised 2015 (AIB No. 539), Guide 6",
    url: "https://nchfp.uga.edu/papers/guide/GUIDE06_HomeCan_rev0715.pdf",
    licence: "public-domain",
    attribution:
      "United States Department of Agriculture, Complete Guide to Home Canning, Revised 2015, Guide 6. Procedure reproduced unmodified.",
  });
  const datasetFiles = writeDatasetPack({ dir: datasetDir, recipes });

  writeMetadata(join(HERE, "pack.survival-food.meta.json"), METADATA["survival-food"]);
  writeMetadata(join(HERE, "pack.recipes-preserving.meta.json"), METADATA["recipes-preserving"]);

  // 7. `sources.json`, the record beside the builder.
  const sourcesJson = {
    pack: "survival-food",
    built: PACK_VERSION,
    note:
      "Every source the pack carries, with its URL, the date it was fetched, its SHA-256, its " +
      "licence and the page that states that licence with the sentence quoted from it. A source " +
      "without evidence is not used.",
    sources: SOURCES.map((source) => {
      const cache = caches.get(source.id);
      const licence = LICENCES[source.licence];
      return {
        id: source.id,
        url: source.url,
        finalUrl: cache.finalUrl,
        fetched: cache.fetchedAt,
        bytes: cache.bytes.length,
        sha256: cache.sha256,
        work: source.work,
        publisher: source.publisher,
        section: source.section,
        reader: source.reader,
        licence: licence.name,
        licenceEvidence: { url: licence.url, quotes: licence.quotes },
      };
    }),
    notShipped: Object.entries(LINK_LICENCES).map(([key, entry]) => ({
      key,
      title: entry.title,
      url: entry.url,
      licence: entry.licence,
      licenceEvidence: { url: entry.evidenceUrl, quotes: entry.evidenceQuotes },
    })),
    datasets: [
      {
        id: "recipes-preserving",
        url: "https://nchfp.uga.edu/papers/guide/GUIDE06_HomeCan_rev0715.pdf",
        sha256: caches.get("usda-guide-6").sha256,
        licence: LICENCES["usda-reuse"].name,
      },
    ],
    excluded: {
      serbian: [
        "No Serbian preserving source (ajvar, turšija, slatko, pekmez) was found with a licence that permits shipping, so none is invented here.",
      ],
    },
  };
  writeFileSync(join(HERE, "sources.json"), `${JSON.stringify(sourcesJson, null, 2)}\n`, "utf8");

  const contentBytes = treeBytes(contentDir);
  const datasetBytes = treeBytes(datasetDir);
  console.log("");
  console.log(`content pack: ${contentDir}`);
  console.log(`  ${String(contentFiles.length)} files, ${String(contentBytes)} bytes`);
  console.log(`dataset pack: ${datasetDir}`);
  console.log(`  ${String(datasetFiles.length)} file, ${String(datasetBytes)} bytes, ${String(recipes.length)} recipes`);
  console.log(`elapsed ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

/** Every file's bytes under a folder, measured rather than estimated. */
function treeBytes(dir) {
  let total = 0;
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const child = join(at, entry.name);
      if (entry.isDirectory()) walk(child);
      else total += statSync(child).size;
    }
  };
  walk(dir);
  return total;
}

/** The measurements the converter's constants come from, printed on demand. */
async function measure() {
  const histograms = { table: new Map(), body: new Map() };
  for (const source of SOURCES.filter((entry) => entry.reader === "pdf")) {
    const cache = await fetchCached(source.url, source.file, {});
    const doc = await openDocument(cache.file);
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const read = await readPage(page);
      const lines = finishLines(toLines(read.items));
      for (let index = 1; index < lines.length; index += 1) {
        const gap = Math.round((lines[index - 1].y - lines[index].y) * 10) / 10;
        if (gap <= 0.2 || gap >= 40) continue;
        const height = lines[index].height;
        const bucket = height <= 9.5 ? "table" : height >= 10.5 && height <= 12.5 ? "body" : null;
        if (bucket === null) continue;
        histograms[bucket].set(gap, (histograms[bucket].get(gap) ?? 0) + 1);
      }
    }
  }
  for (const [name, histogram] of Object.entries(histograms)) {
    const pairs = [...histogram.entries()].sort((left, right) => left[0] - right[0]);
    const peak = pairs.reduce((best, pair) => (pair[1] > best[1] ? pair : best), [0, 0]);
    console.log(`${name} lines: ${String(pairs.length)} distinct steps, best ${peak[0].toFixed(1)} pt (${String(peak[1])} times)`);
    console.log(`  ${pairs.map(([gap, count]) => `${gap.toFixed(1)}:${String(count)}`).join(" ")}`);
  }
}

/**
 * The tests' fixtures, cut from the cached sources.
 *
 * `--fixtures` rewrites them: the USDA guide's page 6-15 as its positioned glyph
 * runs, and a section of the FSIS power-outage page as HTML. Both sources are
 * public domain, and each fixture is a few kilobytes of a much larger source,
 * which is the line ADR-091 draws between a pack and a fixture. Nothing but the
 * tests reads them.
 */
async function makeFixtures() {
  const guide = await fetchCached(
    "https://nchfp.uga.edu/papers/guide/GUIDE06_HomeCan_rev0715.pdf",
    "GUIDE06_HomeCan_rev0715.pdf",
    {},
  );
  const doc = await openDocument(guide.file);
  const page = await doc.getPage(15);
  const read = await readPage(page);
  // Only the fields the converter reads, so the fixture stays readable in a
  // diff: where each run was printed and what it said.
  const items = read.items.map((item) => ({
    id: item.id,
    text: item.text,
    x: Math.round(item.x * 100) / 100,
    y: Math.round(item.y * 100) / 100,
    width: Math.round(item.width * 100) / 100,
    height: Math.round(item.height * 100) / 100,
  }));
  writeFileSync(
    join(HERE, "fixtures", "usda-guide6-p15.items.json"),
    `${JSON.stringify(
      {
        source: "https://nchfp.uga.edu/papers/guide/GUIDE06_HomeCan_rev0715.pdf",
        page: 15,
        pageHeight: read.pageHeight,
        pageWidth: read.pageWidth,
        items,
      },
      null,
      1,
    )}\n`,
    "utf8",
  );
  const fsis = await fetchCached(
    "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/emergencies/keep-your-food-safe-during-emergencies",
    "fsis-keep-your-food-safe-during-emergencies.html",
    {},
  );
  const html = fsis.bytes.toString("utf8");
  // Cut at the article's own heading rather than at `<main`: this page opens
  // with a 2 000-character navigation menu inside `main`, and a fixture cut at
  // the element would be a fixture of the menu. The title appears four times and
  // the LAST one is the article's — the first three are menu entries and a
  // breadcrumb — so the cut starts there.
  const title = html.lastIndexOf("Keep Your Food Safe During Emergencies");
  const start = Math.max(0, html.lastIndexOf("<h", title) - 400);
  const end = Math.min(html.length, start + 20_000);
  writeFileSync(
    join(HERE, "fixtures", "fsis-power-outage.html"),
    html.slice(start, end),
    "utf8",
  );
  console.log("fixtures written");
}

if (process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const run = process.argv.includes("--measure")
    ? measure()
    : process.argv.includes("--fixtures")
      ? makeFixtures()
      : build();
  run.catch((error) => {
    console.error(`build FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
