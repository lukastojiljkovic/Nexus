import { Button, Select, TextArea, TextField } from "@nexus/ui";
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
 * The pieces every „Stručne alatke" surface is built from.
 *
 * **Why this file exists at all.** Forty-eight surfaces written independently
 * produce forty-eight spellings of „a labelled field", „a monospace answer with
 * a copy button" and „the tool refuses, and here is why" — and they drift on
 * every one. The drawer would then read as forty-eight small applications
 * sharing a rail, which is the „AI slop" the design rules exist to forbid. Every
 * component here is the ONE spelling of its shape. At eighteen toolkits the
 * argument is no longer about tidiness: a surface that invents its own shape is
 * also free to invent its own idea of what it may assert.
 *
 * **It moved out of `devtools/` for that reason.** This is the DRAWER's kit, and
 * `devtools/` is now one pack's surfaces (`softver`) rather than the whole room.
 * A shared file sitting inside one pack's folder is how the next pack ends up
 * with a second copy of it.
 *
 * **Nothing here holds a value.** These are presentational: a surface owns its
 * own state and passes text down. That is deliberate — the tools' logic lives in
 * `@nexus/core` and is exhaustively tested there, and a primitive that quietly
 * parsed or formatted would be a second, untested copy of it.
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
 *
 * **`hint` is `string | undefined`, not `string`, exactly as `error` already
 * was.** Under `exactOptionalPropertyTypes` those are different types, and a
 * hint that depends on which mode a tool is in is written `hint={mode === "x" ?
 * s.hint : undefined}` at every one of its call sites. Declared `hint?: string`
 * the primitive refused all of them, and the repair each caller reaches for is
 * a conditional spread — three copies of a workaround for a prop that should
 * have accepted the value.
 *
 * **It hands the control TWO ids, and the second is why.** The label names the
 * field from outside — that is the whole design, and `htmlFor` is what makes
 * clicking it focus the box — but a `TextField` cannot see a name it does not
 * draw, and DC-120's contract requires every field to STATE which of the three
 * arrangements names it. The second argument is the label's own `id`, so the
 * control can say `aria-labelledby` and satisfy the contract with the name that
 * is genuinely on screen. It is the same name by a second route, deliberately:
 * `for` gives the click, `aria-labelledby` states the fact.
 */
