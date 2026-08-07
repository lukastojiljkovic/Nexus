import { isAlwaysOnSource, type NotificationSource } from "@nexus/core";

/**
 * Which module owns each notification source — `searchGate.ts`'s
 * `SEARCH_KIND_MODULE`, one subsystem over, and for the same reason.
 *
 * SET-007 lets a profile switch a module off, and switching one off has always
 * meant it stops appearing: out of the sidebar, off the dashboard, and (since
 * ADR-058 §5) out of search results. **Notifications were the one surface that
 * never asked.** The scheduler intersected its candidates with
 * `settings.enabledSources` — the NTF appetite toggles — and nothing else, so a
 * business profile with STUDY off still received exam reminders, and a profile
 * with HABIT off was still nudged about habits it could not see.
 *
 * Stated once and shared, because it had already been written twice: this map
 * lived privately inside `NotificationCenter.tsx`, where it deep-links a row to
 * the page that owns it. Two copies of "which module owns this source" is the
 * shape a rule drifts in.
 */
export const NOTIFICATION_SOURCE_MODULE: Readonly<Record<NotificationSource, string>> = {
  document: "calendar",
  exam: "study",
  "study-day": "study",
  event: "calendar",
  task: "tasks",
  security: "settings",
  subscription: "finance",
  habit: "habits",
};

/**
 * The appetite toggles a profile has on, narrowed to the modules it actually
 * runs. An always-on source (`security`) is never narrowed: it is not about a
 * module the user chose, it is about their account, and `isDeliverable` already
 * exempts it from every other gate for the same reason.
 */
export function sourcesForEnabledModules(
  enabledSources: readonly NotificationSource[],
  enabledModuleIds: ReadonlySet<string>,
): NotificationSource[] {
  return enabledSources.filter(
    (source) => isAlwaysOnSource(source) || enabledModuleIds.has(NOTIFICATION_SOURCE_MODULE[source]),
  );
}
