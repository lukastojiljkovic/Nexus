import { modulePage } from "./pages.js";

/**
 * THE generic path the shell draws a kit module's page through: one component
 * for every discovered module, instead of a `shownId === "..."` branch each.
 *
 * It exists so `App.tsx` gains one case - "the shown id is a discovered module"
 * - rather than twenty. What the branch per module was doing beyond passing
 * `profileId` (an intent, an enabled-module set, an overlay profile) is exactly
 * the coupling the kit removes: a module reaches its own stores through its own
 * contract.
 *
 * The suspension boundary belongs to `PageSlot`, which already knows how to keep
 * the previous page on screen while a chunk arrives and how to draw a failure if
 * one never does - so this component deliberately adds none.
 */
export function KitModulePage({
  id,
  profileId,
}: {
  readonly id: string;
  readonly profileId: string;
}) {
  const Page = modulePage(id);
  if (Page === null) return null;
  return <Page profileId={profileId} />;
}
