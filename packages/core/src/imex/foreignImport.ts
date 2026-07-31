import { remapNoteState } from "../notes/noteLinks.js";
import { ARCHIVE_MODULE_IDS, countProfileModules } from "./exportArchive.js";
import type { ArchiveModuleId, ProfileData } from "./exportArchive.js";
import type { ArchiveRecordType, ImportDrop, ImportDropReason } from "./importArchive.js";

/**
 * The pure planner for a FOREIGN import (ADR-043): merging somebody else's
 * archive — or the user's own other account's — into a profile that already has
 * data.
 *
 * A restore replaces a profile and preserves ids, because a note's Yjs document
 * embeds other rows' ids and nothing outside that document can see them. A
 * foreign import is the opposite contract: the target profile keeps everything
 * it has, so every imported row gets a NEW id, every reference — including the
 * ones buried inside Yjs state — is remapped through one map built up front,
 * and the only things that deduplicate are the ones whose identity is certain.
 * Nothing here guesses that two same-named rows are the same row: that is
 * somebody else's data, and guessing with it is the one thing this module must
 * never do.
 *
 * Pure, like every other module in `@nexus/core`: `mintId` is injected (no uuid
 * import, no clock, no database), and the result is a plain `ProfileData` an
 * apply slice inserts additively, plus the blob names it must copy and a report
 * that adds up.
 */

/** One tag the TARGET profile already has. `name` identity is the stores' own `(profile_id, name)` uniqueness — nothing else. */
export interface ForeignImportTargetTag {
  id: string;
  name: string;
}

/** Everything the planner needs to know about the profile being merged INTO. */
export interface ForeignImportTarget {
  /** The target profile's id — every imported row is stamped with it, never with the archive's. */
  profileId: string;
  /** The target profile's Inbox list. The source's Inbox is not imported; its contents land here. */
  inboxListId: string;
  /** The target's existing note tags. A source tag whose name matches one keeps the TARGET's id. */
  noteTags: readonly ForeignImportTargetTag[];
  /** The target's existing task tags, by the same rule. */
  taskTags: readonly ForeignImportTargetTag[];
  /**
   * The target's existing task template names. A task template's NAME is its
   * user-facing identity (migration 027's UNIQUE, ADR-035's "naming IS
   * editing") — but merging would OVERWRITE the target's payload, and a
   * foreign import never updates a pre-existing row (ADR-043 §4). So a source
   * template whose name is taken is SKIPPED, named in the report: the
   * target's template wins.
   */
  taskTemplateNames: readonly string[];
  /**
   * Whether the target already claims a quick-capture folder (migration 028's
   * partial unique index allows exactly one). When true, an imported folder's
   * own claim is cleared — the target's choice wins (ADR-043 §2).
   */
  claimsCaptureDefault: boolean;
}

/** What the planner consumes: a successfully parsed archive plus what salvage mode had to drop getting there. */
export interface ForeignImportSource {
  /** `parseImportArchive`'s `data`, already narrowed to non-null by the caller. */
  data: ProfileData;
  /** `parseImportArchive`'s `dropped` — folded into the report so one number covers the whole journey. */
  dropped: readonly ImportDrop[];
}

/**
 * Why a row the archive carried is not in the plan. Either salvage mode could
 * not read it (an `ImportDropReason`) or this planner skips it BY DESIGN — the
 * archive's settings, the notification ledger, the source's own Inbox row.
 */
export type ImportSkipCode =
  | ImportDropReason
  | "settings-not-imported"
  | "notifications-not-imported"
  | "dashboard-settings-not-imported"
  | "study-settings-not-imported"
  | "template-name-taken"
  | "source-inbox-collapsed";

/** One named, counted group of skipped rows. Grouped by `(code, module, type)`, in first-seen order. */
export interface ImportSkipReason {
  code: ImportSkipCode;
  /** The archive module the rows belonged to, or null for a skip that belongs to no module (the manifest's settings). */
  module: ArchiveModuleId | null;
  /** The record type the rows were, or null when they had none this build knows. */
  type: ArchiveRecordType | null;
  count: number;
}

