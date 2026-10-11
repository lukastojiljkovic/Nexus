import { ACCENT_IDS, accents, themes, type ThemeName } from "@nexus/tokens";
import { GERBER_ROLES, type GerberRole } from "@nexus/core";

/**
 * Every colour this module puts on a workbench, read from `@nexus/tokens`.
 *
 * **Why the values come from the tokens package and not from CSS.** Two of this
 * module's surfaces are not CSS at all: a three.js scene takes colour VALUES (a
 * material's `color` is an object, a `GridHelper`'s is one too), and a Gerber
 * layer's SVG is shown through an `<img>` built from a Blob URL, which is a
 * document of its own and cannot inherit a custom property from the page. Both
 * need a concrete string, and the token package is where a concrete colour is
 * allowed to live - `canvasPalette.ts` reads the same values for the same
 * reason.
 *
 * **Why the palette is the THEME's, and not one dark bench for both.** The
 * electronics workbench is dark in Dan as well, because a breadboard's nine wire
 * hues cannot all clear contrast on warm paper (`electronics.css` argues it, and
 * `check:elec` keeps that exemption inside that one surface). This module draws
 * no wire colours: a 3D part and a toolpath need an INK, and a board's layers
 * need several hues chosen for the surface they sit on. The theme's own semantic
 * tokens - its sunken surface, its borders, its data green - are exactly that,
 * and the eight accents are the one palette the design system publishes for
 * "several hues side by side, legible on this theme's background". So the bench
 * follows the theme, and the module stays inside DEV-006's scope: it reads no
 * `--nx-elec-*` token outside the electrician's own canvas.
 *
 * **The order of the layer colours is fixed, and the cycle is deliberate.** The
 * roles run copper, copper, inner, mask, mask, silk, silk, paste, paste, outline,
 * drill, other - so the TOP and the BOTTOM of one function are always
 * neighbouring colours and never the same one, which is the pair a viewer is
 * most often asked to tell apart. Two roles eight apart do share a hue, and a
 * layer's chip carries its own name and its own colour swatch; that is the
 * smaller lie compared with a ninth hue the design system does not define.
 */

/** One role's colour: the accents in their published order, by the role's own position. */
export function layerColour(role: GerberRole, theme: ThemeName | null = activeTheme()): string {
  const index = GERBER_ROLES.indexOf(role);
  const accent = ACCENT_IDS[(index < 0 ? 0 : index) % ACCENT_IDS.length] as keyof typeof accents.dan;
  return accents[theme ?? "dan"][accent].accent;
}

/**
 * What a 3D viewport is painted with.
 *
 * No background: the canvas is transparent and the element behind it wears
 * `--nx-surface-sunken`, so that colour has one source rather than two which
 * agree until somebody edits one of them.
 */
export interface ViewerColours {
  readonly grid: string;
  readonly gridStrong: string;
  readonly model: string;
  readonly edges: string;
  readonly extrusion: string;
  readonly travel: string;
  /** The light the bench is lit by, which is the theme's own paper rather than a white somebody typed. */
  readonly light: string;
}

/**
 * The active theme's bench colours.
 *
 * The theme is read from `<html data-theme>`, which `theme.ts` writes and the
 * whole app's CSS already keys off; a document that has not been told yet is
 * Dan, this app's light theme and the one that renders first. Defaulting to a
 * THEME rather than to a hard-coded colour is the point: no branch here can
 * produce a value the tokens do not define.
 */
export function viewerColours(theme: ThemeName | null = activeTheme()): ViewerColours {
  const tokens = themes[theme ?? "dan"];
  return {
    grid: tokens.border,
    gridStrong: tokens.textFaint,
    model: tokens.text,
    edges: tokens.textMuted,
    extrusion: tokens.data,
    travel: tokens.textFaint,
    light: tokens.surface,
  };
}

/** The theme the document is in, or `null` when nothing has set one yet. */
export function activeTheme(): ThemeName | null {
  const value = document.documentElement.dataset.theme;
  return value === "dan" || value === "noc" ? value : null;
}

/**
 * One layer's SVG with the layer's colour put on its root element.
 *
 * **Why the colour has to be written INTO the markup.** `gerber-to-svg` paints
 * every shape in `currentColor`, and a document shown through an `<img>` is a
 * document of its own: it inherits nothing from the page, so a colour set on the
 * `<img>` or on its wrapper reaches none of the shapes. The one place the colour
 * can be set is the SVG's own root, which is what this does.
 *
 * **Why this is not an injection.** The value written is a token this module
 * read from `@nexus/tokens` and never anything from the file; the insertion is
 * one attribute on the root tag the library itself emitted. A string that is not
 * an SVG element is answered unchanged, because a helper that guessed at
 * somebody else's markup is how a viewer starts editing documents it was only
 * asked to show.
 */
export function withLayerColour(svg: string, colour: string): string {
  if (!svg.startsWith("<svg")) return svg;
  const end = svg.indexOf(">");
  if (end < 0) return svg;
  return `${svg.slice(0, end)} style="color: ${colour}"${svg.slice(end)}`;
}
