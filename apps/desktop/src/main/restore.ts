import { createHash, randomBytes } from "node:crypto";
import { basename } from "node:path";
import {
  countProfileModules,
  documentDuplicateKey,
  eventDuplicateKey,
  finBudgetKey,
  parseCsv,
  parseIcsCalendar,
  parseImportArchive,
  parseLlmAnswer,
  personDuplicateKey,
  planForeignImport,
  sniffCsvDelimiter,
  sniffCsvHeader,
  suggestCsvFinanceMapping,
  suggestCsvMapping,
  translateApkg,
  translateCsvFinance,
  translateCsvTasks,
  translateIcsEvents,
  translateLlmRecords,
  type ApkgSkip as CoreApkgSkip,
  type CsvColumnRole as CoreCsvColumnRole,
  type CsvFinanceColumnRole as CoreCsvFinanceColumnRole,
  type CsvFinanceReport,
  type CsvFinanceSignConvention,
  type CsvListChoice,
  type CsvTranslateReport,
  type ApkgSubjectChoice,
  type ArchiveProfileKind,
  type ArchiveProfilePicture,
  type ExportSettings,
  type ForeignImportPlan,
  type ForeignImportTarget,
  type IcsImportSkip as CoreIcsImportSkip,
  type IcsParsedCalendar,
  type IcsSkippedComponent as CoreIcsSkippedComponent,
  type ImportDuplicateChoices as CoreImportDuplicateChoices,
  type ImportDuplicateGroup as CoreImportDuplicateGroup,
  type ImportPlanReport as CoreImportPlanReport,
  type ImportSkipReason as CoreImportSkipReason,
  type ExportPrivateNotes,
  type ImportProblem,
  type LlmAnswerReport,
  type LlmDeckChoice,
  type LlmRecords,
  type LlmSkippedRecord,
  type ParsedApkg,
  type ProfileData,
  type ExportModuleData,
} from "@nexus/core";
import { uuidv7 } from "@nexus/db";
import type {
  ForeignImportStore,
  PrivateNoteStore,
  RestoredNoteDerived,
  RestoredPrivateRows,
  RestoreStore,
} from "@nexus/db";

import { ApkgReadError, readApkg } from "./apkgReader.js";
import { ArchiveReadError, inspectArchiveFile, openArchive, type OpenedArchive } from "./archiveReader.js";
import { CsvReadError, readCsvText } from "./csvReader.js";
import { IcsReadError, readIcsText } from "./icsReader.js";
import { ModuleImportError, type ModuleImportBlob } from "./moduleIpc.js";
import { cancelIdleCompactions } from "./notes.js";
import type { PrivResealOutcome } from "./priv.js";
import {
  deriveRestoredNotes,
  gatherPrivateSealedRows,
  gatherProfileData,
  gatherProfileSettings,
  type ProfileDataDeps,
} from "./profileData.js";
import type {
  ApkgImportApplyResult,
  ApkgImportPickResult,
  ApkgImportPreview,
  ApkgImportPreviewResult,
  ApkgImportSkip,
  ApkgImportSkipCode,
  ApkgImportSubjectChoice,
  ArchiveModuleName,
  CsvImportApplyResult,
  CsvImportColumn,
  CsvImportColumnRole,
  CsvImportDelimiter,
  CsvImportListChoice,
  CsvImportMapResult,
  CsvImportPickResult,
  CsvImportPlanPreview,
  CsvImportPreviewResult,
  CsvImportReadErrorCode,
  CsvImportRowDrop,
  FinCsvImportApplyResult,
  FinCsvImportColumn,
  FinCsvImportColumnRole,
  FinCsvImportMapResult,
  FinCsvImportPlanPreview,
  FinCsvImportPreviewResult,
  FinCsvImportRefusal,
  FinCsvImportRowDrop,
  FinCsvImportRowSkip,
  FinCsvImportSignConvention,
  IcsImportApplyResult,
  IcsImportPickResult,
  IcsImportPreview,
  IcsImportPreviewResult,
  IcsImportReadErrorCode,
  IcsImportSkip,
  IcsImportSkipCode,
  IcsImportSkippedComponent,
  ImportApplyResult,
  ImportDuplicateChoices,
  ImportDuplicateGroup,
  ImportDuplicateType,
  ImportPickResult,
  ImportPlanReport,
  ImportPreview,
  ImportPreviewResult,
  ImportRecordType,
  ImportSkipCode,
  ImportSkipReason,
  LlmImportAnswerProblem,
  LlmImportApplyResult,
  LlmImportDeckChoice,
  LlmImportKind,
  LlmImportPreview,
  LlmImportPreviewResult,
  LlmImportSkip,
  LlmImportSkipReason,
  RestoreApplyResult,
  RestorePickResult,
  RestorePreview,
  RestorePreviewResult,
  RestoreProblem,
  RestoreProblemCode,
  RestoreStatus,
  RestoreUndoResult,
} from "../shared/ipc.js";
import { CSV_IMPORT_MAX_COLUMNS, CSV_IMPORT_SAMPLE_ROWS } from "../shared/ipc.js";

/**
 * The orchestrator for every way a FILE can enter a profile: IMEX RESTORE
 * (ADR-023, slice 3c), which replaces a profile preserving ids; FOREIGN IMPORT
 * (ADR-043), which merges an archive into a profile that already has data; the
 * ANKI `.apkg` IMPORT (ADR-052), which merges somebody else's flashcard
 * collection into it; and the CALENDAR `.ics` IMPORT (ADR-061), which merges a
 * calendar file's events into it. Each is the seam between an untrusted-input
 * reader (`archiveReader.ts`, `apkgReader.ts` or `icsReader.ts`), the pure
 * validator/planner (`@nexus/core`'s `parseImportArchive` / `translateApkg` /
 * `parseIcsCalendar`, and, for every import, `planForeignImport`), and the
 * write (`@nexus/db`'s `RestoreStore.replaceProfileData` or
 * `ForeignImportStore.insertPlanned`).
 * Nothing here parses a byte of file content itself and nothing here writes SQL
 * itself — this module's whole job is sequencing those pieces the way each
 * operation's safety model requires: a preview that is a real dry run rather
 * than an estimate, and a one-step undo that needs no storage design of its own.
 *
 * The three live in ONE module, and deliberately so: they share the undo slot.
 * `undo` below is a single whole-profile snapshot covering whichever operation
 * ran last, which is what makes "the same banner just works" true and what
 * makes "one slot" a fact of this file's shape rather than a convention three
 * modules would have to keep. Everything else about them is kept APART — their
 * own picks, their own channels, their own tokens — so that no call on one
 * surface can ever trigger another's semantics.
 *
 * Deliberately Electron-free — no `import "electron"`, directly or
 * transitively — exactly like `archiveReader.ts` and `profileData.ts`: the
 * native open dialog and the renderer reload are both injected through
 * `RestoreDeps` rather than reached for, which is what lets this whole
 * pipeline be exercised under plain Node/Vitest. Wiring the two new IPC
 * channels this will eventually need is the next slice's job, not this one's.
 *
 * One piece of state per surface plus the shared undo live at module scope,
 * and nothing else:
 *
 * - `pending`: the archive file the user picked, and — once a preview has
 *   succeeded — the full parse result that preview reported, plus the
 *   `OpenedArchive` itself, held OPEN between preview and apply. This is what
 *   makes "the preview is a dry run of the real parse, not an estimate" true:
 *   confirming writes exactly the bytes the user already saw, nothing is
 *   re-read or re-validated, and an attachment blob streams from the SAME
 *   file handle the preview opened rather than paying to reopen the archive
 *   (and, for an encrypted one, to re-run Argon2id) a second time.
 * - `pendingImport`: the same, for the archive picked to be MERGED in.
 * - `pendingApkg`: the Anki file picked, plus the collection a preview read out
 *   of it. No handle is held here — `readApkg` closes the file before it
 *   returns — but the collection IS, so that previewing again under a different
 *   subject costs a re-translate and a re-plan rather than a second read.
 * - `pendingIcs`: the calendar file picked, plus the PARSED events a preview
 *   read out of it — never the file's raw text, which is dropped the moment
 *   the parse returns. Re-previewing under the other duplicate answer then
 *   costs a re-plan, never a second read.
 * - `pendingLlm`: the plan a pasted LLM answer produced (IMEX-005), with the
 *   parsed records a re-plan re-uses — never the paste itself.
 * - `undo`: the pre-restore snapshot of the last COMPLETED restore, gathered
 *   with the exact same `gatherProfileData`/`gatherProfileSettings` the
 *   exporter itself gathers with (`profileData.ts`), so the undo snapshot and
 *   an ordinary export are provably the same shape. This holds a WHOLE
 *   profile in main-process memory — every note's Yjs bytes included — until
 *   the app quits or locks (`clearRestoreState`). That memory cost is the
 *   accepted price of a one-click undo that needs no storage design, retention
 *   policy, or on-disk format of its own.
 *
 * All four are wiped on lock (`clearRestoreState`), because any one of them
 * surviving a lock would mean holding decrypted archive bytes, somebody else's
 * whole collection, or a whole profile's plaintext, past the moment the user
 * asked this session's key material to be dropped.
 */

/**
 * The exact archive one flow's user picked, plus its parse once that flow's
 * preview has succeeded. Generic in what "ready" means, because the pick itself
 * is identical for both — the same dialog, the same magic-bytes peek — and only
 * what a successful preview PRODUCES differs.
 */
interface PickedArchive<TReady extends { archive: OpenedArchive }> {
  filePath: string;
  fileName: string;
  encrypted: boolean;
  ready: TReady | null;
}

type PendingRestore = PickedArchive<ReadyRestore>;
type PendingImport = PickedArchive<ReadyImport>;

/**
 * One successful preview's full parse result, held exactly as `applyRestore`
 * needs it: the still-open archive (so its blobs can stream straight into
 * `saveBlob` without a second open), the manifest's own declared profile name
 * and settings (what a restore actually writes — never the CALLER's current
 * profile name), and the token that proves an apply call is confirming THIS
 * parse and not a stale one from before a re-preview.
 */
interface ReadyRestore {
  archive: OpenedArchive;
  token: string;
  /** The profile this preview was computed against — `applyRestore` refuses any other, mirroring the token check. */
  profileId: string;
  profileName: string;
  /** The archive's own profile picture (SET-001), or null when it carries none — held beside the name because a restore writes the two together. */
  profilePicture: ArchiveProfilePicture | null;
  settings: ExportSettings;
  data: ProfileData;
  /** The archive's private notes (ADR-057 §6), beside `data` exactly as the parser answers them — empty when it carries none, which is also every pre-1.23 archive. */
  privateNotes: ExportPrivateNotes;
}

/**
 * One successful import preview's plan, held exactly as `applyImport` needs it:
 * the still-open archive (so its blobs can stream straight into `saveBlob`
 * without a second open), the plan itself — already remapped, stamped and
 * counted, so applying writes precisely what the user was shown — and the token
 * that proves an apply call is confirming THIS plan and not a stale one.
 *
 * The plan, not the parse: a foreign import's answer depends on the TARGET as
 * much as on the archive (which tags merge, which templates lose their name,
 * which Inbox the tasks land in), so re-planning at apply time against a profile
 * that may have changed would be a different answer than the one confirmed.
 */
interface ReadyImport {
  archive: OpenedArchive;
  token: string;
  /** The profile this plan was computed against — `applyImport` refuses any other, mirroring the token check. */
  profileId: string;
  plan: ForeignImportPlan;
}

/**
 * The pre-operation snapshot of the one archive operation currently undoable,
 * plus what applying it needs to know for undo's own bookkeeping. ONE slot for
 * both a restore and an import (ADR-043 section 4): an import is undone by
 * replaying the profile as it was BEFORE it, which is the same whole-profile
 * replace a restore's undo already is — so an undone import vanishes entirely,
 * every minted id with it.
 */
interface RestoreUndo {
  /** Which operation this snapshot was taken for — carried onto the wire so the banner can name what it is offering to undo. */
  kind: "restore" | "import" | "apkg" | "llm" | "csv" | "fin-csv" | "ics";
  profileId: string;
  snapshot: {
    profileName: string;
    /** The picture the profile wore before the operation — undone alongside its name, because a restore replaced both. */
    profilePicture: ArchiveProfilePicture | null;
    settings: ExportSettings;
    data: ProfileData;
    derived: ReadonlyMap<string, RestoredNoteDerived>;
  };
  /**
   * The private tables' pre-operation SEALED rows, verbatim (ADR-057 §6) —
   * captured OUTSIDE `ProfileData`, and non-null exactly when the operation
   * replaced those tables. Bytes rather than envelopes on purpose: undoing a
   * restore must not need the PRIV DEK, because the section may well have
   * locked between the apply and the undo click. Null means the operation left
   * the tables untouched, so undo leaves them untouched too — clobbering
   * sealed rows the operation never wrote would make undo itself the data
   * loss.
   */
  privateSealed: RestoredPrivateRows | null;
  /** The fresh sealed private-blob files the restore's re-seal wrote — removed (best-effort, no refcount: the ids are random and never shared) when undone. */
  addedPrivateBlobs: readonly string[];
  /** Every blob hash `applyRestore` actually wrote (`saveBlob`'s `created: true`) — the only ones undo may ever remove. */
  addedBlobs: readonly string[];
  appliedAt: string;
  summary: RestoreApplyResult;
}

/**
 * Everything `restore.ts` needs beyond a full profile read (`ProfileDataDeps`,
 * shared with the exporter and with undo's own snapshot — see the module
 * header). The native dialog and the renderer reload are injected for the
 * same reason `ImexExportDeps` injects its window getter: this module must
 * never import `electron`, directly or transitively.
 */
