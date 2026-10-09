import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { UpdateStateView } from "../../shared/ipc.js";
import type { NetworkMode } from "../net/offline.js";
import {
  RELEASES_PAGE_URL,
  SHA256SUMS_ASSET,
  SHA256SUMS_SIGNATURE_ASSET,
} from "./release.js";
import { createUpdateService, isAutomaticCheckDue, type UpdateHttp } from "./service.js";

const INSTALLER = "Nexus-Setup-1.5.0.exe";

let userData: string;
let pair: ReturnType<typeof generateKeyPairSync>;
let publicKeyPem: string;
let installerBytes: Uint8Array;
let sumsText: string;
let sumsBytes: Uint8Array;
let signatureBytes: Uint8Array;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-update-"));
  pair = generateKeyPairSync("ed25519");
  publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  installerBytes = new TextEncoder().encode("this stands in for an installer");
  const hash = createHash("sha256").update(installerBytes).digest("hex");
  sumsText = `${hash}  ${INSTALLER}\n`;
  sumsBytes = new TextEncoder().encode(sumsText);
  signatureBytes = new Uint8Array(sign(null, sumsBytes, pair.privateKey));
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

function releaseBody(): unknown {
  const prefix = "https://github.com/lukastojiljkovic/Nexus/releases/download/v1.5.0/";
  return {
    tag_name: "v1.5.0",
    body: "Nove mogućnosti",
    html_url: "https://github.com/lukastojiljkovic/Nexus/releases/tag/v1.5.0",
    assets: [
      { name: INSTALLER, browser_download_url: `${prefix}${INSTALLER}` },
      { name: SHA256SUMS_ASSET, browser_download_url: `${prefix}${SHA256SUMS_ASSET}` },
      {
        name: SHA256SUMS_SIGNATURE_ASSET,
        browser_download_url: `${prefix}${SHA256SUMS_SIGNATURE_ASSET}`,
      },
    ],
  };
}

interface Harness {
  readonly service: ReturnType<typeof createUpdateService>;
  readonly calls: {
    json: number;
    bytes: number;
    download: number;
    openPath: string[];
    quit: number;
  };
  readonly changes: UpdateStateView[];
}

function harness(options: {
  mode?: NetworkMode;
  json?: UpdateHttp["json"];
  bytes?: UpdateHttp["bytes"];
  download?: UpdateHttp["download"];
  currentVersion?: string;
  platform?: NodeJS.Platform;
  now?: () => number;
}): Harness {
  const calls = { json: 0, bytes: 0, download: 0, openPath: [] as string[], quit: 0 };
  const changes: UpdateStateView[] = [];
  const http: UpdateHttp = {
    json: async (url, headers) => {
      calls.json += 1;
      if (options.json !== undefined) return options.json(url, headers);
      return { status: 200, body: releaseBody() };
    },
    bytes: async (url) => {
      calls.bytes += 1;
      if (options.bytes !== undefined) return options.bytes(url);
      if (url.endsWith(SHA256SUMS_ASSET)) return { status: 200, body: sumsBytes };
      return { status: 200, body: signatureBytes };
    },
    download: async (url, destination) => {
      calls.download += 1;
      if (options.download !== undefined) return options.download(url, destination);
      writeFileSync(destination, installerBytes);
      return {
        status: 200,
        sha256: createHash("sha256").update(installerBytes).digest("hex"),
      };
    },
  };
  const service = createUpdateService({
    currentVersion: options.currentVersion ?? "1.4.0",
    platform: options.platform ?? "win32",
    userData,
    mode: () => options.mode ?? "updates",
    http,
    publicKeyPem,
    openPath: async (path) => {
      calls.openPath.push(path);
      return "";
    },
    quit: () => {
      calls.quit += 1;
    },
    now: options.now ?? (() => 1_800_000_000_000),
    onChanged: (view) => changes.push(view),
  });
  return { service, calls, changes };
}

describe("the automatic check", () => {
  it("is silent on a rate limit — no error is ever surfaced", async () => {
    const { service, calls, changes } = harness({
      json: async () => ({ status: 429, body: null }),
    });
    await service.autoCheckIfDue();
    const view = service.view();
    expect(view.problem).toBeNull();
    expect(view.phase).toBe("idle");
    expect(view.offer).toBeNull();
    // The attempt still happened and was recorded, so it is not retried on
    // every launch.
    expect(calls.json).toBe(1);
    expect(view.lastCheckedAt).not.toBeNull();
    expect(changes.at(-1)?.problem).toBeNull();
  });

  it("is silent on a network failure too", async () => {
    const { service } = harness({
      json: async () => {
        throw new Error("no route to host");
      },
    });
    await service.autoCheckIfDue();
    expect(service.view().problem).toBeNull();
    expect(service.view().phase).toBe("idle");
  });

  it("runs at most once a day", async () => {
    const { service, calls } = harness({ now: () => 1_800_000_000_000 });
    await service.autoCheckIfDue();
    expect(calls.json).toBe(1);
    await service.autoCheckIfDue();
    // Still once: the second call is not due.
    expect(calls.json).toBe(1);
  });

  it("does nothing at all in offline mode", async () => {
    const { service, calls } = harness({ mode: "offline" });
    await service.autoCheckIfDue();
    expect(calls.json).toBe(0);
    expect(service.view().mode).toBe("offline");
  });

  it("still runs in downloads mode", async () => {
    // ADR-092's superset order, and the assertion that keeps the third mode
    // from quietly taking the check away from a user who chose the wider one:
    // `"downloads"` allows everything `"updates"` allows.
    const { service, calls } = harness({ mode: "downloads" });
    await service.autoCheckIfDue();
    expect(calls.json).toBe(1);
    expect(service.view().mode).toBe("downloads");
  });
});

