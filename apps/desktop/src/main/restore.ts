import { createHash, randomBytes } from "node:crypto";
import { basename } from "node:path";
import {
  countProfileModules,
  parseImportArchive,
  planForeignImport,
  type ExportSettings,
  type ForeignImportPlan,
  type ForeignImportTarget,
  type ImportPlanReport as CoreImportPlanReport,
  type ImportSkipReason as CoreImportSkipReason,
  type ImportProblem,
  type ProfileData,
} from "@nexus/core";
import { uuidv7 } from "@nexus/db";
import type { ForeignImportStore, RestoredNoteDerived, RestoreStore } from "@nexus/db";

import { ArchiveReadError, inspectArchiveFile, openArchive, type OpenedArchive } from "./archiveReader.js";
import { cancelIdleCompactions } from "./notes.js";
import {
  deriveRestoredNotes,
  gatherProfileData,
  gatherProfileSettings,
  type ProfileDataDeps,
} from "./profileData.js";
import type {
  ArchiveModuleName,
  ImportApplyResult,
  ImportPickResult,
  ImportPlanReport,
  ImportPreview,
  ImportPreviewResult,
  ImportRecordType,
  ImportSkipCode,
  ImportSkipReason,
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
 * The orchestrator for both ways an archive can enter a profile: IMEX RESTORE
 * (ADR-023, slice 3c), which replaces a profile preserving ids, and FOREIGN
 * IMPORT (ADR-043), which merges an archive into a profile that already has
 * data. Each is the seam between the untrusted-input reader
 * (`archiveReader.ts`), the pure validator/planner (`@nexus/core`'s
 * `parseImportArchive` and, for an import, `planForeignImport`), and the write
 * (`@nexus/db`'s `RestoreStore.replaceProfileData` or
 * `ForeignImportStore.insertPlanned`). Nothing here parses a byte of archive
 * content itself and nothing here writes SQL itself — this module's whole job
 * is sequencing those pieces the way each operation's safety model requires: a
 * preview that is a real dry run rather than an estimate, and a one-step undo
 * that needs no storage design of its own.
 *
 * The two live in ONE module, and deliberately so: they share the undo slot.
 * `undo` below is a single whole-profile snapshot covering whichever operation
 * ran last, which is what makes "the same banner just works" true and what
 * makes "one slot" a fact of this file's shape rather than a convention two
 * modules would have to keep. Everything else about them is kept APART — their
 * own picks, their own channels, their own tokens — so that no call on one
 * surface can ever trigger the other's semantics.
 *
 * Deliberately Electron-free — no `import "electron"`, directly or
 * transitively — exactly like `archiveReader.ts` and `profileData.ts`: the
 * native open dialog and the renderer reload are both injected through
 * `RestoreDeps` rather than reached for, which is what lets this whole
 * pipeline be exercised under plain Node/Vitest. Wiring the two new IPC
 * channels this will eventually need is the next slice's job, not this one's.
 *
 * Two pieces of state live at module scope, and ONLY two:
 *
 * - `pending`: the archive file the user picked, and — once a preview has
 *   succeeded — the full parse result that preview reported, plus the
 *   `OpenedArchive` itself, held OPEN between preview and apply. This is what
 *   makes "the preview is a dry run of the real parse, not an estimate" true:
 *   confirming writes exactly the bytes the user already saw, nothing is
 *   re-read or re-validated, and an attachment blob streams from the SAME
 *   file handle the preview opened rather than paying to reopen the archive
 *   (and, for an encrypted one, to re-run Argon2id) a second time.
 * - `undo`: the pre-restore snapshot of the last COMPLETED restore, gathered
 *   with the exact same `gatherProfileData`/`gatherProfileSettings` the
 *   exporter itself gathers with (`profileData.ts`), so the undo snapshot and
 *   an ordinary export are provably the same shape. This holds a WHOLE
 *   profile in main-process memory — every note's Yjs bytes included — until
 *   the app quits or locks (`clearRestoreState`). That memory cost is the
 *   accepted price of a one-click undo that needs no storage design, retention
 *   policy, or on-disk format of its own.
 *
 * Both are wiped on lock (`clearRestoreState`), because either one surviving
 * a lock would mean holding decrypted archive bytes, or a whole profile's
 * plaintext, past the moment the user asked this session's key material to be
 * dropped.
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
  kind: "restore" | "import";
  profileId: string;
  snapshot: {
    profileName: string;
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
  /** The target profile row, so a preview can name what is being overwritten. */
  getProfile(profileId: string): { id: string; name: string };
  /** The native open dialog: resolves the chosen path, or null when the user canceled. Injected so this module never imports electron — main owns the dialog, exactly as it does for export. */
  pickArchiveFile(): Promise<string | null>;
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

/** The plan's report on the wire — copied rather than passed through, because the wire shape is mutable and core's is readonly. */
function toImportReport(report: CoreImportPlanReport): ImportPlanReport {
  return { modules: report.modules, skips: report.skips.map(toImportSkip) };
}

/** sha256 hex over a UTF-8 string — the same injection `handleExport` (`imex.ts`) gives `buildExportArchive`. */
function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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
  const addedBlobs: string[] = [];
  for (const sha256 of shasToWrite) {
    const bytes = await ready.archive.readBlob(sha256);
    const { created } = await deps.saveBlob(bytes);
    if (created) addedBlobs.push(sha256);
  }

  const now = new Date().toISOString();
  const derived = deriveRestoredNotes(ready.data.notes);
  const rowsWritten = deps.restoreStore(profileId).replaceProfileData(
    { profileName: ready.profileName, settings: ready.settings, data: ready.data, derived },
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
 * attachments on either module, dashboard backgrounds; deliberately
 * profile-agnostic) is what decides this, never simply "was it one of
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
 * Everything the planner needs to know about the profile being merged INTO,
 * read off the profile's OWN stores — never off a cached view. Each answer
 * decides an identity question the planner then resolves once and for all:
 * which Inbox the source's tasks land in, which tags are already there by name,
 * which template names are taken, and whether the quick-capture folder is
 * already claimed (migration 028 allows exactly one).
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
 * `"import"` mode is the whole difference at the parser: a per-row problem
 * becomes a warning and costs that row its place instead of refusing the
 * archive, since a merge that threw away nine thousand good rows over one
 * damaged one would be the wrong answer. Archive-level problems — a bad
 * manifest, a checksum mismatch, an unsupported version — are still errors, and
 * still refuse.
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

  const parsed = parseImportArchive({
    files: archive.files,
    ydocs: archive.ydocs,
    blobNames: archive.blobNames,
    hash: sha256Hex,
    mode: "import",
  });

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
      { data: parsed.data, dropped: parsed.dropped },
      importTargetFor(deps, profileId),
      uuidv7,
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

  const preview: ImportPreview = {
    token,
    fileName: picked.fileName,
    encrypted: picked.encrypted,
    createdAt: parsed.manifest.createdAt,
    appVersion: parsed.manifest.appVersion,
    sourceProfileName: parsed.manifest.profile.name,
    targetProfileName: deps.getProfile(profileId).name,
    report: toImportReport(plan.report),
    warnings: parsed.problems
      .filter((problem) => problem.severity === "warning")
      .map(toRestoreProblem),
    corruptBlobs: archive.corruptBlobNames.size,
  };
  return { status: "ready", preview };
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
