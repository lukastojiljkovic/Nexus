/**
 * The `nx-map:` read protocol (ADR-118): a downloaded region's PMTiles file,
 * for the map to read by ranges, as `nx-pack:` serves a pack's (ADR-100).
 *
 * **What it will serve.** Only a file `regions.json` names, which `registry.ts`
 * only keeps when the name is the one its id, build and detail make. A partial
 * download, the registry itself and any other path are 404s by not being in
 * that list, so no comparison of paths has to be kept right.
 */

import { statSync } from "node:fs";
import { join } from "node:path";

import { fileResponse } from "../../../../main/packs/protocol.js";
import { mapsDir, readRegions } from "./registry.js";

export const MAP_SCHEME = "nx-map";

/** The one host the scheme answers on. */
const HOST = "region";

/** Where the map reads an installed region's file. */
export function regionUrl(file: string): string {
  return `${MAP_SCHEME}://${HOST}/${file}`;
}

/** The request handler, electron-free so it can be driven with a `Request` in a test. */
export function createMapProtocolHandler(deps: { readonly userData: string }): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const name = url.pathname.replace(/^\//, "");
    if (url.hostname !== HOST || !readRegions(deps.userData).some((region) => region.file === name)) {
      return new Response(null, { status: 404 });
    }
    const file = join(mapsDir(deps.userData), name);
    try {
      return fileResponse(request, file, statSync(file).size, "application/octet-stream");
    } catch {
      return new Response(null, { status: 404 });
    }
  };
}
