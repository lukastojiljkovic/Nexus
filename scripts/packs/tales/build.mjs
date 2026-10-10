// No shebang, for the reason the other gates in `scripts/` have none: this
// module is both a CLI and an import target for its own tests.
//
// The fairy-tale and folk-tale packs (ADR-091), built from two public sources:
//
//   node scripts/packs/tales/build.mjs [--pack tales-sr|tales-en|all]
//                                      [--cache <dir>] [--out <dir>] [--offline]
//
// tales-sr  Vuk Stefanović Karadžić's folk prose on Serbian Wikisource: the
//           tales of „Српске народне приповијетке" (the second, enlarged
//           edition, Vienna 1870) and „Српске народне пословице" (Belgrade
//           1900). The works are public domain — Vuk died in 1864 — and the
//           page text is licensed CC BY-SA 4.0 by Wikimedia; the pack names
//           both, and `sources.json` carries the licence evidence.
// tales-en  Four Project Gutenberg ebooks: Grimms' Household Tales in Margaret
//           Hunt's translation, Andersen twice and Aesop. The Gutenberg
//           wrapper is cut at the markers their own terms allow it to be cut,
//           and the ebook numbers, URLs and licence statements travel in
//           `sources.json` and the pack's attribution.
//
// WHAT IT WRITES. Sources are cached under `<cache>/<pack id>/`, so re-running
// is seconds rather than minutes. The pack folder goes to `<out>/<pack id>/`
// (`content.json`, `articles/…`) with the metadata `pack-sign.mjs --meta` takes
// beside it as `<out>/<pack id>.meta.json`. This script never signs anything:
// `pack.json` and `pack.json.sig` are the maintainer's signing tool's output.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseBook } from "./gutenberg.mjs";
import { assertFidelity, bySerbianTitle, slug } from "./markdown.mjs";
import {
  USER_AGENT,
  assemblePack,
  cacheDirFor,
  checkPackShape,
  fetchSource,
  isoDate,
  sha256,
  writeMeta,
} from "./pack.mjs";
import { EVIDENCE_PAGES, buildSources, quoteAppears, readEvidence } from "./sources.mjs";
import { convertPage, sourceSection, textOf } from "./wikisource.mjs";

/** The app version a content pack may ask for: this wave's manifest floor. */
const MIN_APP_VERSION = "1.5.0";
/** The pack format this builder writes, and the version of these packs. */
const PACK_FORMAT = 1;
const PACK_VERSION = "2026.10.0";

/** The two packs this builder knows how to write. */
export const PACK_IDS = ["tales-sr", "tales-en"];

/**
 * The Project Gutenberg ebooks, and everything the build needs to know about
 * each one.
 *
 * The plain-text URLs point at `gutenberg.pglaf.org`, a mirror of their public
 * repository, because their terms of use ask bulk reusers to download from a
 * mirror rather than from the main site; the landing page stays the citation.
 * `stopAt` ends the last article: 2591 closes with a row of asterisks and a
 * note on the brothers, and Aesop with the list of Rackham's plates.
 */
export const GUTENBERG_BOOKS = [
  {
    ebook: "5314",
    slug: "grimm-5314",
    title: "Household Tales by Brothers Grimm",
    credit: "Jacob and Wilhelm Grimm, translated by Margaret Hunt (1884)",
    textUrl: "https://gutenberg.pglaf.org/5/3/1/5314/5314-0.txt",
    stopAt: [],
  },
  {
    ebook: "1597",
    slug: "andersen-1597",
    title: "Andersen's Fairy Tales",
    credit: "Hans Christian Andersen, in the translation this ebook carries",
    textUrl: "https://gutenberg.pglaf.org/1/5/9/1597/1597-0.txt",
    stopAt: [],
  },
  {
    ebook: "27200",
    slug: "andersen-27200",
    title: "Fairy Tales of Hans Christian Andersen",
    credit: "Hans Christian Andersen, in the translation this ebook carries",
    textUrl: "https://gutenberg.pglaf.org/2/7/2/0/27200/27200.txt",
    stopAt: [],
  },
  {
    ebook: "11339",
    slug: "aesop-11339",
    title: "Aesop's Fables; a new translation",
    credit: "Aesop, translated by V. S. Vernon Jones (1912)",
    textUrl: "https://gutenberg.pglaf.org/1/1/3/3/11339/11339-0.txt",
    stopAt: [/^\s*ILLUSTRATIONS\s*$/i],
  },
];

