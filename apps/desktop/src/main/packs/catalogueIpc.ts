/**
 * ADR-103's IPC surface: the catalogue the Packs card draws, and the four
 * calls that move one pack into it.
 *
 * **No URL and no path crosses this bridge, in either direction.** The renderer
 * names a pack id; every address a download reaches came out of a document the
 * release key signed and MAIN fetched, and every directory a byte lands in is
 * this process's own. The two ids that do arrive are validated as kebab-case
 * pack ids here, beside the code that looks them up, exactly as `packsIpc.ts`
 * validates the ids of the two channels that name an installed folder.
 *
 * **A refusal is data; a bug is an exception**, the same split `packsIpc.ts`
 * makes: every `PackError` becomes a code the renderer turns into a sentence,
 * and anything else propagates so a card that says "something went wrong" is
 * only ever hiding a bug rather than a refusal the user could act on.
 *
 * The effects arrive injected (`http`, `freeBytes`, `onChanged`, `onProgress`),
 * `packsIpc.ts`'s arrangement, so the whole path is testable without Electron:
 * the tests build the client against a loopback server and the downloader
 * against the same session-shaped port the download service's own suite uses.
 */

import type {
  InstalledPackView,
  PackCatalogueEntryView,
  PackCatalogueResult,
  PackCatalogueState,
  PackDownloadProgress,
  PackDownloadResult,
} from "../../shared/ipc.js";
import { createDownloadService, freeSpaceBytes, type DownloadHttp } from "../download/service.js";
import { modeAllowsDownloads, type NetworkMode } from "../net/offline.js";
import { compareVersions } from "../update/version.js";
import type { PackCatalogueEntry } from "./catalogue.js";
import { createCatalogueClient } from "./catalogueClient.js";
import { createPackDownloader, type PackDownloadOutcome } from "./download.js";
import { packRefusalCode, type PackRefusalCode } from "./errors.js";
import { readInstalled, type InstalledPack } from "./registry.js";
import { toView } from "./packsIpc.js";

export interface PackCatalogueIpcDeps {
  readonly userData: string;
  readonly appVersion: string;
  readonly publicKeyPem: string;
  /** The mode this launch may ACT on, never the stored file. */
  readonly mode: () => NetworkMode;
  readonly http: DownloadHttp;
  /** `DOWNLOAD_HOSTS` from `net/offline.ts`: the compiled-in list every address must be on. */
  readonly hosts: readonly string[];
  /** `isSessionRequestAllowed(..., "downloads")`, the one rule over that list. */
  readonly isAllowedUrl: (url: string) => boolean;
  readonly freeBytes: (dir: string) => number | null;
  readonly onChanged: (packs: InstalledPackView[]) => void;
  readonly onProgress: (progress: PackDownloadProgress) => void;
}

export interface PackCatalogueIpc {
  catalogue(reload?: boolean): Promise<PackCatalogueResult>;
  download(id: string): Promise<PackDownloadResult>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<PackDownloadResult>;
  cancel(id: string): Promise<void>;
}

/**
 * A pack id from the wire. The shape is the manifest's own kebab rule, checked
 * again here for `packsIpc.ts`'s reason: this id is looked up in a signed
 * document and then becomes a directory name, and `main/index.ts`'s `asId`
 * bounds a length but not a shape.
 */
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function packId(value: unknown): string {
  if (typeof value !== "string" || !KEBAB_ID.test(value)) {
    throw new Error(`Invalid IPC payload: "id" must be a kebab-case pack id.`);
  }
  return value;
}

/**
 * What this device has of a catalogue entry: nothing, the same version, or an
 * older one.
 *
 * Exported and pure because it is the one decision in this file that is worth
 * testing on its own, and because the comparison reuses `update/version.ts`'s
 * comparator rather than a second version grammar (`ADR-091`'s rule): a version
 * this build cannot compare is NOT newer — calling it one would offer a
 * download that installs nothing new.
 */
export function catalogueEntryState(
  version: string,
  installedVersion: string | null,
): PackCatalogueState {
  if (installedVersion === null) return "not-installed";
  const order = compareVersions(version, installedVersion);
  // A version this build cannot compare is not "newer": `compareVersions`
  // answers `null` for both sides of a grammar it does not know, and calling
  // that an update would offer a download that installs nothing new.
  return order !== null && order > 0 ? "update-available" : "installed";
}

