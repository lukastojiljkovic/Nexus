// The shared half of the translation-pack builders. `scripts/packs/<id>/build.mjs`
// holds one SPEC per pack and calls `buildPack` here — one implementation, six
// data files, so a rule fixed in one place is fixed in all of them.
//
// WHAT A TRANSLATION PACK IS. A signed folder (ADR-091) of kind `model` holding
// exactly three content files — `model.bin`, `shortlist.bin`, `vocab.spm` — plus
// the licence text and the NOTICE. It carries NO code: the WASM engine ships with
// the app (ADR-091 §9), and the pack is only Mozilla's model for one direction.
//
// WHERE THE FILES COME FROM, AND THE HASH RULE. Mozilla publishes each model as
// gzipped objects in one public bucket and describes them twice: `db/models.json`
// (the registry: the object path, the architecture, the evaluation, and the
// model file's `uncompressedHash`) and the Remote Settings `translations-models`
// collection (the delivery record: `attachment.size` and `attachment.hash` for
// every file, as the DECOMPRESSED bytes). The builder downloads each object,
// decompresses it, and refuses it unless its size and SHA-256 are exactly the
// ones the record states — and it cross-checks the two records against each other
// (the registry's `uncompressedHash` against the collection's model hash), which
// is what catches a pinned directory that no longer belongs to the pinned model
// version. A pinned hash that disagrees with the record is a build failure, never
// a shipped file.
//
// THE NOTICE AND THE LICENCE ARE CONTENT. `LICENSE.txt` is Mozilla's own MPL-2.0
// text, downloaded from the model repository and hash-checked; `NOTICE.txt` names
// every file with the name Mozilla publishes it under, its size and its SHA-256,
// so the pack can be audited without this script. The engine's MPL-2.0 obligation
// is the app's (it ships the engine); this pack's is its models'.
//
// CACHING. Everything is downloaded into `%TEMP%\nexus-pack-cache\<id>\` and
// reused, with the first fetch time kept in `index.json` — so a re-run is a
// verification pass, not a download, and `sources.json` (which is generated, not
// hand-kept) reproduces byte-identically. Nothing is written inside the
// repository.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

/** Mozilla's registry: what each model is, where its objects live, and how it scored. */
export const REGISTRY_URL =
  "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json";

/** Mozilla's delivery record: every file of every model with its size and SHA-256. */
export const RECORDS_URL =
  "https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records";

/** The object store the registry's paths are relative to. */
export const BUCKET_URL =
  "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/";

/** The model repository's own README, where Mozilla states the model licence. */
export const REPO_README_URL =
  "https://raw.githubusercontent.com/mozilla/translations/main/README.md";

/** The model repository's licence text — the copy of MPL-2.0 this pack ships. */
export const REPO_LICENCE_URL =
  "https://raw.githubusercontent.com/mozilla/translations/main/LICENSE";

/** Where the models came from, for the NOTICE and the pack's own `source`. */
export const REPO_URL = "https://github.com/mozilla/translations";

/** The licence every file in these packs is under, and the sentence Mozilla states it in. */
export const LICENCE_SPDX = "MPL-2.0";
export const LICENCE_EVIDENCE_QUOTE = "The model files are distributed under the MPL 2.0 license.";

/** The three names a pack's content files take, whatever Mozilla calls them. */
export const PACK_FILES = { model: "model.bin", shortlist: "shortlist.bin", vocab: "vocab.spm" };

/** What the app calls one of these packs. `minAppVersion` is the app version the ADR-091 scheme ships in. */
export const PACK_KIND = "model";
export const MIN_APP_VERSION = "1.5.0";

/** Where the downloads are cached, and where the built packs go. Both under `%TEMP%`. */
export function cacheRoot() {
  return process.env["NEXUS_PACK_CACHE"] ?? join(tmpdir(), "nexus-pack-cache");
}

export function outputRoot() {
  return process.env["NEXUS_PACK_OUT"] ?? join(tmpdir(), "nexus-packs");
}

