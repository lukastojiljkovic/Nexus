/**
 * Scheduled backups (SET-011 / ADR-056): the existing full encrypted export
 * (`imex.ts`'s `writeProfileArchive` — the NXA1 container, sealed under a
 * passphrase-derived Argon2id key) run by main on a schedule, per profile.
 *
 * Two non-negotiables inherited from the design:
 *  - **Encrypted only.** SEC-DAR-02 allows plaintext exports only behind an
 *    explicit per-export confirmation, and a schedule cannot confirm — so this
 *    surface has no plaintext branch at all; `runBackup` always passes a
 *    string passphrase.
 *  - **Only while unlocked.** The wrapped passphrase opens only under the
 *    session's data key, and the stores only resolve against an open database
 *    — so the scheduler starts at unlock (`startUnlockedServices`) and stops
 *    at lock (`performLock`), and every run checks `stillThisSession()` (the
 *    house `db === session` identity idiom) before touching the settings row.
 *
 * Missed slots are CAUGHT UP rather than skipped: the scheduler runs one check
 * immediately when it starts (that is, at unlock) and every
 * `BACKUP_CHECK_INTERVAL_MS` after, and `isBackupDue` compares `last_run_at`
 * against the cadence — a laptop that slept through its slot backs up at the
 * next unlock, not next week.
 *
 * Deliberately Electron-free, like `restore.ts` and for the same reason: every
 * environment dependency arrives through `BackupRunnerDeps`, so the pure parts
 * are exercised under plain Node/Vitest and `main/index.ts` owns the wiring.
 */

import { readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { sanitizePathSegment, type ExportArchiveInput } from "@nexus/core";
import { KeyUnwrapError } from "@nexus/core/auth";
import type { BackupSettingsStore } from "@nexus/db";
import { BACKUP_PROFILE_SLUG_FALLBACK } from "./shellStrings.js";
import type { BackupCadence, BackupRunErrorCode } from "../shared/ipc.js";

/** The exact extension the manual ENCRYPTED export writes (`handleExport`'s `.nexus` dialog filter) — a scheduled archive is the same file. */
export const BACKUP_ARCHIVE_EXTENSION = ".nexus";

/** Every scheduled archive's name starts with this; the profile slug and timestamp follow. */
const BACKUP_NAME_STEM = "nexus-auto-";

/** How often an unlocked session re-checks whether a backup came due (~15 min, ADR-056). */
export const BACKUP_CHECK_INTERVAL_MS = 15 * 60_000;

/** The strict middle of a backup file name — what anchors retention to OUR files and nothing else's. */
const TIMESTAMP_PATTERN = /^\d{8}-\d{6}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds each cadence puts between runs. Elapsed-time thresholds, deliberately: no calendar-day arithmetic, no timezone traps, and a run drifts later only as far as the user's own unlock times do. */
const CADENCE_PERIOD_MS: Record<BackupCadence, number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
};

/**
 * The profile's name as a filename token: `sanitizePathSegment` (the archive
 * writer's own helper — reused, not reinvented) makes it filesystem-safe on
 * the platforms we ship on, then spaces become hyphens and the case folds, so
 * `Moj Profil` names its archives `nexus-auto-moj-profil-…`.
 */
export function backupProfileSlug(profileName: string): string {
  return sanitizePathSegment(profileName, BACKUP_PROFILE_SLUG_FALLBACK)
    .replace(/\s+/g, "-")
    .toLowerCase();
}

/** The run's local wall-clock instant as `YYYYMMDD-HHmmss` — built from local getters (the `clock.ts` idiom), never `toISOString`, which misdates late evenings in every positive-offset timezone including Belgrade. Lexicographic order IS chronological order, which is what lets retention sort by name. */
export function backupTimestamp(at: Date): string {
  const pad = (value: number, width: number): string => String(value).padStart(width, "0");
  return (
    `${pad(at.getFullYear(), 4)}${pad(at.getMonth() + 1, 2)}${pad(at.getDate(), 2)}` +
    `-${pad(at.getHours(), 2)}${pad(at.getMinutes(), 2)}${pad(at.getSeconds(), 2)}`
  );
}

/** `nexus-auto-<slug>-<YYYYMMDD-HHmmss>.nexus` — one scheduled archive's full file name. */
export function backupFileName(profileName: string, at: Date): string {
  return `${backupFilePrefix(profileName)}${backupTimestamp(at)}${BACKUP_ARCHIVE_EXTENSION}`;
}

/** `nexus-auto-<slug>-` — what retention matches file names against. */
export function backupFilePrefix(profileName: string): string {
  return `${BACKUP_NAME_STEM}${backupProfileSlug(profileName)}-`;
}

