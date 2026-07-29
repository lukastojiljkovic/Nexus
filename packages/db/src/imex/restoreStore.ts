import type Database from "better-sqlite3-multiple-ciphers";
import { serializeRecurrenceRule } from "@nexus/core";
import type { ExportSettings, ProfileData, RecurrenceRule } from "@nexus/core";
import { RestoreValidationError } from "../errors.js";
import { NOTIFICATION_SOURCES } from "../notify/notificationStore.js";

type DatabaseHandle = Database.Database;

/** What a restore needs about one note beyond its raw Yjs bytes. */
export interface RestoredNoteDerived {
  /** The note's plaintext body, from `mergeNoteState(snapshot, []).plaintext` (`@nexus/core`). Feeds `note_snapshots.plaintext`, which is what migration 017's search view projects as a note's searchable body. */
  plaintext: string;
  /** The ids this note's document wiki-links to, from `extractNoteLinkTargets(snapshot)` (`@nexus/core`). Rebuilds `note_links`. */
  linkTargets: readonly string[];
}

export interface RestoreProfileInput {
  /** The profile's name from the archive's manifest — the restore renames the target profile to it. */
  profileName: string;
  settings: ExportSettings;
  data: ProfileData;
  /** Keyed by note id. REQUIRED for every note whose `snapshot` is non-null. */
  derived: ReadonlyMap<string, RestoredNoteDerived>;
}

/**
 * Every table a restore empties for the target profile before writing
 * anything (R5): child tables first, so the wipe never depends on `ON DELETE
 * CASCADE` to reach a row (a future migration's table would silently survive
 * a restore if it relied on cascade alone — see `restoreStore.test.ts`'s
 * guard test, which reads `sqlite_master` and fails until a new table is
 * either added here or explicitly allow-listed as exempt). Six tables carry no
 * `profile_id` of their own and are scoped through their parent instead
 * (`document_renewals` through `tracked_documents`; the five `note_*` child
 * tables through `notes`) — see `wipeSqlFor` below.
 */
export const RESTORE_WIPE_TABLES = [
  "document_renewals",
  "review_log",
  "cards",
  "decks",
  "exams",
  "study_blocks",
  "study_plans",
  "focus_sessions",
  "tracked_documents",
  "subjects",
  "events",
  "people",
  "notifications",
  "tasks",
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
] as const;

type WipeTable = (typeof RESTORE_WIPE_TABLES)[number];

