/**
 * The untrusted-input boundary for IMEX restore (ADR-022 / ADR-023, IMEX
 * slice 3c): turns an archive FILE on disk — a plain `.nexus.zip`, or an
 * `.nexus` `NXA1` container sealed under a passphrase — into the
 * `files`/`ydocs`/`blobNames` shape `parseImportArchive` (`@nexus/core`)
 * validates. This module never validates a single field of manifest or
 * record content; its only job is "which bytes, from which archive path,
 * does the rest of restore get to see at all" — everything not in
 * ADR-022's "yes" column (the `notes/**.md` and `tables/*.csv` human
 * mirrors, and anything a hostile file might add) is skipped WITHOUT EVER
 * opening a read stream for it, so a mirror or a fabricated entry costs
 * nothing to ignore.
 *
 * Built on two pieces from `@nexus/core` rather than reimplementing either:
 * `openArchivePlaintext` random-access-decrypts an `NXA1` container's
 * payload one frame at a time — never the whole plaintext resident in
 * memory, and never written to disk in the clear, exactly the property
 * ADR-022 exists to hold — and `parseImportArchive` is the pure validator
 * this module's output feeds. A plain (unencrypted) `.nexus.zip` is read the
 * same way, just with the file itself standing in as the byte source
 * `yauzl` seeks over: there is no separate "unencrypted" code path once
 * bytes are flowing, only a different `ArchiveByteSource` in front of it.
 *
 * Every archive entry not on the fixed allowlist (`manifest.json`,
 * `DATA_FILES`, `data/notes/<id>.ydoc`, `data/note-versions/<id>/<seq>.ydoc`,
 * `blobs/<sha256>`) is ignored. Two entries claiming the SAME allowlisted
 * name is treated as damage (`"damaged"`), not "last one wins" — a zip
 * carrying two `manifest.json` entries is exactly the shape of a file built
 * so a preview and an apply could see different bytes under the same name.
 *
 * A blob is never held resident: its bytes are streamed straight through a
 * running SHA-256 and discarded, and the digest is compared to the entry's
 * own name. A match lands in `blobNames`; a mismatch lands in
 * `corruptBlobNames` and does NOT fail the open — a damaged attachment is a
 * lost image, not a lost backup, and `parseImportArchive` turns a missing
 * name into a `missing-blob` warning on the one row that needed it, exactly
 * as the export path already tolerates a blob it cannot find. `readBlob`
 * re-opens and re-hashes rather than caching, because an archive may hold
 * many 50 MB blobs and holding them all from preview to apply is exactly the
 * memory blow-up this design exists to avoid.
 *
 * `ArchiveLimits` bounds every dimension a hostile or merely-corrupt archive
 * could otherwise use to exhaust the process that opens it — see the
 * interface's own field comments for what each one closes. This module is
 * deliberately Electron-free (no `import "electron"`, directly or
 * transitively), so it can be exercised under plain Node/Vitest; the caller
 * (main-process IPC) is the one that owns `app`/`dialog` and hands this
 * module only a file path and a passphrase.
 */

