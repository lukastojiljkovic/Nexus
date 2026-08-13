import { Button, Select, TextField } from "@nexus/ui";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { fill, strings } from "../strings.js";
import { useCopySuffix } from "../toolRisk.js";

/**
 * The pieces every „Programerske alatke" surface is built from.
 *
 * **Why this file exists at all.** Forty-eight surfaces written independently
 * produce forty-eight spellings of „a labelled field", „a monospace answer with
 * a copy button" and „the tool refuses, and here is why" — and they drift on
 * every one. The drawer would then read as forty-eight small applications
 * sharing a rail, which is the „AI slop" the design rules exist to forbid. Every
 * component here is the ONE spelling of its shape.
 *
 * **Nothing here holds a value.** These are presentational: a surface owns its
 * own state and passes text down. That is deliberate — the tools' logic lives in
 * `@nexus/core/devtools/*` and is exhaustively tested there, and a primitive
 * that quietly parsed or formatted would be a second, untested copy of it.
 *
 * **Every string is read at render time**, never captured at module scope, so a
 * language switch relabels the drawer instead of freezing it at import. There
 * is a gate for this (`check:strings`).
 */

/** How long „Kopirano" stays up after a copy. Long enough to read, short enough not to linger. */
const COPIED_FEEDBACK_MS = 1600;

/**
 * The most rows any table in this drawer draws.
 *
 * **The cap is here, in the one component, and not at the call sites.** Several
 * tools build one row per unit of something the user pasted — per character, per
 * code point, per diff run, per JSONPath hit, per subnet — and a paste is not a
 * size anyone promised. Uncapped, tens of thousands of `<tr>`s are built and
 * laid out on EVERY keystroke, because the field driving them is controlled, and
 * the renderer simply stops for seconds. Capping each tool separately would fix
 * the tools that were noticed and leave the class alive for the next table
 * somebody adds.
 *
 * 512 rows is far past what anyone reads in a drawer this wide; past it the
 * table is a data dump, and the tools that own the whole answer (the four byte
 * views, the copy buttons) still carry it in full.
 */
const TABLE_MAX_ROWS = 512;

/**
 * A labelled control.
 *
 * The label is a real `<label for>` rather than a styled `<span>`, so clicking it
 * focuses the field and a screen reader reads the two as one thing. `hint` sits
 * under the control and is for a rule the user needs BEFORE typing; `error` is
 * for a refusal after, and the two never show at once — an error that appears
 * beside a hint reads as a second hint.
 */
export function ToolField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="tool__field">
      <label className="tool__field-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {error !== undefined ? (
        <p className="tool__error">{error}</p>
      ) : hint !== undefined ? (
        <p className="tool__note">{hint}</p>
      ) : null}
    </div>
  );
}

/** A single-line text input, labelled. */
export function ToolInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | undefined;
  /** Monospace, for anything the user reads character by character — hex, base64, a path. */
  mono?: boolean;
}) {
  return (
    <ToolField label={label} {...(hint === undefined ? {} : { hint })} error={error}>
      {(id) => (
        <TextField
          id={id}
          className={mono ? "tool__mono" : undefined}
          value={value}
          autoComplete="off"
          spellCheck={false}
          {...(placeholder === undefined ? {} : { placeholder })}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.value);
          }}
        />
      )}
    </ToolField>
  );
}

/**
 * A multi-line input. Always monospace and always `spellCheck={false}`: every
 * multi-line input in this drawer holds code, data or a key, and a red squiggle
 * under base64 is noise that makes the field harder to read.
 */
export function ToolTextArea({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  rows = 8,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | undefined;
  rows?: number;
}) {
  return (
    <ToolField label={label} {...(hint === undefined ? {} : { hint })} error={error}>
      {(id) => (
        <textarea
          id={id}
          // The house recipe for a raw textarea — `nx-textfield__input` draws
          // the box, the local class does the rest — which is exactly how
          // „Učenje" writes its card fields. A private box here would be a
          // fifth reading of a control the app already has one of.
          className="nx-textfield__input tool__textarea"
          value={value}
          rows={rows}
          autoComplete="off"
          spellCheck={false}
          {...(placeholder === undefined ? {} : { placeholder })}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            onChange(event.target.value);
          }}
        />
      )}
    </ToolField>
  );
}

/**
 * A labelled choice. Options carry their own display text; the surface keeps the id.
 *
 * `Select` renders its OWN label and is the app's one labelled dropdown, so this
 * does not go through `ToolField`: two `<label for>` elements pointing at one
 * control is precisely the labelling mess that component was written to end.
 * The wrapper is here only to hang a hint under the control.
 */
export function ToolSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: readonly { readonly id: T; readonly label: string }[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <div className="tool__field">
      <Select
        label={label}
        className="tool__select"
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          onChange(event.target.value as T);
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
      {hint !== undefined && <p className="tool__note">{hint}</p>}
    </div>
  );
}

