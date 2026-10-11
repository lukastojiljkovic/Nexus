import { useCallback, useEffect, useState } from "react";
import { EmptyState, Icon, ListRow } from "@nexus/ui";
import type {
  DashboardWidgetBodyProps,
  DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { TimersView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { formatClock, isRunning, remainingSecondsOf } from "./timing.js";

/**
 * TIMERS' dashboard card: the countdowns that are running, and the time each has
 * left (ADR-090 §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is
 * that file: the module brings its own card exactly as it brings its own page,
 * and the dashboard draws it with no edit to `DashboardWidgets.tsx`. What the
 * kit needs synchronously is `visible` — which is why this module is loaded with
 * the dashboard rather than with a page.
 *
 * **Why it re-reads instead of trusting what it drew.** Main REMOVES a countdown
 * when it ends, so a card that only ticked would keep drawing a clock that has
 * been over for minutes. It ticks once a second for the clocks and re-reads once
 * a minute for the rows — cheap, and the two answers can only disagree for the
 * seconds between an end and the next read.
 *
 * The stopwatch is deliberately NOT here: its span lives in the page that
 * measures it, so a card for it would show a clock that stops whenever that page
 * is closed. `shared/manifest.ts` records that refusal beside the card it does
 * publish.
 */

/** How often the rows are read again — the period at which "is this still running" is asked. */
const RELOAD_MS = 60_000;

function CountdownsWidget({ profileId }: DashboardWidgetBodyProps) {
  const [view, setView] = useState<TimersView | null>(null);
  const [failed, setFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setView(await window.nexus.modules.timers.list({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the timers card could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handle = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);

  useEffect(() => {
    const handle = setInterval(() => void load(), RELOAD_MS);
    return () => clearInterval(handle);
  }, [load]);

  if (failed) return <p className="nx-hint">{copy.widget.loadError}</p>;
  if (view === null) return <p className="nx-hint">{copy.widget.loading}</p>;

  // A countdown that has just been announced is already gone from main's tables,
  // and this card may be a second behind that read: a row at zero is dropped
  // here rather than drawn as „00:00" until the next reload.
  const running = view.countdowns.filter(
    (countdown) => isRunning(countdown) && remainingSecondsOf(countdown, nowMs) > 0,
  );
  const paused = view.countdowns.filter((countdown) => !isRunning(countdown));

  if (running.length === 0 && paused.length === 0) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  return (
    <div className="timers__widget">
      {[...running, ...paused].map((countdown) => (
        <ListRow key={countdown.id} leading={<Icon name="clock" />}>
          <span className="timers__row-label">{countdown.label}</span>
          <span className="timers__row-clock">
            {formatClock(remainingSecondsOf(countdown, nowMs))}
          </span>
        </ListRow>
      ))}
    </div>
  );
}

/**
 * The widgets this module publishes, by their OWN ids — the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `odbrojavanja` is the id its contract declares in `shared/manifest.ts`, and the
 * two are compared by `modules.test.ts` through `ModuleRegistry.findWidget`, so a
 * typo here is a card the gallery offers and the page cannot draw — which is a
 * failing test rather than a blank card.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  odbrojavanja: {
    Body: CountdownsWidget,
    // The card's own module is the only flag that matters: what it draws IS a
    // countdown of this module, so a profile with „Tajmeri" switched off has
    // nothing here to see.
    visible: (enabled) => enabled.has("timers"),
  },
};
