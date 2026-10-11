import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { Protocol } from "electron";

import { compareVersions } from "../update/version.js";
import type { PackManifest } from "./manifest.js";
import { packPathProblem } from "./paths.js";
import { packVersionDir, readInstalled, registryPath } from "./registry.js";

/**
 * The `nx-pack:` read protocol (ADR-100): a pack's own bytes, for the pages that
 * render them.
 *
 * **Why a scheme and not an IPC read.** A reader shows images, and a reader for
 * the Maps module will stream PMTiles; both are the browser's own job - an
 * `<img src>`, a range request, a decoder Chromium already has. Handing the
 * renderer the bytes over IPC would mean buffering a whole map in JavaScript to
 * put it in a blob URL, and a `Range` request would have no way to reach the
 * disk. The scheme gives Chromium the file and keeps the DECISION here: which
 * files may be served at all.
 *
 * **What it will serve.** Only a file of an INSTALLED, signature-verified pack,
 * and only a path that pack's manifest LISTS. The three refusals are the whole
 * of the security story and each of them is a lookup rather than a comparison
 * somebody has to keep right: the pack id must be in the index, the path must be
 * one of the manifest's own entries (so `../../nexus.db` is refused by not being
 * in a list), and the manifest's paths were already refused by `packPathProblem`
 * when the pack was installed. A pack that somebody edited by hand stops being
 * listed (the index re-verifies signatures on rebuild), and then stops being
 * served with it.
 *
 * **Ranges are the point.** A media protocol without `Range` support cannot seek,
 * and a PMTiles reader asks for byte ranges constantly; so `Range` is answered
 * with a 206 and an exact `Content-Range`, an unsatisfiable one with a 416 that
 * carries the size, and a malformed one is IGNORED (200), which is what HTTP
 * says to do with a header a server does not understand.
 *
 * **The content type comes from the extension, never from the bytes.** A pack's
 * files are a stranger's, and the two types that could execute as a document are
 * refused outright: an SVG is served as `application/octet-stream` (an image
 * tag draws it, a navigation downloads it) and everything unknown is
 * `application/octet-stream` too. `nosniff` rides every answer.
 */

export const PACK_SCHEME = "nx-pack";

/** One byte range, inclusive at both ends, as HTTP states it. */
export interface PackByteRange {
  readonly start: number;
  readonly end: number;
}

export interface PackProtocolDeps {
  readonly userData: string;
  readonly publicKeyPem: string;
}

/**
 * A `Range` header against a known size: the range to serve, `"unsatisfiable"`
 * when the request cannot be met from these bytes, or `null` when the header is
 * not a range this server understands.
 *
 * Only the single-range form is read. A multi-range request (`bytes=0-1,4-5`)
 * answers `null` and is served whole, which is honest: this protocol has no
 * multipart encoder, and pretending to honour a request it answered in full
 * would be worse than serving the entity the client asked a part of.
 *
 * The two failure answers are different on purpose, and it is the difference
 * RFC 9110 draws. A request that is not a range this server can read - an
 * unparseable spec, several ranges, a last byte before the first, a suffix of
 * zero - is IGNORED and the whole file is served (200). A well-formed range that
 * simply lies past the end of these bytes is UNSATISFIABLE (416, carrying the
 * size), which is the answer a media client retries from.
 */
export function parseRangeHeader(
  header: string | null,
  size: number,
): PackByteRange | "unsatisfiable" | null {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    // A suffix range: the LAST n bytes. `bytes=-0` asks for nothing.
    const wanted = Number(rawEnd);
    if (!Number.isSafeInteger(wanted) || wanted <= 0) return null;
    if (size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - wanted), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(size - 1, Number(rawEnd));
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end };
}

/**
 * The type a pack's file is served as. Extensions only - see this file's header
 * for why an SVG is not `image/svg+xml` and why the default is octet-stream.
 */
