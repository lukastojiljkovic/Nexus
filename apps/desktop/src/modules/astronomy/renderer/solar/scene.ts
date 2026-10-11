import type { BodyId, OrbitPath, SolarSystemSnapshot, Vector3 } from "@nexus/core";
import * as THREE from "three";

import type { SolarPalette } from "./palette.js";
import { installEarthNight, setEarthNightTexture, setEarthNightTone } from "./night.js";
import { SceneResources } from "./resources.js";
import {
  bodyRadiusUnits,
  placeBodies,
  satelliteClearanceUnits,
  satelliteOffsetUnits,
  scenePosition,
  type SolarScale,
} from "./scale.js";
import type { LoadedTextures } from "./textures.js";

/**
 * The three.js scene graph, built and updated by pure functions of the data.
 *
 * **Why the graph is separated from the component.** `WebGLRenderer` needs a GL
 * context and this repository has no browser in its test environment, so a view
 * written as one component can only be verified by eye. The scene is a function
 * from the engine's snapshot to a graph of objects, and a graph can be inspected
 * — positions, orientations, materials, textures — with no context at all. That
 * is what the tests do, and it is the reason this file owns every `new
 * THREE.*Geometry` and every material.
 *
 * **The Sun is the light.** A single `PointLight` sits at the origin with
 * `decay: 0`, and that number is the one that matters: with three's physical
 * units a light that falls off with the square of distance leaves Neptune
 * sixty-five thousand times dimmer than Mercury, which is a true picture and a
 * black screen. A very low `AmbientLight` keeps the far side of a sphere from
 * being a flat void when the camera has orbited past it; it is not a glow and it
 * carries no colour of its own.
 *
 * **The spin convention, stated because the contract does not fix it.**
 * `BodyState.rotationDeg` is "the angle of the prime meridian" and nothing else:
 * which direction the zero meridian points in the ecliptic frame, and which way
 * the angle grows, are the engine's business. This view therefore picks the
 * convention three.js already uses for a sphere — the map's `u = 0` seam lies on
 * the sphere's local −X axis and longitude grows towards +Z — and turns the
 * globe about its own north pole by a right-handed rotation of `rotationDeg`. The
 * relative motion over time is what a user sees, and it is consistent frame to
 * frame; a run that owns `planets.ts` can flip one sign here if the engine's
 * frame wants the other handedness.
 */

/** The unit sphere every body shares; one geometry is one allocation to dispose. */
export const SPHERE_WIDTH_SEGMENTS = 64;
export const SPHERE_HEIGHT_SEGMENTS = 32;

/** Saturn's ring plane's radial segments: enough that the ring's edge is a curve at close range. */
const RING_SEGMENTS = 160;

/** Light at the origin, with no falloff — see the header for why `decay` is 0. */
const SUN_LIGHT_INTENSITY = 3.2;
const AMBIENT_INTENSITY = 0.08;

/**
 * Saturn's rings as multiples of Saturn's own equatorial radius.
 *
 * The C ring's inner edge is 74 658 km and the A ring's outer edge 136 775 km —
 * the two ends of the visible main rings („Rings of Saturn", ring-structure
 * table, `https://en.wikipedia.org/wiki/Rings_of_Saturn`, read 2026-10-10) —
 * against an equatorial radius of 60 268 km (NASA Saturn fact sheet,
 * `https://nssdc.gsfc.nasa.gov/planetary/factsheet/saturnfact.html`). Multiplying
 * by the body's own drawn radius is what keeps the ring plane seated on the
 * planet at both scales.
 */
export const SATURN_RING_INNER_RADII = 74_658 / 60_268;
export const SATURN_RING_OUTER_RADII = 136_775 / 60_268;

const NORTH = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

export interface SolarSceneInput {
  readonly snapshot: SolarSystemSnapshot;
  readonly orbits: readonly OrbitPath[];
  readonly scale: SolarScale;
  readonly palette: SolarPalette;
  /** Already-created textures, or `null` for the scene with no maps at all. */
  readonly textures?: LoadedTextures | null;
  /**
   * The dispose list this graph should allocate into. The caller owns the
   * scene's lifetime, so it owns the list — a texture loaded before the graph
   * exists (`SolarSystemView.rebuild`) has to land on the same list the graph's
   * geometries and materials do, or the completeness test would be a lie.
   */
  readonly resources?: SceneResources;
}

