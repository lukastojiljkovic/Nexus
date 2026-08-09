/**
 * The only place in this application that opens a socket — and the reason it is
 * `net.fetch` and not `fetch`.
 *
 * ─── Node's `fetch` would have made the cloud-off guarantee a comment ───────
 *
 * `net/offline.ts` installs four layers, three of which are Chromium's: the
 * `webRequest` allowlist that cancels anything not on the list, the dead proxy,
 * and the resolver block. All three act on requests that go through a session.
 * Node's global `fetch` in the main process goes through none of them — it is
 * undici, on its own socket, with its own DNS — so a sync client written with it
 * would have sent packets with cloud switched off, and there would have been
 * nothing in a code review to see. Electron's own words for the method used
 * here: it "issues requests from the default session … webRequest handlers will
 * still be triggered". That is the whole reason this file exists.
 *
 * ─── Everything else here is a capability being declined ────────────────────
 *
 * `credentials: "omit"` — the default session holds the cookies of every page
 * the app has ever loaded, and a sync request has no business carrying one.
 * `redirect: "error"` — PostgREST and Edge Functions never redirect, so a
 * redirect is either a captive portal or a server trying to move this request
 * somewhere the caller did not name. `cache: "no-store"` — a response here is
 * ciphertext keyed by a cursor, and a cached copy is only ever a stale one.
 * A timeout, because a hung socket otherwise hangs the enable flow with no
 * screen to say so. And a byte cap, so an unbounded body fails by name.
 *
 * This file is deliberately the whole of the impurity: it holds no URL, no key,
 * no token and no retry. `port.ts` is pure and tested; this is twenty lines that
 * a reviewer can hold in their head at once.
 */

import { net } from "electron";
import type { HttpResponse } from "@nexus/sync-transport";

import { MAX_RESPONSE_BYTES, type CloudFetch } from "./port.js";

/**
 * How long one request may take end to end.
 *
 * Generous on purpose: `sync-enable` runs an Argon2id verification server-side
 * and a first pull can be a large page over a slow link. What this is protecting
 * against is not slowness but a socket that never answers at all — which,
 * without it, is a spinner with no end and no message.
 */
export const CLOUD_REQUEST_TIMEOUT_MS = 60_000;

/** Thrown for the two failures that are this layer's own, rather than a status. */
export class CloudFetchError extends Error {
  override readonly name = "CloudFetchError";
  constructor(
    readonly code: "timeout" | "too-large" | "network",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * Reads a body with a running byte count.
 *
 * `response.text()` would be one line, and would be one line that builds an
 * arbitrarily large JavaScript string — past roughly 512 MiB V8 refuses with
 * `Invalid string length`, which arrives with no indication of what asked for
 * it. Counting as the chunks arrive turns that into a named refusal, and lets
 * the read be abandoned rather than completed and then discarded.
 */
async function readCapped(response: GlobalResponse): Promise<string> {
  const body = response.body;
  if (body === null) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new CloudFetchError(
          "too-large",
          `sync: the server sent more than ${MAX_RESPONSE_BYTES} bytes`,
        );
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    // Releases the socket whether the read finished or the cap ended it. Without
    // it, a refused body would leave the connection draining in the background.
    await reader.cancel().catch(() => undefined);
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/**
 * The one {@link CloudFetch} the product ships.
 *
 * Deliberately not a factory and not configurable: every knob it might take is
 * a knob that could be set to a value that leaves the session, and the value of
 * this file is that there is exactly one way it can behave.
 */
export const electronCloudFetch: CloudFetch = async (request): Promise<HttpResponse> => {
  let response: GlobalResponse;
  try {
    response = await net.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === null ? {} : { body: request.body }),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(CLOUD_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    // A cancelled request looks identical here whether the cloud-off layer
    // cancelled it, the host does not resolve, or the server is down — and it
    // must, because distinguishing them would mean telling a caller which of
    // those it is, which is a fingerprint of the local machine.
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new CloudFetchError(
      timedOut ? "timeout" : "network",
      timedOut ? "sync: the server did not answer in time" : "sync: the request did not complete",
      { cause },
    );
  }

  return { status: response.status, body: await readCapped(response) };
};
