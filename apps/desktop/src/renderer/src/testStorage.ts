/**
 * TEST-ONLY helper — imported by `*.test.ts` files in this directory and by
 * nothing in the app. It exists because the renderer's preference modules
 * (`accent.ts`, `theme.ts`, `autoLock.ts`) and the calendar's source toggles
 * (`calendarItems.ts`) read and write `localStorage` directly, and the desktop
 * package's Vitest runs in a NODE environment with no DOM library: the tests
 * install one of these with `vi.stubGlobal("localStorage", …)`.
 *
 * Deliberately not a `.test.ts` file (it holds no suites) and deliberately not
 * a dependency: a real `Storage` is six methods, so an in-memory one is
 * cheaper than adding jsdom to the tree.
 */

/** An in-memory `Storage`, faithful on the parts the renderer actually uses. */
export function memoryStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const entries = new Map<string, string>(Object.entries(seed));
  return {
    get length(): number {
      return entries.size;
    },
    clear(): void {
      entries.clear();
    },
    getItem(key: string): string | null {
      return entries.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      entries.delete(key);
    },
    setItem(key: string, value: string): void {
      entries.set(key, value);
    },
  };
}
