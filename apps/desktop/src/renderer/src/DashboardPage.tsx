import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentType, CSSProperties, DragEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { parseWidgetConfig, widgetChoice, widgetCount, widgetTaskLists } from "@nexus/core";
import type { ModuleRegistry, WidgetContract } from "@nexus/core";
import {
  Button,
  Card,
  EmptyState,
  Icon,
  LoadingState,
  PageHeader,
  Select,
  StatBand,
  TextField,
} from "@nexus/ui";
import type { Stat } from "@nexus/ui";
import { DASHBOARD_SET_NAME_MAX_LENGTH, DASHBOARD_WIDGET_SPANS } from "../../shared/ipc.js";
import type {
  DashboardSetsState,
  DashboardSetSummary,
  DashboardSettings,
  DashboardWidgetInstance,
  DashboardWidgetSize,
  Event,
  FocusSession,
  RunningFocusSession,
  Task,
  TaskList,
} from "../../shared/ipc.js";
import { buildCalendarItems, type CalendarSource } from "./calendarItems.js";
import { localMinutesOfDay, readStoredClock } from "./calendarPrefs.js";
import { lookupString, moveNeighbours, type LayoutNeighbours } from "./dashboardLayout.js";
import { resolveLabel } from "./moduleKit/labels.js";
import { moduleName } from "./moduleName.js";
import { dayStripLine } from "./dashboardStrip.js";
import { dashboardSummary } from "./dashboardSummary.js";
import { buildTaskListTree, flattenTaskListTree } from "./taskListTree.js";
import {
  dashboardWidgetRenderer,
  type DashboardWidgetBodyProps,
} from "./dashboardWidgets.js";
import { localTodayKey } from "./examDates.js";
import { formatDashboardDate } from "./dateLabels.js";
import { moduleIconName } from "./moduleIcon.js";
import { ModuleSettingsGear } from "./moduleSettingsGear.js";
import { NotePopover } from "./notePopover.js";
import { strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

/** Time-of-day salutation, personalized with the profile name when present. */
function greeting(name: string, hour: number): string {
  const g = strings.dashboard.greeting;
  const salutation = hour < 12 ? g.jutro : hour < 18 ? g.dan : g.vece;
  const trimmed = name.trim();
  return trimmed.length > 0 ? `${salutation}, ${trimmed}` : salutation;
}

/**
 * The day strip reads events and NOTHING else (DASH-009): a birthday or a task
 * is „Danas"'s business, and a line meant to say what is next must not be spent
 * on something that is not. Events go through the calendar merge all the same,
 * because a recurring series is one stored row that only the merge knows how to
 * expand into the occurrence falling today (ADR-024).
 */
const STRIP_SOURCES: ReadonlySet<CalendarSource> = new Set<CalendarSource>(["events"]);

/** How often the header re-reads the clock — the strip's whole refresh (DASH-009). */
const STRIP_TICK_MS = 60_000;

/**
 * The three size presets over the TWELVE-column grid the board switches to past
 * 1440px (`dashboard.css`), beside `DASHBOARD_WIDGET_SPANS`' six-column
 * reading.
 *
 * A preset is a FRACTION of the row, and six columns can only express those
 * fractions at one card width: at 1600px „Srednja" was a 700-pixel card holding
 * a 34-pixel row, which is not a medium card. Twelve columns give the same
 * three fractions a tighter reading — a quarter, a third, the whole — so three
 * medium cards share a row on a wide window and every card's height variance
 * falls with its width. Both custom properties are set on every card and CSS
 * picks which one is in force, so nothing here measures a window.
 */
const DASHBOARD_WIDGET_SPANS_WIDE: Record<DashboardWidgetSize, number> = { S: 3, M: 4, L: 12 };

/** The name of a widget: a compiled-in module's `strings` key, or a discovered module's own pair (`resolveLabel`). */
function widgetTitle(contract: WidgetContract): string {
  return resolveLabel(contract.title);
}

/** The preset a newly placed widget takes: the medium one when it accepts it, the first it does otherwise. */
function defaultSize(contract: WidgetContract): DashboardWidgetSize {
  return contract.sizes.includes("M") ? "M" : (contract.sizes[0] ?? "M");
}

/** One placement resolved into everything needed to draw it — the page skips whatever does not resolve. */
interface PlacedWidget {
  entry: DashboardWidgetInstance;
  contract: WidgetContract;
  Body: ComponentType<DashboardWidgetBodyProps>;
}

/** What the „Podesi…" form sends: the canonical non-default fields, `{}` to clear — the wire's own shape. */
type WidgetConfigPayload = Record<string, number | string | string[]>;

interface WidgetMenuProps {
  /** The card this menu belongs to, so its "⋯" has a name of its own among five. */
  title: string;
  contract: WidgetContract;
  size: DashboardWidgetSize;
  /** Whose task lists the config form offers — the one field kind that reads live data. */
  profileId: string;
  /** The placement's stored config text — what the „Podesi…" form edits. */
  config: string | null;
  /** Where a step up / down would land the card, or null at that end of the layout. */
  up: LayoutNeighbours | null;
  down: LayoutNeighbours | null;
  onMove: (step: LayoutNeighbours) => void;
  onResize: (size: DashboardWidgetSize) => void;
  onConfigure: (config: WidgetConfigPayload) => void;
  onRemove: () => void;
}

/**
 * The edit-mode "⋯" on one card: move it, resize it, configure it (when its
 * contract declares fields — ADR-059), take it off (ADR-045 section 5). A menu
 * of plain focusable buttons, the `MoveMenu` shape TASK-004 established —
 * which is what gives the whole edit mode keyboard parity with the drag by
 * construction, rather than as a second implementation.
 *
 * An item at an end of the layout is DISABLED, never dropped: a menu whose items
 * come and go is one the user has to re-read on every open.
 */
function WidgetMenu(props: WidgetMenuProps) {
  return (
    <NotePopover
      label={`${strings.dashboard.edit.menuLabel}: ${props.title}`}
      triggerClassName="dash__widget-menu"
    >
      {(close) => <WidgetMenuContent {...props} close={close} />}
    </NotePopover>
  );
}

/**
 * The panel's content, a component of its own so „Podesi…" can flip the SAME
 * popover into the config form and back — and so the mode resets with the
 * panel: the popover unmounts its children when it closes, which is exactly
 * the lifetime the flag should have.
 */
function WidgetMenuContent({
  contract,
  size,
  profileId,
  config,
  up,
  down,
  onMove,
  onResize,
  onConfigure,
  onRemove,
  close,
}: WidgetMenuProps & { close: () => void }) {
  const s = strings.dashboard.edit;
  const [configuring, setConfiguring] = useState(false);

  if (configuring) {
    return (
      <WidgetConfigForm
        profileId={profileId}
        contract={contract}
        config={config}
        onApply={onConfigure}
        onBack={() => setConfiguring(false)}
      />
    );
  }

  const step = (text: string, target: LayoutNeighbours | null): ReactNode => (
    <button
      className="note__menu-item"
      role="menuitem"
      type="button"
      disabled={target === null}
      onClick={() => {
        if (target !== null) onMove(target);
        close();
      }}
    >
      {text}
    </button>
  );

  return (
    <>
      {step(s.moveUp, up)}
      {step(s.moveDown, down)}
      <div className="note__menu-sep" role="separator" />
      <span className="note__menu-label">{s.sizeLabel}</span>
      {/* Only the presets this widget publishes: a size it cannot honour is
          precisely what `WidgetContract.sizes` exists to withhold. */}
      {contract.sizes.map((preset) => (
        <button
          key={preset}
          className="note__menu-item note__menu-item--check"
          role="menuitemradio"
          type="button"
          aria-checked={preset === size}
          onClick={() => {
            if (preset !== size) onResize(preset);
            close();
          }}
        >
          <span
            className={`note__menu-check${preset === size ? "" : " note__menu-check--hidden"}`}
            aria-hidden="true"
          >
            <Icon name="check" size={14} />
          </span>
          {s.size[preset]}
        </button>
      ))}
      {/* „Podesi…" appears only where a choice exists (ADR-059): a contract
          declaring no fields gets no entry, not a disabled one — there is no
          state in which it could become available. */}
      {(contract.configFields?.length ?? 0) > 0 && (
        <>
          <div className="note__menu-sep" role="separator" />
          <button
            className="note__menu-item"
            role="menuitem"
            type="button"
            onClick={() => setConfiguring(true)}
          >
            {strings.dashboard.config.open}
          </button>
        </>
      )}
      <div className="note__menu-sep" role="separator" />
      <button
        className="note__menu-item note__menu-item--danger"
        role="menuitem"
        type="button"
        onClick={() => {
          onRemove();
          close();
        }}
      >
        {s.remove}
      </button>
    </>
  );
}

/** The select value standing for a count's out-of-range „no cap" default — never stored, only shown. */
const COUNT_ALL_VALUE = "sve";

interface WidgetConfigFormProps {
  profileId: string;
  contract: WidgetContract;
  config: string | null;
  onApply: (config: WidgetConfigPayload) => void;
  onBack: () => void;
}

/**
 * The generic per-widget config form (DASH-004 / ADR-059), drawn INSIDE the
 * card's ⋯ popover from nothing but the contract's `configFields`: a count is
 * the settings page's select over its range, a choice is the size-preset radio
 * idiom, and the task-list field is a checkbox list over the profile's LIVE
 * lists. Every change applies IMMEDIATELY — the settings page's own manner —
 * by sending the whole canonical config (non-default fields only), which main
 * revalidates against the same declaration.
 *
 * Current values come from `parseWidgetConfig` over the stored text, dead list
 * selections dropped once the live lists are known — so the form always shows
 * what the card is actually doing, config rot included.
 */
function WidgetConfigForm({ profileId, contract, config, onApply, onBack }: WidgetConfigFormProps) {
  const s = strings.dashboard.config;
  // Every count field's name is already on screen as the menu label above it,
  // so the select is named BY that label rather than by a second rendered copy
  // of the same word. One generated prefix per form, suffixed by the field key.
  const labelId = useId();
  const fields = contract.configFields ?? [];
  const needsLists = fields.some((field) => field.kind === "taskLists");
  const [taskLists, setTaskLists] = useState<TaskList[] | null>(null);
  const [listsFailed, setListsFailed] = useState(false);

  useEffect(() => {
    if (!needsLists) return;
    let active = true;
    void (async () => {
      try {
        const snapshot = await window.nexus.listTaskLists(profileId);
        if (active) setTaskLists(snapshot.lists);
      } catch (error) {
        if (active) setListsFailed(true);
        console.error("Nexus: failed to load the task lists for a widget's config:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, needsLists]);

  const values = parseWidgetConfig(
    contract,
    config,
    taskLists !== null ? { liveTaskListIds: new Set(taskLists.map((list) => list.id)) } : {},
  );

  /** The canonical payload: every field's current value with `key` overridden, default-equal fields left out. */
  const apply = (key: string, value: number | string | string[]): void => {
    const next: WidgetConfigPayload = {};
    for (const field of fields) {
      const held = field.key === key ? value : values[field.key];
      if (held === undefined) continue;
      const isDefault =
        (field.kind === "count" && held === field.default) ||
        (field.kind === "choice" && held === field.default) ||
        (field.kind === "taskLists" && Array.isArray(held) && held.length === 0);
      if (!isDefault) next[field.key] = held;
    }
    onApply(next);
  };

  const fieldLabel = (key: string): string =>
    lookupString(strings, `dashboard.config.fields.${key}`) ?? key;
  const check = (on: boolean): ReactNode => (
    <span className={`note__menu-check${on ? "" : " note__menu-check--hidden"}`} aria-hidden="true">
      <Icon name="check" size={14} />
    </span>
  );

  return (
    <>
      <button className="note__menu-item" role="menuitem" type="button" onClick={onBack}>
        <Icon name="chevronLeft" size={14} /> {s.back}
      </button>
      {fields.map((field) => {
        if (field.kind === "count") {
          const current = widgetCount(values, field.key);
          // A default outside the range means "uncapped as shipped" — the
          // select then leads with „Sve", which clears the field back to it.
          const uncappedDefault = !Number.isInteger(field.default);
          const range: number[] = [];
          for (let n = field.min; n <= field.max; n += 1) range.push(n);
          return (
            <Fragment key={field.key}>
              <span className="note__menu-label" id={`${labelId}-${field.key}`}>
                {fieldLabel(field.key)}
              </span>
              {/* The wrapper carries the inset, not the control: the drawn
                  chevron is positioned against the control's own box, so a
                  right margin on the control would put the arrow outside it. */}
              <div className="dash__config-field">
                <Select
                  aria-labelledby={`${labelId}-${field.key}`}
                  value={Number.isInteger(current) ? String(current) : COUNT_ALL_VALUE}
                  onChange={(event) =>
                    apply(
                      field.key,
                      event.target.value === COUNT_ALL_VALUE
                        ? field.default
                        : Number(event.target.value),
                    )
                  }
                >
                  {uncappedDefault && <option value={COUNT_ALL_VALUE}>{s.countAll}</option>}
                  {range.map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
            </Fragment>
          );
        }
        if (field.kind === "choice") {
          const current = widgetChoice(values, field.key);
          return (
            <Fragment key={field.key}>
              <span className="note__menu-label">{fieldLabel(field.key)}</span>
              {field.options.map((option) => (
                <button
                  key={option.id}
                  className="note__menu-item note__menu-item--check"
                  role="menuitemradio"
                  type="button"
                  aria-checked={option.id === current}
                  onClick={() => {
                    if (option.id !== current) apply(field.key, option.id);
                  }}
                >
                  {check(option.id === current)}
                  {resolveLabel(option.labelKey)}
                </button>
              ))}
            </Fragment>
          );
        }
        const selection = widgetTaskLists(values, field.key);
        const selected = new Set(selection);
        return (
          <Fragment key={field.key}>
            <span className="note__menu-label">{fieldLabel(field.key)}</span>
            {listsFailed ? (
              <p className="note__menu-caption">{s.listsError}</p>
            ) : taskLists === null ? (
              <p className="note__menu-caption">{strings.app.loading}</p>
            ) : (
              <>
                {/* The empty selection IS "all lists" (ADR-059), so it is drawn
                    as the leading answer rather than left implicit. */}
                <button
                  className="note__menu-item note__menu-item--check"
                  role="menuitemradio"
                  type="button"
                  aria-checked={selection.length === 0}
                  onClick={() => {
                    if (selection.length > 0) apply(field.key, []);
                  }}
                >
                  {check(selection.length === 0)}
                  {s.allLists}
                </button>
                {/* The rail's own order and indent, through the rail's own
                    helper. A flat run of names was ambiguous the moment two
                    lists under different parents shared one — and the store's
                    `ORDER BY parent_id, position, id` is not a reading order:
                    a child sorts by its parent's id, not under its parent. */}
                {flattenTaskListTree(buildTaskListTree(taskLists)).map(({ list, depth }) => {
                  const on = selected.has(list.id);
                  return (
                    <button
                      key={list.id}
                      className="note__menu-item note__menu-item--check dash__config-list-row"
                      role="menuitemcheckbox"
                      type="button"
                      aria-checked={on}
                      style={{ "--task-depth": depth } as CSSProperties}
                      onClick={() =>
                        apply(
                          field.key,
                          on
                            ? selection.filter((id) => id !== list.id)
                            : [...selection, list.id],
                        )
                      }
                    >
                      {check(on)}
                      {list.name}
                    </button>
                  );
                })}
              </>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/** What the board name line is naming: a fresh board, or one being renamed. */
type SetEditor = { mode: "create" } | { mode: "rename"; setId: string };

interface DashboardSetDeleteDialogProps {
  set: DashboardSetSummary;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * „Obriši tablu“ (DASH-008 / ADR-055) — the house confirm, the recipe
 * `NoteCardsDeleteDialog` and the recurrence-scope question share verbatim.
 * What goes is the board's ARRANGEMENT; the content its cards read lives in the
 * modules and is untouched, and the question says so, because that is what
 * makes it answerable. No default: focus lands on the one choice, Enter picks
 * nothing until it is focused, and Escape, the backdrop and Otkaži all cancel.
 */
function DashboardSetDeleteDialog({ set, onConfirm, onCancel }: DashboardSetDeleteDialogProps) {
  const s = strings.dashboard.sets.deleteDialog;
  const titleId = useId();
  const questionId = useId();

  // Focus lands on the one choice, not on a default — the trap's own default
  // (the first tabbable descendant), since the choice comes before „Otkaži".
  // It also cycles Tab within the panel and hands focus back on close.
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onCancel} />
      <div
        ref={panelRef}
        className="recur-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={questionId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.title}
        </h2>
        <p className="recur-dialog__name">„{set.name}“</p>
        <p id={questionId} className="nx-hint">
          {s.question}
        </p>
        <div className="recur-dialog__choices">
          <Button className="recur-dialog__choice" onClick={onConfirm}>
            {s.confirm}
          </Button>
        </div>
        <div className="recur-dialog__actions">
          <Button className="recur-dialog__cancel" onClick={onCancel}>
            {s.cancel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface WidgetGalleryProps {
  registry: ModuleRegistry;
  enabledModules: ReadonlySet<string>;
  /** Qualified ids already on the layout — v1 places a widget once (ADR-045 section 5). */
  placed: ReadonlySet<string>;
  onAdd: (widgetId: string, size: DashboardWidgetSize) => void;
  onClose: () => void;
}

/**
 * „Dodaj vidžet" — every widget the ENABLED modules publish, grouped by the
 * module that owns it (`ModuleRegistry.widgetsOf`). One already on the layout is
 * shown DISABLED and marked „već dodat" rather than hidden, so the gallery reads
 * as a catalogue of what exists and not as a list that quietly shrinks.
 *
 * The house dialog recipe, shared outright with the recurrence-scope question
 * and the shortcuts reference: backdrop and panel as siblings, Escape and the
 * backdrop close, focus lands inside and returns where it came from, no glow.
 * It stays open after an add, because adding two widgets is one errand.
 */
function WidgetGallery({
  registry,
  enabledModules,
  placed,
  onAdd,
  onClose,
}: WidgetGalleryProps) {
  const s = strings.dashboard.gallery;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Focus lands on „Zatvori", not on the first „Dodaj": the body is a
  // scrollable catalogue of add actions, and the trap's own default (the
  // first tabbable descendant) would land there — reachable from the
  // keyboard, but Enter would silently place a widget before it is read.
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true, initialFocusRef: closeButtonRef });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // A registered widget this build cannot draw is left out: offering it would
  // add a placement that renders nothing (ADR-045 section 3).
  const groups = registry
    .all()
    .filter((manifest) => enabledModules.has(manifest.id))
    .map((manifest) => ({
      manifest,
      widgets: registry
        .widgetsOf(manifest.id)
        .filter((widget) => dashboardWidgetRenderer(`${manifest.id}:${widget.id}`) !== undefined),
    }))
    .filter((group) => group.widgets.length > 0);

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="recur-dialog__panel dash-gallery__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.title}
        </h2>

        {groups.length === 0 ? (
          <p className="nx-hint">{s.empty}</p>
        ) : (
          <div className="dash-gallery__body">
            {groups.map(({ manifest, widgets }) => (
              <section key={manifest.id} className="dash-gallery__group">
                <h3 className="nx-eyebrow set__module-group-title">
                  {moduleName(manifest.id)}
                </h3>
                {widgets.map((widget) => {
                  const qualified = `${manifest.id}:${widget.id}`;
                  const already = placed.has(qualified);
                  return (
                    <div key={qualified} className="dash-gallery__row">
                      <span className="dash-gallery__name">{widgetTitle(widget)}</span>
                      {already && <span className="dash-gallery__added">{s.added}</span>}
                      <Button
                        size="sm"
                        disabled={already}
                        onClick={() => onAdd(qualified, defaultSize(widget))}
                      >
                        {s.add}
                      </Button>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}

        <div className="recur-dialog__actions">
          <Button ref={closeButtonRef} className="recur-dialog__cancel" onClick={onClose}>
            {s.close}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface DashboardPageProps {
  profileId: string;
  profileName: string;
  /** The module catalogue (ADR-008) — what a placement's `moduleId:widgetId` resolves against. */
  registry: ModuleRegistry;
  /** Modules enabled by SET-007 flags; a disabled module's widgets draw nothing and fetch nothing. */
  enabledModules: ReadonlySet<string>;
  onOpenModule: (id: string) => void;
  /** Opens one note (021-e's reveal intent) — what „Nedavne beleške"'s rows deep-link with. */
  onOpenNote: (noteId: string) => void;
}

/**
 * The DASH home surface: a personalized greeting over the profile's own widget
 * layout (DASH-002 / ADR-045). The page holds the LAYOUT and nothing else — the
 * cards are components that own their reads (`dashboardWidgets.tsx`), so a
 * failing card fails alone and there is no page-wide loading gate left to hold
 * anything up.
 *
 * Edit mode is the second half: „Uredi" grows a strip on every card with a "⋯"
 * menu (move / resize / remove) and a drag grip, and „Dodaj vidžet" opens the
 * gallery. Every mutation answers with the WHOLE resulting layout, which is what
 * gets stored in state — the renderer never patches an entry locally, because a
 * move can re-space its neighbours.
 */
export function DashboardPage({
  profileId,
  profileName,
  registry,
  enabledModules,
  onOpenModule,
  onOpenNote,
}: DashboardPageProps) {
  const [layout, setLayout] = useState<DashboardWidgetInstance[] | null>(null);
  const [layoutFailed, setLayoutFailed] = useState(false);
  const [layoutAttempt, setLayoutAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // The named boards and which one is showing (DASH-008 / ADR-055). Loaded
  // before the layout — the layout IS the active board's — but a failed read
  // falls back to „Početna“ rather than holding the page hostage: the switcher
  // is navigation, and the default board always exists because it is not a row.
  const [setsState, setSetsState] = useState<DashboardSetsState | null>(null);
  const [setsActionFailed, setSetsActionFailed] = useState(false);
  // The inline name line (create / rename) the switcher row becomes, and the
  // draft it edits — the tasks-rail naming idiom, one surface over.
  const [setEditor, setSetEditor] = useState<SetEditor | null>(null);
  const [setDraft, setSetDraft] = useState("");
  const [deleteSetPrompt, setDeleteSetPrompt] = useState<DashboardSetSummary | null>(null);
  // A write that did not land, and the one thing the store does that the user
  // could not have predicted: removing the last widget brings the default back.
  const [actionFailed, setActionFailed] = useState(false);
  const [defaultRestored, setDefaultRestored] = useState(false);
  // The momentary "just landed" mark. Carries a sequence number so moving the
  // same card twice re-runs the animation instead of leaving a finished one on.
  const [landed, setLanded] = useState<{ instanceId: string; seq: number } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  // The custom background (SET-006 / ADR-041). Loaded on its own, NOT joined to
  // the layout below: it is decoration, and decoration must never be able to
  // hold up — or fail — the data the page exists to show.
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings | null>(null);
  // The day strip's own small read (DASH-009), and the clock it is drawn
  // against. `now` is state rather than a fresh `new Date()` per render for one
  // reason: the strip has to change as the day moves under it, and a value the
  // header re-derives only when something else happens to re-render would be
  // stale exactly when nobody is touching the page. Everything else in the
  // header — the salutation, the date line — rides the same tick and is now
  // correct across noon and midnight for free.
  const [now, setNow] = useState(() => new Date());
  // Everything the HEADER is drawn from — the day strip's events and running
  // phase (DASH-009), and since the summary band the two lists its figures are
  // counted from. One state and one effect, because they are one read: they all
  // describe today and they all become stale at the same instant.
  const [header, setHeader] = useState<{
    events: readonly Event[];
    focus: RunningFocusSession | null;
    /** Null when TASK is off — which is why a switched-off module draws no figure at all. */
    tasks: readonly Task[] | null;
    /** Null when neither owning module is on, for the same reason. */
    focusSessions: readonly FocusSession[] | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.dashboardSettings(profileId);
        if (active) setDashboardSettings(next);
      } catch (error) {
        console.error("Nexus: failed to load the dashboard background:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), STRIP_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Read into booleans first, the idiom every widget's `load` follows:
  // `enabledModules` is a fresh `Set` on each of App's renders, so an effect
  // depending on it directly would re-read on every one of them.
  const calendarOn = enabledModules.has("calendar");
  // The one timer has TWO owning modules since UTIL slice b, so the strip reads
  // it when either is on. Gating on STUDY alone would have hidden a running
  // Pomodoro from somebody who switched „Učenje" off — which is exactly the
  // profile most likely to be running one.
  const focusOn = enabledModules.has("study") || enabledModules.has("focus");
  const tasksOn = enabledModules.has("tasks");

  // Today's day key comes off the SAME reading the header is drawn against, so
  // the two can never disagree for a minute across midnight. Derived above the
  // read below because it is one of that read's dependencies: it changes value
  // exactly once a day, which is precisely when the figures counted from it
  // stop being about today.
  const todayKey = localTodayKey(now);

  // Read ONCE per profile and day, not on the tick: none of this changes while
  // the page is open — the events do not, and a phase or a task can only be
  // started from a module page, which means leaving this one and coming back to
  // it. What the tick recomputes is the READING of that data: which event is
  // still ahead, how long the phase has run.
  //
  // The header does NOT ride a card's fetch: the page holds no widget data at
  // all (ADR-045 section 4), and reaching into a card's read to feed the header
  // is precisely the coupling that boundary exists to prevent. The price is a
  // handful of extra reads per open, each a local SQLite call away — and every
  // one of them is gated on its module, so a profile with TASK off pays nothing
  // and, more importantly, is shown no figure rather than a zero.
  //
  // Decoration-adjacent, like the background above: a failure here renders
  // NOTHING and never a message. The header must not grow a red line because a
  // caption or a count could not be drawn — the nine cards below each report
  // their own failure, and they are what the page is for.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [events, focus, tasks, focusSessions] = await Promise.all([
          calendarOn ? window.nexus.listEvents(profileId) : [],
          focusOn ? window.nexus.focusStatus(profileId) : null,
          tasksOn ? window.nexus.listTasks(profileId) : null,
          focusOn ? window.nexus.listFocusRange(profileId, todayKey, todayKey) : null,
        ]);
        if (active) setHeader({ events, focus, tasks, focusSessions });
      } catch (error) {
        console.error("Nexus: failed to load the dashboard header:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, calendarOn, focusOn, tasksOn, todayKey]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.dashboardSets(profileId);
        if (active) setSetsState(next);
      } catch (error) {
        if (active) setSetsState({ sets: [], activeSetId: null });
        console.error("Nexus: failed to load the dashboard sets:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // The board actually showing: the stored choice when it still names a listed
  // board, „Početna“ (null) otherwise — a defensive read, since a delete clears
  // the pointer in the same transaction and nothing should ever dangle here.
  const sets = setsState?.sets ?? [];
  const activeSet = sets.find((set) => set.id === setsState?.activeSetId) ?? null;
  const activeSetId = activeSet?.id ?? null;
  const setsLoaded = setsState !== null;

  useEffect(() => {
    if (!setsLoaded) return; // which board's layout to read is not known yet
    let active = true;
    // Cleared up front so a board switch never shows the previous board's cards
    // under the new board's name while the read is in flight.
    setLayout(null);
    void (async () => {
      try {
        const next = await window.nexus.dashboardWidgets(profileId, activeSetId);
        if (!active) return;
        setLayout(next);
        setLayoutFailed(false);
      } catch (error) {
        if (active) setLayoutFailed(true);
        console.error("Nexus: failed to load the dashboard layout:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, layoutAttempt, setsLoaded, activeSetId]);

  /**
   * Runs one layout write and stores the layout it answers with. Every channel
   * answers with the whole arrangement (ADR-045 section 1), so this is also the
   * only place the layout is ever set from a mutation.
   */
  async function runLayout(
    write: () => Promise<DashboardWidgetInstance[]>,
  ): Promise<DashboardWidgetInstance[] | null> {
    setActionFailed(false);
    setDefaultRestored(false);
    try {
      const next = await write();
      setLayout(next);
      return next;
    } catch (error) {
      setActionFailed(true);
      console.error("Nexus: failed to change the dashboard layout:", error);
      return null;
    }
  }

  function mark(instanceId: string): void {
    setLanded((previous) => ({ instanceId, seq: (previous?.seq ?? 0) + 1 }));
  }

  async function moveWidget(instanceId: string, step: LayoutNeighbours): Promise<void> {
    const next = await runLayout(() =>
      window.nexus.moveDashboardWidget(
        profileId,
        instanceId,
        step.beforeId,
        step.afterId,
        activeSetId,
      ),
    );
    if (next !== null) mark(instanceId);
  }

  async function resizeWidget(instanceId: string, size: DashboardWidgetSize): Promise<void> {
    await runLayout(() =>
      window.nexus.setDashboardWidgetSize(profileId, instanceId, size, activeSetId),
    );
  }

  async function configureWidget(
    instanceId: string,
    config: Record<string, number | string | string[]>,
  ): Promise<void> {
    await runLayout(() =>
      window.nexus.setDashboardWidgetConfig(profileId, instanceId, config, activeSetId),
    );
  }

  async function removeWidget(instanceId: string): Promise<void> {
    // Said out loud the moment it happens: no rows IS the default arrangement,
    // so taking the last card off is also how a user resets (the store's
    // documented semantics, per board since ADR-055) — and nothing else on
    // screen would explain the five cards that just came back.
    const wasLast = layout !== null && layout.length === 1;
    const next = await runLayout(() =>
      window.nexus.removeDashboardWidget(profileId, instanceId, activeSetId),
    );
    if (next !== null && wasLast && next.length > 0) setDefaultRestored(true);
  }

  async function addWidget(widgetId: string, size: DashboardWidgetSize): Promise<void> {
    const next = await runLayout(() =>
      window.nexus.addDashboardWidget(profileId, widgetId, size, activeSetId),
    );
    const added = next?.at(-1);
    if (added !== undefined) mark(added.instanceId);
  }

  // --- Named boards (DASH-008 / ADR-055) ------------------------------------

  /** Runs one sets write and stores the state it answers with — every set channel answers whole, `runLayout`'s twin. */
  async function runSets(
    write: () => Promise<DashboardSetsState>,
  ): Promise<DashboardSetsState | null> {
    setSetsActionFailed(false);
    try {
      const next = await write();
      setSetsState(next);
      return next;
    } catch (error) {
      setSetsActionFailed(true);
      console.error("Nexus: failed to change the dashboard sets:", error);
      return null;
    }
  }

  async function chooseSet(setId: string | null): Promise<void> {
    if (setId === activeSetId) return;
    // A switch is a navigation: the previous board's notices do not describe
    // the one about to draw.
    setDefaultRestored(false);
    setActionFailed(false);
    await runSets(() => window.nexus.setActiveDashboardSet(profileId, setId));
  }

  function openSetEditor(editor: SetEditor): void {
    setSetEditor(editor);
    setSetDraft(
      editor.mode === "rename"
        ? (sets.find((set) => set.id === editor.setId)?.name ?? "")
        : "",
    );
  }

  function closeSetEditor(): void {
    setSetEditor(null);
    setSetDraft("");
  }

  async function submitSetName(): Promise<void> {
    if (setEditor === null) return;
    const name = setDraft.trim();
    if (name.length === 0) return;
    if (setEditor.mode === "create") {
      setSetsActionFailed(false);
      try {
        const created = await window.nexus.createDashboardSet(profileId, name);
        setSetsState(created);
        // A board is made to be used: switching to it right away is the one
        // feedback that says it exists, and it starts on the default
        // arrangement (an EMPTY set IS the default, per set).
        await runSets(() =>
          window.nexus.setActiveDashboardSet(profileId, created.createdSetId),
        );
      } catch (error) {
        setSetsActionFailed(true);
        console.error("Nexus: failed to create a dashboard set:", error);
      }
    } else {
      await runSets(() => window.nexus.renameDashboardSet(profileId, setEditor.setId, name));
    }
    closeSetEditor();
  }

  async function deleteSet(set: DashboardSetSummary): Promise<void> {
    // The store clears the active pointer in the same transaction, so the
    // answered state already reads „Početna“ when the deleted board was showing.
    await runSets(() => window.nexus.deleteDashboardSet(profileId, set.id));
  }

  // --- Drag & drop (edit mode) ----------------------------------------------
  //
  // Native HTML5 drag, the idiom the task list and the month grid already use:
  // the dragged card travels as renderer state (the dataTransfer payload exists
  // only because Firefox refuses to start a drag without one), and a drop target
  // signals with an accent border and a soft background — never a glow. The grip
  // is the card's title strip, so the drag image is set to the whole card:
  // dragging a title around would say nothing about what is being moved.

  function startDrag(event: DragEvent<HTMLElement>, instanceId: string): void {
    setDraggedId(instanceId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", instanceId);
    const card = event.currentTarget.closest(".dash__widget");
    if (card instanceof HTMLElement) {
      const rect = card.getBoundingClientRect();
      event.dataTransfer.setDragImage(card, event.clientX - rect.left, event.clientY - rect.top);
    }
  }

  function endDrag(): void {
    setDraggedId(null);
    setDropId(null);
  }

  function dragOverCard(event: DragEvent<HTMLElement>, instanceId: string): void {
    if (draggedId === null || draggedId === instanceId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropId !== instanceId) setDropId(instanceId);
  }

  function dragLeaveCard(event: DragEvent<HTMLElement>, instanceId: string): void {
    // Only when the pointer really left this card — a `dragleave` fired by
    // moving onto a child would otherwise drop the highlight mid-hover.
    if (dropId === instanceId && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropId(null);
    }
  }

  function dropOnCard(
    event: DragEvent<HTMLElement>,
    order: readonly string[],
    instanceId: string,
  ): void {
    event.preventDefault();
    const dragged = draggedId;
    endDrag();
    if (dragged === null) return;
    const step = moveNeighbours(order, order.indexOf(dragged), order.indexOf(instanceId));
    if (step !== null) void moveWidget(dragged, step);
  }

  function leaveEdit(): void {
    setEditing(false);
    setGalleryOpen(false);
    setActionFailed(false);
    setDefaultRestored(false);
    setSetsActionFailed(false);
    setDeleteSetPrompt(null);
    closeSetEditor();
    endDrag();
  }

  const dateLine = formatDashboardDate(now);

  // Merged once per read, not once per tick: expanding the recurring masters is
  // the only real work here, and it depends on the events and the day — never
  // on the minute. What the tick then costs is one pass over the result.
  const stripItems = useMemo(
    () =>
      header === null
        ? []
        : buildCalendarItems(
            // `overlay` stays empty by design: the cross-profile read is the
            // calendar grid's alone (CAL-005) — the dashboard never shows it.
            {
              events: header.events,
              tasks: [],
              exams: [],
              blocks: [],
              subjects: [],
              people: [],
              overlay: [],
              renewals: [],
            },
            STRIP_SOURCES,
            { from: todayKey, to: todayKey },
          ),
    [header, todayKey],
  );
  const stripLine =
    header === null
      ? null
      : dayStripLine({
          items: stripItems,
          todayKey,
          nowMinutes: localMinutesOfDay(now),
          nowMs: now.getTime(),
          // CAL §5: the strip is pure, so the device preference is read HERE
          // and handed in — the same clock „Danas“ below draws its rows on.
          clock: readStoredClock(),
          focus: header.focus,
        });
  // The date and — when there is one — what is next, as ONE subtitle line under
  // the greeting, joined by the house separator. Two stacked muted lines under a
  // heading is two secondary levels where the type scale allows one.
  const headerLine = stripLine === null ? dateLine : `${dateLine} · ${stripLine}`;

  // The summary band: „kako stojim?" answered before „šta mi je na spisku?".
  //
  // Every figure is COUNTED, from rows this page itself read, through the owning
  // module's own predicate — nothing here is estimated and nothing is a
  // projection. A figure whose module is off is `null` all the way from the
  // read to here and is simply not pushed, because „0 događaja danas" is a claim
  // about an empty calendar and a calendar that is not installed has made none.
  // `header === null` is the read still being in flight, and it has to answer
  // `null` too: `stripItems` is an empty array until the events land, and a
  // figure that reads „0" for the first moments of every open would be the band
  // stating something it does not yet know. The other three are already null
  // while loading, for free.
  const counts = dashboardSummary({
    items: header !== null && calendarOn ? stripItems : null,
    todayKey,
    tasks: header?.tasks ?? null,
    focusSessions: header?.focusSessions ?? null,
  });
  const sm = strings.dashboard.summary;
  const summaryStats: Stat[] = [];
  if (counts.eventsToday !== null) {
    summaryStats.push({ label: sm.eventsToday, value: String(counts.eventsToday) });
  }
  if (counts.tasksToday !== null) {
    summaryStats.push({ label: sm.tasksToday, value: String(counts.tasksToday) });
  }
  if (counts.tasksLate !== null) {
    summaryStats.push({
      label: sm.tasksLate,
      value: String(counts.tasksLate),
      // Tinted only when the number is actually bad news. A „Kasni: 0" in
      // garnet would be the band shouting about the one thing that went right.
      ...(counts.tasksLate > 0 ? { tone: "danger" as const } : {}),
    });
  }
  if (counts.focusMinutes !== null) {
    summaryStats.push({
      label: sm.focus,
      value: String(counts.focusMinutes),
      unit: sm.focusUnit,
      // The figure counts SESSIONS, and a phase becomes a session when it is
      // stopped — so while one runs the total is a lower bound, and says so.
      // Drawn only then: a permanent caveat is one nobody reads.
      ...(header?.focus != null ? { note: sm.focusRunningNote } : {}),
    });
  }

  // Two layers behind the content when a background is set (ADR-041 section 5):
  // the image itself, cover/centered, and a scrim whose fill IS the theme's own
  // page background — so Dan dims toward warm paper and Noć toward blue-black
  // with no new colour value anywhere. No background set renders exactly
  // today's dashboard: no layers, no frame, nothing.
  const background =
    dashboardSettings !== null && dashboardSettings.backgroundHash !== null
      ? { hash: dashboardSettings.backgroundHash, dim: dashboardSettings.backgroundDim }
      : null;

  // What actually draws, in layout order. A placement whose widget this build
  // does not publish, or whose module is switched off, resolves to nothing and
  // is silently skipped — it stays in storage and comes back with its module.
  const placed: PlacedWidget[] = (layout ?? []).flatMap((entry) => {
    const contract = registry.findWidget(entry.widgetId);
    const renderer = dashboardWidgetRenderer(entry.widgetId);
    return contract !== undefined && renderer !== undefined && renderer.visible(enabledModules)
      ? [{ entry, contract, Body: renderer.Body }]
      : [];
  });
  const order = placed.map((item) => item.entry.instanceId);
  const placedWidgetIds = new Set((layout ?? []).map((entry) => entry.widgetId));
  const s = strings.dashboard;

  return (
    <div className={`dash${background !== null ? " dash--framed" : ""}`}>
      {background !== null && (
        <>
          <div
            className="dash__bg"
            style={{ backgroundImage: `url("nx-blob://${background.hash}")` }}
            aria-hidden="true"
          />
          <div className="dash__scrim" style={{ opacity: background.dim / 100 }} aria-hidden="true" />
        </>
      )}
      {/* The house page header, the same one the other fourteen pages open with
          (`PageHeader`). This surface used to have a header of its own: a 32px
          greeting with the board switcher sitting on its baseline as loose text,
          and the date and the day strip stacked as two separate muted lines
          under it. That is four type sizes and a control that did not look like
          one, on the first screen anybody sees — so it is the shared component
          now, and the dashboard's own copy is only what goes IN it: whose day it
          is, what day it is, and what is next. */}
      <PageHeader
        className="dash__header"
        title={greeting(profileName, now.getHours())}
        subtitle={headerLine}
        sigil="dashboard"
        actions={
          <>
            {/* The board switcher (DASH-008 / ADR-055). It reads as a CONTROL —
                a mark, the active board's name, a chevron, at the height of the
                button beside it — because that is what it is; the popover behind
                it keeps the typographic active entry (gold + weight), never a
                pill and never a glow. While a name is being typed, the control's
                spot IS the name line, the tasks-rail idiom. */}
            {setsLoaded &&
              (setEditor !== null ? (
                <form
                  className="dash__set-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitSetName();
                  }}
                >
                  <TextField
                    value={setDraft}
                    placeholder={strings.dashboard.sets.namePlaceholder}
                    aria-label={
                      setEditor.mode === "create"
                        ? strings.dashboard.sets.createLabel
                        : strings.dashboard.sets.renameLabel
                    }
                    maxLength={DASHBOARD_SET_NAME_MAX_LENGTH}
                    autoFocus
                    onChange={(event) => setSetDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        closeSetEditor();
                      }
                    }}
                  />
                  <Button type="submit" size="sm" variant="primary">
                    {strings.dashboard.sets.save}
                  </Button>
                  <Button type="button" size="sm" onClick={closeSetEditor}>
                    {strings.dashboard.sets.cancel}
                  </Button>
                </form>
              ) : (
                <>
                  <NotePopover
                    label={strings.dashboard.sets.switcherLabel}
                    triggerClassName="dash__set-switcher"
                    triggerContent={
                      <>
                        <Icon name="dashboard" size={14} />
                        <span className="dash__set-name">
                          {activeSet?.name ?? strings.dashboard.sets.defaultName}
                        </span>
                        <Icon name="chevronDown" size={12} />
                      </>
                    }
                  >
                    {(close) => (
                      <>
                        {[
                          { id: null as string | null, name: strings.dashboard.sets.defaultName },
                          ...sets,
                        ].map((entry) => {
                          const isActive = entry.id === activeSetId;
                          return (
                            <button
                              key={entry.id ?? "pocetna"}
                              className={`note__menu-item note__menu-item--check${isActive ? " dash__set-item--active" : ""}`}
                              role="menuitemradio"
                              type="button"
                              aria-checked={isActive}
                              onClick={() => {
                                void chooseSet(entry.id);
                                close();
                              }}
                            >
                              <span
                                className={`note__menu-check${isActive ? "" : " note__menu-check--hidden"}`}
                                aria-hidden="true"
                              >
                                <Icon name="check" size={14} />
                              </span>
                              {entry.name}
                            </button>
                          );
                        })}
                        {editing && (
                          <>
                            <div className="note__menu-sep" role="separator" />
                            <button
                              className="note__menu-item"
                              role="menuitem"
                              type="button"
                              onClick={() => {
                                close();
                                openSetEditor({ mode: "create" });
                              }}
                            >
                              {strings.dashboard.sets.create}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </NotePopover>
                  {/* Manage — EDIT MODE only (ADR-055): create always, rename and
                      delete only for a named board. „Početna“ offers neither,
                      because it is not a row — the items stay drawn, disabled,
                      so the menu never has to be re-read. */}
                  {editing && (
                    <NotePopover
                      label={strings.dashboard.sets.manageLabel}
                      triggerClassName="dash__set-manage"
                    >
                      {(close) => (
                        <>
                          <button
                            className="note__menu-item"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              close();
                              openSetEditor({ mode: "create" });
                            }}
                          >
                            {strings.dashboard.sets.create}
                          </button>
                          <button
                            className="note__menu-item"
                            role="menuitem"
                            type="button"
                            disabled={activeSet === null}
                            onClick={() => {
                              if (activeSet !== null) {
                                openSetEditor({ mode: "rename", setId: activeSet.id });
                              }
                              close();
                            }}
                          >
                            {strings.dashboard.sets.rename}
                          </button>
                          <div className="note__menu-sep" role="separator" />
                          <button
                            className="note__menu-item note__menu-item--danger"
                            role="menuitem"
                            type="button"
                            disabled={activeSet === null}
                            onClick={() => {
                              if (activeSet !== null) setDeleteSetPrompt(activeSet);
                              close();
                            }}
                          >
                            {strings.dashboard.sets.remove}
                          </button>
                        </>
                      )}
                    </NotePopover>
                  )}
                </>
              ))}
            {editing ? (
              <>
                <Button size="sm" onClick={() => setGalleryOpen(true)}>
                  {s.edit.add}
                </Button>
                <Button size="sm" onClick={leaveEdit}>
                  {s.edit.done}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setEditing(true)}>
                {s.edit.enter}
              </Button>
            )}
            <ModuleSettingsGear moduleId="dashboard" />
          </>
        }
      />

      {/* „Kako stojim?" before „šta mi je na spisku?". Drawn only when at least
          one module could answer — a band of nothing is a hairline across the
          page saying that some modules are switched off, which nobody asked. */}
      {summaryStats.length > 0 && <StatBand stats={summaryStats} />}

      {(layoutFailed || actionFailed || setsActionFailed || defaultRestored) && (
        <div className="dash__notices">
          {layoutFailed && (
            <p className="nx-hint dash__status" role="alert">
              {s.layoutError}
              <Button size="sm" onClick={() => setLayoutAttempt((value) => value + 1)}>
                {s.widget.retry}
              </Button>
            </p>
          )}
          {actionFailed && (
            <p className="nx-hint dash__status" role="alert">
              {s.edit.failed}
            </p>
          )}
          {setsActionFailed && (
            <p className="nx-hint dash__status" role="alert">
              {s.sets.failed}
            </p>
          )}
          {defaultRestored && (
            <p className="nx-hint dash__status" role="status">
              {s.edit.defaultRestored}
            </p>
          )}
        </div>
      )}

      {/* Three states rather than one. The board used to render nothing at
          all while `layout` was null and an empty grid when it held no
          cards — and to somebody who has just opened the app those two look
          exactly alike, which is to say like a product that failed to
          start. */}
      {layout === null && <LoadingState label={strings.app.loading} rows={4} />}
      {layout !== null && placed.length === 0 && (
        <EmptyState title={s.emptyTitle} description={s.emptyDescription} />
      )}
      {layout !== null && placed.length > 0 && (
        <div className="dash__grid">
          {placed.map(({ entry, contract, Body }, index) => {
            const title = widgetTitle(contract);
            const classes = ["dash__widget"];
            if (draggedId === entry.instanceId) classes.push("dash__widget--dragging");
            if (dropId === entry.instanceId) classes.push("dash__widget--drop");
            // The module the placement belongs to, from the module half of its
            // qualified id — the same split `DASHBOARD_WIDGETS` is keyed on.
            const sigil = moduleIconName(entry.widgetId.split(":")[0] ?? "");
            return (
              <Card
                key={entry.instanceId}
                className={classes.join(" ")}
                // Both readings of the preset, so which one applies is a pure
                // CSS decision (see `DASHBOARD_WIDGET_SPANS_WIDE`).
                style={
                  {
                    "--dash-span": DASHBOARD_WIDGET_SPANS[entry.size],
                    "--dash-span-wide": DASHBOARD_WIDGET_SPANS_WIDE[entry.size],
                  } as CSSProperties
                }
                onDragOver={editing ? (event) => dragOverCard(event, entry.instanceId) : undefined}
                onDragLeave={editing ? (event) => dragLeaveCard(event, entry.instanceId) : undefined}
                onDrop={editing ? (event) => dropOnCard(event, order, entry.instanceId) : undefined}
              >
                {/* ONE head for both modes. Until 2026-08-08 the card drew its
                    own caption while reading and a separate „strip" while
                    editing — two elements holding the same words at the same
                    size, differing only in what sat beside them. The mark is
                    what the head gained by being written once: nine cards that
                    differ only in an 11px caption are a wall of text. */}
                <div className="dash__widget-head">
                  {sigil !== undefined && (
                    <span className="dash__widget-sigil" aria-hidden="true">
                      <Icon name={sigil} size={14} />
                    </span>
                  )}
                  {editing ? (
                    <span
                      className="nx-card__title dash__widget-grip"
                      draggable
                      title={s.edit.dragHint}
                      onDragStart={(event) => startDrag(event, entry.instanceId)}
                      onDragEnd={endDrag}
                    >
                      {title}
                    </span>
                  ) : (
                    <span className="nx-card__title">{title}</span>
                  )}
                  {editing && (
                    <WidgetMenu
                      title={title}
                      contract={contract}
                      size={entry.size}
                      profileId={profileId}
                      config={entry.config}
                      up={moveNeighbours(order, index, index - 1)}
                      down={moveNeighbours(order, index, index + 1)}
                      onMove={(step) => void moveWidget(entry.instanceId, step)}
                      onResize={(size) => void resizeWidget(entry.instanceId, size)}
                      onConfigure={(config) => void configureWidget(entry.instanceId, config)}
                      onRemove={() => void removeWidget(entry.instanceId)}
                    />
                  )}
                </div>
                <Body
                  profileId={profileId}
                  enabledModules={enabledModules}
                  contract={contract}
                  config={entry.config}
                  onOpenModule={onOpenModule}
                  onOpenNote={onOpenNote}
                />
                {landed?.instanceId === entry.instanceId && (
                  <span
                    key={landed.seq}
                    className="dash__widget-mark"
                    aria-hidden="true"
                    onAnimationEnd={() => setLanded(null)}
                  />
                )}
              </Card>
            );
          })}
        </div>
      )}

      {galleryOpen && (
        <WidgetGallery
          registry={registry}
          enabledModules={enabledModules}
          placed={placedWidgetIds}
          onAdd={(widgetId, size) => void addWidget(widgetId, size)}
          onClose={() => setGalleryOpen(false)}
        />
      )}

      {deleteSetPrompt !== null && (
        <DashboardSetDeleteDialog
          set={deleteSetPrompt}
          onConfirm={() => {
            const doomed = deleteSetPrompt;
            setDeleteSetPrompt(null);
            void deleteSet(doomed);
          }}
          onCancel={() => setDeleteSetPrompt(null)}
        />
      )}
    </div>
  );
}
