import { readFileSync, statSync } from "node:fs";
import { protocol } from "electron";
import { resolveArtFile } from "./artFile.js";

/**
 * The `nx-pack:` read protocol: the arts guide's images, served from a signed
 * content pack without the renderer ever being handed a path.
 *
 * **Why a protocol rather than an IPC op that returns bytes.** A gallery grid
 * asks for the same picture many times as the user scrolls, browses and comes
 * back; over IPC each ask would copy the megabytes into the renderer again and
 * the renderer would have to hold every one of them in a `Blob` it must
 * remember to revoke. A protocol gets Chromium's own HTTP cache, and a picture
 * scrolled past and back is served from memory once.
 *
 * **Why the renderer is not given a file path.** It never is: the URL names a
 * pack, a version and a path INSIDE the pack, and `resolveArtFile` turns that
 * into a file only if the pack is installed, verified and lists the path. A
 * `file://` URL never exists here, exactly as it does not for attachment bytes
 * (`nx-blob:`) or the private section (`priv-blob:`).
 *
 * The response is an image and says so: the mime comes from the path's
 * extension, which is a closed set of six picture types, and `nosniff` is set
 * so nothing can reinterpret the bytes. `Cache-Control: immutable` is honest -
 * a pack's path is fixed by its signed manifest, so the content at that URL can
 * never change under the same version.
 */

/** The largest image this protocol serves (32 MiB) - past any artwork, and a bound so one request cannot read an unbounded file. */
export const MAX_ART_IMAGE_BYTES = 33_554_432;

export interface PackProtocolDeps {
  /** Read lazily: the packs directory lives under the SELECTED account (ADR-044). */
  readonly userData: () => string;
  readonly publicKeyPem: string;
}

export function registerPackProtocol(deps: PackProtocolDeps): void {
  protocol.handle("nx-pack", (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response(null, { status: 404 });
    }
    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
    const version = segments[0];
    if (version === undefined) return new Response(null, { status: 404 });
    const resolved = resolveArtFile(
      { id: url.hostname, version, path: segments.slice(1).join("/") },
      deps.userData(),
      deps.publicKeyPem,
    );
    if (resolved === null) return new Response(null, { status: 404 });

    let bytes: Uint8Array;
    try {
      if (statSync(resolved.absolutePath).size > MAX_ART_IMAGE_BYTES) {
        return new Response(null, { status: 404 });
      }
      bytes = readFileSync(resolved.absolutePath);
    } catch {
      // A file deleted from disk behind the manifest's back is a 404, not a
      // generic network error surfacing in the renderer.
      return new Response(null, { status: 404 });
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": resolved.mime,
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });
}
