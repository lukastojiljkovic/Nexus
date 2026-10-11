import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { parseSearchQuery } from "@nexus/core";
import { Button, EmptyState, Icon, PageHeader, TextField } from "@nexus/ui";
import type { SearchHistoryEntry, SearchPageResult, SearchResult } from "../../shared/ipc.js";
import {
  SEARCH_DEBOUNCE_MS,
  formatContextDate,
  groupByKind,
  isRecordableQuery,
  renderHighlighted,
  toggleKindInQuery,
  toggleTagInQuery,
} from "./searchShared.js";
import { searchKindLabel } from "./moduleKit/labels.js";
import { dayUnit, strings } from "./strings.js";

/**
 * The ADR-039 full search page — the browse surface the palette defers to.
 *
 * It is a SHELL surface, not a module: `App.tsx` special-cases it next to the
 * registry check, so it never appears in the Settings module gallery and the
 * registry's "hub pages only" rule stays intact.
 *
 * The page owns exactly ONE piece of search state: the raw query string.
 * Every facet edits that string rather than a parallel filter model, which is
 * what makes typing and clicking compose — a kind chip splices the same `z:`
 * token a user could have typed, a tag chip the same `#oznaka`, and both read
 * their active state back out of the query. It also means a query carried in
 * from the palette needs no translation, and one carried back out would mean
 * the same thing there.
 *
 * Browse mode shows two lists (SRCH-009), exactly as the palette's empty box
 * does: „Nedavne pretrage" — the queries this profile typed — above the
 * recent entities it opened. Picking a query fills the box rather than running
 * anything, and each row can be forgotten on its own; the „Obriši istoriju
 * pretrage" that empties the whole list lives in Settings' „Podaci i
 * privatnost" card, beside the other statements about what is stored.
 */

/** How many hits are revealed per "Prikaži još" press. No virtualization: a chunked list is enough for a 500-result ceiling. */
const RESULT_CHUNK = 50;

const EMPTY_RESULT: SearchPageResult = {
  hits: [],
  total: 0,
  truncated: false,
  kindCounts: [],
  tagFacets: [],
};

export interface SearchPageProps {
  profileId: string;
  /**
   * A query handed over by the palette's "Prikaži sve rezultate" row,
   * consumed once on arrival. `null` means the page was opened from the
   * sidebar and starts in browse mode.
   */
  seed: string | null;
  /** Clears the shell's seed so re-visiting the page later does not re-apply a stale query. */
  onSeedConsumed: () => void;
  /** Activates a result — the shell's own reveal dispatcher, shared with the palette. */
  onOpenResult: (result: SearchResult) => void;
  /** The palette's LIVE chord, formatted by the shell (ADR-040) — a remap must be visible here too. */
  paletteChordLabel: string;
}

