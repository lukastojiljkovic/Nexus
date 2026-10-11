import { useState } from "react";
import { Button, Card, ListRow, TextArea, TextField } from "@nexus/ui";
import {
  DiceNotationError,
  coinFlip,
  pickItems,
  randomInt,
  rollDiceNotation,
  shuffleItems,
  type DiceNotationCode,
  type DiceRoll,
} from "@nexus/core";
import { copy } from "../copy.js";
import { cryptoRandomBelow } from "../entropy.js";
import { formatCount, formatStamp } from "../format.js";
import type { MiniAppProps } from "./contract.js";

/**
 * Dice, a coin, picks from a list, a shuffle, a range and a history
 * (mini-apps).
 *
 * **Everything here goes through the engine.** The dice grammar and its bounds
 * are `@nexus/core`'s `parseDiceNotation` (a malformed notation raises
 * `DiceNotationError` with a code rather than being repaired), the picks and the
 * shuffle are its Fisher-Yates helpers, and the random source is this module's
 * `cryptoRandomBelow`. Nothing in this file draws a number of its own, which is
 * what keeps a roll reproducible from its stated inputs and its errors named.
 *
 * **Why the results are remembered at all.** A user rolling dice in a game
 * needs to see what the table just rolled; the history is what the module keeps,
 * and it lives in the profile archive with everything else. It is bounded on
 * both sides - fifty entries, and the store refuses more - so a long session
 * cannot grow a document without limit.
 *
 * **Why a failure to remember is not a failure of the roll.** The roll is
 * already on screen when `run` is called; a write that fails says so in the
 * page's own error line and the number the user just rolled stays where it is.
 * The alternative - refusing to roll because the store is unhappy - would make a
 * dice roller depend on a database.
 */

/** How many results are kept. The store's own bound (`MINIAPPS_MAX_HISTORY`), mirrored because no file under the renderer's folder may reach `@nexus/db`. */
const HISTORY_LIMIT = 50;

/** The codes `DiceNotationError` can carry, each turned into its own sentence at CALL time, never into a table built at import time. */
function notationErrorText(code: DiceNotationCode): string {
  switch (code) {
    case "empty":
      return copy.dice.emptyError;
    case "too-long":
      return copy.dice.tooLongError;
    case "no-dice":
      return copy.dice.noDiceError;
    case "dice-count":
      return copy.dice.diceCountError;
    case "faces":
      return copy.dice.facesError;
    case "keep-count":
      return copy.dice.keepCountError;
    case "syntax":
      return copy.dice.syntaxError;
  }
}

