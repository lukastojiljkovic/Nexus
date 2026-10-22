/**
 * The two kinds of request a region download makes, over the download
 * service's transport (`DownloadHttp`, ADR-092): the list of builds, and byte
 * ranges of one build.
 *
 * **The transport is the service's, the rules are the service's.** The port is
 * the one `main/download/electron.ts` builds on the dedicated session, so the
 * launch's resolver rule applies, and it never follows a redirect. Every URL is
 * checked against the launch's allowlist before it is asked for, and the build
 * host answers a range directly, so a `3xx` is a failure here, not a hop.
 *
 * **One build's bytes, and only that build's.** A download reads hundreds of
 * ranges, and possibly over days if it is paused. The first answer's `ETag`
 * is pinned, and a later answer with another one stops the download
 * (`build-changed`) rather than append a second file's bytes to the first's.
 * Every answer must be a 206 whose `Content-Range` is exactly the range asked
 * for, out of exactly the size the list gave, with exactly that many bytes.
 */

import type { DownloadHttp, DownloadResponse } from "../../../../main/download/service.js";
import type { RegionProblem } from "../../shared/ipc.js";
import type { ArchiveReader } from "../extract/plan.js";
import { BUILDS_MAX_BYTES, BUILDS_URL, parseBuilds, type PlanetBuild } from "./builds.js";

/** A region download's refusal, by the code the page words. */
export class RegionError extends Error {
  constructor(
    readonly problem: RegionProblem,
    message: string = problem,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** The builds the list names, newest first. */
export async function fetchBuilds(
  http: DownloadHttp,
  isAllowedUrl: (url: string) => boolean,
  signal: AbortSignal,
): Promise<PlanetBuild[]> {
  const response = await ask(http, BUILDS_URL, {}, isAllowedUrl, signal);
  if (response.status !== 200) throw new RegionError("network", `The list of builds answered ${String(response.status)}.`);
  const bytes = await bodyOf(response, BUILDS_MAX_BYTES);
  try {
    return parseBuilds(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (failure) {
    throw new RegionError("network", "The list of builds is not JSON.", { cause: failure });
  }
}

/** A build read by ranges, held to one `ETag`: `etag` is the one a resumed download began with, or `null`. */
export function buildReader(
  http: DownloadHttp,
  build: PlanetBuild,
  isAllowedUrl: (url: string) => boolean,
  signal: AbortSignal,
  etag: string | null,
): ArchiveReader & { etag(): string | null } {
  let pinned = etag;
  return {
    etag: () => pinned,
    read: async (offset, length) => {
      const end = offset + length - 1;
      const response = await ask(http, build.url, { Range: `bytes=${String(offset)}-${String(end)}` }, isAllowedUrl, signal);
      const range = response.header("content-range");
      if (response.status !== 206 || range !== `bytes ${String(offset)}-${String(end)}/${String(build.bytes)}`) {
        throw new RegionError("network", `The build answered ${String(response.status)} (${range ?? "no range"}).`);
      }
      const answered = response.header("etag");
      if (pinned !== null && answered !== pinned) throw new RegionError("build-changed");
      pinned = answered;
      const bytes = await bodyOf(response, length);
      if (bytes.length !== length) throw new RegionError("network", "The build's answer ended early.");
      return bytes;
    },
  };
}

async function ask(
  http: DownloadHttp,
  url: string,
  headers: Record<string, string>,
  isAllowedUrl: (url: string) => boolean,
  signal: AbortSignal,
): Promise<DownloadResponse> {
  if (!isAllowedUrl(url)) throw new RegionError("url", `The launch does not allow ${url}.`);
  try {
    return await http.request(url, { headers, signal });
  } catch (failure) {
    throw new RegionError("network", "The request failed.", { cause: failure });
  }
}

/** The whole body, refused past `limit` bytes as it arrives rather than after. */
async function bodyOf(response: DownloadResponse, limit: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > limit) throw new RegionError("network", `The answer is larger than ${String(limit)} bytes.`);
      chunks.push(chunk);
    }
  } catch (failure) {
    if (failure instanceof RegionError) throw failure;
    throw new RegionError("network", "The answer stopped.", { cause: failure });
  }
  return new Uint8Array(Buffer.concat(chunks));
}
