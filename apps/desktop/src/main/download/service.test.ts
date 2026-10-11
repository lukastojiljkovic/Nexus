import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NetworkMode } from "../net/offline.js";
import {
  createDownloadService,
  downloadStagingPath,
  freeSpaceBytes,
  type DownloadHttp,
  type DownloadOutcome,
  type DownloadProgress,
  type DownloadResponse,
} from "./service.js";

/**
 * The download service, against a real HTTP server on loopback.
 *
 * A server rather than an injected answer, because half of what this module
 * promises is about the WIRE — that a pause becomes a `Range` request, that a
 * server without ranges makes the file restart rather than continue, that a
 * redirect into a foreign host costs one request and not two — and a stubbed
 * `DownloadResponse` would let a wrong request pass as a right one.
 *
 * The port below is `node:http`, which does not follow redirects (exactly what
 * `service.ts` requires of a port) and leaves the request count, the headers
 * sent and the chunk boundaries under the test's control. It is the one
 * construct in this file that `check:egress` objects to, and the exemption in
 * `scripts/check-egress.mjs` says so.
 */

interface TestServer {
  readonly origin: string;
  /** Every request the server received, in order. */
  readonly requests: { readonly url: string; readonly headers: Record<string, string | string[] | undefined> }[];
  close(): Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let userData: string;
const servers: TestServer[] = [];

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-download-"));
});

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  rmSync(userData, { recursive: true, force: true });
});

async function listen(handler: Handler): Promise<TestServer> {
  const requests: TestServer["requests"] = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? "", headers: req.headers });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the test server has no port");
  const created: TestServer = {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        // A test that hangs a download leaves a socket open; the point of this
        // call is that the suite does not wait for it to time out.
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
  servers.push(created);
  return created;
}

/** The port `service.ts` requires: one request, redirects NOT followed. */
function nodePort(): DownloadHttp {
  return {
    request(url, init) {
      return new Promise<DownloadResponse>((resolve, reject) => {
        const req = httpRequest(url, { method: "GET", headers: { ...init.headers } });
        const onAbort = (): void => {
          req.destroy();
          reject(init.signal.reason ?? new Error("aborted"));
        };
        init.signal.addEventListener("abort", onAbort, { once: true });
        req.on("response", (res: IncomingMessage) => {
          resolve({
            status: res.statusCode ?? 0,
            header: (name) => {
              const value = res.headers[name.toLowerCase()];
              return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
            },
            body: res,
          });
        });
        req.on("error", (error: Error) => {
          init.signal.removeEventListener("abort", onAbort);
          reject(error);
        });
        req.end();
      });
    },
  };
}

interface ServiceOptions {
  readonly mode?: NetworkMode | (() => NetworkMode);
  readonly allowed?: (url: string) => boolean;
  readonly freeSpace?: number;
  /** Pause this id once the first bytes have landed — the deterministic pause point every resume test needs. */
  readonly pauseOnFirstChunk?: string;
  readonly cancelOnFirstChunk?: string;
  readonly onProgress?: (progress: DownloadProgress) => void;
}

function serviceFor(server: TestServer, options: ServiceOptions = {}) {
  const progress: DownloadProgress[] = [];
  const modeOption = options.mode;
  // „Once" is the point: a hook that paused on every event would pause the
  // RESUME too, and a resume test that never resumes would pass while testing
  // nothing.
  let stopped = false;
  const service = createDownloadService({
    userData,
    mode: typeof modeOption === "function" ? modeOption : () => modeOption ?? "downloads",
    // Loopback only, which is the shape of the real rule (`https` plus an exact
    // host) with the host list a test can actually serve from.
    isAllowedUrl: options.allowed ?? ((url: string) => url.startsWith(`${server.origin}/`)),
    http: nodePort(),
    freeSpaceBytes: async () => options.freeSpace ?? Number.MAX_SAFE_INTEGER,
    onProgress: (event) => {
      progress.push(event);
      if (!stopped && event.receivedBytes > 0) {
        if (options.pauseOnFirstChunk === event.id) {
          stopped = true;
          service.pause(event.id);
        } else if (options.cancelOnFirstChunk === event.id) {
          stopped = true;
          void service.cancel(event.id);
        }
      }
      options.onProgress?.(event);
    },
  });
  return { service, progress };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bodyOf(size: number, seed = 7): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * seed) % 251;
  return bytes;
}