/** One SHA-256, lower-case hex, the way every manifest in the repository spells it. */
export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The decompressed bytes of a gzip object, or a refusal naming the object. */
export function gunzip(bytes, label) {
  try {
    return gunzipSync(bytes);
  } catch (error) {
    throw new Error(
      `${label} is not a readable gzip object: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * A file as the registry's record describes it: Mozilla's own name for it, its
 * decompressed size, and its SHA-256.
 */
export function recordFile(records, { from, to, version, fileType }) {
  const found = records.find(
    (record) =>
      record.fromLang === from &&
      record.toLang === to &&
      record.version === version &&
      record.fileType === fileType,
  );
  if (found === undefined) {
    throw new Error(
      `the record has no ${fileType} file for ${from}->${to} version ${version}`,
    );
  }
  return { name: found.name, size: found.attachment.size, sha256: found.attachment.hash };
}

/** The registry entry for one pinned object directory, or a refusal naming the pair. */
export function registryEntry(registry, { pair, dir }) {
  const entries = registry.models?.[pair];
  if (!Array.isArray(entries)) throw new Error(`the registry knows no pair "${pair}"`);
  const found = entries.find((entry) => entry.files?.model?.path?.includes(`${dir}/`));
  if (found === undefined) {
    throw new Error(`the registry lists no "${pair}" model under ${dir}/`);
  }
  return found;
}

/**
 * The registry's `uncompressedHash` for the model file, checked against the
 * collection's hash for the same file.
 *
 * This is the one cross-check that a pinned directory and a pinned model version
 * describe the SAME build. Mozilla regenerates the registry and the collection
 * separately, and a pair can carry several builds at once (sr->en has a `tiny`
 * and, in the collection, two version labels): pinning a directory from one and a
 * version label from the other is how a pack ends up with the vocabulary of one
 * model and the weights of another.
 */
export function assertSameBuild(entry, modelRecord, pair) {
  const published = entry.files.model.uncompressedHash;
  if (published !== modelRecord.sha256) {
    throw new Error(
      `the registry's ${pair} model (${published}) is not the model the record ` +
        `gives for this version (${modelRecord.sha256})`,
    );
  }
  return { sha256: published, size: entry.files.model.uncompressedSize };
}

/** Refuses bytes whose size or SHA-256 is not what the record states. */
export function verifyContent({ label, expectedSize, expectedSha256, bytes }) {
  if (bytes.byteLength !== expectedSize) {
    throw new Error(`${label} is ${bytes.byteLength} bytes, the record states ${expectedSize}`);
  }
  const actual = sha256Hex(bytes);
  if (actual !== expectedSha256) {
    throw new Error(`${label} hashes to ${actual}, the record states ${expectedSha256}`);
  }
  return actual;
}

/** `bytes` as a path-safe file name: the cache stores the URL's last segment. */
function cacheName(url) {
  const name = url.split("/").pop() ?? "object";
  return name.replace(/[^A-Za-z0-9._-]/gu, "_");
}

/**
 * Reads one source, from the cache when it is already there and from the network
 * otherwise. The first fetch time is kept, so a re-run writes the same
 * `sources.json` — the file records when the bytes were FIRST read, which is the
 * date that matters for a source.
 */
export async function readSource(url, { dir, log }) {
  mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, "index.json");
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
  const known = index[url];
  const path = join(dir, known?.path ?? cacheName(url));
  if (known !== undefined && existsSync(path)) {
    const bytes = readFileSync(path);
    if (sha256Hex(bytes) === known.sha256) {
      log?.acquired?.(url, bytes.byteLength, true);
      return { bytes, fetchedAt: known.fetchedAt, sha256: known.sha256 };
    }
  }
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = sha256Hex(bytes);
  // The date is the FIRST fetch, and a re-fetch keeps it: a source's age is when
  // it was read, not when it was last checked.
  const fetchedAt = known?.fetchedAt ?? new Date().toISOString();
  writeFileSync(path, bytes);
  index[url] = { path: known?.path ?? cacheName(url), fetchedAt, sha256 };
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  log?.acquired?.(url, bytes.byteLength, false);
  return { bytes, fetchedAt, sha256 };
}

/**
 * The NOTICE a pack ships. Names every content file by the name Mozilla
 * publishes it under, with its version, its size and its SHA-256, and states the
 * licence and where the bytes came from.
 */
