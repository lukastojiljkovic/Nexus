import type { NetworkMode } from "../../net/offline.js";
import type { WebConfig } from "./gate.js";
import { WEB_LIMITS } from "./limits.js";
import { vetUrl, type AddressResolver, type TargetProblem, type VettedTarget } from "./target.js";

/**
 * ONE VETTED GET, WITH EVERY HOP RE-CHECKED (ADR-097).
 *
 * The transport (`transport.ts`) makes exactly one request and answers what the
 * server said, including a `3xx` it did not follow. This module is where the
 * chain is walked, and the reason the redirect is not left to the transport is
 * the whole of `download/service.ts`'s argument about `redirect: manual` - with
 * one addition that matters more here: on the open web a redirect is a
 * destination chosen by the PAGE, so a hop is exactly the moment to re-run the
 * gate. A `302` to `http://` fails the scheme rule, one to `https://127.0.0.1/`
 * fails the address rule, and one to a name that resolves into a private range
 * fails the resolver rule - each with nothing sent to the host that failed it.
 *
 * THE CAPS ARE COUNTED, NOT DECLARED. A `Content-Length` over the limit ends the
 * request before the body is read (a hint, and a good one), and the running
 * total is checked on every chunk (the truth) - because a declared length is a
 * number a server can simply get wrong, and because a decompressed body
 * (`transport.ts`) has no declared length at all.
 *
 * WHAT IS RETURNED IS TEXT, NEVER MARKUP OR A MODEL MESSAGE. The caller
 * (`index.ts`) caps the extracted text, fences what it hands the model, and
 * labels it as data.
 */

/** One reply from the transport: a status, a header lookup, and bytes in arrival order. */
export interface WebHttpResponse {
  readonly status: number;
  /** A header by its LOWER-CASE name, or `null`. The port owns case-insensitivity. */
  header(name: string): string | null;
  /** `null` when the reply carries no body at all. */
  readonly body: AsyncIterable<Uint8Array> | null;
}

export interface WebHttpRequestInit {
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  /** Milliseconds for the whole request, body included. Enforced by the transport. */
  readonly timeoutMs: number;
  /** Milliseconds with no byte received. Enforced by the transport. */
  readonly idleTimeoutMs: number;
}

/**
 * The transport, as a port - `DownloadHttp`'s counterpart, with one difference
 * and one addition. The difference: it takes a {@link VettedTarget} rather than
 * a URL, so „the address check happened" is a property of the type and not a
 * promise the caller keeps. The addition: the timeouts travel with the call,
 * because a search reply and a whole article deserve different ones.
 *
 * Like `DownloadHttp.request`, this MUST NOT FOLLOW REDIRECTS: it answers the
 * `3xx` it was given, headers and all.
 */
export interface WebHttp {
  request(target: VettedTarget, init: WebHttpRequestInit): Promise<WebHttpResponse>;
}

/** Why a fetch ended without text. Machine codes; `copy.ts` maps each to its sentence. */
export type FetchProblem = TargetProblem | "http" | "size" | "redirects" | "network" | "aborted";

export type FetchOutcome =
  | {
      readonly ok: true;
      /** The URL the text actually came from, after any hops. */
      readonly url: string;
      readonly status: number;
      readonly bytes: number;
      readonly text: string;
    }
  | { readonly ok: false; readonly problem: FetchProblem; readonly status: number | null };

export interface WebFetchOptions {
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  /** The byte cap: `WEB_LIMITS.searchBytes` for a search reply, `readBytes` for a page. */
  readonly bytes: number;
  readonly timeoutMs: number;
}

export interface WebFetcher {
  /** One GET, caps applied, every hop re-vetted. Never throws: every ending is an outcome. */
  fetchText(url: string, options: WebFetchOptions): Promise<FetchOutcome>;
}

export interface WebFetcherDeps {
  /** The mode this launch may ACT on - `activeNetworkMode` in main, never the stored file. */
  readonly mode: () => NetworkMode;
  /** The switch as it is ON DISK at this moment: turning it off stops the next request. */
  readonly config: () => WebConfig;
  readonly resolve: AddressResolver;
  readonly http: WebHttp;
}

