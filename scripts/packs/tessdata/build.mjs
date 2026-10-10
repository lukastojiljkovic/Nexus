// tessdata_fast as a Nexus content pack: the builder that produces the pack
// folder and the metadata `scripts/pack-sign.mjs` signs. It never signs
// anything and never needs the release key.
//
//   node scripts/packs/tessdata/build.mjs
//   node scripts/pack-sign.mjs --dir <out>/tessdata-fast \
//     --meta <out>/tessdata-fast.meta.json --key <release-key.pem>
//
// WHAT IS IN THE PACK, AND WHY ONE PACK FOR THREE LANGUAGES. The three models
// are `eng`, `srp` (Serbian Cyrillic) and `srp_latn` (Serbian Latin) from
// tesseract-ocr/tessdata_fast, Apache-2.0 (`sources.json` carries the licence,
// its URL, and the sentence on the page that states it). They travel together
// because they are used together: a Serbian receipt carries Latin script with
// English words on it, and a Cyrillic label can carry a Latin barcode number -
// so the scanner's own default is `srp_latn+eng` with `srp` one checkbox away.
// One pack also means one `langPath` and one install, where per-language packs
// would be three downloads for the languages a Serbian user's first scan needs
// at once. A fifth of a gigabyte of every OTHER language stays out.
//
// WHAT THE CONVERSION IS. Gzip, and nothing else: tesseract.js reads
// `<langPath>/<lang>.traineddata.gz` (gzip is its default) and decompresses in
// the worker. The models themselves are not edited - no pruning, no
// re-quantisation - because a model this repository modified would be a model
// nobody could check against upstream's own bytes, and the point of shipping
// upstream's Apache-2.0 data is that it is upstream's.
//
// THE LICENCE FILE TRAVELS WITH IT. Apache-2.0 requires the licence to
// accompany the work, so the repository's own LICENSE is copied into the pack
// verbatim as `LICENSE-Apache-2.0.txt`, and the pack's manifest names the
// attribution and its URL.
//
// CACHE AND OUTPUT. Sources are downloaded once into
// `%TEMP%\nexus-pack-cache\tessdata-fast\` and reused; the pack folder and its
// metadata are written under `%TEMP%\nexus-packs\`. A cached file whose
// SHA-256 no longer matches `sources.json` is re-downloaded rather than
// trusted - a cache that lies is worse than no cache.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

/** The pack's id, which is also the name of the folder inside the pack's version directory (ADR-091). */
export const PACK_ID = "tessdata-fast";

/** The folder the models live in inside the pack - the last segment of the `nx-pack://` URL the app reads. */
export const TESSDATA_DIR = "tessdata";

/** The licence copy's name inside the pack. Apache-2.0 requires it to travel with the work. */
export const LICENCE_FILE = "LICENSE-Apache-2.0.txt";

/** The language models this pack carries, in the order they are reported. */
export const LANGUAGES = ["eng", "srp", "srp_latn"];

/** Where `sources.json` and the fixtures live. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The name tesseract.js looks for, which is the only thing the conversion changes about a model. */
export function trainedDataName(language, gzip = true) {
  return `${language}.traineddata${gzip ? ".gz" : ""}`;
}

/**
 * One file compressed for the pack: gzip, level 9, and nothing else.
 *
 * Deterministic on one machine: Node's zlib writes no modification time and no
 * file name into the header, so two runs over the same source produce the same
 * bytes - which is what lets the manifest's hashes survive a rebuild.
 */
export function gzipBytes(bytes) {
  return gzipSync(bytes, { level: 9 });
}

/** The download cache: one directory per pack id, under the system temp directory. */
export function cacheDirFor(id = PACK_ID) {
  return join(tmpdir(), "nexus-pack-cache", id);
}

/** The folder the pack is assembled in (and the folder `pack-sign.mjs` is pointed at). */
export function outputDirFor(id = PACK_ID) {
  return join(tmpdir(), "nexus-packs", id);
}

/** The metadata file `pack-sign.mjs --meta` takes. It lives BESIDE the pack folder, never inside it. */
export function metadataPathFor(id = PACK_ID) {
  return join(tmpdir(), "nexus-packs", `${id}.meta.json`);
}

/**
 * `sources.json`, read and checked for the shape this builder needs.
 *
 * Checked here rather than trusted because the file is the pack's provenance:
 * a source without a URL, a licence or a digest is a source nobody can verify,
 * and the pack rules are that a source without evidence is not used.
 */
export function readSources(dir = HERE) {
  const file = join(dir, "sources.json");
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed.pack !== PACK_ID) {
    throw new Error(`sources.json names pack "${String(parsed.pack)}", expected "${PACK_ID}".`);
  }
  if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) {
    throw new Error("sources.json carries no sources.");
  }
  if (!Array.isArray(parsed.evidence) || parsed.evidence.length === 0) {
    throw new Error("sources.json carries no licence evidence.");
  }
  for (const evidence of parsed.evidence) {
    if (typeof evidence.url !== "string" || typeof evidence.sentence !== "string") {
      throw new Error("sources.json evidence needs a url and the exact sentence it states.");
    }
  }
  for (const source of parsed.sources) {
    if (typeof source.url !== "string" || !source.url.startsWith("https://")) {
      throw new Error(`Source "${String(source.name)}" has no https URL.`);
    }
    if (typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.sha256)) {
      throw new Error(`Source "${String(source.name)}" has no SHA-256.`);
    }
    if (typeof source.bytes !== "number" || source.bytes <= 0) {
      throw new Error(`Source "${String(source.name)}" has no size.`);
    }
  }
  const named = new Set(parsed.sources.map((source) => source.name));
  for (const language of LANGUAGES) {
    if (!named.has(`${language}.traineddata`)) {
      throw new Error(`sources.json has no source for the "${language}" model.`);
    }
  }
  if (!named.has("LICENSE")) throw new Error("sources.json has no source for the licence text.");
  return parsed;
}

