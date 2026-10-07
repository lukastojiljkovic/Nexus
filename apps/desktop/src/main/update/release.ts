import { isNewerVersion, parseVersion } from "./version.js";

/**
 * The pinned update chain (ADR-089 §2), as constants rather than as strings
 * scattered through the service. Every one of them is a name the resolver
 * EXCLUDES and the update session's allowlist admits, and nothing else is.
 */

/** `GET`ted with `Accept: application/vnd.github+json`; the release the API calls `latest`. */
export const RELEASE_API_URL = "https://api.github.com/repos/lukastojiljkovic/Nexus/releases/latest";

/**
 * The page a Linux user is sent to instead of an install, and the link shown
 * with every download or verification error.
 *
 * `release.ts` is a pure module, so this literal is fine here; the module that
 * actually HANDS it to a browser is `electron.ts`, where check-egress requires
 * the exemption — see that file.
 */
export const RELEASES_PAGE_URL = "https://github.com/lukastojiljkovic/Nexus/releases/latest";

/** The only release-asset path this app will fetch, under the one pinned repository. */
const RELEASE_DOWNLOAD_PATH = "/lukastojiljkovic/Nexus/releases/download/";

/**
 * Whether the API's `browser_download_url` names one asset of this repository.
 *
 * PARSED FIRST, then every check runs on the parsed parts, and that order is
 * the whole of the defence rather than a style: the WHATWG parser normalises
 * `..` and `%2e%2e` path segments, so
 * `/lukastojiljkovic/Nexus/releases/download/../../../attacker/x` arrives here
 * as `/attacker/x` and fails the `pathname` test — a `startsWith` on the raw
 * string would have seen the prefix and admitted it. The same applies to every
 * other part a raw-string check cannot separate from the URL: a `userinfo`
 * (`https://user@github.com/…`), an explicit port, a query or a fragment all
 * make the parsed shape not equal to the pinned one.
 */
export function isAllowedReleaseAssetUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === "github.com" &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.pathname.startsWith(RELEASE_DOWNLOAD_PATH)
  );
}

/**
 * The one Windows asset this updater installs.
 *
 * The tag carries a `v` and the artifact does not — `electron-builder` names
 * the installer from `package.json`'s version, and the release workflow checks
 * that `v<that version>` is the tag. So the leading `v` is stripped here, once,
 * rather than at each of the two call sites that would otherwise disagree.
 */
export function installerAssetName(version: string): string {
  const bare = version.replace(/^v/i, "");
  return `Nexus-Setup-${bare}.exe`;
}

export interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
}

export interface Release {
  readonly version: string;
  readonly notes: string;
  readonly pageUrl: string;
  readonly assets: readonly ReleaseAsset[];
}

/**
 * Reads the fields the API answers with. Deliberately tolerant of a missing
 * `body` (a release with no notes) and strict about the two things that decide
 * anything: `tag_name` and the assets array.
 */
export function parseRelease(payload: unknown): Release | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record["tag_name"] !== "string") return null;
  const notes = typeof record["body"] === "string" ? record["body"] : "";
  const pageUrl = typeof record["html_url"] === "string" ? record["html_url"] : RELEASES_PAGE_URL;
  const rawAssets = Array.isArray(record["assets"]) ? record["assets"] : [];
  const assets: ReleaseAsset[] = [];
  for (const raw of rawAssets) {
    if (typeof raw !== "object" || raw === null) continue;
    const asset = raw as Record<string, unknown>;
    if (typeof asset["name"] !== "string" || typeof asset["browser_download_url"] !== "string") {
      continue;
    }
    assets.push({ name: asset["name"], url: asset["browser_download_url"] });
  }
  return { version: record["tag_name"], notes, pageUrl, assets };
}

/** The pinned release-summary asset, and its detached signature. */
export const SHA256SUMS_ASSET = "SHA256SUMS.txt";
export const SHA256SUMS_SIGNATURE_ASSET = "SHA256SUMS.txt.sig";

export interface InstallableOffer {
  readonly version: string;
  readonly notes: string;
  readonly pageUrl: string;
  /** The installer asset to download; null on a platform that installs nothing. */
  readonly installer: ReleaseAsset | null;
}

export type ReleaseDecision =
  | { readonly kind: "up-to-date"; readonly version: string }
  | { readonly kind: "available"; readonly offer: InstallableOffer }
  /** The tag was not a version this build can compare, so it cannot be offered. */
  | { readonly kind: "undecidable"; readonly version: string };

/**
 * What a fetched release means for this build.
 *
 * The installer is looked up by its exact pinned name and its URL is accepted
 * only through `isAllowedReleaseAssetUrl`. A Windows release with no usable
 * installer is still `available` — the user is offered the version, the notes
 * and the release page — but its `installer` is null, so Install cannot be
 * pressed for it. That is the fail-closed path ADR-089 names for a GitHub that
 * has moved its assets.
 */
export function decideRelease(
  release: Release,
  currentVersion: string,
  platform: NodeJS.Platform,
): ReleaseDecision {
  // `isNewerVersion` answers `false` for an unparseable tag — indistinguishable
  // from "older" — so parseability is checked FIRST and reported as its own
  // outcome. Swallowing it would hide a release behind a comparison failure.
  if (parseVersion(release.version) === null || parseVersion(currentVersion) === null) {
    return { kind: "undecidable", version: release.version };
  }
  if (!isNewerVersion(release.version, currentVersion)) {
    return { kind: "up-to-date", version: currentVersion };
  }
  const wanted = platform === "win32" ? installerAssetName(release.version) : null;
  let installer: ReleaseAsset | null = null;
  if (wanted !== null) {
    const found = release.assets.find((asset) => asset.name === wanted);
    if (found !== undefined && isAllowedReleaseAssetUrl(found.url)) installer = found;
  }
  return {
    kind: "available",
    offer: {
      version: release.version,
      notes: release.notes,
      pageUrl: release.pageUrl,
      installer,
    },
  };
}
