import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { modeAllowsUpdates, type NetworkMode } from "../net/offline.js";
import type { UpdateProblem, UpdatePhase, UpdateStateView } from "../../shared/ipc.js";
import { checksumFor, parseSha256Sums } from "./checksums.js";
import {
  decideRelease,
  installerAssetName,
  isAllowedReleaseAssetUrl,
  parseRelease,
  RELEASE_API_URL,
  RELEASES_PAGE_URL,
  SHA256SUMS_ASSET,
  SHA256SUMS_SIGNATURE_ASSET,
  type InstallableOffer,
  type Release,
} from "./release.js";
import { sha256Hex, verifyDetachedSignature } from "./verify.js";

/**
 * The update check as a service with every effect injected.
 *
 * This module imports no Electron and touches no session: the dedicated
 * network session, the installer launch (`update/launch.ts`) and `app.quit()`
 * arrive as functions from `index.ts`. That is what makes the interesting half
 * testable without a browser process: a rate-limited automatic check staying
 * silent, a hash mismatch deleting its file, a signature that does not verify
 * refusing to install.
 *
 * ADR-089 is the contract, and the two load-bearing sentences are enforced
 * here rather than in copy: nothing is downloaded until `install()` is called
 * (a check fetches the small JSON and nothing else), and not one byte of the
 * installer is trusted twice — the streamed hash and a second hash taken
 * immediately before launch must both match the signed `SHA256SUMS.txt`.
 */

/** One automatic check per day, and the file that remembers when the last one was. */
export const AUTOMATIC_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const STATE_FILE = "last-check.json";

