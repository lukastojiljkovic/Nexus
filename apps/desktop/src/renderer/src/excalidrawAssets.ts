/**
 * Where Excalidraw looks for its fonts (CANV slice a). A side-effect module,
 * imported by `CanvasPage.tsx` BEFORE the editor itself so the global is in
 * place by the time anything reads it.
 *
 * **The route: the built page's own directory, and nothing else.** Excalidraw's
 * `Fonts.createUrls` resolves every font URI against `window.EXCALIDRAW_ASSET_PATH`
 * and normalises a value beginning `./` or `/` against `location.origin` — which
 * under `file://` is not a usable base. An ABSOLUTE URL skips that branch
 * entirely, so `new URL("./excalidraw-assets/", location.href)` gives
 * `file:///…/out/renderer/excalidraw-assets/` in the packaged app and
 * `http://localhost:…/excalidraw-assets/` in dev, and both are exactly where the
 * build's font plugin puts the files (`electron.vite.config.ts`).
 *
 * **This route needs no CSP change, and the alternative did.** The obvious move
 * was to reuse the app's own `nx-blob:` custom scheme, the way inline image
 * previews do. It does not work for fonts and cannot be made to: a CSS font
 * fetch is always CORS-mode, and Chromium refuses a custom scheme registered the
 * way `nx-blob` is outright — the request never even reaches a handler. Serving
 * from the page's own directory is what let `font-src 'self' data:` stay exactly
 * as it was. Do not copy the `nx-blob` pattern here.
 *
 * **Expect ~230 `font-src` CSP violations per session naming `esm.sh`, and
 * ignore them.** `createUrls` ALWAYS appends `https://esm.sh/@excalidraw/…` as a
 * last-resort source, after ours. The browser filters a `src` list against the
 * CSP when the FontFace is ACTIVATED, so that entry is dropped before any
 * request exists — it is reported as a violation and never becomes a network
 * request. This was observed even for fonts that loaded perfectly from the local
 * copy. Zero requests leave the machine either way; the noise cannot be removed
 * short of patching Excalidraw, and it is not worth a patch.
 */

declare global {
  interface Window {
    /** Read by Excalidraw's `Fonts.createUrls`. A string or an array of bases; we set one absolute base. */
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

window.EXCALIDRAW_ASSET_PATH = new URL("./excalidraw-assets/", location.href).href;

export {};
