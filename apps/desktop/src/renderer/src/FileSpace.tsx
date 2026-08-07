import { MIME_FAMILIES, mimeFamily } from "@nexus/core";
import type { MimeFamily } from "@nexus/core";
import { ProportionBar } from "@nexus/ui";
import type { DocAttachmentEntry } from "../../shared/ipc.js";
import { formatFileSize } from "./fileRows.js";
import { countUnit, strings } from "./strings.js";

/**
 * „Šta zauzima prostor" — FILES's signature graphic: one bar per mime family,
 * sized by TOTAL BYTES rather than by file count — ten photographs and ten
 * text notes are not the same amount of disk, and a count would say they were.
 *
 * NOT WRAPPED IN `ChartFrame`. `ChartFrame` always emits an `<svg>` around its
 * children, and `ProportionBar` deliberately draws in HTML (see its own header
 * — a strip is a box in a box, and SVG would buy nothing here). So this builds
 * the same shell BY HAND, reusing `ChartFrame`'s own classes
 * (`nx-chart`/`nx-chart__title`/`nx-chart__caption`/`nx-chart__empty`) so it
 * still matches every other graphic in the app, with `role="group"` standing
 * in for the `role="img"` a real `<svg>` would have carried.
 *
 * THE FOUR FAMILIES ARE PARTS OF ONE WHOLE, NOT FOUR STATES: every bar is
 * `tone="data"`, and every one of the four is always drawn — a family with
 * nothing in it is a MEASURED zero (we know for a fact there are no bytes of
 * it among the entries on screen), not an absence of measurement, so
 * `unmeasured` never applies here.
 *
 * THE TRUNCATION FLOOR (`doc:list-attachments` caps at 500 newest entries).
 * When the caller's read was truncated these totals are a FLOOR, not a total,
 * and both the caption and the read-aloud sentence say so — a size total that
 * silently excluded older files would be the most quietly wrong figure in the
 * product.
 *
 * `entries` are exactly what the caller is showing below this graphic — no
 * second read happens here — so the bars and the rows they summarise can
 * never disagree about which files they are talking about.
 */

export interface FileSpaceProps {
  entries: readonly DocAttachmentEntry[];
  /** Whether the read this drew from hit the 500-entry cap — see the module header. */
  truncated: boolean;
}

export interface FamilySpace {
  family: MimeFamily;
  bytes: number;
  count: number;
}

/** One entry per `MIME_FAMILIES`, in that fixed order, summed from exactly the given entries. The one mime→family rule (`@nexus/core`'s `mimeFamily`) — the same one the filter chips and the store's SQL use — is reused rather than re-derived. */
export function familySpace(entries: readonly DocAttachmentEntry[]): readonly FamilySpace[] {
  const bytesByFamily = new Map<MimeFamily, number>();
  const countByFamily = new Map<MimeFamily, number>();
  for (const entry of entries) {
    const family = mimeFamily(entry.mime);
    bytesByFamily.set(family, (bytesByFamily.get(family) ?? 0) + entry.sizeBytes);
    countByFamily.set(family, (countByFamily.get(family) ?? 0) + 1);
  }
  return MIME_FAMILIES.map((family) => ({
    family,
    bytes: bytesByFamily.get(family) ?? 0,
    count: countByFamily.get(family) ?? 0,
  }));
}

/**
 * The read-aloud sentence, composed from exactly the totals the bars draw —
 * never a second guess at what they show. Absent (via `emptyReason`) when
 * every family is a genuine zero, per the chart-with-nothing-to-say rule.
 */
export function fileSpaceDescription(rows: readonly FamilySpace[], truncated: boolean): string {
  const s = strings.files.chart;
  const families = strings.files.families;
  if (!rows.some((row) => row.bytes > 0)) return s.emptyReason;
  const parts = rows.map((row) => `${families[row.family]} ${formatFileSize(row.bytes)}`).join(", ");
  return truncated ? `${s.truncatedCaption} ${parts}.` : `${s.descriptionLead}: ${parts}.`;
}

export function FileSpace({ entries, truncated }: FileSpaceProps) {
  const s = strings.files.chart;
  const families = strings.files.families;
  const fs = strings.files;

  const rows = familySpace(entries);
  const largest = Math.max(0, ...rows.map((row) => row.bytes));
  const hasData = largest > 0;
  const description = fileSpaceDescription(rows, truncated);

  return (
    <div className="nx-chart" role="group" aria-label={description}>
      <p className="nx-chart__title">{s.heading}</p>
      {hasData ? (
        <>
          {rows.map((row) => (
            <ProportionBar
              key={row.family}
              label={families[row.family]}
              value={`${formatFileSize(row.bytes)} · ${row.count} ${countUnit(
                row.count,
                fs.summaryUnitOne,
                fs.summaryUnitFew,
                fs.summaryUnitMany,
              )}`}
              segments={[
                {
                  key: row.family,
                  fraction: row.bytes / largest,
                  tone: "data",
                  label: `${families[row.family]} ${formatFileSize(row.bytes)}`,
                },
              ]}
            />
          ))}
          <p className="nx-chart__caption">{truncated ? s.truncatedCaption : s.caption}</p>
        </>
      ) : (
        <p className="nx-chart__empty">{s.emptyReason}</p>
      )}
    </div>
  );
}
