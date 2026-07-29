import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildExportArchive, type ExportArchive, type ExportArchiveInput, type ProfileData } from "./exportArchive.js";
import { INTERCHANGE_SCHEMA_VERSION, parseImportArchive, type ImportArchiveInput } from "./importArchive.js";

/** The test's own sha256 hex — mirrors the shape `main` injects, kept out of `@nexus/core`. */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** A fresh, valid Yjs update: one paragraph holding `text`. Used wherever a test needs real (decodable) note/version bytes. */
function docSnapshot(text: string): Uint8Array {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment("default").push([paragraph]);
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
}

/** One JSON object per line, matching `buildExportArchive`'s own NDJSON shape (empty input -> empty string). */
function ndjson(records: readonly Record<string, unknown>[]): string {
  if (records.length === 0) return "";
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

/** Converts a built archive into what a real caller would hand the reader: NDJSON/manifest text, `.ydoc` bytes, and the set of blob names actually on disk — never `tables/*.csv` or the Markdown mirror, which this module never reads. */
function toImportInput(archive: ExportArchive): ImportArchiveInput {
  const files = new Map<string, string>();
  for (const [path, content] of archive.files) {
    if (path === "manifest.json" || path.startsWith("data/")) files.set(path, content);
  }
  const ydocs = new Map<string, Uint8Array>();
  const blobNames = new Set<string>();
  for (const binary of archive.binaries) {
    if (binary.kind === "bytes") ydocs.set(binary.path, binary.bytes);
    else blobNames.add(binary.sha256);
  }
  return { files, ydocs, blobNames, hash: sha256 };
}

function emptyExportInput(): ExportArchiveInput {
  return {
    profile: { id: "profile1", name: "Luka" },
    appVersion: "0.1.0",
    createdAt: "2026-07-11T10:00:00.000Z",
    settings: {
      flags: { tasks: true, notes: false },
      notifications: { quietFrom: null, quietTo: null, morningHour: "08:00", enabledSources: ["document", "exam"] },
    },
    data: {
      tasks: [],
      events: [],
      documents: [],
      renewals: [],
      subjects: [],
      exams: [],
      decks: [],
      cards: [],
      reviewLog: [],
      plans: [],
      blocks: [],
      focusSessions: [],
      notifications: [],
      notes: [],
      noteFolders: [],
      noteTags: [],
      noteTagLinks: [],
      noteTemplates: [],
      noteAttachments: [],
      noteVersions: [],
    },
    hash: sha256,
  };
}

/** Every collection non-empty, every cross-reference resolved, two attachments sharing one hash, a two-deep folder nest, notes with and without a snapshot. The round trip's fixture. */
function richProfileData(): ProfileData {
  return {
    tasks: [
      // Recurring (ADR-024): the rule and the due date it phases from travel together.
      {
        id: "task-parent", profileId: "profile1", parentId: null, title: "Roditeljski zadatak",
        description: null, status: "todo", priority: "none", done: false, dueDate: "2026-08-01",
        startDate: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
        completedAt: null,
        recurrence: { freq: { kind: "monthly-date", interval: 1, day: 1 }, end: { kind: "count", total: 12 } },
      },
      {
        id: "task-child", profileId: "profile1", parentId: "task-parent", title: "Podzadatak",
        description: "Opis", status: "done", priority: "high", done: true, dueDate: null,
        startDate: "2026-07-05", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z",
        completedAt: "2026-07-02T00:00:00.000Z", recurrence: null,
      },
    ],
    events: [
      {
        id: "event-1", profileId: "profile1", title: "Sastanak", description: null,
        startAt: "2026-07-11T10:00:00.000Z", endAt: "2026-07-11T11:00:00.000Z", allDay: false,
        location: "Kancelarija", category: "posao", createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        recurrence: { freq: { kind: "weekly", interval: 1, days: [5] }, end: { kind: "until", date: "2026-12-31" } },
        recurrenceExdates: ["2026-07-18", "2026-08-15"],
      },
    ],
    documents: [
      {
        id: "doc-1", profileId: "profile1", docType: "licna_karta", label: "Lična karta",
        expiryDate: "2030-01-01", reminderOffsets: [90, 30, 7], notes: null,
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    renewals: [
      { id: "renewal-1", documentId: "doc-1", previousExpiry: "2020-01-01", renewedAt: "2026-01-01T00:00:00.000Z" },
    ],
    subjects: [
      {
        id: "subj-1", profileId: "profile1", name: "Analiza", color: "jade", semester: null,
        archived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    exams: [
      {
        id: "exam-1", profileId: "profile1", subjectId: "subj-1", examType: "pismeni",
        examDate: "2026-08-01", scope: null, createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    decks: [
      {
        id: "deck-1", profileId: "profile1", subjectId: "subj-1", name: "Glava 1",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    cards: [
      {
        id: "card-1", profileId: "profile1", deckId: "deck-1", front: "Q1", back: "A1",
        sourceNoteId: null, sourceBlockKey: null,
        due: "2026-01-02T00:00:00.000Z", stability: 1, difficulty: 2, elapsedDays: 0,
        scheduledDays: 1, learningSteps: 0, reps: 0, lapses: 0, state: 0, lastReview: null,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
      // Note-sourced (NOTE-006): the pair the archive shipped without, and the
      // reason the round trip below is the acceptance criterion rather than a
      // formality — this card's FSRS history only survives while its origin does.
      {
        id: "card-2", profileId: "profile1", deckId: "deck-1", front: "Q2", back: "A2",
        sourceNoteId: "note-1", sourceBlockKey: "blok-1",
        due: "2026-01-05T00:00:00.000Z", stability: 4, difficulty: 6, elapsedDays: 2,
        scheduledDays: 3, learningSteps: 1, reps: 5, lapses: 1, state: 2,
        lastReview: "2026-01-02T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    reviewLog: [
      {
        id: "review-1", profileId: "profile1", cardId: "card-1", rating: 3, state: 2,
        due: "2026-01-03T00:00:00.000Z", stability: 1, difficulty: 2, elapsedDays: 1,
        lastElapsedDays: 0, scheduledDays: 1, learningSteps: 0, review: "2026-01-02T00:00:00.000Z",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    plans: [
      {
        id: "plan-1", profileId: "profile1", examId: "exam-1", dailyMinutes: 60,
        startDate: "2026-07-01", examWeekBoost: true, createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    blocks: [
      {
        id: "block-1", planId: "plan-1", profileId: "profile1", blockDate: "2026-07-02",
        minutes: 60, status: "planned", createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    focusSessions: [
      {
        id: "focus-1", profileId: "profile1", subjectId: "subj-1", startedAt: "2026-07-01T10:00:00.000Z",
        endedAt: "2026-07-01T11:00:00.000Z", createdAt: "2026-07-01T11:00:00.000Z",
        updatedAt: "2026-07-01T11:00:00.000Z",
      },
    ],
    notifications: [
      {
        id: "notif-1", profileId: "profile1", source: "exam", entityId: "exam-1", occurrenceKey: "d-1",
        title: "Ispit sutra", body: "Analiza — pismeni", status: "delivered", snoozedUntil: null,
        deliveredAt: "2026-07-10T08:00:00.000Z", createdAt: "2026-07-10T08:00:00.000Z",
        updatedAt: "2026-07-10T08:00:00.000Z",
      },
    ],
    noteFolders: [
      {
        id: "folder-root", profileId: "profile1", parentId: null, name: "Posao", color: "zlato",
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "folder-child", profileId: "profile1", parentId: "folder-root", name: "Projekti", color: null,
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    noteTags: [{ id: "tag-1", profileId: "profile1", name: "posao", createdAt: "2026-07-01T00:00:00.000Z" }],
    notes: [
      {
        id: "note-1", profileId: "profile1", title: "Prva beleška", folderId: "folder-child",
        pinned: true, cardDeckId: "deck-1", createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z", snapshot: docSnapshot("Sadržaj prve beleške"),
      },
      {
        id: "note-2", profileId: "profile1", title: "Druga beleška", folderId: null,
        pinned: false, cardDeckId: null, createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z", snapshot: null,
      },
    ],
    noteTagLinks: [{ noteId: "note-1", tagId: "tag-1" }],
    noteTemplates: [
      {
        id: "tmpl-1", profileId: "profile1", name: "Sastanak", content: '{"type":"doc","content":[]}',
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    noteAttachments: [
      {
        id: "att-1", noteId: "note-1", fileName: "slika.png", mime: "image/png", sizeBytes: 10,
        sha256: "a".repeat(64), createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "att-2", noteId: "note-1", fileName: "slika2.png", mime: "image/png", sizeBytes: 20,
        sha256: "a".repeat(64), createdAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    noteVersions: [
      {
        noteId: "note-1", coveredSeq: 1, title: "Prva beleška v1", createdAt: "2026-07-01T00:00:00.000Z",
        snapshot: docSnapshot("Verzija 1"),
      },
      {
        noteId: "note-1", coveredSeq: 2, title: "Prva beleška v2", createdAt: "2026-07-01T01:00:00.000Z",
        snapshot: docSnapshot("Verzija 2"),
      },
    ],
  };
}

describe("parseImportArchive — round trip", () => {
  it("parses buildExportArchive's own output back to the exact ProfileData it was given", () => {
    const input: ExportArchiveInput = { ...emptyExportInput(), data: richProfileData() };
    const archive = buildExportArchive(input);
    const result = parseImportArchive(toImportInput(archive));

    expect(result.problems).toEqual([]);
    expect(result.manifest).not.toBeNull();
    expect(result.data).toEqual(input.data);
  });
});

describe("parseImportArchive — empty archive", () => {
  it("round-trips zero rows everywhere with no problems", () => {
    const input = emptyExportInput();
    const archive = buildExportArchive(input);
    const result = parseImportArchive(toImportInput(archive));

    expect(result.problems).toEqual([]);
    expect(result.data).toEqual(input.data);
  });
});

// --- Manifest-shaped fixtures for the per-problem-code tests below ----------

interface BaseFilesOptions {
  schemaVersion?: string;
  fileContents?: Partial<Record<string, string>>;
}

const EMPTY_DATA_FILE_NAMES = [
  "data/tasks.ndjson",
  "data/calendar.ndjson",
  "data/study.ndjson",
  "data/notifications.ndjson",
  "data/notes.ndjson",
] as const;

/** A minimal, fully valid manifest+data-files set (5 empty NDJSON files, checksums matching), so an individual test can override exactly one thing and stay isolated from every other rule. */
function baseFiles(options: BaseFilesOptions = {}): Map<string, string> {
  const contents: Record<string, string> = { ...Object.fromEntries(EMPTY_DATA_FILE_NAMES.map((p) => [p, ""])) };
  for (const [path, content] of Object.entries(options.fileContents ?? {})) {
    if (content !== undefined) contents[path] = content;
  }

  const checksums: Record<string, string> = {};
  for (const path of EMPTY_DATA_FILE_NAMES) checksums[path] = sha256(contents[path] ?? "");

  const manifest = {
    schemaVersion: options.schemaVersion ?? INTERCHANGE_SCHEMA_VERSION,
    appVersion: "0.1.0",
    createdAt: "2026-07-11T10:00:00.000Z",
    profile: { id: "profile1", name: "Luka" },
    settings: {
      flags: {},
      notifications: { quietFrom: null, quietTo: null, morningHour: "08:00", enabledSources: [] },
    },
    modules: [],
    checksums,
    blobs: [],
  };

  const files = new Map<string, string>();
  files.set("manifest.json", JSON.stringify(manifest));
  for (const path of EMPTY_DATA_FILE_NAMES) files.set(path, contents[path] ?? "");
  return files;
}

function emptyInputWith(files: Map<string, string>, extra: Partial<ImportArchiveInput> = {}): ImportArchiveInput {
  return { files, ydocs: new Map(), blobNames: new Set(), hash: sha256, ...extra };
}

const VALID_TASK = {
  type: "task", id: "t1", profileId: "profile1", parentId: null, title: "A", description: null,
  status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", completedAt: null,
  recurrence: null,
};

const VALID_EVENT = {
  type: "event", id: "e1", profileId: "profile1", title: "Sastanak", description: null,
  startAt: "2026-07-10T09:00:00.000Z", endAt: null, allDay: false, location: null, category: null,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
  recurrence: null, recurrenceExdates: [],
};

const WEEKLY_RULE = { freq: { kind: "weekly", interval: 1, days: [4] }, end: { kind: "never" } };

const VALID_NOTE = {
  type: "note", id: "n1", profileId: "profile1", title: "Beleška", folderId: null, pinned: false,
  cardDeckId: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
};

const VALID_SUBJECT = {
  type: "subject", id: "s1", profileId: "profile1", name: "Analiza", color: "jade", semester: null,
  archived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

const VALID_DECK = {
  type: "deck", id: "dk1", profileId: "profile1", subjectId: "s1", name: "Glava 1",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

const VALID_CARD = {
  type: "card", id: "c1", profileId: "profile1", deckId: "dk1", front: "Q", back: "A",
  sourceNoteId: null, sourceBlockKey: null, due: "2026-01-02T00:00:00.000Z", stability: 1,
  difficulty: 2, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: 0, lapses: 0,
  state: 0, lastReview: null, createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("parseImportArchive — one test per problem code", () => {
  it("missing-manifest: manifest.json absent", () => {
    const result = parseImportArchive(emptyInputWith(new Map()));
    expect(result.problems).toEqual([{ severity: "error", code: "missing-manifest", path: "manifest.json" }]);
    expect(result.manifest).toBeNull();
    expect(result.data).toBeNull();
  });

  it("invalid-manifest: not valid JSON", () => {
    const files = baseFiles();
    files.set("manifest.json", "{not json");
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toEqual([{ severity: "error", code: "invalid-manifest", path: "manifest.json" }]);
    expect(result.manifest).toBeNull();
    expect(result.data).toBeNull();
  });

  it("invalid-manifest: missing a required field", () => {
    const files = baseFiles();
    const manifest = JSON.parse(files.get("manifest.json") ?? "{}") as Record<string, unknown>;
    delete manifest.profile;
    files.set("manifest.json", JSON.stringify(manifest));
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toEqual([
      { severity: "error", code: "invalid-manifest", path: "manifest.json", detail: "profile" },
    ]);
    expect(result.manifest).toBeNull();
    expect(result.data).toBeNull();
  });

  it("unsupported-schema-version: a newer minor is refused", () => {
    const files = baseFiles({ schemaVersion: "1.1.0" });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toEqual([
      { severity: "error", code: "unsupported-schema-version", path: "manifest.json", detail: "1.1.0" },
    ]);
    expect(result.data).toBeNull();
  });

  it("missing-data-file: the manifest carries a checksum for a file that is absent", () => {
    const files = baseFiles();
    files.delete("data/tasks.ndjson");
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({ severity: "error", code: "missing-data-file", path: "data/tasks.ndjson" });
    expect(result.data).toBeNull();
  });

  it("checksum-mismatch: a data file's content does not hash to the manifest's recorded checksum", () => {
    const files = baseFiles();
    files.set("data/tasks.ndjson", ndjson([VALID_TASK]));
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({ severity: "error", code: "checksum-mismatch", path: "data/tasks.ndjson" });
    expect(result.data).toBeNull();
  });

  it("invalid-json: a line that is not valid JSON", () => {
    const files = baseFiles({ fileContents: { "data/tasks.ndjson": "not-json{\n" } });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({ severity: "error", code: "invalid-json", path: "data/tasks.ndjson", line: 1 });
    expect(result.data).toBeNull();
  });

  // An unknown type cannot come from a newer Nexus — the version gate refuses
  // those outright — so it is corruption, and restoring around it would drop
  // real rows from a backup.
  it("unknown-record-type: an error that refuses the whole restore", () => {
    const files = baseFiles({ fileContents: { "data/tasks.ndjson": ndjson([{ type: "bogus" }]) } });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toEqual([
      { severity: "error", code: "unknown-record-type", path: "data/tasks.ndjson", line: 1, detail: "bogus" },
    ]);
    expect(result.data).toBeNull();
  });

  it("invalid-record: a known type missing a required field", () => {
    const files = baseFiles({ fileContents: { "data/tasks.ndjson": ndjson([{ type: "task", id: "t1" }]) } });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 1, detail: "profileId",
    });
    expect(result.data).toBeNull();
  });

  it("invalid-record: a known type inside the wrong file", () => {
    const files = baseFiles({ fileContents: { "data/study.ndjson": ndjson([VALID_TASK]) } });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/study.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });

  it("duplicate-id: two rows sharing the same id in one collection", () => {
    const files = baseFiles({ fileContents: { "data/tasks.ndjson": ndjson([VALID_TASK, VALID_TASK]) } });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/tasks.ndjson", line: 2, detail: "t1",
    });
    expect(result.data).toBeNull();
  });

  it("unknown-reference: a foreign key pointing at a row that does not exist", () => {
    const task = { ...VALID_TASK, parentId: "ghost" };
    const files = baseFiles({ fileContents: { "data/tasks.ndjson": ndjson([task]) } });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/tasks.ndjson", line: 1, detail: "parentId=ghost",
    });
    expect(result.data).toBeNull();
  });

  it("reference-cycle: two tasks whose parentId chain loops", () => {
    const a = { ...VALID_TASK, id: "a", parentId: "b" };
    const b = { ...VALID_TASK, id: "b", parentId: "a" };
    const files = baseFiles({ fileContents: { "data/tasks.ndjson": ndjson([a, b]) } });
    const result = parseImportArchive(emptyInputWith(files));
    const cycleProblem = result.problems.find((p) => p.code === "reference-cycle");
    expect(cycleProblem).toMatchObject({ severity: "error", path: "data/tasks.ndjson" });
    expect(["a", "b"]).toContain(cycleProblem?.detail);
    expect(result.data).toBeNull();
  });

  it("unknown-reference: a card whose sourceNoteId names no restored note", () => {
    const card = { ...VALID_CARD, sourceNoteId: "ghost", sourceBlockKey: "blok-1" };
    const files = baseFiles({
      fileContents: { "data/study.ndjson": ndjson([VALID_SUBJECT, VALID_DECK, card]) },
    });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/study.ndjson", line: 3,
      detail: "sourceNoteId=ghost",
    });
    expect(result.data).toBeNull();
  });

  it("invalid-record: a card carrying a source note but no block key to reconcile it against", () => {
    const card = { ...VALID_CARD, sourceNoteId: "n1", sourceBlockKey: null };
    const files = baseFiles({
      fileContents: {
        "data/notes.ndjson": ndjson([VALID_NOTE]),
        "data/study.ndjson": ndjson([VALID_SUBJECT, VALID_DECK, card]),
      },
    });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/study.ndjson", line: 3,
      detail: "sourceBlockKey",
    });
    expect(result.data).toBeNull();
  });

  it("invalid-ydoc: a note's snapshot bytes do not decode as a Yjs update", () => {
    const files = baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_NOTE]) } });
    const ydocs = new Map<string, Uint8Array>([
      ["data/notes/n1.ydoc", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
    ]);
    const result = parseImportArchive(emptyInputWith(files, { ydocs }));
    expect(result.problems).toContainEqual({ severity: "error", code: "invalid-ydoc", path: "data/notes/n1.ydoc" });
    expect(result.data).toBeNull();
  });

  it("missing-ydoc: a note-version's required snapshot file is absent", () => {
    const version = {
      type: "note-version", noteId: "n1", coveredSeq: 1, title: "Beleška", createdAt: "2026-07-01T00:00:00.000Z",
    };
    const files = baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_NOTE, version]) } });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "missing-ydoc", path: "data/note-versions/n1/1.ydoc",
    });
    expect(result.data).toBeNull();
  });

  it("missing-blob: a warning, and the attachment row still restores", () => {
    const attachment = {
      type: "note-attachment", id: "att1", noteId: "n1", fileName: "slika.png", mime: "image/png",
      sizeBytes: 10, sha256: "a".repeat(64), createdAt: "2026-07-01T00:00:00.000Z",
    };
    const files = baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_NOTE, attachment]) } });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toEqual([
      { severity: "warning", code: "missing-blob", path: `blobs/${"a".repeat(64)}`, detail: "att1" },
    ]);
    expect(result.data).not.toBeNull();
    expect(result.data?.noteAttachments).toEqual([
      { id: "att1", noteId: "n1", fileName: "slika.png", mime: "image/png", sizeBytes: 10, sha256: "a".repeat(64), createdAt: "2026-07-01T00:00:00.000Z" },
    ]);
  });
});