/** The Serbian Wikisource material, and what the pack makes of it. */
export const WIKISOURCE = {
  api: "https://sr.wikisource.org/w/api.php",
  category: "Категорија:Српске народне приповетке",
  /** A page belongs to Vuk Karadžić's corpus when its own Извор section says so. */
  vukMarker: /Караџић/,
  vukCollection: {
    id: "srpske-narodne-pripovijetke-1870",
    title: "Српске народне приповијетке, друго умножено издање (Беч, 1870)",
    url: "https://sr.wikisource.org/wiki/Српске_народне_приповијетке,_друго_умножено_издање",
  },
  proverbs: {
    page: "Српске народне пословице (1900)",
    id: "srpske-narodne-poslovice-1900",
    title: "Српске народне пословице (Београд, 1900)",
    url: "https://sr.wikisource.org/wiki/Српске_народне_пословице_(1900)",
  },
};

/**
 * The pack's own metadata, minus the file list `pack-sign.mjs` computes.
 *
 * Both languages of copy, as ADR-091 requires; the attribution names the work,
 * its authors and the licence, because a pack's attribution is shown for every
 * pack and never behind a disclosure.
 */
export function packMeta(id) {
  if (id === "tales-sr") {
    return {
      format: PACK_FORMAT,
      id,
      version: PACK_VERSION,
      kind: "content",
      title: { sr: "Српске народне приповијетке и пословице", en: "Serbian folk tales and proverbs" },
      description: {
        sr: "Вукове српске народне приповијетке из другог умноженог издања (Беч, 1870) и Српске народне пословице (Београд, 1900), са Викизворника. Текст је онакав какав је у извору; дјела су у јавном власништву, а текст страница је под лиценцом CC BY-SA 4.0.",
        en: "Vuk Karadžić's Serbian folk tales from the second, enlarged edition (Vienna, 1870) and his folk proverbs (Belgrade, 1900), from Serbian Wikisource. The text is the source's own; the works are public domain and the page text is CC BY-SA 4.0.",
      },
      licence: {
        spdx: "CC-BY-SA-4.0",
        attribution:
          "Вук Стефановић Караџић (1787–1864), јавно власништво; текст страница: Викизворник, Creative Commons Ауторство—Делити под истим условима 4.0. / Vuk Stefanović Karadžić (1787–1864), public domain; page text from Serbian Wikisource under CC BY-SA 4.0.",
        url: "https://creativecommons.org/licenses/by-sa/4.0/",
      },
      source: { name: "Викизворник (sr.wikisource.org)", url: "https://sr.wikisource.org/" },
      minAppVersion: MIN_APP_VERSION,
    };
  }
  if (id === "tales-en") {
    return {
      format: PACK_FORMAT,
      id,
      version: PACK_VERSION,
      kind: "content",
      title: { sr: "Бајке и басне (на енглеском)", en: "Fairy tales and fables in English" },
      description: {
        sr: "Браћа Грим у преводу Маргарет Хант, Андерсен и Езоп, из издања у јавном власништву на Project Gutenberg-у. Текст је изворни; заглавље и подножје Gutenberg-а су уклоњени, а његово обавештење о лиценци је задржано у подацима о извору.",
        en: "Grimms' Household Tales in Margaret Hunt's translation, Andersen and Aesop, from public-domain Project Gutenberg ebooks. The text is the source's own; the Gutenberg wrapper is stripped and its licence notice is kept in the pack's provenance.",
      },
      licence: {
        spdx: "LicenseRef-Public-Domain",
        attribution:
          "Public domain in the United States: the Brothers Grimm (transl. Margaret Hunt, 1884), Hans Christian Andersen (1875), Aesop, V. S. Vernon Jones (1912). Texts from Project Gutenberg ebooks 5314, 1597, 27200 and 11339. The Project Gutenberg trademark and licence terms are not public domain and are not used in the articles.",
        url: "https://www.gutenberg.org/policy/license.html",
      },
      source: { name: "Project Gutenberg", url: "https://www.gutenberg.org/" },
      minAppVersion: MIN_APP_VERSION,
    };
  }
  throw new Error(`tales: there is no pack called "${id}".`);
}

