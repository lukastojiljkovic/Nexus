/**
 * The Protomaps daily planet builds a region is cut from (ADR-118).
 *
 * `builds.json` lists the builds the project keeps, each with its size, its
 * MD5 and the basemap schema its tiles follow. A build is one PMTiles file at
 * `build.protomaps.com/<yyyymmdd>.pmtiles`, so its key is all the address there
 * is: the URL is built here from a key that passed {@link KEY_PATTERN}, never
 * taken from the list.
 *
 * **What is refused, and why each.** The list is a stranger's JSON. An entry
 * whose key is not a date, whose size is not a whole number of bytes or whose
 * MD5 is not sixteen bytes is dropped, and so is one whose schema has another
 * major version: the style the map is painted with reads one schema, and a
 * region cut from a build it cannot read would download and draw nothing.
 */

/** Where the list is. */
export const BUILDS_URL = "https://build-metadata.protomaps.dev/builds.json";

/** Where the builds are, one file per key. */
export const BUILD_BASE_URL = "https://build.protomaps.com/";

/** The most the list may be. A policy cap: the 62 builds it listed on 2026-10-22 were 11,808 bytes. */
export const BUILDS_MAX_BYTES = 1024 * 1024;

/**
 * The tile schema's major version the map's style is written for: Protomaps'
 * version 4 builds, which its docs call compatible with the
 * `@protomaps/basemaps` styles from 4.0.0 on.
 */
export const BASEMAP_MAJOR = 4;

const KEY_PATTERN = /^(\d{8})\.pmtiles$/;

export interface PlanetBuild {
  /** The build's date, `yyyymmdd`. */
  readonly key: string;
  readonly url: string;
  readonly bytes: number;
  /** Hex MD5 of the whole file, which only a whole-world download can check. */
  readonly md5: string;
  readonly version: string;
}

/** The builds the list names that this app can use, newest first. */
export function parseBuilds(value: unknown): PlanetBuild[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry: unknown) => {
      const build = buildOf(entry);
      return build === null ? [] : [build];
    })
    .sort((left, right) => right.key.localeCompare(left.key));
}

function buildOf(entry: unknown): PlanetBuild | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { key, size, md5sum, version } = entry as Record<string, unknown>;
  const date = typeof key === "string" ? KEY_PATTERN.exec(key)?.[1] : undefined;
  if (date === undefined) return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) return null;
  if (typeof version !== "string" || Number.parseInt(version, 10) !== BASEMAP_MAJOR) return null;
  const md5 = typeof md5sum === "string" ? Buffer.from(md5sum, "base64") : null;
  if (md5 === null || md5.length !== 16 || md5.toString("base64") !== md5sum) return null;
  return { key: date, url: `${BUILD_BASE_URL}${date}.pmtiles`, bytes: size, md5: md5.toString("hex"), version };
}
