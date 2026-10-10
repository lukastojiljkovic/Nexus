import * as THREE from "three";

/**
 * The Earth's night side, as a shader injected into its own standard material.
 *
 * **The gap this closes.** Before this, Earth carried a `MeshStandardMaterial`
 * with the pack's day map and no terminator of its own: the point light at the
 * Sun left its night hemisphere at the ambient floor, so the globe showed one
 * texture and a hard-ish shadow rather than a day side and a night side. The
 * pack ships a night map (NASA's Black Marble — the same city lights the
 * day-and-night map already draws) and `textures.ts` declared it without ever
 * loading it, because nothing drew it.
 *
 * **Why it is an injection and not a `ShaderMaterial`.** A second material type
 * would have to re-derive the standard lighting, the tone mapping and the
 * colour handling this product already relies on, and the graph's own tests
 * read the Earth's material as the standard one it is. `onBeforeCompile` keeps
 * every one of those and adds exactly one thing: the city lights of the pack's
 * night map, weighted to the hemisphere facing away from the Sun.
 *
 * **Where the Sun is, without a light lookup.** The scene's single `PointLight`
 * sits at the world origin and is never moved, so the direction from a fragment
 * to the Sun is `normalize(-worldPosition)`. The vertex stage passes the world
 * position and the world normal; the fragment stage blends the night map in as
 * `emissive`, which is added AFTER lighting and therefore draws at full
 * strength on a hemisphere the light does not reach. The blend is a smoothstep
 * of ±0.08 in the cosine, which is about a four-and-a-half-degree band around
 * the terminator — a soft edge rather than a hard line, and narrow enough to
 * read as the terminator rather than as a vignette.
 *
 * **The uniforms are shared by identity.** They live in `material.userData`,
 * so `setEarthNightTexture` and `setEarthNightTone` mutate the same objects
 * `onBeforeCompile` handed to the program: a texture that arrives late, or a
 * theme switch, is a `value` write and never a recompile.
 */

/** The `userData` key the shared uniform objects hang under. */
export const EARTH_NIGHT_KEY = "nxEarthNight";

/** The three uniform names the injected GLSL declares. */
export const NIGHT_MAP_UNIFORM = "nxNightMap";
export const NIGHT_TONE_UNIFORM = "nxNightTone";
export const NIGHT_MIX_UNIFORM = "nxNightMix";

/** The half-width, in the cosine of the sun angle, of the terminator's soft edge. */
export const NIGHT_TERMINATOR_HALF_WIDTH = 0.08;

export interface EarthNightUniforms {
  readonly nxNightMap: { value: THREE.Texture | null };
  readonly nxNightTone: { value: THREE.Color };
  /** 1 when a night map is in use, 0 when it is missing or failed: one multiply. */
  readonly nxNightMix: { value: number };
}

interface EarthNightMaterial extends THREE.MeshStandardMaterial {
  userData: { nxEarthNight?: EarthNightUniforms };
}

/** The uniforms a material has already been given, or `undefined` when it never was. */
function uniformsOf(material: THREE.MeshStandardMaterial): EarthNightUniforms | undefined {
  return (material as EarthNightMaterial).userData[EARTH_NIGHT_KEY];
}

/**
 * Wires the terminator into one Earth material, with the night map the pack
 * supplied or none.
 *
 * Idempotent in the sense that matters: calling it again with another map writes
 * the same uniform objects, so a rebuild that reloads the pack does not need the
 * graph torn down.
 */
export function installEarthNight(
  material: THREE.MeshStandardMaterial,
  night: THREE.Texture | null,
  tone: string,
): void {
  const uniforms: EarthNightUniforms = {
    [NIGHT_MAP_UNIFORM]: { value: night },
    [NIGHT_TONE_UNIFORM]: { value: new THREE.Color(tone) },
    [NIGHT_MIX_UNIFORM]: { value: night === null ? 0 : 1 },
  };
  (material as EarthNightMaterial).userData[EARTH_NIGHT_KEY] = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 nxWorldNormal;
varying vec3 nxWorldPos;
varying vec2 nxNightUv;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
nxWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
nxWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
nxNightUv = uv;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 nxWorldNormal;
varying vec3 nxWorldPos;
varying vec2 nxNightUv;
uniform sampler2D ${NIGHT_MAP_UNIFORM};
uniform vec3 ${NIGHT_TONE_UNIFORM};
uniform float ${NIGHT_MIX_UNIFORM};`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  // The Sun is the world origin and never moves (see the header).
  float nxLit = dot(normalize(nxWorldNormal), normalize(-nxWorldPos));
  float nxNight = 1.0 - smoothstep(-${NIGHT_TERMINATOR_HALF_WIDTH.toFixed(2)}, ${NIGHT_TERMINATOR_HALF_WIDTH.toFixed(2)}, nxLit);
  vec3 nxLights = texture2D(${NIGHT_MAP_UNIFORM}, nxNightUv).rgb;
  totalEmissiveRadiance += nxLights * nxNight * ${NIGHT_MIX_UNIFORM} * ${NIGHT_TONE_UNIFORM};
}`,
      );
  };
  // The key is what makes three compile a program for THIS material: without it
  // a material that had already been compiled would keep its old program.
  material.customProgramCacheKey = () => `nx-earth-night:${String(night !== null)}`;
  material.needsUpdate = true;
}

/** Points the material at another night map, or at none. A `value` write, never a recompile. */
export function setEarthNightTexture(
  material: THREE.MeshStandardMaterial,
  night: THREE.Texture | null,
): void {
  const uniforms = uniformsOf(material);
  if (uniforms === undefined) return;
  uniforms.nxNightMap.value = night;
  uniforms.nxNightMix.value = night === null ? 0 : 1;
}

/** The tint the city lights are drawn at — the palette's own tone, so a theme switch reaches them. */
export function setEarthNightTone(material: THREE.MeshStandardMaterial, tone: string): void {
  const uniforms = uniformsOf(material);
  if (uniforms === undefined) return;
  uniforms.nxNightTone.value.set(tone);
}

/** Whether this material has the terminator wired in — what the scene's tests ask. */
export function hasEarthNight(material: THREE.MeshStandardMaterial): boolean {
  return uniformsOf(material) !== undefined;
}
