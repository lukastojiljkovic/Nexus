// Builds the two reference packs: `reference-en` and `reference-sr`.
//
//   node scripts/packs/reference/build.mjs [--id reference-en] [--refresh] [--fixtures]
//
// WHAT IT WRITES, AND WHERE. The pack folders go to `%TEMP%\nexus-packs\<id>\`
// and each pack's metadata — the file `scripts/pack-sign.mjs --meta` takes —
// goes beside them as `%TEMP%\nexus-packs\<id>.meta.json`. Nothing is written
// into the repository except `sources.reference-*.json`, which is the licence
// record a build has to keep under version control, and (with `--fixtures`) the
// small test fixtures cut out of the real sources.
//
// WHY IT SHOUTS INSTEAD OF SHIPPING. Four things stop the build rather than
// producing a pack somebody would have to notice was wrong: a fidelity failure
// (the converted text is not the source's text), a paragraph of the selected
// region that is missing from the article, a prune or marker selector that
// matched nothing (a page that changed shape under us), and a document with no
// licence evidence. A pack is not built "as well as possible"; it is built, or
// this script says which document stopped it.
//
// The pack is NOT signed. Signing needs the release key, which lives offline
// with the maintainer: `scripts/pack-sign.mjs --dir <folder> --meta <metadata>
// --key <private-key.pem>`.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertFidelity,
  blocksToText,
  convertDocument,
  missingChunks,
  normalizeText,
  slug,
  stripMarkdown,
  toMarkdown,
} from "./lib/convert.mjs";
import { findFirst, findAll, parseHtml, textContent } from "./lib/html.mjs";
import { fetchSource, packCacheDir, packOutputDir } from "./lib/net.mjs";
import { linesFromPdf } from "./lib/pdf.mjs";
import { articleId, contentJson, packMetadata, renderArticle, sourcesJson, uniqueArticleId } from "./lib/pack.mjs";
import { PACKS } from "./sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "fixtures");
const BUILT_ON = new Date().toISOString().slice(0, 10);

function parseArgs(argv) {
  const values = { id: null, refresh: false, fixtures: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--refresh") values.refresh = true;
    else if (flag === "--fixtures") values.fixtures = true;
    else if (flag === "--id") {
      values.id = argv[index + 1] ?? null;
      index += 1;
    } else {
      throw new Error(`build: unknown argument "${flag}"`);
    }
  }
  return values;
}

/** One document's sections, with the markdown and the text the checks need. */
function sectionsOf(document, bytes) {
  const { sections } = convertDocument(document, bytes, { linesOfPdf: linesFromPdf });
  return sections.map((section) => {
    const markdown = toMarkdown(section.blocks);
    assertFidelity(`${document.id} / ${section.title}`, blocksToText(section.blocks), markdown);
    return { title: section.title, markdown, blocks: section.blocks, sourceText: blocksToText(section.blocks) };
  });
}

/**
 * The other half of the fidelity check: is every paragraph of the region in the
 * article?
 *
 * `assertFidelity` compares an article with the blocks it was made from, so it
 * proves the writer lost nothing. This asks whether the walker that produced
 * those blocks lost something — the text of each paragraph, heading, list item
 * and cell of the selected region, read by a flat walker, has to appear in what
 * the pack ships.
 */
function assertCoverage(document, container, lines, sections) {
  const article = sections.map((section) => stripMarkdown(section.markdown)).join(" ");
  const missing = container === null
    ? lines
      .map((line) => normalizeText(line))
      .filter((line) => line.length >= 32 && !normalizeText(article).includes(line))
    : missingChunks(container, article);
  if (missing.length > 0) {
    throw new Error(
      `${document.id}: ${String(missing.length)} piece(s) of the selected region are not in the article, ` +
      `starting with: ${missing[0].slice(0, 120)}`,
    );
  }
}

/**
 * The article set of one pack, in reading order, with the table of contents.
 *
 * A document that the source prints in parts — the two consolidated treaties,
 * one article per PART or TITLE — becomes a chapter of the pack with one article
 * per part, so the pack's table of contents is the book's, not one four-hundred-
 * kilobyte page.
 */
