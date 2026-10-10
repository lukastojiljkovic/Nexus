// No shebang, for the reason every other script in this repository has none.
//
// The dictionary pack's builder: fetch the two sources into a cache, filter the
// extract while it streams, and write a searchable pack folder plus the
// metadata file `scripts/pack-sign.mjs` takes.
//
//   node scripts/packs/dictionary/build.mjs [--source-dir d] [--out-dir d]
//                                           [--update-sources] [--fixtures d]
//
// WHAT IT WRITES, AND WHAT IT DOES NOT.
//
//   `%TEMP%\nexus-pack-cache\dictionary-sr-en\`     the sources, reused on a rebuild
//   `%TEMP%\nexus-packs\dictionary-sr-en\`          the pack CONTENT (no pack.json)
//   `%TEMP%\nexus-packs\dictionary-sr-en.meta.json` the metadata pack-sign takes
//
// No signature is written and no key is read: the maintainer signs packs with
// the release key at the end, and this tool deliberately has no access to one.
//
// WHY ONE DOWNLOAD AND NOT TWO. `raw-wiktextract-data.jsonl.gz` is the raw
// Wiktextract extract of the English Wiktionary edition — every language's
// entries as they appear there — so it holds BOTH sides of this dictionary: the
// English records, with their Serbo-Croatian translation lists, and the
// Serbo-Croatian records, whose English definitions are the other direction. It
// is also the route kaikki.org's own page recommends; the per-language
// postprocessed files the research sampled are marked DEPRECATED there.
//
// WHY IT STREAMS. The archive is 2.98 GB compressed and about 25.6 GB
// decompressed. Nothing here ever holds either whole: the download is written
// straight to disk, the gunzip is piped, and one line at a time is inspected —
// a cheap substring test first, and `JSON.parse` only for a line that could be a
// record this pack carries.

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import {
  ATTRIBUTION,
  PACK_ID,
  aboutFile,
  buildIndex,
  englishEntry,
  indexFiles,
  parsePhrasebook,
  serbianEntry,
} from "./convert.mjs";

/** Where a source is cached, and where the pack is written. Both under `%TEMP%`, the one place a build may fill. */
const CACHE_ROOT = join(process.env.TEMP ?? ".", "nexus-pack-cache");
const PACKS_ROOT = join(process.env.TEMP ?? ".", "nexus-packs");

/** The app version the pack needs. A pack that asked for a newer one would be refused by a build that cannot read it. */
const MIN_APP_VERSION = "1.6.0";

/** How often the download and the filter print a line. A 3 GB download that printed per chunk would print a book. */
const PROGRESS_BYTES = 200 * 1024 * 1024;

/** How many raw records a `--fixtures` run keeps for the test suite — enough for the filter's rules, small enough to commit. */
const FIXTURE_COUNT = 4;

const SOURCES_FILE = new URL("./sources.json", import.meta.url);

/** The two things this build fetches, and what each is for. */
const EXTRACT_URL = "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz";
const PHRASEBOOK_URL = "https://en.wikivoyage.org/w/index.php?title=Serbian_phrasebook&action=raw";

function log(message) {
  console.log(message);
}

/** A human-readable size, because a byte count in the millions is a number nobody reads. */
export function megabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The recorded sources, or an empty list when the file is missing.
 *
 * `sources.json` is the build's own record of what it fetched — URL, date,
 * SHA-256, licence and the sentence that states the licence — and it is
 * committed beside the builder so a rebuild can check that the bytes are the
 * bytes this pack was built from.
 */
