import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { parseSearchQuery, SEARCH_KIND_PREFIXES, SEARCH_KINDS } from "@nexus/core";
import type { SearchKind } from "@nexus/core";
import { Button, Chip } from "@nexus/ui";
import type { SearchHighlight, SearchResult } from "../../shared/ipc.js";
import { REBUILD_COMMAND_ID, matchCommands } from "./searchCommands.js";
import type { SearchCommand } from "./searchCommands.js";
import { formatExamDate } from "./examDates.js";
import { formatNotificationWhen } from "./notificationFormat.js";
import { strings } from "./strings.js";

/**
 * The ADR-021 global search palette (021-d): a Spotlight-style overlay,
 * portalled to `document.body`, opened via the sidebar's Pretraga item or
 * Ctrl/Cmd+K. The index/store/IPC pipeline already exists (021-a/b) — this
 * component is the surface a user actually touches: a typed query plus kind
 * chips against entity results, local command matching against the fixed
 * registry in `searchCommands.ts`, and one shared keyboard model across
 * both. Selection styling mirrors `suggestionMenu.tsx` exactly (gold text +
 * weight over a soft surface, no glow, no inset bar); the DOM shape does
 * not, deliberately — see the row-role comment below.
 */

const SEARCH_PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 120;
/** How long the rebuild command's confirmation stays on screen before the palette auto-closes (spec: "reports its count first ... then close"). */
const STATUS_MESSAGE_DISPLAY_MS = 1400;

/**
 * For each kind, the shortest alias in `SEARCH_KIND_PREFIXES` — computed
 * once so a chip click can splice a real prefix token ("z:") into the query
 * text without hand-duplicating core's own alias table (and risking it
 * drifting from this one).
 */
const KIND_QUERY_PREFIX: Record<SearchKind, string> = (() => {
  const shortest: Partial<Record<SearchKind, string>> = {};
  for (const [alias, kind] of Object.entries(SEARCH_KIND_PREFIXES)) {
    const current = shortest[kind];
    if (current === undefined || alias.length < current.length) {
      shortest[kind] = alias;
    }
  }
  // Every kind has at least one alias in SEARCH_KIND_PREFIXES (core's own
  // invariant), so the loop above has populated every key by now — the cast
  // just states what it already guarantees.
  return shortest as Record<SearchKind, string>;
})();

export interface SearchPaletteProps {
  profileId: string;
  open: boolean;
  onClose: () => void;
  commands: readonly SearchCommand[];
  /** Activates a result — the shell decides where that lands. */
  onOpenResult: (result: SearchResult) => void;
  /**
   * The rebuild command's Serbian confirmation (or error) text. Owned by the
   * shell (`App.tsx`), since that is where `buildSearchCommands` is called
   * and therefore where the closure that receives the IPC result lives.
   * `null` shows the ordinary key-hint footer instead; a non-null value also
   * starts this component's auto-close timer.
   */
  statusMessage: string | null;
}

type PaletteRow =
  | { readonly id: string; readonly kind: "result"; readonly result: SearchResult }
  | { readonly id: string; readonly kind: "command"; readonly command: SearchCommand };

function resultRowId(result: SearchResult): string {
  return `search-row-result-${result.kind}-${result.entityId}`;
}
function commandRowId(command: SearchCommand): string {
  return `search-row-command-${command.id}`;
}

/** Groups results by kind, in `SEARCH_KINDS` order, dropping empty groups. */
function groupByKind(results: readonly SearchResult[]): Array<[SearchKind, SearchResult[]]> {
  const byKind = new Map<SearchKind, SearchResult[]>();
  for (const result of results) {
    const list = byKind.get(result.kind);
    if (list) list.push(result);
    else byKind.set(result.kind, [result]);
  }
  return SEARCH_KINDS.filter((kind) => byKind.has(kind)).map(
    (kind) => [kind, byKind.get(kind) ?? []] as [SearchKind, SearchResult[]],
  );
}

/**
 * `contextDate` is either a bare "YYYY-MM-DD" (task/document/exam) or a full
 * ISO instant (event/card) — the two shapes it ever carries, per kind, in
 * the search index (migration 017). No single existing formatter handles
 * both, so this picks the right one of the two that already exist rather
 * than adding a third: `formatExamDate` (bare dates, day+month+year) or
 * `formatNotificationWhen` (instants, "HH:MM today, else day + HH:MM").
 */
function formatContextDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatExamDate(value) : formatNotificationWhen(value);
}

