import type Database from "better-sqlite3-multiple-ciphers";
import type { ArchiveProfilePicture, ExportSettings, ProfileData } from "@nexus/core";
import { RestoreValidationError } from "../errors.js";
import { TOGGLEABLE_NOTIFICATION_SOURCES } from "../notify/notificationStore.js";
import { TASK_ORDER_GAP, TaskListStore } from "../tasks/taskListStore.js";
import { exdatesText, offsetsText, recurrenceText, viewConfigText } from "./columnText.js";

type DatabaseHandle = Database.Database;

/** What a restore needs about one note beyond its raw Yjs bytes. */
export interface RestoredNoteDerived {
  /** The note's plaintext body, from `mergeNoteState(snapshot, []).plaintext` (`@nexus/core`). Feeds `note_snapshots.plaintext`, which is what migration 017's search view projects as a note's searchable body. */
  plaintext: string;
  /** The ids this note's document wiki-links to, from `extractNoteLinkTargets(snapshot)` (`@nexus/core`). Rebuilds `note_links`. */
  linkTargets: readonly string[];
}

/** One private note's row exactly as `private_notes` holds it (migration 045): the SEALED container verbatim, plus the cleartext timestamps. Bytes, never envelopes — writing these needs no key, which is what lets a restore's undo replay them while the section is locked. */
export interface RestoredPrivateNote {
  id: string;
  sealed: Uint8Array;
  createdAt: string;
  updatedAt: string;
}

/** One private version row, on the same bytes-verbatim terms — `seq` is the sequence its container's AAD was sealed under, stored faithfully like `PrivateNoteStore` stores it. */
export interface RestoredPrivateNoteVersion {
  noteId: string;
  seq: number;
  sealed: Uint8Array;
  createdAt: string;
}

/** The private tables' whole replacement payload (ADR-057 §6): what a private-carrying restore writes after main re-seals under the current DEK, and what undo captured before it. */
export interface RestoredPrivateRows {
  notes: readonly RestoredPrivateNote[];
  versions: readonly RestoredPrivateNoteVersion[];
}

export interface RestoreProfileInput {
  /** The profile's name from the archive's manifest — the restore renames the target profile to it. */
  profileName: string;
  /**
   * The profile's picture from the archive's manifest (SET-001), or null when it
   * carries none. Written beside the name, in the same statement and for the
   * same reason: a restore REPLACES a profile, so the target ends up looking
   * exactly like the archive — including with no picture at all, when that is
   * what the archive says. Required rather than optional for `profileName`'s
   * reason: a caller that forgot it would silently leave the target wearing the
   * face it had before.
   */
  profilePicture: ArchiveProfilePicture | null;
  settings: ExportSettings;
  data: ProfileData;
  /** Keyed by note id. REQUIRED for every note whose `snapshot` is non-null. */
  derived: ReadonlyMap<string, RestoredNoteDerived>;
  /**
   * The private tables' CONDITIONAL replacement (ADR-057 §6). Present ⇒
   * `private_notes`/`private_note_versions` are wiped for this profile and
   * refilled with exactly these sealed rows, inside the same transaction as
   * everything else. Absent (or null) ⇒ the two tables are NOT TOUCHED AT ALL
   * — the pre-PRIV behaviour every existing caller keeps, and the safe
   * direction: an archive carrying no private records, or a target whose
   * section is locked, must never cost a profile its sealed rows. Optional
   * precisely because absence means "leave them standing", which — unlike a
   * forgotten `ProfileData` member — loses nothing.
   */
  privateSealed?: RestoredPrivateRows | null;
}

/**
 * Every table a restore empties for the target profile before writing
 * anything (R5): child tables first, so the wipe never depends on `ON DELETE
 * CASCADE` to reach a row (a future migration's table would silently survive
 * a restore if it relied on cascade alone — see `restoreStore.test.ts`'s
 * guard test, which reads `sqlite_master` and fails until a new table is
 * either added here or explicitly allow-listed as exempt). Twelve tables carry
 * no `profile_id` of their own and are scoped through their parent instead
 * (`document_renewals` through `tracked_documents`; `task_sections` through
 * `task_lists`; `task_tag_links`, `task_attachments` and `task_dependencies`
 * through `tasks`; `subject_attachments` and `subject_note_links` through
 * `subjects`; the six `note_*` child tables through `notes`) — see `wipeSqlFor`
 * below.
 */
