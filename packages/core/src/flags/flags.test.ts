import { describe, it, expect } from "vitest";
import { ModuleRegistry } from "../modules/registry.js";
import type { ModuleGroup, ModuleManifest } from "../modules/manifest.js";
import { resolveEnabled } from "./flags.js";

function mod(
  id: string,
  prefix: string,
  group: ModuleGroup,
  defaultEnabled: boolean,
): ModuleManifest {
  return { id, prefix, group, defaultEnabled };
}

function registry(): ModuleRegistry {
  const reg = new ModuleRegistry();
  reg.register(mod("tasks", "TASK", "plan", true));
  reg.register(mod("finance", "FIN", "life", false));
  reg.register(mod("notes", "NOTE", "knowledge", true));
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