/**
 * One module's arithmetic. `parsed` is everything the archive carried for it —
 * the rows that reached the planner PLUS the ones salvage mode dropped — and it
 * always equals `imported + merged + skipped`. A report that did not balance
 * would be worse than no report at all.
 */
export interface ImportModuleCounts {
  parsed: number;
  /** Rows the plan will insert as new rows. */
  imported: number;
  /** Rows that resolved onto a row that already exists (a tag matched by name, or a link that collapsed onto an existing pair). */
  merged: number;
  /** Rows that will not be inserted at all — every one of them named in `skips`. */
  skipped: number;
}

export interface ImportPlanReport {
  modules: Record<ArchiveModuleId, ImportModuleCounts>;
  skips: readonly ImportSkipReason[];
}

export interface ForeignImportPlan {
  /** Remapped and stamped, ready for additive insertion into the target profile. */
  data: ProfileData;
  /** The content-addressed blobs the apply must copy across — every surviving attachment's `sha256`, once each. */
  blobNames: ReadonlySet<string>;
  report: ImportPlanReport;
}

/**
 * Everything both passes share. The id map is ONE flat map rather than one per
 * table, because `remapNoteState` needs a single lookup for the note ids and
 * attachment ids a document embeds. Ids in an archive come from a uuid
 * generator, so two tables never carry the same one — and if some hand-made
 * archive did, this map would give both rows the same new id, which preserves
 * exactly the identity structure the source had.
 */
interface PlanContext {
  ids: Map<string, string>;
  target: ForeignImportTarget;
  mintId: () => string;
  /** Source rows that resolve onto an id that already exists and therefore produce NO row: a merged tag, the source's Inbox. */
  absorbed: Set<string>;
  /** Per module, how many rows merged onto something already there. */
  merged: Record<ArchiveModuleId, number>;
  /** How many source Inbox rows collapsed onto the target's (normally one; a hand-made archive could carry more). */
  inboxCollapsed: number;
  /** Task templates skipped because their name is taken — by the target, or by an earlier source row (see `ForeignImportTarget.taskTemplateNames`). */
  skippedTaskTemplateIds: Set<string>;
}

/**
 * How each `ProfileData` member contributes to the id map. A
 * `Record<keyof ProfileData, …>`, not a loop over `Object.keys`, so a member
 * added to `ProfileData` later is a COMPILE ERROR here rather than a table
 * whose rows silently keep somebody else's ids.
 */
