/**
 * Downloading a catalogue pack (ADR-103), and the one thing it does with the
 * bytes: hands the finished folder to `installPackFromDirectory`.
 *
 * **Nothing here verifies anything.** Every hash is checked by the download
 * service while the file is written (`download/service.ts`), the manifest's
 * signature and the whole structural comparison are checked by the install
 * (`packs/install.ts`), and this module's job is the seam between them: fetch
 * the files the signed catalogue pins, one at a time, into one folder, and then
 * call the install with that folder. A second copy of any of those rules here
 * would be the copy that drifts.
 *
 * **One folder per pack, and it is the install's input.** The pack is assembled
 * under `packs/.staging/<random>/pack/`: the service hashes each file into its
 * own staging directory, and a verified file is renamed from there into the
 * pack folder, so a file that is in the folder is a file the service hashed and
 * the catalogue pins. The folder the install is handed therefore holds exactly
 * the pack's files, never the service's `.part` files, and an interrupted
 * download leaves nothing in `packs/<id>/`. The pack's staging lives under
 * `.staging` because that is the one name `registry.ts` skips, so a
 * half-downloaded pack can never be listed.
 *
 * **Pause keeps the folder, cancel deletes it.** Pausing pauses the file in
 * flight (the service keeps its `.part` file and its resume point); resuming
 * continues that file, and every file already placed stays where it is, so a
 * resumed pack re-downloads nothing it already has. Cancelling removes the whole
 * staging folder.
 *
 * There is no URL in this module's vocabulary: a `PackCatalogueEntry` came out
 * of a document the release key signed, and a `DownloadRequest` is built from it
 * field by field. The renderer names a pack id and nothing else.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PackDownloadProgress } from "../../shared/ipc.js";
import type {
  DownloadOutcome,
  DownloadProblem,
  DownloadProgress,
  DownloadService,
} from "../download/service.js";
import { downloadStagingPath } from "../download/service.js";
import { modeAllowsDownloads, type NetworkMode } from "../net/offline.js";
import type { PackCatalogueEntry } from "./catalogue.js";
import { packRefusalCode, type PackRefusalCode } from "./errors.js";
import { installPackFromDirectory } from "./install.js";
import { PACK_LIMITS } from "./limits.js";
import { packPathSegments } from "./paths.js";
import { PACKS_STAGING_DIR, packsRoot, type InstalledPack } from "./registry.js";

/** What a `download` answers. `"paused"` is not a failure; `packsResume` continues it. */
export type PackDownloadOutcome =
  | { readonly outcome: "installed"; readonly pack: InstalledPack }
  | { readonly outcome: "paused"; readonly id: string }
  | { readonly outcome: "cancelled"; readonly id: string }
  | { readonly outcome: "refused"; readonly code: PackRefusalCode };

export interface PackDownloadDeps {
  readonly userData: string;
  readonly appVersion: string;
  readonly publicKeyPem: string;
  /** The mode this launch may ACT on, `main/index.ts`'s `activeNetworkMode`. */
  readonly mode: () => NetworkMode;
  /**
   * Builds the ONE download service this launch uses, with this module's own
   * progress sink. A factory rather than an instance because the service's sink
   * is fixed when it is built and this module is what routes a chunk of a file
   * to the pack that asked for it — and because the service still counts
   * `MAX_ACTIVE_DOWNLOADS` across every pack, which is the point of one instance.
   */
  readonly service: (onProgress: (progress: DownloadProgress) => void) => DownloadService;
  /** `volumeFreeBytes` in main. Injected so "the disk is full" is a testable state. */
  readonly freeBytes: (dir: string) => number | null;
  readonly onProgress: (progress: PackDownloadProgress) => void;
}

export interface PackDownloader {
  /** Downloads and installs `entry`, or refuses with a code. Never throws for a refusal. */
  download(entry: PackCatalogueEntry): Promise<PackDownloadOutcome>;
  /** Stops the file in flight and keeps the staging folder. A no-op for anything not running. */
  pause(id: string): void;
  /** Continues a paused download from the file it stopped on. */
  resume(id: string): Promise<PackDownloadOutcome>;
  /** Stops a download and deletes what it staged. */
  cancel(id: string): Promise<void>;
}

/**
 * Where a pack's download is assembled, under the one directory the registry
 * skips. Exported because a test (and a future "clean up what was left behind")
 * should not be re-deriving a path this module owns.
 */
export function downloadStageRoot(userData: string, token: string): string {
  return join(packsRoot(userData), PACKS_STAGING_DIR, `dl-${token}`);
}

/**
 * The service's id for one file of a pack: short, fixed-length and unique per
 * pack, because a pack id may be 64 characters and the service's ids are capped
 * at 64. A digest of the id rather than the id itself, so the token's length
 * does not depend on how long somebody made the pack's name.
 */
function fileToken(packId: string, index: number): string {
  const tag = createHash("sha256").update(packId).digest("hex").slice(0, 16);
  return `p_${tag}_${String(index)}`;
}

