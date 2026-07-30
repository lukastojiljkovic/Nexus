import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { collectNoteCards, NOTE_CARD_MAX_TEXT_LENGTH, parseCardBlock } from "./noteCards.js";
import type { NoteCardSpec, ParsedCard } from "./noteCards.js";

// The four builders below spell out the ADR-042 kind fields once instead of on
// every expectation: they are constant for a Q/A card and mechanical for a
// cloze one, and inlining them would bury what each test is actually about.

/** A Q/A card's full `ParsedCard`. */
const basic = (front: string, back: string, suffix = ""): ParsedCard => ({
  front,
  back,
  suffix,
  kind: "basic",
  clozeText: null,
  clozeOrdinal: null,
});

/** One deletion of `clozeText`, already rendered. */
const cloze = (
  front: string,
  back: string,
  clozeText: string,
  clozeOrdinal: number,
): ParsedCard => ({
  front,
  back,
  suffix: `#${clozeOrdinal}`,
  kind: "cloze",
  clozeText,
  clozeOrdinal,
});

/** A Q/A card as `collectNoteCards` sends it. */
const basicSpec = (key: string, front: string, back: string): NoteCardSpec => ({
  key,
  front,
  back,
  kind: "basic",
  clozeText: null,
  clozeOrdinal: null,
});

/** One cloze deletion as `collectNoteCards` sends it. */
const clozeSpec = (
  key: string,
  front: string,
  back: string,
  clozeText: string,
  clozeOrdinal: number,
): NoteCardSpec => ({ key, front, back, kind: "cloze", clozeText, clozeOrdinal });

describe("parseCardBlock — Q/A rule", () => {
  it("splits a whitespace-bounded :: into a trimmed front/back, spanning only the colons", () => {
    const text = "Pitanje :: Odgovor";
    const sep = text.indexOf("::");
    expect(parseCardBlock(text)).toEqual({
      cards: [basic("Pitanje", "Odgovor")],
      spans: [{ start: sep, end: sep + 2, kind: "separator" }],
    });
  });

  it("leaves std::vector and Foo::bar as plain text — no whitespace around the operator", () => {
    expect(parseCardBlock("Use std::vector<int> here")).toEqual({ cards: [], spans: [] });
    expect(parseCardBlock("Foo::bar")).toEqual({ cards: [], spans: [] });
  });

  it("leaves a::b as plain text (no spaces on either side)", () => {
    expect(parseCardBlock("a::b")).toEqual({ cards: [], spans: [] });
  });

  it("splits at only the first qualifying separator; a later :: is just text", () => {
    const parsed = parseCardBlock("A :: B :: C");
    expect(parsed.cards).toEqual([basic("A", "B :: C")]);
  });

  it("produces no card and no span when the front is empty after trimming", () => {
    expect(parseCardBlock(" :: Odgovor")).toEqual({ cards: [], spans: [] });
  });

  it("produces no card and no span when the back is empty after trimming (half-typed separator)", () => {
    expect(parseCardBlock("Pitanje :: ")).toEqual({ cards: [], spans: [] });
  });
});

describe("parseCardBlock — cloze rule", () => {
  it("hides one deletion behind […], unwraps it in the shared back", () => {
    const text = "Rečenica sa {{skrivenim}} delom";
    const start = text.indexOf("{{");
    const end = text.indexOf("}}") + 2;
    expect(parseCardBlock(text)).toEqual({
      cards: [cloze("Rečenica sa […] delom", "Rečenica sa skrivenim delom", text, 0)],
      spans: [{ start, end, kind: "cloze" }],
    });
  });

  it("produces one card per deletion, each hiding only its own run, sharing one back", () => {
    const text = "{{A}} i {{B}}";
    const parsed = parseCardBlock(text);
    expect(parsed.cards).toEqual([
      cloze("[…] i B", "A i B", text, 0),
      cloze("A i […]", "A i B", text, 1),
    ]);
    expect(parsed.spans).toHaveLength(2);
    expect(parsed.spans.every((span) => span.kind === "cloze")).toBe(true);
  });

  it("does not apply once the Q/A rule matched — the braces stay literal", () => {
    const parsed = parseCardBlock("Pitanje {{sa}} :: Odgovor");
    expect(parsed.cards).toEqual([basic("Pitanje {{sa}}", "Odgovor")]);
  });

  it("ignores a run whose inner text is empty or whitespace-only", () => {
    expect(parseCardBlock("Samo {{}} tekst")).toEqual({ cards: [], spans: [] });
    expect(parseCardBlock("Samo {{ }} tekst")).toEqual({ cards: [], spans: [] });
  });
});