interface RangeStats {
  /** The `Range` start each request asked for — `null` when the request carried no `Range` at all. */
  rangeStarts: (number | null)[];
}

function rangeStats(): RangeStats {
  return { rangeStarts: [] };
}

/**
 * A server that sends `body` in two writes with a gap, so a pause in between is
 * deterministic, and honours `Range` unless told not to.
 */
function fileServer(
  body: Uint8Array,
  stats: RangeStats,
  options: { readonly ignoreRange?: boolean; readonly etag?: string | (() => string) } = {},
): Handler {
  return (req, res) => {
    const etag = typeof options.etag === "function" ? options.etag() : (options.etag ?? '"v1"');
    const raw = req.headers.range;
    const range = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
    let start: number | null = null;
    if (range !== null && options.ignoreRange !== true) {
      const match = /^bytes=(\d+)-$/.exec(range);
      const requested = match === null ? 0 : Number(match[1]);
      if (requested >= body.byteLength) {
        stats.rangeStarts.push(requested);
        res.writeHead(416, { "content-range": `bytes */${String(body.byteLength)}` });
        res.end();
        return;
      }
      start = requested;
    }
    const slice = start === null ? body : body.subarray(start);
    if (start === null) {
      res.writeHead(200, { "content-length": String(slice.byteLength), etag });
    } else {
      res.writeHead(206, {
        "content-length": String(slice.byteLength),
        "content-range": `bytes ${String(start)}-${String(body.byteLength - 1)}/${String(body.byteLength)}`,
        etag,
      });
    }
    stats.rangeStarts.push(start);
    const half = Math.max(1, Math.floor(slice.byteLength / 2));
    res.write(slice.subarray(0, half));
    setTimeout(() => {
      if (res.destroyed || res.writableEnded) return;
      res.end(slice.subarray(half));
    }, 30);
  };
}

describe("the mode gate (ADR-092)", () => {
  it("downloads nothing at all in the other two modes", async () => {
    // Every other assertion in this file runs in the third mode. These two rows
    // are the ones that say the service is not merely unused in the others.
    const server = await listen(fileServer(bodyOf(64), rangeStats()));
    for (const mode of ["offline", "updates"] as const) {
      const { service } = serviceFor(server, { mode });
      const outcome = await service.start({
        id: "pack",
        url: `${server.origin}/file`,
        expectedSha256: sha256(bodyOf(64)),
        sizeLimitBytes: 1024,
      });
      expect(outcome, mode).toEqual({ outcome: "refused", id: "pack", problem: "mode" });
    }
    // The other half of „refuses with a clear code": nothing was even asked.
    expect(server.requests).toEqual([]);
    expect(existsSync(downloadStagingPath(userData, "pack"))).toBe(false);
  });

  it("refuses to continue a paused download once the mode has moved away from downloads", async () => {
    // A stored change is a restart owed, but this launch may not act on it:
    // `deps.mode()` is `activeNetworkMode`, which answers „offline" from the
    // moment the choice and the launch disagree — so a resume asked for after
    // the user switched the mode is refused rather than continued.
    const body = bodyOf(2000);
    const server = await listen(fileServer(body, rangeStats()));
    let mode: NetworkMode = "downloads";
    const { service } = serviceFor(server, {
      mode: () => mode,
      pauseOnFirstChunk: "pack",
    });

    const paused = await service.start({
      id: "pack",
      url: `${server.origin}/file`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 1_000_000,
    });
    expect(paused.outcome).toBe("paused");

    mode = "offline";
    expect(await service.resume("pack")).toEqual({
      outcome: "refused",
      id: "pack",
      problem: "mode",
    });
  });
});

