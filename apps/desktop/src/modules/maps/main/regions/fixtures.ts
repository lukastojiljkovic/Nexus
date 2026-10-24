/**
 * A build host for tests: `builds.json` and one or more build files, answered
 * through the download service's `DownloadHttp` port the way
 * `build.protomaps.com` answers (206, `Content-Range`, an `ETag`).
 */

import type { DownloadHttp, DownloadResponse } from "../../../../main/download/service.js";

export interface FakeHost extends DownloadHttp {
  /** Every request, as `[url, range header or null]`. */
  readonly requests: [string, string | null][];
  /** Replaces what a URL answers with, as a rebuilt file would. */
  serve(url: string, bytes: Uint8Array, etag?: string): void;
}

export function fakeHost(files: Record<string, Uint8Array | string>): FakeHost {
  const served = new Map<string, { bytes: Uint8Array; etag: string }>();
  const requests: [string, string | null][] = [];
  const host: FakeHost = {
    requests,
    serve(url, bytes, etag = `"${String(bytes.length)}"`) {
      served.set(url, { bytes, etag });
    },
    request: async (url, init) => {
      if (init.signal.aborted) throw new Error("aborted");
      const range = init.headers["Range"] ?? null;
      requests.push([url, range]);
      const file = served.get(url);
      if (file === undefined) return reply(404, {}, new Uint8Array());
      const match = range === null ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
      if (match === null) {
        return reply(200, { etag: file.etag, "content-length": String(file.bytes.length) }, file.bytes);
      }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), file.bytes.length - 1);
      return reply(
        206,
        { etag: file.etag, "content-range": `bytes ${String(start)}-${String(end)}/${String(file.bytes.length)}` },
        file.bytes.slice(start, end + 1),
      );
    },
  };
  for (const [url, value] of Object.entries(files)) {
    host.serve(url, typeof value === "string" ? new TextEncoder().encode(value) : value);
  }
  return host;
}

/** A reply whose body arrives in chunks, as a socket's does. */
function reply(status: number, headers: Record<string, string>, bytes: Uint8Array): DownloadResponse {
  return {
    status,
    header: (name) => headers[name] ?? null,
    body: (async function* chunks() {
      for (let at = 0; at < bytes.length; at += 4096) yield bytes.slice(at, at + 4096);
    })(),
  };
}
