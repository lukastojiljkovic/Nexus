/** The sources the page can be pointed at, and the only ones an assistant action may name. */
export const SCAN_SOURCES = ["file", "camera"] as const;

export type ScanSource = (typeof SCAN_SOURCES)[number];

/**
 * The source an `source` action asks the page to point at, or `null` for a payload
 * this page does not know. The page points at the control and never starts the
 * camera itself: an assistant action must not open a device.
 */
export function sourceOfAction(payload: unknown): ScanSource | null {
  const source = typeof payload === "object" && payload !== null ? (payload as { source?: unknown }).source : undefined;
  return SCAN_SOURCES.find((candidate) => candidate === source) ?? null;
}
