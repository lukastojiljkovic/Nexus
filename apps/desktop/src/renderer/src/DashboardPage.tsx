import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentType, CSSProperties, DragEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ModuleRegistry, WidgetContract } from "@nexus/core";
import { Button, Card } from "@nexus/ui";
import { DASHBOARD_WIDGET_SPANS } from "../../shared/ipc.js";
import type {
  DashboardSettings,
  DashboardWidgetInstance,
  DashboardWidgetSize,
  Event,
  RunningFocusSession,
} from "../../shared/ipc.js";
import { buildCalendarItems, type CalendarSource } from "./calendarItems.js";
import { lookupString, moveNeighbours, type LayoutNeighbours } from "./dashboardLayout.js";
import { dayStripLine } from "./dashboardStrip.js";
import { DASHBOARD_WIDGETS, type DashboardWidgetBodyProps } from "./dashboardWidgets.js";
import { localTodayKey } from "./examDates.js";
import { NotePopover } from "./notePopover.js";
import { strings } from "./strings.js";

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

/** The Serbian name of a widget, from the strings KEY its contract publishes. */
function widgetTitle(contract: WidgetContract): string {
  return lookupString(strings, contract.title) ?? contract.title;
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

interface WidgetMenuProps {
  /** The card this menu belongs to, so its "⋯" has a name of its own among five. */
  title: string;
  contract: WidgetContract;
  size: DashboardWidgetSize;
  /** Where a step up / down would land the card, or null at that end of the layout. */
  up: LayoutNeighbours | null;
  down: LayoutNeighbours | null;
  onMove: (step: LayoutNeighbours) => void;
  onResize: (size: DashboardWidgetSize) => void;
  onRemove: () => void;
}

/**
 * The edit-mode "⋯" on one card: move it, resize it, take it off (ADR-045
 * section 5). A menu of plain focusable buttons, the `MoveMenu` shape TASK-004
 * established — which is what gives the whole edit mode keyboard parity with the
 * drag by construction, rather than as a second implementation.
 *
 * An item at an end of the layout is DISABLED, never dropped: a menu whose items
 * come and go is one the user has to re-read on every open.
 */
function WidgetMenu({
  title,
  contract,
  size,
  up,
  down,
  onMove,
  onResize,
  onRemove,
}: WidgetMenuProps) {
  const s = strings.dashboard.edit;
  const step = (text: string, target: LayoutNeighbours | null, close: () => void): ReactNode => (
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
    <NotePopover label={`${s.menuLabel}: ${title}`} triggerClassName="dash__widget-menu">
      {(close) => (
        <>
          {step(s.moveUp, up, close)}
          {step(s.moveDown, down, close)}
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
                ✓
              </span>
              {s.size[preset]}
            </button>
          ))}
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
      )}
    </NotePopover>
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
  const actionsRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actionsRef.current?.querySelector("button")?.focus();
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, []);

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
        .filter((widget) => `${manifest.id}:${widget.id}` in DASHBOARD_WIDGETS),
    }))
    .filter((group) => group.widgets.length > 0);

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        className="recur-dialog__panel dash-gallery__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.title}
        </h2>

        {groups.length === 0 ? (
          <p className="recur-dialog__question">{s.empty}</p>
        ) : (
          <div className="dash-gallery__body">
            {groups.map(({ manifest, widgets }) => (
              <section key={manifest.id} className="dash-gallery__group">
                <h3 className="set__module-group-title">
                  {strings.modules[manifest.id] ?? manifest.id}
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

        <div className="recur-dialog__actions" ref={actionsRef}>
          <Button className="recur-dialog__cancel" onClick={onClose}>
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
  const [strip, setStrip] = useState<{
    events: readonly Event[];
    focus: RunningFocusSession | null;
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
  const studyOn = enabledModules.has("study");

  // Read ONCE per profile, not on the tick: the events do not change while the
  // page is open, and the running timer can only be started from STUDY — which
  // means leaving this page and coming back to it. What the tick recomputes is
  // the READING of that data: which event is still ahead, how long the timer
  // has run.
  //
  // The strip does NOT ride the „Danas" card's fetch: the page holds no widget
  // data at all (ADR-045 section 4), and reaching into a card's read to feed
  // the header is precisely the coupling that boundary exists to prevent. The
  // price is one extra `listEvents` per open, a local SQLite call away.
  //
  // Decoration-adjacent, like the background above: a failure here renders
  // NOTHING and never a message. The header must not grow a red line because a
  // caption could not be drawn.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [events, focus] = await Promise.all([
          calendarOn ? window.nexus.listEvents(profileId) : [],
          studyOn ? window.nexus.focusStatus(profileId) : null,
        ]);
        if (active) setStrip({ events, focus });
      } catch (error) {
        console.error("Nexus: failed to load the dashboard day strip:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, calendarOn, studyOn]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.dashboardWidgets(profileId);
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
  }, [profileId, layoutAttempt]);

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
      window.nexus.moveDashboardWidget(profileId, instanceId, step.beforeId, step.afterId),
    );
    if (next !== null) mark(instanceId);
  }

  async function resizeWidget(instanceId: string, size: DashboardWidgetSize): Promise<void> {
    await runLayout(() => window.nexus.setDashboardWidgetSize(profileId, instanceId, size));
  }

  async function removeWidget(instanceId: string): Promise<void> {
    // Said out loud the moment it happens: no rows IS the default arrangement,
    // so taking the last card off is also how a user resets (the store's
    // documented semantics) — and nothing else on screen would explain the five
    // cards that just came back.
    const wasLast = layout !== null && layout.length === 1;
    const next = await runLayout(() => window.nexus.removeDashboardWidget(profileId, instanceId));
    if (next !== null && wasLast && next.length > 0) setDefaultRestored(true);
  }

  async function addWidget(widgetId: string, size: DashboardWidgetSize): Promise<void> {
    const next = await runLayout(() => window.nexus.addDashboardWidget(profileId, widgetId, size));
    const added = next?.at(-1);
    if (added !== undefined) mark(added.instanceId);
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
    endDrag();
  }

  const dateLine = new Intl.DateTimeFormat("sr-Latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  // Today's day key comes off the SAME reading the strip is drawn against, so
  // the two can never disagree for a minute across midnight.
  const todayKey = localTodayKey(now);
  // Merged once per read, not once per tick: expanding the recurring masters is
  // the only real work here, and it depends on the events and the day — never
  // on the minute. What the tick then costs is one pass over the result.
  const stripItems = useMemo(
    () =>
      strip === null
        ? []
        : buildCalendarItems(
            { events: strip.events, tasks: [], exams: [], blocks: [], subjects: [], people: [] },
            STRIP_SOURCES,
            { from: todayKey, to: todayKey },
          ),
    [strip, todayKey],
  );
  const stripLine =
    strip === null
      ? null
      : dayStripLine({
          items: stripItems,
          todayKey,
          nowMinutes: now.getHours() * 60 + now.getMinutes(),
          nowMs: now.getTime(),
          focus: strip.focus,
        });

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
    const renderer = DASHBOARD_WIDGETS[entry.widgetId];
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
      <div className="dash__topbar">
        <header className="dash__greeting">
          <h1 className="dash__hello">{greeting(profileName, now.getHours())}</h1>
          <p className="dash__date">{dateLine}</p>
          {/* Nothing to say ⇒ no element at all (DASH-009). A caption that
              persists to announce its own emptiness is an empty state, and the
              strip is not one. */}
          {stripLine !== null && <p className="dash__strip">{stripLine}</p>}
        </header>
        <div className="dash__tools">
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
        </div>
      </div>

      {(layoutFailed || actionFailed || defaultRestored) && (
        <div className="dash__notices">
          {layoutFailed && (
            <p className="dash__status" role="alert">
              {s.layoutError}
              <Button size="sm" onClick={() => setLayoutAttempt((value) => value + 1)}>
                {s.widget.retry}
              </Button>
            </p>
          )}
          {actionFailed && (
            <p className="dash__status" role="alert">
              {s.edit.failed}
            </p>
          )}
          {defaultRestored && (
            <p className="dash__status" role="status">
              {s.edit.defaultRestored}
            </p>
          )}
        </div>
      )}

      {layout !== null && (
        <div className="dash__grid">
          {placed.map(({ entry, contract, Body }, index) => {
            const title = widgetTitle(contract);
            const classes = ["dash__widget"];
            if (draggedId === entry.instanceId) classes.push("dash__widget--dragging");
            if (dropId === entry.instanceId) classes.push("dash__widget--drop");
            // In edit mode the title moves into the strip below, beside the "⋯",
            // so the card's own caption is withheld rather than drawn twice.
            return (
              <Card
                key={entry.instanceId}
                className={classes.join(" ")}
                style={{ "--dash-span": DASHBOARD_WIDGET_SPANS[entry.size] } as CSSProperties}
                {...(editing ? {} : { title })}
                onDragOver={editing ? (event) => dragOverCard(event, entry.instanceId) : undefined}
                onDragLeave={editing ? (event) => dragLeaveCard(event, entry.instanceId) : undefined}
                onDrop={editing ? (event) => dropOnCard(event, order, entry.instanceId) : undefined}
              >
                {editing && (
                  <div className="dash__widget-strip">
                    <span
                      className="nx-card__title dash__widget-grip"
                      draggable
                      title={s.edit.dragHint}
                      onDragStart={(event) => startDrag(event, entry.instanceId)}
                      onDragEnd={endDrag}
                    >
                      {title}
                    </span>
                    <WidgetMenu
                      title={title}
                      contract={contract}
                      size={entry.size}
                      up={moveNeighbours(order, index, index - 1)}
                      down={moveNeighbours(order, index, index + 1)}
                      onMove={(step) => void moveWidget(entry.instanceId, step)}
                      onResize={(size) => void resizeWidget(entry.instanceId, size)}
                      onRemove={() => void removeWidget(entry.instanceId)}
                    />
                  </div>
                )}
                <Body
                  profileId={profileId}
                  enabledModules={enabledModules}
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
    </div>
  );
}
