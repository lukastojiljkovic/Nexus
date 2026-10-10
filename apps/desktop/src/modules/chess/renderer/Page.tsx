import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  Select,
  TextArea,
  TextField,
} from "@nexus/ui";
import {
  CHESS_LEVELS,
  START_FEN,
  applyUci,
  createGame,
  gamePgn,
  gameStatus,
  isValidFen,
  legalUci,
  loadGamePgn,
  replayUci,
  type Chess,
  type GameSnapshot,
} from "@nexus/core";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { ConfirmDialog } from "../../../renderer/src/ConfirmDialog.js";
import { dateTimeFormat, numberFormat } from "../../../renderer/src/intl.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import type {
  ChessGameView,
  ChessOpponent,
  ChessResult,
  ChessResumeView,
  ChessSide,
  ChessView,
} from "../shared/ipc.js";
import {
  afterSquareActivated,
  displayRows,
  moveFields,
  moveRows,
  pieceGlyph,
  plyAfter,
  squareInDirection,
  type BoardCells,
  type BoardPiece,
  type PlyJump,
} from "./board.js";
import {
  COMMON_TIME_CONTROLS,
  customTimeControl,
  flaggedSide,
  formatRemaining,
  passClock,
  parseTimeControl,
  startClock,
  stopClock,
  tickClock,
  timeControlWords,
  type ClockState,
  type TimeControl,
} from "./clock.js";
import { openBuiltInEngine, type ChessEngine, type EngineInfo } from "./engine.js";
import { copy } from "./copy.js";
import "./chess.css";

/**
 * SAH (ADR-090) - the module's page: a board, the move list, the setup of a new
 * game, PGN, and the archive.
 *
 * **The rules are `@nexus/core`'s and the page never decides one.** Legality,
 * FEN, PGN and every draw come from the `chess.js` wrapper the store also plays
 * through, so the screen and the database agree about what a game is by
 * construction. What this file owns is what a game IS here: which position is on
 * screen, whose clock runs, what the user's second press meant, and what gets
 * written into the profile.
 *
 * **Why the engine is a mutable instance behind a ref.** `chess.js` is a mutable
 * engine - `applyUci` moves on the instance - and React's StrictMode
 * double-invokes render and state UPDATERS, so a move applied inside an updater
 * would be applied twice in development. Mutations therefore happen in event
 * handlers and effects, exactly once, and every state update carries a plain
 * value; the instance is read during render (its snapshot, its board, its legal
 * moves) and never written there.
 *
 * **What is persisted, and what is not.** The moves are written to the profile's
 * one „game in progress" slot after every move (`setResume`), and the slot is
 * emptied when the game ends, because a finished game belongs to the archive and
 * is saved there once. A CLOCK is deliberately not persisted: the profile stores
 * the control a game is played at, and a remaining time restored from a row would
 * be a clock pretending that no time had passed since.
 */

/** One game on the board: the rules instance, and everything the screen needs about it. */
interface LiveGame {
  /** This page's own counter, so a stale engine answer cannot land in a new game. */
  readonly id: number;
  readonly chess: Chess;
  readonly startFen: string;
  /** The moves played, in UCI text. */
  readonly moves: readonly string[];
  /** The same moves in algebraic notation, parallel to `moves` - what the move list draws. */
  readonly san: readonly string[];
  readonly playedColor: ChessSide;
  readonly opponent: ChessOpponent;
  readonly level: number | null;
  readonly timeControl: string | null;
  /** The engine's own randomness for this game (see `engine.ts`). */
  readonly seed: number;
  readonly startedAt: string;
  /** Which position the board DRAWS: `moves.length` is the live one. */
  readonly ply: number;
  /** A result the players claimed rather than the position stating it. */
  readonly claimed: ChessResult | null;
  /** A draw has been offered and not answered. */
  readonly drawOffer: boolean;
  /** Opened from the archive or imported: the board shows it and takes no moves. */
  readonly review: boolean;
  /** The PGN as it arrived, or null for a game played here. */
  readonly pgn: string | null;
}

/** How a game has ended, in the archive's vocabulary and in a sentence. */
interface Outcome {
  readonly result: ChessResult;
  readonly text: string;
}

/** The two sides, as this page walks them. */
const SIDES: readonly ChessSide[] = ["w", "b"];

