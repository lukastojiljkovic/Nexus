// The pack builder's one way out to the network: cached, rate-limited, and
// named after this project, which is what three of the four sources ask for.
//
// EVERY RESPONSE IS KEPT. A build that fails halfway is re-run by the person who
// ran it, and re-running it re-fetches nothing that already succeeded, so the
// museums are asked for the same bytes once rather than once per attempt. The
// cache lives under `%TEMP%` because it is a build artifact: a few hundred
// megabytes that nobody wants in the repository and nobody needs twice.
//
// THE PACE IS PER HOST AND IT IS DELIBERATE. The Met asks that its API not be
// hammered, Wikimedia's user-agent policy asks for a descriptive contact and a
// reasonable rate, and the Smithsonian's `DEMO_KEY` allows a handful of requests
// per hour on its own. One small delay between requests to the same host costs a
// build a minute and is the difference between a builder and a scraper.
//
// A 429 or a 503 is retried, and `Retry-After` is honoured when the server sends
// it, because a rate limiter that is told "come back in 30 seconds" and comes
// back in 300 milliseconds gets the build banned instead of slowed.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The User-Agent every request carries. Wikimedia's policy requires a
 * descriptive agent with a contact, and the Met and the Smithsonian both ask to
 * be told who is calling; a build that hides behind a browser string is the
 * build that gets blocked first and diagnoses it last.
 */
export const USER_AGENT =
  "NexusArtPack/1.0 (Nexus offline knowledge app; pack builder; https://github.com/lukastojiljkovic/Nexus)";

/**
 * The longest `Retry-After` this build will wait out, in seconds.
 *
 * It exists because of a number that was actually sent: the Smithsonian's demo
 * key answers HTTP 429 with `Retry-After: 71869` — nineteen hours — and a build
 * that honours that literally does not hang for a visible reason, it simply
 * stops. A server asking for longer than a minute is a server this run steps
 * past, and the reason it gives is recorded in `sources.json`.
 */
export const MAX_RETRY_AFTER_SECONDS = 60;

/**
 * The pace each host is asked at, in milliseconds between requests.
 *
 * One number per host rather than one for the build, because the hosts are not
 * alike: the Met answers at a few requests a second and starts refusing
 * altogether somewhere above that (the first full run of this pack met an
 * HTTP 403 after roughly 170 object requests and had to be paced properly), the
 * Wikimedia APIs want a descriptive agent and a modest rate, and WDQS has a
 * one-minute processing budget it counts against every client. A host not named
 * here gets the build's own default.
 */
export const HOST_INTERVALS = new Map([
  ["collectionapi.metmuseum.org", 600],
  ["images.metmuseum.org", 400],
  ["api.si.edu", 1200],
  ["data.rijksmuseum.nl", 400],
  ["id.rijksmuseum.nl", 250],
  ["query.wikidata.org", 2000],
  ["commons.wikimedia.org", 600],
  ["upload.wikimedia.org", 400],
]);

/**
 * How much a host's pace may be slowed by its own pushback, and how quickly
 * that extra comes back off.
 *
 * The cap is the load-bearing half. The first version of this added 1.5 s for
 * every 403 and never took any of it back, so three refusals became a request
 * every five seconds and the build stopped being slow for a reason anybody
 * could see. The decay is the other half: a host that has started answering has
 * stopped needing the extra, and a pace that only rises ends in the same place.
 */
export const MAX_HOST_BUMP_MS = 2400;
export const HOST_BUMP_STEP_MS = 800;
export const HOST_DECAY_STEP_MS = 200;

/**
 * Per-host request timeouts, in milliseconds. The default is thirty seconds,
 * which is generous for a museum's JSON API and NOT generous enough for WDQS:
 * the Query Service counts its own budget in tens of seconds for a query over a
 * whole collection, and the Serbian-and-Yugoslav one has been measured at 26.6 s
 * on this machine. A 30 s ceiling cut it off mid-query, and the run then
 * reported a source failure whose reason was Node's `ABORT_ERR` — the number 23,
 * which names neither the host nor the timeout.
 */