/**
 * Renders `text` with `ranges` wrapped in `<mark>`. Ranges are half-open,
 * sorted and non-overlapping BY CONTRACT (`SearchHighlight`'s doc comment) —
 * but this is the last line of defense before they hit the DOM, so each one
 * is clamped to `text`'s bounds and any range that would move the cursor
 * backward (out-of-order or overlapping, however that happened) is skipped
 * rather than trusted.
 */
function renderHighlighted(text: string, ranges: readonly SearchHighlight[]): ReactNode {
  if (ranges.length === 0) return text;
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const [rawStart, rawEnd] of ranges) {
    const start = Math.max(0, Math.min(rawStart, text.length));
    const end = Math.max(start, Math.min(rawEnd, text.length));
    if (start < cursor) continue; // would re-render already-consumed text — untrusted shape, skip it
    if (start > cursor) pieces.push(text.slice(cursor, start));
    if (end > start) {
      pieces.push(
        <mark key={`${start}-${end}`} className="search__mark">
          {text.slice(start, end)}
        </mark>,
      );
    }
    cursor = end;
  }
  if (cursor < text.length) pieces.push(text.slice(cursor));
  return pieces;
}

/**
 * Splices chip-only kind filters into the query text as real prefix tokens
 * (e.g. "z:") before it goes over IPC, so a chip click has the same effect
 * on the result as typing the prefix would — a kind already typed is left
 * alone rather than duplicated. This is the palette's chosen design for
 * keeping typed prefixes and chips in agreement (see the component doc
 * below for the other half: chip *display*).
 */
function buildEffectiveQuery(
  rawQuery: string,
  chipKinds: ReadonlySet<SearchKind>,
  typedKinds: readonly SearchKind[],
): string {
  const typed = new Set(typedKinds);
  const extra = [...chipKinds]
    .filter((kind) => !typed.has(kind))
    .map((kind) => `${KIND_QUERY_PREFIX[kind]}:`);
  return extra.length > 0 ? `${extra.join(" ")} ${rawQuery}` : rawQuery;
}

