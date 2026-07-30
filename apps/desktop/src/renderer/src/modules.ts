import { ModuleRegistry, type ModuleManifest, type WidgetContract } from "@nexus/core";

/**
 * The five dashboard cards the app draws today, declared as the contracts their
 * OWNING modules publish (DASH-002 / ADR-045). Until this slice they were five
 * hard-coded `<Card>`s in `DashboardPage.tsx`; the manifests are what turn them
 * into a catalogue the layout can be assembled from.
 *
 * `title` is the strings KEY path, not Serbian text (`WidgetContract.title`):
 * `"dashboard.today.title"` means `strings.dashboard.today.title`, so the copy
 * stays in the one file that holds all the copy and `@nexus/core` stays free of
 * user-facing prose.
 *
 * `id`s are ASCII, because a widget id is a key that ends up in the database
 * (`dashboard_widgets.widget_id`, qualified as `moduleId:widgetId`) — never a
 * label. Every one of the five accepts all three presets: none has content that
 * breaks at a third of the width, and a preset a widget genuinely cannot honour
 * is what `sizes` exists to withhold.
 *
 * `deepLink` is the module id whose page the card opens (DASH-005) — the two
 * CAL widgets and the TASK one deliberately point at their own modules rather
 * than at the dashboard they are drawn on.
 */
const CALENDAR_WIDGETS: WidgetContract[] = [
  // The agenda card: today's events, birthdays and tasks. Owned by CAL because
  // the day is a calendar concept, even though the tasks due today ride along.
  { id: "danas", title: "dashboard.today.title", sizes: ["S", "M", "L"], deepLink: "calendar" },
  // Tracked documents nearing their expiry (CAL-005).
  {
    id: "isticanja",
    title: "dashboard.expiring.title",
    sizes: ["S", "M", "L"],
    deepLink: "calendar",
  },
];

const TASKS_WIDGETS: WidgetContract[] = [
  {
    id: "predstojece",
    title: "dashboard.upcoming.title",
    sizes: ["S", "M", "L"],
    deepLink: "tasks",
  },
];

const STUDY_WIDGETS: WidgetContract[] = [
  { id: "ispiti", title: "study.dashboardTitle", sizes: ["S", "M", "L"], deepLink: "study" },
  {
    id: "ucenje",
    title: "study.dashboardStudyTitle",
    sizes: ["S", "M", "L"],
    deepLink: "study",
  },
];

/**
 * The v0 module set (roadmap "v0 — Founder Build"), as ADR-008 manifests:
 * identity plus the contract slots each module actually fills — `widgets` from
 * ADR-045 onward, the rest as each lands. Categories mirror the PRD 00 registry;
 * registration order follows the PRD numbering, and the sidebar groups them by
 * `MODULE_CATEGORIES` order with separators (DASH-008, decision #11).
 *
 * Only *built* modules are registered (founder decision 2026-07-12): an
 * unbuilt module must not appear anywhere — not in the sidebar, not in the
 * Settings module gallery — so nothing in the app leads to an empty page.
 * A module's manifest is added here in the same slice that ships its page.
 */
const V0_MODULES: ModuleManifest[] = [
  { id: "dashboard", prefix: "DASH", category: "Core experience", defaultEnabled: true },
  { id: "tasks", prefix: "TASK", category: "Core experience", defaultEnabled: true, widgets: TASKS_WIDGETS },
  { id: "calendar", prefix: "CAL", category: "Core experience", defaultEnabled: true, widgets: CALENDAR_WIDGETS },
  { id: "settings", prefix: "SET", category: "Core experience", defaultEnabled: true },
  { id: "notes", prefix: "NOTE", category: "Content & knowledge", defaultEnabled: true },
  { id: "study", prefix: "STUDY", category: "Life hubs", defaultEnabled: true, widgets: STUDY_WIDGETS },
];

/** Builds the renderer's registry. Constructed (not a singleton) per ADR-008. */
export function createModuleRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  for (const manifest of V0_MODULES) {
    registry.register(manifest);
  }
  return registry;
}
