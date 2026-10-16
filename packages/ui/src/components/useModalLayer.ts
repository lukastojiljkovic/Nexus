import { useEffect } from "react";

/**
 * The app-wide answer to „is a modal open", and the one place a modal surface
 * publishes it.
 *
 * **Why this is state the package owns rather than a prop the shell passes
 * down.** The shell listens for the app's global chords (`Alt+1`…`9`, `Ctrl+K`,
 * `Ctrl+Shift+L`) on `window`, and a modal is exactly the thing those chords
 * must not act through: with the module launcher or the command palette open,
 * `Alt+2` was switching the page behind it and `Ctrl+Shift+L` was locking the
 * app mid-question. The listener is one component in the renderer, the modals
 * are everywhere, and nothing threading a prop from one to the other would
 * survive the next modal somebody adds — so a surface SAYS it is a layer, and
 * the guard asks.
 *
 * **A count, not a boolean.** Modal surfaces nest in the ordinary course of
 * using the app (a confirmation over the launcher, the palette over a page whose
 * own panel is open), and a boolean released by the inner layer would tell the
 * guard the app was free while the outer one was still on screen. `isModalOpen`
 * is therefore „at least one", which is the question the guard is actually
 * asking.
 */
let openLayers = 0;

/** How many modal layers are open right now. */
export function modalLayerDepth(): number {
  return openLayers;
}

/**
 * True while any modal layer is open — what a global key handler asks before it
 * acts on a chord.
 *
 * Deliberately a plain function rather than a hook: the guard is a `window`
 * listener that runs outside React's render pass, and a value it read at render
 * time would be the value from the last render rather than the state of the
 * window the key was pressed in.
 */
export function isModalOpen(): boolean {
  return openLayers > 0;
}

/**
 * Marks one modal layer open for as long as the returned release function has
 * not been called.
 *
 * **The release is idempotent, and that is not defensive tidiness.** React 19
 * runs an effect twice on mount in development (mount, unmount, mount), so the
 * same layer enters twice; and a cleanup that ran twice — a second call being
 * one line away in any future edit — would take the count to −1 and leave the
 * guard believing a modal was open for the rest of the session, with every
 * chord silently dead and nothing on screen to explain it. Releasing once is
 * therefore the rule rather than an accident of how the cleanup happens to be
 * written.
 */
export function holdModalLayer(): () => void {
  openLayers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openLayers -= 1;
  };
}

/**
 * Publishes „a modal is open" for as long as the calling component is mounted.
 *
 * Every modal surface in this package calls it (`Dialog`, and through it
 * `ConfirmDialog`); a surface the renderer still draws by hand publishes it the
 * same way, which is why the counter and the hook are two things rather than
 * one.
 */
export function useModalLayer(): void {
  useEffect(() => holdModalLayer(), []);
}
