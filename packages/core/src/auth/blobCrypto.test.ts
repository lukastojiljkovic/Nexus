import { describe, expect, it } from "vitest";
import {
  BlobDecryptError,
  blobStorageName,
  decryptBlob,
  deriveBlobKeys,
  encryptBlob,
} from "./blobCrypto.js";

/** `byteLength` random bytes as lower-case hex — the shape both a data key and a sha256 digest take. */
function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A 64-hex-character data key, the same shape `openDatabase` and `deriveBlobKeys` take. */
function randomDataKeyHex(): string {
  return randomHex(32);
}

/** A 64-hex-character content hash — a stand-in for a real SHA-256 digest, never validated against actual content. */
function randomSha256Hex(): string {
  return randomHex(32);
}

/** Flips every bit of one byte — simpler than reimplementing hex/base64 tampering, and always different from the original regardless of its value. */
function flipByte(bytes: Uint8Array, index: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[index] = (copy[index] ?? 0) ^ 0xff;
  return copy;
}

describe("deriveBlobKeys", () => {
  it("returns two different 32-byte keys", async () => {
    const keys = await deriveBlobKeys(randomDataKeyHex());
    expect(keys.contentKey).toHaveLength(32);
    expect(keys.nameKey).toHaveLength(32);
    expect(keys.contentKey).not.toEqual(keys.nameKey);
  });

  it("is deterministic for the same data key", async () => {
    const dataKeyHex = randomDataKeyHex();
    const a = await deriveBlobKeys(dataKeyHex);
    const b = await deriveBlobKeys(dataKeyHex);
    expect(a.contentKey).toEqual(b.contentKey);
    expect(a.nameKey).toEqual(b.nameKey);
  });

  it("is case-insensitive: upper- and lower-case forms of one key give identical subkeys", async () => {
    const dataKeyHex = randomDataKeyHex();
    const lower = await deriveBlobKeys(dataKeyHex.toLowerCase());
    const upper = await deriveBlobKeys(dataKeyHex.toUpperCase());
    expect(lower.contentKey).toEqual(upper.contentKey);
    expect(lower.nameKey).toEqual(upper.nameKey);
  });

  it("throws TypeError for a 63-character hex string", async () => {
    await expect(deriveBlobKeys(randomDataKeyHex().slice(0, 63))).rejects.toThrow(TypeError);
  });

  it("throws TypeError for a 64-character non-hex string", async () => {
    await expect(deriveBlobKeys("z".repeat(64))).rejects.toThrow(TypeError);
  });
});

describe("blobStorageName", () => {
  it("is deterministic for the same key and hash", async () => {
    const { nameKey } = await deriveBlobKeys(randomDataKeyHex());
    const sha256Hex = randomSha256Hex();
    const a = await blobStorageName(nameKey, sha256Hex);
    const b = await blobStorageName(nameKey, sha256Hex);
    expect(a).toBe(b);
  });

  it("returns 64 lower-case hex characters", async () => {
    const { nameKey } = await deriveBlobKeys(randomDataKeyHex());
    const name = await blobStorageName(nameKey, randomSha256Hex());
    expect(name).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for a different content hash", async () => {
    const { nameKey } = await deriveBlobKeys(randomDataKeyHex());
    const a = await blobStorageName(nameKey, randomSha256Hex());
    const b = await blobStorageName(nameKey, randomSha256Hex());
    expect(a).not.toBe(b);
  });

  it("differs for name keys derived from a different data key", async () => {
    const sha256Hex = randomSha256Hex();
    const keysA = await deriveBlobKeys(randomDataKeyHex());
    const keysB = await deriveBlobKeys(randomDataKeyHex());
    const a = await blobStorageName(keysA.nameKey, sha256Hex);
    const b = await blobStorageName(keysB.nameKey, sha256Hex);
    expect(a).not.toBe(b);
  });

  it("throws TypeError for a malformed sha256Hex", async () => {
    const { nameKey } = await deriveBlobKeys(randomDataKeyHex());
    await expect(blobStorageName(nameKey, "not-a-hash")).rejects.toThrow(TypeError);
  });

  // Lower-case only is the whole reason names stay stable: an upper-cased
  // digest is a DIFFERENT HMAC input, so accepting it would name one file two
  // ways and quietly duplicate every blob it touched.
  it("rejects an upper-case sha256Hex rather than folding its case", async () => {
    const { nameKey } = await deriveBlobKeys(randomDataKeyHex());
    await expect(blobStorageName(nameKey, randomSha256Hex().toUpperCase())).rejects.toThrow(
      TypeError,
    );
  });
});

