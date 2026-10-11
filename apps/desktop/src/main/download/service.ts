import { createHash, type Hash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { open, rename, statfs, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import { modeAllowsDownloads, type NetworkMode } from "../net/offline.js";

/**
 * THE DOWNLOAD SERVICE (ADR-092), AND WHAT IT GUARANTEES.
 *
 * Nexus downloads content packs — an offline Wikipedia, a map — so a user who
 * chose the third network mode can fill the app from inside it. Everything this
 * file does exists because the bytes arrive from somewhere the app does not
 * control, and every guarantee below is enforced here rather than promised in
 * copy:
 *
 *   1. **It runs only in `"downloads"`.** Every entry point asks `deps.mode()`
 *      first and refuses with `"mode"` in the other two, so a caller that
 *      somehow reached this module in „Offline only" gets no request, not a
 *      request and an apology.
 *   2. **Only allowlisted https URLs are requested, on every hop.** The caller
 *      passes the rule (`deps.isAllowedUrl`, `isSessionRequestAllowed` in main)
 *      and this service consults it before each request AND before following a
 *      `Location`, so a redirect into a foreign host is refused mid-chain with
 *      nothing sent to that host.
 *   3. **No download without an expected hash.** A request whose
 *      `expectedSha256` is not a SHA-256 is refused with `"hash-required"`; the
 *      digest is computed WHILE the file is written and compared with that
 *      hash before the file is handed over. A mismatch refuses and deletes.
 *   4. **A size limit the caller sets.** A declared length over the cap is
 *      refused before the body is read, and the running total is checked on
 *      every chunk, because a declared length is a number a server can get
 *      wrong.
 *   5. **Space is checked before a byte is asked for.** The bound is the
 *      caller's limit — the most this download may ever store — because the
 *      reply's own size is not known until it arrives.
 *   6. **Nothing partial ever survives a failure**, except a PAUSED download,
 *      whose staging file is exactly the resume point. A finished file is
 *      renamed to its final name and handed back by path; every other ending
 *      removes the staging file.
 *   7. **At most two at once**, counted over downloads actually in flight.
 *
 * RESUME IS HTTP RANGE, AND IT RESTARTS CLEANLY WHEN THAT CANNOT BE USED. A
 * paused download keeps its file, its byte count, its hash state and the
 * reply's validator; a resume asks for `Range: bytes=<n>-` with `If-Range`
 * naming that validator. A `200`, a `416`, a `Content-Range` that does not
 * start where this process stopped, or a validator that changed all mean the
 * same thing — the partial file cannot be appended to — so the file is
 * truncated and the whole body is written again. The hash is restarted with it,
 * because a hash of two different replies would be a hash of nothing.
 *
 * Like `update/service.ts`, this module imports no Electron and touches no
 * session: the transport, the free-space reading and the mode arrive as
 * functions, which is what makes the interesting half testable against a local
 * server. Main builds it with `createDownloadHttp` (`download/electron.ts`),
 * which fetches on the dedicated session so the launch's resolver rule applies.
 */

/** How many downloads may be in flight at once. A third is refused with `"busy"`. */
export const MAX_ACTIVE_DOWNLOADS = 2;

/** Redirect hops followed before a chain is refused. */
const MAX_REDIRECTS = 5;

/**
 * How much of a reply body nobody wants — a redirect's, a `416`'s — is read and
 * dropped before the reader is closed. Bounded, because a hostile server can
 * answer a redirect with any body it likes, and that body is not the file.
 */
const DISCARDED_BODY_LIMIT = 64 * 1024;

/** A caller's name for a download, and the staging file's stem. Letters, digits, `_` and `-` only. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** The sub-directory of `userData` every staging file lives in. */
const STAGING_DIR = "downloads";

/**
 * Where a job's staging file lives.
 *
 * `.part` while it is incomplete — a paused download keeps this exact path, and
 * that is what a resume appends to — and the bare id once it is verified, so a
 * directory listing says which files are finished. Exported because a caller
 * that wants to clean up, or show what is on disk, should not be re-deriving a
 * path that this module owns.
 */
export function downloadStagingPath(userData: string, id: string): string {
  return join(userData, STAGING_DIR, `${id}.part`);
}

/**
 * Free bytes on the volume `dir` is on.
 *
 * `bavail` rather than `bfree`: the blocks a privileged process may still take
 * are not blocks this download can have.
 */
export async function freeSpaceBytes(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

/**
 * Why a download was refused. Machine codes, never prose: the caller maps each
 * to its own sentence, exactly as `UpdateProblem` is mapped.
 */
export type DownloadProblem =
  /** This launch is not running in „downloads". */
  | "mode"
  /** The request itself is malformed — an id that is not an id, a limit that is not a size. */
  | "request"
  /** No expected SHA-256 was passed, or the one that was is not one. */
  | "hash-required"
  /** The URL, or a redirect hop, is not an allowed https host. Nothing was sent to it. */
  | "url"
  /** Two downloads are already in flight, or that id is already in use. */
  | "busy"
  /** `resume` was asked for a download that is not paused and known. */
  | "not-found"
  /** The volume cannot hold what this download may need. */
  | "no-space"
  /** The reply is, or grew, larger than the caller's limit. */
  | "size-limit"
  /** The transport failed, or the server answered something this download cannot use. */
  | "network"
  /** A file could not be written, renamed or measured. */
  | "io"
  /** The bytes did not match the expected SHA-256. */
  | "hash";

/** What a caller asks for. The hash is not optional, and neither is the limit. */
export interface DownloadRequest {
  /** The caller's name for this download. Matches `ID_PATTERN`; also the staging file's stem. */
  readonly id: string;
  readonly url: string;
  /** Hex SHA-256 the finished file must have, from the signed manifest that named the URL. */
  readonly expectedSha256: string;
  /** The most this download may store, in bytes. Declared length and real body are both held to it. */
  readonly sizeLimitBytes: number;
}

/**
 * How a download ended. `"paused"` is not a failure: it says the staging file
 * was kept and `resume` can continue it.
 */
export type DownloadOutcome =
  | {
      readonly outcome: "done";
      readonly id: string;
      /** The verified file. The id without the `.part` suffix, in the staging directory. */
      readonly path: string;
      readonly bytes: number;
      readonly sha256: string;
    }
  | {
      readonly outcome: "paused";
      readonly id: string;
      /** The staging file the resume will append to. */
      readonly path: string;
      readonly bytes: number;
    }
  | { readonly outcome: "cancelled"; readonly id: string }
  | { readonly outcome: "refused"; readonly id: string; readonly problem: DownloadProblem };

/** One progress event, emitted when a download starts and after every chunk written. */
export interface DownloadProgress {
  readonly id: string;
  /** Bytes in the staging file, including the part a pause kept. */
  readonly receivedBytes: number;
  /** What the reply declared, or `null` when it declared nothing. */
  readonly totalBytes: number | null;
}

export interface DownloadResponse {
  readonly status: number;
  /** A header by its LOWER-CASE name, or `null`. The port owns case-insensitivity. */
  header(name: string): string | null;
  readonly body: AsyncIterable<Uint8Array> | null;
}

/**
 * The transport, as a port — `UpdateHttp`'s counterpart.
 *
 * `request` MUST NOT FOLLOW REDIRECTS: it answers the `3xx` it was given,
 * headers and all, so THIS module is what decides whether the next hop is
 * allowed. A port that followed them would leave the hop rule to the caller's
 * session and this service would be testing it (and reporting `"url"`) on a
 * code path production never took.
 */
export interface DownloadHttp {
  request(
    url: string,
    init: {
      readonly headers: Readonly<Record<string, string>>;
      readonly signal: AbortSignal;
    },
  ): Promise<DownloadResponse>;
}

export interface DownloadServiceDeps {
  readonly userData: string;
  /** The mode this launch may ACT on — `activeNetworkMode` in main, never the stored file. */
  readonly mode: () => NetworkMode;
  /** `isSessionRequestAllowed(..., "downloads")` in main: https only, exact allowlisted hosts. */
  readonly isAllowedUrl: (url: string) => boolean;
  readonly http: DownloadHttp;
  /** `freeSpaceBytes` in main. Injected so „the disk is full" is a testable state. */
  readonly freeSpaceBytes: (dir: string) => Promise<number>;
  readonly onProgress: (progress: DownloadProgress) => void;
}

export interface DownloadService {
  /**
   * Begins a download and answers when it reaches a terminal state. Never
   * throws: every refusal is an outcome, so a caller cannot lose the reason.
   */
  start(request: DownloadRequest): Promise<DownloadOutcome>;
  /** Continues a paused download, with an HTTP Range request. Refuses `"not-found"` when there is none. */
  resume(id: string): Promise<DownloadOutcome>;
  /** Asks a running download to stop and KEEP the staging file. A no-op for anything else. */
  pause(id: string): void;
  /** Stops a download and deletes its staging file; a paused one is deleted here and now. */
  cancel(id: string): Promise<void>;
}

/** Internal: raised from inside the transfer loop, where a return value would have to unwind a `for await`. */
class DownloadRefusal extends Error {
  readonly problem: DownloadProblem;

  constructor(problem: DownloadProblem) {
    super(problem);
    this.problem = problem;
  }
}

/**
 * A download in flight, or paused. Kept in a map only while it is one of those
 * two — a finished, failed or cancelled job is forgotten, so its id frees up.
 */
interface Job {
  readonly id: string;
  readonly url: string;
  readonly expectedSha256: string;
  readonly sizeLimitBytes: number;
  readonly staging: string;
  /** Settles the promise `start` or `resume` handed the caller. Replaced by a resume. */
  settle: (outcome: DownloadOutcome) => void;
  status: "running" | "paused" | "cancelled";
  /** Bytes written to the staging file, across every attempt of this job. */
  received: number;
  /** The size the last reply declared, or `null`. */
  total: number | null;
  /** `ETag` or `Last-Modified`, kept so a resume can tell a changed file from the same one. */
  validator: string | null;
  /** Salted per attempt: a restart rewrites the file from zero and hashes it from zero too. */
  hash: Hash;
  /** Aborted by `pause` and by `cancel`. Replaced by a resume. */
  controller: AbortController;
}

type AttemptResult =
  | { readonly kind: "done"; readonly path: string; readonly sha256: string; readonly bytes: number }
  | { readonly kind: "paused" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "problem"; readonly problem: DownloadProblem }
  /** The partial file was reset; ask again, this time without a Range. */
  | { readonly kind: "retry" };

type TerminalResult = Exclude<AttemptResult, { readonly kind: "retry" }>;

interface ContentRange {
  readonly start: number;
  readonly total: number | null;
}

export function createDownloadService(deps: DownloadServiceDeps): DownloadService {
  const jobs = new Map<string, Job>();

  function runningCount(): number {
    let count = 0;
    for (const job of jobs.values()) if (job.status === "running") count += 1;
    return count;
  }

  function refused(id: string, problem: DownloadProblem): DownloadOutcome {
    return { outcome: "refused", id, problem };
  }

  function progress(job: Job): void {
    deps.onProgress({ id: job.id, receivedBytes: job.received, totalBytes: job.total });
  }

  async function removeStaging(job: Job): Promise<void> {
    try {
      await unlink(job.staging);
    } catch {
      // Best effort: the failure that is being reported is the finding, and a
      // delete that itself failed must not replace it with an unrelated one.
    }
  }

  /** Answers the caller's promise and, unless the job is paused, forgets the job. */
  function deliver(job: Job, outcome: DownloadOutcome, forget: boolean): DownloadOutcome {
    if (forget) jobs.delete(job.id);
    job.settle(outcome);
    return outcome;
  }

  function pausedOutcome(job: Job): DownloadOutcome {
    return { outcome: "paused", id: job.id, path: job.staging, bytes: job.received };
  }

  function cancelledOutcome(job: Job): DownloadOutcome {
    return { outcome: "cancelled", id: job.id };
  }

  /**
   * The one way a download ends badly. It reads the job's status first because
   * a pause or a cancel ABORTS the transfer, and the abort surfaces as an error
   * like any other: the user's action is the reason, so it is what is reported.
   */
  async function abandon(job: Job, problem: DownloadProblem): Promise<DownloadOutcome> {
    if (job.status === "paused") return deliver(job, pausedOutcome(job), false);
    if (job.status === "cancelled") {
      await removeStaging(job);
      return deliver(job, cancelledOutcome(job), true);
    }
    await removeStaging(job);
    return deliver(job, refused(job.id, problem), true);
  }

  async function finish(job: Job, result: TerminalResult): Promise<DownloadOutcome> {
    switch (result.kind) {
      case "done":
        return deliver(
          job,
          {
            outcome: "done",
            id: job.id,
            path: result.path,
            bytes: result.bytes,
            sha256: result.sha256,
          },
          true,
        );
      case "paused":
        return deliver(job, pausedOutcome(job), false);
      case "cancelled":
        await removeStaging(job);
        return deliver(job, cancelledOutcome(job), true);
      case "problem":
        return await abandon(job, result.problem);
    }
  }

  /**
   * Resolves the redirect chain and performs one attempt, then answers. The
   * outer loop exists for the single case where the attempt cannot use the
   * partial file it found and has already reset it — see `attempt`.
   */
  async function transfer(job: Job): Promise<DownloadOutcome> {
    try {
      let url = job.url;
      let restarted = false;
      for (;;) {
        let response: DownloadResponse | null = null;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
          // The allowlist is consulted BEFORE every request, which is what makes
          // the check a property of the request rather than of the first URL.
          if (!deps.isAllowedUrl(url)) return await finish(job, { kind: "problem", problem: "url" });
          const reply = await deps.http.request(url, {
            headers: requestHeaders(job),
            signal: job.controller.signal,
          });
          if (!isRedirect(reply.status)) {
            response = reply;
            break;
          }
          const location = reply.header("location");
          const target = location === null ? null : resolveLocation(location, url);
          if (target === null || !deps.isAllowedUrl(target)) {
            await discardBody(reply.body);
            return await finish(job, { kind: "problem", problem: "url" });
          }
          await discardBody(reply.body);
          url = target;
        }
        if (response === null) {
          return await finish(job, { kind: "problem", problem: "network" });
        }

        const result = await attempt(job, response);
        if (result.kind !== "retry") return await finish(job, result);
        if (restarted) {
          // The second attempt produced the same unusable reply; asking a third
          // time would be a loop a hostile server could hold open for ever.
          return await finish(job, { kind: "problem", problem: "network" });
        }
        restarted = true;
        url = job.url;
      }
    } catch (error) {
      return await abandon(job, error instanceof DownloadRefusal ? error.problem : "network");
    }
  }

  /**
   * One reply, from the range decision to the rename.
   *
   * Every branch that cannot append to what is already on disk — a `200` where a
   * pause left bytes behind, a `416`, a `206` whose `Content-Range` does not
   * start where this process stopped, a validator that changed under an
   * `If-Range` the server ignored — resets the partial and answers `"retry"`,
   * so the file is truncated and hashed from zero rather than continued from a
   * boundary nobody promised.
   */
  async function attempt(job: Job, response: DownloadResponse): Promise<AttemptResult> {
    const resuming = job.received > 0;
    let from: number;

    if (response.status === 206 && resuming) {
      const range = parseContentRange(response.header("content-range"));
      const validator = validatorOf(response);
      const changed = job.validator !== null && validator !== null && validator !== job.validator;
      if (range === null || range.start !== job.received || changed) {
        await discardBody(response.body);
        resetPartial(job);
        return { kind: "retry" };
      }
      from = job.received;
      job.total = range.total;
      job.validator = validator ?? job.validator;
    } else if (response.status === 200) {
      if (resuming) resetPartial(job);
      from = 0;
      job.total = declaredLength(response);
      job.validator = validatorOf(response);
    } else if (response.status === 416 && resuming) {
      // The range is not satisfiable any more: the file moved under us, or the
      // server has stopped offering ranges. Start over from nothing.
      await discardBody(response.body);
      resetPartial(job);
      return { kind: "retry" };
    } else {
      await discardBody(response.body);
      return { kind: "problem", problem: "network" };
    }

    const body = response.body;
    if (body === null) return { kind: "problem", problem: "network" };
    if (job.total !== null && job.total > job.sizeLimitBytes) {
      await discardBody(body);
      return { kind: "problem", problem: "size-limit" };
    }

    let handle: FileHandle;
    try {
      mkdirSync(dirname(job.staging), { recursive: true });
      handle = await open(job.staging, from === 0 ? "w" : "r+");
      const stats = await handle.stat();
      // The file is opened `r+` rather than appended to, so the write offsets are
      // the byte count: a staging file whose length is not that count is a file
      // this process did not leave, and appending to it would hash a stranger.
      if (!stats.isFile() || stats.size !== from) {
        await closeQuietly(handle);
        return { kind: "problem", problem: "io" };
      }
    } catch {
      return { kind: "problem", problem: "io" };
    }

    progress(job);
    let overLimit = false;
    try {
      for await (const chunk of body) {
        if (job.status !== "running") break;
        if (job.received + chunk.byteLength > job.sizeLimitBytes) {
          overLimit = true;
          break;
        }
        await writeChunk(handle, job, chunk);
        progress(job);
      }
    } catch (error) {
      await closeQuietly(handle);
      if (job.status === "paused") return { kind: "paused" };
      if (job.status === "cancelled") return { kind: "cancelled" };
      if (error instanceof DownloadRefusal) return { kind: "problem", problem: error.problem };
      return { kind: "problem", problem: "network" };
    }
    await closeQuietly(handle);

    if (overLimit) {
      // The declared length lied, or there was none. The reader was cancelled by
      // the `break`, so nothing more is on its way.
      return { kind: "problem", problem: "size-limit" };
    }
    if (job.status === "paused") return { kind: "paused" };
    if (job.status === "cancelled") return { kind: "cancelled" };

    const digest = job.hash.digest("hex");
    if (digest !== job.expectedSha256) return { kind: "problem", problem: "hash" };
    // The staging file becomes the verified file here and nowhere else: a name
    // without `.part` is a file this service has hashed.
    const finalPath = join(dirname(job.staging), job.id);
    try {
      await rename(job.staging, finalPath);
    } catch {
      return { kind: "problem", problem: "io" };
    }
    return { kind: "done", path: finalPath, sha256: digest, bytes: job.received };
  }

  /**
   * The pre-flight, and the whole of it: make the staging directory, read the
   * free space, then transfer.
   *
   * A space check that could not be PERFORMED is not a space check that passed,
   * so a failed reading answers `"io"` rather than letting the download run and
   * discover the disk on its own.
   */
  async function run(job: Job): Promise<DownloadOutcome> {
    try {
      mkdirSync(dirname(job.staging), { recursive: true });
    } catch {
      return await abandon(job, "io");
    }
    let free: number;
    try {
      free = await deps.freeSpaceBytes(dirname(job.staging));
    } catch {
      return await abandon(job, "io");
    }
    if (free < job.sizeLimitBytes - job.received) {
      return await abandon(job, "no-space");
    }
    // A pause or a cancel can land during the checks above; the transfer must
    // not start for a job the user has already stopped.
    if (job.status !== "running") return await abandon(job, "network");
    return await transfer(job);
  }

  /** Settles the caller's promise, then runs. Order matters: `run` may answer at once. */
  function launch(job: Job): Promise<DownloadOutcome> {
    const promise = new Promise<DownloadOutcome>((resolve) => {
      job.settle = resolve;
    });
    void run(job).catch(() => {
      // No path in `run` is expected to throw — each one answers — but a bug
      // must not leave the caller's promise pending for the life of the app,
      // nor a staging file from a job nobody is holding.
      void abandon(job, "io");
    });
    return promise;
  }

  return {
    async start(request: DownloadRequest): Promise<DownloadOutcome> {
      const id = request.id;
      // The mode first, so the refusal a caller gets in „Offline only" is about
      // the mode rather than about anything else it might also have got wrong.
      if (!modeAllowsDownloads(deps.mode())) return refused(id, "mode");
      if (
        !ID_PATTERN.test(id) ||
        !Number.isSafeInteger(request.sizeLimitBytes) ||
        request.sizeLimitBytes <= 0
      ) {
        return refused(id, "request");
      }
      const expectedSha256 = request.expectedSha256.toLowerCase();
      if (!SHA256_PATTERN.test(expectedSha256)) return refused(id, "hash-required");
      if (!deps.isAllowedUrl(request.url)) return refused(id, "url");
      if (jobs.has(id) || runningCount() >= MAX_ACTIVE_DOWNLOADS) return refused(id, "busy");

      const job: Job = {
        id,
        url: request.url,
        expectedSha256,
        sizeLimitBytes: request.sizeLimitBytes,
        staging: downloadStagingPath(deps.userData, id),
        settle: () => undefined,
        status: "running",
        received: 0,
        total: null,
        validator: null,
        hash: createHash("sha256"),
        controller: new AbortController(),
      };
      jobs.set(id, job);
      return launch(job);
    },

    async resume(id: string): Promise<DownloadOutcome> {
      const job = jobs.get(id);
      if (job === undefined || job.status !== "paused") return refused(id, "not-found");
      if (!modeAllowsDownloads(deps.mode())) return refused(id, "mode");
      if (runningCount() >= MAX_ACTIVE_DOWNLOADS) return refused(id, "busy");
      job.status = "running";
      job.controller = new AbortController();
      return launch(job);
    },

    pause(id: string): void {
      const job = jobs.get(id);
      if (job === undefined || job.status !== "running") return;
      job.status = "paused";
      job.controller.abort();
    },

    async cancel(id: string): Promise<void> {
      const job = jobs.get(id);
      if (job === undefined) return;
      if (job.status === "paused") {
        // Nothing is in flight to unwind, so the file goes here and the job is
        // forgotten; a running job's file is removed on the way out of `finish`.
        jobs.delete(id);
        await removeStaging(job);
        return;
      }
      job.status = "cancelled";
      job.controller.abort();
    },
  };
}

/** The headers of one attempt: a Range from where a pause stopped, and `If-Range` to make it conditional. */
function requestHeaders(job: Job): Record<string, string> {
  if (job.received === 0) return {};
  const headers: Record<string, string> = { Range: `bytes=${String(job.received)}-` };
  if (job.validator !== null) headers["If-Range"] = job.validator;
  return headers;
}

/**
 * Forgets the bytes of a partial file, in memory. The file itself is truncated
 * by the next attempt's `open(…, "w")`, which always follows a reset.
 */
function resetPartial(job: Job): void {
  job.received = 0;
  job.total = null;
  job.hash = createHash("sha256");
}

async function writeChunk(handle: FileHandle, job: Job, chunk: Uint8Array): Promise<void> {
  try {
    await handle.write(chunk, 0, chunk.byteLength, job.received);
  } catch {
    // A write that failed is a filesystem finding, not a transport one.
    throw new DownloadRefusal("io");
  }
  job.hash.update(chunk);
  job.received += chunk.byteLength;
}

/** Closes a handle without letting a close failure replace the reason the attempt is ending. */
async function closeQuietly(handle: FileHandle): Promise<void> {
  try {
    await handle.close();
  } catch {
    // See the caller: the refusal that follows is the finding.
  }
}

/**
 * Reads and drops a body this attempt will not use — a redirect's, a `416`'s —
 * up to `DISCARDED_BODY_LIMIT`. Breaking out of the loop cancels the reader,
 * which is what closes the socket rather than leaving it open for a body nobody
 * wanted.
 */
async function discardBody(body: AsyncIterable<Uint8Array> | null): Promise<void> {
  if (body === null) return;
  let dropped = 0;
  try {
    for await (const chunk of body) {
      dropped += chunk.byteLength;
      if (dropped > DISCARDED_BODY_LIMIT) break;
    }
  } catch {
    // A body nobody asked for may also fail to arrive, and nothing downstream
    // is waiting for it.
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** An absolute URL for a `Location`, or `null` when it cannot be resolved. */
function resolveLocation(location: string, base: string): string | null {
  try {
    return new URL(location, base).toString();
  } catch {
    return null;
  }
}

/** `ETag` first, then `Last-Modified`: either identifies the file for `If-Range`. */
function validatorOf(response: DownloadResponse): string | null {
  return response.header("etag") ?? response.header("last-modified");
}

function declaredLength(response: DownloadResponse): number | null {
  const raw = response.header("content-length");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * `Content-Range: bytes <start>-<end>/<total|*>`. The end is not returned: this
 * service only needs to know where the reply starts, and the total when the
 * server names one.
 */
function parseContentRange(raw: string | null): ContentRange | null {
  if (raw === null) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(raw.trim());
  if (match === null) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  const totalText = match[3] ?? "*";
  const total = totalText === "*" ? null : Number(totalText);
  return { start, total: total !== null && Number.isSafeInteger(total) ? total : null };
}
