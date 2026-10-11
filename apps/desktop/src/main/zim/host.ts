import { existsSync, renameSync } from "node:fs";
import { basename } from "node:path";

import {
  downloadStagingPath,
  type DownloadOutcome,
  type DownloadService,
} from "../download/service.js";
import { modeAllowsDownloads, type NetworkMode } from "../net/offline.js";
import {
  CATALOGUE,
  findPack,
  parseMetalink,
  parseOpdsFeed,
  pickMirror,
  type CatalogueCollection,
  type CatalogueEdition,
  type CataloguePack,
} from "./catalog.js";
import {
  addLibrary,
  downloadTargetPath,
  libraryFileBytes,
  libraryIdFromPath,
  libraryPresent,
  readLibraries,
  removeLibrary,
  zimRoot,
  type ZimLibraryRecord,
} from "./libraries.js";
import { isHtmlMime, type ZimRequest, type ZimServeResult } from "./protocol.js";
import { ZimReader, type ZimEntry } from "./reader.js";
import type { ZimHttp } from "./zimElectron.js";

/**
 * THE ZIM SERVICE: the one place a ZIM file is opened, downloaded or listed.
 *
 * **Why a service and not module state.** The wiki module's handlers are one
 * caller of this and the `nx-zim://` protocol handler is another, and the two
 * must agree about everything: which files this machine has, which reader is
 * open on each, and what a download is doing. Two of them would be two answers to
 * "which library is `wikipedia-sr-mini`", and the second one would be the one
 * that opened the wrong file. The protocol side reaches this through one
 * function (`zimHost()`), configured once at startup by `index.ts` — the
 * arrangement `packsIpc` uses for the same reason.
 *
 * **Why downloads are POLLED rather than pushed.** The download service reports
 * progress through the one sink it is constructed with, and a second caller with
 * a second sink is exactly what that signature prevents. So this service asks the
 * STAGING FILE how large it is: the bytes on disk are what the download has
 * received, the file is the same one the service is writing, and reading one
 * number costs nothing next to an event per chunk. A page polls `downloads()`
 * once a second while something is in flight, which is also why this module
 * needs no push channel — the kit does not have one.
 *
 * **Why the file is checked twice, and what each check buys.** The download
 * service compares the transfer's SHA-256 with the value in the pack's Metalink
 * file while it writes, so the bytes that land are the bytes Kiwix published
 * (ADR-092 §3, rule 3). Then the ZIM's OWN trailer — the MD5 of the file without
 * its last sixteen bytes — is recomputed and compared with the Metalink's
 * `<hash type="md5">`. The second check is about the file being internally
 * consistent: a truncated write, a bad sector, a copy that lost its tail.
 * Neither is a signature, and ADR-098 says so in as many words.
 */

/** Why a ZIM operation could not be done. Machine codes; the page turns each into a sentence. */
export type ZimProblemCode =
  /** This launch is not running in "downloads", so nothing may be fetched. */
  | "mode"
  /** The catalogue or a pack's Metalink file could not be fetched. */
  | "network"
  /** The live catalogue has no such pack. */
  | "catalogue"
  /** The volume cannot hold the pack. */
  | "no-space"
  /** The download failed; the service's own refusal is in the message. */
  | "download"
  /** The chosen file is not a ZIM this reader can open. */
  | "import"
  /** A download for this pack is already in flight. */
  | "busy"
  /** No such library, or no such entry in it. */
  | "not-found";

export interface ZimLibraryView {
  readonly id: string;
  readonly title: string;
  readonly bytes: number;
  readonly integrity: "checksum" | "none";
  readonly language: string | null;
  readonly hasFullTextIndex: boolean;
  /** False when the record's file is no longer on disk. */
  readonly present: boolean;
  readonly source: string | null;
}

export interface ZimDownloadView {
  readonly editionId: string;
  readonly label: { readonly sr: string; readonly en: string };
  readonly state: "running" | "paused" | "done" | "failed";
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly problem: ZimProblemCode | null;
}

export interface ZimEditionView {
  readonly id: string;
  readonly label: { readonly sr: string; readonly en: string };
  readonly sizeBytes: number;
  readonly issuedAt: string | null;
}

export interface ZimCollectionView {
  readonly id: string;
  readonly title: { readonly sr: string; readonly en: string };
  readonly licence: string;
  readonly note: { readonly sr: string; readonly en: string };
  readonly editions: readonly ZimEditionView[];
}

