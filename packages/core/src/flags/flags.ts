import type { ModuleRegistry } from "../modules/registry.js";

/**
 * Per-profile module enable/disable state, keyed by module id (ADR-008: flags
 * are data — synced per-profile rows). A missing key means "no override; use
 * the manifest default".
 */
export type FlagState = Record<string, boolean>;

/**
 * Resolves the ids of the modules that are effectively enabled, in registration
 * order. A module is enabled when its flag is present and true, or absent and
 * the manifest's `defaultEnabled` is true.
 */
export function resolveEnabled(
  registry: ModuleRegistry,
  flagState: FlagState,
): string[] {
  return registry
    .all()
    .filter((manifest) => flagState[manifest.id] ?? manifest.defaultEnabled)
    .map((manifest) => manifest.id);
}

/**
 * Reads and writes flag state. Concrete implementations are per-platform and
 * land with the storage/sync layer (ADR-001/ADR-002).
 */
export interface FlagStore {
  get(): Promise<FlagState>;
  set(moduleId: string, enabled: boolean): Promise<void>;
}
