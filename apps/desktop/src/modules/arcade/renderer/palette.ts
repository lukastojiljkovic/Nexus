import { ACCENT_IDS, accents, themes, type AccentId, type ThemeName } from "@nexus/tokens";

/**
 * Every colour a board is painted with, and the rule that governs all of them: a
 * value comes from `@nexus/tokens`, resolved for the theme that is actually on
 * screen, and a board never names a colour of its own.
 *
 * **Why the palette is read from the package rather than off the document.** The
 * CSS custom properties expose the ACTIVE theme only, and a board is repainted
 * from scratch on a theme switch, so a palette that read `--nx-*` once at mount
 * would keep painting the old theme until the game was restarted. `canvasPalette.ts`
 * reaches into `@nexus/tokens` for the same reason one module over (Excalidraw's
 * invert filter needs a specific theme's values), and both are the reason the
 * colour gate exempts nothing here: there is no literal in this file.
 *
 * **The three roles, and no fourth.** The design system's chart rule - accent for
 * what the person did, jade data for the other object in the field, garnet danger
 * for a bad state - is exactly the vocabulary a board needs: the snake, the
 * paddle, the ball, the tiles and the revealed cells are the player's own marks
 * (`accent`), the food and the bricks are the thing out there to be dealt with
 * (`data`), and a mine, a lost ball and a dead snake are the loss (`danger`).
 *
 * **The seven Blocks pieces are the accent palette, on `canvasPalette`'s terms.**
 * A falling-blocks board needs seven colours that are not a system hue, and the
 * app already ships eight of them for the canvas swatches; a board that invented
 * a ramp of its own would be the first surface in the app to do so. They are read
 * from `accents` rather than from the active accent, so the seven shapes stay
 * distinguishable under every accent a profile can pick.
 */

export interface BoardPalette {
  /** What the board is painted on. */
  readonly ground: string;
  /** The hairline grid over the ground: cell edges that carry no state. */
  readonly grid: string;
  /** The board's own frame. */
  readonly frame: string;
  /** Text and the shapes that are simply "there": numbers, borders, the ghost. */
  readonly ink: string;
  /** The same, drawn under a value. */
  readonly muted: string;
  /** The player's own object: snake body, paddle, ball, settled piece, revealed cell. */
  readonly accent: string;
  readonly accentSoft: string;
  readonly accentStrong: string;
  /** The thing out there: food, bricks, the tile that wins. */
  readonly data: string;
  readonly dataSoft: string;
  /** The loss: a mine, a lost ball, a dead snake. */
  readonly danger: string;
  readonly dangerSoft: string;
  /** The raised surface, for a cell that is closed but not part of the ground. */
  readonly surface: string;
  readonly surfaceAlt: string;
  /** The seven piece colours, in `BLOCKS_PIECE_IDS` order. */
  readonly pieces: readonly string[];
}

function paletteFor(theme: ThemeName, accent: AccentId): BoardPalette {
  const tokens = themes[theme];
  const slots = accents[theme][accent];
  return {
    ground: tokens.surfaceSunken,
    grid: tokens.borderSubtle,
    frame: tokens.border,
    ink: tokens.text,
    muted: tokens.textMuted,
    accent: slots.accent,
    accentSoft: slots.accentSoft,
    accentStrong: slots.accentStrong,
    data: tokens.data,
    dataSoft: tokens.dataSoft,
    danger: tokens.danger,
    dangerSoft: tokens.dangerSoft,
    surface: tokens.surface,
    surfaceAlt: tokens.surfaceAlt,
    // Seven of the eight accents, in the palette's own order: the eighth
    // (grafit) is the one that reads as text rather than as a shape, and a grey
    // piece on a grey grid is a piece the player cannot see.
    pieces: ACCENT_IDS.slice(0, 7).map((id) => accents[theme][id].accent),
  };
}

/**
 * The board colours for one theme and one accent.
 *
 * Pure, and that is the point: the board a player looks at is a function of the
 * two attributes the app puts on `<html>`, which is what makes "the palette
 * follows the theme" a thing a test can ask about rather than a thing a person
 * has to check by switching themes and looking.
 */
export function boardPalette(theme: ThemeName, accent: AccentId): BoardPalette {
  return paletteFor(theme, accent);
}
