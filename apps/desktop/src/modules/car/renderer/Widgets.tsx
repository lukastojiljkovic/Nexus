import { useCallback, useEffect, useState } from "react";
import { Chip, EmptyState, Icon, ListRow } from "@nexus/ui";
import {
  dateTimeFormat,
  type DashboardWidgetBodyProps,
  type DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { CarNextDueView } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * CAR's dashboard card: the next thing due, and which car it is on
 * (ADR-090 §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is
 * that file: the module brings its own card exactly as it brings its own page,
 * and the dashboard draws it with no edit to `DashboardWidgets.tsx`. What the kit
 * needs synchronously is `visible` -- which is why this module is loaded with the
 * dashboard rather than with a page.
 *
 * **Why it re-reads instead of trusting what it drew.** A due date passes while
 * the card is on screen (a day, an hour, a minute), and the answer changes
 * whenever anything is logged on the page. It re-reads once a minute: cheap, and
 * the card can be a minute behind a write somebody else made, which is the same
 * window the timer cards accept.
 *
 * **One row, not a list.** `shared/manifest.ts` says why: the card answers "what
 * is next", and the page is where the whole due list lives.
 */

/** How often the answer is read again -- the period at which "what is next" is asked. */
const RELOAD_MS = 60_000;

function NextDueWidget({ profileId }: DashboardWidgetBodyProps) {
  const [next, setNext] = useState<CarNextDueView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setNext(await window.nexus.modules.car.nextDue({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the car card could not be loaded:", error);
    } finally {
      setLoaded(true);
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
  if (!loaded) return <p className="nx-hint">{copy.widget.loading}</p>;
  if (next === null) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  return (
    <div className="car__widget">
      <ListRow
        leading={<Icon name="clock" />}
        trailing={
          <Chip variant={next.item.status === "overdue" ? "danger" : "accent"}>
            {next.item.status === "overdue" ? copy.due.overdue : copy.due.soon}
          </Chip>
        }
      >
        <span className="car__row-name">{next.vehicleName}</span>
        <span className="car__row-facts">
          {next.item.dueDate === null
            ? copy.categories[next.item.category]
            : `${copy.categories[next.item.category]} · ${formatDueDay(next.item.dueDate)}`}
        </span>
      </ListRow>
    </div>
  );
}

/** The due day as the locale writes it („8. jul 2026." / "8 July 2026"), through the shell's one `Intl` door. */
function formatDueDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : dateTimeFormat({ day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
        date,
      );
}

/**
 * The widgets this module publishes, by their OWN ids -- the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `sledece` is the id its contract declares in `shared/manifest.ts`, and the two
 * are compared by `modules.test.ts` through `ModuleRegistry.findWidget`, so a
 * typo here is a card the gallery offers and the page cannot draw -- which is a
 * failing test rather than a blank card.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  sledece: {
    Body: NextDueWidget,
    // The card's own module is the only flag that matters: what it draws IS a
    // vehicle of this module, so a profile with „Automobil" switched off has
    // nothing here to see.
    visible: (enabled) => enabled.has("car"),
  },
};
