// The asset path must be set before Excalidraw resolves a single font URL, and
// a static import is evaluated before this module's own body — so this line
// stays FIRST, above the editor's import, and above every other import that
// might one day reach it. See `excalidrawAssets.ts` for the whole story.
import "./excalidrawAssets.js";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  ROUNDNESS,
  convertToExcalidrawElements,
  newElementWith,
  restore,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isCanvasRefText } from "@nexus/core";
import type { CanvasRef } from "@nexus/core";
import type { ThemeName } from "@nexus/tokens";
import { Button, EmptyState, Icon, LoadingState, PageHeader, SaveIndicator, type SaveStatus, TextField } from "@nexus/ui";
import { MAX_CANVAS_BOARD_NAME_LENGTH, MAX_CANVAS_SCENE_LENGTH } from "../../shared/ipc.js";
import type { CanvasBoard, CanvasRefCard } from "../../shared/ipc.js";
import { boardAfterDelete, looksLikeMermaid, resolveActiveBoard } from "./canvasBoards.js";
import { moduleName } from "./moduleName.js";
import { NotePopover } from "./notePopover.js";
import { formatClockTime } from "./timeFormat.js";
import { CanvasCard } from "./CanvasCard.js";
import { CanvasCardPicker } from "./CanvasCardPicker.js";
import { CanvasToolbar } from "./CanvasToolbar.js";
import {
  CANVAS_CARD_HEIGHT,
  CANVAS_CARD_WIDTH,
  canvasCardElement,
  canvasCardInteraction,
  canvasCardMap,
  canvasCardView,
  canvasDropOrigin,
  canvasSceneRefs,
  sameCanvasRefs,
  type CanvasPickerRow,
  type CanvasSceneElement,
} from "./canvasCards.js";
import {
  CANVAS_BACKGROUND,
  CANVAS_CARD_FILL,
  CANVAS_CARD_STROKE,
  CANVAS_INK,
  canvasAppState,
  migrateElementColours,
} from "./canvasPalette.js";
import {
  CANVAS_TRANSPARENT,
  canvasToolbarStateOf,
  sameCanvasToolbarState,
  type CanvasToolbarAppState,
  type CanvasToolbarState,
} from "./canvasTools.js";
import { strings } from "./strings.js";

/**
 * Tabla (CANV slices a–b1) — the infinite canvas, over an embedded Excalidraw.
 *
 * **The scene is a VALUE this page hands in and gets back.** Excalidraw keeps
 * its own document in memory and never touches storage on our behalf; this page
 * hands it one through `initialData` (which accepts a promise, so the IPC read
 * is awaited rather than raced) and writes it back through `serializeAsJSON`.
 * Nothing about persistence is delegated to the editor, which is why the module
 * ends up with an ordinary store, an ordinary migration and an ordinary place in
 * every archive.
 *
 * **`onChange` is debounced against `getSceneVersion`, and both halves are
 * load-bearing.** It fires on every pointer move — hundreds of times per stroke
 * — so a naive save would melt the write path. The version check is what makes
 * the debounce correct rather than merely cheap: it is a hash of the elements,
 * so a pan, a zoom or a selection produces the same number and no write at all,
 * while an actual edit produces a different one. Time alone would save on every
 * mouse-over; the version alone would save hundreds of times per stroke.
 *
 * **The mermaid conversion is an ACTION, not a paste.** Excalidraw's own paste
 * handler dynamic-imports 3.35 MB of `@excalidraw/mermaid-to-excalidraw` and
 * silently converts any text beginning „graph", „gantt", „pie" and a dozen other
 * ordinary words. Somebody pasting a note that starts with „graph" got a
 * diagram; nobody discovered the feature on purpose. So `onPaste` — the
 * supported hook, returning `false` to cancel the editor's own handling —
 * intercepts exactly those pastes and drops the text in as text, and the
 * conversion moves to „Mermaid dijagram", which opens the editor's own
 * definition dialog. The keyword list is a copy and `canvasBoards.ts` says what
 * that costs.
 *
 * **The editor is an ENGINE, not an interface** (slice b1). Excalidraw ships 54
 * locales, none of them Serbian, and none can be added: the loader is a closed
 * hard-coded import map inside the bundle and `setLanguage` is not re-exported.
 * Its colour picker also offers violet, blue and orange, three hues this
 * project bans. So its chrome is hidden outright — `app.css` names the three
 * selectors and what each removes — and `CanvasToolbar` drives the editor
 * through its imperative API with our own controls, tokens and strings. Two
 * further pieces of chrome are refused in the tree rather than in CSS, because
 * both are about what this app will not have at all: `<MainMenu>` — ours
 * replaces the default entirely, which is what makes the Help dialog, the
 * social links and „Excalidraw+" absent from the DOM rather than merely hidden
 * — and `closeLibrarySidebar`, which is how „Publish library" is kept out of
 * reach.
 *
 * **What survives the hiding, deliberately: the dialogs, the sidebar and the
 * canvas.** The mermaid dialog above all — it is portalled onto `document.body`
 * (`useCreatePortalContainer`), so a rule scoped inside this page's own surface
 * structurally cannot reach it.
 *
 * **Theme.** Excalidraw's ~209 CSS variables are scoped to `.excalidraw`, not
 * `:root`, so `app.css` restates the ones that paint from our own `--nx-*`
 * tokens — `--color-primary` above all, whose default is a violet that would
 * otherwise draw every selection box and focus ring in the app. The element
 * defaults a NEW shape gets are not CSS at all but scene values, so they are
 * read off the computed tokens at mount (`elementDefaults`) rather than written
 * as literals anywhere.
 *
 * **Cards (slice c).** A Nexus object goes on a board as an *embeddable* whose
 * `link` is a `nexus://kind/uuid` reference, and this page draws it itself:
 * `validateEmbeddable` admits exactly `isCanvasRefText` and nothing else, and
 * `renderEmbeddable` returns a `CanvasCard` on every path there is. Both halves
 * matter — the editor falls through to a REAL IFRAME on a nullish render, and it
 * skips the overlay entirely for a link that failed validation. `canvasCards.ts`
 * holds every decision either one makes, `CanvasCard.tsx` the drawing, and
 * neither adds a migration or an interchange version: a scene with cards is the
 * same stored column as a scene without.
 *
 * **Resolution is a batch against the SET of references, not against the
 * scene.** `onChange` fires per pointer move, and moving a card changes the
 * document without changing what is on it — so the references are collected,
 * compared as a set (`sameCanvasRefs`) and only then resolved in one round trip,
 * the same cheap-comparison-in-front-of-expensive-work shape the autosave's
 * `getSceneVersion` guard has.
 */

