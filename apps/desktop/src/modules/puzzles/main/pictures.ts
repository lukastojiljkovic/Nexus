import { join } from "node:path";
import { NONOGRAM_MAX, NONOGRAM_MIN, isNonogramPictureId } from "@nexus/core";
import { readFileBounded } from "../../../main/boundedRead.js";
import { packPathProblem } from "../../../main/packs/paths.js";
import { packVersionDir, readInstalled } from "../../../main/packs/registry.js";
import type { NonogramPictureView, NonogramPicturesView } from "../shared/ipc.js";

/**
 * The nonogram pictures, read in main from the installed `nonograms-pictures`
 * pack (see `docs/packs/nonograms-pictures.md`).
 *
 * **Why main reads it.** A pack lives outside the profile database and only main
 * may look at the packs directory, so this is the reader: it walks the same
 * installed index the Packs card draws, opens the one file the module understands
 * (`nonograms.json`), and hands the renderer the pictures. The renderer never
 * learns a path, and a picture's `source` is not passed on: the page needs the
 * pixels and the credit, not where the artwork came from.
 *
 * **One file name, one layout, both checked.** `nonograms.json` under any folder,
 * format `1` (the builder's own number). A document claiming another format is
 * refused rather than read on. A pack that is missing or carries no valid picture
 * contributes NOTHING and is not an error, so the answer is `null`.
 *
 * **Each picture is checked alone.** A picture that fails a check is dropped and
 * the rest are kept, as the astronomy reader drops an unknown body: one bad entry
 * in an installed pack must not take the whole game with it.
 */

/** The one pack id this module reads. */
export const NONOGRAM_PICTURES_PACK_ID = "nonograms-pictures";

/** The only `nonograms.json` format this build reads: the builder's own number. */
export const NONOGRAM_PICTURES_FORMAT = 1;

/** The file the pictures are described in, looked for at any depth. */
export const NONOGRAM_PICTURES_FILE_NAME = "nonograms.json";

/**
 * Before it is read. Generous on purpose: the measured file is 145 247 bytes for
 * 230 puzzles, so this is some fourteen times what the pack holds today, and it is
 * still a bound on what an installed file may cost to read.
 */
export const MAX_NONOGRAM_PICTURES_BYTES = 2 * 1024 * 1024;

/** The longest title or author line a picture may carry. */
const MAX_TEXT_LENGTH = 80;

/** The file a pack's pictures are described in: the shallowest one the signed manifest lists. */
export function picturesFile(manifest: {
  readonly files: readonly { readonly path: string }[];
}): string | null {
  const matches = manifest.files
    .map((file) => file.path)
    .filter((path) => path.split("/").at(-1) === NONOGRAM_PICTURES_FILE_NAME)
    .filter((path) => packPathProblem(path) === null);
  matches.sort((left, right) => left.split("/").length - right.split("/").length);
  return matches[0] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Trimmed text of one to `MAX_TEXT_LENGTH` characters, or `null`. */
function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= MAX_TEXT_LENGTH ? text : null;
}

function isRow(value: unknown, size: number): value is string {
  return typeof value === "string" && value.length === size && /^[01]+$/.test(value);
}

/** One picture, or `null` when any of its checks fails. */
function pictureOf(value: unknown): NonogramPictureView | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = record["id"];
  if (!isNonogramPictureId(id)) return null;
  const size = record["size"];
  if (
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < NONOGRAM_MIN ||
    size > NONOGRAM_MAX
  ) {
    return null;
  }
  const rows = record["rows"];
  if (!Array.isArray(rows) || rows.length !== size || !rows.every((row) => isRow(row, size))) {
    return null;
  }
  const title = asRecord(record["title"]);
  const en = asText(title?.["en"]);
  const sr = asText(title?.["sr"]);
  const author = asText(record["author"]);
  if (en === null || sr === null || author === null) return null;
  return { id, size, rows, title: { en, sr }, author };
}

/**
 * A `nonograms.json` document, read whole; `null` for a format this build will
 * not read or for a document with no valid picture in it.
 *
 * A picture id that appears twice keeps its first valid occurrence, so a pack
 * cannot shadow a picture by listing a second one under the same id.
 */
export function parseNonogramPictures(value: unknown): NonogramPicturesView | null {
  const record = asRecord(value);
  if (record === null || record["format"] !== NONOGRAM_PICTURES_FORMAT) return null;
  const list = record["puzzles"];
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const pictures: NonogramPictureView[] = [];
  for (const entry of list) {
    const picture = pictureOf(entry);
    if (picture === null || seen.has(picture.id)) continue;
    seen.add(picture.id);
    pictures.push(picture);
  }
  return pictures.length === 0 ? null : { pictures };
}

/**
 * The installed `nonograms-pictures` pack's pictures, or `null`.
 *
 * `kind: "dataset"` is the first gate, as for the planet textures: asking the
 * index is what makes "installed" mean what the Packs card means by it.
 */
export async function loadNonogramPictures(
  userData: string,
  publicKeyPem: string,
): Promise<NonogramPicturesView | null> {
  const installed = readInstalled(userData, publicKeyPem).find(
    (pack) => pack.manifest.id === NONOGRAM_PICTURES_PACK_ID && pack.manifest.kind === "dataset",
  );
  if (installed === undefined) return null;
  const path = picturesFile(installed.manifest);
  if (path === null) return null;
  const dir = packVersionDir(userData, installed.manifest.id, installed.manifest.version);
  const read = await readFileBounded(join(dir, ...path.split("/")), MAX_NONOGRAM_PICTURES_BYTES);
  if (read.status !== "ok") return null;
  try {
    return parseNonogramPictures(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes)) as unknown,
    );
  } catch {
    return null;
  }
}
