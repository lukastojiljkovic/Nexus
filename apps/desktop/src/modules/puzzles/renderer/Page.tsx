import { useCallback, useEffect, useId, useState } from "react";
import { Button, Card, EmptyState, ListRow, LoadingState, PageHeader } from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import {
  activeLocale,
  declaredText,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import type { PuzzleId, PuzzlesApi, PuzzlesView } from "../shared/ipc.js";
import { BrojPanel } from "./BrojPanel.js";
import { MahjongPanel } from "./MahjongPanel.js";
import { NonogramPanel } from "./NonogramPanel.js";
import { SudokuPanel } from "./SudokuPanel.js";
import { copy } from "./copy.js";
import { openRequestOf, type OpenRequest } from "./intent.js";
import { formatClock, formatCount } from "./format.js";
import {
  variantLabel,
  type ClearInput,
  type FinishInput,
  type SaveInput,
} from "./panelKit.js";
import "./puzzles.css";

/**
 * SLAGALICE (ADR-090) — four puzzles in one module, each of them a board that
 * can be left and come back to.
 *
 * **One page, four panels, and the page owns the writes.** A panel edits its own
 * board — that is where the state is, and no other surface needs it — while the
 * reading, the writing and the error are the page's, so a failed write is
 * reported once rather than four times in four dialects. Every mutation answers
 * with the whole view, which is what keeps the record card and the „in progress"
 * widget honest without a second read.
 *
 * **Why the panels are not all mounted.** A board is a few hundred controls and
 * a worker request; three of them behind a tab nobody opened would be three
 * wasted generations. Only the open tab's panel is mounted, and switching tabs
 * re-reads that puzzle's own row — which is exactly the „resumes exactly" the
 * module promises, exercised on every tab change.
 *
 * **The words come from the module's own table**, registered by `copy.ts` the
 * moment this chunk loads; the page's own name is the one the MANIFEST declared,
 * so the rail, the settings gallery and this header cannot disagree about it
 * (ADR-090's copy split).
 */

/** The four tabs, in the order the page draws them. */
const TABS: readonly PuzzleId[] = ["sudoku", "nonogram", "mahjong", "broj"];

export default function PuzzlesPage({ profileId, intent, onIntentHandled }: ModulePageProps) {
  const [view, setView] = useState<PuzzlesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PuzzleId>("sudoku");
  const titleId = useId();

  /**
   * One mutation, into state. Every op answers with the same shape, so there is
   * exactly one way this page learns anything: what main just said. A local guess
   * applied on top of a write would be a second answer to a question that has
   * one.
   */
  const run = useCallback(
    async (action: (puzzles: PuzzlesApi) => Promise<PuzzlesView>) => {
      try {
        setView(await action(window.nexus.modules.puzzles));
        setError(null);
        return true;
      } catch (failure) {
        setError(copy.page.saveError);
        console.error("Nexus: a puzzles change failed:", failure);
        return false;
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.puzzles.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.page.loadError);
      // No toast, no dialog: a page that cannot read says so in its own body and
      // keeps saying so until a read works, which is the least surprising thing
      // it can do.
      console.error("Nexus: the puzzles could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSave = useCallback(
    (input: SaveInput) => {
      void run((puzzles) => puzzles.save({ profileId, ...input }));
    },
    [profileId, run],
  );

  const onFinish = useCallback(
    (input: FinishInput) => {
      void run((puzzles) => puzzles.finish({ profileId, ...input }));
    },
    [profileId, run],
  );

  const onClear = useCallback(
    (input: ClearInput) => {
      void run((puzzles) => puzzles.clearSave({ profileId, ...input }));
    },
    [profileId, run],
  );

  /** The grade the assistant opened a panel on. A new serial remounts that panel, even when its tab is already the open one. */
  const [opening, setOpening] = useState<{
    readonly puzzle: PuzzleId;
    readonly variant: string;
    readonly serial: number;
  } | null>(null);
  const gradeOf = (puzzle: PuzzleId) => (opening?.puzzle === puzzle ? opening.variant : undefined);

  /**
   * Opens a puzzle the assistant asked for, as the grade chips do. A fresh game discards
   * the saved one first, the way the page's new-game control does, and only a cleared row
   * lets the panel deal a new board.
   */
  const openPuzzle = useCallback(
    async (request: OpenRequest) => {
      if (request.fresh) {
        const cleared = await run((puzzles) =>
          puzzles.clearSave({ profileId, puzzle: request.puzzle, variant: request.variant }),
        );
        if (!cleared) return;
      }
      setTab(request.puzzle);
      setOpening((previous) => ({
        puzzle: request.puzzle,
        variant: request.variant,
        serial: (previous?.serial ?? 0) + 1,
      }));
    },
    [profileId, run],
  );

  /**
   * What the assistant asked this page to do: open a puzzle. It waits for the view, since
   * the grade has to be one the view lists. Anything else is not this page's verb and is
   * reported handled all the same, so the shell's queue moves on.
   */
  useEffect(() => {
    if (intent === null || intent === undefined || view === null) return;
    if (intent.kind === "action" && intent.action === "start") {
      const request = openRequestOf(intent.payload, view.variants);
      if (request !== null) void openPuzzle(request);
    }
    onIntentHandled?.();
  }, [intent, view, onIntentHandled, openPuzzle]);

  const locale = activeLocale();

  return (
    <div className="pz">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        titleId={titleId}
        subtitle={copy.page.subtitle}
        sigil="grid"
      />
      {error !== null && (
        <p className="pz__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={5} />
      ) : (
        <>
          <div className="pz__chips" role="group" aria-labelledby={titleId}>
            {TABS.map((id) => (
              <Button
                key={id}
                size="sm"
                className={tab === id ? "nx-segmented__option pz__chip" : "pz__chip"}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {copy.tabs[id]}
              </Button>
            ))}
          </div>

          {/* One board at a time, and the panel is handed the whole view: the
              row it resumes, the grades main declares, the module's one
              preference, and the two writes it is allowed to make. */}
          {tab === "sudoku" && (
            <SudokuPanel
              key={opening?.serial}
              opening={gradeOf("sudoku")}
              saves={view.saves}
              variants={view.variants.sudoku}
              settings={view.settings}
              onSave={onSave}
              onFinish={onFinish}
              onClear={onClear}
            />
          )}
          {tab === "nonogram" && (
            <NonogramPanel
              key={opening?.serial}
              opening={gradeOf("nonogram")}
              saves={view.saves}
              variants={view.variants.nonogram}
              settings={view.settings}
              onSave={onSave}
              onFinish={onFinish}
              onClear={onClear}
            />
          )}
          {tab === "mahjong" && (
            <MahjongPanel
              key={opening?.serial}
              opening={gradeOf("mahjong")}
              saves={view.saves}
              variants={view.variants.mahjong}
              settings={view.settings}
              onSave={onSave}
              onFinish={onFinish}
              onClear={onClear}
            />
          )}
          {tab === "broj" && (
            <BrojPanel
              key={opening?.serial}
              opening={gradeOf("broj")}
              saves={view.saves}
              variants={view.variants.broj}
              settings={view.settings}
              onSave={onSave}
              onFinish={onFinish}
              onClear={onClear}
            />
          )}

          <Card className="pz__card" title={copy.stats.title}>
            {view.stats.length === 0 ? (
              <EmptyState
                variant="inline"
                title={copy.stats.empty}
                description={copy.stats.emptyBody}
              />
            ) : (
              <div className="pz-stats">
                {view.stats.map((row) => (
                  <ListRow
                    key={`${row.puzzle}:${row.variant}`}
                    trailing={
                      <span className="pz-stats__values">
                        <span>{`${copy.common.played}: ${formatCount(row.played, locale)}`}</span>
                        <span>{`${copy.common.solved}: ${formatCount(row.solved, locale)}`}</span>
                        <span>
                          {`${copy.common.best}: ${
                            row.bestTimeSeconds === null
                              ? "—"
                              : formatClock(row.bestTimeSeconds)
                          }`}
                        </span>
                        {row.bestDistance !== null && (
                          <span>
                            {`${copy.broj.solutionDistance}: ${formatCount(row.bestDistance, locale)}`}
                          </span>
                        )}
                      </span>
                    }
                  >
                    <span className="pz-stats__name">
                      {`${copy.tabs[row.puzzle]} · ${variantLabel(row.puzzle, row.variant)}`}
                    </span>
                  </ListRow>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
