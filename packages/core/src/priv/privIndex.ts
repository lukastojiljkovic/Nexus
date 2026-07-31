import { foldSearchText } from "../search/searchText.js";

/**
 * The private-notes search index (ADR-057 / SEC-ZK-05): private notes have no
 * FTS row — nothing about them may exist in the database in queryable form —
 * so search inside the unlocked section runs over THIS, an in-memory index the
 * caller builds from decrypted envelopes at unlock and discards at lock. It is
 * plain data: building it persists nothing, and dropping the reference is the
 * whole teardown.
 *
 * Matching folds through `foldSearchText` — the ONE folding grammar the FTS
 * machinery already indexes and queries through (ADR-021), so "Đorđe",
 * "djordje" and "Ђорђе" land identically here exactly as they do in public
 * search; a second grammar would let the two sections disagree about what
 * matches. Substring containment over the folded text is deliberately the
 * whole algorithm — a private section holds tens of notes, not thousands, and
 * an FTS reimplementation would buy ranking nuance at the price of a second
 * search engine to keep honest.
 */

/** What the caller extracts from each decrypted envelope: the id plus the two searchable text fields. */
export interface PrivIndexNote {
  id: string;
  title: string;
  plaintext: string;
}

/** One note, folded once at build time so every query is a plain substring scan. */
export interface PrivIndexEntry {
  readonly id: string;
  readonly foldedTitle: string;
  readonly foldedBody: string;
}

/** The whole index — immutable plain data, discarded at lock (SEC-ZK-05). */
export interface PrivIndex {
  readonly entries: readonly PrivIndexEntry[];
}

/** Folds every note's title and plaintext once, in input order (the order `searchPrivIndex` preserves within each rank tier). */
export function buildPrivIndex(notes: readonly PrivIndexNote[]): PrivIndex {
  return {
    entries: notes.map((note) => ({
      id: note.id,
      foldedTitle: foldSearchText(note.title),
      foldedBody: foldSearchText(note.plaintext),
    })),
  };
}

/**
 * Ranked note ids for a query: the query is folded and split on whitespace,
 * a note matches when EVERY term is a substring of its folded title or body,
 * and notes whose title alone carries every term rank before the rest —
 * within each tier, index (input) order is preserved, so results are stable.
 * An empty or whitespace-only query matches nothing, never everything.
 */
export function searchPrivIndex(index: PrivIndex, query: string): string[] {
  const terms = foldSearchText(query)
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return [];

  const titleMatches: string[] = [];
  const bodyMatches: string[] = [];
  for (const entry of index.entries) {
    if (terms.every((term) => entry.foldedTitle.includes(term))) {
      titleMatches.push(entry.id);
    } else if (
      terms.every((term) => entry.foldedTitle.includes(term) || entry.foldedBody.includes(term))
    ) {
      bodyMatches.push(entry.id);
    }
  }
  return [...titleMatches, ...bodyMatches];
}
