import { useState } from "react";
import type { DragEvent } from "react";
import type { ModuleGroup, ModuleManifest, ModuleRegistry } from "@nexus/core";
import { Button, Checkbox, Chip, Icon } from "@nexus/ui";

import { LOCKED_MODULE_IDS } from "../../shared/modules.js";
import {
  isModuleVisible,
  moveGroup,
  moveModule,
  orderedGroupKeys,
  orderedGroupMembers,
  resetShellOrder,
  setModuleVisible,
  type ShellVisibility,
} from "../../shared/moduleVisibility.js";
import { moduleName, moduleDescription } from "./moduleName.js";
import { labelClass, moduleEntryId } from "./settingsSearch.js";
import { fill, strings } from "./strings.js";

/**
 * „Prikaz" (ADR-101): the one card that decides what this device shows, and in
 * what order.
 *
 * It is the module gallery grown up rather than a second list beside it. The
 * gallery's per-profile switch is GONE — hiding a module is app-wide now — so
 * this card owns the whole question: every module by group with a switch each,
 * the groups and the modules inside them reorderable by DRAG and by KEYBOARD
 * (the two move buttons) through one write, and a reset back to the registry's
 * own order.
 *
 * **One list, so the rail and this card cannot disagree.** Every row is drawn
 * from the arrangement the shell holds (`orderedGroupKeys` /
 * `orderedGroupMembers`), which is the same arrangement `sidebarGroups` and
 * `launcherGroups` draw — move a group here and the sidebar moves in the same
 * commit. Hiding a module and moving one are the same kind of act, so they go
 * through one writer, and main validates and normalizes that write before it
 * touches the file.
 *
 * **What is deliberately not here.** A module cannot be moved BETWEEN groups: a
 * manifest declares its own group, and that is a statement about the product
 * rather than about one person's arrangement. And the two locked rows wear the
 * same „Uvek uključeno" chip the gallery always gave them, because there is no
 * switch that could be offered for them.
 */

export interface ModuleVisibilityCardProps {
  readonly registry: ModuleRegistry;
  /** The arrangement this device runs on, owned by the shell. */
  readonly moduleVisibility: ShellVisibility;
  /** Told after every write, so the rail, the launcher and every page follow in one commit. */
  readonly onModuleVisibilityChanged: (next: ShellVisibility) => void;
  /** SET-014's hit ids, so a module's own row still takes the search highlight. */
  readonly hits: ReadonlySet<string>;
}

/**
 * What a drag picked up: a group heading, or one module inside a named group.
 * Identity travels in renderer state rather than in `dataTransfer` (the
 * dashboard's and the pinned rail's own idiom — the payload is set only because
 * a browser refuses to start a drag without one).
 */
type DraggedRow =
  | { readonly kind: "group"; readonly id: ModuleGroup }
  | { readonly kind: "module"; readonly group: ModuleGroup; readonly id: string };

