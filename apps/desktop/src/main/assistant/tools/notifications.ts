/**
 * The notification centre, its settings, and the reminders that are coming up.
 *
 * **Why the host is main's.** Snoozing, dismissing and the settings are writes to
 * the profile's notification store, and each write must push `notifications:changed`
 * so an open centre refreshes. Those pushes live beside the IPC handlers in
 * `main/index.ts`, so the host is built there over the same store calls. The
 * reminder list is the scheduler's own candidate derivation (`main/notifications.ts`
 * `upcomingReminders`), so "what will remind me" is the answer the toast would give.
 */

import {
  SNOOZE_PRESETS,
  TOGGLEABLE_NOTIFICATION_SOURCES,
} from "@nexus/db";
import type {
  NotificationRecord,
  NotificationSettings,
  SnoozePreset,
  UpdateNotificationSettingsInput,
} from "@nexus/db";
import { MAX_ID_LENGTH } from "@nexus/core";
import type { AssistantLocale, NotificationSource, Tool } from "@nexus/core";
import {
  asArgs,
  asEnum,
  asIdentifier,
  asOptionalBoolean,
  asOptionalCount,
  asOptionalEnum,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  failResult,
  formatClock,
  guard,
  localDay,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
} from "./support.js";

/** One reminder the scheduler would show on a day in the window. */
export interface UpcomingReminder {
  readonly source: NotificationSource;
  /** The bare day the reminder is dated, `YYYY-MM-DD`. */
  readonly fireDate: string;
  readonly title: string;
  readonly body: string;
}

/** The notification centre and settings as main owns them, per profile. */
export interface NotificationsHost {
  /** Every record in the centre, as the centre lists them. */
  list(profileId: string): NotificationRecord[];
  /** Snoozes one record; an omitted preset is the profile's own default. Pushes `notifications:changed`. */
  snooze(profileId: string, id: string, preset: SnoozePreset | undefined): NotificationRecord;
  /** Removes one record from the centre. Pushes `notifications:changed`. */
  dismiss(profileId: string, id: string): void;
  settings(profileId: string): NotificationSettings;
  updateSettings(profileId: string, changes: UpdateNotificationSettingsInput): NotificationSettings;
  setSourceEnabled(profileId: string, source: NotificationSource, enabled: boolean): void;
  /** The reminders dated within the next `days` days, starting today. */
  upcoming(profileId: string, days: number): readonly UpcomingReminder[];
}

export interface NotificationToolDeps {
  readonly notifications: NotificationsHost;
}

/** The centre lists at most this many records; the rest are said to exist, not listed. */
const MAX_LISTED = 20;
/** The reminder window the tool may ask for, and the most reminder lines it prints. */
const MAX_DAYS = 7;
const MAX_REMINDER_LINES = 30;

const SOURCE_NAME: Record<NotificationSource, { sr: string; en: string }> = {
  document: { sr: "dokument", en: "document" },
  exam: { sr: "ispit", en: "exam" },
  "study-day": { sr: "učenje", en: "study day" },
  event: { sr: "događaj", en: "event" },
  task: { sr: "zadatak", en: "task" },
  security: { sr: "bezbednost", en: "security" },
  subscription: { sr: "pretplata", en: "subscription" },
  habit: { sr: "navika", en: "habit" },
};

const SNOOZE_PRESET_NAME: Record<SnoozePreset, { sr: string; en: string }> = {
  "10m": { sr: "za 10 minuta", en: "for 10 minutes" },
  "1h": { sr: "za sat vremena", en: "for an hour" },
  tonight: { sr: "večeras", en: "tonight" },
  "tomorrow-morning": { sr: "sutra ujutro", en: "tomorrow morning" },
};

const NONE_IN_CENTRE: { sr: string; en: string } = {
  sr: "Centar obaveštenja je prazan.",
  en: "The notification centre is empty.",
};

const NOT_FOUND: AssistantPhrase<[id: string]> = {
  sr: (id) => `nema obaveštenja sa identifikatorom ${id}. Proveri listu.`,
  en: (id) => `there is no notification with the id ${id}. Check the list.`,
};