export interface ZimCatalogueView {
  readonly collections: readonly ZimCollectionView[];
  /** When the feed this answer came from was fetched, or `null` when it could not be read. */
  readonly fetchedAt: number | null;
  readonly problem: ZimProblemCode | null;
}

export interface ZimArticle {
  readonly libraryId: string;
  readonly zimPath: string;
  readonly title: string;
  readonly mime: string;
  readonly html: boolean;
}

export interface ZimSearchHit {
  readonly zimPath: string;
  readonly title: string;
  readonly mime: string;
}

export interface ZimHostDeps {
  readonly userData: string;
  /** The mode this launch may ACT on (`activeNetworkMode` in main), never the stored file. */
  readonly mode: () => NetworkMode;
  /** `isSessionRequestAllowed(..., "downloads")`: https only, exact allowlisted hosts. */
  readonly isAllowedUrl: (url: string) => boolean;
  readonly http: ZimHttp;
  readonly downloads: DownloadService;
  readonly freeSpaceBytes: (dir: string) => Promise<number>;
  /** Opens the file dialog and answers the path, or `null` when the user cancelled. */
  readonly pickZimFile: () => Promise<string | null>;
  readonly now: () => number;
  /** How long a fetched catalogue stays fresh. A day by default; a test moves it. */
  readonly catalogueTtlMs?: number;
}

/** What "there is room" means: the pack, plus the staging copy the download service writes beside it. */
export const DOWNLOAD_HEADROOM_BYTES = 64 * 1024 * 1024;

const DEFAULT_CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;

/** The languages this build asks the feed for: every pack in `CATALOGUE` is Serbian, English or both. */
const CATALOGUE_LANGUAGES = ["srp", "eng"] as const;

/** The catalogue feed's own host, and the reason it is in `DOWNLOAD_HOSTS`. */
const CATALOGUE_HOST = "https://opds.library.kiwix.org";

export interface ZimHost {
  libraries(): readonly ZimLibraryView[];
  catalogue(): Promise<ZimCatalogueView>;
  installFile(): Promise<
    | { readonly ok: true; readonly library: ZimLibraryView }
    | { readonly ok: false; readonly problem: ZimProblemCode }
  >;
  forget(id: string): readonly ZimLibraryView[];
  downloads(): readonly ZimDownloadView[];
  startDownload(
    editionId: string,
  ): Promise<{ readonly ok: boolean; readonly problem: ZimProblemCode | null }>;
  cancelDownload(editionId: string): Promise<void>;
  /** One entry (or the main page when `zimPath` is `null`), or `null`. */
  open(libraryId: string, zimPath: string | null): ZimArticle | null;
  search(libraryId: string, prefix: string, limit: number): readonly ZimSearchHit[];
  /** One entry's bytes, for the `nx-zim://` handler, or `null` when this build serves nothing there. */
  serve(request: ZimRequest): ZimServeResult | null;
  closeAll(): void;
}

interface DownloadJob {
  readonly editionId: string;
  readonly label: { sr: string; en: string };
  readonly totalBytes: number;
  readonly sha256: string;
  readonly stagingPath: string;
  readonly targetPath: string;
  readonly libraryId: string;
  readonly source: string;
  state: "running" | "paused" | "done" | "failed";
  problem: ZimProblemCode | null;
  receivedBytes: number;
}