export interface RestoreDeps extends ProfileDataDeps {
  restoreStore(profileId: string): RestoreStore;
  /**
   * The target profile row, so a preview can name what is being overwritten and
   * an undo snapshot can put its identity back. `picture` rides along with the
   * name for that second reason: a restore replaces the profile row's own facts
   * too, so an undo that restored only the name would leave the target wearing
   * the archive's face. `kind` rides along for the preview's own gate (ADR-058):
   * a restore archive fits only its own KIND of profile.
   */
  getProfile(profileId: string): {
    id: string;
    name: string;
    kind: ArchiveProfileKind;
    picture: ArchiveProfilePicture | null;
  };
  /** The native open dialog: resolves the chosen path, or null when the user canceled. Injected so this module never imports electron — main owns the dialog, exactly as it does for export. */
  pickArchiveFile(): Promise<string | null>;
  /** The same dialog with the `.apkg` filter (ADR-052). Its own injection, not a parameter on the one above, so no call on the archive surface can ever open the Anki picker or the reverse. */
  pickApkgFile(): Promise<string | null>;
  /** And with the `.csv`/`.txt` filter (ADR-062), on the same terms: its own injection, so no surface can open another's dialog. */
  pickCsvFile(): Promise<string | null>;
  /** The same filter again for a BANK STATEMENT (FIN slice e) — its own injection, not a parameter on the one above, so no call on the task surface can ever open the ledger's picker or the reverse. */
  pickFinCsvFile(): Promise<string | null>;
  /** The same dialog with the `.ics` filter (ADR-061), its own injection on the same terms: no surface can open another's picker. */
  pickIcsFile(): Promise<string | null>;
  /** Reloads the renderer once a restore or an undo has landed. */
  reloadRenderer(): void;
  /** Discards this profile's in-memory focus timer. */
  cancelFocusSession(profileId: string): void;
  saveBlob(bytes: Uint8Array): Promise<{ sha256: string; created: boolean }>;
  /**
   * How many attachment rows — across EVERY table that names a blob, and every
   * profile — still hold this hash. Injected rather than read off one store,
   * because "which tables reference a blob" is one fact that must live in one
   * place (`main/index.ts`'s `blobRefCount`): an undo that counted only the
   * note table would delete a file a restored TASK attachment still points at.
   */
  blobRefCount(profileId: string, sha256: string): number;
  deleteBlobIfOrphaned(sha256: string, refCount: number): Promise<void>;
  /** The sealed private-note store (ADR-057 §6) — what undo's parallel sealed-rows capture reads through (`gatherPrivateSealedRows`). Never decrypts; it cannot. */
  privateNoteStore(profileId: string): PrivateNoteStore;
  /**
   * Refuses an archive whose `data/modules.ndjson` this build cannot import
   * whole (ADR-090): a module id it did not adopt, a module it cannot restore,
   * or a payload that module's own `parse` throws on. Called at the PREVIEW, so
   * the user hears it before confirming, and not at all when the section is
   * empty or names only modules that are here and take what they are given.
   *
   * The refusal carries a `ModuleImportError` code, which is what lets the
   * preview report an unknown module and an unreadable payload as two different
   * problems.
   */
  assertImportable(modules: readonly ExportModuleData[]): void;
  /**
   * Applies the archive's kit-module section to one profile (ADR-090), after
   * the profile's content has been replaced and inside the same unlocked
   * session. Every payload is parsed before any module writes, and every
   * adopted module is then applied inside ONE transaction: a module that
   * refuses - at either step - leaves the profile exactly as the replace left
   * it, with no module's rows written.
   */
  restoreModuleData(profileId: string, modules: readonly ExportModuleData[]): void;
  /**
   * Every blob the archive's kit-module section names, with the module that
   * names it (ADR-108). Injected because neither this module nor `@nexus/core`
   * can read a module's payload: the module itself answers the question, off the
   * same parsed value its own `apply` is handed.
   *
   * Read once per apply, for the two things this file owes the section's bytes:
   * writing each one into the store BEFORE any module's `apply` writes the row
   * that names it (a row pointing at nothing is the one failure the attachment
   * loop above already refuses), and reporting - at the preview, exactly as the
   * reader reports a built-in row's missing blob - the ones the archive does not
   * carry. Called only after `assertImportable` has passed, so a payload that
   * module's own `parse` refuses never reaches it.
   */
  moduleBlobs(modules: readonly ExportModuleData[]): readonly ModuleImportBlob[];
  /** Whether `profileId`'s private section is set up AND unlocked right now — the preview's `willRestore` fact, re-checked at apply time by the re-seal itself. */
  privUnlocked(profileId: string): boolean;
  /**
   * `main/priv.ts`'s `privResealForRestore`, injected on `verifyAccountPasscode`'s
   * terms (this module must stay importable under plain Node): re-seals the
   * archive's decrypted private notes under the target's CURRENT DEK, writing
   * each attachment's fresh sealed blob file as it goes, or answers null while
   * the section is locked or not set up — the named-skip path, which leaves the
   * profile's own sealed rows standing.
   */
  resealPrivateNotes(
    profileId: string,
    data: ExportPrivateNotes,
    readArchiveBlob: (id: string) => Promise<Uint8Array | null>,
  ): Promise<PrivResealOutcome | null>;
  /** Best-effort removal of ONE sealed private-blob file the re-seal added — undo's cleanup. No refcount twin: the ids are random and never shared (no content addressing, by design). */
  removePrivateBlob(id: string): Promise<void>;
  /**
   * `main/priv.ts`'s `privSweepOrphanBlobs` for this profile, injected on
   * `resealPrivateNotes`' terms. Called at the ONE moment an undo stops being
   * able to bring sealed rows back (see `undoRestore`), because until then the
   * files those rows name must stay put. Best-effort by contract: it is
   * housekeeping, and it may never fail an operation that has already
   * committed.
   */
  sweepPrivateBlobs(profileId: string): Promise<void>;
}

/**
 * What a foreign import needs on top of a restore's dependencies. Only one
 * thing: the additive store. Everything else it reads about the target profile
 * — the Inbox, both tag tables, the template names, whether a quick-capture
 * folder is already claimed — comes through the `ProfileDataDeps` getters the
 * exporter and the restore already inject, because those ARE the profile's own
 * stores and an import must ask the same ones the app itself would.
 */
export interface ImportDeps extends RestoreDeps {
  foreignImportStore(profileId: string): ForeignImportStore;
}

/** The archive the user picked to RESTORE, and (once a preview has succeeded) the parse that preview reported. Held open between preview and apply. */
let pending: PendingRestore | null = null;
/** The archive the user picked to IMPORT, and (once a preview has succeeded) the plan that preview reported. Deliberately a second variable: the two picks never touch. */
let pendingImport: PendingImport | null = null;
/** The Anki `.apkg` the user picked, its collection once read, and the plan once a preview has succeeded. A third variable, on the same terms the second is: the three picks never touch. */
let pendingApkg: PendingApkg | null = null;
/** The calendar `.ics` the user picked, its parsed events once read, and the plan once a preview has succeeded (ADR-061). A fourth variable, on the same terms: no surface here can reach another's file. */
let pendingIcs: PendingIcs | null = null;
/** The plan a pasted LLM answer produced (IMEX-005). A fifth variable, on the same terms: no surface here can reach another's source. */
let pendingLlm: ReadyLlm | null = null;
/** The CSV the user picked, its text and parse once a preview has read it, and the plan once a mapping has been confirmed (ADR-062). A fifth variable, on the terms of the other four. */
let pendingCsv: PendingCsv | null = null;
/** The BANK STATEMENT the user picked, on exactly the same terms (FIN slice e). A sixth variable rather than a mode on the fifth: the two surfaces write different tables, and a shared pick would be one field away from letting a statement land in somebody's task list. */
let pendingFinCsv: PendingFinCsv | null = null;
/** The pre-operation snapshot of the last applied restore OR import — one slot, whichever ran last. */
let undo: RestoreUndo | null = null;

/** Closes and drops `pending`'s open archive, if one exists, then clears `pending` entirely. */
async function closePending(): Promise<void> {
  if (pending?.ready) {
    await pending.ready.archive.close();
  }
  pending = null;
}

/** The import side of `closePending`, on the same terms. */
async function closePendingImport(): Promise<void> {
  if (pendingImport?.ready) {
    await pendingImport.ready.archive.close();
  }
  pendingImport = null;
}

/**
 * Closes and drops one pick's ready parse, if a preview has produced one. A
 * function (rather than the same three lines inline) on purpose: its second
 * caller sits AFTER an `await` that a concurrent preview may have raced, and
 * only a call boundary stops control-flow analysis from carrying the earlier
 * `ready === null` narrowing over a mutation it cannot see.
 */
async function closeReady<TReady extends { archive: OpenedArchive }>(
  entry: PickedArchive<TReady>,
): Promise<void> {
  if (entry.ready !== null) {
    await entry.ready.archive.close();
    entry.ready = null;
  }
}

/**
 * The half of a pick both flows share: the native dialog main owns (the
 * renderer never supplies a path — SEC-EL), then `inspectArchiveFile`, a
 * magic-bytes-only peek with no zip parsing and no KDF, so the caller learns
 * whether a passphrase is needed BEFORE paying for a full `openArchive`. Null
 * means the user canceled.
 */
async function pickArchive<TReady extends { archive: OpenedArchive }>(
  deps: RestoreDeps,
): Promise<PickedArchive<TReady> | null> {
  const filePath = await deps.pickArchiveFile();
  if (filePath === null) return null;
  const { encrypted } = await inspectArchiveFile(filePath);
  return { filePath, fileName: basename(filePath), encrypted, ready: null };
}

/**
 * Maps one core `ImportProblem` onto the wire `RestoreProblem`. The
 * `code` assignment below is the drift check the type's own doc comment
 * promises: if `@nexus/core` ever adds an `ImportProblemCode` this file's
 * `RestoreProblemCode` does not also carry, this line stops compiling —
 * a build-time failure instead of a problem silently falling off the wire.
 */
function toRestoreProblem(problem: ImportProblem): RestoreProblem {
  const code: RestoreProblemCode = problem.code;
  return {
    severity: problem.severity,
    code,
    ...(problem.path !== undefined ? { path: problem.path } : {}),
    ...(problem.line !== undefined ? { line: problem.line } : {}),
    ...(problem.detail !== undefined ? { detail: problem.detail } : {}),
  };
}

/**
 * Maps one core `ImportSkipReason` onto the wire. The three annotated
 * assignments are the drift checks `toRestoreProblem`'s `code` line is: a skip
 * code, an archive module or a record type added in `@nexus/core` and forgotten
 * in `shared/ipc.ts` stops this file compiling, rather than reaching a renderer
 * that has no copy for it.
 */
function toImportSkip(skip: CoreImportSkipReason): ImportSkipReason {
  const code: ImportSkipCode = skip.code;
  const module: ArchiveModuleName | null = skip.module;
  const type: ImportRecordType | null = skip.type;
  return { code, module, type, count: skip.count };
}

/**
 * Maps one core `ImportDuplicateGroup` onto the wire. The annotated `type`
 * assignment is the same drift check `toImportSkip`'s three are: a duplicate
 * group added in `@nexus/core` and forgotten in `shared/ipc.ts` stops this file
 * compiling, rather than reaching a renderer that has no label for it.
 */
function toImportDuplicate(group: CoreImportDuplicateGroup): ImportDuplicateGroup {
  const type: ImportDuplicateType = group.type;
  return { type, count: group.count };
}

/** The plan's report on the wire — copied rather than passed through, because the wire shape is mutable and core's is readonly. */
function toImportReport(report: CoreImportPlanReport): ImportPlanReport {
  return {
    modules: report.modules,
    skips: report.skips.map(toImportSkip),
    duplicates: report.duplicates.map(toImportDuplicate),
  };
}

/** sha256 hex over a UTF-8 string — the same injection `handleExport` (`imex.ts`) gives `buildExportArchive`. */
function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * What an import parse consumes, taken straight off an OPEN archive. Extracted
 * because it is exactly what a re-plan re-uses (ADR-051): these three maps are
 * already decoded and resident for the archive's whole lifetime, so re-planning
 * costs a parse of memory rather than a second open, a second KDF pass and a
 * second walk over every blob.
 *
 * `"import"` mode is the whole difference at the parser: a per-row problem
 * becomes a warning and costs that row its place instead of refusing the
 * archive, since a merge that threw away nine thousand good rows over one
 * damaged one would be the wrong answer. Archive-level problems — a bad
 * manifest, a checksum mismatch, an unsupported version — are still errors, and
 * still refuse.
 */
function importParseInput(archive: OpenedArchive): Parameters<typeof parseImportArchive>[0] {
  return {
    files: archive.files,
    ydocs: archive.ydocs,
    blobNames: archive.blobNames,
    privateBlobNames: archive.privateBlobNames,
    hash: sha256Hex,
    mode: "import",
  };
}

/** The planner's private-note COUNTS (ADR-057 §6): all it may ever learn about them — a foreign import never imports the private section, and the counts exist only so its named skip can say how much is staying behind. */
function privateNoteCounts(privateNotes: ExportPrivateNotes | null): {
  notes: number;
  versions: number;
} {
  return {
    notes: privateNotes?.notes.length ?? 0,
    versions: privateNotes?.versions.length ?? 0,
  };
}

/**
 * One import preview on the wire, from the parse and the plan that produced it.
 * Shared by `previewImport` and `replanImport` so the two can never describe the
 * same archive differently — the ONLY thing that legitimately differs between
 * them is the plan (and therefore the token).
 */
function importPreviewOf(
  picked: PendingImport,
  archive: OpenedArchive,
  manifest: { createdAt: string; appVersion: string; profile: { name: string } },
  problems: readonly ImportProblem[],
  plan: ForeignImportPlan,
  targetProfileName: string,
  token: string,
): ImportPreview {
  return {
    token,
    fileName: picked.fileName,
    encrypted: picked.encrypted,
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion,
    sourceProfileName: manifest.profile.name,
    targetProfileName,
    report: toImportReport(plan.report),
    warnings: problems.filter((problem) => problem.severity === "warning").map(toRestoreProblem),
    corruptBlobs: archive.corruptBlobNames.size,
  };
}

/**
 * Picks a new archive file, replacing whatever was picked before. Closes and
 * drops any existing `pending` first — a fresh pick abandons the previous
 * file, and leaving its archive open (if a preview had already succeeded)
 * would leak a file handle for a file the user is no longer looking at.
 *
 * Calls `inspectArchiveFile` (a magic-bytes-only peek, no zip parsing, no
 * KDF) so the caller learns whether a passphrase is needed BEFORE paying for
 * a full `openArchive` — the same reason `imex.ts`'s dialog flow defers
 * Argon2id until after the dialog resolves.
 */
export async function pickRestoreFile(deps: RestoreDeps): Promise<RestorePickResult> {
  await closePending();

  const picked = await pickArchive<ReadyRestore>(deps);
  if (picked === null) return { canceled: true };

  pending = picked;
  return {
    canceled: false,
    path: picked.filePath,
    fileName: picked.fileName,
    encrypted: picked.encrypted,
  };
}

/**
 * Opens the picked archive under `passphrase` (ignored for a plain zip) and
 * runs the REAL parse (`parseImportArchive`) — this is what makes the
 * preview a dry run rather than an estimate. Drops any previous `ready`
 * first: a re-preview (the user retyping a passphrase after a wrong one, or
 * simply hitting "preview" again) must not leak the prior archive's file
 * handle, so the old one is closed before the new one is opened, regardless
 * of whether this attempt itself succeeds.
 *
 * `current` costs a full profile read (`gatherProfileData` merges every
 * note's Yjs state) — deliberately: the preview counts the LIVE profile by
 * exactly the rule the archive was counted by (`countProfileModules`), and
 * there is no cheaper count that could not drift from it.
 */
