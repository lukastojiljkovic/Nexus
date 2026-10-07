import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { findClozeRuns, renderClozeCard } from "../study/clozeText.js";
import { growthToFull, LINEAR_GROWTH } from "../testing/growth.js";
import {
  ankiNotetypeKind,
  APKG_SKIP_CODES,
  APKG_SUBJECT_SOURCE_ID,
  canonicalizeCloze,
  stripAnkiHtml,
  translateApkg,
  type ApkgSkipCode,
  type ParsedApkg,
} from "./ankiTranslate.js";
import { ProtoWalkError } from "./protoWalk.js";

/** Every skip the report names, as a plain map — the shape assertions read against. */
function skipMap(skips: readonly { code: ApkgSkipCode; count: number }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const skip of skips) counts[skip.code] = skip.count;
  return counts;
}

const NOW = "2026-07-31T10:00:00.000Z";

/** The smallest collection that translates to something: one deck, one basic notetype, one note, one card. */
function minimalApkg(overrides: Partial<ParsedApkg> = {}): ParsedApkg {
  return {
    decks: [{ id: 1, name: "Biologija" }],
    notetypes: [{ id: 10, name: "Basic", kind: "basic", templateCount: 1 }],
    notes: [{ id: 100, notetypeId: 10, fields: ["Prednja", "Zadnja"], tags: [] }],
    cards: [{ noteId: 100, ord: 0, deckId: 1, reps: 0, suspended: false }],
    mediaCount: 0,
    ...overrides,
  };
}

