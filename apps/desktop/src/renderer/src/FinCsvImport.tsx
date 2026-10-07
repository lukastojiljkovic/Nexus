import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Checkbox, Select } from "@nexus/ui";
import {
  FIN_CSV_IMPORT_COLUMN_ROLES,
  FIN_CSV_IMPORT_SIGN_CONVENTIONS,
} from "../../shared/ipc.js";
import type {
  CsvImportDelimiter,
  FinAccount,
  FinCsvImportColumnRole,
  FinCsvImportPlanPreview,
  FinCsvImportPreview,
  FinCsvImportRefusal,
  FinCsvImportSignConvention,
} from "../../shared/ipc.js";
import { strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

/**
 * Uvoz izvoda (.csv) → Finansije (FIN slice e).
 *
 * ONE component, mounted in two places — the finance page (where a statement is
 * something you do to your ledger) and the Settings import block (where every
 * other importer lives). Two mount points and one flow, because a second copy
 * of this state machine would be a second place for „money read wrong" to hide.
 *
 * Deliberately the task CSV section's twin in shape: pick → MAP → pregled →
 * potvrda, the same busy and error states, the same `set__` recipes, the same
 * shared undo banner afterwards. What it adds is everything a STATEMENT is that
 * a task table is not:
 *
 *  - the destination is an EXISTING account (a statement cannot supply a
 *    currency or an opening balance), and that account's currency governs;
 *  - the sign convention for a signed amount column is STATED by the user, not
 *    sniffed, because a column of nothing but expenses looks identical under
 *    either reading and being wrong inverts every balance on the screen;
 *  - the plan says how the file was READ — which decimal separator, which date
 *    order — rather than asking the user to trust it;
 *  - a file that cannot be read confidently is REFUSED whole, by name, with the
 *    column and the offending cell;
 *  - every row migration 052's fingerprint recognised is named, so „ništa se
 *    nije desilo" is never what a second import of the same statement looks like.
 */

/** The flow's state. The task CSV machine plus one arm a ledger needs: `refused`. */
type FinCsvState =
  | { phase: "idle"; error: string | null }
  | { phase: "picked"; fileName: string; busy: boolean; error: string | null }
  | {
      phase: "mapping";
      preview: FinCsvImportPreview;
      roles: FinCsvImportColumnRole[];
      busy: boolean;
      error: string | null;
      /** A file-level refusal from the last mapping attempt — shown INSIDE the dialog, because the answer is to re-map or to fix the file. */
      refusal: FinCsvImportRefusal | null;
    }
  | {
      phase: "planned";
      preview: FinCsvImportPreview;
      roles: FinCsvImportColumnRole[];
      plan: FinCsvImportPlanPreview;
      error: string | null;
    }
  | { phase: "applying"; plan: FinCsvImportPlanPreview }
  | { phase: "applied" };

/** Whether a role set is one the translator will accept — the same rule main and core enforce, restated here only to keep the confirm button honest. */
function mappingReady(roles: readonly FinCsvImportColumnRole[]): {
  date: boolean;
  amount: boolean;
} {
  const has = (role: FinCsvImportColumnRole): boolean => roles.includes(role);
  const signed = has("amount");
  const split = has("outflow") || has("inflow");
  return { date: has("date"), amount: signed !== split };
}

/** How a column introduces itself: its header, or „Kolona N" when the file has none. */
function columnName(header: string | null, index: number): string {
  return header !== null && header.trim().length > 0
    ? header
    : `${strings.settings.finCsvImport.columnFallbackPrefix} ${index + 1}`;
}

interface FinCsvMappingDialogProps {
  preview: FinCsvImportPreview;
  roles: FinCsvImportColumnRole[];
  accounts: FinAccount[];
  accountId: string;
  signConvention: FinCsvImportSignConvention;
  busy: boolean;
  error: string | null;
  refusal: FinCsvImportRefusal | null;
  onRoleChange: (column: number, role: FinCsvImportColumnRole) => void;
  onDelimiterChange: (delimiter: CsvImportDelimiter) => void;
  onHeaderChange: (hasHeader: boolean) => void;
  onAccountChange: (accountId: string) => void;
  onSignChange: (convention: FinCsvImportSignConvention) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The mapping step, on the house dialog recipe — the `recur-dialog` classes and
 * the task importer's own `csv-map__*` layout, reused outright rather than
 * restyled: it is the same dialog answering a different question, and a second
 * look for it would be a second thing to keep in step.
 */
function FinCsvMappingDialog({
  preview,
  roles,
  accounts,
  accountId,
  signConvention,
  busy,
  error,
  refusal,
  onRoleChange,
  onDelimiterChange,
  onHeaderChange,
  onAccountChange,
  onSignChange,
  onConfirm,
  onCancel,
}: FinCsvMappingDialogProps) {
  const s = strings.settings.finCsvImport;
  const shared = strings.settings.restore;
  const titleId = useId();
  const questionId = useId();

  // Focus lands on the first role select: the dialog exists to be answered, and
  // the first answer is the first column's — the trap's own default (the
  // first tabbable descendant), since the toggles/selects come before
  // „Otkaži". It also cycles Tab within the panel and hands focus back on close.
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  // Guarded on `busy`: `onCancel` is `FinCsvImportSection`'s `cancel`, which
  // releases the file main is holding AND resets the phase to idle. Firing it
  // while a re-map or a confirm is already in flight would release the very
  // file that in-flight call is still reading, reopening the picker onto a
  // pick main no longer has and dropping whatever answer was on its way back
  // (a refusal, a fresh mapping). Escape resumes working the instant `busy`
  // clears — exactly like the Cancel button beside it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, busy]);

  const ready = mappingReady(roles);
  // The sign question is asked only when it HAS an answer: a split
  // outflow/inflow pair says which way each row points by construction.
  const signed = roles.includes("amount");

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={busy ? undefined : onCancel} />
      <div
        ref={panelRef}
        className="csv-map__panel recur-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={questionId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.mapTitle}
        </h2>
        <p className="recur-dialog__name app__path">{preview.fileName}</p>
        <p id={questionId} className="nx-hint">
          {s.mapQuestion}
        </p>

        <div className="csv-map__body">
          <div className="csv-map__toggles">
            {/* Labelled ONCE. This block used to wrap the select in a `<label>`,
                put the name in a caption span inside it, AND repeat the same
                string as an `aria-label` — three declarations of one name, two
                of which could drift from the third. */}
            <Select
              label={s.delimiterLabel}
              className="set__select"
              value={preview.delimiter}
              disabled={busy}
              onChange={(event) => onDelimiterChange(event.target.value === ";" ? ";" : ",")}
            >
              <option value=",">{s.delimiterComma}</option>
              <option value=";">{s.delimiterSemicolon}</option>
            </Select>
            <Checkbox
              checked={preview.hasHeader}
              disabled={busy}
              onChange={(event) => onHeaderChange(event.target.checked)}
            >
              {s.headerLabel}
            </Checkbox>
          </div>

          {preview.columns.map((column, index) => {
            const name = columnName(column.header, index);
            const samples = column.samples.filter((sample) => sample.trim().length > 0);
            return (
              <div className="csv-map__column" key={index}>
                <div className="csv-map__column-facts">
                  <span className="csv-map__column-name">{name}</span>
                  <span className="csv-map__samples">
                    {s.samplesLabel} {samples.length > 0 ? samples.join(" · ") : "—"}
                  </span>
                </div>
                {/* `inline`: the column's own name and samples sit to the left
                    in the same row (`.csv-map__column` is a fixed-lane row by
                    design, "fifteen rows must read as one table, not fifteen
                    forms" — see that rule's own comment) — a stacked label
                    would turn every row into a two-line card. The label is
                    still just `roleLabel` rather than `roleLabel: name`
                    (the old `aria-label`'s text): the column name is already
                    on screen immediately to its left, so repeating it here
                    would be the same word said twice in one row. */}
                <Select
                  layout="inline"
                  className="set__select"
                  label={s.roleLabel}
                  value={roles[index] ?? "ignore"}
                  disabled={busy}
                  onChange={(event) => {
                    const role = FIN_CSV_IMPORT_COLUMN_ROLES.find(
                      (candidate) => candidate === event.target.value,
                    );
                    onRoleChange(index, role ?? "ignore");
                  }}
                >
                  {FIN_CSV_IMPORT_COLUMN_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {s.roles[role]}
                    </option>
                  ))}
                </Select>
              </div>
            );
          })}
          {!ready.date && <p className="nx-hint">{s.dateRequired}</p>}
          {!ready.amount && <p className="nx-hint">{s.amountRequired}</p>}

          <div className="csv-map__list">
            {/* Labelled ONCE — same fix as the delimiter select above: the
                caption used to stand as its own `<p>` AND be repeated as an
                invisible `aria-label`. `Select` renders the one string as
                both. */}
            <Select
              className="set__select"
              label={s.accountLabel}
              value={accountId}
              disabled={busy}
              onChange={(event) => onAccountChange(event.target.value)}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.currency}
                </option>
              ))}
            </Select>
            <p className="nx-hint">{s.accountHint}</p>
          </div>

          {signed && (
            <div className="csv-map__list">
              <Select
                className="set__select"
                label={s.signLabel}
                value={signConvention}
                disabled={busy}
                onChange={(event) => {
                  const convention = FIN_CSV_IMPORT_SIGN_CONVENTIONS.find(
                    (candidate) => candidate === event.target.value,
                  );
                  onSignChange(convention ?? "negative-is-expense");
                }}
              >
                {FIN_CSV_IMPORT_SIGN_CONVENTIONS.map((convention) => (
                  <option key={convention} value={convention}>
                    {s.signs[convention]}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {refusal !== null && (
            <div className="csv-map__refusal">
              <h4 className="nx-eyebrow set__module-group-title">{s.refusalTitle}</h4>
              <p className="set__error">{s.refusals[refusal.code]}</p>
              <p className="nx-hint">
                {s.refusalColumnPrefix}{" "}
                {columnName(preview.columns[refusal.column]?.header ?? null, refusal.column)} ·{" "}
                {s.refusalSamplePrefix} <span className="app__path">{refusal.sample}</span>
              </p>
            </div>
          )}
          {error != null && <p className="set__error">{error}</p>}
        </div>

        <div className="recur-dialog__actions csv-map__actions">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !ready.date || !ready.amount || accountId.length === 0}
            onClick={onConfirm}
          >
            {s.confirmButton}
          </Button>
          <Button className="recur-dialog__cancel" disabled={busy} onClick={onCancel}>
            {shared.cancelButton}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface FinCsvImportSectionProps {
  profileId: string;
  /** The heading's class, so the Settings mount can carry its SET-014 search-hit marker and the finance page can carry its own. */
  titleClassName?: string;
  /**
   * SET-015: Settings now mounts this flow as the only content of a card whose
   * title IS this heading, so the heading would be drawn twice. The finance
   * page keeps the default and its own heading.
   */
  showTitle?: boolean;
}

export function FinCsvImportSection({
  profileId,
  titleClassName,
  showTitle = true,
}: FinCsvImportSectionProps) {
  const s = strings.settings.finCsvImport;
  // The half of the flow that is identical to its siblings', read from where it
  // is already spelled rather than spelled a second time.
  const shared = strings.settings.restore;

  const [state, setState] = useState<FinCsvState>({ phase: "idle", error: null });
  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  // Outside the state machine for the reason the `.apkg` subject is: both
  // choices survive the phase changes around them, and a re-parse must not
  // silently retarget somebody's money.
  const [accountId, setAccountId] = useState("");
  const [signConvention, setSignConvention] =
    useState<FinCsvImportSignConvention>("negative-is-expense");
  // Read by the unmount cleanup only. An apply in flight must never be cancelled
  // from here: main is writing the very plan `cancelFinCsvImport` would drop.
  const applying = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await window.nexus.listFinAccounts(profileId);
        if (!active) return;
        setAccounts(rows);
        setAccountId((current) => (current.length > 0 ? current : (rows[0]?.id ?? "")));
      } catch (loadError) {
        console.error("Nexus: failed to load finance accounts:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // Releasing the pick on unmount matters for the `.apkg` section's reason: main
  // is holding the file's text and parsed cells until it is told to let go — and
  // here that is somebody's whole bank ledger.
  useEffect(() => {
    return () => {
      if (applying.current) return;
      void window.nexus.cancelFinCsvImport().catch((error: unknown) => {
        console.error("Nexus: failed to release the picked statement:", error);
      });
    };
  }, []);

  /**
   * Parses (or re-parses) in main and opens the mapping dialog on the result.
   * The roles are RESET to the fresh parse's suggestions on purpose: a role
   * chosen against one parse must not survive into a parse whose columns may no
   * longer line up.
   */
  async function runPreview(
    fileName: string,
    delimiter: CsvImportDelimiter | null,
    hasHeader: boolean | null,
  ): Promise<void> {
    setState((previous) =>
      previous.phase === "mapping"
        ? { ...previous, busy: true, error: null }
        : { phase: "picked", fileName, busy: true, error: null },
    );
    try {
      const result = await window.nexus.previewFinCsvImport(profileId, delimiter, hasHeader);
      switch (result.status) {
        case "ready":
          setState({
            phase: "mapping",
            preview: result.preview,
            roles: result.preview.columns.map((column) => column.suggestedRole),
            busy: false,
            error: null,
            refusal: null,
          });
          return;
        case "unreadable":
          setState({ phase: "picked", fileName, busy: false, error: s.unreadable[result.code] });
          return;
        case "no-file":
          setState({ phase: "idle", error: s.noFileError });
          return;
      }
    } catch (previewError) {
      setState({ phase: "picked", fileName, busy: false, error: s.readError });
      console.error("Nexus: failed to preview a statement:", previewError);
    }
  }

  /** Picking from any phase starts over — main drops the superseded pick itself. */
  async function choose(): Promise<void> {
    setState({ phase: "idle", error: null });
    try {
      const picked = await window.nexus.pickFinCsvFile();
      if (picked.canceled) return;
      await runPreview(picked.fileName, null, null);
    } catch (pickError) {
      setState({ phase: "idle", error: s.readError });
      console.error("Nexus: failed to pick a statement:", pickError);
    }
  }

  /** Confirms the mapping: main translates and plans the rows it already holds. */
  async function confirmMapping(): Promise<void> {
    if (state.phase !== "mapping" || state.busy) return;
    const { preview, roles } = state;
    setState({ ...state, busy: true, error: null, refusal: null });
    try {
      const result = await window.nexus.mapFinCsvImport(
        profileId,
        roles,
        accountId,
        signConvention,
      );
      switch (result.status) {
        case "no-file":
          setState({ phase: "idle", error: s.noFileError });
          return;
        case "refused":
          // The dialog STAYS open: a refusal is answered by re-mapping or by
          // fixing the file, and both start from here.
          setState({
            phase: "mapping",
            preview,
            roles,
            busy: false,
            error: null,
            refusal: result.refusal,
          });
          return;
        case "ready":
          setState({ phase: "planned", preview, roles, plan: result.preview, error: null });
          return;
      }
    } catch (mapError) {
      setState({ ...state, busy: false, error: s.mapError, refusal: null });
      console.error("Nexus: failed to map a statement import:", mapError);
    }
  }

  async function apply(plan: FinCsvImportPlanPreview): Promise<void> {
    if (state.phase !== "planned") return;
    const { preview, roles } = state;
    applying.current = true;
    setState({ phase: "applying", plan });
    try {
      await window.nexus.applyFinCsvImport(profileId, plan.token);
      // Main reloads this renderer moments after the reply lands, so the success
      // line simply stands until the whole screen is replaced.
      setState({ phase: "applied" });
    } catch (applyError) {
      // A failed apply leaves the plan — and the token main accepts — untouched,
      // so the screen goes back to it rather than to idle.
      setState({ phase: "planned", preview, roles, plan, error: s.error });
      console.error("Nexus: failed to apply a statement import:", applyError);
    } finally {
      applying.current = false;
    }
  }

  async function cancel(): Promise<void> {
    setState({ phase: "idle", error: null });
    try {
      await window.nexus.cancelFinCsvImport();
    } catch (cancelError) {
      console.error("Nexus: failed to release the picked statement:", cancelError);
    }
  }

  const planned = state.phase === "planned" || state.phase === "applying";

  return (
    <div className="set__import-block">
      {showTitle && (
        <h3 className={titleClassName ?? "nx-eyebrow set__module-group-title"}>{s.title}</h3>
      )}
      <p className="nx-hint">{s.description}</p>

      {accounts.length === 0 ? (
        <p className="nx-hint">{s.noAccounts}</p>
      ) : (
        !planned &&
        state.phase !== "applied" && (
          <Button
            size="sm"
            variant="primary"
            disabled={state.phase === "picked" && state.busy}
            onClick={() => void choose()}
          >
            {s.pickButton}
          </Button>
        )
      )}

      {state.phase === "idle" && state.error != null && <p className="set__error">{state.error}</p>}

      {state.phase === "picked" && (
        <>
          <p className="nx-hint">
            {shared.pickedPrefix} <span className="app__path">{state.fileName}</span>
          </p>
          {state.busy && <p className="nx-hint">{s.reading}</p>}
          {state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "mapping" && (
        <FinCsvMappingDialog
          preview={state.preview}
          roles={state.roles}
          accounts={accounts}
          accountId={accountId}
          signConvention={signConvention}
          busy={state.busy}
          error={state.error}
          refusal={state.refusal}
          onRoleChange={(column, role) => {
            setState((previous) => {
              if (previous.phase !== "mapping") return previous;
              const roles = [...previous.roles];
              // A role means ONE column (the wire refuses a repeat), so claiming
              // it takes it away from whichever column held it.
              if (role !== "ignore") {
                for (let index = 0; index < roles.length; index += 1) {
                  if (index !== column && roles[index] === role) roles[index] = "ignore";
                }
              }
              roles[column] = role;
              // A refusal was about the PREVIOUS mapping; re-mapping is the
              // answer to it, so it stops being shown the moment one changes.
              return { ...previous, roles, refusal: null };
            });
          }}
          onDelimiterChange={(delimiter) =>
            void runPreview(state.preview.fileName, delimiter, state.preview.hasHeader)
          }
          onHeaderChange={(hasHeader) =>
            void runPreview(state.preview.fileName, state.preview.delimiter, hasHeader)
          }
          onAccountChange={setAccountId}
          onSignChange={setSignConvention}
          onConfirm={() => void confirmMapping()}
          onCancel={() => void cancel()}
        />
      )}

      {planned && (
        <>
          <div className="set__restore-head">
            <span className="app__path">{state.plan.fileName}</span>
            <span className="set__restore-meta">
              {s.accountPrefix} {state.plan.accountName} · {state.plan.currency}
            </span>
          </div>

          <table className="set__restore-table">
            <tbody>
              <tr>
                <th scope="row">{s.rowRows}</th>
                <td>{state.plan.rows}</td>
              </tr>
              <tr>
                <th scope="row">{s.rowTransactions}</th>
                <td>{state.plan.transactions}</td>
              </tr>
            </tbody>
          </table>
          {state.plan.blankRows > 0 && (
            <p className="nx-hint">
              {s.blankRowsPrefix} {state.plan.blankRows}
            </p>
          )}

          {/* How the file was READ. Said out loud rather than trusted: the two
              conventions were settled over whole columns, and the user is the
              only one who can tell us we settled them wrongly. */}
          <h4 className="nx-eyebrow set__module-group-title">{s.formatsTitle}</h4>
          <table className="set__restore-table">
            <tbody>
              <tr>
                <th scope="row">{s.amountFormatLabel}</th>
                <td>{s.amountFormats[state.plan.amountFormat]}</td>
              </tr>
              <tr>
                <th scope="row">{s.dateFormatLabel}</th>
                <td>{s.dateFormats[state.plan.dateFormat]}</td>
              </tr>
              <tr>
                <th scope="row">{s.signFormatLabel}</th>
                <td>{s.signs[state.plan.signConvention]}</td>
              </tr>
            </tbody>
          </table>

          {state.plan.skips.length > 0 && (
            <>
              <h4 className="nx-eyebrow set__module-group-title">{s.skipsTitle}</h4>
              <p className="nx-hint">{s.skipsCaption}</p>
              <ul className="set__restore-problems">
                {state.plan.skips.map((skip, index) => (
                  <li className="set__import-skip" key={`${skip.row}-${skip.code}-${index}`}>
                    <span className="set__import-skip-meta">
                      {s.dropRowPrefix} {skip.row}
                    </span>{" "}
                    {s.skips[skip.code]}
                  </li>
                ))}
              </ul>
            </>
          )}

          {state.plan.drops.length > 0 && (
            <>
              <h4 className="nx-eyebrow set__module-group-title">{s.dropsTitle}</h4>
              <ul className="set__restore-problems">
                {state.plan.drops.map((drop, index) => (
                  <li className="set__import-skip" key={`${drop.row}-${drop.code}-${index}`}>
                    <span className="set__import-skip-meta">
                      {s.dropRowPrefix} {drop.row}
                    </span>{" "}
                    {s.drops[drop.code]}
                  </li>
                ))}
              </ul>
            </>
          )}

          {state.phase === "planned" && state.error != null && (
            <p className="set__error">{state.error}</p>
          )}

          <div className="set__restore-actions">
            {state.plan.transactions > 0 ? (
              <Button
                size="sm"
                variant="primary"
                disabled={state.phase === "applying"}
                onClick={() => void apply(state.plan)}
              >
                {state.phase === "applying" ? s.applying : s.applyButton}
              </Button>
            ) : (
              <p className="nx-hint">{s.nothingToImport}</p>
            )}
            {state.phase === "planned" && (
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    setState({
                      phase: "mapping",
                      preview: state.preview,
                      roles: state.roles,
                      busy: false,
                      error: null,
                      refusal: null,
                    })
                  }
                >
                  {s.remapButton}
                </Button>
                <Button size="sm" onClick={() => void cancel()}>
                  {shared.cancelButton}
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {state.phase === "applied" && <p className="nx-hint">{s.applied}</p>}
    </div>
  );
}
