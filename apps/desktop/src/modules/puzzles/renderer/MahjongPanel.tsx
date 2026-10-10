import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, LoadingState } from "@nexus/ui";
import type { MahjongStateView } from "../shared/ipc.js";
import { activeLocale } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { copy } from "./copy.js";
import type { EngineStage } from "./engine.js";
import { useEngine } from "./engineClient.js";
import { formatClock, formatCount } from "./format.js";
import {
  boardBox,
  freeSlots,
  gameOf,
  isFree,
  isStuck,
  isWon,
  remainingCount,
  shuffleRemaining,
  slotAt,
  stackOrder,
  stepBack as undoMove,
  stateOf,
  takePair,
  tileBox,
  tileFace,
  type TileFace as TileFaceParts,
} from "./mahjong.js";
import {
  ActionRow,
  Readout,
  initialGame,
  useElapsedClock,
  variantLabel,
  type PanelProps,
} from "./panelKit.js";
import { newSeed } from "./seed.js";

/**
 * MAHJONG SOLITAIRE (ADR-090): the turtle, the free-tile rule, and a shuffle for
 * a board that has run out.
 *
 * **Only free tiles are selectable, and the engine says which those are.** A
 * blocked tile is drawn disabled, so the rule is visible before a click rather
 * than after one — and because the disabled state is what a screen reader
 * announces, the board tells both readers the same thing.
 *
 * **The hint is a searched move, not merely a legal one.** `mahjongHint` returns
 * the first pair of an order that still clears the board, which is a search over
 * the remaining tiles; it runs in the worker for that reason, and the panel shows
 * the search stage while it runs.
 *
 * **The board is drawn flat and painted in layer order.** A tile occupies two
 * quarter-units of the layout and a positioned box with no `z-index` paints where
 * it stands in the tree, so the tiles are emitted layer by layer — which is what
 * makes the stacks stack without any surface naming a stacking order
 * (`check:layers`' rule).
 */

const PUZZLE = "mahjong";

