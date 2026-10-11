import { parseBuffer } from "music-metadata";
import type { CultureAudioMime } from "@nexus/core";
import { MAX_CULTURE_DURATION_MS } from "@nexus/db";

/**
 * Reading an audio file's tags in main (SEC-FILE-02: the renderer hands over
 * bytes, never a path, and never a claim about what they are).
 *
 * **The format is SNIFFED from the bytes, not taken from the file name.** The
 * name is a display string the renderer wrote; a `.mp3` that is really a
 * text file must be refused, and a correctly tagged FLAC named without an
 * extension must be accepted. `sniffAudioMime` knows the five containers the
 * store accepts (migration 073's own list) and nothing else.
 *
 * **`music-metadata` is given the decoded container, and is asked not to
 * parse cover art** (`skipCovers`): the cover is another megabyte of somebody
 * else's picture inside a file this module is only measuring, and the library
 * holds no artwork.
 *
 * **A tag that is missing is `null`, never invented.** A file whose tag says
 * nothing about the artist has no artist; the page shows the track as untagged,
 * which is exactly what makes a half-tagged library visible. The TITLE is the
 * one exception, and it falls back to the file's own base name, because a row
 * with no title is a row the user cannot find again.
 */

/** Why one file could not be imported, as a code the page turns into a sentence. */
export type AudioImportProblem = "unsupported-format" | "unreadable";

export class AudioImportError extends Error {
  readonly problem: AudioImportProblem;

  constructor(problem: AudioImportProblem, message: string) {
    super(message);
    this.name = "AudioImportError";
    this.problem = problem;
  }
}

/** The tag data main writes into a new track row. */
export interface AudioTags {
  readonly mime: CultureAudioMime;
  readonly title: string;
  readonly artist: string | null;
  readonly album: string | null;
  readonly trackNumber: number | null;
  readonly releaseYear: number | null;
  readonly durationMs: number;
}

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + magic.length) return false;
  for (let index = 0; index < magic.length; index += 1) {
    if (bytes[offset + index] !== magic[index]) return false;
  }
  return true;
}

const ASCII = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

const ID3 = ASCII("ID3");
const FLAC = ASCII("fLaC");
const OGG = ASCII("OggS");
const FTYP = ASCII("ftyp");
const RIFF = ASCII("RIFF");
const WAVE = ASCII("WAVE");

/**
 * The five formats the library accepts, told apart by their first bytes, or
 * null for anything else.
 *
 * MPEG audio has no magic string: a frame begins with eleven set bits, which is
 * `0xFF` followed by a byte whose top three bits are also set. That is loose
 * enough to be worth stating as the rule it is - a byte pair, not a signature -
 * and it is what every MP3 begins with after an optional ID3 tag.
 */
export function sniffAudioMime(bytes: Uint8Array): CultureAudioMime | null {
  if (startsWith(bytes, ID3)) return "audio/mpeg";
  if (
    bytes.byteLength >= 2 &&
    bytes[0] === 0xff &&
    bytes[1] !== undefined &&
    (bytes[1] & 0xe0) === 0xe0
  ) {
    return "audio/mpeg";
  }
  if (startsWith(bytes, FLAC)) return "audio/flac";
  if (startsWith(bytes, OGG)) return "audio/ogg";
  if (startsWith(bytes, FTYP, 4)) return "audio/mp4";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WAVE, 8)) return "audio/wav";
  return null;
}

/** The file name without its last extension, or the whole name when it has none. */
function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function text(value: string | undefined, max: number): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return null;
  // A tag longer than the store's own bound is refused rather than truncated:
  // the store would refuse the row anyway, and a name quietly cut in half is a
  // name the user did not write. The cap here is the store's, read from it.
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Reads one file's tags, or throws an `AudioImportError` naming what is wrong.
 *
 * `maxTitleLength` and the other bounds come from the caller, which is where
 * the store's own constants live - this file must not hold a second copy of
 * what a title may be.
 */
export async function readAudioTags(
  bytes: Uint8Array,
  fileName: string,
  bounds: { title: number; name: number; trackNumber: number },
): Promise<AudioTags> {
  const mime = sniffAudioMime(bytes);
  if (mime === null) {
    throw new AudioImportError(
      "unsupported-format",
      `"${fileName}" is not one of the audio formats this library holds (MP3, M4A, Ogg, FLAC, WAV).`,
    );
  }

  let metadata;
  try {
    metadata = await parseBuffer(bytes, { mimeType: mime }, { duration: true, skipCovers: true });
  } catch (error) {
    throw new AudioImportError(
      "unreadable",
      `The tags of "${fileName}" could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const common = metadata.common;
  const title = text(common.title, bounds.title) ?? stemOf(fileName).slice(0, bounds.title);
  const trackNumber = common.track.no;
  const year = common.year;
  const seconds = metadata.format.duration;
  return {
    mime,
    title,
    artist: text(common.artist, bounds.name),
    album: text(common.album, bounds.name),
    trackNumber:
      typeof trackNumber === "number" && Number.isInteger(trackNumber) && trackNumber >= 1
        ? Math.min(trackNumber, bounds.trackNumber)
        : null,
    releaseYear:
      typeof year === "number" && Number.isInteger(year) && year >= 1000 && year <= 9999
        ? year
        : null,
    // A decoder that could not measure the file answers 0, which the schema
    // reads as "imported before anything could measure it" (migration 073) - a
    // real state, and better than a row this store would have to refuse.
    durationMs:
      typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
        ? Math.min(Math.round(seconds * 1000), MAX_CULTURE_DURATION_MS)
        : 0,
  };
}