/**
 * Copies `value`, and says so.
 *
 * `navigator.clipboard` is the same API `AuthGate` and „Privatno" already use in
 * this renderer, so it is known to work here. A failure is swallowed on purpose:
 * the only way it fails is a permission the user withheld, and an error toast
 * for „you said no" is scolding. The label simply does not change to „Kopirano",
 * which is the honest report that nothing was copied.
 *
 * The timer is cleared on unmount — a surface the user navigates away from mid
 * confirmation would otherwise set state on an unmounted component.
 */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const s = strings.pro.common;
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  // What the open tool's risk class adds to a copied result — empty for the
  // tools that endanger nobody, which is most of them. Read here rather than
  // passed in, so no surface can copy a regulated number without it.
  const suffix = useCopySuffix();

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Button
      variant="quiet"
      className="tool__copy"
      disabled={value === ""}
      onClick={() => {
        navigator.clipboard
          .writeText(value + suffix)
          .then(() => {
            setCopied(true);
            if (timer.current !== null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              timer.current = null;
              setCopied(false);
            }, COPIED_FEEDBACK_MS);
          })
          .catch(() => {
            // See the header: a refused clipboard permission is not an error to
            // report, it is an answer.
          });
      }}
    >
      {copied ? s.copied : (label ?? s.copy)}
    </Button>
  );
}

/**
 * An answer: a label, the value, and a way to take it away.
 *
 * Read-only rather than a disabled input, because a disabled field cannot be
 * selected with the keyboard and „I want to copy part of this" is the commonest
 * thing anyone does with a tool's output. `multiline` keeps line breaks and lets
 * the block scroll; the single-line form ellipsises, since a wrapped hash is
 * unreadable either way.
 */
export function ToolOutput({
  label,
  value,
  multiline = false,
  empty,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  /** Shown instead of an empty box before the user has typed anything. */
  empty?: string;
}) {
  return (
    <div className="tool__output">
      <div className="tool__output-head">
        <span className="nx-eyebrow tool__result-label">{label}</span>
        <CopyButton value={value} />
      </div>
      {value === "" && empty !== undefined ? (
        <p className="tool__note">{empty}</p>
      ) : (
        <output
          className={`tool__mono tool__output-body${multiline ? " tool__output-body--block" : ""}`}
        >
          {value}
        </output>
      )}
    </div>
  );
}

/** One row of a result table: what it is on the left, what it is on the right. */
export function ResultRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="tool__result-row">
      <span className="tool__result-label">{label}</span>
      <span className={`tool__result-value${mono ? " tool__mono" : ""}`}>{value}</span>
    </div>
  );
}

/** A group of rows under one heading. The drawer's only sectioning device. */
export function ToolSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="tool__section">
      {title !== undefined && <h4 className="nx-eyebrow tool__section-title">{title}</h4>}
      {children}
    </section>
  );
}

/**
 * The one way a surface says „no".
 *
 * Every tool in this drawer refuses rather than repairs — that is the discipline
 * the whole `@nexus/core/devtools` layer is built on — so every surface needs
 * exactly this and none needs its own. `role="status"` rather than `"alert"`:
 * a refusal while somebody is still typing is not an emergency, and an assertive
 * live region would interrupt them on every keystroke.
 */
export function ToolFailure({ children }: { children: ReactNode }) {
  return (
    <p className="tool__error" role="status">
      {children}
    </p>
  );
}

/**
 * A fixed-width table of values — the shape most of this drawer's answers take.
 *
 * The CSS owns the widths, so every table in the drawer lines up with every
 * other and a surface cannot invent its own grid geometry.
 *
 * **`prose` names the columns that are SENTENCES rather than machine text**, and
 * it exists because the drawer has two kinds of cell and this component used to
 * have one. A hex word, a bit pattern and a code point must never wrap — a
 * broken `0x7F` reads as two numbers — so every cell was monospace and
 * `nowrap`. Applied to „Objašnjenje" in the HTTP registry, that produced a
 * five-column table 180px wider than the window, in which the last three
 * columns were simply not visible and nothing on screen said they existed: the
 * scroll container works, but an overlay scrollbar that appears on hover is not
 * an affordance somebody can be expected to find. A prose column wraps and is
 * set in the reading face, which is what makes the table fit.
 *
 * **Long tables stop at `TABLE_MAX_ROWS` and say so.** A table that quietly ends
 * at row 512 is a table that misreports its input, so the count that was
 * withheld is printed under it.
 */
export function ToolTable({
  head,
  rows,
  prose,
}: {
  head: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  /** Indices of the columns holding sentences. Everything else stays machine text. */
  prose?: readonly number[];
}) {
  const shown = rows.length > TABLE_MAX_ROWS ? rows.slice(0, TABLE_MAX_ROWS) : rows;
  return (
    <>
      <div className="tool__table-scroll">
        <table className="tool__table">
          <thead>
            <tr>
              {head.map((cell) => (
                <th key={cell} scope="col" className="nx-eyebrow">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              // The index IS the identity here: row 3 of a bit table is row 3,
              // and it has no id. (No `eslint-disable` — `react/no-array-index-key`
              // belongs to a plugin this repo does not register, and ESLint 9
              // treats a directive naming an unknown rule as a hard error.)
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={
                      prose?.includes(cellIndex) === true ? "tool__cell--prose" : "tool__mono"
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <p className="tool__note">
          {fill(strings.pro.common.tableCapped, {
            shown: shown.length,
            total: rows.length,
          })}
        </p>
      )}
    </>
  );
}
