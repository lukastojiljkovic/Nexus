import { foldSearchText } from "./searchText.js";

/**
 * Parsing and FTS5 match-expression building for global search (ADR-021).
 * The palette itself lands in a later slice; this module only turns
 * whatever the user typed into a structured query the store can run.
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

export interface ParsedSearchQuery {
  /** Kind filters found in the query; empty means "every kind". Deduped, in `SEARCH_KINDS` order. */
  readonly kinds: readonly SearchKind[];
  /** Folded search terms, deduped, in the order typed. Never empty strings. */
  readonly terms: readonly string[];
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

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const leadingStripped = raw.replace(/^\s+/, "");
  const commandsOnly = leadingStripped.startsWith(">");
  const remainder = commandsOnly ? leadingStripped.slice(1) : leadingStripped;

  const foldedRemainder = foldSearchText(remainder);
  const tokens = foldedRemainder.split(/\s+/).filter((token) => token.length > 0);

  const kindsSeen = new Set<SearchKind>();
  const textParts: string[] = [];

  for (const token of tokens) {
    const match = PREFIX_TOKEN_RE.exec(token);
    const key = match?.[1];
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
