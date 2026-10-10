/**
 * Opening an address in the user's browser (ADR-103).
 *
 * ONE place does this, because the rule that decides whether an address may be
 * opened lives in main (`main/external.ts`) and the renderer's half is one
 * call. The credits screen's licence and source addresses are the first
 * addresses in this app that a person can click, and a second call site
 * spelled at a button would be a second place that could hand main something
 * else.
 *
 * A refusal answers `false` rather than throwing, so a link that will not open
 * is nothing more than a link that will not open.
 */
export function openExternalLink(url: string): void {
  void window.nexus.openExternal(url).catch(() => undefined);
}
