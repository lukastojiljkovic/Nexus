/**
 * The material layer — the app's two substrates, generated rather than shipped.
 *
 * Nexus's themes are called Dan and Noć and its accent is star-gold; the ground
 * under them was a flat fill in both. This module gives each theme the surface
 * its name already promised: paper fibre for Dan, a night sky for Noć. Nothing
 * is downloaded, nothing is licensed, and no image file enters the repo — both
 * materials are computed at startup from a seed.
 *
 * THREE RULES, and every decision below follows from them.
 *
 * 1. NOTHING IS EVER COMPUTED PER FRAME. A full-viewport `feTurbulence` is a
 *    ~100–300 ms main-thread rasterisation that Chromium re-runs on every frame
 *    of a window resize; that is a 5 fps drag, and it scales with the SQUARE of
 *    device pixel ratio. So: the grain is baked ONCE into a small tile and
 *    repeated by the compositor, and the sky is a coordinate LIST painted once.
 *    For the same reason nothing here uses `background-attachment: fixed`,
 *    which forces a main-thread repaint on every scroll frame.
 *
 * 2. NO COLOUR IS DECIDED HERE. Every value the app paints comes from a
 *    `--nx-*` token — that is a binding repo rule with its own gate. The grain
 *    tile is therefore written as ALPHA over neutral black and white: it
 *    modulates luminance and states no hue, so it composites correctly over
 *    whatever `--nx-bg` happens to be, in either theme, under any of the eight
 *    accents. The sky reads its colours out of the live cascade
 *    (`getComputedStyle`), so it follows the user's accent choice for free.
 *    Note this is not merely gate-compliance: a token-coloured CSS variable
 *    cannot reach INTO an SVG-as-image or a data URI — those are sealed
 *    documents — so „assets carry no colour" is the only pattern that stays
 *    correct when the theme changes.
 *
 * 3. THE SKY IS THE SAME SKY EVERY TIME. It is chrome, not decoration; a
 *    constellation that rearranged itself on relaunch or on window resize
 *    would be a bug. Hence a seeded integer PRNG (never `Math.random`, and
 *    never the `Math.sin`-based hashes found in tutorials — transcendental
 *    functions are implementation-varying and silently differ across
 *    platforms), and hence stars generated in FIXED WORLD COORDINATES and
 *    cropped to the viewport: resizing reveals or hides sky, and never moves a
 *    star that was already on screen.
 *
 * What is deliberately NOT here: foil sheen and laid/chain lines. Simulated
 * foil is the warm-paper equivalent of the glass cliché this design set out to
 * avoid, and it would undercut the one identity move the product already makes
 * well — gold as typography, no fill, no glow. Laid lines at UI scale read as
 * banding or a dirty panel rather than as paper. Both were cut on purpose.
 */

/**
 * mulberry32 — 32-bit state, pure integer ops, five lines, bit-identical on
 * every platform and every engine. The whole determinism guarantee rests on
 * this being integer arithmetic: `Math.random` has no seed, and `Math.sin`
 * hashes are not portable.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Periodic value noise on an N×N lattice. The lattice indices wrap modulo N,
 * which is what makes the baked tile seamless: the right edge interpolates back
 * into the left edge by construction rather than by luck. Plain white noise
 * would also tile without a seam (it has no spatial correlation to break) but
 * reads as television static; paper fibre needs the low-frequency clumping this
 * provides.
 */
function periodicValueNoise(lattice: readonly number[], n: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  // Smoothstep, so cell boundaries carry no visible gradient discontinuity.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const ix0 = ((x0 % n) + n) % n;
  const iy0 = ((y0 % n) + n) % n;
  const ix1 = (ix0 + 1) % n;
  const iy1 = (iy0 + 1) % n;
  const v00 = lattice[iy0 * n + ix0] ?? 0;
  const v10 = lattice[iy0 * n + ix1] ?? 0;
  const v01 = lattice[iy1 * n + ix0] ?? 0;
  const v11 = lattice[iy1 * n + ix1] ?? 0;
  const top = v00 + (v10 - v00) * sx;
  const bottom = v01 + (v11 - v01) * sx;
  return top + (bottom - top) * sy;
}

/** Grain tile edge, in CSS px. 256 is ample for fibre-scale detail. */
export const GRAIN_TILE = 256;

/**
 * The RGBA bytes of one seamless grain tile.
 *
 * Split out from the canvas work so it is testable in Node with no DOM, and so
 * the determinism claim is checkable against DATA rather than against
 * antialiased pixels — raster output legitimately varies across GPUs, which
 * would make a screenshot test flaky by construction.
 *
 * `alpha` is the peak opacity, and comes from `--nx-material-grain-alpha` so
 * the amplitude is a token like everything else. It is kept low deliberately:
 * texture that darkens muted text would eat into the contrast margin the
 * palette only just earns (`scripts/check-contrast.mjs`).
 */
export function grainTileBytes(alpha: number, size = GRAIN_TILE, seed = 0x6e657875): Uint8ClampedArray {
  const rand = mulberry32(seed);
  // Two octaves: 16 cells across for fibre clumps, 64 for the finer weave.
  const coarseN = 16;
  const fineN = 64;
  const coarse = Array.from({ length: coarseN * coarseN }, () => rand());
  const fine = Array.from({ length: fineN * fineN }, () => rand());

  const bytes = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const c = periodicValueNoise(coarse, coarseN, (x / size) * coarseN, (y / size) * coarseN);
      const f = periodicValueNoise(fine, fineN, (x / size) * fineN, (y / size) * fineN);
      // White noise on top of the two octaves is what stops the result reading
      // as a soft blur; the octaves supply structure, this supplies tooth.
      const speck = rand();
      const v = c * 0.45 + f * 0.35 + speck * 0.2;
      // Centre on 0: above the midpoint lightens, below darkens. A paper fibre
      // catches light on one side and shades on the other, so a single signed
      // field gives both without a second layer.
      const signed = v - 0.5;
      const index = (y * size + x) * 4;
      const light = signed > 0;
      const level = light ? 255 : 0;
      bytes[index] = level;
      bytes[index + 1] = level;
      bytes[index + 2] = level;
      bytes[index + 3] = Math.round(Math.abs(signed) * 2 * alpha * 255);
    }
  }
  return bytes;
}

/** One star, in fixed world coordinates. */
export interface Star {
  x: number;
  y: number;
  /** Radius in CSS px. */
  r: number;
  /** 0…1. Drives alpha, and selects the accent tier at the top end. */
  brightness: number;
}

/**
 * The canonical sky, in a fixed world box. Cropping this to the viewport is
 * what makes a resize reveal sky rather than rearrange it.
 *
 * Brightness is skewed hard toward the faint end (the fourth power) because a
 * uniform distribution reads as scattered dots; a real sky is mostly very faint
 * with a few carriers, and that asymmetry is what makes it legible as a sky at
 * 2% opacity.
 */
export const SKY_WORLD = { width: 3840, height: 2160 } as const;

export function starField(
  count = 420,
  seed = 0x76657370,
  world: { width: number; height: number } = SKY_WORLD,
): Star[] {
  const rand = mulberry32(seed);
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    const brightness = rand() ** 4;
    stars.push({
      x: rand() * world.width,
      y: rand() * world.height,
      r: 0.5 + brightness * 1.1,
      brightness,
    });
  }
  return stars;
}
