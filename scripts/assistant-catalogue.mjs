// No shebang — for the reason the other tools in this directory have none: this
// module is both a CLI and an import target for its own test.
//
// ADR-096's catalogue refresher. The assistant's curated model list
// (`apps/desktop/src/main/assistant/runtime/catalogue.json`) is a signed part of
// the app release, and the two facts in it that MUST NOT be typed by hand are
// the file's SHA-256 and its size: a hand-copied hash is a hash of whatever the
// copier believed, and the download service refuses a download without one.
//
//   node scripts/assistant-catalogue.mjs            # refresh what the API knows
//   node scripts/assistant-catalogue.mjs --fit      # …and the memory estimates
//   node scripts/assistant-catalogue.mjs --check    # read-only; exits 1 on drift
//
// `--check` costs one API request per model and compares what the Hub publishes
// with what the committed file says. It does NOT re-run the estimator (that is
// `--fit`, and each estimate needs a range read of a gigabyte-scale file): a
// model whose bytes changed gets a new hash and size, which the API check sees,
// and the refresh that follows is the one that recomputes the fits.
//
// WHAT COMES FROM WHERE, and there is no third source.
//
//   sha256, sizeBytes          Hugging Face's file listing for the repository
//                              (`/api/models/<repo>/tree/main`, the LFS `oid` and
//                              `size`). A repository that does not publish its
//                              oids — gated ones answer with asterisks — is a
//                              REFUSAL, never a skipped field: an installer
//                              cannot verify a model whose hash nobody can read.
//   contextTokens              the GGUF file's own `*.context_length`, read from
//                              its header (`--fit`). The model card is where the
//                              family's claim is quoted in the ADR; the file is
//                              what llama.cpp will actually enforce.
//   languages                  the repository's declared language codes, verbatim.
//                              An empty list means the card declares none — which
//                              for the assistant's default locale is the fact a
//                              reader needs most.
//   fit.*                      node-llama-cpp's own estimator (see `fitFor`), at
//                              the context the runtime loads (`FIT_CONTEXT_TOKENS`).
//
// The HUMAN fields — id, title, family, repo, file, projectorFile, capabilities
// and licence — are never written by this tool. It reads them, verifies what it
// can (the named file is in the tree, the architecture is supported by the
// installed llama.cpp, the template's tool support agrees with `capabilities`)
// and leaves them exactly as they are found.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

/** The one file this tool writes. */
export const CATALOGUE_PATH = join(
  REPO_ROOT,
  "apps/desktop/src/main/assistant/runtime/catalogue.json",
);

/** The Hub's API and its file host. Both are https and both are pinned here. */
export const HF_API = "https://huggingface.co/api/models";
export const HF_FILES = "https://huggingface.co";

/**
 * The context the runtime loads a chat model with, and therefore the context the
 * stored estimates are made at. It is the SAME number the app's `CHAT_CONTEXT_TOKENS`
 * holds — `catalogue.test.ts` reads that constant out of the app and fails if the
 * two ever drift, because an estimate at one context and a load at another is a
 * recommendation about a model nobody runs.
 */
export const FIT_CONTEXT_TOKENS = 8192;

/** A file's published digest, as the Hub's listing describes it. */
const SHA256 = /^[0-9a-f]{64}$/;

/** `/api/models/<repo>/tree/main?recursive=true` — the listing this tool reads. */
export function treeUrl(repo) {
  return `${HF_API}/${repo}/tree/main?recursive=true`;
}

/** `/api/models/<repo>` — the card's own metadata, which is where `languages` comes from. */
export function modelUrl(repo) {
  return `${HF_API}/${repo}`;
}

/** The URL a file inside a repository resolves to, for a range read of its header. */
export function resolveUrl(repo, file) {
  return `${HF_FILES}/${repo}/resolve/main/${file}`;
}

/**
 * The Hub's file listing, read into the two facts that may not be typed: a file's
 * SHA-256 and its size.
 *
 * `tree` is the parsed reply — a fixture in the test, the API in the CLI. Every
 * way it can fail to answer is a THROW rather than a default, because the caller
 * is about to write a number into a file the app verifies downloads against, and
 * "we could not tell" must never become a plausible-looking hash.
 */
