/**
 * The SETTINGS tools: what the profile's and the device's preferences say, and
 * the few the assistant may change.
 *
 * **Three kinds of preference, three seams.** A profile's preferences are rows
 * in a store, so main reads and writes them through the same store the app's
 * own handler uses (notifications, the assistant's default tier). The device's
 * module arrangement is a file under `userData`, which main may write too. The
 * device's appearance (theme, accent, language, week start, clock, auto-lock)
 * is the renderer's `localStorage`, which main cannot write without the page's
 * next save clobbering it, so those changes travel as a `set-preference` action
 * the Settings page applies with the setter its own control uses
 * (`shared/devicePreferences.ts` is the one allowlist of them).
 *
 * **What the assistant never changes.** Network mode, the passcode, the Recovery
 * Kit, the privacy card and the assistant's web search. `settings.open`
 * opens the card that holds them and says the user changes the setting there,
 * so the refusal is an answer the model can read rather than a missing tool.
 */

import {
  ConversationStore,
  NotificationStore,
  SNOOZE_PRESETS,
  TOGGLEABLE_NOTIFICATION_SOURCES,
} from "@nexus/db";
import { MAX_ID_LENGTH } from "@nexus/core";
import type {
  AssistantLocale,
  ModelTier,
  ModuleRegistry,
  NotificationSource,
  Tool,
  ToolContext,
} from "@nexus/core";
import { LOCKED_MODULE_IDS } from "../../../shared/modules.js";
import {
  DEVICE_PREFERENCE_CARDS,
  DEVICE_PREFERENCE_KEYS,
  DEVICE_PREFERENCE_VALUES,
  isDevicePreferenceValue,
  type DevicePreferenceKey,
} from "../../../shared/devicePreferences.js";
import { visibleModuleIds } from "../../../shared/moduleVisibility.js";
import { readWebConfig } from "../web/gate.js";
import { resolveShellVisibility, setShellModuleVisible } from "../../visibility.js";
import { asArgs, asEnum, asIdentifier, asOptionalBoolean, asOptionalEnum, asText } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface SettingsToolDeps {
  readonly profileDb: ProfileDb;
  readonly now: () => number;
  readonly userData: () => string;
  readonly appVersion: () => string;
  readonly modules: ModuleRegistry;
}

const SECTIONS = ["notifications", "assistant", "modules", "app"] as const;

const TIERS: readonly ModelTier[] = ["intelligence", "balance", "speed"];

const TIER_LABEL: Record<ModelTier, { sr: string; en: string }> = {
  intelligence: { sr: "Inteligencija", en: "Intelligence" },
  balance: { sr: "Ravnoteža", en: "Balance" },
  speed: { sr: "Brzina", en: "Speed" },
};

const SOURCE_LABEL: Record<NotificationSource, { sr: string; en: string }> = {
  document: { sr: "Dokument", en: "Document" },
  exam: { sr: "Ispit", en: "Exam" },
  "study-day": { sr: "Dan učenja", en: "Study day" },
  event: { sr: "Događaj", en: "Event" },
  task: { sr: "Zadatak", en: "Task" },
  security: { sr: "Bezbednost", en: "Security" },
  subscription: { sr: "Pretplata", en: "Subscription" },
  habit: { sr: "Navika", en: "Habit" },
};

/** What each allowed device preference is called in a confirmation line. */
const PREFERENCE_LABEL: Record<DevicePreferenceKey, { sr: string; en: string }> = {
  theme: { sr: "temu", en: "theme" },
  accent: { sr: "boju naglaska", en: "accent colour" },
  language: { sr: "jezik", en: "language" },
  "week-start": { sr: "prvi dan u nedelji", en: "first day of the week" },
  clock: { sr: "format sata", en: "clock format" },
  "auto-lock": { sr: "automatsko zaključavanje", en: "auto-lock" },
};

/**
 * The cards the assistant may open for a change it must not make itself. A
 * request to change any other setting is one of the tools above.
 */
const PROTECTED_CARDS = ["network", "security", "privacy", "assistant"] as const;

