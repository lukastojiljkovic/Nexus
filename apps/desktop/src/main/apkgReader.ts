import { open } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import Database from "better-sqlite3-multiple-ciphers";
import { fromRandomAccessReaderPromise, type Entry, type ZipFile } from "yauzl";

import {
  ankiNotetypeKind,
  ProtoWalkError,
  walkProtoFields,
  type ApkgCard,
  type ApkgDeck,
  type ApkgNote,
  type ApkgNotetype,
  type ParsedApkg,
  type ProtoField,
} from "@nexus/core";

import {
  ByteSourceRandomAccessReader,
  collectStream,
  createFileByteSource,
} from "./archiveReader.js";
import {
  APKG_IMPORT_MAX_CARDS,
  APKG_IMPORT_MAX_COLLECTION_BYTES,
  APKG_IMPORT_MAX_ENTRIES,
  APKG_IMPORT_MAX_FIELD_BYTES,
  APKG_IMPORT_MAX_FILE_BYTES,
  APKG_IMPORT_MAX_MEDIA_ENTRIES,
  APKG_IMPORT_MAX_NOTES,
  type ApkgReadErrorCode,
} from "../shared/ipc.js";

/**
 * The untrusted-input boundary for the Anki `.apkg` import (ADR-052 /
 * STUDY-011): turns a FILE on disk into the `ParsedApkg` `@nexus/core`'s
 * `translateApkg` consumes. A small sibling of `archiveReader.ts`, built on the
 * same three exported pieces (`createFileByteSource`,
 * `ByteSourceRandomAccessReader`, `collectStream`) — an `.apkg` is a plain zip,
 * so the bytes flow exactly as an unencrypted `.nexus.zip`'s do.
 *
 * What is NOT the same, and is the reason this file exists at all: an `.apkg`
 * carries somebody else's SQLITE DATABASE. Every other file this app opens is
 * data we parse ourselves; this one has to be handed to SQLite, which is a
 * considerably larger piece of C than anything else in the trust boundary. The
 * mitigations that buys are stated as one block at `openCollection` below and
 * are not optional.
 *
 * WHAT IT READS, and nothing else: `collection.anki21b` / `collection.anki21` /
 * `collection.anki2` (whichever is present, in Anki's own precedence) and the
 * `media` manifest. Every other entry — every media FILE, every `meta`, and
 * anything a hostile zip adds — is skipped WITHOUT EVER OPENING A READ STREAM,
 * exactly as `archiveReader.ts` skips a human mirror. `meta` (a
 * `PackageMetadata` protobuf, proto/anki/import_export.proto) stays unopened on
 * purpose: its version enum only restates which collection entry the zip
 * carries, and says less than the collection's own `col.ver`, which is read
 * anyway. v1 imports no media at all, so the manifest is read only to COUNT
 * what is being left behind; not one media byte is decompressed.
 *
 * WHICH SCHEMAS. Both versions Anki itself exports are read completely. Schema
 * 11 — what „Support older Anki versions" writes — keeps its notetypes and
 * decks as JSON in the `col` row. Schema 18 (`collection.anki21b`, the whole
 * file one zstd frame) moved them into `notetypes`/`decks` TABLES
 * (rslib/src/storage/upgrades/schema15_upgrade.sql), and the one fact those
 * columns do not state — is a notetype BASIC or CLOZE — is read out of the
 * notetype's `config` protobuf with core's `ankiNotetypeKind`; the `notes` and
 * `cards` tables are column-for-column what schema 11 has (no upgrade between
 * 11 and 18 touches either), so both schemas feed ONE query path. Anything
 * else is refused BY NAME rather than half-parsed: a schema newer than 18
 * (Anki's own SCHEMA_MAX_VERSION today), one of the in-place upgrade steps
 * 12–17 no exporter writes, or something older than 11 — a guessed read of any
 * of them could put a `{{c1::…}}` template on the front of a "basic" card,
 * which is worse than an honest refusal.
 *
 * Deliberately Electron-free, like `archiveReader.ts` and `restore.ts` — no
 * `import "electron"`, directly or transitively — so the whole path is
 * exercisable under plain Node/Vitest against fixtures the tests BUILD.
 */

