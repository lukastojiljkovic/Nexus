import { remapNoteState } from "../notes/noteLinks.js";
import { isBuiltinNoteTemplateId } from "../notes/noteTemplateIds.js";
import { ARCHIVE_MODULE_IDS, countProfileModules } from "./exportArchive.js";
import type { ArchiveModuleId, ArchiveProfilePicture, ProfileData } from "./exportArchive.js";
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

/**
 * One row the TARGET profile already has whose identity IS its name — a note
 * tag, a task tag, or a note category. Named for tags because they came first;
 * the shape is "a row the store's own `(profile_id, name)` uniqueness makes
 * unrepeatable", and nothing else.
 */
export interface ForeignImportTargetTag {
  id: string;
  name: string;
}

/**
 * The kinds of row this planner can recognise as something the target ALREADY
 * HAS (ADR-051 / IMEX-008) — the four whose identity is certain enough to say so
 * out loud, and no others.
 *
 * Certainty is the whole gate. An attachment's identity is its BYTES: the same
 * sha256 is the same file in any profile, which is not a guess at all. An
 * event's is `(title, startAt, allDay)`, a person's `(name, month, day)` and a
 * document's `(docType, label)` — each one the tuple the app's own UI treats as
 * "the same appointment / the same birthday / the same passport", and each one
 * a fact the user can check on screen in one glance. Nothing else qualifies:
 * two tasks called „Kupovina“, two notes called „Ideje“ and two subjects called
 * „Analiza“ are routinely different rows, and merging them would be exactly the
 * guess about somebody else's data this module was written never to make.
 *
 * `"attachment"` is ONE group covering all three attachment tables. The identity
 * is the file, and „ista datoteka“ is the same sentence whether the row hangs
 * off a note, a task or a subject — three groups would ask the user the same
 * question three times and get the same answer. The REPORT still counts them
 * per module, because the arithmetic is per module.
 */
export type ImportDuplicateType = "event" | "person" | "document" | "attachment";

/** Every `ImportDuplicateType`, in the order the preview lists them. A `Record` over this type would not give an ORDER, and the UI needs one. */
export const IMPORT_DUPLICATE_TYPES: readonly ImportDuplicateType[] = [
  "event",
  "person",
  "document",
  "attachment",
];

/** What to do with one group of duplicates. `"skip"` is the default everywhere — see `planForeignImport`. */
export type ImportDuplicateChoice = "skip" | "import";

/** The user's answer per group. Partial: an unanswered group is `"skip"`, so a caller that has asked nothing gets the safe plan. */
export type ImportDuplicateChoices = Partial<Record<ImportDuplicateType, ImportDuplicateChoice>>;

/** One detected group, counted whether the current choice skips it or imports it — the preview shows the row either way, or the user could never change their mind. */
export interface ImportDuplicateGroup {
  type: ImportDuplicateType;
  count: number;
}

/**
 * The three identity keys, composed as a JSON ARRAY rather than by joining the
 * parts with a separator. A separator can appear inside a title, a name or a
 * label — „Sastanak | 10h“ is a perfectly ordinary event title — and a joined
 * key would then make two genuinely different rows collide, which for a
 * duplicate rule means silently dropping somebody's data. `JSON.stringify` of a
 * fixed-length array escapes every part and cannot be ambiguous.
 *
 * Exported because the TARGET's index is built by the CALLER (`main`, off the
 * live stores) while the SOURCE's key is composed here: two spellings of one
 * key would be a rule that quietly stopped matching, so there is exactly one.
 */
export function eventDuplicateKey(event: {
  title: string;
  startAt: string;
  allDay: boolean;
}): string {
  return JSON.stringify([event.title, event.startAt, event.allDay]);
}

/** A person's identity (CAL-007): the name and the recurring day. `year` is deliberately out — it is separately-known trivia a user often leaves blank, so two rows for one birthday would stop matching the moment one of them learned it. */
export function personDuplicateKey(person: {
  name: string;
  month: number;
  day: number;
}): string {
  return JSON.stringify([person.name, person.month, person.day]);
}

/** A tracked document's identity: what kind it is and what the user calls it. `expiryDate` is out on purpose — a renewed passport is the SAME document with a new date, and keying on the date would import a second copy of it every year. */
export function documentDuplicateKey(document: { docType: string; label: string }): string {
  return JSON.stringify([document.docType, document.label]);
}

/**
 * A budget's slot in the target: which category, in which currency (migration
 * 051's UNIQUE index, minus the profile every row here already shares). Composed
 * as a JSON array for the separator reason the three keys above give — a
 * category id cannot contain a separator today, but the rule is one rule.
 *
 * Exported for the same reason `eventDuplicateKey` is: the TARGET's index is
 * built by main off the live store while the SOURCE's key is composed here, and
 * two spellings of one key would be a rule that quietly stopped matching.
 */