describe("encryptBlob / decryptBlob", () => {
  it("round-trips ~1 KiB of random plaintext byte-identically", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    const sha256Hex = randomSha256Hex();
    const plaintext = new Uint8Array(1024);
    crypto.getRandomValues(plaintext);

    const container = await encryptBlob(contentKey, plaintext, sha256Hex);
    const decrypted = await decryptBlob(contentKey, container, sha256Hex);

    expect(decrypted).toEqual(plaintext);
  });

  it("round-trips a zero-length plaintext (an empty file is a legitimate attachment)", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    const sha256Hex = randomSha256Hex();
    const plaintext = new Uint8Array(0);

    const container = await encryptBlob(contentKey, plaintext, sha256Hex);
    const decrypted = await decryptBlob(contentKey, container, sha256Hex);

    expect(decrypted).toEqual(plaintext);
  });

  it("uses a fresh nonce per call: two encryptions of the same plaintext differ but both decrypt back", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    const sha256Hex = randomSha256Hex();
    const plaintext = new TextEncoder().encode("the quick brown fox");

    const containerA = await encryptBlob(contentKey, plaintext, sha256Hex);
    const containerB = await encryptBlob(contentKey, plaintext, sha256Hex);

    expect(containerA).not.toEqual(containerB);
    expect(await decryptBlob(contentKey, containerA, sha256Hex)).toEqual(plaintext);
    expect(await decryptBlob(contentKey, containerB, sha256Hex)).toEqual(plaintext);
  });

  it("starts with the NXB1 magic and is exactly 32 + plaintext.length bytes long", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    const sha256Hex = randomSha256Hex();
    const plaintext = new TextEncoder().encode("hello attachment");

    const container = await encryptBlob(contentKey, plaintext, sha256Hex);

    expect(new TextDecoder().decode(container.slice(0, 4))).toBe("NXB1");
    expect(container).toHaveLength(32 + plaintext.length);
  });

  it("throws BlobDecryptError when a ciphertext byte is flipped", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    const sha256Hex = randomSha256Hex();
    const plaintext = new TextEncoder().encode("tamper me");

    const container = await encryptBlob(contentKey, plaintext, sha256Hex);
    const tampered = flipByte(container, container.length - 1);

    await expect(decryptBlob(contentKey, tampered, sha256Hex)).rejects.toThrow(BlobDecryptError);
  });

  it("throws BlobDecryptError for a content key derived from a different data key", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    const sha256Hex = randomSha256Hex();
    const plaintext = new TextEncoder().encode("wrong key");
    const container = await encryptBlob(contentKey, plaintext, sha256Hex);

    const { contentKey: otherContentKey } = await deriveBlobKeys(randomDataKeyHex());

    await expect(decryptBlob(otherContentKey, container, sha256Hex)).rejects.toThrow(
      BlobDecryptError,
    );
  });

  it("throws BlobDecryptError for a different (but well-formed) sha256Hex — the AAD binding", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    const sha256Hex = randomSha256Hex();
    const plaintext = new TextEncoder().encode("bound to my hash");
    const container = await encryptBlob(contentKey, plaintext, sha256Hex);

    await expect(decryptBlob(contentKey, container, randomSha256Hex())).rejects.toThrow(
      BlobDecryptError,
    );
  });

  it("throws BlobDecryptError for a corrupted magic", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    const sha256Hex = randomSha256Hex();
    const container = await encryptBlob(contentKey, new Uint8Array(8), sha256Hex);

    const corrupted = flipByte(container, 0);

    await expect(decryptBlob(contentKey, corrupted, sha256Hex)).rejects.toThrow(BlobDecryptError);
  });

  it("throws BlobDecryptError for a truncated container", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    const sha256Hex = randomSha256Hex();
    const container = await encryptBlob(contentKey, new Uint8Array(8), sha256Hex);

    const truncated = container.slice(0, 10);

    await expect(decryptBlob(contentKey, truncated, sha256Hex)).rejects.toThrow(BlobDecryptError);
  });

  it("throws TypeError (not BlobDecryptError) for a malformed sha256Hex passed to encryptBlob", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    await expect(encryptBlob(contentKey, new Uint8Array(4), "short")).rejects.toThrow(TypeError);
  });

  it("throws TypeError (not BlobDecryptError) for a malformed sha256Hex passed to decryptBlob", async () => {
    const { contentKey } = await deriveBlobKeys(randomDataKeyHex());
    const container = await encryptBlob(contentKey, new Uint8Array(4), randomSha256Hex());
    await expect(decryptBlob(contentKey, container, "SHORT")).rejects.toThrow(TypeError);
  });
});
