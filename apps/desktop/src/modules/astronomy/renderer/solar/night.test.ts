import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { solarPalette } from "./palette.js";
import {
  EARTH_NIGHT_KEY,
  NIGHT_MAP_UNIFORM,
  NIGHT_MIX_UNIFORM,
  NIGHT_TONE_UNIFORM,
  hasEarthNight,
  installEarthNight,
  setEarthNightTexture,
  setEarthNightTone,
  type EarthNightUniforms,
} from "./night.js";

/**
 * The Earth's night side.
 *
 * The shading itself needs a GL context, which this repository's tests have no
 * way to provide — so what is pinned here is the WIRING, which is the half a
 * mistake would hide in: that the hook exists, that it hands the program the
 * three uniforms the injected GLSL names, that the injected code samples the
 * night map with a varying of its OWN (never the day map's, whose define comes
 * and goes with that image), and that a missing or failed night map is one
 * uniform write rather than a recompile.
 */

interface StubShader {
  uniforms: Record<string, unknown>;
  vertexShader: string;
  fragmentShader: string;
}

/**
 * The tone the terminator is installed with, taken from the palette the scene
 * itself hands it. A literal here would be the one raw colour in the renderer,
 * which `no-restricted-syntax` and `check:colours` both refuse; more to the
 * point, the two themes' accents are what the assertions are about.
 */
const DAN_TONE = solarPalette("dan").nightLights;
const NOC_TONE = solarPalette("noc").nightLights;

/** Runs the material's own hook against a shader shaped like three's. */
function compiled(material: THREE.MeshStandardMaterial): StubShader {
  const shader: StubShader = {
    uniforms: {},
    vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
    fragmentShader: "#include <common>\nvoid main() {\n#include <emissivemap_fragment>\n}",
  };
  const hook = material.onBeforeCompile as unknown as (shader: StubShader) => void;
  hook(shader);
  return shader;
}

function uniformsOf(material: THREE.MeshStandardMaterial): EarthNightUniforms {
  const uniforms = (material.userData as { [EARTH_NIGHT_KEY]?: EarthNightUniforms })[
    EARTH_NIGHT_KEY
  ];
  if (uniforms === undefined) throw new Error("the terminator was never installed");
  return uniforms;
}

describe("installEarthNight", () => {
  it("declares the three uniforms and hands them to the program", () => {
    const material = new THREE.MeshStandardMaterial();
    const night = new THREE.Texture();
    installEarthNight(material, night, DAN_TONE);
    expect(hasEarthNight(material)).toBe(true);

    const shader = compiled(material);
    expect(shader.fragmentShader).toContain(`uniform sampler2D ${NIGHT_MAP_UNIFORM};`);
    expect(shader.fragmentShader).toContain(`uniform vec3 ${NIGHT_TONE_UNIFORM};`);
    expect(shader.fragmentShader).toContain(`uniform float ${NIGHT_MIX_UNIFORM};`);
    for (const name of [NIGHT_MAP_UNIFORM, NIGHT_TONE_UNIFORM, NIGHT_MIX_UNIFORM]) {
      expect(shader.uniforms[name], name).toBeDefined();
    }
    // The uniforms the program reads are the objects the setters mutate.
    expect(shader.uniforms[NIGHT_MAP_UNIFORM]).toBe(uniformsOf(material).nxNightMap);
    expect(shader.uniforms[NIGHT_MIX_UNIFORM]).toBe(uniformsOf(material).nxNightMix);
  });

  it("passes the world position and normal to the fragment stage", () => {
    const material = new THREE.MeshStandardMaterial();
    installEarthNight(material, new THREE.Texture(), DAN_TONE);
    const shader = compiled(material);
    expect(shader.vertexShader).toContain("nxWorldNormal");
    expect(shader.vertexShader).toContain("nxWorldPos");
    expect(shader.vertexShader).toContain("objectNormal");
    // The terminator: the fragment measures its own angle to the world origin,
    // which is where the view's one light sits, and adds the night map to the
    // emissive term — the only term lighting does not multiply down.
    expect(shader.fragmentShader).toContain("totalEmissiveRadiance");
    expect(shader.fragmentShader).toContain("normalize(-nxWorldPos)");
    // It never reaches for the DAY map's varying, so a day image that failed to
    // load — which removes that define and recompiles — cannot break this chunk.
    expect(shader.fragmentShader).not.toContain("vMapUv");
    expect(shader.vertexShader).not.toContain("vMapUv");
  });

  it("makes the program key depend on whether a night map is in use", () => {
    const withMap = new THREE.MeshStandardMaterial();
    installEarthNight(withMap, new THREE.Texture(), DAN_TONE);
    expect(withMap.customProgramCacheKey()).toBe("nx-earth-night:true");
    const without = new THREE.MeshStandardMaterial();
    installEarthNight(without, null, DAN_TONE);
    expect(without.customProgramCacheKey()).toBe("nx-earth-night:false");
    expect(uniformsOf(without).nxNightMix.value).toBe(0);
  });
});

describe("the terminator's uniform writes", () => {
  it("turns the night lights off when the map goes away, and on when one arrives", () => {
    const material = new THREE.MeshStandardMaterial();
    installEarthNight(material, new THREE.Texture(), DAN_TONE);
    expect(uniformsOf(material).nxNightMix.value).toBe(1);
    setEarthNightTexture(material, null);
    expect(uniformsOf(material).nxNightMap.value).toBeNull();
    expect(uniformsOf(material).nxNightMix.value).toBe(0);
    const again = new THREE.Texture();
    setEarthNightTexture(material, again);
    expect(uniformsOf(material).nxNightMap.value).toBe(again);
    expect(uniformsOf(material).nxNightMix.value).toBe(1);
  });

  it("tints the lights with the palette's own tone, so a theme switch reaches them", () => {
    const material = new THREE.MeshStandardMaterial();
    installEarthNight(material, new THREE.Texture(), DAN_TONE);
    setEarthNightTone(material, NOC_TONE);
    expect(uniformsOf(material).nxNightTone.value.getHexString()).toBe(
      new THREE.Color(NOC_TONE).getHexString(),
    );
  });

  it("is a no-op on a material that never had the terminator", () => {
    const plain = new THREE.MeshStandardMaterial();
    expect(hasEarthNight(plain)).toBe(false);
    setEarthNightTexture(plain, new THREE.Texture());
    setEarthNightTone(plain, NOC_TONE);
    expect(hasEarthNight(plain)).toBe(false);
  });
});