export function readSources() {
  try {
    const parsed = JSON.parse(readFileSync(SOURCES_FILE, "utf8"));
    return Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch {
    return [];
  }
}

/** The recorded entry for one URL, or `undefined`. */
export function recordedSource(sources, url) {
  return sources.find((entry) => entry.url === url);
}

/**
 * Rewrites `sources.json` with what this run actually measured: the byte counts
 * and the SHA-256 of each cached file, and the date they were read.
 *
 * It keeps every other field — the licence, the evidence URL and the quoted
 * sentence — untouched, because those are hand-written statements about the
 * source and this function knows nothing about them.
 */
export function updateSources(sources, measured, fetchedAt) {
  const next = sources.map((entry) => {
    const hash = measured.find((each) => each.url === entry.url);
    return hash === undefined ? entry : { ...entry, bytes: hash.bytes, sha256: hash.sha256, fetchedAt };
  });
  writeFileSync(SOURCES_FILE, `${JSON.stringify({ sources: next }, null, 2)}\n`, "utf8");
  return next;
}

/** The SHA-256 of a file, streamed: a 3 GB read that never holds more than one chunk. */
export async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((done, fail) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", fail);
    stream.on("end", done);
  });
  return hash.digest("hex");
}

/**
 * Fetches one URL into the cache, resuming a partial file when the server will
 * let it.
 *
 * Resume is not a nicety at this size: an interrupted 3 GB download that began
 * again from zero would make a rebuild a lottery on a slow line. The partial
 * file is `<name>.part` and the finished one is renamed, so a cache entry that
 * exists is a cache entry that is whole.
 */
export async function fetchToCache(url, path, expectedBytes) {
  if (existsSync(path) && statSync(path).size === expectedBytes) {
    log(`cache hit  ${path} (${megabytes(expectedBytes)})`);
    return;
  }
  const partial = `${path}.part`;
  let from = existsSync(partial) ? statSync(partial).size : 0;
  if (from > expectedBytes) from = 0;
  const headers = from > 0 ? { Range: `bytes=${String(from)}-` } : {};
  log(`fetching   ${url}${from > 0 ? ` (resuming at ${megabytes(from)})` : ""}`);
  const response = await fetch(url, { headers });
  if (!response.ok && response.status !== 206) {
    throw new Error(`The source answered ${String(response.status)} for ${url}.`);
  }
  if (response.status === 206 && from > 0) {
    const contentRange = response.headers.get("content-range");
    if (contentRange === null || !contentRange.startsWith(`bytes ${String(from)}-`)) {
      throw new Error(`The source resumed at the wrong place for ${url} (${String(contentRange)}).`);
    }
  } else {
    from = 0;
  }
  const body = response.body;
  if (body === null) throw new Error(`The source answered with no body for ${url}.`);
  mkdirSync(dirname(path), { recursive: true });
  const out = createWriteStream(partial, { flags: from > 0 ? "a" : "w" });
  let written = from;
  let printed = Math.floor(written / PROGRESS_BYTES);
  try {
    for await (const chunk of body) {
      if (!out.write(chunk)) await new Promise((drain) => out.once("drain", drain));
      written += chunk.length;
      const step = Math.floor(written / PROGRESS_BYTES);
      if (step > printed) {
        printed = step;
        log(`  ${megabytes(written)} of ${megabytes(expectedBytes)}`);
      }
    }
  } finally {
    await new Promise((done) => out.end(done));
  }
  if (written !== expectedBytes) {
    throw new Error(
      `The source is ${String(written)} bytes and the record says ${String(expectedBytes)}; leaving ${partial} for a resume.`,
    );
  }
  rmSync(path, { force: true });
  renameSync(partial, path);
  log(`fetched    ${path} (${megabytes(written)})`);
}

/** One line of the extract, or `null` when it is not a record this pack carries. */
export function convertLine(line) {
  // The cheap test first: a record names its own language with `lang_code`, and
  // parsing 25 GB of JSON to throw nearly all of it away would cost the build an
  // hour for nothing.
  if (!line.includes('"lang_code": "en"') && !line.includes('"lang_code": "sh"')) return null;
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  const english = englishEntry(record);
  if (english !== null) return { side: "en", entry: english };
  const serbian = serbianEntry(record);
  if (serbian !== null) return { side: "sr", entry: serbian };
  return null;
}

/**
 * One extract line reduced to the fields the converter reads.
 *
 * A fixture is a real record with the parts this pack never looks at trimmed
 * away — the same `word`, `pos`, `lang_code`, `senses[].glosses` and
 * `translations` of the original, and nothing else. The original line is 3-8 KB
 * because a Wiktextract record carries etymology, sounds, categories, links and
 * every other language's translation; a committed fixture has to be a few KB.
 */
