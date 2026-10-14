import { useCallback, useEffect, useRef, useState } from "react";
import {
  FREE_CELL_MAX_DEAL,
  FREE_CELL_MIN_DEAL,
  type Card as CardModel,
  type CardGameId,
  type CardGameVariant,
  type CardOpponentLevel,
} from "@nexus/core";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  Select,
  TextField,
} from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { numberFormat } from "../../../renderer/src/intl.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { fill } from "../../../renderer/src/strings.js";
import { manifest } from "../shared/manifest.js";
import type { CardsSaveView, CardsStatView, CardsView } from "../shared/ipc.js";
import { useAiClient } from "./ai/client.js";
import { copy } from "./copy.js";
import { describeMove } from "./moves.js";
import type { CardSelection } from "./moves.js";
import {
  GAME_ORDER,
  canSolve,
  canUndo,
  hintMove,
  isComputerGame,
  isFinished,
  isWon,
  legalMoves,
  moveSeed,
  resumeGame,
  safeMoves,
  seatToAct,
  solveVerdict,
  startGame,
  stepSession,
  undoSession,
  variantsOf,
  type CardSession,
} from "./rules.js";
import type { Box } from "./solitaire.js";
import {
  FreeCellBoard,
  GolfBoard,
  KlondikeBoard,
  PyramidBoard,
  SpiderBoard,
  TriPeaksBoard,
} from "./Solitaires.js";
import { HeartsBoard, SpadesBoard, TablicBoard } from "./TrickGames.js";
import "./cards.css";

/**
 * KARTE (ADR-090 stage 2) — the module's page.
 *
 * **Two surfaces, one at a time.** The SHELF lists the nine games with what is saved
 * of each and the record, and starts a game; the TABLE is the deal somebody is
 * playing. There is no third state and no dialog over either.
 *
 * **The page is the driver; the engines decide.** The position, the legal moves, the
 * score, whether a game is over and who has won are the engines' answers, read
 * through `rules.ts` — so this file contains no rule, only the order things happen
 * in: a person clicks, the position steps, the position is written, and if the seat
 * to act is the computer's the worker is asked what to play (the one computation
 * here that must not run on this thread — see `rules.ts` for the measurement).
 *
 * **Every move is written as it is played**, and a finished deal calls `record`,
 * which stamps the clock and clears the saved game in one step. The store replays
 * every log through the game's own engine, so a row only ever holds a game that can
 * be resumed.
 */

/** The seed a fresh deal comes out of: an unsigned 32-bit draw, the engines' own width. */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}

