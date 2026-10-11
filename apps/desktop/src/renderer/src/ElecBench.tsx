import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CircuitPart, CircuitWire, ComponentDef, WireEnd } from "@nexus/core";

import { partDisplayName } from "./elecCatalogue.js";
import { componentName, pinLabel } from "./elecLocale.js";
import {
  PIN_LABEL_INSET,
  PIN_LEG,
  partTransform,
  pinDirection,
  pinLayout,
  pinPoint,
  rotatedSize,
  sizeOf,
  snapToGrid,
  wireFocusBox,
  wirePath,
  zoomAbout,
  type ElecPoint,
  type ElecView,
  type WireAnchor,
} from "./elecGeometry.js";
import {
  wireFocusAfterRemoval,
  wireFocusOrder,
  wireFocusTarget,
  wireKeyIntent,
  wireName,
  wireTabStop,
} from "./elecWires.js";
import { strings } from "./strings.js";

/** What the panel on the right is currently describing. */
export type ElecSelection = { kind: "part"; id: string } | { kind: "wire"; id: string };

export interface ElecBenchProps {
  parts: readonly CircuitPart[];
  wires: readonly CircuitWire[];
  /** The catalogue, or the user's own components — `undefined` for an id this build does not ship. */
  resolve: (componentId: string) => ComponentDef | undefined;
  view: ElecView;
  onViewChange: (view: ElecView) => void;
  /** The surface's own size in pixels, reported so the page can drop a new part in the middle of it. */
  onViewportChange: (size: { width: number; height: number }) => void;
  selection: ElecSelection | null;
  onSelect: (selection: ElecSelection | null) => void;
  /** The armed end of a wire being drawn, or nothing. */
  wiring: WireEnd | null;
  onPinClick: (end: WireEnd) => void;
  /** A finished drag. Both coordinates are already snapped to the grid. */
  onMovePart: (id: string, x: number, y: number) => void;
  /**
   * A write is in flight. Delete on a focused wire waits for it, exactly as the
   * panel's own remove button does while it is disabled.
   */
  busy: boolean;
  /**
   * Removes a wire. This is the page's own `removeWire` — the same call the
   * panel's button makes — so the key and the pointer are one act rather than
   * two that have to agree.
   */
  onRemoveWire: (id: string) => void;
}

/** A drag in progress: which part, where it started, and how far the pointer has come. */
interface DragState {
  partId: string;
  originX: number;
  originY: number;
  fromX: number;
  fromY: number;
  dx: number;
  dy: number;
}

/** The pin's clickable disc, in circuit units — 24 across at 1×, which is also the pin pitch. */
const PIN_HIT_RADIUS = 12;
/** The visible pad. */
const PIN_PAD = 7;

/**
 * Pointer capture, taken and given back without letting either one abort the
 * gesture it belongs to.
 *
 * Both calls throw `NotFoundError` when the pointer id is not active — and
 * „not active" is reachable: a click fast enough that the button is already up
 * by the time React's handler runs, a pointer that left the window, or an event
 * synthesised by anything other than a hand (the screenshot sweep, an assistive
 * technology). Unguarded, the throw happens BEFORE the rest of the handler, so
 * the part is highlighted and then simply cannot be dragged, and the release
 * leaves `drag` set for ever — the gesture ends by throwing rather than by
 * finishing. Capture is an optimisation (it keeps the moves coming when the
 * pointer leaves the shape); the drag arithmetic does not depend on it.
 */
function capture(target: Element, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // No active pointer with this id — see above. The gesture continues.
  }
}

function release(target: Element, pointerId: number): void {
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // Already released, or never held.
  }
}

