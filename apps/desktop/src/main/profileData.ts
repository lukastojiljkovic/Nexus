/**
 * One profile's complete interchange state, read out of the stores main
 * already owns (ADR-022 section 3). This exists as its own module for the
 * reason ADR-023 section 5 gives: a restore's undo is the profile's
 * pre-restore state, and it is captured with **the exact function the exporter
 * gathers with**, so the undo snapshot and the export archive are provably the
 * same shape. Any module a future slice forgets to gather here is a module
 * both of them lose — one bug, in one place, and a type error rather than a
 * silent omission (which is precisely the failure ADR-022 was written to
 * repair).
 *
 * Deliberately Electron-free — no `app`, no `dialog`, no `BrowserWindow` —
 * unlike `imex.ts`, which owns the save dialog. That is what lets the restore
 * path that depends on this be exercised under plain Node/Vitest.
 */

import { extractNoteLinkTargets, mergeNoteState } from "@nexus/core";
import type {
  ExportNote,
  ExportNoteAttachment,
  ExportNoteCategory,
  ExportNoteFolder,
  ExportNoteTag,
  ExportNoteTagLink,
  ExportNoteTemplate,
  ExportNoteVersion,
  ExportSettings,
  ProfileData,
} from "@nexus/core";
import type {
  RestoredNoteDerived,
  RestoredPrivateNote,
  RestoredPrivateNoteVersion,
  RestoredPrivateRows,
} from "@nexus/db";
import type {
  CalendarSettingsStore,
  PrivateNoteStore,
  CardStore,
  DashboardSetStore,
  DashboardSettingsStore,
  DashboardWidgetStore,
  DeckStore,
  DocumentStore,
  EventStore,
  EventTemplateStore,
  ExamStore,
  FocusStore,
  NoteAttachmentStore,
  NoteOrgStore,
  NoteStore,
  NoteTemplateStore,
  NotificationStore,
  PeopleStore,
  PlanStore,
  SqliteFlagStore,
  StudySettingsStore,
  SubjectAttachmentStore,
  SubjectNoteLinkStore,
  SubjectStore,
  TaskAttachmentStore,
  TaskDependencyStore,
  TaskListStore,
  TaskStore,
  TaskTagStore,
  TaskTemplateStore,
  TopicStore,
} from "@nexus/db";

/**
 * Everything a full profile read goes through, as plain functions rather than
 * a direct `requireDb()` dependency — mirrors `NotificationSchedulerDeps`
 * (`main/notifications.ts`): keeps this module decoupled from `main/index.ts`'s
 * module-level state, with every store swap explicit at the call site.
 */
export interface ProfileDataDeps {
  taskStore(profileId: string): TaskStore;
  taskListStore(profileId: string): TaskListStore;
  taskTagStore(profileId: string): TaskTagStore;
  taskAttachmentStore(profileId: string): TaskAttachmentStore;
  taskTemplateStore(profileId: string): TaskTemplateStore;
  taskDependencyStore(profileId: string): TaskDependencyStore;
  eventStore(profileId: string): EventStore;
  eventTemplateStore(profileId: string): EventTemplateStore;
  calendarSettingsStore(profileId: string): CalendarSettingsStore;
  peopleStore(profileId: string): PeopleStore;
  documentStore(profileId: string): DocumentStore;
  subjectStore(profileId: string): SubjectStore;
  subjectAttachmentStore(profileId: string): SubjectAttachmentStore;
  subjectNoteLinkStore(profileId: string): SubjectNoteLinkStore;
  examStore(profileId: string): ExamStore;
  deckStore(profileId: string): DeckStore;
  cardStore(profileId: string): CardStore;
  topicStore(profileId: string): TopicStore;
  planStore(profileId: string): PlanStore;
  studySettingsStore(profileId: string): StudySettingsStore;
  focusStore(profileId: string): FocusStore;
  notificationStore(profileId: string): NotificationStore;
  noteStore(profileId: string): NoteStore;
  noteOrgStore(profileId: string): NoteOrgStore;
  noteTemplateStore(profileId: string): NoteTemplateStore;
  noteAttachmentStore(profileId: string): NoteAttachmentStore;
  flagStore(profileId: string): SqliteFlagStore;
  dashboardSettingsStore(profileId: string): DashboardSettingsStore;
  dashboardWidgetStore(profileId: string): DashboardWidgetStore;
  dashboardSetStore(profileId: string): DashboardSetStore;
}

