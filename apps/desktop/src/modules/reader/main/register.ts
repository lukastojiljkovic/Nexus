import {
  articlesForScope,
  buildReaderToc,
  neighbouringArticles,
  parseReaderMarkdown,
  readerReadingOrder,
  readerTitleOf,
  searchReaderIndex,
  type ReaderTocNode,
} from "@nexus/core";
import { ReaderStore, type ReaderBookmark } from "@nexus/db";
import { mainLocale } from "../../../main/locale.js";
import type { ModuleCall, ModuleHostSurface, ModuleSession } from "../../../main/moduleIpc.js";
import {
  contract,
  type ReaderArticleView,
  type ReaderBookView,
  type ReaderBookmarkView,
  type ReaderIndexView,
  type ReaderLibraryView,
  type ReaderNotice,
  type ReaderOpenExternalResult,
  type ReaderPackView,
  type ReaderPaperSize,
  type ReaderPrintResult,
  type ReaderPrintScope,
  type ReaderSearchHitView,
  type ReaderSearchView,
  type ReaderSettingsView,
  type ReaderTextSize,
  type ReaderTocViewNode,
} from "../shared/ipc.js";
import { SAFETY_NOTICE } from "../shared/notice.js";
import {
  articleList,
  articleTitleFallback,
  contentPack,
  contentPacks,
  isArticle,
  readArticleText,
  type ContentPack,
} from "./catalog.js";
import { readerEnvironment } from "./env.js";
import { buildReaderExport, parseReaderExport } from "./imex.js";
import type { ReaderPrintArticle, ReaderPrintDocument } from "./printHtml.js";
import { createReaderIndexStore } from "./searchIndex.js";

/**
 * READER in the main process (ADR-090, ADR-100): its handlers, its index, its
 * print jobs and its archive section.
 *
 * **What this file is.** The wire's half of the module: it validates every
 * payload field by field (SEC-EL-02), reads the profile's store through the handle
 * the kit hands it, and composes the views the page draws. Reading packs and
 * building the index live in `catalog.ts`/`searchIndex.ts`, which are testable on
 * a fixture pack; the two capabilities that need a window arrive through `env.ts`.
 *
 * **Why a pack's own path is the identity everywhere.** A position, a bookmark and
 * a search hit all name an article by the path the manifest lists it under,
 * because that is the only name a pack gives its pages: renaming a file in a later
 * pack version costs the position on that file, and a synthetic id would mean a
 * table of them that has to agree with the manifests.
 *
 * **Why `contents` starts the index.** Opening a book is the moment somebody wants
 * its table of contents and, a moment later, its search. So `contents` is where a
 * build is kicked off and every answer carries the index's progress; a `library`
 * read does NOT start one, because a shelf does not index every book on it.
 *
 * **Bounds.** A search answers at most `SEARCH_LIMIT` hits and a print job covers
 * at most `MAX_PRINT_ARTICLES` articles, because the request is a renderer's and
 * the work is main's.
 */

