/**
 * A random-access reader over an `NXA1` container's decrypted payload — see
 * `archiveContainer.ts` for the container format itself (header block, frame
 * layout, AAD, nonce discipline). This module exists because the payload is
 * a `.nexus.zip` byte stream that the next IMEX slice reads back with
 * `yauzl`, and `yauzl` is not a streaming unzip: it seeks to the end of the
 * file for the central directory, then seeks to each entry it opens.
 * `archiveContainer.ts`'s `ArchiveReader` is purely sequential and cannot
 * serve that access pattern, and the two obvious workarounds are both
 * unusable — decrypting the whole zip into memory up front defeats the
 * entire reason the archive is framed (attachments are capped at 50 MB each
 * and an archive may hold many), and writing the decrypted zip to a temp
 * file puts plaintext on disk, which this codebase's security baseline
 * forbids.
 *
 * Independently sealed frames make random access cheap: `openArchivePlaintext`
 * scans the length-prefixed frame headers once — never decrypting a body
 * during the scan — to build an in-memory table of frame offsets, then
 * `read` decrypts on demand only the one frame a given range actually
 * touches. Exactly one decrypted frame is kept resident at a time: that is
 * both the memory bound this whole design exists to hold, and a reasonable
 * bet on access pattern, since `yauzl` issues many small reads that
 * overwhelmingly land inside the same 1 MiB frame — re-running AES-GCM over
 * a megabyte for every few-byte read would be wasteful for no benefit.
 *
 * `deriveKey` is injected, exactly like `buildExportArchive`/
 * `parseImportArchive` inject `hash`: this module must never import from
 * `../auth/` (directly or transitively), because `auth/keyChain.ts` pulls in
 * `hash-wasm`'s Argon2id WASM, and this file is reachable from the `.` barrel
 * that the renderer imports for ordinary, non-lock-screen UI — pulling
 * Argon2id's WASM into that bundle would defeat the whole reason
 * `auth/keyChain.ts` lives behind its own `./auth` subpath. The caller (the
 * Electron main process) reads `header.kdf` and `header.salt` off the header
 * this module hands it and runs Argon2id itself.
 *
 * Completeness is a structural-scan-plus-authentication combination, not
 * either alone. The scan only trusts, structurally, that the last frame in
 * its table claims the FINAL flag and that the container ends exactly where
 * that frame's body ends — a hostile file can set that bit anywhere it
 * likes, so this alone is not a guarantee. `openArchivePlaintext` therefore
 * eagerly opens that last frame through `ArchiveReader.openFrameAt` before
 * ever returning, which authenticates the FINAL claim under AEAD (closing
 * the truncation hole the structural scan cannot close on its own) and, as
 * a side effect that costs nothing extra, verifies `deriveKey`'s key
 * immediately — so a wrong passphrase fails at `openArchivePlaintext` itself,
 * loudly and immediately, instead of surfacing as a baffling zip-parse error
 * several layers up once garbage bytes reach `yauzl`.
 */

import {
  ARCHIVE_MAX_HEADER_BLOCK_BYTES,
  ARCHIVE_TAG_BYTES,
  ArchiveFormatError,
  createArchiveReader,
  parseArchiveHeader,
  parseFramePrefix,
  type ArchiveHeader,
} from "./archiveContainer.js";

/**
 * The hard ceiling on how many frames a scan will index. A real writer seals
 * `ARCHIVE_CHUNK_BYTES` (1 MiB) of plaintext per non-final frame, so this
 * many frames is 64 GiB of payload — far beyond anything a legitimate
 * archive would ever need, and therefore never a bound that refuses one. A
 * hostile file, on the other hand, can make frames as small as 20 bytes (a
 * 4-byte prefix plus a bare 16-byte tag), and without this cap a small file
 * could force the scan to build a table with millions of entries.
 */
const MAX_FRAMES = 65_536;

/**
 * A random-access source of bytes: the container file itself. Injected so
 * this module never opens a file handle (or imports `node:fs`) on its own —
 * the caller owns the file and whatever platform-specific IO it takes to
 * read from it.
 */
