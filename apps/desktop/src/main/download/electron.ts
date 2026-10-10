import type { Session } from "electron";

import { UPDATE_LIMITS } from "../update/limits.js";
import type { DownloadHttp, DownloadResponse } from "./service.js";

/**
 * The Electron half of the download service: everything that needs a browser
 * process is here and NOTHING that decides anything. `service.ts` chooses what
 * to request, whether the next hop is allowed and whether the bytes are the
 * bytes; this file only turns a session into the `DownloadHttp` port.
 *
 * It fetches on the dedicated session `main/index.ts` creates — the same
 * non-persistent, directly-connected session the update check uses (the
 * partition keeps ADR-089's name; ADR-092 is its second tenant). That is not a
 * convenience: a request made with Node's own `fetch` resolves names in Node,
 * where the launch's `host-resolver-rules` block does not exist, so it would
 * step around the layer that maps every name but the allowlisted ones to
 * NOTFOUND. The session's own `onBeforeRequest` rule is the second gate, and it
 * checks each hop of a redirect chain as well.
 *
 * `redirect: "manual"` IS LOAD-BEARING, and it is the reason this port exists
 * rather than the service taking a `fetch`. The service consults the allowlist
 * before each hop; a port that followed redirects itself would let Chromium
 * take a hop this process never saw, and the rule the service enforces would be
 * enforced on a code path production does not walk. `opaqueredirect` — the
 * shape a browser hands back when `manual` is filtered — is refused rather than
 * read, because a status this code cannot see is a destination it cannot vouch
 * for.
 *
 * NOBODY CONSTRUCTS THIS YET, deliberately: the mode is the whole of this run's
 * IPC and no surface starts a download, so the first caller is the content-pack
 * surface a later run adds. It is written now because the alternative is that
 * caller inventing its own socket.
 */
export function createDownloadHttp(ses: Session): DownloadHttp {
  return {
    async request(url, init) {
      // The caller's signal (a pause, a cancel) and the idle deadline both have
      // to stop this request, and only one of them can be `ses.fetch`'s signal —
      // so this port owns a controller and forwards the caller's to it.
      const controller = new AbortController();
      const forwardAbort = (): void => {
        controller.abort();
      };
      init.signal.addEventListener("abort", forwardAbort, { once: true });

      // The installer's idle deadline, reused rather than re-chosen: a slow but
      // live download may take as long as it takes, while a connection that has
      // stopped sending must not hold one of the two slots for ever. Reset on
      // every chunk, which is why the body is wrapped below.
      let idle = setTimeout(() => controller.abort(), UPDATE_LIMITS.downloadIdleMs);
      const resetIdle = (): void => {
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), UPDATE_LIMITS.downloadIdleMs);
      };
      const stop = (): void => {
        clearTimeout(idle);
        init.signal.removeEventListener("abort", forwardAbort);
      };

      let response: Response;
      try {
        response = await ses.fetch(url, {
          headers: { ...init.headers },
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        stop();
        throw error;
      }

      if (response.type === "opaqueredirect" || response.status === 0) {
        stop();
        throw new Error("Nexus download: the redirect could not be read");
      }

      const body = response.body;
      const head: Omit<DownloadResponse, "body"> = {
        status: response.status,
        header: (name) => response.headers.get(name),
      };
      if (body === null) {
        stop();
        return { ...head, body: null };
      }
      return { ...head, body: withIdleDeadline(body, resetIdle, stop) };
    },
  };
}

/**
 * The reply body, with the idle deadline reset for every chunk.
 *
 * A generator rather than a `TransformStream`, so that the consumer abandoning
 * the body (the service does exactly that for a redirect and for a `416`) runs
 * the `finally` — where the reader is CANCELLED rather than only unlocked, and
 * the timer is cleared. Releasing a lock without cancelling is what leaves a
 * fetch hanging on a connection nobody will read.
 */
async function* withIdleDeadline(
  body: ReadableStream<Uint8Array>,
  onChunk: () => void,
  onDone: () => void,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value === undefined) continue;
      onChunk();
      yield value;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The body is already being abandoned; a cancel that also failed must not
      // replace the reason for abandoning it.
    }
    reader.releaseLock();
    onDone();
  }
}
