import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountDir, readRegistry } from "./accounts.js";
import { REPLACED_LOCAL_STATE, absorbStrayUserData, strayUserDataDir } from "./strayUserData.js";

/**
 * The move out of the folder 2.0.0 to 2.0.2 wrote to by mistake. The cases are
 * the two installs that exist: one upgraded from 1.x, whose real folder already
 * holds accounts and preferences, and one that began on 2.x, whose real folder
 * is empty.
 */

let appData: string;
let userData: string;
let stray: string;

beforeEach(async () => {
  appData = await mkdtemp(join(tmpdir(), "nexus-stray-"));
  userData = join(appData, "Nexus");
  stray = strayUserDataDir(appData);
  mkdirSync(stray, { recursive: true });
});

afterEach(async () => {
  await rm(appData, { recursive: true, force: true });
});

function account(root: string, id: string, database = id): void {
  mkdirSync(accountDir(root, id), { recursive: true });
  writeFileSync(join(accountDir(root, id), "keychain.json"), "{}");
  writeFileSync(join(accountDir(root, id), "nexus.db"), database);
}

function registry(root: string, accounts: readonly [string, string][], lastActiveId: string | null): void {
  const entries = accounts.map(([id, label]) => ({ id, label, createdAt: "2026-10-01T00:00:00.000Z" }));
  writeFileSync(join(root, "accounts.json"), JSON.stringify({ version: 1, accounts: entries, lastActiveId }));
}

const read = (path: string) => readFileSync(path, "utf8");

describe("absorbStrayUserData", () => {
  it("names the folder Electron derived from the package name", () => {
    expect(strayUserDataDir(join("C:", "AppData"))).toBe(join("C:", "AppData", "@nexus", "desktop"));
  });

  it("brings a 2.x install's accounts, downloads and choices into an empty folder", () => {
    account(stray, "b");
    registry(stray, [["b", "Work"]], "b");
    mkdirSync(join(stray, "models", "qwen"), { recursive: true });
    writeFileSync(join(stray, "network.json"), '{"version":1,"mode":"downloads"}');

    const result = absorbStrayUserData(userData, stray);

    expect(result.failed).toEqual([]);
    expect(result.moved).toEqual(["accounts/b", "models", "network.json"]);
    expect(read(join(accountDir(userData, "b"), "nexus.db"))).toBe("b");
    expect(readRegistry(userData)).toEqual({
      version: 1,
      accounts: [{ id: "b", label: "Work", createdAt: "2026-10-01T00:00:00.000Z" }],
      lastActiveId: "b",
    });
    expect(existsSync(join(userData, "models", "qwen"))).toBe(true);
    expect(read(join(userData, "network.json"))).toContain("downloads");
  });

  it("adds 2.x accounts beside 1.x ones, selects the one used last, and never writes over an account", () => {
    account(userData, "a");
    account(userData, "same", "1.x data");
    registry(userData, [["a", "Moj nalog"], ["same", "Old"]], "a");
    writeFileSync(join(userData, "network.json"), '{"version":1,"mode":"updates"}');
    account(stray, "b");
    account(stray, "same", "2.x data");
    registry(stray, [["b", "Work"], ["same", "New"]], "b");
    writeFileSync(join(stray, "network.json"), '{"version":1,"mode":"downloads"}');

    absorbStrayUserData(userData, stray);

    const merged = readRegistry(userData);
    expect(merged.accounts.map((entry) => `${entry.id}:${entry.label}`)).toEqual(["a:Moj nalog", "same:Old", "b:Work"]);
    expect(merged.lastActiveId).toBe("b");
    expect(read(join(accountDir(userData, "same"), "nexus.db"))).toBe("1.x data");
    expect(read(join(accountDir(stray, "same"), "nexus.db"))).toBe("2.x data");
    expect(read(join(userData, "network.json"))).toContain("downloads");
  });

  it("keeps this folder's own downloads and leaves the stray ones where they are", () => {
    mkdirSync(join(userData, "packs", "mine"), { recursive: true });
    mkdirSync(join(stray, "packs", "theirs"), { recursive: true });

    expect(absorbStrayUserData(userData, stray).moved).toEqual([]);
    expect(existsSync(join(userData, "packs", "theirs"))).toBe(false);
    expect(existsSync(join(stray, "packs", "theirs"))).toBe(true);
  });

  it("leaves a directory without a key chain, which is a create that never finished", () => {
    mkdirSync(accountDir(stray, "half"), { recursive: true });
    expect(absorbStrayUserData(userData, stray).moved).toEqual([]);
    expect(existsSync(accountDir(stray, "half"))).toBe(true);
  });

  it("changes nothing on a second run, and nothing when there is no stray folder", () => {
    account(stray, "b");
    registry(stray, [["b", "Work"]], "b");
    absorbStrayUserData(userData, stray);
    const before = read(join(userData, "accounts.json"));

    expect(absorbStrayUserData(userData, stray)).toEqual({ moved: [], failed: [] });
    expect(read(join(userData, "accounts.json"))).toBe(before);
    expect(absorbStrayUserData(userData, join(appData, "missing"))).toEqual({ moved: [], failed: [] });
  });

  describe("the safeStorage key in Local State", () => {
    it("comes with the accounts into a folder that has none", () => {
      account(stray, "b");
      writeFileSync(join(stray, "Local State"), "2.x key");

      expect(absorbStrayUserData(userData, stray).moved).toEqual(["Local State", "accounts/b"]);
      expect(read(join(userData, "Local State"))).toBe("2.x key");
    });

    it("replaces a 1.x key, which is kept beside it, because the 2.x accounts are the ones used last", () => {
      account(userData, "a");
      writeFileSync(join(userData, "Local State"), "1.x key");
      account(stray, "b");
      writeFileSync(join(stray, "Local State"), "2.x key");

      absorbStrayUserData(userData, stray);

      expect(read(join(userData, "Local State"))).toBe("2.x key");
      expect(read(join(userData, REPLACED_LOCAL_STATE))).toBe("1.x key");
    });

    it("stays where it is when 2.x made no account, so the 1.x accounts keep their key", () => {
      account(userData, "a");
      writeFileSync(join(userData, "Local State"), "1.x key");
      writeFileSync(join(stray, "Local State"), "2.x key");

      absorbStrayUserData(userData, stray);

      expect(read(join(userData, "Local State"))).toBe("1.x key");
      expect(read(join(stray, "Local State"))).toBe("2.x key");
    });

    it("finishes a pass that stopped between keeping the old key and moving the new one", () => {
      mkdirSync(userData, { recursive: true });
      writeFileSync(join(userData, REPLACED_LOCAL_STATE), "1.x key");
      account(stray, "b");
      writeFileSync(join(stray, "Local State"), "2.x key");

      absorbStrayUserData(userData, stray);

      expect(read(join(userData, "Local State"))).toBe("2.x key");
      expect(read(join(userData, REPLACED_LOCAL_STATE))).toBe("1.x key");
    });
  });

  it("does nothing when the stray folder is this one", () => {
    account(stray, "b");
    expect(absorbStrayUserData(stray, stray)).toEqual({ moved: [], failed: [] });
  });
});
