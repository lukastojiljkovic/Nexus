import { describe, expect, it, vi } from "vitest";
import type { BodyId, BodyState, OrbitPath, SolarSystemSnapshot, Vector3 } from "@nexus/core";
import * as THREE from "three";

import { solarPalette } from "./palette.js";
import { SceneResources, type Disposable } from "./resources.js";
import {
  applyPalette,
  applySelection,
  applySnapshot,
  buildSolarScene,
  dropTexture,
  mapRingUv,
  orientationFor,
  sceneFitRadius,
  type BuiltSolarScene,
} from "./scene.js";
import { bodyRadiusUnits, readableDistanceUnits, scenePosition } from "./scale.js";

/**
 * The scene graph, built and inspected with no GL context at all.
 *
 * This is the acceptance test the brief asks for: the view's whole three.js
 * half is a function from the engine's snapshot to a graph of objects, so every
 * claim it makes — where a body is, which way its pole points, how far its globe
 * has turned, where Saturn's ring plane sits, that each texture is on the right
 * material, and that everything it allocated is on the dispose list — is a
 * statement about that graph. Nothing here draws anything.
 */

const DEG = Math.PI / 180;

function body(
  id: BodyId,
  position: Vector3,
  radiusKm: number,
  rotationDeg = 0,
  northPole: Vector3 = [0, 1, 0],
): BodyState {
  return { id, position, radiusKm, rotationDeg, northPole, distanceFromEarthAu: 0 };
}

/** A four-body system: the Sun, the Earth (tilted 23.44°), the Moon and Saturn. */
const SNAPSHOT: SolarSystemSnapshot = {
  instantMs: 0,
  bodies: [
    body("sun", [0, 0, 0], 696_000),
    body("earth", [1, 0, 0], 6371, 30, [0, Math.cos(23.44 * DEG), Math.sin(23.44 * DEG)]),
    // The Moon's mean distance from the Earth: 384 400 km (NASA Moon fact sheet).
    body("moon", [1.00257, 0, 0], 1737.4),
    body("saturn", [9.5, 0, 0], 60_268),
  ],
};

const ORBITS: readonly OrbitPath[] = [
  { id: "earth", points: [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [1, 0, 0]] },
  { id: "saturn", points: [[9.5, 0, 0], [0, 0, 9.5], [-9.5, 0, 0]] },
];

const PALETTE = solarPalette("dan");

function build(overrides: Partial<Parameters<typeof buildSolarScene>[0]> = {}): BuiltSolarScene {
  return buildSolarScene({
    snapshot: SNAPSHOT,
    orbits: ORBITS,
    scale: "readable",
    palette: PALETTE,
    ...overrides,
  });
}

function handleFor(scene: BuiltSolarScene, id: BodyId) {
  const handle = scene.bodies.find((candidate) => candidate.id === id);
  if (handle === undefined) throw new Error(`no handle for ${id}`);
  return handle;
}

/** The map-carrying shape a material may be, without lying about which one it is. */
interface Mappable {
  readonly map?: THREE.Texture | null;
  readonly emissiveMap?: THREE.Texture | null;
  readonly alphaMap?: THREE.Texture | null;
}

/**
 * Every geometry, material and texture the graph can reach — the census the
 * dispose list is compared against.
 */
function collect(scene: BuiltSolarScene): Disposable[] {
  const found: Disposable[] = [];
  const add = (item: Disposable): void => {
    if (!found.includes(item)) found.push(item);
  };
  scene.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
    add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      add(material);
      const maps = material as Mappable;
      for (const texture of [maps.map, maps.emissiveMap, maps.alphaMap]) {
        if (texture != null) add(texture);
      }
    }
  });
  return found;
}

function bodyOf(id: BodyId): BodyState {
  const source = SNAPSHOT.bodies.find((candidate) => candidate.id === id);
  if (source === undefined) throw new Error(`the fixture has no ${id}`);
  return source;
}

/** A material's tone as the hex the tokens are written in, so two colours can be compared. */
function toneOf(material: THREE.Material): string {
  return (material as THREE.MeshStandardMaterial).color.getHexString();
}

