// No shebang, for the reason the other scripts in this repository have none: it
// is both a CLI and an import target for its own tests.
//
//   node scripts/packs/art/build.mjs [--max 300] [--quality 80] [--measure-only]
//                                    [--interval 150] [--pool 50]
//
// WHAT THIS BUILDS. The `art-open-access` pack: a `dataset` folder holding
// `art.json` and `images/`, drawn from four museums' open collections and
// written to `%TEMP%\nexus-packs\art-open-access\`, with the metadata file that
// `scripts/pack-sign.mjs --meta` takes beside it. The maintainer signs the
// folder with the release key; this script never sees that key and never
// produces a `pack.json`.
//
// WHERE THINGS COME FROM. Downloads are cached under
// `%TEMP%\nexus-pack-cache\art-open-access\` and a re-run re-fetches nothing
// that already succeeded, which is what makes a failed build cheap to retry and
// keeps the museums from being asked twice for the same bytes. `sources.json`
// in this folder is written by the run and is the record of it: every request
// that mattered, with the date it was fetched and the SHA-256 of what came back,
// plus the sentence on each source's own site that permits the reuse.
//
// A SOURCE THAT WILL NOT ANSWER IS SKIPPED, NOT FATAL, and the two failures this
// pack has actually met are both in `sources.json`: a host whose TLS certificate
// had expired (the Smithsonian's image server, so a whole source was gone while
// its metadata API still answered) and a rate-limiter's HTTP 429 with a
// `Retry-After` of nineteen hours. A programming error still stops the build —
// the skip is for the two error types the HTTP layer raises and for nothing
// else. Any single work that will not download is one work left out, and the
// next candidate is taken in its place.

// Node's own modules, and the pack's own: no dependency beyond what the
// repository already has and the one image library the brief allows.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildArtJson,
  fromCommonsPainting,
  fromMetObject,
  fromRijksmuseum,
  fromSmithsonianRow,
  selectWorks,
  SOURCE_ORDER,
} from "./convert.mjs";
import { htmlToText, quotePresent } from "./evidence.mjs";
import { CachedHttp, SourceFailedError, SourceUnavailableError } from "./http.mjs";
import { measureQuality, prepareImage } from "./images.mjs";
import { licenceCounts } from "./licences.mjs";
import {
  commonsPaintingsQuery,
  commonsFileTitle,
  commonsImageInfoUrl,
  EVIDENCE_PAGES,
  GREAT_PAINTERS,
  MET_DEPARTMENTS,
  metObjectUrl,
  metSearchUrl,
  rijksSearchUrl,
  RIJKS_SEARCHES,
  REGIONAL_PAINTERS_QUERY,
  SMITHSONIAN_DEMO_KEY,
  SMITHSONIAN_SEARCHES,
  smithsonianSearchUrl,
  SOURCES,
  wikidataSearchUrl,
} from "./sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The pack's id, which is also its folder name and the name of the build cache. */
export const PACK_ID = "art-open-access";

/**
 * The pack's version, in the format `pack-sign.mjs` requires. A dated version
 * rather than a semantic one: the content is a point-in-time slice of four
 * collections, so "which one is newer" is a question about the date.
 */
export const PACK_VERSION = "2026.10.0";

/**
 * The app version this pack needs to be installed at all.
 *
 * It is the version in this worktree rather than a guess at the next release:
 * `minAppVersion` is a FLOOR, and a floor above the build that produced the pack
 * would make the pack uninstallable in the app that just built it. The pack is
 * data — no code, no format the reader must know — so an older app installs it
 * and simply has nothing that shows it.
 */
export const MIN_APP_VERSION = "1.5.0";

/** How many works the pack aims for, and how many each source contributes first. */
export const TARGET_WORKS = 300;
export const QUOTAS = { met: 120, smithsonian: 60, rijksmuseum: 60, commons: 60 };

/**
 * How deep each source's candidate pool is gathered. Deeper than the quota
 * because works are dropped on the way out — a record without a date, a
 * painting whose image will not download, a whole source whose host is down and
 * whose share has to come from somewhere.
 */
const POOL_TARGETS = { met: 150, smithsonian: 90, rijksmuseum: 90, commons: 130 };

/** How many works are encoded at every candidate quality before the pack is written. */
const QUALITY_SAMPLES = 10;