describe("a download that works", () => {
  it("writes the staging file, hashes it while writing and hands back the verified path", async () => {
    const body = bodyOf(3000);
    const server = await listen(fileServer(body, rangeStats()));
    const { service, progress } = serviceFor(server);

    const outcome = await service.start({
      id: "wikipedia",
      url: `${server.origin}/wiki.bin`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 1_000_000,
    });

    const finalPath = join(userData, "downloads", "wikipedia");
    expect(outcome).toEqual({
      outcome: "done",
      id: "wikipedia",
      path: finalPath,
      bytes: body.byteLength,
      sha256: sha256(body),
    });
    expect(Array.from(readFileSync(finalPath))).toEqual(Array.from(body));
    // The staging name is gone: a `.part` file in the directory means an
    // incomplete download, and this one is complete.
    expect(existsSync(downloadStagingPath(userData, "wikipedia"))).toBe(false);

    // Progress: the first event is the zero mark, carrying the total the reply
    // declared, then one event per chunk, and each of those a running total of
    // what is on disk.
    expect(progress[0]).toEqual({ id: "wikipedia", receivedBytes: 0, totalBytes: body.byteLength });
    expect(progress.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < progress.length; index += 1) {
      const previous = progress[index - 1];
      const current = progress[index];
      if (previous === undefined || current === undefined) throw new Error("unreachable");
      expect(current.receivedBytes).toBeGreaterThanOrEqual(previous.receivedBytes);
      expect(current.totalBytes).toBe(body.byteLength);
    }
    expect(progress.at(-1)?.receivedBytes).toBe(body.byteLength);
  });

  it("follows a redirect and checks every hop, not only the first URL", async () => {
    const body = bodyOf(500);
    const stats = rangeStats();
    const inner = fileServer(body, stats);
    const server = await listen((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "/file" });
        res.end();
        return;
      }
      inner(req, res);
    });
    const { service } = serviceFor(server);

    const outcome = await service.start({
      id: "chain",
      url: `${server.origin}/redirect`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 1_000_000,
    });

    expect(outcome.outcome).toBe("done");
    expect(server.requests.map((entry) => entry.url)).toEqual(["/redirect", "/file"]);
  });

  it("refuses a redirect that leaves the allowlist, without requesting the foreign host", async () => {
    // The acceptance criterion, at the wire: the chain is checked as it is
    // walked, so the hostile hop is refused BEFORE a request goes to it.
    const server = await listen((_req, res) => {
      res.writeHead(302, { location: "https://content.example/pack.bin" });
      res.end();
    });
    const { service } = serviceFor(server, {
      // The real rule is https plus an exact host; this one refuses the
      // redirect's host the same way, and admits the loopback server.
      allowed: (url) => url.startsWith(`${server.origin}/`),
    });

    const outcome = await service.start({
      id: "foreign",
      url: `${server.origin}/start`,
      expectedSha256: sha256(bodyOf(10)),
      sizeLimitBytes: 1024,
    });

    expect(outcome).toEqual({ outcome: "refused", id: "foreign", problem: "url" });
    expect(server.requests.map((entry) => entry.url)).toEqual(["/start"]);
    expect(existsSync(downloadStagingPath(userData, "foreign"))).toBe(false);
  });

  it("hashes on the wire, not on trust: a file that does not match is refused and deleted", async () => {
    const body = bodyOf(400);
    const server = await listen(fileServer(body, rangeStats()));
    const { service } = serviceFor(server);

    const outcome = await service.start({
      id: "tampered",
      url: `${server.origin}/file`,
      expectedSha256: sha256(bodyOf(400, 11)),
      sizeLimitBytes: 1_000_000,
    });

    expect(outcome).toEqual({ outcome: "refused", id: "tampered", problem: "hash" });
    // Nothing partial survives a failure — not even a file that was entirely
    // downloaded, because „downloaded" is not „verified".
    expect(existsSync(downloadStagingPath(userData, "tampered"))).toBe(false);
    expect(existsSync(join(userData, "downloads", "tampered"))).toBe(false);
  });
});