function buildArticles(pack, fetches) {
  const toc = [];
  const articles = [];
  // One id per article, pack-wide: the table of contents lists each article
  // once, and an id is also the file's name.
  const used = new Set();
  for (const [index, document] of pack.documents.entries()) {
    const fetch = fetches.get(document.id);
    const sections = fetch.sections;
    assertCoverage(document, fetch.container, fetch.lines, sections);
    const source = { title: document.title, url: document.canonical ?? document.url };
    if (sections.length === 1) {
      const id = uniqueArticleId(articleId(index, document, sections[0].title, 1), used);
      toc.push({ id, title: document.title, file: `articles/${id}.md`, source });
      articles.push({ id, file: `articles/${id}.md`, document, section: sections[0], text: renderArticle(pack, document, sections[0], BUILT_ON).text });
      continue;
    }
    const children = [];
    for (const section of sections) {
      const id = uniqueArticleId(articleId(index, document, section.title, sections.length), used);
      children.push({ id, title: section.title, file: `articles/${id}.md`, source });
      articles.push({ id, file: `articles/${id}.md`, document, section, text: renderArticle(pack, document, section, BUILT_ON).text });
    }
    toc.push({ id: slug(document.id), title: document.title, source, children });
  }
  return { toc, articles };
}

/** Where a pack's bytes come from, once, for both the build and the licence file. */
async function fetchDocuments(pack, refresh) {
  const fetches = new Map();
  for (const document of pack.documents) {
    const result = await fetchSource(document.url, { packId: pack.id, accept: document.accept, refresh });
    const { container, lines } = convertDocument(document, result.bytes, { linesOfPdf: linesFromPdf });
    fetches.set(document.id, {
      bytes: result.bytes,
      sha256: result.sha256,
      fetched: result.fetched,
      url: document.url,
      container,
      lines,
      sections: sectionsOf(document, result.bytes),
    });
    const how = result.fromCache ? "cache" : "fetch";
    console.log(`  ${how}  ${document.id.padEnd(34)} ${String(result.bytes.byteLength).padStart(8)} B  ${result.url.slice(0, 96)}`);
  }
  return fetches;
}

/* -------------------------------------------------------------------------- */
/* Fixtures: a few kilobytes cut out of the real sources, for the tests.       */

function rawBytes(fetches, id) {
  return fetches.get(id).bytes.toString("utf8");
}

/**
 * The three fixtures are one per source family the converter understands: a UN
 * page's HTML, an Official Journal XHTML file, and the plain text a gazette PDF
 * gives through its text layer. They are cut from the same bytes the build uses,
 * by the offsets the parser recorded, so a fixture cannot drift away from its
 * source without the build regenerating it.
 */
