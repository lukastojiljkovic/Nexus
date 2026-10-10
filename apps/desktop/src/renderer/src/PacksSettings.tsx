import { useEffect, useState } from "react";

import { Button, Disclosure } from "@nexus/ui";

import type {
  InstalledPackView,
  PackCatalogueEntryView,
  PackCandidateView,
  PackDownloadProgress,
  PackProgress,
  PackRefusalCode,
} from "../../shared/ipc.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { openExternalLink } from "./links.js";
import { formatPackSize, groupCatalogueByKind, packText, sortPacksByTitle } from "./packsView.js";
import { SafetyNotice } from "./safetyNotice.js";
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
  /**
   * The catalogue (ADR-103), what this device has of each entry, and the one
   * download that can be in flight.
   *
   * `job` is not "is something downloading" but "which pack, and is it
   * paused": the row for that pack shows Pause/Resume and Cancel, every other
   * row stays usable, and a paused pack keeps its row until it is resumed,
   * cancelled or finished.
   */
  const [catalogue, setCatalogue] = useState<PackCatalogueEntryView[] | null>(null);
  const [catalogueProblem, setCatalogueProblem] = useState<PackRefusalCode | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [job, setJob] = useState<{ readonly id: string; readonly paused: boolean } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<PackDownloadProgress | null>(null);

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
    // The catalogue is read once here and re-read whenever the installed list
    // changes: an install moves an entry from "not installed" to "installed" or
    // from "update available" to current, and main has already verified the
    // document, so the second read is a lookup rather than a second download.
    void loadCatalogue(false);
    const offChanged = window.nexus.onPacksChanged((list) => {
      setPacks(list);
      setVerified(null);
      void loadCatalogue(false);
    });
    const offProgress = window.nexus.onPacksProgress((row) => {
      setProgress(row);
    });
    const offDownload = window.nexus.onPacksDownloadProgress((row) => {
      setDownloadProgress(row);
    });
    return () => {
      live = false;
      offChanged();
      offProgress();
      offDownload();
    };
    // `loadCatalogue` is a function declaration inside this component and closes
    // over nothing that changes, so it is stable for the effect's purpose:
    // listing it would only make the effect re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The catalogue, from main: it is fetched and verified once per launch and re-read on a refresh. */
  async function loadCatalogue(reload: boolean): Promise<void> {
    setCatalogueProblem(null);
    try {
      const result = await window.nexus.packsCatalogue(reload);
      if (result.outcome === "refused") setCatalogueProblem(result.code);
      else setCatalogue(result.entries);
    } catch {
      crashed();
    }
  }

  /** One label per state the card can draw, closed against the union so a new one is a compile error. */
  function stateLabel(state: PackCatalogueEntryView["state"]): string {
    if (state === "installed") return s.stateInstalled;
    if (state === "update-available") return s.stateUpdate;
    return s.stateNotInstalled;
  }

  /**
   * Starts a download and stays on the call until it ends.
   *
   * The reply is not a receipt but the ending: `"installed"` after the pack is
   * on disk and verified, `"paused"` when the user paused it, `"refused"` with
   * the code that says why. Nothing is set `busy` for the duration: a download
   * is minutes long, and taking the whole card out of service for it is how a
   * user ends up unable to cancel the thing that is running.
   */
  async function download(id: string): Promise<void> {
    setProblem(null);
    setFailed(false);
    setDownloadProgress(null);
    setJob({ id, paused: false });
    try {
      const result = await window.nexus.packsDownload(id);
      if (result.outcome === "refused") {
        refused(result.code);
        setJob(null);
      } else if (result.outcome === "paused") {
        setJob({ id, paused: true });
      } else {
        setJob(null);
      }
    } catch {
      crashed();
      setJob(null);
    } finally {
      void loadCatalogue(false);
    }
  }

  /** The row flips to paused when the download's own reply arrives; this only asks. */
  async function pauseDownload(id: string): Promise<void> {
    try {
      await window.nexus.packsDownloadPause(id);
    } catch {
      crashed();
    }
  }

  async function resumeDownload(id: string): Promise<void> {
    setProblem(null);
    setFailed(false);
    setJob({ id, paused: false });
    try {
      const result = await window.nexus.packsDownloadResume(id);
      if (result.outcome === "refused") {
        refused(result.code);
        setJob(null);
      } else if (result.outcome === "paused") {
        setJob({ id, paused: true });
      } else {
        setJob(null);
      }
    } catch {
      crashed();
      setJob(null);
    } finally {
      void loadCatalogue(false);
    }
  }

  async function cancelDownload(id: string): Promise<void> {
    setJob(null);
    setDownloadProgress(null);
    try {
      await window.nexus.packsDownloadCancel(id);
    } catch {
      crashed();
    }
  }

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
              {/* ADR-103: a safety pack carries its disclaimer wherever it is
                  read, and the card that lists it is the first of those places. */}
              {pack.notice === "safety" && <SafetyNotice />}
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

      {/* ADR-103: the catalogue. What can be downloaded, by kind, with the
          licence and the state this device has of each entry — and, behind a
          disclosure, the attribution and the source BEFORE anything downloads.
          The address links open through main's external-link rule. */}
      <div className="packs__catalogue">
        <div className="packs__row-head">
          <span className="packs__row-title">{s.catalogueTitle}</span>
          <Button size="sm" onClick={() => void loadCatalogue(true)}>
            {s.catalogueRefresh}
          </Button>
        </div>
        <p className="nx-hint nx-hint--prose">{s.catalogueHint}</p>
        {catalogueProblem === "downloads-off" ? (
          <p className="nx-hint">{s.catalogueModeOff}</p>
        ) : catalogueProblem !== null ? (
          <p className="packs__problem" role="alert">
            {s.problemTitle} {s.problem[catalogueProblem]}
          </p>
        ) : catalogue === null ? (
          <p className="nx-hint">{strings.app.loading}</p>
        ) : catalogue.length === 0 ? (
          <p className="nx-hint">{s.catalogueEmpty}</p>
        ) : (
          groupCatalogueByKind(catalogue, locale).map((group) => (
            <section className="packs__group" key={group.kind}>
              <p className="packs__group-title">{group.kind}</p>
              <ul className="packs__list">
                {group.entries.map((entry) => (
                  <li className="packs__row" key={entry.id}>
                    <div className="packs__row-head">
                      <span className="packs__row-title">{packText(entry.title, locale)}</span>
                      <span className="packs__row-meta">
                        {s.versionLabel} {entry.version} · {formatPackSize(entry.size)} ·{" "}
                        {stateLabel(entry.state)}
                      </span>
                    </div>
                    <p className="nx-hint">{packText(entry.description, locale)}</p>
                    <p className="nx-hint">
                      {s.licenceLabel}: {entry.licence.spdx} · {s.filesLabel}: {entry.fileCount}
                    </p>
                    {entry.state === "update-available" && entry.installedVersion !== null && (
                      <p className="nx-hint">
                        {s.installedVersionLabel}: {entry.installedVersion}
                      </p>
                    )}
                    {entry.notice === "safety" && <SafetyNotice />}
                    <Disclosure
                      label={s.catalogueDetails}
                      open={openEntry === entry.id}
                      onToggle={() => {
                        setOpenEntry(openEntry === entry.id ? null : entry.id);
                      }}
                    >
                      <p className="nx-hint">
                        {s.attributionLabel}: {entry.licence.attribution}
                      </p>
                      <p className="nx-hint">
                        {s.sourceLabel}: {entry.source.name} ·{" "}
                        <button
                          type="button"
                          className="packs__link"
                          onClick={() => openExternalLink(entry.source.url)}
                        >
                          {entry.source.url}
                        </button>
                      </p>
                      <p className="nx-hint">
                        <button
                          type="button"
                          className="packs__link"
                          onClick={() => openExternalLink(entry.licence.url)}
                        >
                          {entry.licence.url}
                        </button>
                      </p>
                    </Disclosure>
                    <div className="packs__row-actions">
                      {job !== null && job.id === entry.id ? (
                        <>
                          {job.paused ? (
                            <Button size="sm" onClick={() => void resumeDownload(entry.id)}>
                              {s.downloadResume}
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => void pauseDownload(entry.id)}>
                              {s.downloadPause}
                            </Button>
                          )}
                          <Button size="sm" onClick={() => void cancelDownload(entry.id)}>
                            {s.downloadCancel}
                          </Button>
                          {downloadProgress !== null && downloadProgress.id === entry.id && (
                            <span className="packs__row-meta">
                              {fill(
                                downloadProgress.phase === "install"
                                  ? s.downloadProgressInstall
                                  : s.downloadProgressDownload,
                                { file: downloadProgress.file },
                              )}{" "}
                              ·{" "}
                              {fill(s.progressCount, {
                                done: downloadProgress.filesDone,
                                total: downloadProgress.filesTotal,
                              })}
                            </span>
                          )}
                        </>
                      ) : (
                        <Button size="sm" disabled={busy} onClick={() => void download(entry.id)}>
                          {s.download}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        <p className="nx-hint nx-hint--prose">{s.downloadHint}</p>
      </div>

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
