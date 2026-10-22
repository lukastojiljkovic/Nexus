/**
 * Measuring and downloading a map region (ADR-118).
 *
 * **One download at a time, polled.** A region is planned from the newest
 * build's directories (`extract/plan.ts`), which gives the finished file's size
 * to the byte, then its tiles are read in the build's own order and appended to
 * `<stem>.part`. The page polls `view()` while something is in flight, as the
 * offline library's downloads are polled, so no push channel is needed.
 *
 * **Resumable from the file's length.** The record beside the partial file
 * names the build and the `ETag` the download began with. A download started
 * again for the same region and detail re-plans against that build, which is
 * deterministic, and continues from the last whole fetch the file holds; a
 * build that has changed, or a different region or detail, starts over.
 *
 * **Where the bytes are checked.** Every answer is the exact range of the one
 * build the download began with (`http.ts`), the finished file is the planned
 * size, and a whole-world download, which is the build itself, is checked
 * against the MD5 the list gives. A cut has no published checksum to compare
 * with; ADR-118 says so.
 *
 * **An update never touches the map being read.** The new file has its own
 * name (`registry.ts`), the registry switches to it when it is complete, and
 * the old one is deleted then, or by the next sweep if the map still has it
 * open.
 */

import { createHash, type Hash } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { open, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import type { DownloadHttp } from "../../../../main/download/service.js";
import { modeAllowsDownloads, type NetworkMode } from "../../../../main/net/offline.js";
import type {
  MapRegionDetail,
  MapRegionEstimate,
  MapRegionJobView,
  MapRegionsView,
  RegionProblem,
} from "../../shared/ipc.js";
import { HEADER_BYTES, readHeader } from "../extract/archive.js";
import { FETCH_MAX_BYTES, PlanTooLarge, planExtract, type ExtractFetch, type ExtractPlan } from "../extract/plan.js";
import type { PlanetBuild } from "./builds.js";
import { buildReader, fetchBuilds, RegionError } from "./http.js";
import { regionUrl } from "./protocol.js";
import {
  mapsDir,
  partPath,
  readJob,
  readJobs,
  readRegions,
  regionFileName,
  removeJob,
  sweepRegionFiles,
  writeJob,
  writeRegions,
} from "./registry.js";
import { DETAIL_MAX_ZOOM, regionRanges, regionTarget, regionTargetBounds } from "./targets.js";

/**
 * The most directory entries a plan may keep, because the plan holds every one
 * in main's memory (ADR-118 §9). A policy value with room above Europe to zoom
 * 12: its 1,453,618 entries plan within a 384 MiB heap and not within 256 MiB
 * (measured against the 2026-10-22 build with `--max-old-space-size`).
 * Germany at full detail (890,435) is under it; France at full detail
 * (2,123,478) and the world to zoom 12 (6,316,341) are past it.
 */
export const PLAN_MAX_ENTRIES = 2_000_000;

/** Free space a download leaves on the volume beyond its own file. A policy value. */
export const SPACE_HEADROOM_BYTES = 256 * 1024 * 1024;

export interface RegionDownloadsDeps {
  readonly userData: string;
  /** The mode this launch may act on, as the download service reads it. */
  readonly mode: () => NetworkMode;
  readonly isAllowedUrl: (url: string) => boolean;
  readonly http: DownloadHttp;
  readonly freeSpaceBytes: (dir: string) => Promise<number>;
  /** {@link PLAN_MAX_ENTRIES}, lowered by tests. */
  readonly maxEntries?: number;
}

export interface RegionDownloads {
  view(): MapRegionsView;
  estimate(id: string, detail: MapRegionDetail): Promise<MapRegionEstimate>;
  /** Starts a download, or resumes the paused one for the same region and detail. */
  download(id: string, detail: MapRegionDetail): MapRegionsView;
  pause(): MapRegionsView;
  cancel(): Promise<MapRegionsView>;
  remove(id: string): Promise<MapRegionsView>;
  /** Settles when the download in flight has stopped. */
  idle(): Promise<void>;
}

/** A plan, the build it reads, the `ETag` its directories came from, and the MD5 when the plan is the whole build. */
interface Planned {
  readonly build: PlanetBuild;
  readonly plan: ExtractPlan;
  readonly etag: string | null;
  readonly md5: string | null;
}

interface Job {
  readonly id: string;
  readonly detail: MapRegionDetail;
  state: MapRegionJobView["state"];
  received: number;
  total: number | null;
  problem: RegionProblem | null;
  controller: AbortController;
  done: Promise<void>;
}

export function createRegionDownloads(deps: RegionDownloadsDeps): RegionDownloads {
  const maxEntries = deps.maxEntries ?? PLAN_MAX_ENTRIES;
  let builds: PlanetBuild[] | null = null;
  let cached: { key: string; planned: Planned } | null = null;
  let job: Job | null = pausedOnDisk();

  mkdirSync(mapsDir(deps.userData), { recursive: true });
  sweepRegionFiles(deps.userData);

  /** A download a previous run left unfinished, shown paused with the bytes its partial file holds. */
  function pausedOnDisk(): Job | null {
    const record = readJobs(deps.userData)[0];
    if (record === undefined) return null;
    return {
      id: record.id,
      detail: record.detail,
      state: "paused",
      received: sizeOfSync(partPath(deps.userData, record.id)),
      total: record.bytes,
      problem: null,
      controller: new AbortController(),
      done: Promise.resolve(),
    };
  }

  function view(): MapRegionsView {
    return {
      installed: readRegions(deps.userData).map(({ id, detail, build, bytes, file }) => ({
        id,
        detail,
        build,
        bytes,
        url: regionUrl(file),
      })),
      job:
        job === null
          ? null
          : {
              id: job.id,
              detail: job.detail,
              state: job.state,
              receivedBytes: job.received,
              totalBytes: job.total,
              problem: job.problem,
            },
      newestBuild: builds?.[0]?.key ?? null,
    };
  }

  async function planFor(
    id: string,
    detail: MapRegionDetail,
    signal: AbortSignal,
    resume: { build: string; etag: string | null } | null,
  ): Promise<Planned> {
    const target = regionTarget(id);
    if (target === null) throw new RegionError("region");
    if (!modeAllowsDownloads(deps.mode())) throw new RegionError("mode");
    builds = await fetchBuilds(deps.http, deps.isAllowedUrl, signal);
    const build = (resume === null ? undefined : builds.find((each) => each.key === resume.build)) ?? builds[0];
    if (build === undefined) throw new RegionError("no-build");
    const etag = resume !== null && resume.build === build.key ? resume.etag : null;
    const key = `${build.key}|${id}|${detail}|${etag ?? ""}`;
    if (cached?.key === key) return cached.planned;

    let planned: Planned;
    if (target.kind === "world" && detail === "full") {
      // The whole world at full detail is the build itself, copied in order.
      const fetches = [];
      for (let offset = 0; offset < build.bytes; offset += FETCH_MAX_BYTES) {
        const length = Math.min(FETCH_MAX_BYTES, build.bytes - offset);
        fetches.push({ offset, length, keep: [[0, length]] as const });
      }
      // Its header is read once so the download is pinned to this build's ETag from the start.
      const reader = buildReader(deps.http, build, deps.isAllowedUrl, signal, etag);
      readHeader(await reader.read(0, HEADER_BYTES));
      const plan = { prefix: new Uint8Array(), fetches, bytes: build.bytes };
      planned = { build, plan, etag: reader.etag(), md5: build.md5 };
    } else {
      const reader = buildReader(deps.http, build, deps.isAllowedUrl, signal, etag);
      try {
        const plan = await planExtract({
          source: reader,
          ranges: regionRanges(target, DETAIL_MAX_ZOOM[detail]),
          bounds: regionTargetBounds(target),
          maxEntries,
        });
        planned = { build, plan, etag: reader.etag(), md5: null };
      } catch (failure) {
        if (failure instanceof PlanTooLarge) throw new RegionError("too-large", failure.message, { cause: failure });
        throw failure;
      }
    }
    cached = { key, planned };
    return planned;
  }

  async function estimate(id: string, detail: MapRegionDetail): Promise<MapRegionEstimate> {
    try {
      const { build, plan } = await planFor(id, detail, new AbortController().signal, null);
      return { ok: true, build: build.key, bytes: plan.bytes };
    } catch (failure) {
      return { ok: false, problem: problemOf(failure) };
    }
  }

  function download(id: string, detail: MapRegionDetail): MapRegionsView {
    if (job !== null && (job.state === "measuring" || job.state === "downloading")) return view();
    if (job !== null && (job.id !== id || job.detail !== detail)) removeJob(deps.userData, job.id);
    const next: Job = {
      id,
      detail,
      state: "measuring",
      received: 0,
      total: null,
      problem: null,
      controller: new AbortController(),
      done: Promise.resolve(),
    };
    next.done = run(next);
    job = next;
    return view();
  }

  async function run(current: Job): Promise<void> {
    const { signal } = current.controller;
    let handle: FileHandle | null = null;
    try {
      let record = readJob(deps.userData, current.id);
      if (record !== null && record.detail !== current.detail) {
        removeJob(deps.userData, current.id);
        record = null;
      }
      let planned: Planned;
      try {
        planned = await planFor(current.id, current.detail, signal, record);
      } catch (failure) {
        if (!(failure instanceof RegionError && failure.problem === "build-changed" && record !== null)) throw failure;
        // The build changed while the download was paused: its partial file is another build's bytes.
        removeJob(deps.userData, current.id);
        record = null;
        planned = await planFor(current.id, current.detail, signal, null);
      }
      const { build, plan, md5 } = planned;
      if (record !== null && record.build !== build.key) {
        removeJob(deps.userData, current.id);
        record = null;
      }
      current.total = plan.bytes;

      const part = partPath(deps.userData, current.id);
      const onDisk = record === null ? 0 : await sizeOf(part);
      const from = resumePoint(plan, onDisk);
      const needed = plan.bytes - from + SPACE_HEADROOM_BYTES;
      if ((await deps.freeSpaceBytes(mapsDir(deps.userData))) < needed) throw new RegionError("no-space");

      const reader = buildReader(deps.http, build, deps.isAllowedUrl, signal, planned.etag);
      writeJob(deps.userData, {
        id: current.id,
        detail: current.detail,
        build: build.key,
        etag: planned.etag,
        bytes: plan.bytes,
      });
      handle = await open(part, from === 0 ? "w" : "r+");
      await handle.truncate(from);
      const hash = md5 === null ? null : await hashOf(handle, from);
      current.state = "downloading";
      current.received = from;

      let position = 0;
      const write = async (bytes: Uint8Array) => {
        await (handle as FileHandle).write(bytes, 0, bytes.length, position);
        hash?.update(bytes);
        position += bytes.length;
        current.received = position;
      };
      // `from` is 0 or the end of a whole piece, so the walk lands on it exactly.
      if (from === 0) await write(plan.prefix);
      else position = plan.prefix.length;
      for (const fetch of plan.fetches) {
        const kept = keptBytes(fetch);
        if (position + kept <= from) {
          position += kept;
          continue;
        }
        if (signal.aborted) break;
        const bytes = await reader.read(fetch.offset, fetch.length);
        for (const [start, length] of fetch.keep) await write(bytes.subarray(start, start + length));
      }
      await handle.close();
      handle = null;
      if (signal.aborted) return;

      if (position !== plan.bytes) throw new RegionError("io", "The file is not the planned size.");
      if (hash !== null && hash.digest("hex") !== md5) {
        removeJob(deps.userData, current.id);
        throw new RegionError("hash");
      }
      await install(current, build.key, plan.bytes, part);
      job = job === current ? null : job;
      // A continent's plan holds every piece it keeps, and nothing reads it once its file is in place.
      cached = null;
    } catch (failure) {
      await handle?.close().catch(() => undefined);
      if (signal.aborted) return;
      const problem = problemOf(failure);
      if (problem === "build-changed") removeJob(deps.userData, current.id);
      current.state = "failed";
      current.problem = problem;
    }
  }

  async function install(current: Job, build: string, bytes: number, part: string): Promise<void> {
    const file = regionFileName(current.id, build, current.detail);
    try {
      await rename(part, join(mapsDir(deps.userData), file));
    } catch (failure) {
      throw new RegionError("io", "The region could not be put in place.", { cause: failure });
    }
    const others = readRegions(deps.userData).filter((row) => row.id !== current.id);
    writeRegions(deps.userData, [...others, { id: current.id, detail: current.detail, build, bytes, file }]);
    removeJob(deps.userData, current.id);
    sweepRegionFiles(deps.userData);
  }

  function pause(): MapRegionsView {
    if (job !== null && (job.state === "measuring" || job.state === "downloading")) {
      job.controller.abort();
      job.state = "paused";
    }
    return view();
  }

  async function cancel(): Promise<MapRegionsView> {
    if (job !== null) {
      const current = job;
      current.controller.abort();
      await current.done;
      removeJob(deps.userData, current.id);
      job = null;
    }
    return view();
  }

  async function remove(id: string): Promise<MapRegionsView> {
    if (job?.id === id && (job.state === "measuring" || job.state === "downloading")) return view();
    const rows = readRegions(deps.userData);
    const row = rows.find((each) => each.id === id);
    if (row !== undefined) {
      writeRegions(
        deps.userData,
        rows.filter((each) => each.id !== id),
      );
      await rm(join(mapsDir(deps.userData), row.file), { force: true }).catch(() => undefined);
    }
    return view();
  }

  return { view, estimate, download, pause, cancel, remove, idle: async () => job?.done };
}

/**
 * Where a resumed download continues: the end of the last whole piece the
 * partial file holds (the prefix, or a fetch's kept bytes), so a fetch is
 * always written whole from its start.
 */
export function resumePoint(plan: ExtractPlan, onDisk: number): number {
  if (onDisk < plan.prefix.length) return 0;
  let boundary = plan.prefix.length;
  for (const fetch of plan.fetches) {
    const next = boundary + keptBytes(fetch);
    if (next > onDisk) break;
    boundary = next;
  }
  return boundary;
}

function keptBytes(fetch: ExtractFetch): number {
  return fetch.keep.reduce((sum, [, length]) => sum + length, 0);
}

/** An MD5 over the first `length` bytes already in the file, ready to continue. */
async function hashOf(handle: FileHandle, length: number): Promise<Hash> {
  const hash = createHash("md5");
  const chunk = Buffer.alloc(Math.min(length, FETCH_MAX_BYTES));
  for (let position = 0; position < length; ) {
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, length - position), position);
    if (bytesRead === 0) break;
    hash.update(chunk.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash;
}

function sizeOfSync(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function problemOf(failure: unknown): RegionProblem {
  if (failure instanceof RegionError) return failure.problem;
  const code = (failure as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? "io" : "network";
}
