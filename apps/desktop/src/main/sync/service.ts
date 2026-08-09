/**
 * The main process's sync surface: what the renderer is allowed to ask, and the
 * one object that holds the answer.
 *
 * ─── Everything network-shaped is decided once, at construction ─────────────
 *
 * `createSyncService` reads `cloud.json` and the build's project configuration
 * ONCE and builds the ports from them — or does not build them at all. There is
 * no code path here that constructs a port later, and no operation that takes an
 * origin. So „cloud is off" and „this build has no project" are the same state
 * from this file's point of view: `ports === null`, every operation refuses by
 * name, and the process holds nothing that could reach a network.
 *
 * That is also why turning the switch on does not turn sync on in the same run.
 * `cloudRequiresRestart` says both directions need a relaunch, and its comment
 * explains why: the resolver-level block is a Chromium command-line switch fixed
 * for the life of the process, so a mid-session enable would lift two layers and
 * leave the third mapping every name to NOTFOUND — every setting reading „on"
 * and nothing resolving, forever.
 *
 * ─── Disconnecting is one action, because the server makes it one ───────────
 *
 * There is deliberately no „sign out and stay enabled". A desktop's authority
 * comes from a live `devices` row naming its `session_id`, and the grant on
 * `devices` withholds `session_id` from every client — so a desktop that ends
 * its session cannot ever point its row at a new one. Signing out and remaining
 * enabled would therefore be a state with no way forward, presented as a
 * reversible toggle. {@link SyncService.disconnect} is the honest shape: retire
 * the device row, end the session, and forget this computer's copy of the master
 * key — with the screen saying, before it happens, that coming back needs
 * pairing or the Recovery Kit.
 *
 * ─── What crosses to the renderer, and what does not ────────────────────────
 *
 * The recovery code does, exactly once, because the user has to write it down.
 * Nothing else key-shaped ever does: not MK, not the local wrap, not a token.
 * The English `detail` strings the transport produces stay here too — they are
 * developer fault reports, not user copy, and a renderer that received one would
 * eventually show it to somebody.
 */

import { normalizeWebEmail, zeroize, type CryptoPort, type SyncCryptoError } from "@nexus/sync-crypto";
import { createWebCryptoPort } from "@nexus/sync-port";
import { parseRows, retireDeviceRequest, signOut } from "@nexus/sync-transport";
import type { SyncAccountStore } from "@nexus/db";

import { cloudRequiresRestart, readCloudSwitch, writeCloudSwitch } from "../net/offline.js";
import { cloudOrigins, parseCloudConfig, type CloudConfig } from "./config.js";
import { enableSyncOnThisDevice } from "./enable.js";
import { createCloudPorts, type CloudFetch, type CloudPorts } from "./port.js";
import { createSessionHolder, type SessionHolder } from "./session.js";
import type {
  SyncEnableProblem,
  SyncEnableView,
  SyncStatusView,
} from "../../shared/ipc.js";

/**
 * The three view types live in `shared/ipc.ts`, not here.
 *
 * They are the contract, and the renderer's copy and main's copy being the same
 * declaration is the only thing that makes „the screen shows what happened"
 * checkable by the compiler. What stays in this file is the behaviour.
 */

export interface SyncServiceDeps {
  readonly userDataPath: string;
  readonly env: Record<string, string | undefined>;
  readonly fetch: CloudFetch;
  /** Throws when the database is locked, exactly as the rest of main does. */
  readonly accountStore: () => SyncAccountStore;
  /** The unlocked SQLCipher data key as hex. Throws when locked. */
  readonly dataKeyHex: () => string;
  readonly now: () => Date;
  /** Overridable so the tests do not run 64 MiB of Argon2id per case. */
  readonly crypto?: CryptoPort;
}

export interface SyncService {
  readonly status: () => SyncStatusView;
  readonly setCloudEnabled: (enabled: boolean) => SyncStatusView;
  readonly enable: (input: SyncEnableRequest) => Promise<SyncEnableView>;
  readonly disconnect: () => Promise<SyncStatusView>;
  /** The origins the cloud-off boundary must admit for this launch. */
  readonly allowedOrigins: () => readonly string[];
}

export interface SyncEnableRequest {
  readonly email: string;
  readonly password: string;
  readonly totpCode: string;
  readonly deviceName: string;
  readonly factorId?: string;
}

