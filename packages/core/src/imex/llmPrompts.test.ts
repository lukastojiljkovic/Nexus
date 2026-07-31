import { describe, expect, it } from "vitest";

import {
  buildLlmPrompt,
  LLM_DECK_SOURCE_ID,
  LLM_ENVELOPE_VERSION,
  LLM_IMPORT_KINDS,
  LLM_MAX_ANSWER_LENGTH,
  LLM_MAX_RECORDS,
  LLM_MAX_TEXT_LENGTH,
  LLM_PROMPT_LANGUAGES,
  LLM_SUBJECT_SOURCE_ID,
  parseLlmAnswer,
  translateLlmRecords,
  type LlmImportKind,
  type LlmRecords,
} from "./llmPrompts.js";

const NOW = "2026-07-31T09:00:00.000Z";

/** Every fenced ```json block in a prompt, in order — what the few-shot examples are written as. */
function fencedJson(prompt: string): string[] {
  return [...prompt.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
}

/** Every JSON key mentioned anywhere in a prompt. The keys are English in both languages, so two prompts of one kind must produce the identical set. */
function jsonKeys(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(/"([A-Za-z][A-Za-z0-9-]*)":/g)].map((m) => m[1] ?? ""))].sort();
}

function envelope(kind: LlmImportKind, records: unknown[]): string {
  return JSON.stringify({ "nexus-llm": "1", kind, records });
}

