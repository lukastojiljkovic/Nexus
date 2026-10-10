// No shebang, for the reason the gates in `scripts/` have none: this module is
// imported by the two pack builders and by their tests, and a shebang on an
// `.mjs` is one more thing to strip.
//
// THE THREE THINGS EVERY PACK BUILDER NEEDS FROM THE OUTSIDE WORLD. A pack
// builder downloads somebody else's file, converts it, and writes a folder; the
// brief fixes where each of those happens so that a re-run is cheap and the
// repository stays clean:
//
//   * downloads land in `%TEMP%\nexus-pack-cache\<pack id>\` and are REUSED —
//     re-running a builder must cost seconds, not another 4.5 MB of somebody
//     else's bandwidth, and the file the second run converts has to be the same
//     bytes the first run hashed or `sources.json` stops describing the pack;
//   * the finished pack lands in `%TEMP%\nexus-packs\<pack id>\`, never in the
//     worktree, because a pack is signed later and no content may be committed;
//   * every download is hashed and the hash, the byte count and the fetch date
//     go into the pack's `sources.json`, so the pack is traceable to bytes.
//
// The downloader is deliberately not a general HTTP client. It does GET, it
// speaks to a fixed list of hosts the task names, and it backs off when a host
// asks it to — which Wikimedia's API does routinely, and a builder that ignored
// that would be the reason a whole wave of builders gets rate-limited.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * What the builders call themselves. Wikimedia's API policy asks for a
 * user agent that identifies the tool; without one it is entitled to answer 403
 * and, on some endpoints, does.
 */
export const USER_AGENT = "NexusPackBuilder/1.0 (+https://github.com/lukastojiljkovic/Nexus)";

/** `%TEMP%` as Node sees it. `TEMP` is Windows' own name for it and is set here. */
const TEMP = process.env.TEMP ?? tmpdir();

/** The two directories, named after the pack the brief fixes. */
export const cacheDir = (packId) => join(TEMP, "nexus-pack-cache", packId);
export const packsDir = (packId) => join(TEMP, "nexus-packs", packId);

/** The hash `pack.json` and `sources.json` are both written against. */
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long one pack builder waits between two requests to the same host. */
const DEFAULT_DELAY_MS = 200;

/**
 * A cached, polite downloader for one pack.
 *
 * `bytes(url, name)` returns the file's contents, downloading it into the cache
 * on the first call and reading it back on every later one. The returned record
 * carries `fromCache` so the build's own report can say what it actually
 * fetched — a builder that printed „fetched 4.5 MB" on a run that read
 * everything from disk would be lying about the one number the brief asks for.
 */
export function createSource(packId, { delayMs = DEFAULT_DELAY_MS } = {}) {
  const dir = cacheDir(packId);
  mkdirSync(dir, { recursive: true });

  /** The log the builder prints: one row per URL, cached or not. */
  const log = [];
  let lastRequestAt = 0;

  const request = async (url) => {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wait = lastRequestAt + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "identity" },
          redirect: "follow",
        });
        if (response.status === 429 || response.status >= 500) {
          // The host said „later", so wait — 1 s, then 2, 4, 8 — before trying
          // again. A 404 or a 403 is not retried: those are answers.
          await sleep(1000 * 2 ** attempt);
          lastError = new Error(`HTTP ${String(response.status)}`);
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${url}`);
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        lastError = error;
        await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(`get ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  };

  return {
    dir,
    log,
    /**
     * A polite GET with no cache of its own, for callers that cache something
     * larger than one URL — the recipes builder stores a whole API walk, or a
     * whole book, under one name and must not pay for it twice.
     */
    raw: (url) => request(url),
    /**
     * `name` is the cache file's name and is also what `sources.json` records,
     * so it must be stable across runs or the evidence stops matching the bytes.
     */
    async bytes(url, name) {
      const path = join(dir, name);
      const started = Date.now();
      const fromCache = existsSync(path);
      const buffer = fromCache ? readFileSync(path) : await request(url);
      if (!fromCache) writeFileSync(path, buffer);
      const row = {
        url,
        name,
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
        fromCache,
        ms: Date.now() - started,
      };
      log.push(row);
      return buffer;
    },
    async text(url, name) {
      return (await this.bytes(url, name)).toString("utf8");
    },
  };
}

/**
 * The download report the brief asks each builder to print: what it fetched,
 * how big, and how long the whole thing took. Nothing here is a number anybody
 * typed — every one of them is read off the bytes that were actually moved.
 */
export function printFetchLog(log, totalBytes) {
  console.log("fetched:");
  for (const row of log) {
    const how = row.fromCache ? "cache" : "net  ";
    console.log(
      `  ${how} ${String(row.bytes).padStart(9)} B  ${row.name}  ${row.url}`,
    );
  }
  const disk = log.reduce((sum, row) => sum + row.bytes, 0);
  console.log(`  sources: ${String(log.length)} (${String(disk)} B), pack: ${String(totalBytes)} B`);
}
