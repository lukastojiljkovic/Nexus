import type { ModulePageIntent } from "../../../shared/moduleApi.js";
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
 * **The intent pair is passed through and never made.** `App.tsx` holds the item
 * one `nexus:open-location` request named and hands it to the page of the module
 * that request named (ADR-114); this component is the wire between the two and
 * decides nothing about it, which is also why a page that ignores the prop cannot
 * tell it was ever there.
 *
 * The suspension boundary belongs to `PageSlot`, which already knows how to keep
 * the previous page on screen while a chunk arrives and how to draw a failure if
 * one never does - so this component deliberately adds none.
 */
export function KitModulePage({
  id,
  profileId,
  intent,
  onIntentHandled,
}: {
  readonly id: string;
  readonly profileId: string;
  readonly intent: ModulePageIntent | null;
  readonly onIntentHandled: () => void;
}) {
  const Page = modulePage(id);
  if (Page === null) return null;
  return <Page profileId={profileId} intent={intent} onIntentHandled={onIntentHandled} />;
}