/** What a collection's report line says. */
function summarise(built) {
  return built.toc.map((collection) => ({
    id: collection.id,
    title: collection.title,
    articles: (collection.children ?? []).length,
  }));
}

/**
 * The English pack: four ebooks, one collection each.
 *
 * Which books is a research finding, not a conversion rule — the conversion
 * rules live in `gutenberg.mjs` — and the choice of Margaret Hunt's Household
 * Tales over Edgar Taylor's Grimms' Fairy Tales is the one to justify: hers is
 * the complete translation of the 1812/1814 collection, while Taylor's 1823
 * volume selected about fifty stories for children, as Project Gutenberg's own
 * note on the Taylor edition says.
 */
export async function buildEn({ cacheRoot, outDir, offline = false, fetchSource }) {
  const collections = [];
  const provenance = [];
  for (const book of GUTENBERG_BOOKS) {
    const file = `gutenberg-${book.ebook}.txt`;
    const source = await fetchSource({ packId: "tales-en", cacheRoot, file, url: book.textUrl, offline });
    provenance.push({
      file,
      url: book.textUrl,
      ebook: book.ebook,
      title: book.title,
      credit: book.credit,
      bytes: source.bytes.byteLength,
      sha256: source.sha256,
      cached: source.cached,
      articles: 0,
    });
    // `parseBook` makes the fidelity assertion itself, per article, so a book
    // that cannot be split or converted stops here rather than at the end.
    const parsed = parseBook(source.bytes.toString("utf8"), { id: book.slug, stopAt: book.stopAt });
    provenance.at(-1).articles = parsed.articles.length;
    const landing = `https://www.gutenberg.org/ebooks/${book.ebook}`;
    collections.push({
      id: book.slug,
      title: `${book.title} — ${book.credit}`,
      source: { title: book.title, url: landing },
      articles: parsed.articles.map((article) => ({
        id: `${book.slug}-${slug(article.title)}`,
        title: article.title,
        markdown: article.markdown,
        source: { title: book.title, url: landing },
        sourceLine: `*Source:* ${book.credit}, „${article.title}" — Project Gutenberg eBook #${book.ebook}, ${landing}`,
      })),
    });
    if (parsed.unmatched.length > 0) {
      console.log(
        `  ${book.slug}: ${String(parsed.unmatched.length)} contents entries matched no heading: ${parsed.unmatched.slice(0, 3).join(" | ")}`,
      );
    }
  }
  const built = assemblePack({ id: "tales-en", language: "en", collections, outDir });
  return { built, shape: checkPackShape(outDir), provenance, collections: summarise(built) };
}

/**
 * The MediaWiki API, politeness included.
 *
 * Wikimedia rate-limits by client: a run that asks for two hundred pages in a
 * tight loop gets an HTTP 429 and a paragraph explaining that it asked rudely.
 * So: one request at a time, a fixed pause between them, `maxlag` so the API
 * can tell this client to wait rather than drop it, a backoff long enough to
 * matter, and a cache, so the bill is paid once.
 */
export class WikisourceClient {
  constructor({ packId, cacheRoot, offline = false, delayMs = 700, cacheDir, fetchImpl = fetch }) {
    this.packId = packId;
    this.cacheRoot = cacheRoot;
    this.offline = offline;
    this.delayMs = delayMs;
    this.cacheDir = cacheDir;
    this.fetchImpl = fetchImpl;
  }