export class ApkgReadError extends Error {
  constructor(
    public readonly code: ApkgReadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApkgReadError";
  }
}

/**
 * Every bound this reader enforces. Injectable (rather than the constants
 * directly) for `ArchiveLimits`' reason: a test can prove each one fires without
 * building a half-gigabyte fixture, and then re-run the same fixture under
 * `DEFAULT_APKG_LIMITS` to prove it was the limit and not the fixture.
 */
export interface ApkgLimits {
  /** The `.apkg` file on disk. */
  maxFileBytes: number;
  /** The uncompressed collection database — RESIDENT while it is read, and the ceiling a zstd stream is decompressed under. */
  maxCollectionBytes: number;
  /** Entries in the zip's central directory, skipped ones included. */
  maxEntries: number;
  /** Rows read out of `notes`. */
  maxNotes: number;
  /** Rows read out of `cards`. */
  maxCards: number;
  /** Entries the `media` manifest may declare. */
  maxMediaEntries: number;
  /** One field of one note, in UTF-8 bytes. */
  maxFieldBytes: number;
}

export const DEFAULT_APKG_LIMITS: ApkgLimits = {
  maxFileBytes: APKG_IMPORT_MAX_FILE_BYTES,
  maxCollectionBytes: APKG_IMPORT_MAX_COLLECTION_BYTES,
  maxEntries: APKG_IMPORT_MAX_ENTRIES,
  maxNotes: APKG_IMPORT_MAX_NOTES,
  maxCards: APKG_IMPORT_MAX_CARDS,
  maxMediaEntries: APKG_IMPORT_MAX_MEDIA_ENTRIES,
  maxFieldBytes: APKG_IMPORT_MAX_FIELD_BYTES,
};

/**
 * The collection entries, in Anki's OWN precedence: when a file carries more
 * than one, `.anki21b` is the authoritative copy and the legacy ones are the
 * downgraded mirrors it was written beside. The order is load-bearing, not
 * cosmetic: a modern export ALWAYS writes a stub `collection.anki2` next to the
 * real `.anki21b` — a one-note schema-11 placeholder telling an old client to
 * update (rslib/src/import_export/package/colpkg/export.rs) — and reading the
 * stub in preference to the real thing would import that one junk note as the
 * whole deck.
 */
const COLLECTION_ENTRIES = ["collection.anki21b", "collection.anki21", "collection.anki2"] as const;

/** The media manifest's entry name — the only other entry this reader opens. */
const MEDIA_ENTRY = "media";

/** Anki's own field separator inside `notes.flds` (US, `0x1f`), and its deck-name separator in schema 18. Built from its code point rather than typed, because the raw control character is invisible in every editor that would ever have to read this line. */
const FIELD_SEPARATOR = String.fromCharCode(0x1f);

/** The first four bytes of a zstd frame (RFC 8878). Sniffed rather than assumed, because the media manifest is compressed in the new format and plain JSON in the old one. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

// --- The media manifest ------------------------------------------------------

/** One entry the `media` manifest declares. Counted and named; its BYTES are never touched, in either format. */
export interface ApkgMediaEntry {
  name: string;
  sizeBytes: number;
}

/**
 * Core's wire walker, with its failure translated into this reader's refusal.
 * A GENERATOR wrapping a generator, so a hostile message is still walked
 * lazily — the entry cap below fires at the cap, not after millions of fields
 * were materialized first.
 */
function* walkProtoOr(bytes: Uint8Array, what: string): Generator<ProtoField, void, undefined> {
  try {
    yield* walkProtoFields(bytes);
  } catch (error) {
    if (error instanceof ProtoWalkError) {
      throw new ApkgReadError("damaged", `The ${what} is not readable protobuf.`, { cause: error });
    }
    throw error;
  }
}

