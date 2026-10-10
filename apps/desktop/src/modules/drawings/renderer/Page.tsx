import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button, Card, Checkbox, EmptyState, LoadingState, PageHeader } from "@nexus/ui";
import { themes } from "@nexus/tokens";
import { DxfViewer, type LayerInfo } from "dxf-viewer";
import { Color, Vector3 } from "three";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { numberFormat } from "../../../renderer/src/intl.js";
import { openExternalLink } from "../../../renderer/src/links.js";
import type {
  DrawingConversionFailure,
  DrawingRefusalCode,
  DrawingsOpenResult,
  DrawingToolView,
} from "../shared/ipc.js";
import { manifest } from "../shared/manifest.js";
import { copy } from "./copy.js";
import { textFontBytes } from "./font.js";
import { iconName } from "./icon.js";
import {
  angleDegrees,
  delta,
  distance,
  drawingPointAt,
  viewOf,
  windowView,
  type OrthoView,
  type Point,
} from "./measure.js";
import {
  isLayerVisible,
  layerColourCss,
  layerReducer,
  type LayerAction,
  type LayerState,
} from "./layers.js";
import { formatLength, insunitsOfHeader, unitOfInsunits, type DrawingUnit } from "./units.js";
import { bytesMessage, DRAWING_URL, FONT_URL } from "./workerProtocol.js";
import "./drawings.css";

/**
 * CRTEZI (ADR-090) - the drawing viewer: DXF read here, DWG through a pack.
 *
 * **Three bands, and the drawing gets the room.** The toolbar holds what changes
 * how the drawing is LOOKED AT (background, fit, zoom, measure); the stage below
 * it is the drawing, with the layers in a column beside it and the read-outs in
 * a strip under both. At 900x600 the layers column narrows first and the
 * toolbars wrap rather than scroll, because a viewer whose drawing is off the
 * screen is not showing anything.
 *
 * **The frame is there before the drawing is.** The stage is rendered from the
 * first paint and the empty state sits inside it, which is not decoration: the
 * viewer creates its canvas inside that element, so an element that appeared
 * only once a file had been chosen would be an element the loader could not
 * find.
 *
 * **The parsing is not on this thread.** `DxfViewer.Load` is handed a
 * `workerFactory`, so the file is parsed and turned into geometry inside a Web
 * Worker and this page only receives the result. That is also what makes the
 * time limit possible at all: synchronous parsing cannot be interrupted, but a
 * worker can be terminated and the page can stop waiting for it.
 *
 * **The drawing's own colours are not the app's.** A layer's colour is data the
 * user authored in another program, and the ground it sits on is the drawing
 * surface rather than our chrome: both are read from the token package's own
 * values (`layers.ts`, `GROUNDS` below) and neither is written here.
 *
 * **Nothing is stored.** The module keeps no preference and no recent-files
 * list, so this page's props are unused and its state begins and ends in memory.
 */

/**
 * How long a parse may take before the worker is terminated.
 *
 * A limit for the BOUNDED input this module accepts - at most 32 MiB of DXF,
 * measured on the way in - rather than a guess about a machine: the largest
 * drawings a person opens to look at parse in a second or two, and a run that
 * lasts half a minute is a pathological file or a broken one. When it fires the
 * honest answer is the timeout message: the worker is killed, so the loading
 * state cannot be left standing forever.
 */
const PARSE_TIMEOUT_MS = 30_000;

/**
 * How much of the file's own text is read looking for the HEADER's unit.
 *
 * A HEADER section holds variables, not geometry - the largest real ones are a
 * few kilobytes - so this is a bound on work done on the UI thread rather than
 * on what a drawing may contain. A file whose `$INSUNITS` sits past it reads as
 * unitless, which is the honest answer for a file this module could not find the
 * declaration in.
 */
const HEADER_SCAN_BYTES = 1024 * 1024;

/**
 * The two grounds a drawing can sit on, taken from the token package's own
 * values: Dan's paper surface for the light one, Noc's background for the dark
 * one. Read from `@nexus/tokens` rather than written here - the palette has one
 * home, and this file holds no colour of its own.
 */