export async function previewRestore(
  deps: RestoreDeps,
  profileId: string,
  passphrase: string | null,
): Promise<RestorePreviewResult> {
  // Bound to a local so every reference below is to THIS pick, never to
  // whatever the module-level `pending` happens to hold once an `await`
  // resumes — TypeScript cannot narrow a re-assignable outer `let` across a
  // function-call boundary, and a plain re-read after `await openArchive(...)`
  // would need a fresh (and unjustified) null check anyway.
  const picked = pending;
  if (picked === null) return { status: "no-file" };

  await closeReady(picked);

  let archive: OpenedArchive;
  try {
    archive = await openArchive(picked.filePath, passphrase);
  } catch (error) {
    if (error instanceof ArchiveReadError) {
      return { status: "unreadable", code: error.code };
    }
    throw error;
  }

  // Re-checked AFTER the await above, which is where this can change out from
  // under us: `openArchive` spans many I/O rounds (and, for an NXA1 container,
  // a deliberately slow KDF), and the renderer is untrusted — nothing stops it
  // from firing a new pick, or a second preview, while this one is in flight.
  // A pick replaced `pending` wholesale, so attaching this archive to the
  // orphaned `picked` would leak its handle (keeping the user's file locked on
  // Windows) with nothing left holding a reference to ever close it. A
  // concurrent preview of the SAME pick instead landed on `picked.ready`
  // first; the latest finisher wins and closes the earlier archive — safe,
  // because only the ready token an apply presents is ever honoured.
  if (pending !== picked) {
    await archive.close();
    return { status: "no-file" };
  }
  await closeReady(picked);

  const parsed = parseImportArchive({
    files: archive.files,
    ydocs: archive.ydocs,
    blobNames: archive.blobNames,
    privateBlobNames: archive.privateBlobNames,
    hash: sha256Hex,
  });

  if (parsed.data === null || parsed.manifest === null || parsed.privateNotes === null) {
    await archive.close();
    return { status: "invalid", problems: parsed.problems.map(toRestoreProblem) };
  }

  let targetProfile: { name: string; kind: ArchiveProfileKind };
  let current: ReturnType<typeof countProfileModules>;
  try {
    targetProfile = deps.getProfile(profileId);
    current = countProfileModules(gatherProfileData(deps, profileId));
  } catch (error) {
    // `picked.ready` is still null, so nothing else holds a reference to this
    // archive: letting the throw through unclosed would leak the handle and
    // keep the user's file locked on Windows with no way left to release it —
    // `previewImport`'s own guard, mirrored.
    await archive.close().catch(() => {});
    throw error;
  }

  // ADR-058: a restore archive fits only its own KIND of profile — the "fits
  // only its own profile" rule, one clause wider. A restore REPLACES the
  // target with the archive's identity and contents, so restoring a business
  // archive into a personal profile (or the reverse) would silently turn one
  // kind of profile into the other's data wearing the wrong identity. Refused
  // as a NAMED problem, not a thrown error, because it is a fact about the
  // pair the user picked — something to read, choose the other profile over,
  // and never something a retry fixes. The foreign IMPORT deliberately has no
  // twin of this gate: it copies rows, and rows are rows.
  if (parsed.manifest.profile.kind !== targetProfile.kind) {
    await archive.close();
    return {
      status: "invalid",
      problems: [
        {
          severity: "error",
          code: "profile-kind-mismatch",
          path: "manifest.json",
          detail: `${parsed.manifest.profile.kind} -> ${targetProfile.kind}`,
        },
      ],
    };
  }
  const incoming = countProfileModules(parsed.data);
  const warnings: RestoreProblem[] = parsed.problems
    .filter((problem) => problem.severity === "warning")
    .map(toRestoreProblem);
  const token = randomBytes(16).toString("hex");

  // The kit's section (ADR-090), refused HERE rather than at apply: a module
  // this build does not know means the archive carries data that would be lost,
  // and a payload this build cannot read means the archive would be imported
  // half-way - either way the user has to hear it before they confirm a restore
  // that replaces their profile, not after. The apply re-reads the section
  // (`applyImports`) before any module writes, because a plan confirmed against
  // one build must not be applied by another.
  try {
    deps.assertImportable(parsed.data.modules);
  } catch (error) {
    await archive.close();
    return {
      status: "invalid",
      problems: [
        {
          severity: "error",
          // Which problem this is comes from the kit's own code: "a module this
          // build has never heard of" and "a payload this build cannot read" send
          // the user to different places, and only the module knows the second.
          code:
            error instanceof ModuleImportError && error.code === "invalid-module-data"
              ? "invalid-module-data"
              : "unknown-module",
          path: "data/modules.ndjson",
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  // The kit section's own files (ADR-108), on `parseImportArchive`'s rule-8
  // terms exactly: a blob the archive does not carry is a WARNING naming the
  // path, the row still restores, and the module's page draws the file it cannot
  // find. The module's rows live inside a payload neither core nor this file can
  // read, so the module is asked which hashes they name - and asked only now,
  // after `assertImportable` has passed, so a payload its own `parse` refuses
  // never reaches the question.
  let moduleBlobs: readonly ModuleImportBlob[];
  try {
    moduleBlobs = deps.moduleBlobs(parsed.data.modules);
  } catch (error) {
    // A module's own `importBlobs` throwing is a bug in that module, not a fact
    // about the archive - so it propagates as an exception rather than through
    // the two kit problem codes above. The handle is released first, on
    // `countProfileModules`' own rule: nothing else holds this archive yet, so a
    // throw through here would keep the user's file locked on Windows.
    await archive.close().catch(() => {});
    throw error;
  }
  for (const blob of moduleBlobs) {
    if (archive.blobNames.has(blob.sha256)) continue;
    warnings.push({
      severity: "warning",
      code: "missing-blob",
      path: `blobs/${blob.sha256}`,
      detail: blob.moduleId,
    });
  }

  picked.ready = {
    archive,
    token,
    profileId,
    profileName: parsed.manifest.profile.name,
    profilePicture: parsed.manifest.profile.picture,
    settings: parsed.manifest.settings,
    data: parsed.data,
    privateNotes: parsed.privateNotes,
  };

  const preview: RestorePreview = {
    token,
    fileName: picked.fileName,
    encrypted: picked.encrypted,
    createdAt: parsed.manifest.createdAt,
    appVersion: parsed.manifest.appVersion,
    sourceProfileName: parsed.manifest.profile.name,
    targetProfileName: targetProfile.name,
    current,
    incoming,
    warnings,
    corruptBlobs: archive.corruptBlobNames.size,
    // ADR-057 §6: the archive carrying N private notes is stated whenever it
    // does, and `willRestore` is the section's gate as it stands NOW — the
    // apply re-checks it, so a lock between preview and apply degrades to the
    // same skip this preview would have named.
    privateNotes:
      parsed.privateNotes.notes.length > 0
        ? { count: parsed.privateNotes.notes.length, willRestore: deps.privUnlocked(profileId) }
        : null,
  };
  return { status: "ready", preview };
}

/**
 * Applies the ready preview identified by `token` — refuses (throws) when
 * there is none, when `token` is stale, or when the preview was computed for
 * a different profile than `profileId` names. In order:
 *
 * 1. Discards the running focus timer and any idle note-compaction timers.
 *    Both are discarded, not persisted: their row (or the note it would
 *    compact) is about to be wiped by the very write below, and after the
 *    restore the subject it belonged to may not even exist anymore.
 * 2. Captures the undo snapshot — this profile's CURRENT state, gathered with
 *    the exact same functions the exporter uses — before a single row of it
 *    is touched.
 * 3. Writes every attachment blob the archive can supply, ONE AT A TIME
 *    (never all resident at once), BEFORE the database transaction. This
 *    order is deliberate: if the write below then fails partway, this leaves
 *    at most a few unreferenced blob files, which are harmless leftovers —
 *    the reverse order would instead leave rows pointing at attachment files
 *    that were never written.
 * 3b. When the archive carries private notes AND the target's section is
 *    unlocked (re-checked here — the preview's `willRestore` may have gone
 *    stale), re-seals every envelope under the CURRENT DEK
 *    (`resealPrivateNotes`), writing the fresh sealed attachment files under
 *    the same before-the-transaction discipline, and captures the profile's
 *    existing sealed rows for undo (`gatherPrivateSealedRows`) — bytes, never
 *    envelopes. A section locked by now simply skips: the archive's private
 *    rows do not restore, the profile's own sealed rows stand, which is
 *    exactly what a locked preview promised.
 * 4. Replaces the profile's entire stored content in one transaction
 *    (`RestoreStore.replaceProfileData`) — the private tables joining it
 *    CONDITIONALLY, only when 3b produced rows (ADR-057 §6).
 * 5. Records the undo snapshot, closes the archive, and drops `pending` —
 *    the parse this call just consumed cannot be applied a second time.
 * 6. Schedules the renderer reload on `setTimeout(…, 0)` so this call's own
 *    reply is delivered to the renderer FIRST. The renderer must not depend
 *    on that reload happening before this promise resolves — the reload
 *    destroys the very context that awaited it — which is why the undo
 *    banner is driven by a separate `restoreStatus` read after the reload,
 *    never by this function's return value.
 */
export async function applyRestore(
  deps: RestoreDeps,
  profileId: string,
  token: string,
): Promise<RestoreApplyResult> {
  const ready = pending?.ready;
  if (ready === undefined || ready === null) {
    throw new Error("No restore preview is ready to apply.");
  }
  if (ready.token !== token) {
    throw new Error("This restore preview is stale; re-run the preview before applying.");
  }
  if (ready.profileId !== profileId) {
    throw new Error("This restore preview was computed for a different profile.");
  }

  deps.cancelFocusSession(profileId);
  cancelIdleCompactions();

  const currentProfile = deps.getProfile(profileId);
  const undoSettings = await gatherProfileSettings(deps, profileId);
  const undoData = gatherProfileData(deps, profileId);
  const undoDerived = deriveRestoredNotes(undoData.notes);

  // Every distinct blob the restored rows reference AND the archive actually
  // carries (a missing one is counted below, never fetched). ALL THREE
  // attachment tables, since all three name the same `blobs/` namespace — a
  // task's file or a subject's material left unwritten here would restore as a
  // row pointing at nothing. One at a time — never all resident together —
  // mirroring `handleExport`'s own attachment loop. A dashboard background
  // (ADR-041) is a referrer on the same terms as an attachment, so it joins the
  // same set and a hash several of them name is written once.
  const restoredAttachments = [
    ...ready.data.noteAttachments,
    ...ready.data.taskAttachments,
    ...ready.data.subjectAttachments,
  ];
  const shasToWrite = new Set<string>();
  for (const attachment of restoredAttachments) {
    if (ready.archive.blobNames.has(attachment.sha256)) shasToWrite.add(attachment.sha256);
  }
  for (const dashboard of ready.data.dashboardSettings) {
    const hash = dashboard.backgroundHash;
    if (hash !== null && ready.archive.blobNames.has(hash)) shasToWrite.add(hash);
  }
  // The profile's picture (SET-001) — a referrer on exactly the same terms,
  // named by the manifest rather than by a row. A restore that wrote the hash
  // onto the profile without writing its bytes would leave an avatar pointing at
  // nothing, which is the one failure this loop exists to prevent.
  if (
    ready.profilePicture !== null &&
    ready.archive.blobNames.has(ready.profilePicture.hash)
  ) {
    shasToWrite.add(ready.profilePicture.hash);
  }
  // The kit section's own files (ADR-108), joining the same set on the same
  // rule: written when the archive carries them, counted when it does not. They
  // are written HERE, before the replace and before `restoreModuleData` below
  // writes the rows that name them - the order that makes a row pointing at
  // nothing impossible, exactly as for the attachments above.
  const moduleBlobs = deps.moduleBlobs(ready.data.modules);
  for (const blob of moduleBlobs) {
    if (ready.archive.blobNames.has(blob.sha256)) shasToWrite.add(blob.sha256);
  }
  const addedBlobs: string[] = [];
  for (const sha256 of shasToWrite) {
    const bytes = await ready.archive.readBlob(sha256);
    const { created } = await deps.saveBlob(bytes);
    if (created) addedBlobs.push(sha256);
  }

  // Step 3b (ADR-057 §6): the private re-seal, gated on the section AS IT IS
  // NOW — null when it locked since the preview, in which case the archive's
  // private rows simply do not restore and the profile's own sealed rows stand.
  // The undo capture happens only on the path that will actually replace the
  // tables: a null capture is what tells undo to leave them untouched too.
  let privateSealed: RestoredPrivateRows | null = null;
  let undoPrivateSealed: RestoredPrivateRows | null = null;
  let addedPrivateBlobs: readonly string[] = [];
  let missingPrivateBlobs = 0;
  if (ready.privateNotes.notes.length > 0) {
    const archive = ready.archive;
    const resealed = await deps.resealPrivateNotes(profileId, ready.privateNotes, (id) =>
      archive.privateBlobNames.has(id) ? archive.readPrivateBlob(id) : Promise.resolve(null),
    );
    if (resealed !== null) {
      undoPrivateSealed = gatherPrivateSealedRows(deps.privateNoteStore(profileId));
      privateSealed = resealed.rows;
      addedPrivateBlobs = resealed.addedBlobIds;
      missingPrivateBlobs = resealed.missingBlobs;
    }
  }

  const now = new Date().toISOString();
  const derived = deriveRestoredNotes(ready.data.notes);
  const rowsWritten = deps.restoreStore(profileId).replaceProfileData(
    {
      profileName: ready.profileName,
      profilePicture: ready.profilePicture,
      settings: ready.settings,
      data: ready.data,
      derived,
      privateSealed,
    },
    now,
  );

  // The kit's section (ADR-090), applied immediately after the replace. A kit
  // module's tables are deliberately NOT on `RESTORE_WIPE_TABLES` (section 6 of
  // the ADR says why), so the replace above left them standing and THIS is what
  // puts them where the archive says they belong: every adopted module runs,
  // and one the section does not name is handed `undefined` and resets its own
  // archived state to empty. All of it, or none of it, in one transaction.
  deps.restoreModuleData(profileId, ready.data.modules);

  // Private attachment files the archive could not supply count beside the
  // content-addressed ones: both are attachment rows restored without their
  // bytes, which is the one fact this number states.
  const missingBlobs =
    restoredAttachments.filter(
      (attachment) => !ready.archive.blobNames.has(attachment.sha256),
    ).length +
    // A kit module's file the archive lacks (ADR-108) is the same fact one
    // section over: the module's row comes back and its bytes do not, which the
    // module's own page draws as a missing file (`previewRestore` raised the
    // warning naming it).
    moduleBlobs.filter((blob) => !ready.archive.blobNames.has(blob.sha256)).length +
    missingPrivateBlobs;

  const summary: RestoreApplyResult = {
    restored: countProfileModules(ready.data),
    rowsWritten,
    blobsAdded: addedBlobs.length,
    missingBlobs,
  };

  undo = {
    kind: "restore",
    profileId,
    snapshot: {
      profileName: currentProfile.name,
      profilePicture: currentProfile.picture,
      settings: undoSettings,
      data: undoData,
      derived: undoDerived,
    },
    privateSealed: undoPrivateSealed,
    addedPrivateBlobs,
    addedBlobs,
    appliedAt: now,
    summary,
  };

  // Best-effort: the replace transaction above has already committed, so from
  // here on nothing may make this call report failure — telling the renderer
  // a restore failed when it in fact happened (and skipping the reload that
  // follows) is strictly worse than tolerating one unclosed file handle.
  await ready.archive.close().catch(() => {});
  pending = null;

  setTimeout(() => deps.reloadRenderer(), 0);

  return summary;
}

/**
 * Replays the pre-restore snapshot back through the identical replace path
 * (ADR-023 section 2), then — only AFTER that write, so the reference count
 * below is live rather than stale — removes exactly the blobs the restore
 * had added and that nothing references anymore. A blob's row-level reference
 * count across EVERY table that names a hash (`deps.blobRefCount` —
 * attachments on either module, dashboard backgrounds, profile pictures;
 * deliberately profile-agnostic) is what decides this, never simply "was it one of
 * `addedBlobs`": a blob the restore added that some OTHER profile's — or some
 * other MODULE's — row also happens to reference (content-addressed blobs are
 * shared) must survive regardless of who wrote it first.
 *
 * Throws when there is nothing to undo for this profile. Discards the focus
 * timer and idle compactions exactly as `applyRestore` does, and reloads the
 * renderer the same way, for the same reason: the row each would touch is
 * about to be replaced again.
 */
export async function undoRestore(deps: RestoreDeps, profileId: string): Promise<RestoreUndoResult> {
  if (undo === null || undo.profileId !== profileId) {
    throw new Error("There is no restore to undo for this profile.");
  }
  const toUndo = undo;

  deps.cancelFocusSession(profileId);
  cancelIdleCompactions();

  const now = new Date().toISOString();
  const rowsWritten = deps.restoreStore(profileId).replaceProfileData(
    {
      profileName: toUndo.snapshot.profileName,
      profilePicture: toUndo.snapshot.profilePicture,
      settings: toUndo.snapshot.settings,
      data: toUndo.snapshot.data,
      derived: toUndo.snapshot.derived,
      // Byte-for-byte, exactly as captured (ADR-057 §6) — and null whenever
      // the operation left the private tables untouched, so this undo leaves
      // them untouched too (edits made since must not be collateral).
      privateSealed: toUndo.privateSealed,
    },
    now,
  );

  // The kit's section is replayed on the same terms as every other member of
  // the snapshot (ADR-090): the pre-operation payload went in with the
  // pre-operation rows, so undoing a restore - or a foreign import - puts the
  // profile's modules back exactly where they were.
  deps.restoreModuleData(profileId, toUndo.snapshot.data.modules);

  let blobsRemoved = 0;
  for (const sha256 of toUndo.addedBlobs) {
    const refCount = deps.blobRefCount(profileId, sha256);
    if (refCount === 0) blobsRemoved += 1;
    await deps.deleteBlobIfOrphaned(sha256, refCount);
  }
  // The re-seal's fresh sealed files, unreferenced the moment the sealed rows
  // above went back: removed outright — no refcount exists for a random-id
  // file, by design — and best-effort, like every private-blob unlink.
  for (const id of toUndo.addedPrivateBlobs) {
    await deps.removePrivateBlob(id);
  }

  undo = null;

  // The ordering the private orphan sweep hangs on (ADR-057): the slot that
  // could put sealed rows — and with them the blob files their envelopes name
  // — back has just been discarded, and the rows it was holding are back in
  // the tables, so from HERE on an unreferenced sealed file really is garbage.
  // A sweep any earlier would delete exactly what the undo above needed.
  // Best-effort: the replace has committed and nothing below may fail it.
  await deps.sweepPrivateBlobs(profileId).catch((error: unknown) => {
    console.error("Private orphan-blob sweep after an undo failed:", error);
  });

  setTimeout(() => deps.reloadRenderer(), 0);

  return { rowsWritten, blobsRemoved };
}

/**
 * Whether the one undo slot could still put `profileId`'s SEALED private rows
 * back — true exactly while the last applied operation replaced those tables
 * and has not been undone (an import never touches them, so its snapshot
 * answers false). The private orphan-blob sweep's gate: those held rows'
 * envelopes name blob files nothing live references, and deleting them would
 * make the undo restore rows whose attachments are gone.
 */
export function privateUndoPending(profileId: string): boolean {
  return undo !== null && undo.profileId === profileId && undo.privateSealed !== null;
}

/**
 * The undo entry for one profile, or none — what a freshly reloaded renderer
 * asks for (the reload replaced the screen that would have shown the banner).
 * One slot, so this answers for a restore and an import alike; `kind` is what
 * lets the banner name which one it is offering to undo.
 */
export function restoreStatus(profileId: string): RestoreStatus {
  if (undo !== null && undo.profileId === profileId) {
    return { undo: { kind: undo.kind, appliedAt: undo.appliedAt, summary: undo.summary } };
  }
  return { undo: null };
}

/**
 * Drops the picked archive (closing it first if a preview had opened it).
 * This is what the UI calls when the user backs out of a restore before
 * applying it — and it matters beyond tidiness: an open archive keeps the
 * user's file locked on Windows.
 */
export async function cancelRestore(): Promise<void> {
  await closePending();
}

/**
 * Drops every piece of module state — called on lock and on quit. Both picks
 * go, not just the restore's: an import's open archive holds decrypted bytes of
 * somebody's whole profile, which must no more outlive a lock than a restore's
 * do. Each archive (if any is still open) is closed best-effort and UNAWAITED:
 * a lock must never be delayed or failed by cleanup of an operation nobody is
 * looking at anymore.
 */
export function clearRestoreState(): void {
  undo = null;
  if (pending?.ready) {
    void pending.ready.archive.close().catch(() => {});
  }
  pending = null;
  if (pendingImport?.ready) {
    void pendingImport.ready.archive.close().catch(() => {});
  }
  pendingImport = null;
  // The Anki pick holds no file handle (`readApkg` closes the file before it
  // returns) but it DOES hold somebody's whole collection in memory, which must
  // no more outlive a lock than a decrypted archive does.
  pendingApkg = null;
  // The calendar pick holds no handle either, but it holds somebody's whole
  // parsed calendar. Same rule.
  pendingIcs = null;
  // Nor does the LLM plan, and it holds what the user pasted out of their own
  // chat — their content, in plaintext, in main's heap. Same rule.
  pendingLlm = null;
  // Nor the CSV pick: its text and parsed cells are somebody's whole task
  // list, in plaintext, in main's heap. Same rule again.
  pendingCsv = null;
  // Nor the statement pick, on precisely the same terms — and with more at
  // stake, since what it holds is somebody's whole bank ledger.
  pendingFinCsv = null;
}

// --- Foreign import (ADR-043) -----------------------------------------------

/**
 * Picks an archive to IMPORT, replacing whatever was picked for an import
 * before. The restore pick is untouched: the two are separate state, so a user
 * who abandoned a half-finished restore does not lose it by starting an import,
 * and — the part that matters — nothing on either surface can reach the other's
 * archive.
 */
export async function pickImportFile(deps: RestoreDeps): Promise<ImportPickResult> {
  await closePendingImport();

  const picked = await pickArchive<ReadyImport>(deps);
  if (picked === null) return { canceled: true };

  pendingImport = picked;
  return {
    canceled: false,
    path: picked.filePath,
    fileName: picked.fileName,
    encrypted: picked.encrypted,
  };
}

/**
 * Every attachment blob this profile already holds, across ALL THREE attachment
 * tables (ADR-051) — the index the planner's duplicate rule looks a source
 * attachment's `sha256` up in.
 *
 * Read by fanning out over the live parents, exactly as `gatherProfileData`
 * does, because each attachment store is scoped through its own parent row (a
 * note, a task, a subject) rather than through the profile. Deliberately NOT
 * `gatherProfileData` itself: that merges every note's Yjs state, which is a
 * large cost for an answer that needs only hashes.
 *
 * Three tables and not two, for the reason `blobRefCount` (`main/index.ts`)
 * unions five: the blob store is content-addressed across the whole database, so
 * an index that saw only one table would call a file "new" that the profile is
 * already showing somewhere else.
 */
function targetAttachmentHashes(deps: ProfileDataDeps, profileId: string): Set<string> {
  const hashes = new Set<string>();

  const noteAttachments = deps.noteAttachmentStore(profileId);
  for (const note of deps.noteStore(profileId).list()) {
    for (const row of noteAttachments.list(note.id)) hashes.add(row.sha256);
  }

  const taskAttachments = deps.taskAttachmentStore(profileId);
  for (const task of deps.taskStore(profileId).listActive()) {
    for (const row of taskAttachments.list(task.id)) hashes.add(row.sha256);
  }

  const subjectAttachments = deps.subjectAttachmentStore(profileId);
  for (const subject of deps.subjectStore(profileId).listActive()) {
    for (const row of subjectAttachments.list(subject.id)) hashes.add(row.sha256);
  }

  return hashes;
}

/**
 * Everything the planner needs to know about the profile being merged INTO,
 * read off the profile's OWN stores — never off a cached view. Each answer
 * decides an identity question the planner then resolves once and for all:
 * which Inbox the source's tasks land in, which tags are already there by name,
 * which template names are taken in each of the three template tables, whether
 * the quick-capture folder is already claimed (migration 028 allows exactly
 * one), and — ADR-051 — which files, appointments, birthdays and documents this
 * profile ALREADY HAS.
 *
 * The four duplicate indexes are composed with the SAME exported key functions
 * the planner composes a source row's key with (`eventDuplicateKey` and its two
 * siblings): two spellings of one key would be a rule that quietly stopped
 * matching, which for a duplicate rule is the worst possible failure — it
 * reports nothing and looks fine.
 *
 * The Inbox is read, never created: every profile has one (migration 022
 * backfills the ones that predate ADR-029, `main` seeds the ones it creates), so
 * its absence is a broken database rather than a case to paper over — and a
 * PREVIEW must not write a row.
 */
function importTargetFor(deps: ProfileDataDeps, profileId: string): ForeignImportTarget {
  const inbox = deps.taskListStore(profileId).listActive().find((list) => list.isInbox);
  if (inbox === undefined) {
    throw new Error(`Profile "${profileId}" has no Inbox; an import has nowhere to file the archive's.`);
  }
  const org = deps.noteOrgStore(profileId);
  return {
    profileId,
    inboxListId: inbox.id,
    noteTags: org.listTags(),
    // NOTE-002 / migration 049: a category's identity is its name, exactly as a
    // tag's is (and backed by the same per-profile UNIQUE index), so the
    // planner absorbs a source category this profile already holds.
    noteCategories: org.listCategories(),
    taskTags: deps.taskTagStore(profileId).listTags(),
    taskTemplateNames: deps.taskTemplateStore(profileId).list().map((template) => template.name),
    eventTemplateNames: deps.eventTemplateStore(profileId).list().map((template) => template.name),
    noteTemplateNames: new Set(
      deps.noteTemplateStore(profileId).list().map((template) => template.name),
    ),
    attachmentHashes: targetAttachmentHashes(deps, profileId),
    eventKeys: new Set(deps.eventStore(profileId).listActive().map(eventDuplicateKey)),
    personKeys: new Set(deps.peopleStore(profileId).listActive().map(personDuplicateKey)),
    documentKeys: new Set(deps.documentStore(profileId).listActive().map(documentDuplicateKey)),
    claimsCaptureDefault: org.listFolders().some((folder) => folder.isCaptureDefault),
    // FIN / migration 051: a category absorbs by the `(kind, name)` PAIR rather
    // than by name alone, because that is the table's actual UNIQUE index — and
    // because „Pokloni" the expense and „Pokloni" the income are two real
    // categories that folding would silently merge.
    finCategories: deps.finCategoryStore(profileId).list(),
    // Composed with core's own key function for the reason the three above are:
    // one spelling of the key, or the rule quietly stops matching.
    finBudgetKeys: new Set(deps.finCategoryStore(profileId).listBudgets().map(finBudgetKey)),
  };
}

/**
 * Opens the picked archive under `passphrase` (ignored for a plain zip), runs
 * the REAL parse in `"import"` mode, and really plans it against this profile —
 * which is what makes the preview a dry run rather than an estimate, on both
 * counts. Drops any previous `ready` first, for the same file-handle reason
 * `previewRestore` does.
 *
 * `"import"` mode is the whole difference at the parser — see
 * `importParseInput`, which is also exactly what a later re-plan re-uses.
 *
 * The ids are minted with `uuidv7`, the same generator every store mints with,
 * so imported rows sort by id exactly as rows created at this moment would.
 */
export async function previewImport(
  deps: ImportDeps,
  profileId: string,
  passphrase: string | null,
): Promise<ImportPreviewResult> {
  // Bound to a local for exactly the reason `previewRestore` binds its own —
  // see that function: `pendingImport` can be replaced across the awaits below.
  const picked = pendingImport;
  if (picked === null) return { status: "no-file" };

  await closeReady(picked);

  let archive: OpenedArchive;
  try {
    archive = await openArchive(picked.filePath, passphrase);
  } catch (error) {
    if (error instanceof ArchiveReadError) {
      return { status: "unreadable", code: error.code };
    }
    throw error;
  }

  // Re-checked AFTER the await, where this can change out from under us; see
  // `previewRestore`'s own note on why attaching to an orphaned pick would leak
  // the handle (and keep the user's file locked on Windows).
  if (pendingImport !== picked) {
    await archive.close();
    return { status: "no-file" };
  }
  await closeReady(picked);

  const parsed = parseImportArchive(importParseInput(archive));

  if (parsed.data === null || parsed.manifest === null) {
    await archive.close();
    return { status: "invalid", problems: parsed.problems.map(toRestoreProblem) };
  }

  // The target is read as late as possible — immediately before planning
  // against it — because every identity question the planner answers is
  // answered about the profile as it is NOW.
  let plan: ForeignImportPlan;
  try {
    plan = planForeignImport(
      {
        data: parsed.data,
        dropped: parsed.dropped,
        // Handed over only so the plan can NAME it as skipped: an import never
        // adopts the archive's profile picture (ADR-043 §2, the dashboard
        // background's rule at its sharpest).
        //
        // The manifest's `kind` (ADR-058) is deliberately NOT read here at
        // all: a foreign import copies rows into the target, and rows are
        // rows whichever kind of profile wrote them — only the RESTORE, which
        // replaces a profile's identity wholesale, gates on the pair.
        profilePicture: parsed.manifest.profile.picture,
        // Counts only (ADR-057 §6): private notes NEVER import, and the
        // planner's named skip is the whole reason it hears about them.
        privateNotes: privateNoteCounts(parsed.privateNotes),
      },
      importTargetFor(deps, profileId),
      uuidv7,
      // No choices: a first preview is always planned on the defaults — every
      // duplicate group skipped (ADR-051) — because the user has not been shown
      // a group yet, let alone answered one. `replanImport` is what carries an
      // answer back.
    );
  } catch (error) {
    // `picked.ready` is still null, so nothing else holds a reference to this
    // archive: letting the throw through unclosed would leak the handle and
    // keep the user's file locked on Windows with no way left to release it.
    await archive.close().catch(() => {});
    throw error;
  }
  const token = randomBytes(16).toString("hex");

  picked.ready = { archive, token, profileId, plan };

  return {
    status: "ready",
    preview: importPreviewOf(picked, archive, parsed.manifest, parsed.problems, plan, deps.getProfile(profileId).name, token),
  };
}

/**
 * Re-plans the archive an import preview already has open, under different
 * duplicate choices (ADR-051), and answers a whole fresh preview.
 *
 * What this deliberately does NOT do is the entire point. It does not re-open
 * the file, does not re-derive the archive key (a sealed archive's Argon2id pass
 * is measured in seconds by design), does not ask for the passphrase a second
 * time, and does not re-hash a single blob: the open `OpenedArchive` is still
 * holding the decoded `files`/`ydocs`/`blobNames` a parse consumes, so a
 * re-plan is a re-PARSE of bytes already in memory plus a fresh planning pass —
 * the same two pure steps a preview does after the expensive part is over.
 * Changing a checkbox must not cost what opening the archive cost.
 *
 * The TARGET is read again rather than reused, on the same terms `previewImport`
 * reads it: every identity question is answered about the profile as it is now,
 * and "now" has moved since the first preview.
 *
 * Synchronous on purpose — there is no `await` anywhere below the guards, so
 * `pendingImport` cannot be replaced out from under this call the way it can
 * across `previewImport`'s opens. The token check is what makes the guards
 * enough: an apply still refuses everything but the token this call just minted.
 */
export function replanImport(
  deps: ImportDeps,
  profileId: string,
  token: string,
  choices: ImportDuplicateChoices,
): ImportPreviewResult {
  const picked = pendingImport;
  const ready = picked?.ready ?? null;
  if (picked === null || ready === null) {
    throw new Error("No import preview is ready to re-plan.");
  }
  if (ready.token !== token) {
    throw new Error("This import preview is stale; re-run the preview before re-planning it.");
  }
  if (ready.profileId !== profileId) {
    throw new Error("This import preview was computed for a different profile.");
  }

  const parsed = parseImportArchive(importParseInput(ready.archive));
  if (parsed.data === null || parsed.manifest === null) {
    // Unreachable by construction: these are the same bytes, in the same mode,
    // through the same pure parser that already accepted them once. Reported
    // rather than thrown because the channel's own type says how an unreadable
    // archive is described — and the existing plan is deliberately left in
    // place, so the token the screen is holding still applies the archive the
    // user already saw.
    return { status: "invalid", problems: parsed.problems.map(toRestoreProblem) };
  }

  // The drift check every wire→core hand-off in this file makes, in the one
  // direction that runs this way: a duplicate group added in `@nexus/core` and
  // forgotten in `shared/ipc.ts` (or the reverse) stops this line compiling.
  const plannerChoices: CoreImportDuplicateChoices = choices;
  const plan = planForeignImport(
    {
      data: parsed.data,
      dropped: parsed.dropped,
      profilePicture: parsed.manifest.profile.picture,
      privateNotes: privateNoteCounts(parsed.privateNotes),
    },
    importTargetFor(deps, profileId),
    uuidv7,
    plannerChoices,
  );

  // A FRESH token, and `ready` replaced wholesale: the plan the previous token
  // named no longer exists, so a screen still holding it must not be able to
  // apply it. The archive itself is carried across untouched — it is the one
  // thing this call must not re-do.
  const nextToken = randomBytes(16).toString("hex");
  picked.ready = { archive: ready.archive, token: nextToken, profileId, plan };

  return {
    status: "ready",
    preview: importPreviewOf(
      picked,
      ready.archive,
      parsed.manifest,
      parsed.problems,
      plan,
      deps.getProfile(profileId).name,
      nextToken,
    ),
  };
}

/**
 * Applies the ready plan identified by `token` — refuses (throws) when there is
 * none, when `token` is stale, or when the plan was computed for a different
 * profile than `profileId` names. In order:
 *
 * 1. Captures the undo snapshot — this profile's CURRENT state, gathered with
 *    the exact same functions the exporter uses — before a single row is added.
 * 2. Writes every attachment blob the archive can supply, ONE AT A TIME, BEFORE
 *    the database transaction, for the same reason `applyRestore` does: a
 *    failure below then leaves at most a few unreferenced files, where the
 *    reverse order would leave rows pointing at files that were never written.
 *    Blobs are content-addressed, so a file the target already has is recognised
 *    by its own name and simply not written twice.
 * 3. Inserts the plan in one transaction (`ForeignImportStore.insertPlanned`).
 * 4. Records the undo snapshot in the shared slot, closes the archive, and drops
 *    `pendingImport` — the plan this call consumed cannot be applied twice.
 * 5. Schedules the renderer reload on `setTimeout(…, 0)`, so this call's reply
 *    reaches the renderer first (see `applyRestore`'s own note).
 *
 * What it deliberately does NOT do, unlike `applyRestore`: cancel the running
 * focus session or the idle note compactions. Both are discarded by a restore
 * because the row each would write is about to be WIPED. An import wipes
 * nothing — a running timer still points at a subject that still exists, and a
 * pending compaction still points at a note that is still there — so discarding
 * them would destroy user state the import had no business touching. The undo
 * path still discards both, because undoing genuinely does wipe.
 */
export async function applyImport(
  deps: ImportDeps,
  profileId: string,
  token: string,
): Promise<ImportApplyResult> {
  const ready = pendingImport?.ready;
  if (ready === undefined || ready === null) {
    throw new Error("No import preview is ready to apply.");
  }
  if (ready.token !== token) {
    throw new Error("This import preview is stale; re-run the preview before applying.");
  }
  if (ready.profileId !== profileId) {
    throw new Error("This import preview was computed for a different profile.");
  }

  const currentProfile = deps.getProfile(profileId);
  const undoSettings = await gatherProfileSettings(deps, profileId);
  const undoData = gatherProfileData(deps, profileId);
  const undoDerived = deriveRestoredNotes(undoData.notes);

  // Exactly the blobs the plan's surviving attachment rows name AND the archive
  // actually carries — `blobNames` is the planner's own de-duplicated union over
  // both attachment tables, so a file attached in two places is written once. A
  // dashboard background is not among them: an import never carries the
  // archive's decoration (ADR-043 section 2), so there is no hash to fetch.
  const addedBlobs: string[] = [];
  for (const sha256 of ready.plan.blobNames) {
    if (!ready.archive.blobNames.has(sha256)) continue;
    const bytes = await ready.archive.readBlob(sha256);
    const { created } = await deps.saveBlob(bytes);
    if (created) addedBlobs.push(sha256);
  }

  const now = new Date().toISOString();
  const derived = deriveRestoredNotes(ready.plan.data.notes);
  const rowsWritten = deps
    .foreignImportStore(profileId)
    .insertPlanned(ready.plan.data, derived, now);

  const importedAttachments = [
    ...ready.plan.data.noteAttachments,
    ...ready.plan.data.taskAttachments,
    ...ready.plan.data.subjectAttachments,
  ];
  const summary: ImportApplyResult = {
    restored: countProfileModules(ready.plan.data),
    rowsWritten,
    blobsAdded: addedBlobs.length,
    missingBlobs: importedAttachments.filter(
      (attachment) => !ready.archive.blobNames.has(attachment.sha256),
    ).length,
  };

  undo = {
    kind: "import",
    profileId,
    snapshot: {
      profileName: currentProfile.name,
      profilePicture: currentProfile.picture,
      settings: undoSettings,
      data: undoData,
      derived: undoDerived,
    },
    // An import never touches the private tables (ADR-057 §6), so its undo
    // must not either — null is precisely that instruction.
    privateSealed: null,
    addedPrivateBlobs: [],
    addedBlobs,
    appliedAt: now,
    summary,
  };

  // Best-effort from here on, exactly as in `applyRestore`: the insert has
  // committed, so nothing may still make this call report failure.
  await ready.archive.close().catch(() => {});
  pendingImport = null;

  setTimeout(() => deps.reloadRenderer(), 0);

  return summary;
}

/**
 * Drops the picked import archive (closing it first if a preview had opened
 * it) — what the UI calls when the user backs out before applying. It matters
 * beyond tidiness, for the reason `cancelRestore` does: an open archive keeps
 * the user's file locked on Windows.
 */
export async function cancelImport(): Promise<void> {
  await closePendingImport();
}

// --- Anki .apkg import (ADR-052 / STUDY-011) --------------------------------

/**
 * The `.apkg` the user picked, its COLLECTION once a preview has read it, and
 * the plan once one has succeeded.
 *
 * `source` is what makes a subject change cheap. An archive's preview keeps its
 * `OpenedArchive` open so a re-plan costs a parse of bytes already in memory
 * rather than a second open and a second Argon2id pass (ADR-051); an `.apkg` has
 * nothing to keep OPEN — `readApkg` closes the file before it returns — so the
 * same property is bought by keeping what it read. Previewing again under a
 * different subject then costs a re-translate and a re-plan, never a re-read of
 * the file and never a second walk over somebody's whole collection.
 *
 * Its own three fields rather than `PickedArchive`'s shape, because an `.apkg`
 * has no `encrypted` flag to carry: a plain zip is the only form it comes in.
 */
interface PendingApkg {
  filePath: string;
  fileName: string;
  /** The collection, read once. Null until the first preview succeeds. */
  source: ParsedApkg | null;
  ready: ReadyApkg | null;
}

/**
 * One successful `.apkg` preview, held exactly as `applyApkgImport` needs it:
 * the plan — already translated, remapped, stamped and counted, so applying
 * writes precisely what the user was shown — the translator's own report, and
 * the token proving an apply is confirming THIS plan.
 *
 * The plan and not the parse, for `ReadyImport`'s reason: the answer depends on
 * the TARGET (which subject, and — through the planner — what that profile
 * already has) as much as on the file.
 */
interface ReadyApkg {
  token: string;
  /** The profile this plan was computed against — the apply refuses any other, mirroring the token check. */
  profileId: string;
  plan: ForeignImportPlan;
  /** The subject the decks hang off, as the preview named it. */
  subjectName: string;
  subjectIsNew: boolean;
  /** Everything the translator could not carry across, already on the wire's shape. */
  skips: ApkgImportSkip[];
  /** What the collection itself held, before any of this build's rules ran. */
  sourceDecks: number;
  sourceNotes: number;
  sourceCards: number;
  plannedDecks: number;
  plannedNotes: number;
  plannedCards: number;
}

/**
 * Maps one core `ApkgSkip` onto the wire. The annotated `code` assignment is the
 * drift check every other wire→core hand-off in this file makes: a skip code
 * added in `@nexus/core` and forgotten in `shared/ipc.ts` stops this file
 * compiling, rather than reaching a renderer that has no sentence for it.
 */
function toApkgSkip(skip: CoreApkgSkip): ApkgImportSkip {
  const code: ApkgImportSkipCode = skip.code;
  return { code, count: skip.count };
}

/**
 * The renderer's subject choice, resolved against the profile as it is NOW.
 *
 * Both halves are checked here rather than at the IPC edge, because both are
 * SEMANTIC: `main/index.ts` proves the payload is one non-null field of the
 * right shape, and this proves the subject it names actually exists (or that the
 * new name is one this app would accept). A renderer naming a subject of another
 * profile — or a soft-deleted one — must be refused, not planned around.
 */
function resolveApkgSubject(
  deps: ImportDeps,
  profileId: string,
  choice: ApkgImportSubjectChoice,
): { subject: ApkgSubjectChoice; name: string; isNew: boolean } {
  if (choice.existingSubjectId !== null) {
    const subject = deps
      .subjectStore(profileId)
      .listActive()
      .find((row) => row.id === choice.existingSubjectId);
    if (subject === undefined) {
      throw new Error(`No active subject "${choice.existingSubjectId}" in this profile.`);
    }
    return { subject: { kind: "existing", id: subject.id }, name: subject.name, isNew: false };
  }
  const name = (choice.newSubjectName ?? "").trim();
  if (name.length === 0) {
    throw new Error("An .apkg import needs either an existing subject or a name for a new one.");
  }
  return { subject: { kind: "new", name }, name, isNew: true };
}

/**
 * Picks an `.apkg` to import, replacing whatever was picked for one before. The
 * two archive picks are untouched: three surfaces, three pieces of state, and
 * nothing on any of them can reach another's file.
 */
export async function pickApkgFile(deps: ImportDeps): Promise<ApkgImportPickResult> {
  pendingApkg = null;

  const filePath = await deps.pickApkgFile();
  if (filePath === null) return { canceled: true };

  pendingApkg = { filePath, fileName: basename(filePath), source: null, ready: null };
  return { canceled: false, path: filePath, fileName: basename(filePath) };
}

/**
 * Reads the picked `.apkg` (once), translates it and really plans it against
 * this profile under `subject` — which is what makes the preview a dry run
 * rather than an estimate, on all three counts.
 *
 * Called again with a different subject, it re-uses the collection it already
 * read: only the translation and the plan are redone. That is ADR-051's re-plan
 * precedent in the one form it can take here, and it matters for the same
 * reason — changing an answer must not cost what opening the file cost, and on a
 * large collection opening it is the expensive part (a zip walk, a zstd pass,
 * SQLite's own `quick_check` over the whole image).
 */
export async function previewApkgImport(
  deps: ImportDeps,
  profileId: string,
  choice: ApkgImportSubjectChoice,
): Promise<ApkgImportPreviewResult> {
  // Bound to a local for exactly the reason `previewImport` binds its own:
  // `pendingApkg` can be replaced across the await below.
  const picked = pendingApkg;
  if (picked === null) return { status: "no-file" };

  let source = picked.source;
  if (source === null) {
    try {
      source = await readApkg(picked.filePath);
    } catch (error) {
      if (error instanceof ApkgReadError) return { status: "unreadable", code: error.code };
      throw error;
    }
    // Re-checked AFTER the await, where this can change out from under us: the
    // renderer is untrusted and nothing stops it firing a second pick while this
    // read is in flight. Unlike an archive there is no handle to leak — the file
    // is already closed — so the stale read is simply dropped.
    if (pendingApkg !== picked) return { status: "no-file" };
    picked.source = source;
  }

  const resolved = resolveApkgSubject(deps, profileId, choice);
  const translation = translateApkg(source, {
    profileId,
    subject: resolved.subject,
    now: new Date().toISOString(),
  });

  // The target is read as late as possible — immediately before planning against
  // it — for `previewImport`'s reason: every identity question the planner
  // answers is answered about the profile as it is NOW. `seededIds` is the one
  // thing added to it (ADR-052): when the user chose an EXISTING subject, the
  // translator's `apkg:subject` resolves onto that row instead of minting one.
  const plan = planForeignImport(
    // An `.apkg` has no profile picture and no private section — both facts
    // stated as the zeros they are, never inferred.
    { data: translation.data, dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } },
    { ...importTargetFor(deps, profileId), seededIds: translation.seededIds },
    uuidv7,
  );

  const token = randomBytes(16).toString("hex");
  picked.ready = {
    token,
    profileId,
    plan,
    subjectName: resolved.name,
    subjectIsNew: resolved.isNew,
    skips: translation.report.skips.map(toApkgSkip),
    sourceDecks: source.decks.length,
    sourceNotes: source.notes.length,
    sourceCards: source.cards.length,
    plannedDecks: translation.report.decks,
    plannedNotes: translation.report.notes,
    plannedCards: translation.report.cards,
  };

  return { status: "ready", preview: apkgPreviewOf(picked.fileName, picked.ready, plan) };
}

/** One `.apkg` preview on the wire, from the plan and the report that produced it. */
function apkgPreviewOf(
  fileName: string,
  ready: ReadyApkg,
  plan: ForeignImportPlan,
): ApkgImportPreview {
  return {
    token: ready.token,
    fileName,
    subjectName: ready.subjectName,
    subjectIsNew: ready.subjectIsNew,
    sourceDecks: ready.sourceDecks,
    sourceNotes: ready.sourceNotes,
    sourceCards: ready.sourceCards,
    plannedDecks: ready.plannedDecks,
    plannedNotes: ready.plannedNotes,
    plannedCards: ready.plannedCards,
    // The planner's own per-module arithmetic, reused verbatim. Its `skips` are
    // deliberately NOT carried: for an `.apkg` the only line it ever produces is
    // "the archive's settings are not imported", and an Anki deck has no
    // settings — the honest account of what does not arrive is the translator's,
    // which `ready.skips` holds.
    modules: plan.report.modules,
    skips: ready.skips,
  };
}

/**
 * Applies the ready plan identified by `token`. The import half of
 * `applyImport`, minus the one thing an `.apkg` cannot have: there are no blobs
 * to copy, because v1 carries no media at all (every image and sound is counted
 * in the preview and left behind), so the plan's `blobNames` is empty by
 * construction and there is no pre-transaction copy loop.
 *
 * Everything else is identical, deliberately: the undo snapshot is taken before
 * a single row is added, the insert is one transaction, the snapshot lands in
 * the SAME one slot both archive operations share, and the renderer reload is
 * scheduled on `setTimeout(…, 0)` so this call's reply reaches it first.
 *
 * Like `applyImport` and unlike `applyRestore`, it does NOT cancel the running
 * focus session or the idle note compactions: an import wipes nothing, so
 * discarding them would destroy user state it had no business touching.
 */
export async function applyApkgImport(
  deps: ImportDeps,
  profileId: string,
  token: string,
): Promise<ApkgImportApplyResult> {
  const ready = pendingApkg?.ready;
  if (ready === undefined || ready === null) {
    throw new Error("No .apkg preview is ready to apply.");
  }
  if (ready.token !== token) {
    throw new Error("This .apkg preview is stale; re-run the preview before applying.");
  }
  if (ready.profileId !== profileId) {
    throw new Error("This .apkg preview was computed for a different profile.");
  }

  const currentProfile = deps.getProfile(profileId);
  const undoSettings = await gatherProfileSettings(deps, profileId);
  const undoData = gatherProfileData(deps, profileId);
  const undoDerived = deriveRestoredNotes(undoData.notes);

  const now = new Date().toISOString();
  const derived = deriveRestoredNotes(ready.plan.data.notes);
  const rowsWritten = deps
    .foreignImportStore(profileId)
    .insertPlanned(ready.plan.data, derived, now);

  const summary: ApkgImportApplyResult = {
    restored: countProfileModules(ready.plan.data),
    rowsWritten,
    blobsAdded: 0,
    // An `.apkg` names no attachment row at all, so there is no blob that could
    // be missing — the media it carries is reported as a SKIP in the preview,
    // which is a different (and honest) statement.
    missingBlobs: 0,
  };

  undo = {
    kind: "apkg",
    profileId,
    // Never touches the private tables, so its undo must not either (ADR-057 §6).
    privateSealed: null,
    addedPrivateBlobs: [],
    snapshot: {
      profileName: currentProfile.name,
      profilePicture: currentProfile.picture,
      settings: undoSettings,
      data: undoData,
      derived: undoDerived,
    },
    addedBlobs: [],
    appliedAt: now,
    summary,
  };

  pendingApkg = null;

  setTimeout(() => deps.reloadRenderer(), 0);

  return summary;
}

/**
 * Drops the picked `.apkg` — what the UI calls when the user backs out before
 * applying. No file handle is released (the reader closed the file the moment it
 * finished), but the collection it read is, which on a large deck is the whole
 * of somebody's cards sitting in main's memory.
 */
export function cancelApkgImport(): void {
  pendingApkg = null;
}

// --- Calendar .ics import (ADR-061) -----------------------------------------

/**
 * The `.ics` the user picked, its PARSED calendar once a preview has read it,
 * and the plan once one has succeeded — `PendingApkg`'s shape, for its reason.
 *
 * `source` holds parsed events, never the file's text: `readIcsText`'s answer
 * lives only inside the preview call that parses it, so the pending session
 * carries rows rather than a file's worth of somebody's prose. Previewing again
 * under the other duplicate answer then costs a re-plan against the live
 * profile, never a re-read of the file.
 */
interface PendingIcs {
  filePath: string;
  fileName: string;
  /** The parsed calendar, read once. Null until the first preview succeeds. */
  source: IcsParsedCalendar | null;
  ready: ReadyIcs | null;
}

/**
 * One successful `.ics` preview, held exactly as `applyIcsImport` needs it: the
 * plan — already translated, remapped, stamped and counted, so applying writes
 * precisely what the user was shown — the parser's own report on the wire's
 * shape, and the token proving an apply is confirming THIS plan.
 */
interface ReadyIcs {
  token: string;
  /** The profile this plan was computed against — the apply refuses any other, mirroring the token check. */
  profileId: string;
  plan: ForeignImportPlan;
  sourceEvents: number;
  plannedEvents: number;
  /** Events the planner recognised as already present (ADR-051), whichever way the answer this plan was computed under points. */
  duplicates: number;
  components: IcsImportSkippedComponent[];
  skips: IcsImportSkip[];
}

/**
 * Maps one core `IcsImportSkip` onto the wire. The annotated `code` assignment
 * is the drift check every other wire→core hand-off in this file makes: a skip
 * code added in `@nexus/core` and forgotten in `shared/ipc.ts` stops this file
 * compiling, rather than reaching a renderer that has no sentence for it.
 */
function toIcsSkip(skip: CoreIcsImportSkip): IcsImportSkip {
  const code: IcsImportSkipCode = skip.code;
  return { code, count: skip.count };
}

/** Maps one core `IcsSkippedComponent` onto the wire — copied rather than passed through, because the wire shape is mutable and core's is readonly. */
function toIcsComponent(component: CoreIcsSkippedComponent): IcsImportSkippedComponent {
  return { name: component.name, count: component.count };
}

/**
 * Picks an `.ics` to import, replacing whatever was picked for one before. The
 * three picks beside it are untouched: four surfaces, four pieces of state, and
 * nothing on any of them can reach another's file.
 */
export async function pickIcsFile(deps: ImportDeps): Promise<IcsImportPickResult> {
  pendingIcs = null;

  const filePath = await deps.pickIcsFile();
  if (filePath === null) return { canceled: true };

  pendingIcs = { filePath, fileName: basename(filePath), source: null, ready: null };
  return { canceled: false, path: filePath, fileName: basename(filePath) };
}

/**
 * Reads and parses the picked `.ics` (once), translates it and really plans it
 * against this profile under `importDuplicates` — which is what makes the
 * preview a dry run rather than an estimate, on all three counts.
 *
 * Called again with the other duplicate answer, it re-uses the calendar it
 * already parsed: only the translation and the plan are redone, against the
 * profile as it is NOW. That is ADR-051's re-plan precedent in the form this
 * flow takes (the `.apkg` subject's own), and the file's raw text is not even
 * available to re-read — it was dropped inside the first preview.
 */
export async function previewIcsImport(
  deps: ImportDeps,
  profileId: string,
  importDuplicates: boolean,
): Promise<IcsImportPreviewResult> {
  // Bound to a local for exactly the reason `previewApkgImport` binds its own:
  // `pendingIcs` can be replaced across the await below.
  const picked = pendingIcs;
  if (picked === null) return { status: "no-file" };

  let source = picked.source;
  if (source === null) {
    let text: string;
    try {
      text = await readIcsText(picked.filePath);
    } catch (error) {
      if (error instanceof IcsReadError) return { status: "unreadable", code: error.code };
      throw error;
    }
    // Re-checked AFTER the await, where this can change out from under us: the
    // renderer is untrusted and nothing stops it firing a second pick while
    // this read is in flight. No handle to leak — the reader closed the file —
    // so the stale read is simply dropped.
    if (pendingIcs !== picked) return { status: "no-file" };
    const parsed = parseIcsCalendar(text);
    if (parsed.status === "failed") {
      // The drift check, in the one direction this hand-off runs: a problem
      // code added in core stops this line compiling.
      const code: IcsImportReadErrorCode = parsed.code;
      return { status: "unreadable", code };
    }
    source = parsed.calendar;
    // The parsed events are what the session keeps; `text` dies with this
    // block, which is the "raw text is dropped after parsing" the channel
    // comment promises.
    picked.source = source;
  }

  // The target is read as late as possible — immediately before planning
  // against it — for `previewImport`'s reason: every identity question the
  // planner answers is answered about the profile as it is NOW. `choices`
  // narrows to the one duplicate group an `.ics` can produce: events (ADR-051).
  const translated = translateIcsEvents(source, { profileId, now: new Date().toISOString() });
  const plan = planForeignImport(
    { data: translated, dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } },
    importTargetFor(deps, profileId),
    uuidv7,
    { event: importDuplicates ? "import" : "skip" },
  );

  const token = randomBytes(16).toString("hex");
  picked.ready = {
    token,
    profileId,
    plan,
    sourceEvents: source.sourceEvents,
    // Counted off the PLAN rather than off the parse, so the number on screen
    // is what will actually be inserted — the duplicate rule's verdict included.
    plannedEvents: plan.data.events.length,
    duplicates: plan.report.duplicates.reduce((total, group) => total + group.count, 0),
    components: source.components.map(toIcsComponent),
    skips: source.skips.map(toIcsSkip),
  };

  return { status: "ready", preview: icsPreviewOf(picked.fileName, picked.ready, plan) };
}

/** One `.ics` preview on the wire, from the plan and the report that produced it. */
function icsPreviewOf(
  fileName: string,
  ready: ReadyIcs,
  plan: ForeignImportPlan,
): IcsImportPreview {
  return {
    token: ready.token,
    fileName,
    sourceEvents: ready.sourceEvents,
    plannedEvents: ready.plannedEvents,
    duplicates: ready.duplicates,
    // The planner's own per-module arithmetic, reused verbatim. Its `skips` are
    // deliberately NOT carried, for the `.apkg` preview's reason: the only
    // by-design line it produces here is the manifest-settings one, and an
    // `.ics` has no settings — the honest account of what does not arrive is
    // the parser's, which `components` and `skips` hold.
    modules: plan.report.modules,
    components: ready.components,
    skips: ready.skips,
  };
}

/**
 * Applies the ready plan identified by `token`. The import half of
 * `applyApkgImport`, minus nothing at all: an `.ics` names no attachment, so
 * `blobNames` is empty by construction and there is no pre-transaction copy
 * loop — the same shape, for the same reason.
 *
 * Everything else is identical, deliberately: the undo snapshot is taken before
 * a single row is added, the insert is one transaction, the snapshot lands in
 * the SAME one slot every archive operation shares, and the renderer reload is
 * scheduled on `setTimeout(…, 0)` so this call's reply reaches it first.
 */
export async function applyIcsImport(
  deps: ImportDeps,
  profileId: string,
  token: string,
): Promise<IcsImportApplyResult> {
  const ready = pendingIcs?.ready;
  if (ready === undefined || ready === null) {
    throw new Error("No .ics preview is ready to apply.");
  }
  if (ready.token !== token) {
    throw new Error("This .ics preview is stale; re-run the preview before applying.");
  }
  if (ready.profileId !== profileId) {
    throw new Error("This .ics preview was computed for a different profile.");
  }

  const currentProfile = deps.getProfile(profileId);
  const undoSettings = await gatherProfileSettings(deps, profileId);
  const undoData = gatherProfileData(deps, profileId);
  const undoDerived = deriveRestoredNotes(undoData.notes);

  const now = new Date().toISOString();
  const derived = deriveRestoredNotes(ready.plan.data.notes);
  const rowsWritten = deps
    .foreignImportStore(profileId)
    .insertPlanned(ready.plan.data, derived, now);

  const summary: IcsImportApplyResult = {
    restored: countProfileModules(ready.plan.data),
    rowsWritten,
    blobsAdded: 0,
    // An `.ics` names no attachment row at all, so there is no blob that could
    // be missing.
    missingBlobs: 0,
  };

  undo = {
    kind: "ics",
    profileId,
    snapshot: {
      profileName: currentProfile.name,
      profilePicture: currentProfile.picture,
      settings: undoSettings,
      data: undoData,
      derived: undoDerived,
    },
    // An import never touches the private tables (ADR-057 §6), so its undo
    // must not either — null is precisely that instruction.
    privateSealed: null,
    addedPrivateBlobs: [],
    addedBlobs: [],
    appliedAt: now,
    summary,
  };

  pendingIcs = null;

  setTimeout(() => deps.reloadRenderer(), 0);

  return summary;
}

/**
 * Drops the picked `.ics` — what the UI calls when the user backs out before
 * applying. No file handle is released (the reader closed the file before the
 * preview answered), but the parsed calendar is, which on a busy calendar is
 * years of somebody's appointments sitting in main's memory.
 */
export function cancelIcsImport(): void {
  pendingIcs = null;
}

// --- LLM-assisted import (IMEX-005) -----------------------------------------

/**
 * One successful LLM preview, held exactly as `applyLlmImport` and
 * `replanLlmImport` need it: the plan — already translated, remapped, stamped
 * and counted, so applying writes precisely what the user was shown — plus what
 * a re-plan re-uses, and the token proving either call is confirming THIS plan.
 *
 * What a re-plan re-uses is the PARSED RECORDS and their report, never the raw
 * text: the paste has already been read once, and its answer cannot change, so
 * keeping the prose around would be holding more of the user's content in
 * main's heap than the flow needs — exactly what `clearRestoreState` exists to
 * prevent. The deck choice is kept as the WIRE shape and re-resolved against
 * the live stores each time, for the reason `replanImport` re-reads its target:
 * "now" has moved since the preview.
 */
interface ReadyLlm {
  token: string;
  /** The profile this plan was computed against — the apply refuses any other, mirroring the token check. */
  profileId: string;
  kind: LlmImportKind;
  parsed: LlmRecords;
  report: LlmAnswerReport;
  deck: LlmImportDeckChoice | null;
  /** The duplicate answer the plan was computed under (ADR-051) — `false`, the safe default, until a re-plan says otherwise. */
  importDuplicates: boolean;
  plan: ForeignImportPlan;
  preview: LlmImportPreview;
}

/** Maps one core `LlmSkippedRecord` onto the wire. The annotated `reason` assignment is the drift check every other core→wire hand-off in this file makes. */
function toLlmSkip(skip: LlmSkippedRecord): LlmImportSkip {
  const reason: LlmImportSkipReason = skip.reason;
  return { index: skip.index, reason, field: skip.field };
}

/**
 * What preview and re-plan share: translate the parsed records, really plan
 * them against the profile as it is NOW, and mint the fresh token the result is
 * named by — `importPreviewOf`'s role here, so the two calls can never describe
 * the same answer differently. The ONLY things that legitimately differ between
 * them are the inputs this takes.
 *
 * `choices` narrows to the one duplicate group an LLM answer can produce:
 * events (ADR-051). The other three groups need no answer, because the
 * translation cannot plan a person, a document or an attachment at all.
 */
function planLlm(
  deps: ImportDeps,
  profileId: string,
  kind: LlmImportKind,
  parsed: LlmRecords,
  report: LlmAnswerReport,
  deck: LlmImportDeckChoice | null,
  importDuplicates: boolean,
): ReadyLlm {
  const translation = translateLlmRecords(parsed, {
    profileId,
    now: new Date().toISOString(),
    deck: kind === "cards" ? resolveLlmDeck(deps, profileId, deck) : null,
  });

  // The target is read as late as possible — immediately before planning
  // against it — for `previewImport`'s reason: every identity question the
  // planner answers is answered about the profile as it is NOW. `seededIds` is
  // the one thing added to it (ADR-052's seam): a card import resolves its
  // `llm:deck` name onto the deck the user picked — or, for a new deck, its
  // `llm:subject` onto the chosen subject, and the deck row is then minted
  // exactly as every other planned row is.
  const plan = planForeignImport(
    // A pasted LLM answer has no profile picture and no private section —
    // both facts stated as the zeros they are, never inferred.
    { data: translation.data, dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } },
    { ...importTargetFor(deps, profileId), seededIds: translation.seededIds },
    uuidv7,
    { event: importDuplicates ? "import" : "skip" },
  );

  // Counted off the PLAN rather than off the translation, so the number on
  // screen is what will actually be inserted: the planner's duplicate rule
  // (ADR-051) takes events this profile already has out of it — unless the
  // user said otherwise — and `duplicates` below says how many it recognised.
  // One kind touches one module, so summing the three this import can reach is
  // exactly the row count.
  const planned = countProfileModules(plan.data);

  const token = randomBytes(16).toString("hex");
  const preview: LlmImportPreview = {
    token,
    kind,
    records: report.total,
    accepted: report.accepted,
    planned: planned.tasks + planned.calendar + planned.study,
    duplicates: plan.report.duplicates.reduce((total, group) => total + group.count, 0),
    skipped: report.skipped.map(toLlmSkip),
    droppedFields: report.droppedFields,
  };

  return { token, profileId, kind, parsed, report, deck, importDuplicates, plan, preview };
}

/**
 * Parses one pasted chat answer and really plans it against this profile —
 * which is what makes the preview a dry run rather than an estimate, exactly as
 * it is for the three file-shaped imports.
 *
 * `kind` is the screen's own picker, and an answer that declares a DIFFERENT one
 * is refused rather than imported: a user who asked for zadaci and pasted an
 * answer full of events is one click from writing rows into a module they were
 * not looking at. The refusal names what the answer actually was, so the fix is
 * obvious.
 *
 * `deck` is checked in `resolveLlmDeck`, not at the IPC edge, for
 * `resolveApkgSubject`'s reason: whether a deck or a subject EXISTS in this
 * profile is a semantic question only the live stores can answer.
 *
 * Always planned on the safe duplicate default — every recognised event
 * skipped (ADR-051) — because the user has not been shown the count yet, let
 * alone answered it. `replanLlmImport` is what carries an answer back.
 */
export function previewLlmImport(
  deps: ImportDeps,
  profileId: string,
  kind: LlmImportKind,
  text: string,
  deck: LlmImportDeckChoice | null,
): LlmImportPreviewResult {
  pendingLlm = null;

  const answer = parseLlmAnswer(text);
  if (answer.status === "failed") {
    const code: LlmImportAnswerProblem = answer.code;
    return { status: "unreadable", code };
  }
  if (answer.parsed.kind !== kind) {
    const answered: LlmImportKind = answer.parsed.kind;
    return { status: "kind-mismatch", answered };
  }

  pendingLlm = planLlm(deps, profileId, kind, answer.parsed, answer.report, deck, false);
  return { status: "ready", preview: pendingLlm.preview };
}

/**
 * Re-plans the answer this preview already parsed, under a different duplicate
 * choice (ADR-051), and answers a whole fresh preview — `replanImport`'s twin,
 * minus the parse it never needs to redo: the records are already records, so a
 * re-plan is a re-translate and a fresh planning pass against the live profile.
 * Changing a choice must not re-send (or re-hold) the paste.
 *
 * Synchronous on purpose, exactly as `replanImport` is: there is no `await`
 * below the guards, so `pendingLlm` cannot be replaced out from under this
 * call. A FRESH token, and the slot replaced wholesale — the plan the previous
 * token named no longer exists, so a screen still holding it must not be able
 * to apply it. When the re-plan itself throws (a deck deleted since the
 * preview), the slot is left untouched and the token on screen still applies
 * the plan the user already saw.
 */
export function replanLlmImport(
  deps: ImportDeps,
  profileId: string,
  token: string,
  importDuplicates: boolean,
): LlmImportPreviewResult {
  const ready = pendingLlm;
  if (ready === null) {
    throw new Error("No LLM import preview is ready to re-plan.");
  }
  if (ready.token !== token) {
    throw new Error("This LLM import preview is stale; re-run the preview before re-planning it.");
  }
  if (ready.profileId !== profileId) {
    throw new Error("This LLM import preview was computed for a different profile.");
  }

  pendingLlm = planLlm(
    deps,
    profileId,
    ready.kind,
    ready.parsed,
    ready.report,
    ready.deck,
    importDuplicates,
  );
  return { status: "ready", preview: pendingLlm.preview };
}

/**
 * The renderer's deck choice, resolved against the profile as it is NOW —
 * `resolveApkgSubject`'s twin, and split from the IPC edge for the same reason:
 * `main/index.ts` proves the payload's shape, and this proves the rows it names
 * are live rows of THIS profile. A renderer naming another profile's deck or
 * subject — or a soft-deleted one — must be refused, not planned around.
 *
 * A new deck is GET-OR-CREATE by exact name within the chosen subject: the
 * store has no name-taken rule (two decks called „Kolokvijum" may coexist), but
 * a user typing a name their subject already carries means THAT deck, and a
 * silent second one under the same name would be indistinguishable from it on
 * every screen. Exact string equality after the store's own trim — the same
 * deliberate strictness `mintTags` applies, and for the same reason: folding
 * case here would merge decks the app itself considers distinct.
 */
function resolveLlmDeck(
  deps: ImportDeps,
  profileId: string,
  choice: LlmImportDeckChoice | null,
): LlmDeckChoice {
  if (choice === null) {
    throw new Error("An LLM card import needs a deck for the cards to land in.");
  }
  const decks = deps.deckStore(profileId).listActive();
  if ("existingDeckId" in choice) {
    const deck = decks.find((row) => row.id === choice.existingDeckId);
    if (deck === undefined) {
      throw new Error(`No active deck "${choice.existingDeckId}" in this profile.`);
    }
    return { kind: "existing", id: deck.id };
  }
  const name = choice.newDeckName.trim();
  if (name.length === 0) {
    throw new Error("An LLM card import needs a name for the new deck.");
  }
  const subject = deps
    .subjectStore(profileId)
    .listActive()
    .find((row) => row.id === choice.subjectId);
  if (subject === undefined) {
    throw new Error(`No active subject "${choice.subjectId}" in this profile.`);
  }
  const existing = decks.find((row) => row.subjectId === subject.id && row.name === name);
  if (existing !== undefined) return { kind: "existing", id: existing.id };
  return { kind: "new", name, subjectId: subject.id };
}

/**
 * Applies the ready plan identified by `token`. The import half of
 * `applyApkgImport`, minus nothing at all: an LLM answer names no attachment, so
 * `blobNames` is empty by construction and there is no pre-transaction copy
 * loop — the same shape, for the same reason.
 *
 * Everything else is identical, deliberately: the undo snapshot is taken before
 * a single row is added, the insert is one transaction, the snapshot lands in
 * the SAME one slot every archive operation shares, and the renderer reload is
 * scheduled on `setTimeout(…, 0)` so this call's reply reaches it first.
 */
export async function applyLlmImport(
  deps: ImportDeps,
  profileId: string,
  token: string,
): Promise<LlmImportApplyResult> {
  const ready = pendingLlm;
  if (ready === null) throw new Error("No LLM import preview is ready to apply.");
  if (ready.token !== token) {
    throw new Error("This LLM import preview is stale; re-run the preview before applying.");
  }
  if (ready.profileId !== profileId) {
    throw new Error("This LLM import preview was computed for a different profile.");
  }

  const currentProfile = deps.getProfile(profileId);
  const undoSettings = await gatherProfileSettings(deps, profileId);
  const undoData = gatherProfileData(deps, profileId);
  const undoDerived = deriveRestoredNotes(undoData.notes);

  const now = new Date().toISOString();
  const derived = deriveRestoredNotes(ready.plan.data.notes);
  const rowsWritten = deps
    .foreignImportStore(profileId)
    .insertPlanned(ready.plan.data, derived, now);

  const summary: LlmImportApplyResult = {
    restored: countProfileModules(ready.plan.data),
    rowsWritten,
    blobsAdded: 0,
    // An LLM answer names no attachment row at all, so there is no blob that
    // could be missing.
    missingBlobs: 0,
  };

  undo = {
    kind: "llm",
    profileId,
    // Never touches the private tables, so its undo must not either (ADR-057 §6).
    privateSealed: null,
    addedPrivateBlobs: [],
    snapshot: {
      profileName: currentProfile.name,
      profilePicture: currentProfile.picture,
      settings: undoSettings,
      data: undoData,
      derived: undoDerived,
    },
    addedBlobs: [],
    appliedAt: now,
    summary,
  };

  pendingLlm = null;

  setTimeout(() => deps.reloadRenderer(), 0);

  return summary;
}

/** Drops the parsed answer — what the UI calls when the user backs out before applying. What it releases is the plan, which carries the user's own pasted content. */
export function cancelLlmImport(): void {
  pendingLlm = null;
}

// --- CSV task import (ADR-062) -----------------------------------------------

/**
 * The CSV the user picked, its TEXT once read, the PARSE the last preview
 * produced, and the plan once a mapping has been confirmed.
 *
 * `text` is what makes a delimiter or header toggle cheap — the `.apkg`
 * pattern's property, bought the same way: the file is read once, and a
 * re-preview under an override re-parses bytes already in memory, never the
 * file. `table` holds the parsed CELLS in main between the preview and the
 * mapping, which is the whole point of the session (SEC-EL): the renderer
 * sends role assignments and choices back, never data.
 *
 * Its own shape rather than `PickedArchive`'s, for `PendingApkg`'s reason: no
 * handle is held (the reader closes the file before it returns) and there is
 * no `encrypted` flag to carry.
 */
interface PendingCsv {
  filePath: string;
  fileName: string;
  /** The file's decoded text, read once. Null until the first preview reads it. */
  text: string | null;
  /** The parse the LAST preview produced — the rows a mapping is applied against. */
  table: CsvTable | null;
  ready: ReadyCsv | null;
}

/** One preview's parse, under its delimiter/header choice. `rows` are DATA rows — the header, when there is one, is already off. */
interface CsvTable {
  delimiter: CsvImportDelimiter;
  hasHeader: boolean;
  /** The widest row's cell count — what a mapping's `roles` array must match. */
  columnCount: number;
  rows: string[][];
}

/**
 * One CSV text turned into the mapping step's table, under the delimiter and
 * header choice the request named (or the sniff's own answer). Shared by BOTH
 * CSV surfaces — the task import (ADR-062) and the bank statement (FIN slice e)
 * — because everything up to „which column is which" is the same question about
 * the same file, and a second copy of it would be a second set of caps to keep
 * in step.
 *
 * What the two surfaces do NOT share is the role vocabulary, which is exactly
 * why the suggestion is left to each caller: `suggestCsvRoles` takes the table,
 * and the two tables answer different questions about the same header.
 */
function parseCsvTable(
  text: string,
  delimiter: CsvImportDelimiter | null,
  hasHeader: boolean | null,
):
  | { code: CsvImportReadErrorCode }
  | {
      chosenDelimiter: CsvImportDelimiter;
      withHeader: boolean;
      columnCount: number;
      rows: string[][];
      headers: (string | null)[];
    } {
  const chosenDelimiter = delimiter ?? sniffCsvDelimiter(text);
  const parsed = parseCsv(text, chosenDelimiter);
  if (parsed.length === 0) return { code: "empty" };

  let columnCount = 0;
  for (const row of parsed) columnCount = Math.max(columnCount, row.length);
  if (columnCount > CSV_IMPORT_MAX_COLUMNS) return { code: "too-many-columns" };

  const headerRow = parsed[0] ?? [];
  const withHeader = hasHeader ?? sniffCsvHeader(headerRow);
  const rows = withHeader ? parsed.slice(1) : parsed;
  // A header-only file has nothing to map — the same honest refusal an empty
  // file gets, because for the user the two are the same fact.
  if (rows.length === 0) return { code: "empty" };

  const headers: (string | null)[] = Array.from({ length: columnCount }, (_, index) =>
    withHeader ? (headerRow[index] ?? "") : null,
  );
  return { chosenDelimiter, withHeader, columnCount, rows, headers };
}

/**
 * One confirmed mapping's plan, held exactly as `applyCsvImport` needs it: the
 * plan — already translated, remapped and counted, so applying writes
 * precisely what the user was shown — the destination list as the preview
 * named it, the translator's own report, and the token proving an apply is
 * confirming THIS plan.
 */
interface ReadyCsv {
  token: string;
  /** The profile this plan was computed against — the apply refuses any other, mirroring the token check. */
  profileId: string;
  plan: ForeignImportPlan;
  listName: string;
  listIsNew: boolean;
  report: CsvTranslateReport;
}

/**
 * Picks a CSV to import, replacing whatever was picked for one before. Every
 * other surface's pick is untouched: five surfaces, five pieces of state, and
 * nothing on any of them can reach another's file.
 */
export async function pickCsvFile(deps: ImportDeps): Promise<CsvImportPickResult> {
  pendingCsv = null;

  const filePath = await deps.pickCsvFile();
  if (filePath === null) return { canceled: true };

  pendingCsv = { filePath, fileName: basename(filePath), text: null, table: null, ready: null };
  return { canceled: false, path: filePath, fileName: basename(filePath) };
}

/**
 * Reads the picked CSV (once) and parses it into the mapping step's columns:
 * header names, the first sample values, and the SUGGESTED role per column —
 * a suggestion the user confirms, never a silent guess (ADR-062).
 *
 * `delimiter`/`hasHeader` are the dialog's overrides; null means the sniff
 * decides. Called again with either changed, it re-parses the text it already
 * read — the `.apkg` re-preview precedent, one file format over: changing a
 * toggle must not cost what reading the file cost.
 *
 * Any previous READY plan is dropped whichever way this call ends in a fresh
 * parse: a plan's roles were confirmed against the parse that produced them,
 * and a screen still holding its token must not be able to apply it over a
 * table whose columns may no longer line up.
 */
export async function previewCsvImport(
  deps: ImportDeps,
  delimiter: CsvImportDelimiter | null,
  hasHeader: boolean | null,
): Promise<CsvImportPreviewResult> {
  // Bound to a local for exactly the reason `previewApkgImport` binds its own:
  // `pendingCsv` can be replaced across the await below.
  const picked = pendingCsv;
  if (picked === null) return { status: "no-file" };

  let text = picked.text;
  if (text === null) {
    try {
      text = await readCsvText(picked.filePath);
    } catch (error) {
      if (error instanceof CsvReadError) return { status: "unreadable", code: error.code };
      throw error;
    }
    // Re-checked AFTER the await, where this can change out from under us: the
    // renderer is untrusted and nothing stops it firing a second pick while
    // this read is in flight. No handle to leak — the file is already closed —
    // so the stale read is simply dropped.
    if (pendingCsv !== picked) return { status: "no-file" };
    picked.text = text;
  }

  const parse = parseCsvTable(text, delimiter, hasHeader);
  if ("code" in parse) return { status: "unreadable", code: parse.code };
  const { chosenDelimiter, withHeader, columnCount, rows, headers } = parse;

  const suggested = suggestCsvMapping(headers);
  const columns: CsvImportColumn[] = headers.map((header, index) => {
    // The drift check every core→wire hand-off in this file makes: a role
    // added in `@nexus/core` and forgotten in `shared/ipc.ts` stops this line
    // compiling rather than reaching a select that has no option for it.
    const suggestedRole: CsvImportColumnRole = suggested[index] ?? "ignore";
    return {
      header,
      samples: rows.slice(0, CSV_IMPORT_SAMPLE_ROWS).map((row) => row[index] ?? ""),
      suggestedRole,
    };
  });

  picked.table = { delimiter: chosenDelimiter, hasHeader: withHeader, columnCount, rows };
  picked.ready = null;

  return {
    status: "ready",
    preview: {
      fileName: picked.fileName,
      delimiter: chosenDelimiter,
      hasHeader: withHeader,
      columns,
      rows: rows.length,
    },
  };
}

/**
 * The renderer's destination-list choice, resolved against the profile as it
 * is NOW — `resolveApkgSubject`'s twin, split from the IPC edge for the same
 * reason: `main/index.ts` proves the payload's shape, and this proves the list
 * it names is a live list of THIS profile.
 *
 * A new name is GET-OR-CREATE by exact string, `resolveLlmDeck`'s own rule and
 * for its stated reason: a user typing a name their profile already carries
 * means THAT list, and a silent second one under the same name would be
 * indistinguishable from it on every screen.
 */
function resolveCsvList(
  deps: ImportDeps,
  profileId: string,
  choice: CsvImportListChoice,
): { list: CsvListChoice; name: string; isNew: boolean } {
  const lists = deps.taskListStore(profileId).listActive();
  if (choice.existingListId !== null) {
    const row = lists.find((list) => list.id === choice.existingListId);
    if (row === undefined) {
      throw new Error(`No active list "${choice.existingListId}" in this profile.`);
    }
    return { list: { kind: "existing", id: row.id }, name: row.name, isNew: false };
  }
  const name = (choice.newListName ?? "").trim();
  if (name.length === 0) {
    throw new Error("A CSV import needs either an existing list or a name for a new one.");
  }
  const existing = lists.find((row) => row.name === name);
  if (existing !== undefined) {
    return { list: { kind: "existing", id: existing.id }, name: existing.name, isNew: false };
  }
  return { list: { kind: "new", name }, name, isNew: true };
}

/** The translator's drops on the wire — copied member by member, with the annotated `code` as this surface's core→wire drift check. */
function toCsvDrops(report: CsvTranslateReport): CsvImportRowDrop[] {
  return report.drops.map((drop) => {
    const code: CsvImportRowDrop["code"] = drop.code;
    return { row: drop.row, code };
  });
}

/**
 * Applies the user's CONFIRMED mapping against the rows the session already
 * holds and really plans the result against this profile — the dry run the
 * apply then writes verbatim. The renderer sent role assignments and a list
 * choice; the data never left main (SEC-EL).
 *
 * Synchronous on purpose, exactly as `replanImport` is: no `await` anywhere
 * below the guards, so `pendingCsv` cannot be replaced out from under this
 * call. Called again with different roles or a different list, it re-plans the
 * same rows and mints a FRESH token — the plan the previous token named no
 * longer exists, so a screen still holding it cannot apply it.
 *
 * `roles` is validated here against the SESSION — its length must be the
 * table's own column count, which the IPC edge cannot know — while the shape
 * of each entry was already proven at the edge. `translateCsvTasks` re-checks
 * the mapping's soundness (one title, no repeats) as every store re-checks
 * semantics: the edge's check is the wire's, not the contract's.
 */
export function mapCsvImport(
  deps: ImportDeps,
  profileId: string,
  roles: readonly CsvImportColumnRole[],
  choice: CsvImportListChoice,
): CsvImportMapResult {
  const picked = pendingCsv;
  const table = picked?.table ?? null;
  if (picked === null || table === null) return { status: "no-file" };
  if (roles.length !== table.columnCount) {
    throw new Error(
      `CSV mapping names ${roles.length} columns; the parsed file has ${table.columnCount}.`,
    );
  }

  const resolved = resolveCsvList(deps, profileId, choice);
  // The drift check in the wire→core direction, `replanImport`'s own: a role
  // added on either side alone stops this line compiling.
  const plannerRoles: CoreCsvColumnRole[] = [...roles];
  const translation = translateCsvTasks(table.rows, plannerRoles, {
    profileId,
    now: new Date().toISOString(),
    list: resolved.list,
  });

  // The target is read as late as possible — immediately before planning
  // against it — for `previewImport`'s reason: every identity question the
  // planner answers is answered about the profile as it is NOW. `seededIds`
  // is ADR-052's seam, one surface over: an EXISTING list resolves the
  // translator's `csv:list` onto that row and no list row is created.
  const plan = planForeignImport(
    { data: translation.data, dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } },
    { ...importTargetFor(deps, profileId), seededIds: translation.seededIds },
    uuidv7,
  );

  const token = randomBytes(16).toString("hex");
  picked.ready = {
    token,
    profileId,
    plan,
    listName: resolved.name,
    listIsNew: resolved.isNew,
    report: translation.report,
  };

  return { status: "ready", preview: csvPlanPreviewOf(picked.fileName, picked.ready) };
}

