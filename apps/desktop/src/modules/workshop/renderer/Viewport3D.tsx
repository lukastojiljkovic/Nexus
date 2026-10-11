import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ViewerColours } from "./palette.js";

/**
 * The one three.js surface both 3D viewers are drawn on: a bench, a grid floor,
 * and a camera the user orbits, pans and zooms.
 *
 * **Why the builders are callbacks rather than children.** What goes in the
 * scene is built from parsed data - a `Float32Array` of triangles or of segment
 * endpoints - and a builder that runs HERE, against this renderer's own
 * lifecycle, is what keeps geometry lifetimes in one place: every object this
 * component's builder adds is disposed when the scene is rebuilt and again when
 * the page unmounts. A scene assembled in `React` and handed in would leave
 * somebody else guessing when its buffers stop being used.
 *
 * **Why there is no animation loop.** Nothing here moves: the camera moves when
 * the user moves it, and controls emit `change` for exactly that. So the
 * viewport renders on demand - a resize, a build, a control change - which means
 * a page left open costs nothing, and the "no animation the user did not ask
 * for" rule (and `prefers-reduced-motion`) is satisfied by there being no
 * animation at all rather than by a flag this component remembers to read.
 *
 * **Z is up, because a print is.** STL and G-code coordinates are millimetres on
 * a machine whose Z axis is height, so the camera's up vector is Z and the grid
 * is rotated into the XY plane. A viewer that showed a printed part lying on its
 * side would be showing the file's coordinates as if they were CAD's.
 *
 * **Two keys, and the difference is what they cost.** `buildKey` names the
 * DOCUMENT: when it changes, the scene is emptied, rebuilt and re-fitted - which
 * re-uploads every buffer. `updateKey` names a change to how the SAME document
 * is drawn (which G-code layers are visible), and it runs `update` against the
 * objects the builder left behind, touching no buffer at all. Dragging the layer
 * slider is therefore free, which it would not be if it rebuilt.
 */

/** What a builder is handed: the container to fill, the bench's colours, and the one thing it needs from this component. */
export interface SceneApi {
  /**
   * The group the builder adds to. A GROUP rather than the scene itself, so the
   * lights and the floor this component owns cannot be cleared by a builder
   * rebuilding its own contents.
   */
  readonly scene: THREE.Group;
  readonly colours: ViewerColours;
  /** Points the camera at a box - what a builder calls once it has added its own geometry. */
  fit(box: THREE.Box3): void;
}

/** What the page reaches the viewport by: one button's worth of imperative access, and nothing else. */
export interface ViewportHandle {
  /** Re-frames the last built scene, for a camera the user has flown away from. */
  fit(): void;
}

export interface Viewport3DProps {
  /** The canvas's accessible name: a canvas has no text, and "the 3D view" is not a name. */
  readonly label: string;
  readonly colours: ViewerColours;
  readonly buildKey: string;
  readonly updateKey: string;
  readonly build: (api: SceneApi) => void;
  readonly update?: (api: SceneApi) => void;
}

export const Viewport3D = forwardRef<ViewportHandle, Viewport3DProps>(function Viewport3D(
  { label, colours, buildKey, updateKey, build, update },
  ref,
) {
  const host = useRef<HTMLDivElement | null>(null);
  /** Everything the effects below share: the renderer's own objects, and the last box a builder fitted. */
  const view = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Group;
    box: THREE.Box3;
    render: () => void;
  } | null>(null);

  /** The builders' callbacks are re-created every render, so the effects reach them through refs. */
  const builders = useRef({ build, update });
  builders.current = { build, update };

  useEffect(() => {
    const element = host.current;
    if (element === null) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(element.clientWidth, element.clientHeight, false);
    renderer.domElement.setAttribute("aria-label", label);
    renderer.domElement.setAttribute("role", "img");
    element.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      element.clientWidth / Math.max(1, element.clientHeight),
      0.1,
      1_000_000,
    );
    camera.up.set(0, 0, 1);
    const content = new THREE.Group();
    scene.add(content);

    const controls = new OrbitControls(camera, renderer.domElement);
    // Panning moves the point the camera looks at rather than sliding it at a
    // fixed depth, which is what makes a pan feel like moving the bench.
    controls.screenSpacePanning = true;
    controls.enableDamping = false;

    const box = new THREE.Box3();
    const render = (): void => renderer.render(scene, camera);
    const current = { renderer, scene, camera, controls, content, box, render };
    view.current = current;
    controls.addEventListener("change", render);

    // `ResizeObserver` rather than a window listener: the viewport is a grid
    // cell, so it changes size when the SIDE PANEL does, and a window resize
    // would miss that entirely.
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth;
      const height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    });
    observer.observe(element);
    render();

    return () => {
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      disposeGroup(content);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      view.current = null;
    };
  }, [label]);

  useImperativeHandle(
    ref,
    () => ({
      fit() {
        const current = view.current;
        if (current !== null) fitCamera(current.camera, current.controls, current.box, current.render);
      },
    }),
    [],
  );

  useEffect(() => {
    const current = view.current;
    if (current === null) return;
    // The previous document's geometry goes before the next one is built: a page
    // that opens file after file would otherwise hold every one of them.
    disposeGroup(current.content);
    current.content.clear();
    current.box.makeEmpty();
    const api: SceneApi = {
      scene: current.content,
      colours,
      fit(box) {
        current.box.copy(box);
        fitCamera(current.camera, current.controls, box, current.render);
      },
    };
    builders.current.build(api);
    current.render();
  }, [buildKey, colours]);

  useEffect(() => {
    const current = view.current;
    if (current === null) return;
    builders.current.update?.({ scene: current.content, colours, fit: () => undefined });
    current.render();
  }, [updateKey, colours]);

  return <div className="workshop__viewport" ref={host} />;
});

/**
 * Points the camera at a box, keeping the direction the user was looking from.
 *
 * The distance is the one a perspective camera needs for the box's largest
 * dimension to fit the vertical field of view, with a fifth of margin so the
 * model is not touching the frame. The direction is derived from where the
 * camera already is relative to the box's centre, so refitting after an orbit
 * keeps the angle the user chose; a camera sitting exactly at the centre (which
 * a degenerate, single-point model produces) gets the viewer's default angle.
 */
function fitCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  box: THREE.Box3,
  render: () => void,
): void {
  if (box.isEmpty()) return;
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z, 1);
  const distance = (extent / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.2;
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 1e-9) direction.set(1, -1, 0.7);
  direction.normalize();
  controls.target.copy(centre);
  camera.position.copy(centre).addScaledVector(direction, distance);
  camera.near = Math.max(0.1, distance / 1000);
  camera.far = distance * 1000;
  camera.updateProjectionMatrix();
  controls.update();
  render();
}

/** Releases every geometry, material and texture under `root` - the only place this module does. */
function disposeGroup(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh> & Partial<THREE.LineSegments>;
    const geometry = mesh.geometry;
    if (geometry !== undefined) geometry.dispose();
    const material = mesh.material;
    if (material === undefined) return;
    for (const one of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(one as unknown as Record<string, unknown>)) {
        // A material's maps are textures, and a texture holds GPU memory of its
        // own: disposing the material alone would leak it.
        if (value instanceof THREE.Texture) value.dispose();
      }
      one.dispose();
    }
  });
}