/** Every NOTE-module row `ProfileData` requires (ADR-022 section 3) — `gatherNotes`'s return shape. */
interface GatheredNoteData {
  notes: ExportNote[];
  noteFolders: ExportNoteFolder[];
  noteTags: ExportNoteTag[];
  noteCategories: ExportNoteCategory[];
  noteTagLinks: ExportNoteTagLink[];
  noteTemplates: ExportNoteTemplate[];
  noteAttachments: ExportNoteAttachment[];
  noteVersions: ExportNoteVersion[];
}

/**
 * Gathers every NOTE-module row for one profile — kept out of
 * `gatherProfileData` itself since the per-note version/attachment fan-out
 * makes it long enough on its own.
 *
 * `noteStore.list()` already excludes soft-deleted notes — its `selectActive`
 * statement filters `deleted_at IS NULL`, the same gate `requireActive` uses
 * everywhere else in `NoteStore` — so nothing extra is needed here for
 * ADR-022's "live rows only" rule.
 *
 * A note's merged Yjs state is computed only when there is something to
 * merge: a never-edited note (`snapshot === null` AND `updates.length === 0`)
 * yields `snapshot: null` rather than the encoding of an empty document —
 * that null is what tells `buildExportArchive` to skip the `.ydoc` file and
 * emit an empty Markdown mirror instead.
 */
function gatherNotes(
  deps: Pick<ProfileDataDeps, "noteStore" | "noteOrgStore" | "noteTemplateStore" | "noteAttachmentStore">,
  profileId: string,
): GatheredNoteData {
  const notesStore = deps.noteStore(profileId);
  const orgStore = deps.noteOrgStore(profileId);
  const attachmentStore = deps.noteAttachmentStore(profileId);

  const notes: ExportNote[] = [];
  const noteVersions: ExportNoteVersion[] = [];
  const noteAttachments: ExportNoteAttachment[] = [];

  for (const meta of notesStore.list()) {
    const doc = notesStore.load(meta.id);
    const hasState = doc.snapshot !== null || doc.updates.length > 0;
    const snapshot = hasState ? mergeNoteState(doc.snapshot, doc.updates).snapshot : null;
    notes.push({ ...meta, snapshot });

    for (const version of notesStore.listVersions(meta.id)) {
      noteVersions.push({
        ...version,
        noteId: meta.id,
        snapshot: notesStore.loadVersion(meta.id, version.coveredSeq),
      });
    }

    noteAttachments.push(...attachmentStore.list(meta.id));
  }

  return {
    notes,
    noteFolders: orgStore.listFolders(),
    noteTags: orgStore.listTags(),
    noteCategories: orgStore.listCategories(),
    noteTagLinks: orgStore.listTagLinks(),
    noteTemplates: deps.noteTemplateStore(profileId).list(),
    noteAttachments,
    noteVersions,
  };
}

/**
 * Every live row of one profile, in the interchange shape both
 * `buildExportArchive` (writing an archive) and `RestoreStore` (writing a
 * profile) speak. Synchronous, because every store read here is synchronous
 * SQLite; only the feature flags are async, which is why settings are gathered
 * separately below.
 */
