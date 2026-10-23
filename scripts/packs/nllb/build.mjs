// No shebang, for the reason every gate and tool in this repository has none: this
// module is both a CLI and an import target for its own test.
//
// THE NLLB PACK BUILDER. The translator runs NLLB-200 offline from one of three
// signed model packs, and the user picks the size. This assembles the three pack
// folders and their metadata for `scripts/pack-sign.mjs`; it signs nothing.
//
//   node scripts/packs/nllb/build.mjs --pack nllb-600m,nllb-1.3b [--update-sources]
//   node scripts/packs/nllb/build.mjs --all
//
// The 600M files are downloaded at a pinned revision into `<cache>\<id>\`, and a cached
// file whose SHA-256 matches the record is not fetched again. The 1.3B and 3.3B packs
// are converted on this machine, so their files are read in place from the folder
// `sources.json` names. A pack folder is rebuilt from scratch each run, and a pack
// whose local folder holds no converted model yet is skipped, not refused.
//
// THREE REFUSALS, EACH A PACK THAT WOULD LIE OR CANNOT BE PUBLISHED. A file of 2 GiB
// or more cannot be a release asset. A file whose hash differs from the record is not
// accepted unless `--update-sources` says so, because an upstream replacement would
// otherwise pass as the model the record describes. And the model's README must state
// the licence in its front matter, quoted as recorded, or the pack is not built.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NLLB_LANGUAGES } from "../../../apps/desktop/src/modules/translator/shared/languages.ts";
import { checkMeta } from "../../pack-sign.mjs";
import { writeCacheFile } from "../lib/cacheWrite.mjs";
import { readIfPresent, statIfPresent } from "../lib/readIfPresent.mjs";
import * as roots from "../lib/roots.mjs";
import { createSource } from "../lib/source.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A release asset cannot be this large or larger, so a pack holding such a file cannot be published. */
export const MAX_FILE_BYTES = 2 ** 31;

/** The app version a model pack needs: the translator ships in 2.5. */
const PACK_MIN_APP_VERSION = "2.5.0";

/** The licences this builder ships under, keyed by the value the model's README states. */
const ACCEPTED_LICENCES = { "cc-by-nc-4.0": "CC-BY-NC-4.0" };

/** A repository, as Hugging Face names one. */
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** A pinned revision: a full commit hash. A branch name would move under the record. */
const REVISION_PATTERN = /^[0-9a-f]{40}$/;

/** Every pack this repository can build, with its licence evidence. */
export function loadSources(file = join(HERE, "sources.json")) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed.format !== 1) throw new Error(`build: sources.json: format ${String(parsed.format)} is not 1.`);
  if (typeof parsed.host !== "string" || !parsed.host.startsWith("https://")) {
    throw new Error('build: sources.json: "host" must be an https origin.');
  }
  if (!Array.isArray(parsed.packs) || parsed.packs.length === 0) {
    throw new Error('build: sources.json: "packs" must be a non-empty array.');
  }
  for (const pack of parsed.packs) checkPackEntry(pack, parsed.host);
  return parsed;
}

