import type { Migration } from "./migrations.js";

/**
 * Migration 63 — the change journal (ADR-083).
 *
 * Two tables and one rule: **a row of user content cannot be written, changed or
 * destroyed without the journal learning about it.** Everything below exists to
 * make that sentence true without depending on any store method remembering to
 * say so — DC-08, *a rule applied on one path is not applied; it is only
 * present.* There are already dozens of methods that write to these tables and
 * there will be more; a trigger cannot be forgotten by a method nobody has
 * written yet.
 *
 * **`sync_journal` is a dirty SET, not a log.** `(profile_id, collection,
 * object_id)` and nothing else. Writing the same row a hundred times leaves one
 * entry; it records *that* something changed and never *what*, because the
 * sweeper reads the row itself. That makes it self-healing — a lost entry is
 * re-queued by the next edit, and the push that follows carries the current
 * truth rather than a stale delta — and it makes redelivery free, which is the
 * only kind of delivery a sync protocol actually gets.
 *
 * **`sync_row_state` is where the per-field clocks live.** `mergeRows`
 * merges field by field, so every field carries its own HLC stamp, and there is
 * nowhere in the schema for those stamps: a task row has one `updated_at` for
 * the whole row, which is exactly the granularity field-level merge exists to
 * avoid. A trigger cannot produce them — it would have to know the current HLC,
 * which is application state, not a column — so the split is: the trigger
 * records the dirt, the sweeper resolves it.
 *
 * **Journaling is OFF until sync is enabled, and that is a data fact rather than
 * a schema fact.** Every trigger below carries `WHEN (SELECT value FROM meta
 * WHERE key = 'sync_journal_enabled') = '1'`. A device whose owner never turns
 * cloud on must be in exactly the product 1.0.0 is: with the flag off the
 * trigger body never runs, the journal stays empty, and the cost of all this is
 * one probe into a two-column table per write. The alternative — creating the
 * triggers when sync is switched on — was rejected because it makes "is
 * journaling on" a property of the schema, which can be half-applied, instead of
 * a property of one row, which cannot. Turning sync on therefore also requires a
 * full initial sweep, which the first push has to do anyway.
 *
 * **`sync_row_state` deliberately survives a switch-off.** It is a baseline, not
 * a queue: on re-enable the sweeper diffs against it and stamps only what really
 * changed in between, instead of restamping the user's whole database and
 * beating every concurrent edit made on another device.
 *
 * **Why the profile is joined for and not read.** Forty-six of the fifty-four
 * collections carry `profile_id` and their trigger writes it straight. Eight do
 * not and must reach it through a parent — and that is also the case that could
 * lose a deletion, because a cascade removes the parent BEFORE the child's
 * `AFTER DELETE` fires, leaving nothing to join to. Probed rather than assumed
 * (SQLite fires the child's triggers on a cascade even with
 * `recursive_triggers` off; the parent's `BEFORE DELETE` still sees its
 * children; the parent's `AFTER DELETE` runs last, after the cascade). So each
 * of the six parents involved gets a `BEFORE DELETE` trigger that journals those
 * children while they can still be seen. Without it, purging a note would
 * destroy its attachments, versions and pending updates on this device and leave
 * no tombstone for any other — the worst sync bug there is, because the user's
 * evidence for it is that the thing they deleted came back.
 *
 * **Parent-field tables journal their PARENT's object.** A row of
 * `task_tag_links` is a field of the task (ADR-082 §2), so tagging a task marks
 * the TASK dirty. They reach the profile through the parent even when they carry
 * their own `profile_id` (`fit_routine_items`, `fit_workout_sets`) — one shape
 * for all seven, and a parent that has already cascaded away journals nothing
 * rather than an entry for an object that no longer exists.
 *
 * **The table list is spelled out here and never read from `@nexus/sync`'s map.**
 * A migration describes what it did at version 63 and must keep producing that
 * same schema for a file upgraded a year from now; one that read a live map
 * would rewrite its own history every time the map changed. New collections get
 * their triggers in a new migration, and `collectionGuard.test.ts` is what makes
 * that a thing that fails rather than a thing to remember.
 *
 * `note_snapshots` gets no trigger: it is rebuilt locally from `note_updates`,
 * so journaling it would push the same information twice and invite the two
 * copies to disagree about one document.
 */
