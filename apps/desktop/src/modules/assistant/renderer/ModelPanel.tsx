import { useId, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  ConfirmDialog,
  EmptyState,
  Icon,
  ListRow,
  TextField,
  type AsyncState,
} from "@nexus/ui";
import type { ModelEntry, ModelTier } from "@nexus/core";
import { ExternalLink } from "../../../renderer/src/moduleKit/ExternalLink.js";
import { activeLocale, numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import type {
  AssistantProbeView,
  AssistantRuntimeOptionsView,
  AssistantSetupView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import { openAppLocation } from "./location.js";
import {
  MODEL_VALUE_KEYS,
  checkDraft,
  draftFrom,
  isChanged,
  withModelDefaults,
  type FieldProblem,
  type NumberKey,
  type RuntimeDraft,
  type RuntimeLimits,
} from "./runtimeForm.js";
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
 *
 * **The runtime is saved as one object.** The card edits a draft of the five model
 * values, the idle time and the auto-compact switch, and checks it field by field
 * (`runtimeForm.ts`). Nothing is sent while a field is refused, and the view main
 * answers with replaces the draft, so the form always shows what is stored.
 */

/** The four cards of this pane, each of which owns the problems its own actions raise. */
type PanelCard = "setup" | "installed" | "search" | "runtime";

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
  const [draft, setDraft] = useState<RuntimeDraft>(() => draftFrom(setup.runtime.options));
  const compactHintId = useId();
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

  /** Saves the whole options object; the view main answers with replaces the draft. */
  function saveRuntime(runtime: AssistantRuntimeOptionsView): Promise<void> {
    return run("runtime", "runtime-save", async () => {
      const view = await window.nexus.modules.assistant.setRuntime({ profileId, runtime });
      setDraft(draftFrom(view.runtime.options));
      return view;
    });
  }

  /** One field of the draft, as the user types it. */
  const edit = (key: NumberKey, text: string) => setDraft((current) => ({ ...current, [key]: text }));

  const check = checkDraft(draft, setup.runtime.limits);
  const options = check.options;
  /** Whether the draft differs from what is saved. A draft with a refused field always does. */
  const unsaved = options === null || isChanged(options, setup.runtime.options);
  const chatId = setup.resident.chat;
  const chatTitle =
    chatId === null
      ? null
      : (setup.installed.find((entry) => entry.model.id === chatId)?.model.title ?? chatId);
  const loaded = chatId !== null || setup.resident.embedder !== null;

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

      <Card className="asst__card" title={copy.runtime.title} aria-busy={working?.card === "runtime" || undefined}>
        <div className="asst__memory">
          <div className="asst__facts">
            <span className="nx-hint">{copy.runtime.inMemory}</span>
            {loaded ? (
              <>
                {chatTitle !== null && <span>{`${copy.runtime.chat}: ${chatTitle}`}</span>}
                {setup.resident.embedder !== null && (
                  <span>{`${copy.knowledge.embedder}: ${setup.resident.embedder}`}</span>
                )}
              </>
            ) : (
              <span className="nx-hint">{copy.runtime.nothingLoaded}</span>
            )}
          </div>
          <span className="asst__actions">
            {workingHint("runtime-unload")}
            <Button
              size="sm"
              disabled={busy || !loaded}
              onClick={() =>
                void run("runtime", "runtime-unload", () =>
                  window.nexus.modules.assistant.unloadModels({ profileId }),
                )
              }
            >
              {copy.runtime.unload}
            </Button>
          </span>
        </div>

        <div className="asst__runtime-grid">
          {MODEL_VALUE_KEYS.map((key) => (
            <RuntimeField
              key={key}
              field={key}
              value={draft[key]}
              limit={setup.runtime.limits[key]}
              problem={check.problems[key]}
              placeholder={copy.runtime.modelDefault}
              onChange={(text) => edit(key, text)}
            />
          ))}
        </div>

        <RuntimeField
          field="idleUnloadMinutes"
          value={draft.idleUnloadMinutes}
          limit={setup.runtime.limits.idleUnloadMinutes}
          problem={check.problems.idleUnloadMinutes}
          onChange={(text) => edit("idleUnloadMinutes", text)}
        />

        <div className="asst__runtime-toggle">
          <Checkbox
            aria-describedby={compactHintId}
            checked={draft.autoCompact}
            onChange={(event) => setDraft((current) => ({ ...current, autoCompact: event.target.checked }))}
          >
            {copy.runtime.autoCompact}
          </Checkbox>
          <p id={compactHintId} className="nx-hint">
            {copy.runtime.autoCompactHint}
          </p>
        </div>

        <div className="asst__actions">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || options === null || !unsaved}
            onClick={() => {
              if (options !== null) void saveRuntime(options);
            }}
          >
            {copy.runtime.save}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={busy || MODEL_VALUE_KEYS.every((key) => draft[key].trim() === "")}
            onClick={() => setDraft(withModelDefaults)}
          >
            {copy.runtime.defaults}
          </Button>
          {workingHint("runtime-save")}
        </div>
        {problemIn("runtime")}
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

/**
 * One number field of the runtime form. The hint is named by the input, and so is
 * the refusal, so a screen reader hears what the field is for and why it was refused.
 */
function RuntimeField({
  field,
  value,
  limit,
  problem,
  placeholder,
  onChange,
}: {
  readonly field: NumberKey;
  readonly value: string;
  readonly limit: RuntimeLimits[NumberKey];
  readonly problem: FieldProblem | undefined;
  readonly placeholder?: string;
  readonly onChange: (text: string) => void;
}) {
  const hintId = useId();
  const errorId = useId();
  const text = copy.runtime.fields[field];
  return (
    <div className="asst__runtime-field">
      <TextField
        label={text.label}
        className={problem === undefined ? undefined : "nx-field--invalid"}
        value={value}
        placeholder={placeholder}
        inputMode={limit.integer ? "numeric" : "decimal"}
        maxLength={12}
        aria-invalid={problem === undefined ? undefined : true}
        aria-describedby={problem === undefined ? hintId : `${hintId} ${errorId}`}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={hintId} className="nx-hint">
        {text.hint}
      </span>
      <span className="nx-hint">{`${copy.runtime.range}: ${formatNumber(limit.min)} – ${formatNumber(limit.max)}`}</span>
      {problem !== undefined && (
        <p id={errorId} className="nx-field__error">
          <span className="nx-field__error-mark" aria-hidden="true">
            <Icon name="warning" size={13} />
          </span>
          {problemText(problem)}
        </p>
      )}
    </div>
  );
}

/** A refusal of a typed value, in the language being read. */
function problemText(problem: FieldProblem): string {
  switch (problem) {
    case "not-a-number":
      return copy.runtime.problem.notANumber;
    case "not-whole":
      return copy.runtime.problem.notWhole;
    case "out-of-range":
      return copy.runtime.problem.outOfRange;
  }
}

/** A limit as a reader's locale writes it: `32.768` in Serbian, `32,768` in English. */
function formatNumber(value: number): string {
  return numberFormat({ maximumFractionDigits: 2 }, activeLocale()).format(value);
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