/** One CSV plan preview on the wire, from the plan and the report that produced it. */
function csvPlanPreviewOf(fileName: string, ready: ReadyCsv): CsvImportPlanPreview {
  return {
    token: ready.token,
    fileName,
    listName: ready.listName,
    listIsNew: ready.listIsNew,
    rows: ready.report.rows,
    tasks: ready.report.tasks,
    blankRows: ready.report.blankRows,
    // The planner's own per-module arithmetic, reused verbatim — its merged
    // column is the tag merge the preview promises. Its `skips` are
    // deliberately NOT carried, for the `.apkg` preview's reason: the honest
    // account of what a SPREADSHEET loses is the translator's, below.
    modules: ready.plan.report.modules,
    drops: toCsvDrops(ready.report),
    listCellsDropped: ready.report.listCellsDropped,
  };
}

/**
 * Applies the ready plan identified by `token`. The import half of
 * `applyApkgImport`, minus nothing at all: a CSV names no attachment, so
 * `blobNames` is empty by construction and there is no pre-transaction copy
 * loop — the same shape, for the same reason.
 *
 * Everything else is identical, deliberately: the undo snapshot is taken
 * before a single row is added, the insert is one transaction, the snapshot
 * lands in the SAME one slot every archive operation shares, and the renderer
 * reload is scheduled on `setTimeout(…, 0)` so this call's reply reaches it
 * first.
 */