describe("stripAnkiHtml", () => {
  it("strips tags and keeps the text between them", () => {
    expect(stripAnkiHtml("<b>Mitohondrija</b> je <i>organela</i>").text).toBe(
      "Mitohondrija je organela",
    );
  });

  it("turns block tags into newlines and inline tags into nothing", () => {
    expect(stripAnkiHtml("prvi<br>drugi<div>treći</div>").text).toBe("prvi\ndrugi\ntreći");
    expect(stripAnkiHtml("<p>a</p><p>b</p>").text).toBe("a\nb");
    expect(stripAnkiHtml("<ul><li>a</li><li>b</li></ul>").text).toBe("a\nb");
    expect(stripAnkiHtml("a<span>b</span>c").text).toBe("abc");
  });

  it("decodes the standard entities and leaves a broken one alone", () => {
    expect(stripAnkiHtml("&amp;&lt;&gt;&quot;&#39;&apos;").text).toBe(`&<>"''`);
    expect(stripAnkiHtml("&#65;&#x42;").text).toBe("AB");
    // No semicolon, an unknown name, an empty numeric — none of these is an
    // entity, and inventing a decoding for them would corrupt the text.
    expect(stripAnkiHtml("&amp &nosuch; &#; 5 &lt 6").text).toBe("&amp &nosuch; &#; 5 &lt 6");
  });

  it("decodes an entity AFTER stripping tags, so an encoded tag can never become one", () => {
    // The classic smuggle: `&lt;script&gt;` must survive as visible text, never
    // be re-read as markup.
    expect(stripAnkiHtml("&lt;script&gt;alert(1)&lt;/script&gt;").text).toBe(
      "<script>alert(1)</script>",
    );
  });

  it("removes a script or style block together with its contents", () => {
    expect(stripAnkiHtml("pre<script>alert(1)</script>post").text).toBe("prepost");
    expect(stripAnkiHtml("pre<style>body{color:red}</style>post").text).toBe("prepost");
    expect(stripAnkiHtml("<script src='x'>\nmulti\nline\n</script>ostalo").text).toBe("ostalo");
  });

  it("counts images and sounds, and removes both from the text", () => {
    const stripped = stripAnkiHtml('pre<img src="a.png">mid[sound:b.mp3]post<img src="c.jpg"/>');
    expect(stripped.text).toBe("premidpost");
    expect(stripped.images).toBe(2);
    expect(stripped.sounds).toBe(1);
  });

  it("keeps $…$ and rewrites the two MathJax spellings into it", () => {
    expect(stripAnkiHtml("vrednost $x^2$ ovde").text).toBe("vrednost $x^2$ ovde");
    expect(stripAnkiHtml("vrednost \\(x^2\\) ovde").text).toBe("vrednost $x^2$ ovde");
    expect(stripAnkiHtml("blok \\[x^2\\] ovde").text).toBe("blok $x^2$ ovde");
    expect(stripAnkiHtml("<anki-mathjax>x^2</anki-mathjax>").text).toBe("$x^2$");
    expect(stripAnkiHtml('<anki-mathjax block="true">x^2</anki-mathjax>').text).toBe("$x^2$");
  });

  it("collapses whitespace and trims, &nbsp; included", () => {
    expect(stripAnkiHtml("  a   \t b &nbsp; c  ").text).toBe("a b c");
    expect(stripAnkiHtml("a<br><br><br>b").text).toBe("a\nb");
    expect(stripAnkiHtml("<div>  </div>").text).toBe("");
  });

  it("survives deeply nested and unbalanced tags without hanging", () => {
    const nested = `${"<div>".repeat(500)}jezgro${"</div>".repeat(500)}`;
    expect(stripAnkiHtml(nested).text).toBe("jezgro");
    expect(stripAnkiHtml("<b><i>a</b> nezatvoreno <").text).toBe("a nezatvoreno <");
    expect(stripAnkiHtml("<>< ><b >x</b >").text).toBe("<>< >x");
  });

  it("handles a field at the per-field cap in linear time", () => {
    // 256 KiB of alternating markup and text: any regex that backtracked would
    // never finish this, which is exactly what the assertion proves.
    const huge = "<b>a</b>&amp;".repeat(20_000);
    const started = Date.now();
    const stripped = stripAnkiHtml(huge);
    expect(stripped.text.length).toBe(40_000);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("canonicalizeCloze", () => {
  it("keeps Anki's own cN numbers, whatever order they appear in", () => {
    const result = canonicalizeCloze("Glavni grad je {{c2::Beograd}}, a reka je {{c1::Sava}}.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Since ADR-068 a Nexus deletion's number IS its label, so the note crosses
    // over spelled exactly as its author wrote it — c2 first, c1 second.
    expect(result.value.template).toBe(
      "Glavni grad je {{c2::Beograd}}, a reka je {{c1::Sava}}.",
    );
    expect(result.value.numbers).toEqual([1, 2]);
    expect(result.value.hintsDropped).toBe(0);
  });

  it("drops a hint and counts it", () => {
    const result = canonicalizeCloze("{{c1::Sava::reka}} i {{c2::Dunav::reka}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.template).toBe("{{c1::Sava}} i {{c2::Dunav}}");
    expect(result.value.hintsDropped).toBe(2);
  });

  it("carries the same cN twice as ONE card with two blanks", () => {
    const result = canonicalizeCloze("{{c1::a}} i {{c1::b}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.template).toBe("{{c1::a}} i {{c1::b}}");
    expect(result.value.numbers).toEqual([1]);
    expect(renderClozeCard(result.value.template, 1)?.front).toBe("[…] i […]");
  });

  it("refuses a nested deletion", () => {
    const result = canonicalizeCloze("{{c1::spolja {{c2::iznutra}} kraj}}");
    expect(result).toEqual({ ok: false, reason: "cloze-nested" });
  });

  it("refuses a cloze note with no deletion at all", () => {
    expect(canonicalizeCloze("obična rečenica")).toEqual({
      ok: false,
      reason: "cloze-no-deletions",
    });
    // `{{c1}}` with no `::` is not a deletion either — it is not the grammar.
    expect(canonicalizeCloze("{{c1}}")).toEqual({ ok: false, reason: "cloze-no-deletions" });
  });

  it("refuses text the Nexus grammar cannot express", () => {
    // A brace inside the deletion would break `{{…}}`'s own `[^{}]*` run.
    expect(canonicalizeCloze("{{c1::a}b}}")).toEqual({
      ok: false,
      reason: "cloze-unrepresentable",
    });
    // An empty deletion renders no run at all, so a card Anki had would be
    // missing from the set that arrives.
    expect(canonicalizeCloze("{{c1::}} i {{c2::b}}")).toEqual({
      ok: false,
      reason: "cloze-unrepresentable",
    });
    // Surrounding text carrying its own `{{…}}` run would add a deletion the
    // note never asked for.
    expect(canonicalizeCloze("{{c1::a}} plus {{ručno}}")).toEqual({
      ok: false,
      reason: "cloze-unrepresentable",
    });
  });

  it("accepts a cN above 9 and refuses c0", () => {
    const high = canonicalizeCloze("{{c12::a}} {{c3::b}}");
    expect(high.ok).toBe(true);
    if (high.ok) expect(high.value.numbers).toEqual([3, 12]);
    const zero = canonicalizeCloze("{{c0::a}}");
    expect(zero).toEqual({ ok: false, reason: "cloze-no-deletions" });
  });

  it("refuses a label this grammar cannot read back, rather than shipping it as answer text", () => {
    // Seven digits is past the label cap, so core would read `c1234567::a` as
    // the ANSWER of an unlabelled run — a card asking something the author
    // never wrote. The self-check catches it by construction.
    expect(canonicalizeCloze("{{c1234567::a}}")).toEqual({
      ok: false,
      reason: "cloze-unrepresentable",
    });
  });

  it("produces a template every deletion of which core's own renderer can render", () => {
    const result = canonicalizeCloze("{{c1::A}} {{c2::B}} {{c3::C}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runs = findClozeRuns(result.value.template);
    expect(runs).toHaveLength(3);
    for (const number of result.value.numbers) {
      expect(renderClozeCard(result.value.template, number)).not.toBeNull();
    }
  });
});

describe("ankiNotetypeKind", () => {
  it("reads KIND_CLOZE from the config's field 1", () => {
    // Tag 0x08 = field 1, wire type 0; varint 1 = KIND_CLOZE.
    expect(ankiNotetypeKind(Uint8Array.from([0x08, 0x01]))).toBe("cloze");
  });

  it("reads an absent kind as KIND_NORMAL — proto3 omits a zero enum from the wire", () => {
    expect(ankiNotetypeKind(new Uint8Array(0))).toBe("basic");
  });

  it("reads an explicit zero as KIND_NORMAL all the same", () => {
    expect(ankiNotetypeKind(Uint8Array.from([0x08, 0x00]))).toBe("basic");
  });

  it("finds the kind among the config's other fields, skipping what it does not read", () => {
    // A realistic Config: sort_field_idx (field 2, varint), css (field 3,
    // length-delimited), THEN kind — out of Anki's own order on purpose, to
    // prove position carries no meaning.
    const css = Uint8Array.from(Buffer.from(".card { }", "utf8"));
    const config = Uint8Array.from([0x10, 0x01, 0x1a, css.length, ...css, 0x08, 0x01]);
    expect(ankiNotetypeKind(config)).toBe("cloze");
  });

  it("lets the last occurrence win, as proto3's own merge rule does", () => {
    expect(ankiNotetypeKind(Uint8Array.from([0x08, 0x01, 0x08, 0x00]))).toBe("basic");
  });

  it("answers null for a kind value this build does not know, rather than guessing", () => {
    expect(ankiNotetypeKind(Uint8Array.from([0x08, 0x02]))).toBeNull();
  });

  it("lets a malformed config's walk error through — the reader decides what refusal that is", () => {
    expect(() => ankiNotetypeKind(Uint8Array.from([0x80]))).toThrow(ProtoWalkError);
  });
});

describe("translateApkg", () => {
  it("builds one deck, one card and a subject row when a new subject is named", () => {
    const { data, seededIds, report } = translateApkg(minimalApkg(), {
      profileId: "profile-1",
      subject: { kind: "new", name: "Anki uvoz" },
      now: NOW,
    });

    expect(data.subjects).toHaveLength(1);
    expect(data.subjects[0]).toMatchObject({
      id: APKG_SUBJECT_SOURCE_ID,
      profileId: "profile-1",
      name: "Anki uvoz",
      color: "jade",
      archived: false,
    });
    expect(seededIds.size).toBe(0);

    expect(data.decks).toHaveLength(1);
    expect(data.decks[0]).toMatchObject({ subjectId: APKG_SUBJECT_SOURCE_ID, name: "Biologija" });

    expect(data.cards).toHaveLength(1);
    expect(data.cards[0]).toMatchObject({
      front: "Prednja",
      back: "Zadnja",
      kind: "basic",
      clozeText: null,
      clozeOrdinal: null,
      sourceNoteId: null,
      sourceBlockKey: null,
    });
    expect(report).toMatchObject({ decks: 1, notes: 1, cards: 1 });
  });

  it("seeds the chosen subject's id instead of emitting a subject row", () => {
    const { data, seededIds } = translateApkg(minimalApkg(), {
      profileId: "profile-1",
      subject: { kind: "existing", id: "subject-live" },
      now: NOW,
    });
    expect(data.subjects).toHaveLength(0);
    expect([...seededIds]).toEqual([[APKG_SUBJECT_SOURCE_ID, "subject-live"]]);
    expect(data.decks[0]?.subjectId).toBe(APKG_SUBJECT_SOURCE_ID);
  });

  it("gives every card a fresh FSRS state at `now`, whatever the collection carried", () => {
    const { data, report } = translateApkg(
      minimalApkg({
        cards: [{ noteId: 100, ord: 0, deckId: 1, reps: 47, suspended: false }],
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    expect(data.cards[0]).toMatchObject({
      due: NOW,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReview: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(data.reviewLog).toHaveLength(0);
    expect(skipMap(report.skips)["history-dropped"]).toBe(1);
  });

  it("folds a suspended card into the history-dropped line", () => {
    const { report } = translateApkg(
      minimalApkg({
        cards: [{ noteId: 100, ord: 0, deckId: 1, reps: 0, suspended: true }],
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    expect(skipMap(report.skips)["history-dropped"]).toBe(1);
  });

  it("flattens Parent::Child and skips a deck with no card", () => {
    const { data, report } = translateApkg(
      minimalApkg({
        decks: [
          { id: 1, name: "Fakultet::Biologija::Ćelija" },
          { id: 2, name: "Prazan" },
        ],
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    expect(data.decks.map((deck) => deck.name)).toEqual(["Fakultet / Biologija / Ćelija"]);
    expect(skipMap(report.skips)["empty-deck"]).toBe(1);
  });

  it("makes two cards from a reversed note, the second with the sides swapped", () => {
    const { data } = translateApkg(
      minimalApkg({
        notetypes: [{ id: 10, name: "Basic (and reversed card)", kind: "basic", templateCount: 2 }],
        cards: [
          { noteId: 100, ord: 0, deckId: 1, reps: 0, suspended: false },
          { noteId: 100, ord: 1, deckId: 1, reps: 0, suspended: false },
        ],
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    expect(data.cards.map((card) => [card.front, card.back])).toEqual([
      ["Prednja", "Zadnja"],
      ["Zadnja", "Prednja"],
    ]);
  });

  it("refuses a third template rather than guessing what it renders", () => {
    const { data, report } = translateApkg(
      minimalApkg({
        notetypes: [{ id: 10, name: "Custom", kind: "basic", templateCount: 3 }],
        cards: [
          { noteId: 100, ord: 0, deckId: 1, reps: 0, suspended: false },
          { noteId: 100, ord: 2, deckId: 1, reps: 0, suspended: false },
        ],
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    expect(data.cards).toHaveLength(1);
    expect(skipMap(report.skips)["template-unsupported"]).toBe(1);
  });

  it("emits one row per cloze deletion, rendered by core's own renderer", () => {
    const { data, report } = translateApkg(
      minimalApkg({
        notetypes: [{ id: 10, name: "Cloze", kind: "cloze", templateCount: 1 }],
        notes: [
          {
            id: 100,
            notetypeId: 10,
            fields: ["Glavni grad je {{c2::Beograd}}, reka je {{c1::Sava::reka}}."],
            tags: [],
          },
        ],
        cards: [
          { noteId: 100, ord: 0, deckId: 1, reps: 0, suspended: false },
          { noteId: 100, ord: 1, deckId: 1, reps: 0, suspended: false },
        ],
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );

    const template = "Glavni grad je {{c2::Beograd}}, reka je {{c1::Sava}}.";
    expect(data.cards).toHaveLength(2);
    // One row per Anki cN, listed in number order — c1 is the card Anki calls
    // ord 0, wherever in the sentence it happens to sit.
    expect(data.cards.map((card) => card.clozeOrdinal)).toEqual([1, 2]);
    for (const card of data.cards) {
      expect(card.kind).toBe("cloze");
      expect(card.clozeText).toBe(template);
      const rendered = renderClozeCard(template, card.clozeOrdinal ?? -1);
      expect({ front: card.front, back: card.back }).toEqual(rendered);
    }
    expect(skipMap(report.skips)["cloze-hint-dropped"]).toBe(1);
  });

  it("collapses a repeated cN into one card with both blanks masked", () => {
    const { data, report } = translateApkg(
      minimalApkg({
        notetypes: [{ id: 10, name: "Cloze", kind: "cloze", templateCount: 1 }],
        notes: [
          { id: 100, notetypeId: 10, fields: ["{{c1::Sava}} i {{c1::Dunav}}"], tags: [] },
        ],
        cards: [{ noteId: 100, ord: 0, deckId: 1, reps: 0, suspended: false }],
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    expect(data.cards).toHaveLength(1);
    expect(data.cards[0]).toMatchObject({ clozeOrdinal: 1, front: "[…] i […]" });
    expect(report.notes).toBe(1);
  });

  it("lands each deletion in the deck of the Anki card that asked it", () => {
    const { data } = translateApkg(
      minimalApkg({
        decks: [
          { id: 1, name: "Prvi" },
          { id: 2, name: "Drugi" },
        ],
        notetypes: [{ id: 10, name: "Cloze", kind: "cloze", templateCount: 1 }],
        notes: [{ id: 100, notetypeId: 10, fields: ["{{c2::a}} i {{c1::b}}"], tags: [] }],
        cards: [
          // ord 0 is c1, ord 1 is c2 — the mapping the numbers now make direct.
          { noteId: 100, ord: 0, deckId: 2, reps: 0, suspended: false },
          { noteId: 100, ord: 1, deckId: 1, reps: 0, suspended: false },
        ],
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    expect(data.cards.map((card) => [card.clozeOrdinal, card.deckId])).toEqual([
      [1, "apkg:deck:2"],
      [2, "apkg:deck:1"],
    ]);
  });

  it("names every cloze refusal instead of importing a broken note", () => {
    const cloze = (text: string): ParsedApkg =>
      minimalApkg({
        notetypes: [{ id: 10, name: "Cloze", kind: "cloze", templateCount: 1 }],
        notes: [{ id: 100, notetypeId: 10, fields: [text], tags: [] }],
      });
    const run = (text: string): Record<string, number> =>
      skipMap(
        translateApkg(cloze(text), {
          profileId: "profile-1",
          subject: { kind: "new", name: "S" },
          now: NOW,
        }).report.skips,
      );

    expect(run("{{c1::a {{c2::b}} c}}")["cloze-nested"]).toBe(1);
    expect(run("bez ijedne praznine")["cloze-no-deletions"]).toBe(1);
    expect(run("{{c1::a}b}}")["cloze-unrepresentable"]).toBe(1);
  });

  it("counts the media it strips, from the fields and from the manifest alike", () => {
    const { data, report } = translateApkg(
      minimalApkg({
        notes: [
          {
            id: 100,
            notetypeId: 10,
            fields: ['Šta je ovo? <img src="a.png">', "Ćelija [sound:c.mp3]"],
            tags: [],
          },
        ],
        mediaCount: 5,
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    expect(data.cards[0]).toMatchObject({ front: "Šta je ovo?", back: "Ćelija" });
    // Two references in the fields plus the five entries the manifest declared.
    expect(skipMap(report.skips)["media-stripped"]).toBe(7);
  });

  it("counts the Anki tags it drops and the extra fields it does not carry", () => {
    const { report } = translateApkg(
      minimalApkg({
        notes: [
          {
            id: 100,
            notetypeId: 10,
            fields: ["Prednja", "Zadnja", "Dodatno"],
            tags: ["biologija", "ispit"],
          },
        ],
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    const skips = skipMap(report.skips);
    expect(skips["tags-dropped"]).toBe(1);
    expect(skips["extra-fields-dropped"]).toBe(1);
  });

  it("names a note whose notetype, deck or content is missing", () => {
    const { data, report } = translateApkg(
      {
        decks: [{ id: 1, name: "D" }],
        notetypes: [{ id: 10, name: "Basic", kind: "basic", templateCount: 1 }],
        notes: [
          { id: 100, notetypeId: 999, fields: ["a", "b"], tags: [] },
          { id: 101, notetypeId: 10, fields: ["  ", ""], tags: [] },
          { id: 102, notetypeId: 10, fields: ["c", "d"], tags: [] },
        ],
        cards: [
          { noteId: 100, ord: 0, deckId: 1, reps: 0, suspended: false },
          { noteId: 101, ord: 0, deckId: 1, reps: 0, suspended: false },
          { noteId: 102, ord: 0, deckId: 42, reps: 0, suspended: false },
          { noteId: 777, ord: 0, deckId: 1, reps: 0, suspended: false },
        ],
        mediaCount: 0,
      },
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    const skips = skipMap(report.skips);
    expect(skips["unknown-notetype"]).toBe(1);
    expect(skips["empty-note"]).toBe(1);
    expect(skips["unknown-deck"]).toBe(1);
    expect(skips["card-without-note"]).toBe(1);
    expect(data.cards).toHaveLength(0);
    expect(data.decks).toHaveLength(0);
  });

  it("reports its skips in the declared order and never lists a zero", () => {
    const { report } = translateApkg(
      minimalApkg({
        notes: [{ id: 100, notetypeId: 10, fields: ["a", "b", "c"], tags: ["x"] }],
        cards: [{ noteId: 100, ord: 0, deckId: 1, reps: 3, suspended: false }],
      }),
      { profileId: "profile-1", subject: { kind: "new", name: "S" }, now: NOW },
    );
    const codes = report.skips.map((skip) => skip.code);
    expect(codes.every((code) => APKG_SKIP_CODES.includes(code))).toBe(true);
    expect([...codes].sort((a, b) => APKG_SKIP_CODES.indexOf(a) - APKG_SKIP_CODES.indexOf(b))).toEqual(
      codes,
    );
    expect(report.skips.every((skip) => skip.count > 0)).toBe(true);
  });

  it("leaves every module but STUDY empty — an apkg carries nothing else", () => {
    const { data } = translateApkg(minimalApkg(), {
      profileId: "profile-1",
      subject: { kind: "new", name: "S" },
      now: NOW,
    });
    expect(data.tasks).toEqual([]);
    expect(data.notes).toEqual([]);
    expect(data.events).toEqual([]);
    expect(data.taskLists).toEqual([]);
    expect(data.notifications).toEqual([]);
    expect(data.exams).toEqual([]);
    expect(data.studySettings).toEqual([]);
    expect(data.dashboardWidgets).toEqual([]);
  });
});

/**
 * The two field patterns behind #7 and #8, and the input each one was slow on.
 *
 * `stripAnkiHtml` takes a hostile Anki field straight off somebody else's disk,
 * so a pattern that re-walks the field from every candidate start is a field
 * that freezes the import. Both are pinned twice here: the values they answer,
 * which must not move, and the field built to repeat the pump, which has to
 * come back in the time a keystroke takes.
 */
describe("the field patterns walk a field once", () => {
  const PUMP = 50_000;

  it("removes every [sound:] reference, and counts them", () => {
    expect(stripAnkiHtml("[sound:a.mp3]hello[sound:b.mp3]")).toEqual({
      text: "hello",
      images: 0,
      sounds: 2,
    });
    // An empty body is still a reference...
    expect(stripAnkiHtml("[sound:]x")).toEqual({ text: "x", images: 0, sounds: 1 });
    // ...a bracket inside the body is just a character to the body...
    expect(stripAnkiHtml("[sound:a[b]after")).toEqual({ text: "after", images: 0, sounds: 1 });
    // ...and one that never closes is left exactly as it was typed.
    expect(stripAnkiHtml("[sound:never")).toEqual({
      text: "[sound:never",
      images: 0,
      sounds: 0,
    });
  });

  it("answers 50,000 [sound: repetitions without re-walking the tail", () => {
    const pump = (count: number): string => "[sound:x".repeat(count);
    expect(growthToFull(pump, stripAnkiHtml, PUMP)).toBeLessThan(LINEAR_GROWTH);
    const result = stripAnkiHtml(pump(PUMP));
    // No closing bracket anywhere, so nothing matches and nothing is removed.
    expect(result.sounds).toBe(0);
    expect(result.text).toHaveLength(PUMP * "[sound:x".length);
  });

  it("strips a script a first pass formed out of the text around it", () => {
    // #12's shape: the removal joins `<scr` and `ipt>` into a live tag.
    expect(stripAnkiHtml("<scr<script>ipt>").text).toBe("ipt>");
    expect(stripAnkiHtml("<scr<script>a</script>ipt>").text).toBe("");
    // And when a second pass finds a whole element the first one built, its
    // CONTENT goes with it - the text between the two fragments is inside
    // `<script>` by the time the strip repeats, which is the point of repeating.
    expect(stripAnkiHtml("<scr<script>a</script>ipt>x</script>").text).toBe("");
  });

  it("splits a cloze body at its FIRST ::, which is what the old two-group pattern did", () => {
    const value = (field: string) => {
      const result = canonicalizeCloze(field);
      if (!result.ok) throw new Error(result.reason);
      return result.value;
    };
    expect(value("{{c1::a::b::c}}")).toEqual({
      template: "{{c1::a}}",
      numbers: [1],
      hintsDropped: 1,
    });
    // A single colon is part of the text; only a doubled one starts a hint.
    expect(value("{{c1::a:b::c}}")).toEqual({
      template: "{{c1::a:b}}",
      numbers: [1],
      hintsDropped: 1,
    });
    expect(value("{{c1::a::}}")).toEqual({
      template: "{{c1::a}}",
      numbers: [1],
      hintsDropped: 1,
    });
    expect(value("{{c1::a}}")).toEqual({ template: "{{c1::a}}", numbers: [1], hintsDropped: 0 });
    // An empty text is the refusal the empty deletion always was, whichever
    // side of the separator it is written on.
    expect(canonicalizeCloze("{{c1::::b}}")).toEqual({
      ok: false,
      reason: "cloze-unrepresentable",
    });
  });

  it("answers 50,000 ::z repetitions after an opener without re-walking the tail", () => {
    // The exact pump #8 names: an opener the pattern cannot finish.
    const pump = (count: number): string => "{{{{c0::::" + "::z".repeat(count);
    expect(growthToFull(pump, canonicalizeCloze, PUMP)).toBeLessThan(LINEAR_GROWTH);
    expect(canonicalizeCloze(pump(PUMP)).ok).toBe(false);
  });
});

/**
 * `ANY_TAG`, `ANKI_MATHJAX`, `IMAGE_TAG` and the two MathJax spellings used to
 * be patterns, and every one of them was quadratic on a hostile field: `[^>]*`
 * cannot backtrack WITHIN one start, but the engine re-runs it from every `<`,
 * so a 256 KiB field of `<a` with no `>` spent nine seconds in the strip. The
 * scans that replaced them answer the same thing, and these cases are what says
 * so - the old patterns themselves, kept as the oracle, plus the cap each
 * reader enforces.
 *
 * The script/style step is the one that no longer answers what the pass loop
 * answered. Its contract is now the LEFTMOST complete element removed, then the
 * same again on what is left, until nothing matches, and
 * `stripScriptAndStyleReference` below is that rule written out. It is the
 * oracle for that step the way the patterns are the oracle for the others.
 */
describe("the tag steps answer what the oracle answers", () => {
  /** `ANY_TAG`'s block list, copied because the oracle below needs the old one. */
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
  const CAP = 256 * 1024;

  /**
   * The script/style contract, written out: remove the LEFTMOST complete
   * element, then do it again to what is left, until nothing matches. This is
   * not the pass-by-pass loop the pattern ran - that reached the fixed point one
   * pass at a time, which is part of what made the import quadratic - it is the
   * rule the one-walk strip has to land on.
   */
  function stripScriptAndStyleReference(text: string): string {
    for (;;) {
      const match = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/i.exec(text);
      if (match === null) return text;
      text = text.slice(0, match.index) + text.slice(match.index + match[0].length);
    }
  }

  /**
   * The steps as the oracle reads them - the patterns, except for the
   * script/style step, which is `stripScriptAndStyleReference` above - minus the
   * entity step, because the alphabets below keep `&` out and an input with no
   * `&` is one `decodeEntities` leaves exactly as it found it.
   */
  function byPattern(field: string): { text: string; images: number; sounds: number } {
    let sounds = 0;
    let text = field.replace(/\[sound:[^\]]*\]/g, () => {
      sounds += 1;
      return "";
    });
    text = stripScriptAndStyleReference(text);
    text = text.replace(
      /<anki-mathjax\b[^>]*>([\s\S]*?)<\/anki-mathjax\s*>/gi,
      (_whole, body: string) => `$${body}$`,
    );
    let images = 0;
    text = text.replace(/<img\b[^>]*>/gi, () => {
      images += 1;
      return "";
    });
    text = text.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g, (_whole, name: string) =>
      BLOCK_TAGS.has(name.toLowerCase()) ? "\n" : "",
    );
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_whole, body: string) => `$${body}$`);
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_whole, body: string) => `$${body}$`);
    text = text.replace(/[^\S\n]+/g, " ");
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return { text: lines.join("\n"), images, sounds };
  }

  const HAND_CASES = [
    "<b>x</b>",
    "<b>",
    "x</b>",
    "a<br>b",
    "</i>",
    "<>< ><b >x</b >",
    "<ab_cd>",
    "<a-_>",
    "<script>x</scr<style></style>ipt>",
    "<script>x</scr<script></script>ipt>",
    "<style>a</styl<style></style>e>",
    "</scri<script></script>pt>",
    "<a->x</a->",
    "<SCRIPT >x</SCRIPT\n>",
    "<script >x</script   >",
    "<style\t>x</style\n>",
    "<scr<script>ipt>",
    "<scr<script>a</script>ipt>x</script>",
    "<scr<style>x</style>ript>",
    "<script><script>x</script>",
    "<script src='x'>\nmulti\nline\n</script>ostalo",
    // Case (a): the removal joins the closer for an opener the walk has already
    // passed. The first is #12's own shape; the second splits the closer over
    // two removals (`</sc` + `r` + `ipt>`); the last is the same on the other
    // name.
    "<script>x</scr<style></style>ipt>",
    "<script>x</sc<style></style>r<style></style>ipt>",
    "<style>x</sty<script></script>le>ipt>",
    // A built closer that comes before the waiting opener's `>`: the opener is
    // `<script x </script>` (its `>` was inside the removed `<style>` element),
    // so the closer the join built belongs to no opener and nothing is removed.
    "<script x </scr<style></style>ipt>",
    // A waiting opener whose `>` lay inside the removed span: the `<script x `
    // opener's `>` was the removed `<style>` element's own `>`.
    "<script x <style></style>/script>",
    // Both names waiting at once (nothing matches, and the walk returns the
    // field it was given), and whitespace and case inside the built closer.
    "<script>x<style>y",
    "<script>x</scr<style></style>ipt  \n >",
    "<SCRIPT>x</SCR<style></style>IPT>",
    "<ScRiPt>x</ScR<style></style>iPt>",
    "<anki-mathjax>x^2</anki-mathjax>",
    "<anki-mathjax>x^2</anki-mathjax><anki-mathjax>y",
    "<ANKI-MATHJAX >x</ANKI-MATHJAX   >",
    "pre<img src='a.png'>mid[sound:b.mp3]post<img src='c.jpg'/>",
    "<img",
    "\\(",
    "\\[x^2\\]",
    "a\\(x\\)b\\[y\\]c",
    "\\(",
    "x\\\\)y",
    "<",
    ">>",
    "<script",
    "</script>",
  ];

  it("matches the oracle on the hand cases, nested and unclosed included", () => {
    for (const field of HAND_CASES) {
      expect(stripAnkiHtml(field), field).toEqual(byPattern(field));
    }
  });

  it("matches it on a few thousand seeded random fields", () => {
    const pool = [
      "<", ">", "/", "script", "style", "SCRIPT", "STYLE", "img", "IMG", "anki-mathjax",
      "div", "b", "br", "a", "-", "_", " ", "\t", "\n", "=", '"', "'", "x", "1", "\\(",
      "\\)", "\\[", "\\]", "[sound:", "]", "::", "<scr", "ipt>",
    ];
    let state = 20261007;
    const random = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    for (let round = 0; round < 2_000; round += 1) {
      let field = "";
      const parts = Math.floor(random() * 22);
      for (let part = 0; part < parts; part += 1) {
        field += pool[Math.floor(random() * pool.length)] ?? "";
      }
      expect(stripAnkiHtml(field), JSON.stringify(field)).toEqual(byPattern(field));
    }
  });

  it("strips the field at the reader's cap in linear time", () => {
    const prefixes = [
      "<a",
      "<a ",
      "</d",
      "<script ",
      "<script>",
      "<style x",
      "<anki-mathjax",
      "<anki-mathjax>",
      "<img ",
      "<img>",
      "\\(",
      "\\[",
    ];
    for (const prefix of prefixes) {
      const fill = (size: number): string => prefix.repeat(Math.floor(size / prefix.length));
      // A pattern here spent one to nine SECONDS on the same input, and grew
      // some 250-fold from a sixteenth of the field to all of it.
      expect(growthToFull(fill, stripAnkiHtml, CAP), `${prefix} to the cap`).toBeLessThan(
        LINEAR_GROWTH,
      );
      const field = fill(CAP);
      expect(stripAnkiHtml(field).text.length).toBeLessThanOrEqual(field.length);
    }
  }, 60_000);

  /**
   * The shapes that took the old fallback route - a join that builds the closer
   * for an opener the walk has already passed (case (a)), and the walk
   * re-scanning for `>` from every start - plus a 15 000-level join chain behind
   * an unclosed `<style>`. Each is timed up to the cap, and each also runs against
   * the oracle on a copy a few KiB long: the oracle re-reads the field from the
   * start once per removal, so the chain and the repeated case-(a) shape are far
   * too slow to compare at the cap.
   */
  it("strips every shape that took the fallback at the cap", () => {
    const pad = (unit: string, room: number): string =>
      unit.repeat(Math.max(0, Math.floor(room / unit.length)));
    const chain = (levels: number): string => {
      let inner = "<scr<script>x</script>ipt>";
      for (let level = 1; level < levels; level += 1) inner = `<scr${inner}ipt></script>`;
      return inner;
    };
    const CASE_A = "<script>x</scr<style></style>ipt>";
    const shapes: Record<string, (size: number) => string> = {
      fallbackTail: (size) => `<script><style></style>${pad("<script ", size - 24)}`,
      fallbackHead: (size) => pad("<script ", size - 24) + "<script><style></style>",
      fallbackLazy: (size) => `<script><style></style>${pad("<style>", size - 24)}`,
      walkGtScan: (size) => `${pad("<script ", size - 1)}>`,
      chainBehindStyle: (size) =>
        `<style>${chain(Math.min(15_000, Math.max(1, Math.floor(size / 8)))).padEnd(size - 7, "z")}`,
      caseARepeat: (size) => CASE_A.repeat(Math.floor(size / CASE_A.length)),
      // The kept text is what these six attack: a removal leaves a longer
      // whitespace run, or a longer kept prefix, for the next join to read.
      spaceRun10: (size) => pad("          <style></style>", size),
      spaceRun: (size) => pad(" <style></style>", size),
      closerHeadSpaces: (size) => `</script${pad(" <style></style>", size - 8)}`,
      prefixThenCaseA: (size) => "a".repeat(size / 2) + pad(CASE_A, size / 2),
      prefixThenCaseA34: (size) => "a".repeat((size * 3) / 4) + pad(CASE_A, size / 4),
      interleaved: (size) => pad("xxxxxxxxxxxxxxxxxxxx<style></style>", size),
      // The three below read one loop of the walk over and over: truncating a
      // long kept prefix behind every case-(a) join, walking back over a
      // whitespace run that grows by 256 per removal, and re-deriving a
      // swallowed waiting opener's `>` from the raw field on each removal.
      caseAUnderPrefix: (size) =>
        "a".repeat(Math.floor(size / 4)) + pad(CASE_A, size - Math.floor(size / 4)),
      longSpaceRun: (size) => pad(`${" ".repeat(256)}<style></style>`, size),
      stolenGtOpeners: (size) => pad("<script a=<style></style>>", size),
    };
    const SMALL = 4 * 1024;
    for (const [name, shape] of Object.entries(shapes)) {
      expect(growthToFull(shape, stripAnkiHtml, CAP), `${name} to the cap`).toBeLessThan(
        LINEAR_GROWTH,
      );
      const field = shape(CAP);
      expect(stripAnkiHtml(field).text.length).toBeLessThanOrEqual(field.length);
      const small = shape(SMALL);
      expect(stripAnkiHtml(small), `${name} at ${String(small.length)} chars`).toEqual(byPattern(small));
    }
  }, 60_000);

  it("settles a chain of joins, agreeing with the leftmost rule", () => {
    // #12's own shape: a removal joins the text on either side into the element
    // AROUND it, so a pass per level - which is what the loop did - cost a walk of
    // the whole field per level: fifteen thousand of them took 76 seconds. The
    // walk reaches the same fixed point in one pass, so the depth here is the real
    // one, and a smaller field holds proportionally fewer levels.
    const chain = (size: number): string => {
      let text = "<scr<script>x</script>ipt>";
      const levels = Math.round((15_000 * size) / CAP);
      for (let level = 1; level < levels; level += 1) text = `<scr${text}ipt></script>`;
      return text.padEnd(size, "z");
    };
    expect(growthToFull(chain, stripAnkiHtml, CAP)).toBeLessThan(LINEAR_GROWTH);
    const field = chain(CAP);
    expect(stripAnkiHtml(field)).toEqual(byPattern(field));
  }, 60_000);

  /**
   * The tokens the strip has to get right, plus arbitrary fragments. `&` is
   * filtered out of the fragments because the oracle is the patterns minus the
   * entity step (see `byPattern`), and a fragment that happens to spell `&amp;`
   * would compare `decodeEntities` against no `decodeEntities`.
   */
  const FIELD_TOKENS = [
    "<", ">", "/", "</", "script", "SCRIPT", "style", "Style", "<scr", "ipt>", "</scr", "<sty",
    "le>", "</sty", " ", "\t", "\n", "=", '"', "'", "x", "img", "anki-mathjax", "div", "br",
    "[sound:", "]", "\\(", "\\)", "\\[", "\\]",
  ];
  const fieldTokens = fc
    .array(
      fc.oneof(
        fc.constantFrom(...FIELD_TOKENS),
        fc.string({ maxLength: 12 }).map((fragment) => fragment.replace(/&/g, "#")),
      ),
      { maxLength: 40 },
    )
    .map((parts) => parts.join(""));

  it("matches the oracle on fields built from the tokens that matter", () => {
    fc.assert(
      fc.property(fieldTokens, (field) => {
        expect(stripAnkiHtml(field), JSON.stringify(field)).toEqual(byPattern(field));
      }),
      { numRuns: 500 },
    );
  });

  it("never answers a longer text than the field it was given", () => {
    fc.assert(
      fc.property(fieldTokens, (field) => {
        expect(stripAnkiHtml(field).text.length).toBeLessThanOrEqual(field.length);
      }),
      { numRuns: 500 },
    );
  });

  /*
   * The third property this brief asks for - the strip leaves no complete
   * element behind, so running the reference on its output changes nothing -
   * is deliberately NOT asserted here, because neither route the public surface
   * offers is sound.
   *
   * `stripAnkiHtml`'s output is not a view of the strip step. The steps after it
   * remove `<script>`/`<style>` tags whether the strip removed them or not, they
   * can FABRICATE a complete element out of characters the strip correctly left
   * as text - `"<<" + "<anki-mathjax>" + "script>x</" + "<anki-mathjax>" +
   * "script>"` comes out of `stripTags` as `<script>x</script>` - and
   * `decodeEntities` turns `&lt;script&gt;` back into one on purpose. So a
   * "reference changes nothing" assertion on that output would fail on inputs
   * the strip itself handled exactly right. The strip function is not exported,
   * and a test-only export in production is exactly what the brief forbids.
   *
   * The fixed point is instead pinned where it is observable: every generated
   * field must equal the ORACLE's answer exactly (the property above), and the
   * oracle applies the reference to the same field - a complete element left
   * anywhere that survives to the output would diverge from it. The exhaustive
   * differential run for this change (every sequence of up to five tokens drawn
   * from `<script>`, `<style>`, their closers and the split spellings) pins the
   * same thing on the strip step itself, for every short shape there is.
   */
});
