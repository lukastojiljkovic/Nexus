import { useEffect, useState } from "react";
import { SpanLanes } from "@nexus/ui";
import type { ChartTone } from "@nexus/ui";
import type { SpanLanesLane } from "@nexus/ui";
import type { DocumentRenewal, DocumentStatus, TrackedDocument } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/**
 * „Rokovi" — DOC's signature graphic: every tracked document as a lane on one
 * horizon, with today standing in it as the single reference line.
 *
 * A LIST answers each document on its own — „ističe za 41 dan", „ističe za 58
 * dana" — and leaves the reader to hold four numbers in their head to notice
 * that three things fall due in the same fortnight. A horizon says it by
 * POSITION, before any of them turns red.
 *
 * **A lane's LENGTH is only drawn where the store actually knows it.** A
 * document carries an expiry and nothing else; when its current period BEGAN is
 * recorded only if a renewal wrote it down (`DocumentRenewal.renewedAt`, the
 * day the previous expiry was replaced). So a document with renewal history
 * gets a span from that day to its expiry, and one entered once gets a MARK at
 * the expiry and no bar. Drawing a bar from an invented start — the creation
 * date of the row, say, which is when somebody typed it into Nexus and not when
 * the passport was issued — would be a fabricated interval, and the one this
 * chart would be most trusted about.
 *
 * **The x axis is DAYS FROM TODAY**, negative to the left. That keeps the
 * reference line at exactly 0 without any date arithmetic in the drawing, and
 * it is the unit the module already speaks in everywhere else
 * (`daysUntilExpiry`, the reminder ladders).
 *
 * **Tone is the store's own status, never a re-derived one.** `TrackedDocument`
 * carries `status` and `daysUntilExpiry` already computed at read time; this
 * reads them. A second opinion about whether something has expired is how a
 * chip and a chart start disagreeing on the day it matters.
 */

const MS_PER_DAY = 86_400_000;

/**
 * The lane gutter, and how much of a label fits in it.
 *
 * `SpanLanes` draws each lane's name as a bare `<text x="4">` and starts the
 * track at 84 user units — and it neither measures nor truncates, while
 * `.nx-chart__svg` is `overflow: visible`, so a name that outruns the gutter is
 * not clipped: it is painted straight across the bars, over the neighbouring
 * lanes' names, and past the edge of the figure onto the rows underneath it.
 * Serbian document names run long — „Zdravstvena knjižica", „Registracija
 * vozila" — so this is the ordinary case, not the pathological one.
 *
 * The component takes a string, so the only honest place to bound it is here,
 * where the string is chosen. Characters rather than pixels because there is no
 * measurement available in a pure render, and the estimate is stable: at
 * `--nx-font-size-caption` (11px) in the UI face an average glyph is a little
 * under half an em, so 80 units of usable gutter holds about fifteen, and
 * fourteen plus the ellipsis stays inside that on the wide letters too.
 *
 * The count is only true while one user unit is one CSS pixel, which is what
 * `.documents__chart` pins by giving the figure exactly the 720px `SpanLanes`
 * is handed below.
 *
 * NOTHING IS LOST BY SHORTENING IT. Every document drawn here is also a row in
 * the list directly beneath, under its full name — the chart is the shortcut
 * and the rows are the truth — and the terminus dot at the end of each lane
 * carries the full name plus its status as its own `<title>`.
 */
// `SpanLanes` shortens a lane label to what its own gutter holds, and keeps the
// full string reachable as a `<title>` on the same element. This file used to
// do it here — which was the first copy of a rule every future caller would
// have written again, and worse: shortening BEFORE handing the label over left
// the component titling the already-shortened text, so the way back to the
// whole name was gone.

/** How far past today the horizon reaches when nothing pushes it further — a year, which is the span most of these documents are issued for. */
const MIN_FUTURE_DAYS = 365;
/** And how far back, so a lane that expired last month is still visibly in the past rather than pinned against the edge. */
const MIN_PAST_DAYS = 30;

/**
 * Which of the three roles a status wears. `ok` takes `data` (jade) rather than
 * `accent`: the accent is what draws the eye, and the eye belongs on the two
 * that need doing something about.
 */
const STATUS_TONE: Record<DocumentStatus, ChartTone> = {
  ok: "data",
  uskoro: "accent",
  istekao: "danger",
};

/** Whole days from `today` to a bare day key, negative for the past. UTC throughout, like every bare date in this house. */
function daysFrom(today: string, day: string): number {
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / MS_PER_DAY);
}

export interface DocDeadlinesProps {
  profileId: string;
  documents: readonly TrackedDocument[];
  today: string;
}

