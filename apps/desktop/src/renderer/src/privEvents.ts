/**
 * The custom event `App` dispatches after running the `privLock` shortcut, so a
 * mounted section flips to the lock screen without polling.
 *
 * Its own module rather than an export of `PrivPage.tsx`, where it was declared
 * until every page became its own chunk: `App` dispatches it and `NotesPage`
 * listens for it, and a value import of a page is an import of the whole page.
 * Through this one line, `App` would have kept „Privatno" in the chunk every
 * session loads at startup, and „Beleške" would have loaded it on first open.
 */
export const PRIV_LOCKED_EVENT = "nexus-priv-locked";