export function SearchPage({
  profileId,
  seed,
  onSeedConsumed,
  onOpenResult,
  paletteChordLabel,
}: SearchPageProps) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchPageResult>(EMPTY_RESULT);
  const [visible, setVisible] = useState(RESULT_CHUNK);
  /**
   * True only when the fetch below REJECTED. The palette has carried this since
   * the silent-failure sweep; this page kept the defect the sweep was named
   * after, one file over — it caught the rejection, emptied `data` and let the
   * render say „Nema rezultata", which is a real answer to a question that was
   * never actually asked.
   */
  const [searchFailed, setSearchFailed] = useState(false);
  /** The profile's remembered QUERIES (SRCH-009), shown in browse mode beside the recent entities — never instead of them. */
  const [history, setHistory] = useState<readonly SearchHistoryEntry[]>([]);
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Handed to `PageHeader` so the field below can be named by the title. */
  const titleId = useId();

  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const activeKinds = useMemo(() => new Set(parsed.kinds), [parsed.kinds]);
  const activeTags = useMemo(() => new Set(parsed.tags), [parsed.tags]);
  const isBrowsing = query.trim().length === 0;

  // Adopts a query handed over by the palette, then immediately clears it so
  // returning to this page later cannot re-apply a stale one. Keyed on `seed`
  // rather than run once on mount, because Ctrl+K works on this page too:
  // "Prikaži sve rezultate" pressed while already here must still replace the
  // query, and that path never remounts the component.
  useEffect(() => {
    if (seed === null) return;
    setQuery(seed);
    onSeedConsumed();
  }, [seed, onSeedConsumed]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The remembered queries, read once on arrival. Every later change to them
  // is this component's own write, and each of those hands back the fresh list
  // (the `search:history-*` channels answer with the result), so there is
  // nothing here to poll.
  useEffect(() => {
    let cancelled = false;
    void window.nexus
      .searchHistory(profileId)
      .then((entries) => {
        if (!cancelled) setHistory(entries);
      })
      .catch((error: unknown) => {
        console.error("Nexus: loading the search history failed:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  // Debounced fetch with a stale-response guard, the same two-layer scheme the
  // palette uses: the timer debounces keystrokes, while the request id guards
  // the rarer race where two fetches overlap and the OLDER one's round trip
  // simply finishes later.
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const fetched = await window.nexus.searchPage(profileId, query);
          if (requestIdRef.current === requestId) {
            setData(fetched);
            setVisible(RESULT_CHUNK);
            setSearchFailed(false);
          }
        } catch (error) {
          if (requestIdRef.current === requestId) {
            console.error("Nexus: search page query failed:", error);
            setData(EMPTY_RESULT);
            setSearchFailed(true);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [profileId, query]);

  const shown = data.hits.slice(0, visible);
  // Flat when the query narrows to exactly one kind: a single group heading
  // over a single group is a label repeating the chip directly above it.
  const flat = parsed.kinds.length === 1;
  const groups = flat ? [] : groupByKind(shown);

  /**
   * SRCH-009: a query is remembered when the user COMMITTED to it, which on
   * this page means opening a result it found (`isRecordableQuery` carries the
   * rest of the rule). The query string IS this page's whole search state —
   * chips edit the text itself — so what is stored is exactly what is in the
   * box, operators included. A failure is never worth a message: the search
   * worked and the user is already on their way somewhere.
   */
  function rememberQuery(): void {
    if (!isRecordableQuery(query)) return;
    void window.nexus
      .recordSearchHistory(profileId, query)
      .then(setHistory)
      .catch((error: unknown) => {
        console.error("Nexus: recording the search history failed:", error);
      });
  }

  function forgetQuery(text: string): void {
    void window.nexus
      .removeSearchHistory(profileId, text)
      .then(setHistory)
      .catch((error: unknown) => {
        console.error("Nexus: forgetting a search history entry failed:", error);
      });
  }

  /**
   * One result, in the same three levels the palette draws — where it lives,
   * what matched, the line it matched in — because the two surfaces are one
   * instrument at two sizes and a row that reads differently here would say
   * otherwise.
   *
   * `showKind` follows the palette's rule exactly: the kind is stated on the
   * row only where no group heading above it already states it, which on this
   * page means browse mode and the flat single-kind list.
   */
  function renderRow(result: SearchResult, showKind: boolean): ReactNode {
    return (
      <button
        key={`${result.kind}-${result.entityId}`}
        type="button"
        className="searchpage__row"
        onClick={() => {
          rememberQuery();
          onOpenResult(result);
        }}
      >
        <span className="searchpage__row-main">
          <span className="searchpage__row-text">
            {showKind && (
              <span className="nx-eyebrow searchpage__row-kind">
                {searchKindLabel(result.kind, false)}
              </span>
            )}
            <span className="searchpage__row-title">
              {renderHighlighted(result.title, result.titleRanges)}
            </span>
            {result.snippet.length > 0 && (
              <span className="searchpage__row-snippet">
                {renderHighlighted(result.snippet, result.snippetRanges)}
              </span>
            )}
            {/* The match was inside an attached file, not in anything above
                (SRCH-008). Said out loud rather than left to look like a row
                that matched nothing. */}
            {result.fromAttachment && (
              <span className="searchpage__row-source">{strings.search.fromAttachment}</span>
            )}
          </span>
        </span>
        {/* The kind's own date when it has one (due/start/expiry/exam), and
            otherwise when it was last touched — a browse surface with an
            empty date column on every note and subject reads as unfinished.
            Both go through the same existing formatters; only the fallback is
            labelled, since "last edited" is the one that is not obvious. */}
        {result.contextDate !== null ? (
          <span className="searchpage__row-date">{formatContextDate(result.contextDate)}</span>
        ) : (
          <span className="searchpage__row-date" title={strings.search.page.updatedLabel}>
            {formatContextDate(result.updatedAt)}
          </span>
        )}
      </button>
    );
  }

  return (
    <section className="searchpage">
      <PageHeader
        title={strings.search.page.title}
        titleId={titleId}
        sigil="search"
        subtitle={`${paletteChordLabel} ${strings.search.page.shortcutHint}`}
      />
      {/* Named BY REFERENCE to the heading, not by a copy of it. The
          `aria-label` that stood here held the same words as `title`, which is
          [[DC-120]] exactly: two spellings of one name, and the day either is
          reworded the screen and the screen reader disagree about what the
          field is called. `titleId` is what makes the heading the name. */}
      <TextField
        ref={inputRef}
        aria-labelledby={titleId}
        className="searchpage__input"
        placeholder={strings.search.placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="searchpage__facets">
        <div className="searchpage__chips" role="group" aria-label={strings.search.kindFilterLabel}>
          {/* "Sve" is not a filter of its own — it clears whatever kind tokens
              the query carries, which is the same thing said positively. */}
          <Button
            size="sm"
            className="nx-segmented__option searchpage__chip"
            aria-pressed={activeKinds.size === 0}
            onClick={() =>
              setQuery((current) =>
                parsed.kinds.reduce((text, kind) => toggleKindInQuery(text, kind), current),
              )
            }
          >
            {strings.search.page.allKinds}
          </Button>
          {/* Only kinds actually present are offered: a chip reading "0" is a
              dead end the user can click but never get anything from. A kind
              already in the query stays listed even at zero, or switching it
              off would mean deleting the token by hand. */}
          {data.kindCounts
            .filter(({ kind, count }) => count > 0 || activeKinds.has(kind))
            .map(({ kind, count }) => (
              <Button
                key={kind}
                size="sm"
                className="nx-segmented__option searchpage__chip"
                aria-pressed={activeKinds.has(kind)}
                onClick={() => setQuery((current) => toggleKindInQuery(current, kind))}
              >
                {searchKindLabel(kind, true)}
                <span className="searchpage__chip-count">{count}</span>
              </Button>
            ))}
        </div>

        {data.tagFacets.length > 0 && (
          <div
            className="searchpage__chips"
            role="group"
            aria-label={strings.search.page.tagFilterLabel}
          >
            {data.tagFacets.map((facet) => (
              <Button
                key={facet.token}
                size="sm"
                className="nx-segmented__option searchpage__chip"
                aria-pressed={activeTags.has(facet.token)}
                onClick={() => setQuery((current) => toggleTagInQuery(current, facet.token))}
              >
                {`#${facet.name}`}
                <span className="searchpage__chip-count">{facet.count}</span>
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="searchpage__meta">
        <span className="searchpage__count">
          {data.truncated
            ? `${data.total}+ ${strings.search.page.resultsUnitMany}`
            : `${data.total} ${dayUnit(
                data.total,
                strings.search.page.resultsUnitOne,
                strings.search.page.resultsUnitMany,
              )}`}
        </span>
        <span className="searchpage__grammar">{strings.search.page.grammarHint}</span>
      </div>

      {data.truncated && <p className="searchpage__truncated">{strings.search.page.truncatedNote}</p>}

      {/* SRCH-009. Browse mode only — the moment anything is typed, that text
          is a better answer than a list of earlier ones — and above the recent
          ENTITIES rather than merged with them: one list is what you looked
          for, the other what you opened. Picking a row fills the box; it does
          not open anything, so nothing runs out of sight. */}
      {isBrowsing && history.length > 0 && (
        <div className="searchpage__group">
          <div className="searchpage__group-heading">{strings.search.historyGroup}</div>
          {history.map((entry) => (
            <div className="searchpage__history" key={entry.query}>
              <button
                type="button"
                className="searchpage__row searchpage__history-run"
                onClick={() => {
                  setQuery(entry.query);
                  inputRef.current?.focus();
                }}
              >
                <span className="searchpage__row-title">{entry.query}</span>
              </button>
              <button
                type="button"
                className="searchpage__history-remove"
                aria-label={strings.search.historyRemove}
                title={strings.search.historyRemove}
                onClick={() => forgetQuery(entry.query)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* A rejection is reported instead of the empty state, and it is reported
          in browse mode too: the recent-entities list comes from the same
          `search:page` call, so a browse that failed is exactly as silent as a
          query that did. One sentence, shared with the palette rather than
          copied — the two surfaces cannot drift into two ways of saying that
          search is down. */}
      {searchFailed ? (
        <p className="searchpage__error" role="alert">
          {strings.search.searchError}
        </p>
      ) : data.hits.length === 0 ? (
        !isBrowsing && (
          <EmptyState
            sigil="search"
            title={strings.search.page.emptyTitle}
            description={strings.search.page.emptyDescription}
          />
        )
      ) : (
        <div className="searchpage__results">
          {flat || isBrowsing ? (
            <div className="searchpage__group">
              {isBrowsing && (
                <div className="searchpage__group-heading">{strings.search.page.browseHeading}</div>
              )}
              {/* Flat means the query narrowed to ONE kind, and the pressed
                  chip above already says which — so only the mixed browse list
                  carries the kind on its rows. */}
              {shown.map((result) => renderRow(result, isBrowsing))}
            </div>
          ) : (
            groups.map(([kind, list]) => (
              <div className="searchpage__group" key={kind}>
                <div className="searchpage__group-heading">{searchKindLabel(kind, true)}</div>
                {list.map((result) => renderRow(result, false))}
              </div>
            ))
          )}

          {visible < data.hits.length && (
            <Button
              className="searchpage__more"
              onClick={() => setVisible((current) => current + RESULT_CHUNK)}
            >
              {strings.search.page.showMore}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