export function ToolField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (id: string, labelId: string) => ReactNode;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div className="tool__field">
      <label className="tool__field-label" htmlFor={id} id={labelId}>
        {label}
      </label>
      {children(id, labelId)}
      {error !== undefined ? (
        <p className="tool__error">{error}</p>
      ) : hint !== undefined ? (
        <p className="nx-hint nx-hint--prose">{hint}</p>
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
  hint?: string | undefined;
  error?: string | undefined;
  /** Monospace, for anything the user reads character by character — hex, base64, a path. */
  mono?: boolean;
}) {
  return (
    <ToolField label={label} hint={hint} error={error}>
      {(id, labelId) => (
        <TextField
          id={id}
          aria-labelledby={labelId}
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
  hint?: string | undefined;
  error?: string | undefined;
  rows?: number;
}) {
  return (
    <ToolField label={label} hint={hint} error={error}>
      {(id, labelId) => (
        <TextArea
          id={id}
          // Through the component. This used to be the house recipe for a raw
          // textarea — `nx-textfield__input` for the box, a local class for the
          // rest — and „Učenje" wrote its card fields the same way, which is
          // how four stylesheets came to hold the same three declarations.
          // `TextArea` owns them now; what is left here is the two this drawer
          // means: the height, and the mono face.
          //
          // No `label` prop: `ToolField` draws the label and owns the `id`, and
          // two `<label for>` elements pointing at one control is the mess
          // `Select`'s own comment below refuses for the same reason. The name
          // arrives by reference instead, for `ToolField`'s own reason.
          aria-labelledby={labelId}
          className="tool__textarea"
          value={value}
          rows={rows}
          autoComplete="off"
          spellCheck={false}
          {...(placeholder === undefined ? {} : { placeholder })}
          onChange={(event) => {
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
 *
 * It is also the one select every professional tool branches on — and the one
 * place the branch value is proved to be a member of its own union.
 *
 * **This used to end `onChange(event.target.value as T)`, and that cast was the
 * whole class.** A `DOMString` is not a `T`; the assertion said it was, once, in
 * the file every one of the 274 surfaces imports. An audit of the toolkits found
 * 129 places where an unrecognised selector value does not fail but silently
 * picks a branch — copper instead of aluminium, compound instead of simple
 * interest, a cantilever instead of a simply supported beam — because a
 * `===` chain always ends somewhere and a `Record<Union, T>` index is believed
 * by TypeScript to be defined. The renderer is where those values are born, so
 * the renderer is where the claim can actually be checked.
 *
 * It is not a theoretical hole. A controlled select whose `options` narrow while
 * `value` still holds the old selection shows the browser's fallback — the first
 * option — while the state keeps the stale one; the user then reads one branch
 * off the screen and gets another. Resolving the emitted string against the
 * options this select actually rendered is what makes the value returned a value
 * that was really on offer.
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
  hint?: string | undefined;
}) {
  return (
    <div className="tool__field">
      <Select
        label={label}
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          const chosen = options.find((option) => option.id === event.target.value);
          if (chosen !== undefined) onChange(chosen.id);
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
      {hint !== undefined && <p className="nx-hint nx-hint--prose">{hint}</p>}
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
        <p className="nx-hint nx-hint--prose">{empty}</p>
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
 * every `@nexus/core` toolkit behind it is built on — so every surface needs
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
        <p className="nx-hint nx-hint--prose">
          {fill(strings.pro.common.tableCapped, {
            shown: shown.length,
            total: rows.length,
          })}
        </p>
      )}
    </>
  );
}

/**
 * The expression a tool actually evaluated, written out under its answer.
 *
 * **This is a protection, not documentation, and it is the cheapest of the
 * four.** A professional drawer's whole defensible position is „it computed what
 * you asked from what you typed" — and that claim is only checkable if the
 * reader can see the arithmetic. A civil engineer who can read `A = |Σ(xᵢyᵢ₊₁ −
 * xᵢ₊₁yᵢ)|/2` knows in one glance whether this is the formula they wanted; the
 * same person facing a bare number has to trust us instead, and trust is the
 * thing we are trying not to ask for.
 *
 * It also settles a question the notices cannot: WHICH convention. Half the
 * disputes in these trades are between two correct formulae — gross or net area,
 * nominal or effective rate, chargeable weight at 5000 or 6000 — and printing
 * the one that ran is how the user finds out they wanted the other.
 *
 * Set as machine text and never in a heading: it is a fact about the result,
 * sitting where somebody checking the result is already looking.
 */
export function ToolFormula({ children }: { children: ReactNode }) {
  return <p className="tool__formula tool__mono">{children}</p>;
}

/**
 * The values the answer was computed FROM, repeated beside it.
 *
 * **Every regulated tool owes this, and the reason is that the answer leaves the
 * window.** A number pasted into an email is a number with no inputs attached:
 * nothing in „opterećenje: 4.8 kN/m" says which span, which load, or — the part
 * that matters — that the partial factor came from the person who typed it and
 * not from us. Echoing the inputs makes the paste self-contained, which is also
 * what makes the copied disclaimer line honest rather than decorative.
 *
 * It is the mechanism behind the „regulated constants are inputs" rule. Moving a
 * rate or a limit out of the code and into a field only helps if the answer then
 * SAYS which rate produced it — otherwise the number is exactly as anonymous as
 * it was when we embedded it, and the user has merely done our typing.
 */
export function ToolInputEcho({
  title,
  entries,
}: {
  /** Optional heading — omit inside a `ToolSection` that already has one. */
  title?: string;
  entries: readonly { readonly label: string; readonly value: ReactNode }[];
}) {
  if (entries.length === 0) return null;
  return (
    <div className="tool__echo">
      {title !== undefined && <h4 className="nx-eyebrow tool__section-title">{title}</h4>}
      {entries.map((entry) => (
        <ResultRow key={entry.label} label={entry.label} value={entry.value} />
      ))}
    </div>
  );
}

/**
 * A computed quantity beside a limit the USER supplied, and their ratio. Three
 * numbers, and not one word about what they mean together.
 *
 * **This is what `toolForbidsVerdict` leaves a surface once it may not judge.**
 * The tempting version colours the ratio, or writes „u granicama" under it, and
 * both are the same act: choosing the limit's authority, asserting the input was
 * the right one, and standing where the licensed professional stands. The
 * honest version puts the two numbers next to each other and lets the person who
 * knows which rule applies do the comparing — which they were always going to do
 * anyway, and which they are the only party insured to do.
 *
 * No colour, no icon, no tone. Those would be a verdict in a form that is harder
 * to argue about later, not an absence of one.
 */
export function ToolAgainstLimit({
  label,
  value,
  limitLabel,
  limit,
  ratioLabel,
  ratio,
}: {
  label: string;
  value: ReactNode;
  limitLabel: string;
  /** The user's own figure. Absent — because they typed none — draws the value alone. */
  limit: ReactNode | undefined;
  ratioLabel: string;
  ratio: ReactNode | undefined;
}) {
  return (
    <div className="tool__limit">
      <ResultRow label={label} value={value} />
      {limit !== undefined && <ResultRow label={limitLabel} value={limit} />}
      {limit !== undefined && ratio !== undefined && (
        <ResultRow label={ratioLabel} value={ratio} />
      )}
    </div>
  );
}

/**
 * The drawer's one row shape for a list, since the kit has no table-input
 * primitive: one row per line, cells separated by `;`. This SPLITS text — it
 * does not compute anything — and every cell still goes through `proParse`
 * before a tool ever sees it, exactly like a single-field input does.
 *
 * Here rather than in each pack, because it was in six of them, byte for byte.
 * A helper copied by hand is a defect wherever it was copied to the moment it
 * needs changing — and this one has an obvious pending change in it, since a
 * cell containing a `;` cannot be expressed at all.
 */
export function proRows(text: string): readonly (readonly string[])[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.split(";").map((cell) => cell.trim()));
}

/**
 * The field name a core refusal names, with a `:row` suffix stripped.
 *
 * Five identical copies before this one — see `proRows`. The suffix exists
 * because a row-wise refusal has to say WHICH row, and a surface choosing an
 * error message only cares which field.
 */
export function reasonField(reason: string): string {
  const at = reason.indexOf(":");
  return at === -1 ? reason : reason.slice(0, at);
}