/**
 * Which files a SUCCESSFUL run deletes: this profile's own scheduled archives
 * beyond the newest `keepLast`, oldest first. Pure name-matching — prefix,
 * then a strict `YYYYMMDD-HHmmss` remainder, then the exact extension — so a
 * manual export, another profile's backups, a `.partial` from a crashed run,
 * and everything else the user keeps in that folder are structurally
 * unmatchable, never merely unlikely. (The strict timestamp anchor is also
 * what keeps profile `luka` from ever matching profile `luka-2`'s files: the
 * remainder would carry the extra token and fail the pattern.)
 */
export function selectBackupsToDelete(
  fileNames: readonly string[],
  profileName: string,
  keepLast: number,
): string[] {
  const prefix = backupFilePrefix(profileName);
  const matching = fileNames
    .filter((name) => {
      if (!name.startsWith(prefix) || !name.endsWith(BACKUP_ARCHIVE_EXTENSION)) return false;
      const middle = name.slice(prefix.length, name.length - BACKUP_ARCHIVE_EXTENSION.length);
      return TIMESTAMP_PATTERN.test(middle);
    })
    .sort(); // ascending = oldest first (the timestamp format sorts chronologically)
  return matching.slice(0, Math.max(0, matching.length - keepLast));
}

/**
 * Whether a run is owed: never ran, ran longer ago than the cadence's period,
 * or carries a stamp nothing can read (a corrupt row must never silently stop
 * backups — due-and-visible beats quiet-and-dead). A FAILED run counts as a
 * run: its stamp is real and the card names the failure, so the next automatic
 * attempt waits for the next slot rather than hammering a broken folder every
 * fifteen minutes — „Napravi odmah" is the retry that doesn't wait.
 */
export function isBackupDue(lastRunAt: string | null, cadence: BackupCadence, now: Date): boolean {
  if (lastRunAt === null) return true;
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= CADENCE_PERIOD_MS[cadence];
}

/**
 * Everything a run needs from the outside, resolved at call time exactly like
 * every other main-process deps literal (`restoreDeps`, `NotificationSchedulerDeps`):
 * the getters reach `requireDb()` when called, so a deps object can never
 * outlive the session that made it — and `stillThisSession` says when it has.
 */
export interface BackupRunnerDeps {
  listProfileIds(): string[];
  backupSettings(profileId: string): BackupSettingsStore;
  /** The manifest-shaped profile the archive writer takes (`archiveProfileOf` in `main/index.ts`). */
  archiveProfile(profileId: string): ExportArchiveInput["profile"];
  /** Opens the settings row's wrap under the session's data key (`unwrapBackupPassphrase`). Throws `KeyUnwrapError` for a row this account cannot open. */
  unwrapPassphrase(wrapped: string): Promise<string>;
  /** `imex.ts`'s `writeProfileArchive` over the same store getters the manual export uses — always with a non-null passphrase here. */
  writeArchive(
    profile: ExportArchiveInput["profile"],
    passphrase: string,
    filePath: string,
  ): Promise<void>;
  /** The `db === session` identity guard (the house idiom for work outliving a lock). */
  stillThisSession(): boolean;
  now(): Date;
}

/** A run failure that already knows its wire code; anything else that escapes a run is mapped to `"write-failed"` and logged. */
class BackupRunError extends Error {
  constructor(readonly code: BackupRunErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackupRunError";
  }
}

/**
 * ONE run at a time, module-level — across profiles and across the two
 * entrances (the interval check and `backup:run-now`): an export streams a
 * whole profile and there is no version of "two at once" a user could want.
 */
let runInFlight = false;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the unlocked session's backup checks: one immediately — the catch-up
 * half, so a slot missed while locked or powered off runs the moment the data
 * key exists again — then every `BACKUP_CHECK_INTERVAL_MS`. Idempotent, like
 * `startNotificationScheduler`: calling it again first stops any previous
 * scheduler. Never called during the smoke run (`startUnlockedServices` gates
 * it), for the reason nothing scheduled runs there.
 */
export function startBackupScheduler(deps: BackupRunnerDeps): void {
  stopBackupScheduler();
  void checkScheduledBackups(deps);
  intervalHandle = setInterval(() => void checkScheduledBackups(deps), BACKUP_CHECK_INTERVAL_MS);
}