export const migration063: Migration = {
  version: 63,
  up(db) {
    db.exec(`
      CREATE TABLE sync_journal (
        profile_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        object_id  TEXT NOT NULL,
        PRIMARY KEY (profile_id, collection, object_id)
      ) WITHOUT ROWID;

      CREATE TABLE sync_row_state (
        profile_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        object_id  TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, collection, object_id)
      );

      INSERT INTO meta (key, value) VALUES ('${JOURNAL_FLAG}', '0');
    `);

    // Neither table carries a foreign key to `profiles`, on purpose: a cascade
    // fires the child's DELETE trigger, and a trigger that inserted a row
    // pointing at the profile being deleted would turn "delete this profile"
    // into a foreign-key error. The cleanup is a trigger instead — unguarded by
    // the flag, because tidying up after a profile must not depend on a setting
    // that may have been switched off since.
    db.exec(`
      CREATE TRIGGER profiles_sync_ad AFTER DELETE ON profiles BEGIN
        DELETE FROM sync_journal   WHERE profile_id = old.id;
        DELETE FROM sync_row_state WHERE profile_id = old.id;
      END;
    `);

    for (const entry of COLLECTIONS) db.exec(collectionTriggers(entry));
    for (const entry of PARENT_FIELDS) db.exec(parentFieldTriggers(entry));
    for (const parent of cascadeParents()) db.exec(cascadeTrigger(parent));
  },
};

/** The `meta` key that turns journaling on. Absent or `'0'` means off. */
const JOURNAL_FLAG = "sync_journal_enabled";

/** Every trigger below runs only while sync is enabled on this device. */
const GUARD = `(SELECT value FROM meta WHERE key = '${JOURNAL_FLAG}') = '1'`;

/** How a table without a `profile_id` of its own reaches one. */
interface ProfileVia {
  readonly parent: string;
  readonly key: string;
}

/** A table whose rows are sync objects of their own. */
interface JournalledCollection {
  readonly table: string;
  /**
   * The columns identifying one object within its profile — the primary key
   * minus `profile_id`. Empty for a per-profile singleton, whose object id is
   * the empty string.
   */
  readonly identity: readonly string[];
  /** Absent when the table carries its own `profile_id`. */
  readonly via?: ProfileVia;
}

/** A collection that has no `profile_id` and therefore reaches one through a parent. */
interface ParentedCollection extends JournalledCollection {
  readonly via: ProfileVia;
}

/** Every collection that reaches its profile through a parent, in map order. */
function parented(): readonly ParentedCollection[] {
  return COLLECTIONS.filter((entry): entry is ParentedCollection => entry.via !== undefined);
}

/** A table whose rows are an array field of some other object. */
interface JournalledParentField {
  readonly table: string;
  readonly parent: string;
  readonly key: string;
}

/**
 * The fifty-four collections, in `RESTORE_WIPE_TABLES` order so this list and
 * `@nexus/sync`'s map can be read side by side.
 */