/** The tables above that carry no `profile_id` column and must be scoped through their parent instead of a direct `WHERE profile_id = ?`. */
const SCOPED_THROUGH_PARENT: Partial<Record<WipeTable, string>> = {
  document_renewals: `DELETE FROM document_renewals WHERE document_id IN (SELECT id FROM tracked_documents WHERE profile_id = ?)`,
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
 * A parsed rule as the column stores it. `parseImportArchive` already returned
 * the rule in canonical form, so this re-serialization is the same text the
 * store itself would have written — which is what lets `TaskStore`/`EventStore`
 * treat any non-canonical value they later read as corruption.
 */
function recurrenceText(rule: RecurrenceRule | null): string | null {
  return rule === null ? null : serializeRecurrenceRule(rule);
}

/**
 * An event's recurrence exceptions as the column stores them: ascending, which
 * `EventStore` documents as the column's canonical form and its own writes
 * always produce. The parser accepts an archive that lists them in any order
 * (order carries no meaning), so sorting here is what keeps a restored master
 * indistinguishable from one the store wrote itself. Day keys are fixed-width,
 * so a plain lexicographic sort IS chronological.
 */
function exdatesText(exdates: readonly string[]): string {
  return JSON.stringify([...exdates].sort());
}

/**
 * An event's reminder ladder as the column stores it: ascending, for exactly
 * the reason `exdatesText` sorts — the parser accepts any order (order carries
 * no meaning in an archive), and `EventStore` reads back only what it would
 * have written itself. Minutes are numbers, so this needs a numeric comparator
 * where day keys got the default lexicographic one.
 */
function offsetsText(offsets: readonly number[]): string {
  return JSON.stringify([...offsets].sort((a, b) => a - b));
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
  private readonly updateProfileName: Database.Statement;

  private readonly insertNoteFolder: Database.Statement;
  private readonly insertNoteTag: Database.Statement;
  private readonly insertSubject: Database.Statement;
  private readonly insertExam: Database.Statement;
  private readonly insertDeck: Database.Statement;
  private readonly insertNote: Database.Statement;
  private readonly insertNoteSnapshot: Database.Statement;
  private readonly insertCard: Database.Statement;
  private readonly insertDocument: Database.Statement;
  private readonly insertRenewal: Database.Statement;
  private readonly insertTask: Database.Statement;
  private readonly insertEvent: Database.Statement;
  private readonly insertPerson: Database.Statement;
  private readonly insertNotification: Database.Statement;
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

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.wipeStatements = RESTORE_WIPE_TABLES.map((table) => db.prepare(wipeSqlFor(table)));
    this.updateProfileName = db.prepare(`UPDATE profiles SET name = ? WHERE id = ?`);

    this.insertNoteFolder = db.prepare(
      `INSERT INTO note_folders (id, profile_id, parent_id, name, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertNoteTag = db.prepare(
      `INSERT INTO note_tags (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)`,
    );
    this.insertSubject = db.prepare(
      `INSERT INTO subjects
         (id, profile_id, name, color, semester, archived, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, last_review, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
          due_date, start_date, created_at, updated_at, completed_at, recurrence, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertEvent = db.prepare(
      `INSERT INTO events
         (id, profile_id, title, description, start_at, end_at, all_day,
          location, category, created_at, updated_at, recurrence, recurrence_exdates,
          reminder_offsets, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
    this.insertPlan = db.prepare(
      `INSERT INTO study_plans
         (id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertBlock = db.prepare(
      `INSERT INTO study_blocks
         (id, plan_id, profile_id, block_date, minutes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
    this.insertNtfSettings = db.prepare(
      `INSERT INTO ntf_settings (profile_id, quiet_from, quiet_to, morning_hour, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.insertNtfSourceSetting = db.prepare(
      `INSERT INTO ntf_source_settings (profile_id, source, enabled) VALUES (?, ?, 0)`,
    );
  }

  /**
   * Replaces this profile's entire stored content with `input.data`/`input.settings`
   * (ADR-023), renames the profile to `input.profileName`, and returns the number
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
      this.updateProfileName.run(input.profileName, this.profileId);

      let written = 0;

      for (const folder of input.data.noteFolders) {
        this.insertNoteFolder.run(
          folder.id, this.profileId, folder.parentId, folder.name, folder.color,
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
        this.insertCard.run(
          card.id, this.profileId, card.deckId, card.front, card.back,
          card.sourceNoteId, card.sourceBlockKey, card.due, card.stability, card.difficulty,
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

      for (const task of input.data.tasks) {
        this.insertTask.run(
          task.id, this.profileId, task.parentId, task.title, task.description,
          task.status, task.priority, task.dueDate, task.startDate,
          task.createdAt, task.updatedAt, task.completedAt, recurrenceText(task.recurrence),
        );
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

      for (const person of input.data.people) {
        this.insertPerson.run(
          person.id, this.profileId, person.name, person.kind, person.month, person.day,
          person.year, person.note, person.createdAt, person.updatedAt,
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

      for (const plan of input.data.plans) {
        this.insertPlan.run(
          plan.id, this.profileId, plan.examId, plan.dailyMinutes, plan.startDate,
          plan.examWeekBoost ? 1 : 0, plan.createdAt, plan.updatedAt,
        );
        written += 1;
      }

      for (const block of input.data.blocks) {
        this.insertBlock.run(
          block.id, block.planId, this.profileId, block.blockDate, block.minutes,
          block.status, block.createdAt, block.updatedAt,
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
        now,
        now,
      );
      written += 1;

      const enabledSources = new Set(input.settings.notifications.enabledSources);
      for (const source of NOTIFICATION_SOURCES) {
        if (enabledSources.has(source)) continue;
        this.insertNtfSourceSetting.run(this.profileId, source);
        written += 1;
      }

      return written;
    })();
  }
}