export async function applyCsvImport(
  deps: ImportDeps,
  profileId: string,
  token: string,
): Promise<CsvImportApplyResult> {
  const ready = pendingCsv?.ready;
  if (ready === undefined || ready === null) {
    throw new Error("No CSV mapping is ready to apply.");
  }
  if (ready.token !== token) {
    throw new Error("This CSV plan is stale; re-run the mapping before applying.");
  }
  if (ready.profileId !== profileId) {
    throw new Error("This CSV plan was computed for a different profile.");
  }

  const currentProfile = deps.getProfile(profileId);
  const undoSettings = await gatherProfileSettings(deps, profileId);
  const undoData = gatherProfileData(deps, profileId);
  const undoDerived = deriveRestoredNotes(undoData.notes);

  const now = new Date().toISOString();
  const derived = deriveRestoredNotes(ready.plan.data.notes);
  const rowsWritten = deps
    .foreignImportStore(profileId)
    .insertPlanned(ready.plan.data, derived, now);

  const summary: CsvImportApplyResult = {
    restored: countProfileModules(ready.plan.data),
    rowsWritten,
    blobsAdded: 0,
    // A CSV names no attachment row at all, so there is no blob that could be
    // missing — what the spreadsheet loses is reported as the plan's own
    // drops, which is a different (and honest) statement.
    missingBlobs: 0,
  };

  undo = {
    kind: "csv",
    profileId,
    snapshot: {
      profileName: currentProfile.name,
      profilePicture: currentProfile.picture,
      settings: undoSettings,
      data: undoData,
      derived: undoDerived,
    },
    // An import never touches the private tables (ADR-057 §6), so its undo
    // must not either — null is precisely that instruction.
    privateSealed: null,
    addedPrivateBlobs: [],
    addedBlobs: [],
    appliedAt: now,
    summary,
  };

  pendingCsv = null;

  setTimeout(() => deps.reloadRenderer(), 0);

  return summary;
}

