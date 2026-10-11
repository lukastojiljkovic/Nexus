import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  downloadStagingPath,
  type DownloadRequest,
  type DownloadService,
} from "../../download/service.js";
import type { ModelEntry } from "@nexus/core";
import {
  downloadJobId,
  importedId,
  importModel,
  installEntry,
  modelFilePath,
  modelsRoot,
  readInstalled,
  removeModel,
  type ModelsDeps,
} from "./install.js";
import { modelHeader, projectorHeader } from "./fixtures.js";

let userData: string;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-models-"));
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

/** One catalogue entry, with the bytes `installEntry` is told to expect. */
function entryOf(bytes: Uint8Array, overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "qwen3.5-4b-q4-k-m",
    origin: "catalogue",
    title: "Qwen3.5 4B (Q4_K_M)",
    family: "Qwen3.5",
    repo: "unsloth/Qwen3.5-4B-GGUF",
    file: "Qwen3.5-4B-Q4_K_M.gguf",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    quantization: "Q4_K_M",
    contextTokens: 262144,
    capabilities: ["chat", "tools"],
    languages: [],
    licence: { name: "Apache-2.0", url: "https://huggingface.co/Qwen/Qwen3.5-4B/blob/main/LICENSE" },
    ...overrides,
  };
}

/**
 * A stand-in for the download service: it writes the bytes where the real
 * service's staging file goes and answers with the outcome the real one would.
 *
 * The real service's own promises — the mode gate, the allowlist on every hop, the
 * hash computed while the file is written, the delete on a mismatch — belong to
 * `download/service.test.ts` and are not re-tested here. What IS tested here is
 * the half the service cannot know: the free-space check on the model's own
 * volume, the rename into `models/`, the registry, and what a pause means.
 */
function fakeService(options: {
  /** What `start` writes to the service's own staging path, when it should write anything. */
  readonly writes?: Uint8Array;
  /** What `start` answers. Defaults to the outcome a mismatched hash produces. */
  readonly outcome?: "done" | "paused" | "cancelled" | "refused-hash";
  /** What `resume` answers: `not-found` (the default) or a finished download. */
  readonly resume?: "not-found" | "done";
}): DownloadService & { readonly started: DownloadRequest[]; readonly resumed: string[]; readonly paused: string[] } {
  const started: DownloadRequest[] = [];
  const resumed: string[] = [];
  const paused: string[] = [];
  /** The service renames its staging file to this name once the digest matches. */
  const finalPath = (jobId: string): string => join(userData, "downloads", jobId);
  const finish = (
    request: DownloadRequest,
    kind: "done" | "paused" | "cancelled" | "refused-hash" = options.outcome ?? "refused-hash",
  ): Awaited<ReturnType<DownloadService["start"]>> => {
    const path = finalPath(request.id);
    if (options.writes !== undefined) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, options.writes);
    }
    switch (kind) {
      case "done":
        return { outcome: "done", id: request.id, path, bytes: options.writes?.byteLength ?? 0, sha256: request.expectedSha256 };
      case "paused":
        return {
          outcome: "paused",
          id: request.id,
          path: downloadStagingPath(userData, request.id),
          bytes: options.writes?.byteLength ?? 0,
        };
      case "cancelled":
        return { outcome: "cancelled", id: request.id };
      default:
        return { outcome: "refused", id: request.id, problem: "hash" };
    }
  };
  return {
    started,
    resumed,
    paused,
    start(request) {
      started.push(request);
      return Promise.resolve(finish(request));
    },
    resume(id) {
      resumed.push(id);
      if (options.resume === "done") {
        return Promise.resolve(
          finish({ id, url: "", expectedSha256: "0".repeat(64), sizeLimitBytes: 1 }, "done"),
        );
      }
      return Promise.resolve({ outcome: "refused", id, problem: "not-found" });
    },
    pause(id) {
      paused.push(id);
    },
    cancel() {
      return Promise.resolve();
    },
  };
}