export function gatherProfileData(deps: ProfileDataDeps, profileId: string): ProfileData {
  const documentsStore = deps.documentStore(profileId);
  const documents = documentsStore.listActive();

  const decksStore = deps.deckStore(profileId);
  const decks = decksStore.listActive();

  const cardsStore = deps.cardStore(profileId);

  const plansStore = deps.planStore(profileId);
  const plans = plansStore.listActive();

  // Sections carry no profile scope of their own — they are read one list at a
  // time, through the already-scoped lists (TASK-004 / ADR-029).
  const listsStore = deps.taskListStore(profileId);
  const taskLists = listsStore.listActive();

  // Tags and their links are both profile-wide reads (migration 023) — the
  // links reach their tasks through the store's own scoping, so there is no
  // per-task fan-out here.
  const tagsStore = deps.taskTagStore(profileId);

  // Attachments, unlike tags, ARE read one task at a time (migration 024's
  // store is scoped through its task, exactly as the note one is through its
  // note), so the live task list is read once and reused for both.
  const tasks = deps.taskStore(profileId).listActive();
  const taskAttachmentsStore = deps.taskAttachmentStore(profileId);

  // Subject materials are read one subject at a time too (migration 035's store
  // is scoped through its subject, exactly as the task one is through its task),
  // so the live subject list is read once and reused for the fan-out below.
  const subjects = deps.subjectStore(profileId).listActive();
  const subjectAttachmentsStore = deps.subjectAttachmentStore(profileId);

  return {
    tasks,
    taskLists,
    taskSections: taskLists.flatMap((list) => listsStore.listSections(list.id)),
    taskTags: tagsStore.listTags(),
    taskTagLinks: tagsStore.listTagLinks(),
    taskAttachments: tasks.flatMap((task) => taskAttachmentsStore.list(task.id)),
    // Templates are a plain profile-wide read (migration 027): a template hangs
    // off no task and points at no list, so there is nothing to fan out over.
    taskTemplates: deps.taskTemplateStore(profileId).list(),
    // Also a profile-wide read (migration 029), and also filtered to live tasks
    // by the store itself — an edge hanging off a soft-deleted task is not part
    // of what the profile currently IS, which is what an export carries.
    taskDependencies: deps.taskDependencyStore(profileId).listLinks(),
    events: deps.eventStore(profileId).listActive(),
    // A plain profile-wide read (migration 036), like the task templates above:
    // a template hangs off no event and points at no day, so there is nothing to
    // fan out over.
    eventTemplates: deps.eventTemplateStore(profileId).list(),
    documents,
    renewals: documents.flatMap((document) => documentsStore.listRenewals(document.id)),
    people: deps.peopleStore(profileId).listActive(),
    // Always exactly one row (ADR-054), on the `dashboardSettings` argument
    // below: `get` resolves the both-null default a profile with no row still
    // has, so the archive says "no term set" out loud — and the undo snapshot
    // can put back the dates the user had set, which an omission could not.
    calendarSettings: [{ profileId, ...deps.calendarSettingsStore(profileId).get() }],
    subjects,
    subjectAttachments: subjects.flatMap((subject) => subjectAttachmentsStore.list(subject.id)),
    // A profile-wide read (migration 035), and filtered to live BOTH ends by the
    // store itself — a link running through a trashed note or subject is not
    // part of what the profile currently IS, which is what an export carries.
    subjectNoteLinks: deps.subjectNoteLinkStore(profileId).listLinks(),
    exams: deps.examStore(profileId).listActive(),
    decks,
    cards: decks.flatMap((deck) => cardsStore.listByDeck(deck.id)),
    reviewLog: cardsStore.listReviewLog(),
    // A profile-wide read (migration 046 / ADR-063), grouped by exam in rank
    // order by the store itself — the ranked curriculum, cuts included. The
    // store speaks `rank`, the interchange spells the column (`sortOrder`).
    examTopics: deps
      .topicStore(profileId)
      .listAll()
      .map(({ rank, ...topic }) => ({ ...topic, sortOrder: rank })),
    plans,
    blocks: plans.flatMap((plan) => plansStore.listBlocks(plan.id)),
    focusSessions: deps.focusStore(profileId).listActive(),
    // Always exactly one row (STUDY-007), on the `dashboardSettings` argument
    // below: `get` resolves the defaults a profile with no row still has, so an
    // archive that carried nothing here would restore as "retention 0.9, 20 new
    // a day, no review cap" anyway — writing the resolved values says the same
    // thing out loud, and lets the undo snapshot put back caps the user had set.
    studySettings: [{ profileId, ...deps.studySettingsStore(profileId).get() }],
    notifications: deps.notificationStore(profileId).listAll(),
    ...gatherNotes(deps, profileId),
    // Always exactly one row (ADR-041), because `get` resolves the defaults a
    // profile with no row still has: an archive that carried nothing here would
    // restore as "no background, dim 40" anyway, so writing the resolved values
    // says the same thing out loud — and makes the undo snapshot able to put
    // back a dim the user had set, which an omission could not. `activeSetId`
    // (ADR-055) rides in the same resolved row, its null meaning „Početna“.
    dashboardSettings: [{ profileId, ...deps.dashboardSettingsStore(profileId).get() }],
    // The named boards (DASH-008 / ADR-055): plain stored rows, one per board
    // the user made — the default board is not a row and so is not gathered.
    dashboardSets: deps.dashboardSetStore(profileId).list(),
    // The STORED rows, not the resolved layout — the opposite choice from the
    // settings row above, and for the opposite reason (ADR-045). A board that
    // never was rearranged has no rows, and that emptiness is itself
    // the fact worth carrying: it says "on the default arrangement", so a
    // restore leaves the target there and a later change to the default still
    // reaches it. Writing out the resolved five instead would silently freeze
    // every board onto today's default the first time it was backed up.
    dashboardWidgets: deps.dashboardWidgetStore(profileId).listAll(),
  };
}

