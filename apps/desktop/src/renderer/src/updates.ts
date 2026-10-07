import { useEffect, useSyncExternalStore } from "react";

import type { NetworkModeView, UpdateStateView } from "../../shared/ipc.js";

/**
 * The renderer's small view of ADR-089's two facts: the stored network mode and
 * what the update check is doing.
 *
 * They live in one module-level store each rather than in a component, because
 * THREE surfaces read them and only one of them is an ancestor of the others:
 * the „Mreža i ažuriranja" card, the About card's „Proveri sada" row, and the
 * app-wide update notice. `useSyncExternalStore` is what lets a change made in
 * one card reach the other without threading props through pages that do not
 * care about either.
 */

// ── the network mode ──────────────────────────────────────────────────────

let networkView: NetworkModeView | null = null;
const networkListeners = new Set<() => void>();

export function publishNetworkMode(next: NetworkModeView | null): void {
  networkView = next;
  for (const listener of networkListeners) listener();
}

function subscribeNetworkMode(listener: () => void): () => void {
  networkListeners.add(listener);
  return () => {
    networkListeners.delete(listener);
  };
}

function currentNetworkMode(): NetworkModeView | null {
  return networkView;
}

export async function refreshNetworkMode(): Promise<NetworkModeView | null> {
  try {
    const next = await window.nexus.networkMode();
    publishNetworkMode(next);
    return next;
  } catch {
    // Reading the mode may never take a screen down: the choice screen and the
    // settings card both render from whatever is already known.
    return networkView;
  }
}

/** The stored mode, or null before the first read resolves. */
export function useNetworkMode(): NetworkModeView | null {
  const view = useSyncExternalStore(subscribeNetworkMode, currentNetworkMode, currentNetworkMode);
  useEffect(() => {
    if (networkView === null) void refreshNetworkMode();
  }, []);
  return view;
}

// ── the update check ──────────────────────────────────────────────────────

let updateView: UpdateStateView | null = null;
let updateBridgeAttached = false;
const updateListeners = new Set<() => void>();

export function publishUpdate(next: UpdateStateView): void {
  updateView = next;
  for (const listener of updateListeners) listener();
}

function subscribeUpdate(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

function currentUpdate(): UpdateStateView | null {
  return updateView;
}

/** The first reader attaches the push listener and asks for the current state; every later one just subscribes. */
function ensureUpdateBridge(): void {
  if (updateBridgeAttached) return;
  updateBridgeAttached = true;
  window.nexus.onUpdateChanged(publishUpdate);
  void window.nexus.updateStatus().then(publishUpdate).catch(() => {
    // A failed read leaves the notice and the About row hidden rather than
    // showing a state this renderer cannot vouch for.
  });
}

/** The update check's state, or null before the first read resolves. */
export function useUpdateState(): UpdateStateView | null {
  const view = useSyncExternalStore(subscribeUpdate, currentUpdate, currentUpdate);
  useEffect(() => {
    ensureUpdateBridge();
  }, []);
  return view;
}
