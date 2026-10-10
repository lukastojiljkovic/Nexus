import { themes, type ThemeName } from "@nexus/tokens";

/**
 * The five colours this view paints with, taken from `@nexus/tokens` and from
 * nowhere else.
 *
 * **Why not off the document.** `getComputedStyle` would give the ACTIVE theme
 * only, which is right until the moment a theme switch has to repaint a scene
 * that is already built — and a material's colour cannot be re-derived from CSS
 * after the fact. Reading both themes' values here means the switch is one
 * assignment per material, which `applyPalette` performs.
 *
 * **Why the Sun is `accentStrong` and not a hue of its own.** Noc's accent is
 * star-gold and Dan's is bronze, which is the closest this product's palette
 * comes to a sun; inventing a yellow would be the first raw colour in the
 * renderer and the first thing `check:colours` would refuse.
 *
 * **Why there is no `selected` colour.** Selection in this product is
 * typographic — accent text and weight, never a fill or a glow — and a mesh
 * painted a different colour is a fill. So the selected body is marked by its
 * LABEL turning accent and by its ORBIT line turning accent, and the two are the
 * same token so they cannot drift.
 */

export interface SolarPalette {
  /** The Sun's own disc, which is unlit: it is the light. */
  readonly sun: string;
  /** A body with no texture — a neutral tone, never a missing-colour black. */
  readonly body: string;
  /** An unselected orbit line. */
  readonly orbit: string;
  /** The orbit of the selected body. */
  readonly orbitSelected: string;
  /** Saturn's rings when no ring image is loaded. */
  readonly rings: string;
  /** Orbit lines are hairlines over a picture; they are drawn faint on purpose. */
  readonly orbitOpacity: number;
  /** The selected body's orbit, drawn legible. */
  readonly orbitSelectedOpacity: number;
}

export function solarPalette(theme: ThemeName): SolarPalette {
  const tokens = themes[theme];
  return {
    sun: tokens.accentStrong,
    body: tokens.textSubtle,
    orbit: tokens.textFaint,
    orbitSelected: tokens.accent,
    rings: tokens.textMuted,
    orbitOpacity: 0.5,
    orbitSelectedOpacity: 0.9,
  };
}
