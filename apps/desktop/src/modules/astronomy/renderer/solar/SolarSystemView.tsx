import { useCallback, useEffect, useRef } from "react";
import type { BodyId, OrbitPath, SolarSystemSnapshot, Vector3 } from "@nexus/core";
import { Button } from "@nexus/ui";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { activeLocale } from "../../../../renderer/src/strings.js";
import { copy } from "../copy.js";
import { bodyLabel } from "./bodies.js";
import { FLIGHT_MS, flyToPath, followPose, poseFor, type CameraPose } from "./camera.js";
import { placeLabels, type LabelAnchor } from "./labels.js";
import { MIN_PICK_RADIUS_PX, pickAnchor, type PickAnchor } from "./pick.js";
import { solarPalette } from "./palette.js";
import { SceneResources } from "./resources.js";
import { type SolarScale } from "./scale.js";
import {
  applyPalette,
  applySelection,
  applySnapshot,
  buildSolarScene,
  dropSkyTexture,
  dropTexture,
  sceneFitRadius,
  type BuiltSolarScene,
} from "./scene.js";
import { loadPlanetTextures, type PlanetTextures, type TexturePort } from "./textures.js";
import "./solar.css";

/**
 * The 3D solar system: one canvas, one camera, one draw per moving frame.
 *
 * **What this file owns, and what it does not.** Everything that can be decided
 * without a GL context lives beside it — the two scale maps (`scale.ts`), the
 * fit and the flight path (`camera.ts`), the label placement (`labels.ts`) and
 * the graph itself (`scene.ts`) — because this repository's tests have no DOM.
 * What is left here is the part that genuinely needs a browser: the renderer,
 * `OrbitControls`, projecting bodies into pixels, and disposing all of it on
 * unmount.
 *
 * **Drawing only while something moves.** There is no frame loop. A change — a
 * drag, a wheel, a flight, a resize, a new snapshot, an image that finished
 * decoding — calls `requestRender`, which schedules exactly one frame. That
 * frame draws only while the canvas is on screen and the window is visible, so
 * the three views a user is not looking at cost nothing while the shared clock
 * advances behind them; and it schedules the next one only for a flight that is
 * still running. An idle solar system costs nothing, which matters because this
 * page may be left open for hours beside a running clock.
 *
 * **The props are read through one ref.** The mount effect runs once and never
 * re-runs; the newest of every prop lives in `liveRef` for the callbacks that
 * fire outside React's render (a pointer event, a texture's own load callback, a
 * frame of a flight). `orbits` and `textures` are compared by IDENTITY by the
 * rebuild effect, so the page hands in stable values (`useMemo`): a fresh array
 * on every render would rebuild the graph on every render.
 */

export interface SolarSystemViewProps {
  /** The engine's positions for one instant. A new snapshot moves the bodies; it does not rebuild the graph. */
  readonly snapshot: SolarSystemSnapshot;
  /** One sampled path per body. Rebuilds the orbit lines when the array's identity changes. */
  readonly orbits: readonly OrbitPath[];
  readonly selected: BodyId | null;
  readonly onSelect: (id: BodyId | null) => void;
  readonly scale: SolarScale;
  /** The pack's layout, or `null` for the textureless view. */
  readonly textures: PlanetTextures | null;
}

type BuiltSolarBody = BuiltSolarScene["bodies"][number];

/** Vertical field of view. 45° is the usual compromise between depth and distortion. */
const FIELD_OF_VIEW_DEG = 45;
/** The whole system is framed to this share of the half-height, so nothing touches an edge. */
const WHOLE_SYSTEM_FILL = 0.8;
/** A selected body fills this share of the half-height: large, with its neighbours still in view. */
const SELECTED_FILL = 0.5;
/** Where the camera opens: above the ecliptic and a little to one side. */
const OPENING_VIEW_DIRECTION: Vector3 = [0.35, 0.62, 0.7];
/** A pointer that moved further than this between press and release was an orbit, not a click. */
const DRAG_SLOP_PX = 4;
/** A body's name leaves the screen with the body once its centre is this far outside it. */
const LABEL_OFFSCREEN_PX = 48;
/** The near and far planes of a scene that spans a 0.04-unit planet and a 300 000-unit orbit. */
const CAMERA_NEAR_UNITS = 0.01;
const CAMERA_FAR_UNITS = 1_000_000;