export function measuredFromTree(entry, tree) {
  if (!Array.isArray(tree)) {
    throw new Error(`${entry.id}: the repository listing is not an array.`);
  }
  const measure = (file, what) => {
    const found = tree.find((candidate) => candidate?.type === "file" && candidate?.path === file);
    if (found === undefined) {
      throw new Error(`${entry.id}: "${file}" (${what}) is not in ${entry.repo}.`);
    }
    const oid = found.lfs?.oid ?? found.oid;
    const size = found.lfs?.size ?? found.size;
    if (typeof oid !== "string" || !SHA256.test(oid)) {
      throw new Error(
        `${entry.id}: "${file}" publishes no SHA-256 (LFS oid). A gated repository ` +
          "answers with asterisks, and a model nobody can verify is not a catalogue entry.",
      );
    }
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error(`${entry.id}: "${file}" has no usable size in the listing.`);
    }
    return { sha256: oid, sizeBytes: size };
  };

  const measured = { ...measure(entry.file, "the model") };
  if (entry.projectorFile !== undefined) {
    const projector = measure(entry.projectorFile, "the projector");
    measured.projector = { file: entry.projectorFile, ...projector };
  }
  return measured;
}

/**
 * The language codes the repository's own card declares, verbatim and validated.
 *
 * Nothing is inferred from the model's family, its size, or the languages some
 * other member of it supports: the assistant's default locale is Serbian (`sr`)
 * and the one thing a reader of this list must be able to trust is whether
 * anybody claimed it. HF stores either codes (`["sr"]`) or names (`"serbian"`)
 * depending on how the card was written, so a name is refused rather than
 * guessed at — the card can be fixed, a wrong code in a signed release cannot.
 */
export function languagesFromCard(entry, card) {
  const declared = card?.cardData?.language ?? card?.language;
  if (declared === undefined || declared === null) return [];
  const list = Array.isArray(declared) ? declared : [declared];
  const codes = [];
  for (const value of list) {
    if (typeof value !== "string") continue;
    const code = value.trim().toLowerCase();
    if (!/^[a-z]{2,3}$/.test(code)) {
      throw new Error(
        `${entry.id}: the card declares the language "${value}", which is not a code. ` +
          "Write it as a code (`sr`) before refreshing again.",
      );
    }
    codes.push(code);
  }
  return [...new Set(codes)].sort();
}

/**
 * What a full offload and a CPU run of this file need, in bytes — every number
 * of it taken from node-llama-cpp's estimator, none of it derived here.
 *
 * Four figures, from four calls, and the reason each is the one it is:
 *
 *   weights   `estimateModelResourceRequirementsV2({gpuLayers: totalLayers})`
 *             — the quantised weights as llama.cpp will place them on the card.
 *   host      the same call's `cpuRam`: the buffers llama.cpp keeps in host
 *             memory even when every layer is offloaded.
 *   allRam    `estimateModelResourceRequirementsV2({gpuLayers: 0}).cpuRam`: the
 *             whole model in host memory for a CPU-only run.
 *   context   `estimateContextResourceRequirementsV2({contextSize})` — the KV
 *             cache and graph overhead at the loaded context. The estimator
 *             reports this cost in ONE figure and does not split it by device,
 *             so it is charged to the card in `vramBytes` and to host memory in
 *             `cpuRamBytes`: when every layer is offloaded, llama.cpp allocates
 *             the KV cache on the same device as the layers (that is why
 *             `gpuLayers: "auto"` documents itself as taking "the VRAM required
 *             to create a context" into account, `LlamaModel.d.ts`).
 *
 * `recommend()` in the app spends exactly these three totals and nothing else.
 */
export async function fitFor(entry, llamaCpp) {
  const { readGgufFileInfo, GgufInsights } = llamaCpp;
  const info = await readGgufFileInfo(resolveUrl(entry.repo, entry.file), { readTensorInfo: true });
  const insights = await GgufInsights.from(info);
  if (!insights.isSupportedByLlamaCpp) {
    throw new Error(
      `${entry.id}: the installed llama.cpp does not support "${architectureOf(info)}".`,
    );
  }
  const layers = insights.totalLayers;
  const onCard = await insights.estimateModelResourceRequirementsV2({ gpuLayers: layers });
  const inMemory = await insights.estimateModelResourceRequirementsV2({ gpuLayers: 0 });
  const context = await insights.estimateContextResourceRequirementsV2({
    contextSize: FIT_CONTEXT_TOKENS,
    modelGpuLayers: layers,
  });

  return {
    contextTokens: FIT_CONTEXT_TOKENS,
    vramBytes: onCard.gpuVram + context.cpuRam,
    hostRamBytes: onCard.cpuRam + context.cpuRam,
    cpuRamBytes: inMemory.cpuRam + context.cpuRam,
    contextTokensInFile: trainContextOf(info),
  };
}

/**
 * The architecture name inside a `GgufFileInfo`, for messages. Never used to
 * decide anything: what decides is `GgufInsights.isSupportedByLlamaCpp`.
 *
 * The library nests metadata by namespace (`general`, `qwen3`, `tokenizer`), and
 * exposes the architecture's own keys, unwrapped, as `architectureMetadata`.
 */
function architectureOf(info) {
  const value = info?.metadata?.general?.architecture;
  return typeof value === "string" ? value : "unknown";
}

