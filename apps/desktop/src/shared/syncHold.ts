/**
 * The one switch that says the sync, cloud and web work is ON HOLD.
 *
 * On 2026-10-08 the founder put sync, cloud and the web app on hold permanently
 * until the desktop is complete (CLAUDE.md, „Current focus"), and pull request
 * #54 removed them from everything a reader outside the app sees. The code
 * itself stays built, tested and OFF — `main/sync/`, the five `sync-*` packages,
 * the server migrations — **hidden, not deleted**. This file is the whole of the
 * hiding: flipping `SYNC_ON_HOLD` back to `false` restores the settings card,
 * its search entries and its screenshot scene, and nothing else has to be
 * remembered.
 *
 * It lives in `shared/` because two processes read it: the renderer (the
 * settings page, its category table and its search index) and main (the
 * screenshot scenes). A flag that hid the card in the UI while the sweep went on
 * photographing it would be the worst of both, and the two sides cannot drift
 * if they read one constant.
 */

/** On hold since 2026-10-08. Flip this, and nothing else, to bring the surface back. */
export const SYNC_ON_HOLD = true;

/**
 * The settings cards this hold owns, by section id — the shell ids a card is
 * drawn under (`strings.settings.sectionTitle`).
 *
 * One id today. It is a list rather than a literal inside each caller because
 * „which cards does the hold cover" is a fact about the hold: a second card
 * joining it should be a line here, not a hunt through the settings page, its
 * search index and the sweep.
 */
export const SYNC_HELD_SETTINGS_CARD_IDS: readonly string[] = ["sync"];

/**
 * The screenshot scenes this hold owns, by scene id (`main/shots/index.ts`).
 *
 * Not derived from the card id above: a scene id is a file-name stem rather
 * than a settings id, and a scene that photographed the same card from another
 * angle would have to be named here anyway.
 */
export const SYNC_HELD_SHOT_SCENE_IDS: readonly string[] = ["settings-sync"];

/** Whether a settings card is one this hold hides. */
export function isSettingsCardHeld(sectionId: string): boolean {
  return SYNC_ON_HOLD && SYNC_HELD_SETTINGS_CARD_IDS.includes(sectionId);
}

/** Whether a screenshot scene is one this hold hides. */
export function isShotSceneHeld(sceneId: string): boolean {
  return SYNC_ON_HOLD && SYNC_HELD_SHOT_SCENE_IDS.includes(sceneId);
}
