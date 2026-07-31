import { findClozeRuns, renderClozeCard } from "../study/clozeText.js";
import type { ExportCard, ExportDeck, ExportSubject, ProfileData } from "./exportArchive.js";
import { walkProtoFields } from "./protoWalk.js";

/**
 * The pure half of the Anki `.apkg` import (ADR-052 / STUDY-011): somebody
 * else's collection, already read off disk by `main/apkgReader.ts`, turned into
 * the `ProfileData` `planForeignImport` merges and an honest account of
 * everything that did not survive the crossing.
 *
 * The split is the same one every other import in this package makes. The
 * READER is where untrusted bytes live — a zip, a foreign SQLite file, a
 * protobuf manifest — and it answers with plain numbers and strings. THIS
 * module is pure: no clock (`now` is injected), no id generator (the ids below
 * are deterministic source-side names the planner mints over), no IO. That is
 * what lets every rule here be tested against an adversarial fixture rather
 * than against a real `.apkg` somebody had to produce.
 *
 * Three decisions shape everything below, and each is a refusal to guess:
 *
 *  - **Text is text.** Anki fields are HTML. `stripAnkiHtml` reduces one to the
 *    plain text a Nexus card holds, decoding entities AFTER the markup is gone
 *    (so `&lt;script&gt;` can never become a tag), keeping `$…$`, rewriting the
 *    two MathJax spellings into it, and COUNTING — never silently swallowing —
 *    every image and sound reference it removes. v1 carries no media, and the
 *    preview says so in a number.
 *  - **A cloze note either translates exactly or does not translate at all.**
 *    `canonicalizeCloze` rewrites `{{cN::…}}` into Nexus's positional `{{…}}`
 *    grammar and then CHECKS its own output against `findClozeRuns` — core's
 *    own reader of that grammar. Anything the check disagrees with is refused
 *    by name. A cloze card whose blanks landed one position off would be worse
 *    than a card that never arrived.
 *  - **No scheduling history crosses.** Every card is born new, at `now`, in
 *    exactly the shape `createEmptyCard` gives one (`CardStore.insertNew`).
 *    FSRS's parameters are not Anki's SM-2 ones, and a stability invented from
 *    an interval would be a fabricated number in the user's own study data.
 */

// --- Field text --------------------------------------------------------------

/** One Anki field, reduced to plain text, plus what was taken out of it. */
export interface AnkiFieldText {
  text: string;
  /** `<img>` references removed — v1 carries no media, so these are counted and named. */
  images: number;
  /** `[sound:…]` references removed, on the same terms. */
  sounds: number;
}

/**
 * Tags that separate BLOCKS of text: each becomes a newline, because the words
 * on either side of one were never on the same line. Everything else is
 * unwrapped in place (`<b>`, `<span>`, `<a>`), because its text continues the
 * sentence around it.
 */
const BLOCK_TAGS = new Set([
  "br",
  "div",
  "p",
  "li",
  "ul",
  "ol",
  "tr",
  "td",
  "th",
  "table",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
]);

/** `[sound:whatever.mp3]` — Anki's own media reference in a field, and never valid HTML, so it is taken out before the markup is. */
const SOUND_REFERENCE = /\[sound:[^\]]*\]/g;

/** A `<script>`/`<style>` element AND its contents — the one case where removing the tag alone would leave code on screen as text. Lazy body, so two blocks never merge into one. */
const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** `<anki-mathjax …>x</anki-mathjax>` — the newer editor's math element, whose content is TeX. Lazy body, for `SCRIPT_OR_STYLE`'s reason. */
const ANKI_MATHJAX = /<anki-mathjax\b[^>]*>([\s\S]*?)<\/anki-mathjax\s*>/gi;

/** Any `<img …>`, self-closing or not. */
const IMAGE_TAG = /<img\b[^>]*>/gi;

/** Any remaining tag, opening or closing, with its name captured. `[^>]*` is deliberately linear — nothing here may backtrack over a 256 KiB field. */
const ANY_TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;

/** A named or numeric character reference, WITH its terminating semicolon — a `&amp` that never closed is not an entity and stays as it was typed. */
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;

