import type { IconName } from "@nexus/ui";

/**
 * The RECORDER's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon
 * set, which the rail draws beside the module's name and the dashboard card
 * wears on its corner.
 *
 * **Why the name is here rather than in the manifest.** `moduleIcon.ts` records
 * the reason: `@nexus/core` must not learn about a renderer's icon set, and a
 * manifest is core's document.
 *
 * **Why the glyph itself was drawn in `@nexus/ui`.** Nothing in the set said
 * „capture sound": `play` is a transport control, `image` is a picture and
 * `attach` is a file. So `mic` was added there, following that file's house
 * rules (24×24 box, content inside 3…21, stroke only, one weight, round caps and
 * joins) — which is the one shared file a module edits by design.
 *
 * Eager on purpose, and not a contradiction of the lazy-page rule: this file
 * exports a NAME, imports nothing but a type, and the rail needs every module's
 * mark at startup. What must stay out of the startup chunk is the module's page
 * and its page copy, not the word „mic".
 */
export const iconName: IconName = "mic";
