import { describe, it, expect } from "vitest";
import { ModuleRegistry } from "../modules/registry.js";
import type { ModuleCategory, ModuleManifest } from "../modules/manifest.js";
import { resolveEnabled } from "./flags.js";

function mod(
  id: string,
  prefix: string,
  category: ModuleCategory,
  defaultEnabled: boolean,
): ModuleManifest {
  return { id, prefix, category, defaultEnabled };
}

function registry(): ModuleRegistry {
  const reg = new ModuleRegistry();
  reg.register(mod("tasks", "TASK", "Core experience", true));
  reg.register(mod("finance", "FIN", "Life hubs", false));
  reg.register(mod("notes", "NOTE", "Content & knowledge", true));
  return reg;
}

describe("resolveEnabled", () => {
  it("falls back to defaultEnabled when a module's flag is absent", () => {
    expect(resolveEnabled(registry(), {})).toEqual(["tasks", "notes"]);
  });

  it("honors explicit enable and disable flags over the defaults", () => {
    expect(resolveEnabled(registry(), { tasks: false, finance: true })).toEqual([
      "finance",
      "notes",
    ]);
  });

  it("returns enabled ids in registration order", () => {
    expect(resolveEnabled(registry(), { finance: true })).toEqual([
      "tasks",
      "finance",
      "notes",
    ]);
  });
});
