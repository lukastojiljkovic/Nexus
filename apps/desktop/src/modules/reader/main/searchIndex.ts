import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  makeSearchable,
  parseReaderMarkdown,
  readerPlainText,
  readerTitleOf,
  type ReaderIndexedArticle,
  type ReaderSearchablePack,
} from "@nexus/core";
import type { ReaderIndexView } from "../shared/ipc.js";
import { articleList, readArticleText, type ContentPack } from "./catalog.js";

/**
 * The Reader's search index: one pack's articles as text, built once per
 * installed pack version and kept in the profile's CACHE.
 *
 * **Why the cache and not the database.** The index is derived from a pack, not
 * written by the user: it can be rebuilt in a minute, it belongs to no backup,
 * and it would otherwise put a copy of somebody's library inside every profile
 * archive (ADR-091's argument about where a pack lives, one layer up). It lives at
 * `<userData>/reader-cache/<profileId>/<packId>/<packVersion>.json`, which is
 * keyed by the profile only because the file records what THAT profile has
 * indexed; deleting the whole directory costs a rebuild and nothing else.
 *
 * **Why the version is in the path AND in the file.** The path makes a stale
 * index unreachable after an upgrade - the new version looks for a file that does
 * not exist and builds one - and the field makes a file that was copied under the
 * wrong name a rebuild rather than a lie.
 *
 * **Why building yields.** Reading and parsing two hundred articles at once is a
 * few seconds of a blocked main process, and main is also the process serving
 * every other module's IPC. So the build reads one article, then yields to the
 * event loop, and reports how far it has got; the page draws that progress
 * instead of a spinner, and a pack whose index is still building is a pack whose
 * search says so rather than a pack that answers nothing.
 *
 * **Why a refused article is still indexed.** An article whose Markdown uses a
 * construct this build refuses (raw HTML, an unsafe link) is not text this app
 * will render, but it is still an article the pack HAS, and its title is still
 * the way to reach it. It goes into the index with its title and an empty body,
 * so it appears in the table of contents and in a title search, and opening it
 * says what is wrong with it.
 */

/** The index file's own format. A new shape is a new number, never a quiet reinterpretation. */
export const READER_INDEX_FORMAT = 1;

/** The most articles one pack's index will hold. Past `PACK_LIMITS.files`, so it bounds a hand-built cache rather than a real pack. */
export const MAX_READER_INDEX_ARTICLES = 4096;

interface IndexFile {
  readonly version: number;
  readonly packId: string;
  readonly packVersion: string;
  readonly articles: readonly ReaderIndexedArticle[];
}

interface IndexEntry {
  readonly version: string;
  /** Filled while a build runs and complete when it is ready. */
  articles: readonly ReaderIndexedArticle[];
  state: "ready" | "building" | "failed";
  articlesDone: number;
  articlesTotal: number;
}

export interface ReaderIndexStore {
  /** The index's state, kicking off a build when there is none. */
  ensure(profileId: string, pack: ContentPack): ReaderIndexView;
  /** The articles, or `null` while the index is not ready. */
  articles(profileId: string, packId: string): readonly ReaderIndexedArticle[] | null;
  /**
   * The packs a query may search, and the ones it could not reach yet. Folding
   * happens here, once per loaded index, which is what keeps a query a pass over
   * strings rather than a re-fold of the whole pack.
   */
  searchable(
    profileId: string,
    packs: readonly ContentPack[],
  ): { readonly packs: readonly ReaderSearchablePack[]; readonly pending: readonly string[] };
}

export interface ReaderIndexStoreDeps {
  readonly userData: string;
}

