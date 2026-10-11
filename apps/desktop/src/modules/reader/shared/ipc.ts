import type { PackLicenceView, PackSourceView, PackText } from "../../../shared/ipc.js";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * READER's contract: the channels it answers on, the payload each takes and the
 * API its page calls - declared once, in its own folder (ADR-090).
 *
 * **Three result types rather than one, and why that is not a drift.** The kit's
 * rule is that a mutation answers with the view it changed, so a page has one way
 * to learn anything. Here the module has three views that are genuinely
 * different things: the LIBRARY (which books exist), one PACK (its contents, its
 * bookmarks, where the reader is) and the module's one SETTING. Answering a
 * bookmark with the library would send a whole shelf across the wire to update
 * one row, and answering it with the chapter would need a pack id the setting
 * does not have. So each mutation answers the view it belongs to, and each view
 * is read whole - which keeps the rule the page obeys ("render what main says")
 * while keeping a payload proportional to what changed.
 *
 * **A pack's copy crosses as its own languages.** `title` and `description` are
 * the manifest's two-language pairs and `licence.attribution` is what its licence
 * requires be shown: none of them is this app's copy, so none of them goes
 * through a locale table.
 */

/** The one notice a pack's manifest may carry. Redeclared from the packs layer, deliberately. */
export type ReaderNotice = "safety";

/** The three reading sizes, matching the store's own column. */
export type ReaderTextSize = "s" | "m" | "l";

/** One installed content pack, as the library draws it. */
export interface ReaderBookView {
  readonly id: string;
  readonly version: string;
  readonly title: PackText;
  readonly description: PackText;
  readonly licence: PackLicenceView;
  readonly source: PackSourceView;
  /** Every listed file's size, added up, in bytes. */
  readonly size: number;
  readonly fileCount: number;
  /** How many articles the pack holds, or `null` while its index has not been built yet. */
  readonly articleCount: number | null;
  /** True when the manifest carries `notice: "safety"` (ADR-100). */
  readonly safety: boolean;
  /** The article this profile last had open in this pack, or `null`. */
  readonly lastArticle: string | null;
  readonly bookmarkCount: number;
}

/** One node of a pack's table of contents. */
export interface ReaderTocViewNode {
  readonly kind: "chapter" | "article";
  /** An article's path, or a chapter's folder path with a trailing `/`. */
  readonly id: string;
  readonly title: string;
  readonly children: readonly ReaderTocViewNode[];
}

/** One bookmarked article, with the title it is drawn under. */
export interface ReaderBookmarkView {
  readonly packId: string;
  readonly articlePath: string;
  readonly title: string;
  readonly note: string;
}

/** Where the reader is in one pack. */
export interface ReaderPositionView {
  readonly packId: string;
  readonly articlePath: string;
}

export interface ReaderSettingsView {
  readonly textSize: ReaderTextSize;
}

/** How far a pack's search index is from being usable. */
export interface ReaderIndexView {
  readonly state: "cold" | "building" | "ready" | "failed";
  /** How many articles have been read into the index so far. */
  readonly articlesDone: number;
  readonly articlesTotal: number;
}

/** The library: every installed content pack, and the module's own setting. */
export interface ReaderLibraryView {
  readonly books: readonly ReaderBookView[];
  readonly settings: ReaderSettingsView;
}

/** One pack, open: what it holds, what is bookmarked in it, and where the reader is. */
export interface ReaderPackView {
  readonly book: ReaderBookView;
  readonly toc: readonly ReaderTocViewNode[];
  readonly bookmarks: readonly ReaderBookmarkView[];
  readonly position: ReaderPositionView | null;
  readonly settings: ReaderSettingsView;
  readonly index: ReaderIndexView;
  /** True when this profile has already accepted this pack's safety notice. */
  readonly acknowledged: boolean;
}

/** One article, as the page renders it. Markdown, because the page parses it with the same core parser main does. */
export interface ReaderArticleView {
  readonly packId: string;
  readonly path: string;
  readonly title: string;
  /** The article's own bytes, decoded as UTF-8. The page parses this; main never sends elements. */
  readonly markdown: string;
  readonly source: PackSourceView;
  readonly licence: PackLicenceView;
  readonly notice: ReaderNotice | null;
  readonly previous: string | null;
  readonly next: string | null;
  readonly bookmarked: boolean;
  readonly note: string;
}

