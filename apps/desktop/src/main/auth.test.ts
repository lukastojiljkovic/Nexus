import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  available: false,
  backend: "gnome_libsecret",
  encryptString: vi.fn((value: string) => Buffer.from(`system:${value}`, "utf8")),
  decryptString: vi.fn((value: Buffer) => {
    const text = value.toString("utf8");
    if (!text.startsWith("system:")) throw new Error("not this system vault");
    return text.slice("system:".length);
  }),
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    getSelectedStorageBackend: () => storage.backend,
    encryptString: storage.encryptString,
    decryptString: storage.decryptString,
  },
}));

import {
  createAccount,
  isUsableKeystore,
  openWithoutPasscode,
  readStatus,
  setAccountPasscode,
  unlockWithRecovery,
  unlockWithPasscode,
} from "./auth.js";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-auth-"));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  storage.available = false;
  storage.backend = "gnome_libsecret";
  storage.encryptString.mockClear();
  storage.decryptString.mockClear();
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("optional account passcodes", () => {
  it("does not treat Linux basic_text as a real keyring", () => {
    const backend = (name: string) => ({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => name,
    });
    expect(isUsableKeystore(backend("basic_text"), "linux")).toBe(false);
    expect(isUsableKeystore(backend("unknown"), "linux")).toBe(false);
    expect(isUsableKeystore(backend("gnome_libsecret"), "linux")).toBe(true);
    expect(isUsableKeystore(backend("kwallet6"), "linux")).toBe(true);
    expect(isUsableKeystore(backend("basic_text"), "win32")).toBe(true);
  });

  it("creates and reopens a convenience-mode account with an owner-only guard", async () => {
    const dir = scratch();
    const created = await createAccount(dir, null);
    expect(created.deviceProtection).toBe("owner-only-file");
    expect(existsSync(join(dir, "guard.json"))).toBe(true);
    expect(readFileSync(join(dir, "keychain.json"), "utf8")).not.toContain(created.dataKeyHex);

    const status = readStatus(dir);
    expect(status).toMatchObject({
      state: "locked",
      requiresPasscode: false,
      requiresRecovery: false,
      deviceProtection: "owner-only-file",
    });
    await expect(openWithoutPasscode(dir)).resolves.toMatchObject({
      dataKeyHex: created.dataKeyHex,
      deviceProtection: "owner-only-file",
    });
  });

  it("adds and removes a passcode without changing the data key", async () => {
    const dir = scratch();
    const created = await createAccount(dir, null);
    await setAccountPasscode(dir, null, "correct-horse-2", created.dataKeyHex);
    expect(readStatus(dir)).toMatchObject({ requiresPasscode: true });
    await expect(unlockWithPasscode(dir, "correct-horse-2")).resolves.toMatchObject({
      dataKeyHex: created.dataKeyHex,
    });

    await setAccountPasscode(dir, "correct-horse-2", null, created.dataKeyHex);
    expect(readStatus(dir)).toMatchObject({ requiresPasscode: false });
    await expect(openWithoutPasscode(dir)).resolves.toMatchObject({
      dataKeyHex: created.dataKeyHex,
    });
  });

  it("keeps a passcode-protected account protected when the system vault exists", async () => {
    storage.available = true;
    const dir = scratch();
    const created = await createAccount(dir, "correct-horse-2");
    expect(created.deviceProtection).toBe("system-vault");
    expect(storage.encryptString).toHaveBeenCalled();
    expect(existsSync(join(dir, "guard.json"))).toBe(false);
    await expect(openWithoutPasscode(dir)).rejects.toMatchObject({ reason: "passcodeNotSet" });
    await expect(unlockWithPasscode(dir, "correct-horse-2")).resolves.toMatchObject({
      dataKeyHex: created.dataKeyHex,
    });
  });

  it("does not publish a keychain when the owner-only guard cannot be written", async () => {
    const dir = scratch();
    mkdirSync(join(dir, "guard.json"));
    await expect(createAccount(dir, null)).rejects.toThrow(/regular file/);
    expect(existsSync(join(dir, "keychain.json"))).toBe(false);
  });

  it("does not replace the keychain when recovery cannot publish its new owner guard", async () => {
    const dir = scratch();
    const created = await createAccount(dir, null);
    const before = readFileSync(join(dir, "keychain.json"));
    mkdirSync(join(dir, "guard.json.tmp"));

    await expect(unlockWithRecovery(dir, created.recoveryCode, "correct-horse-2")).rejects.toThrow(
      /EISDIR|directory/i,
    );
    expect(readFileSync(join(dir, "keychain.json")).equals(before)).toBe(true);
  });
});
