/**
 * Install, verify and remove — the three things that move bytes under
 * `<userData>/packs`.
 *
 * **The seam for downloads is `installPackFromDirectory`.** It takes a folder
 * that is already on disk and does the rest; the future downloads run
 * downloads into its own staging area and calls exactly this, so the network
 * half never needs to know how a pack is verified, and this half never needs to
 * know where the folder came from. Nothing here reaches the network, and
 * nothing here would notice if a folder had come from one.
 *
 * **Copy and hash are one pass.** Every byte is read once, through a running
 * SHA-256, and written to the staging folder; the hash is compared when the
 * file ends. There is no "verify then copy" that could be raced, and a
 * twenty-gigabyte file never exists in memory: the stream's own buffer is the
 * ceiling.
 *
 * **Staging, then one rename.** The whole pack is assembled under
 * `packs/.staging/<random>/` and renamed to `packs/<id>/<version>/` when it is
 * complete, which is the only atomic step available and the reason an
 * interrupted install leaves no trace: the failure path deletes the staging
 * folder, and the destination is only ever created by the rename itself. An
 * upgrade copies the new version first and removes the old one afterwards, so
 * the old version keeps working for as long as the new one is incomplete.
 */

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, readdirSync, statfsSync, writeFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

import type { PackProgress } from "../../shared/ipc.js";
import { PackError, messageOf } from "./errors.js";
import { PACK_LIMITS } from "./limits.js";
import { packContentBytes } from "./manifest.js";
import { packPathSegments } from "./paths.js";
import {
  PACKS_STAGING_DIR,
  packIdDir,
  packVersionDir,
  packsRoot,
  readInstalled,
  refreshInstalled,
  type InstalledPack,
} from "./registry.js";
import { PACK_MANIFEST_FILE, PACK_SIGNATURE_FILE, openPackSource } from "./source.js";
import { sha256File } from "./verify.js";

export interface PackInstallDeps {
  readonly userData: string;
  /** `app.getVersion()`: what the pack's `minAppVersion` is compared against. */
  readonly appVersion: string;
  readonly publicKeyPem: string;
  readonly onProgress: (progress: PackProgress) => void;
  /**
   * Free bytes on the volume that holds `dir`, or `null` when this platform
   * cannot say. Injected rather than called directly so a test can install onto
   * a volume that is full without filling one.
   */
  readonly freeBytes: (dir: string) => number | null;
}

/**
 * Free bytes on the volume holding `dir`, through `statfs`. `null` — never a
 * made-up number — when the platform cannot answer, because a check that
 * guessed would refuse installs on a machine that has room.
 */
