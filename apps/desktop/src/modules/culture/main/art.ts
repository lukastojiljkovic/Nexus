import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PackManifest } from "../../../main/packs/manifest.js";
import { isSafePackPath } from "../../../main/packs/paths.js";
import { packsRoot, readInstalled } from "../../../main/packs/registry.js";

/**
 * The arts guide's data: `art.json` inside an installed `dataset` pack
 * (ADR-091), read here and nowhere else.
 *
 * **Why the pack, and not the database.** The works are public, large and
 * nobody's private data - exactly what ADR-091 §5 says a pack is for. Nothing
 * about them is per-profile, so nothing about them is a table: the guide reads
 * a signed folder and draws it.
 *
 * **Why the reader is TOTAL about a bad pack.** One installed dataset whose
 * `art.json` is missing or malformed must not hide the ten other packs a
 * profile has, so a refusal puts that pack's id in `skipped` and the guide says
 * so in one muted line. What it does NOT do is half-read: a pack contributes
 * either every work it describes or none.
 *
 * **Why every work's image is checked against the manifest.** The pack's
 * manifest is the list of files that were hashed while the folder was copied,
 * so a path it does not carry is a path nothing verified - and the read
 * protocol that serves the bytes refuses it too (`artFile.ts`). Checking here
 * as well means a work with a broken image is a pack the guide REPORTS rather
 * than a gallery full of broken pictures.
 *
 * Layout 1, as the brief fixes it:
 *
 * ```json
 * { "layout": 1, "works": [
 *   { "id", "title", "artist", "date", "medium"?, "museum",
 *     "credit", "licence", "image": "images/<file>", "width", "height" } ] }
 * ```
 */

/** The only layout this build reads. A different number is refused by name, never best-effort parsed. */
export const ART_LAYOUT_VERSION = 1;

/** The one file name a dataset pack is asked for. */
export const ART_DATASET_FILE = "art.json";

/**
 * The largest `art.json` this build reads (32 MiB).
 *
 * A bound on untrusted input rather than a limit anybody meets: the file is a
 * JSON array of catalogue entries, and a hundred thousand of them is a few
 * megabytes. The cap exists so a corrupt or hostile pack cannot make main read
 * an unbounded file into memory while a profile is open.
 */
export const MAX_ART_DATASET_BYTES = 33_554_432;

/** The most works one pack may contribute - the same kind of bound, past any catalogue this guide is for. */
export const MAX_ART_WORKS = 20_000;

/** The image types the guide serves. Anything else in `image` is refused, so the gallery can only ever draw a picture. */
const ART_IMAGE_MIMES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** One work, with the two facts the image URL is built from. */
export interface ArtWork {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly date: string;
  readonly medium: string | null;
  readonly museum: string;
  readonly credit: string;
  readonly licence: string;
  readonly packId: string;
  readonly version: string;
  /** A path INSIDE the pack, e.g. `images/portrait.jpg`. Never a filesystem path. */
  readonly image: string;
  readonly width: number;
  readonly height: number;
}

/** One pack the guide is reading, with the attribution its licence asks to be shown. */
export interface ArtPack {
  readonly id: string;
  readonly version: string;
  readonly title: { readonly sr: string; readonly en: string };
  readonly licence: { readonly spdx: string; readonly attribution: string; readonly url: string };
}

export interface ArtReading {
  readonly works: readonly ArtWork[];
  readonly packs: readonly ArtPack[];
  /** Dataset pack ids whose `art.json` could not be read, whole. */
  readonly skipped: readonly string[];
}

class ArtRefusal extends Error {}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArtRefusal(`"${where}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asText(value: unknown, where: string, max: number): string {
  if (typeof value !== "string") throw new ArtRefusal(`"${where}" must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new ArtRefusal(`"${where}" must be 1-${max} characters.`);
  }
  return trimmed;
}

function asOptionalText(value: unknown, where: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  return asText(value, where, max);
}

function asSize(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100_000) {
    throw new ArtRefusal(`"${where}" must be a whole number of pixels between 1 and 100000.`);
  }
  return value;
}

