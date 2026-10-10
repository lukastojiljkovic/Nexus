import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, TextField } from "@nexus/ui";
import {
  HORIZON_RADIUS,
  NAKED_EYE_MAGNITUDE_LIMIT,
  apparentDirection,
  constellationAnchor,
  constellations,
  horizontalOf,
  moonPosition,
  projectStereographic,
  searchSky,
  skyFrame,
  skyPlace,
  starPlacement,
  starsBrighterThan,
  sunPosition,
  type BodyId,
  type LatLon,
  type PlanePoint,
  type SkySearchMatch,
  type StarPlacement,
} from "@nexus/core";
import { activeLocale } from "../../../../renderer/src/moduleKit/moduleSurface.js";
import { copy } from "./copy.js";
import {
  centredOn,
  clampView,
  fittedView,
  namedMagnitude,
  panBy,
  starRadius,
  tintFor,
  toPixel,
  zoomAt,
  type CanvasSize,
  type SkyView,
  type StarTint,
} from "./view.js";
import "./stars.css";

/**
 * The star map: the sky over one place at one instant, drawn on a canvas
 * through `@nexus/core`'s stereographic projection, with pan, zoom, a search
 * and a night mode.
 *
 * **What this component owns and what it does not.** It owns the canvas, the
 * view (pan and zoom, `view.ts`), the colours, and the search field. It does
 * NOT own the instant, the place or the night mode: those are props, because
 * the page around it is the thing that has a clock, a location and a light
 * switch - and because a map that decided those for itself could not be driven
 * by the rest of the astronomy module.
 *
 * **Everything drawn is computed once per frame, not once per repaint.** The
 * catalogue is reduced (`starPlacement`) and projected
 * (`projectStereographic`) in a memo keyed on the frame: a drag repaints sixty
 * times a second and each repaint is pure arithmetic over prepared numbers,
 * with no trigonometry and no re-derivation of the Earth's rotation per star.
 *
 * **The map is drawn in the theme's own tokens**, read off the canvas with
 * `getComputedStyle`: the surface as the field, the ink for the stars, the
 * accent for the constellation names and the Sun, the danger hue for the
 * night mode. Nothing here is a raw colour, and the night mode is a RE-TINTING
 * rather than a filter: everything is painted in one deep red on the darkest
 * surface the theme has, which is what leaves a reader's dark adaptation alone.
 */

/** A planet the caller has already reduced to an equatorial J2000 direction, as the engine reports one. */
export interface StarMapPlanet {
  readonly id: BodyId;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly magnitude: number;
}

export interface StarMapProps {
  /** The instant, epoch milliseconds. */
  readonly instantMs: number;
  readonly observer: LatLon;
  readonly planets?: readonly StarMapPlanet[];
  /** Red light and no tints: the mode a reader uses with dark-adapted eyes. */
  readonly nightMode: boolean;
}

/** One star, ready to draw. */
interface DrawnStar {
  readonly placement: StarPlacement;
  readonly point: PlanePoint;
}

/** One constellation's name and where it goes. */
interface DrawnLabel {
  readonly id: string;
  readonly label: string;
  readonly point: PlanePoint;
  readonly above: boolean;
}

/** The Sun, the Moon or one of the caller's planets, ready to draw. */
interface DrawnBody {
  readonly id: BodyId;
  readonly point: PlanePoint;
  readonly radius: number;
  readonly above: boolean;
}

/** The theme's colours and type, read off the canvas so a theme switch is a repaint and nothing more. */
interface Ink {
  readonly surface: string;
  readonly bg: string;
  readonly text: string;
  readonly muted: string;
  readonly faint: string;
  readonly subtle: string;
  readonly accent: string;
  readonly data: string;
  readonly danger: string;
  readonly font: string;
}

const TAU = Math.PI * 2;

function readInk(element: HTMLElement): Ink {
  const style = getComputedStyle(element);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  return {
    surface: read("--nx-surface"),
    bg: read("--nx-bg"),
    text: read("--nx-text"),
    muted: read("--nx-text-muted"),
    faint: read("--nx-text-faint"),
    subtle: read("--nx-text-subtle"),
    accent: read("--nx-accent"),
    data: read("--nx-data"),
    danger: read("--nx-danger"),
    font: `${read("--nx-font-size-body-sm")} ${read("--nx-font-family-ui")}`,
  };
}

/** A star's own colour, or the plain ink in the night mode's one red. */
function tintColour(ink: Ink, tint: StarTint): string {
  if (tint === "hot") return ink.subtle;
  if (tint === "warm") return ink.accent;
  if (tint === "red") return ink.danger;
  return ink.text;
}

