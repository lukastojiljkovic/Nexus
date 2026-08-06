import { ACCENT_IDS, accents, themes } from "@nexus/tokens";

import { CANVAS_INK_ID, CANVAS_TRANSPARENT, type CanvasSwatchId } from "./canvasTools.js";

/**
 * Every colour that goes into a canvas scene — and the one rule that governs
 * all of them.
 *
 * **Excalidraw owns the dark transform.** Its stylesheet carries
 *
 * ```css
 * .excalidraw.theme--dark canvas { filter: invert(93%) hue-rotate(180deg) }
 * ```
 *
 * and `CanvasPage` passes `theme="dark"` under Noć, so under Noć the editor
 * inverts the entire canvas *after* we have painted it. Every colour handed in
 * is therefore fed through an inversion — which means the colour to hand in is
 * the one that should survive that inversion, i.e. **Dan's, in both themes.**
 *
 * Before this module existed, all of them were read from the LIVE theme with
 * `getComputedStyle`, so under Noć we handed the editor the dark value and it
 * inverted it back to a light one. The board rendered near-white, the default
 * ink rendered dark-on-dark and effectively invisible, Nexus cards rendered
 * light on a dark board, and every swatch painted a colour different from the
 * dot the user had clicked. Dan was correct throughout, which is why only Noć
 * was ever reported.
 *
 * These are read from `@nexus/tokens` rather than off the document because the
 * document only ever exposes the ACTIVE theme, and this file needs a specific
 * one. That is also why there is no raw hex here: the values live in the tokens
 * package, which is the one place the colour gate permits them.
 */

/** The default stroke a newly drawn shape starts with. */
export const CANVAS_INK = themes.dan.text;

/** The colour behind everything. Never persisted — see `CanvasPage.loadScene`. */
export const CANVAS_BACKGROUND = themes.dan.bg;

/** The two colours a Nexus card (`nexus://kind/uuid`) is drawn with. */
export const CANVAS_CARD_STROKE = themes.dan.border;
export const CANVAS_CARD_FILL = themes.dan.surface;

/**
 * A swatch's colour: „Mastilo" is the ink above, the other eight are the Nexus
 * accents in the order Settings shows them.
 *
 * All eight are offered regardless of which accent the profile picked — a
 * diagram wants more than one hue — which is what `accents` in the tokens
 * package publishes and what `--nx-swatch-<id>` mirrors in CSS.
 */
export function canvasSwatchColour(id: CanvasSwatchId): string {
  return id === CANVAS_INK_ID ? CANVAS_INK : accents.dan[id].accent;
}

/**
 * Excalidraw's dark-canvas filter, restated so our own swatch dots can wear it.
 *
 * The dots are drawn in OUR toolbar, outside the editor's canvas, so nothing
 * inverts them. Painting them from `canvasSwatchColour` and applying this under
 * Noć is what makes the dot show the colour the stroke will actually be — the
 * two agree by construction rather than by a palette coincidence.
 *
 * It is a copy of a value inside a dependency, so `canvasPalette.test.ts` reads
 * it back out of `@excalidraw/excalidraw`'s shipped stylesheet and fails if an
 * upgrade ever changes it. A silent drift here would put the toolbar and the
 * canvas back out of step, which is the defect this module exists to close.
 */
export const CANVAS_DARK_FILTER = "invert(93%) hue-rotate(180deg)";

/**
 * Every colour string a scene may hold that was captured under Noć, mapped to
 * the Dan value that means the same thing.
 *
 * Boards drawn before this rule existed have Noć's palette baked into their
 * elements, and those elements would keep inverting. Rewriting them on load
 * (`CanvasPage.loadScene`) is safe precisely because the values are a closed
 * set: the user could only ever have picked one of the eleven the toolbar
 * offered, and `changeViewBackgroundColor` has been off since slice b1, so no
 * scene colour was ever free-form.
 */
const NOC_TO_DAN: ReadonlyMap<string, string> = new Map<string, string>([
  [themes.noc.text, themes.dan.text],
  [themes.noc.bg, themes.dan.bg],
  [themes.noc.border, themes.dan.border],
  [themes.noc.surface, themes.dan.surface],
  ...ACCENT_IDS.map((id): [string, string] => [accents.noc[id].accent, accents.dan[id].accent]),
]);

/**
 * One colour string, corrected if it is a Noć value this app once wrote.
 * Compared the way `sameCanvasColour` compares, because the strings being
 * matched came out of the same places it matches.
 */
export function toCanvasPalette(colour: string): string {
  return NOC_TO_DAN.get(colour.trim().toLowerCase()) ?? colour;
}

/**
 * The colour-bearing fields of a stored scene element, corrected in place-free
 * fashion — a new object per element, and the element is returned untouched
 * when nothing changed so an unaffected board produces no scene-version bump
 * and therefore no re-save.
 */
export function migrateElementColours<T extends object>(element: T): T {
  const source = element as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...source };
  for (const field of ["strokeColor", "backgroundColor"]) {
    const value = source[field];
    if (typeof value !== "string") continue;
    const corrected = toCanvasPalette(value);
    if (corrected !== value) {
      next[field] = corrected;
      changed = true;
    }
  }
  return changed ? (next as T) : element;
}

/**
 * A stored board's `appState`, with this module's rule imposed on the three
 * fields that carry a colour.
 *
 * The two `currentItem*` fields are the user's live pick, so they are KEPT and
 * merely corrected — a colour chosen under Noć before this rule existed becomes
 * its Dan equivalent rather than being reset to the default.
 *
 * `viewBackgroundColor` is different and is overwritten outright, because it
 * was never a choice: `changeViewBackgroundColor` has been off since CANV slice
 * b1, so the only value a board can hold is whatever theme happened to be
 * active when it was created. The founder's decision (2026-08-06) is that the
 * theme always wins, and with no way to set it there is nothing to preserve.
 */
export function canvasAppState(stored: Record<string, unknown>): Record<string, unknown> {
  const pick = (key: string, fallback: string): string => {
    const value = stored[key];
    return typeof value === "string" ? toCanvasPalette(value) : fallback;
  };
  return {
    ...stored,
    currentItemStrokeColor: pick("currentItemStrokeColor", CANVAS_INK),
    currentItemBackgroundColor: pick("currentItemBackgroundColor", CANVAS_TRANSPARENT),
    viewBackgroundColor: CANVAS_BACKGROUND,
  };
}
