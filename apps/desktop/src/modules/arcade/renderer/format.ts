import { numberFormat } from "../../../renderer/src/intl.js";

/**
 * The four figures the arcade shows, formatted through the shell's own `Intl`
 * door so the active language decides every separator (ADR-090).
 *
 * **A time is read in two shapes and neither is invented.** Under a minute it is
 * seconds with a tenth ("41,5 s"), which is the readout a Minesweeper player
 * watches; from a minute up it is `m:ss min`, because "300,0 s" is a number
 * nobody converts in their head. The tenth is TRUNCATED rather than rounded, on
 * the timers module's own rule: a clock that showed 12,4 before 12,4 had happened
 * would be claiming time the player has not spent.
 *
 * **A count is grouped and a whole number.** `Intl` is what knows that Serbian
 * groups thousands with a full stop, so this file never spells a separator.
 */

/** Whole seconds and tenths, truncated: the value every time readout starts from. */
function tenths(ms: number): { readonly tenths: number; readonly seconds: number } {
  const truncated = Math.max(0, Math.floor(ms / 100));
  return { tenths: truncated, seconds: truncated / 10 };
}

/** A finished game's time, in the two shapes the interface reads it in. */
export function formatBestTime(ms: number): string {
  const { tenths: value, seconds } = tenths(ms);
  if (seconds < 60) {
    return `${numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }).format(seconds)} s`;
  }
  const whole = Math.floor(value / 10);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return `${minutes}:${rest} min`;
}

/** A running clock on the Minesweeper board, which never shows more than `m:ss`. */
export function formatElapsed(ms: number): string {
  const whole = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A score, a line count, a level count, a number of moves: a grouped whole number in the active language. */
export function formatCount(value: number): string {
  return numberFormat().format(value);
}