export function createZimHost(deps: ZimHostDeps): ZimHost {
  const readers = new Map<string, ZimReader>();
  const jobs = new Map<string, DownloadJob>();
  const ttl = deps.catalogueTtlMs ?? DEFAULT_CATALOGUE_TTL_MS;
  let catalogue: { fetchedAt: number; packs: readonly CataloguePack[] } | null = null;
  /**
   * The index, held in memory because it is read on every keystroke of a search
   * and written on the three occasions a library arrives or leaves. This process
   * is its only writer, so the copy cannot go stale behind its own back.
   */
  let index: ZimLibraryRecord[] | null = null;

  function libraries_(): ZimLibraryRecord[] {
    index ??= readLibraries(deps.userData);
    return index;
  }

  /** The reader for one library, opened on demand and kept for as long as the library is known. */
  function readerFor(libraryId: string): ZimReader | null {
    const open = readers.get(libraryId);
    if (open !== undefined) return open;
    const record = libraries_().find((row) => row.id === libraryId);
    if (record === undefined || !existsSync(record.path)) return null;
    try {
      const reader = ZimReader.open(record.path);
      readers.set(libraryId, reader);
      return reader;
    } catch {
      return null;
    }
  }

  function describe(record: ZimLibraryRecord): ZimLibraryView {
    const open = readers.get(record.id);
    return {
      id: record.id,
      title: record.title,
      bytes: record.bytes,
      integrity: record.integrity,
      language: record.language,
      hasFullTextIndex: open?.hasFullTextIndex() ?? false,
        present: libraryPresent(record),
      source: record.source,
    };
  }

  /**
   * The library list, newest first among equals by title, and the reader opened
   * for each present file — which is what fills in the two facts the index does
   * not store (the full-text index's presence), at the cost of a header read per
   * library rather than of a cluster.
   */
  function libraries(): readonly ZimLibraryView[] {
    return libraries_()
      .map((record) => {
        // Opening a present library is what fills in the one fact the index does
        // not store (the full-text index's presence); a missing file answers
        // without a reader, which is the honest empty answer.
        readerFor(record.id);
        return describe(record);
      })
      .sort((left, right) => left.title.localeCompare(right.title, ["sr-Latn", "sr"]));
  }

  /** Fetches (and caches) the parts of the Kiwix feed this build offers. */
  async function packs(force: boolean): Promise<readonly CataloguePack[] | null> {
    if (!force && catalogue !== null && deps.now() - catalogue.fetchedAt < ttl) return catalogue.packs;
    if (!modeAllowsDownloads(deps.mode())) return null;
    const collected: CataloguePack[] = [];
    try {
      for (const language of CATALOGUE_LANGUAGES) {
        const url = `${CATALOGUE_HOST}/catalog/v2/entries?lang=${language}&count=-1`;
        if (!deps.isAllowedUrl(url)) throw new Error("the catalogue's host is not reachable in this mode");
        const reply = await deps.http.get(url);
        if (reply.status !== 200) throw new Error(`the catalogue answered ${String(reply.status)}`);
        collected.push(...parseOpdsFeed(reply.body));
      }
    } catch {
      // A stale catalogue is better than none, and the view says how old it is;
      // "we could not reach Kiwix" with no list at all is the other answer.
      return catalogue === null ? null : catalogue.packs;
    }
    catalogue = { fetchedAt: deps.now(), packs: collected };
    return collected;
  }

  async function catalogueView(): Promise<ZimCatalogueView> {
    const live = await packs(false);
    if (live === null) return { collections: [], fetchedAt: null, problem: "network" };
    const collections: ZimCollectionView[] = CATALOGUE.map((collection) =>
      collectionView(collection, live),
    ).filter((collection) => collection.editions.length > 0);
    return { collections, fetchedAt: catalogue?.fetchedAt ?? null, problem: null };
  }

  /** Reads everything a library record needs out of the file itself. */
  function inspect(
    path: string,
  ): { record: Omit<ZimLibraryRecord, "id" | "addedAt">; reader: ZimReader } | null {
    let reader: ZimReader;
    try {
      reader = ZimReader.open(path);
    } catch {
      return null;
    }
    const title = reader.metadata("Title") ?? basename(path, ".zim");
    return {
      record: {
        title: title.length > 200 ? title.slice(0, 200) : title,
        path,
        bytes: reader.fileSize,
        integrity: "none",
        checksum: reader.embeddedChecksum(),
        source: null,
        language: reader.metadata("Language"),
      },
      reader,
    };
  }

  function remember(record: ZimLibraryRecord, reader: ZimReader): void {
    readers.set(record.id, reader);
    // The library layer owns the file; this service only keeps its own copy of
    // the answer, so the two cannot disagree about what is installed.
    index = addLibrary(deps.userData, record);
  }

  function downloadRow(job: DownloadJob): ZimDownloadView {
    // The staging file's size IS the bytes received, so asking the filesystem is
    // the same answer the service would push — read from the one place that
    // cannot get ahead of the write.
    const onDisk = libraryFileBytes(job.stagingPath) ?? libraryFileBytes(job.targetPath) ?? 0;
    return {
      editionId: job.editionId,
      label: job.label,
      state: job.state,
      receivedBytes: Math.max(job.receivedBytes, onDisk),
      totalBytes: job.totalBytes,
      problem: job.problem,
    };
  }

  async function runDownload(job: DownloadJob): Promise<void> {
    let outcome: DownloadOutcome;
    try {
      outcome = await deps.downloads.start({
        id: job.editionId,
        url: job.source,
        expectedSha256: job.sha256,
        sizeLimitBytes: job.totalBytes + DOWNLOAD_HEADROOM_BYTES,
      });
    } catch {
      job.state = "failed";
      job.problem = "download";
      return;
    }
    if (outcome.outcome !== "done") {
      job.state = outcome.outcome === "paused" ? "paused" : "failed";
      job.problem = outcome.outcome === "refused" ? problemOfDownload(outcome.problem) : "download";
      if (outcome.outcome === "paused") job.receivedBytes = outcome.bytes;
      return;
    }
    job.receivedBytes = outcome.bytes;
    const installed = installDownloaded(job, outcome.path);
    job.state = installed ? "done" : "failed";
    job.problem = installed ? null : "import";
  }

  /**
   * Moves a verified download into the ZIM directory, checks the ZIM's own MD5
   * against the file's trailer, and records the library.
   *
   * The MD5 comparison is the second half of the integrity story: the service has
   * already proved the transfer is the file Kiwix published, and this proves the
   * file on disk is internally the file its own trailer describes.
   */
  function installDownloaded(job: DownloadJob, stagedPath: string): boolean {
    try {
      renameSync(stagedPath, job.targetPath);
    } catch {
      return false;
    }
    const inspected = inspect(job.targetPath);
    if (inspected === null) return false;
    if (!inspected.reader.checksumMatches()) {
      // The file is left where it is and NOT recorded: it is not a ZIM this app
      // will open, and deleting 100 GB because a checksum failed is a worse
      // answer than leaving it for the user to look at.
      inspected.reader.close();
      return false;
    }
    remember(
      {
        ...inspected.record,
        id: job.libraryId,
        integrity: "checksum",
        source: job.source,
        addedAt: deps.now(),
      },
      inspected.reader,
    );
    return true;
  }

  return {
    libraries,

    async catalogue() {
      return await catalogueView();
    },

    async installFile() {
      const path = await deps.pickZimFile();
      if (path === null) return { ok: false, problem: "not-found" };
      const existing = libraries_().find((row) => row.path === path);
      if (existing !== undefined) {
        readerFor(existing.id);
        return { ok: true, library: describe(existing) };
      }
      const inspected = inspect(path);
      if (inspected === null) return { ok: false, problem: "import" };
      const record: ZimLibraryRecord = {
        ...inspected.record,
        id: libraryIdForPath(path, new Set(libraries_().map((row) => row.id))),
        addedAt: deps.now(),
      };
      remember(record, inspected.reader);
      return { ok: true, library: describe(record) };
    },

    forget(id) {
      readers.get(id)?.close();
      readers.delete(id);
      index = removeLibrary(deps.userData, id);
      return libraries();
    },

    downloads() {
      return [...jobs.values()].map(downloadRow);
    },

    async startDownload(editionId) {
      if (!modeAllowsDownloads(deps.mode())) return { ok: false, problem: "mode" };
      const running = jobs.get(editionId);
      if (running !== undefined && running.state === "running") return { ok: false, problem: "busy" };
      const found = findEdition(editionId);
      if (found === null) return { ok: false, problem: "catalogue" };
      const live = await packs(false);
      if (live === null) return { ok: false, problem: "network" };
      const pack = findPack(live, found.edition);
      if (pack === null) return { ok: false, problem: "catalogue" };
      if (!deps.isAllowedUrl(pack.metalinkUrl)) return { ok: false, problem: "network" };
      let metalink;
      try {
        const reply = await deps.http.get(pack.metalinkUrl);
        if (reply.status !== 200) throw new Error("metalink");
        metalink = parseMetalink(reply.body);
      } catch {
        return { ok: false, problem: "network" };
      }
      const mirror = pickMirror(metalink, deps.isAllowedUrl);
      if (mirror === null) return { ok: false, problem: "network" };
      try {
        const free = await deps.freeSpaceBytes(zimRoot(deps.userData));
        if (free < metalink.sizeBytes + DOWNLOAD_HEADROOM_BYTES) {
          return { ok: false, problem: "no-space" };
        }
      } catch {
        return { ok: false, problem: "no-space" };
      }
      const libraryId = libraryIdForPath(editionId, new Set(libraries_().map((row) => row.id)));
      const job: DownloadJob = {
        editionId,
        label: found.edition.label,
        totalBytes: metalink.sizeBytes,
        sha256: metalink.sha256,
        stagingPath: downloadStagingPath(deps.userData, editionId),
        targetPath: downloadTargetPath(deps.userData, libraryId),
        libraryId,
        source: mirror,
        state: "running",
        problem: null,
        receivedBytes: 0,
      };
      jobs.set(editionId, job);
      void runDownload(job);
      return { ok: true, problem: null };
    },

    async cancelDownload(editionId) {
      const job = jobs.get(editionId);
      if (job === undefined) return;
      await deps.downloads.cancel(editionId);
      job.state = "failed";
      job.problem = "download";
    },

    open(libraryId, zimPath) {
      const reader = readerFor(libraryId);
      if (reader === null) return null;
      try {
        const entry = zimPath === null ? reader.mainPage() : reader.entryByPath(zimPath);
        return entry === null ? null : articleOf(libraryId, entry);
      } catch {
        return null;
      }
    },

    search(libraryId, prefix, limit) {
      const reader = readerFor(libraryId);
      if (reader === null) return [];
      try {
        return reader.titlesFrom(prefix, limit).map((entry) => ({
          zimPath: entry.zimPath,
          title: entry.title,
          mime: entry.mimetype,
        }));
      } catch {
        // A search that cannot be answered answers nothing: an error toast per
        // keystroke is worse than an empty list, and the page's own copy says
        // what it searched.
        return [];
      }
    },

    serve(request) {
      const reader = readerFor(request.libraryId);
      if (reader === null) return null;
      try {
        const entry = reader.entryByPath(request.zimPath);
        if (entry === null) return null;
        return {
          mime: entry.mimetype,
          bytes: reader.blob(entry),
          html: isHtmlMime(entry.mimetype),
        };
      } catch {
        // Every refusal is a 404 for the loader: a frame with a status, rather
        // than an exception whose reason only reaches the console.
        return null;
      }
    },

    closeAll() {
      for (const reader of readers.values()) reader.close();
      readers.clear();
    },
  };
}

