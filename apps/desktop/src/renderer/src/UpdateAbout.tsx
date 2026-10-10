import { useState } from "react";

import { Button, Disclosure } from "@nexus/ui";

import { fill, strings } from "./strings.js";
import { useNetworkMode, useUpdateState } from "./updates.js";

/**
 * ADR-089's row on the About card.
 *
 * Two shapes, decided by `updatesActive` — the launch came up in „updates" AND
 * the stored choice is still „updates". While updates are not active the row
 * says the checks are off and offers a way to the card that changes them, and
 * there is no „Check now" button: main would refuse the request, and a button
 * whose only outcome is a refusal is a lie about what the product can do. While
 * updates are active the row is the check itself, its result, and Install.
 *
 * The release notes are rendered as TEXT, never as markup: `offer.notes` is
 * GitHub's release body and the one thing this app may not do with it is
 * interpret it as HTML. A `<pre>` with `white-space: pre-wrap` keeps the line
 * breaks a release note is written with and cannot execute anything.
 */
export function UpdateAbout({ onOpenNetworkCard }: { onOpenNetworkCard: () => void }) {
  const s = strings.network;
  const mode = useNetworkMode();
  const state = useUpdateState();
  const [busy, setBusy] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  // Before the first read resolves there is nothing true to say about either
  // mode; the row stays out of the way rather than guessing.
  if (mode === null) return <p className="nx-hint">{strings.app.loading}</p>;

  if (!mode.updatesActive) {
    return (
      <div className="net__about">
        <p className="nx-hint nx-hint--prose">{s.aboutOff}</p>
        <Button onClick={onOpenNetworkCard}>{s.aboutOpenCard}</Button>
      </div>
    );
  }

  const offer = state?.offer ?? null;
  const problemText = state?.problem != null ? s.problem[state.problem] : null;

  async function check(): Promise<void> {
    setBusy(true);
    try {
      await window.nexus.checkForUpdates();
    } catch {
      // The result arrives through `onUpdateChanged`, not through this reply —
      // a rejected call leaves the row showing whatever main last published.
    } finally {
      setBusy(false);
    }
  }

  async function install(): Promise<void> {
    setBusy(true);
    try {
      await window.nexus.installUpdate();
    } catch {
      // Same: the phase and any problem are pushed, and the app quits on
      // success before a reply could matter.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="net__about">
      <p className="nx-hint">{s.aboutTitle}</p>
      <div className="net__actions">
        <Button
          disabled={busy || state?.phase === "checking" || state?.phase === "downloading"}
          onClick={() => void check()}
        >
          {state?.phase === "checking" ? s.checking : s.checkNow}
        </Button>
        <Button onClick={() => void window.nexus.openReleasePage().catch(() => undefined)}>
          {s.releasePage}
        </Button>
      </div>
      {state?.phase === "up-to-date" && <p className="nx-hint">{s.upToDate}</p>}
      {offer !== null && (
        <>
          <p className="nx-hint">{fill(s.available, { version: offer.version })}</p>
          <Disclosure label={s.notesTitle} open={notesOpen} onToggle={setNotesOpen}>
            <pre className="net__notes">{offer.notes}</pre>
          </Disclosure>
          {offer.canInstall && (
            <>
              <Button variant="primary" disabled={busy} onClick={() => void install()}>
                {state?.phase === "downloading" ? s.installing : s.install}
              </Button>
              <p className="nx-hint nx-hint--prose">{s.installHint}</p>
            </>
          )}
          {/* ADR-102: a portable build never installs, and the row says so
              rather than leaving a missing button unexplained. */}
          {!offer.canInstall && state?.portable === true && (
            <p className="nx-hint nx-hint--prose">{s.portableNote}</p>
          )}
        </>
      )}
      {problemText !== null && (
        <p className="auth__error" role="alert">
          {s.problemTitle} {problemText}
        </p>
      )}
    </div>
  );
}