/**
 * The profile-level settings an archive carries beside its rows (founder
 * decision #11): feature flags and notification preferences. Split from
 * `gatherProfileData` only because `flagStore.get()` is async — keeping the
 * row gather synchronous means a caller inside a database transaction can use
 * it without an await in the middle.
 */
export async function gatherProfileSettings(
  deps: Pick<ProfileDataDeps, "flagStore" | "notificationStore">,
  profileId: string,
): Promise<ExportSettings> {
  const notificationSettings = deps.notificationStore(profileId).getSettings();
  return {
    flags: await deps.flagStore(profileId).get(),
    notifications: {
      quietFrom: notificationSettings.quietFrom,
      quietTo: notificationSettings.quietTo,
      morningHour: notificationSettings.morningHour,
      enabledSources: notificationSettings.enabledSources,
      // NTF-009 (`1.19.0`): the resolved value, never an omission — the same
      // choice `studySettings`/`dashboardSettings` make just above. A profile
      // that never chose one exports „10 min“, which is what its snooze button
      // means, so a restore puts back a fact rather than a silence.
      snoozeDefault: notificationSettings.snoozeDefault,
    },
  };
}

/**
 * Re-derives, for every note, the two things a restore has to write but an
 * archive deliberately does not carry (ADR-023 section 6): the searchable
 * plaintext migration 017's index projects, and the outbound wiki-links
 * `note_links` holds.
 *
 * Both are normally produced by a running renderer — the editor reports its
 * links at flush time (ADR-013) and the plaintext falls out of compaction —
 * and a restore has no renderer, so they are recomputed here from the Yjs
 * state itself. A note with no state at all (`snapshot === null`) derives to
 * empty plaintext and no links, which is exactly what a never-edited note has.
 *
 * Used by both sides of a restore: the archive's notes on the way in, and the
 * profile's own notes when capturing the undo snapshot — the same reason
 * `gatherProfileData` is shared.
 */
export function deriveRestoredNotes(
  notes: readonly ExportNote[],
): Map<string, RestoredNoteDerived> {
  const derived = new Map<string, RestoredNoteDerived>();
  for (const note of notes) {
    if (note.snapshot === null) {
      derived.set(note.id, { plaintext: "", linkTargets: [] });
      continue;
    }
    derived.set(note.id, {
      plaintext: mergeNoteState(note.snapshot, []).plaintext,
      linkTargets: extractNoteLinkTargets(note.snapshot),
    });
  }
  return derived;
}

/**
 * The undo snapshot's PRIVATE half (ADR-057 §6): every sealed container of one
 * profile's private section, verbatim — bytes, never envelopes. Deliberately
 * OUTSIDE `ProfileData` and outside `gatherProfileData`, unlike every public
 * collection: the gather reads live rows in cleartext, while these rows are
 * opaque without the PRIV DEK — and undoing a restore must NOT need the DEK,
 * because the section may well have locked between the apply and the undo
 * click. Captured only when a restore is actually about to replace the private
 * tables, and put back byte-for-byte through the same conditional
 * `privateSealed` path (`RestoreStore.replaceProfileData`) it was captured for.
 */
export function gatherPrivateSealedRows(store: PrivateNoteStore): RestoredPrivateRows {
  const notes: RestoredPrivateNote[] = [];
  const versions: RestoredPrivateNoteVersion[] = [];
  for (const meta of store.list()) {
    notes.push({
      id: meta.id,
      sealed: store.readSealed(meta.id),
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    });
    for (const version of store.listVersions(meta.id)) {
      versions.push({
        noteId: meta.id,
        seq: version.seq,
        sealed: store.readVersion(meta.id, version.seq),
        createdAt: version.createdAt,
      });
    }
  }
  return { notes, versions };
}
