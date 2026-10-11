import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Button, TextArea, TextField } from "@nexus/ui";
import { formatCoordinates, type GeoPoint } from "@nexus/core";
import { activeLocale } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { useFocusTrap } from "../../../renderer/src/useFocusTrap.js";
import {
  MAPS_PIN_COLORS,
  type MapsPinColor,
  type MapsPinView,
  type MapsView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";

/** What the dialog is doing: dropping a new pin, or editing one that exists. */
export type DialogState =
  | { readonly mode: "create"; readonly point: GeoPoint }
  | { readonly mode: "edit"; readonly pin: MapsPinView; readonly point: GeoPoint };

/**
 * The pin dialog: one pin's title, note and colour.
 *
 * **The point is the map's; the words are the user's.** A new pin lands where
 * the map is looking when the dialog opens, and this dialog is a MODAL: it
 * covers the window, so a click while it is open reaches the panel and not the
 * map. Moving a pin therefore means moving the MAP first — pan to the spot, then
 * press „Nova tačka" — and the dialog says so in its own words rather than
 * promising a click that cannot arrive. The coordinates are SHOWN and never
 * typed, because a typed latitude is a number somebody has to get right; it is
 * also why `updatePin` has no coordinate fields at all. „I put it in the wrong
 * place" is answered by dropping it again, which leaves the first mark where the
 * user actually put it rather than quietly relocating a note about a place they
 * are no longer looking at.
 *
 * **Escape cancels, focus lands on the title, and the trap hands focus back.**
 * The house dialog recipe (`ConfirmDialog`'s), with a form inside it instead of
 * two choices.
 */
export function PinDialog({
  profileId,
  state,
  onCancel,
  onSaved,
}: {
  profileId: string;
  state: DialogState;
  onCancel: () => void;
  onSaved: (next: MapsView) => void;
}) {
  const locale = activeLocale();
  const [title, setTitle] = useState(state.mode === "edit" ? state.pin.title : "");
  const [note, setNote] = useState(state.mode === "edit" ? (state.pin.note ?? "") : "");
  const [color, setColor] = useState<MapsPinColor>(state.mode === "edit" ? state.pin.color : "zlato");
  const [problem, setProblem] = useState<"title" | "note" | null>(null);
  const [saving, setSaving] = useState(false);
  const headingId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const coordinates = formatCoordinates(state.point, locale);

  async function save(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed.length === 0 || trimmed.length > 120) {
      setProblem("title");
      return;
    }
    if (note.length > 2000) {
      setProblem("note");
      return;
    }
    setProblem(null);
    setSaving(true);
    // The dialog closes only once main has answered: a local guess applied on
    // top of a write would be a second answer to a question that has one.
    try {
      const maps = window.nexus.modules.maps;
      const next =
        state.mode === "create"
          ? await maps.createPin({
              profileId,
              title: trimmed,
              note,
              lat: state.point.lat,
              lon: state.point.lon,
              color,
            })
          : await maps.updatePin({ profileId, id: state.pin.id, title: trimmed, note, color });
      onSaved(next);
    } catch (failure) {
      setProblem("title");
      console.error("Nexus: the pin was not saved:", failure);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="maps__overlay">
      <div className="maps__backdrop" onClick={onCancel} />
      <div
        ref={panelRef}
        className="maps__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <h2 id={headingId} className="maps__dialog-title">
          {state.mode === "create" ? copy.dialog.createTitle : copy.dialog.editTitle}
        </h2>
        <TextField
          label={copy.dialog.title}
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
        />
        {problem === "title" && <p className="maps__field-error">{copy.dialog.titleRequired}</p>}
        <TextArea
          label={copy.dialog.note}
          value={note}
          rows={4}
          onChange={(event) => setNote(event.target.value)}
        />
        <p className="nx-hint">{copy.dialog.noteHint}</p>
        {problem === "note" && <p className="maps__field-error">{copy.dialog.noteTooLong}</p>}
        {/* The eight accent swatches, the palette the pins share with a note
            folder and a canvas, drawn by `.nx-swatch` — one recipe for "pick a
            colour" rather than a fourth one. `role="radio"` on a button, because
            a native radio is the OS widget `check:controls` exists to keep out
            of a row like this. */}
        <div className="maps__colors" role="radiogroup" aria-label={copy.dialog.color}>
          {MAPS_PIN_COLORS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={color === candidate}
              aria-label={copy.colors[candidate]}
              className={`nx-swatch maps__swatch${color === candidate ? " nx-swatch--selected" : ""}`}
              style={{ background: `var(--nx-swatch-${candidate})` }}
              onClick={() => setColor(candidate)}
            />
          ))}
        </div>
        <dl className="maps__coords">
          <dt className="maps__coords-term">{copy.dialog.coordinates}</dt>
          <dd className="maps__coords-value">{coordinates.decimal}</dd>
          <dt className="maps__coords-term">{copy.dialog.dms}</dt>
          <dd className="maps__coords-value">{coordinates.dms}</dd>
        </dl>
        <p className="nx-hint">{copy.dialog.atCentre}</p>
        <div className="maps__actions">
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {copy.dialog.save}
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            {copy.dialog.cancel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
