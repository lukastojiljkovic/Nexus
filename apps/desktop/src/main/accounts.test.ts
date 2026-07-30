import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ACCOUNTS_REGISTRY_FILE_NAME,
  DEFAULT_ACCOUNT_LABEL,
  MAX_ACCOUNT_LABEL_LENGTH,
  absorbLegacyFlatData,
  accountDir,
  accountExists,
  accountsRoot,
  beginAccountDir,
  loadRegistry,
  normalizeAccountLabel,
  readRegistry,
  registerAccount,
  renameAccount,
  resumeAccountsMigration,
  selectAccount,
} from "./accounts.js";

/**
 * `main/accounts.ts` against a real filesystem (ADR-044). The module is
 * deliberately Electron-free — every function takes the `userData` directory as
 * its first argument, exactly as `main/auth.ts` does — so it runs under plain
 * Vitest with a temp directory standing in for `%APPDATA%\Nexus`.
 *
 * The migration cases are the point of this file: a flat legacy layout is
 * MOVED, not copied, so every crash point in that ladder has to resume into the
 * same directory rather than strand half the data in an orphan.
 */

let userData: string;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "nexus-accounts-"));
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

/** Writes a plausible flat legacy install: keychain, database triplet, both blob roots. */
function writeLegacyFlatInstall(options: { keychain: boolean } = { keychain: true }): void {
  if (options.keychain) writeFileSync(join(userData, "keychain.json"), '{"version":1}');
  writeFileSync(join(userData, "nexus.db"), "database");
  writeFileSync(join(userData, "nexus.db-wal"), "wal");
  writeFileSync(join(userData, "nexus.db-shm"), "shm");
  mkdirSync(join(userData, "blobs", "ab"), { recursive: true });
  writeFileSync(join(userData, "blobs", "ab", "abcd"), "blob");
  mkdirSync(join(userData, "attachments", "cd"), { recursive: true });
  writeFileSync(join(userData, "attachments", "cd", "cdef"), "legacy blob");
}

function readRegistryFile(): unknown {
  return JSON.parse(readFileSync(join(userData, ACCOUNTS_REGISTRY_FILE_NAME), "utf8"));
}

describe("normalizeAccountLabel", () => {
  it("trims and accepts an ordinary label", () => {
    expect(normalizeAccountLabel("  Moj nalog  ")).toBe("Moj nalog");
  });

  it("rejects an empty or whitespace-only label", () => {
    expect(normalizeAccountLabel("")).toBeNull();
    expect(normalizeAccountLabel("   ")).toBeNull();
  });

  it("accepts exactly the maximum length and rejects one character more", () => {
    expect(normalizeAccountLabel("x".repeat(MAX_ACCOUNT_LABEL_LENGTH))).toHaveLength(
      MAX_ACCOUNT_LABEL_LENGTH,
    );
    expect(normalizeAccountLabel("x".repeat(MAX_ACCOUNT_LABEL_LENGTH + 1))).toBeNull();
  });
});

describe("readRegistry", () => {
  it("reports an empty registry when no file exists yet", () => {
    expect(readRegistry(userData)).toEqual({ version: 1, accounts: [], lastActiveId: null });
  });

  it("reads back what registerAccount wrote", () => {
    const id = beginAccountDir(userData);
    registerAccount(userData, id, "Posao", "2026-07-30T10:00:00.000Z");
    expect(readRegistry(userData)).toEqual({
      version: 1,
      accounts: [{ id, label: "Posao", createdAt: "2026-07-30T10:00:00.000Z" }],
      lastActiveId: id,
    });
  });
});

describe("beginAccountDir", () => {
  it("creates a directory named after the account id", () => {
    const id = beginAccountDir(userData);
    expect(existsSync(accountDir(userData, id))).toBe(true);
    expect(accountDir(userData, id)).toBe(join(accountsRoot(userData), id));
  });

  it("resumes into the same under-construction directory rather than minting a second one", () => {
    const first = beginAccountDir(userData);
    const second = beginAccountDir(userData);
    expect(second).toBe(first);
  });

  it("mints a fresh directory once the previous one holds a keychain", () => {
    const first = beginAccountDir(userData);
    writeFileSync(join(accountDir(userData, first), "keychain.json"), '{"version":1}');
    const second = beginAccountDir(userData);
    expect(second).not.toBe(first);
    expect(existsSync(accountDir(userData, second))).toBe(true);
  });
});