const NOTHING_TO_CHANGE: AssistantPhrase<[]> = {
  sr: () => "Navedi izvor obaveštenja ili podrazumevano odlaganje.",
  en: () => "Name a notification source or a default snooze.",
};

const SOURCE_NEEDS_ENABLED: AssistantPhrase<[]> = {
  sr: () => "Izvor i „enabled“ idu zajedno: navedi oba.",
  en: () => "A source and “enabled” go together: give both.",
};

const MODULE_NOT_FOUND: AssistantPhrase<[id: string]> = {
  sr: (id) => `Nepoznat modul „${id}“. Ids su u app.modules.`,
  en: (id) => `No module “${id}”. The ids are in app.modules.`,
};

const MODULE_LOCKED: AssistantPhrase<[id: string]> = {
  sr: (id) => `Modul „${id}“ se ne može sakriti ni prikazati: uvek je vidljiv.`,
  en: (id) => `The module “${id}” cannot be hidden or shown: it is always visible.`,
};

const MODULE_SUMMARY: AssistantPhrase<[id: string, visible: boolean]> = {
  sr: (id, visible) =>
    visible
      ? `Prikaži modul „${id}“ na ovom uređaju`
      : `Sakrij modul „${id}“ na ovom uređaju`,
  en: (id, visible) =>
    visible
      ? `Show the module “${id}” on this device`
      : `Hide the module “${id}” on this device`,
};

const MODULE_DONE: AssistantPhrase<[id: string, visible: boolean]> = {
  sr: (id, visible) =>
    visible ? `Modul „${id}“ je sada vidljiv na ovom uređaju.` : `Modul „${id}“ je sada sakriven na ovom uređaju.`,
  en: (id, visible) =>
    visible ? `The module “${id}” is now shown on this device.` : `The module “${id}” is now hidden on this device.`,
};

const VALUE_NOT_ALLOWED: AssistantPhrase<[key: string, allowed: string]> = {
  sr: (key, allowed) => `„${key}“ prima samo: ${allowed}.`,
  en: (key, allowed) => `“${key}” takes only: ${allowed}.`,
};

const PREFERENCE_SUMMARY: AssistantPhrase<[label: string, value: string]> = {
  sr: (label, value) => `Promeni ${label} na „${value}“`,
  en: (label, value) => `Change the ${label} to “${value}”`,
};

const PREFERENCE_DONE: AssistantPhrase<[label: string, value: string]> = {
  sr: (label, value) => `Promena: ${label} je „${value}“ na stranici Podešavanja.`,
  en: (label, value) => `Change: the ${label} is “${value}” on the Settings page.`,
};

const CARD_OPENED: AssistantPhrase<[card: string]> = {
  sr: (card) => `Otvoreno podešavanje „${card}“. Promenu zadaje korisnik na toj kartici.`,
  en: (card) => `Opened the “${card}” card. The user makes this change there.`,
};