export function buildNotice({ spec, files, registry, fetchedAt }) {
  const rows = Object.entries(PACK_FILES).map(([role, packed]) => {
    const file = files[role];
    return `  ${packed.padEnd(13)} ${String(file.size).padStart(10)} bytes  sha256 ${file.sha256}\n` +
      `  ${" ".repeat(13)} Mozilla: ${file.name}` +
      (file.recordName === file.name ? "" : ` (delivered as ${file.recordName})`);
  });
  return [
    `Nexus translation pack ${spec.id}`,
    `${spec.fromName} (${spec.from}) to ${spec.toName} (${spec.to}) — Mozilla Firefox Translations`,
    `model, version ${spec.version}, architecture ${spec.architecture}.`,
    "",
    "This pack carries no code. The Bergamot translation engine ships with the app;",
    "this pack holds only the model for one direction.",
    "",
    "Content files, stored unmodified:",
    ...rows,
    "",
    `Mozilla publishes them at ${BUCKET_URL}${spec.dir}/`,
    "and describes them twice: db/models.json (the registry) and the Remote Settings",
    "translations-models collection (every file's size and SHA-256). Both records were",
    "read at build time and each file above was checked against them; the registry's",
    "record was also checked against the collection's, so the directory and the model",
    "version cannot describe two different builds.",
    "",
    `Licence: Mozilla Public License 2.0 (${LICENCE_SPDX}). The full text is in LICENSE.txt.`,
    `Mozilla states: "${LICENCE_EVIDENCE_QUOTE}"`,
    `  ${REPO_README_URL}`,
    `Source: ${REPO_URL}`,
    `Registry generated: ${registry.generated}`,
    `Built: ${fetchedAt} from a cache under %TEMP%.`,
    "",
  ].join("\n");
}

/** The metadata `scripts/pack-sign.mjs --meta` takes, without `files` (it computes those). */
export function packMeta(spec) {
  return {
    format: 1,
    id: spec.id,
    version: spec.packVersion,
    kind: PACK_KIND,
    title: spec.title,
    description: spec.description,
    licence: {
      spdx: LICENCE_SPDX,
      attribution: `Mozilla Firefox Translations model files (${spec.fromName}–${spec.toName}, version ${spec.version}). Models © Mozilla and contributors, ${LICENCE_SPDX}.`,
      url: REPO_URL,
    },
    source: { name: "mozilla/translations", url: REPO_URL },
    minAppVersion: MIN_APP_VERSION,
  };
}

/**
 * One source's row for `sources.json`: where it came from, when it was read, its
 * SHA-256 as shipped, its licence, and the licence EVIDENCE — the URL of the page
 * that states the licence plus the exact sentence on it, quoted.
 */
