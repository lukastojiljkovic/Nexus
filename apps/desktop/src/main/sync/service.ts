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
import { adoptWithRecoveryCode } from "./adopt.js";
import { cloudOrigins, parseCloudConfig, type CloudConfig } from "./config.js";
import { enableSyncOnThisDevice } from "./enable.js";
import { createCloudPorts, type CloudFetch, type CloudPorts } from "./port.js";
import { reconnectSync, resumeSync } from "./reconnect.js";
import { createSessionHolder, type SessionHolder } from "./session.js";
import type {
  SyncAdoptView,
  SyncEnableProblem,
  SyncEnableView,
  SyncReconnectView,
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
  /**
   * The answer to `enable`'s `already-minted`: join an account that already has
   * a master key, using the Sync Recovery Code from its Recovery Kit.
   */
  readonly adopt: (input: SyncAdoptRequest) => Promise<SyncAdoptView>;
  /** One request, no password: the stored refresh token, if it still works. */
  readonly resume: () => Promise<SyncStatusView>;
  /** The expensive way back, when the session is gone for good. */
  readonly reconnect: (input: SyncReconnectRequest) => Promise<SyncReconnectView>;
  readonly disconnect: () => Promise<SyncStatusView>;
  /** The origins the cloud-off boundary must admit for this launch. */
  readonly allowedOrigins: () => readonly string[];
}

export interface SyncReconnectRequest {
  readonly password: string;
  readonly deviceName: string;
}

export interface SyncEnableRequest {
  readonly email: string;
  readonly password: string;
  readonly totpCode: string;
  readonly deviceName: string;
  readonly factorId?: string;
}

/** {@link SyncEnableRequest} plus the one thing that makes it an adoption. */
export interface SyncAdoptRequest extends SyncEnableRequest {
  /** The Sync Recovery Code, as typed. Normalised inside the derivation. */
  readonly recoveryCode: string;
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
      // MK is not held. It is re-opened from the local wrap under the data key
      // whenever something needs it, which keeps its lifetime as short as the
      // operation that wants it rather than as long as the process — and the
      // erasure is in a `finally` so „as short as the operation" stays true when
      // the operation FAILS. A `save` that throws (a disk that filled, a
      // database locked between the check and the write) used to leave the
      // account's master key live in this process for as long as it ran.
      try {
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
      } finally {
        zeroize(result.masterKey);
      }

      return { outcome: "enabled", recoveryCode: result.recoveryCode, status: status() };
    },

    /**
     * The other way onto an account: this computer has never had sync, and the
     * account already has a master key one of the user's other machines minted.
     *
     * The three guards are `enable`'s, and `already_enabled` carries more weight
     * here than it does there. Adopting overwrites the local wrap — this
     * computer's ONLY copy of MK — and it does so after a step-up has already
     * revoked every other session on the account. A machine that ran this by
     * mistake would lose its key and sign its siblings out to do it.
     */
    adopt: async (input) => {
      if (ports === null) return { outcome: "refused", reason: "cloud_off" };

      let dataKeyHex: string;
      try {
        dataKeyHex = deps.dataKeyHex();
      } catch {
        return { outcome: "refused", reason: "locked" };
      }
      if (account() !== null) return { outcome: "refused", reason: "already_enabled" };

      const localDataKey = hexToBytes(dataKeyHex);
      let result;
      try {
        result = await adoptWithRecoveryCode(
          { crypto, ports, holder, now: deps.now },
          { ...input, localDataKey },
        );
      } catch (error) {
        // `assertDeviceName` throws `TypeError` for a name this schema cannot
        // store, and it does so BEFORE the first sign-in — which is the whole
        // reason it is checked there rather than at step 7. Nothing here is a
        // server condition, and none of it should reach the renderer as a stack.
        console.error("sync: adopt failed", error);
        return { outcome: "refused", reason: "bad_request" };
      } finally {
        zeroize(localDataKey);
      }

      if (result.kind === "refused") {
        if (result.detail !== null) console.error("sync: adopt refused —", result.detail);
        return { outcome: "refused", reason: result.reason };
      }

      // Every field from the RESULT, not from the holder: adopt signs in twice
      // and the session this computer keeps is the second one, so reading the
      // holder here would be a second way of asking a question the flow has
      // already answered — and the two could disagree.
      //
      // The erasure is in a `finally` for the reason `enable`'s is.
      try {
        deps.accountStore().save({
          userId: result.userId,
          email: result.email,
          deviceId: result.deviceId,
          localWrap: result.localWrap,
          refreshToken: result.refreshToken,
          enabledAt: deps.now().toISOString(),
        });
      } finally {
        zeroize(result.masterKey);
      }

      return { outcome: "adopted", status: status() };
    },

    /**
     * The cheap half of „get back on the account", and the one that runs every
     * time this screen is opened on a machine that is enrolled.
     *
     * A refresh keeps the SAME `session_id`, so the device row that names it is
     * still the right one and nothing about the account changes. Failure is not
     * an error state and is deliberately not reported as one: a session ending
     * is the ordinary end of a session's life, and what it means for the screen
     * is „offer the password", which the status view already says by way of
     * `signedIn: false`.
     */
    resume: async () => {
      const record = account();
      if (ports === null || record === null) return status();
      const resumed = await resumeSync(
        { crypto, ports, holder },
        { refreshToken: record.refreshToken },
      );
      if (resumed.kind === "resumed") {
        // GoTrue rotates the refresh token on every use, so the stored one is
        // spent the moment this succeeds. Not writing the new one back would
        // make each launch the LAST launch that could resume.
        deps.accountStore().setRefreshToken(resumed.session.refreshToken);
      }
      return status();
    },

    /**
     * The expensive half: a fresh sign-in and a new device row, bought with a
     * proof that this computer holds the account's master key.
     *
     * Every refusal is named rather than collapsed, because the sentences differ
     * in what the user should do next: a wrong password is „try again", and
     * `proof_rejected` or `master_key_unreadable` is „this machine no longer
     * holds the key — pair it with one that does, or use the Recovery Kit".
     */
    reconnect: async (input) => {
      if (ports === null) return { outcome: "refused", reason: "cloud_off" };

      let dataKeyHex: string;
      try {
        dataKeyHex = deps.dataKeyHex();
      } catch {
        return { outcome: "refused", reason: "locked" };
      }
      const record = account();
      if (record === null) return { outcome: "refused", reason: "not_enabled_here" };

      const localDataKey = hexToBytes(dataKeyHex);
      let result;
      try {
        result = await reconnectSync(
          { crypto, ports, holder },
          {
            email: record.email,
            password: input.password,
            deviceName: input.deviceName,
            localWrap: record.localWrap,
            localDataKey,
            userId: record.userId,
          },
        );
      } catch (error) {
        // `sealDeviceName` throws `TypeError` for a name this schema cannot
        // store. Neither that nor a crypto-port fault is a server condition, and
        // neither should reach the renderer as a stack.
        console.error("sync: reconnect failed", error);
        return { outcome: "refused", reason: "bad_request" };
      } finally {
        zeroize(localDataKey);
      }

      if (result.kind === "refused") {
        if (result.detail !== null) console.error("sync: reconnect refused —", result.detail);
        return { outcome: "refused", reason: result.reason };
      }

      // The row this desktop now owns, and the token that will resume it next
      // launch. Both, or the machine is reconnected only until it is closed.
      deps.accountStore().setDeviceId(result.deviceId);
      deps.accountStore().setRefreshToken(result.session.refreshToken);
      return { outcome: "reconnected", status: status() };
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