/** A field's text as a whole number, or `null` when it does not spell one. */
function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d{1,12}$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function DiceApp({ profileId, view, run }: MiniAppProps) {
  const [notation, setNotation] = useState("2d6");
  const [roll, setRoll] = useState<DiceRoll | null>(null);
  const [notationError, setNotationError] = useState<string | null>(null);
  const [coin, setCoin] = useState<"heads" | "tails" | null>(null);
  const [listText, setListText] = useState("");
  const [countText, setCountText] = useState("1");
  const [picked, setPicked] = useState<readonly string[] | null>(null);
  const [shuffled, setShuffled] = useState<readonly string[] | null>(null);
  const [minText, setMinText] = useState("1");
  const [maxText, setMaxText] = useState("100");
  const [drawn, setDrawn] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /** The list, one item per non-empty line - the shape the text area invites. */
  const items = listText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  /** Records one result, newest first, at the size the store keeps. */
  function remember(label: string, result: string): void {
    const entry = { atMs: Date.now(), label, result };
    void run((api) =>
      api.saveDiceHistory({
        profileId,
        history: [entry, ...view.diceHistory].slice(0, HISTORY_LIMIT),
      }),
    );
  }

  function doRoll(): void {
    try {
      const rolled = rollDiceNotation(notation, cryptoRandomBelow);
      setRoll(rolled);
      setNotationError(null);
      remember(notation.trim(), formatCount(rolled.total));
    } catch (error) {
      setRoll(null);
      setNotationError(
        error instanceof DiceNotationError
          ? notationErrorText(error.code)
          : copy.dice.syntaxError,
      );
    }
  }

  function doFlip(): void {
    const side = coinFlip(cryptoRandomBelow);
    setCoin(side);
    remember(copy.dice.coinTitle, side === "heads" ? copy.dice.heads : copy.dice.tails);
  }

  function doPick(): void {
    const count = wholeNumber(countText);
    if (items.length === 0) {
      setProblem(copy.dice.listEmpty);
      return;
    }
    if (count === null || count < 1) {
      setProblem(copy.dice.countInvalid);
      return;
    }
    if (count > items.length) {
      setProblem(copy.dice.countTooBig);
      return;
    }
    setProblem(null);
    const chosen = pickItems(items, count, cryptoRandomBelow);
    setPicked(chosen);
    remember(`${copy.dice.pickTitle} (${formatCount(count)})`, chosen.join(", "));
  }

  function doShuffle(): void {
    if (items.length === 0) {
      setProblem(copy.dice.listEmpty);
      return;
    }
    setProblem(null);
    const order = shuffleItems(items, cryptoRandomBelow);
    setShuffled(order);
    remember(copy.dice.shuffle, order.join(", "));
  }

  function doDraw(): void {
    const min = wholeNumber(minText);
    const max = wholeNumber(maxText);
    if (min === null || max === null) {
      setProblem(copy.dice.rangeInvalid);
      return;
    }
    if (min > max) {
      setProblem(copy.dice.rangeInvalid);
      return;
    }
    setProblem(null);
    const value = randomInt(min, max, cryptoRandomBelow);
    setDrawn(value);
    remember(`${formatCount(min)}-${formatCount(max)}`, formatCount(value));
  }

  return (
    <div className="miniapps__app">
      <Card className="miniapps__card" title={copy.dice.notation}>
        <p className="nx-hint">{copy.dice.notationHint}</p>
        <div className="miniapps__row">
          <TextField
            label={copy.dice.notation}
            className="miniapps__wide-field"
            value={notation}
            onChange={(event) => setNotation(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") doRoll();
            }}
          />
          <Button size="sm" variant="primary" onClick={doRoll}>
            {copy.dice.roll}
          </Button>
        </div>
        {notationError !== null && <p className="miniapps__field-error">{notationError}</p>}
        {roll !== null && (
          <div className="miniapps__result">
            <div className="miniapps__dice">
              {roll.dice.map((die, index) => (
                <span
                  key={index}
                  className={`miniapps__die${die.kept ? "" : " miniapps__die--dropped"}`}
                  {...(die.kept ? {} : { title: copy.dice.dropped })}
                >
                  {formatCount(die.value)}
                </span>
              ))}
            </div>
            <span className="miniapps__readout">
              {`${copy.dice.total}: ${formatCount(roll.total)}`}
            </span>
          </div>
        )}
      </Card>

      <Card className="miniapps__card" title={copy.dice.coinTitle}>
        <div className="miniapps__row">
          <Button size="sm" onClick={doFlip}>
            {copy.dice.flip}
          </Button>
          <span className="miniapps__readout">
            {coin === null ? copy.dice.result : coin === "heads" ? copy.dice.heads : copy.dice.tails}
          </span>
        </div>
      </Card>

      <Card className="miniapps__card" title={copy.dice.pickTitle}>
        <p className="nx-hint">{copy.dice.listHint}</p>
        <TextArea
          label={copy.dice.list}
          value={listText}
          rows={4}
          onChange={(event) => setListText(event.target.value)}
        />
        <div className="miniapps__row">
          <TextField
            label={copy.dice.count}
            className="miniapps__number-field"
            inputMode="numeric"
            value={countText}
            onChange={(event) => setCountText(event.target.value)}
          />
          <Button size="sm" onClick={doPick}>
            {copy.dice.pick}
          </Button>
          <Button size="sm" onClick={doShuffle}>
            {copy.dice.shuffle}
          </Button>
        </div>
        {problem !== null && <p className="miniapps__field-error">{problem}</p>}
        {picked !== null && (
          <p className="miniapps__readout">{`${copy.dice.result}: ${picked.join(", ")}`}</p>
        )}
        {shuffled !== null && <p className="miniapps__readout">{shuffled.join(", ")}</p>}
      </Card>

      <Card className="miniapps__card" title={copy.dice.numberTitle}>
        <div className="miniapps__row">
          <TextField
            label={copy.dice.min}
            className="miniapps__number-field"
            inputMode="numeric"
            value={minText}
            onChange={(event) => setMinText(event.target.value)}
          />
          <TextField
            label={copy.dice.max}
            className="miniapps__number-field"
            inputMode="numeric"
            value={maxText}
            onChange={(event) => setMaxText(event.target.value)}
          />
          <Button size="sm" onClick={doDraw}>
            {copy.dice.draw}
          </Button>
          {drawn !== null && <span className="miniapps__readout">{formatCount(drawn)}</span>}
        </div>
      </Card>

      <Card className="miniapps__card" title={copy.dice.history}>
        <p className="nx-hint">{copy.dice.historyHint}</p>
        {view.diceHistory.length === 0 ? (
          <p className="nx-hint">{copy.dice.historyEmpty}</p>
        ) : (
          <>
            <div className="miniapps__list">
              {view.diceHistory.map((entry, index) => (
                <ListRow
                  key={`${entry.atMs}-${index}`}
                  leading={<span className="miniapps__stamp">{formatStamp(entry.atMs)}</span>}
                  trailing={<span className="miniapps__history-result">{entry.result}</span>}
                >
                  <span>{entry.label}</span>
                </ListRow>
              ))}
            </div>
            <div className="miniapps__row">
              <Button
                size="sm"
                variant="quiet"
                onClick={() => void run((api) => api.saveDiceHistory({ profileId, history: [] }))}
              >
                {copy.actions.clear}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
