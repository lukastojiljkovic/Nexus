import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, Icon, ListRow } from "@nexus/ui";
import { parseWidgetConfig } from "@nexus/core";
import type {
  DashboardWidgetBodyProps,
  DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { dateTimeFormat } from "../../../renderer/src/intl.js";
import type { CultureView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { bareDayOf, upcomingPlans } from "./view.js";

/**
 * CULTURE's dashboard card: what the programme has ahead (ADR-090 §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is
 * that file: the module brings its own card exactly as it brings its own page,
 * and the dashboard draws it with no edit to `DashboardWidgets.tsx`.
 *
 * **Why it re-reads rather than trusting what it drew.** The card is about
 * dates, and a date passing is what makes a row leave the list - which happens
 * with no event this card can hear. It re-reads once a minute, which is cheap
 * and keeps the day's boundary from being the thing that is wrong on screen.
 *
 * The row cap is the contract's own (`configFields`), read through
 * `parseWidgetConfig` - so a stored config that cannot be read falls back to how
 * the card ships rather than breaking it.
 */

/** How often the rows are read again - the period at which "is this still ahead" is asked. */
const RELOAD_MS = 60_000;

function ProgrammeWidget({ profileId, contract, config }: DashboardWidgetBodyProps) {
  const [view, setView] = useState<CultureView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await window.nexus.modules.culture.list({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the culture card could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handle = setInterval(() => void load(), RELOAD_MS);
    return () => clearInterval(handle);
  }, [load]);

  const today = bareDayOf(new Date());
  const count = parseWidgetConfig(contract, config)["count"];
  const limit = typeof count === "number" ? count : 5;
  const rows = useMemo(
    () => (view === null ? [] : upcomingPlans(view.plans, today).slice(0, limit)),
    [limit, today, view],
  );

  if (failed) return <p className="nx-hint">{copy.widget.loadError}</p>;
  if (view === null) return <p className="nx-hint">{copy.widget.loading}</p>;
  if (rows.length === 0) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  return (
    <div className="culture__widget">
      {rows.map((plan) => (
        <ListRow
          key={plan.id}
          leading={<Icon name="museum" />}
          // The day through the shell's one door to `Intl`, so a card in
          // English writes „1 Jul" and the same card in Serbian „1. jul".
          trailing={
            <span className="culture__row-clock">
              {dateTimeFormat({ day: "numeric", month: "short" }).format(
                new Date(`${plan.date}T00:00:00`),
              )}
            </span>
          }
        >
          <span className="culture__row-title">{plan.title}</span>
          <span className="culture__row-meta">{plan.venue}</span>
        </ListRow>
      ))}
    </div>
  );
}

/**
 * The widgets this module publishes, by their OWN ids - the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `program` is the id its contract declares in `shared/manifest.ts`, and the
 * two are compared by `modules.test.ts` through `ModuleRegistry.findWidget`, so
 * a typo here is a failing test rather than a blank card.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  program: {
    Body: ProgrammeWidget,
    // The card's own module is the only flag that matters: what it draws is
    // this module's programme, so a profile with „Kultura" switched off has
    // nothing here to see.
    visible: (enabled) => enabled.has("culture"),
  },
};
