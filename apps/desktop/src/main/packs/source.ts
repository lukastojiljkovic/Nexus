/**
 * A pack folder, read to the point where it is either a pack this build will
 * install or a refusal with a code.
 *
 * This is the untrusted-input boundary for packs, and it is the same boundary
 * whether the folder came off a USB stick or out of the downloads run's staging
 * area. What it does NOT do is hash the content: it reads the two small files,
 * checks the signature over the manifest's exact bytes, validates the manifest,
 * checks the app-version floor, and then WALKS the folder to answer the three
 * structural questions — is every listed file here, is anything here that is not
 * listed, and is every listed size the size on disk. The hashes are checked
 * while copying (install) or on demand (verify), because reading fifty
 * gigabytes to answer "is this a pack" is not an inspection, it is the install.
 *
 * **A symbolic link or a junction is refused, not followed.** A pack that
 * contains a link could be pointing at anything on the machine — including the
 * user's own files, which the copy would then happily duplicate into a pack
 * directory — and the manifest cannot describe a link, because it lists regular
 * files with sizes. The check is a realpath comparison rather than
 * `isSymbolicLink` alone: on Windows a junction is a directory with a reparse
 * point, `lstat` reports it as a directory, and only resolving the path shows
 * that it went somewhere else.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

import { compareVersions } from "../update/version.js";
import { PackError, messageOf } from "./errors.js";
import { PACK_LIMITS } from "./limits.js";
import { parsePackManifest, type PackManifest } from "./manifest.js";
import { packPathProblem } from "./paths.js";
import { verifyPackSignature } from "./verify.js";

/** The manifest's file name, and the signature's. Both live at the pack's root. */
export const PACK_MANIFEST_FILE = "pack.json";
export const PACK_SIGNATURE_FILE = "pack.json.sig";

/** A folder that is a pack this build will install. */
export interface PackSource {
  /** The folder itself, as the user chose it. */
  readonly dir: string;
  readonly manifest: PackManifest;
  /** The manifest's exact bytes: what the signature covers, and what is stored beside the content. */
  readonly manifestBytes: Uint8Array;
  readonly signatureBytes: Uint8Array;
}

export interface OpenPackSourceInput {
  readonly dir: string;
  readonly appVersion: string;
  readonly publicKeyPem: string;
}

/** A file found on disk, with the size `lstat` reported for it. */
interface FoundFile {
  readonly path: string;
  readonly size: number;
}

function readBoundedFile(path: string, limit: number, tooLarge: PackError["code"]): Uint8Array {
  const stats = statSync(path);
  if (stats.size > limit) {
    throw new PackError(tooLarge, `${path} is over the ${String(limit)}-byte limit.`);
  }
  return readFileSync(path);
}

/**
 * Every regular file under `dir`, with `/`-separated relative paths, refusing
 * anything that is not a plain file or a plain directory.
 */
function walkSource(dir: string): FoundFile[] {
  const files: FoundFile[] = [];
  const resolve = (absolute: string): string => {
    try {
      return realpathSync(absolute);
    } catch (error) {
      throw new PackError("io", `A pack file could not be resolved: ${messageOf(error)}`);
    }
  };
  // `expected` is where this entry resolves if it is a plain file or folder: its
  // parent's resolved path plus its own name. A link or a junction resolves
  // somewhere else. The ROOT is the one entry not held to this — where the chosen
  // folder lives (behind a junction, a `subst` drive, a mounted volume) says
  // nothing about the pack, while a link INSIDE it is content pointing outside.
  // Compared case-insensitively because Windows' realpath may change the case of
  // the drive letter and nothing else.
  const visit = (absolute: string, relative: string, expected: string | null): void => {
    const real = resolve(absolute);
    if (expected !== null && real.toLowerCase() !== expected.toLowerCase()) {
      throw new PackError("symlink", `"${relative}" is a symbolic link or a junction.`);
    }

    // Walked from here on by the resolved path, so a root that is itself a
    // junction is read as the folder it leads to; below the root the two agree.
    const stats = lstatSync(real);
    if (stats.isDirectory()) {
      for (const name of readdirSync(real).sort()) {
        const child = join(real, name);
        visit(child, relative === "" ? name : `${relative}/${name}`, child);
      }
      return;
    }
    if (!stats.isFile()) {
      throw new PackError("not-a-file", `"${relative}" is neither a file nor a folder.`);
    }
    // The path rules are applied to what is ON DISK as well as to what the
    // manifest lists: a name this walk cannot produce is a name the copy below
    // never has to decide about.
    const problem = packPathProblem(relative);
    if (problem !== null) {
      throw new PackError("path-invalid", `"${relative}" is not a usable pack path (${problem}).`);
    }
    files.push({ path: relative, size: stats.size });
  };

  visit(dir, "", null);
  return files;
}

