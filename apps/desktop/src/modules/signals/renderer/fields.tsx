import { useState } from "react";
import { TextField } from "@nexus/ui";

/**
 * A bounded number field: the DRAFT is text, the VALUE is a number, and only a
 * value the engine's own parser accepts is ever committed.
 *
 * **Why not `<TextField type="number">`.** A number input hands the page a parsed
 * number or an empty string, so a half-typed ``-`` or ``1e`` is indistinguishable
 * from a cleared field — which is exactly the state a bounded field has to tell
 * apart. Here the text is the state while the field is being typed in, the
 * parser decides whether that text is a value at all, and the field SNAPS BACK to
 * the committed value on blur: nothing shows a number the module does not hold.
 *
 * **Why `aria-invalid` and not an error line.** The refusal is physical — the
 * value did not change — and the only thing a reader needs after it is which
 * field refuses; the copy that says so belongs to the card, where it can name the
 * range, and is rendered once rather than under four fields.
 */
export interface NumberFieldProps {
  readonly label: string;
  /** The committed value. */
  readonly value: number;
  /** The module's own reader for a typed value: a number it will take, or null. */
  readonly parse: (text: string) => number | null;
  /** Called only with a value `parse` accepted. */
  readonly commit: (value: number) => void;
  /** How the committed value is printed back into the field. Defaults to `String`. */
  readonly format?: (value: number) => string;
  readonly className?: string;
  /** Extra classes for the rendered `<label>` — where the settings filter's highlight lands (`labelClass`). */
  readonly labelClassName?: string;
  readonly min?: number;
  readonly max?: number;
  /** One line under the field: what the value means. */
  readonly hint?: string;
  /** Shown under the field while the draft is something the parser refuses — the sentence the `aria-invalid` marker cannot say. */
  readonly invalidMessage?: string;
}

export function NumberField({
  label,
  value,
  parse,
  commit,
  format = String,
  className,
  labelClassName,
  min,
  max,
  hint,
  invalidMessage,
}: NumberFieldProps) {
  /** The text being typed, or null while the field shows the committed value. */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? format(value);
  const invalid = draft !== null && parse(draft) === null;

  return (
    <>
      <TextField
        label={label}
        className={className}
        {...(labelClassName === undefined ? {} : { labelClassName })}
        inputMode="decimal"
        value={shown}
        aria-invalid={invalid}
        {...(min === undefined ? {} : { min })}
        {...(max === undefined ? {} : { max })}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = parse(text);
          if (parsed !== null) commit(parsed);
        }}
        onBlur={() => {
          setDraft(null);
        }}
      />
      {invalid && invalidMessage !== undefined && (
        <span className="signals__error">{invalidMessage}</span>
      )}
      {hint !== undefined && !invalid && <span className="nx-hint">{hint}</span>}
    </>
  );
}