export function finBudgetKey(budget: { categoryId: string; currency: string }): string {
  return JSON.stringify([budget.categoryId, budget.currency]);
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
   * The target's existing note CATEGORIES (NOTE-002, migration 049), by exactly
   * the tag rule — see `ID_MINTERS.noteCategories` for why a category absorbs
   * like a tag rather than being skipped like a template.
   */
  noteCategories: readonly ForeignImportTargetTag[];
  /**
   * The target's existing FINANCE categories (migration 051). Absorbed by the
   * exact `(kind, name)` PAIR rather than by name alone — see
   * `ID_MINTERS.finCategories` for why the pair is what stops „Pokloni" the
   * expense from swallowing „Pokloni" the income. Carries `kind` for exactly
   * that reason, which is why it is not a `ForeignImportTargetTag`.
   */
  finCategories: readonly { id: string; name: string; kind: string }[];
  /**
   * The `(categoryId, currency)` pairs the target already budgets — composed by
   * `finBudgetKey` — so a source allowance for a category the import absorbs
   * onto an already-budgeted one is dropped rather than colliding on migration
   * 051's UNIQUE index. The target's own limit wins, on `taskTemplateNames`'
   * terms: a foreign import never updates a pre-existing row.
   */
  finBudgetKeys: ReadonlySet<string>;
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
   * The target's existing EVENT template names (CAL-009 / migration 036), by
   * exactly the rule above — a template's name is its user-facing identity, a
   * foreign import never updates a pre-existing row, so a source template whose
   * name is taken is SKIPPED and the target's wins. Declared separately from
   * `taskTemplateNames` rather than merged into one list because the two live in
   * different tables under different UNIQUE indexes: a task template called
   * „Trening“ does not stop an event template of the same name from importing.
   */
  eventTemplateNames: readonly string[];
  /**
   * The target's existing NOTE template names (migration 015), by exactly the
   * rule the two above state. Declared separately for the reason they are
   * separate from each other: three tables, three UNIQUE indexes, three name
   * spaces — a note template called „Sastanak“ does not stop an event template
   * of that name from importing, and vice versa.
   *
   * A `Set` rather than an array, unlike its two siblings, because this one is
   * built by fanning out over the target's whole template list and is only ever
   * asked "is this name taken?" — the shape the question has.
   */
  noteTemplateNames: ReadonlySet<string>;
  /**
   * Every attachment blob the target profile already holds, across all three
   * attachment tables (ADR-051). Content addressing makes this the one identity
   * in the whole planner that involves no judgement at all: the same sha256 IS
   * the same bytes.
   */
  attachmentHashes: ReadonlySet<string>;
  /** The target's existing events, by `eventDuplicateKey`. */
  eventKeys: ReadonlySet<string>;
  /** The target's existing people, by `personDuplicateKey`. */
  personKeys: ReadonlySet<string>;
  /** The target's existing tracked documents, by `documentDuplicateKey`. */
  documentKeys: ReadonlySet<string>;
  /**
   * Whether the target already claims a quick-capture folder (migration 028's
   * partial unique index allows exactly one). When true, an imported folder's
   * own claim is cleared — the target's choice wins (ADR-043 §2).
   */
  claimsCaptureDefault: boolean;
  /**
   * Source ids that ALREADY name a row of this profile (ADR-052). Each entry
   * pre-populates the id map, so a reference to that source id resolves onto the
   * target's own row and NO id is minted for it — and the source row carrying it
   * (if any) is absorbed rather than planned, exactly as a name-matched tag is.
   *
   * The seam exists for an import whose source is not a Nexus archive at all.
   * The Anki importer (`ankiTranslate.ts`) names its subject `apkg:subject` and
   * lets the user's CHOICE decide what that name means: „Nova oblast" leaves this
   * absent and plans a real subject row, while choosing an existing subject seeds
   * that one entry — and every imported deck then hangs off the subject the user
   * picked, with no id of the archive's own left anywhere.
   *
   * OPTIONAL, unlike every other member here, and deliberately: an ordinary
   * archive import seeds nothing, and a required field would make every caller
   * spell an empty map to say so. Absent and empty mean the same thing.
   */
  seededIds?: ReadonlyMap<string, string>;
}

/** What the planner consumes: a successfully parsed archive plus what salvage mode had to drop getting there. */
export interface ForeignImportSource {
  /** `parseImportArchive`'s `data`, already narrowed to non-null by the caller. */
  data: ProfileData;
  /** `parseImportArchive`'s `dropped` — folded into the report so one number covers the whole journey. */
  dropped: readonly ImportDrop[];
  /**
   * The archive's profile picture (`parseImportArchive`'s
   * `manifest.profile.picture`), or null when it carries none. The ONE manifest
   * fact this planner is told about, and only so it can be NAMED as skipped: an
   * import never adopts somebody else's picture (see `plan`'s own note), and a
   * skip nobody is told about is indistinguishable from a bug. Required rather
   * than optional, for the reason every `ProfileData` member is: a caller that
   * forgets it must be a type error, not a quiet omission.
   */
  profilePicture: ArchiveProfilePicture | null;
  /**
   * How many private notes and sealed-version checkpoints the archive carries
   * (`parseImportArchive`'s `privateNotes`, counted by the caller). COUNTS
   * only, deliberately: a foreign import NEVER imports private notes — that is
   * the whole posture (ADR-057 §6), stated once in `buildReport`'s own note —
   * so the planner needs nothing of their content, only the numbers its named
   * skip must say out loud. Required, on `profilePicture`'s exact terms.
   */
  privateNotes: { notes: number; versions: number };
}

/**
 * Why a row the archive carried is not in the plan. Either salvage mode could
 * not read it (an `ImportDropReason`) or this planner skips it BY DESIGN — the
 * archive's settings, the notification ledger, the dashboard, the source's own
 * Inbox row.
 */