export const RESTORE_WIPE_TABLES = [
  "document_renewals",
  "review_log",
  "cards",
  "decks",
  "exams",
  "study_blocks",
  // After the blocks whose `topic_id` names them (children before parents —
  // migration 046's SET NULL is never leaned on), before the plans beside
  // which their exam cascade would otherwise be the only reach.
  "exam_topics",
  "study_plans",
  "focus_sessions",
  "tracked_documents",
  // A subject's materials and its note links, before the subjects they hang off
  // — the arrangement the TASK group below has, and for its reason: children
  // before parents, never leaning on `ON DELETE CASCADE` to reach a row.
  "subject_attachments",
  "subject_note_links",
  "subjects",
  "events",
  // Beside the events, and free to sit anywhere for migration 027's reason one
  // module over: a template hangs off nothing but `profiles` and nothing hangs
  // off it (migration 036 — its payload names no row at all).
  "event_templates",
  "people",
  "notifications",
  // The tag links, attachments and dependency edges first, then the tasks they
  // hang off, then the sections, lists and tags those point at — children
  // before parents, all the way down.
  "task_tag_links",
  "task_attachments",
  "task_dependencies",
  "tasks",
  "task_sections",
  "task_lists",
  "task_tags",
  // Templates hang off nothing but `profiles` and nothing hangs off them
  // (migration 027 — a template's tags are NAMES, not rows), so their position
  // in this list is free; they sit at the end of the TASK group because that is
  // where a reader looks for them, not because anything above them requires it.
  "task_templates",
  "note_tag_links",
  "note_links",
  "note_attachments",
  "note_versions",
  "note_snapshots",
  "note_updates",
  "notes",
  "note_tags",
  "note_folders",
  "note_templates",
  "feature_flags",
  "ntf_settings",
  "ntf_source_settings",
  // The STUDY module's scheduling preferences (migration 034 / STUDY-007): a
  // per-profile settings row like the three above it, wiped and rewritten the
  // same way. Nothing hangs off it — the cards it governs are already gone by
  // the time this line runs.
  "study_settings",
  // The calendar's semester dates (migration 042 / ADR-054): a per-profile
  // settings row like its neighbours, wiped and rewritten the same way.
  // Nothing hangs off it — the term is a pair of day keys naming no row.
  "calendar_settings",
  // The dashboard's background choice (migration 030 / ADR-041): a per-profile
  // settings row like the two above it, wiped and rewritten the same way. The
  // blob it names is main's to garbage-collect afterward, never this store's.
  "dashboard_settings",
  // The dashboard's layout (migration 032 / ADR-045). Wiped rather than merged,
  // like everything here — and note that an archive carrying ZERO widget rows
  // therefore leaves the profile with none, which is precisely what it should:
  // no rows IS the default arrangement (`DashboardWidgetStore`), so a profile
  // that never rearranged its dashboard restores to the same default it had.
  "dashboard_widgets",
  // The named boards (migration 043 / ADR-055), AFTER the widgets that
  // reference them — children before parents, the rule this whole list keeps.
  // Zero rows in the archive likewise restores a profile with only „Početna“,
  // which is not a row and so needs nothing written to exist.
  "dashboard_sets",
] as const;

type WipeTable = (typeof RESTORE_WIPE_TABLES)[number];

/** The tables above that carry no `profile_id` column and must be scoped through their parent instead of a direct `WHERE profile_id = ?`. */
const SCOPED_THROUGH_PARENT: Partial<Record<WipeTable, string>> = {
  document_renewals: `DELETE FROM document_renewals WHERE document_id IN (SELECT id FROM tracked_documents WHERE profile_id = ?)`,
  task_sections: `DELETE FROM task_sections WHERE list_id IN (SELECT id FROM task_lists WHERE profile_id = ?)`,
  task_tag_links: `DELETE FROM task_tag_links WHERE task_id IN (SELECT id FROM tasks WHERE profile_id = ?)`,
  task_attachments: `DELETE FROM task_attachments WHERE task_id IN (SELECT id FROM tasks WHERE profile_id = ?)`,
  // Scoped through ONE end, exactly as `note_links` below is: both ends of an
  // edge are always tasks of the same profile — `TaskDependencyStore` refuses
  // any other pair, and the archive parser reference-checks both ends against
  // the archive's own tasks — so naming the blocker names the whole edge.
  task_dependencies: `DELETE FROM task_dependencies WHERE blocker_id IN (SELECT id FROM tasks WHERE profile_id = ?)`,
  subject_attachments: `DELETE FROM subject_attachments WHERE subject_id IN (SELECT id FROM subjects WHERE profile_id = ?)`,
  // Scoped through the SUBJECT end alone, on `task_dependencies`' terms: both
  // ends of a link always belong to one profile — `SubjectNoteLinkStore` refuses
  // any other pair, and the archive parser reference-checks both ends against
  // the archive's own rows — so naming the subject names the whole edge.
  subject_note_links: `DELETE FROM subject_note_links WHERE subject_id IN (SELECT id FROM subjects WHERE profile_id = ?)`,
  note_tag_links: `DELETE FROM note_tag_links WHERE note_id IN (SELECT id FROM notes WHERE profile_id = ?)`,
  note_links: `DELETE FROM note_links WHERE source_note_id IN (SELECT id FROM notes WHERE profile_id = ?)`,
  note_attachments: `DELETE FROM note_attachments WHERE note_id IN (SELECT id FROM notes WHERE profile_id = ?)`,
  note_versions: `DELETE FROM note_versions WHERE note_id IN (SELECT id FROM notes WHERE profile_id = ?)`,
  note_snapshots: `DELETE FROM note_snapshots WHERE note_id IN (SELECT id FROM notes WHERE profile_id = ?)`,
  note_updates: `DELETE FROM note_updates WHERE note_id IN (SELECT id FROM notes WHERE profile_id = ?)`,
};

/** Every wipe statement takes exactly one bound parameter: this store's own `profileId` (R4) — never the archive's. */
function wipeSqlFor(table: WipeTable): string {
  return SCOPED_THROUGH_PARENT[table] ?? `DELETE FROM ${table} WHERE profile_id = ?`;
}

/**
 * Writes a parsed, already-validated `ProfileData` (`@nexus/core`'s
 * `parseImportArchive`, ADR-022/023) into one profile's tables, replacing
 * everything that profile had (ADR-023 / IMEX-003). This is deliberately NOT
 * built on the existing per-module store classes: those mint fresh ids,
 * trim/re-stamp timestamps and re-validate business rules meant for live user
 * input, while a restore must reproduce archive rows byte for byte — ids and
 * timestamps included — over raw, bound `INSERT` statements instead.
 *
 * `parseImportArchive` is the validation boundary: every field shape, enum,
 * ISO-8601 shape, foreign-key reference (except one — see below) and parent
 * cycle in `input.data` has already been checked before this class ever sees
 * it, so nothing here re-validates a field. The one reference this class DOES
 * still resolve is `note_links`: a wiki-link target lives inside a note's Yjs
 * bytes, never as a JSON field the parser's cross-reference pass can see, so
 * `replaceProfileData` is what filters a link pointing at an id absent from
 * this archive's own notes (R10) — a genuinely normal case (an unresolved
 * wiki-link), not a corrupt archive.
 */
