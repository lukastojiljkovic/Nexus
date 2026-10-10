import { useCallback, useEffect, useId, useState } from "react";
import { Button, Checkbox, Select } from "@nexus/ui";
import type { ModelTier } from "@nexus/core";
import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import type { AssistantKnowledgeView, AssistantSettingsView } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * THE ASSISTANT'S settings card body (ADR-090, ADR-106 item 7): the default
 * tier, the web-search consent, and what the knowledge index holds.
 *
 * **Three rows, and each is a different kind of value.** The tier is a PROFILE
 * row that travels in the archive; the consent is a DEVICE row (ADR-097 puts it
 * beside `cloud.json` for the reason the module's manifest records); the index
 * is a reading with one button.
 *
 * **The consent's own sentence is not a hint about the switch - it is what the
 * switch means.** "Web search" could be read as "search the app's own content",
 * so the sentence says exactly what leaves the machine: the question the user
 * typed, to the provider the tool call names, and nothing else. Its own row and
 * its own sentence, off by default, which is the whole of ADR-097.
 *
 * **The labels come from the manifest.** The declaration is what the settings
 * filter indexes and what the shots harness looks for; drawing second copies
 * here is how a card comes to search under one name and render another, so both
 * are resolved with `declaredText`.
 */

/** One declared control, found by KEY rather than by index so reordering cannot repoint a row. */
const TIER_ROW = manifest.settings?.controls.find((control) => control.key === "tier");
const WEB_ROW = manifest.settings?.controls.find((control) => control.key === "web-search");
const KNOWLEDGE_ROW = manifest.settings?.controls.find((control) => control.key === "knowledge");

export default function AssistantSettings({ profileId, hits }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AssistantSettingsView | null>(null);
  const [knowledge, setKnowledge] = useState<AssistantKnowledgeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The consent's name is a `<span>` the checkbox points at, so the accessible name is the visible one. */
  const consentLabelId = useId();
  /** The tier row's own visible label, so the select is named by what the user reads. */
  const tierLabelId = useId();

  const load = useCallback(async () => {
    try {
      const view = await window.nexus.modules.assistant.list({ profileId });
      setSettings(view.settings);
      setKnowledge(view.knowledge);
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the assistant settings could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await action();
      setSaved(true);
    } catch (failure) {
      setError(copy.errors.action);
      console.error("Nexus: an assistant setting was not saved:", failure);
    } finally {
      setBusy(false);
    }
  }

  async function setTier(tier: ModelTier): Promise<void> {
    await save(async () => {
      await window.nexus.modules.assistant.setDefaultTier({ profileId, tier });
      await load();
    });
  }

  async function setConsent(enabled: boolean): Promise<void> {
    await save(async () => {
      setSettings(
        await window.nexus.modules.assistant.setWebSearch({ profileId, enabled }),
      );
    });
  }

  async function rebuild(): Promise<void> {
    await save(async () => {
      setKnowledge(
        await window.nexus.modules.assistant.reindexKnowledge({ profileId }),
      );
    });
  }

  const tierOptions = (TIER_ROW?.kind === "choice" ? TIER_ROW.options : []).map((option) => ({
    id: option.id,
    label: declaredText(option.labelKey),
  }));

  return (
    <>
      <p className="nx-hint">{copy.settings.hint}</p>

      <div className="set__module-row">
        <div className="set__module-info">
          <span
            id={tierLabelId}
            className={labelClass(
              "set__module-name",
              hits.has(settingsEntryId("assistant", "tier")),
            )}
          >
            {declaredText(TIER_ROW?.labelKey)}
          </span>
        </div>
        <Select
          aria-labelledby={tierLabelId}
          value={settings?.defaultTier ?? "balance"}
          disabled={settings === null || busy}
          onChange={(event) => void setTier(event.target.value as ModelTier)}
        >
          {tierOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="set__module-row">
        <div className="set__module-info">
          <span
            id={consentLabelId}
            className={labelClass(
              "set__module-name",
              hits.has(settingsEntryId("assistant", "web-search")),
            )}
          >
            {declaredText(WEB_ROW?.labelKey)}
          </span>
          <span className="nx-hint">{copy.web.sentence}</span>
          {settings !== null && !settings.webSearch.modeAllows && (
            <span className="nx-hint">{copy.web.modeBlocked}</span>
          )}
        </div>
        <Checkbox
          checked={settings?.webSearch.enabled ?? false}
          aria-labelledby={consentLabelId}
          disabled={settings === null || busy}
          onChange={(event) => void setConsent(event.target.checked)}
        />
      </div>

      <div className="set__module-row">
        <div className="set__module-info">
          <span
            className={labelClass(
              "set__module-name",
              hits.has(settingsEntryId("assistant", "knowledge")),
            )}
          >
            {declaredText(KNOWLEDGE_ROW?.labelKey)}
          </span>
          <span className="nx-hint">
            {`${copy.knowledge.indexed}: ${String(knowledge?.indexedChunks ?? 0)} · ${copy.knowledge.pending}: ${String(
              knowledge?.pendingSources ?? 0,
            )}`}
          </span>
          <span className="nx-hint">
            {knowledge?.embedderId === null || knowledge === null
              ? copy.knowledge.noEmbedder
              : `${copy.knowledge.embedder}: ${knowledge.embedderId}`}
          </span>
        </div>
        <Button size="sm" disabled={busy} onClick={() => void rebuild()}>
          {copy.knowledge.rebuild}
        </Button>
      </div>

      {error !== null && <p className="set__error">{error}</p>}
      {saved && error === null && <p className="nx-hint">{copy.settings.saved}</p>}
    </>
  );
}
