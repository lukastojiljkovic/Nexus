import { Button } from "./Button.js";

/** One entry of a segmented control. */
export interface SegmentedOption<T extends string> {
  readonly value: T;
  /** The words the entry reads — a view's name, a filter's, a scale step's. */
  readonly label: string;
  readonly disabled?: boolean | undefined;
}

/**
 * What one entry of a segmented control says about itself.
 *
 * **The paint keys off `aria-pressed` and never off a modifier class.** That is
 * the rule `styles.css` states beside `.nx-segmented__option`, and it is the
 * reason this is a function rather than a class string written at the call
 * site: „which one is on" is announced and drawn from ONE fact, so the screen
 * and the screen reader cannot come to disagree about it — and a caller cannot
 * forget the state while styling the selected entry with something of its own.
 *
 * The class is always the same one. There is no `--selected` modifier to reach
 * for: the app said „this is on" as a filled primary button on ten surfaces and
 * typographically on six, and a filled button has to keep meaning „press this"
 * everywhere in the product.
 */
export function segmentedOptionState(selected: boolean): {
  className: string;
  "aria-pressed": boolean;
} {
  return { className: "nx-segmented__option", "aria-pressed": selected };
}

export interface SegmentedProps<T extends string> {
  /** The row's own name — „Prikaz", „Tabovi". An unnamed group reads as unlabelled controls. */
  label: string;
  options: readonly SegmentedOption<T>[];
  /** Which entry is on. */
  value: T;
  onSelect: (value: T) => void;
  /** The caller's own class, for a surface that places the row. */
  className?: string | undefined;
}

/**
 * „Which one of these is on", as one component instead of thirteen recipes.
 *
 * The treatment itself was already shared (`.nx-segmented__option`, keyed off
 * `aria-pressed`); what had not converged is the CONTROL — a `role="group"`, its
 * name, the `aria-pressed` on each entry and the paint they carry were written
 * out at every call site, which is how a page switcher in the header, a view
 * toggle in the body and a filter row under the title came to be three different
 * objects that all meant the same thing.
 *
 * Single-select by construction. A picker that turns several entries on at once
 * (the recurrence field's weekday ladder) is a different control — a toggle
 * group, where pressing an entry does not answer the question the group asks —
 * and it is not this component wearing a second mode.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onSelect,
  className,
}: SegmentedProps<T>) {
  const classes = ["nx-segmented"];
  if (className != null) classes.push(className);
  return (
    <div className={classes.join(" ")} role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.value}
          disabled={option.disabled ?? false}
          {...segmentedOptionState(option.value === value)}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
