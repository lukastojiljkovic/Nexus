import type { SearchKind } from "@nexus/core";
import { createModuleRegistry } from "../shared/modules.js";

/**
 * ADR-058 §5 (the recon's live inconsistency, fixed): global-search RESULTS
 * honour the per-profile enabled-module gate (SET-007) that the palette's
 * COMMANDS have always applied renderer-side. Each indexed kind belongs to the
 * module that owns its page — which is also where `App.tsx`'s `onSearchResult`
 * deep-links the row — and a hit is shown only while that module is on.
 *
 * **Which module owns a kind is the manifest's to say**, in its
 * `searchIndexers` slot (`shared/modules.ts`, ADR-008). Until 2026-09-26 it was
 * a hand-kept `Record<SearchKind, string>` here while that slot sat declared
 * and empty in every manifest — the same fact with two homes, one of them
 * dead. The reasons behind the two non-obvious owners (`document` →
 * calendar, `attachment` → notes) moved with the declarations.
 *
 * One registry for the life of the process: the manifests are compiled in, so
 * the answer cannot change while it runs.
 */
const MODULES = createModuleRegistry();

/** The module whose flag gates a kind's hits, or `undefined` if no module in this build owns it. */
export function searchKindModule(kind: SearchKind): string | undefined {
  return MODULES.searchKindOwner(kind);
}

/**
 * The one shared module gate over search hits — `search:page`, the palette's
 * query path and the recent list all pass through HERE, never through a second
 * copy of the rule. Pure: the enabled set is the caller's (main resolves it
 * from the profile's flag store via `resolveEnabled`), so a business profile
 * with STUDY off stops surfacing subject/exam/deck/card rows everywhere at
 * once. A kind no module owns is shown by no enabled module, so it is dropped.
 */
export function filterSearchHitsByModules<T extends { readonly kind: SearchKind }>(
  hits: readonly T[],
  enabledModuleIds: ReadonlySet<string>,
): T[] {
  return hits.filter((hit) => {
    const owner = searchKindModule(hit.kind);
    return owner !== undefined && enabledModuleIds.has(owner);
  });
}