const COLLECTIONS: readonly JournalledCollection[] = [
  // --- STUDY ---------------------------------------------------------------
  {
    table: "document_renewals",
    identity: ["id"],
    via: { parent: "tracked_documents", key: "document_id" },
  },
  { table: "review_log", identity: ["id"] },
  { table: "cards", identity: ["id"] },
  { table: "decks", identity: ["id"] },
  { table: "exams", identity: ["id"] },
  { table: "study_blocks", identity: ["id"] },
  { table: "exam_topics", identity: ["id"] },
  { table: "study_plans", identity: ["id"] },
  { table: "focus_sessions", identity: ["id"] },
  { table: "tracked_documents", identity: ["id"] },
  { table: "subject_attachments", identity: ["id"], via: { parent: "subjects", key: "subject_id" } },
  { table: "subjects", identity: ["id"] },

  // --- CALENDAR / PEOPLE / NOTIFY -----------------------------------------
  { table: "events", identity: ["id"] },
  { table: "event_templates", identity: ["id"] },
  { table: "people", identity: ["id"] },
  { table: "notifications", identity: ["id"] },

  // --- TASK ----------------------------------------------------------------
  { table: "task_attachments", identity: ["id"], via: { parent: "tasks", key: "task_id" } },
  { table: "tasks", identity: ["id"] },
  { table: "task_sections", identity: ["id"], via: { parent: "task_lists", key: "list_id" } },
  { table: "task_lists", identity: ["id"] },
  { table: "task_tags", identity: ["id"] },
  { table: "task_templates", identity: ["id"] },

  // --- NOTE ----------------------------------------------------------------
  { table: "note_attachments", identity: ["id"], via: { parent: "notes", key: "note_id" } },
  {
    table: "note_versions",
    identity: ["note_id", "covered_seq"],
    via: { parent: "notes", key: "note_id" },
  },
  { table: "note_updates", identity: ["note_id", "seq"], via: { parent: "notes", key: "note_id" } },
  { table: "notes", identity: ["id"] },
  { table: "note_tags", identity: ["id"] },
  { table: "note_folders", identity: ["id"] },
  { table: "note_categories", identity: ["id"] },
  { table: "note_templates", identity: ["id"] },

  // --- Per-profile settings ------------------------------------------------
  { table: "feature_flags", identity: ["module_id"] },
  { table: "ntf_settings", identity: [] },
  { table: "ntf_source_settings", identity: ["source"] },
  { table: "study_settings", identity: [] },
  { table: "calendar_settings", identity: [] },
  { table: "dashboard_settings", identity: [] },
  { table: "dashboard_widgets", identity: ["instance_id"] },
  { table: "dashboard_sets", identity: ["id"] },

  // --- FIN -----------------------------------------------------------------
  { table: "fin_budgets", identity: ["id"] },
  { table: "fin_transactions", identity: ["id"] },
  { table: "fin_recurring", identity: ["id"] },
  { table: "fin_categories", identity: ["id"] },
  { table: "fin_accounts", identity: ["id"] },

  // --- HABIT ---------------------------------------------------------------
  { table: "habit_entries", identity: ["id"], via: { parent: "habits", key: "habit_id" } },
  { table: "habits", identity: ["id"] },

  // --- FIT / CANVAS --------------------------------------------------------
  { table: "fit_meal_items", identity: ["id"] },
  { table: "fit_foods", identity: ["id"] },
  { table: "fit_targets", identity: [] },
  { table: "canvas_boards", identity: ["id"] },
  { table: "fit_routines", identity: ["id"] },
  { table: "fit_workouts", identity: ["id"] },
  { table: "fit_exercises", identity: ["id"] },
  { table: "fit_measurements", identity: ["day"] },
  { table: "fit_body_profile", identity: [] },
];

/** The seven tables that are an array field of some other object. */
const PARENT_FIELDS: readonly JournalledParentField[] = [
  { table: "subject_note_links", parent: "subjects", key: "subject_id" },
  { table: "task_tag_links", parent: "tasks", key: "task_id" },
  // The BLOCKED task, not the blocker: that is the one the user has open when
  // they say what is holding it up, and the edit and the object must be the
  // same object. Deleting a BLOCKER cascades these rows away while the blocked
  // task is still there, so the ordinary child trigger below journals it.
  { table: "task_dependencies", parent: "tasks", key: "blocked_id" },
  { table: "note_tag_links", parent: "notes", key: "note_id" },
  { table: "note_links", parent: "notes", key: "source_note_id" },
  { table: "fit_routine_items", parent: "fit_routines", key: "routine_id" },
  { table: "fit_workout_sets", parent: "fit_workouts", key: "workout_id" },
];

/**
 * The object id for one row: its identity columns joined by `char(31)`, the
 * ASCII unit separator — a character no id, module name, notification source or
 * date can contain, so the join needs no escaping. A singleton's id is the empty
 * string, which is the honest spelling of "this collection holds exactly one
 * object". `prefix` is `new.`/`old.` inside a trigger on the table itself, and
 * empty when the columns are read from a sub-select over that table.
 */
function objectId(prefix: string, identity: readonly string[]): string {
  if (identity.length === 0) return "''";
  return identity.map((column) => `${prefix}${column}`).join(" || char(31) || ");
}

