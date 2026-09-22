import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import {
  CHASSIS_LENGTHS,
  CHASSIS_MASSES,
  CHASSIS_MAX_CM,
  CHASSIS_MAX_GRAMS,
  CHASSIS_SHAPES,
} from "@nexus/core";
import type { Chassis, ChassisField, ChassisShape } from "@nexus/core";
import { Button, TextField } from "@nexus/ui";

import { strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

export interface ElecChassisDialogProps {
  /** The machine as stored, or absent — the ordinary case, since most circuits are not robots. */
  chassis: Chassis | undefined;
  busy: boolean;
  onSave: (chassis: Chassis) => void;
  /** Only reachable when there IS one; the dialog hides the action otherwise. */
  onRemove: () => void;
  onClose: () => void;
}

/**
 * The machine the circuit is the electronics of (ADR-085 E4c).
 *
 * **Nothing here is pre-filled for a new machine, and that is the whole point
 * of the slice.** Nexus cannot measure a chassis, so every one of the nine
 * numbers has to come off a tape measure; a field that opened holding „20"
 * would be a dimension the user never took and the simulator would treat as
 * measured. The empty form is the honest one.
 *
 * **Nine numbers or none.** A machine is saved whole or not at all, which is
 * why this is a dialog with one save button rather than nine fields committed
 * on blur the way the inspector's label and value are: „half a chassis" is a
 * state migration 068 made unrepresentable in the database, and a form that
 * wrote each field as it was typed would be a form spending most of its life in
 * exactly that state.
 *
 * **Centimetres and grams, with the unit in the label.** The number on screen
 * is the number stored; the conversion to metres and kilograms happens in the
 * generator, where it is a fact about the URDF format rather than about
 * anything the user typed.
 *
 * Same house recipe as the code dialog next door — backdrop and panel as
 * siblings, Escape and the backdrop close, focus trapped and handed back.
 */
export function ElecChassisDialog({
  chassis,
  busy,
  onSave,
  onRemove,
  onClose,
}: ElecChassisDialogProps) {
  const s = strings.electronics.chassis;
  const titleId = useId();
  // One id for the whole radio group rather than one per row: the rows are a
  // `map`, and a hook cannot be called inside one.
  const shapeIds = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  const [shape, setShape] = useState<ChassisShape>(chassis?.shape ?? CHASSIS_SHAPES[0]);
  const [drafts, setDrafts] = useState<Record<ChassisField, string>>(() => draftsOf(chassis));
  const [invalid, setInvalid] = useState<readonly ChassisField[]>([]);
  const [message, setMessage] = useState<string | null>(null);

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

  /**
   * Reads the whole form, and refuses it as a whole.
   *
   * Every field is checked before anything is reported, so a form with three
   * empty fields says so once with all three marked — a validator that returned
   * on the first fault would walk the user through the same dialog three times.
   */
  function submit(): void {
    const measured = {} as Record<ChassisField, number>;
    const faults: ChassisField[] = [];
    for (const [names, max] of [
      [CHASSIS_LENGTHS, CHASSIS_MAX_CM],
      [CHASSIS_MASSES, CHASSIS_MAX_GRAMS],
    ] as const) {
      for (const name of names) {
        const typed = drafts[name].trim();
        const parsed = Number(typed.replace(",", "."));
        const sound =
          typed.length > 0 && Number.isFinite(parsed) && parsed > 0 && parsed <= max;
        if (sound) measured[name] = parsed;
        else faults.push(name);
      }
    }
    if (faults.length > 0) {
      setInvalid(faults);
      setMessage(s.invalid);
      return;
    }
    // The one cross-field rule, said here rather than only in the store: track
    // is centre-to-centre, so wheels no further apart than they are wide
    // overlap through the middle of the robot. Main and SQLite refuse it too —
    // this is the refusal that can explain itself.
    if (measured.wheelTrack <= measured.wheelWidth) {
      setInvalid(["wheelTrack", "wheelWidth"]);
      setMessage(s.trackTooNarrow);
      return;
    }
    setInvalid([]);
    setMessage(null);
    onSave({ shape, ...measured });
  }

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="recur-dialog__panel elec-chassis__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.dialogTitle}
        </h2>

        {/*
          The body scrolls; the panel does not. Nine fields on a short window is
          exactly the case where a scrolling PANEL carries „Sačuvaj mašinu" off
          the bottom — and the refusal below stays outside this div on purpose,
          because a message the user has to scroll to find is a message they
          pressed the button and got nothing for.
        */}
        <div className="elec-chassis__body">
          <p className="nx-hint nx-hint--prose">{s.description}</p>

          <fieldset className="elec-chassis__shapes">
            <legend className="elec-inspector__label">{s.shapeLabel}</legend>
            {CHASSIS_SHAPES.map((candidate) => (
              <label key={candidate} className="elec-chassis__shape">
                <input
                  // The shared control, not a native one: a bare `input type=radio`
                  // renders at 13x13 and is the finding `priv.css` already fixed
                  // once — `.nx-radio` draws the dot itself and carries a 24px hit
                  // area behind it.
                  className="nx-radio"
                  type="radio"
                  name="elec-chassis-shape"
                  value={candidate}
                  checked={shape === candidate}
                  disabled={busy}
                  onChange={() => setShape(candidate)}
                  // The row is a wrapping label, so without these two the radio
                  // is introduced as „Kocka Kockasto kućište sa zaobljenim
                  // ivicama" — the name and its description as one utterance.
                  // Naming the shape span fixes the name, and because
                  // `aria-labelledby` REPLACES the label's text rather than
                  // filtering it, the description has to be handed back
                  // deliberately: `aria-describedby` is what keeps the hint
                  // audible instead of trading one defect for a silence.
                  aria-labelledby={`${shapeIds}-${candidate}`}
                  aria-describedby={`${shapeIds}-${candidate}-hint`}
                />
                <span className="elec-chassis__shape-name" id={`${shapeIds}-${candidate}`}>
                  {s.shapes[candidate]}
                </span>
                <span
                  className="elec-chassis__shape-hint"
                  id={`${shapeIds}-${candidate}-hint`}
                >
                  {s.shapeHints[candidate]}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="elec-chassis__grid">
            {[...CHASSIS_LENGTHS, ...CHASSIS_MASSES].map((name) => (
              <div key={name} className="elec-chassis__field">
                <TextField
                  label={s.fields[name]}
                  value={drafts[name]}
                  inputMode="decimal"
                  disabled={busy}
                  aria-invalid={invalid.includes(name) || undefined}
                  onChange={(event) =>
                    setDrafts((previous) => ({ ...previous, [name]: event.target.value }))
                  }
                />
                {(name === "wheelTrack" || name === "wheelBase") && (
                  <p className="elec-chassis__hint">{s.hints[name]}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {message !== null && (
          <p className="elec-inspector__error" role="alert">
            {message}
          </p>
        )}

        <div className="recur-dialog__actions">
          <Button className="recur-dialog__cancel" onClick={onClose}>
            {strings.electronics.cancel}
          </Button>
          {chassis !== undefined && (
            <Button variant="ghost" disabled={busy} onClick={onRemove}>
              {s.remove}
            </Button>
          )}
          <Button variant="primary" disabled={busy} onClick={submit}>
            {s.save}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The nine fields as text.
 *
 * EMPTY for a machine that does not exist yet — see the component's own note —
 * and the stored number with a Serbian decimal comma for one that does. The
 * comma is swapped rather than formatted: `formatToolNumber` groups thousands,
 * and a field holding „1.200" is a field that no longer parses back to what it
 * came from.
 */
function draftsOf(chassis: Chassis | undefined): Record<ChassisField, string> {
  const drafts = {} as Record<ChassisField, string>;
  for (const name of [...CHASSIS_LENGTHS, ...CHASSIS_MASSES]) {
    drafts[name] = chassis === undefined ? "" : String(chassis[name]).replace(".", ",");
  }
  return drafts;
}
