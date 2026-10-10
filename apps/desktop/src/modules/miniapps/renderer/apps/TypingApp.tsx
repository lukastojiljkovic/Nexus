import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Chip, Select, TextField } from "@nexus/ui";
import {
  TYPING_LAYOUTS,
  TYPING_LESSONS,
  scoreTypingSession,
  typingKeyPosition,
  type TypingKeystroke,
  type TypingLayoutId,
  type TypingScore,
} from "@nexus/core";
import { copy } from "../copy.js";
import { cryptoRandomBelow } from "../entropy.js";
import { formatCount, formatPercent, formatSeconds, formatSpeed } from "../format.js";
import { drillText, keystrokesFromChange } from "../typingDrill.js";
import type { MiniAppProps } from "./contract.js";

/**
 * The typing tutor (mini-apps): the engine's lessons for the Serbian Latin and
 * the English layout, words a minute and accuracy, the keyboard drawn with the
 * next key lit, and progress kept.
 *
 * **The drill is a lesson's own alphabet.** Each lesson introduces keys and
 * carries every key available by then (`cumulative`), and the drill is
 * pseudo-words drawn from that set - so a lesson cannot ask for a character it
 * has not taught, and the diacritics the Serbian layout puts on their own keys
 * are drilled as ordinary keystrokes. The text is generated with the module's
 * crypto-backed source (`typingDrill.ts`), which is what makes the drill
 * unguessable to the person practising it.
 *
 * **What is measured, and from what.** Every accepted change to the field
 * becomes a keystroke with the instant it landed (`keystrokesFromChange`), and
 * `@nexus/core`'s `scoreTypingSession` turns the target and those keystrokes
 * into gross and net words a minute, accuracy and the keys most often missed.
 * The page therefore computes NOTHING about speed itself: a backspace costs
 * nothing, a character past the end of the target is an error with no key to
 * blame, and the word convention (five characters) is the engine's.
 *
 * **Progress is a result list, not a score to beat.** Each finished run is kept
 * with its layout and lesson, and the panel below shows the best runs of the
 * lesson being practised - what a learner needs to see is whether they are
 * improving, which one number cannot say.
 */

/** How many results the store keeps. Its own bound (`MINIAPPS_MAX_TYPING_RECORDS`), mirrored because the renderer may not reach `@nexus/db`. */
const RECORDS_LIMIT = 60;

/** How many best runs the panel shows for the lesson being practised. */
const BEST_SHOWN = 5;

/** The lesson to open on: the stored one when this layout has it, else the layout's first. */
function resolveLesson(layout: TypingLayoutId, stored: string): string {
  const lessons = TYPING_LESSONS[layout];
  return lessons.some((lesson) => lesson.id === stored) ? stored : (lessons[0]?.id ?? stored);
}

/** A lesson's keys as the label the progress table shows: `f j`, which is what the lesson drills. */
function lessonKeys(layout: TypingLayoutId, lessonId: string): string {
  return TYPING_LESSONS[layout].find((lesson) => lesson.id === lessonId)?.keys.join(" ") ?? lessonId;
}