export function StarMap({ instantMs, observer, planets = [], nightMode }: StarMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [view, setView] = useState<SkyView>(() => fittedView({ width: 0, height: 0 }));
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<SkySearchMatch | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  const locale = activeLocale();

  const { latDeg, lonDeg } = observer;
  const place = useMemo(() => skyPlace({ latDeg, lonDeg }), [latDeg, lonDeg]);
  const frame = useMemo(() => skyFrame(place, instantMs), [place, instantMs]);

  /**
   * The catalogue, reduced to the sky and projected: one pass per place and
   * instant. A star exactly at the projection's antipode has no image and is
   * dropped - nothing above the horizon is ever there.
   */
  const sky = useMemo(() => {
    const drawn: DrawnStar[] = [];
    for (const star of starsBrighterThan(NAKED_EYE_MAGNITUDE_LIMIT)) {
      const placement = starPlacement(star, frame);
      const point = projectStereographic({
        altitude: placement.apparentAltitude,
        azimuth: placement.azimuth,
      });
      if (point !== null) drawn.push({ placement, point });
    }
    return drawn;
  }, [frame]);

  /** The same stars by HR number, for the search's "centre on this one". */
  const starByHr = useMemo(
    () => new Map(sky.map((drawn) => [drawn.placement.star.hr, drawn])),
    [sky],
  );

  /**
   * The constellation names, anchored where `@nexus/core` says each of them
   * belongs, in the language the interface is being read in. The locale is read
   * here rather than captured, so switching language re-renders these.
   */
  const labels = useMemo(() => {
    const drawn: DrawnLabel[] = [];
    for (const constellation of constellations()) {
      const anchor = constellationAnchor(constellation.id);
      if (anchor === null) continue;
      const { azimuth, altitude, apparentAltitude } = horizontalOf(
        apparentDirection(anchor, frame),
        frame,
      );
      const point = projectStereographic({ altitude: apparentAltitude, azimuth });
      if (point !== null) {
        drawn.push({
          id: constellation.id,
          label: constellation.name[locale],
          point,
          above: altitude > 0,
        });
      }
    }
    return drawn;
  }, [frame, locale]);

  /** The Sun, the Moon and whatever the caller reduced to a direction. */
  const bodies = useMemo(() => {
    const drawn: DrawnBody[] = [];
    const push = (id: BodyId, azimuth: number, apparentAltitude: number, altitude: number, radius: number): void => {
      const point = projectStereographic({ altitude: apparentAltitude, azimuth });
      if (point !== null) drawn.push({ id, point, radius, above: altitude > 0 });
    };
    const sun = sunPosition(place, instantMs);
    push("sun", sun.azimuth, sun.apparentAltitude, sun.altitude, 4.6);
    const moon = moonPosition(place, instantMs);
    push("moon", moon.azimuth, moon.apparentAltitude, moon.altitude, 3.6);
    for (const planet of planets) {
      const { azimuth, altitude, apparentAltitude } = horizontalOf(
        apparentDirection({ rightAscension: planet.raDeg, declination: planet.decDeg }, frame),
        frame,
      );
      push(planet.id, azimuth, apparentAltitude, altitude, starRadius(planet.magnitude) + 1.6);
    }
    return drawn;
  }, [place, instantMs, frame, planets]);

  const matches = useMemo(
    () => (query.trim() === "" ? [] : searchSky(query, locale)),
    [query, locale],
  );

  /** Where a match wants the view centred, and whether it is up at all. */
  const targetOf = useCallback(
    (match: SkySearchMatch): { readonly point: PlanePoint; readonly above: boolean } | null => {
      if (match.kind === "star") {
        const drawn = starByHr.get(match.star.hr);
        return drawn === undefined
          ? null
          : { point: drawn.point, above: drawn.placement.altitude > 0 };
      }
      const label = labels.find((candidate) => candidate.id === match.constellation.id);
      return label === undefined ? null : { point: label.point, above: label.above };
    },
    [starByHr, labels],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const watcher = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const box = entry.contentRect;
        setSize((current) =>
          current.width === box.width && current.height === box.height
            ? current
            : { width: box.width, height: box.height },
        );
      }
    });
    watcher.observe(canvas);
    return () => watcher.disconnect();
  }, []);

  /**
   * A size change re-fits the view. Keeping the zoom across a resize would need
   * a rule for what the zoom is a zoom INTO - its centre is a plane point, and
   * the canvas it is centred on is a different box than it was - so the view
   * goes back to the horizon inscribed in the short side, which is what a chart
   * does when the paper is cut down.
   */
  useEffect(() => {
    setView(fittedView(size));
  }, [size]);

  /**
   * The canvas is painted from the theme's own custom properties, and a canvas
   * is not restyled by a stylesheet: a Dan/Noć switch has to repaint it. The
   * document's `data-theme` attribute is where the shell writes that switch, so
   * watching it is the whole of the wiring.
   */
  useEffect(() => {
    const subscription = new MutationObserver(() => setThemeTick((tick) => tick + 1));
    subscription.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => subscription.disconnect();
  }, []);

  /**
   * The wheel is attached by hand and NON-PASSIVELY: React's own `onWheel` is
   * registered on the root with `{ passive: true }`, so a `preventDefault` in
   * the handler would be ignored and the page would scroll behind the zoom.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((current) => zoomAt(current, factor, size, at));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [size]);

  const namedCap = namedMagnitude(view, size);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || size.width === 0 || size.height === 0) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    // The backing store is device-resolution, the drawing is in CSS pixels.
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint(context, {
      size,
      view,
      ink: readInk(canvas),
      nightMode,
      namedCap,
      sky,
      labels,
      bodies,
      highlighted,
      highlightedPoint: highlighted === null ? null : targetOf(highlighted)?.point ?? null,
    });
  }, [size, view, nightMode, themeTick, namedCap, sky, labels, bodies, highlighted, targetOf]);

  const drag = useRef<{ readonly x: number; readonly y: number } | null>(null);

  return (
    <div className="starmap">
      <div className="starmap__tools">
        <TextField
          className="starmap__search"
          label={copy.search.label}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button onClick={() => setView(fittedView(size))}>{copy.search.reset}</Button>
      </div>

      {query.trim() !== "" && (
        <div className="starmap__results">
          {matches.length === 0 ? (
            <p className="nx-hint">{copy.search.noResults}</p>
          ) : (
            matches.map((match) => {
              const target = targetOf(match);
              const kind = match.kind === "star" ? copy.search.star : copy.search.constellation;
              return (
                <Button
                  key={`${match.kind}:${match.label}`}
                  size="sm"
                  variant="quiet"
                  className="starmap__result"
                  onClick={() => {
                    setHighlighted(match);
                    if (target !== null) setView(centredOn(view, size, target.point));
                  }}
                >
                  {`${kind}: ${match.label}`}
                  {target !== null && !target.above ? ` - ${copy.search.belowHorizon}` : ""}
                </Button>
              );
            })
          )}
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={nightMode ? "starmap__canvas starmap__canvas--night" : "starmap__canvas"}
        // Focusable and named, because the arrows and the zoom keys are the
        // only way to move the map without a pointer.
        tabIndex={0}
        role="img"
        aria-label={copy.canvas.label}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (from === null) return;
          drag.current = { x: event.clientX, y: event.clientY };
          const dx = event.clientX - from.x;
          const dy = event.clientY - from.y;
          setView((current) => clampView(panBy(current, dx, dy), size));
        }}
        onKeyDown={(event) => {
          const centre = { x: size.width / 2, y: size.height / 2 };
          const step = 40;
          if (event.key === "ArrowLeft") setView((current) => clampView(panBy(current, step, 0), size));
          else if (event.key === "ArrowRight") setView((current) => clampView(panBy(current, -step, 0), size));
          else if (event.key === "ArrowUp") setView((current) => clampView(panBy(current, 0, step), size));
          else if (event.key === "ArrowDown") setView((current) => clampView(panBy(current, 0, -step), size));
          else if (event.key === "+" || event.key === "=") setView((current) => zoomAt(current, 1.3, size, centre));
          else if (event.key === "-" || event.key === "_") setView((current) => zoomAt(current, 1 / 1.3, size, centre));
          else return;
          event.preventDefault();
        }}
      />
      <p className="nx-hint">{copy.canvas.hint}</p>
    </div>
  );
}

// --- Drawing ------------------------------------------------------------------

interface PaintInput {
  readonly size: CanvasSize;
  readonly view: SkyView;
  readonly ink: Ink;
  readonly nightMode: boolean;
  readonly namedCap: number;
  readonly sky: readonly DrawnStar[];
  readonly labels: readonly DrawnLabel[];
  readonly bodies: readonly DrawnBody[];
  readonly highlighted: SkySearchMatch | null;
  readonly highlightedPoint: PlanePoint | null;
}

/**
 * One repaint. The order is the order things overlap in: field, horizon and
 * cardinal points, then the constellation names, then the stars, then the
 * bodies, then the labels and the search's ring, so nothing is drawn under
 * something that was already there.
 */
