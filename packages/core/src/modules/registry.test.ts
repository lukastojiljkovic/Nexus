import { describe, it, expect } from "vitest";
import { ModuleRegistry } from "./registry.js";
import type { ModuleCategory, ModuleManifest } from "./manifest.js";
import type { WidgetContract } from "../contracts/widgets.js";

function mod(
  id: string,
  prefix: string,
  category: ModuleCategory,
): ModuleManifest {
  return { id, prefix, category, defaultEnabled: true };
}

function widget(id: string, deepLink: string): WidgetContract {
  return { id, title: `${deepLink}.${id}.title`, sizes: ["S", "M", "L"], deepLink };
}

function modWithWidgets(
  id: string,
  prefix: string,
  widgets: WidgetContract[],
): ModuleManifest {
  return { ...mod(id, prefix, "Core experience"), widgets };
}

describe("ModuleRegistry", () => {
  it("rejects a duplicate module id", () => {
    const reg = new ModuleRegistry();
    reg.register(mod("tasks", "TASK", "Core experience"));
    expect(() => reg.register(mod("tasks", "OTHER", "Life hubs"))).toThrow(
      /tasks/,
    );
  });

  /**
   * The registry deliberately ALLOWS a shared prefix, and this pins that it is
   * a decision rather than an oversight.
   *
   * A prefix is traceability to a PRD entry, and one PRD entry can legitimately
   * be implemented by more than one app module — UTIL („Utility Belt") is that
   * case in the shipping app, where „Fokus" and „Alatke" are one PRD section
   * but two sidebar entries and two toggles. The check that used to live here
   * was backed by a `byPrefix` map nothing ever read (there is no
   * `getByPrefix`), so it guaranteed only itself; what it genuinely caught — a
   * copy-pasted manifest whose prefix nobody changed — is now an explicit
   * prefix→ids mapping in the desktop app's `modules.test.ts`, where the
   * intended sharing is written down and any other duplicate still fails.
   */
  it("allows two modules to share a PRD prefix, while both stay reachable by id", () => {
    const reg = new ModuleRegistry();
    reg.register(mod("focus", "UTIL", "Professional & utilities"));
    expect(() => reg.register(mod("tools", "UTIL", "Professional & utilities"))).not.toThrow();
    expect(reg.all().map((m) => m.id)).toEqual(["focus", "tools"]);
    expect(reg.get("focus")?.prefix).toBe("UTIL");
    expect(reg.get("tools")?.prefix).toBe("UTIL");
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

describe("ModuleRegistry widgets (ADR-045)", () => {
  function registry(): ModuleRegistry {
    const reg = new ModuleRegistry();
    reg.register(
      modWithWidgets("calendar", "CAL", [widget("danas", "calendar"), widget("isticanja", "calendar")]),
    );
    reg.register(modWithWidgets("study", "STUDY", [widget("ispiti", "study")]));
    // A module that publishes none — the common case for now.
    reg.register(mod("settings", "SET", "Core experience"));
    return reg;
  }

  it("lists a module's widgets in manifest order", () => {
    expect(registry().widgetsOf("calendar").map((w) => w.id)).toEqual(["danas", "isticanja"]);
  });

  it("answers with an empty list for a module that publishes none, and for one nobody registered", () => {
    expect(registry().widgetsOf("settings")).toEqual([]);
    expect(registry().widgetsOf("finance")).toEqual([]);
  });

  it("resolves a qualified `moduleId:widgetId`", () => {
    const found = registry().findWidget("calendar:isticanja");
    expect(found?.id).toBe("isticanja");
    expect(found?.title).toBe("calendar.isticanja.title");
  });

  it("returns undefined for a widget this build does not publish — a layout keeps such rows", () => {
    const reg = registry();
    expect(reg.findWidget("calendar:nepostojeci")).toBeUndefined();
    expect(reg.findWidget("finance:budzet")).toBeUndefined();
  });

  it("returns undefined for an id that is not qualified at all", () => {
    const reg = registry();
    expect(reg.findWidget("danas")).toBeUndefined();
    expect(reg.findWidget("")).toBeUndefined();
    expect(reg.findWidget(":danas")).toBeUndefined();
  });

  it("splits at the FIRST colon, so a trailing one cannot resolve to a real widget", () => {
    expect(registry().findWidget("calendar:danas:extra")).toBeUndefined();
  });
});