export function packContentType(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "md":
    case "txt":
      return "text/plain; charset=utf-8";
    case "json":
      return "application/json";
    case "woff2":
      return "font/woff2";
    case "ttf":
      return "font/ttf";
    case "pmtiles":
    case "pbf":
    case "mvt":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

/** One installed pack, as this protocol needs it: the manifest and where its files lie. */
interface ServedPack {
  readonly manifest: PackManifest;
  readonly dir: string;
}

/**
 * The installed packs, memoised against the index file's own mtime and size.
 *
 * The cache is not an optimisation anybody would miss on one image; it is what
 * stops a page of twenty images from re-reading AND RE-VERIFYING every installed
 * pack's signature twenty times (`readInstalled` checks each manifest's Ed25519
 * signature, which is the right cost once and the wrong cost per request). The
 * key is the index's own stat, so an install, a removal or a hand edit misses
 * the cache on the very next request.
 */
function installedCache(deps: PackProtocolDeps): (packId: string) => ServedPack | null {
  let key: string | null = null;
  let packs = new Map<string, ServedPack>();
  return (packId) => {
    try {
      const stats = statSync(registryPath(deps.userData));
      const stamp = `${String(stats.mtimeMs)}:${String(stats.size)}`;
      if (stamp !== key) {
        key = stamp;
        packs = new Map();
        for (const installed of readInstalled(deps.userData, deps.publicKeyPem)) {
          const id = installed.manifest.id;
          const current = packs.get(id);
          // Only the newest version of an id is served: the older folder is what
          // an interrupted upgrade left, and serving files out of it would mix
          // two versions of one book.
          const newer =
            current === undefined ||
            (compareVersions(installed.manifest.version, current.manifest.version) ?? 0) > 0;
          if (newer) {
            packs.set(id, {
              manifest: installed.manifest,
              dir: packVersionDir(deps.userData, id, installed.manifest.version),
            });
          }
        }
      }
    } catch {
      // No index yet, or one that cannot be read: nothing is served, and the next
      // request tries again (a rebuild writes the index).
      key = null;
      packs = new Map();
    }
    return packs.get(packId) ?? null;
  };
}

/** The request handler, electron-free so it can be driven with a `Request` in a test. */
export function createPackProtocolHandler(
  deps: PackProtocolDeps,
): (request: Request) => Promise<Response> {
  const find = installedCache(deps);

  return async (request) => {
    const url = new URL(request.url);
    const packId = url.hostname;
    let path: string;
    try {
      // The manifest's paths are written `/`-separated and may hold spaces, so the
      // request's own escaping is undone before the comparison. A malformed escape
      // is a request this server cannot read, not a path it should guess at.
      path = decodeURIComponent(url.pathname.replace(/^\//, ""));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (packId === "" || path === "") return new Response(null, { status: 404 });

    const pack = find(packId);
    if (pack === null) return new Response(null, { status: 404 });
    // The gate: a path the manifest does not list is not a file this protocol can
    // serve, whatever it looks like. `packPathProblem` is asked again because the
    // path arrives from a URL rather than from the manifest.
    if (packPathProblem(path) !== null) return new Response(null, { status: 404 });
    if (!pack.manifest.files.some((file) => file.path === path)) {
      return new Response(null, { status: 404 });
    }

    const file = joinPackFile(pack.dir, path);
    let size: number;
    try {
      const stats = statSync(file);
      if (!stats.isFile()) return new Response(null, { status: 404 });
      size = stats.size;
    } catch {
      // A pack whose bytes were removed by hand: the manifest lists it and the
      // disk does not have it, which is a 404 rather than an exception.
      return new Response(null, { status: 404 });
    }

    const headers = new Headers({
      "Content-Type": packContentType(path),
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });

    const range = parseRangeHeader(request.headers.get("range"), size);
    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${String(size)}`);
      return new Response(null, { status: 416, headers });
    }
    if (range === null) {
      headers.set("Content-Length", String(size));
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
        status: 200,
        headers,
      });
    }

    headers.set("Content-Length", String(range.end - range.start + 1));
    headers.set("Content-Range", `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`);
    return new Response(
      Readable.toWeb(createReadStream(file, { start: range.start, end: range.end })) as ReadableStream,
      { status: 206, headers },
    );
  };
}

/**
 * Registers the handler on Electron's `protocol`, which is passed in rather than
 * imported so this file stays testable. Called once, inside `app.whenReady()`
 * after the scheme was registered as privileged at module scope - Electron
 * ignores a privileged registration made any later.
 */
export function registerPackProtocol(
  protocol: Pick<Protocol, "handle">,
  deps: PackProtocolDeps,
): void {
  protocol.handle(PACK_SCHEME, (request) => createPackProtocolHandler(deps)(request));
}

/** `dir` joined with a pack path's `/`-separated segments, on any platform. */
function joinPackFile(dir: string, path: string): string {
  return join(dir, ...path.split("/"));
}