describe("parseImportArchive — recurrence (ADR-024)", () => {
  /** The `invalid-record` details a one-row file produced, in discovery order. */
  function detailsFor(path: string, row: Record<string, unknown>): (string | undefined)[] {
    const result = parseImportArchive(emptyInputWith(baseFiles({ fileContents: { [path]: ndjson([row]) } })));
    expect(result.data).toBeNull();
    return result.problems.filter((problem) => problem.code === "invalid-record").map((p) => p.detail);
  }

  it("accepts a task whose rule sits beside the due date it phases from, and canonicalizes it", () => {
    const task = {
      ...VALID_TASK,
      dueDate: "2026-08-01",
      // Weekday list out of order: the reader returns the engine's canonical form.
      recurrence: { freq: { kind: "weekly", interval: 2, days: [4, 1] }, end: { kind: "never" } },
    };
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/tasks.ndjson": ndjson([task]) } })),
    );
    expect(result.problems).toEqual([]);
    expect(result.data?.tasks[0]?.recurrence).toEqual({
      freq: { kind: "weekly", interval: 2, days: [1, 4] },
      end: { kind: "never" },
    });
  });

  const BAD_TASKS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "the field is absent entirely", row: { recurrence: undefined }, detail: "recurrence" },
    { name: "the rule is not an object", row: { recurrence: "daily" }, detail: "recurrence" },
    {
      name: "an interval outside the engine's bounds",
      row: { dueDate: "2026-08-01", recurrence: { freq: { kind: "daily", interval: 0 }, end: { kind: "never" } } },
      detail: "recurrence",
    },
    {
      name: "an unknown frequency kind",
      row: { dueDate: "2026-08-01", recurrence: { freq: { kind: "hourly", interval: 1 }, end: { kind: "never" } } },
      detail: "recurrence",
    },
    {
      name: "an until date that is not a real calendar day",
      row: {
        dueDate: "2026-08-01",
        recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2026-02-30" } },
      },
      detail: "recurrence",
    },
    {
      name: "a rule with no due date to advance",
      row: { dueDate: null, recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } } },
      detail: "recurrence",
    },
  ];

  for (const { name, row, detail } of BAD_TASKS) {
    it(`refuses a task with ${name}`, () => {
      expect(detailsFor("data/tasks.ndjson", { ...VALID_TASK, ...row })).toContain(detail);
    });
  }

  it("accepts an event master with a rule and its exceptions", () => {
    const event = { ...VALID_EVENT, recurrence: WEEKLY_RULE, recurrenceExdates: ["2026-07-17"] };
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/calendar.ndjson": ndjson([event]) } })),
    );
    expect(result.problems).toEqual([]);
    expect(result.data?.events[0]?.recurrence).toEqual(WEEKLY_RULE);
    expect(result.data?.events[0]?.recurrenceExdates).toEqual(["2026-07-17"]);
  });

  const BAD_EVENTS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "no exdate list at all", row: { recurrenceExdates: undefined }, detail: "recurrenceExdates" },
    { name: "an exdate list that is not an array", row: { recurrenceExdates: "2026-07-17" }, detail: "recurrenceExdates" },
    {
      name: "an exdate that is not a real calendar day",
      row: { recurrence: WEEKLY_RULE, recurrenceExdates: ["2026-02-30"] },
      detail: "recurrenceExdates[0]",
    },
    {
      name: "an exdate that is an instant rather than a date",
      row: { recurrence: WEEKLY_RULE, recurrenceExdates: ["2026-07-17T00:00:00.000Z"] },
      detail: "recurrenceExdates[0]",
    },
    {
      name: "exceptions but no series to except them from",
      row: { recurrence: null, recurrenceExdates: ["2026-07-17"] },
      detail: "recurrenceExdates",
    },
    {
      name: "a rule on a start whose own day does not exist",
      row: { startAt: "2026-02-30T09:00:00.000Z", recurrence: WEEKLY_RULE },
      detail: "startAt",
    },
  ];

  for (const { name, row, detail } of BAD_EVENTS) {
    it(`refuses an event with ${name}`, () => {
      expect(detailsFor("data/calendar.ndjson", { ...VALID_EVENT, ...row })).toContain(detail);
    });
  }
});