export default function CardsPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<CardsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<CardSession | null>(null);
  const [selection, setSelection] = useState<CardSelection | null>(null);
  const [passSelection, setPassSelection] = useState<readonly CardModel[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [thinking, setThinking] = useState(false);
  const [verdict, setVerdict] = useState<ReturnType<typeof solveVerdict>>(null);
  const [, setTick] = useState(() => Date.now());
  const sessionRef = useRef<CardSession | null>(null);
  const startedAt = useRef(Date.now());
  const askAi = useAiClient();

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.cards.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the card games could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** The page's clock: a duration counted here, stamped by main. */
  useEffect(() => {
    if (session === null) return;
    const handle = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [session]);

  const elapsed = () => Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000));

  const commit = useCallback(
    (next: CardSession) => {
      setSession(next);
      sessionRef.current = next;
      void (async () => {
        try {
          setView(
            await window.nexus.modules.cards.save({
              profileId,
              game: next.game,
              variant: next.variant,
              seed: next.seed,
              moves: next.log,
              elapsedSeconds: elapsed(),
            }),
          );
          setError(null);
        } catch (failure) {
          setError(copy.errors.mutate);
          console.error("Nexus: a card game move was not saved:", failure);
        }
      })();
    },
    [profileId],
  );

  // --- The computer's turn ---------------------------------------------------

  useEffect(() => {
    if (session === null || !isComputerGame(session.game) || isFinished(session)) return;
    if (seatToAct(session) === 0) return;
    let cancelled = false;
    setThinking(true);
    void (async () => {
      let next = session;
      for (let step = 0; step < 600; step += 1) {
        if (cancelled || isFinished(next) || seatToAct(next) === 0) break;
        const answer = await askAi({
          game: next.game,
          level: next.level,
          state: next.state,
          seed: moveSeed(next.seed, next.log.length),
        });
        if (!answer.ok) {
          console.error("Nexus: the card games worker refused a move request:", answer.problem);
          if (!cancelled) setError(copy.errors.think);
          break;
        }
        if (answer.move === null) break;
        next = stepSession(next, answer.move, 0);
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

  function deal(game: CardGameId, variant: CardGameVariant, seed: number, level: CardOpponentLevel): void {
    try {
      const fresh = startGame(game, variant, seed, level);
      setDraft(null);
      setSelection(null);
      setPassSelection([]);
      setVerdict(null);
      setError(null);
      startedAt.current = Date.now();
      setTick(Date.now());
      commit(fresh);
    } catch (failure) {
      setError(copy.errors.seed);
      console.error("Nexus: a card game could not be dealt:", failure);
    }
  }

  function resume(save: CardsSaveView): void {
    try {
      const restored = resumeGame({
        game: save.game as CardGameId,
        variant: save.variant as CardGameVariant,
        seed: save.seed,
        moves: save.moves,
        elapsedSeconds: save.elapsedSeconds,
      });
      setDraft(null);
      setSelection(null);
      setPassSelection([]);
      setVerdict(null);
      setError(null);
      startedAt.current = Date.now() - save.elapsedSeconds * 1000;
      setTick(Date.now());
      setSession(restored);
    } catch (failure) {
      setError(copy.errors.position);
      console.error("Nexus: a saved card game could not be resumed:", failure);
    }
  }

  async function record(won: boolean): Promise<void> {
    const current = sessionRef.current;
    if (current === null) return;
    try {
      setView(
        await window.nexus.modules.cards.record({
          profileId,
          game: current.game,
          variant: current.variant,
          seed: current.seed,
          moves: current.log,
          elapsedSeconds: elapsed(),
          won,
        }),
      );
      setError(null);
    } catch (failure) {
      setError(copy.errors.mutate);
      console.error("Nexus: the card game's result was not recorded:", failure);
    }
    setSession(null);
    setDraft(null);
    setSelection(null);
    setPassSelection([]);
    setVerdict(null);
    setThinking(false);
  }

  if (view === null) {
    return (
      <div className="cards">
        <PageHeader title={declaredText(manifest.copy?.name)} subtitle={copy.page.subtitle} sigil="cards" />
        {error !== null ? (
          <p className="cards__error" role="alert">
            {error}
          </p>
        ) : (
          <LoadingState label={copy.page.loading} rows={4} />
        )}
      </div>
    );
  }

  const moves = session === null ? [] : legalMoves(session);
  const human = session !== null && (seatToAct(session) === 0 || !isComputerGame(session.game));
  const hint = session !== null && human && !isFinished(session) ? hintMove(session) : null;
  const safe = session !== null && human && !isFinished(session) ? safeMoves(session) : [];

  return (
    <div className="cards">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="cards"
        actions={
          session === null ? undefined : (
            <Button variant="quiet" onClick={() => void record(false)}>
              {copy.play.giveUp}
            </Button>
          )
        }
      />
      {error !== null && (
        <p className="cards__error" role="alert">
          {error}
        </p>
      )}
      {session === null ? (
        <Shelf view={view} draft={draft} onDraft={setDraft} onDeal={deal} onResume={resume} />
      ) : (
        <section className="cards__game">
          <Card
            className="cards__panel"
            title={copy.games[session.game].name}
          >
            <div className="cards__meta">
              <Chip>{copy.variant[session.variant as keyof typeof copy.variant]}</Chip>
              <Chip>{`${copy.play.score}: ${numberFormat().format(session.score)}`}</Chip>
              {session.game === "freecell" && (
                <Chip>{fill(copy.play.dealNumber, { seed: numberFormat().format(session.seed) })}</Chip>
              )}
              <span className="cards__status-turn">
                {copy.play.status}: {turnText(session)}
              </span>
              <span className="cards__status">
                {fill(copy.lobby.moves, { count: numberFormat().format(session.log.length) })}
              </span>
              {thinking && (
                <span className="cards__thinking" aria-live="polite">
                  {copy.play.thinking}
                </span>
              )}
            </div>
            <Table
              session={session}
              moves={moves}
              selection={selection}
              human={human}
              passSelection={passSelection}
              onPassSelection={setPassSelection}
              onSelect={setSelection}
              onMove={(move) => {
                if (session === null) return;
                setSelection(null);
                setPassSelection([]);
                commit(stepSession(session, move, 0));
              }}
            />
            <p className="nx-hint">{copy.play.keys}</p>
            <div className="cards__actions">
              {human && hint !== null && <Button onClick={() => play(hint)}>{copy.play.hint}</Button>}
              {human && safe.length > 0 && <Button onClick={() => play(safe[0])}>{copy.play.safe}</Button>}
              {human && canUndo(session) && (
                <Button onClick={() => setSession(undoSession(session))}>
                  <Icon name="undo" size={16} /> {copy.play.undo}
                </Button>
              )}
              {human && canSolve(session) && (
                <Button variant="quiet" onClick={() => setVerdict(solveVerdict(session))}>
                  {copy.play.solve}
                </Button>
              )}
            </div>
            {verdict !== null && <p className="nx-hint">{copy.play.verdict[verdict]}</p>}
          </Card>
          {isFinished(session) && (
            <Card className="cards__panel" title={copy.result.title}>
              <p className="cards__result-text">
                <Icon name={isWon(session) ? "success" : "info"} size={18} />{" "}
                {isWon(session) ? copy.result.win : copy.result.loss}
              </p>
              <p className="nx-hint">{copy.result.note}</p>
              <div className="cards__actions">
                <Button variant="primary" onClick={() => void record(isWon(session))}>
                  {copy.result.again}
                </Button>
              </div>
            </Card>
          )}
          <MoveList session={session} />
        </section>
      )}
    </div>
  );

  /** Plays one move, from a button rather than from a card. */
  function play(move: unknown): void {
    const current = sessionRef.current;
    if (current === null || move === undefined) return;
    setSelection(null);
    commit(stepSession(current, move, 0));
  }

  function turnText(current: CardSession): string {
    const seat = seatToAct(current);
    if (seat < 0) return copy.result.stopped;
    return seat === 0 ? copy.play.you : copy.play.computer;
  }
}

// --- The table --------------------------------------------------------------

function Table({
  session,
  moves,
  selection,
  human,
  passSelection,
  onPassSelection,
  onSelect,
  onMove,
}: {
  readonly session: CardSession;
  readonly moves: readonly unknown[];
  readonly selection: CardSelection | null;
  readonly human: boolean;
  readonly passSelection: readonly CardModel[];
  readonly onPassSelection: (cards: readonly CardModel[]) => void;
  readonly onSelect: (selection: CardSelection | null) => void;
  readonly onMove: (move: unknown) => void;
}) {
  const props = {
    session,
    moves: human ? moves : [],
    selected: selection,
    onSelect,
    onMove,
    lastMove: session.log[session.log.length - 1] ?? null,
  };
  const selectedBox = selection === null ? null : selectionAsBox(selection);
  switch (session.game) {
    case "klondike":
      return <KlondikeBoard {...props} selected={selectedBox} />;
    case "freecell":
      return <FreeCellBoard {...props} selected={selectedBox} />;
    case "spider":
      return <SpiderBoard {...props} selected={selectedBox} />;
    case "pyramid":
      return <PyramidBoard {...props} selected={selectedBox} />;
    case "tripeaks":
      return <TriPeaksBoard {...props} selected={selectedBox} />;
    case "golf":
      return <GolfBoard {...props} selected={selectedBox} />;
    case "hearts":
      return (
        <HeartsBoard
          session={session}
          moves={moves}
          onMove={onMove}
          lastMove={props.lastMove}
          passSelection={passSelection}
          onPassSelection={onPassSelection}
        />
      );
    case "spades":
      return (
        <SpadesBoard
          session={session}
          moves={moves}
          onMove={onMove}
          lastMove={props.lastMove}
          passSelection={[]}
          onPassSelection={() => undefined}
        />
      );
    case "tablic":
      return (
        <TablicBoard
          session={session}
          moves={moves}
          onMove={onMove}
          lastMove={props.lastMove}
          passSelection={[]}
          onPassSelection={() => undefined}
        />
      );
  }
}

/** The selection in the box vocabulary the solitaires read. */
function selectionAsBox(selection: CardSelection): Box {
  switch (selection.kind) {
    case "waste":
      return { kind: "waste" };
    case "stock":
      return { kind: "stock" };
    case "foundation":
      return { kind: "foundation", suit: selection.suit };
    case "column":
      return { kind: "column", column: selection.column };
    case "cell":
      return { kind: "cell", cell: selection.cell };
    case "card":
      return { kind: "card", index: selection.index };
    default:
      return { kind: "card", index: 0 };
  }
}

// --- The shelf --------------------------------------------------------------

interface Draft {
  readonly game: CardGameId;
  readonly variant: CardGameVariant;
  readonly level: CardOpponentLevel;
  readonly deal: string;
}

function Shelf({
  view,
  draft,
  onDraft,
  onDeal,
  onResume,
}: {
  readonly view: CardsView;
  readonly draft: Draft | null;
  readonly onDraft: (draft: Draft | null) => void;
  readonly onDeal: (game: CardGameId, variant: CardGameVariant, seed: number, level: CardOpponentLevel) => void;
  readonly onResume: (save: CardsSaveView) => void;
}) {
  const bySlot = new Map(view.saves.map((save) => [`${save.game}/${save.variant}`, save]));
  const statsOf = (game: CardGameId, variant: CardGameVariant): CardsStatView | undefined =>
    view.stats.find((row) => row.game === game && row.variant === variant);

  return (
    <>
      <Card className="cards__panel" title={copy.lobby.title}>
        <div className="cards__shelf">
          {GAME_ORDER.map((game) => (
            <div className="cards__shelf-row" key={game}>
              <ListRow
                leading={<Icon name="cards" />}
                trailing={
                  <span className="cards__row-actions">
                    {bySlot.get(`${game}/${variantsOf(game)[0]}`) !== undefined && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => onResume(bySlot.get(`${game}/${variantsOf(game)[0]}`)!)}
                      >
                        {copy.lobby.resume}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() =>
                        onDraft(
                          draft?.game === game
                            ? null
                            : {
                                game,
                                variant: variantsOf(game)[0] ?? "standard",
                                level: "medium",
                                deal: game === "freecell" ? "1" : "",
                              },
                        )
                      }
                    >
                      {copy.lobby.play}
                    </Button>
                  </span>
                }
              >
                <span className="cards__row-name">{copy.games[game].name}</span>
                <span className="cards__row-about">
                  {fill(copy.lobby.played, {
                    count: numberFormat().format(
                      statsOf(game, variantsOf(game)[0] ?? "standard")?.played ?? 0,
                    ),
                  })}
                </span>
              </ListRow>
              {draft?.game === game && (
                <DealPanel draft={draft} stats={statsOf} onDraft={onDraft} onDeal={onDeal} />
              )}
            </div>
          ))}
        </div>
      </Card>
      <StatsCard view={view} />
    </>
  );
}

function DealPanel({
  draft,
  stats,
  onDraft,
  onDeal,
}: {
  readonly draft: Draft;
  readonly stats: (game: CardGameId, variant: CardGameVariant) => CardsStatView | undefined;
  readonly onDraft: (draft: Draft | null) => void;
  readonly onDeal: (game: CardGameId, variant: CardGameVariant, seed: number, level: CardOpponentLevel) => void;
}) {
  const variants = variantsOf(draft.game);
  const freeCell = draft.game === "freecell";
  const dealNumber = Number(draft.deal);
  const validDeal = freeCell ? dealNumber >= FREE_CELL_MIN_DEAL && dealNumber <= FREE_CELL_MAX_DEAL : true;
  const computer = isComputerGame(draft.game);
  return (
    <Card className="cards__deal" title={fill(copy.setup.title, { game: copy.games[draft.game].name })}>
      <div className="cards__fields">
        {variants.length > 1 && (
          <Select
            label={copy.setup.variant}
            value={draft.variant}
            onChange={(event) => onDraft({ ...draft, variant: event.target.value as CardGameVariant })}
          >
            {variants.map((variant) => (
              <option key={variant} value={variant}>
                {copy.variant[variant as keyof typeof copy.variant]}
              </option>
            ))}
          </Select>
        )}
        {computer && (
          <Select
            label={copy.setup.level}
            value={draft.level}
            onChange={(event) => onDraft({ ...draft, level: event.target.value as CardOpponentLevel })}
          >
            {(["easy", "medium", "hard"] as const).map((level) => (
              <option key={level} value={level}>
                {copy.level[level]}
              </option>
            ))}
          </Select>
        )}
        {freeCell && (
          <Field help={copy.setup.seedHint} error={validDeal ? undefined : copy.errors.seed}>
            <TextField
              label={copy.setup.seed}
              value={draft.deal}
              onChange={(event) => onDraft({ ...draft, deal: event.target.value })}
            />
          </Field>
        )}
      </div>
      <div className="cards__actions">
        <Button
          variant="primary"
          disabled={freeCell && !validDeal}
          onClick={() => onDeal(draft.game, draft.variant, freeCell ? dealNumber : randomSeed(), draft.level)}
        >
          {copy.setup.start}
        </Button>
        <Button variant="quiet" onClick={() => onDraft(null)}>
          {copy.setup.cancel}
        </Button>
        {stats(draft.game, draft.variant) !== undefined &&
          (stats(draft.game, draft.variant)?.played ?? 0) > 0 && (
            <span className="nx-hint">
              {fill(copy.lobby.moves, {
                count: numberFormat().format(stats(draft.game, draft.variant)?.won ?? 0),
              })}
            </span>
          )}
      </div>
    </Card>
  );
}

// --- The record -------------------------------------------------------------

function StatsCard({ view }: { readonly view: CardsView }) {
  const played = view.stats.reduce((total, row) => total + row.played, 0);
  return (
    <Card className="cards__panel" title={copy.stats.title}>
      {played === 0 ? (
        <EmptyState
          variant="inline"
          title={copy.stats.none}
          description={copy.stats.caption}
        />
      ) : (
        <>
          <div className="cards__stats">
            <div className="cards__stats-head nx-eyebrow">
              <span>{copy.lobby.title}</span>
              <span>{copy.stats.played}</span>
              <span>{copy.stats.won}</span>
              <span>{copy.stats.best}</span>
              <span>{copy.stats.time}</span>
            </div>
            {view.stats
              .filter((row) => row.played > 0)
              .map((row) => (
                <div className="cards__stats-row" key={`${row.game}-${row.variant}`}>
                  <span className="cards__stats-name">
                    {copy.games[row.game as CardGameId]?.name ?? row.game}
                  </span>
                  <span className="cards__stats-number">{numberFormat().format(row.played)}</span>
                  <span className="cards__stats-number">{numberFormat().format(row.won)}</span>
                  <span className="cards__stats-number">
                    {row.bestScore === null ? "—" : numberFormat().format(row.bestScore)}
                  </span>
                  <span className="cards__stats-number">
                    {row.bestTimeMs === null ? "—" : timeText(row.bestTimeMs)}
                  </span>
                </div>
              ))}
          </div>
          <p className="nx-hint">{copy.stats.caption}</p>
        </>
      )}
    </Card>
  );
}

function timeText(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return fill(copy.stats.timeValue, {
    minutes: numberFormat().format(minutes),
    seconds: String(seconds).padStart(2, "0"),
  });
}

// --- The move list ----------------------------------------------------------

function MoveList({ session }: { readonly session: CardSession }) {
  const moves = session.log;
  return (
    <Card className="cards__panel" title={copy.play.movesTitle}>
      {moves.length === 0 ? (
        <p className="nx-hint">{copy.play.movesEmpty}</p>
      ) : (
        <div className="cards__moves">
          {moves.map((move, index) => {
            const text = describeMove(move);
            return (
              <ListRow
                key={index}
                leading={<span className="cards__move-number">{numberFormat().format(index + 1)}</span>}
                className={index === moves.length - 1 ? "cards__move--last" : undefined}
              >
                <span className="cards__move-text">
                  {text.label}
                  {text.card === null ? "" : ` — ${text.card}`}
                </span>
              </ListRow>
            );
          })}
        </div>
      )}
    </Card>
  );
}

