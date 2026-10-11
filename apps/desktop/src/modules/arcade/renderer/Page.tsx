import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Icon, ListRow, LoadingState, PageHeader } from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import {
  ARCADE_GAME_IDS,
  type ArcadeGameId,
  type ArcadeResultPayload,
  type ArcadeView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import { boardFacts, boardHeadline, gameName, shelfDetail, shelfFigure } from "./labels.js";
import { minesweeperBoardVariants, rowFor } from "./stats.js";
import { boardLabel } from "./variants.js";
import { BlocksGame } from "./games/Blocks.js";
import { BricksGame } from "./games/Bricks.js";
import { MinesweeperGame } from "./games/Minesweeper.js";
import { SnakeGame } from "./games/Snake.js";
import { Tile2048Game } from "./games/Tile2048.js";
import "./arcade.css";

/**
 * ARKADA (ADR-090) - five games, one shelf, one page.
 *
 * **The shelf is the page's spine.** Five buttons, each carrying its game's name
 * and its best figure, and the one that is picked opens below in place - which is
 * the whole product: a person arrives to play one thing for five minutes, and
 * everything about the other four stays out of the way until they are asked for.
 *
 * **Switching games ends the game in progress, deliberately.** These five games
 * have no saved game and no store for one (migration 080 keeps a profile's totals
 * and nothing else), so the honest promise is the one the page keeps: leaving a
 * board abandons it. A half-saved Blocks stack restored into a different board
 * size would be a worse lie than a board that is simply gone.
 *
 * **The page writes and the games do not.** Only this component talks to main:
 * a game reports a finished result through `onFinish`, the page folds it in, and
 * what comes back is the whole view again - so the shelf and the stats table can
 * never disagree with the numbers a game just produced.
 *
 * **No engine runs in a Web Worker, and that is a measurement of the work rather
 * than a preference.** The kit's rule is for heavy computation - a solver, a
 * search, a model - and what these five games do per frame is one array copy:
 * Blocks copies 264 cells (12 x 22), Snake 400, Bricks 286, and the largest thing
 * anywhere in the module is Minesweeper's 720-cell shuffle on the first click of
 * a custom 30 x 24 board. A worker would pay a structured clone of the whole
 * state, out and back, to move that same copy off the thread that has to paint
 * the canvas anyway - and the canvas cannot be painted from a worker without
 * giving up `requestAnimationFrame`, which is the clock every one of these games
 * steps on. What the page does instead is the cheap half of the same idea: a
 * frame with nothing due hands React the state it already had, so an idle frame
 * costs one subtraction (`loop.ts`'s `planTicks`).
 *
 * **Nothing here animates, and nothing makes a sound.** The reduced-motion
 * preference is honoured by the product-wide rule in `@nexus/ui`'s stylesheet
 * (every transition this page writes collapses under it) and, for the one effect
 * that is not CSS, by `flashDurationMs`: a cleared line lights its count for
 * 180 ms, and under reduced motion the flag is never raised at all - disabled
 * rather than shortened, which is the design system's own wording. Sound is not
 * off by default here; it is absent, which is why the manifest declares no sound
 * preference to switch.
 */

export default function ArcadePage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<ArcadeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ArcadeGameId>(ARCADE_GAME_IDS[0] ?? "minesweeper");

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.arcade.list({ profileId }));
      setError(null);
    } catch (failure) {
      // No toast and no dialog: a page that cannot read says so in its own body
      // and keeps saying so until a read works.
      setError(copy.errors.load);
      console.error("Nexus: the arcade scores could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * The one write: a finished game, whatever game it was.
   *
   * The answered view replaces the one on screen rather than being merged into
   * it, because main has just told this page exactly what the profile's rows now
   * are - and a local guess applied on top of that would be a second answer to a
   * question that has one.
   */
  const record = useCallback(
    async (result: ArcadeResultPayload) => {
      try {
        setView(await window.nexus.modules.arcade.record({ profileId, result }));
        setError(null);
      } catch (failure) {
        setError(copy.errors.record);
        console.error("Nexus: the arcade score was not saved:", failure);
      }
    },
    [profileId],
  );

  return (
    <div className="arcade">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, rather than a second copy of it: the rail, the
          settings gallery and this header then cannot disagree about what the
          module is called. */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="arcade"
      />
      {error !== null && (
        <p className="arcade__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={3} />
      ) : (
        <>
          <Card className="arcade__card" title={copy.shelf.title}>
            <div className="arcade__shelf" role="group" aria-label={copy.shelf.title}>
              {ARCADE_GAME_IDS.map((game) => (
                <Button
                  key={game}
                  size="sm"
                  className="nx-segmented__option arcade__shelf-item"
                  // The app's one selection grammar: the announced state and the
                  // painted state are the same attribute.
                  aria-pressed={selected === game}
                  onClick={() => setSelected(game)}
                >
                  <span className="arcade__shelf-name">{gameName(game)}</span>
                  <span className="arcade__shelf-figure">{shelfFigure(view, game)}</span>
                  <span className="nx-hint">{shelfDetail(view, game)}</span>
                </Button>
              ))}
            </div>
          </Card>
          <StatsCard view={view} game={selected} />
          {selected === "minesweeper" && <MinesweeperGame onFinish={record} />}
          {selected === "blocks" && <BlocksGame onFinish={record} />}
          {selected === "snake" && <SnakeGame onFinish={record} />}
          {selected === "bricks" && <BricksGame onFinish={record} />}
          {selected === "tile2048" && <Tile2048Game onFinish={record} />}
        </>
      )}
    </div>
  );
}

/**
 * The selected game's boards, one row each.
 *
 * A row is a board, because that is what the store keys by: Minesweeper's three
 * presets are drawn whether or not they have been played (so the table shows the
 * game's shapes), a custom board appears once one exists, and the four games with
 * one board show that board. A board nobody has played says so under its
 * headline rather than being left out - the table is the module's answer to "what
 * have I done here", and "nothing yet" is an answer.
 */
function StatsCard({ view, game }: { readonly view: ArcadeView; readonly game: ArcadeGameId }) {
  const boards =
    game === "minesweeper"
      ? minesweeperBoardVariants(view)
      : view.scores.filter((row) => row.game === game).map((row) => row.variant);
  const rows = boards.length === 0 ? [game === "tile2048" ? "4x4" : "standard"] : boards;

  return (
    <Card className="arcade__card" title={copy.stats.title}>
      {/* The trailing figure per row is named once, above the rows: a time and a
          score are read differently, and a bare number with no word beside it
          would be a reader's guess. */}
      <p className="nx-hint">{game === "minesweeper" ? copy.stats.bestTime : copy.stats.bestScore}</p>
      {view.scores.length === 0 ? (
        <EmptyState variant="inline" title={copy.stats.empty} />
      ) : (
        <div className="arcade__rows">
          {rows.map((variant) => {
            const row = rowFor(view, game, variant);
            const facts = boardFacts(row, game);
            return (
              <ListRow
                key={variant}
                leading={<Icon name="grid" />}
                trailing={<span className="arcade__board-headline">{boardHeadline(row, game)}</span>}
              >
                <span className="arcade__board-name">{boardLabel(game, variant)}</span>
                <span className="arcade__board-facts">
                  {facts.length === 0
                    ? copy.stats.unplayed
                    : facts.map((fact) => `${fact.label} ${fact.value}`).join(" · ")}
                </span>
              </ListRow>
            );
          })}
        </div>
      )}
    </Card>
  );
}