/**
 * The new-format `media` manifest: a protobuf `MediaEntries { repeated
 * MediaEntry entries = 1 }`, each entry `{ string name = 1; uint32 size = 2;
 * bytes sha1 = 3 }` (proto/anki/import_export.proto).
 *
 * Read with core's `walkProtoFields` — the same forty-line walker the schema-18
 * notetype config goes through — rather than a protobuf dependency, and that is
 * proportionate: the only two fields read are a length-delimited string and a
 * varint. Everything else — the sha1, any field a future Anki adds — is walked
 * past by size without being interpreted, which is exactly what protobuf's wire
 * format is designed to allow.
 *
 * Pure and exported so it can be driven straight from a test with truncated
 * varints, lengths past the end, unknown field numbers and group wire types,
 * none of which needs an `.apkg` to exist.
 */
export function parseMediaEntriesProto(
  bytes: Uint8Array,
  maxEntries: number,
): readonly ApkgMediaEntry[] {
  const entries: ApkgMediaEntry[] = [];
  for (const field of walkProtoOr(bytes, "media manifest")) {
    if (field.fieldNumber !== 1 || field.wireType !== 2) continue;
    if (entries.length >= maxEntries) {
      throw new ApkgReadError(
        "too-large",
        `The media manifest declares more than ${maxEntries} entries.`,
      );
    }
    entries.push(parseMediaEntry(field.bytes));
  }
  return entries;
}

/** One `MediaEntry` submessage: its name and size, everything else walked past by size. */
function parseMediaEntry(bytes: Uint8Array): ApkgMediaEntry {
  let name = "";
  let sizeBytes = 0;
  for (const field of walkProtoOr(bytes, "media manifest")) {
    if (field.fieldNumber === 1 && field.wireType === 2) {
      name = Buffer.from(field.bytes).toString("utf8");
    } else if (field.fieldNumber === 2 && field.wireType === 0) {
      sizeBytes = field.value;
    }
  }
  return { name, sizeBytes };
}

/**
 * The legacy `media` manifest: a JSON object mapping the zip's numeric entry
 * name to the media file's real name (`{"0":"cell.jpg","1":"beat.mp3"}`). Only
 * the names are read — the numbered entries they point at are never opened.
 */
export function parseMediaEntriesJson(text: string, maxEntries: number): readonly ApkgMediaEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ApkgReadError("damaged", "The media manifest is not valid JSON.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApkgReadError("damaged", "The media manifest is not a JSON object.");
  }
  const entries: ApkgMediaEntry[] = [];
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (entries.length >= maxEntries) {
      throw new ApkgReadError(
        "too-large",
        `The media manifest declares more than ${maxEntries} entries.`,
      );
    }
    entries.push({ name: typeof value === "string" ? value : "", sizeBytes: 0 });
  }
  return entries;
}

/** Whichever format the manifest is in, decompressed first when it is a zstd frame. */
function parseMediaManifest(bytes: Buffer, limits: ApkgLimits): readonly ApkgMediaEntry[] {
  const plain = bytes.subarray(0, 4).equals(ZSTD_MAGIC)
    ? decompressZstd(bytes, limits.maxCollectionBytes)
    : bytes;
  // A JSON object is the only thing that can start with `{`, and a protobuf
  // message never does (its first byte is a tag whose low three bits are a wire
  // type — `{` is 0x7b, wire type 3, which the walker refuses anyway).
  const first = plain[0];
  if (first === 0x7b) return parseMediaEntriesJson(plain.toString("utf8"), limits.maxMediaEntries);
  return parseMediaEntriesProto(plain, limits.maxMediaEntries);
}

// --- zstd --------------------------------------------------------------------

/**
 * Decompresses a zstd frame under a hard output ceiling.
 *
 * `zstdDecompressSync` landed in Node 22.15/23.8 and this app's Electron is
 * pinned to a Node 24, so it is there — but it is CHECKED rather than assumed,
 * because "the function is missing" and "the file is corrupt" are two different
 * things to tell a user, and only one of them is their file's fault.
 */