/**
 * How long the page waits after the last change before writing. Long enough
 * that a continuous stroke is one write, short enough that closing the app right
 * after a change cannot plausibly lose it.
 */
const AUTOSAVE_DELAY_MS = 800;

/**
 * What `restore` accepts, with the optionality removed — the one shape in this
 * file that speaks Excalidraw's own element types. Both containers are always
 * present in a stored scene (main validated the envelope and the store
 * re-validated it), and `exactOptionalPropertyTypes` will not let an explicit
 * `undefined` be passed for an optional field anyway.
 */
type RestoreInput = NonNullable<Parameters<typeof restore>[0]>;
type RestoreElements = Exclude<RestoreInput["elements"], undefined>;
type RestoreFiles = Exclude<RestoreInput["files"], undefined>;

/** No board has cards yet, or the one open has none — one frozen empty map rather than a new one per render. */
const NO_CARDS: ReadonlyMap<string, CanvasRefCard> = new Map();

export interface CanvasPageProps {
  profileId: string;
  /** The resolved theme (`App` owns the preference) — Excalidraw takes „dan"/„noć" as `light`/`dark`. */
  theme: ThemeName;
  /**
   * Follows a card to the object it points at (slice c). `App` owns this
   * because opening a note, a task or an event is a cross-module deep link and
   * this app has exactly one mechanism for those — the 021-e intents that
   * global search, the palette and „Otvori prilog" all already ride.
   */
  onOpenRef: (ref: CanvasRef) => void;
}

/**
 * The element defaults a newly-drawn shape starts with.
 *
 * Fixed values from `canvasPalette`, not a read of the live theme: Excalidraw
 * inverts the whole canvas itself under its dark theme, so every colour handed
 * to it has to be Dan's in BOTH themes or it is inverted twice. That module
 * carries the full argument; this is one of its five call sites.
 *
 * Only what a NEW shape needs is set: stroke, the background of a filled shape,
 * and the canvas colour behind everything. `"transparent"` is a CSS keyword
 * rather than a colour, and it is Excalidraw's own default for a shape's fill —
 * a drawing whose rectangles arrived pre-filled would be deciding something for
 * the user.
 */
const ELEMENT_DEFAULTS: Record<string, string> = {
  currentItemStrokeColor: CANVAS_INK,
  currentItemBackgroundColor: CANVAS_TRANSPARENT,
  viewBackgroundColor: CANVAS_BACKGROUND,
};

/** What one render of this page stands on. `boards` is null until the first read lands. */
interface CanvasState {
  boards: CanvasBoard[] | null;
  activeId: string | null;
}

