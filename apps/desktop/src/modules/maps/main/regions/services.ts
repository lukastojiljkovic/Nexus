/**
 * What MAPS' region downloads need from the process it runs in, injected
 * rather than imported (ADR-090 §3, ADR-118).
 *
 * `userData`, the launch's network mode and the download session all belong
 * to `main/index.ts`, and the session exists only after `ready`. So `index.ts`
 * hands over a function that answers them, once, and the service is built on
 * the first call a page makes, which is long after that: the way
 * `zimService()` and `packCatalogue()` are built. One instance per launch,
 * because it holds the one download in flight.
 */

import { createRegionDownloads, type RegionDownloads, type RegionDownloadsDeps } from "./downloads.js";

let depsOf: (() => RegionDownloadsDeps) | null = null;
let instance: RegionDownloads | null = null;

/** Called once by `main/index.ts`. */
export function configureMapRegions(deps: () => RegionDownloadsDeps): void {
  depsOf = deps;
  instance = null;
}

/** The launch's region downloads, or a thrown error naming the missing wiring. */
export function mapRegions(): RegionDownloads {
  if (instance !== null) return instance;
  if (depsOf === null) {
    throw new Error("Nexus: the maps module's region downloads were never configured.");
  }
  instance = createRegionDownloads(depsOf());
  return instance;
}
