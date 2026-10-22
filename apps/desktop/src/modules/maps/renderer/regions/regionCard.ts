import type { MapRegionJobView, MapRegionView, MapRegionsView } from "../../shared/ipc.js";
import type { Locale } from "./names.js";

export type RegionCardState =
  | { kind: "absent" }
  | { kind: "installed"; region: MapRegionView; update: boolean }
  | { kind: "measuring" | "downloading" | "paused"; job: MapRegionJobView; percent: number }
  | { kind: "failed"; job: MapRegionJobView };

const TAGS: Record<Locale, string> = { sr: "sr-Latn", en: "en" };
const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;

/** How far a job has got, as a whole percentage. Zero until the plan has measured the file. */
function percentOf(job: MapRegionJobView): number {
  if (job.totalBytes === null || job.totalBytes === 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((job.receivedBytes / job.totalBytes) * 100)));
}

/** What the card for one scope shows: its job if one runs for it, else what is installed. */
export function regionCardState(scopeId: string, view: MapRegionsView): RegionCardState {
  const job = view.job;
  if (job !== null && job.id === scopeId) {
    if (job.state === "failed") return { kind: "failed", job };
    return { kind: job.state, job, percent: percentOf(job) };
  }
  const region = view.installed.find((installed) => installed.id === scopeId);
  if (region === undefined) return { kind: "absent" };
  const update = view.newestBuild !== null && region.build < view.newestBuild;
  return { kind: "installed", region, update };
}

/** The job of another scope while it measures or downloads: the card's Download then waits for it. */
export function otherDownload(scopeId: string, view: MapRegionsView): MapRegionJobView | null {
  const job = view.job;
  if (job === null || job.id === scopeId) return null;
  return job.state === "measuring" || job.state === "downloading" ? job : null;
}

/**
 * A byte count in the largest binary unit it reaches, in the reader's number
 * format. A count that would round up to a unit is written in it: one byte
 * short of a gigabyte is "1.0 GB", not "1,024 MB".
 */
export function formatBytes(bytes: number, locale: Locale): string {
  const format = (value: number, fractionDigits: number) =>
    new Intl.NumberFormat(TAGS[locale], {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  if (bytes >= GB - MB / 2) return `${format(bytes / GB, 1)} GB`;
  if (bytes >= MB - KB / 2) return `${format(bytes / MB, 0)} MB`;
  if (bytes >= KB) return `${format(bytes / KB, 0)} KB`;
  return `${format(bytes, 0)} B`;
}

/** A build's `yyyymmdd` as the long date of that UTC day. */
export function formatBuild(build: string, locale: Locale): string {
  const year = Number(build.slice(0, 4));
  const month = Number(build.slice(4, 6)) - 1;
  const day = Number(build.slice(6, 8));
  return new Intl.DateTimeFormat(TAGS[locale], { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month, day)),
  );
}