export function SearchPalette({
  profileId,
  open,
  onClose,
  commands,
  onOpenResult,
  statusMessage,
}: SearchPaletteProps) {
  const [query, setQuery] = useState("");
  // Kind filtering has two sources that must agree (spec requirement): text
  // typed as a "b:"-style prefix (parsed below) and this component-state Set
  // driven by chip clicks. A chip's *displayed* active state is the union of
  // both, so typing "b:" lights up the Beleške chip immediately. A chip
  // *click* only ever toggles this Set — it does not rewrite the query text
  // — which is the one-directional edge case worth naming: clicking a chip
  // that reads active purely because of typed text adds it to the Set
  // (redundant but harmless) rather than stripping the typed prefix, so the
  // chip can look unchanged immediately after such a click. Full two-way sync
  // (chip click <-> editing the text) would need re-parsing and rewriting
  // the input on every click; this was judged not worth the complexity for a
  // filter that is rarely toggled off immediately after being typed.
  const [chipKinds, setChipKinds] = useState<ReadonlySet<SearchKind>>(new Set());
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const requestIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();

  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const activeKinds = useMemo(
    () => new Set([...chipKinds, ...parsed.kinds]),
    [chipKinds, parsed.kinds],
  );
  const isRecent = query.trim().length === 0;
  const matchedCommands = useMemo(
    () => matchCommands(commands, parsed.terms),
    [commands, parsed.terms],
  );

  // Opening resets every bit of the palette's own transient state and
  // remembers what had focus so it can be restored; closing hands focus back
  // rather than leaving it stranded wherever the portal happened to sit.
  useEffect(() => {
    if (open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery("");
      setChipKinds(new Set());
      setActiveIndex(0);
      setResults([]);
      const focusId = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(focusId);
    }
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
    return undefined;
  }, [open]);

  // Debounced fetch with a stale-response guard. The timer itself is the
  // debounce (each keystroke cancels the previous pending timer via the
  // cleanup below); the request id additionally guards the rarer race where
  // two fetches end up in flight together and the OLDER one's IPC round trip
  // simply takes longer — only the fetch whose id still matches the ref when
  // it resolves is allowed to write `results`.
  useEffect(() => {
    if (!open) return;
    if (parsed.commandsOnly) {
      // A leading ">" is entirely local — no IPC call is issued at all. The id
      // is still bumped: typing ">" in front of a query already in flight has
      // to invalidate that request, or it resolves a moment later and repaints
      // entity results into a palette that is supposed to be showing only
      // commands.
      requestIdRef.current += 1;
      setResults([]);
      return;
    }
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const fetched =
            isRecent && chipKinds.size === 0
              ? await window.nexus.searchRecent(profileId, SEARCH_PAGE_SIZE)
              : await window.nexus.searchQuery(
                  profileId,
                  buildEffectiveQuery(query, chipKinds, parsed.kinds),
                  SEARCH_PAGE_SIZE,
                );
          if (requestIdRef.current === requestId) setResults(fetched);
        } catch (error) {
          if (requestIdRef.current === requestId) {
            console.error("Nexus: global search failed:", error);
            setResults([]);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `parsed`/`isRecent` are pure derivations of `query` (already listed) —
    // omitted here since including them would only add churn, never change
    // when the effect actually needs to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, chipKinds, profileId]);

  // The rebuild command reports its count through `statusMessage` instead of
  // closing immediately like every other command (see `activateCommand`
  // below) — this timer is what makes that confirmation readable before the
  // palette dismisses itself.
  useEffect(() => {
    if (!open || statusMessage === null) return;
    const timer = window.setTimeout(() => onClose(), STATUS_MESSAGE_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, statusMessage, onClose]);

  const rows: PaletteRow[] = [
    ...results.map((result) => ({ id: resultRowId(result), kind: "result" as const, result })),
    ...matchedCommands.map((command) => ({
      id: commandRowId(command),
      kind: "command" as const,
      command,
    })),
  ];
  const rowIndexById = new Map(rows.map((row, index) => [row.id, index] as const));

  // Fresh row set -> back to the top, mirroring suggestionMenu.tsx's own rule.
  useEffect(() => {
    setActiveIndex(0);
  }, [results, matchedCommands]);

  // Keeps the keyboard-active row inside the list's own scroll window,
  // copying suggestionMenu.tsx's manual-scrollTop approach and its reasoning
  // (scrollIntoView would also be free to scroll the page behind this
  // portalled panel). The math itself differs from that component's: rows
  // here sit inside per-kind group wrappers rather than as flat siblings of
  // the scroll container, so `offsetTop` alone (relative to the nearest
  // positioned ancestor, not necessarily the container) cannot be trusted —
  // bounding-rect deltas against the container are unaffected by nesting.
  useEffect(() => {
    const container = listRef.current;
    const activeRow = rows[activeIndex];
    if (!container || !activeRow) return;
    const activeEl = document.getElementById(activeRow.id);
    if (!activeEl || !container.contains(activeEl)) return;
    const containerRect = container.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const activeTop = activeRect.top - containerRect.top + container.scrollTop;
    const activeBottom = activeTop + activeRect.height;
    if (activeTop < container.scrollTop) {
      container.scrollTop = activeTop;
    } else if (activeBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = activeBottom - container.clientHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, results, matchedCommands]);

  function toggleChip(kind: SearchKind): void {
    setChipKinds((previous) => {
      const next = new Set(previous);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  /**
   * Closing because the user went somewhere, not because they dismissed the
   * palette: dropping the remembered element turns the restore below into a
   * no-op. Otherwise it would fight the destination — a "Novi zadatak"
   * command focuses the quick-add input, and the restore (which runs last,
   * since the palette is rendered after `<main>`) would immediately yank
   * focus back to whatever the palette was opened from (021-e).
   */
  function leaveFor(action: () => void): void {
    previousFocusRef.current = null;
    action();
    onClose();
  }

  function activateResult(result: SearchResult): void {
    leaveFor(() => onOpenResult(result));
  }

  function activateCommand(command: SearchCommand): void {
    // The rebuild command is the one exception: it stays open until its
    // Serbian confirmation (`statusMessage`) arrives and the effect above
    // closes it. Closing here immediately would race the async IPC round
    // trip and the count would never be shown — and it genuinely goes
    // nowhere, so its close does restore focus like a dismissal.
    if (command.id === REBUILD_COMMAND_ID) {
      command.run();
      return;
    }
    leaveFor(() => command.run());
  }

  function activateRow(row: PaletteRow | undefined): void {
    if (!row) return;
    if (row.kind === "result") activateResult(row.result);
    else activateCommand(row.command);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (rows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateRow(rows[activeIndex]);
    }
  }

  function renderResultRow(result: SearchResult): ReactNode {
    const id = resultRowId(result);
    const isActive = rowIndexById.get(id) === activeIndex;
    return (
      <div
        key={id}
        id={id}
        // Deliberately a plain element, not a `<button>` like
        // suggestionMenu.tsx's rows: this is a combobox/listbox composite
        // (the input carries real focus + aria-activedescendant throughout),
        // where ARIA APG's own pattern keeps options non-focusable. The
        // *visual* selection styling still matches suggestionMenu exactly.
        role="option"
        aria-selected={isActive}
        className={isActive ? "search__row search__row--active" : "search__row"}
        onMouseEnter={() => {
          const index = rowIndexById.get(id);
          if (index !== undefined) setActiveIndex(index);
        }}
        onMouseDown={(event) => {
          // mousedown (not click), mirroring suggestionMenu.tsx, so the
          // input never loses focus to a non-focusable row on the way to it.
          event.preventDefault();
          activateResult(result);
        }}
      >
        <div className="search__row-main">
          <Chip className="search__row-kind">{strings.search.kindSingular[result.kind]}</Chip>
          <div className="search__row-text">
            <div className="search__row-title">
              {renderHighlighted(result.title, result.titleRanges)}
            </div>
            {result.snippet.length > 0 && (
              <div className="search__row-snippet">
                {renderHighlighted(result.snippet, result.snippetRanges)}
              </div>
            )}
          </div>
        </div>
        {result.contextDate !== null && (
          <div className="search__row-date">{formatContextDate(result.contextDate)}</div>
        )}
      </div>
    );
  }

  function renderCommandRow(command: SearchCommand): ReactNode {
    const id = commandRowId(command);
    const isActive = rowIndexById.get(id) === activeIndex;
    return (
      <div
        key={id}
        id={id}
        role="option"
        aria-selected={isActive}
        className={isActive ? "search__row search__row--active" : "search__row"}
        onMouseEnter={() => {
          const index = rowIndexById.get(id);
          if (index !== undefined) setActiveIndex(index);
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          activateCommand(command);
        }}
      >
        <span className="search__row-title">{command.label}</span>
        {command.hint !== undefined && <span className="search__row-hint">{command.hint}</span>}
      </div>
    );
  }

  if (!open) return null;

  const showEmptyState = query.trim().length > 0 && results.length === 0 && matchedCommands.length === 0;
  const activeRowId = rows[activeIndex]?.id;

  return createPortal(
    <div className="search__overlay">
      {/* A separate sibling, never an ancestor, of the panel — CSS opacity on
          a parent would wash out its children too, which is not what "dim
          the backdrop" means. */}
      <div className="search__backdrop" onClick={onClose} />
      <div
        className="search__panel"
        role="dialog"
        aria-modal="true"
        aria-label={strings.search.navLabel}
        // Belt-and-suspenders Escape: the input's own handler covers the
        // common case, but a kind chip is a real, independently focusable
        // <button> a Tab press can land on — Escape must close from there too.
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="search__input-row">
          <input
            ref={inputRef}
            type="text"
            className="nx-textfield__input search__input"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeRowId}
            placeholder={strings.search.placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>

        <div className="search__chips" role="group" aria-label={strings.search.kindFilterLabel}>
          {SEARCH_KINDS.map((kind) => (
            <Button
              key={kind}
              size="sm"
              className={activeKinds.has(kind) ? "search__chip search__chip--active" : "search__chip"}
              aria-pressed={activeKinds.has(kind)}
              onClick={() => toggleChip(kind)}
            >
              {strings.search.kindPlural[kind]}
            </Button>
          ))}
        </div>

        <div className="search__list" role="listbox" id={listboxId} ref={listRef}>
          {isRecent
            ? results.length > 0 && (
                <div className="search__group">
                  <div className="search__group-heading">{strings.search.recentGroup}</div>
                  {results.map((result) => renderResultRow(result))}
                </div>
              )
            : groupByKind(results).map(([kind, list]) => (
                <div className="search__group" key={kind}>
                  <div className="search__group-heading">{strings.search.kindPlural[kind]}</div>
                  {list.map((result) => renderResultRow(result))}
                </div>
              ))}

          {matchedCommands.length > 0 && (
            <div className="search__group">
              <div className="search__group-heading">{strings.search.commandsGroup}</div>
              {matchedCommands.map((command) => renderCommandRow(command))}
            </div>
          )}

          {showEmptyState && <p className="search__empty">{strings.search.emptyResults}</p>}
        </div>

        <div className="search__footer">{statusMessage ?? strings.search.hint}</div>
      </div>
    </div>,
    document.body,
  );
}