describe("parseImportArchive — schema version", () => {
  it("is 1.0.0 for this build", () => {
    expect(INTERCHANGE_SCHEMA_VERSION).toBe("1.0.0");
  });

  it("accepts the exact current version", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.0.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // INTERCHANGE_SCHEMA_VERSION's minor and patch are already 0 — semver
  // components are non-negative, so there is no constructible version that is
  // "older" on minor or patch without also being negative. Both cases are
  // therefore degenerate with "equal" at this constant; a genuinely older
  // build number will exist once the schema first revises past 1.0.0.
  it("accepts what would be an older patch or minor, degenerate at the current 1.0.0 constant", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.0.0" })));
    expect(result.problems).toEqual([]);
  });

  it("accepts a newer patch", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.0.7" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  it("refuses a newer minor", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.1.0" })));
    expect(result.problems).toEqual([
      { severity: "error", code: "unsupported-schema-version", path: "manifest.json", detail: "1.1.0" },
    ]);
    expect(result.data).toBeNull();
  });

  it("refuses a newer major", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "2.0.0" })));
    expect(result.problems).toEqual([
      { severity: "error", code: "unsupported-schema-version", path: "manifest.json", detail: "2.0.0" },
    ]);
    expect(result.data).toBeNull();
  });

  it("refuses major 0", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "0.9.0" })));
    expect(result.problems).toEqual([
      { severity: "error", code: "unsupported-schema-version", path: "manifest.json", detail: "0.9.0" },
    ]);
    expect(result.data).toBeNull();
  });

  it("refuses a malformed version string", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "abc" })));
    expect(result.problems).toEqual([
      { severity: "error", code: "unsupported-schema-version", path: "manifest.json", detail: "abc" },
    ]);
    expect(result.data).toBeNull();
  });
});

