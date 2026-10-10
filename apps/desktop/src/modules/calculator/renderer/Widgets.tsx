import { useCallback, useEffect, useState } from "react";
import { EmptyState, ListRow } from "@nexus/ui";
import type {
  DashboardWidgetBodyProps,
  DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { CalculatorView } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * CALCULATOR's dashboard card: the results computed most recently (ADR-090
 * §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is that
 * file: the module brings its own card exactly as it brings its own page, and the
 * dashboard draws it with no edit to `DashboardWidgets.tsx`. What the kit needs
 * synchronously is `visible` - which is why this module is loaded with the
 * dashboard rather than with a page.
 *
 * **Why the card does not tick.** A result changes only when somebody computes
 * one, and the card is drawn on a page the user arrives at by leaving the
 * calculator - which remounts it. A timer here would re-read a local table sixty
 * times a minute to find the same three rows (`timers/renderer/Widgets.tsx` does
 * tick, and for the opposite reason: a countdown changes without anybody acting).
 */

/**
 * How many results the card draws. Three is what fits a row per result at `S`
 * without the card becoming a list, and the card's own contract declares no cap
 * knob (`shared/manifest.ts`) because this is the whole of what it exists to show.
 */
const ROWS = 3;

function ResultsWidget({ profileId }: DashboardWidgetBodyProps) {
  const [view, setView] = useState<CalculatorView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await window.nexus.modules.calculator.list({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the calculator card could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="nx-hint">{copy.widget.loadError}</p>;
  if (view === null) return <p className="nx-hint">{copy.widget.loading}</p>;

  const rows = view.history.slice(0, ROWS);
  if (rows.length === 0) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  return (
    <div className="calculator__widget">
      {rows.map((entry) => (
        <ListRow key={entry.id}>
          <span className="calculator__widget-expression">{entry.expression}</span>
          <span className="calculator__widget-value">{entry.result}</span>
        </ListRow>
      ))}
    </div>
  );
}

/**
 * The widgets this module publishes, by their OWN ids - the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `poslednji` is the id its contract declares in `shared/manifest.ts`, and the two
 * are compared by `modules.test.ts` through `ModuleRegistry.findWidget`, so a typo
 * here is a card the gallery offers and the page cannot draw - which is a failing
 * test rather than a blank card.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  poslednji: {
    Body: ResultsWidget,
    // The card's own module is the only flag that matters: what it draws IS a
    // result of this module, so a profile with „Kalkulator" switched off has
    // nothing here to see.
    visible: (enabled) => enabled.has("calculator"),
  },
};
