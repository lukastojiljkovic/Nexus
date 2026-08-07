import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button, Chip, ListRow, TextField } from "@nexus/ui";
import { MAX_FIT_EXERCISE_QUERY_LENGTH, MAX_FIT_EXERCISE_RESULTS } from "../../shared/ipc.js";
import type { FitExerciseOption } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/**
 * The exercise picker — one ranked list over BOTH sources, the app's catalogue
 * and this profile's own.
 *
 * It is one component and not two lists, for the same reason the channel behind
 * it is one channel: two lists merged on this side would be a second definition
 * of „best match", and the ranking (Serbian prefix before Serbian substring
 * before the English name) already lives in `@nexus/core` where both halves of
 * the app can agree on it.
 *
 * **A choice is a reference and nothing else.** What leaves here is the whole
 * `FitExerciseOption` so a caller can show the name it just picked, but what
 * ever crosses IPC afterwards is `option.ref` — main resolves it and stamps the
 * label, the metric and the muscles. See the `fit:set-log` channel note for what
 * that boundary is defending.
 *
 * Both callers use it: the session adds an exercise to what is happening now,
 * and the routine editor adds a line to a shape. Neither knows how the other
 * ranks anything.
 */

export interface FitExercisePickerProps {
  profileId: string;
  /** Above the search box. Names what the choice is FOR, which differs between the two callers. */
  title: string;
  onChoose: (option: FitExerciseOption) => void;
  onCancel: () => void;
}

export function FitExercisePicker({
  profileId,
  title,
  onChoose,
  onCancel,
}: FitExercisePickerProps) {
  const s = strings.fitness.training.picker;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FitExerciseOption[]>([]);
  // Kept apart from an empty `results`, which is a real answer („nothing
  // matched") rather than a failure to ask.
  const [failed, setFailed] = useState(false);
  /** Which row ↑/↓ have moved to. Reset on every new result set — see the effect below. */
  const [activeIndex, setActiveIndex] = useState(0);

  /**
   * The search, debounced. The ranking runs in main over a few hundred entries,
   * so a keystroke is cheap — but a round trip per keystroke would still race
   * itself, and `active` is what keeps an older answer from landing on a newer
   * query.
   */
  useEffect(() => {
    const needle = query.trim();
    if (needle.length === 0) {
      setResults([]);
      setFailed(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await window.nexus.fitSearchExercises(
            profileId,
            needle,
            MAX_FIT_EXERCISE_RESULTS,
          );
          if (active) {
            setResults(found);
            setFailed(false);
          }
        } catch (error) {
          if (active) {
            setResults([]);
            setFailed(true);
          }
          console.error("Nexus: the exercise search failed:", error);
        }
      })();
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [profileId, query]);

  // A new list is a new first row. Without this, typing a narrower query while
  // the highlight sat on row 7 would leave it pointing at whatever landed there.
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  /**
   * ↑/↓ move, Enter picks — the whole list reachable from the box the caret is
   * already in, which is what CANV's picker and the global palette have always
   * done. This one had a search box, a ranked list and no way to reach the list
   * except with the mouse: the same job, two answers, in one app.
   *
   * Enter is `preventDefault`ed even when nothing is highlighted, because this
   * picker is opened from INSIDE the routine form — an un-prevented Enter would
   * submit that form while the user was still choosing an exercise for it.
   */
  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (results.length === 0) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = results[activeIndex];
      if (option !== undefined) onChoose(option);
    }
  }

  const v = strings.fitness.training;

  return (
    <div className="fit__picker">
      <div className="fit__chosen-head">
        <span className="fit__form-title">{title}</span>
        {/* Present from the moment the picker opens: a panel that could only be
            closed by first choosing something traps you for changing your mind. */}
        <Button type="button" size="sm" className="fit__quiet" onClick={onCancel}>
          {s.cancel}
        </Button>
      </div>

      <TextField
        label={s.searchLabel}
        value={query}
        placeholder={s.searchPlaceholder}
        maxLength={MAX_FIT_EXERCISE_QUERY_LENGTH}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onInputKeyDown}
      />

      {query.trim() === "" ? (
        <p className="fit__note">{s.idle}</p>
      ) : failed ? (
        <p className="fit__error" role="alert">
          {s.searchError}
        </p>
      ) : results.length === 0 ? (
        <>
          <p className="fit__note">{s.noResults}</p>
          <p className="fit__note">{s.noResultsHint}</p>
        </>
      ) : (
        <div className="fit__results">
          {results.map((option) => (
            <ListRow
              key={option.ref}
              className={
                option.ref === (results[activeIndex]?.ref ?? "") ? "fit__result--active" : undefined
              }
              trailing={
                <Button size="sm" onClick={() => onChoose(option)}>
                  {s.choose}
                </Button>
              }
            >
              <span className="fit__result-body">
                <span className="fit__result-name">{option.name}</span>
                <span className="fit__chips">
                  <Chip>{v.equipment[option.equipment]}</Chip>
                  {/* What ONE SET of it records — the field that decides which
                      inputs the log form will show, said before it is chosen
                      rather than discovered afterwards. */}
                  <Chip variant="data">{v.metric[option.metric]}</Chip>
                  {option.primaryMuscles.map((muscle) => (
                    <Chip key={muscle}>{v.muscle[muscle]}</Chip>
                  ))}
                  {!option.catalogue && <Chip variant="accent">{s.mine}</Chip>}
                </span>
              </span>
            </ListRow>
          ))}
        </div>
      )}
    </div>
  );
}
