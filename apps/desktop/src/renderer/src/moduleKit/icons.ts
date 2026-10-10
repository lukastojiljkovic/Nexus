import type { IconName } from "@nexus/ui";

/**
 * A kit module's own mark: `modules/<id>/renderer/icon.ts` exports `iconName`, a
 * name from `@nexus/ui`'s own icon set.
 *
 * **Why the module brings it rather than naming it in its manifest.**
 * `moduleIcon.ts` records the reason: `@nexus/core` must not learn about a
 * renderer's icon set. A manifest is core's document, so an icon name there
 * would be the coupling that comment forbids - and the module's own folder is
 * the right place for a file that is nothing but a renderer-facing name.
 *
 * Eager, and that is not a contradiction of the lazy-page rule: this file
 * exports a NAME, it imports nothing but a type, and the rail needs every
 * module's mark at startup. What must stay out of the startup chunk is the
 * module's page and its page copy, not the word "timer".
 */
const MODULE_ICONS: Record<string, { iconName: IconName }> = import.meta.glob(
  "../../../modules/*/renderer/icon.ts",
  { eager: true },
) as Record<string, { iconName: IconName }>;

/** The mark a discovered module declared, or `undefined` when it declared none. */
export function kitModuleIcon(id: string): IconName | undefined {
  return MODULE_ICONS[`../../../modules/${id}/renderer/icon.ts`]?.iconName;
}

/** Every module id whose icon this build discovered, for the discovery tests. */
export function kitIconIds(): readonly string[] {
  return Object.keys(MODULE_ICONS).map(
    (path) => /^\.\.\/\.\.\/\.\.\/modules\/([^/]+)\/renderer\/icon\.ts$/.exec(path)?.[1] ?? path,
  );
}
