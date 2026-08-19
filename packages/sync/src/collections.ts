/**
 * What syncs, and as what — ADR-082's collection map, in code.
 *
 * **Why this is a declaration here and a CHECK over there.** ADR-082's first
 * decision was that the set of user content is DERIVED from
 * `RESTORE_WIPE_TABLES` and never written out a second time: a table added in
 * six months would be caught by the restore guard and sail straight past sync,
 * and nothing would look wrong (DC-07, DC-08). But `RESTORE_WIPE_TABLES` lives
 * in `@nexus/db`, which is SQLite and therefore Node-only, and this map has to
 * be readable in a browser tab as well as in the Electron main process.
 *
 * So the map is declared here, portably, and `@nexus/db` carries the guard that
 * makes the derivation real: `collectionGuard.test.ts` reads `sqlite_master` and
 * `RESTORE_WIPE_TABLES` and fails until every live table is classified below,
 * every classification here names a table that exists, and — the part that turns
 * judgement into a checked property — every table called `parent-field` really
 * IS shaped like a join row, and no table called a collection is. A reader who
 * wants to know whether this file is still true does not have to trust it.
 *
 * **The three classifications** are ADR-082 §2's, and the line between the first
 * two is: *a sync object is a row a user can point at.*
 *
 * - `collection` — independent identity and independent edit history. The user
 *   creates it, names it, opens it, edits it. It gets an object id on the wire
 *   and merges field by field (or, for one table, as an update log).
 * - `parent-field` — a pure join row, carrying nothing but the pair at its ends,
 *   or an ordered child that only means anything inside its parent. As its own
 *   object it becomes an orphan the moment two devices disagree about the
 *   parent; as an ARRAY FIELD of the parent it merges with the same field-level
 *   LWW as everything else, replaced whole.
 * - `derived` — rebuilt locally from something that does sync, so sending it
 *   would be sending the same information twice and inviting the two copies to
 *   disagree.
 *
 * Device-local tables (`backup_settings`, `search_history`, `meta`) and the
 * sealed `private_*` family are absent from this file entirely, exactly as they
 * are absent from `RESTORE_WIPE_TABLES`. Absence is the classification, and the
 * guard test asserts it rather than leaving it to be noticed.
 */

/** How a collection's rows merge. */
export type CollectionShape =
  /**
   * A map from field name to (value, HLC), merged per field
   * (`@nexus/sync-crypto`'s `mergeRows`). Right for every row in the product
   * that is a handful of scalars — which is all of them but one.
   */
  | "fields"
  /**
   * An append-only log of encrypted CRDT updates. Right for exactly one table,
   * for the reason `merge.ts` states in its own header: concurrent edits to a
   * long text are the one case where last-write-wins is not a merge but a loss.
   */
  | "updates";

/** A table whose rows are their own sync objects. */
export interface SyncCollection {
  readonly kind: "collection";
  /** The SQLite table, and the collection id on the wire. */
  readonly table: string;
  readonly shape: CollectionShape;
  /**
   * The columns that identify one object WITHIN its profile — the table's
   * primary key with `profile_id` taken out, because the profile is already
   * decided by which content key opened the row and putting it on the wire would
   * be saying the same thing twice.
   *
   * Three shapes turn up, and all three matter to the wire format:
   *
   * - `["id"]` — the ordinary case, a UUIDv7 the row owns. Forty-four of the
   *   fifty-four collections.
   * - a NATURAL key of one or more columns — `["instance_id"]` for a dashboard
   *   placement, `["note_id", "seq"]` for one Yjs update, `["module_id"]` for a
   *   feature flag, `["day"]` for a body measurement. These are not opaque, so
   *   the object id derived from them is not opaque either: it is metadata in
   *   the clear, and the residual list has to say so.
   * - `[]` — a per-profile SINGLETON. Six collections are one row per profile
   *   (`ntf_settings`, `study_settings`, `calendar_settings`,
   *   `dashboard_settings`, `fit_targets`, `fit_body_profile`), so once
   *   `profile_id` is removed there is nothing left to identify: the collection
   *   holds exactly one object and its id is the empty key. That is a real case
   *   the transport must handle, not a hole in this map.
   *
   * `@nexus/db`'s guard asserts each of these against the real primary key, so a
   * migration that re-keys a table cannot leave this list quietly wrong.
   */
  readonly identity: readonly string[];
  /**
   * How a row of this table reaches the profile it belongs to, for the eight
   * collections that carry no `profile_id` column of their own. Absent means the
   * table has the column and nothing has to be joined.
   *
   * This is not bookkeeping: it is what lets the sweeper enumerate one profile's
   * objects when sync is first switched on, and it is the fact migration 063's
   * triggers are built out of — the profile has to be joined for at write time,
   * because a cascade removes the parent before the child's own trigger runs.
   * `@nexus/db`'s guard checks it against the real foreign key.
   */
  readonly profileVia?: { readonly parent: string; readonly key: string };
  /** Why this is an object of its own rather than a field of something else. */
  readonly why: string;
}