export type ImportSkipCode =
  | ImportDropReason
  | "settings-not-imported"
  | "notifications-not-imported"
  | "dashboard-settings-not-imported"
  | "dashboard-sets-not-imported"
  | "dashboard-widgets-not-imported"
  | "study-settings-not-imported"
  | "calendar-settings-not-imported"
  | "profile-picture-not-imported"
  | "private-notes-not-imported"
  | "template-name-taken"
  | "source-inbox-collapsed"
  | "duplicate-of-existing"
  /** A FIN budget whose (category, currency) the target already limits — its own code rather than `template-name-taken`, because the collision is over a slot rather than a name and the sentence a user needs is a different one (migration 051). */
  | "budget-slot-taken";

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
  /**
   * Every duplicate group this plan DETECTED (ADR-051), in
   * `IMPORT_DUPLICATE_TYPES` order, groups with none omitted. Reported whichever
   * way each group's choice currently points — a group the user chose to import
   * still has to appear, or the screen would offer no way back to skipping it.
   *
   * A sibling of `skips` rather than part of it: a skip is a fact about what
   * this plan does, while a duplicate is a QUESTION the user can still answer
   * differently. `skips` already carries the answer's consequence, under
   * `duplicate-of-existing`.
   */
  duplicates: readonly ImportDuplicateGroup[];
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
  /** Event templates skipped for the same reason, against the CAL module's own name space (CAL-009). */
  skippedEventTemplateIds: Set<string>;
  /** Note templates skipped for the same reason, against the NOTE module's own name space (migration 015). */
  skippedNoteTemplateIds: Set<string>;
  /** Budgets skipped because the target already has a limit on that (category, currency) — see the `skippedFinBudgetIds` loop in `planForeignImport`. */
  skippedFinBudgetIds: Set<string>;
  /** The choices, with every unanswered group resolved to `"skip"` — see `resolveChoices`. */
  choices: Record<ImportDuplicateType, ImportDuplicateChoice>;
  /** How many rows each group DETECTED, whether or not the choice skipped them. */
  duplicates: Record<ImportDuplicateType, number>;
  /** Source ids the duplicate rule skipped: never minted, so pass 2 drops them and nothing can reference them. One set for all four groups — a skipped row is a skipped row, whichever table it came from. */
  duplicateSkipped: Set<string>;
  /** One entry per skipped duplicate row, saying where it counts. Grouped into report lines by `buildReport`'s own `note`, exactly as the parser's drops are. */
  duplicateSkips: { module: ArchiveModuleId; type: ArchiveRecordType }[];
}

/**
 * Every group's answer, with the unanswered ones resolved to `"skip"` (ADR-051).
 * Written as a loop over `IMPORT_DUPLICATE_TYPES` rather than a spread over the
 * caller's object, because a caller reaching this from the IPC boundary could
 * hand over a key whose value is literally `undefined`, and a spread would then
 * write that `undefined` straight over the default.
 */
function resolveChoices(
  choices: ImportDuplicateChoices | undefined,
): Record<ImportDuplicateType, ImportDuplicateChoice> {
  const resolved = {} as Record<ImportDuplicateType, ImportDuplicateChoice>;
  for (const type of IMPORT_DUPLICATE_TYPES) resolved[type] = choices?.[type] ?? "skip";
  return resolved;
}

/** Zero per duplicate group — the counterpart of `zeroPerModule` for the other axis the report counts along. */
function zeroPerDuplicateType(): Record<ImportDuplicateType, number> {
  return { event: 0, person: 0, document: 0, attachment: 0 };
}

/**
 * How one source collection is checked against the target (ADR-051): which
 * user-facing group its duplicates belong to, where a skipped row lands in the
 * per-module arithmetic, how a row's identity is composed, and which of the
 * target's indexes that identity is looked up in.
 *
 * A value rather than four arguments at each call site, so the five collections
 * that take this rule cannot drift in how they apply it.
 */
interface DuplicateRule<T> {
  duplicate: ImportDuplicateType;
  module: ArchiveModuleId;
  type: ArchiveRecordType;
  keyOf: (row: T) => string;
  index: (target: ForeignImportTarget) => ReadonlySet<string>;
}

const EVENT_DUPLICATES: DuplicateRule<{ id: string; title: string; startAt: string; allDay: boolean }> = {
  duplicate: "event",
  module: "calendar",
  type: "event",
  keyOf: eventDuplicateKey,
  index: (target) => target.eventKeys,
};

const PERSON_DUPLICATES: DuplicateRule<{ id: string; name: string; month: number; day: number }> = {
  duplicate: "person",
  module: "calendar",
  type: "person",
  keyOf: personDuplicateKey,
  index: (target) => target.personKeys,
};

const DOCUMENT_DUPLICATES: DuplicateRule<{ id: string; docType: string; label: string }> = {
  duplicate: "document",
  module: "calendar",
  type: "document",
  keyOf: documentDuplicateKey,
  index: (target) => target.documentKeys,
};

/** The three attachment tables' rule, which differs only in where a skip is counted — one group, one identity, three modules. */
function attachmentDuplicates(
  module: ArchiveModuleId,
  type: ArchiveRecordType,
): DuplicateRule<{ id: string; sha256: string }> {
  return {
    duplicate: "attachment",
    module,
    type,
    keyOf: (row) => row.sha256,
    index: (target) => target.attachmentHashes,
  };
}

/**
 * Mints one collection under the duplicate rule (ADR-051). A row whose identity
 * the target already holds is DETECTED either way — the preview shows the group
 * regardless of the current choice — and then either skipped (no id minted at
 * all, so pass 2 drops it and nothing can reference it) or minted exactly as it
 * would have been without the rule.
 *
 * Deliberately checked against the TARGET only, never against earlier SOURCE
 * rows: an archive that carries the same appointment twice is describing a
 * profile that has it twice, and collapsing the pair would be this planner
 * deciding something about somebody else's data that they did not ask.
 */
