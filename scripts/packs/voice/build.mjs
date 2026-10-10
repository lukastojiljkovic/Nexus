// No shebang — for the reason every other gate and tool in this repository has
// none: this module is both a CLI and an import target for its own test.
//
// THE VOICE PACK BUILDER.
//
//   node scripts/packs/voice/build.mjs --voice whisper-base,mms-tts-eng [--update-sources]
//   node scripts/packs/voice/build.mjs --all
//
// It downloads one voice's files into `%TEMP%\nexus-pack-cache\<id>\`, assembles
// the pack folder at `%TEMP%\nexus-packs\<id>\`, writes the metadata file
// `scripts/pack-sign.mjs` takes, and prints what it fetched, the sizes and the
// time it took. Re-running it reuses the cache, and a file already in the cache
// whose SHA-256 matches the one this file records is not fetched again.
//
// WHAT IT ADDS TO THE MODEL'S OWN FILES, AND WHY. A pack holds the ONNX weights
// and the configuration files exactly as upstream published them, plus one file
// of ours: `voice.json` (`apps/desktop/src/main/assistant/voice/packs.ts` reads
// it), which says what the model IS — kind, engine, languages, output rate and
// where it came from. The pack manifest of ADR-091 has no field for those, and
// it should not: those are facts about the model, and a second place to write
// them is a second place to be wrong. Because `voice.json` is listed in the
// signed manifest like every other content file, it is hashed and signed by the
// same code that hashes the weights, so a pack cannot be relabelled in transit.
//
// TWO REFUSALS, AND BOTH ARE ABOUT THE SAME THING — a pack that lies. The
// descriptor's engine is checked against the model's own `config.json`
// `model_type`, because a `vits` descriptor over a Whisper config would load a
// text-to-speech pipeline over a speech recogniser. And `sources.json` must
// carry the licence EVIDENCE for the repository: the URL and the sentence, in
// this file, or the voice cannot be built at all.
//
// IT DOES NOT SIGN ANYTHING. Signing needs the release key, which lives on the
// maintainer's machine and in the repository's Actions secrets; this tool stops
// at the folder and the metadata, and `scripts/pack-sign.mjs --dir --meta --key`
// is the next and last step.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkMeta } from "../../pack-sign.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The descriptor file this builder writes into the pack, and its format. */
export const VOICE_DESCRIPTOR_FILE = "voice.json";
export const VOICE_DESCRIPTOR_FORMAT = 1;

/** Where the pack's metadata for `pack-sign.mjs` is written, beside the pack folder. */
export function metadataPath(packsRoot, id) {
  return join(packsRoot, `${id}.meta.json`);
}

/** The version every voice pack of this wave declares, and the app floor it needs. */
const PACK_MIN_APP_VERSION = "1.6.0";

/** The two engines this builder knows, and the kind each one is. */
const ENGINE_KINDS = { whisper: "stt", vits: "tts" };

/** A voice id, as a folder name and as a manifest id. */
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A repository, as Hugging Face names one. */
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** A pinned revision: the default branch, or a full commit hash. */
const REVISION_PATTERN = /^(main|[0-9a-f]{40})$/;

/** Every voice this repository can build, with its licence evidence. */
export function loadSources(file = join(HERE, "sources.json")) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed.format !== 1) throw new Error(`build: sources.json: format ${String(parsed.format)} is not 1.`);
  if (typeof parsed.host !== "string" || !parsed.host.startsWith("https://")) {
    throw new Error('build: sources.json: "host" must be an https origin.');
  }
  if (!Array.isArray(parsed.voices) || parsed.voices.length === 0) {
    throw new Error('build: sources.json: "voices" must be a non-empty array.');
  }
  for (const voice of parsed.voices) checkVoiceEntry(voice);
  return parsed;
}

