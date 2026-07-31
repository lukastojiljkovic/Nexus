import * as Y from "yjs";

import { clozeNumbers, findClozeRuns, renderClozeSide } from "../study/clozeText.js";
import type { ClozeRun } from "../study/clozeText.js";
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

/**
 * The kind a card row is, mirroring `cards.kind` (migration 031 / ADR-042).
 * A `cloze` card keeps its rendered `front`/`back` like any other card AND the
 * template it was rendered from, so the reviewer can show the blank in context.
 */
export type CardKind = "basic" | "cloze";

/** One card a single block yields. `suffix` is appended to the block's key to form the card's reconcile key. */
export interface ParsedCard {
  front: string;
  back: string;
  /**
   * "" for a Q/A card, `#${number}` for one cloze deletion of the block — the
   * deletion's NUMBER (ADR-068), not its position, so inserting a blank in the
   * middle of a sentence leaves every other card's slot exactly where it was.
   */
  suffix: string;
  /** `basic` for a Q/A card, `cloze` for one deletion of a cloze block (ADR-042). */
  kind: CardKind;
  /** The block's raw `{{…}}` template, or null for a Q/A card — both set exactly when `kind` is `cloze`. */
  clozeText: string | null;
  /** Which deletion of `clozeText` this card asks, BY NUMBER, or null for a Q/A card. */
  clozeOrdinal: number | null;
}

/**
 * A run of card syntax inside a block's text, as half-open offsets, for the
 * editor's decorations. `cloze-label` is the `cN::` head of a labelled run —
 * inside that run's own `cloze` span, so the editor can draw the number as a
 * quiet marker and the answer as the answer.
 */
export interface CardSyntaxSpan {
  start: number;
  end: number;
  kind: "separator" | "cloze" | "cloze-label";
}

/** What one block's text yields: the cards, and the syntax spans to highlight. Both empty when the block is not a card. */
export interface ParsedBlock {
  cards: ParsedCard[];
  spans: CardSyntaxSpan[];
}

/** One generated card as the sync sends it: the reconcile key plus the rendered sides and, for a cloze card, its template (ADR-042). */
export interface NoteCardSpec {
  key: string;
  front: string;
  back: string;
  kind: CardKind;
  clozeText: string | null;
  clozeOrdinal: number | null;
}

/** `::` with whitespace required on both sides — what keeps `std::vector`/`Foo::bar` from becoming cards. */
const QNA_SEPARATOR = /(?<=\s)::(?=\s)/;

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
    cards: [{ front, back, suffix: "", kind: "basic", clozeText: null, clozeOrdinal: null }],
    spans: [{ start: match.index, end: match.index + 2, kind: "separator" }],
  };
}

/**
 * Applies only when the Q/A rule did not match. One card per deletion NUMBER —
 * not per run, since two runs may share a number and are then the same card
 * with two blanks (ADR-068) — all sharing one fully-unwrapped back, and all
 * carrying the block's raw text as their template, so a note-derived cloze row
 * is the same shape as a hand-made one (ADR-042) and the reviewer can put the
 * blank back in its context.
 *
 * The grammar itself lives in `study/clozeText.ts`: the editor's decorations,
 * the store's re-derivation and the reviewer all read it from there, and a
 * second copy here could only ever drift.
 */
function parseCloze(text: string): ParsedBlock {
  const runs: readonly ClozeRun[] = findClozeRuns(text);
  if (runs.length === 0) return { cards: [], spans: [] };

  const back = renderClozeSide(text, runs, null).trim();
  const cards: ParsedCard[] = clozeNumbers(runs).map((number) => ({
    front: renderClozeSide(text, runs, number).trim(),
    back,
    suffix: `#${number}`,
    kind: "cloze",
    clozeText: text,
    clozeOrdinal: number,
  }));
  const spans: CardSyntaxSpan[] = runs.flatMap((run) =>
    run.label === null
      ? [{ start: run.start, end: run.end, kind: "cloze" as const }]
      : [
          { start: run.start, end: run.end, kind: "cloze" as const },
          { start: run.start + 2, end: run.answerStart, kind: "cloze-label" as const },
        ],
  );
  return { cards, spans };
}

/**
 * A 10 000-character flashcard is not a flashcard: an over-long side drops the
 * whole block, not just that card. A cloze card's TEMPLATE is measured too —
 * it is persisted verbatim under the same column cap, and a block whose sides
 * fit only because unwrapping shortened them would be rejected by the store
 * rather than silently dropped here.
 */
function capLength(block: ParsedBlock): ParsedBlock {
  const overLong = block.cards.some(
    (card) =>
      card.front.length > NOTE_CARD_MAX_TEXT_LENGTH ||
      card.back.length > NOTE_CARD_MAX_TEXT_LENGTH ||
      (card.clozeText !== null && card.clozeText.length > NOTE_CARD_MAX_TEXT_LENGTH),
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
        specs.push({
          key,
          front: card.front,
          back: card.back,
          kind: card.kind,
          clozeText: card.clozeText,
          clozeOrdinal: card.clozeOrdinal,
        });
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
