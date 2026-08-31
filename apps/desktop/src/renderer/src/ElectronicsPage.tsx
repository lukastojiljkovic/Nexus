import { useCallback, useEffect, useRef, useState } from "react";
import {
  COMPONENT_CATALOGUE,
  MAX_CIRCUIT_NAME_LENGTH,
  WIRE_COLOURS,
  catalogueComponent,
  circuitProblems,
  circuitRules,
} from "@nexus/core";
import type { CircuitPart, ComponentDef, PartRotation, WireColour, WireEnd } from "@nexus/core";
import { Button, EmptyState, Icon, LoadingState, PageHeader, TextField } from "@nexus/ui";

import type { ElecCircuit, ElecCircuitDocument } from "../../shared/ipc.js";
import { ElecBench, type ElecSelection } from "./ElecBench.js";
import { ElecInspector } from "./ElecInspector.js";
import { ElecPalette } from "./ElecPalette.js";
import {
  contentBounds,
  dropSpot,
  fitView,
  sizeOf,
  viewCentre,
  zoomAbout,
  type ElecBounds,
  type ElecView,
} from "./elecGeometry.js";
import { moduleName } from "./moduleName.js";
import { NotePopover } from "./notePopover.js";
import { formatNotificationWhen } from "./notificationFormat.js";
import { neighbourAfterDelete, resolveOpenItem } from "./pickedList.js";
import { strings } from "./strings.js";

/**
 * „Elektronika" (ELEC) — the workbench: a circuit, the parts on it and the
 * jumpers between them.
 *
 * **The open circuit is held in memory and PATCHED by each write's own answer,
 * never re-read.** Every mutation channel was designed to answer with the row it
 * wrote (and `elec:remove-part` with the wire ids that went with the part)
 * precisely so this page never has to ask for the whole document again: a drag
 * ends in one write and one array replacement, where a re-read would cost every
 * part and wire on the circuit for a change of two numbers. The patch is keyed
 * to the circuit the write was issued against, so a write that lands after the
 * user has switched circuits is dropped rather than applied to a stranger.
 *
 * **The catalogue is imported, not fetched.** The 153 components are constants
 * in `@nexus/core`; there is no channel for them and no row in the file. A part
 * carries a `componentId`, and `catalogueComponent` is what turns it back into
 * pins and a size — `undefined` for an id this build does not ship, which is a
 * placeholder on the bench and a notice in the margin, never a lost row.
 *
 * **Wiring is two clicks, and the first one is a MODE.** A pin click with
 * nothing armed arms that pin; the next pin click on a different pin runs the
 * jumper. Escape disarms, and clicking the armed pin again says why a pin
 * cannot be wired to itself rather than silently doing nothing — the refusal is
 * the canvas's own, made before any write.
 *
 * **`view` is this page's state, not the bench's.** The zoom buttons and „fit"
 * live in the toolbar above the surface, the wheel lives inside it, and both
 * end up calling the same two functions in `elecGeometry.ts`. A view owned by
 * the bench would need an imperative handle for the buttons to reach.
 */
export interface ElectronicsPageProps {
  profileId: string;
}

/** How much one press of the zoom buttons moves the scale. */
const ZOOM_STEP = 1.25;

/** The colour a jumper gets when nothing has been chosen — ground is the wire everybody runs first. */
const DEFAULT_WIRE_COLOUR: WireColour = "black";

/** A part's component, or `undefined` for one this build does not ship. */
function resolveComponent(componentId: string): ComponentDef | undefined {
  return catalogueComponent(componentId);
}

/** The box every part on the circuit covers — what „prilagodi prikaz" frames. */
function boundsOf(parts: readonly CircuitPart[]): ElecBounds | null {
  return contentBounds(parts, (index) => {
    const part = parts[index];
    return sizeOf(part === undefined ? undefined : resolveComponent(part.componentId));
  });
}

