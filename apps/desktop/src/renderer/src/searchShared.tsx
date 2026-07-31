import { SEARCH_KIND_PREFIXES, SEARCH_KINDS, foldSearchTag, foldSearchText } from "@nexus/core";
import type { SearchKind } from "@nexus/core";
import type { ReactNode } from "react";
import type { SearchHighlight, SearchResult } from "../../shared/ipc.js";
import { formatExamDate } from "./examDates.js";
import { formatNotificationWhen } from "./notificationFormat.js";

/**
 * The pieces the ADR-021 palette and the ADR-039 search page both need, lifted
 * here so the two surfaces cannot drift: identical queries must mean identical
 * things on both, which is only true if they share the grammar helpers, the
 * grouping and the highlight renderer rather than each keeping a copy.
 *
 * Nothing here holds state or touches IPC — it is query-string arithmetic and
 * presentation, so both a modal overlay and a full page can use it unchanged.
 */

/** How long after the last keystroke either surface issues its query. */
export const SEARCH_DEBOUNCE_MS = 120;

/**
 * For each kind, the shortest alias in `SEARCH_KIND_PREFIXES` — computed once
 * so a chip click can splice a real prefix token ("z:") into the query text
 * without hand-duplicating core's own alias table (and risking it drifting
 * from this one).
 */
export const KIND_QUERY_PREFIX: Record<SearchKind, string> = (() => {
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

/**
 * Splices chip-only kind filters into the query text as real prefix tokens
 * (e.g. "z:") before it goes over IPC, so a chip click has the same effect on
 * the result as typing the prefix would — a kind already typed is left alone
 * rather than duplicated. This is the PALETTE's mechanism, where chips are a
 * separate Set layered over the text; the page instead rewrites the text
 * itself (`toggleKindInQuery`), which is why that one is a different
 * function rather than this one reused.
 */
export function buildEffectiveQuery(
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

/**
 * Reads a raw query word as a kind-prefix token. The word is split at its
 * FIRST colon and only the head is folded: folding is a per-character map
 * that neither introduces nor removes a colon, so the raw head and the folded
 * head are the same token — which lets `rest` be returned in its original
 * spelling instead of the lossy folded one.
 */
function readKindWord(word: string): { kind: SearchKind; rest: string } | null {
  const colon = word.indexOf(":");
  if (colon === -1) return null;
  const key = foldSearchText(word.slice(0, colon));
  // `Object.hasOwn` rather than a bare lookup, for the same reason core's own
  // parser uses it: the key is whatever the user typed, and a plain object
  // literal answers "constructor:" with something truthy off the prototype.
  if (!Object.hasOwn(SEARCH_KIND_PREFIXES, key)) return null;
  const kind = SEARCH_KIND_PREFIXES[key];
  return kind === undefined ? null : { kind, rest: word.slice(colon + 1) };
}

function words(query: string): string[] {
  return query.split(/\s+/).filter((word) => word.length > 0);
}

/**
 * Adds or removes `kind`'s prefix token in the query text — the search page's
 * "one source of truth is the query string" rule (ADR-039 §2): a chip edits
 * what is typed, so typing and clicking compose instead of fighting.
 *
 * Removing strips EVERY alias of that kind, not just the canonical one (a
 * user who typed "zadatak:" must be able to switch it off with the chip), and
 * keeps any words riding on the token — "z:ispit" toggles down to "ispit"
 * rather than deleting the search text along with the filter.
 */
export function toggleKindInQuery(query: string, kind: SearchKind): string {
  const all = words(query);
  const kept: string[] = [];
  let found = false;
  for (const word of all) {
    const read = readKindWord(word);
    if (read && read.kind === kind) {
      found = true;
      if (read.rest.length > 0) kept.push(read.rest);
      continue;
    }
    kept.push(word);
  }
  if (found) return kept.join(" ");
  return [`${KIND_QUERY_PREFIX[kind]}:`, ...all].join(" ");
}

/**
 * Whether a query is one the history may remember (SRCH-009). The two surfaces
 * share it for the reason everything else in this file is shared: what counts
 * as a recordable query must mean the same thing on both, or the palette and
 * the page would build two different histories of the same person's searching.
 *
 * WHEN a query is offered to this function is the load-bearing half of the
 * rule, and it lives at the call sites because only they know it: a query is
 * offered when the user COMMITTED to it — opened a result it found, or carried
 * it to the full page — never when it merely ran. Both surfaces query on a
 * debounce, so "it returned something" would record „b", „be", „bel", „bele"
 * beside the word actually meant, and a history full of prefixes is worse than
 * no history at all.
 *
 * What is left for this function is the one refusal that holds regardless of
 * how it was reached: an empty or whitespace-only query is what an UNUSED
 * search box contains. The store refuses it too (that is the real gate,
 * SEC-EL-02); this keeps the renderer from making a round trip it knows will
 * be refused — which is exactly what a palette in browse mode would do on
 * every single result it opens.
 */
export function isRecordableQuery(query: string): boolean {
  return query.trim().length > 0;
}

/** Adds or removes a `#token` in the query text — the tag-facet half of the same rule. */
export function toggleTagInQuery(query: string, token: string): string {
  const all = words(query);
  const kept = all.filter(
    (word) => !(word.startsWith("#") && foldSearchTag(word.slice(1)) === token),
  );
  return kept.length === all.length ? [...all, `#${token}`].join(" ") : kept.join(" ");
}

/** Groups results by kind, in `SEARCH_KINDS` order, dropping empty groups. */
export function groupByKind(
  results: readonly SearchResult[],
): Array<[SearchKind, SearchResult[]]> {
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
 * ISO instant (event/card) — the two shapes it ever carries, per kind, in the
 * search index (migration 017). No single existing formatter handles both, so
 * this picks the right one of the two that already exist rather than adding a
 * third: `formatExamDate` (bare dates, day+month+year) or
 * `formatNotificationWhen` (instants, "HH:MM today, else day + HH:MM").
 */
export function formatContextDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatExamDate(value) : formatNotificationWhen(value);
}

/**
 * Renders `text` with `ranges` wrapped in `<mark>`. Ranges are half-open,
 * sorted and non-overlapping BY CONTRACT (`SearchHighlight`'s doc comment) —
 * but this is the last line of defense before they hit the DOM, so each one is
 * clamped to `text`'s bounds and any range that would move the cursor backward
 * (out-of-order or overlapping, however that happened) is skipped rather than
 * trusted.
 */
export function renderHighlighted(text: string, ranges: readonly SearchHighlight[]): ReactNode {
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
