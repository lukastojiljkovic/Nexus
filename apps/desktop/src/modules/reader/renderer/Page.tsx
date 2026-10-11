import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  Select,
  TextField,
} from "@nexus/ui";
import { parseReaderMarkdown, ReaderMarkdownError, type ReaderBlock } from "@nexus/core";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { declaredText, numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { useFocusTrap } from "../../../renderer/src/useFocusTrap.js";
import { SafetyNotice } from "../../../renderer/src/safetyNotice.js";
import { manifest } from "../shared/manifest.js";
import type {
  ReaderArticleView,
  ReaderBookView,
  ReaderLibraryView,
  ReaderPackView,
  ReaderPaperSize,
  ReaderPrintScope,
  ReaderSearchView,
  ReaderTextSize,
  ReaderTocViewNode,
} from "../shared/ipc.js";
import { ReaderBlocks } from "./blocks.js";
import { copy } from "./copy.js";
import { highlightSegments } from "./highlight.js";
import { indexProgress, pickStartArticle } from "./reading.js";
import "./reader.css";

/**
 * READER (ADR-090, ADR-100): a shelf of installed content packs, and a reading
 * view with a table of contents, a search, bookmarks and printing.
 *
 * **Two screens in one page, and no route of its own.** The shelf is what the
 * module opens on; a book opens IN PLACE, so going back is one button rather than
 * a navigation the shell would have to know about - a kit module has exactly one
 * entry in the rail, which is what keeps "one row per module" true.
 *
 * **Everything the page draws came from main.** The rows, the tree, the article's
 * markdown, the hits and their ranges are all read from this module's ops, so
 * there is exactly one answer to any question the screen asks. The two things the
 * page computes itself are the block tree (the parser is `@nexus/core`, shared
 * with main) and where a relative link inside the pack points.
 *
 * **Why the article's markup is parsed HERE.** What main sends is the article's
 * text; React elements cannot cross a process boundary, and the parser is shared
 * code. The price is one parse per opened article, and the gain is a refusal that
 * names its line on the screen.
 *
 * **Why progress is polled rather than pushed.** The kit gives a module no event
 * channel (ADR-090), so the index's progress is read by asking again while it is
 * building - one read every 400 ms while a book is being prepared, and nothing
 * when it is not.
 */

/** How often the page asks main again while a pack's index is being built. */
const INDEX_POLL_MS = 400;

type SearchScope = "pack" | "all";

export default function ReaderPage({ profileId }: ModulePageProps) {
  const [library, setLibrary] = useState<ReaderLibraryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<ReaderPackView | null>(null);
  const [article, setArticle] = useState<ReaderArticleView | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [textSize, setTextSize] = useState<ReaderTextSize>("m");

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("pack");
  const [results, setResults] = useState<ReaderSearchView | null>(null);
  const [searching, setSearching] = useState(false);

  const [note, setNote] = useState("");
  const [printScope, setPrintScope] = useState<ReaderPrintScope>("article");
  const [paper, setPaper] = useState<ReaderPaperSize>("A4");
  const [printing, setPrinting] = useState(false);

  /** One read of the shelf. */
  const refreshLibrary = useCallback(async () => {
    try {
      const view = await window.nexus.modules.reader.library({ profileId });
      setLibrary(view);
      setTextSize(view.settings.textSize);
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the library could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  /** One read of the open book: its contents, its bookmarks and its index's progress. */
  const refreshPack = useCallback(
    async (packId: string) => {
      try {
        setPack(await window.nexus.modules.reader.contents({ profileId, packId }));
      } catch (failure) {
        setError(copy.errors.open);
        console.error("Nexus: the book could not be read:", failure);
      }
    },
    [profileId],
  );

  const openArticle = useCallback(
    async (packId: string, path: string) => {
      try {
        const view = await window.nexus.modules.reader.article({ profileId, packId, path });
        setArticle(view);
        setNote(view.note);
        setStatus(null);
        setError(null);
        // The position is written on purpose rather than by the read above: a read
        // that wrote would make "where am I" a side effect of looking.
        setPack(await window.nexus.modules.reader.setPosition({ profileId, packId, path }));
      } catch (failure) {
        setError(copy.errors.article);
        console.error("Nexus: the article could not be read:", failure);
      }
    },
    [profileId],
  );

  const openBook = useCallback(
    async (book: ReaderBookView) => {
      setArticle(null);
      setResults(null);
      setQuery("");
      try {
        const view = await window.nexus.modules.reader.contents({ profileId, packId: book.id });
        setPack(view);
        setTextSize(view.settings.textSize);
        if (book.safety && !view.acknowledged) {
          // The notice stands between the shelf and the book: nothing is read
          // until it has been accepted, which is what "must be acknowledged" means.
          setNoticeOpen(true);
          return;
        }
        const start = pickStartArticle(view.toc, view.position?.articlePath ?? null);
        if (start !== null) await openArticle(book.id, start);
      } catch (failure) {
        setError(copy.errors.open);
        console.error("Nexus: the book could not be opened:", failure);
      }
    },
    [openArticle, profileId],
  );

  const acceptNotice = useCallback(async () => {
    if (pack === null) return;
    try {
      const view = await window.nexus.modules.reader.acknowledge({ profileId, packId: pack.book.id });
      setPack(view);
      setNoticeOpen(false);
      const start = pickStartArticle(view.toc, view.position?.articlePath ?? null);
      if (start !== null) await openArticle(view.book.id, start);
    } catch (failure) {
      setStatus(copy.errors.mutate);
      console.error("Nexus: the notice could not be acknowledged:", failure);
    }
  }, [openArticle, pack, profileId]);

  const closeBook = useCallback(() => {
    setPack(null);
    setArticle(null);
    setResults(null);
    setQuery("");
    setStatus(null);
    setNoticeOpen(false);
    void refreshLibrary();
  }, [refreshLibrary]);

  const changeTextSize = useCallback(
    async (size: ReaderTextSize) => {
      setTextSize(size);
      try {
        const settings = await window.nexus.modules.reader.setTextSize({ profileId, textSize: size });
        setTextSize(settings.textSize);
      } catch (failure) {
        setStatus(copy.errors.mutate);
        console.error("Nexus: the text size was not saved:", failure);
      }
    },
    [profileId],
  );

  const toggleBookmark = useCallback(async () => {
    if (pack === null || article === null) return;
    const wasBookmarked = article.bookmarked;
    try {
      setPack(
        wasBookmarked
          ? await window.nexus.modules.reader.removeBookmark({
              profileId,
              packId: pack.book.id,
              path: article.path,
            })
          : await window.nexus.modules.reader.setBookmark({
              profileId,
              packId: pack.book.id,
              path: article.path,
              note: "",
            }),
      );
      setArticle({ ...article, bookmarked: !wasBookmarked, note: wasBookmarked ? "" : article.note });
      setNote(wasBookmarked ? "" : note);
    } catch (failure) {
      setStatus(copy.errors.mutate);
      console.error("Nexus: the bookmark was not saved:", failure);
    }
  }, [article, note, pack, profileId]);

  const saveNote = useCallback(async () => {
    if (pack === null || article === null) return;
    try {
      setPack(
        await window.nexus.modules.reader.setBookmark({
          profileId,
          packId: pack.book.id,
          path: article.path,
          note,
        }),
      );
      setArticle({ ...article, bookmarked: true, note });
    } catch (failure) {
      setStatus(copy.errors.mutate);
      console.error("Nexus: the note was not saved:", failure);
    }
  }, [article, note, pack, profileId]);

  const runSearch = useCallback(async () => {
    const text = query.trim();
    if (text.length === 0 || pack === null) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(
        await window.nexus.modules.reader.search({
          profileId,
          packId: scope === "pack" ? pack.book.id : null,
          query: text,
        }),
      );
    } catch (failure) {
      setStatus(copy.errors.load);
      console.error("Nexus: the search failed:", failure);
    } finally {
      setSearching(false);
    }
  }, [pack, profileId, query, scope]);

  // The one poll: while a pack's index is building, or while a search is still
  // waiting for one to finish, ask again. A pack that is ready costs nothing.
  const building = pack?.index.state === "building";
  const pending = results?.pending.length ?? 0;
  useEffect(() => {
    if (pack === null || (!building && pending === 0)) return;
    const handle = setInterval(() => {
      void refreshPack(pack.book.id);
      if (pending > 0) void runSearch();
    }, INDEX_POLL_MS);
    return () => clearInterval(handle);
  }, [building, pending, pack, refreshPack, runSearch]);

  const print = useCallback(async () => {
    if (pack === null) return;
    setPrinting(true);
    try {
      const result = await window.nexus.modules.reader.print({
        profileId,
        packId: pack.book.id,
        scope: printScope,
        path:
          printScope === "pack"
            ? null
            : printScope === "article"
              ? (article?.path ?? null)
              : (chapterOf(pack.toc, article) ?? article?.path ?? null),
        paper,
      });
      setStatus(
        result.outcome === "saved"
          ? `${copy.print.action}: ${result.filePath}`
          : result.outcome === "cancelled"
            ? copy.print.cancelled
            : result.reason === "unreadable-article"
              ? copy.print.refused
              : copy.print.failed,
      );
    } catch (failure) {
      setStatus(copy.print.failed);
      console.error("Nexus: the print job failed:", failure);
    } finally {
      setPrinting(false);
    }
  }, [article, pack, paper, printScope, profileId]);

  const openExternal = useCallback(async (url: string) => {
    try {
      await window.nexus.modules.reader.openExternal({ url });
    } catch (failure) {
      console.error("Nexus: the source link could not be opened:", failure);
    }
  }, []);

  return (
    <div className="reader" data-size={textSize}>
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="book"
      />
      {error !== null && (
        <p className="reader__error" role="alert">
          {error}
        </p>
      )}
      {library === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : pack === null ? (
        <Shelf library={library} onOpen={openBook} />
      ) : (
        <Book
          pack={pack}
          article={article}
          textSize={textSize}
          onChangeTextSize={changeTextSize}
          onOpenArticle={(path) => void openArticle(pack.book.id, path)}
          onClose={closeBook}
          onOpenExternal={(url) => void openExternal(url)}
          query={query}
          onQuery={setQuery}
          scope={scope}
          onScope={setScope}
          onSearch={() => void runSearch()}
          searching={searching}
          results={results}
          note={note}
          onNote={setNote}
          onToggleBookmark={() => void toggleBookmark()}
          onSaveNote={() => void saveNote()}
          printScope={printScope}
          onPrintScope={setPrintScope}
          paper={paper}
          onPaper={setPaper}
          printing={printing}
          onPrint={() => void print()}
          status={status}
        />
      )}
      {noticeOpen && pack !== null && (
        <NoticeDialog onAccept={() => void acceptNotice()} onClose={closeBook} />
      )}
    </div>
  );
}

// --- The shelf ---------------------------------------------------------------

function Shelf({
  library,
  onOpen,
}: {
  library: ReaderLibraryView;
  onOpen: (book: ReaderBookView) => void;
}) {
  if (library.books.length === 0) {
    return (
      <EmptyState
        sigil="book"
        title={copy.library.emptyTitle}
        description={copy.library.emptyBody}
      />
    );
  }
  const megabytes = numberFormat({ style: "unit", unit: "megabyte", maximumFractionDigits: 1 });
  return (
    <Card className="reader__card" title={copy.library.title}>
      <div className="reader__shelf">
        {library.books.map((book) => (
          <ListRow
            key={book.id}
            leading={<Icon name="book" />}
            trailing={
              <span className="reader__row-actions">
                {book.safety && (
                  <Chip variant="danger">
                    <Icon name="warning" size={14} />
                    {copy.library.safety}
                  </Chip>
                )}
                <Button size="sm" variant="primary" onClick={() => onOpen(book)}>
                  {book.lastArticle === null ? copy.library.open : copy.library.resume}
                </Button>
              </span>
            }
          >
            <span className="reader__book-title">{declaredText(book.title)}</span>
            <span className="reader__book-meta">
              {copy.library.version} {book.version} - {megabytes.format(book.size / (1024 * 1024))}
              {book.articleCount === null ? null : ` - ${String(book.articleCount)} ${copy.library.articles}`}
            </span>
          </ListRow>
        ))}
      </div>
    </Card>
  );
}

// --- One book ----------------------------------------------------------------

interface BookProps {
  readonly pack: ReaderPackView;
  readonly article: ReaderArticleView | null;
  readonly textSize: ReaderTextSize;
  readonly onChangeTextSize: (size: ReaderTextSize) => void;
  readonly onOpenArticle: (path: string) => void;
  readonly onClose: () => void;
  readonly onOpenExternal: (url: string) => void;
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly scope: SearchScope;
  readonly onScope: (scope: SearchScope) => void;
  readonly onSearch: () => void;
  readonly searching: boolean;
  readonly results: ReaderSearchView | null;
  readonly note: string;
  readonly onNote: (value: string) => void;
  readonly onToggleBookmark: () => void;
  readonly onSaveNote: () => void;
  readonly printScope: ReaderPrintScope;
  readonly onPrintScope: (scope: ReaderPrintScope) => void;
  readonly paper: ReaderPaperSize;
  readonly onPaper: (paper: ReaderPaperSize) => void;
  readonly printing: boolean;
  readonly onPrint: () => void;
  readonly status: string | null;
}

function Book(props: BookProps) {
  const { pack, article } = props;
  const progress = indexProgress(pack.index);
  return (
    <div className="reader__book">
      <div className="reader__toolbar">
        <Button size="sm" variant="quiet" onClick={props.onClose}>
          <Icon name="chevronLeft" size={16} />
          {copy.reading.back}
        </Button>
        <span className="reader__book-name">{declaredText(pack.book.title)}</span>
        <span className="reader__text-size">
          <span className="reader__text-size-label">{copy.reading.textSize}</span>
          <span className="reader__text-size-options">
            {(["s", "m", "l"] as const).map((size) => (
              <Button
                key={size}
                size="sm"
                aria-pressed={props.textSize === size}
                onClick={() => props.onChangeTextSize(size)}
              >
                {size === "s"
                  ? copy.reading.sizeSmall
                  : size === "m"
                    ? copy.reading.sizeMedium
                    : copy.reading.sizeLarge}
              </Button>
            ))}
          </span>
        </span>
      </div>
      {progress !== null && (
        <p className="nx-hint reader__status" role="status">
          {`${copy.index.building}: ${numberFormat({
            style: "percent",
            maximumFractionDigits: 0,
          }).format(progress)}`}
        </p>
      )}
      {pack.index.state === "failed" && <p className="reader__error">{copy.index.failed}</p>}
      <div className="reader__panes">
        <nav className="reader__toc" aria-label={copy.toc.title}>
          <p className="nx-eyebrow">{copy.toc.title}</p>
          <Toc nodes={pack.toc} current={article?.path ?? null} onOpen={props.onOpenArticle} />
          {pack.bookmarks.length > 0 && (
            <>
              <p className="nx-eyebrow">{copy.library.bookmarks}</p>
              <ul className="reader__toc-list">
                {pack.bookmarks.map((bookmark) => (
                  <li key={`${bookmark.packId}/${bookmark.articlePath}`}>
                    <button
                      type="button"
                      className="reader__toc-row"
                      aria-label={copy.library.bookmarks}
                      onClick={() => props.onOpenArticle(bookmark.articlePath)}
                    >
                      <Icon name="pin" size={14} />
                      {bookmark.title}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>
        <div className="reader__main">
          <SearchBar
            query={props.query}
            onQuery={props.onQuery}
            scope={props.scope}
            onScope={props.onScope}
            onSearch={props.onSearch}
            searching={props.searching}
            results={props.results}
            onOpenArticle={props.onOpenArticle}
          />
          {article === null ? null : (
            <Article
              article={article}
              packId={pack.book.id}
              known={knownArticles(pack.toc)}
              onOpenArticle={props.onOpenArticle}
              onOpenExternal={props.onOpenExternal}
              note={props.note}
              onNote={props.onNote}
              onToggleBookmark={props.onToggleBookmark}
              onSaveNote={props.onSaveNote}
            />
          )}
          {article !== null && (
            <div className="reader__footer">
              <Button
                size="sm"
                disabled={article.previous === null}
                onClick={() => article.previous !== null && props.onOpenArticle(article.previous)}
              >
                <Icon name="chevronLeft" size={16} />
                {copy.reading.previous}
              </Button>
              <Button
                size="sm"
                disabled={article.next === null}
                onClick={() => article.next !== null && props.onOpenArticle(article.next)}
              >
                {copy.reading.next}
                <Icon name="chevronRight" size={16} />
              </Button>
              <span className="reader__print">
                <Select
                  label={copy.print.action}
                  layout="inline"
                  value={props.printScope}
                  onChange={(event) => props.onPrintScope(event.target.value as ReaderPrintScope)}
                >
                  <option value="article">{copy.print.article}</option>
                  <option value="chapter">{copy.print.chapter}</option>
                  <option value="pack">{copy.print.pack}</option>
                </Select>
                <Select
                  label={copy.print.paper}
                  layout="inline"
                  value={props.paper}
                  onChange={(event) => props.onPaper(event.target.value as ReaderPaperSize)}
                >
                  <option value="A4">A4</option>
                  <option value="A5">A5</option>
                </Select>
                <Button size="sm" variant="primary" disabled={props.printing} onClick={props.onPrint}>
                  {copy.print.action}
                </Button>
              </span>
            </div>
          )}
          {props.status !== null && (
            <p className="nx-hint" role="status">
              {props.status}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Every article id the pack's tree holds, so a relative link can be known to exist. */
function knownArticles(nodes: readonly ReaderTocViewNode[]): ReadonlySet<string> {
  const ids = new Set<string>();
  const walk = (list: readonly ReaderTocViewNode[]): void => {
    for (const node of list) {
      if (node.kind === "article") ids.add(node.id);
      else walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

/** The chapter an article sits under, or the article itself when it sits at the pack's root. */
function chapterOf(nodes: readonly ReaderTocViewNode[], article: ReaderArticleView | null): string | null {
  if (article === null) return null;
  const find = (list: readonly ReaderTocViewNode[]): string | null => {
    for (const node of list) {
      if (node.kind === "article") continue;
      if (node.children.some((child) => child.kind === "article" && child.id === article.path)) {
        return node.id;
      }
      const inner = find(node.children);
      if (inner !== null) return inner;
    }
    return null;
  };
  return find(nodes);
}

// --- The table of contents ---------------------------------------------------

function Toc({
  nodes,
  current,
  onOpen,
}: {
  nodes: readonly ReaderTocViewNode[];
  current: string | null;
  onOpen: (path: string) => void;
}) {
  return (
    <ul className="reader__toc-list">
      {nodes.map((node) =>
        node.kind === "article" ? (
          <li key={node.id}>
            <button
              type="button"
              className="reader__toc-row"
              aria-current={node.id === current ? "page" : undefined}
              onClick={() => onOpen(node.id)}
            >
              {node.title}
            </button>
          </li>
        ) : (
          <li key={node.id}>
            <details open className="reader__toc-chapter">
              <summary>
                <span className="nx-eyebrow">{copy.toc.chapter}</span>
                {node.title}
              </summary>
              <Toc nodes={node.children} current={current} onOpen={onOpen} />
            </details>
          </li>
        ),
      )}
    </ul>
  );
}

// --- The article -------------------------------------------------------------

function Article({
  article,
  packId,
  known,
  onOpenArticle,
  onOpenExternal,
  note,
  onNote,
  onToggleBookmark,
  onSaveNote,
}: {
  article: ReaderArticleView;
  packId: string;
  known: ReadonlySet<string>;
  onOpenArticle: (path: string) => void;
  onOpenExternal: (url: string) => void;
  note: string;
  onNote: (value: string) => void;
  onToggleBookmark: () => void;
  onSaveNote: () => void;
}) {
  const parsed = parseArticle(article.markdown);
  return (
    <article className="reader__article">
      <h1 className="reader__title">{article.title}</h1>
      {article.notice === "safety" && <SafetyNotice />}
      <p className="reader__source">
        <span className="reader__source-label">{copy.reading.source}</span>
        <a
          className="reader__link"
          href={article.source.url}
          rel="noreferrer noopener"
          target="_blank"
          onClick={(event) => {
            // The window-open handler denies every new window (SEC-EL-03), so the
            // click is intercepted here and the address opens through main's one
            // vetted call instead.
            event.preventDefault();
            onOpenExternal(article.source.url);
          }}
        >
          {article.source.name}
          <Icon name="external" size={14} />
        </a>
      </p>
      {parsed.error === null ? (
        <ReaderBlocks
          blocks={parsed.blocks}
          packId={packId}
          articlePath={article.path}
          known={known}
          onOpenArticle={onOpenArticle}
          onOpenExternal={onOpenExternal}
        />
      ) : (
        <p className="reader__error" role="alert">
          {parsed.error}
        </p>
      )}
      <div className="reader__article-actions">
        <Button size="sm" aria-pressed={article.bookmarked} onClick={onToggleBookmark}>
          <Icon name="pin" size={16} />
          {article.bookmarked ? copy.reading.removeBookmark : copy.reading.bookmark}
        </Button>
      </div>
      {article.bookmarked && (
        <div className="reader__note">
          <TextField
            label={copy.reading.note}
            value={note}
            maxLength={500}
            onChange={(event) => onNote(event.target.value)}
          />
          <Button size="sm" onClick={onSaveNote}>
            {copy.reading.saveNote}
          </Button>
        </div>
      )}
    </article>
  );
}

/** The article parsed once, or the sentence that says why it could not be. */
function parseArticle(markdown: string): { blocks: readonly ReaderBlock[]; error: string | null } {
  try {
    return { blocks: parseReaderMarkdown(markdown), error: null };
  } catch (failure) {
    if (failure instanceof ReaderMarkdownError) {
      // The refusal names the line, which is the only thing a pack's author can
      // act on; the sentence itself stays the page's copy.
      return { blocks: [], error: `${copy.errors.article} (${failure.line})` };
    }
    console.error("Nexus: the article could not be parsed:", failure);
    return { blocks: [], error: copy.errors.article };
  }
}

// --- Search ------------------------------------------------------------------

function SearchBar({
  query,
  onQuery,
  scope,
  onScope,
  onSearch,
  searching,
  results,
  onOpenArticle,
}: {
  query: string;
  onQuery: (value: string) => void;
  scope: SearchScope;
  onScope: (scope: SearchScope) => void;
  onSearch: () => void;
  searching: boolean;
  results: ReaderSearchView | null;
  onOpenArticle: (path: string) => void;
}) {
  const pending = results?.pending.length ?? 0;
  const index = results?.index;
  return (
    <div className="reader__search">
      <form
        className="reader__search-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <TextField
          label={copy.search.label}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <Select
          label={copy.search.label}
          layout="inline"
          value={scope}
          onChange={(event) => onScope(event.target.value as SearchScope)}
        >
          <option value="pack">{copy.search.inPack}</option>
          <option value="all">{copy.search.everywhere}</option>
        </Select>
        <Button size="sm" type="submit" variant="primary" disabled={searching}>
          {copy.search.label}
        </Button>
      </form>
      <p className="nx-hint">{copy.search.hint}</p>
      {pending > 0 && (
        <p className="nx-hint reader__status" role="status">
          {`${copy.search.building}: ${numberFormat({
            style: "percent",
            maximumFractionDigits: 0,
          }).format(
            index === undefined || index.articlesTotal === 0
              ? 0
              : index.articlesDone / index.articlesTotal,
          )}`}
        </p>
      )}
      {results !== null && (
        <div className="reader__results">
          {results.hits.length === 0 ? (
            <p className="nx-hint">{copy.search.empty}</p>
          ) : (
            <>
              {/* The heading says what the first group of hits IS - the title
                  matches - so a reader can tell "found in the title" from "found in
                  the text" without comparing highlighting between rows. */}
              {results.hits.some((hit) => hit.titleMatch) && (
                <p className="nx-eyebrow">{copy.search.titles}</p>
              )}
              <ul className="reader__toc-list">
                {results.hits.map((hit) => (
                <li key={`${hit.packId}/${hit.path}`}>
                  <button
                    type="button"
                    className="reader__result"
                    onClick={() => onOpenArticle(hit.path)}
                  >
                    <span className="reader__result-title">
                      {highlightSegments(hit.title, hit.titleRanges).map((segment, index) =>
                        segment.match ? (
                          <mark key={index}>{segment.text}</mark>
                        ) : (
                          <span key={index}>{segment.text}</span>
                        ),
                      )}
                    </span>
                    {hit.snippet !== null && (
                      <span className="reader__result-snippet">
                        {highlightSegments(hit.snippet, hit.snippetRanges).map((segment, index) =>
                          segment.match ? (
                            <mark key={index}>{segment.text}</mark>
                          ) : (
                            <span key={index}>{segment.text}</span>
                          ),
                        )}
                      </span>
                    )}
                  </button>
                </li>
                ))}
              </ul>
            </>
          )}
          {results.truncated && <p className="nx-hint">{copy.search.truncated}</p>}
        </div>
      )}
    </div>
  );
}

// --- The notice --------------------------------------------------------------

/**
 * The acknowledgement a `notice: "safety"` pack asks for before it is read.
 *
 * Escape and the backdrop close the DIALOG - never the requirement: the pack
 * stays unacknowledged, so the question is asked again the next time it is
 * opened. The house dialog recipe (`.recur-dialog__*`) carries the overlay, the
 * backdrop and the panel, and `useFocusTrap` is the same hook every other dialog
 * in this app attaches, so this file adds no behaviour the others do not have.
 */
function NoticeDialog({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="recur-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-label={copy.notice.title}
      >
        <h2 className="recur-dialog__title">{copy.notice.title}</h2>
        <SafetyNotice />
        <div className="recur-dialog__actions">
          <Button variant="primary" onClick={onAccept}>
            {copy.notice.accept}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            {copy.notice.close}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