  async get(params, name = undefined) {
    const query = new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params });
    const url = `${WIKISOURCE.api}?${query.toString()}`;
    // The cache file is named after WHAT WAS ASKED FOR, so a second run can
    // tell which response it is reusing without opening it: the page id when
    // there is one, the page title, and otherwise the list being enumerated.
    const subject = params.pageid ?? params.page ?? params.titles ?? params.list ?? "api";
    const file = `wiki-${slug(params.action ?? "query")}-${name ?? slug(String(subject))}.json`;
    const dest = join(this.cacheDir, file);
    if (existsSync(dest)) return JSON.parse(readFileSync(dest, "utf8"));
    if (this.offline) {
      throw new Error(`tales: the Wikisource response "${file}" is not in the cache and --offline was given.`);
    }
    for (let attempt = 0; ; attempt += 1) {
      await new Promise((done) => setTimeout(done, this.delayMs));
      const response = await this.fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
      const text = await response.text();
      const retry = response.status === 429 || response.status >= 500 || /maxlag|too many requests/i.test(text.slice(0, 400));
      if (retry && attempt < 5) {
        const wait = 2000 * (attempt + 1);
        console.log(`    Wikisource answered ${String(response.status)}; waiting ${String(wait)} ms.`);
        await new Promise((done) => setTimeout(done, wait));
        continue;
      }
      if (!response.ok) throw new Error(`tales: the Wikisource API answered ${String(response.status)}.`);
      if (text.trimStart().startsWith("<")) {
        throw new Error("tales: the Wikisource API answered HTML where JSON was asked for.");
      }
      const parsed = JSON.parse(text);
      if (parsed.error !== undefined) {
        throw new Error(`tales: the Wikisource API refused: ${String(parsed.error.info ?? parsed.error.code)}`);
      }
      writeFileSync(dest, text);
      return parsed;
    }
  }

  /** Every page of a category, in the wiki's own order. */
  async categoryMembers(category) {
    const answer = await this.get({
      action: "query",
      list: "categorymembers",
      cmtitle: category,
      cmlimit: "500",
      cmtype: "page",
    });
    return answer.query.categorymembers.map((member) => ({ pageid: member.pageid, title: member.title }));
  }

  /** One page's rendered HTML, as the reader sees it, and the revision it is. */
  async pageHtml(pageid) {
    const answer = await this.get({
      action: "parse",
      pageid: String(pageid),
      prop: "text|revid",
      disablelimitreport: "1",
      disableeditsection: "1",
    });
    return { html: answer.parse.text, revid: answer.parse.revid };
  }

  /**
   * The current revision id of each named page, in as few requests as the API
   * allows (fifty titles per query).
   *
   * It is recorded in `sources.json` beside the page's hash: a hash says which
   * bytes this build read, and a revision id says which edit of the page those
   * bytes were, which is the thing a reader of the evidence can look up.
   */
  async revisions(titles) {
    const revids = new Map();
    for (let start = 0; start < titles.length; start += 50) {
      const chunk = titles.slice(start, start + 50);
      const answer = await this.get(
        { action: "query", prop: "revisions", rvprop: "ids", titles: chunk.join("|") },
        `revids-${String(start / 50).padStart(2, "0")}`,
      );
      for (const page of answer.query.pages) {
        revids.set(page.title, page.revisions?.[0]?.revid ?? null);
      }
    }
    return revids;
  }
}

