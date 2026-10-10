// No shebang, for the reason `pack-sign.mjs` gives: this module is both a CLI
// and an import target for its own test, and the test must not run a build.

/**
 * The `collections-wikidata` dataset pack: the twenty-five suggested Library
 * collections, derived from objective Wikidata statements.
 *
 * WHAT THIS IS. A pack of the `dataset` kind whose one content file is
 * `collections.json`, the layout the Library module's pack reader consumes
 * (`apps/desktop/src/modules/library/main/packCollections.ts`, layout 1). The
 * content is not written by hand: every collection is the result of one SPARQL
 * query in `queries/`, frozen into the cache under `%TEMP%`, and converted here.
 * Re-running the script re-fetches nothing while the cache still matches the
 * query, so a rebuild is cheap and a refresh is one flag (`--refresh`).
 *
 * WHY THE QUERIES LIVE HERE. They are the provenance of every list: a list
 * whose membership rule is not readable is a list nobody can check, and the
 * converter below is deliberately dumb BECAUSE the query is where the judgement
 * belongs. The only query whose scope is a judgement call rather than a
 * statement is `yugoslav-black-wave-films`, and its own header says so.
 *
 * THE LICENCE IS CC0-1.0, and the evidence is in `sources.json` beside this
 * file: the two pages that state it, quoted verbatim, re-fetched on 2026-10-10.
 * CC0 asks for no attribution; the per-collection `description` carries a
 * courtesy one anyway, because a person reading a list out of a pack deserves to
 * know where it came from. Nothing is downloaded at run time by the application:
 * this script runs on a maintainer's machine, only when the pack is built.
 *
 * NO COVERS, deliberately: the research measured an image for 187 of the 1,836
 * bundled works, and 56 of those 187 carry attribution or share-alike terms, so
 * a grid of covers would be nine-tenths empty and would stop the pack being
 * CC0. See `docs/packs/collections.md`.
 *
 * Usage:
 *   node scripts/packs/collections/build.mjs [--refresh] [--offline]
 *
 *   --refresh  fetch every query again, even when the cache holds it
 *   --offline  refuse to touch the network; a query missing from the cache is an error
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

/** The builder's own folder, so every path below is relative to this file and not to a working directory. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The pack's id: kebab-case, and the name of the folder it is assembled into. */
export const PACK_ID = "collections-wikidata";

/** The one file name the Library module reads inside a `dataset` pack. */
export const COLLECTIONS_FILE = "collections.json";

/** The only layout the Library module's reader accepts. A change here is a change there first. */
export const LAYOUT = 1;

/** The Wikidata Query Service, the pack's only source. */
const ENDPOINT = "https://query.wikidata.org/sparql?format=json";

/**
 * The user agent Wikimedia's policy requires: what this is, and where to
 * complain. A script that omits one may be blocked, and a blocked refresh is a
 * pack nobody can rebuild.
 */
const USER_AGENT =
  "NexusCollectionsPackBuilder/1.0 (offline knowledge app; +https://github.com/lukastojiljkovic/Nexus)";

/**
 * The pause between two live queries, and the number of attempts one query gets.
 *
 * WDQS allows 60 seconds of query time per 60 seconds per client and answers
 * HTTP 429 with `Retry-After` when that is exceeded, so the pace is not
 * politeness — it is the documented way to stay inside the budget. Measured
 * cost with this pause is a few minutes for the whole pack, once.
 */
const PAUSE_MS = 8_000;
const ATTEMPTS = 3;

/**
 * The bounds the Library module applies to a pack's collections, copied here
 * because this script must not be able to write a file the application refuses:
 * `packCollections.ts` does not read the collections it can parse, it refuses
 * the whole file, so one over-long label anywhere would ship a pack that offers
 * nothing at all.
 */
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 500;
const MAX_CREATORS = 20;
const MAX_CREATOR_NAME = 120;
const MIN_YEAR = 1;
const MAX_YEAR = 9999;
/** `isWikidataId`'s shape: `Q` and a positive integer with no leading zero. */
const QID = /^Q[1-9]\d{0,17}$/;
/** A four-digit-or-shorter positive year, as WDQS renders `YEAR()` of a date. */
const YEAR = /^\d{1,4}$/;