const ID_MINTERS: Record<keyof ProfileData, (data: ProfileData, ctx: PlanContext) => void> = {
  tasks: (data, ctx) => mintAll(data.tasks, ctx),
  taskLists: (data, ctx) => {
    for (const list of data.taskLists) {
      // ADR-043: a profile has exactly one Inbox and the target already has
      // its own, so the source's row is not imported — its id resolves to the
      // target's, and everything filed in it lands there.
      if (list.isInbox) {
        ctx.ids.set(list.id, ctx.target.inboxListId);
        ctx.absorbed.add(list.id);
        ctx.inboxCollapsed += 1;
        continue;
      }
      mint(list.id, ctx);
    }
  },
  taskSections: (data, ctx) => mintAll(data.taskSections, ctx),
  taskTags: (data, ctx) => mintTags(data.taskTags, ctx.target.taskTags, "tasks", ctx),
  taskTagLinks: NO_IDS,
  taskAttachments: (data, ctx) => mintAll(data.taskAttachments, ctx),
  // A template's name is its identity and nothing references a task template
  // by id, so a name-taken row is simply not planned — no mapping to leave
  // behind. First writer wins within the source, the target wins over both.
  taskTemplates: (data, ctx) => {
    const taken = new Set(ctx.target.taskTemplateNames);
    for (const template of data.taskTemplates) {
      if (taken.has(template.name)) {
        ctx.skippedTaskTemplateIds.add(template.id);
        continue;
      }
      taken.add(template.name);
      mint(template.id, ctx);
    }
  },
  // A dependency's identity is its (blocker, blocked) pair — both task ids,
  // both already minted.
  taskDependencies: NO_IDS,
  // Not imported (the remap literal plans an empty array): the dashboard
  // background and dim are the TARGET user's preferences, not the archive's.
  dashboardSettings: NO_IDS,
  // The layout, unlike the background, IS content: a placement is a row among
  // rows, so it imports on the same additive terms as everything else — a fresh
  // instance id each, appended to whatever the target already had. Nothing
  // INSIDE a placement is remapped: `widgetId` names a code constant published
  // by a module manifest (migration 032 declares no foreign key for it), and
  // `config` is opaque JSON no part of this build interprets.
  dashboardWidgets: (data, ctx) => {
    for (const widget of data.dashboardWidgets) mint(widget.instanceId, ctx);
  },
  events: (data, ctx) => mintAll(data.events, ctx),
  documents: (data, ctx) => mintAll(data.documents, ctx),
  renewals: (data, ctx) => mintAll(data.renewals, ctx),
  people: (data, ctx) => mintAll(data.people, ctx),
  subjects: (data, ctx) => mintAll(data.subjects, ctx),
  exams: (data, ctx) => mintAll(data.exams, ctx),
  decks: (data, ctx) => mintAll(data.decks, ctx),
  cards: (data, ctx) => mintAll(data.cards, ctx),
  reviewLog: (data, ctx) => mintAll(data.reviewLog, ctx),
  plans: (data, ctx) => mintAll(data.plans, ctx),
  blocks: (data, ctx) => mintAll(data.blocks, ctx),
  focusSessions: (data, ctx) => mintAll(data.focusSessions, ctx),
  // A settings row is keyed by its profile alone (migration 034's PRIMARY KEY),
  // and the remap below retargets it onto the target profile — so there is no
  // id of its own to mint.
  studySettings: NO_IDS,
  // Not imported at all (the remap literal in `planForeignImport` plans an
  // empty array for it), so its ids are never needed.
  notifications: NO_IDS,
  notes: (data, ctx) => mintAll(data.notes, ctx),
  noteFolders: (data, ctx) => mintAll(data.noteFolders, ctx),
  noteTags: (data, ctx) => mintTags(data.noteTags, ctx.target.noteTags, "notes", ctx),
  noteTagLinks: NO_IDS,
  noteTemplates: (data, ctx) => mintAll(data.noteTemplates, ctx),
  noteAttachments: (data, ctx) => mintAll(data.noteAttachments, ctx),
  // A version's identity is `(noteId, coveredSeq)`, both of which travel with
  // the note — there is no id of its own to mint.
  noteVersions: NO_IDS,
};

/** A member whose rows carry no id of their own: a join row, or one this planner does not import. */
function NO_IDS(): void {
  /* nothing to mint */
}

function mint(oldId: string, ctx: PlanContext): string {
  const existing = ctx.ids.get(oldId);
  if (existing !== undefined) return existing;
  const next = ctx.mintId();
  ctx.ids.set(oldId, next);
  return next;
}

function mintAll(rows: readonly { id: string }[], ctx: PlanContext): void {
  for (const row of rows) mint(row.id, ctx);
}

/**
 * The ONE place identity is deduplicated (ADR-043). A source tag whose name
 * exactly matches one the target already has resolves onto the target's id and
 * produces no row; two source tags of the same name collapse onto one, for the
 * same reason the stores' `(profile_id, name)` unique index exists — inserting
 * both would simply fail.
 *
 * Exact string equality, deliberately: `NoteOrgStore.createTag` and
 * `TaskTagStore.createTag` both get-or-create by `WHERE name = ?` on a BINARY
 * column, so „Posao" and „posao" ARE two tags there, and „škola" and „skola"
 * are two more. Folding case or diacritics here would merge rows the app itself
 * considers distinct — a guess about somebody else's data.
 */
function mintTags(
  sourceTags: readonly { id: string; name: string }[],
  targetTags: readonly ForeignImportTargetTag[],
  module: ArchiveModuleId,
  ctx: PlanContext,
): void {
  const byName = new Map<string, string>();
  for (const tag of targetTags) {
    if (!byName.has(tag.name)) byName.set(tag.name, tag.id);
  }
  for (const tag of sourceTags) {
    const existing = byName.get(tag.name);
    if (existing !== undefined) {
      ctx.ids.set(tag.id, existing);
      ctx.absorbed.add(tag.id);
      ctx.merged[module] += 1;
      continue;
    }
    byName.set(tag.name, mint(tag.id, ctx));
  }
}