export function CanvasPage({ profileId, theme, onOpenRef }: CanvasPageProps) {
  const s = strings.canvas;

  const [state, setState] = useState<CanvasState>({ boards: null, activeId: null });
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  /**
   * What the board says about its own persistence.
   *
   * The founder's fourth report was that the canvas „treba opciju za čuvanje
   * table" — and boards had been saving themselves since the day the page
   * shipped. That is the finding: the autosave SAID its failures and never said
   * its successes, so from the user's side the page was silent either way, and
   * silence about your drawing reads as „this is not being kept". A drawing you
   * are not sure is saved is a drawing you cannot walk away from.
   *
   * `savedAt` is the instant of the last successful write, and the line carries
   * it: a bare „Sačuvano" is still on screen an hour later and therefore
   * proves nothing.
   */
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The name form, open for a new board (`{ id: null }`) or for a rename (`{ id }`). */
  const [naming, setNaming] = useState<{ id: string | null; draft: string } | null>(null);
  /**
   * What our toolbar draws as active. Null only before an editor exists — it is
   * seeded from the editor's real state the moment one does (`excalidrawAPI`
   * runs inside React's commit, so the seeded render lands before any paint)
   * and kept in step by `onChange` after that.
   */
  const [toolbar, setToolbar] = useState<CanvasToolbarState | null>(null);
  /**
   * The references the open board currently carries, as a set. Replaced only
   * when that set genuinely changes (`sameCanvasRefs`), which is what keeps the
   * resolve effect below off the pointer-move path.
   */
  const [refs, setRefs] = useState<string[]>([]);
  /** What those references resolve to, keyed by the reference text a card reads itself up by. */
  const [cards, setCards] = useState<ReadonlyMap<string, CanvasRefCard>>(NO_CARDS);
  const [pickerOpen, setPickerOpen] = useState(false);

  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  /**
   * The scene version last written, per board. `-1` means „nothing written yet",
   * which is deliberately NOT the version of an empty scene (that is 0): a board
   * opened and immediately closed must not be re-saved, and one whose first
   * stroke lands must.
   */
  const savedVersion = useRef(-1);
  const saveTimer = useRef<number | null>(null);

  const { boards, activeId } = state;

  /** Re-reads the board list, keeping whatever board was open when it is still there. */
  const reload = useCallback(async (): Promise<void> => {
    const listed = await window.nexus.listCanvasBoards(profileId);
    setState((previous) => ({
      boards: listed,
      activeId: resolveActiveBoard(listed, previous.activeId),
    }));
  }, [profileId]);

  /**
   * The mount read, and the one place a board is created without being asked
   * for.
   *
   * A profile with no boards gets „Tabla" made for it, because the alternative
   * is an empty-state button whose only possible label is „napravi tablu" —
   * a question with one answer. The empty state below therefore only ever shows
   * after the user deletes their last board, which IS a decision they made.
   */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        let listed = await window.nexus.listCanvasBoards(profileId);
        if (listed.length === 0) {
          await window.nexus.createCanvasBoard(profileId, s.firstBoardName);
          listed = await window.nexus.listCanvasBoards(profileId);
        }
        if (!active) return;
        setState({ boards: listed, activeId: resolveActiveBoard(listed, null) });
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load canvas boards:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, s.firstBoardName]);

  /**
   * A board switch resets the write bookkeeping BEFORE the new scene arrives, so
   * the incoming board's first `onChange` cannot be mistaken for an edit to the
   * one just closed. Whatever was pending is FLUSHED first, by the switch itself
   * (`flushPending`), while the old board is still the open one.
   */
  useEffect(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    savedVersion.current = -1;
    // The cards go with the board, for the same reason: the incoming board's
    // first `onChange` must not find the outgoing one's references still
    // standing, or a card would draw the previous board's title for a frame.
    setRefs([]);
    setCards(NO_CARDS);
    // And so does the save line. „Sačuvano u 14:32" carried across a switch
    // would be a statement about the board you just LEFT, made on the one you
    // just opened — which is precisely the false reassurance this line exists
    // to replace. A failure does not survive the switch either: it belonged to
    // a write into the other board.
    setSaveStatus("idle");
    setSavedAt(null);
    setSaveError(null);
  }, [activeId]);

  /**
   * What the references on this board currently point at — ONE round trip for
   * the whole board, re-run only when the set of references changes.
   *
   * A failure is SAID rather than retried: a card with no answer draws
   * „Učitavanje…", and a spinner that never resolves is exactly the kind of
   * quiet lie the autosave's own error handling exists to avoid. Nothing is at
   * risk here — the drawing is fine and only the titles are missing — which is
   * why it is its own sentence and not `saveError`.
   */
  useEffect(() => {
    if (refs.length === 0) {
      setCards(NO_CARDS);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const resolved = await window.nexus.resolveCanvasRefs(profileId, refs);
        if (active) setCards(canvasCardMap(refs, resolved));
      } catch (error) {
        if (active) setActionError(s.cardsError);
        console.error("Nexus: failed to resolve canvas card references:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, refs, s.cardsError]);

  /**
   * The board's stored scene, as the promise `initialData` accepts.
   *
   * `restore` is the editor's own migrator: it fills in fields an older document
   * predates and repairs what it can, which is exactly what must happen to a
   * scene that has been sitting in a database across an Excalidraw upgrade.
   *
   * `canvasAppState` then imposes the colour rule on what came back: the user's
   * live pick is kept but corrected, the background is always the theme's, and
   * every element's own colours are brought over from Noć's palette if that is
   * what they were captured in. A board drawn before that rule existed would
   * otherwise keep inverting forever.
   */
  const loadScene = useCallback(
    async (boardId: string): Promise<ExcalidrawInitialDataState> => {
      const board = await window.nexus.openCanvasBoard(profileId, boardId);
      // The three containers are always present — main validated the envelope
      // and the store re-validated it — so this reads them rather than
      // defaulting them, and the cast is the one boundary where this app admits
      // what an Excalidraw element is.
      const stored = JSON.parse(board.scene) as {
        elements: RestoreElements;
        appState: Record<string, unknown>;
        files: RestoreFiles;
      };
      return restore(
        {
          // `RestoreElements` admits null — `restore` treats that as an empty
          // scene, and correcting nothing is the right answer for one.
          elements: stored.elements?.map(migrateElementColours) ?? null,
          appState: canvasAppState({ ...ELEMENT_DEFAULTS, ...stored.appState }),
          files: stored.files,
        },
        null,
        null,
      );
    },
    [profileId],
  );

  /**
   * Writes the editor's current document. Called by the debounce and by nothing
   * else, so there is exactly one path from „the drawing changed" to „the
   * drawing is on disk".
   *
   * A failure is SAID rather than retried: silently retrying would leave the
   * user believing a drawing is saved while it is not, and the one refusal they
   * can actually cause — a scene past the size ceiling, which in practice means
   * pasted images — needs a sentence they can act on rather than a spinner.
   */
  const writeScene = useCallback(
    async (boardId: string, version: number): Promise<void> => {
      const editor = api.current;
      if (editor === null) return;
      const scene = serializeAsJSON(
        editor.getSceneElements(),
        editor.getAppState(),
        editor.getFiles(),
        "local",
      );
      setSaveStatus("saving");
      try {
        await window.nexus.saveCanvasScene(profileId, boardId, scene);
        savedVersion.current = version;
        setSaveError(null);
        setSavedAt(new Date().toISOString());
        setSaveStatus("saved");
      } catch (error) {
        // Two sentences, told apart by the one refusal a user can cause on
        // purpose: a scene past the wire's ceiling, which in practice means
        // pasted images. Anything else is unexpected and says so.
        //
        // This is the save state and NOT `actionError`, which belongs to the
        // board actions (create, rename, delete) and is dismissible. A failed
        // autosave must not be dismissible: dismissing it would leave the page
        // claiming nothing while the drawing is still only on screen.
        setSaveError(scene.length > MAX_CANVAS_SCENE_LENGTH ? s.tooLarge : s.saveError);
        setSaveStatus("error");
        console.error("Nexus: failed to save canvas scene:", error);
      }
    },
    [profileId, s.saveError, s.tooLarge],
  );

  /**
   * Excalidraw's per-pointer-move change hook. Everything expensive is behind
   * the version check — see the file header for why both halves are needed.
   *
   * The version is computed from the elements the callback was handed rather
   * than read back off the API, so the number the timer eventually records is
   * the one that was current when the change happened.
   *
   * The toolbar snapshot is behind the SAME kind of guard, for the same reason:
   * it is taken on every pointer move, so it is only committed when it
   * genuinely differs, and the previous object is returned otherwise — React
   * then skips the render entirely. This is also what makes the keyboard the
   * equal of the bar: press `R` and the editor's `activeTool` changes, so the
   * snapshot changes, so our highlight moves.
   */
  const onChange = useCallback(
    (
      elements: readonly (CanvasSceneElement & { version: number })[],
      appState: CanvasToolbarAppState & { openSidebar: SidebarState },
    ) => {
      closeLibrarySidebar(api.current, appState.openSidebar);
      const snapshot = canvasToolbarStateOf(appState);
      setToolbar((previous) =>
        previous !== null && sameCanvasToolbarState(previous, snapshot) ? previous : snapshot,
      );
      // The SAME guard shape once more, over a different question: which
      // objects are on this board. Dragging a card fires this callback on every
      // pointer move and changes none of them, so the previous array is
      // returned unless the set really moved — and the resolve effect above,
      // which depends on it, then does not re-run.
      const sceneRefs = canvasSceneRefs(elements);
      setRefs((previous) => (sameCanvasRefs(previous, sceneRefs) ? previous : sceneRefs));
      if (activeId === null) return;
      const version = sceneVersionOf(elements);
      if (version === savedVersion.current) return;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void writeScene(activeId, version);
      }, AUTOSAVE_DELAY_MS);
    },
    [activeId, writeScene],
  );

  /**
   * Writes whatever the debounce is still holding, right now.
   *
   * Called on the two deliberate ways out of a board — switching to another one
   * and leaving the page — because both would otherwise drop up to
   * `AUTOSAVE_DELAY_MS` of drawing on the floor. A stroke finished half a second
   * before somebody clicks the next tab is not a stroke they expect to lose.
   *
   * Called SYNCHRONOUSLY, before `activeId` moves, so `api.current` is still the
   * editor holding the board being written.
   */
  const flushPending = useCallback(() => {
    if (saveTimer.current === null) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const editor = api.current;
    if (editor === null || activeId === null) return;
    void writeScene(activeId, sceneVersionOf(editor.getSceneElements()));
  }, [activeId, writeScene]);

  /**
   * The unmount flush, through a ref so the effect can depend on nothing and
   * still call the CURRENT `flushPending`. An effect that listed it as a
   * dependency would tear down and re-run on every board switch, and its
   * cleanup would then fire at exactly the moment the editor is being replaced.
   */
  const flushRef = useRef(flushPending);
  flushRef.current = flushPending;
  useEffect(() => {
    return () => flushRef.current();
  }, []);

  /**
   * The paste interception. `true` lets Excalidraw handle the paste as it
   * always would; `false` cancels its handling entirely, mermaid branch
   * included.
   *
   * Only mermaid-shaped TEXT is intercepted — an image, a spreadsheet, a copied
   * set of Excalidraw elements and ordinary prose all still paste exactly as
   * they did. The intercepted text is inserted as a text element at the centre
   * of what is on screen, which is where a paste with no cursor position
   * belongs.
   */
  const onPaste = useCallback((data: ClipboardData): boolean => {
    const text = data.text;
    if (typeof text !== "string" || !looksLikeMermaid(text)) return true;
    const editor = api.current;
    if (editor === null) return true;
    // A zero-sized box, which is what „centre this" means for an element whose
    // size the editor works out from its own content. The arithmetic itself is
    // shared with „Dodaj karticu" (`canvasDropOrigin`), so the two cannot drift
    // on where the middle of the screen is.
    const origin = canvasDropOrigin(viewportOf(editor.getAppState()), 0, 0);
    editor.updateScene({
      elements: [
        // INCLUDING deleted: `updateScene` replaces the element list outright,
        // so handing back only the live ones would drop the tombstones an undo
        // of a delete stands on.
        ...editor.getSceneElementsIncludingDeleted(),
        ...convertToExcalidrawElements([{ type: "text", x: origin.x, y: origin.y, text }]),
      ],
    });
    return false;
  }, []);

  /** Opens the editor's own mermaid dialog — the explicit trigger the paste used to be. */
  const openMermaid = useCallback(() => {
    api.current?.updateScene({ appState: { openDialog: { name: "ttd", tab: "mermaid" } } });
  }, []);

  /**
   * Puts the picked object on the board, at the middle of what is on screen.
   *
   * The element is COMPLETE before `convertToExcalidrawElements` sees it —
   * that helper passes an embeddable skeleton through verbatim rather than
   * building one, which `canvasCardElement` says at length. What it does do,
   * and what this call is for, is mint the id and sync the fractional index the
   * scene orders by.
   *
   * `IMMEDIATELY` because putting a card on a board is an edit somebody expects
   * Ctrl+Z to take back, exactly as the toolbar's colour changes are.
   */
  const addCard = useCallback((row: CanvasPickerRow) => {
    setPickerOpen(false);
    const editor = api.current;
    if (editor === null) return;
    const origin = canvasDropOrigin(
      viewportOf(editor.getAppState()),
      CANVAS_CARD_WIDTH,
      CANVAS_CARD_HEIGHT,
    );
    const element = canvasCardElement({
      ref: { kind: row.kind, id: row.id },
      id: crypto.randomUUID(),
      x: origin.x,
      y: origin.y,
      // Dan's values in both themes — `canvasPalette`'s rule, same as
      // `ELEMENT_DEFAULTS`: these go into the scene, and the scene is inverted.
      strokeColor: CANVAS_CARD_STROKE,
      backgroundColor: CANVAS_CARD_FILL,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
      seed: Math.floor(Math.random() * 2 ** 31),
      updated: Date.now(),
    });
    editor.updateScene({
      elements: [...editor.getSceneElementsIncludingDeleted(), ...convertToExcalidrawElements([element])],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }, []);

  /**
   * Takes one card off the board — the affordance a „missing" card carries, and
   * the only thing that ever removes one.
   *
   * A TOMBSTONE rather than a splice, which is what makes Ctrl+Z bring it back:
   * `isDeleted` is how the editor deletes everything else, and the whole list
   * (deleted included) has to go back into `updateScene` because it replaces
   * the element array outright.
   */
  const removeCard = useCallback((elementId: string) => {
    const editor = api.current;
    if (editor === null) return;
    editor.updateScene({
      elements: editor
        .getSceneElementsIncludingDeleted()
        .map((element) =>
          element.id === elementId ? newElementWith(element, { isDeleted: true }) : element,
        ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }, []);

  /**
   * The card the editor asks us to draw. It NEVER answers with nothing: a
   * nullish return here falls through to a real `<iframe>` pointed at the
   * element's link (see `CanvasCard.tsx` for the call site, verbatim), and
   * `canvasCardView` is total over every link a scene can carry.
   */
  const renderEmbeddable = useCallback(
    (
      element: { readonly id: string; readonly link: string | null },
      appState: { readonly activeEmbeddable: { element: { id: string }; state: string } | null },
    ) => (
      <CanvasCard
        elementId={element.id}
        view={canvasCardView(element.link, cards)}
        interaction={canvasCardInteraction(element.id, appState.activeEmbeddable)}
        onOpen={onOpenRef}
        onRemove={removeCard}
      />
    ),
    [cards, onOpenRef, removeCard],
  );

  /**
   * The board's stored drawing, read ONCE per board rather than once per render.
   *
   * Without the memo this would fire an IPC read on every re-render of the page
   * — every keystroke in the name field, every error banner — because
   * `initialData` takes a promise and a promise is a value the render creates.
   * The editor only ever reads it at mount (`key={active.id}` is what remounts
   * it), so once per board is exactly right.
   */
  const initialData = useMemo(
    () => (activeId === null ? null : loadScene(activeId)),
    [activeId, loadScene],
  );

  /** Switches boards, flushing whatever the old one still had pending. */
  function openBoard(id: string): void {
    if (id === activeId) return;
    flushPending();
    setState((previous) => ({ ...previous, activeId: id }));
  }

  /** Runs one board mutation: clears the previous refusal, performs it, re-reads the list. */
  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await reload();
    } catch (error) {
      setActionError(s.actionError);
      console.error("Nexus: canvas action failed:", error);
    }
  }

  async function submitName(): Promise<void> {
    if (naming === null) return;
    const name = naming.draft.trim();
    if (name.length === 0) return;
    const target = naming.id;
    setNaming(null);
    await run(async () => {
      if (target === null) {
        const created = await window.nexus.createCanvasBoard(profileId, name);
        setState((previous) => ({ ...previous, activeId: created.id }));
      } else {
        await window.nexus.renameCanvasBoard(profileId, target, name);
      }
    });
  }

  async function deleteBoard(id: string): Promise<void> {
    // Computed against the list as it stands NOW, which is what makes „the one
    // after it" mean anything (`boardAfterDelete`).
    const next = boardAfterDelete(boards ?? [], id);
    await run(async () => {
      await window.nexus.deleteCanvasBoard(profileId, id);
      setState((previous) => ({ ...previous, activeId: next }));
      setPendingUndoId(id);
    });
  }

  async function undoDelete(id: string): Promise<void> {
    setPendingUndoId(null);
    await run(async () => {
      await window.nexus.restoreCanvasBoard(profileId, id);
      setState((previous) => ({ ...previous, activeId: id }));
    });
  }

  if (failed) {
    return <EmptyState title={s.loadErrorTitle} description={s.loadError} />;
  }
  // Until 2026-08-07 this returned `null` — the page rendered LITERALLY NOTHING
  // for its whole initial read, so opening „Tabla" showed a blank pane and gave
  // no reason to believe anything was happening. A skeleton at least says how
  // much is coming; the title above it says where you are.
  if (boards === null) {
    return (
      <>
        <PageHeader className="canv__header" title={moduleName("canvas")} />
        <LoadingState label={strings.app.loading} rows={4} />
      </>
    );
  }

  const active = boards.find((board) => board.id === activeId) ?? null;

  return (
    <div className="canv">
      {/* The board strip used to be a row of tabs with an unlabelled „Table"
          caption beside it, and three ghost buttons at the end of which the
          destructive one looked exactly like the other two. It is now the page
          header every other page has, and the strip is a NAMED list of the
          user's own boards — which is the affordance the founder asked for
          („da mogu da učitavam table koje sam već koristio"): tabs read as
          what is open, a list reads as what you have. The list also stops
          growing sideways past the window, which the tab row did. */}
      <PageHeader
        className="canv__header"
        title={moduleName("canvas")}
        {...(active === null ? {} : { subtitle: active.name })}
        actions={
          <>
            <SaveIndicator
              status={saveStatus}
              savingLabel={strings.app.saveSaving}
              savedLabel={`${strings.app.saveSavedPrefix} ${formatClockTime(savedAt ?? "")}`}
              {...(saveError === null ? {} : { errorLabel: saveError })}
            />
            <NotePopover
              label={s.boardsLabel}
              triggerClassName="canv__board-switcher"
              triggerContent={
                <>
                  {s.boardsLabel}
                  <span aria-hidden="true"> ({boards.length})</span>
                </>
              }
            >
              {(close) => (
                <>
                  {boards.map((board) => {
                    const isActive = board.id === activeId;
                    return (
                      <button
                        key={board.id}
                        type="button"
                        className={`note__menu-item note__menu-item--check${isActive ? " dash__set-item--active" : ""}`}
                        role="menuitemradio"
                        aria-checked={isActive}
                        onClick={() => {
                          openBoard(board.id);
                          close();
                        }}
                      >
                        <span
                          className={`note__menu-check${isActive ? "" : " note__menu-check--hidden"}`}
                          aria-hidden="true"
                        >
                          <Icon name="check" size={14} />
                        </span>
                        {board.name}
                      </button>
                    );
                  })}
                </>
              )}
            </NotePopover>
            <Button variant="ghost" onClick={() => setNaming({ id: null, draft: "" })}>
              {s.newBoard}
            </Button>
            {active !== null && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setNaming({ id: active.id, draft: active.name })}
                >
                  {s.rename}
                </Button>
                {/* „Mermaid dijagram" is NOT here: it is a drawing action and it
                    moved into the toolbar with the rest of them (slice b1). This
                    header is about boards. `danger` because deleting one is not
                    the same kind of act as renaming it, and until now the two
                    buttons were indistinguishable. */}
                <Button variant="danger" onClick={() => void deleteBoard(active.id)}>
                  {s.delete}
                </Button>
              </>
            )}
          </>
        }
      />

      {naming !== null && (
        <form
          className="canv__name-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitName();
          }}
        >
          <TextField
            label={s.nameLabel}
            placeholder={s.namePlaceholder}
            value={naming.draft}
            maxLength={MAX_CANVAS_BOARD_NAME_LENGTH}
            autoFocus
            onChange={(event) =>
              setNaming((previous) =>
                previous === null ? previous : { ...previous, draft: event.target.value },
              )
            }
          />
          <Button type="submit" variant="primary" disabled={naming.draft.trim().length === 0}>
            {s.save}
          </Button>
          <Button variant="ghost" onClick={() => setNaming(null)}>
            {s.cancel}
          </Button>
        </form>
      )}

      {actionError !== null && (
        <p className="canv__error" role="alert">
          {actionError}
          <Button variant="ghost" onClick={() => setActionError(null)}>
            {s.dismiss}
          </Button>
        </p>
      )}

      {pendingUndoId !== null && (
        <p className="canv__notice" role="status">
          {s.deletedNotice}
          <Button variant="ghost" onClick={() => void undoDelete(pendingUndoId)}>
            {s.undo}
          </Button>
        </p>
      )}

      {active === null ? (
        <EmptyState title={s.emptyTitle} description={s.emptyDescription} />
      ) : (
        <>
          {toolbar !== null && (
            <CanvasToolbar
              editor={api}
              state={toolbar}
              onMermaid={openMermaid}
              onAddCard={() => setPickerOpen(true)}
            />
          )}
          {pickerOpen && (
            <CanvasCardPicker
              profileId={profileId}
              onPick={addCard}
              onCancel={() => setPickerOpen(false)}
            />
          )}
          <div className="canv__surface">
            <Excalidraw
              // Remounts on a board switch, which is what makes `initialData`
              // (read once, at mount) the right place to load a scene at all.
              key={active.id}
              excalidrawAPI={(instance) => {
                api.current = instance;
                // Seeds the toolbar from the editor's REAL state rather than a
                // guessed default. This runs inside React's commit phase, so the
                // render it schedules lands before the browser paints and the bar
                // never appears a frame late.
                setToolbar(canvasToolbarStateOf(instance.getAppState()));
              }}
              initialData={initialData}
              onChange={onChange}
              onPaste={onPaste}
              // The two halves of a card (slice c), and neither works without
              // the other. The predicate is `isCanvasRefText` and NOTHING else:
              // every string it admits is a string this app has promised to
              // draw itself, because the editor's fall-through for one it
              // admits is a real iframe. The renderer honours that promise on
              // every path — see `CanvasCard.tsx`.
              validateEmbeddable={isCanvasRefText}
              renderEmbeddable={renderEmbeddable}
              theme={theme === "noc" ? "dark" : "light"}
              // English, and stated rather than papered over: Excalidraw ships 54
              // locales, Serbian is not one of them, and it cannot be added — the
              // loader is a hard-coded import map inside the bundle and
              // `setLanguage` is not re-exported. This is why the chrome is ours
              // (`CanvasToolbar`) instead of translated. The only English a user
              // can now reach is inside the editor's own mermaid dialog, opened by
              // a deliberate action, and mermaid is a developer-facing notation
              // whose keywords are English to begin with.
              langCode="en"
              zenModeEnabled
              aiEnabled={false}
              UIOptions={{
                canvasActions: {
                  // Every one of these writes or reads a FILE behind our back —
                  // „Open", „Save to…", „Export image" — and the app has its own
                  // export surface (IMEX). „Clear canvas" is off because a board
                  // is deleted, not emptied in place.
                  loadScene: false,
                  saveToActiveFile: false,
                  saveAsImage: false,
                  export: false,
                  clearCanvas: false,
                  // The theme follows Nexus's own setting; a second toggle inside
                  // the canvas would be a preference that disagrees with the app.
                  toggleTheme: false,
                  // Off since slice b1, and this is a REMOVAL rather than an
                  // oversight: the only control for it lived in the left island
                  // that is now hidden, so leaving it on would be advertising a
                  // capability nothing can reach. The canvas colour is
                  // `--nx-bg` (`elementDefaults`) and follows the theme, which is
                  // the same answer `toggleTheme` above gets.
                  changeViewBackgroundColor: false,
                },
              }}
            >
              {/* Refused in the TREE rather than in CSS: providing a menu replaces
                  Excalidraw's default one, whose items include the Help dialog,
                  „Excalidraw+" and the GitHub/X/Discord links. Ours is
                  deliberately empty — every action lives in our own bars above,
                  in Serbian — so those entries are absent from the DOM rather
                  than merely hidden. */}
              <MainMenu />
            </Excalidraw>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The five `appState` fields a drop position is computed from, lifted out of
 * whatever else the editor is carrying — `canvasDropOrigin`'s input, spelled
 * once so the two callers (a mermaid paste and a new card) read the same
 * fields.
 */
function viewportOf(appState: {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  zoom: { value: number };
}) {
  return {
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    width: appState.width,
    height: appState.height,
    zoom: appState.zoom.value,
  };
}

/** Whatever `appState.openSidebar` is — a name and an optional tab, or nothing open. */
type SidebarState = { name: string; tab?: string | undefined } | null;

/**
 * Keeps the LIBRARY panel shut, which is how „Publish library" is made
 * unreachable.
 *
 * **There is no prop for this, and the obvious route does not work.** Rendering
 * a host `<DefaultSidebar>` does not replace Excalidraw's — its implementation
 * renders `LibraryMenu` unconditionally and merely APPENDS the host's children —
 * so the panel cannot be removed from the tree. What the public API does allow
 * is deciding which tab is open, so opening the library redirects to the canvas
 * SEARCH tab, which is the sidebar's other half and one worth keeping.
 *
 * Publishing would have failed anyway: the submit `fetch`es
 * `libraries.excalidraw.com`, which `connect-src 'self'` refuses, so nothing
 * could ever leave the machine. This is about the DIALOG — a form asking for a
 * name, a GitHub handle and a website, inside an offline product, is a door that
 * should not be there, and it is the only thing that writes Excalidraw's
 * `publish-library-data` key.
 *
 * Settles after one bounce: the redirect sets the tab to `search`, and the
 * `onChange` it triggers no longer matches.
 */
function closeLibrarySidebar(
  editor: ExcalidrawImperativeAPI | null,
  sidebar: SidebarState,
): void {
  if (editor === null || sidebar === null) return;
  if (sidebar.name !== "default" || sidebar.tab !== "library") return;
  editor.updateScene({ appState: { openSidebar: { name: "default", tab: "search" } } });
}

/**
 * `getSceneVersion` without the import: the sum of every element's own version
 * counter, which is exactly what Excalidraw's exported helper computes.
 *
 * Restated here for one reason — the callback is handed `readonly
 * OrderedExcalidrawElement[]`, and taking the editor's own function would mean
 * importing its element types into a file that otherwise needs none of them.
 * The number is not compared against anything Excalidraw produces; it is only
 * ever compared against itself.
 */
function sceneVersionOf(elements: readonly { version: number }[]): number {
  return elements.reduce((sum, element) => sum + element.version, 0);
}