/** Why a pack entry is not buildable. Refusals, not warnings: a wrong entry builds a wrong pack. */
function checkPackEntry(pack, host) {
  const where = `sources.json[${String(pack?.id)}]`;
  if (typeof pack?.id !== "string" || pack.id === "") throw new Error(`build: ${where}: "id" must be a string.`);
  if (!/^\d+\.\d+\.\d+$/.test(pack.version)) throw new Error(`build: ${where}: "version" must be MAJOR.MINOR.PATCH.`);
  if (typeof pack.model !== "string" || !REPO_PATTERN.test(pack.model)) {
    throw new Error(`build: ${where}: "model" must be "owner/name".`);
  }
  const origins = Object.keys(pack.origin ?? {});
  if (origins.length !== 1 || !["download", "local"].includes(origins[0])) {
    throw new Error(`build: ${where}: "origin" must be exactly one of "download" or "local".`);
  }
  if (pack.origin.download !== undefined) {
    const { repo, revision } = pack.origin.download;
    if (typeof repo !== "string" || !REPO_PATTERN.test(repo)) {
      throw new Error(`build: ${where}: "origin.download.repo" must be "owner/name".`);
    }
    if (typeof revision !== "string" || !REVISION_PATTERN.test(revision)) {
      throw new Error(`build: ${where}: "origin.download.revision" must be a 40-character commit hash.`);
    }
  } else if (typeof pack.origin.local !== "string" || pack.origin.local === "") {
    throw new Error(`build: ${where}: "origin.local" must be a folder.`);
  }
  if (!Array.isArray(pack.paths) || pack.paths.length === 0) throw new Error(`build: ${where}: "paths" must be a non-empty array.`);
  // A path that leaves the folder would let a manifest list a file the pack does not own.
  for (const path of pack.paths) {
    if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
      throw new Error(`build: ${where}: "${String(path)}" is not a relative pack path.`);
    }
  }
  for (const part of ["sr", "en"]) {
    for (const field of ["title", "description"]) {
      if (typeof pack[field]?.[part] !== "string" || pack[field][part].trim() === "") {
        throw new Error(`build: ${where}: "${field}.${part}" must be a non-empty string.`);
      }
    }
  }
  const { spdx, attribution, evidence } = pack.licence ?? {};
  if (typeof spdx !== "string" || typeof attribution !== "string" || attribution.trim() === "") {
    throw new Error(`build: ${where}: "licence" must carry "spdx" and a non-empty "attribution".`);
  }
  if (evidence?.url !== `${host}/${pack.model}/raw/main/README.md` || typeof evidence.line !== "string") {
    throw new Error(`build: ${where}: "licence.evidence" must name the model's README and the line that states the licence.`);
  }
}

/** The pack with this id, or a refusal naming the ones that exist. */
export function packById(sources, id) {
  const pack = sources.packs.find((entry) => entry.id === id);
  if (pack === undefined) {
    throw new Error(`build: no pack "${id}"; sources.json has ${sources.packs.map((entry) => entry.id).join(", ")}.`);
  }
  return pack;
}

/** Where one file of a downloaded pack comes from, at the pinned revision. */
export function fileUrl(sources, pack, path) {
  const { repo, revision } = pack.origin.download;
  return `${sources.host}/${repo}/resolve/${revision}/${path}`;
}

/** The model's own README, which states the licence the pack ships under. */
export function readmeUrl(sources, pack) {
  return `${sources.host}/${pack.model}/raw/main/README.md`;
}

/**
 * Refuses a README whose front matter does not state the recorded licence line, or
 * states one this builder does not ship under. The front matter is the block between
 * the first two `---` lines; the line has to be in it verbatim, quotes included.
 */
export function checkLicence(text, pack) {
  const { evidence, spdx } = pack.licence;
  const frontMatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].split(/\r?\n/) ?? [];
  if (!frontMatter.includes(evidence.line)) {
    throw new Error(`build: ${pack.id}: ${evidence.url} does not state "${evidence.line}" in its front matter.`);
  }
  const declared = /^license: "([^"]+)"$/.exec(evidence.line)?.[1];
  if (ACCEPTED_LICENCES[declared] !== spdx) {
    throw new Error(`build: ${pack.id}: the licence "${String(declared)}" is not one this builder ships under.`);
  }
}

/** The model's README, from the cache when it is there, otherwise fetched and cached. */
export async function fetchLicence({ sources, pack, cacheDir, fetchImpl }) {
  const file = join(cacheDir, "README.md");
  const cached = readIfPresent(file, "utf8");
  if (cached !== null) return cached;
  mkdirSync(cacheDir, { recursive: true });
  const bytes = await fetchImpl(readmeUrl(sources, pack));
  writeCacheFile(file, bytes);
  return bytes.toString("utf8");
}

/**
 * Every file of one pack, sorted by path. A downloaded pack is exactly its `paths`.
 * A local folder adds the external-data chunks of the pack's own graphs -
 * `<graph>.onnx_data`, `<graph>.onnx_data_1`, ..., the names
 * `@huggingface/transformers` loads - because a model larger than one file is
 * stored as several, and the pack must hold all of them or it loads half a model.
 * The converter's other graphs leave their data in the same folder; none of it
 * is the pack's.
 */
