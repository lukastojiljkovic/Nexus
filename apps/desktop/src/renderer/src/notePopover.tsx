import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export interface NotePopoverProps {
  /** Accessible label for the "⋯" trigger button. */
  label: string;
  /** Extra class on the trigger, so callers can size/reveal it per context. */
  triggerClassName?: string;
  /** Panel content; `close` dismisses the popover after an action is chosen. */
  children: (close: () => void) => ReactNode;
}

/**
 * A small "⋯" actions popover (NOTE organizer, slice a3b): a trigger button
 * that reveals a token-styled panel, closing on an outside click or Escape.
 * The panel is `position: fixed`, anchored to the trigger's rect, so it escapes
 * the surrounding `overflow: auto` list/tree instead of being clipped by it —
 * the same reason the slash menu is fixed. Hand-rolled (no floating-ui) to keep
 * the renderer dependency-light; the panel is a real `role="menu"` region and
 * every item inside is a focusable `<button>`.
 */
export function NotePopover({ label, triggerClassName, children }: NotePopoverProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 2, right: window.innerWidth - rect.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const panelStyle: CSSProperties | undefined = pos
    ? { position: "fixed", top: pos.top, right: pos.right }
    : undefined;

  return (
    <div className="note__menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`note__menu-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ⋯
      </button>
      {open && pos && (
        <div className="note__menu-panel" role="menu" style={panelStyle}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