function deps(service: DownloadService, options: { readonly mode?: "offline" | "downloads"; readonly free?: number } = {}): ModelsDeps {
  return {
    userData,
    mode: () => options.mode ?? "downloads",
    downloadFor: (_jobId, _onProgress) => service,
    freeBytes: () => Promise.resolve(options.free ?? 64 * 1024 * 1024 * 1024),
    now: () => 1_760_000_000_000,
  };
}

describe("installEntry", () => {
  it("moves a verified download into the model's own directory and records it", async () => {
    const bytes = Buffer.from("a model, for this test's purposes");
    const entry = entryOf(bytes);
    // The service writes its staging file and answers `done` for bytes it has
    // verified; this stand-in does the writing, at the path the service owns.
    const service = fakeService({ writes: bytes, outcome: "done" });
    const installed = await installEntry(deps(service), entry, () => undefined, new AbortController().signal);
    expect(installed.id).toBe(entry.id);
    expect(installed.installedAt).toBe(1_760_000_000_000);
    expect(existsSync(modelFilePath(userData, entry.id, entry.file))).toBe(true);
    expect(readInstalled(userData).map((model) => model.id)).toEqual([entry.id]);
    // The job id the service receives is one IT accepts: letters, digits, `_` and
    // `-` only, because the dotted catalogue id is not one.
    expect(service.started[0]?.id).toBe("qwen3_5-4b-q4-k-m");
    expect(service.started[0]?.expectedSha256).toBe(entry.sha256);
    expect(service.started[0]?.url).toBe(
      "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
    );
  });

  it("resumes a paused download instead of starting one", async () => {
    const bytes = Buffer.from("resumed");
    const entry = entryOf(bytes);
    const service = fakeService({ writes: bytes, resume: "done" });
    await installEntry(deps(service), entry, () => undefined, new AbortController().signal);
    expect(service.resumed).toEqual(["qwen3_5-4b-q4-k-m"]);
    expect(service.started).toEqual([]);
  });

  it("refuses outside the downloads mode before the service is asked", async () => {
    const service = fakeService({});
    await expect(
      installEntry(deps(service, { mode: "offline" }), entryOf(Buffer.from("x")), () => undefined, new AbortController().signal),
    ).rejects.toThrow(/downloads network mode/);
    expect(service.started).toEqual([]);
  });

  it("checks the disk before asking for a byte", async () => {
    const bytes = Buffer.from("a model that will not fit");
    const service = fakeService({});
    await expect(
      installEntry(deps(service, { free: 1024 }), entryOf(bytes), () => undefined, new AbortController().signal),
    ).rejects.toThrow(/volume holds 1024 bytes/);
    expect(service.started).toEqual([]);
  });

  it("carries the service's refusal through as the runtime's own code", async () => {
    const bytes = Buffer.from("tampered");
    const entry = entryOf(bytes);
    const bad = fakeService({ outcome: "refused-hash" });
    await expect(
      installEntry(deps(bad), entry, () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: "hash" });
    expect(existsSync(modelFilePath(userData, entry.id, entry.file))).toBe(false);
    expect(readInstalled(userData)).toEqual([]);
  });

  it("treats a paused download as an abort, and keeps the registry clean", async () => {
    const bytes = Buffer.from("half a model");
    const entry = entryOf(bytes);
    const controller = new AbortController();
    const service = fakeService({ writes: bytes, outcome: "paused" });
    await expect(installEntry(deps(service), entry, () => undefined, controller.signal)).rejects.toMatchObject({
      code: "aborted",
    });
    expect(readInstalled(userData)).toEqual([]);
  });
});

