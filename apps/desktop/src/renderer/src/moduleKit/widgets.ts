import type { DashboardWidgetRenderer } from "../dashboardWidgets.js";

/**
 * The dashboard half of the kit's discovery: a kit module's widget bodies, from
 * `modules/<id>/renderer/Widgets.tsx` (ADR-090).
 *
 * **Why this glob is eager, when the page's is not.** A placement's `visible`
 * is asked SYNCHRONOUSLY, while the page decides what to draw, and an answer
 * that arrived with a chunk could not be one. So the module's widget map is
 * loaded with the dashboard — and that is deliberately not "in the startup
 * chunk": `dashboardWidgets.tsx` is itself reached only through the lazily
 * loaded `DashboardPage`, so a module's widget body costs nothing on a launch
 * that never opens the dashboard. What must stay out of the startup chunk is the
 * module's PAGE and its page copy, and neither of them is here.
 *
 * **The contract a module's file owes.** `Widgets.tsx` exports `widgets`, a map
 * from the module's own widget id to the same `DashboardWidgetRenderer` a
 * compiled-in widget is: a body, and a `visible` predicate. Keyed by the bare id
 * rather than the qualified one, because the module's own id is the folder it
 * lives in — spelling it twice is how the two get to disagree.
 */
interface ModuleWidgets {
  readonly widgets: Readonly<Record<string, DashboardWidgetRenderer>>;
}

const MODULE_WIDGETS: Record<string, ModuleWidgets> = import.meta.glob(
  "../../../modules/*/renderer/Widgets.tsx",
  { eager: true },
) as Record<string, ModuleWidgets>;

/**
 * The renderer for one QUALIFIED widget id — `moduleId:widgetId`, exactly as a
 * stored layout row spells it — or `undefined` when this build publishes no such
 * widget.
 *
 * The id is split at the FIRST colon for `ModuleRegistry.findWidget`'s reason: a
 * module id never contains one, so anything after a second colon could only be a
 * malformed id, which resolves to nothing.
 */
export function kitWidgetRenderer(qualifiedId: string): DashboardWidgetRenderer | undefined {
  const separator = qualifiedId.indexOf(":");
  if (separator <= 0) return undefined;
  const moduleId = qualifiedId.slice(0, separator);
  const widgetId = qualifiedId.slice(separator + 1);
  return MODULE_WIDGETS[`../../../modules/${moduleId}/renderer/Widgets.tsx`]?.widgets[widgetId];
}

/** Every qualified widget id a kit module published, for the discovery tests. */
export function kitWidgetIds(): readonly string[] {
  const ids: string[] = [];
  for (const [path, module] of Object.entries(MODULE_WIDGETS)) {
    const moduleId = /^\.\.\/\.\.\/\.\.\/modules\/([^/]+)\/renderer\/Widgets\.tsx$/.exec(path)?.[1];
    if (moduleId === undefined) continue;
    for (const widgetId of Object.keys(module.widgets)) ids.push(`${moduleId}:${widgetId}`);
  }
  return ids;
}