/** The named entities Anki's own editor writes. An unknown name is left literal rather than guessed at. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  // U+00A0, written as an escape: a raw one is invisible and every tool in
  // the chain treats it differently.
  nbsp: "\u00a0",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  deg: "°",
  times: "×",
  divide: "÷",
  plusmn: "±",
  micro: "µ",
  middot: "·",
  eacute: "é",
  szlig: "ß",
};

/** Above this, a numeric reference names no character — decoding it would throw, so the reference is left literal. */
const MAX_CODE_POINT = 0x10ffff;

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#")) {
      const digits = body.startsWith("#x") || body.startsWith("#X") ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, body.startsWith("#x") || body.startsWith("#X") ? 16 : 10);
      if (!Number.isInteger(code) || code < 0 || code > MAX_CODE_POINT) return whole;
      // Surrogate halves are not characters; `String.fromCodePoint` accepts
      // them and would produce a lone surrogate in the middle of a card.
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/**
 * MathJax, in the two spellings Anki writes it: `\(…\)` inline and `\[…\]`
 * display. Both become `$…$`, which is the delimiter a Nexus card's own KaTeX
 * rendering reads — `$…$` already in the field is left exactly as it is, since
 * it is already what we want. Lazy bodies, so two formulas in one field stay
 * two formulas.
 */
const MATHJAX_INLINE = /\\\(([\s\S]*?)\\\)/g;
const MATHJAX_DISPLAY = /\\\[([\s\S]*?)\\\]/g;

/**
 * One Anki field as plain Nexus card text.
 *
 * ORDER IS THE SECURITY PROPERTY here, and it is worth stating outright:
 * entities are decoded LAST, after every tag is already gone. A field carrying
 * `&lt;script&gt;alert(1)&lt;/script&gt;` therefore ends up as that text,
 * visible, and can never be re-read as markup by anything downstream — which is
 * exactly what would happen if the two steps were the other way round.
 *
 * Every regex above is linear: `[^>]*` and `[^\]]*` cannot backtrack, and the
 * lazy `[\s\S]*?` bodies are bounded by their own literal terminators. A 256
 * KiB field (the reader's per-field cap) is walked once per pass, never
 * re-walked.
 */
export function stripAnkiHtml(field: string): AnkiFieldText {
  let sounds = 0;
  let text = field.replace(SOUND_REFERENCE, () => {
    sounds += 1;
    return "";
  });

  text = text.replace(SCRIPT_OR_STYLE, "");
  text = text.replace(ANKI_MATHJAX, (_whole, body: string) => `$${body}$`);

  let images = 0;
  text = text.replace(IMAGE_TAG, () => {
    images += 1;
    return "";
  });

  text = text.replace(ANY_TAG, (_whole, name: string) =>
    BLOCK_TAGS.has(name.toLowerCase()) ? "\n" : "",
  );

  text = decodeEntities(text);
  text = text.replace(MATHJAX_INLINE, (_whole, body: string) => `$${body}$`);
  text = text.replace(MATHJAX_DISPLAY, (_whole, body: string) => `$${body}$`);

  // Horizontal whitespace (the U+00A0 a decoded `&nbsp;` leaves included)
  // collapses to one
  // space; a run of newlines collapses to one, so the block tags above cannot
  // turn `<div></div><div>x</div>` into a gap. Then every line is trimmed, and
  // the empty ones dropped.
  text = text.replace(/[^\S\n]+/g, " ");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return { text: lines.join("\n"), images, sounds };
}

// --- Cloze ------------------------------------------------------------------

/** Why one Anki cloze note cannot become Nexus cloze cards. Every one of these refuses the NOTE and is counted; none of them ever refuses the archive. */
export type ClozeCanonicalRefusal =
  | "cloze-nested"
  | "cloze-ordinal-reused"
  | "cloze-no-deletions"
  | "cloze-unrepresentable";

export interface ClozeCanonical {
  /** The note's text in Nexus's `{{…}}` grammar — the `cloze_text` every sibling row stores. */
  template: string;
  /** Anki's own `cN` number → that deletion's 0-based POSITION in `template`, which is the `cloze_ordinal` a Nexus row asks by. */
  positionByAnkiNumber: ReadonlyMap<number, number>;
  /** How many `::hint` parts were dropped — Nexus's grammar has no hint, and a silently discarded one is indistinguishable from a bug. */
  hintsDropped: number;
}