export interface ArchiveByteSource {
  /** Total length of the container in bytes. */
  readonly byteLength: number;
  /** Resolves EXACTLY `length` bytes starting at `offset`, or rejects. Never a short read. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * A random-access view of an `NXA1` container's decrypted payload — the
 * `.nexus.zip` byte stream — with only one frame's plaintext ever resident.
 */
export interface ArchivePlaintext {
  /** The container's parsed cleartext header. */
  readonly header: ArchiveHeader;
  /** Total decrypted payload length in bytes. */
  readonly byteLength: number;
  /** Resolves exactly `length` plaintext bytes at plaintext `offset`, decrypting only the frames that range touches. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** One frame's position, both in the container (ciphertext) and in the decrypted payload (plaintext), as recorded by the frame-table scan. */
interface FrameTableEntry {
  /** Byte offset of this frame's body (after its 4-byte prefix) within the container. */
  readonly bodyOffset: number;
  /** This frame's ciphertext-plus-tag length, as declared by its prefix. */
  readonly bodyLength: number;
  /** Byte offset of this frame's plaintext within the decrypted payload. */
  readonly plaintextOffset: number;
  /** `bodyLength - ARCHIVE_TAG_BYTES`. */
  readonly plaintextLength: number;
  readonly final: boolean;
}

/** Largest index `i` in `frames` with `frames[i].plaintextOffset <= offset`. Binary search: `yauzl` issues many small reads, and a linear scan would be O(frame count) per read. */
function findFrameIndex(frames: readonly FrameTableEntry[], offset: number): number {
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >>> 1; // bias toward high: low must stay a valid answer if the loop stops here
    const candidate = frames[mid];
    if (candidate && candidate.plaintextOffset <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

export async function openArchivePlaintext(
  source: ArchiveByteSource,
  deriveKey: (header: ArchiveHeader) => Promise<Uint8Array>,
): Promise<ArchivePlaintext> {
  const headerReadLength = Math.min(ARCHIVE_MAX_HEADER_BLOCK_BYTES, source.byteLength);
  const headerBytes = await source.read(0, headerReadLength);
  const { header, blockLength } = await parseArchiveHeader(headerBytes);
  // parseArchiveHeader already guarantees headerBytes.length >= blockLength
  // (it throws ArchiveFormatError otherwise), so this slice is always in bounds.
  const headerBlock = headerBytes.subarray(0, blockLength);

  // --- Scan the frame table: length prefixes only, never a body's plaintext. ---
  //
  // Deliberately BEFORE `deriveKey`. Argon2id at the cost this archive itself
  // declares is by far the most expensive thing in this function (ADR-022
  // sizes an archive's KDF at 128 MiB / t=4, roughly a second of blocked CPU),
  // while this scan is a handful of four-byte reads. Running it first means a
  // truncated, trailing-byte-laden or absurdly fragmented container is refused
  // straight away instead of after the caller has already paid the KDF — the
  // same "reject a hostile file cheaply, before any crypto" discipline
  // `validateKdfParams` applies one layer up, at the header.
  const frames: FrameTableEntry[] = [];
  let containerOffset = blockLength;
  let plaintextOffset = 0;
  for (;;) {
    if (frames.length >= MAX_FRAMES) {
      throw new ArchiveFormatError(
        `Archive declares more than ${MAX_FRAMES} frames — refusing to index a container this fragmented.`,
      );
    }
    if (source.byteLength - containerOffset < 4) {
      throw new ArchiveFormatError(
        "Container ended mid-frame: not enough bytes remain for a frame prefix, and no final frame was ever reached.",
      );
    }
    const prefixBytes = await source.read(containerOffset, 4);
    const { bodyLength, final } = parseFramePrefix(prefixBytes);
    const bodyOffset = containerOffset + 4;
    if (bodyOffset + bodyLength > source.byteLength) {
      throw new ArchiveFormatError(
        `Frame at offset ${containerOffset} declares a body of ${bodyLength} bytes, which overruns the container (only ${source.byteLength - bodyOffset} bytes available).`,
      );
    }

    const plaintextLength = bodyLength - ARCHIVE_TAG_BYTES;
    frames.push({ bodyOffset, bodyLength, plaintextOffset, plaintextLength, final });
    plaintextOffset += plaintextLength;
    containerOffset = bodyOffset + bodyLength;
    if (final) break;
  }

  if (containerOffset !== source.byteLength) {
    throw new ArchiveFormatError(
      `Container has ${source.byteLength - containerOffset} trailing byte(s) past its final frame.`,
    );
  }

  const key = await deriveKey(header);
  const reader = await createArchiveReader(key, headerBlock);

  const lastFrame = frames[frames.length - 1];
  if (!lastFrame) {
    // Structurally unreachable: the loop above always pushes at least one
    // frame before it can ever `break`. Guarded only to satisfy
    // `noUncheckedIndexedAccess`.
    throw new ArchiveFormatError("Archive contains no frames.");
  }
  const byteLength = lastFrame.plaintextOffset + lastFrame.plaintextLength;

  // --- One-frame cache: the memory bound this whole module exists to hold. ---
  let cachedIndex = -1;
  let cachedPlaintext: Uint8Array | null = null;

  async function decryptFrame(index: number): Promise<Uint8Array> {
    if (cachedIndex === index && cachedPlaintext) return cachedPlaintext;
    const frame = frames[index];
    if (!frame) {
      throw new Error(`Internal error: no frame table entry at index ${index}.`);
    }
    const body = await source.read(frame.bodyOffset, frame.bodyLength);
    const plaintext = await reader.openFrameAt(index, body, frame.final);
    if (plaintext.length !== frame.plaintextLength) {
      // GCM guarantees this in practice; a mismatch would mean the frame
      // table itself is wrong, and staying silent would corrupt every
      // subsequent offset computed from it.
      throw new Error(
        `Frame ${index} decrypted to ${plaintext.length} bytes but the frame table declared ${frame.plaintextLength} — the table is corrupt.`,
      );
    }
    cachedIndex = index;
    cachedPlaintext = plaintext;
    return plaintext;
  }

  // Authenticates the FINAL flag the scan only trusted structurally, and
  // verifies deriveKey's key immediately — see the file header. Cached, so
  // a caller whose first `read` touches the final frame pays for this once.
  await decryptFrame(frames.length - 1);

  return {
    header,
    byteLength,
    async read(offset: number, length: number): Promise<Uint8Array> {
      if (
        !Number.isInteger(offset) ||
        !Number.isInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > byteLength
      ) {
        throw new RangeError(
          `read(${offset}, ${length}) is out of bounds for a ${byteLength}-byte plaintext.`,
        );
      }
      if (length === 0) return new Uint8Array(0);

      const out = new Uint8Array(length);
      let filled = 0;
      let frameIndex = findFrameIndex(frames, offset);
      while (filled < length) {
        const frame = frames[frameIndex];
        if (!frame) {
          throw new Error(`Internal error: no frame table entry at index ${frameIndex}.`);
        }
        const plaintext = await decryptFrame(frameIndex);
        const startInFrame = offset + filled - frame.plaintextOffset;
        const available = frame.plaintextLength - startInFrame;
        const take = Math.min(available, length - filled);
        out.set(plaintext.subarray(startInFrame, startInFrame + take), filled);
        filled += take;
        frameIndex += 1;
      }
      return out;
    },
  };
}