export function trimRecordLine(line) {
  const record = JSON.parse(line);
  const senses = (Array.isArray(record.senses) ? record.senses : []).map((sense) => ({
    glosses: Array.isArray(sense?.glosses) ? sense.glosses : [],
  }));
  // Every Serbo-Croatian item (they are what the English side is built from)
  // and the first two of any other language — the latter only so a test can
  // prove that a translation into German is NOT taken for a Serbian one. The
  // real record's translation list holds two hundred languages' worth of words,
  // which is fifteen kilobytes per fixture line and nothing a test reads.
  const items = Array.isArray(record.translations) ? record.translations : [];
  const serbian = items.filter((item) => item?.lang_code === "sh");
  const others = items.filter((item) => item?.lang_code !== "sh").slice(0, 2);
  const translations = [...others, ...serbian].map((item) => ({
    lang_code: item?.lang_code,
    word: item?.word,
  }));
  const trimmed = {
    word: record.word,
    lang_code: record.lang_code,
    pos: record.pos,
    senses,
    translations,
  };
  if (typeof record.source_url === "string") trimmed.source_url = record.source_url;
  return JSON.stringify(trimmed);
}

/**
 * Streams the extract and answers the two record sets, plus the counts a report
 * needs.
 *
 * `onProgress` is called every so many megabytes with what has been read, and
 * `samples` collects the first few raw lines of each side for the test suite,
 * because a fixture that is cut from the real source has to come from a real
 * build.
 */
export async function filterExtract(path, { onProgress, samples } = {}) {
  const decoder = new TextDecoder("utf-8");
  const english = [];
  const serbian = [];
  const counts = { lines: 0, parsed: 0, en: 0, sr: 0 };
  let tail = "";
  let bytes = 0;
  let printed = 0;
  const gunzip = createGunzip();
  createReadStream(path).pipe(gunzip);

  const keep = (line) => {
    const converted = convertLine(line);
    if (converted === null) return;
    counts.parsed += 1;
    const bucket = converted.side === "en" ? samples?.en : samples?.sr;
    if (bucket !== undefined && bucket.length < FIXTURE_COUNT) bucket.push(trimRecordLine(line));
    if (converted.side === "en") english.push(converted.entry);
    else serbian.push(converted.entry);
  };

  for await (const chunk of gunzip) {
    bytes += chunk.length;
    if (onProgress !== undefined && bytes - printed >= PROGRESS_BYTES) {
      printed = bytes;
      onProgress(bytes, counts);
    }
    tail += decoder.decode(chunk, { stream: true });
    let newline = tail.indexOf("\n");
    while (newline !== -1) {
      const line = tail.slice(0, newline);
      tail = tail.slice(newline + 1);
      counts.lines += 1;
      if (line.length > 0) keep(line);
      newline = tail.indexOf("\n");
    }
  }
  tail += decoder.decode();
  if (tail.trim() !== "") {
    counts.lines += 1;
    keep(tail);
  }
  counts.en = english.length;
  counts.sr = serbian.length;
  return { english, serbian, counts, bytes };
}

/** Writes `path`, creating its folder, and answers its size. */
function writeFile(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return statSync(path).size;
}

/**
 * The pack folder: the two indexes, the phrasebook, the notice and `about.json`.
 *
 * `about.json` is written last and its `bytes` field is the content that
 * preceded it — the pack's own statement about its size, which the module's
 * status line reads.
 */