export function ModuleVisibilityCard({
  registry,
  moduleVisibility,
  onModuleVisibilityChanged,
  hits,
}: ModuleVisibilityCardProps) {
  const s = strings.settings;
  const c = s.visibility;
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<DraggedRow | null>(null);

  const groups = orderedGroupKeys(registry, moduleVisibility);
  const byGroup = registry.byGroup();
  const idsOf = (group: ModuleGroup): string[] =>
    orderedGroupMembers(byGroup.get(group) ?? [], moduleVisibility, group).map(
      (manifest) => manifest.id,
    );

  /**
   * The one writer. It hands main the WHOLE arrangement — the shape the file
   * holds — and takes back what was actually stored rather than what this
   * component hoped it said, because main normalizes (the two locked rows can
   * never be hidden, and an entry that only restates a manifest is dropped).
   */
  async function persist(next: ShellVisibility): Promise<void> {
    setError(null);
    try {
      const stored = await window.nexus.setModuleVisibility({
        version: next.version,
        hidden: [...next.hidden],
        shown: [...next.shown],
        groupOrder: [...next.groupOrder],
        moduleOrder: { ...next.moduleOrder },
      });
      onModuleVisibilityChanged(stored);
    } catch (writeError) {
      setError(s.modulesToggleError);
      console.error("Nexus: failed to store the module arrangement:", writeError);
    }
  }

  function toggle(manifest: ModuleManifest, visible: boolean): void {
    void persist(setModuleVisible(moduleVisibility, manifest, visible, registry));
  }

  /** One step of a group heading, taken against the order the card is drawing. */
  function stepGroup(key: ModuleGroup, delta: number): void {
    void persist(moveGroup(moduleVisibility, groups, key, delta));
  }

  /** One step of a module inside its own group, on the same terms. */
  function stepModule(group: ModuleGroup, id: string, delta: number): void {
    void persist(moveModule(moduleVisibility, group, idsOf(group), id, delta));
  }

  /**
   * A drop lands where the row it was dropped on sits, and the step is the
   * DISTANCE between the two — the same call the keyboard makes with ±1, so a
   * drag needs no index arithmetic of its own (`moveInOrder` states the rule).
   *
   * A module dropped on a module of ANOTHER group does nothing: a group is a
   * manifest's own declaration, so changing one is not this card's to do.
   */
  function dropOnGroup(target: ModuleGroup): void {
    const source = dragged;
    setDragged(null);
    if (source === null || source.kind !== "group" || source.id === target) return;
    stepGroup(source.id, groups.indexOf(target) - groups.indexOf(source.id));
  }

  function dropOnModule(group: ModuleGroup, targetId: string): void {
    const source = dragged;
    setDragged(null);
    if (source === null || source.kind !== "module") return;
    if (source.group !== group || source.id === targetId) return;
    const ids = idsOf(group);
    stepModule(group, source.id, ids.indexOf(targetId) - ids.indexOf(source.id));
  }

  /** The drag handle's mouse-only half; the buttons above are the keyboard's. */
  function gripHandlers(row: DraggedRow): {
    readonly draggable: true;
    readonly onDragStart: (event: DragEvent<HTMLSpanElement>) => void;
    readonly onDragEnd: () => void;
  } {
    return {
      draggable: true,
      onDragStart: (event) => {
        setDragged(row);
        event.dataTransfer.setData("text/plain", row.id);
        event.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: () => setDragged(null),
    };
  }

  return (
    <div className="set__visibility">
      <p className="nx-hint">{c.hint}</p>
      <p className="nx-hint">{c.orderHint}</p>

      {groups.map((group) => {
        const members = orderedGroupMembers(byGroup.get(group) ?? [], moduleVisibility, group);
        const label = strings.app.navGroups[group] ?? group;
        const groupIndex = groups.indexOf(group);
        return (
          <div className="set__module-group" key={group}>
            {/* The heading is a drop target and carries its own two step
                buttons: a group is one entry of the order the same way a module
                is, so the two are arranged the same way. */}
            <div
              className="set__visibility-heading"
              onDragOver={(event) => {
                if (dragged?.kind === "group") event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                dropOnGroup(group);
              }}
            >
              <h3 className="nx-eyebrow set__module-group-title">{label}</h3>
              <div className="set__visibility-actions">
                <span
                  className="set__visibility-grip"
                  aria-hidden="true"
                  {...gripHandlers({ kind: "group", id: group })}
                >
                  <Icon name="drag" size={14} />
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="set__visibility-move"
                  aria-label={fill(c.moveGroupUp, { name: label })}
                  title={fill(c.moveGroupUp, { name: label })}
                  disabled={groupIndex === 0}
                  onClick={() => stepGroup(group, -1)}
                >
                  <Icon name="arrowUp" size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="set__visibility-move"
                  aria-label={fill(c.moveGroupDown, { name: label })}
                  title={fill(c.moveGroupDown, { name: label })}
                  disabled={groupIndex === groups.length - 1}
                  onClick={() => stepGroup(group, 1)}
                >
                  <Icon name="arrowDown" size={14} />
                </Button>
              </div>
            </div>

            <div className="set__module-list">
              {members.map((manifest, index) => {
                const locked = LOCKED_MODULE_IDS.has(manifest.id);
                const name = moduleName(manifest.id);
                return (
                  <div
                    className="set__module-row"
                    key={manifest.id}
                    onDragOver={(event) => {
                      if (dragged?.kind === "module" && dragged.group === group) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropOnModule(group, manifest.id);
                    }}
                  >
                    <div className="set__module-info">
                      <span
                        className={labelClass(
                          "set__module-name",
                          hits.has(moduleEntryId(manifest.id)),
                        )}
                      >
                        {name}
                      </span>
                      <span className="nx-hint">{moduleDescription(manifest.id)}</span>
                    </div>
                    <div className="set__visibility-actions">
                      <span
                        className="set__visibility-grip"
                        aria-hidden="true"
                        {...gripHandlers({ kind: "module", group, id: manifest.id })}
                      >
                        <Icon name="drag" size={14} />
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="set__visibility-move"
                        aria-label={fill(c.moveUp, { name })}
                        title={fill(c.moveUp, { name })}
                        disabled={index === 0}
                        onClick={() => stepModule(group, manifest.id, -1)}
                      >
                        <Icon name="arrowUp" size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="set__visibility-move"
                        aria-label={fill(c.moveDown, { name })}
                        title={fill(c.moveDown, { name })}
                        disabled={index === members.length - 1}
                        onClick={() => stepModule(group, manifest.id, 1)}
                      >
                        <Icon name="arrowDown" size={14} />
                      </Button>
                      {locked ? (
                        <Chip>{s.modulesAlwaysOn}</Chip>
                      ) : (
                        <Checkbox
                          checked={isModuleVisible(manifest, moduleVisibility)}
                          aria-label={name}
                          onChange={(event) => toggle(manifest, event.target.checked)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {error != null && <p className="set__error">{error}</p>}
      <Button
        variant="quiet"
        className="set__reset"
        onClick={() => void persist(resetShellOrder(moduleVisibility))}
      >
        {c.reset}
      </Button>
    </div>
  );
}
