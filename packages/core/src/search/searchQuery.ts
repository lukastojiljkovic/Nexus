import { isValidDayKey } from "../calendar/calendarGrid.js";
import { foldSearchText } from "./searchText.js";

/**
 * Parsing and FTS5 match-expression building for global search (ADR-021).
 * The palette itself lands in a later slice; this module only turns
 * whatever the user typed into a structured query the store can run.
 *
 * Beyond the `kind:` prefixes this file started with, the grammar carries two
 * operators: `#oznaka` tag filters and `rok:`/`due:` date filters. Both are
 * parsed here into STRUCTURE only — resolving a preset like `rok:danas` to an
 * actual date, or a tag name to the entities carrying it, needs a clock and a
 * database, neither of which this package is allowed to touch
 * (`searchOperators.ts` does the first from a passed-in "today"; the main
 * process does the second).
 */

export type SearchKind =
  | "task"
  | "event"
  | "note"
  | "document"
  | "subject"
  | "exam"
  | "deck"
  | "card"
  | "attachment";

/** Every indexed kind, in the order the palette groups them. */
export const SEARCH_KINDS: readonly SearchKind[] = [
  "task",
  "event",
  "note",
  "document",
  "subject",
  "exam",
  "deck",
  "card",
  "attachment",
];

/**
 * Folded prefix (without the colon) → the kind it filters to. Keys are
 * already folded so a diacritic spelling ("beleška:") still resolves — the
 * raw query is folded before this table is consulted, never the reverse.
 */
export const SEARCH_KIND_PREFIXES: Readonly<Record<string, SearchKind>> = {
  z: "task",
  zad: "task",
  zadatak: "task",
  zadaci: "task",
  d: "event",
  dog: "event",
  dogadjaj: "event",
  dogadjaji: "event",
  b: "note",
  bel: "note",
  beleska: "note",
  beleske: "note",
  dok: "document",
  dokument: "document",
  dokumenti: "document",
  p: "subject",
  pred: "subject",
  predmet: "subject",
  predmeti: "subject",
  i: "exam",
  ispit: "exam",
  ispiti: "exam",
  s: "deck",
  spil: "deck",
  spilovi: "deck",
  k: "card",
  kart: "card",
  kartica: "card",
  kartice: "card",
  pr: "attachment",
  prilog: "attachment",
  prilozi: "attachment",
};

/** A pasted paragraph must not become a 500-clause query. */
export const MAX_SEARCH_TERMS = 8;
/** Per-term cap, applied after dedup — long enough for any real word, short enough to bound FTS cost. */
export const MAX_TERM_LENGTH = 64;

/** The three relative windows `rok:`/`due:` accepts, resolved against a real "today" by `resolveDueRange`. */
export type SearchDuePreset = "today" | "tomorrow" | "week";

/**
 * A `rok:`/`due:` filter as PARSED — either one of the closed presets or an
 * explicit, already-validated bare `YYYY-MM-DD`. Deliberately not a date range:
 * turning `today` into a date needs a clock, and this package never has one.
 */
export type SearchDueFilter =
  | { readonly kind: "preset"; readonly preset: SearchDuePreset }
  | { readonly kind: "date"; readonly date: string };

/**
 * Folded prefixes (without the colon) that introduce a date filter: the
 * Serbian `rok:` and the English `due:`. A `Set`, not an object literal, for
 * `SEARCH_KIND_PREFIXES`' own reason one level up — a bare lookup on an object
 * answers `constructor:`/`__proto__:` off the prototype.
 */
const DUE_PREFIXES: ReadonlySet<string> = new Set(["rok", "due"]);

/**
 * The CLOSED value set, folded, sr + en. Anything outside it — including a
 * date that is well-formed but not a real day — is NOT a date filter and falls
 * back to plain search text, exactly as an unknown `kind:` prefix does. The
 * house rule is to never guess: a query that meant something else must not be
 * silently reinterpreted as a date.
 */
const DUE_PRESETS: ReadonlyMap<string, SearchDuePreset> = new Map<string, SearchDuePreset>([
  ["danas", "today"],
  ["today", "today"],
  ["sutra", "tomorrow"],
  ["tomorrow", "tomorrow"],
  ["nedelja", "week"],
  ["week", "week"],
]);

export interface ParsedSearchQuery {
  /** Kind filters found in the query; empty means "every kind". Deduped, in `SEARCH_KINDS` order. */
  readonly kinds: readonly SearchKind[];
  /** Folded search terms, deduped, in the order typed. Never empty strings. */
  readonly terms: readonly string[];
  /**
   * `#oznaka` tag filters, folded, deduped, in the order typed; empty means no
   * tag filtering. Several tokens AND together. These never reach `terms` and
   * never count toward `MAX_SEARCH_TERMS` — a tag filter narrows the result
   * set, it is not something to look for in the text.
   */
  readonly tags: readonly string[];
  /** The `rok:`/`due:` filter, or null. Several date filters may be typed; the LAST one wins. */
  readonly due: SearchDueFilter | null;
  /** True when the raw query began with `>` — the palette then shows commands only. */
  readonly commandsOnly: boolean;
  /** `terms` joined by a single space — what command matching and the title-prefix boost compare against. */
  readonly text: string;
  /** False when the raw query ended in whitespace: the user finished the word, so the last term is not a prefix. */
  readonly prefixLast: boolean;
}

