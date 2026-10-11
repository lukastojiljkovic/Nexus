import { useState } from "react";
import { Button, Card, Chip, ConfirmDialog, EmptyState, ListRow, TextField } from "@nexus/ui";
import type { ModelEntry, ModelTier } from "@nexus/core";
import { activeLocale, numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { AssistantSetupView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { openAppLocation, openWebAddress } from "./location.js";

/**
 * THE MODELS AND SETUP PANE (ADR-106 item 6): what this machine can run, what it
 * has, and the three ways a model gets here.
 *
 * **Hardware first, then three picks, then the machine's own shelf.** The order
 * is the runtime's own logic made visible: the picks are computed from the RAM
 * and the card this machine has, so the numbers they were computed from are
 * shown above them - a recommendation a reader cannot check is a recommendation
 * they have to take on faith.
 *
 * **A download is offered only where it can happen.** The runtime refuses
 * outside the `downloads` network mode (ADR-092), so this pane says WHICH mode
 * the download needs and offers the way to that setting rather than showing a
 * button that would fail. The button that opens Settings is the module's own
 * `openAppLocation` - the shell's one door for a kit module to ask to be taken
 * somewhere (see `location.ts`).
 *
 * **A model's licence travels with it.** Every entry the runtime offers carries
 * its licence name and address, and this pane draws both and opens the address
 * through `window.nexus.openExternal` (ADR-103) - the same one channel the
 * citations use, which refuses anything that is not https.
 */

export function ModelPanel({
  profileId,
  setup,
  onSetup,
}: {
  readonly profileId: string;
  readonly setup: AssistantSetupView;
  readonly onSetup: (view: AssistantSetupView) => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ModelEntry | null>(null);

  /** Runs one op and hands the fresh view back; a refusal is shown, never swallowed. */
  async function run(
    action: () => Promise<AssistantSetupView>,
    failure: string = copy.errors.action,
  ): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      onSetup(await action());
    } catch (error) {
      setProblem(failure);
      console.error("Nexus: an assistant model action failed:", error);
    } finally {
      setBusy(false);
    }
  }

  const download = setup.download;

  return (
    <div className="asst__models">
      <Card className="asst__card" title={copy.setup.title}>
        <p className="nx-hint">{copy.setup.intro}</p>
        <div className="asst__facts">
          <span className="nx-hint">{copy.setup.hardwareTitle}</span>
          <span>{`${copy.setup.ram}: ${formatBytes(setup.hardware.totalRamBytes)}`}</span>
          <span>{`${copy.setup.cpu}: ${String(setup.hardware.cpuThreads)}`}</span>
          <span>
            {setup.hardware.gpus.length === 0
              ? copy.setup.noGpu
              : `${copy.setup.gpu}: ${setup.hardware.gpus
                  .map((gpu) => `${gpu.name} (${formatBytes(gpu.vramBytes)})`)
                  .join(", ")}`}
          </span>
        </div>

        <div className="asst__picks">
          <span className="nx-eyebrow">{copy.setup.picksTitle}</span>
          {setup.recommendations.length === 0 ? (
            <p className="nx-hint">
              {setup.unavailable === null
                ? copy.setup.unavailable
                : setup.unavailable[activeLocale()]}
            </p>
          ) : (
            setup.recommendations.map((pick) => (
              <ListRow
                key={pick.tier}
                leading={<Chip>{tierLabel(pick.tier)}</Chip>}
                trailing={
                  pick.installed ? (
                    <Chip variant="data">{copy.setup.installed}</Chip>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy || !setup.downloadsAllowed}
                      onClick={() =>
                        void run(() =>
                          window.nexus.modules.assistant.downloadModel({
                            profileId,
                            modelId: pick.model.id,
                          }),
                        )
                      }
                    >
                      {copy.setup.download}
                    </Button>
                  )
                }
              >
                <span className="asst__pick-name">{pick.model.title}</span>
                <span className="nx-hint">
                  {`${copy.setup.size}: ${formatBytes(pick.model.sizeBytes)} · ${copy.setup.licence}: `}
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => void openWebAddress(pick.model.licence.url)}
                  >
                    {pick.model.licence.name}
                  </Button>
                </span>
                <span className="nx-hint">{pick.reason[activeLocale()]}</span>
              </ListRow>
            ))
          )}
        </div>

        {download !== null && (
          <div className="asst__download" role="status">
            <span>{`${copy.setup.progress} ${download.model.title} — ${formatBytes(
              download.receivedBytes,
            )} / ${formatBytes(download.totalBytes)}`}</span>
            {download.status === "running" ? (
              <Button
                size="sm"
                onClick={() =>
                  void run(() =>
                    window.nexus.modules.assistant.cancelDownload({
                      profileId,
                    }),
                  )
                }
              >
                {copy.setup.stop}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  void run(() =>
                    window.nexus.modules.assistant.resumeDownload({
                      profileId,
                      modelId: download.model.id,
                    }),
                  )
                }
              >
                {copy.setup.resume}
              </Button>
            )}
            {download.status === "failed" && (
              <span className="asst__error">{copy.setup.downloadFailed}</span>
            )}
            {download.status === "stopped" && (
              <span className="nx-hint">{copy.setup.downloadStopped}</span>
            )}
          </div>
        )}

        {!setup.downloadsAllowed && (
          <div className="asst__notice">
            <p className="nx-hint">{copy.setup.needsDownloads}</p>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => openAppLocation({ module: "settings", settings: "privacy" })}
            >
              {copy.setup.openSettings}
            </Button>
          </div>
        )}

        <div className="asst__actions">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() =>
                window.nexus.modules.assistant.importModel({ profileId }),
              )
            }
          >
            {copy.setup.import}
          </Button>
        </div>
      </Card>

      <Card className="asst__card" title={copy.setup.installedTitle}>
        {setup.installed.length === 0 ? (
          <EmptyState variant="inline" title={copy.setup.noModel} description={copy.setup.intro} />
        ) : (
          setup.installed.map((entry) => (
            <ListRow
              key={entry.model.id}
              leading={<span className="asst__pick-name">{entry.model.title}</span>}
              trailing={
                <span className="asst__actions">
                  {entry.servesTiers.length > 0 && (
                    <Chip variant="data">
                      {`${copy.setup.serves}: ${entry.servesTiers.map(tierLabel).join(", ")}`}
                    </Chip>
                  )}
                  <Button size="sm" variant="quiet" onClick={() => setRemoving(entry.model)}>
                    {copy.setup.remove}
                  </Button>
                </span>
              }
            >
              <span className="nx-hint">
                {`${entry.model.quantization} · ${formatBytes(entry.model.sizeBytes)} · ${entry.model.licence.name}`}
              </span>
            </ListRow>
          ))
        )}
      </Card>

      <Card className="asst__card" title={copy.setup.searchTitle}>
        <div className="asst__search">
          <TextField
            label={copy.setup.searchTitle}
            value={query}
            maxLength={200}
            placeholder={copy.setup.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || query.trim() === "" || !setup.downloadsAllowed}
            onClick={() =>
              void run(() =>
                window.nexus.modules.assistant.searchModels({
                  profileId,
                  query: query.trim(),
                }),
              )
            }
          >
            {copy.setup.search}
          </Button>
        </div>
        <p className="nx-hint">{copy.setup.searchHint}</p>
        {setup.search !== null && (
          <div className="asst__picks">
            {setup.search.length === 0 ? (
              <p className="nx-hint">{copy.setup.searchEmpty}</p>
            ) : (
              setup.search.map((entry) => (
                <ListRow
                  key={entry.id}
                  leading={<span className="asst__pick-name">{entry.title}</span>}
                  trailing={
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          window.nexus.modules.assistant.downloadModel({
                            profileId,
                            modelId: entry.id,
                          }),
                        )
                      }
                    >
                      {copy.setup.download}
                    </Button>
                  }
                >
                  <span className="nx-hint">
                    {`${entry.file} · ${formatBytes(entry.sizeBytes)} · ${entry.licence.name}`}
                  </span>
                </ListRow>
              ))
            )}
          </div>
        )}
      </Card>

      {problem !== null && (
        <p className="asst__error" role="alert">
          {problem}
        </p>
      )}

      {removing !== null && (
        <ConfirmDialog
          title={copy.setup.removeTitle}
          name={removing.title}
          question={copy.setup.removeBody}
          confirmLabel={copy.setup.removeConfirm}
          cancelLabel={copy.rail.cancel}
          destructive
          onConfirm={() => {
            const model = removing;
            setRemoving(null);
            void run(() =>
              window.nexus.modules.assistant.removeModel({
                profileId,
                modelId: model.id,
              }),
            );
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/** One of the three tiers, in the language being read. */
function tierLabel(tier: ModelTier): string {
  switch (tier) {
    case "intelligence":
      return copy.setup.tierIntelligence;
    case "balance":
      return copy.setup.tierBalance;
    default:
      return copy.setup.tierSpeed;
  }
}

/** A size as a reader's locale writes numbers: `1,2 GB` in Serbian, `1.2 GB` in English. */
function formatBytes(bytes: number): string {
  const gigabyte = bytes >= 1_000_000_000;
  return numberFormat(
    {
      style: "unit",
      unit: gigabyte ? "gigabyte" : "megabyte",
      maximumFractionDigits: 1,
    },
    activeLocale(),
  ).format(bytes / (gigabyte ? 1_000_000_000 : 1_000_000));
}