describe("buildSolarScene", () => {
  it("builds one group per body, with the Sun as the only light", () => {
    const scene = build();
    expect(scene.bodies.map((handle) => handle.id)).toEqual([
      "sun",
      "earth",
      "moon",
      "saturn",
    ]);
    const lights = scene.root.children.filter((child) => child instanceof THREE.Light);
    expect(lights).toHaveLength(2);
    expect(scene.sunLight).toBeInstanceOf(THREE.PointLight);
    // No falloff: with the physical inverse-square law Neptune would be sixty
    // thousand times dimmer than Mercury and the picture would be black.
    expect(scene.sunLight.decay).toBe(0);
    expect(scene.sunLight.position.toArray()).toEqual([0, 0, 0]);
  });

  it("places each body where the layout puts it, at the radius the layout gives it", () => {
    const scene = build();
    const sun = handleFor(scene, "sun");
    expect(sun.group.position.toArray()).toEqual([0, 0, 0]);

    const earth = handleFor(scene, "earth");
    expect(earth.group.position.x).toBeCloseTo(readableDistanceUnits(1), 10);
    expect(earth.group.position.y).toBeCloseTo(0, 12);
    expect(earth.mesh.scale.x).toBeCloseTo(bodyRadiusUnits(bodyOf("earth"), "readable"), 12);
    // The Sun is 5.9 units across at this scale and Mercury's orbit is 43: the
    // radii are enlarged, and they still fit.
    expect(sun.mesh.scale.x).toBeLessThan(readableDistanceUnits(0.387) / 4);
  });

  it("lays every pole along the body's north pole and turns each globe by its own angle", () => {
    const scene = build();
    for (const handle of scene.bodies) {
      const source = SNAPSHOT.bodies.find((candidate) => candidate.id === handle.id);
      if (source === undefined) throw new Error("fixture");
      const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(handle.group.quaternion);
      expect(pole.dot(new THREE.Vector3(source.northPole[0], source.northPole[1], source.northPole[2]))).toBeCloseTo(1, 10);
      expect(handle.spin.rotation.y).toBeCloseTo(source.rotationDeg * DEG, 12);
      // The globe turns inside the body's frame: the mesh hangs off the spin,
      // the spin off the group that carries the pole.
      expect(handle.mesh.parent).toBe(handle.spin);
      expect(handle.spin.parent).toBe(handle.group);
    }
    const sun = handleFor(scene, "sun");
    expect(sun.group.quaternion.w).toBe(1);
  });

  it("seats Saturn's rings in the equatorial plane of its own frame", () => {
    const scene = build();
    const saturn = handleFor(scene, "saturn");
    const ring = saturn.ring;
    if (ring === null) throw new Error("Saturn has no ring");
    expect(ring.parent).toBe(saturn.group);
    expect(ring.rotation.x).toBeCloseTo(-Math.PI / 2, 12);
    expect(ring.scale.x).toBeCloseTo(saturn.mesh.scale.x, 12);
    for (const handle of scene.bodies) {
      if (handle.id !== "saturn") expect(handle.ring).toBeNull();
    }
  });

  it("draws one line per path, through the mapped points, and none for a body without a path", () => {
    const scene = build();
    const earth = handleFor(scene, "earth");
    const orbit = earth.orbit;
    if (orbit === null) throw new Error("the Earth has no orbit line");
    const positions = orbit.geometry.getAttribute("position");
    expect(positions.count).toBe(5);
    const first = scenePosition([1, 0, 0], "readable");
    expect(positions.getX(0)).toBeCloseTo(first[0], 5);
    expect(positions.getY(0)).toBeCloseTo(first[1], 5);
    expect(positions.getZ(0)).toBeCloseTo(first[2], 5);
    expect(handleFor(scene, "moon").orbit).toBeNull();
  });

  it("answers a fit radius that holds the farthest body and the farthest path", () => {
    const scene = build();
    const saturn = readableDistanceUnits(9.5);
    expect(sceneFitRadius(scene)).toBeGreaterThanOrEqual(saturn);
    // The paths are what frames the system: 9.5 au of Saturn against 1 au of
    // Earth, so the radius is the former and not the latter.
    expect(sceneFitRadius(scene)).toBeLessThan(
      saturn + handleFor(scene, "saturn").mesh.scale.x + 1e-6,
    );
  });

  it("reads the palette into the materials, with the Sun unlit", () => {
    const scene = build();
    const earth = handleFor(scene, "earth");
    const sun = handleFor(scene, "sun");
    expect(earth.mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((earth.mesh.material as THREE.MeshStandardMaterial).map).toBeNull();
    expect(toneOf(earth.mesh.material as THREE.Material)).toBe(
      new THREE.Color(PALETTE.body).getHexString(),
    );
    // A lit Sun would be lit from inside itself and read as a grey ball.
    expect(sun.mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(toneOf(sun.mesh.material as THREE.Material)).toBe(
      new THREE.Color(PALETTE.sun).getHexString(),
    );
  });
});

describe("textures in the graph", () => {
  it("puts each loaded map on the material that asked for it, and tracks it", () => {
    const resources = new SceneResources();
    const day = resources.track(new THREE.Texture());
    const rings = resources.track(new THREE.Texture());
    const scene = build({
      resources,
      textures: { earth: { day, night: null, rings: null }, saturn: { day: null, night: null, rings } },
    });
    const earth = handleFor(scene, "earth");
    const saturn = handleFor(scene, "saturn");
    expect((earth.mesh.material as THREE.MeshStandardMaterial).map).toBe(day);
    expect((saturn.ring?.material as THREE.MeshBasicMaterial).map).toBe(rings);
    // A textured body is drawn at the map's own tones, not multiplied by a grey.
    expect(toneOf(earth.mesh.material as THREE.Material)).toBe("ffffff");
    expect(resources.has(day)).toBe(true);
    expect(resources.has(rings)).toBe(true);
  });

  it("falls back to the token tone when an image never arrives", () => {
    const resources = new SceneResources();
    const day = resources.track(new THREE.Texture());
    const rings = resources.track(new THREE.Texture());
    const scene = build({
      resources,
      textures: { earth: { day, night: null, rings: null }, saturn: { day: null, night: null, rings } },
    });
    dropTexture(scene, "earth", "day");
    const earth = handleFor(scene, "earth");
    expect((earth.mesh.material as THREE.MeshStandardMaterial).map).toBeNull();
    expect(toneOf(earth.mesh.material as THREE.Material)).toBe(
      new THREE.Color(PALETTE.body).getHexString(),
    );
    dropTexture(scene, "saturn", "rings");
    const saturnRing = handleFor(scene, "saturn").ring;
    if (saturnRing === null) throw new Error("Saturn has no ring");
    expect((saturnRing.material as THREE.MeshBasicMaterial).map).toBeNull();
    expect(toneOf(saturnRing.material as THREE.Material)).toBe(
      new THREE.Color(PALETTE.rings).getHexString(),
    );
  });
});

describe("updates", () => {
  it("moves and turns the bodies for a new snapshot without rebuilding the graph", () => {
    const scene = build();
    const before = scene.bodies;
    applySnapshot(scene, {
      instantMs: 1,
      bodies: [
        body("sun", [0, 0, 0], 696_000),
        body("earth", [0, 0, 1], 6371, 90),
        body("moon", [0.00257, 0, 1], 1737.4),
        body("saturn", [0, 9.5, 0], 60_268),
      ],
    });
    expect(scene.bodies).toBe(before);
    const earth = handleFor(scene, "earth");
    expect(earth.group.position.z).toBeCloseTo(readableDistanceUnits(1), 10);
    expect(earth.group.position.x).toBeCloseTo(0, 12);
    expect(earth.spin.rotation.y).toBeCloseTo(90 * DEG, 12);
  });

  it("marks a selection on the orbit line and nowhere else", () => {
    const scene = build();
    applySelection(scene, "saturn");
    const saturn = handleFor(scene, "saturn").orbit?.material as THREE.LineBasicMaterial;
    const earth = handleFor(scene, "earth").orbit?.material as THREE.LineBasicMaterial;
    expect(scene.selected).toBe("saturn");
    expect(saturn.color.getHexString()).toBe(new THREE.Color(PALETTE.orbitSelected).getHexString());
    expect(saturn.opacity).toBe(PALETTE.orbitSelectedOpacity);
    expect(earth.color.getHexString()).toBe(new THREE.Color(PALETTE.orbit).getHexString());
    expect(earth.opacity).toBe(PALETTE.orbitOpacity);
    expect(toneOf(handleFor(scene, "saturn").mesh.material as THREE.Material)).toBe(
      new THREE.Color(PALETTE.body).getHexString(),
    );
  });

  it("repaints for another theme in place, leaving a texture where it is", () => {
    const resources = new SceneResources();
    const day = resources.track(new THREE.Texture());
    const scene = build({ resources, textures: { earth: { day, night: null, rings: null } } });
    const night = solarPalette("noc");
    applyPalette(scene, night);
    expect(scene.palette).toBe(night);
    expect(toneOf(handleFor(scene, "moon").mesh.material as THREE.Material)).toBe(
      new THREE.Color(night.body).getHexString(),
    );
    expect(toneOf(handleFor(scene, "sun").mesh.material as THREE.Material)).toBe(
      new THREE.Color(night.sun).getHexString(),
    );
    // The textured Earth keeps its map, so its tone must stay a multiplier of one.
    expect(toneOf(handleFor(scene, "earth").mesh.material as THREE.Material)).toBe("ffffff");
  });
});

describe("disposal", () => {
  it("tracks every geometry, material and texture the graph holds, and no others", () => {
    const resources = new SceneResources();
    const day = resources.track(new THREE.Texture());
    const rings = resources.track(new THREE.Texture());
    const scene = build({
      resources,
      textures: { earth: { day, night: null, rings: null }, saturn: { day: null, night: null, rings } },
    });
    const found = collect(scene);
    for (const item of found) expect(resources.has(item)).toBe(true);
    expect(resources.size).toBe(found.length);
  });

  it("disposes each allocation exactly once, and a second time not at all", () => {
    const scene = build();
    const items = collect(scene);
    const spies = items.map((item) => vi.spyOn(item, "dispose"));
    scene.resources.disposeAll();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    scene.resources.disposeAll();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(scene.resources.size).toBe(0);
  });
});

describe("orientationFor", () => {
  it("is the identity for a pole that is already +Y, and a NaN-free identity for none", () => {
    expect(orientationFor([0, 1, 0]).w).toBe(1);
    expect(orientationFor([0, 0, 0]).w).toBe(1);
  });

  it("turns +Y onto the pole it was handed", () => {
    const pole: Vector3 = [1, 0, 0];
    const turned = new THREE.Vector3(0, 1, 0).applyQuaternion(orientationFor(pole));
    expect(turned.x).toBeCloseTo(1, 12);
    expect(turned.y).toBeCloseTo(0, 12);
    expect(turned.z).toBeCloseTo(0, 12);
  });
});

describe("mapRingUv", () => {
  it("maps a ring's planar UVs onto the strip a ring image is", () => {
    // Eight segments, one radial step: vertex 0 is the inner edge at angle 0,
    // vertex 1 is the inner edge a segment round, and vertex 9 is the outer edge
    // back at angle 0. Six digits rather than twelve: the radius of a vertex on a
    // circle is `hypot` of two sines and cosines, so the inner edge's `u` is zero
    // to within 2 × 10⁻⁸ rather than exactly.
    const geometry = new THREE.RingGeometry(1, 2, 8, 1);
    mapRingUv(geometry, 1, 2);
    const uv = geometry.getAttribute("uv");
    expect(uv.getX(0)).toBeCloseTo(0, 6);
    expect(uv.getY(0)).toBeCloseTo(0, 6);
    expect(uv.getX(1)).toBeCloseTo(0, 6);
    expect(uv.getY(1)).toBeCloseTo(1 / 8, 6);
    expect(uv.getX(9)).toBeCloseTo(1, 6);
    expect(uv.getY(9)).toBeCloseTo(0, 6);
    // The segment before the seam wraps to just under one rather than to a
    // negative angle.
    expect(uv.getY(7)).toBeCloseTo(7 / 8, 6);
  });
});