/** Stops the periodic check. Safe to call even if nothing was started. A run already in flight is not interrupted — it bails on its own `stillThisSession` check instead. */
export function stopBackupScheduler(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * The manual trigger (`backup:run-now`), through the same guard as the
 * scheduled path. Runs regardless of due-ness — that is what "now" means — but
 * refuses an unconfigured profile out loud: the renderer's disabled button is
 * UX, never the gate (SEC-EL-02). A run already in flight makes this a no-op
 * rather than a queue; the handler answers with the current settings either way.
 */
export async function runBackupNow(deps: BackupRunnerDeps, profileId: string): Promise<void> {
  const settings = deps.backupSettings(profileId).get();
  if (settings.folderPath === null || settings.passphraseWrapped === null) {
    throw new Error("Cannot run a backup before a folder and a passphrase are set.");
  }
  if (runInFlight) return;
  runInFlight = true;
  try {
    await runBackup(deps, profileId);
  } finally {
    runInFlight = false;
  }
}

/**
 * One scheduled pass: every profile whose schedule is enabled, configured and
 * due, in turn. Never throws — a scheduler tick has nobody to report to, so
 * anything unexpected lands in the log and the next tick tries again.
 */
async function checkScheduledBackups(deps: BackupRunnerDeps): Promise<void> {
  if (runInFlight) return;
  runInFlight = true;
  try {
    if (!deps.stillThisSession()) return;
    for (const profileId of deps.listProfileIds()) {
      if (!deps.stillThisSession()) return;
      const settings = deps.backupSettings(profileId).get();
      if (!settings.enabled || settings.folderPath === null || settings.passphraseWrapped === null) {
        continue;
      }
      if (!isBackupDue(settings.lastRunAt, settings.cadence, deps.now())) continue;
      await runBackup(deps, profileId);
    }
  } catch (error) {
    console.error(
      `Scheduled backup check failed (next interval will retry): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    runInFlight = false;
  }
}

/**
 * One profile's run, start to finish: verify the folder, open the wrap, write
 * the archive to a `.partial` name and rename it into place — so a crash never
 * leaves a plausible truncated archive under the real name — then sweep
 * retention, then record the outcome in the settings row. Every failure is a
 * FAILED RUN with a named code in `last_error`, never a crash and never a
 * fallback location; the card shows it. Nothing is recorded when the session
 * ended mid-run — the row belongs to a database this run may no longer touch.
 */
async function runBackup(deps: BackupRunnerDeps, profileId: string): Promise<void> {
  const startedAt = deps.now();
  let code: BackupRunErrorCode | null = null;
  try {
    const settings = deps.backupSettings(profileId).get();
    if (settings.folderPath === null || settings.passphraseWrapped === null) return;
    const folder = settings.folderPath;

    // Fail fast, BEFORE the second of Argon2id inside the writer: an unplugged
    // drive should cost a stat call, not a key derivation.
    let isDirectory = false;
    try {
      isDirectory = (await stat(folder)).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) {
      throw new BackupRunError("folder-unreachable", `Backup folder is not reachable.`);
    }

    let passphrase: string;
    try {
      passphrase = await deps.unwrapPassphrase(settings.passphraseWrapped);
    } catch (error) {
      if (error instanceof KeyUnwrapError) {
        throw new BackupRunError("passphrase-unreadable", error.message, { cause: error });
      }
      throw error;
    }

    const profile = deps.archiveProfile(profileId);
    const finalPath = join(folder, backupFileName(profile.name, startedAt));
    const partialPath = `${finalPath}.partial`;
    try {
      await deps.writeArchive(profile, passphrase, partialPath);
      await rename(partialPath, finalPath);
    } catch (error) {
      await unlink(partialPath).catch(() => {}); // best-effort: never leave the partial when we know it is dead
      throw new BackupRunError("write-failed", `Writing the archive failed.`, { cause: error });
    }

    // Retention, only AFTER the successful rename — and its own failure is not
    // the backup's: the archive exists, so a folder that stopped cooperating
    // between the write and the sweep costs old copies their cleanup, not the
    // user their new backup. Logged, retried by the next successful run.
    try {
      const names = await readdir(folder);
      for (const name of selectBackupsToDelete(names, profile.name, settings.keepLast)) {
        await unlink(join(folder, name));
      }
    } catch (error) {
      console.error(
        `Backup retention sweep failed (the archive itself was written): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } catch (error) {
    if (!deps.stillThisSession()) return; // locked mid-run: nothing to record, nowhere to record it
    if (error instanceof BackupRunError) {
      code = error.code;
    } else {
      // An unexpected failure (a store read against a closing database, an
      // exporter bug) is still a failed RUN from the schedule's point of view.
      code = "write-failed";
      console.error(
        `Scheduled backup failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!deps.stillThisSession()) return;
  deps
    .backupSettings(profileId)
    .recordRun(startedAt.toISOString(), code === null ? "ok" : "failed", code);
}
