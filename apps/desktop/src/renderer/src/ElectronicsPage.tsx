import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COMPONENT_CATALOGUE,
  MAX_CIRCUIT_NAME_LENGTH,
  WIRE_COLOURS,
  buildSimBench,
  catalogueComponent,
  circuitProblems,
  circuitRules,
  generateCode,
} from "@nexus/core";
import type {
  Chassis,
  CircuitPart,
  ComponentDef,
  PartRotation,
  WireColour,
  WireEnd,
} from "@nexus/core";
import { Button, EmptyState, Icon, LoadingState, PageHeader, TextField } from "@nexus/ui";

import type {
  CodeExportResult,
  ElecCircuit,
  ElecCircuitDocument,
  ElecUpdatePartRequest,
} from "../../shared/ipc.js";
import { ElecBench, type ElecSelection } from "./ElecBench.js";
import { ElecChassisDialog } from "./ElecChassisDialog.js";
import { ElecCodeDialog } from "./ElecCodeDialog.js";
import { ElecInspector } from "./ElecInspector.js";
import { ElecPalette } from "./ElecPalette.js";
import { ElecRunnerDialog } from "./ElecRunnerDialog.js";
import { ElecSimDialog } from "./ElecSimDialog.js";
import { componentName, pinLabel } from "./elecLocale.js";
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
import { DEFAULT_WIRE_COLOUR } from "./elecWires.js";
import { moduleName } from "./moduleName.js";
import { NotePopover } from "./notePopover.js";
import { formatNotificationWhen } from "./notificationFormat.js";
import { neighbourAfterDelete, resolveOpenItem } from "./pickedList.js";
import { activeLocale, countUnit, strings } from "./strings.js";

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
/**
 * A pending deep link into the workbench — the palette's and the search page's
 * way in (021-e), and the shape `NotesIntent` and `StudyIntent` already have.
 *
 * One arm, because a circuit is created on the page from a name and nothing
 * asks for one from elsewhere: the only thing that reaches this module by id is
 * a search result, and what it wants is the circuit it named.
 */
export type ElecIntent = { kind: "reveal"; circuitId: string };

export interface ElectronicsPageProps {
  profileId: string;
  intent?: ElecIntent | null;
  /** Reports that `intent` above has been acted on, so the caller (App.tsx) can clear it. */
  onIntentHandled?: () => void;
}

/** How much one press of the zoom buttons moves the scale. */
const ZOOM_STEP = 1.25;

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