export function listFiles(pack) {
  if (pack.origin.download !== undefined) return [...pack.paths].sort();
  const onnx = join(pack.origin.local, "onnx");
  const graphs = new Set(pack.paths.filter((path) => path.endsWith(".onnx")).map((path) => path.slice("onnx/".length)));
  const external = existsSync(onnx)
    ? readdirSync(onnx)
        .filter((name) => {
          const chunk = /^(.+\.onnx)_data(?:_\d+)?$/.exec(name);
          return chunk !== null && graphs.has(chunk[1]);
        })
        .map((name) => `onnx/${name}`)
    : [];
  return [...pack.paths, ...external].sort();
}

/**
 * The first required file a local folder does not hold yet, or `undefined` when it holds
 * them all. A folder still being converted is a pack that is not built yet, not an error.
 */
export function missingFile(pack) {
  if (pack.origin.local === undefined) return undefined;
  return pack.paths.find((path) => !existsSync(join(pack.origin.local, ...path.split("/"))));
}

/** The SHA-256 of a buffer, as the record and the manifest both write it. */
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The SHA-256 of a file, read in chunks so that a 1 GB weight is never held in memory. */
export async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Refuses a file a release asset could not hold. Names the file, so the refusal says what to drop. */
export function checkFileSize(name, bytes) {
  if (bytes >= MAX_FILE_BYTES) {
    throw new Error(`build: ${name} is ${String(bytes)} bytes; a release asset cannot be ${String(MAX_FILE_BYTES)} bytes or larger.`);
  }
}

/** Refuses a hash that differs from the record unless the record is being rewritten. */
function refuseChangedHash(pack, path, digest, declared, updateSources) {
  if (declared !== null && declared !== digest && !updateSources) {
    throw new Error(
      `build: ${pack.id}: ${path} hashes ${digest}, and sources.json says ${declared}; pass --update-sources to record the new file.`,
    );
  }
}

async function readLocal({ pack, path, declared, updateSources, log }) {
  const file = join(pack.origin.local, ...path.split("/"));
  const stats = statIfPresent(file);
  if (stats === null) throw new Error(`build: ${pack.id}: ${file} is missing.`);
  checkFileSize(path, stats.size);
  const digest = await sha256File(file);
  refuseChangedHash(pack, path, digest, declared, updateSources);
  log(`local    ${path} (${String(stats.size)} bytes)`);
  return { path, file, bytes: stats.size, sha256: digest };
}

async function fetchDownload({ sources, pack, path, declared, cacheDir, updateSources, fetchImpl, log }) {
  const file = join(cacheDir, ...path.split("/"));
  const cached = statIfPresent(file);
  if (declared !== null && cached !== null && (await sha256File(file)) === declared) {
    log(`cached   ${path} (${String(cached.size)} bytes)`);
    return { path, file, bytes: cached.size, sha256: declared };
  }
  const body = await fetchImpl(fileUrl(sources, pack, path));
  checkFileSize(path, body.byteLength);
  const digest = sha256(body);
  refuseChangedHash(pack, path, digest, declared, updateSources);
  mkdirSync(dirname(file), { recursive: true });
  writeCacheFile(file, body);
  log(`fetched  ${path} (${String(body.byteLength)} bytes)`);
  return { path, file, bytes: body.byteLength, sha256: digest };
}

/**
 * Every file of one pack, located on disk and hashed. Each one is the source the
 * copy reads from: the cache for a download, the folder itself for a local pack.
 */
export async function gather({ sources, pack, cacheDir, updateSources, fetchImpl, log = () => {} }) {
  const files = [];
  for (const path of listFiles(pack)) {
    const args = { sources, pack, path, declared: pack.files?.[path] ?? null, cacheDir, updateSources, fetchImpl, log };
    files.push(pack.origin.local !== undefined ? await readLocal(args) : await fetchDownload(args));
  }
  return files;
}

/**
 * The pack folder: each gathered file copied into it, under its own path. The folder
 * is rebuilt from scratch, because a pack that kept a file from an earlier build would
 * list a file its source no longer produces. The deletion is confined to `<packsRoot>`,
 * and the check below is what makes that true rather than intended.
 */