export function ElectronicsPage({ profileId }: ElectronicsPageProps) {
  const s = strings.electronics;

  const [circuits, setCircuits] = useState<ElecCircuit[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [doc, setDoc] = useState<ElecCircuitDocument | null>(null);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  /** The name form, open for a new circuit (`{ id: null }`) or for a rename (`{ id }`). */
  const [naming, setNaming] = useState<{ id: string | null; draft: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  const [selection, setSelection] = useState<ElecSelection | null>(null);
  const [wiring, setWiring] = useState<WireEnd | null>(null);
  const [wireColour, setWireColour] = useState<WireColour>(DEFAULT_WIRE_COLOUR);
  const [view, setView] = useState<ElecView>({ tx: 0, ty: 0, scale: 1 });

  /**
   * The bench's measured size, in a ref rather than in state.
   *
   * It is read at exactly two moments — when a circuit is framed and when a
   * picked part is dropped into the middle of what is visible — and never
   * rendered. In state it would re-render the whole page on every window
   * resize, once per `ResizeObserver` callback, for a number nothing on screen
   * depends on.
   */
  const viewport = useRef({ width: 0, height: 0 });
  /** Which circuit the view has already been framed for, so a re-render does not re-frame it. */
  const fitted = useRef<string | null>(null);

  const onViewportChange = useCallback((size: { width: number; height: number }) => {
    viewport.current = size;
  }, []);

  /** Re-reads the circuit list, keeping whatever circuit was open when it is still there. */
  const reload = useCallback(async (): Promise<void> => {
    const listed = await window.nexus.listCircuits(profileId);
    setCircuits(listed);
    setActiveId((previous) => resolveOpenItem(listed, previous));
  }, [profileId]);

  /**
   * The mount read, and the one place a circuit is created without being asked
   * for.
   *
   * A profile with no circuits gets „Kolo" made for it, on „Tabla"'s terms: the
   * alternative is an empty state whose only button says „napravi kolo", which
   * is a question with one answer. The empty state below therefore only appears
   * after somebody deletes their last circuit, which IS a decision they made.
   */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        let listed = await window.nexus.listCircuits(profileId);
        if (listed.length === 0) {
          await window.nexus.createCircuit(profileId, s.firstCircuitName);
          listed = await window.nexus.listCircuits(profileId);
        }
        if (!active) return;
        setCircuits(listed);
        setActiveId(resolveOpenItem(listed, null));
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load circuits:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, s.firstCircuitName]);

  /**
   * Opens whichever circuit is active, and clears everything that belonged to
   * the one before it.
   *
   * The document is dropped FIRST rather than replaced when the answer arrives:
   * a selection and an armed pin are references into a document, and holding
   * the old one while the new one loads is how a panel ends up describing a part
   * that is on another circuit.
   */
  useEffect(() => {
    if (activeId === null) {
      setDoc(null);
      return;
    }
    let active = true;
    setDoc(null);
    setSelection(null);
    setWiring(null);
    setNotesSaved(false);
    void (async () => {
      try {
        const opened = await window.nexus.openCircuit(profileId, activeId);
        if (active) setDoc(opened);
      } catch (error) {
        if (active) setActionError(s.actionError);
        console.error("Nexus: failed to open circuit:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, activeId, s.actionError]);

  /**
   * Frames the circuit once, after the bench exists to be measured.
   *
   * This runs as an effect rather than at the end of the read above because the
   * viewport is measured by the bench's own layout effect, and the bench does
   * not exist until there is a document for it to draw. Keyed on the id in a ref
   * so that patching the document — which every write does — does not throw the
   * user's zoom away.
   */
  useEffect(() => {
    if (doc === null || fitted.current === doc.id) return;
    fitted.current = doc.id;
    setView(fitView(boundsOf(doc.parts), viewport.current));
  }, [doc]);

  /**
   * Escape and Delete, bound on the document because the surface is an SVG the
   * user reaches by clicking rather than by tabbing.
   *
   * The guard is what makes that safe: „Delete" inside the name field or the
   * notes box is a character, not a command, and a listener at this level sees
   * both.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (event.key === "Escape") {
        if (wiring !== null) setWiring(null);
        else setSelection(null);
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selection === null || busy) return;
      event.preventDefault();
      if (selection.kind === "part") void removePart(selection.id);
      else void removeWire(selection.id);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // `removePart`/`removeWire` are re-created every render and close over
    // `doc`, which is listed; everything else they touch is a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, wiring, busy, doc]);

  /** Runs one mutation: clears the previous refusal, blocks a second write, reports a failure. */
  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setActionError(s.actionError);
      console.error("Nexus: electronics action failed:", error);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Applies a write's answer to the document in memory — but only if the circuit
   * it was issued against is still the open one. A write that lands after a
   * switch belongs to a document this page no longer holds.
   */
  function patch(
    circuitId: string,
    update: (document: ElecCircuitDocument) => ElecCircuitDocument,
  ): void {
    setDoc((previous) =>
      previous === null || previous.id !== circuitId ? previous : update(previous),
    );
  }

  async function submitName(): Promise<void> {
    if (naming === null) return;
    const name = naming.draft.trim();
    if (name.length === 0) return;
    const target = naming.id;
    setNaming(null);
    await run(async () => {
      if (target === null) {
        const created = await window.nexus.createCircuit(profileId, name);
        await reload();
        setActiveId(created.id);
      } else {
        await window.nexus.renameCircuit(profileId, target, name);
        await reload();
        patch(target, (document) => ({ ...document, name }));
      }
    });
  }

  async function deleteCircuit(id: string): Promise<void> {
    // Computed against the list as it stands NOW, which is what makes „the one
    // after it" mean anything (`neighbourAfterDelete`).
    const next = neighbourAfterDelete(circuits ?? [], id);
    await run(async () => {
      await window.nexus.deleteCircuit(profileId, id);
      await reload();
      setActiveId(next);
      setPendingUndoId(id);
    });
  }

  async function undoDelete(id: string): Promise<void> {
    setPendingUndoId(null);
    await run(async () => {
      await window.nexus.restoreCircuit(profileId, id);
      await reload();
      setActiveId(id);
    });
  }

  async function saveNotes(notes: string): Promise<void> {
    if (doc === null) return;
    const circuitId = doc.id;
    await run(async () => {
      await window.nexus.setCircuitNotes(profileId, circuitId, notes);
      await reload();
      patch(circuitId, (document) => ({ ...document, notes }));
      setNotesSaved(true);
    });
  }

  async function addPart(component: ComponentDef): Promise<void> {
    if (doc === null) return;
    const circuitId = doc.id;
    const spot = dropSpot(
      viewCentre(view, viewport.current),
      doc.parts.map((part) => ({ x: part.x, y: part.y })),
    );
    await run(async () => {
      const part = await window.nexus.addCircuitPart(profileId, circuitId, {
        componentId: component.id,
        label: "",
        x: spot.x,
        y: spot.y,
        rotation: 0,
      });
      patch(circuitId, (document) => ({ ...document, parts: [...document.parts, part] }));
      setSelection({ kind: "part", id: part.id });
    });
  }

  async function editPart(
    id: string,
    fields: { label?: string; x?: number; y?: number; rotation?: number; value?: number | null },
  ): Promise<void> {
    if (doc === null) return;
    const circuitId = doc.id;
    await run(async () => {
      const edited = await window.nexus.updateCircuitPart(profileId, id, fields);
      patch(circuitId, (document) => ({
        ...document,
        parts: document.parts.map((part) => (part.id === edited.id ? edited : part)),
      }));
    });
  }

  function rotatePart(id: string): void {
    const part = doc?.parts.find((candidate) => candidate.id === id);
    if (part === undefined) return;
    // The four quarter turns, in one direction: a rotate button that also had to
    // offer the other direction is two buttons, and four presses come back to
    // where they started either way.
    const rotation = ((part.rotation + 90) % 360) as PartRotation;
    void editPart(id, { rotation });
  }

  async function removePart(id: string): Promise<void> {
    if (doc === null) return;
    const circuitId = doc.id;
    await run(async () => {
      // The answer is the wires that went with the part. Without it this page
      // would keep drawing jumpers to a part that is no longer there.
      const orphaned = new Set(await window.nexus.removeCircuitPart(profileId, id));
      patch(circuitId, (document) => ({
        ...document,
        parts: document.parts.filter((part) => part.id !== id),
        wires: document.wires.filter((wire) => !orphaned.has(wire.id)),
      }));
      setSelection((previous) =>
        previous === null ||
        (previous.kind === "part" && previous.id === id) ||
        (previous.kind === "wire" && orphaned.has(previous.id))
          ? null
          : previous,
      );
      // An armed pin on the part that just went is an arm pointing at nothing.
      setWiring((previous) => (previous?.partId === id ? null : previous));
    });
  }

  async function removeWire(id: string): Promise<void> {
    if (doc === null) return;
    const circuitId = doc.id;
    await run(async () => {
      await window.nexus.removeCircuitWire(profileId, id);
      patch(circuitId, (document) => ({
        ...document,
        wires: document.wires.filter((wire) => wire.id !== id),
      }));
      setSelection((previous) =>
        previous !== null && previous.kind === "wire" && previous.id === id ? null : previous,
      );
    });
  }

  async function recolourWire(id: string, colour: WireColour): Promise<void> {
    if (doc === null) return;
    const circuitId = doc.id;
    await run(async () => {
      const edited = await window.nexus.setCircuitWireColour(profileId, id, colour);
      patch(circuitId, (document) => ({
        ...document,
        wires: document.wires.map((wire) => (wire.id === edited.id ? edited : wire)),
      }));
    });
  }

  /** The two-click wiring gesture: arm a pin, then land on another one. */
  function onPinClick(end: WireEnd): void {
    if (doc === null || busy) return;
    if (wiring === null) {
      setActionError(null);
      setWiring(end);
      return;
    }
    if (wiring.partId === end.partId && wiring.pinId === end.pinId) {
      // The armed pin, clicked again. Said rather than silently ignored: „nothing
      // happened" is indistinguishable from a broken surface.
      setWiring(null);
      setActionError(s.bench.wiringSelf);
      return;
    }
    const circuitId = doc.id;
    const from = wiring;
    setWiring(null);
    void run(async () => {
      const wire = await window.nexus.addCircuitWire(profileId, circuitId, {
        from,
        to: end,
        colour: wireColour,
      });
      patch(circuitId, (document) => ({ ...document, wires: [...document.wires, wire] }));
      setSelection({ kind: "wire", id: wire.id });
    });
  }

  function zoomBy(factor: number): void {
    const { width, height } = viewport.current;
    setView((previous) => zoomAbout(previous, { x: width / 2, y: height / 2 }, factor));
  }

  if (failed) {
    return <EmptyState sigil="electronics" title={s.loadErrorTitle} description={s.loadError} />;
  }
  if (circuits === null) {
    return (
      <>
        <PageHeader
          className="elec__header"
          title={moduleName("electronics")}
          sigil="electronics"
        />
        <LoadingState label={strings.app.loading} rows={4} />
      </>
    );
  }

  const active = circuits.find((circuit) => circuit.id === activeId) ?? null;

  return (
    <div className="elec">
      <PageHeader
        className="elec__header"
        title={moduleName("electronics")}
        sigil="electronics"
        {...(active === null ? {} : { subtitle: active.name })}
        actions={
          <>
            <NotePopover
              label={s.circuitsLabel}
              triggerClassName="elec__switcher"
              triggerContent={
                <>
                  {s.circuitsLabel}
                  <span className="elec__count" aria-hidden="true">
                    {circuits.length}
                  </span>
                </>
              }
            >
              {(close) => (
                <>
                  {circuits.map((circuit) => {
                    const isActive = circuit.id === activeId;
                    return (
                      <button
                        key={circuit.id}
                        type="button"
                        className={`note__menu-item note__menu-item--check${isActive ? " dash__set-item--active" : ""}`}
                        role="menuitemradio"
                        aria-checked={isActive}
                        onClick={() => {
                          setActiveId(circuit.id);
                          close();
                        }}
                      >
                        <span
                          className={`note__menu-check${isActive ? "" : " note__menu-check--hidden"}`}
                          aria-hidden="true"
                        >
                          <Icon name="check" size={14} />
                        </span>
                        {/* Two lines, „Tabla"'s exactly: four circuits named a
                            month ago look alike, and when each was last touched
                            is the thing that tells them apart. */}
                        <span className="elec__switcher-text">
                          <span className="elec__switcher-name">{circuit.name}</span>
                          <span className="elec__switcher-meta">
                            {s.circuitUpdatedPrefix} {formatNotificationWhen(circuit.updatedAt)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </NotePopover>
            <Button variant="ghost" onClick={() => setNaming({ id: null, draft: "" })}>
              {s.newCircuit}
            </Button>
            {active !== null && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setNaming({ id: active.id, draft: active.name })}
                >
                  {s.rename}
                </Button>
                <Button variant="danger" onClick={() => void deleteCircuit(active.id)}>
                  {s.delete}
                </Button>
              </>
            )}
          </>
        }
      />

      {naming !== null && (
        <form
          className="elec__name-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitName();
          }}
        >
          <TextField
            label={s.nameLabel}
            placeholder={s.namePlaceholder}
            value={naming.draft}
            maxLength={MAX_CIRCUIT_NAME_LENGTH}
            autoFocus
            onChange={(event) =>
              setNaming((previous) =>
                previous === null ? previous : { ...previous, draft: event.target.value },
              )
            }
          />
          <Button type="submit" variant="primary" disabled={naming.draft.trim().length === 0}>
            {s.save}
          </Button>
          <Button variant="ghost" onClick={() => setNaming(null)}>
            {s.cancel}
          </Button>
        </form>
      )}

      {actionError !== null && (
        <p className="elec__error" role="alert">
          {actionError}
          <Button variant="ghost" onClick={() => setActionError(null)}>
            {s.dismiss}
          </Button>
        </p>
      )}

      {pendingUndoId !== null && (
        <p className="elec__notice" role="status">
          {s.deletedNotice}
          <Button variant="ghost" onClick={() => void undoDelete(pendingUndoId)}>
            {s.undo}
          </Button>
        </p>
      )}

      {active === null ? (
        <EmptyState sigil="electronics" title={s.emptyTitle} description={s.emptyDescription} />
      ) : doc === null ? (
        <LoadingState label={strings.app.loading} rows={4} />
      ) : (
        <div className="elec__instrument">
          <ElecPalette components={COMPONENT_CATALOGUE} onAdd={(c) => void addPart(c)} busy={busy} />

          <div className="elec__bench">
            <div className="elec__toolbar">
              {/* The colour the NEXT jumper gets. It sits with the bench rather
                  than in the panel on the right, because it is a choice made
                  before the two clicks that run a wire — the panel recolours one
                  that already exists. */}
              <div
                className="elec-swatches"
                role="radiogroup"
                aria-label={s.bench.wireColourLabel}
              >
                {WIRE_COLOURS.map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    className={`nx-swatch elec-swatch elec-swatch--${colour}${colour === wireColour ? " nx-swatch--selected" : ""}`}
                    role="radio"
                    aria-checked={colour === wireColour}
                    aria-label={s.bench.colours[colour]}
                    title={s.bench.colours[colour]}
                    onClick={() => setWireColour(colour)}
                  />
                ))}
              </div>

              <p className="elec__hint" role="status">
                {wiring === null ? s.bench.wiringIdle : s.bench.wiringArmed}
              </p>

              <div className="elec__zoom">
                <span className="elec__zoom-value" aria-label={s.bench.zoomLabel}>
                  {Math.round(view.scale * 100)} %
                </span>
                <Button variant="ghost" aria-label={s.bench.zoomOut} onClick={() => zoomBy(1 / ZOOM_STEP)}>
                  <Icon name="minus" size={16} />
                </Button>
                <Button variant="ghost" aria-label={s.bench.zoomIn} onClick={() => zoomBy(ZOOM_STEP)}>
                  <Icon name="plus" size={16} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={s.bench.zoomFit}
                  onClick={() => setView(fitView(boundsOf(doc.parts), viewport.current))}
                >
                  <Icon name="expand" size={16} />
                </Button>
              </div>
            </div>

            <ElecBench
              parts={doc.parts}
              wires={doc.wires}
              resolve={resolveComponent}
              view={view}
              onViewChange={setView}
              onViewportChange={onViewportChange}
              selection={selection}
              onSelect={setSelection}
              wiring={wiring}
              onPinClick={onPinClick}
              onMovePart={(id, x, y) => void editPart(id, { x, y })}
            />

            {doc.parts.length === 0 && (
              <p className="elec__bench-empty">
                <span className="elec__bench-empty-title">{s.bench.emptyTitle}</span>
                {s.bench.emptyDescription}
              </p>
            )}
          </div>

          <ElecInspector
            circuit={doc}
            resolve={resolveComponent}
            selection={selection}
            problems={circuitProblems(doc, resolveComponent)}
            rules={circuitRules(doc, resolveComponent)}
            busy={busy}
            onRenamePart={(id, label) => void editPart(id, { label })}
            onRotatePart={rotatePart}
            onSetPartValue={(id, value) => void editPart(id, { value })}
            onRemovePart={(id) => void removePart(id)}
            onSetWireColour={(id, colour) => void recolourWire(id, colour)}
            onRemoveWire={(id) => void removeWire(id)}
            onSaveNotes={(notes) => void saveNotes(notes)}
            notesSaved={notesSaved}
          />
        </div>
      )}
    </div>
  );
}
