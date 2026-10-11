import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { compareVersions } from "../../../main/update/version.js";
import { matchDictionaryKeys } from "@nexus/core";

/**
 * Reading the `dictionary-sr-en` content pack from disk (ADR-091).
 *
 * **What a pack is here, and why none of it is loaded whole.** The pack is a
 * folder under `<userData>/packs/dictionary-sr-en/<version>/` whose index is
 * four small files per direction, written by `scripts/packs/dictionary/`:
 *
 *   `keys.txt`      one folded key per line, sorted by byte order
 *   `group.bin`     uint32 per key (plus a sentinel): the index of its first entry
 *   `lines.bin`     uint32 per entry: the byte offset of its line in `entries.jsonl`
 *   `entries.jsonl` one JSON record per line, in key order
 *
 * `keys.txt` and the two offset tables are small enough to hold (a few hundred
 * kilobytes together), and they are the whole of what a lookup reads: the key
 * list is binary-searched (`@nexus/core`'s `matchDictionaryKeys`, the pure half
 * of this), and then exactly the lines a hit names are read out of the JSONL by
 * one `readSync` per entry. Twenty-five megabytes of dictionary are therefore
 * never walked to answer one word.
 *
 * **What this file does not do.** It does not verify the pack's signature — a
 * pack is verified once, when it is installed (`main/packs/`), and re-verifying
 * 25 megabytes on every lookup would be a hash of nothing anybody asked for. It
 * does not know what a profile is, and it writes nothing.
 *
 * **A damaged pack is an exception, not an empty answer.** A record that does
 * not parse, a key file whose line count disagrees with its offset table, a
 * folder with no `about.json`: each throws, and the page says the dictionary
 * could not be read. Answering "no such word" for a file that is truncated
 * would be the app inventing the absence of 60 000 words.
 */

/** The pack this module reads. Spelled once, beside the `id` the builder writes into `about.json`. */
export const PACK_ID = "dictionary-sr-en";

/** The content format this build reads. Another number is refused rather than best-effort parsed. */
export const CONTENT_FORMAT = 1;

/** The pack's own statement about itself, as `about.json` carries it. */
export interface PackAbout {
  readonly format: number;
  readonly id: string;
  readonly builtAt: string;
  readonly licence: string;
  readonly bytes: number;
  readonly attribution: string;
  readonly counts: {
    readonly enKeys: number;
    readonly enEntries: number;
    readonly srKeys: number;
    readonly srEntries: number;
    readonly phrases: number;
    readonly topics: number;
  };
}

/** One installed version of the pack: its folder and what it says it is. */
export interface InstalledDictionaryPack {
  readonly dir: string;
  readonly version: string;
  readonly about: PackAbout;
}

/** One direction's index, with the file the entries live in open for reading. */
export interface PackIndex {
  readonly keys: readonly string[];
  /** `group[i] … group[i + 1]` are the entry indices of key `i`. */
  readonly group: Uint32Array;
  /** The byte offset of entry `i`'s line in `entries.jsonl`. */
  readonly lines: Uint32Array;
  readonly fd: number;
  readonly entriesBytes: number;
}

/** One open pack: what it is, and both directions' indexes. */
export interface OpenDictionaryPack extends InstalledDictionaryPack {
  readonly en: PackIndex;
  readonly sr: PackIndex;
}

/**
 * The newest installed version of a pack, or `null` when none is installed.
 *
 * Every version folder is read and checked rather than only the newest: a
 * folder whose `about.json` is missing or is another format is not a pack this
 * build reads, and stepping over it to an older one is the honest answer — the
 * alternative is a module that breaks because somebody left a half-copied
 * folder behind.
 */
export function findInstalledPack(packsRoot: string, id: string = PACK_ID): InstalledDictionaryPack | null {
  const idDir = join(packsRoot, id);
  let versions: string[];
  try {
    versions = readdirSync(idDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== ".staging");
  } catch {
    return null;
  }
  const installed: InstalledDictionaryPack[] = [];
  for (const version of versions) {
    const dir = join(idDir, version);
    const about = readAbout(dir);
    if (about !== null && hasIndex(dir)) installed.push({ dir, version, about });
  }
  if (installed.length === 0) return null;
  // The app's own version parser decides which folder is newer, never a string
  // comparison: `2026.9.0` sorts below `2026.10.0` as text and above it as a
  // version. A folder whose name the parser cannot read never displaces one it
  // can, which is the fail-open direction that costs nothing.
  return installed.reduce((best, candidate) => {
    const order = compareVersions(candidate.version, best.version);
    return order !== null && order > 0 ? candidate : best;
  });
}

