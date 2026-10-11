/**
 * Which pack holds a translation model, and the `nx-pack://` URLs its three
 * files are read from (ADR-091's scheme, served by main from a signed pack
 * folder — nothing here reaches the network).
 *
 * **The engine ships in the app; the models come in packs.** So this file is the
 * seam between the two: it knows the direction → pack-id table and the three
 * file names every translation pack is built with, and it turns a direction plus
 * the installed packs into the three URLs the worker fetches.
 *
 * **Why the file names are fixed rather than Mozilla's.** Each pack stores
 * exactly three files — `model.bin`, `shortlist.bin`, `vocab.spm` — and its
 * NOTICE and `sources.json` carry Mozilla's own names, sizes and SHA-256 for
 * each, so provenance is complete while the reader of a pack needs no per-pair
 * table. One table in the codebase can then be wrong in one direction instead of
 * two, and this file is the one that has to agree with the pack ids: a pack built
 * under another id is simply not found, which the page says out loud.
 *
 * **A pack is only usable when it is INSTALLED and of kind `model`.** An
 * `nx-pack://` URL for a pack that is not there is a fetch that fails at
 * translation time; the check here is what lets the page offer the direction
 * before anything is loaded, and what keeps a pack of some other kind from ever
 * being read as a model.
 */

/** One translation direction. The id is the two ISO codes, source first. */
export type Direction = "sr-en" | "en-sr" | "hr-en" | "en-hr" | "bs-en" | "en-bs";

/** Every direction this module knows a pack id for, in the order the page offers them. */
export const DIRECTIONS: readonly Direction[] = [
  "sr-en",
  "en-sr",
  "hr-en",
  "en-hr",
  "bs-en",
  "en-bs",
];

/** The three files a translation pack holds, at fixed names. */
export const MODEL_FILES = {
  model: "model.bin",
  shortlist: "shortlist.bin",
  vocab: "vocab.spm",
} as const;

/** The pack id one direction is delivered in. `translate-sr-en` and so on. */
export function packIdOf(direction: Direction): string {
  return `translate-${direction}`;
}

/** The direction a pack id names, or `null` for an id that is not one of ours. */
export function directionOfPackId(packId: string): Direction | null {
  for (const direction of DIRECTIONS) {
    if (packIdOf(direction) === packId) return direction;
  }
  return null;
}

/** The two languages one direction reads and writes. */
export function pairOf(direction: Direction): { readonly from: string; readonly to: string } {
  const from = direction.slice(0, 2);
  const to = direction.slice(3, 5);
  return { from, to };
}

/** A pack id as the manifest's own kebab rule bounds it (ADR-091 §2). */
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A path inside a pack: one or more non-empty segments of plain characters, no
 * leading slash, no dot segments, no backslash, no query or fragment. The three
 * names this module builds are all in that alphabet; the check exists because a
 * URL built here is handed to a privileged protocol handler, and a path is the
 * only part of it that is not a constant.
 */
const PACK_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** The `nx-pack://` URL for one file of one pack, refusing a malformed id or path. */
export function nxPackUrl(packId: string, path: string): string {
  if (!KEBAB_ID.test(packId)) throw new Error(`not a pack id: ${JSON.stringify(packId)}`);
  if (!PACK_PATH.test(path)) throw new Error(`not a pack path: ${JSON.stringify(path)}`);
  return `nx-pack://${packId}/${path}`;
}

/** The three file names as a list, for the membership test in `fetchableModelUrl`. */
const MODEL_FILE_NAMES: readonly string[] = Object.values(MODEL_FILES);

/**
 * The one URL a worker may fetch for one file of one direction's model, or
 * `null` for anything else.
 *
 * **THE WORKER IS WHY THIS REBUILDS THE URL RATHER THAN RETURNING IT.** A
 * translation worker's only input is a message, so a worker that fetched
 * whatever address arrived in one could be pointed at an arbitrary address — a
 * bug in the page, or any script running in the renderer, would be enough
 * (CodeQL's `js/client-side-request-forgery`, which is reported at that fetch).
 * This answers the only question the worker may act on — "is this one of the
 * three files of the direction I was told to load?" — and then returns the
 * address built from THIS module's tables. What the worker fetches is therefore
 * never the string from the message: a message can only ever select among the
 * eighteen addresses the six directions' packs are read from.
 */
export function fetchableModelUrl(url: string, direction: string): string | null {
  const known = DIRECTIONS.find((candidate) => candidate === direction);
  if (known === undefined) return null;
  const packId = packIdOf(known);
  const prefix = `nx-pack://${packId}/`;
  if (!url.startsWith(prefix)) return null;
  const asked = url.slice(prefix.length);
  const file = MODEL_FILE_NAMES.find((name) => name === asked);
  return file === undefined ? null : nxPackUrl(packId, file);
}

/** What the page needs of an installed pack: its id and its kind. `InstalledPackView` satisfies this. */
export interface PackRef {
  readonly id: string;
  readonly kind: string;
}

/** The three URLs of one direction's model, ready for the worker to fetch. */
export interface ModelUrls {
  readonly direction: Direction;
  readonly packId: string;
  readonly model: string;
  readonly shortlist: string;
  readonly vocab: string;
}

/** True when `packId` is installed as a pack of kind `model`. */
function installed(installedPacks: readonly PackRef[], packId: string): boolean {
  return installedPacks.some((pack) => pack.id === packId && pack.kind === "model");
}

/**
 * The three URLs for `direction`, or `null` when its pack is not installed.
 *
 * `null` rather than a thrown error: "this direction cannot be offered yet" is
 * the ordinary state of a fresh install, and the page turns it into a sentence
 * naming the pack to install.
 */
export function resolveModelUrls(
  direction: Direction,
  installedPacks: readonly PackRef[],
): ModelUrls | null {
  const packId = packIdOf(direction);
  if (!installed(installedPacks, packId)) return null;
  return {
    direction,
    packId,
    model: nxPackUrl(packId, MODEL_FILES.model),
    shortlist: nxPackUrl(packId, MODEL_FILES.shortlist),
    vocab: nxPackUrl(packId, MODEL_FILES.vocab),
  };
}

/** The pack id `direction` needs installed, whether or not it is there. */
export function missingPackId(direction: Direction, installedPacks: readonly PackRef[]): string | null {
  const packId = packIdOf(direction);
  return installed(installedPacks, packId) ? null : packId;
}

/** Every direction whose pack is installed, in `DIRECTIONS` order. */
export function availableDirections(installedPacks: readonly PackRef[]): Direction[] {
  return DIRECTIONS.filter((direction) => installed(installedPacks, packIdOf(direction)));
}