const GROUNDS = { light: themes.dan.surface, dark: themes.noc.bg } as const;

/** Which of the two grounds is drawn behind the drawing. */
type Ground = keyof typeof GROUNDS;

/** A step of the open: read, parse, prepare. The copy table names each one. */
type Phase = keyof typeof copy.phases;

/** What went wrong, as something the copy table owns the sentence for. */
type Problem =
  | { readonly kind: "refusal"; readonly code: DrawingRefusalCode }
  | { readonly kind: "dwg" }
  /**
   * The pack ran and did not produce a drawing. The code, the converter's exit
   * code and the first line of its diagnostics are all the page shows — the
   * copy owns the sentence, the converter owns the words in it.
   */
  | { readonly kind: "conversion"; readonly failure: DrawingConversionFailure }
  | { readonly kind: "error"; readonly key: "openFailed" | "parseFailed" | "timedOut" };

/** What the last print left behind. */
type PrintNote =
  | { readonly kind: "saved"; readonly path: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed" };

/** Which pick the toolbar has armed, if any. */
type PickMode = "none" | "measure" | "zoom";

/**
 * What a failed conversion says, in the language being read.
 *
 * The copy table owns the sentence for each code, and the CONVERTER owns the two
 * facts appended to two of them: its exit code and the first line of its own
 * diagnostics (ADR-094 — a DWG decoder is C reading somebody else's file, and
 * „dwg2dxf exited with code 1: READ ERROR 0x1“ is what a person can act on). A
 * stack trace is what this must never be, which is why the wire carries those two
 * values rather than a message.
 *
 * The exit code and the line are appended only for the two codes whose failure
 * IS the converter's (`conversion-failed`, `conversion-stopped`): for the other
 * three the values are this application's own statement about itself, in its own
 * language for a log, and a page showing them would be quoting a maintainer at a
 * user.
 */
function conversionProblemText(failure: DrawingConversionFailure): string {
  const sentence = copy.dwgFailures[failure.code];
  const fromConverter =
    failure.code === "conversion-failed" || failure.code === "conversion-stopped";
  if (!fromConverter) return sentence;
  const exit = failure.exitCode === null ? "" : `${copy.dwg.exit} ${numberFormat().format(failure.exitCode)}`;
  const detail = [exit, failure.reason ?? ""].filter((part) => part !== "").join(": ");
  return detail === "" ? sentence : `${sentence} (${detail})`;
}

export default function DrawingsPage() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<DxfViewer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const originRef = useRef<Point>({ x: 0, y: 0 });
  const boundsRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  /** The phase last put on screen, so the per-chunk progress callback costs one render per CHANGE. */
  const shownPhase = useRef<Phase | null>(null);
  /** An open is in flight. A ref, because two clicks in one frame both read the state as it was. */
  const busyRef = useRef(false);

  const [phase, setPhase] = useState<Phase | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [printNote, setPrintNote] = useState<PrintNote | null>(null);
  const [layers, setLayers] = useState<readonly LayerInfo[]>([]);
  const [layerState, setLayerState] = useState<LayerState>({});
  const [unit, setUnit] = useState<DrawingUnit>("unitless");
  const [ground, setGround] = useState<Ground>("light");
  const [mode, setMode] = useState<PickMode>("none");
  const [picks, setPicks] = useState<readonly Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  /**
   * The pack that converted the drawing on screen, or `null` when this module
   * read the file itself. ADR-094 §5 requires the licence and the source wherever
   * the converter is named, and this line is what names it.
   */
  const [credit, setCredit] = useState<DrawingToolView | null>(null);

  const showPhase = useCallback((next: Phase | null): void => {
    if (shownPhase.current === next) return;
    shownPhase.current = next;
    setPhase(next);
  }, []);

  /**
   * Hands the bytes to a fresh worker and waits for the drawing, with a limit.
   *
   * The bytes are TRANSFERRED rather than copied, so the main thread does not
   * hold a second 32 MiB copy for the whole parse. The same route carries the
   * bundled font, which is why nothing in this flow has a URL a worker would
   * have to fetch.
   */
  const load = useCallback(
    async (fileName: string, bytes: Uint8Array): Promise<void> => {
      const stage = stageRef.current;
      if (stage === null) {
        setProblem({ kind: "error", key: "openFailed" });
        return;
      }

      showPhase("fetch");
      setPicks([]);
      setCursor(null);
      setMode("none");
      setPrintNote(null);

      const viewer =
        viewerRef.current ?? new DxfViewer(stage, { clearColor: new Color(GROUNDS[ground]) });
      viewerRef.current = viewer;

      // Read BEFORE the bytes are transferred, which detaches the buffer they
      // are a view of. The HEADER's `$INSUNITS` is the one thing this page takes
      // from the file itself, and it is taken here, where it costs a scan of a
      // few kilobytes rather than a copy of the parsed document.
      const declared = insunitsOfHeader(
        new TextDecoder("utf-8").decode(bytes.subarray(0, HEADER_SCAN_BYTES)),
      );

      workerRef.current?.terminate();
      const worker = new Worker(new URL("./parseWorker.ts", import.meta.url));
      workerRef.current = worker;

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const font = textFontBytes();
        worker.postMessage(bytesMessage(FONT_URL, font), [font.buffer]);
        worker.postMessage(bytesMessage(DRAWING_URL, bytes), [bytes.buffer]);

        // Both outcomes are VALUES rather than a throw and a timer callback: a
        // synchronous parse cannot be interrupted by the page, so the page stops
        // WAITING for it instead, and a load that fails after the limit has
        // passed must not become an unhandled rejection.
        const loading = viewer
          .Load({
            url: DRAWING_URL,
            fonts: [FONT_URL],
            // "font" is the library's phase for warming a font up; from this
            // page's side it is the same wait as preparing the scene.
            progressCbk: (progressPhase) =>
              showPhase(progressPhase === "font" ? "prepare" : progressPhase),
            workerFactory: () => worker,
          })
          .then(
            () => "loaded" as const,
            () => "failed" as const,
          );
        const timeout = new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), PARSE_TIMEOUT_MS);
        });
        const outcome = await Promise.race([loading, timeout]);

        if (outcome === "timeout") {
          // The worker is killed rather than abandoned: it is the only way to
          // stop parsing that never finishes, and a thread nobody can reach is
          // worse than a drawing that did not open.
          worker.terminate();
          workerRef.current = null;
          showPhase(null);
          // The library cleared the previous drawing before it started this
          // one, so the page must stop claiming a file is open: the canvas is
          // empty either way, and a name with nothing under it is worse.
          setName(null);
          setProblem({ kind: "error", key: "timedOut" });
          return;
        }
        if (outcome === "failed") {
          throw new Error("the drawing could not be parsed");
        }

        setUnit(unitOfInsunits(declared));
        // `nonEmptyOnly`: the panel lists the layers the drawing actually DRAWS
        // with. A CAD file routinely declares dozens its geometry never mentions,
        // and a row for one of those would be a checkbox that changes nothing on
        // screen - the one thing a visibility toggle must never be.
        setLayers([...viewer.GetLayers(true)]);
        setLayerState({});

        const origin = viewer.GetOrigin();
        originRef.current = { x: origin.x, y: origin.y };
        boundsRef.current = viewer.GetBounds();
        viewer.SetClearColor(GROUNDS[ground]);

        setName(fileName);
        showPhase(null);
      } catch (failure) {
        console.error("Nexus: the drawing could not be parsed:", failure);
        showPhase(null);
        setName(null);
        setProblem({ kind: "error", key: "parseFailed" });
      } finally {
        clearTimeout(timer);
      }
    },
    [ground, showPhase],
  );

  const open = useCallback(async (): Promise<void> => {
    // A ref rather than `phase` in the guard: two clicks in one frame both read
    // the state as it was, and the second open would terminate the first
    // worker's parse and leave that call waiting for an answer that can no
    // longer come.
    if (busyRef.current) return;
    busyRef.current = true;
    setProblem(null);
    setPrintNote(null);
    setCredit(null);
    try {
      let result: DrawingsOpenResult;
      try {
        result = await window.nexus.modules.drawings.open({});
      } catch (failure) {
        console.error("Nexus: the drawing file could not be opened:", failure);
        setProblem({ kind: "error", key: "openFailed" });
        return;
      }
      if (result.outcome === "cancelled") return;
      if (result.outcome === "needs-pack") {
        setProblem({ kind: "dwg" });
        return;
      }
      if (result.outcome === "conversion-failed") {
        setProblem({ kind: "conversion", failure: result.failure });
        return;
      }
      if (result.outcome === "refused") {
        setProblem({ kind: "refusal", code: result.code });
        return;
      }
      setCredit(result.tool);
      await load(result.name, result.bytes);
    } finally {
      busyRef.current = false;
    }
  }, [load]);

  /** The current camera, as the five numbers the coordinate arithmetic needs. */
  const currentView = useCallback((): OrthoView | null => {
    const viewer = viewerRef.current;
    if (viewer === null || !viewer.HasRenderer()) return null;
    return viewOf(viewer.GetCamera());
  }, []);

  /** Where the pointer is, in the drawing's coordinates. `null` when there is no canvas to measure against. */
  const pointAt = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): Point | null => {
      const canvas = viewerRef.current?.GetCanvas();
      const view = currentView();
      if (canvas === undefined || view === null) return null;
      const box = canvas.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return null;
      return drawingPointAt(
        { x: event.clientX - box.left, y: event.clientY - box.top },
        { width: box.width, height: box.height },
        view,
        originRef.current,
      );
    },
    [currentView],
  );

  /**
   * The second corner of a zoom. A pick is only a corner; closing the view on it
   * would be a zoom nobody asked for, so this waits for the pair.
   *
   * An effect rather than a step inside the click handler, because the handler's
   * only job is to append a point and this needs the two of them together - and
   * because a side effect inside a state updater runs twice under React's
   * development double-invoke.
   */
  useEffect(() => {
    if (mode !== "zoom" || picks.length < 2) return;
    const [first, second] = picks;
    const viewer = viewerRef.current;
    const canvas = viewer?.GetCanvas();
    if (first === undefined || second === undefined || viewer === null || canvas === undefined) {
      return;
    }
    const aspect = canvas.clientWidth / canvas.clientHeight;
    if (!(aspect > 0)) return;
    const { center, width } = windowView(
      {
        minX: Math.min(first.x, second.x),
        maxX: Math.max(first.x, second.x),
        minY: Math.min(first.y, second.y),
        maxY: Math.max(first.y, second.y),
      },
      aspect,
    );
    // `SetView` takes scene coordinates, which are the drawing's own minus the
    // origin the library subtracted when it built the scene.
    viewer.SetView(
      new Vector3(center.x - originRef.current.x, center.y - originRef.current.y, 0),
      width,
    );
    setMode("none");
    setPicks([]);
  }, [mode, picks]);

  const fit = useCallback((): void => {
    const viewer = viewerRef.current;
    const bounds = boundsRef.current;
    if (viewer === null || bounds === null) return;
    // `FitView` takes scene coordinates and `GetBounds` answers the drawing's
    // own, so the origin is taken back out here - exactly what the library's own
    // post-load fit does.
    viewer.FitView(
      bounds.minX - originRef.current.x,
      bounds.maxX - originRef.current.x,
      bounds.minY - originRef.current.y,
      bounds.maxY - originRef.current.y,
    );
  }, []);

  const applyLayers = useCallback(
    (action: LayerAction): void => {
      const next = layerReducer(layerState, action);
      setLayerState(next);
      const viewer = viewerRef.current;
      if (viewer === null) return;
      for (const layer of layers) viewer.ShowLayer(layer.name, isLayerVisible(next, layer.name));
    },
    [layerState, layers],
  );

  const print = useCallback(async (): Promise<void> => {
    setPrintNote(null);
    // The class switches the page to its print layout (`drawings.css`). It is on
    // the body rather than on this page's root because what has to move out of
    // the way includes the shell's own rail, which this module does not own.
    document.body.classList.add("nx-drawings-print");
    try {
      const result = await window.nexus.modules.drawings.print({});
      if (result.outcome === "saved") setPrintNote({ kind: "saved", path: result.path });
      else if (result.outcome === "cancelled") setPrintNote({ kind: "cancelled" });
      else setPrintNote({ kind: "failed" });
    } catch (failure) {
      console.error("Nexus: the drawing could not be printed:", failure);
      setPrintNote({ kind: "failed" });
    } finally {
      document.body.classList.remove("nx-drawings-print");
    }
  }, []);

  /**
   * Escape gives up whatever a click armed and drops the measurement with it -
   * the one key every surface in this app obeys, and the only way out of a pick
   * that does not mean finding the right button again.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setMode("none");
      setPicks([]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    viewerRef.current?.SetClearColor(GROUNDS[ground]);
  }, [ground]);

  // The worker and the viewer must not outlive the page: a chunk that is gone
  // leaving a worker parsing would be a thread nobody can stop or reach.
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      viewerRef.current?.Destroy();
      viewerRef.current = null;
    },
    [],
  );

  const format = (value: number): string =>
    numberFormat({ maximumFractionDigits: 3 }).format(value);
  const unitLabel = copy.units[unit];
  const length = (value: number): string => formatLength(value, unit, unitLabel, format);
  const pointLabel = (point: Point): string => `${length(point.x)}, ${length(point.y)}`;

  const [first, second] = picks;
  const measured =
    first !== undefined && second !== undefined
      ? { from: first, to: second, dx: delta(first, second).x, dy: delta(first, second).y }
      : null;
  const hasDrawing = name !== null;

  const problemText =
    problem === null
      ? null
      : problem.kind === "dwg"
        ? `${copy.dwg.body} ${copy.dwg.catalogue}`
        : problem.kind === "conversion"
          ? conversionProblemText(problem.failure)
          : problem.kind === "refusal"
            ? copy.refusals[problem.code]
            : copy.errors[problem.key];

  return (
    <div className="drawings">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil={iconName}
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void open()}
              disabled={phase !== null}
            >
              {copy.open.button}
            </Button>
            <Button size="sm" onClick={() => void print()} disabled={!hasDrawing}>
              {copy.print.button}
            </Button>
          </>
        }
      />

      {problemText !== null && (
        <p className="drawings__problem" role="alert">
          {problemText}
        </p>
      )}
      {credit !== null && (
        <p className="nx-hint">
          {copy.dwg.converted} {declaredText(credit.title)} {credit.version} ·{" "}
          {credit.licence.spdx} · {credit.licence.attribution} ·{" "}
          <button
            type="button"
            className="drawings__link"
            onClick={() => openExternalLink(credit.source.url)}
          >
            {copy.dwg.source}
          </button>
        </p>
      )}
      {printNote !== null && (
        <p className="nx-hint" role="status">
          {printNote.kind === "saved"
            ? `${copy.print.saved} ${printNote.path}`
            : printNote.kind === "cancelled"
              ? copy.print.cancelled
              : copy.print.failed}
        </p>
      )}

      <div className="drawings__toolbar">
        {hasDrawing && (
          <span className="nx-hint drawings__file">
            {copy.viewer.file}: {name}
          </span>
        )}
        <span className="drawings__group" role="group" aria-label={copy.viewer.background}>
          <Button
            size="sm"
            aria-pressed={ground === "light"}
            onClick={() => setGround("light")}
          >
            {copy.viewer.light}
          </Button>
          <Button size="sm" aria-pressed={ground === "dark"} onClick={() => setGround("dark")}>
            {copy.viewer.dark}
          </Button>
        </span>
        <Button size="sm" onClick={fit} disabled={!hasDrawing}>
          {copy.viewer.fit}
        </Button>
        <Button
          size="sm"
          aria-pressed={mode === "zoom"}
          disabled={!hasDrawing}
          onClick={() => {
            setPicks([]);
            setMode((current) => (current === "zoom" ? "none" : "zoom"));
          }}
        >
          {copy.viewer.zoomWindow}
        </Button>
        <Button
          size="sm"
          aria-pressed={mode === "measure"}
          disabled={!hasDrawing}
          onClick={() => {
            setPicks([]);
            setMode((current) => (current === "measure" ? "none" : "measure"));
          }}
        >
          {copy.measure.start}
        </Button>
        {mode !== "none" && (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setMode("none");
              setPicks([]);
            }}
          >
            {copy.viewer.cancelPick}
          </Button>
        )}
      </div>

      <div className={hasDrawing ? "drawings__body" : "drawings__body drawings__body--framed"}>
        <div
          className={mode === "none" ? "drawings__stage" : "drawings__stage drawings__stage--picking"}
          ref={stageRef}
          onPointerDown={(event) => {
            if (mode === "none") return;
            const point = pointAt(event);
            if (point === null) return;
            // Two points make a measurement; a third begins another one.
            setPicks((current) => (current.length >= 2 ? [point] : [...current, point]));
          }}
          onPointerMove={(event) => {
            const point = pointAt(event);
            if (point !== null) setCursor(point);
          }}
          onPointerLeave={() => setCursor(null)}
        >
          {name === null && phase === null && (
            <div className="drawings__placeholder">
              <EmptyState
                title={copy.empty.title}
                description={copy.empty.body}
                sigil={iconName}
                action={
                  <Button variant="primary" onClick={() => void open()} disabled={phase !== null}>
                    {copy.open.button}
                  </Button>
                }
              />
            </div>
          )}
          {phase !== null && (
            <div className="drawings__overlay">
              <LoadingState label={copy.phases[phase]} rows={4} />
            </div>
          )}
        </div>

        {hasDrawing && (
          <Card className="drawings__layers" title={copy.layers.title}>
            {layers.length === 0 ? (
              <EmptyState variant="inline" title={copy.layers.empty} />
            ) : (
              <>
                <div className="drawings__group">
                  <Button size="sm" onClick={() => applyLayers({ type: "showAll" })}>
                    {copy.layers.showAll}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      applyLayers({ type: "hideAll", names: layers.map((layer) => layer.name) })
                    }
                  >
                    {copy.layers.hideAll}
                  </Button>
                </div>
                <ul className="drawings__layer-list">
                  {layers.map((layer) => (
                    <li key={layer.name}>
                      <Checkbox
                        checked={isLayerVisible(layerState, layer.name)}
                        onChange={() => applyLayers({ type: "toggle", name: layer.name })}
                      >
                        <span
                          className="drawings__swatch"
                          style={{ background: layerColourCss(layer.color) }}
                          aria-hidden="true"
                        />
                        <span className="drawings__layer-name">{layer.displayName}</span>
                      </Checkbox>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        )}
      </div>

      {hasDrawing && (
        <Card className="drawings__readout" title={copy.measure.title}>
          {mode === "zoom" ? (
            <p className="nx-hint">{picks.length === 0 ? copy.zoom.first : copy.zoom.second}</p>
          ) : measured === null ? (
            <p className="nx-hint">{copy.measure.hint}</p>
          ) : (
            <>
              <dl className="drawings__pairs">
                <div className="drawings__pair">
                  <dt>{copy.measure.distance}</dt>
                  <dd>{length(distance(measured.from, measured.to))}</dd>
                </div>
                <div className="drawings__pair">
                  <dt>{copy.measure.angle}</dt>
                  <dd>{`${format(angleDegrees(measured.from, measured.to))}°`}</dd>
                </div>
                <div className="drawings__pair">
                  <dt>{copy.measure.dx}</dt>
                  <dd>{length(measured.dx)}</dd>
                </div>
                <div className="drawings__pair">
                  <dt>{copy.measure.dy}</dt>
                  <dd>{length(measured.dy)}</dd>
                </div>
                <div className="drawings__pair">
                  <dt>{copy.measure.first}</dt>
                  <dd>{pointLabel(measured.from)}</dd>
                </div>
                <div className="drawings__pair">
                  <dt>{copy.measure.second}</dt>
                  <dd>{pointLabel(measured.to)}</dd>
                </div>
              </dl>
              <div className="drawings__group">
                <Button size="sm" variant="quiet" onClick={() => setPicks([])}>
                  {copy.measure.clear}
                </Button>
              </div>
            </>
          )}
          {unit === "unitless" && <p className="nx-hint">{copy.measure.unitless}</p>}
          {cursor !== null && (
            <p className="nx-hint drawings__cursor">
              {copy.viewer.cursor}: {pointLabel(cursor)}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
