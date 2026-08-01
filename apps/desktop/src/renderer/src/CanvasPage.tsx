// The asset path must be set before Excalidraw resolves a single font URL, and
// a static import is evaluated before this module's own body — so this line
// stays FIRST, above the editor's import, and above every other import that
// might one day reach it. See `excalidrawAssets.ts` for the whole story.
import "./excalidrawAssets.js";
import {
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
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
import type { ThemeName } from "@nexus/tokens";
import { Button, EmptyState, TextField } from "@nexus/ui";
import { MAX_CANVAS_BOARD_NAME_LENGTH, MAX_CANVAS_SCENE_LENGTH } from "../../shared/ipc.js";
import type { CanvasBoard } from "../../shared/ipc.js";
import { boardAfterDelete, looksLikeMermaid, resolveActiveBoard } from "./canvasBoards.js";
import { strings } from "./strings.js";

/**
 * Tabla (CANV slice a) — the infinite canvas, over an embedded Excalidraw.
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
 * **Excalidraw's UI is TEMPORARY here** (`EXCALIDRAW_OWN_UI`). Our own toolbar
 * is slice b's; until then the editor's own is what there is to click. Two
 * pieces of its chrome are NOT temporary, because both are about what this app
 * refuses to have: `<MainMenu>` — ours replaces the default entirely, which is
 * what makes the Help dialog, the social links and „Excalidraw+" absent from
 * the DOM rather than merely hidden — and `closeLibrarySidebar`, which is how
 * „Publish library" is kept out of reach.
 *
 * **Theme.** Excalidraw's ~209 CSS variables are scoped to `.excalidraw`, not
 * `:root`, so `app.css` restates the ones that paint from our own `--nx-*`
 * tokens — `--color-primary` above all, whose default is a violet that would
 * otherwise draw every selection box and focus ring in the app. The element
 * defaults a NEW shape gets are not CSS at all but scene values, so they are
 * read off the computed tokens at mount (`elementDefaults`) rather than written
 * as literals anywhere.
 */

/**
 * TEMPORARY (CANV slice a): renders Excalidraw's own toolbar, islands and
 * footer. Slice b replaces them with ours — set this to `false` and the canvas
 * is chromeless, then delete the constant, the `nx-canvas--chromeless` rule in
 * `app.css`, and this comment together.
 */
const EXCALIDRAW_OWN_UI: boolean = true;

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

export interface CanvasPageProps {
  profileId: string;
  /** The resolved theme (`App` owns the preference) — Excalidraw takes „dan"/„noć" as `light`/`dark`. */
  theme: ThemeName;
}

/**
 * The element defaults a newly-drawn shape starts with, read from the live
 * `--nx-*` tokens.
 *
 * Read rather than written, because these are SCENE values — colour strings the
 * editor stores inside elements — and a literal here would be a raw hex in
 * this app's own source, which the raw-colour gate forbids outright.
 * `getComputedStyle`
 * resolves whichever theme and accent are active at the moment a board is
 * opened, so this is also how the canvas inherits the user's accent.
 *
 * Only what a NEW shape needs is set: stroke, the background of a filled shape,
 * and the canvas colour behind everything. `"transparent"` is a CSS keyword
 * rather than a colour, and it is Excalidraw's own default for a shape's fill —
 * a drawing whose rectangles arrived pre-filled would be deciding something for
 * the user.
 */
function elementDefaults(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string): string => styles.getPropertyValue(name).trim();
  return {
    currentItemStrokeColor: token("--nx-text"),
    currentItemBackgroundColor: "transparent",
    viewBackgroundColor: token("--nx-bg"),
  };
}

/** What one render of this page stands on. `boards` is null until the first read lands. */
interface CanvasState {
  boards: CanvasBoard[] | null;
  activeId: string | null;
}