describe("parseImportArchive — warnings never withhold data", () => {
  it("returns data with several missing-blob warnings present", () => {
    const attachments = ["b", "c"].map((letter, index) => ({
      type: "note-attachment", id: `att${index}`, noteId: "n1", fileName: "x.png", mime: "image/png",
      sizeBytes: 5, sha256: letter.repeat(64), createdAt: "2026-07-01T00:00:00.000Z",
    }));
    const files = baseFiles({
      fileContents: { "data/notes.ndjson": ndjson([VALID_NOTE, ...attachments]) },
    });
    const result = parseImportArchive(emptyInputWith(files));

    expect(result.problems.map((p) => p.code)).toEqual(["missing-blob", "missing-blob"]);
    expect(result.problems.every((p) => p.severity === "warning")).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data?.noteAttachments).toHaveLength(2);
  });
});

describe("parseImportArchive — checksum coverage", () => {
  it("refuses a data file the manifest declares no checksum for", () => {
    const files = baseFiles();
    const manifest = JSON.parse(files.get("manifest.json") ?? "{}") as { checksums: Record<string, string> };
    delete manifest.checksums["data/tasks.ndjson"];
    files.set("manifest.json", JSON.stringify(manifest));

    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "checksum-mismatch", path: "data/tasks.ndjson", detail: "undeclared",
    });
    expect(result.data).toBeNull();
  });

  it("accepts an archive that declares fewer files than this build writes, as an older one would", () => {
    const files = baseFiles();
    const manifest = JSON.parse(files.get("manifest.json") ?? "{}") as { checksums: Record<string, string> };
    delete manifest.checksums["data/notes.ndjson"];
    files.set("manifest.json", JSON.stringify(manifest));
    files.delete("data/notes.ndjson");

    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });
});