/** The page URL a title lives at, with the wiki's own underscores. */
export function pageUrl(title) {
  return `https://sr.wikisource.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

/**
 * The Serbian pack: the tales of Vuk's 1870 edition, and his proverbs.
 *
 * The category „Категорија:Српске народне приповетке" holds 207 pages and they
 * are not one collection: most of the rest are Vuk Vrčević's 1868 book, some
 * are magazine pieces from „Босанска вила" and „Словинац", one is from a 2002
 * anthology. This pack is Vuk Stefanović Karadžić's, so a page is included when
 * its own `Извор` section names him — the same field the article's Source line
 * is built from, so the selection and the credit cannot drift apart. What was
 * left out is reported and named in `docs/packs/tales.md`, not silently
 * dropped.
 */
export async function buildSr({ outDir, client }) {
  const members = await client.categoryMembers(WIKISOURCE.category);
  console.log(`  ${String(members.length)} pages in ${WIKISOURCE.category}; reading each page's rendered HTML.`);
  // The revision ids come from one batched query rather than from each page's
  // own response, so asking for them costs five requests and not two hundred.
  const revids = await client.revisions(members.map((member) => member.title));
  const included = [];
  const excluded = [];
  for (const [index, member] of members.entries()) {
    const { html } = await client.pageHtml(member.pageid);
    const revid = revids.get(member.title) ?? null;
    // The selection is made on the page's own `Извор` section BEFORE the page
    // is converted: the category also holds index pages with no tale on them,
    // and a page this pack does not want is not a page that should be able to
    // stop the build by converting to nothing.
    const citation = sourceSection(html);
    if (!WIKISOURCE.vukMarker.test(citation)) {
      excluded.push({ title: member.title, citation: citation.slice(0, 100) });
      continue;
    }
    const page = convertPage({ html, title: member.title });
    assertFidelity(page.markdown, page.oracle, `tales-sr: ${member.title}`);
    included.push({
      pageid: member.pageid,
      revid,
      title: member.title,
      url: pageUrl(member.title),
      sha256: sha256(Buffer.from(html, "utf8")),
      citation: page.source,
      licence: page.licence,
      markdown: page.markdown,
    });
    if ((index + 1) % 25 === 0) console.log(`    ${String(index + 1)}/${String(members.length)} pages read`);
  }

  const collections = [
    {
      id: WIKISOURCE.vukCollection.id,
      title: WIKISOURCE.vukCollection.title,
      source: { title: "Српске народне приповијетке", url: WIKISOURCE.vukCollection.url },
      articles: bySerbianTitle(included).map((record) => ({
        id: slug(record.title),
        title: record.title,
        markdown: record.markdown,
        source: { title: "Српске народне приповијетке (1870)", url: record.url },
        sourceLine: `*Извор:* ${record.citation} — Викизворник, ${record.url}`,
      })),
    },
  ];

  const proverbsAnswer = await client.get({
    action: "parse",
    page: WIKISOURCE.proverbs.page,
    prop: "text|revid",
    disablelimitreport: "1",
    disableeditsection: "1",
  });
  const proverbsHtml = proverbsAnswer.parse.text;
  const proverbs = convertPage({ html: proverbsHtml, title: WIKISOURCE.proverbs.page });
  assertFidelity(proverbs.markdown, proverbs.oracle, `tales-sr: ${WIKISOURCE.proverbs.page}`);
  collections.push({
    id: WIKISOURCE.proverbs.id,
    title: WIKISOURCE.proverbs.title,
    source: { title: WIKISOURCE.proverbs.title, url: WIKISOURCE.proverbs.url },
    articles: [
      {
        // The collection and its one article would fold to the same id, and an
        // id the pack uses twice is an id the Reader cannot resolve.
        id: `${slug(WIKISOURCE.proverbs.id)}-ceo-tekst`,
        title: WIKISOURCE.proverbs.title,
        markdown: proverbs.markdown,
        source: { title: WIKISOURCE.proverbs.title, url: WIKISOURCE.proverbs.url },
        sourceLine:
          "*Извор:* Вук Стеф. Караџић, Српске народне пословице и друге различне као оне у обичају узете речи " +
          `(Београд: Српска краљевска државна штампарија, 1900) — Викизворник, ${WIKISOURCE.proverbs.url}`,
      },
    ],
  });

  const built = assemblePack({ id: "tales-sr", language: "sr", collections, outDir });
  const shape = checkPackShape(outDir);
  return {
    built,
    shape,
    collections: summarise(built),
    excluded,
    provenance: {
      categoryUrl: `${WIKISOURCE.api}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(WIKISOURCE.category)}&cmlimit=500&cmtype=page`,
      tales: {
        bytes: included.reduce((sum, record) => sum + Buffer.byteLength(record.markdown, "utf8"), 0),
        // One hash over the corpus, so `sources.json` can be checked in a
        // glance: the pages are hashed in title order, and the corpus hash is
        // the hash of those hashes.
        sha256: sha256(
          Buffer.from(
            included
              .map((record) => `${record.title}\n${record.sha256}`)
              .sort()
              .join("\n"),
            "utf8",
          ),
        ),
        pages: included
          .map((record) => ({
            title: record.title,
            url: record.url,
            revid: record.revid,
            sha256: record.sha256,
            licence: record.licence,
          }))
          .sort((left, right) => (left.title < right.title ? -1 : 1)),
      },
      proverbs: {
        url: `${WIKISOURCE.api}?action=parse&page=${encodeURIComponent(WIKISOURCE.proverbs.page)}&prop=text`,
        bytes: Buffer.byteLength(proverbsHtml, "utf8"),
        sha256: sha256(Buffer.from(proverbsHtml, "utf8")),
        revid: proverbsAnswer.parse.revid,
        licence: proverbs.licence,
      },
    },
  };
}

