import { useState } from "react";
import type { ReactNode } from "react";
import type {
  CircuitPart,
  CircuitProblem,
  CircuitWire,
  ComponentDef,
  WireColour,
} from "@nexus/core";
// The caps come from `@nexus/core` rather than from a mirror in `ipc.ts`: they
// are the very constants the domain validator and main's own narrowing read, so
// a field capped from them cannot disagree with the gate that will refuse it.
import { MAX_CIRCUIT_NOTES_LENGTH, MAX_PART_LABEL_LENGTH, WIRE_COLOURS } from "@nexus/core";
import { Button, TextField } from "@nexus/ui";

import { partDisplayName } from "./elecCatalogue.js";
import type { ElecSelection } from "./ElecBench.js";
import type { ElecCircuitDocument } from "../../shared/ipc.js";
import { countUnit, strings } from "./strings.js";
import { formatToolNumber } from "./toolFormat.js";

export interface ElecInspectorProps {
  circuit: ElecCircuitDocument;
  resolve: (componentId: string) => ComponentDef | undefined;
  selection: ElecSelection | null;
  /** What `circuitProblems` found. Notices about an open circuit, never refusals — see the strings table. */
  problems: readonly CircuitProblem[];
  busy: boolean;
  onRenamePart: (id: string, label: string) => void;
  onRotatePart: (id: string) => void;
  onSetPartValue: (id: string, value: number | null) => void;
  onRemovePart: (id: string) => void;
  onSetWireColour: (id: string, colour: WireColour) => void;
  onRemoveWire: (id: string) => void;
  onSaveNotes: (notes: string) => void;
  /** Set by the page after a successful notes write, cleared when the field is touched again. */
  notesSaved: boolean;
}

/**
 * The panel on the right: whatever is selected, and always the circuit's own
 * checks underneath it.
 *
 * **The checks are NOT part of the selection.** They are about the circuit, they
 * are what somebody opens this page to see, and hiding them behind „select
 * nothing" would mean the one screen that says „this wire goes to a pin that
 * does not exist" is the screen you reach by clicking empty space.
 *
 * Every editable field is committed on blur and on Enter, never as you type. A
 * label is one row and one write; a label that saved per keystroke would be
 * fourteen rows through the sync outbox for one rename.
 */
export function ElecInspector({
  circuit,
  resolve,
  selection,
  problems,
  busy,
  onRenamePart,
  onRotatePart,
  onSetPartValue,
  onRemovePart,
  onSetWireColour,
  onRemoveWire,
  onSaveNotes,
  notesSaved,
}: ElecInspectorProps) {
  const part =
    selection?.kind === "part"
      ? circuit.parts.find((candidate) => candidate.id === selection.id)
      : undefined;
  const wire =
    selection?.kind === "wire"
      ? circuit.wires.find((candidate) => candidate.id === selection.id)
      : undefined;

  return (
    <aside className="elec-inspector">
      {part !== undefined ? (
        <PartPanel
          // Keyed by the part, so the draft fields below are the SELECTED
          // part's rather than whatever was typed into the previous one.
          key={part.id}
          part={part}
          component={resolve(part.componentId)}
          wires={circuit.wires}
          busy={busy}
          onRename={onRenamePart}
          onRotate={onRotatePart}
          onSetValue={onSetPartValue}
          onRemove={onRemovePart}
        />
      ) : wire !== undefined ? (
        <WirePanel
          key={wire.id}
          wire={wire}
          parts={circuit.parts}
          resolve={resolve}
          busy={busy}
          onSetColour={onSetWireColour}
          onRemove={onRemoveWire}
        />
      ) : (
        <CircuitPanel
          key={circuit.id}
          circuit={circuit}
          busy={busy}
          onSaveNotes={onSaveNotes}
          notesSaved={notesSaved}
        />
      )}
      <ProblemList problems={problems} />
    </aside>
  );
}

interface CircuitPanelProps {
  circuit: ElecCircuitDocument;
  busy: boolean;
  onSaveNotes: (notes: string) => void;
  notesSaved: boolean;
}

/** Nothing selected: what the circuit holds, and the one note about it. */
function CircuitPanel({ circuit, busy, onSaveNotes, notesSaved }: CircuitPanelProps) {
  const s = strings.electronics.inspector;
  const [draft, setDraft] = useState(circuit.notes);

  const parts = circuit.parts.length;
  const wires = circuit.wires.length;

  return (
    <section className="elec-inspector__panel">
      <h2 className="elec-inspector__title">{s.circuitTitle}</h2>
      <p className="elec-inspector__counts">
        {parts} {countUnit(parts, s.partsOne, s.partsFew, s.partsMany)} · {wires}{" "}
        {countUnit(wires, s.wiresOne, s.wiresFew, s.wiresMany)}
      </p>
      <label className="elec-inspector__field">
        <span className="elec-inspector__label">{s.notesLabel}</span>
        <textarea
          className="nx-textfield__input elec-inspector__textarea"
          rows={5}
          value={draft}
          maxLength={MAX_CIRCUIT_NOTES_LENGTH}
          placeholder={s.notesPlaceholder}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <Button
        variant="ghost"
        disabled={busy || draft === circuit.notes}
        onClick={() => onSaveNotes(draft)}
      >
        {s.notesSave}
      </Button>
      {notesSaved && draft === circuit.notes && (
        <p className="elec-inspector__saved" role="status">
          {s.notesSaved}
        </p>
      )}
    </section>
  );
}