/**
 * The minted id for a source row's id. A miss cannot happen for a parsed
 * archive — every reference resolved before this map was built — and would mean
 * leaking a foreign profile's id into the target, so it is a bug to raise, not
 * a value to fall back to.
 */
function mapped(oldId: string, ctx: PlanContext): string {
  const next = ctx.ids.get(oldId);
  if (next === undefined) {
    throw new Error(`Foreign import: no minted id for ${oldId}. The archive was not fully parsed.`);
  }
  return next;
}

function mappedOrNull(oldId: string | null, ctx: PlanContext): string | null {
  return oldId === null ? null : mapped(oldId, ctx);
}

/** A task's list: the one the source named, or — for an archive written before ADR-029, whose `listId` is null — the target's Inbox, exactly as a restore reads it. */
function mappedList(listId: string | null, ctx: PlanContext): string {
  return listId === null ? ctx.target.inboxListId : mapped(listId, ctx);
}

/** A note's or version's Yjs state, with the ids its document embeds rewritten through the same map every row went through. */
function mappedState(snapshot: Uint8Array, ctx: PlanContext): Uint8Array {
  return remapNoteState(snapshot, ctx.ids);
}

/** Drops the rows that resolved onto an id the target already has — they are references now, not rows. */
function notAbsorbed<T extends { id: string }>(rows: readonly T[], ctx: PlanContext): readonly T[] {
  return rows.filter((row) => !ctx.absorbed.has(row.id));
}

/**
 * Removes join rows that collapsed onto a pair already in the list — two source
 * tags merging onto one target tag turn two distinct links into the same one,
 * and the table's composite primary key would refuse the second. Returns the
 * survivors and how many collapsed.
 */
function dedupePairs<T>(rows: readonly T[], key: (row: T) => string): { rows: T[]; collapsed: number } {
  const seen = new Set<string>();
  const survivors: T[] = [];
  for (const row of rows) {
    const pair = key(row);
    if (seen.has(pair)) continue;
    seen.add(pair);
    survivors.push(row);
  }
  return { rows: survivors, collapsed: rows.length - survivors.length };
}

/**
 * Plans a foreign import: what to insert, which blobs to copy, and an honest
 * account of everything that did not make it.
 */
