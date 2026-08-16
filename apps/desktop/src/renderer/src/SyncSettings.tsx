import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Checkbox, TextField } from "@nexus/ui";
import type { SyncEnableProblem, SyncStatusView } from "../../shared/ipc.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { labelClass } from "./settingsSearch.js";
import { strings } from "./strings.js";
import { syncCardState } from "./syncCardState.js";
import { formatArchiveInstant } from "./timeFormat.js";

export interface SyncSectionProps {
  /** The settings filter's current matches, for the typographic hit mark. */
  hits: ReadonlySet<string>;
}

/**
 * „Sinhronizacija" — the settings card for the cloud half of Nexus.
 *
 * ─── The card is a state machine, and it is decided elsewhere ───────────────
 *
 * `syncCardState.ts` maps the status view onto the one thing to draw, and it is
 * a tested pure function rather than four conditions in this JSX because two of
 * the combinations are easy to get wrong in the direction that costs a user a
 * password and an expiring TOTP code. Its header carries the argument; this file
 * draws whatever it returns.
 *
 * ─── Why the recovery code is component state and nothing else ──────────────
 *
 * `enableSync` answers with the Sync Recovery Code once. It is never stored, on
 * either side of the bridge, so this component holding it in `useState` is the
 * ONLY copy in the process — and the „Prepisao sam kod" button is what drops
 * it. That is why the panel is rendered INSTEAD of the rest of the card rather
 * than above it: nothing else on this card matters until the user has written
 * the code down, and a page they can scroll past is a page they will scroll
 * past.
 *
 * ─── Why the card tries to reconnect before it asks anything ───────────────
 *
 * A session lives in main's memory and does not survive a restart, so „enrolled
 * and not signed in" is the state of every launch, not a fault. Its ordinary
 * answer is the stored refresh token: `resumeSync` is one request, needs no
 * password, and comes back with the SAME session id — which is what keeps this
 * computer's existing device row valid. The effect below therefore tries it as
 * soon as the status arrives, and only a failure brings the password form out.
 * Behind a button, that request would be a chore the user has to discover; in
 * front of one, the password would be asked for at every launch and each answer
 * would mint a second device row for a machine that already has a good one.
 *
 * ─── Why the switch answers `cloudRestartRequired` in both directions ───────
 *
 * The cloud boundary is read ONCE, at startup, when `createCloudPorts` decides
 * whether the ports object exists at all. Flipping the file mid-run cannot
 * conjure a port and must not destroy one mid-request, so the switch writes the
 * file and says so. Both the box's position and the note come from the status
 * view — main computes them, from the stored switch and from the one this launch
 * came up with — so leaving the page and coming back finds the box still ticked
 * and the note still there. Nothing about the switch is remembered in here.
 *
 * ─── What this component may not do ────────────────────────────────────────
 *
 * It never sees a token, a key, a wrap or a server message: `SyncStatusView` is
 * an address, a device id, a date and four booleans, and a refusal is a machine
 * code this file maps to its own Serbian sentence (SEC-EL — the renderer is
 * untrusted, so it is told the minimum that lets it draw the truth). The
 * password lives in component state for exactly as long as the submit takes and
 * is cleared before the call resolves, the same hygiene the backup passphrase
 * form keeps.
 */
