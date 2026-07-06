import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import {
  DatabaseLockedError,
  SchemaVersionError,
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
