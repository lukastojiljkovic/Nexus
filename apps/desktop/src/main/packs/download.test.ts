import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mkdirSync } from "node:fs";
import type { PackDownloadProgress } from "../../shared/ipc.js";
import {
  createDownloadService,
  freeSpaceBytes,
  type DownloadHttp,
  type DownloadResponse,
} from "../download/service.js";
import type { NetworkMode } from "../net/offline.js";
import type { PackCatalogueEntry } from "./catalogue.js";
import { createPackDownloader, downloadStageRoot } from "./download.js";
import { baseManifest, entry as manifestEntry, makeKey, writePack } from "./fixtures.js";
import { PACKS_STAGING_DIR, packsRoot, readInstalled } from "./registry.js";

/**
 * A catalogue pack downloaded and INSTALLED, end to end (ADR-103's acceptance).
 *
 * Nothing here is stubbed except the two things a test must own: a server on
 * loopback that serves the fixture pack's bytes, and the free-space reading.
 * The real download service runs over a real socket, the real downloader
 * assembles the folder, and the real `installPackFromDirectory` verifies the
 * signature, the manifest and the structure — so what the last assertion reads
 * is a pack that came out of `packs/<id>/<version>/` after all of that, not a
 * mock's idea of one.
 *
 * The server is `node:http`, the one construct `check:egress` objects to, and
 * the exemption in `scripts/check-egress.mjs` says so.
 */

interface TestServer {
  readonly origin: string;
  /** Every request line the server received, in order. */
  readonly requests: { readonly url: string; readonly range: string | null }[];
  close(): Promise<void>;
}

/** One file the server will serve, with the two-write shape a deterministic pause needs. */
interface Served {
  readonly bytes: Uint8Array;
  /** Split the body in two writes with this many milliseconds between them. */
  readonly gapMs?: number;
}

let root: string;
let userData: string;
const servers: TestServer[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-pack-download-"));
  userData = join(root, "userData");
});

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  rmSync(root, { recursive: true, force: true });
});

