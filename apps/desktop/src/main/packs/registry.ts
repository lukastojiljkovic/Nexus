/**
 * `installed.json`: what is installed, as an index rebuilt from the packs
 * directory.
 *
 * The packs live on disk, one folder per id and one folder per version inside
 * it, and each carries its own signed `pack.json`. That signed manifest is the
 * source of truth; the index exists so that opening the Packs card does not
 * mean reading every installed pack's manifest, and so a pack's title and
 * licence are available to a screen that only wants to draw a list.
 *
 * **It is derived, never authoritative.** A missing or unreadable index is
 * rebuilt by walking the directory and re-verifying each installed pack's
 * signature — of the manifest only, never of the content. Hashing fifty
 * gigabytes at startup was considered and is not acceptable; the hashes are
 * re-checked when the user asks (the card's „Verify").
 *
 * The index is written whole and renamed into place, so a crash mid-write
 * leaves the previous index rather than half of a new one. That matters less
 * than it sounds — the next start rebuilds from disk anyway — but a file that
 * is sometimes truncated for no reason is a file nobody can read logs about.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PackError, messageOf } from "./errors.js";
import { packContentBytes, parsePackManifest, type PackManifest } from "./manifest.js";
import { PACK_MANIFEST_FILE, PACK_SIGNATURE_FILE } from "./source.js";
import { verifyPackSignature } from "./verify.js";

/** The packs directory under `<userData>`, and the two names reserved inside it. */
export const PACKS_DIR = "packs";
export const PACKS_STAGING_DIR = ".staging";
export const PACKS_REGISTRY_FILE = "installed.json";

/** The index's own format, so a future one can be recognised rather than guessed at. */
export const PACKS_REGISTRY_VERSION = 1;

/** One installed pack: its signed manifest, and the three facts derived from the copy on disk. */
export interface InstalledPack {
  readonly manifest: PackManifest;
  /** Every listed file's size, added up. */
  readonly size: number;
  readonly fileCount: number;
  /** Epoch milliseconds of the folder's own timestamp — when this version landed. */
  readonly installedAt: number;
}

/** `<userData>/packs`. */
export function packsRoot(userData: string): string {
  return join(userData, PACKS_DIR);
}

/** `<userData>/packs/<id>` — one folder per pack id, one version folder inside it. */
export function packIdDir(userData: string, id: string): string {
  return join(packsRoot(userData), id);
}

/** Where an installed id might keep a version of itself. */
export function packVersionDir(userData: string, id: string, version: string): string {
  return join(packIdDir(userData, id), version);
}

/** Where the index lives. */
export function registryPath(userData: string): string {
  return join(packsRoot(userData), PACKS_REGISTRY_FILE);
}

/**
 * One installed pack, read from its folder, or `null` when the folder is not a
 * verifiable pack.
 *
 * `id` and `version` are passed in rather than trusted from the manifest: a
 * folder named `wikipedia-sr/1.0.0` whose manifest says something else is a
 * folder somebody edited, and listing it under the manifest's name would make
 * the directory and the index disagree about where it is.
 */
function readInstalledDir(
  userData: string,
  id: string,
  version: string,
  publicKeyPem: string,
): InstalledPack | null {
  const dir = join(packIdDir(userData, id), version);
  try {
    const manifestBytes = readFileSync(join(dir, PACK_MANIFEST_FILE));
    const signatureBytes = readFileSync(join(dir, PACK_SIGNATURE_FILE));
    if (!verifyPackSignature({ manifestBytes, signatureBytes, publicKeyPem })) return null;
    const manifest = parsePackManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)));
    if (manifest.id !== id || manifest.version !== version) return null;
    return {
      manifest,
      size: packContentBytes(manifest),
      fileCount: manifest.files.length,
      installedAt: statSync(dir).mtimeMs,
    };
  } catch {
    // Any failure at all — a missing file, a manifest a hand edit broke, a
    // signature that no longer checks out — means this folder is not a pack
    // this build will list. It is not deleted: saying nothing about it is
    // recoverable, and deleting a folder on a read path is not.
    return null;
  }
}

/**
 * The index as this directory actually is, sorted by id.
 *
 * A version folder of the same id whose manifest does not verify is skipped and
 * the others are still listed: one damaged version is not a reason to lose
 * sight of the pack that installed yesterday.
 */
export function rebuildInstalled(userData: string, publicKeyPem: string): InstalledPack[] {
  const root = packsRoot(userData);
  const packs: InstalledPack[] = [];
  let ids: string[];
  try {
    ids = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== PACKS_STAGING_DIR)
      .map((entry) => entry.name)
      .sort();
  } catch {
    // No packs directory yet: nothing is installed, which is not a problem to
    // report.
    return [];
  }

  for (const id of ids) {
    let versions: string[];
    try {
      versions = readdirSync(join(root, id), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      continue;
    }
    for (const version of versions) {
      const installed = readInstalledDir(userData, id, version, publicKeyPem);
      if (installed !== null) packs.push(installed);
    }
  }
  return packs;
}

function parseRegistry(text: string): InstalledPack[] | null {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record["version"] !== PACKS_REGISTRY_VERSION) return null;
  const entries = record["packs"];
  if (!Array.isArray(entries)) return null;

  const packs: InstalledPack[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    const size = row["size"];
    const fileCount = row["fileCount"];
    const installedAt = row["installedAt"];
    if (typeof size !== "number" || !Number.isFinite(size)) return null;
    if (typeof fileCount !== "number" || !Number.isFinite(fileCount)) return null;
    if (typeof installedAt !== "number" || !Number.isFinite(installedAt)) return null;
    packs.push({ manifest: parsePackManifest(row["manifest"]), size, fileCount, installedAt });
  }
  return packs;
}

/**
 * The index, read; and rebuilt from disk when it is missing, unreadable, of an
 * unknown version, or describes a shape this build does not recognise.
 */
export function readInstalled(userData: string, publicKeyPem: string): InstalledPack[] {
  let text: string;
  try {
    text = readFileSync(registryPath(userData), "utf8");
  } catch {
    return rebuildInstalled(userData, publicKeyPem);
  }
  let packs: InstalledPack[] | null;
  try {
    packs = parseRegistry(text);
  } catch {
    packs = null;
  }
  if (packs === null) return rebuildInstalled(userData, publicKeyPem);
  return packs;
}

/** Writes the index whole, through a temporary file and a rename. */
export function writeInstalled(userData: string, packs: readonly InstalledPack[]): void {
  const path = registryPath(userData);
  try {
    mkdirSync(packsRoot(userData), { recursive: true });
    const body = `${JSON.stringify({ version: PACKS_REGISTRY_VERSION, packs }, null, 2)}\n`;
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, body, "utf8");
    renameSync(temporary, path);
  } catch (error) {
    // A pack that installed and could not write its index is a pack the next
    // start rebuilds from disk; it must not fail the install that has already
    // completed on disk.
    if (error instanceof PackError) throw error;
    throw new PackError("io", `The packs index could not be written: ${messageOf(error)}`);
  }
}

/** Rebuilds the index from disk and saves it. The one call an install or a removal ends with. */
export function refreshInstalled(userData: string, publicKeyPem: string): InstalledPack[] {
  const packs = rebuildInstalled(userData, publicKeyPem);
  writeInstalled(userData, packs);
  return packs;
}
