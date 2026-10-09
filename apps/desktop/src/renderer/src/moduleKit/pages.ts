import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ModulePageProps } from "../../../shared/moduleApi.js";

/**
 * The renderer half of the kit's discovery: a kit module's page, loaded from
 * `modules/<id>/renderer/Page.tsx` the first time it is opened.
 *
 * **Why lazy, and why a glob.** `routes.tsx` states the rule the whole shell
 * obeys: a page is reached through a lazy import and nowhere else, because a
 * single value import of a page puts it - and whatever it drags in - back into
 * the startup chunk, silently. A kit module cannot be listed in that file (that
 * is the twenty-way conflict the kit exists to end), so its page is reached
 * through a NON-eager `import.meta.glob`: Vite turns every match into a dynamic
 * import, and the module's chunk exists only when somebody opens it.
 *
 * **Why the loaders are keyed by path.** The glob's keys are the file paths
 * relative to THIS file, which is what makes `modulePage(id)` a lookup rather
 * than a scan: the path a module's page must have is derivable from its id, and
 * a module whose page is missing answers `null` instead of loading somebody
 * else's.
 *
 * `routes.test.ts` pins the property this file depends on - no kit page is in
 * the startup import graph - because nothing else can see it: a glob that lost
 * `eager: false` would still work, and only be slower.
 */
const PAGE_LOADERS: Record<string, () => Promise<{ default: ComponentType<ModulePageProps> }>> =
  import.meta.glob("../../../modules/*/renderer/Page.tsx") as Record<
    string,
    () => Promise<{ default: ComponentType<ModulePageProps> }>
  >;

/** Where one module's page must live, relative to this file. */
function pagePath(id: string): string {
  return `../../../modules/${id}/renderer/Page.tsx`;
}

/** Whether this build discovered a page for the module - what the shell asks before drawing a kit page. */
export function hasModulePage(id: string): boolean {
  return Object.hasOwn(PAGE_LOADERS, pagePath(id));
}

const cache = new Map<string, LazyExoticComponent<ComponentType<ModulePageProps>>>();

/**
 * The lazy page component for a discovered module, or `null` when this build has
 * none. `lazy` caches its own promise, and this map caches the component, so two
 * renders of the same page produce one chunk request.
 */
export function modulePage(
  id: string,
): LazyExoticComponent<ComponentType<ModulePageProps>> | null {
  const loader = PAGE_LOADERS[pagePath(id)];
  if (loader === undefined) return null;
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const page = lazy(loader);
  cache.set(id, page);
  return page;
}

/**
 * Every module id this build has a page for, for the tests that ask whether the
 * discovery sees anything at all ("found nothing" and "looked at nothing" must
 * not be the same green line).
 */
export function modulePageIds(): readonly string[] {
  return Object.keys(PAGE_LOADERS).map(
    (path) => /^\.\.\/\.\.\/\.\.\/modules\/([^/]+)\/renderer\/Page\.tsx$/.exec(path)?.[1] ?? path,
  );
}
