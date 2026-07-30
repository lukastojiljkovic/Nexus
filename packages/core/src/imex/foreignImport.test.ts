import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { extractNoteLinkTargets } from "../notes/noteLinks.js";
import { countProfileModules, type ProfileData } from "./exportArchive.js";
import { planForeignImport, type ForeignImportTarget } from "./foreignImport.js";
import type { ImportDrop } from "./importArchive.js";

const T0 = "2026-07-01T00:00:00.000Z";

/** A deterministic `mintId`, so a test can name the id a row was given. */
function counterMint(): () => string {
  let next = 0;
  return () => `new-${++next}`;
}

/** A note snapshot whose paragraph holds one `noteLink` and one `attachmentImage`, so the Yjs rewrite has something to rewrite. */
function linkedSnapshot(noteId: string, attachmentId: string): Uint8Array {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  const link = new Y.XmlElement("noteLink");
  const image = new Y.XmlElement("attachmentImage");
  doc.getXmlFragment("default").push([paragraph, image]);
  paragraph.insert(0, [link]);
  link.setAttribute("noteId", noteId);
  image.setAttribute("attachmentId", attachmentId);
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
}

/** Every `attachmentId` a snapshot's document holds, in document order. */
function attachmentIdsOf(snapshot: Uint8Array): string[] {
  const ids: string[] = [];
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): void => {
    if (!(node instanceof Y.XmlElement)) return;
    if (node.nodeName === "attachmentImage") {
      const id = node.getAttribute("attachmentId");
      if (typeof id === "string") ids.push(id);
    }
    for (const child of node.toArray()) walk(child);
  };
  for (const child of doc.getXmlFragment("default").toArray()) walk(child);
  doc.destroy();
  return ids;
}

function emptyProfileData(): ProfileData {
  return {
    tasks: [], taskLists: [], taskSections: [], taskTags: [], taskTagLinks: [],
    taskAttachments: [], taskTemplates: [], taskDependencies: [],
    events: [], documents: [], renewals: [], people: [],
    subjects: [], exams: [], decks: [], cards: [], reviewLog: [], plans: [], blocks: [],
    focusSessions: [], notifications: [],
    notes: [], noteFolders: [], noteTags: [], noteTagLinks: [], noteTemplates: [],
    noteAttachments: [], noteVersions: [],
    dashboardSettings: [],
  };
}

/**
 * Somebody else's profile, with at least one row per `ProfileData` member and
 * every cross-module reference exercised: a task in a section of a nested list,
 * a note-derived card, a review log entry, a note carrying a wiki-link and an
 * attachment image, and a version of that note.
 */