import { createHash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { fromRandomAccessReaderPromise, RandomAccessReader, type Entry, type ZipFile } from "yauzl";

import {
  ARCHIVE_MAGIC,
  ArchiveDecryptError,
  ArchiveFormatError,
  DATA_FILES,
  openArchivePlaintext,
  type ArchiveByteSource,
  type ArchiveHeader,
} from "@nexus/core";
import { deriveArchiveKey } from "@nexus/core/auth";

import { NOTE_ATTACHMENT_MAX_BYTES, type ArchiveReadErrorCode } from "../shared/ipc.js";

// Declared in `shared/ipc.ts` (the one file every wire shape lives in) and
// re-exported here so this module's existing consumers are unaffected.
export type { ArchiveReadErrorCode };

export class ArchiveReadError extends Error {
  constructor(
    public readonly code: ArchiveReadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArchiveReadError";
  }
}

/**
 * Every bound this reader enforces on an untrusted archive. Injectable
 * (rather than hard-coded constants) so a test can prove each one fires
 * without building a multi-gigabyte fixture — `archiveReader.test.ts`'s
 * "limits" suite always re-opens the same fixture under
 * `DEFAULT_ARCHIVE_LIMITS` too, to prove the limit and not the fixture.
 */
export interface ArchiveLimits {
  /**
   * Maximum number of entries in the central directory — counting entries
   * that are skipped (never on the allowlist) too. Bounds the cost of the
   * entry walk itself: a hostile zip can carry an enormous central
   * directory (a "zip bomb" of metadata, not content) that would otherwise
   * cost real time and per-entry allocation to iterate even though every
   * entry ends up ignored.
   */
  maxEntries: number;
  /**
   * Maximum uncompressed size of any single entry this reader opens. Bounds
   * a classic "zip bomb" entry — a tiny compressed size unpacking into
   * something enormous — from ever being read: checked against the entry's
   * declared `uncompressedSize` BEFORE a read stream is opened.
   */
  maxEntryBytes: number;
  /**
   * Maximum uncompressed size of every entry this reader actually opens,
   * summed. Bounds a "death by a thousand cuts" archive: many entries each
   * individually under `maxEntryBytes`, whose total would still exhaust
   * time or disk to fully read.
   */
  maxTotalBytes: number;
  /**
   * Maximum bytes held in memory at once: text entries plus `.ydoc` entries,
   * summed. Blobs are streamed and never counted here (see the module
   * header) — this is the limit that protects the MAIN PROCESS'S HEAP
   * specifically, because text/`.ydoc` bytes are retained in
   * `files`/`ydocs` for the lifetime of the `OpenedArchive`, unlike a blob,
   * which is hashed and discarded.
   */
  maxResidentBytes: number;
  /** Maximum size of one `blobs/<sha256>` entry. */
  maxBlobBytes: number;
}

/**
 * `maxBlobBytes` is `NOTE_ATTACHMENT_MAX_BYTES` (`shared/ipc.ts`) — the app's
 * own 50 MB attachment ceiling — because a blob bigger than that could never
 * have come from this app's own export writer; anything larger is simply not
 * a legitimate attachment, whichever archive it arrived in.
 */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 250_000,
  maxEntryBytes: 209_715_200,
  maxTotalBytes: 21_474_836_480,
  maxResidentBytes: 1_073_741_824,
  maxBlobBytes: NOTE_ATTACHMENT_MAX_BYTES,
};

export interface OpenedArchive {
  /** True when the file was an `NXA1` container rather than a plain zip. */
  readonly encrypted: boolean;
  /** `manifest.json` and `data/*.ndjson`, decoded as UTF-8. */
  readonly files: ReadonlyMap<string, string>;
  /** `data/notes/*.ydoc` and `data/note-versions/**\/*.ydoc`, by archive path. */
  readonly ydocs: ReadonlyMap<string, Uint8Array>;
  /** Blob names present in the archive AND verified to hash to their own name. This is `ImportArchiveInput.blobNames`. */
  readonly blobNames: ReadonlySet<string>;
  /** Blob names present but whose bytes did NOT hash to their name — reported for the preview, never restored. */
  readonly corruptBlobNames: ReadonlySet<string>;
  /** Re-reads one verified blob's bytes, re-checking the hash. Rejects after `close()`. */
  readBlob(sha256: string): Promise<Uint8Array>;
  /** Releases the zip reader and the file handle. Idempotent. */
  close(): Promise<void>;
}

/**
 * Reads only the first four bytes of `filePath`: is this an `NXA1`
 * container? Lets the caller (the restore UI) ask for a passphrase only when
 * one is actually needed, without paying for a full `openArchive` — no zip
 * parsing, no KDF, no entry walk. Never throws on a file too short to hold a
 * magic: that is simply "not encrypted" from this narrow question's point of
 * view, and `openArchive` is the one that gives the precise
 * `"not-an-archive"` verdict.
 */
export async function inspectArchiveFile(filePath: string): Promise<{ encrypted: boolean }> {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    if (size < ARCHIVE_MAGIC.length) return { encrypted: false };
    const buffer = Buffer.alloc(ARCHIVE_MAGIC.length);
    const { bytesRead } = await handle.read(buffer, 0, ARCHIVE_MAGIC.length, 0);
    if (bytesRead < ARCHIVE_MAGIC.length) return { encrypted: false };
    return { encrypted: buffer.toString("utf8") === ARCHIVE_MAGIC };
  } finally {
    await handle.close();
  }
}

