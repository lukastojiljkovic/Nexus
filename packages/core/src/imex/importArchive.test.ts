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
    profile: { id: "profile1", name: "Luka", picture: null },
    appVersion: "0.1.0",
    createdAt: "2026-07-11T10:00:00.000Z",
    settings: {
      flags: { tasks: true, notes: false },
      notifications: {
        quietFrom: null,
        quietTo: null,
        morningHour: "08:00",
        enabledSources: ["document", "exam"],
        snoozeDefault: "10m",
      },
    },
    data: {
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
      subjects: [],
      subjectAttachments: [],
      subjectNoteLinks: [],
      exams: [],
      decks: [],
      cards: [],
      reviewLog: [],
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
    },
    hash: sha256,
  };
}

/** Every collection non-empty, every cross-reference resolved, two attachments sharing one hash, a two-deep folder nest, notes with and without a snapshot. The round trip's fixture. */
function richProfileData(): ProfileData {
  return {
    tasks: [
      // Recurring (ADR-024), and reminded (ADR-028): the rule, the ladder and
      // the due date both of them anchor on travel together. Filed in a
      // SECTION of a non-Inbox list (TASK-004), so the round trip carries the
      // full placement rather than the default one.
      {
        id: "task-parent", profileId: "profile1", parentId: null, title: "Roditeljski zadatak",
        description: null, status: "todo", priority: "none", done: false, dueDate: "2026-08-01",
        startDate: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
        completedAt: null,
        recurrence: { freq: { kind: "monthly-date", interval: 1, day: 1 }, end: { kind: "count", total: 12 } },
        reminderOffsets: [0, 3],
        listId: "list-work", sectionId: "section-doing", position: 1024,
      },
      {
        id: "task-child", profileId: "profile1", parentId: "task-parent", title: "Podzadatak",
        description: "Opis", status: "done", priority: "high", done: true, dueDate: null,
        startDate: "2026-07-05", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z",
        completedAt: "2026-07-02T00:00:00.000Z", recurrence: null, reminderOffsets: [],
        // A negative position: prepending walks below zero, so the round trip
        // has to carry one verbatim.
        listId: "list-inbox", sectionId: null, position: -1024,
      },
    ],
    // A nested list under the Inbox, so the parent chain travels too.
    taskLists: [
      {
        id: "list-inbox", profileId: "profile1", parentId: null, name: "Inbox", isInbox: true,
        defaultView: "list", viewConfig: null, position: 1024, createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      // And carrying what it remembers about its views (ADR-050): every one of
      // the four, so the round trip proves the whole shape survives rather than
      // its simplest corner.
      {
        id: "list-work", profileId: "profile1", parentId: "list-inbox", name: "Posao", isInbox: false,
        defaultView: "kanban",
        viewConfig: {
          list: { sort: { field: "dueDate", direction: "asc" }, filters: { status: "todo" } },
          kanban: { groupBy: "section" },
          cards: { sort: { field: "title", direction: "desc" } },
          calendar: { filters: { priority: "high" } },
        },
        position: 2048, createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    taskSections: [
      {
        id: "section-doing", listId: "list-work", name: "U toku", position: 1024,
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    // Two tags, one of them attached: an unattached tag is as real a row as an
    // attached one, and the round trip has to carry both.
    taskTags: [
      { id: "ttag-work", profileId: "profile1", name: "posao", createdAt: "2026-07-01T00:00:00.000Z" },
      { id: "ttag-idle", profileId: "profile1", name: "kasnije", createdAt: "2026-07-01T00:00:00.000Z" },
    ],
    taskTagLinks: [{ taskId: "task-parent", tagId: "ttag-work" }],
    // Two attachments on two different tasks, the second one sharing its hash
    // with a NOTE attachment below: `blobs/` is one namespace over one on-disk
    // store, so the round trip has to carry a cross-module dedup as well as a
    // plain row.
    taskAttachments: [
      {
        id: "tatt-1", taskId: "task-parent", fileName: "ugovor.pdf", mime: "application/pdf",
        sizeBytes: 30, sha256: "c".repeat(64), createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "tatt-2", taskId: "task-child", fileName: "slika.png", mime: "image/png",
        sizeBytes: 10, sha256: "a".repeat(64), createdAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    // Two templates, and the pair is the point: one carrying every field a
    // payload has (relative due date, ladder, rule, tag names, subtasks) and one
    // carrying only a title, which is the other legal extreme.
    taskTemplates: [
      {
        id: "ttpl-review", profileId: "profile1", name: "Nedeljni pregled",
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z",
        payload: {
          title: "Nedeljni pregled",
          description: "Prođi kroz sve liste",
          priority: "high",
          dueOffsetDays: 7,
          reminderOffsets: [0, 1],
          recurrence: { freq: { kind: "weekly", interval: 1, days: [1] }, end: { kind: "never" } },
          tagNames: ["posao", "kasnije"],
          subtaskTitles: ["Inbox na nulu", "Pregledaj kalendar"],
        },
      },
      {
        id: "ttpl-bare", profileId: "profile1", name: "Brza beleška",
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
        payload: {
          title: "Zapiši", description: null, priority: "none", dueOffsetDays: null,
          reminderOffsets: [], recurrence: null, tagNames: [], subtaskTitles: [],
        },
      },
    ],
    // A real edge between the two tasks (ADR-037): the DIRECTION is the record,
    // so a round trip that lost it would restore a plan with its order reversed
    // and nothing on screen to say so.
    taskDependencies: [{ blockerId: "task-child", blockedId: "task-parent" }],
    events: [
      {
        id: "event-1", profileId: "profile1", title: "Sastanak", description: null,
        startAt: "2026-07-11T10:00:00.000Z", endAt: "2026-07-11T11:00:00.000Z", allDay: false,
        location: "Kancelarija", category: "posao", createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        recurrence: { freq: { kind: "weekly", interval: 1, days: [5] }, end: { kind: "until", date: "2026-12-31" } },
        recurrenceExdates: ["2026-07-18", "2026-08-15"],
        reminderOffsets: [10, 1440],
      },
    ],
    // Two templates, and the pair is the point: one carrying every field a
    // payload has — a time of day, a duration, the three text fields, a ladder
    // and a rule — and one all-day carrying only a title, which is the other
    // legal extreme (an all-day template may hold neither clock nor duration).
    eventTemplates: [
      {
        id: "etpl-training", profileId: "profile1", name: "Trening",
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z",
        payload: {
          title: "Trening",
          allDay: false,
          startTime: "18:30",
          durationMinutes: 90,
          location: "Teretana",
          description: "Noge i leđa",
          category: "zdravlje",
          reminderOffsets: [10, 60],
          recurrence: { freq: { kind: "weekly", interval: 1, days: [1, 3] }, end: { kind: "never" } },
        },
      },
      {
        id: "etpl-holiday", profileId: "profile1", name: "Slobodan dan",
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
        payload: {
          title: "Slobodan dan", allDay: true, startTime: null, durationMinutes: null,
          location: null, description: null, category: null,
          reminderOffsets: [], recurrence: null,
        },
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
    people: [
      {
        id: "person-1", profileId: "profile1", name: "Marko", kind: "birthday", month: 3, day: 14,
        year: 1990, note: "Voli čaj", createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      // A leap-day birthday with no known year and no note — the two shapes a
      // person row can legitimately take beside the fully-filled one above.
      {
        id: "person-2", profileId: "profile1", name: "Prestupna", kind: "anniversary", month: 2, day: 29,
        year: null, note: null, createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    // Deliberately SET (ADR-054): a round trip that carried the both-null
    // default would pass even if the record were dropped entirely.
    calendarSettings: [
      { profileId: "profile1", semesterStart: "2026-10-01", semesterEnd: "2027-01-31" },
    ],
    subjects: [
      {
        id: "subj-1", profileId: "profile1", name: "Analiza", color: "jade", semester: null,
        archived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    // One material and one linked note (STUDY-001): the material's bytes join
    // the same `blobs/` namespace the two attachment tables above already share,
    // and the link's other end lives in `data/notes.ndjson` — a reference the
    // reader has to resolve ACROSS files.
    subjectAttachments: [
      {
        id: "satt-1", subjectId: "subj-1", fileName: "skripta.pdf", mime: "application/pdf",
        sizeBytes: 40, sha256: "d".repeat(64), createdAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    subjectNoteLinks: [
      { subjectId: "subj-1", noteId: "note-1", createdAt: "2026-07-02T00:00:00.000Z" },
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
        kind: "basic", clozeText: null, clozeOrdinal: null, problemSteps: null,
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
        kind: "basic", clozeText: null, clozeOrdinal: null, problemSteps: null,
        due: "2026-01-05T00:00:00.000Z", stability: 4, difficulty: 6, elapsedDays: 2,
        scheduledDays: 3, learningSteps: 1, reps: 5, lapses: 1, state: 2,
        lastReview: "2026-01-02T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
      },
      // Cloze (STUDY-006 / ADR-042): the rendered sides AND the template they
      // were derived from. A restore that dropped `clozeText` would leave a
      // card whose owner can no longer edit anything about it.
      {
        id: "card-3", profileId: "profile1", deckId: "deck-1",
        front: "Glavni grad je […], a reka je Sava.",
        back: "Glavni grad je Beograd, a reka je Sava.",
        sourceNoteId: null, sourceBlockKey: null,
        kind: "cloze", clozeText: "Glavni grad je {{Beograd}}, a reka je {{Sava}}.",
        clozeOrdinal: 0, problemSteps: null,
        due: "2026-01-06T00:00:00.000Z", stability: 2, difficulty: 3, elapsedDays: 1,
        scheduledDays: 2, learningSteps: 0, reps: 2, lapses: 0, state: 2,
        lastReview: "2026-01-04T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z",
      },
      // Problem (ADR-046): a BASIC card that also carries the worked solution
      // its `back` was derived from. A restore that dropped `problemSteps`
      // would keep the answer but lose the steps the reviewer reveals one at a
      // time — and the only text its owner can edit.
      {
        id: "card-4", profileId: "profile1", deckId: "deck-1",
        front: "Nađi izvod od $x^2$ u tački $x=1$.",
        back: "Izvod je $2x$.\n\nU tački $x=1$ to je $2$.",
        sourceNoteId: null, sourceBlockKey: null,
        kind: "basic", clozeText: null, clozeOrdinal: null,
        problemSteps: "Izvod je $2x$.\n--\nU tački $x=1$ to je $2$.",
        due: "2026-01-07T00:00:00.000Z", stability: 3, difficulty: 4, elapsedDays: 0,
        scheduledDays: 1, learningSteps: 0, reps: 1, lapses: 0, state: 2,
        lastReview: "2026-01-05T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z",
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
    // Deliberately NON-default on all three (STUDY-007): a round trip that
    // carried the defaults would pass even if the record were dropped entirely.
    studySettings: [
      { profileId: "profile1", targetRetention: 0.95, newPerDay: 7, maxReviewsPerDay: 120 },
    ],
    notifications: [
      {
        id: "notif-1", profileId: "profile1", source: "exam", entityId: "exam-1", occurrenceKey: "d-1",
        title: "Ispit sutra", body: "Analiza — pismeni", status: "delivered", snoozedUntil: null,
        deliveredAt: "2026-07-10T08:00:00.000Z", createdAt: "2026-07-10T08:00:00.000Z",
        updatedAt: "2026-07-10T08:00:00.000Z",
      },
    ],
    // One folder of each shape (NOTE-002): a round trip where every folder
    // opened as a list would pass even if `defaultView` were dropped on the way
    // out, since "absent" and "list" parse back to the same thing.
    noteFolders: [
      {
        id: "folder-root", profileId: "profile1", parentId: null, name: "Posao", color: "zlato",
        defaultTemplateId: "builtin:sastanak", isCaptureDefault: true, defaultView: "list",
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "folder-child", profileId: "profile1", parentId: "folder-root", name: "Projekti", color: null,
        defaultTemplateId: null, isCaptureDefault: false, defaultView: "cards",
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
    // A background sharing the attachments' hash deliberately (ADR-041): the
    // blob union has to declare it ONCE, and the round trip has to carry the
    // settings row whole either way. The active board (ADR-055) names the
    // named set below, so the pointer's round trip is proved too.
    dashboardSettings: [
      {
        profileId: "profile1", backgroundHash: "a".repeat(64), backgroundMime: "image/jpeg",
        backgroundSizeBytes: 10, backgroundDim: 65, activeSetId: "dset-1",
      },
    ],
    // One named board (DASH-008 / ADR-055), so the round trip carries a set
    // row, a widget filed into it AND widgets on the default (null) board.
    dashboardSets: [
      {
        id: "dset-1", profileId: "profile1", name: "Fakultet", position: 1024,
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    // A rearranged layout (ADR-045): the same widget placed twice at different
    // sizes — a layout, not a mistake — plus one carrying config, so the round
    // trip proves the opaque JSON survives verbatim. `setId` explicit on every
    // row, null and named alike: the writer emits the resolved value.
    dashboardWidgets: [
      {
        instanceId: "dw-1", profileId: "profile1", widgetId: "calendar:danas", size: "L",
        position: 1024, config: null,
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z",
        setId: null,
      },
      {
        instanceId: "dw-2", profileId: "profile1", widgetId: "study:ispiti", size: "S",
        position: 2048, config: '{"limit":3}',
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
        setId: null,
      },
      {
        instanceId: "dw-3", profileId: "profile1", widgetId: "calendar:danas", size: "S",
        position: 3072, config: null,
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
        setId: "dset-1",
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

describe("parseImportArchive — files it does not know", () => {
  it("ignores the archive's own data/calendar.ics, which `toImportInput` hands it verbatim", () => {
    const archive = buildExportArchive({ ...emptyExportInput(), data: richProfileData() });
    const input = toImportInput(archive);

    // The convenience copy really is in the map this reader was handed — the
    // tolerance below is not vacuous (CAL-008: it is checksummed by nobody and
    // parsed by nobody, so a restore must simply not care that it is there).
    expect(input.files.has("data/calendar.ics")).toBe(true);
    expect(parseImportArchive(input).problems).toEqual([]);
  });

  it("ignores an entirely unknown data file too", () => {
    const files = baseFiles();
    files.set("data/whatever.txt", "ne znam šta je ovo");
    expect(parseImportArchive(emptyInputWith(files)).problems).toEqual([]);
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
  /**
   * What the manifest's `profile.picture` says (SET-001, `1.18.0`). ABSENT here
   * leaves the key off the manifest entirely — the pre-`1.18.0` shape, and the
   * default every other test in this file keeps reading against.
   */
  profilePicture?: unknown;
}

const EMPTY_DATA_FILE_NAMES = [
  "data/tasks.ndjson",
  "data/calendar.ndjson",
  "data/study.ndjson",
  "data/notifications.ndjson",
  "data/notes.ndjson",
  "data/dashboard.ndjson",
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
    profile: {
      id: "profile1",
      name: "Luka",
      ...("profilePicture" in options ? { picture: options.profilePicture } : {}),
    },
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

/** The list `VALID_TASK` lives in — a task at this build's era must always name one, so the two travel together (see `tasksFile`). */
const VALID_TASK_LIST = {
  type: "task-list", id: "tl1", profileId: "profile1", parentId: null, name: "Inbox",
  isInbox: true, defaultView: "list", position: 1024,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
};

const VALID_TASK = {
  type: "task", id: "t1", profileId: "profile1", parentId: null, title: "A", description: null,
  status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", completedAt: null,
  recurrence: null, reminderOffsets: [], listId: "tl1", sectionId: null, position: 1024,
};

/**
 * `data/tasks.ndjson` holding `rows` behind the list they reference, so a test
 * that cares about a TASK does not have to restate its container. Line numbers
 * therefore start at 2 for the first task — the tests that assert one say so.
 */
function tasksFile(rows: readonly Record<string, unknown>[]): string {
  return ndjson([VALID_TASK_LIST, ...rows]);
}

const VALID_EVENT = {
  type: "event", id: "e1", profileId: "profile1", title: "Sastanak", description: null,
  startAt: "2026-07-10T09:00:00.000Z", endAt: null, allDay: false, location: null, category: null,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
  recurrence: null, recurrenceExdates: [], reminderOffsets: [],
};

const WEEKLY_RULE = { freq: { kind: "weekly", interval: 1, days: [4] }, end: { kind: "never" } };

const VALID_PERSON = {
  type: "person", id: "pe1", profileId: "profile1", name: "Marko", kind: "birthday",
  month: 3, day: 14, year: 1990, note: "Voli čaj", createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const VALID_NOTE = {
  type: "note", id: "n1", profileId: "profile1", title: "Beleška", folderId: null, pinned: false,
  cardDeckId: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
};

/** A `note-folder` row as THIS build writes it (ADR-036 added the two preference fields at the 1.7.0 bump, NOTE-002 `defaultView` at 1.17.0). */
const VALID_NOTE_FOLDER = {
  type: "note-folder", id: "nf1", profileId: "profile1", parentId: null, name: "Posao",
  color: "zlato", defaultTemplateId: null, isCaptureDefault: false, defaultView: "list",
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
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

/**
 * The manifest's `profile.picture` (SET-001, `1.18.0`): absent and null both mean
 * "no picture", a declared one is validated strictly in every era, and a picture
 * whose blob the archive does not carry is a WARNING — the profile restores
 * either way and simply comes back without one.
 */
describe("parseImportArchive — the profile picture", () => {
  const PICTURE_HASH = "c".repeat(64);
  const PICTURE = { hash: PICTURE_HASH, mime: "image/png", sizeBytes: 4096 };

  it("reads null when the key is absent — every pre-1.18.0 archive", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles()));
    expect(result.problems).toEqual([]);
    expect(result.manifest?.profile.picture).toBeNull();
  });

  it("reads null when the key is explicitly null", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ profilePicture: null })));
    expect(result.problems).toEqual([]);
    expect(result.manifest?.profile.picture).toBeNull();
  });

  it("reads a declared picture whose blob the archive carries", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ profilePicture: PICTURE }), {
        blobNames: new Set([PICTURE_HASH]),
      }),
    );
    expect(result.problems).toEqual([]);
    expect(result.manifest?.profile.picture).toEqual(PICTURE);
  });

  it("warns (never refuses) when the picture's blob is missing from the archive", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ profilePicture: PICTURE })));
    expect(result.problems).toEqual([
      {
        severity: "warning",
        code: "missing-blob",
        path: `blobs/${PICTURE_HASH}`,
        detail: "profile1",
      },
    ]);
    expect(result.data).not.toBeNull();
  });

  it("refuses a hash that is not a content address", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ profilePicture: { ...PICTURE, hash: "nope" } })),
    );
    expect(result.problems).toEqual([
      {
        severity: "error",
        code: "invalid-manifest",
        path: "manifest.json",
        detail: "profile.picture.hash",
      },
    ]);
  });

  it("refuses a mime outside the inline-image set", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ profilePicture: { ...PICTURE, mime: "application/pdf" } })),
    );
    expect(result.problems).toEqual([
      {
        severity: "error",
        code: "invalid-manifest",
        path: "manifest.json",
        detail: "profile.picture.mime",
      },
    ]);
  });

  it("refuses a non-positive size", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ profilePicture: { ...PICTURE, sizeBytes: 0 } })),
    );
    expect(result.problems).toEqual([
      {
        severity: "error",
        code: "invalid-manifest",
        path: "manifest.json",
        detail: "profile.picture.sizeBytes",
      },
    ]);
  });

  it("refuses a half-set picture — the nested object is what makes that unrepresentable", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ profilePicture: { hash: PICTURE_HASH } })),
    );
    expect(result.problems).toEqual([
      {
        severity: "error",
        code: "invalid-manifest",
        path: "manifest.json",
        detail: "profile.picture.mime",
      },
    ]);
  });

  it("survives a full write/read round trip through buildExportArchive", () => {
    const input = emptyExportInput();
    input.profile.picture = PICTURE;
    const archive = buildExportArchive(input);
    const result = parseImportArchive(toImportInput(archive));
    expect(result.problems).toEqual([]);
    expect(result.manifest?.profile.picture).toEqual(PICTURE);
  });
});

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

  // `1.22.0`: the nearest minor strictly ahead of this build's `1.21.0`.
  it("unsupported-schema-version: a newer minor is refused", () => {
    const files = baseFiles({ schemaVersion: "1.22.0" });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toEqual([
      { severity: "error", code: "unsupported-schema-version", path: "manifest.json", detail: "1.22.0" },
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
    files.set("data/tasks.ndjson", tasksFile([VALID_TASK]));
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

  it("invalid-record: a cloze card whose ordinal its own template does not contain", () => {
    // The one check no CHECK constraint can make: the archive says "this row
    // asks deletion 3", the template holds one. Restoring it would land a card
    // whose blank nothing can fill, so the grammar is re-run here.
    const card = {
      ...VALID_CARD, kind: "cloze", clozeText: "Glavni grad je {{Beograd}}.", clozeOrdinal: 3,
    };
    const files = baseFiles({
      fileContents: { "data/study.ndjson": ndjson([VALID_SUBJECT, VALID_DECK, card]) },
    });
    const result = parseImportArchive(emptyInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/study.ndjson", line: 3,
      detail: "clozeOrdinal",
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

describe("parseImportArchive — task lists and sections (TASK-004 / ADR-029)", () => {
  const VALID_SECTION = {
    type: "task-section", id: "ts1", listId: "tl1", name: "U toku", position: 1024,
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
  };

  /** Parses a `data/tasks.ndjson` built from `rows` verbatim — no list prepended, so a test can state exactly what its archive holds. */
  function parseTasksFile(rows: readonly Record<string, unknown>[]) {
    return parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/tasks.ndjson": ndjson(rows) } })),
    );
  }

  it("round-trips a nested list, a section and a task placed in it", () => {
    const child = {
      ...VALID_TASK_LIST, id: "tl2", parentId: "tl1", name: "Posao", isInbox: false,
      defaultView: "kanban", position: 2048,
    };
    const section = { ...VALID_SECTION, listId: "tl2" };
    const task = { ...VALID_TASK, listId: "tl2", sectionId: "ts1", position: -1024 };

    const result = parseTasksFile([VALID_TASK_LIST, child, section, task]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskLists).toEqual([
      {
        id: "tl1", profileId: "profile1", parentId: null, name: "Inbox", isInbox: true,
        defaultView: "list", viewConfig: null, position: 1024, createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "tl2", profileId: "profile1", parentId: "tl1", name: "Posao", isInbox: false,
        defaultView: "kanban", viewConfig: null, position: 2048, createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    expect(result.data?.taskSections).toEqual([
      {
        id: "ts1", listId: "tl2", name: "U toku", position: 1024,
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    // A negative position is a legitimate sort key (prepending walks below
    // zero), so it survives verbatim rather than being clamped.
    expect(result.data?.tasks[0]).toMatchObject({ listId: "tl2", sectionId: "ts1", position: -1024 });
  });

  it("round-trips a list's view config, and reads its absence as no preferences", () => {
    const viewConfig = {
      list: { sort: { field: "dueDate", direction: "asc" }, filters: { status: "todo" } },
      kanban: { groupBy: "section" },
      cards: { sort: { field: "title", direction: "desc" } },
      calendar: { filters: { priority: "high" } },
    };
    const configured = { ...VALID_TASK_LIST, id: "tl2", isInbox: false, viewConfig };

    const result = parseTasksFile([VALID_TASK_LIST, configured]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskLists.map((list) => list.viewConfig)).toEqual([null, viewConfig]);
  });

  it("reads an explicit null and an empty view config as no preferences, never as a stored one", () => {
    const result = parseTasksFile([
      { ...VALID_TASK_LIST, viewConfig: null },
      { ...VALID_TASK_LIST, id: "tl2", isInbox: false, viewConfig: {} },
      { ...VALID_TASK_LIST, id: "tl3", isInbox: false, viewConfig: { cards: {} } },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskLists.map((list) => list.viewConfig)).toEqual([null, null, null]);
  });

  const BAD_LISTS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "an empty name", row: { name: "" }, detail: "name" },
    { name: "a view outside migration 038's CHECK", row: { defaultView: "gantt" }, detail: "defaultView" },
    // A PRESENT view config is validated strictly, the `problemSteps` posture:
    // a hand-edited archive must not smuggle a shape into a column with no CHECK.
    { name: "a view config that is not an object", row: { viewConfig: "{}" }, detail: "viewConfig" },
    { name: "a view config naming a view that does not exist", row: { viewConfig: { gantt: {} } }, detail: "viewConfig" },
    { name: "a view config grouping by something outside the set", row: { viewConfig: { kanban: { groupBy: "tag" } } }, detail: "viewConfig" },
    { name: "a view config sorting by a field the schema has not got", row: { viewConfig: { list: { sort: { field: "listId", direction: "asc" } } } }, detail: "viewConfig" },
    { name: "a view config filtering on a status outside the domain", row: { viewConfig: { cards: { filters: { status: "arhiva" } } } }, detail: "viewConfig" },
    { name: "a non-boolean isInbox", row: { isInbox: 1 }, detail: "isInbox" },
    { name: "a fractional position", row: { position: 1.5 }, detail: "position" },
    { name: "no position at all", row: { position: undefined }, detail: "position" },
    { name: "a missing timestamp", row: { updatedAt: undefined }, detail: "updatedAt" },
  ];

  for (const { name, row, detail } of BAD_LISTS) {
    it(`refuses a task list with ${name}`, () => {
      const result = parseTasksFile([{ ...VALID_TASK_LIST, ...row }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 1, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  const BAD_SECTIONS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "an empty name", row: { name: "" }, detail: "name" },
    { name: "no list to belong to", row: { listId: undefined }, detail: "listId" },
    { name: "a fractional position", row: { position: 0.5 }, detail: "position" },
  ];

  for (const { name, row, detail } of BAD_SECTIONS) {
    it(`refuses a task section with ${name}`, () => {
      const result = parseTasksFile([VALID_TASK_LIST, { ...VALID_SECTION, ...row }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 2, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  it("refuses a task naming a list the archive does not carry", () => {
    const result = parseTasksFile([{ ...VALID_TASK, listId: "ghost" }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/tasks.ndjson", line: 1,
      detail: "listId=ghost",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a section naming a list the archive does not carry", () => {
    const result = parseTasksFile([{ ...VALID_SECTION, listId: "ghost" }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/tasks.ndjson", line: 1,
      detail: "listId=ghost",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a list whose parent chain loops", () => {
    const a = { ...VALID_TASK_LIST, id: "a", parentId: "b", isInbox: false };
    const b = { ...VALID_TASK_LIST, id: "b", parentId: "a", isInbox: false };
    const result = parseTasksFile([a, b]);
    const cycle = result.problems.find((problem) => problem.code === "reference-cycle");
    expect(cycle).toMatchObject({ severity: "error", path: "data/tasks.ndjson" });
    expect(["a", "b"]).toContain(cycle?.detail);
    expect(result.data).toBeNull();
  });

  // The reference no foreign key can express: the section exists, but under a
  // different list, so the task would land under a heading nothing renders.
  it("refuses a task whose section belongs to another list", () => {
    const otherList = { ...VALID_TASK_LIST, id: "tl2", isInbox: false, position: 2048 };
    const section = { ...VALID_SECTION, listId: "tl2" };
    const task = { ...VALID_TASK, listId: "tl1", sectionId: "ts1" };

    const result = parseTasksFile([VALID_TASK_LIST, otherList, section, task]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/tasks.ndjson", line: 4,
      detail: "sectionId=ts1",
    });
    expect(result.data).toBeNull();
  });

  it("accepts that very same task once its section is a section of ITS list", () => {
    const result = parseTasksFile([
      VALID_TASK_LIST,
      VALID_SECTION,
      { ...VALID_TASK, listId: "tl1", sectionId: "ts1" },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data?.tasks[0]?.sectionId).toBe("ts1");
  });

  it("refuses a task-list record filed in the wrong data file", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_TASK_LIST]) } })),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/notes.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });

  // --- The 1.3.0 era gate ------------------------------------------------

  /** Parses `rows` under a manifest declaring `schemaVersion` — the one variable each era case below turns. */
  function parseAtVersion(schemaVersion: string, rows: readonly Record<string, unknown>[]) {
    return parseImportArchive(
      emptyInputWith(
        baseFiles({ schemaVersion, fileContents: { "data/tasks.ndjson": ndjson(rows) } }),
      ),
    );
  }

  const {
    listId: _listId,
    sectionId: _sectionId,
    position: _position,
    ...TASK_WITHOUT_PLACEMENT
  } = VALID_TASK;

  it("defaults a 1.2.0 archive's task placement, so it restores into the Inbox", () => {
    const result = parseAtVersion("1.2.0", [TASK_WITHOUT_PLACEMENT]);
    expect(result.problems).toEqual([]);
    expect(result.data?.tasks[0]).toMatchObject({ listId: null, sectionId: null, position: 0 });
  });

  it("refuses that same row at 1.3.0, naming the field the bump made required", () => {
    const result = parseAtVersion("1.3.0", [TASK_WITHOUT_PLACEMENT]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 1, detail: "listId",
    });
    expect(result.data).toBeNull();
  });

  // An explicit `null` is PRESENT, not absent: a 1.3 writer that emitted the key
  // meant it, and "no list" is not a state a task can be in.
  it("refuses an explicit null listId at 1.3.0", () => {
    const result = parseAtVersion("1.3.0", [{ ...VALID_TASK, listId: null }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 1, detail: "listId",
    });
    expect(result.data).toBeNull();
  });

  // And leniency never weakens a value that IS present, in any era.
  it("validates a present placement strictly at 1.2.0 too", () => {
    const malformed = parseAtVersion("1.2.0", [{ ...TASK_WITHOUT_PLACEMENT, position: "first" }]);
    expect(malformed.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 1, detail: "position",
    });
  });

  // A section without a list is a heading with nothing to head — and at an
  // older era, where `listId` legitimately defaults to null, this is the only
  // check that can catch it.
  it("refuses a 1.2.0 task carrying a sectionId but no listId", () => {
    const result = parseAtVersion("1.2.0", [
      { ...TASK_WITHOUT_PLACEMENT, sectionId: "ts1" },
    ]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 1, detail: "sectionId",
    });
    expect(result.data).toBeNull();
  });
});

describe("parseImportArchive — task tags (migration 023)", () => {
  const VALID_TASK_TAG = {
    type: "task-tag", id: "ttag1", profileId: "profile1", name: "posao",
    createdAt: "2026-07-01T00:00:00.000Z",
  };

  const VALID_TASK_TAG_LINK = { type: "task-tag-link", taskId: "t1", tagId: "ttag1" };

  /** Parses a `data/tasks.ndjson` built from `rows` verbatim — the `task-tag` rows here supply their own containers. */
  function parseTasksFile(rows: readonly Record<string, unknown>[]) {
    return parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/tasks.ndjson": ndjson(rows) } })),
    );
  }

  it("round-trips a tag and the task it is attached to", () => {
    const result = parseTasksFile([VALID_TASK_LIST, VALID_TASK_TAG, VALID_TASK, VALID_TASK_TAG_LINK]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskTags).toEqual([
      { id: "ttag1", profileId: "profile1", name: "posao", createdAt: "2026-07-01T00:00:00.000Z" },
    ]);
    expect(result.data?.taskTagLinks).toEqual([{ taskId: "t1", tagId: "ttag1" }]);
  });

  it("keeps a tag nothing is attached to — an unused label is data, not a dangling row", () => {
    const result = parseTasksFile([VALID_TASK_TAG]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskTags).toHaveLength(1);
    expect(result.data?.taskTagLinks).toEqual([]);
  });

  const BAD_TAGS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "an empty name", row: { name: "" }, detail: "name" },
    { name: "no name at all", row: { name: undefined }, detail: "name" },
    { name: "no profile", row: { profileId: undefined }, detail: "profileId" },
    { name: "a malformed createdAt", row: { createdAt: "juče" }, detail: "createdAt" },
  ];

  for (const { name, row, detail } of BAD_TAGS) {
    it(`refuses a task tag with ${name}`, () => {
      const result = parseTasksFile([{ ...VALID_TASK_TAG, ...row }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 1, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  const BAD_LINKS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "no task", row: { taskId: undefined }, detail: "taskId" },
    { name: "an empty tag id", row: { tagId: "" }, detail: "tagId" },
  ];

  for (const { name, row, detail } of BAD_LINKS) {
    it(`refuses a task tag link with ${name}`, () => {
      const result = parseTasksFile([
        VALID_TASK_LIST, VALID_TASK_TAG, VALID_TASK, { ...VALID_TASK_TAG_LINK, ...row },
      ]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 4, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  it("refuses two tags sharing an id", () => {
    const result = parseTasksFile([VALID_TASK_TAG, { ...VALID_TASK_TAG, name: "drugo" }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/tasks.ndjson", line: 2, detail: "ttag1",
    });
    expect(result.data).toBeNull();
  });

  // A link's identity is its PAIR (migration 023's PRIMARY KEY), so that is
  // what the duplicate rule keys on — the `note-tag-link` arrangement.
  it("refuses the same (task, tag) pair twice, keyed by the pair", () => {
    const result = parseTasksFile([
      VALID_TASK_LIST, VALID_TASK_TAG, VALID_TASK, VALID_TASK_TAG_LINK, VALID_TASK_TAG_LINK,
    ]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/tasks.ndjson", line: 5,
      detail: "taskId=t1,tagId=ttag1",
    });
    expect(result.data).toBeNull();
  });

  it("accepts one task under two tags and one tag over two tasks", () => {
    const secondTag = { ...VALID_TASK_TAG, id: "ttag2", name: "kasnije" };
    const secondTask = { ...VALID_TASK, id: "t2" };
    const result = parseTasksFile([
      VALID_TASK_LIST, VALID_TASK_TAG, secondTag, VALID_TASK, secondTask,
      VALID_TASK_TAG_LINK,
      { ...VALID_TASK_TAG_LINK, tagId: "ttag2" },
      { ...VALID_TASK_TAG_LINK, taskId: "t2" },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskTagLinks).toEqual([
      { taskId: "t1", tagId: "ttag1" },
      { taskId: "t1", tagId: "ttag2" },
      { taskId: "t2", tagId: "ttag1" },
    ]);
  });

  it("refuses a link naming a task the archive does not carry", () => {
    const result = parseTasksFile([VALID_TASK_TAG, { ...VALID_TASK_TAG_LINK, taskId: "ghost" }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/tasks.ndjson", line: 2,
      detail: "taskId=ghost",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a link naming a tag the archive does not carry", () => {
    const result = parseTasksFile([
      VALID_TASK_LIST, VALID_TASK, { ...VALID_TASK_TAG_LINK, tagId: "ghost" },
    ]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/tasks.ndjson", line: 3,
      detail: "tagId=ghost",
    });
    expect(result.data).toBeNull();
  });

  // A task tag is not a note tag: the two live in different files, and a row in
  // the wrong one is a damaged archive rather than something to accept quietly.
  it("refuses a task-tag record filed in the notes file", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_TASK_TAG]) } })),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/notes.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a note-tag record filed in the tasks file", () => {
    const noteTag = {
      type: "note-tag", id: "ntag1", profileId: "profile1", name: "posao",
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    const result = parseTasksFile([noteTag]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });
});

describe("parseImportArchive — card kind (STUDY-006 / ADR-042)", () => {
  /** Parses one card row alongside the subject and deck it needs; returns the parsed card and the problems. */
  function parseCardRow(overrides: Record<string, unknown>) {
    const files = baseFiles({
      fileContents: {
        "data/study.ndjson": ndjson([VALID_SUBJECT, VALID_DECK, { ...VALID_CARD, ...overrides }]),
      },
    });
    return parseImportArchive(emptyInputWith(files));
  }

  const cardDetails = (result: ReturnType<typeof parseCardRow>): (string | undefined)[] =>
    result.problems.filter((problem) => problem.code === "invalid-record").map((p) => p.detail);

  it("defaults an absent kind to basic — no era flag needed for an optional-with-a-default", () => {
    // `VALID_CARD` carries no `kind` at all: exactly a pre-ADR-042 archive's row.
    const result = parseCardRow({});
    expect(result.problems).toEqual([]);
    expect(result.data?.cards[0]).toMatchObject({
      kind: "basic",
      clozeText: null,
      clozeOrdinal: null,
    });
  });

  it("accepts a fully-formed cloze card and keeps its template and ordinal", () => {
    const result = parseCardRow({
      kind: "cloze",
      clozeText: "Glavni grad je {{Beograd}}.",
      clozeOrdinal: 0,
    });
    expect(result.problems).toEqual([]);
    expect(result.data?.cards[0]).toMatchObject({
      kind: "cloze",
      clozeText: "Glavni grad je {{Beograd}}.",
      clozeOrdinal: 0,
    });
  });

  it("accepts an explicitly-basic card that spells both cloze fields as null", () => {
    const result = parseCardRow({ kind: "basic", clozeText: null, clozeOrdinal: null });
    expect(result.problems).toEqual([]);
    expect(result.data?.cards[0]).toMatchObject({ kind: "basic" });
  });

  it("refuses a kind outside the closed set — a present key is strict in every era", () => {
    expect(cardDetails(parseCardRow({ kind: "bogus" }))).toEqual(["kind"]);
    expect(cardDetails(parseCardRow({ kind: null }))).toEqual(["kind"]);
    expect(cardDetails(parseCardRow({ kind: 7 }))).toEqual(["kind"]);
  });

  it("refuses a cloze card missing either half of the pair", () => {
    expect(cardDetails(parseCardRow({ kind: "cloze", clozeOrdinal: 0 }))).toEqual(["clozeText"]);
    expect(cardDetails(parseCardRow({ kind: "cloze", clozeText: "{{A}}" }))).toEqual([
      "clozeOrdinal",
    ]);
  });

  it("refuses a basic card carrying either half of the pair", () => {
    expect(cardDetails(parseCardRow({ clozeText: "{{A}}" }))).toEqual(["clozeText"]);
    expect(cardDetails(parseCardRow({ clozeOrdinal: 0 }))).toEqual(["clozeOrdinal"]);
  });

  it("refuses a malformed clozeText or clozeOrdinal", () => {
    expect(cardDetails(parseCardRow({ kind: "cloze", clozeText: "", clozeOrdinal: 0 }))).toEqual([
      "clozeText",
    ]);
    expect(
      cardDetails(parseCardRow({ kind: "cloze", clozeText: "{{A}}", clozeOrdinal: -1 })),
    ).toEqual(["clozeOrdinal"]);
    expect(
      cardDetails(parseCardRow({ kind: "cloze", clozeText: "{{A}}", clozeOrdinal: 0.5 })),
    ).toEqual(["clozeOrdinal"]);
  });

  it("refuses a cloze template with no deletion at all — ordinal 0 names nothing in it", () => {
    expect(
      cardDetails(parseCardRow({ kind: "cloze", clozeText: "obična rečenica", clozeOrdinal: 0 })),
    ).toEqual(["clozeOrdinal"]);
  });

  // --- Problem steps (ADR-046) ---------------------------------------------

  it("defaults an absent problemSteps to null — no era flag, exactly like kind", () => {
    // `VALID_CARD` carries no `problemSteps` at all: exactly a pre-ADR-046 row.
    const result = parseCardRow({});
    expect(result.problems).toEqual([]);
    expect(result.data?.cards[0]).toMatchObject({ problemSteps: null });
  });

  it("accepts a problem card: a BASIC card that also carries its worked solution", () => {
    const result = parseCardRow({ kind: "basic", problemSteps: "prvi\n--\ndrugi" });
    expect(result.problems).toEqual([]);
    expect(result.data?.cards[0]).toMatchObject({
      kind: "basic",
      problemSteps: "prvi\n--\ndrugi",
      clozeText: null,
    });
  });

  it("treats an explicit null as no worked solution", () => {
    const result = parseCardRow({ problemSteps: null });
    expect(result.problems).toEqual([]);
    expect(result.data?.cards[0]).toMatchObject({ problemSteps: null });
  });

  it("refuses steps on a cloze card — its back already has a source", () => {
    expect(
      cardDetails(
        parseCardRow({ kind: "cloze", clozeText: "{{A}}", clozeOrdinal: 0, problemSteps: "korak" }),
      ),
    ).toEqual(["problemSteps"]);
  });

  it("refuses empty, untrimmed, over-cap and non-string steps", () => {
    expect(cardDetails(parseCardRow({ problemSteps: "" }))).toEqual(["problemSteps"]);
    expect(cardDetails(parseCardRow({ problemSteps: " korak " }))).toEqual(["problemSteps"]);
    expect(cardDetails(parseCardRow({ problemSteps: "x".repeat(10_001) }))).toEqual([
      "problemSteps",
    ]);
    expect(cardDetails(parseCardRow({ problemSteps: 7 }))).toEqual(["problemSteps"]);
  });
});

describe("parseImportArchive — task attachments (migration 024)", () => {
  const SHA = "f".repeat(64);

  const VALID_TASK_ATTACHMENT = {
    type: "task-attachment", id: "tatt1", taskId: "t1", fileName: "ugovor.pdf",
    mime: "application/pdf", sizeBytes: 2048, sha256: SHA,
    createdAt: "2026-07-01T00:00:00.000Z",
  };

  /** Parses a `data/tasks.ndjson` built from `rows` verbatim, with `blobNames` standing in for what the zip actually carries. */
  function parseTasksFile(
    rows: readonly Record<string, unknown>[],
    blobNames: ReadonlySet<string> = new Set([SHA]),
  ) {
    return parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/tasks.ndjson": ndjson(rows) } }), {
        blobNames,
      }),
    );
  }

  it("round-trips an attachment on the task it hangs off", () => {
    const result = parseTasksFile([VALID_TASK_LIST, VALID_TASK, VALID_TASK_ATTACHMENT]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskAttachments).toEqual([
      {
        id: "tatt1", taskId: "t1", fileName: "ugovor.pdf", mime: "application/pdf",
        sizeBytes: 2048, sha256: SHA, createdAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
  });

  const BAD_ROWS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "no id", row: { id: undefined }, detail: "id" },
    { name: "no task", row: { taskId: undefined }, detail: "taskId" },
    { name: "an empty file name", row: { fileName: "" }, detail: "fileName" },
    { name: "no mime", row: { mime: undefined }, detail: "mime" },
    // Migration 024's own CHECK, mirrored here: a zero-byte "attachment" is not a file.
    { name: "a sizeBytes of zero", row: { sizeBytes: 0 }, detail: "sizeBytes" },
    { name: "a fractional sizeBytes", row: { sizeBytes: 1.5 }, detail: "sizeBytes" },
    { name: "an empty sha256", row: { sha256: "" }, detail: "sha256" },
    { name: "a malformed createdAt", row: { createdAt: "juče" }, detail: "createdAt" },
  ];

  for (const { name, row, detail } of BAD_ROWS) {
    it(`refuses a task attachment with ${name}`, () => {
      const result = parseTasksFile([
        VALID_TASK_LIST, VALID_TASK, { ...VALID_TASK_ATTACHMENT, ...row },
      ]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 3, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  it("refuses two attachments sharing an id", () => {
    const result = parseTasksFile([
      VALID_TASK_LIST, VALID_TASK, VALID_TASK_ATTACHMENT, VALID_TASK_ATTACHMENT,
    ]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/tasks.ndjson", line: 4, detail: "tatt1",
    });
    expect(result.data).toBeNull();
  });

  it("refuses an attachment naming a task the archive does not carry", () => {
    const result = parseTasksFile([{ ...VALID_TASK_ATTACHMENT, taskId: "ghost" }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/tasks.ndjson", line: 1,
      detail: "taskId=ghost",
    });
    expect(result.data).toBeNull();
  });

  // Rule 8: a lost file is a warning, never a refusal — the row still restores,
  // and the restore preview is what tells the user how many files did not.
  it("warns (but still parses) when the archive carries no blob for the row", () => {
    const result = parseTasksFile([VALID_TASK_LIST, VALID_TASK, VALID_TASK_ATTACHMENT], new Set());
    expect(result.problems).toEqual([
      { severity: "warning", code: "missing-blob", path: `blobs/${SHA}`, detail: "tatt1" },
    ]);
    expect(result.data?.taskAttachments).toHaveLength(1);
  });

  it("refuses a task-attachment record filed in the notes file", () => {
    const result = parseImportArchive(
      emptyInputWith(
        baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_TASK_ATTACHMENT]) } }),
      ),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/notes.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });
});

describe("parseImportArchive — study settings (migration 034 / STUDY-007)", () => {
  const VALID_STUDY_SETTINGS = {
    type: "study-settings", profileId: "profile1", targetRetention: 0.9,
    newPerDay: 20, maxReviewsPerDay: 200,
  };

  function parseStudyFile(rows: readonly Record<string, unknown>[]) {
    return parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/study.ndjson": ndjson(rows) } })),
    );
  }

  function studyProblem(detail: string) {
    return {
      severity: "error", code: "invalid-record", path: "data/study.ndjson", line: 1, detail,
    };
  }

  it("round-trips the retention and both daily caps", () => {
    const result = parseStudyFile([VALID_STUDY_SETTINGS]);
    expect(result.problems).toEqual([]);
    expect(result.data?.studySettings).toEqual([
      { profileId: "profile1", targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: 200 },
    ]);
  });

  it("keeps a null review cap as null — that is how 'no cap at all' is said", () => {
    const result = parseStudyFile([{ ...VALID_STUDY_SETTINGS, maxReviewsPerDay: null }]);
    expect(result.problems).toEqual([]);
    expect(result.data?.studySettings[0]?.maxReviewsPerDay).toBeNull();
  });

  it("accepts both ends of the retention window and refuses either side of them", () => {
    for (const targetRetention of [0.7, 0.97, 0.835]) {
      expect(parseStudyFile([{ ...VALID_STUDY_SETTINGS, targetRetention }]).problems).toEqual([]);
    }
    for (const targetRetention of [0.69, 0.98, 0, 1, "0.9"]) {
      const result = parseStudyFile([{ ...VALID_STUDY_SETTINGS, targetRetention }]);
      expect(result.problems).toContainEqual(studyProblem("targetRetention"));
      expect(result.data).toBeNull();
    }
  });

  it("accepts 0..100 new cards a day and refuses anything outside, or fractional", () => {
    for (const newPerDay of [0, 100]) {
      expect(parseStudyFile([{ ...VALID_STUDY_SETTINGS, newPerDay }]).problems).toEqual([]);
    }
    for (const newPerDay of [-1, 101, 2.5, null]) {
      const result = parseStudyFile([{ ...VALID_STUDY_SETTINGS, newPerDay }]);
      expect(result.problems).toContainEqual(studyProblem("newPerDay"));
      expect(result.data).toBeNull();
    }
  });

  it("accepts 1..1000 reviews a day and refuses zero — a cap of nothing is not a cap", () => {
    for (const maxReviewsPerDay of [1, 1000]) {
      expect(parseStudyFile([{ ...VALID_STUDY_SETTINGS, maxReviewsPerDay }]).problems).toEqual([]);
    }
    for (const maxReviewsPerDay of [0, -1, 1001, 10.5]) {
      const result = parseStudyFile([{ ...VALID_STUDY_SETTINGS, maxReviewsPerDay }]);
      expect(result.problems).toContainEqual(studyProblem("maxReviewsPerDay"));
      expect(result.data).toBeNull();
    }
  });

  it("refuses a row missing any of the three, or its profile", () => {
    for (const [field, row] of [
      ["profileId", { profileId: undefined }],
      ["targetRetention", { targetRetention: undefined }],
      ["newPerDay", { newPerDay: undefined }],
      ["maxReviewsPerDay", { maxReviewsPerDay: undefined }],
    ] as const) {
      const result = parseStudyFile([{ ...VALID_STUDY_SETTINGS, ...row }]);
      expect(result.problems).toContainEqual(studyProblem(field));
      expect(result.data).toBeNull();
    }
  });

  // One row per profile is migration 034's PRIMARY KEY, so the profile id IS the
  // row's identity — the same rule `dashboard-settings` lives under.
  it("refuses two rows for the same profile", () => {
    const result = parseStudyFile([
      VALID_STUDY_SETTINGS,
      { ...VALID_STUDY_SETTINGS, newPerDay: 5 },
    ]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/study.ndjson", line: 2,
      detail: "profile1",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a study-settings record filed in another data file", () => {
    const result = parseImportArchive(
      emptyInputWith(
        baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_STUDY_SETTINGS]) } }),
      ),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/notes.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });
});

describe("parseImportArchive — calendar settings (migration 042 / ADR-054)", () => {
  const VALID_CALENDAR_SETTINGS = {
    type: "calendar-settings", profileId: "profile1",
    semesterStart: "2026-10-01", semesterEnd: "2027-01-31",
  };

  function parseCalendarFile(rows: readonly Record<string, unknown>[]) {
    return parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/calendar.ndjson": ndjson(rows) } })),
    );
  }

  function calendarProblem(detail: string) {
    return {
      severity: "error", code: "invalid-record", path: "data/calendar.ndjson", line: 1, detail,
    };
  }

  it("round-trips the term's two dates", () => {
    const result = parseCalendarFile([VALID_CALENDAR_SETTINGS]);
    expect(result.problems).toEqual([]);
    expect(result.data?.calendarSettings).toEqual([
      { profileId: "profile1", semesterStart: "2026-10-01", semesterEnd: "2027-01-31" },
    ]);
  });

  it("round-trips the both-null pair — that is how 'no term set' is said", () => {
    const result = parseCalendarFile([
      { ...VALID_CALENDAR_SETTINGS, semesterStart: null, semesterEnd: null },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data?.calendarSettings).toEqual([
      { profileId: "profile1", semesterStart: null, semesterEnd: null },
    ]);
  });

  it("accepts a one-day term — equality is inside the closed range", () => {
    const result = parseCalendarFile([
      { ...VALID_CALENDAR_SETTINGS, semesterEnd: "2026-10-01" },
    ]);
    expect(result.problems).toEqual([]);
  });

  // The store's own pair rule (a term with one edge means nothing), restated
  // here so a half-set pair is a named `invalid-record` rather than a raw
  // SQLite constraint error inside the restore transaction.
  it("refuses a half-set pair, naming the null half", () => {
    const startOnly = parseCalendarFile([{ ...VALID_CALENDAR_SETTINGS, semesterEnd: null }]);
    expect(startOnly.problems).toContainEqual(calendarProblem("semesterEnd"));
    expect(startOnly.data).toBeNull();

    const endOnly = parseCalendarFile([{ ...VALID_CALENDAR_SETTINGS, semesterStart: null }]);
    expect(endOnly.problems).toContainEqual(calendarProblem("semesterEnd"));
    expect(endOnly.data).toBeNull();
  });

  it("refuses a start after its end", () => {
    const result = parseCalendarFile([
      { ...VALID_CALENDAR_SETTINGS, semesterStart: "2027-02-01", semesterEnd: "2026-10-01" },
    ]);
    expect(result.problems).toContainEqual(calendarProblem("semesterEnd"));
    expect(result.data).toBeNull();
  });

  it("refuses a value that is not a real calendar day, shaped or not", () => {
    for (const semesterStart of ["2026-02-30", "oktobar", "2026-13-01", 20261001, undefined]) {
      const result = parseCalendarFile([{ ...VALID_CALENDAR_SETTINGS, semesterStart }]);
      expect(result.problems).toContainEqual(calendarProblem("semesterStart"));
      expect(result.data).toBeNull();
    }
  });

  it("refuses a row missing its profile", () => {
    const result = parseCalendarFile([{ ...VALID_CALENDAR_SETTINGS, profileId: undefined }]);
    expect(result.problems).toContainEqual(calendarProblem("profileId"));
    expect(result.data).toBeNull();
  });

  // One row per profile is migration 042's PRIMARY KEY, so the profile id IS
  // the row's identity — the same rule `study-settings` lives under.
  it("refuses two rows for the same profile", () => {
    const result = parseCalendarFile([
      VALID_CALENDAR_SETTINGS,
      { ...VALID_CALENDAR_SETTINGS, semesterStart: null, semesterEnd: null },
    ]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/calendar.ndjson", line: 2,
      detail: "profile1",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a calendar-settings record filed in another data file", () => {
    const result = parseImportArchive(
      emptyInputWith(
        baseFiles({ fileContents: { "data/study.ndjson": ndjson([VALID_CALENDAR_SETTINGS]) } }),
      ),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/study.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });
});

describe("parseImportArchive — dashboard settings (migration 030 / ADR-041)", () => {
  const HASH = "a".repeat(64);

  const VALID_DASHBOARD = {
    type: "dashboard-settings", profileId: "profile1", backgroundHash: HASH,
    backgroundMime: "image/png", backgroundSizeBytes: 4096, backgroundDim: 40,
  };

  /** Parses a `data/dashboard.ndjson` built from `rows`, with `blobNames` holding the background so the happy path carries no warning. */
  function parseDashboardFile(
    rows: readonly Record<string, unknown>[],
    blobNames: ReadonlySet<string> = new Set([HASH]),
  ) {
    return parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/dashboard.ndjson": ndjson(rows) } }), {
        blobNames,
      }),
    );
  }

  it("round-trips a background and its dim", () => {
    const result = parseDashboardFile([VALID_DASHBOARD]);
    expect(result.problems).toEqual([]);
    expect(result.data?.dashboardSettings).toEqual([
      {
        profileId: "profile1", backgroundHash: HASH, backgroundMime: "image/png",
        backgroundSizeBytes: 4096, backgroundDim: 40, activeSetId: null,
      },
    ]);
  });

  it("round-trips a dim with no background at all — the shape a profile that only moved the slider has", () => {
    const result = parseDashboardFile([
      {
        type: "dashboard-settings", profileId: "profile1", backgroundHash: null,
        backgroundMime: null, backgroundSizeBytes: null, backgroundDim: 0,
      },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data?.dashboardSettings).toEqual([
      {
        profileId: "profile1", backgroundHash: null, backgroundMime: null,
        backgroundSizeBytes: null, backgroundDim: 0, activeSetId: null,
      },
    ]);
  });

  it("accepts both ends of the dim range and refuses either side of them", () => {
    for (const backgroundDim of [0, 90]) {
      expect(parseDashboardFile([{ ...VALID_DASHBOARD, backgroundDim }]).problems).toEqual([]);
    }
    for (const backgroundDim of [-1, 91, 12.5]) {
      const result = parseDashboardFile([{ ...VALID_DASHBOARD, backgroundDim }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/dashboard.ndjson", line: 1,
        detail: "backgroundDim",
      });
      expect(result.data).toBeNull();
    }
  });

  it("accepts every inline image format and refuses anything else", () => {
    for (const backgroundMime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(parseDashboardFile([{ ...VALID_DASHBOARD, backgroundMime }]).problems).toEqual([]);
    }
    for (const backgroundMime of ["image/svg+xml", "application/pdf", "application/octet-stream"]) {
      const result = parseDashboardFile([{ ...VALID_DASHBOARD, backgroundMime }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/dashboard.ndjson", line: 1,
        detail: "backgroundMime",
      });
      expect(result.data).toBeNull();
    }
  });

  const BAD_ROWS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "no profile", row: { profileId: undefined }, detail: "profileId" },
    { name: "a hash that is not a sha256", row: { backgroundHash: "nope" }, detail: "backgroundHash" },
    { name: "an uppercase hash", row: { backgroundHash: "A".repeat(64) }, detail: "backgroundHash" },
    { name: "a hash with no mime", row: { backgroundMime: null }, detail: "backgroundMime" },
    { name: "a mime with no hash", row: { backgroundHash: null }, detail: "backgroundMime" },
    { name: "a hash with no size", row: { backgroundSizeBytes: null }, detail: "backgroundSizeBytes" },
    { name: "a zero size", row: { backgroundSizeBytes: 0 }, detail: "backgroundSizeBytes" },
    { name: "no dim at all", row: { backgroundDim: undefined }, detail: "backgroundDim" },
  ];

  for (const { name, row, detail } of BAD_ROWS) {
    it(`refuses a dashboard row with ${name}`, () => {
      const result = parseDashboardFile([{ ...VALID_DASHBOARD, ...row }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/dashboard.ndjson", line: 1, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  // One row per profile is migration 030's PRIMARY KEY, so the profile id IS
  // the row's identity — two rows for one profile is a duplicate, not a merge.
  it("refuses two rows for the same profile", () => {
    const result = parseDashboardFile([VALID_DASHBOARD, { ...VALID_DASHBOARD, backgroundDim: 10 }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/dashboard.ndjson", line: 2,
      detail: "profile1",
    });
    expect(result.data).toBeNull();
  });

  // A background is a blob on the same terms an attachment is: losing it costs
  // the picture, never the whole archive.
  it("warns, but still restores, when the archive lacks the background blob", () => {
    const result = parseDashboardFile([VALID_DASHBOARD], new Set());
    expect(result.problems).toEqual([
      { severity: "warning", code: "missing-blob", path: `blobs/${HASH}`, detail: "profile1" },
    ]);
    expect(result.data?.dashboardSettings).toHaveLength(1);
  });

  it("refuses a dashboard record filed in another data file", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_DASHBOARD]) } })),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/notes.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });
});

describe("parseImportArchive — dashboard widgets (migration 032 / ADR-045)", () => {
  const T = "2026-07-31T09:00:00.000Z";

  const VALID_WIDGET = {
    type: "dashboard-widget", instanceId: "dw1", profileId: "profile1",
    widgetId: "calendar:danas", size: "M", position: 1024, config: null,
    createdAt: T, updatedAt: T,
  };

  function parseWidgetFile(rows: readonly Record<string, unknown>[]) {
    return parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/dashboard.ndjson": ndjson(rows) } })),
    );
  }

  it("round-trips a placement", () => {
    const result = parseWidgetFile([VALID_WIDGET]);
    expect(result.problems).toEqual([]);
    expect(result.data?.dashboardWidgets).toEqual([
      {
        instanceId: "dw1", profileId: "profile1", widgetId: "calendar:danas", size: "M",
        position: 1024, config: null, createdAt: T, updatedAt: T, setId: null,
      },
    ]);
  });

  it("accepts every size preset and refuses anything else", () => {
    for (const size of ["S", "M", "L"]) {
      expect(parseWidgetFile([{ ...VALID_WIDGET, size }]).problems).toEqual([]);
    }
    for (const size of ["XL", "m", "", 3]) {
      const result = parseWidgetFile([{ ...VALID_WIDGET, size }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/dashboard.ndjson", line: 1,
        detail: "size",
      });
      expect(result.data).toBeNull();
    }
  });

  // A position is a sort key relative to its scope, never a count — a prepend
  // legitimately walks below zero (`positionBetween`).
  it("accepts a negative position and refuses a fractional one", () => {
    expect(parseWidgetFile([{ ...VALID_WIDGET, position: -2048 }]).problems).toEqual([]);
    const result = parseWidgetFile([{ ...VALID_WIDGET, position: 1024.5 }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/dashboard.ndjson", line: 1,
      detail: "position",
    });
  });

  // Nothing interprets a widget's config yet, but the column is documented as
  // JSON and an archive is the one way text could reach it unvetted.
  it("accepts config that parses as JSON and refuses text that does not", () => {
    for (const config of ['{"limit":3}', "[]", "null", "42", '"tekst"']) {
      expect(parseWidgetFile([{ ...VALID_WIDGET, config }]).problems).toEqual([]);
    }
    for (const config of ["{limit:3}", "", "  ", 7]) {
      const result = parseWidgetFile([{ ...VALID_WIDGET, config }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/dashboard.ndjson", line: 1,
        detail: "config",
      });
      expect(result.data).toBeNull();
    }
  });

  // Which widgets EXIST is the module registry's catalogue, not the parser's:
  // a layout keeps a placement whose module this build does not carry, so a
  // well-formed id nobody publishes must restore untouched.
  it("accepts a well-formed widget id no module publishes, and refuses a malformed one", () => {
    expect(parseWidgetFile([{ ...VALID_WIDGET, widgetId: "finance:budzet" }]).problems).toEqual([]);
    for (const widgetId of ["danas", "calendar:danas:extra", "Calendar:Danas", "calendar: danas", ":danas"]) {
      const result = parseWidgetFile([{ ...VALID_WIDGET, widgetId }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/dashboard.ndjson", line: 1,
        detail: "widgetId",
      });
      expect(result.data).toBeNull();
    }
  });

  const BAD_WIDGET_ROWS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "no instance id", row: { instanceId: undefined }, detail: "instanceId" },
    { name: "an empty instance id", row: { instanceId: "" }, detail: "instanceId" },
    { name: "no profile", row: { profileId: undefined }, detail: "profileId" },
    { name: "no widget id", row: { widgetId: undefined }, detail: "widgetId" },
    { name: "no position", row: { position: undefined }, detail: "position" },
    { name: "no created_at", row: { createdAt: undefined }, detail: "createdAt" },
    { name: "a malformed updated_at", row: { updatedAt: "juče" }, detail: "updatedAt" },
  ];

  for (const { name, row, detail } of BAD_WIDGET_ROWS) {
    it(`refuses a widget row with ${name}`, () => {
      const result = parseWidgetFile([{ ...VALID_WIDGET, ...row }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/dashboard.ndjson", line: 1, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  // A PLACEMENT's identity is its own instance id (migration 032's PRIMARY
  // KEY) — the same widget twice is a layout, two rows sharing an id is not.
  it("accepts the same widget placed twice and refuses two rows sharing an instance id", () => {
    expect(
      parseWidgetFile([VALID_WIDGET, { ...VALID_WIDGET, instanceId: "dw2", position: 2048 }])
        .problems,
    ).toEqual([]);

    const result = parseWidgetFile([VALID_WIDGET, { ...VALID_WIDGET, size: "L" }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/dashboard.ndjson", line: 2,
      detail: "dw1",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a widget record filed in another data file", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_WIDGET]) } })),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/notes.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });
});

describe("parseImportArchive — dashboard sets (migration 043 / ADR-055)", () => {
  const T = "2026-07-31T09:00:00.000Z";

  const VALID_SET = {
    type: "dashboard-set", id: "set1", profileId: "profile1", name: "Fakultet",
    position: 1024, createdAt: T, updatedAt: T,
  };
  const WIDGET_IN_SET = {
    type: "dashboard-widget", instanceId: "dw1", profileId: "profile1",
    widgetId: "calendar:danas", size: "M", position: 1024, config: null,
    createdAt: T, updatedAt: T, setId: "set1",
  };

  function parseDashboardFile(rows: readonly Record<string, unknown>[], mode?: "import") {
    return parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/dashboard.ndjson": ndjson(rows) } }), {
        ...(mode === undefined ? {} : { mode }),
      }),
    );
  }

  it("round-trips a named set and the widget filed into it", () => {
    const result = parseDashboardFile([VALID_SET, WIDGET_IN_SET]);
    expect(result.problems).toEqual([]);
    expect(result.data?.dashboardSets).toEqual([
      {
        id: "set1", profileId: "profile1", name: "Fakultet", position: 1024,
        createdAt: T, updatedAt: T,
      },
    ]);
    expect(result.data?.dashboardWidgets).toEqual([
      {
        instanceId: "dw1", profileId: "profile1", widgetId: "calendar:danas", size: "M",
        position: 1024, config: null, createdAt: T, updatedAt: T, setId: "set1",
      },
    ]);
  });

  // Optional with a default (the ADR-028 rule, `kind`'s precedent): an absent
  // `setId` means the DEFAULT board, which is what every widget in every
  // pre-1.21.0 archive actually was — so no `ArchiveEra` flag is involved, and
  // an explicit null says the same thing a missing key does.
  it("defaults an absent setId to null — the default board — and accepts an explicit null", () => {
    const bare = { ...WIDGET_IN_SET };
    delete (bare as Record<string, unknown>).setId;
    for (const row of [bare, { ...WIDGET_IN_SET, setId: null }]) {
      const result = parseDashboardFile([row]);
      expect(result.problems).toEqual([]);
      expect(result.data?.dashboardWidgets[0]?.setId).toBeNull();
    }
  });

  it("refuses a setId that is present but not a non-empty string", () => {
    for (const setId of ["", 7, {}]) {
      const result = parseDashboardFile([VALID_SET, { ...WIDGET_IN_SET, setId }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/dashboard.ndjson", line: 2,
        detail: "setId",
      });
      expect(result.data).toBeNull();
    }
  });

  it("refuses a widget whose setId names no set in the archive", () => {
    const result = parseDashboardFile([{ ...WIDGET_IN_SET, setId: "missing" }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/dashboard.ndjson", line: 1,
      detail: "setId=missing",
    });
    expect(result.data).toBeNull();
  });

  it("import mode detaches such a widget onto the default board instead", () => {
    const result = parseDashboardFile([{ ...WIDGET_IN_SET, setId: "missing" }], "import");
    expect(result.problems).toContainEqual({
      severity: "warning", code: "unknown-reference", path: "data/dashboard.ndjson", line: 1,
      detail: "setId=missing",
    });
    expect(result.data?.dashboardWidgets[0]?.setId).toBeNull();
  });

  it("defaults an absent activeSetId to null and round-trips a present one", () => {
    const settings = {
      type: "dashboard-settings", profileId: "profile1", backgroundHash: null,
      backgroundMime: null, backgroundSizeBytes: null, backgroundDim: 40,
    };
    const bare = parseDashboardFile([settings]);
    expect(bare.problems).toEqual([]);
    expect(bare.data?.dashboardSettings[0]?.activeSetId).toBeNull();

    const chosen = parseDashboardFile([VALID_SET, { ...settings, activeSetId: "set1" }]);
    expect(chosen.problems).toEqual([]);
    expect(chosen.data?.dashboardSettings[0]?.activeSetId).toBe("set1");
  });

  it("refuses an activeSetId that names no set in the archive, and import mode falls back to the default board", () => {
    const settings = {
      type: "dashboard-settings", profileId: "profile1", backgroundHash: null,
      backgroundMime: null, backgroundSizeBytes: null, backgroundDim: 40,
      activeSetId: "missing",
    };
    const refused = parseDashboardFile([settings]);
    expect(refused.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/dashboard.ndjson", line: 1,
      detail: "activeSetId=missing",
    });
    expect(refused.data).toBeNull();

    const salvaged = parseDashboardFile([settings], "import");
    expect(salvaged.data?.dashboardSettings[0]?.activeSetId).toBeNull();
  });

  const BAD_SET_ROWS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "no id", row: { id: undefined }, detail: "id" },
    { name: "an empty id", row: { id: "" }, detail: "id" },
    { name: "no profile", row: { profileId: undefined }, detail: "profileId" },
    { name: "no name", row: { name: undefined }, detail: "name" },
    { name: "a whitespace-only name", row: { name: "   " }, detail: "name" },
    { name: "an over-100-character name", row: { name: "x".repeat(101) }, detail: "name" },
    { name: "a fractional position", row: { position: 1024.5 }, detail: "position" },
    { name: "no created_at", row: { createdAt: undefined }, detail: "createdAt" },
    { name: "a malformed updated_at", row: { updatedAt: "juče" }, detail: "updatedAt" },
  ];

  for (const { name, row, detail } of BAD_SET_ROWS) {
    it(`refuses a set row with ${name}`, () => {
      const result = parseDashboardFile([{ ...VALID_SET, ...row }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/dashboard.ndjson", line: 1, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  it("refuses two rows sharing a set id", () => {
    const result = parseDashboardFile([VALID_SET, { ...VALID_SET, name: "Posao" }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/dashboard.ndjson", line: 2,
      detail: "set1",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a set record filed in another data file", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_SET]) } })),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/notes.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
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
      emptyInputWith(baseFiles({ fileContents: { "data/tasks.ndjson": tasksFile([task]) } })),
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
    // ADR-028: the ladder's rules are `TaskStore`'s, re-checked here because
    // an archive is the one way a value reaches the column without the store.
    { name: "no reminder ladder at all", row: { reminderOffsets: undefined }, detail: "reminderOffsets" },
    { name: "a reminder ladder that is not an array", row: { reminderOffsets: 3 }, detail: "reminderOffsets" },
    { name: "a negative lead time", row: { dueDate: "2026-08-01", reminderOffsets: [-1] }, detail: "reminderOffsets[0]" },
    { name: "a fractional lead time", row: { dueDate: "2026-08-01", reminderOffsets: [3, 1.5] }, detail: "reminderOffsets[1]" },
    {
      name: "a lead time beyond the one-year cap",
      row: { dueDate: "2026-08-01", reminderOffsets: [366] },
      detail: "reminderOffsets[0]",
    },
    { name: "the same lead time twice", row: { dueDate: "2026-08-01", reminderOffsets: [3, 3] }, detail: "reminderOffsets" },
    {
      name: "more lead times than a task may carry",
      row: { dueDate: "2026-08-01", reminderOffsets: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      detail: "reminderOffsets",
    },
    // The cross-field half: a ladder with nothing to count back from.
    { name: "a ladder with no due date to count back from", row: { dueDate: null, reminderOffsets: [3] }, detail: "dueDate" },
  ];

  for (const { name, row, detail } of BAD_TASKS) {
    it(`refuses a task with ${name}`, () => {
      expect(detailsFor("data/tasks.ndjson", { ...VALID_TASK, ...row })).toContain(detail);
    });
  }

  it("accepts a task whose reminder ladder sits beside the due date it counts back from, in any order", () => {
    const task = { ...VALID_TASK, dueDate: "2026-08-10", reminderOffsets: [7, 0] };
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/tasks.ndjson": tasksFile([task]) } })),
    );
    expect(result.problems).toEqual([]);
    // Order carries no meaning on the way in — `RestoreStore` writes it sorted.
    expect(result.data?.tasks[0]?.reminderOffsets).toEqual([7, 0]);
  });

  it("accepts an event master with a rule, its exceptions and a reminder ladder in any order", () => {
    const event = {
      ...VALID_EVENT,
      recurrence: WEEKLY_RULE,
      recurrenceExdates: ["2026-07-17"],
      reminderOffsets: [1440, 15],
    };
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/calendar.ndjson": ndjson([event]) } })),
    );
    expect(result.problems).toEqual([]);
    expect(result.data?.events[0]?.recurrence).toEqual(WEEKLY_RULE);
    expect(result.data?.events[0]?.recurrenceExdates).toEqual(["2026-07-17"]);
    // Order carries no meaning on the way in — `RestoreStore` writes it sorted.
    expect(result.data?.events[0]?.reminderOffsets).toEqual([1440, 15]);
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
    // CAL-006: the ladder's rules are `EventStore`'s, re-checked here because
    // an archive is the one way a value reaches the column without the store.
    { name: "no reminder ladder at all", row: { reminderOffsets: undefined }, detail: "reminderOffsets" },
    { name: "a reminder ladder that is not an array", row: { reminderOffsets: 15 }, detail: "reminderOffsets" },
    { name: "a negative lead time", row: { reminderOffsets: [-1] }, detail: "reminderOffsets[0]" },
    { name: "a fractional lead time", row: { reminderOffsets: [15, 1.5] }, detail: "reminderOffsets[1]" },
    { name: "a lead time beyond the 30-day cap", row: { reminderOffsets: [43_201] }, detail: "reminderOffsets[0]" },
    { name: "the same lead time twice", row: { reminderOffsets: [15, 15] }, detail: "reminderOffsets" },
    {
      name: "more lead times than an event may carry",
      row: { reminderOffsets: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      detail: "reminderOffsets",
    },
  ];

  for (const { name, row, detail } of BAD_EVENTS) {
    it(`refuses an event with ${name}`, () => {
      expect(detailsFor("data/calendar.ndjson", { ...VALID_EVENT, ...row })).toContain(detail);
    });
  }

  it("accepts a person with a known year and one with neither year nor note", () => {
    const withoutYear = { ...VALID_PERSON, id: "pe2", kind: "anniversary", year: null, note: null };
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/calendar.ndjson": ndjson([VALID_PERSON, withoutYear]) } })),
    );
    expect(result.problems).toEqual([]);
    expect(result.data?.people).toEqual([
      {
        id: "pe1", profileId: "profile1", name: "Marko", kind: "birthday", month: 3, day: 14,
        year: 1990, note: "Voli čaj", createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "pe2", profileId: "profile1", name: "Marko", kind: "anniversary", month: 3, day: 14,
        year: null, note: null, createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
  });

  it("accepts a leap-day person — 29 February is a real birthday", () => {
    const result = parseImportArchive(
      emptyInputWith(
        baseFiles({
          fileContents: { "data/calendar.ndjson": ndjson([{ ...VALID_PERSON, month: 2, day: 29 }]) },
        }),
      ),
    );
    expect(result.problems).toEqual([]);
    expect(result.data?.people[0]?.day).toBe(29);
  });

  const BAD_PEOPLE: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "an empty name", row: { name: "" }, detail: "name" },
    { name: "an unknown kind", row: { kind: "imendan" }, detail: "kind" },
    { name: "month 0", row: { month: 0 }, detail: "month" },
    { name: "month 13", row: { month: 13 }, detail: "month" },
    { name: "day 0", row: { day: 0 }, detail: "day" },
    { name: "day 32", row: { day: 32 }, detail: "day" },
    { name: "a fractional month", row: { month: 3.5 }, detail: "month" },
    // The pair no SQL CHECK can see (migration 020): each column is in range
    // and the day still does not exist in any year.
    { name: "30 February", row: { month: 2, day: 30 }, detail: "day" },
    { name: "31 April", row: { month: 4, day: 31 }, detail: "day" },
    { name: "a year before 1900", row: { year: 1899 }, detail: "year" },
    { name: "a typo'd year", row: { year: 19_858 }, detail: "year" },
    { name: "a fractional year", row: { year: 1990.5 }, detail: "year" },
    { name: "a missing timestamp", row: { updatedAt: undefined }, detail: "updatedAt" },
  ];

  for (const { name, row, detail } of BAD_PEOPLE) {
    it(`refuses a person with ${name}`, () => {
      expect(detailsFor("data/calendar.ndjson", { ...VALID_PERSON, ...row })).toContain(detail);
    });
  }

  it("refuses a person record filed in the wrong data file", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/tasks.ndjson": ndjson([VALID_PERSON]) } })),
    );
    expect(result.problems).toContainEqual({
      severity: "error",
      code: "invalid-record",
      path: "data/tasks.ndjson",
      line: 1,
      detail: "type",
    });
    expect(result.data).toBeNull();
  });
});

/**
 * A backup's whole point is that it restores. Nine REQUIRED fields have been
 * added to existing record types since the first release — task/event
 * `recurrence`, event `recurrenceExdates`, event `reminderOffsets` (all three
 * inside `1.0.x`, with no bump), task `reminderOffsets` (at the `1.2.0` bump),
 * a task's `listId`/`sectionId`/`position` (at the `1.3.0` one) and a note
 * folder's `defaultTemplateId`/`isCaptureDefault` (at `1.7.0`, covered in its
 * own suite below) — and without the era gate every archive written before each
 * of them would be refused outright for a field that did not exist yet.
 */
describe("parseImportArchive — older eras (fields added after the first release)", () => {
  /** `VALID_TASK` as a 1.0.0 writer emitted it: derived by REMOVING the fields added since, so this fixture cannot drift from the current row shape. */
  function eraTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const {
      recurrence: _recurrence,
      reminderOffsets: _reminderOffsets,
      listId: _listId,
      sectionId: _sectionId,
      position: _position,
      ...rest
    } = VALID_TASK;
    return { ...rest, ...overrides };
  }

  /** `VALID_EVENT` as a 1.0.0 writer emitted it — same derivation, three fields. */
  function eraEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const {
      recurrence: _recurrence,
      recurrenceExdates: _recurrenceExdates,
      reminderOffsets: _reminderOffsets,
      ...rest
    } = VALID_EVENT;
    return { ...rest, ...overrides };
  }

  /** Parses `tasks`/`events` under a manifest declaring `schemaVersion` — the one variable every case below turns. */
  function parseAt(
    schemaVersion: string,
    tasks: readonly Record<string, unknown>[],
    events: readonly Record<string, unknown>[] = [],
  ) {
    return parseImportArchive(
      emptyInputWith(
        baseFiles({
          schemaVersion,
          fileContents: {
            "data/tasks.ndjson": ndjson(tasks),
            "data/calendar.ndjson": ndjson(events),
          },
        }),
      ),
    );
  }

  const invalidDetails = (result: ReturnType<typeof parseAt>): (string | undefined)[] =>
    result.problems.filter((problem) => problem.code === "invalid-record").map((p) => p.detail);

  it("parses a 1.0.0 archive whose rows predate all seven fields, defaulting each", () => {
    const result = parseAt("1.0.0", [eraTask()], [eraEvent()]);

    expect(result.problems).toEqual([]);
    expect(result.data?.tasks[0]).toMatchObject({
      recurrence: null,
      reminderOffsets: [],
      // TASK-004: no list to point at, which is exactly what `RestoreStore`
      // reads as "put this task in the target profile's Inbox".
      listId: null,
      sectionId: null,
      position: 0,
    });
    expect(result.data?.events[0]).toMatchObject({
      recurrence: null,
      recurrenceExdates: [],
      reminderOffsets: [],
    });
  });

  it("refuses those very same rows under a 1.2.0 manifest, naming the missing field", () => {
    const result = parseAt("1.2.0", [eraTask()], [eraEvent()]);

    // Each parser reports its FIRST missing field, in the row's own field order.
    expect(invalidDetails(result)).toEqual(["recurrence", "recurrence"]);
    expect(result.data).toBeNull();
  });

  it("refuses each field individually at the era that writes it", () => {
    const { reminderOffsets: _ladder, ...taskWithoutLadder } = VALID_TASK;
    const { recurrenceExdates: _exdates, ...eventWithoutExdates } = VALID_EVENT;
    const { reminderOffsets: _eventLadder, ...eventWithoutLadder } = VALID_EVENT;

    expect(invalidDetails(parseAt("1.2.0", [taskWithoutLadder]))).toEqual(["reminderOffsets"]);
    expect(invalidDetails(parseAt("1.2.0", [], [eventWithoutExdates]))).toEqual(["recurrenceExdates"]);
    expect(invalidDetails(parseAt("1.2.0", [], [eventWithoutLadder]))).toEqual(["reminderOffsets"]);
  });

  it("lets a 1.1.0 archive omit only what the 1.2.0 bump added", () => {
    const { reminderOffsets: _ladder, ...taskWithoutLadder } = VALID_TASK;
    // The list travels with it: `listId` is PRESENT on this row, and leniency
    // never weakens a present value — its reference check included.
    const accepted = parseAt("1.1.0", [VALID_TASK_LIST, taskWithoutLadder]);
    expect(accepted.problems).toEqual([]);
    expect(accepted.data?.tasks[0]?.reminderOffsets).toEqual([]);

    // The three that shipped inside 1.0.x were always written by a 1.1 writer,
    // so their absence there is a damaged row, not an older archive.
    const { recurrence: _rule, ...eventWithoutRule } = VALID_EVENT;
    const refused = parseAt("1.1.0", [], [eventWithoutRule]);
    expect(refused.problems).toContainEqual({
      severity: "error",
      code: "invalid-record",
      path: "data/calendar.ndjson",
      line: 1,
      detail: "recurrence",
    });
    expect(refused.data).toBeNull();
  });

  it("applies the cross-field rules to the defaulted values", () => {
    // A 1.0.x master with a rule but no exdates key: the exceptions default to
    // `[]`, which satisfies the "exceptions belong to a series" pair rule —
    // defaulting can only ever produce the empty, always-valid side of it.
    const accepted = parseAt("1.0.0", [], [eraEvent({ recurrence: WEEKLY_RULE })]);
    expect(accepted.problems).toEqual([]);
    expect(accepted.data?.events[0]).toMatchObject({
      recurrence: WEEKLY_RULE,
      recurrenceExdates: [],
      reminderOffsets: [],
    });

    // And a lenient era does not weaken a cross-field rule for a field that IS
    // present: a rule still needs a due date, a ladder still needs one to count
    // back from.
    const dailyRule = { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } };
    expect(invalidDetails(parseAt("1.0.0", [eraTask({ recurrence: dailyRule })]))).toEqual([
      "recurrence",
    ]);
    expect(invalidDetails(parseAt("1.0.0", [eraTask({ reminderOffsets: [3] })]))).toEqual(["dueDate"]);
  });

  it("validates a PRESENT value strictly in every era — leniency covers absence only", () => {
    // Based on the FULL rows, so each case turns exactly one field and the
    // assertion cannot be satisfied by some earlier field being absent.
    for (const schemaVersion of ["1.0.0", "1.1.0", "1.2.0"]) {
      const task = (overrides: Record<string, unknown>) => ({ ...VALID_TASK, ...overrides });
      const event = (overrides: Record<string, unknown>) => ({ ...VALID_EVENT, ...overrides });

      // Malformed.
      expect(invalidDetails(parseAt(schemaVersion, [task({ recurrence: "daily" })]))).toEqual([
        "recurrence",
      ]);
      expect(
        invalidDetails(parseAt(schemaVersion, [task({ dueDate: "2026-08-01", reminderOffsets: [-1] })])),
      ).toEqual(["reminderOffsets[0]"]);
      expect(invalidDetails(parseAt(schemaVersion, [], [event({ reminderOffsets: 15 })]))).toEqual([
        "reminderOffsets",
      ]);
      // An explicit `null` is PRESENT, not absent: a writer that emitted the key
      // meant it, and `null` is not a list.
      expect(
        invalidDetails(parseAt(schemaVersion, [], [event({ recurrenceExdates: null })])),
      ).toEqual(["recurrenceExdates"]);
      expect(invalidDetails(parseAt(schemaVersion, [task({ reminderOffsets: null })]))).toEqual([
        "reminderOffsets",
      ]);
    }
  });
});

/**
 * ADR-036's own era gate: a note folder's `defaultTemplateId` and
 * `isCaptureDefault` were added AT the `1.7.0` bump, so every archive written
 * before it carries neither — and a backup that cannot be restored is not a
 * backup. Structured exactly like the task/event suite above, because it is the
 * same rule: absence is defaulted below the bump, required at and above it, and
 * a PRESENT value is strict in every era.
 */
describe("parseImportArchive — note folder preferences (the 1.7.0 era gate)", () => {
  /** `VALID_NOTE_FOLDER` as a pre-1.7 writer emitted it: derived by REMOVING the two fields, so the fixture cannot drift from the current row shape. */
  function eraFolder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const {
      defaultTemplateId: _defaultTemplateId,
      isCaptureDefault: _isCaptureDefault,
      ...rest
    } = VALID_NOTE_FOLDER;
    return { ...rest, ...overrides };
  }

  function parseFolders(schemaVersion: string, folders: readonly Record<string, unknown>[]) {
    return parseImportArchive(
      emptyInputWith(
        baseFiles({
          schemaVersion,
          fileContents: { "data/notes.ndjson": ndjson(folders) },
        }),
      ),
    );
  }

  const invalidDetails = (result: ReturnType<typeof parseFolders>): (string | undefined)[] =>
    result.problems.filter((problem) => problem.code === "invalid-record").map((p) => p.detail);

  it("defaults both preferences on a 1.6.0 archive that predates them", () => {
    const result = parseFolders("1.6.0", [eraFolder()]);

    expect(result.problems).toEqual([]);
    expect(result.data?.noteFolders[0]).toMatchObject({
      defaultTemplateId: null,
      isCaptureDefault: false,
    });
  });

  it("refuses that same row at 1.7.0, naming the field the bump made required", () => {
    const result = parseFolders("1.7.0", [eraFolder()]);

    expect(invalidDetails(result)).toEqual(["defaultTemplateId"]);
    expect(result.data).toBeNull();
  });

  it("refuses a row missing only the capture flag at 1.7.0", () => {
    const { isCaptureDefault: _flag, ...withoutFlag } = VALID_NOTE_FOLDER;
    expect(invalidDetails(parseFolders("1.7.0", [withoutFlag]))).toEqual(["isCaptureDefault"]);
  });

  it("validates a PRESENT value strictly in every era — leniency covers absence only", () => {
    for (const schemaVersion of ["1.0.0", "1.6.0", "1.7.0"]) {
      const folder = (overrides: Record<string, unknown>) => ({ ...VALID_NOTE_FOLDER, ...overrides });

      expect(invalidDetails(parseFolders(schemaVersion, [folder({ isCaptureDefault: 1 })]))).toEqual([
        "isCaptureDefault",
      ]);
      expect(
        invalidDetails(parseFolders(schemaVersion, [folder({ defaultTemplateId: "" })])),
      ).toEqual(["defaultTemplateId"]);
      // An explicit `null` capture flag is PRESENT, not absent: a writer that
      // emitted the key meant it, and `null` is not a boolean.
      expect(
        invalidDetails(parseFolders(schemaVersion, [folder({ isCaptureDefault: null })])),
      ).toEqual(["isCaptureDefault"]);
    }
  });

  // ADR-036's dangling-id rule, stated as a test: the archive names a template
  // it does not carry, and that is FINE — the id may be a built-in constant
  // that lives in no table at all, and even a missing stored row only ever
  // means "this folder creates a blank note".
  it("accepts a defaultTemplateId the archive carries no template for", () => {
    const result = parseFolders("1.7.0", [
      { ...VALID_NOTE_FOLDER, defaultTemplateId: "builtin:sastanak" },
      { ...VALID_NOTE_FOLDER, id: "nf2", defaultTemplateId: "no-such-template-row" },
    ]);

    expect(result.problems).toEqual([]);
    expect(result.data?.noteFolders.map((folder) => folder.defaultTemplateId)).toEqual([
      "builtin:sastanak",
      "no-such-template-row",
    ]);
  });

  // The capture mark is a per-profile SINGLETON — an invariant no single row can
  // break, so no per-row parser can catch it. Migration 028's partial unique
  // index would abort the restore transaction; catching it here names the row.
  it("refuses a second folder claiming the capture mark, naming only the later one", () => {
    const result = parseFolders("1.7.0", [
      { ...VALID_NOTE_FOLDER, id: "nf1", isCaptureDefault: true },
      { ...VALID_NOTE_FOLDER, id: "nf2", isCaptureDefault: true },
      { ...VALID_NOTE_FOLDER, id: "nf3", isCaptureDefault: false },
    ]);

    expect(result.problems).toEqual([
      {
        severity: "error",
        code: "invalid-record",
        path: "data/notes.ndjson",
        line: 2,
        detail: "isCaptureDefault",
      },
    ]);
    expect(result.data).toBeNull();
  });

  it("accepts exactly one claimant beside any number of unmarked folders", () => {
    const result = parseFolders("1.7.0", [
      { ...VALID_NOTE_FOLDER, id: "nf1", isCaptureDefault: false },
      { ...VALID_NOTE_FOLDER, id: "nf2", isCaptureDefault: true },
      { ...VALID_NOTE_FOLDER, id: "nf3", isCaptureDefault: false },
    ]);

    expect(result.problems).toEqual([]);
    expect(result.data?.noteFolders.filter((folder) => folder.isCaptureDefault)).toHaveLength(1);
  });

  // --- NOTE-002's per-folder view (1.17.0) --------------------------------
  //
  // NOT an era gate, unlike the two preferences above: `defaultView` is
  // optional WITH a default, so absence means `"list"` at every version and
  // there is no flag on `ArchiveEra` to consult. Only a present value is
  // checked — the same shape a task list's `viewConfig` arrived in at 1.16.0.

  /** `VALID_NOTE_FOLDER` as a pre-1.17 writer emitted it: derived by REMOVING the field, so the fixture cannot drift from the current row shape. */
  const withoutView = (): Record<string, unknown> => {
    const { defaultView: _defaultView, ...rest } = VALID_NOTE_FOLDER;
    return rest;
  };

  it("defaults defaultView to list wherever it is absent, in every era", () => {
    for (const schemaVersion of ["1.0.0", "1.7.0", "1.16.0", INTERCHANGE_SCHEMA_VERSION]) {
      const result = parseFolders(schemaVersion, [withoutView()]);
      expect(result.problems, schemaVersion).toEqual([]);
      expect(result.data?.noteFolders[0]?.defaultView, schemaVersion).toBe("list");
    }
  });

  it("reads an explicit null as the same absence — one meaning, two spellings", () => {
    const result = parseFolders(INTERCHANGE_SCHEMA_VERSION, [
      { ...VALID_NOTE_FOLDER, defaultView: null },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data?.noteFolders[0]?.defaultView).toBe("list");
  });

  it("carries both shapes through", () => {
    const result = parseFolders(INTERCHANGE_SCHEMA_VERSION, [
      { ...VALID_NOTE_FOLDER, id: "nf1", defaultView: "list" },
      { ...VALID_NOTE_FOLDER, id: "nf2", defaultView: "cards" },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data?.noteFolders.map((folder) => folder.defaultView)).toEqual([
      "list",
      "cards",
    ]);
  });

  it("refuses a present value outside the closed set, in every era", () => {
    // "kanban" and "calendar" are a TASK list's shapes (migration 038), not a
    // folder's — the nearest plausible mistake, and refused like any other.
    for (const schemaVersion of ["1.0.0", "1.16.0", INTERCHANGE_SCHEMA_VERSION]) {
      for (const view of ["kanban", "calendar", "grid", "", "List", 1]) {
        expect(
          invalidDetails(parseFolders(schemaVersion, [{ ...VALID_NOTE_FOLDER, defaultView: view }])),
          `${schemaVersion}/${String(view)}`,
        ).toEqual(["defaultView"]);
      }
    }
  });
});

describe("parseImportArchive — schema version", () => {
  it("is 1.21.0 for this build", () => {
    expect(INTERCHANGE_SCHEMA_VERSION).toBe("1.21.0");
  });

  it("is exactly what buildExportArchive stamps into its own manifest", () => {
    const archive = buildExportArchive(emptyExportInput());
    const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as { schemaVersion: string };
    // Two constants, one contract: this is what stops the writer and the
    // reader drifting a version apart (see either constant's own doc).
    expect(manifest.schemaVersion).toBe(INTERCHANGE_SCHEMA_VERSION);
  });

  it("accepts the exact current version", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ schemaVersion: INTERCHANGE_SCHEMA_VERSION })),
    );
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // The whole reason CAL-007 bumped the MINOR rather than the patch: an
  // archive written before `person` existed carries strictly fewer record
  // types than this build knows, so it still restores, unchanged.
  it("accepts an older minor — a 1.0 archive still parses here", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.0.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // And the same for the minor ADR-028 superseded.
  it("accepts an older minor — a 1.1 archive still parses here", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.1.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // And for the one ADR-029 superseded.
  it("accepts an older minor — a 1.2 archive still parses here", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.2.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // And for the one migration 023's tags superseded: a 1.3 archive carries no
  // `task-tag` row at all, which is exactly what an untagged profile looks like
  // — hence no era flag for a whole absent record type.
  it("accepts an older minor — a 1.3 archive still parses here", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.3.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).toMatchObject({ taskTags: [], taskTagLinks: [] });
  });

  // And for the one migration 024's attachments have just superseded: a 1.4
  // archive carries no `task-attachment` row at all, which is exactly what a
  // profile with no files hung off its tasks looks like — the same reason a
  // whole absent record type needs no era flag.
  it("accepts an older minor — a 1.4 archive still parses here", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.4.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).toMatchObject({ taskAttachments: [] });
  });

  // And for the one ADR-037's dependencies have just superseded: a 1.7 archive
  // carries no `task-dependency` row, which is exactly what a profile whose
  // tasks nobody ordered looks like — the same "absent type needs no era flag"
  // reading as the tags above.
  it("accepts an older minor — a 1.7 archive still parses here", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.7.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).toMatchObject({ taskDependencies: [] });
  });

  // And for the one ADR-041's dashboard background has just superseded: a 1.8
  // archive carries no `dashboard-settings` row at all, which is exactly what
  // a profile that never chose a background looks like — hence, again, no era
  // flag for a whole absent record type.
  it("accepts an older minor — a 1.8 archive still parses here, dashboard settings empty", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.8.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).toMatchObject({ dashboardSettings: [] });
  });

  it("accepts an older patch", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.0.7" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // And for the one ADR-042's cloze fields have just superseded: a 1.9 archive
  // carries no `kind` on any card, which is exactly what a profile of only
  // basic cards looks like — an optional-with-a-default needs no era flag.
  it("accepts an older minor — a 1.9 archive still parses here", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.9.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // And for the one ADR-045's dashboard layout superseded: a 1.10 archive
  // carries no `dashboard-widget` row at all, which is exactly what a profile
  // that never rearranged its dashboard looks like — hence, again, no era flag
  // for a whole absent record type.
  it("accepts an older minor — a 1.10 archive still parses here, the layout empty", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.10.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).toMatchObject({ dashboardWidgets: [] });
  });

  // And for the one ADR-046's steps superseded: a 1.11 archive carries no
  // `problemSteps` on any card, which is exactly what a profile of cards with
  // no worked solution looks like.
  it("accepts an older minor — a 1.11 archive still parses here", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.11.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // And for the one STUDY-007's preferences superseded: a 1.12 archive carries
  // no `study-settings` row at all, which is exactly what a profile that never
  // touched its retention or its daily caps looks like — a whole absent record
  // type, so again no era flag, and the defaults stand.
  it("accepts an older minor — a 1.12 archive still parses here, the preferences empty", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.12.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).toMatchObject({ studySettings: [] });
  });

  // And for the one STUDY-001's materials superseded: a 1.13 archive carries
  // neither a `subject-attachment` nor a `subject-note-link` row, which is
  // exactly what a profile whose subjects hold no files and no filed notes looks
  // like — two whole absent record types, so again no era flag.
  it("accepts an older minor — a 1.13 archive still parses here, both new types empty", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.13.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).toMatchObject({ subjectAttachments: [], subjectNoteLinks: [] });
  });

  // And for the one CAL-009's templates superseded: a 1.14 archive carries no
  // `event-template` row at all, which is exactly what a profile that never
  // saved an event as a template looks like — a whole absent record type, so
  // again no era flag.
  it("accepts an older minor — a 1.14 archive still parses here, the templates empty", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.14.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).toMatchObject({ eventTemplates: [] });
  });

  // And for the one ADR-050's four views have just superseded: a 1.15 archive
  // carries no `viewConfig` on any task list, which is exactly what a profile
  // whose lists had no fourth view to configure looks like — an
  // optional-with-a-default, so again no era flag.
  it("accepts an older minor — a 1.15 archive still parses here", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.15.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // And for the one NOTE-002's per-folder view has just superseded: a 1.16
  // archive carries no `defaultView` on any note folder, which is exactly what
  // a profile whose folders had one shape to be drawn in looks like — an
  // optional-with-a-default, so again no era flag.
  it("accepts an older minor — a 1.16 archive still parses here", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.16.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // And for the one ADR-054's term superseded: a 1.19 archive carries no
  // `calendar-settings` row at all, which is exactly what a profile that never
  // set its semester dates looks like — a whole absent record type, so again
  // no era flag, and the Semestar view keeps sliding.
  it("accepts an older minor — a 1.19 archive still parses here, the term unset", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.19.0" })));
    expect(result.problems).toEqual([]);
    expect(result.data).toMatchObject({ calendarSettings: [] });
  });

  it("accepts a newer patch", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.20.7" })));
    expect(result.problems).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  // `1.22.0`: the nearest minor strictly ahead of this build's `1.21.0`.
  it("refuses a newer minor", () => {
    const result = parseImportArchive(emptyInputWith(baseFiles({ schemaVersion: "1.22.0" })));
    expect(result.problems).toEqual([
      { severity: "error", code: "unsupported-schema-version", path: "manifest.json", detail: "1.22.0" },
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

  /**
   * NTF-009 (`1.19.0`): optional-with-a-default, so absence is the pre-`1.19.0`
   * shape and reads as „10 min“ — while a key that IS there is validated
   * against migration 041's closed CHECK, in every era.
   */
  describe("the default snooze preset", () => {
    const base = { quietFrom: null, quietTo: null, morningHour: "08:00", enabledSources: [] };

    it("reads 10m when the key is absent — every pre-1.19.0 archive", () => {
      const result = parseImportArchive(withSettings({ ...base }));
      expect(result.problems).toEqual([]);
      expect(result.manifest?.settings.notifications.snoozeDefault).toBe("10m");
    });

    it("reads each of the four presets back", () => {
      for (const preset of ["10m", "1h", "tonight", "tomorrow-morning"]) {
        const result = parseImportArchive(withSettings({ ...base, snoozeDefault: preset }));
        expect(result.problems).toEqual([]);
        expect(result.manifest?.settings.notifications.snoozeDefault).toBe(preset);
      }
    });

    it("refuses a preset outside migration 041's CHECK", () => {
      const result = parseImportArchive(withSettings({ ...base, snoozeDefault: "30m" }));
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-manifest", path: "manifest.json",
        detail: "settings.notifications.snoozeDefault",
      });
    });

    it("refuses an explicit null — leniency covers absence only", () => {
      const result = parseImportArchive(withSettings({ ...base, snoozeDefault: null }));
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-manifest", path: "manifest.json",
        detail: "settings.notifications.snoozeDefault",
      });
    });
  });
});

