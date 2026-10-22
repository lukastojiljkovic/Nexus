// No shebang — this module is both a CLI and an import target for its own test.
//
// THE TRANSLATOR'S VOICES: MMS-TTS checkpoints, converted to ONNX, proved, and
// built into voice packs.
//
//   node scripts/packs/voice/mms.mjs --convert [--only deu,fra,ell]
//   node scripts/packs/voice/mms.mjs --build [--only deu,fra,ell]
//
// The voices are the distinct MMS repositories the translator's language table
// points at (`apps/desktop/src/modules/translator/shared/languages.ts`), without
// the uroman ones (their text is romanised first, a different pipeline) and
// without `facebook/mms-tts-eng`, which ships as the existing `mms-tts-eng` pack.
//
// WHY THE CONVERSION HAS THESE FLAGS. Each one answers a failure measured on
// `facebook/mms-tts-deu`. `--skip_validation`: VITS draws random noise for its
// durations, so two runs differ in length and the exporter's comparison always
// fails. `--skip_onnxslim`: onnxslim folds the duration predictor's `Where`
// nodes with the dummy input's shape, and onnxruntime then refuses to load the
// model ("[ShapeInferenceError] Incompatible dimensions").
//
// THE PROOF. A converted voice is loaded through `@huggingface/transformers` from
// the local folder and made to speak a probe built from its own vocabulary. A
// voice that produces no speech is refused, because a conversion can succeed on
// disk and still be silent.
//
// THE LICENCE. A pack is built only when the repository's own card states
// CC-BY-NC 4.0, in its front matter and in its text. Nexus is free with no paid
// tier, so a non-commercial licence may ship with its attribution shown.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import * as roots from "../lib/roots.mjs";
import { assemble, metadataPath, packDirectory, sha256, VOICE_DESCRIPTOR_FILE } from "./build.mjs";
import { checkMeta } from "../../pack-sign.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const APP_DIR = join(REPO_ROOT, "apps", "desktop");
const LANGUAGES_FILE = new URL("../../../apps/desktop/src/modules/translator/shared/languages.ts", import.meta.url);

/** The converter's workspace, its Python and the logs of its runs, all outside the repository. */
const BUILD_ROOT = join(homedir(), ".nexus-build");
const PYTHON = join(BUILD_ROOT, "venv", "Scripts", "python.exe");
const CONVERTER_DIR = join(BUILD_ROOT, "tjs");
const MMS_ROOT = join(BUILD_ROOT, "mms");
const LOG_DIR = join(BUILD_ROOT, "mms-logs");

/** The metadata every MMS voice pack declares. */
export const VOICE_VERSION = "2026.10.0";
export const VOICE_MIN_APP_VERSION = "2.5.0";
/** The MMS repository that ships as the existing `mms-tts-eng` pack, so it is not built here. */
const ENGLISH_REPO = "facebook/mms-tts-eng";
/** The files of a voice pack, relative to the converted folder. */
export const PACK_PATHS = ["config.json", "tokenizer.json", "tokenizer_config.json", "vocab.json", "onnx/model_quantized.onnx"];
/** A proof must produce at least this much speech. */
export const MIN_PROOF_SECONDS = 0.2;
export const MIN_PROOF_RMS = 0.005;
/** How many of the vocabulary's letters the probe speaks. */
const PROBE_LETTERS = 24;

/** The language table, imported by path: Node strips its types and it has no imports. */
export async function loadLanguages() {
  return (await import(LANGUAGES_FILE)).NLLB_LANGUAGES;
}

/** `facebook/mms-tts-azj-script_latin` → `mms-tts-azj-script-latin`. */
export function packIdFor(repo) {
  const match = repo.match(/^facebook\/mms-tts-([a-z0-9_-]+)$/);
  if (match === null) throw new Error(`mms: "${repo}" is not an MMS-TTS repository.`);
  return `mms-tts-${match[1].replace(/_/g, "-")}`;
}

/** The ISO 639-3 code a voice serves: `azj` for both of its script splits. */
export function isoOf(repo) {
  return repo.replace(/^facebook\/mms-tts-/, "").split("-")[0];
}

/**
 * The voices to build, sorted by id, each with the rows it serves. Only
 * non-uroman rows count, and English is left to its existing pack.
 */
