import { describe, expect, it } from "vitest";

import type { SyncStatusView } from "../../shared/ipc.js";
import { syncCardState } from "./syncCardState.js";

const ACCOUNT = { email: "ana@example.com", deviceId: "d1", enabledAt: "2026-08-09T10:00:00.000Z" };

function status(overrides: Partial<SyncStatusView> = {}): SyncStatusView {
  return {
    cloudEnabled: false,
    cloudRestartRequired: false,
    configured: false,
    account: null,
    signedIn: false,
    ...overrides,
  };
}

describe("syncCardState", () => {
  it("gives the one-time recovery code the whole card, whatever else is true", () => {
    // Deliberately the most crowded status there is: an enrolled, signed-in,
    // configured, cloud-on computer. The code is shown once and stored nowhere,
    // so nothing may compete with it for the user's attention.
    const state = syncCardState({
      status: status({ cloudEnabled: true, configured: true, account: ACCOUNT, signedIn: true }),
      recoveryCode: "NEXUS-TEST-CODE",
    });
    expect(state).toEqual({ kind: "recovery", code: "NEXUS-TEST-CODE" });
  });

  it("says so when this build has no project", () => {
    expect(syncCardState({ status: status(), recoveryCode: null })).toEqual({
      kind: "unconfigured",
    });
  });

  it("offers the form only when cloud is on for THIS launch", () => {
    const configured = status({ configured: true, cloudEnabled: true });
    expect(syncCardState({ status: configured, recoveryCode: null })).toEqual({
      kind: "enable",
    });
  });

  it("withholds the form while the switch is ON but waiting for a relaunch", () => {
    // The whole reason this is a tested function. The stored switch says on and
    // the checkbox is ticked, but `createCloudPorts` ran at startup and returned
    // null — so a form offered now would take a password and a TOTP code that
    // expires, and answer `cloud_off`.
    const state = syncCardState({
      status: status({ configured: true, cloudEnabled: true, cloudRestartRequired: true }),
      recoveryCode: null,
    });
    expect(state).toEqual({ kind: "cloud-off" });
  });

  it("withholds the form while cloud is simply off", () => {
    expect(
      syncCardState({
        status: status({ configured: true, cloudEnabled: false }),
        recoveryCode: null,
      }),
    ).toEqual({ kind: "cloud-off" });
  });

  it("reports an enrolled computer even in a launch that cannot reach the server", () => {
    // „You are enrolled and the network is off" is a fact the user needs.
    // Falling through to `cloud-off` here would read as „sync was never on
    // here", which is the one thing this card must never imply.
    const state = syncCardState({
      status: status({ configured: true, cloudEnabled: false, account: ACCOUNT, signedIn: false }),
      recoveryCode: null,
    });
    expect(state).toEqual({
      kind: "enabled",
      account: ACCOUNT,
      signedIn: false,
      reconnectable: false,
    });
  });

  it("reports an enrolled computer even when the build has lost its project", () => {
    const state = syncCardState({
      status: status({ configured: false, cloudEnabled: true, account: ACCOUNT, signedIn: true }),
      recoveryCode: null,
    });
    expect(state).toEqual({
      kind: "enabled",
      account: ACCOUNT,
      signedIn: true,
      reconnectable: false,
    });
  });

  it("offers the way back only when this computer is enrolled and off its session", () => {
    const state = syncCardState({
      status: status({ configured: true, cloudEnabled: true, account: ACCOUNT, signedIn: false }),
      recoveryCode: null,
    });
    expect(state).toEqual({
      kind: "enabled",
      account: ACCOUNT,
      signedIn: false,
      reconnectable: true,
    });
  });

  it("never offers the way back to a computer that is already on its session", () => {
    // Reconnecting mints a SECOND device row for a machine that already has a
    // good one, so a signed-in desktop must not be shown the door back in.
    const state = syncCardState({
      status: status({ configured: true, cloudEnabled: true, account: ACCOUNT, signedIn: true }),
      recoveryCode: null,
    });
    expect(state).toMatchObject({ reconnectable: false });
  });

  it("withholds the way back while the switch is ON but waiting for a relaunch", () => {
    // Same trap as the enable form, and the same rule decides both: the ports
    // were built (or not) at startup, so a password taken now buys a `cloud_off`.
    const state = syncCardState({
      status: status({
        configured: true,
        cloudEnabled: true,
        cloudRestartRequired: true,
        account: ACCOUNT,
        signedIn: false,
      }),
      recoveryCode: null,
    });
    expect(state).toMatchObject({ kind: "enabled", reconnectable: false });
  });
});
