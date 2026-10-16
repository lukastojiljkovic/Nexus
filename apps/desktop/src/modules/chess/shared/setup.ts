/**
 * The setup form's vocabulary, shared by both halves (ADR-117).
 *
 * The page offers these clocks and levels, and the assistant's `chess.start` tool
 * opens a new game with them, so the two lists live here: a clock the tool may
 * name is one the form offers, and a payload the page accepts is one the tool can
 * build. The page re-checks every START payload it is handed (`parseChessStart`),
 * because the shell carries it as data and reads neither field.
 */

import { CHESS_LEVELS } from "@nexus/core";

/**
 * The controls a person is most likely to want, as text, in the order they are
 * offered. Bullet through classical, which is the span the common sites use; the
 * custom fields are the answer for anything else.
 */
export const COMMON_TIME_CONTROLS: readonly string[] = [
  "60+0",
  "180+0",
  "180+2",
  "300+0",
  "600+0",
  "600+5",
  "900+10",
  "1800+0",
];

/** The action name a `chess` location carries to open a new game on the page. */
export const CHESS_START_ACTION = "start";

/** The clock value that starts a game without one. The form's own word for it is an empty choice. */
export const NO_CLOCK = "none";

export const START_COLORS = ["white", "black"] as const;
export const START_OPPONENTS = ["engine", "human"] as const;

export interface ChessStartRequest {
  readonly color: (typeof START_COLORS)[number];
  readonly opponent: (typeof START_OPPONENTS)[number];
  /** Only meaningful against the engine; a request that omits it keeps the form's own level. */
  readonly level?: number;
  /** One of `COMMON_TIME_CONTROLS`, or `NO_CLOCK`; omitted keeps the form's own clock. */
  readonly time?: string;
}

/**
 * The START request a payload carries, or `null` for a payload the form would not
 * accept. Pure, so the page's one decision about an action is testable on its own.
 */
export function parseChessStart(value: unknown): ChessStartRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Readonly<Record<string, unknown>>;
  const { color, opponent, level, time } = raw;
  if (!(START_COLORS as readonly unknown[]).includes(color)) return null;
  if (!(START_OPPONENTS as readonly unknown[]).includes(opponent)) return null;
  if (level !== undefined && !isLevel(level)) return null;
  if (time !== undefined && !isClock(time)) return null;
  return {
    color: color as ChessStartRequest["color"],
    opponent: opponent as ChessStartRequest["opponent"],
    ...(level === undefined ? {} : { level }),
    ...(time === undefined ? {} : { time }),
  };
}

function isLevel(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= CHESS_LEVELS.length
  );
}

function isClock(value: unknown): value is string {
  return value === NO_CLOCK || (typeof value === "string" && COMMON_TIME_CONTROLS.includes(value));
}