/**
 * The manifest against the folder: nothing missing, nothing extra, no size a
 * lie. `pack.json` and `pack.json.sig` are the two files the manifest cannot
 * list — it is one of them, and it cannot carry its own hash — so they are the
 * two names this comparison ignores.
 */
function compareWithManifest(found: readonly FoundFile[], manifest: PackManifest): void {
  const listed = new Set(manifest.files.map((file) => file.path));
  const onDisk = new Map<string, number>();
  for (const file of found) {
    if (file.path === PACK_MANIFEST_FILE || file.path === PACK_SIGNATURE_FILE) continue;
    onDisk.set(file.path, file.size);
  }

  for (const file of manifest.files) {
    const size = onDisk.get(file.path);
    if (size === undefined) {
      throw new PackError("missing-file", `The manifest lists "${file.path}", which is not in the folder.`);
    }
    if (size !== file.size) {
      throw new PackError(
        "size-mismatch",
        `"${file.path}" is ${String(size)} bytes; the manifest says ${String(file.size)}.`,
      );
    }
  }
  for (const path of onDisk.keys()) {
    if (!listed.has(path)) {
      throw new PackError("extra-file", `The folder holds "${path}", which the manifest does not list.`);
    }
  }
}

/**
 * Opens a pack folder: signature, manifest, app-version floor, then the three
 * structural questions. Throws `PackError` with a code for every refusal.
 */
export function openPackSource(input: OpenPackSourceInput): PackSource {
  let stats;
  try {
    stats = statSync(input.dir);
  } catch (error) {
    throw new PackError("not-a-pack", `The chosen folder cannot be read: ${messageOf(error)}`);
  }
  if (!stats.isDirectory()) {
    throw new PackError("not-a-directory", "A pack is a folder. Choose the folder that holds pack.json.");
  }

  let manifestBytes: Uint8Array;
  try {
    manifestBytes = readBoundedFile(
      join(input.dir, PACK_MANIFEST_FILE),
      PACK_LIMITS.manifestBytes,
      "manifest-too-large",
    );
  } catch (error) {
    if (error instanceof PackError) throw error;
    throw new PackError("not-a-pack", `There is no readable ${PACK_MANIFEST_FILE} in the chosen folder.`);
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = readBoundedFile(
      join(input.dir, PACK_SIGNATURE_FILE),
      PACK_LIMITS.signatureBytes,
      "signature",
    );
  } catch (error) {
    if (error instanceof PackError) throw error;
    throw new PackError("signature", `There is no readable ${PACK_SIGNATURE_FILE} beside the manifest.`);
  }

  if (!verifyPackSignature({ manifestBytes, signatureBytes, publicKeyPem: input.publicKeyPem })) {
    throw new PackError(
      "signature",
      "The manifest's signature is not the release key's signature over these exact bytes.",
    );
  }

  let parsed: unknown;
  try {
    // `fatal` so that a manifest which is not UTF-8 is a refusal rather than a
    // string with replacement characters in it: a hash or a path that lost a
    // byte would otherwise be compared against the wrong file.
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch (error) {
    throw new PackError("manifest-unreadable", `pack.json is not readable JSON: ${messageOf(error)}`);
  }

  const manifest = parsePackManifest(parsed);

  // The app-version floor. `compareVersions` answers `null` when either side is
  // not a version this build understands, and that answers here as "too new":
  // the app's own version is the side that can be unexpected (a dev build, a
  // repackaged binary), and refusing is the safe direction to be wrong in.
  const order = compareVersions(input.appVersion, manifest.minAppVersion);
  if (order === null || order < 0) {
    throw new PackError(
      "min-app-version-too-new",
      `This pack needs Nexus ${manifest.minAppVersion} or newer; this build is ${input.appVersion}.`,
    );
  }

  compareWithManifest(walkSource(input.dir), manifest);
  return { dir: input.dir, manifest, manifestBytes, signatureBytes };
}
