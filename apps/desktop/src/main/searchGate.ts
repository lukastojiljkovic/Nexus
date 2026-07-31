import type { SearchKind } from "@nexus/core";

/**
 * ADR-058 §5 (the recon's live inconsistency, fixed): global-search RESULTS
 * honour the per-profile enabled-module gate (SET-007) that the palette's
 * COMMANDS have always applied renderer-side. This map is the whole policy —
 * each indexed kind names the module that owns its page, which is also where
 * `App.tsx`'s `onSearchResult` would deep-link the row:
 *
 *  - `document` is "calendar", not a module of its own: tracked documents live
 *    on the calendar page's Dokumenta view.
 *  - `attachment` is "notes", decided honestly rather than hedged: migration
 *    017's `search_source_attachment` projects NOTE attachments only (its
 *    `parent_id` is `note_id`, its profile comes through `notes`), and the
 *    shell opens an attachment hit via `openNote` — task and subject
 *    attachments are not indexed at all. If another parent kind ever joins the
 *    index, this entry must become per-row.
 */
export const SEARCH_KIND_MODULE: Readonly<Record<SearchKind, string>> = {
  task: "tasks",
  event: "calendar",
  document: "calendar",
  note: "notes",
  subject: "study",
  exam: "study",
  deck: "study",
  card: "study",
  attachment: "notes",
};

/**
 * The one shared module gate over search hits — `search:page`, the palette's
 * query path and the recent list all pass through HERE, never through a second
 * copy of the rule. Pure: the enabled set is the caller's (main resolves it
 * from the profile's flag store via `resolveEnabled`), so a business profile
 * with STUDY off stops surfacing subject/exam/deck/card rows everywhere at
 * once.
 */
export function filterSearchHitsByModules<T extends { readonly kind: SearchKind }>(
  hits: readonly T[],
  enabledModuleIds: ReadonlySet<string>,
): T[] {
  return hits.filter((hit) => enabledModuleIds.has(SEARCH_KIND_MODULE[hit.kind]));
}