const LIST_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Obaveštenja (${String(count)}):`,
  en: (count) => `Notifications (${String(count)}):`,
};

const MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `… i još ${String(count)}.`,
  en: (count) => `… and ${String(count)} more.`,
};

const SNOOZED_UNTIL: AssistantPhrase<[when: string]> = {
  sr: (when) => `odloženo do ${when}`,
  en: (when) => `snoozed until ${when}`,
};

const SNOOZE_SUMMARY: AssistantPhrase<[title: string, when: string]> = {
  sr: (title, when) => `Odloži obaveštenje „${title}“ ${when}.`,
  en: (title, when) => `Snooze the notification “${title}” ${when}.`,
};

const DEFAULT_SNOOZE_NAME: { sr: string; en: string } = {
  sr: "po podrazumevanom roku",
  en: "to the default time",
};

const SNOOZED: AssistantPhrase<[title: string, when: string]> = {
  sr: (title, when) => `Odloženo obaveštenje „${title}“ do ${when}.`,
  en: (title, when) => `Snoozed the notification “${title}” until ${when}.`,
};

const DISMISS_SUMMARY: AssistantPhrase<[title: string]> = {
  sr: (title) => `Ukloni obaveštenje „${title}“ iz centra.`,
  en: (title) => `Remove the notification “${title}” from the centre.`,
};

const DISMISSED: AssistantPhrase<[title: string]> = {
  sr: (title) => `Obaveštenje „${title}“ je uklonjeno iz centra.`,
  en: (title) => `The notification “${title}” was removed from the centre.`,
};

const SETTINGS_HEADING: { sr: string; en: string } = {
  sr: "Podešavanja obaveštenja:",
  en: "Notification settings:",
};

const QUIET_LINE: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `tihi sati ${from}–${to}`,
  en: (from, to) => `quiet hours ${from}–${to}`,
};

const NO_QUIET: { sr: string; en: string } = { sr: "bez tihih sati", en: "no quiet hours" };

const SETTINGS_LINE: AssistantPhrase<[quiet: string, morning: string, snooze: string]> = {
  sr: (quiet, morning, snooze) => `${quiet}; jutarnji sat ${morning}; odlaganje podrazumevano ${snooze}.`,
  en: (quiet, morning, snooze) => `${quiet}; morning hour ${morning}; default snooze ${snooze}.`,
};

const SOURCES_LINE: AssistantPhrase<[on: string, off: string]> = {
  sr: (on, off) => `Uključeni izvori: ${on}. Isključeni: ${off}.`,
  en: (on, off) => `Sources on: ${on}. Off: ${off}.`,
};

const NONE_LISTED: { sr: string; en: string } = { sr: "nijedan", en: "none" };

const CONFIGURE_SUMMARY: AssistantPhrase<[changes: string]> = {
  sr: (changes) => `Promeni obaveštenja: ${changes}.`,
  en: (changes) => `Change notifications: ${changes}.`,
};

const CONFIGURED: { sr: string; en: string } = {
  sr: "Podešavanja obaveštenja su promenjena.",
  en: "The notification settings were changed.",
};

const NOTHING_TO_CHANGE: { sr: string; en: string } = {
  sr: "nijedna promena nije zadata. Navedi quietFrom i quietTo zajedno, morningHour, snoozeDefault ili source i enabled zajedno.",
  en: "no change was given. Give quietFrom and quietTo together, morningHour, snoozeDefault, or source and enabled together.",
};

const UPCOMING_HEADING: AssistantPhrase<[days: number]> = {
  sr: (days) => `Podsetnici za narednih ${String(days)} dana:`,
  en: (days) => `Reminders for the next ${String(days)} days:`,
};

const NO_UPCOMING: AssistantPhrase<[days: number]> = {
  sr: (days) => `Nema podsetnika za narednih ${String(days)} dana.`,
  en: (days) => `No reminders are due in the next ${String(days)} days.`,
};

/** A clock reading, `HH:MM`, the form the settings and the quiet-hours window store. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function notificationTools(deps: NotificationToolDeps): readonly Tool[] {
  const list: Tool = {
    name: "notifications.list",
    description: {
      sr: "Izlistava obaveštenja u centru: šta je stiglo, i koja su odložena. Koristi ga kada korisnik pita šta je propustio ili šta mu je stiglo.",
      en: "Lists the notifications in the centre: what arrived, and which are snoozed. Use it when the user asks what they missed or what came in.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const records = deps.notifications.list(context.profileId);
        if (records.length === 0) return okResult(text(context.locale, NONE_IN_CENTRE));
        const lines = records
          .slice(0, MAX_LISTED)
          .map((record) => recordLine(context.locale, record));
        const more = records.length - lines.length;
        return okResult(
          [
            phrase(context.locale, LIST_HEADING, records.length),
            ...lines,
            ...(more > 0 ? [phrase(context.locale, MORE, more)] : []),
          ].join("\n"),
        );
      }),
  };

  const snooze: Tool = {
    name: "notifications.snooze",
    description: {
      sr: "Odlaže obaveštenje iz centra za zadati rok ili za podrazumevani. Koristi ga kada korisnik kaže „podseti me kasnije“ ili „odloži“ za neko obaveštenje.",
      en: "Snoozes a notification in the centre for a preset, or for the default. Use it when the user says \"remind me later\" or \"snooze\" about a notification.",
    },
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", maxLength: MAX_ID_LENGTH, description: "The notification's id, from notifications.list." },
        preset: {
          type: "string",
          enum: [...SNOOZE_PRESETS],
          description: "10m, 1h, tonight or tomorrow-morning. Omit for the profile's default.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const id = asIdentifier(args.id, "id");
        const preset = asOptionalEnum(args.preset, "preset", SNOOZE_PRESETS);
        const record = deps.notifications.list(context.profileId).find((row) => row.id === id);
        if (record === undefined) return failResult(context.locale, phrase(context.locale, NOT_FOUND, id));

        const when =
          preset === undefined
            ? text(context.locale, DEFAULT_SNOOZE_NAME)
            : text(context.locale, SNOOZE_PRESET_NAME[preset]);
        const declined = await confirmOrDecline(
          context,
          "notifications.snooze",
          "write",
          phrase(context.locale, SNOOZE_SUMMARY, record.title, when),
        );
        if (declined !== null) return declined;

        const updated = deps.notifications.snooze(context.profileId, id, preset);
        const until = updated.snoozedUntil === null ? when : untilText(context.locale, updated.snoozedUntil);
        return okResult(phrase(context.locale, SNOOZED, record.title, until));
      }),
  };

  const dismiss: Tool = {
    name: "notifications.dismiss",
    description: {
      sr: "Uklanja obaveštenje iz centra. Koristi ga kada korisnik kaže da je obaveštenje gotovo ili da ga ukloni.",
      en: "Removes a notification from the centre. Use it when the user says a notification is done or to clear it.",
    },
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", maxLength: MAX_ID_LENGTH, description: "The notification's id, from notifications.list." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const id = asIdentifier(asArgs(rawArgs).id, "id");
        const record = deps.notifications.list(context.profileId).find((row) => row.id === id);
        if (record === undefined) return failResult(context.locale, phrase(context.locale, NOT_FOUND, id));
        const declined = await confirmOrDecline(
          context,
          "notifications.dismiss",
          "write",
          phrase(context.locale, DISMISS_SUMMARY, record.title),
        );
        if (declined !== null) return declined;
        deps.notifications.dismiss(context.profileId, id);
        return okResult(phrase(context.locale, DISMISSED, record.title));
      }),
  };

  const settings: Tool = {
    name: "notifications.settings",
    description: {
      sr: "Kaže koja obaveštenja su uključena, tihi sati, jutarnji sat i podrazumevano odlaganje. Koristi ga kada korisnik pita koja obaveštenja ima uključena.",
      en: "Says which notifications are on, the quiet hours, the morning hour and the default snooze. Use it when the user asks which notifications they have on.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const current = deps.notifications.settings(context.profileId);
        const on = current.enabledSources;
        const off = TOGGLEABLE_NOTIFICATION_SOURCES.filter((source) => !on.includes(source));
        const quiet =
          current.quietFrom === null || current.quietTo === null
            ? text(context.locale, NO_QUIET)
            : phrase(context.locale, QUIET_LINE, current.quietFrom, current.quietTo);
        return okResult(
          [
            text(context.locale, SETTINGS_HEADING),
            phrase(
              context.locale,
              SETTINGS_LINE,
              quiet,
              current.morningHour,
              text(context.locale, SNOOZE_PRESET_NAME[current.snoozeDefault]),
            ),
            phrase(
              context.locale,
              SOURCES_LINE,
              sourceList(context.locale, on),
              sourceList(context.locale, off),
            ),
          ].join("\n"),
        );
      }),
  };

  const configure: Tool = {
    name: "notifications.configure",
    description: {
      sr: "Menja podešavanja obaveštenja: tihe sate (od i do zajedno), jutarnji sat, podrazumevano odlaganje, ili uključuje ili isključuje podsetnike jednog izvora. Koristi ga kada korisnik kaže „ne šalji mi obaveštenja noću“ ili „isključi podsetnike za navike“.",
      en: "Changes the notification settings: the quiet hours (from and to together), the morning hour, the default snooze, or turns one source's reminders on or off. Use it when the user says \"don't notify me at night\" or \"turn off habit reminders\".",
    },
    parameters: {
      type: "object",
      properties: {
        quietFrom: { type: ["string", "null"], description: "Start of quiet hours, HH:MM, or null to clear them (give quietTo too)." },
        quietTo: { type: ["string", "null"], description: "End of quiet hours, HH:MM, or null to clear them (give quietFrom too)." },
        morningHour: { type: "string", description: "The hour the morning reminders go out, HH:MM." },
        snoozeDefault: {
          type: "string",
          enum: [...SNOOZE_PRESETS],
          description: "The preset the centre's plain snooze uses.",
        },
        source: {
          type: "string",
          enum: [...TOGGLEABLE_NOTIFICATION_SOURCES],
          description: "The source whose reminders to switch on or off. Pair it with enabled.",
        },
        enabled: { type: "boolean", description: "Whether the source's reminders are on. Pair it with source." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const changes = readChanges(args);
        if (changes === null) return failResult(context.locale, text(context.locale, NOTHING_TO_CHANGE));

        const declined = await confirmOrDecline(
          context,
          "notifications.configure",
          "write",
          phrase(context.locale, CONFIGURE_SUMMARY, changeSummary(context.locale, changes)),
        );
        if (declined !== null) return declined;

        if (changes.patch !== null) deps.notifications.updateSettings(context.profileId, changes.patch);
        if (changes.source !== null) {
          deps.notifications.setSourceEnabled(context.profileId, changes.source, changes.enabled);
        }
        return okResult(text(context.locale, CONFIGURED));
      }),
  };

  const reminders: Tool = {
    name: "reminders.due",
    description: {
      sr: "Izlistava podsetnike koji stižu u narednih nekoliko dana, sa datumom i tekstom koji bi stigao. Koristi ga kada korisnik pita šta će ga podsetiti i kada.",
      en: "Lists the reminders due over the next few days, with their dates and the text they would carry. Use it when the user asks what will remind them, and when.",
    },
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 1,
          maximum: MAX_DAYS,
          description: "How many days from today to look ahead (7 when omitted).",
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const days = asOptionalCount(asArgs(rawArgs).days, "days", 1, MAX_DAYS) ?? MAX_DAYS;
        const upcoming = deps.notifications.upcoming(context.profileId, days);
        if (upcoming.length === 0) return okResult(phrase(context.locale, NO_UPCOMING, days));
        const lines = upcoming
          .slice(0, MAX_REMINDER_LINES)
          .map((reminder) => `- ${reminder.fireDate} · ${reminder.title} · ${reminder.body}`);
        const more = upcoming.length - lines.length;
        return okResult(
          [
            phrase(context.locale, UPCOMING_HEADING, days),
            ...lines,
            ...(more > 0 ? [phrase(context.locale, MORE, more)] : []),
          ].join("\n"),
        );
      }),
  };

  return [list, snooze, dismiss, settings, configure, reminders];
}

/** One centre record as a line: id, source, title, and when it is snoozed until when it is. */
function recordLine(locale: AssistantLocale, record: NotificationRecord): string {
  const source = text(locale, SOURCE_NAME[record.source]);
  const snoozed =
    record.status === "snoozed" && record.snoozedUntil !== null
      ? ` (${phrase(locale, SNOOZED_UNTIL, untilText(locale, record.snoozedUntil))})`
      : "";
  return `- ${record.id} · ${source} · ${record.title}${snoozed}`;
}

/** A snooze deadline as a day and a clock, for a sentence that names when. */
function untilText(locale: AssistantLocale, iso: string): string {
  const atMs = Date.parse(iso);
  if (Number.isNaN(atMs)) return iso;
  return `${localDay(atMs)} ${formatClock(locale, atMs)}`;
}

function sourceList(locale: AssistantLocale, sources: readonly NotificationSource[]): string {
  if (sources.length === 0) return text(locale, NONE_LISTED);
  return sources.map((source) => text(locale, SOURCE_NAME[source])).join(", ");
}

/** The validated changes one `notifications.configure` call asks for. */
interface Changes {
  /** The settings patch, or `null` when the call names no setting. */
  readonly patch: UpdateNotificationSettingsInput | null;
  /** The source whose switch changes, or `null` when none does. */
  readonly source: NotificationSource | null;
  readonly enabled: boolean;
}

/**
 * Reads the arguments into one settings patch and one source switch. A half pair
 * is refused rather than written: quiet hours need both ends (or both cleared),
 * and a source needs its switch. `null` when the call names no change at all.
 */
function readChanges(args: Record<string, unknown>): Changes | null {
  const patch: UpdateNotificationSettingsInput = {};
  const hasFrom = args.quietFrom !== undefined;
  if (hasFrom !== (args.quietTo !== undefined)) {
    throw new Error('"quietFrom" and "quietTo" must be given together.');
  }
  if (hasFrom) {
    const from = args.quietFrom === null ? null : asClock(args.quietFrom, "quietFrom");
    const to = args.quietTo === null ? null : asClock(args.quietTo, "quietTo");
    if ((from === null) !== (to === null)) {
      throw new Error('"quietFrom" and "quietTo" must both be set, or both be null.');
    }
    patch.quietFrom = from;
    patch.quietTo = to;
  }
  if (args.morningHour !== undefined) patch.morningHour = asClock(args.morningHour, "morningHour");
  if (args.snoozeDefault !== undefined) {
    patch.snoozeDefault = asEnum(args.snoozeDefault, "snoozeDefault", SNOOZE_PRESETS);
  }

  const hasSource = args.source !== undefined;
  if (hasSource !== (args.enabled !== undefined)) {
    throw new Error('"source" and "enabled" must be given together.');
  }
  const source = hasSource ? asEnum(args.source, "source", TOGGLEABLE_NOTIFICATION_SOURCES) : null;
  const enabled = asOptionalBoolean(args.enabled, "enabled") ?? false;

  const hasPatch = Object.keys(patch).length > 0;
  if (!hasPatch && source === null) return null;
  return { patch: hasPatch ? patch : null, source, enabled };
}

/** A clock reading, `HH:MM`, refused with the field named. */
function asClock(value: unknown, field: string): string {
  if (typeof value !== "string" || !CLOCK.test(value)) {
    throw new Error(`"${field}" must be a clock time in HH:MM form.`);
  }
  return value;
}

/** What a confirmation names: each change in the user's words, joined with a semicolon. */
function changeSummary(locale: AssistantLocale, changes: Changes): string {
  const parts: string[] = [];
  const patch = changes.patch;
  if (patch?.quietFrom !== undefined) {
    parts.push(
      patch.quietFrom === null
        ? text(locale, QUIET_OFF)
        : phrase(locale, QUIET_CHANGE, `${patch.quietFrom}–${patch.quietTo ?? ""}`),
    );
  }
  if (patch?.morningHour !== undefined) parts.push(phrase(locale, MORNING_CHANGE, patch.morningHour));
  if (patch?.snoozeDefault !== undefined) {
    parts.push(phrase(locale, SNOOZE_CHANGE, text(locale, SNOOZE_PRESET_NAME[patch.snoozeDefault])));
  }
  if (changes.source !== null) {
    parts.push(phrase(locale, SWITCH, text(locale, SOURCE_NAME[changes.source]), changes.enabled));
  }
  return parts.join("; ");
}

const QUIET_OFF: { sr: string; en: string } = {
  sr: "isključi tihe sate",
  en: "turn quiet hours off",
};

const QUIET_CHANGE: AssistantPhrase<[range: string]> = {
  sr: (range) => `tihi sati ${range}`,
  en: (range) => `quiet hours ${range}`,
};

const MORNING_CHANGE: AssistantPhrase<[hour: string]> = {
  sr: (hour) => `jutarnji sat ${hour}`,
  en: (hour) => `morning hour ${hour}`,
};

const SNOOZE_CHANGE: AssistantPhrase<[preset: string]> = {
  sr: (preset) => `podrazumevano odlaganje ${preset}`,
  en: (preset) => `default snooze ${preset}`,
};

const SWITCH: AssistantPhrase<[source: string, enabled: boolean]> = {
  sr: (source, enabled) => `${enabled ? "uključi" : "isključi"} podsetnike za ${source}`,
  en: (source, enabled) => `${enabled ? "turn on" : "turn off"} ${source} reminders`,
};
