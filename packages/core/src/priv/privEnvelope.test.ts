import { describe, expect, it } from "vitest";
import {
  PrivSealError,
  derivePrivBlobKey,
  openPrivBlob,
  openPrivNote,
  sealPrivBlob,
  sealPrivNote,
  type PrivNoteEnvelope,
} from "./privEnvelope.js";

const bytes = (length: number, fn: (i: number) => number): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => fn(i));
const toHex = (u8: Uint8Array): string =>
  Array.from(u8, (byte) => byte.toString(16).padStart(2, "0")).join("");
const fromB64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const PRIV_DEK = bytes(32, (i) => i);
const OTHER_DEK = bytes(32, (i) => 0xff - i);

const ENVELOPE: PrivNoteEnvelope = {
  title: "Naslov",
  yjsState: "eWpz",
  plaintext: "Tekst beleške",
  attachments: [{ id: "att-1", fileName: "slika.png", mime: "image/png", sizeBytes: 123 }],
};

// Known-answer fixtures, produced by an independent script (WebCrypto spelled
// out from the ADR-057 spec, never through this module): key = HKDF(privDek,
// empty salt, "nexus/priv-note/v1"), AAD = UTF-8("note-1") || uint32be(7).
const NOTE_KAT_B64 =
  "TlhQMVBQUFBQUFBQUFBQUOOmrxeh5Rfra8VB+zbyLPI77du13u/pzQIzqKi4iKe9uwPDn+7V5PJ61bDfVyq3JqRWcc0/elFXSR22wngvpY/8rbi7+vJ/XSil0mrp90gJABdsSSEroUf/nEQoB7F/RbI1ChUNGOoQ2RGGUXF/ZCW5pcPNQ031ztAYKixL+bdAfGP4ffkbVUHKrsgustF/pzLAlO5mNHbpp85UFQG5x3n4JBdITp5YEb2d";
/** The same key and AAD sealing the plaintext "not json" — authenticates, then fails the JSON parse. */
const NOTE_NOT_JSON_B64 = "TlhQMWBgYGBgYGBgYGBgYEyO4QahNbmPF8wkAZ2MPA9jIOglTk0Svw==";
/** The same key and AAD sealing "{}" — valid JSON that is not a v1 envelope. */
const NOTE_WRONG_SHAPE_B64 = "TlhQMWFhYWFhYWFhYWFhYdkCQ9S9VfLyOe3lX5Me+T//xQ==";
/** blobKey = HKDF(privDek, empty salt, "nexus/priv-blob/v1"); AAD = UTF-8("att-1"); plaintext 01..05. */
const BLOB_KEY_HEX = "e33ced84f1f73597a2de8afa80349f9f38ab14460de0bc2488f17c71be15908c";
const BLOB_KAT_B64 = "TlhQQnBwcHBwcHBwcHBwcAOEvo5iA+i78JJJT5kKwYFzw5f9Og==";