async function listen(routes: ReadonlyMap<string, Served>): Promise<TestServer> {
  const requests: TestServer["requests"] = [];
  const server = createServer((req, res) => {
    const range = req.headers.range;
    requests.push({
      url: req.url ?? "",
      range: Array.isArray(range) ? (range[0] ?? null) : (range ?? null),
    });
    const served = routes.get(req.url ?? "");
    if (served === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    serve(res, served, range === undefined ? null : Array.isArray(range) ? (range[0] ?? null) : range);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the test server has no port");
  const created: TestServer = {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
  servers.push(created);
  return created;
}

/** A body with `Range` support, and a one-gap body when the test wants a pause point. */
function serve(res: ServerResponse, served: Served, range: string | null): void {
  const body = served.bytes;
  let start = 0;
  if (range !== null) {
    const match = /^bytes=(\d+)-$/.exec(range);
    start = match === null ? 0 : Number(match[1]);
  }
  const slice = body.subarray(start);
  const headers: Record<string, string> = {
    "content-length": String(slice.byteLength),
    etag: '"fixture"',
  };
  if (range !== null) {
    headers["content-range"] = `bytes ${String(start)}-${String(body.byteLength - 1)}/${String(body.byteLength)}`;
    res.writeHead(206, headers);
  } else {
    res.writeHead(200, headers);
  }
  if (served.gapMs === undefined) {
    res.end(Buffer.from(slice));
    return;
  }
  const half = Math.max(1, Math.floor(slice.byteLength / 2));
  res.write(Buffer.from(slice.subarray(0, half)));
  setTimeout(() => {
    res.end(Buffer.from(slice.subarray(half)));
  }, served.gapMs);
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

interface Fixture {
  readonly key: ReturnType<typeof makeKey>;
  /** The pack folder as `installPackFromDirectory` would receive it from a disk. */
  readonly dir: string;
  /** Each file of that folder, as bytes, keyed by the path the manifest/catalogue uses. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly content: string;
}

/** A signed pack folder with one content file, and the bytes of every file in it. */
function fixture(): Fixture {
  const key = makeKey();
  const content = "offline reading, all of it";
  const dir = join(root, "fixture-pack");
  writePack({
    dir,
    key: key.privateKey,
    manifest: baseManifest([manifestEntry("content/readme.txt", content)], {
      id: "safety-kit",
      kind: "content",
      notice: "safety",
      minAppVersion: "1.0.0",
    }),
    contents: { "content/readme.txt": content },
  });
  const files = new Map<string, Uint8Array>([
    ["pack.json", readFileSync(join(dir, "pack.json"))],
    ["pack.json.sig", readFileSync(join(dir, "pack.json.sig"))],
    ["content/readme.txt", Buffer.from(content, "utf8")],
  ]);
  return { key, dir, files, content };
}

/** The catalogue entry for `fixture()`, with every file address pointing at `origin`. */
function catalogueEntry(fixtureValue: Fixture, origin: string): PackCatalogueEntry {
  const listed = [...fixtureValue.files.entries()].map(([path, bytes]) => ({
    path,
    url: `${origin}/files/${path}`,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  return {
    id: "safety-kit",
    version: "1.0.0",
    kind: "content",
    title: { sr: "Prva pomoć", en: "First aid" },
    description: { sr: "Osnovna prva pomoć.", en: "Basic first aid." },
    size: listed.reduce((sum, file) => sum + file.size, 0),
    licence: { spdx: "CC-BY-SA-4.0", attribution: "Nexus examples", url: "https://example.org/l" },
    source: { name: "Nexus examples", url: "https://example.org/s" },
    notice: "safety",
    files: listed,
  };
}

function downloader(options: {
  readonly origin: string;
  readonly publicKeyPem: string;
  readonly mode?: NetworkMode;
  readonly onProgress?: (progress: PackDownloadProgress) => void;
}) {
  const mode = options.mode ?? "downloads";
  return createPackDownloader({
    userData,
    appVersion: "1.5.0",
    publicKeyPem: options.publicKeyPem,
    mode: () => mode,
    freeBytes: () => Number.MAX_SAFE_INTEGER,
    onProgress: (progress) => {
      options.onProgress?.(progress);
    },
    service: (onProgress) =>
      createDownloadService({
        userData,
        mode: () => mode,
        // Loopback only: the shape of the real rule (https plus an exact host)
        // with a host a test can actually serve from.
        isAllowedUrl: (url: string) => url.startsWith(options.origin),
        http: nodePort(),
        freeSpaceBytes,
        onProgress,
      }),
  });
}

describe("downloading a catalogue pack", () => {
  it("fetches every file, verifies each hash, and installs the pack", async () => {
    const pack = fixture();
    const server = await listen(
      new Map(
        [...pack.files.entries()].map(([path, bytes]) => [`/files/${path}`, { bytes }]),
      ),
    );
    const entry = catalogueEntry(pack, server.origin);
    const progress: string[] = [];
    const outcome = await downloader({
      origin: server.origin,
      publicKeyPem: pack.key.publicKeyPem,
      onProgress: (row) => progress.push(row.id),
    }).download(entry);

    expect(outcome.outcome).toBe("installed");
    if (outcome.outcome !== "installed") return;
    expect(outcome.pack.manifest.id).toBe("safety-kit");
    expect(outcome.pack.manifest.notice).toBe("safety");
    expect(outcome.pack.fileCount).toBe(1);

    // The pack is on disk, listed by the index, and its content is the content.
    const installed = readInstalled(userData, pack.key.publicKeyPem);
    expect(installed.map((listed) => listed.manifest.id)).toEqual(["safety-kit"]);
    expect(readFileSync(join(packsRoot(userData), "safety-kit", "1.0.0", "content", "readme.txt"), "utf8")).toBe(
      pack.content,
    );
    // Every file was asked for exactly once, and progress was reported.
    expect(server.requests.map((request) => request.url).sort()).toEqual([
      "/files/content/readme.txt",
      "/files/pack.json",
      "/files/pack.json.sig",
    ]);
    expect(progress).toContain("safety-kit");
    // Nothing is left staged: the download's folder is swept after the install.
    expect(readdirSync(join(packsRoot(userData), PACKS_STAGING_DIR))).toEqual([]);
  });

  it("refuses bytes that are not the bytes the catalogue pins, and leaves nothing behind", async () => {
    const pack = fixture();
    const routes = new Map(
      [...pack.files.entries()].map(([path, bytes]): [string, Served] => [
        `/files/${path}`,
        { bytes: path === "content/readme.txt" ? Buffer.from("not what was signed", "utf8") : bytes },
      ]),
    );
    const server = await listen(routes);
    const outcome = await downloader({
      origin: server.origin,
      publicKeyPem: pack.key.publicKeyPem,
    }).download(catalogueEntry(pack, server.origin));

    expect(outcome).toEqual({ outcome: "refused", code: "hash-mismatch" });
    expect(existsSync(join(packsRoot(userData), "safety-kit"))).toBe(false);
    expect(readdirSync(join(packsRoot(userData), PACKS_STAGING_DIR))).toEqual([]);
  });

  it("refuses with the mode's code and makes no request when the launch is not in downloads", async () => {
    const pack = fixture();
    const server = await listen(new Map());
    const outcome = await downloader({
      origin: server.origin,
      publicKeyPem: pack.key.publicKeyPem,
      mode: "updates",
    }).download(catalogueEntry(pack, server.origin));
    expect(outcome).toEqual({ outcome: "refused", code: "downloads-off" });
    expect(server.requests).toEqual([]);
  });

  it("pauses mid-file and resumes it with a Range request", async () => {
    const pack = fixture();
    const routes = new Map<string, Served>(
      [...pack.files.entries()].map(([path, bytes]): [string, Served] => [
        `/files/${path}`,
        // Only the content file is served in two writes: the gap is the pause
        // point, and the two metadata files are small enough to arrive whole.
        path === "content/readme.txt" ? { bytes, gapMs: 40 } : { bytes },
      ]),
    );
    const server = await listen(routes);
    const entry = catalogueEntry(pack, server.origin);
    // The files before `content/readme.txt` are the two metadata files, so a
    // byte count above their sizes is the content file's first chunk: the
    // deterministic pause point, issued from a progress row exactly as the card
    // issues it.
    const placedBefore = (pack.files.get("pack.json")?.byteLength ?? 0) + (pack.files.get("pack.json.sig")?.byteLength ?? 0);
    let stopped = false;
    const dl = downloader({
      origin: server.origin,
      publicKeyPem: pack.key.publicKeyPem,
      onProgress: (progress) => {
        if (stopped) return;
        if (progress.file === "content/readme.txt" && progress.bytesDone > placedBefore) {
          stopped = true;
          dl.pause("safety-kit");
        }
      },
    });

    const first = await dl.download(entry);

    expect(first.outcome).toBe("paused");
    const second = await dl.resume("safety-kit");
    expect(second.outcome).toBe("installed");
    const contentRequests = server.requests.filter((request) => request.url === "/files/content/readme.txt");
    expect(contentRequests.length).toBe(2);
    expect(contentRequests[1]?.range).not.toBeNull();
  }, 20_000);

  it("cancels a download and removes what it staged", async () => {
    const pack = fixture();
    const server = await listen(
      new Map([...pack.files.entries()].map(([path, bytes]) => [`/files/${path}`, { bytes }])),
    );
    const entry = catalogueEntry(pack, server.origin);
    // Cancel on the first progress row: the download has begun, so this is a
    // running job being cancelled rather than a call that arrives before there
    // is anything to stop.
    const dl = downloader({
      origin: server.origin,
      publicKeyPem: pack.key.publicKeyPem,
      onProgress: () => {
        void dl.cancel("safety-kit");
      },
    });
    const started = dl.download(entry);
    const outcome = await started;

    expect(outcome.outcome).toBe("cancelled");
    expect(existsSync(join(packsRoot(userData), "safety-kit"))).toBe(false);
    expect(readdirSync(join(packsRoot(userData), PACKS_STAGING_DIR))).toEqual([]);
  }, 20_000);
});

describe("the download staging directory", () => {
  it("is inside the one directory the registry skips", () => {
    const stage = downloadStageRoot(userData, "abc123");
    expect(stage.startsWith(join(packsRoot(userData), PACKS_STAGING_DIR))).toBe(true);
  });

  it("keeps a half-downloaded pack out of the installed list", () => {
    // The property the path buys: whatever is under `.staging` is invisible,
    // because `rebuildInstalled` never enters it. Written as a folder that
    // LOOKS like an installed pack rather than as a promise about one.
    const stage = downloadStageRoot(userData, "leftover");
    mkdirSync(join(stage, "pack"), { recursive: true });
    writeFileSync(join(stage, "pack", "pack.json"), "{\"format\":1}");
    expect(readInstalled(userData, makeKey().publicKeyPem)).toEqual([]);
  });
});
