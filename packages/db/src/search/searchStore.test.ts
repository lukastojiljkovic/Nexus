import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SearchKind } from "@nexus/core";
import {
  CardStore,
  DeckStore,
  DocumentStore,
  EventStore,
  ExamStore,
  MAX_SEARCH_LIMIT,
  NexusDatabase,
  NoteAttachmentStore,
  NoteStore,
  SearchStore,
  SearchValidationError,
  SubjectStore,
  TaskListStore,
  TaskStore,
  openDatabase,
  rebuildSearchIndex,
  uuidv7,
} from "../index.js";

/**
 * Exercises `SearchStore` (reads only) and `rebuildSearchIndex` on top of the
 * real trigger-maintained index (migration 017): every row is seeded through
 * the real stores, exactly as `searchIndex.test.ts` does, never by writing to
 * `search_entries` directly.
 */

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-search-store-"));
  db = openDatabase({ path: join(dir, "search-store.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(name = "P"): string {
  const id = uuidv7();
  const now = new Date().toISOString();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, now);
  // Every profile has an Inbox (TASK-004): migration 022 backfills the ones
  // that predate it, `main` seeds it for the ones it creates, and `TaskStore`
  // refuses to place a task in a profile without one.
  new TaskListStore(db.raw, id).ensureInbox(now);
  return id;
}

interface RawSearchEntryRow {
  profile_id: string;
  kind: string;
  entity_id: string;
  parent_id: string | null;
  title: string;
  body: string;
  title_folded: string;
  body_folded: string;
  context_date: string | null;
  updated_at: string;
}

/**
 * Every `search_entries` row, minus `id` — a rebuild does not preserve it
 * (fresh rowids on reinsert), so comparing before/after must ignore it — sorted
 * for order-independent comparison.
 */
function allEntries(): RawSearchEntryRow[] {
  return db.raw
    .prepare(
      `SELECT profile_id, kind, entity_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
       FROM search_entries
       ORDER BY kind, entity_id`,
    )
    .all() as RawSearchEntryRow[];
}

describe("SearchStore.search", () => {
  it("finds a task by a folded term and returns a SearchHit with the right fields and a negative bm25", () => {
    const profileId = createProfile();
    const task = new TaskStore(db.raw, profileId).create({
      title: "Predati izveštaj",
      dueDate: "2026-08-01",
    });
    const store = new SearchStore(db.raw, profileId);

    const hits = store.search({ match: '"izvestaj"*' });

    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    expect(hit.kind).toBe("task");
    expect(hit.entityId).toBe(task.id);
    expect(hit.parentId).toBeNull();
    expect(hit.title).toBe("Predati izveštaj");
    expect(hit.body).toBe("");
    expect(hit.contextDate).toBe("2026-08-01");
    expect(hit.updatedAt).toBe(task.updatedAt);
    expect(hit.bm25).toBeLessThan(0);
  });

  it("scopes results by profile: a matching entity in another profile never appears", () => {
    const p1 = createProfile("P1");
    const p2 = createProfile("P2");
    const task1 = new TaskStore(db.raw, p1).create({ title: "Zajednicki termin alfa" });
    new TaskStore(db.raw, p2).create({ title: "Zajednicki termin alfa" });

    const store1 = new SearchStore(db.raw, p1);
    const hits = store1.search({ match: '"alfa"*' });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.entityId).toBe(task1.id);
  });

  it("filters to one kind when a term matches both a task and a note", () => {
    const profileId = createProfile();
    const task = new TaskStore(db.raw, profileId).create({ title: "Alfa zadatak" });
    const notes = new NoteStore(db.raw, profileId);
    const note = notes.create(new Date().toISOString());
    notes.appendUpdate(note.id, Uint8Array.from([1]), "Alfa beleska", new Date().toISOString());

    const store = new SearchStore(db.raw, profileId);
    const both = store.search({ match: '"alfa"*' });
    expect(both.map((h) => h.kind).sort()).toEqual(["note", "task"]);

    const onlyTasks = store.search({ match: '"alfa"*', kinds: ["task"] });
    expect(onlyTasks).toHaveLength(1);
    expect(onlyTasks[0]!.entityId).toBe(task.id);
  });

  it("ranks a title hit ahead of a body-only hit for the same term (title bm25 weight > body weight)", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    const titleHit = tasks.create({ title: "Zeta u naslovu" });
    const bodyHit = tasks.create({
      title: "Nepovezan naslov",
      description: "Zeta pominjanje u opisu",
    });

    const store = new SearchStore(db.raw, profileId);
    const hits = store.search({ match: '"zeta"*' });

    expect(hits).toHaveLength(2);
    expect(hits[0]!.entityId).toBe(titleHit.id);
    expect(hits[1]!.entityId).toBe(bodyHit.id);
  });

  it("honours an explicit limit", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    tasks.create({ title: "Limit alfa jedan" });
    tasks.create({ title: "Limit alfa dva" });
    tasks.create({ title: "Limit alfa tri" });

    const store = new SearchStore(db.raw, profileId);
    const hits = store.search({ match: '"alfa"*', limit: 2 });
    expect(hits).toHaveLength(2);
  });

  it("clamps a limit above MAX_SEARCH_LIMIT instead of rejecting it", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    for (let i = 0; i < MAX_SEARCH_LIMIT + 5; i++) {
      tasks.create({ title: `Mnogo alfa zadataka ${i}` });
    }

    const store = new SearchStore(db.raw, profileId);
    const hits = store.search({ match: '"alfa"*', limit: 1_000_000 });
    expect(hits).toHaveLength(MAX_SEARCH_LIMIT);
  });

  it("throws SearchValidationError for an empty match", () => {
    const store = new SearchStore(db.raw, createProfile());
    expect(() => store.search({ match: "" })).toThrow(SearchValidationError);
  });

  it("throws SearchValidationError for a whitespace-only match", () => {
    const store = new SearchStore(db.raw, createProfile());
    expect(() => store.search({ match: "   " })).toThrow(SearchValidationError);
  });

  it("throws SearchValidationError for an empty kinds array", () => {
    const store = new SearchStore(db.raw, createProfile());
    expect(() => store.search({ match: '"alfa"*', kinds: [] })).toThrow(SearchValidationError);
  });

  it("throws SearchValidationError for an unknown kind", () => {
    const store = new SearchStore(db.raw, createProfile());
    expect(() =>
      store.search({ match: '"alfa"*', kinds: ["not-a-real-kind" as unknown as SearchKind] }),
    ).toThrow(SearchValidationError);
  });

  it.each([0, -1, 1.5, Number.NaN])("throws SearchValidationError for limit %p", (limit) => {
    const store = new SearchStore(db.raw, createProfile());
    expect(() => store.search({ match: '"alfa"*', limit })).toThrow(SearchValidationError);
  });

  it("throws SearchValidationError for a malformed FTS expression, wrapping the driver-level error", () => {
    // Confirm this really is rejected at the driver level (SQLITE_ERROR), not
    // something the store invents — an unclosed quote is invalid FTS5 MATCH
    // syntax, verified directly against search_fts before trusting the store's
    // wrapping of it.
    expect(() =>
      db.raw.prepare("SELECT rowid FROM search_fts WHERE search_fts MATCH ?").all('"unclosed'),
    ).toThrow(/unterminated string/i);

    const store = new SearchStore(db.raw, createProfile());
    expect(() => store.search({ match: '"unclosed' })).toThrow(SearchValidationError);
  });
});