describe("registerAccount / renameAccount / selectAccount", () => {
  it("appends accounts in creation order and tracks the last active one", () => {
    const first = beginAccountDir(userData);
    registerAccount(userData, first, "Prvi", "2026-07-30T10:00:00.000Z");
    writeFileSync(join(accountDir(userData, first), "keychain.json"), '{"version":1}');
    const second = beginAccountDir(userData);
    const registry = registerAccount(userData, second, "Drugi", "2026-07-30T11:00:00.000Z");

    expect(registry.accounts.map((account) => account.label)).toEqual(["Prvi", "Drugi"]);
    expect(registry.lastActiveId).toBe(second);
  });

  it("renames only the label and leaves the id and creation instant alone", () => {
    const id = beginAccountDir(userData);
    registerAccount(userData, id, "Staro", "2026-07-30T10:00:00.000Z");
    const registry = renameAccount(userData, id, "  Novo  ");
    expect(registry.accounts).toEqual([
      { id, label: "Novo", createdAt: "2026-07-30T10:00:00.000Z" },
    ]);
    expect(readRegistryFile()).toEqual(registry);
  });

  it("refuses to rename an unknown account", () => {
    expect(() => renameAccount(userData, "nope", "Novo")).toThrow();
  });

  it("refuses an unusable label", () => {
    const id = beginAccountDir(userData);
    registerAccount(userData, id, "Staro", "2026-07-30T10:00:00.000Z");
    expect(() => renameAccount(userData, id, "   ")).toThrow();
  });

  it("moves lastActiveId and refuses an unknown account", () => {
    const first = beginAccountDir(userData);
    registerAccount(userData, first, "Prvi", "2026-07-30T10:00:00.000Z");
    writeFileSync(join(accountDir(userData, first), "keychain.json"), '{"version":1}');
    const second = beginAccountDir(userData);
    registerAccount(userData, second, "Drugi", "2026-07-30T11:00:00.000Z");

    expect(selectAccount(userData, first).lastActiveId).toBe(first);
    expect(() => selectAccount(userData, "nope")).toThrow();
  });

  it("answers accountExists from the registry", () => {
    const id = beginAccountDir(userData);
    registerAccount(userData, id, "Prvi", "2026-07-30T10:00:00.000Z");
    expect(accountExists(userData, id)).toBe(true);
    expect(accountExists(userData, "nope")).toBe(false);
  });
});