export function assemble({ files, packDir, packsRoot }) {
  const resolvedPack = resolve(packDir);
  if (!resolvedPack.startsWith(resolve(packsRoot) + sep)) {
    throw new Error(`build: refusing to write outside the packs folder: ${resolvedPack}`);
  }
  rmSync(resolvedPack, { recursive: true, force: true });
  let bytes = 0;
  for (const file of files) {
    const to = join(resolvedPack, ...file.path.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(file.file, to);
    bytes += file.bytes;
  }
  return bytes;
}

/** The metadata `scripts/pack-sign.mjs` takes, without its `files` list. */
export function metadataFor(sources, pack) {
  const languages = String(NLLB_LANGUAGES.length);
  const origin = pack.origin.download !== undefined ? pack.origin.download.repo : pack.model;
  return {
    format: 1,
    id: pack.id,
    version: pack.version,
    kind: "model",
    title: { ...pack.title },
    description: {
      sr: pack.description.sr.replace("{n}", languages),
      en: pack.description.en.replace("{n}", languages),
    },
    licence: {
      spdx: pack.licence.spdx,
      attribution: pack.licence.attribution,
      url: `${sources.host}/${pack.model}`,
    },
    source: { name: origin, url: `${sources.host}/${origin}` },
    minAppVersion: PACK_MIN_APP_VERSION,
  };
}

/** `sources.json` with the measured hashes filled in for one pack; every other entry is written back as it was read. */
export function sourcesWithMeasured(sources, id, files) {
  const copy = JSON.parse(JSON.stringify(sources));
  packById(copy, id).files = Object.fromEntries(files.map((file) => [file.path, file.sha256]));
  return copy;
}

/** `--pack a,b` or `--all`, plus `--update-sources`. */
export function parseArgs(argv) {
  const args = { packs: [], updateSources: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--all") {
      args.packs = null;
    } else if (flag === "--update-sources") {
      args.updateSources = true;
    } else if (flag === "--pack") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("build: --pack needs a value.");
      args.packs = value.split(",").map((id) => id.trim()).filter((id) => id !== "");
      index += 1;
    } else {
      throw new Error(`build: unknown argument "${String(flag)}".`);
    }
  }
  if (args.packs !== null && args.packs.length === 0) throw new Error("build: pass --pack <id>[,<id>] or --all.");
  return args;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const sourcesFile = join(HERE, "sources.json");
  // `let`, and reassigned below, because `--update-sources` records one pack at a time
  // and each record starts from what the previous one wrote.
  let sources = loadSources(sourcesFile);
  const packsRoot = roots.outputRoot();
  const ids = args.packs ?? sources.packs.map((pack) => pack.id);

  for (const id of ids) {
    const pack = packById(sources, id);
    const missing = missingFile(pack);
    if (missing !== undefined) {
      console.log(`skip ${id}: ${missing} is not in ${pack.origin.local} yet; the model is not converted.`);
      continue;
    }
    const startedAt = Date.now();
    console.log(`build: ${id} (${pack.model})`);
    const source = createSource(id);
    const cacheDir = roots.cacheDirFor(id);
    const log = (line) => console.log(`  ${line}`);

    checkLicence(await fetchLicence({ sources, pack, cacheDir, fetchImpl: source.raw }), pack);
    console.log(`  licence: ${pack.licence.spdx} (${pack.licence.evidence.url})`);
    const files = await gather({
      sources, pack, cacheDir, updateSources: args.updateSources, fetchImpl: source.raw, log,
    });
    const packDir = roots.packDirFor(id);
    const bytes = assemble({ files, packDir, packsRoot });

    const metadata = metadataFor(sources, pack);
    checkMeta(metadata);
    writeFileSync(roots.packMetaPathFor(id), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    if (args.updateSources) {
      sources = sourcesWithMeasured(sources, id, files);
      writeFileSync(sourcesFile, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
      console.log(`  sources.json: recorded ${String(files.length)} file hashes for ${id}`);
    }

    console.log(
      `  pack: ${packDir} (${String(files.length)} files, ${String(bytes)} bytes, ${String(Date.now() - startedAt)} ms)`,
    );
    console.log(
      `  next: node scripts/pack-sign.mjs --dir ${packDir} --meta ${roots.packMetaPathFor(id)} --key <release-key.pem>`,
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
