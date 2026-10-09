/**
 * ADR-091's IPC surface: the Packs card's five calls, and nothing else in this
 * process knows a pack exists.
 *
 * **A renderer can never name a path, in either direction.** `inspect` is the
 * only operation that learns where a pack is, and it learns it from a native
 * dialog MAIN opened; `install` then takes no argument at all and installs what
 * that dialog left waiting. A channel through which a renderer could hand main
 * a folder to copy from would be a way to make this app write an arbitrary
 * directory of the user's choosing into `packs/`, and the reading half of a
 * pack (`openPackSource`) is expensive enough that a renderer-triggered walk is
 * a denial of service waiting to happen.
 *
 * **A refusal is data; a bug is an exception.** Every `PackError` below becomes
 * `{ outcome: "refused", code }`, and anything else propagates — a card that
 * shows "something went wrong" for a bug is a card that hides the bug.
 *
 * The service takes its effects injected (`pickFolder`, `onProgress`,
 * `onChanged`, `freeBytes`) so it can be tested without Electron, a dialog or a
 * real volume, which is `elecRunnerIpc.ts`'s arrangement and `service.ts`'s
 * before it.
 */

import { existsSync } from "node:fs";

import type {
  InstalledPackView,
  PackCandidateView,
  PackInspectResult,
  PackInstallResult,
  PackProgress,
  PackRemoveResult,
  PackVerifyResult,
} from "../../shared/ipc.js";
import { packRefusalCode } from "./errors.js";
import {
  installPackFromDirectory,
  refuseRollback,
  removeInstalledPack,
  verifyInstalledPack,
} from "./install.js";
import { packContentBytes, type PackManifest } from "./manifest.js";
import {
  readInstalled,
  registryPath,
  writeInstalled,
  type InstalledPack,
} from "./registry.js";
import { openPackSource } from "./source.js";

export interface PacksIpcDeps {
  readonly userData: string;
  readonly appVersion: string;
  readonly publicKeyPem: string;
  /**
   * Opens main's folder dialog and answers the chosen path, or `null` when the
   * user cancelled. Injected because a dialog needs a window this module must
   * not own — and because a test can then inspect a folder it built.
   */
  readonly pickFolder: () => Promise<string | null>;
  readonly onProgress: (progress: PackProgress) => void;
  readonly onChanged: (packs: InstalledPackView[]) => void;
  readonly freeBytes: (dir: string) => number | null;
}

export interface PacksIpc {
  list(): Promise<InstalledPackView[]>;
  inspect(): Promise<PackInspectResult>;
  install(): Promise<PackInstallResult>;
  remove(id: string): Promise<PackRemoveResult>;
  verify(id: string): Promise<PackVerifyResult>;
}

/**
 * A pack id from the wire. The shape is the manifest's own kebab rule, checked
 * again here because the two channels below name a folder: the id arrives as a
 * string the renderer wrote, and `main/index.ts`'s `asId` bounds its length but
 * not its shape.
 */
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function packId(value: unknown): string {
  if (typeof value !== "string" || !KEBAB_ID.test(value)) {
    throw new Error(`Invalid IPC payload: "id" must be a kebab-case pack id.`);
  }
  return value;
}

function toView(pack: InstalledPack): InstalledPackView {
  const manifest = pack.manifest;
  return {
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    title: manifest.title,
    description: manifest.description,
    licence: manifest.licence,
    source: manifest.source,
    size: pack.size,
    fileCount: pack.fileCount,
    installedAt: pack.installedAt,
  };
}

/** A candidate is a manifest that verified but is not installed; its size is what the manifest says it will weigh. */
function toCandidate(manifest: PackManifest): PackCandidateView {
  return {
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    title: manifest.title,
    description: manifest.description,
    licence: manifest.licence,
    source: manifest.source,
    size: packContentBytes(manifest),
    fileCount: manifest.files.length,
    minAppVersion: manifest.minAppVersion,
  };
}

export function createPacksIpc(deps: PacksIpcDeps): PacksIpc {
  /**
   * The folder the last `inspect` verified, waiting for `install`.
   *
   * One slot, and it holds a path rather than a `PackSource`: installing
   * re-reads the folder, so a pack swapped between the two calls is refused
   * rather than installed from a stale decision. It is cleared after every
   * install attempt, successful or not, so a second `install` can never repeat
   * the first one by accident.
   */
  let pending: string | null = null;

  /**
   * The installed list, from the index when it is usable and from disk when it
   * is not (see `registry.ts`). The index is written the first time it is
   * rebuilt, so a device that has never had a pack does not rebuild on every
   * mount.
   */
  function listPacks(): InstalledPack[] {
    const packs = readInstalled(deps.userData, deps.publicKeyPem);
    if (!existsSync(registryPath(deps.userData))) {
      writeInstalled(deps.userData, packs);
    }
    return packs;
  }

  async function list(): Promise<InstalledPackView[]> {
    return listPacks().map(toView);
  }

  async function inspect(): Promise<PackInspectResult> {
    const dir = await deps.pickFolder();
    if (dir === null) return { outcome: "cancelled" };
    try {
      const source = openPackSource({
        dir,
        appVersion: deps.appVersion,
        publicKeyPem: deps.publicKeyPem,
      });
      // Told now, rather than after the user has pressed Install.
      refuseRollback(deps.userData, deps.publicKeyPem, source.manifest);
      pending = dir;
      return { outcome: "ready", candidate: toCandidate(source.manifest) };
    } catch (error) {
      pending = null;
      const code = packRefusalCode(error);
      if (code === null) throw error;
      return { outcome: "refused", code };
    }
  }

  async function install(): Promise<PackInstallResult> {
    const dir = pending;
    pending = null;
    if (dir === null) return { outcome: "refused", code: "no-candidate" };
    try {
      const installed = await installPackFromDirectory(dir, {
        userData: deps.userData,
        appVersion: deps.appVersion,
        publicKeyPem: deps.publicKeyPem,
        onProgress: deps.onProgress,
        freeBytes: deps.freeBytes,
      });
      deps.onChanged(listPacks().map(toView));
      return { outcome: "installed", pack: toView(installed) };
    } catch (error) {
      const code = packRefusalCode(error);
      if (code === null) throw error;
      return { outcome: "refused", code };
    }
  }

  async function remove(rawId: string): Promise<PackRemoveResult> {
    const id = packId(rawId);
    try {
      const packs = await removeInstalledPack({
        userData: deps.userData,
        id,
        publicKeyPem: deps.publicKeyPem,
      });
      deps.onChanged(packs.map(toView));
      return { outcome: "removed", id };
    } catch (error) {
      const code = packRefusalCode(error);
      if (code === null) throw error;
      return { outcome: "refused", code };
    }
  }

  async function verify(rawId: string): Promise<PackVerifyResult> {
    const id = packId(rawId);
    try {
      const installed = await verifyInstalledPack({
        userData: deps.userData,
        id,
        publicKeyPem: deps.publicKeyPem,
        onProgress: deps.onProgress,
      });
      return { outcome: "ok", pack: toView(installed) };
    } catch (error) {
      const code = packRefusalCode(error);
      if (code === null) throw error;
      return { outcome: "refused", code };
    }
  }

  return { list, inspect, install, remove, verify };
}