/** One `INSERT OR IGNORE` naming the object a row of `entry.table` belongs to. */
function journal(entry: JournalledCollection, row: "new" | "old", extra?: string): string {
  const head = "INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)";
  const id = objectId(`${row}.`, entry.identity);
  if (entry.via) {
    const where = [`p.id = ${row}.${entry.via.key}`, extra].filter(Boolean).join(" AND ");
    return `${head}
          SELECT p.profile_id, '${entry.table}', ${id}
            FROM ${entry.via.parent} p WHERE ${where};`;
  }
  // A `SELECT` with no `FROM` and a bare `WHERE` produces no row when the
  // condition is false, which is how the identity-changed case below costs
  // nothing in the overwhelming case where it did not change.
  return extra
    ? `${head}
          SELECT ${row}.profile_id, '${entry.table}', ${id} WHERE ${extra};`
    : `${head}
          VALUES (${row}.profile_id, '${entry.table}', ${id});`;
}

function collectionTriggers(entry: JournalledCollection): string {
  // An UPDATE that moves the identity is two objects' business: the one that
  // now exists and the one that no longer does. No store does it today; the
  // second statement is here so that a store which starts doing it tomorrow
  // cannot silently strand a tombstone.
  const moved =
    entry.identity.length === 0
      ? ""
      : `\n        ${journal(entry, "old", `${objectId("old.", entry.identity)} <> ${objectId("new.", entry.identity)}`)}`;

  return `
      CREATE TRIGGER ${entry.table}_sync_ai AFTER INSERT ON ${entry.table} WHEN ${GUARD} BEGIN
        ${journal(entry, "new")}
      END;
      CREATE TRIGGER ${entry.table}_sync_au AFTER UPDATE ON ${entry.table} WHEN ${GUARD} BEGIN
        ${journal(entry, "new")}${moved}
      END;
      CREATE TRIGGER ${entry.table}_sync_ad AFTER DELETE ON ${entry.table} WHEN ${GUARD} BEGIN
        ${journal(entry, "old")}
      END;
    `;
}

/** One `INSERT OR IGNORE` naming the PARENT object a join or ordered child belongs to. */
function journalParent(entry: JournalledParentField, row: "new" | "old", extra?: string): string {
  const where = [`p.id = ${row}.${entry.key}`, extra].filter(Boolean).join(" AND ");
  return `INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
          SELECT p.profile_id, '${entry.parent}', p.id FROM ${entry.parent} p WHERE ${where};`;
}

function parentFieldTriggers(entry: JournalledParentField): string {
  // Re-pointing a link edits two arrays, so both parents are journaled.
  const moved = journalParent(entry, "old", `old.${entry.key} <> new.${entry.key}`);
  return `
      CREATE TRIGGER ${entry.table}_sync_ai AFTER INSERT ON ${entry.table} WHEN ${GUARD} BEGIN
        ${journalParent(entry, "new")}
      END;
      CREATE TRIGGER ${entry.table}_sync_au AFTER UPDATE ON ${entry.table} WHEN ${GUARD} BEGIN
        ${journalParent(entry, "new")}
        ${moved}
      END;
      CREATE TRIGGER ${entry.table}_sync_ad AFTER DELETE ON ${entry.table} WHEN ${GUARD} BEGIN
        ${journalParent(entry, "old")}
      END;
    `;
}

/** The parents whose deletion would otherwise destroy a child with no tombstone. */
function cascadeParents(): readonly string[] {
  return [...new Set(parented().map((entry) => entry.via.parent))];
}

/**
 * `BEFORE DELETE` on a parent, journaling the profile-less collections that are
 * about to cascade away with it. It has to run before the row goes, because
 * afterwards there is no `profile_id` left anywhere on the path — which is
 * exactly why the children's own `AFTER DELETE` triggers cannot cover this case.
 * The parent's own object is journaled by its ordinary `_sync_ad`.
 */
function cascadeTrigger(parent: string): string {
  const statements = parented()
    .filter((child) => child.via.parent === parent)
    .map(
      (child) => `INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
          SELECT old.profile_id, '${child.table}', ${objectId("", child.identity)}
            FROM ${child.table} WHERE ${child.via.key} = old.id;`,
    )
    .join("\n        ");

  return `
      CREATE TRIGGER ${parent}_sync_bd BEFORE DELETE ON ${parent} WHEN ${GUARD} BEGIN
        ${statements}
      END;
    `;
}