interface RebuildInput {
  readonly orbits: readonly OrbitPath[];
  readonly scale: SolarScale;
  readonly textures: PlanetTextures | null;
}

interface ViewState {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly textureLoader: THREE.TextureLoader;
  readonly viewport: HTMLDivElement;
  readonly labelLayer: HTMLDivElement;
  readonly labels: Map<BodyId, HTMLButtonElement>;
  /** The graph in use, or `null` in the statements between the renderer's creation and the first build. */
  built: BuiltSolarScene | null;
  /** Counts builds, so a texture callback from a replaced graph cannot touch the one on screen. */
  generation: number;
  /** The identity of the props the current graph was built from. */
  orbits: readonly OrbitPath[];
  texturesSource: PlanetTextures | null;
  flight: { readonly from: CameraPose; readonly to: CameraPose; readonly startedAt: number } | null;
  /** The body the camera keeps in view while time runs, with where it was when the camera last moved with it. */
  followed: { readonly id: BodyId; readonly at: Vector3 } | null;
  dragOrigin: { readonly x: number; readonly y: number } | null;
  frame: number;
  requestRender: () => void;
}

/** The theme the document is actually showing, written on `<html>` by the shell. */
function currentTheme(): "dan" | "noc" {
  return document.documentElement.getAttribute("data-theme") === "dan" ? "dan" : "noc";
}

function setPose(state: ViewState, pose: CameraPose): void {
  state.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
  state.controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
  state.controls.update();
}

function currentPose(state: ViewState): CameraPose {
  const position = state.camera.position;
  const target = state.controls.target;
  return {
    position: [position.x, position.y, position.z],
    target: [target.x, target.y, target.z],
  };
}

/** The whole system framed from the direction the view opens in. */
function wholeSystemPose(built: BuiltSolarScene): CameraPose {
  return poseFor(
    [0, 0, 0],
    sceneFitRadius(built) || 1,
    FIELD_OF_VIEW_DEG,
    WHOLE_SYSTEM_FILL,
    OPENING_VIEW_DIRECTION,
  );
}

/** Flies from wherever the camera stands to `to`, replacing any flight already running. */
function flyTo(state: ViewState, to: CameraPose): void {
  state.flight = { from: currentPose(state), to, startedAt: window.performance.now() };
  state.requestRender();
}

/** The direction the camera stands off in, so a flight moves it without turning the sky over. */
function viewDirectionOf(state: ViewState): Vector3 {
  const direction = new THREE.Vector3().subVectors(state.camera.position, state.controls.target);
  if (direction.lengthSq() === 0) return [0, 0, 1];
  direction.normalize();
  return [direction.x, direction.y, direction.z];
}

function handleFor(state: ViewState, id: BodyId): BuiltSolarBody | undefined {
  return state.built?.bodies.find((handle) => handle.id === id);
}

/** One label button per body, created once and reused across rebuilds. */
function syncLabels(state: ViewState, built: BuiltSolarScene, select: (id: BodyId) => void): void {
  const wanted = new Set(built.bodies.map((handle) => handle.id));
  for (const [id, element] of state.labels) {
    if (wanted.has(id)) continue;
    element.remove();
    state.labels.delete(id);
  }
  for (const handle of built.bodies) {
    if (state.labels.has(handle.id)) continue;
    const element = document.createElement("button");
    element.type = "button";
    element.className = "solar__label";
    element.addEventListener("click", (event) => {
      // The viewport's own pointer handler must not also raycast this click
      // through the label and select whatever body happens to be behind it.
      event.stopPropagation();
      select(handle.id);
    });
    state.labelLayer.append(element);
    state.labels.set(handle.id, element);
  }
}