/**
 * The two shapes a parent-field table comes in. Both are checked against the
 * real schema by `@nexus/db`'s guard, which is the point of naming them: a
 * classification that cannot be falsified is an opinion.
 */
export type ParentFieldForm =
  /** Carries NO data column — every column is an id, a key, or `created_at`. The pair IS the row. */
  | "join"
  /** Carries data, but only inside its parent's ordered array: a NOT NULL parent FK and an integer `position`. */
  | "ordered-child";

/** A table whose rows are an array field of some other object. */
export interface ParentField {
  readonly kind: "parent-field";
  readonly table: string;
  /** The table whose object carries these rows as a field. */
  readonly parent: string;
  /** The column in `table` naming the parent row. */
  readonly parentColumn: string;
  readonly form: ParentFieldForm;
  readonly why: string;
}

/** A table rebuilt locally from something that does sync. */
export interface DerivedTable {
  readonly kind: "derived";
  readonly table: string;
  /** What it is rebuilt FROM — which must itself be in this map. */
  readonly from: string;
  readonly why: string;
}

export type SyncClassification = SyncCollection | ParentField | DerivedTable;

/** A collection whose rows carry bytes, synced on the Storage path rather than in the row. */
export const ATTACHMENT_COLLECTIONS: readonly string[] = [
  "note_attachments",
  "task_attachments",
  "subject_attachments",
];

/**
 * Every table of `RESTORE_WIPE_TABLES`, classified. Ordered as that list is, so
 * the two can be read side by side — which is how the guard test's failure
 * message expects to be checked against.
 */
