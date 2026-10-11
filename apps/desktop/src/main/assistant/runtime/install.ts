/**
 * EVERYTHING THAT WRITES UNDER `<userData>/models`, AND NOTHING ELSE.
 *
 * Three operations live here and they are the whole of this app's disk story
 * for models:
 *
 *   - **`installEntry`** downloads a catalogue or search entry through the
 *     download service (ADR-092) and moves the verified file into
 *     `<userData>/models/<id>/`.
 *   - **`importModel`** registers a `.gguf` the user picked in a dialog, in
 *     place: nothing is copied, and `remove` never deletes it (see below).
 *   - **`removeModel`** deletes a downloaded model's own directory, or forgets
 *     an imported file.
 *
 * THE DOWNLOAD SERVICE IS THE WHOLE VERIFICATION, and this module adds no second
 * one. It runs only in the `downloads` network mode, requests only allowlisted
 * https hosts on every hop, refuses a download with no expected SHA-256, checks
 * the free space before the first byte, hashes while it writes, DELETES the file
 * on a mismatch, and hands back a path only for bytes it has verified. Re-hashing
 * sixteen gigabytes here would be a second opinion about the same bytes bought
 * with a minute of the user's time. What is left for this file is the part the
 * service cannot know: which volume the model will live on, where it goes, and
 * what the registry remembers.
 *
 * WHY THE SERVICE'S STAGING DIRECTORY IS NOT THE MODEL'S DIRECTORY. The service
 * owns `<userData>/downloads/<id>.part` and renames a finished file to
 * `<userData>/downloads/<id>`; its directory is its own contract and this module
 * does not reach into it. A rename from there to `<userData>/models/<id>/<file>`
 * is one metadata operation on the same volume, so a model never exists twice on
 * a user's disk — and the `.part` file it leaves behind on a pause IS the resume
 * point, which is why a paused download is not cleaned up.
 *
 * AN IMPORTED FILE IS REGISTERED, NOT COPIED, AND `remove` FORGETS IT.
 * Copying the user's own file into `userData` would double its disk cost without
 * asking, and deleting it on "remove" would delete a file the user chose — the
 * one thing this app must never do to data it did not create. So the registry
 * keeps the path the dialog returned, the model lives where the user put it, and
 * `removeModel` deletes only what this app downloaded.
 *
 * `models/installed.json` is DERIVED BOOKKEEPING: read tolerantly (a corrupt
 * entry is skipped, not fatal), written atomically, and never the source of truth
 * for a file's bytes — the file's own SHA-256 was verified when it was installed.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { DownloadProgress, ModelEntry, ModelLicence } from "@nexus/core";
import type {
  DownloadOutcome,
  DownloadProgress as ServiceProgress,
  DownloadService,
} from "../../download/service.js";
import { modeAllowsDownloads, type NetworkMode } from "../../net/offline.js";
import { sha256File } from "../../packs/verify.js";
import {
  CatalogueError,
  MODELS_REGISTRY_VERSION,
  parseEntry,
  type CatalogueEntry,
} from "./catalogue.js";
import { RuntimeError } from "./errors.js";
import { GgufError, ggufFacts, ggufLicence, readGgufHeaderFromFile } from "./gguf.js";
import { resolveUrl } from "./huggingface.js";

/** `<userData>/models`: one directory per downloaded id, plus the registry beside them. */
export const MODELS_DIR = "models";

/** The registry's file name, inside `models/`. */
export const MODELS_REGISTRY_FILE = "installed.json";

/** What an install may need on top of a model's own bytes: the staging copy is renamed, not duplicated. */
export const INSTALL_HEADROOM_BYTES = 256 * 1024 * 1024;

export interface InstalledModel extends CatalogueEntry {
  /** Epoch milliseconds, when this app put the file there (or was told about it). */
  readonly installedAt: number;
}

export interface ModelsDeps {
  readonly userData: string;
  /** The mode this launch may ACT on. The service checks it too; this refuses earlier and says why. */
  readonly mode: () => NetworkMode;
  /**
   * The one download service of this launch, with this job's progress bound to
   * it. The service is a SINGLETON — it holds the resume state of every paused
   * download — so the callback cannot be handed to a constructor per call; it is
   * registered here, by job id, in the wiring that owns the instance.
   */
  readonly downloadFor: (jobId: string, onProgress: (progress: ServiceProgress) => void) => DownloadService;
  /** Free bytes on the volume holding a directory. Injected so "the disk is full" is a testable state. */
  readonly freeBytes: (dir: string) => Promise<number>;
  readonly now: () => number;
}

export function modelsRoot(userData: string): string {
  return join(userData, MODELS_DIR);
}

/** `<userData>/models/<id>` — one directory per downloaded model. */
export function modelDir(userData: string, id: string): string {
  return join(modelsRoot(userData), id);
}

