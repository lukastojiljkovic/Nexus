import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable, Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import type { WebHttp, WebHttpRequestInit, WebHttpResponse } from "./fetch.js";
import type { AddressResolver, ResolvedAddress, VettedTarget } from "./target.js";

/**
 * THE SOCKET, IN ONE FILE (ADR-097).
 *
 * This is the only module of the assistant's web service that reaches the
 * network, and it is deliberately the only one that could: `check:egress` names
 * this path and only this one, `fetch.ts` decides WHAT may be requested, and all
 * this file does is turn a VETTED TARGET into bytes.
 *
 * NODE'S OWN HTTPS STACK, AND WHY THE DEDICATED CHROMIUM SESSION IS NOT IT.
 * `net/offline.ts` carries four layers, and the layer that makes arbitrary
 * names unreachable - `host-resolver-rules`, `MAP * ~NOTFOUND` with one
 * `EXCLUDE` per pinned host - is exactly the layer a web search cannot live
 * under: its whole purpose is that the reachable set is a fact about the
 * binary, and a search result's host is a fact about the internet. The
 * alternatives were to lift that layer for any launch with the switch on (which
 * would weaken the two features that DO depend on it, an update check and a
 * content download, in a session they share) or to give this feature its own
 * socket. This is the second one, and the consequence is stated plainly in
 * ADR-097 rather than hidden: what protects this path is the gate in
 * `gate.ts`/`target.ts` and the fact that the socket exists in exactly one
 * named file, not Chromium's proxy, resolver or session rules.
 *
 * THE ADDRESS IS PINNED, which is the part that makes the SSRF check more than
 * advice. `target.ts` resolved the host and refused every answer that was not a
 * public address; the `lookup` below hands `https.request` that very address,
 * so the name is not resolved a second time between the check and the
 * connection. SNI, the `Host` header and certificate verification all still use
 * the NAME (Node takes them from `hostname`, and `lookup` only answers „which
 * address is that"), so pinning the address costs nothing in correctness.
 *
 * RESPONSES ARE DECOMPRESSED HERE. Almost every page and every API answers
 * gzip, brotli or deflate, and a client that asked for an encoding it cannot
 * read would hand `extract.ts` binary. The caps that matter are counted on the
 * DECOMPRESSED stream (`fetch.ts`), which is also the only place a compression
 * bomb can be caught.
 */

/**
 * The real resolver: the operating system's, through `dns.lookup`.
 *
 * `{ all: true }` because `target.ts` needs EVERY answer, not the first: a name
 * that resolves to one public and one private address is refused, and a
 * resolver port that answered only the first address could not say that.
 * `verbatim: true` keeps the system's own order, which is the order Happy
 * Eyeballs wants when the connection is made.
 *
 * `dns.lookup` rather than `dns.resolve4`/`resolve6`: these requests go to
 * ordinary web hosts, and an ordinary web host is named the way the host's own
 * `resolv.conf`/`hosts` file says it is - including the entries a VPN or a
 * hosts file adds. A resolver that ignored those would disagree with every
 * other program on the machine about what a name means.
 */
export function createDnsResolver(): AddressResolver {
  return async (hostname: string): Promise<readonly ResolvedAddress[]> => {
    const answers: readonly LookupAddress[] = await dnsLookup(hostname, { all: true, verbatim: true });
    return answers.map((answer) => ({ address: answer.address, family: answer.family === 6 ? 6 : 4 }));
  };
}

/** The shape `https.request`'s `lookup` option has, spelled with the `dns` types it is built from. */
export type PinnedLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => void;

/**
 * A `lookup` that answers with the vetted addresses and never consults DNS.
 *
 * Both of `dns.lookup`'s reply shapes are honoured, because which one Node asks
 * for depends on `autoSelectFamily` and on the requested family: with
 * `all: true` it wants the list (and tries them in order), and otherwise it
 * wants one address and its family. A requested family that no vetted address
 * has is an ERROR rather than a silent substitution - connecting over IPv4 to
 * an address the caller asked to reach over IPv6 would be this file making a
 * decision the gate did not.
 *
 * Exported because it is the whole of the pinning rule and needs no socket to
 * be tested: a table of addresses in, a callback out.
 */
export function pinnedLookup(addresses: readonly ResolvedAddress[]): PinnedLookup {
  return (_hostname, options, callback) => {
    const requested = options.family;
    const family = requested === 4 || requested === "IPv4" ? 4 : requested === 6 || requested === "IPv6" ? 6 : 0;
    const available = family === 0 ? addresses : addresses.filter((entry) => entry.family === family);
    const first = available[0];
    if (first === undefined) {
      const error: NodeJS.ErrnoException = new Error("Nexus web: no vetted address for the requested family");
      error.code = "ENOTFOUND";
      callback(error, "");
      return;
    }
    if (options.all === true) {
      callback(null, available.map((entry) => ({ address: entry.address, family: entry.family })));
      return;
    }
    callback(null, first.address, first.family);
  };
}

