import {
  MODULE_CATEGORIES,
  type ModuleCategory,
  type ModuleManifest,
} from "./manifest.js";

/**
 * Holds the compiled-in module manifests (ADR-008 static registry). Instances
 * are constructed, not global singletons, so tests and multiple profiles get
 * isolated registries.
 */
export class ModuleRegistry {
  private readonly byId = new Map<string, ModuleManifest>();
  private readonly byPrefix = new Map<string, ModuleManifest>();
  private readonly order: ModuleManifest[] = [];

  /** Registers a module. Throws on a duplicate id or a duplicate prefix. */
  register(manifest: ModuleManifest): void {
    if (this.byId.has(manifest.id)) {
      throw new Error(`Module id "${manifest.id}" is already registered.`);
    }
    if (this.byPrefix.has(manifest.prefix)) {
      throw new Error(`Module prefix "${manifest.prefix}" is already registered.`);
    }
    this.byId.set(manifest.id, manifest);
    this.byPrefix.set(manifest.prefix, manifest);
    this.order.push(manifest);
  }

  get(id: string): ModuleManifest | undefined {
    return this.byId.get(id);
  }

  /** All registered manifests, in registration order. */
  all(): readonly ModuleManifest[] {
    return this.order;
  }

  /**
   * Manifests grouped by category, keyed in canonical category order with empty
   * categories omitted; members keep registration order. Drives the sidebar
   * category separators (DASH-008).
   */
  byCategory(): Map<ModuleCategory, ModuleManifest[]> {
    const grouped = new Map<ModuleCategory, ModuleManifest[]>();
    for (const category of MODULE_CATEGORIES) {
      const members = this.order.filter((m) => m.category === category);
      if (members.length > 0) {
        grouped.set(category, members);
      }
    }
    return grouped;
  }
}
