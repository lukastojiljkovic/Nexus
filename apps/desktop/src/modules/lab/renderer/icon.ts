import type { IconName } from "@nexus/ui";

/**
 * THE LAB's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon set,
 * which the rail draws beside the module's name and the page header watermarks.
 *
 * **Why a glyph had to be added, and what it is.** The set already had two
 * instrument marks and neither fits: `electronics` is a chip, which is the module
 * that PLACES parts, and `tools` is a ruler, which is the drawer that measures.
 * This module reads a signal, so the shape is a square wave on a baseline — the
 * same waveform a scope draws and a generator produces — added to the set in the
 * set's own style (24×24, stroke only, one weight, straight segments).
 *
 * **Why the name is here rather than in the manifest.** `moduleIcon.ts` records
 * the reason: `@nexus/core` must not learn about a renderer's icon set, and a
 * manifest is core's document. The module's own folder is the right place for a
 * file that is nothing but a renderer-facing name.
 *
 * Eager on purpose: this file exports a NAME and imports nothing but a type, and
 * the rail needs every module's mark at startup. What must stay out of the
 * startup chunk is the module's page and its page copy, not the word „lab".
 */
export const iconName: IconName = "lab";
