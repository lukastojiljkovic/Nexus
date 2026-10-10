import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { PackManifest } from "../../../main/packs/manifest.js";
import {
  packVersionDir,
  readInstalled,
  type InstalledPack,
} from "../../../main/packs/registry.js";
import { compareVersions } from "../../../main/update/version.js";
import { readerDisplayName } from "@nexus/core";

/**
 * The Reader's view of what is installed: content packs, and the articles inside
 * one.
 *
 * **Only `kind: "content"` packs are books.** A ZIM, a map, a dataset and a model
 * are content too, and each of them needs an engine this build does not have
 * (Kiwix's reader, MapLibre's tile pipeline, a model runtime). Showing one in the
 * library and then failing to open it would be a promise the app cannot keep, so
 * the library is exactly the packs this module can actually render - and the
 * `content` kind is what a pack says when its files ARE its pages.
 *
 * **A pack's article list never comes from the filesystem.** It comes from the
 * SIGNED manifest's `files`: every `.md` entry is an article, everything else is
 * an asset (an image the article points at, served through `nx-pack:`). That is
 * also the path gate - a path the manifest does not list is never opened, so a
 * renderer naming `../../nexus.db` is refused by not being in a list rather than
 * by a comparison somebody has to keep right.
 *
 * **The article cap is a memory bound, not a policy.** A pack is a stranger's
 * folder and a listed file may be sixty-four gigabytes; reading one into a string
 * to parse it is the one place this module's memory is decided by somebody else.
 * Four mebibytes of Markdown is a thousand pages, far past any article a person
 * reads, and past it the article is reported as unreadable rather than truncated -
 * half an article presented as whole is the lie this refusal avoids.
 */

export const READER_ARTICLE_EXTENSION = ".md";
export const MAX_READER_ARTICLE_BYTES = 4 * 1024 * 1024;

/** Whether a listed path is an article the module may read: a `.md` file the manifest names. */
export function isArticle(pack: ContentPack, path: string): boolean {
  return isArticlePath(path) && pack.manifest.files.some((file) => file.path === path);
}

/** One installed content pack: its signed manifest, where it lies, and what it weighs. */
export interface ContentPack {
  readonly id: string;
  readonly version: string;
  /** The installed version folder; every article path is relative to it. */
  readonly dir: string;
  readonly manifest: PackManifest;
  readonly size: number;
  readonly fileCount: number;
  readonly installedAt: number;
}

/** One article as the manifest lists it. */
export interface ContentArticle {
  readonly path: string;
  readonly title: string;
}

/**
 * Every installed content pack, newest version of each id, sorted by id.
 *
 * Two versions of one id can both be on disk (an upgrade keeps the old folder
 * until the new one lands), and only the newest is a book: the older one is what
 * an interrupted upgrade left, and listing both would offer the user two
 * Wikipedias with no way to tell which is which.
 */
export function contentPacks(userData: string, publicKeyPem: string): ContentPack[] {
  const newest = new Map<string, InstalledPack>();
  for (const installed of readInstalled(userData, publicKeyPem)) {
    if (installed.manifest.kind !== "content") continue;
    const current = newest.get(installed.manifest.id);
    if (current === undefined || isNewer(installed, current)) newest.set(installed.manifest.id, installed);
  }
  return [...newest.values()]
    .map((installed) => ({
      id: installed.manifest.id,
      version: installed.manifest.version,
      dir: packVersionDir(userData, installed.manifest.id, installed.manifest.version),
      manifest: installed.manifest,
      size: installed.size,
      fileCount: installed.fileCount,
      installedAt: installed.installedAt,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** One pack by id, or `null` when this device has no such content pack installed. */
export function contentPack(userData: string, publicKeyPem: string, packId: string): ContentPack | null {
  return contentPacks(userData, publicKeyPem).find((pack) => pack.id === packId) ?? null;
}

/** Whether a listed path is an article: the one file kind the Reader renders. */
export function isArticlePath(path: string): boolean {
  return path.toLowerCase().endsWith(READER_ARTICLE_EXTENSION);
}

/**
 * The pack's articles, in manifest order, each with the title its file name
 * suggests.
 *
 * The manifest order is not the reading order - the table of contents sorts, and
 * the index replaces these titles with the articles' own first headings. What
 * this answers is the LIST the index walks, which is why it is spelled out
 * separately from the tree.
 */
export function articleList(pack: ContentPack): ContentArticle[] {
  return pack.manifest.files
    .filter((file) => isArticlePath(file.path))
    .map((file) => ({ path: file.path, title: articleTitleFallback(file.path) }));
}

/**
 * The title a file name suggests, for an article the index has not read yet and
 * for one with no first heading: the last segment, its extension and order prefix
 * removed, separators turned into spaces, first letter upper.
 */
export function articleTitleFallback(path: string): string {
  const file = path.split("/").pop() ?? path;
  return readerDisplayName(file.replace(/\.md$/i, "")).name;
}

/** Whether the manifest lists this exact path - the gate every read of a pack's bytes passes. */
export function isListedPath(pack: ContentPack, path: string): boolean {
  return pack.manifest.files.some((file) => file.path === path);
}

/**
 * One article's bytes, decoded as UTF-8.
 *
 * Throws when the path is not one the manifest lists, when the file is missing
 * (a pack whose bytes were edited by hand), when it is larger than the cap, or
 * when it is not UTF-8 at all. Every one of those is an article the Reader
 * answers "cannot be shown" about - never a partially decoded page.
 */
export function readArticleText(pack: ContentPack, path: string): string {
  if (!isListedPath(pack, path)) {
    throw new Error(`"${path}" is not listed by pack "${pack.id}".`);
  }
  const file = join(pack.dir, ...path.split("/"));
  const size = statSync(file).size;
  if (size > MAX_READER_ARTICLE_BYTES) {
    throw new Error(`"${path}" is over the ${String(MAX_READER_ARTICLE_BYTES)}-byte article cap.`);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
}

function isNewer(candidate: InstalledPack, current: InstalledPack): boolean {
  const order = compareVersions(candidate.manifest.version, current.manifest.version);
  // An unparseable pair answers `null`; then the id ordering decides, so the
  // answer is stable rather than "whichever the directory walk produced first".
  if (order === null) return candidate.manifest.version > current.manifest.version;
  return order > 0;
}