/**
 * Serbian sorting uses the Latin collator, not plain `"sr"`: the default
 * Serbian tailors Cyrillic, and a creator list or a title list ordered with it
 * puts `š`, `č` and `ć` in the wrong places (`CLAUDE.md`'s rule, and the
 * collator the module stores here all use).
 */
const COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * The courtesy attribution every collection carries, in both languages.
 *
 * It travels in the collection's `description` because layout 1 has no field of
 * its own for it and the reader refuses a key the layout does not define — a
 * pack that invented `attribution` would install into nothing.
 */
export const ATTRIBUTION = {
  sr: "Podaci sa Vikipodataka, posvećeni javnom dobru pod licencom CC0 1.0.",
  en: "Data from Wikidata, dedicated to the public domain under CC0 1.0.",
};

/**
 * The pages that state the licence, and the sentence on each, quoted verbatim
 * and re-fetched on 2026-10-10. `sources.json` records them beside every
 * fetched response; a source without evidence is not used.
 */
const LICENCE_EVIDENCE = [
  {
    url: "https://www.wikidata.org/wiki/Wikidata:Copyright",
    quote:
      "All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available under " +
      "the Creative Commons CC0 License; text in the other namespaces is available under the Creative Commons " +
      "Attribution-ShareAlike License; additional terms may apply.",
  },
  {
    url: "https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/Copyright",
    quote:
      "Wikidata Query Service provides information from Wikidata, which is available under CC0.",
  },
];

/**
 * The twenty-five collections, in the order the pack lists them, with the
 * research's own Serbian titles kept verbatim.
 *
 * `small` marks the lists the research measured as thin (five, eight, and the
 * two award-by-author lists whose labels or years are mostly missing), which the
 * page shows as "Mala zbirka" rather than as a perfect list.
 */
