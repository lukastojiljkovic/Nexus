import { describe, expect, it } from "vitest";
import type { BodyId } from "@nexus/core";
import * as THREE from "three";

import { SceneResources } from "./resources.js";
import {
  configurePlanetTexture,
  loadPlanetTextures,
  type PlanetTextures,
  type PlanetTextureSlot,
  type TexturePort,
} from "./textures.js";

/**
 * The pack's layout into textures, with the loader stubbed.
 *
 * What is pinned here is what the browser would otherwise be the only judge of:
 * which image becomes which map, that every texture arrives in the colour space
 * a photograph needs, that the two wrap modes are the ones a globe needs, that a
 * body this contract does not know is ignored rather than fatal, and that each
 * texture lands on the dispose list.
 */

interface Call {
  readonly url: string;
  readonly onReady: () => void;
  readonly onFailed: () => void;
}

function stubPort(): { readonly port: TexturePort; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    port: {
      load: (url, onReady, onFailed) => {
        calls.push({ url, onReady, onFailed });
        return new THREE.Texture();
      },
    },
  };
}

const LAYOUT: PlanetTextures = {
  layout: 1,
  bodies: {
    earth: {
      day: "pack://planet-textures/images/earth-day.webp",
      night: "pack://planet-textures/images/earth-night.webp",
      credit: "NASA",
    },
    saturn: {
      day: "pack://planet-textures/images/saturn-day.webp",
      rings: "pack://planet-textures/images/saturn-rings.webp",
      credit: "Solar System Scope",
    },
  },
};

describe("configurePlanetTexture", () => {
  it("reads a photograph as sRGB and a globe as a repeat-and-clamp pair", () => {
    const texture = configurePlanetTexture(new THREE.Texture());
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });
});

describe("loadPlanetTextures", () => {
  it("loads nothing at all for no pack", () => {
    const { port, calls } = stubPort();
    expect(loadPlanetTextures(null, port, new SceneResources(), () => undefined, () => undefined)).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it("loads one texture per declared image, and tracks each of them", () => {
    const { port, calls } = stubPort();
    const resources = new SceneResources();
    const loaded = loadPlanetTextures(LAYOUT, port, resources, () => undefined, () => undefined);

    expect(calls.map((call) => call.url)).toEqual([
      "pack://planet-textures/images/earth-day.webp",
      "pack://planet-textures/images/saturn-day.webp",
      "pack://planet-textures/images/saturn-rings.webp",
    ]);
    expect(loaded.earth?.day).not.toBeNull();
    expect(loaded.earth?.rings).toBeNull();
    expect(loaded.saturn?.rings).not.toBeNull();
    expect(resources.size).toBe(3);
    expect(resources.has(loaded.earth?.day as THREE.Texture)).toBe(true);
    expect(resources.has(loaded.saturn?.rings as THREE.Texture)).toBe(true);
  });

  it("does not fetch Earth's night map, which nothing draws yet", () => {
    const { port, calls } = stubPort();
    loadPlanetTextures(LAYOUT, port, new SceneResources(), () => undefined, () => undefined);
    expect(calls.some((call) => call.url.includes("night"))).toBe(false);
  });

  it("ignores a body this contract does not know", () => {
    const { port, calls } = stubPort();
    const unknown = {
      layout: 1,
      bodies: { ...LAYOUT.bodies, ceres: { day: "pack://planet-textures/images/ceres.webp", credit: "NASA" } },
    } as PlanetTextures;
    loadPlanetTextures(unknown, port, new SceneResources(), () => undefined, () => undefined);
    expect(calls.map((call) => call.url)).not.toContain("pack://planet-textures/images/ceres.webp");
  });

  it("names the body and the slot back to its caller on load and on failure", () => {
    const { port, calls } = stubPort();
    const loaded: [BodyId, PlanetTextureSlot][] = [];
    const failed: [BodyId, PlanetTextureSlot][] = [];
    loadPlanetTextures(
      LAYOUT,
      port,
      new SceneResources(),
      (id, slot) => loaded.push([id, slot]),
      (id, slot) => failed.push([id, slot]),
    );
    for (const call of calls) call.onReady();
    expect(loaded).toEqual([
      ["earth", "day"],
      ["saturn", "day"],
      ["saturn", "rings"],
    ]);
    expect(failed).toEqual([]);
    const rings = calls[2];
    if (rings === undefined) throw new Error("the ring image was not requested");
    rings.onFailed();
    expect(failed).toEqual([["saturn", "rings"]]);
  });
});