describe("pause and resume", () => {
  it("asks for the byte it stopped at, appends the rest and ends with the whole file", async () => {
    const body = bodyOf(2000);
    const stats = rangeStats();
    const server = await listen(fileServer(body, stats));
    const { service } = serviceFor(server, {
      pauseOnFirstChunk: "pack",
    });

    const paused = await service.start({
      id: "pack",
      url: `${server.origin}/file`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 1_000_000,
    });
    expect(paused.outcome).toBe("paused");
    const kept = paused.outcome === "paused" ? paused.bytes : 0;
    expect(kept).toBeGreaterThan(0);
    // The partial file is exactly the resume point, and it is still there.
    expect(existsSync(downloadStagingPath(userData, "pack"))).toBe(true);
    expect(readFileSync(downloadStagingPath(userData, "pack")).byteLength).toBe(kept);

    const resumed = await service.resume("pack");
    expect(resumed).toEqual({
      outcome: "done",
      id: "pack",
      path: join(userData, "downloads", "pack"),
      bytes: body.byteLength,
      sha256: sha256(body),
    });
    // The resumed request asked for exactly what was kept, and the server was
    // asked for a RANGE — both halves of „resume is a Range request".
    expect(server.requests[1]?.headers["range"]).toBe(`bytes=${String(kept)}-`);
    // The server answered the first request in full and the second one from the
    // byte this process stopped at — a `206` at exactly `kept` — which is the
    // append path; the correct hash above is what proves the appended file is
    // the file, not two halves of one.
    expect(stats.rangeStarts[0]).toBe(null);
    expect(stats.rangeStarts[1]).toBe(kept);
  });

  it("restarts cleanly when the server answers a 200 instead of the range", async () => {
    // A server with no Range support, which is the common case for the plain
    // `Content-Length` + body shape: the range request is ignored, the whole
    // file arrives again, and the partial must be THROWN AWAY rather than
    // appended to — the hash covers the file, so a doubled file is nothing.
    const body = bodyOf(1200);
    const stats = rangeStats();
    const server = await listen(fileServer(body, stats, { ignoreRange: true }));
    const { service } = serviceFor(server, {
      pauseOnFirstChunk: "pack",
    });

    const paused = await service.start({
      id: "pack",
      url: `${server.origin}/file`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 1_000_000,
    });
    expect(paused.outcome).toBe("paused");

    const resumed = await service.resume("pack");
    expect(resumed.outcome).toBe("done");
    expect(Array.from(readFileSync(join(userData, "downloads", "pack")))).toEqual(Array.from(body));
    // Both responses were whole files — no `206` was ever served — so the
    // partial was replaced rather than appended to, which is what restarting
    // cleanly means. (If it had been appended to, the outcome above would have
    // been a hash refusal rather than a completed file.)
    expect(stats.rangeStarts).toEqual([null, null]);
  });

  it("restarts cleanly when the file behind the URL changed while it was paused", async () => {
    // The validator changed under an `If-Range`, so the server answers 206 for
    // a DIFFERENT file. Appending would produce two files spliced together, so
    // the partial is dropped and the reply is asked for again from zero.
    const body = bodyOf(1500);
    const stats = rangeStats();
    let version = 1;
    const server = await listen(
      fileServer(body, stats, {
        // A new ETag on every attempt after the first, with the range still
        // honoured — the shape a server that ignores `If-Range` produces.
        etag: () => `"v${String((version += 1))}"`,
      }),
    );
    const { service } = serviceFor(server, {
      pauseOnFirstChunk: "pack",
    });

    const paused = await service.start({
      id: "pack",
      url: `${server.origin}/file`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 1_000_000,
    });
    expect(paused.outcome).toBe("paused");

    const resumed = await service.resume("pack");
    expect(resumed.outcome).toBe("done");
    expect(Array.from(readFileSync(join(userData, "downloads", "pack")))).toEqual(Array.from(body));
    // The first resumed request carried the range, the second — after the
    // restart — carried none, and the third body was the whole file.
    expect(server.requests[1]?.headers["range"]).toBeDefined();
    expect(server.requests[2]?.headers["range"]).toBeUndefined();
    expect(stats.rangeStarts.at(-1)).toBe(null);
  });

  it("refuses a resume for a download that is not paused and known", async () => {
    const server = await listen(fileServer(bodyOf(10), rangeStats()));
    const { service } = serviceFor(server);
    expect(await service.resume("never-started")).toEqual({
      outcome: "refused",
      id: "never-started",
      problem: "not-found",
    });
  });
});

