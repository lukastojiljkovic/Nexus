import { useEffect, useId, useState } from "react";

import { Button } from "@nexus/ui";

import type { NetworkMode } from "../../shared/ipc.js";
import { labelClass } from "./settingsSearch.js";
import { strings } from "./strings.js";
import { publishNetworkMode, useNetworkMode } from "./updates.js";

/**
 * ADR-089's „Mreža i ažuriranja" card — the first card of the privacy
 * category, and the only place the stored mode is changed after first run.
 *
 * Two rules the card exists to state:
 *
 *   1. **A change takes effect after a restart.** The resolver rule is a
 *      Chromium command-line switch read once at launch, so the mode a process
 *      came up under is the mode it keeps. The card says so and offers the
 *      restart rather than pretending the switch is live.
 *   2. **Nothing is written until „Sačuvaj izbor".** The radios are local
 *      state; the stored file changes on the button and nowhere else.
 */
export function NetworkSettings({ hits }: { hits: ReadonlySet<string> }) {
  const s = strings.network;
  const view = useNetworkMode();
  const stored: NetworkMode = view?.mode ?? "offline";
  const [selected, setSelected] = useState<NetworkMode>(stored);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [restartFailed, setRestartFailed] = useState(false);
  const baseId = useId();

  // The stored mode arrives asynchronously and can also change from elsewhere
  // (a second card instance during the same session), so the radios follow it.
  useEffect(() => {
    setSelected(stored);
  }, [stored]);

  const restartRequired = view?.restartRequired ?? false;
  const dirty = selected !== stored;

  const options: readonly {
    readonly id: NetworkMode;
    readonly hitId: string;
    readonly title: string;
    readonly body: string;
  }[] = [
    { id: "offline", hitId: "network-offline", title: s.offlineTitle, body: s.offlineBody },
    { id: "updates", hitId: "network-updates", title: s.updatesTitle, body: s.updatesBody },
  ];

  async function save(): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      const next = await window.nexus.setNetworkMode(selected);
      publishNetworkMode(next);
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function restart(): Promise<void> {
    setRestartFailed(false);
    try {
      await window.nexus.relaunchApp();
    } catch {
      setRestartFailed(true);
    }
  }

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.cardIntro}</p>
      {view === null ? (
        <p className="nx-hint">{strings.app.loading}</p>
      ) : (
        <>
          <div className="net__choices" role="radiogroup" aria-label={s.chooseTitle}>
            {options.map((option) => (
              <label className="net__choice" key={option.id}>
                <input
                  className="nx-radio"
                  type="radio"
                  name={`${baseId}-mode`}
                  value={option.id}
                  checked={selected === option.id}
                  onChange={() => {
                    setSelected(option.id);
                    // A new choice is not the saved one any more, so the
                    // confirmation goes with the edit it described.
                    setSaved(false);
                  }}
                  aria-labelledby={`${baseId}-${option.id}-title`}
                  aria-describedby={`${baseId}-${option.id}-body`}
                />
                <span
                  className={labelClass("net__choice-title", hits.has(option.hitId))}
                  id={`${baseId}-${option.id}-title`}
                >
                  {option.title}
                </span>
                <span className="net__choice-body" id={`${baseId}-${option.id}-body`}>
                  {option.body}
                </span>
              </label>
            ))}
          </div>
          <div className="net__actions">
            <Button
              variant="primary"
              disabled={busy || !dirty}
              onClick={() => void save()}
            >
              {s.save}
            </Button>
            {restartRequired && (
              <Button disabled={busy} onClick={() => void restart()}>
                {s.restartNow}
              </Button>
            )}
          </div>
          {saved && <p className="nx-hint">{s.saved}</p>}
          {restartRequired && <p className="nx-hint nx-hint--prose">{s.restartNote}</p>}
          {failed && (
            <p className="auth__error" role="alert">
              {s.saveError}
            </p>
          )}
          {restartFailed && (
            <p className="auth__error" role="alert">
              {s.restartError}
            </p>
          )}
        </>
      )}
    </>
  );
}
