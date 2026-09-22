import { describe, expect, it } from "vitest";

import {
  HEARTBEAT_INTERVAL_MS,
  JOIN_TIMEOUT_MS,
  MAX_HINT_COLLECTIONS,
  SIGNAL_EVENT,
  SIGNAL_PROTOCOL_VERSION,
  SIGNAL_TOPIC_PREFIX,
  SignalSession,
  type SignalStep,
} from "./signal.js";

const USER = "11111111-1111-1111-1111-111111111111";
const PROFILE = "22222222-2222-2222-2222-222222222222";
const TOPIC = `${SIGNAL_TOPIC_PREFIX}${USER}`;

const session = (): SignalSession => new SignalSession({ userId: USER, accessToken: "token" });

const frames = (step: SignalStep): Record<string, unknown>[] =>
  step.send.map((text) => JSON.parse(text) as Record<string, unknown>);

/** Verbatim shapes, from the Realtime this repository configures. */
const JOIN_OK = (ref: string): string =>
  JSON.stringify({
    ref,
    event: "phx_reply",
    payload: { status: "ok", response: { postgres_changes: [] } },
    topic: TOPIC,
  });

const JOIN_REFUSED = (ref: string): string =>
  JSON.stringify({
    ref,
    event: "phx_reply",
    payload: {
      status: "error",
      response: { reason: `Unauthorized: You do not have permissions to read from this Channel topic: nexus:${USER}` },
    },
    topic: TOPIC,
  });

const BROADCAST = (payload: unknown): string =>
  JSON.stringify({ ref: null, event: "broadcast", payload, topic: TOPIC });

const hintPayload = (over: Record<string, unknown> = {}): unknown => ({
  type: "broadcast",
  event: SIGNAL_EVENT,
  payload: { profileId: PROFILE, collections: ["tasks"], ...over },
});

/** Drive a session to `joined` and hand it back. */
function joined(now = 0): SignalSession {
  const live = session();
  const open = live.open(now);
  const ref = String(frames(open)[0]!["ref"]);
  live.receive(JOIN_OK(ref), now);
  return live;
}

describe("the join", () => {
  it("names the topic the realtime policies confine", () => {
    // `realtime.topic()` sees `nexus:<user_id>`; Phoenix adds its own prefix.
    expect(session().topic).toBe(`realtime:nexus:${USER}`);
  });

  it("refuses to be built with anything but a uuid, so a topic cannot be invented", () => {
    expect(() => new SignalSession({ userId: "nexus:*", accessToken: "t" })).toThrow(TypeError);
  });

  it("sends a private channel join carrying the access token", () => {
    const [frame] = frames(session().open(0));
    expect(frame!["topic"]).toBe(TOPIC);
    expect(frame!["event"]).toBe("phx_join");
    expect(frame!["payload"]).toEqual({
      config: { broadcast: { self: false, ack: true }, private: true },
      access_token: "token",
    });
  });

  it("pins the framing version, because 2.0.0 is arrays and this parser reads objects", () => {
    expect(SIGNAL_PROTOCOL_VERSION).toBe("1.0.0");
  });

  it("becomes joined on an ok reply", () => {
    const live = session();
    const ref = String(frames(live.open(0))[0]!["ref"]);
    const step = live.receive(JOIN_OK(ref), 0);
    expect(step.events).toEqual([{ kind: "joined" }]);
    expect(live.state).toBe("joined");
  });

  it("reports the server's own reason when the join is refused", () => {
    // Measured: another user's topic, an invented topic and an aal1 session with
    // no device row all answer this way. It is not retried — the reason is
    // authorisation, not luck.
    const live = session();
    const ref = String(frames(live.open(0))[0]!["ref"]);
    const step = live.receive(JOIN_REFUSED(ref), 0);
    expect(live.state).toBe("failed");
    expect(step.events[0]).toMatchObject({ kind: "refused" });
    expect(String((step.events[0] as { reason: string }).reason)).toContain("Unauthorized");
  });

  it("declares itself stalled when the join is never answered", () => {
    // Realtime CAN go quiet instead of replying. Without a deadline the session
    // would sit in `joining` for ever, reporting health it does not have.
    const live = session();
    live.open(0);
    expect(live.tick(JOIN_TIMEOUT_MS - 1).events).toEqual([]);
    expect(live.tick(JOIN_TIMEOUT_MS).events).toEqual([{ kind: "stalled" }]);
    expect(live.state).toBe("failed");
  });

  it("ignores a second open", () => {
    const live = session();
    live.open(0);
    expect(live.open(0).send).toEqual([]);
  });
});