/** The Commons `imageinfo` batching: the API takes many titles per request. */
const COMMONS_BATCH = 25;

/**
 * How many painters go into one Wikidata `VALUES` list.
 *
 * Fifteen rather than all hundred and one, because a `VALUES` list makes the
 * response proportional to the paintings it names and WDQS closes the connection
 * on a large one: the same flat query with a hundred painters died mid-stream
 * after 1.1 MB. Seven small queries, each cached on its own, cost a few seconds
 * and none of them can take the whole Commons arm down with it.
 */
const PAINTER_CHUNK = 15;

/**
 * How many candidate paintings are enough. A little over twice the Commons
 * quota, because the licence filter and the missing-date rule both take a share.
 */
const COMMONS_CANDIDATE_BUDGET = 300;

/** An array in fixed-size pieces, in order. */
function chunk(values, size) {
  const pieces = [];
  for (let start = 0; start < values.length; start += size) pieces.push(values.slice(start, start + size));
  return pieces;
}

function packMeta() {
  return {
    // The signer's `checkMeta` requires the key even though `buildManifest`
    // writes the format itself: metadata missing it is metadata the app would
    // only refuse AFTER the release key had been used on it.
    format: 1,
    id: PACK_ID,
    version: PACK_VERSION,
    kind: "dataset",
    title: { sr: "Otvorena umetnička galerija", en: "Open art gallery" },
    description: {
      sr: "Galerija remek-dela iz javnog domena: slike, crteži i grafike iz muzeja i sa Vikimedije, sa licencom zabeleženom za svako delo. Radi bez interneta.",
      en: "A gallery of public-domain masterworks: paintings, drawings and prints from museums and Wikimedia, with each work's licence recorded. Works with no network.",
    },
    licence: {
      spdx: "CC0-1.0 / PDM-1.0 / PD-Art",
      attribution:
        "The Metropolitan Museum of Art (CC0), Smithsonian Open Access (CC0), Rijksmuseum (PDM/CC0), Wikimedia Commons contributors with Wikidata (PD-Art). Images converted to WebP and scaled; no other change.",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    source: {
      name: "The Met, Smithsonian, Rijksmuseum, Wikimedia Commons",
      url: "https://metmuseum.org/",
    },
    minAppVersion: MIN_APP_VERSION,
  };
}

/** `--name value` and bare flags, refusing anything unexpected. */
export function parseArgs(argv) {
  const options = { max: TARGET_WORKS, quality: null, measureOnly: false, interval: 150, pool: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--measure-only") {
      options.measureOnly = true;
      continue;
    }
    const value = argv[index + 1];
    // `--pool` exists for the smoke run: a maintainer who wants to check that
    // every source still answers does not want to fetch 470 records to find out.
    if (flag === "--max" || flag === "--quality" || flag === "--interval" || flag === "--pool") {
      if (value === undefined) throw new Error(`art-pack: ${flag} needs a value.`);
      options[flag.slice(2)] = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    throw new Error(`art-pack: unknown argument "${String(flag)}".`);
  }
  return options;
}

/** A `limits`-shaped request record, from what the cache wrote for it. */
function requestRecord(meta) {
  return {
    url: meta.url,
    fetched: meta.fetchedAt,
    sha256: meta.sha256,
    bytes: meta.bytes,
  };
}

// --- Gathering -------------------------------------------------------------

/**
 * The Met: a search per department, then one request per object.
 *
 * The search is asked for objects the museum itself marks public domain AND
 * publishes an image for, and the object record is still checked by the
 * converter — the search index is a cache of the rights, and a cache that
 * disagrees with the record is the case where shipping the wrong thing is one
 * boolean away.
 */
async function gatherMet(http, want) {
  const works = [];
  const requests = [];
  let excluded = 0;
  for (const department of MET_DEPARTMENTS) {
    if (works.length >= want) break;
    const searchUrl = metSearchUrl(department.id, { medium: department.medium, limit: 100 });
    const { json: page, meta } = await http.json(searchUrl);
    requests.push(requestRecord(meta));
    const ids = Array.isArray(page.objectIDs) ? page.objectIDs : [];
    for (const objectId of ids) {
      if (works.length >= want) break;
      const url = metObjectUrl(objectId);
      const fetched = await http.json(url);
      requests.push(requestRecord(fetched.meta));
      const work = fromMetObject(fetched.json);
      if (work === null) {
        excluded += 1;
        continue;
      }
      works.push(work);
    }
  }
  return { works, requests, excluded };
}

/** The Smithsonian: one search per unit, and the converter applies the CC0 rule. */
async function gatherSmithsonian(http, want, apiKey) {
  const works = [];
  const requests = [];
  let excluded = 0;
  for (const search of SMITHSONIAN_SEARCHES) {
    if (works.length >= want) break;
    const url = smithsonianSearchUrl(search, apiKey, { rows: Math.min(100, want) });
    const { json: page, meta } = await http.json(url);
    requests.push(requestRecord(meta));
    const rows = page?.response?.rows;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (works.length >= want) break;
      const work = fromSmithsonianRow(row);
      if (work === null) {
        excluded += 1;
        continue;
      }
      works.push(work);
    }
  }
  return { works, requests, excluded };
}

