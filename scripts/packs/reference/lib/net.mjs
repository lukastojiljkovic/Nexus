// The builder's only door to the network, and it is a cache.
//
// WHY A CACHE IS NOT AN OPTIMISATION HERE. A pack is rebuilt after every
// document it carries is re-verified against its source, and a build that
// re-downloads four megabytes of Wikisource and two of EUR-Lex on every run is
// a build nobody re-runs. The cache also answers the question a licence review
// asks — "which bytes did this pack actually come from, and when" — with a file
// on disk rather than a log somebody has to be trusted about.
//
// WHAT IT IS NOT. It is not a download service and nothing in the application
// reads it: the app has no network path at all while cloud is off (ADR-089), and
// this module runs only on the maintainer's machine, only when a pack is built.
// That is why it fetches with Node's own TLS stack and why the sandbox note in
// this wave's brief is satisfied by construction.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where an unpacked, unsigned pack is written. Never inside the repository. */
export function packOutputDir() {
  return join(tmpdir(), "nexus-packs");
}

/** Where a pack's fetched sources are kept between builds. */
export function packCacheDir(packId) {
  return join(tmpdir(), "nexus-pack-cache", packId);
}

/** The browser-shaped user agent Wikimedia requires and other hosts prefer. */
export const FETCH_AGENT =
  "NexusReferencePackBuilder/1.0 (offline content pack; contact: maintainer@example.org)";

function safeName(url) {
  const withoutQuery = url.split("?")[0].split("#")[0];
  const last = withoutQuery.split("/").filter((part) => part.length > 0).pop() ?? "index";
  return last.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
}

/** A cache key that is stable across machines and renames nothing. */
function cacheKey(url, accept) {
  return `${createHash("sha256").update(`${url}\n${accept ?? ""}`).digest("hex").slice(0, 16)}-${safeName(url)}`;
}

/**
 * One fetched source: the bytes, the SHA-256 a licence review will check, and
 * the date they were taken.
 *
 * `refresh` re-fetches even when the cache holds the same URL, which is how a
 * maintainer updates a source that has changed under a stable address — the
 * stale copy is overwritten only after the new bytes arrive, so a failed refresh
 * leaves the pack buildable from what is already on disk.
 */
export async function fetchSource(url, { packId, accept, refresh = false } = {}) {
  const directory = packCacheDir(packId);
  mkdirSync(directory, { recursive: true });
  const key = cacheKey(url, accept);
  const bodyPath = join(directory, `${key}.bin`);
  const metaPath = join(directory, `${key}.json`);

  if (!refresh && existsSync(bodyPath) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    const bytes = readFileSync(bodyPath);
    return {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      fetched: meta.fetched,
      url: meta.url,
      fromCache: true,
    };
  }

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": FETCH_AGENT,
      accept: accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en;q=0.9,sr;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${String(response.status)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const meta = {
    url,
    accept: accept ?? null,
    fetched: new Date().toISOString().slice(0, 10),
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    finalUrl: response.url,
  };
  writeFileSync(bodyPath, bytes);
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  return { bytes, sha256: meta.sha256, fetched: meta.fetched, url, fromCache: false };
}