function writeFixtures(fetches) {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const charter = rawBytes(fetches, "un-charter");
  const charterBox = findFirst(parseHtml(charter), { class: "field-item" });
  const chapterTwo = findAll(charterBox, { class: "heading-underlined-blue" }).find((node) => textContent(node).includes("Chapter II")) ?? null;
  if (charterBox === null || chapterTwo === null) throw new Error("fixture: un-charter region not found");
  writeFileSync(
    join(FIXTURE_DIR, "un-charter.html"),
    `<html><body>\n${charter.slice(charterBox.start, chapterTwo.start)}\n</body></html>\n`,
  );

  const teu = rawBytes(fetches, "eu-teu");
  const teuTree = parseHtml(teu);
  const body = findFirst(teuTree, { tag: "body" }) ?? teuTree;
  const tables = findAll(body, { tag: "table" });
  const articles = findAll(body, { class: "ti-art" });
  const preamble = findAll(body, { class: "normal" }).find((node) => normalizeText(textContent(node)).startsWith("HIS MAJESTY")) ?? null;
  if (tables.length < 2 || articles.length < 2 || preamble === null) throw new Error("fixture: oj region not found");
  // Two slices of one file rather than one: the Official Journal prints its table
  // of contents as one table per row, so a single cut that reached Article 1 from
  // the page header would carry forty rows of contents and seventy kilobytes of
  // markup to test a table. The header slice keeps the OJ's own page header, the
  // document title, the "Table of Contents" heading and one contents row; the
  // body slice keeps the preamble and Articles 1–2.
  const header = teu.slice(tables[0].start, tables[1].end);
  const opening = teu.slice(preamble.start, articles[1].end);
  writeFileSync(
    join(FIXTURE_DIR, "oj-c202-teu.xhtml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><body>\n${header}\n${opening}\n</body></html>\n`,
  );

  const gazetteLines = fetches.get("gazette-fixture").lines.slice(0, 62).join("\n");
  writeFileSync(join(FIXTURE_DIR, "gazette-socijalna-zastita.txt"), `${gazetteLines}\n`);

  console.log(`fixtures written to ${FIXTURE_DIR}`);
}

async function loadFixtureBytes() {
  // The gazette fixture's source is the Serbian act this builder verified as a
  // gazette original (see docs/packs/reference-sr.md). It is not in either pack,
  // so it is fetched here, when the fixtures are regenerated and only then.
  const gazette = {
    id: "gazette-fixture",
    url: "https://www.minrzs.gov.rs/sites/default/files/2021-02/Zakon%20o%20socijalnoj%20zastiti.pdf",
    kind: "pdf",
  };
  const result = await fetchSource(gazette.url, { packId: "reference-sr", accept: "application/pdf" });
  return new Map([["gazette-fixture", { bytes: result.bytes, sha256: result.sha256, fetched: result.fetched, url: gazette.url, container: null, lines: await linesFromPdf(result.bytes) }]]);
}

/* -------------------------------------------------------------------------- */

function buildPack(pack, fetches) {
  const started = Date.now();
  const { toc, articles } = buildArticles(pack, fetches);
  const folder = join(packOutputDir(), pack.id);
  // The output folder is rebuilt, not updated. A pack is a signed list of files,
  // and an article left behind by an earlier build is a file the manifest would
  // not list — a folder the app refuses, produced by a build that reported
  // success. The path is checked against the output directory this module
  // created it under, so a mistake in `packOutputDir` cannot delete anything
  // else.
  if (!folder.startsWith(`${packOutputDir()}\\`) && !folder.startsWith(`${packOutputDir()}/`)) {
    throw new Error(`build: refusing to clear "${folder}"`);
  }
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(join(folder, "articles"), { recursive: true });
  let bytes = 0;
  for (const article of articles) {
    writeFileSync(join(folder, article.file), article.text);
    bytes += Buffer.byteLength(article.text);
  }
  const contentBytes = Buffer.from(`${JSON.stringify(contentJson(pack, toc), null, 2)}\n`, "utf8");
  writeFileSync(join(folder, "content.json"), contentBytes);
  writeFileSync(join(packOutputDir(), `${pack.id}.meta.json`), `${JSON.stringify(packMetadata(pack), null, 2)}\n`);
  writeFileSync(join(HERE, `sources.${pack.id}.json`), `${JSON.stringify(sourcesJson(pack, fetches), null, 2)}\n`);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `  pack  ${pack.id}: ${String(articles.length)} articles, ${String(toc.length)} table-of-contents entries, ` +
    `${String(bytes + contentBytes.byteLength)} B of content, built in ${seconds}s`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ids = args.id === null ? Object.keys(PACKS) : [args.id];
  for (const id of ids) {
    const pack = PACKS[id];
    if (pack === undefined) throw new Error(`build: unknown pack "${id}"`);
    for (const document of pack.documents) {
      if (document.licence?.evidence?.length === 0 || document.licence?.evidence === undefined) {
        throw new Error(`${document.id}: a source without licence evidence is not a source`);
      }
    }
  }

  let englishFetches = null;
  for (const id of ids) {
    const pack = PACKS[id];
    console.log(`${pack.id}:`);
    const fetches = await fetchDocuments(pack, args.refresh);
    if (pack.id === "reference-en") englishFetches = fetches;
    buildPack(pack, fetches);
  }
  // The fixtures are cut once, and only from the sources the English pack uses
  // (plus the gazette act this builder verified as a gazette original but which
  // neither pack ships). Writing them inside the loop would ask the Serbian
  // pack's sources for a US page that is not in it.
  if (args.fixtures && englishFetches !== null) {
    writeFixtures(new Map([...englishFetches, ...(await loadFixtureBytes())]));
  }
  console.log(`cache: ${packCacheDir("<id>")}`);
  console.log(`output: ${packOutputDir()}`);
}

await main();