export class RestoreStore {
  private readonly wipeStatements: readonly Database.Statement[];
  /**
   * The profile row's own facts, in ONE statement (SET-001): the name and the
   * picture trio are the whole of what `profiles` says about a profile, and a
   * restore replaces all of it at once. Not part of `RESTORE_WIPE_TABLES` — the
   * `profiles` row is not wiped and rewritten (every other table's rows point at
   * its id), it is overwritten in place.
   */
  private readonly updateProfileIdentity: Database.Statement;
  /**
   * The ONE store class this restore leans on, and deliberately so: an archive
   * written before ADR-029 names no list at all, and the Inbox its tasks then
   * land in has no archive row to reproduce — it is a fresh row, minted now,
   * which is exactly what `ensureInbox` makes. Reproducing that literal here
   * would be a second definition of "what a profile's Inbox looks like".
   */
  private readonly taskLists: TaskListStore;

  private readonly insertTaskList: Database.Statement;
  private readonly insertTaskSection: Database.Statement;
  private readonly insertTaskTag: Database.Statement;
  private readonly insertTaskTagLink: Database.Statement;
  private readonly insertTaskAttachment: Database.Statement;
  private readonly insertTaskTemplate: Database.Statement;
  private readonly insertTaskDependency: Database.Statement;
  private readonly insertNoteFolder: Database.Statement;
  private readonly insertNoteTag: Database.Statement;
  private readonly insertSubject: Database.Statement;
  private readonly insertSubjectAttachment: Database.Statement;
  private readonly insertSubjectNoteLink: Database.Statement;
  private readonly insertExam: Database.Statement;
  private readonly insertDeck: Database.Statement;
  private readonly insertNote: Database.Statement;
  private readonly insertNoteSnapshot: Database.Statement;
  private readonly insertCard: Database.Statement;
  private readonly insertDocument: Database.Statement;
  private readonly insertRenewal: Database.Statement;
  private readonly insertTask: Database.Statement;
  private readonly insertEvent: Database.Statement;
  private readonly insertEventTemplate: Database.Statement;
  private readonly insertPerson: Database.Statement;
  private readonly insertNotification: Database.Statement;
  private readonly insertExamTopic: Database.Statement;
  private readonly insertPlan: Database.Statement;
  private readonly insertBlock: Database.Statement;
  private readonly insertFocusSession: Database.Statement;
  private readonly insertReviewLog: Database.Statement;
  private readonly insertNoteAttachment: Database.Statement;
  private readonly insertNoteTagLink: Database.Statement;
  private readonly insertNoteVersion: Database.Statement;
  private readonly insertNoteTemplate: Database.Statement;
  private readonly insertNoteLink: Database.Statement;
  private readonly insertFlag: Database.Statement;
  private readonly insertNtfSettings: Database.Statement;
  private readonly insertNtfSourceSetting: Database.Statement;
  private readonly insertStudySettings: Database.Statement;
  private readonly insertCalendarSettings: Database.Statement;
  private readonly insertDashboardSettings: Database.Statement;
  private readonly insertDashboardSet: Database.Statement;
  private readonly insertDashboardWidget: Database.Statement;
  private readonly wipePrivateNoteVersions: Database.Statement;
  private readonly wipePrivateNotes: Database.Statement;
  private readonly insertPrivateNote: Database.Statement;
  private readonly insertPrivateNoteVersion: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.wipeStatements = RESTORE_WIPE_TABLES.map((table) => db.prepare(wipeSqlFor(table)));
    this.updateProfileIdentity = db.prepare(
      `UPDATE profiles
          SET name = ?, picture_hash = ?, picture_mime = ?, picture_size_bytes = ?
        WHERE id = ?`,
    );
    this.taskLists = new TaskListStore(db, profileId);

