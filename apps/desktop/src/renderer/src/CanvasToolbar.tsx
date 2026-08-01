import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import type { ReactNode, RefObject } from "react";
import { Button } from "@nexus/ui";
import {
  CANVAS_INK_ID,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_STROKE_WIDTHS,
  CANVAS_SWATCHES,
  CANVAS_TOOLS,
  CANVAS_TRANSPARENT,
  CANVAS_ZOOM_STEP,
  activeStrokeWidth,
  canvasStyleTargets,
  canvasSwatchToken,
  formatZoomPercent,
  sameCanvasColour,
  zoomAboutViewportCentre,
  type CanvasSwatchId,
  type CanvasToolId,
  type CanvasToolbarState,
} from "./canvasTools.js";
import { strings } from "./strings.js";

/**
 * „Tabla"'s toolbar (CANV slice b1) — our chrome over Excalidraw's engine.
 *
 * **Why this file exists at all.** Excalidraw ships 54 locales and none is
 * Serbian; the loader is a closed import map inside the bundle and
 * `setLanguage` is not re-exported, so the language cannot be added. Its own
 * colour picker also offers violet, blue and orange — three hues this project
 * bans. An English, banned-hue toolbar inside an otherwise entirely Serbian
 * product is exactly the seam the design rules exist to prevent, so the editor
 * keeps the canvas and gives up the interface: `app.css` hides its chrome and
 * this bar drives it through `ExcalidrawImperativeAPI`.
 *
 * **Every call here is one the installed package's own type declarations
 * name.** `setActiveTool`, `updateScene`, `scrollToContent`, `getAppState` and
 * `getSceneElementsIncludingDeleted` are the whole surface used, and where the
 * API has no route to something a person might expect, the control is ABSENT
 * rather than dead — see `canvasTools.ts` for what is left out and why.
 *
 * **The editor is the source of truth about what is active, never this bar.**
 * `CanvasPage` feeds it a snapshot taken from `onChange`, so pressing `R` on
 * the keyboard moves our highlight exactly as clicking „Pravougaonik" does.
 * Nothing here is remembered locally.
 *
 * **Selection first, default second.** A colour or a width sets the
 * `currentItem*` default for the NEXT shape AND repaints what is selected right
 * now, which is what Excalidraw's own actions do — a control that only did the
 * first would look dead to anybody who selected a rectangle and clicked gold.
 * `canvasStyleTargets` decides who is affected; this file only applies it.
 *
 * **Active is typographic.** Accent text and weight on a tool, a ring on a
 * swatch. No inset bar, no pill, no glow — `app.css` says which rule each
 * piece follows.
 */

export interface CanvasToolbarProps {
  /**
   * The live editor. A ref rather than a value, because the toolbar only ever
   * touches it inside a handler — never during render, where the instance may
   * not exist yet on the first pass after a board switch.
   */
  editor: RefObject<ExcalidrawImperativeAPI | null>;
  /** What to draw as active, kept in step with the editor by `CanvasPage`. */
  state: CanvasToolbarState;
  /**
   * „Mermaid dijagram". The action stays with `CanvasPage` because it is one
   * half of a decision whose other half is `onPaste` — the page header tells
   * that story — and this bar only draws the button.
   */
  onMermaid: () => void;
}

/**
 * A style change, as a discriminated union rather than a key and a value.
 *
 * `updateScene` types its `appState` as `Pick<AppState, K>` with `K` inferred
 * from the object literal, so the key genuinely cannot be computed — the three
 * calls below are written out for that reason and not for want of a loop.
 */
type CanvasStyleChange =
  | { readonly channel: "stroke"; readonly value: string }
  | { readonly channel: "background"; readonly value: string }
  | { readonly channel: "strokeWidth"; readonly value: number };

