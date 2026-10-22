import { useState } from "react";
import { Button, Card, Chip, ConfirmDialog, EmptyState, ListRow, TextField, type AsyncState } from "@nexus/ui";
import type { ModelEntry, ModelTier } from "@nexus/core";
import { ExternalLink } from "../../../renderer/src/moduleKit/ExternalLink.js";
import { activeLocale, numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { AssistantProbeView, AssistantSetupView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { openAppLocation } from "./location.js";
import { pickInstalled, servesTiers } from "./surfaceStates.js";

/**
 * THE MODELS AND SETUP PANE (ADR-106 item 6): what this machine can run, what it
 * has, and the three ways a model gets here.
 *
 * **Hardware first, then three picks, then the machine's own shelf.** The order
 * is the runtime's own logic made visible: the picks are computed from the RAM
 * and the card this machine has, so the numbers they were computed from are
 * shown above them - a recommendation a reader cannot check is a recommendation
 * they have to take on faith. Both come from the probe (`AssistantProbeView`),
 * which answers after the rest of the pane, so until it does the pane says it is
 * reading the machine, and the shelf below works already.
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
 * through the kit's `ExternalLink` (ADR-103), the same one channel the citations
 * use, which refuses anything that is not https.
 *
 * **A problem is shown in the card that had it.** Each card names the action it
 * ran, a busy hint sits beside the control that started it, and a refusal is drawn
 * at the foot of the card that was working - not three cards away below the fold.
 *
 * **The installed list is where a model is chosen to answer.** A downloaded or
 * imported chat model serves no tier, so without a choice it can never answer;
 * "Use for answers" on its row is that choice, and it is the profile's own
 * (migration 92's `chat_model_id`). An embedding model is offered nothing,
 * because it cannot answer at all - main refuses such an id by the same rule.
 */

/** The three cards of this pane, each of which owns the problems its own actions raise. */
type PanelCard = "setup" | "installed" | "search";

export function ModelPanel({
  profileId,
  setup,
  probe,
  onSetup,
}: {
  readonly profileId: string;
  readonly setup: AssistantSetupView;
  readonly probe: AsyncState<AssistantProbeView>;
  readonly onSetup: (view: AssistantSetupView) => void;
}) {
  const [query, setQuery] = useState("");
  /** The action running now: the card it is in, and the control that started it. It disables the others. */
  const [working, setWorking] = useState<{ readonly card: PanelCard; readonly key: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<{ readonly card: PanelCard; readonly text: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState<ModelEntry | null>(null);
  const busy = working !== null;

  /**
   * Runs one op and hands the fresh view back; a refusal is shown in the card that
   * ran it, never swallowed. `key` names the control, so only that control says it is working.
   */
  async function run(
    card: PanelCard,
    key: string,
    action: () => Promise<AssistantSetupView>,
    failure: string = copy.errors.action,
  ): Promise<void> {
    setWorking({ card, key });
    setProblem(null);
    try {
      onSetup(await action());
    } catch (error) {
      setProblem({ card, text: failure });
      console.error("Nexus: an assistant model action failed:", error);
    } finally {
      setWorking(null);
    }
  }

  /** The hint that sits beside the control which started the work, and only that one. */
  const workingHint = (key: string) =>
    working?.key === key ? <span className="nx-hint">{copy.setup.working}</span> : null;

  /** A card's own problem, drawn at its foot. */
  const problemIn = (card: PanelCard) =>
    problem?.card === card ? (
      <p className="asst__error" role="alert">
        {problem.text}
      </p>
    ) : null;

  const download = setup.download;
  const probed = probe.status === "ready" ? probe.data : null;

  return (
    <div className="asst__models">
      <Card className="asst__card" title={copy.setup.title} aria-busy={working?.card === "setup" || undefined}>
        <p className="nx-hint">{copy.setup.intro}</p>
        {probed === null ? (
          <p className="nx-hint" role="status">
            {probe.status === "failed" ? copy.setup.probeFailed : copy.setup.probing}
          </p>
        ) : (
          <>
            <div className="asst__facts">
              <span className="nx-hint">{copy.setup.hardwareTitle}</span>
              <span>{`${copy.setup.ram}: ${formatBytes(probed.hardware.totalRamBytes)}`}</span>
              <span>{`${copy.setup.cpu}: ${String(probed.hardware.cpuThreads)}`}</span>
              <span>
                {probed.hardware.gpus.length === 0
                  ? copy.setup.noGpu
                  : `${copy.setup.gpu}: ${probed.hardware.gpus
                      .map((gpu) => `${gpu.name} (${formatBytes(gpu.vramBytes)})`)
                      .join(", ")}`}
              </span>
            </div>

            <div className="asst__picks">
              <span className="nx-eyebrow">{copy.setup.picksTitle}</span>
              {probed.recommendations.length === 0 ? (
                <p className="nx-hint">
                  {probed.unavailable === null
                    ? copy.setup.unavailable
                    : probed.unavailable[activeLocale()]}
                </p>
              ) : (
                probed.recommendations.map((pick) => (
                  <ListRow
                    key={pick.tier}
                    leading={
                      <span className="asst__tier">
                        <Chip>{tierLabel(pick.tier)}</Chip>
                      </span>
                    }
                    trailing={
                      pickInstalled(setup.installed, pick.model.id) ? (
                        <Chip variant="data">{copy.setup.installed}</Chip>
                      ) : (
                        <span className="asst__actions">
                          {workingHint(`download:${pick.model.id}`)}
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busy || !setup.downloadsAllowed}
                            onClick={() =>
                              void run("setup", `download:${pick.model.id}`, () =>
                                window.nexus.modules.assistant.downloadModel({
                                  profileId,
                                  modelId: pick.model.id,
                                }),
                              )
                            }
                          >
                            {copy.setup.download}
                          </Button>
                        </span>
                      )
                    }
                  >
                    <span className="asst__pick">
                      <span className="asst__pick-name">{pick.model.title}</span>
                      <span className="nx-hint">
                        {`${copy.setup.size}: ${formatBytes(pick.model.sizeBytes)} · ${copy.setup.licence}: `}
                        <ExternalLink href={pick.model.licence.url}>{pick.model.licence.name}</ExternalLink>
                      </span>
                      <span className="nx-hint">{pick.reason[activeLocale()]}</span>
                    </span>
                  </ListRow>
                ))
              )}
            </div>
          </>
        )}

        {download !== null && (
          <div className="asst__download" role="status">
            <span>{`${copy.setup.progress} ${download.model.title} — ${formatBytes(
              download.receivedBytes,
            )} / ${formatBytes(download.totalBytes)}`}</span>
            {download.status === "running" ? (
              <Button
                size="sm"
                onClick={() =>
                  void run("setup", "download-stop", () =>
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
                disabled={busy}
                onClick={() =>
                  void run("setup", "download-resume", () =>
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
            {workingHint("download-resume")}
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
              void run("setup", "import", () =>
                window.nexus.modules.assistant.importModel({ profileId }),
              )
            }
          >
            {copy.setup.import}
          </Button>
          {workingHint("import")}
        </div>
        {problemIn("setup")}
      </Card>

      <Card
        className="asst__card"
        title={copy.setup.installedTitle}
        aria-busy={working?.card === "installed" || undefined}
      >
        {setup.installed.length === 0 ? (
          <EmptyState variant="inline" title={copy.setup.noModel} description={copy.setup.intro} />
        ) : (
          setup.installed.map((entry) => (
            <ListRow
              key={entry.model.id}
              leading={<span className="asst__pick-name">{entry.model.title}</span>}
              trailing={
                <span className="asst__actions">
                  {servesTiers(probed, entry.model.id).length > 0 && (
                    <Chip variant="data">
                      {`${copy.setup.serves}: ${servesTiers(probed, entry.model.id).map(tierLabel).join(", ")}`}
                    </Chip>
                  )}
                  {entry.chosen ? (
                    <>
                      <Chip variant="data">{copy.setup.answersYourQuestions}</Chip>
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={busy}
                        onClick={() =>
                          void run("installed", "chat-recommended", () =>
                            window.nexus.modules.assistant.setChatModel({
                              profileId,
                              modelId: null,
                            }),
                          )
                        }
                      >
                        {copy.setup.useRecommended}
                      </Button>
                    </>
                  ) : (
                    entry.model.capabilities.includes("chat") && (
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={busy}
                        onClick={() =>
                          void run("installed", `chat:${entry.model.id}`, () =>
                            window.nexus.modules.assistant.setChatModel({
                              profileId,
                              modelId: entry.model.id,
                            }),
                          )
                        }
                      >
                        {copy.setup.useForAnswers}
                      </Button>
                    )
                  )}
                  <Button size="sm" variant="quiet" disabled={busy} onClick={() => setRemoving(entry.model)}>
                    {copy.setup.remove}
                  </Button>
                  {workingHint(`chat:${entry.model.id}`)}
                </span>
              }
            >
              <span className="nx-hint">
                {`${entry.model.quantization} · ${formatBytes(entry.model.sizeBytes)} · ${entry.model.licence.name}`}
              </span>
            </ListRow>
          ))
        )}
        {problemIn("installed")}
      </Card>

      <Card
        className="asst__card"
        title={copy.setup.searchTitle}
        aria-busy={working?.card === "search" || undefined}
      >
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
              void run("search", "search", () =>
                window.nexus.modules.assistant.searchModels({
                  profileId,
                  query: query.trim(),
                }),
              )
            }
          >
            {copy.setup.search}
          </Button>
          {workingHint("search")}
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
                    <span className="asst__actions">
                      {workingHint(`search-download:${entry.id}`)}
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run("search", `search-download:${entry.id}`, () =>
                            window.nexus.modules.assistant.downloadModel({
                              profileId,
                              modelId: entry.id,
                            }),
                          )
                        }
                      >
                        {copy.setup.download}
                      </Button>
                    </span>
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
        {problemIn("search")}
      </Card>

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
            void run("installed", `remove:${model.id}`, () =>
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