/** `about.json`, or `null` when the folder is not a pack this build reads. */
export function readAbout(dir: string): PackAbout | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, "about.json"), "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record["format"] !== CONTENT_FORMAT) return null;
  if (record["id"] !== PACK_ID) return null;
  if (typeof record["attribution"] !== "string" || typeof record["licence"] !== "string") return null;
  const counts = record["counts"];
  if (typeof counts !== "object" || counts === null) return null;
  const numbers = counts as Record<string, unknown>;
  for (const field of ["enKeys", "enEntries", "srKeys", "srEntries", "phrases", "topics"]) {
    if (typeof numbers[field] !== "number") return null;
  }
  return {
    format: CONTENT_FORMAT,
    id: PACK_ID,
    builtAt: typeof record["builtAt"] === "string" ? record["builtAt"] : "",
    licence: record["licence"],
    bytes: typeof record["bytes"] === "number" ? record["bytes"] : 0,
    attribution: record["attribution"],
    counts: {
      enKeys: numbers["enKeys"] as number,
      enEntries: numbers["enEntries"] as number,
      srKeys: numbers["srKeys"] as number,
      srEntries: numbers["srEntries"] as number,
      phrases: numbers["phrases"] as number,
      topics: numbers["topics"] as number,
    },
  };
}

/** Whether both directions' files are present — a pack half-copied is not a pack. */
function hasIndex(dir: string): boolean {
  for (const side of ["en", "sr"]) {
    for (const name of ["keys.txt", "group.bin", "lines.bin", "entries.jsonl"]) {
      try {
        statSync(join(dir, "index", side, name));
      } catch {
        return false;
      }
    }
  }
  return true;
}

/** A `uint32` file as an array, copied out of the buffer so no alignment rule can bite. */
function uint32File(path: string): Uint32Array {
  const bytes = readFileSync(path);
  if (bytes.byteLength % 4 !== 0) {
    throw new Error(`The dictionary pack's "${path}" is not a whole number of uint32 values.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Uint32Array(bytes.byteLength / 4);
  for (let index = 0; index < values.length; index += 1) values[index] = view.getUint32(index * 4, true);
  return values;
}

/** One direction's index, read and held open. */
export function openIndex(dir: string, side: "en" | "sr"): PackIndex {
  const root = join(dir, "index", side);
  const keysText = readFileSync(join(root, "keys.txt"), "utf8");
  const keys = keysText.split("\n");
  // The file ends with a newline, which is a terminator rather than an empty key.
  if (keys.length > 0 && keys[keys.length - 1] === "") keys.pop();
  const group = uint32File(join(root, "group.bin"));
  const lines = uint32File(join(root, "lines.bin"));
  if (group.length !== keys.length + 1) {
    throw new Error(
      `The dictionary pack's "${side}" index disagrees with itself: ${String(keys.length)} keys and ${String(group.length)} groups.`,
    );
  }
  const entriesPath = join(root, "entries.jsonl");
  return {
    keys,
    group,
    lines,
    fd: openSync(entriesPath, "r"),
    entriesBytes: statSync(entriesPath).size,
  };
}

/** Opens an installed pack: both directions' indexes and the file handles they need. */
export function openPack(pack: InstalledDictionaryPack): OpenDictionaryPack {
  return { ...pack, en: openIndex(pack.dir, "en"), sr: openIndex(pack.dir, "sr") };
}

/** Closes the two files an open pack holds. Safe to call twice. */
export function closePack(pack: OpenDictionaryPack): void {
  for (const index of [pack.en, pack.sr]) {
    try {
      closeSync(index.fd);
    } catch {
      // Already closed is not a failure: the caller is releasing a resource,
      // not asserting that it still holds one.
    }
  }
}

/** One record as the pack's writer wrote it — the shape `convert.mjs` produces. */
export interface PackRecord {
  word: string;
  pos?: string;
  glosses: string[];
  translations?: string[];
  url: string;
}