/** `{{cN::text}}` or `{{cN::text::hint}}`. `[^{}]*` on every part is what makes a NESTED deletion fail to match rather than match wrongly. */
const ANKI_CLOZE = /\{\{c(\d+)::([^{}]*?)(?:::([^{}]*?))?\}\}/g;

/** Where a deletion CLAIMS to begin. Every one of these must be the start of a full `ANKI_CLOZE` match, or the field says something this grammar cannot read. */
const ANKI_CLOZE_OPENER = /\{\{c\d+::/g;

/** Any `{{` or `}}` at all — used only to prove that nothing brace-shaped survived the rewrite unaccounted for. */
const ANY_BRACE_RUN = /\{\{|\}\}/g;

/**
 * One Anki cloze field as a Nexus cloze template.
 *
 * Deletions are renumbered BY FIRST APPEARANCE, not by their `cN` number: Nexus
 * ordinals are POSITIONAL (`findClozeRuns` returns runs left to right), so a
 * note written `{{c2::…}} … {{c1::…}}` has to become deletion 0 then deletion 1
 * in that order, or every sibling card would ask about the wrong blank.
 *
 * Four refusals, each of them a case where the two grammars genuinely disagree
 * and guessing would corrupt somebody's deck:
 *
 *  - `cloze-ordinal-reused` — Anki lets one `cN` appear twice, blanking both
 *    halves on a single card. A positional grammar cannot say that at all.
 *  - `cloze-nested` — Anki's own parser rejects these too; ours must not
 *    silently half-match one.
 *  - `cloze-no-deletions` — a cloze note with nothing to hide has no cards.
 *  - `cloze-unrepresentable` — the catch-all, and the one that makes the other
 *    three safe: the finished template is read back with `findClozeRuns`, and
 *    unless it yields exactly the deletions that were put in, in order, with
 *    the same text, the note is refused. A brace inside a deletion, an empty
 *    deletion, a stray `{{…}}` in the surrounding prose — none of them needs
 *    its own rule, because the check catches all of them by construction.
 */
export function canonicalizeCloze(
  field: string,
): { ok: true; value: ClozeCanonical } | { ok: false; reason: ClozeCanonicalRefusal } {
  const matches = [...field.matchAll(ANKI_CLOZE)].filter((match) => match.index !== undefined);
  const matchStarts = new Set(matches.map((match) => match.index));

  // STRUCTURE FIRST. `[^{}]*` makes an outer `{{c1::… {{c2::…}} …}}` fail to
  // match at all, so a deletion that opened and never parsed is the only
  // evidence nesting leaves behind. Which of the two refusals it is depends on
  // what follows the opener: another `{{` before the next `}}` is a deletion
  // wrapped around a deletion; anything else is a field whose braces this
  // grammar simply cannot express.
  for (const opener of field.matchAll(ANKI_CLOZE_OPENER)) {
    if (opener.index === undefined || matchStarts.has(opener.index)) continue;
    const rest = field.slice(opener.index + opener[0].length);
    const nextOpen = rest.indexOf("{{");
    const nextClose = rest.indexOf("}}");
    const nested = nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose);
    return { ok: false, reason: nested ? "cloze-nested" : "cloze-unrepresentable" };
  }

  const positionByAnkiNumber = new Map<number, number>();
  const texts: string[] = [];
  let hintsDropped = 0;
  let template = "";
  let cursor = 0;

  for (const match of matches) {
    const index = match.index ?? 0;
    const number = Number.parseInt(match[1] ?? "", 10);
    // `c0` is not a deletion in Anki either — its card would be ordinal -1. Left
    // in the text as it was written rather than unwrapped, since unwrapping it
    // would silently change what the note says.
    if (!Number.isInteger(number) || number < 1) continue;
    // Anki lets one `cN` appear twice, blanking both halves on ONE card. A
    // positional grammar has no way to say that, so the note is refused rather
    // than turned into two cards the author never wrote.
    if (positionByAnkiNumber.has(number)) return { ok: false, reason: "cloze-ordinal-reused" };
    if (match[3] !== undefined) hintsDropped += 1;
    const inner = match[2] ?? "";
    positionByAnkiNumber.set(number, texts.length);
    texts.push(inner);
    template += field.slice(cursor, index) + `{{${inner}}}`;
    cursor = index + match[0].length;
  }
  template += field.slice(cursor);

  if (texts.length === 0) return { ok: false, reason: "cloze-no-deletions" };

  // The self-check. `findClozeRuns` is core's OWN reader of the `{{…}}` grammar
  // — the same one `CardStore` re-derives a row's sides with and the reviewer
  // splits its segments with — so agreeing with it is the only definition of
  // "this template says what we meant" that cannot drift.
  const runs = findClozeRuns(template);
  if (runs.length !== texts.length) return { ok: false, reason: "cloze-unrepresentable" };
  for (let index = 0; index < runs.length; index += 1) {
    if (runs[index]?.inner !== texts[index]) return { ok: false, reason: "cloze-unrepresentable" };
  }
  // A brace run outside the deletions we wrote would not change what
  // `findClozeRuns` returns but WOULD be text the user never sees the same way
  // twice; counted here so it is refused rather than shipped.
  const braceRuns = template.match(ANY_BRACE_RUN)?.length ?? 0;
  if (braceRuns !== runs.length * 2) return { ok: false, reason: "cloze-unrepresentable" };

  return { ok: true, value: { template, positionByAnkiNumber, hintsDropped } };
}

// --- Schema 18's notetype kind ----------------------------------------------

/**
 * The one fact a schema-18 collection keeps ONLY in a protobuf blob: whether a
 * notetype is basic or cloze. `Notetype.Config`'s field 1 is `Kind kind`
 * (varint; `KIND_NORMAL = 0`, `KIND_CLOZE = 1` — verified against Anki's
 * proto/anki/notetypes.proto). Everything else in the blob is walked past by
 * size and never interpreted, because everything else the import needs comes
 * from real table columns.
 *
 * Two proto3 rules are load-bearing here, both the format's own:
 *
 *  - A zero enum is OMITTED from the wire, so a config with no field 1 at all
 *    IS a normal notetype — absence is the common case, not an error.
 *  - When a non-repeated scalar appears twice, the LAST occurrence wins.
 *
 * `null` — never a guess — for a kind value this build does not know: a note
 * whose type we cannot name is a note whose text we cannot honestly call a
 * question or a cloze template. A malformed blob throws `ProtoWalkError`
 * instead, because "this build does not know it" and "the bytes are damaged"
 * deserve different refusals, and only the caller knows both vocabularies.
 */
export function ankiNotetypeKind(config: Uint8Array): "basic" | "cloze" | null {
  let kind = 0;
  for (const field of walkProtoFields(config)) {
    if (field.fieldNumber === 1 && field.wireType === 0) kind = field.value;
  }
  if (kind === 0) return "basic";
  if (kind === 1) return "cloze";
  return null;
}

// --- Translation -------------------------------------------------------------

/**
 * Why something an `.apkg` carried is not in the plan. Every one of these is
 * COUNTED and shown before anything is written; none of them ever refuses the
 * whole file, which the reader's caps are for.
 */
export type ApkgSkipCode =
  | "unknown-notetype"
  | "unknown-deck"
  | "empty-note"
  | "empty-deck"
  | "template-unsupported"
  | "extra-fields-dropped"
  | "cloze-nested"
  | "cloze-ordinal-reused"
  | "cloze-no-deletions"
  | "cloze-unrepresentable"
  | "cloze-hint-dropped"
  | "media-stripped"
  | "history-dropped"
  | "tags-dropped"
  | "card-without-note";

/** Every skip code, in the order the preview lists them: what was lost outright first, what was merely trimmed after. */
export const APKG_SKIP_CODES: readonly ApkgSkipCode[] = [
  "unknown-notetype",
  "unknown-deck",
  "empty-note",
  "empty-deck",
  "template-unsupported",
  "cloze-nested",
  "cloze-ordinal-reused",
  "cloze-no-deletions",
  "cloze-unrepresentable",
  "cloze-hint-dropped",
  "extra-fields-dropped",
  "media-stripped",
  "tags-dropped",
  "history-dropped",
  "card-without-note",
];

export interface ApkgSkip {
  code: ApkgSkipCode;
  count: number;
}

export interface ApkgTranslateReport {
  /** Decks the plan will create. */
  decks: number;
  /** Anki notes that produced at least one card. */
  notes: number;
  /** Cards the plan will create. */
  cards: number;
  /** Every named loss, in `APKG_SKIP_CODES` order, zero-count lines omitted. */
  skips: readonly ApkgSkip[];
}

/** One deck of the collection. `name` is Anki's own `Parent::Child` path — the reader normalises schema 18's `\x1f` separator to it. */
export interface ApkgDeck {
  id: number;
  name: string;
}

/**
 * One notetype, reduced to the two facts a translation needs: whether its notes
 * are cloze, and how many templates it defines. Everything else about an Anki
 * notetype is a rendering language this import deliberately does not implement.
 */
export interface ApkgNotetype {
  id: number;
  name: string;
  kind: "basic" | "cloze";
  templateCount: number;
}

/** One note: its fields already split on `\x1f`, still as raw HTML, plus its tags. */
export interface ApkgNote {
  id: number;
  notetypeId: number;
  fields: readonly string[];
  tags: readonly string[];
}

/** One card: which note and template it is, where it lives, and the two facts that make it "already studied". */
export interface ApkgCard {
  noteId: number;
  ord: number;
  deckId: number;
  reps: number;
  /** Suspended OR buried — both are `queue < 0` in Anki, and both mean a state this import does not carry. */
  suspended: boolean;
}

/** One collection, as `main/apkgReader.ts` reads it. */
export interface ParsedApkg {
  decks: readonly ApkgDeck[];
  notetypes: readonly ApkgNotetype[];
  notes: readonly ApkgNote[];
  cards: readonly ApkgCard[];
  /** How many entries the `media` manifest declared. Counted, never fetched — v1 imports no media. */
  mediaCount: number;
}

/** Where the imported decks land: a subject the profile already has, or one this import names into being. */
export type ApkgSubjectChoice = { kind: "existing"; id: string } | { kind: "new"; name: string };

export interface ApkgTranslateTarget {
  /** The profile every row is stamped with — never the archive's, because an `.apkg` has none. */
  profileId: string;
  subject: ApkgSubjectChoice;
  /** ISO-8601, injected: this module reads no clock. Every row's `createdAt`/`updatedAt`, and every fresh card's `due`. */
  now: string;
}

export interface ApkgTranslation {
  /** Ready for `planForeignImport`, whose id map re-mints every id below. */
  data: ProfileData;
  /** `ForeignImportTarget.seededIds` — non-empty exactly when an EXISTING subject was chosen (see `APKG_SUBJECT_SOURCE_ID`). */
  seededIds: ReadonlyMap<string, string>;
  report: ApkgTranslateReport;
}

/**
 * The source-side id every deck points at. Deterministic rather than minted,
 * because this module is pure — the planner is where real ids are made, and it
 * either mints one for the subject ROW below or resolves this name straight
 * onto an existing subject through `seededIds`.
 */
export const APKG_SUBJECT_SOURCE_ID = "apkg:subject";

/** The subject colour an import creates with. The schema's own default (migration 005) and the study module's primary hue. */
const IMPORT_SUBJECT_COLOR = "jade";

/** How a flattened `Parent::Child` deck name reads in Nexus, which has no deck hierarchy — the same separator the note-folder picker renders a path with. */
const DECK_PATH_SEPARATOR = " / ";

/**
 * A fresh card's scheduling columns, exactly as `createEmptyCard(now)` produces
 * them (`CardStore.insertNew`) — spelled out rather than imported, because
 * `@nexus/core` has no `ts-fsrs` dependency and must not grow one for eleven
 * constants. `due` is `now`: a new card is due immediately, which is what makes
 * an imported deck studiable the moment it lands.
 *
 * Exported because it is not Anki's: EVERY importer that creates a card creates
 * a NEW one (`llmPrompts.ts` is the second), and two copies of these eleven
 * constants could only ever drift apart.
 */
export function freshCardScheduling(now: string): Pick<
  ExportCard,
  | "due"
  | "stability"
  | "difficulty"
  | "elapsedDays"
  | "scheduledDays"
  | "learningSteps"
  | "reps"
  | "lapses"
  | "state"
  | "lastReview"
  | "createdAt"
  | "updatedAt"
> {
  return {
    due: now,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Collects skips by code, so the report is a set of named lines rather than a running commentary. */
class SkipLedger {
  private readonly counts = new Map<ApkgSkipCode, number>();

  add(code: ApkgSkipCode, count = 1): void {
    if (count <= 0) return;
    this.counts.set(code, (this.counts.get(code) ?? 0) + count);
  }

  toReport(): ApkgSkip[] {
    return APKG_SKIP_CODES.filter((code) => (this.counts.get(code) ?? 0) > 0).map((code) => ({
      code,
      count: this.counts.get(code) ?? 0,
    }));
  }
}

/**
 * Turns one parsed collection into the profile data an import inserts.
 *
 * The shape of the answer is deliberately narrow: an `.apkg` carries decks,
 * notes and cards and NOTHING else this app models — no tasks, no notes-module
 * notes, no calendar — so every other member of `ProfileData` is planned empty.
 * Written as one object literal typed `ProfileData` for the reason
 * `planForeignImport`'s pass 2 is: a member added to that interface later fails
 * to compile here rather than silently arriving absent.
 */
export function translateApkg(parsed: ParsedApkg, target: ApkgTranslateTarget): ApkgTranslation {
  const skips = new SkipLedger();
  const notetypes = new Map(parsed.notetypes.map((notetype) => [notetype.id, notetype]));
  const deckNames = new Map(parsed.decks.map((deck) => [deck.id, deck.name]));
  const notes = new Map(parsed.notes.map((note) => [note.id, note]));

  // Every media entry the manifest declared is a file this import does not
  // carry, on exactly the terms an `<img>` inside a field is one. Counted
  // together, because "koliko slika i zvukova ne stiže" is one question.
  skips.add("media-stripped", parsed.mediaCount);

  // One pass over the cards, grouped by their note: a note's cards decide how
  // many rows it produces (basic) and which decks they land in (both kinds).
  const cardsByNote = new Map<number, ApkgCard[]>();
  for (const card of parsed.cards) {
    if (!notes.has(card.noteId)) {
      skips.add("card-without-note");
      continue;
    }
    const bucket = cardsByNote.get(card.noteId);
    if (bucket === undefined) cardsByNote.set(card.noteId, [card]);
    else bucket.push(card);
  }
  for (const bucket of cardsByNote.values()) bucket.sort((a, b) => a.ord - b.ord);

  const scheduling = freshCardScheduling(target.now);
  const cards: ExportCard[] = [];
  const usedDeckIds = new Set<number>();
  let notesWithCards = 0;

  const deckSourceId = (ankiDeckId: number): string => `apkg:deck:${ankiDeckId}`;
  const cardSourceId = (noteId: number, ordinal: number): string => `apkg:card:${noteId}:${ordinal}`;

  for (const note of parsed.notes) {
    const notetype = notetypes.get(note.notetypeId);
    if (notetype === undefined) {
      skips.add("unknown-notetype");
      continue;
    }
    const noteCards = cardsByNote.get(note.id) ?? [];
    // A note with no card at all is a note Anki itself shows nowhere. It is not
    // an error and not a loss worth its own line — it simply has nothing to
    // become — but a note whose cards all name unknown decks IS a loss, and the
    // deck check below names it.
    if (noteCards.length === 0) continue;

    const stripped = note.fields.map(stripAnkiHtml);
    for (const field of stripped) skips.add("media-stripped", field.images + field.sounds);
    if (note.tags.length > 0) skips.add("tags-dropped");
    if (noteCards.some((card) => card.reps > 0 || card.suspended)) skips.add("history-dropped");

    const emit: EmitContext = {
      profileId: target.profileId,
      cardSourceId,
      deckSourceId,
      usedDeckIds,
    };
    const before = cards.length;
    if (notetype.kind === "cloze") {
      translateClozeNote(note, stripped, noteCards, deckNames, skips, scheduling, cards, emit);
    } else {
      translateBasicNote(
        note,
        stripped,
        noteCards,
        notetype,
        deckNames,
        skips,
        scheduling,
        cards,
        emit,
      );
    }
    if (cards.length > before) notesWithCards += 1;
  }

  const decks: ExportDeck[] = [];
  for (const deck of parsed.decks) {
    if (!usedDeckIds.has(deck.id)) {
      // A deck nothing landed in is not created: an import that added a dozen
      // empty decks to somebody's study page would be noise, not data.
      skips.add("empty-deck");
      continue;
    }
    decks.push({
      id: deckSourceId(deck.id),
      profileId: target.profileId,
      subjectId: APKG_SUBJECT_SOURCE_ID,
      name: flattenDeckName(deck.name),
      createdAt: target.now,
      updatedAt: target.now,
    });
  }

  const subjects: ExportSubject[] =
    target.subject.kind === "new"
      ? [
          {
            id: APKG_SUBJECT_SOURCE_ID,
            profileId: target.profileId,
            name: target.subject.name,
            color: IMPORT_SUBJECT_COLOR,
            semester: null,
            archived: false,
            createdAt: target.now,
            updatedAt: target.now,
          },
        ]
      : [];
  // The seam that lets an EXISTING subject own the imported decks without this
  // module ever knowing a real id's shape: the planner pre-populates its id map
  // with this one entry and mints nothing for it (`ForeignImportTarget.seededIds`).
  const seededIds =
    target.subject.kind === "existing"
      ? new Map([[APKG_SUBJECT_SOURCE_ID, target.subject.id]])
      : new Map<string, string>();

  const data: ProfileData = {
    tasks: [],
    taskLists: [],
    taskSections: [],
    taskTags: [],
    taskTagLinks: [],
    taskAttachments: [],
    taskTemplates: [],
    taskDependencies: [],
    events: [],
    eventTemplates: [],
    documents: [],
    renewals: [],
    people: [],
    calendarSettings: [],
    subjects,
    subjectAttachments: [],
    subjectNoteLinks: [],
    exams: [],
    decks,
    cards,
    // No history crosses (see the module header), so there is nothing to log.
    reviewLog: [],
    // An .apkg carries decks and cards, never an exam's curriculum (ADR-063).
    examTopics: [],
    plans: [],
    blocks: [],
    focusSessions: [],
    studySettings: [],
    notifications: [],
    notes: [],
    noteFolders: [],
    noteTags: [],
    noteTagLinks: [],
    noteTemplates: [],
    noteAttachments: [],
    noteVersions: [],
    dashboardSettings: [],
    dashboardSets: [],
    dashboardWidgets: [],
  };

  return {
    data,
    seededIds,
    report: {
      decks: decks.length,
      notes: notesWithCards,
      cards: cards.length,
      skips: skips.toReport(),
    },
  };
}

/** `Fakultet::Biologija::Ćelija` → `Fakultet / Biologija / Ćelija`. Nexus decks are flat, so the path becomes the name rather than being thrown away — two decks called „Ćelija" under different parents must still be two names a user can tell apart. */
function flattenDeckName(name: string): string {
  return name
    .split("::")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(DECK_PATH_SEPARATOR);
}

/** The id helpers, the target profile and the deck-usage set, passed as one value so the two note translators cannot drift in how they name a row. */
interface EmitContext {
  profileId: string;
  cardSourceId: (noteId: number, ordinal: number) => string;
  deckSourceId: (ankiDeckId: number) => string;
  usedDeckIds: Set<number>;
}

/**
 * A basic note: one Nexus card per Anki card, which is one per TEMPLATE.
 *
 * Ordinal 0 is the note's own two fields in order; ordinal 1 is them swapped,
 * which is what Anki's stock "Basic (and reversed card)" renders and the one
 * convention this import is willing to rely on. Anything beyond that is a
 * template whose question and answer are written in Anki's own rendering
 * language, over fields this import has no mapping for — so it is refused by
 * name rather than rendered as a guess.
 */
function translateBasicNote(
  note: ApkgNote,
  stripped: readonly AnkiFieldText[],
  noteCards: readonly ApkgCard[],
  notetype: ApkgNotetype,
  deckNames: ReadonlyMap<number, string>,
  skips: SkipLedger,
  scheduling: ReturnType<typeof freshCardScheduling>,
  out: ExportCard[],
  ctx: EmitContext,
): void {
  const front = stripped[0]?.text ?? "";
  const back = stripped[1]?.text ?? "";
  if (front.length === 0) {
    skips.add("empty-note");
    return;
  }
  if (stripped.slice(2).some((field) => field.text.length > 0)) skips.add("extra-fields-dropped");

  for (const card of noteCards) {
    if (card.ord > 1 || card.ord >= notetype.templateCount) {
      skips.add("template-unsupported");
      continue;
    }
    if (!deckNames.has(card.deckId)) {
      skips.add("unknown-deck");
      continue;
    }
    ctx.usedDeckIds.add(card.deckId);
    out.push({
      id: ctx.cardSourceId(note.id, card.ord),
      profileId: ctx.profileId,
      deckId: ctx.deckSourceId(card.deckId),
      front: card.ord === 1 ? back : front,
      back: card.ord === 1 ? front : back,
      sourceNoteId: null,
      sourceBlockKey: null,
      kind: "basic",
      clozeText: null,
      clozeOrdinal: null,
      problemSteps: null,
      ...scheduling,
    });
  }
}

/**
 * A cloze note: one Nexus card per DELETION of the canonical template, not per
 * Anki card. The two normally agree exactly — Anki makes one card per `cN` — but
 * the template is the authority here, because it is what the row stores and
 * what `renderClozeCard` derives the sides from. A card Anki had for a deletion
 * the text no longer contains would otherwise arrive asking about nothing.
 *
 * The sides are rendered by core's OWN `renderClozeCard`, the same function
 * `CardStore` re-derives them with on every edit, so an imported cloze card and
 * a hand-written one are the same row in every respect the moment they land.
 */
function translateClozeNote(
  note: ApkgNote,
  stripped: readonly AnkiFieldText[],
  noteCards: readonly ApkgCard[],
  deckNames: ReadonlyMap<number, string>,
  skips: SkipLedger,
  scheduling: ReturnType<typeof freshCardScheduling>,
  out: ExportCard[],
  ctx: EmitContext,
): void {
  const text = stripped[0]?.text ?? "";
  if (text.length === 0) {
    skips.add("empty-note");
    return;
  }
  if (stripped.slice(1).some((field) => field.text.length > 0)) skips.add("extra-fields-dropped");

  const canonical = canonicalizeCloze(text);
  if (!canonical.ok) {
    skips.add(canonical.reason);
    return;
  }
  skips.add("cloze-hint-dropped", canonical.value.hintsDropped);

  // Which deck each deletion lands in: the deck of the Anki card that asked
  // that very deletion when there is one (a cloze note's siblings CAN sit in
  // different decks), otherwise the note's first card's deck.
  const deckByPosition = new Map<number, number>();
  for (const card of noteCards) {
    const position = canonical.value.positionByAnkiNumber.get(card.ord + 1);
    if (position !== undefined && !deckByPosition.has(position)) {
      deckByPosition.set(position, card.deckId);
    }
  }
  const fallbackDeckId = noteCards[0]?.deckId;
  if (fallbackDeckId === undefined) return;

  const template = canonical.value.template;
  const deletions = findClozeRuns(template).length;
  for (let position = 0; position < deletions; position += 1) {
    const deckId = deckByPosition.get(position) ?? fallbackDeckId;
    if (!deckNames.has(deckId)) {
      skips.add("unknown-deck");
      continue;
    }
    const rendered = renderClozeCard(template, position);
    // Unreachable: `canonicalizeCloze` already proved every position renders.
    // Kept because `renderClozeCard`'s null is the contract, and a silent
    // `?? ""` here would write a blank card rather than say so.
    if (rendered === null) {
      skips.add("cloze-unrepresentable");
      continue;
    }
    ctx.usedDeckIds.add(deckId);
    out.push({
      id: ctx.cardSourceId(note.id, position),
      profileId: ctx.profileId,
      deckId: ctx.deckSourceId(deckId),
      front: rendered.front,
      back: rendered.back,
      sourceNoteId: null,
      sourceBlockKey: null,
      kind: "cloze",
      clozeText: template,
      clozeOrdinal: position,
      problemSteps: null,
      ...scheduling,
    });
  }
}
