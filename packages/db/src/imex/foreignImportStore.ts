import type Database from "better-sqlite3-multiple-ciphers";
import type { ProfileData } from "@nexus/core";
import { RestoreValidationError } from "../errors.js";
import { exdatesText, offsetsText, recurrenceText, viewConfigText } from "./columnText.js";
import type { RestoredNoteDerived } from "./restoreStore.js";

type DatabaseHandle = Database.Database;

/**
 * Writes an already-planned FOREIGN import into one profile (ADR-043 §4): the
 * additive half of the pair whose destructive half is `RestoreStore`.
 *
 * The contract is deliberately the narrowest one that can express a merge:
 * **one transaction of plain `INSERT`s, and nothing else**. No `DELETE`, no
 * `UPDATE` of any pre-existing row, no `INSERT OR REPLACE`. That is not an
 * optimisation — it is the safety property. `planForeignImport` (`@nexus/core`)
 * has already resolved every identity question a merge raises (which tags are
 * the same tag, which Inbox the source's tasks land in, which templates lose to
 * a name the target already uses), and it expresses each answer by simply not
 * putting the absorbed row in the plan. So a store that can only insert
 * literally cannot damage what the target already had: the worst a bug here can
 * do is fail, and failing changes nothing.
 *
 * The plan arrives with its ids already minted and its `profileId` already
 * stamped by the planner. This store still re-binds ITS OWN `profileId` over
 * every row's, exactly as `RestoreStore` does (R4) — a store scoped to one
 * profile writes that profile's rows and no other, whatever the value travelling
 * in the data happens to say.
 *
 * Foreign keys stay ENFORCED throughout (no `defer_foreign_keys`, unlike
 * `RestoreStore`): the insert order below is a real topological order over the
 * schema's references — lists before sections before tasks, subjects before
 * decks before cards, notes before everything that hangs off them — and the
 * three self-referencing parent chains (`task_lists`, `tasks`, `note_folders`)
 * are ordered row-by-row by `parentsFirst` rather than deferred wholesale. The
 * difference is worth the twenty lines: a genuinely dangling reference aborts on
 * the offending row instead of at `COMMIT`, so the failure names what was wrong.
 *
 * `parseImportArchive` (in `"import"` mode) is the validation boundary, exactly
 * as it is for a restore: every field shape, enum, ISO-8601 shape and foreign-key
 * reference in the plan's data was checked before the planner ever saw it, and
 * nothing here re-validates a field. The one reference this class still resolves
 * is `note_links`, for the same reason `RestoreStore` does: a wiki-link target
 * lives inside a note's Yjs bytes, where no cross-reference pass can see it.
 */
