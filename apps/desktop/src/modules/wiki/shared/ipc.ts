import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * WIKI's contract: the channels it answers on, the payload each takes, and the API
 * its page calls — declared once, in its own folder (ADR-090).
 *
 * **Three processes read this file.** Main globs it through `main/moduleIpc.ts`,
 * the preload through `preload/moduleBridge.ts`, and the module's own page imports
 * its types. `contract.channels` IS the allowlist, so „every channel starts with
 * `wiki:`" is true by construction.
 *
 * **Why nothing here names a file path or a host.** The libraries are device-level
 * and the catalogue belongs to Kiwix, so the payloads carry only what a user
 * chose: this module's own ids — a library id, a catalogue edition id, a bookmark
 * id — plus a ZIM path and a search prefix. A renderer that could name a FILE
 * would be a renderer that could make main open one, which is exactly what
 * ADR-092 refused for downloads.
 *
 * **Why a screen's result carries the whole view.** Every mutation answers with
 * the same shape, so the page has exactly one way to update: what main just said.
 * A wrong local guess — a library that looks removed but is not, a download that
 * looks finished — is therefore not representable.
 */

/** One string per language, both required: the module's copy is Serbian and English, always. */
export interface WikiText {
  readonly sr: string;
  readonly en: string;
}

/** Why an operation could not be done. The page turns each code into a sentence. */
export type WikiProblemCode =
  | "mode"
  | "network"
  | "catalogue"
  | "no-space"
  | "download"
  | "import"
  | "busy"
  | "not-found"
  | "cancelled";

/** One installed library, as the page draws it. */
export interface WikiLibraryView {
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

/** One download in flight, paused, done or failed. */
export interface WikiDownloadView {
  readonly editionId: string;
  readonly label: WikiText;
  readonly state: "running" | "paused" | "done" | "failed";
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly problem: WikiProblemCode | null;
}

export interface WikiEditionView {
  readonly id: string;
  readonly label: WikiText;
  readonly sizeBytes: number;
  readonly issuedAt: string | null;
}

export interface WikiCollectionView {
  readonly id: string;
  readonly title: WikiText;
  readonly licence: string;
  readonly note: WikiText;
  readonly editions: readonly WikiEditionView[];
}

export interface WikiCatalogueView {
  readonly collections: readonly WikiCollectionView[];
  readonly fetchedAt: number | null;
  readonly problem: WikiProblemCode | null;
}

export interface WikiHistoryView {
  readonly id: string;
  readonly libraryId: string;
  readonly zimPath: string;
  readonly title: string;
  readonly visitedAt: string;
}

export interface WikiBookmarkView {
  readonly id: string;
  readonly libraryId: string;
  readonly zimPath: string;
  readonly title: string;
  readonly createdAt: string;
}

/** One opened entry: what the page puts in the frame, and what it is called. */
export interface WikiArticleView {
  readonly libraryId: string;
  readonly zimPath: string;
  readonly title: string;
  readonly mime: string;
  readonly html: boolean;
  /**
   * The `nx-zim://` address the sandboxed frame loads.
   *
   * Sent by main rather than assembled here, because the address is the
   * server's: one percent-encoder (`main/zim/paths.ts`) decides what a Cyrillic
   * title looks like on the wire, and the handler accepts only that spelling.
   */
  readonly url: string;
}

/** One hit of a title search. */
export interface WikiSearchHitView {
  readonly zimPath: string;
  readonly title: string;
  readonly mime: string;
}

/** Everything one read of this module answers with — and what every mutation answers with too. */
export interface WikiView {
  readonly libraries: readonly WikiLibraryView[];
  readonly downloads: readonly WikiDownloadView[];
  readonly history: readonly WikiHistoryView[];
  readonly bookmarks: readonly WikiBookmarkView[];
  /** `null` until the user asks for the catalogue; the fetch is the one slow thing here. */
  readonly catalogue: WikiCatalogueView | null;
  /** What the last operation refused, if it refused. Cleared by the next one that works. */
  readonly problem: WikiProblemCode | null;
}

/** Opening one entry: the article, and the view it changed. */
export interface WikiReadResult {
  readonly article: WikiArticleView | null;
  readonly view: WikiView;
}

/** A title search's answer. A pure read: it changes nothing, so it answers nothing else. */
export interface WikiSearchResult {
  readonly hits: readonly WikiSearchHitView[];
}

interface ListPayload {
  profileId: string;
}

/** Opening one entry of one library. `zimPath` is `null` for the file's main page. */
interface ReadPayload {
  profileId: string;
  libraryId: string;
  zimPath: string | null;
}

interface SearchPayload {
  profileId: string;
  libraryId: string;
  prefix: string;
}

interface LibraryPayload {
  profileId: string;
  libraryId: string;
}

interface EditionPayload {
  profileId: string;
  editionId: string;
}

interface BookmarkPayload {
  profileId: string;
  libraryId: string;
  zimPath: string;
  title: string;
}

interface UnbookmarkPayload {
  profileId: string;
  bookmarkId: string;
}

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.wiki.*` methods the page calls, and `defineModuleContract` turns
 * the keys into the channels main answers on.
 */
type WikiOps = {
  list: { request: ListPayload; response: WikiView };
  catalogue: { request: ListPayload; response: WikiView };
  importFile: { request: ListPayload; response: WikiView };
  removeLibrary: { request: LibraryPayload; response: WikiView };
  download: { request: EditionPayload; response: WikiView };
  cancelDownload: { request: EditionPayload; response: WikiView };
  read: { request: ReadPayload; response: WikiReadResult };
  search: { request: SearchPayload; response: WikiSearchResult };
  bookmark: { request: BookmarkPayload; response: WikiView };
  unbookmark: { request: UnbookmarkPayload; response: WikiView };
  clearHistory: { request: ListPayload; response: WikiView };
};

/** This module's renderer API: one method per op, named after the op. */
export type WikiApi = ModuleApiOf<WikiOps>;

/** The contract the preload builds the bridge from and main refuses foreign ops against. */
export const contract = defineModuleContract<"wiki", WikiOps>("wiki", [
  "list",
  "catalogue",
  "importFile",
  "removeLibrary",
  "download",
  "cancelDownload",
  "read",
  "search",
  "bookmark",
  "unbookmark",
  "clearHistory",
]);

declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    wiki: WikiApi;
  }
}
