import { describe, expect, it } from "vitest";
import {
  ARCHIVE_CHUNK_BYTES,
  ARCHIVE_MAGIC,
  ARCHIVE_NONCE_PREFIX_BYTES,
  ARCHIVE_SALT_BYTES,
  ArchiveDecryptError,
  ArchiveFormatError,
  createArchiveReader,
  createArchiveWriter,
  parseArchiveHeader,
  parseFramePrefix,
  type ArchiveKdfParams,
} from "./archiveContainer.js";

// Real Argon2id parameters are deliberately slow (ADR-022); every test here
// supplies the writer with a header directly (or drives a writer whose `kdf`
// field is only ever recorded, never actually run through Argon2id — the
// writer/reader pair in this module take an already-derived key), so no test
// pays Argon2id's cost at all. `TEST_KDF` only needs to be *recorded* in the
// header, so it can be any in-bounds shape.
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

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Concatenates byte arrays — a small helper since this package has no `Buffer.concat`. */
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

/** One writer session's output: the header block, plus every framed (prefix + body) chunk it sealed, in order. */
interface BuiltContainer {
  headerBlock: Uint8Array;
  frames: Uint8Array[];
}

/** Seals `plaintexts` in order under a fresh writer, marking only the last one final. */
async function buildContainer(
  key: Uint8Array,
  salt: Uint8Array,
  plaintexts: Uint8Array[],
): Promise<BuiltContainer> {
  const writer = await createArchiveWriter({ key, salt, kdf: TEST_KDF });
  const frames: Uint8Array[] = [];
  const lastIndex = plaintexts.length - 1;
  let index = 0;
  for (const plaintext of plaintexts) {
    frames.push(await writer.seal(plaintext, index === lastIndex));
    index += 1;
  }
  return { headerBlock: writer.headerBlock, frames };
}

function concatFrames(headerBlock: Uint8Array, frames: Uint8Array[]): Uint8Array {
  return concatBytes([headerBlock, ...frames]);
}

/**
 * Walks a whole in-memory NXA1 container end to end and returns the
 * concatenated plaintext. Lives only in the test file on purpose — the real
 * reader is built to process one frame at a time from an unbounded stream,
 * and a whole-buffer decrypt helper in the implementation itself would be a
 * footgun in production, where "read it all into memory first" is exactly
 * what framing exists to avoid.
 */
async function readWholeContainer(key: Uint8Array, container: Uint8Array): Promise<Uint8Array> {
  const { blockLength } = await parseArchiveHeader(container);
  const reader = await createArchiveReader(key, container.subarray(0, blockLength));
  const chunks: Uint8Array[] = [];
  let offset = blockLength;
  for (;;) {
    const prefix = container.subarray(offset, offset + 4);
    const { bodyLength, final } = parseFramePrefix(prefix);
    const body = container.subarray(offset + 4, offset + 4 + bodyLength);
    chunks.push(await reader.openFrame(body, final));
    offset += 4 + bodyLength;
    if (final) break;
  }
  reader.assertComplete();
  return concatBytes(chunks);
}

/** A syntactically valid, in-bounds header — the baseline every "reject one bad field" test mutates. */
function validHeaderFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: "nexus-archive",
    version: 1,
    cipher: "AES-256-GCM",
    kdf: { algorithm: "argon2id", memoryKiB: 8192, iterations: 1, parallelism: 1 },
    salt: encodeBase64(randomBytes(ARCHIVE_SALT_BYTES)),
    noncePrefix: encodeBase64(randomBytes(ARCHIVE_NONCE_PREFIX_BYTES)),
    chunkBytes: 1_048_576,
    ...overrides,
  };
}

function buildRawHeaderBlock(headerJson: string): Uint8Array {
  const magic = new TextEncoder().encode(ARCHIVE_MAGIC);
  const jsonBytes = new TextEncoder().encode(headerJson);
  const block = new Uint8Array(magic.length + 4 + jsonBytes.length);
  block.set(magic, 0);
  new DataView(block.buffer).setUint32(magic.length, jsonBytes.length, false);
  block.set(jsonBytes, magic.length + 4);
  return block;
}

