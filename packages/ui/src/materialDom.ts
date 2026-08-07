/**
 * The DOM half of the material layer. Split from `material.ts` so the
 * generators stay testable under Node with no canvas, and so this file — the
 * only part that touches a document — is small enough to read in one sitting.
 */
import { themes } from "@nexus/tokens";
import { GRAIN_TILE, grainTileBytes } from "./material.js";

/** The custom property a theme's grain tile is published under. */
export function grainVar(theme: string): string {
  return `--nx-material-grain-${theme}`;
}

const cache = new Map<number, string>();

/**
 * Bake one grain tile at the given peak alpha and return it as a `url(...)`.
 *
 * WHY AN ALPHA PER TILE, rather than one tile dimmed by CSS `opacity`. The
 * grain is applied as a BACKGROUND LAYER on the scrolling pane, not as an
 * overlay element — and that is forced, not stylistic. The scrolling pane must
 * paint its own opaque background (a deliberate Chromium repaint fix), and an
 * absolutely-positioned overlay inside a scroll container resolves `inset: 0`
 * against the scrollport while still scrolling with the content: it would
 * texture the first screenful and then slide away. A background layer sits
 * correctly under the whole pane and costs a compositor blit. Background layers
 * have no independent opacity, so amplitude has to be baked in — hence one tile
 * per theme, both baked once at startup and cached here.
 */
export function bakeGrain(alpha: number): string | null {
  const cached = cache.get(alpha);
  if (cached !== undefined) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = GRAIN_TILE;
  canvas.height = GRAIN_TILE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  const image = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  image.data.set(grainTileBytes(alpha));
  ctx.putImageData(image, 0, 0);
  const value = `url(${canvas.toDataURL("image/png")})`;
  cache.set(alpha, value);
  return value;
}

/**
 * Publish every theme's grain tile on the document root.
 *
 * Both themes are baked up front — roughly 25 ms each, once, before first paint
 * — so that flipping the theme is a variable swap and never a re-bake stall on
 * the frame the user flips it. The amplitudes come from the themes' own
 * `materialGrainAlpha` tokens, so the texture stays as governed as every colour
 * in the product: one edit in `packages/tokens`, no code change.
 *
 * Doing nothing when the canvas is unavailable is correct and is not a
 * swallowed error: the grain is ornament with no semantic role, the app is
 * fully usable without it, and there is no action a user could take in response
 * to being told a 2D context could not be created.
 */
export function installGrain(root: HTMLElement | null = null): void {
  const target = root ?? document.documentElement;
  for (const [theme, tokens] of Object.entries(themes)) {
    const alpha = Number.parseFloat(tokens.materialGrainAlpha);
    if (!Number.isFinite(alpha) || alpha <= 0) continue;
    const value = bakeGrain(alpha);
    if (value !== null) target.style.setProperty(grainVar(theme), value);
  }
}