/**
 * Drops the picked CSV — what the UI calls when the user backs out before
 * applying. No file handle is released (the reader closed the file the moment
 * it finished), but the text and parsed cells are, which is somebody's whole
 * task list sitting in main's memory.
 */
export function cancelCsvImport(): void {
  pendingCsv = null;
}

// --- Bank statement CSV → FIN (FIN slice e) ----------------------------------

/**
 * The statement the user picked, its TEXT once read, the PARSE the last preview
 * produced, and the plan once a mapping has been confirmed — `PendingCsv`'s
 * shape exactly, and for its reasons: the file is read once so a delimiter or
 * header toggle costs nothing, and the parsed CELLS stay in main between the
 * preview and the mapping, which is the whole point of the session (SEC-EL).
 *
 * Its own variable rather than a mode on `pendingCsv`: the two surfaces write
 * different tables, and a shared pick would be one field away from letting a
 * statement land in somebody's task list.
 */
interface PendingFinCsv {
  filePath: string;
  fileName: string;
  /** The file's decoded text, read once. Null until the first preview reads it. */
  text: string | null;
  /** The parse the LAST preview produced — the rows a mapping is applied against. */
  table: CsvTable | null;
  ready: ReadyFinCsv | null;
}

/** One confirmed mapping's plan, held exactly as `applyFinCsvImport` needs it. */
interface ReadyFinCsv {
  token: string;
  /** The profile this plan was computed against — the apply refuses any other, mirroring the token check. */
  profileId: string;
  plan: ForeignImportPlan;
  accountName: string;
  currency: string;
  report: CsvFinanceReport;
  amountFormat: FinCsvImportPlanPreview["amountFormat"];
  dateFormat: FinCsvImportPlanPreview["dateFormat"];
  signConvention: FinCsvImportSignConvention;
}