describe("parseImportArchive — settings", () => {
  function withSettings(notifications: Record<string, unknown>): ImportArchiveInput {
    const files = baseFiles();
    const manifest = JSON.parse(files.get("manifest.json") ?? "{}") as { settings: Record<string, unknown> };
    manifest.settings = { flags: {}, notifications };
    files.set("manifest.json", JSON.stringify(manifest));
    return emptyInputWith(files);
  }

  it("refuses an enabled source outside migration 009's CHECK", () => {
    const result = parseImportArchive(
      withSettings({ quietFrom: null, quietTo: null, morningHour: "08:00", enabledSources: ["document", "nope"] }),
    );
    expect(result.problems).toEqual([
      {
        severity: "error", code: "invalid-manifest", path: "manifest.json",
        detail: "settings.notifications.enabledSources[1]",
      },
    ]);
  });

  it("refuses a morning hour that is not HH:MM", () => {
    const result = parseImportArchive(
      withSettings({ quietFrom: null, quietTo: null, morningHour: "8am", enabledSources: [] }),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-manifest", path: "manifest.json",
      detail: "settings.notifications.morningHour",
    });
  });

  it("refuses a half-set quiet-hours pair", () => {
    const result = parseImportArchive(
      withSettings({ quietFrom: "22:00", quietTo: null, morningHour: "08:00", enabledSources: [] }),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-manifest", path: "manifest.json",
      detail: "settings.notifications.quietTo",
    });
  });

  it("accepts a fully set quiet-hours pair", () => {
    const result = parseImportArchive(
      withSettings({ quietFrom: "22:00", quietTo: "07:00", morningHour: "08:00", enabledSources: ["exam"] }),
    );
    expect(result.problems).toEqual([]);
    expect(result.manifest?.settings.notifications.quietFrom).toBe("22:00");
  });
});