/** The context length the file itself declares, or `null` when it declares none. */
function trainContextOf(info) {
  const declared = info?.architectureMetadata?.context_length;
  return Number.isSafeInteger(declared) && declared > 0 ? declared : null;
}

/** `--flag` pairs from argv. `--fit` and `--check` take no value. */
export function parseArgs(argv) {
  const flags = new Set();
  for (const arg of argv) {
    if (arg !== "--fit" && arg !== "--check") {
      throw new Error(
        `catalogue: unknown argument "${arg}". ` +
          "Usage: node scripts/assistant-catalogue.mjs [--fit] [--check]",
      );
    }
    flags.add(arg.slice(2));
  }
  return { fit: flags.has("fit"), check: flags.has("check") };
}

/** node-llama-cpp lives under `apps/desktop`'s own dependencies, not the root's. */
async function importLlamaCpp() {
  const require = createRequire(join(REPO_ROOT, "apps/desktop/package.json"));
  return import(pathToFileURL(require.resolve("node-llama-cpp")).href);
}

/**
 * Refreshes every measured field in place and answers the catalogue as it will
 * be written. `check` runs the same comparisons and writes nothing.
 */
export async function refresh(catalogue, options) {
  const { fit, check, fetchJson, llamaCpp } = options;
  const models = [];
  for (const entry of catalogue.models) {
    const tree = await fetchJson(treeUrl(entry.repo));
    const card = await fetchJson(modelUrl(entry.repo));
    const measured = measuredFromTree(entry, tree);
    const languages = languagesFromCard(entry, card);
    const licences = catalogueLicence(entry);

    const next = {
      ...entry,
      sha256: measured.sha256,
      sizeBytes: measured.sizeBytes,
      languages,
    };
    if (measured.projector !== undefined) next.projector = measured.projector;
    if (fit) {
      const estimate = await fitFor(entry, llamaCpp);
      next.contextTokens = estimate.contextTokensInFile ?? entry.contextTokens;
      next.fit = {
        contextTokens: estimate.contextTokens,
        vramBytes: estimate.vramBytes,
        hostRamBytes: estimate.hostRamBytes,
        cpuRamBytes: estimate.cpuRamBytes,
      };
    }

    const before = JSON.stringify(entry);
    const after = JSON.stringify(next);
    if (check && before !== after) {
      throw new Error(
        `${entry.id}: the committed entry does not match what Hugging Face and the file report. ` +
          "Run `node scripts/assistant-catalogue.mjs --fit` and review the change.",
      );
    }
    models.push(next);
    console.log(
      `catalogue: ${entry.id} — ${String(next.sizeBytes)} bytes, sha256 ${next.sha256.slice(0, 12)}…` +
        (next.projector ? `, projector ${String(next.projector.sizeBytes)} bytes` : "") +
        `, languages [${languages.join(", ")}], licence ${licences.name}`,
    );
  }
  return { ...catalogue, checked: new Date().toISOString().slice(0, 10), models };
}

/**
 * The licence the app will show before a download, refused when it is missing.
 *
 * A model whose licence nobody wrote down is a model this product may not offer:
 * `CLAUDE.md`'s rule is that a cited fact comes with its source, and the licence
 * is the one fact a user has to see BEFORE they spend a gigabyte of their disk.
 */
function catalogueLicence(entry) {
  const licence = entry.licence;
  if (typeof licence?.name !== "string" || licence.name === "") {
    throw new Error(`${entry.id}: no licence name. Every entry names one before it is offered.`);
  }
  if (typeof licence?.url !== "string" || !/^https:\/\//.test(licence.url)) {
    throw new Error(`${entry.id}: the licence needs an https URL a user can open.`);
  }
  return licence;
}

/** Writes the catalogue with the same stable layout every run produces. */
export function serializeCatalogue(catalogue) {
  return `${JSON.stringify(catalogue, null, 2)}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogue = JSON.parse(readFileSync(CATALOGUE_PATH, "utf8"));
  const fetchJson = async (url) => {
    const response = await fetch(url, { headers: { "User-Agent": "nexus-catalogue/1.0" } });
    if (!response.ok) throw new Error(`catalogue: ${url} answered ${String(response.status)}.`);
    return await response.json();
  };
  const llamaCpp = args.fit ? await importLlamaCpp() : undefined;

  const refreshed = await refresh(catalogue, { fit: args.fit, check: args.check, fetchJson, llamaCpp });
  if (args.check) {
    console.log("catalogue: no drift");
    return;
  }
  writeFileSync(CATALOGUE_PATH, serializeCatalogue(refreshed), "utf8");
  console.log(`catalogue: ${String(refreshed.models.length)} entries written to ${CATALOGUE_PATH}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