describe("cancel", () => {
  it("deletes the partial file when a download in flight is cancelled", async () => {
    const body = bodyOf(4000);
    const server = await listen(fileServer(body, rangeStats()));
    const { service } = serviceFor(server, {
      cancelOnFirstChunk: "pack",
    });

    const outcome = await service.start({
      id: "pack",
      url: `${server.origin}/file`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 1_000_000,
    });

    expect(outcome).toEqual({ outcome: "cancelled", id: "pack" });
    expect(existsSync(downloadStagingPath(userData, "pack"))).toBe(false);
  });

  it("deletes the partial file of a PAUSED download, whose promise is long settled", async () => {
    const body = bodyOf(2000);
    const server = await listen(fileServer(body, rangeStats()));
    const { service } = serviceFor(server, {
      pauseOnFirstChunk: "pack",
    });

    const paused = await service.start({
      id: "pack",
      url: `${server.origin}/file`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 1_000_000,
    });
    expect(paused.outcome).toBe("paused");
    expect(existsSync(downloadStagingPath(userData, "pack"))).toBe(true);

    await service.cancel("pack");
    expect(existsSync(downloadStagingPath(userData, "pack"))).toBe(false);
    // And the id is free again, so a fresh download under it starts over
    // rather than resuming a job nobody holds.
    expect(await service.resume("pack")).toEqual({
      outcome: "refused",
      id: "pack",
      problem: "not-found",
    });
  });
});

describe("the caps", () => {
  it("refuses a reply that declares more than the caller's limit, and writes nothing", async () => {
    const body = bodyOf(200);
    const server = await listen(fileServer(body, rangeStats()));
    const { service } = serviceFor(server);

    const outcome = await service.start({
      id: "big",
      url: `${server.origin}/file`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 100,
    });

    expect(outcome).toEqual({ outcome: "refused", id: "big", problem: "size-limit" });
    expect(existsSync(downloadStagingPath(userData, "big"))).toBe(false);
  });

  it("cancels a reply that grows past the limit without declaring it", async () => {
    // No `Content-Length` at all: the only bound left is the running total, and
    // a declared length is a number a server can simply leave out.
    const body = bodyOf(200);
    const server = await listen((_req, res) => {
      res.writeHead(200);
      res.write(body.subarray(0, 120));
      setTimeout(() => {
        if (res.destroyed || res.writableEnded) return;
        res.end(body.subarray(120));
      }, 10);
    });
    const { service } = serviceFor(server);

    const outcome = await service.start({
      id: "grower",
      url: `${server.origin}/file`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 100,
    });

    expect(outcome).toEqual({ outcome: "refused", id: "grower", problem: "size-limit" });
    expect(existsSync(downloadStagingPath(userData, "grower"))).toBe(false);
  });

  it("asks for nothing at all when the volume cannot hold what the download may need", async () => {
    const body = bodyOf(400);
    const server = await listen(fileServer(body, rangeStats()));
    const { service } = serviceFor(server, { freeSpace: 100 });

    const outcome = await service.start({
      id: "pack",
      url: `${server.origin}/file`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 1_000_000,
    });

    expect(outcome).toEqual({ outcome: "refused", id: "pack", problem: "no-space" });
    // The check is BEFORE the request, so the server heard nothing — which is
    // the difference between a pre-flight and a failure part-way through.
    expect(server.requests).toEqual([]);
  });

  it("reads the volume it is actually writing to", async () => {
    // The injected reading is what the „no space" case above controls; this is
    // the real one, so a signature that could never answer is caught here.
    expect(await freeSpaceBytes(userData)).toBeGreaterThan(0);
  });

  it("runs two downloads and refuses the third", async () => {
    // A server that never finishes: both downloads stay in flight, which is the
    // only state in which the cap is what refuses the third.
    const server = await listen((_req, _res) => {
      // Deliberately no response.
    });
    const { service } = serviceFor(server);
    const request = (id: string) => ({
      id,
      url: `${server.origin}/file`,
      expectedSha256: sha256(bodyOf(64)),
      sizeLimitBytes: 1_000_000,
    });

    const first = service.start(request("one"));
    const second = service.start(request("two"));
    expect(await service.start(request("three"))).toEqual({
      outcome: "refused",
      id: "three",
      problem: "busy",
    });

    await service.cancel("one");
    await service.cancel("two");
    const settled: DownloadOutcome[] = [await first, await second];
    expect(settled.map((outcome) => outcome.outcome)).toEqual(["cancelled", "cancelled"]);
  });
});