export function writePack(dir, { english, serbian, phrases, builtAt, sourceHashes }) {
  const en = buildIndex(english);
  const sr = buildIndex(serbian);
  const sizes = {};
  let total = 0;
  for (const [side, index] of [
    ["en", en],
    ["sr", sr],
  ]) {
    for (const [name, contents] of Object.entries(indexFiles(index))) {
      const size = writeFile(join(dir, "index", side, name), contents);
      sizes[`index/${side}/${name}`] = size;
      total += size;
    }
  }
  const phrasesBytes = Buffer.from(
    `${JSON.stringify({ format: 1, source: PHRASEBOOK_URL, topics: phrases }, null, 1)}\n`,
    "utf8",
  );
  sizes["phrases.json"] = writeFile(join(dir, "phrases.json"), phrasesBytes);
  total += sizes["phrases.json"];
  sizes["NOTICE.txt"] = writeFile(join(dir, "NOTICE.txt"), Buffer.from(`${ATTRIBUTION}\n`, "utf8"));
  total += sizes["NOTICE.txt"];

  const counts = {
    enKeys: en.keys.length,
    enEntries: en.entries.length,
    enDropped: en.dropped,
    srKeys: sr.keys.length,
    srEntries: sr.entries.length,
    srDropped: sr.dropped,
    phrases: phrases.reduce((sum, topic) => sum + topic.phrases.length, 0),
    topics: phrases.length,
  };
  // `about.json` states the pack's own size, and that includes `about.json` —
  // so the number is written once to learn how long it makes the file, and
  // again with the answer. It converges in one step unless the total is about to
  // cross a digit boundary, and the loop says so rather than assuming it.
  let bytes = total;
  let about = "";
  for (let pass = 0; pass < 5; pass += 1) {
    about = `${JSON.stringify(aboutFile({ counts, sources: sourceHashes, builtAt, bytes }), null, 1)}\n`;
    const size = Buffer.byteLength(about, "utf8");
    if (total + size === bytes) break;
    bytes = total + size;
  }
  sizes["about.json"] = writeFile(join(dir, "about.json"), Buffer.from(about, "utf8"));
  total += sizes["about.json"];
  return { sizes, total, counts };
}