function decompressZstd(bytes: Buffer, maxOutputLength: number): Buffer {
  if (typeof zstdDecompressSync !== "function") {
    throw new ApkgReadError(
      "zstd-unavailable",
      "This build's Node has no zstd support, which the newer .apkg format needs.",
    );
  }
  try {
    return Buffer.from(zstdDecompressSync(bytes, { maxOutputLength }));
  } catch (error) {
    // `maxOutputLength` rejects with ERR_BUFFER_TOO_LARGE, which for our
    // purposes is the same refusal every other cap makes.
    const code = (error as { code?: unknown }).code;
    if (code === "ERR_BUFFER_TOO_LARGE") {
      throw new ApkgReadError(
        "too-large",
        `The collection decompresses to more than the ${maxOutputLength}-byte cap.`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
    throw new ApkgReadError("damaged", "The collection's zstd stream could not be decompressed.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

// --- The zip -----------------------------------------------------------------

/** The two entries this reader is willing to open, and their bytes. Everything else in the zip is skipped without a read stream. */
interface ApkgEntries {
  collection: Buffer;
  media: Buffer | null;
}

async function readApkgEntries(filePath: string, limits: ApkgLimits): Promise<ApkgEntries> {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    if (size > limits.maxFileBytes) {
      throw new ApkgReadError(
        "too-large",
        `The file is ${size} bytes, past the ${limits.maxFileBytes}-byte cap.`,
      );
    }
    if (size === 0) throw new ApkgReadError("not-an-apkg", "The file is empty.");

    const source = createFileByteSource(handle, size);
    let zipFile: ZipFile;
    try {
      zipFile = await fromRandomAccessReaderPromise(
        new ByteSourceRandomAccessReader(source),
        size,
        {
          lazyEntries: true,
          autoClose: false,
          decodeStrings: true,
          validateEntrySizes: true,
          strictFileNames: true,
        },
      );
    } catch (error) {
      throw new ApkgReadError("not-an-apkg", "This file is not a readable zip.", {
        cause: error instanceof Error ? error : undefined,
      });
    }

    // From here on the zip reader is released on EVERY path, not only the
    // successful one — an entry-walk refusal and a missing collection are both
    // exits, and neither may leave it behind.
    try {
      return await readWantedEntries(zipFile, limits);
    } finally {
      zipFile.close();
    }
  } finally {
    // ONE close, on every path. Unlike `archiveReader.ts`'s `OpenedArchive` —
    // which stays open between preview and apply so a 50 MB blob can stream out
    // of it later — this reader needs nothing from the file once it returns:
    // both entries it opens are already resident. Holding the handle a moment
    // longer would only keep the user's file locked on Windows.
    await handle.close().catch(() => {});
  }
}

/**
 * The entry walk and the two reads it leads to, split out so `readApkgEntries`
 * can release the zip reader in ONE `finally` around the whole of it — a
 * refused walk and a missing collection are exits too, and neither may leave
 * the reader behind.
 */
async function readWantedEntries(zipFile: ZipFile, limits: ApkgLimits): Promise<ApkgEntries> {
  const wanted = new Map<string, Entry>();
  try {
    let entryCount = 0;
    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        throw new ApkgReadError("too-large", `The zip holds more than ${limits.maxEntries} entries.`);
      }
      const name = entry.fileName;
      // Media FILES are numbered entries (`0`, `1`, `2`, …) and are never
      // opened: v1 imports no media, so their bytes cost nothing to ignore.
      if (name !== MEDIA_ENTRY && !(COLLECTION_ENTRIES as readonly string[]).includes(name)) {
        continue;
      }
      if (wanted.has(name)) {
        // Two entries under one name is the shape of a file built so that a
        // preview and an apply could see different bytes — the same reading
        // `archiveReader.ts` gives it.
        throw new ApkgReadError("damaged", `The zip holds more than one entry named "${name}".`);
      }
      if (entry.uncompressedSize > limits.maxCollectionBytes) {
        throw new ApkgReadError(
          "too-large",
          `Entry "${name}" (${entry.uncompressedSize} bytes) is past the ${limits.maxCollectionBytes}-byte cap.`,
        );
      }
      wanted.set(name, entry);
    }
  } catch (error) {
    if (error instanceof ApkgReadError) throw error;
    throw new ApkgReadError("damaged", "The zip's structure could not be walked.", {
      cause: error instanceof Error ? error : undefined,
    });
  }

  const collectionName = COLLECTION_ENTRIES.find((name) => wanted.has(name));
  const collectionEntry = collectionName === undefined ? undefined : wanted.get(collectionName);
  if (collectionEntry === undefined) {
    throw new ApkgReadError(
      "no-collection",
      "This zip carries no collection.anki2 / .anki21 / .anki21b — it is not an Anki deck.",
    );
  }

  const readEntry = async (entry: Entry): Promise<Buffer> =>
    collectStream(await zipFile.openReadStreamPromise(entry));

  const raw = await readEntry(collectionEntry);
  // `.anki21b` is a zstd frame; the two legacy names are the database itself.
  // Sniffed rather than inferred from the entry's NAME, so a mislabelled one is
  // read for what it actually is.
  const collection = raw.subarray(0, 4).equals(ZSTD_MAGIC)
    ? decompressZstd(raw, limits.maxCollectionBytes)
    : raw;
  if (collection.byteLength > limits.maxCollectionBytes) {
    throw new ApkgReadError(
      "too-large",
      `The collection is ${collection.byteLength} bytes, past the ${limits.maxCollectionBytes}-byte cap.`,
    );
  }

  const mediaEntry = wanted.get(MEDIA_ENTRY);
  const media = mediaEntry === undefined ? null : await readEntry(mediaEntry);
  return { collection, media };
}

// --- The untrusted database --------------------------------------------------

/**
 * ===========================================================================
 * THE MITIGATION SET FOR AN UNTRUSTED SQLITE FILE (ADR-052). Every line of it
 * is load-bearing; none of it is ceremony.
 *
 *  1. `new Database(buffer, { readonly: true })` — the bytes are DESERIALIZED
 *     from memory (`sqlite3_deserialize`), never written to disk first. No temp
 *     file, no journal, no WAL, no `-shm`: nothing of somebody else's database
 *     ever touches this machine's filesystem, and there is no path for it to be
 *     opened again later by anything else.
 *  2. `PRAGMA query_only = 1` — refuses every write statement outright, so no
 *     part of the read path below can be tricked into modifying the image.
 *  3. `PRAGMA trusted_schema = OFF` — the schema of this file was written by
 *     somebody else. OFF stops views, triggers, generated columns, CHECK
 *     constraints and index expressions in it from invoking anything but the
 *     SQL functions explicitly marked innocuous. This is the pragma that closes
 *     "a hostile schema runs code during a plain SELECT".
 *  4. `PRAGMA cell_size_check = ON` — validates B-tree cell sizes as pages are
 *     read, turning a whole family of corrupt-page reads into an error instead
 *     of an out-of-bounds access.
 *  5. `PRAGMA quick_check` — refuses a structurally damaged file BEFORE any of
 *     the queries below run, rather than discovering it mid-walk.
 *  6. `loadExtension` and `unsafeMode` are NEVER called. Loading an extension
 *     from a file this app did not write would be arbitrary code execution;
 *     `unsafeMode` is what would re-enable the things (3) turns off.
 *  7. Only FIXED, PARAMETERIZED SQL, with `LIMIT ?` on every row-producing
 *     statement and a row cap checked after. better-sqlite3 is SYNCHRONOUS —
 *     a query over a hostile file blocks the main process for as long as it
 *     runs, and there is no cancellation — so these caps are the ONLY bound on
 *     how long that can be. Not one identifier or value is interpolated.
 *  8. Never ATTACHed to the live database. The user's own encrypted profile and
 *     this file are never in the same connection, so nothing in it can name a
 *     table of theirs.
 *  9. The handle is closed in `finally`, on every path.
 * ===========================================================================
 */
function openCollection(bytes: Buffer): Database.Database {
  let db: Database.Database;
  try {
    db = new Database(bytes, { readonly: true });
  } catch (error) {
    throw new ApkgReadError("damaged", "The collection is not a readable SQLite database.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  try {
    db.pragma("query_only = 1");
    db.pragma("trusted_schema = OFF");
    db.pragma("cell_size_check = ON");
    const check = db.pragma("quick_check", { simple: true });
    if (check !== "ok") {
      throw new ApkgReadError(
        "damaged",
        `The collection failed SQLite's own integrity check: ${String(check)}.`,
      );
    }
  } catch (error) {
    db.close();
    if (error instanceof ApkgReadError) throw error;
    throw new ApkgReadError("damaged", "The collection could not be opened for reading.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  return db;
}

/**
 * The two schema versions an Anki export can carry, and the ONLY two this build
 * reads — which is not a subset, it is the whole set: Anki's exporter writes 11
 * with „Support older Anki versions" on and its current schema otherwise, and
 * 12–17 are in-place upgrade steps no exporter ever writes
 * (rslib/src/storage/upgrades/mod.rs: SCHEMA_MIN_VERSION 11, SCHEMA_MAX_VERSION
 * 18). A version past 18 is a FUTURE Anki, refused by name below exactly as 18
 * itself was refused before this build could read it.
 */
const LEGACY_SCHEMA = 11;
const LATEST_SCHEMA = 18;

/** One `notes` row, exactly as the fixed SQL below selects it. */
interface NoteRow {
  id: number;
  mid: number;
  flds: string;
  tags: string;
}

/** One `cards` row. `odid` is the card's ORIGINAL deck when it currently sits in a filtered one; a filtered deck is a temporary view, not where the card lives. */
interface CardRow {
  nid: number;
  ord: number;
  did: number;
  odid: number;
  reps: number;
  queue: number;
}

/**
 * Every row-producing statement is capped one past its limit, so "too many" is
 * detected rather than silently truncated — and a statement the collection
 * cannot even PREPARE (a schema-18 `col.ver` over a database missing the
 * schema-18 tables, say) is damage by name, not a bare SqliteError at the
 * caller.
 */
function selectAll<T>(db: Database.Database, sql: string, limit: number, what: string): T[] {
  let rows: T[];
  try {
    rows = db.prepare<[number], T>(sql).all(limit + 1);
  } catch (error) {
    throw new ApkgReadError("damaged", `The collection's ${what} could not be read.`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (rows.length > limit) {
    throw new ApkgReadError("too-large", `The collection holds more than ${limit} ${what}.`);
  }
  return rows;
}

/**
 * Schema 18's notetypes and decks, from the TABLES that replaced the `col`
 * row's JSON (rslib/src/storage/upgrades/schema15_upgrade.sql): `notetypes(id,
 * name, config)`, `templates(ntid, ord, …)` counted per notetype, `decks(id,
 * name)` with `\x1f` path separators. The `fields` table is deliberately not
 * read — a note's own `flds` split says how many fields it has, which is all
 * the translator asks.
 *
 * The one non-column fact — basic or cloze — comes out of `config` through
 * core's `ankiNotetypeKind`. Its two failure modes get the two different
 * refusals they deserve: a MALFORMED blob is damage (real Anki never writes
 * one), while a WELL-FORMED kind this build does not know is a future Anki's
 * notetype — that one drops the notetype from the answer, so its notes surface
 * in the preview as counted `unknown-notetype` skips instead of arriving as
 * guessed cards, and a single strange notetype never refuses the whole file.
 *
 * All three reads share the `maxNotes` cap: none of these tables can honestly
 * outnumber the notes of a real collection, and a hand-built file that makes
 * them is refused as too large rather than walked.
 */
function readSchema18Tables(
  db: Database.Database,
  limits: ApkgLimits,
): { notetypes: ApkgNotetype[]; decks: ApkgDeck[] } {
  const templateCounts = new Map<number, number>();
  for (const row of selectAll<{ ntid: number }>(
    db,
    "SELECT ntid FROM templates ORDER BY ntid, ord LIMIT ?",
    limits.maxNotes,
    "templates",
  )) {
    templateCounts.set(row.ntid, (templateCounts.get(row.ntid) ?? 0) + 1);
  }

  const notetypes: ApkgNotetype[] = [];
  for (const row of selectAll<{ id: number; name: string; config: unknown }>(
    db,
    "SELECT id, name, config FROM notetypes ORDER BY id LIMIT ?",
    limits.maxNotes,
    "notetypes",
  )) {
    // SQLite is dynamically typed: a hostile file can hold TEXT in a `blob NOT
    // NULL` column, and real Anki cannot. Not-a-blob is therefore damage, on
    // the same terms a malformed protobuf inside a real blob is.
    if (!(row.config instanceof Uint8Array)) {
      throw new ApkgReadError("damaged", "A notetype's config is not a blob.");
    }
    let kind: "basic" | "cloze" | null;
    try {
      kind = ankiNotetypeKind(row.config);
    } catch (error) {
      if (error instanceof ProtoWalkError) {
        throw new ApkgReadError("damaged", "A notetype's config is not readable protobuf.", {
          cause: error,
        });
      }
      throw error;
    }
    if (kind === null) continue;
    notetypes.push({
      id: row.id,
      name: row.name,
      kind,
      templateCount: Math.max(1, templateCounts.get(row.id) ?? 0),
    });
  }

  const decks = selectAll<{ id: number; name: string }>(
    db,
    "SELECT id, name FROM decks ORDER BY id LIMIT ?",
    limits.maxNotes,
    "decks",
  ).map((row) => ({ id: row.id, name: row.name.split(FIELD_SEPARATOR).join("::") }));

  return { notetypes, decks };
}

/** Anki's `models` JSON: `{ "<id>": { name, type, tmpls: [...] } }`, where `type` is 0 for a standard notetype and 1 for a cloze one. */
function parseNotetypes(json: string): ApkgNotetype[] {
  const parsed = parseJsonObject(json, "models");
  const notetypes: ApkgNotetype[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || typeof value !== "object") continue;
    const model = value as Record<string, unknown>;
    const id = numberOf(model.id) ?? Number.parseInt(key, 10);
    if (!Number.isFinite(id)) continue;
    const templates = Array.isArray(model.tmpls) ? model.tmpls.length : 1;
    notetypes.push({
      id,
      name: typeof model.name === "string" ? model.name : "",
      kind: numberOf(model.type) === 1 ? "cloze" : "basic",
      templateCount: Math.max(1, templates),
    });
  }
  return notetypes;
}

/** Anki's `decks` JSON: `{ "<id>": { name } }`, the name carrying its `Parent::Child` path. */
function parseDecks(json: string): ApkgDeck[] {
  const parsed = parseJsonObject(json, "decks");
  const decks: ApkgDeck[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || typeof value !== "object") continue;
    const deck = value as Record<string, unknown>;
    const id = numberOf(deck.id) ?? Number.parseInt(key, 10);
    if (!Number.isFinite(id)) continue;
    const name = typeof deck.name === "string" ? deck.name : "";
    // A schema-11 deck name is already `::`-separated; the split is belt and
    // braces, so an `\x1f` smuggled into the JSON reads exactly as
    // `readSchema18Tables` reads the native separator and never reaches a
    // screen raw.
    decks.push({ id, name: name.split(FIELD_SEPARATOR).join("::") });
  }
  return decks;
}

function parseJsonObject(json: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ApkgReadError("damaged", `The collection's ${what} is not valid JSON.`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApkgReadError("damaged", `The collection's ${what} is not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Reads one `.apkg` off disk.
 *
 * Every failure is an `ApkgReadError` carrying an `ApkgReadErrorCode` the
 * screen has a sentence for; nothing here throws a bare `Error` at the caller
 * for anything a user's file can cause.
 */
export async function readApkg(
  filePath: string,
  limits: ApkgLimits = DEFAULT_APKG_LIMITS,
): Promise<ParsedApkg> {
  const entries = await readApkgEntries(filePath, limits);
  const mediaEntries = entries.media === null ? [] : parseMediaManifest(entries.media, limits);

  const db = openCollection(entries.collection);
  try {
    let col: { ver: number; models: string; decks: string } | undefined;
    try {
      col = db
        .prepare<[], { ver: number; models: string; decks: string }>(
          "SELECT ver, models, decks FROM col LIMIT 1",
        )
        .get();
    } catch (error) {
      throw new ApkgReadError("damaged", "The collection has no readable `col` row.", {
        cause: error instanceof Error ? error : undefined,
      });
    }
    if (col === undefined) {
      throw new ApkgReadError("damaged", "The collection's `col` table is empty.");
    }
    // The one fork between the two schemas this build reads: where notetypes
    // and decks live. Notes and cards are identical in both and are read below
    // by one set of statements.
    let notetypes: ApkgNotetype[];
    let decks: ApkgDeck[];
    if (col.ver === LEGACY_SCHEMA) {
      notetypes = parseNotetypes(col.models);
      decks = parseDecks(col.decks);
    } else if (col.ver === LATEST_SCHEMA) {
      ({ notetypes, decks } = readSchema18Tables(db, limits));
    } else {
      throw new ApkgReadError(
        "unsupported-schema",
        col.ver > LATEST_SCHEMA
          ? `This collection is Anki schema ${col.ver}, newer than the ${LATEST_SCHEMA} this build reads — refused rather than guessed at.`
          : col.ver > LEGACY_SCHEMA
            ? `This collection is Anki schema ${col.ver}, an in-place upgrade step Anki itself never exports.`
            : `This collection is Anki schema ${col.ver}, which predates anything this build reads.`,
      );
    }

    const noteRows = selectAll<NoteRow>(
      db,
      "SELECT id, mid, flds, tags FROM notes ORDER BY id LIMIT ?",
      limits.maxNotes,
      "notes",
    );
    const cardRows = selectAll<CardRow>(
      db,
      "SELECT nid, ord, did, odid, reps, queue FROM cards ORDER BY id LIMIT ?",
      limits.maxCards,
      "cards",
    );

    const notes: ApkgNote[] = noteRows.map((row) => ({
      id: row.id,
      notetypeId: row.mid,
      fields: splitFields(row.flds, limits.maxFieldBytes),
      // Anki stores tags as one space-padded string (" a b "), never as JSON.
      tags: row.tags.split(/\s+/).filter((tag) => tag.length > 0),
    }));

    const cards: ApkgCard[] = cardRows.map((row) => ({
      noteId: row.nid,
      ord: row.ord,
      // A card sitting in a filtered deck has its real home in `odid`; the
      // filtered deck is a temporary view Anki empties again, and importing
      // into it would put the card somewhere its owner never filed it.
      deckId: row.odid !== 0 ? row.odid : row.did,
      reps: row.reps,
      // Anki's queue is negative for suspended (-1) and the two buried states
      // (-2, -3). All three are "the user took this card out of rotation", a
      // state this import does not carry — folded into one honest line.
      suspended: row.queue < 0,
    }));

    return { decks, notetypes, notes, cards, mediaCount: mediaEntries.length };
  } finally {
    db.close();
  }
}

/** `notes.flds`, split on Anki's own separator, each field held to the per-field byte cap. */
function splitFields(flds: string, maxFieldBytes: number): string[] {
  const fields = flds.split(FIELD_SEPARATOR);
  for (const field of fields) {
    if (Buffer.byteLength(field, "utf8") > maxFieldBytes) {
      throw new ApkgReadError(
        "too-large",
        `A note field is past the ${maxFieldBytes}-byte cap. It is not text somebody typed.`,
      );
    }
  }
  return fields;
}