export function createPackCatalogueIpc(deps: PackCatalogueIpcDeps): PackCatalogueIpc {
  const client = createCatalogueClient({
    http: deps.http,
    publicKeyPem: deps.publicKeyPem,
    hosts: deps.hosts,
    isAllowedUrl: deps.isAllowedUrl,
    mode: deps.mode,
  });

  const downloader = createPackDownloader({
    userData: deps.userData,
    appVersion: deps.appVersion,
    publicKeyPem: deps.publicKeyPem,
    mode: deps.mode,
    freeBytes: deps.freeBytes,
    onProgress: deps.onProgress,
    // ONE service per launch, on `main/index.ts`'s terms: a second instance
    // would be a second answer to "are two downloads already in flight".
    service: (onProgress) =>
      createDownloadService({
        userData: deps.userData,
        mode: deps.mode,
        isAllowedUrl: deps.isAllowedUrl,
        http: deps.http,
        freeSpaceBytes,
        onProgress,
      }),
  });

  function installedPacks(): InstalledPack[] {
    return readInstalled(deps.userData, deps.publicKeyPem);
  }

  /**
   * One entry as the card draws it, against the installed list read ONCE for
   * the whole catalogue: the index is a file, and asking it fifty times to draw
   * fifty rows is fifty reads for one answer each.
   */
  function toEntryView(entry: PackCatalogueEntry, installed: readonly InstalledPack[]): PackCatalogueEntryView {
    const installedVersion =
      installed.find((pack) => pack.manifest.id === entry.id)?.manifest.version ?? null;
    return {
      id: entry.id,
      version: entry.version,
      kind: entry.kind,
      title: entry.title,
      description: entry.description,
      size: entry.size,
      fileCount: entry.files.length,
      licence: entry.licence,
      source: entry.source,
      notice: entry.notice,
      state: catalogueEntryState(entry.version, installedVersion),
      installedVersion,
    };
  }

  /**
   * The entry a download is about: looked up in the document the release key
   * signed.
   *
   * Answers a refusal rather than throwing, because reading the document can
   * refuse (a signature that is not the key's, a mode that allows no download)
   * and a caller that asked to download a pack must get the reason as data,
   * exactly as it does from the catalogue call itself.
   */
  async function entryFor(id: string): Promise<PackCatalogueEntry | { readonly code: PackRefusalCode }> {
    try {
      const catalogue = await client.read();
      return catalogue.packs.find((entry) => entry.id === id) ?? { code: "catalogue-entry" };
    } catch (error) {
      const code = packRefusalCode(error);
      if (code === null) throw error;
      return { code };
    }
  }

  function toDownloadResult(outcome: PackDownloadOutcome): PackDownloadResult {
    switch (outcome.outcome) {
      case "installed": {
        deps.onChanged(installedPacks().map(toView));
        return { outcome: "installed", pack: toView(outcome.pack) };
      }
      case "paused":
        return { outcome: "paused", id: outcome.id };
      case "cancelled":
        return { outcome: "cancelled", id: outcome.id };
      case "refused":
        return { outcome: "refused", code: outcome.code };
    }
  }

  return {
    async catalogue(reload = false): Promise<PackCatalogueResult> {
      try {
        const document = await client.read(reload);
        const installed = installedPacks();
        return {
          outcome: "ready",
          entries: document.packs.map((entry) => toEntryView(entry, installed)),
        };
      } catch (error) {
        const code = packRefusalCode(error);
        if (code === null) throw error;
        return { outcome: "refused", code };
      }
    },

    async download(rawId: string): Promise<PackDownloadResult> {
      const id = packId(rawId);
      if (!modeAllowsDownloads(deps.mode())) return { outcome: "refused", code: "downloads-off" };
      const entry = await entryFor(id);
      if ("code" in entry) return { outcome: "refused", code: entry.code };
      return toDownloadResult(await downloader.download(entry));
    },

    async pause(rawId: string): Promise<void> {
      downloader.pause(packId(rawId));
    },

    async resume(rawId: string): Promise<PackDownloadResult> {
      const id = packId(rawId);
      if (!modeAllowsDownloads(deps.mode())) return { outcome: "refused", code: "downloads-off" };
      return toDownloadResult(await downloader.resume(id));
    },

    async cancel(rawId: string): Promise<void> {
      await downloader.cancel(packId(rawId));
    },
  };
}

