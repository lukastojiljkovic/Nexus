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

  useEffect(() => {
    let cancelled = false;
    window.nexus
      .syncStatus()
      .then((view) => {
        if (!cancelled) setStatus(view);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setLoadFailed(true);
        console.error("Nexus: failed to read the sync status:", loadError);
      });
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

      {card.kind === "enable" && (
        <form className="set__field set__field--stacked" onSubmit={(event) => void submit(event)}>
          <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("sync-enable"))}>
            {s.enableTitle}
          </h3>
          <p className="app__description">{s.enableIntro}</p>
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
            <TextField
              label={s.deviceNameLabel}
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
            />
          </div>
          <p className="set__section-caption">{s.passwordHint}</p>
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
              deviceName.trim().length === 0
            }
          >
            {busy ? s.working : s.submit}
          </Button>
        </form>
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
          {!card.signedIn && <p className="set__section-caption">{s.signedOut}</p>}
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