export function MahjongPanel({ saves, variants, onSave, onFinish, onClear }: PanelProps) {
  const engine = useEngine();
  const [initial] = useState(() => initialGame(saves, PUZZLE, variants, newSeed));
  const [seed, setSeed] = useState(initial.seed);
  const [board, setBoard] = useState<MahjongStateView | null>(
    initial.saved === null ? null : (initial.saved.state as MahjongStateView),
  );
  const clock = useElapsedClock(initial.elapsedSeconds);
  const [faces, setFaces] = useState<readonly string[] | null>(
    board === null ? null : board.faces,
  );
  const [stage, setStage] = useState<EngineStage | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [hintPair, setHintPair] = useState<readonly [number, number] | null>(null);
  const [hinting, setHinting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The pairs stepped back from, newest last: „Napred" re-takes one. */
  const [redoStack, setRedoStack] = useState<readonly (readonly [number, number])[]>([]);
  const solvedOnce = useRef(false);

  // A deal, for a profile that has none. A deal this profile already has comes
  // with the row, because the faces ARE the game.
  useEffect(() => {
    if (faces !== null) return;
    let active = true;
    setStage(null);
    setFailed(false);
    engine
      .request({ kind: PUZZLE, seed }, (next) => {
        if (active) setStage(next);
      })
      .then((response) => {
        if (!active || response.kind !== PUZZLE) return;
        setFaces(response.faces);
        setStage(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFailed(true);
        setStage(null);
        console.error("Nexus: the mahjong deal could not be built:", error);
      });
    return () => {
      active = false;
    };
  }, [engine, faces, seed]);

  useEffect(() => {
    if (faces === null || board !== null) return;
    const fresh: MahjongStateView = {
      faces,
      remaining: new Array<boolean>(faces.length).fill(true),
      shuffles: 0,
    };
    setBoard(fresh);
    onSave({ puzzle: PUZZLE, variant: "turtle", seed, state: fresh, elapsedSeconds: clock.seconds });
  }, [faces, board, seed, clock.seconds, onSave]);

  // The engine's board is a value the panel derives, so nothing here keeps two
  // copies of it: the row is the state and this is the position.
  const game = useMemo(
    () => (board === null ? null : gameOf(board, seed)),
    [board, seed],
  );

  useEffect(() => {
    if (game === null || solvedOnce.current) return;
    if (!isWon(game)) return;
    solvedOnce.current = true;
    onFinish({ puzzle: PUZZLE, variant: "turtle", solved: true, elapsedSeconds: clock.seconds });
  }, [game, clock.seconds, onFinish]);

  function play(next: MahjongStateView): void {
    setBoard(next);
    setHintPair(null);
    setNotice(null);
    onSave({ puzzle: PUZZLE, variant: "turtle", seed, state: next, elapsedSeconds: clock.seconds });
  }

  function newGame(): void {
    onClear({ puzzle: PUZZLE, variant: "turtle" });
    const next = newSeed();
    setSeed(next);
    setBoard(null);
    setFaces(null);
    setSelected(null);
    setHintPair(null);
    setRedoStack([]);
    setNotice(null);
    clock.restart(0);
    solvedOnce.current = false;
  }

  function select(index: number): void {
    if (game === null) return;
    if (selected === null) {
      if (isFree(game, index)) setSelected(index);
      return;
    }
    if (selected === index) {
      setSelected(null);
      return;
    }
    const taken = takePair(game, selected, index);
    if (taken === null) {
      // The pair was not a play: a blocked tile is a normal thing to click, so
      // the selection moves to it when it is free and stays otherwise.
      if (isFree(game, index)) setSelected(index);
      return;
    }
    setSelected(null);
    setRedoStack([]);
    play(stateOf(taken, board?.shuffles ?? 0));
  }

  function stepBack(): void {
    if (game === null || board === null) return;
    const last = game.moves[game.moves.length - 1];
    const undone = undoMove(game);
    if (undone === null) return;
    if (last !== undefined) setRedoStack((current) => [...current, [last.a, last.b]]);
    setSelected(null);
    play(stateOf(undone, board.shuffles));
  }

  function stepForward(): void {
    if (board === null) return;
    const next = redoStack[redoStack.length - 1];
    if (next === undefined) return;
    const current = gameOf(board, seed);
    const taken = takePair(current, next[0], next[1]);
    if (taken === null) return;
    setRedoStack((stack) => stack.slice(0, -1));
    play(stateOf(taken, board.shuffles));
  }

  function shuffle(): void {
    if (game === null || board === null) return;
    try {
      const shuffled = shuffleRemaining(game, newSeed());
      setSelected(null);
      setRedoStack([]);
      setNotice(copy.mahjong.shuffled);
      play(stateOf(shuffled, board.shuffles + 1));
    } catch {
      // The engine refuses a shape no arrangement of faces can rescue, which is
      // a real end state rather than a fault: the sentence says so.
      setNotice(copy.mahjong.shuffleFailed);
    }
  }

  function askHint(): void {
    if (board === null) return;
    setHinting(true);
    setNotice(null);
    engine
      .request({ kind: "mahjong-hint", seed, state: board }, (next) => {
        if (next === "search") setHinting(true);
      })
      .then((response) => {
        setHinting(false);
        if (response.kind !== "mahjong-hint") return;
        setHintPair(response.pair);
        if (response.pair === null) setNotice(copy.mahjong.hintNone);
      })
      .catch((error: unknown) => {
        setHinting(false);
        console.error("Nexus: the mahjong hint could not be found:", error);
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
  if (board === null || game === null) {
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
  const cell = 14;
  const box = boardBox(cell);
  const free = new Set(freeSlots(game));
  const order = stackOrder();
  const leftovers = remainingCount(board);

  return (
    <Card className="pz__card">
      <div className="pz__row">
        <Readout label={copy.mahjong.layout} value={variantLabel("mahjong", "turtle")} />
        <Readout
          label={copy.mahjong.left}
          value={formatCount(leftovers, locale)}
        />
        <Readout label={copy.common.time} value={formatClock(clock.seconds)} />
      </div>

      <div className="pz-turtle__scroll">
        <div
          className="pz-turtle"
          style={{ width: `${box.width}px`, height: `${box.height}px` }}
          role="group"
          aria-label={variantLabel("mahjong", "turtle")}
        >
          {order.map((index) => {
            if (board.remaining[index] !== true) return null;
            const face = board.faces[index] ?? "";
            const parts = tileFace(face);
            const spot = tileBox(slotAt(index), cell);
            const classes = ["pz-turtle__tile"];
            if (selected === index) classes.push("pz-turtle__tile--selected");
            if (hintPair !== null && (hintPair[0] === index || hintPair[1] === index)) {
              classes.push("pz-turtle__tile--hint");
            }
            if (!free.has(index)) classes.push("pz-turtle__tile--blocked");
            return (
              <button
                key={index}
                type="button"
                className={classes.join(" ")}
                style={{
                  left: `${spot.left}px`,
                  top: `${spot.top}px`,
                  width: `${spot.width}px`,
                  height: `${spot.height}px`,
                }}
                disabled={!free.has(index)}
                aria-label={faceLabel(parts, locale)}
                aria-pressed={selected === index}
                onClick={() => select(index)}
              >
                <TileGlyph parts={parts} locale={locale} />
              </button>
            );
          })}
        </div>
      </div>

      <ActionRow>
        <Button size="sm" onClick={askHint} disabled={hinting}>
          {copy.common.hint}
        </Button>
        <Button size="sm" onClick={shuffle} disabled={!isStuck(game)}>
          {copy.mahjong.shuffle}
        </Button>
        <Button size="sm" onClick={stepBack} disabled={game.moves.length === 0}>
          {copy.common.undo}
        </Button>
        <Button size="sm" onClick={stepForward} disabled={redoStack.length === 0}>
          {copy.common.redo}
        </Button>
        <Button size="sm" variant="primary" onClick={newGame}>
          {copy.common.newGame}
        </Button>
      </ActionRow>

      {hinting && <p className="pz__note">{copy.page.stages.search}</p>}
      {hintPair !== null && <p className="pz__note" role="status">{copy.mahjong.hintLead}</p>}
      {notice !== null && <p className="pz__note">{notice}</p>}
      {isStuck(game) && <p className="pz__note" role="status">{copy.mahjong.stuck}</p>}
      {isWon(game) && <p className="pz__solved" role="status">{copy.mahjong.solved}</p>}
    </Card>
  );
}

/** The face as a person reads it: a suit and a rank, a wind, a dragon, or one of the four flowers and seasons. */
function faceLabel(parts: TileFaceParts, locale: ReturnType<typeof activeLocale>): string {
  switch (parts.kind) {
    case "suit":
      return `${copy.mahjong.suits[parts.suit as keyof typeof copy.mahjong.suits]} ${formatCount(parts.rank, locale)}`;
    case "wind":
      return copy.mahjong.winds[parts.name as keyof typeof copy.mahjong.winds];
    case "dragon":
      return copy.mahjong.dragons[parts.name as keyof typeof copy.mahjong.dragons];
    case "flower":
      return `${copy.mahjong.flower} ${formatCount(parts.rank, locale)}`;
    case "season":
      return `${copy.mahjong.season} ${formatCount(parts.rank, locale)}`;
    default:
      return copy.mahjong.unknown;
  }
}

/**
 * The tile drawn as its own face.
 *
 * A suit is its rank in marks — pips for circles, sticks for bamboo, and the
 * digit with a rule over it for characters, which is what those three suits look
 * like on a real tile. The winds are their letters, the dragons are three
 * different SHAPES rather than three colours (the design's own rule: colour never
 * carries a state alone), and the flowers and seasons are their two silhouettes
 * with the rank that tells the four copies apart.
 */
function TileGlyph({ parts, locale }: { parts: TileFaceParts; locale: ReturnType<typeof activeLocale> }) {
  if (parts.kind === "suit" && parts.suit === "characters") {
    return (
      <span className="pz-tile__face pz-tile__face--characters">
        <span className="pz-tile__rule" aria-hidden="true" />
        <span className="pz-tile__rank">{formatCount(parts.rank, locale)}</span>
      </span>
    );
  }
  if (parts.kind === "suit") {
    return (
      <span className={`pz-tile__face pz-tile__face--${parts.suit}`}>
        {Array.from({ length: parts.rank }, (_, mark) => (
          <span key={mark} className="pz-tile__pip" />
        ))}
      </span>
    );
  }
  if (parts.kind === "wind") {
    return (
      <span className="pz-tile__face pz-tile__face--wind">
        {(parts.name ?? "").charAt(0).toUpperCase()}
      </span>
    );
  }
  if (parts.kind === "dragon") {
    return (
      <span className="pz-tile__face pz-tile__face--dragon">
        <span className={`pz-tile__dragon pz-tile__dragon--${parts.name ?? "unknown"}`} />
      </span>
    );
  }
  if (parts.kind === "flower" || parts.kind === "season") {
    return (
      <span className={`pz-tile__face pz-tile__face--${parts.kind}`}>
        <span className={`pz-tile__bloom pz-tile__bloom--${parts.kind}`} aria-hidden="true" />
        <span className="pz-tile__rank">{formatCount(parts.rank, locale)}</span>
      </span>
    );
  }
  return <span className="pz-tile__face">?</span>;
}