/** Where a downloaded model's file lives: `<userData>/models/<id>/<file name>`. */
export function modelFilePath(userData: string, id: string, file: string): string {
  return join(modelDir(userData, id), file);
}

export function modelsRegistryPath(userData: string): string {
  return join(modelsRoot(userData), MODELS_REGISTRY_FILE);
}

/**
 * What is installed, as the registry says. Never throws: a missing file, a
 * truncated write and an entry from a future version all answer the same way —
 * with the entries this build could read, which for a first run is none.
 */
export function readInstalled(userData: string): readonly InstalledModel[] {
  let raw: string;
  try {
    raw = readFileSync(modelsRegistryPath(userData), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const record = parsed as { version?: unknown; models?: unknown };
  if (record.version !== MODELS_REGISTRY_VERSION || !Array.isArray(record.models)) return [];
  const models: InstalledModel[] = [];
  for (const value of record.models) {
    try {
      // `installedAt` is this file's own field and is read before `parseEntry`
      // sees the object, so the entry parser's rule about unknown keys stays
      // strict about everything else.
      const { installedAt, ...rest } = asRecord(value);
      const entry = parseEntry(rest, "the installed registry");
      models.push({
        ...entry,
        installedAt: typeof installedAt === "number" && Number.isSafeInteger(installedAt) ? installedAt : 0,
      });
    } catch (error) {
      // One unreadable entry does not cost the user the others. It is logged by
      // the caller's own log line, and the file itself is left exactly as it is:
      // deleting or rewriting a registry on a read path is how a bug becomes a
      // data loss.
      if (!(error instanceof CatalogueError)) throw error;
    }
  }
  return models;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Writes the registry whole, through a sibling that is renamed into place. */
export function writeInstalled(userData: string, models: readonly InstalledModel[]): void {
  const path = modelsRegistryPath(userData);
  mkdirSync(dirname(path), { recursive: true });
  const bytes = `${JSON.stringify({ version: MODELS_REGISTRY_VERSION, models }, null, 2)}\n`;
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, bytes, "utf8");
  renameSync(tmp, path);
}

/** Adds or replaces one entry, keeping the rest. */
export function upsertInstalled(userData: string, model: InstalledModel): void {
  const models = readInstalled(userData).filter((entry) => entry.id !== model.id);
  writeInstalled(userData, [...models, model]);
}

/** Forgets one id. The file itself is untouched: see the header. */
export function forgetInstalled(userData: string, id: string): void {
  const models = readInstalled(userData).filter((entry) => entry.id !== id);
  writeInstalled(userData, models);
}

/**
 * Downloads `entry` and installs it, answering the installed entry.
 *
 * The signal is a PAUSE, not a cancel: the service keeps its staging file and
 * the next call for the same entry resumes it, which is the behaviour a user
 * closing a progress dialog expects. Nothing partial is ever renamed into
 * `models/` — the rename happens only for an outcome of `done`, and `done` is
 * only ever handed back for bytes whose digest matched.
 */
export async function installEntry(
  deps: ModelsDeps,
  entry: ModelEntry,
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<InstalledModel> {
  if (!modeAllowsDownloads(deps.mode())) {
    throw new RuntimeError("mode", "Downloading is allowed only in the downloads network mode.");
  }
  const root = modelsRoot(deps.userData);
  const needed = entry.sizeBytes + INSTALL_HEADROOM_BYTES;
  let free: number;
  try {
    free = await deps.freeBytes(root);
  } catch (error) {
    throw new RuntimeError("io", `The free space could not be read: ${String(error)}`);
  }
  if (free < needed) {
    throw new RuntimeError("no-space", `The volume holds ${String(free)} bytes and this model needs ${String(needed)}.`);
  }

  const id = downloadJobId(entry.id);
  // The service reports a total only when the server declared one; the UI is
  // given the entry's own size instead, because it was measured from the file
  // listing and is always known.
  const service = deps.downloadFor(id, (progress) => {
    onProgress({ receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes ?? entry.sizeBytes });
  });
  const request = {
    id,
    url: resolveUrl(entry.repo, entry.file),
    expectedSha256: entry.sha256,
    sizeLimitBytes: entry.sizeBytes + INSTALL_HEADROOM_BYTES,
  };
  const onAbort = (): void => {
    service.pause(id);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  let outcome: DownloadOutcome;
  try {
    // The service can continue a download this session paused, and cannot
    // continue one from a previous session (its jobs are in memory), so a
    // `not-found` is a fresh start that overwrites the stale partial.
    const resumed = await service.resume(id);
    outcome = resumed.outcome === "refused" && resumed.problem === "not-found" ? await service.start(request) : resumed;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  if (outcome.outcome === "paused") {
    throw new RuntimeError("aborted", "The download was paused and can be resumed.");
  }
  if (outcome.outcome === "cancelled") {
    throw new RuntimeError("download", "The download was cancelled.");
  }
  if (outcome.outcome === "refused") {
    throw new RuntimeError(
      outcome.problem === "hash" ? "hash" : outcome.problem === "mode" ? "mode" : "download",
      `The download was refused: ${outcome.problem}`,
    );
  }

  const destination = modelFilePath(deps.userData, entry.id, entry.file);
  try {
    mkdirSync(modelDir(deps.userData, entry.id), { recursive: true });
    renameSync(outcome.path, destination);
  } catch (error) {
    throw new RuntimeError("io", `The downloaded model could not be put in place: ${String(error)}`);
  }

  const installed: InstalledModel = { ...entry, installedAt: deps.now() };
  upsertInstalled(deps.userData, installed);
  return installed;
}

/**
 * Registers a `.gguf` the user picked, in place.
 *
 * The file is READ twice and never written: once for its header (`readGgufHeader`
 * reads at most 32 MB of it), and once to hash it, which the registry needs
 * because an imported model is the one thing here nobody else has hashed. A file
 * that is a vision projector is refused rather than registered: this runtime
 * cannot use one (ADR-096), and registering it as a chat model would be a lie
 * the first generation would expose.
 */
export async function importModel(deps: ModelsDeps, path: string): Promise<InstalledModel> {
  let header;
  try {
    header = await readGgufHeaderFromFile(path);
  } catch (error) {
    if (error instanceof GgufError) {
      throw new RuntimeError("not-a-gguf", `"${basename(path)}" is not a GGUF file this build reads: ${error.message}`);
    }
    throw new RuntimeError("io", `The file could not be read: ${String(error)}`);
  }
  const facts = ggufFacts(header);
  if (facts.projector) {
    throw new RuntimeError(
      "not-a-gguf",
      `"${basename(path)}" is a vision projector; pick the model file it belongs to.`,
    );
  }

  let sizeBytes: number;
  try {
    sizeBytes = statSync(path).size;
  } catch (error) {
    throw new RuntimeError("io", `The file could not be measured: ${String(error)}`);
  }
  if (sizeBytes === 0) throw new RuntimeError("not-a-gguf", `"${basename(path)}" is empty.`);

  let sha256: string;
  try {
    sha256 = await sha256File(path);
  } catch (error) {
    throw new RuntimeError("io", `The file could not be hashed: ${String(error)}`);
  }

  const declared = ggufLicence(header);
  const licence: ModelLicence = { name: declared.name ?? "", url: declared.url ?? "" };
  const file = basename(path);
  const installed: InstalledModel = {
    id: importedId(file, sha256),
    origin: "file",
    title: file.replace(/\.gguf$/i, ""),
    family: facts.architecture ?? "",
    repo: "",
    file,
    sha256,
    sizeBytes,
    // Derived from the file name by `parseEntry`, which is the one place that reads it.
    quantization: "",
    contextTokens: facts.contextTokens ?? 0,
    // `vision` is never claimed: no entry in this runtime can use images
    // (ADR-096), and an imported file that declares them is still a chat model.
    capabilities: facts.embedding ? ["embedding"] : ["chat"],
    languages: [],
    licence,
    path,
    installedAt: deps.now(),
  };
  upsertInstalled(deps.userData, installed);
  return installed;
}

/**
 * Removes a model: a downloaded one's own directory goes, an imported one is
 * forgotten. See the header for why the two differ.
 */
export function removeModel(deps: ModelsDeps, id: string): void {
  const installed = readInstalled(deps.userData).find((entry) => entry.id === id);
  if (installed === undefined) return;
  if (installed.origin !== "file") {
    try {
      rmSync(modelDir(deps.userData, id), { recursive: true, force: true });
    } catch (error) {
      throw new RuntimeError("io", `The model's files could not be removed: ${String(error)}`);
    }
  }
  forgetInstalled(deps.userData, id);
}

/** An id the download service accepts: letters, digits, `_` and `-`, at most 64 characters. */
export function downloadJobId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

/**
 * An id for an imported file: `imported-<name>-<8 hex of its SHA-256>`.
 *
 * The hash is in the name because a user may import the same file twice from two
 * folders, and two entries with different paths and the same id would be one
 * entry the second time. The name is in it because an id is what a screen shows
 * when something goes wrong — `imported-qwen3.5-4b-q4-k-m-1a2b3c4d` says what
 * happened, and a bare hash does not.
 */
export function importedId(file: string, sha256: string): string {
  const stem = file
    .replace(/\.gguf$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `imported-${stem === "" ? "model" : stem}-${sha256.slice(0, 8)}`;
}

