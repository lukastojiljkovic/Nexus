import * as THREE from "three";
import type { GcodeModel, StlMesh } from "@nexus/core";
import type { SceneApi } from "./Viewport3D.js";

/**
 * What the two 3D viewers actually draw, as plain three.js - no React, no image
 * loading, nothing that cannot be read as "this is what is in the scene".
 *
 * **The grid is the model's own scale, not a fixed one.** A grid of a fixed
 * 200 mm would be a speck under a printed part and a wall of lines under a
 * 5 mm bracket, so its size is derived from the scene it is drawn for, rounded
 * up to a power of ten, and its cells are ten to a side - which is a floor that
 * says "this is how big that is" rather than a floor that says "grid".
 */

/** A grid floor under whatever is drawn, sized from the scene's own bounds. */
export function addGrid(api: SceneApi, box: THREE.Box3): THREE.GridHelper {
  const size = box.isEmpty() ? 100 : Math.max(box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).y, 1);
  const span = niceSpan(size);
  const grid = new THREE.GridHelper(span, 10, api.colours.gridStrong, api.colours.grid);
  // The grid is a horizontal plane in three.js; a print's horizontal plane is XY.
  grid.rotation.x = Math.PI / 2;
  const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  grid.position.set(centre.x, centre.y, box.isEmpty() ? 0 : box.min.z);
  api.scene.add(grid);
  return grid;
}

/** The next power of ten at or above `value`, so the grid's cells are a round number of millimetres. */
function niceSpan(value: number): number {
  const power = Math.pow(10, Math.ceil(Math.log10(Math.max(value, 1e-6))));
  return power < value ? power * 10 : power;
}

/** The scene a model is drawn in: the mesh, its bounding box, and the grid beneath it. */
export function buildModelScene(api: SceneApi, mesh: StlMesh, wireframe: boolean): void {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  // No normals attribute is built, and that is deliberate: the material shades
  // FLAT, so three computes each face's normal from the triangle itself. A file's
  // stored normals are discarded by the reader on purpose, and this is the same
  // fact the volume came from - so the lighting and the volume agree about which
  // way the surface faces rather than trusting a field exporters get wrong.

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(api.colours.model),
    flatShading: true,
    metalness: 0,
    roughness: 0.75,
    // A wireframe over a half-million-triangle mesh is a grey mass, which is the
    // honest thing to show when somebody asks for it; the control says what it
    // is, and there is no second "prettier" wireframe to invent.
    wireframe,
  });
  const model = new THREE.Mesh(geometry, material);
  api.scene.add(model);

  // The bench's light, from the bench's own edge ink: a value from the tokens
  // rather than a white somebody typed, and one that turns with the theme.
  const ambient = new THREE.AmbientLight(new THREE.Color(api.colours.light), 0.55);
  const key = new THREE.DirectionalLight(new THREE.Color(api.colours.light), 1.6);
  key.position.set(1, -1.4, 2);
  const fill = new THREE.DirectionalLight(new THREE.Color(api.colours.light), 0.6);
  fill.position.set(-1.2, 1, -0.6);
  api.scene.add(ambient, key, fill);

  const box = new THREE.Box3(
    new THREE.Vector3(...mesh.bounds.min),
    new THREE.Vector3(...mesh.bounds.max),
  );
  const outline = new THREE.Box3Helper(box, new THREE.Color(api.colours.edges));
  api.scene.add(outline);
  addGrid(api, box);
  api.fit(box);
}

/** One layer's two line sets, kept so the slider can show and hide them without rebuilding anything. */
export interface ToolpathScene {
  /** Shows every layer up to and including `top`, and hides the rest. */
  setTop(top: number): void;
}

/**
 * The scene a toolpath is drawn in: one line set per layer per kind, travel
 * moves dimmed, and the layers above the slider's position out of the way.
 *
 * **Why a line set per layer rather than one for the file.** A slider that
 * changed which layers are drawn has to change it without re-uploading two
 * million segments on every drag, and `visible` on an existing object is that
 * change. The cost is one object per layer, which is tens of them rather than
 * thousands.
 */
export function buildToolpathScene(api: SceneApi, model: GcodeModel): ToolpathScene {
  const box = new THREE.Box3(
    new THREE.Vector3(...model.bounds.min),
    new THREE.Vector3(...model.bounds.max),
  );
  const extrusionMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(api.colours.extrusion),
    transparent: true,
    opacity: 1,
  });
  // Dimmed rather than hidden: a travel move IS part of what the machine did,
  // and it is the one part nobody wants to read on top of the print.
  const travelMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(api.colours.travel),
    transparent: true,
    opacity: 0.22,
  });
  const lines: THREE.LineSegments[] = [];
  for (const layer of model.layers) {
    const extrusion = lineSet(layer.extrusion, extrusionMaterial);
    const travel = lineSet(layer.travel, travelMaterial);
    api.scene.add(extrusion, travel);
    lines.push(extrusion, travel);
  }
  addGrid(api, box);
  api.fit(box);
  return {
    setTop(top) {
      // Two objects per layer, in the order they were added: the layer's own
      // index is half the pair's position, which is why nothing else is needed.
      for (const [index, object] of lines.entries()) object.visible = Math.floor(index / 2) <= top;
    },
  };
}

/** One line set from a flat array of segment endpoints, or nothing at all when a layer has none. */
function lineSet(points: Float32Array, material: THREE.LineBasicMaterial): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  const object = new THREE.LineSegments(geometry, material);
  // A layer with nothing of this kind in it has an empty buffer, which is a
  // draw call three.js skips; hiding it keeps the object out of the count.
  object.visible = points.length > 0;
  return object;
}
