import { useEffect, useRef, useState } from "react";
import { Button, Card, LoadingState, TextField } from "@nexus/ui";
import { formatBroj } from "@nexus/core";
import type { BrojSolution } from "@nexus/core";
import type { BrojStateView } from "../shared/ipc.js";
import { activeLocale } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { MAX_EXPRESSION_LENGTH, checkSubmitted, type BrojCheckResult } from "./broj.js";
import { copy } from "./copy.js";
import type { EngineStage } from "./engine.js";
import { useEngine } from "./engineClient.js";
import { formatClock, formatCount } from "./format.js";
import { ActionRow, Readout, initialGame, useElapsedClock, type PanelProps } from "./panelKit.js";
import { newSeed } from "./seed.js";

/**
 * BROJ (ADR-090): the target, the six numbers, the clock, and the engine's own
 * answer once the round is over.
 *
 * **The player's arithmetic is checked by the engine, not by this panel.** „Proveri"
 * reads the typed text (`broj.ts`'s parser), hands the tree to
 * `checkBrojExpression`, and the engine answers three things at once: whether the
 * six numbers can really make it (with their copies counted), whether every
 * division came out whole, and how far the value is from the target. Nothing here
 * re-implements one of them.
 *
 * **What the six numbers COULD make is a search, so it runs in the worker.** A
 * round ends either by finding the target (the player's own exact expression) or
 * by giving up, and giving up is when the best expression is shown — computed
 * across the whole pool, memoised, pruned, and off the thread that is drawing.
 */

const PUZZLE = "broj";
const VARIANT = "six";