function sourceRow({ url, fetchedAt, sha256, licence, evidence, note }) {
  return {
    url,
    fetchedAt,
    sha256,
    licence,
    licenceEvidence: evidence,
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * Builds one pack: downloads and verifies, writes the folder and the metadata
 * file `pack-sign.mjs` takes, writes `sources.json` beside the builder, and
 * prints what it did.
 */
export async function buildPack(spec) {
  const started = Date.now();
  const log = { acquired: null };
  const dir = join(cacheRoot(), spec.id);
  const fetches = [];
  log.acquired = (url, bytes, reused) => {
    fetches.push({ url, bytes, reused });
    console.log(`  ${reused ? "cache" : "fetch"}  ${String(bytes).padStart(9)} bytes  ${url}`);
  };

  const registryDoc = await readSource(REGISTRY_URL, { dir, log });
  const recordsDoc = await readSource(RECORDS_URL, { dir, log });
  const readme = await readSource(REPO_README_URL, { dir, log });
  const licence = await readSource(REPO_LICENCE_URL, { dir, log });

  const registry = JSON.parse(registryDoc.bytes.toString("utf8"));
  const recordsPayload = JSON.parse(recordsDoc.bytes.toString("utf8"));
  const records = Array.isArray(recordsPayload) ? recordsPayload : recordsPayload.data;
  const readmeText = readme.bytes.toString("utf8");
  const licenceText = licence.bytes.toString("utf8");

  // The evidence sentence is checked, not trusted: a licence claim whose sentence
  // is no longer in the document it cites is a claim with no source.
  if (!readmeText.includes(LICENCE_EVIDENCE_QUOTE)) {
    throw new Error(`the model repository's README no longer states: "${LICENCE_EVIDENCE_QUOTE}"`);
  }
  if (!licenceText.includes("Mozilla Public License Version 2.0")) {
    throw new Error(`${REPO_LICENCE_URL} is not the MPL-2.0 text`);
  }

  const entry = registryEntry(registry, { pair: spec.pair, dir: spec.dir });
  const modelRecord = recordFile(records, {
    from: spec.from,
    to: spec.to,
    version: spec.version,
    fileType: "model",
  });
  assertSameBuild(entry, modelRecord, spec.pair);

  /**
   * The three files, and the two names each one legitimately has.
   *
   * `role` is the pack's own slot; `key` is the field in the registry entry and
   * the `fileType` in the collection; `path` is the object Mozilla publishes —
   * and the object's own name is what the pack ships, because it is the name the
   * bytes have. They are not always the same word: Bosnian's released build is
   * `models/hbs-en/…/model.hbsen.intgemm.alphas.bin.gz` in the bucket and a
   * `model.bsen.intgemm.alphas.bin` record in the collection, two names for one
   * file. The NOTICE carries both, and the hash check is what makes them one.
   */
  const roles = {
    model: { key: "model", fileType: "model" },
    shortlist: { key: "lexicalShortlist", fileType: "lex" },
    vocab: { key: "vocab", fileType: "vocab" },
  };
  const files = {};
  const sourceRows = [];
  for (const [role, { key, fileType }] of Object.entries(roles)) {
    const record =
      role === "model"
        ? modelRecord
        : recordFile(records, {
            from: spec.from,
            to: spec.to,
            version: spec.version,
            fileType,
          });
    const objectPath = entry.files[key]?.path;
    if (typeof objectPath !== "string") {
      throw new Error(`the registry's ${spec.pair} entry names no ${key} object`);
    }
    const name = (objectPath.split("/").pop() ?? "").replace(/\.gz$/u, "");
    const url = `${BUCKET_URL}${objectPath}`;
    const downloaded = await readSource(url, { dir, log });
    const bytes = gunzip(downloaded.bytes, name);
    const sha256 = verifyContent({
      label: name,
      expectedSize: record.size,
      expectedSha256: record.sha256,
      bytes,
    });
    files[role] = { name, recordName: record.name, size: record.size, sha256, bytes };
    sourceRows.push(
      sourceRow({
        url,
        fetchedAt: downloaded.fetchedAt,
        sha256,
        licence: LICENCE_SPDX,
        evidence: { url: REPO_README_URL, quote: LICENCE_EVIDENCE_QUOTE },
        note:
          `fetched gzipped (${downloaded.bytes.byteLength} bytes, sha256 ${downloaded.sha256}); ` +
          `stored as ${PACK_FILES[role]} after decompression, from the record's ${record.name}`,
      }),
    );
  }

  const packDir = join(outputRoot(), spec.id);
  mkdirSync(packDir, { recursive: true });
  for (const [role, packed] of Object.entries(PACK_FILES)) {
    writeFileSync(join(packDir, packed), files[role].bytes);
  }
  writeFileSync(join(packDir, "LICENSE.txt"), licenceText.replace(/\r\n/gu, "\n"), "utf8");
  writeFileSync(join(packDir, "NOTICE.txt"), buildNotice({ spec, files, registry, fetchedAt: spec.builtAt ?? new Date().toISOString() }), "utf8");

  const metaPath = join(outputRoot(), `${spec.id}.meta.json`);
  writeFileSync(metaPath, `${JSON.stringify(packMeta(spec), null, 2)}\n`, "utf8");

  const sourcesPath = join(dirname(spec.builderPath), "sources.json");
  writeFileSync(
    sourcesPath,
    `${JSON.stringify(
      [
        sourceRow({
          url: REGISTRY_URL,
          fetchedAt: registryDoc.fetchedAt,
          sha256: registryDoc.sha256,
          licence: LICENCE_SPDX,
          evidence: { url: REPO_README_URL, quote: LICENCE_EVIDENCE_QUOTE },
          note: `Mozilla's model registry; generated ${registry.generated}`,
        }),
        sourceRow({
          url: RECORDS_URL,
          fetchedAt: recordsDoc.fetchedAt,
          sha256: recordsDoc.sha256,
          licence: LICENCE_SPDX,
          evidence: { url: REPO_README_URL, quote: LICENCE_EVIDENCE_QUOTE },
          note: "the Remote Settings delivery records: every file's size and SHA-256",
        }),
        sourceRow({
          url: REPO_README_URL,
          fetchedAt: readme.fetchedAt,
          sha256: readme.sha256,
          licence: LICENCE_SPDX,
          evidence: { url: REPO_README_URL, quote: LICENCE_EVIDENCE_QUOTE },
          note: "the sentence above is quoted from this document",
        }),
        sourceRow({
          url: REPO_LICENCE_URL,
          fetchedAt: licence.fetchedAt,
          sha256: licence.sha256,
          licence: LICENCE_SPDX,
          evidence: { url: REPO_LICENCE_URL, quote: "Mozilla Public License Version 2.0" },
          note: "shipped unchanged as LICENSE.txt",
        }),
        ...sourceRows,
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );

  const total = Object.values(files).reduce((sum, file) => sum + file.size, 0);
  console.log(
    `${spec.id}: ${Object.keys(PACK_FILES).length} content files, ${total} bytes, ` +
      `${licence.bytes.byteLength} bytes of licence, in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  console.log(`  pack     ${packDir}`);
  console.log(`  metadata ${metaPath}`);
  console.log(`  sources  ${sourcesPath}`);
  return { packDir, metaPath, sourcesPath, total };
}
