/**
 * HUGGING FACE, READ-ONLY, IN ONE MODE, THROUGH ONE DOOR.
 *
 * The advanced search the brief asks for is "any Hugging Face GGUF, verified
 * against Hugging Face's SHA-256". This module is the reading half of that: it
 * asks the Hub which repositories match, lists one repository's `.gguf` files,
 * and answers `ModelEntry` items — the same shape the curated catalogue uses, so
 * the download path, the chooser and the UI never need to know which of the two
 * a model came from.
 *
 * THREE RULES, AND EACH IS ENFORCED RATHER THAN DESCRIBED:
 *
 *   1. **Only in the `downloads` network mode.** The mode arrives as a function
 *      and is consulted before the FIRST request, so a caller that somehow
 *      reached this module in "Offline only" gets a refusal and no packet. The
 *      session's own rule (`isSessionRequestAllowed`) is the second gate, and
 *      every URL is checked against it before it is requested — including the
 *      ones this module builds itself.
 *   2. **Every hash comes from the Hub's listing.** A file whose LFS `oid` is
 *      absent or masked (gated repositories answer with asterisks) is NOT listed:
 *      an entry whose hash nobody can read would be a download this app cannot
 *      verify, which is the one thing the download service refuses outright.
 *   3. **A split model is recognised and NOT offered.** `-00001-of-0000N` parts
 *      are one model in N files, and the contract's `ModelEntry` describes ONE
 *      file with one hash and one size — so the runtime cannot download a split
 *      model at all, and listing four parts as four models would offer a user
 *      three downloads that cannot be loaded on their own. The parts are grouped
 *      (`parseSplitPart`), the group is omitted, and the catalogue has no split
 *      entry either: every model this app offers is one file.
 */

import type { ModelEntry, ModelLicence } from "@nexus/core";
import { modeAllowsDownloads, type NetworkMode } from "../../net/offline.js";
import { RuntimeError } from "./errors.js";
import { parseQuantization, parseSplitPart } from "./quantization.js";

/** The Hub's host, and the only one this file ever names. */
export const HUGGINGFACE_HOST = "huggingface.co";

/** How many repositories a search looks at. Each one costs two more requests. */
export const SEARCH_REPOSITORIES = 6;

/** How many `.gguf` files one repository may contribute. */
export const REPOSITORY_FILES = 6;

/** The Hub's model-list endpoint, for the search itself. */
export function searchUrl(query: string): string {
  return `https://${HUGGINGFACE_HOST}/api/models?search=${encodeURIComponent(query)}&filter=gguf&limit=${String(SEARCH_REPOSITORIES)}&sort=downloads&direction=-1`;
}

/** One repository's file listing, which is where sizes and SHA-256s come from. */
export function treeUrl(repo: string): string {
  return `https://${HUGGINGFACE_HOST}/api/models/${repo}/tree/main?recursive=true`;
}

/** One repository's card, which is where the licence and the declared languages come from. */
export function modelUrl(repo: string): string {
  return `https://${HUGGINGFACE_HOST}/api/models/${repo}`;
}

/** Where a file inside a repository actually downloads from. */
export function resolveUrl(repo: string, file: string): string {
  return `https://${HUGGINGFACE_HOST}/${repo}/resolve/main/${encodeURIComponent(file)}`;
}

/** The page a user reads a model's card, licence and README on. */
export function pageUrl(repo: string): string {
  return `https://${HUGGINGFACE_HOST}/${repo}`;
}

export interface HuggingFaceDeps {
  /** The mode this launch may act on. Checked before every request. */
  readonly mode: () => NetworkMode;
  /** `isSessionRequestAllowed(<mode>, url)` in main: https only, exact hosts. */
  readonly isAllowedUrl: (url: string) => boolean;
  /** An authenticated-free JSON GET through the dedicated session. Bounded by its own timeout. */
  readonly httpJson: (url: string, signal: AbortSignal) => Promise<unknown>;
}

/**
 * The repositories a search found, in the Hub's own order, or a refusal.
 */
export function repositoriesFromSearch(reply: unknown): readonly string[] {
  if (!Array.isArray(reply)) throw new RuntimeError("network", "The search reply is not a list of models.");
  const repositories: string[] = [];
  for (const value of reply) {
    if (typeof value !== "object" || value === null) continue;
    const id = (value as { id?: unknown }).id;
    // `owner/name` and nothing else: this string is joined into URLs below, so a
    // value carrying a slash, a dot-segment or a scheme is refused rather than
    // escaped into one.
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) continue;
    if (!repositories.includes(id)) repositories.push(id);
  }
  return repositories.slice(0, SEARCH_REPOSITORIES);
}

/**
 * One repository's `.gguf` files as catalogue-shaped entries.
 *
 * `card` is the same repository's metadata reply, and it is the only source for
 * the licence and the declared languages. `contextTokens` is 0 — "not known" —
 * because a listing does not carry it; the file's own header does, and the
 * runtime reads it there when the model is loaded.
 */
