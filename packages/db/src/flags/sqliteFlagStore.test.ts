import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModuleRegistry, resolveEnabled } from "@nexus/core";
import type { ModuleManifest } from "@nexus/core";
import { NexusDatabase, SqliteFlagStore, openDatabase, uuidv7 } from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-flags-"));
  db = openDatabase({ path: join(dir, "flags.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(kind: "personal" | "business"): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, kind, kind, new Date().toISOString());
  return id;
}

describe("SqliteFlagStore", () => {
  it("roundtrips flags through get, and upserts overwrite", async () => {
    const store = new SqliteFlagStore(db.raw, createProfile("personal"));
    expect(await store.get()).toEqual({});

    await store.set("finance", true);
    await store.set("tasks", false);
    expect(await store.get()).toEqual({ finance: true, tasks: false });

    await store.set("finance", false);
    expect(await store.get()).toEqual({ finance: false, tasks: false });
  });

  it("isolates flags per profile", async () => {
    const personal = new SqliteFlagStore(db.raw, createProfile("personal"));
    const business = new SqliteFlagStore(db.raw, createProfile("business"));

    await personal.set("finance", true);
    await business.set("finance", false);

    expect(await personal.get()).toEqual({ finance: true });
    expect(await business.get()).toEqual({ finance: false });
  });

  it("drives resolveEnabled from @nexus/core end to end", async () => {
    const mod = (
      id: string,
      prefix: string,
      defaultEnabled: boolean,
    ): ModuleManifest => ({
      id,
      prefix,
      group: "plan",
      defaultEnabled,
    });

    const registry = new ModuleRegistry();
    registry.register(mod("tasks", "TASK", true));
    registry.register(mod("finance", "FIN", false));
    registry.register(mod("notes", "NOTE", true));

    const store = new SqliteFlagStore(db.raw, createProfile("personal"));
    await store.set("tasks", false);
    await store.set("finance", true);

    expect(resolveEnabled(registry, await store.get())).toEqual([
      "finance",
      "notes",
    ]);
  });
});
