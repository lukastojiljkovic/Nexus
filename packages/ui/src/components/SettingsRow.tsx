import { useId, type ReactNode } from "react";

/**
 * The ARIA of one settings row: a group named by its label, and described by its
 * hint when it has one.
 *
 * The hint is pointed at only when it is there, for the reason `dialogAria`
 * states: a description that names an id no element carries is a promise the
 * screen reader cannot keep.
 */
export function settingsRowAria(input: {
  readonly labelId: string;
  readonly hintId?: string | undefined;
}): {
  role: "group";
  "aria-labelledby": string;
  "aria-describedby"?: string;
} {
  const aria = { role: "group" as const, "aria-labelledby": input.labelId };
  return input.hintId === undefined ? aria : { ...aria, "aria-describedby": input.hintId };
}

export interface SettingsRowProps {
  /** The setting's name, in full-strength text. */
  label: string;
  /** What the setting does, in one sentence beneath the name. */
  hint?: string | undefined;
  className?: string | undefined;
  /** The control that changes the setting, at the row's right. */
  children: ReactNode;
}

/**
 * One setting in a settings card: its name and hint on the left, its control on
 * the right, with the rule between rows drawn by the row itself.
 *
 * Module settings cards drew these with the shell's own classes, so a module's
 * card could not be read without the shell's stylesheet. The row carries its own
 * `nx-settings-row` classes and draws the same arrangement.
 */
export function SettingsRow({ label, hint, className, children }: SettingsRowProps) {
  const labelId = useId();
  const hintId = useId();
  const classes = ["nx-settings-row"];
  if (className != null) classes.push(className);
  return (
    <div className={classes.join(" ")} {...settingsRowAria({ labelId, hintId: hint == null ? undefined : hintId })}>
      <div className="nx-settings-row__info">
        <span id={labelId} className="nx-settings-row__label">
          {label}
        </span>
        {hint != null && (
          <span id={hintId} className="nx-hint">
            {hint}
          </span>
        )}
      </div>
      <div className="nx-settings-row__control">{children}</div>
    </div>
  );
}
