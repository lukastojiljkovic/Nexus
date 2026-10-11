import type { WidgetContract } from "../contracts/widgets.js";
import type { SearchKind } from "../search/searchQuery.js";
import {
  MODULE_GROUPS,
  type ModuleGroup,
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
  /** Which module owns each indexed search kind, as the manifests declare it (`searchIndexers`). */
  private readonly searchOwners = new Map<SearchKind, string>();

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
    // Every claim is checked before any is recorded, so a refused manifest
    // leaves the registry exactly as it found it.
    const claimed = new Set<SearchKind>();
    for (const { kind } of manifest.searchIndexers ?? []) {
      const owner = this.searchOwners.get(kind);
      if (owner !== undefined) {
        throw new Error(
          `Search kind "${kind}" is claimed by "${owner}" and "${manifest.id}"; one module owns each kind.`,
        );
      }
      if (claimed.has(kind)) {
        throw new Error(`Search kind "${kind}" is claimed twice by "${manifest.id}".`);
      }
      claimed.add(kind);
    }
    for (const kind of claimed) this.searchOwners.set(kind, manifest.id);
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
   * The module that owns an indexed search kind — whose flag decides whether a
   * hit of that kind is shown, and whose page opens it (ADR-058 §5) — or
   * `undefined` when no registered module declares it.
   *
   * `undefined` is an answer and not an error, for `findWidget`'s reason: a
   * build without the module still has the kind's index (a migration made it),
   * so its rows can exist, and a hit owned by no module is a hit no enabled
   * module shows. That the SHIPPING registry leaves no kind unowned is pinned by
   * the desktop app's own tests, where the complete set of modules is.
   */
  searchKindOwner(kind: SearchKind): string | undefined {
    return this.searchOwners.get(kind);
  }

  /**
   * Manifests grouped by navigation group, keyed in `MODULE_GROUPS` order with
   * empty groups omitted; members keep registration order. Drives the sidebar's
   * blocks, the launcher's sections, the Settings module gallery and the
   * onboarding chooser (ADR-093).
   *
   * `shell` is INCLUDED when it has members, rather than filtered out here: the
   * three galleries above draw it as an ordinary heading, and the sidebar is the
   * one caller that splits it into the rail's two heading-less ends. Deciding
   * that here would put a sidebar rule in a registry that knows nothing about a
   * sidebar.
   */
  byGroup(): Map<ModuleGroup, ModuleManifest[]> {
    const grouped = new Map<ModuleGroup, ModuleManifest[]>();
    for (const group of MODULE_GROUPS) {
      const members = this.order.filter((m) => m.group === group);
      if (members.length > 0) {
        grouped.set(group, members);
      }
    }
    return grouped;
  }
}