describe("buildLlmPrompt", () => {
  it("is deterministic", () => {
    for (const kind of LLM_IMPORT_KINDS) {
      for (const language of LLM_PROMPT_LANGUAGES) {
        expect(buildLlmPrompt(kind, language)).toBe(buildLlmPrompt(kind, language));
      }
    }
  });

  it("names the envelope, its version and its own kind in every prompt", () => {
    for (const kind of LLM_IMPORT_KINDS) {
      for (const language of LLM_PROMPT_LANGUAGES) {
        const prompt = buildLlmPrompt(kind, language);
        expect(prompt).toContain(`"nexus-llm": "${LLM_ENVELOPE_VERSION}"`);
        expect(prompt).toContain(`"kind": "${kind}"`);
        expect(prompt).toContain('"records"');
        expect(prompt).toContain(String(LLM_MAX_RECORDS));
      }
    }
  });

  it("spells the answer-only instruction in each language", () => {
    for (const kind of LLM_IMPORT_KINDS) {
      expect(buildLlmPrompt(kind, "sr")).toContain("Odgovori ISKLJUČIVO JSON-om");
      expect(buildLlmPrompt(kind, "en")).toContain("Reply with ONLY the JSON");
    }
  });

  it("writes the Serbian prompt in Serbian and the English one in English", () => {
    const sr = buildLlmPrompt("tasks", "sr");
    const en = buildLlmPrompt("tasks", "en");
    expect(sr).toContain("Zadatak");
    expect(sr).not.toContain("Reply with ONLY the JSON");
    expect(en).toContain("task");
    expect(en).not.toContain("Odgovori ISKLJUČIVO JSON-om");
  });

  it("names the identical field set in both languages", () => {
    for (const kind of LLM_IMPORT_KINDS) {
      expect(jsonKeys(buildLlmPrompt(kind, "sr"))).toEqual(jsonKeys(buildLlmPrompt(kind, "en")));
    }
  });

  it("names exactly its own kind's fields and no other kind's", () => {
    const tasks = jsonKeys(buildLlmPrompt("tasks", "sr"));
    expect(tasks).toContain("title");
    expect(tasks).toContain("dueDate");
    expect(tasks).toContain("priority");
    expect(tasks).toContain("description");
    expect(tasks).not.toContain("startAt");
    expect(tasks).not.toContain("front");

    const events = jsonKeys(buildLlmPrompt("events", "sr"));
    expect(events).toContain("startAt");
    expect(events).toContain("endAt");
    expect(events).toContain("allDay");
    expect(events).toContain("location");
    expect(events).not.toContain("dueDate");
    expect(events).not.toContain("priority");

    const cards = jsonKeys(buildLlmPrompt("cards", "sr"));
    expect(cards).toContain("front");
    expect(cards).toContain("back");
    expect(cards).toContain("clozeText");
    expect(cards).not.toContain("title");
  });

  it("spells the task priority enum out in full", () => {
    for (const language of LLM_PROMPT_LANGUAGES) {
      const prompt = buildLlmPrompt("tasks", language);
      for (const priority of ["none", "low", "medium", "high"]) {
        expect(prompt).toContain(`"${priority}"`);
      }
    }
  });

  it("pins the date formats", () => {
    for (const language of LLM_PROMPT_LANGUAGES) {
      expect(buildLlmPrompt("tasks", language)).toContain("YYYY-MM-DD");
      const events = buildLlmPrompt("events", language);
      expect(events).toContain("YYYY-MM-DDTHH:MM");
      expect(events).toContain("YYYY-MM-DD");
    }
  });

  it("carries at least two few-shot examples per prompt", () => {
    for (const kind of LLM_IMPORT_KINDS) {
      for (const language of LLM_PROMPT_LANGUAGES) {
        expect(fencedJson(buildLlmPrompt(kind, language)).length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("carries examples the parser itself accepts, whole and unskipped", () => {
    for (const kind of LLM_IMPORT_KINDS) {
      for (const language of LLM_PROMPT_LANGUAGES) {
        for (const example of fencedJson(buildLlmPrompt(kind, language))) {
          const answer = parseLlmAnswer(example);
          expect(answer.status).toBe("ok");
          if (answer.status !== "ok") continue;
          expect(answer.parsed.kind).toBe(kind);
          expect(answer.report.skipped).toEqual([]);
          expect(answer.report.droppedFields).toBe(0);
          expect(answer.report.accepted).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("parseLlmAnswer — wrapping tolerance", () => {
  it("reads a bare envelope", () => {
    const answer = parseLlmAnswer(envelope("tasks", [{ title: "Kupovina" }]));
    expect(answer).toMatchObject({ status: "ok" });
  });

  it("strips a markdown fence", () => {
    const answer = parseLlmAnswer("```json\n" + envelope("tasks", [{ title: "A" }]) + "\n```");
    expect(answer.status).toBe("ok");
  });

  it("strips a fence with no language tag", () => {
    const answer = parseLlmAnswer("```\n" + envelope("tasks", [{ title: "A" }]) + "\n```");
    expect(answer.status).toBe("ok");
  });

  it("strips leading and trailing prose", () => {
    const answer = parseLlmAnswer(
      `Naravno! Evo tvojih zadataka:\n\n${envelope("tasks", [{ title: "A" }])}\n\nJavi ako treba još nešto.`,
    );
    expect(answer.status).toBe("ok");
  });

  it("strips prose around a fence", () => {
    const answer = parseLlmAnswer(
      "Sure, here you go:\n\n```json\n" +
        envelope("events", [{ title: "Sastanak", startAt: "2026-08-12T10:00" }]) +
        "\n```\n\nLet me know!",
    );
    expect(answer.status).toBe("ok");
  });

  it("ignores a trailing `}` in the prose after the object", () => {
    const answer = parseLlmAnswer(`${envelope("tasks", [{ title: "A" }])}\n\nnapomena: } nije deo JSON-a`);
    expect(answer.status).toBe("ok");
  });

  it("keeps braces that live inside a string value", () => {
    const answer = parseLlmAnswer(envelope("cards", [{ front: "Šta radi `{ }`?", back: "Blok" }]));
    expect(answer).toMatchObject({ status: "ok" });
    if (answer.status !== "ok" || answer.parsed.kind !== "cards") throw new Error("unreachable");
    expect(answer.parsed.records[0]).toEqual({ kind: "basic", front: "Šta radi `{ }`?", back: "Blok" });
  });
});

describe("parseLlmAnswer — envelope strictness", () => {
  it("refuses an empty paste", () => {
    expect(parseLlmAnswer("   \n  ")).toEqual({ status: "failed", code: "empty" });
  });

  it("refuses an answer past the length cap", () => {
    expect(parseLlmAnswer("x".repeat(LLM_MAX_ANSWER_LENGTH + 1))).toEqual({
      status: "failed",
      code: "too-long",
    });
  });

  it("refuses text with no JSON object at all", () => {
    expect(parseLlmAnswer("Izvini, ne mogu to da uradim.")).toEqual({
      status: "failed",
      code: "no-json",
    });
  });

  it("REFUSES trailing commas — JSON.parse is the parser", () => {
    expect(parseLlmAnswer('{"nexus-llm":"1","kind":"tasks","records":[{"title":"A"},]}')).toEqual({
      status: "failed",
      code: "not-json",
    });
  });

  it("refuses a top-level array: the object inside it is not this envelope", () => {
    expect(parseLlmAnswer('[{"title":"A"}]')).toEqual({ status: "failed", code: "not-an-envelope" });
  });

  it("refuses an envelope whose records is not an array", () => {
    expect(parseLlmAnswer('{"nexus-llm":"1","kind":"tasks","records":{}}')).toEqual({
      status: "failed",
      code: "not-an-envelope",
    });
  });

  it("refuses a missing envelope marker", () => {
    expect(parseLlmAnswer('{"kind":"tasks","records":[]}')).toEqual({
      status: "failed",
      code: "not-an-envelope",
    });
  });

  it("refuses an unknown envelope version", () => {
    expect(parseLlmAnswer('{"nexus-llm":"2","kind":"tasks","records":[]}')).toEqual({
      status: "failed",
      code: "unsupported-version",
    });
  });

  it("refuses an unknown kind", () => {
    expect(parseLlmAnswer('{"nexus-llm":"1","kind":"notes","records":[]}')).toEqual({
      status: "failed",
      code: "unknown-kind",
    });
  });

  it("accepts an empty records array as nothing to import", () => {
    const answer = parseLlmAnswer(envelope("tasks", []));
    expect(answer).toEqual({
      status: "ok",
      parsed: { kind: "tasks", records: [] },
      report: { total: 0, accepted: 0, skipped: [], droppedFields: 0 },
    });
  });

  it("takes JSON's own last-key-wins rule on a duplicated key", () => {
    const answer = parseLlmAnswer(
      '{"nexus-llm":"1","kind":"tasks","records":[{"title":"prvi","title":"drugi"}]}',
    );
    if (answer.status !== "ok" || answer.parsed.kind !== "tasks") throw new Error("unreachable");
    expect(answer.parsed.records[0]?.title).toBe("drugi");
  });
});

describe("parseLlmAnswer — tasks", () => {
  it("accepts a minimal record and defaults every optional field", () => {
    const answer = parseLlmAnswer(envelope("tasks", [{ title: "  Kupovina  " }]));
    if (answer.status !== "ok" || answer.parsed.kind !== "tasks") throw new Error("unreachable");
    expect(answer.parsed.records).toEqual([
      { title: "Kupovina", dueDate: null, priority: "none", description: null },
    ]);
  });

  it("accepts every optional field", () => {
    const answer = parseLlmAnswer(
      envelope("tasks", [
        { title: "Prijava ispita", dueDate: "2026-09-01", priority: "high", description: "Portal" },
      ]),
    );
    if (answer.status !== "ok" || answer.parsed.kind !== "tasks") throw new Error("unreachable");
    expect(answer.parsed.records[0]).toEqual({
      title: "Prijava ispita",
      dueDate: "2026-09-01",
      priority: "high",
      description: "Portal",
    });
  });

  it("skips a record by index and keeps the rest of the batch", () => {
    const answer = parseLlmAnswer(
      envelope("tasks", [{ title: "A" }, { title: "" }, { title: "C" }]),
    );
    if (answer.status !== "ok" || answer.parsed.kind !== "tasks") throw new Error("unreachable");
    expect(answer.parsed.records.map((r) => r.title)).toEqual(["A", "C"]);
    expect(answer.report).toMatchObject({
      total: 3,
      accepted: 2,
      skipped: [{ index: 1, reason: "missing-field", field: "title" }],
    });
  });

  it("skips a non-object entry", () => {
    const answer = parseLlmAnswer(envelope("tasks", ["A", null, 7, ["x"]]));
    if (answer.status !== "ok") throw new Error("unreachable");
    expect(answer.report.skipped.map((s) => s.reason)).toEqual([
      "not-an-object",
      "not-an-object",
      "not-an-object",
      "not-an-object",
    ]);
    expect(answer.report.skipped.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it("refuses an out-of-domain priority", () => {
    const answer = parseLlmAnswer(envelope("tasks", [{ title: "A", priority: "urgent" }]));
    if (answer.status !== "ok") throw new Error("unreachable");
    expect(answer.report.skipped).toEqual([{ index: 0, reason: "invalid-field", field: "priority" }]);
  });

  it("refuses a due date that is not a real calendar day", () => {
    for (const dueDate of ["2026-02-30", "2026-9-1", "01.09.2026.", "2026-09-01T10:00"]) {
      const answer = parseLlmAnswer(envelope("tasks", [{ title: "A", dueDate }]));
      if (answer.status !== "ok") throw new Error("unreachable");
      expect(answer.report.skipped).toEqual([{ index: 0, reason: "invalid-field", field: "dueDate" }]);
    }
  });

  it("reads null as absent on every optional field", () => {
    const answer = parseLlmAnswer(
      envelope("tasks", [{ title: "A", dueDate: null, priority: null, description: null }]),
    );
    if (answer.status !== "ok" || answer.parsed.kind !== "tasks") throw new Error("unreachable");
    expect(answer.parsed.records[0]).toEqual({
      title: "A",
      dueDate: null,
      priority: "none",
      description: null,
    });
  });

  it("drops unknown fields and counts them", () => {
    const answer = parseLlmAnswer(
      envelope("tasks", [{ title: "A", assignee: "Luka", tags: ["x"] }, { title: "B", id: "1" }]),
    );
    if (answer.status !== "ok" || answer.parsed.kind !== "tasks") throw new Error("unreachable");
    expect(answer.parsed.records).toHaveLength(2);
    expect(answer.report.droppedFields).toBe(3);
  });

  it("refuses text past the field cap", () => {
    const answer = parseLlmAnswer(envelope("tasks", [{ title: "x".repeat(LLM_MAX_TEXT_LENGTH + 1) }]));
    if (answer.status !== "ok") throw new Error("unreachable");
    expect(answer.report.skipped).toEqual([{ index: 0, reason: "text-too-long", field: "title" }]);
  });

  it("caps the batch and names every record past the cap", () => {
    const records = Array.from({ length: LLM_MAX_RECORDS + 3 }, (_, i) => ({ title: `T${i}` }));
    const answer = parseLlmAnswer(envelope("tasks", records));
    if (answer.status !== "ok") throw new Error("unreachable");
    expect(answer.report.accepted).toBe(LLM_MAX_RECORDS);
    expect(answer.report.total).toBe(LLM_MAX_RECORDS + 3);
    expect(answer.report.skipped).toHaveLength(3);
    expect(answer.report.skipped.every((s) => s.reason === "over-record-cap")).toBe(true);
    expect(answer.report.skipped[0]?.index).toBe(LLM_MAX_RECORDS);
  });

  it("always balances: total = accepted + skipped", () => {
    const answer = parseLlmAnswer(
      envelope("tasks", [{ title: "A" }, 7, { title: "B", priority: "x" }, { title: "C" }]),
    );
    if (answer.status !== "ok") throw new Error("unreachable");
    expect(answer.report.total).toBe(answer.report.accepted + answer.report.skipped.length);
  });
});

describe("parseLlmAnswer — events", () => {
  it("accepts a timed event", () => {
    const answer = parseLlmAnswer(
      envelope("events", [
        {
          title: "Sastanak",
          startAt: "2026-08-12T10:00",
          endAt: "2026-08-12T11:30",
          location: "Kancelarija",
          description: "Kvartalni pregled",
        },
      ]),
    );
    if (answer.status !== "ok" || answer.parsed.kind !== "events") throw new Error("unreachable");
    expect(answer.parsed.records[0]).toEqual({
      title: "Sastanak",
      startAt: "2026-08-12T10:00",
      endAt: "2026-08-12T11:30",
      allDay: false,
      location: "Kancelarija",
      description: "Kvartalni pregled",
    });
  });

  it("reads a bare start date as an all-day event", () => {
    const answer = parseLlmAnswer(envelope("events", [{ title: "Praznik", startAt: "2026-08-12" }]));
    if (answer.status !== "ok" || answer.parsed.kind !== "events") throw new Error("unreachable");
    expect(answer.parsed.records[0]).toMatchObject({ allDay: true, startAt: "2026-08-12", endAt: null });
  });

  it("truncates the instants of an event the answer declared all-day", () => {
    const answer = parseLlmAnswer(
      envelope("events", [
        { title: "Seminar", startAt: "2026-08-12T00:00", endAt: "2026-08-13T23:59", allDay: true },
      ]),
    );
    if (answer.status !== "ok" || answer.parsed.kind !== "events") throw new Error("unreachable");
    expect(answer.parsed.records[0]).toMatchObject({
      allDay: true,
      startAt: "2026-08-12",
      endAt: "2026-08-13",
    });
  });

  it("accepts seconds in a wall-clock instant", () => {
    const answer = parseLlmAnswer(
      envelope("events", [{ title: "Trka", startAt: "2026-08-12T10:00:30" }]),
    );
    if (answer.status !== "ok" || answer.parsed.kind !== "events") throw new Error("unreachable");
    expect(answer.parsed.records[0]?.startAt).toBe("2026-08-12T10:00:30");
  });

  it("refuses a zoned instant, which would move the event by the offset", () => {
    for (const startAt of ["2026-08-12T10:00:00Z", "2026-08-12T10:00+02:00"]) {
      const answer = parseLlmAnswer(envelope("events", [{ title: "A", startAt }]));
      if (answer.status !== "ok") throw new Error("unreachable");
      expect(answer.report.skipped).toEqual([{ index: 0, reason: "invalid-field", field: "startAt" }]);
    }
  });

  it("refuses an impossible clock or calendar day", () => {
    for (const startAt of ["2026-08-12T25:00", "2026-08-12T10:61", "2026-02-30T10:00"]) {
      const answer = parseLlmAnswer(envelope("events", [{ title: "A", startAt }]));
      if (answer.status !== "ok") throw new Error("unreachable");
      expect(answer.report.skipped).toEqual([{ index: 0, reason: "invalid-field", field: "startAt" }]);
    }
  });

  it("requires a start", () => {
    const answer = parseLlmAnswer(envelope("events", [{ title: "A" }]));
    if (answer.status !== "ok") throw new Error("unreachable");
    expect(answer.report.skipped).toEqual([{ index: 0, reason: "missing-field", field: "startAt" }]);
  });

  it("refuses an end before its start", () => {
    const answer = parseLlmAnswer(
      envelope("events", [{ title: "A", startAt: "2026-08-12T11:00", endAt: "2026-08-12T10:00" }]),
    );
    if (answer.status !== "ok") throw new Error("unreachable");
    expect(answer.report.skipped).toEqual([{ index: 0, reason: "invalid-field", field: "endAt" }]);
  });
});

describe("parseLlmAnswer — cards", () => {
  it("accepts a basic pair", () => {
    const answer = parseLlmAnswer(envelope("cards", [{ front: "2+2", back: "4" }]));
    if (answer.status !== "ok" || answer.parsed.kind !== "cards") throw new Error("unreachable");
    expect(answer.parsed.records[0]).toEqual({ kind: "basic", front: "2+2", back: "4" });
  });

  it("accepts a cloze template", () => {
    const answer = parseLlmAnswer(
      envelope("cards", [{ clozeText: "Glavni grad Srbije je {{Beograd}}." }]),
    );
    if (answer.status !== "ok" || answer.parsed.kind !== "cards") throw new Error("unreachable");
    expect(answer.parsed.records[0]).toEqual({
      kind: "cloze",
      clozeText: "Glavni grad Srbije je {{Beograd}}.",
    });
  });

  it("refuses a record that is both kinds at once", () => {
    const answer = parseLlmAnswer(
      envelope("cards", [{ front: "A", back: "B", clozeText: "{{c}}" }]),
    );
    if (answer.status !== "ok") throw new Error("unreachable");
    expect(answer.report.skipped).toEqual([{ index: 0, reason: "unknown-card-shape", field: null }]);
  });

  it("refuses a record that is neither kind", () => {
    const answer = parseLlmAnswer(envelope("cards", [{ front: "A" }]));
    if (answer.status !== "ok") throw new Error("unreachable");
    expect(answer.report.skipped).toEqual([{ index: 0, reason: "unknown-card-shape", field: null }]);
  });

  it("refuses a cloze template with no deletion in it", () => {
    for (const clozeText of ["Nema praznine.", "Prazna {{}} praznina."]) {
      const answer = parseLlmAnswer(envelope("cards", [{ clozeText }]));
      if (answer.status !== "ok") throw new Error("unreachable");
      expect(answer.report.skipped).toEqual([
        { index: 0, reason: "no-cloze-deletion", field: "clozeText" },
      ]);
    }
  });
});

describe("translateLlmRecords", () => {
  it("plans tasks into the target's own default list", () => {
    const parsed: LlmRecords = {
      kind: "tasks",
      records: [
        { title: "A", dueDate: "2026-09-01", priority: "high", description: "d" },
        { title: "B", dueDate: null, priority: "none", description: null },
      ],
    };
    const { data, seededIds, planned } = translateLlmRecords(parsed, {
      profileId: "p1",
      now: NOW,
      deck: null,
    });
    expect(planned).toBe(2);
    expect(seededIds.size).toBe(0);
    expect(data.tasks).toHaveLength(2);
    expect(data.events).toEqual([]);
    expect(data.cards).toEqual([]);
    expect(data.tasks[0]).toMatchObject({
      profileId: "p1",
      title: "A",
      dueDate: "2026-09-01",
      priority: "high",
      description: "d",
      status: "todo",
      done: false,
      completedAt: null,
      // Null is how a plan says "the target profile's own default list".
      listId: null,
      sectionId: null,
      parentId: null,
      recurrence: null,
      reminderOffsets: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(data.tasks[0]?.position).toBeLessThan(data.tasks[1]?.position ?? 0);
  });

  it("plans events with their own instants and no category", () => {
    const parsed: LlmRecords = {
      kind: "events",
      records: [
        {
          title: "Sastanak",
          startAt: "2026-08-12T10:00",
          endAt: "2026-08-12T11:00",
          allDay: false,
          location: "Kancelarija",
          description: null,
        },
      ],
    };
    const { data, planned } = translateLlmRecords(parsed, {
      profileId: "p1",
      now: NOW,
      deck: null,
    });
    expect(planned).toBe(1);
    expect(data.events[0]).toMatchObject({
      profileId: "p1",
      title: "Sastanak",
      startAt: "2026-08-12T10:00",
      endAt: "2026-08-12T11:00",
      allDay: false,
      location: "Kancelarija",
      category: null,
      recurrence: null,
      recurrenceExdates: [],
      reminderOffsets: [],
    });
  });

  it("plans basic cards against the chosen deck, seeded rather than created", () => {
    const parsed: LlmRecords = {
      kind: "cards",
      records: [{ kind: "basic", front: "2+2", back: "4" }],
    };
    const { data, seededIds, planned } = translateLlmRecords(parsed, {
      profileId: "p1",
      now: NOW,
      deck: { kind: "existing", id: "deck-1" },
    });
    expect(planned).toBe(1);
    expect(data.decks).toEqual([]);
    expect(data.subjects).toEqual([]);
    expect([...seededIds]).toEqual([[LLM_DECK_SOURCE_ID, "deck-1"]]);
    expect(data.cards[0]).toMatchObject({
      profileId: "p1",
      deckId: LLM_DECK_SOURCE_ID,
      front: "2+2",
      back: "4",
      kind: "basic",
      clozeText: null,
      clozeOrdinal: null,
      problemSteps: null,
      sourceNoteId: null,
      sourceBlockKey: null,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReview: null,
      due: NOW,
    });
  });

  it("expands one cloze template into one card per deletion", () => {
    const parsed: LlmRecords = {
      kind: "cards",
      records: [{ kind: "cloze", clozeText: "{{Beograd}} je glavni grad {{Srbije}}." }],
    };
    const { data, planned } = translateLlmRecords(parsed, {
      profileId: "p1",
      now: NOW,
      deck: { kind: "existing", id: "deck-1" },
    });
    expect(planned).toBe(2);
    expect(data.cards.map((card) => card.clozeOrdinal)).toEqual([0, 1]);
    expect(data.cards[0]).toMatchObject({
      kind: "cloze",
      clozeText: "{{Beograd}} je glavni grad {{Srbije}}.",
      front: "[…] je glavni grad Srbije.",
      back: "Beograd je glavni grad Srbije.",
    });
    expect(data.cards[1]?.front).toBe("Beograd je glavni grad […].");
  });

  it("plans a NEW deck as a row of the translation, seeded only through its subject", () => {
    const parsed: LlmRecords = {
      kind: "cards",
      records: [{ kind: "basic", front: "2+2", back: "4" }],
    };
    const { data, seededIds, planned } = translateLlmRecords(parsed, {
      profileId: "p1",
      now: NOW,
      deck: { kind: "new", name: "Ćelija", subjectId: "subject-1" },
    });
    // The deck row itself is planned, so the count is the card plus the deck.
    expect(planned).toBe(2);
    // No subject row: the chosen subject already exists, and only the SEAM names it.
    expect(data.subjects).toEqual([]);
    expect([...seededIds]).toEqual([[LLM_SUBJECT_SOURCE_ID, "subject-1"]]);
    expect(data.decks).toEqual([
      {
        id: LLM_DECK_SOURCE_ID,
        profileId: "p1",
        subjectId: LLM_SUBJECT_SOURCE_ID,
        name: "Ćelija",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    // The cards still point at the deck by its source-side name — the planner
    // mints the real id once, for the row and every reference alike.
    expect(data.cards.map((card) => card.deckId)).toEqual([LLM_DECK_SOURCE_ID]);
  });

  it("mints a distinct id for every planned row", () => {
    const parsed: LlmRecords = {
      kind: "cards",
      records: [
        { kind: "basic", front: "a", back: "b" },
        { kind: "cloze", clozeText: "{{x}} i {{y}}" },
      ],
    };
    const { data } = translateLlmRecords(parsed, {
      profileId: "p1",
      now: NOW,
      deck: { kind: "existing", id: "d" },
    });
    expect(new Set(data.cards.map((card) => card.id)).size).toBe(data.cards.length);
  });

  it("refuses a card import with no deck to land in", () => {
    expect(() =>
      translateLlmRecords(
        { kind: "cards", records: [{ kind: "basic", front: "a", back: "b" }] },
        { profileId: "p1", now: NOW, deck: null },
      ),
    ).toThrow(/deck/i);
  });

  it("plans every other module empty", () => {
    const { data } = translateLlmRecords(
      { kind: "tasks", records: [{ title: "A", dueDate: null, priority: "none", description: null }] },
      { profileId: "p1", now: NOW, deck: null },
    );
    expect(data.notes).toEqual([]);
    expect(data.taskLists).toEqual([]);
    expect(data.notifications).toEqual([]);
    expect(data.dashboardWidgets).toEqual([]);
    expect(data.reviewLog).toEqual([]);
  });
});
