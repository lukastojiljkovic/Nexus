import { describe, it, expect } from "vitest";
import { ModuleRegistry } from "./registry.js";
import type { ModuleCategory, ModuleManifest } from "./manifest.js";

function mod(
  id: string,
  prefix: string,
  category: ModuleCategory,
): ModuleManifest {
  return { id, prefix, category, defaultEnabled: true };
}

describe("ModuleRegistry", () => {
  it("rejects a duplicate module id", () => {
    const reg = new ModuleRegistry();
    reg.register(mod("tasks", "TASK", "Core experience"));
    expect(() => reg.register(mod("tasks", "OTHER", "Life hubs"))).toThrow(
      /tasks/,
    );
  });

  it("rejects a duplicate prefix", () => {
    const reg = new ModuleRegistry();
    reg.register(mod("tasks", "TASK", "Core experience"));
    expect(() => reg.register(mod("todo", "TASK", "Life hubs"))).toThrow(/TASK/);
  });

  it("returns manifests in registration order from all()", () => {
    const reg = new ModuleRegistry();
    reg.register(mod("notes", "NOTE", "Content & knowledge"));
    reg.register(mod("tasks", "TASK", "Core experience"));
    reg.register(mod("finance", "FIN", "Life hubs"));
    expect(reg.all().map((m) => m.id)).toEqual(["notes", "tasks", "finance"]);
  });

  it("looks up by id, and returns undefined for an unknown id", () => {
    const reg = new ModuleRegistry();
    const tasks = mod("tasks", "TASK", "Core experience");
    reg.register(tasks);
    expect(reg.get("tasks")).toBe(tasks);
    expect(reg.get("missing")).toBeUndefined();
  });

  it("groups by category in canonical order, skipping empty categories", () => {
    const reg = new ModuleRegistry();
    // Registered out of category order to prove grouping re-orders by category.
    reg.register(mod("automation", "AUTO", "Growth & platform"));
    reg.register(mod("notes", "NOTE", "Content & knowledge"));
    reg.register(mod("tasks", "TASK", "Core experience"));
    reg.register(mod("canvas", "CANV", "Content & knowledge"));

    const grouped = reg.byCategory();

    expect([...grouped.keys()]).toEqual([
      "Core experience",
      "Content & knowledge",
      "Growth & platform",
    ]);
    // Members keep registration order within a category.
    expect(grouped.get("Content & knowledge")?.map((m) => m.id)).toEqual([
      "notes",
      "canvas",
    ]);
  });
});