/**
 * The Rijksmuseum: search by century, then resolve each id through the three
 * Linked Art records it names. The rights are read from the visual item before
 * the digital object is fetched, so a work that is not open costs two requests
 * rather than three.
 */
async function gatherRijksmuseum(http, want) {
  const works = [];
  const requests = [];
  let excluded = 0;
  const ids = [];
  for (const century of RIJKS_SEARCHES) {
    const url = rijksSearchUrl(century);
    const { json: page, meta } = await http.json(url);
    requests.push(requestRecord(meta));
    for (const item of page?.orderedItems ?? []) {
      if (typeof item?.id === "string") ids.push(item.id);
    }
  }
  const seen = new Set();
  for (const id of ids) {
    if (works.length >= want) break;
    if (seen.has(id)) continue;
    seen.add(id);
    const fetchedObject = await http.json(id, { accept: "application/json" });
    requests.push(requestRecord(fetchedObject.meta));
    const object = fetchedObject.json;
    const visualId = object?.shows?.[0]?.id;
    if (typeof visualId !== "string") {
      excluded += 1;
      continue;
    }
    const fetchedVisual = await http.json(visualId, { accept: "application/json" });
    requests.push(requestRecord(fetchedVisual.meta));
    const visual = fetchedVisual.json;
    const digitalId = visual?.digitally_shown_by?.[0]?.id;
    if (typeof digitalId !== "string") {
      excluded += 1;
      continue;
    }
    const fetchedDigital = await http.json(digitalId, { accept: "application/json" });
    requests.push(requestRecord(fetchedDigital.meta));
    const digital = fetchedDigital.json;
    const work = fromRijksmuseum(object, visual, digital);
    if (work === null) {
      excluded += 1;
      continue;
    }
    works.push(work);
  }
  return { works, requests, excluded };
}