describe("hints", () => {
  it("turns a broadcast into a pull instruction", () => {
    const step = joined().receive(BROADCAST(hintPayload()), 0);
    expect(step.events).toEqual([{ kind: "hint", hint: { profileId: PROFILE, collections: ["tasks"] } }]);
  });

  it("ignores a payload the server could have written but this client cannot use", () => {
    // The relay is the server, so every field is checked. Nothing here is
    // trusted for more than „which collection to ask about", and asking about
    // the wrong one costs a query that returns nothing.
    for (const payload of [
      hintPayload({ profileId: "not-a-uuid" }),
      hintPayload({ collections: "tasks" }),
      hintPayload({ collections: [] }),
      hintPayload({ collections: ["Tasks"] }),
      hintPayload({ collections: [42] }),
      hintPayload({ collections: Array.from({ length: MAX_HINT_COLLECTIONS + 1 }, () => "tasks") }),
      { type: "broadcast", event: "something_else", payload: { profileId: PROFILE, collections: ["tasks"] } },
      { type: "broadcast", event: SIGNAL_EVENT },
      null,
      "a string",
    ]) {
      expect(joined().receive(BROADCAST(payload), 0).events, JSON.stringify(payload)).toEqual([]);
    }
  });

  it("ignores a frame for somebody else's topic", () => {
    const other = JSON.stringify({
      ref: null,
      event: "broadcast",
      payload: hintPayload(),
      topic: `${SIGNAL_TOPIC_PREFIX}44444444-4444-4444-4444-444444444444`,
    });
    expect(joined().receive(other, 0).events).toEqual([]);
  });

  it("ignores text that is not a frame at all, rather than throwing", () => {
    // A throw here would hand whoever runs the server a way to crash every
    // client on the account with one malformed frame.
    for (const text of ["", "not json", "[]", '{"event":"broadcast"}', '{"topic":7,"event":"broadcast"}']) {
      expect(joined().receive(text, 0).events, text).toEqual([]);
    }
  });
});

describe("notify", () => {
  it("broadcasts the profile and the collections that moved", () => {
    const [frame] = frames(joined().notify({ profileId: PROFILE, collections: ["tasks", "notes"] }));
    expect(frame!["event"]).toBe("broadcast");
    expect(frame!["payload"]).toEqual({
      type: "broadcast",
      event: SIGNAL_EVENT,
      payload: { profileId: PROFILE, collections: ["tasks", "notes"] },
    });
  });

  it("says nothing at all before the channel is joined", () => {
    // A hint is an optimisation. A caller forced to handle „could not hint"
    // would be handling a case whose right answer is to do nothing.
    expect(session().notify({ profileId: PROFILE, collections: ["tasks"] }).send).toEqual([]);
  });

  it("drops collection names the server's own CHECK would refuse", () => {
    const step = joined().notify({ profileId: PROFILE, collections: ["Tasks", "tasks"] });
    const payload = frames(step)[0]!["payload"] as { payload: { collections: string[] } };
    expect(payload.payload.collections).toEqual(["tasks"]);
  });

  it("sends nothing when every name was dropped", () => {
    expect(joined().notify({ profileId: PROFILE, collections: ["Tasks"] }).send).toEqual([]);
  });

  it("refuses a profile id that is not a uuid, because that one is ours", () => {
    expect(() => joined().notify({ profileId: "p", collections: ["tasks"] })).toThrow(TypeError);
  });

  it("reports a broadcast the server did not accept", () => {
    // The read and the write are two separate policies in
    // `20260808090300_storage_realtime_rls.sql`, so a send can be refused by a
    // channel that was joinable. `ack: true` is what makes that visible instead
    // of silent.
    const live = joined();
    const ref = String(frames(live.notify({ profileId: PROFILE, collections: ["tasks"] }))[0]!["ref"]);
    const nack = JSON.stringify({ ref, event: "phx_reply", payload: { status: "error", response: {} }, topic: TOPIC });
    expect(live.receive(nack, 0).events).toEqual([{ kind: "undelivered" }]);
  });
});

describe("liveness", () => {
  it("beats on the interval, on Phoenix's own topic", () => {
    const live = joined(0);
    expect(live.tick(HEARTBEAT_INTERVAL_MS - 1).send).toEqual([]);
    const [beat] = frames(live.tick(HEARTBEAT_INTERVAL_MS));
    expect(beat!["topic"]).toBe("phoenix");
    expect(beat!["event"]).toBe("heartbeat");
  });

  it("declares itself stalled when a heartbeat goes unanswered", () => {
    // The shape a dead channel actually takes: no close, no error, just silence.
    // Without this the session would sit in `joined` for ever.
    const live = joined(0);
    live.tick(HEARTBEAT_INTERVAL_MS);
    expect(live.tick(HEARTBEAT_INTERVAL_MS * 2).events).toEqual([{ kind: "stalled" }]);
    expect(live.state).toBe("failed");
  });

  it("keeps beating while the server answers", () => {
    const live = joined(0);
    const ref = String(frames(live.tick(HEARTBEAT_INTERVAL_MS))[0]!["ref"]);
    live.receive(
      JSON.stringify({ ref, event: "phx_reply", payload: { status: "ok", response: {} }, topic: "phoenix" }),
      HEARTBEAT_INTERVAL_MS,
    );
    expect(live.tick(HEARTBEAT_INTERVAL_MS * 2).send).toHaveLength(1);
    expect(live.state).toBe("joined");
  });

  it("treats a channel error as the end of the session", () => {
    const live = joined();
    const step = live.receive(JSON.stringify({ ref: null, event: "phx_error", payload: {}, topic: TOPIC }), 0);
    expect(step.events).toEqual([{ kind: "refused", reason: "phx_error" }]);
    expect(live.state).toBe("failed");
  });

  it("reports a close once", () => {
    const live = joined();
    expect(live.close().events).toEqual([{ kind: "closed" }]);
    expect(live.close().events).toEqual([]);
  });
});
