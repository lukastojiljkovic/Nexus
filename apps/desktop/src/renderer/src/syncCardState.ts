import type { SyncStatusView } from "../../shared/ipc.js";

/**
 * What „Sinhronizacija" shows, decided as a value rather than as four
 * conditions inside JSX.
 *
 * The card's shape is a state machine over three booleans, a nullable account
 * and one piece of component state, and the combinations are not obvious. Two
 * of them are the reason this is a function with tests instead of inline
 * conditions:
 *
 *  - **A pending restart must hide the enable form.** The cloud boundary is
 *    read once, at startup: `createCloudPorts` either built the ports or did
 *    not, and nothing written to `cloud.json` afterwards changes this launch.
 *    A form offered before the relaunch would take an account password, a
 *    one-time TOTP code that then expires, and answer `cloud_off`. So the
 *    switch says „from the next launch" and the form is simply not there yet.
 *  - **The recovery code outranks everything.** It is shown once and stored
 *    nowhere, so while it exists it IS the card — see the component header.
 *
 * Everything it reads comes from `SyncStatusView`; nothing about the switch is
 * remembered in the card. An earlier version held the user's click in component
 * state, which meant the checkbox untinted itself and the restart note vanished
 * the moment the settings page was left and re-entered — the only durable copy
 * of the choice was in a file nobody was re-reading. Main answers both halves
 * now, and `setCloudEnabled` returns the same view, so one read settles both.
 *
 * The renderer never decides anything security-relevant here; every one of
 * these states is also enforced in main (`sync:enable` answers `cloud_off`,
 * `locked` and `already_enabled` on its own). This is which words to draw.
 */
export type SyncCardState =
  /** The one-time Sync Recovery Code, alone on the card. */
  | { kind: "recovery"; code: string }
  /** No project compiled into this build. The switch still works; nothing else can. */
  | { kind: "unconfigured" }
  /**
   * Nothing to offer this launch: cloud is off, or it has just been switched
   * and the ports for it do not exist until the relaunch. The switch and its
   * restart note are drawn in every state, so this one draws nothing else.
   */
  | { kind: "cloud-off" }
  /** Cloud is on and this computer belongs to no account yet: the enable form. */
  | { kind: "enable" }
  /** This computer is enrolled. `signedIn` decides whether a note says it is not signed in. */
  | { kind: "enabled"; account: NonNullable<SyncStatusView["account"]>; signedIn: boolean };

export interface SyncCardInput {
  readonly status: SyncStatusView;
  readonly recoveryCode: string | null;
}

export function syncCardState(input: SyncCardInput): SyncCardState {
  const { status } = input;
  if (input.recoveryCode !== null) return { kind: "recovery", code: input.recoveryCode };

  // An enrolled computer says so even in a build that has lost its project or a
  // launch with cloud off: „you are enrolled and cannot reach the server" is a
  // fact the user needs, and hiding it would read as „sync was never on here".
  const { account, signedIn } = status;
  if (account !== null) return { kind: "enabled", account, signedIn };

  if (!status.configured) return { kind: "unconfigured" };
  if (!status.cloudEnabled || status.cloudRestartRequired) return { kind: "cloud-off" };
  return { kind: "enable" };
}
