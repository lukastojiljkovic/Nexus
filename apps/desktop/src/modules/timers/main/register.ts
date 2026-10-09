import type Database from "better-sqlite3-multiple-ciphers";
import type { ModuleText } from "@nexus/core";
import { MAX_TIMER_DURATION_SECONDS, MAX_TIMER_NAME_LENGTH, TimersStore } from "@nexus/db";
import type { ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  type TimersCountdownView,
  type TimersPresetView,
  type TimersView,
} from "../shared/ipc.js";
import { buildTimersExport, parseTimersExport } from "./imex.js";

/**
 * TIMERS in the main process (ADR-090): its handlers, its timers in main, its
 * announcement, and its archive section.
 *
 * **Why main owns the clock.** A countdown is stored by the instant it ends, so
 * it keeps running while the page - or the whole renderer - is gone. Something
 * other than the page therefore has to notice the instant it passes, and the
 * only process that outlives every page is this one: a page-bound timer would
 * stop the moment its own page closed, which is exactly the promise a countdown
 * makes. So the session arms ONE timer per running countdown through
 * `ctx.armUntil`, and the HOST owns their lifetime - every armed timer is
 * cancelled when the session ends, which is what makes the one forbidden
 * announcement (a toast about a profile whose database is being closed) not
 * merely avoided here but unrepresentable.
 *
 * **Which profiles end up armed.** Every profile the session opened, not only
 * the one on screen, and that is a deliberate divergence from ADR-058's
 * active-profile rule for DERIVED reminders. A reminder is something the app
 * worked out from standing state, so serving an inactive profile means inventing
 * an interruption about data nobody is looking at. A countdown is the user's own
 * duration on their own timer, and the instant it ends is the one moment the
 * feature exists for; dropping it because another profile happens to be open
 * would be a timer that silently does not work. The case the rule protects most
 * - a locked session - is the host's, and it is covered.
 *
 * **The arithmetic is not here.** Every state change is a store method
 * (`TimersStore`), which is where the end-instant maths lives and where it is
 * tested against a moved clock. This file validates the wire (SEC-EL-02), reads
 * the store, and arms timers; the only time it computes is turning the injected
 * `now` into the ISO instant the store writes.
 *
 * **A read never arms anything.** `list` is a pure read: the page reads it on
 * every mount and the dashboard widget reads it on a timer, and a read with the
 * side effect of re-arming main's clocks would be a cost nobody could see from
 * the call site. Arming happens where a row is CREATED or CHANGED (every
 * mutation) and once per profile when a session opens.
 */

/** The `{ sr, en }` heading every finished countdown is announced under. The body is the label the user typed, so it is one sentence in both locales. */
const FINISHED: ModuleText = {
  sr: "Odbrojavanje je završeno",
  en: "Countdown finished",
};

/**
 * Something that can open this module's store for a profile: the shape a
 * handler's `ModuleCall` and a session both have, so the code below is one
 * implementation rather than two that drift.
 */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

/** One countdown main is counting down: which profile it belongs to, what to call it, and how to stop. */
interface ArmedCountdown {
  profileId: string;
  bearer: StoreBearer;
  cancel: () => void;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  /**
   * Every countdown main is counting down, by its own id. Module state rather
   * than per-call state because it has to outlive the call that created it -
   * which is the whole point of arming in main.
   */
  const armed = new Map<string, ArmedCountdown>();

  function timersStore(bearer: StoreBearer, profileId: string): TimersStore {
    return bearer.profileDb(profileId, (db, id) => new TimersStore(db, id));
  }

