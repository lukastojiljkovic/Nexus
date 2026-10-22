/**
 * The regions on this machine, and the record of a paused download (ADR-118).
 *
 * Everything lives in `<userData>/maps/`: `regions.json`, one PMTiles file per
 * region, and while a download is unfinished its `<stem>.part` and
 * `<stem>.job.json`. A region's file is named by its id, build and detail
 * (`srb.20261022.full.pmtiles`), so an update writes a new file beside the old
 * one and the registry switches to it; the old file is deleted then, or by the
 * next sweep when the map still had it open.
 *
 * **Read back, never trusted.** A row is kept only when its id is a region the
 * outline names, its detail is one of the three, and its file is exactly the
 * name those make, so a hand-edited registry cannot point the map's protocol
 * at a file outside this folder. Anything else reads as not installed.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MAP_REGION_DETAILS, type MapRegionDetail, type MapRegionView } from "../../shared/ipc.js";
import { regionFileStem, regionTarget } from "./targets.js";

/** A row of `regions.json`. The view's `url` is not stored: it is the file's, made when the view is. */
export interface InstalledRegion extends Omit<MapRegionView, "url"> {
  /** The file's name in the maps folder. */
  readonly file: string;
}

/** What a resumed download must match to append to its partial file. */
export interface RegionJobRecord {
  readonly id: string;
  readonly detail: MapRegionDetail;
  readonly build: string;
  /** The build's `ETag` when the download began, or `null` before the first answer. */
  readonly etag: string | null;
  /** The finished file's size, from the plan. */
  readonly bytes: number;
}

const BUILD_PATTERN = /^\d{8}$/;

const JOB_SUFFIX = ".job.json";

export function mapsDir(userData: string): string {
  return join(userData, "maps");
}

export function regionFileName(id: string, build: string, detail: MapRegionDetail): string {
  return `${regionFileStem(id)}.${build}.${detail}.pmtiles`;
}

export function partPath(userData: string, id: string): string {
  return join(mapsDir(userData), `${regionFileStem(id)}.part`);
}

function registryPath(userData: string): string {
  return join(mapsDir(userData), "regions.json");
}

function jobPath(userData: string, id: string): string {
  return join(mapsDir(userData), `${regionFileStem(id)}${JOB_SUFFIX}`);
}

export function readRegions(userData: string): InstalledRegion[] {
  const document = readJson(registryPath(userData));
  const rows = (document as { regions?: unknown } | null)?.regions;
  return Array.isArray(rows) ? rows.flatMap((row: unknown) => (isInstalled(row) ? [row] : [])) : [];
}

export function writeRegions(userData: string, regions: readonly InstalledRegion[]): void {
  writeAtomically(registryPath(userData), { regions });
}

export function readJob(userData: string, id: string): RegionJobRecord | null {
  const record = readJson(jobPath(userData, id));
  if (typeof record !== "object" || record === null) return null;
  const { detail, build, etag, bytes } = record as Record<string, unknown>;
  const valid =
    (record as Record<string, unknown>)["id"] === id &&
    regionTarget(id) !== null &&
    isDetail(detail) &&
    typeof build === "string" &&
    BUILD_PATTERN.test(build) &&
    (etag === null || typeof etag === "string") &&
    isSize(bytes);
  return valid ? { id, detail, build, etag, bytes } : null;
}

/** Every download a record says is unfinished, by the id inside each record. */
export function readJobs(userData: string): RegionJobRecord[] {
  return folderNames(userData).flatMap((name) => {
    if (!name.endsWith(JOB_SUFFIX)) return [];
    const id = (readJson(join(mapsDir(userData), name)) as { id?: unknown } | null)?.id;
    const record = typeof id === "string" ? readJob(userData, id) : null;
    // The record must be the one its own id names, so two files cannot claim one region.
    return record !== null && `${regionFileStem(record.id)}${JOB_SUFFIX}` === name ? [record] : [];
  });
}

export function writeJob(userData: string, job: RegionJobRecord): void {
  writeAtomically(jobPath(userData, job.id), job);
}

/** Forgets a download: its record and its partial file. */
export function removeJob(userData: string, id: string): void {
  rmSync(jobPath(userData, id), { force: true });
  rmSync(partPath(userData, id), { force: true });
}

/** Deletes every region file the registry does not name: an update's old file that was still open when it was replaced. */
export function sweepRegionFiles(userData: string): void {
  const named = new Set(readRegions(userData).map((region) => region.file));
  for (const name of folderNames(userData)) {
    if (!name.endsWith(".pmtiles") || named.has(name)) continue;
    try {
      rmSync(join(mapsDir(userData), name), { force: true });
    } catch {
      // Still open; the next sweep takes it.
    }
  }
}

function folderNames(userData: string): string[] {
  try {
    return readdirSync(mapsDir(userData));
  } catch {
    return [];
  }
}

function isInstalled(row: unknown): row is InstalledRegion {
  if (typeof row !== "object" || row === null) return false;
  const { id, detail, build, bytes, file } = row as Record<string, unknown>;
  return (
    typeof id === "string" &&
    regionTarget(id) !== null &&
    isDetail(detail) &&
    typeof build === "string" &&
    BUILD_PATTERN.test(build) &&
    isSize(bytes) &&
    file === regionFileName(id, build, detail)
  );
}

function isDetail(value: unknown): value is MapRegionDetail {
  return (MAP_REGION_DETAILS as readonly unknown[]).includes(value);
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Writes beside the target and renames over it, so a crash leaves the old file or the new one, never half of one. */
function writeAtomically(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const staging = `${path}.tmp`;
  writeFileSync(staging, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(staging, path);
}
