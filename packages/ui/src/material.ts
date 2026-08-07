/**
 * Noć's sky, generated rather than shipped. Nothing is downloaded, nothing is
 * licensed, and no image file enters the repo.
 *
 * A paper-grain substrate for Dan lived here briefly and was removed (founder,
 * 2026-08-07: „taj papir kao pozadinu necemo"). The principle behind that call
 * is worth keeping: texture behind content competes with the content, and this
 * product's graphics budget belongs to the DATA. The sky survives only because
 * it is confined to chrome that carries no data — the sidebar and the lock
 * screen — and because it is what the theme's name is about.
 *
 * TWO RULES, and both decisions below follow from them.
 *
 * 1. NOTHING IS EVER COMPUTED PER FRAME. The sky is a coordinate LIST, painted
 *    once per resize; a full-viewport procedural filter would be a 100–300 ms
 *    main-thread rasterisation re-run on every frame of a window drag, scaling
 *    with the SQUARE of device pixel ratio. For the same reason nothing here
 *    relies on `background-attachment: fixed`, which forces a main-thread
 *    repaint on every scroll frame.
 *
 * 2. THE SKY IS THE SAME SKY EVERY TIME. It is chrome, not decoration; a
 *    constellation that rearranged itself on relaunch or on window resize
 *    would be a bug. Hence a seeded integer PRNG — never `Math.random`, and
 *    never the `Math.sin`-based hashes found in tutorials, since transcendental
 *    functions are implementation-varying and silently differ across platforms
 *    — and hence stars generated in FIXED WORLD COORDINATES and cropped to the
 *    viewport: resizing reveals or hides sky, and never moves a star that was
 *    already on screen.
 *
 * Colour is not decided here either. `StarField` reads its two values out of
 * the live cascade, so the sky follows whichever of the eight accents the user
 * picked, and no hex ever appears outside the token package.
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