export function CanvasToolbar({ editor, state, onMermaid }: CanvasToolbarProps) {
  const s = strings.canvas.toolbar;
  const colourNames = strings.settings.appearance.accentNames;

  /**
   * The live computed style, read once — `elementDefaults()`'s shape, and for
   * its reason: what goes into an element is a colour STRING, and writing one
   * as a literal here would be a raw hex in this app's own source. The object
   * `getComputedStyle` returns is LIVE, so the handlers below read through it
   * too and a swatch always resolves under whichever theme is on right now.
   */
  const styles = getComputedStyle(document.documentElement);
  const swatchColour = (id: CanvasSwatchId): string =>
    styles.getPropertyValue(canvasSwatchToken(id)).trim();

  /** A swatch's Serbian name — „Mastilo", then the eight „Izgled" already names. */
  const swatchName = (id: CanvasSwatchId): string =>
    id === CANVAS_INK_ID ? s.inkName : (colourNames[id] ?? id);

  function selectTool(id: CanvasToolId): void {
    editor.current?.setActiveTool({ type: id });
  }

  /**
   * Writes a style change to the selection and to the default in one call.
   *
   * The scene is read INCLUDING deleted elements, because `updateScene`
   * replaces the element list outright — handing back only the live ones would
   * drop the tombstones an undo of a delete stands on.
   *
   * `IMMEDIATELY` is Excalidraw's own choice for these three actions: picking a
   * colour is an edit somebody expects Ctrl+Z to take back. With nothing
   * selected the mapped array is element-for-element identical, so the
   * increment it captures is empty and no history entry appears.
   */
  function restyle(change: CanvasStyleChange): void {
    const api = editor.current;
    if (api === null) return;
    const scene = api.getSceneElementsIncludingDeleted();
    const targets = canvasStyleTargets(scene, api.getAppState().selectedElementIds, change.channel);
    const elements = scene.map((element) =>
      targets.has(element.id) ? newElementWith(element, elementPatch(change)) : element,
    );
    const captureUpdate = CaptureUpdateAction.IMMEDIATELY;
    switch (change.channel) {
      case "stroke":
        api.updateScene({ elements, appState: { currentItemStrokeColor: change.value }, captureUpdate });
        return;
      case "background":
        api.updateScene({ elements, appState: { currentItemBackgroundColor: change.value }, captureUpdate });
        return;
      case "strokeWidth":
        api.updateScene({ elements, appState: { currentItemStrokeWidth: change.value }, captureUpdate });
        return;
    }
  }

  /**
   * A zoom step, anchored on the middle of the canvas.
   *
   * `zoomCanvas` is a method on the editor's own App class and is NOT part of
   * `ExcalidrawImperativeAPI`, so the public route is `updateScene` with the
   * three viewport fields — and all three are needed, or the drawing slides out
   * from under the pointer (`zoomAboutViewportCentre`).
   */
  function zoomTo(next: number): void {
    const api = editor.current;
    if (api === null) return;
    const { zoom, scrollX, scrollY, width, height } = api.getAppState();
    const view = zoomAboutViewportCentre({ zoom: zoom.value, scrollX, scrollY, width, height }, next);
    api.updateScene({
      appState: {
        // `NormalizedZoomValue` is a BRANDED number, and the only function that
        // mints one — `getNormalizedZoom` — is not exported. The brand exists to
        // say „this was rounded and clamped", which `normalizeCanvasZoom` has
        // just done with the editor's own constants, so this is the assertion
        // the brand is asking for rather than a way around it.
        zoom: { value: view.zoom as NormalizedZoomValue },
        scrollX: view.scrollX,
        scrollY: view.scrollY,
      },
    });
  }

  /** „Uklopi": the editor's own fit, which is on the imperative API and needs no arithmetic of ours. */
  function zoomToFit(): void {
    editor.current?.scrollToContent(undefined, { fitToContent: true });
  }

  const swatchRow = (
    channel: "stroke" | "background",
    current: string,
    label: string,
  ): ReactNode => (
    <div className="canv__tool-group" role="group" aria-label={label}>
      <span className="canv__label">{label}</span>
      {channel === "background" && (
        <button
          type="button"
          className={swatchClass(sameCanvasColour(current, CANVAS_TRANSPARENT))}
          aria-label={s.fillNone}
          title={s.fillNone}
          aria-pressed={sameCanvasColour(current, CANVAS_TRANSPARENT)}
          onMouseDown={keepEditorFocus}
          onClick={() => restyle({ channel, value: CANVAS_TRANSPARENT })}
        >
          ×
        </button>
      )}
      {CANVAS_SWATCHES.map((id) => {
        const name = swatchName(id);
        // Compared against the LIVE token rather than a remembered id: the
        // colour on the element is a string, and the same string is what a
        // pasted element or the editor's own eyedropper would carry.
        const selected = sameCanvasColour(current, swatchColour(id));
        return (
          <button
            key={id}
            type="button"
            className={swatchClass(selected)}
            style={{ background: `var(${canvasSwatchToken(id)})` }}
            aria-label={name}
            title={name}
            aria-pressed={selected}
            onMouseDown={keepEditorFocus}
            onClick={() => restyle({ channel, value: swatchColour(id) })}
          />
        );
      })}
    </div>
  );

  return (
    <div className="canv__toolbar" role="group" aria-label={s.label}>
      <div className="canv__tool-group" role="group" aria-label={s.toolLabel}>
        <span className="canv__label">{s.toolLabel}</span>
        {CANVAS_TOOLS.map((tool) => {
          const active = state.tool === tool.id;
          return (
            <Button
              key={tool.id}
              size="sm"
              className={active ? "canv__tool canv__tool--active" : "canv__tool"}
              aria-pressed={active}
              title={`${s.tool[tool.id]} · ${s.shortcut} ${tool.shortcut}`}
              onMouseDown={keepEditorFocus}
              onClick={() => selectTool(tool.id)}
            >
              {s.tool[tool.id]}
            </Button>
          );
        })}
      </div>

      {swatchRow("stroke", state.stroke, s.strokeLabel)}
      {swatchRow("background", state.background, s.fillLabel)}

      <div className="canv__tool-group" role="group" aria-label={s.widthLabel}>
        <span className="canv__label">{s.widthLabel}</span>
        {CANVAS_STROKE_WIDTHS.map((width) => {
          const active = activeStrokeWidth(state.strokeWidth) === width.id;
          return (
            <Button
              key={width.id}
              size="sm"
              className={active ? "canv__tool canv__tool--active" : "canv__tool"}
              aria-pressed={active}
              onMouseDown={keepEditorFocus}
              onClick={() => restyle({ channel: "strokeWidth", value: width.value })}
            >
              {s.width[width.id]}
            </Button>
          );
        })}
      </div>

      {/* A drawing action, so it sits with the drawing controls rather than
          with the view ones — the zoom cluster below is the bar's right end. */}
      <Button
        size="sm"
        className="canv__tool"
        title={strings.canvas.mermaidTitle}
        onMouseDown={keepEditorFocus}
        onClick={onMermaid}
      >
        {strings.canvas.mermaid}
      </Button>

      <div className="canv__tool-group canv__tool-group--end" role="group" aria-label={s.zoomLabel}>
        <Button
          size="sm"
          className="canv__tool"
          title={s.zoomOut}
          aria-label={s.zoomOut}
          disabled={state.zoom <= CANVAS_MIN_ZOOM}
          onMouseDown={keepEditorFocus}
          onClick={() => zoomTo(state.zoom - CANVAS_ZOOM_STEP)}
        >
          −
        </Button>
        {/* The readout IS the reset, exactly as the editor's own zoom island
            has it: the percentage is the button that puts it back to 100%. */}
        <Button
          size="sm"
          className="canv__tool canv__zoom"
          title={s.zoomReset}
          aria-label={s.zoomReset}
          onMouseDown={keepEditorFocus}
          onClick={() => zoomTo(1)}
        >
          {formatZoomPercent(state.zoom)}
        </Button>
        <Button
          size="sm"
          className="canv__tool"
          title={s.zoomIn}
          aria-label={s.zoomIn}
          disabled={state.zoom >= CANVAS_MAX_ZOOM}
          onMouseDown={keepEditorFocus}
          onClick={() => zoomTo(state.zoom + CANVAS_ZOOM_STEP)}
        >
          +
        </Button>
        <Button
          size="sm"
          className="canv__tool"
          title={s.zoomFitTitle}
          onMouseDown={keepEditorFocus}
          onClick={zoomToFit}
        >
          {s.zoomFit}
        </Button>
      </div>
    </div>
  );
}

/**
 * Keeps the click from moving focus off the canvas — `noteFindBar`'s idiom,
 * for the same reason.
 *
 * Excalidraw binds its keyboard handling to its OWN container, so a toolbar
 * button that took focus would silently switch every shortcut off until the
 * user clicked the drawing again. Suppressing the mouse default leaves focus
 * where it was while `click` still fires; keyboard activation is untouched, so
 * Tab still reaches every control and Enter still works.
 */
function keepEditorFocus(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

function swatchClass(selected: boolean): string {
  return selected ? "canv__swatch canv__swatch--selected" : "canv__swatch";
}

/** The element fields a change writes — the counterpart of the `currentItem*` default beside it. */
function elementPatch(
  change: CanvasStyleChange,
): { strokeColor: string } | { backgroundColor: string } | { strokeWidth: number } {
  switch (change.channel) {
    case "stroke":
      return { strokeColor: change.value };
    case "background":
      return { backgroundColor: change.value };
    case "strokeWidth":
      return { strokeWidth: change.value };
  }
}
