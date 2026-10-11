/**
 * The scheme ZIM entries are served on, spelled once.
 *
 * It is a separate module because four places need the same word and they are in
 * three folders: `index.ts` registers it as privileged before the app is ready
 * (the one line that MUST be a literal in that array, so a reader of the
 * registration can see every scheme the app owns), `net/offline.ts` admits it to
 * the renderer's request allowlist, and the handler and the external-link rule
 * here parse and compare it. A scheme name typed four times is four chances to
 * mistype a word that fails silently — Chromium answers nothing at all for a
 * scheme nobody registered.
 *
 * The colon is part of the constant, because that is what a URL carries and what
 * the allowlist compares against.
 */
export const ZIM_SCHEME = "nx-zim";