describe("the manual check", () => {
  it("reports a rate limit", async () => {
    const { service } = harness({ json: async () => ({ status: 403, body: null }) });
    const view = await service.checkNow();
    expect(view.phase).toBe("error");
    expect(view.problem).toBe("rate-limited");
    // The release-page link is always present, so the error is actionable.
    expect(view.releaseUrl).toBe(RELEASES_PAGE_URL);
  });

  it("offers the version and notes when there is a newer release", async () => {
    const { service } = harness({});
    const view = await service.checkNow();
    expect(view.phase).toBe("available");
    expect(view.problem).toBeNull();
    expect(view.offer?.version).toBe("v1.5.0");
    expect(view.offer?.notes).toContain("mogućnosti");
    expect(view.offer?.canInstall).toBe(true);
    // Crucially, the check downloaded nothing.
    expect(service.view().offer).not.toBeNull();
  });

  it("names a missing Windows installer as `asset` but still shows the version", async () => {
    const { service } = harness({
      json: async () => ({
        status: 200,
        body: { tag_name: "v1.5.0", body: "notes", assets: [] },
      }),
    });
    const view = await service.checkNow();
    expect(view.phase).toBe("error");
    expect(view.problem).toBe("asset");
  });

  it("surfaces nothing but a problem when the mode is offline", async () => {
    const { service, calls } = harness({ mode: "offline" });
    const view = await service.checkNow();
    expect(view.phase).toBe("error");
    expect(view.problem).toBe("unexpected");
    expect(calls.json).toBe(0);
  });
});

describe("installing", () => {
  it("verifies the signature and hash, launches, and quits", async () => {
    const { service, calls } = harness({});
    await service.checkNow();
    const view = await service.install();
    expect(view.phase).not.toBe("error");
    expect(calls.bytes).toBe(2);
    expect(calls.download).toBe(1);
    expect(calls.openPath).toHaveLength(1);
    expect(calls.openPath[0]).toContain(join("updates", "Nexus-Setup-1.5.0-"));
    expect(calls.quit).toBe(1);
  });

  it("refuses to install, and downloads nothing, when the signature does not verify", async () => {
    const { service, calls } = harness({
      bytes: async (url) =>
        url.endsWith(SHA256SUMS_ASSET)
          ? { status: 200, body: sumsBytes }
          : { status: 200, body: new Uint8Array([9, 9, 9]) },
    });
    await service.checkNow();
    const view = await service.install();
    expect(view.problem).toBe("signature");
    expect(calls.download).toBe(0);
    expect(calls.quit).toBe(0);
  });

  it("refuses when SHA256SUMS.txt lists no line for the installer", async () => {
    const emptySums = new TextEncoder().encode("");
    const sig = new Uint8Array(sign(null, emptySums, pair.privateKey));
    const { service, calls } = harness({
      bytes: async (url) =>
        url.endsWith(SHA256SUMS_ASSET)
          ? { status: 200, body: emptySums }
          : { status: 200, body: sig },
    });
    await service.checkNow();
    const view = await service.install();
    expect(view.problem).toBe("hash");
    expect(calls.download).toBe(0);
  });

  it("DELETES the file when the streamed hash does not match", async () => {
    let written: string | null = null;
    const { service } = harness({
      download: async (_url, destination) => {
        written = destination;
        writeFileSync(destination, installerBytes);
        return { status: 200, sha256: "0".repeat(64) };
      },
    });
    await service.checkNow();
    const view = await service.install();
    expect(view.problem).toBe("hash");
    expect(written).not.toBeNull();
    expect(existsSync(written as unknown as string)).toBe(false);
  });

  it("DELETES the partial file when the download throws, and reports it as a network problem", async () => {
    // What a limit crossed or an idle deadline looks like from the service's
    // side: the port throws after the bytes started landing. The file must go
    // and the problem must be the same one a refused connection produces.
    let written: string | null = null;
    const { service } = harness({
      download: async (_url, destination) => {
        written = destination;
        writeFileSync(destination, installerBytes);
        throw new Error("aborted mid-download");
      },
    });
    await service.checkNow();
    const view = await service.install();
    expect(view.problem).toBe("network");
    expect(written).not.toBeNull();
    expect(existsSync(written as unknown as string)).toBe(false);
  });

  it("DELETES the file when the pre-launch re-hash disagrees", async () => {
    // The streamed hash matches what the signed file lists, but the file on
    // disk is not the bytes that were hashed — the exact case the third
    // verification exists for. `download` returns the hash of the ORIGINAL
    // bytes and then leaves different bytes on disk.
    let written: string | null = null;
    const { service } = harness({
      download: async (_url, destination) => {
        written = destination;
        writeFileSync(destination, installerBytes);
        const streamed = createHash("sha256").update(installerBytes).digest("hex");
        writeFileSync(destination, new TextEncoder().encode("tampered after hashing"));
        return { status: 200, sha256: streamed };
      },
    });
    await service.checkNow();
    const view = await service.install();
    expect(view.problem).toBe("hash");
    expect(existsSync(written as unknown as string)).toBe(false);
  });
});

describe("the once-a-day rule", () => {
  it("is due when there is no record, and not due inside the window", () => {
    expect(isAutomaticCheckDue(null, 1_800_000_000_000)).toBe(true);
    expect(isAutomaticCheckDue(1_800_000_000_000, 1_800_000_000_000 + 23 * 3600_000)).toBe(false);
    expect(isAutomaticCheckDue(1_800_000_000_000, 1_800_000_000_000 + 24 * 3600_000)).toBe(true);
  });

  it("treats a timestamp in the future as due rather than as a lock", () => {
    expect(isAutomaticCheckDue(1_800_000_000_000, 1_700_000_000_000)).toBe(true);
  });
});