export class ForeignImportStore {
  private readonly insertTaskList: Database.Statement;
  private readonly insertTaskSection: Database.Statement;
  private readonly insertTaskTag: Database.Statement;
  private readonly insertTask: Database.Statement;
  private readonly insertTaskTagLink: Database.Statement;
  private readonly insertTaskAttachment: Database.Statement;
  private readonly insertTaskDependency: Database.Statement;
  private readonly insertTaskTemplate: Database.Statement;
  private readonly insertEvent: Database.Statement;
  private readonly insertEventTemplate: Database.Statement;
  private readonly insertPerson: Database.Statement;
  private readonly insertDocument: Database.Statement;
  private readonly insertRenewal: Database.Statement;
  private readonly insertSubject: Database.Statement;
  private readonly insertSubjectAttachment: Database.Statement;
  private readonly insertSubjectNoteLink: Database.Statement;
  private readonly insertExam: Database.Statement;
  private readonly insertDeck: Database.Statement;
  private readonly insertPlan: Database.Statement;
  private readonly insertBlock: Database.Statement;
  private readonly insertFocusSession: Database.Statement;
  private readonly insertNoteTemplate: Database.Statement;
  private readonly insertNoteFolder: Database.Statement;
  private readonly insertNoteTag: Database.Statement;
  private readonly insertNote: Database.Statement;
  private readonly insertNoteSnapshot: Database.Statement;
  private readonly insertNoteAttachment: Database.Statement;
  private readonly insertNoteTagLink: Database.Statement;
  private readonly insertNoteVersion: Database.Statement;
  private readonly insertNoteLink: Database.Statement;
  private readonly insertCard: Database.Statement;
  private readonly insertReviewLog: Database.Statement;
  private readonly insertDashboardWidget: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
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
    this.insertTask = db.prepare(
      `INSERT INTO tasks
         (id, profile_id, parent_id, title, description, status, priority,
          due_date, start_date, created_at, updated_at, completed_at, recurrence,
          reminder_offsets, list_id, section_id, position, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
    this.insertNoteTemplate = db.prepare(
      `INSERT INTO note_templates (id, profile_id, name, content, created_at, updated_at)
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
    this.insertNote = db.prepare(
      `INSERT INTO notes
         (id, profile_id, title, folder_id, pinned, card_deck_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertNoteSnapshot = db.prepare(
      `INSERT INTO note_snapshots (note_id, snapshot, plaintext, covered_seq, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
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
    this.insertNoteLink = db.prepare(
      `INSERT INTO note_links (source_note_id, target_note_id) VALUES (?, ?)`,
    );
    // The cloze columns (ADR-042 / migration 031) and `problem_steps` (ADR-046
    // / migration 033) ride the existing insert, and the four `cards` CHECKs —
    // `kind IN ('basic','cloze')`, the pair rule tying
    // `cloze_text`/`cloze_ordinal` to it, and "steps only on a non-empty basic
    // card" — are satisfied by the plan's own rows: the parser enforced exactly
    // those rules before the planner ran, and the planner copies the four fields
    // through untouched. They are spelled out here anyway, because an INSERT
    // that named no columns would silently depend on the table's physical
    // column order.
    this.insertCard = db.prepare(
      `INSERT INTO cards
         (id, profile_id, deck_id, front, back, source_note_id, source_block_key,
          kind, cloze_text, cloze_ordinal, problem_steps,
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, last_review, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertReviewLog = db.prepare(
      `INSERT INTO review_log
         (id, profile_id, card_id, rating, state, due, stability, difficulty,
          elapsed_days, last_elapsed_days, scheduled_days, learning_steps,
          review, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertDashboardWidget = db.prepare(
      `INSERT INTO dashboard_widgets
         (profile_id, instance_id, widget_id, size, position, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  /**
   * Inserts everything `planned` carries into this profile, in ONE transaction,
   * and returns the number of rows written. Nothing that was in the profile
   * before is read, moved or removed; a failure anywhere rolls the whole thing
   * back, so the profile is either exactly as it was or exactly as it was plus
   * the plan.
   *
   * `derived` is the note-derivation map (`deriveRestoredNotes`), consumed on
   * precisely the terms `RestoreStore.replaceProfileData` consumes it: an entry
   * is REQUIRED for every note whose `snapshot` is non-null (it supplies
   * `note_snapshots.plaintext`, which is the body migration 017's search view
   * projects), and its `linkTargets` — de-duplicated, and filtered to notes this
   * plan itself carries — are what `note_links` is rebuilt from. Keyed by the
   * PLANNED note ids, since those are the ids the rows are written under.
   *
   * Two `ProfileData` members are deliberately not inserted at all:
   * `notifications` (a delivery record — "we told the user this, then" — which
   * is not portable) and `dashboardSettings` (the TARGET user's own decoration).
   * The planner always plans both empty, so the loops below would be no-ops
   * anyway; this store simply does not have a statement for either, and asserts
   * nothing about them. Which rows belong in a plan is the planner's policy,
   * proved by the planner's own tests — a throw here would be this store holding
   * an opinion about a decision it does not make. (`studySettings` and
   * `calendarSettings` never arrive: the planner drops both by design — the
   * target's scheduling preferences and semester dates are their own — so
   * this store has no statement for either.)
   */
  insertPlanned(
    planned: ProfileData,
    derived: ReadonlyMap<string, RestoredNoteDerived>,
    now: string,
  ): number {
    return this.db.transaction((): number => {
      let written = 0;

      for (const list of parentsFirst(planned.taskLists)) {
        this.insertTaskList.run(
          list.id, this.profileId, list.parentId, list.name, list.isInbox ? 1 : 0,
          list.defaultView, viewConfigText(list.viewConfig),
          list.position, list.createdAt, list.updatedAt,
        );
        written += 1;
      }

      for (const section of planned.taskSections) {
        this.insertTaskSection.run(
          section.id, section.listId, section.name, section.position,
          section.createdAt, section.updatedAt,
        );
        written += 1;
      }

      for (const tag of planned.taskTags) {
        this.insertTaskTag.run(tag.id, this.profileId, tag.name, tag.createdAt);
        written += 1;
      }

      for (const task of parentsFirst(planned.tasks)) {
        // Unlike a restore — which mints an Inbox for an archive written before
        // ADR-029 named any list — an import never invents a container: the
        // planner resolved every listless task onto the TARGET's own Inbox
        // (`mappedList`) while it still had the target in front of it. A null
        // here therefore means the caller bypassed the planner, and writing the
        // row would leave a task no list can show.
        if (task.listId === null) {
          throw new RestoreValidationError(
            `Task "${task.id}" names no list. A foreign import plan resolves every task onto a list before it is applied.`,
          );
        }
        this.insertTask.run(
          task.id, this.profileId, task.parentId, task.title, task.description,
          task.status, task.priority, task.dueDate, task.startDate,
          task.createdAt, task.updatedAt, task.completedAt, recurrenceText(task.recurrence),
          offsetsText(task.reminderOffsets), task.listId, task.sectionId, task.position,
        );
        written += 1;
      }

      for (const link of planned.taskTagLinks) {
        this.insertTaskTagLink.run(link.taskId, link.tagId);
        written += 1;
      }

      // The index rows only: the BYTES were written to the blob store before
      // this transaction opened (`main/restore.ts`'s `applyImport`), for the
      // reason that order exists — a failure here leaves unreferenced blob
      // files, while the reverse would leave rows pointing at files that were
      // never written. Content addressing is what makes writing them first free:
      // a blob the target already had is recognised by its own name.
      for (const attachment of planned.taskAttachments) {
        this.insertTaskAttachment.run(
          attachment.id, attachment.taskId, attachment.fileName, attachment.mime,
          attachment.sizeBytes, attachment.sha256, attachment.createdAt,
        );
        written += 1;
      }

      for (const edge of planned.taskDependencies) {
        this.insertTaskDependency.run(edge.blockerId, edge.blockedId);
        written += 1;
      }

      // Re-serialized rather than carried as text, exactly as in a restore: the
      // archive holds the payload as a nested JSON OBJECT while the column holds
      // JSON text, and the parser already returned it in the canonical form
      // `TaskTemplateStore` itself writes. A template whose name the target
      // already uses is not in the plan at all (ADR-043 §2), so migration 027's
      // `(profile_id, name)` UNIQUE is never in play here.
      for (const template of planned.taskTemplates) {
        this.insertTaskTemplate.run(
          template.id, this.profileId, template.name, JSON.stringify(template.payload),
          template.createdAt, template.updatedAt,
        );
        written += 1;
      }

      for (const event of planned.events) {
        this.insertEvent.run(
          event.id, this.profileId, event.title, event.description, event.startAt, event.endAt,
          event.allDay ? 1 : 0, event.location, event.category, event.createdAt, event.updatedAt,
          recurrenceText(event.recurrence), exdatesText(event.recurrenceExdates),
          offsetsText(event.reminderOffsets),
        );
        written += 1;
      }

      // The task templates' treatment, one module over (CAL-009): re-serialized
      // from the archive's nested object, and a template whose name the target
      // already uses is not in the plan at all (ADR-043 §2), so migration 036's
      // `(profile_id, name)` UNIQUE is never in play here.
      for (const template of planned.eventTemplates) {
        this.insertEventTemplate.run(
          template.id, this.profileId, template.name, JSON.stringify(template.payload),
          template.createdAt, template.updatedAt,
        );
        written += 1;
      }

      for (const person of planned.people) {
        this.insertPerson.run(
          person.id, this.profileId, person.name, person.kind, person.month, person.day,
          person.year, person.note, person.createdAt, person.updatedAt,
        );
        written += 1;
      }

      for (const document of planned.documents) {
        this.insertDocument.run(
          document.id, this.profileId, document.docType, document.label, document.expiryDate,
          JSON.stringify(document.reminderOffsets), document.notes,
          document.createdAt, document.updatedAt,
        );
        written += 1;
      }

      for (const renewal of planned.renewals) {
        this.insertRenewal.run(
          renewal.id, renewal.documentId, renewal.previousExpiry, renewal.renewedAt,
        );
        written += 1;
      }

      for (const subject of planned.subjects) {
        this.insertSubject.run(
          subject.id, this.profileId, subject.name, subject.color, subject.semester,
          subject.archived ? 1 : 0, subject.createdAt, subject.updatedAt,
        );
        written += 1;
      }

      // The index rows for a subject's materials, on the terms the task
      // attachments above state: rows here, bytes already in the blob store.
      for (const material of planned.subjectAttachments) {
        this.insertSubjectAttachment.run(
          material.id, material.subjectId, material.fileName, material.mime,
          material.sizeBytes, material.sha256, material.createdAt,
        );
        written += 1;
      }

      for (const exam of planned.exams) {
        this.insertExam.run(
          exam.id, this.profileId, exam.subjectId, exam.examType, exam.examDate,
          exam.scope, exam.createdAt, exam.updatedAt,
        );
        written += 1;
      }

      for (const deck of planned.decks) {
        this.insertDeck.run(
          deck.id, this.profileId, deck.subjectId, deck.name, deck.createdAt, deck.updatedAt,
        );
        written += 1;
      }

      for (const plan of planned.plans) {
        this.insertPlan.run(
          plan.id, this.profileId, plan.examId, plan.dailyMinutes, plan.startDate,
          plan.examWeekBoost ? 1 : 0, plan.createdAt, plan.updatedAt,
        );
        written += 1;
      }

      for (const block of planned.blocks) {
        this.insertBlock.run(
          block.id, block.planId, this.profileId, block.blockDate, block.minutes,
          block.status, block.createdAt, block.updatedAt,
        );
        written += 1;
      }

      for (const session of planned.focusSessions) {
        this.insertFocusSession.run(
          session.id, this.profileId, session.subjectId, session.startedAt, session.endedAt,
          session.createdAt, session.updatedAt,
        );
        written += 1;
      }

      // Templates before folders: `note_folders.default_template_id` names one,
      // and although the column carries no `REFERENCES` clause (it may name a
      // built-in, which is a code constant in no table at all — ADR-036), the
      // order costs nothing and keeps this list readable as one dependency chain.
      for (const template of planned.noteTemplates) {
        this.insertNoteTemplate.run(
          template.id, this.profileId, template.name, template.content,
          template.createdAt, template.updatedAt,
        );
        written += 1;
      }

      // Migration 028's partial unique index allows exactly one quick-capture
      // folder per profile. When the target already claims it the planner
      // cleared every imported folder's own claim, so this insert cannot collide
      // — and when the target does NOT claim it, at most one source folder did.
      //
      // The imported folder keeps its own `defaultView` (NOTE-002): unlike the
      // capture mark, it is a property of that folder alone and collides with
      // nothing the target already decided. Absent — an archive older than
      // 1.17.0 — it opens as a list, which is what it opened as there.
      for (const folder of parentsFirst(planned.noteFolders)) {
        this.insertNoteFolder.run(
          folder.id, this.profileId, folder.parentId, folder.name, folder.color,
          folder.defaultTemplateId, folder.isCaptureDefault ? 1 : 0,
          folder.defaultView ?? "list",
          folder.createdAt, folder.updatedAt,
        );
        written += 1;
      }

      for (const tag of planned.noteTags) {
        this.insertNoteTag.run(tag.id, this.profileId, tag.name, tag.createdAt);
        written += 1;
      }

      // `note_snapshots.covered_seq` is the highest `coveredSeq` among the
      // note's own imported versions, computed once here so each note's snapshot
      // row can look itself up (the versions themselves are written further
      // down, after every note exists).
      const maxCoveredSeqByNote = new Map<string, number>();
      for (const version of planned.noteVersions) {
        const current = maxCoveredSeqByNote.get(version.noteId) ?? 0;
        if (version.coveredSeq > current) {
          maxCoveredSeqByNote.set(version.noteId, version.coveredSeq);
        }
      }

      for (const note of planned.notes) {
        this.insertNote.run(
          note.id, this.profileId, note.title, note.folderId,
          note.pinned ? 1 : 0, note.cardDeckId, note.createdAt, note.updatedAt,
        );
        written += 1;

        if (note.snapshot !== null) {
          const noteDerived = derived.get(note.id);
          if (noteDerived === undefined) {
            throw new RestoreValidationError(
              `Note "${note.id}" has a non-null snapshot but no matching entry in "derived".`,
            );
          }
          this.insertNoteSnapshot.run(
            note.id, Buffer.from(note.snapshot), noteDerived.plaintext,
            maxCoveredSeqByNote.get(note.id) ?? 0, now,
          );
          written += 1;
        }
      }

      for (const attachment of planned.noteAttachments) {
        this.insertNoteAttachment.run(
          attachment.id, attachment.noteId, attachment.fileName, attachment.mime,
          attachment.sizeBytes, attachment.sha256, attachment.createdAt,
        );
        written += 1;
      }

      for (const link of planned.noteTagLinks) {
        this.insertNoteTagLink.run(link.noteId, link.tagId);
        written += 1;
      }

      for (const version of planned.noteVersions) {
        this.insertNoteVersion.run(
          version.noteId, version.coveredSeq, Buffer.from(version.snapshot),
          version.title, version.createdAt,
        );
        written += 1;
      }

      // Scoped to the notes this plan carries, for the reason `RestoreStore`
      // scopes it the same way and one reason more: a wiki-link the planner
      // could not remap still holds the SOURCE profile's id, and an edge pointing
      // at a foreign id is exactly what must not be written into this profile.
      const importedNoteIds = new Set(planned.notes.map((note) => note.id));
      for (const note of planned.notes) {
        const noteDerived = derived.get(note.id);
        if (noteDerived === undefined) continue;
        for (const target of new Set(noteDerived.linkTargets)) {
          if (!importedNoteIds.has(target)) continue;
          this.insertNoteLink.run(note.id, target);
          written += 1;
        }
      }

      // Subject↔note links come AFTER the notes, unlike in a restore: foreign
      // keys stay enforced here, so both ends must already exist. The subjects
      // were written far above; the notes, just now.
      for (const link of planned.subjectNoteLinks) {
        this.insertSubjectNoteLink.run(link.subjectId, link.noteId, link.createdAt);
        written += 1;
      }

      for (const card of planned.cards) {
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

      for (const log of planned.reviewLog) {
        this.insertReviewLog.run(
          log.id, this.profileId, log.cardId, log.rating, log.state, log.due,
          log.stability, log.difficulty, log.elapsedDays, log.lastElapsedDays,
          log.scheduledDays, log.learningSteps, log.review, log.createdAt,
        );
        written += 1;
      }

      // The dashboard LAYOUT. The planner plans this member EMPTY by design
      // (founder, 2026-07-31: an import must not rearrange the target's tabla),
      // so this loop writes nothing today — it stays because this store is the
      // plan's faithful executor over every `ProfileData` member, and POLICY
      // about what a plan carries lives in `planForeignImport`, not here.
      for (const widget of planned.dashboardWidgets) {
        this.insertDashboardWidget.run(
          this.profileId, widget.instanceId, widget.widgetId, widget.size,
          widget.position, widget.config, widget.createdAt, widget.updatedAt,
        );
        written += 1;
      }

      return written;
    })();
  }
}

/**
 * The rows of one self-referencing table, re-ordered so a row whose `parentId`
 * names another row IN THE SAME ARRAY always comes after it — which is what
 * lets `tasks`, `task_lists` and `note_folders` be inserted with foreign keys
 * enforced rather than deferred to `COMMIT`.
 *
 * A `parentId` that names no row here is left alone: it is a row the TARGET
 * already has (a list whose parent was the source's Inbox now points at the
 * target's), and the database will check it on the spot, which is the whole
 * point of not deferring.
 *
 * Iterative rather than recursive on purpose — an archive is untrusted input,
 * and a chain thousands deep must fail the transaction rather than the stack.
 * The `seen` mark is set on the way DOWN, so a cycle terminates instead of
 * looping; the parser already refuses cyclic parent chains, and one that reached
 * here anyway would simply fail its own foreign-key check.
 */
function parentsFirst<T extends { id: string; parentId: string | null }>(
  rows: readonly T[],
): readonly T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const ordered: T[] = [];

  for (const start of rows) {
    if (seen.has(start.id)) continue;
    // The unemitted ancestors of `start`, deepest LAST: walked up from `start`,
    // then drained back down so every parent is written before its child.
    const chain: T[] = [];
    let current: T | undefined = start;
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      ordered.push(chain[index]!);
    }
  }

  return ordered;
}
