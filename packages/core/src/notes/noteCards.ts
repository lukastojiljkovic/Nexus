import * as Y from "yjs";

import { xmlTextContent } from "./yjsText.js";

/**
 * Pure parsers for inline flashcard syntax authored directly in a note's text
 * (NOTE-006 slice a). One block's text yields zero or more cards through
 * `parseCardBlock` — the single source of truth two callers must never
 * disagree on: the editor's decoration plugin (highlighting, later slice) and
 * `collectNoteCards` (persistence, this slice). `collectNoteCards` walks a
 * note's Yjs document the same way `yjsMerge.ts`'s `collectNoteLinkIds` does
 * (the "default" fragment is a fixed contract per ADR-012).
 */

/** The maximum length of a generated card side — `CardStore`'s own cap, enforced here so an over-long block is visibly not a card. */
export const NOTE_CARD_MAX_TEXT_LENGTH = 10_000;

/** One card a single block yields. `suffix` is appended to the block's key to form the card's reconcile key. */
export interface ParsedCard {
  front: string;
  back: string;
  /** "" for a Q/A card, `#${ordinal}` for the ordinal-th cloze deletion of the block. */
  suffix: string;
}

/** A run of card syntax inside a block's text, as half-open offsets, for the editor's decorations. */
export interface CardSyntaxSpan {
  start: number;
  end: number;
  kind: "separator" | "cloze";
}

/** What one block's text yields: the cards, and the syntax spans to highlight. Both empty when the block is not a card. */
export interface ParsedBlock {
  cards: ParsedCard[];
  spans: CardSyntaxSpan[];
}

/** One generated card as the sync sends it: the reconcile key plus the rendered sides. */
export interface NoteCardSpec {
  key: string;
  front: string;
  back: string;
}

/** `::` with whitespace required on both sides — what keeps `std::vector`/`Foo::bar` from becoming cards. */
const QNA_SEPARATOR = /(?<=\s)::(?=\s)/;

/** A `{{…}}` run; `[^{}]*` both bans nesting and lets a run's own inner text decide if it is empty. */
const CLOZE_RUN = /\{\{([^{}]*)\}\}/g;

/**
 * The single source of truth for the inline-flashcard syntax. Returns
 * `{ cards: [], spans: [] }` when the block's text is not a card at all.
 */
export function parseCardBlock(text: string): ParsedBlock {
  const qna = parseQnA(text);
  return capLength(qna ?? parseCloze(text));
}

/**
 * The Q/A rule: split at the first whitespace-bounded `::`. A qualifying
 * separator with an empty side after trimming (a half-typed "Pitanje ::") is
 * treated as no match at all — the caller falls through to the cloze rule
 * rather than lighting up a half-written line.
 */
function parseQnA(text: string): ParsedBlock | null {
  const match = QNA_SEPARATOR.exec(text);
  if (!match || match.index === undefined) return null;

  const front = text.slice(0, match.index).trim();
  const back = text.slice(match.index + 2).trim();
  if (front.length === 0 || back.length === 0) return null;

  return {
    cards: [{ front, back, suffix: "" }],
    spans: [{ start: match.index, end: match.index + 2, kind: "separator" }],
  };
}

/** One `{{…}}` run whose inner text is non-empty after trimming — a candidate cloze deletion. */
interface ClozeRun {
  start: number;
  end: number;
  inner: string;
}

/**
 * The cloze rule: every non-overlapping `{{…}}` run with non-empty (trimmed)
 * inner text is one deletion, in left-to-right order. A run whose inner text
 * is empty or whitespace-only (`{{}}`, `{{ }}`) is not a deletion — it is
 * ignored, exactly as if it were not there, rather than rendered as an empty
 * hidden slot.
 */
function findClozeRuns(text: string): ClozeRun[] {
  const runs: ClozeRun[] = [];
  for (const match of text.matchAll(CLOZE_RUN)) {
    if (match.index === undefined) continue; // matchAll always sets it; guard keeps strict mode happy
    const inner = match[1] ?? "";
    if (inner.trim().length === 0) continue;
    runs.push({ start: match.index, end: match.index + match[0].length, inner });
  }
  return runs;
}