/** A draw's net speed and accuracy, rounded to what the store's own bounds and the panel's columns want. */
function rounded(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function TypingApp({ profileId, view, run }: MiniAppProps) {
  const [layout, setLayout] = useState<TypingLayoutId>(view.typing.layout);
  const [lessonId, setLessonId] = useState(() => resolveLesson(view.typing.layout, view.typing.lessonId));
  const [target, setTarget] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [keystrokes, setKeystrokes] = useState<readonly TypingKeystroke[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [score, setScore] = useState<TypingScore | null>(null);
  const [newBest, setNewBest] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const lessons = TYPING_LESSONS[layout];
  const lesson = useMemo(
    () => lessons.find((held) => held.id === lessonId) ?? lessons[0] ?? null,
    [lessons, lessonId],
  );
  const characters = target === null ? [] : [...target];
  const nextCharacter = target === null ? null : (characters[typed.length] ?? null);

  useEffect(() => {
    if (target !== null) field.current?.focus();
  }, [target]);

  function changeLayout(next: TypingLayoutId): void {
    setLayout(next);
    setLessonId(resolveLesson(next, lessonId));
    reset();
  }

  function reset(): void {
    setTarget(null);
    setTyped("");
    setKeystrokes([]);
    setStartedAt(null);
    setScore(null);
    setNewBest(false);
  }

  function start(): void {
    if (lesson === null) return;
    setTarget(drillText(lesson.cumulative, cryptoRandomBelow));
    setTyped("");
    setKeystrokes([]);
    setStartedAt(null);
    setScore(null);
    setNewBest(false);
  }

  /** One change to the field: the keystrokes follow it, and a completed target ends the run. */
  function type(value: string): void {
    if (target === null) return;
    const now = performance.now();
    const started = startedAt ?? now;
    if (startedAt === null) setStartedAt(started);
    const next = keystrokesFromChange(keystrokes, value, now - started);
    setTyped(value);
    setKeystrokes(next);
    if ([...value].length >= characters.length) finish(value, next, now - started);
  }

  /** The run's score, and the record it leaves behind. */
  function finish(value: string, strokes: readonly TypingKeystroke[], durationMs: number): void {
    if (target === null) return;
    let result: TypingScore;
    try {
      result = scoreTypingSession({ target, keystrokes: strokes, durationMs });
    } catch (error) {
      // The engine refuses a keystroke list that runs backwards, which cannot
      // come from a field. Nothing is kept and the run simply ends.
      console.error("Nexus: the typing run could not be scored:", error);
      reset();
      return;
    }
    setScore(result);
    setTarget(null);

    const record = {
      layout,
      lessonId,
      netWpm: rounded(result.netWpm, 1),
      accuracy: rounded(result.accuracy, 4),
      atMs: Date.now(),
    };
    const held = view.typing.records;
    const bestBefore = held
      .filter((entry) => entry.layout === layout && entry.lessonId === lessonId)
      .reduce((best, entry) => Math.max(best, entry.netWpm), 0);
    setNewBest(record.netWpm > bestBefore);

    const records = [...held, record].slice(-RECORDS_LIMIT);
    void run((api) => api.saveTyping({ profileId, progress: { layout, lessonId, records } }));
  }

  const best = useMemo(
    () =>
      view.typing.records
        .filter((entry) => entry.layout === layout && entry.lessonId === lessonId)
        .sort((left, right) => right.netWpm - left.netWpm)
        .slice(0, BEST_SHOWN),
    [view.typing.records, layout, lessonId],
  );

  const nextKey =
    nextCharacter === null ? null : nextCharacter === " " ? copy.typing.space : nextCharacter;
  const highlight = nextCharacter === null ? null : typingKeyPosition(layout, nextCharacter);

  return (
    <div className="miniapps__app">
      <Card className="miniapps__card" title={copy.apps.typing.name}>
        <div className="miniapps__row">
          <Select
            label={copy.typing.layout}
            value={layout}
            onChange={(event) => changeLayout(event.target.value as TypingLayoutId)}
          >
            {(Object.keys(TYPING_LAYOUTS) as TypingLayoutId[]).map((id) => (
              <option key={id} value={id}>
                {copy.typing.layoutNames[id]}
              </option>
            ))}
          </Select>
          <Select
            label={copy.typing.lesson}
            value={lessonId}
            onChange={(event) => {
              setLessonId(event.target.value);
              reset();
            }}
          >
            {lessons.map((held) => (
              <option key={held.id} value={held.id}>
                {held.keys.join(" ")}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="primary" onClick={start}>
            {target === null ? copy.typing.start : copy.typing.restart}
          </Button>
          <span className="nx-hint">{copy.typing.lessonHint}</span>
        </div>

        {target === null ? (
          <p className="nx-hint">{score === null ? copy.typing.idle : copy.typing.newBest}</p>
        ) : (
          <>
            <p className="miniapps__drill" aria-live="off">
              {characters.map((character, index) => (
                <span
                  key={index}
                  className={
                    index < typed.length
                      ? "miniapps__drill-char miniapps__drill-char--done"
                      : index === typed.length
                        ? "miniapps__drill-char miniapps__drill-char--next"
                        : "miniapps__drill-char"
                  }
                >
                  {character === " " ? "\u00a0" : character}
                </span>
              ))}
            </p>
            <TextField
              ref={field}
              label={copy.typing.target}
              className="miniapps__wide-field"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => type(event.target.value)}
            />
          </>
        )}

        {nextKey !== null && (
          <p className="miniapps__readout">{`${copy.typing.nextKey}: ${nextKey}`}</p>
        )}

        <div className="miniapps__keyboard" aria-hidden="true">
          {TYPING_LAYOUTS[layout].rows.map((row) => (
            <div
              key={row.row}
              className="miniapps__keyboard-row"
              style={{ paddingInlineStart: `calc(var(--miniapps-key) * ${row.column})` }}
            >
              {row.keys.map((key, index) => {
                const lit = highlight !== null && highlight.row === row.row && highlight.column === row.column + index;
                return (
                  <span key={key} className={`miniapps__key${lit ? " miniapps__key--next" : ""}`}>
                    {key}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </Card>

      <Card className="miniapps__card" title={copy.typing.progress}>
        {score !== null && (
          <div className="miniapps__row">
            <span className="miniapps__readout">{`${copy.typing.net}: ${formatSpeed(score.netWpm)}`}</span>
            <span className="miniapps__readout">{`${copy.typing.accuracy}: ${formatPercent(score.accuracy)}`}</span>
            <span className="miniapps__readout">{`${copy.typing.errors}: ${formatCount(score.errors)}`}</span>
            <span className="miniapps__readout">{`${copy.typing.duration}: ${formatSeconds(score.durationSeconds)}`}</span>
            {newBest && <Chip variant="data">{copy.typing.newBest}</Chip>}
          </div>
        )}
        {score !== null && score.practiseKeys.length > 0 && (
          <p className="miniapps__readout">{`${copy.typing.practise}: ${score.practiseKeys.join(" ")}`}</p>
        )}
        {best.length === 0 ? (
          <p className="nx-hint">{copy.typing.progressEmpty}</p>
        ) : (
          <table className="miniapps__table">
            <thead>
              <tr>
                <th scope="col">{copy.typing.best}</th>
                <th scope="col">{copy.typing.wpm}</th>
                <th scope="col">{copy.typing.accuracy}</th>
              </tr>
            </thead>
            <tbody>
              {best.map((entry, index) => (
                <tr key={`${entry.atMs}-${index}`}>
                  <th scope="row">{lessonKeys(entry.layout, entry.lessonId)}</th>
                  <td>{formatSpeed(entry.netWpm)}</td>
                  <td>{formatPercent(entry.accuracy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