// Mirrors unicode61's own tokenization so a term extracted here matches
// exactly what the FTS index tokenized from the same text — "e-mail" must
// become "e" and "mail" on both sides, not "e-mail" as one run.
const TERM_RE = /[\p{L}\p{N}]+/gu;
const PREFIX_TOKEN_RE = /^([^:]+):(.*)$/;
const TAG_TOKEN_PREFIX = "#";

/** A `rok:`/`due:` value as a filter, or null when the value is not one this closed grammar knows. */
function parseDueValue(value: string): SearchDueFilter | null {
  const preset = DUE_PRESETS.get(value);
  if (preset !== undefined) return { kind: "preset", preset };
  // Reality, not just shape: `isValidDayKey` rejects month 13 and 29 February
  // in a non-leap year, so those stay ordinary search text.
  if (isValidDayKey(value)) return { kind: "date", date: value };
  return null;
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const leadingStripped = raw.replace(/^\s+/, "");
  const commandsOnly = leadingStripped.startsWith(">");
  const remainder = commandsOnly ? leadingStripped.slice(1) : leadingStripped;

  const foldedRemainder = foldSearchText(remainder);
  const tokens = foldedRemainder.split(/\s+/).filter((token) => token.length > 0);

  const kindsSeen = new Set<SearchKind>();
  const textParts: string[] = [];
  const tagsSeen = new Set<string>();
  const tags: string[] = [];
  let due: SearchDueFilter | null = null;

  for (const token of tokens) {
    // Tag tokens are checked before the `prefix:` form so a tag whose name
    // happens to contain a colon is still read as a tag.
    if (token.startsWith(TAG_TOKEN_PREFIX)) {
      const name = token.slice(TAG_TOKEN_PREFIX.length);
      // A bare "#" is what every tag looks like mid-typing; it filters nothing
      // and must not become a term either (it has no word characters anyway).
      if (name.length > 0 && !tagsSeen.has(name)) {
        tagsSeen.add(name);
        tags.push(name);
      }
      continue;
    }

    const match = PREFIX_TOKEN_RE.exec(token);
    const key = match?.[1];

    if (match && key !== undefined && DUE_PREFIXES.has(key)) {
      const parsedDue = parseDueValue(match[2] ?? "");
      // Last one wins: a second date filter is the user correcting the first,
      // not an impossible "due on both days" intersection.
      if (parsedDue) due = parsedDue;
      // An unresolvable value leaves the WHOLE token as search text, matching
      // how an unknown `kind:` prefix behaves below.
      else textParts.push(token);
      continue;
    }

    // `Object.hasOwn` rather than a bare lookup: the key is whatever the user
    // typed, and a plain object literal answers `constructor:` or `__proto__:`
    // with something truthy off the prototype — which would swallow the token
    // as a kind filter instead of searching for it.
    const kind =
      key !== undefined && Object.hasOwn(SEARCH_KIND_PREFIXES, key)
        ? SEARCH_KIND_PREFIXES[key]
        : undefined;
    if (match && kind) {
      kindsSeen.add(kind);
      const rest = match[2];
      if (rest) textParts.push(rest);
    } else {
      textParts.push(token);
    }
  }

  const rawTerms = textParts.join(" ").match(TERM_RE) ?? [];
  const seenTerms = new Set<string>();
  const dedupedTerms: string[] = [];
  for (const term of rawTerms) {
    if (seenTerms.has(term)) continue;
    seenTerms.add(term);
    dedupedTerms.push(term);
  }
  const terms = dedupedTerms.slice(0, MAX_SEARCH_TERMS).map((term) => term.slice(0, MAX_TERM_LENGTH));

  // A trailing space means the user finished typing the last word — it is no
  // longer a live prefix. An empty query has no "last term" to speak of, so
  // it defaults to true rather than reading the trailing-whitespace check.
  const prefixLast = !(/\s$/.test(remainder) && terms.length > 0);

  return {
    kinds: SEARCH_KINDS.filter((kind) => kindsSeen.has(kind)),
    terms,
    tags,
    due,
    commandsOnly,
    text: terms.join(" "),
    prefixLast,
  };
}

export function toFtsMatchExpression(
  terms: readonly string[],
  options?: { readonly prefixLast?: boolean },
): string | null {
  // Terms from the parser can never contain a quote, but this function is
  // exported and must stay safe against any input: a bare AND/NOT/NEAR or a
  // stray `*` would silently change what an FTS5 MATCH expression means.
  const usable = terms.map((term) => term.replace(/"/g, "")).filter((term) => term.length > 0);
  if (usable.length === 0) return null;

  const prefixLast = options?.prefixLast ?? true;
  return usable
    .map((term, index) => {
      const quoted = `"${term}"`;
      return prefixLast && index === usable.length - 1 ? `${quoted}*` : quoted;
    })
    .join(" ");
}
