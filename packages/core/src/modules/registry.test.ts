import { describe, it, expect } from "vitest";
import { ModuleRegistry } from "./registry.js";
import type { ModuleGroup, ModuleManifest } from "./manifest.js";
import type { WidgetContract } from "../contracts/widgets.js";
import type { SearchKind } from "../search/searchQuery.js";

function mod(
  id: string,
  prefix: string,
  group: ModuleGroup,
): ModuleManifest {
  return { id, prefix, group, defaultEnabled: true };
}

function widget(id: string, deepLink: string): WidgetContract {
  return { id, title: `${deepLink}.${id}.title`, sizes: ["S", "M", "L"], deepLink };
}

function modWithWidgets(
  id: string,
  prefix: string,
  widgets: WidgetContract[],
): ModuleManifest {
  return { ...mod(id, prefix, "plan"), widgets };
}

describe("ModuleRegistry", () => {
  it("rejects a duplicate module id", () => {
    const reg = new ModuleRegistry();
    reg.register(mod("tasks", "TASK", "plan"));
    expect(() => reg.register(mod("tasks", "OTHER", "life"))).toThrow(
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
    reg.register(mod("focus", "UTIL", "make"));
    expect(() => reg.register(mod("tools", "UTIL", "make"))).not.toThrow();
    expect(reg.all().map((m) => m.id)).toEqual(["focus", "tools"]);
    expect(reg.get("focus")?.prefix).toBe("UTIL");
    expect(reg.get("tools")?.prefix).toBe("UTIL");
  });

  it("returns manifests in registration order from all()", () => {
    const reg = new ModuleRegistry();
    reg.register(mod("notes", "NOTE", "knowledge"));
    reg.register(mod("tasks", "TASK", "plan"));
    reg.register(mod("finance", "FIN", "life"));
    expect(reg.all().map((m) => m.id)).toEqual(["notes", "tasks", "finance"]);
  });

  it("looks up by id, and returns undefined for an unknown id", () => {
    const reg = new ModuleRegistry();
    const tasks = mod("tasks", "TASK", "plan");
    reg.register(tasks);
    expect(reg.get("tasks")).toBe(tasks);
    expect(reg.get("missing")).toBeUndefined();
  });

  it("groups by navigation group in canonical order, skipping empty groups", () => {
    const reg = new ModuleRegistry();
    // Registered out of group order to prove grouping re-orders by group.
    reg.register(mod("pro", "PRO", "make"));
    reg.register(mod("notes", "NOTE", "knowledge"));
    reg.register(mod("tasks", "TASK", "plan"));
    reg.register(mod("canvas", "CANV", "make"));

    const grouped = reg.byGroup();

    expect([...grouped.keys()]).toEqual(["plan", "knowledge", "make"]);
    // Members keep registration order within a group.
    expect(grouped.get("make")?.map((m) => m.id)).toEqual(["pro", "canvas"]);
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
    reg.register(mod("settings", "SET", "shell"));
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

describe("ModuleRegistry search ownership (ADR-008, ADR-058 §5)", () => {
  function owning(id: string, ...kinds: SearchKind[]): ModuleManifest {
    return { ...mod(id, id.toUpperCase(), "shell"), searchIndexers: kinds.map((kind) => ({ kind })) };
  }

  it("answers with the module a manifest says owns the kind", () => {
    const reg = new ModuleRegistry();
    reg.register(owning("notes", "note", "attachment"));
    reg.register(owning("study", "subject", "exam"));
    expect(reg.searchKindOwner("note")).toBe("notes");
    expect(reg.searchKindOwner("attachment")).toBe("notes");
    expect(reg.searchKindOwner("exam")).toBe("study");
  });

  it("answers undefined for a kind no registered module owns — a hit no flag can switch on", () => {
    const reg = new ModuleRegistry();
    reg.register(owning("notes", "note"));
    reg.register(mod("canvas", "CANV", "knowledge"));
    expect(reg.searchKindOwner("circuit")).toBeUndefined();
  });

  it("rejects a kind two modules claim, naming both — „which page opens it“ would have no answer", () => {
    const reg = new ModuleRegistry();
    reg.register(owning("notes", "note", "attachment"));
    expect(() => reg.register(owning("files", "attachment"))).toThrow(/attachment.*notes.*files/);
  });

  it("rejects a kind one module claims twice", () => {
    const reg = new ModuleRegistry();
    expect(() => reg.register(owning("study", "deck", "deck"))).toThrow(/deck/);
  });

  it("leaves nothing half-registered when a claim is refused", () => {
    const reg = new ModuleRegistry();
    reg.register(owning("notes", "note"));
    expect(() => reg.register(owning("files", "task", "note"))).toThrow();
    expect(reg.get("files")).toBeUndefined();
    expect(reg.searchKindOwner("task")).toBeUndefined();
  });
});