export interface UpdateHttp {
  json(
    url: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
  bytes(url: string): Promise<{ readonly status: number; readonly body: Uint8Array }>;
  download(
    url: string,
    destination: string,
  ): Promise<{ readonly status: number; readonly sha256: string }>;
}

export interface UpdateServiceDeps {
  readonly currentVersion: string;
  readonly platform: NodeJS.Platform;
  readonly userData: string;
  /**
   * The mode this launch may act on. `"downloads"` (ADR-092) allows the check
   * too, because the modes are a superset chain, so every guard below asks
   * `modeAllowsUpdates` rather than comparing against `"updates"`.
   */
  readonly mode: () => NetworkMode;
  readonly http: UpdateHttp;
  readonly publicKeyPem: string;
  /**
   * Starts the verified installer and answers the way `shell.openPath` did: an
   * empty string once the process exists, a message when it does not. It is
   * never called with anything but the file this service downloaded, hashed
   * while streaming and hashed again a moment ago.
   */
  readonly launchInstaller: (path: string) => Promise<string>;
  readonly quit: () => void;
  readonly now: () => number;
  readonly onChanged: (view: UpdateStateView) => void;
}

export interface UpdateService {
  view(): UpdateStateView;
  /** Runs an automatic check only when the mode allows it AND a day has passed. Never throws. */
  autoCheckIfDue(): Promise<void>;
  /** The „Proveri sada" button. Reports rate limits and network failures. */
  checkNow(): Promise<UpdateStateView>;
  /** Downloads, verifies, launches and quits. Only after the user pressed Install. */
  install(): Promise<UpdateStateView>;
}

type CheckSource = "auto" | "manual";

function statePath(userData: string): string {
  return join(userData, "updates", STATE_FILE);
}

function readLastCheckedAt(userData: string): number | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(userData), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = (parsed as { lastCheckedAt?: unknown }).lastCheckedAt;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLastCheckedAt(userData: string, at: number): void {
  try {
    const path = statePath(userData);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ lastCheckedAt: at }, null, 2)}\n`, "utf8");
  } catch {
    // A check that ran and could not remember when is a check that runs again;
    // it must never take the app down or make the user's button fail.
  }
}

/**
 * Whether the automatic check is owed. A timestamp in the future (a clock that
 * moved backwards, a copied profile directory) is treated as DUE rather than as
 * a lock that lasts until wall time catches up.
 */
export function isAutomaticCheckDue(lastCheckedAt: number | null, now: number): boolean {
  if (lastCheckedAt === null) return true;
  if (lastCheckedAt > now) return true;
  return now - lastCheckedAt >= AUTOMATIC_CHECK_INTERVAL_MS;
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  let phase: UpdatePhase = "idle";
  let problem: UpdateProblem | null = null;
  let pending: InstallableOffer | null = null;
  let pendingRelease: Release | null = null;
  let lastCheckedAt = readLastCheckedAt(deps.userData);

  function offerForWire(): UpdateStateView["offer"] {
    if (pending === null) return null;
    return {
      version: pending.version,
      notes: pending.notes,
      canInstall: pending.installer !== null,
    };
  }

  function view(): UpdateStateView {
    return {
      mode: deps.mode(),
      phase,
      offer: offerForWire(),
      problem,
      releaseUrl: RELEASES_PAGE_URL,
      lastCheckedAt,
    };
  }

  function emit(): void {
    deps.onChanged(view());
  }

  /** Records the attempt and lands the check. Every path out of `runCheck` goes through here. */
  function conclude(source: CheckSource, value: UpdateProblem | null, okPhase: UpdatePhase): UpdateStateView {
    lastCheckedAt = deps.now();
    writeLastCheckedAt(deps.userData, lastCheckedAt);
    if (value !== null && source === "manual") {
      phase = "error";
      problem = value;
    } else {
      // An automatic failure is silent by product decision (ADR-089 §2): no
      // error is reported, and the state stays whatever it was.
      phase = value !== null ? "idle" : okPhase;
      problem = null;
    }
    emit();
    return view();
  }

  function fail(value: UpdateProblem, filePath: string | null = null): UpdateStateView {
    if (filePath !== null) {
      try {
        rmSync(filePath, { force: true });
      } catch {
        // Best effort: the file is already refused, and a delete that failed
        // must not hide the verification failure that caused it.
      }
    }
    phase = "error";
    problem = value;
    emit();
    return view();
  }

  async function runCheck(source: CheckSource): Promise<UpdateStateView> {
    if (!modeAllowsUpdates(deps.mode())) {
      // Unreachable through the UI — the button is hidden and the startup check
      // is gated — but answered the same way either way: no request.
      return conclude(source, "unexpected", "idle");
    }
    phase = "checking";
    problem = null;
    emit();

    let response: { readonly status: number; readonly body: unknown };
    try {
      response = await deps.http.json(RELEASE_API_URL, {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      });
    } catch {
      return conclude(source, "network", "idle");
    }
    // 403 and 429 are the two the API answers when the caller is being
    // rate-limited; both are ordinary on a shared address and both are silent
    // on the automatic run.
    if (response.status === 403 || response.status === 429) {
      return conclude(source, "rate-limited", "idle");
    }
    if (response.status !== 200) return conclude(source, "unexpected", "idle");

    const release = parseRelease(response.body);
    if (release === null) return conclude(source, "unexpected", "idle");
    const decision = decideRelease(release, deps.currentVersion, deps.platform);
    if (decision.kind === "undecidable") return conclude(source, "unexpected", "idle");
    if (decision.kind === "up-to-date") {
      pending = null;
      pendingRelease = null;
      return conclude(source, null, "up-to-date");
    }
    pending = decision.offer;
    pendingRelease = release;
    // A Windows release with no installer this build will fetch is still shown
    // — version, notes and the release page — but the Install button is refused
    // by main, and the reason is named.
    const assetProblem = deps.platform === "win32" && decision.offer.installer === null ? "asset" : null;
    return conclude(source, assetProblem, "available");
  }

  function assetByName(release: Release, name: string): string | null {
    const found = release.assets.find((asset) => asset.name === name);
    if (found === undefined || !isAllowedReleaseAssetUrl(found.url)) return null;
    return found.url;
  }

  async function install(): Promise<UpdateStateView> {
    const release = pendingRelease;
    const offer = pending;
    if (
      !modeAllowsUpdates(deps.mode()) ||
      release === null ||
      offer === null ||
      offer.installer === null
    ) {
      return fail("asset");
    }

    phase = "downloading";
    problem = null;
    emit();

    const sumsUrl = assetByName(release, SHA256SUMS_ASSET);
    const signatureUrl = assetByName(release, SHA256SUMS_SIGNATURE_ASSET);
    if (sumsUrl === null || signatureUrl === null) return fail("asset");

    let sums: { readonly status: number; readonly body: Uint8Array };
    let signature: { readonly status: number; readonly body: Uint8Array };
    try {
      sums = await deps.http.bytes(sumsUrl);
      signature = await deps.http.bytes(signatureUrl);
    } catch {
      return fail("network");
    }
    if (sums.status !== 200 || signature.status !== 200) return fail("asset");

    // 1. The detached Ed25519 signature over the EXACT bytes of SHA256SUMS.txt.
    if (
      !verifyDetachedSignature({
        data: sums.body,
        signature: signature.body,
        publicKeyPem: deps.publicKeyPem,
      })
    ) {
      return fail("signature");
    }

    // 2. The installer's line in that signed file.
    const expected = checksumFor(
      parseSha256Sums(new TextDecoder().decode(sums.body)),
      installerAssetName(offer.version),
    );
    if (expected === null) return fail("hash");

    const installerName = installerAssetName(offer.version).replace(/\.exe$/i, "");
    const destination = join(
      deps.userData,
      "updates",
      `${installerName}-${randomBytes(8).toString("hex")}.exe`,
    );
    try {
      mkdirSync(dirname(destination), { recursive: true });
    } catch {
      return fail("asset");
    }

    let downloaded: { readonly status: number; readonly sha256: string };
    try {
      downloaded = await deps.http.download(offer.installer.url, destination);
    } catch {
      return fail("network", destination);
    }
    if (downloaded.status !== 200 || downloaded.sha256 !== expected) {
      return fail("hash", destination);
    }

    // 3. Immediately before launch, hashed again from the file on disk.
    let rehash: string;
    try {
      rehash = sha256Hex(await readFile(destination));
    } catch {
      return fail("hash", destination);
    }
    if (rehash !== expected) return fail("hash", destination);

    let launchError: string;
    try {
      launchError = await deps.launchInstaller(destination);
    } catch {
      launchError = "launch failed";
    }
    if (launchError !== "") {
      // The bytes are correct; the launch is not. The file stays (nothing is
      // gained by deleting a verified installer) and the failure is reported.
      return fail("unexpected");
    }
    deps.quit();
    return view();
  }

  return {
    view,
    async autoCheckIfDue(): Promise<void> {
      try {
        if (!modeAllowsUpdates(deps.mode())) return;
        if (!isAutomaticCheckDue(lastCheckedAt, deps.now())) return;
        await runCheck("auto");
      } catch {
        // The automatic check may never take the app down. A thrown module,
        // a bug in a helper — all of it lands here and stays silent.
      }
    },
    checkNow: () => runCheck("manual"),
    install,
  };
}
