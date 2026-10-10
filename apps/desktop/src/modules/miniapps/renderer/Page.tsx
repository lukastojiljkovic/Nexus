import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, Icon, LoadingState, PageHeader, type IconName } from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import { MINIAPPS_APP_IDS, type MiniappsAppId, type MiniappsView } from "../shared/ipc.js";
import { DiceApp } from "./apps/DiceApp.js";
import { DatesApp } from "./apps/DatesApp.js";
import { MetronomeApp } from "./apps/MetronomeApp.js";
import { QrApp } from "./apps/QrApp.js";
import { ScoreboardApp } from "./apps/ScoreboardApp.js";
import { ScreenLightApp } from "./apps/ScreenLightApp.js";
import { TallyApp } from "./apps/TallyApp.js";
import { TypingApp } from "./apps/TypingApp.js";
import { WorldClockApp } from "./apps/WorldClockApp.js";
import type { MiniAppProps, Run } from "./apps/contract.js";
import { copy } from "./copy.js";
import "./miniapps.css";

/**
 * MINI APLIKACIJE (ADR-090) - nine small tools behind one grid of tiles.
 *
 * **The grid is the module, and a tile opens in place.** The alternative was
 * nine sidebar entries for a metronome and a coin flip, which is a rail nobody
 * can read; so the page opens on the grid, a tile replaces the grid with its own
 * tool, and the header's own back control returns. The tile that was open last
 * is remembered (`setLastApp`), which is the whole of this page's own state: a
 * user who works on a scoreboard every evening opens the module onto the
 * scoreboard.
 *
 * **One read, one write path, one error line.** The page holds the kept document
 * exactly as main answered it and hands each tool a `run` that performs one
 * write and folds the answer back in. So no tool ever renders a guess, and a
 * failed write is reported in the page's own line rather than in nine different
 * places with nine different sentences.
 *
 * **Escape closes what it opened**, and it is handled HERE rather than in each
 * tool: one listener means the behaviour cannot be true of eight tools and
 * missing from the ninth, and it is what makes the screen light's own "press Esc"
 * promise true without the screen light knowing how the shell works.
 */

/** The glyph each tile wears. The `@nexus/ui` set draws all nine; a new one is a shared-set change, so none is drawn for a tool that fits an existing shape. */
const TILE_ICONS: Record<MiniappsAppId, IconName> = {
  metronome: "timer",
  dice: "star",
  tally: "list",
  scoreboard: "target",
  typing: "keyboard",
  dates: "calendar",
  worldclock: "globe",
  screenlight: "sun",
  qr: "image",
};

export default function MiniappsPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<MiniappsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MiniappsAppId | null>(null);
  /** Whether the kept tile has already been applied - see the seeding effect below. */
  const [seeded, setSeeded] = useState(false);

  const run = useCallback<Run>(async (action) => {
    try {
      setView(await action(window.nexus.modules.miniapps));
      setError(null);
    } catch (failure) {
      setError(copy.errors.mutate);
      console.error("Nexus: a mini-apps change failed:", failure);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.miniapps.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the mini apps could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Which tile the module opens on, taken from the kept document ONCE.
   *
   * Once, and not on every read: a read follows every write, so a rule that
   * reopened on each one would drag the user back to the tile the store
   * remembers the moment they wrote anything - which is exactly what the back
   * control is for.
   */
  useEffect(() => {
    if (view === null || seeded) return;
    setSeeded(true);
    if (view.lastApp !== null) setOpen(view.lastApp);
  }, [view, seeded]);

  /** Opens a tile (or the grid) and remembers the choice. */
  const show = useCallback(
    (app: MiniappsAppId | null): void => {
      setOpen(app);
      void run((api) => api.setLastApp({ profileId, app }));
    },
    [profileId, run],
  );

  useEffect(() => {
    if (open === null) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") show(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, show]);

  const appProps: MiniAppProps | null =
    view === null ? null : { profileId, view, run };

  return (
    <div className="miniapps">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, so the rail and this header cannot disagree
          about what the module is called (ADR-090's copy split). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="grid"
        actions={
          open !== null ? (
            <Button size="sm" onClick={() => show(null)}>
              {copy.actions.back}
            </Button>
          ) : undefined
        }
      />
      {error !== null && (
        <p className="miniapps__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : open === null ? (
        <div className="miniapps__grid">
          <p className="nx-hint miniapps__grid-hint">{copy.grid.hint}</p>
          {MINIAPPS_APP_IDS.map((id) => (
            <button key={id} type="button" className="miniapps__tile" onClick={() => show(id)}>
              <span className="miniapps__tile-mark" aria-hidden="true">
                <Icon name={TILE_ICONS[id]} size={22} />
              </span>
              <span className="miniapps__tile-name">{copy.apps[id].name}</span>
              <span className="miniapps__tile-hint">{copy.apps[id].hint}</span>
            </button>
          ))}
        </div>
      ) : appProps === null ? (
        <EmptyState title={copy.page.loading} />
      ) : (
        <>
          <h2 className="miniapps__app-title">{copy.apps[open].name}</h2>
          {open === "metronome" && <MetronomeApp />}
          {open === "dice" && <DiceApp {...appProps} />}
          {open === "tally" && <TallyApp {...appProps} />}
          {open === "scoreboard" && <ScoreboardApp {...appProps} />}
          {open === "typing" && <TypingApp {...appProps} />}
          {open === "dates" && <DatesApp />}
          {open === "worldclock" && <WorldClockApp {...appProps} />}
          {open === "screenlight" && <ScreenLightApp onLeave={() => show(null)} />}
          {open === "qr" && <QrApp />}
        </>
      )}
    </div>
  );
}