describe("loadRegistry (reconciliation)", () => {
  it("drops an entry whose directory the user deleted", async () => {
    const id = beginAccountDir(userData);
    registerAccount(userData, id, "Obrisan", "2026-07-30T10:00:00.000Z");
    await rm(accountDir(userData, id), { recursive: true, force: true });

    const registry = loadRegistry(userData);
    expect(registry.accounts).toEqual([]);
    expect(registry.lastActiveId).toBeNull();
    expect(readRegistryFile()).toEqual(registry);
  });

  it("adopts a keychain-bearing directory the registry never learned about", () => {
    const id = beginAccountDir(userData);
    writeFileSync(join(accountDir(userData, id), "keychain.json"), '{"version":1}');

    const registry = loadRegistry(userData);
    expect(registry.accounts).toHaveLength(1);
    expect(registry.accounts[0]?.id).toBe(id);
    expect(registry.accounts[0]?.label).toBe(DEFAULT_ACCOUNT_LABEL);
  });

  it("ignores an under-construction directory that holds no keychain", () => {
    beginAccountDir(userData);
    expect(loadRegistry(userData).accounts).toEqual([]);
  });

  it("clears a lastActiveId that no longer names an account", () => {
    const id = beginAccountDir(userData);
    registerAccount(userData, id, "Prvi", "2026-07-30T10:00:00.000Z");
    writeFileSync(
      join(userData, ACCOUNTS_REGISTRY_FILE_NAME),
      JSON.stringify({
        version: 1,
        accounts: [{ id, label: "Prvi", createdAt: "2026-07-30T10:00:00.000Z" }],
        lastActiveId: "gone",
      }),
    );
    writeFileSync(join(accountDir(userData, id), "keychain.json"), '{"version":1}');

    expect(loadRegistry(userData).lastActiveId).toBeNull();
  });

  it("rebuilds from disk rather than throwing when the registry file is corrupt", () => {
    const id = beginAccountDir(userData);
    writeFileSync(join(accountDir(userData, id), "keychain.json"), '{"version":1}');
    writeFileSync(join(userData, ACCOUNTS_REGISTRY_FILE_NAME), "{ not json");

    const registry = loadRegistry(userData);
    expect(registry.accounts.map((account) => account.id)).toEqual([id]);
  });

  it("leaves an already-consistent registry file untouched", () => {
    const id = beginAccountDir(userData);
    registerAccount(userData, id, "Prvi", "2026-07-30T10:00:00.000Z");
    writeFileSync(join(accountDir(userData, id), "keychain.json"), '{"version":1}');

    const before = readFileSync(join(userData, ACCOUNTS_REGISTRY_FILE_NAME), "utf8");
    loadRegistry(userData);
    expect(readFileSync(join(userData, ACCOUNTS_REGISTRY_FILE_NAME), "utf8")).toBe(before);
  });
});

