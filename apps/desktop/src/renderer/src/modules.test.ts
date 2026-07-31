import { MODULE_CATEGORIES, resolveEnabled } from "@nexus/core";
// The one place a renderer file names `@nexus/db`, and it is a TEST: the
// default dashboard layout is a db constant (`DashboardWidgetStore`) whose
// entries name widgets these manifests publish, and nothing else in the build
// can see both halves of that pairing. The renderer's own code still reaches
// the database only through main's IPC allowlist.
import { DEFAULT_DASHBOARD_LAYOUT } from "@nexus/db";
import { describe, expect, it } from "vitest";

import { DASHBOARD_WIDGETS } from "./dashboardWidgets.js";
import { createModuleRegistry } from "./modules.js";
import { strings } from "./strings.js";

/**
 * `modules.ts` is the renderer's one declaration of which modules exist
 * (ADR-008). The registry itself is `@nexus/core`'s and has its own tests, so
 * what is pinned here is the DECLARATION: the v0 set, its order, and the two
 * invariants a new manifest could silently break — a duplicate id/prefix
 * (which the registry throws on, so `createModuleRegistry()` would fail at
 * import-time in the app) and a category outside the canonical list.
 */

describe("createModuleRegistry", () => {
  it("registers the v0 module set in PRD numbering order", () => {
    expect(createModuleRegistry().all().map((manifest) => manifest.id)).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "settings",
      "notes",
      "study",
    ]);
  });

  it("gives every module a unique id and a unique PRD prefix", () => {
    const manifests = createModuleRegistry().all();
    expect(new Set(manifests.map((manifest) => manifest.id)).size).toBe(manifests.length);
    expect(new Set(manifests.map((manifest) => manifest.prefix)).size).toBe(manifests.length);
    for (const manifest of manifests) {
      expect(manifest.prefix, manifest.id).toMatch(/^[A-Z]+$/);
    }
  });

  it("only uses canonical categories, and every registered module is on by default", () => {
    for (const manifest of createModuleRegistry().all()) {
      expect(MODULE_CATEGORIES, manifest.id).toContain(manifest.category);
      // Founder decision 2026-07-12: only BUILT modules are registered, so an
      // entry that shipped disabled would be an entry that leads nowhere.
      expect(manifest.defaultEnabled, manifest.id).toBe(true);
    }
  });

  it("groups the sidebar by category in canonical order, empty categories omitted", () => {
    const grouped = createModuleRegistry().byCategory();
    expect([...grouped.keys()]).toEqual(["Core experience", "Content & knowledge", "Life hubs"]);
    expect(grouped.get("Core experience")?.map((manifest) => manifest.id)).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "settings",
    ]);
    expect(grouped.get("Content & knowledge")?.map((manifest) => manifest.id)).toEqual(["notes"]);
    expect(grouped.get("Life hubs")?.map((manifest) => manifest.id)).toEqual(["study"]);
  });

  it("is constructed per call, never a shared singleton (ADR-008)", () => {
    const first = createModuleRegistry();
    const second = createModuleRegistry();
    expect(first).not.toBe(second);
    expect(first.all()).not.toBe(second.all());
    expect(first.all().map((manifest) => manifest.id)).toEqual(
      second.all().map((manifest) => manifest.id),
    );
  });

  it("resolves to the full set with no flags, and honours an explicit off flag", () => {
    const registry = createModuleRegistry();
    expect(resolveEnabled(registry, {})).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "settings",
      "notes",
      "study",
    ]);
    expect(resolveEnabled(registry, { study: false })).not.toContain("study");
  });
});

describe("the widgets the v0 modules publish (ADR-045)", () => {
  it("publishes today's dashboard cards, each owned by the module it opens", () => {
    const registry = createModuleRegistry();
    expect(registry.widgetsOf("calendar").map((widget) => widget.id)).toEqual([
      "danas",
      "isticanja",
    ]);
    expect(registry.widgetsOf("tasks").map((widget) => widget.id)).toEqual([
      "predstojece",
      "hitno-kasni",
    ]);
    expect(registry.widgetsOf("study").map((widget) => widget.id)).toEqual(["ispiti", "ucenje"]);
    expect(registry.widgetsOf("notes").map((widget) => widget.id)).toEqual(["nedavno"]);
    // The catalogue is bigger than the default layout (DASH-003): the two
    // additions are gallery-only, and `DEFAULT_DASHBOARD_LAYOUT` still holds
    // exactly the original five.
    expect(DEFAULT_DASHBOARD_LAYOUT.map((entry) => entry.widgetId)).not.toContain(
      "tasks:hitno-kasni",
    );
    expect(DEFAULT_DASHBOARD_LAYOUT.map((entry) => entry.widgetId)).not.toContain("notes:nedavno");
  });

  it("pairs every registered widget with a renderer, and every renderer with a contract", () => {
    // The pairing ADR-045 section 3 rests on. A registered widget with no
    // renderer is one „Dodaj vidžet“ silently withholds; a renderer with no
    // contract is a card that can never be placed. Neither fails loudly in the
    // app, which is exactly why it is pinned here.
    const registry = createModuleRegistry();
    const qualified = registry
      .all()
      .flatMap((manifest) =>
        registry.widgetsOf(manifest.id).map((widget) => `${manifest.id}:${widget.id}`),
      );
    expect([...qualified].sort()).toEqual(Object.keys(DASHBOARD_WIDGETS).sort());
  });

  it("resolves every widget of the DEFAULT layout — a new profile must not open onto blanks", () => {
    const registry = createModuleRegistry();
    for (const entry of DEFAULT_DASHBOARD_LAYOUT) {
      const widget = registry.findWidget(entry.widgetId);
      expect(widget, entry.widgetId).toBeDefined();
      // A default placement must also be a size its widget actually accepts.
      expect(widget?.sizes, entry.widgetId).toContain(entry.size);
    }
  });

  it("keeps every widget id an ASCII slug and every deep link a registered module", () => {
    const registry = createModuleRegistry();
    const moduleIds = new Set(registry.all().map((manifest) => manifest.id));
    for (const manifest of registry.all()) {
      for (const widget of registry.widgetsOf(manifest.id)) {
        // An id ends up in `dashboard_widgets.widget_id` as `moduleId:widgetId`;
        // it is a key, never a label, so no diacritics and no colon of its own.
        expect(widget.id, widget.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(moduleIds, widget.id).toContain(widget.deepLink);
        expect(widget.sizes.length, widget.id).toBeGreaterThan(0);
        // `title` is a strings KEY path, not Serbian copy (WidgetContract).
        expect(widget.title, widget.id).toMatch(/^[a-zA-Z]+(?:\.[a-zA-Z]+)+$/);
      }
    }
  });

  it("names a string that really exists for every widget title", () => {
    // The convention is only worth anything if the key resolves: a title that
    // named nothing would render as the raw path the day slice b draws it.
    const registry = createModuleRegistry();
    for (const manifest of registry.all()) {
      for (const widget of registry.widgetsOf(manifest.id)) {
        const resolved = widget.title
          .split(".")
          .reduce<unknown>(
            (node, key) =>
              typeof node === "object" && node !== null
                ? (node as Record<string, unknown>)[key]
                : undefined,
            strings,
          );
        expect(typeof resolved, widget.title).toBe("string");
      }
    }
  });
});
