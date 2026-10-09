import { useEffect, useState } from "react";

import { Button } from "@nexus/ui";

import type {
  InstalledPackView,
  PackCandidateView,
  PackProgress,
  PackRefusalCode,
} from "../../shared/ipc.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { formatPackSize, packText, sortPacksByTitle } from "./packsView.js";
import { activeLocale, fill, strings } from "./strings.js";

/**
 * ADR-091's „Paketi sadržaja" card, and the only surface a content pack has.
 *
 * What the card may not do, and why it is shaped the way it is:
 *
 *   - **It never names a folder.** „Instaliraj iz fascikle…" calls
 *     `packsInspect`, which opens main's own dialog; the folder that dialog
 *     returned is what `packsInstall` then installs, and the renderer never
 *     sees a path. So the button is the only way a pack can arrive, which is
 *     `SEC-EL`'s boundary stated as a shape rather than a check.
 *   - **It shows the licence and the attribution for every pack, always.** Not
 *     behind a disclosure and not only for CC BY-SA: the pack's licence is what
 *     its author requires to travel with the content, and a card that hid it
 *     would be distributing somebody's work without the notice they asked for.
 *   - **A refusal is a code from main, turned into a sentence here.** The
 *     `problem` table is closed against `PackRefusalCode`, so a new code is a
 *     compile error rather than a card that silently says nothing.
 *
 * The list is re-read from `onPacksChanged` rather than from the reply of
 * whatever call happened to run, for `UpdateAbout`'s reason: a second window, a
 * failed install and a removal all land on the same answer.
 */
export function PacksSettings() {
  const s = strings.settings.contentPacks;
  const locale = activeLocale();
  const [packs, setPacks] = useState<InstalledPackView[] | null>(null);
  const [candidate, setCandidate] = useState<PackCandidateView | null>(null);
  const [removing, setRemoving] = useState<InstalledPackView | null>(null);
  const [progress, setProgress] = useState<PackProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const [problem, setProblem] = useState<PackRefusalCode | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void window.nexus
      .packsList()
      .then((list) => {
        if (live) setPacks(list);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    const offChanged = window.nexus.onPacksChanged((list) => {
      setPacks(list);
      setVerified(null);
    });
    const offProgress = window.nexus.onPacksProgress((row) => {
      setProgress(row);
    });
    return () => {
      live = false;
      offChanged();
      offProgress();
    };
  }, []);

  /** One place a refusal lands, so a sentence can never be shown beside the wrong button. */
  function refused(code: PackRefusalCode): void {
    setProblem(code);
    setFailed(false);
  }

  function crashed(): void {
    setFailed(true);
    setProblem(null);
  }

  async function choose(): Promise<void> {
    setBusy(true);
    setProblem(null);
    setFailed(false);
    try {
      const inspected = await window.nexus.packsInspect();
      if (inspected.outcome === "refused") refused(inspected.code);
      else if (inspected.outcome === "ready") setCandidate(inspected.candidate);
    } catch {
      crashed();
    } finally {
      setBusy(false);
    }
  }

  async function install(): Promise<void> {
    setBusy(true);
    setProblem(null);
    setFailed(false);
    try {
      const result = await window.nexus.packsInstall();
      if (result.outcome === "refused") refused(result.code);
    } catch {
      crashed();
    } finally {
      setBusy(false);
      setCandidate(null);
      setProgress(null);
    }
  }

  async function verify(id: string): Promise<void> {
    setBusy(true);
    setVerifying(id);
    setProblem(null);
    setFailed(false);
    setVerified(null);
    try {
      const result = await window.nexus.packsVerify(id);
      if (result.outcome === "refused") refused(result.code);
      else setVerified(id);
    } catch {
      crashed();
    } finally {
      setBusy(false);
      setVerifying(null);
      setProgress(null);
    }
  }

  async function remove(id: string): Promise<void> {
    setRemoving(null);
    setBusy(true);
    setProblem(null);
    setFailed(false);
    try {
      const result = await window.nexus.packsRemove(id);
      if (result.outcome === "refused") refused(result.code);
    } catch {
      crashed();
    } finally {
      setBusy(false);
    }
  }

  const problemText = problem === null ? null : s.problem[problem];
  const progressText =
    progress === null
      ? null
      : `${fill(progress.phase === "copy" ? s.progressCopy : s.progressVerify, { file: progress.file })} · ${fill(
          s.progressCount,
          { done: progress.filesDone, total: progress.filesTotal },
        )}`;

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.intro}</p>
      <div className="packs__actions">
        <Button variant="primary" disabled={busy} onClick={() => void choose()}>
          {s.install}
        </Button>
      </div>
      <p className="nx-hint nx-hint--prose">{s.installHint}</p>

      {progressText !== null && <p className="nx-hint">{progressText}</p>}
      {problemText !== null && (
        <p className="packs__problem" role="alert">
          {s.problemTitle} {problemText}
        </p>
      )}
      {failed && (
        <p className="packs__problem" role="alert">
          {s.error}
        </p>
      )}

      {packs === null ? (
        <p className="nx-hint">{strings.app.loading}</p>
      ) : packs.length === 0 ? (
        <div className="packs__empty">
          <p className="nx-hint">{s.emptyTitle}</p>
          <p className="nx-hint nx-hint--prose">{s.emptyBody}</p>
        </div>
      ) : (
        <ul className="packs__list">
          {sortPacksByTitle(packs, locale).map((pack) => (
            <li className="packs__row" key={pack.id}>
              <div className="packs__row-head">
                <span className="packs__row-title">{packText(pack.title, locale)}</span>
                <span className="packs__row-meta">
                  {s.versionLabel} {pack.version} · {pack.kind}
                </span>
              </div>
              <p className="nx-hint">{packText(pack.description, locale)}</p>
              <p className="nx-hint">
                {s.sizeLabel}: {formatPackSize(pack.size)} · {s.filesLabel}: {pack.fileCount}
              </p>
              <p className="nx-hint">
                {s.licenceLabel}: {pack.licence.spdx} · {s.attributionLabel}:{" "}
                {pack.licence.attribution}
              </p>
              <p className="nx-hint">
                {s.sourceLabel}: {pack.source.name} — {pack.source.url}
              </p>
              <div className="packs__row-actions">
                <Button size="sm" disabled={busy} onClick={() => void verify(pack.id)}>
                  {verifying === pack.id ? s.verifying : s.verify}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => setRemoving(pack)}>
                  {s.remove}
                </Button>
              </div>
              {verified === pack.id && <p className="nx-hint">{s.verifyOk}</p>}
            </li>
          ))}
        </ul>
      )}

      {candidate !== null && (
        <ConfirmDialog
          title={s.candidateTitle}
          question={fill(s.candidateQuestion, {
            title: packText(candidate.title, locale),
            version: candidate.version,
            size: formatPackSize(candidate.size),
          })}
          note={s.candidateHint}
          confirmLabel={s.installConfirm}
          cancelLabel={s.cancel}
          onConfirm={() => void install()}
          onCancel={() => setCandidate(null)}
        />
      )}
      {removing !== null && (
        <ConfirmDialog
          title={s.removeTitle}
          name={packText(removing.title, locale)}
          question={s.removeQuestion}
          confirmLabel={s.removeConfirm}
          cancelLabel={s.cancel}
          onConfirm={() => void remove(removing.id)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  );
}