/**
 * Flips one digit inside the header's `chunkBytes` number, keeping the JSON
 * syntactically valid and the header block's byte length identical — so this
 * exercises "header content changed" in isolation, without also exercising
 * "header is malformed" (which `parseArchiveHeader` would reject before a
 * reader ever gets built).
 */
function tamperHeaderBlock(headerBlock: Uint8Array): Uint8Array {
  const headerJsonStart = 8; // magic (4) + headerLength (4)
  const headerJson = new TextDecoder().decode(headerBlock.subarray(headerJsonStart));
  const marker = '"chunkBytes":';
  const markerIndex = headerJson.indexOf(marker);
  if (markerIndex === -1) throw new Error("test setup: chunkBytes not found in header JSON");
  const digitIndex = markerIndex + marker.length;
  const originalDigit = headerJson[digitIndex];
  if (!originalDigit) throw new Error("test setup: expected a digit after chunkBytes:");
  const replacementDigit = originalDigit === "9" ? "8" : "9";
  const tamperedJson =
    headerJson.slice(0, digitIndex) + replacementDigit + headerJson.slice(digitIndex + 1);
  const tamperedJsonBytes = new TextEncoder().encode(tamperedJson);

  const tampered = new Uint8Array(headerBlock.length);
  tampered.set(headerBlock.subarray(0, headerJsonStart), 0);
  tampered.set(tamperedJsonBytes, headerJsonStart);
  return tampered;
}

describe("round trip", () => {
  it("writes a header + three frames (two full, one final) and reads back the original bytes", async () => {
    const key = randomKey();
    const salt = randomBytes(ARCHIVE_SALT_BYTES);
    const chunkA = new TextEncoder().encode("first chunk of plaintext data");
    const chunkB = new TextEncoder().encode("second chunk, still not final");
    const chunkC = new TextEncoder().encode("the final chunk");

    const { headerBlock, frames } = await buildContainer(key, salt, [chunkA, chunkB, chunkC]);
    const container = concatFrames(headerBlock, frames);

    const plaintext = await readWholeContainer(key, container);
    expect(plaintext).toEqual(concatBytes([chunkA, chunkB, chunkC]));
  });

  it("an empty payload still produces exactly one final frame, and round-trips to zero bytes", async () => {
    const key = randomKey();
    const salt = randomBytes(ARCHIVE_SALT_BYTES);

    const { headerBlock, frames } = await buildContainer(key, salt, [new Uint8Array(0)]);
    expect(frames).toHaveLength(1);

    const container = concatFrames(headerBlock, frames);
    const plaintext = await readWholeContainer(key, container);
    expect(plaintext).toHaveLength(0);
  });

  it("round-trips the header block: salt, noncePrefix, kdf, chunkBytes, and blockLength are recovered", async () => {
    const key = randomKey();
    const salt = randomBytes(ARCHIVE_SALT_BYTES);
    const { headerBlock, frames } = await buildContainer(key, salt, [new Uint8Array(0)]);

    const { header, blockLength } = await parseArchiveHeader(headerBlock);
    expect(header.kdf).toEqual(TEST_KDF);
    expect(header.chunkBytes).toBe(ARCHIVE_CHUNK_BYTES);
    expect(blockLength).toBe(headerBlock.length);

    const decodedSalt = new Uint8Array(
      Array.from(atob(header.salt), (char) => char.charCodeAt(0)),
    );
    expect(decodedSalt).toEqual(salt);

    // blockLength is the true offset of the first frame in a full container.
    const container = concatFrames(headerBlock, frames);
    const parsedFromFullContainer = await parseArchiveHeader(container);
    expect(parsedFromFullContainer.blockLength).toBe(headerBlock.length);
  });

  it("two frames with identical plaintext produce different ciphertext bodies (the nonce never repeats)", async () => {
    const key = randomKey();
    const salt = randomBytes(ARCHIVE_SALT_BYTES);
    const plaintext = new TextEncoder().encode("same plaintext, twice");

    const { headerBlock, frames } = await buildContainer(key, salt, [plaintext, plaintext]);
    const [frameA, frameB] = frames;
    if (!frameA || !frameB) throw new Error("test setup: expected two frames");

    // Compare only the ciphertext bodies (skip the 4-byte prefix, which also
    // differs here because the second frame carries the final flag).
    expect(frameA.subarray(4)).not.toEqual(frameB.subarray(4));

    // Both still decrypt correctly despite the identical plaintext, proving
    // the frame-index-derived nonce (not the plaintext) is what varied.
    const container = concatFrames(headerBlock, frames);
    const decoded = await readWholeContainer(key, container);
    expect(decoded).toEqual(concatBytes([plaintext, plaintext]));
  });
});

