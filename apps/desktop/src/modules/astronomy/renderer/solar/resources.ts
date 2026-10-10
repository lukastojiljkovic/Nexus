/**
 * Everything this view allocates that three.js will not collect on its own.
 *
 * **Why a list rather than a cleanup function.** A geometry, a material and a
 * texture each own GPU memory, and `Object3D.remove` frees none of it; a scene
 * built and thrown away without disposing leaks a buffer per planet per rebuild,
 * which is the kind of leak a user never sees and a long session always reaches.
 * A dispose list is also the only half of a three.js view this repository can
 * test without a GL context: the test builds a scene, walks the graph, and
 * asserts that every geometry, material and texture it finds is IN the list.
 *
 * **`disposeAll` empties the list.** The contract is "dispose what this object
 * created", and an object disposed twice would be a second `dispose()` on a
 * resource somebody else may already share — a shared unit sphere, say. Emptying
 * makes a second call — a StrictMode double-unmount, a rebuild that raced its own
 * cleanup — a no-op rather than a double free.
 */

export interface Disposable {
  dispose(): void;
}

export class SceneResources {
  #items: Disposable[] = [];

  /** Records one allocation and answers it, so a caller can wrap a construction in place. */
  track<T extends Disposable>(item: T): T {
    this.#items.push(item);
    return item;
  }

  /** How many allocations this list holds — the census the completeness test reads. */
  get size(): number {
    return this.#items.length;
  }

  /** Whether this exact allocation is on the list. */
  has(item: Disposable): boolean {
    return this.#items.includes(item);
  }

  /** The allocations, in creation order. */
  list(): readonly Disposable[] {
    return this.#items;
  }

  /** Disposes every allocation once and forgets them. */
  disposeAll(): void {
    const items = this.#items;
    this.#items = [];
    for (const item of items) item.dispose();
  }
}
