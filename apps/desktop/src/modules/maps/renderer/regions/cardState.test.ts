import { describe, expect, it } from "vitest";

import type { MapRegionJobView, MapRegionView, MapRegionsView } from "../../shared/ipc.js";
import { formatBuild, formatBytes, otherDownload, regionCardState } from "./cardState.js";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function installed(id: string, build = "20261001"): MapRegionView {
  return { id, detail: "towns", build, bytes: 4 * MB, url: `nx-map://region/${id}.pmtiles` };
}

function job(over: Partial<MapRegionJobView> = {}): MapRegionJobView {
  return {
    id: "SRB",
    detail: "towns",
    state: "downloading",
    receivedBytes: 0,
    totalBytes: null,
    problem: null,
    ...over,
  };
}

function view(over: Partial<MapRegionsView> = {}): MapRegionsView {
  return { installed: [], job: null, newestBuild: null, ...over };
}

describe("regionCardState", () => {
  it("is absent when nothing is installed and no job runs for the scope", () => {
    expect(regionCardState("SRB", view())).toEqual({ kind: "absent" });
  });

  it("is installed with the region when the scope is on disk", () => {
    const region = installed("SRB");
    expect(regionCardState("SRB", view({ installed: [region], newestBuild: "20261001" }))).toEqual({
      kind: "installed",
      region,
      update: false,
    });
  });

  it("is not an update when the list named no build", () => {
    const state = regionCardState("SRB", view({ installed: [installed("SRB")], newestBuild: null }));
    expect(state).toMatchObject({ kind: "installed", update: false });
  });

  it("is an update when the list names a newer build than the installed one", () => {
    const state = regionCardState(
      "SRB",
      view({ installed: [installed("SRB", "20261001")], newestBuild: "20261022" }),
    );
    expect(state).toMatchObject({ kind: "installed", update: true });
  });

  it("shows a job for the scope in place of an installed row, so an update in flight reads as its job", () => {
    const state = regionCardState(
      "SRB",
      view({ installed: [installed("SRB")], job: job({ receivedBytes: 1, totalBytes: 4 }) }),
    );
    expect(state).toEqual({ kind: "downloading", job: job({ receivedBytes: 1, totalBytes: 4 }), percent: 25 });
  });

  it.each(["measuring", "downloading", "paused"] as const)("is %s for a job in that state", (state) => {
    const current = job({ state, receivedBytes: 1, totalBytes: 2 });
    expect(regionCardState("SRB", view({ job: current }))).toEqual({ kind: state, job: current, percent: 50 });
  });

  it("is failed for a failed job of the scope, and keeps its problem", () => {
    const current = job({ state: "failed", problem: "hash" });
    expect(regionCardState("SRB", view({ job: current }))).toEqual({ kind: "failed", job: current });
  });

  it("ignores a job for another id", () => {
    const other = job({ id: "continent:Europe", state: "downloading" });
    expect(regionCardState("SRB", view({ job: other, installed: [installed("SRB")] }))).toMatchObject({
      kind: "installed",
    });
    expect(regionCardState("SRB", view({ job: other }))).toEqual({ kind: "absent" });
  });
});

describe("regionCardState percent", () => {
  it.each([
    [1, 3, 33],
    [3, 3, 100],
    [5, 3, 100],
    [0, 3, 0],
    [1, 0, 0],
    [1, null, 0],
  ] as const)("received %i of total %s is %i percent", (received, total, percent) => {
    const state = regionCardState("SRB", view({ job: job({ state: "downloading", receivedBytes: received, totalBytes: total }) }));
    expect(state).toMatchObject({ percent });
  });
});

describe("otherDownload", () => {
  it("is the job of another id while it measures or downloads", () => {
    const measuring = job({ id: "continent:Europe", state: "measuring" });
    const downloading = job({ id: "continent:Europe", state: "downloading" });
    expect(otherDownload("SRB", view({ job: measuring }))).toBe(measuring);
    expect(otherDownload("SRB", view({ job: downloading }))).toBe(downloading);
  });

  it("is null for a paused or failed job of another id", () => {
    expect(otherDownload("SRB", view({ job: job({ id: "world", state: "paused" }) }))).toBeNull();
    expect(otherDownload("SRB", view({ job: job({ id: "world", state: "failed" }) }))).toBeNull();
  });

  it("is null for a job of the scope itself, and when no job runs", () => {
    expect(otherDownload("SRB", view({ job: job({ state: "downloading" }) }))).toBeNull();
    expect(otherDownload("SRB", view())).toBeNull();
  });
});

describe("formatBytes", () => {
  it("writes bytes below a kilobyte in bytes", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(KB - 1, "en")).toBe("1,023 B");
  });

  it("writes kilobytes from a kilobyte, with no decimals", () => {
    expect(formatBytes(KB, "en")).toBe("1 KB");
    expect(formatBytes(1.5 * KB, "en")).toBe("2 KB");
  });

  it("writes megabytes from a megabyte, with no decimals", () => {
    expect(formatBytes(MB, "sr")).toBe("1 MB");
    expect(formatBytes(12.4 * MB, "en")).toBe("12 MB");
  });

  it("writes gigabytes from a gigabyte, with one decimal, in the reader's number format", () => {
    expect(formatBytes(GB, "en")).toBe("1.0 GB");
    expect(formatBytes(1.5 * GB, "sr")).toBe("1,5 GB");
  });

  it("writes a value just below a threshold in the smaller unit, unless it rounds up to the threshold", () => {
    expect(formatBytes(GB - MB, "en")).toBe("1,023 MB");
    expect(formatBytes(GB - 1, "en")).toBe("1.0 GB");
    expect(formatBytes(MB - 1, "en")).toBe("1 MB");
  });
});

describe("formatBuild", () => {
  it("writes the build's UTC day in the reader's language", () => {
    expect(formatBuild("20261022", "en")).toBe("October 22, 2026");
    expect(formatBuild("20261022", "sr")).toBe("22. oktobar 2026.");
  });
});