export function DocDeadlines({ profileId, documents, today }: DocDeadlinesProps) {
  const s = strings.documents.chart;
  const statusLabel = strings.documents.status;

  /**
   * The renewal history of every document, read here rather than lifted into
   * the panel.
   *
   * The panel reads renewals for the ONE row a user expanded, which is the
   * right shape for a detail view and the wrong one for a horizon that draws
   * every lane at once. One call per document is N round trips, and N is a
   * handful — an identity card, a passport, a licence, a registration, a card,
   * a policy. It is a read the panel does not need and this chart cannot do
   * without, so it belongs here.
   *
   * A failed read is NOT an error state: it costs the spans and keeps every
   * mark, which is a horizon missing its bars rather than a blank panel. The
   * expiry is the fact this chart exists for, and it comes from the document
   * row itself.
   */
  const [renewals, setRenewals] = useState<ReadonlyMap<string, DocumentRenewal[]>>(new Map());
  const ids = documents.map((document) => document.id).join(",");
  useEffect(() => {
    const list = ids === "" ? [] : ids.split(",");
    if (list.length === 0) {
      setRenewals(new Map());
      return;
    }
    let active = true;
    void (async () => {
      try {
        const found = await Promise.all(
          list.map(async (id) => [id, await window.nexus.listDocumentRenewals(profileId, id)] as const),
        );
        if (active) setRenewals(new Map(found));
      } catch (error) {
        console.error("Nexus: failed to read the renewal history for the deadline horizon:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, ids]);

  const lanes: SpanLanesLane[] = documents.map((document) => {
    const expiresIn = daysFrom(today, document.expiryDate);
    const tone = STATUS_TONE[document.status];
    // The latest renewal is when the CURRENT period began. `renewedAt` is a
    // full instant, so it is cut to its day before the arithmetic.
    const history = renewals.get(document.id) ?? [];
    const latest = history.reduce<DocumentRenewal | null>(
      (best, entry) => (best === null || entry.renewedAt > best.renewedAt ? entry : best),
      null,
    );
    // The hover text keeps the name in full — it is the truncated lane label's
    // way back to what was cut, as well as the status the lane's tone encodes.
    const label = `${document.label} · ${statusLabel[document.status]}`;
    return {
      key: document.id,
      label: document.label,
      tone,
      spans:
        latest === null
          ? []
          : [{ from: daysFrom(today, latest.renewedAt.slice(0, 10)), to: expiresIn, tone, label }],
      // The expiry is a terminus whether or not a bar reaches it: it is the
      // fact the whole module is about, and a document with no renewal history
      // must not read as having no deadline.
      marks: [{ at: expiresIn, kind: "terminus" as const, label }],
    };
  });

  // The window: everything drawn, plus enough room on both sides that the
  // reference line is never against an edge.
  let earliest = -MIN_PAST_DAYS;
  let latest = MIN_FUTURE_DAYS;
  for (const lane of lanes) {
    for (const span of lane.spans) {
      earliest = Math.min(earliest, span.from);
      if (typeof span.to === "number") latest = Math.max(latest, span.to);
    }
    for (const mark of lane.marks) {
      earliest = Math.min(earliest, mark.at);
      latest = Math.max(latest, mark.at);
    }
  }

  // The finding, from the very documents the lanes are drawn from: how many,
  // how many have already lapsed, and how far off the next one is.
  const expired = documents.filter((document) => document.status === "istekao").length;
  const upcoming = documents
    .filter((document) => document.status !== "istekao")
    .map((document) => document.daysUntilExpiry)
    .sort((a, b) => a - b);
  const soonest = upcoming[0];
  const description =
    `${s.descriptionLead}: ${String(documents.length)} ${s.descriptionDocuments}, ` +
    `${s.descriptionExpired} ${String(expired)}` +
    (soonest === undefined ? "." : `, ${s.descriptionSoonest} ${String(soonest)}.`);

  // `documents__chart` is what gives the horizon a block of its own: 720px —
  // exactly the `width` handed to `SpanLanes` below, so one user unit is one
  // CSS pixel and the component's own lane-label arithmetic holds — and
  // `flex: none`, so the list under it can never squeeze the figure into its
  // own caption.
  return (
    <div className="nx-chart-group documents__chart">
      <SpanLanes
        title={s.heading}
        description={description}
        caption={s.caption}
        empty={documents.length === 0 ? { reason: s.emptyReason } : null}
        domain={[earliest, latest]}
        lanes={lanes}
        rule={{ at: 0, label: s.todayLabel, tone: "neutral" }}
        width={720}
      />
    </div>
  );
}