/**
 * Wraps an open `FileHandle` as an `ArchiveByteSource`: the same
 * random-access contract `openArchivePlaintext` requires, and also what
 * bridges a PLAIN (unencrypted) zip straight into `yauzl` — the two paths
 * converge on this exact shape. `FileHandle.read` may return fewer bytes
 * than asked for (a short read), so this loops until the buffer is full or
 * the file has genuinely run out, matching `ArchiveByteSource.read`'s
 * "resolves EXACTLY `length` bytes, or rejects" contract.
 */
function createFileByteSource(handle: FileHandle, byteLength: number): ArchiveByteSource {
  return {
    byteLength,
    async read(offset: number, length: number): Promise<Uint8Array> {
      const buffer = Buffer.alloc(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
        if (bytesRead === 0) {
          throw new Error(
            `Unexpected end of file: wanted ${length} byte(s) at offset ${offset}, got only ${filled}.`,
          );
        }
        filled += bytesRead;
      }
      return buffer;
    },
  };
}

/** How many bytes each pulled chunk carries while bridging a byte source's `read` into a `Readable` yauzl can consume — large enough to be efficient, small enough that a 200 MB entry is never materialised in one piece to satisfy a single range. */
const RANGE_READ_CHUNK_BYTES = 262_144; // 256 KiB

/**
 * Bridges an `ArchiveByteSource` (a file, or an `NXA1` container's decrypted
 * payload) into the random-access interface `yauzl` needs to read a zip's
 * central directory and entries out of order. `_readStreamForRange` is the
 * one method `yauzl.RandomAccessReader` requires a subclass to provide; the
 * async generator here pulls the requested range in bounded chunks rather
 * than reading it all up front, so a request that happens to span a 200 MB
 * entry never materialises the whole thing to satisfy one range.
 *
 * `close` is a deliberate no-op: the underlying `FileHandle` (or, for an
 * encrypted archive, the `ArchivePlaintext` wrapping it) is owned and closed
 * by `openArchive`'s own `close()`, not by `yauzl`. `autoClose: false` on
 * `fromRandomAccessReaderPromise` already means `yauzl` never calls this on
 * its own initiative, but overriding it explicitly documents that this class
 * holds no resource of its own to release.
 */
class ByteSourceRandomAccessReader extends RandomAccessReader {
  constructor(private readonly source: ArchiveByteSource) {
    super();
  }

  override _readStreamForRange(start: number, end: number): Readable {
    const source = this.source;
    async function* pull(): AsyncGenerator<Buffer> {
      let offset = start;
      while (offset < end) {
        const length = Math.min(RANGE_READ_CHUNK_BYTES, end - offset);
        const bytes = await source.read(offset, length);
        yield Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        offset += length;
      }
    }
    return Readable.from(pull());
  }

  override close(callback: (err: Error | null) => void): void {
    callback(null);
  }
}

const DATA_FILE_SET = new Set<string>(DATA_FILES);
/** `data/notes/<id>.ydoc` — the id segment may not itself contain a `/`, so a nested path like `data/notes/deep/nested.ydoc` never matches. */
const NOTE_YDOC_PATTERN = /^data\/notes\/[^/]+\.ydoc$/;
/** `data/note-versions/<noteId>/<coveredSeq>.ydoc`, mirroring `parseImportArchive`'s own path shape for a version snapshot. */
const NOTE_VERSION_YDOC_PATTERN = /^data\/note-versions\/[^/]+\/\d+\.ydoc$/;
/** Exactly 64 LOWERCASE hex characters — `createHash("sha256").digest("hex")` always produces lowercase, and this is compared byte-for-byte, so an uppercase or short name is never a blob this reader recognises. */
const BLOB_PATTERN = /^blobs\/([0-9a-f]{64})$/;

type EntryClass =
  | { kind: "text" }
  | { kind: "ydoc" }
  | { kind: "blob"; sha256: string }
  | { kind: "skip" };

