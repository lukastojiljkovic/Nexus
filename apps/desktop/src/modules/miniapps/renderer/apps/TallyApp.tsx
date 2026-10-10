import { useState } from "react";
import { Button, Card, Checkbox, ListRow, TextField } from "@nexus/ui";
import {
  TALLY_MAX_COUNTERS,
  TALLY_MAX_NAME_LENGTH,
  TallyError,
  emptyTallyState,
  tallyCanRedo,
  tallyCanUndo,
  tallyReduce,
  tallyTotal,
  type TallyAction,
  type TallyErrorCode,
  type TallyState,
} from "@nexus/core";
import { copy } from "../copy.js";
import { randomId } from "../entropy.js";
import { formatCount } from "../format.js";
import type { MiniAppProps } from "./contract.js";

/**
 * The tally counter (mini-apps): several named counters, each with a step and an
 * optional floor at zero, kept.
 *
 * **The reducer owns the arithmetic, and the page owns the session.** Every
 * press, rename and step change goes through `@nexus/core`'s `tallyReduce`, so
 * undo is the engine's own stack of whole counter lists rather than an inverse
 * written here. What the page does with each answer is two things: render it,
 * and write the resulting COUNTERS to the store. The stacks are deliberately not
 * written - they are this session's history, and a restore that carried them
 * would restore the ability to undo something that happened in another life
 * (`MiniappsStore`'s own comment).
 *
 * **A press that changes nothing is not a write.** The reducer answers with the
 * SAME state when a bump cannot move (the minus button on a counter already at
 * its floor), so comparing identity is exactly the engine's own rule and main is
 * not asked to store a document that did not change.
 *
 * **Why the errors are a switch and not a table.** A table of `copy` strings
 * built at module scope would freeze one language the day its chunk loaded -
 * the defect `check:string-capture` exists to name - so each code is turned into
 * its sentence at the moment it happens.
 */
function tallyErrorText(code: TallyErrorCode): string {
  switch (code) {
    case "name":
      return copy.tally.nameError;
    case "step":
      return copy.tally.stepError;
    case "counter-limit":
      return copy.tally.limitError;
    case "id":
    case "value":
    case "duplicate-id":
    case "unknown-counter":
      // None of these can be reached from this page: the ids are minted here,
      // the values come from the reducer, and a row can only be acted on while
      // it is on screen. One sentence covers them rather than four that say
      // nothing a user could act on.
      return copy.errors.mutate;
  }
}

export function TallyApp({ profileId, view, run }: MiniAppProps) {
  const [state, setState] = useState<TallyState>(() => ({
    ...emptyTallyState(),
    counters: [...view.counters],
  }));
  const [name, setName] = useState("");
  const [stepText, setStepText] = useState("1");
  const [floorZero, setFloorZero] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  /** One action: the engine decides, the page renders, and a real change is kept. */
  function act(action: TallyAction): void {
    const next = tallyReduce(state, action);
    if (next === state) return;
    setState(next);
    setProblem(null);
    void run((api) => api.saveCounters({ profileId, counters: next.counters }));
  }

  /** The same, with the engine's refusal turned into a sentence under the form. */
  function attempt(action: TallyAction): void {
    try {
      act(action);
    } catch (error) {
      setProblem(error instanceof TallyError ? tallyErrorText(error.code) : copy.errors.mutate);
    }
  }

  function addCounter(): void {
    const step = Number(stepText.trim() === "" ? "1" : stepText.trim());
    attempt({
      type: "add-counter",
      id: randomId(),
      name,
      step: Number.isInteger(step) ? step : 0,
      floorZero,
    });
    setName("");
    setStepText("1");
    setFloorZero(false);
  }

  const total = tallyTotal(state);

  return (
    <div className="miniapps__app">
      <Card className="miniapps__card" title={copy.tally.add}>
        <div className="miniapps__row">
          <TextField
            label={copy.tally.name}
            className="miniapps__wide-field"
            maxLength={TALLY_MAX_NAME_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label={copy.tally.step}
            className="miniapps__number-field"
            inputMode="numeric"
            value={stepText}
            onChange={(event) => setStepText(event.target.value)}
          />
          <Button size="sm" variant="primary" onClick={addCounter}>
            {copy.tally.add}
          </Button>
        </div>
        <Checkbox checked={floorZero} onChange={(event) => setFloorZero(event.target.checked)}>
          {copy.tally.floor}
        </Checkbox>
        {problem !== null && <p className="miniapps__field-error">{problem}</p>}
      </Card>

      <Card className="miniapps__card" title={copy.apps.tally.name}>
        {state.counters.length === 0 ? (
          <p className="nx-hint">{`${copy.tally.empty} ${copy.tally.emptyBody}`}</p>
        ) : (
          <>
            <div className="miniapps__list">
              {state.counters.map((counter) =>
                renaming === counter.id ? (
                  <div key={counter.id} className="miniapps__edit-row">
                    <TextField
                      label={copy.actions.rename}
                      maxLength={TALLY_MAX_NAME_LENGTH}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <div className="miniapps__row">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          const trimmed = draft.trim();
                          setRenaming(null);
                          if (trimmed.length > 0) {
                            attempt({ type: "rename-counter", id: counter.id, name: trimmed });
                          }
                        }}
                      >
                        {copy.actions.save}
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => setRenaming(null)}>
                        {copy.actions.cancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ListRow
                    key={counter.id}
                    leading={<span className="miniapps__counter-value">{formatCount(counter.value)}</span>}
                    trailing={
                      <span className="miniapps__row-actions">
                        <Button
                          size="sm"
                          aria-label={`${copy.tally.minus}: ${counter.name}`}
                          onClick={() => act({ type: "bump", id: counter.id, direction: -1 })}
                        >
                          {copy.tally.minus}
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          aria-label={`${copy.tally.plus}: ${counter.name}`}
                          onClick={() => act({ type: "bump", id: counter.id, direction: 1 })}
                        >
                          {copy.tally.plus}
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          aria-label={`${copy.actions.rename}: ${counter.name}`}
                          onClick={() => {
                            setRenaming(counter.id);
                            setDraft(counter.name);
                          }}
                        >
                          {copy.actions.rename}
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          aria-label={`${copy.actions.remove}: ${counter.name}`}
                          onClick={() => act({ type: "remove-counter", id: counter.id })}
                        >
                          {copy.actions.remove}
                        </Button>
                      </span>
                    }
                  >
                    <span className="miniapps__row-name">{counter.name}</span>
                    <span className="miniapps__step-note">
                      {`${copy.tally.step}: ${formatCount(counter.step)}`}
                    </span>
                  </ListRow>
                ),
              )}
            </div>
            <div className="miniapps__row">
              <span className="miniapps__readout">
                {`${copy.tally.total}: ${formatCount(total)}`}
              </span>
              <Button size="sm" disabled={!tallyCanUndo(state)} onClick={() => act({ type: "undo" })}>
                {copy.actions.undo}
              </Button>
              <Button size="sm" disabled={!tallyCanRedo(state)} onClick={() => act({ type: "redo" })}>
                {copy.actions.redo}
              </Button>
              <span className="nx-hint">{`${formatCount(state.counters.length)} / ${formatCount(TALLY_MAX_COUNTERS)}`}</span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