export function settingsTools(deps: SettingsToolDeps): readonly Tool[] {
  function notificationStore(profileId: string): NotificationStore {
    return deps.profileDb(profileId, (db, id) => new NotificationStore(db, id));
  }

  function conversationStore(profileId: string): ConversationStore {
    return deps.profileDb(profileId, (db, id) => new ConversationStore(db, id));
  }

  const read: Tool = {
    name: "settings.read",
    description: {
      sr: "Prikazuje podešavanja profila: obaveštenja, asistenta, koji moduli su vidljivi na ovom uređaju i verziju aplikacije. Koristi ga kada korisnik pita šta je podešeno ili koji model koristiš. Izgled (tema, boja, jezik) je na stranici Podešavanja.",
      en: "Shows the profile's settings: notifications, the assistant, which modules this device shows, and the app version. Use it when the user asks what is set up or which model you use. Appearance (theme, accent, language) is on the Settings page.",
    },
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: [...SECTIONS],
          description: "notifications, assistant, modules or app.",
        },
      },
      required: ["section"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const section = asEnum(asArgs(rawArgs).section, "section", SECTIONS);
        const lines = readSection(section, context);
        return okResult(lines.join("\n"));
      }),
  };

  function readSection(section: (typeof SECTIONS)[number], context: ToolContext): string[] {
    const locale = context.locale;
    if (section === "app") {
      const version = deps.appVersion();
      return [text(locale, { sr: `Verzija: ${version}.`, en: `Version: ${version}.` })];
    }
    if (section === "modules") {
      const visibility = resolveShellVisibility(deps.userData());
      const visible = visibleModuleIds(deps.modules, visibility);
      const hidden = deps.modules
        .all()
        .map((manifest) => manifest.id)
        .filter((id) => !visible.includes(id));
      const visibleList = listOf(locale, visible);
      const hiddenList = listOf(locale, hidden);
      return [
        text(locale, { sr: `Vidljivi moduli: ${visibleList}.`, en: `Visible modules: ${visibleList}.` }),
        text(locale, { sr: `Sakriveni moduli: ${hiddenList}.`, en: `Hidden modules: ${hiddenList}.` }),
      ];
    }
    if (section === "assistant") {
      const settings = conversationStore(context.profileId).settings();
      const tier = TIER_LABEL[settings.defaultTier];
      const model = settings.chatModelId;
      const webOn = readWebConfig(deps.userData()).enabled;
      return [
        text(locale, {
          sr: `Model: nivo „${tier.sr}“${model === null ? "" : `, ručno izabran: ${model}`}.`,
          en: `Model: the “${tier.en}” tier${model === null ? "" : `, chosen by hand: ${model}`}.`,
        }),
        text(locale, {
          sr: `Pretraga weba: ${webOn ? "dozvoljena" : "isključena"}.`,
          en: `Web search: ${webOn ? "allowed" : "off"}.`,
        }),
      ];
    }
    const store = notificationStore(context.profileId);
    const settings = store.getSettings();
    const off = TOGGLEABLE_NOTIFICATION_SOURCES.filter(
      (source) => !settings.enabledSources.includes(source),
    );
    const lines = [
      text(locale, {
        sr: `Odlaganje podrazumevano: ${settings.snoozeDefault}. Jutarnji sat: ${settings.morningHour}.`,
        en: `Default snooze: ${settings.snoozeDefault}. Morning hour: ${settings.morningHour}.`,
      }),
      text(locale, {
        sr: `Uključeni izvori: ${listOf(locale, settings.enabledSources)}.`,
        en: `On: ${listOf(locale, settings.enabledSources)}.`,
      }),
      text(locale, {
        sr: `Isključeni izvori: ${listOf(locale, off)}.`,
        en: `Off: ${listOf(locale, off)}.`,
      }),
    ];
    if (settings.quietFrom !== null && settings.quietTo !== null) {
      lines.push(
        text(locale, {
          sr: `Tihi sati: ${settings.quietFrom}–${settings.quietTo}.`,
          en: `Quiet hours: ${settings.quietFrom}–${settings.quietTo}.`,
        }),
      );
    }
    return lines;
  }

  const setNotification: Tool = {
    name: "settings.reminders",
    description: {
      sr: "Uključuje ili isključuje podsetnike za jednu vrstu stavki (zadatak, ispit, događaj, navika…) ili menja podrazumevano odlaganje. Koristi ga kada korisnik kaže da mu više ne treba podsetnik za nešto ili da hoće manje obaveštenja.",
      en: "Turns the reminders for one kind of item (task, exam, event, habit…) on or off, or changes the default snooze. Use it when the user says they no longer want reminders for something, or wants fewer notifications.",
    },
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: [...TOGGLEABLE_NOTIFICATION_SOURCES],
          description: "The kind of item whose reminders change.",
        },
        enabled: {
          type: "boolean",
          description: "true to turn its reminders on, false to turn them off. Goes with source.",
        },
        snoozeDefault: {
          type: "string",
          enum: [...SNOOZE_PRESETS],
          description: "The snooze the plain Snooze button uses.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const source = asOptionalEnum(args.source, "source", TOGGLEABLE_NOTIFICATION_SOURCES);
        const enabled = asOptionalBoolean(args.enabled, "enabled");
        const snooze = asOptionalEnum(args.snoozeDefault, "snoozeDefault", SNOOZE_PRESETS);
        if ((source === undefined) !== (enabled === undefined)) {
          throw new Error(phrase(context.locale, SOURCE_NEEDS_ENABLED));
        }
        if (source === undefined && snooze === undefined) {
          throw new Error(phrase(context.locale, NOTHING_TO_CHANGE));
        }

        const parts: string[] = [];
        if (source !== undefined && enabled !== undefined) {
          const label = text(context.locale, SOURCE_LABEL[source]);
          parts.push(
            enabled
              ? text(context.locale, {
                  sr: `uključi podsetnike za „${label}“`,
                  en: `turn reminders for “${label}” on`,
                })
              : text(context.locale, {
                  sr: `isključi podsetnike za „${label}“`,
                  en: `turn reminders for “${label}” off`,
                }),
          );
        }
        if (snooze !== undefined) {
          parts.push(
            text(context.locale, { sr: `podrazumevano odlaganje ${snooze}`, en: `default snooze ${snooze}` }),
          );
        }
        const changes = parts.join("; ");
        const declined = await confirmOrDecline(
          context,
          "settings.reminders",
          "write",
          `${text(context.locale, { sr: "Promeni obaveštenja", en: "Change notifications" })}: ${changes}.`,
        );
        if (declined !== null) return declined;

        const store = notificationStore(context.profileId);
        const now = new Date(deps.now()).toISOString();
        if (source !== undefined && enabled !== undefined) store.setSourceEnabled(source, enabled, now);
        if (snooze !== undefined) store.updateSettings({ snoozeDefault: snooze }, now);
        return okResult(
          text(context.locale, { sr: `Obaveštenja su promenjena: ${changes}.`, en: `Notifications changed: ${changes}.` }),
          { navigateTo: { module: "settings", settings: "notifications" } },
        );
      }),
  };

  const setAssistant: Tool = {
    name: "settings.model",
    description: {
      sr: "Menja nivo modela kojim asistent odgovara: inteligencija, ravnoteža ili brzina. Koristi ga kada korisnik traži pametniji ili brži odgovor. Ne menja pretragu weba.",
      en: "Changes the model tier the assistant answers with: intelligence, balance or speed. Use it when the user asks for smarter or faster answers. It does not change web search.",
    },
    parameters: {
      type: "object",
      properties: {
        tier: { type: "string", enum: [...TIERS], description: "The model tier." },
      },
      required: ["tier"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const tier = asEnum(asArgs(rawArgs).tier, "tier", TIERS);
        const store = conversationStore(context.profileId);
        const label = TIER_LABEL[tier];
        const cleared = store.settings().chatModelId !== null;
        const declined = await confirmOrDecline(
          context,
          "settings.model",
          "write",
          text(context.locale, {
            sr: `Promeni model asistenta na nivo „${label.sr}“${cleared ? "; model izabran ručno se briše" : ""}`,
            en: `Change the assistant's model to the “${label.en}” tier${cleared ? "; the model chosen by hand is cleared" : ""}`,
          }),
        );
        if (declined !== null) return declined;

        store.setDefaultTier(tier, new Date(deps.now()).toISOString());
        return okResult(
          text(context.locale, {
            sr: `Model asistenta je sada na nivou „${label.sr}“.`,
            en: `The assistant's model is now the “${label.en}” tier.`,
          }),
          { navigateTo: { module: "settings", settings: "assistant" } },
        );
      }),
  };

  const setModule: Tool = {
    name: "settings.module",
    description: {
      sr: "Sakriva ili prikazuje modul na ovom uređaju, u bočnoj traci. Koristi ga kada korisnik kaže da mu neki modul ne treba ili da ga vrati. Id modula je u app.modules.",
      en: "Hides or shows a module on this device, in the sidebar. Use it when the user says they do not need a module, or wants one back. The module id is in app.modules.",
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The module id, as app.modules reports it.",
        },
        visible: { type: "boolean", description: "true to show the module, false to hide it." },
      },
      required: ["id", "visible"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const id = asIdentifier(args.id, "id");
        const visible = asOptionalBoolean(args.visible, "visible");
        if (visible === undefined) throw new Error('"visible" must be true or false.');
        const manifest = deps.modules.get(id);
        if (manifest === undefined) throw new Error(phrase(context.locale, MODULE_NOT_FOUND, id));
        if (LOCKED_MODULE_IDS.has(id)) throw new Error(phrase(context.locale, MODULE_LOCKED, id));

        const declined = await confirmOrDecline(
          context,
          "settings.module",
          "write",
          phrase(context.locale, MODULE_SUMMARY, id, visible),
        );
        if (declined !== null) return declined;

        setShellModuleVisible(deps.userData(), deps.modules, manifest, visible);
        return okResult(phrase(context.locale, MODULE_DONE, id, visible), {
          navigateTo: { module: "settings", settings: "modules" },
        });
      }),
  };

  const setPreference: Tool = {
    name: "settings.preference",
    description: {
      sr: "Menja izgled ovog uređaja: temu, boju naglaska, jezik, prvi dan u nedelji, format sata ili automatsko zaključavanje. Koristi ga kada korisnik traži takvu promenu. Otvara stranicu Podešavanja i menja podešavanje tamo.",
      en: "Changes this device's appearance: theme, accent colour, language, first day of the week, clock format or auto-lock. Use it when the user asks for such a change. It opens the Settings page and makes the change there.",
    },
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", enum: [...DEVICE_PREFERENCE_KEYS], description: "The setting to change." },
        value: {
          type: "string",
          minLength: 1,
          maxLength: 16,
          description:
            "The new value: theme system/dan/noc; accent as its id (zlato, bordo…); language sr/en; week-start monday/sunday; clock 24h/12h; auto-lock minutes 5/15/30/60, or 0 for never.",
        },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const key = asEnum(args.key, "key", DEVICE_PREFERENCE_KEYS);
        const value = asText(args.value, "value", 16);
        if (!isDevicePreferenceValue(key, value)) {
          const allowed: readonly string[] = DEVICE_PREFERENCE_VALUES[key];
          throw new Error(phrase(context.locale, VALUE_NOT_ALLOWED, key, allowed.join(", ")));
        }

        const label = text(context.locale, PREFERENCE_LABEL[key]);
        const declined = await confirmOrDecline(
          context,
          "settings.preference",
          "write",
          phrase(context.locale, PREFERENCE_SUMMARY, label, value),
        );
        if (declined !== null) return declined;

        return okResult(phrase(context.locale, PREFERENCE_DONE, label, value), {
          navigateTo: {
            module: "settings",
            settings: DEVICE_PREFERENCE_CARDS[key],
            action: { name: "set-preference", payload: { key, value } },
          },
        });
      }),
  };

  const openCard: Tool = {
    name: "settings.open",
    description: {
      sr: "Otvara podešavanje koje asistent sam ne menja: mrežni režim (network), šifru i Recovery Kit (security), karticu privatnosti (privacy) ili asistenta, gde je pretraga weba (assistant). Koristi ga kada korisnik traži jednu od tih promena; menja je sam na toj kartici.",
      en: "Opens a setting the assistant does not change itself: network mode (network), the passcode and Recovery Kit (security), the privacy card (privacy), or the assistant, where web search is (assistant). Use it when the user asks for one of those changes; they make it on that card.",
    },
    parameters: {
      type: "object",
      properties: {
        card: { type: "string", enum: [...PROTECTED_CARDS], description: "The card to open." },
      },
      required: ["card"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const card = asEnum(asArgs(rawArgs).card, "card", PROTECTED_CARDS);
        return okResult(phrase(context.locale, CARD_OPENED, card), {
          navigateTo: { module: "settings", settings: card },
        });
      }),
  };

  return [read, setNotification, setAssistant, setModule, setPreference, openCard];
}

/** A short list of ids or names, or „nijedan“ / „none“ when it is empty. */
function listOf(locale: AssistantLocale, items: readonly string[]): string {
  if (items.length === 0) return text(locale, { sr: "nijedan", en: "none" });
  return items.join(", ");
}
