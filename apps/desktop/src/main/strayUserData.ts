import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";

import { absorbAccountsFrom, accountsToAbsorb } from "./accounts.js";

/**
 * THE FOLDER 2.0.0 TO 2.0.2 WROTE TO BY MISTAKE, AND THE ONE-WAY MOVE OUT OF IT.
 *
 * Electron names `userData` after the app the first time anything asks for it,
 * and keeps that answer. From 2.0.0 the assistant's runtime asked at import,
 * before `index.ts` named the app, so every 2.x launch kept its data in
 * `<appData>/@nexus/desktop` (the package's name) instead of `<appData>/Nexus`.
 * An install upgraded from 1.x showed none of its accounts, and whatever was made
 * in 2.x is in the stray folder.
 *
 * This moves what 2.x made into the real folder, item by item:
 *
 * - Chromium's `Local State`, when 2.x made an account. On Windows it holds the
 *   key `safeStorage` encrypts with, and every account's key chain carries a
 *   guard encrypted under it: an account moved without it asks for its Recovery
 *   Kit instead of its passcode (measured on a packaged build, 2026-10-14). Only
 *   one key can be in use, so it follows the accounts used last — 2.x's — and
 *   nothing that unlocked yesterday stops unlocking. A 1.x key it replaces is
 *   kept beside it as `Local State.before-2.0.3`, and the 1.x accounts it
 *   belonged to ask once for their Recovery Kit. On Linux and macOS the key
 *   lives in the OS keyring under the app's name, which 2.x already had.
 * - every account directory with a key chain whose id is not already here,
 *   with its label, and the selection when it was the account used last;
 * - the packs, Kiwix libraries, models and renderer storage 2.x made, when this
 *   folder has none of its own (the indexes hold no absolute paths, so each
 *   folder moves whole);
 * - the network choice, the web-search consent, the Brave Search key and the
 *   hidden modules. 2.x's user made those more recently than any 1.x one, so
 *   they replace it; the key decrypts under the `Local State` that came with
 *   the accounts, and reads as no key at all where none came.
 *
 * Nothing is deleted. A move that fails (a file still open) is reported and
 * tried again at the next launch, and every move is a rename that either
 * happened or did not. The key goes first, so a crash before the accounts
 * follow leaves them waiting in the stray folder with the key already home.
 */
export function strayUserDataDir(appData: string): string {
  return join(appData, "@nexus", "desktop");
}

const LOCAL_STATE = "Local State";
export const REPLACED_LOCAL_STATE = "Local State.before-2.0.3";
const CONTENT_DIRS = ["packs", "zim", "models", "Local Storage"] as const;
const PREFERENCE_FILES = ["network.json", "assistant-web.json", "assistant-web-secrets.json", "visibility.json"] as const;

/** What one pass moved, by name, and what it could not, as lines for stderr. */
export interface StrayMove {
  readonly moved: readonly string[];
  readonly failed: readonly string[];
}

export function absorbStrayUserData(userData: string, stray: string): StrayMove {
  const moved: string[] = [];
  const failed: string[] = [];
  if (resolve(stray) === resolve(userData) || !existsSync(stray)) return { moved, failed };
  const report = (name: string, error: unknown) => failed.push(`${name} stays in ${stray}: ${String(error)}`);
  const move = (name: string, to: string, replace: boolean): boolean => {
    const from = join(stray, name);
    if (!existsSync(from) || (!replace && existsSync(to))) return false;
    try {
      renameSync(from, to);
      moved.push(name);
      return true;
    } catch (error) {
      report(name, error);
      return false;
    }
  };

  try {
    mkdirSync(userData, { recursive: true });
    if (accountsToAbsorb(userData, stray).length > 0 && existsSync(join(stray, LOCAL_STATE))) {
      const ours = join(userData, LOCAL_STATE);
      const kept = join(userData, REPLACED_LOCAL_STATE);
      if (existsSync(ours) && !existsSync(kept)) renameSync(ours, kept);
      move(LOCAL_STATE, ours, false);
    }
    const accounts = absorbAccountsFrom(userData, stray, (id, error) => report(`accounts/${id}`, error));
    moved.push(...accounts.map((id) => `accounts/${id}`));
  } catch (error) {
    report("accounts", error);
  }
  for (const dir of CONTENT_DIRS) move(dir, join(userData, dir), false);
  for (const file of PREFERENCE_FILES) move(file, join(userData, file), true);
  return { moved, failed };
}