/**
 * Picks a bank statement to import, replacing whatever was picked for one
 * before. Every other surface's pick is untouched: six surfaces, six pieces of
 * state, and nothing on any of them can reach another's file.
 */
export async function pickFinCsvFile(deps: ImportDeps): Promise<CsvImportPickResult> {
  pendingFinCsv = null;

  const filePath = await deps.pickFinCsvFile();
  if (filePath === null) return { canceled: true };

  pendingFinCsv = { filePath, fileName: basename(filePath), text: null, table: null, ready: null };
  return { canceled: false, path: filePath, fileName: basename(filePath) };
}

/**
 * Reads the picked statement (once) and parses it into the mapping step's
 * columns — `previewCsvImport`'s twin over the statement role vocabulary, down
 * to the stale-pick re-check after the await and the dropped READY plan: a
 * plan's roles were confirmed against the parse that produced them, and a screen
 * still holding its token must not be able to apply it over a table whose
 * columns may no longer line up.
 */
export async function previewFinCsvImport(
  deps: ImportDeps,
  delimiter: CsvImportDelimiter | null,
  hasHeader: boolean | null,
): Promise<FinCsvImportPreviewResult> {
  const picked = pendingFinCsv;
  if (picked === null) return { status: "no-file" };

  let text = picked.text;
  if (text === null) {
    try {
      text = await readCsvText(picked.filePath);
    } catch (error) {
      if (error instanceof CsvReadError) return { status: "unreadable", code: error.code };
      throw error;
    }
    // Re-checked AFTER the await, where this can change out from under us: the
    // renderer is untrusted and nothing stops it firing a second pick while
    // this read is in flight. No handle to leak — the file is already closed.
    if (pendingFinCsv !== picked) return { status: "no-file" };
    picked.text = text;
  }

  const parse = parseCsvTable(text, delimiter, hasHeader);
  if ("code" in parse) return { status: "unreadable", code: parse.code };
  const { chosenDelimiter, withHeader, columnCount, rows, headers } = parse;

  const suggested = suggestCsvFinanceMapping(headers);
  const columns: FinCsvImportColumn[] = headers.map((header, index) => {
    // The drift check every core→wire hand-off in this file makes: a role added
    // in `@nexus/core` and forgotten in `shared/ipc.ts` stops this line
    // compiling rather than reaching a select that has no option for it.
    const suggestedRole: FinCsvImportColumnRole = suggested[index] ?? "ignore";
    return {
      header,
      samples: rows.slice(0, CSV_IMPORT_SAMPLE_ROWS).map((row) => row[index] ?? ""),
      suggestedRole,
    };
  });

  picked.table = { delimiter: chosenDelimiter, hasHeader: withHeader, columnCount, rows };
  picked.ready = null;

  return {
    status: "ready",
    preview: {
      fileName: picked.fileName,
      delimiter: chosenDelimiter,
      hasHeader: withHeader,
      columns,
      rows: rows.length,
    },
  };
}

