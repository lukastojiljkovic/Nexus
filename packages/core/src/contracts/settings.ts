/** Control type a setting renders as. */
export type SettingType = "boolean" | "select" | "number" | "text";

/**
 * Where a setting's value lives. Per-device settings stay on the machine;
 * synced settings replicate like any other row (SET OQ#3 resolution in
 * ADR-008).
 */
export type SettingScope = "device" | "synced";

/** A single configurable setting a module exposes in the settings surface. */
export interface SettingDefinition {
  /** Stable key, unique within its section. */
  key: string;
  type: SettingType;
  scope: SettingScope;
  defaultValue: unknown;
  /** Choices for a `select` setting; unused otherwise. */
  options?: string[];
}

/** A grouped block of settings a module contributes to the SET surface. */
export interface SettingsSection {
  /** Stable section id, unique within its module. */
  id: string;
  /** i18n key for the section title. */
  titleKey: string;
  settings: SettingDefinition[];
}
