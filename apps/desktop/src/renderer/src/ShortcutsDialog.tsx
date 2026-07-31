import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatChord, MODULE_NAV_MAX, moduleNavChord } from "@nexus/core";
import { Button } from "@nexus/ui";
import { SHORTCUT_ACTIONS, type ShortcutBindings } from "./shortcuts.js";
import { SHORTCUT_REFERENCE } from "./shortcutsReference.js";
import { strings } from "./strings.js";

/**
 * One key as a chip. The single `<kbd>` recipe in the app — the Settings
 * „Prečice" card imports it from here rather than styling a second one, so a
 * chord looks identical wherever it is printed.
 */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="shortcut-kbd">{children}</kbd>;
}

/** A row's keys, each as its own chip. */
export function KbdKeys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="shortcut-kbd-row">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  );
}

/**
 * One reference line. `note` is the exception a row earns by behaving unlike
 * its neighbours — today only the OS-level capture chord (TASK-002), which
 * fires while Nexus is in the background and therefore means something else
 * than every other key on this screen.
 */
function ReferenceRow({
  label,
  keys,
  note,
}: {
  label: string;
  keys: readonly string[];
  note?: string | undefined;
}) {
  return (
    <div className="shortcuts-dialog__row">
      <span className="shortcuts-dialog__row-label">
        {label}
        {note !== undefined && <span className="shortcuts-dialog__row-note">{note}</span>}
      </span>
      <KbdKeys keys={keys} />
    </div>
  );
}

function ReferenceGroup({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className="shortcuts-dialog__group">
      <h3 className="set__module-group-title">{title}</h3>
      {caption !== undefined && <p className="set__section-caption">{caption}</p>}
      {children}
    </section>
  );
}

export interface ShortcutsDialogProps {
  /** The live bindings — printed as they are right now, never as a remembered default. */
  bindings: ShortcutBindings;
  /** Visible module ids in sidebar order; the first nine get their Ctrl+digit. */
  moduleIds: readonly string[];
  onClose: () => void;
}

/**
 * The shortcuts reference (ADR-040 / SET-013): every key the app answers to,
 * on one screen. Opened by F1, by the Settings card's „Prikaži sve prečice",
 * and by the palette's „Prečice" command.
 *
 * Two groups are live rather than written down — the remappable core set and
 * the positional Ctrl+digit family over the modules that are actually enabled
 * — because a reference that prints a chord the app no longer uses is worse
 * than none. Everything else comes from `shortcutsReference.ts`.
 *
 * Same house dialog recipe as the recurrence-scope question (backdrop and
 * panel as siblings, Escape and the backdrop close, no glow), widened for a
 * two-column list and scrolling in its body rather than growing past the
 * window.
 */
export function ShortcutsDialog({ bindings, moduleIds, onClose }: ShortcutsDialogProps) {
  const s = strings.shortcuts;
  const actionsRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Focus goes to the only control there is, and back where it came from on
  // close — the palette's own rule, so dismissing the reference never strands
  // the keyboard on a portal that no longer exists.
  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actionsRef.current?.querySelector("button")?.focus();
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        className="recur-dialog__panel shortcuts-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.dialogTitle}
        </h2>

        <div className="shortcuts-dialog__body">
          <ReferenceGroup title={s.groups.global}>
            {SHORTCUT_ACTIONS.map((action) => (
              <ReferenceRow
                key={action.id}
                label={action.label}
                keys={[formatChord(bindings[action.id])]}
                note={action.global ? s.globalHint : undefined}
              />
            ))}
          </ReferenceGroup>

          {moduleIds.length > 0 && (
            <ReferenceGroup title={s.groups.modules} caption={s.moduleNavCaption}>
              {moduleIds.slice(0, MODULE_NAV_MAX).map((moduleId, index) => {
                const chord = moduleNavChord(index + 1);
                if (chord === null) return null;
                return (
                  <ReferenceRow
                    key={moduleId}
                    label={strings.modules[moduleId] ?? moduleId}
                    keys={[formatChord(chord)]}
                  />
                );
              })}
            </ReferenceGroup>
          )}

          {SHORTCUT_REFERENCE.map((group) => (
            <ReferenceGroup key={group.id} title={group.title} caption={group.caption}>
              {group.rows.map((row) => (
                <ReferenceRow key={row.description} label={row.description} keys={row.keys} />
              ))}
            </ReferenceGroup>
          ))}
        </div>

        <div className="recur-dialog__actions" ref={actionsRef}>
          <Button className="recur-dialog__cancel" onClick={onClose}>
            {s.dialogClose}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
