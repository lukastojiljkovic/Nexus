import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIME_FAMILIES, mimeFamily } from "@nexus/core";
import {
  AttachmentIndexStore,
  AttachmentIndexValidationError,
  MAX_ATTACHMENT_INDEX_ENTRIES,
  MAX_ATTACHMENT_QUERY_LENGTH,
  NexusDatabase,
  NoteAttachmentStore,
  NoteStore,
  SubjectAttachmentStore,
  SubjectStore,
  TaskAttachmentStore,
  TaskListStore,
  TaskStore,
  openDatabase,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-attachment-index-"));
  db = openDatabase({ path: join(dir, "attachment-index.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  const created = new Date().toISOString();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", created);
  // Every profile has an Inbox (TASK-004): `TaskStore` refuses to place a task
  // without one, so a fixture missing it is a state the app cannot reach.
  new TaskListStore(db.raw, id).ensureInbox(created);
  return id;
}

interface Fixture {
  index: AttachmentIndexStore;
  notes: NoteStore;
  noteFiles: NoteAttachmentStore;
  tasks: TaskStore;
  taskFiles: TaskAttachmentStore;
  subjects: SubjectStore;
  subjectFiles: SubjectAttachmentStore;
  profileId: string;
}

function fixture(profileId = createProfile()): Fixture {
  return {
    index: new AttachmentIndexStore(db.raw, profileId),
    notes: new NoteStore(db.raw, profileId),
    noteFiles: new NoteAttachmentStore(db.raw, profileId),
    tasks: new TaskStore(db.raw, profileId),
    taskFiles: new TaskAttachmentStore(db.raw, profileId),
    subjects: new SubjectStore(db.raw, profileId),
    subjectFiles: new SubjectAttachmentStore(db.raw, profileId),
    profileId,
  };
}

const T1 = "2026-07-30T10:00:00.000Z";
const T2 = "2026-07-30T11:00:00.000Z";
const T3 = "2026-07-30T12:00:00.000Z";
const T4 = "2026-07-30T13:00:00.000Z";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

/** Creates a titled note — the title is a denormalized column `appendUpdate` writes, so a real title needs a real append. */
function titledNote(f: Fixture, title: string): string {
  const note = f.notes.create(T1);
  f.notes.appendUpdate(note.id, Uint8Array.from([1, 2, 3]), title, T1);
  return note.id;
}

function noteFile(
  f: Fixture,
  noteId: string,
  fileName: string,
  overrides: { mime?: string; sizeBytes?: number; sha256?: string; at?: string } = {},
): string {
  return f.noteFiles.add(
    noteId,
    {
      fileName,
      mime: overrides.mime ?? "application/pdf",
      sizeBytes: overrides.sizeBytes ?? 1024,
      sha256: overrides.sha256 ?? SHA_A,
    },
    overrides.at ?? T1,
  ).id;
}

describe("AttachmentIndexStore — the union", () => {
  it("answers with every public attachment of the profile, newest first", () => {
    const f = fixture();
    const noteId = titledNote(f, "Zapisnik");
    const task = f.tasks.create({ title: "Prijava" });
    const subject = f.subjects.create({ name: "Analiza 1" });

    noteFile(f, noteId, "zapisnik.pdf", { at: T1 });
    f.taskFiles.add(task.id, { fileName: "prijava.pdf", mime: "application/pdf", sizeBytes: 2048, sha256: SHA_B }, T2);
    f.subjectFiles.add(subject.id, { fileName: "skripta.pdf", mime: "application/pdf", sizeBytes: 4096, sha256: SHA_A }, T3);

    const page = f.index.list();
    expect(page.truncated).toBe(false);
    expect(page.entries.map((entry) => entry.fileName)).toEqual([
      "skripta.pdf",
      "prijava.pdf",
      "zapisnik.pdf",
    ]);
    expect(page.entries.map((entry) => entry.ownerKind)).toEqual(["subject", "task", "note"]);
  });

  it("carries each attachment's own row plus the title of whatever owns it", () => {
    const f = fixture();
    const noteId = titledNote(f, "Zapisnik sa sastanka");
    const id = noteFile(f, noteId, "zapisnik.pdf", { sizeBytes: 4321, sha256: SHA_B, at: T2 });

    expect(f.index.list().entries).toEqual([
      {
        id,
        ownerKind: "note",
        ownerId: noteId,
        ownerTitle: "Zapisnik sa sastanka",
        fileName: "zapisnik.pdf",
        mime: "application/pdf",
        sizeBytes: 4321,
        sha256: SHA_B,
        createdAt: T2,
      },
    ]);
  });

  it("names the task's title and the subject's name as the owner title", () => {
    const f = fixture();
    const task = f.tasks.create({ title: "Prijava ispita" });
    const subject = f.subjects.create({ name: "Diskretna matematika" });
    f.taskFiles.add(task.id, { fileName: "a.pdf", mime: "application/pdf", sizeBytes: 10, sha256: SHA_A }, T1);
    f.subjectFiles.add(subject.id, { fileName: "b.pdf", mime: "application/pdf", sizeBytes: 10, sha256: SHA_A }, T2);

    expect(f.index.list().entries.map((entry) => entry.ownerTitle)).toEqual([
      "Diskretna matematika",
      "Prijava ispita",
    ]);
  });

  it("keeps an untitled note's empty title rather than inventing one", () => {
    const f = fixture();
    const note = f.notes.create(T1);
    noteFile(f, note.id, "bez-naslova.pdf");
    expect(f.index.list().entries[0]?.ownerTitle).toBe("");
  });

  it("breaks a created_at tie by id, so the order is total rather than whatever the union happened to emit", () => {
    const f = fixture();
    const noteId = titledNote(f, "Isti trenutak");
    const ids = [
      noteFile(f, noteId, "prvi.pdf", { at: T1 }),
      noteFile(f, noteId, "drugi.pdf", { at: T1 }),
      noteFile(f, noteId, "treci.pdf", { at: T1 }),
    ];

    // Descending by id — the ONLY thing left to order by once the timestamps
    // are equal, and a real tie: within one millisecond a UUIDv7 differs from
    // its neighbour only in its random tail.
    expect(f.index.list().entries.map((entry) => entry.id)).toEqual([...ids].sort().reverse());
  });

  it("never dedupes by blob hash: one file on two records is two attachments", () => {
    const f = fixture();
    const noteId = titledNote(f, "Ugovor");
    const task = f.tasks.create({ title: "Potpisati ugovor" });
    noteFile(f, noteId, "ugovor.pdf", { sha256: SHA_A, at: T1 });
    f.taskFiles.add(task.id, { fileName: "ugovor-kopija.pdf", mime: "application/pdf", sizeBytes: 1024, sha256: SHA_A }, T2);

    const entries = f.index.list().entries;
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.sha256 === SHA_A)).toBe(true);
    expect(entries.map((entry) => entry.ownerKind)).toEqual(["task", "note"]);
  });

  it("shows nothing from another profile", () => {
    const mine = fixture();
    const theirs = fixture();
    const theirNote = titledNote(theirs, "Tuđa beleška");
    noteFile(theirs, theirNote, "tudje.pdf");

    expect(mine.index.list().entries).toEqual([]);
    expect(theirs.index.list().entries).toHaveLength(1);
  });
});

