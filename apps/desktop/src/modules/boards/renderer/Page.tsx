import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Chip,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
} from "@nexus/ui";
import { turnSeat } from "@nexus/core";
import type { BoardsGame } from "@nexus/core";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { numberFormat } from "../../../renderer/src/intl.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { fill } from "../../../renderer/src/strings.js";
import { manifest } from "../shared/manifest.js";
import type { BoardsSaveView, BoardsView } from "../shared/ipc.js";
import { Board } from "./Board.js";
import { copy } from "./copy.js";
import { useAiClient } from "./ai/client.js";
import {
  GAME_ORDER,
  awaitingHuman,
  beginTurn,
  canOfferCube,
  canUndo,
  computerOffersCube,
  computerTakesCube,
  cubeAnswerSeat,
  cubeAwaitingAnswer,
  cubeValue,
  isOver,
  legalMovesOf,
  moveSeed,
  mustRoll,
  newSession,
  outcomeOf,
  savedSession,
  seatIsHuman,
  turnSeatOf,
  withCubeAnswer,
  withDeclinedCube,
  withDouble,
  withMove,
  withPass,
  withResignation,
  withRoll,
  withUndo,
} from "./rules.js";
import type { BoardSession } from "./rules.js";
import {
  MoveList,
  ResultPanel,
  SetupPanel,
  StatsCard,
  cubeText,
  defaultDraft,
  diceText,
  levelLabel,
  rollsDice,
  setupOf,
} from "./panels.js";
import type { SetupDraft } from "./panels.js";
import "./boards.css";

/**
 * IGRE NA TABLI (ADR-090 stage 2) — the module's page.
 *
 * **Two surfaces, one at a time.** The LOBBY lists the six games, what is saved
 * and the record, and starts a game; the GAME view is the board somebody is
 * playing on. There is no third state and no dialog over either.
 *
 * **The page is the driver; the engines decide.** The position, the legal moves,
 * whether a roll is owed, who has won and what a move means are the engines'
 * answers, read through `rules.ts` — so this file never contains a rule, only the
 * order things happen in: a person clicks, the position steps, the position is
 * written, and if the side to move is the computer, the worker is asked what to
 * play (which is the one computation in this module that must not run on this
 * thread).
 *
 * **Every move is written as it is played.** A game is saved through `save` after
 * each transition, and the store refuses a position that its own log does not
 * produce — so what a page draws and what survives a restart are the same game
 * rather than two versions of it. Undo, which exists only against the computer,
 * is a turn's anchor held in memory: what it restores is a position the rules
 * really produced (dice included), never a rewound copy of the screen.
 *
 * **The module owns its own copy.** Nothing here reads the shell's `strings`
 * table for words: `copy.ts` is this module's table, rewritten in place by the
 * same `applyLocale` walk the shell's goes through, and it arrives with this
 * chunk.
 */

/** The seed a new game's dice come out of: an unsigned 32-bit draw, the width of the engines' own generator. */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}

/**
 * How long a throw is shown moving.
 *
 * Short on purpose: it is the gesture of a throw, not a suspense device, and it
 * runs while the position is already settled on screen. Under a reduced-motion
 * setting the stylesheet does not animate at all and this number costs nothing.
 */
const ROLL_MOTION_MS = 420;