    this.insertTaskList = db.prepare(
      `INSERT INTO task_lists
         (id, profile_id, parent_id, name, is_inbox, default_view, view_config, position,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertTaskSection = db.prepare(
      `INSERT INTO task_sections (id, list_id, name, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.insertTaskTag = db.prepare(
      `INSERT INTO task_tags (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)`,
    );
    this.insertTaskTagLink = db.prepare(
      `INSERT INTO task_tag_links (task_id, tag_id) VALUES (?, ?)`,
    );
    this.insertTaskAttachment = db.prepare(
      `INSERT INTO task_attachments (id, task_id, file_name, mime, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertTaskDependency = db.prepare(
      `INSERT INTO task_dependencies (blocker_id, blocked_id) VALUES (?, ?)`,
    );
    this.insertTaskTemplate = db.prepare(
      `INSERT INTO task_templates (id, profile_id, name, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.insertNoteFolder = db.prepare(
      `INSERT INTO note_folders
         (id, profile_id, parent_id, name, color, default_template_id, is_capture_default,
          default_view, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertNoteTag = db.prepare(
      `INSERT INTO note_tags (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)`,
    );
    this.insertSubject = db.prepare(
      `INSERT INTO subjects
         (id, profile_id, name, color, semester, archived, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertSubjectAttachment = db.prepare(
      `INSERT INTO subject_attachments (id, subject_id, file_name, mime, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertSubjectNoteLink = db.prepare(
      `INSERT INTO subject_note_links (subject_id, note_id, created_at) VALUES (?, ?, ?)`,
    );
    this.insertExam = db.prepare(
      `INSERT INTO exams
         (id, profile_id, subject_id, exam_type, exam_date, scope, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertDeck = db.prepare(
      `INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertNote = db.prepare(
      `INSERT INTO notes
         (id, profile_id, title, folder_id, pinned, card_deck_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertNoteSnapshot = db.prepare(
      `INSERT INTO note_snapshots (note_id, snapshot, plaintext, covered_seq, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.insertCard = db.prepare(
      `INSERT INTO cards
         (id, profile_id, deck_id, front, back, source_note_id, source_block_key,
          kind, cloze_text, cloze_ordinal, problem_steps,
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, last_review, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertDocument = db.prepare(
      `INSERT INTO tracked_documents
         (id, profile_id, doc_type, label, expiry_date, reminder_offsets,
          notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertRenewal = db.prepare(
      `INSERT INTO document_renewals (id, document_id, previous_expiry, renewed_at)
       VALUES (?, ?, ?, ?)`,
    );
    this.insertTask = db.prepare(
      `INSERT INTO tasks
         (id, profile_id, parent_id, title, description, status, priority,
          due_date, start_date, created_at, updated_at, completed_at, recurrence,
          reminder_offsets, list_id, section_id, position, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertEvent = db.prepare(
      `INSERT INTO events
         (id, profile_id, title, description, start_at, end_at, all_day,
          location, category, created_at, updated_at, recurrence, recurrence_exdates,
          reminder_offsets, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertEventTemplate = db.prepare(
      `INSERT INTO event_templates (id, profile_id, name, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.insertPerson = db.prepare(
      `INSERT INTO people
         (id, profile_id, name, kind, month, day, year, note, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertNotification = db.prepare(
      `INSERT INTO notifications
         (id, profile_id, source, entity_id, occurrence_key, title, body, status,
          snoozed_until, delivered_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertExamTopic = db.prepare(
      `INSERT INTO exam_topics
         (id, profile_id, exam_id, name, sort_order, confidence, deck_id, cut,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertPlan = db.prepare(
      `INSERT INTO study_plans
         (id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost, weekday_minutes,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertBlock = db.prepare(
      `INSERT INTO study_blocks
         (id, plan_id, profile_id, block_date, minutes, status, topic_id, kind, pinned,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertFocusSession = db.prepare(
      `INSERT INTO focus_sessions
         (id, profile_id, subject_id, started_at, ended_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertReviewLog = db.prepare(
      `INSERT INTO review_log
         (id, profile_id, card_id, rating, state, due, stability, difficulty,
          elapsed_days, last_elapsed_days, scheduled_days, learning_steps,
          review, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertNoteAttachment = db.prepare(
      `INSERT INTO note_attachments (id, note_id, file_name, mime, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertNoteTagLink = db.prepare(
      `INSERT INTO note_tag_links (note_id, tag_id) VALUES (?, ?)`,
    );
    this.insertNoteVersion = db.prepare(
      `INSERT INTO note_versions (note_id, covered_seq, snapshot, title, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.insertNoteTemplate = db.prepare(
      `INSERT INTO note_templates (id, profile_id, name, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.insertNoteLink = db.prepare(
      `INSERT INTO note_links (source_note_id, target_note_id) VALUES (?, ?)`,
    );
    this.insertFlag = db.prepare(
      `INSERT INTO feature_flags (profile_id, module_id, enabled, updated_at) VALUES (?, ?, ?, ?)`,
    );
    // `appetite_asked` is deliberately absent (ADR-033 section 6): the flag does
    // not travel, so a restored profile is asked again. `snooze_default` DOES —
    // it is a preference the user chose, and dropping it would reset a setting
    // rather than restore one; an archive from before `1.19.0` carries the
    // default, which is what its snooze button meant.
    this.insertNtfSettings = db.prepare(
      `INSERT INTO ntf_settings
         (profile_id, quiet_from, quiet_to, morning_hour, snooze_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertNtfSourceSetting = db.prepare(
      `INSERT INTO ntf_source_settings (profile_id, source, enabled) VALUES (?, ?, 0)`,
    );
    // An UPSERT rather than a plain INSERT, even though the wipe above has just
    // emptied this table for the profile: the row is keyed by the profile alone,
    // and the upsert shape stays correct even if a future caller runs it against
    // a profile nothing was wiped from. (Foreign import deliberately carries no
    // study settings at all — the target's workload choices are their own.)
    this.insertStudySettings = db.prepare(
      `INSERT INTO study_settings
         (profile_id, target_retention, new_per_day, max_reviews_per_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         target_retention = excluded.target_retention,
         new_per_day = excluded.new_per_day,
         max_reviews_per_day = excluded.max_reviews_per_day,
         updated_at = excluded.updated_at`,
    );
    // A plain INSERT, not an upsert: the wipe above has just emptied this
    // table for the profile, and unlike `study_settings` the row carries no
    // timestamps to reconcile — two columns and a key.
    this.insertCalendarSettings = db.prepare(
      `INSERT INTO calendar_settings (profile_id, semester_start, semester_end)
       VALUES (?, ?, ?)`,
    );
    this.insertDashboardSettings = db.prepare(
      `INSERT INTO dashboard_settings
         (profile_id, background_hash, background_mime, background_size_bytes,
          background_dim, active_set_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertDashboardSet = db.prepare(
      `INSERT INTO dashboard_sets (id, profile_id, name, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.insertDashboardWidget = db.prepare(
      `INSERT INTO dashboard_widgets
         (profile_id, instance_id, widget_id, size, set_id, position, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // The private tables' CONDITIONAL wipe (ADR-057 §6) — deliberately NOT in
    // `RESTORE_WIPE_TABLES`, which runs unconditionally: these two run only
    // when `privateSealed` is supplied. Children before parents, scoped through
    // the parent like every other no-profile-column table above.
    this.wipePrivateNoteVersions = db.prepare(
      `DELETE FROM private_note_versions
        WHERE note_id IN (SELECT id FROM private_notes WHERE profile_id = ?)`,
    );
    this.wipePrivateNotes = db.prepare(`DELETE FROM private_notes WHERE profile_id = ?`);
    this.insertPrivateNote = db.prepare(
      `INSERT INTO private_notes (id, profile_id, sealed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.insertPrivateNoteVersion = db.prepare(
      `INSERT INTO private_note_versions (note_id, seq, sealed, created_at)
       VALUES (?, ?, ?, ?)`,
    );
  }

  /**
   * Replaces this profile's entire stored content with `input.data`/`input.settings`
   * (ADR-023), rewrites the profile row's own facts — its name and its picture
   * (SET-001) — to what the archive's manifest states, and returns the number
   * of rows written. One transaction (R1): `PRAGMA defer_foreign_keys = ON` is the
   * first statement inside it (R2), since a self-referencing chain (`tasks.parent_id`,
   * `note_folders.parent_id`) can arrive in any order within the archive's own array,
   * and a note-sourced card's `source_note_id` is written before or after its note
   * depending on table order below — deferring every FK check to commit is what
   * makes insertion order matter for readability only, never correctness.
   */
  replaceProfileData(input: RestoreProfileInput, now: string): number {
    return this.db.transaction((): number => {
      this.db.pragma("defer_foreign_keys = ON");

      for (const statement of this.wipeStatements) {
        statement.run(this.profileId);
      }
      // The name and the picture together, exactly as the archive states them.
      // A null picture is written as null rather than skipped: the archive
      // saying "this profile has no picture" is a statement a REPLACE must
      // honour, and leaving the target's own in place would be a merge.
      this.updateProfileIdentity.run(
        input.profileName,
        input.profilePicture?.hash ?? null,
        input.profilePicture?.mime ?? null,
        input.profilePicture?.sizeBytes ?? null,
        this.profileId,
      );

      let written = 0;

      for (const list of input.data.taskLists) {
        this.insertTaskList.run(
          list.id, this.profileId, list.parentId, list.name, list.isInbox ? 1 : 0,
          list.defaultView, viewConfigText(list.viewConfig),
          list.position, list.createdAt, list.updatedAt,
        );
        written += 1;
      }

      // The wipe above removed the profile's Inbox with everything else, and an
      // archive that carries no lists at all — a tasks-excluded subset export
      // (IMEX-003), or a pre-1.3.0 archive with zero tasks — brings none back.
      // A profile without an Inbox is one where `TaskStore.create` has nowhere
      // to put a task (quick-add and the palette throw), so the restore leaves
      // one standing unconditionally: `ensureInbox` finds the archive's own
      // when it carried one, and mints a fresh, uncounted-elsewhere row when it
      // did not.
      {
        const inbox = this.taskLists.ensureInbox(now);
        if (!input.data.taskLists.some((list) => list.id === inbox.id)) written += 1;
      }

      for (const section of input.data.taskSections) {
        this.insertTaskSection.run(
          section.id, section.listId, section.name, section.position,
          section.createdAt, section.updatedAt,
        );
        written += 1;
      }

      for (const tag of input.data.taskTags) {
        this.insertTaskTag.run(tag.id, this.profileId, tag.name, tag.createdAt);
        written += 1;
      }

      // ADR-036: `defaultTemplateId` is written exactly as the archive states
      // it, with NO check that the named template came along. It may name a
      // built-in (a code constant, in no table at all), and even for a stored
      // row the dangling-id rule already covers the miss — the apply path reads
      // an unresolvable default as "no template". Validating it here could only
      // turn a harmless blank note into a refused restore.
      //
      // `defaultView` is optional in the interchange (NOTE-002): an archive
      // written before 1.17.0 carries none, and the folders in it opened as
      // lists — which is exactly what the fallback restores them as.
      for (const folder of input.data.noteFolders) {
        this.insertNoteFolder.run(
          folder.id, this.profileId, folder.parentId, folder.name, folder.color,
          folder.defaultTemplateId, folder.isCaptureDefault ? 1 : 0,
          folder.defaultView ?? "list",
          folder.createdAt, folder.updatedAt,
        );
        written += 1;
      }

      for (const tag of input.data.noteTags) {
        this.insertNoteTag.run(tag.id, this.profileId, tag.name, tag.createdAt);
        written += 1;
      }

      for (const subject of input.data.subjects) {
        this.insertSubject.run(
          subject.id, this.profileId, subject.name, subject.color, subject.semester,
          subject.archived ? 1 : 0, subject.createdAt, subject.updatedAt,
        );
        written += 1;
      }

      // The index rows for the files hanging off those subjects, on exactly the
      // terms the task-attachment loop above states: only the rows, because the
      // BYTES are written to the blob store before this transaction ever opens
      // (`main/restore.ts`).
      for (const material of input.data.subjectAttachments) {
        this.insertSubjectAttachment.run(
          material.id, material.subjectId, material.fileName, material.mime,
          material.sizeBytes, material.sha256, material.createdAt,
        );
        written += 1;
      }

      // And the note links, beside the dependency edges above and for the same
      // reason: a link is nothing but its ordered pair plus the moment it was
      // made, and both ends were preserved. Foreign keys are deferred for this
      // whole transaction, so a link may be written before the note it names.
      for (const link of input.data.subjectNoteLinks) {
        this.insertSubjectNoteLink.run(link.subjectId, link.noteId, link.createdAt);
        written += 1;
      }

      for (const exam of input.data.exams) {
        this.insertExam.run(
          exam.id, this.profileId, exam.subjectId, exam.examType, exam.examDate,
          exam.scope, exam.createdAt, exam.updatedAt,
        );
        written += 1;
      }

      for (const deck of input.data.decks) {
        this.insertDeck.run(
          deck.id, this.profileId, deck.subjectId, deck.name, deck.createdAt, deck.updatedAt,
        );
        written += 1;
      }

      // R8: covered_seq is the max coveredSeq among a note's restored versions,
      // computed once so every note's note_snapshots row can look itself up.
      const maxCoveredSeqByNote = new Map<string, number>();
      for (const version of input.data.noteVersions) {
        const current = maxCoveredSeqByNote.get(version.noteId) ?? 0;
        if (version.coveredSeq > current) maxCoveredSeqByNote.set(version.noteId, version.coveredSeq);
      }

      for (const note of input.data.notes) {
        this.insertNote.run(
          note.id, this.profileId, note.title, note.folderId,
          note.pinned ? 1 : 0, note.cardDeckId, note.createdAt, note.updatedAt,
        );
        written += 1;

        if (note.snapshot !== null) {
          const derived = input.derived.get(note.id);
          if (derived === undefined) {
            throw new RestoreValidationError(
              `Note "${note.id}" has a non-null snapshot but no matching entry in "derived".`,
            );
          }
          const coveredSeq = maxCoveredSeqByNote.get(note.id) ?? 0;
          this.insertNoteSnapshot.run(
            note.id, Buffer.from(note.snapshot), derived.plaintext, coveredSeq, now,
          );
          written += 1;
        }
      }

      for (const card of input.data.cards) {
        // `kind` is optional in the interchange with `"basic"` as its default
        // (ADR-042), and the parser has already enforced the pair rule the
        // `cards` CHECK constraints also state — so the three columns ride the
        // existing insert with nothing but a `??` between them and the row.
        this.insertCard.run(
          card.id, this.profileId, card.deckId, card.front, card.back,
          card.sourceNoteId, card.sourceBlockKey,
          card.kind ?? "basic", card.clozeText ?? null, card.clozeOrdinal ?? null,
          card.problemSteps ?? null,
          card.due, card.stability, card.difficulty,
          card.elapsedDays, card.scheduledDays, card.learningSteps, card.reps, card.lapses,
          card.state, card.lastReview, card.createdAt, card.updatedAt,
        );
        written += 1;
      }

      for (const document of input.data.documents) {
        this.insertDocument.run(
          document.id, this.profileId, document.docType, document.label, document.expiryDate,
          JSON.stringify(document.reminderOffsets), document.notes, document.createdAt, document.updatedAt,
        );
        written += 1;
      }

      for (const renewal of input.data.renewals) {
        this.insertRenewal.run(renewal.id, renewal.documentId, renewal.previousExpiry, renewal.renewedAt);
        written += 1;
      }

      // A task whose `listId` is null came from an archive written before
      // ADR-029 (`ArchiveEra.writesTaskLists`), so there is no list to
      // reproduce: it goes to the target profile's Inbox — created here if the
      // archive carried no lists at all, which is precisely the case an
      // era-defaulted archive always is — and gets a gap-spaced position in the
      // archive's own row order, so the list reads as it did before lists
      // existed. Resolved once, lazily, so an archive that names its lists never
      // mints an Inbox it does not need.
      let fallbackListId: string | null = null;
      let fallbackPosition = 0;
      for (const task of input.data.tasks) {
        let listId = task.listId;
        let position = task.position;
        if (listId === null) {
          if (fallbackListId === null) {
            // Always found, never minted: the unconditional `ensureInbox` after
            // the list loop above guarantees one exists (and counted it there).
            fallbackListId = this.taskLists.ensureInbox(now).id;
          }
          listId = fallbackListId;
          fallbackPosition += TASK_ORDER_GAP;
          position = fallbackPosition;
        }
        this.insertTask.run(
          task.id, this.profileId, task.parentId, task.title, task.description,
          task.status, task.priority, task.dueDate, task.startDate,
          task.createdAt, task.updatedAt, task.completedAt, recurrenceText(task.recurrence),
          offsetsText(task.reminderOffsets), listId, task.sectionId, position,
        );
        written += 1;
      }

      // Written straight after the tasks they hang off, and never re-keyed: a
      // link is nothing but the pair of ids at its ends, and both were preserved.
      for (const link of input.data.taskTagLinks) {
        this.insertTaskTagLink.run(link.taskId, link.tagId);
        written += 1;
      }

      // Likewise the index rows for the files hanging off those tasks. Only the
      // rows: the BYTES are written to the blob store before this transaction
      // ever opens (`main/restore.ts`), for the reason that order exists — a
      // failure here leaves unreferenced blob files, while the reverse would
      // leave rows pointing at files that were never written.
      for (const attachment of input.data.taskAttachments) {
        this.insertTaskAttachment.run(
          attachment.id, attachment.taskId, attachment.fileName, attachment.mime,
          attachment.sizeBytes, attachment.sha256, attachment.createdAt,
        );
        written += 1;
      }

      // The payload is re-serialized rather than carried as text, because the
      // archive carries it as a nested JSON OBJECT (`ExportTaskTemplatePayload`)
      // while the column holds JSON text. `parseImportArchive` already returned
      // it in canonical form — the same field order and the same values
      // `TaskTemplateStore` writes — so this produces exactly the text that
      // store would have written, which is what lets it treat anything else it
      // later reads as corruption.
      for (const template of input.data.taskTemplates) {
        this.insertTaskTemplate.run(
          template.id, this.profileId, template.name, JSON.stringify(template.payload),
          template.createdAt, template.updatedAt,
        );
        written += 1;
      }

      // Beside the tag links, for the same reason and on the same terms: an edge
      // is nothing but the ordered pair at its ends, both of which were
      // preserved. The acyclicity the store guards on the live path was already
      // proved by `parseImportArchive` for this whole graph, so there is nothing
      // left to re-check here (R-parse-is-the-boundary).
      for (const edge of input.data.taskDependencies) {
        this.insertTaskDependency.run(edge.blockerId, edge.blockedId);
        written += 1;
      }

      for (const event of input.data.events) {
        this.insertEvent.run(
          event.id, this.profileId, event.title, event.description, event.startAt, event.endAt,
          event.allDay ? 1 : 0, event.location, event.category, event.createdAt, event.updatedAt,
          recurrenceText(event.recurrence), exdatesText(event.recurrenceExdates),
          offsetsText(event.reminderOffsets),
        );
        written += 1;
      }

      // Re-serialized rather than carried as text, exactly as the task templates
      // above are and for the same reason: the archive carries the payload as a
      // nested JSON OBJECT (`ExportEventTemplatePayload`) while the column holds
      // JSON text, and `parseImportArchive` already returned it in the canonical
      // form `EventTemplateStore` writes.
      for (const template of input.data.eventTemplates) {
        this.insertEventTemplate.run(
          template.id, this.profileId, template.name, JSON.stringify(template.payload),
          template.createdAt, template.updatedAt,
        );
        written += 1;
      }

      for (const person of input.data.people) {
        this.insertPerson.run(
          person.id, this.profileId, person.name, person.kind, person.month, person.day,
          person.year, person.note, person.createdAt, person.updatedAt,
        );
        written += 1;
      }

      // ADR-054, retargeted onto THIS profile like every other row here. Zero
      // rows is the shape every pre-1.20.0 archive has, and the absence of a
      // row IS "no term set" (`CalendarSettingsStore.get`) — while a both-null
      // row says the same thing out loud, which is what the gatherer always
      // writes.
      for (const calendar of input.data.calendarSettings) {
        this.insertCalendarSettings.run(
          this.profileId,
          calendar.semesterStart,
          calendar.semesterEnd,
        );
        written += 1;
      }

      for (const notification of input.data.notifications) {
        this.insertNotification.run(
          notification.id, this.profileId, notification.source, notification.entityId,
          notification.occurrenceKey, notification.title, notification.body, notification.status,
          notification.snoozedUntil, notification.deliveredAt, notification.createdAt, notification.updatedAt,
        );
        written += 1;
      }

      // ADR-063: the ranked curriculum, reproduced verbatim — rank, confidence,
      // deck link and the accepted cuts alike. Before the plans whose blocks
      // name these rows, mirroring the archive's own file order.
      for (const topic of input.data.examTopics) {
        this.insertExamTopic.run(
          topic.id, this.profileId, topic.examId, topic.name, topic.sortOrder,
          topic.confidence, topic.deckId, topic.cut ? 1 : 0, topic.createdAt, topic.updatedAt,
        );
        written += 1;
      }

      // `weekdayMinutes` is optional in the interchange (ADR-063): an archive
      // from before 1.25.0 carries none, and null IS "every day =
      // dailyMinutes" — the column's own meaning, written as NULL.
      for (const plan of input.data.plans) {
        this.insertPlan.run(
          plan.id, this.profileId, plan.examId, plan.dailyMinutes, plan.startDate,
          plan.examWeekBoost ? 1 : 0,
          plan.weekdayMinutes === undefined || plan.weekdayMinutes === null
            ? null
            : JSON.stringify(plan.weekdayMinutes),
          plan.createdAt, plan.updatedAt,
        );
        written += 1;
      }

      // The three ADR-063 members ride the existing insert with nothing but a
      // `??` between them and the row, exactly as a card's `kind` does: absent
      // means what every pre-1.25.0 block was.
      for (const block of input.data.blocks) {
        this.insertBlock.run(
          block.id, block.planId, this.profileId, block.blockDate, block.minutes,
          block.status, block.topicId ?? null, block.kind ?? "coverage",
          (block.pinned ?? false) ? 1 : 0,
          block.createdAt, block.updatedAt,
        );
        written += 1;
      }

      for (const session of input.data.focusSessions) {
        this.insertFocusSession.run(
          session.id, this.profileId, session.subjectId, session.startedAt, session.endedAt,
          session.createdAt, session.updatedAt,
        );
        written += 1;
      }

      // STUDY-007, retargeted onto THIS profile like every other row here. Zero
      // rows is the shape every pre-1.13.0 archive has, and the absence of a row
      // IS the default (`StudySettingsStore.get`) — so nothing is written to say
      // "retention 0.9, 20 new a day, no review cap", because that is what no
      // row already means.
      for (const settings of input.data.studySettings) {
        this.insertStudySettings.run(
          this.profileId,
          settings.targetRetention,
          settings.newPerDay,
          settings.maxReviewsPerDay,
          now,
          now,
        );
        written += 1;
      }

      for (const log of input.data.reviewLog) {
        this.insertReviewLog.run(
          log.id, this.profileId, log.cardId, log.rating, log.state, log.due,
          log.stability, log.difficulty, log.elapsedDays, log.lastElapsedDays,
          log.scheduledDays, log.learningSteps, log.review, log.createdAt,
        );
        written += 1;
      }

      for (const attachment of input.data.noteAttachments) {
        this.insertNoteAttachment.run(
          attachment.id, attachment.noteId, attachment.fileName, attachment.mime,
          attachment.sizeBytes, attachment.sha256, attachment.createdAt,
        );
        written += 1;
      }

      for (const link of input.data.noteTagLinks) {
        this.insertNoteTagLink.run(link.noteId, link.tagId);
        written += 1;
      }

      for (const version of input.data.noteVersions) {
        this.insertNoteVersion.run(
          version.noteId, version.coveredSeq, Buffer.from(version.snapshot),
          version.title, version.createdAt,
        );
        written += 1;
      }

      for (const template of input.data.noteTemplates) {
        this.insertNoteTemplate.run(
          template.id, this.profileId, template.name, template.content,
          template.createdAt, template.updatedAt,
        );
        written += 1;
      }

      // R10: note_links come from the derived wiki-link targets, not from
      // ProfileData (the archive carries no note-link records at all — the
      // link lives inside the note's own Yjs content). A target absent from
      // this archive's own notes is a normal unresolved wiki-link, silently
      // skipped rather than treated as a corrupt reference.
      const noteIds = new Set(input.data.notes.map((note) => note.id));
      for (const note of input.data.notes) {
        const derived = input.derived.get(note.id);
        if (derived === undefined) continue;
        for (const target of new Set(derived.linkTargets)) {
          if (!noteIds.has(target)) continue;
          this.insertNoteLink.run(note.id, target);
          written += 1;
        }
      }

      for (const [moduleId, enabled] of Object.entries(input.settings.flags)) {
        this.insertFlag.run(this.profileId, moduleId, enabled ? 1 : 0, now);
        written += 1;
      }

      this.insertNtfSettings.run(
        this.profileId,
        input.settings.notifications.quietFrom,
        input.settings.notifications.quietTo,
        input.settings.notifications.morningHour,
        input.settings.notifications.snoozeDefault,
        now,
        now,
      );
      written += 1;

      // Only the toggleable sources have a settings row to write at all — an
      // always-on source (`"security"`, NTF-007) has no preference, and the
      // table's own CHECK refuses one.
      const enabledSources = new Set(input.settings.notifications.enabledSources);
      for (const source of TOGGLEABLE_NOTIFICATION_SOURCES) {
        if (enabledSources.has(source)) continue;
        this.insertNtfSourceSetting.run(this.profileId, source);
        written += 1;
      }

      // ADR-041. Retargeted onto THIS profile, like every other row here: the
      // archive's own `profileId` names the profile it was exported from, which
      // is not necessarily the one being written. Zero rows is the shape every
      // pre-1.9.0 archive has, and the absence of a row IS the default
      // (`DashboardSettingsStore.get`) — so nothing is written to say "no
      // background, dim 40", because that is what no row already means.
      // `activeSetId` rides along (ADR-055): the parser reference-checked it
      // against the archive's own sets, and null — every pre-1.21.0 archive —
      // is „Početna“, which is not a row and needs nothing to point at.
      for (const dashboard of input.data.dashboardSettings) {
        this.insertDashboardSettings.run(
          this.profileId,
          dashboard.backgroundHash,
          dashboard.backgroundMime,
          dashboard.backgroundSizeBytes,
          dashboard.backgroundDim,
          dashboard.activeSetId ?? null,
          now,
          now,
        );
        written += 1;
      }

      // The named boards (ADR-055), replaced WHOLESALE with everything else
      // here: the wipe above took the target's own sets (and their widget rows)
      // out, and what the archive carries is what stands afterwards. Timestamps
      // from the ARCHIVE, the widget rule below: a board is a row the user made
      // at a moment.
      for (const set of input.data.dashboardSets) {
        this.insertDashboardSet.run(
          set.id,
          this.profileId,
          set.name,
          set.position,
          set.createdAt,
          set.updatedAt,
        );
        written += 1;
      }

      // ADR-045, retargeted onto THIS profile exactly as the background above
      // is. `createdAt`/`updatedAt` come from the ARCHIVE rather than from
      // `now`, unlike the settings row: a placement is a row the user made at a
      // moment, and a restore reproduces rows (R-reproduce-byte-for-byte), while
      // the settings row is a resolved singleton with no history to preserve.
      // `setId` null — the default board — is every pre-1.21.0 archive's shape.
      for (const widget of input.data.dashboardWidgets) {
        this.insertDashboardWidget.run(
          this.profileId,
          widget.instanceId,
          widget.widgetId,
          widget.size,
          widget.setId ?? null,
          widget.position,
          widget.config,
          widget.createdAt,
          widget.updatedAt,
        );
        written += 1;
      }

      // The private tables' CONDITIONAL replace (ADR-057 §6): wiped and
      // refilled ONLY when the caller supplied sealed rows — a restore whose
      // archive carried private records into an unlocked section, or an undo
      // putting the pre-restore rows back. Otherwise UNTOUCHED, deliberately:
      // sealed rows this write knows nothing about must never be collateral.
      // Bytes verbatim — this store holds no key and needs none (SEC-ZK-05);
      // whoever produced these rows already sealed them under the right DEK.
      const privateSealed = input.privateSealed ?? null;
      if (privateSealed !== null) {
        this.wipePrivateNoteVersions.run(this.profileId);
        this.wipePrivateNotes.run(this.profileId);
        for (const note of privateSealed.notes) {
          this.insertPrivateNote.run(
            note.id, this.profileId, Buffer.from(note.sealed), note.createdAt, note.updatedAt,
          );
          written += 1;
        }
        for (const version of privateSealed.versions) {
          this.insertPrivateNoteVersion.run(
            version.noteId, version.seq, Buffer.from(version.sealed), version.createdAt,
          );
          written += 1;
        }
      }

      return written;
    })();
  }
}