export const SYNC_MAP: readonly SyncClassification[] = [
  // --- STUDY -------------------------------------------------------------
  {
    kind: "collection",
    table: "document_renewals",
    shape: "fields",
    identity: ["id"],
    profileVia: { parent: "tracked_documents", key: "document_id" },
    why: "A renewal is a dated obligation the user creates, edits and completes on its own; it outlives edits to the document it hangs off.",
  },
  {
    kind: "collection",
    table: "review_log",
    shape: "fields",
    identity: ["id"],
    why: "One review is a historical fact with its own moment. Never edited after it is written, so a field map is trivially correct and a merge is a union.",
  },
  {
    kind: "collection",
    table: "cards",
    shape: "fields",
    identity: ["id"],
    why: "A card carries its own scheduling state, which two devices legitimately advance independently — the case field-level LWW exists for.",
  },
  {
    kind: "collection",
    table: "decks",
    shape: "fields",
    identity: ["id"],
    why: "A deck is named, opened and edited.",
  },
  {
    kind: "collection",
    table: "exams",
    shape: "fields",
    identity: ["id"],
    why: "An exam is named, dated and edited.",
  },
  {
    kind: "collection",
    table: "study_blocks",
    shape: "fields",
    identity: ["id"],
    why: "A block is a planned session the user moves and completes independently of the plan that generated it.",
  },
  {
    kind: "collection",
    table: "exam_topics",
    shape: "fields",
    identity: ["id"],
    why: "NOT a join row: it carries the user's confidence in a topic, which is data neither end of the pair holds.",
  },
  {
    kind: "collection",
    table: "study_plans",
    shape: "fields",
    identity: ["id"],
    why: "A plan is named and edited.",
  },
  {
    kind: "collection",
    table: "focus_sessions",
    shape: "fields",
    identity: ["id"],
    why: "A session is a historical fact about time somebody actually spent; migration 057 deliberately gave it no foreign key to the task it names, for that reason.",
  },
  {
    kind: "collection",
    table: "tracked_documents",
    shape: "fields",
    identity: ["id"],
    why: "A document is named, opened and edited.",
  },
  {
    kind: "collection",
    table: "subject_attachments",
    shape: "fields",
    identity: ["id"],
    profileVia: { parent: "subjects", key: "subject_id" },
    why: "Carries bytes, so the metadata rides here and the file rides the Storage path — two different transports, therefore two different objects.",
  },
  {
    kind: "parent-field",
    table: "subject_note_links",
    parent: "subjects",
    parentColumn: "subject_id",
    form: "join",
    why: "The pair IS the row. As its own object it orphans the moment two devices disagree about the subject.",
  },
  {
    kind: "collection",
    table: "subjects",
    shape: "fields",
    identity: ["id"],
    why: "A subject is named and edited.",
  },

  // --- CALENDAR / PEOPLE / NOTIFY ---------------------------------------
  {
    kind: "collection",
    table: "events",
    shape: "fields",
    identity: ["id"],
    why: "An event is created, moved and edited.",
  },
  {
    kind: "collection",
    table: "event_templates",
    shape: "fields",
    identity: ["id"],
    why: "A template hangs off nothing and nothing hangs off it (migration 036); it is a thing the user made.",
  },
  {
    kind: "collection",
    table: "people",
    shape: "fields",
    identity: ["id"],
    why: "A person is named and edited.",
  },
  {
    kind: "collection",
    table: "notifications",
    shape: "fields",
    identity: ["id"],
    why: "So a notification dismissed on one device is dismissed on the other. The row is generated, but its READ/dismissed state is the user's and must travel.",
  },

  // --- TASK --------------------------------------------------------------
  {
    kind: "parent-field",
    table: "task_tag_links",
    parent: "tasks",
    parentColumn: "task_id",
    form: "join",
    why: "The pair IS the row: it carries no data of its own, so there is nothing about it two devices could disagree about except whether it exists — which is the task's business, not its own.",
  },
  {
    kind: "collection",
    table: "task_attachments",
    shape: "fields",
    identity: ["id"],
    profileVia: { parent: "tasks", key: "task_id" },
    why: "Carries bytes — see `subject_attachments`.",
  },
  {
    kind: "parent-field",
    table: "task_dependencies",
    parent: "tasks",
    parentColumn: "blocked_id",
    form: "join",
    why: "An edge carries nothing but its two ends (migration 029: `blocker_id`, `blocked_id`, and a composite key made of exactly those). It hangs off the BLOCKED task rather than the blocker because that is the one the user has open when they say what is holding it up — the edit and the object must be the same object.",
  },
  {
    kind: "collection",
    table: "tasks",
    shape: "fields",
    identity: ["id"],
    why: "The archetypal sync object.",
  },
  {
    kind: "collection",
    table: "task_sections",
    shape: "fields",
    identity: ["id"],
    profileVia: { parent: "task_lists", key: "list_id" },
    why: "A heading is named and reordered on its own; ADR-082 §3.1's rank is per section scope.",
  },
  {
    kind: "collection",
    table: "task_lists",
    shape: "fields",
    identity: ["id"],
    why: "A list is named, nested and reordered.",
  },
  {
    kind: "collection",
    table: "task_tags",
    shape: "fields",
    identity: ["id"],
    why: "A tag is named and recoloured.",
  },
  {
    kind: "collection",
    table: "task_templates",
    shape: "fields",
    identity: ["id"],
    why: "A template is a thing the user made.",
  },

  // --- NOTE --------------------------------------------------------------
  {
    kind: "parent-field",
    table: "note_tag_links",
    parent: "notes",
    parentColumn: "note_id",
    form: "join",
    why: "The pair IS the row, exactly as `task_tag_links` is: migration 011's note tags are migration 023's task tags with a note on the other end, and the two must not drift apart.",
  },
  {
    kind: "parent-field",
    table: "note_links",
    parent: "notes",
    parentColumn: "source_note_id",
    form: "join",
    why: "A wiki-link edge carries nothing but its two ends, and it is a projection of the note body that produced it — so it must move with that body, never against it.",
  },
  {
    kind: "collection",
    table: "note_attachments",
    shape: "fields",
    identity: ["id"],
    profileVia: { parent: "notes", key: "note_id" },
    why: "Carries bytes — see `subject_attachments`.",
  },
  {
    kind: "collection",
    table: "note_versions",
    shape: "fields",
    identity: ["note_id", "covered_seq"],
    profileVia: { parent: "notes", key: "note_id" },
    why: "A named version is a thing the user asked to keep. It must carry its own snapshot bytes rather than pointing at a compaction another device may never have made.",
  },
  {
    kind: "derived",
    table: "note_snapshots",
    from: "note_updates",
    why: "A Yjs snapshot is a compaction of the update log, and every device can compute its own. Sending it would send the same information twice and let two copies disagree about one document.",
  },
  {
    kind: "collection",
    table: "note_updates",
    shape: "updates",
    identity: ["note_id", "seq"],
    profileVia: { parent: "notes", key: "note_id" },
    why: "The note BODY. The one place last-write-wins is not a merge but a lost paragraph, so it travels as an append-only log of encrypted CRDT updates.",
  },
  {
    kind: "collection",
    table: "notes",
    shape: "fields",
    identity: ["id"],
    why: "The note's METADATA — title, folder, category, pins. Its body is `note_updates`; the split is deliberate, because a rename and a paragraph are not the same kind of edit.",
  },
  {
    kind: "collection",
    table: "note_tags",
    shape: "fields",
    identity: ["id"],
    why: "A tag is named and recoloured.",
  },
  {
    kind: "collection",
    table: "note_folders",
    shape: "fields",
    identity: ["id"],
    why: "A folder is named and nested.",
  },
  {
    kind: "collection",
    table: "note_categories",
    shape: "fields",
    identity: ["id"],
    why: "A category is named and coloured.",
  },
  {
    kind: "collection",
    table: "note_templates",
    shape: "fields",
    identity: ["id"],
    why: "A template is a thing the user made.",
  },

  // --- Per-profile settings ----------------------------------------------
  //
  // Singletons, or near enough — one row per profile, sometimes one per source.
  // They are collections rather than one big settings object because a setting
  // is exactly the case field-level LWW is best at: two devices changing two
  // different preferences must keep both.
  {
    kind: "collection",
    table: "feature_flags",
    shape: "fields",
    identity: ["module_id"],
    why: "Which modules the user turned on.",
  },
  {
    kind: "collection",
    table: "ntf_settings",
    shape: "fields",
    identity: [],
    why: "One row per profile; a preference.",
  },
  {
    kind: "collection",
    table: "ntf_source_settings",
    shape: "fields",
    identity: ["source"],
    why: "One row per notification source; a preference.",
  },
  {
    kind: "collection",
    table: "study_settings",
    shape: "fields",
    identity: [],
    why: "One row per profile; a preference.",
  },
  {
    kind: "collection",
    table: "calendar_settings",
    shape: "fields",
    identity: [],
    why: "One row per profile; a preference.",
  },
  {
    kind: "collection",
    table: "dashboard_settings",
    shape: "fields",
    identity: [],
    why: "One row per profile; a preference.",
  },
  {
    kind: "collection",
    table: "dashboard_widgets",
    shape: "fields",
    identity: ["instance_id"],
    why: "A placement is dragged, resized and configured on its own — the ADR-082 §3.1 rank scope proves it has an order of its own.",
  },
  {
    kind: "collection",
    table: "dashboard_sets",
    shape: "fields",
    identity: ["id"],
    why: "A board is named and reordered.",
  },

  // --- FIN ---------------------------------------------------------------
  {
    kind: "collection",
    table: "fin_budgets",
    shape: "fields",
    identity: ["id"],
    why: "A budget is set and edited.",
  },
  {
    kind: "collection",
    table: "fin_transactions",
    shape: "fields",
    identity: ["id"],
    why: "The FIN archetype. Carries the two UNIQUE surfaces ADR-082 §3.3 names, resolved on apply.",
  },
  {
    kind: "collection",
    table: "fin_recurring",
    shape: "fields",
    identity: ["id"],
    why: "A series is a thing the user set up.",
  },
  {
    kind: "collection",
    table: "fin_categories",
    shape: "fields",
    identity: ["id"],
    why: "A category is named and coloured.",
  },
  {
    kind: "collection",
    table: "fin_accounts",
    shape: "fields",
    identity: ["id"],
    why: "An account is named and edited.",
  },

  // --- HABIT -------------------------------------------------------------
  {
    kind: "collection",
    table: "habit_entries",
    shape: "fields",
    identity: ["id"],
    profileVia: { parent: "habits", key: "habit_id" },
    why: "One day's mark is a fact with its own moment, and two devices can legitimately mark different days of the same habit.",
  },
  {
    kind: "collection",
    table: "habits",
    shape: "fields",
    identity: ["id"],
    why: "A habit is named and scheduled.",
  },

  // --- FIT ---------------------------------------------------------------
  {
    kind: "collection",
    table: "fit_meal_items",
    shape: "fields",
    identity: ["id"],
    why: "One logged food is edited and deleted on its own — the portion is corrected without touching anything else that day.",
  },
  {
    kind: "collection",
    table: "fit_foods",
    shape: "fields",
    identity: ["id"],
    why: "A user-defined food is a thing they made.",
  },
  {
    kind: "collection",
    table: "fit_targets",
    shape: "fields",
    identity: [],
    why: "One row per profile; a preference.",
  },
  {
    kind: "collection",
    table: "canvas_boards",
    shape: "fields",
    identity: ["id"],
    why: "A board is named and opened. Its scene is one opaque Excalidraw document, so two devices drawing at once resolve by LWW on that field — see OPEN_QUESTIONS below, which is where that costs something.",
  },
  {
    kind: "parent-field",
    table: "fit_routine_items",
    parent: "fit_routines",
    parentColumn: "routine_id",
    form: "ordered-child",
    why: "An item only means anything inside its routine, and its `position` is an index into that routine's array — which is exactly why migration 062 left it an integer.",
  },
  {
    kind: "collection",
    table: "fit_routines",
    shape: "fields",
    identity: ["id"],
    why: "A routine is named and edited.",
  },
  {
    kind: "parent-field",
    table: "fit_workout_sets",
    parent: "fit_workouts",
    parentColumn: "workout_id",
    form: "ordered-child",
    why: "A logged set only means anything inside the session that logged it, and its `position` indexes that session's array — the same reasoning as `fit_routine_items`, and the reason migration 062 left both of them integers while every hand-orderable scope became a rank.",
  },
  {
    kind: "collection",
    table: "fit_workouts",
    shape: "fields",
    identity: ["id"],
    why: "A session is a historical fact about a workout that happened.",
  },
  {
    kind: "collection",
    table: "fit_exercises",
    shape: "fields",
    identity: ["id"],
    why: "A user-defined exercise is a thing they made.",
  },
  {
    kind: "collection",
    table: "fit_measurements",
    shape: "fields",
    identity: ["day"],
    why: "A measurement is a dated fact.",
  },
  {
    kind: "collection",
    table: "fit_body_profile",
    shape: "fields",
    identity: [],
    why: "One row per profile; a preference.",
  },
  // --- ELEC (migration 067) ----------------------------------------------
  {
    kind: "collection",
    table: "circuits",
    shape: "fields",
    identity: ["id"],
    why: "A circuit is a document the user names and edits; its parts and wires are objects of their own, so the header holds only what is genuinely the circuit's.",
  },
  {
    kind: "collection",
    table: "circuit_parts",
    shape: "fields",
    identity: ["id"],
    profileVia: { parent: "circuits", key: "circuit_id" },
    // A `parent-field` would make the circuit the sync object and replace its
    // whole part list on every merge — which is exactly the loss CANV records as
    // its open question, arriving here by choice instead of by inheritance. Two
    // people dragging different parts of one circuit is the ordinary case, not
    // the pathological one, and per-object LWW is what keeps both moves.
    why: "A placed part carries its own position, label and value, and two devices legitimately move different parts of one circuit at once.",
  },
  {
    kind: "collection",
    table: "circuit_wires",
    shape: "fields",
    identity: ["id"],
    profileVia: { parent: "circuits", key: "circuit_id" },
    why: "A wire is drawn and deleted on its own, and its two ends are foreign keys — so it must be an object that can arrive after the parts it names.",
  },
];

