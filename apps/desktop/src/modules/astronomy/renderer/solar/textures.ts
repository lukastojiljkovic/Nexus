import type { BodyId } from "@nexus/core";
import * as THREE from "three";

import { BODY_ORDER } from "./bodies.js";
import type { SceneResources } from "./resources.js";

/**
 * The texture pack's layout, as the view reads it, and the one place images turn
 * into three.js textures.
 *
 * **`PlanetTextures` is the pack's `textures.json`, field for field** — layout 1,
 * one entry per body, relative image paths as the page resolved them to URLs, and
 * the body's credit line — because a second shape for the same file is a second
 * thing to keep in step with the pack builder. The `credit` is what the module's
 * attribution line shows; this view never draws it.
 *
 * **The loader is a port.** `TextureLoader` reaches for an `Image`, which exists
 * only in a browser, so the component injects it and the tests inject a stub.
 * That is what lets the mapping — which body gets which map, how each texture is
 * configured, and that every one is on the dispose list — be tested in Node.
 *
 * **Earth's night map is not loaded, on purpose.** The pack ships it and the
 * layout above carries it, but nothing in the graph consumes it: drawing city
 * lights only on the dark side is a shader, not a material property, and a
 * `MeshStandardMaterial`'s `emissiveMap` would light them on the day side too.
 * Fetching a megabyte the view has no place for would be a decision made by
 * omission, so the field is declared and the fetch is not made; the material
 * that wants it is where this constant's successor goes.
 */

export interface PlanetTextureSet {
  readonly day: string;
  /** Earth's city lights. Declared for the pack's layout; see the header. */
  readonly night?: string;
  readonly rings?: string;
  readonly credit: string;
}

export interface PlanetTextures {
  readonly layout: 1;
  readonly bodies: Readonly<Partial<Record<BodyId, PlanetTextureSet>>>;
}

/** The two images a body can be drawn with, once they are textures. */
export interface LoadedBodyTextures {
  readonly day: THREE.Texture | null;
  readonly rings: THREE.Texture | null;
}

export type LoadedTextures = Readonly<Partial<Record<BodyId, LoadedBodyTextures>>>;

/** Which image of a body a callback is about. */
export type PlanetTextureSlot = "day" | "rings";

/**
 * How an image becomes a texture. `TextureLoader.load` answers immediately with
 * an empty texture and fills it in later, which is why this returns rather than
 * awaits: the graph is built now and one frame is painted when the picture lands.
 */
export interface TexturePort {
  load(url: string, onReady: () => void, onFailed: () => void): THREE.Texture;
}

/**
 * The settings every equirectangular map needs.
 *
 * `SRGBColorSpace` is not a preference: the images are photographs, and a map
 * read as linear is the washed-out picture three.js is famous for. `wrapS`
 * repeats so the seam at longitude ±180° is continuous; `wrapT` clamps, because
 * there is nothing above the pole to repeat.
 */
export function configurePlanetTexture(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Every body's maps, in the contract's body order.
 *
 * A body the pack does not name is simply absent and is drawn in the neutral
 * tone — the same picture as a pack that is not installed at all, which is what
 * keeps a partial pack from being a special case. A body the pack names that this
 * contract does not know is ignored for the same reason in reverse: a newer
 * pack must not be able to break an older view.
 */
export function loadPlanetTextures(
  textures: PlanetTextures | null,
  port: TexturePort,
  resources: SceneResources,
  onLoaded: (id: BodyId, slot: PlanetTextureSlot) => void,
  onFailed: (id: BodyId, slot: PlanetTextureSlot) => void,
): LoadedTextures {
  const loaded: Partial<Record<BodyId, LoadedBodyTextures>> = {};
  if (textures === null) return loaded;
  for (const id of BODY_ORDER) {
    const set = textures.bodies[id];
    if (set === undefined) continue;
    loaded[id] = {
      day: loadOne(id, "day", set.day, port, resources, onLoaded, onFailed),
      rings:
        set.rings === undefined
          ? null
          : loadOne(id, "rings", set.rings, port, resources, onLoaded, onFailed),
    };
  }
  return loaded;
}

function loadOne(
  id: BodyId,
  slot: PlanetTextureSlot,
  url: string,
  port: TexturePort,
  resources: SceneResources,
  onLoaded: (id: BodyId, slot: PlanetTextureSlot) => void,
  onFailed: (id: BodyId, slot: PlanetTextureSlot) => void,
): THREE.Texture {
  const texture = port.load(
    url,
    () => {
      onLoaded(id, slot);
    },
    () => {
      onFailed(id, slot);
    },
  );
  return resources.track(configurePlanetTexture(texture));
}
