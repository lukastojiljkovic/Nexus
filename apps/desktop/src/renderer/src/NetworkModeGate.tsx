import { useId, useState, type FormEvent } from "react";

import { Button, Card, StarField } from "@nexus/ui";

import type { NetworkMode, NetworkModeView } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/**
 * ADR-089's first-run question, shown BEFORE the unlock screen and only while
 * no valid choice is recorded on this device.
 *
 * „Before anything else" is literal: `App` renders this instead of `AuthGate`
 * while `networkMode.choiceRequired` is true, so no account exists yet and the
 * boundary this process started under is the strong one until the user
 * confirms otherwise.
 *
 * The choice is recorded on CONFIRM and nowhere else. Selecting a radio and
 * closing the window writes nothing, which is why `offline` starts selected and
 * why there is no `onChange` handler that saves.
 *
 * The copy never says „welcome" or „first run": the same screen is shown to a
 * new install and to a device upgrading from 1.4.0, and an upgrading user must
 * not be told their data is new.
 */
export function NetworkModeGate({
  onChosen,
}: {
  onChosen: (view: NetworkModeView) => void;
}) {
  const s = strings.network;
  // „Offline only", preselected — the strong boundary is the default.
  const [selected, setSelected] = useState<NetworkMode>("offline");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const baseId = useId();

  const options: readonly {
    readonly id: NetworkMode;
    readonly title: string;
    readonly body: string;
  }[] = [
    { id: "offline", title: s.offlineTitle, body: s.offlineBody },
    { id: "updates", title: s.updatesTitle, body: s.updatesBody },
  ];

  async function confirm(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      onChosen(await window.nexus.setNetworkMode(selected));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    // The unlock screen's frame (`AuthGate`): the same sky, card and brand
    // glyph. This screen now comes right before that one on every first 1.5.0
    // start, and the two questions should read as one sequence rather than as
    // two different products.
    <div className="auth auth--sky">
      <StarField />
      <Card className="auth__card">
        <div className="auth__shell">
          <span className="auth__brand" aria-hidden="true">
            ✦
          </span>
          <form className="auth__form" onSubmit={(event) => void confirm(event)}>
            <h1 className="auth__title">{s.chooseTitle}</h1>
            <p className="nx-hint nx-hint--prose">{s.chooseIntro}</p>
            <div className="net__choices" role="radiogroup" aria-label={s.chooseTitle}>
              {options.map((option) => (
                <label className="net__choice" key={option.id}>
                  <input
                    className="nx-radio"
                    type="radio"
                    name={`${baseId}-mode`}
                    value={option.id}
                    checked={selected === option.id}
                    onChange={() => setSelected(option.id)}
                    // The row is a wrapping label, so its accessible name would be
                    // the title AND the explanation as one utterance. Naming the
                    // title replaces it; describing the body keeps the explanation
                    // audible instead of trading one defect for a silence.
                    aria-labelledby={`${baseId}-${option.id}-title`}
                    aria-describedby={`${baseId}-${option.id}-body`}
                  />
                  <span className="net__choice-title" id={`${baseId}-${option.id}-title`}>
                    {option.title}
                  </span>
                  <span className="net__choice-body" id={`${baseId}-${option.id}-body`}>
                    {option.body}
                  </span>
                </label>
              ))}
            </div>
            {failed && (
              <p className="auth__error" role="alert">
                {s.saveError}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy}>
              {s.chooseConfirm}
            </Button>
            <p className="nx-hint nx-hint--prose">{s.chooseHint}</p>
          </form>
        </div>
      </Card>
    </div>
  );
}
