import type { Readable } from "node:stream";

import { net, type ClientRequest, type IncomingMessage, type Session } from "electron";

import { UPDATE_LIMITS } from "../update/limits.js";
import type { DownloadHttp, DownloadResponse } from "./service.js";

/**
 * The Electron half of the download service: everything that needs a browser
 * process is here and NOTHING that decides anything. `service.ts` chooses what
 * to request, whether the next hop is allowed and whether the bytes are the
 * bytes; this file only turns a session into the `DownloadHttp` port.
 *
 * It requests on the dedicated session `main/index.ts` creates — the same
 * non-persistent, directly-connected session the update check uses (the
 * partition keeps ADR-089's name; ADR-092 is its second tenant). That is not a
 * convenience: a request made with Node's own `fetch` resolves names in Node,
 * where the launch's `host-resolver-rules` block does not exist, so it would
 * step around the layer that maps every name but the allowlisted ones to
 * NOTFOUND. The session's own `onBeforeRequest` rule is the second gate, and it
 * checks each hop of a redirect chain as well.
 *
 * THE PORT ANSWERS A `3xx` AND NEVER FOLLOWS IT, and that is the reason it is
 * built on `net.request` rather than `session.fetch`. The service consults the
 * allowlist before each hop; a port that followed redirects itself would let
 * Chromium take a hop this process never saw. `session.fetch` cannot honour
 * that: with `redirect: "manual"` Electron's fetch does not hand back the `3xx`,
 * it rejects with „Redirect was cancelled" (measured on Electron 44 against
 * GitHub's release redirect, 2026-10-14) — and every pack and catalogue file is
 * a GitHub release asset whose first hop is a `302`, so no download ever got
 * past it. `net.request` with `redirect: "manual"` emits the redirect instead;
 * this port reads its status and `Location`, aborts the request, and returns the
 * `3xx` with no body, which is exactly what the service's redirect loop expects.
 */
export function createDownloadHttp(ses: Session): DownloadHttp {
  return {
    request(url, init) {
      return new Promise<DownloadResponse>((resolve, reject) => {
        const request = net.request({ url, session: ses, redirect: "manual", useSessionCookies: false });
        for (const [name, value] of Object.entries(init.headers)) request.setHeader(name, value);

        // The caller's signal (a pause, a cancel) and the idle deadline both end
        // the request. Before the reply arrives that is an abort, which rejects
        // below; once a body is streaming, `stopBody` is what ends its reader.
        let response: Reply | null = null;
        let settled = false;
        const stopBody = (reason: string): void => {
          response?.destroy(new Error(`Nexus download: ${reason}`));
          request.abort();
        };
        const onCallerAbort = (): void => {
          stopBody("the download was stopped");
        };
        // The installer's idle deadline, reused rather than re-chosen: a slow but
        // live download may take as long as it takes, while a connection that has
        // stopped sending must not hold one of the two slots for ever. Reset on
        // every chunk, which is why the body is wrapped below.
        let idle: ReturnType<typeof setTimeout> | undefined;
        const resetIdle = (): void => {
          clearTimeout(idle);
          idle = setTimeout(() => {
            stopBody("the connection stopped sending");
          }, UPDATE_LIMITS.downloadIdleMs);
        };
        const stop = (): void => {
          clearTimeout(idle);
          init.signal.removeEventListener("abort", onCallerAbort);
        };

        request.on("redirect", (status, _method, location) => {
          // Aborted inside the handler: Electron fails a manual redirect that is
          // neither followed nor aborted before the handler returns.
          settled = true;
          stop();
          request.abort();
          resolve({
            status,
            header: (name) => (name === "location" ? location : null),
            body: null,
          });
        });
        request.on("response", (message) => {
          settled = true;
          const reply = message as Reply;
          response = reply;
          resolve({
            status: reply.statusCode,
            header: (name) => headerValue(reply.headers[name]),
            body: withIdleDeadline(reply, request, resetIdle, stop),
          });
        });
        request.on("error", (error) => {
          if (settled) return;
          settled = true;
          stop();
          reject(error);
        });
        request.on("abort", () => {
          if (settled) return;
          settled = true;
          stop();
          reject(new Error("Nexus download: the request was stopped"));
        });

        if (init.signal.aborted) {
          settled = true;
          reject(new Error("Nexus download: the request was stopped"));
          return;
        }
        init.signal.addEventListener("abort", onCallerAbort, { once: true });
        resetIdle();
        request.end();
      });
    },
  };
}

/**
 * The reply as it is at runtime: Electron's `IncomingMessage` class extends
 * Node's `Readable` (it is iterated and destroyed exactly like one), while its
 * type declarations describe only the events. Named once, here, rather than cast
 * at each use.
 */
type Reply = IncomingMessage & Readable;

/** `IncomingMessage.headers` keys are lower-case; a repeated header arrives as a list. */
function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * The reply body, with the idle deadline reset for every chunk.
 *
 * A generator, so that the consumer abandoning the body (the service does
 * exactly that for a `416`, a refused size and a hash it has stopped needing)
 * runs the `finally` — where a request that has not finished is ABORTED rather
 * than left holding a connection nobody will read, and the timer is cleared.
 */
async function* withIdleDeadline(
  body: Reply,
  request: ClientRequest,
  onChunk: () => void,
  onDone: () => void,
): AsyncGenerator<Uint8Array> {
  let finished = false;
  try {
    for await (const chunk of body as AsyncIterable<Buffer>) {
      onChunk();
      yield chunk;
    }
    finished = true;
  } finally {
    if (!finished) request.abort();
    onDone();
  }
}