/** The `File:…` title behind a Wikidata `P18` value, normalised for lookups. */
function normaliseFileTitle(title) {
  const text = String(title).replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Wikimedia Commons, with Wikidata's metadata.
 *
 * One SPARQL query resolves the painters of Serbia and Yugoslavia, and then a
 * sequence of them name the paintings: the regional chunks first, so the arm's
 * own region is in the pool before the great-painters chunks fill it, then as
 * many chunks as it takes to reach `COMMONS_CANDIDATE_BUDGET`. One batched
 * `imageinfo` call per 25 files then reads each file's own licence tag, its size
 * and a rendition at the pack's working width. A painting whose file has no
 * `imageinfo` answer is a painting whose licence cannot be evidenced, so it is
 * dropped rather than fetched and hoped over.
 */
async function gatherCommons(http, want) {
  const works = [];
  const requests = [];
  let excluded = 0;
  const rowsByQid = new Map();
  const titleByQid = new Map();
  // The regional painters first, by name: see `REGIONAL_PAINTERS_QUERY` for why
  // the citizenship is resolved on the ARTIST and the paintings are then asked
  // for through a `VALUES` list.
  const artistUrl = wikidataSearchUrl(REGIONAL_PAINTERS_QUERY.query);
  const artistPage = await http.json(artistUrl, { accept: "application/sparql-results+json" });
  requests.push(requestRecord(artistPage.meta));
  const regionalArtists = [
    ...new Set(
      (artistPage.json?.results?.bindings ?? [])
        .map((row) => String(row?.artist?.value ?? "").split("/").pop())
        .filter((qid) => /^Q\d+$/.test(qid)),
    ),
  ];
  // The regional painters' works come first in the pool, and the quota fill
  // draws from the front, so the gallery's own region is never the part that
  // gets dropped when the pack is full.
  //
  // Chunked, for the two reasons in `PAINTER_CHUNK`: a bounded response, and a
  // failure that costs fifteen painters rather than the whole arm.
  const queries = [
    ...chunk(regionalArtists, PAINTER_CHUNK).map((artists, index) => ({
      id: `${REGIONAL_PAINTERS_QUERY.id}-${String(index + 1)}`,
      query: commonsPaintingsQuery(artists),
    })),
    ...chunk(GREAT_PAINTERS, PAINTER_CHUNK).map((artists, index) => ({
      id: `great-painters-${String(index + 1)}`,
      query: commonsPaintingsQuery(artists),
    })),
  ];
  for (const [queryIndex, query] of queries.entries()) {
    const url = wikidataSearchUrl(query.query);
    const { json: page, meta } = await http.json(url, { accept: "application/sparql-results+json" });
    requests.push(requestRecord(meta));
    for (const row of page?.results?.bindings ?? []) {
      const qid = String(row?.painting?.value ?? "").split("/").pop();
      if (!/^Q\d+$/.test(qid)) continue;
      const fileUrl = String(row?.img?.value ?? "");
      const title = commonsFileTitle(fileUrl);
      if (title === null) continue;
      // One row per painting: an OPTIONAL that matched twice (two materials,
      // two collections) produces two rows, and the first is kept so the pack
      // does not hold the same painting twice.
      if (!rowsByQid.has(qid)) {
        // The chunk's own index travels with the row: WDQS returns its rows in
        // no order this build may rely on, and a pack that reshuffled itself
        // between two identical runs would be a pack whose "which 300 works"
        // nobody could state.
        rowsByQid.set(qid, { row, queryIndex });
        titleByQid.set(qid, normaliseFileTitle(title));
      }
    }
    // Enough paintings for the pool, and no reason to keep asking. The regional
    // chunks come first, so the arm's own region is always in the pool before
    // the great-painters chunks fill it up.
    if (rowsByQid.size >= COMMONS_CANDIDATE_BUDGET) break;
  }
  const infoByTitle = new Map();
  // Only the candidates that can actually ship are asked about: `want` is above
  // the Commons quota, so the arm has more than enough to cover both the quota
  // and its share of the fill, and a licence lookup for the paintings beyond
  // that is a request spent on nothing.
  const candidates = [...rowsByQid.entries()]
    .sort(([leftId, left], [rightId, right]) =>
      left.queryIndex !== right.queryIndex
        ? left.queryIndex - right.queryIndex
        : leftId < rightId
          ? -1
          : leftId > rightId
            ? 1
            : 0,
    )
    .slice(0, want);
  const titles = candidates.map(([qid]) => titleByQid.get(qid));
  for (let start = 0; start < titles.length; start += COMMONS_BATCH) {
    const batch = titles.slice(start, start + COMMONS_BATCH);
    const url = commonsImageInfoUrl(batch);
    const { json: page, meta } = await http.json(url);
    requests.push(requestRecord(meta));
    for (const entry of page?.query?.pages ?? []) {
      const info = entry?.imageinfo?.[0];
      if (info === undefined) continue;
      infoByTitle.set(normaliseFileTitle(entry.title), info);
    }
  }
  for (const [qid, { row }] of candidates) {
    if (works.length >= want) break;
    const info = infoByTitle.get(titleByQid.get(qid));
    if (info === undefined) {
      excluded += 1;
      continue;
    }
    const work = fromCommonsPainting(row, info);
    if (work === null) {
      excluded += 1;
      continue;
    }
    works.push(work);
  }
  return { works, requests, excluded };
}

// --- Images ----------------------------------------------------------------

/**
 * One work's image, encoded and written, plus its thumbnail.
 *
 * The pair is written under the work's id, which is what makes a stray file
 * identifiable and what `art.json` points at. A failure that is not the source
 * being down is this work's problem alone and is reported so the caller can take
 * the next candidate.
 */
async function shootWork(http, work, imagesDir, quality) {
  const { bytes } = await http.get(work.imageUrl, { accept: "image/*" });
  const encoded = await prepareImage(bytes, quality);
  writeFileSync(join(imagesDir, `${work.id}.webp`), encoded.main);
  writeFileSync(join(imagesDir, `${work.id}-thumb.webp`), encoded.thumb);
  return {
    work: { ...work, image: `images/${work.id}.webp`, thumb: `images/${work.id}-thumb.webp` },
    width: encoded.width,
    height: encoded.height,
    mainBytes: encoded.main.byteLength,
    thumbBytes: encoded.thumb.byteLength,
  };
}

// --- The run ---------------------------------------------------------------

/**
 * The whole build. Returns the numbers the CLI prints, so the same function is
 * what a test could call if a test ever wanted the real thing (it does not: the
 * tests drive the converters and the evidence, and the build is run once by
 * hand).
 */
async function run(options) {
  const started = Date.now();
  const cacheDir = join(tmpdir(), "nexus-pack-cache", PACK_ID);
  const outRoot = join(tmpdir(), "nexus-packs");
  const packDir = join(outRoot, PACK_ID);
  const imagesDir = join(packDir, "images");
  const http = new CachedHttp({ cacheDir, minIntervalMs: options.interval });

  // The evidence first: a source whose licence sentence cannot be shown is a
  // source this build does not use, and finding that out after 300 downloads
  // would be finding it out too late.
  const evidence = new Map();
  const sourceRecords = [];
  for (const page of EVIDENCE_PAGES) {
    const { bytes, meta } = await http.get(page.url, { accept: "text/html" });
    const text = htmlToText(bytes.toString("utf8"));
    if (!quotePresent(text, page.quote)) {
      throw new Error(`art-pack: the licence sentence is not on ${page.url}`);
    }
    evidence.set(page.id, { url: page.url, quote: page.quote, fixture: page.fixture, ...requestRecord(meta) });
  }

  const pools = {};
  const reports = new Map();
  const apiKey = process.env["SMITHSONIAN_API_KEY"] ?? SMITHSONIAN_DEMO_KEY;
  const poolTargets =
    options.pool === null
      ? POOL_TARGETS
      : Object.fromEntries(SOURCE_ORDER.map((sourceId) => [sourceId, options.pool]));
  const gatherers = {
    met: () => gatherMet(http, poolTargets.met),
    smithsonian: () => gatherSmithsonian(http, poolTargets.smithsonian, apiKey),
    rijksmuseum: () => gatherRijksmuseum(http, poolTargets.rijksmuseum),
    commons: () => gatherCommons(http, poolTargets.commons),
  };
  for (const sourceId of SOURCE_ORDER) {
    try {
      const gathered = await gatherers[sourceId]();
      pools[sourceId] = gathered.works;
      reports.set(sourceId, { works: gathered.works.length, excluded: gathered.excluded, requests: gathered.requests, skipped: null });
    } catch (error) {
      // A source that will not answer is skipped and said so; anything else is a
      // bug in this build and stops it.
      if (!(error instanceof SourceUnavailableError) && !(error instanceof SourceFailedError)) throw error;
      pools[sourceId] = [];
      reports.set(sourceId, { works: 0, excluded: 0, requests: [], skipped: String(error.reason ?? error.message) });
    }
  }

  const attemptOrder = selectWorks(pools, QUOTAS, Number.POSITIVE_INFINITY);
  if (options.measureOnly) {
    const samples = [];
    for (const work of attemptOrder.slice(0, QUALITY_SAMPLES)) samples.push((await http.get(work.imageUrl)).bytes);
    const measured = await measureQuality(samples);
    console.log(`art-pack: quality ${String(measured.quality)} dB>=40, samples ${String(samples.length)}`);
    for (const row of measured.table) {
      console.log(`  q${String(row.quality)}  mean ${String(row.meanBytes)} B  psnr ${row.meanPsnrDb.toFixed(2)} dB`);
    }
    return { measured, works: [], bytes: 0, elapsedMs: Date.now() - started, reports, evidence };
  }

  let quality = options.quality;
  let measured = null;
  if (quality === null) {
    const samples = [];
    for (const work of attemptOrder.slice(0, QUALITY_SAMPLES)) samples.push((await http.get(work.imageUrl)).bytes);
    measured = await measureQuality(samples);
    quality = measured.quality;
  }

  rmSync(imagesDir, { recursive: true, force: true });
  mkdirSync(imagesDir, { recursive: true });

  const shots = [];
  const deadSources = new Set();
  const failures = [];
  for (const work of attemptOrder) {
    if (shots.length >= options.max) break;
    if (deadSources.has(work.source)) continue;
    try {
      shots.push(await shootWork(http, work, imagesDir, quality));
    } catch (error) {
      if (error instanceof SourceUnavailableError) {
        deadSources.add(work.source);
        const report = reports.get(work.source);
        report.skipped = `${error.reason} (at ${work.id})`;
        report.works = 0;
        continue;
      }
      failures.push({ id: work.id, reason: error.message });
    }
  }

  const artJson = buildArtJson(shots);
  const artJsonText = `${JSON.stringify(artJson, null, 2)}\n`;
  writeFileSync(join(packDir, "art.json"), artJsonText);
  const metaPath = join(outRoot, `${PACK_ID}.meta.json`);
  writeFileSync(metaPath, `${JSON.stringify(packMeta(), null, 2)}\n`);

  const bySource = new Map();
  for (const shot of shots) {
    const list = bySource.get(shot.work.source) ?? [];
    list.push(shot.work);
    bySource.set(shot.work.source, list);
  }
  for (const sourceId of SOURCE_ORDER) {
    const report = reports.get(sourceId);
    const works = bySource.get(sourceId) ?? [];
    sourceRecords.push({
      id: sourceId,
      name: SOURCES.find((source) => source.id === sourceId)?.name ?? sourceId,
      works: works.length,
      excluded: report.excluded,
      licenceCounts: licenceCounts(works),
      requests: report.requests,
      ...(report.skipped === null ? {} : { skipped: report.skipped }),
    });
  }
  sourceRecords.push({
    id: "wikidata",
    name: "Wikidata",
    works: 0,
    excluded: 0,
    licenceCounts: {},
    requests: [],
  });
  for (const record of sourceRecords) {
    const found = evidence.get(record.id);
    if (found !== undefined) record.licenceEvidence = found;
  }
  const sourcesJson = {
    pack: PACK_ID,
    kind: "dataset",
    generated: new Date().toISOString(),
    target: options.max,
    quality,
    ...(measured === null ? {} : { qualityMeasurement: measured.table.map((row) => ({ quality: row.quality, meanBytes: row.meanBytes, meanPsnrDb: Number(row.meanPsnrDb.toFixed(2)) })) }),
    sources: sourceRecords,
    failures,
  };
  writeFileSync(join(HERE, "sources.json"), `${JSON.stringify(sourcesJson, null, 2)}\n`);

  const imageBytes = shots.reduce((sum, shot) => sum + shot.mainBytes + shot.thumbBytes, 0);
  const mainBytes = shots.reduce((sum, shot) => sum + shot.mainBytes, 0);
  const thumbBytes = shots.reduce((sum, shot) => sum + shot.thumbBytes, 0);
  return {
    works: shots,
    artJsonBytes: Buffer.byteLength(artJsonText, "utf8"),
    bytes: imageBytes,
    mainBytes,
    thumbBytes,
    quality,
    measured,
    elapsedMs: Date.now() - started,
    reports,
    evidence,
    metaPath,
    packDir,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await run(options);
  console.log(`art-pack: ${String(result.works.length)} works`);
  for (const sourceId of SOURCE_ORDER) {
    const report = result.reports.get(sourceId);
    const skipped = report.skipped === null ? "" : `  SKIPPED: ${report.skipped}`;
    console.log(`  ${sourceId.padEnd(12)} ${String(report.works).padStart(4)} candidates, ${String(report.excluded).padStart(4)} excluded, ${String(report.requests.length).padStart(4)} requests${skipped}`);
  }
  if (result.measured !== null) {
    console.log(`  quality ${String(result.quality)} (mean PSNR by candidate, dB):`);
    for (const row of result.measured.table) {
      console.log(`    q${String(row.quality)}  mean ${String(row.meanBytes)} B  ${row.meanPsnrDb.toFixed(2)}`);
    }
  }
  const total = (result.artJsonBytes ?? 0) + (result.bytes ?? 0);
  console.log(
    `art-pack: art.json ${String(result.artJsonBytes ?? 0)} B, images ${String(result.mainBytes ?? 0)} B + thumbs ${String(result.thumbBytes ?? 0)} B, pack ${String(total)} B (${(total / 1024 / 1024).toFixed(1)} MiB)`,
  );
  console.log(`art-pack: ${String(result.elapsedMs / 1000)} s`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
