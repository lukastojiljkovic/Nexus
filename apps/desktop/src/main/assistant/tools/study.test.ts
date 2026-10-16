import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CardStore,
  DeckStore,
  ExamStore,
  NexusDatabase,
  NoteStore,
  PlanStore,
  StudySettingsStore,
  SubjectNoteLinkStore,
  SubjectStore,
  TopicStore,
  openDatabase,
  uuidv7,
} from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext, ToolResult } from "@nexus/core";
import { studyTools } from "./study.js";

/**
 * The STUDY tools over a real database.
 *
 * Every write asks first, so each test records what it was asked and whether a
 * refusal left the store as it was. The clock is fixed at 10 October 2026, 09:00
 * local, so "today" and the days-left figures are the same on every machine.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-study-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function tools(): readonly Tool[] {
  return studyTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function contextFor(locale: "sr" | "en", allow: boolean): { readonly context: ToolContext; readonly confirms: ConfirmRequest[] } {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

/** Runs one tool with the given arguments and returns what it answered, plus the confirmations it asked. */
async function run(
  name: string,
  args: Record<string, unknown>,
  options: { readonly allow?: boolean; readonly locale?: "sr" | "en" } = {},
): Promise<{ readonly result: ToolResult; readonly confirms: ConfirmRequest[] }> {
  const { context, confirms } = contextFor(options.locale ?? "en", options.allow ?? true);
  const result = await toolOf(name).run(args, context);
  return { result, confirms };
}

const subjects = () => new SubjectStore(db.raw, profileId);
const exams = () => new ExamStore(db.raw, profileId);
const decks = () => new DeckStore(db.raw, profileId);
const cards = () => new CardStore(db.raw, profileId);
const topics = () => new TopicStore(db.raw, profileId);

function makeSubject(name: string): string {
  return subjects().create({ name }).id;
}

function makeExam(subjectId: string, examDate: string, examType: "pismeni" | "usmeni" | "kolokvijum" = "pismeni"): string {
  return exams().create({ subjectId, examType, examDate }).id;
}

describe("study.subjects", () => {
  it("lists each subject with its exam and deck counts and the next exam", async () => {
    const analysis = makeSubject("Analiza 1");
    makeExam(analysis, "2026-11-03");
    makeExam(analysis, "2026-09-01");
    decks().create({ subjectId: analysis, name: "Formule" });
    makeSubject("Bio");

    const { result } = await run("study.subjects", {});

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Analiza 1");
    expect(result.content).toContain("exams 2");
    expect(result.content).toContain("decks 1");
    expect(result.content).toContain("next exam");
    expect(result.content).toContain("Bio");
    expect(result.navigateTo).toEqual({ module: "study" });
  });

  it("says so when there are no subjects", async () => {
    const { result } = await run("study.subjects", {});
    expect(result.content).toBe("There are no subjects.");
  });
});