describe("resumeAccountsMigration", () => {
  it("moves a whole flat legacy install into one labeled account directory", () => {
    writeLegacyFlatInstall();

    const registry = resumeAccountsMigration(userData);
    const id = registry.accounts[0]?.id;
    expect(id).toBeDefined();
    expect(registry.accounts[0]?.label).toBe(DEFAULT_ACCOUNT_LABEL);
    expect(registry.lastActiveId).toBe(id);

    const dir = accountDir(userData, id!);
    for (const name of ["keychain.json", "nexus.db", "nexus.db-wal", "nexus.db-shm"]) {
      expect(existsSync(join(dir, name))).toBe(true);
      expect(existsSync(join(userData, name))).toBe(false);
    }
    expect(readFileSync(join(dir, "blobs", "ab", "abcd"), "utf8")).toBe("blob");
    expect(readFileSync(join(dir, "attachments", "cd", "cdef"), "utf8")).toBe("legacy blob");
    expect(existsSync(join(userData, "blobs"))).toBe(false);
    expect(existsSync(join(userData, "attachments"))).toBe(false);
  });

  it("carries a leftover .pre-encryption backup across with the database", () => {
    writeLegacyFlatInstall();
    writeFileSync(join(userData, "nexus.db.pre-encryption"), "backup");
    writeFileSync(join(userData, "nexus.db.pre-encryption-wal"), "backup wal");

    const registry = resumeAccountsMigration(userData);
    const dir = accountDir(userData, registry.accounts[0]!.id);
    expect(readFileSync(join(dir, "nexus.db.pre-encryption"), "utf8")).toBe("backup");
    expect(readFileSync(join(dir, "nexus.db.pre-encryption-wal"), "utf8")).toBe("backup wal");
    expect(existsSync(join(userData, "nexus.db.pre-encryption"))).toBe(false);
  });

  it("is a no-op the second time, and on an install that was never flat", () => {
    writeLegacyFlatInstall();
    const first = resumeAccountsMigration(userData);
    const second = resumeAccountsMigration(userData);
    expect(second).toEqual(first);

    const fresh = accountDir(userData, first.accounts[0]!.id);
    expect(existsSync(join(fresh, "keychain.json"))).toBe(true);
    expect(readRegistry(userData).accounts).toHaveLength(1);
  });

  it("does nothing at all on a first-ever launch", () => {
    const registry = resumeAccountsMigration(userData);
    expect(registry).toEqual({ version: 1, accounts: [], lastActiveId: null });
    expect(existsSync(accountsRoot(userData))).toBe(false);
    // Not even an empty registry file: an install with no account has nothing to record.
    expect(existsSync(join(userData, ACCOUNTS_REGISTRY_FILE_NAME))).toBe(false);
  });

  it("resumes into the half-filled directory when the crash predated the keychain move", () => {
    writeLegacyFlatInstall();
    // Crash point 1: blobs/ already moved, keychain.json still flat, nothing registered.
    const started = beginAccountDir(userData);
    mkdirSync(join(accountDir(userData, started), "blobs", "ab"), { recursive: true });
    writeFileSync(join(accountDir(userData, started), "blobs", "ab", "abcd"), "blob");
    writeFileSync(join(userData, "blobs", "ab", "abcd"), "blob"); // still flat: only the move is undone

    const registry = resumeAccountsMigration(userData);
    expect(registry.accounts.map((account) => account.id)).toEqual([started]);
    expect(existsSync(join(accountDir(userData, started), "keychain.json"))).toBe(true);
    expect(existsSync(join(accountDir(userData, started), "nexus.db"))).toBe(true);
  });

  it("finishes the database move in one pass when the crash followed the keychain move", () => {
    // Crash point 2: keychain moved, registry never written, database still flat.
    const id = beginAccountDir(userData);
    writeFileSync(join(accountDir(userData, id), "keychain.json"), '{"version":1}');
    writeLegacyFlatInstall({ keychain: false });

    const registry = resumeAccountsMigration(userData);
    expect(registry.accounts.map((account) => account.id)).toEqual([id]);
    expect(existsSync(join(accountDir(userData, id), "nexus.db"))).toBe(true);
    expect(existsSync(join(userData, "nexus.db"))).toBe(false);
    expect(existsSync(join(userData, "nexus.db-wal"))).toBe(false);
  });

  it("moves database residue left beside an already-written registry entry", () => {
    // Crash point 3: keychain moved AND registered, database still flat.
    const id = beginAccountDir(userData);
    writeFileSync(join(accountDir(userData, id), "keychain.json"), '{"version":1}');
    registerAccount(userData, id, "Moj nalog", "2026-07-30T10:00:00.000Z");
    writeFileSync(join(userData, "nexus.db"), "database");

    resumeAccountsMigration(userData);
    expect(readFileSync(join(accountDir(userData, id), "nexus.db"), "utf8")).toBe("database");
    expect(existsSync(join(userData, "nexus.db"))).toBe(false);
  });

  it("leaves a flat plaintext database alone while no account owns it", () => {
    // A pre-encryption install that was never opened: `auth:create` absorbs it.
    writeLegacyFlatInstall({ keychain: false });
    resumeAccountsMigration(userData);
    expect(existsSync(join(userData, "nexus.db"))).toBe(true);
    expect(readRegistry(userData).accounts).toEqual([]);
  });
});

describe("absorbLegacyFlatData", () => {
  it("pulls a flat plaintext database and both blob roots into a fresh account directory", () => {
    writeLegacyFlatInstall({ keychain: false });
    const id = beginAccountDir(userData);

    absorbLegacyFlatData(userData, id);

    const dir = accountDir(userData, id);
    expect(readFileSync(join(dir, "nexus.db"), "utf8")).toBe("database");
    expect(readFileSync(join(dir, "blobs", "ab", "abcd"), "utf8")).toBe("blob");
    expect(readFileSync(join(dir, "attachments", "cd", "cdef"), "utf8")).toBe("legacy blob");
    expect(existsSync(join(userData, "nexus.db"))).toBe(false);
    expect(existsSync(join(userData, "blobs"))).toBe(false);
  });

  it("never touches a keychain — account creation mints that one itself", () => {
    writeLegacyFlatInstall();
    const id = beginAccountDir(userData);

    absorbLegacyFlatData(userData, id);

    expect(existsSync(join(userData, "keychain.json"))).toBe(true);
    expect(existsSync(join(accountDir(userData, id), "keychain.json"))).toBe(false);
  });

  it("is a no-op on an install with nothing flat to absorb", () => {
    const id = beginAccountDir(userData);
    absorbLegacyFlatData(userData, id);
    expect(existsSync(join(accountDir(userData, id), "nexus.db"))).toBe(false);
  });
});