describe("parseCardBlock — length cap", () => {
  it("drops the whole block when a rendered side exceeds NOTE_CARD_MAX_TEXT_LENGTH", () => {
    const overLong = "x".repeat(NOTE_CARD_MAX_TEXT_LENGTH + 1);
    expect(parseCardBlock(`${overLong} :: back`)).toEqual({ cards: [], spans: [] });
  });

  it("accepts a side at exactly the cap", () => {
    const atCap = "x".repeat(NOTE_CARD_MAX_TEXT_LENGTH);
    expect(parseCardBlock(`${atCap} :: back`).cards).toHaveLength(1);
  });
});

/** A "paragraph"-shaped element, optionally carrying the card-parser's `cardKey` attribute. */
function paragraph(text: string, cardKey?: string): Y.XmlElement {
  const el = new Y.XmlElement("paragraph");
  el.insert(0, [new Y.XmlText(text)]);
  if (cardKey !== undefined) el.setAttribute("cardKey", cardKey);
  return el;
}

/** A "codeBlock"-shaped element — `collectNoteCards` must never descend into or key off of one. */
function codeBlock(text: string, cardKey?: string): Y.XmlElement {
  const el = new Y.XmlElement("codeBlock");
  el.insert(0, [new Y.XmlText(text)]);
  if (cardKey !== undefined) el.setAttribute("cardKey", cardKey);
  return el;
}

/** A fresh doc whose "default" fragment holds the given top-level blocks, in order. */
function docWithBlocks(...blocks: Y.XmlElement[]): Y.Doc {
  const doc = new Y.Doc();
  doc.getXmlFragment("default").push(blocks);
  return doc;
}

/** One run of a marked paragraph: the text, and the marks a real editor would have written over it. */
interface MarkedRun {
  text: string;
  marks?: Record<string, unknown>;
}

/**
 * A doc holding one keyed paragraph whose text is assembled from marked runs.
 * The element is pushed into the document *before* anything is inserted into
 * its text: an unintegrated `Y.XmlText` queues its inserts and keeps reporting
 * `length` 0, so formatting one before attaching it lands every run at index 0,
 * in reverse.
 */
function markedCardDoc(runs: readonly MarkedRun[], cardKey: string): Y.Doc {
  const doc = new Y.Doc();
  const paragraphEl = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  paragraphEl.insert(0, [text]);
  paragraphEl.setAttribute("cardKey", cardKey);
  doc.getXmlFragment("default").push([paragraphEl]);

  for (const run of runs) {
    if (run.marks) text.insert(text.length, run.text, run.marks);
    else text.insert(text.length, run.text);
  }
  return doc;
}