  /**
   * The rows as the wire declares them. One mapping, so the store's shape and
   * the wire's cannot drift apart field by field: a column renamed in a
   * migration is a compile error here rather than `undefined` in the renderer.
   */
  function viewOf(bearer: StoreBearer, profileId: string): TimersView {
    const timers = timersStore(bearer, profileId);
    const presets: TimersPresetView[] = timers.listPresets().map((preset) => ({
      id: preset.id,
      name: preset.name,
      durationSeconds: preset.durationSeconds,
      createdAt: preset.createdAt,
      updatedAt: preset.updatedAt,
    }));
    const countdowns: TimersCountdownView[] = timers.listCountdowns().map((countdown) => ({
      id: countdown.id,
      label: countdown.label,
      durationSeconds: countdown.durationSeconds,
      endsAt: countdown.endsAt,
      remainingSeconds: countdown.remainingSeconds,
      createdAt: countdown.createdAt,
      updatedAt: countdown.updatedAt,
    }));
    return { presets, countdowns, settings: timers.settings() };
  }

  function disarm(countdownId: string): void {
    armed.get(countdownId)?.cancel();
    armed.delete(countdownId);
  }

  /**
   * Stops counting one countdown and announces it.
   *
   * `silent` is read AT THE MOMENT it matters, never captured when the timer was
   * armed, so a user who turns the sound off while a countdown runs gets the
   * quieter end they asked for.
   *
   * A row that is no longer there is NOT announced: the countdown was cancelled,
   * paused, or replaced in the meantime, and a toast about a timer that no longer
   * exists would be the app inventing an end. Never throws - this runs from a
   * timer callback, where an exception reaches nobody - and its failure path is
   * the notification scheduler's own: a log, and nothing else.
   */
  function finish(countdownId: string): void {
    const entry = armed.get(countdownId);
    armed.delete(countdownId);
    if (entry === undefined) return;
    try {
      const timers = timersStore(entry.bearer, entry.profileId);
      const row = timers.countdown(countdownId);
      if (row === null) return;
      const silent = !timers.settings().soundOnEnd;
      // The row goes with the announcement: a countdown that has ended has
      // nothing left to be, and main has just said everything there is to say
      // about it. The page and the widget drop it on their next read, and the
      // clock it was showing is already past its end.
      timers.cancelCountdown(countdownId);
      ctx.notify({ title: FINISHED, body: { sr: row.label, en: row.label } }, silent);
    } catch (error) {
      console.error(
        `Nexus: a finished countdown could not be announced — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Makes main's armed clocks match one profile's running countdowns: every row
   * with an end instant gets a timer, and every timer this profile no longer has
   * a row for is cancelled. Called after a mutation and once per profile when the
   * session opens, which are the only two moments the set can change.
   *
   * An instant that will not parse is skipped rather than thrown on: a single
   * unreadable row costs one timer, never the session's start.
   */
  function rearm(profileId: string, countdowns: readonly TimersCountdownView[], bearer: StoreBearer): void {
    const running = new Set<string>();
    for (const countdown of countdowns) {
      if (countdown.endsAt === null) continue;
      const endsAtMs = Date.parse(countdown.endsAt);
      if (Number.isNaN(endsAtMs)) continue;
      running.add(countdown.id);
      // Re-armed rather than left alone: an `extend` moves the instant, and the
      // cheapest correct answer to "has this changed" is one new timer.
      disarm(countdown.id);
      // The entry goes into the map BEFORE the timer is armed, and the order is
      // load-bearing rather than tidy: `armUntil` fires a passed instant AT ONCE,
      // and a countdown that ran out while the app was closed is exactly that
      // case — an arm-after-set would have `finish` find no entry and silently
      // drop the announcement the feature exists for.
      const entry: ArmedCountdown = { profileId, bearer, cancel: () => undefined };
      armed.set(countdown.id, entry);
      entry.cancel = ctx.armUntil(endsAtMs, () => finish(countdown.id));
    }
    for (const [countdownId, entry] of [...armed]) {
      if (entry.profileId === profileId && !running.has(countdownId)) disarm(countdownId);
    }
  }

  /** What every mutation answers with: the rows read back, and main's clocks brought into line with them. */
  function changed(bearer: StoreBearer, profileId: string): TimersView {
    const view = viewOf(bearer, profileId);
    rearm(profileId, view.countdowns, bearer);
    return view;
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("createPreset", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    timersStore(call, profileId).createPreset(
      { name: timerName(call, payload.name), durationSeconds: duration(call, payload.durationSeconds) },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("renamePreset", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    timersStore(call, profileId).renamePreset(
      call.as.asId(payload.id, "id"),
      { name: timerName(call, payload.name) },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("removePreset", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    timersStore(call, profileId).removePreset(call.as.asId(payload.id, "id"));
    return changed(call, profileId);
  });

  ctx.handle("createCountdown", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    timersStore(call, profileId).createCountdown(
      { label: timerName(call, payload.name), durationSeconds: duration(call, payload.durationSeconds) },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("pauseCountdown", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    timersStore(call, profileId).pauseCountdown(
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("resumeCountdown", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    timersStore(call, profileId).resumeCountdown(
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("extendCountdown", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    timersStore(call, profileId).extendCountdown(
      call.as.asId(payload.id, "id"),
      duration(call, payload.seconds, "seconds"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("cancelCountdown", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    timersStore(call, profileId).cancelCountdown(call.as.asId(payload.id, "id"));
    return changed(call, profileId);
  });

  ctx.handle("setSoundOnEnd", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    timersStore(call, profileId).setSoundOnEnd(
      call.as.asBoolean(payload.soundOnEnd, "soundOnEnd"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  // --- The session ----------------------------------------------------------

  ctx.onSessionStart((session) => {
    for (const profileId of session.profileIds) {
      try {
        // A countdown whose end has already passed is armed too, and
        // `armUntil` fires it at once - which is the honest answer for a timer
        // that ran out while the app was closed: it is over, and the user has
        // not been told yet. That is also why the announcement is `silent`
        // according to the module's own preference rather than suppressed: the
        // alternative is a timer that quietly never happened.
        changed(session, profileId);
      } catch (error) {
        console.error(
          `Nexus: Timers could not arm its countdowns for a profile — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });

  ctx.onSessionEnd(() => {
    // The host has already cancelled every armed timer by the time this runs;
    // clearing the map is this module keeping its own bookkeeping in step with
    // that, so a countdown id can never look armed after the session it belonged
    // to is gone.
    armed.clear();
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    const timers = timersStore(session, profileId);
    return buildTimersExport(timers.listPresets(), timers.settings());
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first - and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseTimersExport,
    // The writing half. `undefined` is an archive that says nothing about
    // Timers, which for a restore that replaces a profile whole means empty:
    // no presets, and no preference row at all, so the profile answers the
    // store's own default rather than a boolean restated here. The countdowns
    // are untouched either way - they are clocks, and the archive carries none.
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        timersStore(session, profileId).replaceFromArchive(
          {
            presets: payload?.presets ?? [],
            soundOnEnd: payload?.settings.soundOnEnd ?? null,
          },
          instant(session.now()),
        );
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written ONE profile at a time (`main/imex.ts`'s `handleExport`
 * gathers one profile's `ProfileData`), so "several" is not a shape the exporter
 * meets. Answering `null` rather than guessing is what keeps that true: if a
 * session ever did name several, this module has no single profile its presets
 * belong to, and the honest payload is none at all rather than the first
 * profile's presets written under someone else's name.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** A name or label off the wire, capped at the store's own limit so a string that could never be stored is refused before the store sees it. */
function timerName(
  call: { readonly as: { asNonEmptyString(value: unknown, field: string): string; asCappedChars(value: unknown, field: string, max: number): string } },
  value: unknown,
): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, "name"),
    "name",
    MAX_TIMER_NAME_LENGTH,
  );
}

/** A duration off the wire, bounded exactly as the store's CHECK bounds it. `field` is the payload's own name for it, so a refusal names the field the caller sent. */
function duration(
  call: { readonly as: { asBoundedInteger(value: unknown, field: string, min: number, max: number): number } },
  value: unknown,
  field = "durationSeconds",
): number {
  return call.as.asBoundedInteger(value, field, 1, MAX_TIMER_DURATION_SECONDS);
}