/**
 * Builds the packs and prints what it did: the sources it fetched, the size and
 * article count of each pack, and how long the whole thing took.
 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const started = Date.now();
  const results = [];
  const cacheDirs = {};
  for (const id of options.packs) {
    const outDir = join(options.out, id);
    mkdirSync(outDir, { recursive: true });
    cacheDirs[id] = cacheDirFor(id, options.cache);
    console.log(`tales: building ${id} (${options.offline ? "cache only" : "cache + network"})`);
    const client = new WikisourceClient({
      packId: "tales-sr",
      cacheRoot: options.cache,
      offline: options.offline,
      cacheDir: cacheDirs["tales-sr"],
    });
    const result = id === "tales-sr"
      ? await buildSr({ outDir, client })
      : await buildEn({ cacheRoot: options.cache, outDir, offline: options.offline, fetchSource });
    const metaFile = writeMeta({ outDir, meta: packMeta(id) });
    for (const collection of result.collections) {
      console.log(`  ${collection.id}: ${String(collection.articles)} articles`);
    }
    printFetched(result);
    if (Array.isArray(result.excluded)) {
      const groups = new Map();
      for (const page of result.excluded) {
        const key = page.citation.slice(0, 45).trim() || "(no Извор section)";
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      const wanted = [...groups.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5);
      console.log(`  left out ${String(result.excluded.length)} pages of the category: ${wanted.map(([key, count]) => `${String(count)}× ${key}`).join("; ")}`);
    }
    console.log(
      `  ${id}: ${String(result.built.articles)} articles, ${String(result.built.bytes)} bytes, ${String(result.built.files.length)} files, ` +
        `${String(result.shape.entries)} TOC entries`,
    );
    console.log(`  metadata: ${metaFile}`);
    results.push({ id, ...result, metaFile });
  }
  await writeProvenance(options, results, cacheDirs);
  console.log(`tales: done in ${String(Date.now() - started)} ms`);
  return results;
}

/**
 * What each pack was built from, one line per fetched source, so that a run's
 * output says which files it read and whether they came from the cache.
 */
function printFetched(result) {
  if (Array.isArray(result.provenance)) {
    for (const source of result.provenance) {
      console.log(
        `  ${source.cached === true ? "cache" : "net  "}  ${String(source.file)}: ${String(source.bytes)} bytes` +
          `${source.sha256 === undefined ? "" : `, sha256 ${source.sha256.slice(0, 16)}…`}, ${String(source.articles)} articles`,
      );
    }
    return;
  }
  console.log(
    `  Wikisource: ${String(result.provenance.tales.pages.length)} pages of Vuk's edition, ` +
      `${String(result.provenance.tales.bytes)} bytes of article text, corpus sha256 ${String(result.provenance.tales.sha256).slice(0, 16)}…`,
  );
  console.log(
    `  Wikisource: ${WIKISOURCE.proverbs.page}, ${String(result.provenance.proverbs.bytes)} bytes, revid ${String(result.provenance.proverbs.revid)}`,
  );
}

/**
 * Fetches the licence pages, checks every quoted sentence against the file it
 * came from, and writes `sources.json` next to this script.
 *
 * The licence pages are ordinary sources and go through the ordinary cache; the
 * check is what makes `sources.json` evidence rather than prose. A quote that
 * no longer appears in its page fails the run, so a source that changed its
 * terms cannot be reported as if it had not.
 */