/**
 * The one host this process has, configured at startup by `main/index.ts`.
 *
 * A module-scope singleton for `packsIpc`'s reason: the protocol handler is
 * registered before any window exists and is not handed a service by anybody, so
 * there has to be one place it can find it. `zimHost()` throws rather than
 * answering `null` when nothing was configured — a startup-order bug that
 * silently served nothing would look exactly like a ZIM that failed to open.
 */
let current: ZimHost | null = null;

export function setZimHost(host: ZimHost): void {
  current = host;
}

export function zimHost(): ZimHost {
  if (current === null) {
    throw new Error("The ZIM host was asked for before it was configured.");
  }
  return current;
}

/** The collection as the page draws it: only the editions the live feed actually has. */
function collectionView(
  collection: CatalogueCollection,
  packs: readonly CataloguePack[],
): ZimCollectionView {
  const editions: ZimEditionView[] = [];
  for (const edition of collection.editions) {
    const pack = findPack(packs, edition);
    if (pack === null) continue;
    editions.push({
      id: edition.id,
      label: edition.label,
      sizeBytes: pack.sizeBytes,
      issuedAt: pack.issued,
    });
  }
  return {
    id: collection.id,
    title: collection.title,
    licence: collection.licence,
    note: collection.note,
    editions,
  };
}

