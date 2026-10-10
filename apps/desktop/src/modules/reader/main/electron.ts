import { app, shell } from "electron";

import { RELEASE_PUBLIC_KEY_PEM } from "../../../main/update/releaseKey.js";
import { configureReaderEnvironment } from "./env.js";
import { printReaderPdf } from "./print.js";

/**
 * The Reader's Electron half: the two capabilities and the two paths that only
 * `main/index.ts` can supply, wired into the module's environment (ADR-100).
 *
 * It is ONE call from `index.ts` - `installReaderEnvironment()` - which is the
 * whole of what this module adds to a file fourteen thousand lines long that
 * several runs share. Everything the call needs it reads itself: `userData` at
 * call time (so the harness sandbox, which is set before `ready`, is the
 * directory packs are read from), the release key from the one constant the
 * updater already trusts, and `shell.openExternal` for a pack's source line.
 *
 * `shell.openExternal` is reached through the app's own rule rather than directly:
 * the URL is validated in `register.ts` (http/https only) before this function is
 * called at all, so this is the vetted wrapper `index.ts` said would land with the
 * first external link the product actually has.
 */
export function installReaderEnvironment(): void {
  configureReaderEnvironment({
    userData: app.getPath("userData"),
    publicKeyPem: RELEASE_PUBLIC_KEY_PEM,
    print: printReaderPdf,
    openExternal: async (url) => {
      try {
        await shell.openExternal(url);
        return true;
      } catch (error) {
        console.error(
          `Nexus: the Reader could not open a pack's source - ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return false;
      }
    },
  });
}
