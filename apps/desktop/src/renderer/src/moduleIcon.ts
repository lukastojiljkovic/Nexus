import type { IconName } from "@nexus/ui";

/**
 * The mark a module wears: beside its name in the rail, and on every dashboard
 * card it publishes. ONE table on purpose. The card's mark exists so that
 * „which module is this" is answered by recognising the glyph the sidebar lists
 * the module under — and that only works while it IS that glyph.
 *
 * It lives here rather than in `App.tsx` for `moduleName.ts`'s reason: `App.tsx`
 * imports every page, so a page cannot import it back. Until 2026-09-26 that is
 * exactly why there were two copies of this table — the rail's in `App.tsx`, the
 * dashboard's in `DashboardPage.tsx` — agreeing on every entry they shared,
 * while the dashboard's said in prose that it was the rail's glyph.
 *
 * Deliberately a lookup and not a field on the manifest: `@nexus/core` must not
 * learn about a renderer's icon set.
 */
const MODULE_ICONS: Readonly<Record<string, IconName>> = {
  dashboard: "dashboard",
  tasks: "tasks",
  calendar: "calendar",
  settings: "settings",
  notes: "notes",
  priv: "priv",
  files: "files",
  study: "study",
  finance: "finance",
  habits: "habits",
  fitness: "fitness",
  tools: "tools",
  pro: "pro",
  focus: "focus",
  canvas: "canvas",
  electronics: "electronics",
};

/**
 * A module's mark, or `undefined` when the set does not cover it — its name
 * alone in the rail, a plain caption on a card, rather than a placeholder box or
 * somebody else's identity. Own keys only: the dashboard asks with the module
 * half of a STORED layout row, and `toString` is not a module.
 */
export function moduleIconName(id: string): IconName | undefined {
  return Object.hasOwn(MODULE_ICONS, id) ? MODULE_ICONS[id] : undefined;
}