export const HOST_TIMEOUTS = new Map([["query.wikidata.org", 120_000]]);

/**
 * A source whose HOST cannot be reached at all.
 *
 * It is a type of its own because the build treats it differently from a bad
 * record: a bad record is one work left out, and an unreachable host is a
 * whole source left out, which the build reports and continues past rather than
 * failing the pack. The case this was written for is real — on 2026-10-10
 * `ids.si.edu` presented an EXPIRED TLS CERTIFICATE, so every Smithsonian image
 * was unfetchable while its metadata API answered normally.
 */
export class SourceUnavailableError extends Error {
  constructor(url, reason) {
    super(`source unreachable: ${url} (${reason})`);
    this.name = "SourceUnavailableError";
    this.url = url;
    this.reason = reason;
  }
}

/**
 * A source that answered badly, or did not answer inside the timeout, after
 * every retry. Kept apart from a programming error so the build can skip a
 * SOURCE without ever skipping a BUG: a gatherer that throws a `TypeError` must
 * stop the build, and one that cannot reach a museum must not.
 */
export class SourceFailedError extends Error {
  constructor(url, reason) {
    super(`source failed: ${url} (${reason})`);
    this.name = "SourceFailedError";
    this.url = url;
    this.reason = reason;
  }
}

/** The cache key of a URL: its SHA-256, which is also how the file is named. */
export function cacheKey(url) {
  return createHash("sha256").update(url, "utf8").digest("hex");
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * A cache directory plus the policy for filling it.
 *
 * `fetchImpl` and `sleep` are injected so the tests can drive the retry and the
 * cache-hit paths without a server and without the wait.
 */
export class CachedHttp {
  #dir;
  #fetch;
  #sleep;
  #minIntervalMs;
  #maxAttempts;
  #timeoutMs;
  #nextSlot = new Map();
  /** Extra spacing added to a host's interval after it has pushed back. */
  #bumped = new Map();
  stats = { fetched: 0, reused: 0, bytes: 0 };

  constructor({
    cacheDir,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    minIntervalMs = 150,
    maxAttempts = 4,
    timeoutMs = 30_000,
  }) {
    this.#dir = join(cacheDir, "http");
    mkdirSync(this.#dir, { recursive: true });
    this.#fetch = fetchImpl;
    this.#sleep = sleep;
    this.#minIntervalMs = minIntervalMs;
    this.#maxAttempts = maxAttempts;
    this.#timeoutMs = timeoutMs;
  }

  /** Wait until this host's own slot is free, then claim the next one. */
  async #pace(host) {
    const now = Date.now();
    const earliest = this.#nextSlot.get(host) ?? 0;
    const wait = Math.max(0, earliest - now);
    if (wait > 0) await this.#sleep(wait);
    const interval = (HOST_INTERVALS.get(host) ?? this.#minIntervalMs) + (this.#bumped.get(host) ?? 0);
    this.#nextSlot.set(host, Math.max(Date.now(), earliest) + interval);
  }

  /** A cached response, or `null` when this URL has never been fetched. */
  #fromCache(url) {
    const key = cacheKey(url);
    const metaPath = join(this.#dir, `${key}.json`);
    const bodyPath = join(this.#dir, `${key}.bin`);
    if (!existsSync(metaPath) || !existsSync(bodyPath)) return null;
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    const bytes = readFileSync(bodyPath);
    if (meta.url !== url || meta.sha256 !== cacheKey(bytes)) return null;
    return { bytes, meta, cached: true };
  }

  #toCache(url, bytes, contentType, status) {
    const key = cacheKey(url);
    writeFileSync(join(this.#dir, `${key}.bin`), bytes);
    const meta = {
      url,
      status,
      contentType,
      fetchedAt: new Date().toISOString(),
      bytes: bytes.byteLength,
      sha256: cacheKey(bytes),
    };
    writeFileSync(join(this.#dir, `${key}.json`), `${JSON.stringify(meta, null, 2)}\n`);
    return meta;
  }

  /**
   * One URL's bytes, from the cache when they are already there.
   *
   * A cached 404 is not a cache hit: a refusal is a property of the moment
   * (rate limiting, a bad deployment, a rotated id) and re-running the build is
   * exactly the act that should try again. So only a 2xx is stored.
   */
  async get(url, { accept = "*/*" } = {}) {
    const hit = this.#fromCache(url);
    if (hit !== null) {
      this.stats.reused += 1;
      return hit;
    }
    const host = new URL(url).host;
    let lastReason = "no attempt made";
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      await this.#pace(host);
      let response;
      try {
        // The signal is what keeps a connection that has gone quiet from
        // stopping the build for good: a museum's CDN that accepts a request and
        // then never answers is a failure like any other, and one this pack has
        // met (a Smithsonian host that held the socket open indefinitely).
        response = await this.#fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: accept },
          redirect: "follow",
          signal: AbortSignal.timeout(HOST_TIMEOUTS.get(host) ?? this.#timeoutMs),
        });
      } catch (error) {
        // An abort arrives as a `DOMException` whose code is the number 23, which
        // is why the reason is spelled out here rather than read off the error.
        const aborted = error?.name === "AbortError" || error?.code === 23 || error?.cause?.code === 23;
        const reason = aborted
          ? `no answer within ${String(HOST_TIMEOUTS.get(host) ?? this.#timeoutMs)} ms`
          : (error?.cause?.code ?? error?.code ?? error?.message ?? "fetch failed");
        // A certificate that has expired is not a transient failure and no
        // amount of retrying fixes it; it is reported as the source being down.
        if (String(reason).includes("CERT")) throw new SourceUnavailableError(url, String(reason));
        lastReason = String(reason);
        // A socket the far end closed mid-response and a gateway that timed the
        // query out are both "come back in a moment" rather than "this request is
        // wrong", and the pause is generous because the client that has just been
        // throttled is the client that gets throttled again for asking twice.
        await this.#sleep(3000 * attempt);
        continue;
      }
      // A 403 from a museum's edge is the same conversation as a 429: it means
      // "slower", and the answer is to slow down and then feel it come back off
      // as the host starts answering again.
      if (response.status === 403) {
        lastReason = "HTTP 403";
        this.#bumped.set(host, Math.min(MAX_HOST_BUMP_MS, (this.#bumped.get(host) ?? 0) + HOST_BUMP_STEP_MS));
        await this.#sleep(2000 * attempt);
        continue;
      }
      // 502/504 are the gateway saying the query took too long, which for WDQS is
      // a property of the moment rather than of the request: the same query has
      // answered in four seconds and timed out at the gateway an hour later.
      if (response.status === 429 || response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504) {
        const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
        lastReason = `HTTP ${String(response.status)}`;
        if (Number.isFinite(retryAfter) && retryAfter > MAX_RETRY_AFTER_SECONDS) {
          throw new SourceFailedError(url, `HTTP ${String(response.status)}, Retry-After ${String(retryAfter)} s`);
        }
        await this.#sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 5000 * attempt);
        continue;
      }
      if (!response.ok) throw new SourceFailedError(url, `HTTP ${String(response.status)}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const bump = this.#bumped.get(host) ?? 0;
      if (bump > 0) this.#bumped.set(host, Math.max(0, bump - HOST_DECAY_STEP_MS));
      const meta = this.#toCache(url, bytes, response.headers.get("content-type") ?? "", response.status);
      this.stats.fetched += 1;
      this.stats.bytes += bytes.byteLength;
      return { bytes, meta, cached: false };
    }
    throw new SourceFailedError(url, `gave up after ${String(this.#maxAttempts)} attempts: ${lastReason}`);
  }

  /**
   * The same call, parsed, and the request's own record beside it: every source
   * here answers JSON, and `sources.json` wants the URL, the date and the digest
   * of the bytes that were parsed rather than of a second fetch of them.
   */
  async json(url, options) {
    const { bytes, meta } = await this.get(url, options);
    return { json: JSON.parse(bytes.toString("utf8")), meta };
  }
}
