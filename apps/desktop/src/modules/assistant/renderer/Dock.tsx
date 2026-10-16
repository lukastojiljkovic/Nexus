import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button, Icon } from "@nexus/ui";
import { AssistantSurface } from "./Page.js";
import { copy } from "./copy.js";
import {
  DOCK_WIDTH,
  clampDockWidth,
  readStoredDockWidth,
  writeStoredDockWidth,
} from "./dockRules.js";

/** How far one arrow key moves the dock's edge, in CSS pixels. A policy choice: a small, predictable step. */
const KEY_STEP_PX = 16;

/**
 * THE ASSISTANT BESIDE THE PAGE (ADR-106).
 *
 * A labelled, non-modal region on the right of the window. It is the same assistant
 * as the full page (`AssistantSurface`), so conversations and turns are shared; the
 * page beside it keeps working. Focus moves into the composer when the dock opens,
 * and Escape hands focus back to the page, which is `onEscape`'s job. Nothing traps
 * focus: a dock that did would be a modal, and the page must stay usable.
 *
 * **The width is the device's, and it is resizable** by its edge or the arrow keys.
 * The bounds and the storage are in `dockRules.ts`. Below the window width where the page
 * and the dock no longer fit, `asst-dock` overlays the page instead (`shell.css`).
 */
export default function AssistantDock({
  profileId,
  beside,
  onClose,
  onEscape,
  onPageChanged,
}: {
  readonly profileId: string;
  /** The page the dock sits beside, which the assistant's tools see as the user's place. */
  readonly beside: string;
  readonly onClose: () => void;
  /** Returns focus to the page beside the dock. */
  readonly onEscape: () => void;
  /** Remounts the page beside the dock after a turn that changed it (`AssistantSurface`). */
  readonly onPageChanged: () => void;
}) {
  const [width, setWidth] = useState(readStoredDockWidth);

  /**
   * Resizes from a pointer: the dock's edge follows the pointer's distance from the
   * window's right edge. The edge captures the pointer, so a fast drag that leaves
   * its few pixels keeps resizing; the width is remembered once, on release.
   */
  const dragResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setWidth(clampDockWidth(window.innerWidth - event.clientX));
  };

  const keyResize = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowLeft" ? KEY_STEP_PX : event.key === "ArrowRight" ? -KEY_STEP_PX : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = clampDockWidth(width + step);
    setWidth(next);
    writeStoredDockWidth(next);
  };

  return (
    <aside
      className="asst-dock"
      role="region"
      aria-label={copy.dock.label}
      style={{ width }}
      onKeyDown={(event) => {
        // A dialog inside the dock answers its own Escape (`Dialog.tsx` listens on
        // the document), so only an Escape outside one hands focus back.
        if (event.key === "Escape" && (event.target as Element).closest('[role="dialog"]') === null) {
          event.stopPropagation();
          onEscape();
        }
      }}
    >
      <div
        className="asst-dock__edge"
        role="separator"
        aria-orientation="vertical"
        aria-label={copy.dock.resize}
        aria-valuemin={DOCK_WIDTH.min}
        aria-valuemax={DOCK_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={dragResize}
        onPointerUp={() => writeStoredDockWidth(width)}
        onKeyDown={keyResize}
      />
      <div className="asst-dock__bar">
        <Button size="sm" variant="quiet" aria-label={copy.dock.close} onClick={onClose}>
          <Icon name="close" size={13} />
        </Button>
      </div>
      <div className="asst-dock__body">
        <AssistantSurface profileId={profileId} docked beside={beside} onPageChanged={onPageChanged} />
      </div>
    </aside>
  );
}