/** Why a voice entry is not buildable. Refusals, not warnings: a wrong entry builds a wrong pack. */
function checkVoiceEntry(voice) {
  const where = `sources.json[${String(voice?.id)}]`;
  if (typeof voice?.id !== "string" || !ID_PATTERN.test(voice.id)) {
    throw new Error(`build: ${where}: "id" must be kebab-case.`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(voice.version)) throw new Error(`build: ${where}: "version" must be MAJOR.MINOR.PATCH.`);
  if (voice.kind !== "stt" && voice.kind !== "tts") throw new Error(`build: ${where}: "kind" must be "stt" or "tts".`);
  if (ENGINE_KINDS[voice.engine] !== voice.kind) {
    throw new Error(`build: ${where}: engine "${String(voice.engine)}" is never a "${voice.kind}" pack.`);
  }
  if (!Array.isArray(voice.languages) || voice.languages.length === 0) {
    throw new Error(`build: ${where}: "languages" must be a non-empty array.`);
  }
  if (!Number.isSafeInteger(voice.sampleRate)) throw new Error(`build: ${where}: "sampleRate" must be a number.`);
  if (typeof voice.repo !== "string" || !REPO_PATTERN.test(voice.repo)) {
    throw new Error(`build: ${where}: "repo" must be "owner/name".`);
  }
  if (typeof voice.revision !== "string" || !REVISION_PATTERN.test(voice.revision)) {
    throw new Error(`build: ${where}: "revision" must be "main" or a 40-character commit hash.`);
  }
  if (!Array.isArray(voice.paths) || voice.paths.length === 0) {
    throw new Error(`build: ${where}: "paths" must be a non-empty array.`);
  }
  // A path that leaves the folder would let a manifest list a file the pack does
  // not own, and `main/packs/paths.ts` would refuse the pack after the download
  // had been paid for.
  for (const path of voice.paths) {
    if (typeof path !== "string" || path === "" || path.includes("\\") || path.startsWith("/") || path.includes("..")) {
      throw new Error(`build: ${where}: "${String(path)}" is not a relative pack path.`);
    }
  }
  for (const part of ["sr", "en"]) {
    for (const field of ["title", "description"]) {
      const value = voice[field]?.[part];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`build: ${where}: "${field}.${part}" must be a non-empty string.`);
      }
    }
  }
  if (typeof voice.licence?.spdx !== "string" || typeof voice.licence?.url !== "string") {
    throw new Error(`build: ${where}: "licence" must carry "spdx" and "url".`);
  }
  if (typeof voice.licence?.attribution !== "string" || voice.licence.attribution.trim() === "") {
    throw new Error(`build: ${where}: "licence.attribution" is required and is always shown to the user.`);
  }
  if (typeof voice.source?.name !== "string" || typeof voice.source?.url !== "string") {
    throw new Error(`build: ${where}: "source" must carry "name" and "url".`);
  }
  if (!Array.isArray(voice.evidence) || voice.evidence.length === 0) {
    throw new Error(`build: ${where}: "evidence" must quote the page that states the licence.`);
  }
  for (const evidence of voice.evidence) {
    if (typeof evidence?.url !== "string" || typeof evidence?.sentence !== "string" || evidence.sentence === "") {
      throw new Error(`build: ${where}: every evidence entry needs a "url" and the "sentence" quoted from it.`);
    }
  }
}

/** The voice with this id, or a refusal naming the ones that exist. */
export function voiceById(sources, id) {
  const voice = sources.voices.find((entry) => entry.id === id);
  if (voice === undefined) {
    throw new Error(`build: no voice "${id}"; sources.json has ${sources.voices.map((entry) => entry.id).join(", ")}.`);
  }
  return voice;
}

/** Where one of a voice's files comes from. */
export function fileUrl(sources, voice, path) {
  return `${sources.host}/${voice.repo}/resolve/${voice.revision}/${path}`;
}

/**
 * The descriptor this pack will carry, checked against the model's own config.
 *
 * The check is the point: `model_type` is what transformers.js uses to choose
 * an architecture, so a pack whose two halves disagree fails as a confusing
 * runtime error in a worker instead of as a refusal here.
 */