/**
 * A job's status, read through a call so TypeScript does not narrow it.
 *
 * The point of every check that uses this is that the status CAN change while
 * an await is in flight — a pause or a cancel lands from an IPC call in the
 * middle of a transfer — and control-flow analysis cannot see that a field was
 * written across an `await`. The function boundary is what keeps the check
 * honest rather than the compiler deciding it is impossible.
 */
function statusOf(job: { readonly status: "running" | "paused" | "cancelled" }): "running" | "paused" | "cancelled" {
  return job.status;
}

/** A download in flight, or paused; forgotten the moment it ends either way. */
interface Job {
  readonly entry: PackCatalogueEntry;
  /** `packs/.staging/dl-<random>`: the pack is assembled here, in `pack/`. */
  readonly stage: string;
  readonly packDir: string;
  /** The next file to fetch, which is also how many are placed. */
  index: number;
  /** The path of the file in flight, as the catalogue names it. */
  file: string;
  /** Bytes of the files already placed in `packDir`. */
  placedBytes: number;
  /** Bytes of the file in flight, from the service's progress. */
  currentBytes: number;
  /** The service's id for the file in flight, or `null` when none is. */
  token: string | null;
  status: "running" | "paused" | "cancelled";
}

/**
 * Why a download was refused, from the service's vocabulary.
 *
 * Every `DownloadProblem` is named, with no `default`, so a problem added to the
 * service is a compile error here rather than a refusal that silently reads as
 * something else. The three that are not one-to-one are the interesting ones:
 * `"url"` means a host the compiled-in list does not hold, `"hash"` means the
 * bytes are not the bytes the catalogue pinned, and `"mode"` means this launch
 * is not in the mode that allows a download at all.
 */
function refusalFor(problem: DownloadProblem): PackRefusalCode {
  switch (problem) {
    case "mode":
      return "downloads-off";
    case "url":
      return "catalogue-host";
    case "hash":
    case "hash-required":
      return "hash-mismatch";
    case "size-limit":
      return "limit";
    case "no-space":
      return "no-space";
    case "busy":
      return "busy";
    case "not-found":
    case "request":
    case "network":
    case "io":
      return "download-failed";
  }
}

