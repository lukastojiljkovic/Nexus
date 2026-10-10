import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  TextField,
} from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import {
  activeLocale,
  declaredText,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import type {
  WikiArticleView,
  WikiCatalogueView,
  WikiHistoryView,
  WikiBookmarkView,
  WikiLibraryView,
  WikiSearchHitView,
  WikiView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import { entryLabel, formatBytes, localeTag, progressPercent } from "./zimView.js";
import "./wiki.css";

/**
 * REFERENCE (the WIKI module) — an offline library read through this app's own
 * ZIM reader (ADR-098).
 *
 * **What the page is, and what it is not.** It lists the ZIM files this machine
 * has, opens one's main page into a sandboxed frame, searches the titles inside
 * it, and shows what was read and what was kept. It reads no file itself: every
 * entry is a `nx-zim://` address served by main, so the bytes never cross the
 * IPC boundary and the frame cannot be tricked into loading anything but the
 * pack (the scheme's own path rules, the served CSP and the frame's `sandbox`
 * are the three fences, and ADR-098 says which is which).
 *
 * **Why the frame is sandboxed with no `allow-scripts`.** A pack is content
 * somebody else built; a Zimit pack is a whole website with its JavaScript
 * intact. `sandbox=""` is every restriction the platform has, which means the
 * document is an opaque origin that cannot run script, cannot navigate its
 * parent, cannot open a window and cannot reach storage — and the served
 * `Content-Security-Policy` is the second fence for the case where the first one
 * is ever loosened.
 *
 * **Why a search is a keystroke's job and a title search is its whole scope.**
 * The index inside a pack is a Xapian database, which is GPL and not linked
 * (ADR-098); what this app CAN do offline is binary-search the title list the
 * format puts in every file, and that is what the card offers, with the copy
 * saying so rather than pretending.
 *
 * **Why a download is polled.** The service that fetches a pack reports progress
 * through the one sink it owns; main reads the staging file's size instead, and
 * this page re-reads the view once a second while something is in flight — which
 * is also why nothing here needs a push channel the kit does not have.
 */

export default function WikiPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<WikiView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [article, setArticle] = useState<WikiArticleView | null>(null);
  /** The library the search looks in — set by the Open button, because a title index belongs to a file. */
  const [activeLibrary, setActiveLibrary] = useState<{ id: string; title: string } | null>(null);
  const [prefix, setPrefix] = useState("");
  const [hits, setHits] = useState<readonly WikiSearchHitView[]>([]);
  const [searchFailed, setSearchFailed] = useState(false);
  const [catalogueBusy, setCatalogueBusy] = useState(false);

  /**
   * One write, into state. Every mutation answers with the same shape, so there
   * is exactly one way this page learns anything: what main just said.
   */
  const run = useCallback(
    async (action: (wiki: typeof window.nexus.modules.wiki) => Promise<WikiView>) => {
      try {
        setView(await action(window.nexus.modules.wiki));
        setError(null);
      } catch (failure) {
        setError(copy.errors.mutate);
        console.error("Nexus: a wiki change failed:", failure);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.wiki.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the wiki libraries could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * While something is downloading, the view is re-read once a second. The
   * interval exists only while a download is running, so a page left open on a
   * finished library asks main for nothing at all.
   */
  const downloading = view?.downloads.some((row) => row.state === "running") ?? false;
  useEffect(() => {
    if (!downloading) return;
    const handle = setInterval(() => void refresh(), 1000);
    return () => clearInterval(handle);
  }, [downloading, refresh]);

  /**
   * Search as you type, with a short pause so a fast typist makes one request
   * per word rather than one per letter, and with a cancellation flag so a slow
   * answer for an older prefix cannot overwrite a newer one.
   */
  useEffect(() => {
    const trimmed = prefix.trim();
    if (activeLibrary === null || trimmed === "") {
      setHits([]);
      setSearchFailed(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const answer = await window.nexus.modules.wiki.search({
            profileId,
            libraryId: activeLibrary.id,
            prefix: trimmed,
          });
          if (!cancelled) {
            setHits(answer.hits);
            setSearchFailed(false);
          }
        } catch (failure) {
          if (!cancelled) {
            setHits([]);
            setSearchFailed(true);
          }
          console.error("Nexus: the title search failed:", failure);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [prefix, activeLibrary, profileId]);

  /** Opens one entry (or a library's main page) and records the visit. */
  const open = useCallback(
    async (libraryId: string, zimPath: string | null) => {
      try {
        const result = await window.nexus.modules.wiki.read({ profileId, libraryId, zimPath });
        setView(result.view);
        if (result.article === null) {
          setError(copy.problem["not-found"]);
          return;
        }
        setArticle(result.article);
        setError(null);
      } catch (failure) {
        setError(copy.errors.mutate);
        console.error("Nexus: the entry could not be opened:", failure);
      }
    },
    [profileId],
  );

  /** Escape closes the frame, and only while nothing is being typed into. */
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest("input, textarea, select") !== null) return;
      setArticle(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const problem = view?.problem ?? null;
  const locale = localeTag(activeLocale());

  return (
    <div className="wiki">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, rather than a second copy of it: the rail, the
          settings gallery and this header then cannot disagree about what the
          module is called (ADR-090's copy split). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="globe"
      />
      {(error !== null || problem !== null) && (
        <p className="wiki__error" role="alert">
          {error ?? copy.problem[problem ?? "not-found"]}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : (
        <>
          {article !== null && (
            <ArticleSection
              article={article}
              bookmarks={view.bookmarks}
              // A library this app did not download is „unverified", and the card
              // says so rather than leaving the fact to the library list.
              unverified={
                view.libraries.find((row) => row.id === article.libraryId)?.integrity !==
                "checksum"
              }
              profileId={profileId}
              run={run}
              close={() => setArticle(null)}
            />
          )}
          <LibrarySection
            libraries={view.libraries}
            profileId={profileId}
            activeLibraryId={activeLibrary?.id ?? null}
            run={run}
            open={(library) => {
              setActiveLibrary({ id: library.id, title: library.title });
              void open(library.id, null);
            }}
          />
          <CatalogueSection
            catalogue={view.catalogue}
            downloads={view.downloads}
            busy={catalogueBusy}
            locale={locale}
            loadCatalogue={() => {
              setCatalogueBusy(true);
              void (async () => {
                try {
                  await run((wiki) => wiki.catalogue({ profileId }));
                } finally {
                  setCatalogueBusy(false);
                }
              })();
            }}
            run={run}
            profileId={profileId}
          />
          <SearchSection
            activeLibrary={activeLibrary}
            prefix={prefix}
            hits={hits}
            failed={searchFailed}
            onPrefix={setPrefix}
            open={(hit) => {
              if (activeLibrary !== null) void open(activeLibrary.id, hit.zimPath);
            }}
          />
          <HistorySection
            history={view.history}
            locale={locale}
            profileId={profileId}
            run={run}
            open={(row) => void open(row.libraryId, row.zimPath)}
          />
          <BookmarksSection
            bookmarks={view.bookmarks}
            profileId={profileId}
            run={run}
            open={(row) => void open(row.libraryId, row.zimPath)}
          />
        </>
      )}
    </div>
  );
}

/** Every mutation's shape, narrowed so a section cannot call another's op by accident. */
type WikiApi = typeof window.nexus.modules.wiki;
type Run = (action: (wiki: WikiApi) => Promise<WikiView>) => Promise<void>;

// --- Biblioteke ---------------------------------------------------------------

function LibrarySection({
  libraries,
  profileId,
  activeLibraryId,
  run,
  open,
}: {
  libraries: readonly WikiLibraryView[];
  profileId: string;
  activeLibraryId: string | null;
  run: Run;
  open: (library: WikiLibraryView) => void;
}) {
  return (
    <Card className="wiki__card" title={copy.library.title}>
      <div className="wiki__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => void run((wiki) => wiki.importFile({ profileId }))}
        >
          {copy.library.add}
        </Button>
      </div>
      {libraries.length === 0 ? (
        <EmptyState
          variant="inline"
          title={copy.library.emptyTitle}
          description={copy.library.emptyBody}
        />
      ) : (
        <div className="wiki__list">
          {libraries.map((library) => (
            <ListRow
              key={library.id}
              leading={<Icon name="globe" />}
              muted={!library.present}
              trailing={
                <span className="wiki__row-actions">
                  <Chip>{formatBytes(library.bytes, localeTagOf())}</Chip>
                  <Chip>
                    {library.integrity === "checksum"
                      ? copy.library.checksum
                      : copy.library.unverified}
                  </Chip>
                  {!library.present && <Chip>{copy.library.missing}</Chip>}
                  <Button
                    size="sm"
                    variant={library.id === activeLibraryId ? "primary" : "ghost"}
                    disabled={!library.present}
                    onClick={() => open(library)}
                  >
                    {copy.library.open}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      void run((wiki) => wiki.removeLibrary({ profileId, libraryId: library.id }))
                    }
                  >
                    {copy.library.remove}
                  </Button>
                </span>
              }
            >
              <span className="wiki__title">{library.title}</span>
              <span className="wiki__meta">
                {library.language === null ? "" : `${library.language} · `}
                {library.present ? "" : copy.library.missingHint}
              </span>
            </ListRow>
          ))}
        </div>
      )}
    </Card>
  );
}

/** The interface's own language tag, read at render time so a locale switch follows (`activeLocale` is not rewritten in place). */
function localeTagOf(): string {
  return localeTag(activeLocale());
}

// --- Katalog ------------------------------------------------------------------

function CatalogueSection({
  catalogue,
  downloads,
  busy,
  locale,
  loadCatalogue,
  run,
  profileId,
}: {
  catalogue: WikiCatalogueView | null;
  downloads: WikiView["downloads"];
  busy: boolean;
  locale: string;
  loadCatalogue: () => void;
  run: Run;
  profileId: string;
}) {
  return (
    <Card className="wiki__card" title={copy.catalogue.title}>
      <p className="nx-hint">{copy.catalogue.caption}</p>
      {catalogue === null ? (
        <div className="wiki__actions">
          <Button size="sm" variant="primary" disabled={busy} onClick={loadCatalogue}>
            {busy ? copy.catalogue.loading : copy.catalogue.load}
          </Button>
        </div>
      ) : catalogue.collections.length === 0 ? (
        <p className="nx-hint">{copy.catalogue.empty}</p>
      ) : (
        catalogue.collections.map((collection) => (
          <div key={collection.id} className="wiki__collection">
            <div className="wiki__collection-head">
              <strong>{declaredPair(collection.title)}</strong>
              <Chip>{`${copy.catalogue.licence}: ${collection.licence}`}</Chip>
            </div>
            <p className="wiki__note">{declaredPair(collection.note)}</p>
            <div className="wiki__list">
              {collection.editions.map((edition) => {
                const download = downloads.find((row) => row.editionId === edition.id);
                return (
                  <ListRow
                    key={edition.id}
                    leading={<Icon name="book" />}
                    trailing={
                      <span className="wiki__row-actions">
                        <Chip>
                          {`${copy.catalogue.size}: ${formatBytes(edition.sizeBytes, locale)}`}
                        </Chip>
                        {edition.issuedAt !== null && (
                          <Chip>
                            {`${copy.catalogue.published}: ${formatDate(edition.issuedAt, locale)}`}
                          </Chip>
                        )}
                        {download !== undefined &&
                        (download.state === "running" || download.state === "paused") ? (
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() =>
                              void run((wiki) =>
                                wiki.cancelDownload({ profileId, editionId: edition.id }),
                              )
                            }
                          >
                            {copy.catalogue.cancel}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() =>
                              void run((wiki) =>
                                wiki.download({ profileId, editionId: edition.id }),
                              )
                            }
                          >
                            {copy.catalogue.download}
                          </Button>
                        )}
                      </span>
                    }
                  >
                    <span className="wiki__title">{declaredPair(edition.label)}</span>
                    {download !== undefined && (
                      <span className="wiki__progress">
                        <span className="wiki__meta">{downloadState(download, locale)}</span>
                        <span className="wiki__progress-track">
                          <span
                            className="wiki__progress-bar"
                            style={{
                              inlineSize: `${String(
                                progressPercent(download.receivedBytes, download.totalBytes),
                              )}%`,
                            }}
                          />
                        </span>
                      </span>
                    )}
                  </ListRow>
                );
              })}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

/** How a download row reads: its state, and how much of it is on disk. */
function downloadState(download: WikiView["downloads"][number], locale: string): string {
  const size = `${formatBytes(download.receivedBytes, locale)} / ${formatBytes(download.totalBytes, locale)}`;
  switch (download.state) {
    case "running":
      return `${copy.catalogue.running}: ${size}`;
    case "paused":
      return `${copy.catalogue.paused}: ${size}`;
    case "done":
      return copy.catalogue.done;
    case "failed":
      return `${copy.catalogue.failed}: ${copy.problem[download.problem ?? "download"]}`;
  }
}

// --- Pretraga -----------------------------------------------------------------

function SearchSection({
  activeLibrary,
  prefix,
  hits,
  failed,
  onPrefix,
  open,
}: {
  activeLibrary: { id: string; title: string } | null;
  prefix: string;
  hits: readonly WikiSearchHitView[];
  failed: boolean;
  onPrefix: (value: string) => void;
  open: (hit: WikiSearchHitView) => void;
}) {
  return (
    <Card className="wiki__card" title={copy.search.title}>
      {activeLibrary === null ? (
        <p className="nx-hint">{copy.search.noLibrary}</p>
      ) : (
        <>
          <TextField
            label={copy.search.label}
            value={prefix}
            maxLength={120}
            onChange={(event) => onPrefix(event.target.value)}
          />
          <p className="nx-hint">{`${copy.search.hint} ${activeLibrary.title}`}</p>
          {/* The one line that says what this app can and cannot search offline:
              the pack's own full-text index needs Xapian, which is GPL. */}
          <p className="nx-hint">{copy.search.fullText}</p>
          {failed ? (
            <p className="wiki__error" role="alert">
              {copy.errors.search}
            </p>
          ) : prefix.trim() !== "" && hits.length === 0 ? (
            <p className="nx-hint">{copy.search.empty}</p>
          ) : (
            <div className="wiki__list wiki__list-scroll">
              {hits.map((hit) => (
                <ListRow
                  key={hit.zimPath}
                  leading={<Icon name="search" />}
                  trailing={
                    <span className="wiki__row-actions">
                      <Chip>{entryLabel(hit.title, hit.zimPath)}</Chip>
                      <Button size="sm" onClick={() => open(hit)}>
                        {copy.library.open}
                      </Button>
                    </span>
                  }
                >
                  <span className="wiki__title">{entryLabel(hit.title, hit.zimPath)}</span>
                  <span className="wiki__meta">{hit.mime}</span>
                </ListRow>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// --- Stranica -----------------------------------------------------------------

function ArticleSection({
  article,
  bookmarks,
  unverified,
  profileId,
  run,
  close,
}: {
  article: WikiArticleView;
  bookmarks: readonly WikiBookmarkView[];
  unverified: boolean;
  profileId: string;
  run: Run;
  close: () => void;
}) {
  const kept = bookmarks.find(
    (row) => row.libraryId === article.libraryId && row.zimPath === article.zimPath,
  );
  return (
    <Card className="wiki__card" title={copy.article.title}>
      <div className="wiki__frame-head">
        <span className="wiki__title">
          {entryLabel(article.title, article.zimPath)}
          <span className="wiki__meta">{` · ${article.mime}`}</span>
        </span>
        <span className="wiki__row-actions">
          <Button
            size="sm"
            variant={kept === undefined ? "primary" : "ghost"}
            onClick={() =>
              void run((wiki) =>
                kept === undefined
                  ? wiki.bookmark({
                      profileId,
                      libraryId: article.libraryId,
                      zimPath: article.zimPath,
                      title: article.title,
                    })
                  : wiki.unbookmark({ profileId, bookmarkId: kept.id }),
              )
            }
          >
            {kept === undefined ? copy.article.bookmark : copy.article.bookmarked}
          </Button>
          <Button size="sm" variant="quiet" onClick={close}>
            {copy.article.close}
          </Button>
        </span>
      </div>
      {article.html ? (
        <>
          {/* The fact that matters about a file the user pointed at: nothing
              signed it, so the page says which of the two states it is in. */}
          {unverified && <p className="nx-hint">{copy.article.unverifiedHint}</p>}
          {/* `sandbox` with no allowances is every restriction the platform has;
              the served CSP is the second fence (ADR-098). */}
          <iframe
            className="wiki__frame"
            src={article.url}
            sandbox=""
            referrerPolicy="no-referrer"
            title={entryLabel(article.title, article.zimPath)}
          />
        </>
      ) : (
        <p className="nx-hint">{copy.article.notHtml}</p>
      )}
    </Card>
  );
}

// --- Istorija i zapamćeno -----------------------------------------------------

function HistorySection({
  history,
  locale,
  profileId,
  run,
  open,
}: {
  history: readonly WikiHistoryView[];
  locale: string;
  profileId: string;
  run: Run;
  open: (row: WikiHistoryView) => void;
}) {
  return (
    <Card className="wiki__card" title={copy.history.title}>
      {history.length === 0 ? (
        <p className="nx-hint">{copy.history.empty}</p>
      ) : (
        <>
          <div className="wiki__actions">
            <Button
              size="sm"
              variant="quiet"
              onClick={() => void run((wiki) => wiki.clearHistory({ profileId }))}
            >
              {copy.history.clear}
            </Button>
          </div>
          <div className="wiki__list wiki__list-scroll">
            {history.map((row) => (
              <ListRow
                key={row.id}
                leading={<Icon name="clock" />}
                trailing={
                  <span className="wiki__row-actions">
                    <Chip>{formatDate(row.visitedAt, locale)}</Chip>
                    <Button size="sm" onClick={() => open(row)}>
                      {copy.library.open}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        void run((wiki) =>
                          wiki.bookmark({
                            profileId,
                            libraryId: row.libraryId,
                            zimPath: row.zimPath,
                            title: row.title,
                          }),
                        )
                      }
                    >
                      {copy.article.bookmark}
                    </Button>
                  </span>
                }
              >
                <span className="wiki__title">{row.title}</span>
                <span className="wiki__meta">{`${row.libraryId} · ${row.zimPath}`}</span>
              </ListRow>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function BookmarksSection({
  bookmarks,
  profileId,
  run,
  open,
}: {
  bookmarks: readonly WikiBookmarkView[];
  profileId: string;
  run: Run;
  open: (row: WikiBookmarkView) => void;
}) {
  return (
    <Card className="wiki__card" title={copy.bookmarks.title}>
      {bookmarks.length === 0 ? (
        <p className="nx-hint">{copy.bookmarks.empty}</p>
      ) : (
        <div className="wiki__list wiki__list-scroll">
          {bookmarks.map((row) => (
            <ListRow
              key={row.id}
              leading={<Icon name="star" />}
              trailing={
                <span className="wiki__row-actions">
                  <Button size="sm" onClick={() => open(row)}>
                    {copy.library.open}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      void run((wiki) =>
                        wiki.unbookmark({ profileId, bookmarkId: row.id }),
                      )
                    }
                  >
                    {copy.bookmarks.remove}
                  </Button>
                </span>
              }
            >
              <span className="wiki__title">{row.title}</span>
              <span className="wiki__meta">{`${row.libraryId} · ${row.zimPath}`}</span>
            </ListRow>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * One of the module's own `{ sr, en }` pairs, read in the interface's language.
 *
 * Read at RENDER time rather than captured at module scope: a manifest's pair is
 * not rewritten in place the way a copy table is (`moduleSurface` says so), so a
 * component that captured one would keep drawing the language it was built in.
 */
function declaredPair(pair: { readonly sr: string; readonly en: string }): string {
  return activeLocale() === "en" ? pair.en : pair.sr;
}

/** One instant, through `Intl` in the interface's language. */
function formatDate(iso: string, locale: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(at);
}
