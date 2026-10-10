import { useCallback, useEffect, useState } from "react";
import { Chip, EmptyState, Icon, ListRow } from "@nexus/ui";
import type {
  DashboardWidgetBodyProps,
  DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { PantryView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { expiryChipVariant, expiryLabel, expiryWords, urgentItems } from "./pantryPage.js";

/**
 * OSTAVA's dashboard card: what is about to go off (ADR-090 §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is
 * that file: the module brings its own card exactly as it brings its own page,
 * and the dashboard draws it with no edit to `DashboardWidgets.tsx`. What the kit
 * needs synchronously is `visible` — which is why this module is loaded with the
 * dashboard rather than with a page.
 *
 * **Why it re-reads at all.** Nothing here ticks: the card's rows are expiry
 * verdicts, and a verdict moves when the day does. A minute-by-minute clock would
 * be a repaint per minute for a fact that changes at midnight, so the card reads
 * on mount and then on a slow interval, which is what catches a device that was
 * asleep through the day boundary.
 *
 * The list is the same list the page's first card draws, from the same helper
 * and the same view: the window, the ladder and the words cannot differ between
 * the two surfaces.
 */

/** How often the rows are read again. Five minutes: the verdicts move by the day, and this only has to notice that the day did. */
const RELOAD_MS = 300_000;

function ExpiringWidget({ profileId }: DashboardWidgetBodyProps) {
  const [view, setView] = useState<PantryView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await window.nexus.modules.pantry.list({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the pantry card could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handle = setInterval(() => void load(), RELOAD_MS);
    return () => clearInterval(handle);
  }, [load]);

  if (failed) return <p className="nx-hint">{copy.widget.loadError}</p>;
  if (view === null) return <p className="nx-hint">{copy.widget.loading}</p>;

  const urgent = urgentItems(view.items);
  if (urgent.length === 0) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  const words = expiryWords();

  return (
    <div className="pantry__widget">
      {urgent.map((item) => (
        <ListRow
          key={item.id}
          leading={<Icon name={item.status.expiry === "expired" ? "warning" : "clock"} />}
          trailing={
            <Chip variant={expiryChipVariant(item.status)}>{expiryLabel(item.status, words)}</Chip>
          }
        >
          <span className="pantry__row-name">{item.name}</span>
        </ListRow>
      ))}
    </div>
  );
}

/**
 * The widgets this module publishes, by their OWN ids — the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `isticanje` is the id its contract declares in `shared/manifest.ts`, and the
 * two are compared by `modules.test.ts` through `ModuleRegistry.findWidget`, so a
 * typo here is a card the gallery offers and the page cannot draw — which is a
 * failing test rather than a blank card.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  isticanje: {
    Body: ExpiringWidget,
    // The card's own module is the only flag that matters: what it draws IS the
    // pantry's own contents, so a profile with "Ostava" switched off has nothing
    // here to see.
    visible: (enabled) => enabled.has("pantry"),
  },
};
