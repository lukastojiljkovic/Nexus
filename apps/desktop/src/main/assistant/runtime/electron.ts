/**
 * WHAT ONLY ELECTRON CAN DO FOR THIS RUNTIME: fork the process, own the session,
 * know where `userData` is.
 *
 * Nothing that DECIDES lives here. The mode gate, the allowlist, the install
 * rules and the protocol are all in files that import no Electron and are tested
 * under Vitest; this file turns four Electron objects into the four functions
 * `host.ts` asks for, and that is the whole of it. The split matters because a
 * file that imports `electron` cannot be tested at all in this repository
 * (`vitest.config.ts` says so in as many words), so every line here is a line
 * nobody can prove — which is the reason there are so few of them.
 *
 * THE MODE IS THE ONE THIS PROCESS CAME UP UNDER, read once, at import, exactly
 * as `main/index.ts` reads it for the resolver block and the update session
 * (`runningNetworkMode`). `activeNetworkMode(launch, stored)` is the honest
 * answer while the two disagree — between a mode saved and the restart that
 * applies it, no download or search may run, and the answer that can never be
 * too wide is `"offline"`.
 */

import { app, session, utilityProcess } from "electron";
import { dirname, join } from "node:path";

import { createDownloadHttp } from "../../download/electron.js";
import {
  createDownloadService,
  freeSpaceBytes,
  type DownloadProgress as ServiceProgress,
  type DownloadService,
} from "../../download/service.js";
import { activeNetworkMode, isSessionRequestAllowed, readNetworkMode, type NetworkMode } from "../../net/offline.js";
import type { ModelHostDeps, WorkerPort } from "./host.js";

/** The utility process's file name, as `electron.vite.config.ts` builds it. */
export const WORKER_BUNDLE = "assistant-model-host.js";

/** What the process shows as its name in the OS. */
const SERVICE_NAME = "Nexus assistant model host";

/** How much of a JSON reply this runtime will read: the Hub's listings are kilobytes. */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

/** The mode this launch came up under. Read once, like every other rule built at launch. */
const launchMode: NetworkMode = readNetworkMode(app.getPath("userData"));

/**
 * The dedicated session (ADR-089, ADR-092), by the name main gave its partition.
 *
 * `session.fromPartition` returns the SAME object for the same name, so this is
 * one session with two references rather than a second session: its
 * `onBeforeRequest` allowlist, its direct proxy and its in-memory-only lifetime
 * are all main's, and every request this runtime makes goes through them.
 */
function dedicatedSession(): Electron.Session {
  return session.fromPartition("nexus-update");
}

/** The one download service of this launch, with each job's progress routed to its own caller. */
function createDownloads(userData: string): {
  readonly forJob: (jobId: string, onProgress: (progress: ServiceProgress) => void) => DownloadService;
} {
  const routes = new Map<string, (progress: ServiceProgress) => void>();
  let service: DownloadService | null = null;
  const mode = (): NetworkMode => activeNetworkMode(launchMode, readNetworkMode(userData));
  return {
    forJob(jobId, onProgress) {
      routes.set(jobId, onProgress);
      service ??= createDownloadService({
        userData,
        mode,
        isAllowedUrl: (url) => isSessionRequestAllowed(mode(), url),
        http: createDownloadHttp(dedicatedSession()),
        freeSpaceBytes,
        onProgress: (progress) => {
          routes.get(progress.id)?.(progress);
        },
      });
      return service;
    },
  };
}

/**
 * A JSON GET on the dedicated session, bounded and allowlisted.
 *
 * The port is the download service's own (`createDownloadHttp`), which does NOT
 * follow redirects and hands each `Location` back to its caller: a hop this code
 * never saw is a hop this code cannot vouch for, and the Hub's API endpoints
 * answer `200` directly. A non-`200` is therefore a refusal, not a redirect to
 * chase, and the body is read to `MAX_JSON_BYTES` and no further.
 */
async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await createDownloadHttp(dedicatedSession()).request(url, {
    headers: { accept: "application/json", "user-agent": "Nexus/2.0 (+https://github.com/lukastojiljkovic/Nexus)" },
    signal,
  });
  if (response.status !== 200) throw new Error(`HTTP ${String(response.status)}`);
  const body = response.body;
  if (body === null) throw new Error("the reply had no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > MAX_JSON_BYTES) throw new Error("the reply was larger than this runtime reads");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  return JSON.parse(text) as unknown;
}

/**
 * The utility process, forked from the file `electron.vite.config.ts` emits into
 * `out/main/`. Both streams are drained: an unread pipe fills, and a child that
 * blocks writing a log line stops generating tokens.
 */
function spawnWorker(): WorkerPort {
  const child = utilityProcess.fork(join(dirname(__filename), WORKER_BUNDLE), [], {
    serviceName: SERVICE_NAME,
    stdio: "pipe",
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[assistant-model-host] ${chunk.toString("utf8")}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[assistant-model-host] ${chunk.toString("utf8")}`);
  });
  return {
    post: (message) => {
      child.postMessage(message);
    },
    onMessage: (listener) => {
      child.on("message", (message: unknown) => {
        listener(message);
      });
    },
    onExit: (listener) => {
      child.on("exit", () => {
        listener();
      });
    },
  };
}

/** Everything `createModelHost` needs, from Electron. */
export function createModelHostDeps(): ModelHostDeps {
  const userData = app.getPath("userData");
  const downloads = createDownloads(userData);
  const mode = (): NetworkMode => activeNetworkMode(launchMode, readNetworkMode(userData));
  return {
    userData,
    mode,
    isAllowedUrl: (url) => isSessionRequestAllowed(mode(), url),
    spawnWorker,
    downloadFor: downloads.forJob,
    fetchJson,
    freeBytes: freeSpaceBytes,
  };
}
