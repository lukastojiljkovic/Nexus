import { createHash, randomBytes } from "node:crypto";
import { basename } from "node:path";
import {
  countProfileModules,
  parseImportArchive,
  type ExportSettings,
  type ImportProblem,
  type ProfileData,
} from "@nexus/core";
import type { RestoredNoteDerived, RestoreStore } from "@nexus/db";

import { ArchiveReadError, inspectArchiveFile, openArchive, type OpenedArchive } from "./archiveReader.js";
import { cancelIdleCompactions } from "./notes.js";
import {
  deriveRestoredNotes,
  gatherProfileData,
  gatherProfileSettings,
  type ProfileDataDeps,
} from "./profileData.js";
import type {
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
 * The orchestrator for IMEX restore (ADR-023, slice 3c): the seam between the
 * untrusted-input reader (`archiveReader.ts`), the pure validator
 * (`@nexus/core`'s `parseImportArchive`), and the destructive write
 * (`@nexus/db`'s `RestoreStore.replaceProfileData`). Nothing here parses a
 * byte of archive content itself and nothing here writes SQL itself — this
 * module's whole job is sequencing those three pieces the way a restore's
 * safety model requires: a preview that is a real dry run rather than an
 * estimate, and a one-step undo that needs no storage design of its own.
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

/** The exact archive the user picked, plus its parse once a preview has succeeded. */
interface PendingRestore {
  filePath: string;
  fileName: string;
  encrypted: boolean;
  ready: ReadyRestore | null;
}

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

/** The pre-restore snapshot of the one restore currently undoable, plus what applying it needs to know for undo's own bookkeeping. */
interface RestoreUndo {
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
  deleteBlobIfOrphaned(sha256: string, refCount: number): Promise<void>;
}

/** The archive the user picked, and (once a preview has succeeded) the parse that preview reported. Held open between preview and apply. */
let pending: PendingRestore | null = null;
/** The pre-restore snapshot of the last applied restore. */
let undo: RestoreUndo | null = null;

/** Closes and drops `pending`'s open archive, if one exists, then clears `pending` entirely. */
async function closePending(): Promise<void> {
  if (pending?.ready) {
    await pending.ready.archive.close();
  }
  pending = null;
}

/**
 * Closes and drops one pick's ready parse, if a preview has produced one. A
 * function (rather than the same three lines inline) on purpose: its second
 * caller sits AFTER an `await` that a concurrent preview may have raced, and
 * only a call boundary stops control-flow analysis from carrying the earlier
 * `ready === null` narrowing over a mutation it cannot see.
 */
async function closeReady(entry: PendingRestore): Promise<void> {
  if (entry.ready !== null) {
    await entry.ready.archive.close();
    entry.ready = null;
  }
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

  const filePath = await deps.pickArchiveFile();
  if (filePath === null) return { canceled: true };

  const { encrypted } = await inspectArchiveFile(filePath);
  const fileName = basename(filePath);
  pending = { filePath, fileName, encrypted, ready: null };
  return { canceled: false, path: filePath, fileName, encrypted };
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

  const targetProfile = deps.getProfile(profileId);
  const current = countProfileModules(gatherProfileData(deps, profileId));
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
  // carries (a missing one is counted below, never fetched). One at a time —
  // never all resident together — mirroring `handleExport`'s own attachment loop.
  const shasToWrite = new Set<string>();
  for (const attachment of ready.data.noteAttachments) {
    if (ready.archive.blobNames.has(attachment.sha256)) shasToWrite.add(attachment.sha256);
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

  const missingBlobs = ready.data.noteAttachments.filter(
    (attachment) => !ready.archive.blobNames.has(attachment.sha256),
  ).length;

  const summary: RestoreApplyResult = {
    restored: countProfileModules(ready.data),
    rowsWritten,
    blobsAdded: addedBlobs.length,
    missingBlobs,
  };

  undo = {
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
 * count (`NoteAttachmentStore.refCount`, deliberately profile-agnostic) is
 * what decides this, never simply "was it one of `addedBlobs`": a blob the
 * restore added that some OTHER profile's attachment also happens to
 * reference (content-addressed blobs are shared) must survive regardless of
 * who wrote it first.
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
    const refCount = deps.noteAttachmentStore(profileId).refCount(sha256);
    if (refCount === 0) blobsRemoved += 1;
    await deps.deleteBlobIfOrphaned(sha256, refCount);
  }

  undo = null;

  setTimeout(() => deps.reloadRenderer(), 0);

  return { rowsWritten, blobsRemoved };
}

/** The undo entry for one profile, or none — what a freshly reloaded renderer asks for (the reload replaced the screen that would have shown the banner). */
export function restoreStatus(profileId: string): RestoreStatus {
  if (undo !== null && undo.profileId === profileId) {
    return { undo: { appliedAt: undo.appliedAt, summary: undo.summary } };
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
 * Drops both pieces of module state — called on lock and on quit. The
 * archive (if any is still open) is closed best-effort and UNAWAITED: a lock
 * must never be delayed or failed by cleanup of a restore nobody is looking
 * at anymore.
 */
export function clearRestoreState(): void {
  undo = null;
  if (pending?.ready) {
    void pending.ready.archive.close().catch(() => {});
  }
  pending = null;
}