function mintUnlessDuplicate<T extends { id: string }>(
  rows: readonly T[],
  rule: DuplicateRule<T>,
  ctx: PlanContext,
): void {
  const index = rule.index(ctx.target);
  for (const row of rows) {
    if (!index.has(rule.keyOf(row))) {
      mint(row.id, ctx);
      continue;
    }
    ctx.duplicates[rule.duplicate] += 1;
    if (ctx.choices[rule.duplicate] === "import") {
      mint(row.id, ctx);
      continue;
    }
    ctx.duplicateSkipped.add(row.id);
    ctx.duplicateSkips.push({ module: rule.module, type: rule.type });
  }
}

/**
 * The one name-is-identity rule all three template modules share (ADR-043 §2): a
 * source template whose name the target already uses is not planned at all — no
 * row, no id mapping to leave behind — and neither is a second source template
 * that claims a name an earlier one just took. First writer wins within the
 * source, the target wins over both. Extracted so the three modules cannot
 * drift: they are the same decision about three tables, each under its own
 * `UNIQUE (profile_id, name)` (migrations 015, 027, 036) — and a template whose
 * name is taken is not a preference, it is a row the database would REFUSE,
 * taking the whole import down with it.
 */
function mintTemplates(
  sourceTemplates: readonly { id: string; name: string }[],
  targetNames: Iterable<string>,
  skipped: Set<string>,
  ctx: PlanContext,
): void {
  const taken = new Set(targetNames);
  for (const template of sourceTemplates) {
    if (taken.has(template.name)) {
      skipped.add(template.id);
      continue;
    }
    taken.add(template.name);
    mint(template.id, ctx);
  }
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
  // ADR-051: an attachment's identity is its BYTES, so a file the target
  // already holds is a duplicate the user may skip. The TASK it hangs off is
  // untouched either way — a file somebody already has is no reason to lose the
  // task that referenced it.
  taskAttachments: (data, ctx) =>
    mintUnlessDuplicate(data.taskAttachments, attachmentDuplicates("tasks", "task-attachment"), ctx),
  // A template's name is its identity and nothing references a task template
  // by id, so a name-taken row is simply not planned — see `mintTemplates`.
  taskTemplates: (data, ctx) =>
    mintTemplates(
      data.taskTemplates,
      ctx.target.taskTemplateNames,
      ctx.skippedTaskTemplateIds,
      ctx,
    ),
  // A dependency's identity is its (blocker, blocked) pair — both task ids,
  // both already minted.
  taskDependencies: NO_IDS,
  // Not imported (the remap literal plans an empty array): the dashboard
  // background and dim are the TARGET user's preferences, not the archive's.
  dashboardSettings: NO_IDS,
  // Not imported either (founder, 2026-07-31): the layout is the target user's
  // own arrangement of their tabla, exactly as the background above is, so an
  // import must not rearrange it. No row is planned, so no id is minted — and
  // nothing references a placement, so there is nothing to dangle.
  dashboardWidgets: NO_IDS,
  // Named boards inherit that posture whole (ADR-055): a set is nothing but an
  // arrangement's name, so importing one would import an arrangement. Nothing
  // that IS planned can reference one — the widgets above are planned empty —
  // so nothing dangles here either.
  dashboardSets: NO_IDS,
  // ADR-051: `(title, startAt, allDay)` is what the calendar itself treats as
  // "the same appointment", so an event the target already has is a duplicate.
  events: (data, ctx) => mintUnlessDuplicate(data.events, EVENT_DUPLICATES, ctx),
  // The same name-is-identity rule as the task templates above, against the CAL
  // module's own name space (CAL-009).
  eventTemplates: (data, ctx) =>
    mintTemplates(
      data.eventTemplates,
      ctx.target.eventTemplateNames,
      ctx.skippedEventTemplateIds,
      ctx,
    ),
  documents: (data, ctx) => mintUnlessDuplicate(data.documents, DOCUMENT_DUPLICATES, ctx),
  // A renewal has no identity of its own — it is a dated line in ITS document's
  // history (migration 019's foreign key). So it follows its document: when that
  // was skipped as a duplicate, keeping the renewal would be a row pointing at
  // nothing. Counted on its own report line, never folded into the document's,
  // because the arithmetic counts rows and these are rows.
  //
  // Declared AFTER `documents` on purpose: pass 1 walks this record in
  // declaration order, so the document's verdict is already known here.
  renewals: (data, ctx) => {
    for (const renewal of data.renewals) {
      if (ctx.duplicateSkipped.has(renewal.documentId)) {
        ctx.duplicateSkipped.add(renewal.id);
        ctx.duplicateSkips.push({ module: "calendar", type: "renewal" });
        continue;
      }
      mint(renewal.id, ctx);
    }
  },
  // ADR-051: `(name, month, day)` — the recurring day CAL-007 actually
  // celebrates. The year is out of the key; see `personDuplicateKey`.
  people: (data, ctx) => mintUnlessDuplicate(data.people, PERSON_DUPLICATES, ctx),
  // Not imported (the remap literal plans an empty array, ADR-054): the
  // semester dates are the TARGET user's own calendar anchor, keyed by their
  // profile alone — so there is no id of its own to mint.
  calendarSettings: NO_IDS,
  subjects: (data, ctx) => mintAll(data.subjects, ctx),
  subjectAttachments: (data, ctx) =>
    mintUnlessDuplicate(
      data.subjectAttachments,
      attachmentDuplicates("study", "subject-attachment"),
      ctx,
    ),
  // A link's identity is its (subject, note) pair — both ids already minted.
  subjectNoteLinks: NO_IDS,
  exams: (data, ctx) => mintAll(data.exams, ctx),
  decks: (data, ctx) => mintAll(data.decks, ctx),
  cards: (data, ctx) => mintAll(data.cards, ctx),
  reviewLog: (data, ctx) => mintAll(data.reviewLog, ctx),
  // A topic is the user's own curriculum work (ADR-063) — it imports
  // additively like a plan, its exam/deck references remapped in pass 2.
  examTopics: (data, ctx) => mintAll(data.examTopics, ctx),
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
  /**
   * A category ABSORBS by exact name, exactly as a tag does — and deliberately
   * NOT the template rule, which skips a source row whose name the target
   * holds.
   *
   * The two precedents differ in what a merge would cost. A template's name is
   * its identity AND it carries a payload, so absorbing one would have to
   * overwrite the target's content with the source's — which additive-only
   * forbids, hence the skip, and the skip is harmless because a template stands
   * alone: nothing else in the archive points at it. A category is the opposite
   * on both counts. It carries no content to overwrite — a name and a swatch —
   * and things DO point at it: every note that named it. Skipping would strand
   * them uncategorized in a profile that has that very category on screen.
   *
   * Absorbing costs exactly one thing: the source category's colour, which is
   * decoration on a row the target already made and already coloured. Nothing
   * pre-existing is modified, so the additive-only rule is kept as literally as
   * it is for tags. And minting a fresh row is not even available as an option
   * — migration 049's `UNIQUE (profile_id, name)` is the same index that makes
   * two same-named tags impossible, so the insert would simply fail. Exact
   * string equality, like the tags: „Sastanak" and „sastanak" ARE two
   * categories in the store, and folding them here would merge rows the app
   * itself considers distinct.
   */
  noteCategories: (data, ctx) =>
    mintTags(data.noteCategories, ctx.target.noteCategories, "notes", ctx),
  /**
   * An ACCOUNT is minted, always — never absorbed by name, and never skipped.
   *
   * The three precedents each answer a different question, and this table's
   * answer is the one they were narrowing towards. A tag absorbs because a tag
   * IS its name and a `(profile_id, name)` index makes a second copy impossible.
   * A template is skipped because its name is its identity AND it carries a
   * payload, so absorbing would mean overwriting. An account is neither: two
   * accounts called „Tekući" in two different profiles are routinely two
   * different accounts at two different banks — exactly the „Kupovina"/„Ideje"
   * case `ImportDuplicateType`'s own comment refuses to guess about — and
   * migration 051 puts no uniqueness on an account's name at all, so nothing
   * even forces the question. Merging two people's bank accounts because they
   * chose the same word would be the single most damaging guess this planner
   * could make, and it is not available: every account imports as its own row,
   * carrying its own opening balance and its own currency.
   */
  finAccounts: (data, ctx) => mintAll(data.finAccounts, ctx),
  /**
   * A CATEGORY absorbs by the exact `(kind, name)` PAIR — the tag rule, applied
   * to this table's actual identity (migration 051's
   * `UNIQUE (profile_id, kind, name)`), and deliberately NOT the template rule.
   *
   * ADR-072's argument for note categories transfers whole: a category carries
   * no content to overwrite (a name and a kind), and things DO point at it —
   * every transaction filed under it, and its budget. Skipping would strand
   * them uncategorized in a profile that has that very category on screen.
   * Minting a fresh row is not even available: the UNIQUE index would refuse the
   * insert. What differs from note categories is only the KEY, and the pair is
   * what stops a genuine hazard: „Pokloni" as an EXPENSE in the source and as
   * INCOME in the target are two different categories, and folding them would
   * silently re-file money under a label that means the opposite. Exact string
   * equality, like the tags: „Hrana" and „hrana" ARE two categories in the
   * store, and folding them here would merge rows the app considers distinct.
   */
  finCategories: (data, ctx) =>
    mintPairedTags(
      data.finCategories,
      ctx.target.finCategories,
      (row) => `${row.kind} ${row.name}`,
      "finance",
      ctx,
    ),
  // Minted like any other content row: a transaction is an event that happened,
  // never a duplicate of somebody else's (ADR-051's certainty gate — no tuple of
  // date, payee and amount is a fact the user could check at a glance and be
  // right about, since two identical coffees on one day are two coffees).
  finTransactions: (data, ctx) => mintAll(data.finTransactions, ctx),
  // A budget is minted too, but its ROW may still not survive: an allowance for
  // a category the target already had would collide on migration 051's
  // `UNIQUE (profile_id, category_id, currency)`, so the remap below drops it —
  // the target's own limit wins, which is `taskTemplateNames`' rule applied to
  // the one FIN table where a merge could overwrite something.
  finBudgets: (data, ctx) => mintAll(data.finBudgets, ctx),
  noteTagLinks: NO_IDS,
  // The same name-is-identity rule as the two template tables above, against the
  // NOTE module's own name space (migration 015's `UNIQUE (profile_id, name)`).
  // The same name-is-identity rule as the two template tables above, against the
  // NOTE module's own name space (migration 015's `UNIQUE (profile_id, name)`).
  noteTemplates: (data, ctx) =>
    mintTemplates(
      data.noteTemplates,
      ctx.target.noteTemplateNames,
      ctx.skippedNoteTemplateIds,
      ctx,
    ),
  noteAttachments: (data, ctx) =>
    mintUnlessDuplicate(data.noteAttachments, attachmentDuplicates("notes", "note-attachment"), ctx),
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
 * The ONE place a NAME is treated as an identity (ADR-043) — the three tables
 * whose rows are nothing but a name: note tags, task tags and note categories.
 * A source row whose name exactly matches one the target already has resolves
 * onto the target's id and produces no row of its own; two source rows of the
 * same name collapse onto one, for the same reason the stores'
 * `(profile_id, name)` unique index exists — inserting both would simply fail.
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
 * `mintTags` for a table whose identity is a COMPOSITE, not a bare name — today
 * only FIN categories, whose uniqueness is `(profile_id, kind, name)`. Same
 * absorb-or-mint rule, same exact-string comparison, keyed by whatever `keyOf`
 * composes; the two functions are separate rather than one generic over an
 * optional key because `ForeignImportTargetTag`'s `{id, name}` shape IS the
 * contract three callers already speak, and widening it would make every one of
 * them carry a field they have no value for.
 */
function mintPairedTags<T extends { id: string }>(
  sourceRows: readonly T[],
  targetRows: readonly T[],
  keyOf: (row: T) => string,
  module: ArchiveModuleId,
  ctx: PlanContext,
): void {
  const byKey = new Map<string, string>();
  for (const row of targetRows) {
    const key = keyOf(row);
    if (!byKey.has(key)) byKey.set(key, row.id);
  }
  for (const row of sourceRows) {
    const key = keyOf(row);
    const existing = byKey.get(key);
    if (existing !== undefined) {
      ctx.ids.set(row.id, existing);
      ctx.absorbed.add(row.id);
      ctx.merged[module] += 1;
      continue;
    }
    byKey.set(key, mint(row.id, ctx));
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

/**
 * A note folder's default template (migration 028 / ADR-036) — the ONE reference
 * in this planner that must tolerate an id the map cannot answer, and the reason
 * it exists: `mapped` used to be called here and THREW, which took down the
 * whole preview of any archive whose folder had a built-in default.
 *
 * The column deliberately carries no foreign key, because it holds either a
 * `note_templates` id or a `builtin:` CODE constant. A built-in names the same
 * template in every profile, so it crosses unchanged. Anything else the map
 * cannot answer is a SOURCE id — a template the archive did not carry, or one
 * the name rule skipped in favour of the target's — and it becomes null:
 * ADR-036 already reads a dangling default as "no template", and null says that
 * without leaving a foreign profile's id in this profile's column.
 */
function mappedTemplateOrNone(oldId: string | null, ctx: PlanContext): string | null {
  if (oldId === null) return null;
  const next = ctx.ids.get(oldId);
  if (next !== undefined) return next;
  return isBuiltinNoteTemplateId(oldId) ? oldId : null;
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

/** Drops the rows the duplicate rule skipped (ADR-051) — unlike an absorbed row, these resolve onto NOTHING: they were never minted, so they are not references either. */
function notDuplicate<T extends { id: string }>(rows: readonly T[], ctx: PlanContext): readonly T[] {
  return rows.filter((row) => !ctx.duplicateSkipped.has(row.id));
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
 *
 * `choices` is the user's answer to the duplicate groups this planner detects
 * (ADR-051), and every unanswered group defaults to `"skip"` — the safe
 * direction, and the one the card's own promise („uvoz ništa ne briše") makes
 * least surprising: a file, an appointment, a birthday or a document the user
 * already has does not arrive a second time unless they say so. Nothing here
 * ever UPDATES a row the target already has, under either choice; „uvezi
 * svejedno" plans a second, independent row, exactly as it would for any other
 * source row.
 */
export function planForeignImport(
  parsed: ForeignImportSource,
  target: ForeignImportTarget,
  mintId: () => string,
  choices?: ImportDuplicateChoices,
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
    skippedEventTemplateIds: new Set(),
    skippedNoteTemplateIds: new Set(),
    skippedFinBudgetIds: new Set(),
    choices: resolveChoices(choices),
    duplicates: zeroPerDuplicateType(),
    duplicateSkipped: new Set(),
    duplicateSkips: [],
  };

  // Pass 0 (ADR-052): the answers the CALLER already knows. Seeded before pass 1
  // so `mint` finds them and returns without spending a minted id, and absorbed
  // so any row carrying one is dropped instead of inserted a second time under
  // the target's own id — a seeded entry says "this row is already here".
  for (const [sourceId, targetId] of target.seededIds ?? []) {
    ctx.ids.set(sourceId, targetId);
    ctx.absorbed.add(sourceId);
  }

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

  // A source allowance whose category was ABSORBED onto a target category that
  // already budgets that currency has nowhere to go: migration 051's
  // `UNIQUE (profile_id, category_id, currency)` would refuse the insert, and a
  // foreign import never updates a pre-existing row (ADR-043 §4). So the
  // target's own limit wins and the source's is skipped, named in the report —
  // `taskTemplateNames`' rule, applied to the one FIN table where a merge could
  // overwrite something the target chose.
  //
  // Computed here rather than in `ID_MINTERS` because it needs the MINTED
  // category id, which pass 1 is only just finishing; the budget's own id was
  // minted there and simply goes unused, exactly as a skipped template's does.
  for (const budget of source.finBudgets) {
    const key = finBudgetKey({
      categoryId: mapped(budget.categoryId, ctx),
      currency: budget.currency,
    });
    if (target.finBudgetKeys.has(key)) ctx.skippedFinBudgetIds.add(budget.id);
  }

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
    taskAttachments: notDuplicate(source.taskAttachments, ctx).map((row) => ({
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
    events: notDuplicate(source.events, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    eventTemplates: source.eventTemplates
      .filter((row) => !ctx.skippedEventTemplateIds.has(row.id))
      .map((row) => ({
        ...row,
        id: mapped(row.id, ctx),
        profileId: target.profileId,
        // The payload names no row at all (CAL-009: a time of day, a length, a
        // rule), so nothing inside it needs the id map.
      })),
    documents: notDuplicate(source.documents, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    renewals: notDuplicate(source.renewals, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      documentId: mapped(row.documentId, ctx),
    })),
    people: notDuplicate(source.people, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    // ADR-054's semester dates are NOT imported, for the reason the study
    // preferences are not: the term the calendar is anchored to is the TARGET
    // user's own choice, keyed by their profile alone — and the import card
    // promises DODAJE, which an upsert over their row would break. The skip is
    // named below, like every by-design skip.
    calendarSettings: [],
    // `notAbsorbed` here, unlike on every other STUDY member, because this is
    // the one table a seeded id can name (ADR-052): a subject the user chose is
    // a subject that already exists, so its source row is a reference now, not
    // a row. An ordinary archive import absorbs no subject, so this filter is a
    // no-op for it.
    subjects: notAbsorbed(source.subjects, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    subjectAttachments: notDuplicate(source.subjectAttachments, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      subjectId: mapped(row.subjectId, ctx),
      // `sha256` is content addressing, exactly as on the other two attachment
      // tables: the same bytes are the same blob in any profile.
    })),
    subjectNoteLinks: source.subjectNoteLinks.map((row) => ({
      ...row,
      subjectId: mapped(row.subjectId, ctx),
      noteId: mapped(row.noteId, ctx),
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
    examTopics: source.examTopics.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      examId: mapped(row.examId, ctx),
      deckId: mappedOrNull(row.deckId, ctx),
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
      // Optional in the interchange; always spelled here so a topic-carrying
      // block never crosses with the SOURCE profile's topic id in it.
      topicId: mappedOrNull(row.topicId ?? null, ctx),
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
      // Remapped exactly as `folderId` is — and, when the category was absorbed
      // by name, this is what lands the note on the TARGET's own row rather
      // than on a second copy of it (see `ID_MINTERS.noteCategories`).
      categoryId: mappedOrNull(row.categoryId, ctx),
      cardDeckId: mappedOrNull(row.cardDeckId, ctx),
      snapshot: row.snapshot === null ? null : mappedState(row.snapshot, ctx),
    })),
    noteFolders: source.noteFolders.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      parentId: mappedOrNull(row.parentId, ctx),
      // Tolerant, unlike every other reference here — see `mappedTemplateOrNone`.
      defaultTemplateId: mappedTemplateOrNone(row.defaultTemplateId, ctx),
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
    // The tags' own treatment, one axis over: an absorbed category is a
    // reference now, not a row, so it is dropped from the plan and every note
    // that named it points at the target's.
    noteCategories: notAbsorbed(source.noteCategories, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    noteTagLinks: noteTagLinks.rows,
    noteTemplates: source.noteTemplates
      .filter((row) => !ctx.skippedNoteTemplateIds.has(row.id))
      .map((row) => ({
        ...row,
        id: mapped(row.id, ctx),
        profileId: target.profileId,
      })),
    noteAttachments: notDuplicate(source.noteAttachments, ctx).map((row) => ({
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
    // Nor its boards (ADR-055): a named tabla is an arrangement with a name,
    // and both stay the target's own — skipped by design, named below.
    dashboardSets: [],
    // Nor rearrange it (founder, 2026-07-31): the layout stays the target's
    // own, so the archive's placements are skipped by design — named below,
    // like every other by-design skip.
    dashboardWidgets: [],
    // --- FIN (migration 051) ----------------------------------------------
    // Every account imports as its own row: nothing here absorbs one, so there
    // is nothing to filter (see `ID_MINTERS.finAccounts`).
    finAccounts: source.finAccounts.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    // The tags' own treatment, keyed by the (kind, name) pair: an absorbed
    // category is a reference now, not a row, so it is dropped from the plan and
    // every transaction that named it points at the target's.
    finCategories: notAbsorbed(source.finCategories, ctx).map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
    })),
    finTransactions: source.finTransactions.map((row) => ({
      ...row,
      id: mapped(row.id, ctx),
      profileId: target.profileId,
      accountId: mapped(row.accountId, ctx),
      // A transfer's other side, remapped exactly as the first side is — which
      // is the whole payoff of one row: there is no second row that could be
      // remapped differently, so the two halves cannot come apart in transit.
      counterAccountId: mappedOrNull(row.counterAccountId, ctx),
      // Remapped like a note's category, and when the category was absorbed by
      // its (kind, name) pair this is what lands the transaction on the TARGET's
      // own row rather than on a second copy of it.
      categoryId: mappedOrNull(row.categoryId, ctx),
    })),
    // Dropped when the target already budgets that (category, currency) slot:
    // the category was absorbed onto a row that has its own limit, and a foreign
    // import never updates a pre-existing row (ADR-043 §4). Named in the report
    // below like every other by-design skip.
    finBudgets: source.finBudgets
      .filter((row) => !ctx.skippedFinBudgetIds.has(row.id))
      .map((row) => ({
        ...row,
        id: mapped(row.id, ctx),
        profileId: target.profileId,
        categoryId: mapped(row.categoryId, ctx),
      })),
  };

  return {
    data,
    blobNames: new Set([
      ...data.noteAttachments.map((row) => row.sha256),
      ...data.taskAttachments.map((row) => row.sha256),
      ...data.subjectAttachments.map((row) => row.sha256),
    ]),
    // The profile picture is deliberately NOT among the blobs to copy: an
    // import never adopts it (see `buildReport`'s own note), so there is no
    // hash to fetch — the same reason the dashboard background is absent here.
    // Nor is any `private-blobs/<id>` entry: private notes never import at all
    // (ADR-057 §6, named in the report below), so their files never do either.
    report: buildReport(source, parsed.dropped, data, ctx, parsed.profilePicture, parsed.privateNotes),
  };
}

function zeroPerModule(): Record<ArchiveModuleId, number> {
  return { tasks: 0, calendar: 0, study: 0, notifications: 0, notes: 0, dashboard: 0, finance: 0 };
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
  profilePicture: ArchiveProfilePicture | null,
  privateNotes: { notes: number; versions: number },
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
  // The same code against the CAL module: `note` groups by (code, module, type),
  // so the two modules' skips stay two named, separately-counted lines rather
  // than one number nobody can act on.
  note("template-name-taken", "calendar", "event-template", ctx.skippedEventTemplateIds.size);
  // And the NOTE module's own name space (migration 015) — a third separately
  // counted line, for the reason the calendar one is a second.
  note("template-name-taken", "notes", "note-template", ctx.skippedNoteTemplateIds.size);
  // The FIN equivalent, under its own code: the target already limits that
  // (category, currency), and a foreign import never updates a pre-existing row.
  note("budget-slot-taken", "finance", "fin-budget", ctx.skippedFinBudgetIds.size);
  // ADR-051: one entry per skipped duplicate ROW, grouped by `note` into a line
  // per (module, record type) — the parser's drops are folded in exactly this
  // way just above, and for the same reason: the arithmetic is per module, so
  // the reasons have to be too.
  for (const skip of ctx.duplicateSkips) note("duplicate-of-existing", skip.module, skip.type, 1);
  note("notifications-not-imported", "notifications", "notification", source.notifications.length);
  note(
    "dashboard-settings-not-imported",
    "dashboard",
    "dashboard-settings",
    source.dashboardSettings.length,
  );
  // Its own code and line rather than a fold into the widgets' (ADR-055): a
  // skip line reports one (code, module, type) triple, and set rows are a
  // different record type — one line covering both would attribute them to the
  // widget type, which is a report that lies. The per-module arithmetic
  // balances either way; this is what keeps the REASONS per-type true.
  note("dashboard-sets-not-imported", "dashboard", "dashboard-set", source.dashboardSets.length);
  note(
    "dashboard-widgets-not-imported",
    "dashboard",
    "dashboard-widget",
    source.dashboardWidgets.length,
  );
  note("study-settings-not-imported", "study", "study-settings", source.studySettings.length);
  note(
    "calendar-settings-not-imported",
    "calendar",
    "calendar-settings",
    source.calendarSettings.length,
  );
  // The manifest's settings section — the target's flags and notification
  // preferences are the user's own choices, not the archive author's. It rides
  // in the manifest rather than in a module, so it is named without being
  // counted into one.
  note("settings-not-imported", null, null, 1);
  // The archive's profile picture (SET-001), on the dashboard background's exact
  // terms: a face is the most personal decoration a profile has, and an import
  // that quietly made the user look like the archive's author would be the
  // sharpest possible version of the mistake ADR-043 §2 forbids. Named only when
  // the archive actually carries one — unlike the settings section above, which
  // every manifest has — and, like it, counted into no module, because it
  // belongs to none.
  note("profile-picture-not-imported", null, null, profilePicture === null ? 0 : 1);
  // Private notes: NEVER imported, whatever the archive carries (ADR-057 §6).
  // The posture, in full: a foreign import merges somebody else's rows into a
  // profile that keeps its own — and a private note is the one kind of row
  // whose whole meaning is WHO may read it. Re-sealing another person's
  // decrypted secrets under this profile's key would silently move them across
  // a trust boundary no checkbox here is entitled to cross, so the rows are
  // named and counted, never planned. Two lines, one per record type, on the
  // dashboard sets' reasoning — one line covering both would attribute the
  // versions to the note type, which is a report that lies. Counted into no
  // module, because the private section belongs to none (its file maps to null
  // in `MODULE_OF_DATA_FILE`), which is also what keeps the per-module
  // arithmetic balanced without it.
  note("private-notes-not-imported", null, "private-note", privateNotes.notes);
  note("private-notes-not-imported", null, "private-note-version", privateNotes.versions);

  const parsedCounts = countProfileModules(source);
  const importedCounts = countProfileModules(planned);
  const droppedCounts = zeroPerModule();
  for (const drop of dropped) {
    // A drop from `data/private-notes.ndjson` carries no module (ADR-057 §6) —
    // it was already named in `skips` by the loop above, and there is no
    // per-module bucket for it to count into.
    if (drop.module !== null) droppedCounts[drop.module] += 1;
  }

  const modules = {} as Record<ArchiveModuleId, ImportModuleCounts>;
  for (const module of ARCHIVE_MODULE_IDS) {
    modules[module] = {
      parsed: parsedCounts[module] + droppedCounts[module],
      imported: importedCounts[module],
      merged: ctx.merged[module],
      skipped: skipped[module],
    };
  }

  const duplicates = IMPORT_DUPLICATE_TYPES.filter((type) => ctx.duplicates[type] > 0).map(
    (type): ImportDuplicateGroup => ({ type, count: ctx.duplicates[type] }),
  );

  return { modules, skips, duplicates };
}
