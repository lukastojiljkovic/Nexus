import { app } from "electron";

import { openDocumentExternalUrl } from "../../../main/external.js";
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
 * updater already trusts, and the app's external-link door for a pack's source
 * line.
 *
 * **A pack's source line is a DOCUMENT's link, so it takes the document variant
 * (ADR-107).** The address is the pack's own, printed on the page the reader has
 * open — the same category a ZIM's links are in — and a pack published years ago
 * may have written it as `http:`. The scheme is still checked where the OS is
 * reached: `register.ts` refuses anything that is not `http(s)`, and the door
 * refuses everything the rule refuses.
 */
export function installReaderEnvironment(): void {
  configureReaderEnvironment({
    userData: app.getPath("userData"),
    publicKeyPem: RELEASE_PUBLIC_KEY_PEM,
    print: printReaderPdf,
    openExternal: async (url) => {
      try {
        return await openDocumentExternalUrl(url);
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
