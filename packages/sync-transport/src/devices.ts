/**
 * The two writes a desktop is allowed to make to its own `devices` row.
 *
 * The grant is narrow and the narrowness is the design: `authenticated` may
 * update `name_nonce`, `name_ciphertext`, `public_key`, `last_seen_at` and
 * `revoked_at`, and nothing else. `session_id` is deliberately absent, so no
 * client can re-point its device row at a session it has just created — which is
 * also why a desktop whose session is revoked cannot rescue itself and why
 * re-binding is a server-side operation rather than a request.
 *
 * `devices_live_session` restricts both of these to the caller's OWN row. Its
 * `USING` clause additionally requires `revoked_at is null`, so a retired device
 * cannot un-retire itself; its `WITH CHECK` deliberately drops that clause, so
 * the row CAN write its own `revoked_at` — otherwise „retire this computer"
 * would be impossible from the computer doing the leaving.
 */

import { postgrestPath } from "./http.js";
import type { HttpRequest } from "./http.js";

/** A uuid the server issued. Checked because it is interpolated into a filter. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deviceFilter(deviceId: string): [string, string] {
  if (!UUID.test(deviceId)) {
    throw new TypeError(`sync: not a device id: ${JSON.stringify(deviceId)}`);
  }
  return ["id", `eq.${deviceId}`];
}

/**
 * Retires this computer's device row.
 *
 * `Prefer: return=representation` on purpose. A PATCH whose filter matches no
 * row is HTTP 200 with an empty array — `http.ts`'s header calls that out as the
 * way a write silently does nothing — and „the device was retired" is a claim
 * the caller is about to act on by throwing away its local copy of the master
 * key. It has to be able to see that a row came back.
 */
export function retireDeviceRequest(deviceId: string, nowIso: string): HttpRequest {
  return {
    method: "PATCH",
    path: postgrestPath("devices", [deviceFilter(deviceId), ["select", "id"]]),
    headers: { "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ revoked_at: nowIso }),
  };
}

/**
 * Records that this computer is still here.
 *
 * No `Prefer` header and no select: this is a heartbeat, the answer is not read,
 * and a heartbeat that returned the row would spend bandwidth on a value nobody
 * looks at.
 */
export function touchDeviceRequest(deviceId: string, nowIso: string): HttpRequest {
  return {
    method: "PATCH",
    path: postgrestPath("devices", [deviceFilter(deviceId)]),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ last_seen_at: nowIso }),
  };
}