/** Reads and checks one entry line. `index` is the entry's position, for the message a damaged pack produces. */
function readRecord(index: PackIndex, position: number, side: string): PackRecord {
  const start = index.lines[position];
  const end = index.lines[position + 1] ?? index.entriesBytes;
  if (start === undefined || start >= end) {
    throw new Error(`The dictionary pack's "${side}" entry ${String(position)} has no bytes to read.`);
  }
  const buffer = Buffer.alloc(end - start);
  const read = readSync(index.fd, buffer, 0, buffer.byteLength, start);
  if (read !== buffer.byteLength) {
    throw new Error(`The dictionary pack's "${side}" entry ${String(position)} is truncated.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error(`The dictionary pack's "${side}" entry ${String(position)} is not readable JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`The dictionary pack's "${side}" entry ${String(position)} is not a record.`);
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record["word"] !== "string" || record["word"] === "") {
    throw new Error(`The dictionary pack's "${side}" entry ${String(position)} has no headword.`);
  }
  if (!Array.isArray(record["glosses"]) || record["glosses"].some((gloss) => typeof gloss !== "string")) {
    throw new Error(`The dictionary pack's "${side}" entry ${String(position)} has no meanings.`);
  }
  if (typeof record["url"] !== "string") {
    throw new Error(`The dictionary pack's "${side}" entry ${String(position)} has no source address.`);
  }
  const translations = Array.isArray(record["translations"])
    ? record["translations"].filter((word): word is string => typeof word === "string")
    : [];
  return {
    word: record["word"],
    pos: typeof record["pos"] === "string" ? record["pos"] : "",
    glosses: record["glosses"] as string[],
    translations,
    url: record["url"],
  };
}

/** Everything one direction reads. */
export interface PackSearch {
  readonly entries: readonly PackRecord[];
  /** How many of `entries` are the exact key's — the first `exactCount` of them, because the order puts them first. */
  readonly exactCount: number;
  readonly truncated: boolean;
  readonly key: string;
}

/**
 * One lookup in one direction: the exact key's entries first, then the prefix
 * keys', with the PREFIX hits capped at `limit` and the exact key's never
 * counted against that cap.
 *
 * **The cap is on entries, not on keys.** A caller that asked for twenty results
 * wants twenty rows, and one matching key can hold several entries (`free` as an
 * adjective and as a verb); capping keys would hand it twenty-four rows for one
 * query and two for the next. The exact key's own entries are always returned
 * whole — a key holds at most twelve by the writer's own cap, and dropping the
 * word the reader actually typed to obey a limit would be a search that does not
 * answer its query.
 *
 * The ORDER is `matchDictionaryKeys`'s and stated there; this function is the
 * part that turns entry indices into records, and it never reads a line the
 * match did not name.
 */
export function searchPack(pack: OpenDictionaryPack, direction: "en-sr" | "sr-en", query: string, limit: number): PackSearch {
  const index = direction === "en-sr" ? pack.en : pack.sr;
  const side = direction === "en-sr" ? "en" : "sr";
  const match = matchDictionaryKeys(index.keys, query, limit);
  const positions: number[] = [];
  let exactCount = 0;
  if (match.exact !== -1) {
    for (let at = index.group[match.exact] ?? 0; at < (index.group[match.exact + 1] ?? 0); at += 1) {
      positions.push(at);
      exactCount += 1;
    }
  }
  let truncated = match.truncated;
  for (const keyIndex of match.prefixed) {
    const from = index.group[keyIndex] ?? 0;
    const to = index.group[keyIndex + 1] ?? 0;
    for (let at = from; at < to; at += 1) {
      if (positions.length - exactCount >= limit) {
        truncated = true;
        break;
      }
      positions.push(at);
    }
    if (truncated && positions.length - exactCount >= limit) break;
  }
  return {
    entries: positions.map((position) => readRecord(index, position, side)),
    exactCount,
    truncated,
    key: match.key,
  };
}

/** The phrasebook, or an empty list for a pack that carries none. A phrasebook is content, so a missing one is not an error. */
export function readPhrases(dir: string): { id: string; title: string; phrases: { en: string; sr: string }[] }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, "phrases.json"), "utf8"));
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const topics = (parsed as Record<string, unknown>)["topics"];
  if (!Array.isArray(topics)) return [];
  return topics
    .map((topic) => {
      const record = topic as Record<string, unknown>;
      const phrases = Array.isArray(record["phrases"]) ? record["phrases"] : [];
      return {
        id: typeof record["id"] === "string" ? record["id"] : "",
        title: typeof record["title"] === "string" ? record["title"] : "",
        phrases: phrases
          .map((phrase) => phrase as Record<string, unknown>)
          .filter((phrase) => typeof phrase["en"] === "string" && typeof phrase["sr"] === "string")
          .map((phrase) => ({ en: phrase["en"] as string, sr: phrase["sr"] as string })),
      };
    })
    .filter((topic) => topic.id !== "" && topic.title !== "");
}