export function BrojPanel({ saves, variants, onSave, onFinish, onClear }: PanelProps) {
  const engine = useEngine();
  const [initial] = useState(() => initialGame(saves, PUZZLE, variants, newSeed));
  const [seed, setSeed] = useState(initial.seed);
  const [round, setRound] = useState<BrojStateView | null>(
    initial.saved === null ? null : (initial.saved.state as BrojStateView),
  );
  const clock = useElapsedClock(initial.elapsedSeconds);
  const [stage, setStage] = useState<EngineStage | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<BrojCheckResult | null>(null);
  const [solution, setSolution] = useState<BrojSolution | null>(null);
  const [closest, setClosest] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const solvedOnce = useRef(false);
  /**
   * The clock's latest reading, in a ref so the write below can name it without
   * depending on it: a dependency on the seconds would re-write the row every
   * time the display ticked, and the row is about the ROUND rather than about
   * what time it is.
   */
  const seconds = useRef(0);
  useEffect(() => {
    seconds.current = clock.seconds;
  }, [clock.seconds]);

  useEffect(() => {
    if (round !== null) return;
    let active = true;
    setStage(null);
    setFailed(false);
    engine
      .request({ kind: PUZZLE, seed }, (next) => {
        if (active) setStage(next);
      })
      .then((response) => {
        if (!active || response.kind !== PUZZLE) return;
        setRound({
          numbers: [...response.puzzle.numbers],
          target: response.puzzle.target,
          expression: null,
        });
        setStage(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFailed(true);
        setStage(null);
        console.error("Nexus: the Broj round could not be drawn:", error);
      });
    return () => {
      active = false;
    };
  }, [engine, round, seed]);

  // Written when the round itself moves — it is dealt, or an expression is
  // submitted — rather than on a timer: a write a second would be a row nobody
  // reads changing for no reason, and the clock on screen is already live.
  useEffect(() => {
    if (round === null) return;
    onSave({
      puzzle: PUZZLE,
      variant: VARIANT,
      seed,
      state: round,
      elapsedSeconds: seconds.current,
    });
  }, [round, seed, onSave]);

  function newGame(): void {
    onClear({ puzzle: PUZZLE, variant: VARIANT });
    setSeed(newSeed());
    setRound(null);
    setText("");
    setResult(null);
    setSolution(null);
    setClosest(null);
    setOver(false);
    clock.restart(0);
    solvedOnce.current = false;
  }

  function check(): void {
    if (round === null || over) return;
    const outcome = checkSubmitted(round.numbers, round.target, text);
    setResult(outcome);
    if (outcome.kind !== "value") return;
    // The expression travels with the game: a round reopened shows the working
    // that was submitted, which is what „resumes exactly" means for this puzzle.
    setRound({ ...round, expression: outcome.expression });
    setClosest((current) =>
      current === null ? outcome.distance : Math.min(current, outcome.distance),
    );
    if (outcome.exact && !solvedOnce.current) {
      solvedOnce.current = true;
      setOver(true);
      onFinish({
        puzzle: PUZZLE,
        variant: VARIANT,
        solved: true,
        elapsedSeconds: clock.seconds,
      });
    }
  }

  function giveUp(): void {
    if (round === null || over) return;
    setOver(true);
    onFinish({
      puzzle: PUZZLE,
      variant: VARIANT,
      solved: false,
      elapsedSeconds: clock.seconds,
      distance: closest,
    });
    setStage("search");
    engine
      .request({ kind: "broj-solution", numbers: round.numbers, target: round.target })
      .then((response) => {
        setStage(null);
        if (response.kind === "broj-solution") setSolution(response.solution);
      })
      .catch((error: unknown) => {
        setStage(null);
        console.error("Nexus: the Broj solution could not be found:", error);
      });
  }

  if (failed) {
    return (
      <Card className="pz__card">
        <p className="pz__error" role="alert">
          {copy.page.loadError}
        </p>
      </Card>
    );
  }
  if (round === null) {
    return (
      <Card className="pz__card">
        <LoadingState
          label={stage === "deal" ? copy.page.stages.deal : copy.page.loading}
          rows={4}
          className="pz__pending"
        />
      </Card>
    );
  }

  const locale = activeLocale();

  return (
    <Card className="pz__card">
      <div className="pz__row">
        <Readout label={copy.broj.target} value={formatCount(round.target, locale)} />
        <Readout label={copy.common.time} value={formatClock(clock.seconds)} />
      </div>

      <div className="pz-broj__numbers" role="group" aria-label={copy.broj.numbers}>
        {round.numbers.map((number, index) => (
          <span key={index} className="pz-broj__number">
            {formatCount(number, locale)}
          </span>
        ))}
      </div>

      <TextField
        label={copy.broj.expression}
        value={text}
        maxLength={MAX_EXPRESSION_LENGTH}
        disabled={over}
        onChange={(event) => setText(event.target.value)}
      />

      <ActionRow>
        <Button size="sm" variant="primary" onClick={check} disabled={over || text.trim() === ""}>
          {copy.broj.check}
        </Button>
        <Button size="sm" onClick={giveUp} disabled={over}>
          {copy.broj.giveUp}
        </Button>
        <Button size="sm" onClick={newGame}>
          {copy.common.newGame}
        </Button>
      </ActionRow>

      {result !== null && (
        <p className="pz__note" role="status">
          {describeResult(result, locale)}
        </p>
      )}
      {stage === "search" && <p className="pz__note">{copy.page.stages.search}</p>}
      {solution !== null && (
        <>
          <p className="pz__note">{copy.broj.solutionLead}</p>
          <p className="pz-broj__solution">{formatBroj(solution.expression)}</p>
          <Readout
            label={copy.broj.solutionDistance}
            value={formatCount(solution.distance, locale)}
          />
        </>
      )}
      {over && result?.kind === "value" && result.exact && (
        <p className="pz__solved" role="status">
          {copy.broj.exact.replace("{value}", formatCount(result.value, locale))}
        </p>
      )}
    </Card>
  );
}

/** What the engine answered about one submission, in the reader's own words. */
function describeResult(result: BrojCheckResult, locale: ReturnType<typeof activeLocale>): string {
  if (result.kind === "refusal") return copy.broj.refusals[result.refusal];
  const value = formatCount(result.value, locale);
  if (result.exact) return copy.broj.exact.replace("{value}", value);
  return copy.broj.near
    .replace("{value}", value)
    .replace("{distance}", formatCount(result.distance, locale));
}