/**
 * The metadata `pack-sign.mjs` takes: what the pack IS, with `files` left to the
 * signing tool, which computes the digests off the folder (`--meta` carrying
 * `files` is refused there on purpose).
 *
 * The version is the year and month the sources were cut, with a patch number
 * the maintainer raises if the same month is cut twice: upstream publishes no
 * releases for these models, so a date is the only version that means anything
 * about them, and it makes the pack's rollback rule (ADR-091 §4) compare two
 * dates rather than two arbitrary numbers.
 */
export function packMetadata(sources) {
  const [year, month] = String(sources.fetched).split("-");
  return {
    format: 1,
    id: PACK_ID,
    version: String(sources.version ?? `${year}.${month}.0`),
    kind: "dataset",
    title: {
      sr: "Tessdata (brzi modeli)",
      en: "Tessdata (fast models)",
    },
    description: {
      sr: "Jezici za čitanje teksta sa slike: engleski, srpski (latinica) i srpski (ćirilica).",
      en: "Languages for reading text off a picture: English, Serbian (Latin) and Serbian (Cyrillic).",
    },
    licence: {
      spdx: sources.licence.spdx,
      attribution: sources.licence.attribution,
      url: sources.licence.url,
    },
    source: {
      name: "tesseract-ocr/tessdata_fast",
      url: "https://github.com/tesseract-ocr/tessdata_fast",
    },
    // The build this feature landed in. A pack that named a HIGHER floor than
    // the build that reads it could never be installed, and one that named a
    // lower one would be installed and half-understood.
    minAppVersion: "1.5.0",
  };
}

/** The SHA-256 of some bytes, as the manifest spells it. */
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The real fetcher: the global `fetch` plus the response body. */
async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** One source's bytes: from the cache when its digest still matches, from the network otherwise. */
async function sourceBytes(source, cacheDir, log, download) {
  const path = join(cacheDir, source.name);
  if (existsSync(path)) {
    const cached = readFileSync(path);
    if (digest(cached) === source.sha256) {
      log(`cached    ${source.name} (${cached.byteLength} bytes)`);
      return cached;
    }
    log(`stale     ${source.name} - the cache no longer matches sources.json, re-fetching`);
  }
  const bytes = await download(source.url);
  const actual = digest(bytes);
  if (actual !== source.sha256) {
    throw new Error(
      `${source.name} hashes to ${actual}, but sources.json says ${source.sha256}. Upstream moved; update sources.json deliberately, with the new date.`,
    );
  }
  writeFileSync(path, bytes);
  log(`fetched   ${source.name} (${bytes.byteLength} bytes)`);
  return bytes;
}

/**
 * Builds the pack: fetches what is missing, converts the models, writes the
 * folder and the metadata, and reports what it did. Re-running it reuses the
 * cache and produces the same bytes.
 */
export async function buildPack(options = {}) {
  const sourcesDir = options.sourcesDir ?? HERE;
  const cacheDir = options.cacheDir ?? cacheDirFor();
  const outputDir = options.outputDir ?? outputDirFor();
  const metadataPath = options.metadataPath ?? metadataPathFor();
  const log = options.log ?? ((line) => console.log(line));
  // Injected so the converter's tests can build a pack from fixture bytes with
  // no network at all; production passes nothing and gets `fetch`.
  const download = options.fetchBytes ?? fetchBytes;
  const started = Date.now();

  const sources = readSources(sourcesDir);
  mkdirSync(cacheDir, { recursive: true });

  const models = sources.sources.filter((source) => source.language !== null);
  const licence = sources.sources.find((source) => source.name === "LICENSE");
  if (licence === undefined) throw new Error("sources.json has no licence source.");

  log(`pack      ${PACK_ID} ${String(sources.version)} -> ${outputDir}`);
  const written = [];
  for (const model of models) {
    const raw = await sourceBytes(model, cacheDir, log, download);
    const packed = gzipBytes(raw);
    const bytes = writePackFile(outputDir, posix.join(TESSDATA_DIR, trainedDataName(model.language)), packed);
    log(
      `packed    ${trainedDataName(model.language)} ${raw.byteLength} -> ${bytes} bytes (gzip 9)`,
    );
    written.push(bytes);
  }

  const licenceBytes = writePackFile(
    outputDir,
    LICENCE_FILE,
    await sourceBytes(licence, cacheDir, log, download),
  );
  log(`packed    ${LICENCE_FILE} ${licenceBytes} bytes`);
  written.push(licenceBytes);

  const metadata = packMetadata(sources);
  mkdirSync(dirname(metadataPath), { recursive: true });
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  log(`metadata  ${metadataPath}`);

  const total = written.reduce((sum, size) => sum + size, 0);
  log(`done      ${written.length} files, ${total} bytes, ${Date.now() - started} ms`);
  log(
    `sign with node scripts/pack-sign.mjs --dir ${outputDir} --meta ${metadataPath} --key <release-key.pem>`,
  );
  return { outputDir, metadataPath, totalBytes: total, fileCount: written.length };
}

/** One file into the pack folder, created if needed, answering how many bytes were written. */
function writePackFile(outputDir, name, bytes) {
  const path = join(outputDir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  // `statSync` rather than `bytes.byteLength` so what is reported is what the
  // signing tool will find on disk, not what this process believed it wrote.
  return statSync(path).size;
}

function main() {
  void buildPack().catch((error) => {
    console.error(`tessdata pack: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
