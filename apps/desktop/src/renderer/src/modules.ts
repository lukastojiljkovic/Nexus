import { ModuleRegistry, type ModuleManifest } from "@nexus/core";

/**
 * The v0 module set (roadmap "v0 — Founder Build"), as minimal ADR-008
 * manifests: identity only, contract slots (widgets, settings, …) land with
 * each module's real implementation. Categories mirror the PRD 00 registry;
 * registration order follows the PRD numbering, and the sidebar groups them by
 * `MODULE_CATEGORIES` order with separators (DASH-008, decision #11).
 */
const V0_MODULES: ModuleManifest[] = [
  { id: "dashboard", prefix: "DASH", category: "Core experience", defaultEnabled: true },
  { id: "tasks", prefix: "TASK", category: "Core experience", defaultEnabled: true },
  { id: "calendar", prefix: "CAL", category: "Core experience", defaultEnabled: true },
  { id: "settings", prefix: "SET", category: "Core experience", defaultEnabled: true },
  { id: "notes", prefix: "NOTE", category: "Content & knowledge", defaultEnabled: true },
  { id: "study", prefix: "STUDY", category: "Life hubs", defaultEnabled: true },
];

/** Builds the renderer's registry. Constructed (not a singleton) per ADR-008. */
export function createModuleRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  for (const manifest of V0_MODULES) {
    registry.register(manifest);
  }
  return registry;
}