export function SolarSystemView({
  snapshot,
  orbits,
  selected,
  onSelect,
  scale,
  textures,
}: SolarSystemViewProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<ViewState | null>(null);
  /**
   * The newest props, for the callbacks that live outside React's render. The
   * effect below keeps it fresh on every render, and it is declared first so
   * that every other effect — they run in declaration order — reads a fresh one.
   */
  const liveRef = useRef({ snapshot, orbits, selected, scale, textures, onSelect });
  useEffect(() => {
    liveRef.current = { snapshot, orbits, selected, scale, textures, onSelect };
  });

  /** Selecting a body, from anywhere in this view, always through the newest prop. */
  const selectBody = useCallback((id: BodyId | null): void => {
    liveRef.current.onSelect(id);
  }, []);

  /** The way back from any body: deselect, and fly to the whole system. */
  const showWholeSystem = useCallback((): void => {
    const state = stateRef.current;
    const built = state?.built ?? null;
    if (state === null || built === null) return;
    flyTo(state, wholeSystemPose(built));
    selectBody(null);
  }, [selectBody]);

  /**
   * Replaces the graph: another layout, other orbit paths, another texture set.
   * The renderer, the camera and the label elements outlive it, which is what
   * makes a scale switch cheap; the old graph's geometries, materials and
   * textures are disposed here, because nothing else holds them.
   */
  const rebuild = useCallback(
    (next: RebuildInput): void => {
      const state = stateRef.current;
      if (state === null) return;
      const previous = state.built;
      state.flight = null;
      // The followed body's old position belongs to the old layout; the camera
      // reopens on the whole system, so nothing is followed until a body is picked.
      state.followed = null;
      if (previous !== null) {
        state.scene.remove(previous.root);
        previous.resources.disposeAll();
      }
      const generation = (state.generation += 1);
      const resources = new SceneResources();
      const port: TexturePort = {
        load: (url, onReady, onFailed) =>
          state.textureLoader.load(url, onReady, undefined, onFailed),
      };
      const loaded = loadPlanetTextures(
        next.textures,
        port,
        resources,
        () => {
          state.requestRender();
        },
        (id, slot) => {
          const built = state.built;
          if (built !== null && state.generation === generation) {
            if (id === null) dropSkyTexture(built);
            else if (slot !== "sky") dropTexture(built, id, slot);
          }
          state.requestRender();
        },
      );
      const built = buildSolarScene({
        snapshot: liveRef.current.snapshot,
        orbits: next.orbits,
        scale: next.scale,
        palette: solarPalette(currentTheme()),
        textures: loaded,
        resources,
      });
      state.built = built;
      state.orbits = next.orbits;
      state.texturesSource = next.textures;
      state.scene.add(built.root);

      // The wheel's limits follow the layout: it must not be able to push the
      // camera through a planet, nor to leave the system behind.
      state.controls.minDistance = next.scale === "true" ? 0.01 : 0.25;
      state.controls.maxDistance = next.scale === "true" ? 400_000 : 4000;

      syncLabels(state, built, selectBody);
      applySelection(built, liveRef.current.selected);
      setPose(state, wholeSystemPose(built));
      state.requestRender();
    },
    [selectBody],
  );

  // --- The mount: the renderer, the camera, the controls, the loop. ----------
  useEffect(() => {
    const host = viewportRef.current;
    const layer = labelLayerRef.current;
    if (host === null || layer === null) return;
    // Read out into `const`s of the non-null type: the helper functions below
    // are closures, and TypeScript does not carry this effect's narrowing into
    // them.
    const viewport: HTMLDivElement = host;
    const labelLayer: HTMLDivElement = layer;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      // Transparent, so the surface behind the canvas is the page's own token
      // colour and this view never has to hold one.
      alpha: true,
      // True scale puts a 0.04-unit planet and a 300 000-unit orbit in the same
      // frustum; without a logarithmic depth buffer they would z-fight.
      logarithmicDepthBuffer: true,
    });
    renderer.domElement.className = "solar__canvas";
    // The canvas is the viewport's FIRST child, so the absolutely positioned
    // label layer paints above it and no z-index is needed anywhere.
    viewport.prepend(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      FIELD_OF_VIEW_DEG,
      1,
      CAMERA_NEAR_UNITS,
      CAMERA_FAR_UNITS,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    // Damping eases the camera to a stop after a gesture. Its inertia costs frames
    // only while it runs: `paint` asks the controls whether they are still
    // settling, so the view still idles once the motion has ended.
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.zoomToCursor = true;
    controls.enablePan = true;
    controls.addEventListener("change", () => {
      state.requestRender();
    });
    controls.addEventListener("start", () => {
      // The user taking the camera back ends a flight; the follow stays armed.
      state.flight = null;
    });

    // three loads with `crossOrigin = "anonymous"`: a WebGL texture from another
    // origin must be granted by CORS, which `nx-pack:` does (`main/schemes.ts`).
    const textureLoader = new THREE.TextureLoader();

    const state: ViewState = {
      renderer,
      scene: new THREE.Scene(),
      camera,
      controls,
      textureLoader,
      viewport,
      labelLayer,
      labels: new Map(),
      built: null,
      generation: 0,
      orbits: liveRef.current.orbits,
      texturesSource: liveRef.current.textures,
      flight: null,
      followed: null,
      dragOrigin: null,
      frame: 0,
      requestRender: () => undefined,
    };
    stateRef.current = state;

    /**
     * Whether the canvas is on screen at all. The view is one of four tabs, so
     * three quarters of the time it is in the DOM but not visible; a frame
     * scheduled while it is hidden is a frame nobody sees and, with a clock
     * driving new snapshots, one that keeps arriving. `IntersectionObserver`
     * plus the document's own visibility is what makes "renders only while
     * visible" true rather than hoped for.
     */
    let onScreen = true;

    function paint(): void {
      state.frame = 0;
      // A hidden tab or a hidden window draws nothing and does NOT reschedule:
      // the next change (or the return of visibility) calls `requestRender`.
      if (document.hidden || !onScreen) return;
      const stillFlying = advanceFlight();
      const settling = state.controls.update();
      updateLabels();
      renderer.render(state.scene, state.camera);
      if (stillFlying || settling) state.requestRender();
    }

    state.requestRender = () => {
      if (state.frame === 0) state.frame = window.requestAnimationFrame(paint);
    };

    function advanceFlight(): boolean {
      const flight = state.flight;
      if (flight === null) return false;
      const t = (window.performance.now() - flight.startedAt) / FLIGHT_MS;
      setPose(state, flyToPath(flight.from, flight.to, t));
      if (t >= 1) {
        state.flight = null;
        return false;
      }
      return true;
    }

    function resize(): void {
      const width = Math.max(1, viewport.clientWidth);
      const height = Math.max(1, viewport.clientHeight);
      // Capped at 2: a 3× or 4× ratio on a high-density display quadruples the
      // pixels for a difference nobody sees on a sphere.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      state.requestRender();
    }

    const screenObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const next = entry?.isIntersecting ?? true;
        const resumed = next && !onScreen;
        onScreen = next;
        if (resumed) state.requestRender();
      },
      { threshold: 0 },
    );
    screenObserver.observe(viewport);

    const onDocumentVisibility = (): void => {
      if (!document.hidden && onScreen) state.requestRender();
    };
    document.addEventListener("visibilitychange", onDocumentVisibility);

    /**
     * A body's centre and drawn radius in CSS pixels, or `null` when it is
     * behind the camera or has left the screen. The pixel radius is the sphere's
     * angular size against the vertical field of view — the disc the label must
     * clear. `depth` is the camera's distance to it, which decides overlaps.
     */
    function project(handle: BuiltSolarBody): (LabelAnchor & { readonly depth: number }) | null {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (width === 0 || height === 0) return null;
      // The root group is never moved or turned, so a handle's local position is
      // its world position.
      const centre = handle.group.position.clone().project(camera);
      if (centre.z > 1) return null;
      const x = (centre.x * 0.5 + 0.5) * width;
      const y = (-centre.y * 0.5 + 0.5) * height;
      if (
        x < -LABEL_OFFSCREEN_PX ||
        y < -LABEL_OFFSCREEN_PX ||
        x > width + LABEL_OFFSCREEN_PX ||
        y > height + LABEL_OFFSCREEN_PX
      ) {
        return null;
      }
      const distance = camera.position.distanceTo(handle.group.position);
      const halfFrame = Math.tan((FIELD_OF_VIEW_DEG * Math.PI) / 360) * distance;
      const radiusPx = halfFrame === 0 ? 0 : (handle.mesh.scale.x / halfFrame) * (height / 2);
      return { id: handle.id, x, y, radiusPx, widthPx: 0, depth: distance };
    }

    /**
     * Two passes on purpose: every label's text and measured width is read
     * first, every position is written afterwards, so the layer is laid out once
     * per frame instead of once per label.
     */
    function updateLabels(): void {
      const built = state.built;
      if (built === null) return;
      const locale = activeLocale();
      const measured: LabelAnchor[] = [];
      for (const handle of built.bodies) {
        const element = state.labels.get(handle.id);
        if (element === undefined) continue;
        element.textContent = bodyLabel(handle.id, locale);
        element.classList.toggle("solar__label--selected", handle.id === built.selected);
        const anchor = project(handle);
        if (anchor === null) {
          element.hidden = true;
          continue;
        }
        element.hidden = false;
        // Measured invisible, placed visible: an element has to be laid out to
        // have a width, and a label drawn at its old position for one frame
        // would flicker.
        element.style.visibility = "hidden";
        measured.push({ ...anchor, widthPx: element.offsetWidth });
      }

      const byId = new Map(
        placeLabels(measured, { width: viewport.clientWidth, height: viewport.clientHeight }).map(
          (placement) => [placement.id, placement],
        ),
      );
      for (const handle of built.bodies) {
        const element = state.labels.get(handle.id);
        if (element === undefined || element.hidden) continue;
        const placement = byId.get(handle.id);
        if (placement === undefined) {
          element.style.visibility = "hidden";
          continue;
        }
        element.style.transform = `translate(${String(placement.box.x)}px, ${String(placement.box.y)}px)`;
        element.style.visibility = "visible";
      }
    }

    /**
     * The body a pointer is over, in client pixels. Bodies are hit by what they
     * look like on screen, not by their spheres: in true scale a planet is a
     * pixel across, so the minimum disc is what a click can actually reach.
     */
    function bodyAt(clientX: number, clientY: number): BodyId | null {
      const built = state.built;
      if (built === null) return null;
      const bounds = viewport.getBoundingClientRect();
      const anchors: PickAnchor<BodyId>[] = [];
      for (const handle of built.bodies) {
        const anchor = project(handle);
        if (anchor !== null) anchors.push(anchor);
      }
      return pickAnchor(anchors, clientX - bounds.left, clientY - bounds.top, MIN_PICK_RADIUS_PX);
    }

    const resizeObserver = new ResizeObserver(() => {
      resize();
    });
    resizeObserver.observe(viewport);

    // A theme switch repaints materials that are already on the GPU: only a
    // handful of colours changed, so nothing is rebuilt.
    const themeObserver = new MutationObserver(() => {
      const built = state.built;
      if (built === null) return;
      applyPalette(built, solarPalette(currentTheme()));
      state.requestRender();
    });
    themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });

    const onPointerDown = (event: PointerEvent): void => {
      state.dragOrigin = { x: event.clientX, y: event.clientY };
      renderer.domElement.classList.add("solar__canvas--dragging");
    };
    const onPointerMove = (event: PointerEvent): void => {
      // While a button is held the cursor is already "grabbing"; over empty space
      // it is "grab", and over a body it says that a click will select it.
      if (state.dragOrigin !== null) return;
      renderer.domElement.classList.toggle(
        "solar__canvas--over-body",
        bodyAt(event.clientX, event.clientY) !== null,
      );
    };
    const onPointerUp = (event: PointerEvent): void => {
      const origin = state.dragOrigin;
      state.dragOrigin = null;
      renderer.domElement.classList.remove("solar__canvas--dragging");
      // A pointer that travelled was an orbit; only a click selects. The canvas
      // check keeps a click on a label from selecting whatever is behind it.
      if (origin === null || event.target !== renderer.domElement) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > DRAG_SLOP_PX) return;
      const id = bodyAt(event.clientX, event.clientY);
      if (id !== null) liveRef.current.onSelect(id);
    };
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);

    rebuild({
      orbits: liveRef.current.orbits,
      scale: liveRef.current.scale,
      textures: liveRef.current.textures,
    });
    resize();

    return () => {
      window.cancelAnimationFrame(state.frame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      screenObserver.disconnect();
      document.removeEventListener("visibilitychange", onDocumentVisibility);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      const built = state.built;
      if (built !== null) {
        state.scene.remove(built.root);
        built.resources.disposeAll();
      }
      state.labelLayer.replaceChildren();
      state.labels.clear();
      // The GL context has to go with the graph: a remount would otherwise take
      // a second one out of Chromium's small per-renderer budget.
      renderer.forceContextLoss();
      renderer.dispose();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, [rebuild]);

  // --- Another layout, other paths or other textures: rebuild. ---------------
  useEffect(() => {
    const state = stateRef.current;
    if (state === null) return;
    // The mount built from these very values; this guard is what keeps the first
    // commit from building the graph twice.
    if (state.orbits === orbits && state.texturesSource === textures && state.built?.scale === scale) {
      return;
    }
    rebuild({ orbits, scale, textures });
  }, [rebuild, orbits, scale, textures]);

  // --- Time moved: move the bodies, and follow the one being watched. --------
  useEffect(() => {
    const state = stateRef.current;
    const built = state?.built ?? null;
    if (state === null || built === null) return;
    applySnapshot(built, snapshot);
    // Time advancing on the same screen would slide a watched body out of frame
    // within minutes, so the camera travels with it by the body's displacement —
    // through `followPose`, and only while no flight is running. A pan the user
    // made survives, because the target is moved, not put back on the body.
    const followed = state.followed;
    if (followed !== null && state.flight === null) {
      const handle = handleFor(state, followed.id);
      if (handle !== undefined) {
        const position = handle.group.position;
        const now: Vector3 = [position.x, position.y, position.z];
        setPose(state, followPose(currentPose(state), followed.at, now));
        state.followed = { id: followed.id, at: now };
      }
    }
    state.requestRender();
  }, [snapshot]);

  // --- A selection changed: mark it, then fly to it. ------------------------
  useEffect(() => {
    const state = stateRef.current;
    const built = state?.built ?? null;
    if (state === null || built === null) return;
    applySelection(built, selected);
    const handle = selected === null ? undefined : handleFor(state, selected);
    if (handle === undefined) {
      state.followed = null;
      state.requestRender();
      return;
    }
    const position = handle.group.position;
    const to = poseFor(
      [position.x, position.y, position.z],
      Math.max(handle.mesh.scale.x, 1e-6),
      FIELD_OF_VIEW_DEG,
      SELECTED_FILL,
      viewDirectionOf(state),
    );
    // Armed now rather than when the flight lands: a gesture that cancels the
    // flight must leave the body followed from where the camera stands.
    state.followed = { id: handle.id, at: to.target };
    flyTo(state, to);
  }, [selected]);

  return (
    <div className="solar">
      <div className="solar__viewport" ref={viewportRef}>
        <div className="solar__labels" ref={labelLayerRef} />
        <Button
          className="solar__overview"
          size="sm"
          variant="ghost"
          onClick={showWholeSystem}
        >
          {copy.solar.overview}
        </Button>
      </div>
    </div>
  );
}