export const COLLECTIONS = [
  { id: "booker-prize", kind: "book", title: { sr: "Dobitnici Bukerove nagrade", en: "Booker Prize winners" } },
  {
    id: "international-booker-prize",
    kind: "book",
    title: { sr: "Dobitnici Međunarodne Bukerove nagrade", en: "International Booker Prize winners" },
  },
  {
    id: "pulitzer-prize-fiction",
    kind: "book",
    title: { sr: "Dobitnici Pulicerove nagrade za fikciju", en: "Pulitzer Prize for Fiction winners" },
  },
  {
    id: "hugo-award-best-novel",
    kind: "book",
    title: { sr: "Dobitnici nagrade Hjugo za najbolji roman", en: "Hugo Award for Best Novel winners" },
  },
  {
    id: "nebula-award-best-novel",
    kind: "book",
    title: { sr: "Dobitnici nagrade Nebula za najbolji roman", en: "Nebula Award for Best Novel winners" },
  },
  { id: "prix-goncourt", kind: "book", title: { sr: "Dobitnici Gonkurove nagrade", en: "Prix Goncourt winners" } },
  {
    id: "womens-prize-fiction",
    kind: "book",
    small: true,
    title: { sr: "Dobitnice Nagrade za fikciju za žene", en: "Women's Prize for Fiction winners" },
  },
  {
    id: "german-book-prize",
    kind: "book",
    title: { sr: "Dobitnici Nemačke nagrade za knjigu", en: "German Book Prize winners" },
  },
  { id: "harvard-classics", kind: "book", title: { sr: "Harvardska klasika", en: "Harvard Classics" } },
  {
    id: "nin-prize-winners-books",
    kind: "book",
    title: { sr: "Romani dobitnika NIN-ove nagrade", en: "Novels by NIN Prize winners" },
  },
  {
    id: "works-of-ivo-andric",
    kind: "book",
    title: { sr: "Dela Ive Andrića", en: "Works by Ivo Andrić" },
  },
  {
    id: "isidora-sekulic-books",
    kind: "book",
    small: true,
    title: {
      sr: "Knjige dobitnika nagrade Isidore Sekulić",
      en: "Works by Isidora Sekulić Award winners",
    },
  },
  {
    id: "kresnik-books",
    kind: "book",
    small: true,
    title: { sr: "Knjige dobitnika nagrade Kresnik", en: "Works by Kresnik Award winners" },
  },
  {
    id: "academy-award-best-picture",
    kind: "film",
    title: { sr: "Dobitnici Oskara za najbolji film", en: "Academy Award for Best Picture winners" },
  },
  { id: "palme-dor", kind: "film", title: { sr: "Dobitnici Zlatne palme", en: "Palme d'Or winners" } },
  {
    id: "golden-lion",
    kind: "film",
    title: { sr: "Dobitnici Zlatnog lava", en: "Golden Lion winners (Venice)" },
  },
  {
    id: "golden-bear",
    kind: "film",
    title: { sr: "Dobitnici Zlatnog medveda", en: "Golden Bear winners (Berlin)" },
  },
  {
    id: "studio-ghibli-films",
    kind: "film",
    title: { sr: "Filmovi studija Gibli", en: "Studio Ghibli films" },
  },
  {
    id: "films-by-emir-kusturica",
    kind: "film",
    title: { sr: "Filmovi Emira Kusturice", en: "Films by Emir Kusturica" },
  },
  {
    id: "yugoslav-black-wave-films",
    kind: "film",
    title: { sr: "Filmovi jugoslovenskog crnog talasa", en: "Yugoslav Black Wave films" },
  },
  { id: "serbian-films", kind: "film", title: { sr: "Srpski filmovi", en: "Serbian films" } },
  {
    id: "big-golden-arena-best-film",
    kind: "film",
    small: true,
    title: { sr: "Dobitnici Velike zlatne arene", en: "Big Golden Arena winners (Pula)" },
  },
  {
    id: "emmy-outstanding-drama-series",
    kind: "series",
    title: { sr: "Dobitnici Emija za najbolju dramsku seriju", en: "Emmy winners: Outstanding Drama Series" },
  },
  {
    id: "emmy-outstanding-comedy-series",
    kind: "series",
    title: { sr: "Dobitnici Emija za najbolju komediju", en: "Emmy winners: Outstanding Comedy Series" },
  },
  {
    id: "golden-globe-drama-series",
    kind: "series",
    title: {
      sr: "Dobitnici Zlatnog globusa za najbolju dramsku seriju",
      en: "Golden Globe winners: Best Drama Series",
    },
  },
];

/** The Q-id inside a Wikidata entity IRI, or null when the binding is not one. */
export function qidOf(iri) {
  if (typeof iri !== "string") return null;
  const prefix = "http://www.wikidata.org/entity/";
  if (!iri.startsWith(prefix)) return null;
  const id = iri.slice(prefix.length);
  return QID.test(id) ? id : null;
}

/**
 * A label the layout can carry: trimmed, non-empty and inside the title bound.
 *
 * A label is refused rather than truncated, and refusing it loses that language
 * and not the work: an item whose Wikidata entry is labelled only in a third
 * language has no title this reader can draw, which is why the converter drops
 * such an item below instead of shipping a Q-id where a title belongs.
 */
function labelOf(value) {
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (label.length === 0 || label.length > MAX_TITLE) return null;
  return label;
}

