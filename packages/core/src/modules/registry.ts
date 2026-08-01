import type { WidgetContract } from "../contracts/widgets.js";
import {
  MODULE_CATEGORIES,
  type ModuleCategory,
  type ModuleManifest,
} from "./manifest.js";

/** No widgets, shared rather than allocated per call — `widgetsOf` answers this for most modules. */
const NO_WIDGETS: readonly WidgetContract[] = [];

/**
 * Holds the compiled-in module manifests (ADR-008 static registry). Instances
 * are constructed, not global singletons, so tests and multiple profiles get
 * isolated registries.
 */
export class ModuleRegistry {
  private readonly byId = new Map<string, ModuleManifest>();
  private readonly order: ModuleManifest[] = [];

  /**
   * Registers a module. Throws on a duplicate id — that one is load-bearing,
   * because `get(id)` is how every consumer resolves a manifest and a second
   * registration would shadow the first.
   *
   * **There is deliberately no duplicate-PREFIX check.** A prefix is traceability
   * to a PRD entry, and one PRD entry can legitimately be implemented by more
   * than one app module: UTIL („Utility Belt") is exactly that case — „Fokus"
   * and „Alatke" are one PRD section but two sidebar entries and two toggles,
   * because a timer and a tool drawer are separate things to reach for and
   * separate things to switch off.
   *
   * The rule this replaces was enforced by a `byPrefix` map that nothing ever
   * read: there is no `getByPrefix` and no consumer, so it guaranteed only
   * itself. What it genuinely caught — a copy-pasted manifest whose prefix
   * nobody changed — is now pinned in `modules.test.ts` as an explicit
   * prefix→ids mapping, where the intended sharing is stated on purpose and any
   * OTHER duplicate still fails. A test that names the intent documents it;
   * a throw reading „already registered" only forbids it.
   */
  register(manifest: ModuleManifest): void {
    if (this.byId.has(manifest.id)) {
      throw new Error(`Module id "${manifest.id}" is already registered.`);
    }
    this.byId.set(manifest.id, manifest);
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
   * The widgets one module publishes, in manifest order — empty for a module
   * that publishes none, and for an id nobody registered. The two are one answer
   * on purpose: "this module has no widgets" is what a caller building a gallery
   * needs either way, and a missing module is `get`'s question, not this one.
   */
  widgetsOf(moduleId: string): readonly WidgetContract[] {
    return this.byId.get(moduleId)?.widgets ?? NO_WIDGETS;
  }

  /**
   * Resolves a QUALIFIED widget id — `moduleId:widgetId`, exactly as a stored
   * layout row spells it (migration 032 / ADR-045) — or `undefined` when this
   * build publishes no such widget.
   *
   * `undefined` is an ordinary answer here, not an error: a layout keeps rows
   * for widgets whose module was dropped from the build or switched off, so the
   * renderer asks this question about every stored placement and simply draws
   * nothing for the ones it cannot resolve.
   *
   * Split at the FIRST colon, because a module id never contains one and a
   * widget id is defined not to (`WidgetContract.id`) — so anything after a
   * second colon could only be a malformed id, which resolves to nothing.
   */
  findWidget(qualifiedId: string): WidgetContract | undefined {
    const separator = qualifiedId.indexOf(":");
    if (separator <= 0) return undefined;
    const widgetId = qualifiedId.slice(separator + 1);
    return this.widgetsOf(qualifiedId.slice(0, separator)).find(
      (widget) => widget.id === widgetId,
    );
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
