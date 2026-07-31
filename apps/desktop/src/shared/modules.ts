import { ModuleRegistry, type ModuleManifest, type WidgetContract } from "@nexus/core";

/**
 * The dashboard cards the app can draw, declared as the contracts their OWNING
 * modules publish (DASH-002 / ADR-045). Until that slice five of them were
 * hard-coded `<Card>`s in `DashboardPage.tsx`; the manifests are what turn them
 * into a catalogue the layout can be assembled from.
 *
 * The catalogue is bigger than the DEFAULT layout, and deliberately so: the
 * five in `DEFAULT_DASHBOARD_LAYOUT` are what a new profile opens onto, and
 * every other card here is one the user adds himself from „Dodaj vidžet“.
 *
 * `title` is the strings KEY path, not Serbian text (`WidgetContract.title`):
 * `"dashboard.today.title"` means `strings.dashboard.today.title`, so the copy
 * stays in the one file that holds all the copy and `@nexus/core` stays free of
 * user-facing prose.
 *
 * `id`s are ASCII, because a widget id is a key that ends up in the database
 * (`dashboard_widgets.widget_id`, qualified as `moduleId:widgetId`) — never a
 * label. `sizes` is what a widget uses to withhold a preset it cannot honour:
 * the five original cards accept all three, while the two strictly-capped
 * five-row lists (`hitno-kasni`, `nedavno`) stop at M — a row of theirs is a
 * title and one chip, and a full-width card would be mostly empty space.
 *
 * `deepLink` is the module id whose page the card opens (DASH-005) — every
 * widget deliberately points at its own module rather than at the dashboard it
 * is drawn on.
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
  // „Kasni“ and „Hitno“ (ADR-049) as one card — the two smart lists that answer
  // „šta je već trebalo da bude gotovo, i šta gori“.
  {
    id: "hitno-kasni",
    title: "dashboard.urgent.title",
    sizes: ["S", "M"],
    deepLink: "tasks",
  },
];

/** NOTE's first dashboard card: the notes touched most recently (DASH-003). */
const NOTES_WIDGETS: WidgetContract[] = [
  {
    id: "nedavno",
    title: "dashboard.recentNotes.title",
    sizes: ["S", "M"],
    deepLink: "notes",
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
 * The v0 module set (roadmap "v0 — Founder Build"), as ADR-008 manifests.
 *
 * Lives in `shared/` (moved from the renderer, ADR-058 §5) because BOTH
 * processes now resolve the same enabled set from it: the renderer for the
 * sidebar/routes/palette commands, main for the search-result module gate
 * (`searchGate.ts`) — two hand-copied manifest lists would be exactly the
 * drift `BUSINESS_DEFAULT_FLAGS`'s comment warns about. Imports nothing but
 * `@nexus/core`, so neither side links anything new.
 *
 * The manifests themselves:
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
  { id: "notes", prefix: "NOTE", category: "Content & knowledge", defaultEnabled: true, widgets: NOTES_WIDGETS },
  // Private notes (ADR-057): OFF by default — first enabled from the Moduli
  // gallery, deliberately. It contributes NO widgets and NO searchIndexers:
  // while the section is locked nothing of it may render anywhere — no
  // dashboard card, no palette hit, no titles — and a contract slot filled
  // here would be exactly such a surface.
  { id: "priv", prefix: "PRIV", category: "Content & knowledge", defaultEnabled: false },
  { id: "study", prefix: "STUDY", category: "Life hubs", defaultEnabled: true, widgets: STUDY_WIDGETS },
];

/** Builds the app's registry — each process constructs its own (not a singleton) per ADR-008. */
export function createModuleRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  for (const manifest of V0_MODULES) {
    registry.register(manifest);
  }
  return registry;
}