export function SyncSection({ hits }: SyncSectionProps) {
  const s = strings.settings.sync;

  const [status, setStatus] = useState<SyncStatusView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmedCode, setConfirmedCode] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  /**
   * Which of the two ways onto an account this form is currently asking about.
   *
   * Local state rather than another `syncCardState` branch, deliberately: it is
   * not derived from anything main knows. The status view cannot tell whether
   * the ACCOUNT already has a master key — only the server can, and only after
   * a sign-in and a step-up — so a card state computed from the status would be
   * guessing. What the product knows is what the user said they are doing.
   */
  const [mode, setMode] = useState<"enable" | "adopt">("enable");
  const [recoveryInput, setRecoveryInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let view: SyncStatusView;
      try {
        view = await window.nexus.syncStatus();
      } catch (loadError) {
        if (!cancelled) setLoadFailed(true);
        console.error("Nexus: failed to read the sync status:", loadError);
        return;
      }
      if (cancelled) return;
      setStatus(view);

      // A session lives in main's memory, so „enrolled and not signed in" is the
      // ordinary state of every launch — and the stored refresh token is the
      // ordinary answer to it: one request, no password, and the SAME session id,
      // which is what keeps this computer's device row valid. Only when that
      // fails is the reconnect form worth showing, so it is tried here rather
      // than waited for behind a button the user should never have to find.
      const loaded = syncCardState({ status: view, recoveryCode: null });
      if (loaded.kind !== "enabled" || !loaded.reconnectable) return;
      setResuming(true);
      try {
        const resumed = await window.nexus.resumeSync();
        if (!cancelled) setStatus(resumed);
      } catch (resumeError) {
        // A resume that throws is a dead session with extra steps, and a dead
        // session's answer is the form below. Nothing about the account is in
        // doubt, so the card stays exactly as it is.
        console.error("Nexus: resuming the sync session failed:", resumeError);
      } finally {
        if (!cancelled) setResuming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleCloud(enabled: boolean): Promise<void> {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      // The whole status, not a boolean: main answers with the file it has just
      // written, so the checkbox and the restart note both come from one read
      // and this component remembers nothing about the click.
      setStatus(await window.nexus.setCloudEnabled(enabled));
    } catch (switchError) {
      setError(s.error);
      console.error("Nexus: writing the cloud switch failed:", switchError);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    // Read out and dropped from state BEFORE the await, exactly as the backup
    // passphrase form does: a submitted secret has no business surviving in a
    // component, and a refusal should re-ask rather than silently retry a held
    // copy.
    const submitted = password;
    setPassword("");
    try {
      const view = await window.nexus.enableSync({
        email: email.trim(),
        password: submitted,
        totpCode: totpCode.trim(),
        deviceName: deviceName.trim(),
      });
      if (view.outcome === "enabled") {
        setStatus(view.status);
        setRecoveryCode(view.recoveryCode);
        setEmail("");
        setTotpCode("");
        setDeviceName("");
      } else if (view.outcome === "already-minted") {
        // Not an error the user can retry — it is the other road, so the form
        // BECOMES the other road rather than describing it. The address and the
        // computer's name survive; the code does not, because reaching this
        // answer spent the step-up that consumed it, and offering the spent one
        // back would fail for a reason the screen had already been told.
        setMode("adopt");
        setTotpCode("");
        setError(s.alreadyMinted);
      } else {
        setError(refusalMessage(view.reason));
      }
    } catch (enableError) {
      setError(s.error);
      console.error("Nexus: enabling sync failed:", enableError);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The other way onto an account: this computer joins one that already has a
   * master key, using the Sync Recovery Code from the machine that minted it.
   *
   * The recovery code is dropped from state before the await for the same
   * reason the password is. It is not a password, but it opens the account's
   * master key from anywhere, which makes it the more valuable of the two.
   */
  async function submitAdopt(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const submitted = password;
    const submittedCode = recoveryInput;
    setPassword("");
    setRecoveryInput("");
    try {
      const view = await window.nexus.adoptSync({
        email: email.trim(),
        password: submitted,
        totpCode: totpCode.trim(),
        recoveryCode: submittedCode.trim(),
        deviceName: deviceName.trim(),
      });
      if (view.outcome === "adopted") {
        setStatus(view.status);
        setEmail("");
        setTotpCode("");
        setDeviceName("");
        setMode("enable");
      } else {
        setError(s.adoptErrors[view.reason]);
      }
    } catch (adoptError) {
      setError(s.adoptError);
      console.error("Nexus: joining the existing sync account failed:", adoptError);
    } finally {
      setBusy(false);
    }
  }

  async function submitReconnect(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    // Same hygiene as the enable form: read out, dropped from state before the
    // await, never held across a refusal.
    const submitted = password;
    setPassword("");
    try {
      const view = await window.nexus.reconnectSync({
        password: submitted,
        deviceName: deviceName.trim(),
      });
      if (view.outcome === "reconnected") {
        setStatus(view.status);
        setDeviceName("");
      } else {
        setError(s.reconnectErrors[view.reason]);
      }
    } catch (reconnectError) {
      setError(s.reconnectError);
      console.error("Nexus: reconnecting this computer to its account failed:", reconnectError);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    setConfirmingDisconnect(false);
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      setStatus(await window.nexus.disconnectSync());
    } catch (disconnectError) {
      setError(s.disconnectError);
      console.error("Nexus: disconnecting this computer from sync failed:", disconnectError);
    } finally {
      setBusy(false);
    }
  }

  if (loadFailed) return <p className="set__error">{s.error}</p>;
  if (status === null) return <p className="app__muted">{strings.app.loading}</p>;

  const card = syncCardState({ status, recoveryCode });
  const adopting = mode === "adopt";

  // The one-time code owns the card while it exists. See the header.
  if (card.kind === "recovery") {
    return (
      <div className="set__restore-block">
        <h3 className="nx-eyebrow set__module-group-title">{s.recoveryTitle}</h3>
        <p className="app__description">{s.recoveryIntro}</p>
        <pre className="auth__code">{card.code}</pre>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(card.code)
              .then(() => setCopied(true))
              .catch((copyError: unknown) => {
                console.error("Nexus: failed to copy the sync recovery code:", copyError);
              });
          }}
        >
          {copied ? strings.auth.recoveryKit.copied : strings.auth.recoveryKit.copy}
        </Button>
        <Checkbox checked={confirmedCode} onChange={(event) => setConfirmedCode(event.target.checked)}>
          {strings.auth.recoveryKit.confirmCheckbox}
        </Checkbox>
        <Button
          variant="primary"
          disabled={!confirmedCode}
          onClick={() => {
            setRecoveryCode(null);
            setConfirmedCode(false);
            setCopied(false);
          }}
        >
          {s.recoveryDone}
        </Button>
      </div>
    );
  }

  return (
    <>
      <p className="app__description">{s.description}</p>

      {/* The house boolean row: name on the left, why-it-matters under it, the
          box on the trailing edge with every other control on the page. */}
      <div className="set__module-row">
        <div className="set__module-info">
          <span className={labelClass("set__module-name", hits.has("sync-cloud"))}>{s.cloudLabel}</span>
          <span className="set__module-desc">{s.cloudHint}</span>
        </div>
        <Checkbox
          checked={status.cloudEnabled}
          aria-label={s.cloudLabel}
          disabled={busy}
          onChange={(event) => void toggleCloud(event.target.checked)}
        />
      </div>
      {status.cloudRestartRequired && <p className="set__section-caption">{s.cloudRestart}</p>}

      {card.kind === "unconfigured" && <p className="set__section-caption">{s.unconfigured}</p>}

      {/* One form, two modes. The four fields, the two hints and the whole
          submit discipline are identical between „turn sync on here" and „join
          an account that already has a key" — the difference is one extra field
          and which method it calls. Two forms would be two copies of the same
          validation, and the copies are what drift. */}
      {card.kind === "enable" && (
        <>
          <form
            className="set__field set__field--stacked"
            onSubmit={(event) => void (adopting ? submitAdopt(event) : submit(event))}
          >
            {/* The mark follows the TITLE, not the slot. Both entries exist in
                the search index and each names one of the two roads, so a hit
                keyed to the slot would highlight whichever heading happened to
                be showing — which is the search telling the user it found
                something else. */}
            <h3
              className={labelClass(
                "nx-eyebrow set__module-group-title",
                hits.has(adopting ? "sync-adopt" : "sync-enable"),
              )}
            >
              {adopting ? s.adoptTitle : s.enableTitle}
            </h3>
            <p className="app__description">{adopting ? s.adoptIntro : s.enableIntro}</p>
            <div className="set__security-form">
              <TextField
                type="email"
                autoComplete="off"
                label={s.emailLabel}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <TextField
                type="password"
                autoComplete="off"
                label={s.passwordLabel}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <TextField
                // `inputMode="numeric"` rather than `type="number"`: a TOTP code is
                // six digits that may lead with a zero, which a numeric input would
                // eat, and it has no arithmetic meaning to step through.
                inputMode="numeric"
                autoComplete="off"
                label={s.totpLabel}
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
              />
              {/* Deliberately NOT `type="password"`. This code is transcribed
                  from paper, it is long, and the one mistake it invites is a
                  mistyped character — which a masked field hides until the
                  submit has already spent a step-up and revoked the user's
                  other sessions to find out. */}
              {adopting && (
                <TextField
                  autoComplete="off"
                  label={s.recoveryCodeLabel}
                  value={recoveryInput}
                  onChange={(event) => setRecoveryInput(event.target.value)}
                />
              )}
              <TextField
                label={s.deviceNameLabel}
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </div>
            <p className="set__section-caption">{s.passwordHint}</p>
            {adopting && <p className="set__section-caption">{s.recoveryCodeHint}</p>}
            <p className="set__section-caption">{s.deviceNameHint}</p>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={
                busy ||
                email.trim().length === 0 ||
                password.length === 0 ||
                totpCode.trim().length === 0 ||
                deviceName.trim().length === 0 ||
                (adopting && recoveryInput.trim().length === 0)
              }
            >
              {busy ? (adopting ? s.adoptWorking : s.working) : adopting ? s.adoptSubmit : s.submit}
            </Button>
          </form>

          {/* The house row: what the other road is on the left, the way onto it
              on the trailing edge with every other control on the page. */}
          <div className="set__module-row">
            <div className="set__module-info">
              <span
                className={labelClass(
                  "set__module-name",
                  hits.has(adopting ? "sync-enable" : "sync-adopt"),
                )}
              >
                {adopting ? s.enableTitle : s.adoptChoiceTitle}
              </span>
              <span className="set__module-desc">
                {adopting ? s.enableIntro : s.adoptChoiceHint}
              </span>
            </div>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setMode(adopting ? "enable" : "adopt");
                setRecoveryInput("");
                setError(null);
              }}
            >
              {adopting ? s.adoptBackAction : s.adoptChoiceAction}
            </Button>
          </div>
        </>
      )}

      {card.kind === "enabled" && (
        <div className="set__restore-block">
          <p className="set__section-caption">{s.statusOn}</p>
          <dl className="app__facts">
            <div>
              <dt>{s.accountLabel}</dt>
              <dd>{card.account.email}</dd>
            </div>
            {card.account.deviceId !== null && (
              <div>
                <dt>{s.deviceLabel}</dt>
                <dd className="app__path">{card.account.deviceId}</dd>
              </div>
            )}
            <div>
              <dt>{s.enabledAtLabel}</dt>
              <dd>{formatArchiveInstant(card.account.enabledAt)}</dd>
            </div>
          </dl>
          {resuming && <p className="set__section-caption">{s.connecting}</p>}
          {!card.signedIn && !resuming && !card.reconnectable && (
            <p className="set__section-caption">{s.signedOut}</p>
          )}

          {card.reconnectable && !resuming && (
            <form
              className="set__field set__field--stacked"
              onSubmit={(event) => void submitReconnect(event)}
            >
              <h3
                className={labelClass(
                  "nx-eyebrow set__module-group-title",
                  hits.has("sync-reconnect"),
                )}
              >
                {s.reconnectTitle}
              </h3>
              <p className="app__description">{s.reconnectIntro}</p>
              <div className="set__security-form">
                <TextField
                  type="password"
                  autoComplete="off"
                  label={s.passwordLabel}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {/* A new row, so it may legitimately carry a new name — and it has
                    to be asked for, because the old one was sealed under the master
                    key and this computer stores no readable copy of it. */}
                <TextField
                  label={s.deviceNameLabel}
                  value={deviceName}
                  onChange={(event) => setDeviceName(event.target.value)}
                />
              </div>
              <p className="set__section-caption">{s.reconnectPasswordHint}</p>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={busy || password.length === 0 || deviceName.trim().length === 0}
              >
                {busy ? s.working : s.reconnectSubmit}
              </Button>
            </form>
          )}

          <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("sync-disconnect"))}>
            {s.disconnectTitle}
          </h3>
          <p className="app__description">{s.disconnectWarning}</p>
          <Button size="sm" disabled={busy} onClick={() => setConfirmingDisconnect(true)}>
            {s.disconnect}
          </Button>
        </div>
      )}

      {error != null && <p className="set__error">{error}</p>}

      {confirmingDisconnect && (
        <ConfirmDialog
          title={s.disconnectTitle}
          question={s.disconnectWarning}
          confirmLabel={s.disconnectConfirm}
          cancelLabel={s.disconnectCancel}
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirmingDisconnect(false)}
        />
      )}
    </>
  );
}

/**
 * A machine refusal as the one Serbian sentence written for it.
 *
 * A plain index, and it is total by construction: `strings.settings.sync.errors`
 * is declared `satisfies Record<SyncEnableProblem, string>`, so a refusal the
 * protocol grows and this table does not name fails the build rather than
 * reaching a user as an empty box.
 */
function refusalMessage(reason: SyncEnableProblem): string {
  return strings.settings.sync.errors[reason];
}