/** One body as the graph holds it: where it is, how it points, and what draws it. */
export interface BuiltSolarBody {
  readonly id: BodyId;
  /** At the body's mapped position, turned so that its local +Y is the north pole. */
  readonly group: THREE.Group;
  /** Inside the group: turned about the pole by `rotationDeg`. */
  readonly spin: THREE.Group;
  /** The unit sphere, scaled to the body's drawn radius. */
  readonly mesh: THREE.Mesh;
  readonly ring: THREE.Mesh | null;
  readonly orbit: THREE.Line | null;
  /**
   * The body this one's orbit line is drawn around, for a satellite, or `null`
   * for a heliocentric path. The line's own vertices are offsets from the
   * parent in that case, so its world position is the parent's drawn position
   * (set by `applySnapshot`) — the same transform the dot is placed with.
   */
  readonly orbitParent: BodyId | null;
}

export interface BuiltSolarScene {
  readonly root: THREE.Group;
  readonly bodies: readonly BuiltSolarBody[];
  readonly sunLight: THREE.PointLight;
  readonly resources: SceneResources;
  readonly scale: SolarScale;
  /** The colours in use, replaced by `applyPalette` and read by the update functions. */
  palette: SolarPalette;
  /** The body whose orbit is drawn as selected, or `null`. */
  selected: BodyId | null;
}

function toThree(vector: Vector3): THREE.Vector3 {
  return new THREE.Vector3(vector[0], vector[1], vector[2]);
}

/**
 * The turn that lays a body's local +Y along its north pole.
 *
 * `northPole` arrives as a unit vector in the ecliptic frame, so this is a plain
 * rotation from one direction to another; a body whose pole is already +Y gets
 * the identity, and a zero vector — which no real body has — gets it too rather
 * than a `NaN` quaternion.
 */
export function orientationFor(northPole: Vector3): THREE.Quaternion {
  const pole = toThree(northPole);
  if (pole.lengthSq() === 0) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(NORTH, pole.normalize());
}

/**
 * Remaps a ring's planar UVs onto the strip a ring texture actually is.
 *
 * `RingGeometry` ships UVs that project the disc like a photograph — the middle
 * of the texture at the middle of the ring — while every ring image in the world
 * is a radial strip: `u` across the ring from its inner edge to its outer one,
 * `v` around it. Without this the texture is a smear; with it, `u = 0` is the
 * inner edge and `v = 0` the +X direction.
 */
export function mapRingUv(geometry: THREE.BufferGeometry, inner: number, outer: number): void {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const span = outer - inner;
  for (let index = 0; index < position.count; index += 1) {
    const radius = Math.hypot(position.getX(index), position.getY(index));
    const angle = Math.atan2(position.getY(index), position.getX(index)) / (Math.PI * 2);
    uv.setXY(index, (radius - inner) / span, angle < 0 ? angle + 1 : angle);
  }
  uv.needsUpdate = true;
}

/**
 * The whole graph for one snapshot and one layout.
 *
 * Every geometry, material and texture it creates is tracked in
 * `scene.resources`, which the caller disposes on unmount. Positions, radii and
 * rotations are applied through `applySnapshot` afterwards, so time advancing
 * costs one field write per body rather than a rebuild.
 */
