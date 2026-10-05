import { useState } from "react";
import type { ReactNode } from "react";
import type {
  CircuitPart,
  CircuitProblem,
  CircuitWire,
  ComponentDef,
  Mount,
  RuleFinding,
  RuleValue,
  WireColour,
} from "@nexus/core";
// The caps come from `@nexus/core` rather than from a mirror in `ipc.ts`: they
// are the very constants the domain validator and main's own narrowing read, so
// a field capped from them cannot disagree with the gate that will refuse it.
import {
  MAX_CIRCUIT_NOTES_LENGTH,
  MAX_PART_LABEL_LENGTH,
  MOUNTS,
  isMount,
  WIRE_COLOURS,
} from "@nexus/core";
import { Button, Select, TextArea, TextField } from "@nexus/ui";

import { partDisplayName } from "./elecCatalogue.js";
import { componentName, componentSummary, pinLabel } from "./elecLocale.js";
import type { ElecSelection } from "./ElecBench.js";
import type { ElecCircuitDocument } from "../../shared/ipc.js";
import { countUnit, strings } from "./strings.js";
import { formatToolNumber } from "./toolFormat.js";

/**
 * The mount picker's raw string, narrowed without an assertion — `asPriority`'s
 * idiom one module over. The empty option means „not on the machine", which is
 * what `null` says on the wire.
 */
function asMount(value: string): Mount | null {
  return isMount(value) ? value : null;
}

export interface ElecInspectorProps {
  circuit: ElecCircuitDocument;
  resolve: (componentId: string) => ComponentDef | undefined;
  selection: ElecSelection | null;
  /** What `circuitProblems` found. Notices about an open circuit, never refusals — see the strings table. */
  problems: readonly CircuitProblem[];
  /**
   * What `circuitRules` found — ADR-085 slice E3, arriving already sorted
   * worst-first. Also notices: an electrical finding cannot refuse a circuit
   * either, because the catalogue knows a part number and not the user's bench.
   */
  rules: readonly RuleFinding[];
  busy: boolean;
  onRenamePart: (id: string, label: string) => void;
  onRotatePart: (id: string) => void;
  onSetPartValue: (id: string, value: number | null) => void;
  /** Where the part sits on the machine — `null` takes it off (ADR-085 E4c). */
  onSetPartMount: (id: string, mount: Mount | null) => void;
  onRemovePart: (id: string) => void;
  onSetWireColour: (id: string, colour: WireColour) => void;
  onRemoveWire: (id: string) => void;
  onSaveNotes: (notes: string) => void;
  /** Opens the chassis dialog. The dialog itself is the page's, beside the code one. */
  onOpenChassis: () => void;
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
  rules,
  busy,
  onRenamePart,
  onRotatePart,
  onSetPartValue,
  onSetPartMount,
  onRemovePart,
  onSetWireColour,
  onRemoveWire,
  onSaveNotes,
  onOpenChassis,
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
          onSetMount={onSetPartMount}
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
          onOpenChassis={onOpenChassis}
          notesSaved={notesSaved}
        />
      )}
      <ProblemList problems={problems} rules={rules} circuit={circuit} resolve={resolve} />
    </aside>
  );
}

interface CircuitPanelProps {
  circuit: ElecCircuitDocument;
  busy: boolean;
  onSaveNotes: (notes: string) => void;
  onOpenChassis: () => void;
  notesSaved: boolean;
}

