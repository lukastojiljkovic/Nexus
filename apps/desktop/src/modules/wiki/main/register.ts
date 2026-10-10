import { MAX_WIKI_PATH_LENGTH, MAX_WIKI_TITLE_LENGTH, WikiStore } from "@nexus/db";
import type { ModuleCall, ModuleHostSurface, ModuleSession } from "../../../main/moduleIpc.js";
import { MAX_ZIM_PATH_CHARS, zimUrlPath } from "../../../main/zim/paths.js";
import { zimHost } from "../../../main/zim/host.js";
import { ZIM_SCHEME } from "../../../main/zim/scheme.js";
import {
  contract,
  type WikiArticleView,
  type WikiProblemCode,
  type WikiView,
} from "../shared/ipc.js";
import { buildWikiExport, parseWikiExport } from "./imex.js";

/**
 * WIKI in the main process (ADR-090): its handlers, and its archive section.
 *
 * **What this file does NOT do.** It opens no ZIM, reads no cluster and fetches
 * nothing. Every one of those is the ZIM service's (`main/zim/host.ts`), which
 * the protocol handler consults as well — so the page and the frame it points at
 * cannot disagree about which file a library is, because there is one answer to
 * that question in the process. What is here is the wire: validate the payload,
 * ask the service or the store, answer with the whole view.
 *
 * **Why the store is per call rather than remembered.** `call.profileDb` opens
 * the handle at the moment of use, `electronicsStore`'s arrangement: a database
 * the user locked between two calls must not be written through a handle captured
 * before it.
 *
 * **Why the search answers only hits.** It is the one op a keystroke calls, and a
 * whole view per letter would be a payload the size of the page's state for an
 * answer no larger than a dozen rows.
 */

/** A short cap on the hits one search may answer with: a list a person scrolls, not a list they read. */
const SEARCH_LIMIT = 24;