export function createPackDownloader(deps: PackDownloadDeps): PackDownloader {
  const jobs = new Map<string, Job>();
  /** Which pack a service id belongs to, so a chunk of a file is reported against the pack that asked for it. */
  const owners = new Map<string, string>();

  const service = deps.service((progress) => {
    const id = owners.get(progress.id);
    if (id === undefined) return;
    const job = jobs.get(id);
    if (job === undefined) return;
    job.currentBytes = progress.receivedBytes;
    emit(job);
  });

  function emit(job: Job): void {
    deps.onProgress({
      id: job.entry.id,
      phase: "download",
      file: job.file,
      filesDone: job.index,
      filesTotal: job.entry.files.length,
      bytesDone: job.placedBytes + job.currentBytes,
      bytesTotal: job.entry.size,
    });
  }

  function refused(id: string, code: PackRefusalCode): PackDownloadOutcome {
    return { outcome: "refused", code };
  }

  /**
   * The service's verified file for `token`.
   *
   * The service owns that path and decides it (`downloadStagingPath`), so this
   * module asks it rather than re-deriving a directory name: the file it writes
   * is `<token>.part` and the file it hands back after hashing is the same path
   * without the suffix.
   */
  function finishedPath(token: string): string {
    const partial = downloadStagingPath(deps.userData, token);
    return partial.endsWith(".part") ? partial.slice(0, -".part".length) : partial;
  }

  async function removeStage(job: Job): Promise<void> {
    await rm(job.stage, { recursive: true, force: true }).catch(() => undefined);
  }

  function forget(job: Job): void {
    jobs.delete(job.entry.id);
    for (const [token, id] of owners) {
      if (id === job.entry.id) owners.delete(token);
    }
  }

  /** Moves a hashed file into the pack folder, creating the folders the manifest names. */
  async function place(job: Job, token: string, filePath: string): Promise<void> {
    const target = join(job.packDir, ...packPathSegments(filePath));
    await mkdir(dirname(target), { recursive: true });
    await rename(finishedPath(token), target);
  }

  /**
   * The install, which is the only step that trusts the folder this module
   * built. A `PackError` is a refusal (`older-than-installed`, a manifest that
   * does not verify, a folder that does not match it); anything else is a bug
   * and travels as one.
   */
  async function installNow(job: Job): Promise<PackDownloadOutcome> {
    try {
      const installed = await installPackFromDirectory(job.packDir, {
        userData: deps.userData,
        appVersion: deps.appVersion,
        publicKeyPem: deps.publicKeyPem,
        freeBytes: deps.freeBytes,
        // The install's copy reports into the same view the download did: from
        // the card's side this is one operation that got to its last phase.
        onProgress: (progress) => {
          deps.onProgress({
            id: progress.id,
            phase: "install",
            file: progress.file,
            filesDone: progress.filesDone,
            filesTotal: progress.filesTotal,
            bytesDone: progress.bytesDone,
            bytesTotal: progress.bytesTotal,
          });
        },
      });
      forget(job);
      await removeStage(job);
      return { outcome: "installed", pack: installed };
    } catch (error) {
      forget(job);
      await removeStage(job);
      const code = packRefusalCode(error);
      if (code === null) throw error;
      return refused(job.entry.id, code);
    }
  }

  /**
   * Fetches file after file, then installs. `resume` says the first answer
   * arrives from the service's `resume` rather than from a fresh `start`: the
   * file in flight already has a service job, and starting it again would be
   * refused as busy.
   */
  async function drive(job: Job, resume: boolean): Promise<PackDownloadOutcome> {
    for (;;) {
      // The user may have stopped this job while the previous answer was
      // arriving, so the check is at the top: no file is ever started, and no
      // install is ever run, for a job that has already been stopped.
      if (job.status === "cancelled") {
        forget(job);
        await removeStage(job);
        return { outcome: "cancelled", id: job.entry.id };
      }
      if (job.status === "paused") return { outcome: "paused", id: job.entry.id };

      const file = job.entry.files[job.index];
      let outcome: DownloadOutcome;
      if (resume) {
        resume = false;
        const token = job.token;
        if (token === null) return refused(job.entry.id, "download-failed");
        outcome = await service.resume(token);
      } else {
        if (file === undefined) return await installNow(job);
        job.file = file.path;
        job.currentBytes = 0;
        job.token = fileToken(job.entry.id, job.index);
        owners.set(job.token, job.entry.id);
        emit(job);
        outcome = await service.start({
          id: job.token,
          url: file.url,
          expectedSha256: file.sha256,
          sizeLimitBytes: file.size,
        });
      }

      switch (outcome.outcome) {
        case "done": {
          const token = job.token;
          if (token === null) return refused(job.entry.id, "download-failed");
          owners.delete(token);
          try {
            await place(job, token, job.file);
          } catch {
            forget(job);
            await removeStage(job);
            return refused(job.entry.id, "io");
          }
          job.index += 1;
          job.placedBytes += outcome.bytes;
          job.currentBytes = 0;
          job.token = null;
          // The next file's name, or the last file's: either way the card has
          // something true to draw between two files.
          job.file = job.entry.files[job.index]?.path ?? job.file;
          emit(job);
          // A pause that landed while this reply was arriving leaves the file
          // placed (it is verified) and the job paused; a cancel is handled by
          // the status check at the top of the loop.
          if (statusOf(job) === "paused") return { outcome: "paused", id: job.entry.id };
          break;
        }
        case "paused":
          job.status = "paused";
          job.currentBytes = outcome.bytes;
          emit(job);
          return { outcome: "paused", id: job.entry.id };
        case "cancelled":
          forget(job);
          await removeStage(job);
          return { outcome: "cancelled", id: job.entry.id };
        case "refused":
          forget(job);
          await removeStage(job);
          return refused(job.entry.id, refusalFor(outcome.problem));
      }
    }
  }

  return {
    async download(entry: PackCatalogueEntry): Promise<PackDownloadOutcome> {
      if (!modeAllowsDownloads(deps.mode())) return refused(entry.id, "downloads-off");
      if (jobs.has(entry.id)) return refused(entry.id, "busy");

      // A download stages a full copy and the install copies it again into
      // `packs/.staging` before the rename, so the peak is two copies plus the
      // headroom `installPackFromDirectory` already reserves. Checked before a
      // byte is asked for, and `null` (this platform cannot say) is not a
      // refusal: a guess would refuse a download on a machine with room.
      const free = deps.freeBytes(packsRoot(deps.userData));
      const needed = 2 * entry.size + PACK_LIMITS.installHeadroomBytes;
      if (free !== null && free < needed) return refused(entry.id, "no-space");

      const stage = downloadStageRoot(deps.userData, randomBytes(8).toString("hex"));
      const job: Job = {
        entry,
        stage,
        packDir: join(stage, "pack"),
        index: 0,
        file: entry.files[0]?.path ?? "",
        placedBytes: 0,
        currentBytes: 0,
        token: null,
        status: "running",
      };
      try {
        await mkdir(job.packDir, { recursive: true });
      } catch {
        await removeStage(job);
        return refused(entry.id, "io");
      }
      jobs.set(entry.id, job);
      return await drive(job, false);
    },

    pause(id: string): void {
      const job = jobs.get(id);
      if (job === undefined || job.status !== "running" || job.token === null) return;
      service.pause(job.token);
    },

    async resume(id: string): Promise<PackDownloadOutcome> {
      const job = jobs.get(id);
      if (job === undefined || job.status !== "paused") return refused(id, "not-found");
      if (!modeAllowsDownloads(deps.mode())) return refused(id, "downloads-off");
      job.status = "running";
      return await drive(job, true);
    },

    async cancel(id: string): Promise<void> {
      const job = jobs.get(id);
      if (job === undefined) return;
      if (job.status === "paused") {
        // Nothing is in flight to unwind, so the folder goes here and now; a
        // running download's is removed on the way out of `drive`.
        forget(job);
        if (job.token !== null) await service.cancel(job.token);
        await removeStage(job);
        return;
      }
      job.status = "cancelled";
      if (job.token !== null) await service.cancel(job.token);
    },
  };
}
