// The half the two tool-pack builders share (ADR-094).
//
// Each builder is a pipeline over one or two publisher archives: download into a
// cache, check the SHA-256 the publisher states, unpack some entries into a pack
// folder, write the metadata file `scripts/pack-sign.mjs` takes, and print what
// it fetched, how big the result is and how long it took. The part that is about
// a ZIP or about GPL text belongs to the builder; everything about files, digests
// and paths is here, once, because two copies of "where does the cache live" is
// two different answers within a month.
//
// WHAT THIS NEVER DOES. It never fetches anything in a test: `ensureCached`
// takes its `fetchImpl`, and the tests hand it a fixture on disk instead. It also
// never signs: the metadata it writes is what `pack-sign.mjs` is pointed at with
// the maintainer's key, and no key is read, written or known by anything here.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** `%TEMP%\nexus-pack-cache\<id>` on Windows, and the same shape under `/tmp` elsewhere. */
export const CACHE_ROOT = join(tmpdir(), "nexus-pack-cache");
/** `%TEMP%\nexus-packs\<id>`: the finished folder, and `<id>.meta.json` beside it. */
export const PACKS_OUT_ROOT = join(tmpdir(), "nexus-packs");

export function cacheDirFor(id) {
  return join(CACHE_ROOT, id);
}

export function packOutDirFor(id) {
  return join(PACKS_OUT_ROOT, id);
}

/** The metadata file `pack-sign.mjs` takes, beside the folder rather than inside it. */
export function metaFileFor(id) {
  return join(PACKS_OUT_ROOT, `${id}.meta.json`);
}

/** Lower-case hex SHA-256 of a buffer. */
export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A file's SHA-256, read in a stream.
 *
 * Streamed rather than read whole because the archives this checks are tens of
 * megabytes and the digest is the one thing standing between a publisher's
 * release and a pack, so it is computed the same way for every builder.
 */
export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** A digest that is not the publisher's, with the size and the two hashes in the message. */
export function verifyDigest(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `pack-build: ${label} has SHA-256 ${actual}; the publisher's checksum is ${expected}. The file is not the release it claims to be.`,
    );
  }
}

/**
 * The source, in the cache: downloaded once, verified every time.
 *
 * A partial download never becomes the cache entry: it is written as `<file>.part`
 * and renamed, so an interrupted run leaves the cache with either the good file
 * or nothing. Re-running a builder reuses what is here, which is the point — the
 * alternative is eighty megabytes over somebody's connection per attempt.
 */
export async function ensureCached(input) {
  const target = join(input.cacheDir, input.file);
  await mkdir(input.cacheDir, { recursive: true });
  let fetched = false;
  try {
    await stat(target);
  } catch {
    fetched = true;
    const response = await input.fetchImpl(input.url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`pack-build: ${input.url} answered ${String(response.status)} ${response.statusText}.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    validateRelativePath(input.file);
    await rm(target, { force: true });
    const partial = `${target}.part`;
    await writeFile(partial, bytes);
    await rename(partial, target);
    input.log?.(`fetched ${input.url} (${formatBytes(bytes.byteLength)})`);
  }
  const digest = await sha256File(target);
  verifyDigest(digest, input.sha256, input.file);
  const size = (await stat(target)).size;
  return { path: target, bytes: size, sha256: digest, fetched };
}

/**
 * A pack-relative path, or a refusal.
 *
 * The same rules the app applies to a manifest's paths (`packs/paths.ts`), kept
 * here in the shorter form a builder needs: a builder writes these files itself,
 * and the one place a name can come from outside is an archive's own entry name,
 * which is exactly why the check is not skipped.
 */
export function validateRelativePath(path) {
  if (typeof path !== "string" || path === "") throw new Error("pack-build: a pack path must be a non-empty string.");
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`pack-build: "${path}" is absolute; a pack path is relative.`);
  }
  if (path.includes("\\")) throw new Error(`pack-build: "${path}" uses a backslash; a pack path uses "/".`);
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`pack-build: "${path}" is not a usable pack path.`);
    }
  }
  return path;
}

/**
 * Writes the pack folder: every file, in the order given, with its directories.
 *
 * The folder is removed first, so a rebuilt pack never carries a file the new
 * build does not mention — a stale binary beside a fresh manifest is the one
 * mistake a pack builder can make that nothing downstream catches.
 */
export async function writePackFiles(input) {
  await rm(input.dir, { recursive: true, force: true });
  const written = [];
  for (const file of input.files) {
    validateRelativePath(file.path);
    const target = join(input.dir, ...file.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
    written.push({ path: file.path, size: Buffer.byteLength(file.bytes) });
    input.log?.(`  ${file.path} (${formatBytes(Buffer.byteLength(file.bytes))})`);
  }
  return written;
}

/** The metadata `pack-sign.mjs` takes: the same object, as the JSON it reads. */
export async function writeMetaFile(path, meta) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

/** Reads a builder's own `sources.json`, as an object. */
export async function readSources(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`pack-build: ${path} must be a JSON object.`);
  }
  return parsed;
}

/** The one line a builder prints at the end, and the numbers it prints are the ones it measured. */
export function formatReport(input) {
  const seconds = (input.elapsedMs / 1000).toFixed(1);
  return `pack-build: ${input.id} -> ${input.dir} (${String(input.fileCount)} files, ${formatBytes(input.totalBytes)}, ${seconds}s)`;
}

/** Bytes in the units a person reads, with one decimal unlike the app's own formatter. */
export function formatBytes(bytes) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