export function descriptorFor(voice, modelConfig) {
  const modelType = modelConfig?.model_type;
  if (typeof modelType !== "string" || modelType.toLowerCase() !== voice.engine) {
    throw new Error(
      `build: ${voice.id}: the descriptor says "${voice.engine}" but config.json says "${String(modelType)}".`,
    );
  }
  const declaredRate = modelConfig?.sampling_rate;
  if (declaredRate !== undefined && declaredRate !== voice.sampleRate) {
    throw new Error(
      `build: ${voice.id}: the descriptor says ${String(voice.sampleRate)} Hz but config.json says ${String(declaredRate)}.`,
    );
  }
  return {
    format: VOICE_DESCRIPTOR_FORMAT,
    kind: voice.kind,
    engine: voice.engine,
    languages: [...voice.languages],
    sampleRate: voice.sampleRate,
    upstream: { repo: voice.repo, revision: voice.revision },
  };
}

/** The metadata `scripts/pack-sign.mjs` takes, without its `files` list. */
export function metadataFor(voice) {
  return {
    format: 1,
    id: voice.id,
    version: voice.version,
    kind: "model",
    title: { ...voice.title },
    description: { ...voice.description },
    licence: {
      spdx: voice.licence.spdx,
      attribution: voice.licence.attribution,
      url: voice.licence.url,
    },
    source: { name: voice.source.name, url: voice.source.url },
    minAppVersion: PACK_MIN_APP_VERSION,
  };
}

/** The SHA-256 of a buffer, as the manifest and the evidence file both write it. */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Where one voice's downloaded files are cached, and where its pack folder goes. */
export function cacheDirectory(id, root = join(tmpdir(), "nexus-pack-cache")) {
  return join(root, id);
}

export function packDirectory(id, root = join(tmpdir(), "nexus-packs")) {
  return join(root, id);
}

/**
 * Every file of one voice, in the cache.
 *
 * A file already cached is REUSED only when the declared SHA-256 matches it, so
 * a half-written download and an upstream replacement are both caught here
 * rather than inside a signed pack. The declared hash is `null` on a first
 * build, and then the file is fetched and its hash computed.
 */
