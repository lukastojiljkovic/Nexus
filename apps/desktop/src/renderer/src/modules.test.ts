import { MODULE_CATEGORIES, resolveEnabled } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "./modules.js";

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
