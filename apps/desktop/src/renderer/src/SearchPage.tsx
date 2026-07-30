import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { parseSearchQuery } from "@nexus/core";
import { Button, Chip, EmptyState } from "@nexus/ui";
import type { SearchPageResult, SearchResult } from "../../shared/ipc.js";
import {
  SEARCH_DEBOUNCE_MS,
  formatContextDate,
  groupByKind,
  renderHighlighted,
  toggleKindInQuery,
  toggleTagInQuery,
} from "./searchShared.js";
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
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
          }
        } catch (error) {
          if (requestIdRef.current === requestId) {
            console.error("Nexus: search page query failed:", error);
            setData(EMPTY_RESULT);
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

  function renderRow(result: SearchResult): ReactNode {
    return (
      <button
        key={`${result.kind}-${result.entityId}`}
        type="button"
        className="searchpage__row"
        onClick={() => onOpenResult(result)}
      >
        <span className="searchpage__row-main">
          <Chip className="searchpage__row-kind">{strings.search.kindSingular[result.kind]}</Chip>
          <span className="searchpage__row-text">
            <span className="searchpage__row-title">
              {renderHighlighted(result.title, result.titleRanges)}
            </span>
            {result.snippet.length > 0 && (
              <span className="searchpage__row-snippet">
                {renderHighlighted(result.snippet, result.snippetRanges)}
              </span>
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
      <header className="searchpage__header">
        <div className="searchpage__heading">
          <h1 className="searchpage__title">{strings.search.page.title}</h1>
          <span className="searchpage__shortcut">
            {`${paletteChordLabel} ${strings.search.page.shortcutHint}`}
          </span>
        </div>
        <input
          ref={inputRef}
          type="text"
          className="nx-textfield__input searchpage__input"
          placeholder={strings.search.placeholder}
          aria-label={strings.search.page.title}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>

      <div className="searchpage__facets">
        <div className="searchpage__chips" role="group" aria-label={strings.search.kindFilterLabel}>
          {/* "Sve" is not a filter of its own — it clears whatever kind tokens
              the query carries, which is the same thing said positively. */}
          <Button
            size="sm"
            className={
              activeKinds.size === 0
                ? "searchpage__chip searchpage__chip--active"
                : "searchpage__chip"
            }
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
                className={
                  activeKinds.has(kind)
                    ? "searchpage__chip searchpage__chip--active"
                    : "searchpage__chip"
                }
                aria-pressed={activeKinds.has(kind)}
                onClick={() => setQuery((current) => toggleKindInQuery(current, kind))}
              >
                {strings.search.kindPlural[kind]}
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
                className={
                  activeTags.has(facet.token)
                    ? "searchpage__chip searchpage__chip--active"
                    : "searchpage__chip"
                }
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

      {data.hits.length === 0 ? (
        !isBrowsing && (
          <EmptyState
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
              {shown.map((result) => renderRow(result))}
            </div>
          ) : (
            groups.map(([kind, list]) => (
              <div className="searchpage__group" key={kind}>
                <div className="searchpage__group-heading">{strings.search.kindPlural[kind]}</div>
                {list.map((result) => renderRow(result))}
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