describe("collectNoteCards", () => {
  it("returns nothing for an empty doc", () => {
    expect(collectNoteCards(new Y.Doc())).toEqual([]);
  });

  it("collects a Q/A card from a keyed paragraph", () => {
    const doc = docWithBlocks(paragraph("Pitanje :: Odgovor", "key-1"));
    expect(collectNoteCards(doc)).toEqual([basicSpec("key-1", "Pitanje", "Odgovor")]);
  });

  it("collects a keyed paragraph nested inside a list item", () => {
    const list = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    item.insert(0, [paragraph("Q :: A", "key-nested")]);
    list.insert(0, [item]);
    const doc = docWithBlocks(list);
    expect(collectNoteCards(doc)).toEqual([basicSpec("key-nested", "Q", "A")]);
  });

  it("skips a codeBlock entirely, even one carrying a cardKey", () => {
    const doc = docWithBlocks(codeBlock("std::vector<int> v; // :: Q", "key-code"));
    expect(collectNoteCards(doc)).toEqual([]);
  });

  it("dedupes a repeated key, keeping the first occurrence", () => {
    const doc = docWithBlocks(
      paragraph("Prvo :: Pitanje", "dup"),
      paragraph("Drugo :: Pitanje", "dup"),
    );
    expect(collectNoteCards(doc)).toEqual([basicSpec("dup", "Prvo", "Pitanje")]);
  });

  it("preserves document order across multiple blocks", () => {
    const doc = docWithBlocks(
      paragraph("A :: 1", "k1"),
      paragraph("B :: 2", "k2"),
      paragraph("C :: 3", "k3"),
    );
    expect(collectNoteCards(doc).map((c) => c.key)).toEqual(["k1", "k2", "k3"]);
  });

  it("yields nothing for a keyed block with no card syntax", () => {
    const doc = docWithBlocks(paragraph("Obična rečenica.", "key-plain"));
    expect(collectNoteCards(doc)).toEqual([]);
  });

  it("drops marks from a card's sides — a bolded answer is text, not <bold>…</bold>", () => {
    const doc = markedCardDoc(
      [{ text: "Glavni grad Francuske :: " }, { text: "Pariz", marks: { bold: {} } }],
      "key-bold",
    );
    expect(collectNoteCards(doc)).toEqual([
      basicSpec("key-bold", "Glavni grad Francuske", "Pariz"),
    ]);
  });

  it("drops a code mark too — the form a programming note reaches for most", () => {
    const doc = markedCardDoc(
      [{ text: "Prazan vektor :: " }, { text: "std::vector<int> v;", marks: { code: {} } }],
      "key-code",
    );
    expect(collectNoteCards(doc)).toEqual([
      basicSpec("key-code", "Prazan vektor", "std::vector<int> v;"),
    ]);
  });

  it("gives a hardBreak no text, matching the editor's own textContent", () => {
    const el = new Y.XmlElement("paragraph");
    el.setAttribute("cardKey", "key-break");
    el.insert(0, [new Y.XmlText("Pitanje ::"), new Y.XmlElement("hardBreak"), new Y.XmlText("Odgovor")]);
    // The decoration plugin parses ProseMirror's `textContent`, where a
    // hardBreak is empty as well — it sees "Pitanje ::Odgovor", whose `::` has
    // no whitespace after it, and highlights nothing. Persisting a card here
    // would create one the user was never shown.
    expect(collectNoteCards(docWithBlocks(el))).toEqual([]);
  });

  it("gives a noteLink no text, matching the editor's own textContent", () => {
    const link = new Y.XmlElement("noteLink");
    link.setAttribute("noteId", "note-1");
    link.setAttribute("label", "Druga beleška");
    const el = new Y.XmlElement("paragraph");
    el.setAttribute("cardKey", "key-link");
    el.insert(0, [new Y.XmlText("Pitanje :: "), link]);
    // Same parity rule: an inline atom contributes no text, so the back is
    // empty and this is not a card — for the editor and for the database alike.
    expect(collectNoteCards(docWithBlocks(el))).toEqual([]);
  });

  it("expands cloze deletions into separate, ordinal-suffixed specs", () => {
    const doc = docWithBlocks(paragraph("{{A}} i {{B}}", "cloze-key"));
    expect(collectNoteCards(doc)).toEqual([
      clozeSpec("cloze-key#0", "[…] i B", "A i B", "{{A}} i {{B}}", 0),
      clozeSpec("cloze-key#1", "A i […]", "A i B", "{{A}} i {{B}}", 1),
    ]);
  });

  it("carries the block's raw template on every cloze spec, so the row can re-derive itself (ADR-042)", () => {
    const doc = docWithBlocks(paragraph("Glavni grad je {{Beograd}}.", "k"));
    const specs = collectNoteCards(doc);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.clozeText).toBe("Glavni grad je {{Beograd}}.");
    expect(specs[0]?.clozeOrdinal).toBe(0);
    expect(specs[0]?.kind).toBe("cloze");
  });

  it("drops a cloze block whose TEMPLATE exceeds the cap even though its sides fit", () => {
    // Unwrapping strips 4 characters per run, so a template one over the cap
    // renders to a back that is under it — the template is what gets stored.
    const inner = "x".repeat(NOTE_CARD_MAX_TEXT_LENGTH - 3);
    const text = `{{${inner}}}`;
    expect(text.length).toBe(NOTE_CARD_MAX_TEXT_LENGTH + 1);
    expect(parseCardBlock(text)).toEqual({ cards: [], spans: [] });
  });
});