export function CanvasPage({ profileId, theme }: CanvasPageProps) {
  const s = strings.canvas;

  const [state, setState] = useState<CanvasState>({ boards: null, activeId: null });
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  /** The name form, open for a new board (`{ id: null }`) or for a rename (`{ id }`). */
  const [naming, setNaming] = useState<{ id: string | null; draft: string } | null>(null);

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
  }, [activeId]);

  /**
   * The board's stored scene, as the promise `initialData` accepts.
   *
   * `restore` is the editor's own migrator: it fills in fields an older document
   * predates and repairs what it can, which is exactly what must happen to a
   * scene that has been sitting in a database across an Excalidraw upgrade.
   *
   * The element defaults are merged UNDER the stored `appState`, so a board that
   * remembers its own background keeps it and a fresh one inherits the theme.
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
          elements: stored.elements,
          appState: { ...elementDefaults(), ...stored.appState },
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
      try {
        await window.nexus.saveCanvasScene(profileId, boardId, scene);
        savedVersion.current = version;
        setActionError(null);
      } catch (error) {
        // Two sentences, told apart by the one refusal a user can cause on
        // purpose: a scene past the wire's ceiling, which in practice means
        // pasted images. Anything else is unexpected and says so.
        setActionError(scene.length > MAX_CANVAS_SCENE_LENGTH ? s.tooLarge : s.saveError);
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
   */
  const onChange = useCallback(
    (elements: readonly { version: number }[], appState: { openSidebar: SidebarState }) => {
      closeLibrarySidebar(api.current, appState.openSidebar);
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
    const appState = editor.getAppState();
    editor.updateScene({
      elements: [
        ...editor.getSceneElements(),
        ...convertToExcalidrawElements([
          {
            type: "text",
            // The centre of what is on screen, in scene coordinates.
            x: -appState.scrollX + appState.width / 2 / appState.zoom.value,
            y: -appState.scrollY + appState.height / 2 / appState.zoom.value,
            text,
          },
        ]),
      ],
    });
    return false;
  }, []);

  /** Opens the editor's own mermaid dialog — the explicit trigger the paste used to be. */
  const openMermaid = useCallback(() => {
    api.current?.updateScene({ appState: { openDialog: { name: "ttd", tab: "mermaid" } } });
  }, []);

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
  if (boards === null) return null;

  const active = boards.find((board) => board.id === activeId) ?? null;

  return (
    <div className="canv">
      <header className="canv__bar">
        <span className="canv__label">{s.boardsLabel}</span>
        <nav className="canv__boards" aria-label={s.boardsLabel}>
          {boards.map((board) => (
            <button
              key={board.id}
              type="button"
              className={board.id === activeId ? "canv__tab canv__tab--active" : "canv__tab"}
              aria-current={board.id === activeId ? "page" : undefined}
              onClick={() => openBoard(board.id)}
            >
              {board.name}
            </button>
          ))}
        </nav>
        <div className="canv__actions">
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
              <Button variant="ghost" onClick={() => void deleteBoard(active.id)}>
                {s.delete}
              </Button>
              <Button variant="ghost" title={s.mermaidTitle} onClick={openMermaid}>
                {s.mermaid}
              </Button>
            </>
          )}
        </div>
      </header>

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
        <div
          className={EXCALIDRAW_OWN_UI ? "canv__surface" : "canv__surface canv__surface--chromeless"}
        >
          <Excalidraw
            // Remounts on a board switch, which is what makes `initialData`
            // (read once, at mount) the right place to load a scene at all.
            key={active.id}
            excalidrawAPI={(instance) => {
              api.current = instance;
            }}
            initialData={initialData}
            onChange={onChange}
            onPaste={onPaste}
            theme={theme === "noc" ? "dark" : "light"}
            // Excalidraw ships no Serbian locale; English is the honest fallback
            // until our own toolbar replaces this chrome in slice b.
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
                changeViewBackgroundColor: true,
              },
            }}
          >
            {/* NOT temporary, unlike the rest of the chrome: providing a menu
                replaces Excalidraw's default one, whose items include the Help
                dialog, „Excalidraw+" and the GitHub/X/Discord links. Ours is
                deliberately empty — the actions live in the bar above, in
                Serbian — so those entries are absent from the DOM rather than
                merely hidden. */}
            <MainMenu />
          </Excalidraw>
        </div>
      )}
    </div>
  );
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
