import type { CustomScheme } from "electron";

import { MAP_SCHEME } from "../modules/maps/main/regions/protocol.js";

/**
 * What every read protocol shares. `standard` gives the URL normal parsing (a
 * host and a path), `secure` and a CSP entry are what let the page load it at
 * all, and `stream` is what lets a media client or a map read it by ranges.
 */
const READ = { standard: true, secure: true, supportFetchAPI: true, stream: true } as const;

/**
 * The app's own schemes, which `index.ts` registers as privileged at module
 * scope, before the app's "ready" event, or Electron ignores them (SEC-EL).
 *
 * **`corsEnabled` only where the page reads across origins.** The page is at
 * `file://`, so a `fetch` or a WebGL texture from one of these schemes is a
 * cross-origin request, which Chromium refuses outright on a scheme without
 * it. The map reads its regions with `fetch` and Astronomy draws the planets
 * from a pack's images, so `nx-pack:` and `nx-map:` have it; an `<img>` needs
 * no CORS, so the others do not. Their handlers answer with the headers
 * (`packs/protocol.ts`, `fileResponse`).
 */
export const PRIVILEGED_SCHEMES: readonly CustomScheme[] = [
  // ADR-014: an attachment, by the hash on the URL's host.
  { scheme: "nx-blob", privileges: READ },
  // The private section's read protocol (PRIV v1 / ADR-057): same privileges,
  // entirely different gate — it serves ONLY while a section is unlocked.
  { scheme: "priv-blob", privileges: READ },
  // ADR-100: a content pack's own files — an article's images, the arts guide's
  // images (ADR-091), the planets' textures. The handler is `packs/protocol.ts`,
  // and its gate is the installed PACK: an id no installed manifest answers for,
  // and a path that manifest does not list, are both 404s.
  { scheme: "nx-pack", privileges: { ...READ, corsEnabled: true } },
  // The offline library's read protocol (ADR-098): ZIM entries, one library per
  // host, served by `zim/zimElectron.ts` from a file on this machine.
  { scheme: "nx-zim", privileges: READ },
  // A downloaded map region (ADR-118): a PMTiles file the map reads by ranges,
  // served by `modules/maps/main/regions/protocol.ts` only when the registry names it.
  { scheme: MAP_SCHEME, privileges: { ...READ, corsEnabled: true } },
];
