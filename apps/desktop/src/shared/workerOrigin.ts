/**
 * Whether a message that arrived at a dedicated worker came from the document
 * that created it.
 *
 * **Why the empty string counts as this app's own origin.** The packaged desktop
 * app loads its renderer with `win.loadFile(...)`, so the page's origin is a
 * `file:` one. Chromium then spells that origin two ways: `location.origin` on
 * both sides of the worker is the string `"file://"`, while the `origin` a
 * message actually carries across is the empty string. Both were measured in the
 * shipped Electron on Windows (2026-10-11), and a guard that compared only
 * against `location.origin` would have refused every message the app sends -
 * every PDF job, board move, map search and chess position among them.
 *
 * A dedicated worker has exactly one client, the document that created it, so
 * those two spellings are the whole of what a legitimate message can carry. Any
 * other origin did not come from this app and is refused.
 */
export function isOwnOrigin(origin: string, ownOrigin: string): boolean {
  return origin === ownOrigin || origin === "";
}
