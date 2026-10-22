import { useEffect, useId, useState } from "react";
import { Button, Card, ConfirmDialog, Icon, Notice, Segmented, type SegmentedOption } from "@nexus/ui";
import { activeLocale } from "../../../../renderer/src/moduleKit/moduleSurface.js";
import {
  MAP_REGION_DETAILS,
  type MapRegionDetail,
  type MapRegionEstimate,
  type MapRegionsView,
  type MapsApi,
  type RegionProblem,
} from "../../shared/ipc.js";
import type { WorldRegion } from "../../shared/world/outline.js";
import { copy } from "../copy.js";
import { regionName, regionScopes, territoryName } from "./names.js";
import { formatBuild, formatBytes, otherDownload, regionCardState } from "./regionCard.js";
import "./regions.css";

export interface RegionCardProps {
  readonly territory: WorldRegion;
  readonly regions: MapRegionsView;
  readonly api: Pick<MapsApi, "estimateRegion" | "downloadRegion" | "pauseRegion" | "cancelRegion" | "removeRegion">;
  readonly onChange: (view: MapRegionsView) => void;
  readonly onShow: (id: string) => void;
  readonly onClose: () => void;
}

/** The scope and detail the reader picked, for the territory they were picked on. */
interface Choice {
  readonly territory: string;
  readonly scope: string;
  /** `null` until the reader picks a detail: the card then shows the installed one, or the scope's default. */
  readonly detail: MapRegionDetail | null;
}

/** The measured size of a (scope, detail) pair, keyed so an answer for an older pair is never shown. */
interface Measure {
  readonly key: string;
  readonly result: MapRegionEstimate;
}

/** The detail a scope starts at when nothing is installed or picked: a territory's towns, a continent's overview. */
function defaultDetail(scope: string, territory: string): MapRegionDetail {
  return scope === territory ? "towns" : "overview";
}

/**
 * The card a clicked territory opens: which scope to download, at which detail,
 * what is on disk for it, and the buttons that change that. It holds no download
 * of its own; every answer is the main process's, handed up through `onChange`.
 */
