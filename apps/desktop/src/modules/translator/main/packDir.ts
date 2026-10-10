import { app } from "electron";

import { packsRoot } from "../../../main/packs/registry.js";

/**
 * Where the installed content packs live, for the one module that reads one.
 *
 * **Why this file exists at all.** The module kit hands a module no `app` —
 * `main/index.ts` says so out loud when it builds the platform — and a
 * dictionary is useless without the bytes of the pack somebody installed. So
 * this module reads the single path it needs, in this single file, and
 * `register.test.ts` replaces it (`vi.mock`) so the rest of the module is
 * testable without Electron. That is the same arrangement the notification
 * gates' tests already use, and it keeps the Electron-shaped fact in one place
 * rather than spread through the pack reader.
 *
 * The path itself is not spelled here: `packsRoot` is `main/packs/registry.ts`'s
 * own answer to "where do packs live", and a second `join(userData, "packs")`
 * would be a second place for the two to disagree.
 *
 * **If the kit ever hands modules a packs root, this file is what goes**: the
 * reader takes a directory and knows nothing else about where it came from.
 */
export function installedPacksRoot(): string {
  return packsRoot(app.getPath("userData"));
}