/** The translator's drops and skips on the wire — copied member by member, with the annotated codes as this surface's core→wire drift check. */
function toFinCsvDrops(report: CsvFinanceReport): {
  drops: FinCsvImportRowDrop[];
  skips: FinCsvImportRowSkip[];
} {
  return {
    drops: report.drops.map((drop) => {
      const code: FinCsvImportRowDrop["code"] = drop.code;
      return { row: drop.row, code };
    }),
    skips: report.skips.map((skip) => {
      const code: FinCsvImportRowSkip["code"] = skip.code;
      return { row: skip.row, code };
    }),
  };
}

/**
 * Applies the user's CONFIRMED mapping against the rows the session already
 * holds and really plans the result against this profile — the dry run the apply
 * then writes verbatim. The renderer sent role assignments, an account id and a
 * sign convention; the data never left main (SEC-EL).
 *
 * Synchronous on purpose, exactly as `mapCsvImport` is: no `await` anywhere
 * below the guards, so `pendingFinCsv` cannot be replaced out from under this
 * call. Called again with different answers, it re-plans the same rows and mints
 * a FRESH token.
 *
 * The ACCOUNT is resolved against the profile as it is NOW, and its currency is
 * what governs: the amounts are scaled by that currency's own exponent, and a
 * statement carrying a different one is refused by name rather than converted
 * (there is no rate anywhere in this app that could do it honestly).
 *
 * The already-imported check reads migration 052's fingerprints for THAT
 * account immediately before translating, for `previewImport`'s reason: every
 * identity question is answered about the profile as it is now.
 */
export function mapFinCsvImport(
  deps: ImportDeps,
  profileId: string,
  roles: readonly FinCsvImportColumnRole[],
  accountId: string,
  signConvention: FinCsvImportSignConvention,
): FinCsvImportMapResult {
  const picked = pendingFinCsv;
  const table = picked?.table ?? null;
  if (picked === null || table === null) return { status: "no-file" };
  if (roles.length !== table.columnCount) {
    throw new Error(
      `Statement mapping names ${roles.length} columns; the parsed file has ${table.columnCount}.`,
    );
  }

  // `main/index.ts` proved the payload's shape; this proves the account it names
  // is a LIVE account of THIS profile — `resolveCsvList`'s split, one surface
  // over. There is no get-or-create twin here: an account carries a currency and
  // an opening balance a statement cannot supply, so the choice is an existing
  // account or nothing.
  const account = deps
    .finAccountStore(profileId)
    .listActive()
    .find((row) => row.id === accountId);
  if (account === undefined) {
    throw new Error(`No active account "${accountId}" in this profile.`);
  }

  // The drift check in the wire→core direction, `replanImport`'s own: a role
  // added on either side alone stops this line compiling.
  const plannerRoles: CoreCsvFinanceColumnRole[] = [...roles];
  const convention: CsvFinanceSignConvention = signConvention;
  const translation = translateCsvFinance(table.rows, plannerRoles, {
    profileId,
    now: new Date().toISOString(),
    accountId: account.id,
    currency: account.currency,
    signConvention: convention,
    knownKeys: deps.finTransactionStore(profileId).importedKeys(account.id),
  });
  if (translation.status === "refused") {
    picked.ready = null;
    const refusal: FinCsvImportRefusal = {
      // The same drift check, on the refusal domain.
      code: translation.refusal.code,
      column: translation.refusal.column,
      sample: translation.refusal.sample,
    };
    return { status: "refused", refusal };
  }

  const plan = planForeignImport(
    { data: translation.data, dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } },
    { ...importTargetFor(deps, profileId), seededIds: translation.seededIds },
    uuidv7,
  );

  const token = randomBytes(16).toString("hex");
  picked.ready = {
    token,
    profileId,
    plan,
    accountName: account.name,
    currency: account.currency,
    report: translation.report,
    amountFormat: translation.formats.amount,
    dateFormat: translation.formats.date,
    signConvention,
  };

  return { status: "ready", preview: finCsvPlanPreviewOf(picked.fileName, picked.ready) };
}

/** One statement plan preview on the wire, from the plan and the report that produced it. */
function finCsvPlanPreviewOf(fileName: string, ready: ReadyFinCsv): FinCsvImportPlanPreview {
  const { drops, skips } = toFinCsvDrops(ready.report);
  return {
    token: ready.token,
    fileName,
    accountName: ready.accountName,
    currency: ready.currency,
    rows: ready.report.rows,
    transactions: ready.report.transactions,
    blankRows: ready.report.blankRows,
    // The planner's own per-module arithmetic, reused verbatim. Its `skips` are
    // deliberately NOT carried, for the `.apkg` preview's reason: the honest
    // account of what a STATEMENT loses is the translator's, above.
    modules: ready.plan.report.modules,
    drops,
    skips,
    amountFormat: ready.amountFormat,
    dateFormat: ready.dateFormat,
    signConvention: ready.signConvention,
  };
}

/**
 * Applies the ready plan identified by `token` — `applyCsvImport` verbatim, and
 * for its reasons: a statement names no attachment, so `blobNames` is empty by
 * construction and there is no pre-transaction copy loop. The undo snapshot is
 * taken before a single row is added, the insert is one transaction, and the
 * snapshot lands in the SAME one slot every archive operation shares.
 */
export async function applyFinCsvImport(
  deps: ImportDeps,
  profileId: string,
  token: string,
): Promise<FinCsvImportApplyResult> {
  const ready = pendingFinCsv?.ready;
  if (ready === undefined || ready === null) {
    throw new Error("No statement mapping is ready to apply.");
  }
  if (ready.token !== token) {
    throw new Error("This statement plan is stale; re-run the mapping before applying.");
  }
  if (ready.profileId !== profileId) {
    throw new Error("This statement plan was computed for a different profile.");
  }

  const currentProfile = deps.getProfile(profileId);
  const undoSettings = await gatherProfileSettings(deps, profileId);
  const undoData = gatherProfileData(deps, profileId);
  const undoDerived = deriveRestoredNotes(undoData.notes);

  const now = new Date().toISOString();
  const derived = deriveRestoredNotes(ready.plan.data.notes);
  const rowsWritten = deps
    .foreignImportStore(profileId)
    .insertPlanned(ready.plan.data, derived, now);

  const summary: FinCsvImportApplyResult = {
    restored: countProfileModules(ready.plan.data),
    rowsWritten,
    blobsAdded: 0,
    missingBlobs: 0,
  };

  undo = {
    kind: "fin-csv",
    profileId,
    snapshot: {
      profileName: currentProfile.name,
      profilePicture: currentProfile.picture,
      settings: undoSettings,
      data: undoData,
      derived: undoDerived,
    },
    // An import never touches the private tables (ADR-057 §6), so its undo must
    // not either — null is precisely that instruction.
    privateSealed: null,
    addedPrivateBlobs: [],
    addedBlobs: [],
    appliedAt: now,
    summary,
  };

  pendingFinCsv = null;

  setTimeout(() => deps.reloadRenderer(), 0);

  return summary;
}

/**
 * Drops the picked statement — what the UI calls when the user backs out before
 * applying. No file handle is released (the reader closed the file the moment it
 * finished), but the text and parsed cells are, which is somebody's whole bank
 * ledger sitting in main's memory.
 */
export function cancelFinCsvImport(): void {
  pendingFinCsv = null;
}