export function volumeFreeBytes(dir: string): number | null {
  try {
    const stats = statfsSync(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

/**
 * Copies one file while hashing it, refusing a file whose bytes are not the
 * bytes the manifest described. `onChunk` reports each chunk so a long copy can
 * say how far it has got.
 */
async function copyVerified(
  from: string,
  to: string,
  expectedSize: number,
  expectedHash: string,
  onChunk: (bytes: number) => void,
): Promise<void> {
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    await pipeline(
      createReadStream(from),
      async function* (stream: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
        for await (const chunk of stream) {
          bytes += chunk.byteLength;
          // Checked before the hash so a file that has already outgrown its
          // declaration stops the copy instead of filling the disk first.
          if (bytes > expectedSize) {
            throw new PackError(
              "size-mismatch",
              `"${from}" is longer than the ${String(expectedSize)} bytes the manifest states.`,
            );
          }
          hash.update(chunk);
          onChunk(chunk.byteLength);
          yield chunk;
        }
      },
      createWriteStream(to),
    );
  } catch (error) {
    if (error instanceof PackError) throw error;
    throw new PackError("io", `"${from}" could not be copied: ${messageOf(error)}`);
  }
  if (bytes !== expectedSize) {
    throw new PackError(
      "size-mismatch",
      `"${from}" is ${String(bytes)} bytes; the manifest says ${String(expectedSize)}.`,
    );
  }
  const actual = hash.digest("hex");
  if (actual !== expectedHash) {
    throw new PackError("hash-mismatch", `"${from}" does not have the SHA-256 the manifest states.`);
  }
}

function progressReporter(
  emit: (progress: PackProgress) => void,
  id: string,
  phase: PackProgress["phase"],
  filesTotal: number,
  bytesTotal: number,
): {
  readonly chunk: (file: string, chunkBytes: number) => void;
  readonly file: (file: string) => void;
} {
  let bytes = 0;
  let reported = 0;
  let filesDone = 0;
  return {
    chunk(file, chunkBytes) {
      bytes += chunkBytes;
      if (bytes - reported < PACK_LIMITS.progressStepBytes) return;
      reported = bytes;
      emit({ id, phase, file, filesDone, filesTotal, bytesDone: bytes, bytesTotal });
    },
    file(file) {
      filesDone += 1;
      emit({ id, phase, file, filesDone, filesTotal, bytesDone: bytes, bytesTotal });
    },
  };
}

/**
 * Installs the pack in `sourceDir`.
 *
 * Refuses, with a code, before it writes anything: a folder that is not a pack,
 * a manifest the key did not sign, a pack this build is too old for, a file set
 * that does not match the manifest, or a volume without room. After that the
 * only failures left are the copy's own, and each of those deletes what it
 * wrote.
 */
export async function installPackFromDirectory(
  sourceDir: string,
  deps: PackInstallDeps,
): Promise<InstalledPack> {
  const source = openPackSource({
    dir: sourceDir,
    appVersion: deps.appVersion,
    publicKeyPem: deps.publicKeyPem,
  });
  const manifest = source.manifest;
  const totalBytes = packContentBytes(manifest);
  const root = packsRoot(deps.userData);

  try {
    await mkdir(root, { recursive: true });
  } catch (error) {
    throw new PackError("io", `The packs folder could not be created: ${messageOf(error)}`);
  }

  const free = deps.freeBytes(root);
  if (free !== null && free < totalBytes + PACK_LIMITS.installHeadroomBytes) {
    throw new PackError(
      "no-space",
      `This pack needs ${String(totalBytes + PACK_LIMITS.installHeadroomBytes)} free bytes; ${String(free)} are available.`,
    );
  }

  const staging = join(root, PACKS_STAGING_DIR, randomBytes(8).toString("hex"));
  try {
    await mkdir(staging, { recursive: true });
    const progress = progressReporter(
      deps.onProgress,
      manifest.id,
      "copy",
      manifest.files.length,
      totalBytes,
    );
    for (const file of manifest.files) {
      const segments = packPathSegments(file.path);
      const to = join(staging, ...segments);
      await mkdir(dirname(to), { recursive: true });
      await copyVerified(join(sourceDir, ...segments), to, file.size, file.sha256, (chunkBytes) => {
        progress.chunk(file.path, chunkBytes);
      });
      progress.file(file.path);
    }
    // The manifest and its signature are stored beside the content: the
    // installed pack has to be able to prove what it is on the next start,
    // without the folder it came from.
    writeFileSync(join(staging, PACK_MANIFEST_FILE), source.manifestBytes);
    writeFileSync(join(staging, PACK_SIGNATURE_FILE), source.signatureBytes);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error instanceof PackError ? error : new PackError("io", messageOf(error));
  }

  const idDir = packIdDir(deps.userData, manifest.id);
  const target = packVersionDir(deps.userData, manifest.id, manifest.version);
  try {
    await mkdir(idDir, { recursive: true });
    // Installing the same version again replaces it. The previous copy is only
    // removed at the instant before the rename, so a failure above this line
    // leaves the installed version exactly as it was.
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error instanceof PackError ? error : new PackError("io", messageOf(error));
  }

  // The upgrade half: the new version is complete on disk, which is what makes
  // removing the old one safe.
  try {
    for (const name of readdirSync(idDir)) {
      if (name !== manifest.version) {
        await rm(join(idDir, name), { recursive: true, force: true });
      }
    }
  } catch {
    // A leftover older version is a stale folder, not a failed install. The
    // index below is rebuilt from what is on disk either way, and the next
    // install of this id sweeps it again.
  }

  const installed = refreshInstalled(deps.userData, deps.publicKeyPem).find(
    (pack) => pack.manifest.id === manifest.id && pack.manifest.version === manifest.version,
  );
  if (installed === undefined) {
    throw new PackError("io", "The pack was copied but the packs index does not list it.");
  }
  return installed;
}

/**
 * Re-hashes every file of an installed pack against its signed manifest.
 *
 * This is the expensive one, and it is the only place hashes are read back:
 * startup and the index never do it (see `registry.ts`). `removeMissing` is not
 * a parameter: a file that vanished is as much a failure as a file that
 * changed, and the answer in both cases is that this pack is not intact.
 */
export async function verifyInstalledPack(input: {
  readonly userData: string;
  readonly id: string;
  readonly publicKeyPem: string;
  readonly onProgress: (progress: PackProgress) => void;
}): Promise<InstalledPack> {
  const installed = readInstalled(input.userData, input.publicKeyPem).find(
    (pack) => pack.manifest.id === input.id,
  );
  if (installed === undefined) {
    throw new PackError("not-found", `No installed pack has the id "${input.id}".`);
  }

  const dir = packVersionDir(input.userData, input.id, installed.manifest.version);
  const totalBytes = packContentBytes(installed.manifest);
  const progress = progressReporter(
    input.onProgress,
    input.id,
    "verify",
    installed.manifest.files.length,
    totalBytes,
  );

  for (const file of installed.manifest.files) {
    const path = join(dir, ...packPathSegments(file.path));
    let actual: string;
    try {
      actual = await sha256File(path, (chunkBytes) => {
        progress.chunk(file.path, chunkBytes);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new PackError("missing-file", `"${file.path}" is no longer in the installed pack.`);
      }
      throw new PackError("io", `"${file.path}" could not be read: ${messageOf(error)}`);
    }
    if (actual !== file.sha256) {
      throw new PackError("hash-mismatch", `"${file.path}" does not have the SHA-256 the manifest states.`);
    }
    progress.file(file.path);
  }
  return installed;
}

/** Removes an installed pack's whole folder and answers with the packs that remain. */
export async function removeInstalledPack(input: {
  readonly userData: string;
  readonly id: string;
  readonly publicKeyPem: string;
}): Promise<InstalledPack[]> {
  const installed = readInstalled(input.userData, input.publicKeyPem).find(
    (pack) => pack.manifest.id === input.id,
  );
  if (installed === undefined) {
    throw new PackError("not-found", `No installed pack has the id "${input.id}".`);
  }
  try {
    await rm(packIdDir(input.userData, input.id), { recursive: true, force: true });
  } catch (error) {
    throw new PackError("io", `The pack could not be removed: ${messageOf(error)}`);
  }
  return refreshInstalled(input.userData, input.publicKeyPem);
}

