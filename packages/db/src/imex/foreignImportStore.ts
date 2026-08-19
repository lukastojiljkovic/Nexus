import type Database from "better-sqlite3-multiple-ciphers";
import type { ProfileData } from "@nexus/core";
import { RestoreValidationError } from "../errors.js";
import {
  canvasSceneText,
  exdatesText,
  habitScheduleText,
  offsetsText,
  recurrenceText,
  requiredRecurrenceText,
  viewConfigText,
} from "./columnText.js";
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
  private readonly insertExamTopic: Database.Statement;
  private readonly insertPlan: Database.Statement;
  private readonly insertBlock: Database.Statement;
  private readonly insertFocusSession: Database.Statement;
  private readonly insertNoteTemplate: Database.Statement;
  private readonly insertNoteFolder: Database.Statement;
  private readonly insertNoteTag: Database.Statement;
  private readonly insertNoteCategory: Database.Statement;
  private readonly insertFinAccount: Database.Statement;
  private readonly insertFinCategory: Database.Statement;
  private readonly insertFinRecurring: Database.Statement;
  private readonly insertFinTransaction: Database.Statement;
  private readonly insertFinBudget: Database.Statement;
  private readonly insertHabit: Database.Statement;
  private readonly insertHabitEntry: Database.Statement;
  private readonly insertFitFood: Database.Statement;
  private readonly insertFitMealItem: Database.Statement;
  private readonly insertFitExercise: Database.Statement;
  private readonly insertFitRoutine: Database.Statement;
  private readonly insertFitRoutineItem: Database.Statement;
  private readonly insertFitWorkout: Database.Statement;
  private readonly insertFitWorkoutSet: Database.Statement;
  private readonly insertCanvasBoard: Database.Statement;
  private readonly insertCircuit: Database.Statement;
  private readonly insertCircuitPart: Database.Statement;
  private readonly insertCircuitWire: Database.Statement;
  private readonly insertNote: Database.Statement;
  private readonly insertNoteSnapshot: Database.Statement;
  private readonly insertNoteAttachment: Database.Statement;
  private readonly insertNoteTagLink: Database.Statement;
  private readonly insertNoteVersion: Database.Statement;
  private readonly insertNoteLink: Database.Statement;
  private readonly insertCard: Database.Statement;
  private readonly insertReviewLog: Database.Statement;
  private readonly insertDashboardSet: Database.Statement;
  private readonly insertDashboardWidget: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertTaskList = db.prepare(
      `INSERT INTO task_lists
         (id, profile_id, parent_id, name, is_inbox, default_view, view_config, rank,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertTaskSection = db.prepare(
      `INSERT INTO task_sections (id, list_id, name, rank, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.insertTaskTag = db.prepare(
      `INSERT INTO task_tags (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)`,
    );
    this.insertTask = db.prepare(
      `INSERT INTO tasks
         (id, profile_id, parent_id, title, description, status, priority,
          due_date, start_date, created_at, updated_at, completed_at, recurrence,
          reminder_offsets, list_id, section_id, rank, deleted_at)
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
         (id, profile_id, subject_id, started_at, ended_at, kind, planned_minutes,
          paused_seconds, outcome, cycle_index, task_id, label, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
    this.insertNoteCategory = db.prepare(
      `INSERT INTO note_categories (id, profile_id, name, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.insertFinAccount = db.prepare(
      `INSERT INTO fin_accounts
         (id, profile_id, name, kind, currency, opening_balance, archived,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertFinCategory = db.prepare(
      `INSERT INTO fin_categories (id, profile_id, name, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // `paused_at` rides along unremapped (migration 054): whether a subscription
    // is being charged is a FACT ABOUT THE ROW, not a reference into the source
    // profile, so an imported subscription arrives exactly as paused — or as
    // running — as it was. Anything else would silently start charging the
    // target's account for something nobody restarted.
    this.insertFinRecurring = db.prepare(
      `INSERT INTO fin_recurring
         (id, profile_id, account_id, category_id, name, amount, payee, note, recurrence,
          anchor_date, next_run, reminder_days, paused_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    // `import_key` rides along (migration 052): a merge that dropped the
    // fingerprints would let the merged profile re-import the very statement
    // those rows came from. The planner remapped the ACCOUNT around each key
    // rather than touching it, which is exactly what the key naming no account
    // buys.
    this.insertFinTransaction = db.prepare(
      `INSERT INTO fin_transactions
         (id, profile_id, account_id, counter_account_id, category_id, tx_date, amount,
          payee, note, import_key, recurring_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertFinBudget = db.prepare(
      `INSERT INTO fin_budgets
         (id, profile_id, category_id, currency, amount, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    // `archived_at` rides along unremapped (migration 055): whether its owner had
    // finished with a habit is a FACT ABOUT THE ROW, not a reference into the
    // source profile, so an imported habit arrives as retired — or as current —
    // as it actually was. Anything else would put somebody else's retired habits
    // into the target's today list.
    this.insertHabit = db.prepare(
      `INSERT INTO habits
         (id, profile_id, name, color, schedule, target, unit, reminder_time,
          archived_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertHabitEntry = db.prepare(
      `INSERT INTO habit_entries (id, habit_id, entry_date, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // FIT (migration 058). There is no `fit_targets` statement, deliberately:
    // the planner never imports a goals row (a calorie target is the TARGET
    // user's own decision about their own body — `fit-targets-not-imported`), so
    // a statement that could write one would be a way to break that promise.
    this.insertFitFood = db.prepare(
      `INSERT INTO fit_foods
         (id, profile_id, name, category, kcal, protein, carbs, fat, fiber, sugar, sodium_mg,
          servings_json, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertFitMealItem = db.prepare(
      `INSERT INTO fit_meal_items
         (id, profile_id, meal_date, slot, food_ref, label, grams,
          kcal, protein, carbs, fat, fiber, sugar, sodium_mg,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    // FIT training & body (migration 060). No `fit_measurements` or
    // `fit_body_profile` statement, deliberately: the planner never imports
    // either (`fit-measurements-not-imported`, `fit-body-profile-not-imported`)
    // — a body-weight log and the profile's own body facts are the TARGET
    // user's, `fit_targets`' exact posture above — so a statement that could
    // write one would be a way to break that promise.
    this.insertFitExercise = db.prepare(
      `INSERT INTO fit_exercises
         (id, profile_id, name, name_en, primary_muscles_json, secondary_muscles_json,
          equipment, pattern, unilateral, metric, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertFitRoutine = db.prepare(
      `INSERT INTO fit_routines (id, profile_id, name, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    // AFTER the routines it references (foreign keys are enforced, never
    // deferred, in this store — the class doc's own rule).
    this.insertFitRoutineItem = db.prepare(
      `INSERT INTO fit_routine_items
         (id, profile_id, routine_id, position, exercise_ref, label,
          target_sets, target_reps_min, target_reps_max,
          target_seconds, target_weight_kg, target_distance_m, rest_seconds,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertFitWorkout = db.prepare(
      `INSERT INTO fit_workouts
         (id, profile_id, workout_date, started_at, ended_at, routine_ref, routine_label, notes,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    // AFTER the workouts it references, on the routine items' exact terms.
    this.insertFitWorkoutSet = db.prepare(
      `INSERT INTO fit_workout_sets
         (id, profile_id, workout_id, position, exercise_ref, label, metric, primary_muscles_json,
          kind, weight_kg, reps, seconds, distance_m, rir, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // CANV (migration 059). Every board is a NEW row on the habits' reasoning —
    // see the insert loop — and the drawing goes through the same serializer
    // `CanvasStore` writes through.
    this.insertCanvasBoard = db.prepare(
      `INSERT INTO canvas_boards (id, profile_id, name, scene, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    // ELEC (migration 067). Three statements, run parent-first — the order is
    // the schema's, not the loop's.
    this.insertCircuit = db.prepare(
      `INSERT INTO circuits (id, profile_id, name, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertCircuitPart = db.prepare(
      `INSERT INTO circuit_parts
         (id, circuit_id, component_id, label, x, y, rotation, value, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertCircuitWire = db.prepare(
      `INSERT INTO circuit_wires
         (id, circuit_id, from_part_id, from_pin_id, to_part_id, to_pin_id, colour,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.insertNote = db.prepare(
      `INSERT INTO notes
         (id, profile_id, title, folder_id, category_id, pinned, card_deck_id,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
    // column order. `cloze_ordinal` rides through VERBATIM for the reason
    // `RestoreStore`'s own card loop spells out: since interchange `1.26.0` it
    // is the deletion's NUMBER (ADR-068), and only the parser — which read the
    // archive's declared version — can say whether the value it handed over
    // needed upgrading from a position.
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
    this.insertDashboardSet = db.prepare(
      `INSERT INTO dashboard_sets (id, profile_id, name, rank, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.insertDashboardWidget = db.prepare(
      `INSERT INTO dashboard_widgets
         (profile_id, instance_id, widget_id, size, set_id, rank, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          list.rank, list.createdAt, list.updatedAt,
        );
        written += 1;
      }

      for (const section of planned.taskSections) {
        this.insertTaskSection.run(
          section.id, section.listId, section.name, section.rank,
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
          offsetsText(task.reminderOffsets), task.listId, task.sectionId, task.rank,
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

      // ADR-063: topics AFTER the exams and decks they reference — foreign
      // keys stay enforced here — and before the plans whose blocks name them.
      for (const topic of planned.examTopics) {
        this.insertExamTopic.run(
          topic.id, this.profileId, topic.examId, topic.name, topic.sortOrder,
          topic.confidence, topic.deckId, topic.cut ? 1 : 0, topic.createdAt, topic.updatedAt,
        );
        written += 1;
      }

      for (const plan of planned.plans) {
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

      for (const block of planned.blocks) {
        this.insertBlock.run(
          block.id, block.planId, this.profileId, block.blockDate, block.minutes,
          block.status, block.topicId ?? null, block.kind ?? "coverage",
          (block.pinned ?? false) ? 1 : 0,
          block.createdAt, block.updatedAt,
        );
        written += 1;
      }

      for (const session of planned.focusSessions) {
        this.insertFocusSession.run(
          session.id, this.profileId, session.subjectId, session.startedAt, session.endedAt,
          session.kind, session.plannedMinutes, session.pausedSeconds, session.outcome,
          session.cycleIndex, session.taskId, session.label,
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

      // NOTE-002 / migration 049. Migration 049's `(profile_id, name)` UNIQUE
      // is never in play here for the reason the tags' is not: a category whose
      // name the target already holds was ABSORBED by the planner and is not in
      // the plan at all — the notes that named it point at the target's row
      // instead (ADR-043 §2, `ID_MINTERS.noteCategories`).
      for (const category of planned.noteCategories) {
        this.insertNoteCategory.run(
          category.id, this.profileId, category.name, category.color,
          category.createdAt, category.updatedAt,
        );
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
          note.id, this.profileId, note.title, note.folderId, note.categoryId,
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

      // The named boards, then the dashboard LAYOUT — sets before the widgets
      // whose `set_id` names them, since foreign keys stay enforced here. The
      // planner plans BOTH members EMPTY by design (founder, 2026-07-31: an
      // import must not rearrange the target's tabla; ADR-055 extends that to
      // its boards), so these loops write nothing today — they stay because
      // this store is the plan's faithful executor over every `ProfileData`
      // member, and POLICY about what a plan carries lives in
      // `planForeignImport`, not here.
      for (const set of planned.dashboardSets) {
        this.insertDashboardSet.run(
          set.id, this.profileId, set.name, set.rank, set.createdAt, set.updatedAt,
        );
        written += 1;
      }
      for (const widget of planned.dashboardWidgets) {
        this.insertDashboardWidget.run(
          this.profileId, widget.instanceId, widget.widgetId, widget.size,
          widget.setId ?? null, widget.rank, widget.config,
          widget.createdAt, widget.updatedAt,
        );
        written += 1;
      }

      // FIN (migration 051), in the topological order foreign keys demand here
      // (they stay ENFORCED throughout this store): accounts and categories,
      // then the transactions whose two account references and one category
      // reference now all resolve, then the budgets.
      //
      // A transfer needs no special handling at all, which is exactly the payoff
      // of one row per transfer: the planner remapped both sides through the
      // same map, so the row that lands here already names two accounts of THIS
      // profile. A two-row model would have to keep a pair in step across a
      // remap and an insert, and this store cannot even express the failure.
      //
      // A category the planner ABSORBED is not in `planned.finCategories` at all
      // — it resolved onto the target's own row — so nothing here can collide
      // with `(profile_id, kind, name)`, and nothing pre-existing is modified:
      // the insert-only contract is kept as literally as it is for tags.
      for (const account of planned.finAccounts) {
        this.insertFinAccount.run(
          account.id, this.profileId, account.name, account.kind, account.currency,
          account.openingBalance, account.archived ? 1 : 0,
          account.createdAt, account.updatedAt,
        );
        written += 1;
      }
      for (const category of planned.finCategories) {
        this.insertFinCategory.run(
          category.id, this.profileId, category.name, category.kind,
          category.createdAt, category.updatedAt,
        );
        written += 1;
      }
      // The subscriptions (migration 053), between the rows they point at and
      // the charges that point back. Every one is a NEW row — the planner never
      // absorbs a subscription (see `ID_MINTERS.finRecurring`), because its
      // account is always a new row too, and a schedule charging the target's
      // bank beside charges that came out of the source's would be two rows
      // disagreeing about whose money this is.
      for (const subscription of planned.finRecurring) {
        this.insertFinRecurring.run(
          subscription.id, this.profileId, subscription.accountId, subscription.categoryId,
          subscription.name, subscription.amount, subscription.payee, subscription.note,
          requiredRecurrenceText(subscription.recurrence), subscription.startDate,
          subscription.nextRun, subscription.reminderDays, subscription.pausedAt,
          subscription.createdAt, subscription.updatedAt,
        );
        written += 1;
      }
      for (const transaction of planned.finTransactions) {
        this.insertFinTransaction.run(
          transaction.id, this.profileId, transaction.accountId, transaction.counterAccountId,
          transaction.categoryId, transaction.date, transaction.amount,
          transaction.payee, transaction.note, transaction.importKey,
          transaction.recurringId ?? null,
          transaction.createdAt, transaction.updatedAt,
        );
        written += 1;
      }
      // Already filtered by the planner to the slots the target does not
      // occupy (`budget-slot-taken`), so this insert can never collide either.
      for (const budget of planned.finBudgets) {
        this.insertFinBudget.run(
          budget.id, this.profileId, budget.categoryId, budget.currency, budget.amount,
          budget.createdAt, budget.updatedAt,
        );
        written += 1;
      }

      // HABIT (migration 055): the habits, then the days that name them. Every
      // habit is a NEW row — the planner never absorbs one (see
      // `ID_MINTERS.habits`), because a habit carries a SCHEDULE that a merge
      // would have to overwrite, and „Trčanje" three times a week is not
      // „Trčanje" on Mon/Wed/Fri: grafting one profile's days onto the other's
      // row would compute a streak over a history half of which was never kept
      // under that schedule. So nothing here can collide, and the insert-only
      // contract is kept as literally as it is for the tags.
      for (const habit of planned.habits) {
        this.insertHabit.run(
          habit.id, this.profileId, habit.name, habit.color,
          habitScheduleText(habit.schedule), habit.target, habit.unit, habit.reminderTime,
          habit.archivedAt, habit.createdAt, habit.updatedAt,
        );
        written += 1;
      }
      for (const entry of planned.habitEntries) {
        this.insertHabitEntry.run(
          entry.id, entry.habitId, entry.date, entry.value, entry.createdAt, entry.updatedAt,
        );
        written += 1;
      }

      // FIT (migration 058): the user's own foods, then the diary. Every food is
      // a NEW row on the habits' reasoning exactly — it carries seven numbers a
      // merge would have to overwrite, and two „Ajvar" rows in two profiles are
      // routinely two different recipes — so nothing here can collide either.
      //
      // `food_ref` arrives already followed onto the food it named
      // (`remappedFoodRef`), and is written verbatim: a `catalogue:` reference
      // needs no remapping because both profiles share the app's own catalogue,
      // and one the planner could not resolve is kept rather than repaired,
      // because the item's label and snapshot are what make it readable.
      //
      // No `fit_targets` write, by design — see the statement block above.
      for (const food of planned.fitFoods) {
        this.insertFitFood.run(
          food.id, this.profileId, food.name, food.category,
          food.per100g.kcal, food.per100g.protein, food.per100g.carbs, food.per100g.fat,
          food.per100g.fiber, food.per100g.sugar, food.per100g.sodiumMg,
          JSON.stringify(food.servings), food.notes, food.createdAt, food.updatedAt,
        );
        written += 1;
      }
      for (const item of planned.fitMealItems) {
        this.insertFitMealItem.run(
          item.id, this.profileId, item.date, item.slot, item.foodRef, item.label, item.grams,
          item.per100g.kcal, item.per100g.protein, item.per100g.carbs, item.per100g.fat,
          item.per100g.fiber, item.per100g.sugar, item.per100g.sodiumMg,
          item.createdAt, item.updatedAt,
        );
        written += 1;
      }

      // FIT training & body (migration 060): the user's own exercises, then the
      // routines and the items that name them, then the workouts and the sets
      // that name them. Every exercise/routine/workout is a NEW row on the
      // habits' reasoning exactly — see `ID_MINTERS.fitExercises`/
      // `.fitRoutines`/`.fitWorkouts` (`@nexus/core`) — so nothing here can
      // collide. Items and sets are written AFTER the parent that names them
      // (foreign keys are enforced, never deferred, in this store), their
      // `exerciseRef` already followed onto the exercise it named
      // (`remappedExerciseRef`), on `food_ref`'s exact terms above. No
      // `fit_measurements`/`fit_body_profile` write, by design — see the
      // statement block above.
      for (const exercise of planned.fitExercises) {
        this.insertFitExercise.run(
          exercise.id, this.profileId, exercise.name, exercise.nameEn,
          JSON.stringify(exercise.primaryMuscles), JSON.stringify(exercise.secondaryMuscles),
          exercise.equipment, exercise.pattern, exercise.unilateral ? 1 : 0, exercise.metric,
          exercise.notes, exercise.createdAt, exercise.updatedAt,
        );
        written += 1;
      }
      for (const routine of planned.fitRoutines) {
        this.insertFitRoutine.run(
          routine.id, this.profileId, routine.name, routine.notes,
          routine.createdAt, routine.updatedAt,
        );
        written += 1;
      }
      for (const item of planned.fitRoutineItems) {
        this.insertFitRoutineItem.run(
          item.id, this.profileId, item.routineId, item.position, item.exerciseRef, item.label,
          item.targetSets, item.targetRepsMin, item.targetRepsMax,
          // Migration 061. An archive written before it has no such fields, so
          // `?? null` is what makes an old backup restore as „this routine said
          // nothing about a hold" rather than throwing on a missing property.
          item.targetSeconds ?? null, item.targetWeightKg ?? null,
          item.targetDistanceM ?? null, item.restSeconds ?? null,
          item.createdAt, item.updatedAt,
        );
        written += 1;
      }
      // `routineRef` arrives already followed onto the routine it named, or null
      // when the map could not answer (`mappedRoutineRefOrNone`) — the column
      // carries no foreign key, so this write never depends on the routine
      // loop above having produced a match.
      for (const workout of planned.fitWorkouts) {
        this.insertFitWorkout.run(
          workout.id, this.profileId, workout.day, workout.startedAt, workout.endedAt,
          workout.routineRef, workout.routineLabel, workout.notes,
          workout.createdAt, workout.updatedAt,
        );
        written += 1;
      }
      for (const set of planned.fitWorkoutSets) {
        this.insertFitWorkoutSet.run(
          set.id, this.profileId, set.workoutId, set.position, set.exerciseRef, set.label,
          set.metric, JSON.stringify(set.primaryMuscles), set.kind,
          set.weightKg, set.reps, set.seconds, set.distanceM, set.rir,
          set.createdAt, set.updatedAt,
        );
        written += 1;
      }

      // CANV (migration 059): the boards. Every one is a NEW row on the habits'
      // reasoning exactly — it carries a whole DRAWING a merge would have to
      // overwrite, and two „Šema baze" boards in two profiles are two different
      // diagrams — so nothing here can collide, and the insert-only contract is
      // kept as literally as it is for the tags. The drawing rides unremapped
      // because there is nothing in it that points anywhere: an embedded image
      // lives inside the scene's own `files`, keyed by an id only that scene
      // uses.
      for (const board of planned.canvasBoards) {
        this.insertCanvasBoard.run(
          board.id, this.profileId, board.name, canvasSceneText(board.scene),
          board.createdAt, board.updatedAt,
        );
        written += 1;
      }

      // ELEC (migration 067): circuits, then parts, then wires. Every circuit
      // is a NEW row on the boards' reasoning exactly — two „Robot" circuits in
      // two profiles are two different machines, so nothing here can collide
      // and the insert-only contract is kept literally. `componentId` rides
      // UNREMAPPED and must: it names an entry in the catalogue the app ships,
      // which is the same catalogue on both sides because it is part of the
      // build rather than of the database.
      for (const circuit of planned.circuits) {
        this.insertCircuit.run(
          circuit.id, this.profileId, circuit.name, circuit.notes,
          circuit.createdAt, circuit.updatedAt,
        );
        written += 1;
      }
      for (const part of planned.circuitParts) {
        this.insertCircuitPart.run(
          part.id, part.circuitId, part.componentId, part.label,
          part.x, part.y, part.rotation, part.value ?? null,
          part.createdAt, part.updatedAt,
        );
        written += 1;
      }
      for (const wire of planned.circuitWires) {
        this.insertCircuitWire.run(
          wire.id, wire.circuitId, wire.fromPartId, wire.fromPinId,
          wire.toPartId, wire.toPinId, wire.colour,
          wire.createdAt, wire.updatedAt,
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
