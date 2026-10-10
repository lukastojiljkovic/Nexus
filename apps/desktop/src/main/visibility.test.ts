import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModuleRegistry, type ModuleGroup, type ModuleManifest } from "@nexus/core";

import type { FlagState } from "../shared/ipc.js";
import { DEFAULT_SHELL_VISIBILITY, visibleModuleIds } from "../shared/moduleVisibility.js";
import {
  asModuleVisibility,
  createShellVisibilityMigration,
  readShellVisibility,
  resolveShellVisibility,
  shellVisibilityPath,
  shellVisibilityUnset,
  showEveryModule,
  writeShellVisibility,
} from "./visibility.js";

/**
 * The device setting's FILE: the round trip, the refusals, the atomic write,
 * and the one-time union of the per-profile switches this setting replaces
 * (ADR-101 §3).
 *
 * Every case works on a throwaway `userData` directory under `%TEMP%` rather
 * than a mock, because what is being pinned is a behaviour of the filesystem
 * contract — a real file, a real rename, and a real half-written file read back
 * as „nothing recorded".
 */

let userData: string;

function mod(id: string, group: ModuleGroup, defaultEnabled: boolean): ModuleManifest {
  return { id, prefix: id.toUpperCase(), group, defaultEnabled };
}

function registry(withGhost = false): ModuleRegistry {
  const reg = new ModuleRegistry();
  reg.register(mod("dashboard", "shell", true));
  reg.register(mod("settings", "shell", true));
  reg.register(mod("tasks", "plan", true));
  reg.register(mod("finance", "life", true));
  reg.register(mod("priv", "life", false));
  if (withGhost) reg.register(mod("ghost", "make", false));
  return reg;
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-visibility-"));
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe("the file", () => {
  it("round-trips the arrangement exactly", () => {
    const stored = {
      version: 1,
      hidden: ["tasks", "gone"],
      shown: ["priv"],
      groupOrder: ["life", "plan"],
      moduleOrder: { life: ["priv", "finance"] },
    };
    writeShellVisibility(userData, stored);
    expect(readShellVisibility(userData)).toEqual(stored);
  });

  it("writes the version and nothing else this build does not understand", () => {
    writeShellVisibility(userData, DEFAULT_SHELL_VISIBILITY);
    const raw = JSON.parse(readFileSync(shellVisibilityPath(userData), "utf8")) as unknown;
    expect(raw).toEqual({
      version: 1,
      hidden: [],
      shown: [],
      groupOrder: [],
      moduleOrder: {},
    });
  });

  it("leaves no temporary file behind", () => {
    writeShellVisibility(userData, DEFAULT_SHELL_VISIBILITY);
    expect(existsSync(`${shellVisibilityPath(userData)}.tmp`)).toBe(false);
  });

  it("reads a missing file as nothing recorded, and the app as it ships", () => {
    expect(shellVisibilityUnset(userData)).toBe(true);
    expect(readShellVisibility(userData)).toBeNull();
    expect(resolveShellVisibility(userData)).toEqual(DEFAULT_SHELL_VISIBILITY);
  });

  it("reads a truncated or malformed file as nothing recorded", () => {
    writeFileSync(shellVisibilityPath(userData), '{"version":1,"hidden":["tas', "utf8");
    expect(readShellVisibility(userData)).toBeNull();
    expect(resolveShellVisibility(userData)).toEqual(DEFAULT_SHELL_VISIBILITY);
  });

  it("refuses a FUTURE version rather than reading the fields it happens to carry", () => {
    const future = {
      version: 2,
      hidden: ["tasks"],
      shown: [],
      groupOrder: [],
      moduleOrder: {},
      // A field a later build added; this one must not drop it by writing back.
      perProfile: { someone: ["tasks"] },
    };
    writeFileSync(shellVisibilityPath(userData), JSON.stringify(future), "utf8");
    expect(readShellVisibility(userData)).toBeNull();
    expect(resolveShellVisibility(userData)).toEqual(DEFAULT_SHELL_VISIBILITY);
    // And the file is untouched by a read — nothing rewrote what it could not parse.
    expect(JSON.parse(readFileSync(shellVisibilityPath(userData), "utf8"))).toEqual(future);
  });

  it("refuses a version-less file, from before this setting existed", () => {
    writeFileSync(shellVisibilityPath(userData), JSON.stringify({ hidden: ["tasks"] }), "utf8");
    expect(readShellVisibility(userData)).toBeNull();
  });

  it("knows a file has been written once one has", () => {
    writeShellVisibility(userData, DEFAULT_SHELL_VISIBILITY);
    expect(shellVisibilityUnset(userData)).toBe(false);
  });
});

describe("asModuleVisibility", () => {
  it("accepts the shape and normalizes nothing itself", () => {
    const value = { ...DEFAULT_SHELL_VISIBILITY, hidden: ["tasks"] };
    expect(asModuleVisibility(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it("refuses anything else with the standard refusal", () => {
    for (const junk of [null, {}, { version: 2 }, { version: 1, hidden: "tasks" }, "[]"]) {
      expect(() => asModuleVisibility(junk)).toThrow(/Invalid IPC payload/);
    }
  });
});

describe("the migration", () => {
  const profile = (id: string, flags: FlagState): { id: string; flags: FlagState } => ({ id, flags });

  it("is open only on a launch that found no file", () => {
    expect(createShellVisibilityMigration(userData, registry()).open).toBe(true);
    writeShellVisibility(userData, DEFAULT_SHELL_VISIBILITY);
    expect(createShellVisibilityMigration(userData, registry()).open).toBe(false);
  });

  it("starts the setting as the union of what the profiles had on", () => {
    const migration = createShellVisibilityMigration(userData, registry());
    const merged = migration.merge([
      // One profile: everything at its default.
      profile("p1", {}),
      // The next: TASKS switched off, PRIV switched on.
      profile("p2", { tasks: false, priv: true }),
    ]);
    // TASKS is on because the first profile had it on — that is what a union is.
    expect(merged).not.toBeNull();
    expect(visibleModuleIds(registry(), merged ?? DEFAULT_SHELL_VISIBILITY)).toEqual([
      "dashboard",
      "settings",
      "tasks",
      "finance",
      "priv",
    ]);
    expect(readShellVisibility(userData)).toEqual(merged);
  });

  it("rescues a module the FIRST profile had off but a later one had on", () => {
    const migration = createShellVisibilityMigration(userData, registry());
    // The first profile is the only one readable so far, and it answered the
    // questionnaire with TASKS off — so the seed hides it.
    const seeded = migration.merge([profile("p1", { tasks: false })]);
    expect(seeded?.hidden).toEqual(["tasks"]);
    // The second profile had it on, and that is the union growing rather than
    // the migration starting over.
    const grown = migration.merge([profile("p2", {})]);
    expect(grown?.hidden).toEqual([]);
    expect(visibleModuleIds(registry(), grown ?? DEFAULT_SHELL_VISIBILITY)).toContain("tasks");
  });

  it("reads a profile once, so unlocking the same account again changes nothing", () => {
    const migration = createShellVisibilityMigration(userData, registry());
    const once = migration.merge([profile("p1", { priv: true })]);
    expect(migration.mergedProfiles.has("p1")).toBe(true);
    expect(migration.merge([profile("p1", {})])).toBeNull();
    expect(readShellVisibility(userData)).toEqual(once);
  });

  it("records an opt-in module somebody had switched on", () => {
    const merged = createShellVisibilityMigration(userData, registry()).merge([
      profile("p1", { priv: true }),
    ]);
    expect(merged?.shown).toEqual(["priv"]);
    // A fresh profile's defaults had everything else on, so nothing is hidden.
    expect(merged?.hidden).toEqual([]);
    expect(visibleModuleIds(registry(), merged ?? DEFAULT_SHELL_VISIBILITY)).toContain("priv");
  });

  it("ignores an id this build does not have, because the union is resolved from the registry", () => {
    const merged = createShellVisibilityMigration(userData, registry()).merge([
      profile("p1", { ghost: true }),
    ]);
    expect(visibleModuleIds(registry(), merged ?? DEFAULT_SHELL_VISIBILITY)).not.toContain("ghost");
    expect(merged?.shown).toEqual([]);
  });

  it("does nothing at all once the window has closed", () => {
    writeShellVisibility(userData, { ...DEFAULT_SHELL_VISIBILITY, hidden: ["tasks"] });
    const migration = createShellVisibilityMigration(userData, registry());
    expect(migration.merge([profile("p1", {})])).toBeNull();
    expect(readShellVisibility(userData)?.hidden).toEqual(["tasks"]);
  });
});

describe("showEveryModule", () => {
  it("shows every module this build has, including the two that ship off", () => {
    const value = showEveryModule(userData, registry());
    expect(visibleModuleIds(registry(), value)).toEqual([
      "dashboard",
      "settings",
      "tasks",
      "finance",
      "priv",
    ]);
    expect(readShellVisibility(userData)).toEqual(value);
  });
});