describe("SearchStore.recent", () => {
  it("returns entries newest-first with bm25 === 0", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    const first = tasks.create({ title: "Prvi" });
    const second = tasks.create({ title: "Drugi" });

    const store = new SearchStore(db.raw, profileId);
    const hits = store.recent();

    expect(hits.map((h) => h.entityId)).toEqual([second.id, first.id]);
    expect(hits.every((h) => h.bm25 === 0)).toBe(true);
  });

  it("honours limit and kind filtering", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    tasks.create({ title: "A" });
    tasks.create({ title: "B" });
    const notes = new NoteStore(db.raw, profileId);
    notes.create(new Date().toISOString());

    const store = new SearchStore(db.raw, profileId);
    expect(store.recent({ limit: 1 })).toHaveLength(1);
    expect(store.recent({ kinds: ["task"] }).every((h) => h.kind === "task")).toBe(true);
  });

  it("scopes by profile", () => {
    const p1 = createProfile("P1");
    const p2 = createProfile("P2");
    new TaskStore(db.raw, p1).create({ title: "Samo P1" });
    new TaskStore(db.raw, p2).create({ title: "Samo P2" });

    const store = new SearchStore(db.raw, p1);
    const hits = store.recent();
    expect(hits).toHaveLength(1);
    expect(hits[0]!.title).toBe("Samo P1");
  });
});