/**
 * The transport, as {@link WebHttp}.
 *
 * `redirect: manual` has no equivalent here and needs none: `https.request`
 * never follows a `Location`, which is the property `fetch.ts` requires of this
 * port - it is what puts the redirect rule in the service rather than in the
 * socket, and therefore on the code path production actually walks.
 */
export function createHttpsTransport(): WebHttp {
  return {
    request(target: VettedTarget, init: WebHttpRequestInit): Promise<WebHttpResponse> {
      return new Promise<WebHttpResponse>((resolve, reject) => {
        const port = target.url.port === "" ? 443 : Number(target.url.port);
        const request = httpsRequest({
          protocol: "https:",
          hostname: target.hostname,
          port,
          path: `${target.url.pathname}${target.url.search}`,
          method: "GET",
          headers: { ...init.headers, host: target.url.host },
          lookup: pinnedLookup(target.addresses),
          signal: init.signal,
          rejectUnauthorized: true,
        });

        // The whole-request deadline, and the idle deadline, both end in
        // `destroy`: a request to a host that accepted a connection and then
        // stopped talking must not hold the assistant's turn open. The socket
        // timeout is an INACTIVITY timer (Node resets it on every byte), so a
        // large page that keeps arriving is never cut off by it.
        let done = false;
        const stopTimers = (): void => {
          if (done) return;
          done = true;
          clearTimeout(deadline);
        };
        const deadline = setTimeout(() => {
          request.destroy(new Error("Nexus web: the request timed out"));
        }, init.timeoutMs);
        request.setTimeout(init.idleTimeoutMs, () => {
          request.destroy(new Error("Nexus web: the request went idle"));
        });

        request.on("response", (response: IncomingMessage) => {
          resolve({
            status: response.statusCode ?? 0,
            header: (name) => headerOf(response, name),
            body: decodeBody(response, stopTimers),
          });
        });
        request.on("error", (error: Error) => {
          stopTimers();
          reject(error);
        });
        request.end();
      });
    },
  };
}

/** One header by its lower-case name, or `null`. `set-cookie` is the only array Node returns here. */
function headerOf(response: IncomingMessage, name: string): string | null {
  const value = response.headers[name.toLowerCase()];
  return typeof value === "string" ? value : null;
}

/** The decompressor a `Content-Encoding` names, or `null` when the body is already text. */
function decompressorFor(encoding: string | undefined): Transform | null {
  if (encoding === undefined) return null;
  switch (encoding.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return createGunzip();
    case "deflate":
      return createInflate();
    case "br":
      return createBrotliDecompress();
    // `identity` and an encoding this build does not know are both handed on as
    // they arrived: reading a body as text is `fetch.ts`'s job, and a wrong
    // guess here would corrupt a page instead of failing it.
    default:
      return null;
  }
}

/**
 * The response body as bytes, decompressed, with the request's deadline cleared
 * when the last byte has been read.
 *
 * A generator rather than a `TransformStream` for `download/electron.ts`'s
 * reason: the consumer abandoning the body (which `fetch.ts` does for a
 * redirect, and for every byte over its cap) runs the `finally` - where both
 * streams are DESTROYED rather than only unlocked, because releasing a socket
 * nobody will read is what leaves a request hanging.
 */
async function* decodeBody(
  response: IncomingMessage,
  onDone: () => void,
): AsyncGenerator<Uint8Array> {
  const decoder = decompressorFor(response.headers["content-encoding"]);
  try {
    if (decoder === null) {
      for await (const chunk of response) yield asBytes(chunk);
      return;
    }
    response.pipe(decoder);
    for await (const chunk of decoder) yield asBytes(chunk);
  } finally {
    destroyQuietly(response);
    if (decoder !== null) destroyQuietly(decoder);
    onDone();
  }
}

/** A stream chunk as bytes. Node hands a `Buffer`; the cast is the whole of it. */
function asBytes(chunk: unknown): Uint8Array {
  return chunk instanceof Uint8Array ? chunk : new Uint8Array(0);
}

/** Destroys a stream that may already be closed, and never throws while abandoning one. */
function destroyQuietly(stream: Readable | Transform): void {
  try {
    stream.destroy();
  } catch {
    // Already gone: a destroy that failed must not replace the reason the body
    // was abandoned.
  }
}