export default function BoardsPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<BoardsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The game on screen, or null for the lobby. It is the page's own state: a move is drawn before it is stored. */
  const [session, setSession] = useState<BoardSession | null>(null);
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [statsLevel, setStatsLevel] = useState(1);
  const [thinking, setThinking] = useState(false);
  const [rolling, setRolling] = useState(false);
  const askAi = useAiClient();
  const sessionRef = useRef<BoardSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /** One read, into state. Every mutation answers with the same shape, so there is one way to learn anything. */
  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.boards.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the board games could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** The level the record opens at: whatever the profile prefers, once it is known. */
  const defaultLevel = view?.settings.defaultLevel;
  useEffect(() => {
    if (defaultLevel !== undefined) setStatsLevel(defaultLevel);
  }, [defaultLevel]);

  /**
   * The throw, shown as motion for as long as the platform allows motion and not
   * one millisecond longer.
   *
   * The dice themselves are shown from the values the engine rolled — that is the
   * fact — and this is only the flourish around them, so it is driven by the last
   * event being a roll and cleared by a timer the next render cancels. The
   * animation itself lives in `boards.css`, inside a
   * `prefers-reduced-motion: no-preference` block: under a reduced-motion setting
   * the dice appear with their values and nothing moves.
   */
  useEffect(() => {
    if (session === null || session.events[session.events.length - 1]?.kind !== "roll") {
      setRolling(false);
      return;
    }
    setRolling(true);
    const handle = setTimeout(() => setRolling(false), ROLL_MOTION_MS);
    return () => clearTimeout(handle);
  }, [session]);

  /**
   * Writes a session and shows it.
   *
   * The write is fire-and-forget in one direction only: the board is drawn from the
   * session immediately, and a refusal from main (a position its log does not
   * produce, a payload the wire refuses) is reported rather than swallowed. What is
   * NOT done is a local guess about what main stored — the view that comes back is
   * only used for the lobby's own rows.
   */
  const commit = useCallback(
    (next: BoardSession) => {
      const stepped = beginTurn(next);
      setSession(stepped);
      void (async () => {
        try {
          const saved = await window.nexus.modules.boards.save({
            profileId,
            game: stepped.game,
            state: stepped.state,
            events: stepped.events,
            seed: stepped.seed,
            level: stepped.level,
            seats: [...stepped.seats],
          });
          setView(saved);
          setError(null);
        } catch (failure) {
          setError(copy.errors.mutate);
          console.error("Nexus: a board game move was not saved:", failure);
        }
      })();
    },
    [profileId],
  );

  // --- The computer's turn ---------------------------------------------------

  /**
   * Plays the computer's side of the board, one search at a time.
   *
   * The loop is the game's own turn protocol — roll when the position asks for a
   * roll, play the move the worker answers with, pass when the dice allow nothing
   * — and it stops the moment the turn belongs to a person, an offer of the cube
   * is waiting for an answer, or the game is over. The step cap is not a rule: it
   * is the guarantee that a bug in that protocol cannot spin this effect forever.
   */
  useEffect(() => {
    if (session === null || isOver(session)) return;
    const seat = turnSeatOf(session);
    if (seatIsHuman(session, seat)) return;

    if (cubeAwaitingAnswer(session)) {
      const answerSeat = cubeAnswerSeat(session);
      if (answerSeat === null || seatIsHuman(session, answerSeat)) return;
      commit(
        computerTakesCube(session, answerSeat)
          ? withCubeAnswer(session)
          : withDeclinedCube(session),
      );
      return;
    }

    let cancelled = false;
    setThinking(true);
    void (async () => {
      let next = session;
      for (let step = 0; step < 400; step += 1) {
        if (cancelled || isOver(next) || seatIsHuman(next, turnSeatOf(next))) break;
        if (cubeAwaitingAnswer(next)) break;
        const seatNow = turnSeatOf(next);
        if (mustRoll(next)) {
          next = withRoll(next);
          continue;
        }
        if (legalMovesOf(next).length === 0) {
          next = withPass(next);
          continue;
        }
        if (computerOffersCube(next, seatNow)) {
          next = withDouble(next);
          break;
        }
        let answer: Awaited<ReturnType<typeof askAi>>;
        try {
          answer = await askAi({
            game: next.game,
            level: next.level ?? 1,
            state: next.state,
            seed: moveSeed(next.seed, next.events.length),
          });
        } catch (failure) {
          console.error("Nexus: the board games worker could not be asked:", failure);
          if (!cancelled) setError(copy.errors.think);
          break;
        }
        if (!answer.ok) {
          // A refusal from the worker is not something to retry silently: the page
          // says the computer could not play and leaves the game where it stands,
          // which is the honest answer to a thread that would not answer.
          console.error("Nexus: the board games worker refused a move request:", answer.problem);
          if (!cancelled) setError(copy.errors.think);
          break;
        }
        if (answer.move === null) break;
        next = withMove(next, answer.move);
      }
      if (cancelled) return;
      setThinking(false);
      commit(next);
    })();
    return () => {
      cancelled = true;
      setThinking(false);
    };
  }, [session, askAi, commit]);

  // --- Starting, resuming and ending ----------------------------------------

  function startGame(game: BoardsGame, setup: ReturnType<typeof setupOf>): void {
    setDraft(null);
    setError(null);
    const session = newSession(game, setup, randomSeed());
    commit(session);
  }

  function resume(save: BoardsSaveView): void {
    try {
      const session = savedSession(save);
      setError(null);
      commit(session);
    } catch (failure) {
      // A saved game the engines will not read back is not something to open onto a
      // half-drawn board: the page says so and leaves the lobby as it is.
      setError(copy.errors.position);
      console.error("Nexus: a saved board game could not be resumed:", failure);
    }
  }

  async function finish(ending: "position" | "resigned" | "cube-declined" | "abandoned"): Promise<void> {
    const session = sessionRef.current;
    if (session === null) return;
    try {
      setView(
        await window.nexus.modules.boards.finish({
          profileId,
          game: session.game,
          state: session.state,
          events: session.events,
          seed: session.seed,
          level: session.level,
          seats: [...session.seats],
          ending,
        }),
      );
      setError(null);
    } catch (failure) {
      setError(copy.errors.mutate);
      console.error("Nexus: the board game's result was not recorded:", failure);
    }
    setSession(null);
    setThinking(false);
  }

    const humanTurn = session !== null && awaitingHuman(session) && !cubeAwaitingAnswer(session);
  const result = session !== null && isOver(session) ? resultText(session) : null;

  return (
    <div className="boards">
      {/* The page's own name is the word the module DECLARED, read in the language
          being spoken, rather than a second copy of it (ADR-090's copy split). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="grid"
        actions={
          session === null ? undefined : (
            <Button variant="quiet" onClick={() => void finish("abandoned")}>
              {copy.game.leave}
            </Button>
          )
        }
      />
      {error !== null && (
        <p className="boards__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : session === null ? (
        <Lobby
          view={view}
          draft={draft}
          statsLevel={statsLevel}
          onStatsLevel={setStatsLevel}
          onResume={resume}
          onSetup={setDraft}
          onStart={(game, setup) => startGame(game, setup)}
        />
      ) : (
        <section className="boards__game">
          <Card className="boards__card" title={copy.games[session.game].name}>
            <div className="boards__status">
              <span className="boards__status-turn">
                {copy.game.turn}: {turnText(session)}
              </span>
              {thinking && (
                <span className="boards__thinking" aria-live="polite">
                  {copy.game.thinking}
                </span>
              )}
              {rollsDice(session.game) && diceText(session.state, session.game) !== null && (
                <Chip variant="data" className={rolling ? "boards__dice--rolling" : undefined}>
                  {copy.moves.roll}: {diceText(session.state, session.game)}
                </Chip>
              )}
              {cubeText(cubeValue(session)) !== null && <Chip>{cubeText(cubeValue(session))}</Chip>}
            </div>
            <Board
              game={session.game}
              state={session.state}
              moves={humanTurn ? legalMovesOf(session) : []}
              seats={session.seats}
              interactive={humanTurn}
              lastEvent={session.events[session.events.length - 1] ?? null}
              onMove={(move) => commit(withMove(session, move))}
            />
            <p className="nx-hint">{copy.game.keys}</p>
            <div className="boards__actions">
              {humanTurn && mustRoll(session) && (
                <Button variant="primary" onClick={() => commit(withRoll(session))}>
                  {copy.game.roll}
                </Button>
              )}
              {humanTurn && !mustRoll(session) && legalMovesOf(session).length === 0 && (
                <Button variant="primary" onClick={() => commit(withPass(session))}>
                  {copy.game.pass}
                </Button>
              )}
              {humanTurn && !mustRoll(session) && legalMovesOf(session).length === 0 && (
                <span className="nx-hint">{copy.game.noMoves}</span>
              )}
              {humanTurn && canOfferCube(session) && (
                <Button onClick={() => commit(withDouble(session))}>
                  {copy.game.offer}
                </Button>
              )}
              {canUndo(session) && !isOver(session) && (
                <Button onClick={() => commit(withUndo(session))}>
                  <Icon name="undo" size={16} /> {copy.game.undo}
                </Button>
              )}
              {!isOver(session) && (
                <Button variant="quiet" onClick={() => commit(withResignation(session))}>
                  {copy.game.resign}
                </Button>
              )}
            </div>
            {canUndo(session) && <p className="nx-hint">{copy.game.undoHint}</p>}
          </Card>
          {cubeAwaitingAnswer(session) && cubeAnswerSeat(session) !== null && seatIsHuman(session, cubeAnswerSeat(session) ?? -1) && (
            <Card className="boards__card" title={copy.moves.double}>
              <div className="boards__actions">
                <Button variant="primary" onClick={() => commit(withCubeAnswer(session))}>
                  {copy.game.accepts}
                </Button>
                <Button variant="quiet" onClick={() => commit(withDeclinedCube(session))}>
                  {copy.game.declines}
                </Button>
              </div>
            </Card>
          )}
          {result !== null && (
            <ResultPanel
              title={result}
              onRecord={() =>
                void finish(session.ending === "position" ? "position" : session.ending)
              }
              onNewGame={() => {
                setSession(null);
                setDraft(defaultDraft(session.game, view.settings.defaultLevel));
              }}
            />
          )}
          <MoveList session={session} />
        </section>
      )}
    </div>
  );
}

/** Whose turn it is, in the words the copy table has: „ti", „računar", or a numbered player. */
function turnText(session: BoardSession): string {
  const seat = turnSeat(session.state);
  if (seatIsHuman(session, seat) && session.seats.length === 2) return copy.game.you;
  if (session.seats[seat] === "computer") return copy.game.computer;
  return fill(copy.game.player, { number: numberFormat().format(seat + 1) });
}

/**
 * How the game ended, as one line for the person reading it.
 *
 * A two-seat game against the computer is told from the player's side — „Pobeda"
 * or „Poraz" — because that is the fact they came for; a table of more than two
 * seats names the winner instead.
 */
function resultText(session: BoardSession): string {
  const human = session.seats.length === 2 ? session.seats.indexOf("human") : -1;
  const soleHuman = human >= 0 && session.seats.filter((kind) => kind === "human").length === 1;
  if (session.ending === "resigned") return soleHuman ? copy.result.loss : copy.result.win;
  if (session.ending === "cube-declined") {
    return turnSeat(session.state) === human ? copy.result.win : copy.result.loss;
  }
  const outcome = outcomeOf(session);
  if (outcome.status === "draw") return copy.result.draw;
  if (outcome.status !== "win" || outcome.winner === null) return copy.result.draw;
  if (soleHuman) return outcome.winner === human ? copy.result.win : copy.result.loss;
  return fill(copy.result.seat, { number: numberFormat().format(outcome.winner + 1) });
}

// --- The lobby --------------------------------------------------------------

/**
 * The six games, what is saved of each, and the record.
 *
 * A row is one game: its name, a line saying what it is or what is saved of it, and
 * the two things a person does from here — resume, or start a new one. The form
 * appears under the row it belongs to rather than in a dialog, because everything
 * it asks for is about that one game.
 */
function Lobby({
  view,
  draft,
  statsLevel,
  onStatsLevel,
  onResume,
  onSetup,
  onStart,
}: {
  view: BoardsView;
  draft: SetupDraft | null;
  statsLevel: number;
  onStatsLevel: (level: number) => void;
  onResume: (save: BoardsSaveView) => void;
  onSetup: (draft: SetupDraft | null) => void;
  onStart: (game: BoardsGame, setup: ReturnType<typeof setupOf>) => void;
}) {
  const saves = useMemo(() => {
    const byGame = new Map<BoardsGame, BoardsSaveView>();
    for (const save of view.saves) byGame.set(save.game, save);
    return byGame;
  }, [view.saves]);

  return (
    <>
      <Card className="boards__card" title={copy.lobby.title}>
        <div className="boards__list">
          {GAME_ORDER.map((game) => {
            const save = saves.get(game);
            return (
              <ListRow
                key={game}
                leading={<Icon name="grid" />}
                trailing={
                  <span className="boards__row-actions">
                    {save !== undefined && (
                      <Button size="sm" variant="primary" onClick={() => onResume(save)}>
                        {copy.lobby.resume}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() =>
                        onSetup(draft?.game === game ? null : defaultDraft(game, view.settings.defaultLevel))
                      }
                    >
                      {copy.lobby.play}
                    </Button>
                  </span>
                }
              >
                <span className="boards__row-name">{copy.games[game].name}</span>
                <span className="boards__row-about">
                  {save === undefined
                    ? copy.games[game].about
                    : `${copy.lobby.saved} · ${fill(copy.lobby.moves, {
                        count: numberFormat().format(save.moves),
                      })} · ${
                        save.level === null
                          ? copy.lobby.againstHuman
                          : fill(copy.lobby.againstComputer, { level: levelLabel(save.level) })
                      }`}
                </span>
              </ListRow>
            );
          })}
        </div>
      </Card>
      {draft !== null && (
        <SetupPanel
          draft={draft}
          onChange={onSetup}
          onStart={() => onStart(draft.game, setupOf(draft))}
          onCancel={() => onSetup(null)}
        />
      )}
      <StatsCard stats={view.stats} level={statsLevel} onLevel={onStatsLevel} />
    </>
  );
}