export function entriesFromTree(repo: string, tree: unknown, card: unknown): readonly ModelEntry[] {
  if (!Array.isArray(tree)) throw new RuntimeError("network", `The file listing of ${repo} is not a list.`);
  const licence = licenceFromCard(repo, card);
  const languages = languagesFromCard(card);

  const groups = new Map<string, { files: string[]; split: boolean }>();
  for (const value of tree) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as { type?: unknown; path?: unknown };
    // Subdirectories are listed too; a `.gguf` inside one is still a file.
    if (record.type !== "file" || typeof record.path !== "string") continue;
    if (!/\.gguf$/i.test(record.path)) continue;
    if (record.path.startsWith("mmproj-") || /mmproj/i.test(record.path)) continue;
    const split = parseSplitPart(record.path);
    const key = split === null ? record.path : split.stem;
    const group = groups.get(key) ?? { files: [], split: false };
    group.files.push(record.path);
    if (split !== null) group.split = true;
    groups.set(key, group);
  }

  const entries: ModelEntry[] = [];
  for (const group of groups.values()) {
    if (group.split || group.files.length !== 1) continue;
    const file = group.files[0] as string;
    const measured = measuredFile(tree, file);
    if (measured === null) continue;
    entries.push({
      id: entryIdFor(repo, file),
      origin: "huggingface",
      title: file.replace(/\.gguf$/i, ""),
      family: repo,
      repo,
      file,
      sha256: measured.sha256,
      sizeBytes: measured.sizeBytes,
      quantization: parseQuantization(file) ?? "",
      contextTokens: 0,
      // A listing cannot prove a model can call tools: the template decides, and
      // the runtime reads that when the model is loaded. `chat` is what every
      // `.gguf` in a text-generation repository is.
      capabilities: ["chat"],
      languages,
      licence,
    });
  }
  return entries.slice(0, REPOSITORY_FILES);
}

/**
 * The search itself: repositories, then each one's listing and card.
 *
 * A repository that answers with no usable file (a gated one, a repository of
 * `.safetensors`, one whose oids are masked) contributes nothing rather than
 * failing the whole search: a user searching for a model they can see on the Hub
 * should get the ones that ARE downloadable plus an empty result for the rest,
 * not a refusal because one of six repositories is gated.
 */
export async function searchHuggingFace(
  deps: HuggingFaceDeps,
  query: string,
  signal: AbortSignal,
): Promise<readonly ModelEntry[]> {
  if (!modeAllowsDownloads(deps.mode())) {
    throw new RuntimeError("mode", "Searching Hugging Face is allowed only in the downloads network mode.");
  }
  const trimmed = query.trim();
  if (trimmed === "") return [];

  const reply = await get(deps, searchUrl(trimmed), signal);
  const repositories = repositoriesFromSearch(reply);
  const entries: ModelEntry[] = [];
  for (const repo of repositories) {
    if (signal.aborted) throw new RuntimeError("aborted", "The search was aborted.");
    try {
      const tree = await get(deps, treeUrl(repo), signal);
      const card = await get(deps, modelUrl(repo), signal);
      entries.push(...entriesFromTree(repo, tree, card));
    } catch (error) {
      if (error instanceof RuntimeError && error.code === "aborted") throw error;
      // One repository this build could not read is not the search failing.
    }
  }
  return entries;
}

async function get(deps: HuggingFaceDeps, url: string, signal: AbortSignal): Promise<unknown> {
  if (!deps.isAllowedUrl(url)) {
    throw new RuntimeError("network", `The address ${url} is not one this launch may reach.`);
  }
  if (signal.aborted) throw new RuntimeError("aborted", "The search was aborted.");
  try {
    return await deps.httpJson(url, signal);
  } catch (error) {
    if (signal.aborted) throw new RuntimeError("aborted", "The search was aborted.");
    throw new RuntimeError("network", `The Hub could not be reached: ${String(error)}`);
  }
}

/** One file's published digest and size, or `null` when the listing does not publish them. */
function measuredFile(tree: readonly unknown[], file: string): { sha256: string; sizeBytes: number } | null {
  for (const value of tree) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as { path?: unknown; size?: unknown; lfs?: { oid?: unknown; size?: unknown } };
    if (record.path !== file) continue;
    const sha256 = record.lfs?.oid;
    const sizeBytes = record.lfs?.size ?? record.size;
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
    if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return null;
    return { sha256, sizeBytes };
  }
  return null;
}

/**
 * The licence the card declares.
 *
 * `cardData.license` is a licence id (`apache-2.0`, `gemma`, `cc-by-nc-sa-4.0`)
 * or a list of them, and `license_link` — when the author wrote one — is the page
 * a user can read. Without a link, the model's own page is that page: it is where
 * the card, and the licence it names, are.
 */
function licenceFromCard(repo: string, card: unknown): ModelLicence {
  const cardData = (card as { cardData?: Record<string, unknown> } | null)?.cardData;
  const declared = cardData?.["license"];
  const name =
    typeof declared === "string"
      ? declared
      : Array.isArray(declared)
        ? declared.filter((value): value is string => typeof value === "string").join(", ")
        : "";
  const link = cardData?.["license_link"];
  return { name, url: typeof link === "string" && link !== "" ? link : pageUrl(repo) };
}

/** The language codes the card declares, verbatim and validated as codes. */
function languagesFromCard(card: unknown): readonly string[] {
  const declared = (card as { cardData?: { language?: unknown } } | null)?.cardData?.language;
  const list = Array.isArray(declared) ? declared : declared === undefined ? [] : [declared];
  const codes = new Set<string>();
  for (const value of list) {
    if (typeof value !== "string") continue;
    const code = value.trim().toLowerCase();
    if (/^[a-z]{2,3}$/.test(code)) codes.add(code);
  }
  return [...codes].sort();
}

/**
 * A stable id for a search result: the repository and the file, lower-cased.
 *
 * Bounded to `MAX_ID_LENGTH` and restricted to the characters `catalogue.ts`
 * accepts, so an id from the Hub is the same SHAPE as one from the curated list:
 * both become a registry key, and a registry key is a name this app writes into
 * a JSON file.
 */
export function entryIdFor(repo: string, file: string): string {
  const stem = `${repo}-${file.replace(/\.gguf$/i, "")}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return stem === "" ? "model" : stem;
}