export function RegionCard({ territory, regions, api, onChange, onShow, onClose }: RegionCardProps) {
  const locale = activeLocale();
  const c = copy.regions;
  const titleId = useId();
  const [choice, setChoice] = useState<Choice>({ territory: territory.id, scope: territory.id, detail: null });
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [fault, setFault] = useState<RegionProblem | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // A card that was given another territory starts over on it, without an effect.
  const sameTerritory = choice.territory === territory.id;
  const scope = sameTerritory ? choice.scope : territory.id;
  const picked = sameTerritory ? choice.detail : null;

  const state = regionCardState(scope, regions);
  const busy = otherDownload(scope, regions);
  const running = state.kind === "measuring" || state.kind === "downloading" || state.kind === "paused";
  const installed = state.kind === "installed" ? state.region : null;
  const detail: MapRegionDetail =
    state.kind === "measuring" || state.kind === "downloading" || state.kind === "paused"
      ? state.job.detail
      : (picked ?? installed?.detail ?? defaultDetail(scope, territory.id));

  const measureKey = `${scope}/${detail}`;
  const needsMeasure = state.kind === "absent" || state.kind === "installed" || state.kind === "failed";

  useEffect(() => {
    if (!needsMeasure) return;
    let current = true;
    api.estimateRegion({ id: scope, detail }).then(
      (result) => {
        if (current) setMeasure({ key: measureKey, result });
      },
      (failure: unknown) => {
        console.error("Nexus: the map region could not be measured:", failure);
        if (current) setMeasure({ key: measureKey, result: { ok: false, problem: "io" } });
      },
    );
    return () => {
      current = false;
    };
  }, [api, scope, detail, measureKey, needsMeasure]);

  const measured = measure !== null && measure.key === measureKey ? measure.result : null;
  const pending = needsMeasure && measured === null;
  const size = measured?.ok === true ? formatBytes(measured.bytes, locale) : "–";
  const canDownload = measured?.ok === true && busy === null;
  const downloadLabel = (template: string) => (pending ? c.measuring : template.replace("{size}", size));

  const notice: RegionProblem | null =
    state.kind === "failed"
      ? (state.job.problem ?? "network")
      : (fault ?? (measured !== null && !measured.ok ? measured.problem : null));

  async function run(operation: () => Promise<MapRegionsView>): Promise<void> {
    try {
      const view = await operation();
      setFault(null);
      onChange(view);
    } catch (failure) {
      console.error("Nexus: a map region action failed:", failure);
      setFault("io");
    }
  }

  function selectScope(next: string) {
    setChoice({ territory: territory.id, scope: next, detail: null });
  }

  function selectDetail(next: MapRegionDetail) {
    setChoice({ territory: territory.id, scope, detail: next });
  }

  const scopeOptions: readonly SegmentedOption<string>[] = regionScopes(territory).map((id) => ({
    value: id,
    label: regionName(id, locale),
  }));
  const detailOptions: readonly SegmentedOption<MapRegionDetail>[] = MAP_REGION_DETAILS.map((value) => ({
    value,
    label: c.details[value],
    disabled: running,
  }));

  const replacing = installed !== null && detail !== installed.detail;
  const updating = state.kind === "installed" && state.update && !replacing;

  const statusLine = (() => {
    switch (state.kind) {
      case "absent":
        return c.notInstalled;
      case "installed":
        return c.installed
          .replace("{detail}", c.details[state.region.detail])
          .replace("{size}", formatBytes(state.region.bytes, locale))
          .replace("{date}", formatBuild(state.region.build, locale));
      case "measuring":
        return c.preparing;
      case "downloading":
      case "paused":
        return c[state.kind]
          .replace("{received}", formatBytes(state.job.receivedBytes, locale))
          .replace("{total}", state.job.totalBytes === null ? "–" : formatBytes(state.job.totalBytes, locale));
      case "failed":
        return c.failed;
    }
  })();

  return (
    <Card
      className="maps-region"
      role="region"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !confirmRemove) onClose();
      }}
    >
      <header className="maps-region__header">
        <div className="maps-region__heading">
          <p className="nx-eyebrow maps-region__line">{regionName(`continent:${territory.continent}`, locale)}</p>
          <h2 id={titleId} className="maps-region__title">
            {territoryName(territory, locale)}
          </h2>
        </div>
        <Button variant="ghost" size="sm" aria-label={c.close} onClick={onClose}>
          <Icon name="close" size={13} />
        </Button>
      </header>

      <Segmented label={c.scope} options={scopeOptions} value={scope} onSelect={selectScope} />

      <div className="maps-region__detail">
        <Segmented label={c.detail} options={detailOptions} value={detail} onSelect={selectDetail} />
        <p className="nx-hint">{c.detailHints[detail]}</p>
      </div>

      <div className="maps-region__status" aria-live="polite">
        <p className="maps-region__line">{statusLine}</p>
        {state.kind === "installed" && state.update && regions.newestBuild !== null && (
          <p className="maps-region__line">{c.update.replace("{date}", formatBuild(regions.newestBuild, locale))}</p>
        )}
        {busy !== null && <p className="maps-region__line">{c.otherBusy.replace("{name}", regionName(busy.id, locale))}</p>}
        {(state.kind === "downloading" || state.kind === "paused") && (
          <span className="maps-region__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent}>
            <span className="maps-region__bar" style={{ inlineSize: `${String(state.percent)}%` }} />
          </span>
        )}
      </div>

      {notice !== null && <Notice kind="warning" message={c.problems[notice]} />}

      <div className="maps-region__actions">
        {(state.kind === "absent" || state.kind === "failed") && (
          <Button
            variant="primary"
            disabled={!canDownload}
            onClick={() => void run(() => api.downloadRegion({ id: scope, detail }))}
          >
            {downloadLabel(c.download)}
          </Button>
        )}
        {(replacing || updating) && (
          <Button
            variant="primary"
            disabled={!canDownload}
            onClick={() => void run(() => api.downloadRegion({ id: scope, detail }))}
          >
            {downloadLabel(replacing ? c.replace : c.updateAction)}
          </Button>
        )}
        {state.kind === "paused" && (
          <Button variant="primary" onClick={() => void run(() => api.downloadRegion({ id: scope, detail: state.job.detail }))}>
            {c.resume}
          </Button>
        )}
        {installed !== null && (
          <Button variant={replacing || updating ? "ghost" : "primary"} onClick={() => onShow(scope)}>
            {c.show}
          </Button>
        )}
        {(state.kind === "measuring" || state.kind === "downloading") && (
          <Button onClick={() => void run(() => api.pauseRegion({}))}>{c.pause}</Button>
        )}
        {(state.kind === "failed" || running) && (
          <Button onClick={() => void run(() => api.cancelRegion({}))}>{c.cancel}</Button>
        )}
        {installed !== null && <Button onClick={() => setConfirmRemove(true)}>{c.remove}</Button>}
      </div>

      {confirmRemove && installed !== null && (
        <ConfirmDialog
          title={c.removeTitle}
          question={c.removeBody
            .replace("{name}", regionName(scope, locale))
            .replace("{size}", formatBytes(installed.bytes, locale))}
          confirmLabel={c.remove}
          cancelLabel={copy.dialog.cancel}
          destructive
          onConfirm={() => {
            setConfirmRemove(false);
            void run(() => api.removeRegion({ id: scope }));
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </Card>
  );
}