/** How long a prefix may be. A title is a page name; past this it is a paste, not a search. */
const MAX_SEARCH_PREFIX = 120;

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function wikiStore(bearer: { profileDb: ModuleCall["profileDb"] }, profileId: string): WikiStore {
    return bearer.profileDb(profileId, (db, id) => new WikiStore(db, id));
  }

  /**
   * The whole view, from the service and the store.
   *
   * `problem` is cleared here and set by whoever has something to report: a read
   * that succeeds must not keep showing the refusal of the operation before it.
   */
  function viewOf(
    bearer: { profileDb: ModuleCall["profileDb"] },
    profileId: string,
    problem: WikiProblemCode | null = null,
  ): WikiView {
    const store = wikiStore(bearer, profileId);
    const service = zimHost();
    return {
      libraries: service.libraries(),
      downloads: service.downloads(),
      history: store.history().map((row) => ({
        id: row.id,
        libraryId: row.libraryId,
        zimPath: row.zimPath,
        title: row.title,
        visitedAt: row.visitedAt,
      })),
      bookmarks: store.bookmarks().map((row) => ({
        id: row.id,
        libraryId: row.libraryId,
        zimPath: row.zimPath,
        title: row.title,
        createdAt: row.createdAt,
      })),
      // The catalogue is a FETCH, so it is carried through only where one was
      // made: a mutation that quietly refetched two megabytes of feed would be a
      // cost nobody could see from the call site.
      catalogue: null,
      problem,
    };
  }

  /** A ZIM path off the wire, capped at the reader's own bound. */
  function zimPathOf(call: ModuleCall, value: unknown): string {
    return call.as.asCappedChars(
      call.as.asNonEmptyString(value, "zimPath"),
      "zimPath",
      Math.min(MAX_ZIM_PATH_CHARS, MAX_WIKI_PATH_LENGTH),
    );
  }

  /** A title off the wire, capped at the store's own bound so a string that could never be stored is refused before the store sees it. */
  function titleOf(call: ModuleCall, value: unknown): string {
    return call.as.asCappedChars(
      call.as.asNonEmptyString(value, "title"),
      "title",
      MAX_WIKI_TITLE_LENGTH,
    );
  }

  // --- The screen -----------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("catalogue", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const view = viewOf(call, profileId);
    const catalogue = await zimHost().catalogue();
    return { ...view, catalogue, problem: catalogue.problem };
  });

  ctx.handle("importFile", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const result = await zimHost().installFile();
    return viewOf(call, profileId, result.ok ? null : result.problem);
  });

  ctx.handle("removeLibrary", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    zimHost().forget(call.as.asId(payload.libraryId, "libraryId"));
    return viewOf(call, profileId);
  });

  ctx.handle("download", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const result = await zimHost().startDownload(call.as.asId(payload.editionId, "editionId"));
    return viewOf(call, profileId, result.problem);
  });

  ctx.handle("cancelDownload", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    await zimHost().cancelDownload(call.as.asId(payload.editionId, "editionId"));
    return viewOf(call, profileId, "cancelled");
  });

  // --- Reading --------------------------------------------------------------

  ctx.handle("read", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const libraryId = call.as.asId(payload.libraryId, "libraryId");
    const zimPath = payload.zimPath === null ? null : zimPathOf(call, payload.zimPath);
    const opened = zimHost().open(libraryId, zimPath);
    if (opened === null) return { article: null, view: viewOf(call, profileId, "not-found") };
    const article: WikiArticleView = {
      libraryId: opened.libraryId,
      zimPath: opened.zimPath,
      title: opened.title,
      mime: opened.mime,
      html: opened.html,
      // The one place the address is built, from the one encoder that decides
      // how a path crosses a URL.
      url: `${ZIM_SCHEME}://${opened.libraryId}${zimUrlPath(opened.zimPath)}`,
    };
    // The visit is recorded AFTER the entry opened, and only then: a link this
    // file cannot resolve is not a place the user has been.
    wikiStore(call, profileId).recordVisit(
      { libraryId: article.libraryId, zimPath: article.zimPath, title: article.title },
      instant(call.now()),
    );
    return { article, view: viewOf(call, profileId) };
  });

  ctx.handle("search", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    // The profile is validated even though the search is the service's: a payload
    // that names no profile is the renderer sending the wrong shape, and
    // answering it with hits would be answering a question nobody asked.
    void profileId;
    const libraryId = call.as.asId(payload.libraryId, "libraryId");
    const prefix = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.prefix, "prefix"),
      "prefix",
      MAX_SEARCH_PREFIX,
    );
    return { hits: zimHost().search(libraryId, prefix, SEARCH_LIMIT) };
  });

  // --- What the user keeps --------------------------------------------------

  ctx.handle("bookmark", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    wikiStore(call, profileId).bookmark(
      {
        libraryId: call.as.asId(payload.libraryId, "libraryId"),
        zimPath: zimPathOf(call, payload.zimPath),
        title: titleOf(call, payload.title),
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("unbookmark", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    wikiStore(call, profileId).unbookmark(call.as.asId(payload.bookmarkId, "bookmarkId"));
    return viewOf(call, profileId);
  });

  ctx.handle("clearHistory", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    wikiStore(call, profileId).clearHistory();
    return viewOf(call, profileId);
  });

  // --- The archive (ADR-090 §imex) ------------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session);
    if (profileId === null) return undefined;
    return buildWikiExport(wikiStore(session, profileId).bookmarks());
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload — the version first — and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseWikiExport,
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        wikiStore(session, profileId).replaceFromArchive(
          payload === undefined ? null : { bookmarks: payload.bookmarks },
          instant(session.now()),
        );
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written ONE profile at a time (`main/imex.ts`'s `handleExport`
 * gathers one profile's `ProfileData`), so "several" is not a shape the exporter
 * meets. Answering `null` rather than guessing is what keeps that true: if a
 * session ever did name several, this module has no single profile whose marks
 * they are, and the honest payload is none at all rather than the first profile's.
 */
function soleProfile(session: ModuleSession): string | null {
  return session.profileIds.length === 1 ? (session.profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}
