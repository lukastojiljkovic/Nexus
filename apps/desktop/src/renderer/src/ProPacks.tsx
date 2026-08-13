import { packFlagKey, type FlagState, type ToolPack } from "@nexus/core";
import { Button } from "@nexus/ui";
import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { createModuleRegistry } from "../../shared/modules.js";
import { packInventory } from "../../shared/onboardingPresets.js";
import { fill, strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

/**
 * „Paketi alatki" — the one place a toolkit is switched on or off after the
 * questionnaire, in the two rooms where somebody would look for it: a dialog off
 * the professional drawer's own header, and a card in „Podešavanja".
 *
 * **It is one component because it is one act.** The alternative — a checkbox
 * list in Settings and a card grid in the drawer — is two answers to „what does
 * a chosen toolkit look like", and the questionnaire would have been a third.
 * The cards are `.pro-kit`, the same block „Tvoja nedelja" wears.
 *
 * **The list is derived, never declared.** `packInventory` walks the registry,
 * so a toolkit appears here the moment its first tool is registered and never
 * before — the questionnaire's rule, for the same reason: a row somebody cannot
 * switch on is an advertisement, and a row that switches on an empty drawer is
 * worse. There is deliberately no „coming soon" tier.
 *
 * **Writing is immediate and per-row**, unlike the questionnaire's one
 * completion write. This is a settings surface: there is no „Sačuvaj" here any
 * more than there is one on the module gallery, and a toolkit is a flag row
 * whose whole cost is a list getting longer.
 */

export interface ProPackListProps {
  profileId: string;
  /** The toolkits this profile has, from the shell's live flags. */
  packs: ReadonlySet<string>;
  /**
   * The profile's flags AFTER a write, read back from main rather than patched
   * here. The shell owns `flags`; a surface that guessed the new state would be
   * a second answer to what this profile has — and `pro` itself moves with the
   * first and last toolkit, which is a derivation only main's row set settles.
   */
  onFlagsChanged: (flags: FlagState) => void;
}

export function ProPackList({ profileId, packs, onFlagsChanged }: ProPackListProps) {
  const s = strings.pro.picker;
  const [error, setError] = useState<string | null>(null);
  // The registry is rebuilt per mount, not per render: it is the same walk
  // `ToolsPage` memoises, and this list re-renders on every toggle.
  const offered = useMemo(() => packInventory(createModuleRegistry()), []);

  async function toggle(pack: ToolPack, on: boolean): Promise<void> {
    try {
      await window.nexus.setFlag(profileId, packFlagKey(pack), on);
      onFlagsChanged(await window.nexus.getFlags(profileId));
      setError(null);
    } catch (cause) {
      // The row is unchanged and the list still draws the stored answer, so the
      // failure costs nothing but the press — which is exactly what the line
      // says. The module gallery's own recipe.
      setError(s.saveError);
      console.error("Nexus: failed to write a toolkit flag:", cause);
    }
  }

  return (
    <div className="pro-picker">
      <p className="pro-picker__note">{s.description}</p>
      <div className="pro-kits" role="group" aria-label={s.title}>
        {offered.map(({ pack, toolCount }) => {
          const on = packs.has(pack);
          const copy = strings.pro.packs[pack];
          return (
            <button
              key={pack}
              type="button"
              className={`pro-kit${on ? " pro-kit--on" : ""}`}
              aria-pressed={on}
              onClick={() => void toggle(pack, !on)}
            >
              <span className="pro-kit-name">{copy.name}</span>
              <span className="pro-kit-who">{copy.who}</span>
              <span className="pro-kit-count">{fill(s.contains, { count: toolCount })}</span>
            </button>
          );
        })}
      </div>
      {error != null && (
        <p className="pro-picker__error" role="alert">
          {error}
        </p>
      )}
      {/* Once, at the foot: what a toolkit is NOT. „Paket" and „modul" are the
          same word to most people, and somebody who thinks this adds a row to
          the sidebar will go looking for one. */}
      <p className="pro-picker__note">{s.note}</p>
      {/* …and what the drawer as a whole is not. Here rather than in a modal
          because this is the screen where somebody CHOOSES to take the tools —
          `picker.responsibility` argues the rest. */}
      <p className="pro-picker__note">{s.responsibility}</p>
    </div>
  );
}

export interface ProPackDialogProps extends ProPackListProps {
  onClose: () => void;
}

/**
 * The same list, in the house dialog shell (`ConfirmDialog`'s recipe verbatim —
 * portal, focus trap, Escape and a backdrop that closes).
 *
 * There is no „Otkaži": every toggle has already been written by the time it is
 * drawn, so the only control this needs is a way out. „Gotovo" says that, where
 * „U redu" would suggest the answers are being committed on the way.
 */
export function ProPackDialog({ profileId, packs, onFlagsChanged, onClose }: ProPackDialogProps) {
  const titleId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="recur-dialog__panel pro-picker__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {strings.pro.picker.title}
        </h2>
        <ProPackList profileId={profileId} packs={packs} onFlagsChanged={onFlagsChanged} />
        <div className="recur-dialog__actions">
          <Button className="recur-dialog__cancel" onClick={onClose}>
            {strings.pro.picker.done}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
