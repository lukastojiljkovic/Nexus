import { isValidLibraryId } from "./libraries.js";
import { zimPathFromUrlPath } from "./paths.js";

/**
 * `nx-zim://<library id>/<entry path>` — the rule, as a pure function, and the
 * headers one answer carries.
 *
 * **Why a privileged scheme rather than an IPC call that returns bytes.** A ZIM
 * page is HTML that links to other ZIM pages and to a hundred images beside it.
 * Serving that through IPC would mean the renderer parsing and rewriting every
 * document — a sanitiser, in a renderer, on content nobody has validated — where
 * a scheme lets the browser's own loader do what it does, and lets the page in
 * the iframe be a real document at a real origin with a real relative base.
 *
 * **Why the answer is a Response with a CSP of its own.** The pack's HTML was
 * written by whoever built it, so the document gets the narrowest policy that
 * still renders an article: nothing but `nx-zim:` subresources, no scripts, no
 * connections, no forms, no nested frames. `srv:` is deliberately absent — an
 * absolute external URL inside a pack is a link, and links leave through the
 * external-link rule in `external.ts` rather than being fetched by the page.
 *
 * **Why the parsing lives in a file with no Electron import.** The rule is
 * three statements about a URL, and three statements are testable; the
 * `protocol.handle` call around them is not (there is no Electron under Vitest).
 * `protocolElectron.ts` is that call and nothing else.
 */

/** One thing the page asked the scheme for, once it has been understood. */
export interface ZimRequest {
  readonly libraryId: string;
  /** The `namespace + "/" + path` name of the entry. */
  readonly zimPath: string;
}

/** What one served entry is: its MIME type, its bytes, and whether it is a document. */
export interface ZimServeResult {
  readonly mime: string;
  readonly bytes: Uint8Array;
  /** HTML gets the CSP and the iframe's document treatment; an image is just bytes. */
  readonly html: boolean;
}

/**
 * The URL a page asked for, as a library and an entry, or `null`.
 *
 * The query string and the fragment are ignored rather than refused: a pack's own
 * links carry fragments (`#section`) and a reader that dropped the navigation
 * because of one would break a table of contents. Everything that matters is in
 * the host (the library) and the pathname (the entry).
 */
export function parseZimRequest(url: string): ZimRequest | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "nx-zim:") return null;
  // A `standard` scheme lower-cases its host, so this is the lower-cased id —
  // which `isValidLibraryId` accepts and nothing else does.
  const libraryId = parsed.hostname;
  if (!isValidLibraryId(libraryId)) return null;
  const zimPath = zimPathFromUrlPath(parsed.pathname);
  if (zimPath === null) return null;
  return { libraryId, zimPath };
}

/**
 * The policy every ZIM document is served under.
 *
 * Written out rather than built from parts because a policy is read by a person
 * once and by a browser on every request; the two directives that could be
 * loosened by accident are `script-src 'none'` (a Zimit pack's JavaScript is
 * exactly what must not run) and `connect-src 'none'` (nothing in a ZIM has any
 * business making a request).
 */
export const ZIM_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "img-src nx-zim: data:",
  "media-src nx-zim:",
  "font-src nx-zim:",
  "style-src nx-zim: 'unsafe-inline'",
].join("; ");

/** Whether a MIME type is one of the document types a pack writes. */
export function isHtmlMime(mime: string): boolean {
  const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "text/html" || type === "application/xhtml+xml";
}

/**
 * The headers one answer carries.
 *
 * `no-store` rather than a long cache: a ZIM file is large and the reader has its
 * own cluster cache, so a second copy in Chromium's HTTP cache would be memory
 * spent twice on the machine that can least afford it. The CSP is applied to
 * documents only — an image does not need one, and a policy on a PNG is a header
 * nobody reads.
 */
export function zimResponseHeaders(mime: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": mime,
    "cache-control": "no-store",
    // Every ZIM entry is local content: there is no origin it could be a
    // credential for, and saying so keeps a pack from being treated as one.
    "x-content-type-options": "nosniff",
  };
  if (isHtmlMime(mime)) headers["content-security-policy"] = ZIM_CSP;
  return headers;
}

/** What a served answer looks like from above: the headers a browser reads and the body it renders. */
export interface ZimServer {
  /** One entry, or `null` when this build serves nothing at that address. */
  serve(request: ZimRequest): ZimServeResult | null;
}
