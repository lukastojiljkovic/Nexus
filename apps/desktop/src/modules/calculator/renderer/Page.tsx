import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Chip,
  Disclosure,
  EmptyState,
  ListRow,
  LoadingState,
  PageHeader,
  TextField,
} from "@nexus/ui";
import { CALCULATOR_ANGLE_MODES, CALCULATOR_PRECISIONS } from "@nexus/core";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import {
  ConfirmDialog,
  activeLocale,
  dateTimeFormat,
  declaredText,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import type { CalcHistoryEntryView, CalculatorView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import {
  KEYPAD_ROWS,
  caretColumn,
  decimalSeparatorOf,
  expandHistoryRefs,
  matchesQuery,
  recallIndex,
  sortNames,
  toEngineExpression,
  type CalculatorAnswer,
} from "./expression.js";
import { createEngineClient, type EngineClient } from "./engineClient.js";
import { spawnCalculatorWorker } from "./workerPort.js";
import { ANGLE_CONTROL, NUMBER_CONTROL, optionLabel } from "./modes.js";
import "./calculator.css";

/**
 * KALKULATOR (ADR-090) - the module's page.
 *
 * **Four sections and no fifth.** The line with its live result, the scientific
 * keypad behind a disclosure, the history, and the variables the session holds.
 * The split is the module's own shape rather than a layout decision: a line is
 * what you are typing now, a keypad is how a mouse types the same thing, the
 * history is what you already computed, and a variable is what you will compute
 * with next.
 *
 * **Where the arithmetic happens.** The line goes to a Web Worker
 * (`engineClient.ts`), which is the only place in this application an expression
 * is evaluated: the engine is synchronous, so the process that can still stop it
 * is the one that is not blocked by it. The deadline is four seconds, and a
 * calculation that passes it is TERMINATED and explained rather than waited on.
 *
 * **Why the line is evaluated once more after a commit, and why that is not a
 * bug.** The worker answers with the session AFTER the expression - new
 * variables, a new `ans` - and main stores exactly that session. The page's
 * effect re-runs against the stored one, so what the result line shows and what
 * the store holds are the same evaluation rather than two that happen to agree.
 *
 * **Nothing here guesses a state.** Every mutation answers with the whole view and
 * the page renders what main said (`timers/renderer/Page.tsx`'s rule); the only
 * local state is what is being TYPED, which is not something main knows.
 */

/**
 * How long a keystroke waits before the worker is asked again.
 *
 * A person types a twelve-character expression in about a second, and each
 * character posted on its own would be twelve worker round trips whose eleven
 * answers are already stale. A hundred and twenty milliseconds is under the
 * threshold at which a live result stops feeling live, which is the whole
 * trade-off this number decides.
 */
const PREVIEW_DELAY_MS = 120;

/** What the result line is currently showing. */
type Preview =
  | { readonly kind: "idle" }
  | { readonly kind: "working" }
  | { readonly kind: "result"; readonly outcome: CalculatorAnswer; readonly line: string }
  | { readonly kind: "missing"; readonly ref: number };

const IDLE: Preview = { kind: "idle" };

/** Which confirmation dialog is open, if any. */
type Confirming = "history" | "session";

type CalculatorApi = typeof window.nexus.modules.calculator;

export default function CalculatorPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<CalculatorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [preview, setPreview] = useState<Preview>(IDLE);
  /** Which history row the arrow keys are standing on; `-1` means „not recalling". */
  const [recall, setRecall] = useState(-1);
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const client = useMemo<EngineClient>(
    () => createEngineClient({ spawn: spawnCalculatorWorker }),
    [],
  );

  useEffect(() => () => client.dispose(), [client]);

  const locale = activeLocale();

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.calculator.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      // No toast, no dialog: a page that cannot read says so in its own body and
      // keeps saying so until a read works, which is the least surprising thing
      // it can do.
      console.error("Nexus: the calculator could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * One evaluation, and the result line's only writer.
   *
   * The line as typed is not what the engine reads: a Serbian decimal comma is
   * rewritten (`toEngineExpression`) and a `#3` becomes the result it names
   * (`expandHistoryRefs`). The expression STORED on a commit is the line as it was
   * typed, which is what the history column documents.
   */
  const evaluate = useCallback(
    async (text: string): Promise<CalculatorAnswer | null> => {
      if (view === null) return null;
      const expanded = expandHistoryRefs(text, view.history.map((entry) => entry.value));
      if (!expanded.ok) {
        setPreview({ kind: "missing", ref: expanded.ref });
        return null;
      }
      setPreview({ kind: "working" });
      const outcome = await client.evaluate({
        expression: toEngineExpression(expanded.expression, locale),
        precision: view.settings.precision,
        angleMode: view.settings.angleMode,
        locale,
        session: view.session,
      });
      setPreview({ kind: "result", outcome, line: text });
      return outcome;
    },
    [client, locale, view],
  );

  useEffect(() => {
    if (view === null) return;
    if (line.trim().length === 0) {
      setPreview(IDLE);
      return;
    }
    const handle = setTimeout(() => void evaluate(line), PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [evaluate, line, view]);

  /** One mutation, into state. Every write answers with the same shape, so there is exactly one way this page learns anything. */
  const mutate = useCallback(async (action: (api: CalculatorApi) => Promise<CalculatorView>) => {
    try {
      setView(await action(window.nexus.modules.calculator));
      setError(null);
    } catch (failure) {
      setError(copy.errors.mutate);
      console.error("Nexus: a calculator change failed:", failure);
    }
  }, []);

  /**
   * Enter, and the same act as the `=` key: the evaluation the line is already
   * showing is written to the history together with the session it produced.
   *
   * Only a SUCCESSFUL preview commits. A refused expression has nothing to store,
   * and pressing Enter on one would be a log line recording a mistake.
   */
  const commit = useCallback(async () => {
    if (view === null) return;
    const expression = line.trim();
    if (expression.length === 0) return;
    // The line may have changed since the result on screen was computed - the
    // preview waits 120 ms after a keystroke, and Enter lands sooner than that for
    // anybody typing faster than eight characters a second. So a commit whose
    // preview is not THIS line's evaluates it first, rather than silently doing
    // nothing (or, worse, storing the previous line's result).
    const shown = preview.kind === "result" && preview.line === line ? preview.outcome : null;
    const outcome = shown ?? (await evaluate(line));
    if (outcome === null || !outcome.ok) return;
    try {
      const next = await window.nexus.modules.calculator.commit({
        profileId,
        expression,
        value: outcome.value,
        result: outcome.display,
        session: outcome.session,
      });
      setView(next);
      setError(null);
      setRecall(-1);
    } catch (failure) {
      setError(copy.errors.mutate);
      console.error("Nexus: the calculator could not commit an expression:", failure);
    }
  }, [evaluate, line, preview, profileId, view]);

  /** Puts one character (or one call) into the line at the caret, and leaves the caret after it. */
  const insert = useCallback(
    (text: string) => {
      const input = inputRef.current;
      const start = input?.selectionStart ?? line.length;
      const end = input?.selectionEnd ?? start;
      const next = `${line.slice(0, start)}${text}${line.slice(end)}`;
      setLine(next);
      setRecall(-1);
      // The caret has to be placed after REACT has written the new value into the
      // DOM, which is the frame after this handler; the field keeps its focus, so
      // a mouse user's next keystroke still lands in the line.
      requestAnimationFrame(() => {
        input?.focus();
        const caret = start + text.length;
        input?.setSelectionRange(caret, caret);
      });
    },
    [line],
  );

  const clearLine = useCallback(() => {
    setLine("");
    setRecall(-1);
    setPreview(IDLE);
    inputRef.current?.focus();
  }, []);

  /** Up and down walk the history as it is drawn; `-1` is the line the user was typing. */
  const recallRow = useCallback(
    (direction: "up" | "down") => {
      const history = view?.history ?? [];
      const next = recallIndex(recall, direction, history.length);
      setRecall(next);
      setLine(next === -1 ? "" : (history[next]?.expression ?? ""));
    },
    [recall, view],
  );

  /** The history as this page draws it: newest first, narrowed by the query. */
  const rows = useMemo(
    () => (view?.history ?? []).filter((entry) => matchesQuery(entry.expression, entry.result, query)),
    [query, view],
  );

  /** The session's names, in the order a Serbian reader alphabetises them. */
  const names = useMemo(() => sortNames(Object.keys(view?.session.variables ?? {})), [view]);
  const functions = useMemo(() => sortNames(Object.keys(view?.session.functions ?? {})), [view]);

  const canCommit = preview.kind === "result" && preview.outcome.ok && line.trim().length > 0;

  return (
    <div className="calculator">
      {/* The page's own name is the word the module DECLARED, read in the language
          being spoken, rather than a second copy of it: the rail, the settings
          gallery and this header then cannot disagree about what the module is
          called (ADR-090's copy split). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="calculator"
      />
      {error !== null && (
        <p className="calculator__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : (
        <>
          {!view.sessionReadable && (
            <p className="calculator__error" role="alert">
              {copy.errors.sessionUnreadable}{" "}
              <Button size="sm" onClick={() => setConfirming("session")}>
                {copy.variables.forget}
              </Button>
            </p>
          )}
          <Card className="calculator__card" title={copy.expression.label}>
            <div className="calculator__modes">
              <div
                className="calculator__mode"
                role="group"
                aria-label={declaredText(ANGLE_CONTROL?.labelKey)}
              >
                {CALCULATOR_ANGLE_MODES.map((mode) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={view.settings.angleMode === mode ? "primary" : "ghost"}
                    aria-pressed={view.settings.angleMode === mode}
                    onClick={() =>
                      void mutate((api) =>
                        api.setAngleMode({ profileId, angleMode: mode }),
                      )
                    }
                  >
                    {optionLabel(ANGLE_CONTROL, mode)}
                  </Button>
                ))}
              </div>
              <div
                className="calculator__mode"
                role="group"
                aria-label={declaredText(NUMBER_CONTROL?.labelKey)}
              >
                {CALCULATOR_PRECISIONS.map((precision) => (
                  <Button
                    key={precision}
                    size="sm"
                    variant={view.settings.precision === precision ? "primary" : "ghost"}
                    aria-pressed={view.settings.precision === precision}
                    onClick={() =>
                      void mutate((api) => api.setPrecision({ profileId, precision }))
                    }
                  >
                    {optionLabel(NUMBER_CONTROL, precision)}
                  </Button>
                ))}
              </div>
            </div>
            <TextField
              ref={inputRef}
              label={copy.expression.label}
              className="calculator__line"
              placeholder={copy.expression.placeholder}
              value={line}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                setLine(event.target.value);
                setRecall(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commit();
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  recallRow("up");
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  recallRow("down");
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  clearLine();
                }
              }}
            />
            {/* One live region, written by the effect above: a result appears as it
                is computed, and a refusal replaces it rather than arriving somewhere
                the reader has to hunt for. */}
            <div className="calculator__answer" aria-live="polite">
              <Answer preview={preview} line={line} />
            </div>
            <div className="calculator__actions">
              <Button variant="primary" size="sm" disabled={!canCommit} onClick={() => void commit()}>
                {copy.expression.commit}
              </Button>
              <Button
                variant="quiet"
                size="sm"
                disabled={line.length === 0}
                onClick={clearLine}
              >
                {copy.expression.clear}
              </Button>
            </div>
            <p className="nx-hint">{copy.expression.keysHint}</p>
            <p className="nx-hint">{copy.expression.referenceHint}</p>
          </Card>

          <Card className="calculator__card">
            <Disclosure
              label={copy.keypad.title}
              open={keypadOpen}
              onToggle={setKeypadOpen}
            />
            {keypadOpen && (
              <div className="calculator__keypad" role="group" aria-label={copy.keypad.title}>
                {KEYPAD_ROWS.map((row, index) => (
                  <div className="calculator__keypad-row" key={index}>
                    {row.map((key) => {
                      const spoken = key.name === undefined ? undefined : copy.keys[key.name];
                      return (
                        <Button
                          key={key.id}
                          size="sm"
                          className="calculator__key"
                          {...(spoken === undefined ? {} : { "aria-label": spoken })}
                          onClick={() => {
                            if (key.id === "clear") {
                              clearLine();
                              return;
                            }
                            if (key.id === "commit") {
                              void commit();
                              return;
                            }
                            insert(
                              key.id === "decimal" ? decimalSeparatorOf(locale) : key.insert,
                            );
                          }}
                        >
                          {key.id === "decimal" ? decimalSeparatorOf(locale) : key.label}
                        </Button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="calculator__card" title={copy.history.title}>
            <TextField
              aria-label={copy.history.search}
              className="calculator__search"
              placeholder={copy.history.search}
              value={query}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
            {rows.length === 0 ? (
              query.trim().length > 0 ? (
                <p className="nx-hint">{copy.history.noMatch}</p>
              ) : (
                <EmptyState
                  variant="inline"
                  title={copy.history.emptyTitle}
                  description={copy.history.emptyBody}
                />
              )
            ) : (
              <div className="calculator__list">
                {rows.map((entry) => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    onReuse={() => {
                      setLine(entry.expression);
                      setRecall(-1);
                      inputRef.current?.focus();
                    }}
                    onPin={() =>
                      void mutate((api) =>
                        api.setPinned({ profileId, id: entry.id, pinned: !entry.pinned }),
                      )
                    }
                    onRemove={() =>
                      void mutate((api) => api.removeEntry({ profileId, id: entry.id }))
                    }
                  />
                ))}
              </div>
            )}
            <div className="calculator__actions">
              <Button
                size="sm"
                disabled={view.history.length === 0}
                onClick={() => setConfirming("history")}
              >
                {copy.history.clear}
              </Button>
            </div>
          </Card>

          <Card className="calculator__card">
            <Disclosure
              label={copy.variables.title}
              summary={String(names.length + functions.length)}
              open={variablesOpen}
              onToggle={setVariablesOpen}
            />
            {variablesOpen && (
              <>
                {names.length === 0 && functions.length === 0 ? (
                  <p className="nx-hint">{copy.variables.empty}</p>
                ) : (
                  <>
                    {names.length > 0 && (
                      <>
                        <div className="nx-eyebrow">{copy.variables.namesLabel}</div>
                        <div className="calculator__list">
                          {names.map((name) => (
                            <ListRow key={name}>
                              <span className="calculator__row-expression">{name}</span>
                              <span className="calculator__row-result">
                                {view.session.variables[name]}
                              </span>
                            </ListRow>
                          ))}
                        </div>
                      </>
                    )}
                    {functions.length > 0 && (
                      <>
                        <div className="nx-eyebrow">{copy.variables.functionsLabel}</div>
                        <div className="calculator__list">
                          {functions.map((name) => (
                            <ListRow key={name}>
                              <span className="calculator__row-expression">{name}</span>
                              <span className="calculator__row-result">
                                {`(${view.session.functions[name]?.params.join(", ") ?? ""}) = ${
                                  view.session.functions[name]?.body ?? ""
                                }`}
                              </span>
                            </ListRow>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
                <div className="calculator__actions">
                  <Button
                    size="sm"
                    disabled={names.length === 0 && functions.length === 0}
                    onClick={() => setConfirming("session")}
                  >
                    {copy.variables.forget}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </>
      )}
      {confirming === "history" && (
        <ConfirmDialog
          title={copy.history.clearTitle}
          question={copy.history.clearQuestion}
          note={copy.history.clearNote}
          confirmLabel={copy.history.clear}
          cancelLabel={copy.confirm.cancel}
          onConfirm={() => {
            setConfirming(null);
            // Pinned rows stay, and the dialog says so: the flag exists to protect
            // a row from the cap, and a button that quietly deleted what the user
            // pinned would be the opposite of what the flag is for. A pinned row
            // is removed by its own „Obriši".
            void mutate((api) => api.clearHistory({ profileId, keepPinned: true }));
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === "session" && (
        <ConfirmDialog
          title={copy.variables.forgetTitle}
          question={copy.variables.forgetQuestion}
          confirmLabel={copy.variables.forget}
          cancelLabel={copy.confirm.cancel}
          onConfirm={() => {
            setConfirming(null);
            void mutate((api) => api.clearSession({ profileId }));
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

/**
 * The result line: the value, the progress, or the refusal.
 *
 * A syntax error points at a character, and the caret block under the sentence is
 * the same fact drawn twice on purpose - the sentence is what a reader hears, the
 * caret is what a reader sees, and DESIGN's redundancy rule is exactly this.
 */
function Answer({ preview, line }: { preview: Preview; line: string }) {
  if (preview.kind === "idle") return <p className="nx-hint">{copy.expression.waiting}</p>;
  if (preview.kind === "working") return <p className="nx-hint">{copy.expression.working}</p>;
  if (preview.kind === "missing") {
    return (
      <p className="calculator__failure">
        {copy.errors.noEntry} <span className="calculator__ref">#{preview.ref}</span>
      </p>
    );
  }
  const outcome = preview.outcome;
  if (outcome.ok) {
    return (
      <>
        <p className="calculator__value">{outcome.display}</p>
        {outcome.programmer !== null && (
          <div className="calculator__bases">
            <Chip>hex {outcome.programmer.hex}</Chip>
            <Chip>oct {outcome.programmer.octal}</Chip>
            <Chip>bin {outcome.programmer.binary}</Chip>
          </div>
        )}
      </>
    );
  }
  const column = caretColumn(outcome.position, line.length);
  return (
    <div className="calculator__failure">
      {/* No `role="alert"` here: the whole answer block is already one polite live
          region, and a nested alert would announce the same sentence twice. */}
      <p className="calculator__error">{copy.errors[outcome.code]}</p>
      {column !== null && (
        <>
          <p className="nx-hint">{`${copy.expression.caret} ${String(column + 1)}`}</p>
          <pre className="calculator__caret" aria-hidden="true">
            {`${line}\n${" ".repeat(column)}^`}
          </pre>
        </>
      )}
    </div>
  );
}

/** One history row: what was typed, what it answered, when, and the three things a user does with it. */
function HistoryRow({
  entry,
  onReuse,
  onPin,
  onRemove,
}: {
  entry: CalcHistoryEntryView;
  onReuse: () => void;
  onPin: () => void;
  onRemove: () => void;
}) {
  const when = new Date(entry.createdAt);
  return (
    <ListRow
      trailing={
        <span className="calculator__row-actions">
          <Button size="sm" onClick={onReuse}>
            {copy.history.reuse}
          </Button>
          <Button size="sm" aria-pressed={entry.pinned} onClick={onPin}>
            {entry.pinned ? copy.history.unpin : copy.history.pin}
          </Button>
          <Button size="sm" variant="quiet" onClick={onRemove}>
            {copy.history.remove}
          </Button>
        </span>
      }
    >
      <span className="calculator__row-expression">{entry.expression}</span>
      <span className="calculator__row-result">{entry.result}</span>
      <span className="calculator__row-when">
        {Number.isNaN(when.getTime())
          ? entry.createdAt
          : dateTimeFormat({ dateStyle: "short", timeStyle: "short" }).format(when)}
      </span>
    </ListRow>
  );
}

