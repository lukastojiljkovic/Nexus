import { protocol, shell, type Session, type WebContents } from "electron";

import { handleFrameNavigation } from "./external.js";
import { parseZimRequest, zimResponseHeaders, type ZimServer } from "./protocol.js";
import { ZIM_SCHEME } from "./scheme.js";

/**
 * The Electron half of the ZIM module: everything that needs a browser process,
 * and NOTHING that decides anything.
 *
 * Three small functions, and each is the same shape `download/electron.ts` and
 * `update/electron.ts` established: the rules live in a file with no `electron`
 * import (so they can be tested), and this file is the wiring that hands them a
 * session, a response or a browser. Nothing here reads a ZIM, decides which host
 * is reachable or chooses which entry a path means.
 *
 * **The small fetches go through the DEDICATED session**, not the renderer's and
 * not Node's: `ses.fetch` is what the launch's `host-resolver-rules` and the
 * mode-aware `onBeforeRequest` allowlist apply to, so the OPDS feed and a pack's
 * `.meta4` are reachable exactly when, and only when, the launch's network mode
 * says a download may happen. Node's `fetch` would go through none of that.
 */

/** The largest document this feature fetches: the catalogue feed, or a pack's Metalink file. */
export const ZIM_FETCH_LIMIT_BYTES = 16 * 1024 * 1024;

/** How long a small fetch may take. The feed is a few megabytes; a minute is generous and bounded. */
const ZIM_FETCH_TIMEOUT_MS = 60_000;

/** The one thing the catalogue needs from the network: a small document as text. */
export interface ZimHttp {
  get(url: string): Promise<{ status: number; body: string }>;
}

export function createZimHttp(session: Session): ZimHttp {
  return {
    async get(url) {
      const response = await session.fetch(url, {
        headers: { accept: "application/atom+xml, application/xml;q=0.9, */*;q=0.1" },
        signal: AbortSignal.timeout(ZIM_FETCH_TIMEOUT_MS),
      });
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isSafeInteger(declared) && declared > ZIM_FETCH_LIMIT_BYTES) {
        throw new Error(`The reply declares ${String(declared)} bytes, over this feature's limit.`);
      }
      const body = await response.text();
      if (body.length > ZIM_FETCH_LIMIT_BYTES) {
        throw new Error("The reply is larger than this feature will read.");
      }
      return { status: response.status, body };
    },
  };
}

/**
 * Serves `nx-zim://` from `server`, for the rest of the process's life.
 *
 * The handler is registered once, at startup, and answers `404` for anything the
 * server does not claim — a library this machine does not have, or an entry a
 * path rule refused. A `404` rather than an exception because the caller is a
 * document loader: it wants a status, and a rejected promise from
 * `protocol.handle` is a blank frame with the reason only in the console.
 */
export function installZimProtocol(server: ZimServer): void {
  protocol.handle(ZIM_SCHEME, async (request) => {
    const target = parseZimRequest(request.url);
    const served = target === null ? null : server.serve(target);
    if (served === null || target === null) {
      return new Response("This ZIM entry is not available.", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response(served.bytes, {
      status: 200,
      headers: zimResponseHeaders(served.mime),
    });
  });
}

/**
 * The external-link rule, installed on the window that draws module pages.
 *
 * `will-frame-navigate` rather than `will-navigate`, and the difference is the
 * whole point: a ZIM is a document in a SUBFRAME, so the shell's existing
 * `will-navigate` handler never sees its links. This one fires for every frame,
 * and `external.ts` decides — inside the ZIM stays, `http(s)` goes to the user's
 * browser, everything else is dropped.
 *
 * `openInBrowser` is `shell.openExternal`, called with a URL that has already
 * been reduced to an `http(s)` one by the rule above. That is the same hand-off
 * `update/electron.ts` makes to the same loader, and the same argument applies:
 * the loader is the user's own browser rather than this process's network stack.
 */
export function installExternalLinkRule(contents: WebContents): void {
  contents.on("will-frame-navigate", (details) => {
    handleFrameNavigation(
      // A frame that has already gone is not a frame this rule knows anything
      // about; an empty URL is not a ZIM URL, so the rule stands down.
      { url: details.url, frameUrl: details.frame?.url ?? "" },
      {
        preventDefault: () => details.preventDefault(),
        openInBrowser: (url) => {
          void shell.openExternal(url);
        },
      },
    );
  });
}