describe("AttachmentIndexStore — what „deleted“ means on each side", () => {
  it("hides the attachments of a soft-deleted note, task and subject, and shows them again on restore", () => {
    const f = fixture();
    const noteId = titledNote(f, "Beleška");
    const task = f.tasks.create({ title: "Zadatak" });
    const subject = f.subjects.create({ name: "Predmet" });
    noteFile(f, noteId, "a.pdf", { at: T1 });
    f.taskFiles.add(task.id, { fileName: "b.pdf", mime: "application/pdf", sizeBytes: 10, sha256: SHA_A }, T2);
    f.subjectFiles.add(subject.id, { fileName: "c.pdf", mime: "application/pdf", sizeBytes: 10, sha256: SHA_A }, T3);
    expect(f.index.list().entries).toHaveLength(3);

    f.notes.softDelete(noteId, T3);
    f.tasks.softDelete(task.id, T3);
    f.subjects.softDelete(subject.id);
    expect(f.index.list().entries).toEqual([]);

    f.notes.restore(noteId, T3);
    f.tasks.restore(task.id, T3);
    f.subjects.restore(subject.id);
    expect(f.index.list().entries).toHaveLength(3);
  });

  it("drops an attachment the owning surface removed — an attachment row has no soft delete of its own", () => {
    const f = fixture();
    const noteId = titledNote(f, "Beleška");
    const id = noteFile(f, noteId, "a.pdf");
    f.noteFiles.remove(noteId, id);
    expect(f.index.list().entries).toEqual([]);
  });

  it("never reads the sealed private section", () => {
    const f = fixture();
    // PRIV keeps no attachment TABLE at all (migration 045): a private note's
    // files live inside its sealed envelope, so the union has nothing of the
    // private section to touch even by accident. This pins that a private note
    // existing changes nothing about what „Datoteke“ shows.
    db.raw
      .prepare(
        "INSERT INTO private_notes (id, profile_id, sealed, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(uuidv7(), f.profileId, Buffer.from([1, 2, 3]), T1, T1);
    expect(f.index.list().entries).toEqual([]);
  });
});

describe("AttachmentIndexStore — the filters", () => {
  function corpus(): Fixture {
    const f = fixture();
    const noteId = titledNote(f, "Putovanje u Beč");
    const task = f.tasks.create({ title: "Poslati račun" });
    const subject = f.subjects.create({ name: "Analiza 1" });
    // Four distinct instants, so every ordering asserted below is the
    // `created_at DESC` the store promises rather than an id tiebreak between
    // two rows that happened to land in the same second.
    noteFile(f, noteId, "karta.png", { mime: "image/png", sizeBytes: 100, at: T1 });
    noteFile(f, noteId, "plan.txt", { mime: "text/plain", sizeBytes: 200, at: T2 });
    f.taskFiles.add(task.id, { fileName: "račun.pdf", mime: "application/pdf", sizeBytes: 300, sha256: SHA_A }, T3);
    f.subjectFiles.add(subject.id, { fileName: "skripta.zip", mime: "application/zip", sizeBytes: 400, sha256: SHA_B }, T4);
    return f;
  }

  it("narrows to one owner kind", () => {
    const f = corpus();
    expect(f.index.list({ ownerKind: "note" }).entries.map((entry) => entry.fileName)).toEqual([
      "plan.txt",
      "karta.png",
    ]);
    expect(f.index.list({ ownerKind: "task" }).entries.map((entry) => entry.fileName)).toEqual([
      "račun.pdf",
    ]);
    expect(f.index.list({ ownerKind: "subject" }).entries.map((entry) => entry.fileName)).toEqual([
      "skripta.zip",
    ]);
  });

  it("narrows to one mime family, exactly as `mimeFamily` reads the same mimes", () => {
    const f = corpus();
    const all = f.index.list().entries;
    for (const family of MIME_FAMILIES) {
      expect(f.index.list({ family }).entries.map((entry) => entry.id), family).toEqual(
        all.filter((entry) => mimeFamily(entry.mime) === family).map((entry) => entry.id),
      );
    }
    expect(f.index.list({ family: "slika" }).entries.map((entry) => entry.fileName)).toEqual([
      "karta.png",
    ]);
    expect(f.index.list({ family: "ostalo" }).entries.map((entry) => entry.fileName)).toEqual([
      "skripta.zip",
    ]);
  });

  it("agrees with `mimeFamily` over a corpus of mimes the sniffer never returns either", () => {
    const f = fixture();
    const noteId = titledNote(f, "Razno");
    const mimes = [
      "image/png",
      "image/svg+xml",
      "application/pdf",
      "text/plain",
      "text/markdown",
      "application/zip",
      "application/octet-stream",
      "audio/mpeg",
    ];
    for (const mime of mimes) noteFile(f, noteId, `${mime.replace("/", "-")}.bin`, { mime });

    for (const family of MIME_FAMILIES) {
      expect(f.index.list({ family }).entries.map((entry) => entry.mime).sort(), family).toEqual(
        mimes.filter((mime) => mimeFamily(mime) === family).sort(),
      );
    }
  });

  it("matches the query against the file name, folded", () => {
    const f = corpus();
    expect(f.index.list({ query: "racun" }).entries.map((entry) => entry.fileName)).toEqual([
      "račun.pdf",
    ]);
    expect(f.index.list({ query: "RAČUN" }).entries.map((entry) => entry.fileName)).toEqual([
      "račun.pdf",
    ]);
  });

  it("matches the query against the OWNER's title too — a file is findable by what carries it", () => {
    const f = corpus();
    expect(f.index.list({ query: "bec" }).entries.map((entry) => entry.fileName)).toEqual([
      "plan.txt",
      "karta.png",
    ]);
    expect(f.index.list({ query: "analiza" }).entries.map((entry) => entry.fileName)).toEqual([
      "skripta.zip",
    ]);
  });

  it("treats a blank query as no query at all", () => {
    const f = corpus();
    expect(f.index.list({ query: "   " }).entries).toHaveLength(4);
    expect(f.index.list({ query: "" }).entries).toHaveLength(4);
    expect(f.index.list({ query: null }).entries).toHaveLength(4);
  });

  it("composes the three filters — kind AND family AND query", () => {
    const f = corpus();
    expect(
      f.index.list({ ownerKind: "note", family: "tekst", query: "bec" }).entries.map((e) => e.fileName),
    ).toEqual(["plan.txt"]);
    // The same query under a family the note's text file is not in yields nothing.
    expect(f.index.list({ ownerKind: "note", family: "pdf", query: "bec" }).entries).toEqual([]);
  });
});

describe("AttachmentIndexStore — the cap", () => {
  it("stops at MAX_ATTACHMENT_INDEX_ENTRIES and says so rather than cutting quietly", () => {
    const f = fixture();
    const noteId = titledNote(f, "Mnogo priloga");
    for (let i = 0; i < MAX_ATTACHMENT_INDEX_ENTRIES + 5; i += 1) {
      noteFile(f, noteId, `prilog-${i}.pdf`);
    }

    const page = f.index.list();
    expect(page.entries).toHaveLength(MAX_ATTACHMENT_INDEX_ENTRIES);
    expect(page.truncated).toBe(true);
  });

  it("reports no truncation when the filtered set fits exactly", () => {
    const f = fixture();
    const noteId = titledNote(f, "Tačno na granici");
    for (let i = 0; i < MAX_ATTACHMENT_INDEX_ENTRIES; i += 1) {
      noteFile(f, noteId, `prilog-${i}.pdf`);
    }

    const page = f.index.list();
    expect(page.entries).toHaveLength(MAX_ATTACHMENT_INDEX_ENTRIES);
    expect(page.truncated).toBe(false);
  });

  it("caps the FILTERED set, so a narrow filter over a big library is complete", () => {
    const f = fixture();
    const noteId = titledNote(f, "Mnogo priloga");
    for (let i = 0; i < MAX_ATTACHMENT_INDEX_ENTRIES + 5; i += 1) {
      noteFile(f, noteId, `prilog-${i}.pdf`);
    }
    noteFile(f, noteId, "jedina.png", { mime: "image/png" });

    const page = f.index.list({ family: "slika" });
    expect(page.entries.map((entry) => entry.fileName)).toEqual(["jedina.png"]);
    expect(page.truncated).toBe(false);
  });
});

describe("AttachmentIndexStore — revalidation (the renderer is untrusted)", () => {
  it("refuses an owner kind outside the three public surfaces", () => {
    const f = fixture();
    expect(() => f.index.list({ ownerKind: "priv" as never })).toThrow(
      AttachmentIndexValidationError,
    );
  });

  it("refuses a mime family outside the closed four", () => {
    const f = fixture();
    expect(() => f.index.list({ family: "video" as never })).toThrow(
      AttachmentIndexValidationError,
    );
  });

  it("refuses a query longer than the cap rather than folding a novel", () => {
    const f = fixture();
    expect(() => f.index.list({ query: "a".repeat(MAX_ATTACHMENT_QUERY_LENGTH + 1) })).toThrow(
      AttachmentIndexValidationError,
    );
    expect(() => f.index.list({ query: "a".repeat(MAX_ATTACHMENT_QUERY_LENGTH) })).not.toThrow();
  });
});