/**
 * Classifications this map makes that are decisions rather than derivations, and
 * that the notes and canvas slices have to answer before they ship. Recorded
 * here rather than in a comment nobody re-reads, and asserted non-empty by the
 * tests — an open question that quietly disappears is DC-07.
 */
export const OPEN_QUESTIONS: readonly string[] = [
  "`canvas_boards.scene` is one opaque Excalidraw document merged by whole-field LWW. Two devices drawing on the same board concurrently lose one side's strokes entirely. Excalidraw's own elements carry versionNonce/updated and are designed to be merged element-wise; doing that means the scene stops being an opaque field, which is a change to `canvasScene.ts`'s central decision. Decide before CANV syncs, not after.",
  "`note_versions` must carry its own snapshot bytes, because `note_snapshots` is derived and a device that never compacted at that point has nothing to point at. The NOTE sync slice has to make the version row self-contained.",
  "`notifications` sync so a dismissal travels, but a notification generated independently on two devices from the same source would arrive twice under two ids. Either generation becomes deterministic (id derived from source + moment) or the apply step dedupes on (source, entity, moment).",
  "Ten collections identify their objects by a NATURAL key rather than a UUID — `module_id`, `source`, `day`, `covered_seq`, `seq`. An object id is metadata in the clear, so an untrusted server learns which modules exist, which notification sources are configured, and on which DAYS the user measured themselves, without decrypting anything. UUIDv7 ids already leak creation time (ADR-082 §3.4) and this is the same class, one step worse because the value is meaningful rather than a timestamp. Either the object id becomes a keyed hash of the natural key under a per-profile key, or the residual list states this plainly. It must not be discovered later.",
];

const BY_TABLE = new Map(SYNC_MAP.map((entry) => [entry.table, entry]));

/** The classification of `table`, or `undefined` for one this map does not carry. */
export function classify(table: string): SyncClassification | undefined {
  return BY_TABLE.get(table);
}

/** Every table that becomes a sync object of its own, in map order. */
export function collections(): readonly SyncCollection[] {
  return SYNC_MAP.filter((entry): entry is SyncCollection => entry.kind === "collection");
}

/** Every table whose rows are an array field of some other object, in map order. */
export function parentFields(): readonly ParentField[] {
  return SYNC_MAP.filter((entry): entry is ParentField => entry.kind === "parent-field");
}