export function voicesIn(languages) {
  const rowsByRepo = new Map();
  for (const language of languages) {
    if (language.tts === null || language.tts.uroman || language.tts.repo === ENGLISH_REPO) continue;
    rowsByRepo.set(language.tts.repo, [...(rowsByRepo.get(language.tts.repo) ?? []), language]);
  }
  return [...rowsByRepo]
    .map(([repo, rows]) => ({ repo, id: packIdFor(repo), iso: isoOf(repo), rows }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** `--only deu,fra`: the voices of those languages, refusing a code that has none. */
export function selectVoices(voices, only) {
  if (only === undefined) return voices;
  const wanted = only.split(",").map((iso) => iso.trim()).filter((iso) => iso !== "");
  for (const iso of wanted) {
    if (!voices.some((voice) => voice.iso === iso)) throw new Error(`mms: no MMS voice serves "${iso}".`);
  }
  return voices.filter((voice) => wanted.includes(voice.iso));
}

/** The arguments of the conversion, as `scripts/convert.py` takes them. */
export function conversionArgs(repo, outputParent) {
  return [
    "-m",
    "scripts.convert",
    "--quantize",
    "--modes",
    "q8",
    "--skip_validation",
    "--skip_onnxslim",
    "--model_id",
    repo,
    "--output_parent_dir",
    outputParent,
  ];
}

/** Where a converted voice lives: `<mms root>/facebook/mms-tts-<x>`. */
export function convertedDirFor(repo) {
  return join(MMS_ROOT, ...repo.split("/"));
}

/** The probe a voice speaks: its first letters, in groups of four separated by spaces. */
export function probeText(vocabKeys) {
  const letters = vocabKeys.filter((key) => /^\p{L}$/u.test(key)).slice(0, PROBE_LETTERS);
  const groups = [];
  for (let index = 0; index < letters.length; index += 4) groups.push(letters.slice(index, index + 4).join(""));
  return groups.join(" ");
}

/** Refuses a proof that did not produce speech. */
export function checkProof({ seconds, rms }, repo) {
  if (!(seconds >= MIN_PROOF_SECONDS) || !(rms >= MIN_PROOF_RMS)) {
    throw new Error(
      `mms: ${repo}: the proof spoke ${String(seconds)} s at RMS ${String(rms)}; ` +
        `it must be at least ${String(MIN_PROOF_SECONDS)} s at RMS ${String(MIN_PROOF_RMS)}.`,
    );
  }
}

/** Refuses a repository whose card does not state CC-BY-NC 4.0 both in its front matter and in its text. */
export function checkLicence(readme, repo) {
  const frontMatter = readme.match(/^\s*---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const declared = /^license:\s*cc-by-nc-4\.0\s*$/m.test(frontMatter);
  const stated = readme.includes("The model is licensed as **CC-BY-NC 4.0**.");
  if (!declared || !stated) {
    throw new Error(`mms: ${repo}: its README does not state CC-BY-NC 4.0 in the front matter and in the text.`);
  }
}

/** The display names of a voice, from its first row: ICU's, or the FLORES name where ICU has none. */
export function displayNames(row) {
  const named = (locale) => {
    const name = new Intl.DisplayNames([locale], { type: "language", fallback: "none" }).of(row.tag) ?? row.fallbackName;
    if (name === null || name === undefined) throw new Error(`mms: ${row.code} has no ${locale} name.`);
    return name;
  };
  return { en: named("en"), srLatn: named("sr-Latn") };
}

/** The metadata `scripts/pack-sign.mjs` takes for one voice. */
export function voiceMetadata(voice) {
  const names = displayNames(voice.rows[0]);
  const url = `https://huggingface.co/${voice.repo}`;
  return {
    format: 1,
    id: voice.id,
    version: VOICE_VERSION,
    kind: "model",
    title: { sr: `Glas — ${names.srLatn}`, en: `Voice — ${names.en}` },
    description: {
      sr: "Čita prevode naglas na ovom jeziku.",
      en: "Reads translations aloud in this language.",
    },
    licence: {
      spdx: "CC-BY-NC-4.0",
      attribution: "MMS-TTS by Meta AI; converted to ONNX for Nexus",
      url,
    },
    source: { name: voice.repo, url },
    minAppVersion: VOICE_MIN_APP_VERSION,
  };
}

/** The records of `mms-voices.json`: the built voices replace their earlier records, sorted by id. */
export function mergeRecords(existing, built) {
  const byId = new Map(existing.map((record) => [record.id, record]));
  for (const record of built) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function cachedText(file, url) {
  if (existsSync(file)) return readFileSync(file, "utf8");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`mms: ${url} answered ${String(response.status)}.`);
  const text = await response.text();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return text;
}

function readJson(file) {
  if (!existsSync(file)) throw new Error(`mms: ${file} is missing.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Loads the converted voice and speaks the probe; returns the speech's length, loudness and time. */
async function prove(repo, vocabKeys) {
  const { env, pipeline } = await import(
    pathToFileURL(createRequire(join(APP_DIR, "package.json")).resolve("@huggingface/transformers")).href
  );
  env.allowRemoteModels = false;
  env.localModelPath = `${MMS_ROOT}${sep}`;
  const startedAt = Date.now();
  const synthesizer = await pipeline("text-to-speech", repo, { dtype: "q8" });
  try {
    const { audio, sampling_rate: rate } = await synthesizer(probeText(vocabKeys));
    let energy = 0;
    for (const sample of audio) energy += sample * sample;
    return {
      seconds: audio.length / rate,
      rms: audio.length === 0 ? 0 : Math.sqrt(energy / audio.length),
      ms: Date.now() - startedAt,
    };
  } finally {
    await synthesizer.dispose();
  }
}

/** Converts (when needed), records the upstream commit, and proves one voice. */
async function convertVoice(voice) {
  const dir = convertedDirFor(voice.repo);
  const quantized = join(dir, "onnx", "model_quantized.onnx");
  const args = conversionArgs(voice.repo, MMS_ROOT);
  if (!existsSync(quantized)) {
    const run = spawnSync(PYTHON, args, {
      cwd: CONVERTER_DIR,
      env: { ...process.env, PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION: "python", PYTHONIOENCODING: "utf-8" },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    const log = join(LOG_DIR, `${voice.id}.log`);
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(log, `${run.stdout ?? ""}${run.stderr ?? ""}`);
    if (run.status !== 0 || !existsSync(quantized)) {
      throw new Error(`mms: ${voice.repo}: the conversion exited ${String(run.status)}; see ${log}.`);
    }
  }
  if (!existsSync(join(dir, "convert.json"))) {
    const model = await fetch(`https://huggingface.co/api/models/${voice.repo}`);
    if (!model.ok) throw new Error(`mms: the model API answered ${String(model.status)} for ${voice.repo}.`);
    const { sha } = await model.json();
    const record = {
      repo: voice.repo,
      revision: sha,
      convertedAt: statSync(quantized).mtime.toISOString(),
      command: [PYTHON, ...args].join(" "),
    };
    writeFileSync(join(dir, "convert.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
  if (!existsSync(join(dir, "proof.json"))) {
    const vocab = readJson(join(dir, "vocab.json"));
    const proof = await prove(voice.repo, Object.keys(vocab));
    checkProof(proof, voice.repo);
    writeFileSync(join(dir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
    rmSync(join(dir, "onnx", "model.onnx"), { force: true });
  }
}

/** Assembles one proved voice's pack and returns its metadata and file records. */
async function buildVoice(voice) {
  const dir = convertedDirFor(voice.repo);
  if (!existsSync(join(dir, "proof.json"))) throw new Error(`mms: ${voice.repo} is not proved; run --convert first.`);
  const convert = readJson(join(dir, "convert.json"));
  const config = readJson(join(dir, "config.json"));
  if (!Number.isSafeInteger(config.sampling_rate)) throw new Error(`mms: ${voice.repo}: config.json has no sampling_rate.`);

  const readme = await cachedText(
    roots.cacheDirFor(voice.id, "README.md"),
    `https://huggingface.co/${voice.repo}/raw/main/README.md`,
  );
  checkLicence(readme, voice.repo);

  const packsRoot = roots.outputRoot();
  const packDir = packDirectory(voice.id, packsRoot);
  assemble({
    voice: {
      id: voice.id,
      kind: "tts",
      engine: "vits",
      languages: voice.rows.map((row) => row.tag),
      sampleRate: config.sampling_rate,
      repo: voice.repo,
      revision: convert.revision,
      paths: PACK_PATHS,
    },
    cacheDir: dir,
    packDir,
    packsRoot,
  });
  const metadata = voiceMetadata(voice);
  checkMeta(metadata);
  writeFileSync(metadataPath(packsRoot, voice.id), `${JSON.stringify(metadata, null, 2)}\n`);

  const files = [...PACK_PATHS, VOICE_DESCRIPTOR_FILE].sort().map((path) => {
    const bytes = readFileSync(join(packDir, ...path.split("/")));
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
  });
  return {
    id: voice.id,
    repo: voice.repo,
    revision: convert.revision,
    languages: voice.rows.map((row) => row.tag),
    files,
  };
}

export async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { convert: { type: "boolean" }, build: { type: "boolean" }, only: { type: "string" } },
    strict: true,
  });
  if (values.convert === values.build) {
    throw new Error("mms: pass exactly one of --convert or --build, with an optional --only <iso3>,…");
  }
  const voices = selectVoices(voicesIn(await loadLanguages()), values.only);
  const built = [];
  const failed = [];
  for (const voice of voices) {
    const startedAt = Date.now();
    try {
      if (values.convert) {
        await convertVoice(voice);
        console.log(`mms: ${voice.id} proved in ${String(Date.now() - startedAt)} ms`);
      } else {
        built.push(await buildVoice(voice));
        console.log(`mms: ${voice.id} built in ${String(Date.now() - startedAt)} ms`);
      }
    } catch (error) {
      failed.push(voice.id);
      console.log(`mms: ${voice.id} FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (built.length > 0) {
    const file = join(HERE, "mms-voices.json");
    const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).voices : [];
    const record = { format: 1, voices: mergeRecords(existing, built) };
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  }
  if (failed.length > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