export function buildSolarScene(input: SolarSceneInput): BuiltSolarScene {
  const resources = input.resources ?? new SceneResources();
  const root = new THREE.Group();
  const textures = input.textures ?? null;

  const sphereGeometry = resources.track(
    new THREE.SphereGeometry(1, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS),
  );
  const ringGeometry = resources.track(
    new THREE.RingGeometry(
      SATURN_RING_INNER_RADII,
      SATURN_RING_OUTER_RADII,
      RING_SEGMENTS,
      1,
    ),
  );
  mapRingUv(ringGeometry, SATURN_RING_INNER_RADII, SATURN_RING_OUTER_RADII);

  // Distance 0 is infinite reach; decay 0 is no falloff. See the header.
  const sunLight = new THREE.PointLight(WHITE, SUN_LIGHT_INTENSITY, 0, 0);
  root.add(sunLight);
  root.add(new THREE.AmbientLight(WHITE, AMBIENT_INTENSITY));

  const bodiesById = new Map(input.snapshot.bodies.map((body) => [body.id, body]));
  const orbitsByBody = new Map<BodyId, THREE.Line>();
  const orbitParents = new Map<BodyId, BodyId>();
  for (const path of input.orbits) {
    if (path.points.length < 2) continue;
    // A satellite's points are offsets from the body it names, and its line is
    // drawn with the SAME transform the dot is placed with (`placeBodies`): the
    // parent's mapped position plus the stretched offset. That is what makes
    // the dot lie on its own orbit line instead of inside the enlarged planet
    // it belongs to.
    const parent = path.parent ?? null;
    const parentBody = parent === null ? undefined : bodiesById.get(parent);
    const satelliteBody = bodiesById.get(path.id);
    const clearance =
      parentBody === undefined || satelliteBody === undefined
        ? 0
        : satelliteClearanceUnits(parentBody, satelliteBody, input.scale);
    const geometry = resources.track(new THREE.BufferGeometry());
    const positions = new Float32Array(path.points.length * 3);
    path.points.forEach((point, index) => {
      const mapped =
        parent === null ? scenePosition(point, input.scale) : satelliteOffsetUnits(point, clearance, input.scale);
      positions[index * 3] = mapped[0];
      positions[index * 3 + 1] = mapped[1];
      positions[index * 3 + 2] = mapped[2];
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = resources.track(
      new THREE.LineBasicMaterial({
        color: input.palette.orbit,
        transparent: true,
        opacity: input.palette.orbitOpacity,
      }),
    );
    const line = new THREE.Line(geometry, material);
    root.add(line);
    orbitsByBody.set(path.id, line);
    if (parent !== null) orbitParents.set(path.id, parent);
  }

  const bodies: BuiltSolarBody[] = [];
  for (const body of input.snapshot.bodies) {
    const isSun = body.id === "sun";
    const forBody = textures?.[body.id] ?? null;
    const dayMap = forBody?.day ?? null;

    // The Sun is its own light: a lit material on it would be lit from inside
    // itself and read as a grey ball. Everything else is a lit sphere.
    let material: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
    if (isSun) {
      material = resources.track(
        new THREE.MeshBasicMaterial({ color: dayMap === null ? input.palette.sun : WHITE }),
      );
    } else {
      const lit = resources.track(
        new THREE.MeshStandardMaterial({
          color: dayMap === null ? input.palette.body : WHITE,
          roughness: 1,
          metalness: 0,
        }),
      );
      // The Earth is the one body with a night side worth drawing, and it is
      // drawn only when the pack gave it a day map: the injection samples the
      // night map with the mesh's own UVs, and a body with no textures is the
      // neutral tone the terminator already comes from the point light for.
      if (body.id === "earth" && dayMap !== null) {
        installEarthNight(lit, forBody?.night ?? null, input.palette.nightLights);
      }
      material = lit;
    }
    if (dayMap !== null) material.map = dayMap;

    const group = new THREE.Group();
    group.quaternion.copy(orientationFor(body.northPole));
    const spin = new THREE.Group();
    const mesh = new THREE.Mesh(sphereGeometry, material);
    // The raycast needs to know which body it hit; the graph is the only place
    // the mapping from a mesh back to the engine's id exists.
    mesh.userData["bodyId"] = body.id;
    spin.add(mesh);
    group.add(spin);

    let ring: THREE.Mesh | null = null;
    if (body.id === "saturn") {
      const ringMaterial = resources.track(
        new THREE.MeshBasicMaterial({
          color: input.palette.rings,
          side: THREE.DoubleSide,
          transparent: true,
        }),
      );
      if (forBody?.rings != null) ringMaterial.map = forBody.rings;
      ring = new THREE.Mesh(ringGeometry, ringMaterial);
      // The ring plane is the equatorial plane, and the group's local +Y is the
      // pole, so the disc lies in the group's local XZ plane.
      ring.rotation.x = -Math.PI / 2;
      group.add(ring);
    }

    root.add(group);
    bodies.push({
      id: body.id,
      group,
      spin,
      mesh,
      ring,
      orbit: orbitsByBody.get(body.id) ?? null,
      orbitParent: orbitParents.get(body.id) ?? null,
    });
  }

  const scene: BuiltSolarScene = {
    root,
    bodies,
    sunLight,
    resources,
    scale: input.scale,
    palette: input.palette,
    selected: null,
  };
  applySnapshot(scene, input.snapshot);
  return scene;
}

/**
 * Moves every body to where the new snapshot puts it, and turns it.
 *
 * Nothing is rebuilt: the graph's shape is a function of the body list and the
 * layout, and time changes neither. This is what a running clock calls.
 */
export function applySnapshot(scene: BuiltSolarScene, snapshot: SolarSystemSnapshot): void {
  const placed = placeBodies(snapshot, scene.scale);
  for (const handle of scene.bodies) {
    const body = snapshot.bodies.find((candidate) => candidate.id === handle.id);
    if (body === undefined) continue;
    const position = placed.get(body.id);
    if (position !== undefined) handle.group.position.set(position[0], position[1], position[2]);
    handle.group.quaternion.copy(orientationFor(body.northPole));
    handle.spin.rotation.y = THREE.MathUtils.degToRad(body.rotationDeg);
    const radius = bodyRadiusUnits(body, scene.scale);
    handle.mesh.scale.setScalar(radius);
    handle.ring?.scale.setScalar(radius);
  }
  // A satellite's orbit line is drawn around its parent and travels with it:
  // its vertices are offsets, so the parent's drawn position IS the line's
  // transform, and one write per snapshot keeps the two in step. Done in a
  // second pass because the parent's position has to be current first.
  for (const handle of scene.bodies) {
    if (handle.orbit === null || handle.orbitParent === null) continue;
    const parent = scene.bodies.find((candidate) => candidate.id === handle.orbitParent);
    if (parent !== undefined) handle.orbit.position.copy(parent.group.position);
  }
}

/**
 * Marks one body's orbit as selected.
 *
 * The mark is a colour on the orbit LINE rather than a fill on the sphere: this
 * product's selection is typographic everywhere else, and the label layer turns
 * the selected body's name accent at the same time. Both read the same token.
 */
export function applySelection(scene: BuiltSolarScene, selected: BodyId | null): void {
  scene.selected = selected;
  for (const handle of scene.bodies) {
    if (handle.orbit === null) continue;
    const material = handle.orbit.material as THREE.LineBasicMaterial;
    const isSelected = handle.id === selected;
    material.color.set(isSelected ? scene.palette.orbitSelected : scene.palette.orbit);
    material.opacity = isSelected ? scene.palette.orbitSelectedOpacity : scene.palette.orbitOpacity;
  }
}

/**
 * Repaints everything for another theme, in place.
 *
 * A theme switch is not a rebuild: the geometry, the textures and the camera are
 * all still right, and only five colours changed. A body carrying a texture
 * keeps it — the map multiplies the tone — so its colour goes back to white.
 */
export function applyPalette(scene: BuiltSolarScene, palette: SolarPalette): void {
  scene.palette = palette;
  for (const handle of scene.bodies) {
    const material = handle.mesh.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    if (material.map === null) {
      material.color.set(handle.id === "sun" ? palette.sun : palette.body);
    }
    // The Earth's night lights are drawn in the accent's own gold, so a theme
    // switch reaches them like every other colour in the scene.
    if (material instanceof THREE.MeshStandardMaterial) {
      setEarthNightTone(material, palette.nightLights);
    }
    if (handle.ring !== null) {
      const ringMaterial = handle.ring.material as THREE.MeshBasicMaterial;
      if (ringMaterial.map === null) ringMaterial.color.set(palette.rings);
    }
  }
  applySelection(scene, scene.selected);
}

/** Which image of a body's set a failed load is falling back from. */
export type TextureSlot = "day" | "night" | "rings";

/**
 * Drops a texture that failed to load and paints the slot with its token tone.
 *
 * A pack can be missing an image, or a file can be corrupt; either way the body
 * must still be drawn. A `map` that never resolved renders as an untextured
 * sphere, and an untextured sphere whose colour is the neutral tone is exactly
 * what a body with no texture looks like — so the fallback is the view's normal
 * appearance rather than an error state.
 */
export function dropTexture(scene: BuiltSolarScene, id: BodyId, slot: TextureSlot): void {
  const handle = scene.bodies.find((candidate) => candidate.id === id);
  if (handle === undefined) return;
  if (slot === "rings") {
    if (handle.ring === null) return;
    const ringMaterial = handle.ring.material as THREE.MeshBasicMaterial;
    ringMaterial.map = null;
    ringMaterial.color.set(scene.palette.rings);
    ringMaterial.needsUpdate = true;
    return;
  }
  const material = handle.mesh.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  if (slot === "night") {
    // A `value` write on a uniform, never a rebuild: the night map failing
    // costs the city lights and leaves the terminator the lighting's own.
    if (material instanceof THREE.MeshStandardMaterial) setEarthNightTexture(material, null);
    return;
  }
  material.map = null;
  material.color.set(id === "sun" ? scene.palette.sun : scene.palette.body);
  material.needsUpdate = true;
}

/**
 * The radius the camera must frame to hold the whole system: the farthest point
 * of any orbit line, or the farthest body when no paths were handed in.
 *
 * Read off the vertices rather than from a bounding sphere, and the difference
 * is not academic: `computeBoundingSphere` centres the sphere on the path's
 * bounding box, so a path that is a half-circle around the Sun answers a centre
 * far from the origin and a radius to match — the sum of the two is nearly twice
 * the distance the camera actually has to cover, and the whole system opens at
 * half its proper size.
 */
export function sceneFitRadius(scene: BuiltSolarScene): number {
  let radius = 0;
  for (const handle of scene.bodies) {
    const position = handle.group.position;
    radius = Math.max(radius, Math.hypot(position.x, position.y, position.z) + handle.mesh.scale.x);
  }
  for (const handle of scene.bodies) {
    if (handle.orbit === null) continue;
    const positions = handle.orbit.geometry.getAttribute("position");
    // A satellite's line is drawn around its parent, so its vertices are
    // offsets from a point the fit must add back in.
    const origin = handle.orbit.position;
    const offset = handle.orbitParent === null ? 0 : Math.hypot(origin.x, origin.y, origin.z);
    for (let index = 0; index < positions.count; index += 1) {
      radius = Math.max(
        radius,
        offset + Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index)),
      );
    }
  }
  return radius;
}