function foreignProfileData(): ProfileData {
  return {
    ...emptyProfileData(),
    taskLists: [
      { id: "src-inbox", profileId: "src", parentId: null, name: "Inbox", isInbox: true, defaultView: "list", position: 1024, createdAt: T0, updatedAt: T0 },
      { id: "src-work", profileId: "src", parentId: "src-inbox", name: "Posao", isInbox: false, defaultView: "kanban", position: 2048, createdAt: T0, updatedAt: T0 },
    ],
    taskSections: [
      { id: "src-sec", listId: "src-work", name: "U toku", position: 1024, createdAt: T0, updatedAt: T0 },
    ],
    taskTags: [
      { id: "src-ttag-a", profileId: "src", name: "hitno", createdAt: T0 },
      { id: "src-ttag-b", profileId: "src", name: "kasnije", createdAt: T0 },
    ],
    tasks: [
      { id: "src-t1", profileId: "src", parentId: null, title: "Roditelj", description: null, status: "todo", priority: "none", done: false, dueDate: null, startDate: null, createdAt: T0, updatedAt: T0, completedAt: null, recurrence: null, reminderOffsets: [], listId: "src-work", sectionId: "src-sec", position: 1024 },
      { id: "src-t2", profileId: "src", parentId: "src-t1", title: "Dete", description: null, status: "todo", priority: "high", done: false, dueDate: null, startDate: null, createdAt: T0, updatedAt: T0, completedAt: null, recurrence: null, reminderOffsets: [], listId: "src-inbox", sectionId: null, position: 2048 },
    ],
    taskTagLinks: [
      { taskId: "src-t1", tagId: "src-ttag-a" },
      { taskId: "src-t2", tagId: "src-ttag-b" },
    ],
    events: [
      { id: "src-e1", profileId: "src", title: "Sastanak", description: null, startAt: "2026-07-10T09:00:00.000Z", endAt: null, allDay: false, location: null, category: null, createdAt: T0, updatedAt: T0, recurrence: null, recurrenceExdates: [], reminderOffsets: [30] },
    ],
    documents: [
      { id: "src-d1", profileId: "src", docType: "pasos", label: "Pasoš", expiryDate: "2030-01-01", reminderOffsets: [30], notes: null, createdAt: T0, updatedAt: T0 },
    ],
    renewals: [{ id: "src-r1", documentId: "src-d1", previousExpiry: "2020-01-01", renewedAt: T0 }],
    people: [
      { id: "src-p1", profileId: "src", name: "Marko", kind: "birthday", month: 3, day: 14, year: 1990, note: null, createdAt: T0, updatedAt: T0 },
    ],
    subjects: [
      { id: "src-s1", profileId: "src", name: "Analiza", color: "jade", semester: null, archived: false, createdAt: T0, updatedAt: T0 },
    ],
    exams: [
      { id: "src-ex1", profileId: "src", subjectId: "src-s1", examType: "pismeni", examDate: "2026-09-01", scope: null, createdAt: T0, updatedAt: T0 },
    ],
    decks: [
      { id: "src-dk1", profileId: "src", subjectId: "src-s1", name: "Glava 1", createdAt: T0, updatedAt: T0 },
    ],
    cards: [
      { id: "src-c1", profileId: "src", deckId: "src-dk1", front: "Q", back: "A", sourceNoteId: "src-n1", sourceBlockKey: "b1", due: "2026-01-02T00:00:00.000Z", stability: 1, difficulty: 2, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: 0, lapses: 0, state: 0, lastReview: null, createdAt: T0, updatedAt: T0 },
    ],
    reviewLog: [
      { id: "src-rv1", profileId: "src", cardId: "src-c1", rating: 3, state: 1, due: "2026-01-03T00:00:00.000Z", stability: 1, difficulty: 2, elapsedDays: 0, lastElapsedDays: 0, scheduledDays: 1, learningSteps: 0, review: "2026-01-02T00:00:00.000Z", createdAt: T0 },
    ],
    plans: [
      { id: "src-pl1", profileId: "src", examId: "src-ex1", dailyMinutes: 60, startDate: "2026-08-01", examWeekBoost: false, createdAt: T0, updatedAt: T0 },
    ],
    blocks: [
      { id: "src-bl1", planId: "src-pl1", profileId: "src", blockDate: "2026-08-02", minutes: 60, status: "planned", createdAt: T0, updatedAt: T0 },
    ],
    focusSessions: [
      { id: "src-fs1", profileId: "src", subjectId: "src-s1", startedAt: "2026-01-02T09:00:00.000Z", endedAt: "2026-01-02T10:00:00.000Z", createdAt: T0, updatedAt: T0 },
    ],
    notifications: [
      { id: "src-nt1", profileId: "src", source: "exam", entityId: "src-ex1", occurrenceKey: "k", title: "T", body: "B", status: "delivered", snoozedUntil: null, deliveredAt: T0, createdAt: T0, updatedAt: T0 },
    ],
    noteFolders: [
      { id: "src-f1", profileId: "src", parentId: null, name: "Fakultet", color: "zlato", defaultTemplateId: "src-tpl1", isCaptureDefault: true, createdAt: T0, updatedAt: T0 },
      { id: "src-f2", profileId: "src", parentId: "src-f1", name: "Analiza", color: null, defaultTemplateId: null, isCaptureDefault: false, createdAt: T0, updatedAt: T0 },
    ],
    noteTags: [
      { id: "src-ntag-a", profileId: "src", name: "ideja", createdAt: T0 },
      { id: "src-ntag-b", profileId: "src", name: "arhiva", createdAt: T0 },
    ],
    notes: [
      { id: "src-n1", profileId: "src", title: "Prva", folderId: "src-f2", pinned: true, cardDeckId: "src-dk1", createdAt: T0, updatedAt: T0, snapshot: linkedSnapshot("src-n2", "src-att1") },
      { id: "src-n2", profileId: "src", title: "Druga", folderId: null, pinned: false, cardDeckId: null, createdAt: T0, updatedAt: T0, snapshot: null },
    ],
    noteTagLinks: [
      { noteId: "src-n1", tagId: "src-ntag-a" },
      { noteId: "src-n2", tagId: "src-ntag-b" },
    ],
    noteTemplates: [
      { id: "src-tpl1", profileId: "src", name: "Sastanak", content: '{"type":"doc"}', createdAt: T0, updatedAt: T0 },
    ],
    noteAttachments: [
      { id: "src-att1", noteId: "src-n1", fileName: "slika.png", mime: "image/png", sizeBytes: 10, sha256: "a".repeat(64), createdAt: T0 },
      { id: "src-att2", noteId: "src-n2", fileName: "kopija.png", mime: "image/png", sizeBytes: 10, sha256: "a".repeat(64), createdAt: T0 },
    ],
    noteVersions: [
      { noteId: "src-n1", coveredSeq: 3, title: "Prva", createdAt: T0, snapshot: linkedSnapshot("src-n2", "src-att1") },
    ],
  };
}