/** One search hit: the title and an excerpt, each with the ranges that matched inside it. */
export interface ReaderSearchHitView {
  readonly packId: string;
  readonly path: string;
  readonly title: string;
  readonly titleRanges: readonly (readonly [number, number])[];
  readonly snippet: string | null;
  readonly snippetRanges: readonly (readonly [number, number])[];
  /** True when every term was found in the title, which is the first group of results. */
  readonly titleMatch: boolean;
}

export interface ReaderSearchView {
  readonly hits: readonly ReaderSearchHitView[];
  /** True when the cap cut the answer short. */
  readonly truncated: boolean;
  /** The index of the pack searched, or of the pack the page is in when the search is inside one. */
  readonly index: ReaderIndexView;
  /** Packs the query could not reach yet, because their index was still building. */
  readonly pending: readonly string[];
}

/** What one print job covers. */
export type ReaderPrintScope = "article" | "chapter" | "pack";
/** A4 for a desk, A5 for a book-shaped stack. The user picks; there is no third. */
export type ReaderPaperSize = "A4" | "A5";

export type ReaderPrintResult =
  | { readonly outcome: "saved"; readonly filePath: string; readonly articles: number }
  | { readonly outcome: "cancelled" }
  | { readonly outcome: "refused"; readonly reason: ReaderPrintRefusal };

/** Why a print job was refused before anything was written. */
export type ReaderPrintRefusal =
  /** The scope names no article this pack holds. */
  | "no-article"
  /** An article in the scope is not text this build will render (a refusal of the Markdown subset). */
  | "unreadable-article"
  /** The print view could not be produced, or the file could not be written. */
  | "failed";

/** The answer to the one external-link call this module makes. */
export type ReaderOpenExternalResult =
  | { readonly outcome: "opened" }
  /** Refused: not an http(s) address, which is the only kind this app opens in a browser. */
  | { readonly outcome: "refused" };

interface LibraryPayload {
  profileId: string;
}

interface PackPayload {
  profileId: string;
  packId: string;
}

interface ArticlePayload {
  profileId: string;
  packId: string;
  path: string;
}

interface BookmarkPayload {
  profileId: string;
  packId: string;
  path: string;
  note: string;
}

interface TextSizePayload {
  profileId: string;
  textSize: ReaderTextSize;
}

interface SearchPayload {
  profileId: string;
  /** `null` searches every installed pack. */
  packId: string | null;
  query: string;
}

interface PrintPayload {
  profileId: string;
  packId: string;
  scope: ReaderPrintScope;
  /** The article or chapter the scope names; ignored for `"pack"`. */
  path: string | null;
  paper: ReaderPaperSize;
}

/** An address the user asked to open in their own browser. Validated in main; see `register.ts`. */
interface OpenExternalPayload {
  url: string;
}

/**
 * The declared ops, as a payload-to-result map. `ModuleApiOf` turns this into the
 * `nexus.modules.reader.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type ReaderOps = {
  library: { request: LibraryPayload; response: ReaderLibraryView };
  contents: { request: PackPayload; response: ReaderPackView };
  article: { request: ArticlePayload; response: ReaderArticleView };
  setPosition: { request: ArticlePayload; response: ReaderPackView };
  setBookmark: { request: BookmarkPayload; response: ReaderPackView };
  removeBookmark: { request: ArticlePayload; response: ReaderPackView };
  setTextSize: { request: TextSizePayload; response: ReaderSettingsView };
  acknowledge: { request: PackPayload; response: ReaderPackView };
  search: { request: SearchPayload; response: ReaderSearchView };
  print: { request: PrintPayload; response: ReaderPrintResult };
  openExternal: { request: OpenExternalPayload; response: ReaderOpenExternalResult };
};

/** This module's renderer API: one method per op, named after the op. */
export type ReaderApi = ModuleApiOf<ReaderOps>;

/** The contract the preload builds the bridge from and main refuses foreign ops against. */
export const contract = defineModuleContract<"reader", ReaderOps>("reader", [
  "library",
  "contents",
  "article",
  "setPosition",
  "setBookmark",
  "removeBookmark",
  "setTextSize",
  "acknowledge",
  "search",
  "print",
  "openExternal",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here, so
 * `window.nexus.modules.reader.library(...)` is typed in this module's own page and
 * in its dashboard card without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    reader: ReaderApi;
  }
}