export function planForeignImport(
  parsed: ForeignImportSource,
  target: ForeignImportTarget,
  mintId: () => string,
): ForeignImportPlan {
  const source = parsed.data;
  const ctx: PlanContext = {
    ids: new Map(),
    target,
    mintId,
    absorbed: new Set(),
    merged: zeroPerModule(),
    inboxCollapsed: 0,
    skippedTaskTemplateIds: new Set(),
  };

  // Pass 1: every id in the archive gets its answer before any reference is
  // rewritten — a task can name a list that appears later in the file, and a
  // card can name a note in an entirely different one.
  for (const mintMember of Object.values(ID_MINTERS)) mintMember(source, ctx);

  // Pass 2: rewrite. Written as ONE object literal typed `ProfileData` so a
  // member added to that interface later fails to compile here — the same
  // guarantee `ID_MINTERS` gives for the map, at the other end of the pipe.
  const taskTagLinks = dedupePairs(
    source.taskTagLinks.map((link) => ({
      taskId: mapped(link.taskId, ctx),
      tagId: mapped(link.tagId, ctx),
    })),
    (link) => `${link.taskId}\0${link.tagId}`,
  );
  ctx.merged.tasks += taskTagLinks.collapsed;

  const noteTagLinks = dedupePairs(
    source.noteTagLinks.map((link) => ({
      noteId: mapped(link.noteId, ctx),
      tagId: mapped(link.tagId, ctx),
    })),
    (link) => `${link.noteId}\0${link.tagId}`,
  );
  ctx.merged.notes += noteTagLinks.collapsed;

  const data: ProfileData = {
    tasks: source.tasks.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      parentId: mappedOrNull(row.parentId, ctx),
      listId: mappedList(row.listId, ctx),
      sectionId: mappedOrNull(row.sectionId, ctx),
    })),
    taskLists: notAbsorbed(source.taskLists, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      parentId: mappedOrNull(row.parentId, ctx),
    })),
    taskSections: source.taskSections.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      listId: mapped(row.listId, ctx),
    })),
    taskTags: notAbsorbed(source.taskTags, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    taskTagLinks: taskTagLinks.rows,
    taskAttachments: source.taskAttachments.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      taskId: mapped(row.taskId, ctx),
      // `sha256` is content addressing, exactly as on a note attachment below.
    })),
    taskTemplates: source.taskTemplates
      .filter((row) => !ctx.skippedTaskTemplateIds.has(row.id))
      .map((row) => ({
        ...row,
        id: mapped(row.id, ctx),
        profileId: target.profileId,
        // The payload references tags and subtasks BY NAME (ADR-035), so
        // nothing inside it needs the id map.
      })),
    taskDependencies: source.taskDependencies.map((row) => ({
      ...row,
      blockerId: mapped(row.blockerId, ctx),
      blockedId: mapped(row.blockedId, ctx),
    })),
    events: source.events.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    documents: source.documents.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    renewals: source.renewals.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      documentId: mapped(row.documentId, ctx),
    })),
    people: source.people.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    subjects: source.subjects.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    exams: source.exams.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      subjectId: mapped(row.subjectId, ctx),
    })),
    decks: source.decks.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      subjectId: mapped(row.subjectId, ctx),
    })),
    cards: source.cards.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      deckId: mapped(row.deckId, ctx),
      // `sourceBlockKey` rides along untouched: it names a block INSIDE the
      // note's document, not a row, so nothing about it changes here.
      sourceNoteId: mappedOrNull(row.sourceNoteId, ctx),
    })),
    // FSRS history is study data the user earned — it imports, pointed at the
    // minted cards.
    reviewLog: source.reviewLog.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      cardId: mapped(row.cardId, ctx),
    })),
    plans: source.plans.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      examId: mapped(row.examId, ctx),
    })),
    blocks: source.blocks.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      planId: mapped(row.planId, ctx),
    })),
    focusSessions: source.focusSessions.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      subjectId: mapped(row.subjectId, ctx),
    })),
    // STUDY-007's scheduling preferences are NOT imported, for the same reason
    // the dashboard background is not: retention and the two daily caps are the
    // TARGET user's own workload choices, keyed by their profile alone — and
    // the import card promises DODAJE, which an upsert over their row would
    // break. The skip is named below, like every by-design skip.
    studySettings: [],
    // ADR-043: a notification is a delivery RECORD — "we told the user this, at
    // this moment" — not portable content. Re-delivering somebody else's
    // reminders into this profile's history would be a lie about what happened.
    notifications: [],
    notes: source.notes.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      folderId: mappedOrNull(row.folderId, ctx),
      cardDeckId: mappedOrNull(row.cardDeckId, ctx),
      snapshot: row.snapshot === null ? null : mappedState(row.snapshot, ctx),
    })),
    noteFolders: source.noteFolders.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      parentId: mappedOrNull(row.parentId, ctx),
      defaultTemplateId: mappedOrNull(row.defaultTemplateId, ctx),
      // Migration 028 allows exactly one quick-capture folder per profile;
      // when the target already claims it, the target's choice wins (ADR-043
      // §2) and the imported folder arrives as an ordinary folder.
      isCaptureDefault: target.claimsCaptureDefault ? false : row.isCaptureDefault,
    })),
    noteTags: notAbsorbed(source.noteTags, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    noteTagLinks: noteTagLinks.rows,
    noteTemplates: source.noteTemplates.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    noteAttachments: source.noteAttachments.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      noteId: mapped(row.noteId, ctx),
      // `sha256` is content addressing, not identity: the same bytes keep the
      // same name in the target, which is what lets the apply copy each blob
      // once no matter how many notes reference it.
    })),
    noteVersions: source.noteVersions.map((row) => ({
      ...row,
      noteId: mapped(row.noteId, ctx),
      snapshot: mappedState(row.snapshot, ctx),
    })),
    // ADR-043: the dashboard background and dim are the TARGET user's own
    // preferences — an import must not redecorate their home.
    dashboardSettings: [],
    // The layout imports, minted and re-stamped like every other row. Its
    // `position` rides along unchanged: a position is a sort key relative to
    // its own scope, and the target's existing placements keep theirs, so the
    // two runs interleave by number rather than one landing on top of the
    // other. `widgetId` and `config` are copied verbatim — see `ID_MINTERS`.
    dashboardWidgets: source.dashboardWidgets.map((row) => ({
      ...row,
      instanceId: mapped(row.instanceId, ctx),
      profileId: target.profileId,
    })),
  };

  return {
    data,
    blobNames: new Set([
      ...data.noteAttachments.map((row) => row.sha256),
      ...data.taskAttachments.map((row) => row.sha256),
    ]),
    report: buildReport(source, parsed.dropped, data, ctx),
  };
}