describe("the request itself", () => {
  it("refuses a download with no expected hash, which is the rule the service exists for", async () => {
    const server = await listen(fileServer(bodyOf(10), rangeStats()));
    const { service } = serviceFor(server);
    for (const expectedSha256 of ["", "not-a-hash", "a".repeat(63), `${"a".repeat(63)}z`]) {
      expect(
        await service.start({
          id: "pack",
          url: `${server.origin}/file`,
          expectedSha256,
          sizeLimitBytes: 1024,
        }),
        expectedSha256,
      ).toEqual({ outcome: "refused", id: "pack", problem: "hash-required" });
    }
    expect(server.requests).toEqual([]);
  });

  it("refuses an id or a limit it cannot use, and a URL the allowlist does not admit", async () => {
    const server = await listen(fileServer(bodyOf(10), rangeStats()));
    const { service } = serviceFor(server);
    expect(
      await service.start({
        id: "../escape",
        url: `${server.origin}/file`,
        expectedSha256: sha256(bodyOf(10)),
        sizeLimitBytes: 1024,
      }),
    ).toEqual({ outcome: "refused", id: "../escape", problem: "request" });
    expect(
      await service.start({
        id: "pack",
        url: `${server.origin}/file`,
        expectedSha256: sha256(bodyOf(10)),
        sizeLimitBytes: 0,
      }),
    ).toEqual({ outcome: "refused", id: "pack", problem: "request" });
    expect(
      await service.start({
        id: "pack",
        url: "https://content.example/pack.bin",
        expectedSha256: sha256(bodyOf(10)),
        sizeLimitBytes: 1024,
      }),
    ).toEqual({ outcome: "refused", id: "pack", problem: "url" });
    expect(server.requests).toEqual([]);
  });

  it("refuses a second download under an id that is already in use", async () => {
    const body = bodyOf(2000);
    const server = await listen(fileServer(body, rangeStats()));
    const { service } = serviceFor(server, {
      pauseOnFirstChunk: "pack",
    });
    const paused = await service.start({
      id: "pack",
      url: `${server.origin}/file`,
      expectedSha256: sha256(body),
      sizeLimitBytes: 1_000_000,
    });
    expect(paused.outcome).toBe("paused");
    expect(
      await service.start({
        id: "pack",
        url: `${server.origin}/file`,
        expectedSha256: sha256(body),
        sizeLimitBytes: 1_000_000,
      }),
    ).toEqual({ outcome: "refused", id: "pack", problem: "busy" });
  });
});
