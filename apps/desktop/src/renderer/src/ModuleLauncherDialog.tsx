import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { ModuleRegistry } from "@nexus/core";
import { Button, Dialog, Icon, TextField } from "@nexus/ui";

import type { ShellVisibility } from "../../shared/moduleVisibility.js";
import { moduleIconName } from "./moduleIcon.js";
import { MAX_PINNED_MODULES } from "./navPrefs.js";
import {
  filterLauncherGroups,
  launcherGroups,
  launcherTileIds,
  nextLauncherIndex,
  type LauncherGroup,
} from "./moduleLauncher.js";
import { fill, lookup, strings } from "./strings.js";

/**
 * „Svi moduli" (ADR-093 §4): every module the profile has on, as a grid of
 * tiles, with a search field the dialog opens on.
 *
 * **Why an overlay and not just a longer rail.** Thirty-five rows in a 220px
 * column is a list you scroll rather than read, and the rail is the app's
 * furniture rather than a catalogue. The rail keeps what somebody reaches for
 * daily — the shell's two ends, their own pins, and the groups they open — and
 * this is where you go when you do not know which group a module is under. That
 * is also why it searches: the question it answers is „where is X", and X is
 * usually half a word.
 *
 * Drawn with the kit's `Dialog`: Escape and the backdrop close, focus lands in
 * the panel and returns where it came from, and the open dialog holds the modal
 * layer, so the shell's chords (Alt+2, Ctrl+K…) cannot act through it. Nothing
 * here writes a preference of its own — the pin toggle reports up, and the shell
 * owns the list.
 */

export interface ModuleLauncherProps {
  registry: ModuleRegistry;
  /** The enabled module ids — the SAME set the rail is filtered through, so the two surfaces cannot disagree. */
  enabledModules: ReadonlySet<string>;
  /** The device's arrangement (ADR-101), so the tiles are grouped and ordered exactly as the rail is. */
  moduleVisibility: ShellVisibility;
  /** This profile's pins, so a tile can say whether it is already at the top. */
  pinned: readonly string[];
  onOpen: (moduleId: string) => void;
  onTogglePin: (moduleId: string) => void;
  onClose: () => void;
}

export function ModuleLauncherDialog({
  registry,
  enabledModules,
  moduleVisibility,
  pinned,
  onOpen,
  onTogglePin,
  onClose,
}: ModuleLauncherProps) {
  const s = strings.app.launcher;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  // Recomputed rather than memoised, and that is a locale question: the copy is
  // read from the live table, which is rewritten in place when the language
  // changes (`strings.ts`), so a memo keyed on the registry would keep the old
  // language's descriptions. Sixteen tiles are cheap.
  // The two lines come from `launcherGroups`'s own default (`launcherTileCopy`),
  // which is the one resolver every other surface draws a module's name and
  // sentence through, kit modules included.
  const groups = launcherGroups(registry, enabledModules, undefined, moduleVisibility);
  const visible = filterLauncherGroups(groups, query);
  const ids = launcherTileIds(visible);
  // Out-of-range answers nothing rather than clamping: the list shrinks as the
  // query narrows, and this keeps the render honest about which tile is active.
  const activeId = ids[activeIndex];

  /**
   * ↑/↓ move the highlight and Enter opens it, both from the field the caret is
   * already in — `CanvasCardPicker`'s model, and the reason the whole grid is
   * reachable without a single Tab.
   *
   * One step per press in DOM order, and NOT a 2D walk: the grid's column count
   * exists only after layout (`auto-fill`), so a left/right step would be a
   * number this component cannot know. `nextLauncherIndex` states that in full.
   */
  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => nextLauncherIndex(index, ids.length, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => nextLauncherIndex(index, ids.length, -1));
      return;
    }
    if (event.key === "Enter" && activeId !== undefined) {
      event.preventDefault();
      onOpen(activeId);
    }
  }

  /** One tile: the module it opens, and whether it is already on the shortlist. */
  function tile(moduleId: string, tileIndex: number, copy: { name: string; description: string }) {
    const isPinned = pinned.includes(moduleId);
    const icon = moduleIconName(moduleId);
    const full = !isPinned && pinned.length >= MAX_PINNED_MODULES;
    return (
      <div
        key={moduleId}
        className={moduleId === activeId ? "launcher__tile launcher__tile--active" : "launcher__tile"}
      >
        <button
          type="button"
          className="launcher__open"
          // Keeping the highlight under the focus means Tab and ↓ can never
          // disagree about which tile Enter would open.
          onFocus={() => setActiveIndex(tileIndex)}
          onMouseEnter={() => setActiveIndex(tileIndex)}
          onClick={() => onOpen(moduleId)}
        >
          <span className="launcher__name">
            {icon !== undefined && <Icon name={icon} size={16} />}
            {copy.name}
          </span>
          <span className="launcher__description nx-hint">{copy.description}</span>
        </button>
        {/* A pin at the cap is DISABLED and says why in its own title, rather
            than disappearing: a control whose presence depends on a count is
            one the user has to count to explain. */}
        <button
          type="button"
          className={isPinned ? "launcher__pin launcher__pin--on" : "launcher__pin"}
          aria-pressed={isPinned}
          disabled={full}
          {...(full ? { title: strings.app.pinFull } : {})}
          aria-label={fill(isPinned ? strings.app.unpinModule : strings.app.pinModule, {
            name: copy.name,
          })}
          onClick={() => onTogglePin(moduleId)}
        >
          <Icon name={isPinned ? "pinFilled" : "pin"} size={14} />
        </button>
      </div>
    );
  }

  /**
   * Every tile of a group, numbered along the flattened list the arrows walk —
   * `offset` is where this group starts in it, so the highlight index is
   * arithmetic rather than a search.
   */
  function groupSection(group: LauncherGroup, offset: number) {
    return (
      <section key={group.key} className="launcher__group">
        <h3 className="nx-eyebrow launcher__group-title">
          {lookup(strings.app.navGroups, group.key) ?? group.key}
        </h3>
        <div className="launcher__grid">
          {group.tiles.map((tileEntry, index) => tile(tileEntry.id, offset + index, tileEntry))}
        </div>
      </section>
    );
  }

  /** Where each group starts in the flattened list the arrows walk, accumulated in draw order — the same order the highlight indexes. */
  const sections: ReactNode[] = [];
  let offset = 0;
  for (const group of visible) {
    sections.push(groupSection(group, offset));
    offset += group.tiles.length;
  }

  // Focus lands on the search field: the dialog's default is the first tabbable
  // descendant, which is the `TextField`'s input. The field is the surface — an
  // overlay that opened anywhere else would be a grid you have to Tab into before
  // you can type.
  return (
    <Dialog
      className="launcher__panel"
      title={s.label}
      description={s.description}
      onClose={onClose}
      actions={
        <Button className="nx-dialog__cancel" onClick={onClose}>
          {s.close}
        </Button>
      }
    >
      <TextField
        label={s.searchLabel}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          // A narrowed list has a different first tile, so the highlight goes
          // back to the top rather than pointing at whatever index the old
          // list happened to leave it on.
          setActiveIndex(0);
        }}
        onKeyDown={onFieldKeyDown}
      />

      <div className="launcher__body">
        {visible.length === 0 ? (
          <p className="nx-hint">{strings.search.emptyResults}</p>
        ) : (
          sections
        )}
      </div>
    </Dialog>
  );
}