/** The mime an image path's extension earns, or null when the extension is not one the guide serves. */
export function artImageMime(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return ART_IMAGE_MIMES[path.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Reads one pack's `art.json` value, completely, before anything is drawn from
 * it. Pure and total: it either answers with every work or it throws naming the
 * field that is wrong, and `carriedFiles` is what refuses an image the pack's
 * own manifest does not list.
 */
export function parseArtDataset(
  value: unknown,
  pack: { id: string; version: string; carriedFiles: ReadonlySet<string> },
): ArtWork[] {
  const record = asRecord(value, "layout");
  if (record["layout"] !== ART_LAYOUT_VERSION) {
    throw new ArtRefusal(
      `art.json is layout ${String(record["layout"])}; this build reads layout ${ART_LAYOUT_VERSION}.`,
    );
  }
  const rawWorks = record["works"];
  if (!Array.isArray(rawWorks)) throw new ArtRefusal('"works" must be an array.');
  if (rawWorks.length > MAX_ART_WORKS) {
    throw new ArtRefusal(`art.json carries more than ${MAX_ART_WORKS} works.`);
  }

  const works: ArtWork[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of rawWorks.entries()) {
    const where = `works[${index}]`;
    const work = asRecord(entry, where);
    const id = asText(work["id"], `${where}.id`, 200);
    if (seen.has(id)) throw new ArtRefusal(`Two works carry the id "${id}".`);
    seen.add(id);
    const image = asText(work["image"], `${where}.image`, 240);
    if (!isSafePackPath(image)) {
      throw new ArtRefusal(`"${where}.image" is not a path inside the pack.`);
    }
    if (artImageMime(image) === null) {
      throw new ArtRefusal(`"${where}.image" is not one of the image types this guide draws.`);
    }
    if (!pack.carriedFiles.has(image)) {
      throw new ArtRefusal(`"${where}.image" names the file "${image}", which the pack does not carry.`);
    }
    works.push({
      id,
      title: asText(work["title"], `${where}.title`, 300),
      artist: asText(work["artist"], `${where}.artist`, 300),
      date: asText(work["date"], `${where}.date`, 100),
      medium: asOptionalText(work["medium"], `${where}.medium`, 200),
      museum: asText(work["museum"], `${where}.museum`, 300),
      credit: asText(work["credit"], `${where}.credit`, 500),
      licence: asText(work["licence"], `${where}.licence`, 200),
      packId: pack.id,
      version: pack.version,
      image,
      width: asSize(work["width"], `${where}.width`),
      height: asSize(work["height"], `${where}.height`),
    });
  }
  return works;
}

/** The file paths one installed pack's verified manifest lists. */
function carriedFiles(manifest: PackManifest): Set<string> {
  return new Set(manifest.files.map((file) => file.path));
}

/**
 * Every readable dataset pack, in id order.
 *
 * `publicKeyPem` is passed in rather than imported so a test can install a pack
 * signed with its own key: the release key's private half is what signs, and it
 * is not on this machine.
 */
export function readArtDatasets(userData: string, publicKeyPem: string): ArtReading {
  const works: ArtWork[] = [];
  const packs: ArtPack[] = [];
  const skipped: string[] = [];

  for (const installed of readInstalled(userData, publicKeyPem)) {
    const manifest = installed.manifest;
    if (manifest.kind !== "dataset") continue;
    try {
      const declared = manifest.files.find((file) => file.path === ART_DATASET_FILE);
      if (declared === undefined) throw new ArtRefusal(`the pack carries no ${ART_DATASET_FILE}.`);
      if (declared.size > MAX_ART_DATASET_BYTES) throw new ArtRefusal(`${ART_DATASET_FILE} is too large.`);
      const path = join(packsRoot(userData), manifest.id, manifest.version, ART_DATASET_FILE);
      // A `stat` before the read, so a file that grew since it was installed
      // is refused rather than pulled into memory: the manifest's size is the
      // one the copy verified, and this is the read that trusts it.
      if (statSync(path).size > MAX_ART_DATASET_BYTES) {
        throw new ArtRefusal(`${ART_DATASET_FILE} is larger than the manifest declares.`);
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
      const read = parseArtDataset(JSON.parse(text), {
        id: manifest.id,
        version: manifest.version,
        carriedFiles: carriedFiles(manifest),
      });
      works.push(...read);
      packs.push({
        id: manifest.id,
        version: manifest.version,
        title: manifest.title,
        licence: manifest.licence,
      });
    } catch {
      // Every failure - an unreadable file, bytes that are not UTF-8, JSON that
      // does not parse, a field that breaks its rule - is the same answer for
      // the same reason: this pack contributes nothing, and the guide says so.
      // Nothing has been pushed for this pack, so there is nothing to undo.
      skipped.push(manifest.id);
    }
  }

  // Deliberately NOT sorted here: an artist is a name a person reads, and the
  // order a person reads names in is the ACTIVE locale's (the renderer's
  // `Intl.Collator`), which main cannot know. What this does fix is the order
  // between packs - id, then the catalogue's own order inside `art.json` -
  // so two reads of the same machine answer the same sequence.
  return { works, packs, skipped };
}