function emptyTarget(overrides: Partial<ForeignImportTarget> = {}): ForeignImportTarget {
  return {
    profileId: "target-profile",
    inboxListId: "target-inbox",
    noteTags: [],
    taskTags: [],
    taskTemplateNames: [],
    claimsCaptureDefault: false,
    ...overrides,
  };
}

function plan(data: ProfileData, target = emptyTarget(), dropped: readonly ImportDrop[] = []) {
  return planForeignImport({ data, dropped }, target, counterMint());
}

/** Every id-shaped string the planned data holds, so a test can assert no source id survived. */
function allIdsIn(data: ProfileData): string[] {
  return JSON.stringify(data, (_key, value: unknown) => (value instanceof Uint8Array ? null : value))
    .match(/src-[a-z0-9-]+/g)
    ?.slice() ?? [];
}

describe("planForeignImport — every row is minted anew", () => {
  it("gives every id-bearing row a fresh id and stamps the target profile", () => {
    const { data } = plan(foreignProfileData());

    expect(data.tasks.map((row) => row.id)).not.toContain("src-t1");
    expect(data.tasks.every((row) => row.profileId === "target-profile")).toBe(true);
    expect(data.events.every((row) => row.profileId === "target-profile")).toBe(true);
    expect(data.subjects.every((row) => row.profileId === "target-profile")).toBe(true);
    expect(data.notes.every((row) => row.profileId === "target-profile")).toBe(true);
  });

  it("leaves not one id from the source profile anywhere in the plan", () => {
    const { data } = plan(foreignProfileData());
    expect(allIdsIn(data)).toEqual([]);
  });

  it("mints exactly once per row — two rows never share an id", () => {
    const { data } = plan(foreignProfileData());
    const ids = [
      ...data.tasks.map((r) => r.id),
      ...data.taskLists.map((r) => r.id),
      ...data.taskSections.map((r) => r.id),
      ...data.notes.map((r) => r.id),
      ...data.cards.map((r) => r.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("preserves each member's row order", () => {
    const { data } = plan(foreignProfileData());
    expect(data.tasks.map((row) => row.title)).toEqual(["Roditelj", "Dete"]);
    expect(data.noteFolders.map((row) => row.name)).toEqual(["Fakultet", "Analiza"]);
  });

  it("carries every non-reference field through verbatim", () => {
    const { data } = plan(foreignProfileData());
    const event = data.events[0];
    expect(event?.title).toBe("Sastanak");
    expect(event?.reminderOffsets).toEqual([30]);
    expect(data.people[0]?.month).toBe(3);
    expect(data.people[0]?.day).toBe(14);
    expect(data.blocks[0]?.minutes).toBe(60);
    expect(data.noteTemplates[0]?.content).toBe('{"type":"doc"}');
  });
});

describe("planForeignImport — references remap through the id map", () => {
  it("remaps a task's parent, list and section", () => {
    const { data } = plan(foreignProfileData());
    const [parent, child] = data.tasks;
    const work = data.taskLists.find((row) => row.name === "Posao");

    expect(parent?.listId).toBe(work?.id);
    expect(parent?.sectionId).toBe(data.taskSections[0]?.id);
    expect(data.taskSections[0]?.listId).toBe(work?.id);
    expect(child?.parentId).toBe(parent?.id);
  });

  it("remaps both ends of a tag link", () => {
    const { data } = plan(foreignProfileData());
    const taskIds = new Set(data.tasks.map((row) => row.id));
    const tagIds = new Set(data.taskTags.map((row) => row.id));

    expect(data.taskTagLinks).toHaveLength(2);
    expect(data.taskTagLinks.every((link) => taskIds.has(link.taskId) && tagIds.has(link.tagId))).toBe(true);
  });

  it("remaps the study chain: exam and deck to subject, card to deck, review to card, plan to exam, block to plan, session to subject", () => {
    const { data } = plan(foreignProfileData());
    const subject = data.subjects[0];

    expect(data.exams[0]?.subjectId).toBe(subject?.id);
    expect(data.decks[0]?.subjectId).toBe(subject?.id);
    expect(data.focusSessions[0]?.subjectId).toBe(subject?.id);
    expect(data.cards[0]?.deckId).toBe(data.decks[0]?.id);
    expect(data.reviewLog[0]?.cardId).toBe(data.cards[0]?.id);
    expect(data.plans[0]?.examId).toBe(data.exams[0]?.id);
    expect(data.blocks[0]?.planId).toBe(data.plans[0]?.id);
  });

  it("remaps a card's source note, keeping its block key", () => {
    const { data } = plan(foreignProfileData());
    expect(data.cards[0]?.sourceNoteId).toBe(data.notes[0]?.id);
    expect(data.cards[0]?.sourceBlockKey).toBe("b1");
  });

  it("remaps a renewal to its document", () => {
    const { data } = plan(foreignProfileData());
    expect(data.renewals[0]?.documentId).toBe(data.documents[0]?.id);
  });

  it("remaps a note's folder and card deck, and a folder's parent", () => {
    const { data } = plan(foreignProfileData());
    expect(data.noteFolders[1]?.parentId).toBe(data.noteFolders[0]?.id);
    expect(data.notes[0]?.folderId).toBe(data.noteFolders[1]?.id);
    expect(data.notes[0]?.cardDeckId).toBe(data.decks[0]?.id);
    expect(data.notes[1]?.folderId).toBeNull();
    expect(data.notes[1]?.cardDeckId).toBeNull();
  });

  it("remaps an attachment and a version to their note", () => {
    const { data } = plan(foreignProfileData());
    expect(data.noteAttachments[0]?.noteId).toBe(data.notes[0]?.id);
    expect(data.noteAttachments[1]?.noteId).toBe(data.notes[1]?.id);
    expect(data.noteVersions[0]?.noteId).toBe(data.notes[0]?.id);
    expect(data.noteVersions[0]?.coveredSeq).toBe(3);
  });

  it("remaps both ends of a note tag link", () => {
    const { data } = plan(foreignProfileData());
    const noteIds = new Set(data.notes.map((row) => row.id));
    const tagIds = new Set(data.noteTags.map((row) => row.id));
    expect(data.noteTagLinks.every((link) => noteIds.has(link.noteId) && tagIds.has(link.tagId))).toBe(true);
  });
});

describe("planForeignImport — tags merge by name onto the target's", () => {
  function withTags(taskTags: ProfileData["taskTags"], noteTags: ProfileData["noteTags"] = []): ProfileData {
    return { ...emptyProfileData(), taskTags, noteTags };
  }

  it("keeps the TARGET's id for a tag whose name already exists there", () => {
    const source = withTags([{ id: "src-tag", profileId: "src", name: "hitno", createdAt: T0 }]);
    const { data, report } = plan(source, emptyTarget({ taskTags: [{ id: "tgt-tag", name: "hitno" }] }));

    expect(data.taskTags).toEqual([]);
    expect(report.modules.tasks.merged).toBe(1);
  });

  it("remaps a link onto the target's tag id", () => {
    const source: ProfileData = {
      ...emptyProfileData(),
      taskLists: [{ id: "src-inbox", profileId: "src", parentId: null, name: "Inbox", isInbox: true, defaultView: "list", position: 1024, createdAt: T0, updatedAt: T0 }],
      tasks: [{ id: "src-t", profileId: "src", parentId: null, title: "A", description: null, status: "todo", priority: "none", done: false, dueDate: null, startDate: null, createdAt: T0, updatedAt: T0, completedAt: null, recurrence: null, reminderOffsets: [], listId: "src-inbox", sectionId: null, position: 0 }],
      taskTags: [{ id: "src-tag", profileId: "src", name: "hitno", createdAt: T0 }],
      taskTagLinks: [{ taskId: "src-t", tagId: "src-tag" }],
    };

    const { data } = plan(source, emptyTarget({ taskTags: [{ id: "tgt-tag", name: "hitno" }] }));

    expect(data.taskTagLinks).toEqual([{ taskId: data.tasks[0]?.id, tagId: "tgt-tag" }]);
  });

  it("mints a fresh tag when the target has no tag of that name", () => {
    const source = withTags([{ id: "src-tag", profileId: "src", name: "kasnije", createdAt: T0 }]);
    const { data, report } = plan(source, emptyTarget({ taskTags: [{ id: "tgt-tag", name: "hitno" }] }));

    expect(data.taskTags).toHaveLength(1);
    expect(data.taskTags[0]?.name).toBe("kasnije");
    expect(data.taskTags[0]?.id).not.toBe("src-tag");
    expect(report.modules.tasks.merged).toBe(0);
  });

  it("matches on the store's own exact (profile, name) uniqueness — case is NOT folded", () => {
    const source = withTags([{ id: "src-tag", profileId: "src", name: "Posao", createdAt: T0 }]);
    const { data } = plan(source, emptyTarget({ taskTags: [{ id: "tgt-tag", name: "posao" }] }));

    expect(data.taskTags).toHaveLength(1);
    expect(data.taskTags[0]?.name).toBe("Posao");
  });

  it("does not fold diacritics either — „skola\" and „škola\" are two tags", () => {
    const source = withTags([{ id: "src-tag", profileId: "src", name: "škola", createdAt: T0 }]);
    const { data } = plan(source, emptyTarget({ taskTags: [{ id: "tgt-tag", name: "skola" }] }));

    expect(data.taskTags).toHaveLength(1);
    expect(data.taskTags[0]?.name).toBe("škola");
  });

  it("collapses two SOURCE tags of the same name onto one row", () => {
    const source = withTags([
      { id: "src-a", profileId: "src", name: "hitno", createdAt: T0 },
      { id: "src-b", profileId: "src", name: "hitno", createdAt: "2026-07-02T00:00:00.000Z" },
    ]);
    const { data, report } = plan(source);

    expect(data.taskTags).toHaveLength(1);
    expect(data.taskTags[0]?.createdAt).toBe(T0);
    expect(report.modules.tasks.merged).toBe(1);
  });

  it("dedupes two links that collapse onto the same (task, tag) pair", () => {
    const source: ProfileData = {
      ...emptyProfileData(),
      taskLists: [{ id: "src-inbox", profileId: "src", parentId: null, name: "Inbox", isInbox: true, defaultView: "list", position: 1024, createdAt: T0, updatedAt: T0 }],
      tasks: [{ id: "src-t", profileId: "src", parentId: null, title: "A", description: null, status: "todo", priority: "none", done: false, dueDate: null, startDate: null, createdAt: T0, updatedAt: T0, completedAt: null, recurrence: null, reminderOffsets: [], listId: "src-inbox", sectionId: null, position: 0 }],
      taskTags: [
        { id: "src-a", profileId: "src", name: "hitno", createdAt: T0 },
        { id: "src-b", profileId: "src", name: "hitno", createdAt: T0 },
      ],
      taskTagLinks: [
        { taskId: "src-t", tagId: "src-a" },
        { taskId: "src-t", tagId: "src-b" },
      ],
    };

    const { data, report } = plan(source);

    expect(data.taskTagLinks).toHaveLength(1);
    // One tag merged, one link deduped.
    expect(report.modules.tasks.merged).toBe(2);
  });

  it("merges note tags by exactly the same rule", () => {
    const source = withTags([], [
      { id: "src-n-a", profileId: "src", name: "ideja", createdAt: T0 },
      { id: "src-n-b", profileId: "src", name: "arhiva", createdAt: T0 },
    ]);
    const { data, report } = plan(source, emptyTarget({ noteTags: [{ id: "tgt-idea", name: "ideja" }] }));

    expect(data.noteTags.map((row) => row.name)).toEqual(["arhiva"]);
    expect(report.modules.notes.merged).toBe(1);
  });

  it("never merges anything but tags — two lists named „Posao\" coexist", () => {
    const source: ProfileData = {
      ...emptyProfileData(),
      taskLists: [
        { id: "src-inbox", profileId: "src", parentId: null, name: "Inbox", isInbox: true, defaultView: "list", position: 1024, createdAt: T0, updatedAt: T0 },
        { id: "src-work", profileId: "src", parentId: null, name: "Posao", isInbox: false, defaultView: "list", position: 2048, createdAt: T0, updatedAt: T0 },
      ],
    };

    const { data } = plan(source);
    expect(data.taskLists.map((row) => row.name)).toEqual(["Posao"]);
  });
});

describe("planForeignImport — singletons collapse", () => {
  it("does not import the source's Inbox row, and points its tasks at the target's", () => {
    const { data, report } = plan(foreignProfileData());

    expect(data.taskLists.map((row) => row.name)).toEqual(["Posao"]);
    expect(data.taskLists[0]?.parentId).toBe("target-inbox");
    expect(data.tasks[1]?.listId).toBe("target-inbox");
    expect(report.skips).toContainEqual({
      code: "source-inbox-collapsed", module: "tasks", type: "task-list", count: 1,
    });
  });

  it("reads an era-defaulted null listId as the target's Inbox", () => {
    const source: ProfileData = {
      ...emptyProfileData(),
      tasks: [{ id: "src-t", profileId: "src", parentId: null, title: "Stari", description: null, status: "todo", priority: "none", done: false, dueDate: null, startDate: null, createdAt: T0, updatedAt: T0, completedAt: null, recurrence: null, reminderOffsets: [], listId: null, sectionId: null, position: 0 }],
    };

    const { data } = plan(source);
    expect(data.tasks[0]?.listId).toBe("target-inbox");
  });

  it("keeps a section of the source's Inbox, hanging it off the target's", () => {
    const source: ProfileData = {
      ...emptyProfileData(),
      taskLists: [{ id: "src-inbox", profileId: "src", parentId: null, name: "Inbox", isInbox: true, defaultView: "list", position: 1024, createdAt: T0, updatedAt: T0 }],
      taskSections: [{ id: "src-sec", listId: "src-inbox", name: "Danas", position: 1024, createdAt: T0, updatedAt: T0 }],
    };

    const { data } = plan(source);
    expect(data.taskSections).toHaveLength(1);
    expect(data.taskSections[0]?.listId).toBe("target-inbox");
  });

  it("does not import the notification ledger — a delivery record is not portable content", () => {
    const { data, report } = plan(foreignProfileData());

    expect(data.notifications).toEqual([]);
    expect(report.skips).toContainEqual({
      code: "notifications-not-imported", module: "notifications", type: "notification", count: 1,
    });
  });

  it("names the manifest settings as a by-design skip, always", () => {
    const { report } = plan(emptyProfileData());
    expect(report.skips).toContainEqual({
      code: "settings-not-imported", module: null, type: null, count: 1,
    });
  });

  it("imports the review log and focus sessions — FSRS history is study data", () => {
    const { data } = plan(foreignProfileData());
    expect(data.reviewLog).toHaveLength(1);
    expect(data.focusSessions).toHaveLength(1);
  });
});

describe("planForeignImport — Yjs state travels through the same map", () => {
  it("rewrites a note's wiki-link and attachment image onto the minted ids", () => {
    const { data } = plan(foreignProfileData());
    const snapshot = data.notes[0]?.snapshot;
    if (snapshot === undefined || snapshot === null) throw new Error("expected a snapshot");

    expect(extractNoteLinkTargets(snapshot)).toEqual([data.notes[1]?.id]);
    expect(attachmentIdsOf(snapshot)).toEqual([data.noteAttachments[0]?.id]);
  });

  it("rewrites a note VERSION's state too", () => {
    const { data } = plan(foreignProfileData());
    const snapshot = data.noteVersions[0]?.snapshot;
    if (snapshot === undefined) throw new Error("expected a version snapshot");

    expect(extractNoteLinkTargets(snapshot)).toEqual([data.notes[1]?.id]);
    expect(attachmentIdsOf(snapshot)).toEqual([data.noteAttachments[0]?.id]);
  });

  it("leaves a link to something the archive does not carry exactly as it was", () => {
    const source: ProfileData = {
      ...emptyProfileData(),
      notes: [
        { id: "src-n1", profileId: "src", title: "Prva", folderId: null, pinned: false, cardDeckId: null, createdAt: T0, updatedAt: T0, snapshot: linkedSnapshot("gone-note", "gone-att") },
      ],
    };

    const { data } = plan(source);
    const snapshot = data.notes[0]?.snapshot;
    if (snapshot === undefined || snapshot === null) throw new Error("expected a snapshot");

    expect(extractNoteLinkTargets(snapshot)).toEqual(["gone-note"]);
    expect(attachmentIdsOf(snapshot)).toEqual(["gone-att"]);
  });

  it("leaves a note that has never been edited without state", () => {
    const { data } = plan(foreignProfileData());
    expect(data.notes[1]?.snapshot).toBeNull();
  });
});

describe("planForeignImport — blobs", () => {
  it("names every surviving attachment's blob exactly once", () => {
    const { blobNames } = plan(foreignProfileData());
    expect([...blobNames]).toEqual(["a".repeat(64)]);
  });

  it("names nothing when there are no attachments", () => {
    const { blobNames } = plan(emptyProfileData());
    expect(blobNames.size).toBe(0);
  });
});

describe("planForeignImport — the report adds up", () => {
  const MODULES = ["tasks", "calendar", "study", "notifications", "notes"] as const;

  it("balances parsed = imported + merged + skipped for every module, with drops, merges and a collapse all at once", () => {
    const dropped: readonly ImportDrop[] = [
      { module: "tasks", type: "task", reason: "invalid-record", detail: "status" },
      { module: "notes", type: "note", reason: "unknown-reference", detail: "folderId=x" },
      { module: "study", type: "card", reason: "duplicate-id", detail: "c1" },
      { module: "calendar", type: "event", reason: "reference-cycle", detail: "e1" },
      { module: "notifications", type: "notification", reason: "invalid-record", detail: "status" },
    ];
    const target = emptyTarget({
      taskTags: [{ id: "tgt-a", name: "hitno" }, { id: "tgt-b", name: "kasnije" }],
      noteTags: [{ id: "tgt-idea", name: "ideja" }],
    });
    const { report } = plan(foreignProfileData(), target, dropped);

    for (const module of MODULES) {
      const counts = report.modules[module];
      expect(counts.parsed).toBe(counts.imported + counts.merged + counts.skipped);
    }
    // And the skip reasons themselves account for every skipped row.
    for (const module of MODULES) {
      const named = report.skips
        .filter((skip) => skip.module === module)
        .reduce((sum, skip) => sum + skip.count, 0);
      expect(named).toBe(report.modules[module].skipped);
    }
  });

  it("counts what the archive carried, including the rows the parser had to drop", () => {
    const dropped: readonly ImportDrop[] = [
      { module: "calendar", type: "event", reason: "invalid-record", detail: "startAt" },
      { module: "calendar", type: "event", reason: "duplicate-id", detail: "e1" },
    ];
    const { report } = plan(foreignProfileData(), emptyTarget(), dropped);

    // 1 event + 1 document + 1 renewal + 1 person survived, 2 events dropped.
    expect(report.modules.calendar.parsed).toBe(6);
    expect(report.modules.calendar.imported).toBe(4);
    expect(report.modules.calendar.skipped).toBe(2);
  });

  it("names each parser drop by module, type and reason, grouped with a count", () => {
    const dropped: readonly ImportDrop[] = [
      { module: "study", type: "card", reason: "unknown-reference", detail: "deckId=a" },
      { module: "study", type: "card", reason: "unknown-reference", detail: "deckId=b" },
      { module: "study", type: "review", reason: "unknown-reference", detail: "cardId=a" },
    ];
    const { report } = plan(emptyProfileData(), emptyTarget(), dropped);

    expect(report.skips).toContainEqual({
      code: "unknown-reference", module: "study", type: "card", count: 2,
    });
    expect(report.skips).toContainEqual({
      code: "unknown-reference", module: "study", type: "review", count: 1,
    });
  });

  it("counts an all-imported module honestly", () => {
    const { report } = plan(foreignProfileData());
    // 1 subject + 1 exam + 1 deck + 1 card + 1 review + 1 plan + 1 block + 1 session.
    expect(report.modules.study).toEqual({ parsed: 8, imported: 8, merged: 0, skipped: 0 });
  });

  it("counts the notifications module as entirely skipped", () => {
    const { report } = plan(foreignProfileData());
    expect(report.modules.notifications).toEqual({ parsed: 1, imported: 0, merged: 0, skipped: 1 });
  });

  it("counts the tasks module through the Inbox collapse and a tag merge", () => {
    const { report } = plan(foreignProfileData(), emptyTarget({ taskTags: [{ id: "tgt", name: "hitno" }] }));

    // 2 lists + 1 section + 2 tags + 2 tasks + 2 links = 9 parsed.
    expect(report.modules.tasks).toEqual({ parsed: 9, imported: 7, merged: 1, skipped: 1 });
  });

  it("reports zeroes for a module the archive carried nothing for", () => {
    const { report } = plan(emptyProfileData());
    expect(report.modules.calendar).toEqual({ parsed: 0, imported: 0, merged: 0, skipped: 0 });
  });

  it("never names a skip with a count of zero", () => {
    const { report } = plan(emptyProfileData());
    expect(report.skips.every((skip) => skip.count > 0)).toBe(true);
  });

  it("agrees with countProfileModules about what it planned", () => {
    const { data, report } = plan(foreignProfileData());
    const counted = countProfileModules(data);
    for (const module of MODULES) {
      expect(report.modules[module].imported).toBe(counted[module]);
    }
  });
});

describe("planForeignImport — purity", () => {
  it("leaves the source data exactly as it found it", () => {
    const source = foreignProfileData();
    const before = JSON.stringify(source, (_key, value: unknown) =>
      value instanceof Uint8Array ? [...value] : value,
    );

    plan(source, emptyTarget({ taskTags: [{ id: "tgt", name: "hitno" }] }));

    const after = JSON.stringify(source, (_key, value: unknown) =>
      value instanceof Uint8Array ? [...value] : value,
    );
    expect(after).toBe(before);
  });

  it("plans the same archive identically twice, given the same minting sequence", () => {
    const first = planForeignImport({ data: foreignProfileData(), dropped: [] }, emptyTarget(), counterMint());
    const second = planForeignImport({ data: foreignProfileData(), dropped: [] }, emptyTarget(), counterMint());

    expect(second.report).toEqual(first.report);
    expect(second.data.tasks).toEqual(first.data.tasks);
    expect(second.data.notes.map((row) => row.id)).toEqual(first.data.notes.map((row) => row.id));
  });
});

// --- Merge-time extensions (supervisor): the ProfileData members Lane P's base could not see ---

describe("planForeignImport — task attachments, templates, dependencies, dashboard", () => {
  const TPL_PAYLOAD = {
    title: "Nedeljni pregled", description: null, priority: "none",
    dueOffsetDays: null, reminderOffsets: [], recurrence: null,
    tagNames: [], subtaskTitles: [],
  };

  function withTaskExtras(): ProfileData {
    const data = foreignProfileData();
    return {
      ...data,
      taskAttachments: [
        { id: "src-ta1", taskId: "src-t1", fileName: "ugovor.pdf", mime: "application/pdf", sizeBytes: 9, sha256: "b".repeat(64), createdAt: T0 },
      ],
      taskTemplates: [
        { id: "src-tt1", profileId: "src", name: "Nedeljni pregled", payload: TPL_PAYLOAD, createdAt: T0, updatedAt: T0 },
        { id: "src-tt2", profileId: "src", name: "Zauzeto ime", payload: TPL_PAYLOAD, createdAt: T0, updatedAt: T0 },
        { id: "src-tt3", profileId: "src", name: "Nedeljni pregled", payload: TPL_PAYLOAD, createdAt: T0, updatedAt: T0 },
      ],
      taskDependencies: [{ blockerId: "src-t1", blockedId: "src-t2" }],
    };
  }

  it("remaps a dependency's both ends and an attachment's task, and the attachment blob joins blobNames", () => {
    const result = plan(withTaskExtras());
    const [t1, t2] = result.data.tasks;
    expect(result.data.taskDependencies).toEqual([{ blockerId: t1?.id, blockedId: t2?.id }]);
    const [attachment] = result.data.taskAttachments;
    expect(attachment?.taskId).toBe(t1?.id);
    expect(result.blobNames.has("b".repeat(64))).toBe(true);
    // The note attachments' shared blob is still there too — one set, both tables.
    expect(result.blobNames.has("a".repeat(64))).toBe(true);
  });

  it("skips a template whose name the target holds, and a second source template of one name — the target wins, first writer wins", () => {
    const result = plan(withTaskExtras(), emptyTarget({ taskTemplateNames: ["Zauzeto ime"] }));
    expect(result.data.taskTemplates.map((row) => row.name)).toEqual(["Nedeljni pregled"]);
    expect(result.report.skips).toContainEqual({
      code: "template-name-taken", module: "tasks", type: "task-template", count: 2,
    });
  });

  it("never imports dashboard settings and says so", () => {
    const data = {
      ...withTaskExtras(),
      dashboardSettings: [
        { profileId: "src", backgroundHash: "c".repeat(64), backgroundMime: "image/png", backgroundSizeBytes: 5, backgroundDim: 60 },
      ],
    };
    const result = plan(data);
    expect(result.data.dashboardSettings).toEqual([]);
    // The background's blob is NOT copied: nothing in the plan references it.
    expect(result.blobNames.has("c".repeat(64))).toBe(false);
    expect(result.report.skips).toContainEqual({
      code: "dashboard-settings-not-imported", module: "dashboard", type: "dashboard-settings", count: 1,
    });
    expect(result.report.modules.dashboard).toEqual({ parsed: 1, imported: 0, merged: 0, skipped: 1 });
  });

  it("remaps a folder's default template and clears its capture claim exactly when the target already claims one", () => {
    const keep = plan(withTaskExtras());
    const [f1] = keep.data.noteFolders;
    // The source's claim survives against a target with none…
    expect(f1?.isCaptureDefault).toBe(true);
    expect(f1?.defaultTemplateId).toBe(keep.data.noteTemplates[0]?.id);
    // …and yields when the target holds the mark.
    const yielded = plan(withTaskExtras(), emptyTarget({ claimsCaptureDefault: true }));
    expect(yielded.data.noteFolders.every((row) => !row.isCaptureDefault)).toBe(true);
  });

  it("still balances with the new members in play", () => {
    const result = plan(withTaskExtras(), emptyTarget({ taskTemplateNames: ["Zauzeto ime"] }));
    for (const counts of Object.values(result.report.modules)) {
      expect(counts.parsed).toBe(counts.imported + counts.merged + counts.skipped);
    }
  });
});