describe("study.subject", () => {
  it("creates a subject once the user confirms", async () => {
    const { result, confirms } = await run("study.subject", { action: "create", name: "Biologija", color: "gold" });

    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toContain("Biologija");
    const [created] = subjects().listActive();
    expect(created?.name).toBe("Biologija");
    expect(created?.color).toBe("gold");
  });

  it("writes nothing when the user declines", async () => {
    const { result } = await run("study.subject", { action: "create", name: "Biologija" }, { allow: false });

    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(subjects().listActive()).toEqual([]);
  });

  it("names the subject in a Serbian confirmation when the locale is Serbian", async () => {
    const { confirms } = await run("study.subject", { action: "create", name: "Hemija" }, { locale: "sr" });
    expect(confirms[0]?.summary).toBe("Napravi predmet „Hemija“.");
  });

  it("updates only the fields it is given", async () => {
    const id = makeSubject("Fizika");

    const { result } = await run("study.subject", { action: "update", subject: "fizika", semester: "Zimski" });

    expect(result.ok).toBe(true);
    const row = subjects().listActive().find((subject) => subject.id === id);
    expect(row?.name).toBe("Fizika");
    expect(row?.semester).toBe("Zimski");
  });

  it("refuses an update that names no field", async () => {
    makeSubject("Fizika");
    const { result, confirms } = await run("study.subject", { action: "update", subject: "Fizika" });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Nothing was given to change");
    expect(confirms).toEqual([]);
  });

  it("deletes the subject alone, as the page does, and leaves its exams and decks", async () => {
    const id = makeSubject("Analiza 1");
    const examId = makeExam(id, "2026-11-03");
    const deckId = decks().create({ subjectId: id, name: "Formule" }).id;

    const { result } = await run("study.subject", { action: "delete", subject: "Analiza 1" });

    expect(result.ok).toBe(true);
    expect(subjects().listActive()).toEqual([]);
    expect(exams().listActive().map((exam) => exam.id)).toContain(examId);
    expect(decks().listActive().map((deck) => deck.id)).toContain(deckId);
  });

  it("keeps the subject, its exams and its decks when the deletion is declined", async () => {
    const id = makeSubject("Analiza 1");
    makeExam(id, "2026-11-03");
    decks().create({ subjectId: id, name: "Formule" });

    const { result } = await run("study.subject", { action: "delete", subject: id }, { allow: false });

    expect(result.content).toBe("The user declined.");
    expect(subjects().listActive()).toHaveLength(1);
    expect(exams().listActive()).toHaveLength(1);
    expect(decks().listActive()).toHaveLength(1);
  });

  it("restores a deleted subject by the id its delete reported", async () => {
    const id = makeSubject("Bio");
    subjects().softDelete(id);

    const { result } = await run("study.subject", { action: "restore", subject: id });

    expect(result.ok).toBe(true);
    expect(subjects().listActive().map((row) => row.id)).toEqual([id]);
  });

  it("refuses an unknown subject by name, listing the ones that exist", async () => {
    makeSubject("Bio");
    const { result } = await run("study.subject", { action: "delete", subject: "Hemija" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("No subject named “Hemija”");
    expect(result.content).toContain("Bio");
  });

  it("refuses an ambiguous subject name with the ids it could be", async () => {
    makeSubject("Bio");
    makeSubject("bio");
    const { result, confirms } = await run("study.subject", { action: "delete", subject: "BIO" });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("More than one subject");
    expect(confirms).toEqual([]);
  });

  it("links a note to a subject and unlinks it again", async () => {
    const subjectId = makeSubject("Bio");
    const noteId = new NoteStore(db.raw, profileId).create(NOW_ISO).id;

    const linked = await run("study.subject", { action: "link-note", subject: subjectId, note: noteId });
    expect(linked.result.ok).toBe(true);
    expect(new SubjectNoteLinkStore(db.raw, profileId).listSubjectsOfNote(noteId)).toEqual([subjectId]);

    const unlinked = await run("study.subject", { action: "unlink-note", subject: subjectId, note: noteId });
    expect(unlinked.result.ok).toBe(true);
    expect(new SubjectNoteLinkStore(db.raw, profileId).listSubjectsOfNote(noteId)).toEqual([]);
  });
});

describe("study.exams and study.exam", () => {
  it("lists exams by date with the days left", async () => {
    const id = makeSubject("Analiza 1");
    makeExam(id, "2026-11-03");
    makeExam(id, "2026-10-01", "usmeni");

    const { result } = await run("study.exams", {});

    expect(result.content).toContain("days left: 24");
    expect(result.content).toContain("passed");
  });

  it("adds an exam for a subject named by its name", async () => {
    makeSubject("Analiza 1");
    const { result, confirms } = await run("study.exam", {
      action: "create",
      subject: "analiza 1",
      type: "usmeni",
      date: "2026-11-03",
    });

    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toContain("Analiza 1");
    expect(exams().listActive()).toHaveLength(1);
    expect(exams().listActive()[0]?.examType).toBe("usmeni");
  });

  it("refuses a date that is not a real day before anything is asked", async () => {
    makeSubject("Analiza 1");
    const { result, confirms } = await run("study.exam", {
      action: "create",
      subject: "Analiza 1",
      type: "pismeni",
      date: "2026-02-30",
    });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("YYYY-MM-DD");
    expect(confirms).toEqual([]);
  });

  it("moves an exam to a new date, then deletes and restores it by id", async () => {
    const id = makeSubject("Analiza 1");
    const examId = makeExam(id, "2026-11-03");

    const moved = await run("study.exam", { action: "update", exam: examId, date: "2026-11-10" });
    expect(moved.result.ok).toBe(true);
    expect(exams().listActive()[0]?.examDate).toBe("2026-11-10");

    const deleted = await run("study.exam", { action: "delete", exam: examId });
    expect(deleted.result.ok).toBe(true);
    expect(exams().listActive()).toEqual([]);

    const restored = await run("study.exam", { action: "restore", exam: examId });
    expect(restored.result.ok).toBe(true);
    expect(exams().listActive().map((exam) => exam.id)).toEqual([examId]);
  });

  it("refuses an exam named by a subject that has more than one exam", async () => {
    const id = makeSubject("Analiza 1");
    makeExam(id, "2026-11-03");
    makeExam(id, "2026-12-03");

    const { result } = await run("study.exam", { action: "delete", exam: "Analiza 1" });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Name the exam by its id");
  });
});

describe("study.topics and study.topic", () => {
  it("adds a topic, moves it up the list, and sets its confidence", async () => {
    const examId = makeExam(makeSubject("Analiza 1"), "2026-11-03");
    await run("study.topic", { action: "add", exam: examId, name: "Integrali" });
    await run("study.topic", { action: "add", exam: examId, name: "Redovi" });

    const moved = await run("study.topic", { action: "rank", exam: examId, topic: "redovi", position: 1 });
    expect(moved.result.ok).toBe(true);
    expect(topics().listByExam(examId).map((topic) => topic.name)).toEqual(["Redovi", "Integrali"]);

    const confident = await run("study.topic", { action: "confidence", exam: examId, topic: "Redovi", confidence: 80 });
    expect(confident.result.ok).toBe(true);
    expect(topics().listByExam(examId).find((topic) => topic.name === "Redovi")?.confidence).toBe(80);
  });

  it("clears a confidence back to unknown when it is set to null", async () => {
    const examId = makeExam(makeSubject("Analiza 1"), "2026-11-03");
    await run("study.topic", { action: "add", exam: examId, name: "Integrali" });
    await run("study.topic", { action: "confidence", exam: examId, topic: "Integrali", confidence: 40 });

    const cleared = await run("study.topic", { action: "confidence", exam: examId, topic: "Integrali", confidence: null });

    expect(cleared.result.ok).toBe(true);
    expect(topics().listByExam(examId)[0]?.confidence).toBeNull();
  });

  it("refuses a confidence outside 0 to 100 before writing", async () => {
    const examId = makeExam(makeSubject("Analiza 1"), "2026-11-03");
    await run("study.topic", { action: "add", exam: examId, name: "Integrali" });

    const { result, confirms } = await run("study.topic", { action: "confidence", exam: examId, topic: "Integrali", confidence: 140 });

    expect(result.ok).toBe(false);
    expect(confirms).toEqual([]);
    expect(topics().listByExam(examId)[0]?.confidence).toBeNull();
  });

  it("links a topic to a deck by name, and deletes the topic", async () => {
    const subjectId = makeSubject("Analiza 1");
    const examId = makeExam(subjectId, "2026-11-03");
    decks().create({ subjectId, name: "Formule" });
    await run("study.topic", { action: "add", exam: examId, name: "Integrali" });

    const linked = await run("study.topic", { action: "deck", exam: examId, topic: "Integrali", deck: "formule" });
    expect(linked.result.ok).toBe(true);
    expect(topics().listByExam(examId)[0]?.deckId).not.toBeNull();

    const deleted = await run("study.topic", { action: "delete", exam: examId, topic: "Integrali" });
    expect(deleted.result.ok).toBe(true);
    expect(topics().listByExam(examId)).toEqual([]);
  });
});

describe("study.decks, study.deck, study.cards and study.card", () => {
  it("creates a deck in a subject and renames it", async () => {
    const subjectId = makeSubject("Bio");

    const created = await run("study.deck", { action: "create", subject: "Bio", name: "Ćelija" });
    expect(created.result.ok).toBe(true);
    const deckId = decks().listActive()[0]?.id ?? "";

    const renamed = await run("study.deck", { action: "rename", deck: deckId, name: "Ćelija i jezgro" });
    expect(renamed.result.ok).toBe(true);
    expect(decks().listActive()[0]?.name).toBe("Ćelija i jezgro");
    expect(decks().listActive()[0]?.subjectId).toBe(subjectId);
  });

  it("adds a basic card and reports its id", async () => {
    makeSubject("Bio");
    await run("study.deck", { action: "create", subject: "Bio", name: "Ćelija" });

    const { result, confirms } = await run("study.card", {
      action: "create",
      deck: "Ćelija",
      front: "Mitohondrija",
      back: "Ćelijsko disanje",
    });

    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toContain("Mitohondrija");
    expect(cards().listByDeck(decks().listActive()[0]?.id ?? "")).toHaveLength(1);
  });

  it("creates one cloze card per deletion number and reports the count", async () => {
    makeSubject("Bio");
    await run("study.deck", { action: "create", subject: "Bio", name: "Ćelija" });

    const { result } = await run("study.card", {
      action: "create-cloze",
      deck: "Ćelija",
      text: "{{c1::Mitohondrija}} je mesto {{c2::disanja}}",
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain(": 2.");
    expect(cards().listByDeck(decks().listActive()[0]?.id ?? "")).toHaveLength(2);
  });

  it("changes a card found by its front, then deletes it and restores it by id", async () => {
    makeSubject("Bio");
    await run("study.deck", { action: "create", subject: "Bio", name: "Ćelija" });
    await run("study.card", { action: "create", deck: "Ćelija", front: "Jezgro", back: "Čuva DNK" });
    const deckId = decks().listActive()[0]?.id ?? "";
    const cardId = cards().listByDeck(deckId)[0]?.id ?? "";

    const changed = await run("study.card", { action: "update", deck: "Ćelija", card: "jezgro", back: "Sadrži DNK" });
    expect(changed.result.ok).toBe(true);
    expect(cards().listByDeck(deckId)[0]?.back).toBe("Sadrži DNK");

    const deleted = await run("study.card", { action: "delete", deck: "Ćelija", card: cardId });
    expect(deleted.result.ok).toBe(true);
    expect(cards().listByDeck(deckId)).toEqual([]);

    const restored = await run("study.card", { action: "restore", card: cardId });
    expect(restored.result.ok).toBe(true);
    expect(cards().listByDeck(deckId).map((card) => card.id)).toEqual([cardId]);
  });

  it("lists a deck's cards", async () => {
    makeSubject("Bio");
    await run("study.deck", { action: "create", subject: "Bio", name: "Ćelija" });
    await run("study.card", { action: "create", deck: "Ćelija", front: "Jezgro", back: "Čuva DNK" });

    const { result } = await run("study.cards", { deck: "Ćelija" });

    expect(result.content).toContain("Jezgro");
  });
});

describe("study.due", () => {
  it("reports the daily cap and sends the user to the page to review", async () => {
    const subjectId = makeSubject("Bio");
    const deckId = decks().create({ subjectId, name: "Ćelija" }).id;
    new StudySettingsStore(db.raw, profileId).save(
      { targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: 1 },
      NOW_ISO,
    );
    cards().create({ deckId, front: "Jezgro", back: "DNK" }, NOW_ISO);
    cards().create({ deckId, front: "Ribozom", back: "Proteini" }, NOW_ISO);

    const { result } = await run("study.due", {});

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Due for review: 2");
    expect(result.navigateTo).toEqual({ module: "study" });
  });

  it("says when nothing is due", async () => {
    const { result } = await run("study.due", {});
    expect(result.content).toBe("No cards are due for review.");
  });
});

describe("study.settings", () => {
  it("reads the settings when no field is given, without asking", async () => {
    const { result, confirms } = await run("study.settings", {});

    expect(result.ok).toBe(true);
    expect(result.content).toContain("new cards a day 20");
    expect(confirms).toEqual([]);
  });

  it("changes a setting once confirmed, stating the old and new values", async () => {
    const { result, confirms } = await run("study.settings", { newPerDay: 30 });

    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toContain("new cards a day 20 → 30");
    expect(new StudySettingsStore(db.raw, profileId).get().newPerDay).toBe(30);
  });

  it("writes nothing when the change is declined", async () => {
    await run("study.settings", { newPerDay: 30 }, { allow: false });
    expect(new StudySettingsStore(db.raw, profileId).get().newPerDay).toBe(20);
  });

  it("refuses a retention outside the setting's window", async () => {
    const { result, confirms } = await run("study.settings", { targetRetention: 0.99 });

    expect(result.ok).toBe(false);
    expect(confirms).toEqual([]);
  });
});

describe("study.plan and study.sync", () => {
  it("says so when there are no plans, and asks nothing to sync", async () => {
    const plan = await run("study.plan", {});
    const sync = await run("study.sync", {});

    expect(plan.result.content).toBe("There are no active study plans.");
    expect(sync.result.content).toBe("There are no active study plans.");
    expect(sync.confirms).toEqual([]);
  });

  it("lists a plan and syncs it once confirmed", async () => {
    const examId = makeExam(makeSubject("Analiza 1"), "2026-11-03");
    new PlanStore(db.raw, profileId).createPlan(
      { examId, dailyMinutes: 30, startDate: "2026-10-10", examWeekBoost: false },
      NOW_ISO,
      "2026-10-10",
    );

    const plan = await run("study.plan", {});
    expect(plan.result.ok).toBe(true);
    expect(plan.result.content).toContain("30 min a day");

    const sync = await run("study.sync", {});
    expect(sync.result.ok).toBe(true);
    expect(sync.confirms).toHaveLength(1);
    expect(sync.result.content).toContain("overflow");
  });
});
