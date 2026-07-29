import { describe, expect, it } from "vitest";

import {
  ARCHIVE_SALT_BYTES,
  ArchiveDecryptError,
  ArchiveFormatError,
  createArchiveWriter,
  type ArchiveHeader,
  type ArchiveKdfParams,
} from "./archiveContainer.js";
import { openArchivePlaintext, type ArchiveByteSource } from "./archivePlaintext.js";

// Real Argon2id parameters are deliberately slow (ADR-022); every `deriveKey`
// in this file is `async () => key` (or a variant returning the WRONG key),
// so no test here ever runs Argon2id. `TEST_KDF` only needs to be recorded
// in the header, so it can be any in-bounds shape.
const TEST_KDF: ArchiveKdfParams = {
  algorithm: "argon2id",
  memoryKiB: 8192,
  iterations: 1,
  parallelism: 1,
};

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomKey(): Uint8Array {
  return randomBytes(32);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

interface BuiltContainer {
  /** The full container: header block + every framed (prefix + body) chunk, concatenated. */
  bytes: Uint8Array;
  headerBlock: Uint8Array;
  /** Each sealed frame's own bytes (prefix + body), in order — for tests that need to slice/tamper at a frame boundary. */
  frames: Uint8Array[];
  salt: Uint8Array;
}

/** Seals `plaintexts` in order under a fresh writer (real AES-256-GCM, no Argon2id), marking only the last one final. */
async function buildContainer(key: Uint8Array, plaintexts: Uint8Array[]): Promise<BuiltContainer> {
  const salt = randomBytes(ARCHIVE_SALT_BYTES);
  const writer = await createArchiveWriter({ key, salt, kdf: TEST_KDF });
  const frames: Uint8Array[] = [];
  const lastIndex = plaintexts.length - 1;
  let index = 0;
  for (const plaintext of plaintexts) {
    frames.push(await writer.seal(plaintext, index === lastIndex));
    index += 1;
  }
  const bytes = concatBytes([writer.headerBlock, ...frames]);
  return { bytes, headerBlock: writer.headerBlock, frames, salt };
}

/**
 * An `ArchiveByteSource` backed by an in-memory byte array. `read` always
 * returns a fresh COPY (`.slice()`), never a view into the backing array —
 * exactly what a real file read gives a caller, so nothing the reader does
 * with the bytes it is handed can reach back into the container. Every call
 * is recorded so tests can assert on caching behaviour.
 */
function memoryByteSource(bytes: Uint8Array): ArchiveByteSource & {
  readonly readCalls: ReadonlyArray<{ offset: number; length: number }>;
} {
  const readCalls: Array<{ offset: number; length: number }> = [];
  return {
    byteLength: bytes.length,
    readCalls,
    async read(offset: number, length: number): Promise<Uint8Array> {
      readCalls.push({ offset, length });
      if (offset < 0 || length < 0 || offset + length > bytes.length) {
        throw new RangeError(`memoryByteSource: out-of-bounds read(${offset}, ${length})`);
      }
      return bytes.slice(offset, offset + length);
    },
  };
}

const trivialDeriveKey =
  (key: Uint8Array) =>
  async (_header: ArchiveHeader): Promise<Uint8Array> =>
    key;

describe("openArchivePlaintext — round trip", () => {
  it("reads a multi-frame archive (two full, one partial final) back byte-for-byte", async () => {
    const key = randomKey();
    const chunkA = randomBytes(100);
    const chunkB = randomBytes(100);
    const chunkC = randomBytes(30);
    const { bytes } = await buildContainer(key, [chunkA, chunkB, chunkC]);
    const expected = concatBytes([chunkA, chunkB, chunkC]);

    const archive = await openArchivePlaintext(memoryByteSource(bytes), trivialDeriveKey(key));
    expect(archive.byteLength).toBe(expected.length);

    const readBack = await archive.read(0, archive.byteLength);
    expect(readBack).toEqual(expected);
  });

  it("recovers the header's chunkBytes, salt, and noncePrefix", async () => {
    const key = randomKey();
    const { bytes, salt } = await buildContainer(key, [randomBytes(10)]);

    const archive = await openArchivePlaintext(memoryByteSource(bytes), trivialDeriveKey(key));
    expect(archive.header.chunkBytes).toBeGreaterThan(0);
    expect(typeof archive.header.salt).toBe("string");
    expect(typeof archive.header.noncePrefix).toBe("string");

    const decodedSalt = new Uint8Array(
      Array.from(atob(archive.header.salt), (char) => char.charCodeAt(0)),
    );
    expect(decodedSalt).toEqual(salt);
  });

  it("opens an empty-payload archive (one final frame sealing zero bytes)", async () => {
    const key = randomKey();
    const { bytes } = await buildContainer(key, [new Uint8Array(0)]);

    const archive = await openArchivePlaintext(memoryByteSource(bytes), trivialDeriveKey(key));
    expect(archive.byteLength).toBe(0);
    expect(await archive.read(0, 0)).toEqual(new Uint8Array(0));
  });
});

describe("openArchivePlaintext — random access", () => {
  async function openThreeFrameArchive() {
    const key = randomKey();
    // Frame 0: [0, 100), frame 1: [100, 200), frame 2 (final): [200, 230).
    const chunkA = randomBytes(100);
    const chunkB = randomBytes(100);
    const chunkC = randomBytes(30);
    const { bytes } = await buildContainer(key, [chunkA, chunkB, chunkC]);
    const expected = concatBytes([chunkA, chunkB, chunkC]);
    const archive = await openArchivePlaintext(memoryByteSource(bytes), trivialDeriveKey(key));
    return { archive, expected };
  }

  it("reads a range entirely inside one frame", async () => {
    const { archive, expected } = await openThreeFrameArchive();
    const got = await archive.read(10, 20);
    expect(got).toEqual(expected.subarray(10, 30));
  });

  it("reads a range spanning a frame boundary", async () => {
    const { archive, expected } = await openThreeFrameArchive();
    const got = await archive.read(90, 40); // spans frame 0/1 boundary at 100
    expect(got).toEqual(expected.subarray(90, 130));
  });

  it("reads a range spanning three frames", async () => {
    const { archive, expected } = await openThreeFrameArchive();
    const got = await archive.read(50, 170); // frame 0 through frame 2
    expect(got).toEqual(expected.subarray(50, 220));
  });

  it("reads at the very start and the very end of the payload", async () => {
    const { archive, expected } = await openThreeFrameArchive();
    expect(await archive.read(0, 5)).toEqual(expected.subarray(0, 5));
    expect(await archive.read(archive.byteLength - 5, 5)).toEqual(expected.subarray(-5));
  });

  it("reading the same range twice returns equal bytes", async () => {
    const { archive, expected } = await openThreeFrameArchive();
    const first = await archive.read(120, 15);
    const second = await archive.read(120, 15);
    expect(first).toEqual(expected.subarray(120, 135));
    expect(second).toEqual(expected.subarray(120, 135));
  });

  it("serves reads issued out of order (end, then middle, then start)", async () => {
    const { archive, expected } = await openThreeFrameArchive();
    const end = await archive.read(210, 20);
    const middle = await archive.read(95, 30);
    const start = await archive.read(0, 10);

    expect(end).toEqual(expected.subarray(210, 230));
    expect(middle).toEqual(expected.subarray(95, 125));
    expect(start).toEqual(expected.subarray(0, 10));
  });
});

describe("openArchivePlaintext — frame cache", () => {
  it("many small sequential reads inside one frame issue no additional frame-body reads", async () => {
    const key = randomKey();
    const chunkA = randomBytes(100);
    const chunkB = randomBytes(100);
    const chunkC = randomBytes(30);
    const { bytes } = await buildContainer(key, [chunkA, chunkB, chunkC]);
    const source = memoryByteSource(bytes);
    const archive = await openArchivePlaintext(source, trivialDeriveKey(key));

    const baseline = source.readCalls.length;
    await archive.read(0, 10); // frame 0: cache miss, +1 read
    await archive.read(20, 10); // still frame 0: cache hit, +0
    await archive.read(50, 5); // still frame 0: cache hit, +0
    await archive.read(90, 10); // still frame 0: cache hit, +0

    expect(source.readCalls.length - baseline).toBe(1);
  });

  it("moving to another frame and back re-reads (one frame cached, not two)", async () => {
    const key = randomKey();
    const chunkA = randomBytes(100);
    const chunkB = randomBytes(100);
    const chunkC = randomBytes(30);
    const { bytes } = await buildContainer(key, [chunkA, chunkB, chunkC]);
    const source = memoryByteSource(bytes);
    const archive = await openArchivePlaintext(source, trivialDeriveKey(key));

    const baseline = source.readCalls.length;
    await archive.read(0, 10); // frame 0: cache miss, +1
    await archive.read(150, 10); // frame 1: cache miss (evicts frame 0), +1
    await archive.read(0, 10); // frame 0 again: cache miss (evicts frame 1), +1

    expect(source.readCalls.length - baseline).toBe(3);
  });
});

describe("openArchivePlaintext — argument validation", () => {
  async function openSingleFrameArchive() {
    const key = randomKey();
    const { bytes } = await buildContainer(key, [randomBytes(20)]);
    return openArchivePlaintext(memoryByteSource(bytes), trivialDeriveKey(key));
  }

  it("throws RangeError for a negative offset", async () => {
    const archive = await openSingleFrameArchive();
    await expect(archive.read(-1, 5)).rejects.toThrow(RangeError);
  });

  it("throws RangeError for a negative length", async () => {
    const archive = await openSingleFrameArchive();
    await expect(archive.read(0, -5)).rejects.toThrow(RangeError);
  });

  it("throws RangeError for a non-integer offset or length", async () => {
    const archive = await openSingleFrameArchive();
    await expect(archive.read(0.5, 5)).rejects.toThrow(RangeError);
    await expect(archive.read(0, 5.5)).rejects.toThrow(RangeError);
  });

  it("throws RangeError when offset + length exceeds byteLength", async () => {
    const archive = await openSingleFrameArchive();
    await expect(archive.read(archive.byteLength - 2, 5)).rejects.toThrow(RangeError);
  });

  it("allows read(byteLength, 0) at the exact end", async () => {
    const archive = await openSingleFrameArchive();
    expect(await archive.read(archive.byteLength, 0)).toEqual(new Uint8Array(0));
  });
});

describe("openArchivePlaintext — hostile or damaged containers", () => {
  it("throws ArchiveDecryptError from openArchivePlaintext itself for the wrong key", async () => {
    const key = randomKey();
    const { bytes } = await buildContainer(key, [randomBytes(20)]);

    await expect(
      openArchivePlaintext(memoryByteSource(bytes), trivialDeriveKey(randomKey())),
    ).rejects.toThrow(ArchiveDecryptError);
  });

  it("throws ArchiveFormatError when a frame body is truncated mid-body", async () => {
    const key = randomKey();
    const { headerBlock, frames } = await buildContainer(key, [randomBytes(50), randomBytes(20)]);
    const [frameZero] = frames;
    if (!frameZero) throw new Error("test setup: expected a frame");

    // Keep the header, all of frame 0's 4-byte prefix, but only part of its body.
    const truncated = concatBytes([headerBlock, frameZero.subarray(0, 4 + 30)]);

    await expect(
      openArchivePlaintext(memoryByteSource(truncated), trivialDeriveKey(key)),
    ).rejects.toThrow(ArchiveFormatError);
  });

  it("throws ArchiveFormatError when a frame prefix itself is cut in half", async () => {
    const key = randomKey();
    const { headerBlock, frames } = await buildContainer(key, [randomBytes(50), randomBytes(20)]);
    const [frameZero, frameOne] = frames;
    if (!frameZero || !frameOne) throw new Error("test setup: expected two frames");

    // Keep frame 0 whole, then only 2 of frame 1's 4 prefix bytes.
    const truncated = concatBytes([headerBlock, frameZero, frameOne.subarray(0, 2)]);

    await expect(
      openArchivePlaintext(memoryByteSource(truncated), trivialDeriveKey(key)),
    ).rejects.toThrow(ArchiveFormatError);
  });

  it("throws ArchiveFormatError when the final frame is chopped off entirely", async () => {
    const key = randomKey();
    const { headerBlock, frames } = await buildContainer(key, [randomBytes(50), randomBytes(20)]);
    const [frameZero] = frames;
    if (!frameZero) throw new Error("test setup: expected a frame");

    // Container ends cleanly right after frame 0's body — no frame ever claims FINAL.
    const truncated = concatBytes([headerBlock, frameZero]);

    await expect(
      openArchivePlaintext(memoryByteSource(truncated), trivialDeriveKey(key)),
    ).rejects.toThrow(ArchiveFormatError);
  });

  it("throws ArchiveFormatError for extra trailing bytes appended after the final frame", async () => {
    const key = randomKey();
    const { bytes } = await buildContainer(key, [randomBytes(20)]);
    const withTrailingGarbage = concatBytes([bytes, randomBytes(8)]);

    await expect(
      openArchivePlaintext(memoryByteSource(withTrailingGarbage), trivialDeriveKey(key)),
    ).rejects.toThrow(ArchiveFormatError);
  });

  it("throws ArchiveFormatError for a container with more than MAX_FRAMES frames (no crypto, stays fast)", async () => {
    const key = randomKey();
    // A real header block (via a real writer), followed by 65_537 synthetic,
    // never-decrypted frames: a 4-byte prefix (bodyLength = 16, final = false)
    // plus 16 zero bytes each. The scan must reject this before ever calling
    // into WebCrypto, so building 65_537 of these stays fast.
    //
    // The LAST frame carries the FINAL flag, and the container ends exactly
    // where it does. Without that, this file would be refused for running out
    // of bytes and the test would pass against an implementation that has no
    // frame cap at all — it would enshrine the hole instead of closing it.
    // With it, the only thing left to reject the file is the cap itself, which
    // is why the assertion below pins the message and not just the class.
    const salt = randomBytes(ARCHIVE_SALT_BYTES);
    const writer = await createArchiveWriter({ key, salt, kdf: TEST_KDF });

    const frameCount = 65_537;
    const frameBytes = 4 + 16;
    const frames = new Uint8Array(frameCount * frameBytes);
    const view = new DataView(frames.buffer);
    for (let i = 0; i < frameCount; i++) {
      const final = i === frameCount - 1 ? 0x8000_0000 : 0;
      view.setUint32(i * frameBytes, 16 | final, false); // bodyLength = 16
      // the 16 body bytes are already zero-initialized
    }
    const bytes = concatBytes([writer.headerBlock, frames]);

    await expect(
      openArchivePlaintext(memoryByteSource(bytes), trivialDeriveKey(key)),
    ).rejects.toThrow(/more than 65536 frames/);
  });

  it("refuses a structurally broken container BEFORE deriving the key", async () => {
    // The scan runs before `deriveKey` on purpose (see `openArchivePlaintext`):
    // Argon2id at a real archive's declared cost blocks for about a second, and
    // a file that can never be opened should not cost the user that first. A
    // `deriveKey` that fails the test if it is ever called is the only way to
    // state that ordering as a property rather than as a comment.
    const key = randomKey();
    const { bytes } = await buildContainer(key, [randomBytes(20)]);
    let derived = false;

    await expect(
      openArchivePlaintext(memoryByteSource(concatBytes([bytes, randomBytes(8)])), async () => {
        derived = true;
        return key;
      }),
    ).rejects.toThrow(ArchiveFormatError);
    expect(derived).toBe(false);
  });

  it("throws ArchiveFormatError for a file too short to hold a header at all", async () => {
    // What a user picking the wrong file (or an empty one) actually lands on.
    await expect(
      openArchivePlaintext(memoryByteSource(new Uint8Array(0)), trivialDeriveKey(randomKey())),
    ).rejects.toThrow(ArchiveFormatError);
  });

  it("surfaces a flipped body byte in a non-final frame as ArchiveDecryptError from read, not from open", async () => {
    const key = randomKey();
    const { headerBlock, frames } = await buildContainer(key, [
      randomBytes(50),
      randomBytes(50),
      randomBytes(20),
    ]);
    const [frameZero, frameOne, frameTwo] = frames;
    if (!frameZero || !frameOne || !frameTwo) throw new Error("test setup: expected three frames");

    const tamperedFrameZero = new Uint8Array(frameZero);
    const lastByteIndex = tamperedFrameZero.length - 1;
    tamperedFrameZero[lastByteIndex] = (tamperedFrameZero[lastByteIndex]! + 1) & 0xff;

    const tampered = concatBytes([headerBlock, tamperedFrameZero, frameOne, frameTwo]);

    // Lazy decryption is the point: opening must succeed even though frame 0
    // (not the final frame) is corrupt, because only the final frame is
    // authenticated eagerly.
    const archive = await openArchivePlaintext(memoryByteSource(tampered), trivialDeriveKey(key));

    await expect(archive.read(0, 10)).rejects.toThrow(ArchiveDecryptError);
  });
});
