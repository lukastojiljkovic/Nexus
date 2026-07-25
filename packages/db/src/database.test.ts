import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import {
  DatabaseKeyError,
  DatabaseLockedError,
  SchemaVersionError,
  encryptDatabaseInPlace,
  isPlaintextDatabase,
  openDatabase,
} from "./index.js";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-db-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function dbPath(name = "test.db"): string {
  return join(dir, name);
}

describe("openDatabase", () => {
  it("creates the M0 tables and persists data across reopen", () => {
    const path = dbPath();
    const first = openDatabase({ path });
    first.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run("p1", "personal", "Luka", new Date().toISOString());
    first.close();

    const second = openDatabase({ path });
    const row = second.raw
      .prepare("SELECT name FROM profiles WHERE id = ?")
      .get("p1") as { name: string };
    expect(row.name).toBe("Luka");
    second.close();
  });

  it("reopens an encrypted database with the correct key", () => {
    const path = dbPath("enc.db");
    const first = openDatabase({ path, encryptionKey: KEY_A });
    first.raw.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("k", "v");
    first.close();

    const second = openDatabase({ path, encryptionKey: KEY_A });
    const row = second.raw
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get("k") as { value: string };
    expect(row.value).toBe("v");
    second.close();
  });

  it("rejects a wrong key on an encrypted database", () => {
    const path = dbPath("enc.db");
    openDatabase({ path, encryptionKey: KEY_A }).close();
    expect(() => openDatabase({ path, encryptionKey: KEY_B })).toThrow(
      DatabaseLockedError,
    );
  });

  it("rejects opening an encrypted database without a key", () => {
    const path = dbPath("enc.db");
    openDatabase({ path, encryptionKey: KEY_A }).close();
    expect(() => openDatabase({ path })).toThrow(DatabaseLockedError);
  });

  it("refuses a file whose schema is newer than this build", () => {
    const path = dbPath("future.db");
    const raw = new Database(path);
    raw.exec("CREATE TABLE placeholder (id TEXT)");
    raw.pragma("user_version = 999");
    raw.close();

    expect(() => openDatabase({ path })).toThrow(SchemaVersionError);
  });
});

describe("isPlaintextDatabase / encryptDatabaseInPlace (ADR-018 in-place migration)", () => {
  it("encrypts an existing plaintext database in place: pre-encryption rows survive and new writes still work", () => {
    const path = dbPath("migrate.db");
    const plain = openDatabase({ path });
    plain.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run("p1", "personal", "Luka", new Date().toISOString());
    plain.close();

    encryptDatabaseInPlace(path, KEY_A);

    const encrypted = openDatabase({ path, encryptionKey: KEY_A });
    const preExisting = encrypted.raw
      .prepare("SELECT name FROM profiles WHERE id = ?")
      .get("p1") as { name: string };
    expect(preExisting.name).toBe("Luka");

    encrypted.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run("p2", "personal", "Ana", new Date().toISOString());
    const inserted = encrypted.raw
      .prepare("SELECT name FROM profiles WHERE id = ?")
      .get("p2") as { name: string };
    expect(inserted.name).toBe("Ana");
    encrypted.close();
  });

  it("rejects opening the now-encrypted database without a key", () => {
    const path = dbPath("migrate.db");
    openDatabase({ path }).close();
    encryptDatabaseInPlace(path, KEY_A);

    expect(() => openDatabase({ path })).toThrow(DatabaseLockedError);
  });

  it("rejects opening the now-encrypted database with a wrong key", () => {
    const path = dbPath("migrate.db");
    openDatabase({ path }).close();
    encryptDatabaseInPlace(path, KEY_A);

    expect(() => openDatabase({ path, encryptionKey: KEY_B })).toThrow(DatabaseLockedError);
  });

  it("isPlaintextDatabase is true before encryption and false after", () => {
    const path = dbPath("migrate.db");
    openDatabase({ path }).close();
    expect(isPlaintextDatabase(path)).toBe(true);

    encryptDatabaseInPlace(path, KEY_A);
    expect(isPlaintextDatabase(path)).toBe(false);
  });

  it("isPlaintextDatabase is false for a path that does not exist (nothing to migrate)", () => {
    expect(isPlaintextDatabase(dbPath("missing.db"))).toBe(false);
  });

  it("refuses to encrypt an already-encrypted file", () => {
    const path = dbPath("migrate.db");
    openDatabase({ path }).close();
    encryptDatabaseInPlace(path, KEY_A);

    expect(() => encryptDatabaseInPlace(path, KEY_A)).toThrow(DatabaseKeyError);
  });

  it("rejects a malformed key, the same RAW_KEY_HEX guard openDatabase uses", () => {
    const path = dbPath("migrate.db");
    openDatabase({ path }).close();

    expect(() => encryptDatabaseInPlace(path, "not-64-hex-chars")).toThrow(DatabaseKeyError);
    // Rejected before any file mutation: the file is still plaintext.
    expect(isPlaintextDatabase(path)).toBe(true);
  });

  it("a fresh path opened with encryptionKey needs no migration step", () => {
    const path = dbPath("fresh-encrypted.db");
    openDatabase({ path, encryptionKey: KEY_A }).close();

    expect(isPlaintextDatabase(path)).toBe(false);
  });
});