export function createSyncService(deps: SyncServiceDeps): SyncService {
  const config: CloudConfig | null = parseCloudConfig(deps.env);
  /** What THIS launch came up under. Fixed for the life of the process. */
  const launchCloudEnabled = readCloudSwitch(deps.userDataPath).enabled;
  const holder: SessionHolder = createSessionHolder();
  const crypto: CryptoPort = deps.crypto ?? createWebCryptoPort();

  const ports: CloudPorts | null = createCloudPorts(launchCloudEnabled, config, {
    accessToken: holder.accessToken,
    fetch: deps.fetch,
  });

  /**
   * Reads the account without letting a damaged row take the settings screen
   * down with it. `SyncAccountStore.read` throws when the stored wrap is not a
   * readable one — which is the right answer for anything about to USE the key,
   * and the wrong one for a status view whose whole job is to be displayable.
   */
  const account = (): ReturnType<SyncAccountStore["read"]> => {
    try {
      return deps.accountStore().read();
    } catch {
      return null;
    }
  };

  const status = (): SyncStatusView => {
    const record = account();
    // RE-READ, not the launch constant: the switch may have been written since
    // this service was constructed — by this session or by another window — and
    // the settings card draws its checkbox from the stored value, so a change
    // has to survive leaving the page and coming back. A small JSON read, on a
    // screen that is opened by hand.
    const stored = readCloudSwitch(deps.userDataPath).enabled;
    return {
      cloudEnabled: stored,
      cloudRestartRequired: cloudRequiresRestart(launchCloudEnabled, stored),
      configured: config !== null,
      account:
        record === null
          ? null
          : { email: record.email, deviceId: record.deviceId, enabledAt: record.enabledAt },
      signedIn: holder.current() !== null,
    };
  };

  return {
    status,

    allowedOrigins: () => (ports === null ? [] : cloudOrigins(config)),

    /**
     * Writes the switch and answers with the whole status.
     *
     * NOT with a `{ restartRequired }` of its own, which is what it used to
     * return. The status view already answers that question, computed from the
     * one place the rule is written (`cloudRequiresRestart`), so returning it
     * separately was the same fact in two shapes — and only one of the two
     * survived the settings card being unmounted and mounted again. The status
     * is the answer, the same shape {@link SyncService.disconnect} gives.
     */
    setCloudEnabled: (enabled) => {
      writeCloudSwitch(deps.userDataPath, { enabled });
      return status();
    },

    enable: async (input) => {
      if (ports === null) return { outcome: "refused", reason: "cloud_off" };

      let dataKeyHex: string;
      try {
        dataKeyHex = deps.dataKeyHex();
      } catch {
        return { outcome: "refused", reason: "locked" };
      }
      // A second enable on a computer that already has an account would mint a
      // second master key for an account that has one — and be told
      // `already_minted` after spending a step-up. Refusing here says the true
      // thing at the point it is true.
      if (account() !== null) return { outcome: "refused", reason: "already_enabled" };

      const localDataKey = hexToBytes(dataKeyHex);
      let result;
      try {
        result = await enableSyncOnThisDevice(
          { crypto, ports, holder },
          { ...input, localDataKey },
        );
      } catch (error) {
        // `prepareSyncEnable` throws `TypeError` for a caller fault — a device
        // name this schema cannot store, a data key of the wrong length — and
        // `SyncCryptoError` when the crypto port cannot read back what it has
        // just written. Neither is a server condition and neither should reach
        // the renderer as a stack.
        console.error("sync: enable failed", error);
        return { outcome: "refused", reason: enableFault(error) };
      } finally {
        zeroize(localDataKey);
      }

      if (result.kind === "already_minted") return { outcome: "already-minted" };
      if (result.kind === "refused") {
        if (result.detail !== null) console.error("sync: enable refused —", result.detail);
        return { outcome: "refused", reason: result.reason };
      }

      const session = holder.current();
      deps.accountStore().save({
        userId: session?.userId ?? "",
        // The SAME normaliser that decided the KDF salt, never a second copy
        // of the rule: the stored address is what a later sign-in derives from.
        email: normalizeWebEmail(input.email),
        deviceId: result.deviceId,
        localWrap: result.localWrap,
        refreshToken: session?.refreshToken ?? null,
        enabledAt: deps.now().toISOString(),
      });
      // MK is not held. It is re-opened from the local wrap under the data key
      // whenever something needs it, which keeps its lifetime as short as the
      // operation that wants it rather than as long as the process.
      zeroize(result.masterKey);

      return { outcome: "enabled", recoveryCode: result.recoveryCode, status: status() };
    },

    disconnect: async () => {
      const record = account();
      // Retiring the row first, while the session is still live: the policy
      // that permits it requires the caller's own `session_id`, so the order is
      // not a preference. A failure here is not fatal — the local half still
      // happens — because the alternative is a computer that cannot leave an
      // account because the server is down.
      if (ports !== null && record?.deviceId != null && holder.current() !== null) {
        try {
          const response = await ports.http(
            retireDeviceRequest(record.deviceId, deps.now().toISOString()),
          );
          const rows = response.status === 200 ? parseRows(response.body) : null;
          if (rows === null || rows.length === 0) {
            console.error("sync: the device row was not retired", response.status);
          }
        } catch (error) {
          console.error("sync: retiring the device row failed", error);
        }
      }

      const token = holder.accessToken();
      if (ports !== null && token !== null) {
        await signOut(ports.auth, token).catch(() => undefined);
      }
      holder.clear();

      try {
        deps.accountStore().forget();
      } catch (error) {
        console.error("sync: forgetting the local account failed", error);
      }
      return status();
    },
  };
}

function enableFault(error: unknown): SyncEnableProblem {
  const named = error as Partial<SyncCryptoError>;
  return named?.name === "SyncCryptoError" && named.code === "enable/round-trip-mismatch"
    ? "round_trip_mismatch"
    : "bad_request";
}

/**
 * The SQLCipher data key, hex to bytes.
 *
 * Refuses anything that is not exactly 64 lower- or upper-case hex characters
 * rather than parsing as far as it can: `parseInt` on a bad pair yields `NaN`,
 * `Uint8Array` stores that as 0, and the result is a KEY THAT LOOKS FINE and
 * wraps the master key under bytes nothing will ever reproduce.
 */
function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new TypeError("sync: the local data key is not 32 bytes of hex.");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
