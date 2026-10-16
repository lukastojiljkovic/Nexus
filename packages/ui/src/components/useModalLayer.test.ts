import { afterEach, describe, expect, it } from "vitest";

import { holdModalLayer, isModalOpen, modalLayerDepth } from "./useModalLayer.js";

/**
 * The counter behind „a modal is open", which is the whole of what the shell's
 * shortcut guard reads before it acts on a chord.
 *
 * The hook half is one `useEffect`; what can be wrong is the arithmetic it
 * drives, and both failures worth pinning are quiet ones: a release that ran
 * twice takes the count below zero and the guard then ignores every chord for
 * the rest of the session, and a nested layer that was not counted lets a
 * chord through to the page behind the modal that is still open.
 */
describe("the modal-layer count", () => {
  afterEach(() => {
    // Every case releases what it held; this is the statement that it did.
    expect(modalLayerDepth()).toBe(0);
  });

  it("is closed until something publishes a layer", () => {
    expect(modalLayerDepth()).toBe(0);
    expect(isModalOpen()).toBe(false);
  });

  it("opens on the first layer and closes when that layer releases", () => {
    const release = holdModalLayer();
    expect(modalLayerDepth()).toBe(1);
    expect(isModalOpen()).toBe(true);

    release();
    expect(modalLayerDepth()).toBe(0);
    expect(isModalOpen()).toBe(false);
  });

  it("stays open while a second layer is nested inside the first", () => {
    // A confirmation over the launcher: the inner layer closing must not tell
    // the guard the app is free while the outer one is still on screen.
    const releaseOuter = holdModalLayer();
    const releaseInner = holdModalLayer();
    expect(modalLayerDepth()).toBe(2);

    releaseInner();
    expect(isModalOpen()).toBe(true);

    releaseOuter();
    expect(modalLayerDepth()).toBe(0);
  });

  it("cannot be taken below zero by a release that runs twice", () => {
    const release = holdModalLayer();
    release();
    release();
    expect(modalLayerDepth()).toBe(0);

    // And the counter still works afterwards, which is the half that matters:
    // a broken guard would read as „never open" here.
    const second = holdModalLayer();
    expect(isModalOpen()).toBe(true);
    second();
    expect(modalLayerDepth()).toBe(0);
  });
});
