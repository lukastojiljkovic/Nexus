import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { foldSearchTag, parseSearchQuery, SEARCH_KINDS } from "@nexus/core";
import type { SearchKind } from "@nexus/core";
import { Button, Chip } from "@nexus/ui";
import type { NoteTag, SearchHistoryEntry, SearchResult, TaskTag } from "../../shared/ipc.js";
import { REBUILD_COMMAND_ID, matchCommands } from "./searchCommands.js";
import type { SearchCommand } from "./searchCommands.js";
import {
  SEARCH_DEBOUNCE_MS,
  buildEffectiveQuery,
  formatContextDate,
  groupByKind,
  isRecordableQuery,
  renderHighlighted,
} from "./searchShared.js";
import { strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

/**
 * The ADR-021 global search palette (021-d): a Spotlight-style overlay,
 * portalled to `document.body`, opened via the sidebar's Pretraga item or
 * the `palette` chord (Ctrl+K by default, remappable — ADR-040). The
 * index/store/IPC pipeline already exists (021-a/b) — this
 * component is the surface a user actually touches: a typed query plus kind
 * chips against entity results, local command matching against the fixed
 * registry in `searchCommands.ts`, and one shared keyboard model across
 * both. Selection styling mirrors `suggestionMenu.tsx` exactly (gold text +
 * weight over a soft surface, no glow, no inset bar); the DOM shape does
 * not, deliberately — see the row-role comment below.
 *
 * Over an EMPTY box it shows two lists, never one (SRCH-009): „Nedavne
 * pretrage" — the queries this profile typed, remembered by `rememberQuery`
 * below — above „Nedavno", the entities it opened. They answer different
 * questions and are deliberately not merged; picking a query FILLS the input
 * rather than running anything, so nothing ever executes out of sight.
 */

const SEARCH_PAGE_SIZE = 30;
/** How long the rebuild command's confirmation stays on screen before the palette auto-closes (spec: "reports its count first ... then close"). */
const STATUS_MESSAGE_DISPLAY_MS = 1400;
/** Tag suggestions offered while a `#` token is being typed — a short list to pick from, not a tag browser. */
const TAG_SUGGESTION_LIMIT = 6;
/**
 * How many remembered queries the OVERLAY offers (SRCH-009). The store keeps
 * twenty; an overlay that showed all of them would push the recent entities —
 * which this list is beside, never instead of — off the first screen. Five is
 * the handful a user actually re-runs; the full twenty live on the search
 * page, which has the room for them.
 */
const HISTORY_ROW_LIMIT = 5;

const collator = new Intl.Collator(["sr-Latn", "sr"]);

/** The active `#` token, only while the caret is still inside it: `[1]` is the whitespace it rides on, `[2]` what has been typed after the `#`. */
const ACTIVE_TAG_TOKEN_RE = /(^|\s)#(\S*)$/;

/** One offerable tag: its own name for display, its token form for matching and completion. */
interface TagOption {
  readonly name: string;
  readonly key: string;
}

/** One shared empty list, so "no `#` token is being typed" keeps a stable identity across keystrokes instead of resetting the effects that depend on the suggestion set. */
const NO_TAG_SUGGESTIONS: readonly TagOption[] = [];

/** The same trick for the history rows: "the box is not empty" must keep one identity across keystrokes. */
const NO_HISTORY: readonly SearchHistoryEntry[] = [];

/**
 * Both modules' tags as one list — a `#` token filters tasks and notes alike,
 * so the palette must not present them as two separate vocabularies. Deduped
 * by token form (the same label carried by a task and by a note is one tag to
 * type), keeping the first spelling seen, and sorted for Serbian.
 */
function mergeTagOptions(noteTags: readonly NoteTag[], taskTags: readonly TaskTag[]): TagOption[] {
  const byKey = new Map<string, TagOption>();
  for (const tag of [...noteTags, ...taskTags]) {
    const key = foldSearchTag(tag.name);
    if (key.length === 0 || byKey.has(key)) continue;
    byKey.set(key, { name: tag.name, key });
  }
  return [...byKey.values()].sort((a, b) => collator.compare(a.name, b.name));
}

/** The "Prikaži sve rezultate" row's id — a fixed string, since there is exactly one and it carries no entity. */
const SHOW_ALL_ROW_ID = "search-row-show-all";

export interface SearchPaletteProps {
  profileId: string;
  open: boolean;
  onClose: () => void;
  commands: readonly SearchCommand[];
  /** Activates a result — the shell decides where that lands. */
  onOpenResult: (result: SearchResult) => void;
  /**
   * Hands the current query to the full search page (ADR-039 §5) and closes
   * the palette. The shell owns the seed and the navigation; the palette only
   * says which query the user was looking at.
   */
  onOpenPage: (query: string) => void;
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
  | { readonly id: string; readonly kind: "history"; readonly entry: SearchHistoryEntry }
  | { readonly id: string; readonly kind: "tag"; readonly tag: TagOption }
  | { readonly id: string; readonly kind: "result"; readonly result: SearchResult }
  | { readonly id: string; readonly kind: "command"; readonly command: SearchCommand }
  | { readonly id: string; readonly kind: "show-all" };

function resultRowId(result: SearchResult): string {
  return `search-row-result-${result.kind}-${result.entityId}`;
}
function commandRowId(command: SearchCommand): string {
  return `search-row-command-${command.id}`;
}
function tagRowId(tag: TagOption): string {
  return `search-row-tag-${tag.key}`;
}
/** Percent-encoded, since a remembered query is free text and a DOM id may not carry spaces. */
function historyRowId(entry: SearchHistoryEntry): string {
  return `search-row-history-${encodeURIComponent(entry.query)}`;
}

export function SearchPalette({
  profileId,
  open,
  onClose,
  commands,
  onOpenResult,
  onOpenPage,
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
  // True when the debounced fetch below (either `searchRecent` or
  // `searchQuery`) rejected. A failure is not an empty result, and it must
  // not read as one — see `showSearchError`.
  const [searchFailed, setSearchFailed] = useState(false);
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  /** The profile's remembered QUERIES (SRCH-009) — a different list from `results`, which holds the entities it touched. */
  const [history, setHistory] = useState<readonly SearchHistoryEntry[]>([]);
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

  // The `#` token the caret is still inside, if any — `start` is where its `#`
  // sits, so picking a suggestion can replace exactly that token and nothing
  // else. Command mode is excluded: a ">" query lists commands, and offering
  // to complete a tag there would complete into a query that filters nothing.
  const activeTag = useMemo(() => {
    if (parsed.commandsOnly) return null;
    const match = ACTIVE_TAG_TOKEN_RE.exec(query);
    if (!match) return null;
    const lead = match[1] ?? "";
    return { start: match.index + lead.length, prefix: foldSearchTag(match[2] ?? "") };
  }, [query, parsed.commandsOnly]);

  const tagSuggestions = useMemo((): readonly TagOption[] => {
    if (activeTag === null) return NO_TAG_SUGGESTIONS;
    return tagOptions
      .filter((tag) => tag.key.startsWith(activeTag.prefix))
      .slice(0, TAG_SUGGESTION_LIMIT);
  }, [activeTag, tagOptions]);

  /**
   * Remembered queries are offered only over the EMPTY box — the one moment
   * they are an answer to the question on screen. The instant a character is
   * typed, that character is a better filter than a list of what was typed
   * before it, and command mode (">") is about commands, not searches.
   */
  const historyRows = useMemo(
    (): readonly SearchHistoryEntry[] =>
      isRecent && !parsed.commandsOnly ? history.slice(0, HISTORY_ROW_LIMIT) : NO_HISTORY,
    [isRecent, parsed.commandsOnly, history],
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
      setSearchFailed(false);
      const focusId = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(focusId);
    }
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
    return undefined;
  }, [open]);

  // Tab/Shift+Tab cycle within the panel (input, then the kind chips) rather
  // than walking out into the page behind it. Declared AFTER the effect
  // above on purpose — effects run in call order, and this one moves focus
  // onto the input synchronously; declared first, it would steal focus
  // before that effect's own `document.activeElement` read captured the
  // element the palette actually opened from. Initial focus and focus-return
  // otherwise stay that effect's job — the input is deliberately focused
  // again after a `setTimeout(0)`, clear of whatever the opening keystroke's
  // own handlers are still doing, and `leaveFor` suppresses the return when
  // the palette closed because the user navigated somewhere, a policy the
  // generic trap has no way to express.
  const panelRef = useFocusTrap<HTMLDivElement>({ open, restoreFocus: false });

  // The profile's tag vocabulary and its remembered queries, loaded once per
  // opening through the existing list bridges — the `#` suggestions and the
  // history group are the only things that need them, and a palette session is
  // short enough that re-fetching per keystroke would be three IPC round trips
  // for lists that cannot change while they are on screen. The two exceptions
  // are this component's own writes (recording a query, forgetting one), which
  // hand back the fresh list rather than triggering a reload.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [noteTags, taskTags, entries] = await Promise.all([
          window.nexus.listNoteTags(profileId),
          window.nexus.listTaskTags(profileId),
          window.nexus.searchHistory(profileId),
        ]);
        if (cancelled) return;
        setTagOptions(mergeTagOptions(noteTags, taskTags));
        setHistory(entries);
      } catch (error) {
        console.error("Nexus: loading the palette's tag suggestions and history failed:", error);
        if (!cancelled) {
          setTagOptions([]);
          setHistory([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, profileId]);

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
      setSearchFailed(false);
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
          if (requestIdRef.current === requestId) {
            setResults(fetched);
            setSearchFailed(false);
          }
        } catch (error) {
          if (requestIdRef.current === requestId) {
            console.error("Nexus: global search failed:", error);
            setResults([]);
            setSearchFailed(true);
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

  // The full-page escape hatch (ADR-039 §5) is offered only where it means
  // something: command mode is palette-only, and with no text AND no chips
  // there is nothing to carry over — browse mode is what the sidebar's
  // Pretraga item already opens.
  const showAllRow = !parsed.commandsOnly && (query.trim().length > 0 || chipKinds.size > 0);

  // Tag suggestions come first: while a `#` token is being typed, completing
  // it is the likelier intent than opening whatever the half-typed token
  // currently matches. Remembered queries sit in that same leading position —
  // the two can never both be present (one needs a `#` token typed, the other
  // an empty box) — and for the same reason: over an EMPTY box, "run that
  // search again" is the likelier intent, and the row only fills the input, so
  // Enter on it is visible and reversible rather than a navigation nobody
  // asked for.
  const rows: PaletteRow[] = [
    ...historyRows.map((entry) => ({
      id: historyRowId(entry),
      kind: "history" as const,
      entry,
    })),
    ...tagSuggestions.map((tag) => ({ id: tagRowId(tag), kind: "tag" as const, tag })),
    ...results.map((result) => ({ id: resultRowId(result), kind: "result" as const, result })),
    ...matchedCommands.map((command) => ({
      id: commandRowId(command),
      kind: "command" as const,
      command,
    })),
    // Pinned last so ArrowDown reaches it after everything it is an
    // alternative to, and Enter on it is never what a fast typist gets by
    // accident.
    ...(showAllRow ? [{ id: SHOW_ALL_ROW_ID, kind: "show-all" as const }] : []),
  ];
  const rowIndexById = new Map(rows.map((row, index) => [row.id, index] as const));

  // Fresh row set -> back to the top, mirroring suggestionMenu.tsx's own rule.
  useEffect(() => {
    setActiveIndex(0);
  }, [results, matchedCommands, tagSuggestions, historyRows]);

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
  }, [activeIndex, results, matchedCommands, tagSuggestions, historyRows]);

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

  /**
   * SRCH-009: remembers a query the user COMMITTED to. Both moments that count
   * as a commitment are below — `activateResult` and `activateShowAll` — and
   * `isRecordableQuery` carries the rest of the rule with its reasoning.
   *
   * The EFFECTIVE query is what is stored (chips spliced in as the tokens a
   * user could have typed), because that is the string the search ran with —
   * picking the row back out of the history has to reproduce the same search,
   * filters included. Everything else is verbatim, operators included.
   *
   * Failing to remember a query is never worth a message: the search itself
   * succeeded, and the user is already on their way somewhere.
   */
  function rememberQuery(text: string): void {
    if (!isRecordableQuery(text)) return;
    void window.nexus
      .recordSearchHistory(profileId, text)
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

  function activateResult(result: SearchResult): void {
    rememberQuery(buildEffectiveQuery(query, chipKinds, parsed.kinds));
    leaveFor(() => onOpenResult(result));
  }

  /**
   * Puts a remembered query back in the box — deliberately NOT a navigation
   * and NOT an immediate search: the palette stays open, the caret returns to
   * the input, and the user sees the query that is about to run before it
   * runs. A history row that silently executed something the user cannot read
   * would be the one thing a privacy surface must never do.
   *
   * The chip Set is cleared with it: the remembered query already carries
   * whatever kind filters were active as their typed tokens (that is what
   * `rememberQuery` stores), so leaving chips on would layer a second,
   * invisible filter over one the input is showing in full.
   */
  function replayQuery(entry: SearchHistoryEntry): void {
    setQuery(entry.query);
    setChipKinds(new Set());
    inputRef.current?.focus();
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

  /**
   * Completes the `#` token being typed with the picked tag's token form —
   * folded and space-stripped, so what lands in the input is exactly what the
   * filter matches on. Deliberately NOT a navigation: the palette stays open,
   * the caret stays in the input (rows activate on mousedown with
   * `preventDefault`, so focus never left), and the trailing space ends the
   * token so the next keystroke starts a new one.
   */
  function completeTag(tag: TagOption): void {
    if (activeTag === null) return;
    setQuery(`${query.slice(0, activeTag.start)}#${tag.key} `);
    inputRef.current?.focus();
  }

  /** The page must mean exactly what the palette currently shows, so chip filters ride along as their typed tokens rather than being dropped. */
  function activateShowAll(): void {
    const effective = buildEffectiveQuery(query, chipKinds, parsed.kinds);
    // Carrying a query to the full page is the other thing that counts as
    // using it (see `rememberQuery`): the user asked for this exact search to
    // continue somewhere else, which no half-typed prefix ever is.
    rememberQuery(effective);
    leaveFor(() => onOpenPage(effective));
  }

  function activateRow(row: PaletteRow | undefined): void {
    if (!row) return;
    if (row.kind === "history") replayQuery(row.entry);
    else if (row.kind === "tag") completeTag(row.tag);
    else if (row.kind === "result") activateResult(row.result);
    else if (row.kind === "command") activateCommand(row.command);
    else activateShowAll();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (rows.length === 0) return;
    const activeRow = rows[activeIndex];
    // Forgetting the active remembered query, the keyboard half of its „×"
    // (SRCH-009). Guarded on a genuinely EMPTY box rather than on `isRecent`:
    // Delete is forward-delete in a text field, and a box holding only spaces
    // still has something for it to delete.
    if (event.key === "Delete" && query.length === 0 && activeRow?.kind === "history") {
      event.preventDefault();
      forgetQuery(activeRow.entry.query);
      return;
    }
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
            {/* The match was inside an attached file, not in anything above
                (SRCH-008). Said out loud rather than left to look like a row
                that matched nothing. */}
            {result.fromAttachment && (
              <div className="search__row-source">{strings.search.fromAttachment}</div>
            )}
          </div>
        </div>
        {result.contextDate !== null && (
          <div className="search__row-date">{formatContextDate(result.contextDate)}</div>
        )}
      </div>
    );
  }

  /**
   * One remembered query (SRCH-009). The row's accessible name is set
   * explicitly to the query alone: the „×" inside it is real interactive
   * content, and without this the option would announce itself as the query
   * plus that button's label. The button is `tabIndex={-1}` because this is a
   * combobox composite where the input holds focus throughout — Delete on the
   * active row is its keyboard equivalent (see `handleInputKeyDown`).
   */
  function renderHistoryRow(entry: SearchHistoryEntry): ReactNode {
    const id = historyRowId(entry);
    const isActive = rowIndexById.get(id) === activeIndex;
    return (
      <div
        key={id}
        id={id}
        role="option"
        aria-selected={isActive}
        aria-label={entry.query}
        className={isActive ? "search__row search__row--active" : "search__row"}
        onMouseEnter={() => {
          const index = rowIndexById.get(id);
          if (index !== undefined) setActiveIndex(index);
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          replayQuery(entry);
        }}
      >
        <span className="search__row-title">{entry.query}</span>
        <button
          type="button"
          tabIndex={-1}
          className="search__row-remove"
          aria-label={strings.search.historyRemove}
          title={strings.search.historyRemove}
          onMouseDown={(event) => {
            // Stops the row's own mousedown from also replaying the query the
            // user is in the middle of deleting.
            event.preventDefault();
            event.stopPropagation();
            forgetQuery(entry.query);
          }}
        >
          ×
        </button>
      </div>
    );
  }

  /**
   * The row shows the tag's own name and, as the hint, the token it completes
   * into — which is the honest thing to show when the two differ („moj posao“
   * → `#mojposao`) and quietly teaches the syntax when they do not.
   */
  function renderTagRow(tag: TagOption): ReactNode {
    const id = tagRowId(tag);
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
          completeTag(tag);
        }}
      >
        <span className="search__row-title">{tag.name}</span>
        <span className="search__row-hint">#{tag.key}</span>
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

  // A failed fetch is reported instead of the empty state — an empty result
  // is a real answer ("nothing matches"); a rejected IPC call is not one.
  const showSearchError = searchFailed && !parsed.commandsOnly;
  const showEmptyState =
    !showSearchError &&
    query.trim().length > 0 &&
    results.length === 0 &&
    matchedCommands.length === 0 &&
    tagSuggestions.length === 0;
  const activeRowId = rows[activeIndex]?.id;

  return createPortal(
    <div className="search__overlay">
      {/* A separate sibling, never an ancestor, of the panel — CSS opacity on
          a parent would wash out its children too, which is not what "dim
          the backdrop" means. */}
      <div className="search__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
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
          {/* Its own group above „Nedavno", never merged into it: one list is
              what you looked FOR, the other what you opened, and a single
              heading over both would say neither. */}
          {historyRows.length > 0 && (
            <div className="search__group">
              <div className="search__group-heading">{strings.search.historyGroup}</div>
              {historyRows.map((entry) => renderHistoryRow(entry))}
            </div>
          )}

          {tagSuggestions.length > 0 && (
            <div className="search__group">
              {/* The NOTE module's own label, reused rather than reworded: this
                  one group merges both modules' tags, and the same word must
                  not appear in two spellings across the app. */}
              <div className="search__group-heading">{strings.notes.tagsLabel}</div>
              {tagSuggestions.map((tag) => renderTagRow(tag))}
            </div>
          )}

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

          {showSearchError && (
            <p className="search__error" role="alert">
              {strings.search.searchError}
            </p>
          )}

          {showEmptyState && <p className="search__empty">{strings.search.emptyResults}</p>}

          {showAllRow && (
            <div
              id={SHOW_ALL_ROW_ID}
              role="option"
              aria-selected={rowIndexById.get(SHOW_ALL_ROW_ID) === activeIndex}
              className={
                rowIndexById.get(SHOW_ALL_ROW_ID) === activeIndex
                  ? "search__row search__row--all search__row--active"
                  : "search__row search__row--all"
              }
              onMouseEnter={() => {
                const index = rowIndexById.get(SHOW_ALL_ROW_ID);
                if (index !== undefined) setActiveIndex(index);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                activateShowAll();
              }}
            >
              <span className="search__row-title">{strings.search.showAllResults}</span>
            </div>
          )}
        </div>

        {/* A command's confirmation replaces the whole footer rather than
            crowding in beside the hints — while it is up, it is the only thing
            worth reading there. */}
        <div className="search__footer">
          {statusMessage ?? (
            <>
              {/* The keys change meaning on a history row — Enter fills the box
                  instead of opening something, and Delete forgets the row — so
                  the hint changes with them rather than printing a lie. */}
              <span>
                {rows[activeIndex]?.kind === "history"
                  ? strings.search.historyHint
                  : strings.search.hint}
              </span>
              <span className="search__footer-operators">{strings.search.operatorHint}</span>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
