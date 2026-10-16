import { ACCENT_IDS } from "@nexus/tokens";

/**
 * The DEVICE preferences the assistant may change, and the one list both halves
 * read: the tool's schema is built from it, and the Settings page checks a
 * request against it before it touches a setter.
 *
 * **Why these live in the renderer's `localStorage`.** Theme, accent, language,
 * week start, clock and auto-lock are device facts the renderer owns, so main
 * cannot write them without the page's own next save overwriting the value. The
 * assistant therefore names the change in a `set-preference` action and the
 * Settings page applies it through the setter its own control uses.
 *
 * **What is deliberately absent.** Network mode, the passcode, the Recovery Kit,
 * the privacy card and the assistant's web search are never changed by the
 * assistant. A request for one of them opens its card and the user changes it
 * there (`settings.open-card`), so none of them has a key here.
 */
export const DEVICE_PREFERENCE_VALUES = {
  theme: ["system", "dan", "noc"],
  accent: ACCENT_IDS,
  language: ["sr", "en"],
  "week-start": ["monday", "sunday"],
  clock: ["24h", "12h"],
  // Minutes as text, because a page action carries JSON strings through the
  // schema's enum; `0` is "never", as in the renderer's own list.
  "auto-lock": ["5", "15", "30", "60", "0"],
} as const;

export type DevicePreferenceKey = keyof typeof DEVICE_PREFERENCE_VALUES;

/** The Settings card each preference is changed on, so the page the assistant opens is the one that holds the control. */
export const DEVICE_PREFERENCE_CARDS: Readonly<Record<DevicePreferenceKey, string>> = {
  theme: "appearance",
  accent: "appearance",
  language: "appearance",
  "week-start": "appearance",
  clock: "appearance",
  "auto-lock": "security",
};

export interface DevicePreferenceChange {
  readonly key: DevicePreferenceKey;
  readonly value: string;
}

/** The keys this build allows, as a list the schema can take as an enum. */
export const DEVICE_PREFERENCE_KEYS: readonly DevicePreferenceKey[] = Object.keys(
  DEVICE_PREFERENCE_VALUES,
) as DevicePreferenceKey[];

/** Whether `value` is one of the values `key` allows. */
export function isDevicePreferenceValue(key: DevicePreferenceKey, value: string): boolean {
  const allowed: readonly string[] = DEVICE_PREFERENCE_VALUES[key];
  return allowed.includes(value);
}

/**
 * The payload of a `set-preference` page action, checked again on the page:
 * the location travels through a window event, so nothing upstream of the page
 * is a gate. Anything that is not an allowed key with an allowed value is `null`.
 */
export function parseDevicePreference(payload: unknown): DevicePreferenceChange | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { key, value } = payload as { key?: unknown; value?: unknown };
  if (typeof key !== "string" || typeof value !== "string") return null;
  if (!DEVICE_PREFERENCE_KEYS.includes(key as DevicePreferenceKey)) return null;
  const checked = key as DevicePreferenceKey;
  return isDevicePreferenceValue(checked, value) ? { key: checked, value } : null;
}