describe("parseImportArchive — task templates (migration 027 / ADR-035)", () => {
  const VALID_PAYLOAD = {
    title: "Nedeljni pregled",
    description: null,
    priority: "high",
    dueOffsetDays: 7,
    reminderOffsets: [0, 1],
    recurrence: { freq: { kind: "weekly", interval: 1, days: [1] }, end: { kind: "never" } },
    tagNames: ["posao"],
    subtaskTitles: ["Inbox na nulu"],
  };

  const VALID_TEMPLATE = {
    type: "task-template", id: "ttpl1", profileId: "profile1", name: "Nedeljni pregled",
    payload: VALID_PAYLOAD,
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
  };

  function parseTasksFile(rows: readonly Record<string, unknown>[]) {
    return parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/tasks.ndjson": ndjson(rows) } })),
    );
  }

  /** A template whose payload is `VALID_PAYLOAD` with `patch` applied — the one variable each payload case below turns. */
  function withPayload(patch: Record<string, unknown>): Record<string, unknown> {
    return { ...VALID_TEMPLATE, payload: { ...VALID_PAYLOAD, ...patch } };
  }

  it("round-trips a template with every payload field set", () => {
    const result = parseTasksFile([VALID_TEMPLATE]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskTemplates).toEqual([
      {
        id: "ttpl1", profileId: "profile1", name: "Nedeljni pregled", payload: VALID_PAYLOAD,
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
  });

  it("keeps a template that references nothing else in the archive — it points at no row by design", () => {
    const result = parseTasksFile([VALID_TEMPLATE]);
    expect(result.problems).toEqual([]);
    expect(result.data?.tasks).toEqual([]);
    expect(result.data?.taskTags).toEqual([]);
  });

  const BAD_ROWS: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "no id", row: { id: undefined }, detail: "id" },
    { name: "no profile", row: { profileId: undefined }, detail: "profileId" },
    { name: "an empty name", row: { name: "" }, detail: "name" },
    { name: "an untrimmed name", row: { name: "  Pregled  " }, detail: "name" },
    { name: "a name past the 80-character cap", row: { name: "x".repeat(81) }, detail: "name" },
    { name: "no payload at all", row: { payload: undefined }, detail: "payload" },
    { name: "a payload that is not an object", row: { payload: "{}" }, detail: "payload" },
    { name: "a malformed updatedAt", row: { updatedAt: "juče" }, detail: "updatedAt" },
  ];

  for (const { name, row, detail } of BAD_ROWS) {
    it(`refuses a task template with ${name}`, () => {
      const result = parseTasksFile([{ ...VALID_TEMPLATE, ...row }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 1, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  // Every payload field is revalidated here rather than trusted: it lives in a
  // JSON column no CHECK can reach, so this parser and `TaskTemplateStore`'s own
  // validator are the only two gates it ever passes.
  const BAD_PAYLOADS: { name: string; patch: Record<string, unknown>; detail: string }[] = [
    { name: "an empty title", patch: { title: "" }, detail: "payload.title" },
    { name: "an untrimmed title", patch: { title: " x " }, detail: "payload.title" },
    { name: "a priority outside the closed set", patch: { priority: "urgent" }, detail: "payload.priority" },
    { name: "a negative dueOffsetDays", patch: { dueOffsetDays: -1 }, detail: "payload.dueOffsetDays" },
    { name: "a dueOffsetDays past a year", patch: { dueOffsetDays: 366 }, detail: "payload.dueOffsetDays" },
    { name: "a fractional dueOffsetDays", patch: { dueOffsetDays: 1.5 }, detail: "payload.dueOffsetDays" },
    { name: "a repeated reminder lead time", patch: { reminderOffsets: [1, 1] }, detail: "payload.reminderOffsets" },
    { name: "a reminder lead time past a year", patch: { reminderOffsets: [366] }, detail: "payload.reminderOffsets[0]" },
    { name: "a recurrence rule the engine rejects", patch: { recurrence: { freq: { kind: "daily", interval: 0 }, end: { kind: "never" } } }, detail: "payload.recurrence" },
    { name: "an empty tag name", patch: { tagNames: [""] }, detail: "payload.tagNames[0]" },
    { name: "an over-long tag name", patch: { tagNames: ["x".repeat(51)] }, detail: "payload.tagNames[0]" },
    { name: "a repeated tag name", patch: { tagNames: ["posao", "posao"] }, detail: "payload.tagNames" },
    { name: "more than 20 tags", patch: { tagNames: Array.from({ length: 21 }, (_, i) => `t${i}`) }, detail: "payload.tagNames" },
    { name: "an empty subtask title", patch: { subtaskTitles: [""] }, detail: "payload.subtaskTitles[0]" },
    { name: "more than 30 subtasks", patch: { subtaskTitles: Array.from({ length: 31 }, (_, i) => `s${i}`) }, detail: "payload.subtaskTitles" },
    { name: "reminders but no dueOffsetDays to count back from", patch: { dueOffsetDays: null, recurrence: null }, detail: "payload.dueOffsetDays" },
    { name: "a rule but no dueOffsetDays to phase from", patch: { dueOffsetDays: null, reminderOffsets: [] }, detail: "payload.dueOffsetDays" },
  ];

  for (const { name, patch, detail } of BAD_PAYLOADS) {
    it(`refuses a task template payload with ${name}`, () => {
      const result = parseTasksFile([withPayload(patch)]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 1, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  // Two identical chores are two chores, unlike two identical labels — so the
  // uniqueness rule applies to `tagNames` and deliberately not here.
  it("accepts two subtasks sharing a title", () => {
    const result = parseTasksFile([withPayload({ subtaskTitles: ["Pozovi", "Pozovi"] })]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskTemplates[0]?.payload.subtaskTitles).toEqual(["Pozovi", "Pozovi"]);
  });

  it("accepts a bare payload — a title and nothing else", () => {
    const result = parseTasksFile([
      withPayload({
        description: null, priority: "none", dueOffsetDays: null, reminderOffsets: [],
        recurrence: null, tagNames: [], subtaskTitles: [],
      }),
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskTemplates[0]?.payload.dueOffsetDays).toBeNull();
  });

  // `0` is a real due date — "due the day it is applied" — which is exactly why
  // capturing a past due date clamps to 0 rather than dropping it to null.
  it("accepts a dueOffsetDays of 0 as the anchor a ladder and a rule need", () => {
    const result = parseTasksFile([withPayload({ dueOffsetDays: 0 })]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskTemplates[0]?.payload.dueOffsetDays).toBe(0);
  });

  it("refuses two templates sharing an id", () => {
    const result = parseTasksFile([VALID_TEMPLATE, { ...VALID_TEMPLATE, name: "Drugi" }]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/tasks.ndjson", line: 2, detail: "ttpl1",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a task-template record filed in the notes file", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_TEMPLATE]) } })),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/notes.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });
});

describe("parseImportArchive — task dependencies (migration 029 / ADR-037)", () => {
  const TASK_A = { ...VALID_TASK, id: "ta" };
  const TASK_B = { ...VALID_TASK, id: "tb" };
  const TASK_C = { ...VALID_TASK, id: "tc" };
  const EDGE_AB = { type: "task-dependency", blockerId: "ta", blockedId: "tb" };

  /** Parses a `data/tasks.ndjson` built from `rows` verbatim (the task-tag suite's own helper). */
  function parseTasksFile(rows: readonly Record<string, unknown>[]) {
    return parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/tasks.ndjson": ndjson(rows) } })),
    );
  }

  it("round-trips one edge between two tasks", () => {
    const result = parseTasksFile([VALID_TASK_LIST, TASK_A, TASK_B, EDGE_AB]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskDependencies).toEqual([{ blockerId: "ta", blockedId: "tb" }]);
  });

  const BAD_EDGES: { name: string; row: Record<string, unknown>; detail: string }[] = [
    { name: "no blocker", row: { blockerId: undefined }, detail: "blockerId" },
    { name: "an empty blocker", row: { blockerId: "" }, detail: "blockerId" },
    { name: "no blocked task", row: { blockedId: undefined }, detail: "blockedId" },
    { name: "an empty blocked id", row: { blockedId: "" }, detail: "blockedId" },
    { name: "a non-string end", row: { blockerId: 7 }, detail: "blockerId" },
  ];

  for (const { name, row, detail } of BAD_EDGES) {
    it(`refuses a dependency with ${name}`, () => {
      const result = parseTasksFile([VALID_TASK_LIST, TASK_A, TASK_B, { ...EDGE_AB, ...row }]);
      expect(result.problems).toContainEqual({
        severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 4, detail,
      });
      expect(result.data).toBeNull();
    });
  }

  // A self-edge needs no graph to see, so it is `invalid-record` naming a field
  // rather than the whole-file `reference-cycle` below.
  it("refuses a task that blocks itself, as invalid-record", () => {
    const result = parseTasksFile([
      VALID_TASK_LIST, TASK_A, { ...EDGE_AB, blockerId: "ta", blockedId: "ta" },
    ]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/tasks.ndjson", line: 3, detail: "blockedId",
    });
    expect(result.data).toBeNull();
  });

  it("refuses the same ordered pair twice, keyed by the pair", () => {
    const result = parseTasksFile([VALID_TASK_LIST, TASK_A, TASK_B, EDGE_AB, EDGE_AB]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "duplicate-id", path: "data/tasks.ndjson", line: 5,
      detail: "blockerId=ta,blockedId=tb",
    });
    expect(result.data).toBeNull();
  });

  it("refuses an edge naming a task the archive does not carry, on either end", () => {
    const missingBlocker = parseTasksFile([
      VALID_TASK_LIST, TASK_B, { ...EDGE_AB, blockerId: "ghost" },
    ]);
    expect(missingBlocker.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/tasks.ndjson", line: 3,
      detail: "blockerId=ghost",
    });

    const missingBlocked = parseTasksFile([
      VALID_TASK_LIST, TASK_A, { ...EDGE_AB, blockedId: "ghost" },
    ]);
    expect(missingBlocked.problems).toContainEqual({
      severity: "error", code: "unknown-reference", path: "data/tasks.ndjson", line: 3,
      detail: "blockedId=ghost",
    });
  });

  // The store's acyclicity invariant, restated: an archive is the one way an
  // edge reaches the table without passing through `addDependency`.
  it("refuses a two-edge loop, naming the record that closes it", () => {
    const result = parseTasksFile([
      VALID_TASK_LIST, TASK_A, TASK_B, EDGE_AB, { ...EDGE_AB, blockerId: "tb", blockedId: "ta" },
    ]);
    expect(result.problems).toContainEqual({
      severity: "error", code: "reference-cycle", path: "data/tasks.ndjson", line: 5,
      detail: "blockerId=tb,blockedId=ta",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a three-edge loop", () => {
    const result = parseTasksFile([
      VALID_TASK_LIST, TASK_A, TASK_B, TASK_C,
      EDGE_AB,
      { ...EDGE_AB, blockerId: "tb", blockedId: "tc" },
      { ...EDGE_AB, blockerId: "tc", blockedId: "ta" },
    ]);
    const cycle = result.problems.find((problem) => problem.code === "reference-cycle");
    expect(cycle).toMatchObject({ severity: "error", path: "data/tasks.ndjson" });
    expect(result.data).toBeNull();
  });

  it("reports a loop exactly once, not once per edge on it", () => {
    const result = parseTasksFile([
      VALID_TASK_LIST, TASK_A, TASK_B, TASK_C,
      EDGE_AB,
      { ...EDGE_AB, blockerId: "tb", blockedId: "tc" },
      { ...EDGE_AB, blockerId: "tc", blockedId: "ta" },
    ]);
    expect(result.problems.filter((problem) => problem.code === "reference-cycle")).toHaveLength(1);
  });

  // A diamond is two paths to one task, not a loop — refusing it would forbid
  // the ordinary "these two both have to finish first" shape.
  it("accepts a diamond, and a task blocking several at once", () => {
    const taskD = { ...VALID_TASK, id: "td" };
    const result = parseTasksFile([
      VALID_TASK_LIST, TASK_A, TASK_B, TASK_C, taskD,
      EDGE_AB,
      { ...EDGE_AB, blockerId: "ta", blockedId: "tc" },
      { ...EDGE_AB, blockerId: "tb", blockedId: "td" },
      { ...EDGE_AB, blockerId: "tc", blockedId: "td" },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskDependencies).toHaveLength(4);
  });

  it("keeps the direction: the reverse pair alone is a different, valid edge", () => {
    const result = parseTasksFile([
      VALID_TASK_LIST, TASK_A, TASK_B, { ...EDGE_AB, blockerId: "tb", blockedId: "ta" },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data?.taskDependencies).toEqual([{ blockerId: "tb", blockedId: "ta" }]);
  });

  it("refuses a task-dependency record filed in the notes file", () => {
    const result = parseImportArchive(
      emptyInputWith(baseFiles({ fileContents: { "data/notes.ndjson": ndjson([EDGE_AB]) } })),
    );
    expect(result.problems).toContainEqual({
      severity: "error", code: "invalid-record", path: "data/notes.ndjson", line: 1, detail: "type",
    });
    expect(result.data).toBeNull();
  });
});

// --- ADR-043 section 1: salvage is a parser MODE ----------------------------

/** The salvage-mode twin of `emptyInputWith` — same fixtures, `mode: "import"`. */
function importInputWith(files: Map<string, string>, extra: Partial<ImportArchiveInput> = {}): ImportArchiveInput {
  return { files, ydocs: new Map(), blobNames: new Set(), hash: sha256, mode: "import", ...extra };
}

const SALVAGE_NOTE_FOLDER = {
  type: "note-folder", id: "f1", profileId: "profile1", parentId: null, name: "Fakultet",
  color: null, defaultTemplateId: null, isCaptureDefault: false, defaultView: "list",
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
};

const VALID_NOTE_TAG = {
  type: "note-tag", id: "ntag1", profileId: "profile1", name: "ideja",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const VALID_NOTE_ATTACHMENT = {
  type: "note-attachment", id: "att1", noteId: "n1", fileName: "slika.png", mime: "image/png",
  sizeBytes: 10, sha256: "a".repeat(64), createdAt: "2026-07-01T00:00:00.000Z",
};

const VALID_NOTE_VERSION = {
  type: "note-version", noteId: "n1", coveredSeq: 3, title: "Beleška",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const VALID_EXAM = {
  type: "exam", id: "ex1", profileId: "profile1", subjectId: "s1", examType: "pismeni",
  examDate: "2026-09-01", scope: null, createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const VALID_PLAN = {
  type: "plan", id: "pl1", profileId: "profile1", examId: "ex1", dailyMinutes: 60,
  startDate: "2026-08-01", examWeekBoost: false, createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const VALID_BLOCK = {
  type: "block", id: "bl1", planId: "pl1", profileId: "profile1", blockDate: "2026-08-02",
  minutes: 60, status: "planned", createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const VALID_REVIEW = {
  type: "review", id: "rv1", profileId: "profile1", cardId: "c1", rating: 3, state: 1,
  due: "2026-01-03T00:00:00.000Z", stability: 1, difficulty: 2, elapsedDays: 0,
  lastElapsedDays: 0, scheduledDays: 1, learningSteps: 0, review: "2026-01-02T00:00:00.000Z",
  createdAt: "2026-01-02T00:00:00.000Z",
};

const VALID_FOCUS_SESSION = {
  type: "focus-session", id: "fs1", profileId: "profile1", subjectId: "s1",
  startedAt: "2026-01-02T09:00:00.000Z", endedAt: "2026-01-02T10:00:00.000Z",
  createdAt: "2026-01-02T10:00:00.000Z", updatedAt: "2026-01-02T10:00:00.000Z",
};

describe("parseImportArchive — import mode: archive-level problems stay hard errors", () => {
  it("refuses a missing manifest exactly as restore does", () => {
    const result = parseImportArchive(importInputWith(new Map()));
    expect(result.problems).toEqual([{ severity: "error", code: "missing-manifest", path: "manifest.json" }]);
    expect(result.data).toBeNull();
    expect(result.dropped).toEqual([]);
  });

  it("refuses an unparseable manifest", () => {
    const files = baseFiles();
    files.set("manifest.json", "{ not json");
    const result = parseImportArchive(importInputWith(files));
    expect(result.problems).toEqual([{ severity: "error", code: "invalid-manifest", path: "manifest.json" }]);
    expect(result.data).toBeNull();
  });

  it("refuses an unsupported schema version", () => {
    const result = parseImportArchive(importInputWith(baseFiles({ schemaVersion: "2.0.0" })));
    expect(result.problems).toEqual([
      { severity: "error", code: "unsupported-schema-version", path: "manifest.json", detail: "2.0.0" },
    ]);
    expect(result.data).toBeNull();
  });

  it("refuses a checksum mismatch", () => {
    const files = baseFiles();
    files.set("data/tasks.ndjson", ndjson([VALID_TASK_LIST]));
    const result = parseImportArchive(importInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "checksum-mismatch", path: "data/tasks.ndjson",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a missing data file", () => {
    const files = baseFiles();
    files.delete("data/study.ndjson");
    const result = parseImportArchive(importInputWith(files));
    expect(result.problems).toContainEqual({
      severity: "error", code: "missing-data-file", path: "data/study.ndjson",
    });
    expect(result.data).toBeNull();
  });

  it("refuses a malformed NDJSON line — a corrupt container is not something to guess at", () => {
    const content = `${JSON.stringify(VALID_TASK_LIST)}\n{ broken\n`;
    const files = baseFiles({ fileContents: { "data/tasks.ndjson": content } });
    const result = parseImportArchive(importInputWith(files));
    expect(result.problems).toEqual([
      { severity: "error", code: "invalid-json", path: "data/tasks.ndjson", line: 2 },
    ]);
    expect(result.data).toBeNull();
    expect(result.dropped).toEqual([]);
  });
});

describe("parseImportArchive — import mode: a bad row is dropped, not fatal", () => {
  it("demotes invalid-record to a warning, drops the row, and keeps the good ones", () => {
    const broken = { ...VALID_TASK, id: "t2", status: "nonsense" };
    const files = baseFiles({ fileContents: { "data/tasks.ndjson": tasksFile([VALID_TASK, broken]) } });

    const result = parseImportArchive(importInputWith(files));

    expect(result.problems).toEqual([
      { severity: "warning", code: "invalid-record", path: "data/tasks.ndjson", line: 3, detail: "status" },
    ]);
    expect(result.data?.tasks.map((row) => row.id)).toEqual(["t1"]);
    expect(result.dropped).toEqual([
      { module: "tasks", type: "task", reason: "invalid-record", detail: "status" },
    ]);
  });

  it("demotes an unknown record type, naming the raw string and no known type", () => {
    const files = baseFiles({
      fileContents: { "data/tasks.ndjson": tasksFile([{ type: "gadget", id: "g1" }]) },
    });

    const result = parseImportArchive(importInputWith(files));

    expect(result.problems).toEqual([
      { severity: "warning", code: "unknown-record-type", path: "data/tasks.ndjson", line: 2, detail: "gadget" },
    ]);
    expect(result.dropped).toEqual([
      { module: "tasks", type: null, reason: "unknown-record-type", detail: "gadget" },
    ]);
    expect(result.data).not.toBeNull();
  });

  it("demotes a known type sitting in the wrong data file", () => {
    const files = baseFiles({ fileContents: { "data/calendar.ndjson": ndjson([VALID_SUBJECT]) } });

    const result = parseImportArchive(importInputWith(files));

    expect(result.problems).toEqual([
      { severity: "warning", code: "invalid-record", path: "data/calendar.ndjson", line: 1, detail: "type" },
    ]);
    expect(result.dropped).toEqual([
      { module: "calendar", type: "subject", reason: "invalid-record", detail: "type" },
    ]);
    expect(result.data?.subjects).toEqual([]);
  });

  it("drops the SECOND occurrence of a duplicate id and keeps the first", () => {
    const first = { ...VALID_EVENT, title: "Prvi" };
    const second = { ...VALID_EVENT, title: "Drugi" };
    const files = baseFiles({ fileContents: { "data/calendar.ndjson": ndjson([first, second]) } });

    const result = parseImportArchive(importInputWith(files));

    expect(result.problems).toEqual([
      { severity: "warning", code: "duplicate-id", path: "data/calendar.ndjson", line: 2, detail: "e1" },
    ]);
    expect(result.data?.events.map((row) => row.title)).toEqual(["Prvi"]);
    expect(result.dropped).toEqual([
      { module: "calendar", type: "event", reason: "duplicate-id", detail: "e1" },
    ]);
  });

  it("drops the second occurrence of a duplicate JOIN row, keyed on its composite identity", () => {
    const link = { type: "note-tag-link", noteId: "n1", tagId: "ntag1" };
    const files = baseFiles({
      fileContents: { "data/notes.ndjson": ndjson([VALID_NOTE_TAG, VALID_NOTE, link, link]) },
    });

    const result = parseImportArchive(importInputWith(files));

    expect(result.dropped).toEqual([
      { module: "notes", type: "note-tag-link", reason: "duplicate-id", detail: "noteId=n1,tagId=ntag1" },
    ]);
    expect(result.data?.noteTagLinks).toHaveLength(1);
  });

  it("names every drop in problems as well — salvage never becomes silence", () => {
    const files = baseFiles({
      fileContents: {
        "data/tasks.ndjson": tasksFile([{ ...VALID_TASK, id: "t2", priority: "urgent" }]),
        "data/calendar.ndjson": ndjson([{ ...VALID_PERSON, month: 13 }]),
      },
    });

    const result = parseImportArchive(importInputWith(files));

    expect(result.dropped).toHaveLength(2);
    expect(result.problems).toHaveLength(2);
    expect(result.problems.every((p) => p.severity === "warning")).toBe(true);
    expect(result.data).not.toBeNull();
  });
});

describe("parseImportArchive — import mode: drops cascade along references", () => {
  it("a dropped list leaves its tasks in the Inbox rule's null placement", () => {
    const list = { ...VALID_TASK_LIST, id: "tl-bad", isInbox: false, name: "Posao", defaultView: "gantt" };
    const section = {
      type: "task-section", id: "sec1", listId: "tl-bad", name: "U toku", position: 1024,
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const task = { ...VALID_TASK, id: "t9", listId: "tl-bad", sectionId: "sec1" };
    const files = baseFiles({ fileContents: { "data/tasks.ndjson": ndjson([list, section, task]) } });

    const result = parseImportArchive(importInputWith(files));

    // The list's `defaultView` is outside migration 022's CHECK, so the list
    // itself drops; its section drops with it; the task survives, unplaced.
    expect(result.data?.taskLists).toEqual([]);
    expect(result.data?.taskSections).toEqual([]);
    expect(result.data?.tasks).toHaveLength(1);
    expect(result.data?.tasks[0]?.listId).toBeNull();
    expect(result.data?.tasks[0]?.sectionId).toBeNull();
    expect(result.dropped.map((drop) => `${drop.type ?? "?"}:${drop.reason}`)).toEqual([
      "task-list:invalid-record",
      "task:unknown-reference",
      "task-section:unknown-reference",
    ]);
  });

  it("a dropped deck takes its cards, and the cards take their review log", () => {
    const deck = { ...VALID_DECK, name: "" };
    const files = baseFiles({
      fileContents: {
        "data/study.ndjson": ndjson([VALID_SUBJECT, deck, VALID_CARD, VALID_REVIEW]),
      },
    });

    const result = parseImportArchive(importInputWith(files));

    expect(result.data?.subjects).toHaveLength(1);
    expect(result.data?.decks).toEqual([]);
    expect(result.data?.cards).toEqual([]);
    expect(result.data?.reviewLog).toEqual([]);
    expect(result.dropped.map((drop) => drop.type)).toEqual(["deck", "card", "review"]);
  });

  it("a dropped subject cascades all the way to a study block", () => {
    const subject = { ...VALID_SUBJECT, color: "neon" };
    const files = baseFiles({
      fileContents: {
        "data/study.ndjson": ndjson([subject, VALID_EXAM, VALID_PLAN, VALID_BLOCK, VALID_FOCUS_SESSION]),
      },
    });

    const result = parseImportArchive(importInputWith(files));

    expect(result.data?.subjects).toEqual([]);
    expect(result.data?.exams).toEqual([]);
    expect(result.data?.plans).toEqual([]);
    expect(result.data?.blocks).toEqual([]);
    expect(result.data?.focusSessions).toEqual([]);
    expect(new Set(result.dropped.map((drop) => drop.type))).toEqual(
      new Set(["subject", "exam", "plan", "block", "focus-session"]),
    );
  });

  it("a dropped note takes its attachments, versions, tag links and derived cards", () => {
    const note = { ...VALID_NOTE, pinned: "yes" };
    const link = { type: "note-tag-link", noteId: "n1", tagId: "ntag1" };
    const derived = { ...VALID_CARD, sourceNoteId: "n1", sourceBlockKey: "b1" };
    const files = baseFiles({
      fileContents: {
        "data/notes.ndjson": ndjson([VALID_NOTE_TAG, note, link, VALID_NOTE_ATTACHMENT, VALID_NOTE_VERSION]),
        "data/study.ndjson": ndjson([VALID_SUBJECT, VALID_DECK, derived]),
      },
    });

    const result = parseImportArchive(
      importInputWith(files, {
        ydocs: new Map([["data/note-versions/n1/3.ydoc", docSnapshot("verzija")]]),
        blobNames: new Set(["a".repeat(64)]),
      }),
    );

    expect(result.data?.notes).toEqual([]);
    expect(result.data?.noteAttachments).toEqual([]);
    expect(result.data?.noteVersions).toEqual([]);
    expect(result.data?.noteTagLinks).toEqual([]);
    expect(result.data?.cards).toEqual([]);
    // The tag itself is not a dependent of the note and stays.
    expect(result.data?.noteTags).toHaveLength(1);
  });

  it("a dropped parent task takes its subtree", () => {
    const parent = { ...VALID_TASK, id: "tp", title: "" };
    const child = { ...VALID_TASK, id: "tc", parentId: "tp" };
    const grandchild = { ...VALID_TASK, id: "tg", parentId: "tc" };
    const files = baseFiles({
      fileContents: { "data/tasks.ndjson": tasksFile([parent, child, grandchild]) },
    });

    const result = parseImportArchive(importInputWith(files));

    expect(result.data?.tasks).toEqual([]);
    expect(result.dropped.map((drop) => drop.detail)).toEqual(["title", "parentId=tp", "parentId=tc"]);
  });

  it("a note whose folder dropped keeps its body and lands at the root", () => {
    const folder = { ...SALVAGE_NOTE_FOLDER, color: "neon" };
    const note = { ...VALID_NOTE, folderId: "f1" };
    const files = baseFiles({ fileContents: { "data/notes.ndjson": ndjson([folder, note]) } });

    const result = parseImportArchive(importInputWith(files));

    expect(result.data?.noteFolders).toEqual([]);
    expect(result.data?.notes).toHaveLength(1);
    expect(result.data?.notes[0]?.folderId).toBeNull();
  });

  it("a note whose card deck dropped keeps its body and stops generating cards", () => {
    const deck = { ...VALID_DECK, name: "" };
    const note = { ...VALID_NOTE, cardDeckId: "dk1" };
    const files = baseFiles({
      fileContents: {
        "data/study.ndjson": ndjson([VALID_SUBJECT, deck]),
        "data/notes.ndjson": ndjson([note]),
      },
    });

    const result = parseImportArchive(importInputWith(files));

    expect(result.data?.notes).toHaveLength(1);
    expect(result.data?.notes[0]?.cardDeckId).toBeNull();
  });

  it("a task pointing at a section of some OTHER list falls to the list body", () => {
    const other = { ...VALID_TASK_LIST, id: "tl2", isInbox: false, name: "Drugi" };
    const section = {
      type: "task-section", id: "sec1", listId: "tl2", name: "U toku", position: 1024,
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const task = { ...VALID_TASK, listId: "tl1", sectionId: "sec1" };
    const files = baseFiles({
      fileContents: { "data/tasks.ndjson": ndjson([VALID_TASK_LIST, other, section, task]) },
    });

    const result = parseImportArchive(importInputWith(files));

    expect(result.data?.tasks).toHaveLength(1);
    expect(result.data?.tasks[0]?.listId).toBe("tl1");
    expect(result.data?.tasks[0]?.sectionId).toBeNull();
  });

  it("breaks a parent cycle by dropping the row it closes on, then cascades", () => {
    const a = { ...SALVAGE_NOTE_FOLDER, id: "fa", parentId: "fb" };
    const b = { ...SALVAGE_NOTE_FOLDER, id: "fb", parentId: "fa" };
    const files = baseFiles({ fileContents: { "data/notes.ndjson": ndjson([a, b]) } });

    const result = parseImportArchive(importInputWith(files));

    expect(result.data?.noteFolders).toEqual([]);
    expect(result.dropped.map((drop) => drop.reason)).toEqual(["reference-cycle", "unknown-reference"]);
    expect(result.problems.every((p) => p.severity === "warning")).toBe(true);
  });

  it("a dangling reference to a row that was never in the archive at all still drops the referrer", () => {
    const files = baseFiles({
      fileContents: { "data/study.ndjson": ndjson([VALID_SUBJECT, VALID_DECK, VALID_CARD, VALID_REVIEW]) },
    });
    // Same archive, minus the deck: the card and its review have nothing to hang off.
    const withoutDeck = baseFiles({
      fileContents: { "data/study.ndjson": ndjson([VALID_SUBJECT, VALID_CARD, VALID_REVIEW]) },
    });

    expect(parseImportArchive(importInputWith(files)).data?.cards).toHaveLength(1);
    const result = parseImportArchive(importInputWith(withoutDeck));
    expect(result.data?.cards).toEqual([]);
    expect(result.data?.reviewLog).toEqual([]);
  });
});

describe("parseImportArchive — import mode: Yjs state", () => {
  it("keeps a note whose state will not decode, and says so", () => {
    const files = baseFiles({ fileContents: { "data/notes.ndjson": ndjson([VALID_NOTE]) } });
    const result = parseImportArchive(
      importInputWith(files, { ydocs: new Map([["data/notes/n1.ydoc", new Uint8Array([9, 9, 9])]]) }),
    );

    expect(result.problems).toEqual([
      { severity: "warning", code: "invalid-ydoc", path: "data/notes/n1.ydoc" },
    ]);
    expect(result.data?.notes).toHaveLength(1);
    expect(result.data?.notes[0]?.snapshot).toBeNull();
    // The ROW survived, so nothing was dropped.
    expect(result.dropped).toEqual([]);
  });

  it("drops a note version whose state is missing, and keeps its note", () => {
    const files = baseFiles({
      fileContents: { "data/notes.ndjson": ndjson([VALID_NOTE, VALID_NOTE_VERSION]) },
    });

    const result = parseImportArchive(importInputWith(files));

    expect(result.problems).toEqual([
      { severity: "warning", code: "missing-ydoc", path: "data/note-versions/n1/3.ydoc" },
    ]);
    expect(result.data?.notes).toHaveLength(1);
    expect(result.data?.noteVersions).toEqual([]);
    expect(result.dropped).toEqual([
      {
        module: "notes", type: "note-version", reason: "missing-ydoc",
        detail: "data/note-versions/n1/3.ydoc",
      },
    ]);
  });

  it("carries a surviving note's and version's state through untouched", () => {
    const noteState = docSnapshot("telo");
    const versionState = docSnapshot("verzija");
    const files = baseFiles({
      fileContents: { "data/notes.ndjson": ndjson([VALID_NOTE, VALID_NOTE_VERSION]) },
    });

    const result = parseImportArchive(
      importInputWith(files, {
        ydocs: new Map([
          ["data/notes/n1.ydoc", noteState],
          ["data/note-versions/n1/3.ydoc", versionState],
        ]),
      }),
    );

    expect(result.problems).toEqual([]);
    expect(result.data?.notes[0]?.snapshot).toBe(noteState);
    expect(result.data?.noteVersions[0]?.snapshot).toBe(versionState);
  });
});

describe("parseImportArchive — mode is opt-in and restore is unchanged", () => {
  it("defaults to restore when no mode is given", () => {
    const files = baseFiles({
      fileContents: { "data/tasks.ndjson": tasksFile([{ ...VALID_TASK, status: "nonsense" }]) },
    });

    const result = parseImportArchive(emptyInputWith(files));

    expect(result.problems[0]?.severity).toBe("error");
    expect(result.data).toBeNull();
    expect(result.dropped).toEqual([]);
  });

  it("restore mode refuses what import mode salvages, from the very same archive", () => {
    const files = baseFiles({
      fileContents: { "data/tasks.ndjson": tasksFile([VALID_TASK, { ...VALID_TASK, id: "t2", done: true }]) },
    });

    const strict = parseImportArchive({ ...emptyInputWith(files), mode: "restore" });
    const salvaged = parseImportArchive({ ...emptyInputWith(files), mode: "import" });

    expect(strict.data).toBeNull();
    expect(strict.dropped).toEqual([]);
    expect(salvaged.data?.tasks.map((row) => row.id)).toEqual(["t1"]);
  });

  it("reads a flawless round trip identically in both modes", () => {
    const archive = buildExportArchive({ ...emptyExportInput(), data: richProfileData() });
    const strict = parseImportArchive(toImportInput(archive));
    const salvaged = parseImportArchive({ ...toImportInput(archive), mode: "import" });

    expect(strict.problems).toEqual([]);
    expect(salvaged.problems).toEqual([]);
    expect(salvaged.dropped).toEqual([]);
    expect(salvaged.data).toEqual(strict.data);
  });
});