export async function harvest({ sources, voice, cacheDir, fetchImpl = fetch, log = () => {} }) {
  mkdirSync(cacheDir, { recursive: true });
  const measured = [];
  for (const path of voice.paths) {
    const file = join(cacheDir, ...path.split("/"));
    const declared = voice.files?.[path] ?? null;
    const cached = existsSync(file) ? readFileSync(file) : null;
    if (cached !== null && declared !== null && sha256(cached) === declared) {
      log(`cached   ${path} (${String(cached.byteLength)} bytes)`);
      measured.push({ path, bytes: cached.byteLength, sha256: declared });
      continue;
    }
    const url = fileUrl(sources, voice, path);
    const startedAt = Date.now();
    const response = await fetchImpl(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`build: ${voice.id}: ${url} answered ${String(response.status)}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = sha256(bytes);
    if (declared !== null && declared !== digest) {
      throw new Error(`build: ${voice.id}: ${path} hashes ${digest}, and sources.json says ${declared}.`);
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    log(`fetched  ${path} (${String(bytes.byteLength)} bytes in ${String(Date.now() - startedAt)} ms)`);
    measured.push({ path, bytes: bytes.byteLength, sha256: digest });
  }
  measured.sort((a, b) => (a.path < b.path ? -1 : 1));
  return measured;
}

/**
 * The pack folder: the model's files, copied out of the cache, plus `voice.json`.
 *
 * The folder is rebuilt from scratch every time, because a pack that kept a
 * file from a previous build would be a pack whose manifest lists a file the
 * source no longer produces. The deletion is confined to
 * `<packsRoot>/<id>`, and the assert below is what makes that true rather than
 * intended.
 */
export function assemble({ voice, cacheDir, packDir, packsRoot }) {
  const resolvedPack = resolve(packDir);
  if (!resolvedPack.startsWith(resolve(packsRoot) + sep)) {
    throw new Error(`build: refusing to write outside the packs folder: ${resolvedPack}`);
  }
  rmSync(resolvedPack, { recursive: true, force: true });
  mkdirSync(resolvedPack, { recursive: true });

  let bytes = 0;
  for (const path of voice.paths) {
    const from = join(cacheDir, ...path.split("/"));
    const to = join(resolvedPack, ...path.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    const content = readFileSync(from);
    writeFileSync(to, content);
    bytes += content.byteLength;
  }

  const config = JSON.parse(readFileSync(join(cacheDir, "config.json"), "utf8"));
  const descriptor = descriptorFor(voice, config);
  const descriptorBytes = Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  writeFileSync(join(resolvedPack, VOICE_DESCRIPTOR_FILE), descriptorBytes);

  return { descriptor, descriptorBytes, bytes: bytes + descriptorBytes.byteLength };
}

/**
 * `sources.json` with the measured hashes filled in for one voice.
 *
 * Only `files` and `harvestedAt` of that one entry change; every other key is
 * written back exactly as it was read, in the order it was read, so the diff of
 * a `--update-sources` run is the evidence and nothing else.
 */
export function sourcesWithMeasured(sources, id, measured, harvestedAt) {
  const copy = JSON.parse(JSON.stringify(sources));
  const voice = voiceById(copy, id);
  const files = {};
  for (const file of measured) files[file.path] = file.sha256;
  voice.files = files;
  voice.harvestedAt = harvestedAt;
  return copy;
}

/** `--voice a,b` or `--all`, plus `--update-sources`. */
export function parseArgs(argv) {
  const values = { voices: [], updateSources: false, cacheRoot: undefined, packsRoot: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--all") {
      values.voices = null;
      continue;
    }
    if (flag === "--update-sources") {
      values.updateSources = true;
      continue;
    }
    if (flag === "--voice" || flag === "--cache" || flag === "--packs") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`build: ${flag} needs a value.`);
      if (flag === "--voice") values.voices = value.split(",").map((id) => id.trim()).filter((id) => id !== "");
      if (flag === "--cache") values.cacheRoot = value;
      if (flag === "--packs") values.packsRoot = value;
      index += 1;
      continue;
    }
    throw new Error(`build: unknown argument "${String(flag)}".`);
  }
  if (values.voices !== null && values.voices.length === 0) {
    throw new Error("build: pass --voice <id>[,<id>] or --all.");
  }
  return values;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const sourcesFile = join(HERE, "sources.json");
  // `let`, and reassigned below, because `--update-sources` records ONE voice at
  // a time and each record has to start from what the previous one wrote. A
  // `const` snapshot here silently dropped every earlier voice's hashes: the
  // first build of all four packs left only the last one's file list in
  // `sources.json`, and the evidence file that exists to be checked was wrong.
  let sources = loadSources(sourcesFile);
  const cacheRoot = args.cacheRoot ?? join(tmpdir(), "nexus-pack-cache");
  const packsRoot = args.packsRoot ?? join(tmpdir(), "nexus-packs");
  const ids = args.voices ?? sources.voices.map((voice) => voice.id);
  const harvestedAt = new Date().toISOString().slice(0, 10);

  for (const id of ids) {
    const voice = voiceById(sources, id);
    const startedAt = Date.now();
    console.log(`build: ${id} (${voice.kind}, ${voice.engine}, ${voice.repo}@${voice.revision})`);
    const measured = await harvest({
      sources,
      voice,
      cacheDir: cacheDirectory(id, cacheRoot),
      log: (line) => { console.log(`  ${line}`); },
    });
    const packDir = packDirectory(id, packsRoot);
    const assembled = assemble({ voice, cacheDir: cacheDirectory(id, cacheRoot), packDir, packsRoot });
    console.log(`  ${VOICE_DESCRIPTOR_FILE}: ${JSON.stringify(assembled.descriptor)}`);

    const metadata = metadataFor(voice);
    checkMeta(metadata);
    writeFileSync(metadataPath(packsRoot, id), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    if (args.updateSources) {
      sources = sourcesWithMeasured(sources, id, measured, harvestedAt);
      writeFileSync(sourcesFile, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
      console.log(`  sources.json: recorded ${String(measured.length)} file hashes for ${id}`);
    }

    console.log(
      `  pack: ${packDir} (${String(measured.length + 1)} files, ${String(assembled.bytes)} bytes, ` +
        `${String(Date.now() - startedAt)} ms)`,
    );
    console.log(`  next: node scripts/pack-sign.mjs --dir ${packDir} --meta ${metadataPath(packsRoot, id)} --key <release-key.pem>`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