describe("rebuildSearchIndex", () => {
  it("restores every entry after search_entries is wiped, returns the right count, and is idempotent", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    tasks.create({ title: "Jedan" });
    tasks.create({ title: "Dva" });
    tasks.create({ title: "Tri" });

    const before = allEntries();
    expect(before).toHaveLength(3);

    db.raw.prepare("DELETE FROM search_entries").run();
    expect(allEntries()).toHaveLength(0);

    const firstCount = rebuildSearchIndex(db.raw);
    expect(firstCount).toBe(3);
    expect(allEntries()).toEqual(before);

    const secondCount = rebuildSearchIndex(db.raw);
    expect(secondCount).toBe(3);
    expect(allEntries()).toEqual(before);
  });

  it("reproduces entries identical to what the triggers wrote, across all nine kinds", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    const events = new EventStore(db.raw, profileId);
    const notes = new NoteStore(db.raw, profileId);
    const documents = new DocumentStore(db.raw, profileId);
    const subjects = new SubjectStore(db.raw, profileId);
    const exams = new ExamStore(db.raw, profileId);
    const decks = new DeckStore(db.raw, profileId);
    const cards = new CardStore(db.raw, profileId);
    const attachments = new NoteAttachmentStore(db.raw, profileId);

    const now = "2026-07-26T10:00:00.000Z";
    tasks.create({ title: "Predati izveštaj", dueDate: "2026-08-01" });
    events.create({ title: "Sastanak", startAt: "2026-08-01T09:00:00Z" });
    const note = notes.create(now);
    notes.appendUpdate(note.id, Uint8Array.from([1, 2, 3]), "Moja beleška", now);
    documents.create({
      docType: "pasos",
      label: "Pasoš",
      expiryDate: "2027-01-01",
      notes: "Vazi za putovanja",
    });
    const subject = subjects.create({ name: "Matematika", semester: "Prolece 2026" });
    exams.create({ subjectId: subject.id, examType: "pismeni", examDate: "2026-09-01" });
    const deck = decks.create({ subjectId: subject.id, name: "Integrali" });
    cards.create({ deckId: deck.id, front: "2+2", back: "4" }, now);
    attachments.add(
      note.id,
      { fileName: "skripta.pdf", mime: "application/pdf", sizeBytes: 1024, sha256: "a".repeat(64) },
      now,
    );

    const before = allEntries();
    expect(before).toHaveLength(9);

    rebuildSearchIndex(db.raw);

    expect(allEntries()).toEqual(before);
  });

  it("reproduces a task entry carrying its attachment filenames, exactly as the triggers wrote it (migration 025)", () => {
    // A rebuild reads `search_source_task` by name, so the widened projection
    // comes along for free — but "for free" is precisely the kind of claim that
    // rots silently, and a rebuild that dropped the filenames would leave the
    // repair tool producing a WEAKER index than the one it replaced.
    const profileId = createProfile();
    const task = new TaskStore(db.raw, profileId).create({
      title: "Prijava",
      description: "Opis",
    });
    db.raw
      .prepare(
        `INSERT INTO task_attachments (id, task_id, file_name, mime, size_bytes, sha256, created_at)
         VALUES (?, ?, ?, 'application/pdf', 1024, ?, ?)`,
      )
      .run(uuidv7(), task.id, "ugovor.pdf", "a".repeat(64), "2026-07-26T10:00:00.000Z");

    const before = allEntries();
    expect(before).toHaveLength(1);
    expect(before[0]!.body).toBe("Opis ugovor.pdf");

    rebuildSearchIndex(db.raw);

    expect(allEntries()).toEqual(before);
  });

  it("clears a stale search_fts row whose search_entries parent is already gone (orphan repair)", () => {
    // A hand-inserted orphan bypasses every AFTER DELETE trigger (there is no
    // search_entries row to delete, so no trigger ever fires) — the one
    // desync scenario a rebuild must actually repair, not just refill.
    // Empirically confirmed (throwaway probe, since removed): a bare `DELETE
    // FROM search_fts` clears every row of this content='' +
    // contentless_delete=1 table on this build (SQLite 3.53.2), orphans
    // included.
    const profileId = createProfile();
    new TaskStore(db.raw, profileId).create({ title: "Realan zadatak" });

    db.raw.prepare("INSERT INTO search_fts (rowid, title, body) VALUES (9999, 'orphan', 'orphan body')").run();
    const ftsCountBefore = (
      db.raw.prepare("SELECT count(*) AS n FROM search_fts").get() as { n: number }
    ).n;
    expect(ftsCountBefore).toBe(2); // the real task's row, plus the orphan

    rebuildSearchIndex(db.raw);

    const ftsCountAfter = (
      db.raw.prepare("SELECT count(*) AS n FROM search_fts").get() as { n: number }
    ).n;
    expect(ftsCountAfter).toBe(1); // only the real task's row survives
  });
});