/** Applies only when the Q/A rule did not match. One card per deletion, all sharing one fully-unwrapped back. */
function parseCloze(text: string): ParsedBlock {
  const runs = findClozeRuns(text);
  if (runs.length === 0) return { cards: [], spans: [] };

  const back = renderClozeSide(text, runs, null).trim();
  const cards: ParsedCard[] = runs.map((_, ordinal) => ({
    front: renderClozeSide(text, runs, ordinal).trim(),
    back,
    suffix: `#${ordinal}`,
  }));
  const spans: CardSyntaxSpan[] = runs.map((run) => ({
    start: run.start,
    end: run.end,
    kind: "cloze",
  }));
  return { cards, spans };
}

/**
 * Rebuilds one side of a cloze card: the `target`-th run (0-based) is
 * replaced by `[…]` (Anki's "hide only this one" behaviour), every other run
 * is unwrapped to its own inner text. `target: null` unwraps every run — the
 * one back all of a block's cloze cards share.
 */
function renderClozeSide(text: string, runs: readonly ClozeRun[], target: number | null): string {
  let result = "";
  let cursor = 0;
  runs.forEach((run, index) => {
    result += text.slice(cursor, run.start);
    result += index === target ? "[…]" : run.inner;
    cursor = run.end;
  });
  return result + text.slice(cursor);
}

/** A 10 000-character flashcard is not a flashcard: an over-long side drops the whole block, not just that card. */
function capLength(block: ParsedBlock): ParsedBlock {
  const overLong = block.cards.some(
    (card) =>
      card.front.length > NOTE_CARD_MAX_TEXT_LENGTH || card.back.length > NOTE_CARD_MAX_TEXT_LENGTH,
  );
  return overLong ? { cards: [], spans: [] } : block;
}

/**
 * All flashcards a note's document currently authors (NOTE-006 slice a),
 * document order, dedupe by key, first occurrence wins. Modelled on
 * `collectNoteLinkIds`'s walk: the "default" fragment is a fixed contract
 * (ADR-012), and card blocks — paragraphs — may be nested inside list items,
 * task items, blockquotes, so the walk is recursive.
 *
 * A `codeBlock` is never descended into, `cardKey` attribute or not: code is
 * code, and `std::vector` sitting in a code sample must never become a card
 * just because the block happens to carry a stray key.
 */
export function collectNoteCards(doc: Y.Doc): NoteCardSpec[] {
  const specs: NoteCardSpec[] = [];
  const seenKeys = new Set<string>();

  function walk(node: Y.XmlElement | Y.XmlText | Y.XmlHook): void {
    if (!(node instanceof Y.XmlElement)) return; // text leaves/hooks carry no card blocks
    if (node.nodeName === "codeBlock") return; // never descend into or key off of code

    const cardKey = node.getAttribute("cardKey");
    if (typeof cardKey === "string" && cardKey.length > 0) {
      const { cards } = parseCardBlock(nodeText(node));
      for (const card of cards) {
        const key = cardKey + card.suffix;
        // First occurrence wins: a block copy-pasted before the editor's
        // re-keying plugin runs would otherwise send two specs for one slot,
        // and the database's UNIQUE index would reject the whole sync.
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        specs.push({ key, front: card.front, back: card.back });
      }
    }

    for (const child of node.toArray()) walk(child);
  }

  for (const child of doc.getXmlFragment("default").toArray()) walk(child);
  return specs;
}

/**
 * The concatenated text of one XML node, deliberately mirroring ProseMirror's
 * own `Node.textContent`: text runs concatenated, every non-text node — an
 * inline atom like `noteLink`, a `hardBreak` — contributing nothing, and no
 * separator at a block boundary. That parity is the whole point: the editor's
 * decoration plugin parses `node.textContent` while persistence parses this,
 * and ADR-017's guarantee is that ONE parser sees the same string both times.
 * A hardBreak yielding "\n" here would be *nicer* text and would silently make
 * a line a card in the database that the editor never highlighted.
 *
 * So this stays a separate walk from `yjsMerge.ts`'s (which does want readable
 * lines) — but not a separate way of reading a text run: both go through
 * `xmlTextContent`, because a mark leaking in as `<bold>…</bold>` is wrong for
 * either of them, and here it would land verbatim on the front or back of a
 * flashcard the user then studies.
 */
function nodeText(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return xmlTextContent(node);
  if (node instanceof Y.XmlElement) {
    let text = "";
    for (const child of node.toArray()) text += nodeText(child);
    return text;
  }
  return ""; // Y.XmlHook carries no text
}
