import { createHash, randomBytes } from "node:crypto";
import { basename } from "node:path";
import {
  countProfileModules,
  documentDuplicateKey,
  eventDuplicateKey,
  parseImportArchive,
  parseLlmAnswer,
  personDuplicateKey,
  planForeignImport,
  translateApkg,
  translateLlmRecords,
  type ApkgSkip as CoreApkgSkip,
  type ApkgSubjectChoice,
  type ArchiveProfilePicture,
  type ExportSettings,
  type ForeignImportPlan,
  type ForeignImportTarget,
  type ImportDuplicateChoices as CoreImportDuplicateChoices,
  type ImportDuplicateGroup as CoreImportDuplicateGroup,
  type ImportPlanReport as CoreImportPlanReport,
  type ImportSkipReason as CoreImportSkipReason,
  type ImportProblem,
  type LlmSkippedRecord,
  type ParsedApkg,
  type ProfileData,
} from "@nexus/core";
import { uuidv7 } from "@nexus/db";
import type { ForeignImportStore, RestoredNoteDerived, RestoreStore } from "@nexus/db";

import { ApkgReadError, readApkg } from "./apkgReader.js";
import { ArchiveReadError, inspectArchiveFile, openArchive, type OpenedArchive } from "./archiveReader.js";
import { cancelIdleCompactions } from "./notes.js";
import {
  deriveRestoredNotes,
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

/**
 * The orchestrator for every way a FILE can enter a profile: IMEX RESTORE
 * (ADR-023, slice 3c), which replaces a profile preserving ids; FOREIGN IMPORT
 * (ADR-043), which merges an archive into a profile that already has data; and
 * the ANKI `.apkg` IMPORT (ADR-052), which merges somebody else's flashcard
 * collection into it. Each is the seam between an untrusted-input reader
 * (`archiveReader.ts` or `apkgReader.ts`), the pure validator/planner
 * (`@nexus/core`'s `parseImportArchive` / `translateApkg`, and, for both
 * imports, `planForeignImport`), and the write (`@nexus/db`'s
 * `RestoreStore.replaceProfileData` or `ForeignImportStore.insertPlanned`).
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
 * Four pieces of state live at module scope, and ONLY four — one pick per
 * surface, and the shared undo:
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
  kind: "restore" | "import" | "apkg" | "llm";
  profileId: string;
  snapshot: {
    profileName: string;
    /** The picture the profile wore before the operation — undone alongside its name, because a restore replaced both. */
    profilePicture: ArchiveProfilePicture | null;
    settings: ExportSettings;
    data: ProfileData;
    derived: ReadonlyMap<string, RestoredNoteDerived>;
  };
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
   * the archive's face.
   */
  getProfile(profileId: string): { id: string; name: string; picture: ArchiveProfilePicture | null };
  /** The native open dialog: resolves the chosen path, or null when the user canceled. Injected so this module never imports electron — main owns the dialog, exactly as it does for export. */
  pickArchiveFile(): Promise<string | null>;
  /** The same dialog with the `.apkg` filter (ADR-052). Its own injection, not a parameter on the one above, so no call on the archive surface can ever open the Anki picker or the reverse. */
  pickApkgFile(): Promise<string | null>;
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
/** The plan a pasted LLM answer produced (IMEX-005). A fourth variable, on the same terms: no surface here can reach another's source. */
let pendingLlm: ReadyLlm | null = null;
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
    hash: sha256Hex,
    mode: "import",
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
    hash: sha256Hex,
  });

  if (parsed.data === null || parsed.manifest === null) {
    await archive.close();
    return { status: "invalid", problems: parsed.problems.map(toRestoreProblem) };
  }

  let targetProfile: { name: string };
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
  const incoming = countProfileModules(parsed.data);
  const warnings = parsed.problems.filter((problem) => problem.severity === "warning").map(toRestoreProblem);
  const token = randomBytes(16).toString("hex");

  picked.ready = {
    archive,
    token,
    profileId,
    profileName: parsed.manifest.profile.name,
    profilePicture: parsed.manifest.profile.picture,
    settings: parsed.manifest.settings,
    data: parsed.data,
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
 * 4. Replaces the profile's entire stored content in one transaction
 *    (`RestoreStore.replaceProfileData`).
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
  const addedBlobs: string[] = [];
  for (const sha256 of shasToWrite) {
    const bytes = await ready.archive.readBlob(sha256);
    const { created } = await deps.saveBlob(bytes);
    if (created) addedBlobs.push(sha256);
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
    },
    now,
  );

  const missingBlobs = restoredAttachments.filter(
    (attachment) => !ready.archive.blobNames.has(attachment.sha256),
  ).length;

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
    },
    now,
  );

  let blobsRemoved = 0;
  for (const sha256 of toUndo.addedBlobs) {
    const refCount = deps.blobRefCount(profileId, sha256);
    if (refCount === 0) blobsRemoved += 1;
    await deps.deleteBlobIfOrphaned(sha256, refCount);
  }

  undo = null;

  setTimeout(() => deps.reloadRenderer(), 0);

  return { rowsWritten, blobsRemoved };
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
  // Nor does the LLM plan, and it holds what the user pasted out of their own
  // chat — their content, in plaintext, in main's heap. Same rule.
  pendingLlm = null;
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
        profilePicture: parsed.manifest.profile.picture,
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
    { data: translation.data, dropped: [], profilePicture: null },
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

