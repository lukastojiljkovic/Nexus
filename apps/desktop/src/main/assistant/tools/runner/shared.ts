import type { AssistantLocale, AssistantText, ToolSpec } from "@nexus/core";
import { numberFormat, text } from "../support.js";

/**
 * One tool the assistant can run: its inputs, and the figures the same pure core
 * call its surface makes. A runner computes and does not decide — no runner phrases
 * a verdict, and a tool whose class forbids one (`toolForbidsVerdict`) has no runner
 * at all, so `drawer.run` refuses it with a pointer to the page.
 */
export interface ToolRunner {
  /** The inputs, as a closed schema of numbers, enums and small arrays. `drawer.run` checks the model's values against it. */
  readonly params: ToolSpec["parameters"];
  /**
   * Whether the tool's page takes these inputs as its opening values (`drawer.open`'s
   * `values`). Only the pages that read the prefill context do, so `drawer.open` refuses
   * values for the rest rather than accepting them and drawing nothing.
   */
  readonly prefills?: true;
  /**
   * The figures for checked inputs, one line each, or `null` when the arithmetic
   * has no answer for them (a zero divisor, a loan that cannot be amortised).
   */
  readonly run: (
    values: Readonly<Record<string, unknown>>,
    locale: AssistantLocale,
  ) => readonly string[] | null;
}

/** One labelled figure, in the reader's language: „Neto: 1.000,00". */
export function figure(locale: AssistantLocale, label: AssistantText, value: string): string {
  return `${text(locale, label)}: ${value}`;
}

/** A money figure to two decimals, in the locale's own separators. */
export function money(locale: AssistantLocale, value: number): string {
  return numberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** A quantity to three decimals — the width `formatNumber` gives every other tool result. */
export function quantity(locale: AssistantLocale, value: number): string {
  return numberFormat(locale, { maximumFractionDigits: 3 }).format(value);
}
