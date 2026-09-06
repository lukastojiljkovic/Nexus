import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button, Chip, TextField } from "@nexus/ui";
import { canvasPickerRows } from "./canvasCards.js";
import type { CanvasPickerRow } from "./canvasCards.js";
import { SEARCH_DEBOUNCE_MS } from "./searchShared.js";
import { strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

/**
 * „Dodaj karticu" (CANV slice c): which Nexus object goes on the board.
 *
 * **It is the global search, narrowed — not a read of its own.** An empty box
 * shows `searchRecent`'s entries, typing runs `searchQuery` on the palette's own
 * debounce, and `canvasPickerRows` keeps the three kinds a reference admits.
 * Reusing those two channels is what makes this picker obey the per-profile
 * module gate for free: `searchGate.ts` filters every hit in MAIN, on the one
 * path all three search channels take, so a profile with BELEŠKE switched off
 * cannot be offered a note here. A picker with its own query would have had to
 * re-state that rule — or, far more likely, quietly not have it.
 *
 * The house dialog recipe otherwise (`NoteChecklistTasksDialog`'s): portalled to
 * `document.body`, Escape and the backdrop both cancel, nothing is written by
 * this component — it answers with a choice and the page puts the element on the
 * board.
 */

/**
 * How many hits to ask for.
 *
 * More than the palette's thirty, because this list is FILTERED after it
 * arrives: the search index carries nine kinds and a card can point at three, so
 * a profile whose recent activity is mostly ispiti and špilovi would otherwise
 * see a nearly empty picker while having plenty to pin. Asking wider is cheaper
 * than a second round trip, and the store's own ceiling is higher still.
 */
const CANVAS_PICKER_LIMIT = 60;

export interface CanvasCardPickerProps {
  profileId: string;
  /** The chosen object. The element itself is the page's to build — this dialog only answers. */
  onPick: (row: CanvasPickerRow) => void;
  onCancel: () => void;
}

export function CanvasCardPicker({ profileId, onPick, onCancel }: CanvasCardPickerProps) {
  const s = strings.canvas.picker;
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CanvasPickerRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const titleId = useId();
  const descriptionId = useId();

  // Focus lands on the search field — the trap's own default (the first
  // tabbable descendant), which `autoFocus` used to do less reliably (and
  // without cycling Tab inside the panel or returning focus on close).
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });
  /**
   * Which request may still write `rows` — the palette's guard, for its reason:
   * a slow query issued before a fast one must not repaint the list after it.
   */
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const results =
            query.trim().length === 0
              ? await window.nexus.searchRecent(profileId, CANVAS_PICKER_LIMIT)
              : await window.nexus.searchQuery(profileId, query, CANVAS_PICKER_LIMIT);
          if (requestId.current !== id) return;
          setRows(canvasPickerRows(results));
          setActiveIndex(0);
          setFailed(false);
        } catch (error) {
          if (requestId.current !== id) return;
          // The dialog stays open with an empty list rather than closing under
          // the user: they opened it on purpose and a failed search is not a
          // reason to take the decision away from them.
          setRows([]);
          setFailed(true);
          console.error("Nexus: canvas card search failed:", error);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [profileId, query]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  /** ↑/↓ move, Enter picks — the whole list is reachable from the box the caret is already in. */
  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const list = rows ?? [];
    if (event.key === "ArrowDown" && list.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % list.length);
      return;
    }
    if (event.key === "ArrowUp" && list.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + list.length) % list.length);
      return;
    }
    if (event.key === "Enter") {
      const row = list[activeIndex];
      if (row !== undefined) {
        event.preventDefault();
        onPick(row);
      }
    }
  }

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onCancel} />
      <div
        ref={panelRef}
        className="recur-dialog__panel canv-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.title}
        </h2>
        <p id={descriptionId} className="nx-hint">
          {s.description}
        </p>

        <TextField
          label={s.searchLabel}
          placeholder={s.placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
        />

        {failed && (
          <p className="canv__error" role="alert">
            {s.error}
          </p>
        )}

        {rows === null ? (
          <p className="nx-hint">{strings.app.loading}</p>
        ) : rows.length === 0 ? (
          <p className="nx-hint">{strings.search.emptyResults}</p>
        ) : (
          <ul className="canv-picker__list">
            {/* The heading names what an untyped list IS — the entries this
                profile touched, not a ranked answer to an empty question. */}
            {query.trim().length === 0 && (
              <li className="canv-picker__group">{strings.search.recentGroup}</li>
            )}
            {rows.map((row, index) => (
              <li key={`${row.kind}:${row.id}`}>
                <button
                  type="button"
                  className={
                    index === activeIndex
                      ? "canv-picker__row canv-picker__row--active"
                      : "canv-picker__row"
                  }
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onPick(row)}
                >
                  <Chip className="canv-picker__kind">
                    {strings.search.kindSingular[row.kind]}
                  </Chip>
                  <span className="canv-picker__title">{row.title}</span>
                  {row.detail !== null && (
                    <span className="canv-picker__detail">{row.detail}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="recur-dialog__actions">
          <Button className="recur-dialog__cancel" onClick={onCancel}>
            {strings.canvas.cancel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
