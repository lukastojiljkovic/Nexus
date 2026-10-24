import type { PackDownloadProgress } from "../../shared/ipc.js";

export interface PackTransferSample {
  readonly id: string;
  readonly bytes: number;
  readonly at: number;
  readonly startedAt: number;
  readonly pausedMs: number;
  readonly pausedAt: number | null;
}

export interface PackTransferView {
  readonly percent: number;
  readonly speedBytesPerSecond: number | null;
  readonly elapsedMs: number;
  readonly sample: PackTransferSample;
}

export function transferView(
  progress: PackDownloadProgress,
  previous: PackTransferSample | null,
  now: number,
  paused: boolean,
): PackTransferView {
  const first = previous === null || previous.id !== progress.id;
  const pausedAt = paused ? (previous?.pausedAt ?? now) : null;
  const pauseDelta =
    previous?.pausedAt != null
      ? paused
        ? 0
        : Math.max(0, now - previous.pausedAt)
      : 0;
  const startedAt = first ? now : previous.startedAt;
  const pausedMs = (first ? 0 : previous.pausedMs) + pauseDelta;
  const sample: PackTransferSample = {
    id: progress.id,
    bytes: progress.bytesDone,
    at: now,
    startedAt,
    pausedMs,
    pausedAt,
  };
  const percent =
    progress.bytesTotal > 0
      ? Math.max(0, Math.min(100, (progress.bytesDone / progress.bytesTotal) * 100))
      : progress.filesTotal > 0
        ? Math.max(0, Math.min(100, (progress.filesDone / progress.filesTotal) * 100))
        : 0;
  const deltaBytes = first ? 0 : progress.bytesDone - previous.bytes;
  const resuming = previous?.pausedAt != null && !paused;
  const deltaMs = first || paused || resuming ? 0 : Math.max(0, now - previous.at);
  const speedBytesPerSecond =
    deltaBytes > 0 && deltaMs > 0 ? (deltaBytes * 1000) / deltaMs : null;
  return {
    percent,
    speedBytesPerSecond,
    elapsedMs: Math.max(0, now - startedAt - pausedMs),
    sample,
  };
}