describe("tamper detection", () => {
  it("throws ArchiveDecryptError for the wrong key", async () => {
    const salt = randomBytes(ARCHIVE_SALT_BYTES);
    const { headerBlock, frames } = await buildContainer(randomKey(), salt, [
      new TextEncoder().encode("secret"),
    ]);
    const container = concatFrames(headerBlock, frames);

    await expect(readWholeContainer(randomKey(), container)).rejects.toThrow(ArchiveDecryptError);
  });

  it("throws ArchiveDecryptError when the final frame is missing (truncation)", async () => {
    const key = randomKey();
    const salt = randomBytes(ARCHIVE_SALT_BYTES);
    const { headerBlock, frames } = await buildContainer(key, salt, [
      new TextEncoder().encode("frame zero"),
      new TextEncoder().encode("frame one"),
      new TextEncoder().encode("frame two, the final one"),
    ]);

    const reader = await createArchiveReader(key, headerBlock);
    for (const frame of frames.slice(0, -1)) {
      const { bodyLength, final } = parseFramePrefix(frame.subarray(0, 4));
      await reader.openFrame(frame.subarray(4, 4 + bodyLength), final);
    }

    expect(() => reader.assertComplete()).toThrow(ArchiveDecryptError);
  });

  it("throws ArchiveDecryptError when frames are fed out of order", async () => {
    const key = randomKey();
    const salt = randomBytes(ARCHIVE_SALT_BYTES);
    const { headerBlock, frames } = await buildContainer(key, salt, [
      new TextEncoder().encode("frame zero"),
      new TextEncoder().encode("frame one, sealed as the final frame"),
    ]);
    const [, secondFrame] = frames;
    if (!secondFrame) throw new Error("test setup: expected a second frame");
    const { bodyLength, final } = parseFramePrefix(secondFrame.subarray(0, 4));

    const reader = await createArchiveReader(key, headerBlock);
    await expect(
      reader.openFrame(secondFrame.subarray(4, 4 + bodyLength), final),
    ).rejects.toThrow(ArchiveDecryptError);
  });

  it("throws ArchiveDecryptError when the final bit is flipped on a non-final frame", async () => {
    const key = randomKey();
    const salt = randomBytes(ARCHIVE_SALT_BYTES);
    const { headerBlock, frames } = await buildContainer(key, salt, [
      new TextEncoder().encode("not the final frame"),
      new TextEncoder().encode("the actual final frame"),
    ]);
    const [firstFrame] = frames;
    if (!firstFrame) throw new Error("test setup: expected a first frame");
    const { bodyLength } = parseFramePrefix(firstFrame.subarray(0, 4));

    const reader = await createArchiveReader(key, headerBlock);
    // Feed frame 0's real ciphertext but claim final=true — the value the
    // caller would have read had the prefix's high bit been flipped. This
    // must not authenticate: the finalFlag is bound into the AAD the frame
    // was actually sealed under.
    await expect(reader.openFrame(firstFrame.subarray(4, 4 + bodyLength), true)).rejects.toThrow(
      ArchiveDecryptError,
    );
  });

  it("throws ArchiveDecryptError for a frame fed after the final frame", async () => {
    const key = randomKey();
    const salt = randomBytes(ARCHIVE_SALT_BYTES);
    const { headerBlock, frames } = await buildContainer(key, salt, [
      new TextEncoder().encode("the only frame, sealed as final"),
    ]);
    const [frame] = frames;
    if (!frame) throw new Error("test setup: expected a frame");
    const { bodyLength, final } = parseFramePrefix(frame.subarray(0, 4));

    const reader = await createArchiveReader(key, headerBlock);
    await reader.openFrame(frame.subarray(4, 4 + bodyLength), final);

    // Whatever follows a final frame is never payload — even re-feeding the
    // archive's own valid frame must be refused rather than decrypted again.
    await expect(reader.openFrame(frame.subarray(4, 4 + bodyLength), final)).rejects.toThrow(
      ArchiveDecryptError,
    );
  });

  it("throws ArchiveDecryptError for a frame spliced from a different archive (same key, different header)", async () => {
    const key = randomKey();
    const containerA = await buildContainer(key, randomBytes(ARCHIVE_SALT_BYTES), [
      new TextEncoder().encode("hello"),
    ]);
    const containerB = await buildContainer(key, randomBytes(ARCHIVE_SALT_BYTES), [
      new TextEncoder().encode("hello"),
    ]);

    const [frameFromA] = containerA.frames;
    if (!frameFromA) throw new Error("test setup: expected a frame");
    const { bodyLength, final } = parseFramePrefix(frameFromA.subarray(0, 4));

    const readerForB = await createArchiveReader(key, containerB.headerBlock);
    await expect(
      readerForB.openFrame(frameFromA.subarray(4, 4 + bodyLength), final),
    ).rejects.toThrow(ArchiveDecryptError);
  });

  it("throws ArchiveDecryptError for every frame once a header byte is tampered with (same length)", async () => {
    const key = randomKey();
    const salt = randomBytes(ARCHIVE_SALT_BYTES);
    const { headerBlock, frames } = await buildContainer(key, salt, [
      new TextEncoder().encode("payload"),
    ]);

    const tampered = tamperHeaderBlock(headerBlock);
    expect(tampered).toHaveLength(headerBlock.length);
    expect(tampered).not.toEqual(headerBlock);

    const reader = await createArchiveReader(key, tampered);
    const [frame] = frames;
    if (!frame) throw new Error("test setup: expected a frame");
    const { bodyLength, final } = parseFramePrefix(frame.subarray(0, 4));

    await expect(reader.openFrame(frame.subarray(4, 4 + bodyLength), final)).rejects.toThrow(
      ArchiveDecryptError,
    );
  });
});