function paint(context: CanvasRenderingContext2D, input: PaintInput): void {
  const { size, view, ink, nightMode, namedCap, sky, labels, bodies } = input;
  const inkFor = (colour: string): string => (nightMode ? ink.danger : colour);
  context.clearRect(0, 0, size.width, size.height);
  context.fillStyle = nightMode ? ink.bg : ink.surface;
  context.fillRect(0, 0, size.width, size.height);
  context.font = ink.font;

  // The horizon, and the four points of the compass. East is drawn where the
  // view puts it: a chart held overhead has north up and east to the left.
  context.beginPath();
  context.arc(view.originX, view.originY, HORIZON_RADIUS * view.scale, 0, TAU);
  context.strokeStyle = inkFor(ink.faint);
  context.lineWidth = 1;
  context.stroke();
  const cardinals: readonly (readonly [string, PlanePoint])[] = [
    [copy.cardinal.north, { x: 0, y: HORIZON_RADIUS }],
    [copy.cardinal.east, { x: -HORIZON_RADIUS, y: 0 }],
    [copy.cardinal.south, { x: 0, y: -HORIZON_RADIUS }],
    [copy.cardinal.west, { x: HORIZON_RADIUS, y: 0 }],
  ];
  context.fillStyle = inkFor(ink.muted);
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const [label, planePoint] of cardinals) {
    const pixel = toPixel(view, planePoint);
    context.fillText(label, pixel.x, pixel.y);
  }

  context.textAlign = "start";
  context.fillStyle = inkFor(ink.accent);
  for (const label of labels) {
    const pixel = toPixel(view, label.point);
    if (!onCanvas(pixel, size)) continue;
    context.globalAlpha = label.above ? 0.9 : 0.35;
    context.fillText(label.label, pixel.x + 4, pixel.y);
  }
  context.globalAlpha = 1;

  // The stars: size by magnitude, colour by index, and culled to the canvas.
  for (const drawn of sky) {
    const pixel = toPixel(view, drawn.point);
    if (!onCanvas(pixel, size, 6)) continue;
    const { star } = drawn.placement;
    context.globalAlpha = drawn.placement.altitude > 0 ? 1 : 0.3;
    context.fillStyle = inkFor(tintColour(ink, tintFor(star.colourIndex)));
    context.beginPath();
    context.arc(pixel.x, pixel.y, starRadius(star.magnitude), 0, TAU);
    context.fill();
    if (star.name !== undefined && star.magnitude <= namedCap) {
      context.globalAlpha = 0.85;
      context.fillStyle = inkFor(ink.muted);
      context.fillText(star.name, pixel.x + starRadius(star.magnitude) + 3, pixel.y);
    }
  }
  context.globalAlpha = 1;

  // The Sun, the Moon and the caller's planets - filled discs with their names,
  // so a reader can tell which is which without a legend.
  for (const body of bodies) {
    const pixel = toPixel(view, body.point);
    if (!onCanvas(pixel, size, 12)) continue;
    context.globalAlpha = body.above ? 1 : 0.3;
    context.fillStyle = inkFor(body.id === "sun" ? ink.accent : body.id === "moon" ? ink.text : ink.data);
    context.beginPath();
    context.arc(pixel.x, pixel.y, body.radius, 0, TAU);
    context.fill();
    context.globalAlpha = 0.85;
    context.fillStyle = inkFor(ink.muted);
    context.fillText(copy.body[body.id], pixel.x + body.radius + 3, pixel.y);
  }
  context.globalAlpha = 1;

  // What the search found, if anything: a ring, which is a shape no star wears.
  if (input.highlightedPoint !== null && input.highlighted !== null) {
    const pixel = toPixel(view, input.highlightedPoint);
    if (onCanvas(pixel, size, 20)) {
      context.strokeStyle = inkFor(ink.accent);
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(pixel.x, pixel.y, 9, 0, TAU);
      context.stroke();
      context.fillStyle = inkFor(ink.text);
      context.fillText(input.highlighted.label, pixel.x + 12, pixel.y);
    }
  }
}

/** Whether a pixel is on the canvas, with a margin so a label that hangs off is still drawn. */
function onCanvas(
  pixel: { readonly x: number; readonly y: number },
  size: CanvasSize,
  margin = 0,
): boolean {
  return (
    pixel.x >= -margin &&
    pixel.y >= -margin &&
    pixel.x <= size.width + margin &&
    pixel.y <= size.height + margin
  );
}