/**
 * The workbench: parts, their pins, and the jumpers between them, drawn as SVG.
 *
 * **Everything is inside ONE transformed group.** Panning and zooming move that
 * group rather than a `viewBox`, so a pointer position converts to circuit units
 * with two subtractions and a divide (`toCircuitPoint`) — and every hit test,
 * every drag and the wheel zoom read the same three numbers. A `viewBox` would
 * put the same arithmetic behind an API that also decides aspect ratio, which is
 * a second thing to be wrong about.
 *
 * **The grid is a pattern OUTSIDE that group.** A rectangle big enough to cover
 * the working area at every zoom is a rectangle two hundred thousand units wide;
 * a pattern on a full-size rect with a `patternTransform` says the same thing
 * and costs nothing at any zoom.
 *
 * **A part's name and its pin labels do not turn with the part.** The body does
 * — that is what a rotation IS — but text rotated 180° is text nobody can read,
 * and the name of a part is the one thing on this surface that must stay legible
 * at every angle. The name is drawn outside the rotated group and each pin label
 * is counter-rotated about its own anchor, which is what every board tool does
 * with a reference designator and for this reason.
 */
export function ElecBench({
  parts,
  wires,
  resolve,
  view,
  onViewChange,
  onViewportChange,
  selection,
  onSelect,
  wiring,
  onPinClick,
  onMovePart,
  busy,
  onRemoveWire,
}: ElecBenchProps) {
  const s = strings.electronics.bench;
  const surface = useRef<HTMLDivElement | null>(null);
  /**
   * The bench itself: where the wires group hands focus back to on Escape.
   *
   * `tabIndex={-1}` and not `0` — the surface must never be a tab stop of its
   * own (Tab moves from the parts to the wires group and then past both), and a
   * programmatic focus needs an element that is allowed to hold one.
   */
  const benchSvg = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pan, setPan] = useState<{ fromX: number; fromY: number; tx: number; ty: number } | null>(
    null,
  );
  /**
   * The wire the group's single tab stop is on, by ID.
   *
   * By id rather than by index, because wires arrive and leave: an index would
   * put the stop on whichever wire slid into that position, so the user's place
   * in the group would move without anything on screen having moved.
   */
  const [wireFocus, setWireFocus] = useState<string | null>(null);
  /** The group's boxes by wire id, so a key that moves focus can call `.focus()` on one. */
  const wireRings = useRef(new Map<string, SVGRectElement>());

  /**
   * The surface's own size, measured rather than assumed.
   *
   * `useLayoutEffect` so the first measurement lands before the browser paints:
   * the page places a newly picked part at the middle of what is visible, and a
   * viewport reported one frame late would put the first part of every session
   * at the origin instead.
   */
  useLayoutEffect(() => {
    const element = surface.current;
    if (element === null) return;
    const report = (): void => {
      onViewportChange({ width: element.clientWidth, height: element.clientHeight });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onViewportChange]);

  /** A pointer event's position inside the surface, in pixels. */
  const localPoint = useCallback((clientX: number, clientY: number): ElecPoint => {
    const box = surface.current?.getBoundingClientRect();
    return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
  }, []);

  /**
   * The wheel is bound by hand, and it has to be.
   *
   * React registers `wheel` on its root container as a PASSIVE listener, so
   * `preventDefault` inside an `onWheel` prop does nothing but log a warning —
   * and without it the scroll goes to whatever ancestor can take it, so zooming
   * the bench would also scroll the page out from under it.
   */
  useEffect(() => {
    const element = surface.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      onViewChange(zoomAbout(view, localPoint(event.clientX, event.clientY), factor));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [view, onViewChange, localPoint]);

  function startDrag(event: ReactPointerEvent<SVGGElement>, part: CircuitPart): void {
    // Left button only: the middle button pans on many tools and the right one
    // is the context menu, and neither should pick a part up.
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect({ kind: "part", id: part.id });
    capture(event.currentTarget, event.pointerId);
    const point = localPoint(event.clientX, event.clientY);
    setDrag({
      partId: part.id,
      originX: part.x,
      originY: part.y,
      fromX: point.x,
      fromY: point.y,
      dx: 0,
      dy: 0,
    });
  }

  function moveDrag(event: ReactPointerEvent<SVGGElement>): void {
    if (drag === null) return;
    const point = localPoint(event.clientX, event.clientY);
    setDrag({
      ...drag,
      dx: (point.x - drag.fromX) / view.scale,
      dy: (point.y - drag.fromY) / view.scale,
    });
  }

  function endDrag(event: ReactPointerEvent<SVGGElement>): void {
    if (drag === null) return;
    release(event.currentTarget, event.pointerId);
    const x = snapToGrid(drag.originX + drag.dx);
    const y = snapToGrid(drag.originY + drag.dy);
    setDrag(null);
    // A click that never moved is a SELECTION, not a move. Writing the same two
    // coordinates back would put a row through the sync outbox on every click.
    if (x !== drag.originX || y !== drag.originY) onMovePart(drag.partId, x, y);
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.button !== 0) return;
    onSelect(null);
    capture(event.currentTarget, event.pointerId);
    const point = localPoint(event.clientX, event.clientY);
    setPan({ fromX: point.x, fromY: point.y, tx: view.tx, ty: view.ty });
  }

  function movePan(event: ReactPointerEvent<SVGSVGElement>): void {
    if (pan === null) return;
    const point = localPoint(event.clientX, event.clientY);
    onViewChange({
      ...view,
      tx: pan.tx + (point.x - pan.fromX),
      ty: pan.ty + (point.y - pan.fromY),
    });
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>): void {
    if (pan === null) return;
    release(event.currentTarget, event.pointerId);
    setPan(null);
  }

  /** Where a part is being drawn RIGHT NOW — its stored place, plus however far the pointer has taken it. */
  const drawnOrigin = (part: CircuitPart): ElecPoint =>
    drag !== null && drag.partId === part.id
      ? { x: part.x + drag.dx, y: part.y + drag.dy }
      : { x: part.x, y: part.y };

  const partsById = new Map(parts.map((part) => [part.id, part]));

  /** A part's name as the interface shows it: the user's own label, the catalogue's name, or the placeholder. */
  function nameOfPart(part: CircuitPart, component: ComponentDef | undefined): string {
    return partDisplayName(
      part.label,
      component === undefined ? undefined : componentName(component),
      s.unknownPart,
    );
  }

  /**
   * One end of a wire, resolved: where it sits, which way it leaves its pin, and
   * the two names a reader hears for it.
   *
   * The names ride along with the geometry because they are answers to the same
   * question about the same pin — and because the group below needs a name for
   * every wire on every render, exactly as the drawing needs a path for every
   * wire. An end that cannot be placed yields nothing at all: that wire is not
   * drawn, `circuitProblems` names it in the margin, and it is not a target.
   */
  function endOf(end: WireEnd): { anchor: WireAnchor; part: string; pin: string } | null {
    const part = partsById.get(end.partId);
    if (part === undefined) return null;
    const component = resolve(part.componentId);
    if (component === undefined) return null;
    const placed = pinLayout(component).find((pin) => pin.pin.id === end.pinId);
    if (placed === undefined) return null;
    const point = pinPoint(drawnOrigin(part), component, end.pinId, part.rotation);
    if (point === undefined) return null;
    // A leg further out than the body edge, because that is where the PAD is
    // drawn and a jumper is soldered to the pad. Without the offset every wire
    // would start a leg short and appear to pass through the part's outline.
    const out = pinDirection(placed.side, part.rotation);
    return {
      anchor: { x: point.x + out.x * PIN_LEG, y: point.y + out.y * PIN_LEG, out },
      part: nameOfPart(part, component),
      pin: pinLabel(placed.pin),
    };
  }

  /**
   * The wires this build can draw, with BOTH ends resolved once.
   *
   * Both, because a wire with one end that cannot be placed is not drawn at all
   * — and a wire that is not on the bench must not be somewhere the keyboard can
   * land: its ring would be around nothing.
   */
  const drawn = wires.flatMap((wire) => {
    const from = endOf(wire.from);
    const to = endOf(wire.to);
    return from === null || to === null
      ? []
      : [{ id: wire.id, colour: wire.colour, anchor: from.anchor, from, to }];
  });
  /** The same wires, in the order the arrow keys walk them (the order itself is `elecWires.ts`). */
  const ordered = wireFocusOrder(drawn);
  const ringIds = ordered.map((entry) => entry.id);
  const tabStop = wireTabStop(ringIds, wireFocus);

  /**
   * The wires group's own keys. Which key means what is `elecWires.ts`; where
   * the answer lands is here.
   *
   * **Delete is handled and stopped here**, rather than left to the page's
   * document listener: that one acts on the SELECTION, and the wire the keyboard
   * is on need not be selected yet. It is the same call the panel's remove
   * button makes, so the key and the pointer are one act.
   *
   * **Escape is handled without `preventDefault` and without a stop.** The ring
   * hands focus back to the bench and the page's own Escape — which unwinds an
   * armed pin and then a selection — still runs, which is what Escape means
   * everywhere else in this module; and its browser default (leaving fullscreen)
   * is not ours to take.
   */
  function onWireKeyDown(event: ReactKeyboardEvent<SVGRectElement>, id: string): void {
    const intent = wireKeyIntent(event.key);
    if (intent === null) return;
    if (intent !== "leave") event.preventDefault();

    switch (intent) {
      case "select":
        onSelect({ kind: "wire", id });
        return;
      case "remove": {
        if (busy) return;
        event.stopPropagation();
        // Focus is given up BEFORE the write that removes the wire lands: the
        // element unmounts, and focus does not stay on a node that is gone.
        const next = wireFocusAfterRemoval(ringIds, id);
        setWireFocus(next);
        if (next !== null) wireRings.current.get(next)?.focus();
        onRemoveWire(id);
        return;
      }
      case "leave":
        benchSvg.current?.focus();
        return;
      default: {
        const target = wireFocusTarget(ringIds, id, intent);
        if (target === null) return;
        setWireFocus(target);
        wireRings.current.get(target)?.focus();
      }
    }
  }

  return (
    <div className="elec__surface" ref={surface}>
      <svg
        ref={benchSvg}
        className="elec__svg"
        width="100%"
        height="100%"
        role="application"
        tabIndex={-1}
        aria-label={s.label}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <defs>
          {/* The bench's ruled surface. `patternTransform` carries the view, so
              the grid pans and zooms with the parts without anything being drawn
              at circuit scale. */}
          <pattern
            id="elec-grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
          >
            <path className="elec__grid-line" d="M 20 0 L 0 0 0 20" fill="none" />
          </pattern>
        </defs>
        <rect className="elec__ground" width="100%" height="100%" />
        <rect width="100%" height="100%" fill="url(#elec-grid)" />

        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {/* Wires first, so a jumper passes UNDER the parts it connects rather
              than across their labels — which is also where it is on the desk. */}
          {drawn.map(({ id, colour, from, to }) => {
            // `drawn` holds only wires whose two ends resolved: a wire with an
            // end this build cannot place is not drawn and not lost — the
            // circuit still holds it and `circuitProblems` names it in the
            // margin, and drawing it to the origin would be inventing a position.
            const path = wirePath(from.anchor, to.anchor);
            const chosen = selection?.kind === "wire" && selection.id === id;
            return (
              <g key={id} className="elec-wire">
                {/* An accent CASING under the wire, never a glow: the selection
                    reads as an outline around the jumper, which is the same
                    „accent border" every other selectable object in this app
                    wears. */}
                {chosen && <path className="elec-wire__casing" d={path} />}
                <path className={`elec-wire__line elec-wire__line--${colour}`} d={path} />
                {/* Invisible and fat, so a three-unit line is still a target a
                    person can hit. */}
                <path
                  className="elec-wire__hit"
                  d={path}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onSelect({ kind: "wire", id });
                  }}
                />
              </g>
            );
          })}

          {parts.map((part) => {
            const component = resolve(part.componentId);
            const size = sizeOf(component);
            const box = rotatedSize(size, part.rotation);
            const origin = drawnOrigin(part);
            const name = nameOfPart(part, component);
            const chosen = selection?.kind === "part" && selection.id === part.id;
            const classes = ["elec-part"];
            if (chosen) classes.push("elec-part--selected");
            if (component === undefined) classes.push("elec-part--unknown");

            return (
              <g key={part.id} className={classes.join(" ")}>
                <g
                  transform={partTransform(origin, size, part.rotation)}
                  role="button"
                  tabIndex={0}
                  aria-label={name}
                  onPointerDown={(event) => startDrag(event, part)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onSelect({ kind: "part", id: part.id });
                  }}
                >
                  <rect
                    className="elec-part__body"
                    x={0}
                    y={0}
                    width={size.width}
                    height={size.height}
                    rx={6}
                  />
                  {component !== undefined &&
                    pinLayout(component).map((placed) => {
                      const outward = placed.side === "left" ? -1 : 1;
                      const armed =
                        wiring !== null &&
                        wiring.partId === part.id &&
                        wiring.pinId === placed.pin.id;
                      const anchor = placed.x + outward * PIN_LEG;
                      const label = placed.x - outward * PIN_LABEL_INSET;
                      return (
                        <g
                          key={placed.pin.id}
                          className={`elec-pin${armed ? " elec-pin--armed" : ""}`}
                        >
                          <line
                            className="elec-pin__leg"
                            x1={placed.x}
                            y1={placed.y}
                            x2={anchor}
                            y2={placed.y}
                          />
                          <rect
                            className="elec-pin__pad"
                            x={anchor - PIN_PAD / 2}
                            y={placed.y - PIN_PAD / 2}
                            width={PIN_PAD}
                            height={PIN_PAD}
                          />
                          <text
                            className="elec-pin__label"
                            x={label}
                            y={placed.y}
                            textAnchor={placed.side === "left" ? "start" : "end"}
                            dominantBaseline="middle"
                            transform={`rotate(${-part.rotation} ${label} ${placed.y})`}
                          >
                            {pinLabel(placed.pin)}
                          </text>
                          <circle
                            className="elec-pin__hit"
                            cx={anchor}
                            cy={placed.y}
                            r={PIN_HIT_RADIUS}
                            role="button"
                            tabIndex={0}
                            aria-label={`${name} · ${pinLabel(placed.pin)}`}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              onPinClick({ partId: part.id, pinId: placed.pin.id });
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              onPinClick({ partId: part.id, pinId: placed.pin.id });
                            }}
                          />
                        </g>
                      );
                    })}
                </g>
                {/* Outside the rotated group on purpose — see the header. */}
                <text
                  className="elec-part__name"
                  x={origin.x + box.width / 2}
                  y={origin.y - 8}
                  textAnchor="middle"
                >
                  {name}
                </text>
              </g>
            );
          })}

          {/*
            The keyboard's half of the wires: one box per wire, invisible until
            it is focused, and the whole group costs ONE tab stop (WAI-ARIA's
            roving tabindex, which is what makes a bench of two hundred jumpers
            walkable with the arrows rather than two hundred presses of Tab).

            It is drawn AFTER the parts because that is where Tab has to reach
            it; the wires themselves stay under them, where a jumper belongs.
            Those two facts are why one wire is two elements here rather than
            one, and the ring is `pointer-events: none` (see the stylesheet):
            a box around a wire overlaps the wire, the parts and their pins, and
            a ring that could be clicked would quietly take the hit path's
            clicks. Nothing a pointer does changes.
          */}
          <g className="elec-wires__focus" role="group" aria-label={s.wiresLabel}>
            {ordered.map(({ id, colour, from, to }) => {
              const box = wireFocusBox(from.anchor, to.anchor);
              return (
                <rect
                  key={id}
                  className="elec-wire__focus"
                  x={box.minX}
                  y={box.minY}
                  width={box.maxX - box.minX}
                  height={box.maxY - box.minY}
                  rx={6}
                  role="button"
                  tabIndex={id === tabStop ? 0 : -1}
                  aria-label={wireName(from, to, colour)}
                  ref={(node) => {
                    if (node === null) wireRings.current.delete(id);
                    else wireRings.current.set(id, node);
                  }}
                  onFocus={() => setWireFocus(id)}
                  // A screen reader's activation reaches the element as a click
                  // rather than as a key press; a pointer's never gets here at
                  // all, so this is the keyboard's path and not a second one.
                  onClick={() => onSelect({ kind: "wire", id })}
                  onKeyDown={(event) => onWireKeyDown(event, id)}
                />
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
}