/** Nothing selected: what the circuit holds, the machine it sits on, and the one note about it. */
function CircuitPanel({
  circuit,
  busy,
  onSaveNotes,
  onOpenChassis,
  notesSaved,
}: CircuitPanelProps) {
  const s = strings.electronics.inspector;
  const machine = strings.electronics.chassis;
  const [draft, setDraft] = useState(circuit.notes);

  const parts = circuit.parts.length;
  const wires = circuit.wires.length;
  const chassis = circuit.chassis;

  return (
    <section className="elec-inspector__panel">
      <h2 className="elec-inspector__title">{s.circuitTitle}</h2>
      <p className="elec-inspector__counts">
        {parts} {countUnit(parts, s.partsOne, s.partsFew, s.partsMany)} · {wires}{" "}
        {countUnit(wires, s.wiresOne, s.wiresFew, s.wiresMany)}
      </p>

      {/*
        The machine, or the fact that there is not one. The absence is printed
        rather than left blank: a circuit with no chassis gets no model in its
        ROS 2 package, and „nothing here" is the only place that says why
        before the export dialog does.
      */}
      <p className="elec-inspector__machine">
        {chassis === undefined
          ? machine.none
          : `${machine.shapes[chassis.shape]} · ${formatToolNumber(chassis.bodyLength)} × ` +
            `${formatToolNumber(chassis.bodyWidth)} × ${formatToolNumber(chassis.bodyHeight)} cm`}
      </p>
      <Button
        className="elec-inspector__machine-open"
        variant="ghost"
        disabled={busy}
        onClick={onOpenChassis}
      >
        {machine.open}
      </Button>
      <TextArea
        className="elec-inspector__field"
        label={s.notesLabel}
        rows={5}
        value={draft}
        maxLength={MAX_CIRCUIT_NOTES_LENGTH}
        placeholder={s.notesPlaceholder}
        onChange={(event) => setDraft(event.target.value)}
      />
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
  onSetMount: (id: string, mount: Mount | null) => void;
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
  onSetMount,
  onRemove,
}: PartPanelProps) {
  const s = strings.electronics.inspector;
  const bench = strings.electronics.bench;
  const machine = strings.electronics.chassis;
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
        {partDisplayName(
          part.label,
          component === undefined ? undefined : componentName(component),
          bench.unknownPart,
        )}
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

      {/*
        The mount, offered only for a part the simulator has physics for
        (ADR-085 E4c). A resistor has no mounting face worth naming and no
        equivalent in a world model, so the picker would be a control whose
        every setting produced the same file — and the generator's own „šta
        nije u modelu" already says so for the parts it skipped.
      */}
      {component?.simulates !== undefined && (
        <>
          <Select
            label={machine.mountLabel}
            value={part.mount ?? ""}
            disabled={busy}
            onChange={(event) => onSetMount(part.id, asMount(event.target.value))}
          >
            <option value="">{machine.mountNone}</option>
            {MOUNTS.map((mount) => (
              <option key={mount} value={mount}>
                {machine.mounts[mount]}
              </option>
            ))}
          </Select>
          <p className="elec-inspector__hint">{machine.mountHint}</p>
        </>
      )}

      {component !== undefined && (
        <>
          <h3 className="elec-inspector__heading">{s.componentHeading}</h3>
          <p className="elec-inspector__summary">{componentSummary(component)}</p>
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
                <span className="elec-inspector__pin-label">{pinLabel(pin)}</span>
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
    const resolved = resolve(part.componentId);
    const name = partDisplayName(
      part.label,
      resolved === undefined ? undefined : componentName(resolved),
      bench.unknownPart,
    );
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

/**
 * What the checks found, always visible — see the component header for why.
 *
 * **One panel for both kinds, ordered by severity.** The electrical findings
 * (E3) and the structural ones answer different questions, and they are still
 * one list: there is exactly one place a person looks for „what is wrong with
 * this circuit", and splitting it in two would mean the half they read is
 * whichever one is nearer the top. What tells them apart is the severity word
 * on each row — „greška", „upozorenje", „napomena" — which is also what orders
 * them, so a finding that will destroy a part cannot end up beneath a note
 * about a row identifier.
 *
 * **Severity is typographic, not chromatic.** Only `error` takes a colour, and
 * it takes `--nx-danger` because that is what danger already means everywhere
 * else in this app. There is no amber: the palette bans orange outright, and
 * inventing a warning hue for one panel would put a colour on screen that means
 * nothing anywhere else. Weight and order carry the rest.
 */
function ProblemList({
  problems,
  rules,
  circuit,
  resolve,
}: {
  problems: readonly CircuitProblem[];
  rules: readonly RuleFinding[];
  circuit: ElecCircuitDocument;
  resolve: (componentId: string) => ComponentDef | undefined;
}) {
  const s = strings.electronics.problems;
  const r = strings.electronics.rules;
  const total = problems.length + rules.length;

  const nameOf = (partId: string): string => {
    const part = circuit.parts.find((candidate) => candidate.id === partId);
    if (part === undefined) return partId;
    const component = resolve(part.componentId);
    return partDisplayName(
      part.label,
      component === undefined ? undefined : componentName(component),
      strings.electronics.bench.unknownPart,
    );
  };

  const detailOf = (finding: RuleFinding): string =>
    [...finding.values.map(formatRuleValue), ...finding.parts.map(nameOf)].join(` ${r.separator} `);

  return (
    <section className="elec-inspector__panel elec-inspector__panel--checks">
      <h3 className="elec-inspector__heading">
        {s.heading}
        {total > 0 && (
          <span className="elec-inspector__count">
            {total} {countUnit(total, s.countOne, s.countFew, s.countMany)}
          </span>
        )}
      </h3>
      {total === 0 ? (
        <p className="elec-inspector__ok">{s.none}</p>
      ) : (
        <ul className="elec-inspector__problems">
          {/* The index is part of the key on purpose. `circuitRules` collapses
              findings that are identical, but two that differ only in their
              FIGURES are two real rows — one part on two rails is two
              `supply-range` findings with the same code and the same part — and
              code-plus-part alone would give them one key between them. The
              list is derived from props on every render and its rows hold no
              state, so the index is stable enough to be the tie-breaker. */}
          {rules.map((finding, index) => (
            <li
              key={`${finding.code}:${finding.parts.join()}:${index}`}
              className="elec-inspector__problem"
            >
              <span className="elec-inspector__problem-text">{r.codes[finding.code]}</span>
              <span className="elec-inspector__problem-field">
                <span
                  className={`elec-inspector__severity elec-inspector__severity--${finding.severity}`}
                >
                  {r.severity[finding.severity]}
                </span>
                {detailOf(finding)}
              </span>
            </li>
          ))}
          {problems.map((problem) => (
            <li key={`${problem.field}:${problem.code}`} className="elec-inspector__problem">
              <span className="elec-inspector__problem-text">{s.codes[problem.code]}</span>
              <span className="elec-inspector__problem-field">
                <span className="elec-inspector__severity">{r.notice}</span>
                {problem.field}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One figure from a finding, in Serbian.
 *
 * The sentence above it is static — see the strings table on why — so this is
 * where „5 V" and „1,7–3,6 V" are actually built. `formatToolNumber` does the
 * decimal comma, as it does for every other number this renderer prints; an
 * address is the one exception and is written in hex, because that is how every
 * datasheet and every module's silkscreen gives it.
 */
function formatRuleValue(value: RuleValue): string {
  const r = strings.electronics.rules;
  switch (value.kind) {
    case "volts":
      return `${formatToolNumber(value.amount)} ${r.volts}`;
    case "milliamps":
      return `${formatToolNumber(value.amount)} ${r.milliamps}`;
    case "range":
      return `${formatToolNumber(value.min)}${r.rangeDash}${formatToolNumber(value.max)} ${r.volts}`;
    case "address":
      return `${r.addressPrefix}${value.value.toString(16).toUpperCase().padStart(2, "0")}`;
  }
}