// --- LLM-assisted import (IMEX-005) -----------------------------------------

/**
 * One successful LLM preview, held exactly as `applyLlmImport` needs it: the
 * plan — already translated, remapped, stamped and counted, so applying writes
 * precisely what the user was shown — the parse's own report, and the token
 * proving an apply is confirming THIS plan.
 *
 * The shortest of the four pending shapes, because this flow has the least
 * state: there is no file to hold open, no bytes to keep resident and nothing
 * to re-plan. The user's pasted TEXT is deliberately not kept either — it has
 * already become a plan, and holding their content in main's heap for no reason
 * is exactly what `clearRestoreState` exists to prevent.
 */
interface ReadyLlm {
  token: string;
  /** The profile this plan was computed against — the apply refuses any other, mirroring the token check. */
  profileId: string;
  plan: ForeignImportPlan;
  preview: LlmImportPreview;
}

/** Maps one core `LlmSkippedRecord` onto the wire. The annotated `reason` assignment is the drift check every other core→wire hand-off in this file makes. */
function toLlmSkip(skip: LlmSkippedRecord): LlmImportSkip {
  const reason: LlmImportSkipReason = skip.reason;
  return { index: skip.index, reason, field: skip.field };
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
 * `deckId` is checked here, not at the IPC edge, for `resolveApkgSubject`'s
 * reason: whether a deck EXISTS in this profile is a semantic question only the
 * live stores can answer.
 */
export function previewLlmImport(
  deps: ImportDeps,
  profileId: string,
  kind: LlmImportKind,
  text: string,
  deckId: string | null,
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

  const translation = translateLlmRecords(answer.parsed, {
    profileId,
    now: new Date().toISOString(),
    deckId: kind === "cards" ? resolveLlmDeck(deps, profileId, deckId) : null,
  });

  // The target is read as late as possible — immediately before planning
  // against it — for `previewImport`'s reason: every identity question the
  // planner answers is answered about the profile as it is NOW. `seededIds` is
  // the one thing added to it (ADR-052's seam): a card import resolves its
  // single `llm:deck` name onto the deck the user picked, so no deck row is
  // ever created.
  const plan = planForeignImport(
    { data: translation.data, dropped: [], profilePicture: null },
    { ...importTargetFor(deps, profileId), seededIds: translation.seededIds },
    uuidv7,
  );

  // Counted off the PLAN rather than off the translation, so the number on
  // screen is what will actually be inserted: the planner's duplicate rule
  // (ADR-051) takes events this profile already has out of it, and `duplicates`
  // below says how many. One kind touches one module, so summing the three this
  // import can reach is exactly the row count.
  const planned = countProfileModules(plan.data);

  const token = randomBytes(16).toString("hex");
  const preview: LlmImportPreview = {
    token,
    kind,
    records: answer.report.total,
    accepted: answer.report.accepted,
    planned: planned.tasks + planned.calendar + planned.study,
    duplicates: plan.report.duplicates.reduce((total, group) => total + group.count, 0),
    skipped: answer.report.skipped.map(toLlmSkip),
    droppedFields: answer.report.droppedFields,
  };

  pendingLlm = { token, profileId, plan, preview };
  return { status: "ready", preview };
}

/**
 * The renderer's deck choice, resolved against the profile as it is NOW —
 * `resolveApkgSubject`'s twin, and split from the IPC edge for the same reason:
 * `main/index.ts` proves the payload is a string or null, and this proves the
 * deck it names is a live deck of THIS profile. A renderer naming another
 * profile's deck — or a soft-deleted one — must be refused, not planned around.
 */
function resolveLlmDeck(deps: ImportDeps, profileId: string, deckId: string | null): string {
  if (deckId === null) {
    throw new Error("An LLM card import needs a deck for the cards to land in.");
  }
  const deck = deps
    .deckStore(profileId)
    .listActive()
    .find((row) => row.id === deckId);
  if (deck === undefined) {
    throw new Error(`No active deck "${deckId}" in this profile.`);
  }
  return deck.id;
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