export function createWebFetcher(deps: WebFetcherDeps): WebFetcher {
  return {
    async fetchText(url: string, options: WebFetchOptions): Promise<FetchOutcome> {
      let current = url;
      let hops = 0;
      for (;;) {
        if (options.signal.aborted) return { ok: false, problem: "aborted", status: null };
        const vetted = await vetUrl(current, { mode: deps.mode(), config: deps.config(), resolve: deps.resolve });
        if (!vetted.ok) return { ok: false, problem: vetted.problem, status: null };

        let response: WebHttpResponse;
        try {
          response = await deps.http.request(vetted.target, {
            headers: options.headers,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
            idleTimeoutMs: WEB_LIMITS.idleTimeoutMs,
          });
        } catch {
          return options.signal.aborted
            ? { ok: false, problem: "aborted", status: null }
            : { ok: false, problem: "network", status: null };
        }

        if (isRedirect(response.status)) {
          hops += 1;
          const location = response.header("location");
          await discard(response.body);
          if (hops > WEB_LIMITS.maxRedirects) return { ok: false, problem: "redirects", status: response.status };
          if (location === null) return { ok: false, problem: "http", status: response.status };
          let next: string;
          try {
            // Relative locations are normal, so the hop is resolved against the
            // URL this process actually requested rather than against the
            // original one.
            next = new URL(location, vetted.target.url).toString();
          } catch {
            return { ok: false, problem: "http", status: response.status };
          }
          current = next;
          continue;
        }

        if (response.status < 200 || response.status >= 300) {
          await discard(response.body);
          return { ok: false, problem: "http", status: response.status };
        }

        const declared = declaredBytes(response.header("content-length"));
        if (declared !== null && declared > options.bytes) {
          // Cancelled rather than drained: this body was refused unread, and
          // reading 64 KiB of it to be polite would make the cap a suggestion.
          await cancel(response.body);
          return { ok: false, problem: "size", status: response.status };
        }

        // A body that fails mid-read - a reset connection, a truncated gzip
        // stream, an abort - is an outcome like any other: this function may
        // not throw, or the caller's refusal copy is replaced by whoever
        // catches it.
        let read: ReadOutcome;
        try {
          read = await readWithin(response.body, options.bytes);
        } catch {
          return options.signal.aborted
            ? { ok: false, problem: "aborted", status: null }
            : { ok: false, problem: "network", status: null };
        }
        if (!read.ok) return { ok: false, problem: "size", status: response.status };
        const charset = charsetFor(response.header("content-type"), read.bytes);
        return {
          ok: true,
          url: current,
          status: response.status,
          bytes: read.bytes.byteLength,
          text: decodeText(read.bytes, charset),
        };
      }
    },
  };
}

/** A status this process must look at rather than read. `304` is included and will have no `Location`. */
function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/** A declared `Content-Length` as a number, or `null` when there is none this code can trust. */
function declaredBytes(header: string | null): number | null {
  if (header === null) return null;
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Reads a body nobody wants - a redirect's, an error's - up to a small bound,
 * and abandons it.
 *
 * Bounded because a hostile server may answer a `302` with a gigabyte, and
 * abandoned by breaking out of the loop, which is what calls the iterator's
 * `return` and runs the transport's cleanup.
 */
async function discard(body: AsyncIterable<Uint8Array> | null): Promise<void> {
  if (body === null) return;
  let read = 0;
  try {
    for await (const chunk of body) {
      read += chunk.byteLength;
      if (read > 64 * 1024) break;
    }
  } catch {
    // A body that fails while being thrown away is already gone; the caller is
    // deciding what to do about the STATUS, and must not be interrupted by it.
  }
}

/**
 * Abandons a body WITHOUT reading it, which is what asking an iterator to
 * `return` does: the transport's `finally` runs, the socket is destroyed, and
 * not one byte of the reply is read into this process.
 */
async function cancel(body: AsyncIterable<Uint8Array> | null): Promise<void> {
  if (body === null) return;
  const iterator = body[Symbol.asyncIterator]();
  try {
    await iterator.return?.(undefined);
  } catch {
    // Already gone: abandoning a body must not replace the reason for it.
  }
}

type ReadOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false };

/**
 * The body, up to `limit` bytes, and a refusal the moment it grows past it.
 *
 * The refusal is what makes this a cap rather than a truncation: a page that is
 * three times the limit is a page this build cannot read, and handing the model
 * the first third of it would be presenting a partial document as the document.
 */
async function readWithin(body: AsyncIterable<Uint8Array> | null, limit: number): Promise<ReadOutcome> {
  if (body === null) return { ok: true, bytes: new Uint8Array(0) };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > limit) return { ok: false };
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * The encoding a body should be read as.
 *
 * The header wins, and where it says nothing the first two kilobytes are
 * sniffed for a `<meta charset>` - because a page that is not UTF-8 and does not
 * say so in its headers is common enough that reading it as UTF-8 would turn
 * every accented word into a replacement character. `null` means „no opinion",
 * which `decodeText` reads as UTF-8.
 */
export function charsetFor(contentType: string | null, head: Uint8Array): string | null {
  const fromHeader = charsetOf(contentType);
  if (fromHeader !== null) return fromHeader;
  // Latin-1, deliberately: this is only looking for ASCII markup, and a decoder
  // that failed on a byte would answer nothing at all.
  const prefix = Buffer.from(head.subarray(0, 2048)).toString("latin1");
  const metaCharset = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9._-]+)/i.exec(prefix);
  if (metaCharset !== null) return metaCharset[1] ?? null;
  const metaContentType = /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset=([A-Za-z0-9._-]+)/i.exec(prefix);
  return metaContentType?.[1] ?? null;
}

/** The `charset` parameter of a `Content-Type` header, or `null`. */
export function charsetOf(contentType: string | null): string | null {
  if (contentType === null) return null;
  const match = /;\s*charset\s*=\s*"?([A-Za-z0-9._-]+)"?/i.exec(contentType);
  return match?.[1] ?? null;
}

/**
 * Bytes as text, with the label the page named.
 *
 * An unknown or misspelled label is UTF-8 rather than a refusal: `TextDecoder`
 * throws a `RangeError` for a label it does not know, and a page whose charset
 * is wrong should come out with the wrong characters rather than not at all.
 * `fatal: false` is the same decision one layer down - a decoding failure
 * becomes a replacement character instead of an exception.
 */
export function decodeText(bytes: Uint8Array, charset: string | null): string {
  const label = charset === null || charset === "" ? "utf-8" : charset;
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}