async function writeProvenance(options, results, cacheDirs) {
  for (const page of EVIDENCE_PAGES) {
    if (!options.packs.includes(page.packId)) continue;
    await fetchSource({ packId: page.packId, cacheRoot: options.cache, file: page.file, url: page.url, offline: options.offline });
  }
  const en = results.find((result) => result.id === "tales-en");
  const sr = results.find((result) => result.id === "tales-sr");
  const sources = buildSources({
    date: isoDate(),
    en: { books: en?.provenance ?? [] },
    sr: sr?.provenance ?? { categoryUrl: "", tales: { bytes: 0, pages: [] }, proverbs: { bytes: 0, sha256: "", revid: 0 } },
  });
  const problems = [];
  let checked = 0;
  for (const [packId, pack] of Object.entries(sources.packs)) {
    // A run that built one pack cannot check the other's quotes: its cache
    // directory does not exist. `sources.json` is only written when both were
    // built, which is where that asymmetry would otherwise matter.
    if (!options.packs.includes(packId)) continue;
    // The pack's own licence carries evidence too — Project Gutenberg's terms
    // are one document about all four books — so it is checked the same way.
    for (const source of [{ id: `${packId} licence`, evidence: pack.licence.evidence }, ...pack.sources]) {
      for (const item of source.evidence) {
        if (item.file === undefined) continue;
        const text = readEvidence(cacheDirs[packId], item.file);
        checked += 1;
        if (!quoteAppears(text, item.quote)) problems.push(`${source.id}: the quote from ${String(item.url)} is not on ${item.file}`);
      }
    }
  }
  // The Serbian public-domain statement lives on the corpus pages themselves
  // rather than on a policy page, so it is checked against the corpus.
  const corpusQuote = sources.packs["tales-sr"]?.sources[0]?.evidence.at(-1)?.quote;
  if (corpusQuote !== undefined && options.packs.includes("tales-sr")) {
    const found = readdirSync(cacheDirs["tales-sr"])
      .filter((name) => /^wiki-parse-\d+\.json$/.test(name))
      .some((name) => {
        const answer = JSON.parse(readFileSync(join(cacheDirs["tales-sr"], name), "utf8"));
        // `textOf` and not the raw markup: the statement is a sentence of the
        // page's text, and the page marks the author's name with a link.
        return typeof answer.parse?.text === "string" && quoteAppears(textOf(answer.parse.text), corpusQuote);
      });
    checked += 1;
    if (!found) problems.push("tales-sr: the public-domain statement was not found on any fetched page.");
  }
  if (problems.length > 0) {
    throw new Error(`tales: the licence evidence does not check out:\n  ${problems.join("\n  ")}`);
  }
  if (options.writeSources) {
    // Both packs or neither: `sources.json` is the committed record of both, and
    // a run that wrote it after building one pack would replace it with half of
    // itself and look, from the outside, exactly like a record of the whole.
    if (options.packs.length !== PACK_IDS.length) {
      console.log("tales: sources.json was NOT written — it records both packs, and this run built one.");
      return sources;
    }
    const file = fileURLToPath(new URL("sources.json", import.meta.url));
    writeFileSync(file, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
    console.log(`tales: sources.json written to ${file}`);
  }
  console.log(`tales: ${String(checked)} licence quotes checked against the fetched pages.`);
  return sources;
}

/**
 * `--pack` (repeatable: `tales-sr`, `tales-en` or `all`), `--cache`, `--out`,
 * `--offline`. A flag nobody knows is an error rather than a silent full build.
 */
export function parseArgs(argv) {
  const packs = [];
  const options = {
    cache: join(process.env.TEMP ?? ".", "nexus-pack-cache"),
    out: join(process.env.TEMP ?? ".", "nexus-packs"),
    offline: false,
    writeSources: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--offline") {
      options.offline = true;
      continue;
    }
    if (flag === "--write-sources") {
      options.writeSources = true;
      continue;
    }
    if (flag === "--pack" || flag === "--cache" || flag === "--out") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`tales: ${flag} needs a value.`);
      if (flag === "--pack") packs.push(...(value === "all" ? PACK_IDS : [value]));
      else options[flag === "--cache" ? "cache" : "out"] = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`tales: unknown argument ${JSON.stringify(flag)}.`);
  }
  for (const pack of packs) {
    if (!PACK_IDS.includes(pack)) throw new Error(`tales: there is no pack called "${pack}".`);
  }
  options.packs = packs.length === 0 ? [...PACK_IDS] : [...new Set(packs)];
  return options;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
