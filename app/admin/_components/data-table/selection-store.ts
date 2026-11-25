"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny external store for row selection, keyed by table id. Immutable arrays
 * (a new array on every change) keep useSyncExternalStore snapshots stable
 * between changes. Selection is per-table and cleared on navigation by
 * the table's own remount (the table id includes the page's filter state).
 */
const selections = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();
const EMPTY: readonly string[] = [];

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const getSelection = (tableId: string): readonly string[] => selections.get(tableId) ?? EMPTY;

export function setSelection(tableId: string, ids: readonly string[]) {
  if (ids.length === 0) selections.delete(tableId);
  else selections.set(tableId, ids);
  emit();
}

export function toggleSelection(tableId: string, id: string) {
  const current = getSelection(tableId);
  setSelection(tableId, current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
}

export function useSelection(tableId: string): readonly string[] {
  return useSyncExternalStore(subscribe, () => getSelection(tableId), () => EMPTY);
}