describe("importModel", () => {
  it("registers a file in place, with the hash and the licence its header states", async () => {
    const path = join(userData, "from-disk.gguf");
    const bytes = Buffer.from(modelHeader());
    writeFileSync(path, bytes);
    const installed = await importModel(deps(fakeService({})), path);

    expect(installed.origin).toBe("file");
    expect(installed.path).toBe(path);
    expect(installed.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(installed.sizeBytes).toBe(bytes.byteLength);
    expect(installed.family).toBe("qwen3");
    expect(installed.contextTokens).toBe(32768);
    expect(installed.capabilities).toEqual(["chat"]);
    expect(installed.licence).toEqual({ name: "apache-2.0", url: "https://example.org/licence" });
    expect(installed.id).toBe(`imported-from-disk-${installed.sha256.slice(0, 8)}`);
    expect(readInstalled(userData).map((model) => model.id)).toEqual([installed.id]);
    // In place: nothing was copied into `models/`.
    expect(existsSync(join(modelsRoot(userData), installed.id))).toBe(false);
  });

  it("refuses a projector, so a user cannot import half of a vision model", async () => {
    const path = join(userData, "mmproj-F16.gguf");
    writeFileSync(path, Buffer.from(projectorHeader()));
    await expect(importModel(deps(fakeService({})), path)).rejects.toMatchObject({ code: "not-a-gguf" });
    expect(readInstalled(userData)).toEqual([]);
  });

  it("refuses a file that is not a GGUF at all", async () => {
    const path = join(userData, "notes.txt");
    writeFileSync(path, Buffer.from("just a text file"));
    await expect(importModel(deps(fakeService({})), path)).rejects.toMatchObject({ code: "not-a-gguf" });
    const missing = join(userData, "gone.gguf");
    await expect(importModel(deps(fakeService({})), missing)).rejects.toMatchObject({ code: "io" });
  });
});

describe("removeModel", () => {
  it("deletes a downloaded model's own directory and forgets it", async () => {
    const bytes = Buffer.from("downloaded");
    const entry = entryOf(bytes);
    const service = fakeService({ writes: bytes, outcome: "done" });
    const models = deps(service);
    await installEntry(models, entry, () => undefined, new AbortController().signal);
    expect(existsSync(join(modelsRoot(userData), entry.id))).toBe(true);

    removeModel(models, entry.id);
    expect(existsSync(join(modelsRoot(userData), entry.id))).toBe(false);
    expect(readInstalled(userData)).toEqual([]);
  });

  it("forgets an imported file and NEVER deletes it", async () => {
    const path = join(userData, "my-model.gguf");
    writeFileSync(path, Buffer.from(modelHeader()));
    const models = deps(fakeService({}));
    const installed = await importModel(models, path);

    removeModel(models, installed.id);
    expect(readInstalled(userData)).toEqual([]);
    // The user chose this file; deleting it is the one thing this app must never
    // do to data it did not create.
    expect(existsSync(path)).toBe(true);
  });

  it("does nothing for an id that is not installed", () => {
    expect(() => removeModel(deps(fakeService({})), "nobody")).not.toThrow();
  });
});

describe("the installed registry", () => {
  it("tolerates a corrupt entry and a corrupt file rather than failing to load a model", () => {
    const path = join(modelsRoot(userData), "installed.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1, models: [{ id: "nonsense" }] }));
    expect(readInstalled(userData)).toEqual([]);
    writeFileSync(path, "{ this is not json");
    expect(readInstalled(userData)).toEqual([]);
    rmSync(path);
    expect(readInstalled(userData)).toEqual([]);
  });
});

describe("downloadJobId", () => {
  it("turns a dotted catalogue id into one the service accepts", () => {
    expect(downloadJobId("qwen3.5-27b-q4-k-m")).toBe("qwen3_5-27b-q4-k-m");
    expect(downloadJobId("a".repeat(80)).length).toBe(64);
    // A path-shaped string cannot survive as a job id: every separator becomes an
    // underscore, so `..` segments lose their meaning on the way in.
    expect(downloadJobId("imported-x/../../etc")).toBe("imported-x_______etc");
  });
});

describe("importedId", () => {
  it("keeps the file's name, bounded, with the hash for uniqueness", () => {
    const id = importedId("Slava-Qwen3-14B-Serbian.Q4_K_M.gguf", "4830f466f42dab12".padEnd(64, "0"));
    expect(id).toBe("imported-slava-qwen3-14b-serbian-q4-k-m-4830f466");
    expect(importedId(".gguf", "a".repeat(64))).toBe(`imported-model-${"a".repeat(8)}`);
    expect(id.length).toBeLessThanOrEqual(64);
  });
});