describe("parseArchiveHeader — hostile input", () => {
  it("accepts a well-formed header (the baseline every rejection test below mutates)", async () => {
    const block = buildRawHeaderBlock(JSON.stringify(validHeaderFields()));
    const { header, blockLength } = await parseArchiveHeader(block);
    expect(header.format).toBe("nexus-archive");
    expect(blockLength).toBe(block.length);
  });

  it("rejects fewer than 8 bytes", async () => {
    await expect(parseArchiveHeader(new Uint8Array(4))).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a bad magic", async () => {
    const block = buildRawHeaderBlock(JSON.stringify(validHeaderFields()));
    const corrupted = new Uint8Array(block);
    corrupted.set(new TextEncoder().encode("XXXX"), 0);
    await expect(parseArchiveHeader(corrupted)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a headerLength that overruns the buffer", async () => {
    const magic = new TextEncoder().encode(ARCHIVE_MAGIC);
    const block = new Uint8Array(magic.length + 4);
    block.set(magic, 0);
    new DataView(block.buffer).setUint32(magic.length, 100, false); // claims 100 bytes that aren't there
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a headerLength beyond the 8192-byte cap", async () => {
    const magic = new TextEncoder().encode(ARCHIVE_MAGIC);
    const block = new Uint8Array(magic.length + 4);
    block.set(magic, 0);
    new DataView(block.buffer).setUint32(magic.length, 8193, false);
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects unparseable JSON", async () => {
    const block = buildRawHeaderBlock("not json{{{");
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a header that is not a JSON object", async () => {
    const block = buildRawHeaderBlock(JSON.stringify([1, 2, 3]));
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects an unknown format", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(validHeaderFields({ format: "something-else" })),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects an unknown version", async () => {
    const block = buildRawHeaderBlock(JSON.stringify(validHeaderFields({ version: 2 })));
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects an unknown cipher", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(validHeaderFields({ cipher: "AES-128-GCM" })),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a salt that is not valid base64", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(validHeaderFields({ salt: "%%%not-base64%%%" })),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a salt of the wrong decoded length", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(validHeaderFields({ salt: encodeBase64(randomBytes(15)) })),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a noncePrefix that is not valid base64", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(validHeaderFields({ noncePrefix: "not base64!" })),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a noncePrefix of the wrong decoded length", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(validHeaderFields({ noncePrefix: encodeBase64(randomBytes(7)) })),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a non-integer chunkBytes", async () => {
    const block = buildRawHeaderBlock(JSON.stringify(validHeaderFields({ chunkBytes: 1.5 })));
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a chunkBytes of 0", async () => {
    const block = buildRawHeaderBlock(JSON.stringify(validHeaderFields({ chunkBytes: 0 })));
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects a chunkBytes above the 64 MiB bound", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(validHeaderFields({ chunkBytes: 64 * 1024 * 1024 + 1 })),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects an unknown kdf.algorithm", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(
        validHeaderFields({
          kdf: { algorithm: "scrypt", memoryKiB: 8192, iterations: 1, parallelism: 1 },
        }),
      ),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects kdf.memoryKiB below the 8192 floor", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(
        validHeaderFields({
          kdf: { algorithm: "argon2id", memoryKiB: 8191, iterations: 1, parallelism: 1 },
        }),
      ),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects kdf.memoryKiB above the 1048576 ceiling — the memory-exhaustion bound", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(
        validHeaderFields({
          kdf: { algorithm: "argon2id", memoryKiB: 1024 * 1024 + 1, iterations: 1, parallelism: 1 },
        }),
      ),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects kdf.iterations of 0", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(
        validHeaderFields({
          kdf: { algorithm: "argon2id", memoryKiB: 8192, iterations: 0, parallelism: 1 },
        }),
      ),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects kdf.iterations above 16", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(
        validHeaderFields({
          kdf: { algorithm: "argon2id", memoryKiB: 8192, iterations: 17, parallelism: 1 },
        }),
      ),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects kdf.parallelism of 0", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(
        validHeaderFields({
          kdf: { algorithm: "argon2id", memoryKiB: 8192, iterations: 1, parallelism: 0 },
        }),
      ),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });

  it("rejects kdf.parallelism above 8", async () => {
    const block = buildRawHeaderBlock(
      JSON.stringify(
        validHeaderFields({
          kdf: { algorithm: "argon2id", memoryKiB: 8192, iterations: 1, parallelism: 9 },
        }),
      ),
    );
    await expect(parseArchiveHeader(block)).rejects.toThrow(ArchiveFormatError);
  });
});