const SEARCH_LIMIT = 50;
const MAX_PRINT_ARTICLES = 500;

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);
  const index = createReaderIndexStore({
    // Read lazily: the environment is installed during startup, and a handler only
    // ever runs after it is.
    get userData() {
      return readerEnvironment().userData;
    },
  });

  function installedPack(packId: string): ContentPack | null {
    const env = readerEnvironment();
    return contentPack(env.userData, env.publicKeyPem, packId);
  }

  function requirePack(packId: string): ContentPack {
    const pack = installedPack(packId);
    if (pack === null) throw new Error(`No content pack "${packId}" is installed.`);
    return pack;
  }

  function store(call: ModuleCall | ModuleSession, profileId: string): ReaderStore {
    return call.profileDb(profileId, (db, id) => new ReaderStore(db, id));
  }

  // --- Views ----------------------------------------------------------------

  /**
   * One pack as the library draws it. `articles` is the index's article count when
   * it is ready and `null` while it is not - which is what keeps a library read
   * from starting a build and from guessing at a number it does not have.
   */
  function bookView(pack: ContentPack, opened: ReaderStore, articles: number | null): ReaderBookView {
    const position = opened.position(pack.id);
    return {
      id: pack.id,
      version: pack.version,
      title: pack.manifest.title,
      description: pack.manifest.description,
      licence: pack.manifest.licence,
      source: pack.manifest.source,
      size: pack.size,
      fileCount: pack.fileCount,
      articleCount: articles,
      safety: pack.manifest.notice === "safety",
      lastArticle: position?.articlePath ?? null,
      bookmarkCount: opened.bookmarksOf(pack.id).length,
    };
  }

  /** The pack's articles as the tree the page draws, titled from the index where it has read them. */
  function tocOf(pack: ContentPack, titles: ReadonlyMap<string, string>): readonly ReaderTocNode[] {
    return buildReaderToc(
      articleList(pack).map((article) => ({
        path: article.path,
        title: titles.get(article.path) ?? article.title,
      })),
    );
  }

  function tocView(nodes: readonly ReaderTocNode[]): readonly ReaderTocViewNode[] {
    return nodes.map((node) => ({
      kind: node.kind,
      id: node.id,
      title: node.title,
      children: tocView(node.children),
    }));
  }

  function bookmarkViews(
    rows: readonly ReaderBookmark[],
    titles: ReadonlyMap<string, string>,
  ): readonly ReaderBookmarkView[] {
    return rows.map((row) => ({
      packId: row.packId,
      articlePath: row.articlePath,
      title: titles.get(row.articlePath) ?? articleTitleFallback(row.articlePath),
      note: row.note,
    }));
  }

  /** The titles the index holds for one pack, or an empty map while it is still building. */
  function titlesOf(profileId: string, packId: string): ReadonlyMap<string, string> {
    const articles = index.articles(profileId, packId);
    if (articles === null) return new Map();
    return new Map(articles.map((article) => [article.path, article.title]));
  }

  function packView(profileId: string, pack: ContentPack, opened: ReaderStore): ReaderPackView {
    const status = index.ensure(profileId, pack);
    const titles = titlesOf(profileId, pack.id);
    const articles = index.articles(profileId, pack.id);
    const position = opened.position(pack.id);
    return {
      book: bookView(pack, opened, articles === null ? null : articles.length),
      toc: tocView(tocOf(pack, titles)),
      bookmarks: bookmarkViews(opened.bookmarksOf(pack.id), titles),
      position: position === null ? null : { packId: pack.id, articlePath: position.articlePath },
      settings: { textSize: opened.settings().textSize },
      index: status,
      acknowledged: opened.listAcknowledged().includes(pack.id),
    };
  }

  function libraryView(profileId: string, opened: ReaderStore): ReaderLibraryView {
    const env = readerEnvironment();
    const books = contentPacks(env.userData, env.publicKeyPem).map((pack) =>
      bookView(pack, opened, index.articles(profileId, pack.id)?.length ?? null),
    );
    return { books, settings: { textSize: opened.settings().textSize } };
  }

  /** The index of the packs one query covered, as a single status the page can draw. */
  function aggregateIndex(profileId: string, packs: readonly ContentPack[]): ReaderIndexView {
    if (packs.length === 0) return { state: "cold", articlesDone: 0, articlesTotal: 0 };
    let done = 0;
    let total = 0;
    let building = false;
    let failed = false;
    let cold = false;
    for (const pack of packs) {
      const entry = index.ensure(profileId, pack);
      done += entry.articlesDone;
      total += entry.articlesTotal;
      if (entry.state === "building") building = true;
      if (entry.state === "failed") failed = true;
      if (entry.state === "cold") cold = true;
    }
    const state = building ? "building" : failed ? "failed" : cold ? "cold" : "ready";
    return { state, articlesDone: done, articlesTotal: total };
  }

  function articleView(
    profileId: string,
    pack: ContentPack,
    path: string,
    opened: ReaderStore,
  ): ReaderArticleView {
    requireArticle(pack, path);
    const markdown = readArticleText(pack, path);
    const order = readerReadingOrder(
      buildReaderToc(articleList(pack).map((article) => ({ path: article.path, title: article.title }))),
    );
    const { previous, next } = neighbouringArticles(order, path);
    const bookmark = opened.bookmarksOf(pack.id).find((row) => row.articlePath === path);
    const known = titlesOf(profileId, pack.id).get(path);
    return {
      packId: pack.id,
      path,
      title: known ?? titleOfMarkdown(markdown, path),
      markdown,
      source: pack.manifest.source,
      licence: pack.manifest.licence,
      notice: (pack.manifest.notice ?? null) as ReaderNotice | null,
      previous,
      next,
      bookmarked: bookmark !== undefined,
      note: bookmark?.note ?? "",
    };
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("library", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return libraryView(profileId, store(call, profileId));
  });

  ctx.handle("contents", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const pack = requirePack(packIdOf(call, payload.packId));
    return packView(profileId, pack, store(call, profileId));
  });

  ctx.handle("article", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const pack = requirePack(packIdOf(call, payload.packId));
    return articleView(profileId, pack, articlePathOf(call, payload.path), store(call, profileId));
  });

  ctx.handle("setPosition", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const pack = requirePack(packIdOf(call, payload.packId));
    const path = listedPath(call, pack, payload.path);
    const opened = store(call, profileId);
    opened.setPosition(pack.id, path, instant(call.now()));
    return packView(profileId, pack, opened);
  });

  ctx.handle("setBookmark", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const pack = requirePack(packIdOf(call, payload.packId));
    const path = listedPath(call, pack, payload.path);
    const note = call.as.asString(payload.note, "note");
    const opened = store(call, profileId);
    opened.setBookmark(pack.id, path, note, instant(call.now()));
    return packView(profileId, pack, opened);
  });

  ctx.handle("removeBookmark", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const pack = requirePack(packIdOf(call, payload.packId));
    const path = articlePathOf(call, payload.path);
    const opened = store(call, profileId);
    opened.removeBookmark(pack.id, path);
    return packView(profileId, pack, opened);
  });

  ctx.handle("setTextSize", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const size = textSizeOf(call, payload.textSize);
    const settings = store(call, profileId).setTextSize(size, instant(call.now()));
    return { textSize: settings.textSize } satisfies ReaderSettingsView;
  });

  ctx.handle("acknowledge", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const pack = requirePack(packIdOf(call, payload.packId));
    const opened = store(call, profileId);
    opened.acknowledge(pack.id, instant(call.now()));
    return packView(profileId, pack, opened);
  });

  ctx.handle("search", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const query = call.as.asCappedChars(call.as.asString(payload.query, "query"), "query", 200);
    const env = readerEnvironment();
    const scope =
      payload.packId === null || payload.packId === undefined
        ? contentPacks(env.userData, env.publicKeyPem)
        : [requirePack(packIdOf(call, payload.packId))];
    const { packs, pending } = index.searchable(profileId, scope);
    const outcome = searchReaderIndex(query, packs, SEARCH_LIMIT);
    const hits: ReaderSearchHitView[] = outcome.hits.map((hit) => ({
      packId: hit.packId,
      path: hit.path,
      title: hit.title.text,
      titleRanges: [...hit.title.ranges],
      snippet: hit.snippet === null ? null : hit.snippet.text,
      snippetRanges: hit.snippet === null ? [] : [...hit.snippet.ranges],
      titleMatch: hit.titleMatch,
    }));
    return {
      hits,
      truncated: outcome.truncated,
      index: aggregateIndex(profileId, scope),
      pending,
    } satisfies ReaderSearchView;
  });

  ctx.handle("print", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const pack = requirePack(packIdOf(call, payload.packId));
    const scope = printScopeOf(call, payload.scope);
    const paper = paperSizeOf(call, payload.paper);
    const path =
      payload.path === null || payload.path === undefined ? null : articlePathOf(call, payload.path);
    return await printJob(profileId, pack, scope, path, paper);
  });

  ctx.handle("openExternal", async (payload, call) => {
    const url = call.as.asCappedChars(call.as.asString(payload.url, "url"), "url", 2000);
    // The external-link rule, enforced where it matters: only http(s) ever reaches
    // the OS's browser, whatever a pack's manifest or a renderer asks for.
    if (!/^https?:\/\//i.test(url)) {
      return { outcome: "refused" } satisfies ReaderOpenExternalResult;
    }
    const opened = await readerEnvironment().openExternal(url);
    return (opened ? { outcome: "opened" } : { outcome: "refused" }) satisfies ReaderOpenExternalResult;
  });

  async function printJob(
    profileId: string,
    pack: ContentPack,
    scope: ReaderPrintScope,
    path: string | null,
    paper: ReaderPaperSize,
  ): Promise<ReaderPrintResult> {
    const titles = titlesOf(profileId, pack.id);
    const toc = tocOf(pack, titles);
    if (scope !== "pack" && path === null) return { outcome: "refused", reason: "no-article" };
    const paths = articlesForScope(toc, scope === "pack" ? null : path);
    // A scope that names nothing is refused rather than silently widened: "print
    // this chapter" that printed the whole book would be a lie about what happened.
    if (paths.length === 0 || paths.length > MAX_PRINT_ARTICLES) {
      return { outcome: "refused", reason: "no-article" };
    }

    const articles: ReaderPrintArticle[] = [];
    for (const articlePath of paths) {
      let blocks;
      try {
        blocks = parseReaderMarkdown(readArticleText(pack, articlePath));
      } catch {
        // One unreadable article fails the job: a book printed with a hole in it
        // is worse than a book that was not printed.
        return { outcome: "refused", reason: "unreadable-article" };
      }
      articles.push({
        path: articlePath,
        title: titles.get(articlePath) ?? readerTitleOf(blocks) ?? articleTitleFallback(articlePath),
        blocks,
      });
    }

    const language = mainLocale();
    const document: ReaderPrintDocument = {
      packId: pack.id,
      packTitle: pack.manifest.title[language],
      licence: `${pack.manifest.licence.spdx} - ${pack.manifest.licence.attribution}`,
      sourceName: pack.manifest.source.name,
      sourceUrl: pack.manifest.source.url,
      notice: pack.manifest.notice === "safety" ? SAFETY_NOTICE[language] : null,
      articles,
    };
    return await readerEnvironment().print({
      document,
      language,
      paper,
      suggestedName: fileStem(
        `${pack.id}-${articles.length === 1 ? (articles[0]?.title ?? pack.version) : pack.version}`,
      ),
    });
  }

  // --- The archive (ADR-090's imex section) ---------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    const opened = store(session, profileId);
    return buildReaderExport(
      opened.listPositions(),
      opened.listBookmarks(),
      opened.settings(),
      opened.listAcknowledged(),
    );
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first - and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseReaderExport,
    // The writing half. `undefined` is an archive that says nothing about the
    // Reader, which for a restore that replaces a profile whole means empty: no
    // positions, no bookmarks, no preference row and no acknowledgement.
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        store(session, profileId).replaceFromArchive(
          {
            positions: payload?.positions ?? [],
            bookmarks: payload?.bookmarks ?? [],
            textSize: payload?.settings.textSize ?? null,
            acknowledged: payload?.acknowledged ?? [],
          },
          instant(session.now()),
        );
      }
    },
  });
}