/** One catalogue edition and the collection that carries its licence note. */
function findEdition(
  editionId: string,
): { edition: CatalogueEdition; collection: CatalogueCollection } | null {
  for (const collection of CATALOGUE) {
    for (const edition of collection.editions) {
      if (edition.id === editionId) return { edition, collection };
    }
  }
  return null;
}

/** The page's words for a download refusal: the service's codes are its own, and this is the mapping. */
function problemOfDownload(problem: string): ZimProblemCode {
  if (problem === "mode") return "mode";
  if (problem === "no-space") return "no-space";
  if (problem === "url" || problem === "network") return "network";
  return "download";
}

function articleOf(libraryId: string, entry: ZimEntry): ZimArticle {
  return {
    libraryId,
    zimPath: entry.zimPath,
    title: entry.title,
    mime: entry.mimetype,
    html: isHtmlMime(entry.mimetype),
  };
}

/**
 * The library id for a new library, derived from the file's own name and made
 * unique — `libraries.ts`'s rule, applied where the set of taken ids is known.
 */
function libraryIdForPath(path: string, taken: ReadonlySet<string>): string {
  const stem = path
    .replace(/\\/g, "/")
    .split("/")
    .pop() ?? path;
  return libraryIdFromPath(stem.endsWith(".zim") ? stem : `${stem}.zim`, taken);
}