describe("parseFramePrefix", () => {
  it("recovers final=false and the body length", () => {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, 12345, false);
    expect(parseFramePrefix(prefix)).toEqual({ bodyLength: 12345, final: false });
  });

  it("recovers final=true and the body length", () => {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, (0x8000_0000 | 12345) >>> 0, false);
    expect(parseFramePrefix(prefix)).toEqual({ bodyLength: 12345, final: true });
  });

  it("recovers a body length at the cap, with and without the final flag", () => {
    const atCap = 64 * 1024 * 1024 + 16;
    const plain = new Uint8Array(4);
    new DataView(plain.buffer).setUint32(0, atCap, false);
    expect(parseFramePrefix(plain)).toEqual({ bodyLength: atCap, final: false });

    const flagged = new Uint8Array(4);
    new DataView(flagged.buffer).setUint32(0, (0x8000_0000 | atCap) >>> 0, false);
    expect(parseFramePrefix(flagged)).toEqual({ bodyLength: atCap, final: true });
  });

  it("throws ArchiveFormatError for a body length of 0", () => {
    const prefix = new Uint8Array(4); // all-zero: bodyLength 0, final false
    expect(() => parseFramePrefix(prefix)).toThrow(ArchiveFormatError);
  });

  it("throws ArchiveFormatError for a body shorter than a GCM tag", () => {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, 15, false);
    expect(() => parseFramePrefix(prefix)).toThrow(ArchiveFormatError);
  });

  // The prefix is untrusted input and the caller's next move is to allocate
  // exactly this many bytes, so a length near the 31-bit maximum is not a
  // large frame — it is a ~2 GiB allocation requested by four edited bytes.
  it("throws ArchiveFormatError for a body length near the 31-bit maximum", () => {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, 0x7fff_fffe, false);
    expect(() => parseFramePrefix(prefix)).toThrow(ArchiveFormatError);
  });

  it("throws ArchiveFormatError one byte past the cap", () => {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, 64 * 1024 * 1024 + 17, false);
    expect(() => parseFramePrefix(prefix)).toThrow(ArchiveFormatError);
  });
});