/** The one profile a session is about, or `null` when it names none or several (timers' rule). */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** A pack id off the wire: non-empty and within the format's own bound. */
function packIdOf(call: ModuleCall, value: unknown): string {
  return call.as.asCappedChars(call.as.asNonEmptyString(value, "packId"), "packId", 64);
}

/** An article path off the wire: non-empty and within the format's own bound. */
function articlePathOf(call: ModuleCall, value: unknown): string {
  return call.as.asCappedChars(call.as.asNonEmptyString(value, "path"), "path", 240);
}

/** A path that must also be one this pack LISTS - the gate every read of a pack's bytes passes. */
function listedPath(call: ModuleCall, pack: ContentPack, value: unknown): string {
  const path = articlePathOf(call, value);
  requireArticle(pack, path);
  return path;
}

/**
 * The one gate every read of a pack's bytes passes: the path must be an ARTICLE
 * the manifest lists. A listed image is not an article, so a bookmark on one is
 * refused - the manifest is what this module may read, and a page it may read is
 * the `.md` subset of that.
 */
function requireArticle(pack: ContentPack, path: string): void {
  if (!isArticle(pack, path)) {
    throw new Error(`Pack "${pack.id}" does not list "${path}" as an article.`);
  }
}

function textSizeOf(call: ModuleCall, value: unknown): ReaderTextSize {
  const size = call.as.asNonEmptyString(value, "textSize");
  if (size !== "s" && size !== "m" && size !== "l") {
    throw new Error('Invalid IPC payload: "textSize" must be one of s, m, l.');
  }
  return size;
}

function printScopeOf(call: ModuleCall, value: unknown): ReaderPrintScope {
  const scope = call.as.asNonEmptyString(value, "scope");
  if (scope !== "article" && scope !== "chapter" && scope !== "pack") {
    throw new Error('Invalid IPC payload: "scope" must be one of article, chapter, pack.');
  }
  return scope;
}

function paperSizeOf(call: ModuleCall, value: unknown): ReaderPaperSize {
  const paper = call.as.asNonEmptyString(value, "paper");
  if (paper !== "A4" && paper !== "A5") {
    throw new Error('Invalid IPC payload: "paper" must be A4 or A5.');
  }
  return paper;
}

/** An article's title straight off its text, without keeping the parse. */
function titleOfMarkdown(markdown: string, path: string): string {
  try {
    return readerTitleOf(parseReaderMarkdown(markdown)) ?? articleTitleFallback(path);
  } catch {
    // A refused article still has a name: its file's.
    return articleTitleFallback(path);
  }
}

/** A file name a save dialog can offer: everything a path cannot hold, removed. */
function fileStem(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "nexus-reader"
  );
}