interface PartPanelProps {
  part: CircuitPart;
  component: ComponentDef | undefined;
  wires: readonly CircuitWire[];
  busy: boolean;
  onRename: (id: string, label: string) => void;
  onRotate: (id: string) => void;
  onSetValue: (id: string, value: number | null) => void;
  onRemove: (id: string) => void;
}

/** One placed part: its own name, its angle, its value, and what the catalogue says about it. */
function PartPanel({
  part,
  component,
  wires,
  busy,
  onRename,
  onRotate,
  onSetValue,
  onRemove,
}: PartPanelProps) {
  const s = strings.electronics.inspector;
  const bench = strings.electronics.bench;
  const [label, setLabel] = useState(part.label);
  const [value, setValue] = useState(part.value === undefined ? "" : String(part.value));
  const [valueError, setValueError] = useState(false);

  function commitLabel(): void {
    if (label !== part.label) onRename(part.id, label);
  }

  /**
   * The value field, committed.
   *
   * An emptied field CLEARS the value rather than leaving the old one standing,
   * which is the whole reason the update channel carries a null: „this resistor
   * should not have a value after all" is a correction the user must be able to
   * make. Anything that is not a positive number is refused here and said out
   * loud — main would refuse it too, but a round trip to be told „nije uspelo"
   * is a worse answer than the field's own.
   */
  function commitValue(): void {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setValueError(false);
      if (part.value !== undefined) onSetValue(part.id, null);
      return;
    }
    const parsed = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setValueError(true);
      return;
    }
    setValueError(false);
    if (parsed !== part.value) onSetValue(part.id, parsed);
  }

  const connected = new Set(
    wires.flatMap((wire) =>
      [wire.from, wire.to]
        .filter((end) => end.partId === part.id)
        .map((end) => end.pinId),
    ),
  );

  return (
    <section className="elec-inspector__panel">
      <h2 className="elec-inspector__title">{s.partTitle}</h2>
      <p className="elec-inspector__subject">
        {partDisplayName(part.label, component, bench.unknownPart)}
      </p>

      <TextField
        label={s.labelField}
        placeholder={s.labelPlaceholder}
        value={label}
        maxLength={MAX_PART_LABEL_LENGTH}
        disabled={busy}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={commitLabel}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitLabel();
        }}
      />

      <div className="elec-inspector__row">
        <span className="elec-inspector__label">{s.rotationLabel}</span>
        <span className="elec-inspector__figure">{part.rotation}°</span>
        <Button variant="ghost" disabled={busy} onClick={() => onRotate(part.id)}>
          {s.rotate}
        </Button>
      </div>

      {component?.valueUnit !== undefined && (
        <>
          <TextField
            label={s.valueLabels[component.valueUnit]}
            value={value}
            inputMode="decimal"
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
            onBlur={commitValue}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitValue();
            }}
          />
          {valueError && (
            <p className="elec-inspector__error" role="alert">
              {s.valueInvalid}
            </p>
          )}
        </>
      )}

      {component !== undefined && (
        <>
          <h3 className="elec-inspector__heading">{s.componentHeading}</h3>
          <p className="elec-inspector__summary">{component.summary}</p>
          <dl className="elec-inspector__facts">
            {component.supply !== undefined && (
              <Fact term={s.supplyLabel}>
                {component.supply.min === component.supply.max
                  ? `${formatToolNumber(component.supply.min)} V`
                  : `${formatToolNumber(component.supply.min)}–${formatToolNumber(component.supply.max)} V`}
              </Fact>
            )}
            {component.current !== undefined && (
              <Fact term={s.currentLabel}>
                {`${s.currentTypical} ${formatToolNumber(component.current.typical)} mA · ${s.currentPeak} ${formatToolNumber(component.current.peak)} mA`}
              </Fact>
            )}
            {component.logicVolts !== undefined && (
              <Fact term={s.logicLabel}>{`${formatToolNumber(component.logicVolts)} V`}</Fact>
            )}
            {component.buses.length > 0 && (
              <Fact term={s.busesLabel}>
                {component.buses.map((bus) => s.buses[bus.kind]).join(" · ")}
              </Fact>
            )}
            {component.buses.map((bus) =>
              bus.kind === "i2c" && bus.addresses.length > 0 ? (
                <Fact key="addresses" term={s.addressesLabel}>
                  {bus.addresses
                    .map((address) => `0x${address.toString(16).toUpperCase().padStart(2, "0")}`)
                    .join(" · ")}
                </Fact>
              ) : null,
            )}
            {component.library !== undefined && (
              <Fact term={s.libraryLabel}>{component.library}</Fact>
            )}
          </dl>

          <h3 className="elec-inspector__heading">{s.pinsHeading}</h3>
          <ul className="elec-inspector__pins">
            {component.pins.map((pin) => (
              <li key={pin.id} className="elec-inspector__pin">
                <span className="elec-inspector__pin-label">{pin.label}</span>
                <span className="elec-inspector__pin-functions">
                  {pin.functions.map((fn) => s.pinFunctions[fn]).join(", ")}
                </span>
                <span
                  className={`elec-inspector__pin-state${
                    connected.has(pin.id) ? " elec-inspector__pin-state--live" : ""
                  }`}
                >
                  {connected.has(pin.id) ? s.pinConnected : s.pinFree}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <Button variant="danger" disabled={busy} onClick={() => onRemove(part.id)}>
        {s.removePart}
      </Button>
      <p className="elec-inspector__hint">{s.removePartHint}</p>
    </section>
  );
}

interface WirePanelProps {
  wire: CircuitWire;
  parts: readonly CircuitPart[];
  resolve: (componentId: string) => ComponentDef | undefined;
  busy: boolean;
  onSetColour: (id: string, colour: WireColour) => void;
  onRemove: (id: string) => void;
}

/** One jumper: where it goes, what colour it is, and the one thing you can do to it. */
function WirePanel({ wire, parts, resolve, busy, onSetColour, onRemove }: WirePanelProps) {
  const s = strings.electronics.inspector;
  const bench = strings.electronics.bench;

  /** „Arduino UNO · D9", or the part's own name if the user gave it one. */
  function endName(partId: string, pinId: string): string {
    const part = parts.find((candidate) => candidate.id === partId);
    if (part === undefined) return pinId;
    const name = partDisplayName(part.label, resolve(part.componentId), bench.unknownPart);
    return `${name} · ${pinId}`;
  }

  return (
    <section className="elec-inspector__panel">
      <h2 className="elec-inspector__title">{s.wireTitle}</h2>
      <dl className="elec-inspector__facts">
        <Fact term={s.wireFrom}>{endName(wire.from.partId, wire.from.pinId)}</Fact>
        <Fact term={s.wireTo}>{endName(wire.to.partId, wire.to.pinId)}</Fact>
      </dl>

      <span className="elec-inspector__label" id="elec-wire-colour">
        {s.wireColour}
      </span>
      <div className="elec-swatches" role="radiogroup" aria-labelledby="elec-wire-colour">
        {WIRE_COLOURS.map((colour) => (
          <button
            key={colour}
            type="button"
            role="radio"
            aria-checked={wire.colour === colour}
            aria-label={bench.colours[colour]}
            title={bench.colours[colour]}
            disabled={busy}
            className={`nx-swatch elec-swatch elec-swatch--${colour}${
              wire.colour === colour ? " nx-swatch--selected" : ""
            }`}
            onClick={() => onSetColour(wire.id, colour)}
          />
        ))}
      </div>

      <Button variant="danger" disabled={busy} onClick={() => onRemove(wire.id)}>
        {s.removeWire}
      </Button>
    </section>
  );
}

/** One term/definition pair — the panel's only shape for „a fact about this thing". */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="elec-inspector__term">{term}</dt>
      <dd className="elec-inspector__value">{children}</dd>
    </>
  );
}

/** What the checks found, always visible — see the component header for why. */
function ProblemList({ problems }: { problems: readonly CircuitProblem[] }) {
  const s = strings.electronics.problems;
  return (
    <section className="elec-inspector__panel elec-inspector__panel--checks">
      <h3 className="elec-inspector__heading">
        {s.heading}
        {problems.length > 0 && (
          <span className="elec-inspector__count">
            {problems.length} {countUnit(problems.length, s.countOne, s.countFew, s.countMany)}
          </span>
        )}
      </h3>
      {problems.length === 0 ? (
        <p className="elec-inspector__ok">{s.none}</p>
      ) : (
        <ul className="elec-inspector__problems">
          {problems.map((problem) => (
            <li key={`${problem.field}:${problem.code}`} className="elec-inspector__problem">
              <span className="elec-inspector__problem-text">{s.codes[problem.code]}</span>
              <span className="elec-inspector__problem-field">{problem.field}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