/** The metadata `pack-sign.mjs` takes: everything about the pack except the file list that tool computes. */
export function metaFor(builtAt, version) {
  return {
    format: 1,
    id: PACK_ID,
    version,
    kind: "dataset",
    title: {
      sr: "Rečnik srpskog i engleskog",
      en: "Serbian and English dictionary",
    },
    description: {
      sr: "Reči i fraze na srpskom i engleskom, iz Vikirečnika i Vikiputa.",
      en: "Words and phrases between Serbian and English, from Wiktionary and Wikivoyage.",
    },
    licence: {
      spdx: "CC-BY-SA-4.0",
      attribution: ATTRIBUTION,
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    source: {
      name: "Wiktionary (via Wiktextract) and Wikivoyage",
      url: "https://kaikki.org/dictionary/rawdata.html",
    },
    minAppVersion: MIN_APP_VERSION,
  };
}

/** `2026.10.0` from a date: a source's vintage is a month, and a content change is a deliberate edit here. */
export function versionFor(date) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}.${month}.0`;
}

/**
 * `--name value` pairs and bare `--name` switches, so a rebuild can point the
 * cache and the output somewhere else and can say out loud that it is
 * re-recording a source's hash.
 */
export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === undefined || !flag.startsWith("--")) {
      throw new Error(
        "usage: node scripts/packs/dictionary/build.mjs [--source-dir d] [--out-dir d] [--update-sources] [--fixtures d]",
      );
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values[flag.slice(2)] = next;
      index += 1;
    } else {
      values[flag.slice(2)] = true;
    }
  }
  return values;
}

async function main(argv) {
  const args = parseArgs(argv);
  const started = Date.now();
  const cacheDir = resolve(args["source-dir"] ?? join(CACHE_ROOT, PACK_ID));
  const outDir = resolve(args["out-dir"] ?? join(PACKS_ROOT, PACK_ID));
  const sources = readSources();
  if (sources.length === 0) throw new Error("sources.json could not be read; it is this build's record of its inputs.");
  const extractPath = join(cacheDir, "raw-wiktextract-data.jsonl.gz");
  const phrasebookPath = join(cacheDir, "wikivoyage-serbian-phrasebook.wiki");
  const extractRecord = recordedSource(sources, EXTRACT_URL);
  const phrasebookRecord = recordedSource(sources, PHRASEBOOK_URL);
  if (extractRecord === undefined || phrasebookRecord === undefined) {
    throw new Error("sources.json does not record both of this build's sources.");
  }

  await fetchToCache(EXTRACT_URL, extractPath, extractRecord.bytes);
  await fetchToCache(PHRASEBOOK_URL, phrasebookPath, phrasebookRecord.bytes);

  const hashes = [
    { url: EXTRACT_URL, sha256: await sha256File(extractPath), bytes: statSync(extractPath).size },
    { url: PHRASEBOOK_URL, sha256: await sha256File(phrasebookPath), bytes: statSync(phrasebookPath).size },
  ];
  const updating = Object.hasOwn(args, "update-sources");
  if (updating) {
    updateSources(sources, hashes, new Date().toISOString());
    log("sources    sources.json updated with the measured bytes and SHA-256");
  } else {
    for (const hash of hashes) {
      const recorded = recordedSource(sources, hash.url);
      if (recorded.sha256 !== hash.sha256) {
        throw new Error(
          `The bytes of ${hash.url} are not the ones sources.json records (${hash.sha256} vs ${String(recorded.sha256)}). ` +
            "A source that changed under a pack is a new pack: rerun with --update-sources and review the new record.",
        );
      }
    }
  }

  log("filtering  the extract (about 25.6 GB decompressed; nothing is held whole)");
  const samples = { en: [], sr: [] };
  const filtered = await filterExtract(extractPath, {
    samples,
    onProgress: (bytes, counts) => {
      log(`  ${megabytes(bytes)} read, ${String(counts.lines)} lines, ${String(counts.parsed)} records kept`);
    },
  });
  log(
    `filtered   ${String(filtered.counts.lines)} lines, ${String(filtered.counts.parsed)} records kept ` +
      `(${String(filtered.counts.en)} en, ${String(filtered.counts.sr)} sr), ${megabytes(filtered.bytes)} decompressed`,
  );

  const phrases = parsePhrasebook(readFileSync(phrasebookPath, "utf8"));
  log(`phrasebook ${String(phrases.length)} topics`);

  const builtAt = new Date().toISOString();
  const version = versionFor(new Date());
  rmSync(outDir, { recursive: true, force: true });
  const written = writePack(outDir, {
    english: filtered.english,
    serbian: filtered.serbian,
    phrases,
    builtAt,
    sourceHashes: hashes,
  });
  const metaPath = join(PACKS_ROOT, `${PACK_ID}.meta.json`);
  writeFileSync(metaPath, `${JSON.stringify(metaFor(builtAt, version), null, 2)}\n`, "utf8");

  const fixtureDir = args.fixtures;
  if (fixtureDir !== undefined) {
    const dir = resolve(fixtureDir);
    writeFile(join(dir, "en.jsonl"), Buffer.from(`${samples.en.join("\n")}\n`, "utf8"));
    writeFile(join(dir, "sh.jsonl"), Buffer.from(`${samples.sr.join("\n")}\n`, "utf8"));
    writeFile(join(dir, "phrasebook.wiki"), readFileSync(phrasebookPath));
    log(`fixtures   ${dir} (${String(samples.en.length)} en, ${String(samples.sr.length)} sh, one phrasebook)`);
  }

  log("");
  log(`pack       ${outDir}`);
  for (const [name, size] of Object.entries(written.sizes)) log(`  ${name.padEnd(28)} ${megabytes(size)}`);
  log(`  ${"total".padEnd(28)} ${megabytes(written.total)}`);
  log(`meta       ${metaPath} (version ${version})`);
  log(
    `counts     ${String(written.counts.enKeys)} en keys / ${String(written.counts.enEntries)} entries (dropped ${String(written.counts.enDropped)}), ` +
      `${String(written.counts.srKeys)} sr keys / ${String(written.counts.srEntries)} entries (dropped ${String(written.counts.srDropped)}), ` +
      `${String(written.counts.phrases)} phrases in ${String(written.counts.topics)} topics`,
  );
  log(`took       ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`build: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
