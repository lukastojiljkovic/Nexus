/**
 * CANV's scene document — what a board actually stores, and why this file
 * validates it rather than trusting the editor that produced it.
 *
 * **A scene is Excalidraw's own `serializeAsJSON` output, kept verbatim.** It is
 * not re-modelled into rows, and that is the module's first decision. An
 * Excalidraw element is a moving target of some seventy fields whose meaning is
 * defined by the renderer that draws it; a schema of our own would have to track
 * every one of them, and the first field we failed to carry would be a drawing
 * that came back wrong. So the document travels whole, exactly as a note's
 * snapshot does.
 *
 * **What IS checked is the envelope, and only the envelope.** `type`, `version`,
 * `source`, and the three containers — because those are the fields anything
 * outside the editor ever reads, and because a store that accepted arbitrary
 * JSON would let a wrong-but-parseable document into the column and only find
 * out when the page failed to open. The elements themselves are NOT walked:
 * validating them here would be re-implementing Excalidraw's own `restore`,
 * which already runs on the way in and repairs what it can. This is a gate on
 * the shape of the file, never a second opinion about a rectangle.
 *
 * **`appState` is already narrow when it arrives.** `serializeAsJSON` runs its
 * own `cleanAppStateForExport` first, so scroll position, zoom, selection and
 * the whole editing state are gone before this ever sees it — what remains is
 * the handful of per-scene preferences (grid, background) that genuinely belong
 * to the drawing. Nothing here needs to strip anything, and nothing here should
 * start: a key we dropped would be a preference the user set and lost.
 *
 * The canonical form this module emits fixes the key ORDER, for the interchange's
 * reason (`serializeHabitSchedule`'s): the same scene must serialise to the same
 * bytes every time, or an export's checksum would change without the drawing
 * changing.
 */

/**
 * The envelope tag `serializeAsJSON` writes. Excalidraw refuses a document
 * without it and so do we — a JSON file that is not a scene is not a scene we
 * should be storing under a board's name.
 */
export const CANVAS_SCENE_TYPE = "excalidraw";

/**
 * The ceiling on one stored scene, in UTF-16 code units of its serialised form.
 *
 * Eight mebibytes is not a limit on how much anyone can draw — a scene of many
 * thousands of shapes is a few hundred kilobytes — it is a bound on the ONE part
 * of the document that has no natural size: `files`, where an embedded image
 * rides as a base64 data URL. A single pasted photograph can be several
 * megabytes on its own, and without a bound the column would grow until a write
 * failed somewhere far less legible than here.
 *
 * Refused rather than truncated, and refused with a named error the page turns
 * into a sentence: silently dropping the images out of somebody's diagram to
 * make it fit is the one repair a canvas must never make.
 */
export const MAX_CANVAS_SCENE_LENGTH = 8 * 1024 * 1024;

/**
 * One board's drawing.
 *
 * `elements` and `files` are `unknown[]`/`Record<string, unknown>` on purpose:
 * this package does not depend on `@excalidraw/excalidraw` (only the renderer
 * does), and a hand-written copy of its element union would be a second
 * definition guaranteed to fall behind the first. The renderer casts them at
 * the one boundary where it hands them to the editor, which is the only place
 * anything knows what they mean.
 */
export interface CanvasScene {
  type: typeof CANVAS_SCENE_TYPE;
  /** Excalidraw's own document version — an integer it bumps when the file format changes. */
  version: number;
  /** Who wrote the file. Provenance, never a reference: it is whatever the writing editor put there. */
  source: string;
  elements: unknown[];
  /** The per-scene preferences that survive `cleanAppStateForExport` — grid, background, and their kin. */
  appState: Record<string, unknown>;
  /** Embedded binaries (images), keyed by Excalidraw's file id. */
  files: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural validation of a scene from an untrusted caller, returning the
 * CANONICAL form or null.
 *
 * Null rather than a throw, exactly as `validateHabitSchedule` answers: the
 * callers that need a named error (the store, the archive reader) raise their
 * own with the field they were asked about, and the ones that are merely asking
 * (the renderer, deciding whether a stored board can be opened) get an answer
 * they can branch on without a try/catch.
 */
export function validateCanvasScene(value: unknown): CanvasScene | null {
  if (!isRecord(value)) return null;
  if (value.type !== CANVAS_SCENE_TYPE) return null;
  if (!Number.isSafeInteger(value.version) || (value.version as number) <= 0) return null;
  if (typeof value.source !== "string") return null;
  if (!Array.isArray(value.elements)) return null;
  if (!isRecord(value.appState)) return null;
  if (!isRecord(value.files)) return null;
  return {
    type: CANVAS_SCENE_TYPE,
    version: value.version as number,
    source: value.source,
    elements: [...value.elements],
    appState: { ...value.appState },
    files: { ...value.files },
  };
}

/**
 * The canonical text a board's column holds. Key order is FIXED here and
 * nowhere else, so the same scene always produces the same bytes — which is
 * what lets an export's checksum mean „the drawing changed" rather than „the
 * serialiser felt different today".
 */
export function serializeCanvasScene(scene: CanvasScene): string {
  return JSON.stringify({
    type: scene.type,
    version: scene.version,
    source: scene.source,
    elements: scene.elements,
    appState: scene.appState,
    files: scene.files,
  });
}

/**
 * Reads a stored or transmitted scene back. Bad JSON and a valid document of
 * the wrong shape answer the same way — null — because the caller's next move is
 * the same either way, and telling them apart would only invite a second error
 * path nobody reads.
 */
export function parseCanvasScene(text: string): CanvasScene | null {
  if (text.length > MAX_CANVAS_SCENE_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return validateCanvasScene(parsed);
}

/**
 * A board nobody has drawn on yet.
 *
 * `version: 2` is Excalidraw's own current document version, restated rather
 * than imported for the reason every bound in `importArchive.ts` is restated:
 * `@nexus/core` does not depend on the editor. An older or newer number here
 * costs nothing — Excalidraw's `restore` migrates a scene forward on the way in
 * — so this is a starting point, never an assertion about the format.
 *
 * A FUNCTION rather than a frozen constant: the containers are mutable by type,
 * and a shared literal would let one board's first stroke land in every board
 * that had not been drawn on yet.
 */
export function emptyCanvasScene(): CanvasScene {
  return { type: CANVAS_SCENE_TYPE, version: 2, source: "nexus", elements: [], appState: {}, files: {} };
}