export function ElectronicsPage({ profileId, intent, onIntentHandled }: ElectronicsPageProps) {
  const s = strings.electronics;
  // The active language, and a component resolver that carries it: every
  // artefact derived from the circuit — the generated code, the rule messages,
  // the simulation bench's part column, the inspector — reads in the same
  // language, and core never has to know what that language is.
  const locale = activeLocale();
  const resolveLocalized = useMemo(
    () =>
      (componentId: string): ComponentDef | undefined => {
        const component = catalogueComponent(componentId);
        if (component === undefined) return undefined;
        return {
          ...component,
          name: componentName(component, locale),
          pins: component.pins.map((pin) => ({ ...pin, label: pinLabel(pin, locale) })),
        };
      },
    [locale],
  );

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
  /** The generated-code dialog (E4), and the one line left behind after it closes. */
  const [codeOpen, setCodeOpen] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  /** The external runner (E6) — the one dialog here that can start a process. */
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [codeNotice, setCodeNotice] = useState<string | null>(null);
  /** The chassis form (E4c) — nine numbers saved as one, so it is a dialog rather than nine committed fields. */
  const [chassisOpen, setChassisOpen] = useState(false);

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
   * Consumes a pending deep link (021-e): the circuit a search result named.
   *
   * It waits for the LIST rather than opening the id blind, because a result can
   * outlive its circuit — the row was indexed when the query ran, and a delete
   * between the keystroke and the click is a race a real user wins by being
   * fast. Trusting the id would open an empty bench and report nothing; checking
   * it against the list makes that case a stale result, which is what it is: the
   * intent is reported handled and the page stays where it is rather than
   * hunting for a row that no longer exists.
   *
   * `failed` is in the condition as well as `circuits`, so an unreadable list
   * does not leave the intent pending forever — the page has said what went
   * wrong, and re-firing the reveal on a later visit would only say it again.
   */
  useEffect(() => {
    if (!intent) return;
    if (circuits === null && !failed) return;
    if (circuits?.some((circuit) => circuit.id === intent.circuitId)) {
      setActiveId(intent.circuitId);
    }
    onIntentHandled?.();
  }, [intent, circuits, failed, onIntentHandled]);

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
    // All three dialogs belong to the circuit that was open. Each would
    // otherwise stay up and refill itself from a different circuit — the code
    // one with another board's sketch, the chassis one with another machine's
    // numbers, and the runner one with a plan for a workspace this page no
    // longer has open.
    setCodeOpen(false);
    setCodeNotice(null);
    setChassisOpen(false);
    setRunnerOpen(false);
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
   * Escape and Delete for whatever the POINTER selected. The keyboard's own half
   * is the wires group inside the bench, which handles Delete on the wire it is
   * on — a focused wire need not be the selected one, so it cannot be left to
   * this listener; what reaches here is a click's choice while focus sits
   * anywhere else. The surface itself is an SVG the user reaches by clicking
   * rather than by tabbing.
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

  /**
   * The four derived readings of the open circuit, memoised on the document.
   *
   * All four are pure functions of the same rows, and all four used to be
   * called inline in the JSX below — which meant re-deriving the nets, the
   * thirteen rules and the whole artefact on every keystroke in the notes box.
   * They change when the document OR the interface language changes and at no
   * other time, which is exactly what `useMemo` says: `resolveLocalized` carries
   * the language, so it is a dependency beside the document.
   *
   * The bench (ADR-085 E5) joins them on the same terms and for a sharper
   * version of the same reason: the dialog re-renders ten times a second
   * while the clock runs, and a model re-derived on every frame would walk
   * every net in the circuit to produce the list it produced last frame.
   */
  const problems = useMemo(
    () => (doc === null ? [] : circuitProblems(doc, resolveLocalized)),
    [doc, resolveLocalized],
  );
  const rules = useMemo(
    () => (doc === null ? [] : circuitRules(doc, resolveLocalized)),
    [doc, resolveLocalized],
  );
  const code = useMemo(
    () => (doc === null ? null : generateCode(doc, resolveLocalized, locale)),
    [doc, resolveLocalized, locale],
  );
  const bench = useMemo(
    () => (doc === null ? null : buildSimBench(doc, resolveLocalized)),
    [doc, resolveLocalized],
  );

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

  /**
   * Dimensions the machine, or takes it away (ADR-085 E4c).
   *
   * The answer is patched in rather than re-read, on this page's rule — but the
   * write is one row and the document in memory already holds everything else,
   * so „re-read" here would mean fetching every part and wire to learn nine
   * numbers the dialog just handed over.
   */
  async function saveChassis(chassis: Chassis | null): Promise<void> {
    if (doc === null) return;
    const circuitId = doc.id;
    await run(async () => {
      const saved = await window.nexus.setCircuitChassis(profileId, circuitId, chassis);
      patch(circuitId, (document) => {
        // Built without the key rather than with `chassis: undefined`: under
        // `exactOptionalPropertyTypes` those are different documents, and the
        // second leaves a `"chassis" in document` that is true of a circuit
        // with no machine.
        const { chassis: _removed, ...rest } = document;
        return saved === null ? rest : { ...rest, chassis: saved };
      });
      setChassisOpen(false);
    });
  }

  /**
   * Writes the code (ADR-085 E4). The payload is the circuit's id: main reads
   * its own rows, generates its own text and decides on its own whether the
   * user is shown a file picker or a directory one — so neither the bytes nor
   * the kind of dialog is something this page composed.
   *
   * A canceled dialog leaves everything as it was, including the preview — the
   * user pressed „Otkaži" in the OS's picker, not in ours. Every other outcome
   * closes the preview: a refusal can only mean the circuit changed under the
   * click, since „Sačuvaj kao…" is not rendered over a preview that already
   * refused, and the other three are done.
   */
  async function saveCode(): Promise<void> {
    if (doc === null) return;
    const circuitId = doc.id;
    setCodeNotice(null);
    await run(async () => {
      const result = await window.nexus.exportCircuitCode(profileId, circuitId);
      if (result.canceled) return;
      setCodeOpen(false);
      setCodeNotice(codeNoticeFor(result));
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
    fields: ElecUpdatePartRequest["fields"],
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
                {/* Enabled only once the circuit is actually open: the code is
                    derived from the parts and wires, which the list row does
                    not carry. */}
                <Button
                  className="elec__code"
                  variant="ghost"
                  disabled={doc === null}
                  onClick={() => setCodeOpen(true)}
                >
                  {s.code.open}
                </Button>
                {/* The bench, on the same terms: it reads the parts and wires,
                    which the list row does not carry. `.elec__sim` is an anchor
                    with no rule behind it, `.elec__code`'s arrangement — the
                    screenshot sweep needs a name for the control, and the
                    control needs no style of its own. */}
                <Button
                  className="elec__sim"
                  variant="ghost"
                  disabled={doc === null}
                  onClick={() => setSimOpen(true)}
                >
                  {s.sim.open}
                </Button>
                {/* The runner, on the same terms and with one more: it takes
                    the circuit's ID and nothing else, because what command that
                    ID becomes is main's decision from the user's own settings.
                    It is NOT disabled on a circuit with no ROS 2 package — the
                    refusal is a sentence inside the dialog, and a dead button
                    would leave the user to guess which of a dozen things they
                    did wrong. `.elec__runner` is an anchor with no rule behind
                    it, `.elec__code`'s arrangement. */}
                <Button
                  className="elec__runner"
                  variant="ghost"
                  disabled={doc === null}
                  onClick={() => setRunnerOpen(true)}
                >
                  {s.runner.open}
                </Button>
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

      {codeNotice !== null && (
        <p className="elec__notice" role="status">
          {codeNotice}
          <Button variant="ghost" onClick={() => setCodeNotice(null)}>
            {s.dismiss}
          </Button>
        </p>
      )}

      {codeOpen && code !== null && (
        <ElecCodeDialog
          code={code}
          // ADR-085 E4c. The dialog is told the FACT rather than the conclusion:
          // what a machine means for the artefact is a question about the
          // artefact, and only the sketch half has an answer worth printing.
          hasMachine={doc?.chassis !== undefined}
          errors={rules.filter((finding) => finding.severity === "error").length}
          busy={busy}
          onSave={() => void saveCode()}
          onClose={() => setCodeOpen(false)}
        />
      )}

      {simOpen && bench !== null && (
        <ElecSimDialog
          // Keyed by the circuit, so the waveforms typed into the bench are the
          // OPEN circuit's — the chassis dialog's rule, for the same reason.
          key={doc?.id}
          bench={bench}
          onClose={() => setSimOpen(false)}
        />
      )}

      {chassisOpen && doc !== null && (
        <ElecChassisDialog
          // Keyed by the circuit, so the drafts inside are the OPEN circuit's
          // rather than whatever was typed into the one before it.
          key={doc.id}
          chassis={doc.chassis}
          busy={busy}
          onSave={(chassis) => void saveChassis(chassis)}
          onRemove={() => void saveChassis(null)}
          onClose={() => setChassisOpen(false)}
        />
      )}

      {runnerOpen && doc !== null && (
        <ElecRunnerDialog
          // Keyed by the circuit for the same reason the chassis dialog is, and
          // for a sharper one: the plan names a workspace derived from this
          // circuit, so a panel carried over from another one would print the
          // literal command for a package the user is no longer looking at.
          key={doc.id}
          profileId={profileId}
          circuitId={doc.id}
          onClose={() => setRunnerOpen(false)}
        />
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
              busy={busy}
              onRemoveWire={(id) => void removeWire(id)}
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
            problems={problems}
            rules={rules}
            busy={busy}
            onRenamePart={(id, label) => void editPart(id, { label })}
            onRotatePart={rotatePart}
            onSetPartValue={(id, value) => void editPart(id, { value })}
            onSetPartMount={(id, mount) => void editPart(id, { mount })}
            onRemovePart={(id) => void removePart(id)}
            onSetWireColour={(id, colour) => void recolourWire(id, colour)}
            onRemoveWire={(id) => void removeWire(id)}
            onSaveNotes={(notes) => void saveNotes(notes)}
            onOpenChassis={() => setChassisOpen(true)}
            notesSaved={notesSaved}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The sentence a settled export gets (ADR-085 E4).
 *
 * A `switch` over the outcome rather than a truthiness test on some field: the
 * four are genuinely different things that happened — a file written, a
 * directory created, a circuit that has no code to give, and the one
 * destructive act main declines to perform — and `path` is present in three of
 * them, so no field tells them apart.
 *
 * A function rather than a table read at module scope, which `check:strings`
 * forbids and for a good reason: the locale switch rewrites these leaves, and a
 * value captured at import time would be the language the app started in.
 */
function codeNoticeFor(result: Extract<CodeExportResult, { canceled: false }>): string {
  const s = strings.electronics.code;
  switch (result.outcome) {
    case "refused":
      return s.refused[result.reason];
    case "sketch": {
      if (result.libraries === 0) return s.sketch.saved;
      const unit = countUnit(
        result.libraries,
        s.sketch.libraryOne,
        s.sketch.libraryFew,
        s.sketch.libraryMany,
      );
      return `${s.sketch.saved} ${s.sketch.savedLibraries} ${result.libraries} ${unit}.`;
    }
    case "package": {
      const unit = countUnit(result.files, s.ros.fileOne, s.ros.fileFew, s.ros.fileMany);
      return `${s.ros.saved} ${result.files} ${unit}.`;
    }
    case "exists":
      return s.ros.exists;
  }
}