function zeroPerModule(): Record<ArchiveModuleId, number> {
  return { tasks: 0, calendar: 0, study: 0, notifications: 0, notes: 0, dashboard: 0 };
}

/**
 * The report, built so its arithmetic is a real check rather than a definition:
 * `imported` is counted off the planned data by the same `countProfileModules`
 * the exporter and the restore preview use, `merged` is what the passes above
 * actually merged, and `skipped` is the sum of the NAMED reasons. If those
 * three ever stopped adding up to what the archive carried, the balance test
 * would say so rather than the numbers quietly agreeing with themselves.
 */
function buildReport(
  source: ProfileData,
  dropped: readonly ImportDrop[],
  planned: ProfileData,
  ctx: PlanContext,
): ImportPlanReport {
  const skips: ImportSkipReason[] = [];
  const skipIndex = new Map<string, ImportSkipReason>();
  const skipped = zeroPerModule();

  function note(
    code: ImportSkipCode,
    module: ArchiveModuleId | null,
    type: ArchiveRecordType | null,
    count: number,
  ): void {
    if (count <= 0) return;
    if (module !== null) skipped[module] += count;
    const key = `${code}\0${module ?? ""}\0${type ?? ""}`;
    const existing = skipIndex.get(key);
    if (existing !== undefined) {
      existing.count += count;
      return;
    }
    const reason: ImportSkipReason = { code, module, type, count };
    skipIndex.set(key, reason);
    skips.push(reason);
  }

  // What salvage mode could not read, grouped but never summarised away.
  for (const drop of dropped) note(drop.reason, drop.module, drop.type, 1);
  // What this planner skips by design.
  note("source-inbox-collapsed", "tasks", "task-list", ctx.inboxCollapsed);
  note("template-name-taken", "tasks", "task-template", ctx.skippedTaskTemplateIds.size);
  note("notifications-not-imported", "notifications", "notification", source.notifications.length);
  note(
    "dashboard-settings-not-imported",
    "dashboard",
    "dashboard-settings",
    source.dashboardSettings.length,
  );
  note("study-settings-not-imported", "study", "study-settings", source.studySettings.length);
  // The manifest's settings section — the target's flags and notification
  // preferences are the user's own choices, not the archive author's. It rides
  // in the manifest rather than in a module, so it is named without being
  // counted into one.
  note("settings-not-imported", null, null, 1);

  const parsedCounts = countProfileModules(source);
  const importedCounts = countProfileModules(planned);
  const droppedCounts = zeroPerModule();
  for (const drop of dropped) droppedCounts[drop.module] += 1;

  const modules = {} as Record<ArchiveModuleId, ImportModuleCounts>;
  for (const module of ARCHIVE_MODULE_IDS) {
    modules[module] = {
      parsed: parsedCounts[module] + droppedCounts[module],
      imported: importedCounts[module],
      merged: ctx.merged[module],
      skipped: skipped[module],
    };
  }

  return { modules, skips };
}