export default function ChessPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<ChessView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [game, setGame] = useState<LiveGame | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<readonly string[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [cursor, setCursor] = useState("e1");
  const [clock, setClock] = useState<ClockState | null>(null);
  const [thinking, setThinking] = useState(false);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [confirm, setConfirm] = useState<"newGame" | "resign" | null>(null);
  const [removing, setRemoving] = useState<ChessGameView | null>(null);

  const gameRef = useRef<LiveGame | null>(null);
  const engineRef = useRef<ChessEngine | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const nextGameId = useRef(1);
  /** Games this page has already written to the archive, so a re-render cannot save one twice. */
  const saved = useRef(new Set<number>());

  const status: GameSnapshot | null = game === null ? null : gameStatus(game.chess);
  const outcome: Outcome | null =
    status === null ? null : outcomeOf(status, game?.claimed ?? null);
  const control: TimeControl | null =
    game === null || game.timeControl === null ? null : parseTimeControl(game.timeControl);
  const over = outcome !== null;
  const ticking = clock !== null && !over && game !== null && !game.review;
  /** Whose turn it is, as a primitive the effects can depend on (see the clock's own effect). */
  const turn: ChessSide | null = status === null ? null : status.turn;

  /**
   * One read of the module, into state. Every mutation answers with the same
   * shape, so there is exactly one way this page learns anything: what main just
   * said. A local guess applied on top of a write would be a second answer to a
   * question that has one.
   */
  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.chess.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the chess games could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // --- The engine -----------------------------------------------------------

  useEffect(() => {
    let live = true;
    void openBuiltInEngine().then((engine) => {
      if (!live) {
        engine.dispose();
        return;
      }
      engineRef.current = engine;
      setDegraded(engine.degraded);
      engine.onInfo(setEngineInfo);
      engine.onBestMove((move) => {
        setThinking(false);
        if (move === null) {
          setError(copy.board.engineFailed);
          return;
        }
        playMove(move);
      });
      setEngineReady(true);
    });
    return () => {
      live = false;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const engineSide: ChessSide | null =
    game === null || game.opponent !== "engine" ? null : game.playedColor === "w" ? "b" : "w";

  /**
   * The engine's turn. The effect is the whole of „who moves next": the board's
   * own turn, the game's own opponent, and nothing else - so a move that arrives
   * while the user is reviewing an earlier position starts no search, and a game
   * that is over starts none either.
   */
  useEffect(() => {
    const engine = engineRef.current;
    if (
      !engineReady ||
      engine === null ||
      game === null ||
      status === null ||
      engineSide === null ||
      thinking ||
      over ||
      game.review ||
      status.turn !== engineSide
    ) {
      return;
    }
    setThinking(true);
    setEngineInfo(null);
    engine.setPosition(game.chess.fen(), game.moves, game.seed);
    engine.go({ level: game.level ?? 1 });
  }, [engineReady, game, status, engineSide, thinking, over]);

  // --- The clocks -----------------------------------------------------------

  useEffect(() => {
    if (!ticking || turn === null) return;
    const handle = setInterval(() => {
      const at = performance.now();
      setClock((current) => (current === null ? current : tickClock(current, turn, at)));
    }, 250);
    return () => clearInterval(handle);
    // `turn` is a primitive on purpose: the snapshot object is rebuilt on every
    // render, and an effect keyed on it would throw its interval away each time
    // the clock it is measuring ticked.
  }, [ticking, turn]);

  useEffect(() => {
    if (clock === null || game === null || over || game.review) return;
    const flagged = flaggedSide(clock);
    // A clock that runs out decides the game for the other side - a claim the
    // archive keeps beside a PGN that ends in „*", because a position nobody has
    // mated is not a finished position.
    if (flagged !== null) claim(flagged === "w" ? "black" : "white");
  }, [clock, game, over]);

  // --- Persistence ----------------------------------------------------------

  useEffect(() => {
    if (game === null || game.review) return;
    if (over) {
      void settle(game);
      return;
    }
    void writeResume(game);
    // The move count IS the game's progress: a write per move is one row, and
    // the alternative is a game that disappears when the window closes.
  }, [game?.id, game?.moves.length, over]);

  // --- Handlers -------------------------------------------------------------

  /** The one place a game object is replaced, so the ref and the state cannot disagree. */
  function remember(next: LiveGame): void {
    gameRef.current = next;
    setGame(next);
  }

  /** One move, played on the instance and remembered - the ONLY way a move reaches the board. */
  function playMove(uci: string): void {
    const current = gameRef.current;
    if (current === null) return;
    const mover = current.chess.turn();
    let san: string;
    try {
      san = applyUci(current.chess, uci);
    } catch (failure) {
      // A move that is not legal here is a caller's bug, never a user's: the
      // board offers only legal moves, and the engine answers with one.
      setError(copy.errors.mutate);
      console.error("Nexus: that chess move is not legal here.", failure);
      return;
    }
    const moves = [...current.moves, uci];
    remember({ ...current, moves, san: [...current.san, san], ply: moves.length, drawOffer: false });
    setSelected(null);
    setPromotion([]);
    // The clock is read off the GAME rather than off this render's own value: this
    // function is also the engine's reply handler, which was registered once and
    // would otherwise charge the engine's move to the clock as it stood at mount.
    const gameClock =
      current.timeControl === null ? null : parseTimeControl(current.timeControl);
    if (gameClock !== null) {
      const at = performance.now();
      setClock((existing) =>
        existing === null ? existing : passClock(existing, mover, gameClock, at),
      );
    }
  }

  /** A result somebody claims: a resignation, an agreed draw, or a clock that ran out. */
  function claim(result: ChessResult): void {
    const current = gameRef.current;
    if (current === null) return;
    setClock((existing) => (existing === null ? existing : stopClock(existing)));
    remember({ ...current, claimed: result, drawOffer: false });
  }

  /** What a press on a square means - the one decision the click, the drag and Enter share. */
  function activate(square: string): void {
    const current = gameRef.current;
    if (current === null || status === null || current.review || over) return;
    if (current.ply < current.moves.length) return;
    if (current.opponent === "engine" && status.turn !== current.playedColor) return;
    const answer = afterSquareActivated(selected, square, legalUci(current.chess));
    if (answer.promotion.length > 0) {
      setSelected(null);
      setPromotion(answer.promotion);
      return;
    }
    if (answer.move !== null) {
      playMove(answer.move);
      return;
    }
    setSelected(answer.selected);
  }

  function moveCursor(next: string): void {
    setCursor(next);
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-square="${next}"]`)?.focus();
  }

  /** Writes the game in progress, so a game survives the page - and the app - closing. */
  async function writeResume(current: LiveGame): Promise<void> {
    try {
      setView(
        await window.nexus.modules.chess.setResume({
          profileId,
          startFen: current.startFen,
          fen: current.chess.fen(),
          moves: [...current.moves],
          playedColor: current.playedColor,
          opponent: current.opponent,
          level: current.level,
          timeControl: current.timeControl,
        }),
      );
    } catch (failure) {
      setError(copy.errors.mutate);
      console.error("Nexus: the chess game in progress could not be saved:", failure);
    }
  }

  /**
   * The end of a game: the archive row first, then the slot it was sitting in.
   *
   * Once per game, and guarded by a ref rather than by a field on the state
   * object: two renders can see the same unfinished object, and a second write
   * would put one game in the archive twice.
   */
  async function settle(current: LiveGame): Promise<void> {
    if (saved.current.has(current.id)) return;
    saved.current.add(current.id);
    const decided = outcomeOf(gameStatus(current.chess), current.claimed);
    if (decided === null) return;
    try {
      setView(
        await window.nexus.modules.chess.saveGame({
          profileId,
          pgn: gamePgn(current.chess, headersOf(current)),
          result: decided.result,
          playedAt: current.startedAt,
          playedColor: current.playedColor,
          opponent: current.opponent,
          level: current.level,
          timeControl: current.timeControl,
        }),
      );
      setNotice(copy.board.saved);
    } catch (failure) {
      setError(copy.board.saveFailed);
      console.error("Nexus: the finished chess game could not be saved:", failure);
    }
    try {
      setView(await window.nexus.modules.chess.clearResume({ profileId }));
    } catch (failure) {
      console.error("Nexus: the chess game in progress could not be cleared:", failure);
    }
  }

  /**
   * A game somebody walks away from: filed as it stands, with the result the
   * store keeps for exactly this case.
   *
   * The alternative is a position that disappears because the user wanted a
   * different opponent, and the archive already has a word for a game that was
   * stopped rather than decided — `unfinished`, which never touches the ladder
   * record (a game nobody finished is not a game anybody won).
   */
  async function archiveUnfinished(current: LiveGame): Promise<void> {
    if (saved.current.has(current.id)) return;
    saved.current.add(current.id);
    try {
      setView(
        await window.nexus.modules.chess.saveGame({
          profileId,
          pgn: gamePgn(current.chess, headersOf(current)),
          result: "unfinished",
          playedAt: current.startedAt,
          playedColor: current.playedColor,
          opponent: current.opponent,
          level: current.level,
          timeControl: current.timeControl,
        }),
      );
    } catch (failure) {
      setError(copy.board.saveFailed);
      console.error("Nexus: the abandoned chess game could not be saved:", failure);
    }
  }

  /** Starting a new game over one in progress: the old one is FILED first, then a new board is dealt. */
  async function startFresh(): Promise<void> {
    const current = gameRef.current;
    if (current !== null && !current.review && !over && current.moves.length > 0) {
      await archiveUnfinished(current);
    }
    startGame();
  }

  // --- Starting, opening and importing --------------------------------------

  const [opponent, setOpponent] = useState<ChessOpponent>("engine");
  const [side, setSide] = useState<ChessSide>("w");
  const [level, setLevel] = useState(3);
  const [clockChoice, setClockChoice] = useState<string>(COMMON_TIME_CONTROLS[4] ?? "600+0");
  const [baseMinutes, setBaseMinutes] = useState("10");
  const [incrementSeconds, setIncrementSeconds] = useState("5");
  const [startFen, setStartFen] = useState("");
  const [importText, setImportText] = useState("");

  /** The custom clock the two fields spell, or null when they do not spell one the store would hold. */
  function customControl(): string | null {
    const minutes = Number(baseMinutes.trim());
    const increment = Number(incrementSeconds.trim());
    if (!Number.isInteger(minutes) || !Number.isInteger(increment)) return null;
    return customTimeControl(minutes * 60, increment);
  }

  function startGame(): void {
    const fen = startFen.trim() === "" ? START_FEN : startFen.trim();
    if (!isValidFen(fen)) {
      setError(copy.errors.fen);
      return;
    }
    const chosen =
      clockChoice === "" ? null : clockChoice === "custom" ? customControl() : clockChoice;
    if (clockChoice === "custom" && chosen === null) {
      setError(copy.errors.clock);
      return;
    }
    const playedColor: ChessSide = side;
    const id = nextGameId.current;
    nextGameId.current += 1;
    remember({
      id,
      chess: createGame(fen),
      startFen: fen,
      moves: [],
      san: [],
      playedColor,
      opponent,
      level: opponent === "engine" ? level : null,
      timeControl: chosen,
      seed: Date.now() % 2_147_483_647,
      startedAt: new Date().toISOString(),
      ply: 0,
      claimed: null,
      drawOffer: false,
      review: false,
      pgn: null,
    });
    setFlipped(playedColor === "b");
    setCursor(playedColor === "w" ? "e1" : "e8");
    setSelected(null);
    setPromotion([]);
    setEngineInfo(null);
    setNotice(null);
    setError(null);
    setConfirm(null);
    const built = chosen === null ? null : parseTimeControl(chosen);
    setClock(built === null ? null : startClock(built, performance.now()));
  }

  /**
   * Puts a game that already exists on the board, for looking at rather than
   * playing: an archive row or an imported PGN.
   *
   * The instance holds the WHOLE game and `ply` says which position the board
   * draws, so the move list is a real walk through it — „to the end" is a button,
   * and every ply in between is reachable. Nothing here can be written back:
   * `review` is what stops both the move handlers and the archive write, which is
   * also why an imported game's colour and opponent may be placeholders — they
   * name a row this page never writes.
   */
  function loadForReview(
    pgn: string,
    playedColor: ChessSide,
    opponentForRow: ChessOpponent,
    levelForRow: number | null,
    timeControlForRow: string | null,
    startedAt: string,
  ): void {
    const loaded = loadGamePgn(pgn);
    const played = gameStatus(loaded);
    const startFen = loaded.header()["FEN"] ?? START_FEN;
    const id = nextGameId.current;
    nextGameId.current += 1;
    remember({
      id,
      // The instance keeps the WHOLE game, so the position the board is on can be
      // walked back to the start and the flags that need a history (a threefold
      // repetition) are the real ones. The board draws `shownFen`, so it can show
      // any ply of it.
      chess: loaded,
      startFen,
      moves: played.uci,
      san: played.san,
      playedColor,
      opponent: opponentForRow,
      level: levelForRow,
      timeControl: timeControlForRow,
      seed: Date.now() % 2_147_483_647,
      startedAt,
      // Opened at the END: „how did it finish" is the question a saved game is
      // opened with, and the navigation walks back from there.
      ply: played.uci.length,
      claimed: null,
      drawOffer: false,
      review: true,
      pgn,
    });
    setFlipped(playedColor === "b");
    setCursor(playedColor === "w" ? "e1" : "e8");
    setClock(null);
    setSelected(null);
    setPromotion([]);
    setEngineInfo(null);
    setNotice(null);
    setError(null);
  }

  /** Opens a saved game on the board for review. A game that is gone is refused, not guessed at. */
  async function openGame(id: string): Promise<void> {
    try {
      const detail = await window.nexus.modules.chess.getGame({ profileId, id });
      if (detail === null) {
        setError(copy.errors.load);
        return;
      }
      loadForReview(
        detail.pgn,
        detail.playedColor,
        detail.opponent,
        detail.level,
        detail.timeControl,
        detail.playedAt,
      );
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: that chess game could not be opened:", failure);
    }
  }

  /**
   * Reads a pasted PGN onto the board, or refuses it with a sentence.
   *
   * An imported game is REVIEWED and not filed: the archive's row names the
   * colour the user played and the opponent they played against, and a game
   * somebody else played has neither — a row claiming one of them would be a
   * stored fact this build invented.
   */
  function importPgn(): void {
    try {
      loadForReview(importText, "w", "human", null, null, new Date().toISOString());
    } catch {
      // The read is what refuses: a text that is not a game throws inside
      // `loadGamePgn` before a single piece of state is set.
      setError(copy.pgn.importError);
      return;
    }
    setImportText("");
    setNotice(copy.pgn.importLoaded);
  }

  /** The PGN of the game on the board: the one it arrived with, or one written from it now. */
  function pgnOf(current: LiveGame): string {
    return current.pgn ?? gamePgn(current.chess, headersOf(current));
  }

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(copy.pgn.copied);
      setError(null);
    } catch (failure) {
      setError(copy.pgn.copyFailed);
      console.error("Nexus: the PGN could not be copied:", failure);
    }
  }

  async function copyGamePgn(id: string): Promise<void> {
    try {
      const detail = await window.nexus.modules.chess.getGame({ profileId, id });
      if (detail === null) {
        setError(copy.errors.load);
        return;
      }
      await copyText(detail.pgn);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: that chess game could not be read:", failure);
    }
  }

  async function removeGame(row: ChessGameView): Promise<void> {
    setRemoving(null);
    try {
      setView(await window.nexus.modules.chess.deleteGame({ profileId, id: row.id }));
    } catch (failure) {
      setError(copy.errors.mutate);
      console.error("Nexus: that chess game could not be deleted:", failure);
    }
  }

  /** Resumes the game the profile was holding, with a fresh clock — see the header on why. */
  function continueResume(resume: ChessResumeView): void {
    const chess = createGame(resume.startFen);
    for (const move of resume.moves) applyUci(chess, move);
    const played = gameStatus(chess);
    const id = nextGameId.current;
    nextGameId.current += 1;
    remember({
      id,
      chess,
      startFen: resume.startFen,
      moves: played.uci,
      san: played.san,
      playedColor: resume.playedColor,
      opponent: resume.opponent,
      level: resume.level,
      timeControl: resume.timeControl,
      seed: Date.now() % 2_147_483_647,
      startedAt: resume.createdAt,
      ply: resume.moves.length,
      claimed: null,
      drawOffer: false,
      review: false,
      pgn: null,
    });
    setFlipped(resume.playedColor === "b");
    setCursor(resume.playedColor === "w" ? "e1" : "e8");
    const built = resume.timeControl === null ? null : parseTimeControl(resume.timeControl);
    setClock(built === null ? null : startClock(built, performance.now()));
    setSelected(null);
    setPromotion([]);
    setNotice(null);
    setError(null);
  }

  // --- The board's own derived values ---------------------------------------

  const shownFen = useMemo(() => {
    if (game === null) return null;
    if (game.ply >= game.moves.length) return game.chess.fen();
    return replayUci(game.startFen, game.moves.slice(0, game.ply)).fen;
  }, [game]);

  const cells: BoardCells | null = useMemo(
    () => (shownFen === null ? null : createGame(shownFen).board()),
    [shownFen],
  );

  const live = game !== null && game.ply >= game.moves.length;
  const shownMoves = game === null ? [] : game.moves.slice(0, game.ply);
  const lastMove =
    shownMoves.length === 0 ? null : moveFields(shownMoves[shownMoves.length - 1] ?? "");
  const legalHere = useMemo(
    () => (live && shownFen !== null ? legalUci(createGame(shownFen)) : []),
    [live, shownFen],
  );
  const targets = new Set(
    selected === null
      ? []
      : legalHere.filter((uci) => uci.startsWith(selected)).map((uci) => uci.slice(2, 4)),
  );
  const checkSquare =
    status !== null && status.inCheck && live && shownFen !== null
      ? kingSquareOf(createGame(shownFen))
      : null;

  // --- The screen -----------------------------------------------------------

  return (
    <div className="chess">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="grid"
      />
      {error !== null && (
        <p className="chess__error" role="alert">
          {error}
        </p>
      )}
      {notice !== null && (
        <p className="nx-hint" role="status">
          {notice}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : (
        <>
          <Card className="chess__card" title={copy.board.title}>
            {game === null || status === null || cells === null ? (
              <EmptyState
                variant="inline"
                title={copy.board.empty}
                action={<Button onClick={startGame}>{copy.setup.start}</Button>}
              />
            ) : (
              <>
                {control !== null && clock !== null && (
                  <div className="chess__clocks">
                    {SIDES.map((each) => (
                      <div
                        key={each}
                        className={
                          status.turn === each && !over
                            ? "chess__clock chess__clock--live"
                            : "chess__clock"
                        }
                      >
                        <span className="chess__clock-name">
                          {each === "w" ? copy.board.white : copy.board.black}
                        </span>
                        <span className="chess__clock-time">
                          {formatRemaining(each === "w" ? clock.whiteMs : clock.blackMs)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="chess__row">
                  <Board
                    boardRef={boardRef}
                    cells={cells}
                    flipped={flipped}
                    cursor={cursor}
                    selected={selected}
                    targets={targets}
                    lastMove={lastMove}
                    checkSquare={checkSquare}
                    onActivate={activate}
                    onCursor={setCursor}
                    onKeyDown={(event) =>
                      onBoardKey(event, cursor, flipped, moveCursor, activate)
                    }
                  />
                  <div className="chess__side">
                    <p className="chess__turn" aria-live="polite">
                      {statusText(status, outcome)}
                    </p>
                    {game.review && <Chip variant="accent">{copy.board.review}</Chip>}
                    {status.checkmate && <Chip variant="danger">{copy.board.checkmate}</Chip>}
                    {thinking && <p className="nx-hint">{copy.board.thinking}</p>}
                    {degraded && <p className="nx-hint">{copy.board.degraded}</p>}
                    {engineInfo !== null && !thinking && (
                      <p className="nx-hint">
                        {copy.board.depth} {numberFormat().format(engineInfo.depth)} ·{" "}
                        {numberFormat().format(engineInfo.nodes)} {copy.board.nodes}
                      </p>
                    )}
                    {engineMoveText(game, status) !== null && (
                      <p className="nx-hint">
                        {copy.board.engineMove}: {engineMoveText(game, status)}
                      </p>
                    )}
                    <p className="chess__fen" aria-label={copy.board.fenLabel}>
                      {shownFen}
                    </p>
                    <div className="chess__actions">
                      <Button size="sm" onClick={() => setFlipped((on) => !on)}>
                        {copy.board.flip}
                      </Button>
                      {!live && (
                        <Button
                          size="sm"
                          onClick={() =>
                            remember({
                              ...game,
                              ply: plyAfter(game.ply, "last", game.moves.length),
                            })
                          }
                        >
                          {copy.board.toLive}
                        </Button>
                      )}
                      {!game.review && !over && (
                        <>
                          <Button size="sm" onClick={() => setConfirm("resign")}>
                            {copy.board.resign}
                          </Button>
                          {game.opponent === "human" && !game.drawOffer && (
                            <Button
                              size="sm"
                              onClick={() => remember({ ...game, drawOffer: true })}
                            >
                              {copy.board.offerDraw}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                    {game.drawOffer && !over && (
                      <div className="chess__offer">
                        <Button size="sm" variant="primary" onClick={() => claim("draw")}>
                          {copy.board.acceptDraw}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            const current = gameRef.current;
                            if (current !== null) remember({ ...current, drawOffer: false });
                            setNotice(copy.board.drawDeclined);
                          }}
                        >
                          {copy.board.declineDraw}
                        </Button>
                      </div>
                    )}
                    {game.drawOffer && !over && (
                      <p className="nx-hint">{copy.board.drawOffered}</p>
                    )}
                    {promotion.length > 0 && (
                      <div
                        className="chess__promotion"
                        role="group"
                        aria-label={copy.promotion.title}
                      >
                        <span className="chess__promotion-title">{copy.promotion.title}</span>
                        {promotion.map((uci) => (
                          <Button
                            key={uci}
                            size="sm"
                            variant="primary"
                            onClick={() => playMove(uci)}
                          >
                            {promotionName(uci)}
                          </Button>
                        ))}
                        <Button size="sm" variant="quiet" onClick={() => setPromotion([])}>
                          {copy.promotion.cancel}
                        </Button>
                      </div>
                    )}
                    <p className="nx-hint">{copy.board.keyboardHint}</p>
                  </div>
                </div>
              </>
            )}
          </Card>

          {game !== null && (
            <Card className="chess__card" title={copy.moves.title}>
              {game.moves.length === 0 ? (
                <p className="nx-hint">{copy.moves.empty}</p>
              ) : (
                <div className="chess__moves">
                  {moveRows(game.moves, game.san).map((row) => (
                    <div key={row.number} className="chess__move-row">
                      <span className="chess__move-number">
                        {numberFormat().format(row.number)}.
                      </span>
                      {[row.white, row.black].map((ref, index) =>
                        ref === null ? (
                          <span key={index} className="chess__move-empty" />
                        ) : (
                          <button
                            key={index}
                            type="button"
                            className={
                              game.ply === ref.ply
                                ? "chess__move chess__move--current"
                                : "chess__move"
                            }
                            aria-current={game.ply === ref.ply ? "true" : undefined}
                            onClick={() => remember({ ...game, ply: ref.ply })}
                          >
                            {ref.san}
                          </button>
                        ),
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="chess__actions">
                {(["first", "previous", "next", "last"] as const).map((action: PlyJump) => (
                  <Button
                    key={action}
                    size="sm"
                    disabled={game.moves.length === 0}
                    onClick={() =>
                      remember({ ...game, ply: plyAfter(game.ply, action, game.moves.length) })
                    }
                  >
                    {copy.moves[action]}
                  </Button>
                ))}
                <span className="chess__row-meta">
                  {copy.moves.position} {numberFormat().format(game.ply)}
                </span>
              </div>
            </Card>
          )}

          <Card className="chess__card" title={copy.setup.title}>
            <div className="chess__form">
              <Select
                label={copy.setup.opponent}
                value={opponent}
                onChange={(event) => setOpponent(event.target.value === "human" ? "human" : "engine")}
              >
                <option value="engine">{copy.setup.opponentEngine}</option>
                <option value="human">{copy.setup.opponentHuman}</option>
              </Select>
              <Select
                label={copy.setup.color}
                value={side}
                onChange={(event) => setSide(event.target.value === "b" ? "b" : "w")}
              >
                <option value="w">{copy.setup.colorWhite}</option>
                <option value="b">{copy.setup.colorBlack}</option>
              </Select>
              {opponent === "engine" && (
                <Select
                  label={copy.setup.level}
                  value={String(level)}
                  onChange={(event) => setLevel(Number(event.target.value))}
                >
                  {CHESS_LEVELS.map((each) => (
                    <option key={each.level} value={String(each.level)}>
                      {copy.setup.level} {numberFormat().format(each.level)}
                    </option>
                  ))}
                </Select>
              )}
              <Select
                label={copy.setup.clock}
                value={clockChoice}
                onChange={(event) => setClockChoice(event.target.value)}
              >
                <option value="">{copy.setup.clockNone}</option>
                {COMMON_TIME_CONTROLS.map((each) => (
                  <option key={each} value={each}>
                    {timeControlWords(each)}
                  </option>
                ))}
                <option value="custom">{copy.setup.clockCustom}</option>
              </Select>
              {clockChoice === "custom" && (
                <>
                  <TextField
                    label={copy.setup.clockBase}
                    className="chess__number"
                    inputMode="numeric"
                    value={baseMinutes}
                    onChange={(event) => setBaseMinutes(event.target.value)}
                  />
                  <TextField
                    label={copy.setup.clockIncrement}
                    className="chess__number"
                    inputMode="numeric"
                    value={incrementSeconds}
                    onChange={(event) => setIncrementSeconds(event.target.value)}
                  />
                </>
              )}
              <TextField
                label={copy.setup.startFen}
                className="chess__fen-field"
                value={startFen}
                onChange={(event) => setStartFen(event.target.value)}
              />
            </div>
            <p className="nx-hint">{copy.setup.startFenHint}</p>
            <div className="chess__actions">
              <Button
                variant="primary"
                onClick={() => {
                  // A game in progress is thrown away by this button, and the
                  // confirmation is what says so before it happens.
                  if (game !== null && !game.review && !over && game.moves.length > 0) {
                    setConfirm("newGame");
                    return;
                  }
                  startGame();
                }}
              >
                {copy.setup.start}
              </Button>
            </div>
          </Card>

          <Card className="chess__card" title={copy.pgn.title}>
            <TextArea
              label={copy.pgn.importLabel}
              rows={4}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
            <p className="nx-hint">{copy.pgn.importHint}</p>
            <div className="chess__actions">
              <Button disabled={importText.trim() === ""} onClick={importPgn}>
                {copy.pgn.import}
              </Button>
              <Button
                disabled={game === null}
                onClick={() => {
                  const current = gameRef.current;
                  if (current !== null) void copyText(pgnOf(current));
                }}
              >
                {copy.pgn.export}
              </Button>
            </div>
            <p className="nx-hint">{copy.pgn.exportHint}</p>
          </Card>

          <Card className="chess__card" title={copy.games.title}>
            {view.resume !== null && (
              <div className="chess__resume">
                <Chip variant="accent">{copy.games.resumeTitle}</Chip>
                <span className="chess__row-meta">{resumeText(view.resume)}</span>
                <Button size="sm" onClick={() => continueResume(view.resume as ChessResumeView)}>
                  {copy.games.resume}
                </Button>
              </div>
            )}
            {view.games.length === 0 ? (
              <EmptyState
                variant="inline"
                title={copy.games.emptyTitle}
                description={copy.games.emptyBody}
              />
            ) : (
              <div className="chess__list">
                {view.games.map((row) => (
                  <ListRow
                    key={row.id}
                    leading={<Icon name="grid" />}
                    trailing={
                      <span className="chess__row-actions">
                        <Button size="sm" onClick={() => void openGame(row.id)}>
                          {copy.games.open}
                        </Button>
                        <Button size="sm" onClick={() => void copyGamePgn(row.id)}>
                          {copy.pgn.export}
                        </Button>
                        <Button size="sm" variant="quiet" onClick={() => setRemoving(row)}>
                          {copy.games.remove}
                        </Button>
                      </span>
                    }
                  >
                    <span className="chess__row-label">{dateText(row.playedAt)}</span>
                    <span className="chess__row-meta">{rowText(row)}</span>
                    <Chip>{resultText(row.result)}</Chip>
                  </ListRow>
                ))}
              </div>
            )}
          </Card>

          <Card className="chess__card" title={copy.stats.title}>
            {view.stats.every((entry) => entry.played === 0) ? (
              <p className="nx-hint">{copy.stats.empty}</p>
            ) : (
              <div className="chess__stats">
                {view.stats
                  .filter((entry) => entry.played > 0)
                  .map((entry) => (
                    <p key={entry.level} className="chess__stat">
                      <span className="chess__stat-level">
                        {copy.setup.level} {numberFormat().format(entry.level)} —{" "}
                      </span>
                      {copy.stats.played} {numberFormat().format(entry.played)} · {copy.stats.won}{" "}
                      {numberFormat().format(entry.won)} · {copy.stats.drawn}{" "}
                      {numberFormat().format(entry.drawn)} · {copy.stats.lost}{" "}
                      {numberFormat().format(entry.lost)}
                    </p>
                  ))}
              </div>
            )}
          </Card>
        </>
      )}

      {confirm === "newGame" && (
        <ConfirmDialog
          title={copy.setup.title}
          question={copy.board.newGameQuestion}
          confirmLabel={copy.setup.start}
          cancelLabel={copy.common.cancel}
          onConfirm={() => void startFresh()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "resign" && (
        <ConfirmDialog
          title={copy.board.resign}
          question={copy.board.resignQuestion}
          confirmLabel={copy.board.resign}
          cancelLabel={copy.common.cancel}
          onConfirm={() => {
            setConfirm(null);
            const current = gameRef.current;
            if (current !== null) claim(current.playedColor === "w" ? "black" : "white");
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {removing !== null && (
        <ConfirmDialog
          title={copy.games.remove}
          name={dateText(removing.playedAt)}
          question={copy.games.removeQuestion}
          confirmLabel={copy.games.remove}
          cancelLabel={copy.common.cancel}
          onConfirm={() => void removeGame(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

// --- The board ---------------------------------------------------------------

/**
 * The sixty-four squares.
 *
 * **Why the squares are real buttons.** A square is a control: it is clicked,
 * dragged onto, reached by Tab, and pressed with Enter or Space, and a button is
 * the one element that already means all of that. A roving `tabIndex` keeps the
 * board a SINGLE tab stop - sixty-four stops would put the page's own controls
 * out of reach - and the arrow keys walk between the squares inside it.
 *
 * **The pointer half, and why it is pointer-only.** `pointerdown` picks a piece
 * up and `pointerup` on ANOTHER square puts it down, which is the drag; a press
 * and a release on ONE square is deliberately left to the `click` that follows
 * it, so a plain click and a drop can never both play the same move.
 */
function Board({
  boardRef,
  cells,
  flipped,
  cursor,
  selected,
  targets,
  lastMove,
  checkSquare,
  onActivate,
  onCursor,
  onKeyDown,
}: {
  boardRef: React.RefObject<HTMLDivElement | null>;
  cells: BoardCells;
  flipped: boolean;
  cursor: string;
  selected: string | null;
  targets: ReadonlySet<string>;
  lastMove: { from: string; to: string } | null;
  checkSquare: string | null;
  onActivate: (square: string) => void;
  onCursor: (square: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const dragFrom = useRef<string | null>(null);

  return (
    <div
      ref={boardRef}
      className="chess__board"
      role="group"
      aria-label={copy.board.title}
      onKeyDown={onKeyDown}
    >
      {displayRows(cells, flipped).map((row) => (
        <div key={row[0]?.square ?? "row"} className="chess__rank">
          {row.map((cell) => {
            const classes = [
              "chess__square",
              cell.light ? "chess__square--light" : "chess__square--dark",
            ];
            if (lastMove !== null && (cell.square === lastMove.from || cell.square === lastMove.to)) {
              classes.push("chess__square--last");
            }
            if (cell.square === selected) classes.push("chess__square--picked");
            if (cell.square === checkSquare) classes.push("chess__square--check");
            return (
              <button
                key={cell.square}
                type="button"
                data-square={cell.square}
                tabIndex={cell.square === cursor ? 0 : -1}
                className={classes.join(" ")}
                aria-label={squareLabel(cell.square, cell.piece, selected, targets)}
                onFocus={() => {
                  if (cell.square !== cursor) onCursor(cell.square);
                }}
                onClick={() => onActivate(cell.square)}
                onPointerDown={() => {
                  dragFrom.current = cell.square;
                }}
                onPointerUp={() => {
                  if (dragFrom.current !== null && dragFrom.current !== cell.square) {
                    onActivate(cell.square);
                  }
                  dragFrom.current = null;
                }}
              >
                {cell.piece !== null && (
                  <span className="chess__piece" aria-hidden="true">
                    {pieceGlyph(cell.piece.color, cell.piece.type)}
                  </span>
                )}
                {targets.has(cell.square) && (
                  <span
                    className={
                      // A destination that is OCCUPIED is a capture, and a ring
                      // around the piece says so where a dot would sit on top of
                      // it. Shape, not colour - the redundancy rule on a board.
                      cell.piece === null ? "chess__target" : "chess__target chess__target--capture"
                    }
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// --- Pure helpers ------------------------------------------------------------

/**
 * What one square is called to a reader: its name, what stands on it, and the two
 * states a square can be in. Colour is never the only channel here either - the
 * picked square and a legal destination both say so in words.
 */
function squareLabel(
  square: string,
  piece: BoardPiece | null,
  selected: string | null,
  targets: ReadonlySet<string>,
): string {
  const parts = [square];
  if (piece !== null) parts.push(copy.board.pieces[piece.color][piece.type]);
  if (square === selected) parts.push(copy.board.picked);
  if (targets.has(square)) parts.push(copy.board.moveTarget);
  return parts.join(", ");
}

/** The key the board's arrows and Enter mean, wherever the focus sits inside it. */
function onBoardKey(
  event: React.KeyboardEvent<HTMLDivElement>,
  cursor: string,
  flipped: boolean,
  moveCursor: (square: string) => void,
  activate: (square: string) => void,
): void {
  const key = event.key;
  if (key === "Enter" || key === " ") {
    event.preventDefault();
    activate(cursor);
    return;
  }
  if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const next = squareInDirection(cursor, key, flipped);
  if (next !== null) moveCursor(next);
}

/** How a game has ended, in the archive's vocabulary and in a sentence - `null` while it is being played. */
function outcomeOf(status: GameSnapshot, claimed: ChessResult | null): Outcome | null {
  if (claimed !== null) return { result: claimed, text: resultText(claimed) };
  if (status.checkmate) {
    const winner: ChessResult = status.turn === "w" ? "black" : "white";
    return { result: winner, text: resultText(winner) };
  }
  if (status.stalemate) return { result: "draw", text: copy.board.stalemate };
  if (status.insufficientMaterial) return { result: "draw", text: copy.board.drawInsufficient };
  if (status.fiftyMoveDraw) return { result: "draw", text: copy.board.drawFifty };
  if (status.threefoldRepetition) return { result: "draw", text: copy.board.drawThreefold };
  return null;
}

/** The result of a row or a chip, in the language being read. */
function resultText(result: ChessResult): string {
  if (result === "white") return copy.board.resultWhite;
  if (result === "black") return copy.board.resultBlack;
  if (result === "draw") return copy.board.draw;
  return copy.board.resultUnfinished;
}

/** The line above the board: whose turn it is, or how the game ended. */
function statusText(status: GameSnapshot, outcome: Outcome | null): string {
  if (outcome !== null) return outcome.text;
  const side = status.turn === "w" ? copy.board.white : copy.board.black;
  const check = status.inCheck ? ` - ${copy.board.check}` : "";
  return `${copy.board.turn}: ${side}${check}`;
}

/** The engine's own last move, when the last move on the board was its. */
function engineMoveText(game: LiveGame, status: GameSnapshot): string | null {
  if (game.opponent !== "engine" || status.san.length === 0) return null;
  const engineSide: ChessSide = game.playedColor === "w" ? "b" : "w";
  const lastMover: ChessSide = game.moves.length % 2 === 1 ? "w" : "b";
  return lastMover === engineSide ? (status.san[status.san.length - 1] ?? null) : null;
}

/** Where the king of the side to move stands, for the square that draws a check. */
function kingSquareOf(chess: Chess): string | null {
  const side = chess.turn();
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell !== null && cell.type === "k" && cell.color === side) return cell.square;
    }
  }
  return null;
}

/** The piece a promotion move names, in the user's language. */
function promotionName(uci: string): string {
  const piece = uci[4];
  if (piece === "r") return copy.promotion.rook;
  if (piece === "b") return copy.promotion.bishop;
  if (piece === "n") return copy.promotion.knight;
  return copy.promotion.queen;
}

/** One saved game's own line: who it was against, at what level, and on what clock. */
function rowText(row: ChessGameView): string {
  const parts = [row.opponent === "engine" ? copy.setup.opponentEngine : copy.setup.opponentHuman];
  if (row.level !== null) parts.push(`${copy.setup.level} ${numberFormat().format(row.level)}`);
  if (row.timeControl !== null) parts.push(timeControlWords(row.timeControl));
  return parts.join(" · ");
}

/** The game in progress as one line: the opponent, the clock, and how far it has come. */
function resumeText(resume: ChessResumeView): string {
  const parts = [resume.opponent === "engine" ? copy.setup.opponentEngine : copy.setup.opponentHuman];
  if (resume.level !== null) parts.push(`${copy.setup.level} ${numberFormat().format(resume.level)}`);
  if (resume.timeControl !== null) parts.push(timeControlWords(resume.timeControl));
  parts.push(`${numberFormat().format(resume.moves.length)} ${copy.games.moves}`);
  return parts.join(" · ");
}

/** The PGN's tags for a game played here. `gamePgn` takes the result from the position itself. */
function headersOf(game: LiveGame): Record<string, string> {
  const opponent =
    game.opponent === "engine"
      ? `${copy.setup.opponentEngine}${
          game.level === null ? "" : ` - ${copy.setup.level} ${numberFormat().format(game.level)}`
        }`
      : copy.setup.opponentHuman;
  const you = copy.pgn.playerYou;
  return {
    Event: copy.pgn.event,
    Site: copy.pgn.site,
    Date: pgnDate(game.startedAt),
    White: game.playedColor === "w" ? you : opponent,
    Black: game.playedColor === "w" ? opponent : you,
  };
}

/** A PGN date: `YYYY.MM.DD`, the format the standard names - never a localised one. */
function pgnDate(instant: string): string {
  return instant.slice(0, 10).replace(/-/g, ".");
}

/** One instant as the date the archive row draws, through `Intl` in the language being read. */
function dateText(instant: string): string {
  return dateTimeFormat({ dateStyle: "medium" }).format(new Date(instant));
}
