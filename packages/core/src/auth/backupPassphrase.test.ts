import { describe, expect, it } from "vitest";
import { KeyUnwrapError } from "./keyChain.js";
import { unwrapBackupPassphrase, wrapBackupPassphrase } from "./backupPassphrase.js";

const DATA_KEY_HEX = "ab".repeat(32);
const OTHER_KEY_HEX = "cd".repeat(32);

describe("wrapBackupPassphrase / unwrapBackupPassphrase", () => {
  it("round-trips a passphrase under the same data key", async () => {
    const wrapped = await wrapBackupPassphrase(DATA_KEY_HEX, "correct horse battery");
    expect(await unwrapBackupPassphrase(DATA_KEY_HEX, wrapped)).toBe("correct horse battery");
  });

  it("round-trips a non-ASCII passphrase byte-exactly", async () => {
    const passphrase = "šifra za arhivu — ćčđž 🔐";
    const wrapped = await wrapBackupPassphrase(DATA_KEY_HEX, passphrase);
    expect(await unwrapBackupPassphrase(DATA_KEY_HEX, wrapped)).toBe(passphrase);
  });

  it("never stores the passphrase in the clear in the serialized form", async () => {
    const wrapped = await wrapBackupPassphrase(DATA_KEY_HEX, "correct horse battery");
    expect(wrapped).not.toContain("correct horse battery");
    expect(wrapped).not.toContain(btoa("correct horse battery"));
  });

  it("produces a fresh wrap every call (random nonce), all opening to the same passphrase", async () => {
    const first = await wrapBackupPassphrase(DATA_KEY_HEX, "correct horse battery");
    const second = await wrapBackupPassphrase(DATA_KEY_HEX, "correct horse battery");
    expect(first).not.toBe(second);
    expect(await unwrapBackupPassphrase(DATA_KEY_HEX, second)).toBe("correct horse battery");
  });

  it("throws KeyUnwrapError under a different data key", async () => {
    const wrapped = await wrapBackupPassphrase(DATA_KEY_HEX, "correct horse battery");
    await expect(unwrapBackupPassphrase(OTHER_KEY_HEX, wrapped)).rejects.toBeInstanceOf(
      KeyUnwrapError,
    );
  });

  it("throws KeyUnwrapError for tampered ciphertext", async () => {
    const wrapped = await wrapBackupPassphrase(DATA_KEY_HEX, "correct horse battery");
    const parsed = JSON.parse(wrapped) as { v: number; nonce: string; ciphertext: string };
    const bytes = Uint8Array.from(atob(parsed.ciphertext), (char) => char.charCodeAt(0));
    const firstByte = bytes[0] ?? 0;
    bytes[0] = firstByte ^ 0xff;
    parsed.ciphertext = btoa(String.fromCharCode(...bytes));
    await expect(
      unwrapBackupPassphrase(DATA_KEY_HEX, JSON.stringify(parsed)),
    ).rejects.toBeInstanceOf(KeyUnwrapError);
  });

  it("throws KeyUnwrapError for a serialized form that is not a v1 wrap", async () => {
    await expect(unwrapBackupPassphrase(DATA_KEY_HEX, "not json")).rejects.toBeInstanceOf(
      KeyUnwrapError,
    );
    await expect(unwrapBackupPassphrase(DATA_KEY_HEX, "{}")).rejects.toBeInstanceOf(KeyUnwrapError);
    await expect(
      unwrapBackupPassphrase(DATA_KEY_HEX, JSON.stringify({ v: 2, nonce: "a", ciphertext: "b" })),
    ).rejects.toBeInstanceOf(KeyUnwrapError);
  });

  it("rejects a malformed data key with TypeError, never a runtime unwrap error", async () => {
    await expect(wrapBackupPassphrase("short", "correct horse battery")).rejects.toBeInstanceOf(
      TypeError,
    );
    const wrapped = await wrapBackupPassphrase(DATA_KEY_HEX, "correct horse battery");
    await expect(unwrapBackupPassphrase("short", wrapped)).rejects.toBeInstanceOf(TypeError);
  });

  it("derives the same purpose key for either hex casing of the same data key", async () => {
    const wrapped = await wrapBackupPassphrase(DATA_KEY_HEX.toUpperCase(), "correct horse battery");
    expect(await unwrapBackupPassphrase(DATA_KEY_HEX, wrapped)).toBe("correct horse battery");
  });
});