/**
 * The archive allowlist (ADR-022's "yes" column). Everything else — every
 * `notes/**.md` and `tables/*.csv` mirror, and anything a hostile or foreign
 * zip might add — classifies as `"skip"` and is never opened: no read
 * stream, no size check, no memory cost, regardless of what it claims about
 * itself.
 */
function classifyEntryName(name: string): EntryClass {
  if (name === "manifest.json" || DATA_FILE_SET.has(name)) return { kind: "text" };
  if (NOTE_YDOC_PATTERN.test(name) || NOTE_VERSION_YDOC_PATTERN.test(name)) return { kind: "ydoc" };
  const blobMatch = BLOB_PATTERN.exec(name);
  if (blobMatch?.[1] !== undefined) return { kind: "blob", sha256: blobMatch[1] };
  return { kind: "skip" };
}

async function collectStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Opens an archive and reads every entry the restore needs. `passphrase` is
 * required for (and only used by) an `NXA1` container; a plain zip ignores
 * it. Every failure path below closes the file handle before throwing (a
 * leaked handle keeps the user's file locked on Windows) — the whole body
 * after the handle is opened runs inside one `try`, whose `catch` closes the
 * handle and rethrows, so there is exactly one place that has to get this
 * right.
 */
export async function openArchive(
  filePath: string,
  passphrase: string | null,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<OpenedArchive> {
  const handle = await open(filePath, "r");
  try {
    const { size: totalSize } = await handle.stat();
    if (totalSize < ARCHIVE_MAGIC.length) {
      throw new ArchiveReadError("not-an-archive", "File is too short to be a Nexus archive.");
    }

    const fileSource = createFileByteSource(handle, totalSize);
    const magic = Buffer.from(await fileSource.read(0, ARCHIVE_MAGIC.length)).toString("utf8");
    const encrypted = magic === ARCHIVE_MAGIC;

    let zipSource: ArchiveByteSource;
    if (encrypted) {
      if (passphrase === null) {
        throw new ArchiveReadError(
          "passphrase-required",
          "This archive is an encrypted NXA1 container; a passphrase is required to open it.",
        );
      }
      try {
        zipSource = await openArchivePlaintext(fileSource, async (header: ArchiveHeader) => {
          const salt = Buffer.from(header.salt, "base64");
          return deriveArchiveKey(passphrase, salt, header.kdf);
        });
      } catch (error) {
        if (error instanceof ArchiveDecryptError) {
          throw new ArchiveReadError("passphrase-wrong", "The passphrase does not open this archive.", {
            cause: error,
          });
        }
        if (error instanceof ArchiveFormatError) {
          throw new ArchiveReadError(
            "damaged",
            "This archive's encrypted container is structurally damaged.",
            { cause: error },
          );
        }
        throw error;
      }
    } else {
      zipSource = fileSource;
    }

    const reader = new ByteSourceRandomAccessReader(zipSource);
    let zipFile: ZipFile;
    try {
      zipFile = await fromRandomAccessReaderPromise(reader, zipSource.byteLength, {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      });
    } catch (error) {
      // Which of the two this is depends entirely on what we already know
      // about the file. For a PLAIN file, a destroyed end-of-central-directory
      // record and "this was never a zip" are the same observation — no
      // readable zip structure — so `"not-an-archive"` is the honest verdict.
      // For an ENCRYPTED one it is not: the `NXA1` magic parsed, the header
      // validated, and every frame authenticated under a key derived from the
      // passphrase the user typed. This is unambiguously our own archive, and
      // telling someone who supplied the correct passphrase that their file is
      // "not an archive" would be a lie about the one thing they just proved.
      throw new ArchiveReadError(
        encrypted ? "damaged" : "not-an-archive",
        encrypted
          ? "This archive decrypted, but the zip inside it is damaged."
          : "This file is neither an NXA1 container nor a readable zip.",
        { cause: error instanceof Error ? error : undefined },
      );
    }

    const files = new Map<string, string>();
    const ydocs = new Map<string, Uint8Array>();
    const blobNames = new Set<string>();
    const corruptBlobNames = new Set<string>();
    const blobEntries = new Map<string, Entry>();
    const seenNames = new Set<string>();

    let entryCount = 0;
    let totalBytes = 0;
    let residentBytes = 0;

    try {
      for await (const entry of zipFile.eachEntry()) {
        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          throw new ArchiveReadError("too-large", `Archive has more than ${limits.maxEntries} entries.`);
        }

        const classified = classifyEntryName(entry.fileName);
        // Not on the allowlist: a human-readable mirror, or anything a
        // hostile file added. Never opened — no stream, no size check, no
        // memory cost — regardless of what the entry claims about itself.
        if (classified.kind === "skip") continue;

        if (seenNames.has(entry.fileName)) {
          throw new ArchiveReadError(
            "damaged",
            `Archive contains more than one entry named "${entry.fileName}".`,
          );
        }
        seenNames.add(entry.fileName);

        const size = entry.uncompressedSize;
        if (size > limits.maxEntryBytes) {
          throw new ArchiveReadError(
            "too-large",
            `Entry "${entry.fileName}" (${size} bytes) exceeds the ${limits.maxEntryBytes}-byte per-entry cap.`,
          );
        }
        if (classified.kind === "blob" && size > limits.maxBlobBytes) {
          throw new ArchiveReadError(
            "too-large",
            `Blob "${entry.fileName}" (${size} bytes) exceeds the ${limits.maxBlobBytes}-byte blob cap.`,
          );
        }
        totalBytes += size;
        if (totalBytes > limits.maxTotalBytes) {
          throw new ArchiveReadError(
            "too-large",
            `Archive's opened entries exceed the ${limits.maxTotalBytes}-byte total cap.`,
          );
        }
        if (classified.kind === "text" || classified.kind === "ydoc") {
          residentBytes += size;
          if (residentBytes > limits.maxResidentBytes) {
            throw new ArchiveReadError(
              "too-large",
              `Archive's text/.ydoc entries exceed the ${limits.maxResidentBytes}-byte resident cap.`,
            );
          }
        }

        if (classified.kind === "text") {
          const stream = await zipFile.openReadStreamPromise(entry);
          files.set(entry.fileName, (await collectStream(stream)).toString("utf8"));
        } else if (classified.kind === "ydoc") {
          const stream = await zipFile.openReadStreamPromise(entry);
          const buffer = await collectStream(stream);
          ydocs.set(entry.fileName, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
        } else {
          // Streamed through a running hash and discarded — never retained —
          // so an archive with many blobs never holds more than one at a
          // time resident (see the module header).
          const stream = await zipFile.openReadStreamPromise(entry);
          const hash = createHash("sha256");
          for await (const chunk of stream) hash.update(chunk as Buffer);
          const digest = hash.digest("hex");
          blobEntries.set(classified.sha256, entry);
          if (digest === classified.sha256) {
            blobNames.add(classified.sha256);
          } else {
            corruptBlobNames.add(classified.sha256);
          }
        }
      }
    } catch (error) {
      if (error instanceof ArchiveReadError) throw error;
      throw new ArchiveReadError(
        "damaged",
        "An archive entry could not be read: the zip structure is invalid.",
        { cause: error instanceof Error ? error : undefined },
      );
    }

    let closed = false;
    return {
      encrypted,
      files,
      ydocs,
      blobNames,
      corruptBlobNames,
      async readBlob(sha256: string): Promise<Uint8Array> {
        if (closed) throw new Error("Cannot read a blob: this archive has been closed.");
        if (!blobNames.has(sha256)) {
          throw new Error(`No verified blob named "${sha256}" in this archive.`);
        }
        const entry = blobEntries.get(sha256);
        if (!entry) {
          throw new Error(`Internal error: blob "${sha256}" was verified but its entry cannot be found.`);
        }
        // Re-opened and re-hashed rather than cached from the walk above:
        // see the module header on why holding blob bytes between preview
        // and apply is exactly the memory blow-up this reader exists to
        // avoid — the re-hash is what keeps this second read as trustworthy
        // as the first.
        const stream = await zipFile.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        const hash = createHash("sha256");
        for await (const chunk of stream) {
          hash.update(chunk as Buffer);
          chunks.push(chunk as Buffer);
        }
        if (hash.digest("hex") !== sha256) {
          throw new Error(`Blob "${sha256}" no longer hashes to its own name.`);
        }
        const bytes = Buffer.concat(chunks);
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        zipFile.close();
        await handle.close();
      },
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}