export function createReaderIndexStore(deps: ReaderIndexStoreDeps): ReaderIndexStore {
  const entries = new Map<string, IndexEntry>();
  const folded = new Map<string, ReaderSearchablePack>();

  const key = (profileId: string, packId: string): string => `${profileId}\u0000${packId}`;

  function cachePath(profileId: string, pack: ContentPack): string {
    return join(deps.userData, "reader-cache", profileId, pack.id, `${pack.version}.json`);
  }

  /** A loaded index, or `null` when the file is missing, unreadable or shaped unlike this build's. */
  function readCache(profileId: string, pack: ContentPack): IndexEntry | null {
    let text: string;
    try {
      text = readFileSync(cachePath(profileId, pack), "utf8");
    } catch {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) return null;
      const file = parsed as Partial<IndexFile>;
      if (file.version !== READER_INDEX_FORMAT) return null;
      if (file.packId !== pack.id || file.packVersion !== pack.version) return null;
      if (!Array.isArray(file.articles)) return null;
      const articles: ReaderIndexedArticle[] = [];
      for (const article of file.articles) {
        if (
          typeof article !== "object" ||
          article === null ||
          typeof (article as ReaderIndexedArticle).path !== "string" ||
          typeof (article as ReaderIndexedArticle).title !== "string" ||
          typeof (article as ReaderIndexedArticle).text !== "string"
        ) {
          return null;
        }
        articles.push({
          path: (article as ReaderIndexedArticle).path,
          title: (article as ReaderIndexedArticle).title,
          text: (article as ReaderIndexedArticle).text,
        });
      }
      return {
        version: pack.version,
        articles,
        state: "ready",
        articlesDone: articles.length,
        articlesTotal: articles.length,
      };
    } catch {
      return null;
    }
  }

  function writeCache(profileId: string, pack: ContentPack, articles: readonly ReaderIndexedArticle[]): void {
    const file: IndexFile = {
      version: READER_INDEX_FORMAT,
      packId: pack.id,
      packVersion: pack.version,
      articles,
    };
    const path = cachePath(profileId, pack);
    try {
      mkdirSync(dirname(path), { recursive: true });
      // Written whole through a temporary file: a crash mid-write leaves the
      // previous index rather than half of a new one, which the reader would
      // otherwise parse as "no articles".
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(file)}\n`, "utf8");
      renameSync(temporary, path);
    } catch (error) {
      // The index is a cache. Failing to write it costs a rebuild next time and
      // must not fail the read that produced it.
      console.error(
        `Nexus: the Reader could not cache its index for "${pack.id}" - ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * One article's title and text, with a refusal costing the body and never the
   * entry - and `"missing"` when the file is not on disk at all.
   *
   * `"missing"` is not an error to report: a pack can be removed (or a profile's
   * cache read while the whole userData directory is being cleaned) between the
   * moment a build starts and the moment it reads article five. The honest answer
   * is that this index cannot be built now, and the entry is dropped so the next
   * read starts again - which is what keeps a removed pack from filling the log
   * with one line per article it used to have.
   */
  function readOne(
    pack: ContentPack,
    path: string,
    fallbackTitle: string,
  ): ReaderIndexedArticle | "missing" {
    try {
      const blocks = parseReaderMarkdown(readArticleText(pack, path));
      return { path, title: readerTitleOf(blocks) ?? fallbackTitle, text: readerPlainText(blocks) };
    } catch (error) {
      if (isMissingFile(error)) return "missing";
      console.error(
        `Nexus: the Reader could not read "${path}" of pack "${pack.id}" - ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { path, title: fallbackTitle, text: "" };
    }
  }

  function build(profileId: string, pack: ContentPack, entry: IndexEntry): void {
    const settled = (async () => {
      const list = articleList(pack);
      const articles: ReaderIndexedArticle[] = [];
      entry.articlesTotal = list.length;
      for (const article of list) {
        const read = readOne(pack, article.path, article.title);
        if (read === "missing") {
          // The pack moved under us. The entry is dropped rather than marked
          // failed, so the next read of this pack builds a fresh index.
          if (entries.get(key(profileId, pack.id)) === entry) entries.delete(key(profileId, pack.id));
          return;
        }
        articles.push(read);
        entry.articlesDone = articles.length;
        // Yields to the event loop so this process keeps answering while a big
        // pack is indexed; the page sees `articlesDone` move.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const total = articles.length;
      entry.articles = articles;
      entry.state = "ready";
      entry.articlesDone = total;
      entry.articlesTotal = total;
      writeCache(profileId, pack, articles);
    })();
    // A build that somehow throws marks the entry failed rather than leaving it
    // "building" forever, which would be a page that never finishes waiting.
    settled.catch(() => {
      entry.state = "failed";
    });
  }

  function viewOf(entry: IndexEntry | undefined): ReaderIndexView {
    if (entry === undefined) return { state: "cold", articlesDone: 0, articlesTotal: 0 };
    return { state: entry.state, articlesDone: entry.articlesDone, articlesTotal: entry.articlesTotal };
  }

  /** Whether a read failed because the file is gone, which is a race rather than a fault. */
  function isMissingFile(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "ENOENT"
    );
  }

  function ensure(profileId: string, pack: ContentPack): ReaderIndexView {
    const at = key(profileId, pack.id);
    const current = entries.get(at);
    if (current !== undefined && current.version === pack.version) return viewOf(current);

    const cached = readCache(profileId, pack);
    if (cached !== null) {
      entries.set(at, cached);
      return viewOf(cached);
    }
    const entry: IndexEntry = {
      version: pack.version,
      articles: [],
      state: "building",
      articlesDone: 0,
      articlesTotal: articleList(pack).length,
    };
    entries.set(at, entry);
    build(profileId, pack, entry);
    return viewOf(entry);
  }

  return {
    ensure,

    articles(profileId, packId) {
      const entry = entries.get(key(profileId, packId));
      if (entry === undefined || entry.state !== "ready") return null;
      return entry.articles;
    },

    searchable(profileId, packs) {
      const ready: ReaderSearchablePack[] = [];
      const pending: string[] = [];
      for (const pack of packs) {
        // `ensure` first: a search across every pack is also a read of every
        // pack, and it must not be the case that only opening a book indexes it.
        ensure(profileId, pack);
        const entry = entries.get(key(profileId, pack.id));
        if (entry === undefined) continue;
        if (entry.state !== "ready") {
          if (entry.state === "building") pending.push(pack.id);
          continue;
        }
        const cacheKey = `${profileId}\u0000${pack.id}\u0000${pack.version}`;
        let searchable = folded.get(cacheKey);
        if (searchable === undefined) {
          searchable = { packId: pack.id, articles: entry.articles.map(makeSearchable) };
          folded.set(cacheKey, searchable);
        }
        ready.push(searchable);
      }
      return { packs: ready, pending };
    },
  };
}