/** A publication year as the layout stores it, or null for anything that is not one. */
function yearOf(value) {
  if (typeof value !== "string" || !YEAR.test(value)) return null;
  const year = Number(value);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

/**
 * The creators of one row, canonical: trimmed, de-duplicated, sorted with the
 * Serbian collator and capped.
 *
 * WDQS hands them over as one `GROUP_CONCAT` string whose ORDER IS NOT STABLE
 * (the research measured two live runs of one query differing only in this
 * order), so they are sorted here; without that, a monthly refresh would produce
 * a diff nobody made. A name over the module's own bound is dropped rather than
 * shipped, because `validateLibraryCreators` refuses the whole LIST for one
 * over-long name, and a refused list is a refused collection.
 */
function creatorsOf(value) {
  if (typeof value !== "string") return [];
  const names = [];
  for (const part of value.split("; ")) {
    const name = part.trim();
    if (name.length === 0 || name.length > MAX_CREATOR_NAME) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names.sort((a, b) => COLLATOR.compare(a, b)).slice(0, MAX_CREATORS);
}

/**
 * One WDQS row as the layout's item, as a record the merge below can fold
 * together, or null when the row cannot become one.
 *
 * Null covers the two rows this pack has nothing to say about: one whose
 * `?item` is not a Wikidata entity, and one with neither an English nor a
 * Serbian label.
 */
function recordOfRow(row, kind) {
  const wikidata = qidOf(row?.item?.value);
  if (wikidata === null) return null;
  const sr = labelOf(row?.sr?.value);
  const en = labelOf(row?.en?.value);
  if (sr === null && en === null) return null;
  const title = {};
  if (sr !== null) title.sr = sr;
  if (en !== null) title.en = en;
  const record = { type: kind, title, wikidata };
  const year = yearOf(row?.year?.value);
  if (year !== null) record.year = year;
  const creators = creatorsOf(row?.creators?.value);
  if (creators.length > 0) record.creators = creators;
  return record;
}

/**
 * One response's rows as the collection's items, merged by Wikidata id and put
 * in a stable order.
 *
 * The merge is a rule about the SOURCE rather than a repair of it: one query
 * groups by `?item ?en ?sr`, and an item with two labels in one language (or two
 * rows from a `VALUES` clause) would otherwise be one work counted twice in a
 * list a person adopts. The first row wins for a language it already has, the
 * earliest year wins, and creator lists unite — so a refresh that adds a missing
 * label cannot lose the row it arrived in.
 *
 * The order is the page's: by year, with a work whose year Wikidata does not
 * state last, and by title inside a year. Two runs over one cache write the same
 * bytes.
 */
export function itemsOfResponse(response, kind) {
  const rows = response?.results?.bindings;
  if (!Array.isArray(rows)) return [];
  const byId = new Map();
  for (const row of rows) {
    const record = recordOfRow(row, kind);
    if (record === null) continue;
    const held = byId.get(record.wikidata);
    if (held === undefined) {
      byId.set(record.wikidata, record);
      continue;
    }
    if (held.title.sr === undefined && record.title.sr !== undefined) held.title.sr = record.title.sr;
    if (held.title.en === undefined && record.title.en !== undefined) held.title.en = record.title.en;
    if (record.year !== undefined && (held.year === undefined || record.year < held.year)) {
      held.year = record.year;
    }
    if (record.creators !== undefined) {
      const united = [...new Set([...(held.creators ?? []), ...record.creators])];
      held.creators = united.sort((a, b) => COLLATOR.compare(a, b)).slice(0, MAX_CREATORS);
    }
  }

  const items = [...byId.values()];
  items.sort(
    (a, b) =>
      (a.year ?? Number.POSITIVE_INFINITY) - (b.year ?? Number.POSITIVE_INFINITY) ||
      COLLATOR.compare(a.title.sr ?? a.title.en, b.title.sr ?? b.title.en),
  );
  return items.map((record) => {
    const item = { type: record.type, title: record.title };
    if (record.year !== undefined) item.year = record.year;
    if (record.creators !== undefined) item.creators = record.creators;
    item.wikidata = record.wikidata;
    return item;
  });
}

/** One collection of the layout: the spec's copy, the courtesy attribution, and the items one response yields. */
export function collectionOf(spec, response) {
  const collection = {
    id: spec.id,
    title: { sr: spec.title.sr, en: spec.title.en },
    description: { sr: ATTRIBUTION.sr, en: ATTRIBUTION.en },
  };
  // `small?: true` is the layout's spelling: a value that says anything else did not come out of this format.
  if (spec.small === true) collection.small = true;
  collection.items = itemsOfResponse(response, spec.kind);
  return collection;
}

/** The pack's content file, from one raw response per collection id. */
export function buildPayload(responses) {
  return {
    layout: LAYOUT,
    collections: COLLECTIONS.map((spec) => collectionOf(spec, responses.get(spec.id))),
  };
}

/**
 * Every rule the Library module's reader applies, checked on the builder's own
 * output, as a list of sentences (empty means the file may be written).
 *
 * This is not a second reader — the reader is `packCollections.ts` and it
 * decides what installs. This is the builder refusing to WRITE a file it already
 * knows will be refused whole, which is invisible otherwise: a single over-long
 * label anywhere makes the application offer none of the twenty-five lists, and
 * nothing in a build log would say so.
 */
export function layoutProblems(payload) {
  const problems = [];
  const top = Object.keys(payload);
  if (top.length !== 2 || !top.includes("layout") || !top.includes("collections")) {
    problems.push(`the file's top level must hold "layout" and "collections" only (found ${top.join(", ")})`);
  }
  if (payload.layout !== LAYOUT) problems.push(`"layout" must be ${String(LAYOUT)}`);
  if (!Array.isArray(payload.collections) || payload.collections.length === 0) {
    problems.push('"collections" must be a non-empty array');
    return problems;
  }

  const ids = new Set();
  for (const collection of payload.collections) {
    const where = `"${String(collection.id)}"`;
    if (typeof collection.id !== "string" || collection.id.trim() !== collection.id || collection.id.length === 0 || collection.id.length > 120) {
      problems.push(`${where}: "id" must be a trimmed, non-empty string of at most 120 characters`);
    }
    if (ids.has(collection.id)) problems.push(`${where}: "id" is used twice`);
    ids.add(collection.id);

    for (const key of ["title", "description"]) {
      const pair = collection[key];
      const max = key === "title" ? MAX_TITLE : MAX_DESCRIPTION;
      if (pair === undefined && key === "description") continue;
      if (typeof pair !== "object" || pair === null) {
        problems.push(`${where}: "${key}" must be an object`);
        continue;
      }
      const languages = Object.keys(pair);
      if (languages.length !== 2 || !languages.includes("sr") || !languages.includes("en")) {
        problems.push(`${where}: "${key}" must carry exactly "sr" and "en"`);
      }
      for (const language of ["sr", "en"]) {
        const value = pair[language];
        if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > max) {
          problems.push(`${where}: "${key}.${language}" must be a trimmed, non-empty string of at most ${String(max)} characters`);
        }
      }
    }
    if (collection.small !== undefined && collection.small !== true) {
      problems.push(`${where}: "small" must be absent or true`);
    }

    if (!Array.isArray(collection.items) || collection.items.length === 0 || collection.items.length > 5_000) {
      problems.push(`${where}: "items" must hold between 1 and 5000 entries`);
      continue;
    }
    for (const item of collection.items) {
      const keys = Object.keys(item);
      const allowed = ["type", "title", "year", "creators", "wikidata"];
      if (!keys.includes("type") || !keys.includes("title") || keys.some((key) => !allowed.includes(key))) {
        problems.push(`${where}: an item's keys must be "type", "title" and only "year", "creators", "wikidata" besides`);
        continue;
      }
      if (!["book", "film", "series"].includes(item.type)) {
        problems.push(`${where}: an item's "type" must be book, film or series`);
      }
      const languages = Object.keys(item.title ?? {});
      if (
        languages.length === 0 ||
        languages.some((language) => language !== "sr" && language !== "en") ||
        languages.some((language) => {
          const value = item.title[language];
          return typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > MAX_TITLE;
        })
      ) {
        problems.push(`${where}: an item's "title" must carry at least one of "sr"/"en", each a trimmed string within the title bound`);
      }
      if (item.year !== undefined && (!Number.isInteger(item.year) || item.year < MIN_YEAR || item.year > MAX_YEAR)) {
        problems.push(`${where}: an item's "year" must be a whole year between ${String(MIN_YEAR)} and ${String(MAX_YEAR)}`);
      }
      if (item.creators !== undefined) {
        if (!Array.isArray(item.creators) || item.creators.length > MAX_CREATORS) {
          problems.push(`${where}: an item's "creators" must hold at most ${String(MAX_CREATORS)} names`);
        } else {
          const seen = new Set();
          for (const name of item.creators) {
            if (typeof name !== "string" || name.trim() !== name || name.length === 0 || name.length > MAX_CREATOR_NAME) {
              problems.push(`${where}: a creator name must be a trimmed, non-empty string of at most ${String(MAX_CREATOR_NAME)} characters`);
            }
            if (seen.has(name)) problems.push(`${where}: a creator name is listed twice`);
            seen.add(name);
          }
        }
      }
      if (typeof item.wikidata !== "string" || !QID.test(item.wikidata)) {
        problems.push(`${where}: an item's "wikidata" must be a Wikidata Q-id`);
      }
    }
  }
  return problems;
}

/**
 * How many rows one response holds and how many of them became items.
 *
 * Rows and items are not the same number, and the difference is a fact about
 * the source rather than a bug: an item whose Wikidata entry carries no English
 * and no Serbian label has no title this reader could draw, so it is left out,
 * and the count of those is printed by every build and recorded in
 * `docs/packs/collections.md`. Silently shipping a smaller list than the query
 * returned is the failure this count exists to make visible.
 */
export function countRows(response, kind) {
  const rows = Array.isArray(response?.results?.bindings) ? response.results.bindings : [];
  let kept = 0;
  for (const row of rows) if (recordOfRow(row, kind) !== null) kept += 1;
  return { rows: rows.length, kept, dropped: rows.length - kept };
}

/** Where an unpacked, unsigned pack is written. Never inside the repository. */
export function packOutputDir() {
  return join(tmpdir(), "nexus-packs");
}

/** Where the fetched responses are kept between builds. Never inside the repository. */
export function packCacheDir() {
  return join(tmpdir(), "nexus-pack-cache", PACK_ID);
}

/** The pack's own copy, and the app version the pack asks for. */
const PACK_TITLE = {
  sr: "Predložene zbirke za biblioteku",
  en: "Suggested library collections",
};

/**
 * The pack's attribution line, shown by the packs card for every pack. CC0 asks
 * for none; this one is a courtesy, and it says what a reader would want to know.
 */
const LICENCE_ATTRIBUTION =
  "Wikidata contributors — data from Wikidata, dedicated to the public domain under CC0 1.0.";

/**
 * The app version this pack asks for.
 *
 * The current build's version, not the wave's next one: a pack that asked for a
 * version nobody has shipped yet would be refused by every build that could
 * actually use it, and a `dataset` pack a build does not read yet is inert
 * rather than half-understood — nothing in it is interpreted, so nothing in it
 * is interpreted wrongly.
 */
const MIN_APP_VERSION = "1.5.0";

/** Hex SHA-256, the same digest `pack.json` records for every content file. */
function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Today, as a bare day: what `sources.json` and the pack's version are dated by. */
function isoDay() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The pack's version, from the day the data was fetched: `YYYY.M.D`, which is
 * `MAJOR.MINOR.PATCH` with no leading zeros and rises with the calendar. A
 * rebuild from a warm cache keeps it, so re-signing unchanged data cannot look
 * like a new release; `--refresh` moves it.
 */
export function versionOf(sources) {
  const newest = sources.map((source) => source.fetched).sort().at(-1) ?? isoDay();
  const [year, month, day] = newest.split("-").map(Number);
  return `${String(year)}.${String(month)}.${String(day)}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * One query, sent the one way WDQS documents: POST with the query in the body,
 * the pack's own user agent, and a bounded number of attempts on anything that
 * is not a 200 — honouring `Retry-After` when the service sends one, which is
 * what it does when the per-client query budget is exceeded.
 */
async function requestQuery(query) {
  let last = { status: 0, body: Buffer.alloc(0), retryAfter: null, ms: 0 };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const started = Date.now();
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `query=${encodeURIComponent(query)}`,
    });
    const body = Buffer.from(await response.arrayBuffer());
    last = { status: response.status, body, retryAfter: response.headers.get("retry-after"), ms: Date.now() - started };
    if (last.status === 200) return last;
    if (attempt < ATTEMPTS) await sleep(retryAfterMs(last.retryAfter) ?? 20_000 * attempt);
  }
  throw new Error(
    `WDQS answered ${String(last.status)} for this query after ${String(ATTEMPTS)} attempts: ` +
      last.body.toString("utf8").slice(0, 300),
  );
}

/** `Retry-After`, in milliseconds, when the service sent a number of seconds. */
function retryAfterMs(header) {
  if (header === null) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

/**
 * One collection's raw response: the cache when it still matches the query, and
 * the query service otherwise.
 *
 * The cache is keyed by collection id AND by the query's own SHA-256, so editing
 * a `.rq` invalidates it — a cache that outlived its query would refresh the
 * pack with an answer to a question nobody asks any more. `--refresh` re-fetches
 * regardless, which is how a source that changed under a stable address is
 * picked up.
 */
async function responseFor(spec, options) {
  const queryFile = `queries/${spec.id}.rq`;
  const query = readFileSync(join(HERE, queryFile), "utf8");
  const querySha256 = sha256Hex(Buffer.from(query, "utf8"));
  const directory = packCacheDir();
  const bodyPath = join(directory, `${spec.id}.json`);
  const metaPath = join(directory, `${spec.id}.meta.json`);

  if (!options.refresh && existsSync(bodyPath) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    if (meta.querySha256 === querySha256) {
      return { body: readFileSync(bodyPath), meta, fetches: 0, ms: 0 };
    }
  }
  if (options.offline) {
    throw new Error(`${spec.id} is not in the cache and --offline was given`);
  }

  const answer = await requestQuery(query);
  mkdirSync(directory, { recursive: true });
  let parsed;
  try {
    parsed = JSON.parse(answer.body.toString("utf8"));
  } catch {
    throw new Error(`WDQS answered something that is not JSON for ${spec.id}`);
  }
  const rows = Array.isArray(parsed?.results?.bindings) ? parsed.results.bindings.length : 0;
  const meta = {
    id: spec.id,
    queryFile,
    querySha256,
    url: ENDPOINT,
    fetched: isoDay(),
    fetchedAt: new Date().toISOString(),
    sha256: sha256Hex(answer.body),
    bytes: answer.body.byteLength,
    rows,
    ms: answer.ms,
  };
  writeFileSync(bodyPath, answer.body);
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  return { body: answer.body, meta, fetches: 1, ms: answer.ms };
}

/** The `sources.json` record of one fetched response: its address, its day, its digest and its licence evidence. */
function sourceRecord(meta) {
  return {
    id: meta.id,
    queryFile: meta.queryFile,
    url: meta.url,
    fetched: meta.fetched,
    sha256: meta.sha256,
    bytes: meta.bytes,
    rows: meta.rows,
    licence: "CC0-1.0",
    licenceEvidence: LICENCE_EVIDENCE,
  };
}

/**
 * The metadata `pack-sign.mjs` consumes: what the pack IS, without its file list
 * (the tool computes that from the folder, which is the half nobody can keep
 * correct by hand).
 *
 * The copy carries the counts the build MEASURED rather than a number written
 * once into a string: a description that said "1,900 titles" while the file held
 * 1,806 would be a document nobody could trust for anything else either.
 */
export function metaFor({ collections, entries, unique, version }) {
  return {
    format: 1,
    id: PACK_ID,
    version,
    kind: "dataset",
    title: { sr: PACK_TITLE.sr, en: PACK_TITLE.en },
    description: {
      sr:
        `${String(collections)} predloženih zbirki sa Vikipodataka: književne nagrade, filmske nagrade, ` +
        `televizijske serije i regionalne liste. Ukupno ${String(entries)} naslova, ` +
        `${String(unique)} jedinstvenih dela, svako sa naslovom na srpskom ili engleskom. Bez korica.`,
      en:
        `${String(collections)} suggested collections from Wikidata: literary prizes, film prizes, ` +
        `television series and regional lists. ${String(entries)} titles in all, over ` +
        `${String(unique)} unique works, each with a Serbian or English title. No cover images.`,
    },
    licence: {
      spdx: "CC0-1.0",
      attribution: LICENCE_ATTRIBUTION,
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    source: { name: "Wikidata Query Service", url: "https://query.wikidata.org/sparql" },
    minAppVersion: MIN_APP_VERSION,
  };
}

/** The `sources.json` document: the licence and its evidence once, then one record per fetched response. */
export function sourcesDocument(sources) {
  return {
    pack: PACK_ID,
    generated: sources.map((source) => source.fetched).sort().at(-1) ?? isoDay(),
    licence: {
      spdx: "CC0-1.0",
      attribution: LICENCE_ATTRIBUTION,
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
      evidence: LICENCE_EVIDENCE,
    },
    sources,
  };
}

async function main() {
  const flags = process.argv.slice(2);
  for (const flag of flags) {
    if (flag !== "--refresh" && flag !== "--offline") {
      throw new Error(`unknown argument "${flag}" (this script takes --refresh and --offline)`);
    }
  }
  const options = { refresh: flags.includes("--refresh"), offline: flags.includes("--offline") };
  const startedMs = Date.now();

  const responses = new Map();
  const counts = new Map();
  const sources = [];
  let fetches = 0;
  console.log(`collections-wikidata: ${String(COLLECTIONS.length)} queries, cache ${packCacheDir()}`);
  for (const spec of COLLECTIONS) {
    const { body, meta, fetches: fetched, ms } = await responseFor(spec, options);
    fetches += fetched;
    const parsed = JSON.parse(body.toString("utf8"));
    responses.set(spec.id, parsed);
    counts.set(spec.id, countRows(parsed, spec.kind));
    sources.push(sourceRecord(meta));
    const rows = counts.get(spec.id);
    const how = fetched === 1 ? `fetched in ${String(ms)} ms` : "cached";
    console.log(
      `  ${spec.id}: ${String(rows.rows)} rows, ${String(rows.kept)} kept, ${String(rows.dropped)} without a title (${how})`,
    );
    // One query at a time, and a pause after each live one: WDQS allows 60 s of
    // query time per 60 s per client, and the pause is the documented way to stay
    // inside it. A cached run never reaches this line.
    if (fetched === 1) await sleep(PAUSE_MS);
  }

  const payload = buildPayload(responses);
  const problems = layoutProblems(payload);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    throw new Error("the converted payload breaks the layout's rules; nothing was written");
  }

  const entries = payload.collections.reduce((sum, collection) => sum + collection.items.length, 0);
  const unique = new Set(payload.collections.flatMap((collection) => collection.items.map((item) => item.wikidata))).size;
  const withoutTitle = [...counts.values()].reduce((sum, rows) => sum + rows.dropped, 0);

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const bytes = Buffer.byteLength(json, "utf8");
  const gzipped = gzipSync(Buffer.from(json, "utf8"), { level: 9 }).byteLength;
  const folder = join(packOutputDir(), PACK_ID);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, COLLECTIONS_FILE), json);

  // The metadata file lives BESIDE the pack folder, never inside it: everything
  // inside is content, and `pack-sign.mjs` would list a metadata file left in
  // there as a file the pack contains.
  const metaPath = join(packOutputDir(), `${PACK_ID}.meta.json`);
  writeFileSync(
    metaPath,
    `${JSON.stringify(metaFor({ collections: payload.collections.length, entries, unique, version: versionOf(sources) }), null, 2)}\n`,
  );
  writeFileSync(join(HERE, "sources.json"), `${JSON.stringify(sourcesDocument(sources), null, 2)}\n`);

  const seconds = ((Date.now() - startedMs) / 1_000).toFixed(1);
  console.log(
    `collections-wikidata: ${String(payload.collections.length)} collections, ${String(entries)} entries, ` +
      `${String(unique)} unique works, ${String(withoutTitle)} rows without an sr/en label`,
  );
  console.log(
    `  ${COLLECTIONS_FILE}: ${String(bytes)} bytes pretty, ${String(gzipped)} bytes gzip -9; ` +
      `${String(fetches)} of ${String(COLLECTIONS.length)} queries fetched; ${seconds} s`,
  );
  console.log(`  pack folder: ${folder}`);
  console.log(`  metadata:    ${metaPath}`);
  console.log(`  sign:        node scripts/pack-sign.mjs --dir "${folder}" --meta "${metaPath}" --key <private-key.pem>`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

