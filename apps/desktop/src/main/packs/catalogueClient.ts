/**
 * Fetching the signed catalogue (ADR-103): two small files, one rule, one
 * cache.
 *
 * **The document is trusted because of its signature and nothing else.** It
 * comes from one compiled-in address (`PACK_CATALOGUE_URL`), over https, on a
 * host the compiled-in download list holds, and it is accepted only when the
 * release key's detached signature over its exact bytes — under the catalogue
 * context, never the manifest's — checks out. It is then parsed by
 * `catalogue.ts`, which refuses every field it does not define.
 *
 * **The hop rule is the download service's, and it is re-stated here for one
 * reason.** `download/service.ts` refuses any request without an expected
 * SHA-256, and the catalogue has no hash to expect: what pins it is a signature
 * over the document itself, which cannot be known before the document arrives.
 * So this module follows the same rule the service does — the allowlist is
 * consulted before each request AND before following a `Location`, so a
 * redirect into a foreign host costs one request and not two — over a body read
 * with a cap, because the reply's size is not known until it arrives.
 *
 * Read once per launch and kept in memory: the catalogue changes when the
 * maintainer publishes, not while a card is open, and a screen that re-fetched
 * it on every mount would make one page-load one network round trip per window.
 * `reload` exists for the card's own refresh button.
 */

import type { DownloadHttp, DownloadResponse } from "../download/service.js";
import { modeAllowsDownloads, type NetworkMode } from "../net/offline.js";
import { UPDATE_LIMITS } from "../update/limits.js";
import {
  PACK_CATALOGUE_SIGNATURE_URL,
  PACK_CATALOGUE_URL,
  parsePackCatalogue,
  type PackCatalogue,
} from "./catalogue.js";
import { PackError, messageOf } from "./errors.js";
import { PACK_CATALOGUE_LIMITS } from "./limits.js";
import { verifyCatalogueSignature } from "./verify.js";

/** Redirect hops followed before a chain is refused, `download/service.ts`'s number. */
const MAX_REDIRECTS = 5;

export interface CatalogueClientDeps {
  readonly http: DownloadHttp;
  readonly publicKeyPem: string;
  /** `DOWNLOAD_HOSTS`: the compiled-in list every file address must be on. */
  readonly hosts: readonly string[];
  /** `isSessionRequestAllowed(..., "downloads")`: https only, exact allowlisted hosts. */
  readonly isAllowedUrl: (url: string) => boolean;
  /** The mode this launch may ACT on. Nothing is fetched outside `"downloads"`. */
  readonly mode: () => NetworkMode;
}

export interface CatalogueClient {
  /** The verified catalogue, or a `PackError`. `reload` forgets what is cached first. */
  read(reload?: boolean): Promise<PackCatalogue>;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveLocation(location: string, base: string): string | null {
  try {
    return new URL(location, base).toString();
  } catch {
    return null;
  }
}

export function createCatalogueClient(deps: CatalogueClientDeps): CatalogueClient {
  let cached: PackCatalogue | null = null;

  /**
   * One small file, whole, following only allowlisted https hops.
   *
   * A body over `limit` is refused rather than truncated: half a signature is
   * not a signature, and half a document is not one either.
   */
  async function readBounded(url: string, limit: number): Promise<Uint8Array> {
    const controller = new AbortController();
    // The whole read, bounded by the updater's own request number: two small
    // documents, and a server that has stopped answering must not hold the card
    // for the life of the window.
    const timer = setTimeout(() => {
      controller.abort();
    }, UPDATE_LIMITS.requestMs);
    try {
      let target = url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        if (!deps.isAllowedUrl(target)) {
          throw new PackError("catalogue-host", `"${target}" is not a host this app may read the catalogue from.`);
        }
        const reply = await request(target, controller.signal);
        if (isRedirect(reply.status)) {
          const location = reply.header("location");
          const next = location === null ? null : resolveLocation(location, target);
          await discard(reply.body);
          if (next === null) {
            throw new PackError("catalogue-host", "The catalogue reply redirected to an unreadable address.");
          }
          target = next;
          continue;
        }
        if (reply.status !== 200) {
          await discard(reply.body);
          throw new PackError("catalogue-unreadable", `The catalogue reply was ${String(reply.status)}.`);
        }
        return await readWhole(reply.body, limit);
      }
      throw new PackError("catalogue-host", "The catalogue reply redirected too many times.");
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(url: string, signal: AbortSignal): Promise<DownloadResponse> {
    try {
      return await deps.http.request(url, { headers: {}, signal });
    } catch (error) {
      throw new PackError("catalogue-unreadable", `The catalogue could not be fetched: ${messageOf(error)}`);
    }
  }

  async function readWhole(body: AsyncIterable<Uint8Array> | null, limit: number): Promise<Uint8Array> {
    if (body === null) throw new PackError("catalogue-unreadable", "The catalogue reply had no body.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of body) {
        total += chunk.byteLength;
        if (total > limit) {
          throw new PackError("catalogue-unreadable", `The catalogue reply is over ${String(limit)} bytes.`);
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof PackError) throw error;
      throw new PackError("catalogue-unreadable", `The catalogue could not be read: ${messageOf(error)}`);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }

  async function discard(body: AsyncIterable<Uint8Array> | null): Promise<void> {
    if (body === null) return;
    for await (const _chunk of body) {
      // A redirect's body is never the document; it is read and dropped so the
      // socket closes rather than being left for a reply nobody wants.
      break;
    }
  }

  return {
    async read(reload = false): Promise<PackCatalogue> {
      if (!modeAllowsDownloads(deps.mode())) {
        throw new PackError("downloads-off", "This launch is not in the mode that allows downloads.");
      }
      if (!reload && cached !== null) return cached;

      const bytes = await readBounded(PACK_CATALOGUE_URL, PACK_CATALOGUE_LIMITS.documentBytes);
      const signature = await readBounded(
        PACK_CATALOGUE_SIGNATURE_URL,
        PACK_CATALOGUE_LIMITS.signatureBytes,
      );
      if (!verifyCatalogueSignature({ catalogueBytes: bytes, signatureBytes: signature, publicKeyPem: deps.publicKeyPem })) {
        throw new PackError(
          "catalogue-signature",
          "The catalogue's signature is not the release key's signature over these exact bytes.",
        );
      }

      let parsed: unknown;
      try {
        // `fatal`, `source.ts`'s reason: a document that is not UTF-8 is a
        // refusal rather than a string with replacement characters in it.
        parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch (error) {
        throw new PackError("catalogue-unreadable", `The catalogue is not readable JSON: ${messageOf(error)}`);
      }

      cached = parsePackCatalogue(parsed, deps.hosts);
      return cached;
    },
  };
}