describe("sealPrivNote / openPrivNote", () => {
  it("round-trips an envelope, non-ASCII fields byte-exactly", async () => {
    const sealed = await sealPrivNote(PRIV_DEK, "note-1", 3, ENVELOPE);
    expect(new TextDecoder().decode(sealed.subarray(0, 4))).toBe("NXP1");
    expect(await openPrivNote(PRIV_DEK, "note-1", 3, sealed)).toEqual(ENVELOPE);
  });

  it("round-trips an empty attachment list and empty strings", async () => {
    const empty: PrivNoteEnvelope = { title: "", yjsState: "", plaintext: "", attachments: [] };
    const sealed = await sealPrivNote(PRIV_DEK, "note-2", 0, empty);
    expect(await openPrivNote(PRIV_DEK, "note-2", 0, sealed)).toEqual(empty);
  });

  it("uses a fresh random nonce per seal — same input twice yields different containers, both opening", async () => {
    const a = await sealPrivNote(PRIV_DEK, "note-1", 3, ENVELOPE);
    const b = await sealPrivNote(PRIV_DEK, "note-1", 3, ENVELOPE);
    expect(a).not.toEqual(b);
    expect(await openPrivNote(PRIV_DEK, "note-1", 3, b)).toEqual(ENVELOPE);
  });

  it("matches the known answer: opens a container sealed by an independent implementation", async () => {
    expect(await openPrivNote(PRIV_DEK, "note-1", 7, fromB64(NOTE_KAT_B64))).toEqual(ENVELOPE);
  });

  it("throws PrivSealError when a ciphertext byte is flipped", async () => {
    const sealed = await sealPrivNote(PRIV_DEK, "note-1", 3, ENVELOPE);
    const tampered = new Uint8Array(sealed);
    tampered[20] = (tampered[20] ?? 0) ^ 0xff;
    await expect(openPrivNote(PRIV_DEK, "note-1", 3, tampered)).rejects.toThrow(PrivSealError);
  });

  it("cannot be swapped between rows: note A's container never opens under note B's id (SEC-CR-04)", async () => {
    const sealedA = await sealPrivNote(PRIV_DEK, "note-a", 1, ENVELOPE);
    await expect(openPrivNote(PRIV_DEK, "note-b", 1, sealedA)).rejects.toThrow(PrivSealError);
  });

  it("cannot be rolled back between versions: a container sealed at seq 5 never opens as seq 4 (SEC-CR-04)", async () => {
    const sealed = await sealPrivNote(PRIV_DEK, "note-1", 5, ENVELOPE);
    await expect(openPrivNote(PRIV_DEK, "note-1", 4, sealed)).rejects.toThrow(PrivSealError);
  });

  it("throws PrivSealError under the wrong PRIV DEK", async () => {
    const sealed = await sealPrivNote(PRIV_DEK, "note-1", 3, ENVELOPE);
    await expect(openPrivNote(OTHER_DEK, "note-1", 3, sealed)).rejects.toThrow(PrivSealError);
  });

  it("throws PrivSealError for a foreign or absent magic and for truncated bytes", async () => {
    await expect(openPrivNote(PRIV_DEK, "note-1", 3, fromB64(BLOB_KAT_B64))).rejects.toThrow(
      PrivSealError,
    );
    await expect(openPrivNote(PRIV_DEK, "note-1", 3, bytes(64, () => 7))).rejects.toThrow(
      PrivSealError,
    );
    await expect(openPrivNote(PRIV_DEK, "note-1", 3, bytes(8, () => 0))).rejects.toThrow(
      PrivSealError,
    );
  });

  it("throws PrivSealError for an authenticated container whose plaintext is not a v1 envelope", async () => {
    await expect(openPrivNote(PRIV_DEK, "note-1", 7, fromB64(NOTE_NOT_JSON_B64))).rejects.toThrow(
      PrivSealError,
    );
    await expect(openPrivNote(PRIV_DEK, "note-1", 7, fromB64(NOTE_WRONG_SHAPE_B64))).rejects.toThrow(
      PrivSealError,
    );
  });

  it("rejects caller bugs with TypeError, never PrivSealError", async () => {
    await expect(sealPrivNote(bytes(16, () => 0), "note-1", 3, ENVELOPE)).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(sealPrivNote(PRIV_DEK, "", 3, ENVELOPE)).rejects.toBeInstanceOf(TypeError);
    await expect(sealPrivNote(PRIV_DEK, "note-1", -1, ENVELOPE)).rejects.toBeInstanceOf(TypeError);
    await expect(sealPrivNote(PRIV_DEK, "note-1", 1.5, ENVELOPE)).rejects.toBeInstanceOf(TypeError);
    await expect(sealPrivNote(PRIV_DEK, "note-1", 2 ** 32, ENVELOPE)).rejects.toBeInstanceOf(
      TypeError,
    );
    const sealed = await sealPrivNote(PRIV_DEK, "note-1", 3, ENVELOPE);
    await expect(openPrivNote(bytes(16, () => 0), "note-1", 3, sealed)).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe("derivePrivBlobKey / sealPrivBlob / openPrivBlob", () => {
  it("derives the known-answer blob key (HKDF info nexus/priv-blob/v1)", async () => {
    expect(toHex(await derivePrivBlobKey(PRIV_DEK))).toBe(BLOB_KEY_HEX);
  });

  it("round-trips blob bytes, including an empty blob", async () => {
    const blobKey = await derivePrivBlobKey(PRIV_DEK);
    const plaintext = bytes(1024, (i) => i % 251);
    const sealed = await sealPrivBlob(blobKey, "att-9", plaintext);
    expect(new TextDecoder().decode(sealed.subarray(0, 4))).toBe("NXPB");
    expect(await openPrivBlob(blobKey, "att-9", sealed)).toEqual(plaintext);

    const emptySealed = await sealPrivBlob(blobKey, "att-0", new Uint8Array(0));
    expect(await openPrivBlob(blobKey, "att-0", emptySealed)).toEqual(new Uint8Array(0));
  });

  it("has no content addressing: sealing the same bytes twice yields different containers", async () => {
    const blobKey = await derivePrivBlobKey(PRIV_DEK);
    const plaintext = bytes(32, (i) => i);
    const a = await sealPrivBlob(blobKey, "att-9", plaintext);
    const b = await sealPrivBlob(blobKey, "att-9", plaintext);
    expect(a).not.toEqual(b);
  });

  it("matches the known answer: opens a blob sealed by an independent implementation", async () => {
    const blobKey = await derivePrivBlobKey(PRIV_DEK);
    expect(await openPrivBlob(blobKey, "att-1", fromB64(BLOB_KAT_B64))).toEqual(
      Uint8Array.of(1, 2, 3, 4, 5),
    );
  });

  it("throws PrivSealError for tampered bytes, a swapped attachment id, a foreign magic, or truncation", async () => {
    const blobKey = await derivePrivBlobKey(PRIV_DEK);
    const sealed = await sealPrivBlob(blobKey, "att-9", bytes(32, (i) => i));

    const tampered = new Uint8Array(sealed);
    tampered[20] = (tampered[20] ?? 0) ^ 0xff;
    await expect(openPrivBlob(blobKey, "att-9", tampered)).rejects.toThrow(PrivSealError);

    await expect(openPrivBlob(blobKey, "att-8", sealed)).rejects.toThrow(PrivSealError);
    await expect(openPrivBlob(blobKey, "att-9", fromB64(NOTE_KAT_B64))).rejects.toThrow(
      PrivSealError,
    );
    await expect(openPrivBlob(blobKey, "att-9", bytes(8, () => 0))).rejects.toThrow(PrivSealError);
  });

  it("rejects a wrong-length key or empty attachment id with TypeError", async () => {
    await expect(derivePrivBlobKey(bytes(16, () => 0))).rejects.toBeInstanceOf(TypeError);
    const blobKey = await derivePrivBlobKey(PRIV_DEK);
    await expect(sealPrivBlob(bytes(16, () => 0), "att-9", new Uint8Array(0))).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(sealPrivBlob(blobKey, "", new Uint8Array(0))).rejects.toBeInstanceOf(TypeError);
  });
});
